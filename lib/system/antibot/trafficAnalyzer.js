'use strict';

const { BEHAVIOR_WEIGHTS } = require('./signatures');

const _timing = new Map(); // jid → { lastMsg, lastRead, gaps, onlinePeriods }

function recordMessage(jid) {
    const now  = Date.now();
    const prev = _timing.get(jid) || { lastMsg: 0, gaps: [], readLatencies: [], msgCount: 0, firstSeen: now };
    const gap  = prev.lastMsg ? now - prev.lastMsg : null;
    if (gap !== null) {
        prev.gaps.push(gap);
        if (prev.gaps.length > 30) prev.gaps = prev.gaps.slice(-30);
    }
    prev.lastMsg  = now;
    prev.msgCount = (prev.msgCount || 0) + 1;
    _timing.set(jid, prev);
}

function recordReadReceipt(jid, msgTimestamp) {
    const now = Date.now();
    const rec = _timing.get(jid) || { readLatencies: [] };
    const latency = msgTimestamp ? now - msgTimestamp : 0;
    if (!rec.readLatencies) rec.readLatencies = [];
    rec.readLatencies.push(latency);
    if (rec.readLatencies.length > 20) rec.readLatencies = rec.readLatencies.slice(-20);
    _timing.set(jid, rec);
}

function analyzeTimingPattern(jid) {
    const signals = [];
    let weight    = 0;
    const rec     = _timing.get(jid);
    if (!rec) return { signals, weight };

    try {

        const lats = rec.readLatencies || [];
        if (lats.length >= 3) {
            const avgLat = lats.reduce((a, b) => a + b, 0) / lats.length;
            const zeroCount = lats.filter(l => l < 100).length;
            if (zeroCount / lats.length >= 0.8 && avgLat < 150) {
                const w = BEHAVIOR_WEIGHTS.readReceiptInstant;
                signals.push({ layer: 7, signal: 'read_receipt_instant_avg_' + Math.round(avgLat) + 'ms', weight: w });
                weight += w;
            }
        }

        const gaps = rec.gaps || [];
        if (gaps.length >= 5) {
            const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
            const variance = gaps.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / gaps.length;
            const cv = avg > 0 ? Math.sqrt(variance) / avg : 0; // coefficient of variation

            if (cv < 0.15 && avg < 3000) {
                // sangat regular → bot
                const w = BEHAVIOR_WEIGHTS.typingFixed;
                signals.push({ layer: 7, signal: 'message_gap_too_regular_cv_' + cv.toFixed(2), weight: w });
                weight += w;
            }

            // Burst detection: banyak pesan dalam waktu singkat
            const shortGaps = gaps.filter(g => g < 500).length;
            if (shortGaps / gaps.length >= 0.5) {
                const w = BEHAVIOR_WEIGHTS.burstMessages;
                signals.push({ layer: 7, signal: 'burst_messages_' + shortGaps + '_under_500ms', weight: w });
                weight += w;
            }
        }

        if (rec.firstSeen && rec.msgCount > 50) {
            const ageMs  = Date.now() - rec.firstSeen;
            const ageHrs = ageMs / 3600000;
            const rate   = rec.msgCount / ageHrs; // msgs/hour
            if (rate > 30 && ageHrs > 6) {
                const w = BEHAVIOR_WEIGHTS.alwaysOnline;
                signals.push({ layer: 7, signal: 'high_msg_rate_' + rate.toFixed(0) + '_per_hr', weight: w });
                weight += w;
            }
        }
    } catch {}

    return { signals, weight };
}

function cleanup() {
    const cutoff = Date.now() - 2 * 3600000; // 2 jam
    for (const [jid, rec] of _timing.entries()) {
        if (rec.lastMsg < cutoff) _timing.delete(jid);
    }
}

// Cleanup setiap 30 menit
if (!global._AB_TRAFFIC_CLEANUP) {
    global._AB_TRAFFIC_CLEANUP = true;
    setInterval(cleanup, 30 * 60 * 1000).unref?.();
}

module.exports = { recordMessage, recordReadReceipt, analyzeTimingPattern };

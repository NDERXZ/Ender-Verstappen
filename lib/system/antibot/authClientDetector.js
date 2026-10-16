'use strict';

const { CLIENT_SIGNATURES, BEHAVIOR_WEIGHTS } = require('./signatures');

function _extractBrowserToken(msg) {
    try {
        const verifiedBiz = msg.verifiedBizName;
        const deviceProps = msg.deviceSentMessage?.message?.deviceSentMessage;
        if (deviceProps) return null;
        const key = msg.key || {};
        const participant = key.participant || key.remoteJid || '';
        return null;
    } catch { return null; }
}

function analyzeMessage(msg, contextInfo) {
    const signals  = [];
    let totalWeight = 0;
    let clientType  = null;
    let confidence  = 0;

    try {
        const msgInfo = msg.message || {};
        const extText = msgInfo.extendedTextMessage;
        const context = extText?.contextInfo || contextInfo || {};


        const fwdScore = context.forwardingScore || 0;
        if (fwdScore > 100) {
            signals.push({ layer: 6, signal: 'high_fwd_score_' + fwdScore, weight: 10 });
            totalWeight += 10;
        }

        const devMeta = context.deviceListMetadata;
        if (devMeta !== undefined) {
            const hasRealMeta = devMeta && (devMeta.senderKeyHash || devMeta.recipientKeyHash);
            if (!hasRealMeta && Object.keys(devMeta || {}).length === 0) {
                signals.push({ layer: 6, signal: 'empty_device_list_metadata', weight: 15 });
                totalWeight += 15;
            }
        }

        const extAd = context.externalAdReply;
        if (extAd && extAd.forwardingScore > 999) {
            signals.push({ layer: 6, signal: 'fake_ad_reply_fwd_999', weight: 20 });
            totalWeight += 20;
        }

        if (context.isForwarded && context.forwardingScore >= 999) {
            signals.push({ layer: 6, signal: 'mass_forward_score_999', weight: 25 });
            totalWeight += 25;
            for (const [type, sig] of Object.entries(CLIENT_SIGNATURES)) {
                if (confidence < sig.confidence) { clientType = type; confidence = sig.confidence * 0.5; }
            }
        }

        const msgText = (msgInfo.conversation || extText?.text || '').toLowerCase();
        for (const [type, sig] of Object.entries(CLIENT_SIGNATURES)) {
            if (sig.userAgentRe && sig.userAgentRe.test(msgText)) {
                const w = BEHAVIOR_WEIGHTS.userAgentMatch;
                signals.push({ layer: 6, signal: 'user_agent_' + type, weight: w });
                totalWeight += w;
                if (sig.confidence > confidence) { clientType = type; confidence = sig.confidence; }
            }
        }

        const mentions = context.mentionedJid || [];
        if (mentions.length > 20) {
            signals.push({ layer: 6, signal: 'mass_mention_' + mentions.length, weight: 15 });
            totalWeight += 15;
        }

        if (msgInfo.interactiveResponseMessage || msgInfo.listResponseMessage) {
            signals.push({ layer: 6, signal: 'interactive_response_type', weight: 8 });
            totalWeight += 8;
        }

    } catch {}

    return { signals, weight: totalWeight, clientType, confidence };
}

function analyzeJid(jid) {
    const signals = [];
    let weight    = 0;

    try {
        const num = String(jid).replace(/[^0-9]/g, '');

        // Sequential number pattern (bot numbering)
        if (/(\d)\1{4,}/.test(num)) {
            signals.push({ layer: 6, signal: 'sequential_digit_pattern', weight: 10 });
            weight += 10;
        }

        // Very short numbers (usually reserved/bot)
        if (num.length < 10) {
            signals.push({ layer: 6, signal: 'short_jid_number', weight: 8 });
            weight += 8;
        }

        // Numbers with @lid suffix (linked device pattern — often bot)
        if (jid.endsWith('@lid')) {
            signals.push({ layer: 6, signal: 'lid_suffix', weight: 5 });
            weight += 5;
        }
    } catch {}

    return { signals, weight };
}

module.exports = { analyzeMessage, analyzeJid };

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PM_DIR = './database/pmguard';
const CONFIG_PATH = `${PM_DIR}/config.json`;
const BLOCKED_PATH = `${PM_DIR}/blocked.json`;
const WARNINGS_PATH = `${PM_DIR}/warnings.json`;
const HISTORY_PATH = `${PM_DIR}/history.json`;
const WHITELIST_PATH = `${PM_DIR}/whitelist.json`;
const ANALYTICS_PATH = `${PM_DIR}/analytics.json`;
const APPEALS_PATH = `${PM_DIR}/appeals.json`;
const QUARANTINE_PATH = `${PM_DIR}/quarantine.json`;
const FLOOD_PATH = `${PM_DIR}/flood.json`;

const _ensureDir = () => { if (!fs.existsSync(PM_DIR)) fs.mkdirSync(PM_DIR, { recursive: true }); };
const _read = (p, fb = {}) => { try { _ensureDir(); return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return typeof fb === 'function' ? fb() : (Array.isArray(fb) ? [...fb] : { ...fb }); } };
const _write = (p, d) => { try { _ensureDir(); const tmp = p + '.tmp.' + crypto.randomBytes(4).toString('hex'); fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, p); } catch { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} } };

const DEFAULT_CONFIG = {
    enabled: false,
    mode: 'warn_then_block',
    maxWarnings: 3,
    warningCooldownMs: 30000,
    autoBlockDelayMs: 5000,
    blockDurationMs: 0,
    floodThreshold: 5,
    floodWindowMs: 10000,
    floodAutoBlock: true,
    floodBlockDurationMs: 3600000,
    stealthMode: false,
    ghostMode: false,
    notifyOwnerOnBlock: true,
    notifyOwnerOnPM: false,
    notifyOwnerThreshold: 5,
    logAllPMs: true,
    blockNewUsers: false,
    requireApproval: false,
    antiSpamEnabled: true,
    antiSpamPatterns: [],
    customWarningMsg: '',
    customBlockMsg: '',
    customBlockedReplyMsg: '',
    whitelistPremium: false,
    whitelistGroups: false,
    protectionLevel: 'standard',
    scheduleEnabled: false,
    scheduleStart: '00:00',
    scheduleEnd: '23:59',
    captchaEnabled: false,
    captchaTimeout: 60000,
    quarantineEnabled: true,
    quarantineDurationMs: 600000,
    appealEnabled: true,
    appealCooldownMs: 3600000,
    maxAppeals: 3,
    autoUnblockAfterMs: 0,
    trustedMinInteractions: 0,
    globalCooldownMs: 2000,
    blockReaction: '🚫',
    warnReaction: '⚠️',
    silentBlock: false,
    enabledAt: 0,
    lastModified: 0,
    modifiedBy: ''
};

const _runtimeState = {
    initialized: false,
    socketRef: null,
    ownerJids: [],
    creatorJids: [],
    pmSessionMap: new Map(),
    floodTracker: new Map(),
    pendingCaptcha: new Map(),
    recentBlocks: [],
    recentWarnings: [],
    globalCooldown: new Map(),
    blockQueue: [],
    processingQueue: false,
    stats: {
        totalPMsDetected: 0,
        totalBlocked: 0,
        totalWarned: 0,
        totalFloods: 0,
        totalAppeals: 0,
        totalWhitelisted: 0,
        totalSilenced: 0,
        sessionStart: Date.now()
    },
    rateLimitMap: new Map(),
    messageFingerprints: new Map(),
    behaviorScores: new Map(),
    threatLevel: 'low',
    lastThreatAssessment: 0,
    quarantineTimers: new Map(),
    autoUnblockTimers: new Map(),
    ownerAlertCooldown: 0,
    pendingApprovals: new Map()
};

function _getConfig() {
    const saved = _read(CONFIG_PATH, DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG, ...saved };
}

function _saveConfig(config) {
    config.lastModified = Date.now();
    _write(CONFIG_PATH, config);
}

function _getBlocked() { return _read(BLOCKED_PATH, {}); }
function _saveBlocked(data) { _write(BLOCKED_PATH, data); }
function _getWarnings() { return _read(WARNINGS_PATH, {}); }
function _saveWarnings(data) { _write(WARNINGS_PATH, data); }
function _getWhitelist() { return _read(WHITELIST_PATH, []); }
function _saveWhitelist(data) { _write(WHITELIST_PATH, data); }
function _getHistory() { return _read(HISTORY_PATH, []); }
function _saveHistory(data) { _write(HISTORY_PATH, data); }
function _getAnalytics() { return _read(ANALYTICS_PATH, {}); }
function _saveAnalytics(data) { _write(ANALYTICS_PATH, data); }
function _getAppeals() { return _read(APPEALS_PATH, {}); }
function _saveAppeals(data) { _write(APPEALS_PATH, data); }
function _getQuarantine() { return _read(QUARANTINE_PATH, {}); }
function _saveQuarantine(data) { _write(QUARANTINE_PATH, data); }
function _getFloodData() { return _read(FLOOD_PATH, {}); }
function _saveFloodData(data) { _write(FLOOD_PATH, data); }

function _logHistory(action, jid, detail = '', actor = 'system') {
    const db = _getHistory();
    db.push({
        id: crypto.randomBytes(6).toString('hex'),
        ts: Date.now(),
        time: new Date().toLocaleString('id-ID'),
        action,
        jid: jid?.split('@')[0] || 'unknown',
        fullJid: jid,
        detail: String(detail).slice(0, 300),
        actor: actor?.split('@')[0] || 'system'
    });
    if (db.length > 1000) db.splice(0, db.length - 700);
    _saveHistory(db);
}

function _updateAnalytics(event, jid = null) {
    const db = _getAnalytics();
    const today = new Date().toISOString().split('T')[0];
    if (!db[today]) db[today] = { pms: 0, blocks: 0, warns: 0, floods: 0, appeals: 0, unblocks: 0, unique: [] };
    if (event === 'pm') db[today].pms++;
    if (event === 'block') db[today].blocks++;
    if (event === 'warn') db[today].warns++;
    if (event === 'flood') db[today].floods++;
    if (event === 'appeal') db[today].appeals++;
    if (event === 'unblock') db[today].unblocks++;
    if (jid && !db[today].unique.includes(jid.split('@')[0])) {
        db[today].unique.push(jid.split('@')[0]);
        if (db[today].unique.length > 500) db[today].unique = db[today].unique.slice(-300);
    }
    const keys = Object.keys(db).sort();
    if (keys.length > 90) {
        keys.slice(0, keys.length - 60).forEach(k => delete db[k]);
    }
    _saveAnalytics(db);
}

function _computeMessageFingerprint(text) {
    if (!text) return null;
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
    if (normalized.length < 3) return null;
    return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 10);
}

function _computeBehaviorScore(jid) {
    const existing = _runtimeState.behaviorScores.get(jid);
    const now = Date.now();
    if (existing && (now - existing.ts) < 30000) return existing.score;

    let score = 50;
    const warnings = _getWarnings();
    const blocked = _getBlocked();
    const appeals = _getAppeals();
    const session = _runtimeState.pmSessionMap.get(jid);
    const flood = _runtimeState.floodTracker.get(jid);

    if (warnings[jid]) {
        score -= warnings[jid].count * 15;
    }

    if (blocked[jid]) {
        score -= 30;
        if (blocked[jid].count > 1) score -= blocked[jid].count * 10;
    }

    if (appeals[jid]) {
        if (appeals[jid].denied > 0) score -= appeals[jid].denied * 10;
    }

    if (session) {
        if (session.messageCount > 20) score -= 10;
        if (session.duplicateCount > 5) score -= 15;
        const msgRate = session.messageCount / Math.max(1, (now - session.firstSeen) / 60000);
        if (msgRate > 5) score -= 20;
    }

    if (flood) {
        const recentFloods = flood.timestamps?.filter(t => (now - t) < 3600000).length || 0;
        score -= recentFloods * 20;
    }

    const whitelist = _getWhitelist();
    if (whitelist.includes(jid)) score += 50;

    score = Math.max(-100, Math.min(100, score));
    _runtimeState.behaviorScores.set(jid, { score, ts: now });
    return score;
}

function _getThreatLevel() {
    const now = Date.now();
    if ((now - _runtimeState.lastThreatAssessment) < 30000) return _runtimeState.threatLevel;

    const recentBlocks = _runtimeState.recentBlocks.filter(t => (now - t) < 300000).length;
    const recentWarnings = _runtimeState.recentWarnings.filter(t => (now - t) < 300000).length;
    const activeFloods = [..._runtimeState.floodTracker.values()].filter(f => f.timestamps?.some(t => (now - t) < 60000)).length;

    let level = 'low';
    if (recentBlocks >= 10 || activeFloods >= 5) level = 'critical';
    else if (recentBlocks >= 5 || recentWarnings >= 15 || activeFloods >= 3) level = 'high';
    else if (recentBlocks >= 2 || recentWarnings >= 5 || activeFloods >= 1) level = 'medium';

    _runtimeState.threatLevel = level;
    _runtimeState.lastThreatAssessment = now;
    return level;
}

function _isWithinSchedule(config) {
    if (!config.scheduleEnabled) return true;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = config.scheduleStart.split(':').map(Number);
    const [endH, endM] = config.scheduleEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

function _isOwnerOrCreator(jid) {
    return _runtimeState.ownerJids.includes(jid) || _runtimeState.creatorJids.includes(jid);
}

function _isWhitelisted(jid, config) {
    const whitelist = _getWhitelist();
    if (whitelist.includes(jid)) return true;
    if (_isOwnerOrCreator(jid)) return true;
    return false;
}

function _isBlocked(jid) {
    const blocked = _getBlocked();
    if (!blocked[jid]) return false;
    if (blocked[jid].expiresAt && blocked[jid].expiresAt > 0 && Date.now() > blocked[jid].expiresAt) {
        delete blocked[jid];
        _saveBlocked(blocked);
        _logHistory('auto_unblocked', jid, 'block duration expired');
        return false;
    }
    return true;
}

function _isQuarantined(jid) {
    const quarantine = _getQuarantine();
    if (!quarantine[jid]) return false;
    if (Date.now() > quarantine[jid].expiresAt) {
        delete quarantine[jid];
        _saveQuarantine(quarantine);
        return false;
    }
    return true;
}

function _checkFlood(jid, config) {
    const now = Date.now();
    const tracker = _runtimeState.floodTracker.get(jid) || { timestamps: [], blocked: false, count: 0 };
    tracker.timestamps.push(now);
    tracker.timestamps = tracker.timestamps.filter(t => (now - t) < config.floodWindowMs);

    if (tracker.timestamps.length >= config.floodThreshold) {
        tracker.blocked = true;
        tracker.count++;
        _runtimeState.floodTracker.set(jid, tracker);

        const floodDb = _getFloodData();
        floodDb[jid] = {
            count: (floodDb[jid]?.count || 0) + 1,
            lastFlood: now,
            timestamps: tracker.timestamps.slice(-20)
        };
        _saveFloodData(floodDb);

        _runtimeState.stats.totalFloods++;
        _updateAnalytics('flood', jid);
        return true;
    }

    _runtimeState.floodTracker.set(jid, tracker);
    return false;
}

function _checkGlobalCooldown(jid, config) {
    const now = Date.now();
    const last = _runtimeState.globalCooldown.get(jid) || 0;
    if ((now - last) < config.globalCooldownMs) return false;
    _runtimeState.globalCooldown.set(jid, now);
    return true;
}

function _detectSpamPattern(text, config) {
    if (!config.antiSpamEnabled || !text) return { spam: false };

    const indicators = [];
    let spamScore = 0;

    if (text.length > 2000) { spamScore += 20; indicators.push('long_message'); }
    if (/(.)\1{10,}/g.test(text)) { spamScore += 30; indicators.push('char_repeat'); }
    if (/(https?:\/\/[^\s]+)/gi.test(text)) {
        const urls = text.match(/(https?:\/\/[^\s]+)/gi) || [];
        if (urls.length >= 3) { spamScore += 25; indicators.push('multi_url'); }
        const suspicious = urls.filter(u => /bit\.ly|tinyurl|t\.co|goo\.gl|shorturl|rb\.gy/i.test(u));
        if (suspicious.length > 0) { spamScore += 30; indicators.push('short_url'); }
    }
    if (/[\u{1F600}-\u{1F9FF}]/gu.test(text)) {
        const emojis = text.match(/[\u{1F600}-\u{1F9FF}]/gu) || [];
        if (emojis.length > 15) { spamScore += 15; indicators.push('emoji_spam'); }
    }
    if (/\b(free|gratis|promo|discount|click|klik|join|gabung|invest|profit|earn|money|uang|dana)\b/gi.test(text)) {
        spamScore += 15;
        indicators.push('promo_keywords');
    }
    if (/[A-Z]{5,}/.test(text) && text.toUpperCase() === text && text.length > 20) {
        spamScore += 10;
        indicators.push('all_caps');
    }
    if (text.split('\n').length > 30) { spamScore += 15; indicators.push('many_lines'); }

    if (config.antiSpamPatterns && config.antiSpamPatterns.length > 0) {
        for (const pattern of config.antiSpamPatterns) {
            try {
                if (new RegExp(pattern, 'i').test(text)) {
                    spamScore += 40;
                    indicators.push(`custom:${pattern.slice(0, 20)}`);
                }
            } catch {}
        }
    }

    return { spam: spamScore >= 30, score: spamScore, indicators };
}

function _trackDuplicate(jid, text) {
    if (!text) return false;
    const fp = _computeMessageFingerprint(text);
    if (!fp) return false;

    const key = `${jid}:${fp}`;
    const existing = _runtimeState.messageFingerprints.get(key) || { count: 0, first: Date.now() };
    existing.count++;
    existing.last = Date.now();
    _runtimeState.messageFingerprints.set(key, existing);

    if (_runtimeState.messageFingerprints.size > 2000) {
        const entries = [..._runtimeState.messageFingerprints.entries()]
            .sort((a, b) => a[1].last - b[1].last);
        for (let i = 0; i < entries.length - 1000; i++) {
            _runtimeState.messageFingerprints.delete(entries[i][0]);
        }
    }

    return existing.count >= 3;
}

function _getOrCreateSession(jid) {
    const existing = _runtimeState.pmSessionMap.get(jid);
    const now = Date.now();
    if (existing && (now - existing.lastSeen) < 1800000) {
        existing.lastSeen = now;
        existing.messageCount++;
        return existing;
    }
    const session = {
        jid,
        firstSeen: now,
        lastSeen: now,
        messageCount: 1,
        warningsSent: 0,
        duplicateCount: 0,
        spamScore: 0,
        blocked: false,
        whitelisted: false,
        captchaPassed: false,
        lastWarningTime: 0,
        messages: [],
        actions: []
    };
    _runtimeState.pmSessionMap.set(jid, session);

    if (_runtimeState.pmSessionMap.size > 500) {
        const entries = [..._runtimeState.pmSessionMap.entries()]
            .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
        for (let i = 0; i < entries.length - 300; i++) {
            _runtimeState.pmSessionMap.delete(entries[i][0]);
        }
    }

    return session;
}

function _buildWarningMessage(config, warningCount, maxWarnings, jid) {
    if (config.customWarningMsg) {
        return config.customWarningMsg
            .replace(/{count}/g, warningCount)
            .replace(/{max}/g, maxWarnings)
            .replace(/{remaining}/g, maxWarnings - warningCount)
            .replace(/{user}/g, jid.split('@')[0]);
    }

    const remaining = maxWarnings - warningCount;
    const urgency = remaining <= 1 ? '🚨' : remaining <= 2 ? '⚠️' : '📢';

    return (
        `${urgency} *PM GUARD — PERINGATAN ${warningCount}/${maxWarnings}*\n\n` +
        `Kamu tidak diizinkan mengirim pesan pribadi ke bot ini.\n\n` +
        `⚠️ Sisa peringatan: *${remaining}*\n` +
        `${remaining <= 1 ? '🚨 *PERINGATAN TERAKHIR!* Pesan selanjutnya akan mengakibatkan BLOCK otomatis!' : ''}\n\n` +
        `_Jika kamu merasa ini salah, hubungi owner bot._`
    );
}

function _buildBlockMessage(config, reason) {
    if (config.customBlockMsg) {
        return config.customBlockMsg.replace(/{reason}/g, reason);
    }

    return (
        `🚫 *PM GUARD — BLOCKED*\n\n` +
        `Kamu telah diblokir oleh sistem PM Guard.\n\n` +
        `📌 Alasan: *${reason}*\n` +
        `${config.blockDurationMs > 0 ? `⏱️ Durasi: ${Math.round(config.blockDurationMs / 60000)} menit\n` : '🔒 Durasi: Permanen\n'}` +
        `${config.appealEnabled ? '\n_Kamu bisa mengajukan banding melalui owner bot._' : ''}`
    );
}

function _buildBlockedReplyMessage(config) {
    if (config.customBlockedReplyMsg) return config.customBlockedReplyMsg;
    return `🚫 *Kamu telah diblokir oleh PM Guard.*\n_Hubungi owner bot untuk informasi lebih lanjut._`;
}

async function _executeBlock(sock, jid, reason, config, actor = 'system') {
    const now = Date.now();
    const blocked = _getBlocked();

    const blockEntry = {
        jid,
        reason,
        blockedAt: now,
        blockedTime: new Date(now).toLocaleString('id-ID'),
        expiresAt: config.blockDurationMs > 0 ? now + config.blockDurationMs : 0,
        actor,
        count: (blocked[jid]?.count || 0) + 1,
        behaviorScore: _computeBehaviorScore(jid),
        autoBlock: actor === 'system'
    };

    blocked[jid] = blockEntry;
    _saveBlocked(blocked);

    _logHistory('blocked', jid, reason, actor);
    _updateAnalytics('block', jid);
    _runtimeState.stats.totalBlocked++;
    _runtimeState.recentBlocks.push(now);
    if (_runtimeState.recentBlocks.length > 100) _runtimeState.recentBlocks = _runtimeState.recentBlocks.slice(-50);

    const session = _runtimeState.pmSessionMap.get(jid);
    if (session) session.blocked = true;

    if (!config.silentBlock) {
        try {
            const blockMsg = _buildBlockMessage(config, reason);
            await sock.sendMessage(jid, { text: blockMsg });
            if (config.blockReaction) {
                const lastMsgKey = session?.lastMsgKey;
                if (lastMsgKey) {
                    try { await sock.sendMessage(jid, { react: { text: config.blockReaction, key: lastMsgKey } }); } catch {}
                }
            }
        } catch {}
    }

    try {
        await sock.updateBlockStatus(jid, 'block');
    } catch {}

    if (config.autoUnblockAfterMs > 0) {
        const existingTimer = _runtimeState.autoUnblockTimers.get(jid);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(async () => {
            try {
                await _executeUnblock(sock, jid, 'auto_unblock_timer', 'system');
            } catch {}
            _runtimeState.autoUnblockTimers.delete(jid);
        }, config.autoUnblockAfterMs);
        timer.unref && timer.unref();
        _runtimeState.autoUnblockTimers.set(jid, timer);
    }

    if (config.notifyOwnerOnBlock && _runtimeState.ownerJids.length > 0) {
        const ownerJid = _runtimeState.ownerJids[0];
        if ((now - _runtimeState.ownerAlertCooldown) > 10000) {
            _runtimeState.ownerAlertCooldown = now;
            try {
                const threatLevel = _getThreatLevel();
                const threatEmoji = threatLevel === 'critical' ? '🚨' : threatLevel === 'high' ? '🔴' : threatLevel === 'medium' ? '🟠' : '🟢';
                await sock.sendMessage(ownerJid, {
                    text:
                        `🚫 *PM GUARD — USER BLOCKED*\n\n` +
                        `👤 User: @${jid.split('@')[0]}\n` +
                        `📌 Alasan: ${reason}\n` +
                        `🔢 Block ke-${blockEntry.count}\n` +
                        `📊 Behavior Score: ${blockEntry.behaviorScore}\n` +
                        `${threatEmoji} Threat Level: ${threatLevel}\n` +
                        `⏰ ${blockEntry.blockedTime}\n` +
                        `${blockEntry.expiresAt > 0 ? `⏱️ Expires: ${new Date(blockEntry.expiresAt).toLocaleString('id-ID')}` : '🔒 Permanen'}`,
                    mentions: [jid]
                });
            } catch {}
        }
    }

    return blockEntry;
}

async function _executeUnblock(sock, jid, reason = 'manual', actor = 'system') {
    const blocked = _getBlocked();
    const wasBlocked = blocked[jid];
    delete blocked[jid];
    _saveBlocked(blocked);

    const warnings = _getWarnings();
    delete warnings[jid];
    _saveWarnings(warnings);

    const quarantine = _getQuarantine();
    delete quarantine[jid];
    _saveQuarantine(quarantine);

    const session = _runtimeState.pmSessionMap.get(jid);
    if (session) {
        session.blocked = false;
        session.warningsSent = 0;
    }

    _runtimeState.behaviorScores.delete(jid);

    const existingTimer = _runtimeState.autoUnblockTimers.get(jid);
    if (existingTimer) {
        clearTimeout(existingTimer);
        _runtimeState.autoUnblockTimers.delete(jid);
    }

    try {
        await sock.updateBlockStatus(jid, 'unblock');
    } catch {}

    _logHistory('unblocked', jid, reason, actor);
    _updateAnalytics('unblock', jid);

    return wasBlocked;
}

async function _executeWarn(sock, jid, config, session) {
    const now = Date.now();
    const warnings = _getWarnings();

    if (!warnings[jid]) {
        warnings[jid] = { count: 0, timestamps: [], firstWarn: now };
    }

    if (session && (now - session.lastWarningTime) < config.warningCooldownMs) {
        return { warned: false, reason: 'cooldown' };
    }

    warnings[jid].count++;
    warnings[jid].timestamps.push(now);
    warnings[jid].lastWarn = now;
    if (warnings[jid].timestamps.length > 50) warnings[jid].timestamps = warnings[jid].timestamps.slice(-30);
    _saveWarnings(warnings);

    if (session) {
        session.warningsSent++;
        session.lastWarningTime = now;
    }

    _runtimeState.stats.totalWarned++;
    _runtimeState.recentWarnings.push(now);
    if (_runtimeState.recentWarnings.length > 200) _runtimeState.recentWarnings = _runtimeState.recentWarnings.slice(-100);

    _logHistory('warned', jid, `warning ${warnings[jid].count}/${config.maxWarnings}`);
    _updateAnalytics('warn', jid);

    try {
        const warnMsg = _buildWarningMessage(config, warnings[jid].count, config.maxWarnings, jid);
        await sock.sendMessage(jid, { text: warnMsg });
        if (config.warnReaction && session?.lastMsgKey) {
            try { await sock.sendMessage(jid, { react: { text: config.warnReaction, key: session.lastMsgKey } }); } catch {}
        }
    } catch {}

    if (warnings[jid].count >= config.maxWarnings) {
        return { warned: true, shouldBlock: true, warningCount: warnings[jid].count };
    }

    return { warned: true, shouldBlock: false, warningCount: warnings[jid].count };
}

async function _quarantineUser(sock, jid, config, reason) {
    if (!config.quarantineEnabled) return false;

    const quarantine = _getQuarantine();
    const now = Date.now();

    quarantine[jid] = {
        reason,
        quarantinedAt: now,
        expiresAt: now + config.quarantineDurationMs,
        escalateToBlock: true
    };
    _saveQuarantine(quarantine);
    _logHistory('quarantined', jid, reason);

    try {
        await sock.sendMessage(jid, {
            text:
                `⏳ *PM GUARD — KARANTINA*\n\n` +
                `Kamu dikarantina selama ${Math.round(config.quarantineDurationMs / 60000)} menit.\n` +
                `📌 Alasan: ${reason}\n\n` +
                `_Semua pesan kamu akan diabaikan selama masa karantina._`
        });
    } catch {}

    const timer = setTimeout(() => {
        const q = _getQuarantine();
        if (q[jid]) {
            delete q[jid];
            _saveQuarantine(q);
            _logHistory('quarantine_expired', jid, 'auto-expired');
        }
        _runtimeState.quarantineTimers.delete(jid);
    }, config.quarantineDurationMs);
    timer.unref && timer.unref();
    _runtimeState.quarantineTimers.set(jid, timer);

    return true;
}

async function _notifyOwnerPM(sock, jid, text, session) {
    if (_runtimeState.ownerJids.length === 0) return;
    const ownerJid = _runtimeState.ownerJids[0];
    const now = Date.now();

    if ((now - _runtimeState.ownerAlertCooldown) < 30000) return;

    const config = _getConfig();
    if (!config.notifyOwnerOnPM) return;

    if (session.messageCount < config.notifyOwnerThreshold) return;
    if (session.messageCount % config.notifyOwnerThreshold !== 0) return;

    _runtimeState.ownerAlertCooldown = now;

    try {
        await sock.sendMessage(ownerJid, {
            text:
                `📨 *PM GUARD — PM DETECTED*\n\n` +
                `👤 User: @${jid.split('@')[0]}\n` +
                `📊 Messages: ${session.messageCount}\n` +
                `📝 Last: _${(text || '').slice(0, 100)}_\n` +
                `⏰ Session: ${Math.round((now - session.firstSeen) / 60000)}m\n` +
                `🧠 Behavior: ${_computeBehaviorScore(jid)}`,
            mentions: [jid]
        });
    } catch {}
}

async function handlePMGuardDetection(sock, m, body, isOwner, isCreator, isPremium) {
    if (!_runtimeState.initialized) return { handled: false };
    const config = _getConfig();
    if (!config.enabled) return { handled: false };

    const jid = m.chat || m.key?.remoteJid;
    if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return { handled: false };
    if (jid.endsWith('@newsletter')) return { handled: false };

    if (isOwner || isCreator) return { handled: false };
    if (_isOwnerOrCreator(jid)) return { handled: false };

    if (_isWhitelisted(jid, config)) {
        _runtimeState.stats.totalWhitelisted++;
        return { handled: false };
    }

    if (config.whitelistPremium && isPremium) return { handled: false };

    if (!_isWithinSchedule(config)) return { handled: false };

    _runtimeState.stats.totalPMsDetected++;
    _updateAnalytics('pm', jid);

    const session = _getOrCreateSession(jid);
    session.lastMsgKey = m.key;

    const text = body || m.text || m.caption || '';
    session.messages.push({ ts: Date.now(), text: text.slice(0, 100), type: m.mtype || 'unknown' });
    if (session.messages.length > 30) session.messages = session.messages.slice(-20);

    if (config.logAllPMs) {
        _logHistory('pm_detected', jid, `msg #${session.messageCount}: ${text.slice(0, 80)}`);
    }

    if (_isBlocked(jid)) {
        if (config.ghostMode) {
            _runtimeState.stats.totalSilenced++;
            return { handled: true, action: 'ghost_blocked' };
        }
        try {
            if (!config.silentBlock) {
                const blockedReply = _buildBlockedReplyMessage(config);
                await sock.sendMessage(jid, { text: blockedReply });
            }
            await sock.updateBlockStatus(jid, 'block');
        } catch {}
        _runtimeState.stats.totalSilenced++;
        return { handled: true, action: 'reblocked' };
    }

    if (_isQuarantined(jid)) {
        _runtimeState.stats.totalSilenced++;
        return { handled: true, action: 'quarantined' };
    }

    if (config.ghostMode) {
        await _executeBlock(sock, jid, 'Ghost mode — PM otomatis diblokir', config);
        return { handled: true, action: 'ghost_block' };
    }

    if (config.stealthMode) {
        _runtimeState.stats.totalSilenced++;
        return { handled: true, action: 'stealth' };
    }

    if (!_checkGlobalCooldown(jid, config)) {
        return { handled: true, action: 'cooldown' };
    }

    const isFlood = _checkFlood(jid, config);
    if (isFlood) {
        if (config.floodAutoBlock) {
            const floodConfig = { ...config, blockDurationMs: config.floodBlockDurationMs };
            await _executeBlock(sock, jid, 'Flood detected — terlalu banyak pesan', floodConfig);
            return { handled: true, action: 'flood_blocked' };
        } else {
            await _quarantineUser(sock, jid, config, 'Flood detected');
            return { handled: true, action: 'flood_quarantined' };
        }
    }

    const isDuplicate = _trackDuplicate(jid, text);
    if (isDuplicate) {
        session.duplicateCount++;
        if (session.duplicateCount >= 5) {
            await _quarantineUser(sock, jid, config, 'Pesan duplikat berulang');
            return { handled: true, action: 'duplicate_quarantined' };
        }
    }

    if (config.antiSpamEnabled) {
        const spamCheck = _detectSpamPattern(text, config);
        if (spamCheck.spam) {
            session.spamScore += spamCheck.score;
            if (session.spamScore >= 60) {
                await _executeBlock(sock, jid, `Spam terdeteksi: ${spamCheck.indicators.join(', ')}`, config);
                return { handled: true, action: 'spam_blocked' };
            }
            if (config.quarantineEnabled) {
                await _quarantineUser(sock, jid, config, `Spam terdeteksi: ${spamCheck.indicators.join(', ')}`);
                return { handled: true, action: 'spam_quarantined' };
            }
        }
    }

    if (config.notifyOwnerOnPM) {
        await _notifyOwnerPM(sock, jid, text, session);
    }

    if (config.mode === 'instant_block') {
        await new Promise(r => setTimeout(r, config.autoBlockDelayMs));
        await _executeBlock(sock, jid, 'PM tidak diizinkan (instant block)', config);
        return { handled: true, action: 'instant_blocked' };
    }

    if (config.mode === 'warn_then_block') {
        const warnResult = await _executeWarn(sock, jid, config, session);
        if (!warnResult.warned) {
            return { handled: true, action: 'warn_cooldown' };
        }
        if (warnResult.shouldBlock) {
            await new Promise(r => setTimeout(r, config.autoBlockDelayMs));
            await _executeBlock(sock, jid, `Batas peringatan tercapai (${warnResult.warningCount}/${config.maxWarnings})`, config);
            return { handled: true, action: 'warned_then_blocked' };
        }
        return { handled: true, action: 'warned' };
    }

    if (config.mode === 'quarantine_first') {
        if (!_isQuarantined(jid)) {
            await _quarantineUser(sock, jid, config, 'PM pertama — karantina otomatis');
            return { handled: true, action: 'auto_quarantined' };
        }
        return { handled: true, action: 'already_quarantined' };
    }

    if (config.mode === 'silent') {
        _runtimeState.stats.totalSilenced++;
        return { handled: true, action: 'silenced' };
    }

    if (config.mode === 'log_only') {
        return { handled: false, action: 'logged' };
    }

    return { handled: false };
}

async function handlePMGuardCommand(ctx) {
    const { m, bulter: sock, command, text, args, reply, isOwner, isCreator, prefix, fakeQuoted } = ctx;

    if (!isOwner && !isCreator) {
        return reply('🚫 *Akses ditolak!*\n\nSistem PM Guard hanya untuk owner.');
    }

    if (command === 'pmguard') {
        const sub = (args[0] || '').toLowerCase();
        const config = _getConfig();

        if (!sub || sub === 'status') {
            const health = _getThreatLevel();
            const threatEmoji = health === 'critical' ? '🚨' : health === 'high' ? '🔴' : health === 'medium' ? '🟠' : '🟢';
            const blocked = _getBlocked();
            const warnings = _getWarnings();
            const whitelist = _getWhitelist();
            const quarantine = _getQuarantine();
            const analytics = _getAnalytics();
            const today = new Date().toISOString().split('T')[0];
            const todayStats = analytics[today] || { pms: 0, blocks: 0, warns: 0, floods: 0 };

            let output = `🛡️ *PM GUARD — STATUS*\n\n`;
            output += `${config.enabled ? '✅ *AKTIF*' : '❌ *NONAKTIF*'}\n`;
            output += `📋 Mode: *${config.mode}*\n`;
            output += `${threatEmoji} Threat Level: *${health}*\n\n`;

            output += `━━━ *STATS* ━━━\n`;
            output += `📨 PM Terdeteksi: ${_runtimeState.stats.totalPMsDetected}\n`;
            output += `🚫 Total Blocked: ${_runtimeState.stats.totalBlocked}\n`;
            output += `⚠️ Total Warned: ${_runtimeState.stats.totalWarned}\n`;
            output += `🌊 Total Floods: ${_runtimeState.stats.totalFloods}\n`;
            output += `🤫 Total Silenced: ${_runtimeState.stats.totalSilenced}\n`;

            output += `\n━━━ *TODAY* ━━━\n`;
            output += `📨 PMs: ${todayStats.pms} | 🚫 Blocks: ${todayStats.blocks}\n`;
            output += `⚠️ Warns: ${todayStats.warns} | 🌊 Floods: ${todayStats.floods}\n`;
            output += `👥 Unique: ${todayStats.unique?.length || 0}\n`;

            output += `\n━━━ *CURRENT* ━━━\n`;
            output += `🚫 Blocked: ${Object.keys(blocked).length}\n`;
            output += `⚠️ Warned: ${Object.keys(warnings).length}\n`;
            output += `⏳ Quarantined: ${Object.keys(quarantine).length}\n`;
            output += `✅ Whitelisted: ${whitelist.length}\n`;
            output += `📋 Active Sessions: ${_runtimeState.pmSessionMap.size}\n`;
            output += `🔄 Block Queue: ${_runtimeState.blockQueue.length}\n`;

            output += `\n━━━ *CONFIG* ━━━\n`;
            output += `⚠️ Max Warnings: ${config.maxWarnings}\n`;
            output += `🌊 Flood Threshold: ${config.floodThreshold}/${Math.round(config.floodWindowMs / 1000)}s\n`;
            output += `👻 Ghost Mode: ${config.ghostMode ? '✅' : '❌'}\n`;
            output += `🤫 Stealth Mode: ${config.stealthMode ? '✅' : '❌'}\n`;
            output += `🔔 Notify Owner: ${config.notifyOwnerOnBlock ? '✅' : '❌'}\n`;
            output += `📊 Anti-Spam: ${config.antiSpamEnabled ? '✅' : '❌'}\n`;
            output += `⏳ Quarantine: ${config.quarantineEnabled ? '✅' : '❌'}\n`;
            output += `📅 Schedule: ${config.scheduleEnabled ? `${config.scheduleStart}-${config.scheduleEnd}` : '❌'}\n`;

            output += `\n━━━ *COMMANDS* ━━━\n`;
            output += `\`${prefix}pmguard on/off\` — toggle\n`;
            output += `\`${prefix}pmguard mode <mode>\` — ubah mode\n`;
            output += `\`${prefix}pmguard set <key> <val>\` — config\n`;
            output += `\`${prefix}pmblock <user>\` — manual block\n`;
            output += `\`${prefix}pmunblock <user>\` — unblock\n`;
            output += `\`${prefix}pmwhitelist <user>\` — whitelist\n`;
            output += `\`${prefix}pmblocklist\` — daftar blocked\n`;
            output += `\`${prefix}pmlog\` — history log\n`;
            output += `\`${prefix}pmstats\` — analytics\n`;
            output += `\`${prefix}pmflush\` — reset semua\n`;
            output += `\`${prefix}pmthreat\` — threat assessment`;

            return sock.sendMessage(m.chat, { text: output }, { quoted: fakeQuoted });
        }

        if (sub === 'on') {
            config.enabled = true;
            config.enabledAt = Date.now();
            config.modifiedBy = m.sender;
            _saveConfig(config);
            _logHistory('enabled', m.sender, 'PM Guard enabled', m.sender);
            sock.sendMessage(m.chat, { react: { text: '🛡️', key: m.key } });
            return reply(
                `🛡️ *PM GUARD — AKTIF*\n\n` +
                `✅ Sistem PM Guard telah diaktifkan!\n\n` +
                `📋 Mode: *${config.mode}*\n` +
                `⚠️ Max Warnings: ${config.maxWarnings}\n` +
                `🌊 Flood Protection: ✅\n` +
                `📊 Anti-Spam: ${config.antiSpamEnabled ? '✅' : '❌'}\n\n` +
                `_Semua PM dari non-owner akan diproses._`
            );
        }

        if (sub === 'off') {
            config.enabled = false;
            config.modifiedBy = m.sender;
            _saveConfig(config);
            _logHistory('disabled', m.sender, 'PM Guard disabled', m.sender);
            sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return reply(`❌ *PM GUARD — NONAKTIF*\n\n_Sistem PM Guard telah dimatikan._`);
        }

        if (sub === 'mode') {
            const newMode = (args[1] || '').toLowerCase();
            const validModes = ['warn_then_block', 'instant_block', 'quarantine_first', 'silent', 'ghost', 'log_only'];

            if (!newMode || !validModes.includes(newMode)) {
                return reply(
                    `📋 *PM GUARD — MODES*\n\n` +
                    `Mode saat ini: *${config.mode}*\n\n` +
                    `Available:\n` +
                    `• \`warn_then_block\` — peringatan dulu, lalu blokir\n` +
                    `• \`instant_block\` — langsung blokir tanpa peringatan\n` +
                    `• \`quarantine_first\` — karantina dulu, lalu blokir\n` +
                    `• \`silent\` — abaikan tanpa respon\n` +
                    `• \`ghost\` — blokir tanpa kirim pesan\n` +
                    `• \`log_only\` — catat saja, tidak blokir\n\n` +
                    `Usage: \`${prefix}pmguard mode <mode>\``
                );
            }

            if (newMode === 'ghost') {
                config.mode = 'instant_block';
                config.ghostMode = true;
                config.silentBlock = true;
            } else {
                config.mode = newMode;
                config.ghostMode = false;
                config.silentBlock = false;
            }
            config.modifiedBy = m.sender;
            _saveConfig(config);
            _logHistory('mode_changed', m.sender, `mode → ${newMode}`, m.sender);
            return reply(`✅ Mode PM Guard diubah ke: *${newMode}*`);
        }

        if (sub === 'set') {
            const key = (args[1] || '').toLowerCase();
            const val = args.slice(2).join(' ').trim();

            if (!key) {
                let output = `⚙️ *PM GUARD — SETTINGS*\n\n`;
                const editableKeys = [
                    'maxWarnings', 'warningCooldownMs', 'autoBlockDelayMs', 'blockDurationMs',
                    'floodThreshold', 'floodWindowMs', 'floodAutoBlock', 'floodBlockDurationMs',
                    'stealthMode', 'ghostMode', 'notifyOwnerOnBlock', 'notifyOwnerOnPM',
                    'notifyOwnerThreshold', 'logAllPMs', 'antiSpamEnabled', 'silentBlock',
                    'quarantineEnabled', 'quarantineDurationMs', 'appealEnabled', 'appealCooldownMs',
                    'maxAppeals', 'autoUnblockAfterMs', 'globalCooldownMs', 'blockReaction',
                    'warnReaction', 'scheduleEnabled', 'scheduleStart', 'scheduleEnd',
                    'whitelistPremium', 'customWarningMsg', 'customBlockMsg', 'customBlockedReplyMsg',
                    'protectionLevel'
                ];
                for (const k of editableKeys) {
                    const v = config[k];
                    const display = typeof v === 'string' ? `"${v.slice(0, 30)}"` : String(v);
                    output += `• \`${k}\` = ${display}\n`;
                }
                output += `\nUsage: \`${prefix}pmguard set <key> <value>\``;
                return reply(output);
            }

            if (!config.hasOwnProperty(key)) {
                return reply(`❌ Setting \`${key}\` tidak ditemukan.\n\nGunakan \`${prefix}pmguard set\` untuk lihat semua.`);
            }

            if (!val) return reply(`❌ Value tidak boleh kosong.\n\nUsage: \`${prefix}pmguard set ${key} <value>\``);

            const currentType = typeof config[key];
            let parsed;
            if (currentType === 'boolean') {
                parsed = ['true', '1', 'yes', 'on'].includes(val.toLowerCase());
            } else if (currentType === 'number') {
                parsed = Number(val);
                if (isNaN(parsed)) return reply(`❌ Value harus berupa angka untuk \`${key}\``);
            } else {
                parsed = val;
            }

            config[key] = parsed;
            config.modifiedBy = m.sender;
            _saveConfig(config);
            _logHistory('config_changed', m.sender, `${key} = ${parsed}`, m.sender);
            return reply(`✅ Setting \`${key}\` diubah ke: *${parsed}*`);
        }

        if (sub === 'level') {
            const level = (args[1] || '').toLowerCase();
            const levels = {
                'low': { maxWarnings: 5, floodThreshold: 10, antiSpamEnabled: false, quarantineEnabled: false, mode: 'warn_then_block' },
                'standard': { maxWarnings: 3, floodThreshold: 5, antiSpamEnabled: true, quarantineEnabled: true, mode: 'warn_then_block' },
                'high': { maxWarnings: 2, floodThreshold: 3, antiSpamEnabled: true, quarantineEnabled: true, floodAutoBlock: true, mode: 'warn_then_block' },
                'maximum': { maxWarnings: 1, floodThreshold: 2, antiSpamEnabled: true, quarantineEnabled: true, floodAutoBlock: true, mode: 'instant_block', ghostMode: true, silentBlock: true },
                'paranoid': { maxWarnings: 0, floodThreshold: 1, antiSpamEnabled: true, quarantineEnabled: false, floodAutoBlock: true, mode: 'instant_block', ghostMode: true, silentBlock: true, stealthMode: true }
            };

            if (!level || !levels[level]) {
                return reply(
                    `🛡️ *PROTECTION LEVELS*\n\n` +
                    `Current: *${config.protectionLevel}*\n\n` +
                    `• \`low\` — 5 warnings, no spam detection\n` +
                    `• \`standard\` — 3 warnings, anti-spam\n` +
                    `• \`high\` — 2 warnings, aggressive flood\n` +
                    `• \`maximum\` — 1 warning, instant ghost block\n` +
                    `• \`paranoid\` — 0 warning, full stealth\n\n` +
                    `Usage: \`${prefix}pmguard level <level>\``
                );
            }

            Object.assign(config, levels[level]);
            config.protectionLevel = level;
            config.modifiedBy = m.sender;
            _saveConfig(config);
            _logHistory('level_changed', m.sender, `protection level → ${level}`, m.sender);
            return reply(`✅ Protection level diubah ke: *${level}*\n\n_Settings telah disesuaikan otomatis._`);
        }

        if (sub === 'schedule') {
            const start = args[1];
            const end = args[2];

            if (!start || !end) {
                return reply(
                    `📅 *PM GUARD — SCHEDULE*\n\n` +
                    `Status: ${config.scheduleEnabled ? '✅ Aktif' : '❌ Nonaktif'}\n` +
                    `Waktu: ${config.scheduleStart} - ${config.scheduleEnd}\n\n` +
                    `Usage:\n` +
                    `\`${prefix}pmguard schedule 22:00 06:00\` — aktif jam 22-06\n` +
                    `\`${prefix}pmguard schedule off\` — matikan schedule`
                );
            }

            if (start === 'off') {
                config.scheduleEnabled = false;
                _saveConfig(config);
                return reply(`✅ Schedule dimatikan.`);
            }

            if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
                return reply(`❌ Format waktu salah. Gunakan HH:MM (contoh: 22:00 06:00)`);
            }

            config.scheduleEnabled = true;
            config.scheduleStart = start;
            config.scheduleEnd = end;
            config.modifiedBy = m.sender;
            _saveConfig(config);
            _logHistory('schedule_set', m.sender, `${start}-${end}`, m.sender);
            return reply(`✅ Schedule aktif: *${start} - ${end}*`);
        }

        if (sub === 'spam') {
            const action = (args[1] || '').toLowerCase();
            const pattern = args.slice(2).join(' ').trim();

            if (action === 'add' && pattern) {
                try { new RegExp(pattern, 'i'); } catch { return reply(`❌ Pattern regex tidak valid: ${pattern}`); }
                if (!config.antiSpamPatterns) config.antiSpamPatterns = [];
                config.antiSpamPatterns.push(pattern);
                _saveConfig(config);
                return reply(`✅ Spam pattern ditambahkan: \`${pattern}\`\n📊 Total: ${config.antiSpamPatterns.length}`);
            }

            if (action === 'remove' || action === 'del') {
                const idx = parseInt(pattern) - 1;
                if (isNaN(idx) || idx < 0 || idx >= (config.antiSpamPatterns?.length || 0)) {
                    return reply(`❌ Index tidak valid.`);
                }
                const removed = config.antiSpamPatterns.splice(idx, 1);
                _saveConfig(config);
                return reply(`✅ Pattern dihapus: \`${removed[0]}\``);
            }

            if (action === 'list' || !action) {
                const patterns = config.antiSpamPatterns || [];
                if (patterns.length === 0) return reply(`📋 Belum ada custom spam pattern.`);
                let output = `📋 *SPAM PATTERNS (${patterns.length})*\n\n`;
                patterns.forEach((p, i) => { output += `${i + 1}. \`${p}\`\n`; });
                output += `\n\`${prefix}pmguard spam add <regex>\` — tambah\n\`${prefix}pmguard spam del <index>\` — hapus`;
                return reply(output);
            }

            return reply(`Usage: \`${prefix}pmguard spam add/del/list\``);
        }

        return reply(`❌ Sub-command \`${sub}\` tidak dikenali.\n\nGunakan \`${prefix}pmguard\` untuk melihat semua command.`);
    }

    if (command === 'pmblock') {
        const targetRaw = args[0] || '';
        let targetJid = '';

        if (m.quoted) {
            targetJid = m.quoted.sender || m.quoted.participant;
        } else if (m.mentionedJid && m.mentionedJid.length > 0) {
            targetJid = m.mentionedJid[0];
        } else if (targetRaw) {
            const cleaned = targetRaw.replace(/[^0-9]/g, '');
            if (cleaned.length >= 10) targetJid = cleaned + '@s.whatsapp.net';
        }

        if (!targetJid) {
            return reply(
                `❌ *Target tidak ditemukan!*\n\n` +
                `Cara:\n` +
                `• \`${prefix}pmblock @user\` — mention user\n` +
                `• \`${prefix}pmblock 628xxx\` — nomor telepon\n` +
                `• Reply pesan user + \`${prefix}pmblock\``
            );
        }

        if (_isOwnerOrCreator(targetJid)) {
            return reply(`❌ Tidak bisa memblokir owner/creator!`);
        }

        const reason = args.slice(1).join(' ').trim() || 'Manual block by owner';
        const config = _getConfig();

        sock.sendMessage(m.chat, { react: { text: '🚫', key: m.key } });
        const result = await _executeBlock(sock, targetJid, reason, config, m.sender);

        return reply(
            `🚫 *PM GUARD — MANUAL BLOCK*\n\n` +
            `👤 User: @${targetJid.split('@')[0]}\n` +
            `📌 Alasan: ${reason}\n` +
            `🔢 Block ke-${result.count}\n` +
            `${result.expiresAt > 0 ? `⏱️ Expires: ${new Date(result.expiresAt).toLocaleString('id-ID')}` : '🔒 Permanen'}`
        );
    }

    if (command === 'pmunblock') {
        const targetRaw = args[0] || '';
        let targetJid = '';

        if (m.quoted) {
            targetJid = m.quoted.sender || m.quoted.participant;
        } else if (m.mentionedJid && m.mentionedJid.length > 0) {
            targetJid = m.mentionedJid[0];
        } else if (targetRaw) {
            if (targetRaw === 'all') {
                const blocked = _getBlocked();
                const count = Object.keys(blocked).length;
                if (count === 0) return reply(`📋 Tidak ada user yang diblokir.`);

                for (const jid of Object.keys(blocked)) {
                    try { await _executeUnblock(sock, jid, 'mass_unblock', m.sender); } catch {}
                }

                return reply(`✅ *${count} user* berhasil di-unblock semua.`);
            }

            const cleaned = targetRaw.replace(/[^0-9]/g, '');
            if (cleaned.length >= 10) targetJid = cleaned + '@s.whatsapp.net';
        }

        if (!targetJid) {
            return reply(
                `❌ *Target tidak ditemukan!*\n\n` +
                `Cara:\n` +
                `• \`${prefix}pmunblock @user\`\n` +
                `• \`${prefix}pmunblock 628xxx\`\n` +
                `• \`${prefix}pmunblock all\` — unblock semua`
            );
        }

        const wasBlocked = await _executeUnblock(sock, targetJid, 'manual_unblock', m.sender);
        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });

        return reply(
            `✅ *PM GUARD — UNBLOCKED*\n\n` +
            `👤 User: @${targetJid.split('@')[0]}\n` +
            `${wasBlocked ? `📌 Was blocked for: ${wasBlocked.reason || 'unknown'}` : '⚠️ User tidak ada di blocklist'}`
        );
    }

    if (command === 'pmwhitelist') {
        const sub = (args[0] || '').toLowerCase();
        const whitelist = _getWhitelist();

        if (sub === 'add') {
            let targetJid = '';
            if (m.quoted) {
                targetJid = m.quoted.sender || m.quoted.participant;
            } else if (m.mentionedJid && m.mentionedJid.length > 0) {
                targetJid = m.mentionedJid[0];
            } else if (args[1]) {
                const cleaned = args[1].replace(/[^0-9]/g, '');
                if (cleaned.length >= 10) targetJid = cleaned + '@s.whatsapp.net';
            }

            if (!targetJid) return reply(`❌ Target tidak ditemukan.\n\nUsage: \`${prefix}pmwhitelist add @user\``);
            if (whitelist.includes(targetJid)) return reply(`⚠️ User sudah di whitelist.`);

            whitelist.push(targetJid);
            _saveWhitelist(whitelist);

            const blocked = _getBlocked();
            if (blocked[targetJid]) {
                await _executeUnblock(sock, targetJid, 'whitelisted', m.sender);
            }

            _logHistory('whitelisted', targetJid, 'added to whitelist', m.sender);
            return reply(`✅ @${targetJid.split('@')[0]} ditambahkan ke whitelist.`);
        }

        if (sub === 'remove' || sub === 'del') {
            let targetJid = '';
            if (m.quoted) {
                targetJid = m.quoted.sender || m.quoted.participant;
            } else if (m.mentionedJid && m.mentionedJid.length > 0) {
                targetJid = m.mentionedJid[0];
            } else if (args[1]) {
                const cleaned = args[1].replace(/[^0-9]/g, '');
                if (cleaned.length >= 10) targetJid = cleaned + '@s.whatsapp.net';
            }

            if (!targetJid) return reply(`❌ Target tidak ditemukan.`);
            const idx = whitelist.indexOf(targetJid);
            if (idx === -1) return reply(`⚠️ User tidak ada di whitelist.`);

            whitelist.splice(idx, 1);
            _saveWhitelist(whitelist);
            _logHistory('unwhitelisted', targetJid, 'removed from whitelist', m.sender);
            return reply(`✅ @${targetJid.split('@')[0]} dihapus dari whitelist.`);
        }

        if (sub === 'clear') {
            _saveWhitelist([]);
            return reply(`✅ Whitelist dikosongkan.`);
        }

        if (!sub || sub === 'list') {
            if (whitelist.length === 0) return reply(`📋 Whitelist kosong.`);
            let output = `✅ *WHITELIST (${whitelist.length})*\n\n`;
            whitelist.forEach((jid, i) => { output += `${i + 1}. @${jid.split('@')[0]}\n`; });
            output += `\n\`${prefix}pmwhitelist add/del @user\``;
            return reply(output);
        }

        return reply(`Usage: \`${prefix}pmwhitelist add/del/list/clear\``);
    }

    if (command === 'pmblocklist') {
        const blocked = _getBlocked();
        const entries = Object.entries(blocked);

        if (entries.length === 0) return reply(`📋 Tidak ada user yang diblokir.`);

        const page = parseInt(args[0]) || 1;
        const perPage = 10;
        const totalPages = Math.ceil(entries.length / perPage);
        const start = (page - 1) * perPage;
        const pageEntries = entries.slice(start, start + perPage);

        let output = `🚫 *BLOCKED LIST (${entries.length})*\n`;
        output += `📄 Page ${page}/${totalPages}\n\n`;

        for (const [jid, data] of pageEntries) {
            const score = _computeBehaviorScore(jid);
            output += `👤 @${jid.split('@')[0]}\n`;
            output += `   📌 ${data.reason?.slice(0, 50) || 'unknown'}\n`;
            output += `   ⏰ ${data.blockedTime || 'unknown'}\n`;
            output += `   🔢 Block #${data.count || 1} | Score: ${score}\n`;
            if (data.expiresAt > 0) {
                const remaining = Math.max(0, data.expiresAt - Date.now());
                output += `   ⏱️ Expires: ${Math.round(remaining / 60000)}m\n`;
            } else {
                output += `   🔒 Permanen\n`;
            }
            output += `\n`;
        }

        if (totalPages > 1) output += `\nPage: \`${prefix}pmblocklist <page>\``;
        return reply(output);
    }

    if (command === 'pmlog') {
        const limit = parseInt(args[0]) || 15;
        const filterAction = args[1]?.toLowerCase();
        let history = _getHistory();

        if (filterAction) {
            history = history.filter(h => h.action.includes(filterAction));
        }

        history = history.slice(-limit).reverse();

        if (history.length === 0) return reply(`📋 Tidak ada log${filterAction ? ` untuk '${filterAction}'` : ''}.`);

        let output = `📋 *PM GUARD LOG (${history.length})*\n\n`;

        const actionIcons = {
            'pm_detected': '📨', 'warned': '⚠️', 'blocked': '🚫', 'unblocked': '✅',
            'whitelisted': '💚', 'unwhitelisted': '💔', 'quarantined': '⏳',
            'enabled': '🟢', 'disabled': '🔴', 'flood': '🌊', 'config': '⚙️',
            'mode': '📋', 'level': '🛡️', 'auto_unblocked': '🔓', 'reblocked': '🔁'
        };

        for (const h of history) {
            const icon = Object.entries(actionIcons).find(([k]) => h.action.includes(k))?.[1] || '📝';
            output += `${icon} *${h.action}*\n`;
            output += `   👤 ${h.jid} | ${h.time}\n`;
            if (h.detail) output += `   _${h.detail.slice(0, 80)}_\n`;
            output += `\n`;
        }

        if (output.length > 4000) output = output.slice(0, 3950) + '\n... (terpotong)';
        return reply(output);
    }

    if (command === 'pmstats') {
        const analytics = _getAnalytics();
        const days = Object.keys(analytics).sort().reverse().slice(0, 7);

        if (days.length === 0) return reply(`📊 Belum ada data analytics.`);

        let output = `📊 *PM GUARD — ANALYTICS*\n\n`;

        let totalPMs = 0, totalBlocks = 0, totalWarns = 0, totalFloods = 0, totalUnique = new Set();

        output += `\`Date       | PMs | Blk | Wrn | Fld | Unq\`\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        for (const day of days) {
            const d = analytics[day];
            totalPMs += d.pms || 0;
            totalBlocks += d.blocks || 0;
            totalWarns += d.warns || 0;
            totalFloods += d.floods || 0;
            (d.unique || []).forEach(u => totalUnique.add(u));
            output += `\`${day} | ${String(d.pms || 0).padStart(3)} | ${String(d.blocks || 0).padStart(3)} | ${String(d.warns || 0).padStart(3)} | ${String(d.floods || 0).padStart(3)} | ${String(d.unique?.length || 0).padStart(3)}\`\n`;
        }

        output += `\n━━━ *TOTALS (${days.length} days)* ━━━\n`;
        output += `📨 PMs: ${totalPMs}\n`;
        output += `🚫 Blocks: ${totalBlocks}\n`;
        output += `⚠️ Warns: ${totalWarns}\n`;
        output += `🌊 Floods: ${totalFloods}\n`;
        output += `👥 Unique Users: ${totalUnique.size}\n`;
        if (totalPMs > 0) {
            output += `📊 Block Rate: ${Math.round((totalBlocks / totalPMs) * 100)}%\n`;
        }

        const threatLevel = _getThreatLevel();
        const threatEmoji = threatLevel === 'critical' ? '🚨' : threatLevel === 'high' ? '🔴' : threatLevel === 'medium' ? '🟠' : '🟢';
        output += `\n${threatEmoji} Current Threat: *${threatLevel}*`;

        const topOffenders = [..._runtimeState.behaviorScores.entries()]
            .filter(([, v]) => v.score < 0)
            .sort((a, b) => a[1].score - b[1].score)
            .slice(0, 5);

        if (topOffenders.length > 0) {
            output += `\n\n━━━ *TOP OFFENDERS* ━━━\n`;
            for (const [jid, data] of topOffenders) {
                output += `👤 @${jid.split('@')[0]} — Score: ${data.score}\n`;
            }
        }

        return reply(output);
    }

    if (command === 'pmthreat') {
        sock.sendMessage(m.chat, { react: { text: '🔍', key: m.key } });
        const threatLevel = _getThreatLevel();
        const blocked = _getBlocked();
        const warnings = _getWarnings();
        const quarantine = _getQuarantine();
        const now = Date.now();

        const recentBlocks = _runtimeState.recentBlocks.filter(t => (now - t) < 300000).length;
        const recentWarnings = _runtimeState.recentWarnings.filter(t => (now - t) < 300000).length;
        const activeFloods = [..._runtimeState.floodTracker.values()].filter(f => f.timestamps?.some(t => (now - t) < 60000)).length;
        const activeSessions = [..._runtimeState.pmSessionMap.values()].filter(s => (now - s.lastSeen) < 300000).length;

        const threatEmoji = threatLevel === 'critical' ? '🚨' : threatLevel === 'high' ? '🔴' : threatLevel === 'medium' ? '🟠' : '🟢';

        let output = `${threatEmoji} *THREAT ASSESSMENT*\n\n`;
        output += `🛡️ Level: *${threatLevel.toUpperCase()}*\n\n`;

        output += `━━━ *INDICATORS* ━━━\n`;
        output += `🚫 Recent Blocks (5min): ${recentBlocks}\n`;
        output += `⚠️ Recent Warnings (5min): ${recentWarnings}\n`;
        output += `🌊 Active Floods: ${activeFloods}\n`;
        output += `📨 Active PM Sessions: ${activeSessions}\n`;
        output += `⏳ Quarantined: ${Object.keys(quarantine).length}\n`;
        output += `🔐 Total Blocked: ${Object.keys(blocked).length}\n`;
        output += `⚠️ Total Warned: ${Object.keys(warnings).length}\n`;

        const highThreatUsers = [..._runtimeState.behaviorScores.entries()]
            .filter(([, v]) => v.score < -20)
            .sort((a, b) => a[1].score - b[1].score)
            .slice(0, 10);

        if (highThreatUsers.length > 0) {
            output += `\n━━━ *HIGH THREAT USERS* ━━━\n`;
            for (const [jid, data] of highThreatUsers) {
                const isBlockedNow = !!blocked[jid];
                const warnData = warnings[jid];
                output += `${isBlockedNow ? '🚫' : '⚠️'} @${jid.split('@')[0]} — Score: ${data.score}`;
                if (warnData) output += ` | Warns: ${warnData.count}`;
                output += `\n`;
            }
        }

        const floodUsers = [..._runtimeState.floodTracker.entries()]
            .filter(([, f]) => f.timestamps?.some(t => (now - t) < 300000))
            .slice(0, 5);

        if (floodUsers.length > 0) {
            output += `\n━━━ *FLOOD SOURCES* ━━━\n`;
            for (const [jid, data] of floodUsers) {
                const recentCount = data.timestamps.filter(t => (now - t) < 60000).length;
                output += `🌊 @${jid.split('@')[0]} — ${recentCount} msg/min (${data.count} floods)\n`;
            }
        }

        const recommendations = [];
        if (threatLevel === 'critical') recommendations.push('Pertimbangkan mode `paranoid` atau `instant_block`');
        if (activeFloods >= 3) recommendations.push('Kurangi `floodThreshold` untuk deteksi lebih awal');
        if (recentBlocks >= 5) recommendations.push('Aktifkan `ghostMode` untuk silent blocking');
        if (Object.keys(blocked).length > 50) recommendations.push('Bersihkan blocklist lama dengan `pmunblock all`');

        if (recommendations.length > 0) {
            output += `\n━━━ *RECOMMENDATIONS* ━━━\n`;
            recommendations.forEach(r => { output += `💡 ${r}\n`; });
        }

        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        return reply(output);
    }

    if (command === 'pmflush') {
        const sub = (args[0] || '').toLowerCase();

        if (sub === 'confirm') {
            _saveBlocked({});
            _saveWarnings({});
            _saveQuarantine({});
            _saveFloodData({});

            _runtimeState.pmSessionMap.clear();
            _runtimeState.floodTracker.clear();
            _runtimeState.messageFingerprints.clear();
            _runtimeState.behaviorScores.clear();
            _runtimeState.globalCooldown.clear();
            _runtimeState.recentBlocks = [];
            _runtimeState.recentWarnings = [];
            _runtimeState.blockQueue = [];
            _runtimeState.stats.totalPMsDetected = 0;
            _runtimeState.stats.totalBlocked = 0;
            _runtimeState.stats.totalWarned = 0;
            _runtimeState.stats.totalFloods = 0;
            _runtimeState.stats.totalSilenced = 0;

            for (const timer of _runtimeState.autoUnblockTimers.values()) clearTimeout(timer);
            _runtimeState.autoUnblockTimers.clear();
            for (const timer of _runtimeState.quarantineTimers.values()) clearTimeout(timer);
            _runtimeState.quarantineTimers.clear();

            _logHistory('flushed', m.sender, 'all data reset', m.sender);
            sock.sendMessage(m.chat, { react: { text: '🗑️', key: m.key } });
            return reply(`🗑️ *PM GUARD — FLUSHED*\n\n✅ Semua data blocked, warnings, quarantine, dan session telah direset.`);
        }

        return reply(
            `⚠️ *PM GUARD — FLUSH*\n\n` +
            `Ini akan menghapus SEMUA data:\n` +
            `• Blocked list\n` +
            `• Warning data\n` +
            `• Quarantine data\n` +
            `• Flood data\n` +
            `• Session data\n\n` +
            `Ketik \`${prefix}pmflush confirm\` untuk konfirmasi.`
        );
    }
}

function initPMGuard(sock, ownerJids = [], creatorJids = []) {
    if (_runtimeState.initialized) return _runtimeState;
    _ensureDir();
    _runtimeState.socketRef = sock;
    _runtimeState.ownerJids = Array.isArray(ownerJids) ? ownerJids : [ownerJids];
    _runtimeState.creatorJids = Array.isArray(creatorJids) ? creatorJids : [creatorJids];
    _runtimeState.initialized = true;
    _runtimeState.stats.sessionStart = Date.now();

    const config = _getConfig();
    if (!fs.existsSync(CONFIG_PATH)) _saveConfig(config);

    setInterval(() => {
        const now = Date.now();
        for (const [jid, session] of _runtimeState.pmSessionMap) {
            if ((now - session.lastSeen) > 1800000) _runtimeState.pmSessionMap.delete(jid);
        }
        for (const [jid, tracker] of _runtimeState.floodTracker) {
            tracker.timestamps = tracker.timestamps.filter(t => (now - t) < 600000);
            if (tracker.timestamps.length === 0) _runtimeState.floodTracker.delete(jid);
        }
        for (const [key, data] of _runtimeState.messageFingerprints) {
            if ((now - data.last) > 1800000) _runtimeState.messageFingerprints.delete(key);
        }
        for (const [jid, data] of _runtimeState.behaviorScores) {
            if ((now - data.ts) > 3600000) _runtimeState.behaviorScores.delete(jid);
        }
        for (const [jid, ts] of _runtimeState.globalCooldown) {
            if ((now - ts) > 300000) _runtimeState.globalCooldown.delete(jid);
        }

        _runtimeState.recentBlocks = _runtimeState.recentBlocks.filter(t => (now - t) < 600000);
        _runtimeState.recentWarnings = _runtimeState.recentWarnings.filter(t => (now - t) < 600000);

        const blocked = _getBlocked();
        let changed = false;
        for (const [jid, data] of Object.entries(blocked)) {
            if (data.expiresAt > 0 && now > data.expiresAt) {
                delete blocked[jid];
                changed = true;
                _logHistory('auto_unblocked', jid, 'block expired');
                try { sock.updateBlockStatus(jid, 'unblock'); } catch {}
            }
        }
        if (changed) _saveBlocked(blocked);

        const quarantine = _getQuarantine();
        let qChanged = false;
        for (const [jid, data] of Object.entries(quarantine)) {
            if (now > data.expiresAt) {
                delete quarantine[jid];
                qChanged = true;
            }
        }
        if (qChanged) _saveQuarantine(quarantine);
    }, 60000);

    return _runtimeState;
}

// isFeatureDegraded bukan bagian dari pmguard — selalu fallback false
const _pmgIsFeatureDegraded = () => false;

module.exports = {
    initPMGuard,
    handlePMGuardDetection,
    handlePMGuardCommand,
    isFeatureDegraded: _pmgIsFeatureDegraded
};
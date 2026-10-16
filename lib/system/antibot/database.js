'use strict';

const fs   = require('fs');
const path = require('path');

const DB_DIR  = path.join(process.cwd(), 'database');
const DB_PATH = path.join(DB_DIR, 'antibot.json');

const _DEFAULT = () => ({
    clients:     {},
    whitelist:   [],
    blacklist:   [],
    groupConfig: {},
    stats: { total_scanned: 0, detected: 0, false_positive: 0 },
    lastReport:  null,
});

function _read() {
    try {
        if (!fs.existsSync(DB_PATH)) return _DEFAULT();
        const raw = fs.readFileSync(DB_PATH, 'utf8').trim();
        return raw ? Object.assign(_DEFAULT(), JSON.parse(raw)) : _DEFAULT();
    } catch { return _DEFAULT(); }
}

function _write(data) {
    try {
        if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
        const tmp = DB_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, DB_PATH);
    } catch (e) { console.error('[AntiBot:DB]', e.message); }
}

function getDB()       { return _read(); }
function saveDB(d)     { _write(d); }

function getClient(jid) {
    return _read().clients[jid] || null;
}

function upsertClient(jid, patch) {
    const db = _read();
    const now = new Date().toISOString();
    if (!db.clients[jid]) {
        db.clients[jid] = {
            jid, score: 0, level: 'CLEAN', clientType: null, confidence: 0,
            firstSeen: now, lastSeen: now, evidence: [], timeline: [], warns: 0, action: null,
        };
    }
    Object.assign(db.clients[jid], patch, { lastSeen: now });
    _write(db);
    return db.clients[jid];
}

function addEvidence(jid, entry) {
    const db = _read();
    if (!db.clients[jid]) return;
    db.clients[jid].evidence = db.clients[jid].evidence || [];
    db.clients[jid].evidence.push(entry);
    if (db.clients[jid].evidence.length > 20) db.clients[jid].evidence = db.clients[jid].evidence.slice(-20);
    _write(db);
}

function addTimeline(jid, entry) {
    const db = _read();
    if (!db.clients[jid]) return;
    db.clients[jid].timeline = db.clients[jid].timeline || [];
    db.clients[jid].timeline.push(entry);
    if (db.clients[jid].timeline.length > 50) db.clients[jid].timeline = db.clients[jid].timeline.slice(-50);
    _write(db);
}

function isWhitelisted(jid) {
    const db = _read();
    return db.whitelist.includes(jid);
}

function isBlacklisted(jid) {
    const db = _read();
    return db.blacklist.includes(jid);
}

function setWhitelist(jid, add = true) {
    const db = _read();
    if (add) { if (!db.whitelist.includes(jid)) db.whitelist.push(jid); }
    else      { db.whitelist = db.whitelist.filter(j => j !== jid); }
    _write(db);
}

function setBlacklist(jid, add = true) {
    const db = _read();
    if (add) { if (!db.blacklist.includes(jid)) db.blacklist.push(jid); }
    else      { db.blacklist = db.blacklist.filter(j => j !== jid); }
    _write(db);
}

function getGroupConfig(chatId) {
    const db = _read();
    return db.groupConfig[chatId] || { enabled: false, sensitivity: 'medium', action: 'warn', warnLimit: 3 };
}

function setGroupConfig(chatId, patch) {
    const db = _read();
    db.groupConfig[chatId] = Object.assign(getGroupConfig(chatId), patch);
    _write(db);
}

function incStats(field) {
    const db = _read();
    db.stats[field] = (db.stats[field] || 0) + 1;
    _write(db);
}

function getSuspects(minScore = 50) {
    const db = _read();
    return Object.values(db.clients).filter(c => c.score >= minScore).sort((a,b) => b.score - a.score);
}

function cleanOld(maxAgeDays = 7) {
    const db    = _read();
    const cutoff = Date.now() - maxAgeDays * 86400000;
    for (const jid of Object.keys(db.clients)) {
        const c = db.clients[jid];
        if (new Date(c.lastSeen).getTime() < cutoff && c.score < 50) delete db.clients[jid];
    }
    _write(db);
}

module.exports = {
    getDB, saveDB, getClient, upsertClient, addEvidence, addTimeline,
    isWhitelisted, isBlacklisted, setWhitelist, setBlacklist,
    getGroupConfig, setGroupConfig, incStats, getSuspects, cleanOld,
};

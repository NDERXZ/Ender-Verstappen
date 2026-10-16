'use strict';

const fs   = require('fs');
const path = require('path');

const SESSION_DIR  = path.join(process.cwd(), 'session');
const BACKUP_ROOT  = path.join(process.cwd(), 'session_backup');
const MAX_BACKUPS  = 5;
const INTERVAL_MS  = 6 * 60 * 60 * 1000;

let _backupTimer = null;
let _lastBackup  = null;
let _notifyCb    = null;

function _ts() {
    return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }).replace(/[/:]/g, '-').replace(/\s/g, '_');
}

function _copyDir(src, dest) {
    if (!fs.existsSync(src)) return 0;
    fs.mkdirSync(dest, { recursive: true });
    let count = 0;
    for (const item of fs.readdirSync(src)) {
        const s = path.join(src, item);
        const d = path.join(dest, item);
        const stat = fs.statSync(s);
        if (stat.isDirectory()) {
            count += _copyDir(s, d);
        } else {
            fs.copyFileSync(s, d);
            count++;
        }
    }
    return count;
}

function _pruneOldBackups() {
    if (!fs.existsSync(BACKUP_ROOT)) return;
    const folders = fs.readdirSync(BACKUP_ROOT)
        .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_ROOT, f)).mtime.getTime() }))
        .sort((a, b) => a.mtime - b.mtime);
    while (folders.length > MAX_BACKUPS) {
        const old = folders.shift();
        try { fs.rmSync(path.join(BACKUP_ROOT, old.name), { recursive: true, force: true }); } catch {}
    }
}

async function doBackup() {
    if (!fs.existsSync(SESSION_DIR)) return { ok: false, reason: 'session dir not found' };
    try {
        const label  = `session_${_ts()}`;
        const dest   = path.join(BACKUP_ROOT, label);
        const count  = _copyDir(SESSION_DIR, dest);
        _pruneOldBackups();
        _lastBackup = Date.now();

        const msg = `✅ *Session backup selesai*\n› ${count} file disalin ke \`${label}\``;
        if (typeof _notifyCb === 'function') {
            try { await _notifyCb(msg); } catch {}
        }
        return { ok: true, label, count };
    } catch (e) {
        const msg = `⚠️ *Session backup gagal:* ${e.message}`;
        if (typeof _notifyCb === 'function') { try { await _notifyCb(msg); } catch {} }
        return { ok: false, reason: e.message };
    }
}

function startAutoBackup(notifyFn) {
    if (_backupTimer) { clearInterval(_backupTimer); }
    _notifyCb    = notifyFn || null;
    _backupTimer = setInterval(doBackup, INTERVAL_MS);
    if (_backupTimer.unref) _backupTimer.unref();
    doBackup();
}

function stopAutoBackup() {
    if (_backupTimer) { clearInterval(_backupTimer); _backupTimer = null; }
}

function getBackupStatus() {
    return {
        lastBackup:  _lastBackup,
        sessionDir:  SESSION_DIR,
        backupRoot:  BACKUP_ROOT,
        maxBackups:  MAX_BACKUPS,
        intervalHr:  INTERVAL_MS / 3600000,
    };
}

function listBackups() {
    if (!fs.existsSync(BACKUP_ROOT)) return [];
    return fs.readdirSync(BACKUP_ROOT)
        .map(f => {
            const fp = path.join(BACKUP_ROOT, f);
            try {
                const stat = fs.statSync(fp);
                return { name: f, mtime: stat.mtime.getTime(), isDir: stat.isDirectory() };
            } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);
}

module.exports = { startAutoBackup, stopAutoBackup, doBackup, getBackupStatus, listBackups };

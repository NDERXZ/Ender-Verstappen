'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Paths ──
const BACKUP_DIR  = './database/autobackup';
const META_PATH   = `${BACKUP_DIR}/meta.json`;
const MAX_BACKUPS = 10; // simpan 10 backup terakhir

const DB_FILES = [
    { key: 'sewa',          path: './database/sewa.json'           },
    { key: 'groupsettings', path: './database/groupsettings.json'  },
    { key: 'groups',        path: './database/groups.json'         },
    { key: 'premium',       path: './database/premium.json'        },
    { key: 'owner',         path: './database/owner.json'          },
    { key: 'banned',        path: './database/banned.json'         },
    { key: 'grupstats',     path: './database/grupstats.json'      },
    { key: 'adzan',         path: './database/adzan.json'          },
    { key: 'security',      path: './database/security'            }, // folder
    { key: 'antiban',       path: './database/antiban'             }, // folder
];

const _ensureDir = () => {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
};

const _readMeta = () => {
    _ensureDir();
    try { return JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch { return { backups: [] }; }
};

const _writeMeta = (d) => {
    _ensureDir();
    fs.writeFileSync(META_PATH, JSON.stringify(d, null, 2));
};

const _hashFile = (buf) => crypto.createHash('md5').update(buf).digest('hex').slice(0, 8);

const _fmtSize = (b) => b < 1024 ? b+'B' : b < 1048576 ? (b/1024).toFixed(1)+'KB' : (b/1048576).toFixed(2)+'MB';

// ── Baca satu DB entry (file atau folder) ──
const _readEntry = (entry) => {
    try {
        const stat = fs.existsSync(entry.path) && fs.statSync(entry.path);
        if (!stat) return null;
        if (stat.isDirectory()) {
            const result = {};
            fs.readdirSync(entry.path).filter(f => f.endsWith('.json')).forEach(f => {
                try { result[f] = JSON.parse(fs.readFileSync(`${entry.path}/${f}`, 'utf8')); } catch {}
            });
            return result;
        }
        return JSON.parse(fs.readFileSync(entry.path, 'utf8'));
    } catch { return null; }
};

// ── Tulis satu DB entry ──
const _writeEntry = (entry, data) => {
    try {
        if (typeof data === 'object' && !Array.isArray(data) && entry.path.includes('database/security') || entry.path.includes('database/antiban')) {
            // Folder — tulis tiap file
            if (!fs.existsSync(entry.path)) fs.mkdirSync(entry.path, { recursive: true });
            for (const [filename, content] of Object.entries(data)) {
                fs.writeFileSync(`${entry.path}/${filename}`, JSON.stringify(content, null, 2));
            }
        } else {
            const dir = path.dirname(entry.path);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(entry.path, JSON.stringify(data, null, 2));
        }
        return true;
    } catch { return false; }
};

//l
const createBackup = (trigger = 'auto') => {
    _ensureDir();
    const stamp  = Date.now();
    const id     = `bk_${stamp}`;
    const meta   = _readMeta();
    const snap   = { id, trigger, ts: stamp, files: {} };
    let   totalSize = 0;

    for (const entry of DB_FILES) {
        const data = _readEntry(entry);
        if (data === null) continue;
        const buf  = Buffer.from(JSON.stringify(data));
        snap.files[entry.key] = {
            data,
            size: buf.length,
            hash: _hashFile(buf),
            path: entry.path
        };
        totalSize += buf.length;
    }

    snap.totalSize = totalSize;
    snap.fileCount = Object.keys(snap.files).length;

    // Simpan snapshot ke disk
    const snapPath = `${BACKUP_DIR}/${id}.json`;
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));

    // Update meta
    meta.backups = meta.backups || [];
    meta.backups.push({ id, trigger, ts: stamp, totalSize, fileCount: snap.fileCount, path: snapPath });

    // Hapus backup lama kalau > MAX_BACKUPS
    while (meta.backups.length > MAX_BACKUPS) {
        const old = meta.backups.shift();
        try { if (fs.existsSync(old.path)) fs.unlinkSync(old.path); } catch {}
    }
    meta.lastBackup  = stamp;
    meta.lastTrigger = trigger;
    _writeMeta(meta);

    console.log(`[AutoBackup] Backup ${id} dibuat (${_fmtSize(totalSize)}, ${snap.fileCount} files, trigger: ${trigger})`);
    return { id, totalSize, fileCount: snap.fileCount, snapPath };
};

//
const restoreBackup = (backupId) => {
    const meta = _readMeta();
    const entry = (meta.backups || []).find(b => b.id === backupId);
    if (!entry) throw new Error(`Backup '${backupId}' tidak ditemukan.`);

    const snap = JSON.parse(fs.readFileSync(entry.path, 'utf8'));
    const results = [];
    let ok = 0, fail = 0;

    for (const [key, fileData] of Object.entries(snap.files)) {
        const dbEntry = DB_FILES.find(e => e.key === key);
        if (!dbEntry) { results.push(`⚠️ Skip: ${key} (tidak dikenal)`); continue; }

        // Backup file saat ini sebelum overwrite
        try {
            const curData = _readEntry(dbEntry);
            if (curData !== null) {
                fs.writeFileSync(`${BACKUP_DIR}/pre_restore_${key}.json`, JSON.stringify(curData, null, 2));
            }
        } catch {}

        const wrote = _writeEntry(dbEntry, fileData.data);
        if (wrote) { ok++;   results.push(`✅ ${key}`); }
        else       { fail++; results.push(`❌ ${key} (gagal tulis)`); }
    }

    console.log(`[AutoBackup] Restore ${backupId}: ${ok} OK, ${fail} gagal`);
    return { ok, fail, results, backupId };
};

//
const listBackups = () => {
    const meta = _readMeta();
    return (meta.backups || []).slice().reverse(); // terbaru dulu
};

const getBackupInfo = (backupId) => {
    const meta  = _readMeta();
    const entry = (meta.backups || []).find(b => b.id === backupId);
    if (!entry) return null;
    try {
        const snap = JSON.parse(fs.readFileSync(entry.path, 'utf8'));
        return { ...entry, files: Object.keys(snap.files).map(k => ({
            key: k,
            size: snap.files[k].size,
            hash: snap.files[k].hash
        }))};
    } catch { return entry; }
};

const deleteBackup = (backupId) => {
    const meta = _readMeta();
    const idx  = (meta.backups || []).findIndex(b => b.id === backupId);
    if (idx === -1) return false;
    const entry = meta.backups[idx];
    try { if (fs.existsSync(entry.path)) fs.unlinkSync(entry.path); } catch {}
    meta.backups.splice(idx, 1);
    _writeMeta(meta);
    return true;
};

//
let _abInterval = null;
const _AB_INTERVAL_MS = 6 * 60 * 60 * 1000; // tiap 6 jam

const startAutoBackup = (notifyFn = null) => {
    if (_abInterval) return; // sudah running
    _abInterval = setInterval(async () => {
        try {
            const result = createBackup('auto_interval');
            console.log(`[AutoBackup] ✅ Auto backup: ${result.id}`);
            if (notifyFn) {
                await notifyFn(
                    `🗄️ *Auto-Backup Berhasil!*\n\n` +
                    `🆔 ID: \`${result.id}\`\n` +
                    `📦 Ukuran: ${_fmtSize(result.totalSize)}\n` +
                    `📁 Files: ${result.fileCount}\n` +
                    `🕐 Waktu: ${new Date().toLocaleString('id-ID')}`
                );
            }
        } catch(e) {
            console.error('[AutoBackup] ❌ Auto backup gagal:', e.message);
            if (notifyFn) await notifyFn(`❌ *Auto-Backup Gagal!*\n\nError: ${e.message.slice(0, 150)}`).catch(() => {});
        }
    }, _AB_INTERVAL_MS);
    console.log('[AutoBackup] Scheduler started (setiap 6 jam)');
};

const stopAutoBackup = () => {
    if (_abInterval) { clearInterval(_abInterval); _abInterval = null; }
};

module.exports = { createBackup, restoreBackup, listBackups, getBackupInfo, deleteBackup, startAutoBackup, stopAutoBackup, _fmtSize, DB_FILES };
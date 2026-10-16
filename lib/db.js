'use strict';

const fs   = require('fs');
const path = require('path');

//
const DB_DIR      = path.resolve('./database');
const DB_PATH     = path.join(DB_DIR, 'bulter.db');
const JSON_PATHS  = {
    groups      : path.join(DB_DIR, 'group.json'),
    premium     : path.join(DB_DIR, 'premium.json'),
    banned      : path.join(DB_DIR, 'banned.json'),
    owner       : path.join(DB_DIR, 'owner.json'),
    groupsettings: path.join(DB_DIR, 'groupsettings.json'),
    userprofile : path.join(DB_DIR, 'userprofile.json'),
    grupstats   : path.join(DB_DIR, 'grupstats.json'),
    sewa        : path.join(DB_DIR, 'sewa.json'),
    invoices    : path.join(DB_DIR, 'invoices.json'),
    sewa_reminder: path.join(DB_DIR, 'sewa_reminder.json'),
    adzan       : path.join(DB_DIR, 'adzan.json'),
};

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const _jRead = (p, fallback) => {
    try {
        if (!fs.existsSync(p)) return fallback;
        const raw = fs.readFileSync(p, 'utf8');
        return JSON.parse(raw);
    } catch { return fallback; }
};
const _jWrite = (p, data) => {
    try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch {}
};

let DB = null;
let _sqliteOK = false;

try {
    const Database = require('better-sqlite3');
    DB = new Database(DB_PATH);

    // WAL mode → atomic writes, no race condition
    DB.pragma('journal_mode = WAL');
    DB.pragma('synchronous = NORMAL');
    DB.pragma('foreign_keys = ON');

    _sqliteOK = true;
    console.log('[DB] ✅ better-sqlite3 aktif:', DB_PATH);
} catch (e) {
    console.warn('[DB] ⚠️  better-sqlite3 tidak tersedia, fallback ke JSON:', e.message);
    console.warn('[DB]    Jalankan: npm install better-sqlite3');
}

const _migrate = () => {
    if (!_sqliteOK) return;
    DB.exec(`
        -- Simple list tables (groups / premium / banned / owner)
        CREATE TABLE IF NOT EXISTS simple_lists (
            list_name TEXT NOT NULL,
            jid       TEXT NOT NULL,
            added_at  INTEGER DEFAULT (strftime('%s','now') * 1000),
            PRIMARY KEY (list_name, jid)
        );

        -- Group settings (satu blob JSON per grup supaya nested tetap aman)
        CREATE TABLE IF NOT EXISTS group_settings (
            group_id TEXT PRIMARY KEY,
            settings TEXT NOT NULL DEFAULT '{}'
        );

        -- User profile
        CREATE TABLE IF NOT EXISTS user_profile (
            jid        TEXT PRIMARY KEY,
            name       TEXT DEFAULT '',
            exp        INTEGER DEFAULT 0,
            koin       INTEGER DEFAULT 0,
            last_daily INTEGER DEFAULT 0
        );

        -- Grup stats — member totals
        CREATE TABLE IF NOT EXISTS gs_members (
            group_id TEXT NOT NULL,
            jid      TEXT NOT NULL,
            name     TEXT DEFAULT '',
            count    INTEGER DEFAULT 0,
            PRIMARY KEY (group_id, jid)
        );
        CREATE INDEX IF NOT EXISTS idx_gs_members_group ON gs_members(group_id);

        -- Grup stats — daily totals
        CREATE TABLE IF NOT EXISTS gs_daily (
            group_id TEXT NOT NULL,
            date     TEXT NOT NULL,
            count    INTEGER DEFAULT 0,
            PRIMARY KEY (group_id, date)
        );

        -- Grup stats — per-hour totals
        CREATE TABLE IF NOT EXISTS gs_hourly (
            group_id TEXT NOT NULL,
            date     TEXT NOT NULL,
            hour     INTEGER NOT NULL,
            count    INTEGER DEFAULT 0,
            PRIMARY KEY (group_id, date, hour)
        );

        -- Grup stats — last seen
        CREATE TABLE IF NOT EXISTS gs_lastseen (
            group_id TEXT NOT NULL,
            jid      TEXT NOT NULL,
            ts       INTEGER DEFAULT 0,
            PRIMARY KEY (group_id, jid)
        );

        -- Sewa
        CREATE TABLE IF NOT EXISTS sewa (
            group_id    TEXT PRIMARY KEY,
            paket       TEXT,
            expiry      INTEGER,
            lifetime    INTEGER DEFAULT 0,
            notif_sent  INTEGER DEFAULT 0,
            added_by    TEXT DEFAULT ''
        );

        -- Invoices
        CREATE TABLE IF NOT EXISTS invoices (
            id             TEXT PRIMARY KEY,
            group_id       TEXT NOT NULL,
            group_name     TEXT DEFAULT '',
            paket          TEXT DEFAULT 'basic',
            paket_label    TEXT DEFAULT 'Basic',
            harga          INTEGER DEFAULT 0,
            days           INTEGER DEFAULT 0,
            is_lifetime    INTEGER DEFAULT 0,
            created_at     INTEGER NOT NULL,
            expiry         INTEGER,
            added_by       TEXT DEFAULT '',
            status         TEXT DEFAULT 'active',
            nama_bot       TEXT DEFAULT '',
            nama_owner     TEXT DEFAULT '',
            owner_num      TEXT DEFAULT '',
            reminders_sent TEXT DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_invoices_group ON invoices(group_id);

        -- Sewa reminders
        CREATE TABLE IF NOT EXISTS sewa_reminders (
            group_id TEXT PRIMARY KEY,
            sent     TEXT DEFAULT '[]'
        );

        -- Adzan
        CREATE TABLE IF NOT EXISTS adzan (
            group_id TEXT PRIMARY KEY,
            kota     TEXT DEFAULT '',
            aktif    INTEGER DEFAULT 1
        );

        -- Migration flag
        CREATE TABLE IF NOT EXISTS _meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
    `);
};

// ─── One-time JSON → SQLite import ───────────────────────────────────────────
const _importJSON = () => {
    if (!_sqliteOK) return;
    const done = DB.prepare('SELECT value FROM _meta WHERE key = ?').get('json_migrated');
    if (done) return;

    console.log('[DB] 🔄 Migrasi JSON → SQLite (sekali jalan)...');

    const tx = DB.transaction(() => {
        // simple lists
        for (const name of ['groups','premium','banned','owner']) {
            const arr = _jRead(JSON_PATHS[name] || JSON_PATHS[name.replace('group','group')], []);
            if (Array.isArray(arr)) {
                const ins = DB.prepare('INSERT OR IGNORE INTO simple_lists(list_name,jid) VALUES(?,?)');
                for (const jid of arr) if (typeof jid === 'string') ins.run(name, jid);
            }
        }

        // group_settings
        const gs = _jRead(JSON_PATHS.groupsettings, {});
        const insGS = DB.prepare('INSERT OR REPLACE INTO group_settings(group_id,settings) VALUES(?,?)');
        for (const [gid, val] of Object.entries(gs)) {
            try { insGS.run(gid, JSON.stringify(val)); } catch {}
        }

        // user_profile
        const up = _jRead(JSON_PATHS.userprofile, {});
        const insUP = DB.prepare('INSERT OR REPLACE INTO user_profile(jid,name,exp,koin,last_daily) VALUES(?,?,?,?,?)');
        for (const [jid, u] of Object.entries(up)) {
            try { insUP.run(jid, u.name||'', u.exp||0, u.koin||0, u.lastDaily||0); } catch {}
        }

        // grupstats
        const stats = _jRead(JSON_PATHS.grupstats, {});
        const insMem  = DB.prepare('INSERT OR REPLACE INTO gs_members(group_id,jid,name,count) VALUES(?,?,?,?)');
        const insDay  = DB.prepare('INSERT OR REPLACE INTO gs_daily(group_id,date,count) VALUES(?,?,?)');
        const insHour = DB.prepare('INSERT OR REPLACE INTO gs_hourly(group_id,date,hour,count) VALUES(?,?,?,?)');
        const insLS   = DB.prepare('INSERT OR REPLACE INTO gs_lastseen(group_id,jid,ts) VALUES(?,?,?)');
        for (const [gid, g] of Object.entries(stats)) {
            try {
                const names = g.names || {};
                for (const [jid, cnt] of Object.entries(g.members || {}))
                    insMem.run(gid, jid, names[jid]||'', cnt);
                for (const [date, cnt] of Object.entries(g.daily || {}))
                    insDay.run(gid, date, cnt);
                for (const [date, hours] of Object.entries(g.hourly || {}))
                    if (Array.isArray(hours)) hours.forEach((cnt,h) => { if(cnt) insHour.run(gid,date,h,cnt); });
                for (const [jid, ts] of Object.entries(g.lastSeen || {}))
                    insLS.run(gid, jid, ts);
            } catch {}
        }

        // sewa
        const sw = _jRead(JSON_PATHS.sewa, {});
        const insSW = DB.prepare('INSERT OR REPLACE INTO sewa(group_id,paket,expiry,lifetime,notif_sent,added_by) VALUES(?,?,?,?,?,?)');
        for (const [gid, r] of Object.entries(sw)) {
            try { insSW.run(gid, r.paket||'basic', r.expiry||null, r.lifetime?1:0, r.notifSent?1:0, r.addedBy||''); } catch {}
        }

        // invoices
        const inv = _jRead(JSON_PATHS.invoices, {});
        const insINV = DB.prepare(`INSERT OR IGNORE INTO invoices
            (id,group_id,group_name,paket,paket_label,harga,days,is_lifetime,created_at,expiry,added_by,status,nama_bot,nama_owner,owner_num,reminders_sent)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const list of Object.values(inv)) {
            for (const i of (Array.isArray(list) ? list : [])) {
                try {
                    insINV.run(i.id, i.groupId, i.groupName||'', i.paket||'basic', i.paketLabel||'Basic',
                        i.harga||0, i.days||0, i.isLifetime?1:0, i.createdAt||Date.now(),
                        i.expiry||null, i.addedBy||'', i.status||'active',
                        i.namaBot||'', i.namaOwner||'', i.ownerNum||'',
                        JSON.stringify(i.remindersSent||[]));
                } catch {}
            }
        }

        // sewa_reminder
        const rem = _jRead(JSON_PATHS.sewa_reminder, {});
        const insREM = DB.prepare('INSERT OR REPLACE INTO sewa_reminders(group_id,sent) VALUES(?,?)');
        for (const [k, v] of Object.entries(rem)) {
            try { insREM.run(k, JSON.stringify(v.sent||[])); } catch {}
        }

        // adzan
        const adz = _jRead(JSON_PATHS.adzan, {});
        const insADZ = DB.prepare('INSERT OR REPLACE INTO adzan(group_id,kota,aktif) VALUES(?,?,?)');
        for (const [gid, r] of Object.entries(adz)) {
            try { insADZ.run(gid, r.kota||'', r.aktif===false?0:1); } catch {}
        }

        DB.prepare("INSERT OR REPLACE INTO _meta(key,value) VALUES('json_migrated','1')").run();
    });

    try { tx(); console.log('[DB] ✅ Migrasi JSON selesai.'); }
    catch (e) { console.error('[DB] ❌ Migrasi JSON gagal:', e.message); }
};

// ─── run migration ───────────────────────────────────────────
if (_sqliteOK) { _migrate(); _importJSON(); }


const loadList = (name) => {
    if (_sqliteOK) {
        try {
            const rows = DB.prepare('SELECT jid FROM simple_lists WHERE list_name = ?').all(name);
            return rows.map(r => r.jid);
        } catch {}
    }
    // JSON fallback
    const p = JSON_PATHS[name];
    if (!p) return [];
    const data = _jRead(p, []);
    return Array.isArray(data) ? data : [];
};

/**
 * Simpan list → void
 * Sync ke JSON fallback juga.
 */
const saveList = (name, arr) => {
    if (_sqliteOK) {
        try {
            const tx = DB.transaction(() => {
                DB.prepare('DELETE FROM simple_lists WHERE list_name = ?').run(name);
                const ins = DB.prepare('INSERT OR IGNORE INTO simple_lists(list_name,jid) VALUES(?,?)');
                for (const jid of arr) ins.run(name, jid);
            });
            tx();
        } catch {}
    }
    // JSON fallback sync
    const p = JSON_PATHS[name];
    if (p) _jWrite(p, arr);
};


const _GS_DEFAULT = () => ({
    antilink: false, antilinkWA: false, antilinkWhitelist: [],
    antiimage: false, antivideo: false, antidocument: false, antisticker: false,
    antiforward: false, antiaudio: false, antigif: false,
    anticontact: false, antilocation: false,
    antitoxic: false, maxWarn: 3, warnings: {},
    blacklist: [],
    muted: [],
    welcome: false, leave: false, welcomeMsg: '', leaveMsg: '',
    antispam: false, spamMax: 50, spamWarn1: 10, spamWarn2: 25, spamWarn3: 40,
    antivortex: false,
    slowmode: false, slowmodeDelay: 10,
    autoreply: {},
    bannednumbers: [],
    antiautobot: false,
    protectgc: false,
    rules: '',
    scheduleOpen: '', scheduleClose: '', scheduleActive: false, timezone: 'Asia/Jakarta',
    verify: false, verifyQuestion: '', verifyAnswer: '', verifyTimeout: 5,
    antiraid: false, antiraidMax: 5, antiraidWindow: 10,
    lockprofile: false,
    antinsfw: false, nsfwLogs: [],
    antiocrlink: false,
    antiocrtext: false,
});

/** Baca semua settings → { [groupId]: settingsObj } */
const gsLoadAll = () => {
    if (_sqliteOK) {
        try {
            const rows = DB.prepare('SELECT group_id, settings FROM group_settings').all();
            const out = {};
            for (const r of rows) {
                try { out[r.group_id] = JSON.parse(r.settings); } catch {}
            }
            return out;
        } catch {}
    }
    return _jRead(JSON_PATHS.groupsettings, {});
};

/** Simpan semua settings ← { [groupId]: settingsObj } */
const gsSaveAll = (data) => {
    if (_sqliteOK) {
        try {
            const tx = DB.transaction(() => {
                const ups = DB.prepare('INSERT OR REPLACE INTO group_settings(group_id,settings) VALUES(?,?)');
                for (const [gid, val] of Object.entries(data)) {
                    ups.run(gid, JSON.stringify(val));
                }
            });
            tx();
        } catch {}
    }
    _jWrite(JSON_PATHS.groupsettings, data);
};

/** Baca settings satu grup */
const gsGet = (gid) => {
    if (_sqliteOK) {
        try {
            const row = DB.prepare('SELECT settings FROM group_settings WHERE group_id = ?').get(gid);
            if (row) return { ..._GS_DEFAULT(), ...JSON.parse(row.settings) };
        } catch {}
    }
    // JSON fallback
    const db = _jRead(JSON_PATHS.groupsettings, {});
    if (!db[gid]) { db[gid] = _GS_DEFAULT(); _jWrite(JSON_PATHS.groupsettings, db); }
    return { ..._GS_DEFAULT(), ...db[gid] };
};

/** Update settings satu grup */
const gsSet = (gid, updates) => {
    const current = gsGet(gid);
    const merged  = { ...current, ...updates };

    if (_sqliteOK) {
        try {
            DB.prepare('INSERT OR REPLACE INTO group_settings(group_id,settings) VALUES(?,?)').run(gid, JSON.stringify(merged));
            // JSON sync
            const db = _jRead(JSON_PATHS.groupsettings, {});
            db[gid] = merged;
            _jWrite(JSON_PATHS.groupsettings, db);
            return merged;
        } catch {}
    }
    // JSON fallback
    const db = _jRead(JSON_PATHS.groupsettings, {});
    db[gid] = merged;
    _jWrite(JSON_PATHS.groupsettings, db);
    return merged;
};

const gsKey = (gid, key, val) => gsSet(gid, { [key]: val });

const gsAddWarn = (gid, uid) => {
    const s = gsGet(gid);
    if (!s.warnings) s.warnings = {};
    s.warnings[uid] = (s.warnings[uid] || 0) + 1;
    gsSet(gid, { warnings: s.warnings });
    return s.warnings[uid];
};

const gsResetWarn = (gid, uid) => {
    const s = gsGet(gid);
    if (!s.warnings) s.warnings = {};
    s.warnings[uid] = 0;
    gsSet(gid, { warnings: s.warnings });
};

const gsResetAllWarn = (gid) => gsKey(gid, 'warnings', {});

const gsMute = (gid, uid) => {
    const s = gsGet(gid);
    const muted = s.muted || [];
    if (!muted.includes(uid)) gsKey(gid, 'muted', [...muted, uid]);
};

const gsUnmute = (gid, uid) => {
    const s = gsGet(gid);
    gsKey(gid, 'muted', (s.muted || []).filter(u => u !== uid));
};

const gsAddWL = (gid, domain) => {
    const clean = domain.toLowerCase().replace(/https?:\/\//i, '').split('/')[0];
    const s = gsGet(gid);
    const wl = s.antilinkWhitelist || [];
    if (!wl.includes(clean)) gsKey(gid, 'antilinkWhitelist', [...wl, clean]);
    return clean;
};

const gsRemWL = (gid, domain) => {
    const clean = domain.toLowerCase().replace(/https?:\/\//i, '').split('/')[0];
    const s = gsGet(gid);
    gsKey(gid, 'antilinkWhitelist', (s.antilinkWhitelist || []).filter(d => d !== clean));
    return clean;
};


const _UP_DEFAULT = () => ({ koin: 0, exp: 0, lastDaily: 0, name: '' });

/** Baca seluruh user profile DB → { [jid]: profile } */
const loadUDB = () => {
    if (_sqliteOK) {
        try {
            const rows = DB.prepare('SELECT jid, name, exp, koin, last_daily FROM user_profile').all();
            const out = {};
            for (const r of rows) {
                out[r.jid] = { name: r.name, exp: r.exp, koin: r.koin, lastDaily: r.last_daily };
            }
            return out;
        } catch {}
    }
    return _jRead(JSON_PATHS.userprofile, {});
};

/** Simpan seluruh user profile DB */
const saveUDB = (data) => {
    if (_sqliteOK) {
        try {
            const tx = DB.transaction(() => {
                const ups = DB.prepare('INSERT OR REPLACE INTO user_profile(jid,name,exp,koin,last_daily) VALUES(?,?,?,?,?)');
                for (const [jid, u] of Object.entries(data))
                    ups.run(jid, u.name||'', u.exp||0, u.koin||0, u.lastDaily||0);
            });
            tx();
        } catch {}
    }
    _jWrite(JSON_PATHS.userprofile, data);
};

/** Baca satu user, buat jika belum ada */
const getUser = (jid) => {
    if (_sqliteOK) {
        try {
            let row = DB.prepare('SELECT jid, name, exp, koin, last_daily FROM user_profile WHERE jid = ?').get(jid);
            if (!row) {
                DB.prepare('INSERT OR IGNORE INTO user_profile(jid,name,exp,koin,last_daily) VALUES(?,?,?,?,?)').run(jid,'',0,0,0);
                row = { jid, name:'', exp:0, koin:0, last_daily:0 };
            }
            const user = { name: row.name, exp: row.exp, koin: row.koin, lastDaily: row.last_daily };
            // Kembalikan format persis sama dengan _getUsr lama: { db, user }
            return { db: null, user };
        } catch {}
    }
    // JSON fallback
    const db = loadUDB();
    if (!db[jid]) db[jid] = _UP_DEFAULT();
    return { db, user: db[jid] };
};

/** Simpan satu user */
const saveUser = (jid, u, db) => {
    if (_sqliteOK) {
        try {
            DB.prepare('INSERT OR REPLACE INTO user_profile(jid,name,exp,koin,last_daily) VALUES(?,?,?,?,?)')
              .run(jid, u.name||'', u.exp||0, u.koin||0, u.lastDaily||0);
            // JSON sync
            const fullDB = loadUDB();
            fullDB[jid] = u;
            _jWrite(JSON_PATHS.userprofile, fullDB);
            return;
        } catch {}
    }
    // JSON fallback
    if (db) { db[jid] = u; saveUDB(db); }
    else { const d = loadUDB(); d[jid] = u; saveUDB(d); }
};

const loadStats = () => {
    if (_sqliteOK) {
        try {
            const out = {};

            // members + names
            for (const r of DB.prepare('SELECT group_id, jid, name, count FROM gs_members').all()) {
                if (!out[r.group_id]) out[r.group_id] = { members:{}, hourly:{}, daily:{}, lastSeen:{}, names:{} };
                out[r.group_id].members[r.jid] = r.count;
                if (r.name) out[r.group_id].names[r.jid] = r.name;
            }

            // daily
            for (const r of DB.prepare('SELECT group_id, date, count FROM gs_daily').all()) {
                if (!out[r.group_id]) out[r.group_id] = { members:{}, hourly:{}, daily:{}, lastSeen:{}, names:{} };
                out[r.group_id].daily[r.date] = r.count;
            }

            // hourly
            for (const r of DB.prepare('SELECT group_id, date, hour, count FROM gs_hourly').all()) {
                if (!out[r.group_id]) out[r.group_id] = { members:{}, hourly:{}, daily:{}, lastSeen:{}, names:{} };
                if (!out[r.group_id].hourly[r.date]) out[r.group_id].hourly[r.date] = Array(24).fill(0);
                out[r.group_id].hourly[r.date][r.hour] = r.count;
            }

            // lastseen
            for (const r of DB.prepare('SELECT group_id, jid, ts FROM gs_lastseen').all()) {
                if (!out[r.group_id]) out[r.group_id] = { members:{}, hourly:{}, daily:{}, lastSeen:{}, names:{} };
                out[r.group_id].lastSeen[r.jid] = r.ts;
            }

            return out;
        } catch {}
    }
    return _jRead(JSON_PATHS.grupstats, {});
};

/**
 * saveStats(data) — tulis kembali full stats object ke SQLite + JSON.
 * Dipakai untuk bulk update; operasi pesan individual pakai trackGrupMsg.
 */
const saveStats = (data) => {
    if (_sqliteOK) {
        try {
            const tx = DB.transaction(() => {
                const insMem  = DB.prepare('INSERT OR REPLACE INTO gs_members(group_id,jid,name,count) VALUES(?,?,?,?)');
                const insDay  = DB.prepare('INSERT OR REPLACE INTO gs_daily(group_id,date,count) VALUES(?,?,?)');
                const insHour = DB.prepare('INSERT OR REPLACE INTO gs_hourly(group_id,date,hour,count) VALUES(?,?,?,?)');
                const insLS   = DB.prepare('INSERT OR REPLACE INTO gs_lastseen(group_id,jid,ts) VALUES(?,?,?)');
                for (const [gid, g] of Object.entries(data)) {
                    const names = g.names || {};
                    for (const [jid, cnt] of Object.entries(g.members || {})) insMem.run(gid, jid, names[jid]||'', cnt);
                    for (const [date, cnt] of Object.entries(g.daily  || {})) insDay.run(gid, date, cnt);
                    for (const [date, hrs]  of Object.entries(g.hourly || {}))
                        if (Array.isArray(hrs)) hrs.forEach((cnt, h) => { if (cnt) insHour.run(gid, date, h, cnt); });
                    for (const [jid, ts]   of Object.entries(g.lastSeen || {})) insLS.run(gid, jid, ts);
                }
            });
            tx();
        } catch {}
    }
    _jWrite(JSON_PATHS.grupstats, data);
};

/**
 * trackGrupMsg — hot path, langsung upsert ke SQLite (tanpa load seluruh DB).
 * Ini yang menghilangkan race condition di sistem JSON lama.
 */
const trackGrupMsg = (groupId, senderJid, senderName, day, hour) => {
    if (_sqliteOK) {
        try {
            DB.transaction(() => {
                DB.prepare(`
                    INSERT INTO gs_members(group_id,jid,name,count) VALUES(?,?,?,1)
                    ON CONFLICT(group_id,jid) DO UPDATE SET count = count+1, name = CASE WHEN excluded.name != '' THEN excluded.name ELSE name END
                `).run(groupId, senderJid, (senderName && senderName !== 'No Name') ? senderName : '');

                DB.prepare(`
                    INSERT INTO gs_daily(group_id,date,count) VALUES(?,?,1)
                    ON CONFLICT(group_id,date) DO UPDATE SET count = count+1
                `).run(groupId, day);

                DB.prepare(`
                    INSERT INTO gs_hourly(group_id,date,hour,count) VALUES(?,?,?,1)
                    ON CONFLICT(group_id,date,hour) DO UPDATE SET count = count+1
                `).run(groupId, day, hour);

                DB.prepare(`
                    INSERT INTO gs_lastseen(group_id,jid,ts) VALUES(?,?,?)
                    ON CONFLICT(group_id,jid) DO UPDATE SET ts = excluded.ts
                `).run(groupId, senderJid, Date.now());
            })();
            return; // SQLite berhasil, tidak perlu JSON
        } catch {}
    }
    // JSON fallback — perilaku sama seperti sebelumnya
    try {
        const db = _jRead(JSON_PATHS.grupstats, {});
        if (!db[groupId]) db[groupId] = { members:{}, hourly:{}, daily:{}, lastSeen:{}, names:{} };
        const g = db[groupId];
        if (!g.names) g.names = {};
        if (!g.members[senderJid]) g.members[senderJid] = 0;
        g.members[senderJid]++;
        if (senderName && senderName !== 'No Name') g.names[senderJid] = senderName;
        g.lastSeen[senderJid] = Date.now();
        if (!g.hourly[day]) g.hourly[day] = Array(24).fill(0);
        g.hourly[day][hour]++;
        if (!g.daily[day]) g.daily[day] = 0;
        g.daily[day]++;
        _jWrite(JSON_PATHS.grupstats, db);
    } catch {}
};


const loadSewa = () => {
    if (_sqliteOK) {
        try {
            const rows = DB.prepare('SELECT group_id, paket, expiry, lifetime, notif_sent, added_by FROM sewa').all();
            const out = {};
            for (const r of rows) {
                out[r.group_id] = {
                    paket      : r.paket,
                    expiry     : r.expiry,
                    lifetime   : r.lifetime === 1,
                    notifSent  : r.notif_sent === 1,
                    addedBy    : r.added_by,
                };
            }
            return out;
        } catch {}
    }
    return _jRead(JSON_PATHS.sewa, {});
};

const saveSewa = (data) => {
    if (_sqliteOK) {
        try {
            const tx = DB.transaction(() => {
                DB.prepare('DELETE FROM sewa').run();
                const ins = DB.prepare('INSERT INTO sewa(group_id,paket,expiry,lifetime,notif_sent,added_by) VALUES(?,?,?,?,?,?)');
                for (const [gid, r] of Object.entries(data))
                    ins.run(gid, r.paket||'basic', r.expiry||null, r.lifetime?1:0, r.notifSent?1:0, r.addedBy||'');
            });
            tx();
        } catch {}
    }
    _jWrite(JSON_PATHS.sewa, data);
};


const saveInvoice = (data) => {
    // data = { [groupId]: [invoice, ...] }
    if (_sqliteOK) {
        try {
            const tx = DB.transaction(() => {
                const ins = DB.prepare(`INSERT OR REPLACE INTO invoices
                    (id,group_id,group_name,paket,paket_label,harga,days,is_lifetime,
                     created_at,expiry,added_by,status,nama_bot,nama_owner,owner_num,reminders_sent)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
                for (const list of Object.values(data)) {
                    for (const i of (Array.isArray(list) ? list : [])) {
                        ins.run(i.id, i.groupId, i.groupName||'', i.paket||'basic', i.paketLabel||'Basic',
                            i.harga||0, i.days||0, i.isLifetime?1:0, i.createdAt||Date.now(),
                            i.expiry||null, i.addedBy||'', i.status||'active',
                            i.namaBot||'', i.namaOwner||'', i.ownerNum||'',
                            JSON.stringify(i.remindersSent||[]));
                    }
                }
            });
            tx();
        } catch {}
    }
    _jWrite(JSON_PATHS.invoices, data);
};

const loadInvoice = () => {
    if (_sqliteOK) {
        try {
            const rows = DB.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all();
            const out = {};
            for (const r of rows) {
                const inv = {
                    id: r.id, groupId: r.group_id, groupName: r.group_name,
                    paket: r.paket, paketLabel: r.paket_label, harga: r.harga,
                    days: r.days, isLifetime: r.is_lifetime === 1,
                    createdAt: r.created_at, expiry: r.expiry,
                    addedBy: r.added_by, status: r.status,
                    namaBot: r.nama_bot, namaOwner: r.nama_owner, ownerNum: r.owner_num,
                    remindersSent: JSON.parse(r.reminders_sent || '[]'),
                };
                if (!out[r.group_id]) out[r.group_id] = [];
                out[r.group_id].push(inv);
            }
            return out;
        } catch {}
    }
    return _jRead(JSON_PATHS.invoices, {});
};

const addInvoice = (invoice) => {
    if (_sqliteOK) {
        try {
            DB.prepare(`INSERT OR REPLACE INTO invoices
                (id,group_id,group_name,paket,paket_label,harga,days,is_lifetime,
                 created_at,expiry,added_by,status,nama_bot,nama_owner,owner_num,reminders_sent)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(invoice.id, invoice.groupId, invoice.groupName||'', invoice.paket||'basic',
                   invoice.paketLabel||'Basic', invoice.harga||0, invoice.days||0,
                   invoice.isLifetime?1:0, invoice.createdAt||Date.now(), invoice.expiry||null,
                   invoice.addedBy||'', invoice.status||'active',
                   invoice.namaBot||'', invoice.namaOwner||'', invoice.ownerNum||'',
                   JSON.stringify(invoice.remindersSent||[]));
            // JSON sync
            const db = loadInvoice();
            if (!db[invoice.groupId]) db[invoice.groupId] = [];
            db[invoice.groupId].push(invoice);
            _jWrite(JSON_PATHS.invoices, db);
            return;
        } catch {}
    }
    // JSON fallback
    const db = loadInvoice();
    if (!db[invoice.groupId]) db[invoice.groupId] = [];
    db[invoice.groupId].push(invoice);
    _jWrite(JSON_PATHS.invoices, db);
};

const updateInvoiceStatus = (groupId, newStatus) => {
    if (_sqliteOK) {
        try {
            DB.prepare(`UPDATE invoices SET status = ? WHERE group_id = ? AND status = 'active' AND is_lifetime = 0 AND expiry IS NOT NULL AND expiry < ?`)
              .run(newStatus, groupId, Date.now());
        } catch {}
    }
    // JSON sync
    const db = loadInvoice();
    if (db[groupId]) {
        db[groupId] = db[groupId].map(i =>
            i.status === 'active' && !i.isLifetime && i.expiry && i.expiry < Date.now()
                ? { ...i, status: newStatus } : i
        );
        _jWrite(JSON_PATHS.invoices, db);
    }
};


const loadReminder = () => {
    if (_sqliteOK) {
        try {
            const rows = DB.prepare('SELECT group_id, sent FROM sewa_reminders').all();
            const out = {};
            for (const r of rows) out[r.group_id] = { sent: JSON.parse(r.sent || '[]') };
            return out;
        } catch {}
    }
    return _jRead(JSON_PATHS.sewa_reminder, {});
};

const saveReminder = (data) => {
    if (_sqliteOK) {
        try {
            const tx = DB.transaction(() => {
                const ins = DB.prepare('INSERT OR REPLACE INTO sewa_reminders(group_id,sent) VALUES(?,?)');
                for (const [gid, v] of Object.entries(data))
                    ins.run(gid, JSON.stringify(v.sent||[]));
            });
            tx();
        } catch {}
    }
    _jWrite(JSON_PATHS.sewa_reminder, data);
};

const loadAdzan = () => {
    if (_sqliteOK) {
        try {
            const rows = DB.prepare('SELECT group_id, kota, aktif FROM adzan').all();
            const out = {};
            for (const r of rows) out[r.group_id] = { kota: r.kota, aktif: r.aktif === 1 };
            return out;
        } catch {}
    }
    return _jRead(JSON_PATHS.adzan, {});
};

const saveAdzan = (data) => {
    if (_sqliteOK) {
        try {
            const tx = DB.transaction(() => {
                DB.prepare('DELETE FROM adzan').run();
                const ins = DB.prepare('INSERT INTO adzan(group_id,kota,aktif) VALUES(?,?,?)');
                for (const [gid, r] of Object.entries(data))
                    ins.run(gid, r.kota||'', r.aktif===false?0:1);
            });
            tx();
        } catch {}
    }
    _jWrite(JSON_PATHS.adzan, data);
};

//

module.exports = {
    DB, isSQLite: () => _sqliteOK,
    loadList, saveList,
    gsLoadAll, gsSaveAll,
    gsGet, gsSet, gsKey,
    gsAddWarn, gsResetWarn, gsResetAllWarn,
    gsMute, gsUnmute,
    gsAddWL, gsRemWL,
    GS_DEFAULT: _GS_DEFAULT,
    loadUDB, saveUDB, getUser, saveUser,
    loadStats, saveStats, trackGrupMsg,
    loadSewa, saveSewa,
    loadInvoice, saveInvoice, addInvoice, updateInvoiceStatus,
    loadReminder, saveReminder,
    loadAdzan, saveAdzan,
};

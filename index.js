require('./settings');
const _L = require('./lib/logger');
_L.update({ botName: global.namaBot || 'Ender Verstappen', owner: global.namaowner || 'Chaidar' });


const { 
    default: makeWASocket, 
    prepareWAMessageMedia, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore, 
    generateWAMessageFromContent, 
    generateWAMessageContent, 
    generateWAMessage,
    jidDecode, 
    proto, 
    delay,
    relayWAMessage, 
    getContentType, 
    getAggregateVotesInPollMessage, 
    downloadContentFromMessage, 
    fetchLatestWaWebVersion, 
    InteractiveMessage, 
    makeCacheableSignalKeyStore, 
    Browsers, 
    generateForwardMessageContent, 
    MessageRetryMap 
} = require("@whiskeysockets/baileys");

const cfonts = require('cfonts');
const pino = require('pino');
const path = require("path");
const FileType = require('file-type');
const readline = require("readline");
const fs = require('fs');
const crypto = require("crypto")
const colors = require('colors')
const chalk = require('chalk')
const PhoneNumber = require('awesome-phonenumber');

const {
    Boom 
} = require('@hapi/boom');

const { 
    color 
} = require('./lib/color');
const { TelegraPh } = require('./lib/uploader')
const {
    smsg,
    sleep,
    getBuffer
} = require('./lib/myfunction');

const { 
    imageToWebp,
    videoToWebp,
    writeExifImg,
    writeExifVid,
    addExif
} = require('./lib/exif');

const { createWelcomeCard, createGoodbyeCard } = require('./lib/canvas/welcomeCard');

// ── Watcher Showroom (di-port dari index.js) ──
let watcherShowroom = null;
try {
    ({ watcherShowroom } = require('./lib/showroomWatcher'));
} catch (e) {
    console.warn('[ShowroomWatcher] lib/showroomWatcher.js tidak ditemukan:', e.message);
}
// Watcher Showroom dinonaktifkan
const showroomGroupChats = [];
let isWatchingShowroom = false;
let showroomIntervalId = null;

const _DBidx = require('./lib/db');
function gsGet(gid) { return _DBidx.gsGet(gid); }
function gsKey(gid, key, val) { return _DBidx.gsKey(gid, key, val); }

// ── GLOBAL NUMBER BLACKLIST SYSTEM (SILENT AUTO-KICK) ──
const _BL_FILE_PATH = './database/blacklist.json';
const _BL_DEFAULTS = ['628217629599', '6285643588007'];
if (!global._SILENT_KICKED_JIDS) global._SILENT_KICKED_JIDS = new Set();

global.normalizeBlNumber = function(raw) {
    if (!raw) return '';
    let str = typeof raw === 'object' ? (raw.phoneNumber || raw.jid || raw.id || '') : String(raw);
    str = str.split('@')[0].split(':')[0];
    let clean = str.replace(/[^0-9]/g, '');
    if (clean.startsWith('08')) clean = '62' + clean.slice(1);
    else if (clean.startsWith('8')) clean = '62' + clean;
    return clean;
};

global.getBlacklist = function() {
    let list = [];
    try {
        if (fs.existsSync(_BL_FILE_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(_BL_FILE_PATH, 'utf8'));
            if (Array.isArray(parsed)) list = parsed.map(n => global.normalizeBlNumber(n)).filter(Boolean);
        }
    } catch {}
    let changed = false;
    for (const def of _BL_DEFAULTS) {
        if (!list.includes(def)) {
            if (!fs.existsSync(_BL_FILE_PATH)) {
                list.push(def);
                changed = true;
            }
        }
    }
    const unique = [...new Set(list)];
    if (changed) {
        try {
            fs.mkdirSync(path.dirname(_BL_FILE_PATH), { recursive: true });
            fs.writeFileSync(_BL_FILE_PATH, JSON.stringify(unique, null, 2));
        } catch {}
    }
    return unique;
};
// Initialize blacklist file on load
global.getBlacklist();

global.addBlacklist = function(rawInput) {
    const clean = global.normalizeBlNumber(rawInput);
    if (!clean || clean.length < 7) return { ok: false, number: clean, list: global.getBlacklist() };
    const list = global.getBlacklist();
    if (list.includes(clean)) return { ok: true, already: true, number: clean, list };
    list.push(clean);
    try {
        fs.mkdirSync(path.dirname(_BL_FILE_PATH), { recursive: true });
        fs.writeFileSync(_BL_FILE_PATH, JSON.stringify(list, null, 2));
    } catch {}
    return { ok: true, already: false, number: clean, list };
};

global.removeBlacklist = function(rawInput) {
    const clean = global.normalizeBlNumber(rawInput);
    const list = global.getBlacklist();
    if (!clean || !list.includes(clean)) return { ok: false, number: clean, list };
    const updated = list.filter(n => n !== clean);
    try {
        fs.mkdirSync(path.dirname(_BL_FILE_PATH), { recursive: true });
        fs.writeFileSync(_BL_FILE_PATH, JSON.stringify(updated, null, 2));
    } catch {}
    return { ok: true, number: clean, list: updated };
};

global.isBlacklistedParticipant = function(participantOrJid, groupParticipants = []) {
    const bl = global.getBlacklist();
    if (!bl.length) return false;
    const candidates = new Set();

    if (typeof participantOrJid === 'string') {
        candidates.add(global.normalizeBlNumber(participantOrJid));
        if (Array.isArray(groupParticipants)) {
            const found = groupParticipants.find(p =>
                p && (p.id === participantOrJid || p.jid === participantOrJid || p.lid === participantOrJid || p.phoneNumber === participantOrJid)
            );
            if (found) {
                if (found.id) candidates.add(global.normalizeBlNumber(found.id));
                if (found.jid) candidates.add(global.normalizeBlNumber(found.jid));
                if (found.phoneNumber) candidates.add(global.normalizeBlNumber(found.phoneNumber));
                if (found.full) {
                    if (found.full.id) candidates.add(global.normalizeBlNumber(found.full.id));
                    if (found.full.jid) candidates.add(global.normalizeBlNumber(found.full.jid));
                    if (found.full.phoneNumber) candidates.add(global.normalizeBlNumber(found.full.phoneNumber));
                }
            }
        }
    } else if (participantOrJid && typeof participantOrJid === 'object') {
        if (participantOrJid.id) candidates.add(global.normalizeBlNumber(participantOrJid.id));
        if (participantOrJid.jid) candidates.add(global.normalizeBlNumber(participantOrJid.jid));
        if (participantOrJid.phoneNumber) candidates.add(global.normalizeBlNumber(participantOrJid.phoneNumber));
        if (participantOrJid.full) {
            if (participantOrJid.full.id) candidates.add(global.normalizeBlNumber(participantOrJid.full.id));
            if (participantOrJid.full.jid) candidates.add(global.normalizeBlNumber(participantOrJid.full.jid));
            if (participantOrJid.full.phoneNumber) candidates.add(global.normalizeBlNumber(participantOrJid.full.phoneNumber));
        }
    }

    for (const num of candidates) {
        if (num && bl.includes(num)) return true;
    }
    return false;
};

global.sweepAllGroupsForBlacklist = async function(sock) {
    if (!sock || typeof sock.groupFetchAllParticipating !== 'function') return 0;
    const bl = global.getBlacklist();
    if (!bl.length) return 0;
    let kickedCount = 0;
    try {
        const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
        const botJid = sock.decodeJid ? sock.decodeJid(sock.user?.id || '') : (sock.user?.id || '');
        const botNum = global.normalizeBlNumber(botJid);
        for (const [gid, meta] of Object.entries(groups || {})) {
            if (!meta || !Array.isArray(meta.participants)) continue;
            const toKick = [];
            for (const p of meta.participants) {
                const pJid = p.id || p.jid;
                if (!pJid) continue;
                if (global.normalizeBlNumber(pJid) === botNum) continue;
                if (global.isBlacklistedParticipant(p, meta.participants)) {
                    toKick.push(pJid);
                }
            }
            if (toKick.length > 0) {
                for (const kJid of toKick) {
                    global._SILENT_KICKED_JIDS.add(kJid);
                    setTimeout(() => global._SILENT_KICKED_JIDS.delete(kJid), 30000);
                }
                try {
                    await sock.groupParticipantsUpdate(gid, toKick, 'remove');
                    kickedCount += toKick.length;
                    if (global._GM_CACHE) global._GM_CACHE.delete(gid);
                } catch {}
            }
        }
    } catch {}
    return kickedCount;
};

let _AB = null;
try {
    _AB = require('./lib/system/antibanSession');
    global._AB = _AB;
    console.log('[AntiBan] ✅ Anti-ban session system v3.0 loaded');
} catch (e) {
    console.warn('[AntiBan] ⚠️ lib/antibanSession.js tidak ditemukan:', e.message);
}

let _RL = null, _HM = null, _SessBackup = null, _BotCfg = null;
try { _RL         = require('./lib/system/rateLimiter');   global._RL = _RL; } catch(e) { console.warn('[RateLimiter] file tidak ditemukan:', e.message); }
try { _HM         = require('./lib/system/healthMonitor'); } catch(e) { console.warn('[HealthMonitor] file tidak ditemukan:', e.message); }
try { _SessBackup = require('./lib/system/sessionBackup'); } catch(e) { console.warn('[SessionBackup] file tidak ditemukan:', e.message); }
try { _BotCfg     = require('./lib/system/botConfig');     global._BotCfg = _BotCfg; } catch(e) { console.warn('[BotConfig] file tidak ditemukan:', e.message); } 
const usePairingCode = true;

const question = (text, timeoutMs = 8000) => {
    return new Promise((resolve) => {
        let done = false;
        global._IN_QUESTION = true;
        process.stdout.write(text);
        const onData = (chunk) => {
            if (done) return;
            const str = String(chunk || '').trim();
            if (!str && !String(chunk || '').includes('\n')) return;
            done = true;
            global._IN_QUESTION = false;
            if (timer) clearTimeout(timer);
            process.stdin.removeListener('data', onData);
            resolve(str);
        };
        const timer = timeoutMs > 0 ? setTimeout(() => {
            if (done) return;
            done = true;
            global._IN_QUESTION = false;
            process.stdin.removeListener('data', onData);
            const fallback = String(global.nobot || '').replace(/[^0-9]/g, '');
            if (fallback) process.stdout.write(`${fallback} (auto dari settings.js)\n`);
            resolve(fallback);
        }, timeoutMs) : null;
        process.stdin.resume();
        process.stdin.on('data', onData);
    });
};

if (!global._STDIN_PAIR_LISTENER) {
    global._STDIN_PAIR_LISTENER = true;
    process.stdin.resume();
    process.stdin.on('data', (chunk) => {
        if (global._IN_QUESTION) return;
        const inputNum = String(chunk || '').trim().replace(/[^0-9]/g, '');
        if (inputNum.length >= 10 && inputNum.length <= 15) {
            global._CACHED_PAIR_PHONE = inputNum;
            if (typeof global._FORCE_REPAIR === 'function') {
                global._FORCE_REPAIR(inputNum);
            }
        }
    });
}

const { startWebServer, maskPhone, normalizePhone } = require('./lib/webServer');
if (!global._WEB_START_TIME) global._WEB_START_TIME = Date.now();
if (!global._WEB_TOTAL_CMDS) global._WEB_TOTAL_CMDS = 0;
if (!global._WEB_LIVE_FEED) global._WEB_LIVE_FEED = [];
if (!global._BOT_SESSIONS) global._BOT_SESSIONS = new Map();

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })
_L.printBanner();
async function Starts(opts = {}) {
    const isMain = !opts.sessionDir || opts.sessionDir === './session';
    const sessionDir = opts.sessionDir || './session';
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    if (!state.creds.registered && !state.creds.account) {
        state.creds.me = undefined;
        state.creds.pairingCode = undefined;
    }

    let cleanPhone = normalizePhone(opts.phone || (isMain ? (global._CACHED_PAIR_PHONE || state.creds?.me?.id?.split(':')[0]?.split('@')[0] || '') : path.basename(sessionDir)));
    if (isMain && usePairingCode && !state.creds.registered && !state.creds.account) {
        if (!cleanPhone) {
            const rawAns = await question(`\n\x1b[38;5;135m┌── PAIRING SETUP ───────────────────────────┐\x1b[0m\n\x1b[38;5;135m│\x1b[0m Masukkan nomor WhatsApp bot (contoh: 628xx)\n\x1b[38;5;135m└────────────────────────────────────────────┘\x1b[0m\n➜ Nomor : `);
            cleanPhone = normalizePhone(rawAns) || normalizePhone(global.nobot || '');
            if (cleanPhone) global._CACHED_PAIR_PHONE = cleanPhone;
        }
    }
    if (!cleanPhone && isMain) cleanPhone = normalizePhone(global.nobot || '');

    const existingMeta = global._BOT_SESSIONS.get(cleanPhone) || {};
    const sessMeta = {
        phone: cleanPhone || 'main',
        isMain,
        sessionDir,
        status: (state.creds.registered || state.creds.account) ? 'CONNECTING' : 'PAIRING',
        pairingCode: existingMeta.pairingCode || '',
        customCode: opts.customCode || existingMeta.customCode || '',
        createdAt: existingMeta.createdAt || Date.now(),
        connectedAt: existingMeta.connectedAt || null,
        cmdCount: existingMeta.cmdCount || 0,
        publicMode: typeof existingMeta.publicMode === 'boolean' ? existingMeta.publicMode : true,
        sock: null
    };
    if (cleanPhone) global._BOT_SESSIONS.set(cleanPhone, sessMeta);

    const Cantarella = makeWASocket({
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true, 
        version: await (async () => {
            try {
                const _ctrl = new AbortController();
                const _tid  = setTimeout(() => _ctrl.abort(), 8000);
                const _res  = await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json', { signal: _ctrl.signal });
                clearTimeout(_tid);
                return (await _res.json()).version;
            } catch {
                const { version: _fbv } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1023000000] }));
                return _fbv;
            }
        })(),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        logger: pino({
            level: 'silent'
        }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return proto.Message.fromObject({});
        }
    });

    Cantarella.ev.on('creds.update', saveCreds);
    sessMeta.sock = Cantarella;

    if (_AB && isMain) {
        // Simpan JID bot untuk referensi warmup & monitoring
        // Inisialisasi dilakukan saat connection 'open' agar Cantarella.user sudah tersedia
        global._AB_SOCK = Cantarella;
    }

    let _pairRequested = false;
    const _triggerPairing = async (overridePhone) => {
        if (overridePhone) {
            cleanPhone = normalizePhone(overridePhone);
            sessMeta.phone = cleanPhone;
            global._BOT_SESSIONS.set(cleanPhone, sessMeta);
            _pairRequested = false;
        }
        if (_pairRequested || !usePairingCode || Cantarella.authState.creds.registered || Cantarella.authState.creds.account || !cleanPhone) return;
        _pairRequested = true;
        try {
            const rawCustom = String(sessMeta.customCode || global.pairingCode || 'ENDERDEV').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            const customPairing = rawCustom.length === 8 ? rawCustom : 'ENDERDEV';
            const code = await Cantarella.requestPairingCode(cleanPhone, customPairing);
            await saveCreds();
            sessMeta.pairingCode = code;
            sessMeta.status = 'PAIRING';
            if (isMain && _BotCfg) { _BotCfg.setMainNumber(cleanPhone); _BotCfg.recordPairRequest(); }
            _L.setPairingPhone(cleanPhone);
            _L.setPairingCode(code);
            if (typeof opts.onPairingCode === 'function') {
                try { opts.onPairingCode(code); } catch {}
            }
        } catch (pairErr) {
            _pairRequested = false;
            console.error('[Pairing] Gagal request kode pairing:', pairErr?.message || pairErr);
            if (typeof opts.onPairingError === 'function') {
                try { opts.onPairingError(pairErr); } catch {}
            }
        }
    };
    if (isMain) {
        global._FORCE_REPAIR = (newPhone) => {
            if (!Cantarella.authState.creds.registered) {
                _triggerPairing(newPhone);
            }
        };
    }

    store.bind(Cantarella.ev);

    Cantarella.ev.on("messages.upsert", async (chatUpdate, msg) => {
        try {
            const mek = chatUpdate.messages[0]
            if (!mek.message) return
            const _rlSender = (mek.key.participant || mek.key.remoteJid || '').split('@')[0];
            const _rlIsOwner = (Array.isArray(global.owner) ? global.owner : [String(global.owner || '')]).map(n => n.replace(/[^0-9]/g,'')).includes(_rlSender);
            if (!_rlIsOwner && global._RL && mek.key && !mek.key.fromMe) {
                const _rlCmd = (() => { try { const _b = (mek.message?.conversation || mek.message?.extendedTextMessage?.text || '').trim(); if (_b && global.prefix) { const _pfx = Array.isArray(global.prefix) ? global.prefix : [String(global.prefix)]; const _p = _pfx.find(p => _b.startsWith(p)); if (_p) return _b.slice(_p.length).trim().split(/\s+/)[0].toLowerCase(); } } catch {} return ''; })();
                if (_rlCmd) {
                    const _rlRes = global._RL.checkRateLimit((mek.key.participant || mek.key.remoteJid || ''), _rlCmd, false);
                    if (_rlRes.blocked) return;
                }
            }
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                if (!mek.key.fromMe) {
                    try { await Cantarella.autoReadSW(mek); } catch (e) { console.error('[AutoReadSW]', e.message); }
                    try { await Cantarella.autoReactSW(mek); } catch (e) { console.error('[AutoReactSW]', e.message); }
                }
                return
            }
            if (!Cantarella.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                const _ownerList = (Array.isArray(global.owner) ? global.owner : [String(global.owner || '')])
                    .map(n => n.replace(/[^0-9]/g, ''));
                if (cleanPhone) _ownerList.push(cleanPhone);
                const _rawSender = (mek.key.participant || mek.key.remoteJid || '')
                    .split('@')[0].split(':')[0];
                const _hasMention = !!(
                    mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length ||
                    mek.message?.conversation?.includes('@') ||
                    mek.message?.extendedTextMessage?.text?.includes('@')
                );
                if (!_ownerList.includes(_rawSender) && !_hasMention) return;
            }
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return
            if (mek.key.id.startsWith('CantarellaHaxor_') || mek.key.id.startsWith('EnderVerstappen_')) return;
            try {
                const _txtBody = (
                    mek.message?.conversation ||
                    mek.message?.extendedTextMessage?.text ||
                    mek.message?.imageMessage?.caption ||
                    mek.message?.videoMessage?.caption || ''
                ).trim();
                const _pfxs = Array.isArray(global.prefix) ? global.prefix : [String(global.prefix || '.')];
                const _matchedPfx = _pfxs.find(p => _txtBody.startsWith(p));
                if (_matchedPfx) {
                    const _cName = _txtBody.slice(_matchedPfx.length).trim().split(/\s+/)[0].toLowerCase();
                    if (_cName && _cName.length <= 28) {
                        sessMeta.cmdCount = (sessMeta.cmdCount || 0) + 1;
                        global._WEB_TOTAL_CMDS = (global._WEB_TOTAL_CMDS || 0) + 1;
                        const _now = new Date();
                        const _tStr = [String(_now.getHours()).padStart(2,'0'), String(_now.getMinutes()).padStart(2,'0'), String(_now.getSeconds()).padStart(2,'0')].join(':');
                        const _sNum = (mek.key.participant || mek.key.remoteJid || '').split('@')[0].split(':')[0];
                        global._WEB_LIVE_FEED.unshift({
                            time: _tStr,
                            maskedSender: maskPhone(_sNum),
                            cmd: _cName,
                            chatType: (mek.key.remoteJid || '').endsWith('@g.us') ? 'Grup Chat' : 'Private Chat'
                        });
                        if (global._WEB_LIVE_FEED.length > 40) global._WEB_LIVE_FEED.length = 40;
                    }
                }
            } catch {}
            const m = smsg(Cantarella, mek, store)
            require("./Cantarella")(Cantarella, m, chatUpdate, store)
        } catch (err) {
            console.log(err)
        }
    });

    Cantarella.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        } else return jid;
    };


const _GM_IMGS = {
    promote:        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f389.png',
    demote:         'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4c9.png',
    add:            'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f91d.png',
    kick:           'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f6aa.png',
    closegroup:     'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f512.png',
    opengroup:      'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f513.png',
    locksettings:   'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f510.png',
    unlocksettings: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f5dd.png',
    setdesc:        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4dd.png',
    setname:        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3f7.png',
    lockadd:        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f6e1.png',
    unlockadd:      'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f465.png',
    joinapproval:   'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4cb.png',
    joinopen:       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4c4.png',
    ban:            'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f6ab.png',
};

const _GM_SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const _gmGetName = async (sock, jid) => {
    try {
        const num  = jid.split('@')[0];
        const info = await sock.onWhatsApp(jid).catch(() => null);
        const name = info?.[0]?.pushname || info?.[0]?.name || num;
        return { name, num };
    } catch {
        const num = jid.split('@')[0];
        return { name: num, num };
    }
};

// fakeQuoted statis — persis seperti di Cantarella.js tapi tanpa ketergantungan m
const _GM_FAKE_QUOTED = {
    key: {
        fromMe:      false,
        participant: '0@s.whatsapp.net',
        remoteJid:   'status@broadcast'
    },
    message: {
        productMessage: {
            product: {
                productImage:      { mimetype: 'image/jpeg', jpegThumbnail: '' },
                title:             `${global.namaBot || 'Ender Verstappen'} MultiDevice`,
                description:       null,
                currencyCode:      'IDR',
                priceAmount1000:   `${global.namaBot || 'Ender Verstappen'}`,
                retailerId:        `Powered ${global.namaBot || 'Ender Verstappen'}`,
                productImageCount: 1
            },
            businessOwnerJid: `${(global.nomorowner || '62895327468806').replace(/[^0-9]/g, '')}@s.whatsapp.net`
        }
    }
};

// Kirim notif grup dengan visual card (format identik reply() Cantarella.js)
const _gmCard = async (sock, gid, imgKey, cardTitle, cardBody, msgText, mentions = []) => {
    try {
        await _GM_SLEEP(1500);
        const imgUrl = _GM_IMGS[imgKey] || global.thumnail2 || '';

        let thumbBuf = null;
        if (typeof imgUrl === 'string' && fs.existsSync(imgUrl)) {
            try { thumbBuf = fs.readFileSync(imgUrl); } catch {}
        }
        if (!thumbBuf && typeof imgUrl === 'string' && /^https?:\/\//i.test(imgUrl)) {
            try {
                const _axios = require('axios');
                const _res   = await _axios.get(imgUrl, {
                    responseType: 'arraybuffer',
                    timeout:      6000,
                    headers:      { 'User-Agent': 'WhatsApp/2.24.6.77 A' }
                });
                thumbBuf = Buffer.from(_res.data);
            } catch (_fe) {
                // fallback: coba global.thumnail2 jika imgUrl gagal
                try {
                    if (global.thumnail2 && global.thumnail2 !== imgUrl) {
                        if (fs.existsSync(global.thumnail2)) {
                            thumbBuf = fs.readFileSync(global.thumnail2);
                        } else if (/^https?:\/\//i.test(global.thumnail2)) {
                            const _axios2 = require('axios');
                            const _res2   = await _axios2.get(global.thumnail2, {
                                responseType: 'arraybuffer',
                                timeout:      5000
                            });
                            thumbBuf = Buffer.from(_res2.data);
                        }
                    }
                } catch {}
            }
        }

        await sock.sendMessage(gid, {
            text: msgText,
            mentions,
            contextInfo: {
                mentionedJid:    mentions,
                isForwarded:     true,
                forwardingScore: 999,
                externalAdReply: {
                    title:                 cardTitle,
                    body:                  cardBody,
                    mediaType:             1,
                    previewType:           0,
                    renderLargerThumbnail: false,
                    showAdAttribution:     false,
                    // thumbnail (Buffer) = selalu muncul, tidak bergantung fetch WA
                    ...(thumbBuf ? { thumbnail: thumbBuf } : { thumbnailUrl: imgUrl }),
                    sourceUrl: ''
                }
            }
        });
    } catch (e) {
        console.error('[GMCard] Error:', e.message);
    }
};

Cantarella.ev.on('groups.update', async (json) => {
    try {
        const res = json[0];
        if (!res) return;
        const gid = res.id;
        const authorJid = res.author || res.actionAuthor || null;

        // Abaikan event sinkronisasi metadata dari groupMetadata() / groupFetchAllParticipating()
        if (!authorJid || Array.isArray(res.participants) || res.creation !== undefined || res.size !== undefined) return;

        const _gsDB_path = './database/groupsettings.json';
        let _gsDB = {};
        try { _gsDB = JSON.parse(require('fs').readFileSync(_gsDB_path, 'utf8')); } catch {}
        const _gsCfg = _gsDB[gid] || {};
        if (_gsCfg.groupNotif !== true) return;

        const adminInfo = authorJid ? await _gmGetName(Cantarella, authorJid) : { name: 'Admin', num: '0' };
        const adminMentions = authorJid ? [authorJid] : [];
        const adminTag = authorJid ? `@${adminInfo.num}` : adminInfo.name;

        if (res.announce === true) {
            await _gmCard(
                Cantarella, gid, 'closegroup',
                'GROUP CLOSED', 'Group Management',
                `*🔒 ᴄʟᴏꜱᴇ ɢʀᴏᴜᴘ*\n\n` +
                `╔═ 🔒 *sᴛᴀᴛᴜs ɢʀᴏᴜᴘ* ✦\n` +
                `║ » Aksi: Grup Ditutup\n` +
                `║ » Info: Hanya admin yg bisa kirim pesan\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Terkunci\n` +
                `╚═════`,
                adminMentions
            );
        } else if (res.announce === false) {
            await _gmCard(
                Cantarella, gid, 'opengroup',
                'GROUP OPENED', 'Group Management',
                `*🔓 ᴏᴘᴇɴ ɢʀᴏᴜᴘ*\n\n` +
                `╔═ 🔓 *sᴛᴀᴛᴜs ɢʀᴏᴜᴘ* ✦\n` +
                `║ » Aksi: Grup Dibuka\n` +
                `║ » Info: Semua member bisa kirim pesan\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Terbuka\n` +
                `╚═════`,
                adminMentions
            );
        }

        if (res.restrict === true) {
            await _gmCard(
                Cantarella, gid, 'locksettings',
                'SETTINGS LOCKED', 'Group Management',
                `*🔐 ʟᴏᴄᴋ sᴇᴛᴛɪɴɢꜱ*\n\n` +
                `╔═ 🔐 *ɪɴꜰᴏ ɢʀᴏᴜᴘ* ✦\n` +
                `║ » Aksi: Pengaturan Dikunci\n` +
                `║ » Info: Hanya admin yg bisa edit info grup\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Terkunci\n` +
                `╚═════`,
                adminMentions
            );
        } else if (res.restrict === false) {
            await _gmCard(
                Cantarella, gid, 'unlocksettings',
                'SETTINGS UNLOCKED', 'Group Management',
                `*🗝️ ᴜɴʟᴏᴄᴋ sᴇᴛᴛɪɴɢꜱ*\n\n` +
                `╔═ 🗝️ *ɪɴꜰᴏ ɢʀᴏᴜᴘ* ✦\n` +
                `║ » Aksi: Pengaturan Dibuka\n` +
                `║ » Info: Semua member bisa edit info grup\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Terbuka\n` +
                `╚═════`,
                adminMentions
            );
        }

        if (res.subject) {
            await _gmCard(
                Cantarella, gid, 'setname',
                'GROUP RENAMED', 'Group Management',
                `*🏷️ ꜱᴇᴛ ɴᴀᴍᴇ*\n\n` +
                `╔═ 🏷️ *ɴᴀᴍᴀ ɢʀᴏᴜᴘ* ✦\n` +
                `║ » Nama Baru: ${res.subject}\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Berhasil Diubah\n` +
                `╚═════`,
                adminMentions
            );
        }

        if (res.desc !== undefined && res.desc !== null) {
            const descPreview = res.desc
                ? (res.desc.length > 80 ? res.desc.slice(0, 80) + '...' : res.desc)
                : '_(Dihapus)_';
            await _gmCard(
                Cantarella, gid, 'setdesc',
                'DESCRIPTION UPDATED', 'Group Management',
                `*📝 ꜱᴇᴛ ᴅᴇꜱᴄ*\n\n` +
                `╔═ 📝 *ᴅᴇꜱᴋʀɪᴘꜱɪ ɢʀᴏᴜᴘ* ✦\n` +
                `║ » Deskripsi Baru:\n` +
                `║   _${descPreview}_\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Diperbarui\n` +
                `╚═════`,
                adminMentions
            );
        }

        if (res.memberAddMode === true) {
            await _gmCard(
                Cantarella, gid, 'lockadd',
                'ADD MEMBER LOCKED', 'Group Management',
                `*🛡️ ʟᴏᴄᴋ ᴀᴅᴅ ᴍᴇᴍʙᴇʀ*\n\n` +
                `╔═ 🛡️ *ᴀᴅᴅ ᴍᴇᴍʙᴇʀ* ✦\n` +
                `║ » Aksi: Add Member Dikunci\n` +
                `║ » Info: Hanya admin yg bisa tambah member\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Restricted\n` +
                `╚═════`,
                adminMentions
            );
        } else if (res.memberAddMode === false) {
            await _gmCard(
                Cantarella, gid, 'unlockadd',
                'ADD MEMBER OPENED', 'Group Management',
                `*👥 ᴜɴʟᴏᴄᴋ ᴀᴅᴅ ᴍᴇᴍʙᴇʀ*\n\n` +
                `╔═ 👥 *ᴀᴅᴅ ᴍᴇᴍʙᴇʀ* ✦\n` +
                `║ » Aksi: Add Member Dibuka\n` +
                `║ » Info: Semua member bisa undang teman\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Terbuka\n` +
                `╚═════`,
                adminMentions
            );
        }

        if (res.joinApprovalMode === true) {
            await _gmCard(
                Cantarella, gid, 'joinapproval',
                'JOIN APPROVAL ON', 'Group Management',
                `*📋 ᴊᴏɪɴ ᴀᴘᴘʀᴏᴠᴀʟ ᴏɴ*\n\n` +
                `╔═ 📋 *ᴊᴏɪɴ ᴀᴘᴘʀᴏᴠᴀʟ* ✦\n` +
                `║ » Aksi: Persetujuan Bergabung Aktif\n` +
                `║ » Info: Member baru perlu persetujuan admin\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Enabled\n` +
                `╚═════`,
                adminMentions
            );
        } else if (res.joinApprovalMode === false) {
            await _gmCard(
                Cantarella, gid, 'joinopen',
                'JOIN APPROVAL OFF', 'Group Management',
                `*📄 ᴊᴏɪɴ ᴀᴘᴘʀᴏᴠᴀʟ ᴏꜰꜰ*\n\n` +
                `╔═ 📄 *ᴊᴏɪɴ ᴀᴘᴘʀᴏᴠᴀʟ* ✦\n` +
                `║ » Aksi: Persetujuan Bergabung Nonaktif\n` +
                `║ » Info: Member bisa join bebas via link\n` +
                `║ » Oleh: ${adminTag}\n` +
                `║ » Status: ✅ Disabled\n` +
                `╚═════`,
                adminMentions
            );
        }

    } catch (e) {
        console.error('[GroupsUpdate] Error:', e.message);
    }
});

// ── group-participants.update — promote / demote / add / kick (otomatis) ──────
Cantarella.ev.on('group-participants.update', async (_gmUpdate) => {
    try {
        const gid    = _gmUpdate.id;
        const action = _gmUpdate.action;
        const parts  = _gmUpdate.participants || [];
        const author = _gmUpdate.author || _gmUpdate.actionAuthor || null;

        if (!['promote', 'demote', 'add', 'remove'].includes(action)) return;

        for (const userJid of parts) {
            if (action === 'add' && global.isBlacklistedParticipant(userJid)) {
                global._SILENT_KICKED_JIDS.add(userJid);
                setTimeout(() => global._SILENT_KICKED_JIDS.delete(userJid), 30000);
                try { await Cantarella.groupParticipantsUpdate(gid, [userJid], 'remove'); } catch {}
            }
        }

        const _gsDB_path = './database/groupsettings.json';
        let _gsDB = {};
        try { _gsDB = JSON.parse(require('fs').readFileSync(_gsDB_path, 'utf8')); } catch {}
        const _gsCfg = _gsDB[gid] || {};
        if (_gsCfg.groupNotif !== true) return;

        const adminInfo = author ? await _gmGetName(Cantarella, author) : { name: 'Admin', num: '0' };
        const adminTag  = author ? `@${adminInfo.num}` : adminInfo.name;

        for (const userJid of parts) {
            if (global._SILENT_KICKED_JIDS.has(userJid) || global.isBlacklistedParticipant(userJid)) {
                continue;
            }
            const userInfo = await _gmGetName(Cantarella, userJid);
            const mentions = [userJid, ...(author ? [author] : [])];

            if (action === 'promote') {
                await _gmCard(
                    Cantarella, gid, 'promote',
                    'PROMOTED', 'Group Management',
                    `*🎉 ᴘʀᴏᴍᴏᴛᴇ*\n\n` +
                    `╔═ 🎉 *ᴘʀᴏᴍᴏᴛᴇ ᴀᴅᴍɪɴ* ✦\n` +
                    `║ » 👤 User: @${userInfo.num}\n` +
                    `║ » 🏅 Role: Group Admin\n` +
                    `║ » 👮 Oleh: ${adminTag}\n` +
                    `║ » ✅ Status: Dipromote\n` +
                    `╚═════`,
                    mentions
                );
            } else if (action === 'demote') {
                await _gmCard(
                    Cantarella, gid, 'demote',
                    'DEMOTED', 'Group Management',
                    `*📉 ᴅᴇᴍᴏᴛᴇ*\n\n` +
                    `╔═ 📉 *ᴅᴇᴍᴏᴛᴇ ᴀᴅᴍɪɴ* ✦\n` +
                    `║ » 👤 User: @${userInfo.num}\n` +
                    `║ » 📉 Role: Member Biasa\n` +
                    `║ » 👮 Oleh: ${adminTag}\n` +
                    `║ » 🔻 Status: Didemote\n` +
                    `╚═════`,
                    mentions
                );
            } else if (action === 'add') {
                await _gmCard(
                    Cantarella, gid, 'add',
                    'MEMBER JOINED', 'Group Management',
                    `*🤝 ᴍᴇᴍʙᴇʀ ʙᴀʀᴜ*\n\n` +
                    `╔═ 🤝 *ᴀᴅᴅ ᴍᴇᴍʙᴇʀ* ✦\n` +
                    `║ » 👤 User: @${userInfo.num}\n` +
                    `║ » 🚪 Action: Bergabung ke Grup\n` +
                    `║ » 👮 Oleh: ${adminTag}\n` +
                    `║ » ✅ Status: Ditambahkan\n` +
                    `╚═════`,
                    mentions
                );
            } else if (action === 'remove') {
                await _gmCard(
                    Cantarella, gid, 'kick',
                    'MEMBER KICKED', 'Group Management',
                    `*🚪 ᴋɪᴄᴋ ᴍᴇᴍʙᴇʀ*\n\n` +
                    `╔═ 🚪 *ᴋɪᴄᴋ ᴍᴇᴍʙᴇʀ* ✦\n` +
                    `║ » 👤 User: @${userInfo.num}\n` +
                    `║ » 🚫 Action: Dikeluarkan dari Grup\n` +
                    `║ » 👮 Oleh: ${adminTag}\n` +
                    `║ » ❌ Status: Kicked\n` +
                    `╚═════`,
                    mentions
                );
            }

            await _GM_SLEEP(1200);
        }
    } catch (e) {
        console.error('[GMParticipants] Error:', e.message);
    }
});

Cantarella.ev.on('group-participants.update', async (anu) => {


if (!global._SCHEDULE_STARTED) {
    global._SCHEDULE_STARTED = true;
    setInterval(async () => {
        try {
            const _GS_PATH_SCH = "./database/groupsettings.json";
            let _schDB = {};
            try { _schDB = JSON.parse(require('fs').readFileSync(_GS_PATH_SCH,'utf8')); } catch(_e) {}

            const moment = require('moment-timezone');
            const _nowWIB  = moment().tz('Asia/Jakarta');
            const _nowTime = _nowWIB.format('HH:mm');
            const _nowSec  = _nowWIB.seconds();

            if (_nowSec > 10) return;

            for (const [gid, cfg] of Object.entries(_schDB)) {
                if (!cfg.scheduleActive || !cfg.scheduleOpen || !cfg.scheduleClose) continue;
                try {
                    const _groupInfo = await Cantarella.groupMetadata(gid).catch(() => null);
                    if (!_groupInfo) continue;
                    const _isAnnounce = _groupInfo.announce;

                    if (_nowTime === cfg.scheduleClose && !_isAnnounce) {

                        await Cantarella.groupSettingUpdate(gid, 'announcement');
                        await Cantarella.sendMessage(gid, {
                            text:
                                `🔒 *Grup Ditutup Otomatis!*\n\n` +
                                `⏰ Sesuai jadwal, grup ditutup pukul *${cfg.scheduleClose} WIB*.\n` +
                                `Hanya admin yang bisa mengirim pesan.\n\n` +
                                `🕐 Grup akan dibuka kembali pukul *${cfg.scheduleOpen} WIB*.\n` +
                                `_Selamat beristirahat! 🌙_`
                        });
                    } else if (_nowTime === cfg.scheduleOpen && _isAnnounce) {

                        await Cantarella.groupSettingUpdate(gid, 'not_announcement');
                        await Cantarella.sendMessage(gid, {
                            text:
                                `🔓 *Grup Dibuka Kembali!*\n\n` +
                                `☀️ Selamat pagi/siang/malam semua!\n` +
                                `Grup sudah dibuka pukul *${cfg.scheduleOpen} WIB*.\n` +
                                `Semua anggota bisa mengirim pesan kembali!\n\n` +
                                `🕙 Grup akan ditutup nanti pukul *${cfg.scheduleClose} WIB*.\n` +
                                `_Selamat beraktivitas! 🌟_`
                        });
                    }
                } catch(_e2) { console.error(`[Schedule] Error grup ${gid}:`, _e2.message); }
            }
        } catch(_e) { console.error('[Schedule checker]', _e.message); }
    }, 30 * 1000);
}
    console.log(anu)
    try {
        let metadata = await Cantarella.groupMetadata(anu.id).catch(()=>({}))
        let participants = anu.participants
        const _SLEEP = (ms) => new Promise(r => setTimeout(r, ms))

        const _GS_PATH = "./database/groupsettings.json";
        let _gsDB = {};
        try { _gsDB = JSON.parse(require('fs').readFileSync(_GS_PATH,'utf8')); } catch(_){}
        const _gsData = _gsDB[anu.id] || {};

        const GS_WELCOME_DEFAULT =
`    👋 SELAMAT DATANG!    

👤 *Member Baru:* @user
📂 *Grup:* @subject
👥 *Total Member:* @total anggota
📅 *Bergabung:* @date
📝 *Bio:* @bio

_Selamat datang! Semoga betah & patuhi aturan grup ya 🙏_`;

        const GS_LEAVE_DEFAULT =
`    👋 SELAMAT TINGGAL!    

👤 *Member:* @user
📂 *Grup:* @subject
👥 *Total Member:* @total anggota
📅 *Meninggalkan:* @date

_Semoga sukses selalu, sering main ke sini lagi ya! 🙏_`;

function _fmtMsg(template, data) {
    return (template || '')
        .replace(/@user/g,    `@${data.userId}`)
        .replace(/@subject/g, data.subject || 'Grup')
        .replace(/@desc/g,    data.desc    || '')
        .replace(/@date/g,    data.date    || new Date().toLocaleDateString('id-ID'))
        .replace(/@bio/g,     data.bio     || 'Tidak ada bio')
        .replace(/@total/g,   String(data.total || '?'));
}

for (let num of participants) {
    if (global.isBlacklistedParticipant(num, metadata.participants) || global._SILENT_KICKED_JIDS.has(num)) {
        if (anu.action == 'add') {
            global._SILENT_KICKED_JIDS.add(num);
            setTimeout(() => global._SILENT_KICKED_JIDS.delete(num), 30000);
            try { await Cantarella.groupParticipantsUpdate(anu.id, [num], 'remove'); } catch {}
        }
        continue;
    }
    let ppuser;
    try {
        ppuser = await Cantarella.profilePictureUrl(num, 'image');
    } catch {
        ppuser = 'https://i.imgur.com/bGqSIIq.jpg';
    }

    let getBio = await Cantarella.fetchStatus(num).catch(() => ({ status: 'Tidak ada bio' }));

    const _msgData = {
        userId:  num.split('@')[0],
        subject: metadata.subject || 'Grup',
        desc:    metadata.desc    || '',
        date:    new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
        bio:     getBio?.status   || 'Tidak ada bio',
        total:   metadata.participants?.length || '?'
    };

    if (anu.action == 'add') {

        const _bannedList = _gsData.bannednumbers || [];
        if (_bannedList.includes(num)) {
            try {
                await Cantarella.groupParticipantsUpdate(anu.id, [num], 'remove');
                await Cantarella.sendMessage(anu.id, {
                    text: `🚫 *Auto-Kick: Nomor Terblokir!*\n\n@${num.split('@')[0]} ada dalam banned list grup ini dan otomatis dikeluarkan!`,
                    mentions: [num]
                });
            } catch (_e) {
                console.error('[BannedCheck]', _e.message);
            }
            continue;
        }

        if (_gsData.antiautobot) {
            let _isBot = false;
            try {
                const _uInfo = await Cantarella.onWhatsApp(num);
                const _pname = (_uInfo?.[0]?.name || '').toLowerCase();
                const _nClean = num.replace('@s.whatsapp.net', '');
                if (
                    /bot|robot|auto|system|service|assistant/i.test(_pname) ||
                    (_nClean.startsWith('1') && _nClean.length > 11) ||
                    _nClean.length < 7 ||
                    _nClean.length > 15
                ) _isBot = true;
            } catch (_e) {}
            if (_isBot) {
                try {
                    await Cantarella.groupParticipantsUpdate(anu.id, [num], 'remove');
                    await Cantarella.sendMessage(anu.id, {
                        text: `🤖 *Auto-Kick: Bot Terdeteksi!*\n\n@${num.split('@')[0]} terdeteksi sebagai bot otomatis dan dikeluarkan!`,
                        mentions: [num]
                    });
                } catch (_e) {}
                continue;
            }
        }

        if (!_gsData.welcome) {
            if (_gsData.verify && _gsData.verifyQuestion) {
                setTimeout(async () => {
                    try {
                        await _sendVerifyQuestion(Cantarella, anu.id, num, _gsData, metadata);
                    } catch (_ve) {
                        console.error('[Verify]', _ve.message);
                    }
                }, 5 * 60 * 1000);
            }
            continue;
        }

        const _wMsg = _fmtMsg(_gsData.welcomeMsg || GS_WELCOME_DEFAULT, _msgData);

        let _wCanvas = null;
        try {
            _wCanvas = await createWelcomeCard({
                username:    _msgData.userId,
                groupName:   _msgData.subject,
                memberCount: _msgData.total,
                avatar:      ppuser,
                background:  global.welcomeBg || null,
                blur:        global.welcomeBlur || 14,
                backgroundOverlay: global.welcomeOverlay || 0.48,
                botName:     global.namaBot || 'Ender Verstappen',
                message:     _msgData.bio
            });
        } catch (_wcErr) {
            console.error('[WelcomeCard]', _wcErr.message);
        }

        let sentMsg;
        try {
            sentMsg = await Cantarella.sendMessage(anu.id, {
                image:   _wCanvas ? _wCanvas : { url: ppuser },
                caption: _wMsg,
                mentions: [num]
            });
        } catch (_sendErr) {
            console.error('[WelcomeSend]', _sendErr.message);
            continue;
        }

        if (sentMsg && sentMsg.key) {
            setTimeout(async () => {
                try {
                    await Cantarella.sendMessage(anu.id, { delete: sentMsg.key });
                } catch (_) {}
            }, global.welcomeTimeout || 20000);
        }

        if (_gsData.verify && _gsData.verifyQuestion) {
            setTimeout(async () => {
                try {
                    await _sendVerifyQuestion(Cantarella, anu.id, num, _gsData, metadata);
                } catch (_ve) {
                    console.error('[Verify]', _ve.message);
                }
            }, 5 * 60 * 1000);
        }

    } else if (anu.action == 'remove') {

        if (!_gsData.leave) continue;

        const _lMsg = _fmtMsg(_gsData.leaveMsg || GS_LEAVE_DEFAULT, _msgData);

        let _lCanvas = null;
        try {
            _lCanvas = await createGoodbyeCard({
                username:    _msgData.userId,
                groupName:   _msgData.subject,
                memberCount: _msgData.total,
                avatar:      ppuser,
                background:  global.leaveBg || global.welcomeBg || null,
                blur:        global.leaveBlur || 14,
                backgroundOverlay: global.leaveOverlay || 0.50,
                botName:     global.namaBot || 'Ender Verstappen',
                message:     'Semoga sukses selalu!',
                reason:      _msgData.reason || ''
            });
        } catch (_lcErr) {
            console.error('[GoodbyeCard]', _lcErr.message);
        }

        let sentMsg;
        try {
            sentMsg = await Cantarella.sendMessage(anu.id, {
                image:   _lCanvas ? _lCanvas : { url: ppuser },
                caption: _lMsg,
                mentions: [num]
            });
        } catch (_sendErr) {
            console.error('[GoodbyeSend]', _sendErr.message);
            continue;
        }

        if (sentMsg && sentMsg.key) {
            setTimeout(async () => {
                try {
                    await Cantarella.sendMessage(anu.id, { delete: sentMsg.key });
                } catch (_) {}
            }, global.leaveTimeout || 20000);
        }
    }

    await _SLEEP(1500);
}
} catch (err) {
    console.log('[GroupParticipants] Error:', err);
}
});

Cantarella.ev.on('group-participants.update', async (_gpUpdate) => {
  try {
    const _gpChat = _gpUpdate.id;
    const _gpAction = _gpUpdate.action;
    const _gpParticipants = _gpUpdate.participants || [];

    if (_gpAction !== 'add') return;

    const _gpData = gsGet(_gpChat);
    if (!_gpData.verification) return;

    const _gpQuestions = _gpData.verificationQuestions || [];
    if (!_gpQuestions.length) return;

    const _gpTimeout = _gpData.verificationTimeout || 600000;
    const _gpPending = _gpData.verificationPending || {};
    const _gpMaxAttempts = _gpData.verificationMaxAttempts || 3;
    const _gpDifficulty = _gpData.verificationDifficulty || 'all';
    const _gpAction2 = _gpData.verificationAction || 'kick';
    const _gpAutoMath = _gpData.verificationAutoMath;
    const _gpMultiQ = _gpData.verificationMultiQ;
    const _gpWhitelist = _gpData.verificationWhitelist || [];
    const _gpBlacklist = _gpData.verificationBlacklist || [];
    const _gpCustomWelcome = _gpData.verificationWelcomeMsg || '';
    const _gpStats = _gpData.verificationStats || { total: 0, passed: 0, failed: 0, timeout: 0, kicked: 0 };
    const _gpLog = _gpData.verificationLog || [];

    let _gpGroupMeta;
    try { _gpGroupMeta = await Cantarella.groupMetadata(_gpChat); } catch { _gpGroupMeta = {}; }
    const _gpGroupName = _gpGroupMeta.subject || 'Grup';
    let _gpGroupLink;
    try { _gpGroupLink = await Cantarella.groupInviteCode(_gpChat); } catch { _gpGroupLink = null; }

    for (const _gpJid of _gpParticipants) {
      if (global.isBlacklistedParticipant(_gpJid, _gpGroupMeta.participants) || global._SILENT_KICKED_JIDS.has(_gpJid)) {
        try { await Cantarella.groupParticipantsUpdate(_gpChat, [_gpJid], 'remove'); } catch {}
        continue;
      }
      if (_gpBlacklist.includes(_gpJid)) {
        _gpLog.push({ jid: _gpJid, action: 'blacklist_kick', time: Date.now() });
        if (_gpLog.length > 500) _gpLog.splice(0, _gpLog.length - 500);
        gsKey(_gpChat, 'verificationLog', _gpLog);
        _gpStats.kicked = (_gpStats.kicked || 0) + 1;
        gsKey(_gpChat, 'verificationStats', _gpStats);
        await Cantarella.sendMessage(_gpChat, {
          text: `🚫 @${_gpJid.split('@')[0]} ada di blacklist dan akan dikeluarkan otomatis.`,
          mentions: [_gpJid]
        });
        try { await Cantarella.groupParticipantsUpdate(_gpChat, [_gpJid], 'remove'); } catch {}
        continue;
      }

      if (_gpWhitelist.includes(_gpJid)) {
        _gpLog.push({ jid: _gpJid, action: 'whitelist_skip', time: Date.now() });
        if (_gpLog.length > 500) _gpLog.splice(0, _gpLog.length - 500);
        gsKey(_gpChat, 'verificationLog', _gpLog);
        _gpStats.total = (_gpStats.total || 0) + 1;
        _gpStats.passed = (_gpStats.passed || 0) + 1;
        gsKey(_gpChat, 'verificationStats', _gpStats);
        await Cantarella.sendMessage(_gpChat, {
          text: `✅ @${_gpJid.split('@')[0]} ada di whitelist, verifikasi dilewati otomatis. Selamat datang!`,
          mentions: [_gpJid]
        });
        continue;
      }

      _gpStats.total = (_gpStats.total || 0) + 1;
      gsKey(_gpChat, 'verificationStats', _gpStats);

      const _gpVerifyId = (Math.random().toString(36).substring(2, 5) + Math.random().toString(36).substring(2, 5)).toUpperCase();

      let _gpSelectedQ;
      let _gpFiltered = _gpDifficulty === 'all' ? _gpQuestions : _gpQuestions.filter(q => q.difficulty === _gpDifficulty);
      if (!_gpFiltered.length) _gpFiltered = _gpQuestions;

      if (_gpAutoMath && Math.random() > 0.4) {
        const _ops = ['+', '-', 'x', '/'];
        const _op = _ops[Math.floor(Math.random() * _ops.length)];
        let _a, _b, _ans;
        if (_op === '+') { _a = Math.floor(Math.random() * 50) + 1; _b = Math.floor(Math.random() * 50) + 1; _ans = _a + _b; }
        else if (_op === '-') { _a = Math.floor(Math.random() * 50) + 10; _b = Math.floor(Math.random() * _a); _ans = _a - _b; }
        else if (_op === 'x') { _a = Math.floor(Math.random() * 15) + 2; _b = Math.floor(Math.random() * 12) + 2; _ans = _a * _b; }
        else { _b = Math.floor(Math.random() * 10) + 2; _ans = Math.floor(Math.random() * 15) + 2; _a = _b * _ans; }
        _gpSelectedQ = { q: `Berapa hasil dari ${_a} ${_op === 'x' ? '×' : _op} ${_b}?`, a: String(_ans), difficulty: 'auto-math' };
      } else {
        _gpSelectedQ = _gpFiltered[Math.floor(Math.random() * _gpFiltered.length)];
      }

      _gpPending[_gpJid] = {
        verifyId: _gpVerifyId,
        question: _gpSelectedQ.q,
        answer: _gpSelectedQ.a,
        expiry: Date.now() + _gpTimeout,
        attempts: 0,
        groupId: _gpChat,
        groupName: _gpGroupName,
        joinedAt: Date.now(),
        questionPhase: _gpMultiQ ? 1 : 0,
        difficulty: _gpSelectedQ.difficulty || 'unknown'
      };

      gsKey(_gpChat, 'verificationPending', _gpPending);

      _gpLog.push({ jid: _gpJid, action: 'verification_started', time: Date.now(), verifyId: _gpVerifyId });
      if (_gpLog.length > 500) _gpLog.splice(0, _gpLog.length - 500);
      gsKey(_gpChat, 'verificationLog', _gpLog);

      try {
        const _gpDmButtons = [];

        if (_gpGroupLink) {
          _gpDmButtons.push({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '📋 Masuk ke Grup',
              url: `https://chat.whatsapp.com/${_gpGroupLink}`
            })
          });
        }

        _gpDmButtons.push({
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({
            display_text: '❓ Cara Menjawab',
            id: `.jawab`
          })
        });

        if (global.nobot) {
          _gpDmButtons.push({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '📞 Hubungi Admin',
              url: `https://wa.me/${global.nobot}?text=Halo+kak+saya+butuh+bantuan+verifikasi+di+grup+${encodeURIComponent(_gpGroupName)}`
            })
          });
        }

        if (global.linkSaluran) {
          _gpDmButtons.push({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '📢 Saluran',
              url: `https://whatsapp.com/channel/${global.linkSaluran?.split('/').pop() || ''}`
            })
          });
        }

        await Cantarella.sendMessage(_gpJid, {
          text:
            `👋 *Halo ${_gpJid.split('@')[0]}!*\n\n` +
            `Kamu baru saja bergabung di grup:\n` +
            `📋 *${_gpGroupName}*\n\n` +
            `🔒 Grup ini menggunakan sistem *verifikasi member*. Kamu perlu menyelesaikan verifikasi agar bisa berinteraksi penuh di grup.\n\n` +
            `${_gpCustomWelcome ? `> ${_gpCustomWelcome}\n\n` : ''}` +
            `╔═ 📌 *ʟᴀɴɢᴋᴀʜ ᴠᴇʀɪғɪᴋᴀsɪ* ✦\n` +
            `║ 1️⃣ Klik tombol di bawah untuk masuk ke grup\n` +
            `║ 2️⃣ Lihat pertanyaan verifikasi di chat grup\n` +
            `║ 3️⃣ Jawab dengan ketik di grup:\n` +
            `║    .jawab <ID> <jawaban>\n` +
            `║ 4️⃣ Jika benar → verifikasi selesai! ✅\n` +
            `╚═════\n\n` +
            `╔═ 🆔 *ɪɴғᴏ ᴠᴇʀɪғɪᴋᴀsɪ ᴋᴀᴍᴜ* ✦\n` +
            `║ » ID: *${_gpVerifyId}*\n` +
            `║ » Timeout: *${_gpTimeout / 60000} menit*\n` +
            `║ » Max percobaan: *${_gpMaxAttempts} kali*\n` +
            `║ » Mode: *${_gpMultiQ ? '2 Pertanyaan' : '1 Pertanyaan'}*\n` +
            `║ » Gagal: *${_gpAction2}*\n` +
            `╚═════\n\n` +
            `⏱️ *Batas waktu:* ${_gpTimeout / 60000} menit setelah pertanyaan muncul di grup\n\n` +
            `_Jika ada kendala, hubungi admin grup atau tekan tombol di bawah._`,
          footer: `${global.namaBot} • Verification System`,
          buttons: _gpDmButtons,
          headerType: 1
        });
      } catch {}

      await Cantarella.sendMessage(_gpChat, {
        text:
          `🔐 *ᴠᴇʀɪғɪᴋᴀsɪ ᴍᴇᴍʙᴇʀ ʙᴀʀᴜ*\n\n` +
          `> Halo @${_gpJid.split('@')[0]}! Selamat datang di *${_gpGroupName}* 👋\n\n` +
          `Untuk bisa berinteraksi di grup ini, kamu perlu menjawab pertanyaan berikut dengan benar.\n\n` +
          `╔═ ❓ *ᴘᴇʀᴛᴀɴʏᴀᴀɴ${_gpMultiQ ? ' ᴋᴇ-1' : ''}* ✦\n` +
          `║\n` +
          `║ ${_gpSelectedQ.q}\n` +
          `║\n` +
          `╚═════\n\n` +
          `🆔 *ID Verifikasi:* \`${_gpVerifyId}\`\n\n` +
          `╔═ 📝 *ᴄᴀʀᴀ ᴍᴇɴᴊᴀᴡᴀʙ* ✦\n` +
          `║ Ketik di chat grup:\n` +
          `║ .jawab ${_gpVerifyId} <jawabanmu>\n` +
          `║\n` +
          `║ Contoh:\n` +
          `║ .jawab ${_gpVerifyId} ${_gpSelectedQ.a}\n` +
          `╚═════\n\n` +
          `╔═ ⚙️ *ᴀᴛᴜʀᴀɴ* ✦\n` +
          `║ » Waktu: ${_gpTimeout / 60000} menit\n` +
          `║ » Percobaan: ${_gpMaxAttempts} kali\n` +
          `║ » Mode: ${_gpMultiQ ? '2 pertanyaan' : '1 pertanyaan'}\n` +
          `║ » Gagal/timeout: ${_gpAction2}\n` +
          `╚═════\n\n` +
          `_⚠️ Jawab sebelum waktu habis! Jika gagal ${_gpMaxAttempts}x atau timeout, kamu akan di-${_gpAction2}._`,
        footer: `${global.namaBot} • Verification System`,
        mentions: [_gpJid]
      });

      setTimeout(async () => {
        try {
          const _gpCurrentData = gsGet(_gpChat);
          const _gpCurrentPending = _gpCurrentData.verificationPending || {};

          if (_gpCurrentPending[_gpJid]) {
            delete _gpCurrentPending[_gpJid];
            gsKey(_gpChat, 'verificationPending', _gpCurrentPending);

            const _gpCurrentStats = _gpCurrentData.verificationStats || { total: 0, passed: 0, failed: 0, timeout: 0, kicked: 0 };
            _gpCurrentStats.timeout = (_gpCurrentStats.timeout || 0) + 1;
            if (_gpAction2 === 'kick') _gpCurrentStats.kicked = (_gpCurrentStats.kicked || 0) + 1;
            gsKey(_gpChat, 'verificationStats', _gpCurrentStats);

            const _gpCurrentLog = _gpCurrentData.verificationLog || [];
            _gpCurrentLog.push({ jid: _gpJid, action: 'timeout', time: Date.now(), verifyId: _gpVerifyId });
            if (_gpCurrentLog.length > 500) _gpCurrentLog.splice(0, _gpCurrentLog.length - 500);
            gsKey(_gpChat, 'verificationLog', _gpCurrentLog);

            await Cantarella.sendMessage(_gpChat, {
              text:
                `⏱️ *ᴠᴇʀɪғɪᴋᴀsɪ ᴛɪᴍᴇᴏᴜᴛ!*\n\n` +
                `> @${_gpJid.split('@')[0]} tidak menyelesaikan verifikasi\n` +
                `> dalam waktu ${_gpTimeout / 60000} menit.\n\n` +
                `╔═ ⏱️ *ᴅᴇᴛᴀɪʟ* ✦\n` +
                `║ » Member: @${_gpJid.split('@')[0]}\n` +
                `║ » ID: ${_gpVerifyId}\n` +
                `║ » Action: ${_gpAction2}\n` +
                `╚═════\n\n` +
                `${_gpAction2 === 'kick' ? '_Member dikeluarkan dari grup._' : ''}` +
                `${_gpAction2 === 'mute' ? '_Member di-mute._' : ''}` +
                `${_gpAction2 === 'warn' ? '_Member diberi peringatan._' : ''}`,
              mentions: [_gpJid]
            });

            if (_gpAction2 === 'kick') {
              try { await Cantarella.groupParticipantsUpdate(_gpChat, [_gpJid], 'remove'); } catch {}
            }

            try {
              await Cantarella.sendMessage(_gpJid, {
                text:
                  `⏱️ *ᴠᴇʀɪғɪᴋᴀsɪ ᴛɪᴍᴇᴏᴜᴛ*\n\n` +
                  `> Waktu verifikasi kamu di *${_gpGroupName}* telah habis.\n` +
                  `> Kamu tidak menjawab dalam ${_gpTimeout / 60000} menit.\n\n` +
                  `${_gpAction2 === 'kick' ? '> Kamu telah dikeluarkan dari grup.\n' : ''}` +
                  `_Hubungi admin jika ingin bergabung kembali._`
              });
            } catch {}
          }
        } catch {}
      }, _gpTimeout);
    }
  } catch {}
});

    Cantarella.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = Cantarella.decodeJid(contact.id);
            if (store && store.contacts) store.contacts[id] = {
                id,
                name: contact.notify
            };
        }
    });

    Cantarella.public = sessMeta.publicMode;
    if (isMain) {
        try {
            const _mf = JSON.parse(fs.readFileSync('./database/botmode.json','utf8'));
            if (typeof _mf.public === 'boolean') {
                Cantarella.public = _mf.public;
                sessMeta.publicMode = _mf.public;
                console.log('[Mode] Loaded:', Cantarella.public ? 'PUBLIC' : 'SELF');
            }
        } catch {}
    }

    Cantarella.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !Cantarella.authState.creds.registered && !Cantarella.authState.creds.account) {
            await _triggerPairing();
        }


        try {
            const _CantarellaMod = require('./Cantarella');
            if (_CantarellaMod.updateConnectionState) _CantarellaMod.updateConnectionState(connection);
        } catch (_adConnErr) { /* silent */ }

        if (connection === 'open') {
            const actualNum = normalizePhone(Cantarella.user?.id?.split(':')[0]?.split('@')[0] || cleanPhone);
            if (actualNum && actualNum !== cleanPhone) {
                global._BOT_SESSIONS.delete(cleanPhone);
                cleanPhone = actualNum;
                sessMeta.phone = actualNum;
                global._BOT_SESSIONS.set(actualNum, sessMeta);
            }
            sessMeta.status = 'CONNECTED';
            sessMeta.connectedAt = sessMeta.connectedAt || Date.now();
            sessMeta.pairingCode = '';
            _L.exitPairingMode();
            _L.setBotInfo({
                botName: global.namaBot  || 'Ender Verstappen',
                owner:   global.namaowner || '—',
                mode:    Cantarella.public ? 'PUBLIC' : 'SELF',
                status:  'CONNECTED',
            });
            if (!global._LOGGER_TICKER) _L.startTicker();
            try {
                const _ab = require('./lib/system/antibot');
                _ab.init(null);
                global._ANTIBOT = _ab;
            } catch(e) { console.warn('[AntiBot] Init skip:', e.message); }
            if (_AB) {
                const _botJid = Cantarella.user?.id || '__bot__';
                global._BOT_JID = _botJid;
                if (!global._AB_INITIALIZED) {
                    _AB.initializeAll(Cantarella, _botJid);
                    global._AB_INITIALIZED = true;
                } else {
                    _AB.healthRecordConnect();
                    _AB.reconnectOnSuccess();
                }
                try { await Cantarella.sendPresenceUpdate('available'); } catch {}
            if (_HM) _HM.startHealthMonitor(Cantarella, {
                onGhost: (sock) => {
                    console.warn('[HealthMonitor] Ghost connection — forcing reconnect');
                    try { sock.end(new Error('ghost')); } catch {}
                }
            });
            if (_SessBackup) {
                const _ownerJidBK = ((Array.isArray(global.owner) ? global.owner[0] : global.owner) || '').replace(/[^0-9]/g,'') + '@s.whatsapp.net';
                _SessBackup.startAutoBackup(global.notifBackup ? async (msg) => {
                    try { await Cantarella.sendMessage(_ownerJidBK, { text: msg }); } catch {}
                } : null);
            }
        }
 try {
    const _swgcMod = require('./Cantarella');
    if (_swgcMod.startAutoSwgcScheduler) {
        _swgcMod.startAutoSwgcScheduler(Cantarella);
    }
} catch(e) { console.error('[AutoSWGC] Gagal start:', e.message); }

        // Auto-backup scheduler (silent tanpa kirim pesan ke WA jika global.notifBackup = false)
try {
    const _AutoBackup = require('./lib/autobackup');
    const _ownerJidAB = ((Array.isArray(global.owner)?global.owner[0]:global.owner)||'').replace(/[^0-9]/g,'') + '@s.whatsapp.net';
    _AutoBackup.startAutoBackup(global.notifBackup ? async (msg) => {
        try { await Cantarella.sendMessage(_ownerJidAB, { text: msg }); } catch {}
    } : null);
} catch(e) { console.error('[AutoBackup] Gagal start:', e.message); }

        // Auto-unfollow saluran WhatsApp yang bukan milik bot (pembersihan sisa backdoor template)
        (async () => {
            try {
                await new Promise(res => setTimeout(res, 5000));
                const myChannel = global.idch || '120363407326732377@newsletter';
                
                // 1. Cek semua saluran yang diikuti bot via Baileys API
                if (typeof Cantarella.newsletterSubscribed === 'function') {
                    try {
                        const subs = await Cantarella.newsletterSubscribed();
                        if (Array.isArray(subs)) {
                            for (const sub of subs) {
                                const chId = sub.id || sub.jid;
                                if (chId && chId !== myChannel && typeof Cantarella.newsletterUnfollow === 'function') {
                                    console.log(`[AutoUnfollow] Menemukan saluran asing ${chId} (${sub.name || 'Unknown'}), memproses unfollow...`);
                                    await Cantarella.newsletterUnfollow(chId).catch(() => {});
                                    await new Promise(r => setTimeout(r, 1200));
                                }
                            }
                        }
                    } catch (errSub) {
                        /* silent */
                    }
                }

                // 2. Unfollow daftar JID saluran asing yang teridentifikasi dari template lama
                const unwantedChannels = [
                    '120363186130999681@newsletter',
                    '120363422376927268@newsletter',
                    '120363402457842417@newsletter',
                    '120363350314602601@newsletter',
                    '120363423631131750@newsletter',
                    '120363208449943317@newsletter',
                    '120363414017624228@newsletter'
                ];

                for (const ch of unwantedChannels) {
                    if (ch !== myChannel && typeof Cantarella.newsletterUnfollow === 'function') {
                        try {
                            await Cantarella.newsletterUnfollow(ch);
                            console.log(`[AutoUnfollow] Berhasil unfollow saluran: ${ch}`);
                            await new Promise(r => setTimeout(r, 800));
                        } catch (e) {
                            /* abaikan jika sudah tidak follow */
                        }
                    }
                }
            } catch (err) {
                console.error('[AutoUnfollow] Error:', err.message);
            }
        })();
        if (!global._SEWA_REMINDER_TIMER) {
            global._SEWA_REMINDER_TIMER = setInterval(async () => {
                // ...
            }, 60 * 60 * 1000);
        }

        // Silent Blacklist Sweep saat koneksi terbuka & berkala
        setTimeout(() => {
            if (typeof global.sweepAllGroupsForBlacklist === 'function') {
                global.sweepAllGroupsForBlacklist(Cantarella).catch(() => {});
            }
        }, 4000);
        if (!sessMeta._blInterval) {
            sessMeta._blInterval = setInterval(() => {
                if (typeof global.sweepAllGroupsForBlacklist === 'function') {
                    global.sweepAllGroupsForBlacklist(Cantarella).catch(() => {});
                }
            }, 3 * 60 * 1000);
        }

        // Watcher Showroom dinonaktifkan
        if (false && watcherShowroom) {
            if (showroomIntervalId) { clearInterval(showroomIntervalId); showroomIntervalId = null; }
            showroomIntervalId = setInterval(async () => {
                if (isWatchingShowroom) return;
                isWatchingShowroom = true;
                try {
                    await watcherShowroom(Cantarella, showroomGroupChats);
                } catch (e) {
                    console.log('Gagal kirim notifikasi Showroom:', e);
                } finally {
                    isWatchingShowroom = false;
                }
            }, 30000);
        }
    }

    if (connection === 'close') {
        if (sessMeta.stoppedManually) return;
        sessMeta.status = 'RECONNECTING';
        if (isMain) _L.setStatus('RECONNECTING');
        if (showroomIntervalId) { clearInterval(showroomIntervalId); showroomIntervalId = null; }
        const code   = lastDisconnect?.error?.output?.statusCode
                    || lastDisconnect?.error?.statusCode
                    || DisconnectReason.connectionClosed;
        const reason = lastDisconnect?.error?.message || String(code);
        const _reconnectOpts = { sessionDir, phone: cleanPhone, customCode: sessMeta.customCode };
        if (_AB && isMain) {
            _AB.healthRecordDisconnect(reason);
            _AB.reconnectGuard(reason);
            if (code !== DisconnectReason.loggedOut) {
                setTimeout(() => { if (!sessMeta.stoppedManually) try { Starts(_reconnectOpts); } catch {} }, 1500);
            } else if (!Cantarella.authState.creds.registered && !Cantarella.authState.creds.account) {
                setTimeout(() => { if (!sessMeta.stoppedManually) try { Starts(_reconnectOpts); } catch {} }, 1500);
            } else {
                sessMeta.status = 'LOGGED_OUT';
                console.log('\x1b[31m❌ Bot logout terdeteksi\x1b[0m');
                if (_HM) _HM.stopHealthMonitor();
                if (_SessBackup) _SessBackup.stopAutoBackup();
            }
        } else {
            if (code !== DisconnectReason.loggedOut) {
                setTimeout(() => { if (!sessMeta.stoppedManually) try { Starts(_reconnectOpts); } catch {} }, 1500);
            } else if (!Cantarella.authState.creds.registered && !Cantarella.authState.creds.account) {
                setTimeout(() => { if (!sessMeta.stoppedManually) try { Starts(_reconnectOpts); } catch {} }, 1500);
            } else {
                sessMeta.status = 'LOGGED_OUT';
                console.log(`\x1b[31m❌ Sesi ${cleanPhone} logout terdeteksi\x1b[0m`);
            }
        }
    }
});
     Cantarella.getName = (jid, withoutContact = false) => {
		id = Cantarella.decodeJid(jid)
		withoutContact = Cantarella.withoutContact || withoutContact
		let v
		if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
			v = store.contacts[id] || {}
			if (!(v.name || v.subject)) v = Cantarella.groupMetadata(id) || {}
			resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
		})
		else v = id === '0@s.whatsapp.net' ? {
			id,
			name: 'WhatsApp'
		} : id === Cantarella.decodeJid(Cantarella.user.id) ? Cantarella.user : (store.contacts[id] || {})
		return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
	}

    Cantarella.sendFile = async (jid, path, filename = '', caption = '', quoted = null, options = {}) => {
        try {

            let buffer;
            if (Buffer.isBuffer(path)) {
                buffer = path;
            } else if (typeof path === 'string') {
                if (/^data:.*?\/.*?;base64,/i.test(path)) {
                    buffer = Buffer.from(path.split`,`[1], 'base64');
                } else if (/^https?:\/\//.test(path)) {
                    buffer = await getBuffer(path);
                } else if (fs.existsSync(path)) {
                    buffer = fs.readFileSync(path);
                } else {
                    throw new Error('Invalid file path');
                }
            } else {
                throw new Error('Invalid input');
            }

            let fileType = await FileType.fromBuffer(buffer);
            let mime = fileType ? fileType.mime : 'application/octet-stream';
            let extension = fileType ? fileType.ext : 'bin';

            if (!filename) {
                if (typeof path === 'string' && !/^(data:|https?:\/\/)/.test(path)) {
                    filename = path.split('/').pop().split('\\').pop();
                } else {
                    filename = `file_${Date.now()}.${extension}`;
                }
            }

            let messageType;
            let messageContent = {};

            if (mime.startsWith('image/')) {
                messageType = 'imageMessage';
                messageContent = {
                    image: buffer,
                    caption: caption || '',
                    fileName: filename,
                    mimetype: mime,
                    ...options
                };
            } else if (mime.startsWith('video/')) {
                messageType = 'videoMessage';
                messageContent = {
                    video: buffer,
                    caption: caption || '',
                    fileName: filename,
                    mimetype: mime,
                    ...options
                };
            } else if (mime.startsWith('audio/')) {
                messageType = 'audioMessage';
                messageContent = {
                    audio: buffer,
                    mimetype: mime,
                    fileName: filename,
                    ...options
                };
            } else {
                messageType = 'documentMessage';
                messageContent = {
                    document: buffer,
                    fileName: filename,
                    mimetype: mime,
                    caption: caption || '',
                    ...options
                };
            }

            const media = await prepareWAMessageMedia(
                messageContent,
                {
                    upload: Cantarella.waUploadToServer,
                    mediaType: messageType.replace('Message', '').toLowerCase()
                }
            );

            return await Cantarella.sendMessage(jid, media, { quoted });

        } catch (err) {
            console.error('Error in sendFile:', err);
            throw err;
        }
    };

Cantarella.autoReadSW = async (m) => {
    if (!global.autoreadsw) return

    try {
        if (m.key && m.key.remoteJid === 'status@broadcast') {
            await Cantarella.readMessages([m.key])
            console.log('📱 Auto read status')
        }
    } catch (e) {

    }
}

Cantarella.autoReactSW = async (m) => {
    if (!global.autoreactsw) return

    try {
        if (m.key && m.key.remoteJid === 'status@broadcast') {
            const reaction = {
                react: {
                    text: global.autoreactemoji,
                    key: m.key
                }
            }
            await Cantarella.sendMessage(m.key.remoteJid, reaction)
            console.log(`😀 Auto reacted to status with ${global.autoreactemoji}`)
        }
    } catch (e) {
        console.error('Auto react error:', e)
    }
}

Cantarella.sendStatusMention = async (content, jids = []) => {
let users;
for (let id of jids) {
let userId = await Cantarella.groupMetadata(id)
users = await userId.participants.map(u => Cantarella.decodeJid(u.id))
}
let message = await Cantarella.sendMessage(
"status@broadcast", content, {
backgroundColor: "F54242",
font: Math.floor(Math.random() * 9),
statusJidList: users,
additionalNodes: [
{ tag: "meta", attrs: {}, content: [{ tag: "mentioned_users", attrs: {},
content: jids.map((jid) => ({ tag: "to", attrs: { jid }, content: undefined, })),
}, ], }, ], })
jids.forEach(id => {
Cantarella.relayMessage(id, {
groupStatusMentionMessage: {
message: {
protocolMessage: {
key: message.key,
type: 25,
}, }, }, },
{ userJid: Cantarella.user.jid, additionalNodes: [{
tag: "meta", attrs: { is_status_mention: "true" }, content: undefined, }, ], })
delay(2500)
})
return message
} 

    Cantarella.getFile = async (message, returnBuffer = true, savePath = '') => {
        try {
            if (!message || (!message.msg && !message.message)) {
                throw new Error('Invalid message');
            }

            const m = message.msg || message.message;
            let mime, messageType, filename;

            if (m.imageMessage) {
                mime = m.imageMessage.mimetype;
                messageType = 'image';
                filename = m.imageMessage.fileName || `image_${Date.now()}`;
            } else if (m.videoMessage) {
                mime = m.videoMessage.mimetype;
                messageType = 'video';
                filename = m.videoMessage.fileName || `video_${Date.now()}`;
            } else if (m.audioMessage) {
                mime = m.audioMessage.mimetype;
                messageType = 'audio';
                filename = m.audioMessage.fileName || `audio_${Date.now()}`;
            } else if (m.documentMessage) {
                mime = m.documentMessage.mimetype;
                messageType = 'document';
                filename = m.documentMessage.fileName || `document_${Date.now()}`;
            } else if (m.stickerMessage) {
                mime = m.stickerMessage.mimetype;
                messageType = 'sticker';
                filename = `sticker_${Date.now()}`;
            } else {
                throw new Error('Unsupported message type');
            }

            const stream = await downloadContentFromMessage(m, messageType);
            let buffer = Buffer.from([]);

            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            const fileType = await FileType.fromBuffer(buffer);
            let extension = 'bin';

            if (fileType) {
                extension = fileType.ext;
            } else if (mime) {
                extension = mime.split('/')[1]?.split(';')[0] || 'bin';
            }

            if (filename && !filename.includes('.')) {
                filename = `${filename}.${extension}`;
            }

            if (savePath) {
                const fullPath = savePath.endsWith('/') ? savePath + filename : savePath;
                fs.writeFileSync(fullPath, buffer);
                console.log(`File saved to: ${fullPath}`);
            }

            if (returnBuffer) {
                return {
                    buffer,
                    filename,
                    mime,
                    extension,
                    size: buffer.length
                };
            } else {
                return {
                    path: savePath ? (savePath.endsWith('/') ? savePath + filename : savePath) : null,
                    filename,
                    mime,
                    extension,
                    size: buffer.length
                };
            }

        } catch (err) {
            console.error('Error in getFile:', err);
            throw err;
        }
    };

     Cantarella.copyNForward = async (jid, message, forceForward = false, options = {}) => {
let vtype
if (options.readViewOnce) {
message.message = message.message && message.message.ephemeralMessage && message.message.ephemeralMessage.message ? message.message.ephemeralMessage.message : (message.message || undefined)
vtype = Object.keys(message.message.viewOnceMessage.message)[0]
delete(message.message && message.message.ignore ? message.message.ignore : (message.message || undefined))
delete message.message.viewOnceMessage.message[vtype].viewOnce
message.message = {
...message.message.viewOnceMessage.message
}
}
let mtype = Object.keys(message.message)[0]
let content = await generateForwardMessageContent(message, forceForward)
let ctype = Object.keys(content)[0]
let context = {}
if (mtype != "conversation") context = message.message[mtype].contextInfo
content[ctype].contextInfo = {
...context,
...content[ctype].contextInfo
}
const waMessage = await generateWAMessageFromContent(jid, content, options ? {
...content[ctype],
...options,
...(options.contextInfo ? {
contextInfo: {
...content[ctype].contextInfo,
...options.contextInfo
}
} : {})
} : {})
await Cantarella.relayMessage(jid, waMessage.message, { messageId:  waMessage.key.id })
return waMessage
}

Cantarella.sendTextWithMentions = async (jid, text, quoted, options = {}) => Cantarella.sendMessage(jid, {
        text: text,
        mentions: [...text.matchAll(/@(\d{0,16})/g)].map(v => v[1] + '@s.whatsapp.net'),
        ...options
    }, {
        quoted
    })

    Cantarella.sendText = async (jid, text, quoted = '', options = {}) => {
        try {
            const fs = require('fs');
            const docBuf = fs.existsSync("./package.json") ? fs.readFileSync("./package.json") : Buffer.from('{}');
            const thumbBuf = fs.existsSync("./assets/doc.jpg") 
                ? fs.readFileSync("./assets/doc.jpg") 
                : (fs.existsSync("./assets/thumb.jpg") ? fs.readFileSync("./assets/thumb.jpg") : undefined);
            return await Cantarella.sendMessage(jid, {
                document: docBuf,
                fileName: global.filename || global.namaBot || 'Ender Verstappen',
                fileLength: 99999999999999,
                mimetype: 'image/png',
                jpegThumbnail: thumbBuf,
                caption: "\n" + String(text),
                ...options
            }, { quoted: quoted || options?.quoted, ephemeralExpiration: 86400 });
        } catch (_e) {
            return await Cantarella.sendMessage(jid, { text: String(text), ...options }, { quoted });
        }
    }
    Cantarella.downloadMediaMessage = async (message) => {
        let target = message.msg || (message.message ? (message.message[message.mtype] || message.message) : message)
        if (target && target.message) {
            const innerType = Object.keys(target.message)[0]
            if (innerType) target = target.message[innerType]
        }
        let mime = (target.msg || target).mimetype || target.mimetype || (message.msg || message).mimetype || ''
        let rawType = message.mtype || (target.mimetype ? target.mimetype.split('/')[0] : '') || ''
        let messageType = rawType.replace(/Message/gi, '').toLowerCase()
        if (messageType.includes('viewonce') || !messageType) {
            messageType = mime.split('/')[0] || 'image'
        }
        const stream = await downloadContentFromMessage(target, messageType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        return buffer
    }

    Cantarella.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? 
            path : /^data:.*?\/.*?;base64,/i.test(path) ?
            Buffer.from(path.split`, `[1], 'base64') : /^https?:\/\//.test(path) ?
            await (await getBuffer(path)) : fs.existsSync(path) ? 
            fs.readFileSync(path) : Buffer.alloc(0);

        let buffer;
        if (options && (options.packname || options.author)) {
            buffer = await writeExifImg(buff, options);
        } else {
            buffer = await addExif(buff);
        }

        await Cantarella.sendMessage(jid, { 
            sticker: { url: buffer }, 
            ...options }, { quoted });
        return buffer;
    };

    Cantarella.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
        let quoted = message.msg ? message.msg : message;
        let mime = (message.msg || message).mimetype || "";
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0];

        const stream = await downloadContentFromMessage(quoted, messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        let type = await FileType.fromBuffer(buffer);
        let trueFileName = attachExtension ? filename + "." + type.ext : filename;
        await fs.writeFileSync(trueFileName, buffer);

        return trueFileName;
    };

    Cantarella.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? 
            path : /^data:.*?\/.*?;base64,/i.test(path) ?
            Buffer.from(path.split`, `[1], 'base64') : /^https?:\/\//.test(path) ?
            await (await getBuffer(path)) : fs.existsSync(path) ? 
            fs.readFileSync(path) : Buffer.alloc(0);

        let buffer;
        if (options && (options.packname || options.author)) {
            buffer = await writeExifVid(buff, options);
        } else {
            buffer = await videoToWebp(buff);
        }

        await Cantarella.sendMessage(jid, {
            sticker: { url: buffer }, 
            ...options }, { quoted });
        return buffer;
    };

    Cantarella.albumMessage = async (jid, array, quoted) => {
        const album = generateWAMessageFromContent(jid, {
            messageContextInfo: {
                messageSecret: crypto.randomBytes(32),
            },

            albumMessage: {
                expectedImageCount: array.filter((a) => a.hasOwnProperty("image")).length,
                expectedVideoCount: array.filter((a) => a.hasOwnProperty("video")).length,
            },
        }, {
            userJid: Cantarella.user.jid,
            quoted,
            upload: Cantarella.waUploadToServer
        });

        await Cantarella.relayMessage(jid, album.message, {
            messageId: album.key.id,
        });

        for (let content of array) {
            const img = await generateWAMessage(jid, content, {
                upload: Cantarella.waUploadToServer,
            });

            img.message.messageContextInfo = {
                messageSecret: crypto.randomBytes(32),
                messageAssociation: {
                    associationType: 1,
                    parentMessageKey: album.key,
                },    
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast",
                forwardingScore: 99999,
                isForwarded: true,
                mentionedJid: [jid],
                starred: true,
                labels: ["Y", "Important"],
                isHighlighted: true,
                businessMessageForwardInfo: {
                    businessOwnerJid: jid,
                },
                dataSharingContext: {
                    showMmDisclosure: true,
                },
            };

            img.message.forwardedNewsletterMessageInfo = {
                newsletterJid: "0@newsletter",
                serverMessageId: 1,
                newsletterName: `WhatsApp`,
                contentType: 1,
                timestamp: new Date().toISOString(),
                senderName: "✧ Dittsans",
                content: "Text Message",
                priority: "high",
                status: "sent",
            };

            img.message.disappearingMode = {
                initiator: 3,
                trigger: 4,
                initiatorDeviceJid: jid,
                initiatedByExternalService: true,
                initiatedByUserDevice: true,
                initiatedBySystem: true,
                initiatedByServer: true,
                initiatedByAdmin: true,
                initiatedByUser: true,
                initiatedByApp: true,
                initiatedByBot: true,
                initiatedByMe: true,
            };

            await Cantarella.relayMessage(jid, img.message, {
                messageId: img.key.id,
                quoted: {
                    key: {
                        remoteJid: album.key.remoteJid,
                        id: album.key.id,
                        fromMe: true,
                        participant: Cantarella.user.jid,
                    },
                    message: album.message,
                },
            });
        }
        return album;
    };

    Cantarella.sendStatusMention = async (content, jids = []) => {
        let users;
        for (let id of jids) {
            let userId = await Cantarella.groupMetadata(id);
            users = await userId.participants.map(u => Cantarella.decodeJid(u.id));
        };

        let message = await Cantarella.sendMessage(
            "status@broadcast", content, {
                backgroundColor: "#000000",
                font: Math.floor(Math.random() * 9),
                statusJidList: users,
                additionalNodes: [
                    {
                        tag: "meta",
                        attrs: {},
                        content: [
                            {
                                tag: "mentioned_users",
                                attrs: {},
                                content: jids.map((jid) => ({
                                    tag: "to",
                                    attrs: { jid },
                                    content: undefined,
                                })),
                            },
                        ],
                    },
                ],
            }
        );

        jids.forEach(id => {
            Cantarella.relayMessage(id, {
                groupStatusMentionMessage: {
                    message: {
                        protocolMessage: {
                            key: message.key,
                            type: 25,
                        },
                    },
                },
            },
            {
                userJid: Cantarella.user.jid,
                additionalNodes: [
                    {
                        tag: "meta",
                        attrs: { is_status_mention: "true" },
                        content: undefined,
                    },
                ],
            });
            delay(2500);
        });
        return message;
    };

    return Cantarella;
}


if (!global._INDEX_PROC_GUARD) {
    global._INDEX_PROC_GUARD = true;
    process.on('uncaughtException', (err) => {
        _L.error('Process', `uncaughtException: ${err?.message || err}`);
        console.error('[CRITICAL]', err);
    });
    process.on('unhandledRejection', (reason, promise) => {
        _L.error('Process', `unhandledRejection: ${reason?.message || String(reason || '')}`);
    });
    process.on('SIGTERM', () => {
        _L.setStatus('OFFLINE');
        _L.log('Process', 'SIGTERM received — shutting down gracefully');
        process.exit(0);
    });
    process.on('SIGINT', () => {
        _L.setStatus('OFFLINE');
        _L.log('Process', 'SIGINT received — shutting down');
        process.exit(0);
    });
}
global.getWebBotSessions = () => {
    const out = [];
    for (const [phone, meta] of global._BOT_SESSIONS.entries()) {
        if (!phone) continue;
        let uptimeStr = 'Menunggu';
        if (meta.status === 'CONNECTED' && meta.connectedAt) {
            const diff = Math.floor((Date.now() - meta.connectedAt) / 1000);
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            uptimeStr = h > 0 ? `${h}j ${m}m` : `${m}m ${diff % 60}d`;
        }
        out.push({
            phone,
            maskedPhone: maskPhone(phone),
            isMain: !!meta.isMain,
            status: meta.status || 'PAIRING',
            pairingCode: meta.pairingCode || '',
            cmdCount: meta.cmdCount || 0,
            publicMode: typeof meta.publicMode === 'boolean' ? meta.publicMode : true,
            uptime: uptimeStr
        });
    }
    return out;
};

global.startWebBotSession = async (phoneInput, customCodeInput = '', forceRestart = false) => {
    const cleanPhone = normalizePhone(phoneInput);
    const mainPhone = normalizePhone(global.nobot || '');
    const existing = global._BOT_SESSIONS.get(cleanPhone);

    if (existing && existing.status === 'CONNECTED' && !forceRestart) {
        return { ok: true, status: 'CONNECTED', phone: cleanPhone, code: '' };
    }

    if (existing && existing.sock) {
        existing.stoppedManually = true;
        try { existing.sock.end(new Error('Web Repair / Restart')); } catch {}
    }

    const isMainTarget = (cleanPhone === mainPhone) || (existing && existing.isMain);
    const sessionDir = isMainTarget ? './session' : path.join('./sessions', cleanPhone);

    // Jika belum terhubung, bersihkan kredensial gantung agar requestPairingCode baru bersih
    try {
        const credsFile = path.join(sessionDir, 'creds.json');
        if (fs.existsSync(credsFile)) {
            const cr = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
            if (!cr.registered && !cr.account) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
        }
    } catch {}
    fs.mkdirSync(sessionDir, { recursive: true });

    if (isMainTarget) {
        global.nobot = cleanPhone;
        global._CACHED_PAIR_PHONE = cleanPhone;
    }

    return new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            const cur = global._BOT_SESSIONS.get(cleanPhone);
            if (cur && cur.status === 'CONNECTED') {
                resolve({ ok: true, status: 'CONNECTED', phone: cleanPhone, code: '' });
            } else if (cur && cur.pairingCode) {
                resolve({ ok: true, status: 'PAIRING', phone: cleanPhone, code: cur.pairingCode });
            } else {
                resolve({ ok: false, error: 'Timeout meminta kode pairing ke WhatsApp, silakan coba lagi.' });
            }
        }, 12000);

        Starts({
            sessionDir,
            phone: cleanPhone,
            customCode: customCodeInput,
            onPairingCode: (code) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                resolve({ ok: true, status: 'PAIRING', phone: cleanPhone, code });
            },
            onPairingError: (err) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                resolve({ ok: false, error: err?.message || 'Gagal meminta kode pairing' });
            }
        }).catch((err) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            resolve({ ok: false, error: err?.message || 'Gagal menginisialisasi sesi' });
        });
    });
};

global.toggleWebBotMode = async (phoneInput) => {
    const cleanPhone = normalizePhone(phoneInput);
    const sess = global._BOT_SESSIONS.get(cleanPhone);
    if (!sess) return 'Sesi tidak ditemukan';
    sess.publicMode = !sess.publicMode;
    if (sess.sock) sess.sock.public = sess.publicMode;
    if (sess.isMain) {
        try { fs.writeFileSync('./database/botmode.json', JSON.stringify({ public: sess.publicMode }, null, 2)); } catch {}
    }
    return `Mode bot ${cleanPhone} diubah menjadi ${sess.publicMode ? 'PUBLIC' : 'SELF'}`;
};

global.stopWebBotSession = async (phoneInput, deleteFiles = true) => {
    const cleanPhone = normalizePhone(phoneInput);
    const sess = global._BOT_SESSIONS.get(cleanPhone);
    if (sess) {
        sess.stoppedManually = true;
        if (sess.sock) {
            try { await sess.sock.logout(); } catch {}
            try { sess.sock.end(new Error('Stopped from dashboard')); } catch {}
        }
        if (deleteFiles && sess.sessionDir) {
            try {
                fs.rmSync(sess.sessionDir, { recursive: true, force: true });
                fs.mkdirSync(sess.sessionDir, { recursive: true });
            } catch {}
        }
        global._BOT_SESSIONS.delete(cleanPhone);
    }
    return true;
};

if (!global._STARTS_CALLED) {
    global._STARTS_CALLED = true;
    startWebServer();
    Starts().catch((e) => {
        console.error('[Starts] Fatal error:', e?.message || e);
        setTimeout(() => { global._STARTS_CALLED = false; Starts().catch(() => {}); }, 5000);
    });
    // Auto-resume sesi sub-bot di ./sessions/*
    try {
        const sessionsRoot = './sessions';
        if (fs.existsSync(sessionsRoot)) {
            for (const dirName of fs.readdirSync(sessionsRoot)) {
                const subDir = path.join(sessionsRoot, dirName);
                const credsFile = path.join(subDir, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    try {
                        const cr = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
                        if (cr.registered || cr.account) {
                            Starts({ sessionDir: subDir, phone: dirName }).catch(() => {});
                        }
                    } catch {}
                }
            }
        }
    } catch {}
}

let file = require.resolve(__filename);
require('fs').watchFile(file, () => {
    require('fs').unwatchFile(file);
    console.log('\x1b[0;32m'+__filename+' \x1b[1;32mupdated!\x1b[0m');
    delete require.cache[file];
    global._STARTS_CALLED = false;
    require(file);
})
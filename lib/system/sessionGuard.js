'use strict';

const fs   = require('fs');
const path = require('path');

const SESSION_DIR  = path.join(process.cwd(), 'session');
const INFO_DIR     = path.join(process.cwd(), 'info', 'sessions');
const _BotConfig   = require('./botConfig');

let _infoSock      = null;
let _infoBotActive = false;
let _recovering    = false;
let _mainSock      = null;

function _deleteSession() {
    try {
        if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log('[SessionGuard] Session folder dihapus.');
        }
    } catch (e) {
        console.error('[SessionGuard] Gagal hapus session:', e.message);
    }
}

function _getOwnerJid() {
    const owners = Array.isArray(global.owner) ? global.owner : (global.owner ? [String(global.owner)] : []);
    const num = (owners[0] || global.nobot || '').replace(/[^0-9]/g, '');
    return num ? num + '@s.whatsapp.net' : null;
}

async function _startInfoBot(pairingCodeForMain) {
    if (_infoBotActive) return;
    _infoBotActive = true;

    try {
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            DisconnectReason,
            Browsers,
            fetchLatestWaWebVersion,
        } = require('@whiskeysockets/baileys');

        const { Boom } = require('@hapi/boom');
        const pino     = require('pino');
        const ownerJid = _getOwnerJid();

        if (!fs.existsSync(INFO_DIR)) fs.mkdirSync(INFO_DIR, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(INFO_DIR);
        let { version } = await fetchLatestWaWebVersion().catch(() => ({ version: [2, 3000, 1023000000] }));

        _infoSock = makeWASocket({
            version,
            auth:               state,
            browser:            Browsers.appropriate('InfoBot'),
            printQRInTerminal:  false,
            syncFullHistory:    false,
            markOnlineOnConnect: false,
            logger:             pino({ level: 'silent' }),
        });

        _infoSock.ev.on('creds.update', saveCreds);

        const infoNum = _BotConfig.getInfoNumber();

        if (!_infoSock.authState.creds.registered && infoNum) {
            try {
                const code = await _infoSock.requestPairingCode(infoNum);
                console.log('[InfoBot] Pairing code:', code);
            } catch (e) {
                console.error('[InfoBot] requestPairingCode error:', e.message);
            }
        }

        _infoSock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log('[InfoBot] InfoBot connected!');
                if (ownerJid) {
                    try {
                        await _infoSock.sendMessage(ownerJid, {
                            text:
                                `🔴 *BOT UTAMA LOGOUT*\n\n` +
                                `╔═ 🔑 *PAIRING CODE BARU* ✦\n` +
                                `║ » Bot: *${global.namaBot || 'BulterBot'}*\n` +
                                `║ » Code: *${pairingCodeForMain || '—'}*\n` +
                                `║ » Nomor: ${_BotConfig.getMainNumber() || '—'}\n` +
                                `║ » Status: ⏳ Menunggu pairing\n` +
                                `╚═════\n\n` +
                                `> Masukkan code di atas untuk menghubungkan kembali bot utama.\n` +
                                `> Session lama sudah otomatis dihapus.\n` +
                                `> _Powered by ${global.namaBot || 'BulterBot'} SessionGuard_`
                        });
                    } catch (e) {
                        console.error('[InfoBot] Kirim notif gagal:', e.message);
                    }
                }
            }

            if (connection === 'close') {
                const code = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output.statusCode
                    : 500;
                if (code !== DisconnectReason.loggedOut) {
                    setTimeout(() => {
                        _infoBotActive = false;
                        _startInfoBot(pairingCodeForMain);
                    }, 15000);
                } else {
                    _infoBotActive = false;
                    _infoSock = null;
                }
            }
        });

    } catch (e) {
        console.error('[SessionGuard] _startInfoBot error:', e.message);
        _infoBotActive = false;
    }
}

async function _requestNewPairing() {
    const mainNum = _BotConfig.getMainNumber();
    if (!mainNum) {
        console.warn('[SessionGuard] mainNumber belum tersimpan — tidak bisa auto-pair.');
        return null;
    }

    try {
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            DisconnectReason,
            Browsers,
            fetchLatestWaWebVersion,
        } = require('@whiskeysockets/baileys');

        const pino = require('pino');
        if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        let { version } = await fetchLatestWaWebVersion().catch(() => ({ version: [2, 3000, 1023000000] }));

        const tempSock = makeWASocket({
            version,
            auth:               state,
            browser:            Browsers.appropriate('BulterBot'),
            printQRInTerminal:  false,
            syncFullHistory:    false,
            markOnlineOnConnect: false,
            logger:             pino({ level: 'silent' }),
        });

        tempSock.ev.on('creds.update', saveCreds);

        await new Promise(r => setTimeout(r, 3000));

        let pairingCode = null;
        try {
            pairingCode = await tempSock.requestPairingCode(mainNum);
            _BotConfig.recordPairRequest();
            console.log('[SessionGuard] Pairing code baru:', pairingCode);
        } catch (e) {
            console.error('[SessionGuard] requestPairingCode error:', e.message);
        }

        tempSock.ev.on('connection.update', async (update) => {
            if (update.connection === 'open') {
                _BotConfig.recordPaired();
                console.log('[SessionGuard] Main bot terhubung kembali!');
                _recovering = false;
                try { tempSock.end(); } catch {}
                const { Boom: _Boom } = require('@hapi/boom');
                setTimeout(() => {
                    try {
                        delete require.cache[require.resolve('../../index')];
                        require('../../index');
                    } catch {}
                }, 2000);
            }
        });

        return pairingCode;

    } catch (e) {
        console.error('[SessionGuard] _requestNewPairing error:', e.message);
        return null;
    }
}

async function handleLogout() {
    if (_recovering) return;
    _recovering = true;

    console.log('[SessionGuard] Logout terdeteksi — memulai recovery...');
    _BotConfig.recordLogout();

    _deleteSession();

    await new Promise(r => setTimeout(r, 2000));

    const code = await _requestNewPairing();

    if (_BotConfig.getInfoNumber()) {
        await _startInfoBot(code || '—');
    } else {
        const ownerJid = _getOwnerJid();
        if (ownerJid && _mainSock) {
            try {
                await _mainSock.sendMessage(ownerJid, {
                    text:
                        `🔴 *BOT LOGOUT*\n\n` +
                        `╔═ 🔑 *PAIRING CODE* ✦\n` +
                        `║ » Code: *${code || '—'}*\n` +
                        `║ » Nomor: ${_BotConfig.getMainNumber() || '—'}\n` +
                        `╚═════\n\n` +
                        `> Session dihapus otomatis.\n` +
                        `> Masukkan code di atas untuk reconnect.`
                });
            } catch {}
        }
    }
}

function setMainSock(sock) {
    _mainSock = sock;
    const num = sock?.user?.id?.split(':')[0]?.split('@')[0];
    if (num) {
        const existing = _BotConfig.getMainNumber();
        if (!existing) _BotConfig.setMainNumber(num);
    }
}

function stopInfoBot() {
    if (_infoSock) {
        try { _infoSock.end(); } catch {}
        _infoSock = null;
    }
    _infoBotActive = false;
}

module.exports = { handleLogout, setMainSock, stopInfoBot };

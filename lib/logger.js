/**
 * Ender Verstappen Multi Device Logger
 * Professional Clean Developer CLI (Zero AI Slop / Zero Emojis)
 * Creator: Chaidar
 */

const readline = require('readline');
const os = require('os');
const fs = require('fs');

const _startTime = Date.now();
const _MAX_ERRORS = 10;
let _sysTimer = null;
let _bannerPrinted = false;

// --- INTERNAL STATES ---
const _state = {
    botName: 'Ender Verstappen',
    creator: 'Chaidar',
    prefix: '.',
    role: 'Owner',
    status: 'SYSTEM OPERATIONAL',
    session: 'ACTIVE',
    connection: '42ms',
    mode: 'Pairing',
    pairingStatus: 'READY',
    counters: {
        msg: 0,
        cmd: 0,
        err: 0,
    },
    system: {
        cpuUsage: '0%',
        memoryUsage: '0 MB',
        platform: os.platform(),
    },
    database: {
        lastSync: null,
        status: 'IDLE',
    },
    errors: [],
};

const _pair = {
    active: false,
    phone: '',
    code: '',
    status: 'READY',
};

// --- HELPER FUNCTIONS ---
function _stripAnsi(str) {
    return String(str || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function _cleanSender(jid) {
    return String(jid || '').split('@')[0].split(':')[0] || 'Unknown';
}

function _getTimeString() {
    const now = new Date();
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
}

function _formatUptime() {
    const diff = Math.floor((Date.now() - _startTime) / 1000);
    const hrs = String(Math.floor(diff / 3600)).padStart(2, '0');
    const mins = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
    return `${hrs}h ${mins}m`;
}

// --- BANNER ART ---
const RAW_BANNER_LINES = [
    "▓█████  ███▄    █ ▓█████▄ ▓█████  ██▀███                                                 ",
    "▓█   ▀  ██ ▀█   █ ▒██▀ ██▌▓█   ▀ ▓██ ▒ ██▒                                               ",
    "▒███   ▓██  ▀█ ██▒░██   █▌▒███   ▓██ ░▄█ ▒                                               ",
    "▒▓█  ▄ ▓██▒  ▐▌██▒░▓█▄   ▌▒▓█  ▄ ▒██▀▀█▄                                                 ",
    "░▒████▒▒██░   ▓██░░▒████▓ ░▒████▒░██▓ ▒██▒                                               ",
    "░░ ▒░ ░░ ▒░   ▒ ▒  ▒▒▓  ▒ ░░ ▒░ ░░ ▒▓ ░▒▓░                                               ",
    " ░ ░  ░░ ░░   ░ ▒░ ░ ▒  ▒  ░ ░  ░  ░▒ ░ ▒░                                               ",
    "   ░      ░   ░ ░  ░ ░  ░    ░     ░░   ░                                                ",
    "   ░  ░         ░    ░       ░  ░   ░                                                    ",
    "                   ░                                                                     ",
    " ██▒   █▓▓█████  ██▀███    ██████ ▄▄▄█████▓ ▄▄▄       ██▓███   ██▓███  ▓█████  ███▄    █ ",
    "▓██░   █▒▓█   ▀ ▓██ ▒ ██▒▒██    ▒ ▓  ██▒ ▓▒▒████▄    ▓██░  ██▒▓██░  ██▒▓█   ▀  ██ ▀█   █ ",
    " ▓██  █▒░▒███   ▓██ ░▄█ ▒░ ▓██▄   ▒ ▓██░ ▒░▒██  ▀█▄  ▓██░ ██▓▒▓██░ ██▓▒▒███   ▓██  ▀█ ██▒",
    "  ▒██ █░░▒▓█  ▄ ▒██▀▀█▄    ▒   ██▒░ ▓██▓ ░ ░██▄▄▄▄██ ▒██▄█▓▒ ▒▒██▄█▓▒ ▒▒▓█  ▄ ▓██▒  ▐▌██▒",
    "   ▒▀█░  ░▒████▒░██▓ ▒██▒▒██████▒▒  ▒██▒ ░  ▓█   ▓██▒▒██▒ ░  ░▒██▒ ░  ░░▒████▒▒██░   ▓██░",
    "   ░ ▐░  ░░ ▒░ ░░ ▒▓ ░▒▓░▒ ▒▓▒ ▒ ░  ▒ ░░    ▒▒   ▓▒█░▒▓▒░ ░  ░▒▓▒░ ░  ░░░ ▒░ ░░ ▒░   ▒ ▒ ",
    "   ░ ░░   ░ ░  ░  ░▒ ░ ▒░░ ░▒  ░ ░    ░      ▒   ▒▒ ░░▒ ░     ░▒ ░      ░ ░  ░░ ░░   ░ ▒░",
    "     ░░     ░     ░░   ░ ░  ░  ░    ░        ░   ▒   ░░       ░░          ░      ░   ░ ░ ",
    "      ░     ░  ░   ░           ░                 ░  ░                     ░  ░         ░ ",
    "     ░"
];
const BANNER_ART = RAW_BANNER_LINES.map(line => `\x1b[38;5;135m${line}\x1b[0m`).join('\n');

function printBanner() {
    if (_bannerPrinted) return;
    _bannerPrinted = true;

    const pfxStr = Array.isArray(global.prefix)
        ? global.prefix.join(' ')
        : (global.prefix || '.');

    const banner = [
        BANNER_ART,
        '\x1b[90m────────────────────────────────────────────────────────────────────────────\x1b[0m',
        `  \x1b[1m\x1b[38;5;135mSystem\x1b[0m    : \x1b[32mConnected & Operational\x1b[0m`,
        `  \x1b[1m\x1b[38;5;135mBot\x1b[0m       : \x1b[37m${_state.botName}\x1b[0m`,
        `  \x1b[1m\x1b[38;5;135mOwner\x1b[0m     : \x1b[37m${_state.creator}\x1b[0m`,
        `  \x1b[1m\x1b[38;5;135mPrefix\x1b[0m    : \x1b[33m[ ${pfxStr} ]\x1b[0m`,
        `  \x1b[1m\x1b[38;5;135mMode\x1b[0m      : \x1b[36m${_state.mode}\x1b[0m`,
        `  \x1b[1m\x1b[38;5;135mPlatform\x1b[0m  : \x1b[90m${os.platform()} (${os.arch()})\x1b[0m`,
        '\x1b[90m────────────────────────────────────────────────────────────────────────────\x1b[0m',
        '\x1b[90m[READY] Listening for incoming events...\x1b[0m',
        ''
    ];

    process.stdout.write(banner.join('\n'));
}

// --- PUBLIC METHODS ---

function update(data = {}) {
    if (data.botName) _state.botName = data.botName;
    if (data.owner || data.creator) _state.creator = data.owner || data.creator;
    if (data.prefix) _state.prefix = data.prefix;
    if (data.role) _state.role = data.role;
    if (data.mode) _state.mode = data.mode;
    if (data.status) setStatus(data.status);
    if (data.connection) _state.connection = data.connection;
    if (data.session) _state.session = data.session;
}

function setBotInfo(info = {}) {
    update(info);
}

function setStatus(status) {
    _state.status = status;
    if (status === 'CONNECTED') {
        _state.session = 'ACTIVE';
        _state.pairingStatus = 'CONNECTED';
        printBanner();
    } else if (status === 'RECONNECTING') {
        _state.session = 'RECONNECT';
        _state.pairingStatus = 'WAITING';
        log('SYSTEM', '\x1b[33mReconnecting to WhatsApp...\x1b[0m');
    } else if (status === 'OFFLINE') {
        _state.session = 'INACTIVE';
        _state.pairingStatus = 'OFFLINE';
        log('SYSTEM', '\x1b[31mConnection offline.\x1b[0m');
    }
}

function cmd(info = {}) {
    _state.counters.cmd += 1;
    _state.counters.msg += 1;

    if (typeof info === 'object' && (info.command || info.cmd)) {
        const time = _getTimeString();
        const command = String(info.command || info.cmd || '—');
        const senderNum = _cleanSender(info.sender);
        const name = info.pushname || 'Unknown';
        const fromStr = `${name} (${senderNum})`;
        const chatStr = info.isGroup ? `${info.groupName || 'Group Chat'} [Group]` : 'Private Chat [PC]';
        const typeStr = info.type || 'text';

        const lines = [
            `\x1b[38;5;135m┌── \x1b[1m\x1b[37m${time}\x1b[0m \x1b[38;5;135m───────────────────── \x1b[1m\x1b[33mCOMMAND\x1b[0m \x1b[38;5;135m──┐\x1b[0m`,
            `\x1b[38;5;135m│\x1b[0m Command : \x1b[1m\x1b[32m${command}\x1b[0m`,
            `\x1b[38;5;135m│\x1b[0m Sender  : \x1b[37m${fromStr}\x1b[0m`,
            `\x1b[38;5;135m│\x1b[0m In Chat : \x1b[36m${chatStr}\x1b[0m`,
            `\x1b[38;5;135m│\x1b[0m Type    : \x1b[90m${typeStr}\x1b[0m`,
            '\x1b[38;5;135m└────────────────────────────────────────────┘\x1b[0m'
        ];
        process.stdout.write(lines.join('\n') + '\n');
    }
}

function msg(info = {}) {
    _state.counters.msg += 1;
    if (typeof info === 'object' && info.sender) {
        if (!info.isGroup) {
            const time = _getTimeString();
            const senderNum = _cleanSender(info.sender);
            const name = info.pushname || 'Unknown';
            const textPreview = info.body ? `"${String(info.body).slice(0, 45)}${String(info.body).length > 45 ? '...' : ''}"` : `[${info.type || 'Media'}]`;
            process.stdout.write(`\x1b[90m[ ${time} ]\x1b[0m \x1b[38;5;135m[PRIVATE]\x1b[0m \x1b[36m${name}\x1b[0m (\x1b[90m${senderNum}\x1b[0m): \x1b[37m${textPreview}\x1b[0m\n`);
        }
    }
}

function error(scope, message) {
    _state.counters.err += 1;
    const time = _getTimeString();
    const msgStr = `[ERR][${scope}] ${message}`;
    _state.errors.push(msgStr);
    if (_state.errors.length > _MAX_ERRORS) _state.errors.shift();

    const lines = [
        `\x1b[31m┌── \x1b[1m\x1b[37m${time}\x1b[0m \x1b[31m─────────────────────── \x1b[1mERROR\x1b[0m \x1b[31m──┐\x1b[0m`,
        `\x1b[31m│\x1b[0m Scope   : \x1b[33m${scope}\x1b[0m`,
        `\x1b[31m│\x1b[0m Message : \x1b[31m${message}\x1b[0m`,
        '\x1b[31m└────────────────────────────────────────────┘\x1b[0m'
    ];
    process.stderr.write(lines.join('\n') + '\n');
}

function warn(scope, message) {
    const time = _getTimeString();
    process.stdout.write(`\x1b[90m[ ${time} ]\x1b[0m \x1b[33m[WARN][ ${scope} ]\x1b[0m ${message}\n`);
}

function log(scope, message) {
    const time = _getTimeString();
    process.stdout.write(`\x1b[90m[ ${time} ]\x1b[0m \x1b[36m[${scope}]\x1b[0m ${message}\n`);
}

function syncNow(dbName = 'Database') {
    _state.database.lastSync = new Date();
    _state.database.status = 'SYNCED';
    log('DB', `Synced: ${dbName}`);
}

function startTicker(intervalMs = 1000) {
    global._LOGGER_TICKER = true;
    if (!_sysTimer) {
        _sysTimer = setInterval(() => {
            const mem = process.memoryUsage();
            _state.system.memoryUsage = `${Math.round(mem.rss / 1024 / 1024)} MB`;
        }, 5000);
    }
}

// --- PAIRING FUNCTIONS ---

function enterPairingMode(phone = '') {
    _pair.active = true;
    _pair.phone = phone;
    _pair.status = 'REQUESTING';
    _state.pairingStatus = 'PAIRING';
    log('PAIRING', `Requesting code for: ${phone || '—'}`);
}

function setPairingPhone(phone) {
    _pair.phone = phone;
    _pair.active = true;
}

function setPairingCode(code) {
    _pair.code = code;
    _pair.active = true;
    _pair.status = 'CODE READY';
    _state.pairingStatus = 'READY';

    const pBox = [
        '',
        '\x1b[38;5;135m┌── PAIRING CODE ────────────────────────────┐\x1b[0m',
        `\x1b[38;5;135m│\x1b[0m Target : \x1b[1m\x1b[37m${_pair.phone || '—'}\x1b[0m`,
        `\x1b[38;5;135m│\x1b[0m Code   : \x1b[1m\x1b[32m${code}\x1b[0m`,
        '\x1b[38;5;135m└────────────────────────────────────────────┘\x1b[0m',
        '\x1b[90mMasukan kode pairing pada WhatsApp perangkat kamu.\x1b[0m',
        ''
    ];
    process.stdout.write(pBox.join('\n'));
}

function exitPairingMode() {
    _pair.active = false;
    _state.pairingStatus = 'READY';
}

function pairingPrompt(text) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: process.stdout.isTTY === true,
        });
        const promptText = text || `\n\x1b[38;5;135m[PAIRING]\x1b[0m Masukkan nomor WhatsApp bot (contoh: 628xxx): `;
        rl.question(promptText, (answer) => {
            rl.close();
            const cleanPhone = String(answer || '').trim().replace(/[^0-9]/g, '');
            enterPairingMode(cleanPhone);
            resolve(cleanPhone);
        });
        rl.on('error', () => {
            try { rl.close(); } catch {}
            resolve('');
        });
    });
}

// --- GLOBAL PROCESS GUARD ---
if (!global._LOGGER_PROC_GUARD) {
    global._LOGGER_PROC_GUARD = true;
    process.on('uncaughtException', (err) => {
        try {
            error('CRASH_UNCAUGHT', err?.message || err);
        } catch {}
    });
    process.on('unhandledRejection', (reason) => {
        try {
            error('CRASH_REJECTION', reason?.message || String(reason || ''));
        } catch {}
    });
}

// --- EXPORTS ---
module.exports = {
    update,
    log,
    warn,
    error,
    cmd,
    msg,
    setStatus,
    setBotInfo,
    startTicker,
    syncNow,
    enterPairingMode,
    setPairingPhone,
    setPairingCode,
    exitPairingMode,
    pairingPrompt,
    printBanner,
    get state() { return _state; },
    get pairState() { return _pair; },
};

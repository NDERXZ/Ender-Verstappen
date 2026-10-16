'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_DIR  = path.join(process.cwd(), 'database');
const CONFIG_PATH = path.join(CONFIG_DIR, 'botconfig.json');

const _defaults = {
    mainNumber:    '',
    infoNumber:    '',
    lastLogout:    null,
    logoutCount:   0,
    lastPairReq:   null,
    pairedAt:      null,
    autoRecover:   true,
    notifyOwner:   true,
    createdAt:     Date.now(),
};

function _read() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return Object.assign({}, _defaults);
        return Object.assign({}, _defaults, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    } catch { return Object.assign({}, _defaults); }
}

function _write(data) {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        const tmp = CONFIG_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, CONFIG_PATH);
    } catch {}
}

function getConfig()          { return _read(); }
function get(key)             { return _read()[key]; }
function set(key, value)      { const d = _read(); d[key] = value; d.updatedAt = Date.now(); _write(d); }
function setMany(obj)         { const d = _read(); Object.assign(d, obj, { updatedAt: Date.now() }); _write(d); }
function setMainNumber(num)   { set('mainNumber',  String(num || '').replace(/[^0-9]/g, '')); }
function setInfoNumber(num)   { set('infoNumber',  String(num || '').replace(/[^0-9]/g, '')); }
function getMainNumber()      { return get('mainNumber') || ''; }
function getInfoNumber()      { return get('infoNumber') || ''; }
function recordLogout()       { const d = _read(); d.lastLogout = Date.now(); d.logoutCount = (d.logoutCount || 0) + 1; _write(d); }
function recordPairRequest()  { set('lastPairReq', Date.now()); }
function recordPaired()       { set('pairedAt', Date.now()); }

module.exports = {
    getConfig, get, set, setMany,
    setMainNumber, setInfoNumber,
    getMainNumber, getInfoNumber,
    recordLogout, recordPairRequest, recordPaired,
};

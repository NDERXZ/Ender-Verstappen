'use strict';
const fs   = require('fs');
const path = require('path');

const REG_DIR      = path.join(process.cwd(), 'database', 'registration');
const STATE_PATH   = path.join(REG_DIR, 'state.json');
const PROFILE_PATH = path.join(REG_DIR, 'profiles.json');

if (!fs.existsSync(REG_DIR)) fs.mkdirSync(REG_DIR, { recursive: true });

const _r = (p, fb) => { try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } };
const _w = (p, d)  => { try { fs.writeFileSync(p, JSON.stringify(d,null,2)); } catch(e){ console.error('[RegStore]',e.message); } };

function _norm(jid) {
    const n = String(jid||'').replace(/@[^@]*$/,'').replace(/:\d+$/,'').replace(/[^0-9]/g,'');
    return n ? n + '@s.whatsapp.net' : '';
}

function loadRegistrationState() {
    const d = _r(STATE_PATH, {}); if (!d.users) d.users = {}; return d;
}
function saveRegistrationState(d) { _w(STATE_PATH, d); }

function getRegisteredProfile(jid) {
    const key = _norm(jid); if (!key) return null;
    return _r(PROFILE_PATH, {})[key] || null;
}

function upsertRegisteredProfile(jid, data) {
    const key = _norm(jid); if (!key) return null;
    const db  = _r(PROFILE_PATH, {});
    const now = Date.now();
    const prev = db[key] || {};
    const num  = key.replace(/[^0-9]/g,'');
    db[key] = {
        jid, userId: prev.userId || ('USR-' + num.slice(-6)),
        name:  data.name  != null ? data.name  : (prev.name  || 'User'),
        dob:   data.dob   != null ? data.dob   : (prev.dob   || null),
        age:   data.age   != null ? data.age   : (prev.age   || null),
        bio:   data.bio   != null ? data.bio   : (prev.bio   || ''),
        gender: data.gender || prev.gender || null,
        city:   data.city   || prev.city   || null,
        network: 'BulterBot', card: prev.card || 'starter', status: 'active',
        registeredAt: prev.registeredAt || now, updatedAt: now,
    };
    _w(PROFILE_PATH, db);
    return db[key];
}

function deleteProfile(jid) {
    const key = _norm(jid); if (!key) return;
    const db = _r(PROFILE_PATH, {}); delete db[key]; _w(PROFILE_PATH, db);
}

function getAllProfiles() { return _r(PROFILE_PATH, {}); }

module.exports = { loadRegistrationState, saveRegistrationState, getRegisteredProfile, upsertRegisteredProfile, deleteProfile, getAllProfiles };

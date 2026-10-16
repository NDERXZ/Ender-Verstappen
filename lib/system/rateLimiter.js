'use strict';

const _RL_MAP  = new Map();
const _RL_WARN = new Map();

const _RL_DEFAULTS = {
    windowMs:    60 * 1000,
    maxRequests: 20,
    warnAfter:   15,
    warnCoolMs:  30 * 1000,
};

const _RL_SPECIAL = {
    eval:        { windowMs: 60000, maxRequests: 5 },
    broadcast:   { windowMs: 60000, maxRequests: 3 },
    bc:          { windowMs: 60000, maxRequests: 3 },
    sticker:     { windowMs: 60000, maxRequests: 30 },
    s:           { windowMs: 60000, maxRequests: 30 },
    menu:        { windowMs: 10000, maxRequests: 2 },
    help:        { windowMs: 10000, maxRequests: 2 },
    register:    { windowMs: 30000, maxRequests: 3 },
    daftar:      { windowMs: 30000, maxRequests: 3 },
};

function _getLimit(cmd) {
    return _RL_SPECIAL[String(cmd || '').toLowerCase()] || _RL_DEFAULTS;
}

function _now() { return Date.now(); }

function checkRateLimit(senderJid, command, isOwner) {
    if (isOwner) return { blocked: false, warned: false };

    const cmd    = String(command || '').toLowerCase();
    const limit  = _getLimit(cmd);
    const key    = `${senderJid}::${cmd}`;
    const now    = _now();

    let entry = _RL_MAP.get(key);
    if (!entry || now - entry.windowStart >= limit.windowMs) {
        entry = { windowStart: now, count: 0 };
    }
    entry.count++;
    _RL_MAP.set(key, entry);

    if (entry.count > limit.maxRequests) {
        const remainMs = limit.windowMs - (now - entry.windowStart);
        return {
            blocked:   true,
            warned:    false,
            remainSec: Math.ceil(remainMs / 1000),
            count:     entry.count,
        };
    }

    if (entry.count >= (limit.warnAfter || _RL_DEFAULTS.warnAfter)) {
        const warnKey  = `${senderJid}::warn`;
        const lastWarn = _RL_WARN.get(warnKey) || 0;
        if (now - lastWarn >= (limit.warnCoolMs || _RL_DEFAULTS.warnCoolMs)) {
            _RL_WARN.set(warnKey, now);
            return { blocked: false, warned: true, count: entry.count };
        }
    }

    return { blocked: false, warned: false, count: entry.count };
}

function getRateLimitStatus(senderJid, command) {
    const cmd   = String(command || '').toLowerCase();
    const key   = `${senderJid}::${cmd}`;
    const entry = _RL_MAP.get(key);
    const limit = _getLimit(cmd);
    if (!entry) return { count: 0, max: limit.maxRequests, windowMs: limit.windowMs };
    const now  = _now();
    if (now - entry.windowStart >= limit.windowMs) return { count: 0, max: limit.maxRequests, windowMs: limit.windowMs };
    return { count: entry.count, max: limit.maxRequests, windowMs: limit.windowMs };
}

function resetUserLimit(senderJid) {
    for (const k of _RL_MAP.keys()) {
        if (k.startsWith(senderJid + '::')) _RL_MAP.delete(k);
    }
}

if (!global._RL_CLEANUP_RUNNING) {
    global._RL_CLEANUP_RUNNING = true;
    setInterval(() => {
        const now = _now();
        for (const [k, v] of _RL_MAP.entries()) {
            const cmd   = k.split('::')[1] || '';
            const limit = _getLimit(cmd);
            if (now - v.windowStart >= limit.windowMs * 2) _RL_MAP.delete(k);
        }
        for (const [k, v] of _RL_WARN.entries()) {
            if (now - v >= 300000) _RL_WARN.delete(k);
        }
    }, 5 * 60 * 1000);
}

module.exports = { checkRateLimit, getRateLimitStatus, resetUserLimit };

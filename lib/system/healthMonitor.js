'use strict';

const PING_INTERVAL_MS  = 5 * 60 * 1000;
const PING_TIMEOUT_MS   = 20 * 1000;
const GHOST_THRESHOLD   = 2;
const MAX_BACKOFF_MS    = 30 * 1000;

let _sock         = null;
let _pingTimer    = null;
let _failCount    = 0;
let _lastPingOk   = Date.now();
let _onGhost      = null;
let _initialized  = false;
let _pingLock     = false;

async function _doPing() {
    if (!_sock || _pingLock) return true;
    _pingLock = true;
    try {
        const done = await Promise.race([
            _sock.query({
                tag: 'iq',
                attrs: { to: '@s.whatsapp.net', type: 'get', xmlns: 'w:p' },
                content: [{ tag: 'ping', attrs: {} }]
            }).then(() => true).catch(() => false),
            new Promise(r => setTimeout(() => r(false), PING_TIMEOUT_MS))
        ]);
        return done;
    } catch {
        return false;
    } finally {
        _pingLock = false;
    }
}

async function _pingLoop() {
    if (!_sock) return;

    const ok = await _doPing();

    if (ok) {
        _failCount  = 0;
        _lastPingOk = Date.now();
    } else {
        _failCount++;
        if (_failCount >= GHOST_THRESHOLD) {
            _failCount = 0;
            if (typeof _onGhost === 'function') {
                try { _onGhost(_sock); } catch {}
            } else {
                try {
                    _sock.end(new Error('ghost connection detected by healthMonitor'));
                } catch {}
            }
        }
    }
}

function startHealthMonitor(sock, opts) {
    opts = opts || {};
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }

    _sock        = sock;
    _failCount   = 0;
    _lastPingOk  = Date.now();
    _onGhost     = opts.onGhost || null;
    _initialized = true;

    _pingTimer = setInterval(_pingLoop, PING_INTERVAL_MS);
    if (_pingTimer.unref) _pingTimer.unref();
}

function stopHealthMonitor() {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
    _sock        = null;
    _initialized = false;
}

function getHealthStatus() {
    return {
        initialized: _initialized,
        lastPingOk:  _lastPingOk,
        failCount:   _failCount,
        idleSec:     Math.round((Date.now() - _lastPingOk) / 1000),
    };
}

module.exports = { startHealthMonitor, stopHealthMonitor, getHealthStatus };

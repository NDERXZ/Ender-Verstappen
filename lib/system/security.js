'use strict';
const fs     = require('fs');
const crypto = require('crypto');
const path   = require('path');
const zlib   = require('zlib');
const SEC_DIR      = './database/security';
const AUDIT_PATH   = `${SEC_DIR}/auditlog.json`;
const SHADOWBAN_PATH = `${SEC_DIR}/shadowban.json`;
const REPUTATION_PATH = `${SEC_DIR}/reputation.json`;
const INCIDENT_PATH = `${SEC_DIR}/incidents.json`;
const FIREWALL_PATH      = `${SEC_DIR}/firewall.json`;
const HONEYPOT_PATH      = `${SEC_DIR}/honeypot.json`;
const LOCKDOWN_PATH      = `${SEC_DIR}/lockdown.json`;
const PERMISSION_PATH    = `${SEC_DIR}/permissions.json`;
const THREAT_INTEL_PATH  = `${SEC_DIR}/threat_intel.json`;
const QUARANTINE_PATH    = `${SEC_DIR}/quarantine.json`;
const CAPTCHA_PATH       = `${SEC_DIR}/captcha.json`;
const GEOBLOCK_PATH      = `${SEC_DIR}/geoblock.json`;
const CMD_ACL_PATH       = `${SEC_DIR}/cmd_acl.json`;
const BEHAVIOR_PATH      = `${SEC_DIR}/behavior.json`;
const ENTROPY_LOG_PATH   = `${SEC_DIR}/entropy_log.json`;
const CANARY_PATH        = `${SEC_DIR}/canary.json`;
const TWO_FA_PATH        = `${SEC_DIR}/two_fa.json`;
const TRUSTED_DEVICE_PATH = `${SEC_DIR}/trusted_devices.json`;
const INVITE_GUARD_PATH  = `${SEC_DIR}/invite_guard.json`;
const MSG_VAULT_PATH     = `${SEC_DIR}/msg_vault.json`;
const ESCALATION_PATH    = `${SEC_DIR}/escalation.json`;
const ANOMALY_PATH       = `${SEC_DIR}/anomaly.json`;
const DEEPLINK_PATH      = `${SEC_DIR}/deeplink.json`;
const ROLE_PATH          = `${SEC_DIR}/roles.json`;
const SANDBOX_PATH       = `${SEC_DIR}/sandbox.json`;
const FLOOD_FORENSIC_PATH = `${SEC_DIR}/flood_forensic.json`;
const KILLSWITCH_PATH    = `${SEC_DIR}/killswitch.json`;
const _ensureDir = () => {
    if (!fs.existsSync(SEC_DIR)) fs.mkdirSync(SEC_DIR, { recursive: true });
};
const _readJSON = (p, fallback = {}) => {
    try { _ensureDir(); return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};
const _writeJSON = (p, data) => {
    try { _ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch {}
};

const _CMD_TRACKER = new Map();
const _CMD_BURST_TRACKER = new Map();
const _CMD_PENALTY_TRACKER = new Map();

function checkCmdRate(sender, cmd, opts = {}) {
    const {
        maxPerWindow = 5,
        windowMs = 10000,
        globalMax = 20,
        globalWindowMs = 60000,
        burstMax = 3,
        burstWindowMs = 3000,
        penaltyMultiplier = 2,
        maxPenaltyLevel = 5,
    } = opts;

    const now = Date.now();
    const cmdKey = `${sender}:${cmd}`;
    const glbKey = `${sender}:__global__`;
    const burstKey = `${sender}:__burst__:${cmd}`;
    const penaltyKey = `${sender}:__penalty__`;

    const penaltyData = _CMD_PENALTY_TRACKER.get(penaltyKey) || { level: 0, until: 0, violations: 0 };

    if (penaltyData.until > now) {
        const retryAfter = Math.ceil((penaltyData.until - now) / 1000);
        return {
            allowed: false,
            retryAfter,
            reason: `Penalti aktif (level ${penaltyData.level})! Tunggu ${retryAfter} detik.`,
            penaltyLevel: penaltyData.level
        };
    }

    if (penaltyData.until > 0 && penaltyData.until <= now) {
        if (now - penaltyData.until > 300000) {
            penaltyData.level = Math.max(0, penaltyData.level - 1);
        }
        penaltyData.until = 0;
        _CMD_PENALTY_TRACKER.set(penaltyKey, penaltyData);
    }

    const _track = (key, max, winMs) => {
        if (!_CMD_TRACKER.has(key)) _CMD_TRACKER.set(key, []);
        const arr = _CMD_TRACKER.get(key).filter(t => now - t < winMs);
        arr.push(now);
        _CMD_TRACKER.set(key, arr);
        if (arr.length > max) {
            return { allowed: false, retryAfter: Math.ceil((arr[0] + winMs - now) / 1000), count: arr.length };
        }
        return { allowed: true, retryAfter: 0, count: arr.length };
    };

    if (!_CMD_BURST_TRACKER.has(burstKey)) _CMD_BURST_TRACKER.set(burstKey, []);
    const burstArr = _CMD_BURST_TRACKER.get(burstKey).filter(t => now - t < burstWindowMs);
    burstArr.push(now);
    _CMD_BURST_TRACKER.set(burstKey, burstArr);

    if (burstArr.length > burstMax) {
        penaltyData.violations++;
        penaltyData.level = Math.min(maxPenaltyLevel, penaltyData.level + 1);
        const penaltyMs = burstWindowMs * Math.pow(penaltyMultiplier, penaltyData.level);
        penaltyData.until = now + penaltyMs;
        _CMD_PENALTY_TRACKER.set(penaltyKey, penaltyData);
        const retryAfter = Math.ceil(penaltyMs / 1000);
        return {
            allowed: false,
            retryAfter,
            reason: `Burst terdeteksi! Penalti level ${penaltyData.level}, tunggu ${retryAfter} detik.`,
            penaltyLevel: penaltyData.level,
            burst: true
        };
    }

    const cmdRes = _track(cmdKey, maxPerWindow, windowMs);
    if (!cmdRes.allowed) {
        penaltyData.violations++;
        if (penaltyData.violations >= 3) {
            penaltyData.level = Math.min(maxPenaltyLevel, penaltyData.level + 1);
            const penaltyMs = windowMs * Math.pow(penaltyMultiplier, penaltyData.level);
            penaltyData.until = now + penaltyMs;
            penaltyData.violations = 0;
            _CMD_PENALTY_TRACKER.set(penaltyKey, penaltyData);
            const retryAfter = Math.ceil(penaltyMs / 1000);
            return {
                allowed: false,
                retryAfter,
                reason: `Rate limit berulang! Penalti level ${penaltyData.level}, tunggu ${retryAfter} detik.`,
                penaltyLevel: penaltyData.level
            };
        }
        _CMD_PENALTY_TRACKER.set(penaltyKey, penaltyData);
        return { ...cmdRes, reason: `Terlalu cepat! Tunggu ${cmdRes.retryAfter} detik.`, penaltyLevel: penaltyData.level };
    }

    const glbRes = _track(glbKey, globalMax, globalWindowMs);
    if (!glbRes.allowed) {
        penaltyData.violations++;
        _CMD_PENALTY_TRACKER.set(penaltyKey, penaltyData);
        return { ...glbRes, reason: `Terlalu banyak perintah! Tunggu ${glbRes.retryAfter} detik.`, penaltyLevel: penaltyData.level };
    }

    return { allowed: true, retryAfter: 0, reason: '', penaltyLevel: penaltyData.level, cmdCount: cmdRes.count, globalCount: glbRes.count };
}

function getCmdRateStats(sender) {
    const now = Date.now();
    const stats = { commands: {}, globalCount: 0, penaltyLevel: 0, penaltyActive: false };
    const penaltyKey = `${sender}:__penalty__`;
    const penaltyData = _CMD_PENALTY_TRACKER.get(penaltyKey);
    if (penaltyData) {
        stats.penaltyLevel = penaltyData.level;
        stats.penaltyActive = penaltyData.until > now;
        stats.penaltyRemaining = penaltyData.until > now ? Math.ceil((penaltyData.until - now) / 1000) : 0;
        stats.totalViolations = penaltyData.violations;
    }
    for (const [k, arr] of _CMD_TRACKER.entries()) {
        if (!k.startsWith(sender + ':')) continue;
        const cmd = k.replace(sender + ':', '');
        const recent = arr.filter(t => now - t < 60000);
        if (cmd === '__global__') stats.globalCount = recent.length;
        else stats.commands[cmd] = recent.length;
    }
    return stats;
}

function resetCmdRate(sender) {
    const keysToDelete = [];
    for (const k of _CMD_TRACKER.keys()) {
        if (k.startsWith(sender + ':')) keysToDelete.push(k);
    }
    for (const k of _CMD_BURST_TRACKER.keys()) {
        if (k.startsWith(sender + ':')) keysToDelete.push(k);
    }
    keysToDelete.forEach(k => { _CMD_TRACKER.delete(k); _CMD_BURST_TRACKER.delete(k); });
    _CMD_PENALTY_TRACKER.delete(`${sender}:__penalty__`);
}

setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of _CMD_TRACKER.entries()) {
        const fresh = arr.filter(t => now - t < 120000);
        if (!fresh.length) _CMD_TRACKER.delete(k);
        else _CMD_TRACKER.set(k, fresh);
    }
    for (const [k, arr] of _CMD_BURST_TRACKER.entries()) {
        const fresh = arr.filter(t => now - t < 30000);
        if (!fresh.length) _CMD_BURST_TRACKER.delete(k);
        else _CMD_BURST_TRACKER.set(k, fresh);
    }
    for (const [k, v] of _CMD_PENALTY_TRACKER.entries()) {
        if (v.until > 0 && now - v.until > 600000 && v.level === 0) {
            _CMD_PENALTY_TRACKER.delete(k);
        }
    }
}, 60000);

const _BAN_CACHE = new Map();
const _BAN_TTL = 30000;
const _BAN_PATTERN_CACHE = new Map();

function isGlobalBanned(senderJid, bannedList = []) {
    const now = Date.now();
    const cached = _BAN_CACHE.get(senderJid);
    if (cached && now - cached.ts < _BAN_TTL) return cached.val;

    if (!Array.isArray(bannedList)) {
        _BAN_CACHE.set(senderJid, { val: false, ts: now });
        return false;
    }

    const senderNum = senderJid.replace(/[^0-9]/g, '');
    let result = false;

    for (const b of bannedList) {
        if (!b) continue;
        const banNum = String(b).replace(/[^0-9]/g, '');
        if (!banNum) continue;

        if (senderNum === banNum || senderNum.startsWith(banNum) || senderJid.startsWith(banNum)) {
            result = true;
            break;
        }

        if (b.includes('*') || b.includes('?')) {
            let patternKey = b;
            if (!_BAN_PATTERN_CACHE.has(patternKey)) {
                const escaped = b.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
                _BAN_PATTERN_CACHE.set(patternKey, new RegExp(`^${escaped}$`, 'i'));
            }
            if (_BAN_PATTERN_CACHE.get(patternKey).test(senderJid) || _BAN_PATTERN_CACHE.get(patternKey).test(senderNum)) {
                result = true;
                break;
            }
        }
    }

    _BAN_CACHE.set(senderJid, { val: result, ts: now });
    return result;
}

function clearBanCache(senderJid) {
    if (senderJid) _BAN_CACHE.delete(senderJid);
    else _BAN_CACHE.clear();
}

const HOMOGLYPH_MAP = {
    '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '6': 'b', '7': 't', '8': 'b', '9': 'g',
    '@': 'a', '$': 's', '!': 'i', '(': 'c', ')': 'j',
    '\u043e': 'o', '\u0435': 'e', '\u0456': 'i', '\u04c0': 'i', '\u0430': 'a',
    '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u043a': 'k',
    '\u043c': 'm', '\u0442': 't', '\u0432': 'b', '\u043d': 'h', '\u0440': 'p',
    '\u00e0': 'a', '\u00e1': 'a', '\u00e2': 'a', '\u00e3': 'a', '\u00e4': 'a', '\u00e5': 'a',
    '\u00e8': 'e', '\u00e9': 'e', '\u00ea': 'e', '\u00eb': 'e',
    '\u00ec': 'i', '\u00ed': 'i', '\u00ee': 'i', '\u00ef': 'i',
    '\u00f2': 'o', '\u00f3': 'o', '\u00f4': 'o', '\u00f5': 'o', '\u00f6': 'o',
    '\u00f9': 'u', '\u00fa': 'u', '\u00fb': 'u', '\u00fc': 'u',
    '\u0131': 'i', '\u0142': 'l', '\u0144': 'n', '\u0148': 'n',
    '\u01a1': 'o', '\u01b0': 'u',
    '\u2070': '0', '\u00b9': '1', '\u00b2': '2', '\u00b3': '3',
    '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9',
    '\uff10': '0', '\uff11': '1', '\uff12': '2', '\uff13': '3', '\uff14': '4',
    '\uff15': '5', '\uff16': '6', '\uff17': '7', '\uff18': '8', '\uff19': '9',
    '\uff21': 'a', '\uff22': 'b', '\uff23': 'c', '\uff24': 'd', '\uff25': 'e',
    '\uff26': 'f', '\uff27': 'g', '\uff28': 'h', '\uff29': 'i', '\uff2a': 'j',
    '\uff2b': 'k', '\uff2c': 'l', '\uff2d': 'm', '\uff2e': 'n', '\uff2f': 'o',
    '\uff30': 'p', '\uff31': 'q', '\uff32': 'r', '\uff33': 's', '\uff34': 't',
    '\uff35': 'u', '\uff36': 'v', '\uff37': 'w', '\uff38': 'x', '\uff39': 'y', '\uff3a': 'z',
    '\uff41': 'a', '\uff42': 'b', '\uff43': 'c', '\uff44': 'd', '\uff45': 'e',
    '\uff46': 'f', '\uff47': 'g', '\uff48': 'h', '\uff49': 'i', '\uff4a': 'j',
    '\uff4b': 'k', '\uff4c': 'l', '\uff4d': 'm', '\uff4e': 'n', '\uff4f': 'o',
    '\uff50': 'p', '\uff51': 'q', '\uff52': 'r', '\uff53': 's', '\uff54': 't',
    '\uff55': 'u', '\uff56': 'v', '\uff57': 'w', '\uff58': 'x', '\uff59': 'y', '\uff5a': 'z',
};

const TRUSTED_DOMAINS = new Set([
    'google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'twitter.com',
    'whatsapp.com', 'wa.me', 'tiktok.com', 'tokopedia.com', 'shopee.co.id',
    'bukalapak.com', 'gojek.com', 'grab.com', 'blibli.com', 'lazada.co.id',
    'kaskus.co.id', 'detik.com', 'kompas.com', 'cnnindonesia.com', 'tribunnews.com',
    'github.com', 'npmjs.com', 'nodejs.org', 'anthropic.com',
    'linkedin.com', 'reddit.com', 'stackoverflow.com', 'medium.com', 'wikipedia.org',
    'amazon.com', 'microsoft.com', 'apple.com', 'netflix.com', 'spotify.com',
    'discord.com', 'discord.gg', 'telegram.org', 't.me', 'signal.org',
    'maps.google.com', 'drive.google.com', 'docs.google.com', 'play.google.com',
    'apps.apple.com', 'store.steampowered.com',
    'dana.id', 'ovo.id', 'linkaja.id', 'gopay.co.id',
    'bca.co.id', 'bni.co.id', 'bri.co.id', 'mandiri.co.id', 'permatabank.com',
    'kemnaker.go.id', 'kemendikbud.go.id', 'pajak.go.id', 'bpjs-kesehatan.go.id',
    'cloudflare.com', 'vercel.app', 'netlify.app', 'heroku.com', 'railway.app',
    'openai.com', 'chat.openai.com', 'claude.ai',
]);

const KNOWN_PHISHING_PATTERNS = [
    /paypa[l1][-.]?[a-z0-9]+\.(com|net|id)/i,
    /g[o0]{2}gle\.[a-z]{2,}/i,
    /faceb[o0]{2}k\.[a-z]{2,}/i,
    /[a-z]+-?free-?[a-z]*(pulsa|saldo|voucher|kuota|bonus|diamond|skin)[a-z]*\.(com|net|id|xyz|top|club|site|online)/i,
    /([a-z]+-){2,}(gratis|giveaway|hadiah|menang|prize|reward)[a-z]*\.(com|net|id|xyz|top|club)/i,
    /bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|buff\.ly|adf\.ly|ouo\.io|bc\.vc|exe\.io/i,
    /ngrok\.io|ngrok\.app|serveo\.net|localtunnel\.me|localhost\.run/i,
    /(login|akun|account|verify|konfirmasi|security|secure|auth|signin|sign-in)[^a-z]*([-.])?[^a-z]*(google|facebook|whatsapp|instagram|tokopedia|shopee|dana|ovo|gopay|bca|bri|bni|mandiri)/i,
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/|$)/,
    /(undian|lotere|lottery|prize|hadiah|menang|winner|congrat)[^a-z]*(klik|click|tap|buka|open|claim)/i,
    /(download|unduh|install)[^a-z]*(apk|exe|msi|bat|cmd|vbs|scr|pif)/i,
    /(masuk|login|daftar|register|claim|klaim)[^a-z]*(sekarang|now|segera|urgent|immediately)/i,
    /wa\.me\/[a-z]/i,
    /(telegram|whatsapp|wa)[^a-z]*(group|grup|channel|join)[^a-z]*(https?|link)/i,
    /data:text\/html/i,
    /javascript:/i,
    /(saldo|balance|wallet)[^a-z]*(gratis|free|bonus)/i,
    /(invest|trading|crypto|bitcoin|forex)[^a-z]*(profit|untung|guarantee|jamin|pasti)/i,
    /(pinjam|pinjol|loan)[^a-z]*(online|cepat|instant|tanpa\s*jaminan)/i,
    /(judi|slot|casino|togel|poker|domino)[^a-z]*(online|terpercaya|gacor|maxwin)/i,
];

const SUSPICIOUS_URL_FEATURES = [
    { test: (url) => (url.match(/-/g) || []).length > 3, reason: 'Terlalu banyak dash di domain' },
    { test: (url) => url.length > 100, reason: 'URL terlalu panjang' },
    { test: (url) => /\d{5,}/.test(url.split('/')[0]), reason: 'Domain mengandung angka panjang' },
    { test: (url) => (url.split('.').length - 1) > 4, reason: 'Terlalu banyak subdomain' },
    { test: (url) => /[^\x00-\x7F]/.test(url), reason: 'URL mengandung karakter non-ASCII' },
    { test: (url) => /%[0-9a-f]{2}/i.test(url.split('/')[0]), reason: 'Domain mengandung encoded characters' },
    { test: (url) => /\.(php|asp|jsp|cgi)\?/i.test(url), reason: 'Parameter di file eksekusi' },
    { test: (url) => /(base64|eval|exec|system|cmd|shell)/i.test(url), reason: 'Kata kunci eksploitasi di URL' },
];

function _normalizeHomoglyph(str) {
    return str.split('').map(c => HOMOGLYPH_MAP[c.toLowerCase()] || c.toLowerCase()).join('')
        .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
        .replace(/\s+/g, '');
}

function checkPhishing(url) {
    if (!url) return { isPhishing: false, suspicious: false, reason: '', score: 0, details: [] };
    const lower = url.toLowerCase().replace(/https?:\/\//i, '').replace(/^www\./, '');
    const domain = lower.split(/[/?#]/)[0];
    const details = [];
    let threatScore = 0;

    for (const pat of KNOWN_PHISHING_PATTERNS) {
        pat.lastIndex = 0;
        if (pat.test(lower)) {
            details.push(`Pola phishing: ${pat.source.slice(0, 50)}`);
            threatScore += 80;
        }
    }

    const normalized = _normalizeHomoglyph(domain);
    for (const trusted of TRUSTED_DOMAINS) {
        const normTrusted = _normalizeHomoglyph(trusted);
        if (normalized === normTrusted) {
            return { isPhishing: false, suspicious: false, reason: 'Domain terpercaya', score: 0, details: [] };
        }
        const dist = _levenshtein(normalized, normTrusted);
        if (dist <= 2 && normalized.length > 5 && dist > 0) {
            details.push(`Domain mirip ${trusted} (jarak: ${dist})`);
            threatScore += 70;
        }
        if (normalized.includes(normTrusted) && normalized !== normTrusted) {
            details.push(`Domain mengandung nama ${trusted}`);
            threatScore += 40;
        }
    }

    for (const feature of SUSPICIOUS_URL_FEATURES) {
        if (feature.test(lower)) {
            details.push(feature.reason);
            threatScore += 15;
        }
    }

    const tld = domain.split('.').pop();
    const SUSPICIOUS_TLDS = ['xyz', 'top', 'tk', 'ml', 'ga', 'cf', 'gq', 'pw', 'cc', 'ws', 'su', 'biz', 'club', 'site', 'online', 'click', 'link', 'work', 'date', 'racing', 'review', 'stream', 'download', 'win', 'bid', 'trade', 'party', 'science', 'accountant', 'faith', 'cricket', 'loan', 'men', 'webcam'];
    if (SUSPICIOUS_TLDS.includes(tld) && !TRUSTED_DOMAINS.has(domain)) {
        details.push(`TLD mencurigakan: .${tld}`);
        threatScore += 20;
    }

    if (threatScore >= 60) {
        return {
            isPhishing: true,
            suspicious: true,
            reason: details[0] || 'Skor ancaman tinggi',
            score: Math.min(100, threatScore),
            details
        };
    }

    if (threatScore >= 25) {
        return {
            isPhishing: false,
            suspicious: true,
            reason: details[0] || 'Beberapa indikator mencurigakan',
            score: threatScore,
            details
        };
    }

    return { isPhishing: false, suspicious: false, reason: '', score: threatScore, details };
}

function checkPhishingBulk(text) {
    if (!text) return [];
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
    const bareUrlRegex = /(?:^|\s)((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi;
    const urls = new Set();
    let match;
    while ((match = urlRegex.exec(text)) !== null) urls.add(match[0]);
    while ((match = bareUrlRegex.exec(text)) !== null) {
        const candidate = match[1].trim();
        if (candidate.includes('.') && !candidate.startsWith('.')) urls.add(candidate);
    }
    const results = [];
    for (const u of urls) {
        const result = checkPhishing(u);
        if (result.isPhishing || result.suspicious) {
            results.push({ url: u, ...result });
        }
    }
    return results;
}

function _levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    if (Math.abs(m - n) > 3) return Math.max(m, n);
    const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i || j));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[m][n];
}

const _DUP_TRACKER = new Map();
const _DUP_WINDOW = 30000;
const _DUP_MAX = 4;
const _DUP_SIMILARITY_THRESHOLD = 0.85;
const _DUP_HISTORY = new Map();

function _simpleHash(str) {
    return crypto.createHash('md5').update(str.trim().toLowerCase()).digest('hex');
}

function _jaroWinkler(s1, s2) {
    if (s1 === s2) return 1.0;
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    const matchDist = Math.floor(maxLen / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);
    let matches = 0;
    let transpositions = 0;
    for (let i = 0; i < s1.length; i++) {
        const start = Math.max(0, i - matchDist);
        const end = Math.min(i + matchDist + 1, s2.length);
        for (let j = start; j < end; j++) {
            if (s2Matches[j] || s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches++;
            break;
        }
    }
    if (matches === 0) return 0.0;
    let k = 0;
    for (let i = 0; i < s1.length; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }
    const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
        if (s1[i] === s2[i]) prefix++;
        else break;
    }
    return jaro + prefix * 0.1 * (1 - jaro);
}

function checkDuplicateMessage(groupId, senderId, text, opts = {}) {
    const {
        window = _DUP_WINDOW,
        maxDup = _DUP_MAX,
        similarityThreshold = _DUP_SIMILARITY_THRESHOLD,
        checkSimilar = true,
    } = opts;

    if (!text || text.length < 3) return { isDuplicate: false, count: 0, similarity: 0, type: 'none' };

    const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
    const hash = _simpleHash(normalized);
    const exactKey = `${groupId}:${senderId}:${hash}`;
    const now = Date.now();

    if (!_DUP_TRACKER.has(exactKey)) _DUP_TRACKER.set(exactKey, []);
    const arr = _DUP_TRACKER.get(exactKey).filter(t => now - t < window);
    arr.push(now);
    _DUP_TRACKER.set(exactKey, arr);

    if (arr.length >= maxDup) {
        return { isDuplicate: true, count: arr.length, similarity: 1.0, type: 'exact' };
    }

    if (checkSimilar) {
        const histKey = `${groupId}:${senderId}`;
        if (!_DUP_HISTORY.has(histKey)) _DUP_HISTORY.set(histKey, []);
        const history = _DUP_HISTORY.get(histKey).filter(h => now - h.ts < window);

        let maxSim = 0;
        let simCount = 0;

        for (const h of history) {
            const sim = _jaroWinkler(normalized, h.text);
            if (sim > maxSim) maxSim = sim;
            if (sim >= similarityThreshold) simCount++;
        }

        history.push({ text: normalized, hash, ts: now });
        if (history.length > 50) history.splice(0, history.length - 30);
        _DUP_HISTORY.set(histKey, history);

        if (simCount >= maxDup - 1 && maxSim >= similarityThreshold) {
            return { isDuplicate: true, count: simCount + 1, similarity: maxSim, type: 'similar' };
        }
    }

    return { isDuplicate: false, count: arr.length, similarity: 0, type: 'none' };
}

function getDuplicateStats(groupId, senderId) {
    const now = Date.now();
    const prefix = `${groupId}:${senderId}:`;
    let totalDups = 0;
    let uniqueMessages = 0;
    for (const [k, arr] of _DUP_TRACKER.entries()) {
        if (!k.startsWith(prefix)) continue;
        const recent = arr.filter(t => now - t < _DUP_WINDOW);
        if (recent.length > 0) {
            uniqueMessages++;
            totalDups += recent.length;
        }
    }
    return { uniqueMessages, totalDups, avgRepeat: uniqueMessages > 0 ? (totalDups / uniqueMessages).toFixed(2) : 0 };
}

setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of _DUP_TRACKER.entries()) {
        const fresh = arr.filter(t => now - t < _DUP_WINDOW);
        if (!fresh.length) _DUP_TRACKER.delete(k);
        else _DUP_TRACKER.set(k, fresh);
    }
    for (const [k, arr] of _DUP_HISTORY.entries()) {
        const fresh = arr.filter(h => now - h.ts < 60000);
        if (!fresh.length) _DUP_HISTORY.delete(k);
        else _DUP_HISTORY.set(k, fresh);
    }
}, 30000);

const _MENTION_CD = new Map();
const _MENTION_HISTORY = new Map();

function checkMentionBomb(groupId, senderId, mentionedJids = [], text = '', opts = {}) {
    const {
        maxMentions = 10,
        windowMs = 15000,
        maxAccumulated = 25,
        accumulateWindowMs = 60000,
        detectAllTag = true,
    } = opts;

    const textMentions = ((text || '').match(/@\d{5,16}/g) || []).length;
    const mentionCount = (mentionedJids || []).length + textMentions;

    const key = `${groupId}:${senderId}`;
    const now = Date.now();

    if (!_MENTION_HISTORY.has(key)) _MENTION_HISTORY.set(key, []);
    const history = _MENTION_HISTORY.get(key).filter(h => now - h.ts < accumulateWindowMs);
    history.push({ count: mentionCount, ts: now });
    _MENTION_HISTORY.set(key, history);

    const totalAccumulated = history.reduce((sum, h) => sum + h.count, 0);

    if (detectAllTag && /@everyone|@all|@here/i.test(text || '')) {
        _MENTION_CD.set(key, now);
        return { isBomb: true, count: mentionCount, accumulated: totalAccumulated, reason: 'Penggunaan @everyone/@all terdeteksi' };
    }

    if (mentionCount >= maxMentions) {
        _MENTION_CD.set(key, now);
        return { isBomb: true, count: mentionCount, accumulated: totalAccumulated, reason: `${mentionCount} mention dalam satu pesan` };
    }

    if (totalAccumulated >= maxAccumulated) {
        return { isBomb: true, count: mentionCount, accumulated: totalAccumulated, reason: `${totalAccumulated} mention akumulasi dalam ${accumulateWindowMs / 1000} detik` };
    }

    const uniqueMentioned = new Set(mentionedJids || []);
    if (uniqueMentioned.size >= 5) {
        const groupMemberRatio = uniqueMentioned.size / Math.max(1, (mentionedJids || []).length);
        if (groupMemberRatio >= 0.8 && uniqueMentioned.size >= 8) {
            return { isBomb: true, count: mentionCount, accumulated: totalAccumulated, reason: 'Mention massal terhadap banyak member unik' };
        }
    }

    return { isBomb: false, count: mentionCount, accumulated: totalAccumulated, reason: '' };
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _MENTION_CD.entries()) {
        if (now - v > 60000) _MENTION_CD.delete(k);
    }
    for (const [k, arr] of _MENTION_HISTORY.entries()) {
        const fresh = arr.filter(h => now - h.ts < 120000);
        if (!fresh.length) _MENTION_HISTORY.delete(k);
        else _MENTION_HISTORY.set(k, fresh);
    }
}, 60000);

const ADMIN_IMPERSONATION_PATTERNS = [
    /^\[(admin|mod|official|owner|bot|system|staff|team|support|cs|operator|manager|supervisor|dev|developer)\]/i,
    /^(admin|mod|official|owner|bot|system|staff|team|support|cs|operator|manager|supervisor|dev|developer)\s*[\|:;\-]/i,
    /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/,
    /^(admin|mod|official|owner|staff|support|cs|dev)\d*$/i,
    /^\u200b*(admin|mod|official|owner|bot|system)/i,
    /(admin|moderator|owner|official|staff|support)\s*(grup|group|server|channel)/i,
    /^[\[\(【「](admin|mod|owner|official|staff|bot|system|cs|support|dev)[\]\)】」]/i,
    /verified|centang|✓|✔|☑|badge/i,
    /^(customer\s*service|helpdesk|help\s*desk|info\s*resmi|official\s*account)/i,
];

const ADMIN_NAME_SIMILARITY_THRESHOLD = 0.85;

function checkFakeAdmin(pushName = '', adminNames = [], opts = {}) {
    const {
        extraPatterns = [],
        strictMode = false,
        similarityThreshold = ADMIN_NAME_SIMILARITY_THRESHOLD,
    } = opts;

    const name = (pushName || '').trim();
    if (!name) return { isFakeAdmin: false, reason: '', confidence: 0 };
    const lower = name.toLowerCase();
    const normalized = _normalizeHomoglyph(lower);
    let maxConfidence = 0;
    const reasons = [];

    const allPatterns = [...ADMIN_IMPERSONATION_PATTERNS, ...extraPatterns];
    for (const p of allPatterns) {
        p.lastIndex = 0;
        if (p.test(name) || p.test(normalized)) {
            reasons.push('Nama meniru format admin/staff/owner');
            maxConfidence = Math.max(maxConfidence, 0.9);
        }
    }

    for (const adminName of adminNames) {
        if (!adminName) continue;
        const normAdmin = _normalizeHomoglyph(adminName.toLowerCase().trim());
        if (normAdmin.length <= 2) continue;

        if (normalized === normAdmin) continue;

        const dist = _levenshtein(normalized, normAdmin);
        if (dist <= 1 && normAdmin.length > 3) {
            reasons.push(`Nama sangat mirip admin: ${adminName} (jarak: ${dist})`);
            maxConfidence = Math.max(maxConfidence, 0.95);
        }

        const sim = _jaroWinkler(normalized, normAdmin);
        if (sim >= similarityThreshold && normalized !== normAdmin) {
            reasons.push(`Nama mirip admin: ${adminName} (similarity: ${(sim * 100).toFixed(1)}%)`);
            maxConfidence = Math.max(maxConfidence, sim);
        }

        if (normalized.includes(normAdmin) && normalized !== normAdmin) {
            reasons.push(`Nama mengandung nama admin: ${adminName}`);
            maxConfidence = Math.max(maxConfidence, 0.7);
        }

        if (normAdmin.includes(normalized) && normalized !== normAdmin && normalized.length > 3) {
            reasons.push(`Nama adalah bagian dari nama admin: ${adminName}`);
            maxConfidence = Math.max(maxConfidence, 0.6);
        }
    }

    const threshold = strictMode ? 0.5 : 0.7;

    if (maxConfidence >= threshold) {
        return {
            isFakeAdmin: true,
            reason: reasons[0] || 'Terdeteksi sebagai impersonasi',
            confidence: maxConfidence,
            allReasons: reasons
        };
    }

    return { isFakeAdmin: false, reason: '', confidence: maxConfidence, allReasons: reasons };
}

const PII_PATTERNS = [
    { name: 'Kartu Kredit', regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, severity: 'critical' },
    { name: 'NIK/KTP', regex: /\b[1-9][0-9]{15}\b/g, severity: 'critical' },
    { name: 'NPWP', regex: /\b\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}\b/g, severity: 'high' },
    { name: 'Nomor Rekening', regex: /\b[0-9]{8,16}\b/g, severity: 'high' },
    { name: 'Nomor Paspor', regex: /\b[A-Z]{1,2}[0-9]{6,8}\b/g, severity: 'high' },
    { name: 'Kata Sandi', regex: /(?:password|passwd|sandi|pin|kata\s*sandi|pass\s*word)\s*[:=]\s*\S+/gi, severity: 'critical' },
    { name: 'Token/OTP', regex: /(?:token|otp|kode\s*verifikasi|verification\s*code|kode\s*otp)\s*[:=]?\s*[0-9]{4,8}/gi, severity: 'critical' },
    { name: 'API Key', regex: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*[A-Za-z0-9_\-]{16,}/gi, severity: 'critical' },
    { name: 'Email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, severity: 'medium' },
    { name: 'Nomor Telepon', regex: /(?:\+62|62|0)8[1-9][0-9]{6,10}\b/g, severity: 'medium' },
    { name: 'Alamat', regex: /(?:jl\.|jalan|gg\.|gang|rt\s*\d+|rw\s*\d+|kel\.|kelurahan|kec\.|kecamatan)\s*[A-Za-z0-9\s,.]+/gi, severity: 'low' },
    { name: 'BPJS', regex: /\b0{4}[0-9]{9}\b/g, severity: 'high' },
    { name: 'SIM', regex: /\b[0-9]{12,14}\b/g, severity: 'medium' },
    { name: 'Private Key', regex: /(?:-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----)/gi, severity: 'critical' },
    { name: 'JWT Token', regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, severity: 'critical' },
    { name: 'AWS Key', regex: /(?:AKIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g, severity: 'critical' },
];

const PII_SEVERITY_SCORE = { critical: 100, high: 70, medium: 40, low: 20 };

function detectPII(text, opts = {}) {
    const { minSeverity = 'low', returnMatches = false } = opts;
    if (!text) return [];

    const severityOrder = ['low', 'medium', 'high', 'critical'];
    const minIdx = severityOrder.indexOf(minSeverity);
    const found = [];

    for (const { name, regex, severity } of PII_PATTERNS) {
        if (severityOrder.indexOf(severity) < minIdx) continue;
        const re = new RegExp(regex.source, regex.flags);
        const matches = text.match(re);
        if (matches && matches.length) {
            const entry = {
                type: name,
                count: matches.length,
                severity,
                score: PII_SEVERITY_SCORE[severity] || 0,
            };
            if (returnMatches) {
                entry.samples = matches.slice(0, 3).map(m => m.slice(0, 4) + '***');
            }
            found.push(entry);
        }
    }

    return found.sort((a, b) => (PII_SEVERITY_SCORE[b.severity] || 0) - (PII_SEVERITY_SCORE[a.severity] || 0));
}

function detectPIIWithScore(text) {
    const findings = detectPII(text);
    const totalScore = findings.reduce((sum, f) => sum + f.score * f.count, 0);
    const maxSeverity = findings.length > 0 ? findings[0].severity : 'none';
    return {
        findings,
        totalScore,
        maxSeverity,
        hasCritical: findings.some(f => f.severity === 'critical'),
        shouldBlock: totalScore >= 100 || findings.some(f => f.severity === 'critical'),
        shouldWarn: totalScore >= 40,
        summary: findings.map(f => `${f.type} (${f.count}x, ${f.severity})`).join(', ') || 'Tidak ada PII terdeteksi'
    };
}

function maskPII(text) {
    if (!text) return text;
    let masked = text;
    for (const { regex } of PII_PATTERNS) {
        const re = new RegExp(regex.source, regex.flags);
        masked = masked.replace(re, (match) => {
            if (match.length <= 4) return '***';
            return match.slice(0, 2) + '*'.repeat(Math.max(1, match.length - 4)) + match.slice(-2);
        });
    }
    return masked;
}
function shadowBanAdd(groupId, userId, reason = '', durationMs = 24 * 3600000) {
    const db = _readJSON(SHADOWBAN_PATH, {});
    if (!db[groupId]) db[groupId] = {};
    const now = Date.now();
    const existing = db[groupId][userId];
    if (existing && existing.active && now < existing.until) {
        const remainingMs = existing.until - now;
        db[groupId][userId] = {
            since: existing.since,
            until: now + remainingMs + durationMs,
            reason: reason || existing.reason,
            active: true,
            strikes: (existing.strikes || 1) + 1,
            lastStrike: now,
            history: [...(existing.history || []), {
                action: 'extend',
                reason,
                addedMs: durationMs,
                ts: now
            }]
        };
    } else {
        db[groupId][userId] = {
            since: now,
            until: now + durationMs,
            reason,
            active: true,
            strikes: 1,
            lastStrike: now,
            history: [{
                action: 'create',
                reason,
                durationMs,
                ts: now
            }]
        };
    }
    _writeJSON(SHADOWBAN_PATH, db);
    return db[groupId][userId];
}

function shadowBanRemove(groupId, userId) {
    const db = _readJSON(SHADOWBAN_PATH, {});
    if (db[groupId]?.[userId]) {
        db[groupId][userId].active = false;
        db[groupId][userId].removedAt = Date.now();
        if (!db[groupId][userId].history) db[groupId][userId].history = [];
        db[groupId][userId].history.push({
            action: 'remove',
            ts: Date.now()
        });
        _writeJSON(SHADOWBAN_PATH, db);
        return true;
    }
    return false;
}

function isShadowBanned(groupId, userId) {
    const db = _readJSON(SHADOWBAN_PATH, {});
    const entry = db[groupId]?.[userId];
    if (!entry || !entry.active) return false;
    const now = Date.now();
    if (now > entry.until) {
        db[groupId][userId].active = false;
        db[groupId][userId].expiredAt = now;
        if (!db[groupId][userId].history) db[groupId][userId].history = [];
        db[groupId][userId].history.push({
            action: 'expired',
            ts: now
        });
        _writeJSON(SHADOWBAN_PATH, db);
        return false;
    }
    return true;
}

function getShadowBanList(groupId) {
    const db = _readJSON(SHADOWBAN_PATH, {});
    const now = Date.now();
    const entries = Object.entries(db[groupId] || {});
    let changed = false;
    const result = [];
    for (const [uid, v] of entries) {
        if (!v.active) continue;
        if (now > v.until) {
            db[groupId][uid].active = false;
            db[groupId][uid].expiredAt = now;
            if (!db[groupId][uid].history) db[groupId][uid].history = [];
            db[groupId][uid].history.push({ action: 'expired', ts: now });
            changed = true;
            continue;
        }
        result.push({
            uid,
            since: v.since,
            until: v.until,
            reason: v.reason,
            strikes: v.strikes || 1,
            remainingMs: v.until - now,
            remainingText: _formatDuration(v.until - now)
        });
    }
    if (changed) _writeJSON(SHADOWBAN_PATH, db);
    return result;
}

function shadowBanGetInfo(groupId, userId) {
    const db = _readJSON(SHADOWBAN_PATH, {});
    const entry = db[groupId]?.[userId];
    if (!entry) return null;
    const now = Date.now();
    const isActive = entry.active && now < entry.until;
    return {
        uid: userId,
        active: isActive,
        since: entry.since,
        until: entry.until,
        reason: entry.reason,
        strikes: entry.strikes || 1,
        remainingMs: isActive ? entry.until - now : 0,
        remainingText: isActive ? _formatDuration(entry.until - now) : 'expired',
        history: entry.history || []
    };
}

function shadowBanPurgeExpired(groupId) {
    const db = _readJSON(SHADOWBAN_PATH, {});
    if (!db[groupId]) return 0;
    const now = Date.now();
    let purged = 0;
    for (const [uid, v] of Object.entries(db[groupId])) {
        if (!v.active && (now - (v.removedAt || v.expiredAt || v.until)) > 7 * 24 * 3600000) {
            delete db[groupId][uid];
            purged++;
        }
    }
    if (purged > 0) _writeJSON(SHADOWBAN_PATH, db);
    return purged;
}

function shadowBanExtend(groupId, userId, extraMs, reason = '') {
    const db = _readJSON(SHADOWBAN_PATH, {});
    const entry = db[groupId]?.[userId];
    if (!entry || !entry.active) return null;
    const now = Date.now();
    if (now > entry.until) {
        db[groupId][userId].active = false;
        _writeJSON(SHADOWBAN_PATH, db);
        return null;
    }
    db[groupId][userId].until = entry.until + extraMs;
    db[groupId][userId].lastStrike = now;
    db[groupId][userId].strikes = (entry.strikes || 1) + 1;
    if (!db[groupId][userId].history) db[groupId][userId].history = [];
    db[groupId][userId].history.push({
        action: 'extend',
        reason,
        addedMs: extraMs,
        ts: now
    });
    _writeJSON(SHADOWBAN_PATH, db);
    return db[groupId][userId];
}

function shadowBanReduce(groupId, userId, reduceMs) {
    const db = _readJSON(SHADOWBAN_PATH, {});
    const entry = db[groupId]?.[userId];
    if (!entry || !entry.active) return null;
    const now = Date.now();
    const newUntil = Math.max(now + 60000, entry.until - reduceMs);
    db[groupId][userId].until = newUntil;
    if (!db[groupId][userId].history) db[groupId][userId].history = [];
    db[groupId][userId].history.push({
        action: 'reduce',
        reducedMs: reduceMs,
        ts: now
    });
    _writeJSON(SHADOWBAN_PATH, db);
    return db[groupId][userId];
}

function shadowBanCount(groupId) {
    const list = getShadowBanList(groupId);
    return list.length;
}

function shadowBanAutoEscalate(groupId, userId, baseMs = 24 * 3600000) {
    const db = _readJSON(SHADOWBAN_PATH, {});
    const entry = db[groupId]?.[userId];
    const strikes = entry ? (entry.strikes || 0) + 1 : 1;
    const multiplier = Math.min(strikes, 10);
    const duration = baseMs * multiplier;
    return shadowBanAdd(groupId, userId, `auto-escalate strike #${strikes}`, duration);
}

function _formatDuration(ms) {
    if (ms <= 0) return '0 detik';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const parts = [];
    if (d > 0) parts.push(`${d} hari`);
    if (h > 0) parts.push(`${h} jam`);
    if (m > 0) parts.push(`${m} menit`);
    if (s > 0 && d === 0) parts.push(`${s} detik`);
    return parts.join(' ') || '0 detik';
}

const REP_EVENTS = {
    toxic: -15,
    nsfw: -25,
    spam: -10,
    duplicate: -8,
    phishing: -30,
    mention_bomb: -20,
    fake_admin: -20,
    warn: -5,
    good_message: +1,
    kicked: -50,
    helpful: +5,
    active: +2,
    media_share: +1,
    sticker_spam: -5,
    link_spam: -12,
    caps_abuse: -3,
    raid: -40,
    impersonation: -35,
    scam: -45,
    flood: -15,
    offtopic: -2,
    positive_vibe: +3,
    event_join: +4,
    quiz_win: +6,
    reported: -8,
    false_report: -10,
    muted: -12,
    unbanned: +10,
    redeemed: +15,
    trusted: +20,
    veteran: +25,
    mod_action: +8,
};

const REP_TIERS = [
    { min: 180, label: 'Legendary', emoji: '👑' },
    { min: 150, label: 'Trusted', emoji: '⭐' },
    { min: 120, label: 'Respected', emoji: '🔵' },
    { min: 100, label: 'Normal', emoji: '⚪' },
    { min: 70, label: 'Suspicious', emoji: '🟡' },
    { min: 40, label: 'Dangerous', emoji: '🟠' },
    { min: 20, label: 'Toxic', emoji: '🔴' },
    { min: 0, label: 'Blacklisted', emoji: '⛔' },
];

function repGet(groupId, userId) {
    const db = _readJSON(REPUTATION_PATH, {});
    return db[groupId]?.[userId]?.score ?? 100;
}

function repGetFull(groupId, userId) {
    const db = _readJSON(REPUTATION_PATH, {});
    const data = db[groupId]?.[userId];
    if (!data) return {
        score: 100,
        tier: REP_TIERS.find(t => 100 >= t.min) || REP_TIERS[REP_TIERS.length - 1],
        history: [],
        totalEvents: 0,
        positiveEvents: 0,
        negativeEvents: 0,
        lastActivity: null
    };
    const score = data.score ?? 100;
    const tier = REP_TIERS.find(t => score >= t.min) || REP_TIERS[REP_TIERS.length - 1];
    const history = data.history || [];
    const positiveEvents = history.filter(h => h.delta > 0).length;
    const negativeEvents = history.filter(h => h.delta < 0).length;
    const lastActivity = history.length > 0 ? history[history.length - 1].ts : null;
    return {
        score,
        tier,
        history,
        totalEvents: history.length,
        positiveEvents,
        negativeEvents,
        lastActivity
    };
}

function repUpdate(groupId, userId, event, customDelta) {
    const db = _readJSON(REPUTATION_PATH, {});
    if (!db[groupId]) db[groupId] = {};
    if (!db[groupId][userId]) db[groupId][userId] = { score: 100, history: [], streaks: {}, lastEvent: null };
    const delta = customDelta !== undefined ? customDelta : (REP_EVENTS[event] || 0);
    const prev = db[groupId][userId].score;
    const newScore = Math.max(0, Math.min(200, prev + delta));
    db[groupId][userId].score = newScore;
    const now = Date.now();
    db[groupId][userId].history.push({
        event,
        delta,
        prev,
        after: newScore,
        ts: now
    });
    if (db[groupId][userId].history.length > 100) {
        db[groupId][userId].history = db[groupId][userId].history.slice(-60);
    }
    if (!db[groupId][userId].streaks) db[groupId][userId].streaks = {};
    if (delta < 0) {
        if (!db[groupId][userId].streaks.negative) db[groupId][userId].streaks.negative = 0;
        db[groupId][userId].streaks.negative++;
        db[groupId][userId].streaks.positive = 0;
    } else if (delta > 0) {
        if (!db[groupId][userId].streaks.positive) db[groupId][userId].streaks.positive = 0;
        db[groupId][userId].streaks.positive++;
        db[groupId][userId].streaks.negative = 0;
    }
    db[groupId][userId].lastEvent = { event, delta, ts: now };
    const prevTier = REP_TIERS.find(t => prev >= t.min) || REP_TIERS[REP_TIERS.length - 1];
    const newTier = REP_TIERS.find(t => newScore >= t.min) || REP_TIERS[REP_TIERS.length - 1];
    const tierChanged = prevTier.label !== newTier.label;
    _writeJSON(REPUTATION_PATH, db);
    return {
        score: newScore,
        prev,
        delta,
        tier: newTier,
        prevTier,
        tierChanged,
        tierDirection: tierChanged ? (newScore > prev ? 'up' : 'down') : null,
        streaks: db[groupId][userId].streaks
    };
}

function repGetList(groupId, limit = 10, order = 'asc') {
    const db = _readJSON(REPUTATION_PATH, {});
    const entries = Object.entries(db[groupId] || {})
        .map(([uid, v]) => {
            const score = v.score ?? 100;
            const tier = REP_TIERS.find(t => score >= t.min) || REP_TIERS[REP_TIERS.length - 1];
            return {
                uid,
                score,
                tier,
                totalEvents: (v.history || []).length,
                lastActivity: v.lastEvent?.ts || null
            };
        });
    if (order === 'desc') {
        entries.sort((a, b) => b.score - a.score);
    } else {
        entries.sort((a, b) => a.score - b.score);
    }
    return entries.slice(0, limit);
}

function repGetTopBest(groupId, limit = 10) {
    return repGetList(groupId, limit, 'desc');
}

function repGetTopWorst(groupId, limit = 10) {
    return repGetList(groupId, limit, 'asc');
}

function repReset(groupId, userId) {
    const db = _readJSON(REPUTATION_PATH, {});
    if (db[groupId]?.[userId]) {
        const prev = db[groupId][userId].score;
        db[groupId][userId].score = 100;
        db[groupId][userId].history.push({
            event: 'reset',
            delta: 100 - prev,
            prev,
            after: 100,
            ts: Date.now()
        });
        db[groupId][userId].streaks = { positive: 0, negative: 0 };
        _writeJSON(REPUTATION_PATH, db);
        return true;
    }
    return false;
}

function repBulkUpdate(groupId, userIds, event) {
    const results = {};
    for (const uid of userIds) {
        results[uid] = repUpdate(groupId, uid, event);
    }
    return results;
}

function repDecayInactive(groupId, inactiveMs = 7 * 24 * 3600000, decayAmount = 5) {
    const db = _readJSON(REPUTATION_PATH, {});
    if (!db[groupId]) return 0;
    const now = Date.now();
    let decayed = 0;
    for (const [uid, v] of Object.entries(db[groupId])) {
        const lastTs = v.lastEvent?.ts || (v.history?.length > 0 ? v.history[v.history.length - 1].ts : 0);
        if (lastTs && (now - lastTs) > inactiveMs && v.score > 50) {
            const prev = v.score;
            v.score = Math.max(50, v.score - decayAmount);
            v.history.push({
                event: 'inactivity_decay',
                delta: v.score - prev,
                prev,
                after: v.score,
                ts: now
            });
            if (v.history.length > 100) v.history = v.history.slice(-60);
            v.lastEvent = { event: 'inactivity_decay', delta: v.score - prev, ts: now };
            decayed++;
        }
    }
    if (decayed > 0) _writeJSON(REPUTATION_PATH, db);
    return decayed;
}

function repGetTier(score) {
    return REP_TIERS.find(t => score >= t.min) || REP_TIERS[REP_TIERS.length - 1];
}

function repShouldAutoBan(groupId, userId, threshold = 10) {
    const score = repGet(groupId, userId);
    return score <= threshold;
}

function repShouldAutoMute(groupId, userId, threshold = 30) {
    const score = repGet(groupId, userId);
    return score <= threshold;
}

function repShouldShadowBan(groupId, userId, threshold = 20) {
    const score = repGet(groupId, userId);
    if (score <= threshold) {
        const full = repGetFull(groupId, userId);
        if (full.streaks && full.streaks.negative >= 3) return true;
    }
    return false;
}

function repGetStats(groupId) {
    const db = _readJSON(REPUTATION_PATH, {});
    const entries = Object.values(db[groupId] || {});
    if (entries.length === 0) return { total: 0, avg: 100, min: 100, max: 100, tierDistribution: {} };
    const scores = entries.map(e => e.score ?? 100);
    const total = scores.length;
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / total);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const tierDistribution = {};
    for (const s of scores) {
        const tier = repGetTier(s);
        if (!tierDistribution[tier.label]) tierDistribution[tier.label] = 0;
        tierDistribution[tier.label]++;
    }
    return { total, avg, min, max, tierDistribution };
}

function repPurgeZero(groupId) {
    const db = _readJSON(REPUTATION_PATH, {});
    if (!db[groupId]) return 0;
    let purged = 0;
    for (const [uid, v] of Object.entries(db[groupId])) {
        if (v.score <= 0) {
            delete db[groupId][uid];
            purged++;
        }
    }
    if (purged > 0) _writeJSON(REPUTATION_PATH, db);
    return purged;
}


function auditLog(groupId, actor, action, target = '', detail = '') {
    const db = _readJSON(AUDIT_PATH, {});
    if (!db[groupId]) db[groupId] = [];
    db[groupId].push({
        ts:     Date.now(),
        time:   new Date().toLocaleString('id-ID'),
        actor,
        action,
        target,
        detail
    });
    if (db[groupId].length > 500)
        db[groupId] = db[groupId].slice(-300);
    _writeJSON(AUDIT_PATH, db);
}

function auditGetLast(groupId, limit = 20) {
    const db = _readJSON(AUDIT_PATH, {});
    return (db[groupId] || []).slice(-limit).reverse();
}

const SEVERITY = { low: 1, medium: 2, high: 3, critical: 4 };

function incidentAdd(groupId, type, userId, detail = '', severity = 'medium') {
    const db = _readJSON(INCIDENT_PATH, {});
    if (!db[groupId]) db[groupId] = [];
    db[groupId].push({
        id:       crypto.randomBytes(4).toString('hex'),
        ts:       Date.now(),
        time:     new Date().toLocaleString('id-ID'),
        type,
        userId,
        detail,
        severity,
        level:    SEVERITY[severity] || 2
    });
    if (db[groupId].length > 1000)
        db[groupId] = db[groupId].slice(-600);
    _writeJSON(INCIDENT_PATH, db);
}

function incidentGetSummary(groupId, sinceMs = 86400000) {
    const db  = _readJSON(INCIDENT_PATH, {});
    const now = Date.now();
    const recent = (db[groupId] || []).filter(i => now - i.ts < sinceMs);
    const byType = {};
    const byUser = {};
    for (const i of recent) {
        byType[i.type] = (byType[i.type] || 0) + 1;
        byUser[i.userId] = (byUser[i.userId] || 0) + 1;
    }
    const topOffender = Object.entries(byUser).sort((a,b) => b[1]-a[1])[0];
    return {
        total: recent.length,
        byType,
        topOffender: topOffender ? { uid: topOffender[0], count: topOffender[1] } : null,
        critical: recent.filter(i => i.severity === 'critical').length,
        high:     recent.filter(i => i.severity === 'high').length,
    };
}


const _SESSION_STATS = {
    msgCount: 0, cmdCount: 0, errorCount: 0,
    startTime: Date.now(), lastActivity: Date.now(),
    suspiciousPatterns: []
};

function sessionPing(type = 'msg') {
    _SESSION_STATS.lastActivity = Date.now();
    if (type === 'msg') _SESSION_STATS.msgCount++;
    if (type === 'cmd') _SESSION_STATS.cmdCount++;
    if (type === 'err') _SESSION_STATS.errorCount++;
}

function sessionGetHealth() {
    const uptime  = Date.now() - _SESSION_STATS.startTime;
    const msgRate = _SESSION_STATS.msgCount / (uptime / 60000);
    const errRate = _SESSION_STATS.errorCount / Math.max(_SESSION_STATS.msgCount, 1);
    const status  = errRate > 0.3 ? 'degraded' : errRate > 0.1 ? 'warning' : 'healthy';
    return {
        uptime:     Math.floor(uptime / 1000),
        msgCount:   _SESSION_STATS.msgCount,
        cmdCount:   _SESSION_STATS.cmdCount,
        errorCount: _SESSION_STATS.errorCount,
        msgPerMin:  msgRate.toFixed(2),
        errorRate:  (errRate * 100).toFixed(1) + '%',
        status,
        lastActivity: new Date(_SESSION_STATS.lastActivity).toLocaleString('id-ID'),
    };
}


function encryptedBackup(dataObj, password) {
    const json   = JSON.stringify(dataObj);
    const salt   = crypto.randomBytes(16);
    const key    = crypto.scryptSync(password, salt, 32);
    const iv     = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc    = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    const payload = Buffer.concat([salt, iv, tag, enc]);
    return payload.toString('base64');
}

function decryptedBackup(base64, password) {
    try {
        const buf  = Buffer.from(base64, 'base64');
        const salt = buf.slice(0, 16);
        const iv   = buf.slice(16, 28);
        const tag  = buf.slice(28, 44);
        const enc  = buf.slice(44);
        const key  = crypto.scryptSync(password, salt, 32);
        const dec  = crypto.createDecipheriv('aes-256-gcm', key, iv);
        dec.setAuthTag(tag);
        const json = dec.update(enc) + dec.final('utf8');
        return JSON.parse(json);
    } catch(e) {
        throw new Error('Decryption failed — password salah atau file rusak');
    }
}


function formatSecurityReport(groupId, groupName = 'Grup') {
    const summary = incidentGetSummary(groupId, 86400000);
    const repList = repGetList(groupId, 5);
    const audits  = auditGetLast(groupId, 10);
    const shadows = getShadowBanList(groupId);
    const health  = sessionGetHealth();

    const topTypes = Object.entries(summary.byType)
        .sort((a,b) => b[1]-a[1]).slice(0,5)
        .map(([t,c]) => `  • ${t}: ${c}x`).join('\n') || '  Tidak ada insiden';

    const repTxt = repList.length
        ? repList.map(r => `  ⚠️ @${r.uid.split('@')[0]} — Skor: ${r.score}/200`).join('\n')
        : '  Semua member reputasi baik ✅';

    const auditTxt = audits.length
        ? audits.slice(0,5).map(a =>
            `  [${a.time.split(',')[1]?.trim()||a.time}] ${a.actor.split('@')[0]} → ${a.action}${a.target?' @'+a.target.split('@')[0]:''}`
          ).join('\n')
        : '  Belum ada log';

    return `🔐 *LAPORAN KEAMANAN GRUP*
📂 *${groupName}*
📅 *${new Date().toLocaleString('id-ID')}*

📊 *INSIDEN (24 JAM)*
Total: *${summary.total}* | Kritis: *${summary.critical}* | Tinggi: *${summary.high}*
${topTypes}
${summary.topOffender ? `🚨 Paling sering: @${summary.topOffender.uid.split('@')[0]} (${summary.topOffender.count}x)` : ''}

⚠️ *REPUTASI TERENDAH*
${repTxt}

🔇 *SHADOW BAN AKTIF:* ${shadows.length} member
🤖 *STATUS BOT:* ${health.status === 'healthy' ? '✅ Sehat' : health.status === 'warning' ? '⚠️ Peringatan' : '❌ Degraded'}
📈 *Pesan/menit:* ${health.msgPerMin} | *Error rate:* ${health.errorRate}

📋 *LOG ADMIN TERBARU*
${auditTxt}

_Gunakan .securitylog untuk log lengkap_`;
}


const _URLCHECK_CACHE = new Map();
const _URLCHECK_TTL   = 3600000;

async function checkLinkSafety(url) {
    const now    = Date.now();
    const cached = _URLCHECK_CACHE.get(url);
    if (cached && now - cached.ts < _URLCHECK_TTL) return cached.result;

    const local = checkPhishing(url);
    if (local.isPhishing) {
        const result = { safe: false, source: 'local', reason: local.reason };
        _URLCHECK_CACHE.set(url, { result, ts: now });
        return result;
    }

    try {
        const axios  = require('axios');
        const apiKey = global.virustotalKey;
        if (apiKey) {
            const urlId = Buffer.from(url).toString('base64').replace(/=/g, '');
            const res   = await axios.get(`https://www.virustotal.com/api/v3/urls/${urlId}`, {
                headers: { 'x-apikey': apiKey }, timeout: 8000
            });
            const stats    = res.data?.data?.attributes?.last_analysis_stats || {};
            const malicious = (stats.malicious || 0) + (stats.suspicious || 0);
            const result   = {
                safe:    malicious === 0,
                source:  'VirusTotal',
                reason:  malicious > 0 ? `${malicious} engine mendeteksi berbahaya` : 'Aman',
                details: stats
            };
            _URLCHECK_CACHE.set(url, { result, ts: now });
            return result;
        }
    } catch {}

    const result = { safe: !local.suspicious, source: 'local_heuristic', reason: local.reason || 'Aman' };
    _URLCHECK_CACHE.set(url, { result, ts: now });
    return result;
}

const _CONTENT_FP = new Map();
const _FP_WINDOW  = 300000;
const _FP_MAX     = 5;

function fingerprintCheck(senderId, text) {
    if (!text || text.length < 20) return { isSpread: false };
    const fp  = crypto.createHash('md5').update(text.trim().toLowerCase().slice(0, 200)).digest('hex');
    const key = `${senderId}:${fp}`;
    const now = Date.now();

    if (!_CONTENT_FP.has(key)) _CONTENT_FP.set(key, { groups: new Set(), times: [] });
    const entry = _CONTENT_FP.get(key);
    entry.times  = entry.times.filter(t => now - t < _FP_WINDOW);
    entry.times.push(now);

    return {
        isSpread:    entry.times.length >= _FP_MAX,
        spreadCount: entry.times.length,
        fp
    };
}


const _OWNER_SESSION_TOKENS = new Map();
const _OWNER_SESSION_TTL    = 1800000; // 30 menit

/**
 * Generate session token untuk owner setelah verifikasi
 * @param {string} ownerJid 
 * @param {string} secret   - rahasia owner (di-set saat bot start)
 * @returns {string} token hex
 */
function ownerGenerateToken(ownerJid, secret) {
    const payload  = `${ownerJid}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
    const token    = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    _OWNER_SESSION_TOKENS.set(ownerJid, {
        token,
        created: Date.now(),
        payload,
        fingerprint: crypto.createHash('sha256').update(ownerJid).digest('hex').slice(0, 12)
    });
    auditLog('__system__', ownerJid, 'OWNER_TOKEN_GENERATED', '', 'Sesi owner baru dibuat');
    return token;
}

/**
 * Validasi apakah pemanggil benar-benar owner dan token masih berlaku
 * @param {string} callerJid 
 * @param {string} token 
 * @param {string[]} ownerList - daftar JID owner
 * @returns {{ valid: boolean, reason: string }}
 */
function ownerValidateToken(callerJid, token, ownerList = []) {
    // Pertama: cek apakah caller ada di ownerList
    const _isCallerOwner = ownerList.some(o => callerJid.startsWith(o.replace(/[^0-9]/g, '')));
    if (!_isCallerOwner) {
        incidentAdd('__system__', 'unauthorized_owner_attempt', callerJid,
            'Mencoba akses owner tanpa hak', 'critical');
        return { valid: false, reason: 'Bukan owner' };
    }

    const session = _OWNER_SESSION_TOKENS.get(callerJid);
    if (!session) return { valid: false, reason: 'Tidak ada sesi aktif. Gunakan .ownerlogin' };
    if (session.token !== token) {
        incidentAdd('__system__', 'invalid_owner_token', callerJid,
            'Token owner tidak cocok — kemungkinan spoofing', 'critical');
        return { valid: false, reason: 'Token tidak valid' };
    }
    if (Date.now() - session.created > _OWNER_SESSION_TTL) {
        _OWNER_SESSION_TOKENS.delete(callerJid);
        return { valid: false, reason: 'Sesi expired. Login ulang.' };
    }

    return { valid: true, reason: 'OK' };
}

/**
 * Quick-check apakah JID adalah owner (tanpa token, untuk fitur non-kritikal)
 */
function ownerQuickCheck(callerJid, ownerList = []) {
    return ownerList.some(o => callerJid.startsWith(o.replace(/[^0-9]/g, '')));
}

function ownerRevokeToken(ownerJid) {
    _OWNER_SESSION_TOKENS.delete(ownerJid);
    auditLog('__system__', ownerJid, 'OWNER_TOKEN_REVOKED', '', 'Sesi owner dicabut');
}

// Cleanup expired tokens
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _OWNER_SESSION_TOKENS.entries()) {
        if (now - v.created > _OWNER_SESSION_TTL) _OWNER_SESSION_TOKENS.delete(k);
    }
}, 300000);



const _FIREWALL_RUNTIME = new Map(); // in-memory cache

/**
 * Inisialisasi/load firewall config untuk grup
 */
function firewallInit(groupId) {
    const db = _readJSON(FIREWALL_PATH, {});
    if (!db[groupId]) {
        db[groupId] = {
            enabled:    true,
            whitelist:  [],       // JID yang bypass semua filter
            blacklist:  [],       // JID yang di-block total
            graylist:   [],       // JID yang under monitoring ketat
            rules:      [],       // custom rules
            autoEscalate: true,   // auto pindah gray→black jika terus melanggar
            escalateThreshold: 5, // jumlah pelanggaran sebelum escalate
            maxMsgPerMin: 30,     // rate limit per user per menit
            blockMediaFromNew: true, // block media dari member baru <24jam
            created:    Date.now(),
            updatedBy:  '',
        };
        _writeJSON(FIREWALL_PATH, db);
    }
    _FIREWALL_RUNTIME.set(groupId, db[groupId]);
    return db[groupId];
}

/**
 * Proses pesan melalui firewall multi-layer
 * @returns {{ allowed: boolean, layer: string, action: string, reason: string }}
 */
function firewallProcess(groupId, senderId, msgMeta = {}) {
    let fw = _FIREWALL_RUNTIME.get(groupId);
    if (!fw) fw = firewallInit(groupId);
    if (!fw.enabled) return { allowed: true, layer: 'none', action: 'pass', reason: 'Firewall off' };

    // Layer 1: Whitelist bypass
    if (fw.whitelist.includes(senderId))
        return { allowed: true, layer: 'whitelist', action: 'pass', reason: 'Whitelisted' };

    // Layer 2: Blacklist block
    if (fw.blacklist.includes(senderId)) {
        incidentAdd(groupId, 'firewall_block', senderId, 'Blacklisted user mencoba kirim pesan', 'high');
        return { allowed: false, layer: 'blacklist', action: 'block', reason: 'User di-blacklist' };
    }

    // Layer 3: Graylist — monitoring ketat
    const isGray = fw.graylist.includes(senderId);
    if (isGray) {
        // Rate limit lebih ketat untuk graylist
        const rateCheck = checkCmdRate(senderId, '__firewall_gray__', {
            maxPerWindow: Math.floor(fw.maxMsgPerMin / 3),
            windowMs: 60000,
            globalMax: fw.maxMsgPerMin,
            globalWindowMs: 60000,
        });
        if (!rateCheck.allowed) {
            _firewallIncrementViolation(groupId, senderId, fw);
            return { allowed: false, layer: 'graylist', action: 'throttle',
                reason: `Graylist rate limit: ${rateCheck.reason}` };
        }
    }

    // Layer 4: Global rate check
    const globalRate = checkCmdRate(senderId, '__firewall_global__', {
        maxPerWindow: fw.maxMsgPerMin,
        windowMs: 60000,
        globalMax: fw.maxMsgPerMin * 2,
        globalWindowMs: 120000,
    });
    if (!globalRate.allowed) {
        // Auto graylist jika terlalu cepat
        if (!isGray) firewallAddToList(groupId, senderId, 'graylist');
        return { allowed: false, layer: 'rate_limit', action: 'throttle',
            reason: globalRate.reason };
    }

    // Layer 5: Custom rules evaluation
    for (const rule of (fw.rules || [])) {
        const ruleResult = _firewallEvalRule(rule, senderId, msgMeta);
        if (!ruleResult.pass) {
            return { allowed: false, layer: 'custom_rule', action: rule.action || 'block',
                reason: `Rule "${rule.name}": ${ruleResult.reason}` };
        }
    }

    return { allowed: true, layer: 'passed_all', action: 'pass', reason: '' };
}

function _firewallIncrementViolation(groupId, senderId, fw) {
    const db = _readJSON(FIREWALL_PATH, {});
    if (!db[groupId]) db[groupId] = fw;
    if (!db[groupId]._violations) db[groupId]._violations = {};
    if (!db[groupId]._violations[senderId]) db[groupId]._violations[senderId] = 0;
    db[groupId]._violations[senderId]++;

    // Auto escalate: gray → black
    if (fw.autoEscalate && db[groupId]._violations[senderId] >= fw.escalateThreshold) {
        if (!db[groupId].blacklist.includes(senderId)) {
            db[groupId].blacklist.push(senderId);
            db[groupId].graylist = db[groupId].graylist.filter(j => j !== senderId);
            incidentAdd(groupId, 'firewall_auto_escalate', senderId,
                `Auto-escalated dari graylist ke blacklist setelah ${fw.escalateThreshold} pelanggaran`, 'high');
            auditLog(groupId, '__firewall__', 'AUTO_BLACKLIST', senderId, 'Escalated dari graylist');
        }
    }
    _writeJSON(FIREWALL_PATH, db);
    _FIREWALL_RUNTIME.set(groupId, db[groupId]);
}

function _firewallEvalRule(rule, senderId, msgMeta) {
    try {
        if (rule.type === 'regex' && rule.pattern) {
            const rx = new RegExp(rule.pattern, rule.flags || 'i');
            if (rx.test(msgMeta.text || ''))
                return { pass: false, reason: `Cocok pattern: ${rule.pattern}` };
        }
        if (rule.type === 'media_block' && msgMeta.hasMedia)
            return { pass: false, reason: 'Media diblokir oleh rule' };
        if (rule.type === 'new_member_restrict' && msgMeta.joinedAt) {
            const age = Date.now() - msgMeta.joinedAt;
            if (age < (rule.minAgeMs || 86400000))
                return { pass: false, reason: `Member terlalu baru (${Math.floor(age/3600000)} jam)` };
        }
    } catch {}
    return { pass: true, reason: '' };
}

function firewallAddToList(groupId, userId, listType = 'graylist', actor = '__system__') {
    const db = _readJSON(FIREWALL_PATH, {});
    if (!db[groupId]) firewallInit(groupId);
    const fw = db[groupId];
    if (!fw[listType]) fw[listType] = [];
    if (!fw[listType].includes(userId)) {
        fw[listType].push(userId);
        auditLog(groupId, actor, `FIREWALL_ADD_${listType.toUpperCase()}`, userId, '');
    }
    _writeJSON(FIREWALL_PATH, db);
    _FIREWALL_RUNTIME.set(groupId, fw);
}

function firewallRemoveFromList(groupId, userId, listType = 'graylist', actor = '__system__') {
    const db = _readJSON(FIREWALL_PATH, {});
    if (!db[groupId]) return;
    db[groupId][listType] = (db[groupId][listType] || []).filter(j => j !== userId);
    _writeJSON(FIREWALL_PATH, db);
    _FIREWALL_RUNTIME.set(groupId, db[groupId]);
    auditLog(groupId, actor, `FIREWALL_REMOVE_${listType.toUpperCase()}`, userId, '');
}

function firewallAddRule(groupId, rule, actor = '__system__') {
    const db = _readJSON(FIREWALL_PATH, {});
    if (!db[groupId]) firewallInit(groupId);
    rule.id = crypto.randomBytes(4).toString('hex');
    rule.created = Date.now();
    db[groupId].rules = db[groupId].rules || [];
    db[groupId].rules.push(rule);
    _writeJSON(FIREWALL_PATH, db);
    _FIREWALL_RUNTIME.set(groupId, db[groupId]);
    auditLog(groupId, actor, 'FIREWALL_ADD_RULE', '', `Rule: ${rule.name || rule.id}`);
    return rule.id;
}

function firewallRemoveRule(groupId, ruleId, actor = '__system__') {
    const db = _readJSON(FIREWALL_PATH, {});
    if (!db[groupId]) return;
    db[groupId].rules = (db[groupId].rules || []).filter(r => r.id !== ruleId);
    _writeJSON(FIREWALL_PATH, db);
    _FIREWALL_RUNTIME.set(groupId, db[groupId]);
    auditLog(groupId, actor, 'FIREWALL_REMOVE_RULE', '', `RuleID: ${ruleId}`);
}

function firewallGetConfig(groupId) {
    return _FIREWALL_RUNTIME.get(groupId) || firewallInit(groupId);
}

function firewallSetEnabled(groupId, enabled, actor = '__system__') {
    const db = _readJSON(FIREWALL_PATH, {});
    if (!db[groupId]) firewallInit(groupId);
    db[groupId].enabled = !!enabled;
    db[groupId].updatedBy = actor;
    _writeJSON(FIREWALL_PATH, db);
    _FIREWALL_RUNTIME.set(groupId, db[groupId]);
    auditLog(groupId, actor, enabled ? 'FIREWALL_ENABLED' : 'FIREWALL_DISABLED', '', '');
}


const _HONEYPOT_TRIGGERS = new Map();

function honeypotSet(groupId, triggerText, action = 'shadowban', actor = '__system__') {
    const db = _readJSON(HONEYPOT_PATH, {});
    if (!db[groupId]) db[groupId] = [];
    const id = crypto.randomBytes(4).toString('hex');
    const entry = {
        id,
        trigger:   triggerText.toLowerCase().trim(),
        triggerHash: crypto.createHash('sha256').update(triggerText.toLowerCase().trim()).digest('hex'),
        action,     // shadowban | blacklist | warn | kick
        active:    true,
        triggered: 0,
        caught:    [],
        created:   Date.now(),
        createdBy: actor,
    };
    db[groupId].push(entry);
    _writeJSON(HONEYPOT_PATH, db);
    _rebuildHoneypotCache(groupId, db[groupId]);
    auditLog(groupId, actor, 'HONEYPOT_SET', '', `Trigger: [REDACTED] Action: ${action}`);
    return id;
}

function _rebuildHoneypotCache(groupId, entries) {
    _HONEYPOT_TRIGGERS.set(groupId, (entries || []).filter(e => e.active));
}

/**
 * Cek apakah pesan memicu honeypot
 * @returns {{ trapped: boolean, action: string, honeypotId: string }}
 */
function honeypotCheck(groupId, senderId, text) {
    if (!text) return { trapped: false };
    let traps = _HONEYPOT_TRIGGERS.get(groupId);
    if (!traps) {
        const db = _readJSON(HONEYPOT_PATH, {});
        traps = (db[groupId] || []).filter(e => e.active);
        _HONEYPOT_TRIGGERS.set(groupId, traps);
    }

    const lower = text.toLowerCase().trim();
    const textHash = crypto.createHash('sha256').update(lower).digest('hex');

    for (const trap of traps) {
        // Match by exact substring or hash
        if (lower.includes(trap.trigger) || textHash === trap.triggerHash) {
            // Record the catch
            const db = _readJSON(HONEYPOT_PATH, {});
            const entry = (db[groupId] || []).find(e => e.id === trap.id);
            if (entry) {
                entry.triggered++;
                entry.caught.push({ userId: senderId, ts: Date.now() });
                if (entry.caught.length > 100) entry.caught = entry.caught.slice(-50);
                _writeJSON(HONEYPOT_PATH, db);
            }

            incidentAdd(groupId, 'honeypot_triggered', senderId,
                `Terjebak honeypot ${trap.id}, action: ${trap.action}`, 'critical');
            auditLog(groupId, '__honeypot__', 'HONEYPOT_TRIGGERED', senderId, `ID: ${trap.id}`);

            // Auto-execute action
            if (trap.action === 'shadowban') {
                shadowBanAdd(groupId, senderId, 'Terjebak honeypot', 72 * 3600000);
            } else if (trap.action === 'blacklist') {
                firewallAddToList(groupId, senderId, 'blacklist', '__honeypot__');
            }

            repUpdate(groupId, senderId, 'phishing'); // -30 rep

            return { trapped: true, action: trap.action, honeypotId: trap.id };
        }
    }
    return { trapped: false };
}

function honeypotRemove(groupId, honeypotId, actor = '__system__') {
    const db = _readJSON(HONEYPOT_PATH, {});
    if (!db[groupId]) return;
    db[groupId] = db[groupId].map(e => e.id === honeypotId ? { ...e, active: false } : e);
    _writeJSON(HONEYPOT_PATH, db);
    _rebuildHoneypotCache(groupId, db[groupId]);
    auditLog(groupId, actor, 'HONEYPOT_REMOVED', '', `ID: ${honeypotId}`);
}

function honeypotList(groupId) {
    const db = _readJSON(HONEYPOT_PATH, {});
    return (db[groupId] || []).filter(e => e.active).map(e => ({
        id: e.id, action: e.action, triggered: e.triggered, created: e.created
    }));
}


const _LOCKDOWN_CACHE = new Map();

function lockdownActivate(groupId, mode = 'total', durationMs = 3600000, actor = '__system__') {
    const db = _readJSON(LOCKDOWN_PATH, {});
    db[groupId] = {
        active:    true,
        mode,      // total | media_only | text_only | slowmode | emergency | verified_only
        since:     Date.now(),
        until:     Date.now() + durationMs,
        activatedBy: actor,
        slowmodeMs: mode === 'slowmode' ? 30000 : 0,
        exemptRoles: ['owner', 'admin'],
    };
    _LOCKDOWN_CACHE.set(groupId, db[groupId]);
    _writeJSON(LOCKDOWN_PATH, db);
    auditLog(groupId, actor, 'LOCKDOWN_ACTIVATED', '', `Mode: ${mode}, Durasi: ${Math.floor(durationMs/60000)} menit`);
    incidentAdd(groupId, 'lockdown_activated', actor, `Mode: ${mode}`, 'high');
}

function lockdownDeactivate(groupId, actor = '__system__') {
    const db = _readJSON(LOCKDOWN_PATH, {});
    if (db[groupId]) {
        db[groupId].active = false;
        _writeJSON(LOCKDOWN_PATH, db);
    }
    _LOCKDOWN_CACHE.delete(groupId);
    auditLog(groupId, actor, 'LOCKDOWN_DEACTIVATED', '', '');
}

const _SLOWMODE_TRACKER = new Map();

/**
 * Cek apakah pesan diblokir oleh lockdown
 * @returns {{ blocked: boolean, reason: string, mode: string }}
 */
function lockdownCheck(groupId, senderId, msgMeta = {}, senderRole = 'member') {
    let lock = _LOCKDOWN_CACHE.get(groupId);
    if (!lock) {
        const db = _readJSON(LOCKDOWN_PATH, {});
        lock = db[groupId];
        if (lock) _LOCKDOWN_CACHE.set(groupId, lock);
    }
    if (!lock || !lock.active) return { blocked: false, reason: '', mode: 'none' };

    // Auto-expire
    if (Date.now() > lock.until) {
        lockdownDeactivate(groupId, '__auto__');
        return { blocked: false, reason: 'Lockdown expired', mode: 'none' };
    }

    // Exempt roles
    if (lock.exemptRoles.includes(senderRole))
        return { blocked: false, reason: 'Exempt by role', mode: lock.mode };

    switch (lock.mode) {
        case 'total':
            return { blocked: true, reason: '🔒 Grup dalam lockdown total', mode: 'total' };

        case 'emergency':
            // Hanya owner
            if (senderRole !== 'owner')
                return { blocked: true, reason: '🚨 Emergency lockdown — hanya owner', mode: 'emergency' };
            return { blocked: false, reason: '', mode: 'emergency' };

        case 'media_only':
            if (msgMeta.hasMedia)
                return { blocked: true, reason: '🔒 Media dilarang saat lockdown', mode: 'media_only' };
            return { blocked: false, reason: '', mode: 'media_only' };

        case 'text_only':
            if (msgMeta.hasMedia || msgMeta.isSticker || msgMeta.isDocument)
                return { blocked: true, reason: '🔒 Hanya teks diizinkan', mode: 'text_only' };
            return { blocked: false, reason: '', mode: 'text_only' };

        case 'slowmode': {
            const key = `${groupId}:${senderId}`;
            const last = _SLOWMODE_TRACKER.get(key) || 0;
            const diff = Date.now() - last;
            if (diff < lock.slowmodeMs) {
                return { blocked: true,
                    reason: `⏳ Slowmode: tunggu ${Math.ceil((lock.slowmodeMs - diff)/1000)} detik`,
                    mode: 'slowmode' };
            }
            _SLOWMODE_TRACKER.set(key, Date.now());
            return { blocked: false, reason: '', mode: 'slowmode' };
        }

        case 'verified_only':
            // Hanya user yang sudah solve CAPTCHA / verified
            if (!captchaIsVerified(groupId, senderId))
                return { blocked: true, reason: '🔒 Hanya member terverifikasi yang bisa chat', mode: 'verified_only' };
            return { blocked: false, reason: '', mode: 'verified_only' };

        default:
            return { blocked: false, reason: '', mode: lock.mode };
    }
}

function lockdownGetStatus(groupId) {
    let lock = _LOCKDOWN_CACHE.get(groupId);
    if (!lock) {
        const db = _readJSON(LOCKDOWN_PATH, {});
        lock = db[groupId];
    }
    if (!lock || !lock.active || Date.now() > lock.until)
        return { active: false };
    return {
        active: true,
        mode: lock.mode,
        remaining: Math.ceil((lock.until - Date.now()) / 60000) + ' menit',
        activatedBy: lock.activatedBy,
    };
}


const DEFAULT_ROLES = {
    owner:     { level: 100, name: 'Owner',     canAll: true },
    coowner:   { level: 90,  name: 'Co-Owner',  canAll: false },
    admin:     { level: 70,  name: 'Admin',      canAll: false },
    moderator: { level: 50,  name: 'Moderator',  canAll: false },
    trusted:   { level: 30,  name: 'Trusted',    canAll: false },
    member:    { level: 10,  name: 'Member',      canAll: false },
    restricted:{ level: 1,   name: 'Restricted',  canAll: false },
    banned:    { level: 0,   name: 'Banned',      canAll: false },
};

// Default command permissions
const CMD_PERMISSIONS = {
    // Owner only
    'killswitch':     { minLevel: 100 },
    'ownerlogin':     { minLevel: 100 },
    'firewall':       { minLevel: 100 },
    'honeypot':       { minLevel: 100 },
    'lockdown':       { minLevel: 90 },
    'shadowban':      { minLevel: 90 },
    'backup':         { minLevel: 100 },
    'securityconfig': { minLevel: 90 },
    'captchaconfig':  { minLevel: 70 },
    // Admin
    'kick':           { minLevel: 70 },
    'ban':            { minLevel: 70 },
    'warn':           { minLevel: 50 },
    'mute':           { minLevel: 50 },
    // Moderator
    'delete':         { minLevel: 50 },
    'pin':            { minLevel: 50 },
    // Everyone
    'menu':           { minLevel: 1 },
    'help':           { minLevel: 1 },
    'info':           { minLevel: 1 },
};

function permSetRole(groupId, userId, roleName, actor = '__system__') {
    if (!DEFAULT_ROLES[roleName]) return false;
    const db = _readJSON(PERMISSION_PATH, {});
    if (!db[groupId]) db[groupId] = {};
    db[groupId][userId] = {
        role:      roleName,
        level:     DEFAULT_ROLES[roleName].level,
        setBy:     actor,
        setAt:     Date.now(),
    };
    _writeJSON(PERMISSION_PATH, db);
    auditLog(groupId, actor, 'SET_ROLE', userId, `Role: ${roleName}`);
    return true;
}

function permGetRole(groupId, userId) {
    const db = _readJSON(PERMISSION_PATH, {});
    return db[groupId]?.[userId]?.role || 'member';
}

function permGetLevel(groupId, userId) {
    const db = _readJSON(PERMISSION_PATH, {});
    const role = db[groupId]?.[userId]?.role || 'member';
    return DEFAULT_ROLES[role]?.level || 10;
}

/**
 * Cek apakah user punya izin untuk command tertentu
 * @returns {{ allowed: boolean, reason: string, userLevel: number, requiredLevel: number }}
 */
function permCheckCommand(groupId, userId, command, ownerList = []) {
    // Owner selalu bypass
    if (ownerQuickCheck(userId, ownerList))
        return { allowed: true, reason: 'Owner bypass', userLevel: 100, requiredLevel: 0 };

    const userLevel = permGetLevel(groupId, userId);
    const cmdPerm   = CMD_PERMISSIONS[command];

    // Jika command tidak didefinisikan, default member level
    const requiredLevel = cmdPerm?.minLevel || 10;

    if (userLevel >= requiredLevel)
        return { allowed: true, reason: 'OK', userLevel, requiredLevel };

    return {
        allowed: false,
        reason: `Butuh level ${requiredLevel} (${_levelToRoleName(requiredLevel)}), kamu level ${userLevel}`,
        userLevel, requiredLevel
    };
}

function _levelToRoleName(level) {
    for (const [name, info] of Object.entries(DEFAULT_ROLES)) {
        if (info.level === level) return info.name;
    }
    return `Level ${level}`;
}

function permSetCommandLevel(command, minLevel, actor = '__system__') {
    CMD_PERMISSIONS[command] = { minLevel };
    auditLog('__system__', actor, 'SET_CMD_PERMISSION', '', `${command} → level ${minLevel}`);
}

function permGetAllRoles(groupId) {
    const db = _readJSON(PERMISSION_PATH, {});
    return Object.entries(db[groupId] || {})
        .map(([uid, v]) => ({ uid, role: v.role, level: v.level }))
        .sort((a, b) => b.level - a.level);
}



function threatIntelAdd(identifier, type, detail = '', severity = 'high', actor = '__system__') {
    const db = _readJSON(THREAT_INTEL_PATH, { entries: [], lastUpdate: 0 });
    const hash = crypto.createHash('sha256').update(identifier.toLowerCase()).digest('hex');

    // Deduplicate
    if (db.entries.some(e => e.hash === hash && e.type === type)) return false;

    db.entries.push({
        id:        crypto.randomBytes(4).toString('hex'),
        hash,
        type,      // phone | domain | pattern | fingerprint | jid
        detail,
        severity,
        addedBy:   actor,
        addedAt:   Date.now(),
        hits:      0,
    });
    db.lastUpdate = Date.now();
    if (db.entries.length > 5000) db.entries = db.entries.slice(-3000);
    _writeJSON(THREAT_INTEL_PATH, db);
    auditLog('__system__', actor, 'THREAT_INTEL_ADD', '', `Type: ${type}, Severity: ${severity}`);
    return true;
}

/**
 * Cek apakah identifier ada di threat intel
 * @returns {{ isThreat: boolean, entries: Array }}
 */
function threatIntelCheck(identifier) {
    const db   = _readJSON(THREAT_INTEL_PATH, { entries: [] });
    const hash = crypto.createHash('sha256').update(identifier.toLowerCase()).digest('hex');
    const matches = db.entries.filter(e => e.hash === hash);

    if (matches.length) {
        // Increment hit counter
        for (const m of matches) m.hits++;
        _writeJSON(THREAT_INTEL_PATH, db);
        return { isThreat: true, entries: matches };
    }
    return { isThreat: false, entries: [] };
}

function threatIntelSearch(type, limit = 20) {
    const db = _readJSON(THREAT_INTEL_PATH, { entries: [] });
    return db.entries
        .filter(e => !type || e.type === type)
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, limit);
}

function threatIntelRemove(entryId, actor = '__system__') {
    const db = _readJSON(THREAT_INTEL_PATH, { entries: [] });
    db.entries = db.entries.filter(e => e.id !== entryId);
    _writeJSON(THREAT_INTEL_PATH, db);
    auditLog('__system__', actor, 'THREAT_INTEL_REMOVE', '', `ID: ${entryId}`);
}


function quarantineAdd(groupId, senderId, messageContent, reason, severity = 'medium') {
    const db = _readJSON(QUARANTINE_PATH, {});
    if (!db[groupId]) db[groupId] = [];

    const id = crypto.randomBytes(6).toString('hex');
    const contentHash = crypto.createHash('sha256')
        .update(typeof messageContent === 'string' ? messageContent : JSON.stringify(messageContent))
        .digest('hex');

    db[groupId].push({
        id,
        senderId,
        contentPreview: typeof messageContent === 'string'
            ? messageContent.slice(0, 200) + (messageContent.length > 200 ? '...' : '')
            : '[non-text]',
        contentHash,
        reason,
        severity,
        ts:       Date.now(),
        time:     new Date().toLocaleString('id-ID'),
        reviewed: false,
        verdict:  null,    // 'safe' | 'malicious' | 'spam'
        reviewedBy: null,
    });

    if (db[groupId].length > 500) db[groupId] = db[groupId].slice(-300);
    _writeJSON(QUARANTINE_PATH, db);
    return id;
}

function quarantineReview(groupId, quarantineId, verdict, reviewer) {
    const db = _readJSON(QUARANTINE_PATH, {});
    const entry = (db[groupId] || []).find(e => e.id === quarantineId);
    if (!entry) return false;

    entry.reviewed   = true;
    entry.verdict    = verdict;
    entry.reviewedBy = reviewer;
    entry.reviewedAt = Date.now();

    _writeJSON(QUARANTINE_PATH, db);
    auditLog(groupId, reviewer, 'QUARANTINE_REVIEW', entry.senderId, `Verdict: ${verdict}, ID: ${quarantineId}`);

    // Jika malicious, tambah ke threat intel
    if (verdict === 'malicious') {
        threatIntelAdd(entry.contentHash, 'fingerprint',
            `Quarantined content dari ${entry.senderId}`, 'high', reviewer);
        repUpdate(groupId, entry.senderId, 'phishing');
    }

    return true;
}

function quarantineGetPending(groupId, limit = 20) {
    const db = _readJSON(QUARANTINE_PATH, {});
    return (db[groupId] || [])
        .filter(e => !e.reviewed)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);
}

function quarantineGetAll(groupId, limit = 50) {
    const db = _readJSON(QUARANTINE_PATH, {});
    return (db[groupId] || [])
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);
}



const _CAPTCHA_PENDING = new Map();
const _CAPTCHA_VERIFIED_CACHE = new Map();

function captchaGenerate(groupId, userId) {
    // Generate math captcha
    const ops  = ['+', '-', '×'];
    const op   = ops[Math.floor(Math.random() * ops.length)];
    const a    = Math.floor(Math.random() * 20) + 1;
    const b    = Math.floor(Math.random() * 15) + 1;
    let answer;
    switch (op) {
        case '+': answer = a + b; break;
        case '-': answer = Math.max(a, b) - Math.min(a, b); break;
        case '×': answer = a * b; break;
    }
    const question = op === '-'
        ? `${Math.max(a,b)} ${op} ${Math.min(a,b)} = ?`
        : `${a} ${op} ${b} = ?`;

    const id = crypto.randomBytes(4).toString('hex');
    const entry = {
        id,
        groupId,
        userId,
        question,
        answer:    String(answer),
        answerHash: crypto.createHash('sha256').update(String(answer)).digest('hex'),
        attempts:  0,
        maxAttempts: 3,
        created:   Date.now(),
        expiresAt: Date.now() + 300000, // 5 menit
        solved:    false,
    };

    _CAPTCHA_PENDING.set(`${groupId}:${userId}`, entry);

    // Simpan ke file juga
    const db = _readJSON(CAPTCHA_PATH, {});
    if (!db[groupId]) db[groupId] = {};
    db[groupId][userId] = entry;
    _writeJSON(CAPTCHA_PATH, db);

    return { id, question, expiresIn: '5 menit' };
}

/**
 * Verifikasi jawaban captcha
 * @returns {{ correct: boolean, reason: string, attemptsLeft: number }}
 */
function captchaVerify(groupId, userId, userAnswer) {
    const key   = `${groupId}:${userId}`;
    let entry = _CAPTCHA_PENDING.get(key);

    if (!entry) {
        const db = _readJSON(CAPTCHA_PATH, {});
        entry = db[groupId]?.[userId];
        if (entry) _CAPTCHA_PENDING.set(key, entry);
    }

    if (!entry) return { correct: false, reason: 'Tidak ada captcha pending', attemptsLeft: 0 };
    if (entry.solved) return { correct: true, reason: 'Sudah terverifikasi', attemptsLeft: 0 };

    if (Date.now() > entry.expiresAt) {
        _CAPTCHA_PENDING.delete(key);
        return { correct: false, reason: 'Captcha expired. Minta ulang.', attemptsLeft: 0 };
    }

    entry.attempts++;
    const answerHash = crypto.createHash('sha256').update(String(userAnswer).trim()).digest('hex');

    if (answerHash === entry.answerHash) {
        entry.solved = true;
        _CAPTCHA_PENDING.delete(key);
        _CAPTCHA_VERIFIED_CACHE.set(key, Date.now());

        // Save verified status
        const db = _readJSON(CAPTCHA_PATH, {});
        if (!db.__verified__) db.__verified__ = {};
        if (!db.__verified__[groupId]) db.__verified__[groupId] = {};
        db.__verified__[groupId][userId] = { since: Date.now(), solvedAt: Date.now() };
        if (db[groupId]?.[userId]) delete db[groupId][userId];
        _writeJSON(CAPTCHA_PATH, db);

        repUpdate(groupId, userId, 'good_message');
        auditLog(groupId, userId, 'CAPTCHA_SOLVED', '', '');

        return { correct: true, reason: '✅ Verifikasi berhasil!', attemptsLeft: 0 };
    }

    const left = entry.maxAttempts - entry.attempts;
    if (left <= 0) {
        _CAPTCHA_PENDING.delete(key);
        incidentAdd(groupId, 'captcha_failed', userId, 'Gagal captcha 3x', 'medium');
        repUpdate(groupId, userId, 'spam');
        return { correct: false, reason: '❌ Gagal 3x! Anda akan di-restrict.', attemptsLeft: 0 };
    }

    return { correct: false, reason: `❌ Salah! Sisa percobaan: ${left}`, attemptsLeft: left };
}

function captchaIsVerified(groupId, userId) {
    const key = `${groupId}:${userId}`;
    if (_CAPTCHA_VERIFIED_CACHE.has(key)) return true;

    const db = _readJSON(CAPTCHA_PATH, {});
    const verified = db.__verified__?.[groupId]?.[userId];
    if (verified) {
        _CAPTCHA_VERIFIED_CACHE.set(key, verified.since);
        return true;
    }
    return false;
}

function captchaIsPending(groupId, userId) {
    const key = `${groupId}:${userId}`;
    const entry = _CAPTCHA_PENDING.get(key);
    if (entry && !entry.solved && Date.now() < entry.expiresAt) return true;
    const db = _readJSON(CAPTCHA_PATH, {});
    const dbEntry = db[groupId]?.[userId];
    return !!(dbEntry && !dbEntry.solved && Date.now() < dbEntry.expiresAt);
}

function captchaResetUser(groupId, userId, actor = '__system__') {
    const key = `${groupId}:${userId}`;
    _CAPTCHA_PENDING.delete(key);
    _CAPTCHA_VERIFIED_CACHE.delete(key);
    const db = _readJSON(CAPTCHA_PATH, {});
    if (db[groupId]?.[userId]) delete db[groupId][userId];
    if (db.__verified__?.[groupId]?.[userId]) delete db.__verified__[groupId][userId];
    _writeJSON(CAPTCHA_PATH, db);
    auditLog(groupId, actor, 'CAPTCHA_RESET', userId, '');
}



const _BEHAVIOR_WINDOW = new Map(); // runtime behavior data

/**
 * Record perilaku user
 */
function behaviorRecord(groupId, userId, eventType, metadata = {}) {
    const key = `${groupId}:${userId}`;
    if (!_BEHAVIOR_WINDOW.has(key)) {
        _BEHAVIOR_WINDOW.set(key, {
            events:     [],
            baseline:   null,
            anomalyScore: 0,
        });
    }

    const bw = _BEHAVIOR_WINDOW.get(key);
    bw.events.push({
        type:  eventType,  // msg | cmd | media | join | leave | reaction
        ts:    Date.now(),
        meta:  metadata,
    });

    // Keep only last 200 events
    if (bw.events.length > 200) bw.events = bw.events.slice(-150);

    // Recalculate anomaly score
    bw.anomalyScore = _behaviorCalcAnomaly(bw);
}

function _behaviorCalcAnomaly(bw) {
    const now    = Date.now();
    const recent = bw.events.filter(e => now - e.ts < 300000); // last 5 min
    if (recent.length < 5) return 0;

    let score = 0;

    // Factor 1: Message frequency spike
    const msgCount   = recent.filter(e => e.type === 'msg').length;
    const cmdCount   = recent.filter(e => e.type === 'cmd').length;
    const mediaCount = recent.filter(e => e.type === 'media').length;

    if (msgCount > 30) score += 20;    // >30 msg in 5 min
    if (msgCount > 60) score += 30;    // >60 msg in 5 min
    if (cmdCount > 15) score += 25;    // >15 cmd in 5 min
    if (mediaCount > 10) score += 15;  // >10 media in 5 min

    // Factor 2: Regularity (bot-like behavior)
    if (recent.length >= 10) {
        const intervals = [];
        for (let i = 1; i < recent.length; i++) {
            intervals.push(recent[i].ts - recent[i-1].ts);
        }
        const avg = intervals.reduce((a,b) => a+b, 0) / intervals.length;
        const variance = intervals.reduce((s,v) => s + (v-avg)**2, 0) / intervals.length;
        const stddev = Math.sqrt(variance);
        // Sangat regular (stddev rendah) = kemungkinan bot
        if (avg > 0 && stddev < avg * 0.1 && recent.length > 15) score += 30;
    }

    // Factor 3: Rapid topic switching (cmd spam)
    const uniqueCmds = new Set(recent.filter(e => e.type === 'cmd').map(e => e.meta?.cmd)).size;
    if (uniqueCmds > 10) score += 15;

    // Factor 4: Night activity surge (unusual hours)
    const hour = new Date().getHours();
    if ((hour >= 1 && hour <= 5) && msgCount > 15) score += 10;

    return Math.min(100, score);
}

/**
 * Get anomaly score dan assessment
 * @returns {{ score: number, level: string, factors: string[] }}
 */
function behaviorGetAnomaly(groupId, userId) {
    const key = `${groupId}:${userId}`;
    const bw  = _BEHAVIOR_WINDOW.get(key);
    if (!bw) return { score: 0, level: 'normal', factors: [] };

    const score = bw.anomalyScore;
    let level = 'normal';
    if (score >= 70) level = 'critical';
    else if (score >= 50) level = 'high';
    else if (score >= 30) level = 'medium';
    else if (score >= 15) level = 'low';

    const factors = [];
    const now    = Date.now();
    const recent = bw.events.filter(e => now - e.ts < 300000);
    const msgCount = recent.filter(e => e.type === 'msg').length;
    if (msgCount > 30) factors.push(`${msgCount} pesan dalam 5 menit`);
    if (score >= 30) factors.push('Pola perilaku mencurigakan');

    return { score, level, factors };
}

/**
 * Auto-action berdasarkan anomaly score
 */
function behaviorAutoAction(groupId, userId) {
    const anomaly = behaviorGetAnomaly(groupId, userId);
    const actions = [];

    if (anomaly.score >= 70) {
        // Critical: shadowban + blacklist
        shadowBanAdd(groupId, userId, 'Anomaly score critical: ' + anomaly.score, 24 * 3600000);
        firewallAddToList(groupId, userId, 'blacklist', '__behavior__');
        incidentAdd(groupId, 'behavior_critical', userId,
            `Anomaly score: ${anomaly.score}. Factors: ${anomaly.factors.join(', ')}`, 'critical');
        actions.push('shadowban', 'blacklist');
    } else if (anomaly.score >= 50) {
        // High: graylist + warn
        firewallAddToList(groupId, userId, 'graylist', '__behavior__');
        repUpdate(groupId, userId, 'spam');
        incidentAdd(groupId, 'behavior_high', userId,
            `Anomaly score: ${anomaly.score}`, 'high');
        actions.push('graylist', 'rep_decrease');
    } else if (anomaly.score >= 30) {
        // Medium: monitor
        repUpdate(groupId, userId, 'warn');
        actions.push('warned');
    }

    return { anomaly, actions };
}

// Cleanup behavior data setiap 10 menit
setInterval(() => {
    const now = Date.now();
    for (const [k, bw] of _BEHAVIOR_WINDOW.entries()) {
        bw.events = bw.events.filter(e => now - e.ts < 600000);
        if (!bw.events.length) _BEHAVIOR_WINDOW.delete(k);
    }
}, 600000);



/**
 * Hitung Shannon entropy dari string
 * Text normal ~3.5-4.5, random/gibberish ~5.5+
 * @returns {number}
 */
function _shannonEntropy(str) {
    if (!str || str.length < 2) return 0;
    const freq = {};
    for (const c of str) freq[c] = (freq[c] || 0) + 1;
    const len = str.length;
    let entropy = 0;
    for (const c in freq) {
        const p = freq[c] / len;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

/**
 * Analisis apakah pesan adalah gibberish/generated
 * @returns {{ isGibberish: boolean, entropy: number, reason: string }}
 */
function entropyAnalysis(text) {
    if (!text || text.length < 10) return { isGibberish: false, entropy: 0, reason: '' };

    // Remove common formatting
    const cleaned = text.replace(/[\s\n\r\t]/g, '').replace(/[^\x20-\x7E\u00C0-\u024F\u0400-\u04FF]/g, '');
    if (cleaned.length < 8) return { isGibberish: false, entropy: 0, reason: '' };

    const entropy = _shannonEntropy(cleaned);

    // Bigram entropy (pasangan karakter)
    const bigrams = [];
    for (let i = 0; i < cleaned.length - 1; i++) bigrams.push(cleaned.slice(i, i+2));
    const bigramEntropy = _shannonEntropy(bigrams.join('|'));

    const factors = [];
    let isGibberish = false;

    // High character entropy
    if (entropy > 5.0 && cleaned.length > 20) {
        factors.push(`Entropy karakter tinggi: ${entropy.toFixed(2)}`);
        isGibberish = true;
    }

    // Repetitive single character pattern
    const maxRepeat = Math.max(...Object.values(
        cleaned.split('').reduce((a,c) => { a[c]=(a[c]||0)+1; return a; }, {})
    ));
    if (maxRepeat > cleaned.length * 0.5 && cleaned.length > 15) {
        factors.push('Karakter berulang berlebihan');
        isGibberish = true;
    }

    // Ratio huruf kapital tidak wajar
    const upperCount = (cleaned.match(/[A-Z]/g) || []).length;
    const lowerCount = (cleaned.match(/[a-z]/g) || []).length;
    if (lowerCount > 0 && upperCount / lowerCount > 0.8 && cleaned.length > 20) {
        factors.push('Rasio huruf kapital tidak wajar');
    }

    // No vowels (common in generated spam)
    const vowels = (cleaned.match(/[aeiouAEIOU]/gi) || []).length;
    if (cleaned.length > 15 && vowels / cleaned.length < 0.1) {
        factors.push('Hampir tidak ada huruf vokal');
        isGibberish = true;
    }

    return {
        isGibberish,
        entropy: parseFloat(entropy.toFixed(3)),
        bigramEntropy: parseFloat(bigramEntropy.toFixed(3)),
        reason: factors.join('; ') || 'Normal',
        factors,
    };
}



const ZERO_WIDTH_CHARS = ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff'];

/**
 * Encode user ID ke zero-width string (tak terlihat)
 */
function _encodeCanary(userId) {
    const bytes = Buffer.from(userId, 'utf8');
    let encoded = '';
    for (const byte of bytes) {
        const bits = byte.toString(2).padStart(8, '0');
        for (const bit of bits) {
            encoded += bit === '1' ? ZERO_WIDTH_CHARS[0] : ZERO_WIDTH_CHARS[1];
        }
        encoded += ZERO_WIDTH_CHARS[2]; // separator
    }
    return encoded;
}

/**
 * Decode zero-width string kembali ke user ID
 */
function _decodeCanary(text) {
    // Extract zero-width characters
    const zwc = text.split('').filter(c => ZERO_WIDTH_CHARS.includes(c)).join('');
    if (!zwc || zwc.length < 8) return null;

    const parts = zwc.split(ZERO_WIDTH_CHARS[2]).filter(p => p.length > 0);
    const bytes = [];
    for (const part of parts) {
        let byte = '';
        for (const c of part) {
            if (c === ZERO_WIDTH_CHARS[0]) byte += '1';
            else if (c === ZERO_WIDTH_CHARS[1]) byte += '0';
        }
        if (byte.length === 8) bytes.push(parseInt(byte, 2));
    }
    if (!bytes.length) return null;
    return Buffer.from(bytes).toString('utf8');
}

/**
 * Buat pesan dengan canary token (watermark tak terlihat)
 * @param {string} originalText 
 * @param {string} userId - user yang menerima
 * @returns {string} teks dengan watermark tersembunyi
 */
function canaryEmbed(originalText, userId) {
    const canary = _encodeCanary(userId);
    // Sisipkan di tengah teks agar tidak mudah di-strip
    const mid = Math.floor(originalText.length / 2);
    return originalText.slice(0, mid) + canary + originalText.slice(mid);
}

/**
 * Deteksi canary dalam teks yang di-forward
 * @returns {{ found: boolean, leakerUserId: string|null }}
 */
function canaryDetect(text) {
    if (!text) return { found: false, leakerUserId: null };
    const userId = _decodeCanary(text);
    if (userId && userId.length > 3) {
        return { found: true, leakerUserId: userId };
    }
    return { found: false, leakerUserId: null };
}

/**
 * Log canary untuk tracking
 */
function canaryRegister(groupId, messageId, userId, actor = '__system__') {
    const db = _readJSON(CANARY_PATH, {});
    if (!db[groupId]) db[groupId] = [];
    db[groupId].push({
        messageId,
        userId,
        ts: Date.now(),
        registeredBy: actor,
    });
    if (db[groupId].length > 500) db[groupId] = db[groupId].slice(-300);
    _writeJSON(CANARY_PATH, db);
}



const _2FA_PENDING = new Map();
const _2FA_TTL     = 120000; // 2 menit

/**
 * Generate 2FA challenge
 * @returns {{ code: string, expiresIn: number }}
 */
function twoFAGenerate(userId, action) {
    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digit
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const key  = `${userId}:${action}`;

    _2FA_PENDING.set(key, {
        codeHash,
        action,
        created:   Date.now(),
        expiresAt: Date.now() + _2FA_TTL,
        attempts:  0,
    });

    return { code, expiresIn: Math.floor(_2FA_TTL / 1000) };
}

/**
 * Verifikasi 2FA
 * @returns {{ valid: boolean, reason: string }}
 */
function twoFAVerify(userId, action, inputCode) {
    const key   = `${userId}:${action}`;
    const entry = _2FA_PENDING.get(key);

    if (!entry) return { valid: false, reason: 'Tidak ada 2FA pending' };
    if (Date.now() > entry.expiresAt) {
        _2FA_PENDING.delete(key);
        return { valid: false, reason: 'Kode expired' };
    }

    entry.attempts++;
    if (entry.attempts > 3) {
        _2FA_PENDING.delete(key);
        incidentAdd('__system__', '2fa_brute_force', userId,
            `3x gagal 2FA untuk action: ${action}`, 'high');
        return { valid: false, reason: 'Terlalu banyak percobaan' };
    }

    const inputHash = crypto.createHash('sha256').update(String(inputCode).trim()).digest('hex');
    if (inputHash === entry.codeHash) {
        _2FA_PENDING.delete(key);
        auditLog('__system__', userId, '2FA_VERIFIED', '', `Action: ${action}`);
        return { valid: true, reason: 'OK' };
    }

    return { valid: false, reason: `Kode salah. Sisa: ${3 - entry.attempts}` };
}

function twoFAIsPending(userId, action) {
    const key   = `${userId}:${action}`;
    const entry = _2FA_PENDING.get(key);
    return !!(entry && Date.now() < entry.expiresAt);
}

// Cleanup expired 2FA
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _2FA_PENDING.entries()) {
        if (now > v.expiresAt) _2FA_PENDING.delete(k);
    }
}, 60000);


function trustedDeviceRegister(userId, fingerprint, deviceName = 'unknown') {
    const db = _readJSON(TRUSTED_DEVICE_PATH, {});
    if (!db[userId]) db[userId] = [];
    const fpHash = crypto.createHash('sha256').update(fingerprint).digest('hex');

    if (!db[userId].some(d => d.fpHash === fpHash)) {
        db[userId].push({
            fpHash,
            deviceName,
            registeredAt: Date.now(),
            lastSeen:     Date.now(),
            trusted:      true,
        });
        _writeJSON(TRUSTED_DEVICE_PATH, db);
        auditLog('__system__', userId, 'DEVICE_REGISTERED', '', `Device: ${deviceName}`);
        return { isNew: true };
    } else {
        // Update last seen
        const dev = db[userId].find(d => d.fpHash === fpHash);
        dev.lastSeen = Date.now();
        _writeJSON(TRUSTED_DEVICE_PATH, db);
        return { isNew: false };
    }
}

function trustedDeviceCheck(userId, fingerprint) {
    const db = _readJSON(TRUSTED_DEVICE_PATH, {});
    if (!db[userId] || !db[userId].length) return { known: false, alert: false };
    const fpHash = crypto.createHash('sha256').update(fingerprint).digest('hex');
    const found  = db[userId].find(d => d.fpHash === fpHash);
    if (found && found.trusted) return { known: true, alert: false };
    if (found && !found.trusted) return { known: true, alert: true, reason: 'Device not trusted' };
    return { known: false, alert: true, reason: 'Unknown device' };
}

function trustedDeviceRevoke(userId, fpHash, actor = '__system__') {
    const db = _readJSON(TRUSTED_DEVICE_PATH, {});
    if (!db[userId]) return;
    db[userId] = db[userId].filter(d => d.fpHash !== fpHash);
    _writeJSON(TRUSTED_DEVICE_PATH, db);
    auditLog('__system__', actor, 'DEVICE_REVOKED', userId, `FP: ${fpHash.slice(0,8)}...`);
}



const INVITE_LINK_PATTERNS = [
    /chat\.whatsapp\.com\/[A-Za-z0-9]{15,}/g,
    /wa\.me\/[A-Za-z0-9]{15,}/g,
    /t\.me\/[A-Za-z0-9_]{3,}/g,
    /discord\.gg\/[A-Za-z0-9]+/g,
    /discord\.com\/invite\/[A-Za-z0-9]+/g,
    /t\.me\/joinchat\/[A-Za-z0-9_-]+/g,
    /line\.me\/R\/ti\/p\/[A-Za-z0-9%]+/g,
];

function inviteGuardCheck(groupId, text) {
    if (!text) return { hasInvite: false, links: [] };
    const db = _readJSON(INVITE_GUARD_PATH, {});
    const config = db[groupId] || { enabled: true, whitelist: [], action: 'delete' };
    if (!config.enabled) return { hasInvite: false, links: [] };

    const foundLinks = [];
    for (const pattern of INVITE_LINK_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = text.match(pattern);
        if (matches) foundLinks.push(...matches);
    }

    if (!foundLinks.length) return { hasInvite: false, links: [] };

    // Check whitelist
    const blocked = foundLinks.filter(link =>
        !config.whitelist.some(wl => link.includes(wl))
    );

    return {
        hasInvite: blocked.length > 0,
        links:     blocked,
        action:    config.action,
        totalFound: foundLinks.length,
        whitelisted: foundLinks.length - blocked.length,
    };
}

function inviteGuardSetConfig(groupId, config, actor = '__system__') {
    const db = _readJSON(INVITE_GUARD_PATH, {});
    db[groupId] = { ...db[groupId], ...config };
    _writeJSON(INVITE_GUARD_PATH, db);
    auditLog(groupId, actor, 'INVITE_GUARD_CONFIG', '', JSON.stringify(config).slice(0, 100));
}

function inviteGuardWhitelist(groupId, linkFragment, actor = '__system__') {
    const db = _readJSON(INVITE_GUARD_PATH, {});
    if (!db[groupId]) db[groupId] = { enabled: true, whitelist: [], action: 'delete' };
    if (!db[groupId].whitelist.includes(linkFragment)) {
        db[groupId].whitelist.push(linkFragment);
        _writeJSON(INVITE_GUARD_PATH, db);
        auditLog(groupId, actor, 'INVITE_WHITELIST_ADD', '', linkFragment);
    }
}



function vaultStore(groupId, senderId, messageContent, reason, vaultPassword) {
    const db = _readJSON(MSG_VAULT_PATH, {});
    if (!db[groupId]) db[groupId] = [];

    const id = crypto.randomBytes(6).toString('hex');
    const encrypted = encryptedBackup({
        senderId,
        content: messageContent,
        reason,
        ts: Date.now(),
    }, vaultPassword);

    db[groupId].push({
        id,
        senderHash: crypto.createHash('sha256').update(senderId).digest('hex').slice(0, 16),
        reason,
        ts:   Date.now(),
        time: new Date().toLocaleString('id-ID'),
        encryptedPayload: encrypted,
        size: encrypted.length,
    });

    if (db[groupId].length > 1000) db[groupId] = db[groupId].slice(-500);
    _writeJSON(MSG_VAULT_PATH, db);
    return id;
}

function vaultRetrieve(groupId, vaultId, vaultPassword) {
    const db = _readJSON(MSG_VAULT_PATH, {});
    const entry = (db[groupId] || []).find(e => e.id === vaultId);
    if (!entry) throw new Error('Vault entry not found');
    return decryptedBackup(entry.encryptedPayload, vaultPassword);
}

function vaultList(groupId, limit = 20) {
    const db = _readJSON(MSG_VAULT_PATH, {});
    return (db[groupId] || [])
        .map(e => ({ id: e.id, reason: e.reason, time: e.time, senderHash: e.senderHash }))
        .slice(-limit).reverse();
}


// ─────────────────────────────────────────────
//  32. ESCALATION CHAIN
//  Auto-escalate response berdasarkan tingkat ancaman.
//  Level 1→warn, 2→mute, 3→kick, 4→ban, 5→lockdown
// ─────────────────────────────────────────────
const ESCALATION_LEVELS = {
    1: { action: 'warn',     label: 'Peringatan',     cooldownMs: 300000 },
    2: { action: 'mute',     label: 'Mute 30 menit',  cooldownMs: 1800000 },
    3: { action: 'shadowban',label: 'Shadow Ban 6 jam',cooldownMs: 21600000 },
    4: { action: 'kick',     label: 'Kick dari grup',  cooldownMs: 86400000 },
    5: { action: 'blacklist',label: 'Blacklist permanen', cooldownMs: 0 },
};

function escalationGetLevel(groupId, userId) {
    const db = _readJSON(ESCALATION_PATH, {});
    return db[groupId]?.[userId]?.currentLevel || 0;
}

/**
 * Escalate user ke level berikutnya
 * @returns {{ newLevel: number, action: string, label: string }}
 */
function escalationStep(groupId, userId, reason = '') {
    const db = _readJSON(ESCALATION_PATH, {});
    if (!db[groupId]) db[groupId] = {};
    if (!db[groupId][userId]) {
        db[groupId][userId] = {
            currentLevel: 0,
            history: [],
            firstViolation: Date.now(),
            lastViolation: Date.now(),
        };
    }

    const user = db[groupId][userId];
    user.currentLevel = Math.min(5, user.currentLevel + 1);
    user.lastViolation = Date.now();
    user.history.push({
        level:  user.currentLevel,
        reason,
        ts:     Date.now(),
    });
    if (user.history.length > 50) user.history = user.history.slice(-30);

    const levelInfo = ESCALATION_LEVELS[user.currentLevel] || ESCALATION_LEVELS[5];
    _writeJSON(ESCALATION_PATH, db);

    // Execute action
    switch (levelInfo.action) {
        case 'shadowban':
            shadowBanAdd(groupId, userId, `Escalation level ${user.currentLevel}: ${reason}`, 21600000);
            break;
        case 'blacklist':
            firewallAddToList(groupId, userId, 'blacklist', '__escalation__');
            break;
    }

    repUpdate(groupId, userId, 'warn');
    incidentAdd(groupId, `escalation_level_${user.currentLevel}`, userId,
        `${levelInfo.label}: ${reason}`, user.currentLevel >= 4 ? 'critical' : 'high');
    auditLog(groupId, '__escalation__', `ESCALATE_L${user.currentLevel}`, userId, reason);

    return {
        newLevel: user.currentLevel,
        action:   levelInfo.action,
        label:    levelInfo.label,
    };
}

function escalationReset(groupId, userId, actor = '__system__') {
    const db = _readJSON(ESCALATION_PATH, {});
    if (db[groupId]?.[userId]) {
        db[groupId][userId].currentLevel = 0;
        db[groupId][userId].history.push({ level: 0, reason: 'Reset by ' + actor, ts: Date.now() });
        _writeJSON(ESCALATION_PATH, db);
        auditLog(groupId, actor, 'ESCALATION_RESET', userId, '');
    }
}

function escalationGetHistory(groupId, userId) {
    const db = _readJSON(ESCALATION_PATH, {});
    return db[groupId]?.[userId]?.history || [];
}

// Auto de-escalate setiap 6 jam (jika tidak ada pelanggaran baru)
setInterval(() => {
    const db  = _readJSON(ESCALATION_PATH, {});
    const now = Date.now();
    let changed = false;
    for (const gid in db) {
        for (const uid in db[gid]) {
            const user = db[gid][uid];
            if (user.currentLevel > 0 && now - user.lastViolation > 21600000) {
                user.currentLevel = Math.max(0, user.currentLevel - 1);
                user.history.push({ level: user.currentLevel, reason: 'Auto de-escalate', ts: now });
                changed = true;
            }
        }
    }
    if (changed) _writeJSON(ESCALATION_PATH, db);
}, 3600000);


const _ANOMALY_EVENTS = [];
const _ANOMALY_WINDOW = 300000; // 5 menit

function anomalyCorrelationRecord(groupId, userId, eventType) {
    _ANOMALY_EVENTS.push({
        groupId, userId, eventType, ts: Date.now()
    });
    // Trim old events
    const cutoff = Date.now() - _ANOMALY_WINDOW * 2;
    while (_ANOMALY_EVENTS.length > 0 && _ANOMALY_EVENTS[0].ts < cutoff) {
        _ANOMALY_EVENTS.shift();
    }
}

/**
 * Analisis apakah ada serangan terkoordinasi
 * @returns {{ isCoordinated: boolean, score: number, details: object }}
 */
function anomalyCorrelationAnalyze(groupId) {
    const now    = Date.now();
    const recent = _ANOMALY_EVENTS.filter(e => e.groupId === groupId && now - e.ts < _ANOMALY_WINDOW);

    if (recent.length < 3) return { isCoordinated: false, score: 0, details: {} };

    // Unique violators
    const uniqueUsers = new Set(recent.map(e => e.userId)).size;
    // Event type distribution
    const byType = {};
    for (const e of recent) byType[e.eventType] = (byType[e.eventType] || 0) + 1;
    // Temporal clustering (events happening close together)
    let clusterCount = 0;
    for (let i = 1; i < recent.length; i++) {
        if (recent[i].ts - recent[i-1].ts < 5000) clusterCount++;
    }

    let score = 0;
    // Multiple unique users violating simultaneously
    if (uniqueUsers >= 3) score += uniqueUsers * 10;
    // Temporal clustering
    if (clusterCount >= 5) score += clusterCount * 5;
    // Same type of violation repeated
    const maxTypeCount = Math.max(...Object.values(byType));
    if (maxTypeCount >= 5) score += maxTypeCount * 3;
    // Total volume
    if (recent.length >= 10) score += recent.length * 2;

    const isCoordinated = score >= 50;

    if (isCoordinated) {
        incidentAdd(groupId, 'coordinated_attack_detected', '__system__',
            `Score: ${score}, Users: ${uniqueUsers}, Events: ${recent.length}`, 'critical');
        auditLog(groupId, '__anomaly_engine__', 'COORDINATED_ATTACK_DETECTED', '',
            `Score: ${score}`);

        // Auto-save
        const db = _readJSON(ANOMALY_PATH, {});
        if (!db[groupId]) db[groupId] = [];
        db[groupId].push({
            ts: now,
            score,
            uniqueUsers,
            eventCount: recent.length,
            byType,
            clusterCount,
        });
        if (db[groupId].length > 200) db[groupId] = db[groupId].slice(-100);
        _writeJSON(ANOMALY_PATH, db);
    }

    return {
        isCoordinated,
        score,
        details: {
            uniqueUsers,
            eventCount: recent.length,
            byType,
            clusterCount,
            threshold: 50,
        }
    };
}

/**
 * Auto-response untuk serangan terkoordinasi
 */
function anomalyAutoLockdown(groupId, actor = '__anomaly_engine__') {
    const analysis = anomalyCorrelationAnalyze(groupId);
    if (analysis.isCoordinated && analysis.score >= 80) {
        // Emergency lockdown
        lockdownActivate(groupId, 'emergency', 1800000, actor); // 30 menit
        return { locked: true, score: analysis.score };
    } else if (analysis.isCoordinated && analysis.score >= 50) {
        // Slowmode
        lockdownActivate(groupId, 'slowmode', 900000, actor); // 15 menit
        return { locked: true, score: analysis.score, mode: 'slowmode' };
    }
    return { locked: false, score: analysis.score };
}


const SUSPICIOUS_URL_PARAMS = [
    'token', 'session', 'auth', 'key', 'password', 'passwd', 'secret',
    'api_key', 'apikey', 'access_token', 'refresh_token', 'otp',
    'redirect', 'return_url', 'callback', 'next', 'goto', 'continue',
];

const DANGEROUS_EXTENSIONS = [
    '.exe', '.bat', '.cmd', '.scr', '.pif', '.com', '.vbs', '.js',
    '.wsf', '.msi', '.apk', '.deb', '.rpm', '.sh', '.ps1',
];

function deepLinkAnalysis(url) {
    if (!url) return { safe: true, risks: [] };
    const risks = [];
    let riskScore = 0;

    try {
        const parsed = new URL(url.startsWith('http') ? url : 'https://' + url);

        // Check suspicious parameters
        for (const param of SUSPICIOUS_URL_PARAMS) {
            if (parsed.searchParams.has(param)) {
                risks.push(`Parameter sensitif: ${param}`);
                riskScore += 15;
            }
        }

        // Check for encoded/obfuscated URLs in parameters
        for (const [key, val] of parsed.searchParams.entries()) {
            // Double encoding
            if (/%25[0-9a-f]{2}/i.test(val)) {
                risks.push(`Double URL encoding di param "${key}"`);
                riskScore += 20;
            }
            // Base64 encoded URLs
            try {
                const decoded = Buffer.from(val, 'base64').toString('utf8');
                if (/https?:\/\//i.test(decoded)) {
                    risks.push(`URL tersembunyi (base64) di param "${key}"`);
                    riskScore += 25;
                }
            } catch {}
            // Data URI
            if (/^data:/i.test(val)) {
                risks.push(`Data URI di param "${key}"`);
                riskScore += 30;
            }
        }

        // Check for dangerous file extensions
        const pathLower = parsed.pathname.toLowerCase();
        for (const ext of DANGEROUS_EXTENSIONS) {
            if (pathLower.endsWith(ext)) {
                risks.push(`File berbahaya: ${ext}`);
                riskScore += 40;
            }
        }

        // Check for IP address instead of domain
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname)) {
            risks.push('Menggunakan IP address langsung');
            riskScore += 15;
        }

        // Check for unusual ports
        if (parsed.port && !['80', '443', '8080', '8443'].includes(parsed.port)) {
            risks.push(`Port tidak umum: ${parsed.port}`);
            riskScore += 10;
        }

        // Check for very long URLs (often phishing)
        if (url.length > 500) {
            risks.push(`URL sangat panjang (${url.length} karakter)`);
            riskScore += 10;
        }

        // Subdomain depth (many subdomains = suspicious)
        const subdomains = parsed.hostname.split('.');
        if (subdomains.length > 4) {
            risks.push(`Terlalu banyak subdomain (${subdomains.length})`);
            riskScore += 15;
        }

        // Check for @ in URL (credential harvesting)
        if (url.includes('@') && url.indexOf('@') < url.indexOf(parsed.hostname)) {
            risks.push('Karakter @ sebelum domain (credential harvesting)');
            riskScore += 35;
        }

        // Check for homoglyph in domain
        const phishResult = checkPhishing(url);
        if (phishResult.isPhishing) {
            risks.push(phishResult.reason);
            riskScore += 40;
        }

    } catch {
        risks.push('URL tidak valid / malformed');
        riskScore += 20;
    }

    const riskLevel = riskScore >= 60 ? 'critical'
                    : riskScore >= 40 ? 'high'
                    : riskScore >= 20 ? 'medium'
                    : riskScore >= 10 ? 'low'
                    : 'safe';

    return {
        safe: riskScore < 20,
        riskScore,
        riskLevel,
        risks,
    };
}

function cmdACLSet(groupId, command, config, actor = '__system__') {
    const db = _readJSON(CMD_ACL_PATH, {});
    if (!db[groupId]) db[groupId] = {};
    db[groupId][command] = {
        enabled:       config.enabled !== false,
        allowedUsers:  config.allowedUsers || [],   // JID whitelist
        blockedUsers:  config.blockedUsers || [],   // JID blacklist
        minReputation: config.minReputation || 0,   // min rep score
        cooldownMs:    config.cooldownMs || 0,      // cooldown per user
        maxUsesPerDay: config.maxUsesPerDay || 0,   // 0 = unlimited
        timeRestrict:  config.timeRestrict || null,  // { startHour, endHour }
        updatedBy:     actor,
        updatedAt:     Date.now(),
    };
    _writeJSON(CMD_ACL_PATH, db);
    auditLog(groupId, actor, 'CMD_ACL_SET', '', `Command: ${command}`);
}

const _CMD_ACL_USAGE = new Map();

/**
 * Cek apakah user boleh pakai command berdasarkan ACL
 * @returns {{ allowed: boolean, reason: string }}
 */
function cmdACLCheck(groupId, userId, command) {
    const db     = _readJSON(CMD_ACL_PATH, {});
    const config = db[groupId]?.[command];
    if (!config) return { allowed: true, reason: 'No ACL set' };

    if (!config.enabled)
        return { allowed: false, reason: `Command .${command} dinonaktifkan di grup ini` };

    // User blacklist
    if (config.blockedUsers.includes(userId))
        return { allowed: false, reason: 'Kamu diblokir dari command ini' };

    // User whitelist (jika ada, hanya mereka yang boleh)
    if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(userId))
        return { allowed: false, reason: 'Kamu tidak dalam whitelist command ini' };

    // Reputation check
    if (config.minReputation > 0) {
        const rep = repGet(groupId, userId);
        if (rep < config.minReputation)
            return { allowed: false, reason: `Reputasi kurang (${rep}/${config.minReputation})` };
    }

    // Cooldown
    if (config.cooldownMs > 0) {
        const cdKey = `${groupId}:${userId}:${command}`;
        const last  = _CMD_ACL_USAGE.get(cdKey);
        if (last && Date.now() - last < config.cooldownMs) {
            const wait = Math.ceil((config.cooldownMs - (Date.now() - last)) / 1000);
            return { allowed: false, reason: `Cooldown: tunggu ${wait} detik` };
        }
        _CMD_ACL_USAGE.set(cdKey, Date.now());
    }

    // Max uses per day
    if (config.maxUsesPerDay > 0) {
        const dayKey   = `${groupId}:${userId}:${command}:day`;
        const dayStart = new Date().setHours(0, 0, 0, 0);
        const usage    = _CMD_ACL_USAGE.get(dayKey) || { count: 0, dayStart: 0 };
        if (usage.dayStart < dayStart) {
            usage.count = 0;
            usage.dayStart = dayStart;
        }
        if (usage.count >= config.maxUsesPerDay)
            return { allowed: false, reason: `Limit harian tercapai (${config.maxUsesPerDay}x/hari)` };
        usage.count++;
        _CMD_ACL_USAGE.set(dayKey, usage);
    }

    // Time restriction
    if (config.timeRestrict) {
        const hour = new Date().getHours();
        const { startHour, endHour } = config.timeRestrict;
        if (startHour <= endHour) {
            if (hour < startHour || hour >= endHour)
                return { allowed: false, reason: `Command hanya tersedia pukul ${startHour}:00 - ${endHour}:00` };
        } else {
            // Overnight range (e.g., 22-06)
            if (hour < startHour && hour >= endHour)
                return { allowed: false, reason: `Command hanya tersedia pukul ${startHour}:00 - ${endHour}:00` };
        }
    }

    return { allowed: true, reason: 'OK' };
}

function cmdACLGet(groupId, command) {
    const db = _readJSON(CMD_ACL_PATH, {});
    return db[groupId]?.[command] || null;
}

function cmdACLList(groupId) {
    const db = _readJSON(CMD_ACL_PATH, {});
    return Object.entries(db[groupId] || {}).map(([cmd, conf]) => ({
        command: cmd,
        enabled: conf.enabled,
        minReputation: conf.minReputation,
    }));
}
const MALICIOUS_PATTERNS = [
    /eval\s*\(/i,
    /Function\s*\(/i,
    /require\s*\(\s*['"]child_process/i,
    /require\s*\(\s*['"]fs['"]\s*\)/i,
    /process\.exit/i,
    /process\.env/i,
    /global\s*\.\s*\w+\s*=/i,
    /import\s+.*from\s+['"]os['"]/i,
    /exec\s*\(/i,
    /spawn\s*\(/i,
    /__proto__/i,
    /constructor\s*\[\s*['"]prototype/i,
    /Object\.defineProperty/i,
    /\.call\s*\(\s*this/i,
    /\bdelete\s+\w+\.\w+/i,
    /while\s*\(\s*true\s*\)/i,
    /for\s*\(\s*;\s*;\s*\)/i,
    /setTimeout\s*\(\s*.*,\s*0\s*\)/i,
    /Buffer\.from/i,
    /crypto\.\w+/i,
];

/**
 * Scan teks untuk malicious code patterns
 * @returns {{ isMalicious: boolean, patterns: string[], riskScore: number }}
 */
function sandboxScan(text) {
    if (!text || text.length < 5) return { isMalicious: false, patterns: [], riskScore: 0 };

    const found = [];
    let score = 0;

    for (const pattern of MALICIOUS_PATTERNS) {
        if (pattern.test(text)) {
            found.push(pattern.source.slice(0, 30));
            score += 15;
        }
    }

    // Check for obfuscation techniques
    const hexEscapes = (text.match(/\\x[0-9a-f]{2}/gi) || []).length;
    if (hexEscapes > 5) {
        found.push(`${hexEscapes} hex escapes (obfuscation)`);
        score += hexEscapes * 3;
    }

    const unicodeEscapes = (text.match(/\\u[0-9a-f]{4}/gi) || []).length;
    if (unicodeEscapes > 5) {
        found.push(`${unicodeEscapes} unicode escapes (obfuscation)`);
        score += unicodeEscapes * 3;
    }

    // Very long single line (often obfuscated)
    const maxLineLen = Math.max(...text.split('\n').map(l => l.length));
    if (maxLineLen > 1000) {
        found.push('Baris sangat panjang (kemungkinan obfuscated)');
        score += 20;
    }

    return {
        isMalicious: score >= 30,
        patterns: found,
        riskScore: Math.min(100, score),
    };
}


function floodForensicRecord(groupId, eventType, senderId, metadata = {}) {
    const db = _readJSON(FLOOD_FORENSIC_PATH, {});
    if (!db[groupId]) db[groupId] = [];
    db[groupId].push({
        ts:        Date.now(),
        eventType,
        senderId,
        metadata,
    });
    if (db[groupId].length > 2000) db[groupId] = db[groupId].slice(-1000);
    _writeJSON(FLOOD_FORENSIC_PATH, db);
}

function floodForensicAnalyze(groupId, windowMs = 300000) {
    const db  = _readJSON(FLOOD_FORENSIC_PATH, {});
    const now = Date.now();
    const events = (db[groupId] || []).filter(e => now - e.ts < windowMs);

    if (events.length < 5) return { isFlood: false };

    const byUser = {};
    const byType = {};
    const timeline = [];

    for (const e of events) {
        byUser[e.senderId] = (byUser[e.senderId] || 0) + 1;
        byType[e.eventType] = (byType[e.eventType] || 0) + 1;
    }

    // Create 30-second buckets for timeline
    const bucketSize = 30000;
    const buckets = {};
    for (const e of events) {
        const bucket = Math.floor(e.ts / bucketSize) * bucketSize;
        buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    const peakBucket = Math.max(...Object.values(buckets));

    const topUsers = Object.entries(byUser)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([uid, count]) => ({ uid, count }));

    return {
        isFlood:    events.length > 50 || peakBucket > 20,
        totalEvents: events.length,
        windowMs,
        byType,
        topUsers,
        peak:      peakBucket,
        peakLabel: `${peakBucket} events/30s`,
        uniqueUsers: Object.keys(byUser).length,
        timeline:  Object.entries(buckets).map(([ts, count]) => ({
            time: new Date(Number(ts)).toLocaleTimeString('id-ID'),
            count
        })),
    };
}


let _KILLSWITCH_ACTIVE = false;
let _KILLSWITCH_REASON = '';
let _KILLSWITCH_BY     = '';

function killswitchActivate(reason = '', actor = '__system__') {
    _KILLSWITCH_ACTIVE = true;
    _KILLSWITCH_REASON = reason;
    _KILLSWITCH_BY     = actor;
    const db = { active: true, reason, activatedBy: actor, ts: Date.now() };
    _writeJSON(KILLSWITCH_PATH, db);
    auditLog('__system__', actor, 'KILLSWITCH_ACTIVATED', '', reason);
    incidentAdd('__system__', 'killswitch', actor, reason, 'critical');
}

function killswitchDeactivate(actor = '__system__') {
    _KILLSWITCH_ACTIVE = false;
    _KILLSWITCH_REASON = '';
    _KILLSWITCH_BY     = '';
    _writeJSON(KILLSWITCH_PATH, { active: false });
    auditLog('__system__', actor, 'KILLSWITCH_DEACTIVATED', '', '');
}

function killswitchIsActive() {
    // Also check file (in case of restart)
    if (_KILLSWITCH_ACTIVE) return true;
    try {
        const db = _readJSON(KILLSWITCH_PATH, {});
        if (db.active) {
            _KILLSWITCH_ACTIVE = true;
            _KILLSWITCH_REASON = db.reason || '';
            _KILLSWITCH_BY     = db.activatedBy || '';
            return true;
        }
    } catch {}
    return false;
}

function killswitchGetStatus() {
    return {
        active: killswitchIsActive(),
        reason: _KILLSWITCH_REASON,
        activatedBy: _KILLSWITCH_BY,
    };
}


// ─────────────────────────────────────────────
//  39. ANTI-FORWARD CHAIN DETECTOR
//  Deteksi pesan yang di-forward berulang kali
//  (chain message / hoax spreader)
// ─────────────────────────────────────────────
const _FORWARD_TRACKER = new Map();
const _FORWARD_WINDOW  = 600000; // 10 menit
const _FORWARD_MAX     = 3;

/**
 * Cek apakah pesan terindikasi forwarded chain message
 * @param {object} msgMeta - { isForwarded, forwardScore, text }
 * @returns {{ isChain: boolean, reason: string, forwardCount: number }}
 */
function antiForwardChain(groupId, senderId, msgMeta = {}) {
    if (!msgMeta.isForwarded) return { isChain: false, reason: '', forwardCount: 0 };

    const text = msgMeta.text || '';
    const hash = crypto.createHash('md5')
        .update(text.trim().toLowerCase().slice(0, 300))
        .digest('hex');
    const key  = `${groupId}:${hash}`;
    const now  = Date.now();

    if (!_FORWARD_TRACKER.has(key)) _FORWARD_TRACKER.set(key, []);
    const arr = _FORWARD_TRACKER.get(key).filter(t => now - t.ts < _FORWARD_WINDOW);
    arr.push({ ts: now, sender: senderId });
    _FORWARD_TRACKER.set(key, arr);

    // Count unique senders forwarding same content
    const uniqueSenders = new Set(arr.map(a => a.sender)).size;

    // High forward score from WhatsApp
    const highScore = (msgMeta.forwardScore || 0) >= 5;

    const isChain = uniqueSenders >= _FORWARD_MAX || highScore;

    if (isChain) {
        // Check for known hoax patterns
        const hoaxPatterns = [
            /bagikan\s*(ke|kepada)\s*\d+\s*(grup|orang|teman)/i,
            /sebarkan\s*sebelum\s*dihapus/i,
            /forward\s*(ke|to)\s*\d+\s*(group|people)/i,
            /kirim\s*ulang/i,
            /viral\s*kan/i,
            /jangan\s*putus\s*rantai/i,
        ];
        const isHoax = hoaxPatterns.some(p => p.test(text));

        return {
            isChain: true,
            reason: isHoax
                ? 'Chain message / hoax terdeteksi'
                : `Pesan sama di-forward oleh ${uniqueSenders} orang`,
            forwardCount: uniqueSenders,
            isHoax,
        };
    }

    return { isChain: false, reason: '', forwardCount: uniqueSenders };
}

// Cleanup forward tracker
setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of _FORWARD_TRACKER.entries()) {
        const fresh = arr.filter(e => now - e.ts < _FORWARD_WINDOW);
        if (!fresh.length) _FORWARD_TRACKER.delete(k);
        else _FORWARD_TRACKER.set(k, fresh);
    }
}, 120000);


// ─────────────────────────────────────────────
//  40. MEDIA FILE SCANNER
//  Analisis metadata file media untuk deteksi
//  file berbahaya yang disamarkan
// ─────────────────────────────────────────────
const DANGEROUS_MIMETYPES = [
    'application/x-executable',
    'application/x-msdos-program',
    'application/x-msdownload',
    'application/x-dosexec',
    'application/bat',
    'application/x-sh',
    'application/x-shellscript',
    'application/javascript',
    'text/javascript',
    'application/x-python',
    'application/hta',
    'application/x-httpd-php',
];

const SUSPICIOUS_DOUBLE_EXT = [
    /\.(jpg|jpeg|png|gif|pdf|doc|docx)\.(exe|bat|cmd|scr|vbs|js|ps1|sh)$/i,
    /\.(jpg|jpeg|png|gif|pdf|doc|docx)\.(php|asp|jsp|py|rb|pl)$/i,
];

/**
 * Scan metadata file media
 * @param {object} fileMeta - { mimetype, fileName, fileSize, caption }
 * @returns {{ safe: boolean, risks: string[], riskScore: number }}
 */
function mediaScan(fileMeta = {}) {
    const risks = [];
    let riskScore = 0;

    // Check mimetype
    if (DANGEROUS_MIMETYPES.includes(fileMeta.mimetype)) {
        risks.push(`Tipe file berbahaya: ${fileMeta.mimetype}`);
        riskScore += 50;
    }

    // Check filename
    if (fileMeta.fileName) {
        // Double extension
        for (const pattern of SUSPICIOUS_DOUBLE_EXT) {
            if (pattern.test(fileMeta.fileName)) {
                risks.push('Double extension (file disamarkan)');
                riskScore += 40;
                break;
            }
        }

        // Dangerous extension
        const ext = path.extname(fileMeta.fileName).toLowerCase();
        if (DANGEROUS_EXTENSIONS.includes(ext)) {
            risks.push(`Ekstensi berbahaya: ${ext}`);
            riskScore += 45;
        }

        // Very long filename (obfuscation)
        if (fileMeta.fileName.length > 200) {
            risks.push('Nama file sangat panjang (kemungkinan obfuscation)');
            riskScore += 10;
        }

        // Unicode in filename (trick visual)
        if (/[\u200e\u200f\u202a-\u202e]/.test(fileMeta.fileName)) {
            risks.push('Karakter Unicode tersembunyi di nama file (RLO attack)');
            riskScore += 35;
        }
    }

    // Check file size anomalies
    if (fileMeta.fileSize) {
        // Extremely small "document" (likely not real)
        if (fileMeta.mimetype?.startsWith('application/') && fileMeta.fileSize < 100) {
            risks.push('File dokumen terlalu kecil (kemungkinan dropper)');
            riskScore += 20;
        }
        // Extremely large (possible DoS)
        if (fileMeta.fileSize > 100 * 1024 * 1024) { // >100MB
            risks.push('File terlalu besar (>100MB)');
            riskScore += 15;
        }
    }

    // Check caption for social engineering
    if (fileMeta.caption) {
        const sePatterns = [
            /buka\s*(segera|sekarang|cepat)/i,
            /penting\s*(banget|sekali|!!!)/i,
            /password\s*[:=]/i,
            /install\s*(segera|sekarang)/i,
            /update\s*(segera|wajib|penting)/i,
        ];
        for (const p of sePatterns) {
            if (p.test(fileMeta.caption)) {
                risks.push('Caption mengandung social engineering');
                riskScore += 15;
                break;
            }
        }
    }

    return {
        safe: riskScore < 20,
        risks,
        riskScore: Math.min(100, riskScore),
        riskLevel: riskScore >= 50 ? 'critical'
                 : riskScore >= 30 ? 'high'
                 : riskScore >= 15 ? 'medium'
                 : 'low',
    };
}



/**
 * Cek apakah actor boleh melakukan aksi terhadap target
 * @returns {{ allowed: boolean, reason: string }}
 */
function roleHierarchyCheck(groupId, actorId, targetId, action, ownerList = []) {
    // Owner bisa semuanya
    if (ownerQuickCheck(actorId, ownerList))
        return { allowed: true, reason: 'Owner bypass' };

    const actorLevel  = permGetLevel(groupId, actorId);
    const targetLevel = permGetLevel(groupId, targetId);

    // Target adalah owner
    if (ownerQuickCheck(targetId, ownerList))
        return { allowed: false, reason: 'Tidak bisa memodifikasi owner' };

    // Actor harus lebih tinggi dari target
    if (actorLevel <= targetLevel)
        return { allowed: false,
            reason: `Level kamu (${actorLevel}) tidak cukup untuk memodifikasi user level ${targetLevel}` };

    // Certain actions need minimum actor level
    const actionMinLevels = {
        'kick':       70,
        'ban':        70,
        'blacklist':  90,
        'set_role':   80,
        'shadowban':  90,
        'lockdown':   90,
    };

    const minLevel = actionMinLevels[action] || 50;
    if (actorLevel < minLevel)
        return { allowed: false, reason: `Aksi "${action}" butuh minimum level ${minLevel}` };

    return { allowed: true, reason: 'OK' };
}



function securityDashboard(groupId, groupName = 'Grup') {
    const incidents   = incidentGetSummary(groupId, 86400000);
    const repList     = repGetList(groupId, 10);
    const shadows     = getShadowBanList(groupId);
    const health      = sessionGetHealth();
    const lockStatus  = lockdownGetStatus(groupId);
    const fwConfig    = firewallGetConfig(groupId);
    const honeypots   = honeypotList(groupId);
    const pendingQ    = quarantineGetPending(groupId, 5);
    const killStatus  = killswitchGetStatus();
    const floodData   = floodForensicAnalyze(groupId, 600000);
    const coordination = anomalyCorrelationAnalyze(groupId);

    return {
        groupId,
        groupName,
        generatedAt: new Date().toLocaleString('id-ID'),
        killswitch: killStatus,
        health,
        lockdown: lockStatus,
        firewall: {
            enabled:    fwConfig.enabled,
            blacklistCount: (fwConfig.blacklist || []).length,
            graylistCount:  (fwConfig.graylist || []).length,
            whitelistCount: (fwConfig.whitelist || []).length,
            ruleCount:      (fwConfig.rules || []).length,
        },
        incidents,
        reputationLowest: repList.slice(0, 5),
        shadowBans: shadows.length,
        honeypotCount: honeypots.length,
        quarantinePending: pendingQ.length,
        floodStatus: floodData.isFlood ? 'ACTIVE FLOOD' : 'Normal',
        coordinatedAttack: coordination.isCoordinated ? 'DETECTED' : 'None',
        coordinatedScore: coordination.score,
    };
}

/**
 * Format dashboard sebagai teks untuk dikirim
 */
function formatSecurityDashboard(groupId, groupName = 'Grup') {
    const d = securityDashboard(groupId, groupName);

    const statusIcon = d.killswitch.active ? '🚫 KILLSWITCH AKTIF'
        : d.floodStatus === 'ACTIVE FLOOD' ? '🌊 FLOOD TERDETEKSI'
        : d.coordinatedAttack === 'DETECTED' ? '⚔️ SERANGAN TERKOORDINASI'
        : d.lockdown.active ? `🔒 LOCKDOWN (${d.lockdown.mode})`
        : '✅ NORMAL';

    const repWorst = d.reputationLowest
        .map(r => `   @${r.uid.split('@')[0]}: ${r.score}/200`)
        .join('\n') || '   Semua baik';

    return `

  🛡️ SECURITY DASHBOARD           

📂 ${groupName.slice(0, 28).padEnd(28)} 
📅 ${d.generatedAt.padEnd(28)} 

 STATUS: ${statusIcon.padEnd(23)} 


🤖 *BOT HEALTH*
   Status: ${d.health.status} | Uptime: ${Math.floor(d.health.uptime/3600)}h
   Pesan/min: ${d.health.msgPerMin} | Error: ${d.health.errorRate}

🔥 *FIREWALL*
   ${d.firewall.enabled ? '✅ Aktif' : '❌ Nonaktif'}
   Blacklist: ${d.firewall.blacklistCount} | Gray: ${d.firewall.graylistCount}
   Rules: ${d.firewall.ruleCount} | Whitelist: ${d.firewall.whitelistCount}

📊 *INSIDEN (24 JAM)*
   Total: ${d.incidents.total} | Kritis: ${d.incidents.critical}
${d.incidents.topOffender ? `   🚨 Top offender: @${d.incidents.topOffender.uid.split('@')[0]} (${d.incidents.topOffender.count}x)` : ''}

⚠️ *REPUTASI TERENDAH*
${repWorst}

🔇 Shadow Ban: ${d.shadowBans}
🍯 Honeypot: ${d.honeypotCount}
📦 Quarantine pending: ${d.quarantinePending}

${d.lockdown.active ? `🔒 Lockdown: ${d.lockdown.mode} (sisa ${d.lockdown.remaining})` : '🔓 Lockdown: Nonaktif'}
${d.coordinatedAttack === 'DETECTED' ? `⚔️ SERANGAN TERKOORDINASI! Score: ${d.coordinatedScore}` : ''}


_Gunakan .secdetail untuk info lebih lanjut_`;
}


/**
 * Master security check — jalankan semua layer keamanan
 * @param {object} ctx - {
 *   groupId, senderId, pushName, text, ownerList,
 *   mentionedJids, isCommand, command, msgMeta,
 *   senderRole, adminNames, bannedList
 * }
 * @returns {{ 
 *   allowed: boolean, 
 *   blocked: boolean, 
 *   actions: string[], 
 *   warnings: string[], 
 *   reason: string,
 *   details: object 
 * }}
 */
function securityMiddleware(ctx = {}) {
    const {
        groupId = '', senderId = '', pushName = '', text = '',
        ownerList = [], mentionedJids = [], isCommand = false,
        command = '', msgMeta = {}, senderRole = 'member',
        adminNames = [], bannedList = [],
    } = ctx;

    const actions  = [];
    const warnings = [];
    const details  = {};
    let blocked    = false;
    let reason     = '';

    //
    if (killswitchIsActive()) {
        // Hanya owner yang bisa bypass killswitch
        if (!ownerQuickCheck(senderId, ownerList)) {
            return {
                allowed: false, blocked: true,
                actions: ['killswitch_block'], warnings: [],
                reason: '🚫 Bot dalam mode darurat (killswitch aktif)',
                details: { killswitch: true }
            };
        }
    }

    // 
    if (isGlobalBanned(senderId, bannedList)) {
        actions.push('global_ban_block');
        return {
            allowed: false, blocked: true, actions, warnings: [],
            reason: 'Global banned', details: { globalBanned: true }
        };
    }

    //
    const fwResult = firewallProcess(groupId, senderId, msgMeta);
    details.firewall = fwResult;
    if (!fwResult.allowed) {
        actions.push(`firewall_${fwResult.action}`);
        blocked = true;
        reason  = fwResult.reason;
    }

    //
    if (!blocked) {
        const lockResult = lockdownCheck(groupId, senderId, msgMeta, senderRole);
        details.lockdown = lockResult;
        if (lockResult.blocked) {
            actions.push('lockdown_block');
            blocked = true;
            reason  = lockResult.reason;
        }
    }

    //
    if (isShadowBanned(groupId, senderId)) {
        actions.push('shadowban_silenced');
        details.shadowBanned = true;
        blocked = true;
        reason  = 'Shadowbanned';
        // Shadowban: silent block, no notification
    }

    //
    if (!blocked && captchaIsPending(groupId, senderId)) {
        if (!isCommand || command !== 'verify') {
            actions.push('captcha_pending');
            blocked = true;
            reason  = '🔐 Selesaikan verifikasi dulu!';
        }
    }

    if (!blocked && isCommand) {
        // Rate limit
        const rateResult = checkCmdRate(senderId, command);
        details.rateLimit = rateResult;
        if (!rateResult.allowed) {
            actions.push('rate_limited');
            blocked = true;
            reason  = rateResult.reason;
        }

        // Permission check
        if (!blocked) {
            const permResult = permCheckCommand(groupId, senderId, command, ownerList);
            details.permission = permResult;
            if (!permResult.allowed) {
                actions.push('permission_denied');
                blocked = true;
                reason  = `⛔ ${permResult.reason}`;
            }
        }

        // ACL check
        if (!blocked) {
            const aclResult = cmdACLCheck(groupId, senderId, command);
            details.acl = aclResult;
            if (!aclResult.allowed) {
                actions.push('acl_blocked');
                blocked = true;
                reason  = aclResult.reason;
            }
        }
    }

    // ─── LEVEL 7: CONTENT ANALYSIS (non-blocking warnings) ───
    if (!blocked && text) {
        // Phishing check
        const urls = text.match(/https?:\/\/[^\s]+/gi) || [];
        for (const url of urls) {
            const phishResult = checkPhishing(url);
            if (phishResult.isPhishing) {
                actions.push('phishing_detected');
                warnings.push(`⚠️ Link phishing: ${phishResult.reason}`);
                details.phishing = phishResult;
                blocked = true;
                reason  = `🚨 Link berbahaya terdeteksi!`;
                repUpdate(groupId, senderId, 'phishing');
                incidentAdd(groupId, 'phishing', senderId, phishResult.reason, 'critical');
                anomalyCorrelationRecord(groupId, senderId, 'phishing');
                break;
            }

            // Deep link analysis
            const deepResult = deepLinkAnalysis(url);
            if (!deepResult.safe) {
                warnings.push(`⚠️ Link mencurigakan: ${deepResult.risks[0]}`);
                details.deepLink = deepResult;
                if (deepResult.riskScore >= 40) {
                    quarantineAdd(groupId, senderId, text, `Deep link risk: ${deepResult.riskScore}`, 'high');
                    actions.push('deep_link_quarantine');
                }
            }
        }

        // Invite link check
        if (!blocked) {
            const invResult = inviteGuardCheck(groupId, text);
            if (invResult.hasInvite) {
                actions.push('invite_link_blocked');
                blocked = true;
                reason  = `🔗 Link invite grup lain tidak diizinkan`;
                details.inviteGuard = invResult;
                repUpdate(groupId, senderId, 'spam');
                incidentAdd(groupId, 'invite_link', senderId, `${invResult.links.length} invite link`, 'medium');
            }
        }

        // Duplicate message
        if (!blocked) {
            const dupResult = checkDuplicateMessage(groupId, senderId, text);
            details.duplicate = dupResult;
            if (dupResult.isDuplicate) {
                warnings.push('🔄 Pesan duplikat terdeteksi');
                repUpdate(groupId, senderId, 'duplicate');
                anomalyCorrelationRecord(groupId, senderId, 'duplicate');
            }
        }

        // PII detection
        const piiResult = detectPII(text);
        if (piiResult.length) {
            warnings.push(`🔒 Data sensitif terdeteksi: ${piiResult.map(p => p.type).join(', ')}`);
            details.pii = piiResult;
        }

        // Entropy (gibberish)
        const entropyResult = entropyAnalysis(text);
        if (entropyResult.isGibberish) {
            warnings.push('🤖 Pesan terindikasi generated/bot');
            details.entropy = entropyResult;
            repUpdate(groupId, senderId, 'spam');
        }

        // Sandbox scan
        const sandboxResult = sandboxScan(text);
        if (sandboxResult.isMalicious) {
            actions.push('malicious_code_blocked');
            blocked = true;
            reason  = '🚨 Kode berbahaya terdeteksi!';
            details.sandbox = sandboxResult;
            incidentAdd(groupId, 'malicious_code', senderId,
                sandboxResult.patterns.join(', '), 'critical');
            repUpdate(groupId, senderId, 'phishing');
        }

        // Content fingerprint (cross-group spam)
        const fpResult = fingerprintCheck(senderId, text);
        if (fpResult.isSpread) {
            warnings.push('📡 Pesan sama terdeteksi di banyak tempat (broadcast spam)');
            details.fingerprint = fpResult;
            repUpdate(groupId, senderId, 'spam');
        }

        // Honeypot check
        const hpResult = honeypotCheck(groupId, senderId, text);
        if (hpResult.trapped) {
            actions.push('honeypot_triggered');
            blocked = true;
            reason  = 'Honeypot triggered';
            details.honeypot = hpResult;
        }
    }

    // ─── LEVEL 8: MENTION BOMB ───
    if (!blocked && mentionedJids.length) {
        const mentionResult = checkMentionBomb(groupId, senderId, mentionedJids, text);
        details.mentionBomb = mentionResult;
        if (mentionResult.isBomb) {
            actions.push('mention_bomb_blocked');
            blocked = true;
            reason  = `🏷️ Mention bomb (${mentionResult.count} tags)!`;
            repUpdate(groupId, senderId, 'mention_bomb');
            incidentAdd(groupId, 'mention_bomb', senderId,
                `${mentionResult.count} mentions`, 'high');
            anomalyCorrelationRecord(groupId, senderId, 'mention_bomb');
        }
    }

    // ─── LEVEL 9: FAKE ADMIN CHECK ───
    if (pushName) {
        const fakeResult = checkFakeAdmin(pushName, adminNames);
        details.fakeAdmin = fakeResult;
        if (fakeResult.isFakeAdmin) {
            warnings.push(`👤 ${fakeResult.reason}`);
            repUpdate(groupId, senderId, 'fake_admin');
            incidentAdd(groupId, 'fake_admin', senderId, fakeResult.reason, 'high');
        }
    }

    // ─── LEVEL 10: FORWARD CHAIN ───
    if (!blocked && msgMeta.isForwarded) {
        const fwdResult = antiForwardChain(groupId, senderId, msgMeta);
        details.forwardChain = fwdResult;
        if (fwdResult.isChain) {
            warnings.push(`📨 ${fwdResult.reason}`);
            if (fwdResult.isHoax) {
                actions.push('hoax_blocked');
                blocked = true;
                reason  = fwdResult.reason;
            }
        }
    }

    // ─── LEVEL 11: MEDIA SCAN ───
    if (!blocked && msgMeta.hasMedia && msgMeta.fileMeta) {
        const mediaResult = mediaScan(msgMeta.fileMeta);
        details.mediaScan = mediaResult;
        if (!mediaResult.safe) {
            actions.push('media_blocked');
            blocked = true;
            reason  = `🚫 File berbahaya: ${mediaResult.risks[0]}`;
            incidentAdd(groupId, 'dangerous_media', senderId,
                mediaResult.risks.join('; '), mediaResult.riskLevel);
        }
    }

    // ─── LEVEL 12: BEHAVIORAL ───
    if (!blocked) {
        behaviorRecord(groupId, senderId, isCommand ? 'cmd' : msgMeta.hasMedia ? 'media' : 'msg',
            { cmd: command });
        const anomaly = behaviorGetAnomaly(groupId, senderId);
        details.behavior = anomaly;
        if (anomaly.score >= 70) {
            const autoResult = behaviorAutoAction(groupId, senderId);
            actions.push(...autoResult.actions);
            if (autoResult.actions.includes('shadowban')) {
                blocked = true;
                reason  = '🤖 Perilaku bot/spam terdeteksi';
            }
        } else if (anomaly.score >= 30) {
            warnings.push(`📊 Anomaly score: ${anomaly.score}/100`);
        }
    }

    // ─── LEVEL 13: COORDINATED ATTACK CHECK ───
    if (blocked) {
        anomalyCorrelationRecord(groupId, senderId, 'violation');
        const coordResult = anomalyAutoLockdown(groupId);
        if (coordResult.locked) {
            actions.push('auto_lockdown');
            details.coordinatedAttack = coordResult;
        }
    }

    // ─── LEVEL 14: ESCALATION ───
    // Hanya escalate untuk pelanggaran konten nyata, bukan rate limit / firewall throttle
    const _ESCALATE_TRIGGERS = [
        'phishing_detected','malicious_code_blocked','mention_bomb_blocked',
        'honeypot_triggered','hoax_blocked','media_blocked','invite_link_blocked'
    ];
    if (blocked && !ownerQuickCheck(senderId, ownerList) &&
        actions.some(a => _ESCALATE_TRIGGERS.includes(a))) {
        const escResult = escalationStep(groupId, senderId, reason);
        details.escalation = escResult;
        actions.push(`escalated_to_L${escResult.newLevel}`);
    }

    // ─── RECORD ───
    sessionPing(isCommand ? 'cmd' : 'msg');
    if (blocked) {
        floodForensicRecord(groupId, reason.slice(0, 50), senderId, { command, actions });
    }

    return {
        allowed: !blocked,
        blocked,
        actions,
        warnings,
        reason,
        details,
    };
}


function compressedBackup(dataObj, password) {
    const json       = JSON.stringify(dataObj);
    const compressed = zlib.gzipSync(Buffer.from(json, 'utf8'));
    const salt       = crypto.randomBytes(16);
    const key        = crypto.scryptSync(password, salt, 32);
    const iv         = crypto.randomBytes(12);
    const cipher     = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc        = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const tag        = cipher.getAuthTag();
    const payload    = Buffer.concat([salt, iv, tag, enc]);
    return payload.toString('base64');
}

function decompressedBackup(base64, password) {
    try {
        const buf        = Buffer.from(base64, 'base64');
        const salt       = buf.slice(0, 16);
        const iv         = buf.slice(16, 28);
        const tag        = buf.slice(28, 44);
        const enc        = buf.slice(44);
        const key        = crypto.scryptSync(password, salt, 32);
        const decipher   = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const compressed = Buffer.concat([decipher.update(enc), decipher.final()]);
        const json       = zlib.gunzipSync(compressed).toString('utf8');
        return JSON.parse(json);
    } catch (e) {
        throw new Error('Decompression/decryption failed');
    }
}

/**
 * Full security data backup (semua file security)
 */
function fullSecurityBackup(password) {
    const data = {
        version:    2,
        timestamp:  Date.now(),
        time:       new Date().toLocaleString('id-ID'),
        audit:      _readJSON(AUDIT_PATH, {}),
        shadowban:  _readJSON(SHADOWBAN_PATH, {}),
        reputation: _readJSON(REPUTATION_PATH, {}),
        incidents:  _readJSON(INCIDENT_PATH, {}),
        firewall:   _readJSON(FIREWALL_PATH, {}),
        honeypot:   _readJSON(HONEYPOT_PATH, {}),
        lockdown:   _readJSON(LOCKDOWN_PATH, {}),
        permissions:_readJSON(PERMISSION_PATH, {}),
        threatIntel:_readJSON(THREAT_INTEL_PATH, {}),
        quarantine: _readJSON(QUARANTINE_PATH, {}),
        captcha:    _readJSON(CAPTCHA_PATH, {}),
        cmdAcl:     _readJSON(CMD_ACL_PATH, {}),
        escalation: _readJSON(ESCALATION_PATH, {}),
        inviteGuard:_readJSON(INVITE_GUARD_PATH, {}),
        roles:      _readJSON(ROLE_PATH, {}),
    };
    return compressedBackup(data, password);
}

/**
 * Restore full security data
 */
function fullSecurityRestore(base64, password) {
    const data = decompressedBackup(base64, password);
    if (data.version !== 2) throw new Error('Backup version tidak didukung');

    if (data.audit)       _writeJSON(AUDIT_PATH, data.audit);
    if (data.shadowban)   _writeJSON(SHADOWBAN_PATH, data.shadowban);
    if (data.reputation)  _writeJSON(REPUTATION_PATH, data.reputation);
    if (data.incidents)   _writeJSON(INCIDENT_PATH, data.incidents);
    if (data.firewall)    _writeJSON(FIREWALL_PATH, data.firewall);
    if (data.honeypot)    _writeJSON(HONEYPOT_PATH, data.honeypot);
    if (data.lockdown)    _writeJSON(LOCKDOWN_PATH, data.lockdown);
    if (data.permissions) _writeJSON(PERMISSION_PATH, data.permissions);
    if (data.threatIntel) _writeJSON(THREAT_INTEL_PATH, data.threatIntel);
    if (data.quarantine)  _writeJSON(QUARANTINE_PATH, data.quarantine);
    if (data.captcha)     _writeJSON(CAPTCHA_PATH, data.captcha);
    if (data.cmdAcl)      _writeJSON(CMD_ACL_PATH, data.cmdAcl);
    if (data.escalation)  _writeJSON(ESCALATION_PATH, data.escalation);
    if (data.inviteGuard) _writeJSON(INVITE_GUARD_PATH, data.inviteGuard);
    if (data.roles)       _writeJSON(ROLE_PATH, data.roles);

    auditLog('__system__', '__restore__', 'FULL_RESTORE', '',
        `Backup dari ${data.time || 'unknown'}`);

    return { success: true, backupTime: data.time, entries: Object.keys(data).length };
}


function integrityGenerate() {
    const files = [
        AUDIT_PATH, SHADOWBAN_PATH, REPUTATION_PATH, INCIDENT_PATH,
        FIREWALL_PATH, HONEYPOT_PATH, LOCKDOWN_PATH, PERMISSION_PATH,
        THREAT_INTEL_PATH, QUARANTINE_PATH, CAPTCHA_PATH, CMD_ACL_PATH,
        ESCALATION_PATH, INVITE_GUARD_PATH,
    ];

    const hashes = {};
    for (const f of files) {
        try {
            const content = fs.readFileSync(f, 'utf8');
            hashes[path.basename(f)] = crypto.createHash('sha256').update(content).digest('hex');
        } catch {
            hashes[path.basename(f)] = 'NOT_FOUND';
        }
    }

    const manifest = {
        ts:     Date.now(),
        time:   new Date().toLocaleString('id-ID'),
        hashes,
        checksum: crypto.createHash('sha256')
            .update(Object.values(hashes).sort().join(':'))
            .digest('hex'),
    };

    _writeJSON(`${SEC_DIR}/integrity.json`, manifest);
    return manifest;
}

function integrityVerify() {
    const manifest = _readJSON(`${SEC_DIR}/integrity.json`, null);
    if (!manifest) return { valid: false, reason: 'No integrity manifest found' };

    const current = integrityGenerate();
    const tampered = [];

    for (const [file, hash] of Object.entries(manifest.hashes)) {
        if (current.hashes[file] !== hash && hash !== 'NOT_FOUND') {
            tampered.push(file);
        }
    }

    if (tampered.length) {
        incidentAdd('__system__', 'integrity_violation', '__system__',
            `Files tampered: ${tampered.join(', ')}`, 'critical');
        return {
            valid:    false,
            reason:   'File security telah dimodifikasi di luar sistem!',
            tampered,
            lastCheck: manifest.time,
        };
    }

    return { valid: true, reason: 'OK', lastCheck: manifest.time };
}


function repDecayProcess() {
    const db  = _readJSON(REPUTATION_PATH, {});
    const now = Date.now();
    let changed = false;

    for (const gid in db) {
        for (const uid in db[gid]) {
            const user = db[gid][uid];
            const lastEvent = user.history?.length
                ? user.history[user.history.length - 1]
                : null;

            // Jika tidak ada pelanggaran 12 jam terakhir, recover 2 poin
            if (lastEvent && now - lastEvent.ts > 43200000 && user.score < 100) {
                user.score = Math.min(100, user.score + 2);
                user.history.push({ event: 'auto_decay_recovery', delta: 2, ts: now });
                changed = true;
            }
            // Jika reputation >100 (bonus), slowly decay back to 100
            if (user.score > 100 && lastEvent && now - lastEvent.ts > 86400000) {
                user.score = Math.max(100, user.score - 1);
                changed = true;
            }
        }
    }

    if (changed) _writeJSON(REPUTATION_PATH, db);
}

// Run reputation decay every 6 hours
setInterval(repDecayProcess, 21600000);


module.exports = {
    checkCmdRate,
    isGlobalBanned,
    checkPhishing,
    checkLinkSafety,
    checkDuplicateMessage,
    checkMentionBomb,
    checkFakeAdmin,
    detectPII,
    shadowBanAdd,
    shadowBanRemove,
    isShadowBanned,
    getShadowBanList,
    repGet,
    repUpdate,
    repGetList,
    auditLog,
    auditGetLast,
    incidentAdd,
    incidentGetSummary,
    sessionPing,
    sessionGetHealth,
    encryptedBackup,
    decryptedBackup,
    formatSecurityReport,
    fingerprintCheck,
    REP_EVENTS,
    SEVERITY,
    ownerGenerateToken,
    ownerValidateToken,
    ownerQuickCheck,
    ownerRevokeToken,
    firewallInit,
    firewallProcess,
    firewallAddToList,
    firewallRemoveFromList,
    firewallAddRule,
    firewallRemoveRule,
    firewallGetConfig,
    firewallSetEnabled,
    honeypotSet,
    honeypotCheck,
    honeypotRemove,
    honeypotList,
    lockdownActivate,
    lockdownDeactivate,
    lockdownCheck,
    lockdownGetStatus,
    permSetRole,
    permGetRole,
    permGetLevel,
    permCheckCommand,
    permSetCommandLevel,
    permGetAllRoles,
    DEFAULT_ROLES,
    CMD_PERMISSIONS,
    threatIntelAdd,
    threatIntelCheck,
    threatIntelSearch,
    threatIntelRemove,
    quarantineAdd,
    quarantineReview,
    quarantineGetPending,
    quarantineGetAll,
    captchaGenerate,
    captchaVerify,
    captchaIsVerified,
    captchaIsPending,
    captchaResetUser,
    behaviorRecord,
    behaviorGetAnomaly,
    behaviorAutoAction,
    entropyAnalysis,
    canaryEmbed,
    canaryDetect,
    canaryRegister,
    twoFAGenerate,
    twoFAVerify,
    twoFAIsPending,
    trustedDeviceRegister,
    trustedDeviceCheck,
    trustedDeviceRevoke,
    inviteGuardCheck,
    inviteGuardSetConfig,
    inviteGuardWhitelist,
    vaultStore,
    vaultRetrieve,
    vaultList,
    escalationStep,
    escalationReset,
    escalationGetLevel,
    escalationGetHistory,
    ESCALATION_LEVELS,
    anomalyCorrelationRecord,
    anomalyCorrelationAnalyze,
    anomalyAutoLockdown,
    deepLinkAnalysis,
    cmdACLSet,
    cmdACLCheck,
    cmdACLGet,
    cmdACLList,
    sandboxScan,
    floodForensicRecord,
    floodForensicAnalyze,
    killswitchActivate,
    killswitchDeactivate,
    killswitchIsActive,
    killswitchGetStatus,
    antiForwardChain,
    mediaScan,
    roleHierarchyCheck,
    securityDashboard,
    formatSecurityDashboard,
    securityMiddleware,
    compressedBackup,
    decompressedBackup,
    fullSecurityBackup,
    fullSecurityRestore,
    integrityGenerate,
    integrityVerify,
    repDecayProcess,
};

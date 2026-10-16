'use strict';

const path   = require('path');
const fs     = require('fs');
const axios  = require('axios');
const moment = require('moment-timezone');

const LIB_DIR    = __dirname;
const ASSETS_DIR = path.join(process.cwd(), 'assets');

const FONTS = {
    display: { alias: 'MenuDisplay', file: path.join(LIB_DIR, 'font_display.ttf'), url: 'https://github.com/google/fonts/raw/main/ofl/outfit/Outfit%5Bwght%5D.ttf' },
    mono:    { alias: 'MenuMono',    file: path.join(LIB_DIR, 'font_mono.ttf'),    url: 'https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf' },
    body:    { alias: 'MenuBody',    file: path.join(LIB_DIR, 'font_body.ttf'),    url: 'https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bslnt%2Cwght%5D.ttf' },
};

const _fontState = { display: false, mono: false, body: false };

async function _ensureFonts() {
    const { FontLibrary } = require('skia-canvas');
    await Promise.all(Object.entries(FONTS).map(async ([key, cfg]) => {
        if (_fontState[key]) return;
        if (!fs.existsSync(cfg.file)) {
            try {
                const res = await axios.get(cfg.url, { responseType: 'arraybuffer', timeout: 20000 });
                fs.writeFileSync(cfg.file, Buffer.from(res.data));
            } catch { return; }
        }
        try { FontLibrary.use(cfg.alias, cfg.file); _fontState[key] = true; } catch {}
    }));
}

const _ff = (key) => _fontState[key] ? `"${FONTS[key].alias}"` : 'sans-serif';
const _menuBg = global.menuBg;
const SIZE       = 1080;
const TIMEZONE   = 'Asia/Jakarta';
const DEFAULT_BG = global.menuBg || 'https://files.catbox.moe/nb8of6.jpeg';

const DEFAULT_AV = path.join(ASSETS_DIR, 'profile.jpg');

const RANK_CFG = {
    creator: {
        label: 'CREATOR',
        emoji: '👑',
        pill:  { bg: 'rgba(253,121,168,0.25)', border: 'rgba(253,121,168,0.65)', text: '#fd79a8' },
        glow1: 'rgba(253,121,168,0.75)',
        glow2: 'rgba(253,100,150,0.25)',
        ring:  ['#ff9ff3','#fd79a8','#e84393','#ff9ff3'],
        chip:  ['rgba(253,121,168,0.22)','rgba(232,67,147,0.10)'],
    },
    owner: {
        label: 'OWNER',
        emoji: '🔱',
        pill:  { bg: 'rgba(255,165,0,0.22)', border: 'rgba(255,165,0,0.60)', text: '#ffa500' },
        glow1: 'rgba(255,165,0,0.72)',
        glow2: 'rgba(255,140,0,0.22)',
        ring:  ['#ffeaa7','#fdcb6e','#e17055','#ffeaa7'],
        chip:  ['rgba(255,165,0,0.22)','rgba(230,120,0,0.10)'],
    },
    premium: {
        label: 'PREMIUM',
        emoji: '⭐',
        pill:  { bg: 'rgba(255,215,0,0.22)', border: 'rgba(255,215,0,0.60)', text: '#ffd700' },
        glow1: 'rgba(255,215,0,0.70)',
        glow2: 'rgba(255,200,0,0.22)',
        ring:  ['#ffeaa7','#ffd700','#f9ca24','#ffeaa7'],
        chip:  ['rgba(255,215,0,0.22)','rgba(200,160,0,0.10)'],
    },
    user: {
        label: 'USER',
        emoji: '👤',
        pill:  { bg: 'rgba(139,92,246,0.22)', border: 'rgba(139,92,246,0.55)', text: '#a78bfa' },
        glow1: 'rgba(167,139,250,0.68)',
        glow2: 'rgba(99,102,241,0.22)',
        ring:  ['#c4b5fd','#a78bfa','#7c3aed','#c4b5fd'],
        chip:  ['rgba(139,92,246,0.20)','rgba(88,28,220,0.10)'],
    },
};

function _resolveRank(isCreator, isOwner, isPremium) {
    if (isCreator) return RANK_CFG.creator;
    if (isOwner)   return RANK_CFG.owner;
    if (isPremium) return RANK_CFG.premium;
    return RANK_CFG.user;
}

const EMOJI_RE = /(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*|[\u{1F1E0}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/gu;

function _emojiCP(emoji) {
    const pts = [];
    let i = 0;
    while (i < emoji.length) {
        const cp = emoji.codePointAt(i);
        if (cp !== undefined && cp !== 0xFE0F && cp !== 0x200D) pts.push(cp.toString(16).toLowerCase());
        i += (cp !== undefined && cp > 0xFFFF) ? 2 : 1;
    }
    return pts.join('-');
}

function _emojiCPFull(emoji) {
    const pts = [];
    let i = 0;
    while (i < emoji.length) {
        const cp = emoji.codePointAt(i);
        if (cp !== undefined && cp !== 0xFE0F) pts.push(cp.toString(16).toLowerCase());
        i += (cp !== undefined && cp > 0xFFFF) ? 2 : 1;
    }
    return pts.join('-');
}

const _imgCache = new Map();

async function _fetchEmoji(emoji) {
    const key = _emojiCP(emoji);
    if (_imgCache.has(key)) return _imgCache.get(key);
    const { loadImage } = require('skia-canvas');
    const k0    = key;
    const kFull = _emojiCPFull(emoji);
    const kStrip = _emojiCP(emoji.replace(/\uFE0F/g, ''));
    const enc   = encodeURIComponent(emoji);
    const urls  = [
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${k0}.png`,
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${kFull}.png`,
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${kStrip}.png`,
        `https://emojicdn.elk.sh/${enc}?style=apple`,
        `https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128/emoji_u${k0.replace(/-/g,'_')}.png`,
        `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${k0}.png`,
    ];
    for (const url of urls) {
        try {
            const img = await loadImage(url);
            if (img?.width > 0) { _imgCache.set(key, img); return img; }
        } catch {}
    }
    _imgCache.set(key, null);
    return null;
}

function _drawEmoji(ctx, emoji, x, y, size) {
    const img = _imgCache.get(_emojiCP(emoji));
    if (img?.width > 0) ctx.drawImage(img, x, y, size, size);
}

async function _getWeather(city = 'Jakarta') {
    try {
        const res = await axios.get(`https://wttr.in/${encodeURIComponent(city.trim())}?format=j1`, { timeout: 6000 });
        const cur = res.data?.current_condition?.[0];
        return {
            temp:      cur?.temp_C ?? '–',
            desc:      cur?.weatherDesc?.[0]?.value ?? '',
            icon:      _weatherIcon(cur?.weatherDesc?.[0]?.value ?? ''),
            humidity:  cur?.humidity ?? '–',
            feelsLike: cur?.FeelsLikeC ?? '–',
        };
    } catch { return { temp: '–', desc: 'Unknown', icon: '🌤', humidity: '–', feelsLike: '–' }; }
}

function _weatherIcon(d = '') {
    d = d.toLowerCase();
    if (d.includes('thunder'))                        return '⛈';
    if (d.includes('drizzle') || d.includes('rain')) return '🌧';
    if (d.includes('snow'))                           return '❄️';
    if (d.includes('fog')  || d.includes('mist'))    return '🌫';
    if (d.includes('cloud'))                          return '☁️';
    if (d.includes('sunny') || d.includes('clear'))  return '☀️';
    return '🌤';
}

async function _fetchBuffer(url) {
    if (typeof url === 'string' && (url.startsWith('./') || url.startsWith('/') || /^[a-zA-Z]:\\/.test(url) || fs.existsSync(url))) {
        if (fs.existsSync(url)) return fs.readFileSync(url);
    }
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 BulterBot/1.0' } });
    return Buffer.from(res.data);
}

function _sampleBgColor(ctx, width, height) {
    try {
        const regions = [
            [Math.floor(width * 0.1), Math.floor(height * 0.1)],
            [Math.floor(width * 0.5), Math.floor(height * 0.1)],
            [Math.floor(width * 0.9), Math.floor(height * 0.1)],
            [Math.floor(width * 0.1), Math.floor(height * 0.5)],
            [Math.floor(width * 0.9), Math.floor(height * 0.5)],
            [Math.floor(width * 0.5), Math.floor(height * 0.5)],
        ];
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (const [sx, sy] of regions) {
            try {
                const px = ctx.getImageData(sx, sy, 1, 1).data;
                rSum += px[0]; gSum += px[1]; bSum += px[2]; count++;
            } catch {}
        }
        if (count === 0) return { r: 30, g: 20, b: 60 };
        return { r: Math.round(rSum/count), g: Math.round(gSum/count), b: Math.round(bSum/count) };
    } catch { return { r: 30, g: 20, b: 60 }; }
}

function _rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function _glassBlur(ctx, x, y, w, h, r, tintR, tintG, tintB, alpha) {
    ctx.save();
    _rr(ctx, x, y, w, h, r);
    ctx.fillStyle = `rgba(${tintR},${tintG},${tintB},${alpha * 0.55})`;
    ctx.fill();

    _rr(ctx, x, y, w, h, r);
    const noiseCount = 180;
    for (let i = 0; i < noiseCount; i++) {
        const nx = x + Math.random() * w;
        const ny = y + Math.random() * h;
        const na = Math.random() * 0.018;
        ctx.fillStyle = `rgba(255,255,255,${na})`;
        ctx.fillRect(nx, ny, 2, 1);
    }

    _rr(ctx, x, y, w, h, r);
    const innerG = ctx.createLinearGradient(x, y, x, y + h * 0.5);
    innerG.addColorStop(0, `rgba(255,255,255,0.22)`);
    innerG.addColorStop(0.4, `rgba(255,255,255,0.06)`);
    innerG.addColorStop(1, `rgba(255,255,255,0.01)`);
    ctx.fillStyle = innerG;
    ctx.fill();

    _rr(ctx, x, y, w, h, r);
    ctx.strokeStyle = `rgba(255,255,255,0.55)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    _rr(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
    ctx.strokeStyle = `rgba(${tintR},${tintG},${tintB},0.30)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    const sheen = ctx.createLinearGradient(x, y, x + w * 0.6, y + h * 0.4);
    sheen.addColorStop(0, 'rgba(255,255,255,0.12)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    _rr(ctx, x, y, w, h, r);
    ctx.fillStyle = sheen;
    ctx.fill();

    ctx.restore();
}

function _glass(ctx, x, y, w, h, r = 28, tint = null, alpha = 0.15) {
    ctx.save();
    _rr(ctx, x, y, w, h, r);
    ctx.fillStyle = tint ?? `rgba(255,255,255,${alpha})`;
    ctx.fill();
    _rr(ctx, x, y, w, h, r);
    const bd = ctx.createLinearGradient(x, y, x + w, y + h);
    bd.addColorStop(0,   'rgba(255,255,255,0.62)');
    bd.addColorStop(0.4, 'rgba(255,255,255,0.12)');
    bd.addColorStop(1,   'rgba(255,255,255,0.32)');
    ctx.strokeStyle = bd;
    ctx.lineWidth   = 1.8;
    ctx.stroke();
    ctx.restore();
}

function _shimmer(ctx, x, y, w) {
    ctx.save();
    const s = ctx.createLinearGradient(x, y, x + w, y);
    s.addColorStop(0,    'rgba(255,255,255,0)');
    s.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    s.addColorStop(0.65, 'rgba(255,255,255,0.55)');
    s.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.strokeStyle = s;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
    ctx.restore();
}

function _sh(ctx, blur, color, oy = 3) {
    ctx.shadowBlur = blur; ctx.shadowColor = color;
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = oy;
}
function _nosh(ctx) {
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
}

function _dotCluster(ctx, x, y, count = 5, gap = 18, color = 'rgba(255,255,255,0.15)') {
    ctx.save(); ctx.fillStyle = color;
    for (let r = 0; r < count; r++)
        for (let c = 0; c < count; c++) {
            ctx.beginPath(); ctx.arc(x + c * gap, y + r * gap, 2.2, 0, Math.PI * 2); ctx.fill();
        }
    ctx.restore();
}

function _hexGrid(ctx, x, y, cols, rows, size, color = 'rgba(255,255,255,0.06)') {
    ctx.save(); ctx.fillStyle = color;
    const w = size * 2, h = Math.sqrt(3) * size;
    for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
            const cx = x + col * w * 0.75 + (row % 2 === 0 ? 0 : w * 0.375);
            const cy = y + row * h * 0.5;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i - Math.PI / 6;
                const px = cx + size * 0.8 * Math.cos(a);
                const py = cy + size * 0.8 * Math.sin(a);
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.fill();
        }
    ctx.restore();
}

function _glowRing(ctx, cx, cy, r, rank) {
    const glow = ctx.createRadialGradient(cx, cy, r - 4, cx, cy, r + 22);
    glow.addColorStop(0,   rank.glow1);
    glow.addColorStop(0.5, rank.glow2);
    glow.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(cx, cy, r + 22, 0, Math.PI * 2);
    ctx.fillStyle = glow; ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    const stops = rank.ring;
    ring.addColorStop(0,    stops[0]);
    ring.addColorStop(0.33, stops[1]);
    ring.addColorStop(0.66, stops[2]);
    ring.addColorStop(1,    stops[3]);
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke();
    ctx.restore();
}

async function _drawAvatar(ctx, src, cx, cy, radius) {
    const { loadImage } = require('skia-canvas');
    let img = null;
    if (Buffer.isBuffer(src)) {
        try { img = await loadImage(src); } catch {}
    } else if (typeof src === 'string' && /^https?:\/\//.test(src)) {
        try { img = await loadImage(await _fetchBuffer(src)); } catch {}
    }
    if (!img && fs.existsSync(DEFAULT_AV)) {
        try { img = await loadImage(DEFAULT_AV); } catch {}
    }
    if (img) {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();
        const sc = Math.max((radius * 2) / img.width, (radius * 2) / img.height);
        ctx.drawImage(img, cx - img.width * sc / 2, cy - img.height * sc / 2, img.width * sc, img.height * sc);
        ctx.restore();
    } else {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        const grd = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, 0, cx, cy, radius);
        grd.addColorStop(0, '#c4b5fd'); grd.addColorStop(0.5, '#8b5cf6'); grd.addColorStop(1, '#4c1d95');
        ctx.fillStyle = grd; ctx.fill();
        ctx.font = `bold ${Math.round(radius * 0.85)}px ${_ff('display')}`;
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', cx, cy);
        ctx.restore();
    }
}

function _rankPill(ctx, cx, y, rank) {
    const FD = _ff('display');
    ctx.save();
    ctx.font = `bold 12px ${FD}`;

    const emojiSize = 18;
    const gap       = 5;
    const textW     = ctx.measureText(rank.label).width;
    const pillW     = emojiSize + gap + textW + 22;
    const pillH     = 22;
    const pillX     = cx - pillW / 2;
    const pillY     = y;

    _rr(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = rank.pill.bg; ctx.fill();
    _rr(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.strokeStyle = rank.pill.border; ctx.lineWidth = 1.4; ctx.stroke();

    _drawEmoji(ctx, rank.emoji, pillX + 8, pillY + (pillH - emojiSize) / 2, emojiSize);

    ctx.fillStyle    = rank.pill.text;
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'left';
    ctx.fillText(rank.label, pillX + 8 + emojiSize + gap, pillY + pillH / 2);
    ctx.restore();
}

function _chipGrad(ctx, x, y, w, h, c0, c1) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    return g;
}

async function createMenuCard({
    username   = 'User',
    avatar     = null,
    city       = 'Jakarta',
    bgUrl      = DEFAULT_BG,
    isCreator  = false,
    isOwner    = false,
    isPremium  = false,
    sender     = '',
} = {}) {
    const { Canvas, loadImage } = require('skia-canvas');

    const rank = _resolveRank(isCreator, isOwner, isPremium);

    const [weatherData] = await Promise.all([_getWeather(city), _ensureFonts()]);

    const emojiSet = [...new Set([
        weatherData.icon, '🕐', '💧', '🌡️',
        rank.emoji,
    ].filter(Boolean))];
    await Promise.all(emojiSet.map(e => _fetchEmoji(e)));

    const [bgBuf, avatarBuf] = await Promise.all([
        _fetchBuffer(bgUrl).catch(() => null),
        (avatar && typeof avatar === 'string' && /^https?:\/\//.test(avatar))
            ? _fetchBuffer(avatar).catch(() => null)
            : Promise.resolve(Buffer.isBuffer(avatar) ? avatar : null),
    ]);

    const canvas = new Canvas(SIZE, SIZE);
    const ctx    = canvas.getContext('2d');
    const FD = _ff('display'), FM = _ff('mono'), FB = _ff('body');

    if (bgBuf) {
        const bgImg = await loadImage(bgBuf);
        const scale = Math.max(SIZE / bgImg.width, SIZE / bgImg.height);
        const sw = bgImg.width * scale, sh = bgImg.height * scale;
        ctx.drawImage(bgImg, (SIZE - sw) / 2, (SIZE - sh) / 2, sw, sh);
    } else {
        const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
        g.addColorStop(0, '#0f0c29'); g.addColorStop(0.5, '#302b63'); g.addColorStop(1, '#24243e');
        ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
    }

    const sampledColor = _sampleBgColor(ctx, SIZE, SIZE);
    const tR = sampledColor.r;
    const tG = sampledColor.g;
    const tB = sampledColor.b;

    const lum = 0.299 * tR + 0.587 * tG + 0.114 * tB;
    const isDark = lum < 128;

    const panelTintAlpha = isDark ? 0.22 : 0.18;
    const panelTintR = Math.max(0, Math.min(255, tR * 0.4 + (isDark ? 20 : 200)));
    const panelTintG = Math.max(0, Math.min(255, tG * 0.4 + (isDark ? 20 : 200)));
    const panelTintB = Math.max(0, Math.min(255, tB * 0.4 + (isDark ? 30 : 220)));

    const accentR = Math.min(255, tR * 0.6 + 60);
    const accentG = Math.min(255, tG * 0.6 + 60);
    const accentB = Math.min(255, tB * 0.6 + 100);

    const vig = ctx.createRadialGradient(SIZE/2, SIZE/2, SIZE*0.15, SIZE/2, SIZE/2, SIZE*0.78);
    vig.addColorStop(0, 'rgba(0,0,0,0.05)'); vig.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, SIZE, SIZE);

    const scrim = ctx.createLinearGradient(0, SIZE * 0.28, 0, SIZE);
    scrim.addColorStop(0, 'rgba(0,0,0,0)'); scrim.addColorStop(1, 'rgba(0,0,0,0.82)');
    ctx.fillStyle = scrim; ctx.fillRect(0, 0, SIZE, SIZE);

    _dotCluster(ctx, 32, 32, 6, 18, 'rgba(255,255,255,0.09)');
    _dotCluster(ctx, SIZE - 32 - 5*18, SIZE - 32 - 5*18, 6, 18, 'rgba(255,255,255,0.06)');
    _hexGrid(ctx, SIZE - 165, 18, 5, 7, 18, `rgba(${Math.round(accentR)},${Math.round(accentG)},${Math.round(accentB)},0.07)`);
    _hexGrid(ctx, 0, SIZE - 210, 5, 7, 18, `rgba(${Math.round(tR)},${Math.round(tG)},${Math.round(tB)},0.06)`);

    ctx.save();
    const ac1 = ctx.createRadialGradient(160, 160, 0, 160, 160, 300);
    ac1.addColorStop(0, `rgba(${Math.round(tR*0.5+60)},${Math.round(tG*0.3+40)},${Math.round(tB*0.7+80)},0.18)`);
    ac1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ac1; ctx.fillRect(0, 0, SIZE, SIZE);
    const ac2 = ctx.createRadialGradient(SIZE-140, SIZE-140, 0, SIZE-140, SIZE-140, 280);
    ac2.addColorStop(0, `rgba(${Math.round(tR*0.4+30)},${Math.round(tG*0.6+80)},${Math.round(tB*0.8+60)},0.15)`);
    ac2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ac2; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();

    const PW = 860, PH = 500;
    const PX = (SIZE - PW) / 2;
    const PY = SIZE - PH - 36;

    ctx.save();
    ctx.shadowBlur = 80; ctx.shadowColor = `rgba(${tR},${tG},${tB},0.40)`; ctx.shadowOffsetY = 24;
    _rr(ctx, PX, PY, PW, PH, 32);
    ctx.fillStyle = `rgba(${Math.round(panelTintR*0.2)},${Math.round(panelTintG*0.2)},${Math.round(panelTintB*0.3)},0.30)`;
    ctx.fill();
    ctx.restore();

    _glassBlur(ctx, PX, PY, PW, PH, 32, panelTintR, panelTintG, panelTintB, panelTintAlpha);

    ctx.save();
    _rr(ctx, PX, PY, PW, PH, 32);
    const pAcc = ctx.createLinearGradient(PX, PY, PX + PW, PY + PH);
    pAcc.addColorStop(0, `rgba(${Math.round(accentR)},${Math.round(accentG)},${Math.round(accentB)},0.06)`);
    pAcc.addColorStop(1, `rgba(${tR},${tG},${tB},0.04)`);
    ctx.fillStyle = pAcc; ctx.fill();
    ctx.restore();

    const AVR = 46;
    const AVX = PX + PW - AVR - 24;
    const AVY = PY + AVR + 20;

    _glowRing(ctx, AVX, AVY, AVR, rank);

    ctx.save();
    ctx.beginPath(); ctx.arc(AVX, AVY, AVR + 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    await _drawAvatar(ctx, avatarBuf, AVX, AVY, AVR);

    const nameRightBound = AVX - AVR - 20;
    const nameLeftBound  = PX + 28;
    const nameMaxW       = nameRightBound - nameLeftBound;
    const displayName    = username.length > 22 ? username.slice(0, 20) + '\u2026' : username;

    const UNAME_Y = PY + 58;

    _sh(ctx, 20, rank.glow1, 3);
    ctx.font = `bold 40px ${FD}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.save();
    ctx.beginPath();
    ctx.rect(nameLeftBound, PY, nameMaxW, AVR * 2 + 40);
    ctx.clip();
    ctx.fillText(displayName, nameLeftBound, UNAME_Y);
    ctx.restore();
    _nosh(ctx);

    ctx.save();
    ctx.font = `bold 40px ${FD}`;
    const measuredNameW = ctx.measureText(displayName).width;
    const unW = Math.min(measuredNameW + 30, nameMaxW);
    const unX = nameLeftBound;
    const unY = UNAME_Y + 9;
    const ulG = ctx.createLinearGradient(unX, unY, unX + unW, unY);
    ulG.addColorStop(0,   rank.glow1.replace(/[\d.]+\)$/, '0.80)'));
    ulG.addColorStop(0.7, rank.glow1.replace(/[\d.]+\)$/, '0.50)'));
    ulG.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.strokeStyle = ulG; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(unX, unY); ctx.lineTo(unX + unW, unY); ctx.stroke();
    ctx.restore();

    _rankPill(ctx, nameLeftBound + Math.min(measuredNameW, nameMaxW) / 2, UNAME_Y + 14, rank);

    const PILL_H = 22;
    const DIV_Y  = UNAME_Y + 14 + PILL_H + 28;

    const divG = ctx.createLinearGradient(PX + 28, DIV_Y, PX + PW - 28, DIV_Y);
    divG.addColorStop(0,    'rgba(255,255,255,0)');
    divG.addColorStop(0.15, `rgba(${Math.round(accentR)},${Math.round(accentG)},${Math.round(accentB)},0.35)`);
    divG.addColorStop(0.85, `rgba(${Math.round(accentR)},${Math.round(accentG)},${Math.round(accentB)},0.35)`);
    divG.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.strokeStyle = divG; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PX + 28, DIV_Y); ctx.lineTo(PX + PW - 28, DIV_Y); ctx.stroke();

    const CW  = (PW - 56 - 18) / 2;
    const CH  = 110;
    const CY  = DIV_Y + 24;
    const CXL = PX + 28;
    const CXR = CXL + CW + 18;

    const CHIP_PAD = 16;
    const EMOJI_SZ = 26;
    const LBL_H    = 20;
    const VAL_FONT = 40;
    const SUB_FONT = 12;
    const VAL_Y    = CY + LBL_H + 12 + VAL_FONT * 0.78;
    const SUB_Y    = CY + CH - CHIP_PAD;

    _glassBlur(ctx, CXL, CY, CW, CH, 18, tR, tG, tB + 40, 0.20);
    ctx.save();
    _rr(ctx, CXL, CY, CW, CH, 18);
    const chipAccL = ctx.createLinearGradient(CXL, CY, CXL + CW, CY + CH);
    chipAccL.addColorStop(0, `rgba(${Math.round(accentR*0.6+60)},${Math.round(accentG*0.3+30)},${Math.round(accentB)},0.12)`);
    chipAccL.addColorStop(1, `rgba(${Math.round(accentR*0.3)},${Math.round(accentG*0.3)},${Math.round(accentB*0.6)},0.06)`);
    ctx.fillStyle = chipAccL; ctx.fill();
    ctx.restore();

    _drawEmoji(ctx, '🕐', CXL + CHIP_PAD, CY + (LBL_H - EMOJI_SZ) / 2 + 2, EMOJI_SZ);
    ctx.font = `bold 10px ${FB}`; ctx.fillStyle = `rgba(${Math.round(accentR)},${Math.round(accentB)},255,0.55)`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('WAKTU', CXL + CHIP_PAD + EMOJI_SZ + 5, CY + LBL_H / 2 + 2);

    const nowWIB  = moment().tz(TIMEZONE);
    const timeStr = nowWIB.format('HH:mm');
    const dateStr = nowWIB.format('ddd, DD MMM YYYY');

    _sh(ctx, 16, `rgba(${Math.round(accentR)},${Math.round(accentG)},${Math.round(accentB)},0.65)`, 3);
    ctx.font = `bold ${VAL_FONT}px ${FM}`; ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(timeStr, CXL + CHIP_PAD, VAL_Y);
    _nosh(ctx);

    ctx.font = `${SUB_FONT}px ${FB}`;
    ctx.fillStyle = `rgba(${Math.round(200+tR*0.2)},${Math.round(200+tG*0.1)},255,0.60)`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(dateStr.length > 26 ? dateStr.slice(0, 25) + '\u2026' : dateStr, CXL + CHIP_PAD, SUB_Y);

    _glassBlur(ctx, CXR, CY, CW, CH, 18, tR + 20, tG + 30, tB + 60, 0.20);
    ctx.save();
    _rr(ctx, CXR, CY, CW, CH, 18);
    const chipAccR = ctx.createLinearGradient(CXR, CY, CXR + CW, CY + CH);
    chipAccR.addColorStop(0, `rgba(${tR + 20},${Math.round(accentG*0.6+80)},${Math.round(accentB*0.8+60)},0.12)`);
    chipAccR.addColorStop(1, `rgba(${tR},${tG + 30},${tB + 40},0.06)`);
    ctx.fillStyle = chipAccR; ctx.fill();
    ctx.restore();

    _drawEmoji(ctx, weatherData.icon, CXR + CHIP_PAD, CY + (LBL_H - EMOJI_SZ) / 2 + 2, EMOJI_SZ);
    ctx.font = `bold 10px ${FB}`; ctx.fillStyle = `rgba(${Math.round(tR*0.4+120)},${Math.round(tG*0.5+160)},255,0.55)`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('CUACA', CXR + CHIP_PAD + EMOJI_SZ + 5, CY + LBL_H / 2 + 2);

    _sh(ctx, 16, `rgba(${tR+20},${tG+80},${tB+120},0.60)`, 3);
    ctx.font = `bold ${VAL_FONT}px ${FM}`; ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${weatherData.temp}\u00B0C`, CXR + CHIP_PAD, VAL_Y);
    _nosh(ctx);

    const cityLabel = city.length > 14 ? city.slice(0, 13) + '\u2026' : city;
    const descShort = weatherData.desc.length > 12 ? weatherData.desc.slice(0, 11) + '\u2026' : weatherData.desc;
    ctx.font = `${SUB_FONT}px ${FB}`;
    ctx.fillStyle = `rgba(${Math.round(tR*0.3+140)},${Math.round(tG*0.4+160)},255,0.60)`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${cityLabel}  ${descShort}`, CXR + CHIP_PAD, SUB_Y);

    const EXTRA_Y = CY + CH + 16;
    const EW      = (PW - 56 - 2 * 12) / 3;
    const EH      = 66;

    const phone = sender ? '+' + sender.replace(/[^0-9]/g, '').replace(/^0/, '62') : '';

    const extraChips = [
        {
            label: 'FEELS LIKE',
            value: `${weatherData.feelsLike}\u00B0`,
            emoji: '🌡️',
            tintR: Math.min(255, tR + 80),
            tintG: Math.max(0, tG * 0.5 + 30),
            tintB: Math.max(0, tB * 0.3 + 20),
            textColor: '#fbbf24',
        },
        {
            label: 'HUMIDITY',
            value: `${weatherData.humidity}%`,
            emoji: '💧',
            tintR: Math.max(0, tR * 0.3 + 20),
            tintG: Math.min(255, tG * 0.5 + 80),
            tintB: Math.min(255, tB * 0.8 + 60),
            textColor: '#7dd3fc',
        },
        {
            label: 'ROLE',
            value: rank.label,
            emoji: rank.emoji,
            tintR: panelTintR,
            tintG: panelTintG,
            tintB: panelTintB,
            textColor: rank.pill.text,
        },
    ];

    for (let i = 0; i < extraChips.length; i++) {
        const chip  = extraChips[i];
        const chipX = PX + 28 + i * (EW + 12);
        const midY  = EXTRA_Y + EH / 2;

        _glassBlur(ctx, chipX, EXTRA_Y, EW, EH, 14,
            Math.round(chip.tintR), Math.round(chip.tintG), Math.round(chip.tintB), 0.20);

        const ESZ = 24;
        const EX  = chipX + 12;
        const EY  = midY - 13;
        _drawEmoji(ctx, chip.emoji, EX, EY, ESZ);

        _sh(ctx, 10, chip.textColor + '88', 2);
        ctx.font = `bold 20px ${FM}`; ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(chip.value, EX + ESZ + 7, midY - 3);
        _nosh(ctx);

        ctx.font = `9px ${FB}`; ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(chip.label, EX, EXTRA_Y + EH - 7);
    }

    if (phone) {
        ctx.font = `11px ${FM}`; ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(phone, SIZE / 2, PY + PH - 32);
    }

    _sh(ctx, 10, 'rgba(0,0,0,0.55)', 2);
    ctx.font = `14px ${FD}`;
    ctx.fillStyle = `rgba(${Math.round(200+tR*0.2)},${Math.round(190+tG*0.1)},255,0.45)`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('\u2756  BulterBot  \u2756', SIZE / 2, PY + PH - 16);
    _nosh(ctx);

    const _corner = (cx, cy) => {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = rank.pill.border; ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2);
        ctx.strokeStyle = rank.pill.border.replace(/[\d.]+\)$/, '0.25)'); ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
    };
    _corner(PX + 32,      PY + 32);
    _corner(PX + PW - 32, PY + 32);
    _corner(PX + 32,      PY + PH - 32);
    _corner(PX + PW - 32, PY + PH - 32);

    return canvas.toBuffer('image/jpeg', { quality: 0.96 });
}

module.exports = { createMenuCard };
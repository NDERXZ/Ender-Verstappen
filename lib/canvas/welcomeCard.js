'use strict';

const path  = require('path');
const fs    = require('fs');
const axios = require('axios');

const LIB_DIR    = __dirname;
const ASSETS_DIR = path.join(process.cwd(), 'assets');

const FONTS = {
    display: { alias: 'WcDisplay', file: path.join(LIB_DIR, 'font_display.ttf'), url: 'https://github.com/google/fonts/raw/main/ofl/outfit/Outfit%5Bwght%5D.ttf' },
    mono:    { alias: 'WcMono',    file: path.join(LIB_DIR, 'font_mono.ttf'),    url: 'https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf' },
    body:    { alias: 'WcBody',    file: path.join(LIB_DIR, 'font_body.ttf'),    url: 'https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bslnt%2Cwght%5D.ttf' },
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

const W = 1280;
const H = 720;
const DEFAULT_AV = path.join(ASSETS_DIR, 'profile.jpg');

async function _fetchBuffer(url) {
    if (typeof url === 'string' && (url.startsWith('./') || url.startsWith('/') || /^[a-zA-Z]:\\/.test(url) || fs.existsSync(url))) {
        if (fs.existsSync(url)) return fs.readFileSync(url);
    }
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 WcBot/1.0' } });
    return Buffer.from(res.data);
}

function _sampleBgColor(ctx, width, height) {
    try {
        const pts = [
            [Math.floor(width*0.1), Math.floor(height*0.1)],
            [Math.floor(width*0.5), Math.floor(height*0.1)],
            [Math.floor(width*0.9), Math.floor(height*0.1)],
            [Math.floor(width*0.1), Math.floor(height*0.5)],
            [Math.floor(width*0.9), Math.floor(height*0.5)],
            [Math.floor(width*0.5), Math.floor(height*0.5)],
        ];
        let rS = 0, gS = 0, bS = 0, n = 0;
        for (const [x, y] of pts) {
            try { const d = ctx.getImageData(x, y, 1, 1).data; rS += d[0]; gS += d[1]; bS += d[2]; n++; } catch {}
        }
        if (!n) return { r: 20, g: 20, b: 40 };
        return { r: Math.round(rS/n), g: Math.round(gS/n), b: Math.round(bS/n) };
    } catch { return { r: 20, g: 20, b: 40 }; }
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

function _hardBlurPanel(ctx, x, y, w, h, r, tR, tG, tB, alpha) {
    ctx.save();

    for (let pass = 0; pass < 6; pass++) {
        const spread = (6 - pass) * 14;
        _rr(ctx, x - spread * 0.5, y - spread * 0.5, w + spread, h + spread, r + spread * 0.5);
        ctx.fillStyle = `rgba(${tR},${tG},${tB},${0.018 + pass * 0.008})`;
        ctx.fill();
    }

    _rr(ctx, x, y, w, h, r);
    ctx.fillStyle = `rgba(${tR},${tG},${tB},${alpha * 0.60})`;
    ctx.fill();

    for (let layer = 0; layer < 5; layer++) {
        const lx = x + Math.random() * w * 0.3;
        const ly = y + Math.random() * h * 0.3;
        const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, w * 0.6);
        lg.addColorStop(0, `rgba(255,255,255,0.04)`);
        lg.addColorStop(1, `rgba(255,255,255,0)`);
        _rr(ctx, x, y, w, h, r);
        ctx.fillStyle = lg;
        ctx.fill();
    }

    _rr(ctx, x, y, w, h, r);
    for (let i = 0; i < 320; i++) {
        const nx = x + Math.random() * w;
        const ny = y + Math.random() * h;
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.022})`;
        ctx.fillRect(nx, ny, Math.random() * 3 + 1, 1);
    }

    _rr(ctx, x, y, w, h, r);
    const topG = ctx.createLinearGradient(x, y, x, y + h * 0.45);
    topG.addColorStop(0,   'rgba(255,255,255,0.28)');
    topG.addColorStop(0.3, 'rgba(255,255,255,0.08)');
    topG.addColorStop(1,   'rgba(255,255,255,0.00)');
    ctx.fillStyle = topG;
    ctx.fill();

    _rr(ctx, x, y, w, h, r);
    const botG = ctx.createLinearGradient(x, y + h * 0.6, x, y + h);
    botG.addColorStop(0, 'rgba(0,0,0,0.00)');
    botG.addColorStop(1, `rgba(${tR*0.3},${tG*0.3},${tB*0.3},0.22)`);
    ctx.fillStyle = botG;
    ctx.fill();

    _rr(ctx, x, y, w, h, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.60)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    _rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
    ctx.strokeStyle = `rgba(${tR},${tG},${tB},0.35)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    const sheen = ctx.createLinearGradient(x, y, x + w * 0.55, y + h * 0.38);
    sheen.addColorStop(0,   'rgba(255,255,255,0.16)');
    sheen.addColorStop(0.4, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(1,   'rgba(255,255,255,0.00)');
    _rr(ctx, x, y, w, h, r);
    ctx.fillStyle = sheen;
    ctx.fill();

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

function _dotCluster(ctx, x, y, count, gap, color) {
    ctx.save(); ctx.fillStyle = color;
    for (let row = 0; row < count; row++)
        for (let col = 0; col < count; col++) {
            ctx.beginPath(); ctx.arc(x + col * gap, y + row * gap, 2, 0, Math.PI * 2); ctx.fill();
        }
    ctx.restore();
}

function _hexGrid(ctx, x, y, cols, rows, size, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1;
    const hw = size * 2, hh = Math.sqrt(3) * size;
    for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
            const cx = x + col * hw * 0.75 + (row % 2 === 0 ? 0 : hw * 0.375);
            const cy = y + row * hh * 0.5;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i - Math.PI / 6;
                const px = cx + size * 0.82 * Math.cos(a);
                const py = cy + size * 0.82 * Math.sin(a);
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.stroke();
        }
    ctx.restore();
}

function _drawWaveLines(ctx, y, w, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, y + i * 12);
        for (let x = 0; x <= w; x += 8) {
            ctx.lineTo(x, y + i * 12 + Math.sin(x * 0.04 + i) * 6);
        }
        ctx.stroke();
    }
    ctx.restore();
}

function _drawStar(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
        const outerA = (Math.PI / 2.5) * i - Math.PI / 2;
        const innerA = outerA + Math.PI / 5;
        const ox = cx + r * Math.cos(outerA);
        const oy = cy + r * Math.sin(outerA);
        const ix = cx + (r * 0.42) * Math.cos(innerA);
        const iy = cy + (r * 0.42) * Math.sin(innerA);
        i === 0 ? ctx.moveTo(ox, oy) : ctx.lineTo(ox, oy);
        ctx.lineTo(ix, iy);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
}

function _drawDiamond(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size * 0.6, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size * 0.6, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function _drawPlusIcon(ctx, cx, cy, size, color, lw = 2) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - size, cy); ctx.lineTo(cx + size, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - size); ctx.lineTo(cx, cy + size); ctx.stroke();
    ctx.restore();
}

function _drawCheckIcon(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.38);
    ctx.lineTo(cx + r * 0.45, cy - r * 0.30);
    ctx.stroke();
    ctx.restore();
}

function _drawWaveIcon(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
        const r = size * (0.35 + i * 0.32);
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI * 0.7, Math.PI * 0.7);
        ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
}

function _drawLeafIcon(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.bezierCurveTo(cx + size * 0.9, cy - size * 0.5, cx + size * 0.9, cy + size * 0.5, cx, cy + size * 0.6);
    ctx.bezierCurveTo(cx - size * 0.9, cy + size * 0.5, cx - size * 0.9, cy - size * 0.5, cx, cy - size);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx, cy - size * 0.8); ctx.lineTo(cx, cy + size * 0.5); ctx.stroke();
    ctx.restore();
}

function _drawCornerDeco(ctx, x, y, size, color, flip = false) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
    const sx = flip ? -1 : 1;
    ctx.translate(x, y);
    ctx.scale(sx, 1);
    ctx.beginPath(); ctx.moveTo(0, size); ctx.lineTo(0, 0); ctx.lineTo(size, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size * 0.4, 0); ctx.arc(0, 0, size * 0.4, 0, Math.PI / 2); ctx.stroke();
    ctx.restore();
}

function _drawGlowRingManual(ctx, cx, cy, r, c0, c1) {
    const glow = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r + 28);
    glow.addColorStop(0,   c0);
    glow.addColorStop(0.5, c1);
    glow.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(cx, cy, r + 28, 0, Math.PI * 2);
    ctx.fillStyle = glow; ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    ring.addColorStop(0,    c0.replace(/[\d.]+\)$/, '1)'));
    ring.addColorStop(0.5,  c1.replace(/[\d.]+\)$/, '0.80)'));
    ring.addColorStop(1,    c0.replace(/[\d.]+\)$/, '1)'));
    ctx.strokeStyle = ring; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
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

function _truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}

async function _buildCard({
    username   = 'User',
    groupName  = 'Group',
    memberCount = 0,
    avatar     = null,
    bgUrl      = null,
    type       = 'welcome',
} = {}) {
    const { Canvas, loadImage } = require('skia-canvas');
    await _ensureFonts();

    const isWelcome = type === 'welcome';

    const DEFAULT_BG = bgUrl
        || global.welcomeBg
        || (isWelcome
            ? 'https://files.catbox.moe/nb8of6.jpeg'
            : 'https://files.catbox.moe/nb8of6.jpeg');

    const [bgBuf, avatarBuf] = await Promise.all([
        _fetchBuffer(DEFAULT_BG).catch(() => null),
        (avatar && typeof avatar === 'string' && /^https?:\/\//.test(avatar))
            ? _fetchBuffer(avatar).catch(() => null)
            : Promise.resolve(Buffer.isBuffer(avatar) ? avatar : null),
    ]);

    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext('2d');
    const FD = _ff('display'), FM = _ff('mono'), FB = _ff('body');

    if (bgBuf) {
        const bgImg = await loadImage(bgBuf);
        const scale = Math.max(W / bgImg.width, H / bgImg.height);
        const sw = bgImg.width * scale, sh = bgImg.height * scale;
        ctx.drawImage(bgImg, (W - sw) / 2, (H - sh) / 2, sw, sh);
    } else {
        const g = ctx.createLinearGradient(0, 0, W, H);
        if (isWelcome) {
            g.addColorStop(0, '#0f0c29'); g.addColorStop(0.5, '#302b63'); g.addColorStop(1, '#24243e');
        } else {
            g.addColorStop(0, '#1a0505'); g.addColorStop(0.5, '#3d1515'); g.addColorStop(1, '#1a0505');
        }
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    const sc = _sampleBgColor(ctx, W, H);
    const tR = sc.r, tG = sc.g, tB = sc.b;
    const lum = 0.299 * tR + 0.587 * tG + 0.114 * tB;
    const isDark = lum < 128;

    const pTR = Math.max(0, Math.min(255, tR * 0.35 + (isDark ? 18 : 180)));
    const pTG = Math.max(0, Math.min(255, tG * 0.35 + (isDark ? 18 : 180)));
    const pTB = Math.max(0, Math.min(255, tB * 0.35 + (isDark ? 28 : 210)));
    const aR  = Math.min(255, tR * 0.55 + 55);
    const aG  = Math.min(255, tG * 0.55 + 55);
    const aB  = Math.min(255, tB * 0.55 + 95);

    const accentC0 = isWelcome
        ? `rgba(${Math.round(aR*0.5+80)},${Math.round(aG*0.8+60)},${Math.round(aB)},0.80)`
        : `rgba(${Math.round(aR+60)},${Math.round(aG*0.4+30)},${Math.round(aB*0.4+30)},0.80)`;
    const accentC1 = isWelcome
        ? `rgba(${Math.round(aR*0.3+40)},${Math.round(aG*0.5+80)},${Math.round(aB*0.8+60)},0.30)`
        : `rgba(${Math.round(aR*0.6+30)},${Math.round(aG*0.2+10)},${Math.round(aB*0.2+10)},0.30)`;

    const vig = ctx.createRadialGradient(W/2, H/2, H*0.1, W/2, H/2, H*0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0.02)'); vig.addColorStop(1, 'rgba(0,0,0,0.76)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

    const scrim = ctx.createLinearGradient(0, H * 0.20, 0, H);
    scrim.addColorStop(0, 'rgba(0,0,0,0)'); scrim.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = scrim; ctx.fillRect(0, 0, W, H);

    _dotCluster(ctx, 28, 28, 5, 16, 'rgba(255,255,255,0.08)');
    _dotCluster(ctx, W - 28 - 4*16, H - 28 - 4*16, 5, 16, 'rgba(255,255,255,0.06)');
    _hexGrid(ctx, W - 180, 10, 5, 6, 20, `rgba(${Math.round(aR)},${Math.round(aG)},${Math.round(aB)},0.07)`);
    _hexGrid(ctx, 0, H - 200, 5, 6, 20, `rgba(${tR},${tG},${tB},0.06)`);

    _drawWaveLines(ctx, H * 0.08, W, 'rgba(255,255,255,0.04)');
    _drawWaveLines(ctx, H * 0.82, W, 'rgba(255,255,255,0.03)');

    _drawStar(ctx, 60,  H - 60,  8,  'rgba(255,255,255,0.12)');
    _drawStar(ctx, W - 55, 55,   6,  'rgba(255,255,255,0.10)');
    _drawStar(ctx, W - 80, H - 80, 5, 'rgba(255,255,255,0.09)');
    _drawDiamond(ctx, 100, 80, 7, 'rgba(255,255,255,0.08)');
    _drawDiamond(ctx, W - 100, H - 70, 6, 'rgba(255,255,255,0.07)');

    ctx.save();
    const ac1 = ctx.createRadialGradient(180, 180, 0, 180, 180, 320);
    ac1.addColorStop(0, `rgba(${Math.round(tR*0.5+50)},${Math.round(tG*0.3+40)},${Math.round(tB*0.7+70)},0.16)`);
    ac1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ac1; ctx.fillRect(0, 0, W, H);
    const ac2 = ctx.createRadialGradient(W - 150, H - 130, 0, W - 150, H - 130, 280);
    ac2.addColorStop(0, `rgba(${Math.round(tR*0.4+30)},${Math.round(tG*0.5+70)},${Math.round(tB*0.8+55)},0.14)`);
    ac2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ac2; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const PW = 1160, PH = 420;
    const PX = (W - PW) / 2;
    const PY = (H - PH) / 2 + 20;

    ctx.save();
    ctx.shadowBlur = 90; ctx.shadowColor = `rgba(${tR},${tG},${tB},0.45)`; ctx.shadowOffsetY = 22;
    _rr(ctx, PX, PY, PW, PH, 30);
    ctx.fillStyle = `rgba(${Math.round(pTR*0.18)},${Math.round(pTG*0.18)},${Math.round(pTB*0.25)},0.28)`;
    ctx.fill();
    ctx.restore();

    _hardBlurPanel(ctx, PX, PY, PW, PH, 30, pTR, pTG, pTB, 0.25);

    ctx.save();
    _rr(ctx, PX, PY, PW, PH, 30);
    const pA = ctx.createLinearGradient(PX, PY, PX + PW, PY + PH);
    pA.addColorStop(0, `rgba(${Math.round(aR)},${Math.round(aG)},${Math.round(aB)},0.05)`);
    pA.addColorStop(1, `rgba(${tR},${tG},${tB},0.03)`);
    ctx.fillStyle = pA; ctx.fill();
    ctx.restore();

    _drawCornerDeco(ctx, PX + 18, PY + 18, 22, `rgba(${Math.round(aR)},${Math.round(aG)},${Math.round(aB)},0.55)`, false);
    _drawCornerDeco(ctx, PX + PW - 18, PY + 18, 22, `rgba(${Math.round(aR)},${Math.round(aG)},${Math.round(aB)},0.55)`, true);
    _drawCornerDeco(ctx, PX + 18, PY + PH - 18, 22, `rgba(${Math.round(aR)},${Math.round(aG)},${Math.round(aB)},0.40)`, false);
    _drawCornerDeco(ctx, PX + PW - 18, PY + PH - 18, 22, `rgba(${Math.round(aR)},${Math.round(aG)},${Math.round(aB)},0.40)`, true);

    const AVR = 74;
    const AVX = PX + 48 + AVR;
    const AVY = PY + PH / 2;

    _drawGlowRingManual(ctx, AVX, AVY, AVR, accentC0, accentC1);
    await _drawAvatar(ctx, avatarBuf, AVX, AVY, AVR);

    if (isWelcome) {
        _drawCheckIcon(ctx, AVX + AVR * 0.68, AVY + AVR * 0.68, 14,
            `rgba(${Math.round(aR*0.5+80)},${Math.round(aG*0.8+60)},${Math.round(aB)},0.95)`);
    } else {
        ctx.save();
        ctx.strokeStyle = `rgba(${Math.round(aR+60)},${Math.round(aG*0.3+30)},${Math.round(aB*0.3+30)},0.95)`;
        ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        const ix = AVX + AVR * 0.68, iy = AVY + AVR * 0.68, is = 8;
        ctx.beginPath(); ctx.arc(ix, iy, 14, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${Math.round(aR+60)},${Math.round(aG*0.3+30)},${Math.round(aB*0.3+30)},0.95)`;
        ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(ix - is * 0.6, iy - is * 0.6); ctx.lineTo(ix + is * 0.6, iy + is * 0.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ix + is * 0.6, iy - is * 0.6); ctx.lineTo(ix - is * 0.6, iy + is * 0.6); ctx.stroke();
        ctx.restore();
    }

    const TX  = AVX + AVR + 36;
    const TW  = PX + PW - TX - 28;
    const midY = PY + PH / 2;

    const tagLabel = isWelcome ? 'SELAMAT DATANG' : 'SAMPAI JUMPA';
    const tagColor = isWelcome
        ? `rgba(${Math.round(aR*0.5+120)},${Math.round(aG*0.8+80)},255,0.75)`
        : `rgba(255,${Math.round(aG*0.3+80)},${Math.round(aB*0.3+80)},0.75)`;

    _sh(ctx, 8, `rgba(${Math.round(aR)},${Math.round(aG)},${Math.round(aB)},0.50)`, 2);
    ctx.font = `bold 13px ${FM}`;
    ctx.fillStyle = tagColor;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    const tagText = tagLabel;
    const tagW    = ctx.measureText(tagText).width + 24;
    const tagH    = 22;
    const tagX    = TX;
    const tagY    = midY - 106;

    _rr(ctx, tagX, tagY, tagW, tagH, tagH / 2);
    ctx.fillStyle = isWelcome
        ? `rgba(${Math.round(aR*0.3+40)},${Math.round(aG*0.5+60)},${Math.round(aB*0.7+80)},0.22)`
        : `rgba(${Math.round(aR*0.6+60)},${Math.round(aG*0.2+20)},${Math.round(aB*0.2+20)},0.22)`;
    ctx.fill();
    _rr(ctx, tagX, tagY, tagW, tagH, tagH / 2);
    ctx.strokeStyle = tagColor; ctx.lineWidth = 1.2; ctx.stroke();
    _nosh(ctx);

    if (isWelcome) {
        _drawWaveIcon(ctx, tagX + 14, tagY + tagH / 2, 6, tagColor);
    } else {
        _drawLeafIcon(ctx, tagX + 14, tagY + tagH / 2, 6, tagColor);
    }

    ctx.font = `bold 13px ${FM}`;
    ctx.fillStyle = tagColor;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(tagLabel, tagX + 28, tagY + tagH / 2);

    _sh(ctx, 28, accentC0, 4);
    ctx.font = `bold 52px ${FD}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const nameStr = _truncate(username, 20);
    ctx.save();
    ctx.beginPath(); ctx.rect(TX, PY, TW, PH); ctx.clip();
    ctx.fillText(nameStr, TX, midY - 40);
    ctx.restore();
    _nosh(ctx);

    ctx.save();
    ctx.font = `bold 52px ${FD}`;
    const nameW = Math.min(ctx.measureText(nameStr).width, TW);
    const ulG = ctx.createLinearGradient(TX, 0, TX + nameW, 0);
    ulG.addColorStop(0,   accentC0.replace(/[\d.]+\)$/, '0.85)'));
    ulG.addColorStop(0.7, accentC0.replace(/[\d.]+\)$/, '0.50)'));
    ulG.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.strokeStyle = ulG; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(TX, midY - 28); ctx.lineTo(TX + nameW, midY - 28); ctx.stroke();
    ctx.restore();

    ctx.font = `15px ${FB}`;
    ctx.fillStyle = 'rgba(220,215,255,0.72)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const groupStr = _truncate(groupName, 32);
    ctx.fillText(isWelcome ? `Bergabung ke ${groupStr}` : `Meninggalkan ${groupStr}`, TX, midY - 8);

    const divX = TX;
    const divY = midY + 8;
    const divW = Math.min(TW, 480);
    const divG = ctx.createLinearGradient(divX, divY, divX + divW, divY);
    divG.addColorStop(0,   accentC0.replace(/[\d.]+\)$/, '0.40)'));
    divG.addColorStop(0.8, accentC0.replace(/[\d.]+\)$/, '0.15)'));
    divG.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.strokeStyle = divG; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(divX, divY); ctx.lineTo(divX + divW, divY); ctx.stroke();

    const IC_Y  = midY + 26;
    const IC_SP = 22;
    const infoItems = [
        {
            draw: (x, y) => {
                ctx.save();
                ctx.strokeStyle = tagColor; ctx.lineWidth = 2; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.arc(x + 8, y, 7, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x + 8, y + 7); ctx.lineTo(x + 8, y + 13); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x + 3, y + 10); ctx.lineTo(x + 13, y + 10); ctx.stroke();
                ctx.restore();
            },
            text: `Member ke-${memberCount}`,
        },
        {
            draw: (x, y) => _drawPlusIcon(ctx, x + 8, y + 4, 6, tagColor, 2),
            text: isWelcome ? 'Anggota Baru' : 'Keluar Grup',
        },
    ];

    let icX = TX;
    for (const item of infoItems) {
        item.draw(icX, IC_Y);
        ctx.font = `13px ${FB}`;
        ctx.fillStyle = 'rgba(200,195,240,0.65)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(item.text, icX + IC_SP, IC_Y + 6);
        icX += ctx.measureText(item.text).width + IC_SP + 32;
    }

    const botTextY = PY + PH - 16;
    _sh(ctx, 8, 'rgba(0,0,0,0.50)', 2);
    ctx.font = `12px ${FD}`;
    ctx.fillStyle = `rgba(${Math.round(200+tR*0.15)},${Math.round(190+tG*0.08)},255,0.40)`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('\u2756  BulterBot  \u2756', W / 2, botTextY);
    _nosh(ctx);

    const dotColor = `rgba(${Math.round(aR)},${Math.round(aG)},${Math.round(aB)},0.50)`;
    const _corner = (cx, cy) => {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = dotColor; ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.strokeStyle = dotColor.replace(/[\d.]+\)$/, '0.22)'); ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
    };
    _corner(PX + 30, PY + 30);
    _corner(PX + PW - 30, PY + 30);
    _corner(PX + 30, PY + PH - 30);
    _corner(PX + PW - 30, PY + PH - 30);

    return canvas.toBuffer('image/jpeg', { quality: 0.96 });
}

async function createWelcomeCard(opts = {}) {
    return _buildCard({ ...opts, type: 'welcome' });
}

async function createGoodbyeCard(opts = {}) {
    return _buildCard({ ...opts, type: 'goodbye' });
}

module.exports = { createWelcomeCard, createGoodbyeCard };
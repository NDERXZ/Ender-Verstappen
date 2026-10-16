'use strict';

const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const PP_FALLBACK = path.join(process.cwd(), 'assets', 'profile.jpg');

const W = 720;
const H = 1020;

const C = {
    bg1:     '#CEC0A0',
    bg2:     '#B8A882',
    bg3:     '#A89060',
    border:  '#6B4E2A',
    text:    '#3E2C10',
    textMid: '#5A3E1A',
    textSub: '#7A5C2E',
    photo:   '#5C4030',
    cream:   '#E8DCC0',
    dark:    '#2A1A08',
    shadow:  'rgba(42,26,8,0.35)',
};

async function _fetch(url) {
    return new Promise((res, rej) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: 12000 }, (r) => {
            if (r.statusCode === 301 || r.statusCode === 302) { req.destroy(); return _fetch(r.headers.location).then(res).catch(rej); }
            if (r.statusCode !== 200) { req.destroy(); return rej(new Error('HTTP ' + r.statusCode)); }
            const ch = []; r.on('data', c => ch.push(c)); r.on('end', () => res(Buffer.concat(ch))); r.on('error', rej);
        });
        req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('Timeout')); });
    });
}

async function _loadImg(src) {
    const { loadImage } = require('skia-canvas');
    if (!src) return null;
    try {
        if (Buffer.isBuffer(src) && src.length > 800) return await loadImage(src);
        if (typeof src === 'string' && /^https?:\/\//.test(src)) {
            const buf = await _fetch(src);
            if (buf && buf.length > 1500) return await loadImage(buf);
            return null;
        }
        if (typeof src === 'string' && fs.existsSync(src)) return await loadImage(fs.readFileSync(src));
    } catch {}
    return null;
}

async function _getPhoto(src) {
    let img = await _loadImg(src);
    if (img) return img;
    if (fs.existsSync(PP_FALLBACK)) { img = await _loadImg(PP_FALLBACK); if (img) return img; }
    const { Canvas } = require('skia-canvas');
    const fc = new Canvas(400, 340);
    const fx = fc.getContext('2d');
    const g = fx.createLinearGradient(0, 0, 400, 340);
    g.addColorStop(0, '#A89878'); g.addColorStop(1, '#7A6040');
    fx.fillStyle = g; fx.fillRect(0, 0, 400, 340);
    fx.fillStyle = 'rgba(62,44,16,0.30)';
    fx.beginPath(); fx.arc(200, 130, 65, 0, Math.PI * 2); fx.fill();
    fx.beginPath(); fx.ellipse(200, 290, 100, 70, 0, Math.PI, 0, true); fx.fill();
    return await _loadImg(await fc.toBuffer('image/png'));
}

function _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function _coverRect(ctx, img, x, y, w, h) {
    ctx.save();
    const ir = img.width / img.height, cr = w / h;
    let dw, dh, dx, dy;
    if (ir > cr) { dh = h; dw = dh * ir; dx = x - (dw - w) / 2; dy = y; }
    else { dw = w; dh = dw / ir; dx = x; dy = y - (dh - h) / 2; }
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
}

function _parchmentBg(ctx) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0,   '#D8C8A4');
    g.addColorStop(0.3, '#CDBF98');
    g.addColorStop(0.6, '#C4B48C');
    g.addColorStop(1,   '#B8A880');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const rng = (s => { let v = s; return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; }; })(54321);
    for (let i = 0; i < 4000; i++) {
        const x = rng() * W, y = rng() * H;
        const a = rng() * 0.055 + 0.008;
        const dark = rng() > 0.5;
        ctx.beginPath(); ctx.arc(x, y, rng() * 1.1 + 0.2, 0, Math.PI * 2);
        ctx.fillStyle = dark ? `rgba(60,38,10,${a})` : `rgba(220,200,160,${a * 0.8})`;
        ctx.fill();
    }

    for (let i = 0; i < 18; i++) {
        const x1 = rng() * W, y1 = rng() * H;
        const x2 = x1 + (rng() - 0.5) * 280, y2 = y1 + (rng() - 0.5) * 180;
        ctx.save(); ctx.globalAlpha = rng() * 0.04 + 0.01;
        ctx.strokeStyle = rng() > 0.5 ? '#3A2408' : '#8A7040';
        ctx.lineWidth = rng() * 0.8 + 0.2;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
    }

    const spots = [[0.1, 0.05, 60], [0.9, 0.08, 45], [0.15, 0.92, 55], [0.85, 0.90, 50], [0.5, 0.5, 40]];
    spots.forEach(([rx, ry, r]) => {
        const sg = ctx.createRadialGradient(rx * W, ry * H, 0, rx * W, ry * H, r);
        sg.addColorStop(0, 'rgba(100,70,20,0.10)');
        sg.addColorStop(1, 'rgba(100,70,20,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    });

    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(40,24,8,0.32)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

function _outerBorder(ctx) {
    const m = 14;
    _rrect(ctx, m, m, W - m * 2, H - m * 2, 4);
    ctx.strokeStyle = C.border; ctx.lineWidth = 4.5; ctx.stroke();
    _rrect(ctx, m + 7, m + 7, W - (m + 7) * 2, H - (m + 7) * 2, 3);
    ctx.strokeStyle = C.textSub; ctx.lineWidth = 1.2; ctx.stroke();
}

function _cornerOrnament(ctx, cx, cy, flip) {
    ctx.save();
    ctx.translate(cx, cy);
    if (flip & 1) ctx.scale(-1, 1);
    if (flip & 2) ctx.scale(1, -1);
    ctx.strokeStyle = C.border; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(28, 0); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, 28); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(28, 0); ctx.bezierCurveTo(28, 14, 14, 22, 14, 28);
    ctx.strokeStyle = C.textSub; ctx.lineWidth = 1.2; ctx.stroke();

    ctx.beginPath(); ctx.arc(28, 0, 3.5, 0, Math.PI * 2); ctx.fillStyle = C.border; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 28, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 14, 2.5, 0, Math.PI * 2); ctx.fillStyle = C.textSub; ctx.fill();
    ctx.restore();
}

function _drawCorners(ctx) {
    const m = 22;
    _cornerOrnament(ctx, m, m, 0);
    _cornerOrnament(ctx, W - m, m, 1);
    _cornerOrnament(ctx, m, H - m, 2);
    _cornerOrnament(ctx, W - m, H - m, 3);
}

function _wantedText(ctx) {
    ctx.save();
    ctx.font = 'bold 118px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(42,26,8,0.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 5;
    ctx.fillStyle = C.text;
    ctx.fillText('WANTED', W / 2, 30);

    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = C.dark; ctx.lineWidth = 1.5;
    ctx.strokeText('WANTED', W / 2, 30);

    ctx.font = '13px serif'; ctx.fillStyle = C.textSub; ctx.letterSpacing = '3px';
    ctx.fillText('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', W / 2, 150);
    ctx.restore();
}

function _swirl(ctx, cx, cy, dir) {
    ctx.save();
    ctx.strokeStyle = C.textMid; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.translate(cx, cy);
    if (dir < 0) ctx.scale(-1, 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(8, -12, 20, -10, 22, 0);
    ctx.bezierCurveTo(24, 10, 14, 16, 6, 10);
    ctx.bezierCurveTo(-2, 4, 0, -4, 6, -2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(22, 0); ctx.lineTo(44, 0);
    ctx.stroke();
    ctx.restore();
}

function _deadOrAlive(ctx, y) {
    ctx.save();
    ctx.font = 'bold 28px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.textMid;
    ctx.shadowColor = 'rgba(42,26,8,0.30)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    ctx.fillText('DEAD   OR   ALIVE', W / 2, y);

    const tw = ctx.measureText('DEAD   OR   ALIVE').width;
    const ox = (W - tw) / 2;
    _swirl(ctx, ox - 55, y, 1);
    _swirl(ctx, ox + tw + 55, y, -1);
    ctx.restore();
}

function _nameText(ctx, name, y) {
    const upper = name.toUpperCase().replace(/\s+/g, '·');
    ctx.save();
    ctx.shadowColor = 'rgba(42,26,8,0.40)'; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 4;
    ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';

    let fontSize = 68;
    ctx.font = `bold ${fontSize}px serif`;
    while (ctx.measureText(upper).width > W - 80 && fontSize > 28) {
        fontSize -= 2;
        ctx.font = `bold ${fontSize}px serif`;
    }

    ctx.fillText(upper, W / 2, y);
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = C.dark; ctx.lineWidth = 0.8;
    ctx.strokeText(upper, W / 2, y);
    ctx.restore();

    return fontSize;
}

function _berrySymbol(ctx, x, y, size) {
    ctx.save();
    ctx.font = `bold ${size}px serif`; ctx.fillStyle = C.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('฿', x, y);
    ctx.restore();
}

function _bountyText(ctx, bounty, y) {
    ctx.save();
    ctx.font = 'bold 52px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.text;
    ctx.shadowColor = 'rgba(42,26,8,0.35)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;

    const formatted = Number(bounty).toLocaleString('en-US');
    const full = '฿ ' + formatted;
    ctx.fillText(full, W / 2, y);
    ctx.restore();
}

function _ornamentDivider(ctx, y, width) {
    const cx = W / 2;
    const hw = width / 2;
    ctx.save();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - hw, y); ctx.lineTo(cx + hw, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - hw, y); ctx.lineTo(cx - hw + 12, y - 6); ctx.lineTo(cx - hw + 12, y + 6); ctx.closePath();
    ctx.fillStyle = C.border; ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + hw, y); ctx.lineTo(cx + hw - 12, y - 6); ctx.lineTo(cx + hw - 12, y + 6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, y, 4, 0, Math.PI * 2); ctx.fill();
    [-60, -30, 30, 60].forEach(dx => {
        ctx.beginPath(); ctx.arc(cx + dx, y, 2, 0, Math.PI * 2); ctx.fillStyle = C.textSub; ctx.fill();
    });
    ctx.restore();
}

function _photoFrame(ctx, x, y, w, h) {
    ctx.save();
    ctx.shadowColor = 'rgba(42,26,8,0.50)'; ctx.shadowBlur = 14; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 6;
    ctx.fillStyle = C.cream; ctx.fillRect(x - 4, y - 4, w + 8, h + 8); ctx.restore();

    ctx.save();
    ctx.strokeStyle = C.photo; ctx.lineWidth = 5;
    ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
    ctx.strokeStyle = C.textSub; ctx.lineWidth = 1.2;
    ctx.strokeRect(x - 8, y - 8, w + 16, h + 16);
    ctx.strokeStyle = C.border; ctx.lineWidth = 0.8;
    ctx.strokeRect(x - 11, y - 11, w + 22, h + 22);
    ctx.restore();
}

function _marineStamp(ctx, x, y) {
    ctx.save();
    ctx.shadowColor = 'rgba(42,26,8,0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    ctx.font = 'bold 32px serif'; ctx.fillStyle = C.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MARINE', x, y + 20);

    ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y - 18, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - 32); ctx.lineTo(x - 5, y - 16);
    ctx.moveTo(x, y - 32); ctx.lineTo(x + 5, y - 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 22); ctx.lineTo(x + 10, y - 22);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 18, 5, 0, Math.PI * 2);
    ctx.fillStyle = C.border; ctx.fill();

    [0, 60, 120, 180, 240, 300].forEach(deg => {
        const rad = deg * Math.PI / 180;
        const r1 = 12, r2 = 16;
        ctx.save(); ctx.strokeStyle = C.border; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(rad) * r1, y - 18 + Math.sin(rad) * r1);
        ctx.lineTo(x + Math.cos(rad) * r2, y - 18 + Math.sin(rad) * r2);
        ctx.stroke(); ctx.restore();
    });
    ctx.restore();
}

function _disclaimer(ctx, x, y) {
    const lines = [
        'KONO SAKUHIN HA FICTION DETHUNODE JITSUZAISURU JINBUTSU DANTAI',
        'SONOTA NO SOSHIKI TO DOITSU NO MEISHOU GA GEKICHU NI TOUJYOU',
        'SHITATOSHITEMO JITSUZAI NA MONOTOHA ISSAI MUKANKEIDETH',
    ];
    ctx.save();
    ctx.font = '10px sans-serif'; ctx.fillStyle = C.textSub;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * 14));
    ctx.restore();
}

function _agingOverlay(ctx) {
    const rng = (s => { let v = s; return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; }; })(99999);

    for (let i = 0; i < 60; i++) {
        const x = rng() * W, y = rng() * H;
        const r = rng() * 40 + 10;
        const ag = ctx.createRadialGradient(x, y, 0, x, y, r);
        ag.addColorStop(0, `rgba(${rng() > 0.5 ? '80,55,20' : '200,175,120'},${rng() * 0.06 + 0.01})`);
        ag.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H);
    }

    ctx.save(); ctx.globalAlpha = 0.03;
    for (let y = 0; y < H; y += 2) {
        ctx.fillStyle = y % 4 === 0 ? 'rgba(0,0,0,0.6)' : 'rgba(200,170,100,0.3)';
        ctx.fillRect(0, y, W, 1);
    }
    ctx.restore();
}

async function createWantedPoster(opts = {}) {
    const { Canvas } = require('skia-canvas');
    const {
        name   = 'UNKNOWN',
        bounty = 0,
        photo  = null,
        alias  = '',
    } = opts;

    const canvas  = new Canvas(W, H);
    const ctx     = canvas.getContext('2d');

    _parchmentBg(ctx);
    _outerBorder(ctx);
    _drawCorners(ctx);
    _wantedText(ctx);

    const photoX = 48, photoY = 158;
    const photoW = W - 96, photoH = 340;
    _photoFrame(ctx, photoX, photoY, photoW, photoH);

    const photoImg = await _getPhoto(photo);
    ctx.save();
    ctx.beginPath(); ctx.rect(photoX, photoY, photoW, photoH); ctx.clip();
    _coverRect(ctx, photoImg, photoX, photoY, photoW, photoH);
    ctx.restore();

    ctx.save(); ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#3A2408'; ctx.fillRect(photoX, photoY, photoW, photoH);
    ctx.restore();

    let curY = photoY + photoH + 22;

    _ornamentDivider(ctx, curY, W - 80);
    curY += 14;

    _deadOrAlive(ctx, curY + 16);
    curY += 46;

    const fsize = _nameText(ctx, name, curY);
    curY += fsize + 16;

    if (alias) {
        ctx.save();
        ctx.font = 'italic 20px serif'; ctx.fillStyle = C.textSub;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('"' + alias + '"', W / 2, curY);
        ctx.restore();
        curY += 30;
    }

    _ornamentDivider(ctx, curY, W - 120);
    curY += 14;

    _bountyText(ctx, bounty, curY);
    curY += 66;

    _ornamentDivider(ctx, curY, W - 80);
    curY += 18;

    _disclaimer(ctx, 36, curY);
    _marineStamp(ctx, W - 100, curY - 4);

    _agingOverlay(ctx);

    return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

module.exports = { createWantedPoster };

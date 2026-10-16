'use strict';

const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const PP_FALLBACK = path.join(process.cwd(), 'assets', 'profile.jpg');

const W = 900;

const PAL = {
    paper:   '#F2E8D0',
    paper2:  '#EDE0C4',
    paper3:  '#E4D5B0',
    ink:     '#1A1208',
    inkMid:  '#2C1F0A',
    inkSub:  '#4A3520',
    inkFade: '#7A6040',
    border:  '#2A1A08',
    red:     '#8B1A1A',
    line:    '#3A2A10',
};

const LOREM_WORDS = ['extraordinary','remarkable','unprecedented','shocking','breathtaking','incredible','stunning','mysterious','legendary','powerful','historic','dramatic','spectacular','surprising','controversial','sensational','explosive','unbelievable','astounding','phenomenal','monumental','outstanding','magnificent','revolutionary','impressive'];

const FILLER_LINES = [
    'Sources close to the matter confirmed the incident occurred late last night.',
    'Officials have yet to comment on the situation as investigations continue.',
    'Witnesses described scenes of utter chaos and disbelief across the region.',
    'The event has sparked widespread debate among experts and citizens alike.',
    'Documents obtained exclusively reveal previously unknown details of the affair.',
    'Authorities are urging calm as the situation continues to develop rapidly.',
    'Multiple eyewitnesses corroborated the account in separate interviews today.',
    'The ramifications of this development are expected to be far-reaching indeed.',
    'Analysts predict significant consequences in the weeks and months to follow.',
    'The story has captured national attention and dominated headlines worldwide.',
    'Representatives were unavailable for comment at the time of publication.',
    'Community leaders have called for an immediate inquiry into the circumstances.',
    'The incident is being described as one of the most significant in recent memory.',
    'International observers are monitoring the situation with great interest now.',
    'Further details are expected to emerge as the investigation moves forward.',
    'Local residents expressed a mixture of shock, disbelief, and fascination.',
];

const HEADLINES = [
    (n) => `LOCAL HERO ${n.toUpperCase()} SAVES ENTIRE CITY FROM MYSTERIOUS CATASTROPHE`,
    (n) => `SCIENTISTS BAFFLED: ${n.toUpperCase()} DISCOVERED TO POSSESS EXTRAORDINARY ABILITIES`,
    (n) => `BREAKING: ${n.toUpperCase()} ELECTED SUPREME LEADER BY UNANIMOUS PUBLIC VOTE`,
    (n) => `WORLD RECORD SHATTERED AS ${n.toUpperCase()} ACHIEVES THE IMPOSSIBLE`,
    (n) => `EXCLUSIVE: ${n.toUpperCase()} REVEALS SECRET THAT CHANGES EVERYTHING WE KNOW`,
    (n) => `${n.toUpperCase()} STUNS EXPERTS WITH UNPRECEDENTED DISPLAY OF BRILLIANCE`,
    (n) => `INTERNATIONAL COMMUNITY IN AWE OF ${n.toUpperCase()}'S REMARKABLE ACHIEVEMENT`,
    (n) => `${n.toUpperCase()} SINGLE-HANDEDLY SOLVES PROBLEM THAT BAFFLED EXPERTS FOR DECADES`,
];

const SUBHEADS = [
    (n) => `Eyewitnesses confirm ${n} was indeed at the scene`,
    (n) => `Experts praise ${n}'s extraordinary contribution`,
    (n) => `The ${n} phenomenon sweeps the nation`,
    (n) => `Officials scramble to respond to ${n} revelations`,
    (n) => `World reacts to shocking ${n} development`,
    (n) => `${n} hailed as hero by local community`,
];

const SMALL_HEADS = [
    'WEATHER DISRUPTS AFTERNOON COMMUTE ACROSS THREE DISTRICTS',
    'STOCK MARKET REACHES HISTORIC HIGH AMID GLOBAL UNCERTAINTY',
    'LOCAL COUNCIL APPROVES NEW INFRASTRUCTURE SPENDING PACKAGE',
    'UNIVERSITY RESEARCHERS ANNOUNCE BREAKTHROUGH IN ENERGY SCIENCE',
    'SPORTS: LOCAL TEAM ADVANCES TO REGIONAL CHAMPIONSHIP FINALS',
    'CULTURAL FESTIVAL DRAWS RECORD ATTENDANCE FOR FIFTH YEAR',
    'NEW REGULATIONS SPARK DEBATE IN BUSINESS COMMUNITY TODAY',
    'TOURISM NUMBERS SURGE AS VISITORS FLOCK TO LOCAL ATTRACTIONS',
];

function _seededRng(seed) {
    let v = seed || 42;
    return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; };
}

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
    const fc = new Canvas(300, 240), fx = fc.getContext('2d');
    const g = fx.createLinearGradient(0, 0, 300, 240);
    g.addColorStop(0, '#C8B890'); g.addColorStop(1, '#907050');
    fx.fillStyle = g; fx.fillRect(0, 0, 300, 240);
    fx.fillStyle = 'rgba(40,25,8,0.35)';
    fx.beginPath(); fx.arc(150, 88, 52, 0, Math.PI * 2); fx.fill();
    fx.beginPath(); fx.ellipse(150, 200, 85, 56, 0, Math.PI, 0, true); fx.fill();
    return await _loadImg(await fc.toBuffer('image/png'));
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

function _wrapText(ctx, text, maxW) {
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) {
        const test = cur ? cur + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
        else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
}

function _justifyLine(ctx, line, x, w, isLast) {
    if (isLast || line.split(' ').length <= 1) {
        ctx.fillText(line, x, 0); return;
    }
    const words = line.split(' ');
    const totalW = ctx.measureText(line.replace(/ /g, '')).width;
    const spaces = words.length - 1;
    const spaceW = (w - totalW) / spaces;
    let cx2 = x;
    words.forEach((word, i) => {
        ctx.fillText(word, cx2, 0);
        cx2 += ctx.measureText(word).width + spaceW;
    });
}

function _paperTexture(ctx, w, h, seed) {
    const rng = _seededRng(seed);
    const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
    g.addColorStop(0, PAL.paper);
    g.addColorStop(0.4, PAL.paper2);
    g.addColorStop(0.7, PAL.paper);
    g.addColorStop(1, PAL.paper3);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 3500; i++) {
        const x = rng() * w, y = rng() * h, a = rng() * 0.045 + 0.005;
        const dark = rng() > 0.55;
        ctx.beginPath(); ctx.arc(x, y, rng() * 0.9 + 0.15, 0, Math.PI * 2);
        ctx.fillStyle = dark ? `rgba(40,24,6,${a})` : `rgba(230,210,170,${a * 0.6})`;
        ctx.fill();
    }

    for (let i = 0; i < 25; i++) {
        const x1 = rng() * w, y1 = rng() * h;
        const x2 = x1 + (rng() - 0.5) * 200, y2 = y1 + (rng() - 0.5) * 120;
        ctx.save(); ctx.globalAlpha = rng() * 0.03 + 0.005;
        ctx.strokeStyle = rng() > 0.5 ? '#2A1608' : '#907040';
        ctx.lineWidth = rng() * 0.6 + 0.1;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
    }

    const ag = [[0.05, 0.05, 80], [0.95, 0.05, 70], [0.05, 0.95, 75], [0.95, 0.95, 65],
                 [0.5, 0.0, 120], [0.0, 0.5, 90], [1.0, 0.5, 90]];
    ag.forEach(([rx, ry, r]) => {
        const sg = ctx.createRadialGradient(rx * w, ry * h, 0, rx * w, ry * h, r);
        sg.addColorStop(0, 'rgba(80,50,15,0.12)'); sg.addColorStop(1, 'rgba(80,50,15,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
    });

    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(30,18,5,0.28)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

function _hline(ctx, x, y, w, lw, color) {
    ctx.save(); ctx.strokeStyle = color || PAL.line; ctx.lineWidth = lw || 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke(); ctx.restore();
}

function _vline(ctx, x, y, h, lw, color) {
    ctx.save(); ctx.strokeStyle = color || PAL.line; ctx.lineWidth = lw || 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke(); ctx.restore();
}

function _drawMasthead(ctx, paperName, city, date, edition, price) {
    const PAD = 24;
    let y = PAD;

    const topLine = `${city.toUpperCase()}  ·  ${edition}  ·  ${price}`;
    ctx.save(); ctx.font = '10px serif'; ctx.fillStyle = PAL.inkSub;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(topLine, PAD, y);
    ctx.textAlign = 'right';
    ctx.fillText(date, W - PAD, y);
    ctx.restore();

    y += 18;
    _hline(ctx, PAD, y, W - PAD * 2, 1, PAL.line);
    _hline(ctx, PAD, y + 2, W - PAD * 2, 0.4, PAL.line);
    y += 10;

    ctx.save();
    ctx.shadowColor = 'rgba(26,18,8,0.30)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;
    ctx.font = 'bold 72px serif';
    ctx.fillStyle = PAL.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(paperName, W / 2, y);
    ctx.restore();

    const nameH = 80;
    y += nameH;

    ctx.save(); ctx.font = 'italic 11px serif'; ctx.fillStyle = PAL.inkFade;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('"All The News That\'s Fit To Print  —  Truth, Justice & The Morning Read"', W / 2, y);
    ctx.restore();

    y += 18;
    _hline(ctx, PAD, y, W - PAD * 2, 3, PAL.border);
    _hline(ctx, PAD, y + 5, W - PAD * 2, 1, PAL.border);
    y += 12;

    return y;
}

function _drawWeatherBand(ctx, y, rng) {
    const weathers = ['☀ SUNNY 32°C','⛅ PARTLY CLOUDY 28°C','🌧 SHOWERS 24°C','⛈ STORMY 22°C'];
    const w = weathers[Math.floor(rng() * weathers.length)];
    const PAD = 24;
    _hline(ctx, PAD, y, W - PAD * 2, 0.5, PAL.inkFade);
    ctx.save();
    ctx.font = '9.5px sans-serif'; ctx.fillStyle = PAL.inkFade;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('WEATHER:  ' + w, PAD, y + 7);
    ctx.textAlign = 'right';
    ctx.fillText('VOL. CXLVII  No. ' + (Math.floor(rng() * 900) + 100), W - PAD, y + 7);
    ctx.restore();
    _hline(ctx, PAD, y + 14, W - PAD * 2, 0.5, PAL.inkFade);
    return y + 20;
}

function _drawHeadline(ctx, text, x, y, w, fontSize, color, align) {
    ctx.save();
    ctx.font = `bold ${fontSize}px serif`;
    ctx.fillStyle = color || PAL.ink;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'top';
    const lines = _wrapText(ctx, text, w);
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * (fontSize * 1.18)));
    ctx.restore();
    return y + lines.length * (fontSize * 1.18);
}

function _drawByline(ctx, name, x, y) {
    ctx.save();
    ctx.font = 'italic bold 10px serif'; ctx.fillStyle = PAL.inkSub;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`By ${name} | Staff Correspondent`, x, y);
    ctx.restore();
    return y + 16;
}

function _drawBodyText(ctx, lines, x, y, colW, lineH, justified) {
    ctx.save();
    ctx.font = '11.5px serif'; ctx.fillStyle = PAL.inkMid;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
        const isLast = i === lines.length - 1;
        ctx.save(); ctx.translate(x, y + i * lineH);
        if (justified) _justifyLine(ctx, line, 0, colW, isLast);
        else ctx.fillText(line, 0, 0);
        ctx.restore();
    });
    ctx.restore();
    return y + lines.length * lineH;
}

function _drawDropCap(ctx, letter, x, y, size) {
    ctx.save();
    ctx.font = `bold ${size}px serif`; ctx.fillStyle = PAL.ink;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(26,18,8,0.20)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 2;
    ctx.fillText(letter, x, y);
    ctx.restore();
    return ctx.measureText ? size * 0.85 : size;
}

function _drawPullQuote(ctx, text, x, y, w) {
    const PAD = 10;
    _hline(ctx, x, y, w, 2, PAL.border);
    _hline(ctx, x, y + 2, w, 0.5, PAL.border);

    ctx.save();
    ctx.font = 'italic bold 13px serif'; ctx.fillStyle = PAL.inkMid;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lines = _wrapText(ctx, `"${text}"`, w - PAD * 2);
    lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + 10 + i * 18));
    const textH = lines.length * 18;
    ctx.restore();

    const qH = textH + 20;
    _hline(ctx, x, y + qH + 10, w, 0.5, PAL.border);
    _hline(ctx, x, y + qH + 12, w, 2, PAL.border);
    return y + qH + 20;
}

function _drawAdBox(ctx, x, y, w, h, rng) {
    ctx.save();
    ctx.strokeStyle = PAL.border; ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = PAL.inkFade; ctx.lineWidth = 0.5;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
    ctx.restore();

    const ads = [
        { title: 'SUPERIOR QUALITY', sub: 'FINEST GOODS IN THE DISTRICT', body: 'Est. 1887 — Trusted for generations' },
        { title: 'DR. PEMBERTON\'S', sub: 'MIRACULOUS TONIC & ELIXIR', body: 'Restores Vitality · Clears the Mind' },
        { title: 'GRAND EMPORIUM', sub: 'DEPARTMENT STORE', body: 'Five Floors of Exceptional Merchandise' },
        { title: 'THE ROYAL HOTEL', sub: 'FINEST ACCOMMODATION', body: 'Rooms from 2/6 per night — Central Location' },
    ];
    const ad = ads[Math.floor(rng() * ads.length)];

    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.min(14, w / 10)}px serif`; ctx.fillStyle = PAL.ink;
    ctx.fillText(ad.title, x + w / 2, y + 10);
    ctx.font = `italic ${Math.min(10, w / 14)}px serif`; ctx.fillStyle = PAL.inkSub;
    ctx.fillText(ad.sub, x + w / 2, y + 28);
    _hline(ctx, x + 10, y + 44, w - 20, 0.8, PAL.inkFade);
    ctx.font = `${Math.min(9, w / 16)}px serif`; ctx.fillStyle = PAL.inkFade;
    const blines = _wrapText(ctx, ad.body, w - 20);
    blines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + 50 + i * 12));
    ctx.restore();
}

function _drawPhotoBox(ctx, img, x, y, w, h, caption) {
    ctx.save();
    ctx.strokeStyle = PAL.border; ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    _coverRect(ctx, img, x, y, w, h);
    ctx.globalAlpha = 0.08; ctx.fillStyle = PAL.ink; ctx.fillRect(x, y, w, h);
    ctx.restore();

    const sepia = ctx.createLinearGradient(x, y, x + w, y + h);
    sepia.addColorStop(0, 'rgba(120,80,20,0.25)');
    sepia.addColorStop(1, 'rgba(80,50,10,0.15)');
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = sepia; ctx.fillRect(x, y, w, h);
    ctx.restore();

    if (caption) {
        _hline(ctx, x, y + h + 1, w, 0.5, PAL.inkFade);
        ctx.save(); ctx.font = 'italic 9px serif'; ctx.fillStyle = PAL.inkFade;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(caption, x, y + h + 5);
        ctx.restore();
    }
}

function _drawSectionHeader(ctx, text, x, y, w) {
    ctx.save(); ctx.fillStyle = PAL.ink; ctx.fillRect(x, y, w, 18);
    ctx.font = 'bold 10px serif'; ctx.fillStyle = PAL.paper; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase(), x + w / 2, y + 9);
    ctx.restore();
    return y + 22;
}

function _buildBodyLines(ctx, colW, rng, seed) {
    const r = _seededRng(seed || 11111);
    const lineH = 14.5;
    const fullText = Array.from({ length: 18 }, () => FILLER_LINES[Math.floor(r() * FILLER_LINES.length)]).join(' ');
    ctx.font = '11.5px serif';
    return { lines: _wrapText(ctx, fullText, colW), lineH };
}

async function createFakeNewspaper(opts = {}) {
    const { Canvas } = require('skia-canvas');
    const {
        username    = 'Unknown Person',
        headline    = null,
        subheadline = null,
        photo       = null,
        edition     = 'MORNING EDITION',
        city        = 'JAKARTA',
        paperName   = 'THE DAILY GAZETTE',
        price       = 'Price: Rp 5,000',
    } = opts;

    const rng  = _seededRng(username.length * 997 + 1337);
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();

    const mainHeadlineFn = HEADLINES[Math.floor(rng() * HEADLINES.length)];
    const mainHeadline   = headline || mainHeadlineFn(username);
    const subFn          = SUBHEADS[Math.floor(rng() * SUBHEADS.length)];
    const subHead        = subheadline || subFn(username);

    const photoImg = await _getPhoto(photo);

    const TEMP_H = 3000;
    const canvas  = new Canvas(W, TEMP_H);
    const ctx     = canvas.getContext('2d');

    _paperTexture(ctx, W, TEMP_H, 54321);

    const PAD = 24;
    let curY = _drawMasthead(ctx, paperName, city, date, edition, price);
    curY     = _drawWeatherBand(ctx, curY, rng);
    curY    += 10;

    const COL3 = (W - PAD * 2 - 2 * 8) / 3;

    const headEndY = _drawHeadline(ctx, mainHeadline, PAD, curY, W - PAD * 2, 34, PAL.ink, 'center');
    _hline(ctx, PAD, headEndY + 4, W - PAD * 2, 0.8, PAL.inkFade);

    ctx.save(); ctx.font = 'italic 12px serif'; ctx.fillStyle = PAL.red;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(subHead, W / 2, headEndY + 8);
    ctx.restore();
    curY = headEndY + 26;

    _hline(ctx, PAD, curY, W - PAD * 2, 2.5, PAL.border);
    _hline(ctx, PAD, curY + 4, W - PAD * 2, 0.6, PAL.border);
    curY += 12;

    const bylineY = _drawByline(ctx, username, PAD, curY);
    curY = bylineY + 4;

    const COL_L_W = COL3 * 2 + 8;
    const COL_R_W = COL3;
    const COL_L_X = PAD;
    const COL_R_X = PAD + COL_L_W + 8;

    const PHOTO_H = 240;
    const PHOTO_W = COL_L_W;

    _drawPhotoBox(ctx, photoImg, COL_L_X, curY, PHOTO_W, PHOTO_H,
        `${username.toUpperCase()} pictured at the scene — photograph by staff correspondent`);

    const capH = 18;
    const mainBodyStartY = curY + PHOTO_H + capH + 8;

    ctx.font = '11.5px serif';
    const { lines: mainLines, lineH } = _buildBodyLines(ctx, COL_L_W - 10, rng, 22222);
    const dropCapSize = 34;
    const firstLine   = mainLines[0] || '';
    const firstLetter = firstLine.charAt(0);
    const restFirst   = firstLine.slice(1);
    const dropCapW    = dropCapSize * 0.65;

    ctx.save(); ctx.font = `bold ${dropCapSize}px serif`; ctx.fillStyle = PAL.ink;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(26,18,8,0.20)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 2;
    ctx.fillText(firstLetter, COL_L_X, mainBodyStartY);
    ctx.restore();

    ctx.save(); ctx.font = '11.5px serif'; ctx.fillStyle = PAL.inkMid;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(restFirst, COL_L_X + dropCapW + 4, mainBodyStartY + 4);
    ctx.restore();

    const afterDrop = mainBodyStartY + dropCapSize + 2;
    const col1Lines = mainLines.slice(1, 16);
    let bodyEndY    = _drawBodyText(ctx, col1Lines, COL_L_X, afterDrop, COL_L_W, lineH, true);

    const pullQ = `"${username}'s actions have left the entire community in a state of absolute wonder and disbelief."`;
    const pqEndY = _drawPullQuote(ctx, pullQ, COL_L_X, bodyEndY + 8, COL_L_W);

    const col2Lines = mainLines.slice(16, 32);
    _drawBodyText(ctx, col2Lines, COL_L_X, pqEndY + 4, COL_L_W, lineH, true);

    let rightY = curY;
    const adH  = 100;
    _drawAdBox(ctx, COL_R_X, rightY, COL_R_W, adH, rng);
    rightY += adH + 10;

    rightY = _drawSectionHeader(ctx, 'SECOND REPORT', COL_R_X, rightY, COL_R_W);
    const side1Head = SMALL_HEADS[Math.floor(rng() * SMALL_HEADS.length)];
    rightY = _drawHeadline(ctx, side1Head, COL_R_X, rightY, COL_R_W, 13, PAL.ink, 'left') + 4;
    _hline(ctx, COL_R_X, rightY, COL_R_W, 0.5, PAL.inkFade);
    rightY += 6;
    const { lines: sideLines1, lineH: slh1 } = _buildBodyLines(ctx, COL_R_W, rng, 33333);
    rightY = _drawBodyText(ctx, sideLines1.slice(0, 12), COL_R_X, rightY, COL_R_W, slh1, false);
    rightY += 10;

    _hline(ctx, COL_R_X, rightY, COL_R_W, 1.5, PAL.border);
    rightY += 6;
    rightY = _drawSectionHeader(ctx, 'IN OTHER NEWS', COL_R_X, rightY, COL_R_W);
    const side2Head = SMALL_HEADS[Math.floor(rng() * SMALL_HEADS.length)];
    rightY = _drawHeadline(ctx, side2Head, COL_R_X, rightY, COL_R_W, 13, PAL.ink, 'left') + 4;
    _hline(ctx, COL_R_X, rightY, COL_R_W, 0.5, PAL.inkFade);
    rightY += 6;
    const { lines: sideLines2, lineH: slh2 } = _buildBodyLines(ctx, COL_R_W, rng, 44444);
    _drawBodyText(ctx, sideLines2.slice(0, 10), COL_R_X, rightY, COL_R_W, slh2, false);

    const dividerY = Math.max(pqEndY + lineH * 14, rightY + slh2 * 10) + 20;

    _hline(ctx, PAD, dividerY, W - PAD * 2, 2.5, PAL.border);
    _hline(ctx, PAD, dividerY + 4, W - PAD * 2, 0.6, PAL.border);

    const bottomY = dividerY + 14;
    const col4W   = (W - PAD * 2 - 3 * 8) / 4;

    for (let col = 0; col < 4; col++) {
        const cx  = PAD + col * (col4W + 8);
        const ht  = SMALL_HEADS[Math.floor(rng() * SMALL_HEADS.length)];
        let   cY  = _drawHeadline(ctx, ht, cx, bottomY, col4W, 12, PAL.ink, 'left') + 4;
        _hline(ctx, cx, cY, col4W, 0.5, PAL.inkFade);
        cY += 6;
        const { lines: bl, lineH: blh } = _buildBodyLines(ctx, col4W, rng, 55555 + col * 1000);
        _drawBodyText(ctx, bl.slice(0, 11), cx, cY, col4W, blh, true);
        if (col < 3) _vline(ctx, cx + col4W + 4, bottomY, blh * 11 + 30, 0.5, PAL.inkFade);
    }

    const actualH = bottomY + 14 * lineH + 40;

    _hline(ctx, PAD, actualH - 20, W - PAD * 2, 1, PAL.border);
    ctx.save(); ctx.font = '9px serif'; ctx.fillStyle = PAL.inkFade;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`${paperName}  ·  Published Daily Since 1887  ·  All Rights Reserved  ·  Printed by The Morning Press`, W / 2, actualH - 14);
    ctx.restore();

    _vline(ctx, COL_R_X - 4, curY, dividerY - curY, 0.6, PAL.inkFade);

    const finalCanvas = new Canvas(W, Math.ceil(actualH));
    const fCtx = finalCanvas.getContext('2d');
    _paperTexture(fCtx, W, Math.ceil(actualH), 54321);
    fCtx.drawImage(canvas, 0, 0);

    fCtx.save(); fCtx.globalAlpha = 0.04;
    for (let y = 0; y < actualH; y += 2) {
        fCtx.fillStyle = y % 4 === 0 ? 'rgba(0,0,0,0.5)' : 'rgba(200,170,100,0.3)';
        fCtx.fillRect(0, y, W, 1);
    }
    fCtx.restore();

    return finalCanvas.toBuffer('image/jpeg', { quality: 0.95 });
}

module.exports = { createFakeNewspaper };

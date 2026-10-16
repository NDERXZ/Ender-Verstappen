'use strict';

const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const PP_FALLBACK = path.join(process.cwd(), 'assets', 'profile.jpg');

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
            const buf = await _fetch(src); if (buf && buf.length > 1500) return await loadImage(buf); return null;
        }
        if (typeof src === 'string' && fs.existsSync(src)) return await loadImage(fs.readFileSync(src));
    } catch {}
    return null;
}

async function _getAvatar(src) {
    let img = await _loadImg(src);
    if (img) return img;
    if (fs.existsSync(PP_FALLBACK)) { img = await _loadImg(PP_FALLBACK); if (img) return img; }
    const { Canvas } = require('skia-canvas');
    const fc = new Canvas(200, 200), fx = fc.getContext('2d');
    const g = fx.createRadialGradient(100, 80, 8, 100, 100, 100);
    g.addColorStop(0, '#536471'); g.addColorStop(1, '#2f3336');
    fx.fillStyle = g; fx.beginPath(); fx.arc(100, 100, 100, 0, Math.PI * 2); fx.fill();
    fx.fillStyle = 'rgba(255,255,255,0.55)';
    fx.beginPath(); fx.arc(100, 68, 34, 0, Math.PI * 2); fx.fill();
    fx.beginPath(); fx.ellipse(100, 148, 54, 40, 0, Math.PI, 0, true); fx.fill();
    return await _loadImg(await fc.toBuffer('image/png'));
}

function fmtN(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return (v / 1e9).toFixed(1).replace('.0', '') + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.0', '') + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1).replace('.0', '') + 'K';
    return String(v);
}

function _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
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

function _circleClip(ctx, img, cx, cy, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    const sc = Math.max((r * 2) / img.width, (r * 2) / img.height);
    ctx.drawImage(img, cx - img.width * sc / 2, cy - img.height * sc / 2, img.width * sc, img.height * sc);
    ctx.restore();
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

function _iconX(ctx, cx, cy, size, color) {
    ctx.save(); ctx.fillStyle = color;
    const s = size * 0.72;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.92);
    ctx.lineTo(cx - s * 0.08, cy - s * 0.08);
    ctx.lineTo(cx - s * 0.88, cy + s * 0.92);
    ctx.lineTo(cx - s * 0.52, cy + s * 0.92);
    ctx.lineTo(cx, cy + s * 0.06);
    ctx.lineTo(cx + s * 0.50, cy + s * 0.92);
    ctx.lineTo(cx + s * 0.92, cy + s * 0.92);
    ctx.lineTo(cx + s * 0.08, cy - s * 0.08);
    ctx.lineTo(cx + s * 0.98, cy - s * 0.92);
    ctx.lineTo(cx + s * 0.52, cy - s * 0.92);
    ctx.lineTo(cx, cy - s * 0.06);
    ctx.lineTo(cx - s * 0.52, cy - s * 0.92);
    ctx.closePath(); ctx.fill();
    ctx.restore();
}

function _iconHeart(ctx, cx, cy, s, color, filled) {
    ctx.save(); ctx.fillStyle = filled ? color : 'transparent';
    ctx.strokeStyle = color; ctx.lineWidth = s * 0.13; ctx.lineJoin = 'round';
    const top = cy - s * 0.10;
    ctx.beginPath();
    ctx.moveTo(cx, top + s * 0.52);
    ctx.bezierCurveTo(cx, top + s * 0.20, cx - s * 0.56, top - s * 0.14, cx - s * 0.56, top + s * 0.10);
    ctx.bezierCurveTo(cx - s * 0.56, top - s * 0.36, cx, top - s * 0.38, cx, top);
    ctx.bezierCurveTo(cx, top - s * 0.38, cx + s * 0.56, top - s * 0.36, cx + s * 0.56, top + s * 0.10);
    ctx.bezierCurveTo(cx + s * 0.56, top - s * 0.14, cx, top + s * 0.20, cx, top + s * 0.52);
    ctx.closePath(); if (filled) ctx.fill(); else ctx.stroke();
    ctx.restore();
}

function _iconComment(ctx, cx, cy, s, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = s * 0.13; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    _rrect(ctx, cx - s * 0.60, cy - s * 0.55, s * 1.20, s * 0.95, s * 0.18); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.28, cy + s * 0.40);
    ctx.lineTo(cx - s * 0.56, cy + s * 0.70);
    ctx.lineTo(cx - s * 0.10, cy + s * 0.40);
    ctx.stroke(); ctx.restore();
}

function _iconRetweet(ctx, cx, cy, s, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = s * 0.13; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx - s * 0.60, cy + s * 0.10); ctx.lineTo(cx - s * 0.60, cy - s * 0.28);
    ctx.quadraticCurveTo(cx - s * 0.60, cy - s * 0.55, cx - s * 0.28, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.55, cy - s * 0.55); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(cx + s * 0.38, cy - s * 0.82); ctx.lineTo(cx + s * 0.82, cy - s * 0.55); ctx.lineTo(cx + s * 0.38, cy - s * 0.28); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + s * 0.60, cy - s * 0.10); ctx.lineTo(cx + s * 0.60, cy + s * 0.28);
    ctx.quadraticCurveTo(cx + s * 0.60, cy + s * 0.55, cx + s * 0.28, cy + s * 0.55);
    ctx.lineTo(cx - s * 0.55, cy + s * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - s * 0.38, cy + s * 0.82); ctx.lineTo(cx - s * 0.82, cy + s * 0.55); ctx.lineTo(cx - s * 0.38, cy + s * 0.28); ctx.closePath(); ctx.fill();
    ctx.restore();
}

function _iconShare(ctx, cx, cy, s, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = s * 0.13; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx - s * 0.60, cy + s * 0.20); ctx.lineTo(cx - s * 0.60, cy + s * 0.60);
    ctx.lineTo(cx + s * 0.60, cy + s * 0.60); ctx.lineTo(cx + s * 0.60, cy + s * 0.20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.60); ctx.lineTo(cx, cy + s * 0.20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - s * 0.36, cy - s * 0.28); ctx.lineTo(cx, cy - s * 0.60); ctx.lineTo(cx + s * 0.36, cy - s * 0.28); ctx.stroke();
    ctx.restore();
}

function _iconBookmark(ctx, cx, cy, s, color, filled) {
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = filled ? color : 'transparent';
    ctx.lineWidth = s * 0.13; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.48, cy - s * 0.65);
    ctx.lineTo(cx + s * 0.48, cy - s * 0.65);
    ctx.lineTo(cx + s * 0.48, cy + s * 0.65);
    ctx.lineTo(cx, cy + s * 0.28);
    ctx.lineTo(cx - s * 0.48, cy + s * 0.65);
    ctx.closePath(); if (filled) ctx.fill(); ctx.stroke();
    ctx.restore();
}

function _iconVerified(ctx, cx, cy, size, type) {
    ctx.save();
    if (type === 'gold') {
        ctx.beginPath(); ctx.arc(cx, cy, size, 0, Math.PI * 2);
        ctx.fillStyle = '#FFD700'; ctx.fill();
    } else {
        ctx.beginPath(); ctx.arc(cx, cy, size, 0, Math.PI * 2);
        ctx.fillStyle = '#1d9bf0'; ctx.fill();
    }
    ctx.strokeStyle = 'white'; ctx.lineWidth = size * 0.17; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.46, cy + size * 0.02);
    ctx.lineTo(cx - size * 0.10, cy + size * 0.40);
    ctx.lineTo(cx + size * 0.46, cy - size * 0.38);
    ctx.stroke();
    ctx.restore();
}

function _drawMediaGrid(ctx, imgs, x, y, w, h, r) {
    if (!imgs || imgs.length === 0) return 0;
    const gap = 3;
    if (imgs.length === 1) {
        ctx.save(); _rrect(ctx, x, y, w, h, r); ctx.clip();
        _coverRect(ctx, imgs[0], x, y, w, h);
        ctx.restore();
        return h;
    }
    if (imgs.length === 2) {
        const hw = (w - gap) / 2;
        [0, 1].forEach(i => {
            ctx.save();
            _rrect(ctx, x + i * (hw + gap), y, hw, h, i === 0 ? [r, 0, 0, r] : [0, r, r, 0]);
            ctx.clip(); _coverRect(ctx, imgs[i], x + i * (hw + gap), y, hw, h); ctx.restore();
        });
        return h;
    }
    if (imgs.length >= 3) {
        const hw = (w - gap) / 2, hh = (h - gap) / 2;
        ctx.save(); _rrect(ctx, x, y, hw, h, [r, 0, 0, r]); ctx.clip();
        _coverRect(ctx, imgs[0], x, y, hw, h); ctx.restore();
        [[1, 0, 0], [2, hh + gap, 1]].forEach(([ii, oy, last]) => {
            if (!imgs[ii]) return;
            ctx.save(); _rrect(ctx, x + hw + gap, y + oy, hw, hh, last ? [0, r, r, 0] : [0, 0, 0, 0]);
            ctx.clip(); _coverRect(ctx, imgs[ii], x + hw + gap, y + oy, hw, hh); ctx.restore();
        });
        return h;
    }
    return 0;
}

function _rrectComplex(ctx, x, y, w, h, r) {
    const tl = r.tl ?? r, tr = r.tr ?? r, br = r.br ?? r, bl = r.bl ?? r;
    ctx.beginPath();
    ctx.moveTo(x + tl, y); ctx.lineTo(x + w - tr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
    ctx.lineTo(x + w, y + h - br); ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    ctx.lineTo(x + bl, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
    ctx.lineTo(x, y + tl); ctx.quadraticCurveTo(x, y, x + tl, y);
    ctx.closePath();
}

async function createFakeTweet(opts = {}) {
    const { Canvas } = require('skia-canvas');
    const {
        username    = 'username',
        displayName = 'Display Name',
        verified    = false,
        goldVerified = false,
        avatar      = null,
        content     = 'This is a fake tweet.',
        images      = [],
        time        = '9:41 AM',
        date        = 'Apr 26, 2026',
        via         = 'Twitter for iPhone',
        stats       = { replies: 0, retweets: 0, likes: 0, bookmarks: 0, views: 0 },
        liked       = false,
        retweeted   = false,
        bookmarked  = false,
        theme       = 'dark',
        quoteTweet  = null,
    } = opts;

    const DARK  = theme === 'dark';
    const BG    = DARK ? '#000000' : '#ffffff';
    const CARD  = DARK ? '#000000' : '#ffffff';
    const T1    = DARK ? '#e7e9ea' : '#0f1419';
    const T2    = DARK ? '#71767b' : '#536471';
    const T3    = DARK ? '#1d9bf0' : '#1d9bf0';
    const DIV   = DARK ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    const CARD2 = DARK ? '#16181c' : '#f7f9f9';
    const ACTIONC = DARK ? '#536471' : '#536471';

    const W = 1080;
    const PAD = 56, AV_R = 44, AV_CX = PAD + AV_R;
    const CONTENT_X = PAD * 2 + AV_R * 2;
    const CONTENT_W = W - CONTENT_X - PAD;
    const FONT_BODY = '30px sans-serif';
    const FONT_BOLD = 'bold 30px sans-serif';
    const FONT_SM   = '25px sans-serif';
    const FONT_XS   = '22px sans-serif';

    const tmpC = new Canvas(W, 100);
    const tmpX = tmpC.getContext('2d');

    tmpX.font = FONT_BODY;
    const contentLines = _wrapText(tmpX, content, CONTENT_W);
    tmpX.font = FONT_SM;

    let quoteH = 0;
    let quoteLines = [];
    if (quoteTweet) {
        tmpX.font = FONT_SM;
        quoteLines = _wrapText(tmpX, quoteTweet.content || '', CONTENT_W - 48);
        quoteH = 36 + 28 * 2 + quoteLines.length * 34 + 28 + 24;
    }

    const mediaImgs = await Promise.all(images.map(src => _loadImg(src)));
    const validMedia = mediaImgs.filter(Boolean);
    const mediaH = validMedia.length > 0 ? Math.round(CONTENT_W * 0.56) : 0;

    const lineH = 40;
    const contentH = contentLines.length * lineH;

    const headerH   = 20 + AV_R * 2 + 10;
    const bodyH     = 28 + contentH + (mediaH ? mediaH + 18 : 0) + (quoteH ? quoteH + 18 : 0) + 16;
    const metaH     = 56;
    const divH      = 1;
    const statsRowH = 70;
    const actionsH  = 80;
    const bottomH   = 60;

    const H = headerH + bodyH + metaH + divH * 2 + statsRowH + actionsH + bottomH;

    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = DIV; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.stroke();

    let Y = 20;

    const avImg = await _getAvatar(avatar);
    _circleClip(ctx, avImg, AV_CX, Y + AV_R, AV_R);

    ctx.save();
    ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = T1;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(displayName, CONTENT_X, Y + 4);

    const dnW = ctx.measureText(displayName).width;
    let vx = CONTENT_X + dnW + 8;
    if (verified || goldVerified) {
        _iconVerified(ctx, vx + 12, Y + 4 + 14, 14, goldVerified ? 'gold' : 'blue');
        vx += 32;
    }

    ctx.font = FONT_SM; ctx.fillStyle = T2;
    ctx.fillText('@' + username, CONTENT_X, Y + 42);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = T2; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    const moreX = W - PAD, moreY = Y + 14;
    [0, 10, 20].forEach(dx => { ctx.beginPath(); ctx.arc(moreX - 20 + dx, moreY, 2.5, 0, Math.PI * 2); ctx.fillStyle = T2; ctx.fill(); });
    ctx.restore();

    Y += AV_R * 2 + 10;

    ctx.save();
    ctx.font = FONT_BODY; ctx.fillStyle = T1;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    contentLines.forEach(line => { ctx.fillText(line, CONTENT_X, Y); Y += lineH; });
    ctx.restore();

    Y += 14;

    if (validMedia.length > 0) {
        const drawH = _drawMediaGrid(ctx, validMedia, CONTENT_X, Y, CONTENT_W, mediaH, 20);
        Y += drawH + 18;
    }

    if (quoteTweet) {
        _rrect(ctx, CONTENT_X, Y, CONTENT_W, quoteH, 16);
        ctx.fillStyle = CARD2; ctx.fill();
        _rrect(ctx, CONTENT_X, Y, CONTENT_W, quoteH, 16);
        ctx.strokeStyle = DIV; ctx.lineWidth = 1; ctx.stroke();

        let qY = Y + 18;
        ctx.save();
        ctx.font = 'bold 24px sans-serif'; ctx.fillStyle = T1;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(quoteTweet.displayName || 'User', CONTENT_X + 18, qY);
        ctx.font = '24px sans-serif'; ctx.fillStyle = T2;
        ctx.fillText(' @' + (quoteThread?.username || 'user'), CONTENT_X + 18 + ctx.measureText(quoteThread?.displayName || 'User').width, qY);
        qY += 32;

        ctx.font = FONT_SM; ctx.fillStyle = T1;
        quoteLines.forEach(l => { ctx.fillText(l, CONTENT_X + 18, qY); qY += 34; });
        ctx.restore();
        Y += quoteH + 18;
    }

    ctx.save();
    ctx.font = FONT_SM; ctx.fillStyle = T2;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`${time} · ${date} · `, CONTENT_X, Y);
    const timeW = ctx.measureText(`${time} · ${date} · `).width;
    ctx.fillStyle = T1;
    ctx.font = 'bold 25px sans-serif';
    ctx.fillText(via, CONTENT_X + timeW, Y);
    ctx.restore();

    Y += metaH;

    ctx.strokeStyle = DIV; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(CONTENT_X, Y); ctx.lineTo(W - PAD, Y); ctx.stroke();
    Y += 1;

    const statItems = [
        { label: fmtN(stats.replies)   + ' Replies',   v: stats.replies },
        { label: fmtN(stats.retweets)  + ' Reposts',   v: stats.retweets },
        { label: fmtN(stats.likes)     + ' Likes',     v: stats.likes },
        { label: fmtN(stats.bookmarks) + ' Bookmarks', v: stats.bookmarks },
    ];
    ctx.save();
    ctx.font = FONT_SM; ctx.fillStyle = T2; ctx.textBaseline = 'middle';
    const statGap = CONTENT_W / statItems.length;
    statItems.forEach((s, i) => {
        const parts = s.label.split(' ');
        const sx = CONTENT_X + i * statGap;
        ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = T1; ctx.textAlign = 'left';
        ctx.fillText(parts[0], sx, Y + statsRowH / 2);
        const nw = ctx.measureText(parts[0]).width;
        ctx.font = FONT_SM; ctx.fillStyle = T2;
        ctx.fillText(' ' + parts[1], sx + nw, Y + statsRowH / 2);
    });
    ctx.restore();
    Y += statsRowH;

    ctx.strokeStyle = DIV; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(CONTENT_X, Y); ctx.lineTo(W - PAD, Y); ctx.stroke();
    Y += 1;

    const actionDefs = [
        { fn: (cx, cy) => _iconComment(ctx, cx, cy, 22, ACTIONC), count: null },
        { fn: (cx, cy) => _iconRetweet(ctx, cx, cy, 22, retweeted ? '#00ba7c' : ACTIONC), count: null },
        { fn: (cx, cy) => _iconHeart(ctx, cx, cy, 22, liked ? '#f91880' : ACTIONC, liked), count: null },
        { fn: (cx, cy) => _iconBookmark(ctx, cx, cy, 22, bookmarked ? T3 : ACTIONC, bookmarked), count: null },
        { fn: (cx, cy) => _iconShare(ctx, cx, cy, 22, ACTIONC), count: null },
    ];
    const actW = CONTENT_W / actionDefs.length;
    actionDefs.forEach(({ fn }, i) => {
        fn(CONTENT_X + i * actW + actW / 2, Y + actionsH / 2);
    });
    Y += actionsH;

    ctx.strokeStyle = DIV; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(W, Y); ctx.stroke();

    ctx.save();
    ctx.font = FONT_XS; ctx.fillStyle = T2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (stats.views > 0) ctx.fillText(fmtN(stats.views) + ' Views', W / 2, Y + bottomH / 2);
    ctx.restore();

    return canvas.toBuffer('image/jpeg', { quality: 0.96 });
}

module.exports = { createFakeTweet };

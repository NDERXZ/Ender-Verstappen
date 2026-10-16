'use strict';

const { createCanvas, loadImage } = require('canvas');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const FALLBACK_COVER = path.join(process.cwd(), 'assets', 'profile.jpg');

function hex2rgb(hex) {
    const h = hex.replace('#', '');
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}
function lerpColor(c1, c2, t) {
    return {
        r: Math.round(c1.r + (c2.r - c1.r) * t),
        g: Math.round(c1.g + (c2.g - c1.g) * t),
        b: Math.round(c1.b + (c2.b - c1.b) * t),
    };
}
function rgbStr(c, a = 1) { return `rgba(${c.r},${c.g},${c.b},${a})`; }

function seededRng(s) {
    let v = s || 42;
    return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; };
}

function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function trunc(ctx, text, maxW) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (ctx.measureText(t + '…').width > maxW && t.length > 0) t = t.slice(0, -1);
    return t + '…';
}

function fmtDuration(secs) {
    const s = Math.max(0, Math.floor(Number(secs) || 0));
    const m = Math.floor(s / 60), ss = s % 60;
    return `${m}:${String(ss).padStart(2, '0')}`;
}

function fmtViews(n) {
    const num = Number(n) || 0;
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return String(num);
}

async function _fetchRaw(url, timeout = 12000) {
    return new Promise((res, rej) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout }, (r) => {
            if (r.statusCode === 301 || r.statusCode === 302) {
                req.destroy();
                return _fetchRaw(r.headers.location, timeout).then(res).catch(rej);
            }
            if (r.statusCode !== 200) { req.destroy(); return rej(new Error('HTTP ' + r.statusCode)); }
            const chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => res(Buffer.concat(chunks)));
            r.on('error', rej);
        });
        req.on('error', rej);
        req.on('timeout', () => { req.destroy(); rej(new Error('Timeout')); });
    });
}

async function fetchImage(src) {
    if (!src) return null;
    if (Buffer.isBuffer(src)) { try { return await loadImage(src); } catch { return null; } }
    if (typeof src !== 'string') return null;
    if (/^https?:\/\//.test(src)) {
        try { const buf = await _fetchRaw(src); return await loadImage(buf); } catch { return null; }
    }
    if (fs.existsSync(src)) { try { return await loadImage(fs.readFileSync(src)); } catch { return null; } }
    return null;
}

function extractDominantColors(img) {
    const sample = createCanvas(40, 40);
    const sc = sample.getContext('2d');
    sc.drawImage(img, 0, 0, 40, 40);
    const data = sc.getImageData(0, 0, 40, 40).data;

    const buckets = {};
    for (let i = 0; i < data.length; i += 4) {
        const r = Math.round(data[i]   / 32) * 32;
        const g = Math.round(data[i+1] / 32) * 32;
        const b = Math.round(data[i+2] / 32) * 32;
        const a = data[i+3];
        if (a < 128) continue;
        const key = `${r},${g},${b}`;
        buckets[key] = (buckets[key] || 0) + 1;
    }
    const sorted = Object.entries(buckets)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k]) => { const [r,g,b] = k.split(',').map(Number); return {r,g,b}; });

    const vibrant = sorted.find(c => {
        const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
        const sat = max === 0 ? 0 : (max - min) / max;
        return sat > 0.35 && (c.r + c.g + c.b) > 80;
    }) || sorted[0] || { r: 80, g: 60, b: 160 };

    const dark = { r: Math.round(vibrant.r * 0.18), g: Math.round(vibrant.g * 0.18), b: Math.round(vibrant.b * 0.18) };
    const mid  = lerpColor(dark, vibrant, 0.35);
    return { vibrant, dark, mid };
}

function stackBlur(imageData, W, H, radius) {
    if (radius < 1) return;
    const px = imageData.data, div = 2*radius+1, wm = W-1, hm = H-1;
    const rp1 = radius+1, mul = 1 / (rp1*(rp1+1)/2*2 + radius + 1);
    const stk = Array.from({length:div}, ()=>[0,0,0]);
    for (let y = 0; y < H; y++) {
        let ri=0,gi=0,bi=0,ro=0,go=0,bo=0,rs=0,gs=0,bs=0;
        for (let i = -radius; i <= radius; i++) {
            const si=(y*W+Math.min(wm,Math.max(0,i)))*4, s2=i+radius;
            stk[s2]=[px[si],px[si+1],px[si+2]];
            const rb=rp1-Math.abs(i);
            rs+=px[si]*rb; gs+=px[si+1]*rb; bs+=px[si+2]*rb;
            if (i>0){ri+=px[si];gi+=px[si+1];bi+=px[si+2];}
            else    {ro+=px[si];go+=px[si+1];bo+=px[si+2];}
        }
        let sIn=radius, sOut=0;
        for (let x=0;x<W;x++) {
            const idx=(y*W+x)*4;
            px[idx]=Math.round(rs*mul); px[idx+1]=Math.round(gs*mul); px[idx+2]=Math.round(bs*mul);
            rs-=ro; gs-=go; bs-=bo;
            const os=stk[sOut]; ro-=os[0]; go-=os[1]; bo-=os[2];
            const sx=Math.min(wm,x+radius+1), sid=(y*W+sx)*4;
            os[0]=px[sid]; os[1]=px[sid+1]; os[2]=px[sid+2];
            ri+=os[0]; gi+=os[1]; bi+=os[2];
            rs+=ri; gs+=gi; bs+=bi;
            sIn=(sIn+1)%div; const is=stk[sIn];
            ro+=is[0]; go+=is[1]; bo+=is[2];
            ri-=is[0]; gi-=is[1]; bi-=is[2];
            sOut=(sOut+1)%div;
        }
    }
    for (let x=0;x<W;x++) {
        let ri=0,gi=0,bi=0,ro=0,go=0,bo=0,rs=0,gs=0,bs=0;
        for (let i=-radius;i<=radius;i++) {
            const sy=Math.min(hm,Math.max(0,i)), sid=(sy*W+x)*4, s2=i+radius;
            stk[s2]=[px[sid],px[sid+1],px[sid+2]];
            const rb=rp1-Math.abs(i);
            rs+=px[sid]*rb; gs+=px[sid+1]*rb; bs+=px[sid+2]*rb;
            if (i>0){ri+=px[sid];gi+=px[sid+1];bi+=px[sid+2];}
            else    {ro+=px[sid];go+=px[sid+1];bo+=px[sid+2];}
        }
        let sIn=radius, sOut=0;
        for (let y=0;y<H;y++) {
            const idx=(y*W+x)*4;
            px[idx]=Math.round(rs*mul); px[idx+1]=Math.round(gs*mul); px[idx+2]=Math.round(bs*mul);
            rs-=ro; gs-=go; bs-=bo;
            const os=stk[sOut]; ro-=os[0]; go-=os[1]; bo-=os[2];
            const sy=Math.min(hm,y+radius+1), sid=(sy*W+x)*4;
            os[0]=px[sid]; os[1]=px[sid+1]; os[2]=px[sid+2];
            ri+=os[0]; gi+=os[1]; bi+=os[2];
            rs+=ri; gs+=gi; bs+=bi;
            sIn=(sIn+1)%div; const is=stk[sIn];
            ro+=is[0]; go+=is[1]; bo+=is[2];
            ri-=is[0]; gi-=is[1]; bi-=is[2];
            sOut=(sOut+1)%div;
        }
    }
}

function iconPlay(ctx, cx, cy, s, color) {
    ctx.save(); ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - s*0.30, cy - s*0.50);
    ctx.lineTo(cx + s*0.55, cy);
    ctx.lineTo(cx - s*0.30, cy + s*0.50);
    ctx.closePath(); ctx.fill(); ctx.restore();
}

function iconPrev(ctx, cx, cy, s, color) {
    ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.20; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - s*0.05, cy - s*0.45); ctx.lineTo(cx - s*0.05, cy + s*0.45); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s*0.45, cy - s*0.45);
    ctx.lineTo(cx - s*0.10, cy);
    ctx.lineTo(cx + s*0.45, cy + s*0.45);
    ctx.closePath(); ctx.fill(); ctx.restore();
}

function iconNext(ctx, cx, cy, s, color) {
    ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.20; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx + s*0.05, cy - s*0.45); ctx.lineTo(cx + s*0.05, cy + s*0.45); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s*0.45, cy - s*0.45);
    ctx.lineTo(cx + s*0.10, cy);
    ctx.lineTo(cx - s*0.45, cy + s*0.45);
    ctx.closePath(); ctx.fill(); ctx.restore();
}

function iconHeart(ctx, cx, cy, s, color, filled = true) {
    ctx.save();
    ctx.fillStyle = filled ? color : 'transparent';
    ctx.strokeStyle = color; ctx.lineWidth = s * 0.14; ctx.lineJoin = 'round';
    const top = cy - s * 0.10;
    ctx.beginPath();
    ctx.moveTo(cx, top + s * 0.50);
    ctx.bezierCurveTo(cx, top + s*0.20, cx - s*0.55, top - s*0.15, cx - s*0.55, top + s*0.08);
    ctx.bezierCurveTo(cx - s*0.55, top - s*0.35, cx, top - s*0.38, cx, top);
    ctx.bezierCurveTo(cx, top - s*0.38, cx + s*0.55, top - s*0.35, cx + s*0.55, top + s*0.08);
    ctx.bezierCurveTo(cx + s*0.55, top - s*0.15, cx, top + s*0.20, cx, top + s*0.50);
    ctx.closePath();
    if (filled) ctx.fill(); else ctx.stroke();
    ctx.restore();
}

function iconVolume(ctx, cx, cy, s, color) {
    ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.14; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s*0.50, cy - s*0.25);
    ctx.lineTo(cx - s*0.15, cy - s*0.25);
    ctx.lineTo(cx + s*0.05, cy - s*0.50);
    ctx.lineTo(cx + s*0.05, cy + s*0.50);
    ctx.lineTo(cx - s*0.15, cy + s*0.25);
    ctx.lineTo(cx - s*0.50, cy + s*0.25);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + s*0.18, cy, s*0.28, -Math.PI*0.55, Math.PI*0.55); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + s*0.18, cy, s*0.48, -Math.PI*0.50, Math.PI*0.50); ctx.stroke();
    ctx.restore();
}

function iconRepeat(ctx, cx, cy, s, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = s*0.14; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s*0.45, cy + s*0.15);
    ctx.lineTo(cx - s*0.45, cy - s*0.22);
    ctx.quadraticCurveTo(cx - s*0.45, cy - s*0.45, cx - s*0.20, cy - s*0.45);
    ctx.lineTo(cx + s*0.45, cy - s*0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s*0.45, cy - s*0.15);
    ctx.lineTo(cx + s*0.45, cy + s*0.22);
    ctx.quadraticCurveTo(cx + s*0.45, cy + s*0.45, cx + s*0.20, cy + s*0.45);
    ctx.lineTo(cx - s*0.45, cy + s*0.45);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(cx - s*0.45 - s*0.16, cy + s*0.06); ctx.lineTo(cx - s*0.45 + s*0.16, cy + s*0.06); ctx.lineTo(cx - s*0.45, cy + s*0.28); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + s*0.45 - s*0.16, cy - s*0.06); ctx.lineTo(cx + s*0.45 + s*0.16, cy - s*0.06); ctx.lineTo(cx + s*0.45, cy - s*0.28); ctx.closePath(); ctx.fill();
    ctx.restore();
}

function iconShuffle(ctx, cx, cy, s, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = s*0.13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - s*0.48, cy - s*0.30); ctx.bezierCurveTo(cx - s*0.10, cy - s*0.30, cx + s*0.10, cy + s*0.30, cx + s*0.48, cy + s*0.30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - s*0.48, cy + s*0.30); ctx.bezierCurveTo(cx - s*0.10, cy + s*0.30, cx + s*0.10, cy - s*0.30, cx + s*0.48, cy - s*0.30); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(cx+s*0.32,cy-s*0.48); ctx.lineTo(cx+s*0.50,cy-s*0.30); ctx.lineTo(cx+s*0.32,cy-s*0.12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx+s*0.32,cy+s*0.12); ctx.lineTo(cx+s*0.50,cy+s*0.30); ctx.lineTo(cx+s*0.32,cy+s*0.48); ctx.closePath(); ctx.fill();
    ctx.restore();
}

function drawEqBars(ctx, cx, cy, w, h, color, seed) {
    const rng = seededRng(seed);
    const bars = 12, barW = w / (bars * 2 - 1), gap = barW;
    ctx.save(); ctx.fillStyle = color;
    for (let i = 0; i < bars; i++) {
        const bh = (rng() * 0.65 + 0.15) * h;
        const x  = cx - w/2 + i*(barW + gap);
        const y  = cy + h/2 - bh;
        rrect(ctx, x, y, barW, bh, barW/2);
        ctx.fill();
    }
    ctx.restore();
}

function drawWaveform(ctx, x, y, w, h, progress, colorActive, colorInactive, seed) {
    const rng = seededRng(seed);
    const bars = 60;
    const barW = (w / bars) * 0.55;
    const gap  = (w / bars) * 0.45;
    ctx.save();
    for (let i = 0; i < bars; i++) {
        const bh  = (rng() * 0.75 + 0.10) * h;
        const bx  = x + i * (barW + gap);
        const by  = y + h/2 - bh/2;
        const pct = i / (bars - 1);
        ctx.fillStyle = pct <= progress ? colorActive : colorInactive;
        rrect(ctx, bx, by, barW, bh, barW/2);
        ctx.fill();
    }
    const thumbX = x + progress * w;
    ctx.shadowBlur = 12; ctx.shadowColor = colorActive;
    ctx.beginPath(); ctx.arc(thumbX, y + h/2, 6, 0, Math.PI*2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
}

function drawVolumeBar(ctx, x, y, w, h, pct, colorFill, colorTrack, r) {
    rrect(ctx, x, y, w, h, r); ctx.fillStyle = colorTrack; ctx.fill();
    if (pct > 0) { rrect(ctx, x, y, w * pct, h, r); ctx.fillStyle = colorFill; ctx.fill(); }
}

function drawMusicNote(ctx, x, y, s, color, alpha) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x - s*0.18, y + s*0.42, s*0.22, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + s*0.30, y + s*0.22, s*0.22, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - s*0.18 + s*0.22, y + s*0.42);
    ctx.lineTo(x + s*0.38, y - s*0.42);
    ctx.lineTo(x + s*0.38, y + s*0.22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s*0.18 + s*0.22, y + s*0.42);
    ctx.lineTo(x + s*0.38, y - s*0.42); ctx.stroke();
    ctx.restore();
}

function drawPlatformBadge(ctx, x, y, platform, vibrant) {
    const labels = { youtube: 'YouTube', spotify: 'Spotify', soundcloud: 'SoundCloud', default: 'Music' };
    const colors = {
        youtube:    '#FF0000',
        spotify:    '#1DB954',
        soundcloud: '#FF5500',
        default:    rgbStr(vibrant),
    };
    const label = labels[platform] || labels.default;
    const color = colors[platform] || colors.default;
    const c = hex2rgb(color.startsWith('#') ? color : '#507090');

    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    const tw = ctx.measureText(label).width;
    const pw = tw + 26, ph = 22;
    const px = x - pw/2;

    rrect(ctx, px, y, pw, ph, ph/2);
    ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.20)`; ctx.fill();
    rrect(ctx, px, y, pw, ph, ph/2);
    ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},0.60)`; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath(); ctx.arc(px + 11, y + ph/2, 4, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();

    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 5, y + ph/2);
    ctx.restore();
}

async function createNowPlayingCard(opts = {}) {
    const W = 900, H = 320;

    const title       = (opts.title   || 'Unknown Title').slice(0, 80);
    const artist      = (opts.artist  || 'Unknown Artist').slice(0, 60);
    const album       = (opts.album   || '').slice(0, 60);
    const platform    = (opts.platform || 'default').toLowerCase();
    const liked       = opts.liked ?? false;
    const volume      = Math.max(0, Math.min(100, Number(opts.volume) ?? 75));
    const volPct      = volume / 100;
    const duration    = Math.max(1, Number(opts.duration) || 240);
    const currentTime = opts.currentTime != null
        ? Math.max(0, Math.min(duration, Number(opts.currentTime)))
        : Math.floor(duration * (0.25 + Math.random() * 0.50));
    const progress    = currentTime / duration;
    const views       = opts.views ? fmtViews(opts.views) : null;
    const ago         = opts.ago   || null;

    let coverImg = await fetchImage(opts.thumbnail);
    if (!coverImg && fs.existsSync(FALLBACK_COVER)) {
        try { coverImg = await loadImage(fs.readFileSync(FALLBACK_COVER)); } catch {}
    }

    let palette = { vibrant: {r:106,g:90,b:205}, dark: {r:18,g:15,b:38}, mid: {r:42,g:32,b:90} };
    if (coverImg) palette = extractDominantColors(coverImg);
    const { vibrant, dark, mid } = palette;

    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');

    if (coverImg) {
        const bgC = createCanvas(W, H);
        const bgX = bgC.getContext('2d');
        const sc  = Math.max(W / coverImg.width, H / coverImg.height);
        bgX.drawImage(coverImg, (W - coverImg.width*sc)/2, (H - coverImg.height*sc)/2, coverImg.width*sc, coverImg.height*sc);
        const id = bgX.getImageData(0, 0, W, H);
        stackBlur(id, W, H, 36);
        bgX.putImageData(id, 0, 0);
        ctx.drawImage(bgC, 0, 0);
    } else {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, rgbStr(dark));
        g.addColorStop(1, rgbStr(mid));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    const deepScrim = ctx.createLinearGradient(0, 0, W, 0);
    deepScrim.addColorStop(0,    'rgba(0,0,0,0.96)');
    deepScrim.addColorStop(0.30, 'rgba(0,0,0,0.90)');
    deepScrim.addColorStop(0.55, 'rgba(0,0,0,0.65)');
    deepScrim.addColorStop(0.80, 'rgba(0,0,0,0.35)');
    deepScrim.addColorStop(1,    'rgba(0,0,0,0.10)');
    ctx.fillStyle = deepScrim; ctx.fillRect(0, 0, W, H);

    const bScrim = ctx.createLinearGradient(0, H * 0.45, 0, H);
    bScrim.addColorStop(0, 'rgba(0,0,0,0)');
    bScrim.addColorStop(1, 'rgba(0,0,0,0.80)');
    ctx.fillStyle = bScrim; ctx.fillRect(0, 0, W, H);

    const tScrim = ctx.createLinearGradient(0, 0, 0, H * 0.40);
    tScrim.addColorStop(0, 'rgba(0,0,0,0.50)');
    tScrim.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tScrim; ctx.fillRect(0, 0, W, H);

    const ambL = ctx.createRadialGradient(60, H / 2, 0, 60, H / 2, W * 0.60);
    ambL.addColorStop(0, rgbStr(vibrant, 0.28));
    ambL.addColorStop(0.5, rgbStr(vibrant, 0.08));
    ambL.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ambL; ctx.fillRect(0, 0, W, H);

    const ambR = ctx.createRadialGradient(W, H * 0.3, 0, W, H * 0.3, W * 0.45);
    ambR.addColorStop(0, rgbStr(mid, 0.20));
    ambR.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ambR; ctx.fillRect(0, 0, W, H);

    const cardBg = ctx.createLinearGradient(0, 0, 0, H);
    cardBg.addColorStop(0, 'rgba(255,255,255,0.04)');
    cardBg.addColorStop(1, 'rgba(0,0,0,0.04)');
    ctx.fillStyle = cardBg; ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.restore();

    drawMusicNote(ctx, W - 88,  38,  26, rgbStr(vibrant), 0.10);
    drawMusicNote(ctx, W - 50, 210,  16, '#ffffff',       0.05);
    drawMusicNote(ctx, W - 128, 272, 13, '#ffffff',       0.04);

    const COV  = 236;
    const COVX = 32;
    const COVY = (H - COV) / 2;

    ctx.save();
    ctx.shadowColor   = rgbStr(vibrant, 0.65);
    ctx.shadowBlur    = 50;
    ctx.shadowOffsetX = 10;
    ctx.shadowOffsetY = 16;
    rrect(ctx, COVX, COVY, COV, COV, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.01)'; ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.70)';
    ctx.shadowBlur    = 24;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 8;
    rrect(ctx, COVX, COVY, COV, COV, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.01)'; ctx.fill();
    ctx.restore();

    ctx.save();
    rrect(ctx, COVX, COVY, COV, COV, 20);
    ctx.clip();
    if (coverImg) {
        const sc = Math.max(COV / coverImg.width, COV / coverImg.height);
        ctx.drawImage(coverImg,
            COVX + (COV - coverImg.width  * sc) / 2,
            COVY + (COV - coverImg.height * sc) / 2,
            coverImg.width  * sc,
            coverImg.height * sc);
    } else {
        const g = ctx.createLinearGradient(COVX, COVY, COVX + COV, COVY + COV);
        g.addColorStop(0, rgbStr(mid));
        g.addColorStop(1, rgbStr(dark));
        ctx.fillStyle = g; ctx.fillRect(COVX, COVY, COV, COV);
        drawMusicNote(ctx, COVX + COV / 2, COVY + COV / 2, COV * 0.35, '#ffffff', 0.30);
    }

    const vig = ctx.createRadialGradient(
        COVX + COV / 2, COVY + COV / 2, COV * 0.20,
        COVX + COV / 2, COVY + COV / 2, COV * 0.75
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = vig; ctx.fillRect(COVX, COVY, COV, COV);

    const covShine = ctx.createLinearGradient(COVX, COVY, COVX + COV * 0.6, COVY + COV * 0.4);
    covShine.addColorStop(0, 'rgba(255,255,255,0.12)');
    covShine.addColorStop(0.4, 'rgba(255,255,255,0.04)');
    covShine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = covShine; ctx.fillRect(COVX, COVY, COV, COV);

    ctx.restore();

    rrect(ctx, COVX, COVY, COV, COV, 20);
    const covBorder = ctx.createLinearGradient(COVX, COVY, COVX + COV, COVY + COV);
    covBorder.addColorStop(0,   rgbStr(vibrant, 0.80));
    covBorder.addColorStop(0.4, 'rgba(255,255,255,0.20)');
    covBorder.addColorStop(1,   rgbStr(vibrant, 0.25));
    ctx.strokeStyle = covBorder; ctx.lineWidth = 1.8; ctx.stroke();

    const eqColor = rgbStr(vibrant, 0.65);
    drawEqBars(ctx, COVX + COV - 2 - 45, COVY + COV - 2 - 28, 46, 24, eqColor, 9988);

    drawPlatformBadge(ctx, COVX + COV / 2, COVY - 32, platform, vibrant);

    const IX = COVX + COV + 32;
    const IW = W - IX - 28;
    let   IY = COVY + 12;

    ctx.save();
    ctx.font = 'bold 29px sans-serif';
    ctx.shadowColor = rgbStr(vibrant, 0.70);
    ctx.shadowBlur  = 20;
    ctx.fillStyle   = '#FFFFFF';
    ctx.textAlign   = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(trunc(ctx, title, IW - 20), IX, IY);
    ctx.restore();
    IY += 40;

    ctx.save();
    ctx.font = '600 15px sans-serif';
    ctx.fillStyle    = rgbStr(vibrant, 0.95);
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(trunc(ctx, artist, IW - 46), IX, IY);
    ctx.restore();

    const heartX = IX + IW - 8;
    const heartY = IY + 8;

    if (liked) {
        ctx.save();
        ctx.shadowColor = rgbStr(vibrant, 0.80);
        ctx.shadowBlur  = 14;
        iconHeart(ctx, heartX, heartY, 14, rgbStr(vibrant), true);
        ctx.restore();
    } else {
        iconHeart(ctx, heartX, heartY, 14, 'rgba(255,255,255,0.45)', false);
    }
    IY += 28;

    if (album) {
        ctx.save();
        ctx.font = '12px sans-serif';
        ctx.fillStyle    = 'rgba(255,255,255,0.42)';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(trunc(ctx, '♪  ' + album, IW), IX, IY);
        ctx.restore();
        IY += 20;
    }

    if (views || ago) {
        ctx.save();
        ctx.font = '11px sans-serif';
        ctx.fillStyle    = 'rgba(255,255,255,0.32)';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'top';
        const meta = [views ? `${views} plays` : null, ago].filter(Boolean).join('  ·  ');
        ctx.fillText(meta, IX, IY);
        ctx.restore();
        IY += 18;
    }

    IY += 8;

    const BAR_H = 44;
    const BAR_W = IW;

    ctx.save();
    const waveGlow = ctx.createLinearGradient(IX, 0, IX + BAR_W * progress, 0);
    waveGlow.addColorStop(0, rgbStr(vibrant, 0.10));
    waveGlow.addColorStop(1, rgbStr(vibrant, 0.04));
    ctx.fillStyle = waveGlow;
    ctx.fillRect(IX, IY, BAR_W * progress, BAR_H);
    ctx.restore();

    drawWaveform(
        ctx, IX, IY, BAR_W, BAR_H, progress,
        rgbStr(vibrant, 1),
        'rgba(255,255,255,0.15)',
        7331
    );
    IY += BAR_H + 6;

    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = rgbStr(vibrant, 0.75);
    ctx.textAlign    = 'left';
    ctx.fillText(fmtDuration(currentTime), IX, IY);
    ctx.fillStyle    = 'rgba(255,255,255,0.40)';
    ctx.textAlign    = 'right';
    ctx.fillText(fmtDuration(duration), IX + BAR_W, IY);
    ctx.restore();
    IY += 22;

    const CTL_Y    = IY + 16;
    const BTN_S    = 14;
    const btnColor = 'rgba(255,255,255,0.82)';
    const CENTER_X = IX + BAR_W / 2;

    const PBR = 26;

    ctx.save();
    ctx.beginPath(); ctx.arc(CENTER_X, CTL_Y, PBR + 8, 0, Math.PI * 2);
    ctx.fillStyle = rgbStr(vibrant, 0.15);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.arc(CENTER_X, CTL_Y, PBR, 0, Math.PI * 2);
    const playGrad = ctx.createRadialGradient(CENTER_X - 4, CTL_Y - 4, 2, CENTER_X, CTL_Y, PBR);
    playGrad.addColorStop(0, rgbStr(lerpColor(vibrant, {r:255,g:255,b:255}, 0.30)));
    playGrad.addColorStop(1, rgbStr(vibrant));
    ctx.fillStyle   = playGrad;
    ctx.shadowColor = rgbStr(vibrant, 0.80);
    ctx.shadowBlur  = 28;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.arc(CENTER_X, CTL_Y, PBR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();

    iconPlay(ctx, CENTER_X, CTL_Y, PBR * 0.56, '#fff');

    iconPrev(ctx, CENTER_X - 58, CTL_Y, BTN_S, btnColor);
    iconNext(ctx, CENTER_X + 58, CTL_Y, BTN_S, btnColor);
    iconShuffle(ctx, CENTER_X - 108, CTL_Y, BTN_S * 0.92, rgbStr(vibrant, 0.72));
    iconRepeat(ctx, CENTER_X + 108,  CTL_Y, BTN_S * 0.92, rgbStr(vibrant, 0.72));

    const VOL_Y = CTL_Y + 40;
    const VOL_X = IX;
    const VOL_W = BAR_W;
    const VOL_H = 4;

    ctx.save();
    ctx.shadowColor = rgbStr(vibrant, 0.30);
    ctx.shadowBlur  = 8;
    iconVolume(ctx, VOL_X + 12, VOL_Y + VOL_H / 2, 11, 'rgba(255,255,255,0.42)');
    ctx.restore();

    drawVolumeBar(
        ctx,
        VOL_X + 30,
        VOL_Y,
        VOL_W - 50,
        VOL_H,
        volPct,
        rgbStr(vibrant),
        'rgba(255,255,255,0.15)',
        2
    );

    const volThumbX = VOL_X + 30 + (VOL_W - 50) * volPct;
    ctx.save();
    ctx.beginPath(); ctx.arc(volThumbX, VOL_Y + VOL_H / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle   = '#fff';
    ctx.shadowColor = rgbStr(vibrant, 0.60);
    ctx.shadowBlur  = 8;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.font = '10px sans-serif';
    ctx.fillStyle    = 'rgba(255,255,255,0.32)';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(volume)}%`, IX + BAR_W, VOL_Y + VOL_H / 2);
    ctx.restore();

    return canvas.toBuffer('image/png');
}

module.exports = { createNowPlayingCard };
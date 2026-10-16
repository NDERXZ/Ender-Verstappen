'use strict';

const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const W = 1080, H = 1920;

const BG_DIR     = path.join(process.cwd(), 'assets', 'image', 'canvas', 'fakeig');
const PP_FALLBACK = path.join(process.cwd(), 'assets', 'profile.jpg');

const IG_RING  = ['#f09433','#e6683c','#dc2743','#cc2366','#bc1888'];
const TT_RING  = ['#69C9D0','#EE1D52'];

const POST_PALS = [
    ['#1a1a2e','#16213e'],['#0f3460','#533483'],['#1b1b2f','#2d4a22'],
    ['#2c2c54','#474787'],['#1e272e','#485460'],['#2d3436','#636e72'],
    ['#1e3799','#0c2461'],['#192a56','#2c3e50'],['#1a1a1a','#2d2d2d'],
];

const HL_COLORS = [
    ['#833ab4','#fd1d1d','#fcb045'],
    ['#405de6','#5851db','#833ab4'],
    ['#f77737','#fcb045','#ffdc80'],
    ['#fd1d1d','#e1306c','#833ab4'],
    ['#12c2e9','#c471ed','#f64f59'],
    ['#43cea2','#185a9d'],
];

async function _fetch(url) {
    return new Promise((res, rej) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: 12000 }, (r) => {
            if (r.statusCode === 301 || r.statusCode === 302) {
                req.destroy(); return _fetch(r.headers.location).then(res).catch(rej);
            }
            if (r.statusCode !== 200) { req.destroy(); return rej(new Error('HTTP '+r.statusCode)); }
            const ch = []; r.on('data', c => ch.push(c)); r.on('end', () => res(Buffer.concat(ch))); r.on('error', rej);
        });
        req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('Timeout')); });
    });
}

async function _loadImg(src) {
    const { loadImage } = require('skia-canvas');
    if (!src) return null;
    try {
        if (Buffer.isBuffer(src) && src.length > 1000) return await loadImage(src);
        if (typeof src === 'string' && /^https?:\/\//.test(src)) {
            const buf = await _fetch(src);
            if (buf && buf.length > 2000) return await loadImage(buf);
            return null;
        }
        if (typeof src === 'string' && fs.existsSync(src)) return await loadImage(fs.readFileSync(src));
    } catch {}
    return null;
}

function _getBgPath() {
    if (!fs.existsSync(BG_DIR)) return null;
    const files = fs.readdirSync(BG_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (!files.length) return null;
    return path.join(BG_DIR, files[0]);
}

async function _getAvatar(src) {
    let img = await _loadImg(src);
    if (img) return img;
    if (fs.existsSync(PP_FALLBACK)) {
        img = await _loadImg(PP_FALLBACK);
        if (img) return img;
    }
    const { Canvas } = require('skia-canvas');
    const fc = new Canvas(200, 200); const fx = fc.getContext('2d');
    const g = fx.createRadialGradient(100, 80, 10, 100, 100, 100);
    g.addColorStop(0, '#555'); g.addColorStop(1, '#222');
    fx.fillStyle = g; fx.beginPath(); fx.arc(100, 100, 100, 0, Math.PI*2); fx.fill();
    fx.fillStyle = 'rgba(255,255,255,0.55)';
    fx.beginPath(); fx.arc(100, 70, 35, 0, Math.PI*2); fx.fill();
    fx.beginPath(); fx.ellipse(100, 150, 55, 42, 0, Math.PI, 0, true); fx.fill();
    return await _loadImg(await fc.toBuffer('png'));
}

async function _getPostImg(src, idx) {
    const img = await _loadImg(src);
    if (img) return img;
    const { Canvas } = require('skia-canvas');
    const fc = new Canvas(300, 300); const fx = fc.getContext('2d');
    const p = POST_PALS[idx % POST_PALS.length];
    const g = fx.createLinearGradient(0, 0, 300, 300);
    g.addColorStop(0, p[0]); g.addColorStop(1, p[1]);
    fx.fillStyle = g; fx.fillRect(0, 0, 300, 300);
    return await _loadImg(await fc.toBuffer('png'));
}

function _circleClip(ctx, img, cx, cy, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.clip();
    const sc = Math.max((r*2)/img.width, (r*2)/img.height);
    const dx = cx - img.width*sc/2, dy = cy - img.height*sc/2;
    ctx.drawImage(img, dx, dy, img.width*sc, img.height*sc);
    ctx.restore();
}

function _coverRect(ctx, img, x, y, w, h) {
    ctx.save();
    const ir = img.width/img.height, cr = w/h;
    let dw, dh, dx, dy;
    if (ir > cr) { dh=h; dw=dh*ir; dx=x-(dw-w)/2; dy=y; }
    else { dw=w; dh=dw/ir; dx=x; dy=y-(dh-h)/2; }
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
}

function _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
}

function _wrapLines(ctx, txt, maxW, maxLines) {
    const words = txt.split(' '), lines = []; let cur = '';
    for (const w of words) {
        const test = cur ? cur+' '+w : w;
        if (ctx.measureText(test).width > maxW && cur) {
            lines.push(cur); cur = w;
            if (lines.length >= maxLines) break;
        } else cur = test;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length === maxLines) {
        let last = lines[maxLines-1];
        while (ctx.measureText(last+'…').width > maxW && last.length > 0) last = last.slice(0,-1);
        lines[maxLines-1] = last + '…';
    }
    return lines;
}

function fmtN(n) {
    const v = Number(n)||0;
    if (v >= 1e9) return (v/1e9).toFixed(1).replace('.0','')+' M';
    if (v >= 1e6) return (v/1e6).toFixed(1).replace('.0','')+' Jt';
    if (v >= 1e3) return (v/1e3).toFixed(1).replace('.0','')+' rb';
    return String(v);
}

function _igRing(ctx, cx, cy, r, cols) {
    ctx.save();
    const g = ctx.createLinearGradient(cx-r, cy-r, cx+r, cy+r);
    cols.forEach((c,i) => g.addColorStop(i/(cols.length-1), c));
    ctx.beginPath(); ctx.arc(cx, cy, r+4, 0, Math.PI*2);
    ctx.strokeStyle = g; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r+1.5, 0, Math.PI*2);
    ctx.strokeStyle = '#121212'; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
}

function _verifiedBadge(ctx, cx, cy, size) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, size, 0, Math.PI*2);
    ctx.fillStyle = '#3897f0'; ctx.fill();
    ctx.strokeStyle = 'white'; ctx.lineWidth = size*0.17; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - size*0.45, cy);
    ctx.lineTo(cx - size*0.08, cy + size*0.38);
    ctx.lineTo(cx + size*0.46, cy - size*0.36);
    ctx.stroke();
    ctx.restore();
}

function _iconBack(ctx, x, y) {
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x+16, y-12); ctx.lineTo(x, y); ctx.lineTo(x+16, y+12); ctx.stroke();
    ctx.restore();
}

function _iconBell(ctx, cx, cy, s) {
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#121212'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.bezierCurveTo(cx + s, cy - s, cx + s, cy - s*0.3, cx + s, cy + s*0.3);
    ctx.lineTo(cx + s*0.5, cy + s*0.5);
    ctx.lineTo(cx - s*0.5, cy + s*0.5);
    ctx.lineTo(cx - s, cy + s*0.3);
    ctx.bezierCurveTo(cx - s, cy - s*0.3, cx - s, cy - s, cx, cy - s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy + s*0.7, s*0.26, 0, Math.PI*2);
    ctx.strokeStyle='#fff'; ctx.stroke();
    ctx.restore();
}

function _iconMore(ctx, cx, cy) {
    ctx.save(); ctx.fillStyle = '#fff';
    [-12,0,12].forEach(dx => { ctx.beginPath(); ctx.arc(cx+dx, cy, 3, 0, Math.PI*2); ctx.fill(); });
    ctx.restore();
}

function _iconGrid(ctx, cx, cy, s, active) {
    ctx.save(); ctx.strokeStyle = active?'#fff':'rgba(255,255,255,0.45)'; ctx.lineWidth = active?2.5:2;
    const g = s*0.35, gs = s*0.28;
    for (let r=0;r<3;r++) for (let c=0;c<3;c++) {
        _rrect(ctx, cx-s+c*(g+gs), cy-s+r*(g+gs), g, g, 1.5); ctx.stroke();
    }
    ctx.restore();
}

function _iconReels(ctx, cx, cy, s, active) {
    ctx.save(); ctx.strokeStyle = active?'#fff':'rgba(255,255,255,0.45)'; ctx.fillStyle = 'transparent'; ctx.lineWidth = active?2.5:2;
    _rrect(ctx, cx-s, cy-s, s*2, s*2, 5); ctx.stroke();
    ctx.fillStyle = active?'#fff':'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.moveTo(cx-s*0.35, cy-s*0.45); ctx.lineTo(cx+s*0.60, cy); ctx.lineTo(cx-s*0.35, cy+s*0.45); ctx.closePath(); ctx.fill();
    ctx.restore();
}

function _iconCollab(ctx, cx, cy, s, active) {
    ctx.save(); ctx.strokeStyle = active?'#fff':'rgba(255,255,255,0.45)'; ctx.lineWidth = active?2.5:2; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(cx, cy, s, 0, Math.PI*1.6); ctx.stroke();
    ctx.fillStyle = active?'#fff':'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.moveTo(cx+s*0.38, cy-s*0.62); ctx.lineTo(cx+s*0.90, cy-s*0.30); ctx.lineTo(cx+s*0.20, cy-s*0.28); ctx.closePath(); ctx.fill();
    ctx.restore();
}

function _iconTagged(ctx, cx, cy, s, active) {
    ctx.save(); ctx.strokeStyle = active?'#fff':'rgba(255,255,255,0.45)'; ctx.lineWidth = active?2.5:2;
    _rrect(ctx, cx-s*0.75, cy-s, s*1.5, s*2, 5); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy-s*0.20, s*0.38, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-s*0.38, cy+s*0.28); ctx.bezierCurveTo(cx-s*0.38, cy+s*0.70, cx+s*0.38, cy+s*0.70, cx+s*0.38, cy+s*0.28); ctx.stroke();
    ctx.restore();
}

async function _buildInstagram(opts) {
    const { Canvas } = require('skia-canvas');
    const {
        username    = 'username',
        displayName = 'Display Name',
        bio         = '',
        website     = '',
        verified    = false,
        category    = 'Digital creator',
        avatar      = null,
        posts       = [],
        stats       = { posts: 0, followers: 0, following: 0 }
    } = opts;

    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext('2d');

    const bgPath = _getBgPath();
    if (bgPath) {
        const bgImg = await _loadImg(bgPath);
        if (bgImg) {
            _coverRect(ctx, bgImg, 0, 0, W, H);
            ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, W, H);
        } else {
            ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, W, H);
        }
    } else {
        ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, W, H);
    }

    const DIV   = 'rgba(255,255,255,0.12)';
    const TEXT1 = '#ffffff';
    const TEXT2 = 'rgba(255,255,255,0.55)';
    const TEXT3 = 'rgba(255,255,255,0.35)';

    const statusH = 52;
    ctx.save();
    ctx.font = '500 26px sans-serif'; ctx.fillStyle = TEXT1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('9:41', W/2, statusH/2 + 2);
    ctx.fillStyle = TEXT1;
    [0,1,2,3].forEach(i => {
        const bh = 14 + i*3.5;
        ctx.globalAlpha = 0.4 + i*0.18;
        ctx.fillRect(W-108+i*14, statusH/2-bh/2+2, 9, bh);
    });
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(W-130, statusH/2+2, 7, 0, Math.PI*2);
    ctx.strokeStyle = TEXT1; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.fillRect(W-50, statusH/2-4+2, 28, 8);
    ctx.restore();

    const hdY = statusH, hdH = 72;
    _iconBack(ctx, 28, hdY + hdH/2);
    ctx.save();
    ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = TEXT1;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const unW = ctx.measureText(username).width;
    ctx.fillText(username, 88, hdY + hdH/2);
    if (verified) _verifiedBadge(ctx, 88 + unW + 16, hdY + hdH/2, 14);
    ctx.restore();
    _iconBell(ctx, W - 108, hdY + hdH/2, 18);
    _iconMore(ctx, W - 42, hdY + hdH/2);

    ctx.strokeStyle = DIV; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, hdY+hdH); ctx.lineTo(W, hdY+hdH); ctx.stroke();

    const profY = hdY + hdH + 28;
    const avCX  = 104, avCY = profY + 72, avR = 66;

    _igRing(ctx, avCX, avCY, avR, IG_RING);
    const avImg = await _getAvatar(avatar);
    _circleClip(ctx, avImg, avCX, avCY, avR);

    const statStartX = avCX + avR + 50;
    const statW      = (W - statStartX - 24) / 3;
    const statCY     = avCY;
    const statDefs   = [
        { val: stats.posts,     lbl: 'posts' },
        { val: stats.followers, lbl: 'followers' },
        { val: stats.following, lbl: 'following' },
    ];
    statDefs.forEach(({ val, lbl }, i) => {
        const sx = statStartX + i * statW + statW/2;
        ctx.save();
        ctx.font      = 'bold 34px sans-serif';
        ctx.fillStyle = TEXT1;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fmtN(val), sx, statCY - 14);
        ctx.font      = '24px sans-serif';
        ctx.fillStyle = TEXT2;
        ctx.fillText(lbl, sx, statCY + 18);
        ctx.restore();
    });

    let bioY = avCY + avR + 22;

    if (displayName) {
        ctx.save();
        ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = TEXT1;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(displayName, 28, bioY); bioY += 38;
        ctx.restore();
    }

    if (category) {
        ctx.save();
        ctx.font = '24px sans-serif'; ctx.fillStyle = TEXT3;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(category, 28, bioY); bioY += 34;
        ctx.restore();
    }

    if (bio) {
        ctx.save();
        ctx.font = '26px sans-serif'; ctx.fillStyle = TEXT1;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const lines = _wrapLines(ctx, bio, W - 56, 3);
        lines.forEach(l => { ctx.fillText(l, 28, bioY); bioY += 36; });
        ctx.restore();
    }

    if (website) {
        ctx.save();
        ctx.font = '26px sans-serif'; ctx.fillStyle = '#a8d8f0';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(website, 28, bioY); bioY += 36;
        ctx.restore();
    }

    bioY += 10;

    const btnH = 62, btnY = bioY, btnGap = 14;
    const btnW1 = Math.floor((W - 56 - btnGap * 2 - 62) / 2);

    _rrect(ctx, 28, btnY, btnW1, btnH, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
    _rrect(ctx, 28, btnY, btnW1, btnH, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();

    const gFol = ctx.createLinearGradient(28, btnY, 28+btnW1, btnY+btnH);
    gFol.addColorStop(0, '#405de6'); gFol.addColorStop(0.5, '#833ab4'); gFol.addColorStop(1, '#fd1d1d');
    ctx.save();
    ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = gFol;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Following ▾', 28 + btnW1/2, btnY + btnH/2);
    ctx.restore();

    const btn2X = 28 + btnW1 + btnGap;
    _rrect(ctx, btn2X, btnY, btnW1, btnH, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
    _rrect(ctx, btn2X, btnY, btnW1, btnH, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save();
    ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = TEXT1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Message', btn2X + btnW1/2, btnY + btnH/2);
    ctx.restore();

    const btn3X = btn2X + btnW1 + btnGap;
    _rrect(ctx, btn3X, btnY, 62, btnH, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
    _rrect(ctx, btn3X, btnY, 62, btnH, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save();
    ctx.strokeStyle = TEXT1; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    const pX = btn3X + 31, pY = btnY + btnH/2;
    ctx.beginPath(); ctx.arc(pX, pY-2, 9, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(pX, pY+14, 14, 9, 0, Math.PI, 0, true); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pX+13, pY-8); ctx.lineTo(pX+18, pY-13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pX+15, pY-13); ctx.lineTo(pX+15, pY-6); ctx.lineTo(pX+8, pY-6); ctx.stroke();
    ctx.restore();

    bioY = btnY + btnH + 26;

    const hlLabels = ['Highlight','Travel','Food','Style','Moments','Daily'];
    const hlR = 48, hlGap = 24;
    const hlTotalW = hlLabels.length*(hlR*2+hlGap) - hlGap;
    let hlX = 28;
    for (let i = 0; i < Math.min(hlLabels.length, 6); i++) {
        const cx = hlX + hlR;
        const pal = HL_COLORS[i % HL_COLORS.length];
        const g2 = ctx.createLinearGradient(cx-hlR, bioY+hlR, cx+hlR, bioY+hlR*2);
        pal.forEach((c,j) => g2.addColorStop(j/(pal.length-1), c));
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, bioY+hlR, hlR+3.5, 0, Math.PI*2);
        ctx.strokeStyle = g2; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, bioY+hlR, hlR+1, 0, Math.PI*2);
        ctx.strokeStyle = '#121212'; ctx.lineWidth = 3; ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.beginPath(); ctx.arc(cx, bioY+hlR, hlR, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();

        const ems = ['🌟','✈️','🍜','👗','📸','☀️'];
        ctx.save();
        ctx.font = `${hlR*0.72}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(ems[i], cx, bioY+hlR);
        ctx.restore();

        const lbl = hlLabels[i].length > 7 ? hlLabels[i].slice(0,6)+'…' : hlLabels[i];
        ctx.save();
        ctx.font = '20px sans-serif'; ctx.fillStyle = TEXT2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(lbl, cx, bioY + hlR*2 + 10);
        ctx.restore();

        hlX += hlR*2 + hlGap;
    }

    bioY += hlR*2 + 46;

    ctx.strokeStyle = DIV; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, bioY); ctx.lineTo(W, bioY); ctx.stroke();

    const tabH = 80, tabY = bioY;
    const tabDefs = [
        { fn: _iconGrid,   active: true  },
        { fn: _iconReels,  active: false },
        { fn: _iconCollab, active: false },
        { fn: _iconTagged, active: false },
    ];
    tabDefs.forEach(({ fn, active }, i) => {
        const tx = W/8 + i*(W/4);
        fn(ctx, tx, tabY + tabH/2, 20, active);
        if (active) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(tx - 32, tabY + tabH - 4, 64, 3);
        }
    });

    bioY = tabY + tabH;

    ctx.strokeStyle = DIV; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, bioY); ctx.lineTo(W, bioY); ctx.stroke();

    const gridCols  = 3;
    const gap       = 3;
    const cellW     = Math.floor((W - gap*(gridCols-1)) / gridCols);
    const cellH     = cellW;
    const maxRows   = Math.ceil((H - bioY) / cellH) + 1;
    const totalPost = maxRows * gridCols;

    const postImgs = await Promise.all(
        Array.from({ length: totalPost }, (_, i) => _getPostImg(posts[i] || null, i))
    );

    for (let i = 0; i < totalPost; i++) {
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);
        const px  = col * (cellW + gap);
        const py  = bioY + row * (cellH + gap);
        if (py >= H) break;
        _coverRect(ctx, postImgs[i], px, py, cellW, Math.min(cellH, H - py));
    }

    return canvas.toBuffer('jpeg', { quality: 0.96 });
}

async function _buildTikTok(opts) {
    const { Canvas } = require('skia-canvas');
    const {
        username    = 'username',
        displayName = 'Display Name',
        bio         = '',
        website     = '',
        verified    = false,
        avatar      = null,
        posts       = [],
        stats       = { following: 0, followers: 0, likes: 0 }
    } = opts;

    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext('2d');

    const bgPath = _getBgPath();
    if (bgPath) {
        const bgImg = await _loadImg(bgPath);
        if (bgImg) {
            _coverRect(ctx, bgImg, 0, 0, W, H);
            ctx.fillStyle = 'rgba(0,0,0,0.70)'; ctx.fillRect(0, 0, W, H);
        } else { ctx.fillStyle = '#161823'; ctx.fillRect(0, 0, W, H); }
    } else { ctx.fillStyle = '#161823'; ctx.fillRect(0, 0, W, H); }

    const TEXT1 = '#ffffff', TEXT2 = 'rgba(255,255,255,0.55)', DIV = 'rgba(255,255,255,0.12)';

    const statusH = 52;
    ctx.save();
    ctx.font = '500 26px sans-serif'; ctx.fillStyle = TEXT1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('9:41', W/2, statusH/2 + 2);
    ctx.restore();

    const hdY = statusH, hdH = 80;
    _iconBack(ctx, 28, hdY + hdH/2);
    ctx.save();
    ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = TEXT1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(username, W/2, hdY + hdH/2);
    ctx.restore();
    _iconMore(ctx, W - 42, hdY + hdH/2);
    ctx.save(); ctx.strokeStyle = TEXT1; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(W-100, hdY+hdH/2-14); ctx.lineTo(W-86, hdY+hdH/2); ctx.lineTo(W-100, hdY+hdH/2+14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W-86, hdY+hdH/2); ctx.lineTo(W-68, hdY+hdH/2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W-60, hdY+hdH/2, 10, 0, Math.PI*2); ctx.stroke();
    ctx.restore();

    const avCX = W/2, avCY = hdY + hdH + 94, avR = 80;
    _igRing(ctx, avCX, avCY, avR, TT_RING);
    const avImg = await _getAvatar(avatar);
    _circleClip(ctx, avImg, avCX, avCY, avR);
    if (verified) _verifiedBadge(ctx, avCX + avR*0.74, avCY + avR*0.74, 18);

    let tyCur = avCY + avR + 28;

    ctx.save();
    ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = TEXT2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('@' + username, W/2, tyCur); tyCur += 42;
    ctx.restore();

    const statGap = W/3;
    [['Mengikuti', stats.following],['Pengikut', stats.followers],['Suka', stats.likes]].forEach(([lbl, val], i) => {
        const sx = statGap*0.5 + i*statGap;
        ctx.save();
        ctx.font = 'bold 38px sans-serif'; ctx.fillStyle = TEXT1;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(fmtN(val), sx, tyCur);
        ctx.font = '22px sans-serif'; ctx.fillStyle = TEXT2;
        ctx.fillText(lbl, sx, tyCur + 48);
        ctx.restore();
    });
    tyCur += 88;

    if (displayName) {
        ctx.save(); ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = TEXT1;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(displayName, W/2, tyCur); tyCur += 42; ctx.restore();
    }
    if (bio) {
        ctx.save(); ctx.font = '26px sans-serif'; ctx.fillStyle = TEXT2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const lines = _wrapLines(ctx, bio, W-100, 3);
        lines.forEach(l => { ctx.fillText(l, W/2, tyCur); tyCur += 36; });
        ctx.restore(); tyCur += 4;
    }
    if (website) {
        ctx.save(); ctx.font = '26px sans-serif'; ctx.fillStyle = '#20D5EC';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(website, W/2, tyCur); tyCur += 36; ctx.restore();
    }

    tyCur += 18;

    const bW = 340, bH = 66, bGap = 18;
    const bTotalW = bW*2 + bGap, bStartX = (W-bTotalW)/2;

    const ttG = ctx.createLinearGradient(bStartX, tyCur, bStartX+bW, tyCur+bH);
    ttG.addColorStop(0, '#EE1D52'); ttG.addColorStop(1, '#69C9D0');
    _rrect(ctx, bStartX, tyCur, bW, bH, 10);
    ctx.fillStyle = ttG; ctx.fill();
    ctx.save(); ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = TEXT1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Ikuti', bStartX+bW/2, tyCur+bH/2); ctx.restore();

    _rrect(ctx, bStartX+bW+bGap, tyCur, bW, bH, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.save(); ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = TEXT1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Pesan', bStartX+bW+bGap+bW/2, tyCur+bH/2); ctx.restore();

    tyCur += bH + 30;

    ctx.strokeStyle = DIV; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, tyCur); ctx.lineTo(W, tyCur); ctx.stroke();

    const tabH = 80, tabY = tyCur;
    const ttTabs = ['⊞','❤️','🔒'];
    ttTabs.forEach((t, i) => {
        const tx = W/6 + i*(W/3);
        ctx.save(); ctx.font = '38px sans-serif';
        ctx.fillStyle = i===0?TEXT1:'rgba(255,255,255,0.40)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(t, tx, tabY + tabH/2); ctx.restore();
        if (i===0) { ctx.fillStyle = TEXT1; ctx.fillRect(tx-36, tabY+tabH-4, 72, 3); }
    });

    tyCur = tabY + tabH;
    ctx.strokeStyle = DIV; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, tyCur); ctx.lineTo(W, tyCur); ctx.stroke();

    const gridCols = 3, gridGap = 3;
    const cellW    = Math.floor((W - gridGap*(gridCols-1)) / gridCols);
    const cellH    = Math.round(cellW * 1.35);
    const maxRows  = Math.ceil((H - tyCur) / cellH) + 1;
    const totalPost = maxRows * gridCols;

    const postImgs = await Promise.all(
        Array.from({ length: totalPost }, (_, i) => _getPostImg(posts[i]||null, i))
    );

    for (let i = 0; i < totalPost; i++) {
        const col = i%gridCols, row = Math.floor(i/gridCols);
        const px  = col*(cellW+gridGap), py = tyCur + row*(cellH+gridGap);
        if (py >= H) break;
        _coverRect(ctx, postImgs[i], px, py, cellW, Math.min(cellH, H-py));
        ctx.save(); ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 8;
        ctx.fillText('▶ '+(Math.floor(Math.random()*900+100))+'rb', px+12, Math.min(py+cellH, H)-12);
        ctx.shadowBlur = 0; ctx.restore();
    }

    return canvas.toBuffer('jpeg', { quality: 0.96 });
}

async function createFakeProfile(opts = {}) {
    const platform = (opts.platform || 'instagram').toLowerCase();
    if (platform === 'tiktok' || platform === 'tt') return _buildTikTok(opts);
    return _buildInstagram(opts);
}

module.exports = { createFakeProfile };

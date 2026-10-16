'use strict';

const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const PP_FALLBACK = path.join(process.cwd(), 'assets', 'profile.jpg');

const W = 800;
const H = 1200;

const GENRES = {
    action: {
        label:      'ACTION',
        taglines:   [
            'ONE PERSON. ONE MISSION. NO MERCY.',
            'THEY TOOK EVERYTHING. BIG MISTAKE.',
            'SOME WARS CHOOSE YOU.',
            'THE LAST STAND BEGINS.',
            'BORN TO FIGHT. TRAINED TO WIN.',
            'JUSTICE HAS A NEW NAME.',
        ],
        ratings:    ['PG-13','R','R','PG-13'],
        studios:    ['PARAMOUNT PICTURES','WARNER BROS.','UNIVERSAL PICTURES','COLUMBIA PICTURES'],
        bg:         { from: '#0A0A0A', via: '#1A0800', to: '#0A0A0A' },
        accent:     '#FF4500',
        accent2:    '#FF8C00',
        textColor:  '#FFFFFF',
        subColor:   '#FF8C00',
        glowColor:  'rgba(255,69,0,0.55)',
        titleStyle: 'impact',
        particles:  'sparks',
    },
    thriller: {
        label:      'THRILLER',
        taglines:   [
            'THE TRUTH WILL KILL YOU.',
            'NO ONE IS INNOCENT.',
            'TRUST NO ONE. FEAR EVERYONE.',
            'SOME SECRETS SHOULD STAY BURIED.',
            'THE CLOSER YOU GET, THE DARKER IT BECOMES.',
            'EVERYONE IS A SUSPECT.',
        ],
        ratings:    ['R','R','PG-13'],
        studios:    ['LIONSGATE','A24','FOCUS FEATURES','MIRAMAX'],
        bg:         { from: '#050505', via: '#0A0A14', to: '#050505' },
        accent:     '#4040C0',
        accent2:    '#8080FF',
        textColor:  '#E8E8FF',
        subColor:   '#8888CC',
        glowColor:  'rgba(80,80,200,0.45)',
        titleStyle: 'serif',
        particles:  'none',
    },
    romance: {
        label:      'ROMANCE',
        taglines:   [
            'SOME LOVE STORIES DEFY ALL ODDS.',
            'WHEN FATE WRITES THE LAST CHAPTER.',
            'LOVE FINDS A WAY. ALWAYS.',
            'A LOVE TOO POWERFUL TO IGNORE.',
            'IN A WORLD FULL OF NOISE, THERE WAS YOU.',
            'FOREVER STARTS WITH ONE MOMENT.',
        ],
        ratings:    ['PG','PG-13','PG'],
        studios:    ['COLUMBIA PICTURES','UNIVERSAL PICTURES','TOUCHSTONE','MIRAMAX'],
        bg:         { from: '#120008', via: '#1A0010', to: '#080008' },
        accent:     '#FF69B4',
        accent2:    '#FFB6C1',
        textColor:  '#FFE4E8',
        subColor:   '#FF9DB0',
        glowColor:  'rgba(255,105,180,0.45)',
        titleStyle: 'serif',
        particles:  'petals',
    },
    scifi: {
        label:      'SCI-FI',
        taglines:   [
            'THE FUTURE IS NOT WHAT YOU THINK.',
            'BEYOND THE STARS LIES THE TRUTH.',
            'HUMANITY\'S LAST HOPE.',
            'THE UNIVERSE HAS CHOSEN.',
            'WHEN WORLDS COLLIDE, HEROES ARE BORN.',
            'FIRST CONTACT. LAST CHANCE.',
        ],
        ratings:    ['PG-13','PG-13','R'],
        studios:    ['20TH CENTURY STUDIOS','PARAMOUNT PICTURES','WARNER BROS.','UNIVERSAL'],
        bg:         { from: '#000814', via: '#001428', to: '#000814' },
        accent:     '#00D4FF',
        accent2:    '#00FFCC',
        textColor:  '#D0F8FF',
        subColor:   '#00B8E0',
        glowColor:  'rgba(0,212,255,0.45)',
        titleStyle: 'impact',
        particles:  'stars',
    },
    horror: {
        label:      'HORROR',
        taglines:   [
            'DARKNESS HAS FOUND YOU.',
            'IT KNOWS YOUR NAME.',
            'EVIL NEVER SLEEPS.',
            'YOU CANNOT OUTRUN THE DARK.',
            'WHEN NIGHT FALLS, IT COMES.',
            'PRAY YOU ARE NOT NEXT.',
        ],
        ratings:    ['R','R','R','PG-13'],
        studios:    ['BLUMHOUSE','A24','UNIVERSAL','LIONSGATE'],
        bg:         { from: '#050005', via: '#0A0005', to: '#050005' },
        accent:     '#8B0000',
        accent2:    '#DC143C',
        textColor:  '#FFEEEE',
        subColor:   '#CC4444',
        glowColor:  'rgba(139,0,0,0.55)',
        titleStyle: 'impact',
        particles:  'blood',
    },
    comedy: {
        label:      'COMEDY',
        taglines:   [
            'GET READY TO LAUGH. AND THEN LAUGH MORE.',
            'LIFE IS TOO SHORT TO BE SERIOUS.',
            'THE WORLD\'S FUNNIEST PROBLEM.',
            'NOTHING GOES ACCORDING TO PLAN. EVER.',
            'WHEN THINGS GO WRONG, GO LAUGHING.',
            'THE ACCIDENTAL ADVENTURE OF A LIFETIME.',
        ],
        ratings:    ['PG','PG-13','PG','PG-13'],
        studios:    ['COLUMBIA PICTURES','UNIVERSAL','TOUCHSTONE','NEW LINE CINEMA'],
        bg:         { from: '#0A0800', via: '#141000', to: '#0A0800' },
        accent:     '#FFD700',
        accent2:    '#FFA500',
        textColor:  '#FFFFF0',
        subColor:   '#FFD700',
        glowColor:  'rgba(255,215,0,0.40)',
        titleStyle: 'impact',
        particles:  'confetti',
    },
};

function _rng(s) {
    let v = Math.abs(s) || 42;
    return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; };
}

async function _fetch(url) {
    return new Promise((res, rej) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: 12000 }, (r) => {
            if (r.statusCode === 301 || r.statusCode === 302) { req.destroy(); return _fetch(r.headers.location).then(res).catch(rej); }
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
        if (Buffer.isBuffer(src) && src.length > 800) return await loadImage(src);
        if (typeof src === 'string' && /^https?:\/\//.test(src)) {
            const buf = await _fetch(src);
            if (buf && buf.length > 1500) return await loadImage(buf);
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
    const fc = new Canvas(400, 600), fx = fc.getContext('2d');
    const g = fx.createLinearGradient(0, 0, 400, 600);
    g.addColorStop(0, '#2A2020'); g.addColorStop(1, '#080808');
    fx.fillStyle = g; fx.fillRect(0, 0, 400, 600);
    fx.fillStyle = 'rgba(255,255,255,0.25)';
    fx.beginPath(); fx.arc(200, 180, 75, 0, Math.PI * 2); fx.fill();
    fx.beginPath(); fx.ellipse(200, 420, 130, 90, 0, Math.PI, 0, true); fx.fill();
    return await _loadImg(await fc.toBuffer('image/png'));
}

function _wrapText(ctx, text, maxW) {
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) {
        const test = cur ? cur+' '+w : w;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
        else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
}

function _coverFill(ctx, img, x, y, w, h) {
    const ir = img.width / img.height, cr = w / h;
    let dw, dh, dx, dy;
    if (ir > cr) { dh = h; dw = dh * ir; dx = x-(dw-w)/2; dy = y; }
    else { dw = w; dh = dw / ir; dx = x; dy = y-(dh-h)/2; }
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
}

function _drawParticles(ctx, type, rng) {
    if (type === 'stars') {
        for (let i = 0; i < 200; i++) {
            const x = rng() * W, y = rng() * H * 0.75;
            const r = rng() * 1.8 + 0.2;
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${rng() * 0.7 + 0.1})`; ctx.fill();
        }
        for (let i = 0; i < 15; i++) {
            const x = rng() * W, y = rng() * H * 0.65;
            const r = rng() * 3.5 + 1;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
            g.addColorStop(0, 'rgba(200,230,255,0.9)'); g.addColorStop(1, 'rgba(200,230,255,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, Math.PI * 2); ctx.fill();
        }
    } else if (type === 'sparks') {
        for (let i = 0; i < 40; i++) {
            const x = rng() * W, y = rng() * H * 0.8;
            const len = rng() * 30 + 5;
            const a = rng() * Math.PI * 2;
            ctx.save(); ctx.strokeStyle = `rgba(255,${Math.floor(rng()*100+100)},0,${rng()*0.5+0.1})`;
            ctx.lineWidth = rng() * 2 + 0.5; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a)*len, y + Math.sin(a)*len);
            ctx.stroke(); ctx.restore();
        }
    } else if (type === 'petals') {
        for (let i = 0; i < 30; i++) {
            const x = rng() * W, y = rng() * H * 0.75;
            const s = rng() * 14 + 4;
            ctx.save(); ctx.translate(x, y); ctx.rotate(rng() * Math.PI * 2);
            ctx.fillStyle = `rgba(255,${Math.floor(rng()*60+160)},${Math.floor(rng()*60+160)},${rng()*0.4+0.1})`;
            ctx.beginPath(); ctx.ellipse(0, 0, s/2, s, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
    } else if (type === 'confetti') {
        const cols = ['#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF6BFF'];
        for (let i = 0; i < 50; i++) {
            const x = rng() * W, y = rng() * H * 0.7;
            const s = rng() * 10 + 3;
            ctx.save(); ctx.translate(x, y); ctx.rotate(rng() * Math.PI * 2);
            ctx.fillStyle = cols[Math.floor(rng() * cols.length)] + Math.floor(rng()*100+60).toString(16);
            ctx.fillRect(-s/2, -s/4, s, s/2);
            ctx.restore();
        }
    }
}

function _drawLensFlare(ctx, cx, cy, accent) {
    const r = hex2rgb(accent);
    [250, 160, 90, 50, 25].forEach((size, i) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size);
        g.addColorStop(0, `rgba(${r.r},${r.g},${r.b},${0.25 - i * 0.04})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, size, 0, Math.PI * 2); ctx.fill();
    });
    [0, 30, 60, 90, 120, 150].forEach(angle => {
        const rad = angle * Math.PI / 180;
        const len = 200 + Math.sin(rad * 3) * 80;
        const g2 = ctx.createLinearGradient(cx, cy, cx + Math.cos(rad) * len, cy + Math.sin(rad) * len);
        g2.addColorStop(0, `rgba(${r.r},${r.g},${r.b},0.18)`);
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save(); ctx.strokeStyle = g2; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(rad) * len, cy + Math.sin(rad) * len);
        ctx.lineTo(cx + Math.cos(rad + Math.PI) * len * 0.6, cy + Math.sin(rad + Math.PI) * len * 0.6);
        ctx.stroke(); ctx.restore();
    });
}

function hex2rgb(hex) {
    const h = hex.replace('#', '');
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}

function _drawFilmStrip(ctx, y, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.88)'; ctx.fillRect(0, y, W, h);
    const holes = 14, holeW = 18, holeH = 12, holeGap = (W - holes * holeW) / (holes + 1);
    ctx.fillStyle = '#1A1A1A';
    for (let i = 0; i < holes; i++) {
        const hx = holeGap + i * (holeW + holeGap), hy = y + (h - holeH) / 2;
        ctx.beginPath(); ctx.roundRect(hx, hy, holeW, holeH, 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y + h); ctx.lineTo(W, y + h); ctx.stroke();
}

function _drawRatingBox(ctx, rating, x, y, accent) {
    const bw = 48, bh = 28;
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.70)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, bw, bh);
    ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(rating, x + bw / 2, y + bh / 2);
}

function _drawStars(ctx, score, x, y, accent) {
    const full = Math.floor(score), half = score % 1 >= 0.5 ? 1 : 0;
    const starW = 18;
    for (let i = 0; i < 5; i++) {
        const sx = x + i * (starW + 3), sy = y;
        ctx.font = `${starW}px sans-serif`; ctx.textBaseline = 'top';
        if (i < full) { ctx.fillStyle = accent; ctx.fillText('★', sx, sy); }
        else if (i === full && half) { ctx.fillStyle = accent; ctx.fillText('½', sx + 2, sy); }
        else { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillText('★', sx, sy); }
    }
}

function _makeTitleArt(ctx, title, genre, centerX, topY, maxW, accent, accent2, textColor) {
    const words = title.toUpperCase().split(' ');
    let totalH = 0;
    const isImpact = genre.titleStyle === 'impact';

    if (words.length === 1 || (words.length === 2 && words.join(' ').length <= 12)) {
        const fullTitle = words.join(' ');
        let fs = 110;
        ctx.font = `900 ${fs}px ${isImpact ? 'Impact,Arial Black,sans-serif' : 'Georgia,serif'}`;
        while (ctx.measureText(fullTitle).width > maxW && fs > 40) { fs -= 3; ctx.font = `900 ${fs}px ${isImpact ? 'Impact,Arial Black,sans-serif' : 'Georgia,serif'}`; }

        ctx.save();
        ctx.shadowColor = accent; ctx.shadowBlur = 40; ctx.shadowOffsetY = 6;
        ctx.fillStyle = textColor; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(fullTitle, centerX, topY);
        ctx.shadowBlur = 0; ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
        ctx.strokeText(fullTitle, centerX, topY);
        ctx.restore();
        totalH = fs * 1.05;
    } else {
        let curY = topY;
        words.forEach((word, i) => {
            let fs = 90;
            ctx.font = `900 ${fs}px ${isImpact ? 'Impact,Arial Black,sans-serif' : 'Georgia,serif'}`;
            while (ctx.measureText(word).width > maxW && fs > 30) { fs -= 2; ctx.font = `900 ${fs}px ${isImpact ? 'Impact,Arial Black,sans-serif' : 'Georgia,serif'}`; }

            ctx.save();
            const gd = ctx.createLinearGradient(centerX - maxW/2, curY, centerX + maxW/2, curY + fs);
            gd.addColorStop(0, textColor); gd.addColorStop(0.5, accent2); gd.addColorStop(1, textColor);
            ctx.shadowColor = accent; ctx.shadowBlur = 30; ctx.shadowOffsetY = 5;
            ctx.fillStyle = gd; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(word, centerX, curY);
            ctx.shadowBlur = 0; ctx.strokeStyle = accent + '88'; ctx.lineWidth = 1;
            ctx.strokeText(word, centerX, curY);
            ctx.restore();
            curY += fs * 1.02;
            totalH += fs * 1.02;
        });
    }
    return totalH;
}

async function createMoviePoster(opts = {}) {
    const { Canvas } = require('skia-canvas');
    const {
        name      = 'User',
        title     = null,
        tagline   = null,
        genre     = 'action',
        photo     = null,
        costar    = null,
        year      = null,
        runtime   = null,
        rating    = null,
        director  = null,
    } = opts;

    const genreKey = genre.toLowerCase();
    const G = GENRES[genreKey] || GENRES.action;

    const seed = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const rng  = _rng(seed + 7919);

    const pick   = (arr) => arr[Math.floor(rng() * arr.length)];
    const movieTitle  = title   || name.toUpperCase();
    const movieTagline = tagline || pick(G.taglines);
    const movieRating  = rating  || pick(G.ratings);
    const studio       = pick(G.studios);
    const movieYear    = year    || new Date().getFullYear();
    const movieRuntime = runtime || (Math.floor(rng() * 60) + 90) + ' MIN';
    const movieDirector = director || 'A ' + name.toUpperCase() + ' FILM';
    const imdbScore    = (rng() * 2.5 + 6.5).toFixed(1);

    const [photoImg, costarImg] = await Promise.all([
        _getPhoto(photo),
        costar ? _getPhoto(costar) : Promise.resolve(null),
    ]);

    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext('2d');

    const bgG = ctx.createLinearGradient(0, 0, 0, H);
    bgG.addColorStop(0, G.bg.from);
    bgG.addColorStop(0.5, G.bg.via);
    bgG.addColorStop(1, G.bg.to);
    ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

    _drawParticles(ctx, G.particles, _rng(seed + 1337));

    const PHOTO_H = Math.round(H * 0.64);
    const PHOTO_Y = 0;

    if (photoImg) {
        const mask = new Canvas(W, PHOTO_H);
        const mctx = mask.getContext('2d');
        _coverFill(mctx, photoImg, 0, 0, W, PHOTO_H);

        const fade = mctx.createLinearGradient(0, PHOTO_H * 0.35, 0, PHOTO_H);
        fade.addColorStop(0, 'rgba(0,0,0,0)');
        fade.addColorStop(0.55, 'rgba(0,0,0,0.55)');
        fade.addColorStop(1, 'rgba(0,0,0,0.98)');
        mctx.fillStyle = fade; mctx.fillRect(0, 0, W, PHOTO_H);

        const sideFade = mctx.createLinearGradient(0, 0, W, 0);
        sideFade.addColorStop(0, 'rgba(0,0,0,0.45)');
        sideFade.addColorStop(0.2, 'rgba(0,0,0,0)');
        sideFade.addColorStop(0.8, 'rgba(0,0,0,0)');
        sideFade.addColorStop(1, 'rgba(0,0,0,0.45)');
        mctx.fillStyle = sideFade; mctx.fillRect(0, 0, W, PHOTO_H);

        ctx.drawImage(mask, 0, PHOTO_Y);
    }

    if (costarImg && photoImg) {
        const cs = new Canvas(W * 0.35, PHOTO_H * 0.65);
        const cctx = cs.getContext('2d');
        _coverFill(cctx, costarImg, 0, 0, cs.width, cs.height);
        const cfade = cctx.createLinearGradient(0, 0, cs.width, 0);
        cfade.addColorStop(0, 'rgba(0,0,0,0.85)');
        cfade.addColorStop(0.3, 'rgba(0,0,0,0)');
        cctx.fillStyle = cfade; cctx.fillRect(0, 0, cs.width, cs.height);
        const cfade2 = cctx.createLinearGradient(0, cs.height * 0.5, 0, cs.height);
        cfade2.addColorStop(0, 'rgba(0,0,0,0)');
        cfade2.addColorStop(1, 'rgba(0,0,0,0.9)');
        cctx.fillStyle = cfade2; cctx.fillRect(0, 0, cs.width, cs.height);
        ctx.drawImage(cs, 0, PHOTO_H * 0.15);
    }

    const flareX = photoImg ? W * 0.62 : W / 2;
    const flareY = photoImg ? PHOTO_H * 0.22 : H * 0.25;
    _drawLensFlare(ctx, flareX, flareY, G.accent);

    const STRIP_Y = Math.round(H * 0.05);
    _drawFilmStrip(ctx, STRIP_Y, 28);
    ctx.save(); ctx.font = 'bold 10px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(studio, W / 2, STRIP_Y + 14);
    ctx.restore();

    const LOGO_Y = STRIP_Y + 38;
    ctx.save();
    ctx.font = 'bold 11px monospace'; ctx.fillStyle = G.accent;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.globalAlpha = 0.75;
    ctx.fillText(movieDirector, W / 2, LOGO_Y);
    ctx.restore();

    const TITLE_AREA_TOP = Math.round(H * 0.60);
    const TITLE_MAX_W    = W - 60;

    const titleH = _makeTitleArt(
        ctx, movieTitle, G, W / 2, TITLE_AREA_TOP, TITLE_MAX_W,
        G.accent, G.accent2, G.textColor
    );

    const POST_TITLE_Y = TITLE_AREA_TOP + titleH + 10;

    ctx.save();
    ctx.font = `italic bold 15px Georgia,serif`;
    ctx.fillStyle = G.subColor; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = G.glowColor; ctx.shadowBlur = 12;
    const tLines = _wrapText(ctx, `"${movieTagline}"`, TITLE_MAX_W - 40);
    tLines.forEach((l, i) => ctx.fillText(l, W / 2, POST_TITLE_Y + i * 22));
    ctx.restore();

    const META_Y = POST_TITLE_Y + tLines.length * 22 + 18;

    ctx.save(); ctx.strokeStyle = G.accent; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.35;
    const lx = W * 0.12;
    ctx.beginPath(); ctx.moveTo(lx, META_Y); ctx.lineTo(W - lx, META_Y); ctx.stroke();
    ctx.restore();

    const CAST_Y = META_Y + 14;
    ctx.save();
    ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.letterSpacing = '3px';
    ctx.fillText('S T A R R I N G', W / 2, CAST_Y);
    ctx.restore();

    ctx.save();
    ctx.font = `bold 22px ${G.titleStyle === 'impact' ? 'Impact,Arial Black' : 'Georgia'},sans-serif`;
    ctx.fillStyle = G.textColor; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = G.glowColor; ctx.shadowBlur = 15;
    ctx.fillText(name.toUpperCase(), W / 2, CAST_Y + 18);
    ctx.restore();

    const RATING_Y = CAST_Y + 50;
    const ratingBox = W / 2 - 24;
    _drawRatingBox(ctx, movieRating, ratingBox, RATING_Y, G.accent);

    ctx.save();
    ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${movieYear}  ·  ${movieRuntime}`, ratingBox + 58, RATING_Y + 14);
    ctx.restore();

    const IMDB_X = W - 120;
    _drawStars(ctx, parseFloat(imdbScore), IMDB_X - 10, RATING_Y + 2, G.accent);
    ctx.save(); ctx.font = 'bold 11px monospace'; ctx.fillStyle = G.accent;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(imdbScore + '/10', IMDB_X + 15, RATING_Y + 18);
    ctx.restore();

    const BOTTOM_Y = H - 58;
    ctx.save(); ctx.strokeStyle = G.accent; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.moveTo(24, BOTTOM_Y); ctx.lineTo(W - 24, BOTTOM_Y); ctx.stroke();
    ctx.restore();

    const BARCODE_X = W - 80, BARCODE_Y = BOTTOM_Y + 12;
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 30; i++) {
        const bw = (i % 3 === 0) ? 3 : 1.5;
        const bx = BARCODE_X + i * 2.2;
        ctx.fillRect(bx, BARCODE_Y, bw, 28);
    }
    ctx.font = '7px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.textAlign = 'center';
    ctx.fillText(seed.toString().slice(0, 10).padEnd(10, '0'), BARCODE_X + 33, BARCODE_Y + 34);
    ctx.restore();

    ctx.save();
    ctx.font = '9px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const creditsLine = `${studio}  ©${movieYear}  ALL RIGHTS RESERVED  ·  NOT FOR DISTRIBUTION`;
    ctx.fillText(creditsLine, 24, BOTTOM_Y + 10);
    ctx.font = '8px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillText('IN ASSOCIATION WITH BULTERBOT PRODUCTIONS', 24, BOTTOM_Y + 24);
    ctx.restore();

    const GENRE_PILL_X = 24, GENRE_PILL_Y = BOTTOM_Y + 10;
    const r2 = hex2rgb(G.accent);
    ctx.save();
    ctx.fillStyle = `rgba(${r2.r},${r2.g},${r2.b},0.15)`;
    ctx.strokeStyle = `rgba(${r2.r},${r2.g},${r2.b},0.40)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(GENRE_PILL_X - 2, GENRE_PILL_Y - 2, G.label.length * 7 + 16, 20, 10);
    ctx.fill(); ctx.stroke();
    ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = G.accent;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(G.label, GENRE_PILL_X + 6, GENRE_PILL_Y + 4);
    ctx.restore();

    return canvas.toBuffer('image/jpeg', { quality: 0.96 });
}

module.exports = { createMoviePoster, GENRES };

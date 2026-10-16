'use strict';

const { createCanvas, loadImage } = require('canvas');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');
const axios = require('axios');

const EMOJI_RE = /(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*|[\u{1F1E0}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/gu;

const _imgCache = new Map();

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

async function _fetchEmoji(emoji) {
    const key    = _emojiCP(emoji);
    const kFull  = _emojiCPFull(emoji);
    const kStrip = _emojiCP(emoji.replace(/\uFE0F/g, ''));
    const enc    = encodeURIComponent(emoji);

    if (_imgCache.has(key)) return _imgCache.get(key);

    const urls = [
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${key}.png`,
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${kFull}.png`,
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${kStrip}.png`,
        `https://emojicdn.elk.sh/${enc}?style=apple`,
        `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${key}.png`,
        `https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128/emoji_u${key.replace(/-/g, '_')}.png`,
    ];

    for (const url of urls) {
        try {
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
            if (res.data && res.data.byteLength > 200) {
                const img = await loadImage(Buffer.from(res.data));
                if (img && img.width > 0) { _imgCache.set(key, img); return img; }
            }
        } catch {}
    }

    _imgCache.set(key, null);
    return null;
}

function _tokenize(str) {
    const tokens = [];
    let last = 0;
    const re = new RegExp(EMOJI_RE.source, 'gu');
    let m;
    while ((m = re.exec(str)) !== null) {
        if (m.index > last) tokens.push({ type: 'text', value: str.slice(last, m.index) });
        tokens.push({ type: 'emoji', value: m[0] });
        last = m.index + m[0].length;
    }
    if (last < str.length) tokens.push({ type: 'text', value: str.slice(last) });
    return tokens;
}

async function _prefetchEmojis(str) {
    const emojis = [...new Set([...(str.matchAll(new RegExp(EMOJI_RE.source, 'gu')))].map(m => m[0]))];
    await Promise.all(emojis.map(e => _fetchEmoji(e)));
}

function _measureMixed(ctx, tokens, fontSize) {
    let w = 0;
    for (const tk of tokens) {
        w += tk.type === 'emoji' ? fontSize * 1.05 : ctx.measureText(tk.value).width;
    }
    return w;
}

function _wrapMixed(ctx, str, maxW, fontSize) {
    const wordList = [];
    const tokens = _tokenize(str);
    let buf = [];

    for (const tk of tokens) {
        if (tk.type === 'emoji') {
            if (buf.length) { wordList.push({ type: 'text', value: buf.join('') }); buf = []; }
            wordList.push({ type: 'emoji', value: tk.value });
        } else {
            const parts = tk.value.split(/(\s+)/);
            for (const p of parts) {
                if (/^\s+$/.test(p)) {
                    if (buf.length) { wordList.push({ type: 'text', value: buf.join('') }); buf = []; }
                    wordList.push({ type: 'space' });
                } else if (p) {
                    buf.push(p);
                }
            }
        }
    }
    if (buf.length) wordList.push({ type: 'text', value: buf.join('') });

    const lines = [];
    let cur = [], curW = 0;

    for (let i = 0; i < wordList.length; i++) {
        const wt = wordList[i];
        if (wt.type === 'space') continue;
        const ww = wt.type === 'emoji' ? fontSize * 1.05 : ctx.measureText(wt.value).width;
        const gap = cur.length > 0 ? ctx.measureText(' ').width : 0;

        if (curW + gap + ww > maxW && cur.length > 0) {
            lines.push({ words: cur, width: curW });
            cur = [wt]; curW = ww;
        } else {
            if (cur.length > 0) curW += gap;
            cur.push(wt); curW += ww;
        }
    }
    if (cur.length > 0) lines.push({ words: cur, width: curW });
    return lines;
}

async function _drawMixedText(ctx, lines, startX, startY, canvasW, fontSize, color, align = 'center') {
    const lineH = fontSize * 1.38;
    const spaceW = ctx.measureText(' ').width;

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        let x;
        if (align === 'center') x = startX + (canvasW - line.width) / 2;
        else x = startX;

        for (const wt of line.words) {
            if (wt.type === 'emoji') {
                const img = _imgCache.get(_emojiCP(wt.value));
                const sz  = fontSize * 1.05;
                const ey  = startY + li * lineH - sz * 0.82;
                if (img) ctx.drawImage(img, x, ey, sz, sz);
                x += sz;
            } else {
                ctx.fillStyle = color;
                ctx.fillText(wt.value, x, startY + li * lineH);
                x += ctx.measureText(wt.value).width;
            }
            x += spaceW;
        }
    }
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

const NGL_PRESETS = {
    default: {
        gradLeft:  '#EF1D78',
        gradRight: '#FC7722',
        label:     'send me anonymous messages!',
    },
    blue: {
        gradLeft:  '#4158D0',
        gradRight: '#C850C0',
        label:     'send me anonymous messages!',
    },
    green: {
        gradLeft:  '#0BA360',
        gradRight: '#3CBA92',
        label:     'send me anonymous messages!',
    },
    purple: {
        gradLeft:  '#7B2FF7',
        gradRight: '#F107A3',
        label:     'send me anonymous messages!',
    },
    red: {
        gradLeft:  '#FF416C',
        gradRight: '#FF4B2B',
        label:     'send me anonymous messages!',
    },
    teal: {
        gradLeft:  '#11998E',
        gradRight: '#38EF7D',
        label:     'send me anonymous messages!',
    },
};

async function generateFakeNgl(opts = {}) {
    const {
        message  = '',
        theme    = 'default',
        scale    = 2,
    } = opts;

    const preset = NGL_PRESETS[theme] || NGL_PRESETS.default;

    const CARD_W   = 661 * scale;
    const CARD_H   = 444 * scale;
    const RADIUS   = 38 * scale;

    const CANVAS_W = Math.round(CARD_W + 74 * scale);
    const CANVAS_H = Math.round(CARD_H + 40 * scale);
    const CARD_X   = 37 * scale;
    const CARD_Y   = 20 * scale;

    const GRAD_H   = Math.round(CARD_H * 0.495);
    const WHITE_Y  = CARD_Y + GRAD_H;
    const WHITE_H  = CARD_H - GRAD_H;

    const LABEL_FONT_SIZE = Math.round(scale * (message ? 32 : 32));
    const MSG_FONT_SIZE   = Math.round(scale * 28);

    if (message) await _prefetchEmojis(message);

    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle = '#F2F2F2';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const shadow = 8 * scale;
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur    = shadow;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = shadow * 0.6;
    rrect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, RADIUS);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();

    ctx.save();
    rrect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, RADIUS);
    ctx.clip();

    const gradW = ctx.createLinearGradient(CARD_X, 0, CARD_X + CARD_W, 0);
    gradW.addColorStop(0,   preset.gradLeft);
    gradW.addColorStop(1,   preset.gradRight);
    ctx.fillStyle = gradW;
    ctx.fillRect(CARD_X, CARD_Y, CARD_W, GRAD_H);

    const gradFade = ctx.createLinearGradient(0, CARD_Y + GRAD_H - GRAD_H * 0.06, 0, CARD_Y + GRAD_H);
    gradFade.addColorStop(0, 'rgba(255,255,255,0)');
    gradFade.addColorStop(1, 'rgba(255,255,255,0.14)');
    ctx.fillStyle = gradFade;
    ctx.fillRect(CARD_X, CARD_Y + GRAD_H - GRAD_H * 0.06, CARD_W, GRAD_H * 0.06);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(CARD_X, WHITE_Y, CARD_W, WHITE_H);

    const LABEL_PAD_X = Math.round(CARD_W * 0.12);
    const LABEL_MAX_W = CARD_W - LABEL_PAD_X * 2;
    const LABEL_Y     = CARD_Y + Math.round(GRAD_H * 0.22);

    ctx.font         = `900 ${LABEL_FONT_SIZE}px "Arial Black", Arial, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign    = 'left';
    ctx.fillStyle    = '#ffffff';
    ctx.shadowColor  = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur   = 4 * scale;

    const labelLines = _wrapMixed(ctx, preset.label, LABEL_MAX_W, LABEL_FONT_SIZE);
    const labelLineH = LABEL_FONT_SIZE * 1.28;

    for (let i = 0; i < labelLines.length; i++) {
        const line = labelLines[i];
        const lx   = CARD_X + (CARD_W - line.width) / 2;
        let tx      = lx;

        for (const wt of line.words) {
            ctx.fillText(wt.value, tx, LABEL_Y + i * labelLineH);
            tx += ctx.measureText(wt.value).width + ctx.measureText(' ').width;
        }
    }

    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';

    if (message) {
        const MSG_PAD_X = Math.round(CARD_W * 0.10);
        const MSG_MAX_W = CARD_W - MSG_PAD_X * 2;
        const MSG_CENTER_Y = WHITE_Y + WHITE_H * 0.48;

        ctx.font = `bold ${MSG_FONT_SIZE}px Arial, sans-serif`;
        ctx.textBaseline = 'alphabetic';

        const msgLines = _wrapMixed(ctx, message, MSG_MAX_W, MSG_FONT_SIZE);
        const msgLineH = MSG_FONT_SIZE * 1.38;
        const totalH   = msgLines.length * msgLineH;
        const startY   = MSG_CENTER_Y - totalH / 2 + MSG_FONT_SIZE * 0.80;

        await _drawMixedText(ctx, msgLines, CARD_X, startY, CARD_W, MSG_FONT_SIZE, '#111111', 'center');
    }

    const DIV_Y = WHITE_Y - 1;
    ctx.fillStyle = 'rgba(230,230,230,0.60)';
    ctx.fillRect(CARD_X, DIV_Y, CARD_W, 1 * scale);

    ctx.restore();

    return canvas.toBuffer('image/jpeg', { quality: 0.96 });
}

module.exports = { generateFakeNgl, NGL_PRESETS };

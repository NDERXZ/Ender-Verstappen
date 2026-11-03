'use strict';

const path = require('path');
const fs = require('fs');
const { Canvas, FontLibrary, loadImage } = require('skia-canvas');
const Jimp = require('jimp');
const axios = require('axios');

const FONT_PATH = path.join(__dirname, 'arialnarrow.ttf');
const FONT_URL = 'https://github.com/gbif/analytics/raw/master/fonts/Arial%20Narrow.ttf';
const FONT_ALIAS = 'BratNarrow';
const _fontState = { loaded: false };

const EMOJI_RE = /(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*|[\u{1F1E0}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/gu;

async function _ensureFont() {
    if (_fontState.loaded) return;
    if (!fs.existsSync(FONT_PATH)) {
        try {
            const res = await axios.get(FONT_URL, { responseType: 'arraybuffer', timeout: 25000 });
            fs.writeFileSync(FONT_PATH, Buffer.from(res.data));
        } catch (e) {
            console.error('[Brat Font Download Failed]', e.message);
        }
    }
    try {
        if (fs.existsSync(FONT_PATH)) {
            FontLibrary.use(FONT_ALIAS, FONT_PATH);
            _fontState.loaded = true;
        }
    } catch (e) {
        console.error('[Brat Font Load Failed]', e.message);
    }
}

function _emojiCodepoint(str) {
    const cps = [];
    let i = 0;
    while (i < str.length) {
        const cp = str.codePointAt(i);
        if (cp !== undefined && cp !== 0xfe0f && cp !== 0x200d) {
            cps.push(cp.toString(16).toLowerCase());
        }
        i += (cp !== undefined && cp > 0xffff) ? 2 : 1;
    }
    return cps.join('-');
}

function _emojiCodepointFull(str) {
    const cps = [];
    let i = 0;
    while (i < str.length) {
        const cp = str.codePointAt(i);
        if (cp !== undefined && cp !== 0xfe0f) {
            cps.push(cp.toString(16).toLowerCase());
        }
        i += (cp !== undefined && cp > 0xffff) ? 2 : 1;
    }
    return cps.join('-');
}

const _imgCache = new Map();

async function _fetchEmoji(emojiStr) {
    const cp = _emojiCodepoint(emojiStr);
    if (_imgCache.has(cp)) return _imgCache.get(cp);

    const cpFull = _emojiCodepointFull(emojiStr);
    const withoutFE0F = emojiStr.replace(/\uFE0F/g, '');
    const cpNoFE0F = _emojiCodepoint(withoutFE0F);
    const encoded = encodeURIComponent(emojiStr);

    const urls = [
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${cp}.png`,
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${cpFull}.png`,
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${cpNoFE0F}.png`,
        `https://raw.githubusercontent.com/iamcal/emoji-data/master/img-apple-160/${cp}.png`,
        `https://raw.githubusercontent.com/iamcal/emoji-data/master/img-apple-160/${cpFull}.png`,
        `https://emojicdn.elk.sh/${encoded}?style=apple`,
        `https://emojicdn.elk.sh/${encodeURIComponent(withoutFE0F)}?style=apple`,
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64/${cp}.png`,
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64/${cpFull}.png`,
        `https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128/emoji_u${cp.replace(/-/g, '_')}.png`,
        `https://emojiapi.dev/api/v1/${cp}/160.png`,
        `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${cp}.png`
    ];

    for (const url of urls) {
        try {
            const img = await loadImage(url);
            if (img && img.width > 0) {
                _imgCache.set(cp, img);
                return img;
            }
        } catch {}
    }
    _imgCache.set(cp, null);
    return null;
}

function _tokenize(str) {
    const tokens = [];
    let lastIdx = 0;
    const re = new RegExp(EMOJI_RE.source, 'gu');
    let match;
    while ((match = re.exec(str)) !== null) {
        if (match.index > lastIdx) {
            const txt = str.slice(lastIdx, match.index);
            if (txt.trim()) tokens.push({ type: 'text', value: txt.trim() });
        }
        tokens.push({ type: 'emoji', value: match[0] });
        lastIdx = match.index + match[0].length;
    }
    if (lastIdx < str.length) {
        const remaining = str.slice(lastIdx).trim();
        if (remaining) tokens.push({ type: 'text', value: remaining });
    }
    return tokens;
}

function _wordsFromTokens(tokens) {
    const words = [];
    for (const tok of tokens) {
        if (tok.type === 'emoji') {
            words.push({ type: 'emoji', value: tok.value });
        } else {
            const parts = tok.value.split(/\s+/).filter(Boolean);
            for (const p of parts) {
                words.push({ type: 'text', value: p });
            }
        }
    }
    return words;
}

function _measureWord(ctx, wordObj, emojiSize) {
    if (wordObj.type === 'emoji') return emojiSize;
    return ctx.measureText(wordObj.value).width;
}

function _buildLines(ctx, words, maxWidth, emojiSize, spaceWidth) {
    const lines = [];
    let curLine = [];
    let curWidth = 0;

    for (const w of words) {
        const wWidth = _measureWord(ctx, w, emojiSize);
        const added = curLine.length > 0 ? spaceWidth + wWidth : wWidth;
        if (curWidth + added > maxWidth && curLine.length > 0) {
            lines.push({ words: curLine, width: curWidth });
            curLine = [w];
            curWidth = wWidth;
        } else {
            curLine.push(w);
            curWidth += added;
        }
    }
    if (curLine.length > 0) {
        lines.push({ words: curLine, width: curWidth });
    }
    return lines;
}

async function generateBrat(text) {
    await _ensureFont();
    const fontName = _fontState.loaded ? FONT_ALIAS : 'Arial';
    const rawText = String(text || '').trim();
    if (!rawText) throw new Error('Teks kosong');

    const tokens = _tokenize(rawText);
    const words = _wordsFromTokens(tokens);

    // Pre-fetch all emojis in parallel
    const emojiList = [...new Set(words.filter(w => w.type === 'emoji').map(w => w.value))];
    await Promise.all(emojiList.map(e => _fetchEmoji(e)));

    // Standard 500x500 brat canvas
    const W = 500;
    const H = 500;
    const padX = 24;
    const padY = 24;
    const maxW = W - padX * 2;
    const maxH = H - padY * 2;

    // Start with massive font size (up to 280px) so short texts expand to fill the canvas without wasted space
    let fontSize = 280;
    let lines = [];
    const canvas = new Canvas(W, H);
    const ctx = canvas.getContext('2d');

    while (fontSize >= 24) {
        ctx.font = `${fontSize}px "${fontName}"`;
        const emojiSize = Math.round(fontSize * 0.92);
        const spaceW = Math.round(fontSize * 0.22);
        lines = _buildLines(ctx, words, maxW, emojiSize, spaceW);
        const totalHeight = lines.length * fontSize * 1.05;
        const maxLineWidth = Math.max(...lines.map(l => l.width));
        if (totalHeight <= maxH && maxLineWidth <= maxW) break;
        fontSize -= 2;
    }

    const emojiSize = Math.round(fontSize * 0.92);
    const spaceW = Math.round(fontSize * 0.22);
    const lineSpacing = fontSize * 1.05;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    ctx.font = `${fontSize}px "${fontName}"`;

    // Center content vertically to eliminate empty wasted margins
    const totalContentHeight = lines.length * lineSpacing;
    let y = Math.max(padY, Math.round((H - totalContentHeight) / 2));

    for (const line of lines) {
        // Center horizontally per line
        let x = Math.max(padX, Math.round((W - line.width) / 2));
        for (let i = 0; i < line.words.length; i++) {
            const w = line.words[i];
            if (i > 0) x += spaceW;

            if (w.type === 'emoji') {
                const img = _imgCache.get(_emojiCodepoint(w.value));
                if (img) {
                    ctx.drawImage(img, x, y, emojiSize, emojiSize);
                } else {
                    ctx.fillText(w.value, x, y);
                }
                x += emojiSize;
            } else {
                ctx.fillText(w.value, x, y);
                x += ctx.measureText(w.value).width;
            }
        }
        y += lineSpacing;
    }

    const pngBuf = await canvas.toBuffer('png');
    const jimpImg = await Jimp.read(pngBuf);

    // Authentic low-resolution & blurry brat aesthetic:
    // Downscale to 280x280 (compressed pixelation) then upscale back to 512x512 with blur
    jimpImg.resize(280, 280, Jimp.RESIZE_BILINEAR);
    jimpImg.resize(512, 512, Jimp.RESIZE_NEAREST_NEIGHBOR);
    jimpImg.blur(2);

    return await jimpImg.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = { generateBrat };

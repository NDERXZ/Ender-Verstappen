'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { Canvas, FontLibrary, loadImage } = require('skia-canvas');
const Jimp = require('jimp');
const axios = require('axios');
const { addExif } = require('../exif');

const FONT_PATH = path.join(__dirname, 'arialnarrow.ttf');
const FONT_URL = 'https://github.com/gbif/analytics/raw/master/fonts/Arial%20Narrow.ttf';
const FONT_ALIAS = 'BratNarrow';
const _fontState = { loaded: false };

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

const EMOJI_RE = /(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*|[\u{1F1E0}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/gu;

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

const _imgCache = new Map();

async function _fetchEmoji(emojiStr) {
    const cp = _emojiCodepoint(emojiStr);
    if (_imgCache.has(cp)) return _imgCache.get(cp);

    const urls = [
        `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/${cp}.png`,
        `https://raw.githubusercontent.com/iamcal/emoji-data/master/img-apple-160/${cp}.png`,
        `https://emojicdn.elk.sh/${encodeURIComponent(emojiStr)}?style=apple`,
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

function _measureLine(ctx, words, emojiSize, spaceW) {
    let w = 0;
    for (let i = 0; i < words.length; i++) {
        if (i > 0) w += spaceW;
        w += _measureWord(ctx, words[i], emojiSize);
    }
    return w;
}

function _partitions(arr, k) {
    if (k === 1) return [[arr]];
    if (arr.length === k) return [arr.map(x => [x])];
    if (arr.length < k) return [];
    const res = [];
    for (let i = 1; i <= arr.length - k + 1; i++) {
        const head = arr.slice(0, i);
        const tailParts = _partitions(arr.slice(i), k - 1);
        for (const t of tailParts) res.push([head, ...t]);
    }
    return res;
}

function _getBestLayout(ctx, words, maxW, maxH) {
    const fontName = _fontState.loaded ? FONT_ALIAS : 'Arial';
    let best = { fontSize: 24, lines: [words] };

    // For short texts (up to 7 words), find the optimal partition that maximizes font size
    if (words.length <= 7) {
        for (let k = 1; k <= Math.min(words.length, 5); k++) {
            const partsList = _partitions(words, k);
            for (const parts of partsList) {
                for (let fs = 280; fs >= 24; fs -= 4) {
                    ctx.font = `bold ${fs}px "${fontName}"`;
                    const totalH = parts.length * fs * 1.06;
                    if (totalH > maxH) continue;
                    const emojiSize = Math.round(fs * 0.92);
                    const spaceW = Math.round(fs * 0.22);
                    let fits = true;
                    for (const lineWords of parts) {
                        if (_measureLine(ctx, lineWords, emojiSize, spaceW) > maxW) {
                            fits = false;
                            break;
                        }
                    }
                    if (fits) {
                        if (fs > best.fontSize) {
                            best = { fontSize: fs, lines: parts };
                        }
                        break;
                    }
                }
            }
        }
    } else {
        // Greedy wrapping for longer phrases
        for (let fs = 240; fs >= 20; fs -= 2) {
            ctx.font = `bold ${fs}px "${fontName}"`;
            const emojiSize = Math.round(fs * 0.92);
            const spaceW = Math.round(fs * 0.22);
            const lines = [];
            let cur = [], curW = 0;
            for (const w of words) {
                const ww = _measureWord(ctx, w, emojiSize);
                const added = cur.length > 0 ? spaceW + ww : ww;
                if (curW + added <= maxW) {
                    cur.push(w);
                    curW += added;
                } else {
                    lines.push(cur);
                    cur = [w];
                    curW = ww;
                }
            }
            if (cur.length) lines.push(cur);
            const totalH = lines.length * fs * 1.06;
            const maxLW = Math.max(...lines.map(l => _measureLine(ctx, l, emojiSize, spaceW)));
            if (totalH <= maxH && maxLW <= maxW) {
                best = { fontSize: fs, lines };
                break;
            }
        }
    }

    return best;
}

async function renderBratCanvas(text, activeWordIndices = null, precalculatedLayout = null) {
    await _ensureFont();
    const fontName = _fontState.loaded ? FONT_ALIAS : 'Arial';
    const rawText = String(text || '').trim();
    if (!rawText) throw new Error('Teks kosong');

    const tokens = _tokenize(rawText);
    const words = _wordsFromTokens(tokens);

    // Pre-fetch all emojis in parallel
    const emojiList = [...new Set(words.filter(w => w.type === 'emoji').map(w => w.value))];
    await Promise.all(emojiList.map(e => _fetchEmoji(e)));

    const W = 500, H = 500, padX = 28, padY = 28;
    const maxW = W - padX * 2, maxH = H - padY * 2;
    const canvas = new Canvas(W, H);
    const ctx = canvas.getContext('2d');

    const layout = precalculatedLayout || _getBestLayout(ctx, words, maxW, maxH);
    const fontSize = layout.fontSize;
    const emojiSize = Math.round(fontSize * 0.92);
    const spaceW = Math.round(fontSize * 0.22);
    const lineH = fontSize * 1.06;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${fontSize}px "${fontName}"`;

    const totalH = layout.lines.length * lineH;
    let y = Math.max(padY, Math.round((H - totalH) / 2));

    let wordCounter = 0;
    for (const lineWords of layout.lines) {
        let x = padX;
        for (let i = 0; i < lineWords.length; i++) {
            const w = lineWords[i];
            const currentIdx = wordCounter++;
            if (i > 0) x += spaceW;

            if (activeWordIndices !== null && !activeWordIndices.has(currentIdx)) {
                // Word not yet revealed in this frame
                x += _measureWord(ctx, w, emojiSize);
                continue;
            }

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
        y += lineH;
    }

    const pngBuf = await canvas.toBuffer('png');
    const jimg = await Jimp.read(pngBuf);
    
    // Low-fi compressed brat aesthetic:
    // Downsample to 200x200 to destroy high-res crispness, upscale to 512x512, and blur slightly
    jimg.resize(200, 200, Jimp.RESIZE_BILINEAR);
    jimg.resize(512, 512, Jimp.RESIZE_BILINEAR);
    jimg.blur(2);

    return await jimg.getBufferAsync(Jimp.MIME_PNG);
}

// Generate static brat PNG buffer (for backward compatibility)
async function generateBrat(text) {
    return await renderBratCanvas(text);
}

// Generate static brat WebP sticker buffer with EXIF
async function generateBratWebp(text, metadata = {}) {
    const pngBuf = await renderBratCanvas(text);
    const tmpPng = path.join(os.tmpdir(), `brat_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
    const tmpWebp = path.join(os.tmpdir(), `brat_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`);
    fs.writeFileSync(tmpPng, pngBuf);

    try {
        execSync(`ffmpeg -y -i "${tmpPng}" -vcodec libwebp -lossless 0 -compression_level 4 -q:v 35 -loop 0 -an -vsync 0 -s 512:512 "${tmpWebp}"`, { stdio: 'ignore' });
        let webpBuf = fs.readFileSync(tmpWebp);
        const packname = metadata.packname || global.packname || global.namaBot || 'Ender Verstappen';
        const author   = metadata.author   || global.author   || global.namaowner || 'Chaidar';
        webpBuf = await addExif(webpBuf, packname, author, ['🤖']);
        return webpBuf;
    } finally {
        try { fs.unlinkSync(tmpPng); } catch {}
        try { fs.unlinkSync(tmpWebp); } catch {}
    }
}

// Generate animated brat video WebP sticker buffer with progressive reveal
async function generateBratVidWebp(text, metadata = {}) {
    await _ensureFont();
    const rawText = String(text || '').trim();
    if (!rawText) throw new Error('Teks kosong');

    const tokens = _tokenize(rawText);
    const allWords = _wordsFromTokens(tokens).slice(0, 12);
    if (!allWords.length) throw new Error('Teks kosong');

    const W = 500, H = 500, padX = 28, padY = 28;
    const maxW = W - padX * 2, maxH = H - padY * 2;
    const canvas = new Canvas(W, H);
    const ctx = canvas.getContext('2d');

    // Calculate layout ONCE so font size and wrapping remain stable across all frames
    const layout = _getBestLayout(ctx, allWords, maxW, maxH);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bratvid_'));
    const frameFiles = [];

    try {
        for (let i = 0; i < allWords.length; i++) {
            const activeIndices = new Set();
            for (let j = 0; j <= i; j++) activeIndices.add(j);

            const framePng = await renderBratCanvas(rawText, activeIndices, layout);
            const framePath = path.join(tmpDir, `frame_${String(i).padStart(3, '0')}.png`);
            fs.writeFileSync(framePath, framePng);
            frameFiles.push(framePath);
        }

        const listFile = path.join(tmpDir, 'frames.txt');
        let listContent = '';
        for (let i = 0; i < frameFiles.length; i++) {
            listContent += `file '${frameFiles[i]}'\n`;
            listContent += `duration ${i === frameFiles.length - 1 ? '2.5' : '0.35'}\n`;
        }
        listContent += `file '${frameFiles[frameFiles.length - 1]}'\n`;
        fs.writeFileSync(listFile, listContent);

        const outWebp = path.join(tmpDir, 'out.webp');
        execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -vcodec libwebp -lossless 0 -compression_level 4 -q:v 35 -loop 0 -an -vsync 0 -s 512:512 "${outWebp}"`, { stdio: 'ignore' });

        let webpBuf = fs.readFileSync(outWebp);
        const packname = metadata.packname || global.packname || global.namaBot || 'Ender Verstappen';
        const author   = metadata.author   || global.author   || global.namaowner || 'Chaidar';
        webpBuf = await addExif(webpBuf, packname, author, ['🤖']);
        return webpBuf;

    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
}

module.exports = {
    generateBrat,
    generateBratWebp,
    generateBratVidWebp
};

'use strict';

const path = require('path');
const fs   = require('fs');

const FONT_MONO_URL  = 'https://github.com/ryanoasis/nerd-fonts/raw/master/patched-fonts/JetBrainsMono/Ligatures/Regular/JetBrainsMonoNerdFont-Regular.ttf';
const FONT_MONO_PATH = path.join(__dirname, 'JetBrainsMono.ttf');
const FONT_MONO_NAME = 'SnapMono';

const _fontLoaded = { done: false };

async function _ensureFont() {
    if (_fontLoaded.done) return;
    const { FontLibrary } = require('skia-canvas');
    if (!fs.existsSync(FONT_MONO_PATH)) {
        const axios = require('axios');
        const res = await axios.get(FONT_MONO_URL, { responseType: 'arraybuffer', timeout: 20000 });
        fs.writeFileSync(FONT_MONO_PATH, Buffer.from(res.data));
    }
    try { FontLibrary.use(FONT_MONO_NAME, FONT_MONO_PATH); _fontLoaded.done = true; } catch {}
}

const THEMES = {
    dracula: {
        bg:         '#282a36',
        windowBg:   '#1e1f29',
        lineNum:    '#6272a4',
        gutter:     '#21222c',
        border:     '#44475a',
        selection:  '#44475a',
        text:       '#f8f8f2',
        keyword:    '#ff79c6',
        string:     '#f1fa8c',
        number:     '#bd93f9',
        comment:    '#6272a4',
        func:       '#50fa7b',
        builtin:    '#8be9fd',
        operator:   '#ff79c6',
        property:   '#f8f8f2',
        variable:   '#f8f8f2',
        className:  '#50fa7b',
        type:       '#8be9fd',
        punctuation:'#f8f8f2',
        regex:      '#ffb86c',
        boolean:    '#bd93f9',
        attribute:  '#50fa7b',
        tag:        '#ff79c6',
    },
    oneDark: {
        bg:         '#21252b',
        windowBg:   '#181a1f',
        lineNum:    '#495162',
        gutter:     '#1d2026',
        border:     '#2c313a',
        text:       '#abb2bf',
        keyword:    '#c678dd',
        string:     '#98c379',
        number:     '#d19a66',
        comment:    '#5c6370',
        func:       '#61afef',
        builtin:    '#56b6c2',
        operator:   '#c678dd',
        property:   '#e06c75',
        variable:   '#e06c75',
        className:  '#e5c07b',
        type:       '#56b6c2',
        punctuation:'#abb2bf',
        regex:      '#d19a66',
        boolean:    '#d19a66',
        attribute:  '#d19a66',
        tag:        '#e06c75',
    },
    monokai: {
        bg:         '#272822',
        windowBg:   '#1e1f1c',
        lineNum:    '#75715e',
        gutter:     '#232420',
        border:     '#3e3d32',
        text:       '#f8f8f2',
        keyword:    '#f92672',
        string:     '#e6db74',
        number:     '#ae81ff',
        comment:    '#75715e',
        func:       '#a6e22e',
        builtin:    '#66d9e8',
        operator:   '#f92672',
        property:   '#f8f8f2',
        variable:   '#f8f8f2',
        className:  '#a6e22e',
        type:       '#66d9e8',
        punctuation:'#f8f8f2',
        regex:      '#fd971f',
        boolean:    '#ae81ff',
        attribute:  '#a6e22e',
        tag:        '#f92672',
    }
};

const JS_KEYWORDS   = new Set(['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','delete','typeof','instanceof','in','of','class','extends','super','import','export','default','async','await','try','catch','finally','throw','this','void','yield','from','static','get','set','null','undefined']);
const JS_BUILTINS   = new Set(['console','Math','Object','Array','String','Number','Boolean','Date','JSON','Promise','Map','Set','WeakMap','WeakSet','Symbol','Error','parseInt','parseFloat','isNaN','isFinite','encodeURI','decodeURI','setTimeout','setInterval','clearTimeout','clearInterval','fetch','require','module','exports','process','Buffer','__dirname','__filename','window','document','navigator','location','history','localStorage','sessionStorage']);
const JS_TYPES      = new Set(['int','float','string','boolean','void','any','never','unknown','object','number','bigint']);
const JS_BOOLEANS   = new Set(['true','false']);

function _tokenizeJS(line) {
    const tokens = [];
    let i = 0;
    const L = line.length;

    while (i < L) {
        if (line[i] === '/' && line[i+1] === '/') {
            tokens.push({ type: 'comment', value: line.slice(i) });
            break;
        }

        if (line[i] === '/' && line[i+1] === '*') {
            let end = line.indexOf('*/', i + 2);
            if (end === -1) end = L - 2;
            tokens.push({ type: 'comment', value: line.slice(i, end + 2) });
            i = end + 2;
            continue;
        }

        if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
            const q = line[i];
            let j = i + 1;
            while (j < L) {
                if (line[j] === '\\') { j += 2; continue; }
                if (line[j] === q) { j++; break; }
                j++;
            }
            tokens.push({ type: 'string', value: line.slice(i, j) });
            i = j;
            continue;
        }

        if (line[i] === '/' && i > 0) {
            const prev = tokens[tokens.length - 1];
            const prevVal = prev ? prev.value.trim() : '';
            const afterOp = /[=,([\!&|?:{;]$/.test(prevVal) || prev === undefined;
            if (afterOp) {
                let j = i + 1;
                while (j < L && line[j] !== '/') {
                    if (line[j] === '\\') j++;
                    j++;
                }
                j++;
                while (j < L && /[gimsuy]/.test(line[j])) j++;
                tokens.push({ type: 'regex', value: line.slice(i, j) });
                i = j;
                continue;
            }
        }

        if (/[0-9]/.test(line[i]) || (line[i] === '.' && /[0-9]/.test(line[i+1]))) {
            let j = i;
            if (line[j] === '0' && (line[j+1] === 'x' || line[j+1] === 'X')) {
                j += 2;
                while (j < L && /[0-9a-fA-F]/.test(line[j])) j++;
            } else if (line[j] === '0' && (line[j+1] === 'b' || line[j+1] === 'B')) {
                j += 2;
                while (j < L && /[01]/.test(line[j])) j++;
            } else {
                while (j < L && /[0-9._e+\-]/.test(line[j])) j++;
                if (j < L && (line[j] === 'n')) j++;
            }
            tokens.push({ type: 'number', value: line.slice(i, j) });
            i = j;
            continue;
        }

        if (/[a-zA-Z_$]/.test(line[i])) {
            let j = i;
            while (j < L && /[a-zA-Z0-9_$]/.test(line[j])) j++;
            const word = line.slice(i, j);
            const isCall = line[j] === '(';
            const isDot  = i > 0 && line[i-1] === '.';

            let type = 'text';
            if (JS_KEYWORDS.has(word))  type = 'keyword';
            else if (JS_BOOLEANS.has(word)) type = 'boolean';
            else if (JS_TYPES.has(word))    type = 'type';
            else if (JS_BUILTINS.has(word) && !isDot) type = 'builtin';
            else if (isDot && isCall)  type = 'func';
            else if (!isDot && isCall) type = JS_BUILTINS.has(word) ? 'builtin' : 'func';
            else if (isDot)  type = 'property';
            else if (/^[A-Z]/.test(word)) type = 'className';

            tokens.push({ type, value: word });
            i = j;
            continue;
        }

        if (/[+\-*/%=<>!&|^~?:,;.@]/.test(line[i])) {
            let j = i + 1;
            const ops = ['===','!==','**=','<<=','>>=','>>>=','&&=','||=','??=','...','===','!==','**','++','--','+=','-=','*=','/=','%=','**=','&&','||','??','<=','>=','==','!=','<<','>>','>>>','->','=>'];
            let matched = '';
            for (const op of ops) {
                if (line.startsWith(op, i)) { matched = op; break; }
            }
            if (matched) {
                tokens.push({ type: 'operator', value: matched });
                i += matched.length;
            } else {
                tokens.push({ type: 'punctuation', value: line[i] });
                i++;
            }
            continue;
        }

        if (/[{}()\[\]]/.test(line[i])) {
            tokens.push({ type: 'punctuation', value: line[i] });
            i++;
            continue;
        }

        tokens.push({ type: 'text', value: line[i] });
        i++;
    }

    return tokens;
}

function _tokenizeLine(line, lang) {
    if (lang === 'js' || lang === 'ts' || lang === 'javascript' || lang === 'typescript') {
        return _tokenizeJS(line);
    }
    return [{ type: 'text', value: line }];
}

function _detectLang(code) {
    if (/^(import |export |const |let |var |function |class |=>|async )/.test(code)) return 'js';
    if (/\bdef \w+\(/.test(code) || /^import \w+$/.test(code)) return 'python';
    return 'js';
}

async function generateCodeSnap(code, opts = {}) {
    const { Canvas } = require('skia-canvas');

    await _ensureFont();
    const fontFamily = _fontLoaded.done ? FONT_MONO_NAME : 'monospace';
    const theme      = THEMES[opts.theme] || THEMES.dracula;
    const lang       = opts.lang || _detectLang(code);

    const lines = code.split('\n');

    const FONT_SIZE   = opts.fontSize || 30;
    const LINE_H      = Math.round(FONT_SIZE * 1.62);
    const PAD_X       = opts.padX || 52;
    const PAD_Y       = opts.padY || 44;
    const PAD_TOP     = PAD_Y + 52;
    const GUTTER_W    = opts.lineNumbers !== false ? FONT_SIZE * 2.8 : 0;
    const SHADOW_BLUR = 60;
    const SHADOW_OFF  = 28;
    const OUTER_PAD   = 72;
    const RADIUS      = 14;
    const DOT_R       = 9;
    const DOT_Y_OFF   = 26;
    const DOT_SPACING = 26;
    const HEADER_H    = 52;

    const measure = new Canvas(1, 1);
    const mctx    = measure.getContext('2d');
    mctx.font     = `${FONT_SIZE}px "${fontFamily}"`;

    const charW = mctx.measureText('M').width;

    const maxLineChars = Math.max(...lines.map(l => l.length), 20);
    const codeW = Math.round(charW * maxLineChars) + PAD_X * 2 + GUTTER_W;
    const codeH = lines.length * LINE_H + PAD_TOP + PAD_Y;

    const totalW = codeW + OUTER_PAD * 2;
    const totalH = codeH + OUTER_PAD * 2 + SHADOW_OFF;

    const canvas = new Canvas(totalW, totalH);
    const ctx    = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, totalW, totalH);
    grad.addColorStop(0,   opts.bg1 || '#7f8fa6');
    grad.addColorStop(0.5, opts.bg2 || '#8fa6b3');
    grad.addColorStop(1,   opts.bg3 || '#6d8090');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, totalW, totalH);

    const wx = OUTER_PAD;
    const wy = OUTER_PAD;

    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur    = SHADOW_BLUR;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = SHADOW_OFF;

    ctx.beginPath();
    _roundRect(ctx, wx, wy, codeW, codeH, RADIUS);
    ctx.fillStyle = theme.bg;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    _roundRect(ctx, wx, wy, codeW, codeH, RADIUS);
    ctx.clip();

    ctx.fillStyle = theme.windowBg;
    ctx.fillRect(wx, wy, codeW, HEADER_H);

    const dots = [
        { color: '#ff5f57', x: wx + PAD_X },
        { color: '#febc2e', x: wx + PAD_X + DOT_SPACING + DOT_R * 2 },
        { color: '#28c840', x: wx + PAD_X + (DOT_SPACING + DOT_R * 2) * 2 }
    ];
    for (const d of dots) {
        ctx.beginPath();
        ctx.arc(d.x + DOT_R, wy + DOT_Y_OFF, DOT_R, 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        ctx.fill();
    }

    if (opts.title) {
        ctx.font      = `${FONT_SIZE * 0.7}px "${fontFamily}"`;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(opts.title, wx + codeW / 2, wy + DOT_Y_OFF);
        ctx.textAlign = 'left';
    }

    if (GUTTER_W > 0) {
        ctx.fillStyle = theme.gutter;
        ctx.fillRect(wx, wy + HEADER_H, GUTTER_W, codeH - HEADER_H);
    }

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign    = 'left';

    for (let li = 0; li < lines.length; li++) {
        const lineY = wy + HEADER_H + PAD_TOP - HEADER_H + li * LINE_H + FONT_SIZE;

        if (GUTTER_W > 0) {
            ctx.font      = `${Math.round(FONT_SIZE * 0.78)}px "${fontFamily}"`;
            ctx.fillStyle = theme.lineNum;
            ctx.textAlign = 'right';
            ctx.fillText(String(li + 1), wx + GUTTER_W - 14, lineY);
            ctx.textAlign = 'left';
        }

        const tokens = _tokenizeLine(lines[li], lang);
        let tx = wx + GUTTER_W + PAD_X;
        ctx.font = `${FONT_SIZE}px "${fontFamily}"`;

        for (const tok of tokens) {
            ctx.fillStyle = theme[tok.type] || theme.text;
            ctx.fillText(tok.value, tx, lineY);
            tx += ctx.measureText(tok.value).width;
        }
    }

    ctx.restore();

    return canvas.toBuffer('png');
}

function _roundRect(ctx, x, y, w, h, r) {
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

module.exports = { generateCodeSnap, THEMES };

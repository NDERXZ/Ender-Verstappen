'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const axios  = require('axios');

const GC_DIR           = './database/getcase';
const EXTRACTED_PATH   = `${GC_DIR}/extracted.json`;
const HISTORY_PATH     = `${GC_DIR}/history.json`;
const CONVERTED_PATH   = `${GC_DIR}/converted.json`;
const PENDING_PATH     = `${GC_DIR}/pending.json`;
const CACHE_PATH       = `${GC_DIR}/cache.json`;
const TEMPLATE_PATH    = `${GC_DIR}/templates.json`;
const BULTER_PATH      = './bulter.js';

const _ensureDir = () => { if (!fs.existsSync(GC_DIR)) fs.mkdirSync(GC_DIR, { recursive: true }); };
const _read  = (p, fb = {}) => { try { _ensureDir(); return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return typeof fb === 'function' ? fb() : (Array.isArray(fb) ? [] : { ...fb }); } };
const _write = (p, d) => {
    try {
        _ensureDir();
        const tmp = p + '.tmp.' + crypto.randomBytes(4).toString('hex');
        fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
        fs.renameSync(tmp, p);
    } catch { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} }
};

const _rateLimit = new Map();
const _conversionCache = new Map();
const _sessionMap = new Map();
const _nonceCache = { value: null, ts: 0, ttl: 180000 };

const KNOWN_BOT_PATTERNS = [
    { name: 'Naze/Satanic', vars: { socket: /\b(satanic|naze)\b/g, replacement: 'bulter' }, prefixes: ['.', '!', '#', '/', '?', '>', '<', '+', '-', '*'] },
    { name: 'Baileys Generic', vars: { socket: /\b(sock|socket|client|conn|bot|wa)\b(?=\s*\.send)/g, replacement: 'bulter' }, prefixes: ['.', '!', '#'] },
    { name: 'Anya/Arugaz', vars: { socket: /\b(anya|arugaz|zero)\b/g, replacement: 'bulter' }, prefixes: ['.', '!'] },
    { name: 'Xyzbot', vars: { socket: /\b(xyz|xbot)\b/g, replacement: 'bulter' }, prefixes: ['.', '!', '?'] },
    { name: 'Generic WA', vars: { socket: /\b(client|connection|whatsapp|socket)\b/g, replacement: 'bulter' }, prefixes: ['.', '!', '/'] }
];

const VARIABLE_REMAP = {
    sender: [
        { from: /\bsender\b(?!\s*\()/g, to: 'm.sender' },
        { from: /\bfrom\b(?!\s*\()/g, to: 'm.chat' },
        { from: /\bparticipant\b/g, to: 'm.sender' }
    ],
    message: [
        { from: /\bmessage\.(body|text|content|msg)\b/g, to: 'body' },
        { from: /\bmsg\.(body|text|content)\b/g, to: 'body' },
        { from: /\bm\.(body|text|content)\b/g, to: 'body' },
        { from: /\bchat\.(body|text)\b/g, to: 'body' },
        { from: /\bfullMsg\b/g, to: 'm' },
        { from: /\bmessages\[0\]\b/g, to: 'm' },
        { from: /\bmsg\b(?!\s*\.|\.)/g, to: 'm' }
    ],
    socket: [
        { from: /\bsatanic\b/g, to: 'bulter' },
        { from: /\bnaze\b/g, to: 'bulter' },
        { from: /\bsock\b/g, to: 'bulter' },
        { from: /\bclient\b(?=\s*\.send)/g, to: 'bulter' },
        { from: /\bconn\b(?=\s*\.send)/g, to: 'bulter' },
        { from: /\bwa\b(?=\s*\.send)/g, to: 'bulter' },
        { from: /\bbot\b(?=\s*\.send)/g, to: 'bulter' }
    ],
    args: [
        { from: /\barg\b/g, to: 'args' },
        { from: /\barguments\b/g, to: 'args' },
        { from: /\bparams\b/g, to: 'args' },
        { from: /\bparameter\b/g, to: 'args' }
    ],
    reply: [
        { from: /\bsendReply\s*\(/g, to: 'reply(' },
        { from: /\bsendText\s*\(/g, to: 'reply(' },
        { from: /\bsendMsg\s*\(/g, to: 'reply(' },
        { from: /\breplyMsg\s*\(/g, to: 'reply(' },
        { from: /\bsendMessage\s*\(\s*sender\s*,/g, to: 'bulter.sendMessage(m.chat,' },
        { from: /\bclient\.reply\s*\(/g, to: 'reply(' }
    ],
    prefix: [
        { from: /\bpref\b/g, to: 'prefix' },
        { from: /\bprefixBot\b/g, to: 'prefix' },
        { from: /\bPREFIX\b/g, to: 'prefix' }
    ],
    pushname: [
        { from: /\bpushName\b/g, to: 'pushname' },
        { from: /\buserName\b/g, to: 'pushname' },
        { from: /\bname\b(?=\s*[,;)])/g, to: 'pushname' }
    ]
};

const CODE_BLOCK_PATTERNS = [
    /```(?:javascript|js|node|jsx|ts|typescript)?\n?([\s\S]*?)```/gi,
    /`((?:case|switch|if|async|function|const|let|var)[\s\S]{10,}?)`/gi,
    /~~~(?:js|javascript)?\n?([\s\S]*?)~~~/gi
];

const CASE_EXTRACTION_PATTERNS = [
    /case\s+['"`]([^'"`]+)['"`]\s*:[\s\S]*?break\s*;/g,
    /case\s+['"`]([^'"`]+)['"`]\s*:\s*\{[\s\S]*?\}/g,
    /if\s*\(\s*(?:command|cmd|text|body)\s*===?\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?(?=\n(?:if|else|break|case)|$)/g,
    /if\s*\(\s*['"`]([^'"`]+)['"`]\s*\.includes\s*\([\s\S]*?\)[\s\S]*?(?=\n(?:if|else|break|case)|$)/g
];

const COMMAND_PATTERNS = [
    /command\s*===?\s*['"`]([^'"`]+)['"`]/g,
    /cmd\s*===?\s*['"`]([^'"`]+)['"`]/g,
    /q\s*===?\s*['"`]([^'"`]+)['"`]/g,
    /text\s*===?\s*['"`]([^'"`]+)['"`]/g,
    /\[\s*['"`]([^'"`]+)['"`]\s*\]\.includes\s*\(/g,
    /\.includes\s*\(\s*(?:command|cmd)\s*\)/g,
    /case\s+['"`]([^'"`]+)['"`]/g,
    /prefix\s*\+\s*['"`]([^'"`]+)['"`]/g,
    /'([^']+)'\s*===?\s*command/g,
    /"([^"]+)"\s*===?\s*command/g
];

const FUNCTION_PATTERNS = [
    { re: /axios\.(get|post|put|delete|patch)\s*\(/g, type: 'http_request' },
    { re: /fs\.(readFile|writeFile|readFileSync|writeFileSync|existsSync|mkdirSync)\s*\(/g, type: 'filesystem' },
    { re: /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g, type: 'module_import' },
    { re: /crypto\.(createHash|randomBytes|createCipher)\s*\(/g, type: 'crypto' },
    { re: /\.sendMessage\s*\(/g, type: 'send_message' },
    { re: /\.downloadMediaMessage\s*\(/g, type: 'download_media' },
    { re: /\.groupParticipantsUpdate\s*\(/g, type: 'group_action' },
    { re: /fetch\s*\(/g, type: 'fetch_request' },
    { re: /JSON\.(parse|stringify)\s*\(/g, type: 'json_ops' },
    { re: /await\s+/g, type: 'async_op' }
];

function _checkRateLimit(sender, action, max = 5, windowMs = 120000) {
    const key = `${sender}:${action}`;
    const now = Date.now();
    const record = _rateLimit.get(key) || { hits: [], blocked: 0 };
    record.hits = record.hits.filter(t => (now - t) < windowMs);
    if (record.hits.length >= max) {
        record.blocked++;
        _rateLimit.set(key, record);
        const wait = Math.ceil((windowMs - (now - record.hits[0])) / 1000);
        return { allowed: false, wait, blocked: record.blocked };
    }
    record.hits.push(now);
    _rateLimit.set(key, record);
    return { allowed: true, remaining: max - record.hits.length };
}

function _logHistory(action, detail = '', actor = 'system') {
    const db = _read(HISTORY_PATH, []);
    db.push({
        id: crypto.randomBytes(6).toString('hex'),
        ts: Date.now(),
        time: new Date().toLocaleString('id-ID'),
        action,
        detail: String(detail).slice(0, 200),
        actor: actor?.split('@')[0] || 'system'
    });
    if (db.length > 500) db.splice(0, db.length - 300);
    _write(HISTORY_PATH, db);
}

function _computeHash(text) {
    return crypto.createHash('md5').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
}

function _detectSourceBot(code) {
    const codeStr = code.toLowerCase();
    const detectedBots = [];
    for (const bot of KNOWN_BOT_PATTERNS) {
        const socketNames = ['satanic', 'naze', 'sock', 'client', 'conn', 'anya', 'arugaz', 'xyz', 'xbot', 'wa', 'bot'];
        for (const name of socketNames) {
            if (codeStr.includes(name + '.sendmessage') || codeStr.includes(name + '.reply')) {
                detectedBots.push({ bot: bot.name, socketVar: name, confidence: 0.9 });
                break;
            }
        }
    }

    const prefixMatches = ['.', '!', '#', '/', '?', '>', '+', '*'].filter(p => {
        const prefixPattern = new RegExp(`prefix\\s*===?\\s*['"\`]\\${p}['"\`]`, 'i');
        return prefixPattern.test(code);
    });

    return {
        bots: detectedBots,
        detectedPrefixes: prefixMatches,
        hasAsync: /\basync\b/.test(code),
        hasAwait: /\bawait\b/.test(code),
        hasArrowFunc: /=>/.test(code),
        framework: codeStr.includes('baileys') ? 'baileys' :
                   codeStr.includes('whatsapp-web') ? 'wweb.js' :
                   codeStr.includes('venom') ? 'venom-bot' : 'unknown'
    };
}

function _extractAllCodeBlocks(text) {
    if (!text || text.length < 5) return [];
    const blocks = [];
    const seen = new Set();

    for (const pattern of CODE_BLOCK_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const code = (match[1] || match[0]).trim();
            const hash = _computeHash(code);
            if (!seen.has(hash) && code.length >= 10) {
                seen.add(hash);
                blocks.push({
                    code,
                    hash,
                    source: 'code_block',
                    format: match[0].startsWith('```') ? 'markdown' : match[0].startsWith('~~~') ? 'tilde' : 'backtick',
                    length: code.length,
                    lineCount: code.split('\n').length
                });
            }
        }
    }

    const codeIndicators = [
        /case\s+['"`]/, /if\s*\(\s*command/, /switch\s*\(\s*command/,
        /\.sendMessage\s*\(/, /async\s*\(/, /await\s+/,
        /function\s+\w+/, /const\s+\w+\s*=/, /let\s+\w+\s*=/
    ];

    const looksLikeCode = codeIndicators.some(p => p.test(text));
    if (looksLikeCode && blocks.length === 0) {
        const hash = _computeHash(text);
        if (!seen.has(hash)) {
            blocks.push({
                code: text.trim(),
                hash,
                source: 'raw_text',
                format: 'plain',
                length: text.length,
                lineCount: text.split('\n').length
            });
        }
    }

    return blocks;
}

function _extractCaseBlocks(code) {
    const cases = [];
    const seen = new Set();

    for (const pattern of CASE_EXTRACTION_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(code)) !== null) {
            const fullMatch = match[0];
            const cmdName = match[1]?.toLowerCase().trim();
            if (!cmdName || seen.has(cmdName + ':' + _computeHash(fullMatch))) continue;
            seen.add(cmdName + ':' + _computeHash(fullMatch));
            cases.push({
                cmdName,
                code: fullMatch,
                type: 'switch_case',
                startIdx: match.index,
                endIdx: match.index + fullMatch.length
            });
        }
    }

    return cases;
}

function _extractCommandNames(code) {
    const commands = new Set();
    for (const pattern of COMMAND_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(code)) !== null) {
            const cmd = match[1]?.toLowerCase().trim();
            if (cmd && cmd.length > 0 && cmd.length < 40 && /^[a-z0-9_-]+$/.test(cmd)) {
                commands.add(cmd);
            }
        }
    }
    return [...commands];
}

function _analyzeFunctions(code) {
    const found = [];
    const seen = new Set();
    for (const { re, type } of FUNCTION_PATTERNS) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(code)) !== null) {
            const key = type + (match[1] || '');
            if (!seen.has(key)) {
                seen.add(key);
                found.push({ type, match: match[0].slice(0, 50), param: match[1] || null });
            }
        }
    }
    return found;
}

function _extractComments(code) {
    const comments = [];
    const lineComments = code.match(/\/\/\s*(.+)/g) || [];
    const blockComments = code.match(/\/\*[\s\S]*?\*\//g) || [];
    lineComments.forEach(c => comments.push(c.replace(/^\/\/\s*/, '').trim()));
    blockComments.forEach(c => comments.push(c.replace(/^\/\*\s*|\s*\*\/$/g, '').trim()));
    return comments.slice(0, 10);
}

function _deepAnalyzeCode(code) {
    const lines = code.split('\n');
    const analysis = {
        lineCount: lines.length,
        charCount: code.length,
        hasAsync: /\basync\b/.test(code),
        hasAwait: /\bawait\b/.test(code),
        hasTryCatch: /try\s*\{/.test(code) && /catch\s*\(/.test(code),
        hasReply: /\breply\s*\(/.test(code) || /sendReply\s*\(/.test(code),
        hasAxios: /\baxios\b/.test(code),
        hasFetch: /\bfetch\s*\(/.test(code),
        hasFs: /\bfs\s*\./.test(code),
        hasCrypto: /\bcrypto\s*\./.test(code),
        hasBuffer: /\bBuffer\s*\./.test(code),
        hasRegex: /new\s+RegExp|\/[^/]+\/[gimsuy]*/.test(code),
        hasConditional: (/\bif\s*\(/.test(code) ? (code.match(/\bif\s*\(/g) || []).length : 0),
        hasLoop: /\bfor\s*\(/.test(code) || /\bwhile\s*\(/.test(code),
        hasMediaDownload: /downloadMediaMessage|downloadMedia|getStream/.test(code),
        hasGroupOps: /groupParticipantsUpdate|groupUpdateSubject|groupSettingUpdate/.test(code),
        hasDatabaseOps: /readFileSync|writeFileSync|JSON\.parse|JSON\.stringify/.test(code),
        complexity: 0,
        imports: [],
        detectedVars: [],
        apiEndpoints: [],
        functionCalls: _analyzeFunctions(code),
        comments: _extractComments(code)
    };

    const requireMatches = code.match(/require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g) || [];
    analysis.imports = requireMatches.map(r => r.match(/['"`]([^'"`]+)['"`]/)?.[1]).filter(Boolean);

    const urlMatches = code.match(/https?:\/\/[^\s'"`]+/g) || [];
    analysis.apiEndpoints = [...new Set(urlMatches.map(u => {
        try { return new URL(u).hostname; } catch { return u.slice(0, 60); }
    }))];

    const socketVars = ['satanic', 'naze', 'sock', 'client', 'conn', 'anya', 'arugaz', 'wa', 'bot'];
    const msgVars = ['message', 'msg', 'fullMsg', 'ctx', 'info'];
    const senderVars = ['sender', 'from', 'jid', 'participant'];

    analysis.detectedVars = {
        socket: socketVars.filter(v => new RegExp(`\\b${v}\\s*\\.`).test(code)),
        message: msgVars.filter(v => new RegExp(`\\b${v}\\s*[\\.[]`).test(code)),
        sender: senderVars.filter(v => new RegExp(`\\b${v}\\b`).test(code))
    };

    let complexityScore = 0;
    if (analysis.hasAsync) complexityScore += 2;
    if (analysis.hasTryCatch) complexityScore += 1;
    if (analysis.hasAxios || analysis.hasFetch) complexityScore += 2;
    if (analysis.hasFs) complexityScore += 2;
    if (analysis.hasMediaDownload) complexityScore += 3;
    if (analysis.hasGroupOps) complexityScore += 2;
    complexityScore += Math.min(5, analysis.hasConditional);
    complexityScore += analysis.functionCalls.length * 0.5;
    analysis.complexity = Math.round(complexityScore);

    return analysis;
}

function _remapVariables(code, sourceInfo) {
    let result = code;
    const remapLog = [];

    for (const socketVar of (sourceInfo?.detectedVars?.socket || [])) {
        if (socketVar !== 'bulter') {
            const re = new RegExp(`\\b${socketVar}\\b(?=\\s*\\.)`, 'g');
            const count = (result.match(re) || []).length;
            if (count > 0) {
                result = result.replace(re, 'bulter');
                remapLog.push({ from: socketVar, to: 'bulter', count, category: 'socket' });
            }
        }
    }

    for (const [category, rules] of Object.entries(VARIABLE_REMAP)) {
        for (const rule of rules) {
            rule.from.lastIndex = 0;
            const count = (result.match(rule.from) || []).length;
            if (count > 0) {
                result = result.replace(rule.from, rule.to);
                if (count > 0) remapLog.push({ from: rule.from.toString(), to: rule.to, count, category });
            }
            rule.from.lastIndex = 0;
        }
    }

    return { code: result, remapLog };
}

function _normalizeCase(code, cmdName, analysis) {
    let result = code.trim();

    const hasCase = /^case\s+['"`]/.test(result);
    if (!hasCase) {
        if (/^if\s*\(/.test(result)) {
            result = `case '${cmdName}': {\n${result}\n}`;
        } else {
            result = `case '${cmdName}': {\n    ${result.split('\n').join('\n    ')}\n}`;
        }
    }

    if (!result.includes('try') && (analysis?.hasAsync || analysis?.hasAwait)) {
        const innerContent = result.replace(/^case\s+['"`][^'"`]+['"`]\s*:\s*\{?\n?/, '').replace(/\n?\}?\s*$/, '');
        const indented = innerContent.split('\n').map(l => '        ' + l).join('\n');
        result = `case '${cmdName}': {\n    try {\n${indented}\n    } catch (e) {\n        reply('❌ Error: ' + e.message);\n    }\n}`;
    }

    if (!result.includes('bulter.sendMessage(m.chat, { react')) {
        const caseStart = result.indexOf(':') + 1;
        const openBrace = result.indexOf('{', caseStart);
        const insertPos = openBrace !== -1 ? openBrace + 1 : caseStart;
        const reactLine = `\n    bulter.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });`;
        result = result.slice(0, insertPos) + reactLine + result.slice(insertPos);
    }

    if (!/break\s*;?\s*$/.test(result.trimEnd())) {
        result = result.trimEnd() + '\n    break;\n}';
    }

    const lines = result.split('\n');
    const normalized = lines.map(line => {
        if (!line.trim()) return '';
        const depth = line.match(/^\s*/)[0].length;
        const indent = Math.round(depth / 4) * 4;
        return ' '.repeat(indent) + line.trimStart();
    });

    return normalized.join('\n');
}

function _inferCommandDescription(code, cmdName, analysis) {
    const descriptions = [];

    if (analysis.hasMediaDownload) descriptions.push('download media');
    if (analysis.hasGroupOps) descriptions.push('group operations');
    if (analysis.hasAxios || analysis.hasFetch) {
        if (analysis.apiEndpoints.length > 0) {
            descriptions.push(`fetch dari ${analysis.apiEndpoints.slice(0, 2).join(', ')}`);
        } else {
            descriptions.push('HTTP request');
        }
    }
    if (analysis.hasDatabaseOps) descriptions.push('database operations');
    if (analysis.hasCrypto) descriptions.push('enkripsi/hashing');
    if (analysis.hasBuffer) descriptions.push('buffer/binary processing');

    const comments = analysis.comments;
    if (comments.length > 0) {
        const relevant = comments.find(c => c.toLowerCase().includes(cmdName.toLowerCase()) || c.length < 80);
        if (relevant) descriptions.unshift(relevant);
    }

    if (descriptions.length === 0) {
        const lines = code.split('\n');
        const firstReplyLine = lines.find(l => l.includes('reply(') || l.includes('sendMessage('));
        if (firstReplyLine) {
            const textMatch = firstReplyLine.match(/['"`]([^'"`]{5,50})['"`]/);
            if (textMatch) descriptions.push(textMatch[1].slice(0, 60));
        }
    }

    return descriptions.length > 0 ? descriptions.join(' + ') : `command ${cmdName}`;
}

async function _getValidNonce() {
    const now = Date.now();
    if (_nonceCache.value && (now - _nonceCache.ts) < _nonceCache.ttl) return _nonceCache.value;
    try {
        const res = await axios.get('https://chat-deep.ai/deepseek-chat/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36' },
            timeout: 10000
        });
        const patterns = [
            /var\s+nonce\s*=\s*['"]([^'"]+)['"]/,
            /data-nonce=["']([^"']+)["']/,
            /"nonce":"([^"]+)"/
        ];
        for (const p of patterns) {
            const m = res.data.match(p);
            if (m?.[1]) {
                _nonceCache.value = m[1];
                _nonceCache.ts = now;
                return m[1];
            }
        }
        return Date.now().toString();
    } catch { return Date.now().toString(); }
}

async function _aiConvertCode(rawCode, cmdName, analysis, mode = 'convert') {
    const cacheKey = _computeHash(rawCode + cmdName + mode);
    const cached = _conversionCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < 300000) return cached.result;

    const BULTER_CONTEXT = `
Kamu adalah code converter untuk bot WhatsApp Baileys (bulter.js).
Tugasmu adalah mengkonversi case/command dari bot lain menjadi format yang kompatibel 100% dengan bulter.js.

VARIABEL BULTER.JS (WAJIB DIPAKAI):
- m            : object pesan (m.chat, m.sender, m.mtype, m.key, m.quoted, m.mentionedJid, m.pushName)
- bulter       : WA socket (bulter.sendMessage, bulter.downloadMediaMessage, dll)
- text / q     : teks setelah command
- args         : array argumen
- prefix       : prefix command
- command      : nama command
- body         : full pesan mentah
- reply(teks)  : kirim reply
- isOwner, isCreator, isAdmins, isBotAdmins, isPremium : boolean role
- groupName, groupAdmins, participants, groupMetadata : data grup
- pushname     : nama pengirim
- fakeQuoted   : object quoted standar
- fs, path, axios, crypto : modul Node.js

ATURAN KONVERSI WAJIB:
1. Ganti SEMUA variabel socket (satanic/naze/sock/client/conn/bot/wa) → bulter
2. Ganti SEMUA variabel message/msg/fullMsg → m
3. Ganti SEMUA sender/from/participant → m.sender
4. Ganti sendReply/sendText/sendMsg/replyMsg → reply()
5. Ganti pref/PREFIX/prefixBot → prefix
6. Pertahankan logika asli, hanya ubah nama variabel
7. Tambahkan try/catch jika ada operasi async
8. Tambahkan react emoji di awal
9. Akhiri dengan break;
10. Jangan import/require module baru
`.trim();

    const prompts = {
        convert: `${BULTER_CONTEXT}

TUGAS: Konversi kode berikut dari format bot lain ke format bulter.js:

KODE ASLI (dari ${analysis.detectedVars?.socket?.[0] || 'bot tidak dikenal'}):
\`\`\`js
${rawCode}
\`\`\`

ANALISIS:
- Command: ${cmdName}
- Async: ${analysis.hasAsync}
- Socket vars ditemukan: ${JSON.stringify(analysis.detectedVars?.socket || [])}
- Message vars: ${JSON.stringify(analysis.detectedVars?.message || [])}
- Functions: ${analysis.functionCalls.map(f => f.type).join(', ')}

OUTPUT: Hanya kode yang sudah dikonversi, tanpa penjelasan, tanpa markdown fence.
Mulai dari: case '${cmdName}':`,

        optimize: `${BULTER_CONTEXT}

TUGAS: Optimasi dan perbaiki kode case berikut untuk bulter.js:
- Tambahkan validasi input yang lebih baik
- Perbaiki error handling
- Optimasi struktur kode
- Pertahankan fungsi asli

KODE:
\`\`\`js
${rawCode}
\`\`\`

OUTPUT: Kode yang sudah dioptimasi, tanpa penjelasan, tanpa markdown fence.
Mulai dari: case '${cmdName}':`,

        reverse_engineer: `${BULTER_CONTEXT}

TUGAS: Buat ulang fungsionalitas command berikut dari awal untuk bulter.js:
Analisis pesan bot ini dan buat case yang menghasilkan output serupa.

TEKS/OUTPUT BOT:
${rawCode}

Command yang terdeteksi: ${cmdName}

Buat case yang fungsional dengan fitur yang sama.
OUTPUT: Kode case JavaScript murni, tanpa penjelasan, tanpa markdown fence.
Mulai dari: case '${cmdName}':`,

        enhance: `${BULTER_CONTEXT}

TUGAS: Tingkatkan kualitas kode ini dengan menambahkan fitur:
1. Loading indicator yang lebih baik
2. Format pesan yang lebih rapi
3. Error message yang informatif
4. Validasi input yang lengkap

KODE ASLI:
\`\`\`js
${rawCode}
\`\`\`

OUTPUT: Kode yang sudah ditingkatkan, tanpa penjelasan.
Mulai dari: case '${cmdName}':`,

        multi_extract: `${BULTER_CONTEXT}

TUGAS: Ekstrak dan konversi SEMUA case/command yang ada di kode ini:

KODE SUMBER:
\`\`\`js
${rawCode}
\`\`\`

Identifikasi setiap command, konversi masing-masing ke format bulter.js.
Format output untuk setiap command:
---COMMAND:nama_command---
[kode case]
---END---

OUTPUT: Hanya blok code terpisah dengan marker, tanpa penjelasan.`
    };

    const nonce = await _getValidNonce();
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36',
        'Origin': 'https://chat-deep.ai',
        'Referer': 'https://chat-deep.ai/deepseek-chat/',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
    };

    const doRequest = async (nonceVal) => {
        const form = new URLSearchParams();
        form.append('action', 'deepseek_chat');
        form.append('message', prompts[mode] || prompts.convert);
        form.append('nonce', nonceVal);
        form.append('stream', 'false');
        form.append('max_tokens', '4000');
        return axios.post('https://chat-deep.ai/wp-admin/admin-ajax.php', form.toString(), { headers, timeout: 45000 });
    };

    const extractText = (data) => {
        const t = data?.data?.response || data?.data?.message || data?.response || data?.message || data?.content
            || (data?.choices?.[0]?.message?.content) || (typeof data === 'string' ? data : null);
        if (t) return t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        return null;
    };

    let retries = 3;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const nonceVal = attempt === 0 ? nonce : Date.now().toString();
            let res = await doRequest(nonceVal);

            if (res.data?.success === false) {
                const err = res.data.data?.message || '';
                if (err.includes('invalid_nonce') || err.includes('Security check')) {
                    _nonceCache.value = null;
                    res = await doRequest(Date.now().toString());
                }
            }

            const text = extractText(res.data);
            if (text) {
                _conversionCache.set(cacheKey, { result: text, ts: Date.now() });
                return text;
            }
        } catch (e) {
            if (attempt === retries - 1) throw new Error('AI gagal: ' + e.message);
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
    }
    throw new Error('AI tidak memberikan respons valid');
}

function _cleanAIOutput(raw) {
    return raw
        .replace(/^```(?:javascript|js|node)?\n?/gm, '')
        .replace(/^```\s*$/gm, '')
        .replace(/^\s*\/\/ OUTPUT:.*$/gm, '')
        .replace(/^\s*\/\/ CONVERTED:.*$/gm, '')
        .trim();
}

function _parseMultiCommandOutput(raw) {
    const results = [];
    const blocks = raw.split(/---COMMAND:([^-]+)---/);

    for (let i = 1; i < blocks.length; i += 2) {
        const cmdName = blocks[i]?.trim().toLowerCase();
        const codeBlock = blocks[i + 1]?.replace(/---END---.*$/s, '').trim();
        if (cmdName && codeBlock) {
            results.push({ cmdName, code: _cleanAIOutput(codeBlock) });
        }
    }

    if (results.length === 0) {
        const caseMatches = raw.matchAll(/case\s+['"`]([^'"`]+)['"`]\s*:([\s\S]*?)(?=case\s+['"`]|$)/g);
        for (const match of caseMatches) {
            const cmdName = match[1].toLowerCase().trim();
            const code = `case '${cmdName}':${match[2].trim()}`;
            if (cmdName && code.length > 20) {
                results.push({ cmdName, code: _cleanAIOutput(code) });
            }
        }
    }

    return results;
}

function _validateConvertedCode(code) {
    const issues = [];
    const warnings = [];

    const dangerousPatterns = [
        { re: /require\s*\(\s*['"]child_process['"]\s*\)/i, label: 'child_process' },
        { re: /process\.exit\s*\(/i, label: 'process.exit' },
        { re: /eval\s*\(/i, label: 'eval()' },
        { re: /new\s+Function\s*\(/i, label: 'new Function()' },
        { re: /\.exec\s*\(\s*[`'"]/i, label: 'shell exec' }
    ];

    for (const { re, label } of dangerousPatterns) {
        if (re.test(code)) issues.push(label);
    }

    const hasBreak = /break\s*;?\s*\}?\s*$/.test(code.trim());
    const startsWithCase = /^case\s+['"]/.test(code.trim());
    const hasBulter = /\bbulter\b/.test(code);
    const hasMObject = /\bm\.(chat|sender|key|quoted|mtype)\b/.test(code);
    const hasNonBulterSocket = /\b(satanic|naze|sock|client|conn)\s*\.send/i.test(code);
    const syntaxCheck = _validateSyntaxBasic(code);

    if (!hasBreak) warnings.push('Tidak ada break statement');
    if (!startsWithCase) warnings.push('Tidak dimulai dengan case');
    if (!hasBulter) warnings.push('Variabel bulter tidak ditemukan');
    if (hasNonBulterSocket) warnings.push('Masih ada socket variable yang belum dikonversi');

    return {
        safe: issues.length === 0,
        issues,
        warnings,
        hasBreak,
        startsWithCase,
        hasBulter,
        hasMObject,
        syntaxErrors: syntaxCheck.errors,
        valid: issues.length === 0 && syntaxCheck.valid
    };
}

function _validateSyntaxBasic(code) {
    let braceDepth = 0;
    let parenDepth = 0;
    let inStr = false;
    let strChar = '';
    let inLineComment = false;
    let inBlockComment = false;
    const errors = [];

    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        const next = code[i + 1] || '';

        if (ch === '\n') { inLineComment = false; continue; }
        if (inLineComment) continue;
        if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
        if (inStr) { if (ch === '\\') { i++; continue; } if (ch === strChar) inStr = false; continue; }
        if (ch === '/' && next === '/') { inLineComment = true; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strChar = ch; continue; }

        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
        if (ch === '(') parenDepth++;
        if (ch === ')') parenDepth--;

        if (braceDepth < 0) errors.push(`Kurung kurawal berlebih`);
        if (parenDepth < 0) errors.push(`Kurung biasa berlebih`);
    }

    if (braceDepth !== 0) errors.push(`Kurung kurawal tidak seimbang (${braceDepth})`);
    if (parenDepth !== 0) errors.push(`Kurung biasa tidak seimbang (${parenDepth})`);

    return { valid: errors.length === 0, errors };
}

function _formatCodePreview(code, maxLen = 2500) {
    const lines = code.split('\n');
    const header = `📄 *PREVIEW CODE* (${lines.length} baris)\n\`\`\`\n`;
    const body = code.length > maxLen ? code.slice(0, maxLen) + '\n... (terpotong)' : code;
    return header + body + '\n```';
}

function _extractCasesFromBulter(cmdName = null) {
    if (!fs.existsSync(BULTER_PATH)) throw new Error('bulter.js tidak ditemukan');
    const content = fs.readFileSync(BULTER_PATH, 'utf8');
    const results = [];

    if (cmdName) {
        const startMarker = `// === ADDCASE: ${cmdName} (`;
        const endMarker = `// === END ADDCASE: ${cmdName} ===`;
        const si = content.indexOf(startMarker);
        const ei = content.indexOf(endMarker);
        if (si !== -1 && ei !== -1) {
            const code = content.slice(content.indexOf('\n', si) + 1, ei).trim();
            results.push({ cmdName, code, source: 'addcase_marker', lineStart: content.slice(0, si).split('\n').length });
        } else {
            const casePattern = new RegExp(`case\\s+['"\`]${cmdName}['"\`]\\s*:[\\s\\S]*?break\\s*;`, 'i');
            const match = content.match(casePattern);
            if (match) {
                const lineStart = content.slice(0, content.indexOf(match[0])).split('\n').length;
                results.push({ cmdName, code: match[0], source: 'switch_case', lineStart });
            }
        }
    } else {
        const markerPattern = /\/\/ === ADDCASE: (\S+) \([^)]+\)(?: \[[^\]]+\])? ===([\s\S]*?)\/\/ === END ADDCASE: \1 ===/g;
        let match;
        while ((match = markerPattern.exec(content)) !== null) {
            const name = match[1];
            const code = match[2].trim();
            const lineStart = content.slice(0, match.index).split('\n').length;
            results.push({ cmdName: name, code, source: 'addcase_marker', lineStart });
        }

        const switchContent = content.match(/switch\s*\(\s*command\s*\)\s*\{([\s\S]*?)\}\s*(?:break|default)/);
        if (switchContent) {
            const casePattern = /case\s+['"`]([^'"`]+)['"`]\s*:[\s\S]*?(?=case\s+['"`]|default:|break\s*;)/g;
            let caseMatch;
            while ((caseMatch = casePattern.exec(switchContent[1])) !== null) {
                const name = caseMatch[1];
                if (!results.find(r => r.cmdName === name)) {
                    results.push({ cmdName: name, code: caseMatch[0].trim(), source: 'switch_native', lineStart: 0 });
                }
            }
        }
    }

    return results;
}

function _savePending(cmdName, data) {
    const db = _read(PENDING_PATH, {});
    const hash = _computeHash(data.code || '');
    db[cmdName] = {
        ...data,
        updatedAt: Date.now(),
        codeHash: hash,
        version: (db[cmdName]?.version || 0) + 1,
        previousVersions: db[cmdName]
            ? [...(db[cmdName].previousVersions || []), { code: db[cmdName].code, updatedAt: db[cmdName].updatedAt, version: db[cmdName].version }].slice(-5)
            : []
    };
    _write(PENDING_PATH, db);
}

function _getPending(cmdName) { return _read(PENDING_PATH, {})[cmdName] || null; }

function _delPending(cmdName) {
    const db = _read(PENDING_PATH, {});
    delete db[cmdName];
    _write(PENDING_PATH, db);
}

function _saveExtracted(id, data) {
    const db = _read(EXTRACTED_PATH, {});
    db[id] = { ...data, savedAt: Date.now() };
    const keys = Object.keys(db).sort((a, b) => db[a].savedAt - db[b].savedAt);
    if (keys.length > 100) keys.slice(0, keys.length - 70).forEach(k => delete db[k]);
    _write(EXTRACTED_PATH, db);
}

function _saveConverted(cmdName, data) {
    const db = _read(CONVERTED_PATH, {});
    db[cmdName] = { ...data, convertedAt: Date.now() };
    if (Object.keys(db).length > 200) {
        const entries = Object.entries(db).sort((a, b) => a[1].convertedAt - b[1].convertedAt);
        entries.slice(0, entries.length - 150).forEach(([k]) => delete db[k]);
    }
    _write(CONVERTED_PATH, db);
}

async function handleGetCase(ctx) {
    const { m, bulter: sock, command, text, args, reply, isOwner, isCreator, fakeQuoted, prefix } = ctx;

    const _guard = () => {
        if (!isOwner && !isCreator) {
            reply('🚫 *Akses ditolak!*\n\nSistem GetCase hanya untuk owner bot.');
            return false;
        }
        return true;
    };

    if (command === 'getcase') {
        if (!_guard()) return;

        const rl = _checkRateLimit(m.sender, 'getcase', 5, 120000);
        if (!rl.allowed) return reply(`⏳ *Rate limit!* Tunggu ${rl.wait} detik.\n_Total blocked: ${rl.blocked}x_`);

        const rawArg = text?.trim() || '';

        if (!rawArg || rawArg === 'help') {
            return reply(
                `🔧 *GETCASE — HELP*\n\n` +
                `*Ambil dari Reply:*\n` +
                `Reply pesan berisi code + \`${prefix}getcase\`\n` +
                `Reply + \`${prefix}getcase <nama_command>\`\n` +
                `Reply + \`${prefix}getcase --multi\` (multiple commands)\n` +
                `Reply + \`${prefix}getcase --optimize\` (dengan optimasi AI)\n` +
                `Reply + \`${prefix}getcase --enhance\` (dengan enhancement AI)\n` +
                `Reply + \`${prefix}getcase --noai\` (tanpa AI, manual convert)\n\n` +
                `*Ambil dari bulter.js:*\n` +
                `\`${prefix}getcase from <command>\` — ambil 1 case\n` +
                `\`${prefix}getcase list\` — daftar injected cases\n` +
                `\`${prefix}getcase export <command>\` — export sebagai file\n` +
                `\`${prefix}getcase exportall\` — export semua injected\n\n` +
                `*Kelola Hasil:*\n` +
                `\`${prefix}getcase preview <command>\` — preview pending\n` +
                `\`${prefix}getcase save <command>\` — inject ke bulter.js\n` +
                `\`${prefix}getcase send <command>\` — kirim sebagai file\n` +
                `\`${prefix}getcase discard <command>\` — hapus pending\n` +
                `\`${prefix}getcase retry <command> [mode]\` — regenerate AI\n` +
                `\`${prefix}getcase history\` — riwayat konversi\n` +
                `\`${prefix}getcase stats\` — statistik`
            );
        }

        if (rawArg.startsWith('from ')) {
            const targetCmd = rawArg.slice(5).trim().toLowerCase();
            if (!targetCmd) return reply(`❌ Format: \`${prefix}getcase from <command>\``);

            sock.sendMessage(m.chat, { react: { text: '🔍', key: m.key } });

            let extracted;
            try {
                const results = _extractCasesFromBulter(targetCmd);
                if (results.length === 0) return reply(`❌ Case \`${targetCmd}\` tidak ditemukan di bulter.js.`);
                extracted = results[0];
            } catch (e) {
                return reply(`❌ Error: ${e.message}`);
            }

            const analysis = _deepAnalyzeCode(extracted.code);
            const preview = _formatCodePreview(extracted.code);
            const id = _computeHash(extracted.code);
            _saveExtracted(id, { ...extracted, analysis });

            sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
            await sock.sendMessage(m.chat, {
                text:
                    `📦 *GETCASE — DARI BULTER.JS*\n\n` +
                    `📌 Command: \`${prefix}${extracted.cmdName}\`\n` +
                    `📍 Source: \`${extracted.source}\`\n` +
                    `📏 Lines: ${analysis.lineCount} | Chars: ${analysis.charCount}\n` +
                    `📊 Complexity: ${analysis.complexity}\n` +
                    `🔧 Functions: ${analysis.functionCalls.map(f => f.type).join(', ') || 'none'}\n\n` +
                    `${preview}\n\n` +
                    `*Actions:*\n` +
                    `📤 Export → \`${prefix}getcase export ${extracted.cmdName}\`\n` +
                    `📋 Send → \`${prefix}getcase send ${extracted.cmdName}\``
            }, { quoted: fakeQuoted });
            return;
        }

        if (rawArg === 'list') {
            sock.sendMessage(m.chat, { react: { text: '📋', key: m.key } });

            let results;
            try { results = _extractCasesFromBulter(); } catch (e) { return reply(`❌ ${e.message}`); }

            if (results.length === 0) return reply(`📋 Tidak ada injected case di bulter.js.`);

            let output = `📦 *CASE LIST — BULTER.JS (${results.length})*\n\n`;
            for (const r of results) {
                const a = _deepAnalyzeCode(r.code);
                output += `• \`${r.cmdName}\` [${r.source}]`;
                if (r.lineStart) output += ` baris ~${r.lineStart}`;
                output += ` (${a.lineCount} lines, cx:${a.complexity})`;
                if (a.hasAsync) output += ` ⚡`;
                if (a.hasAxios || a.hasFetch) output += ` 🌐`;
                if (a.hasMediaDownload) output += ` 📎`;
                output += `\n`;
            }

            output += `\n_Gunakan \`${prefix}getcase from <cmd>\` untuk lihat code_\n`;
            output += `_Gunakan \`${prefix}getcase exportall\` untuk export semua_`;

            if (output.length > 4000) output = output.slice(0, 3950) + '\n... (terpotong)';
            return reply(output);
        }

        if (rawArg.startsWith('export ') || rawArg === 'exportall') {
            const isAll = rawArg === 'exportall';
            const targetCmd = isAll ? null : rawArg.slice(7).trim().toLowerCase();

            sock.sendMessage(m.chat, { react: { text: '📤', key: m.key } });

            let results;
            try {
                results = _extractCasesFromBulter(isAll ? null : targetCmd);
            } catch (e) { return reply(`❌ ${e.message}`); }

            if (results.length === 0) return reply(`❌ ${isAll ? 'Tidak ada case' : `Case \`${targetCmd}\` tidak ditemukan`}.`);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const filename = isAll ? `all_cases_${timestamp}.js` : `case_${targetCmd}_${timestamp}.js`;

            let fileContent = `'use strict';\n`;
            fileContent += `/* GetCase Export — ${new Date().toLocaleString('id-ID')} */\n`;
            fileContent += `/* Total: ${results.length} case(s) */\n\n`;

            for (const r of results) {
                const a = _deepAnalyzeCode(r.code);
                fileContent += `/* === ${r.cmdName.toUpperCase()} ===\n`;
                fileContent += ` * Source: ${r.source}\n`;
                fileContent += ` * Complexity: ${a.complexity}\n`;
                fileContent += ` * Functions: ${a.functionCalls.map(f => f.type).join(', ') || 'none'}\n`;
                fileContent += ` */\n`;
                fileContent += `${r.code}\n\n`;
            }

            const tmpPath = `${GC_DIR}/${filename}`;
            fs.writeFileSync(tmpPath, fileContent);

            _logHistory('exported', `${isAll ? 'all' : targetCmd} (${results.length} cases)`, m.sender);

            await sock.sendMessage(m.chat, {
                document: { url: 'file://' + path.resolve(tmpPath) },
                mimetype: 'text/javascript',
                fileName: filename,
                caption:
                    `📤 *GETCASE — EXPORT*\n\n` +
                    `📦 ${results.length} case(s) di-export\n` +
                    `📄 File: \`${filename}\`\n` +
                    `💾 Size: ${(fs.statSync(tmpPath).size / 1024).toFixed(1)} KB`
            }, { quoted: m });

            setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 30000);
            return;
        }

        if (rawArg.startsWith('preview ')) {
            const cmdName = rawArg.slice(8).trim().toLowerCase();
            if (!cmdName) return reply(`❌ Format: \`${prefix}getcase preview <command>\``);

            const pending = _getPending(cmdName);
            if (!pending) return reply(`❌ Tidak ada pending getcase untuk \`${cmdName}\`.`);

            const age = Math.round((Date.now() - pending.createdAt) / 60000);
            const analysis = _deepAnalyzeCode(pending.code);
            const validation = _validateConvertedCode(pending.code);
            const preview = _formatCodePreview(pending.code);

            let output = `📋 *PREVIEW GETCASE: \`${cmdName}\`*\n\n`;
            output += `📝 Desc: ${pending.desc || '-'}\n`;
            output += `🤖 Mode: ${pending.mode || 'manual'}\n`;
            output += `🕐 ${age} menit lalu\n`;
            output += `📊 Complexity: ${analysis.complexity}\n`;
            output += `📏 ${analysis.lineCount} lines | ${analysis.charCount} chars\n`;
            if (pending.sourceBot) output += `🔍 Source Bot: ${pending.sourceBot}\n`;
            if (pending.remapLog?.length) output += `🔄 Remap: ${pending.remapLog.length} variable(s)\n`;
            output += `\n`;

            if (!validation.safe || validation.warnings.length > 0) {
                output += `⚠️ *Validasi:*\n`;
                validation.issues.forEach(i => { output += `  🚫 ${i}\n`; });
                validation.warnings.forEach(w => { output += `  ⚠️ ${w}\n`; });
                output += `\n`;
            } else {
                output += `✅ Validasi: OK\n\n`;
            }

            output += `${preview}\n\n`;
            output += `*Actions:*\n`;
            output += `✅ Inject → \`${prefix}getcase save ${cmdName}\`\n`;
            output += `📤 Export → \`${prefix}getcase send ${cmdName}\`\n`;
            output += `🔄 Retry → \`${prefix}getcase retry ${cmdName}\`\n`;
            output += `❌ Hapus → \`${prefix}getcase discard ${cmdName}\``;

            if (output.length > 4000) output = output.slice(0, 3950) + '\n... (terpotong)';
            await sock.sendMessage(m.chat, { text: output }, { quoted: fakeQuoted });
            return;
        }

        if (rawArg.startsWith('save ')) {
            const cmdName = rawArg.slice(5).trim().toLowerCase();
            if (!cmdName) return reply(`❌ Format: \`${prefix}getcase save <command>\``);

            const pending = _getPending(cmdName);
            if (!pending) return reply(`❌ Tidak ada pending getcase untuk \`${cmdName}\`.`);

            sock.sendMessage(m.chat, { react: { text: '💾', key: m.key } });

            try {
                const content = fs.readFileSync(BULTER_PATH, 'utf8');
                const injectMarker = content.includes('// [ADDCASE_INJECT_POINT]')
                    ? '// [ADDCASE_INJECT_POINT]'
                    : content.includes('\ndefault:') ? '\ndefault:' : null;

                if (!injectMarker) return reply(`❌ Tidak ditemukan inject point di bulter.js.`);

                const existingStart = content.indexOf(`// === GETCASE: ${cmdName} (`);
                if (existingStart !== -1) return reply(`❌ Case \`${cmdName}\` sudah ada. Rollback dulu.`);

                const timestamp = new Date().toLocaleString('id-ID');
                const fingerprint = _computeHash(pending.code);
                const codeBlock = `\n// === GETCASE: ${cmdName} (${timestamp}) [${fingerprint}] ===\n${pending.code}\n// === END GETCASE: ${cmdName} ===\n`;
                const newContent = content.replace(injectMarker, codeBlock + injectMarker);

                const lineNum = newContent.slice(0, newContent.indexOf(codeBlock)).split('\n').length;
                fs.writeFileSync(BULTER_PATH, newContent, 'utf8');

                _saveConverted(cmdName, { ...pending, injectedAt: Date.now(), lineNum });
                _delPending(cmdName);
                _logHistory('injected', `${cmdName} at line ${lineNum}`, m.sender);

                sock.sendMessage(m.chat, { react: { text: '🚀', key: m.key } });
                return reply(
                    `🚀 *GETCASE — INJECTED!*\n\n` +
                    `📌 Command: \`${prefix}${cmdName}\`\n` +
                    `📍 Baris: *${lineNum}*\n\n` +
                    `_Restart bot agar aktif:_\n\`${prefix}restart\``
                );
            } catch (e) {
                return reply(`❌ Gagal inject: ${e.message}`);
            }
        }

        if (rawArg.startsWith('send ')) {
            const cmdName = rawArg.slice(5).trim().toLowerCase();
            if (!cmdName) return reply(`❌ Format: \`${prefix}getcase send <command>\``);

            let code = null;
            const pending = _getPending(cmdName);
            if (pending) {
                code = pending.code;
            } else {
                try {
                    const results = _extractCasesFromBulter(cmdName);
                    if (results.length > 0) code = results[0].code;
                } catch {}
            }

            if (!code) return reply(`❌ Case \`${cmdName}\` tidak ditemukan di pending atau bulter.js.`);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const filename = `case_${cmdName}_${timestamp}.js`;
            const tmpPath = `${GC_DIR}/${filename}`;

            const analysis = _deepAnalyzeCode(code);
            const header = `/* Case: ${cmdName}\n * Exported: ${new Date().toLocaleString('id-ID')}\n * Lines: ${analysis.lineCount}\n * Complexity: ${analysis.complexity}\n */\n\n`;
            fs.writeFileSync(tmpPath, header + code);

            await sock.sendMessage(m.chat, {
                document: { url: 'file://' + path.resolve(tmpPath) },
                mimetype: 'text/javascript',
                fileName: filename,
                caption: `📄 *Case: \`${cmdName}\`*\n📏 ${analysis.lineCount} baris | Complexity: ${analysis.complexity}`
            }, { quoted: m });

            setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 30000);
            return;
        }

        if (rawArg.startsWith('discard ')) {
            const cmdName = rawArg.slice(8).trim().toLowerCase();
            if (!cmdName) return reply(`❌ Format: \`${prefix}getcase discard <command>\``);
            if (!_getPending(cmdName)) return reply(`❌ Tidak ada pending getcase untuk \`${cmdName}\`.`);
            _delPending(cmdName);
            _logHistory('discarded', cmdName, m.sender);
            return reply(`🗑️ Pending getcase \`${cmdName}\` dihapus.`);
        }

        if (rawArg.startsWith('retry ')) {
            const parts = rawArg.slice(6).trim().split(' ');
            const cmdName = parts[0].toLowerCase();
            const retryMode = parts[1] || 'convert';

            if (!cmdName) return reply(`❌ Format: \`${prefix}getcase retry <command> [convert|optimize|enhance]\``);

            const pending = _getPending(cmdName);
            if (!pending) return reply(`❌ Tidak ada pending getcase untuk \`${cmdName}\`.`);
            if (!pending.originalCode) return reply(`❌ Original code tidak tersimpan untuk retry.`);

            const validModes = ['convert', 'optimize', 'enhance'];
            if (!validModes.includes(retryMode)) return reply(`❌ Mode: ${validModes.join(' | ')}`);

            sock.sendMessage(m.chat, { react: { text: '🔄', key: m.key } });
            await reply(`🔄 *Regenerating dengan AI (mode: ${retryMode})...*\n\n📌 Command: \`${cmdName}\`\n_Mohon tunggu..._`);

            try {
                const analysis = _deepAnalyzeCode(pending.originalCode);
                const aiResult = await _aiConvertCode(pending.originalCode, cmdName, analysis, retryMode);
                let converted = _cleanAIOutput(aiResult);

                const { code: remapped, remapLog } = _remapVariables(converted, analysis);
                converted = remapped;

                const validation = _validateConvertedCode(converted);
                if (!validation.hasBreak) converted = converted.trimEnd() + '\n    break;\n}';
                if (!validation.startsWithCase) converted = `case '${cmdName}': {\n${converted}\n}`;

                _savePending(cmdName, { ...pending, code: converted, mode: `ai_${retryMode}`, updatedAt: Date.now(), remapLog });

                sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
                const preview = _formatCodePreview(converted);
                await sock.sendMessage(m.chat, {
                    text:
                        `✅ *Retry berhasil (${retryMode})!*\n\n` +
                        `📌 Command: \`${cmdName}\`\n` +
                        `🔄 Remap: ${remapLog.length} variabel\n` +
                        `${validation.warnings.length > 0 ? `⚠️ Warnings: ${validation.warnings.join(', ')}\n` : ''}` +
                        `\n${preview}\n\n` +
                        `✅ Inject → \`${prefix}getcase save ${cmdName}\`\n` +
                        `📤 Export → \`${prefix}getcase send ${cmdName}\``
                }, { quoted: fakeQuoted });
            } catch (e) {
                sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
                return reply(`❌ Retry gagal: ${e.message.slice(0, 150)}`);
            }
            return;
        }

        if (rawArg === 'history') {
            const limit = parseInt(args[1]) || 15;
            const history = _read(HISTORY_PATH, []).slice(-limit).reverse();
            if (history.length === 0) return reply(`📋 Belum ada history getcase.`);

            const actionIcons = {
                'extracted': '🔍', 'converted': '🔄', 'injected': '🚀', 'exported': '📤',
                'discarded': '🗑️', 'failed': '❌', 'sent': '📄', 'retry': '🔁'
            };

            let output = `📋 *GETCASE HISTORY (${history.length})*\n\n`;
            for (const h of history) {
                const icon = Object.entries(actionIcons).find(([k]) => h.action.includes(k))?.[1] || '📝';
                output += `${icon} *${h.action}* — ${h.time}\n`;
                output += `   _${h.detail.slice(0, 80)}_\n\n`;
            }
            if (output.length > 4000) output = output.slice(0, 3950) + '\n... (terpotong)';
            return reply(output);
        }

        if (rawArg === 'stats') {
            const extracted = _read(EXTRACTED_PATH, {});
            const converted = _read(CONVERTED_PATH, {});
            const pending = _read(PENDING_PATH, {});
            const history = _read(HISTORY_PATH, []);

            const actionCounts = history.reduce((acc, h) => { acc[h.action] = (acc[h.action] || 0) + 1; return acc; }, {});
            const sessionStart = _sessionMap.get(m.sender)?.startedAt || Date.now();

            let output = `📊 *GETCASE — STATISTICS*\n\n`;
            output += `📦 Total Extracted: ${Object.keys(extracted).length}\n`;
            output += `✅ Total Converted: ${Object.keys(converted).length}\n`;
            output += `⏳ Pending: ${Object.keys(pending).length}\n\n`;

            output += `━━━ *ACTIONS* ━━━\n`;
            for (const [action, count] of Object.entries(actionCounts)) {
                output += `• ${action}: ${count}\n`;
            }

            if (Object.keys(converted).length > 0) {
                output += `\n━━━ *RECENT CONVERTED* ━━━\n`;
                const recentConverted = Object.entries(converted)
                    .sort((a, b) => b[1].convertedAt - a[1].convertedAt)
                    .slice(0, 5);
                for (const [name, data] of recentConverted) {
                    const ago = Math.round((Date.now() - data.convertedAt) / 60000);
                    output += `• \`${name}\` — ${ago}m lalu\n`;
                }
            }

            output += `\n━━━ *CACHE* ━━━\n`;
            output += `🗃️ AI Cache: ${_conversionCache.size} entries\n`;
            output += `📋 Sessions: ${_sessionMap.size} active`;

            return reply(output);
        }

        if (rawArg.startsWith('rollback ')) {
            const cmdName = rawArg.slice(9).trim().toLowerCase();
            if (!cmdName) return reply(`❌ Format: \`${prefix}getcase rollback <command>\``);

            sock.sendMessage(m.chat, { react: { text: '⏮️', key: m.key } });

            try {
                const content = fs.readFileSync(BULTER_PATH, 'utf8');
                const startMarker = `// === GETCASE: ${cmdName} (`;
                const endMarker = `// === END GETCASE: ${cmdName} ===`;
                const si = content.indexOf(startMarker);
                const ei = content.indexOf(endMarker);

                if (si === -1 || ei === -1) return reply(`❌ Case \`${cmdName}\` tidak ditemukan di bulter.js.`);

                const lineBeforeStart = content.lastIndexOf('\n', si - 1);
                const actualStart = lineBeforeStart !== -1 ? lineBeforeStart : si;
                const actualEnd = ei + endMarker.length;
                const afterEnd = content.indexOf('\n', actualEnd);
                const finalEnd = afterEnd !== -1 ? afterEnd + 1 : actualEnd;

                const newContent = content.slice(0, actualStart) + content.slice(finalEnd);
                fs.writeFileSync(BULTER_PATH, newContent, 'utf8');

                const db = _read(CONVERTED_PATH, {});
                delete db[cmdName];
                _write(CONVERTED_PATH, db);

                _logHistory('rollback', cmdName, m.sender);
                sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
                return reply(`✅ Case \`${cmdName}\` berhasil dihapus dari bulter.js.`);
            } catch (e) {
                return reply(`❌ Rollback gagal: ${e.message}`);
            }
        }

        if (m.quoted) {
            const quotedText = m.quoted?.text || m.quoted?.body || m.quoted?.caption || '';
            if (!quotedText || quotedText.length < 5) {
                return reply(`❌ Pesan yang di-reply tidak memiliki teks.\n\nGunakan \`${prefix}getcase help\` untuk bantuan.`);
            }

            const flags = {
                multi: rawArg.includes('--multi'),
                noAI: rawArg.includes('--noai'),
                optimize: rawArg.includes('--optimize'),
                enhance: rawArg.includes('--enhance'),
                reverseEngineer: rawArg.includes('--reverse')
            };

            let cmdNameOverride = rawArg
                .replace(/--multi|--noai|--optimize|--enhance|--reverse/g, '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '');

            const extractedBlocks = _extractAllCodeBlocks(quotedText);
            if (extractedBlocks.length === 0) {
                if (flags.reverseEngineer) {
                    extractedBlocks.push({
                        code: quotedText,
                        hash: _computeHash(quotedText),
                        source: 'raw_output',
                        format: 'plain',
                        length: quotedText.length,
                        lineCount: quotedText.split('\n').length
                    });
                } else {
                    return reply(
                        `❌ *Tidak ditemukan code block!*\n\n` +
                        `Pesan harus berisi:\n` +
                        `• Code dalam backtick/markdown\n` +
                        `• Code case JavaScript\n` +
                        `• Output bot (gunakan \`--reverse\` untuk reverse engineer)`
                    );
                }
            }

            const sourceBot = _detectSourceBot(quotedText);
            const analysis = _deepAnalyzeCode(extractedBlocks[0].code);
            const allCmds = _extractCommandNames(extractedBlocks[0].code);

            let cmdName = cmdNameOverride;
            if (!cmdName) {
                if (allCmds.length > 0) cmdName = allCmds[0];
                else cmdName = `cmd_${_computeHash(quotedText).slice(0, 6)}`;
            }

            if (_getPending(cmdName)) {
                return reply(
                    `⚠️ Command \`${cmdName}\` sudah ada di pending!\n\n` +
                    `Gunakan:\n` +
                    `• \`${prefix}getcase preview ${cmdName}\` — lihat\n` +
                    `• \`${prefix}getcase discard ${cmdName}\` — hapus\n` +
                    `• \`${prefix}getcase retry ${cmdName}\` — regenerate`
                );
            }

            sock.sendMessage(m.chat, { react: { text: '🔍', key: m.key } });
            await reply(
                `🔍 *GETCASE — Menganalisis code...*\n\n` +
                `📊 Blocks ditemukan: ${extractedBlocks.length}\n` +
                `🔧 Commands terdeteksi: ${allCmds.slice(0, 5).join(', ') || 'auto-detect'}\n` +
                `🤖 Source bot: ${sourceBot.bots.map(b => b.bot).join(', ') || 'Unknown'}\n` +
                `📋 Framework: ${sourceBot.framework}\n` +
                `${flags.noAI ? '⚡ Mode: Manual Convert' : flags.multi ? '🔀 Mode: Multi Command Extract' : flags.optimize ? '🎯 Mode: AI Optimize' : flags.enhance ? '✨ Mode: AI Enhance' : flags.reverseEngineer ? '🔬 Mode: Reverse Engineer' : '🤖 Mode: AI Convert'}\n\n` +
                `_${flags.noAI ? 'Memproses tanpa AI...' : 'DeepAI sedang memproses...'}_`
            );

            if (flags.multi) {
                const aiMode = 'multi_extract';
                let multiResults = [];

                if (!flags.noAI) {
                    try {
                        const aiResult = await _aiConvertCode(extractedBlocks[0].code, 'multi', analysis, aiMode);
                        multiResults = _parseMultiCommandOutput(aiResult);
                    } catch (aiErr) {
                        await reply(`⚠️ AI gagal (${aiErr.message.slice(0, 60)}), fallback ke manual extraction...`);
                    }
                }

                if (multiResults.length === 0) {
                    const cases = _extractCaseBlocks(extractedBlocks[0].code);
                    multiResults = cases.map(c => ({ cmdName: c.cmdName, code: c.code }));
                }

                if (multiResults.length === 0) {
                    return reply(`❌ Tidak ditemukan multiple command di code tersebut.`);
                }

                let savedCount = 0;
                const savedNames = [];
                for (const { cmdName: cn, code: rawCode } of multiResults) {
                    const { code: remapped, remapLog } = _remapVariables(rawCode, analysis);
                    const normalized = _normalizeCase(remapped, cn, analysis);
                    const validation = _validateConvertedCode(normalized);
                    let finalCode = normalized;
                    if (!validation.hasBreak) finalCode = finalCode.trimEnd() + '\n    break;\n}';
                    if (!validation.startsWithCase) finalCode = `case '${cn}': {\n${finalCode}\n}`;

                    _savePending(cn, {
                        code: finalCode,
                        originalCode: rawCode.slice(0, 2000),
                        desc: _inferCommandDescription(rawCode, cn, analysis),
                        mode: flags.noAI ? 'manual_multi' : 'ai_multi',
                        sourceBot: sourceBot.bots[0]?.bot || 'unknown',
                        detectedCommands: allCmds,
                        remapLog,
                        createdBy: m.sender,
                        createdAt: Date.now()
                    });

                    _logHistory('extracted_multi', `${cn} from multi`, m.sender);
                    savedNames.push(cn);
                    savedCount++;
                }

                sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
                let output = `✅ *GETCASE MULTI — ${savedCount} Commands*\n\n`;
                savedNames.forEach((n, i) => { output += `${i + 1}. \`${n}\`\n`; });
                output += `\n*Actions untuk setiap command:*\n`;
                output += `• Preview: \`${prefix}getcase preview <cmd>\`\n`;
                output += `• Inject: \`${prefix}getcase save <cmd>\`\n`;
                output += `• Export: \`${prefix}getcase send <cmd>\``;

                return sock.sendMessage(m.chat, { text: output }, { quoted: fakeQuoted });
            }

            const primaryBlock = extractedBlocks[0];
            let convertedCode;
            let remapLog = [];
            let aiUsed = false;
            let conversionMode = 'manual';

            if (!flags.noAI) {
                const aiModeToUse = flags.optimize ? 'optimize' : flags.enhance ? 'enhance' : flags.reverseEngineer ? 'reverse_engineer' : 'convert';
                try {
                    const aiResult = await _aiConvertCode(primaryBlock.code, cmdName, analysis, aiModeToUse);
                    convertedCode = _cleanAIOutput(aiResult);
                    aiUsed = true;
                    conversionMode = `ai_${aiModeToUse}`;
                } catch (aiErr) {
                    await reply(`⚠️ AI gagal (${aiErr.message.slice(0, 80)})\n_Fallback ke manual convert..._`);
                }
            }

            if (!convertedCode) {
                const remapResult = _remapVariables(primaryBlock.code, analysis);
                convertedCode = remapResult.code;
                remapLog = remapResult.remapLog;
                convertedCode = _normalizeCase(convertedCode, cmdName, analysis);
                conversionMode = 'manual';
            } else {
                const remapResult = _remapVariables(convertedCode, analysis);
                convertedCode = remapResult.code;
                remapLog = remapResult.remapLog;
            }

            const validation = _validateConvertedCode(convertedCode);
            if (!validation.safe) {
                sock.sendMessage(m.chat, { react: { text: '🚫', key: m.key } });
                return reply(
                    `🚫 *Code ditolak — pola berbahaya!*\n\n` +
                    `Ditemukan:\n${validation.issues.map(i => `• ${i}`).join('\n')}\n\n` +
                    `_Code asli tetap bisa diakses manual._`
                );
            }

            if (!validation.hasBreak) convertedCode = convertedCode.trimEnd() + '\n    break;\n}';
            if (!validation.startsWithCase) convertedCode = `case '${cmdName}': {\n${convertedCode}\n}`;

            const extractId = _computeHash(primaryBlock.code);
            _saveExtracted(extractId, { code: primaryBlock.code, analysis, sourceBot, detectedCommands: allCmds });

            _savePending(cmdName, {
                code: convertedCode,
                originalCode: primaryBlock.code.slice(0, 3000),
                desc: _inferCommandDescription(primaryBlock.code, cmdName, analysis),
                mode: conversionMode,
                sourceBot: sourceBot.bots[0]?.bot || 'unknown',
                framework: sourceBot.framework,
                detectedCommands: allCmds,
                extractId,
                remapLog,
                aiUsed,
                validation,
                createdBy: m.sender,
                createdAt: Date.now()
            });

            _logHistory('converted', `${cmdName} (${conversionMode})`, m.sender);

            sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });

            const finalAnalysis = _deepAnalyzeCode(convertedCode);
            const preview = _formatCodePreview(convertedCode);

            let depsInfo = '';
            if (finalAnalysis.apiEndpoints.length > 0) depsInfo += `\n🌐 API: ${finalAnalysis.apiEndpoints.join(', ')}`;
            if (finalAnalysis.hasFetch || finalAnalysis.hasAxios) depsInfo += depsInfo ? '' : `\n🌐 HTTP request`;

            let remapInfo = '';
            if (remapLog.length > 0) {
                const uniqueRemaps = [...new Set(remapLog.map(r => r.category))];
                remapInfo = `\n🔄 Remapped: ${uniqueRemaps.join(', ')} (${remapLog.reduce((s, r) => s + r.count, 0)} total)`;
            }

            let warningInfo = '';
            if (validation.warnings.length > 0) {
                warningInfo = `\n⚠️ ${validation.warnings.length} warning(s)`;
            }

            await sock.sendMessage(m.chat, {
                text:
                    `✅ *GETCASE — Konversi Berhasil!*\n\n` +
                    `📌 Command: \`${prefix}${cmdName}\`\n` +
                    `🤖 AI: ${aiUsed ? `✅ (${conversionMode})` : '⚠️ Manual'}\n` +
                    `🔍 Source: ${sourceBot.bots[0]?.bot || 'Unknown'} | ${sourceBot.framework}\n` +
                    `📊 Complexity: ${finalAnalysis.complexity}\n` +
                    `📏 ${finalAnalysis.lineCount} baris | ${finalAnalysis.charCount} chars` +
                    `${remapInfo}${depsInfo}${warningInfo}\n\n` +
                    `${preview}\n\n` +
                    `*Actions:*\n` +
                    `✅ Inject  → \`${prefix}getcase save ${cmdName}\`\n` +
                    `📤 Export  → \`${prefix}getcase send ${cmdName}\`\n` +
                    `🔄 Retry   → \`${prefix}getcase retry ${cmdName} [optimize|enhance]\`\n` +
                    `❌ Hapus   → \`${prefix}getcase discard ${cmdName}\``
            }, { quoted: fakeQuoted });
            return;
        }

        return reply(
            `❓ *Format tidak dikenali!*\n\n` +
            `Untuk ekstrak code dari chat:\n` +
            `• Reply pesan berisi code + \`${prefix}getcase\`\n\n` +
            `Untuk ambil dari bulter.js:\n` +
            `• \`${prefix}getcase from <command>\`\n\n` +
            `Lihat semua: \`${prefix}getcase help\``
        );
    }
}

module.exports = { handleGetCase };
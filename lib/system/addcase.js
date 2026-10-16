'use strict';
const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');
const crypto = require('crypto');

const AC_DIR         = './database/addcase';
const PENDING_PATH   = `${AC_DIR}/pending.json`;
const APPROVED_PATH  = `${AC_DIR}/approved.json`;
const HISTORY_PATH   = `${AC_DIR}/history.json`;
const BACKUP_DIR     = `${AC_DIR}/backups`;
const BULTER_PATH    = './Cantarella.js';

const _ensureDir = () => {
    [AC_DIR, BACKUP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
};

const _read  = (p, fb = {}) => { try { _ensureDir(); return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const _write = (p, d) => { try { _ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch(e) { console.error('[AddCase] Write error:', e.message); } };

const _lockMap = new Map();
const _rateLimitMap = new Map();
const _sessionPool = new Map();
const _noncePool = { values: [], ts: 0, ttl: 120000, maxSize: 5 };
const _codeHashRegistry = new Map();
const _retryLedger = new Map();
const _integrityCache = { data: null, ts: 0, ttl: 30000 };
const _pendingTimers = new Map();
const _metricsStore = {
    totalGenerated: 0,
    totalInjected: 0,
    totalRollbacks: 0,
    totalEdits: 0,
    totalFailures: 0,
    aiResponseTimes: [],
    lastActivity: 0,
    startedAt: Date.now()
};

function _acquireLock(resource, timeoutMs = 15000) {
    const now = Date.now();
    const existing = _lockMap.get(resource);
    if (existing && (now - existing.ts) < timeoutMs) {
        if (existing.queue) {
            existing.queue++;
        }
        return false;
    }
    const lockId = crypto.randomBytes(12).toString('hex');
    _lockMap.set(resource, { ts: now, id: lockId, queue: 0, owner: resource });
    return lockId;
}

function _releaseLock(resource, lockId) {
    const existing = _lockMap.get(resource);
    if (existing && existing.id === lockId) {
        _lockMap.delete(resource);
        return true;
    }
    return false;
}

function _checkRateLimit(sender, action, maxPerWindow = 5, windowMs = 60000) {
    const key = `${sender}:${action}`;
    const now = Date.now();
    const record = _rateLimitMap.get(key) || { hits: [], blocked: 0, firstHit: now, escalation: 0 };
    record.hits = record.hits.filter(t => (now - t) < windowMs);
    if (record.hits.length >= maxPerWindow) {
        record.blocked++;
        record.escalation = Math.min(record.escalation + 1, 5);
        _rateLimitMap.set(key, record);
        const escalatedWindow = windowMs * (1 + record.escalation * 0.5);
        const waitSec = Math.ceil((escalatedWindow - (now - record.hits[0])) / 1000);
        return { allowed: false, waitSec: Math.max(waitSec, 1), totalBlocked: record.blocked, escalation: record.escalation };
    }
    if (record.blocked > 0 && record.hits.length === 0) {
        record.escalation = Math.max(0, record.escalation - 1);
    }
    record.hits.push(now);
    _rateLimitMap.set(key, record);
    if (_rateLimitMap.size > 500) {
        const entries = [..._rateLimitMap.entries()].sort((a, b) => {
            const lastA = a[1].hits[a[1].hits.length - 1] || 0;
            const lastB = b[1].hits[b[1].hits.length - 1] || 0;
            return lastA - lastB;
        });
        for (let i = 0; i < entries.length - 200; i++) {
            _rateLimitMap.delete(entries[i][0]);
        }
    }
    return { allowed: true, remaining: maxPerWindow - record.hits.length };
}

function _computeCodeHash(code) {
    const normalized = code
        .replace(/\s+/g, ' ')
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/['"]use strict['"];?/g, '')
        .trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

function _computeStructuralHash(code) {
    const structural = code
        .replace(/(['"`])(?:(?!\1|\\).|\\.)*\1/g, '""')
        .replace(/\d+/g, '0')
        .replace(/\s+/g, ' ')
        .trim();
    return crypto.createHash('md5').update(structural).digest('hex');
}

function _buildCodeHashIndex() {
    _codeHashRegistry.clear();
    const approved = _read(APPROVED_PATH, {});
    const pending = _read(PENDING_PATH, {});
    for (const [name, data] of Object.entries(approved)) {
        if (data.code) {
            const hash = _computeCodeHash(data.code);
            const structHash = _computeStructuralHash(data.code);
            _codeHashRegistry.set(hash, { name, source: 'approved', structHash });
            _codeHashRegistry.set(`struct:${structHash}`, { name, source: 'approved', exactHash: hash });
        }
    }
    for (const [name, data] of Object.entries(pending)) {
        if (data.code) {
            const hash = _computeCodeHash(data.code);
            const structHash = _computeStructuralHash(data.code);
            if (!_codeHashRegistry.has(hash)) {
                _codeHashRegistry.set(hash, { name, source: 'pending', structHash });
            }
            if (!_codeHashRegistry.has(`struct:${structHash}`)) {
                _codeHashRegistry.set(`struct:${structHash}`, { name, source: 'pending', exactHash: hash });
            }
        }
    }
}

function _checkCodeDuplication(code, excludeName = null) {
    _buildCodeHashIndex();
    const hash = _computeCodeHash(code);
    const structHash = _computeStructuralHash(code);
    const exactMatch = _codeHashRegistry.get(hash);
    if (exactMatch && exactMatch.name !== excludeName) {
        return { duplicate: true, type: 'exact', existingName: exactMatch.name, source: exactMatch.source, hash };
    }
    const structMatch = _codeHashRegistry.get(`struct:${structHash}`);
    if (structMatch && structMatch.name !== excludeName) {
        return { duplicate: true, type: 'structural', existingName: structMatch.name, source: structMatch.source, hash };
    }
    return { duplicate: false, hash, structHash };
}

function _validateSyntaxDeep(code) {
    const errors = [];
    const warnings = [];
    let lineNum = 1;
    let colNum = 0;

    const stateStack = [{ type: 'code', braceDepth: 0, parenDepth: 0, bracketDepth: 0 }];
    const cur = () => stateStack[stateStack.length - 1];

    let braceBalance = 0;
    let parenBalance = 0;
    let bracketBalance = 0;

    const isCountable = () => {
        const t = cur().type;
        return t === 'code' || t === 'template_expr';
    };

    let i = 0;
    while (i < code.length) {
        const ch = code[i];
        const next = i + 1 < code.length ? code[i + 1] : '';
        colNum++;

        if (ch === '\n') {
            lineNum++;
            colNum = 0;
            if (cur().type === 'line_comment') stateStack.pop();
            i++;
            continue;
        }

        const state = cur().type;

        if (state === 'line_comment') { i++; continue; }
        if (state === 'block_comment') {
            if (ch === '*' && next === '/') { stateStack.pop(); i += 2; } else { i++; }
            continue;
        }
        if (state === 'string') {
            if (ch === '\\') { i += 2; continue; }
            if (ch === cur().quote) stateStack.pop();
            i++;
            continue;
        }
        if (state === 'template') {
            if (ch === '\\') { i += 2; continue; }
            if (ch === '`') { stateStack.pop(); i++; continue; }
            if (ch === '$' && next === '{') {
                stateStack.push({ type: 'template_expr', braceDepth: 1, parenDepth: 0, bracketDepth: 0 });
                braceBalance++;
                i += 2;
                continue;
            }
            i++;
            continue;
        }
        if (state === 'template_expr') {
            if (ch === '\\') { i += 2; continue; }
            if (ch === '/' && next === '/') { stateStack.push({ type: 'line_comment' }); i += 2; continue; }
            if (ch === '/' && next === '*') { stateStack.push({ type: 'block_comment' }); i += 2; continue; }
            if (ch === '"' || ch === "'") { stateStack.push({ type: 'string', quote: ch }); i++; continue; }
            if (ch === '`') { stateStack.push({ type: 'template' }); i++; continue; }
            if (ch === '{') { cur().braceDepth++; braceBalance++; i++; continue; }
            if (ch === '}') {
                cur().braceDepth--;
                braceBalance--;
                if (cur().braceDepth === 0) {
                    stateStack.pop();
                } else if (cur().braceDepth < 0) {
                    errors.push(`Template expr kurung kurawal berlebih di baris ${lineNum}`);
                }
                i++;
                continue;
            }
            if (ch === '(') { cur().parenDepth++; parenBalance++; i++; continue; }
            if (ch === ')') {
                cur().parenDepth--;
                parenBalance--;
                if (cur().parenDepth < 0) {
                    errors.push(`Template expr kurung biasa berlebih di baris ${lineNum}`);
                    cur().parenDepth = 0;
                }
                i++;
                continue;
            }
            if (ch === '[') { cur().bracketDepth++; bracketBalance++; i++; continue; }
            if (ch === ']') {
                cur().bracketDepth--;
                bracketBalance--;
                if (cur().bracketDepth < 0) {
                    errors.push(`Template expr kurung siku berlebih di baris ${lineNum}`);
                    cur().bracketDepth = 0;
                }
                i++;
                continue;
            }
            i++;
            continue;
        }
        if (ch === '/' && next === '/') { stateStack.push({ type: 'line_comment' }); i += 2; continue; }
        if (ch === '/' && next === '*') { stateStack.push({ type: 'block_comment' }); i += 2; continue; }
        if (ch === '"' || ch === "'") { stateStack.push({ type: 'string', quote: ch }); i++; continue; }
        if (ch === '`') { stateStack.push({ type: 'template' }); i++; continue; }

        if (ch === '{') { braceBalance++; i++; continue; }
        if (ch === '}') {
            braceBalance--;
            i++;
            continue;
        }
        if (ch === '(') { parenBalance++; i++; continue; }
        if (ch === ')') { parenBalance--; i++; continue; }
        if (ch === '[') { bracketBalance++; i++; continue; }
        if (ch === ']') { bracketBalance--; i++; continue; }
        i++;
    }

    const braceDepth = braceBalance;
    if (braceBalance !== 0) errors.push(`Kurung kurawal tidak seimbang (selisih: ${braceBalance})`);
    if (stateStack.some(s => s.type === 'string')) errors.push('String literal tidak ditutup');
    if (stateStack.some(s => s.type === 'template')) errors.push('Template literal tidak ditutup');
    if (stateStack.some(s => s.type === 'block_comment')) errors.push('Block comment tidak ditutup');

    const lines = code.split('\n');

    let caseCount = 0;
    let breakCount = 0;
    let returnCount = 0;
    let awaitCount = 0;
    let asyncCount = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^case\s+['"]/.test(trimmed)) caseCount++;
        if (/^break\s*;/.test(trimmed)) breakCount++;
        if (/\breturn\b/.test(trimmed)) returnCount++;
        if (/\bawait\b/.test(trimmed)) awaitCount++;
        if (/\basync\b/.test(trimmed)) asyncCount++;
    }

    if (caseCount > 0 && breakCount === 0 && returnCount === 0) warnings.push('Tidak ada break/return statement ditemukan');
    if (awaitCount > 0 && asyncCount === 0) warnings.push('await digunakan tanpa async scope yang jelas (pastikan ada di dalam async function/handler)');

    const variablePatterns = [
        { re: /\bsock\./g, suggestion: 'bulter', severity: 'high' },
        { re: /\bsatanic\./g, suggestion: 'bulter', severity: 'high' },
        { re: /\bconn\./g, suggestion: 'bulter', severity: 'high' },
        { re: /\bclient\./g, suggestion: 'bulter', severity: 'medium' },
        { re: /\bbot\.\b/g, suggestion: 'bulter', severity: 'medium' },
        { re: /\bmessage\.(chat|sender|key|quoted)/g, suggestion: 'm', severity: 'high' },
        { re: /\bmsg\.(chat|sender|key|quoted)/g, suggestion: 'm', severity: 'high' },
        { re: /\bctx\.(chat|sender)/g, suggestion: 'm', severity: 'medium' },
        { re: /\bsender\b(?!\s*[=:])/g, suggestion: 'm.sender', severity: 'low' },
    ];

    for (const { re, suggestion, severity } of variablePatterns) {
        const cleanedCode = code.replace(/(['"`])(?:(?!\1|\\).|\\.)*\1/g, '""').replace(/\/\/.*$/gm, '');
        const matches = cleanedCode.match(re);
        if (matches) {
            const msg = `Ditemukan '${matches[0]}' → gunakan '${suggestion}' [${severity}]`;
            if (severity === 'high') warnings.unshift(msg);
            else warnings.push(msg);
        }
    }

    const hasAsyncOp = awaitCount > 0;
    const hasTryCatch = /\btry\s*\{/.test(code) && /\bcatch\s*[\s(]/.test(code);
    if (hasAsyncOp && !hasTryCatch) {
        warnings.push('Ada operasi async tanpa try/catch');
    }

    const longLines = lines.filter((l, i) => l.length > 300);
    if (longLines.length > 0) {
        warnings.push(`${longLines.length} baris melebihi 300 karakter`);
    }

    const emptyTryCatch = /catch\s*\([^)]*\)\s*\{\s*\}/g.test(code);
    if (emptyTryCatch) warnings.push('Ditemukan catch block kosong (silent error)');

    const nestedAwait = /await\s+.*await\s+/g.test(code);
    if (nestedAwait) warnings.push('Nested await terdeteksi (potensi race condition)');

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats: {
            lines: lines.length,
            chars: code.length,
            caseCount,
            breakCount,
            returnCount,
            awaitCount,
            asyncCount,
            hasAsync: hasAsyncOp,
            hasTryCatch,
            braceDepth,
            complexity: _estimateComplexity(code),
            maintainability: _estimateMaintainability(code)
        }
    };
}

function _estimateComplexity(code) {
    let score = 0;
    const patterns = [
        { re: /\bif\s*\(/g, weight: 1 },
        { re: /\belse\s+if\s*\(/g, weight: 1.5 },
        { re: /\belse\s*\{/g, weight: 0.5 },
        { re: /\bfor\s*\(/g, weight: 2 },
        { re: /\bfor\s+.*\bof\b/g, weight: 1.5 },
        { re: /\bfor\s+.*\bin\b/g, weight: 1.5 },
        { re: /\bwhile\s*\(/g, weight: 2.5 },
        { re: /\bdo\s*\{/g, weight: 2.5 },
        { re: /\bswitch\s*\(/g, weight: 3 },
        { re: /\bcase\s+/g, weight: 0.5 },
        { re: /\bcatch\s*\(/g, weight: 1 },
        { re: /\bfinally\s*\{/g, weight: 0.5 },
        { re: /\?\s*[^:]*\s*:/g, weight: 1 },
        { re: /\?\./g, weight: 0.3 },
        { re: /\?\?/g, weight: 0.5 },
        { re: /&&/g, weight: 0.5 },
        { re: /\|\|/g, weight: 0.5 },
        { re: /\bawait\b/g, weight: 1.5 },
        { re: /\.then\s*\(/g, weight: 2 },
        { re: /\.catch\s*\(/g, weight: 1 },
        { re: /new\s+Promise/g, weight: 2.5 },
        { re: /Promise\.(all|race|allSettled|any)\s*\(/g, weight: 3 },
        { re: /\.map\s*\(/g, weight: 1 },
        { re: /\.filter\s*\(/g, weight: 1 },
        { re: /\.reduce\s*\(/g, weight: 2.5 },
        { re: /\.flatMap\s*\(/g, weight: 2 },
        { re: /\.some\s*\(/g, weight: 1 },
        { re: /\.every\s*\(/g, weight: 1 },
        { re: /\.find\s*\(/g, weight: 1 },
        { re: /\.forEach\s*\(/g, weight: 0.5 },
        { re: /\bnew\s+RegExp\s*\(/g, weight: 1.5 },
        { re: /try\s*\{/g, weight: 1 },
    ];
    for (const { re, weight } of patterns) {
        const matches = code.match(re);
        if (matches) score += matches.length * weight;
    }
    return Math.round(score * 10) / 10;
}

function _estimateMaintainability(code) {
    const lines = code.split('\n');
    const totalLines = lines.length;
    const codeLines = lines.filter(l => l.trim() && !l.trim().startsWith('//')).length;
    const commentLines = lines.filter(l => l.trim().startsWith('//')).length;
    const avgLineLength = codeLines > 0 ? Math.round(lines.reduce((s, l) => s + l.length, 0) / totalLines) : 0;
    const complexity = _estimateComplexity(code);
    const commentRatio = codeLines > 0 ? commentLines / codeLines : 0;
    let score = 100;
    if (complexity > 20) score -= (complexity - 20) * 2;
    if (avgLineLength > 80) score -= (avgLineLength - 80) * 0.5;
    if (totalLines > 200) score -= (totalLines - 200) * 0.1;
    if (commentRatio < 0.05 && totalLines > 30) score -= 5;
    score = Math.max(0, Math.min(100, Math.round(score)));
    let grade = 'A';
    if (score < 80) grade = 'B';
    if (score < 60) grade = 'C';
    if (score < 40) grade = 'D';
    if (score < 20) grade = 'F';
    return { score, grade, avgLineLength, codeLines, commentLines, commentRatio: Math.round(commentRatio * 100) };
}

function _detectExternalDependencies(code) {
    const deps = [];
    const apiPatterns = [
        { re: /axios\.(get|post|put|delete|patch|head|request)\s*\(\s*['"`]([^'"`\n]+)['"`]/g, type: 'http', method: 1, url: 2 },
        { re: /axios\s*\(\s*\{[^}]*url\s*:\s*['"`]([^'"`\n]+)['"`]/g, type: 'http_config', url: 1 },
        { re: /fetch\s*\(\s*['"`]([^'"`\n]+)['"`]/g, type: 'fetch', url: 1 },
        { re: /new\s+URL\s*\(\s*['"`]([^'"`\n]+)['"`]/g, type: 'url_constructor', url: 1 },
        { re: /\.get\s*\(\s*['"`](https?:\/\/[^'"`\n]+)['"`]/g, type: 'http_get', url: 1 },
        { re: /\.post\s*\(\s*['"`](https?:\/\/[^'"`\n]+)['"`]/g, type: 'http_post', url: 1 },
    ];
    const seenUrls = new Set();
    for (const { re, type, url: urlGroup, method: methodGroup } of apiPatterns) {
        let match;
        const regex = new RegExp(re.source, re.flags);
        while ((match = regex.exec(code)) !== null) {
            const url = match[urlGroup || 1];
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            let hostname = '';
            try { hostname = new URL(url).hostname; } catch { hostname = url.slice(0, 60); }
            deps.push({
                type,
                method: methodGroup ? match[methodGroup] : undefined,
                url: url.slice(0, 250),
                hostname,
                secure: url.startsWith('https')
            });
        }
    }

    const fsOps = [];
    const fsPatterns = /fs\.(readFile|writeFile|readFileSync|writeFileSync|mkdir|mkdirSync|access|accessSync|stat|statSync|existsSync|createReadStream|createWriteStream|appendFile|appendFileSync|readdir|readdirSync|copyFile|copyFileSync)\s*\(/g;
    let fsMatch;
    while ((fsMatch = fsPatterns.exec(code)) !== null) {
        fsOps.push(fsMatch[1]);
    }
    if (fsOps.length) deps.push({ type: 'filesystem', operations: [...new Set(fsOps)], count: fsOps.length });

    const bufferPatterns = /Buffer\.(from|alloc|allocUnsafe|concat|isBuffer|byteLength)\s*\(/g;
    const bufferOps = [];
    let bufMatch;
    while ((bufMatch = bufferPatterns.exec(code)) !== null) {
        bufferOps.push(bufMatch[1]);
    }
    if (bufferOps.length) deps.push({ type: 'buffer', operations: [...new Set(bufferOps)] });

    const cryptoPatterns = /crypto\.(createHash|randomBytes|randomUUID|createCipheriv|createDecipheriv|createHmac|scrypt|pbkdf2)\s*\(/g;
    const cryptoOps = [];
    let cryptoMatch;
    while ((cryptoMatch = cryptoPatterns.exec(code)) !== null) {
        cryptoOps.push(cryptoMatch[1]);
    }
    if (cryptoOps.length) deps.push({ type: 'crypto', operations: [...new Set(cryptoOps)] });

    const baileysMethods = [];
    const baileysPatterns = /bulter\.(sendMessage|downloadMediaMessage|groupParticipantsUpdate|groupUpdateSubject|groupUpdateDescription|groupSettingUpdate|profilePictureUrl|updateProfilePicture|fetchStatus|sendPresenceUpdate|readMessages|getBusinessProfile)\s*\(/g;
    let bMatch;
    while ((bMatch = baileysPatterns.exec(code)) !== null) {
        baileysMethods.push(bMatch[1]);
    }
    if (baileysMethods.length) deps.push({ type: 'baileys', methods: [...new Set(baileysMethods)] });

    return deps;
}

function _generateCaseFingerprint(code, cmdName) {
    const components = [
        cmdName,
        _computeCodeHash(code),
        _computeStructuralHash(code),
        code.length.toString(),
        code.split('\n').length.toString(),
        (_estimateComplexity(code)).toString()
    ];
    return crypto.createHash('sha256').update(components.join(':')).digest('hex').slice(0, 16);
}

async function _retryWithBackoff(fn, maxRetries = 3, baseDelay = 2000, label = 'operation') {
    const retryId = crypto.randomBytes(6).toString('hex');
    _retryLedger.set(retryId, {
        label,
        startedAt: Date.now(),
        attempts: 0,
        maxRetries,
        errors: [],
        lastError: null
    });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const ledger = _retryLedger.get(retryId);
        if (ledger) ledger.attempts = attempt + 1;

        try {
            const startTs = Date.now();
            const result = await fn(attempt);
            if (ledger) {
                ledger.completedAt = Date.now();
                ledger.duration = Date.now() - startTs;
                ledger.success = true;
            }
            setTimeout(() => _retryLedger.delete(retryId), 60000);
            return result;
        } catch (err) {
            if (ledger) {
                ledger.errors.push({ attempt, message: err.message.slice(0, 100), ts: Date.now() });
                ledger.lastError = err.message;
            }

            if (attempt === maxRetries) {
                if (ledger) {
                    ledger.completedAt = Date.now();
                    ledger.success = false;
                }
                setTimeout(() => _retryLedger.delete(retryId), 60000);
                throw err;
            }

            const jitter = Math.random() * 1000;
            const delay = Math.min(baseDelay * Math.pow(2, attempt) + jitter, 30000);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

function _getSession(sender) {
    const existing = _sessionPool.get(sender);
    const now = Date.now();
    if (existing && (now - existing.ts) < 900000) {
        existing.ts = now;
        existing.requestCount++;
        existing.lastAction = now;
        return existing;
    }
    const session = {
        id: crypto.randomBytes(8).toString('hex'),
        sender,
        ts: now,
        createdAt: now,
        lastAction: now,
        requestCount: 1,
        history: [],
        context: {},
        flags: new Set()
    };
    _sessionPool.set(sender, session);
    if (_sessionPool.size > 200) {
        const entries = [..._sessionPool.entries()]
            .sort((a, b) => a[1].lastAction - b[1].lastAction);
        for (let i = 0; i < entries.length - 100; i++) {
            _sessionPool.delete(entries[i][0]);
        }
    }
    return session;
}

function _recordSessionAction(sender, action, detail = '') {
    const session = _getSession(sender);
    session.history.push({
        action,
        detail: detail.slice(0, 150),
        ts: Date.now()
    });
    if (session.history.length > 100) session.history = session.history.slice(-60);
    _metricsStore.lastActivity = Date.now();
}

function _verifyBulterIntegrity(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _integrityCache.data && (now - _integrityCache.ts) < _integrityCache.ttl) {
        return _integrityCache.data;
    }

    try {
        const content = fs.readFileSync(BULTER_PATH, 'utf8');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        const size = Buffer.byteLength(content, 'utf8');
        const lineCount = content.split('\n').length;
        const hasSwitchCommand = /switch\s*\(\s*command\s*\)/.test(content);
        const hasInjectPoint = content.includes('[ADDCASE_INJECT_POINT]') || content.includes('\ndefault:') || /\bdefault\s*:/.test(content);
        const caseMatches = content.match(/\/\/ === ADDCASE: (\S+)/g) || [];
        const injectedCases = caseMatches.map(m => m.replace('// === ADDCASE: ', ''));
        const endMatches = content.match(/\/\/ === END ADDCASE: (\S+) ===/g) || [];
        const endCases = endMatches.map(m => m.replace('// === END ADDCASE: ', '').replace(' ===', ''));
        const unmatchedStarts = injectedCases.filter(c => !endCases.includes(c));
        const unmatchedEnds = endCases.filter(c => !injectedCases.includes(c));

        const syntaxCheck = _validateSyntaxDeep(content);
        const braceBalance = syntaxCheck.stats.braceDepth;

        const result = {
            valid: hasSwitchCommand && hasInjectPoint && Math.abs(braceBalance) <= 10 && unmatchedStarts.length === 0,
            hash,
            size,
            lineCount,
            hasSwitchCommand,
            hasInjectPoint,
            injectedCases,
            braceBalance,
            unmatchedStarts,
            unmatchedEnds,
            syntaxErrors: syntaxCheck.errors.length,
            lastModified: fs.statSync(BULTER_PATH).mtime.toISOString(),
            checkedAt: new Date().toISOString()
        };

        _integrityCache.data = result;
        _integrityCache.ts = now;
        return result;
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

function _crossReferenceApproved() {
    const approved = _read(APPROVED_PATH, {});
    let content;
    try {
        content = fs.readFileSync(BULTER_PATH, 'utf8');
    } catch {
        return {};
    }
    const results = {};

    for (const [name, data] of Object.entries(approved)) {
        const marker = `// === ADDCASE: ${name} (`;
        const endMarker = `// === END ADDCASE: ${name} ===`;
        const existsInFile = content.includes(marker) && content.includes(endMarker);

        if (existsInFile) {
            const startIdx = content.indexOf(marker);
            const endIdx = content.indexOf(endMarker);
            const extractedCode = content.slice(
                content.indexOf('\n', startIdx) + 1,
                endIdx
            ).trim();
            const storedHash = _computeCodeHash(data.code || '');
            const fileHash = _computeCodeHash(extractedCode);
            const lineNum = content.slice(0, startIdx).split('\n').length;
            results[name] = {
                inFile: true,
                inApproved: true,
                hashMatch: storedHash === fileHash,
                modified: storedHash !== fileHash,
                currentLine: lineNum,
                codeLength: extractedCode.length,
                storedLength: (data.code || '').length
            };
        } else {
            results[name] = {
                inFile: false,
                inApproved: true,
                orphaned: true
            };
        }
    }

    const fileInjected = (content.match(/\/\/ === ADDCASE: (\S+)/g) || [])
        .map(m => m.replace('// === ADDCASE: ', ''));
    for (const name of fileInjected) {
        if (!results[name]) {
            results[name] = {
                inFile: true,
                inApproved: false,
                untracked: true
            };
        }
    }

    return results;
}

function _atomicWrite(filePath, data) {
    const tmpPath = filePath + '.tmp.' + crypto.randomBytes(6).toString('hex');
    try {
        const content = JSON.stringify(data, null, 2);
        fs.writeFileSync(tmpPath, content, 'utf8');
        const readBack = fs.readFileSync(tmpPath, 'utf8');
        const verification = JSON.parse(readBack);
        const originalStr = JSON.stringify(data);
        const verifyStr = JSON.stringify(verification);
        if (originalStr !== verifyStr) {
            throw new Error('Atomic write verification mismatch');
        }
        if (fs.existsSync(filePath)) {
            const bakPath = filePath + '.bak';
            try { fs.copyFileSync(filePath, bakPath); } catch {}
        }
        fs.renameSync(tmpPath, filePath);
    } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch {}
        throw e;
    }
}

function _safeWriteState(filePath, data) {
    const lockId = _acquireLock('filewrite:' + filePath, 10000);
    if (!lockId) {
        _write(filePath, data);
        return;
    }
    try {
        _ensureDir();
        _atomicWrite(filePath, data);
    } catch {
        _write(filePath, data);
    } finally {
        _releaseLock('filewrite:' + filePath, lockId);
    }
}

function _scheduleAutoExpire(cmdName, ttlMs = 3600000) {
    if (_pendingTimers.has(cmdName)) {
        clearTimeout(_pendingTimers.get(cmdName));
    }
    const timer = setTimeout(() => {
        const pending = _read(PENDING_PATH, {});
        if (pending[cmdName]) {
            const age = Date.now() - (pending[cmdName].createdAt || 0);
            if (age >= ttlMs) {
                delete pending[cmdName];
                _safeWriteState(PENDING_PATH, pending);
                logHistory('auto_expired', cmdName, 'system', `expired after ${Math.round(age / 60000)}m`);
            }
        }
        _pendingTimers.delete(cmdName);
    }, ttlMs);
    timer.unref && timer.unref();
    _pendingTimers.set(cmdName, timer);
}

function _analyzeCodeQuality(code) {
    const analysis = {
        score: 100,
        issues: [],
        suggestions: []
    };

    if (!/react/.test(code)) {
        analysis.score -= 5;
        analysis.suggestions.push('Tambahkan emoji react untuk UX yang lebih baik');
    }

    if (!/reply\s*\(/.test(code) && !/sendMessage/.test(code)) {
        analysis.score -= 10;
        analysis.issues.push('Tidak ada output ke user (reply/sendMessage)');
    }

    const hardcodedUrls = code.match(/['"`](https?:\/\/[^'"`\s]+)['"`]/g) || [];
    if (hardcodedUrls.length > 3) {
        analysis.score -= 5;
        analysis.suggestions.push('Banyak URL hardcoded, pertimbangkan config file');
    }

    if (/setTimeout\s*\(/.test(code) && !/clearTimeout/.test(code)) {
        analysis.score -= 3;
        analysis.suggestions.push('setTimeout tanpa clearTimeout (potential memory leak)');
    }

    if (/setInterval\s*\(/.test(code)) {
        analysis.score -= 8;
        analysis.issues.push('setInterval di dalam case handler (akan membuat interval baru tiap panggilan)');
    }

    const duplicateAwait = code.match(/await\s+.*\n\s*await\s+/g);
    if (duplicateAwait && duplicateAwait.length > 3) {
        analysis.suggestions.push('Banyak sequential await, pertimbangkan Promise.all untuk parallelism');
    }

    if (code.length > 5000 && !/function\s+\w+/.test(code)) {
        analysis.suggestions.push('Code panjang tanpa function extraction, pertimbangkan refactor');
    }

    const magicNumbers = code.match(/(?<![a-zA-Z_$])\b(?!0\b|1\b|2\b|200\b|404\b|500\b)\d{4,}\b/g);
    if (magicNumbers && magicNumbers.length > 2) {
        analysis.suggestions.push('Banyak magic number, pertimbangkan constants');
    }

    analysis.score = Math.max(0, Math.min(100, analysis.score));
    let grade = 'A';
    if (analysis.score < 85) grade = 'B';
    if (analysis.score < 70) grade = 'C';
    if (analysis.score < 50) grade = 'D';
    if (analysis.score < 30) grade = 'F';
    analysis.grade = grade;

    return analysis;
}

function _diffCodes(oldCode, newCode) {
    const oldLines = oldCode.split('\n');
    const newLines = newCode.split('\n');
    let added = 0;
    let removed = 0;
    let modified = 0;
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
        const oldLine = (oldLines[i] || '').trim();
        const newLine = (newLines[i] || '').trim();
        if (!oldLine && newLine) added++;
        else if (oldLine && !newLine) removed++;
        else if (oldLine !== newLine) modified++;
    }

    const similarity = oldCode.length > 0
        ? Math.round((1 - (added + removed + modified) / maxLen) * 100)
        : 0;

    return { added, removed, modified, oldLines: oldLines.length, newLines: newLines.length, similarity: Math.max(0, similarity) };
}

async function _getValidNonce() {
    const now = Date.now();
    if (_noncePool.values.length > 0 && (now - _noncePool.ts) < _noncePool.ttl) {
        const idx = Math.floor(Math.random() * _noncePool.values.length);
        return _noncePool.values[idx];
    }

    try {
        const res = await axios.get('https://chat-deep.ai/deepseek-chat/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36' },
            timeout: 10000
        });
        const patterns = [
            /var\s+nonce\s*=\s*['"]([^'"]+)['"]/,
            /data-nonce=["']([^"']+)["']/,
            /name="nonce"\s+value=["']([^"']+)["']/,
            /'nonce'\s*:\s*['"]([^'"]+)['"]/,
            /"nonce":"([^"]+)"/
        ];
        const foundNonces = [];
        for (const p of patterns) {
            const m = res.data.match(p);
            if (m?.[1]) foundNonces.push(m[1]);
        }
        if (foundNonces.length > 0) {
            _noncePool.values = [...new Set(foundNonces)].slice(0, _noncePool.maxSize);
            _noncePool.ts = now;
            return _noncePool.values[0];
        }
        return Date.now().toString();
    } catch { return Date.now().toString(); }
}

async function _deepseekChat(message, timeoutMs = 35000) {
    const nonce   = await _getValidNonce();
    const headers = {
        'Content-Type':     'application/x-www-form-urlencoded',
        'User-Agent':       'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
        'Origin':           'https://chat-deep.ai',
        'Referer':          'https://chat-deep.ai/deepseek-chat/',
        'Accept':           'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Cache-Control':    'no-cache'
    };

    const _doRequest = async (nonceVal) => {
        const form = new URLSearchParams();
        form.append('action',     'deepseek_chat');
        form.append('message',    message);
        form.append('nonce',      nonceVal);
        form.append('stream',     'false');
        form.append('max_tokens', '3000');
        const res = await axios.post('https://chat-deep.ai/wp-admin/admin-ajax.php', form.toString(), { headers, timeout: timeoutMs });
        return res;
    };

    const _extractText = (data) => {
        let t = data?.data?.response || data?.data?.message || data?.response
               || data?.message || data?.content
               || (data?.choices?.[0]?.message?.content)
               || (typeof data === 'string' ? data : null);
        if (t) return t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        return null;
    };

    const aiStart = Date.now();

    try {
        let res = await _retryWithBackoff(async (attempt) => {
            let nonceVal;
            if (attempt === 0) {
                nonceVal = nonce;
            } else if (_noncePool.values.length > attempt) {
                nonceVal = _noncePool.values[attempt];
            } else {
                _noncePool.values = [];
                _noncePool.ts = 0;
                nonceVal = await _getValidNonce();
            }

            const response = await _doRequest(nonceVal);
            if (response.data?.success === false) {
                const err = response.data.data?.message || response.data.data?.details || '';
                if (err.includes('invalid_nonce') || err.includes('Security check failed')) {
                    _noncePool.values = [];
                    _noncePool.ts = 0;
                    throw new Error('NONCE_INVALID');
                }
                throw new Error('API Error: ' + err);
            }
            return response;
        }, 3, 2500, 'deepseek_chat');

        const aiDuration = Date.now() - aiStart;
        _metricsStore.aiResponseTimes.push(aiDuration);
        if (_metricsStore.aiResponseTimes.length > 50) {
            _metricsStore.aiResponseTimes = _metricsStore.aiResponseTimes.slice(-30);
        }

        const text = _extractText(res.data);
        if (text) return text;
        throw new Error('Respons tidak valid: ' + JSON.stringify(res.data).slice(0, 200));
    } catch (e) {
        _metricsStore.totalFailures++;
        throw new Error('DeepAI gagal: ' + e.message);
    }
}

const BULTER_CONTEXT = `
Kamu adalah code generator untuk bot WhatsApp Baileys (bulter.js).
Kamu akan menghasilkan satu case JavaScript yang valid dan langsung bisa di-paste ke dalam switch(command) di bulter.js.

VARIABEL YANG TERSEDIA (sudah dideklarasikan di scope luar):
- m          : object pesan lengkap (m.chat, m.sender, m.mtype, m.key, m.quoted, m.mentionedJid, m.pushName)
- bulter     : WA socket (bulter.sendMessage, bulter.downloadMediaMessage, bulter.groupParticipantsUpdate, dll)
- text / q   : teks setelah command (sudah di-trim)
- args       : array argumen setelah command
- prefix     : prefix command (misal '.')
- command    : nama command yang dipanggil
- body       : full pesan mentah
- reply(teks): fungsi kirim reply
- isOwner, isCreator, isAdmins, isBotAdmins, isPremium : boolean role
- groupName, groupAdmins, participants, groupMetadata : data grup
- pushname   : nama pengirim
- fakeQuoted : object quoted standar
- mess       : { owner, admin, group, botadmin } pesan error standar
- prefix     : prefix aktif
- fs, path, axios, crypto : modul Node.js

ATURAN WAJIB:
1. Harus ada try/catch untuk semua operasi async
2. Harus validasi input dengan return reply() informatif jika tidak ada
3. Format reply pakai *bold* dan _italic_ WhatsApp markdown
4. Tambahkan react emoji di awal: bulter.sendMessage(m.chat, { react: { text: '⏳', key: m.key } })
5. Gunakan await untuk semua operasi async
6. Akhiri dengan break; di luar kurung kurawal terakhir
7. Jangan import/require apapun — semua sudah tersedia
8. Jangan gunakan console.log yang berlebihan
9. Tambahkan case alias jika relevan (misal 'tt' dan 'tiktok')
10. Kode harus ringkas tapi fungsional
`.trim();

function buildGeneratePrompt(cmdName, description) {
    return `${BULTER_CONTEXT}

TUGAS: Buat case untuk command berikut:
Nama Command : ${cmdName}
Deskripsi    : ${description}

OUTPUT: Hanya berikan kode JavaScript murni (case block), tanpa penjelasan, tanpa markdown code fence, tanpa komentar berlebihan.
Mulai langsung dari: case '${cmdName}':`;
}

function buildCorrectPrompt(code, cmdName) {
    return `${BULTER_CONTEXT}

TUGAS: Koreksi dan perbaiki kode case berikut agar kompatibel 100% dengan bulter.js:
1. Perbaiki variabel yang tidak sesuai konteks (misal: satanic → bulter, sock → bulter, message → m, sender → m.sender)
2. Pastikan ada try/catch jika ada operasi async
3. Pastikan ada validasi input
4. Perbaiki sintaks yang salah
5. Pastikan ada 'break;' di akhir

KODE YANG PERLU DIKOREKSI:
\`\`\`js
${code}
\`\`\`

OUTPUT: Hanya kode yang sudah diperbaiki, tanpa penjelasan, tanpa markdown fence.
Mulai langsung dari: case '${cmdName}':`;
}

function buildEditPrompt(code, cmdName, instruction) {
    return `${BULTER_CONTEXT}

TUGAS: Edit kode case berikut sesuai instruksi:
Instruksi: ${instruction}

KODE YANG ADA:
\`\`\`js
${code}
\`\`\`

OUTPUT: Hanya kode yang sudah diedit, tanpa penjelasan, tanpa markdown fence.
Mulai langsung dari: case '${cmdName}':`;
}


const DANGEROUS_PATTERNS = [
    { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/i,  label: 'require child_process'  },
    { pattern: /process\.exit\s*\(/i,                          label: 'process.exit'            },
    { pattern: /fs\.(rmdir|rm|unlink|rmSync|unlinkSync)\s*\(.*bulter\.js/i, label: 'hapus bulter.js' },
    { pattern: /fs\.(rmdir|rm)\s*\(\s*['"]\.\//i,             label: 'hapus folder root'       },
    { pattern: /new\s+Function\s*\(/i,                          label: 'new Function()'          },
    { pattern: /eval\s*\(\s*(?!.*evaled)/i,                    label: 'eval() berbahaya'        },
    { pattern: /\bexec\s*\(\s*[`'"]/i,                         label: 'exec() shell'            },
    { pattern: /spawn\s*\(\s*['"]bash/i,                        label: 'spawn bash'              },
    { pattern: /module\.exports\s*=/i,                          label: 'module.exports override' },
    { pattern: /global\.__proto__/i,                            label: 'prototype pollution'     },
];

function sanitizeCode(code) {
    const issues = [];
    for (const { pattern, label } of DANGEROUS_PATTERNS) {
        if (pattern.test(code)) issues.push(label);
    }

    const extendedPatterns = [
        { pattern: /require\s*\(\s*['"]net['"]\s*\)/i, label: 'require net' },
        { pattern: /require\s*\(\s*['"]dgram['"]\s*\)/i, label: 'require dgram' },
        { pattern: /require\s*\(\s*['"]cluster['"]\s*\)/i, label: 'require cluster' },
        { pattern: /require\s*\(\s*['"]worker_threads['"]\s*\)/i, label: 'require worker_threads' },
        { pattern: /require\s*\(\s*['"]vm['"]\s*\)/i, label: 'require vm' },
        { pattern: /require\s*\(\s*['"]v8['"]\s*\)/i, label: 'require v8' },
        { pattern: /require\s*\(\s*['"]inspector['"]\s*\)/i, label: 'require inspector' },
        { pattern: /require\s*\(\s*['"]perf_hooks['"]\s*\)/i, label: 'require perf_hooks' },
        { pattern: /process\.env/i, label: 'process.env access' },
        { pattern: /process\.kill\s*\(/i, label: 'process.kill' },
        { pattern: /process\.binding\s*\(/i, label: 'process.binding' },
        { pattern: /process\.dlopen\s*\(/i, label: 'process.dlopen' },
        { pattern: /process\.\_linkedBinding/i, label: 'process._linkedBinding' },
        { pattern: /process\.abort\s*\(/i, label: 'process.abort' },
        { pattern: /Reflect\.(construct|defineProperty|setPrototypeOf)/i, label: 'Reflect manipulation' },
        { pattern: /Object\.(setPrototypeOf|defineProperty|freeze|seal)\s*\(\s*(global|process|module|require)/i, label: 'global object manipulation' },
        { pattern: /constructor\s*\[\s*['"]constructor['"]\s*\]/i, label: 'constructor chain access' },
        { pattern: /__dirname\s*[+`].*\.\.\//i, label: 'directory traversal' },
        { pattern: /__filename/i, label: '__filename access' },
        { pattern: /while\s*\(\s*(true|1)\s*\)\s*\{(?![\s\S]{0,200}?(break|return))/i, label: 'infinite loop potential' },
        { pattern: /for\s*\(\s*;\s*;\s*\)\s*\{(?![\s\S]{0,200}?(break|return))/i, label: 'infinite for loop' },
        { pattern: /setInterval\s*\(\s*(?:function|\()\s*(?:\(\))?\s*(?:=>)?\s*\{[\s\S]*?\}\s*,\s*[0-9]{1,2}\s*\)/i, label: 'rapid interval (<100ms)' },
        { pattern: /Function\s*\(\s*['"`]return\s+this['"`]\s*\)\s*\(\s*\)/i, label: 'global this access via Function' },
        { pattern: /with\s*\(/i, label: 'with statement' },
        { pattern: /debugger\s*;/i, label: 'debugger statement' },
        { pattern: /fs\.(writeFileSync|writeFile)\s*\(\s*['"`]\.\/(?:index|package|bulter|config|\.env)/i, label: 'write critical file' },
        { pattern: /\.execSync\s*\(/i, label: 'execSync' },
        { pattern: /\.spawnSync\s*\(/i, label: 'spawnSync' },
        { pattern: /child_process/i, label: 'child_process reference' },
    ];

    for (const { pattern, label } of extendedPatterns) {
        if (pattern.test(code)) issues.push(label);
    }

    const maxCodeSize = 50000;
    if (code.length > maxCodeSize) {
        issues.push(`code terlalu besar (${code.length} > ${maxCodeSize})`);
    }

    const lineCount = code.split('\n').length;
    if (lineCount > 1000) {
        issues.push(`terlalu banyak baris (${lineCount} > 1000)`);
    }

    const hasBreak = /break\s*;?\s*\}?\s*$/.test(code.trim());
    const startsWithCase = /^case\s+['"]/.test(code.trim());

    const syntaxCheck = _validateSyntaxDeep(code);
    const qualityCheck = _analyzeCodeQuality(code);

    return {
        safe: issues.length === 0,
        issues,
        hasBreak,
        startsWithCase,
        syntaxValid: syntaxCheck.valid,
        syntaxErrors: syntaxCheck.errors,
        syntaxWarnings: syntaxCheck.warnings,
        codeStats: syntaxCheck.stats,
        quality: qualityCheck
    };
}

function cleanAICode(raw) {
    return raw
        .replace(/^```(?:javascript|js|node)?\n?/gm, '')
        .replace(/^```\s*$/gm, '')
        .replace(/^\s*\/\/ OUTPUT:.*$/gm, '')
        .trim();
}

function formatCodePreview(code, maxLen = 2500) {
    const lines  = code.split('\n');
    const header = `📄 *PREVIEW CODE* (${lines.length} baris)\n\`\`\`\n`;
    const footer = `\n\`\`\``;
    const body   = code.length > maxLen
        ? code.slice(0, maxLen) + '\n... (terpotong)'
        : code;
    return header + body + footer;
}


function backupBulter() {
    _ensureDir();
    const stamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bkPath = `${BACKUP_DIR}/bulter_${stamp}.js`;
    fs.copyFileSync(BULTER_PATH, bkPath);

    const content = fs.readFileSync(BULTER_PATH, 'utf8');
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    const integrity = _verifyBulterIntegrity(true);
    const metaPath = bkPath + '.meta.json';
    try {
        _atomicWrite(metaPath, {
            originalPath: BULTER_PATH,
            backupPath: bkPath,
            checksum,
            size: content.length,
            lineCount: content.split('\n').length,
            createdAt: new Date().toISOString(),
            injectedCases: integrity.injectedCases || [],
            braceBalance: integrity.braceBalance,
            syntaxErrors: integrity.syntaxErrors || 0
        });
    } catch {}

    const backups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('bulter_') && f.endsWith('.js'))
        .sort()
        .reverse();
    if (backups.length > 10) {
        backups.slice(10).forEach(f => {
            try { fs.unlinkSync(`${BACKUP_DIR}/${f}`); } catch {}
            try { fs.unlinkSync(`${BACKUP_DIR}/${f}.meta.json`); } catch {}
        });
    }
    return bkPath;
}

function injectCaseIntoBulter(cmdName, code) {
    const content = fs.readFileSync(BULTER_PATH, 'utf8');

    const existingStart = content.indexOf(`// === ADDCASE: ${cmdName} (`);
    const existingEnd = content.indexOf(`// === END ADDCASE: ${cmdName} ===`);
    if (existingStart !== -1 && existingEnd !== -1) {
        throw new Error(`Case '${cmdName}' sudah ada di bulter.js (baris ~${content.slice(0, existingStart).split('\n').length}). Gunakan rollbackcase dulu.`);
    }

    const _findDefaultMarker = (src) => {
        if (src.includes('// [ADDCASE_INJECT_POINT]')) return '// [ADDCASE_INJECT_POINT]';
        // Try different forms of default:
        for (const variant of ['\ndefault:', '\n    default:', '\n        default:', 'default:']) {
            if (src.includes(variant)) return variant;
        }
        return null;
    };
    const injectMarker = _findDefaultMarker(content);

    if (!injectMarker) {
        throw new Error('Tidak bisa menemukan titik inject di bulter.js.\nTambahkan komentar // [ADDCASE_INJECT_POINT] sebelum default: di switch(command).');
    }

    const fingerprint = _generateCaseFingerprint(code, cmdName);
    const timestamp = new Date().toLocaleString('id-ID');
    const codeBlock = `\n// === ADDCASE: ${cmdName} (${timestamp}) [${fingerprint}] ===\n${code}\n// === END ADDCASE: ${cmdName} ===\n`;
    const newContent = content.replace(injectMarker, codeBlock + injectMarker);

    const preCheck = _validateSyntaxDeep(content);
    const postCheck = _validateSyntaxDeep(newContent);

    if (postCheck.errors.length > preCheck.errors.length) {
        const newErrors = postCheck.errors.filter(e => !preCheck.errors.includes(e));
        if (newErrors.length > 0) {
            throw new Error(`Inject akan menambah error sintaks:\n${newErrors.join('\n')}`);
        }
    }

    const _braceDiff = Math.abs(postCheck.stats.braceDepth) - Math.abs(preCheck.stats.braceDepth);
    if (_braceDiff > 5) {
        throw new Error(`Inject menyebabkan ketidakseimbangan kurung berlebih (pre: ${preCheck.stats.braceDepth}, post: ${postCheck.stats.braceDepth}, diff: ${_braceDiff})`);
    }

    const lineNum = newContent.slice(0, newContent.indexOf(codeBlock)).split('\n').length;

    fs.writeFileSync(BULTER_PATH, newContent, 'utf8');
    _integrityCache.ts = 0;
    return lineNum;
}

function removeInjectedCase(cmdName) {
    const content = fs.readFileSync(BULTER_PATH, 'utf8');
    const startPattern = `// === ADDCASE: ${cmdName} (`;
    const end     = `// === END ADDCASE: ${cmdName} ===`;
    const si = content.indexOf(startPattern);
    const ei = content.indexOf(end);
    if (si === -1 || ei === -1) throw new Error(`Case '${cmdName}' tidak ditemukan di bulter.js`);

    const lineBeforeStart = content.lastIndexOf('\n', si - 1);
    const actualStart = lineBeforeStart !== -1 ? lineBeforeStart : si;
    const actualEnd = ei + end.length;
    const afterEnd = content.indexOf('\n', actualEnd);
    const finalEnd = afterEnd !== -1 ? afterEnd + 1 : actualEnd;

    const newContent = content.slice(0, actualStart) + content.slice(finalEnd);

    const preCheck = _validateSyntaxDeep(content);
    const postCheck = _validateSyntaxDeep(newContent);

    if (postCheck.errors.length > preCheck.errors.length) {
        const newErrors = postCheck.errors.filter(e => !preCheck.errors.includes(e));
        if (newErrors.length > 0) {
            throw new Error(`Rollback akan menambah error sintaks:\n${newErrors.join('\n')}`);
        }
    }

    fs.writeFileSync(BULTER_PATH, newContent, 'utf8');
    _integrityCache.ts = 0;
}

function logHistory(action, cmdName, actor, detail = '') {
    const db = _read(HISTORY_PATH, []);
    const session = _sessionPool.get(actor);
    db.push({
        ts:     Date.now(),
        time:   new Date().toLocaleString('id-ID'),
        action,
        cmdName,
        actor:  actor.split('@')[0],
        detail: detail.slice(0, 200),
        sessionId: session?.id || 'system',
        sequence: db.filter(h => h.cmdName === cmdName).length + 1
    });
    if (db.length > 500) db.splice(0, db.length - 300);
    _safeWriteState(HISTORY_PATH, db);
}

const _getPending = ()    => _read(PENDING_PATH, {});
const _getApproved = ()   => _read(APPROVED_PATH, {});

function pendingSet(cmdName, data) {
    const db = _getPending();
    const hash = data.code ? _computeCodeHash(data.code) : '';
    const structHash = data.code ? _computeStructuralHash(data.code) : '';
    const fingerprint = data.code ? _generateCaseFingerprint(data.code, cmdName) : '';
    const quality = data.code ? _analyzeCodeQuality(data.code) : { score: 0, grade: '?' };
    const existingVersion = db[cmdName]?.version || 0;

    const previousVersions = db[cmdName]
        ? [...(db[cmdName].previousVersions || []), {
            code: db[cmdName].code,
            codeHash: db[cmdName].codeHash,
            updatedAt: db[cmdName].updatedAt,
            version: existingVersion,
            fingerprint: db[cmdName].fingerprint,
            quality: db[cmdName].quality
        }].slice(-8)
        : [];

    db[cmdName] = {
        ...data,
        updatedAt: Date.now(),
        codeHash: hash,
        structHash,
        fingerprint,
        quality,
        version: existingVersion + 1,
        previousVersions
    };

    _safeWriteState(PENDING_PATH, db);
    _scheduleAutoExpire(cmdName, 7200000);
}

function pendingGet(cmdName) {
    return _getPending()[cmdName] || null;
}

function pendingDel(cmdName) {
    const db = _getPending();
    delete db[cmdName];
    _safeWriteState(PENDING_PATH, db);
    if (_pendingTimers.has(cmdName)) {
        clearTimeout(_pendingTimers.get(cmdName));
        _pendingTimers.delete(cmdName);
    }
}

function approvedSet(cmdName, data) {
    const db = _getApproved();
    const hash = data.code ? _computeCodeHash(data.code) : '';
    const structHash = data.code ? _computeStructuralHash(data.code) : '';
    const fingerprint = data.code ? _generateCaseFingerprint(data.code, cmdName) : '';
    const deps = data.code ? _detectExternalDependencies(data.code) : [];
    const quality = data.code ? _analyzeCodeQuality(data.code) : { score: 0, grade: '?' };

    const previousInjections = db[cmdName]
        ? [...(db[cmdName].previousInjections || []), {
            code: db[cmdName].code,
            injectedAt: db[cmdName].injectedAt,
            codeHash: db[cmdName].codeHash,
            fingerprint: db[cmdName].fingerprint,
            approvedBy: db[cmdName].approvedBy
        }].slice(-5)
        : [];

    db[cmdName] = {
        ...data,
        injectedAt: Date.now(),
        codeHash: hash,
        structHash,
        fingerprint,
        dependencies: deps,
        quality,
        injectionCount: (db[cmdName]?.injectionCount || 0) + 1,
        previousInjections
    };

    _safeWriteState(APPROVED_PATH, db);
}

async function handleAddCase(ctx) {
    const {
        m, bulter: sock, command, text, args,
        reply, isOwner, isCreator, fakeQuoted, prefix
    } = ctx;

    const _guard = () => {
        if (!isOwner && !isCreator) {
            reply('🚫 *Akses ditolak!*\n\nSistem addcase hanya untuk owner bot.');
            return false;
        }
        return true;
    };

    if (command === 'addcase') {
        if (!_guard()) return;

        const rateCheck = _checkRateLimit(m.sender, 'addcase', 5, 120000);
        if (!rateCheck.allowed) {
            return reply(`⏳ *Rate limit!* Tunggu ${rateCheck.waitSec} detik lagi.\n_Total blocked: ${rateCheck.totalBlocked}x (escalation: ${rateCheck.escalation})_`);
        }

        _recordSessionAction(m.sender, 'addcase_start', text?.slice(0, 80));
        const rawArg = text?.trim() || '';

        if (rawArg.toLowerCase().startsWith('manual')) {
            const parts = rawArg.split(/\s+/);
            const cmdName = parts[1]?.toLowerCase();

            if (!cmdName) return reply(
                `❌ *Format salah!*\n\nCara pakai manual:\n` +
                `1. Reply pesan yang berisi code kamu\n` +
                `2. Ketik: \`${prefix}addcase manual <nama_command>\`\n\n` +
                `Contoh: \`${prefix}addcase manual tt\``
            );

            const quotedText = m.quoted?.text || m.quoted?.body || m.quoted?.caption || '';
            if (!quotedText || quotedText.length < 10) {
                return reply(
                    `❌ Tidak ada code yang di-reply!\n\n` +
                    `Cara:\n` +
                    `1. Kirim code case kamu dulu\n` +
                    `2. Reply pesan itu dengan: \`${prefix}addcase manual ${cmdName}\``
                );
            }

            const dupeCheck = _checkCodeDuplication(quotedText, cmdName);
            if (dupeCheck.duplicate) {
                return reply(
                    `⚠️ *Code duplikat terdeteksi!*\n\n` +
                    `Tipe: ${dupeCheck.type === 'exact' ? 'identik 100%' : 'struktural serupa'}\n` +
                    `Mirip dengan: \`${dupeCheck.existingName}\` (${dupeCheck.source})\n\n` +
                    `Gunakan nama berbeda atau modifikasi code.`
                );
            }

            const approvedDb = _getApproved();
            if (approvedDb[cmdName]) {
                return reply(
                    `⚠️ Command \`${cmdName}\` sudah ter-inject di bulter.js!\n\n` +
                    `Gunakan \`${prefix}rollbackcase ${cmdName}\` dulu jika ingin membuat ulang.`
                );
            }

            sock.sendMessage(m.chat, { react: { text: '🔍', key: m.key } });
            await reply(
                `🔍 *Memvalidasi & mengoreksi code...*\n\n` +
                `📌 Command: \`${cmdName}\`\n` +
                `📏 Panjang code: ${quotedText.length} karakter\n\n` +
                `_DeepAI sedang menganalisis dan mengoreksi variabel..._`
            );

            let correctedCode;
            let aiUsed = false;

            try {
                const rawCode   = cleanAICode(quotedText);
                const prompt    = buildCorrectPrompt(rawCode, cmdName);
                const aiResult  = await _deepseekChat(prompt);
                correctedCode   = cleanAICode(aiResult);
                aiUsed          = true;
            } catch (aiErr) {
                correctedCode = cleanAICode(quotedText);
                await reply(`⚠️ AI koreksi gagal (${aiErr.message.slice(0, 80)})\n_Menggunakan code asli..._`);
            }

            const check = sanitizeCode(correctedCode);
            if (!check.safe) {
                sock.sendMessage(m.chat, { react: { text: '🚫', key: m.key } });
                return reply(
                    `🚫 *Code ditolak karena mengandung pola berbahaya!*\n\n` +
                    `Ditemukan:\n${check.issues.map(i => `• ${i}`).join('\n')}\n\n` +
                    `Hapus bagian tersebut dan coba lagi.`
                );
            }

            if (check.syntaxErrors && check.syntaxErrors.length > 0) {
                await reply(
                    `⚠️ *Peringatan sintaks:*\n${check.syntaxErrors.map(e => `• ${e}`).join('\n')}\n\n` +
                    `_Code tetap diproses, tapi mungkin error saat runtime._`
                );
            }

            if (!check.startsWithCase) {
                correctedCode = `case '${cmdName}': {\n${correctedCode}\n}`;
            }

            if (!check.hasBreak) {
                correctedCode = correctedCode.trimEnd() + '\n    break;\n}';
            }

            const deps = _detectExternalDependencies(correctedCode);

            pendingSet(cmdName, {
                code:       correctedCode,
                desc:       `Manual input${aiUsed ? ' + AI corrected' : ''}`,
                mode:       'manual',
                aiCorrected: aiUsed,
                originalCode: quotedText.slice(0, 2000),
                createdBy:  m.sender,
                createdAt:  Date.now(),
                dependencies: deps,
                codeStats:  check.codeStats || {}
            });

            logHistory('manual_added', cmdName, m.sender, `${quotedText.length} chars, ai=${aiUsed}, quality=${check.quality?.grade || '?'}`);
            _recordSessionAction(m.sender, 'manual_added', cmdName);
            _metricsStore.totalGenerated++;

            sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
            const preview = formatCodePreview(correctedCode);

            let depsInfo = '';
            if (deps.length > 0) {
                const httpDeps = deps.filter(d => d.type === 'http' || d.type === 'fetch' || d.type === 'http_get' || d.type === 'http_post');
                const otherDeps = deps.filter(d => !['http', 'fetch', 'http_get', 'http_post'].includes(d.type));
                if (httpDeps.length) depsInfo += `\n🌐 API: ${httpDeps.map(d => d.hostname).join(', ')}`;
                if (otherDeps.length) depsInfo += `\n🔧 Modules: ${otherDeps.map(d => d.type).join(', ')}`;
            }

            let warningsInfo = '';
            if (check.syntaxWarnings && check.syntaxWarnings.length > 0) {
                warningsInfo = `\n⚠️ Warnings: ${check.syntaxWarnings.length}`;
            }

            let qualityInfo = '';
            if (check.quality) {
                qualityInfo = `\n🏆 Quality: ${check.quality.grade} (${check.quality.score}/100)`;
            }

            await sock.sendMessage(m.chat, {
                text:
                    `✅ *Code berhasil diproses!*\n\n` +
                    `📌 Command: \`${prefix}${cmdName}\`\n` +
                    `🤖 AI Koreksi: ${aiUsed ? '✅ Diterapkan' : '⚠️ Dilewati (error)'}\n` +
                    `🔒 Safety: ✅ Aman\n` +
                    `📊 Complexity: ${check.codeStats?.complexity || '?'}` +
                    `${qualityInfo}${depsInfo}${warningsInfo}\n\n` +
                    `${preview}\n\n` +
                    `*Langkah selanjutnya:*\n` +
                    `✅ Inject → \`${prefix}approvecase ${cmdName}\`\n` +
                    `✏️ Edit   → \`${prefix}editcase ${cmdName} <instruksi>\`\n` +
                    `❌ Batal  → \`${prefix}cancelcase ${cmdName}\``,
            }, { quoted: fakeQuoted });
            return;
        }

        if (!rawArg.includes('|')) {
            return reply(
                `❌ *Format salah!*\n\n` +
                `*AI Generate:*\n\`${prefix}addcase <cmd> | <deskripsi>\`\n` +
                `Contoh: \`${prefix}addcase tt | download tiktok tanpa watermark\`\n\n` +
                `*Manual Input:*\n\`${prefix}addcase manual <cmd>\` (sambil reply code)\n` +
                `Contoh: \`${prefix}addcase manual mycommand\``
            );
        }

        const [cmdRaw, ...descParts] = rawArg.split('|');
        const cmdName = cmdRaw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const desc    = descParts.join('|').trim();

        if (!cmdName || !desc) return reply('❌ Command dan deskripsi tidak boleh kosong!');
        if (cmdName.length > 30) return reply('❌ Nama command maksimal 30 karakter!');

        if (pendingGet(cmdName)) {
            return reply(
                `⚠️ Command \`${cmdName}\` sudah ada di pending!\n\n` +
                `Gunakan:\n` +
                `• \`${prefix}previewcase ${cmdName}\` — lihat code\n` +
                `• \`${prefix}editcase ${cmdName} <instruksi>\` — edit\n` +
                `• \`${prefix}cancelcase ${cmdName}\` — batalkan dulu\n` +
                `• \`${prefix}approvecase ${cmdName}\` — langsung inject`
            );
        }

        const approvedDb = _getApproved();
        if (approvedDb[cmdName]) {
            return reply(
                `⚠️ Command \`${cmdName}\` sudah ter-inject di bulter.js!\n\n` +
                `Gunakan \`${prefix}rollbackcase ${cmdName}\` dulu jika ingin membuat ulang.`
            );
        }

        sock.sendMessage(m.chat, { react: { text: '🤖', key: m.key } });
        await reply(
            `🤖 *DeepAI sedang generate code...*\n\n` +
            `📌 Command: \`${cmdName}\`\n` +
            `📝 Deskripsi: ${desc}\n\n` +
            `_Mohon tunggu ~10-30 detik..._`
        );

        let generatedCode;
        try {
            const prompt = buildGeneratePrompt(cmdName, desc);
            const aiRes  = await _deepseekChat(prompt, 40000);
            generatedCode = cleanAICode(aiRes);
        } catch (e) {
            sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return reply(`❌ *DeepAI gagal generate code!*\n\nError: ${e.message.slice(0, 200)}\n\nCoba lagi atau gunakan mode manual.`);
        }

        const check = sanitizeCode(generatedCode);
        if (!check.safe) {
            return reply(`🚫 *Code yang dihasilkan mengandung pola berbahaya:*\n${check.issues.map(i => `• ${i}`).join('\n')}\n\nCoba generate ulang.`);
        }

        if (!check.startsWithCase) generatedCode = `case '${cmdName}': {\n${generatedCode}\n}`;
        if (!check.hasBreak) generatedCode = generatedCode.trimEnd() + '\n    break;\n}';

        const dupeCheck = _checkCodeDuplication(generatedCode, cmdName);
        const deps = _detectExternalDependencies(generatedCode);

        pendingSet(cmdName, {
            code:       generatedCode,
            desc,
            mode:       'ai_generated',
            aiCorrected: true,
            createdBy:  m.sender,
            createdAt:  Date.now(),
            dependencies: deps,
            codeStats:  check.codeStats || {},
            duplicateWarning: dupeCheck.duplicate ? `${dupeCheck.type}:${dupeCheck.existingName}` : null
        });

        logHistory('ai_generated', cmdName, m.sender, `${desc.slice(0, 60)}, quality=${check.quality?.grade || '?'}`);
        _recordSessionAction(m.sender, 'ai_generated', cmdName);
        _metricsStore.totalGenerated++;
        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });

        const preview = formatCodePreview(generatedCode);

        let extraInfo = '';
        if (dupeCheck.duplicate) {
            extraInfo += `\n⚠️ Mirip dengan: \`${dupeCheck.existingName}\` (${dupeCheck.type})`;
        }
        if (deps.length > 0) {
            const httpDeps = deps.filter(d => ['http', 'fetch', 'http_get', 'http_post'].includes(d.type));
            if (httpDeps.length) extraInfo += `\n🌐 API: ${httpDeps.map(d => d.hostname).join(', ')}`;
        }
        if (check.quality) {
            extraInfo += `\n🏆 Quality: ${check.quality.grade} (${check.quality.score}/100)`;
        }

        await sock.sendMessage(m.chat, {
            text:
                `✅ *Code berhasil di-generate!*\n\n` +
                `📌 Command: \`${prefix}${cmdName}\`\n` +
                `📝 Desc: ${desc}\n` +
                `📊 Complexity: ${check.codeStats?.complexity || '?'}` +
                `${extraInfo}\n\n` +
                `${preview}\n\n` +
                `*Langkah selanjutnya:*\n` +
                `✅ Inject  → \`${prefix}approvecase ${cmdName}\`\n` +
                `✏️ Edit    → \`${prefix}editcase ${cmdName} <instruksi>\`\n` +
                `❌ Batal   → \`${prefix}cancelcase ${cmdName}\``,
        }, { quoted: fakeQuoted });
        return;
    }

    if (command === 'approvecase') {
        if (!_guard()) return;

        const rateCheck = _checkRateLimit(m.sender, 'approve', 3, 60000);
        if (!rateCheck.allowed) {
            return reply(`⏳ *Rate limit!* Tunggu ${rateCheck.waitSec} detik.`);
        }

        const cmdName = (args[0] || '').toLowerCase().trim();
        if (!cmdName) return reply(`❌ Format: \`${prefix}approvecase <nama_command>\``);

        const pending = pendingGet(cmdName);
        if (!pending) return reply(`❌ Tidak ada pending case untuk \`${cmdName}\`.\n\nGunakan \`${prefix}listcase\` untuk lihat semua.`);

        const integrityCheck = _verifyBulterIntegrity(true);
        if (!integrityCheck.valid) {
            return reply(
                `❌ *bulter.js integrity check gagal!*\n\n` +
                `Error: ${integrityCheck.error || 'Struktur file tidak valid'}\n` +
                `Brace balance: ${integrityCheck.braceBalance ?? '?'}\n` +
                `Syntax errors: ${integrityCheck.syntaxErrors ?? '?'}\n` +
                `Unmatched markers: ${(integrityCheck.unmatchedStarts || []).join(', ') || 'none'}\n\n` +
                `_Perbaiki bulter.js secara manual sebelum inject._`
            );
        }

        const crossRef = _crossReferenceApproved();
        const orphanedCount = Object.values(crossRef).filter(v => v.orphaned).length;
        const untrackedCount = Object.values(crossRef).filter(v => v.untracked).length;
        const modifiedCount = Object.values(crossRef).filter(v => v.modified).length;

        if (orphanedCount > 2 || untrackedCount > 2 || modifiedCount > 0) {
            await reply(
                `⚠️ *Inkonsistensi terdeteksi:*\n` +
                `• ${orphanedCount} case tercatat tapi tidak di file\n` +
                `• ${untrackedCount} case di file tapi tidak tercatat\n` +
                `• ${modifiedCount} case dimodifikasi manual\n\n` +
                `_Inject tetap dilanjutkan._`
            );
        }

        if (pending.quality && pending.quality.grade === 'F') {
            await reply(
                `⚠️ *Code quality sangat rendah (grade F)*\n` +
                `Score: ${pending.quality.score}/100\n` +
                `${(pending.quality.issues || []).map(i => `• ${i}`).join('\n')}\n\n` +
                `_Pertimbangkan editcase sebelum inject._`
            );
        }

        const lockId = _acquireLock('bulter_inject', 30000);
        if (!lockId) {
            return reply(`⏳ *Ada proses inject lain yang sedang berjalan.* Tunggu sebentar.`);
        }

        sock.sendMessage(m.chat, { react: { text: '💾', key: m.key } });

        let backupPath;
        try {
            backupPath = backupBulter();
        } catch (e) {
            _releaseLock('bulter_inject', lockId);
            return reply(`❌ Gagal backup bulter.js: ${e.message}\n\nInject dibatalkan demi keamanan.`);
        }

        let lineNum;
        try {
            lineNum = injectCaseIntoBulter(cmdName, pending.code);
        } catch (e) {
            _releaseLock('bulter_inject', lockId);
            return reply(`❌ Gagal inject: ${e.message}`);
        }

        const postIntegrity = _verifyBulterIntegrity(true);
        if (!postIntegrity.valid) {
            try {
                fs.copyFileSync(backupPath, BULTER_PATH);
                _integrityCache.ts = 0;
                _releaseLock('bulter_inject', lockId);
                return reply(
                    `❌ *Inject menyebabkan kerusakan file!*\n\n` +
                    `File telah di-restore dari backup.\n` +
                    `Brace balance: ${postIntegrity.braceBalance ?? '?'}\n` +
                    `Unmatched: ${(postIntegrity.unmatchedStarts || []).join(', ') || 'none'}`
                );
            } catch (restoreErr) {
                _releaseLock('bulter_inject', lockId);
                return reply(`🚨 *CRITICAL: Gagal restore backup!*\nRestore manual dari: \`${path.basename(backupPath)}\``);
            }
        }

        pendingDel(cmdName);
        approvedSet(cmdName, {
            code:      pending.code,
            desc:      pending.desc,
            mode:      pending.mode,
            backupPath,
            lineNum,
            approvedBy: m.sender,
            bulterHash: postIntegrity.hash,
            codeStats: pending.codeStats,
            dependencies: pending.dependencies,
            version: pending.version
        });

        _releaseLock('bulter_inject', lockId);
        logHistory('approved_injected', cmdName, m.sender, `line ${lineNum}, backup: ${path.basename(backupPath)}, quality: ${pending.quality?.grade || '?'}`);
        _recordSessionAction(m.sender, 'approved', cmdName);
        _metricsStore.totalInjected++;

        sock.sendMessage(m.chat, { react: { text: '🚀', key: m.key } });
        await reply(
            `🚀 *Case berhasil di-inject ke bulter.js!*\n\n` +
            `📌 Command: \`${prefix}${cmdName}\`\n` +
            `📍 Di injeksi di baris: *${lineNum}*\n` +
            `💾 Backup: \`${path.basename(backupPath)}\`\n\n` +
            `_Restart bot agar command aktif:_\n\`${prefix}restart\`\n\n` +
            `⚠️ Jika ada masalah:\n\`${prefix}rollbackcase ${cmdName}\``
        );
        return;
    }

    
    if (command === 'editcase') {
        if (!_guard()) return;

        const rateCheck = _checkRateLimit(m.sender, 'editcase', 5, 120000);
        if (!rateCheck.allowed) {
            return reply(`⏳ *Rate limit!* Tunggu ${rateCheck.waitSec} detik.`);
        }

        const cmdName    = (args[0] || '').toLowerCase().trim();
        const instruction = args.slice(1).join(' ').trim();

        if (!cmdName) return reply(`❌ Format: \`${prefix}editcase <cmd> <instruksi>\`\nContoh: \`${prefix}editcase tt tambahkan limit premium\``);
        if (!instruction) return reply('❌ Masukkan instruksi edit!');

        const pending = pendingGet(cmdName);
        if (!pending) return reply(`❌ Tidak ada pending case \`${cmdName}\`.`);

        if (pending.version && pending.version >= 15) {
            return reply(
                `⚠️ Case \`${cmdName}\` sudah diedit ${pending.version}x.\n` +
                `Terlalu banyak revisi bisa menurunkan kualitas.\n` +
                `Pertimbangkan \`${prefix}cancelcase ${cmdName}\` dan buat ulang.`
            );
        }

        sock.sendMessage(m.chat, { react: { text: '✏️', key: m.key } });
        await reply(`✏️ *DeepAI sedang merevisi code...*\n\n📌 Command: \`${cmdName}\`\n📝 Instruksi: ${instruction}\n\n_Mohon tunggu..._`);

        let editedCode;
        try {
            const prompt = buildEditPrompt(pending.code, cmdName, instruction);
            const aiRes  = await _deepseekChat(prompt, 40000);
            editedCode   = cleanAICode(aiRes);
        } catch (e) {
            return reply(`❌ DeepAI gagal edit: ${e.message.slice(0, 150)}`);
        }

        const check = sanitizeCode(editedCode);
        if (!check.safe) return reply(`🚫 Hasil edit mengandung pola berbahaya:\n${check.issues.map(i => `• ${i}`).join('\n')}`);
        if (!check.hasBreak) editedCode = editedCode.trimEnd() + '\n    break;\n}';

        if (check.syntaxErrors && check.syntaxErrors.length > 0) {
            await reply(
                `⚠️ *Peringatan sintaks pada hasil edit:*\n` +
                `${check.syntaxErrors.map(e => `• ${e}`).join('\n')}\n\n` +
                `_Code tetap disimpan._`
            );
        }

        const diff = _diffCodes(pending.code, editedCode);

        pendingSet(cmdName, {
            ...pending,
            code: editedCode,
            lastEdit: Date.now(),
            lastInstruction: instruction,
            codeStats: check.codeStats || {},
            lastDiff: diff
        });

        logHistory('edited', cmdName, m.sender, `${instruction.slice(0, 60)}, +${diff.added}/-${diff.removed}/~${diff.modified}`);
        _recordSessionAction(m.sender, 'edited', `${cmdName}: ${instruction.slice(0, 40)}`);
        _metricsStore.totalEdits++;

        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        const preview = formatCodePreview(editedCode);

        let diffInfo = '';
        if (diff) {
            diffInfo = `\n📊 Perubahan: +${diff.added} -${diff.removed} ~${diff.modified} baris (${diff.similarity}% similar)`;
        }

        await sock.sendMessage(m.chat, {
            text:
                `✅ *Code berhasil diedit!*\n\n` +
                `📌 Command: \`${cmdName}\`\n` +
                `📝 Instruksi: ${instruction}` +
                `${diffInfo}\n\n` +
                `${preview}\n\n` +
                `✅ Inject → \`${prefix}approvecase ${cmdName}\`\n` +
                `✏️ Edit lagi → \`${prefix}editcase ${cmdName} <instruksi>\``,
        }, { quoted: fakeQuoted });
        return;
    }


    if (command === 'previewcase') {
        if (!_guard()) return;
        const cmdName = (args[0] || '').toLowerCase().trim();
        if (!cmdName) return reply(`❌ Format: \`${prefix}previewcase <cmd>\``);

        const pending = pendingGet(cmdName);
        if (!pending) return reply(`❌ Tidak ada pending case \`${cmdName}\`.`);

        const age  = Math.round((Date.now() - pending.createdAt) / 60000);
        const preview = formatCodePreview(pending.code);

        const deps = pending.dependencies || _detectExternalDependencies(pending.code || '');
        let depsText = '';
        if (deps.length > 0) {
            depsText = `\n🔗 Dependencies:\n${deps.map(d => {
                if (d.type === 'http' || d.type === 'fetch') return `  • HTTP: ${d.hostname}${d.secure === false ? ' ⚠️HTTP' : ''}`;
                if (d.type === 'filesystem') return `  • FS: ${d.operations.join(', ')} (${d.count}x)`;
                if (d.type === 'baileys') return `  • Baileys: ${d.methods.join(', ')}`;
                if (d.type === 'buffer') return `  • Buffer: ${d.operations.join(', ')}`;
                if (d.type === 'crypto') return `  • Crypto: ${d.operations.join(', ')}`;
                return `  • ${d.type}`;
            }).join('\n')}`;
        }

        let versionText = '';
        if (pending.version && pending.version > 1) {
            versionText = `\n📋 Version: v${pending.version} (${(pending.previousVersions || []).length} revisi)`;
        }

        let statsText = '';
        if (pending.codeStats) {
            const s = pending.codeStats;
            statsText = `\n📊 Stats: ${s.lines || '?'} baris, complexity ${s.complexity || '?'}`;
            if (s.maintainability) {
                statsText += `, maintainability ${s.maintainability.grade} (${s.maintainability.score})`;
            }
        }

        let qualityText = '';
        if (pending.quality) {
            qualityText = `\n🏆 Quality: ${pending.quality.grade} (${pending.quality.score}/100)`;
            if (pending.quality.issues && pending.quality.issues.length > 0) {
                qualityText += `\n  Issues: ${pending.quality.issues.join(', ')}`;
            }
        }

        let diffText = '';
        if (pending.lastDiff) {
            const d = pending.lastDiff;
            diffText = `\n📝 Last edit diff: +${d.added} -${d.removed} ~${d.modified} (${d.similarity}% similar)`;
        }

        await reply(
            `📋 *PREVIEW: ${cmdName}*\n\n` +
            `📝 Desc: ${pending.desc || '-'}\n` +
            `🤖 Mode: ${pending.mode}\n` +
            `🕐 Dibuat: ${age} menit lalu\n` +
            `👤 Oleh: @${pending.createdBy?.split('@')[0] || '?'}` +
            `${versionText}${statsText}${qualityText}${diffText}${depsText}\n\n` +
            `${preview}`
        );
        return;
    }

    if (command === 'cancelcase') {
        if (!_guard()) return;
        const cmdName = (args[0] || '').toLowerCase().trim();
        if (!cmdName) return reply(`❌ Format: \`${prefix}cancelcase <cmd>\``);

        if (!pendingGet(cmdName)) return reply(`❌ Tidak ada pending case \`${cmdName}\`.`);
        pendingDel(cmdName);
        logHistory('cancelled', cmdName, m.sender, '');
        _recordSessionAction(m.sender, 'cancelled', cmdName);
        reply(`🗑️ Pending case \`${cmdName}\` dibatalkan.`);
        return;
    }


    if (command === 'listcase') {
        if (!_guard()) return;
        const pending  = _getPending();
        const approved = _getApproved();
        const pKeys    = Object.keys(pending);
        const aKeys    = Object.keys(approved);

        let txt = `📋 *ADDCASE STATUS*\n\n`;

        if (pKeys.length) {
            txt += `⏳ *Pending (${pKeys.length}):*\n`;
            pKeys.forEach(k => {
                const p   = pending[k];
                const age = Math.round((Date.now() - p.createdAt) / 60000);
                txt += `• \`${k}\` — ${p.mode}`;
                if (p.version && p.version > 1) txt += ` v${p.version}`;
                if (p.quality) txt += ` [${p.quality.grade}]`;
                txt += ` — ${age}m lalu\n`;
            });
        } else { txt += `⏳ *Pending:* Tidak ada\n`; }

        txt += `\n`;

        if (aKeys.length) {
            txt += `✅ *Injected (${aKeys.length}):*\n`;
            aKeys.slice(-8).forEach(k => {
                const a = approved[k];
                txt += `• \`${k}\` — baris ${a.lineNum || '?'}`;
                if (a.fingerprint) txt += ` [${a.fingerprint.slice(0, 8)}]`;
                if (a.quality) txt += ` ${a.quality.grade}`;
                if (a.injectionCount && a.injectionCount > 1) txt += ` (${a.injectionCount}x)`;
                txt += `\n`;
            });
        } else { txt += `✅ *Injected:* Tidak ada\n`; }

        const crossRef = _crossReferenceApproved();
        const orphaned = Object.entries(crossRef).filter(([, v]) => v.orphaned);
        const untracked = Object.entries(crossRef).filter(([, v]) => v.untracked);
        const modified = Object.entries(crossRef).filter(([, v]) => v.modified);

        if (orphaned.length || untracked.length || modified.length) {
            txt += `\n⚠️ *Inkonsistensi:*\n`;
            if (orphaned.length) txt += `• ${orphaned.length} orphaned: ${orphaned.map(([n]) => n).join(', ')}\n`;
            if (untracked.length) txt += `• ${untracked.length} untracked: ${untracked.map(([n]) => n).join(', ')}\n`;
            if (modified.length) txt += `• ${modified.length} modified: ${modified.map(([n]) => n).join(', ')}\n`;
        }

        const integrity = _verifyBulterIntegrity();
        if (integrity.valid) {
            txt += `\n📁 *bulter.js:* ✅ ${integrity.lineCount} baris, ${integrity.injectedCases.length} injected cases`;
        } else {
            txt += `\n📁 *bulter.js:* ❌ Integrity check gagal`;
        }

        const avgAiTime = _metricsStore.aiResponseTimes.length > 0
            ? Math.round(_metricsStore.aiResponseTimes.reduce((a, b) => a + b, 0) / _metricsStore.aiResponseTimes.length / 1000)
            : 0;
        txt += `\n\n📊 *Stats:* ${_metricsStore.totalGenerated} generated, ${_metricsStore.totalInjected} injected, ${_metricsStore.totalEdits} edits, ${_metricsStore.totalRollbacks} rollbacks`;
        if (avgAiTime > 0) txt += `, avg AI: ${avgAiTime}s`;

        txt += `\n\n_Gunakan \`${prefix}previewcase <cmd>\` untuk lihat code_`;
        reply(txt);
        return;
    }

    if (command === 'rollbackcase') {
        if (!_guard()) return;

        const rateCheck = _checkRateLimit(m.sender, 'rollback', 3, 60000);
        if (!rateCheck.allowed) {
            return reply(`⏳ *Rate limit!* Tunggu ${rateCheck.waitSec} detik.`);
        }

        const cmdName = (args[0] || '').toLowerCase().trim();
        if (!cmdName) return reply(`❌ Format: \`${prefix}rollbackcase <cmd>\``);

        const approved = _getApproved();
        if (!approved[cmdName]) return reply(`❌ Case \`${cmdName}\` tidak ada di list injected.`);

        const lockId = _acquireLock('bulter_inject', 30000);
        if (!lockId) {
            return reply(`⏳ *Ada proses lain yang sedang berjalan.* Tunggu sebentar.`);
        }

        sock.sendMessage(m.chat, { react: { text: '⏮️', key: m.key } });

        try {
            backupBulter();
            removeInjectedCase(cmdName);

            const postIntegrity = _verifyBulterIntegrity(true);
            if (!postIntegrity.valid && Math.abs(postIntegrity.braceBalance || 0) > 2) {
                const backups = fs.readdirSync(BACKUP_DIR)
                    .filter(f => f.startsWith('bulter_') && f.endsWith('.js'))
                    .sort()
                    .reverse();
                if (backups.length > 0) {
                    fs.copyFileSync(`${BACKUP_DIR}/${backups[0]}`, BULTER_PATH);
                    _integrityCache.ts = 0;
                    _releaseLock('bulter_inject', lockId);
                    logHistory('rollback_failed_restored', cmdName, m.sender, 'auto-restored from backup');
                    return reply(
                        `⚠️ Rollback menyebabkan kerusakan. File di-restore dari backup terbaru.\n` +
                        `Coba rollback manual.`
                    );
                }
            }
        } catch (e) {
            _releaseLock('bulter_inject', lockId);
            return reply(`❌ Rollback gagal: ${e.message}`);
        }

        const db = _getApproved();
        const removedData = db[cmdName];
        delete db[cmdName];
        _safeWriteState(APPROVED_PATH, db);

        _releaseLock('bulter_inject', lockId);
        logHistory('rolled_back', cmdName, m.sender, `was at line ${removedData?.lineNum || '?'}`);
        _recordSessionAction(m.sender, 'rolled_back', cmdName);
        _metricsStore.totalRollbacks++;

        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        reply(`✅ Case \`${cmdName}\` berhasil dihapus dari bulter.js.\n\nRestart bot: \`${prefix}restart\``);
        return;
    }

    if (command === 'historycase') {
        if (!_guard()) return;
        const limit   = parseInt(args[0]) || 15;
        const filterCmd = args[1]?.toLowerCase();
        let history = _read(HISTORY_PATH, []);

        if (filterCmd) {
            history = history.filter(h => h.cmdName === filterCmd);
        }

        history = history.slice(-limit).reverse();

        if (!history.length) return reply(`📋 Belum ada history addcase${filterCmd ? ` untuk '${filterCmd}'` : ''}.`);

        const txt = history.map(h => {
            let icon = '📝';
            if (h.action.includes('approved')) icon = '✅';
            else if (h.action.includes('rolled')) icon = '⏮️';
            else if (h.action.includes('cancel')) icon = '❌';
            else if (h.action.includes('edit')) icon = '✏️';
            else if (h.action.includes('generated')) icon = '🤖';
            else if (h.action.includes('manual')) icon = '📋';
            else if (h.action.includes('expired')) icon = '⏰';
            else if (h.action.includes('failed')) icon = '🚨';

            let entry = `${icon} [${h.time}] *${h.action}* — \`${h.cmdName}\` oleh @${h.actor}`;
            if (h.sessionId && h.sessionId !== 'system' && h.sessionId !== 'none') {
                entry += ` (${h.sessionId.slice(0, 6)})`;
            }
            if (h.detail) entry += `\n   _${h.detail}_`;
            return entry;
        }).join('\n\n');

        let header = `📋 *HISTORY ADDCASE (${history.length})*`;
        if (filterCmd) header += ` — filter: ${filterCmd}`;
        header += `\n\n`;

        reply(header + txt);
        return;
    }
}


module.exports = {
    handleAddCase,
    deepseekChat: _deepseekChat,
    sanitizeCode,
    cleanAICode,
};
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DOC_DIR = './database/autodoc';
const ERROR_LOG_PATH = `${DOC_DIR}/errors.json`;
const HEALTH_LOG_PATH = `${DOC_DIR}/health.json`;
const REPAIR_LOG_PATH = `${DOC_DIR}/repairs.json`;
const SNAPSHOT_PATH = `${DOC_DIR}/snapshot.json`;
const CONFIG_PATH = `${DOC_DIR}/config.json`;

const _ensureDir = () => { if (!fs.existsSync(DOC_DIR)) fs.mkdirSync(DOC_DIR, { recursive: true }); };
const _read = (p, fb = {}) => { try { _ensureDir(); return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const _write = (p, d) => { try { _ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} };

const _state = {
    initialized: false,
    bootTime: Date.now(),
    lastHealthCheck: 0,
    lastAutoFix: 0,
    errorBuffer: [],
    errorPatterns: new Map(),
    crashTimestamps: [],
    memorySnapshots: [],
    healingInProgress: false,
    watchdogTimer: null,
    healthTimer: null,
    memoryTimer: null,
    gcTimer: null,
    connectionState: 'unknown',
    reconnectAttempts: 0,
    maxReconnectAttempts: 15,
    totalErrorsCaught: 0,
    totalAutoFixes: 0,
    totalSelfHeals: 0,
    repairQueue: [],
    blockedModules: new Set(),
    degradedFeatures: new Set(),
    alertsSent: 0,
    lastAlertTime: 0,
    ownerNotified: false,
    socketRef: null,
    fileIntegrityMap: new Map(),
    baselineMemory: null,
    peakMemory: 0,
    errorRateWindow: [],
    healthScore: 100,
    diagnosticResults: [],
    autoFixHistory: [],
    suspectedLeaks: [],
    eventLoopLag: 0,
    eventLoopSamples: [],
    diskCheckTime: 0,
    cpuUsagePrev: null,
    responseTimeAvg: 0,
    responseTimeSamples: [],
    commandErrorMap: new Map(),
    fatalCount: 0,
    warningCount: 0,
    criticalThresholds: {
        memoryPercent: 85,
        errorRatePerMinute: 10,
        crashLoopCount: 5,
        crashLoopWindowMs: 300000,
        eventLoopLagMs: 500,
        diskUsagePercent: 90,
        healthScoreMin: 30,
        responseTimeMaxMs: 5000,
        fileCorruptionMax: 3,
        reconnectCooldownMs: 30000
    }
};

const ERROR_CATEGORIES = {
    CONNECTION: { label: 'Connection', icon: '🔌', severity: 'high', autofix: true },
    MEMORY: { label: 'Memory', icon: '🧠', severity: 'critical', autofix: true },
    FILESYSTEM: { label: 'Filesystem', icon: '📁', severity: 'high', autofix: true },
    TIMEOUT: { label: 'Timeout', icon: '⏱️', severity: 'medium', autofix: true },
    PERMISSION: { label: 'Permission', icon: '🔒', severity: 'high', autofix: false },
    SYNTAX: { label: 'Syntax', icon: '📝', severity: 'low', autofix: false },
    RUNTIME: { label: 'Runtime', icon: '💥', severity: 'medium', autofix: false },
    MODULE: { label: 'Module', icon: '📦', severity: 'high', autofix: true },
    NETWORK: { label: 'Network', icon: '🌐', severity: 'medium', autofix: true },
    DATABASE: { label: 'Database', icon: '🗄️', severity: 'high', autofix: true },
    BAILEYS: { label: 'Baileys/WA', icon: '📱', severity: 'high', autofix: true },
    UNKNOWN: { label: 'Unknown', icon: '❔', severity: 'low', autofix: false }
};

const ERROR_SIGNATURES = [
    { pattern: /ECONNREFUSED|ECONNRESET|ECONNABORTED|EPIPE|EHOSTUNREACH/i, category: 'CONNECTION', fixStrategy: 'reconnect' },
    { pattern: /ETIMEDOUT|ESOCKETTIMEDOUT|timeout|Timed?\s*out/i, category: 'TIMEOUT', fixStrategy: 'retry' },
    { pattern: /ENOENT|EACCES|EPERM|EISDIR|ENOTDIR/i, category: 'FILESYSTEM', fixStrategy: 'repair_fs' },
    { pattern: /ENOMEM|heap|out of memory|allocation failed/i, category: 'MEMORY', fixStrategy: 'gc_force' },
    { pattern: /MODULE_NOT_FOUND|Cannot find module/i, category: 'MODULE', fixStrategy: 'reinstall_module' },
    { pattern: /SyntaxError|Unexpected token|Invalid or unexpected/i, category: 'SYNTAX', fixStrategy: 'none' },
    { pattern: /TypeError|ReferenceError|RangeError/i, category: 'RUNTIME', fixStrategy: 'isolate' },
    { pattern: /ENOSPC|disk.*full|no space/i, category: 'FILESYSTEM', fixStrategy: 'cleanup_disk' },
    { pattern: /rate.?limit|429|too many request/i, category: 'NETWORK', fixStrategy: 'backoff' },
    { pattern: /DisconnectReason|Connection.*closed|connection.*lost|isBoom/i, category: 'BAILEYS', fixStrategy: 'reconnect_wa' },
    { pattern: /Unexpected end of JSON|JSON.*parse|SyntaxError.*JSON/i, category: 'DATABASE', fixStrategy: 'repair_json' },
    { pattern: /EADDRINUSE|address already in use/i, category: 'CONNECTION', fixStrategy: 'kill_port' },
    { pattern: /ERR_SOCKET_CLOSED|socket hang up/i, category: 'CONNECTION', fixStrategy: 'reconnect' },
    { pattern: /write.*EPIPE|Broken pipe/i, category: 'CONNECTION', fixStrategy: 'reconnect' },
    { pattern: /certificate|SSL|TLS|UNABLE_TO_VERIFY/i, category: 'NETWORK', fixStrategy: 'skip_ssl' },
    { pattern: /payload.*too.*large|entity.*too.*large|413/i, category: 'NETWORK', fixStrategy: 'reduce_payload' },
    { pattern: /Conflict|409|already exists/i, category: 'BAILEYS', fixStrategy: 'session_reset' },
    { pattern: /not logged in|require.*login|auth.*fail/i, category: 'BAILEYS', fixStrategy: 'reauth' },
    { pattern: /quota|limit.*exceeded|banned/i, category: 'BAILEYS', fixStrategy: 'cooldown' },
];

function _categorizeError(error) {
    const msg = (error.message || error.toString() || '').toLowerCase();
    const stack = (error.stack || '').toLowerCase();
    const combined = msg + ' ' + stack;

    for (const sig of ERROR_SIGNATURES) {
        if (sig.pattern.test(combined)) {
            return {
                category: sig.category,
                ...ERROR_CATEGORIES[sig.category],
                fixStrategy: sig.fixStrategy,
                matched: sig.pattern.toString()
            };
        }
    }
    return { category: 'UNKNOWN', ...ERROR_CATEGORIES.UNKNOWN, fixStrategy: 'none', matched: null };
}

function _generateErrorFingerprint(error) {
    const msg = (error.message || '').replace(/[0-9]+/g, 'N').replace(/['"`].*?['"`]/g, '"S"').trim();
    const stackLine = (error.stack || '').split('\n')[1]?.trim() || '';
    const source = stackLine.replace(/:\d+:\d+\)?$/, '');
    return crypto.createHash('md5').update(`${error.constructor?.name || 'Error'}:${msg}:${source}`).digest('hex').slice(0, 12);
}

function _recordError(error, context = {}) {
    const now = Date.now();
    const categorized = _categorizeError(error);
    const fingerprint = _generateErrorFingerprint(error);
    _state.totalErrorsCaught++;

    const entry = {
        id: crypto.randomBytes(6).toString('hex'),
        ts: now,
        time: new Date(now).toLocaleString('id-ID'),
        fingerprint,
        name: error.constructor?.name || 'Error',
        message: (error.message || '').slice(0, 500),
        stack: (error.stack || '').split('\n').slice(0, 8).join('\n'),
        category: categorized.category,
        severity: categorized.severity,
        fixStrategy: categorized.fixStrategy,
        context: {
            command: context.command || null,
            chat: context.chat || null,
            sender: context.sender?.split('@')[0] || null,
            phase: context.phase || 'runtime'
        },
        fixed: false,
        fixResult: null
    };

    _state.errorBuffer.push(entry);
    if (_state.errorBuffer.length > 200) _state.errorBuffer = _state.errorBuffer.slice(-150);

    _state.errorRateWindow.push(now);
    _state.errorRateWindow = _state.errorRateWindow.filter(t => (now - t) < 60000);

    const pattern = _state.errorPatterns.get(fingerprint) || { count: 0, first: now, last: 0, category: categorized.category, message: entry.message, autoFixed: 0 };
    pattern.count++;
    pattern.last = now;
    _state.errorPatterns.set(fingerprint, pattern);

    if (context.command) {
        const cmdErr = _state.commandErrorMap.get(context.command) || { count: 0, last: 0 };
        cmdErr.count++;
        cmdErr.last = now;
        _state.commandErrorMap.set(context.command, cmdErr);
    }

    if (categorized.severity === 'critical') _state.fatalCount++;
    else if (categorized.severity === 'high') _state.warningCount++;

    const db = _read(ERROR_LOG_PATH, []);
    db.push(entry);
    if (db.length > 500) db.splice(0, db.length - 300);
    _write(ERROR_LOG_PATH, db);

    _updateHealthScore();

    if (categorized.autofix && categorized.fixStrategy !== 'none') {
        _state.repairQueue.push({ entry, strategy: categorized.fixStrategy, addedAt: now, attempts: 0 });
    }

    return entry;
}

function _updateHealthScore() {
    let score = 100;

    const mem = process.memoryUsage();
    const memPercent = (mem.heapUsed / mem.heapTotal) * 100;
    if (memPercent > _state.criticalThresholds.memoryPercent) score -= 20;
    else if (memPercent > 70) score -= 10;
    else if (memPercent > 50) score -= 3;

    const errorRate = _state.errorRateWindow.length;
    if (errorRate > _state.criticalThresholds.errorRatePerMinute) score -= 25;
    else if (errorRate > 5) score -= 10;
    else if (errorRate > 2) score -= 3;

    const recentCrashes = _state.crashTimestamps.filter(t => (Date.now() - t) < _state.criticalThresholds.crashLoopWindowMs).length;
    if (recentCrashes >= _state.criticalThresholds.crashLoopCount) score -= 30;
    else if (recentCrashes >= 3) score -= 15;
    else if (recentCrashes >= 1) score -= 5;

    if (_state.eventLoopLag > _state.criticalThresholds.eventLoopLagMs) score -= 15;
    else if (_state.eventLoopLag > 200) score -= 5;

    if (_state.connectionState !== 'open') score -= 15;

    if (_state.degradedFeatures.size > 0) score -= _state.degradedFeatures.size * 3;

    if (_state.reconnectAttempts > 5) score -= 10;

    const uptimeMinutes = (Date.now() - _state.bootTime) / 60000;
    if (uptimeMinutes < 2) score -= 5;

    _state.healthScore = Math.max(0, Math.min(100, Math.round(score)));
}

function _getHealthGrade() {
    const s = _state.healthScore;
    if (s >= 90) return { grade: 'A+', emoji: '💚', status: 'Excellent' };
    if (s >= 80) return { grade: 'A', emoji: '💚', status: 'Healthy' };
    if (s >= 70) return { grade: 'B', emoji: '💛', status: 'Good' };
    if (s >= 60) return { grade: 'C', emoji: '🟡', status: 'Fair' };
    if (s >= 45) return { grade: 'D', emoji: '🟠', status: 'Degraded' };
    if (s >= 30) return { grade: 'E', emoji: '🔴', status: 'Critical' };
    return { grade: 'F', emoji: '🚨', status: 'Emergency' };
}

function _collectSystemMetrics() {
    const mem = process.memoryUsage();
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const uptime = process.uptime();

    let cpuPercent = 0;
    if (_state.cpuUsagePrev) {
        const diff = process.cpuUsage(_state.cpuUsagePrev);
        const totalDiff = (diff.user + diff.system) / 1000;
        const elapsed = (Date.now() - _state.cpuUsagePrev.ts) || 1;
        cpuPercent = Math.min(100, Math.round((totalDiff / elapsed) * 100));
    }
    const cpuRaw = process.cpuUsage();
    _state.cpuUsagePrev = { ...cpuRaw, ts: Date.now() };

    if (mem.heapUsed > _state.peakMemory) _state.peakMemory = mem.heapUsed;

    return {
        memory: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers || 0,
            heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
            systemPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
            peak: _state.peakMemory
        },
        cpu: {
            percent: cpuPercent,
            cores: cpus.length,
            model: cpus[0]?.model || 'unknown',
            loadAvg: loadAvg.map(l => Math.round(l * 100) / 100)
        },
        system: {
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            totalMem,
            freeMem,
            hostname: os.hostname(),
            uptime: Math.round(uptime)
        },
        process: {
            pid: process.pid,
            uptime: Math.round(uptime),
            uptimeFormatted: _formatUptime(uptime),
            bootTime: _state.bootTime,
            title: process.title
        },
        bot: {
            healthScore: _state.healthScore,
            healthGrade: _getHealthGrade(),
            totalErrors: _state.totalErrorsCaught,
            totalFixes: _state.totalAutoFixes,
            totalHeals: _state.totalSelfHeals,
            connectionState: _state.connectionState,
            reconnectAttempts: _state.reconnectAttempts,
            errorRate: _state.errorRateWindow.length,
            eventLoopLag: Math.round(_state.eventLoopLag),
            degradedFeatures: [..._state.degradedFeatures],
            blockedModules: [..._state.blockedModules],
            repairQueueSize: _state.repairQueue.length
        }
    };
}

function _formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

function _formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

function _measureEventLoopLag() {
    const start = process.hrtime.bigint();
    setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1e6;
        _state.eventLoopSamples.push(lag);
        if (_state.eventLoopSamples.length > 30) _state.eventLoopSamples = _state.eventLoopSamples.slice(-20);
        _state.eventLoopLag = _state.eventLoopSamples.reduce((a, b) => a + b, 0) / _state.eventLoopSamples.length;
    });
}

function _checkMemoryLeaks() {
    const mem = process.memoryUsage();
    _state.memorySnapshots.push({ ts: Date.now(), heapUsed: mem.heapUsed, rss: mem.rss, external: mem.external });
    if (_state.memorySnapshots.length > 60) _state.memorySnapshots = _state.memorySnapshots.slice(-40);

    if (_state.memorySnapshots.length < 10) return null;

    if (!_state.baselineMemory) {
        _state.baselineMemory = _state.memorySnapshots[0].heapUsed;
    }

    const recent = _state.memorySnapshots.slice(-10);
    let increasing = 0;
    for (let i = 1; i < recent.length; i++) {
        if (recent[i].heapUsed > recent[i - 1].heapUsed) increasing++;
    }

    const growthRate = (recent[recent.length - 1].heapUsed - recent[0].heapUsed) / recent[0].heapUsed;
    const isLeaking = increasing >= 8 && growthRate > 0.15;

    if (isLeaking) {
        const leak = {
            ts: Date.now(),
            growthRate: Math.round(growthRate * 100),
            currentHeap: mem.heapUsed,
            baseline: _state.baselineMemory,
            consecutiveIncreases: increasing
        };
        _state.suspectedLeaks.push(leak);
        if (_state.suspectedLeaks.length > 20) _state.suspectedLeaks = _state.suspectedLeaks.slice(-10);
        return leak;
    }
    return null;
}

function _scanFileIntegrity() {
    const results = [];
    const criticalFiles = [
        { path: './bulter.js', label: 'Main Bot' },
        { path: './package.json', label: 'Package Config' },
        { path: './database', label: 'Database Dir', isDir: true }
    ];

    const dbDir = './database';
    if (fs.existsSync(dbDir)) {
        try {
            const walk = (dir) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(full);
                    } else if (entry.name.endsWith('.json')) {
                        criticalFiles.push({ path: full, label: `DB: ${entry.name}` });
                    }
                }
            };
            walk(dbDir);
        } catch {}
    }

    for (const file of criticalFiles) {
        const result = { path: file.path, label: file.label, status: 'ok', issue: null };
        try {
            if (file.isDir) {
                if (!fs.existsSync(file.path)) {
                    result.status = 'missing';
                    result.issue = 'directory not found';
                }
            } else {
                if (!fs.existsSync(file.path)) {
                    result.status = 'missing';
                    result.issue = 'file not found';
                } else {
                    const stat = fs.statSync(file.path);
                    result.size = stat.size;
                    result.modified = stat.mtime.toISOString();

                    if (file.path.endsWith('.json')) {
                        try {
                            const content = fs.readFileSync(file.path, 'utf8');
                            if (content.trim().length === 0) {
                                result.status = 'empty';
                                result.issue = 'file is empty';
                            } else {
                                JSON.parse(content);
                                result.status = 'ok';
                            }
                        } catch (parseErr) {
                            result.status = 'corrupted';
                            result.issue = `JSON parse error: ${parseErr.message.slice(0, 80)}`;
                        }
                    }

                    if (stat.size === 0 && !file.path.endsWith('.json')) {
                        result.status = 'empty';
                        result.issue = 'file is 0 bytes';
                    }

                    const prevHash = _state.fileIntegrityMap.get(file.path);
                    if (file.path.endsWith('.js') || file.path.endsWith('.json')) {
                        try {
                            const content = fs.readFileSync(file.path, 'utf8');
                            const hash = crypto.createHash('md5').update(content).digest('hex');
                            if (prevHash && prevHash !== hash) {
                                result.changed = true;
                            }
                            _state.fileIntegrityMap.set(file.path, hash);
                        } catch {}
                    }
                }
            }
        } catch (e) {
            result.status = 'error';
            result.issue = e.message.slice(0, 100);
        }
        results.push(result);
    }
    return results;
}

async function _executeRepair(entry, strategy) {
    const repairLog = {
        ts: Date.now(),
        time: new Date().toLocaleString('id-ID'),
        errorId: entry.id,
        fingerprint: entry.fingerprint,
        strategy,
        success: false,
        action: '',
        detail: ''
    };

    try {
        switch (strategy) {
            case 'repair_json': {
                const jsonFiles = fs.readdirSync('./database', { withFileTypes: true })
                    .filter(f => f.name.endsWith('.json'))
                    .map(f => path.join('./database', f.name));

                let repaired = 0;
                for (const fp of jsonFiles) {
                    try {
                        const content = fs.readFileSync(fp, 'utf8');
                        JSON.parse(content);
                    } catch {
                        try {
                            const bakPath = fp + '.bak';
                            if (fs.existsSync(bakPath)) {
                                const bakContent = fs.readFileSync(bakPath, 'utf8');
                                JSON.parse(bakContent);
                                fs.copyFileSync(bakPath, fp);
                                repaired++;
                            } else {
                                const isArray = fp.includes('history') || fp.includes('log');
                                fs.writeFileSync(fp, isArray ? '[]' : '{}');
                                repaired++;
                            }
                        } catch {
                            const isArray = fp.includes('history') || fp.includes('log');
                            fs.writeFileSync(fp, isArray ? '[]' : '{}');
                            repaired++;
                        }
                    }
                }
                repairLog.success = true;
                repairLog.action = 'repair_json';
                repairLog.detail = `${repaired} files repaired`;
                break;
            }

            case 'gc_force': {
                if (global.gc) {
                    const before = process.memoryUsage().heapUsed;
                    global.gc();
                    const after = process.memoryUsage().heapUsed;
                    repairLog.success = true;
                    repairLog.action = 'gc_force';
                    repairLog.detail = `freed ${_formatBytes(before - after)}`;
                } else {
                    repairLog.action = 'gc_force';
                    repairLog.detail = 'gc not exposed (run with --expose-gc)';
                    repairLog.success = false;
                }
                break;
            }

            case 'repair_fs': {
                const dirs = ['./database', './database/addcase', './database/autodoc', './database/addcase/backups'];
                let created = 0;
                for (const dir of dirs) {
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                        created++;
                    }
                }
                repairLog.success = true;
                repairLog.action = 'repair_fs';
                repairLog.detail = `${created} directories created`;
                break;
            }

            case 'cleanup_disk': {
                let cleaned = 0;
                let freedBytes = 0;
                const tmpPatterns = ['.tmp.', '.bak', '.old'];
                const walkClean = (dir) => {
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const ent of entries) {
                            const fp = path.join(dir, ent.name);
                            if (ent.isFile() && tmpPatterns.some(p => ent.name.includes(p))) {
                                try {
                                    const stat = fs.statSync(fp);
                                    if ((Date.now() - stat.mtimeMs) > 86400000) {
                                        freedBytes += stat.size;
                                        fs.unlinkSync(fp);
                                        cleaned++;
                                    }
                                } catch {}
                            }
                            if (ent.isDirectory()) walkClean(fp);
                        }
                    } catch {}
                };
                walkClean('./database');
                repairLog.success = true;
                repairLog.action = 'cleanup_disk';
                repairLog.detail = `${cleaned} files removed, ${_formatBytes(freedBytes)} freed`;
                break;
            }

            case 'reconnect': {
                repairLog.success = true;
                repairLog.action = 'reconnect';
                repairLog.detail = 'reconnect flagged';
                _state.reconnectAttempts++;
                break;
            }

            case 'reconnect_wa': {
                if (_state.socketRef) {
                    try {
                        _state.socketRef.end(new Error('AutoDoc reconnect'));
                    } catch {}
                }
                repairLog.success = true;
                repairLog.action = 'reconnect_wa';
                repairLog.detail = `attempt #${_state.reconnectAttempts + 1}`;
                _state.reconnectAttempts++;
                break;
            }

            case 'backoff': {
                const cooldown = Math.min(30000 * Math.pow(2, Math.min(_state.reconnectAttempts, 5)), 300000);
                repairLog.success = true;
                repairLog.action = 'backoff';
                repairLog.detail = `cooldown ${Math.round(cooldown / 1000)}s`;
                break;
            }

            case 'isolate': {
                if (entry.context?.command) {
                    const cmdErr = _state.commandErrorMap.get(entry.context.command);
                    if (cmdErr && cmdErr.count >= 5) {
                        _state.degradedFeatures.add(entry.context.command);
                        repairLog.detail = `command '${entry.context.command}' degraded`;
                    } else {
                        repairLog.detail = `error count ${cmdErr?.count || 0}/5, not isolating yet`;
                    }
                }
                repairLog.success = true;
                repairLog.action = 'isolate';
                break;
            }

            case 'session_reset': {
                const sessionDir = './session';
                if (fs.existsSync(sessionDir)) {
                    try {
                        const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'));
                        let cleaned = 0;
                        for (const f of files) {
                            const fp = path.join(sessionDir, f);
                            try {
                                const content = fs.readFileSync(fp, 'utf8');
                                JSON.parse(content);
                            } catch {
                                fs.unlinkSync(fp);
                                cleaned++;
                            }
                        }
                        repairLog.detail = `${cleaned} corrupt session files removed`;
                    } catch (e) {
                        repairLog.detail = `session cleanup error: ${e.message.slice(0, 50)}`;
                    }
                }
                repairLog.success = true;
                repairLog.action = 'session_reset';
                break;
            }

            case 'cooldown': {
                _state.degradedFeatures.add('rate_limited');
                repairLog.success = true;
                repairLog.action = 'cooldown';
                repairLog.detail = 'rate limit cooldown activated';
                break;
            }

            default:
                repairLog.action = strategy;
                repairLog.detail = 'no handler for strategy';
                repairLog.success = false;
        }
    } catch (e) {
        repairLog.success = false;
        repairLog.detail = `repair error: ${e.message.slice(0, 100)}`;
    }

    if (repairLog.success) {
        _state.totalAutoFixes++;
        entry.fixed = true;
        entry.fixResult = repairLog.action;
    }

    const repairDb = _read(REPAIR_LOG_PATH, []);
    repairDb.push(repairLog);
    if (repairDb.length > 300) repairDb.splice(0, repairDb.length - 200);
    _write(REPAIR_LOG_PATH, repairDb);

    _state.autoFixHistory.push(repairLog);
    if (_state.autoFixHistory.length > 100) _state.autoFixHistory = _state.autoFixHistory.slice(-60);

    return repairLog;
}

async function _processRepairQueue() {
    if (_state.healingInProgress) return;
    if (_state.repairQueue.length === 0) return;

    _state.healingInProgress = true;
    const batch = _state.repairQueue.splice(0, 5);

    for (const item of batch) {
        if (item.attempts >= 3) continue;
        item.attempts++;
        try {
            await _executeRepair(item.entry, item.strategy);
        } catch {}
    }

    const retryItems = batch.filter(i => !i.entry.fixed && i.attempts < 3);
    _state.repairQueue.unshift(...retryItems);

    _state.healingInProgress = false;
    _state.totalSelfHeals++;
}

function _runDiagnostics() {
    const results = [];
    const metrics = _collectSystemMetrics();

    results.push({
        name: 'Memory Usage',
        status: metrics.memory.heapPercent > _state.criticalThresholds.memoryPercent ? 'critical' : metrics.memory.heapPercent > 70 ? 'warning' : 'ok',
        value: `${metrics.memory.heapPercent}%`,
        detail: `${_formatBytes(metrics.memory.heapUsed)} / ${_formatBytes(metrics.memory.heapTotal)}`
    });

    results.push({
        name: 'System Memory',
        status: metrics.memory.systemPercent > _state.criticalThresholds.diskUsagePercent ? 'critical' : metrics.memory.systemPercent > 80 ? 'warning' : 'ok',
        value: `${metrics.memory.systemPercent}%`,
        detail: `${_formatBytes(metrics.system.freeMem)} free`
    });

    results.push({
        name: 'Error Rate',
        status: metrics.bot.errorRate > _state.criticalThresholds.errorRatePerMinute ? 'critical' : metrics.bot.errorRate > 3 ? 'warning' : 'ok',
        value: `${metrics.bot.errorRate}/min`,
        detail: `${_state.totalErrorsCaught} total errors`
    });

    results.push({
        name: 'Event Loop Lag',
        status: _state.eventLoopLag > _state.criticalThresholds.eventLoopLagMs ? 'critical' : _state.eventLoopLag > 100 ? 'warning' : 'ok',
        value: `${Math.round(_state.eventLoopLag)}ms`,
        detail: `${_state.eventLoopSamples.length} samples`
    });

    results.push({
        name: 'Connection',
        status: _state.connectionState === 'open' ? 'ok' : _state.connectionState === 'connecting' ? 'warning' : 'critical',
        value: _state.connectionState,
        detail: `${_state.reconnectAttempts} reconnects`
    });

    const crashCount = _state.crashTimestamps.filter(t => (Date.now() - t) < _state.criticalThresholds.crashLoopWindowMs).length;
    results.push({
        name: 'Crash Loop',
        status: crashCount >= _state.criticalThresholds.crashLoopCount ? 'critical' : crashCount >= 2 ? 'warning' : 'ok',
        value: `${crashCount} crashes`,
        detail: `in last ${Math.round(_state.criticalThresholds.crashLoopWindowMs / 60000)}min`
    });

    const leakCheck = _state.suspectedLeaks.length > 0 ? _state.suspectedLeaks[_state.suspectedLeaks.length - 1] : null;
    results.push({
        name: 'Memory Leak',
        status: leakCheck ? 'warning' : 'ok',
        value: leakCheck ? `+${leakCheck.growthRate}%` : 'none',
        detail: leakCheck ? `baseline: ${_formatBytes(leakCheck.baseline)}` : 'stable'
    });

    results.push({
        name: 'Repair Queue',
        status: _state.repairQueue.length > 10 ? 'warning' : 'ok',
        value: `${_state.repairQueue.length} pending`,
        detail: `${_state.totalAutoFixes} fixed total`
    });

    const fileResults = _scanFileIntegrity();
    const corruptFiles = fileResults.filter(f => f.status === 'corrupted' || f.status === 'missing');
    results.push({
        name: 'File Integrity',
        status: corruptFiles.length >= _state.criticalThresholds.fileCorruptionMax ? 'critical' : corruptFiles.length > 0 ? 'warning' : 'ok',
        value: `${corruptFiles.length} issues`,
        detail: corruptFiles.length > 0 ? corruptFiles.map(f => f.label).join(', ') : 'all ok'
    });

    results.push({
        name: 'Uptime',
        status: metrics.process.uptime < 60 ? 'warning' : 'ok',
        value: metrics.process.uptimeFormatted,
        detail: `PID: ${metrics.process.pid}`
    });

    _state.diagnosticResults = results;
    return { results, metrics, fileResults };
}

async function _alertOwner(sock, ownerJid, alertType, detail) {
    const now = Date.now();
    if ((now - _state.lastAlertTime) < 60000) return;
    if (_state.alertsSent > 50) return;

    try {
        const health = _getHealthGrade();
        const alertText =
            `🏥 *AUTO-DOCTOR ALERT*\n\n` +
            `${health.emoji} Health: *${health.grade}* (${_state.healthScore}/100)\n` +
            `⚠️ Type: *${alertType}*\n\n` +
            `${detail}\n\n` +
            `_${new Date().toLocaleString('id-ID')}_`;

        await sock.sendMessage(ownerJid, { text: alertText });
        _state.lastAlertTime = now;
        _state.alertsSent++;
        _state.ownerNotified = true;
    } catch {}
}

function _startWatchdog(sock, ownerJid) {
    if (_state.watchdogTimer) clearInterval(_state.watchdogTimer);
    if (_state.healthTimer) clearInterval(_state.healthTimer);
    if (_state.memoryTimer) clearInterval(_state.memoryTimer);
    if (_state.gcTimer) clearInterval(_state.gcTimer);

    _state.healthTimer = setInterval(() => {
        _measureEventLoopLag();
        _updateHealthScore();
        _state.lastHealthCheck = Date.now();

        const health = _getHealthGrade();
        const healthLog = _read(HEALTH_LOG_PATH, []);
        healthLog.push({
            ts: Date.now(),
            score: _state.healthScore,
            grade: health.grade,
            errorRate: _state.errorRateWindow.length,
            memHeap: process.memoryUsage().heapUsed,
            eventLoopLag: Math.round(_state.eventLoopLag),
            connection: _state.connectionState,
            repairQueue: _state.repairQueue.length
        });
        if (healthLog.length > 500) healthLog.splice(0, healthLog.length - 300);
        _write(HEALTH_LOG_PATH, healthLog);
    }, 30000);

    _state.memoryTimer = setInterval(() => {
        const leak = _checkMemoryLeaks();
        if (leak && leak.growthRate > 30) {
            _recordError(new Error(`Memory leak detected: +${leak.growthRate}% growth`), { phase: 'watchdog' });
            if (sock && ownerJid) {
                _alertOwner(sock, ownerJid, 'MEMORY_LEAK',
                    `🧠 Heap: ${_formatBytes(leak.currentHeap)}\n📈 Growth: +${leak.growthRate}%\n📊 Baseline: ${_formatBytes(leak.baseline)}`
                );
            }
        }
    }, 60000);

    _state.watchdogTimer = setInterval(async () => {
        await _processRepairQueue();

        if (_state.healthScore < _state.criticalThresholds.healthScoreMin) {
            if (sock && ownerJid) {
                const metrics = _collectSystemMetrics();
                _alertOwner(sock, ownerJid, 'HEALTH_CRITICAL',
                    `🚨 Score: *${_state.healthScore}/100*\n` +
                    `🧠 Memory: ${metrics.memory.heapPercent}%\n` +
                    `💥 Errors: ${metrics.bot.errorRate}/min\n` +
                    `🔌 Connection: ${_state.connectionState}\n` +
                    `⏱️ Loop Lag: ${Math.round(_state.eventLoopLag)}ms`
                );
            }
        }

        const recentCrashes = _state.crashTimestamps.filter(t => (Date.now() - t) < _state.criticalThresholds.crashLoopWindowMs).length;
        if (recentCrashes >= _state.criticalThresholds.crashLoopCount) {
            if (sock && ownerJid) {
                _alertOwner(sock, ownerJid, 'CRASH_LOOP',
                    `🔄 ${recentCrashes} crashes in ${Math.round(_state.criticalThresholds.crashLoopWindowMs / 60000)}min\n` +
                    `_Bot might be in a crash loop_`
                );
            }
        }
    }, 45000);

    _state.gcTimer = setInterval(() => {
        const mem = process.memoryUsage();
        if ((mem.heapUsed / mem.heapTotal) > 0.85) {
            if (global.gc) {
                global.gc();
                _recordError(new Error('Auto GC triggered: heap > 85%'), { phase: 'gc_auto' });
            }
        }

        _state.errorRateWindow = _state.errorRateWindow.filter(t => (Date.now() - t) < 60000);
        _state.crashTimestamps = _state.crashTimestamps.filter(t => (Date.now() - t) < 600000);

        const now = Date.now();
        for (const [fp, pattern] of _state.errorPatterns) {
            if ((now - pattern.last) > 3600000) _state.errorPatterns.delete(fp);
        }
        for (const [cmd, data] of _state.commandErrorMap) {
            if ((now - data.last) > 1800000) _state.commandErrorMap.delete(cmd);
        }

        const degradedToRemove = [];
        for (const feature of _state.degradedFeatures) {
            const cmdErr = _state.commandErrorMap.get(feature);
            if (!cmdErr || (now - cmdErr.last) > 600000) {
                degradedToRemove.push(feature);
            }
        }
        degradedToRemove.forEach(f => _state.degradedFeatures.delete(f));
    }, 120000);

    _state.initialized = true;
    _state.socketRef = sock;
}

function _installGlobalHandlers(sock, ownerJid) {
    process.on('uncaughtException', (err) => {
        _state.crashTimestamps.push(Date.now());
        _recordError(err, { phase: 'uncaughtException' });
        if (sock && ownerJid) {
            _alertOwner(sock, ownerJid, 'UNCAUGHT_EXCEPTION',
                `💥 ${err.constructor?.name}: ${err.message.slice(0, 200)}\n\n\`\`\`\n${(err.stack || '').split('\n').slice(0, 4).join('\n')}\n\`\`\``
            );
        }
    });

    process.on('unhandledRejection', (reason) => {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        _state.crashTimestamps.push(Date.now());
        _recordError(err, { phase: 'unhandledRejection' });
    });

    process.on('warning', (warning) => {
        if (warning.name === 'MaxListenersExceededWarning' || warning.name === 'DeprecationWarning') {
            _recordError(warning, { phase: 'processWarning' });
        }
    });
}

function initAutoDoctor(sock, ownerJid) {
    if (_state.initialized) return _state;
    _ensureDir();
    _installGlobalHandlers(sock, ownerJid);
    _startWatchdog(sock, ownerJid);
    _measureEventLoopLag();
    _scanFileIntegrity();
    _state.baselineMemory = process.memoryUsage().heapUsed;
    _write(SNAPSHOT_PATH, {
        bootTime: _state.bootTime,
        pid: process.pid,
        nodeVersion: process.version,
        platform: os.platform(),
        baselineMemory: _state.baselineMemory
    });
    return _state;
}

function recordCommandError(error, context = {}) {
    return _recordError(error, context);
}

function updateConnectionState(state) {
    _state.connectionState = state;
    if (state === 'open') _state.reconnectAttempts = 0;
    _updateHealthScore();
}

function isFeatureDegraded(featureName) {
    return _state.degradedFeatures.has(featureName);
}

function getHealthScore() {
    _updateHealthScore();
    return _state.healthScore;
}

async function handleAutoDoctor(ctx) {
    const { m, bulter: sock, command, args, reply, isOwner, isCreator, prefix, fakeQuoted } = ctx;

    if (!isOwner && !isCreator) {
        return reply('🚫 *Akses ditolak!*\n\nSistem Auto-Doctor hanya untuk owner.');
    }

    if (command === 'doctor') {
        sock.sendMessage(m.chat, { react: { text: '🏥', key: m.key } });

        const { results, metrics, fileResults } = _runDiagnostics();
        const health = _getHealthGrade();
        const statusIcon = (s) => s === 'ok' ? '✅' : s === 'warning' ? '⚠️' : '🚨';

        let output = `🏥 *AUTO-DOCTOR — FULL DIAGNOSTICS*\n\n`;
        output += `${health.emoji} *Health Score: ${_state.healthScore}/100 (${health.grade})*\n`;
        output += `📊 Status: *${health.status}*\n`;
        output += `⏱️ Uptime: ${metrics.process.uptimeFormatted}\n\n`;

        output += `━━━ *DIAGNOSTICS* ━━━\n`;
        for (const r of results) {
            output += `${statusIcon(r.status)} *${r.name}:* ${r.value}\n`;
            output += `   _${r.detail}_\n`;
        }

        output += `\n━━━ *SYSTEM* ━━━\n`;
        output += `🖥️ ${metrics.system.platform} ${metrics.system.arch}\n`;
        output += `📦 Node ${metrics.system.nodeVersion}\n`;
        output += `🧠 RAM: ${_formatBytes(metrics.system.freeMem)} free / ${_formatBytes(metrics.system.totalMem)}\n`;
        output += `⚡ CPU: ${metrics.cpu.percent}% (${metrics.cpu.cores} cores)\n`;
        output += `📈 Load: ${metrics.cpu.loadAvg.join(', ')}\n`;

        output += `\n━━━ *ERROR STATS* ━━━\n`;
        output += `💥 Total Errors: ${_state.totalErrorsCaught}\n`;
        output += `🔧 Auto-Fixed: ${_state.totalAutoFixes}\n`;
        output += `🩹 Self-Heals: ${_state.totalSelfHeals}\n`;
        output += `🚨 Fatal: ${_state.fatalCount} | ⚠️ Warning: ${_state.warningCount}\n`;
        output += `🔄 Repair Queue: ${_state.repairQueue.length}\n`;

        if (_state.errorPatterns.size > 0) {
            output += `\n━━━ *TOP ERRORS* ━━━\n`;
            const sorted = [..._state.errorPatterns.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
            for (const [fp, data] of sorted) {
                const cat = ERROR_CATEGORIES[data.category] || ERROR_CATEGORIES.UNKNOWN;
                output += `${cat.icon} \`${fp}\` × ${data.count}\n`;
                output += `   _${data.message.slice(0, 60)}_\n`;
            }
        }

        if (_state.degradedFeatures.size > 0) {
            output += `\n━━━ *DEGRADED* ━━━\n`;
            output += [..._state.degradedFeatures].map(f => `🔇 \`${f}\``).join('\n') + '\n';
        }

        const corruptFiles = fileResults.filter(f => f.status !== 'ok');
        if (corruptFiles.length > 0) {
            output += `\n━━━ *FILE ISSUES* ━━━\n`;
            for (const f of corruptFiles.slice(0, 8)) {
                output += `📁 \`${f.label}\` — ${f.status}: _${f.issue}_\n`;
            }
        }

        output += `\n━━━ *ACTIONS* ━━━\n`;
        output += `\`${prefix}autofix\` — jalankan auto-repair\n`;
        output += `\`${prefix}healthcheck\` — quick check\n`;
        output += `\`${prefix}errorlog\` — error history\n`;
        output += `\`${prefix}sysinfo\` — system info detail\n`;

        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        return sock.sendMessage(m.chat, { text: output }, { quoted: fakeQuoted });
    }

    if (command === 'healthcheck') {
        _updateHealthScore();
        _measureEventLoopLag();
        const health = _getHealthGrade();
        const mem = process.memoryUsage();
        const memPercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);
        const uptime = _formatUptime(process.uptime());

        let output = `${health.emoji} *HEALTH CHECK*\n\n`;
        output += `📊 Score: *${_state.healthScore}/100* (${health.grade})\n`;
        output += `📌 Status: *${health.status}*\n\n`;
        output += `🧠 Memory: ${memPercent}% (${_formatBytes(mem.heapUsed)})\n`;
        output += `🔌 Connection: ${_state.connectionState}\n`;
        output += `⏱️ Loop Lag: ${Math.round(_state.eventLoopLag)}ms\n`;
        output += `💥 Error Rate: ${_state.errorRateWindow.length}/min\n`;
        output += `🔧 Auto-Fixed: ${_state.totalAutoFixes}\n`;
        output += `🔄 Repair Queue: ${_state.repairQueue.length}\n`;
        output += `⏰ Uptime: ${uptime}\n`;

        if (_state.degradedFeatures.size > 0) {
            output += `\n🔇 Degraded: ${[..._state.degradedFeatures].join(', ')}`;
        }

        if (_state.suspectedLeaks.length > 0) {
            const last = _state.suspectedLeaks[_state.suspectedLeaks.length - 1];
            output += `\n⚠️ Memory leak: +${last.growthRate}%`;
        }

        return reply(output);
    }

    if (command === 'errorlog') {
        const limit = parseInt(args[0]) || 10;
        const filterCat = args[1]?.toUpperCase();
        let errors = _read(ERROR_LOG_PATH, []);

        if (filterCat && ERROR_CATEGORIES[filterCat]) {
            errors = errors.filter(e => e.category === filterCat);
        }

        errors = errors.slice(-limit).reverse();

        if (errors.length === 0) return reply(`📋 Tidak ada error${filterCat ? ` kategori ${filterCat}` : ''}.`);

        let output = `💥 *ERROR LOG (${errors.length})*${filterCat ? ` — ${filterCat}` : ''}\n\n`;

        for (const err of errors) {
            const cat = ERROR_CATEGORIES[err.category] || ERROR_CATEGORIES.UNKNOWN;
            output += `${cat.icon} *${err.name}* [${err.category}]\n`;
            output += `⏰ ${err.time}\n`;
            output += `📝 ${err.message.slice(0, 100)}\n`;
            if (err.context?.command) output += `📌 Command: \`${err.context.command}\`\n`;
            output += `🔧 Fix: ${err.fixed ? `✅ ${err.fixResult}` : '❌ unfixed'}\n`;
            output += `🔑 \`${err.fingerprint}\`\n\n`;
        }

        output += `_Filter: \`${prefix}errorlog <limit> <category>\`_\n`;
        output += `_Categories: ${Object.keys(ERROR_CATEGORIES).join(', ')}_`;

        if (output.length > 4000) output = output.slice(0, 3950) + '\n... (terpotong)';
        return reply(output);
    }

    if (command === 'autofix') {
        sock.sendMessage(m.chat, { react: { text: '🔧', key: m.key } });

        const subCmd = (args[0] || '').toLowerCase();

        if (subCmd === 'json') {
            const entry = { id: 'manual', fingerprint: 'manual', context: { phase: 'manual' } };
            const result = await _executeRepair(entry, 'repair_json');
            sock.sendMessage(m.chat, { react: { text: result.success ? '✅' : '❌', key: m.key } });
            return reply(`🔧 *JSON Repair*\n\n${result.success ? '✅' : '❌'} ${result.detail}`);
        }

        if (subCmd === 'memory' || subCmd === 'gc') {
            const entry = { id: 'manual', fingerprint: 'manual', context: { phase: 'manual' } };
            const result = await _executeRepair(entry, 'gc_force');
            sock.sendMessage(m.chat, { react: { text: result.success ? '✅' : '❌', key: m.key } });
            return reply(`🧠 *Memory Cleanup*\n\n${result.success ? '✅' : '❌'} ${result.detail}`);
        }

        if (subCmd === 'disk') {
            const entry = { id: 'manual', fingerprint: 'manual', context: { phase: 'manual' } };
            const result = await _executeRepair(entry, 'cleanup_disk');
            sock.sendMessage(m.chat, { react: { text: result.success ? '✅' : '❌', key: m.key } });
            return reply(`💾 *Disk Cleanup*\n\n${result.success ? '✅' : '❌'} ${result.detail}`);
        }

        if (subCmd === 'fs') {
            const entry = { id: 'manual', fingerprint: 'manual', context: { phase: 'manual' } };
            const result = await _executeRepair(entry, 'repair_fs');
            sock.sendMessage(m.chat, { react: { text: result.success ? '✅' : '❌', key: m.key } });
            return reply(`📁 *Filesystem Repair*\n\n${result.success ? '✅' : '❌'} ${result.detail}`);
        }

        if (subCmd === 'session') {
            const entry = { id: 'manual', fingerprint: 'manual', context: { phase: 'manual' } };
            const result = await _executeRepair(entry, 'session_reset');
            sock.sendMessage(m.chat, { react: { text: result.success ? '✅' : '❌', key: m.key } });
            return reply(`📱 *Session Reset*\n\n${result.success ? '✅' : '❌'} ${result.detail}`);
        }

        if (subCmd === 'reset') {
            _state.degradedFeatures.clear();
            _state.blockedModules.clear();
            _state.errorBuffer = [];
            _state.errorPatterns.clear();
            _state.commandErrorMap.clear();
            _state.errorRateWindow = [];
            _state.repairQueue = [];
            _state.suspectedLeaks = [];
            _state.reconnectAttempts = 0;
            _state.fatalCount = 0;
            _state.warningCount = 0;
            _state.alertsSent = 0;
            _updateHealthScore();
            sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
            return reply(`🔄 *Auto-Doctor State Reset*\n\n✅ Semua counter, degraded features, dan error buffer telah direset.\n📊 Health Score: ${_state.healthScore}/100`);
        }

        if (subCmd === 'all') {
            await reply(`🔧 *Menjalankan Full Auto-Repair...*\n\n_Memeriksa semua subsistem..._`);

            const strategies = ['repair_fs', 'repair_json', 'cleanup_disk', 'gc_force', 'session_reset'];
            const results = [];
            const dummyEntry = { id: 'full_repair', fingerprint: 'manual_full', context: { phase: 'manual_full' } };

            for (const strategy of strategies) {
                const result = await _executeRepair({ ...dummyEntry }, strategy);
                results.push({ strategy, ...result });
            }

            if (_state.repairQueue.length > 0) {
                await _processRepairQueue();
            }

            _updateHealthScore();
            const health = _getHealthGrade();

            let output = `🔧 *FULL AUTO-REPAIR COMPLETE*\n\n`;
            output += `${health.emoji} Health: *${_state.healthScore}/100* (${health.grade})\n\n`;

            for (const r of results) {
                output += `${r.success ? '✅' : '❌'} *${r.strategy}*: ${r.detail}\n`;
            }

            output += `\n📊 Repair Queue: ${_state.repairQueue.length} remaining`;

            sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
            return reply(output);
        }

        let output = `🔧 *AUTO-FIX MENU*\n\n`;
        output += `\`${prefix}autofix all\` — full repair semua subsistem\n`;
        output += `\`${prefix}autofix json\` — perbaiki file JSON corrupt\n`;
        output += `\`${prefix}autofix memory\` — force garbage collection\n`;
        output += `\`${prefix}autofix disk\` — bersihkan file temp\n`;
        output += `\`${prefix}autofix fs\` — perbaiki directory structure\n`;
        output += `\`${prefix}autofix session\` — bersihkan session corrupt\n`;
        output += `\`${prefix}autofix reset\` — reset state auto-doctor\n\n`;
        output += `📊 Health: ${_state.healthScore}/100\n`;
        output += `🔄 Repair Queue: ${_state.repairQueue.length}\n`;
        output += `🔧 Total Fixed: ${_state.totalAutoFixes}`;
        return reply(output);
    }

    if (command === 'sysinfo') {
        sock.sendMessage(m.chat, { react: { text: '🖥️', key: m.key } });
        const metrics = _collectSystemMetrics();
        const health = _getHealthGrade();

        let output = `🖥️ *SYSTEM INFORMATION*\n\n`;

        output += `━━━ *BOT* ━━━\n`;
        output += `${health.emoji} Health: *${metrics.bot.healthScore}/100* (${metrics.bot.healthGrade.grade})\n`;
        output += `⏰ Uptime: ${metrics.process.uptimeFormatted}\n`;
        output += `🆔 PID: ${metrics.process.pid}\n`;
        output += `🔌 Connection: ${metrics.bot.connectionState}\n`;
        output += `💥 Errors: ${metrics.bot.totalErrors} (${metrics.bot.errorRate}/min)\n`;
        output += `🔧 Fixed: ${metrics.bot.totalFixes}\n`;
        output += `🩹 Heals: ${metrics.bot.totalHeals}\n`;
        output += `🔄 Reconnects: ${metrics.bot.reconnectAttempts}\n`;
        output += `⏱️ Loop Lag: ${metrics.bot.eventLoopLag}ms\n`;

        output += `\n━━━ *MEMORY* ━━━\n`;
        output += `🧠 Heap: ${_formatBytes(metrics.memory.heapUsed)} / ${_formatBytes(metrics.memory.heapTotal)} (${metrics.memory.heapPercent}%)\n`;
        output += `📊 RSS: ${_formatBytes(metrics.memory.rss)}\n`;
        output += `📦 External: ${_formatBytes(metrics.memory.external)}\n`;
        output += `🔷 ArrayBuffers: ${_formatBytes(metrics.memory.arrayBuffers)}\n`;
        output += `📈 Peak Heap: ${_formatBytes(metrics.memory.peak)}\n`;
        output += `💻 System: ${_formatBytes(metrics.system.totalMem - metrics.system.freeMem)} / ${_formatBytes(metrics.system.totalMem)} (${metrics.memory.systemPercent}%)\n`;

        output += `\n━━━ *CPU* ━━━\n`;
        output += `⚡ Usage: ${metrics.cpu.percent}%\n`;
        output += `🔢 Cores: ${metrics.cpu.cores}\n`;
        output += `📈 Load Avg: ${metrics.cpu.loadAvg.join(' / ')}\n`;
        output += `🏷️ ${metrics.cpu.model.slice(0, 50)}\n`;

        output += `\n━━━ *SYSTEM* ━━━\n`;
        output += `🖥️ ${metrics.system.platform} (${metrics.system.arch})\n`;
        output += `📦 Node ${metrics.system.nodeVersion}\n`;
        output += `🏠 ${metrics.system.hostname}\n`;

        if (metrics.bot.degradedFeatures.length > 0) {
            output += `\n━━━ *DEGRADED* ━━━\n`;
            output += metrics.bot.degradedFeatures.map(f => `🔇 \`${f}\``).join('\n') + '\n';
        }

        const errorPatterns = [..._state.errorPatterns.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 3);
        if (errorPatterns.length > 0) {
            output += `\n━━━ *TOP ERRORS* ━━━\n`;
            for (const [fp, data] of errorPatterns) {
                output += `\`${fp}\` × ${data.count} (${data.category})\n`;
            }
        }

        const commandErrors = [..._state.commandErrorMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
        if (commandErrors.length > 0) {
            output += `\n━━━ *COMMAND ERRORS* ━━━\n`;
            for (const [cmd, data] of commandErrors) {
                const isDegraded = _state.degradedFeatures.has(cmd);
                output += `${isDegraded ? '🔇' : '💥'} \`${cmd}\` × ${data.count}${isDegraded ? ' (degraded)' : ''}\n`;
            }
        }

        const memSnapshots = _state.memorySnapshots.slice(-10);
        if (memSnapshots.length >= 5) {
            output += `\n━━━ *MEMORY TREND* ━━━\n`;
            const first = memSnapshots[0];
            const last = memSnapshots[memSnapshots.length - 1];
            const trend = last.heapUsed - first.heapUsed;
            output += `${trend > 0 ? '📈' : '📉'} ${trend > 0 ? '+' : ''}${_formatBytes(Math.abs(trend))} over ${Math.round((last.ts - first.ts) / 60000)}min\n`;
        }

        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        if (output.length > 4000) output = output.slice(0, 3950) + '\n... (terpotong)';
        return sock.sendMessage(m.chat, { text: output }, { quoted: fakeQuoted });
    }

    if (command === 'repairlog') {
        const limit = parseInt(args[0]) || 15;
        const repairs = _read(REPAIR_LOG_PATH, []).slice(-limit).reverse();

        if (repairs.length === 0) return reply('📋 Belum ada repair history.');

        let output = `🔧 *REPAIR LOG (${repairs.length})*\n\n`;
        for (const r of repairs) {
            output += `${r.success ? '✅' : '❌'} *${r.action}* — ${r.time}\n`;
            output += `   _${r.detail}_\n`;
            if (r.fingerprint && r.fingerprint !== 'manual' && r.fingerprint !== 'manual_full') {
                output += `   🔑 \`${r.fingerprint}\`\n`;
            }
            output += `\n`;
        }

        if (output.length > 4000) output = output.slice(0, 3950) + '\n... (terpotong)';
        return reply(output);
    }

    if (command === 'healthlog') {
        const limit = parseInt(args[0]) || 20;
        const logs = _read(HEALTH_LOG_PATH, []).slice(-limit);

        if (logs.length === 0) return reply('📋 Belum ada health log.');

        let output = `📊 *HEALTH LOG (${logs.length})*\n\n`;
        output += `\`Score | Mem  | ErrRate | Lag   | Conn\`\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        for (const log of logs.reverse()) {
            const memMB = Math.round(log.memHeap / 1048576);
            output += `\`${String(log.score).padStart(3)}${log.grade}  | ${String(memMB).padStart(3)}MB | ${String(log.errorRate).padStart(2)}/min  | ${String(log.eventLoopLag).padStart(3)}ms | ${log.connection.slice(0, 5)}\`\n`;
        }

        const scores = logs.map(l => l.score);
        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        const min = Math.min(...scores);
        const max = Math.max(...scores);
        output += `\n📊 Avg: ${avg} | Min: ${min} | Max: ${max}`;

        if (output.length > 4000) output = output.slice(0, 3950) + '\n... (terpotong)';
        return reply(output);
    }
}

module.exports = {
    initAutoDoctor,
    handleAutoDoctor,
    recordCommandError,
    updateConnectionState,
    isFeatureDegraded,
    getHealthScore
};
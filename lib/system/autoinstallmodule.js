// lib/autoinstallmodule.js

const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');

const _aimLogFile = path.join(__dirname, '..', 'autoinstall.log');
const _aimCacheFile = path.join(__dirname, '..', 'autoinstall-cache.json');
const _aimLockFile = path.join(__dirname, '..', '.autoinstall.lock');
const _aimMaxRetry = 3;
const _aimRetryDelay = 5000;
const _aimTimeout = 120000;
const _aimMaxConcurrent = 3;
const _aimQueue = [];
const _aimProcessing = new Set();
const _aimResults = new Map();
const _aimFailedCache = new Map();
const _aimSuccessCache = new Map();
const _aimStartTime = Date.now();

const _aimBuiltins = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline',
  'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  'fs/promises', 'stream/promises', 'timers/promises', 'readline/promises',
  'dns/promises', 'crypto/promises'
]);

const _aimProtected = new Set([
  '@yemo-dev/yebail', '@whiskeysockets/baileys', '@adiwajshing/baileys', 'baileys',
  'express', 'socket.io', 'mongoose', 'mysql', 'mysql2', 'pg',
  'sequelize', 'prisma', '@prisma/client', 'dotenv'
]);

const _aimAliasMap = {
  'wa-sticker-formatter': 'wa-sticker-formatter',
  'node-fetch': 'node-fetch@2',
  'form-data': 'form-data',
  'file-type': 'file-type@16',
  'image-size': 'image-size',
  'fluent-ffmpeg': 'fluent-ffmpeg',
  'google-it': 'google-it',
  'cheerio': 'cheerio',
  'puppeteer': 'puppeteer',
  'sharp': 'sharp',
  'jimp': 'jimp',
  'canvas': 'canvas',
  'gm': 'gm',
  'gtts': 'gtts',
  'yt-search': 'yt-search',
  'ytdl-core': 'ytdl-core',
  '@distube/ytdl-core': '@distube/ytdl-core',
  'spotify-dl': 'spotify-dl',
  'genius-lyrics': 'genius-lyrics',
  'mal-scraper': 'mal-scraper'
};

const _aimCriticalModules = [
  '@yemo-dev/yebail', 'pino', 'qrcode-terminal', 'fs-extra',
  'chalk', 'moment-timezone', 'axios', 'node-fetch', 'form-data',
  'file-type', 'jimp', 'sharp', 'fluent-ffmpeg', 'wa-sticker-formatter'
];

function _aimLog(level, msg) {
  const _ts = new Date().toISOString();
  const _line = `[${_ts}] [${level.toUpperCase()}] ${msg}\n`;
  try { fs.appendFileSync(_aimLogFile, _line); } catch {}
  if (level === 'error') _L.error('AutoInstall', msg);
  else _L.log('AutoInstall', msg);
}

function _aimReadCache() {
  try {
    if (fs.existsSync(_aimCacheFile)) return JSON.parse(fs.readFileSync(_aimCacheFile, 'utf8'));
  } catch {}
  return { installed: {}, failed: {}, skipped: [], lastScan: 0, totalInstalled: 0, totalFailed: 0, history: [] };
}

function _aimWriteCache(data) {
  try { fs.writeFileSync(_aimCacheFile, JSON.stringify(data, null, 2)); } catch {}
}

function _aimReadPkg() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')); } catch { return {}; }
}

function _aimIsInstalled(name) {
  try {
    const _resolved = require.resolve(name);
    return !!_resolved;
  } catch {
    try {
      const _nmPath = path.join(__dirname, '..', 'node_modules', name);
      return fs.existsSync(_nmPath) && fs.existsSync(path.join(_nmPath, 'package.json'));
    } catch { return false; }
  }
}

function _aimGetInstalledVersion(name) {
  try {
    const _pkgPath = path.join(__dirname, '..', 'node_modules', name, 'package.json');
    if (fs.existsSync(_pkgPath)) return JSON.parse(fs.readFileSync(_pkgPath, 'utf8')).version || '?';
  } catch {}
  return null;
}

function _aimGetLatestVersion(name) {
  try {
    const _out = execSync(`npm show ${name} version 2>/dev/null`, { timeout: 15000, encoding: 'utf8' });
    return _out.trim();
  } catch { return null; }
}

function _aimSanitize(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[^a-zA-Z0-9@/._~^<>=\-]/g, '').slice(0, 120).trim();
}

function _aimValidatePackageName(name) {
  if (!name) return false;
  if (name.length > 214) return false;
  if (/[~'!()*]/.test(name.split('@')[0])) return false;
  if (name.startsWith('.') || name.startsWith('_')) return false;
  if (/\s/.test(name)) return false;
  return true;
}

function _aimAcquireLock() {
  try {
    if (fs.existsSync(_aimLockFile)) {
      const _lockAge = Date.now() - fs.statSync(_aimLockFile).mtimeMs;
      if (_lockAge < _aimTimeout) return false;
      fs.unlinkSync(_aimLockFile);
    }
    fs.writeFileSync(_aimLockFile, JSON.stringify({ pid: process.pid, time: Date.now() }));
    return true;
  } catch { return false; }
}

function _aimReleaseLock() {
  try { if (fs.existsSync(_aimLockFile)) fs.unlinkSync(_aimLockFile); } catch {}
}

function _aimExecAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    const _proc = exec(cmd, {
      maxBuffer: 1024 * 1024 * 50,
      timeout: opts.timeout || _aimTimeout,
      cwd: opts.cwd || path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', npm_config_loglevel: 'error' }
    });
    let _stdout = '', _stderr = '';
    _proc.stdout?.on('data', d => { _stdout += d; });
    _proc.stderr?.on('data', d => { _stderr += d; });
    _proc.on('error', e => reject(e));
    _proc.on('close', code => {
      if (code !== 0 && !_stdout) reject(new Error(_stderr.slice(0, 500) || `Process exited with code ${code}`));
      else resolve({ stdout: _stdout, stderr: _stderr, code });
    });
  });
}

async function _aimInstallSingle(name, retryCount = 0) {
  const _sanitized = _aimSanitize(name);
  if (!_sanitized) return { success: false, name, error: 'Invalid package name' };
  if (_aimBuiltins.has(_sanitized.split('@')[0])) return { success: true, name: _sanitized, builtin: true, version: 'builtin' };
  if (_aimIsInstalled(_sanitized.split('@')[0])) {
    const _ver = _aimGetInstalledVersion(_sanitized.split('@')[0]);
    return { success: true, name: _sanitized, alreadyInstalled: true, version: _ver };
  }

  const _actualName = _aimAliasMap[_sanitized] || _sanitized;
  const _cache = _aimReadCache();

  if (_cache.failed[_sanitized] && _cache.failed[_sanitized].count >= _aimMaxRetry) {
    const _lastFail = _cache.failed[_sanitized].lastAttempt || 0;
    if (Date.now() - _lastFail < 3600000) {
      return { success: false, name: _sanitized, error: 'Max retry exceeded (cached), will retry after 1 hour', cached: true };
    }
    delete _cache.failed[_sanitized];
    _aimWriteCache(_cache);
  }

  if (_aimFailedCache.has(_sanitized)) {
    const _fc = _aimFailedCache.get(_sanitized);
    if (_fc.count >= _aimMaxRetry && Date.now() - _fc.time < 3600000) {
      return { success: false, name: _sanitized, error: 'Max retry exceeded (memory cache)', cached: true };
    }
  }

  _aimLog('info', `Installing ${_actualName} (attempt ${retryCount + 1}/${_aimMaxRetry})...`);

  const _strategies = [
    `npm install ${_actualName} --save --legacy-peer-deps --no-optional`,
    `npm install ${_actualName} --save --force`,
    `npm install ${_actualName} --save --legacy-peer-deps --ignore-scripts`,
    `npm install ${_actualName} --save --no-bin-links --legacy-peer-deps`
  ];

  for (let _si = 0; _si < _strategies.length; _si++) {
    try {
      const _startMs = Date.now();
      await _aimExecAsync(_strategies[_si], { timeout: _aimTimeout });
      const _elapsedMs = Date.now() - _startMs;

      if (_aimIsInstalled(_actualName.split('@')[0]) || _aimIsInstalled(_sanitized.split('@')[0])) {
        const _ver = _aimGetInstalledVersion(_actualName.split('@')[0]) || _aimGetInstalledVersion(_sanitized.split('@')[0]) || '?';
        _aimLog('info', `Successfully installed ${_actualName} v${_ver} in ${(_elapsedMs / 1000).toFixed(1)}s (strategy ${_si + 1})`);

        _cache.installed[_sanitized] = { version: _ver, installedAt: Date.now(), strategy: _si + 1, elapsed: _elapsedMs };
        _cache.totalInstalled = (_cache.totalInstalled || 0) + 1;
        _cache.history.push({ action: 'install', name: _sanitized, version: _ver, time: Date.now(), elapsed: _elapsedMs });
        if (_cache.history.length > 200) _cache.history = _cache.history.slice(-200);
        delete _cache.failed[_sanitized];
        _aimWriteCache(_cache);

        _aimSuccessCache.set(_sanitized, { version: _ver, time: Date.now() });
        _aimFailedCache.delete(_sanitized);

        return { success: true, name: _sanitized, version: _ver, elapsed: _elapsedMs, strategy: _si + 1 };
      }
    } catch (e) {
      _aimLog('warn', `Strategy ${_si + 1} failed for ${_actualName}: ${e.message.slice(0, 100)}`);
    }
  }

  if (retryCount < _aimMaxRetry - 1) {
    _aimLog('info', `Retrying ${_actualName} in ${_aimRetryDelay / 1000}s...`);
    await new Promise(r => setTimeout(r, _aimRetryDelay * (retryCount + 1)));
    return _aimInstallSingle(name, retryCount + 1);
  }

  _aimLog('error', `Failed to install ${_actualName} after all attempts`);
  _cache.failed[_sanitized] = { count: (_cache.failed[_sanitized]?.count || 0) + _aimMaxRetry, lastAttempt: Date.now(), error: 'All strategies failed' };
  _cache.totalFailed = (_cache.totalFailed || 0) + 1;
  _cache.history.push({ action: 'fail', name: _sanitized, time: Date.now() });
  _aimWriteCache(_cache);
  _aimFailedCache.set(_sanitized, { count: _aimMaxRetry, time: Date.now() });

  return { success: false, name: _sanitized, error: 'All installation strategies failed' };
}

async function _aimInstallBatch(names) {
  const _results = [];
  const _toInstall = [];

  for (const _n of names) {
    const _clean = _aimSanitize(_n);
    if (!_clean) { _results.push({ success: false, name: _n, error: 'Invalid name' }); continue; }
    if (_aimBuiltins.has(_clean.split('@')[0])) { _results.push({ success: true, name: _clean, builtin: true }); continue; }
    if (_aimIsInstalled(_clean.split('@')[0])) { _results.push({ success: true, name: _clean, alreadyInstalled: true, version: _aimGetInstalledVersion(_clean.split('@')[0]) }); continue; }
    _toInstall.push(_clean);
  }

  if (_toInstall.length === 0) return _results;

  if (_toInstall.length > 1 && _toInstall.length <= 10) {
    const _batchCmd = `npm install ${_toInstall.map(n => _aimAliasMap[n] || n).join(' ')} --save --legacy-peer-deps --no-optional`;
    try {
      _aimLog('info', `Batch installing: ${_toInstall.join(', ')}`);
      const _startMs = Date.now();
      await _aimExecAsync(_batchCmd, { timeout: _aimTimeout * 2 });
      const _elapsedMs = Date.now() - _startMs;

      let _allOk = true;
      for (const _n of _toInstall) {
        const _baseName = _n.split('@')[0];
        const _aliasBase = (_aimAliasMap[_n] || _n).split('@')[0];
        if (_aimIsInstalled(_baseName) || _aimIsInstalled(_aliasBase)) {
          const _ver = _aimGetInstalledVersion(_baseName) || _aimGetInstalledVersion(_aliasBase) || '?';
          _results.push({ success: true, name: _n, version: _ver, elapsed: _elapsedMs, batch: true });
        } else {
          _allOk = false;
        }
      }

      if (_allOk) return _results;
    } catch (e) {
      _aimLog('warn', `Batch install failed, falling back to individual: ${e.message.slice(0, 100)}`);
    }
  }

  const _remaining = _toInstall.filter(n => !_results.find(r => r.name === n && r.success));
  const _chunks = [];
  for (let _i = 0; _i < _remaining.length; _i += _aimMaxConcurrent) {
    _chunks.push(_remaining.slice(_i, _i + _aimMaxConcurrent));
  }

  for (const _chunk of _chunks) {
    const _chunkResults = await Promise.allSettled(_chunk.map(n => _aimInstallSingle(n)));
    for (const _cr of _chunkResults) {
      if (_cr.status === 'fulfilled') _results.push(_cr.value);
      else _results.push({ success: false, name: '?', error: _cr.reason?.message || 'Unknown error' });
    }
  }

  return _results;
}

function _aimScanRequires(dir, depth = 0) {
  const _modules = new Set();
  if (depth > 5) return _modules;
  const _extensions = ['.js', '.mjs', '.cjs', '.ts'];
  const _ignoreDirs = new Set(['node_modules', '.git', '.cache', 'tmp', 'temp', 'dist', 'build', 'coverage', '.nyc_output']);

  try {
    const _entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const _entry of _entries) {
      if (_entry.name.startsWith('.') && _ignoreDirs.has(_entry.name)) continue;
      const _fullPath = path.join(dir, _entry.name);

      if (_entry.isDirectory() && !_ignoreDirs.has(_entry.name)) {
        const _sub = _aimScanRequires(_fullPath, depth + 1);
        for (const _s of _sub) _modules.add(_s);
        continue;
      }

      if (!_entry.isFile() || !_extensions.some(ext => _entry.name.endsWith(ext))) continue;

      try {
        const _content = fs.readFileSync(_fullPath, 'utf8');
        const _requireRegex = /(?:require\s*\(\s*['"`]([^'"`./\\][^'"`]*)['"`]\s*\)|from\s+['"`]([^'"`./\\][^'"`]*)['"`]|import\s+['"`]([^'"`./\\][^'"`]*)['"`]|import\s*\(?\s*['"`]([^'"`./\\][^'"`]*)['"`]\s*\)?|await\s+import\s*\(\s*['"`]([^'"`./\\][^'"`]*)['"`]\s*\))/g;
        let _match;
        while ((_match = _requireRegex.exec(_content)) !== null) {
          const _mod = _match[1] || _match[2] || _match[3] || _match[4] || _match[5];
          if (_mod) {
            const _baseMod = _mod.startsWith('@') ? _mod.split('/').slice(0, 2).join('/') : _mod.split('/')[0];
            if (_baseMod && !_aimBuiltins.has(_baseMod) && !_aimBuiltins.has(_mod)) {
              _modules.add(_baseMod);
            }
          }
        }
      } catch {}
    }
  } catch {}

  return _modules;
}

async function _aimAutoScan(rootDir) {
  const _cache = _aimReadCache();
  const _lastScan = _cache.lastScan || 0;

  if (Date.now() - _lastScan < 300000) {
    _aimLog('info', 'Skipping scan, last scan was less than 5 minutes ago');
    return { scanned: false, reason: 'cooldown' };
  }

  if (!_aimAcquireLock()) {
    _aimLog('warn', 'Another auto-install process is running');
    return { scanned: false, reason: 'locked' };
  }

  try {
    _aimLog('info', 'Starting auto-scan for missing modules...');
    const _scanStart = Date.now();
    const _root = rootDir || path.join(__dirname, '..');
    const _requiredModules = _aimScanRequires(_root);
    const _pkg = _aimReadPkg();
    const _declaredDeps = new Set([
      ...Object.keys(_pkg.dependencies || {}),
      ...Object.keys(_pkg.devDependencies || {})
    ]);

    const _missing = [];
    const _found = [];
    const _builtin = [];

    for (const _mod of _requiredModules) {
      if (_aimBuiltins.has(_mod)) { _builtin.push(_mod); continue; }
      if (_aimIsInstalled(_mod)) { _found.push(_mod); continue; }
      if (!_aimValidatePackageName(_mod)) continue;
      _missing.push(_mod);
    }

    _aimLog('info', `Scan complete: ${_requiredModules.size} modules found, ${_missing.length} missing, ${_found.length} installed, ${_builtin.length} builtin`);

    if (_missing.length === 0) {
      _cache.lastScan = Date.now();
      _aimWriteCache(_cache);
      _aimReleaseLock();
      return { scanned: true, missing: 0, total: _requiredModules.size, installed: _found.length, builtin: _builtin.length, elapsed: Date.now() - _scanStart };
    }

    _aimLog('info', `Auto-installing ${_missing.length} missing modules: ${_missing.join(', ')}`);
    const _installResults = await _aimInstallBatch(_missing);

    const _successCount = _installResults.filter(r => r.success && !r.alreadyInstalled && !r.builtin).length;
    const _failCount = _installResults.filter(r => !r.success).length;

    _cache.lastScan = Date.now();
    _aimWriteCache(_cache);

    _aimLog('info', `Auto-install complete: ${_successCount} installed, ${_failCount} failed`);
    _aimReleaseLock();

    return {
      scanned: true,
      missing: _missing.length,
      total: _requiredModules.size,
      installed: _found.length,
      builtin: _builtin.length,
      results: _installResults,
      successCount: _successCount,
      failCount: _failCount,
      elapsed: Date.now() - _scanStart,
      needRestart: _successCount > 0
    };
  } catch (e) {
    _aimLog('error', `Auto-scan error: ${e.message}`);
    _aimReleaseLock();
    return { scanned: false, error: e.message };
  }
}

function _aimSafeRequire(name, fallback = null) {
  try {
    return require(name);
  } catch {
    const _clean = _aimSanitize(name);
    if (!_clean || _aimBuiltins.has(_clean)) return fallback;
    _aimLog('warn', `Module "${_clean}" not found, queuing auto-install...`);
    _aimQueue.push(_clean);
    _aimProcessQueue();
    return fallback;
  }
}

let _aimQueueProcessing = false;
async function _aimProcessQueue() {
  if (_aimQueueProcessing || _aimQueue.length === 0) return;
  _aimQueueProcessing = true;

  try {
    const _batch = [...new Set(_aimQueue.splice(0, 10))];
    if (_batch.length > 0) {
      const _results = await _aimInstallBatch(_batch);
      for (const _r of _results) {
        _aimResults.set(_r.name, _r);
      }
    }
  } catch (e) {
    _aimLog('error', `Queue processing error: ${e.message}`);
  }

  _aimQueueProcessing = false;
  if (_aimQueue.length > 0) setTimeout(_aimProcessQueue, 2000);
}

async function _aimUninstallSingle(name) {
  const _clean = _aimSanitize(name).split('@')[0];
  if (!_clean) return { success: false, name, error: 'Invalid name' };
  if (_aimBuiltins.has(_clean)) return { success: false, name: _clean, error: 'Cannot uninstall builtin module' };
  if (_aimProtected.has(_clean)) return { success: false, name: _clean, error: 'Protected module cannot be uninstalled' };
  if (!_aimIsInstalled(_clean)) return { success: false, name: _clean, error: 'Module not installed' };

  const _ver = _aimGetInstalledVersion(_clean);
  try {
    await _aimExecAsync(`npm uninstall ${_clean} --save`, { timeout: 60000 });
    const _cache = _aimReadCache();
    delete _cache.installed[_clean];
    _cache.history.push({ action: 'uninstall', name: _clean, version: _ver, time: Date.now() });
    _aimWriteCache(_cache);
    _aimLog('info', `Uninstalled ${_clean} v${_ver}`);
    return { success: true, name: _clean, version: _ver };
  } catch (e) {
    return { success: false, name: _clean, error: e.message.slice(0, 200) };
  }
}

async function _aimUpdateSingle(name) {
  const _clean = _aimSanitize(name).split('@')[0];
  if (!_clean) return { success: false, name, error: 'Invalid name' };
  if (_aimBuiltins.has(_clean)) return { success: false, name: _clean, error: 'Builtin module' };

  const _oldVer = _aimGetInstalledVersion(_clean) || 'not installed';
  try {
    await _aimExecAsync(`npm install ${_clean}@latest --save --legacy-peer-deps`, { timeout: _aimTimeout });
    const _newVer = _aimGetInstalledVersion(_clean) || '?';
    const _cache = _aimReadCache();
    _cache.installed[_clean] = { version: _newVer, updatedAt: Date.now() };
    _cache.history.push({ action: 'update', name: _clean, from: _oldVer, to: _newVer, time: Date.now() });
    _aimWriteCache(_cache);
    return { success: true, name: _clean, from: _oldVer, to: _newVer };
  } catch (e) {
    return { success: false, name: _clean, error: e.message.slice(0, 200) };
  }
}

async function _aimCheckOutdated() {
  try {
    const _result = await _aimExecAsync('npm outdated --json', { timeout: 30000 });
    return JSON.parse(_result.stdout || '{}');
  } catch (e) {
    try { return JSON.parse(e.message.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { return {}; }
  }
}

async function _aimVerifyIntegrity() {
  const _pkg = _aimReadPkg();
  const _deps = { ...(_pkg.dependencies || {}), ...(_pkg.devDependencies || {}) };
  const _issues = [];

  for (const [name] of Object.entries(_deps)) {
    if (!_aimIsInstalled(name)) _issues.push({ name, issue: 'missing' });
    else {
      try {
        require.resolve(name);
      } catch {
        _issues.push({ name, issue: 'broken' });
      }
    }
  }

  return _issues;
}

function _aimGetStats() {
  const _cache = _aimReadCache();
  const _pkg = _aimReadPkg();
  const _deps = Object.keys(_pkg.dependencies || {});
  const _devDeps = Object.keys(_pkg.devDependencies || {});
  const _installed = _deps.filter(d => _aimIsInstalled(d));
  const _missing = _deps.filter(d => !_aimIsInstalled(d) && !_aimBuiltins.has(d));

  return {
    totalDependencies: _deps.length,
    totalDevDependencies: _devDeps.length,
    installed: _installed.length,
    missing: _missing.length,
    missingList: _missing,
    totalAutoInstalled: _cache.totalInstalled || 0,
    totalAutoFailed: _cache.totalFailed || 0,
    failedModules: Object.keys(_cache.failed || {}),
    lastScan: _cache.lastScan || 0,
    queueLength: _aimQueue.length,
    processing: _aimProcessing.size,
    uptime: Date.now() - _aimStartTime,
    historyCount: (_cache.history || []).length
  };
}

function _aimGetHistory(limit = 20) {
  const _cache = _aimReadCache();
  return (_cache.history || []).slice(-limit).reverse();
}

function _aimClearCache() {
  const _cache = _aimReadCache();
  const _old = { ..._cache };
  _cache.failed = {};
  _cache.history = [];
  _cache.totalFailed = 0;
  _aimWriteCache(_cache);
  _aimFailedCache.clear();
  _aimSuccessCache.clear();
  return _old;
}

function _aimResetFailed(name) {
  if (name) {
    const _clean = _aimSanitize(name);
    const _cache = _aimReadCache();
    delete _cache.failed[_clean];
    _aimWriteCache(_cache);
    _aimFailedCache.delete(_clean);
    return true;
  }
  const _cache = _aimReadCache();
  _cache.failed = {};
  _cache.totalFailed = 0;
  _aimWriteCache(_cache);
  _aimFailedCache.clear();
  return true;
}

async function _aimHealthCheck() {
  const _results = { npm: false, network: false, disk: false, nodeModules: false };

  try {
    const _npmVer = execSync('npm --version', { timeout: 10000, encoding: 'utf8' });
    _results.npm = _npmVer.trim();
  } catch {}

  try {
    await _aimExecAsync('npm ping', { timeout: 10000 });
    _results.network = true;
  } catch {}

  try {
    const _nmPath = path.join(__dirname, '..', 'node_modules');
    _results.nodeModules = fs.existsSync(_nmPath);
    const _stats = fs.statSync(_nmPath);
    _results.nodeModulesSize = _stats.size;
  } catch {}

  try {
    const _tmpFile = path.join(__dirname, '..', '.aim_disk_test_' + Date.now());
    fs.writeFileSync(_tmpFile, 'test');
    fs.unlinkSync(_tmpFile);
    _results.disk = true;
  } catch {}

  return _results;
}

process.on('uncaughtException', (err) => {
  const _modMatch = err.message.match(/Cannot find module '([^']+)'/);
  if (_modMatch) {
    const _modName = _modMatch[1];
    if (!_modName.startsWith('.') && !_modName.startsWith('/') && !_aimBuiltins.has(_modName)) {
      const _baseMod = _modName.startsWith('@') ? _modName.split('/').slice(0, 2).join('/') : _modName.split('/')[0];
      _aimLog('warn', `Caught uncaughtException for missing module: ${_baseMod}`);
      _aimQueue.push(_baseMod);
      _aimProcessQueue();
    }
  }
});

module.exports = {
  _aimInstallSingle,
  _aimInstallBatch,
  _aimUninstallSingle,
  _aimUpdateSingle,
  _aimAutoScan,
  _aimSafeRequire,
  _aimScanRequires,
  _aimIsInstalled,
  _aimGetInstalledVersion,
  _aimGetLatestVersion,
  _aimCheckOutdated,
  _aimVerifyIntegrity,
  _aimHealthCheck,
  _aimGetStats,
  _aimGetHistory,
  _aimClearCache,
  _aimResetFailed,
  _aimSanitize,
  _aimValidatePackageName,
  _aimReadPkg,
  _aimReadCache,
  _aimLog,
  _aimBuiltins,
  _aimProtected,
  _aimAliasMap,
  _aimCriticalModules,
  _aimQueue,
  _aimResults
};
'use strict';
const _L = (() => { try { return require('../logger'); } catch { return { log:()=>{}, error:()=>{}, warn:()=>{}, update:()=>{}, setStatus:()=>{} }; } })();

const fs     = require('fs');
const crypto = require('crypto');
const path   = require('path');
const os     = require('os');
const ANTIBAN_DIR     = './database/antiban';
const WARMUP_PATH     = `${ANTIBAN_DIR}/warmup.json`;
const RISK_LOG_PATH   = `${ANTIBAN_DIR}/risk_log.json`;
const SEND_LOG_PATH   = `${ANTIBAN_DIR}/send_log.json`;
const RECONNECT_PATH  = `${ANTIBAN_DIR}/reconnect.json`;
const HEALTH_PATH     = `${ANTIBAN_DIR}/health.json`;
const CIRCADIAN_PATH  = `${ANTIBAN_DIR}/circadian.json`;
const FORENSIC_PATH   = `${ANTIBAN_DIR}/forensic.json`;
const INTERACTION_PATH = `${ANTIBAN_DIR}/interaction.json`;
const PRESENCE_PATH   = `${ANTIBAN_DIR}/presence.json`;
const HEARTBEAT_PATH  = `${ANTIBAN_DIR}/heartbeat.json`;
const ENTROPY_PATH    = `${ANTIBAN_DIR}/entropy.json`;
const ANOMALY_PATH    = `${ANTIBAN_DIR}/anomaly.json`;
const DEGRADATION_PATH = `${ANTIBAN_DIR}/degradation.json`;
const CONNECTION_PATH  = `${ANTIBAN_DIR}/connection.json`;

const _ensureDir = () => {
    if (!fs.existsSync(ANTIBAN_DIR)) fs.mkdirSync(ANTIBAN_DIR, { recursive: true });
};
const _readJSON  = (p, fallback) => { try { _ensureDir(); return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const _writeJSON = (p, d)        => { try { _ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} };


/**
 * Box-Muller transform — generate Gaussian random number
 * Digunakan karena distribusi normal lebih mirip timing manusia
 * dibanding uniform random
 * @param {number} mean  - nilai rata-rata (ms)
 * @param {number} sigma - standar deviasi (ms)
 */
function _gaussianRandom(mean, sigma) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return Math.max(0, Math.round(mean + sigma * n));
}

/**
 * Poisson random variate — model event natural
 * Manusia melakukan aksi mengikuti proses Poisson, bukan uniform
 * Knuth algorithm untuk lambda kecil
 * @param {number} lambda - rata-rata event per interval
 */
function _poissonRandom(lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 30) {
        // Untuk lambda besar, approx dgn Gaussian
        return Math.max(0, Math.round(_gaussianRandom(lambda, Math.sqrt(lambda))));
    }
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do {
        k++;
        p *= Math.random();
    } while (p > L);
    return k - 1;
}

/**
 * Exponential random variate — model inter-arrival time
 * Waktu antar-event dalam proses Poisson terdistribusi exponensial
 * @param {number} rate - parameter rate (1/mean)
 */
function _exponentialRandom(rate) {
    if (rate <= 0) return Infinity;
    return Math.round(-Math.log(Math.random()) / rate);
}

/**
 * Beta distribution random — model probabilitas
 * Useful untuk confidence/probability yang bounded [0,1]
 * Menggunakan Gamma variate
 * @param {number} alpha 
 * @param {number} beta 
 */
function _betaRandom(alpha, beta) {
    const gammaA = _gammaRandom(alpha);
    const gammaB = _gammaRandom(beta);
    return gammaA / (gammaA + gammaB);
}

/**
 * Gamma random variate — Marsaglia & Tsang's method
 * @param {number} shape - shape parameter (alpha)
 */
function _gammaRandom(shape) {
    if (shape < 1) {
        return _gammaRandom(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
        let x, v;
        do {
            x = _gaussianRandom(0, 1) / 1000; // normalize
            v = Math.pow(1 + c * x, 3);
        } while (v <= 0);
        const u = Math.random();
        if (u < 1 - 0.0331 * x * x * x * x) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
}

/**
 * Weibull distribution — model failure/survival times
 * Digunakan untuk reconnect timing yang natural
 * @param {number} scale - λ parameter
 * @param {number} shape - k parameter
 */
function _weibullRandom(scale, shape) {
    return scale * Math.pow(-Math.log(Math.random()), 1 / shape);
}

/**
 * Log-normal distribution — model response time manusia
 * Research menunjukkan human response time mengikuti log-normal
 * @param {number} mu - mean of log
 * @param {number} sigma - std dev of log
 */
function _logNormalRandom(mu, sigma) {
    const normal = _gaussianRandom(0, 1) / 100; // small scale
    return Math.exp(mu + sigma * normal);
}

/**
 * Pareto distribution — model extreme values
 * Berguna untuk "occasional long pause" yang natural
 * @param {number} xm - minimum value
 * @param {number} alpha - shape parameter  
 */
function _paretoRandom(xm, alpha) {
    return xm / Math.pow(Math.random(), 1 / alpha);
}

/**
 * Kolmogorov-Smirnov test — deteksi apakah distribusi delay kita
 * terlalu uniform/obvious. Self-check.
 * @param {number[]} samples - array of delay samples
 * @returns {{ statistic: number, isNatural: boolean }}
 */
function _ksTestNormality(samples) {
    if (samples.length < 10) return { statistic: 0, isNatural: true };

    const sorted = [...samples].sort((a, b) => a - b);
    const n      = sorted.length;
    const mean   = sorted.reduce((s, v) => s + v, 0) / n;
    const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std    = Math.sqrt(variance);

    if (std === 0) return { statistic: 1, isNatural: false };

    let maxD = 0;
    for (let i = 0; i < n; i++) {
        const z   = (sorted[i] - mean) / std;
        const cdf = 0.5 * (1 + _erf(z / Math.SQRT2));
        const d1  = Math.abs((i + 1) / n - cdf);
        const d2  = Math.abs(cdf - i / n);
        maxD      = Math.max(maxD, d1, d2);
    }

    // Critical value at α=0.05: 1.36/√n
    const critical = 1.36 / Math.sqrt(n);
    return {
        statistic: maxD,
        critical,
        isNatural: maxD < critical,
        confidence: Math.max(0, 1 - maxD / critical),
    };
}

/**
 * Error function approximation — used in KS test
 */
function _erf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
}

/**
 * Autocorrelation check — detect periodic patterns
 * WA bisa deteksi delay yang terlalu reguler/periodic
 * @param {number[]} series - time series data
 * @param {number} lag - lag to test
 */
function _autocorrelation(series, lag = 1) {
    if (series.length < lag + 2) return 0;
    const n    = series.length;
    const mean = series.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n - lag; i++) {
        num += (series[i] - mean) * (series[i + lag] - mean);
    }
    for (let i = 0; i < n; i++) {
        den += (series[i] - mean) ** 2;
    }
    return den === 0 ? 0 : num / den;
}

/**
 * Shannon entropy — mengukur randomness dari data
 * Digunakan untuk memastikan konten cukup bervariasi
 * @param {string} text
 */
function _shannonEntropy(text) {
    if (!text || text.length === 0) return 0;
    const freq = {};
    for (const ch of text) freq[ch] = (freq[ch] || 0) + 1;
    const len = text.length;
    let entropy = 0;
    for (const ch in freq) {
        const p = freq[ch] / len;
        if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
}

/**
 * SimHash — locality-sensitive hashing untuk deteksi konten mirip
 * Lebih canggih dari MD5 karena bisa deteksi konten yang "hampir sama"
 * @param {string} text
 * @param {number} bits - hash size
 */
function _simHash(text, bits = 64) {
    if (!text) return BigInt(0);
    const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
    const tokens     = [];

    // Generate n-grams (2-gram dan 3-gram)
    for (let i = 0; i < normalized.length - 1; i++) {
        tokens.push(normalized.slice(i, i + 2));
        if (i < normalized.length - 2) tokens.push(normalized.slice(i, i + 3));
    }

    // Word-level tokens juga
    const words = normalized.split(/\s+/);
    tokens.push(...words);

    const vector = new Array(bits).fill(0);

    for (const token of tokens) {
        const hash = _fnv1aHash64(token);
        for (let i = 0; i < bits; i++) {
            const bit = (hash >> BigInt(i)) & BigInt(1);
            vector[i] += bit === BigInt(1) ? 1 : -1;
        }
    }

    let result = BigInt(0);
    for (let i = 0; i < bits; i++) {
        if (vector[i] > 0) result |= BigInt(1) << BigInt(i);
    }
    return result;
}

/**
 * FNV-1a hash (64-bit) — fast non-crypto hash untuk SimHash
 */
function _fnv1aHash64(str) {
    let hash = BigInt('14695981039346656037');
    const prime = BigInt('1099511628211');
    for (let i = 0; i < str.length; i++) {
        hash ^= BigInt(str.charCodeAt(i));
        hash = (hash * prime) & BigInt('0xFFFFFFFFFFFFFFFF');
    }
    return hash;
}

/**
 * Hamming distance antara dua SimHash — ukur similarity
 * @param {BigInt} a
 * @param {BigInt} b
 */
function _hammingDistance(a, b) {
    let xor = a ^ b;
    let dist = 0;
    while (xor > BigInt(0)) {
        dist += Number(xor & BigInt(1));
        xor >>= BigInt(1);
    }
    return dist;
}

/**
 * Moving average — smoothing data untuk deteksi trend
 */
function _movingAverage(data, window = 5) {
    if (data.length < window) return data;
    const result = [];
    for (let i = 0; i <= data.length - window; i++) {
        const slice = data.slice(i, i + window);
        result.push(slice.reduce((s, v) => s + v, 0) / window);
    }
    return result;
}

/**
 * Exponential Moving Average — lebih responsif ke data terbaru
 */
function _ema(data, alpha = 0.3) {
    if (data.length === 0) return [];
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
        result.push(alpha * data[i] + (1 - alpha) * result[i - 1]);
    }
    return result;
}

/**
 * Z-score outlier detection
 */
function _zScore(value, mean, std) {
    if (std === 0) return 0;
    return (value - mean) / std;
}


// Delay history untuk self-analysis
const _DELAY_HISTORY = {
    samples:    [],
    maxSamples: 500,
    lastKS:     null,
    lastAutoCorr: null,
};

/**
 * Hitung delay human-like berdasarkan konteks pesan
 * ENHANCED dengan fatigue model, circadian influence, dan self-check
 * @param {object} opts
 *   textLength    — panjang teks (lebih panjang = lebih lama)
 *   isNewContact  — first message ke kontak baru (+penalty)
 *   isBurst       — dalam 3 pesan pertama (lebih cepat)
 *   riskLevel     — 'low'|'medium'|'high'|'critical'
 *   isGroup       — pesan ke grup
 *   messageType   — 'text'|'image'|'video'|'sticker'|'audio'
 *   sessionAge    — berapa lama sesi berjalan (ms)
 *   recentActivity — jumlah pesan 5 menit terakhir
 */
function gaussianDelay(opts = {}) {
    const {
        textLength     = 0,
        isNewContact   = false,
        isBurst        = false,
        riskLevel      = 'low',
        isGroup        = false,
        messageType    = 'text',
        sessionAge     = 0,
        recentActivity = 0,
    } = opts;

    // ── Base delay berdasarkan risk level ──
    const ranges = {
        low:      { mean: 1500,  sigma: 400  },
        medium:   { mean: 3000,  sigma: 800  },
        high:     { mean: 6000,  sigma: 1500 },
        critical: { mean: 12000, sigma: 3000 },
    };
    const range = ranges[riskLevel] || ranges.low;
    let delay = _gaussianRandom(range.mean, range.sigma);

    // ── Typing simulation proporsional ──
    // Human typing: ~35-65 WPM, ~200-300ms per character with typos & pauses
    const charDelay = messageType === 'text'
        ? _gaussianRandom(35, 12) // ms per char, with variance
        : 0;
    const typingMs = Math.min(textLength * charDelay, 6000);
    delay += typingMs;

    // ── Message type penalty ──
    // Kirim media butuh waktu lebih (pilih file, crop, dll)
    const mediaPenalty = {
        text:    0,
        image:   _gaussianRandom(2000, 600),
        video:   _gaussianRandom(3500, 1000),
        sticker: _gaussianRandom(800, 200),
        audio:   _gaussianRandom(1500, 400),
        document: _gaussianRandom(3000, 800),
    };
    delay += mediaPenalty[messageType] || 0;

    // ── Burst allowance ──
    // 2-3 pesan pertama lebih cepat (natural conversation burst)
    if (isBurst) {
        const burstMultiplier = 0.3 + Math.random() * 0.2; // 0.3 - 0.5x
        delay = Math.round(delay * burstMultiplier);
    }

    // ── New contact penalty ──
    // Pesan pertama ke kontak baru: ambil waktu (cari kontak, dll)
    if (isNewContact) delay += _gaussianRandom(3000, 800);

    // ── Group slightly slower ──
    // Grup: baca dulu pesan orang lain
    if (isGroup) delay += _gaussianRandom(700, 250);

    // ── Circadian influence ──
    const hour = new Date().getHours();
    const circadianMultiplier = circadianEngine.getActivityMultiplier(hour);
    delay = Math.round(delay / circadianMultiplier);

    // ── Fatigue model ──
    // Semakin lama sesi berjalan, semakin lambat (capek)
    if (sessionAge > 0) {
        const hoursActive = sessionAge / 3600000;
        const fatigueFactor = 1 + Math.min(hoursActive * 0.05, 0.5); // max +50%
        delay = Math.round(delay * fatigueFactor);
    }

    // ── Recent activity cooldown ──
    // Banyak pesan baru-baru ini → jeda lebih lama
    if (recentActivity > 5) {
        delay += _gaussianRandom(recentActivity * 200, recentActivity * 50);
    }

    // ── Occasional "distraction" pause ──
    // Manusia kadang teralihkan — cek WA lain, notification, dll
    const distractionRoll = Math.random();
    if (distractionRoll < 0.05) {
        // 5%: distraksi panjang (baca berita, dll)
        delay += _gaussianRandom(15000, 5000);
    } else if (distractionRoll < 0.12) {
        // 7%: distraksi sedang (cek notif lain)
        delay += _gaussianRandom(6000, 1500);
    } else if (distractionRoll < 0.20) {
        // 8%: distraksi ringan (scroll sebentar)
        delay += _gaussianRandom(2500, 600);
    }

    // ── Micro-jitter ──
    // Tambah noise kecil agar tidak persis Gaussian murni
    delay += Math.round((Math.random() - 0.5) * 300);

    // ── Log-normal tail ──
    // Kadang delay sangat lama (fat tail) — natural
    if (Math.random() < 0.03) {
        delay = Math.round(_logNormalRandom(Math.log(delay), 0.5));
    }

    // ── Hard floor & ceiling ──
    delay = Math.max(600, Math.min(delay, 45000));

    // ── Record untuk self-analysis ──
    _DELAY_HISTORY.samples.push(delay);
    if (_DELAY_HISTORY.samples.length > _DELAY_HISTORY.maxSamples) {
        _DELAY_HISTORY.samples = _DELAY_HISTORY.samples.slice(-_DELAY_HISTORY.maxSamples);
    }

    // ── Periodic self-check: distribusi kita masih natural? ──
    if (_DELAY_HISTORY.samples.length >= 30 && _DELAY_HISTORY.samples.length % 30 === 0) {
        _selfCheckDelayDistribution();
    }

    return delay;
}

/**
 * Self-check: KS test + autocorrelation pada delay kita sendiri
 * Jika distribusi terlalu regular/periodic → adjust
 */
function _selfCheckDelayDistribution() {
    const samples = _DELAY_HISTORY.samples;

    // KS test — apakah distribusi kita masih "cukup normal"?
    const ks = _ksTestNormality(samples.slice(-100));
    _DELAY_HISTORY.lastKS = ks;

    // Autocorrelation check — apakah ada pola periodic?
    const ac1 = _autocorrelation(samples.slice(-50), 1);
    const ac2 = _autocorrelation(samples.slice(-50), 2);
    const ac5 = _autocorrelation(samples.slice(-50), 5);
    _DELAY_HISTORY.lastAutoCorr = { lag1: ac1, lag2: ac2, lag5: ac5 };

    // Alert jika terlalu periodic (autocorrelation tinggi)
    if (Math.abs(ac1) > 0.4 || Math.abs(ac2) > 0.3) {
        // suppressed: jitter noise inject — internal
        banRiskScorer.addFactor('periodic_delay_pattern', 10);
        // Inject extra randomness pada beberapa sample berikutnya
        _DELAY_HISTORY._injectNoise = 5;
    } else {
        banRiskScorer.removeFactor('periodic_delay_pattern');
    }

    // Jika terlalu uniform (gagal KS test), delay kita terlalu "robotic"
    if (!ks.isNatural && samples.length > 50) {
        // suppressed: jitter normality adjust — internal
        banRiskScorer.addFactor('unnatural_delay_dist', 8);
    } else {
        banRiskScorer.removeFactor('unnatural_delay_dist');
    }
}

function getDelayAnalytics() {
    const samples = _DELAY_HISTORY.samples;
    if (samples.length === 0) return { count: 0 };

    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
    const std = Math.sqrt(variance);
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    return {
        count:    samples.length,
        mean:     Math.round(mean),
        median:   Math.round(median),
        std:      Math.round(std),
        min:      sorted[0],
        max:      sorted[sorted.length - 1],
        p95,
        p99,
        cv:       std / mean, // coefficient of variation
        ksTest:   _DELAY_HISTORY.lastKS,
        autoCorr: _DELAY_HISTORY.lastAutoCorr,
    };
}

const poissonSimulator = {
    _events:      [],
    _maxEvents:   1000,
    _rateHistory: [],

    /**
     * Hitung expected rate (pesan/menit) berdasarkan jam
     * Model non-homogeneous Poisson process
     * Rate tinggi siang, rendah malam
     */
    getRate(hour = new Date().getHours()) {
        // Model berdasarkan riset penggunaan messaging:
        // Peak: 10-12, 19-22
        // Low:  2-6
        const rates = {
            0: 0.3, 1: 0.1, 2: 0.05, 3: 0.02, 4: 0.02, 5: 0.05,
            6: 0.2, 7: 0.5, 8: 0.8,  9: 1.2,  10: 1.5, 11: 1.5,
            12: 1.3, 13: 1.0, 14: 1.2, 15: 1.3, 16: 1.2, 17: 1.0,
            18: 1.2, 19: 1.8, 20: 2.0, 21: 1.8, 22: 1.2, 23: 0.6,
        };

        const base = rates[hour] || 0.5;
        // Tambah jitter pada rate itu sendiri
        return Math.max(0.01, base + _gaussianRandom(0, base * 0.15) / 1000);
    },

    /**
     * Generate inter-arrival time untuk event berikutnya
     * Mengikuti Poisson process: exponentially distributed
     */
    nextInterArrival() {
        const rate = this.getRate();
        const interArrivalMs = _exponentialRandom(rate / 60000);
        // Clamp ke range reasonable
        return Math.max(500, Math.min(interArrivalMs, 600000)); // 500ms - 10min
    },

    /**
     * Apakah sekarang "waktu yang natural" untuk mengirim pesan?
     * Berdasarkan Poisson rate saat ini
     */
    isNaturalTimingForSend() {
        const rate = this.getRate();
        const now  = Date.now();
        const recentEvents = this._events.filter(t => now - t < 60000);

        // Jika jumlah event baru-baru ini melebihi expected rate × 2
        if (recentEvents.length > rate * 2) {
            return { natural: false, reason: 'Terlalu banyak event dalam window', rate, actual: recentEvents.length };
        }
        return { natural: true, rate, actual: recentEvents.length };
    },

    recordEvent() {
        this._events.push(Date.now());
        if (this._events.length > this._maxEvents) {
            this._events = this._events.slice(-this._maxEvents);
        }
        this._rateHistory.push({ ts: Date.now(), rate: this.getRate() });
        if (this._rateHistory.length > 200) {
            this._rateHistory = this._rateHistory.slice(-100);
        }
    },

    /**
     * Hitung goodness-of-fit antara actual events vs Poisson model
     * Chi-square test sederhana
     */
    goodnessOfFit() {
        if (this._events.length < 20) return { chiSquare: 0, fit: 'insufficient_data' };

        // Hitung inter-arrival times aktual
        const interArrivals = [];
        for (let i = 1; i < this._events.length; i++) {
            interArrivals.push(this._events[i] - this._events[i - 1]);
        }

        const mean = interArrivals.reduce((s, v) => s + v, 0) / interArrivals.length;
        const variance = interArrivals.reduce((s, v) => s + (v - mean) ** 2, 0) / interArrivals.length;

        // Untuk Poisson process, variance/mean ≈ mean (exponential inter-arrivals)
        // Index of dispersion
        const dispersion = variance / mean;
        const ratio = dispersion / mean;

        if (ratio < 0.5 || ratio > 2.0) {
            return { dispersion, ratio, fit: 'poor' };
        }
        return { dispersion, ratio, fit: 'good' };
    },

    getStatus() {
        return {
            currentRate:    this.getRate(),
            totalEvents:    this._events.length,
            lastMinEvents:  this._events.filter(t => Date.now() - t < 60000).length,
            goodnessOfFit:  this.goodnessOfFit(),
            naturalTiming:  this.isNaturalTimingForSend(),
        };
    },
};

const circadianEngine = {
    _profile:     null,
    _wakeUpHour:  7,
    _sleepHour:   23,
    _peakHours:   [10, 11, 14, 15, 20, 21],
    _timezone:    Intl.DateTimeFormat().resolvedOptions().timeZone,

    /**
     * Initialize circadian profile — bisa personalize
     * Default: typical Indonesian/Asian schedule
     */
    init(opts = {}) {
        this._wakeUpHour = opts.wakeUpHour ?? 7;
        this._sleepHour  = opts.sleepHour  ?? 23;
        this._peakHours  = opts.peakHours  ?? [10, 11, 14, 15, 20, 21];

        // Generate personal circadian curve
        this._profile = this._generateProfile();

        const db = _readJSON(CIRCADIAN_PATH, {});
        db.profile = this._profile;
        db.initAt  = Date.now();
        _writeJSON(CIRCADIAN_PATH, db);

        _L.log('AntiBan', `Circadian: bangun ${this._wakeUpHour}:00, tidur ${this._sleepHour}:00`);
    },

    _generateProfile() {
        const profile = {};
        for (let h = 0; h < 24; h++) {
            let activity;
            if (h >= this._sleepHour || h < this._wakeUpHour - 1) {
                // Tidur — aktivitas sangat rendah
                activity = 0.02 + Math.random() * 0.08; // 2-10%
            } else if (h === this._wakeUpHour - 1) {
                // Mulai bangun
                activity = 0.15 + Math.random() * 0.1;
            } else if (h === this._wakeUpHour) {
                // Baru bangun — cek HP (typical)
                activity = 0.5 + Math.random() * 0.2;
            } else if (this._peakHours.includes(h)) {
                // Peak hours
                activity = 0.8 + Math.random() * 0.2;
            } else {
                // Normal hours
                activity = 0.4 + Math.random() * 0.3;
            }

            // Tambah personal jitter agar tidak perfectly smooth
            activity += (Math.random() - 0.5) * 0.05;
            profile[h] = Math.max(0.01, Math.min(1, activity));
        }
        return profile;
    },

    /**
     * Get activity multiplier untuk jam tertentu
     * 1.0 = full speed, 0.01 = almost asleep
     */
    getActivityMultiplier(hour = new Date().getHours()) {
        if (!this._profile) this.init();

        // Interpolate antara jam saat ini dan berikutnya
        const minute = new Date().getMinutes();
        const current = this._profile[hour] || 0.5;
        const next    = this._profile[(hour + 1) % 24] || 0.5;
        const interpolated = current + (next - current) * (minute / 60);

        // Tambah micro-variation
        return Math.max(0.01, interpolated + (Math.random() - 0.5) * 0.03);
    },

    /**
     * Apakah sekarang "sleep time"?
     */
    isSleepTime() {
        const hour = new Date().getHours();
        return hour >= this._sleepHour || hour < this._wakeUpHour - 1;
    },

    /**
     * Apakah bot seharusnya "aktif" sekarang?
     */
    shouldBeActive() {
        const multiplier = this.getActivityMultiplier();
        if (this.isSleepTime()) {
            // Selama tidur, occasional check (toilet break, dll)
            return Math.random() < 0.05; // 5% chance
        }
        return Math.random() < multiplier;
    },

    /**
     * Berapa lama harus "tidur" sebelum aktif lagi?
     * Jika di sleep period
     */
    getSleepDuration() {
        if (!this.isSleepTime()) return 0;
        const hour     = new Date().getHours();
        const wakeUp   = this._wakeUpHour;
        const hoursLeft = hour >= this._sleepHour
            ? (24 - hour + wakeUp)
            : (wakeUp - hour);
        const baseDuration = hoursLeft * 3600000;
        return baseDuration + _gaussianRandom(0, 1800000); // ±30min jitter
    },

    /**
     * Daily pattern variation — hari ini sedikit berbeda dari kemarin
     * Manusia tidak perfectly consistent tiap hari
     */
    getDailyVariation() {
        const dayOfWeek = new Date().getDay();
        // Weekend sedikit berbeda
        const weekendFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.15 : 1.0;
        // Random daily mood
        const moodFactor = 0.85 + Math.random() * 0.3; // 0.85 - 1.15
        return weekendFactor * moodFactor;
    },

    getStatus() {
        const hour = new Date().getHours();
        return {
            currentHour:      hour,
            activityLevel:    Math.round(this.getActivityMultiplier(hour) * 100) + '%',
            isSleepTime:      this.isSleepTime(),
            shouldBeActive:   this.shouldBeActive(),
            wakeUpHour:       this._wakeUpHour,
            sleepHour:        this._sleepHour,
            timezone:         this._timezone,
            dailyVariation:   this.getDailyVariation().toFixed(2),
            profile:          this._profile
                ? Object.entries(this._profile).map(([h, v]) => ({
                    hour: parseInt(h),
                    activity: Math.round(v * 100) + '%',
                    bar: '█'.repeat(Math.round(v * 20)) + '░'.repeat(20 - Math.round(v * 20)),
                }))
                : [],
        };
    },
};

// Priority levels
const MSG_PRIORITY = {
    CRITICAL:    0,  // system messages, errors
    HIGH:        1,  // owner commands
    NORMAL:      2,  // standard replies
    LOW:         3,  // broadcast, non-essential
    BACKGROUND:  4,  // auto-messages, status
};

const _SEND_QUEUE  = [];
const _SEND_STATS  = {
    totalSent:    0,
    lastMinSent:  0,
    lastHourSent: 0,
    lastDaySent:  0,
    minuteWindow: [],
    hourWindow:   [],
    dayWindow:    [],
    processing:   false,
    paused:       false,
    pauseUntil:   0,
    batchId:      0,
    consecutiveToSameJid: new Map(),
    uniqueJidsPerHour: new Set(),
    errorCount:        0,
    lastErrorTime:     0,
    _sentTimestamps:   [], // untuk Poisson analysis
};

// Safe limits berdasarkan observasi komunitas Baileys & WA research
const SAFE_LIMITS = {
    perMinute:        15,
    perHour:          200,
    perDay:           1000,
    burstMax:         3,
    sameJidPerHour:   20,    // max ke JID yang sama per jam
    uniqueJidsPerHour: 50,   // max JID unik per jam
    newJidsPerDay:     30,   // max JID baru per hari
    mediaPerHour:      30,   // max media per jam
    forwardPerHour:    10,   // max forward per jam
};

/**
 * Tambahkan pesan ke priority queue
 * @param {Function} sendFn  — async () => { ... kirim pesan ... }
 * @param {object}   meta    — { jid, text, isGroup, priority, messageType, isForward }
 * @returns {Promise} resolved saat pesan terkirim
 */
function queueSend(sendFn, meta = {}) {
    return new Promise((resolve, reject) => {
        const priority = meta.priority ?? MSG_PRIORITY.NORMAL;
        const item = {
            fn:       sendFn,
            meta,
            resolve,
            reject,
            addedAt:  Date.now(),
            priority,
            id:       crypto.randomBytes(6).toString('hex'),
            retries:  0,
            maxRetries: 2,
        };

        // Insert ke posisi yang benar berdasarkan priority
        let inserted = false;
        for (let i = 0; i < _SEND_QUEUE.length; i++) {
            if (_SEND_QUEUE[i].priority > priority) {
                _SEND_QUEUE.splice(i, 0, item);
                inserted = true;
                break;
            }
        }
        if (!inserted) _SEND_QUEUE.push(item);

        // Log queue
        forensicLog('queue_add', {
            id: item.id,
            jid: meta.jid,
            priority,
            queueLength: _SEND_QUEUE.length,
        });

        if (!_SEND_STATS.processing) _processQueue();
    });
}

async function _processQueue() {
    if (_SEND_STATS.processing) return;
    _SEND_STATS.processing = true;

    while (_SEND_QUEUE.length > 0) {
        // ── Cek pause ──
        if (_SEND_STATS.paused && Date.now() < _SEND_STATS.pauseUntil) {
            const waitMs = _SEND_STATS.pauseUntil - Date.now();
            await _sleep(waitMs);
            _SEND_STATS.paused = false;
        }

        // ── Cek circadian — sleep time? ──
        if (circadianEngine.isSleepTime() && _SEND_QUEUE[0]?.priority >= MSG_PRIORITY.LOW) {
            const sleepMs = Math.min(circadianEngine.getSleepDuration(), 3600000); // max 1 jam per check
            if (sleepMs > 60000) {
                _L.log('AntiBan', `💤 Sleep time — pause ${Math.round(sleepMs/60000)}min`);
                await _sleep(sleepMs);
                continue;
            }
        }

        // ── Cek Poisson natural timing ──
        const poissonCheck = poissonSimulator.isNaturalTimingForSend();
        if (!poissonCheck.natural && _SEND_QUEUE[0]?.priority > MSG_PRIORITY.HIGH) {
            const cooldown = poissonSimulator.nextInterArrival();
            // suppressed: Poisson cooldown — terlalu frequent
            await _sleep(Math.min(cooldown, 60000));
            continue;
        }

        // ── Cek rate limit ──
        const rateCheck = _checkSendRate();
        if (!rateCheck.allowed) {
            const waitMs = rateCheck.waitMs || 5000;
            _L.log('AntiBan', `Rate limit (${rateCheck.reason}) — ${Math.round(waitMs/1000)}s`);
            forensicLog('rate_limited', { reason: rateCheck.reason, waitMs });
            await _sleep(waitMs);
            continue;
        }

        // ── Cek same-JID limit ──
        const item = _SEND_QUEUE[0];
        if (item && item.meta.jid) {
            const sameJidCheck = _checkSameJidRate(item.meta.jid);
            if (!sameJidCheck.allowed) {
            // suppressed: same-JID skip — terlalu frequent
                _SEND_QUEUE.shift(); // remove & reject
                item.reject(new Error(sameJidCheck.reason));
                continue;
            }
        }

        const shifted = _SEND_QUEUE.shift();
        if (!shifted) break;

        // ── Hitung delay ──
        const riskLevel = banRiskScorer.getLevel();
        const isBurst   = _SEND_STATS.minuteWindow.filter(t => Date.now() - t < 10000).length < 3;
        const sessionAge = Date.now() - _HEALTH.startTime;
        const recentActivity = _SEND_STATS.minuteWindow.filter(t => Date.now() - t < 300000).length;

        const delayMs = gaussianDelay({
            textLength:     (shifted.meta.text || '').length,
            isNewContact:   shifted.meta.isNewContact || false,
            isBurst,
            riskLevel,
            isGroup:        shifted.meta.isGroup || false,
            messageType:    shifted.meta.messageType || 'text',
            sessionAge,
            recentActivity,
        });

        // Apply safe mode multiplier
        const safeMode = safeModeCheck();
        const finalDelay = safeMode.active
            ? Math.round(delayMs * safeMode.replyDelayMultiplier)
            : delayMs;

        await _sleep(finalDelay);

        // ── Send with retry ──
        try {
            await shifted.fn();
            _recordSend(shifted.meta);
            poissonSimulator.recordEvent();
            shifted.resolve();

            forensicLog('message_sent', {
                id:        shifted.id,
                jid:       shifted.meta.jid?.slice(0, 15),
                delayMs:   finalDelay,
                riskLevel,
                queueLeft: _SEND_QUEUE.length,
            });
        } catch (err) {
            _SEND_STATS.errorCount++;
            _SEND_STATS.lastErrorTime = Date.now();

            if (shifted.retries < shifted.maxRetries) {
                shifted.retries++;
                _SEND_QUEUE.unshift(shifted); // retry
                const retryDelay = _gaussianRandom(5000, 1500) * shifted.retries;
                _L.log('AntiBan', `Send gagal, retry ${shifted.retries}/${shifted.maxRetries} dalam ${Math.round(retryDelay/1000)}s`);
                await _sleep(retryDelay);
            } else {
                _L.error('AntiBan', 'Send gagal setelah retry: ' + err.message);
                shifted.reject(err);
                healthRecordError(err.message);
            }
        }

        // ── Inter-message gap (tambahan) ──
        // Setelah kirim, jeda sedikit sebelum cek queue lagi
        await _sleep(_gaussianRandom(300, 100));
    }

    _SEND_STATS.processing = false;
}

function _checkSendRate() {
    const now = Date.now();
    _SEND_STATS.minuteWindow = _SEND_STATS.minuteWindow.filter(t => now - t < 60000);
    _SEND_STATS.hourWindow   = _SEND_STATS.hourWindow.filter(t => now - t < 3600000);
    _SEND_STATS.dayWindow    = _SEND_STATS.dayWindow.filter(t => now - t < 86400000);

    const riskLevel = banRiskScorer.getLevel();
    const multiplier = { low: 1, medium: 0.6, high: 0.3, critical: 0.15 }[riskLevel] || 1;

    // Circadian multiplier juga mempengaruhi limit
    const circadian = circadianEngine.getActivityMultiplier();
    const effectiveMultiplier = multiplier * Math.max(0.2, circadian);

    const limitMin  = Math.max(2, Math.floor(SAFE_LIMITS.perMinute * effectiveMultiplier));
    const limitHour = Math.max(10, Math.floor(SAFE_LIMITS.perHour * effectiveMultiplier));
    const limitDay  = Math.max(50, Math.floor(SAFE_LIMITS.perDay * effectiveMultiplier));

    if (_SEND_STATS.minuteWindow.length >= limitMin) {
        const oldest = _SEND_STATS.minuteWindow[0];
        return { allowed: false, waitMs: 60000 - (now - oldest) + _gaussianRandom(1000, 300), reason: 'per_minute' };
    }
    if (_SEND_STATS.hourWindow.length >= limitHour) {
        const oldest = _SEND_STATS.hourWindow[0];
        return { allowed: false, waitMs: 3600000 - (now - oldest) + _gaussianRandom(5000, 1000), reason: 'per_hour' };
    }
    if (_SEND_STATS.dayWindow.length >= limitDay) {
        return { allowed: false, waitMs: _gaussianRandom(300000, 60000), reason: 'per_day' };
    }

    // Unique JIDs per hour check
    const uniqueThisHour = _SEND_STATS.uniqueJidsPerHour.size;
    if (uniqueThisHour >= SAFE_LIMITS.uniqueJidsPerHour) {
        return { allowed: false, waitMs: _gaussianRandom(120000, 30000), reason: 'unique_jids_per_hour' };
    }

    return { allowed: true };
}

function _checkSameJidRate(jid) {
    const now = Date.now();
    if (!_SEND_STATS.consecutiveToSameJid.has(jid)) {
        _SEND_STATS.consecutiveToSameJid.set(jid, []);
    }
    const times = _SEND_STATS.consecutiveToSameJid.get(jid).filter(t => now - t < 3600000);
    _SEND_STATS.consecutiveToSameJid.set(jid, times);

    if (times.length >= SAFE_LIMITS.sameJidPerHour) {
        return {
            allowed: false,
            reason:  `Max ${SAFE_LIMITS.sameJidPerHour} pesan per jam ke JID yang sama`,
        };
    }
    return { allowed: true };
}

function _recordSend(meta = {}) {
    const now = Date.now();
    _SEND_STATS.minuteWindow.push(now);
    _SEND_STATS.hourWindow.push(now);
    _SEND_STATS.dayWindow.push(now);
    _SEND_STATS.totalSent++;
    _SEND_STATS._sentTimestamps.push(now);
    if (_SEND_STATS._sentTimestamps.length > 2000) {
        _SEND_STATS._sentTimestamps = _SEND_STATS._sentTimestamps.slice(-1000);
    }

    if (meta.jid) {
        if (!_SEND_STATS.consecutiveToSameJid.has(meta.jid)) {
            _SEND_STATS.consecutiveToSameJid.set(meta.jid, []);
        }
        _SEND_STATS.consecutiveToSameJid.get(meta.jid).push(now);
        _SEND_STATS.uniqueJidsPerHour.add(meta.jid);
    }

    // Interaction graph update
    interactionGraph.recordOutbound(meta.jid, meta.isGroup);
}

// Cleanup unique JIDs setiap jam
setInterval(() => {
    _SEND_STATS.uniqueJidsPerHour.clear();
    // Cleanup same-jid maps
    const now = Date.now();
    for (const [jid, times] of _SEND_STATS.consecutiveToSameJid.entries()) {
        const fresh = times.filter(t => now - t < 3600000);
        if (fresh.length === 0) _SEND_STATS.consecutiveToSameJid.delete(jid);
        else _SEND_STATS.consecutiveToSameJid.set(jid, fresh);
    }
}, 3600000);

function pauseQueue(durationMs = 60000) {
    _SEND_STATS.paused    = true;
    _SEND_STATS.pauseUntil = Date.now() + durationMs;
    _L.log('AntiBan', `Queue di-pause ${Math.round(durationMs/1000)}s`);
    forensicLog('queue_paused', { durationMs });
}

function resumeQueue() {
    _SEND_STATS.paused    = false;
    _SEND_STATS.pauseUntil = 0;
    forensicLog('queue_resumed', {});
    if (!_SEND_STATS.processing && _SEND_QUEUE.length > 0) _processQueue();
}

function getQueueStats() {
    const now = Date.now();
    return {
        pending:     _SEND_QUEUE.length,
        paused:      _SEND_STATS.paused,
        pauseUntil:  _SEND_STATS.paused ? new Date(_SEND_STATS.pauseUntil).toLocaleString('id-ID') : null,
        perMinute:   _SEND_STATS.minuteWindow.filter(t => now - t < 60000).length,
        perHour:     _SEND_STATS.hourWindow.filter(t => now - t < 3600000).length,
        perDay:      _SEND_STATS.dayWindow.filter(t => now - t < 86400000).length,
        totalSent:   _SEND_STATS.totalSent,
        processing:  _SEND_STATS.processing,
        errorCount:  _SEND_STATS.errorCount,
        uniqueJidsThisHour: _SEND_STATS.uniqueJidsPerHour.size,
        priorities:  {
            critical: _SEND_QUEUE.filter(q => q.priority === MSG_PRIORITY.CRITICAL).length,
            high:     _SEND_QUEUE.filter(q => q.priority === MSG_PRIORITY.HIGH).length,
            normal:   _SEND_QUEUE.filter(q => q.priority === MSG_PRIORITY.NORMAL).length,
            low:      _SEND_QUEUE.filter(q => q.priority === MSG_PRIORITY.LOW).length,
            background: _SEND_QUEUE.filter(q => q.priority === MSG_PRIORITY.BACKGROUND).length,
        },
    };
}

const WARMUP_SCHEDULE = [
    { day: 1,  maxPerDay: 10,  maxPerHour: 2,  maxNewJids: 3,  description: 'Sangat konservatif' },
    { day: 2,  maxPerDay: 20,  maxPerHour: 3,  maxNewJids: 5,  description: 'Masih sangat hati-hati' },
    { day: 3,  maxPerDay: 40,  maxPerHour: 6,  maxNewJids: 8,  description: 'Mulai meningkat' },
    { day: 4,  maxPerDay: 60,  maxPerHour: 8,  maxNewJids: 12, description: 'Peningkatan gradual' },
    { day: 5,  maxPerDay: 100, maxPerHour: 12, maxNewJids: 18, description: 'Moderate' },
    { day: 6,  maxPerDay: 150, maxPerHour: 18, maxNewJids: 25, description: 'Semi-aktif' },
    { day: 7,  maxPerDay: 250, maxPerHour: 25, maxNewJids: 30, description: 'Satu minggu tercapai' },
    { day: 8,  maxPerDay: 350, maxPerHour: 35, maxNewJids: 35, description: 'Kepercayaan meningkat' },
    { day: 9,  maxPerDay: 450, maxPerHour: 45, maxNewJids: 40, description: 'Hampir normal' },
    { day: 10, maxPerDay: 550, maxPerHour: 55, maxNewJids: 42, description: 'Mendekati normal' },
    { day: 11, maxPerDay: 650, maxPerHour: 65, maxNewJids: 45, description: 'Quasi-normal' },
    { day: 12, maxPerDay: 750, maxPerHour: 75, maxNewJids: 47, description: 'Normal-' },
    { day: 13, maxPerDay: 900, maxPerHour: 90, maxNewJids: 48, description: 'Normal' },
    { day: 14, maxPerDay: 1000, maxPerHour: 100, maxNewJids: 50, description: 'Full normal' },
];

function warmupInit(botJid) {
    const db = _readJSON(WARMUP_PATH, {});
    if (!db[botJid]) {
        db[botJid] = {
            startDate:    Date.now(),
            completed:    false,
            daysSent:     {},
            hoursSent:    {},
            newJids:      {},
            knownJids:    [],
            trustScore:   0,
            violations:   0,
        };
        _writeJSON(WARMUP_PATH, db);
        _L.log('AntiBan', `🌱 Warmup dimulai untuk ${botJid.slice(0,10)}... — 14 hari`);
    }
    return db[botJid];
}

function warmupGetLimits(botJid) {
    const db   = _readJSON(WARMUP_PATH, {});
    const data = db[botJid];
    if (!data) return null;
    if (data.completed) return null;

    const daysSinceStart = Math.floor((Date.now() - data.startDate) / 86400000) + 1;
    const clampedDay     = Math.min(daysSinceStart, WARMUP_SCHEDULE.length);
    const schedule       = WARMUP_SCHEDULE[clampedDay - 1];

    if (daysSinceStart > WARMUP_SCHEDULE.length) {
        db[botJid].completed   = true;
        db[botJid].trustScore  = 100;
        _writeJSON(WARMUP_PATH, db);
        _L.log('AntiBan', `✅ Warmup selesai — Trust score: 100`); _L.update({ antiban: 'Warmup ✅ Done' });
        return null;
    }

    // Dynamic trust score (bisa turun jika ada violation)
    const baseProgress = (clampedDay / WARMUP_SCHEDULE.length) * 100;
    const violationPenalty = (data.violations || 0) * 5;
    const trustScore = Math.max(0, Math.min(100, baseProgress - violationPenalty));
    db[botJid].trustScore = trustScore;
    _writeJSON(WARMUP_PATH, db);

    // Adjust limits berdasarkan trust score
    const trustMultiplier = Math.max(0.3, trustScore / 100);

    return {
        day:            clampedDay,
        maxPerDay:      Math.floor(schedule.maxPerDay * trustMultiplier),
        maxPerHour:     Math.floor(schedule.maxPerHour * trustMultiplier),
        maxNewJids:     Math.floor(schedule.maxNewJids * trustMultiplier),
        daysLeft:       WARMUP_SCHEDULE.length - clampedDay,
        description:    schedule.description,
        trustScore,
        trustMultiplier,
    };
}

function warmupCheckAllow(botJid) {
    const limits = warmupGetLimits(botJid);
    if (!limits) return { allowed: true, warmup: false };

    const db     = _readJSON(WARMUP_PATH, {});
    const data   = db[botJid];
    const today  = new Date().toISOString().slice(0, 10);
    const todaySent = data.daysSent?.[today] || 0;

    const currentHour = new Date().toISOString().slice(0, 13);
    const hourSent = data.hoursSent?.[currentHour] || 0;

    if (todaySent >= limits.maxPerDay) {
        return {
            allowed: false,
            warmup:  true,
            reason:  `Warmup Day ${limits.day}: batas hari ini (${limits.maxPerDay}) tercapai`,
            limits,
        };
    }
    if (hourSent >= limits.maxPerHour) {
        return {
            allowed: false,
            warmup:  true,
            reason:  `Warmup Day ${limits.day}: batas jam ini (${limits.maxPerHour}) tercapai`,
            limits,
        };
    }
    return { allowed: true, warmup: true, limits, todaySent, hourSent };
}

function warmupRecordSend(botJid, targetJid = null) {
    const db   = _readJSON(WARMUP_PATH, {});
    if (!db[botJid]) return;

    const today = new Date().toISOString().slice(0, 10);
    const currentHour = new Date().toISOString().slice(0, 13);

    if (!db[botJid].daysSent) db[botJid].daysSent = {};
    if (!db[botJid].hoursSent) db[botJid].hoursSent = {};

    db[botJid].daysSent[today] = (db[botJid].daysSent[today] || 0) + 1;
    db[botJid].hoursSent[currentHour] = (db[botJid].hoursSent[currentHour] || 0) + 1;

    // Track new JIDs
    if (targetJid && !db[botJid].knownJids?.includes(targetJid)) {
        if (!db[botJid].knownJids) db[botJid].knownJids = [];
        db[botJid].knownJids.push(targetJid);
        if (!db[botJid].newJids) db[botJid].newJids = {};
        db[botJid].newJids[today] = (db[botJid].newJids[today] || 0) + 1;
    }

    // Cleanup old hoursSent (hanya simpan 48 jam terakhir)
    const oldHours = Object.keys(db[botJid].hoursSent).filter(h => {
        const hourDate = new Date(h + ':00:00');
        return Date.now() - hourDate.getTime() > 172800000; // 48 jam
    });
    oldHours.forEach(h => delete db[botJid].hoursSent[h]);

    _writeJSON(WARMUP_PATH, db);
}

function warmupRecordViolation(botJid, reason = '') {
    const db = _readJSON(WARMUP_PATH, {});
    if (!db[botJid]) return;
    db[botJid].violations = (db[botJid].violations || 0) + 1;
    _writeJSON(WARMUP_PATH, db);
    _L.error('AntiBan', `⚠️ Violation: ${reason} — Total: ${db[botJid].violations}`);
    banRiskScorer.addFactor('warmup_violation', 15);
}

function warmupGetStatus(botJid) {
    const limits = warmupGetLimits(botJid);
    if (!limits) {
        const db = _readJSON(WARMUP_PATH, {});
        return {
            active: false,
            completed: db[botJid]?.completed || false,
            trustScore: db[botJid]?.trustScore || 100,
        };
    }
    const check = warmupCheckAllow(botJid);
    return {
        active:      true,
        day:         limits.day,
        daysLeft:    limits.daysLeft,
        maxPerDay:   limits.maxPerDay,
        maxPerHour:  limits.maxPerHour,
        maxNewJids:  limits.maxNewJids,
        todaySent:   check.todaySent || 0,
        hourSent:    check.hourSent || 0,
        percentUsed: Math.round(((check.todaySent || 0) / limits.maxPerDay) * 100),
        trustScore:  limits.trustScore,
        description: limits.description,
    };
}

const _CONTENT_HISTORY = new Map();
const _CONTENT_SIMHASHES = [];
const _CONTENT_MAX     = 3;
const _CONTENT_WINDOW  = 3600000;

function contentCheckAllowed(text, jid = '__global__') {
    if (!text || text.length < 5) return { allowed: true };

    // ── Exact match check (MD5) ──
    const hash = crypto.createHash('md5').update(text.trim().toLowerCase()).digest('hex');
    const key  = `${jid}:${hash}`;
    const now  = Date.now();

    if (!_CONTENT_HISTORY.has(key)) _CONTENT_HISTORY.set(key, []);
    const times = _CONTENT_HISTORY.get(key).filter(t => now - t < _CONTENT_WINDOW);

    if (times.length >= _CONTENT_MAX) {
        banRiskScorer.addFactor('identical_content', 15);
        return {
            allowed: false,
            count:   times.length,
            reason:  `Konten identik dikirim ${times.length}x dalam 1 jam (max ${_CONTENT_MAX}x)`,
            type:    'exact',
        };
    }

    // ── SimHash similarity check ──
    const simhash  = _simHash(text);
    const similar  = _CONTENT_SIMHASHES.filter(entry => {
        if (now - entry.ts > _CONTENT_WINDOW) return false;
        const dist = _hammingDistance(simhash, entry.hash);
        return dist < 8; // < 8 bits difference = very similar
    });

    if (similar.length >= _CONTENT_MAX + 2) {
        banRiskScorer.addFactor('similar_content', 12);
        return {
            allowed:  false,
            count:    similar.length,
            reason:   `Konten MIRIP (SimHash) dikirim ${similar.length}x dalam 1 jam`,
            type:     'similar',
            distance: similar.map(s => _hammingDistance(simhash, s.hash)),
        };
    }

    // ── Entropy check — too repetitive? ──
    const entropy = _shannonEntropy(text);
    if (entropy < 2.0 && text.length > 20) {
        // Teks sangat repetitif (e.g., "hahahaha" atau "........")
        banRiskScorer.addFactor('low_entropy_content', 5);
        return {
            allowed: true, // masih allowed tapi flag warning
            warning: `Konten entropy sangat rendah (${entropy.toFixed(2)}) — mungkin repetitif`,
            entropy,
        };
    }

    return { allowed: true, count: times.length, entropy };
}

function contentRecordSend(text, jid = '__global__') {
    if (!text || text.length < 5) return;
    const hash = crypto.createHash('md5').update(text.trim().toLowerCase()).digest('hex');
    const key  = `${jid}:${hash}`;
    const now  = Date.now();
    if (!_CONTENT_HISTORY.has(key)) _CONTENT_HISTORY.set(key, []);
    const times = _CONTENT_HISTORY.get(key).filter(t => now - t < _CONTENT_WINDOW);
    times.push(now);
    _CONTENT_HISTORY.set(key, times);

    // SimHash record
    _CONTENT_SIMHASHES.push({ hash: _simHash(text), ts: now, jid });
    if (_CONTENT_SIMHASHES.length > 500) {
        const cutoff = now - _CONTENT_WINDOW;
        const fresh  = _CONTENT_SIMHASHES.filter(e => e.ts > cutoff);
        _CONTENT_SIMHASHES.length = 0;
        _CONTENT_SIMHASHES.push(...fresh);
    }
}

/**
 * Variasi konten otomatis — ENHANCED
 * Multiple teknik agar konten terlihat berbeda
 */
function contentVariate(text) {
    const strategies = [
        // Zero-width chars
        () => {
            const ZW = ['\u200b', '\u200c', '\u200d', '\u2060', '\uFEFF'];
            const positions = new Set();
            const numInserts = 1 + Math.floor(Math.random() * 3);
            for (let i = 0; i < numInserts; i++) {
                positions.add(Math.floor(Math.random() * text.length));
            }
            let result = '';
            for (let i = 0; i < text.length; i++) {
                if (positions.has(i)) result += ZW[Math.floor(Math.random() * ZW.length)];
                result += text[i];
            }
            return result;
        },
        // Unicode homoglyph substitution (invisible to human)
        () => {
            const homoglyphs = {
                'a': ['а'],  // Cyrillic а
                'e': ['е'],  // Cyrillic е
                'o': ['о'],  // Cyrillic о
                'p': ['р'],  // Cyrillic р
                ' ': [' ', ' '], // various space chars
            };
            let result = text;
            const keys = Object.keys(homoglyphs);
            const targetChar = keys[Math.floor(Math.random() * keys.length)];
            const idx = result.indexOf(targetChar);
            if (idx !== -1) {
                const replacement = homoglyphs[targetChar][Math.floor(Math.random() * homoglyphs[targetChar].length)];
                result = result.slice(0, idx) + replacement + result.slice(idx + 1);
            }
            return result;
        },
        // Add trailing whitespace variation
        () => {
            const spaces = [' ', '\t', ' ', ' '];
            return text + spaces[Math.floor(Math.random() * spaces.length)];
        },
        // Punctuation variation
        () => {
            const variations = {
                '.': ['．', '。', '·'],
                '!': ['！', '❗'],
                '?': ['？', '❓'],
                ',': ['，', '、'],
            };
            let result = text;
            for (const [original, alts] of Object.entries(variations)) {
                if (result.includes(original) && Math.random() < 0.3) {
                    const idx = result.lastIndexOf(original);
                    const alt = alts[Math.floor(Math.random() * alts.length)];
                    result = result.slice(0, idx) + alt + result.slice(idx + 1);
                    break;
                }
            }
            return result;
        },
    ];

    // Apply 1-2 random strategies
    let variated = text;
    const numStrategies = 1 + Math.floor(Math.random() * 2);
    const shuffled = strategies.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(numStrategies, shuffled.length); i++) {
        try {
            variated = shuffled[i]();
        } catch {
            // Silent
        }
    }

    return variated;
}

// Cleanup content history tiap 15 menit
setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of _CONTENT_HISTORY.entries()) {
        const fresh = arr.filter(t => now - t < _CONTENT_WINDOW);
        if (!fresh.length) _CONTENT_HISTORY.delete(k);
        else _CONTENT_HISTORY.set(k, fresh);
    }
    // Cleanup simhashes
    const cutoff = now - _CONTENT_WINDOW;
    const freshSH = _CONTENT_SIMHASHES.filter(e => e.ts > cutoff);
    _CONTENT_SIMHASHES.length = 0;
    _CONTENT_SIMHASHES.push(...freshSH);
}, 900000);

const simHashFingerprinter = {
    hash: _simHash,
    compare(textA, textB) {
        const a = _simHash(textA);
        const b = _simHash(textB);
        const dist = _hammingDistance(a, b);
        const similarity = 1 - (dist / 64);
        return {
            hashA:      a.toString(16),
            hashB:      b.toString(16),
            distance:   dist,
            similarity: Math.round(similarity * 100) + '%',
            isSimilar:  dist < 8,
        };
    },
    getRecentHashes() {
        return _CONTENT_SIMHASHES.slice(-20).map(e => ({
            hash: e.hash.toString(16),
            ts:   new Date(e.ts).toLocaleString('id-ID'),
            jid:  e.jid?.slice(0, 15),
        }));
    },
};

const messageEntropyAnalyzer = {
    _messageLog:     [],
    _maxLog:         200,
    _wordFrequency:  new Map(),
    _phraseFrequency: new Map(),

    /**
     * Record pesan dan update entropy stats
     */
    recordMessage(text) {
        if (!text || text.length < 3) return;

        this._messageLog.push({
            ts:      Date.now(),
            length:  text.length,
            entropy: _shannonEntropy(text),
            hash:    crypto.createHash('md5').update(text).digest('hex').slice(0, 8),
        });

        if (this._messageLog.length > this._maxLog) {
            this._messageLog = this._messageLog.slice(-this._maxLog);
        }

        // Word frequency analysis
        const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        for (const word of words) {
            this._wordFrequency.set(word, (this._wordFrequency.get(word) || 0) + 1);
        }

        // Phrase frequency (bigrams)
        for (let i = 0; i < words.length - 1; i++) {
            const phrase = `${words[i]} ${words[i + 1]}`;
            this._phraseFrequency.set(phrase, (this._phraseFrequency.get(phrase) || 0) + 1);
        }

        // Cleanup old entries
        if (this._wordFrequency.size > 1000) {
            const entries = [...this._wordFrequency.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 500);
            this._wordFrequency = new Map(entries);
        }
    },

    /**
     * Analisis keseluruhan — apakah pesan kita cukup bervariasi?
     */
    analyze() {
        if (this._messageLog.length < 10) return { status: 'insufficient_data' };

        const recentEntropies = this._messageLog.slice(-50).map(m => m.entropy);
        const avgEntropy  = recentEntropies.reduce((s, v) => s + v, 0) / recentEntropies.length;
        const entropyStd  = Math.sqrt(
            recentEntropies.reduce((s, v) => s + (v - avgEntropy) ** 2, 0) / recentEntropies.length
        );

        // Unique message ratio
        const recentHashes = this._messageLog.slice(-50).map(m => m.hash);
        const uniqueRatio  = new Set(recentHashes).size / recentHashes.length;

        // Top words (dominance check)
        const topWords = [...this._wordFrequency.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const totalWords = [...this._wordFrequency.values()].reduce((s, v) => s + v, 0);
        const topWordDominance = topWords.length > 0
            ? topWords[0][1] / totalWords
            : 0;

        // Risk assessment
        let risk = 'low';
        const issues = [];

        if (avgEntropy < 3.0) {
            risk = 'medium';
            issues.push('Rata-rata entropy rendah — pesan kurang bervariasi');
        }
        if (uniqueRatio < 0.6) {
            risk = risk === 'medium' ? 'high' : 'medium';
            issues.push(`Unique message ratio rendah: ${(uniqueRatio * 100).toFixed(0)}%`);
        }
        if (topWordDominance > 0.15) {
            issues.push(`Kata "${topWords[0][0]}" terlalu dominan (${(topWordDominance * 100).toFixed(0)}%)`);
        }
        if (entropyStd < 0.5 && this._messageLog.length > 30) {
            issues.push('Entropy terlalu konsisten — variasi natural kurang');
        }

        return {
            status:          risk,
            avgEntropy:      avgEntropy.toFixed(2),
            entropyStd:      entropyStd.toFixed(2),
            uniqueRatio:     (uniqueRatio * 100).toFixed(0) + '%',
            topWords:        topWords.slice(0, 5).map(([w, c]) => ({ word: w, count: c })),
            topWordDominance: (topWordDominance * 100).toFixed(1) + '%',
            issues,
            totalMessages:   this._messageLog.length,
        };
    },

    getStatus() { return this.analyze(); },
};


const _RECONNECT_STATE = {
    attempts:       0,
    windowStart:    Date.now(),
    lastAttempt:    0,
    backoffLevel:   0,
    totalLifetime:  0,
    history:        [],
    circuitOpen:    false,
    circuitOpenAt:  0,
    circuitHalfOpenAt: 0,
    successStreak:  0,
    failStreak:     0,
    _disconnectReasons: [],
};

const RECONNECT_LIMITS = {
    maxInWindow:       5,
    windowMs:          300000,
    maxBackoff:        12,
    circuitBreakerThreshold: 8,
    circuitOpenDuration:     600000, // 10 min
    circuitHalfOpenAfter:    300000, // 5 min
};

// Backoff delays (ms) — Weibull-inspired
const BACKOFF_DELAYS = [
    1000, 3000, 7000, 15000, 30000,
    60000, 120000, 300000, 600000, 1800000, 3600000, 7200000,
];

/**
 * Dipanggil setiap kali koneksi terputus
 * ENHANCED with circuit breaker pattern
 */
function reconnectGuard(reason = '') {
    const now = Date.now();
    _RECONNECT_STATE.totalLifetime++;
    _RECONNECT_STATE.failStreak++;
    _RECONNECT_STATE.successStreak = 0;
    _RECONNECT_STATE._disconnectReasons.push({ ts: now, reason: String(reason).slice(0, 100) });
    if (_RECONNECT_STATE._disconnectReasons.length > 50) {
        _RECONNECT_STATE._disconnectReasons = _RECONNECT_STATE._disconnectReasons.slice(-25);
    }

    // ── Circuit Breaker ──
    if (_RECONNECT_STATE.circuitOpen) {
        if (now - _RECONNECT_STATE.circuitOpenAt > RECONNECT_LIMITS.circuitOpenDuration) {
            // Half-open: allow one attempt
            _RECONNECT_STATE.circuitOpen = false;
            _RECONNECT_STATE.circuitHalfOpenAt = now;
            _L.setStatus('RECONNECTING'); _L.log('AntiBan', '🟡 Circuit half-open — mencoba koneksi');
        } else {
            const remainMs = RECONNECT_LIMITS.circuitOpenDuration - (now - _RECONNECT_STATE.circuitOpenAt);
            return {
                shouldReconnect: false,
                delayMs: remainMs,
                reason: `Circuit breaker OPEN — tunggu ${Math.round(remainMs/60000)} menit`,
                circuitState: 'open',
                backoffLevel: _RECONNECT_STATE.backoffLevel,
            };
        }
    }

    // Reset window jika sudah lewat
    if (now - _RECONNECT_STATE.windowStart > RECONNECT_LIMITS.windowMs) {
        _RECONNECT_STATE.attempts    = 0;
        _RECONNECT_STATE.windowStart = now;
    }

    _RECONNECT_STATE.attempts++;
    _RECONNECT_STATE.lastAttempt = now;
    _RECONNECT_STATE.history.push({
        ts: now, reason, attempt: _RECONNECT_STATE.attempts,
        backoffLevel: _RECONNECT_STATE.backoffLevel,
    });
    if (_RECONNECT_STATE.history.length > 100) _RECONNECT_STATE.history = _RECONNECT_STATE.history.slice(-50);

    // ── Check circuit breaker threshold ──
    if (_RECONNECT_STATE.failStreak >= RECONNECT_LIMITS.circuitBreakerThreshold) {
        _RECONNECT_STATE.circuitOpen   = true;
        _RECONNECT_STATE.circuitOpenAt = now;
        const lockoutMs = RECONNECT_LIMITS.circuitOpenDuration;
        _L.setStatus('OFFLINE'); _L.error('AntiBan', `🔴 CIRCUIT BREAKER OPEN! ${_RECONNECT_STATE.failStreak} failures. Lockout ${Math.round(lockoutMs/60000)}min`);
        pauseQueue(lockoutMs);
        banRiskScorer.addFactor('circuit_breaker_open', 40);
        forensicLog('circuit_breaker_open', {
            failStreak: _RECONNECT_STATE.failStreak,
            lockoutMs,
            reasons: _RECONNECT_STATE._disconnectReasons.slice(-5),
        });
        return {
            shouldReconnect: false,
            delayMs: lockoutMs,
            reason: `Circuit breaker OPEN — ${_RECONNECT_STATE.failStreak} kegagalan berturut-turut`,
            circuitState: 'open',
            backoffLevel: _RECONNECT_STATE.backoffLevel,
        };
    }

    // ── Terlalu banyak reconnect dalam window ──
    if (_RECONNECT_STATE.attempts >= RECONNECT_LIMITS.maxInWindow) {
        _RECONNECT_STATE.backoffLevel = Math.min(
            _RECONNECT_STATE.backoffLevel + 1,
            RECONNECT_LIMITS.maxBackoff - 1
        );

        // Weibull-distributed delay (more natural than pure exponential)
        const baseDelay = BACKOFF_DELAYS[_RECONNECT_STATE.backoffLevel];
        const weibullDelay = Math.round(_weibullRandom(baseDelay, 1.5));
        const jitter    = _gaussianRandom(0, weibullDelay * 0.15);
        const delayMs   = Math.min(weibullDelay + jitter, 7200000); // max 2 hours

        _L.setStatus('RECONNECTING'); _L.log('AntiBan', `⚠️ Loop #${_RECONNECT_STATE.attempts} — Backoff L${_RECONNECT_STATE.backoffLevel}: ${Math.round(delayMs/1000)}s`);

        pauseQueue(delayMs);
        banRiskScorer.addFactor('reconnect_loop', 25);

        forensicLog('reconnect_backoff', {
            attempt:     _RECONNECT_STATE.attempts,
            backoffLevel: _RECONNECT_STATE.backoffLevel,
            delayMs,
            reason,
        });

        return {
            shouldReconnect: true,
            delayMs,
            backoffLevel: _RECONNECT_STATE.backoffLevel,
            reason: `Reconnect loop L${_RECONNECT_STATE.backoffLevel} — delay ${Math.round(delayMs/1000)}s`,
            circuitState: 'closed',
        };
    }

    // Normal reconnect with gentle backoff
    const normalDelay = _gaussianRandom(3000, 800) + (_RECONNECT_STATE.backoffLevel * 1000);
    if (_RECONNECT_STATE.backoffLevel > 0) _RECONNECT_STATE.backoffLevel--;

    return {
        shouldReconnect: true,
        delayMs: normalDelay,
        backoffLevel: _RECONNECT_STATE.backoffLevel,
        reason: `Normal reconnect #${_RECONNECT_STATE.attempts}`,
        circuitState: 'closed',
    };
}

function reconnectOnSuccess() {
    _RECONNECT_STATE.attempts     = 0;
    _RECONNECT_STATE.backoffLevel = Math.max(0, _RECONNECT_STATE.backoffLevel - 2);
    _RECONNECT_STATE.windowStart  = Date.now();
    _RECONNECT_STATE.successStreak++;
    _RECONNECT_STATE.failStreak   = 0;

    if (_RECONNECT_STATE.circuitOpen || _RECONNECT_STATE.circuitHalfOpenAt > 0) {
        _RECONNECT_STATE.circuitOpen       = false;
        _RECONNECT_STATE.circuitHalfOpenAt = 0;
        banRiskScorer.removeFactor('circuit_breaker_open');
        _L.setStatus('CONNECTED'); _L.log('AntiBan', '✅ Circuit breaker closed — koneksi berhasil');
    }

    banRiskScorer.removeFactor('reconnect_loop');
    _L.setStatus('CONNECTED'); _L.log('AntiBan', `✅ Koneksi berhasil — streak: ${_RECONNECT_STATE.successStreak}`);
    forensicLog('reconnect_success', { successStreak: _RECONNECT_STATE.successStreak });
}

function reconnectGetStatus() {
    return {
        attemptsInWindow: _RECONNECT_STATE.attempts,
        backoffLevel:     _RECONNECT_STATE.backoffLevel,
        totalLifetime:    _RECONNECT_STATE.totalLifetime,
        successStreak:    _RECONNECT_STATE.successStreak,
        failStreak:       _RECONNECT_STATE.failStreak,
        circuitState:     _RECONNECT_STATE.circuitOpen ? 'open' : 'closed',
        lastAttempt:      _RECONNECT_STATE.lastAttempt
            ? new Date(_RECONNECT_STATE.lastAttempt).toLocaleString('id-ID') : '-',
        recentHistory:    _RECONNECT_STATE.history.slice(-5),
        recentDisconnectReasons: _RECONNECT_STATE._disconnectReasons.slice(-5),
    };
}


const sessionHeartbeat = {
    _intervalId:    null,
    _sock:          null,
    _lastBeat:      0,
    _beatCount:     0,
    _missedBeats:   0,
    _maxMissed:     5,
    _status:        'stopped',

    /**
     * Start heartbeat — dipanggil setelah koneksi berhasil
     * @param {object} sock - WA socket
     */
    start(sock) {
        this._sock   = sock;
        this._status = 'running';
        this._missedBeats = 0;

        if (this._intervalId) clearInterval(this._intervalId);

        // Heartbeat interval: setiap 3-7 menit (randomized)
        const scheduleNext = () => {
            const interval = _gaussianRandom(300000, 60000); // ~5min ± 1min
            this._intervalId = setTimeout(async () => {
                await this._beat();
                scheduleNext();
            }, interval);
        };

        scheduleNext();
        _L.log('AntiBan', '💓 Heartbeat started');
        forensicLog('heartbeat_started', {});
    },

    stop() {
        if (this._intervalId) {
            clearTimeout(this._intervalId);
            this._intervalId = null;
        }
        this._status = 'stopped';
        _L.log('AntiBan', 'Heartbeat stopped');
    },

    async _beat() {
        try {
            if (!this._sock) {
                this._missedBeats++;
                return;
            }

            // Berbagai tipe heartbeat (rotate agar natural)
            const beatType = this._beatCount % 5;

            switch (beatType) {
                case 0:
                    // Presence update: available
                    await this._sock.sendPresenceUpdate('available');
                    break;
                case 1:
                    // Presence update: unavailable then available (natural toggle)
                    await this._sock.sendPresenceUpdate('unavailable');
                    await _sleep(_gaussianRandom(5000, 2000));
                    await this._sock.sendPresenceUpdate('available');
                    break;
                case 2:
                    // Fetch profile picture (light query, keeps session active)
                    try {
                        await this._sock.profilePictureUrl(this._sock.user?.id, 'preview');
                    } catch { /* expected to fail sometimes */ }
                    break;
                case 3:
                    // Just presence available
                    await this._sock.sendPresenceUpdate('available');
                    break;
                case 4:
                    // Fetch status (another light query)
                    try {
                        await this._sock.fetchStatus(this._sock.user?.id);
                    } catch { /* ok */ }
                    break;
            }

            this._lastBeat = Date.now();
            this._beatCount++;
            this._missedBeats = 0;

            forensicLog('heartbeat', { type: beatType, count: this._beatCount });
        } catch (err) {
            this._missedBeats++;
            _L.error('AntiBan', `Heartbeat beat failed (missed: ${this._missedBeats}): ${err.message}`);

            if (this._missedBeats >= this._maxMissed) {
                _L.error('AntiBan', '🔴 Too many missed beats! Session mungkin dead.'); _L.setStatus('OFFLINE');
                banRiskScorer.addFactor('heartbeat_failure', 20);
                healthRecordError('Heartbeat max missed');
            }
        }
    },

    getStatus() {
        return {
            status:      this._status,
            lastBeat:    this._lastBeat ? new Date(this._lastBeat).toLocaleString('id-ID') : '-',
            beatCount:   this._beatCount,
            missedBeats: this._missedBeats,
            ageMs:       this._lastBeat ? Date.now() - this._lastBeat : 0,
        };
    },
};


const connectionTracker = {
    _latency:        [],
    _maxLatency:     200,
    _reconnects:     [],
    _errors:         [],
    _quality:        'good',
    _qualityHistory: [],

    recordLatency(ms) {
        this._latency.push({ ts: Date.now(), ms });
        if (this._latency.length > this._maxLatency) {
            this._latency = this._latency.slice(-this._maxLatency);
        }
        this._assessQuality();
    },

    recordReconnect() {
        this._reconnects.push(Date.now());
        if (this._reconnects.length > 100) this._reconnects = this._reconnects.slice(-50);
        this._assessQuality();
    },

    recordError(err) {
        this._errors.push({ ts: Date.now(), err: String(err).slice(0, 80) });
        if (this._errors.length > 100) this._errors = this._errors.slice(-50);
        this._assessQuality();
    },

    _assessQuality() {
        const now = Date.now();
        const recentLatency = this._latency.filter(l => now - l.ts < 300000);
        const recentReconnects = this._reconnects.filter(t => now - t < 600000);
        const recentErrors = this._errors.filter(e => now - e.ts < 300000);

        const avgLatency = recentLatency.length > 0
            ? recentLatency.reduce((s, l) => s + l.ms, 0) / recentLatency.length
            : 0;

        let quality;
        if (recentReconnects.length >= 3 || recentErrors.length >= 5) {
            quality = 'poor';
        } else if (avgLatency > 5000 || recentReconnects.length >= 2) {
            quality = 'degraded';
        } else if (avgLatency > 2000 || recentErrors.length >= 2) {
            quality = 'fair';
        } else {
            quality = 'good';
        }

        if (quality !== this._quality) {
            // suppressed: quality change — terlalu frequent
            this._quality = quality;
            this._qualityHistory.push({ ts: now, quality });
            if (this._qualityHistory.length > 100) {
                this._qualityHistory = this._qualityHistory.slice(-50);
            }

            // Trigger safe mode if poor
            if (quality === 'poor') {
                banRiskScorer.addFactor('poor_connection', 15);
            } else {
                banRiskScorer.removeFactor('poor_connection');
            }
        }
    },

    getQuality() { return this._quality; },

    getStatus() {
        const now = Date.now();
        const recentLatency = this._latency.filter(l => now - l.ts < 300000);
        const avgLatency = recentLatency.length > 0
            ? Math.round(recentLatency.reduce((s, l) => s + l.ms, 0) / recentLatency.length)
            : 0;

        return {
            quality:          this._quality,
            avgLatency5min:   avgLatency + 'ms',
            reconnects10min:  this._reconnects.filter(t => now - t < 600000).length,
            errors5min:       this._errors.filter(e => now - e.ts < 300000).length,
            totalLatencyPts:  this._latency.length,
            qualityHistory:   this._qualityHistory.slice(-10),
        };
    },
};

const gracefulDegradation = {
    _level:        0,  // 0 = normal, 1-5 = degraded levels
    _maxLevel:     5,
    _since:        0,
    _reason:       '',
    _autoRecover:  true,

    LEVELS: {
        0: { name: 'normal',      sendMultiplier: 1.0,  skipMedia: false, skipGroups: false, skipBroadcast: false },
        1: { name: 'light',       sendMultiplier: 0.8,  skipMedia: false, skipGroups: false, skipBroadcast: true  },
        2: { name: 'moderate',    sendMultiplier: 0.5,  skipMedia: true,  skipGroups: false, skipBroadcast: true  },
        3: { name: 'heavy',       sendMultiplier: 0.3,  skipMedia: true,  skipGroups: true,  skipBroadcast: true  },
        4: { name: 'critical',    sendMultiplier: 0.1,  skipMedia: true,  skipGroups: true,  skipBroadcast: true  },
        5: { name: 'emergency',   sendMultiplier: 0.05, skipMedia: true,  skipGroups: true,  skipBroadcast: true  },
    },

    degrade(reason = '') {
        if (this._level < this._maxLevel) {
            this._level++;
            this._since  = Date.now();
            this._reason = reason;
            const levelInfo = this.LEVELS[this._level];
            _L.error('AntiBan', `⬇️ Degraded L${this._level} (${levelInfo.name}): ${reason}`);
            forensicLog('degradation_increase', { level: this._level, reason });
        }
    },

    recover() {
        if (this._level > 0) {
            this._level--;
            const levelInfo = this.LEVELS[this._level];
            _L.log('AntiBan', `⬆️ Recovered to L${this._level} (${levelInfo.name})`);
            forensicLog('degradation_recover', { level: this._level });
        }
    },

    getCurrentLevel() {
        return this.LEVELS[this._level];
    },

    shouldProcess(meta = {}) {
        const level = this.LEVELS[this._level];
        if (level.skipBroadcast && meta.isBroadcast) return false;
        if (level.skipGroups && meta.isGroup) return false;
        if (level.skipMedia && meta.messageType && meta.messageType !== 'text') return false;

        // Probabilistic skip based on multiplier
        if (Math.random() > level.sendMultiplier) return false;

        return true;
    },

    getStatus() {
        return {
            level:       this._level,
            levelName:   this.LEVELS[this._level].name,
            since:       this._since ? new Date(this._since).toLocaleString('id-ID') : '-',
            reason:      this._reason,
            config:      this.LEVELS[this._level],
        };
    },
};

// Auto-recover setiap 10 menit jika stabil
setInterval(() => {
    if (gracefulDegradation._level > 0) {
        const connQuality = connectionTracker.getQuality();
        const riskLevel   = banRiskScorer.getLevel();
        if (connQuality === 'good' && (riskLevel === 'low' || riskLevel === 'medium')) {
            gracefulDegradation.recover();
        }
    }
}, 600000);


/**
 * Simulasi mengetik sebelum kirim pesan — ENHANCED
 * @param {object} sock   — WA socket
 * @param {string} jid    — JID tujuan
 * @param {string} text   — teks yang akan dikirim
 * @param {object} opts   — { simulate_read, composing_phases }
 */
async function simulateTyping(sock, jid, text = '', opts = {}) {
    try {
        const { simulate_read = true, composing_phases = true } = opts;

        // ── Phase 1: Simulate reading previous message ──
        if (simulate_read) {
            await sock.sendPresenceUpdate('available', jid);
            // Read time: proporsional dgn estimated incoming message
            const readTime = _gaussianRandom(1500, 500);
            await _sleep(readTime);
        }

        // ── Phase 2: "Thinking" pause before typing ──
        const thinkTime = _gaussianRandom(800, 300);
        await _sleep(thinkTime);

        if (composing_phases) {
            // ── Phase 3: Start-stop-start typing (manusia sering begini) ──
            const phases = 1 + Math.floor(Math.random() * 3); // 1-3 phases

            for (let p = 0; p < phases; p++) {
                // Start composing
                await sock.sendPresenceUpdate('composing', jid);

                // Duration proporsional dgn porsi teks
                const portionLength = text.length / phases;
                // WPM: 25-60 (variasi manusia), ~200-400ms per char
                const charSpeed = _gaussianRandom(250, 80);
                const phaseDuration = Math.min(portionLength * charSpeed, 4000);
                await _sleep(phaseDuration + _gaussianRandom(0, 300));

                // Occasional pause mid-typing
                if (p < phases - 1 && Math.random() < 0.4) {
                    await sock.sendPresenceUpdate('paused', jid);
                    // Pause: thinking, re-reading, etc
                    await _sleep(_gaussianRandom(1500, 600));
                }
            }
        } else {
            // Simple composing
            const duration = Math.min(Math.max(text.length * 25, 500), 5000);
            await sock.sendPresenceUpdate('composing', jid);
            await _sleep(duration + _gaussianRandom(0, duration * 0.15));
        }

        // ── Phase 4: Final pause before send ──
        await sock.sendPresenceUpdate('paused', jid);
        await _sleep(_gaussianRandom(400, 150));

    } catch {
        // Silent fail — typing simulation tidak kritis
    }
}

const presenceEngine = {
    _sock:           null,
    _currentState:   'unavailable',
    _stateHistory:   [],
    _intervalId:     null,
    _transitionCount: 0,

    // Natural presence transition probabilities
    // Berdasarkan research app usage patterns
    TRANSITIONS: {
        available: {
            available:   0.85,  // stay online
            unavailable: 0.15,  // go offline
        },
        unavailable: {
            available:   0.3,   // come online
            unavailable: 0.7,   // stay offline
        },
    },

    init(sock) {
        this._sock = sock;
        this._currentState = 'unavailable';

        if (this._intervalId) clearInterval(this._intervalId);

        // Presence transition check setiap 2-5 menit
        const scheduleNext = () => {
            const interval = _gaussianRandom(210000, 60000); // ~3.5min ± 1min
            this._intervalId = setTimeout(async () => {
                await this._transition();
                scheduleNext();
            }, interval);
        };

        scheduleNext();
        _L.log('AntiBan', '🟢 Presence engine started');
    },

    async _transition() {
        if (!this._sock) return;

        const hour = new Date().getHours();
        const circadianActive = circadianEngine.getActivityMultiplier(hour);

        // Adjust transition probabilities berdasarkan circadian
        let goOnlineProb;
        if (this._currentState === 'unavailable') {
            goOnlineProb = this.TRANSITIONS.unavailable.available * circadianActive;
        } else {
            goOnlineProb = this.TRANSITIONS.available.available * circadianActive;
        }

        const roll = Math.random();
        let newState;
        if (this._currentState === 'unavailable') {
            newState = roll < goOnlineProb ? 'available' : 'unavailable';
        } else {
            newState = roll < goOnlineProb ? 'available' : 'unavailable';
        }

        if (newState !== this._currentState) {
            try {
                await this._sock.sendPresenceUpdate(newState);
                this._stateHistory.push({
                    ts: Date.now(),
                    from: this._currentState,
                    to: newState,
                    circadian: circadianActive.toFixed(2),
                });
                if (this._stateHistory.length > 200) {
                    this._stateHistory = this._stateHistory.slice(-100);
                }
                this._currentState = newState;
                this._transitionCount++;
            } catch { /* silent */ }
        }
    },

    async forceOnline() {
        if (!this._sock) return;
        try {
            await this._sock.sendPresenceUpdate('available');
            this._currentState = 'available';
        } catch { /* */ }
    },

    async forceOffline() {
        if (!this._sock) return;
        try {
            await this._sock.sendPresenceUpdate('unavailable');
            this._currentState = 'unavailable';
        } catch { /* */ }
    },

    stop() {
        if (this._intervalId) {
            clearTimeout(this._intervalId);
            this._intervalId = null;
        }
    },

    getStatus() {
        return {
            currentState:    this._currentState,
            transitionCount: this._transitionCount,
            recentHistory:   this._stateHistory.slice(-10).map(h => ({
                ...h,
                ts: new Date(h.ts).toLocaleString('id-ID'),
            })),
        };
    },
};


const readReceiptSimulator = {
    _pending:   [],
    _processed: 0,

    /**
     * Queue read receipt dengan delay natural
     * @param {object} sock
     * @param {object} msg - message object dari handler
     */
    async queueRead(sock, msg) {
        if (!sock || !msg || !msg.key) return;

        const delay = this._calculateReadDelay(msg);

        this._pending.push({
            key:      msg.key,
            delay,
            addedAt:  Date.now(),
        });

        setTimeout(async () => {
            try {
                await sock.readMessages([msg.key]);
                this._processed++;
            } catch { /* silent */ }
        }, delay);
    },

    _calculateReadDelay(msg) {
        const isGroup = msg.key.remoteJid?.endsWith('@g.us');
        const hasMedia = msg.message?.imageMessage || msg.message?.videoMessage ||
                        msg.message?.audioMessage || msg.message?.documentMessage;

        let baseDelay;

        if (isGroup) {
            // Grup: baca lebih lambat (scroll)
            baseDelay = _gaussianRandom(5000, 2000);
        } else if (hasMedia) {
            // Media: butuh waktu lihat
            baseDelay = _gaussianRandom(4000, 1500);
        } else {
            // Teks biasa
            const textLength = (msg.message?.conversation ||
                               msg.message?.extendedTextMessage?.text || '').length;
            // ~40ms per karakter baca
            baseDelay = _gaussianRandom(Math.max(1500, textLength * 40), 800);
        }

        // Circadian influence
        const circadian = circadianEngine.getActivityMultiplier();
        baseDelay = Math.round(baseDelay / Math.max(0.1, circadian));

        // Kadang "belum baca" sampai lama
        if (Math.random() < 0.1) {
            baseDelay += _gaussianRandom(60000, 20000); // +1min
        }

        return Math.max(1000, Math.min(baseDelay, 300000)); // 1s - 5min
    },

    getStatus() {
        return {
            pending:   this._pending.filter(p => Date.now() - p.addedAt < p.delay).length,
            processed: this._processed,
        };
    },
};


const interactionGraph = {
    _outbound:       [],
    _inbound:        [],
    _contacts:       new Map(), // jid → { in: count, out: count, firstSeen, lastSeen }
    _groupActivity:  new Map(),
    _maxHistory:     2000,

    recordOutbound(jid, isGroup = false) {
        const now = Date.now();
        this._outbound.push(now);
        if (this._outbound.length > this._maxHistory) {
            this._outbound = this._outbound.slice(-this._maxHistory);
        }

        if (jid) {
            if (!this._contacts.has(jid)) {
                this._contacts.set(jid, { in: 0, out: 0, firstSeen: now, lastSeen: now });
            }
            const contact = this._contacts.get(jid);
            contact.out++;
            contact.lastSeen = now;
        }

        if (isGroup && jid) {
            this._groupActivity.set(jid, (this._groupActivity.get(jid) || 0) + 1);
        }
    },

    recordInbound(jid, isGroup = false) {
        const now = Date.now();
        this._inbound.push(now);
        if (this._inbound.length > this._maxHistory) {
            this._inbound = this._inbound.slice(-this._maxHistory);
        }

        if (jid) {
            if (!this._contacts.has(jid)) {
                this._contacts.set(jid, { in: 0, out: 0, firstSeen: now, lastSeen: now });
            }
            const contact = this._contacts.get(jid);
            contact.in++;
            contact.lastSeen = now;
        }
    },

    /**
     * Analisis rasio dan health interaksi
     * WA bisa detect bot dari rasio out/in yang sangat tinggi
     */
    analyze() {
        const now = Date.now();
        const oneHour = 3600000;

        const outHour = this._outbound.filter(t => now - t < oneHour).length;
        const inHour  = this._inbound.filter(t => now - t < oneHour).length;
        const ratio   = inHour > 0 ? outHour / inHour : outHour > 0 ? Infinity : 1;

        // Health assessment
        let health = 'healthy';
        const issues = [];

        // Rasio out/in > 5 = very suspicious
        if (ratio > 5 && outHour > 10) {
            health = 'suspicious';
            issues.push(`Rasio out/in terlalu tinggi: ${ratio.toFixed(1)} (${outHour} out / ${inHour} in per jam)`);
            banRiskScorer.addFactor('high_out_in_ratio', 18);
        } else if (ratio > 3 && outHour > 5) {
            health = 'warning';
            issues.push(`Rasio out/in tinggi: ${ratio.toFixed(1)}`);
            banRiskScorer.addFactor('high_out_in_ratio', 8);
        } else {
            banRiskScorer.removeFactor('high_out_in_ratio');
        }

        // Terlalu banyak kontak baru tanpa inbound
        const newContactsNoReply = [...this._contacts.entries()]
            .filter(([, c]) => c.out > 2 && c.in === 0 && now - c.firstSeen < oneHour * 24)
            .length;

        if (newContactsNoReply > 10) {
            health = health === 'suspicious' ? 'critical' : 'suspicious';
            issues.push(`${newContactsNoReply} kontak baru tanpa balasan`);
            banRiskScorer.addFactor('unreciprocated_contacts', 15);
        } else {
            banRiskScorer.removeFactor('unreciprocated_contacts');
        }

        // Unique contacts check
        const uniqueContacts = this._contacts.size;
        const activeContacts = [...this._contacts.entries()]
            .filter(([, c]) => now - c.lastSeen < oneHour * 24).length;

        return {
            health,
            outboundPerHour: outHour,
            inboundPerHour:  inHour,
            ratio:           ratio === Infinity ? '∞' : ratio.toFixed(2),
            totalContacts:   uniqueContacts,
            activeContacts,
            newContactsNoReply,
            issues,
        };
    },

    getStatus() {
        return this.analyze();
    },
};


const _RISK_FACTORS = new Map();

const RISK_FACTOR_WEIGHTS = {
    reconnect_loop:          25,
    circuit_breaker_open:    40,
    high_send_rate:          25,
    identical_content:       15,
    similar_content:         12,
    low_entropy_content:     5,
    night_activity:          5,
    new_number:              10,
    bulk_action:             20,
    error_spike:             15,
    manual_override:         50,
    high_out_in_ratio:       18,
    unreciprocated_contacts: 15,
    warmup_violation:        15,
    periodic_delay_pattern:  10,
    unnatural_delay_dist:    8,
    heartbeat_failure:       20,
    poor_connection:         15,
    anomaly_detected:        12,
    rapid_presence_changes:  8,
};

const banRiskScorer = {
    _score:         0,
    _history:       [],
    _lastCalc:      0,
    _trendWindow:   [],
    _maxHistory:    500,
    _prediction:    null,

    addFactor(name, weight = null) {
        const w = weight ?? RISK_FACTOR_WEIGHTS[name] ?? 10;
        _RISK_FACTORS.set(name, {
            weight: w,
            ts:     Date.now(),
            decayRate: 0.001, // per second
        });
        this._recalc();
    },

    removeFactor(name) {
        _RISK_FACTORS.delete(name);
        this._recalc();
    },

    _recalc() {
        const now = Date.now();

        // Factor decay: skor turun seiring waktu (natural recovery)
        for (const [k, v] of _RISK_FACTORS.entries()) {
            const ageMs = now - v.ts;
            // Expire setelah 30 menit, atau decay gradually
            if (ageMs > 1800000) {
                _RISK_FACTORS.delete(k);
            } else {
                // Gradual decay
                const decayedWeight = v.weight * Math.exp(-v.decayRate * (ageMs / 1000));
                if (decayedWeight < 1) {
                    _RISK_FACTORS.delete(k);
                }
            }
        }

        let total = 0;
        for (const [, v] of _RISK_FACTORS.entries()) {
            const ageMs = now - v.ts;
            const decayed = v.weight * Math.exp(-v.decayRate * (ageMs / 1000));
            total += decayed;
        }
        this._score = Math.min(100, Math.round(total));
        this._lastCalc = now;

        this._history.push({ ts: now, score: this._score, factors: [..._RISK_FACTORS.keys()] });
        if (this._history.length > this._maxHistory) {
            this._history = this._history.slice(-this._maxHistory);
        }

        // Trend analysis
        this._trendWindow.push(this._score);
        if (this._trendWindow.length > 30) this._trendWindow = this._trendWindow.slice(-30);
        this._updatePrediction();
    },

    _updatePrediction() {
        if (this._trendWindow.length < 5) {
            this._prediction = null;
            return;
        }

        const recent = this._trendWindow.slice(-10);
        const older  = this._trendWindow.slice(-20, -10);

        if (older.length === 0) {
            this._prediction = { trend: 'stable', confidence: 0 };
            return;
        }

        const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
        const olderAvg  = older.reduce((s, v) => s + v, 0) / older.length;
        const diff      = recentAvg - olderAvg;

        const ema = _ema(this._trendWindow, 0.2);
        const lastEma = ema[ema.length - 1];
        const prevEma = ema[ema.length - 2] || lastEma;
        const emaSlope = lastEma - prevEma;

        this._prediction = {
            trend:      diff > 3 ? 'increasing' : diff < -3 ? 'decreasing' : 'stable',
            slope:      emaSlope.toFixed(2),
            predicted5min: Math.min(100, Math.max(0, Math.round(this._score + emaSlope * 5))),
            confidence: Math.min(1, this._trendWindow.length / 20),
        };
    },

    getScore()  { this._recalc(); return this._score; },
    getLevel()  {
        const s = this.getScore();
        if (s >= 75) return 'critical';
        if (s >= 50) return 'high';
        if (s >= 25) return 'medium';
        return 'low';
    },
    getFactors() {
        const now = Date.now();
        return [..._RISK_FACTORS.entries()].map(([k, v]) => {
            const ageMs = now - v.ts;
            const decayed = v.weight * Math.exp(-v.decayRate * (ageMs / 1000));
            return {
                name:        k,
                weight:      v.weight,
                decayedWeight: Math.round(decayed * 10) / 10,
                ageSeconds:  Math.round(ageMs / 1000),
            };
        });
    },
    getPrediction() { return this._prediction; },
    getHistory()    { return this._history.slice(-20); },
    getTrend()      {
        return {
            current:    this._score,
            prediction: this._prediction,
            window:     this._trendWindow.slice(-10),
        };
    },
};

// Auto-check setiap 30 detik
setInterval(() => {
    const stats = getQueueStats();
    const now   = Date.now();

    if (stats.perMinute > SAFE_LIMITS.perMinute * 0.8)
        banRiskScorer.addFactor('high_send_rate', 25);
    else
        banRiskScorer.removeFactor('high_send_rate');

    // Night activity
    const hour = new Date().getHours();
    if (hour >= 1 && hour <= 5 && stats.perMinute > 3)
        banRiskScorer.addFactor('night_activity', 5);
    else
        banRiskScorer.removeFactor('night_activity');

    // Interaction graph check
    interactionGraph.analyze();

    // Entropy analysis
    const entropy = messageEntropyAnalyzer.analyze();
    if (entropy.status === 'high') {
        banRiskScorer.addFactor('low_message_variety', 10);
    } else {
        banRiskScorer.removeFactor('low_message_variety');
    }

    // Connection quality
    const connQ = connectionTracker.getQuality();
    if (connQ === 'poor') {
        gracefulDegradation.degrade('Poor connection quality');
    }
}, 30000);

const _SAFE_MODE = {
    active:    false,
    reason:    '',
    since:     0,
    autoUntil: 0,
    history:   [],
};

const SAFE_MODE_RULES = {
    medium:   { pauseMs: 0,      replyDelay: 1.5, skipNonEssential: false, maxPerMin: 10 },
    high:     { pauseMs: 30000,  replyDelay: 3,   skipNonEssential: true,  maxPerMin: 5  },
    critical: { pauseMs: 120000, replyDelay: 8,   skipNonEssential: true,  maxPerMin: 2  },
};

function safeModeCheck() {
    const level = banRiskScorer.getLevel();
    const rules = SAFE_MODE_RULES[level];

    // Auto-deactivate jika sudah aman
    if (!rules) {
        if (_SAFE_MODE.active && !_SAFE_MODE.reason.includes('manual')) {
            _SAFE_MODE.active = false;
            _SAFE_MODE.history.push({ ts: Date.now(), action: 'deactivated', reason: 'Risk level low' });
            _L.log('AntiBan', '🟢 Safe mode OFF (risiko rendah)');
        }
        return { active: false, level: 'low' };
    }

    if (!_SAFE_MODE.active) {
        _SAFE_MODE.active  = true;
        _SAFE_MODE.reason  = `Auto: risk level ${level}`;
        _SAFE_MODE.since   = Date.now();
        _SAFE_MODE.history.push({ ts: Date.now(), action: 'activated', reason: _SAFE_MODE.reason, level });
        _L.error('AntiBan', `🔴 Safe mode AKTIF — risk: ${level}`);

        if (rules.pauseMs > 0) pauseQueue(rules.pauseMs);
        forensicLog('safe_mode_activated', { level, rules });
    }

    return {
        active:               true,
        level,
        replyDelayMultiplier: rules.replyDelay,
        skipNonEssential:     rules.skipNonEssential,
        maxPerMin:            rules.maxPerMin,
        since:                new Date(_SAFE_MODE.since).toLocaleString('id-ID'),
        score:                banRiskScorer.getScore(),
    };
}

function safeModeActivate(reason = 'Manual', durationMs = 0) {
    _SAFE_MODE.active  = true;
    _SAFE_MODE.reason  = reason;
    _SAFE_MODE.since   = Date.now();
    _SAFE_MODE.autoUntil = durationMs ? Date.now() + durationMs : 0;
    _SAFE_MODE.history.push({ ts: Date.now(), action: 'manual_activate', reason, durationMs });
    banRiskScorer.addFactor('manual_override', 50);
    if (durationMs) pauseQueue(durationMs);
    _L.error('AntiBan', `🔴 Safe mode MANUAL: ${reason}`);
    forensicLog('safe_mode_manual', { reason, durationMs });
}

function safeModeDeactivate() {
    _SAFE_MODE.active = false;
    _SAFE_MODE.reason = '';
    _SAFE_MODE.history.push({ ts: Date.now(), action: 'manual_deactivate' });
    banRiskScorer.removeFactor('manual_override');
    resumeQueue();
    _L.log('AntiBan', '🟢 Safe mode OFF (manual)');
}

function safeModeGetStatus() {
    const mode = safeModeCheck();
    return {
        ...mode,
        reason:    _SAFE_MODE.reason,
        riskScore: banRiskScorer.getScore(),
        factors:   banRiskScorer.getFactors(),
        history:   _SAFE_MODE.history.slice(-10),
        prediction: banRiskScorer.getPrediction(),
    };
}



const anomalyDetector = {
    _baselines:    {},
    _violations:   [],
    _maxViolations: 200,
    _calibrated:   false,
    _calibrationData: {
        sendRates:    [],
        responseTimes: [],
        errorRates:   [],
        presenceChanges: [],
    },

    /**
     * Calibrate baseline — kumpulkan data normal selama 30 menit
     */
    calibrate() {
        // Setelah cukup data, hitung baseline
        const data = this._calibrationData;
        if (data.sendRates.length < 10) return;

        this._baselines = {
            sendRate: {
                mean: data.sendRates.reduce((s, v) => s + v, 0) / data.sendRates.length,
                std:  Math.sqrt(data.sendRates.reduce((s, v) => s + (v - data.sendRates.reduce((a, b) => a + b, 0) / data.sendRates.length) ** 2, 0) / data.sendRates.length),
            },
            responseTime: {
                mean: data.responseTimes.reduce((s, v) => s + v, 0) / data.responseTimes.length || 0,
                std:  0,
            },
        };

        if (this._baselines.sendRate.std > 0) {
            this._calibrated = true;
            _L.log('AntiBan', '✅ Anomaly baseline calibrated');
        }
    },

    /**
     * Feed data point dan check anomaly
     */
    checkSendRate(currentRate) {
        this._calibrationData.sendRates.push(currentRate);
        if (this._calibrationData.sendRates.length > 500) {
            this._calibrationData.sendRates = this._calibrationData.sendRates.slice(-300);
        }

        if (!this._calibrated) {
            if (this._calibrationData.sendRates.length >= 10) this.calibrate();
            return { anomaly: false, reason: 'calibrating' };
        }

        const baseline = this._baselines.sendRate;
        const z = _zScore(currentRate, baseline.mean, baseline.std);

        if (Math.abs(z) > 3.0) {
            const violation = {
                ts:     Date.now(),
                type:   'send_rate_anomaly',
                value:  currentRate,
                zScore: z.toFixed(2),
                baseline: { mean: baseline.mean.toFixed(1), std: baseline.std.toFixed(1) },
            };
            this._violations.push(violation);
            if (this._violations.length > this._maxViolations) {
                this._violations = this._violations.slice(-this._maxViolations);
            }

            banRiskScorer.addFactor('anomaly_detected', 12);
            _L.error('AntiBan', `⚠️ Anomaly: z=${z.toFixed(2)} rate=${currentRate}`);

            return { anomaly: true, z, violation };
        }

        return { anomaly: false, z };
    },

    /**
     * Check overall pattern anomalies
     */
    checkPatterns() {
        const issues = [];

        // Check delay distribution
        if (_DELAY_HISTORY.lastAutoCorr) {
            const ac = _DELAY_HISTORY.lastAutoCorr;
            if (Math.abs(ac.lag1) > 0.3) {
                issues.push({ type: 'periodic_delay', detail: `Autocorrelation lag1: ${ac.lag1.toFixed(3)}` });
            }
        }

        // Check send timing
        const sendTimestamps = _SEND_STATS._sentTimestamps.slice(-50);
        if (sendTimestamps.length >= 10) {
            const interArrivals = [];
            for (let i = 1; i < sendTimestamps.length; i++) {
                interArrivals.push(sendTimestamps[i] - sendTimestamps[i - 1]);
            }
            const ac = _autocorrelation(interArrivals, 1);
            if (Math.abs(ac) > 0.4) {
                issues.push({ type: 'periodic_send', detail: `Inter-arrival autocorrelation: ${ac.toFixed(3)}` });
            }

            // CV too low = too consistent = bot-like
            const mean = interArrivals.reduce((s, v) => s + v, 0) / interArrivals.length;
            const std = Math.sqrt(interArrivals.reduce((s, v) => s + (v - mean) ** 2, 0) / interArrivals.length);
            const cv = std / mean;
            if (cv < 0.3 && interArrivals.length > 20) {
                issues.push({ type: 'low_timing_variance', detail: `CV: ${cv.toFixed(3)} (too consistent)` });
            }
        }

        return { issues, hasAnomaly: issues.length > 0 };
    },

    getStatus() {
        return {
            calibrated:       this._calibrated,
            violationCount:   this._violations.length,
            recentViolations: this._violations.slice(-5).map(v => ({
                ...v,
                ts: new Date(v.ts).toLocaleString('id-ID'),
            })),
            baselines:        this._baselines,
            patternCheck:     this.checkPatterns(),
            dataPoints:       this._calibrationData.sendRates.length,
        };
    },
};

// Feed anomaly detector setiap menit
setInterval(() => {
    const stats = getQueueStats();
    anomalyDetector.checkSendRate(stats.perMinute);
    anomalyDetector.checkPatterns();
}, 60000);

// ═══════════════════════════════════════════════════
//  20. IDLE PERIOD SCHEDULER (ENHANCED)
//  Dengan circadian awareness dan personality model
// ═══════════════════════════════════════════════════

const _IDLE_STATE = {
    active:   false,
    until:    0,
    count:    0,
    history:  [],
};

const IDLE_SCHEDULE = {
    intervalMin:  40 * 60000,
    intervalMax:  90 * 60000,
    durationMin:  3  * 60000,
    durationMax:  10 * 60000,
    nightLonger:  true,
};

function _scheduleNextIdle() {
    const now     = Date.now();
    const hour    = new Date().getHours();
    const isNight = hour >= 23 || hour <= 5;

    const intervalMs = isNight
        ? _gaussianRandom(25 * 60000, 8 * 60000)
        : _gaussianRandom((IDLE_SCHEDULE.intervalMin + IDLE_SCHEDULE.intervalMax) / 2, 10 * 60000);

    const durationMs = isNight
        ? _gaussianRandom(20 * 60000, 5 * 60000)
        : _gaussianRandom((IDLE_SCHEDULE.durationMin + IDLE_SCHEDULE.durationMax) / 2, 2 * 60000);

    setTimeout(() => {
        const riskLevel = banRiskScorer.getLevel();
        // Don't idle during critical — kita butuh responsif
        if (!_SAFE_MODE.active && (riskLevel === 'low' || riskLevel === 'medium')) {
            _IDLE_STATE.active = true;
            _IDLE_STATE.until  = Date.now() + durationMs;
            _IDLE_STATE.count++;
            _IDLE_STATE.history.push({ ts: Date.now(), duration: durationMs });
            if (_IDLE_STATE.history.length > 100) _IDLE_STATE.history = _IDLE_STATE.history.slice(-50);

            _L.log('AntiBan', `💤 Idle ${Math.round(durationMs/60000)}min`);

            // Set presence offline during idle
            presenceEngine.forceOffline();

            setTimeout(() => {
                _IDLE_STATE.active = false;
                presenceEngine.forceOnline();
                _L.log('AntiBan', '✅ Idle selesai');
                _scheduleNextIdle();
            }, durationMs);
        } else {
            _scheduleNextIdle();
        }
    }, Math.max(30000, intervalMs)); // min 30s
}

function isInIdlePeriod() {
    if (!_IDLE_STATE.active) return false;
    if (Date.now() > _IDLE_STATE.until) {
        _IDLE_STATE.active = false;
        return false;
    }
    return true;
}

function idleGetStatus() {
    return {
        active:     _IDLE_STATE.active,
        until:      _IDLE_STATE.active ? new Date(_IDLE_STATE.until).toLocaleString('id-ID') : null,
        remaining:  _IDLE_STATE.active ? Math.round((_IDLE_STATE.until - Date.now()) / 60000) + ' menit' : null,
        totalIdles: _IDLE_STATE.count,
        history:    _IDLE_STATE.history.slice(-10).map(h => ({
            ts:       new Date(h.ts).toLocaleString('id-ID'),
            duration: Math.round(h.duration / 60000) + 'min',
        })),
    };
}

// Mulai idle scheduler
_scheduleNextIdle();

// ═══════════════════════════════════════════════════
//  21. SESSION HEALTH MONITOR (ENHANCED)
//  Comprehensive health monitoring
// ═══════════════════════════════════════════════════

const _HEALTH = {
    startTime:      Date.now(),
    connectionOk:   true,
    lastConnected:  Date.now(),
    disconnects:    0,
    errors:         [],
    warnings:       [],
    alerts:         [],
    _errorSpike:    { count: 0, windowStart: 0 },
};

function healthRecordDisconnect(reason = '') {
    _HEALTH.connectionOk    = false;
    _HEALTH.disconnects++;
    _HEALTH.lastDisconnect  = Date.now();
    if (reason) _HEALTH.errors.push({ ts: Date.now(), type: 'disconnect', reason: String(reason).slice(0, 150) });
    if (_HEALTH.errors.length > 200) _HEALTH.errors = _HEALTH.errors.slice(-100);
    connectionTracker.recordReconnect();
    forensicLog('disconnect', { reason, totalDisconnects: _HEALTH.disconnects });
}

function healthRecordConnect() {
    _HEALTH.connectionOk   = true;
    _HEALTH.lastConnected  = Date.now();
    _HEALTH.warnings = _HEALTH.warnings.filter(w => w.type !== 'disconnected');
    forensicLog('connect', {});
}

function healthRecordError(err = '') {
    const now = Date.now();
    _HEALTH.errors.push({ ts: now, type: 'error', reason: String(err).slice(0, 150) });
    if (_HEALTH.errors.length > 200) _HEALTH.errors = _HEALTH.errors.slice(-100);
    connectionTracker.recordError(err);

    // Error spike detection
    if (now - _HEALTH._errorSpike.windowStart > 300000) {
        _HEALTH._errorSpike = { count: 1, windowStart: now };
    } else {
        _HEALTH._errorSpike.count++;
    }

    if (_HEALTH._errorSpike.count >= 10) {
        banRiskScorer.addFactor('error_spike', 15);
        gracefulDegradation.degrade('Error spike detected');
    }

    forensicLog('error', { err: String(err).slice(0, 100) });
}

function healthRecordWarning(warning = '', type = 'general') {
    _HEALTH.warnings.push({ ts: Date.now(), type, warning: String(warning).slice(0, 150) });
    if (_HEALTH.warnings.length > 100) _HEALTH.warnings = _HEALTH.warnings.slice(-50);
}

function healthGetStatus() {
    const now     = Date.now();
    const uptime  = now - _HEALTH.startTime;
    const queue   = getQueueStats();
    const risk    = banRiskScorer.getScore();
    const riskLvl = banRiskScorer.getLevel();
    const warmup  = warmupGetStatus('__bot__');
    const idle    = idleGetStatus();
    const safeMode = safeModeGetStatus();
    const recon   = reconnectGetStatus();
    const recentErrors = _HEALTH.errors.filter(e => now - e.ts < 3600000).length;
    const interaction = interactionGraph.getStatus();
    const conn     = connectionTracker.getStatus();
    const degrad   = gracefulDegradation.getStatus();
    const anomaly  = anomalyDetector.getStatus();
    const heartbeat = sessionHeartbeat.getStatus();
    const presence  = presenceEngine.getStatus();
    const poisson   = poissonSimulator.getStatus();
    const circadian = circadianEngine.getStatus();
    const delayAnalytics = getDelayAnalytics();
    const entropyStatus  = messageEntropyAnalyzer.getStatus();
    const prediction = banRiskScorer.getPrediction();

    const overallStatus = !_HEALTH.connectionOk               ? 'disconnected'
        : riskLvl === 'critical'                                ? 'critical'
        : riskLvl === 'high'                                    ? 'warning'
        : degrad.level >= 3                                     ? 'degraded'
        : recentErrors > 10                                     ? 'degraded'
        : conn.quality === 'poor'                               ? 'degraded'
        : 'healthy';

    return {
        overallStatus,
        uptime:         Math.floor(uptime / 1000),
        uptimeHuman:    `${Math.floor(uptime/3600000)}j ${Math.floor((uptime%3600000)/60000)}m ${Math.floor((uptime%60000)/1000)}d`,
        connectionOk:   _HEALTH.connectionOk,
        lastConnected:  new Date(_HEALTH.lastConnected).toLocaleString('id-ID'),
        disconnects:    _HEALTH.disconnects,
        recentErrors,
        riskScore:      risk,
        riskLevel:      riskLvl,
        prediction,
        queue,
        warmup,
        idle,
        safeMode: safeMode.active ? safeMode : { active: false },
        reconnect: recon,
        factors:   banRiskScorer.getFactors(),
        interaction,
        connection: conn,
        degradation: degrad,
        anomaly:     { calibrated: anomaly.calibrated, violationCount: anomaly.violationCount },
        heartbeat,
        presence,
        poisson:     { rate: poisson.currentRate, fit: poisson.goodnessOfFit.fit },
        circadian:   { active: !circadian.isSleepTime, multiplier: circadian.activityLevel },
        delayAnalytics: { mean: delayAnalytics.mean, std: delayAnalytics.std, cv: delayAnalytics.cv?.toFixed(2) },
        entropy:     { status: entropyStatus.status },
    };
}

function healthFormatReport() {
    const h   = healthGetStatus();
    const ico = h.overallStatus === 'healthy'      ? '✅'
              : h.overallStatus === 'degraded'     ? '⚠️'
              : h.overallStatus === 'warning'      ? '🟠'
              : h.overallStatus === 'critical'     ? '🔴'
              : '⚫';

    const qBar = (n, max) => {
        const filled = Math.min(10, Math.round(n/max*10));
        return '█'.repeat(filled) + '░'.repeat(10 - filled);
    };

    const riskBar = (score) => {
        const filled = Math.min(20, Math.round(score/5));
        return '🟥'.repeat(Math.min(filled, 20)).padEnd(20, '⬜');
    };

    return `${ico} *ANTIBAN SESSION HEALTH v3.0*
${'═'.repeat(35)}

🕐 Uptime: *${h.uptimeHuman}*
🌐 Koneksi: *${h.connectionOk ? '✅ Online' : '❌ Offline'}*
🔌 Total disconnect: *${h.disconnects}x*
📡 Conn quality: *${h.connection?.quality || 'N/A'}*
💓 Heartbeat: *${h.heartbeat?.status || 'N/A'}* (${h.heartbeat?.beatCount || 0} beats)

${'─'.repeat(35)}
📊 *RISK SCORE: ${h.riskScore}/100 — ${h.riskLevel.toUpperCase()}*
${riskBar(h.riskScore)}
${h.prediction ? `📈 Trend: ${h.prediction.trend} (5min pred: ${h.prediction.predicted5min})` : ''}
${h.factors.length ? h.factors.map(f => `  ▸ ${f.name}: +${f.decayedWeight} (${f.ageSeconds}s ago)`).join('\n') : '  ✅ Tidak ada faktor aktif'}

${'─'.repeat(35)}
📤 *QUEUE STATUS*
  Pending: *${h.queue.pending}* | Paused: *${h.queue.paused ? '🔴 Ya' : '🟢 Tidak'}*
  Per menit: [${qBar(h.queue.perMinute, SAFE_LIMITS.perMinute)}] *${h.queue.perMinute}/${SAFE_LIMITS.perMinute}*
  Per jam:   [${qBar(h.queue.perHour, SAFE_LIMITS.perHour)}] *${h.queue.perHour}/${SAFE_LIMITS.perHour}*
  Per hari:  [${qBar(h.queue.perDay, SAFE_LIMITS.perDay)}] *${h.queue.perDay}/${SAFE_LIMITS.perDay}*
  JID unik: *${h.queue.uniqueJidsThisHour}/${SAFE_LIMITS.uniqueJidsPerHour}*
  Total kirim: *${h.queue.totalSent}*

${'─'.repeat(35)}
🔄 *INTERACTION GRAPH*
  Out/jam: *${h.interaction?.outboundPerHour || 0}* | In/jam: *${h.interaction?.inboundPerHour || 0}*
  Rasio: *${h.interaction?.ratio || '-'}* | Health: *${h.interaction?.health || '-'}*
${h.interaction?.issues?.length ? h.interaction.issues.map(i => `  ⚠️ ${i}`).join('\n') : '  ✅ Normal'}

${'─'.repeat(35)}
🌡️ *SUBSYSTEMS*
${h.warmup?.active ? `  🌱 Warmup: Day ${h.warmup.day}/14 | ${h.warmup.todaySent}/${h.warmup.maxPerDay} | Trust: ${h.warmup.trustScore}%` : '  🌱 Warmup: ✅ Completed'}
${h.idle.active ? `  💤 Idle: Aktif — ${h.idle.remaining}` : '  💤 Idle: Standby'}
${h.safeMode.active ? `  🔴 SafeMode: ${h.safeMode.level?.toUpperCase()} — ${h.safeMode.reason}` : '  ✅ SafeMode: Off'}
  📉 Degradation: L${h.degradation?.level || 0} (${h.degradation?.levelName || 'normal'})
  🔍 Anomaly: ${h.anomaly?.calibrated ? `Active (${h.anomaly.violationCount} violations)` : 'Calibrating...'}
  🎲 Poisson: rate=${h.poisson?.rate?.toFixed(2) || '-'}/min
  🌙 Circadian: ${h.circadian?.active ? '☀️ Active' : '🌙 Sleep'} (${h.circadian?.multiplier || '-'})
  📊 Delay stats: μ=${h.delayAnalytics?.mean || '-'}ms σ=${h.delayAnalytics?.std || '-'}ms CV=${h.delayAnalytics?.cv || '-'}
  📝 Content entropy: ${h.entropy?.status || '-'}
${h.recentErrors > 0 ? `\n⚠️ Error 1 jam terakhir: *${h.recentErrors}*` : ''}

_v3.0 Ultra • ${new Date().toLocaleString('id-ID')}_`;
}

// Simpan health snapshot tiap 5 menit
setInterval(() => {
    const h = healthGetStatus();
    _writeJSON(HEALTH_PATH, { ...h, savedAt: new Date().toISOString() });
}, 300000);


const _FORENSIC_LOG = [];
const _FORENSIC_MAX = 1000;

function forensicLog(event, data = {}) {
    const entry = {
        ts:       Date.now(),
        tsHuman:  new Date().toLocaleString('id-ID'),
        event,
        data,
        riskScore: banRiskScorer.getScore(),
        riskLevel: banRiskScorer.getLevel(),
        memory:    Math.round(process.memoryUsage().heapUsed / 1048576) + 'MB',
        pid:       process.pid,
    };

    _FORENSIC_LOG.push(entry);
    if (_FORENSIC_LOG.length > _FORENSIC_MAX) {
        // Simpan ke file sebelum truncate
        try {
            const existing = _readJSON(FORENSIC_PATH, []);
            const combined = [...existing, ..._FORENSIC_LOG.splice(0, _FORENSIC_MAX / 2)];
            _writeJSON(FORENSIC_PATH, combined.slice(-2000));
        } catch { /* */ }
    }
}

function forensicGetLog(limit = 50) {
    return _FORENSIC_LOG.slice(-limit).map(entry => ({
        ...entry,
        ts: new Date(entry.ts).toLocaleString('id-ID'),
    }));
}

function forensicSearch(eventFilter = '', since = 0) {
    return _FORENSIC_LOG
        .filter(e => {
            if (eventFilter && !e.event.includes(eventFilter)) return false;
            if (since && e.ts < since) return false;
            return true;
        })
        .slice(-100);
}


function _sleep(ms) {
    return new Promise(r => setTimeout(r, Math.max(0, ms)));
}

/**
 * Master wrapper — panggil sebelum kirim pesan apapun
 * Gabungkan SEMUA check dalam satu fungsi
 * ENHANCED: 12 layer validation
 */
async function beforeSend(opts = {}) {
    const {
        jid         = '',
        text        = '',
        isGroup     = false,
        sock        = null,
        forceTyping = false,
        essential   = false,
        messageType = 'text',
        isBroadcast = false,
        isForward   = false,
        priority    = MSG_PRIORITY.NORMAL,
    } = opts;

    const checks = [];

    // ── Layer 1: Graceful degradation ──
    if (!gracefulDegradation.shouldProcess({ isGroup, messageType, isBroadcast }) && !essential) {
        checks.push({ layer: 'degradation', pass: false });
        return { allowed: false, reason: `Degradation level ${gracefulDegradation._level}: message type skipped`, checks };
    }
    checks.push({ layer: 'degradation', pass: true });

    // ── Layer 2: Safe mode ──
    const safe = safeModeCheck();
    if (safe.active && safe.skipNonEssential && !essential) {
        checks.push({ layer: 'safeMode', pass: false });
        return { allowed: false, reason: `Safe mode aktif (${safe.level})`, checks };
    }
    checks.push({ layer: 'safeMode', pass: true });

    // ── Layer 3: Idle period ──
    if (isInIdlePeriod() && !essential) {
        checks.push({ layer: 'idle', pass: false });
        return { allowed: false, reason: 'Bot sedang idle period', checks };
    }
    checks.push({ layer: 'idle', pass: true });

    // ── Layer 4: Circadian ──
    if (circadianEngine.isSleepTime() && priority >= MSG_PRIORITY.LOW && !essential) {
        if (!circadianEngine.shouldBeActive()) {
            checks.push({ layer: 'circadian', pass: false });
            return { allowed: false, reason: 'Circadian sleep time — bot sedang "tidur"', checks };
        }
    }
    checks.push({ layer: 'circadian', pass: true });

    // ── Layer 5: Warmup ──
    const wuCheck = warmupCheckAllow('__bot__');
    if (!wuCheck.allowed) {
        checks.push({ layer: 'warmup', pass: false });
        return { allowed: false, reason: wuCheck.reason, checks };
    }
    checks.push({ layer: 'warmup', pass: true });

    // ── Layer 6: Poisson natural timing ──
    const poissonCheck = poissonSimulator.isNaturalTimingForSend();
    if (!poissonCheck.natural && !essential) {
        // Dont block, tapi tambah delay
        checks.push({ layer: 'poisson', pass: true, note: 'unnatural_timing_penalty' });
    } else {
        checks.push({ layer: 'poisson', pass: true });
    }

    // ── Layer 7: Identical content ──
    const contentCheck = contentCheckAllowed(text, jid);
    if (!contentCheck.allowed) {
        checks.push({ layer: 'content', pass: false });
        return {
            allowed:   true,
            variate:   true,
            reason:    contentCheck.reason,
            variated:  contentVariate(text),
            checks,
        };
    }
    checks.push({ layer: 'content', pass: true, entropy: contentCheck.entropy });

    // ── Layer 8: Interaction graph ──
    const interaction = interactionGraph.analyze();
    if (interaction.health === 'critical' && !essential) {
        checks.push({ layer: 'interaction', pass: false });
        return { allowed: false, reason: 'Interaction graph critical — terlalu banyak outbound tanpa inbound', checks };
    }
    checks.push({ layer: 'interaction', pass: true, health: interaction.health });

    // ── Layer 9: Connection quality ──
    const connQuality = connectionTracker.getQuality();
    if (connQuality === 'poor' && priority >= MSG_PRIORITY.NORMAL && !essential) {
        checks.push({ layer: 'connection', pass: false });
        return { allowed: false, reason: 'Connection quality poor — menunggu stabilisasi', checks };
    }
    checks.push({ layer: 'connection', pass: true, quality: connQuality });

    // ── Layer 10: Anomaly ──
    const anomalyPattern = anomalyDetector.checkPatterns();
    if (anomalyPattern.hasAnomaly) {
        // Don't block, tapi flag
        checks.push({ layer: 'anomaly', pass: true, note: 'pattern_anomaly_detected', issues: anomalyPattern.issues });
    } else {
        checks.push({ layer: 'anomaly', pass: true });
    }

    // ── Layer 11: Typing simulation ──
    if (sock && (forceTyping || text.length > 30)) {
        await simulateTyping(sock, jid, text, {
            simulate_read: true,
            composing_phases: text.length > 100,
        });
    }
    checks.push({ layer: 'typing', pass: true });

    // ── Layer 12: Record & finalize ──
    contentRecordSend(text, jid);
    warmupRecordSend('__bot__', jid);
    messageEntropyAnalyzer.recordMessage(text);
    poissonSimulator.recordEvent();

    const delayMs = gaussianDelay({
        textLength:     text.length,
        riskLevel:      banRiskScorer.getLevel(),
        isGroup,
        messageType,
        sessionAge:     Date.now() - _HEALTH.startTime,
        recentActivity: _SEND_STATS.minuteWindow.filter(t => Date.now() - t < 300000).length,
    });

    // Apply safe mode multiplier
    const finalDelay = safe.active
        ? Math.round(delayMs * safe.replyDelayMultiplier)
        : delayMs;

    checks.push({ layer: 'delay', pass: true, delayMs: finalDelay });

    forensicLog('before_send_passed', {
        jid: jid?.slice(0, 15),
        layers: checks.length,
        delay: finalDelay,
        risk: banRiskScorer.getLevel(),
    });

    return { allowed: true, delayMs: finalDelay, variate: false, checks };
}

/**
 * Initialize all subsystems — panggil saat bot start
 */
function initializeAll(sock, botJid) {
    _L.log('AntiBan', '🛡️ Anti-ban Session System v3.0 — Initializing 22 subsystems...');

    // 1. Circadian
    circadianEngine.init();

    // 2. Warmup
    warmupInit(botJid || '__bot__');

    // 3. Heartbeat
    if (sock) sessionHeartbeat.start(sock);

    // 4. Presence
    if (sock) presenceEngine.init(sock);

    // 5. Connection OK
    healthRecordConnect();
    reconnectOnSuccess();

    // Log
    forensicLog('system_init', {
        botJid,
        subsystems: 22,
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch(),
        memory: Math.round(os.totalmem() / 1048576) + 'MB',
    });

    _L.log('AntiBan', `✅ All 22 subsystems ready — Risk: ${banRiskScorer.getLevel()} (${banRiskScorer.getScore()}/100) | ${circadianEngine.isSleepTime() ? '🌙 Sleep' : '☀️ Active'} | Warmup: ${warmupGetStatus(botJid || '__bot__').active ? 'Active' : 'Done'}`);
    _L.update({ antiban: `Risk:${banRiskScorer.getScore()}/100` });
}


module.exports = {
    // === Layer 1: Timing & Delay ===
    gaussianDelay,
    getDelayAnalytics,
    poissonSimulator,
    circadianEngine,

    // === Layer 2: Message Control ===
    queueSend,
    pauseQueue,
    resumeQueue,
    getQueueStats,
    MSG_PRIORITY,

    // === Layer 3: Warmup ===
    warmupInit,
    warmupGetLimits,
    warmupCheckAllow,
    warmupRecordSend,
    warmupRecordViolation,
    warmupGetStatus,

    // === Layer 4: Content ===
    contentCheckAllowed,
    contentRecordSend,
    contentVariate,
    simHashFingerprinter,
    messageEntropyAnalyzer,

    // === Layer 5: Session Stability ===
    reconnectGuard,
    reconnectOnSuccess,
    reconnectGetStatus,
    sessionHeartbeat,
    connectionTracker,
    gracefulDegradation,

    // === Layer 6: Behavioral Mimicry ===
    simulateTyping,
    presenceEngine,
    readReceiptSimulator,
    interactionGraph,

    // === Layer 7: Risk Management ===
    banRiskScorer,
    safeModeCheck,
    safeModeActivate,
    safeModeDeactivate,
    safeModeGetStatus,
    anomalyDetector,

    // === Layer 8: Scheduling ===
    isInIdlePeriod,
    idleGetStatus,

    // === Layer 9: Monitoring ===
    healthRecordDisconnect,
    healthRecordConnect,
    healthRecordError,
    healthRecordWarning,
    healthGetStatus,
    healthFormatReport,

    // === Layer 10: Forensic ===
    forensicLog,
    forensicGetLog,
    forensicSearch,

    // === Master Functions ===
    beforeSend,
    initializeAll,

    // === Constants ===
    SAFE_LIMITS,
    WARMUP_SCHEDULE,
    BACKOFF_DELAYS,

    // === Math Utilities (exposed for testing) ===
    _gaussianRandom,
    _poissonRandom,
    _exponentialRandom,
    _simHash,
    _hammingDistance,
    _shannonEntropy,
    _ksTestNormality,
    _autocorrelation,
};
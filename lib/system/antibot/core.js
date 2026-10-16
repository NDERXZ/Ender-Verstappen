'use strict';

const db             = require('./database');
const authDetector   = require('./authClientDetector');
const trafficAna     = require('./trafficAnalyzer');
const entropyAna     = require('./entropyAnalyzer');
const behaviorTrack  = require('./behaviorTracker');
const reporter       = require('./reporter');

const SCORE_LEVELS = [
    { min: 85, level: 'CONFIRMED' },
    { min: 70, level: 'WARN' },
    { min: 50, level: 'SUSPECT' },
    { min: 25, level: 'MONITOR' },
    { min: 0,  level: 'CLEAN' },
];

function _getLevel(score) {
    for (const { min, level } of SCORE_LEVELS) {
        if (score >= min) return level;
    }
    return 'CLEAN';
}

async function scan(msg, chatId, senderJid, opts) {
    opts = opts || {};


    if (db.isWhitelisted(senderJid)) return { passed: true, score: 0, level: 'CLEAN' };
    const groupCfg = chatId && chatId.endsWith('@g.us') ? db.getGroupConfig(chatId) : { enabled: false };
    if (!groupCfg.enabled && !opts.forceCheck) return { passed: true, score: 0, level: 'CLEAN' };

    db.incStats('total_scanned');

    const sensitivity = { low: 0.6, medium: 1.0, high: 1.4 }[groupCfg.sensitivity || 'medium'] || 1.0;
    behaviorTrack.ensureClient(senderJid);
    behaviorTrack.record(senderJid, 'message');
    trafficAna.recordMessage(senderJid);
    const msgText = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
    entropyAna.addMessage(senderJid, msgText);

    const layer6 = authDetector.analyzeMessage(msg, null);
    const layer6j = authDetector.analyzeJid(senderJid);
    const layer7  = trafficAna.analyzeTimingPattern(senderJid);
    const layer8  = entropyAna.analyzeEntropy(senderJid, msgText);

    const allSignals  = [...layer6.signals, ...layer6j.signals, ...layer7.signals, ...layer8.signals];
    const rawScore    = layer6.weight + layer6j.weight + layer7.weight + layer8.weight;
    const score       = Math.min(100, Math.round(rawScore * sensitivity));
    const level       = _getLevel(score);
    const clientType  = layer6.clientType;
    const confidence  = layer6.confidence;
    const prev = db.getClient(senderJid) || {};
    const newScore = Math.min(100, Math.round((prev.score || 0) * 0.7 + score * 0.3)); // weighted rolling
    const newLevel = _getLevel(newScore);

    db.upsertClient(senderJid, {
        score:      newScore,
        level:      newLevel,
        clientType: clientType || prev.clientType,
        confidence: confidence || prev.confidence,
    });

    for (const sig of allSignals) {
        db.addEvidence(senderJid, sig);
    }

    const prevLevel = prev.level || 'CLEAN';
    if (newLevel !== prevLevel && ['SUSPECT','WARN','CONFIRMED'].includes(newLevel)) {
        db.incStats('detected');
        reporter.notifyOwnerSilent(senderJid, db.getClient(senderJid));
    }
    const result = { passed: true, score: newScore, level: newLevel, signals: allSignals, clientType };

    if (newLevel === 'WARN' || newLevel === 'CONFIRMED') {
        const client = db.getClient(senderJid);
        const warns  = (client.warns || 0);

        if (newLevel === 'CONFIRMED' && groupCfg.action === 'kick') {
            result.action = 'kick';
            result.passed = false;
        } else if (warns >= (groupCfg.warnLimit || 3) && groupCfg.action === 'kick') {
            result.action = 'kick';
            result.passed = false;
        } else if (newLevel !== prevLevel) {
            result.action  = 'warn';
            result.warnMsg =
                '⚠️ *[AntiBot] Bot Terdeteksi!*\n\n' +
                '┃ JID: ' + senderJid.split('@')[0] + '\n' +
                '┃ Score: ' + newScore + '/100\n' +
                '┃ Level: ' + newLevel + '\n' +
                '┃ Tipe: ' + (clientType || 'Unknown') + '\n\n' +
                '_Bot terdeteksi berdasarkan analisis multi-layer._';
            db.upsertClient(senderJid, { warns: warns + 1 });
        }
    }

    return result;
}

async function manualScan(senderJid, sock, chatId) {
    behaviorTrack.ensureClient(senderJid);
    const layer6j = authDetector.analyzeJid(senderJid);
    const layer7  = trafficAna.analyzeTimingPattern(senderJid);
    const hist    = db.getClient(senderJid);

    const rawScore  = layer6j.weight + layer7.weight;
    const score     = Math.min(100, rawScore);
    const level     = _getLevel(score);

    db.upsertClient(senderJid, { score, level });

    return {
        jid:        senderJid,
        score,
        level,
        signals:    [...layer6j.signals, ...layer7.signals],
        clientType: hist?.clientType || 'Unknown',
        confidence: hist?.confidence || 0,
        warns:      hist?.warns || 0,
    };
}

module.exports = { scan, manualScan };

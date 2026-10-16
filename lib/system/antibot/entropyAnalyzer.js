'use strict';

const { BEHAVIOR_WEIGHTS } = require('./signatures');

const _history = new Map(); // jid → string[]

function _shannonEntropy(str) {
    if (!str || str.length === 0) return 0;
    const freq = {};
    for (const c of str) freq[c] = (freq[c] || 0) + 1;
    let e = 0;
    const len = str.length;
    for (const count of Object.values(freq)) {
        const p = count / len;
        e -= p * Math.log2(p);
    }
    return e;
}

function _vocabDiversity(msgs) {
    if (!msgs.length) return 1;
    const words = msgs.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (!words.length) return 1;
    const unique = new Set(words).size;
    return unique / words.length; // 0..1, higher = more diverse
}

function _emojiTemplateScore(msgs) {
    if (msgs.length < 3) return 0;
    const emojiPattern = /[\u{1F300}-\u{1FFFF}]/gu;
    const sequences = msgs.map(m => (m.match(emojiPattern) || []).join(''));
    const unique = new Set(sequences).size;
    return 1 - (unique / sequences.length); // 0 = all different (human), 1 = all same (bot)
}

function _isTemplateMessage(text) {
    const templatePatterns = [
        /^(halo|hello|hi)\s+kak\s+\*/i,
        /╭[┈─]+⬡/,
        /╰[┈─]+⬡/,
        /\[ [\w\s]+ \]/,
        /\*\[.*\]\*/,
        /^[🎉✅❌⚠️🔴🟢]\s*\*/,
    ];
    return templatePatterns.some(re => re.test(text));
}

function addMessage(jid, text) {
    if (!text || text.length < 2) return;
    const hist = _history.get(jid) || [];
    hist.push(text.slice(0, 200));
    if (hist.length > 20) hist.splice(0, hist.length - 20);
    _history.set(jid, hist);
}

function analyzeEntropy(jid, currentText) {
    const signals = [];
    let weight    = 0;

    try {
        const hist = _history.get(jid) || [];

        const entropy = _shannonEntropy(currentText || '');
        if (entropy < 2.0 && (currentText || '').length > 10) {
            const w = BEHAVIOR_WEIGHTS.lowEntropyScore;
            signals.push({ layer: 8, signal: 'low_entropy_' + entropy.toFixed(2), weight: w });
            weight += w;
        }

        if (hist.length >= 5) {
            const div = _vocabDiversity(hist);
            if (div < 0.20) {
                const w = BEHAVIOR_WEIGHTS.repetitiveVocab;
                signals.push({ layer: 8, signal: 'low_vocab_diversity_' + div.toFixed(2), weight: w });
                weight += w;
            }
        }
        if (hist.length >= 3) {
            const emojiScore = _emojiTemplateScore(hist);
            if (emojiScore > 0.8) {
                const w = BEHAVIOR_WEIGHTS.emojiTemplated;
                signals.push({ layer: 8, signal: 'emoji_template_score_' + emojiScore.toFixed(2), weight: w });
                weight += w;
            }
        }


        if (_isTemplateMessage(currentText || '')) {
            signals.push({ layer: 8, signal: 'template_message_structure', weight: 12 });
            weight += 12;
        }

        if (hist.length >= 5) {
            const lengths = hist.map(m => m.length);
            const avg = lengths.reduce((a,b) => a+b, 0) / lengths.length;
            const variance = lengths.reduce((a,b) => a + Math.pow(b-avg, 2), 0) / lengths.length;
            const cv = avg > 0 ? Math.sqrt(variance) / avg : 0;
            if (cv < 0.10 && avg > 5) {
                signals.push({ layer: 8, signal: 'fixed_message_length_cv_' + cv.toFixed(2), weight: 10 });
                weight += 10;
            }
        }

    } catch {}

    return { signals, weight };
}

function cleanup() {
    const keys = [..._history.keys()];
    if (keys.length > 500) {
        for (const k of keys.slice(0, keys.length - 400)) _history.delete(k);
    }
}

if (!global._AB_ENTROPY_CLEANUP) {
    global._AB_ENTROPY_CLEANUP = true;
    setInterval(cleanup, 60 * 60 * 1000).unref?.();
}

module.exports = { addMessage, analyzeEntropy };

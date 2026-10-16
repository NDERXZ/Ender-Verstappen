'use strict';

const CLIENT_SIGNATURES = {
    baileys: {
        label:          'Baileys',
        browserTokens:  [['Ubuntu','Chrome','10.15.7'],['Ubuntu','Firefox','10.15.7']],
        preKeyBatch:    31,
        keepAliveMs:    20000,
        regIdRange:     [1, 16383],
        userAgentRe:    /Baileys/i,
        confidence:     0.85,
    },
    'whatsapp-web.js': {
        label:          'whatsapp-web.js',
        browserTokens:  [['Chrome','Chrome','10.15.7']],
        preKeyBatch:    100,
        signalVersion:  '5.38.2',
        userAgentRe:    /whatsapp-web/i,
        confidence:     0.80,
    },
    'go-whatsapp': {
        label:          'go-whatsapp',
        browserTokens:  [['Go','Go','1.0'],['Go','Go','0.1']],
        preKeyBatch:    50,
        handshakePattern: 'IK',
        confidence:     0.75,
    },
    'wppconnect': {
        label:          'WPPConnect',
        browserTokens:  [['WPPConnect','1.0.0']],
        userAgentRe:    /wppconnect/i,
        confidence:     0.78,
    },
    'whatsmeow': {
        label:          'Whatsmeow',
        browserTokens:  [['Go','Go','0.1']],
        preKeyBatch:    200,
        confidence:     0.72,
    },
};

const SUSPICIOUS_JID_PATTERNS = [
    /^628\d{9,12}$/, // typical bot number pattern (generik)
];

const BEHAVIOR_WEIGHTS = {
    preKeyBatchMismatch:    40,
    readReceiptInstant:     25,
    lowEntropyScore:        22,
    browserTokenMatch:      35,
    userAgentMatch:         30,
    typingFixed:            18,
    alwaysOnline:           15,
    burstMessages:          20,
    zeroLatencyResponse:    28,
    repetitiveVocab:        18,
    emojiTemplated:         12,
    regIdRangeMatch:        20,
    keepAliveMismatch:      15,
};

module.exports = { CLIENT_SIGNATURES, SUSPICIOUS_JID_PATTERNS, BEHAVIOR_WEIGHTS };

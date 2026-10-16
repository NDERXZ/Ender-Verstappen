'use strict';

const db = require('./database');

function record(jid, event, meta) {
    db.addTimeline(jid, {
        ts:    Date.now(),
        event: event,
        meta:  meta || null,
    });
}

function ensureClient(jid) {
    if (!db.getClient(jid)) {
        db.upsertClient(jid, { score: 0, level: 'CLEAN' });
    }
}

function getTimeline(jid) {
    const c = db.getClient(jid);
    return c ? (c.timeline || []) : [];
}

function getMessageFrequency(jid, windowMs) {
    const timeline = getTimeline(jid);
    const cutoff   = Date.now() - (windowMs || 3600000);
    return timeline.filter(e => e.ts >= cutoff && e.event === 'message').length;
}

module.exports = { record, ensureClient, getTimeline, getMessageFrequency };

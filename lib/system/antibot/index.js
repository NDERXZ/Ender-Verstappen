'use strict';

const core    = require('./core');
const db      = require('./database');
const reporter= require('./reporter');
const behavior= require('./behaviorTracker');

function init(ownerNotifyFn) {
    if (ownerNotifyFn) reporter.setNotifyFn(ownerNotifyFn);
    db.cleanOld(7);
    console.log('[AntiBot] ✅ System initialized');
}

module.exports = {
    init,
    scan:            core.scan,
    manualScan:      core.manualScan,
    setNotifyFn:     reporter.setNotifyFn,
    generateReport:  reporter.generateDailyReport,
    isWhitelisted:   db.isWhitelisted,
    isBlacklisted:   db.isBlacklisted,
    setWhitelist:    db.setWhitelist,
    setBlacklist:    db.setBlacklist,
    getGroupConfig:  db.getGroupConfig,
    setGroupConfig:  db.setGroupConfig,
    getSuspects:     db.getSuspects,
    getClient:       db.getClient,
    getTimeline:     behavior.getTimeline,
    getDB:           db.getDB,
};

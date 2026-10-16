
const {
    gsLoadAll, gsSaveAll,
    gsGet: _gsGet, gsSet: _gsSet,
    gsAddWarn: _gsAddWarn, gsResetWarn: _gsResetWarn, gsResetAllWarn: _gsResetAllWarn,
    gsMute: _gsMute, gsUnmute: _gsUnmute,
    gsAddWL: _gsAddWL, gsRemWL: _gsRemWL,
    GS_DEFAULT,
} = require('./db');

function loadDB() {
    return gsLoadAll();
}

function saveDB(data) {
    gsSaveAll(data);
}
function getDefaults() {
    return GS_DEFAULT();
}

function getGroup(groupId) {
    return _gsGet(groupId);
}

function setGroup(groupId, updates) {
    return _gsSet(groupId, updates);
}

function getSetting(groupId, key) {
    const group = getGroup(groupId);
    return group[key];
}

function setSetting(groupId, key, value) {
    return setGroup(groupId, { [key]: value });
}

function toggleSetting(groupId, key) {
    const current = getSetting(groupId, key);
    setSetting(groupId, key, !current);
    return !current;
}

function addWarning(groupId, userId) {
    return _gsAddWarn(groupId, userId);
}

function resetWarning(groupId, userId) {
    _gsResetWarn(groupId, userId);
}

function resetAllWarnings(groupId) {
    _gsResetAllWarn(groupId);
}

function getWarnings(groupId) {
    const group = getGroup(groupId);
    return group.warnings || {};
}

function getUserWarn(groupId, userId) {
    const group = getGroup(groupId);
    return (group.warnings || {})[userId] || 0;
}

function addMuted(groupId, userId) {
    _gsMute(groupId, userId);
}

function removeMuted(groupId, userId) {
    _gsUnmute(groupId, userId);
}

function isMuted(groupId, userId) {
    const group = getGroup(groupId);
    return (group.muted || []).includes(userId);
}

function getMutedList(groupId) {
    const group = getGroup(groupId);
    return group.muted || [];
}

function addWhitelistLink(groupId, domain) {
    return _gsAddWL(groupId, domain);
}

function removeWhitelistLink(groupId, domain) {
    return _gsRemWL(groupId, domain);
}

function getWhitelistLinks(groupId) {
    const group = getGroup(groupId);
    return group.antilinkWhitelist || [];
}

module.exports = {
    loadDB, saveDB, getDefaults,
    getGroup, setGroup, getSetting, setSetting, toggleSetting,
    addWarning, resetWarning, resetAllWarnings, getWarnings, getUserWarn,
    addMuted, removeMuted, isMuted, getMutedList,
    addWhitelistLink, removeWhitelistLink, getWhitelistLinks,
};

'use strict';

const db = require('./database');

let _ownerNotifyFn = null;

function setNotifyFn(fn) { _ownerNotifyFn = fn; }

async function _notify(text) {
    if (typeof _ownerNotifyFn === 'function') {
        try { await _ownerNotifyFn(text); } catch {}
    }
}

function _levelEmoji(level) {
    const map = { CLEAN: '✅', MONITOR: '👀', SUSPECT: '⚠️', WARN: '🔴', CONFIRMED: '🚨' };
    return map[level] || '❓';
}

async function notifyOwnerSilent(jid, client) {
    if (client.score < 50) return;
    const text =
        '🤖 *[AntiBot] Suspect Terdeteksi*\n\n' +
        '╔═ 🔍 *ᴅᴇᴛᴀɪʟ* ✦\n' +
        '║ » JID: ' + jid.split('@')[0] + '\n' +
        '║ » Score: ' + client.score + '/100\n' +
        '║ » Level: ' + _levelEmoji(client.level) + ' ' + client.level + '\n' +
        '║ » Tipe: ' + (client.clientType || 'Unknown') + '\n' +
        '║ » Confidence: ' + Math.round((client.confidence || 0) * 100) + '%\n' +
        '╚═════\n\n' +
        '_Gunakan .antibot log untuk detail_';
    await _notify(text);
}

async function generateDailyReport() {
    const data     = db.getDB();
    const suspects = db.getSuspects(25);
    const stats    = data.stats || {};
    const accuracy = stats.total_scanned > 0
        ? ((stats.detected - (stats.false_positive || 0)) / stats.detected * 100).toFixed(1)
        : 'N/A';

    const reportText =
        '📊 *[AntiBot] Laporan Harian*\n\n' +
        '╔═ 📈 *sᴛᴀᴛɪsᴛɪᴋ* ✦\n' +
        '║ » Total dipindai: ' + (stats.total_scanned || 0) + '\n' +
        '║ » Terdeteksi: ' + (stats.detected || 0) + '\n' +
        '║ » False positive: ' + (stats.false_positive || 0) + '\n' +
        '║ » Akurasi: ' + accuracy + '%\n' +
        '╚═════\n\n' +
        '╔═ 🚨 *sᴜsᴘᴇᴄᴛ ᴛᴇʀᴅᴇᴛᴇᴋsɪ* ✦\n' +
        (suspects.length
            ? suspects.slice(0, 5).map(c =>
                '║ » ' + c.jid.split('@')[0] + ' → ' + c.score + 'pt [' + c.level + '] ' + (c.clientType || '?')
            ).join('\n')
            : '║ » Tidak ada suspect aktif') + '\n' +
        '╚═════';

    await _notify(reportText);

    const data2 = db.getDB();
    data2.lastReport = new Date().toISOString();
    db.saveDB(data2);

    return reportText;
}

// Jadwalkan daily report jam 08:00 WIB
if (!global._AB_REPORT_TIMER) {
    global._AB_REPORT_TIMER = true;
    setInterval(async () => {
        const h = new Date().toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' });
        if (parseInt(h) === 8) await generateDailyReport();
    }, 60 * 60 * 1000).unref?.();
}

module.exports = { setNotifyFn, notifyOwnerSilent, generateDailyReport };

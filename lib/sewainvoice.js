'use strict';
const {
    loadInvoice  : _loadInvoice,
    saveInvoice  : _saveInvoice,
    addInvoice   : _addInvoice,
    updateInvoiceStatus,
    loadReminder : _loadReminder,
    saveReminder : _saveReminder,
} = require('./db');
const PAKET_HARGA = {
    basic   : { harga: 15000,  label: 'Basic',    fitur: ['Menu Lengkap', 'Anti-Link', 'Anti-Toxic', 'Welcome/Goodbye', 'Anti-Spam'] },
    premium : { harga: 25000,  label: 'Premium',  fitur: ['Semua Basic', 'Anti-NSFW', 'OCR Scan', 'Statistik Grup', 'Anti-Raid', 'Slow Mode'] },
    vip     : { harga: 40000,  label: 'VIP',      fitur: ['Semua Premium', 'AI Auto-Reply', 'Priority Support', 'Custom Threshold NSFW', 'Semua Fitur'] },
    lifetime: { harga: 150000, label: 'Lifetime', fitur: ['Semua VIP', 'Tidak Perlu Perpanjang', 'Harga Terbaik'] },
};

const _fmtRp   = (n) => 'Rp ' + n.toLocaleString('id-ID');
const _fmtDate = (ts) => ts
    ? new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-';
const _genId   = () => 'INV-' + Date.now().toString(36).toUpperCase();
const generateInvoice = ({ groupId, groupName, paket, days, addedBy, namaBot = 'Bot', namaOwner = 'Owner', ownerNum = '' }) => {
    const paketData  = PAKET_HARGA[paket] || PAKET_HARGA.basic;
    const isLifetime = days === 0 || paket === 'lifetime';
    const now        = Date.now();
    const expiry     = isLifetime ? null : now + (days * 86400000);
    const invoiceId  = _genId();

    const invoice = {
        id          : invoiceId,
        groupId,
        groupName   : groupName || groupId.split('@')[0],
        paket,
        paketLabel  : paketData.label,
        harga       : paketData.harga,
        days,
        isLifetime,
        createdAt   : now,
        expiry,
        addedBy,
        status      : 'active',
        namaBot,
        namaOwner,
        ownerNum,
        remindersSent: [],
    };

    _addInvoice(invoice);

    return invoice;
};
const formatInvoiceText = (inv) => {
    const paketData = PAKET_HARGA[inv.paket] || PAKET_HARGA.basic;
    const fiturList = paketData.fitur.map(f => `   ✓ ${f}`).join('\n');
    const separator = '─'.repeat(28);

    return (
        `🧾 *INVOICE SEWA BOT*\n${separator}\n\n` +
        `🆔 *No. Invoice :* \`${inv.id}\`\n` +
        `📱 *Nama Bot    :* ${inv.namaBot}\n` +
        `👥 *Grup        :* ${inv.groupName}\n\n` +
        `${separator}\n` +
        `📦 *DETAIL PAKET*\n${separator}\n\n` +
        `📌 Paket   : *${inv.paketLabel.toUpperCase()}*\n` +
        `💰 Harga   : *${_fmtRp(inv.harga)}*\n` +
        `⏳ Durasi  : *${inv.isLifetime ? 'Lifetime ♾️' : inv.days + ' hari'}*\n\n` +
        `📋 *Fitur yang Didapat:*\n${fiturList}\n\n` +
        `${separator}\n` +
        `📅 *INFO WAKTU*\n${separator}\n\n` +
        `🗓️ Mulai    : ${_fmtDate(inv.createdAt)}\n` +
        `${inv.isLifetime ? '♾️ Berakhir : *Tidak ada batas*' : `⏰ Berakhir : *${_fmtDate(inv.expiry)}*`}\n\n` +
        `${separator}\n` +
        `💳 *PEMBAYARAN*\n${separator}\n\n` +
        `🏦 Transfer ke owner:\n` +
        `👑 ${inv.namaOwner}${inv.ownerNum ? ` — wa.me/${inv.ownerNum}` : ''}\n\n` +
        `_Invoice ini otomatis dibuat oleh ${inv.namaBot}_\n` +
        `_© ${inv.namaBot} ${new Date().getFullYear()}_`
    );
};

const getInvoicesByGroup = (groupId) => {
    const db = _loadInvoice();
    return (db[groupId] || []).slice().reverse();
};

const getAllInvoices = () => {
    const db  = _loadInvoice();
    const all = [];
    for (const list of Object.values(db)) all.push(...list);
    return all.sort((a, b) => b.createdAt - a.createdAt);
};

const getInvoiceById = (invoiceId) => {
    const all = getAllInvoices();
    return all.find(i => i.id === invoiceId) || null;
};
const REMINDER_MILESTONES = [
    { key: 'h3',      msLeft: 3 * 86400000, label: '3 hari lagi' },
    { key: 'h1',      msLeft: 1 * 86400000, label: '1 hari lagi' },
    { key: 'h0',      msLeft: 6 * 3600000,  label: '6 jam lagi'  },
    { key: 'expired', msLeft: 0,             label: 'EXPIRED'     },
];

const checkAndSendReminders = async (sewaDb, sendFn, ownerJid, namaBot, namaOwner, ownerNum) => {
    const now    = Date.now();
    const invDb  = _loadInvoice();
    const remDb  = _loadReminder();
    let   sent   = 0;

    for (const [groupId, sewaRow] of Object.entries(sewaDb)) {
        if (!sewaRow || sewaRow.lifetime) continue;
        const expiry = sewaRow.expiry;
        if (!expiry) continue;

        const msLeft = expiry - now;
        const remKey = `${groupId}_sewa`;
        if (!remDb[remKey]) remDb[remKey] = { sent: [] };

        for (const milestone of REMINDER_MILESTONES) {
            if (remDb[remKey].sent.includes(milestone.key)) continue;

            let shouldSend = false;
            if (milestone.key === 'expired' && msLeft <= 0) shouldSend = true;
            else if (milestone.key !== 'expired' && msLeft > 0
                && msLeft <= milestone.msLeft + 3600000
                && msLeft >  milestone.msLeft - 3600000) shouldSend = true;

            if (!shouldSend) continue;

            const paketLabel = sewaRow.paket?.toUpperCase() || 'BASIC';
            const paketHarga = PAKET_HARGA[sewaRow.paket?.toLowerCase()]?.harga;
            const isExpired  = milestone.key === 'expired';

            const msgText = isExpired
                ? (
                    `⛔ *SEWA BOT TELAH HABIS!*\n\n` +
                    `📱 *${namaBot}* di grup ini telah expired!\n` +
                    `📦 Paket terakhir: *${paketLabel}*\n` +
                    `📅 Berakhir: *${_fmtDate(expiry)}*\n\n` +
                    `💡 *Perpanjang sekarang:*\n` +
                    `${paketHarga ? `💰 Harga: *${_fmtRp(paketHarga)}/bulan*\n` : ''}` +
                    `👑 Owner: wa.me/${ownerNum}\n\n` +
                    `_Bot nonaktif hingga sewa diperpanjang._`
                ) : (
                    `⚠️ *PERINGATAN SEWA BOT!*\n\n` +
                    `⏰ Sewa *${namaBot}* di grup ini akan habis dalam *${milestone.label}*!\n\n` +
                    `📦 Paket: *${paketLabel}*\n` +
                    `📅 Berakhir: *${_fmtDate(expiry)}*\n` +
                    `${paketHarga ? `💰 Harga perpanjang: *${_fmtRp(paketHarga)}*\n` : ''}` +
                    `\n👑 Hubungi owner untuk perpanjang:\n` +
                    `wa.me/${ownerNum}\n\n` +
                    `_Jangan sampai bot mati ya!_ 🙏`
                );

            try {
                await sendFn(groupId, { text: msgText }).catch(() => {});
                if (ownerJid) {
                    await sendFn(ownerJid, {
                        text: `🔔 *REMINDER SEWA DIKIRIM*\n\n👥 Grup: \`${groupId.split('@')[0]}\`\n⏰ Milestone: *${milestone.label}*\n📦 Paket: ${paketLabel}`
                    }).catch(() => {});
                }
                remDb[remKey].sent.push(milestone.key);
                sent++;
            } catch {}
        }

        // Reset reminder jika expired dan sudah diperpanjang
        if (msLeft > 0 && remDb[remKey].sent.includes('expired')) {
            remDb[remKey].sent = [];
        }
    }

    _saveReminder(remDb);
    return sent;
};

const markInvoiceExpired = (groupId) => {
    updateInvoiceStatus(groupId, 'expired');
};

module.exports = {
    generateInvoice, formatInvoiceText,
    getInvoicesByGroup, getAllInvoices, getInvoiceById,
    checkAndSendReminders, markInvoiceExpired,
    PAKET_HARGA, _fmtRp, _fmtDate,
};

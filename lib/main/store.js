'use strict';

const fs = require('fs');
const path = require('path');
const DB = require('./storeDB');
const MidtransGateway = require('./getway/midtrans');

if (!global.paymentPolling) global.paymentPolling = new Map();

const midtrans = new MidtransGateway(
    global.midtransServerKey || 'SB-Mid-server-XXXXXXXXXXXXXXXX',
    global.midtransClientKey || 'SB-Mid-client-XXXXXXXXXXXXXXXX',
    global.midtransProduction || false
);

const PAYMENT_MODE = global.paymentMode || 'both';

function getQrisBuffer() {
    const paths = [
        path.join(process.cwd(), 'assets', 'qris.jpg'),
        path.join(process.cwd(), 'assets', 'qris.png'),
        path.join(process.cwd(), 'assets', 'qris.jpeg'),
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return fs.readFileSync(p);
    }
    return null;
}

function getThumbPath() {
    const paths = [
        path.join(process.cwd(), 'assets', 'thumb.jpg'),
        path.join(process.cwd(), 'assets', 'thumb.png'),
        path.join(process.cwd(), 'assets', 'thumb.jpeg'),
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function getOwnerJid() {
    const ownerArr = Array.isArray(global.owner) ? global.owner : (global.owner ? [global.owner] : []);
    const num = (ownerArr[0] || '').replace(/[^0-9]/g, '');
    return num ? num + '@s.whatsapp.net' : null;
}

function getOwnerWaUrl() {
    const ownerArr = Array.isArray(global.owner) ? global.owner : (global.owner ? [global.owner] : []);
    const num = (ownerArr[0] || '').replace(/[^0-9]/g, '');
    return num ? `https://wa.me/${num}` : `https://wa.me/`;
}

function cleanupPolling(key) {
    const poll = global.paymentPolling.get(key);
    if (poll) clearInterval(poll);
    global.paymentPolling.delete(key);
}

async function sendInteractive(bulter, m, generateWAMessageFromContent, bodyText, footerText, buttons) {
    try {
        const msg = generateWAMessageFromContent(
            m.chat,
            { viewOnceMessage: { message: { interactiveMessage: { body: { text: bodyText }, footer: { text: footerText }, nativeFlowMessage: { buttons } } } } },
            {}
        );
        await bulter.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
    } catch {
        await bulter.sendMessage(m.chat, { text: bodyText }, { quoted: m });
    }
}

async function sendInteractiveQuoted(bulter, m, generateWAMessageFromContent, bodyText, footerText, buttons) {
    try {
        const msg = generateWAMessageFromContent(
            m.chat,
            { viewOnceMessage: { message: { interactiveMessage: { body: { text: bodyText }, footer: { text: footerText }, nativeFlowMessage: { buttons } } } } },
            {}
        );
        await bulter.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
    } catch {
        await bulter.sendMessage(m.chat, { text: bodyText }, { quoted: m });
    }
}

async function buildCard(p, proto, prepareWAMessageMedia, bulter) {
    const stokEmoji = p.stok <= 0 ? '❌' : p.stok <= 3 ? '⚠️' : '✅';
    const hargaFmt = DB.formatRp(p.harga);
    const rating = p.avg_rating ? `⭐ ${p.avg_rating.toFixed(1)} (${p.jml_ulasan})` : '⭐ Belum ada ulasan';
    const thumbPath = getThumbPath();
    let header;
    try {
        header = proto.Message.InteractiveMessage.Header.create({
            ...(await prepareWAMessageMedia({ image: { url: thumbPath || './assets/thumb.jpg' } }, { upload: bulter.waUploadToServer })),
            title: p.nama, gifPlayback: false, hasMediaAttachment: false,
        });
    } catch {
        header = proto.Message.InteractiveMessage.Header.create({ title: p.nama, hasMediaAttachment: false });
    }
    return {
        header,
        body: {
            text:
                `🆔 *ID:* \`${p.id}\`\n` +
                `📦 *Nama:* ${p.nama}\n` +
                (p.deskripsi ? `📝 *Desc:* ${p.deskripsi}\n` : '') +
                `💰 *Harga:* ${hargaFmt}\n` +
                `${stokEmoji} *Stok:* ${p.stok} unit\n` +
                `🗂️ *Kategori:* ${p.kategori}\n` +
                `${rating}`,
        },
        nativeFlowMessage: {
            buttons: [
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🛒 Beli Sekarang', id: `.buy ${p.id}` }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📋 Info Detail', id: `.infoproduk ${p.id}` }) },
                { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: '📋 Salin ID', copy_code: p.id }) },
            ],
        },
        footer: { text: `💰 ${hargaFmt} • ${rating}` },
    };
}

async function sendCarousel(bulter, m, bodyText, cards, generateWAMessageFromContent) {
    const msg = generateWAMessageFromContent(
        m.chat,
        { viewOnceMessage: { message: { interactiveMessage: { body: { text: bodyText }, footer: { text: `🏪 ${global.namaBot || 'BulterBot'} Store` }, carouselMessage: { cards, messageVersion: 1 } } } } },
        {}
    );
    await bulter.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
}

async function processGatewaySuccess(bulter, trx, pgRecord) {
    const produk = DB.getProduk(trx.id_produk);
    DB.updateTransaksi(trx.id, 'selesai', 'Auto approved via payment gateway');
    DB.kurangiStok(trx.id_produk, trx.jumlah, `Gateway payment (TRX: ${trx.id})`);
    const poin = Math.floor(trx.total * 0.05);
    DB.tambahPoin(trx.id_user, trx.nama_user, poin, `Pembelian ${trx.id}`);
    DB.addNotif(trx.id_user, `✅ Pembayaran ${trx.id} berhasil! +${poin} poin`, 'success');

    await bulter.sendMessage(trx.id_user, {
        text:
            `✅ *ᴘᴇᴍʙᴀʏᴀʀᴀɴ ʙᴇʀʜᴀsɪʟ*\n\n` +
            `╔═ 🧾 *ᴅᴇᴛᴀɪʟ ᴏʀᴅᴇʀ* ✦\n` +
            `║ 🆔 *ID Transaksi:* \`${trx.id}\`\n` +
            `║ 📦 *Produk:* ${produk?.nama || '-'} (x${trx.jumlah})\n` +
            `║ 💰 *Total:* ${DB.formatRp(trx.total)}\n` +
            (trx.gateway_fee > 0 ? `║ 💳 *Fee Gateway:* ${DB.formatRp(trx.gateway_fee)}\n` : '') +
            `║ ⚡ *Metode:* ${pgRecord.method.toUpperCase()} (Otomatis)\n` +
            `║ ✅ *Status:* Selesai\n` +
            `║ 🏆 *Poin:* +${poin} poin\n` +
            `╚═════\n\n` +
            `_Terima kasih sudah berbelanja! 🙏_`
    });

    const ownerJid = getOwnerJid();
    if (ownerJid) {
        await bulter.sendMessage(ownerJid, {
            text:
                `✅ *ᴘᴇᴍʙᴀʏᴀʀᴀɴ ɢᴀᴛᴇᴡᴀʏ ᴍᴀsᴜᴋ*\n\n` +
                `║ 🆔 *TRX:* \`${trx.id}\`\n` +
                `║ 👤 *User:* ${trx.nama_user}\n` +
                `║ 📦 *Produk:* ${produk?.nama || '-'} (x${trx.jumlah})\n` +
                `║ 💰 *Total:* ${DB.formatRp(pgRecord.total)}\n` +
                `║ 💳 *Fee:* ${DB.formatRp(pgRecord.fee)}\n` +
                `║ ⚡ *Metode:* ${pgRecord.method.toUpperCase()}\n` +
                `║ ✅ *Status:* Auto Approved`
        });
    }
}

function startPaymentPolling(bulter, trxId, orderId) {
    let pollCount = 0;
    const maxPoll = 200;
    const key = `${trxId}_${orderId}`;

    cleanupPolling(key);

    const interval = setInterval(async () => {
        pollCount++;
        if (pollCount > maxPoll) {
            cleanupPolling(key);
            const pgRecord = DB.getPaymentGateway(trxId);
            if (pgRecord && pgRecord.status === 'pending') {
                DB.updatePaymentGateway(pgRecord.id, 'expired', 'expire', '');
                DB.updateTransaksi(trxId, 'batal', 'Payment expired');
                const trx = DB.getTransaksi(trxId);
                if (trx) {
                    await bulter.sendMessage(trx.id_user, {
                        text: `⏰ *Pembayaran Expired*\n\n║ 🆔 *TRX:* \`${trxId}\`\n║ Status: Kadaluarsa (10 menit)\n\n_Silakan ulangi transaksi_`
                    });
                }
            }
            return;
        }

        try {
            const status = await midtrans.checkStatus(orderId);
            const pgRecord = DB.getPaymentGateway(trxId);
            if (!pgRecord || pgRecord.status !== 'pending') { cleanupPolling(key); return; }

            if (status.status === 'paid') {
                cleanupPolling(key);
                DB.updatePaymentGateway(pgRecord.id, 'paid', status.rawStatus, status.paidAt);
                const trx = DB.getTransaksi(trxId);
                if (trx) await processGatewaySuccess(bulter, trx, pgRecord);
            } else if (status.status === 'expired' || status.status === 'cancelled' || status.status === 'failed') {
                cleanupPolling(key);
                DB.updatePaymentGateway(pgRecord.id, status.status, status.rawStatus, '');
                DB.updateTransaksi(trxId, 'batal', `Payment ${status.status}`);
                const trx = DB.getTransaksi(trxId);
                if (trx) {
                    await bulter.sendMessage(trx.id_user, {
                        text: `❌ *Pembayaran ${status.status}*\n\n║ 🆔 *TRX:* \`${trxId}\`\n\n_Silakan ulangi transaksi_`
                    });
                }
            }
        } catch {}
    }, 3000);

    global.paymentPolling.set(key, interval);
}

function resolveOrderData(produkId, jumlah, sender, kodeVoucher) {
    const produk = DB.getProduk(produkId);
    if (!produk) return { error: 'Produk tidak ditemukan!' };
    if (produk.stok <= 0) return { error: `Stok *${produk.nama}* habis!` };
    if (produk.stok < jumlah) return { error: `Stok tidak cukup! Tersisa *${produk.stok}* unit.` };

    const flashSale = DB.getFlashSale(produkId);
    let hargaSatuan = produk.harga;
    let isFlashSale = false;

    if (flashSale && flashSale.stok_sale - flashSale.terjual_sale >= jumlah) {
        hargaSatuan = flashSale.harga_sale;
        isFlashSale = true;
    }

    let total = hargaSatuan * jumlah;
    let diskon = 0;
    let voucherError = null;

    if (kodeVoucher) {
        const voucherResult = DB.pakaiVoucher(kodeVoucher, sender, total);
        if (voucherResult.ok) {
            diskon = voucherResult.diskon;
            total -= diskon;
        } else {
            voucherError = voucherResult.msg;
        }
    }

    return { produk, flashSale, hargaSatuan, isFlashSale, total, diskon, voucherError };
}

async function handle(bulter, m, ctx) {
    const {
        command, text, sender, prefix,
        isOwner, pushname,
        proto, generateWAMessageFromContent,
        prepareWAMessageMedia, reply,
    } = ctx;

    const ownerUrl = getOwnerWaUrl();
    const namaUser = pushname || sender.split('@')[0];

    if (command === 'addproduk' || command === 'tambahproduk' || command === 'produkbaru') {
        if (!isOwner) { reply('❌ Hanya owner yang bisa menambahkan produk!'); return true; }
        const parts = (text || '').split('|').map(s => s.trim());
        if (parts.length < 3) {
            await sendInteractive(bulter, m, generateWAMessageFromContent,
                `🏪 *ᴛᴀᴍʙᴀʜ ᴘʀᴏᴅᴜᴋ*\n\nFormat:\n\`${prefix}addproduk nama | deskripsi | stok | harga | [kategori] | [harga_coret]\`\n\n*Contoh:*\n\`${prefix}addproduk VPS 8GB | Server VPS SSD | 10 | 150000\`\n\`${prefix}addproduk Hosting | Hosting 1 tahun | 5 | 75000 | hosting | 100000\`\n\n_Kategori & harga coret opsional_`,
                `🏪 ${global.namaBot || 'BulterBot'} Store`,
                [
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📋 Lihat Produk', id: `${prefix}listproduk` }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📊 Statistik Toko', id: `${prefix}storestats` }) },
                ]
            );
            return true;
        }
        const _pn  = s => parseInt(String(s || '').replace(/[^0-9]/g, ''));
        const _isN = s => String(s || '').replace(/[^0-9]/g, '').length > 0 && !isNaN(_pn(s));

        let nama = parts[0] || '';
        let deskripsi = '';
        let stokNum, hargaNum;
        let hargaCoretNum = 0;
        let kategori = 'umum';

        if (parts.length === 3) {
            stokNum  = _pn(parts[1]);
            hargaNum = _pn(parts[2]);
        } else if (parts.length === 4) {
            if (_isN(parts[2]) && _isN(parts[3])) {
                deskripsi = parts[1];
                stokNum   = _pn(parts[2]);
                hargaNum  = _pn(parts[3]);
            } else if (_isN(parts[1]) && _isN(parts[2])) {
                stokNum  = _pn(parts[1]);
                hargaNum = _pn(parts[2]);
                kategori = parts[3] || 'umum';
            } else {
                deskripsi = parts[1];
                stokNum   = _pn(parts[2]);
                hargaNum  = _pn(parts[3]);
            }
        } else if (parts.length === 5) {
            if (_isN(parts[2]) && _isN(parts[3])) {
                deskripsi = parts[1];
                stokNum   = _pn(parts[2]);
                hargaNum  = _pn(parts[3]);
                kategori  = parts[4] || 'umum';
            } else if (_isN(parts[1]) && _isN(parts[2]) && _isN(parts[3])) {
                stokNum       = _pn(parts[1]);
                hargaNum      = _pn(parts[2]);
                kategori      = parts[3] || 'umum';
                hargaCoretNum = _pn(parts[4]) || 0;
            } else {
                deskripsi = parts[1];
                stokNum   = _pn(parts[2]);
                hargaNum  = _pn(parts[3]);
                kategori  = parts[4] || 'umum';
            }
        } else if (parts.length >= 6) {
            deskripsi     = parts[1];
            stokNum       = _pn(parts[2]);
            hargaNum      = _pn(parts[3]);
            kategori      = parts[4] || 'umum';
            hargaCoretNum = _pn(parts[5]) || 0;
        } else {
            stokNum  = NaN;
            hargaNum = NaN;
        }

        if (!nama)           { reply('❌ Nama produk tidak boleh kosong!'); return true; }
        if (isNaN(stokNum))  { reply('❌ Stok harus berupa angka!'); return true; }
        if (isNaN(hargaNum)) { reply('❌ Harga harus berupa angka!'); return true; }
        if (isNaN(stokNum)) { reply('❌ Stok harus berupa angka!'); return true; }
        if (isNaN(hargaNum)) { reply('❌ Harga harus berupa angka!'); return true; }
        bulter.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });
        try {
            const id = DB.addProduk(nama, deskripsi, stokNum, hargaNum, kategori, hargaCoretNum);
            const semua = DB.getAllProduk();
            bulter.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
            await sendInteractive(bulter, m, generateWAMessageFromContent,
                `✅ *ᴘʀᴏᴅᴜᴋ ʙᴇʀʜᴀsɪʟ ᴅɪᴛᴀᴍʙᴀʜᴋᴀɴ*\n\n╔═ 📦 *ᴅᴇᴛᴀɪʟ* ✦\n║ 🆔 *ID:* \`${id}\`\n║ 📦 *Nama:* ${nama}\n` + (deskripsi ? `║ 📝 *Deskripsi:* ${deskripsi}\n` : '') + `║ 💰 *Harga:* ${DB.formatRp(hargaNum)}\n` + (hargaCoretNum > 0 ? `║ 💸 *Harga Coret:* ${DB.formatRp(hargaCoretNum)}\n` : '') + `║ 📊 *Stok:* ${stokNum} unit\n║ 🗂️ *Kategori:* ${kategori}\n╚═════\n\n_Total produk: ${semua.length}_`,
                `🏪 ${global.namaBot || 'BulterBot'} Store`,
                [
                    { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: '📋 Salin ID', copy_code: id }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '✏️ Edit', id: `${prefix}editproduk ${id} | ` }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🗑️ Hapus', id: `${prefix}delproduk ${id}` }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📋 Semua Produk', id: `${prefix}listproduk` }) },
                ]
            );
            try {
                const cards = await Promise.all(semua.map(p => buildCard(p, proto, prepareWAMessageMedia, bulter)));
                await sendCarousel(bulter, m, `🏪 *${global.namaBot || 'BulterBot'} Store*\n\nTotal *${semua.length} produk* tersedia`, cards, generateWAMessageFromContent);
            } catch {}
        } catch (e) {
            bulter.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            reply(`❌ *Gagal tambah produk:* ${e.message.slice(0, 100)}`);
        }
        return true;
    }

    if (command === 'editproduk' || command === 'ubahproduk') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        const parts = (text || '').split('|').map(s => s.trim());
        const [id, field, ...valParts] = parts;
        const val = valParts.join('|').trim();
        if (!id || !field || !val) {
            await sendInteractive(bulter, m, generateWAMessageFromContent,
                `✏️ *ᴇᴅɪᴛ ᴘʀᴏᴅᴜᴋ*\n\nFormat:\n\`${prefix}editproduk <ID> | <field> | <nilai>\`\n\n*Field:*\n  • \`nama\` • \`deskripsi\` • \`stok\` • \`harga\` • \`harga_coret\` • \`kategori\`\n\n*Contoh:*\n\`${prefix}editproduk PRD-ABC123 | stok | 20\``,
                `🏪 ${global.namaBot || 'BulterBot'} Store`,
                [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📋 Lihat Produk', id: `${prefix}listproduk` }) }]
            );
            return true;
        }
        const produk = DB.getProduk(id);
        if (!produk) { reply(`❌ Produk \`${id}\` tidak ditemukan!`); return true; }
        const allowed = ['nama', 'deskripsi', 'stok', 'harga', 'harga_coret', 'kategori'];
        const fieldLower = field.toLowerCase();
        if (!allowed.includes(fieldLower)) { reply(`❌ Field tidak valid! Pilih: ${allowed.join(', ')}`); return true; }
        const parsedVal = ['stok', 'harga', 'harga_coret'].includes(fieldLower) ? parseInt(String(val).replace(/[^0-9]/g, '')) : val;
        if (isNaN(parsedVal) && ['stok', 'harga', 'harga_coret'].includes(fieldLower)) { reply(`❌ Nilai harus angka!`); return true; }
        DB.editProduk(id, { [fieldLower]: parsedVal });
        bulter.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        reply(`✅ Produk *${produk.nama}* berhasil diedit\n\n║ ✏️ *${fieldLower}:* ${['harga', 'harga_coret'].includes(fieldLower) ? DB.formatRp(parsedVal) : parsedVal}`);
        return true;
    }

    if (command === 'delproduk' || command === 'hapusproduk') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        const id = (text || '').trim();
        if (!id) { reply(`❌ Format: \`${prefix}delproduk <ID>\``); return true; }
        const produk = DB.getProduk(id);
        if (!produk) { reply(`❌ Produk \`${id}\` tidak ditemukan!`); return true; }
        DB.delProduk(id);
        bulter.sendMessage(m.chat, { react: { text: '🗑️', key: m.key } });
        reply(`🗑️ Produk *${produk.nama}* (\`${id}\`) berhasil dihapus`);
        return true;
    }

    if (command === 'tambahstok' || command === 'addstok' || command === 'restock') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        const parts = (text || '').trim().split(/\s+/);
        const id = parts[0];
        const jml = parseInt(parts[1]) || 1;
        const ket = parts.slice(2).join(' ') || 'Restock manual';
        if (!id) { reply(`❌ Format: \`${prefix}tambahstok <ID> <jumlah>\``); return true; }
        const produk = DB.getProduk(id);
        if (!produk) { reply(`❌ Produk \`${id}\` tidak ditemukan!`); return true; }
        DB.tambahStok(id, jml, ket);
        bulter.sendMessage(m.chat, { react: { text: '📦', key: m.key } });
        reply(`📦 Stok *${produk.nama}* ditambah *${jml}* unit\n📊 Stok baru: *${produk.stok + jml}* unit`);
        return true;
    }

    if (command === 'setpayment') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        const mode = (text || '').trim().toLowerCase();
        if (!['gateway', 'manual', 'both'].includes(mode)) {
            reply(`⚙️ *Set Payment Mode*\n\nFormat: \`${prefix}setpayment <mode>\`\n\n• \`gateway\` — Hanya QRIS otomatis\n• \`manual\` — Hanya transfer manual\n• \`both\` — User pilih sendiri\n\nSaat ini: *${global.paymentMode || PAYMENT_MODE}*`);
            return true;
        }
        global.paymentMode = mode;
        reply(`✅ Payment mode: *${mode}*`);
        return true;
    }

    if (command === 'storestats' || command === 'laporantoko' || command === 'rekapstore') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        bulter.sendMessage(m.chat, { react: { text: '📊', key: m.key } });
        const stat = DB.getStatistik();
        const trxTerbaru = DB.getAllTransaksi(5);
        let trxTxt = '';
        if (trxTerbaru.length) {
            trxTerbaru.forEach(t => {
                const sE = { selesai: '✅', pending: '⏳', batal: '❌', dikonfirmasi: '🔔' }[t.status] || '❓';
                trxTxt += `${sE} \`${t.id}\` — ${t.nama_produk || '-'} (x${t.jumlah})\n   👤 ${t.nama_user || t.id_user.split('@')[0]} • ${DB.formatRp(t.total)} • ${t.payment_method}\n`;
            });
        } else { trxTxt = '_Belum ada transaksi_'; }
        await sendInteractive(bulter, m, generateWAMessageFromContent,
            `📊 *ʟᴀᴘᴏʀᴀɴ ᴛᴏᴋᴏ*\n\n` +
            `╔═ 📈 *sᴛᴀᴛɪsᴛɪᴋ* ✦\n` +
            `║ 📦 *Produk:* ${stat.totalProduk}\n║ 🛒 *Transaksi:* ${stat.totalTrx}\n║ ✅ *Selesai:* ${stat.trxSelesai}\n║ ⏳ *Pending:* ${stat.trxPending}\n║ ❌ *Ditolak:* ${stat.trxDitolak}\n║ 🔔 *Konfirmasi:* ${stat.pendingKnf}\n║ 💰 *Omzet:* ${DB.formatRp(stat.totalOmzet)}\n║ 📅 *Hari Ini:* ${DB.formatRp(stat.omzetHariIni)}\n║ 📆 *Bulan Ini:* ${DB.formatRp(stat.omzetBulanIni)}\n║ 👥 *Pelanggan:* ${stat.totalPelanggan}\n║ ⭐ *Rating:* ${stat.avgRating}\n` +
            `╚═════\n\n` +
            `╔═ 💳 *ɢᴀᴛᴇᴡᴀʏ* ✦\n║ ✅ *Paid:* ${stat.gwStats.paid}\n║ ⏳ *Pending:* ${stat.gwStats.pending}\n║ 💰 *Omzet GW:* ${DB.formatRp(stat.gwStats.totalAmount)}\n║ 💳 *Fee:* ${DB.formatRp(stat.gwStats.totalFee)}\n╚═════\n\n` +
            `📋 *Terbaru:*\n${trxTxt}`,
            `🏪 ${global.namaBot || 'BulterBot'} Store`,
            [
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🔔 Konfirmasi', id: `${prefix}konfirmasipending` }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📋 Terlaris', id: `${prefix}terlaris` }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '👥 Pelanggan', id: `${prefix}toppelanggan` }) },
            ]
        );
        return true;
    }

    if (command === 'konfirmasipending' || command === 'pendingbayar' || command === 'cekbukti') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        const pending = DB.getKonfirmasiPending();
        if (!pending.length) { reply(`✅ Tidak ada konfirmasi pending`); return true; }
        let txt = `🔔 *ᴘᴇɴᴅɪɴɢ (${pending.length})*\n\n`;
        pending.forEach((k, i) => {
            txt += `*${i+1}.* \`${k.id}\`\n   📦 ${k.nama_produk || '-'} (x${k.jumlah})\n   👤 ${k.nama_user || ''} • ${DB.formatRp(k.total)}\n\n`;
        });
        const first = pending[0];
        await sendInteractive(bulter, m, generateWAMessageFromContent, txt.trim(), `🏪 ${global.namaBot || 'BulterBot'} Store`,
            [
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '✅ Approve', id: `${prefix}approvebayar ${first.id}` }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '❌ Tolak', id: `${prefix}rejectbayar ${first.id}` }) },
            ]
        );
        return true;
    }

    if (command === 'approvebayar' || command === 'terimabayar' || command === 'acc') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        const id = (text || '').trim();
        if (!id) { reply(`❌ Format: \`${prefix}approvebayar <ID>\``); return true; }
        const knf = DB.getKonfirmasi(id);
        if (!knf) { reply(`❌ Tidak ditemukan!`); return true; }
        if (knf.status !== 'menunggu') { reply(`⚠️ Sudah diproses`); return true; }
        DB.updateKonfirmasi(id, 'disetujui', 'Disetujui owner');
        DB.updateTransaksi(knf.id_transaksi, 'selesai', 'Disetujui owner');
        DB.kurangiStok(knf.id_produk, knf.jumlah, `Terjual (TRX: ${knf.id_transaksi})`);
        const poin = Math.floor(knf.total * 0.05);
        DB.tambahPoin(knf.id_user, knf.nama_user, poin, `Pembelian ${knf.id_transaksi}`);
        DB.addNotif(knf.id_user, `✅ Pembayaran ${knf.id_transaksi} disetujui! +${poin} poin`, 'success');
        const produk = DB.getProduk(knf.id_produk);
        await bulter.sendMessage(knf.id_user, {
            text: `✅ *ᴘᴇᴍʙᴀʏᴀʀᴀɴ ᴅɪsᴇᴛᴜᴊᴜɪ*\n\n║ 🆔 *TRX:* \`${knf.id_transaksi}\`\n║ 📦 *Produk:* ${produk?.nama || '-'} (x${knf.jumlah})\n║ 💰 *Total:* ${DB.formatRp(knf.total)}\n║ 🏆 *Poin:* +${poin}\n\n_Terima kasih! 🙏_`
        });
        bulter.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        reply(`✅ Konfirmasi \`${id}\` disetujui`);
        return true;
    }

    if (command === 'rejectbayar' || command === 'tolakbayar' || command === 'reject') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        const parts = (text || '').trim().split(/\s+/);
        const id = parts[0];
        const alasan = parts.slice(1).join(' ') || 'Bukti tidak valid';
        if (!id) { reply(`❌ Format: \`${prefix}rejectbayar <ID> [alasan]\``); return true; }
        const knf = DB.getKonfirmasi(id);
        if (!knf) { reply(`❌ Tidak ditemukan!`); return true; }
        if (knf.status !== 'menunggu') { reply(`⚠️ Sudah diproses`); return true; }
        DB.updateKonfirmasi(id, 'ditolak', alasan);
        DB.updateTransaksi(knf.id_transaksi, 'batal', alasan);
        DB.addNotif(knf.id_user, `❌ Pembayaran ${knf.id_transaksi} ditolak: ${alasan}`, 'error');
        await bulter.sendMessage(knf.id_user, {
            text: `❌ *ᴘᴇᴍʙᴀʏᴀʀᴀɴ ᴅɪᴛᴏʟᴀᴋ*\n\n║ 🆔 *TRX:* \`${knf.id_transaksi}\`\n║ ❌ *Alasan:* ${alasan}\n\n_Hubungi owner untuk info lebih lanjut_`
        });
        bulter.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
        reply(`❌ Konfirmasi \`${id}\` ditolak`);
        return true;
    }

    if (command === 'terlaris') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        const list = DB.getProdukTerlaris(10);
        if (!list.length) { reply(`📊 Belum ada data`); return true; }
        let txt = `🏆 *ᴘʀᴏᴅᴜᴋ ᴛᴇʀʟᴀʀɪs*\n\n`;
        list.forEach((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
            txt += `${medal} *${p.nama}* — ${p.terjual} terjual\n   💰 ${DB.formatRp(p.harga)} • Stok: ${p.stok}\n\n`;
        });
        reply(txt.trim());
        return true;
    }

    if (command === 'toppelanggan' || command === 'pelanggan') {
        if (!isOwner) { reply('❌ Hanya owner!'); return true; }
        const list = DB.getTopPelanggan(10);
        if (!list.length) { reply(`👥 Belum ada data`); return true; }
        let txt = `👥 *ᴛᴏᴘ ᴘᴇʟᴀɴɢɢᴀɴ*\n\n`;
        list.forEach((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
            txt += `${medal} *${p.nama_user || p.id_user.split('@')[0]}*\n   🛒 ${p.total_order}x • ${DB.formatRp(p.total_belanja)}\n\n`;
        });
        reply(txt.trim());
        return true;
    }

    if (command === 'listproduk' || command === 'produk' || command === 'toko' || command === 'shop') {
        const kategori = (text || '').trim().toLowerCase() || null;
        const semua = kategori ? DB.getAllProduk(kategori) : DB.getAllProduk();
        if (!semua.length) {
            reply(`🏪 Belum ada produk${kategori ? ` di kategori *${kategori}*` : ''}`);
            return true;
        }
        bulter.sendMessage(m.chat, { react: { text: '🏪', key: m.key } });
        try {
            const cards = await Promise.all(semua.map(p => buildCard(p, proto, prepareWAMessageMedia, bulter)));
            await sendCarousel(bulter, m,
                `🏪 *${global.namaBot || 'BulterBot'} Store*\n\n` + (kategori ? `📂 Kategori: *${kategori}*\n` : '') + `Total *${semua.length} produk*\n_Klik tombol untuk membeli_`,
                cards, generateWAMessageFromContent
            );
        } catch {
            let txt = `🏪 *ᴅᴀꜰᴛᴀʀ ᴘʀᴏᴅᴜᴋ*\n\n`;
            semua.forEach((p, i) => {
                const stokE = p.stok <= 0 ? '❌' : p.stok <= 3 ? '⚠️' : '✅';
                txt += `*${i+1}. ${p.nama}*\n   🆔 \`${p.id}\`\n   💰 ${DB.formatRp(p.harga)}\n   ${stokE} Stok: ${p.stok}\n\n`;
            });
            reply(txt.trim() + `\n\n_Ketik \`${prefix}buy <ID>\` untuk membeli_`);
        }
        bulter.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        return true;
    }

    if (command === 'cari' || command === 'search' || command === 'cariproduk') {
        const keyword = (text || '').trim();
        if (!keyword) { reply(`🔍 Format: \`${prefix}cari <keyword>\``); return true; }
        const hasil = DB.cariProduk(keyword);
        if (!hasil.length) { reply(`🔍 Tidak ditemukan: "*${keyword}*"`); return true; }
        let txt = `🔍 *"${keyword}"* — ${hasil.length} produk\n\n`;
        hasil.forEach((p, i) => {
            txt += `*${i+1}. ${p.nama}*\n   \`${p.id}\` • ${DB.formatRp(p.harga)} • Stok: ${p.stok}\n\n`;
        });
        reply(txt.trim());
        return true;
    }

    if (command === 'infoproduk' || command === 'cekproduk' || command === 'detailproduk') {
        const id = (text || '').trim();
        if (!id) { reply(`ℹ️ Format: \`${prefix}infoproduk <ID>\``); return true; }
        const produk = DB.getProduk(id);
        if (!produk) { reply(`❌ Produk \`${id}\` tidak ditemukan!`); return true; }
        const stokEmoji = produk.stok <= 0 ? '❌ Habis' : produk.stok <= 3 ? `⚠️ Sisa ${produk.stok}` : `✅ ${produk.stok} unit`;
        const rating = produk.avg_rating ? `⭐ ${produk.avg_rating.toFixed(1)} (${produk.jml_ulasan} ulasan)` : '⭐ Belum ada ulasan';
        const flashSale = DB.getFlashSale(id);
        let hargaTampil = `💰 *Harga:* ${DB.formatRp(produk.harga)}`;
        if (flashSale) {
            const sisaMenit = Math.floor((flashSale.selesai - DB.nowTs()) / 60);
            hargaTampil = `⚡ *Flash Sale:* ${DB.formatRp(flashSale.harga_sale)}\n║ ⏰ Sisa ${sisaMenit} menit`;
        } else if (produk.harga_coret > 0) {
            hargaTampil = `💰 *Harga:* ${DB.formatRp(produk.harga)} ~${DB.formatRp(produk.harga_coret)}~`;
        }
        bulter.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        const buttons = produk.stok > 0
            ? [
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🛒 Beli', id: `${prefix}buy ${produk.id}` }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '💖 Wishlist', id: `${prefix}addwishlist ${produk.id}` }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '⭐ Ulasan', id: `${prefix}ulasan ${produk.id}` }) },
                { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: '📋 Salin ID', copy_code: produk.id }) },
            ]
            : [
                { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '💬 Tanya Restock', url: ownerUrl, merchant_url: ownerUrl }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏪 Produk Lain', id: `${prefix}listproduk` }) },
            ];
        await sendInteractive(bulter, m, generateWAMessageFromContent,
            `📦 *ᴅᴇᴛᴀɪʟ ᴘʀᴏᴅᴜᴋ*\n\n╔═ 🏷️ *${produk.nama}* ✦\n║ 🆔 *ID:* \`${produk.id}\`\n║ 📝 *Desc:* ${produk.deskripsi || '-'}\n║ ${hargaTampil}\n║ 📊 *Stok:* ${stokEmoji}\n║ 🗂️ *Kategori:* ${produk.kategori}\n║ ${rating}\n║ 📦 *Terjual:* ${produk.terjual}\n║ 📅 *Dibuat:* ${DB.fmtDate(produk.dibuat)}\n╚═════`,
            `💰 ${DB.formatRp(produk.harga)}`,
            buttons
        );
        return true;
    }

    if (command === 'buy' || command === 'beli' || command === 'order') {
        const parts = (text || '').trim().split(/\s+/);
        const id = parts[0];
        const jumlah = Math.max(1, parseInt(parts[1]) || 1);
        const kodeVoucher = (parts[2] && parts[2] !== 'undefined') ? parts[2].toUpperCase() : '';

        if (!id) {
            await sendInteractive(bulter, m, generateWAMessageFromContent,
                `🛒 *ʙᴇʟɪ ᴘʀᴏᴅᴜᴋ*\n\nFormat:\n\`${prefix}buy <ID> [jumlah] [voucher]\`\n\n*Contoh:*\n\`${prefix}buy PRD-ABC123\`\n\`${prefix}buy PRD-ABC123 2 PROMO10\``,
                `🏪 ${global.namaBot || 'BulterBot'} Store`,
                [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏪 Lihat Produk', id: `${prefix}listproduk` }) }]
            );
            return true;
        }

        const order = resolveOrderData(id, jumlah, sender, kodeVoucher);
        if (order.error) { reply(`❌ ${order.error}`); return true; }
        if (order.voucherError) { reply(`❌ ${order.voucherError}`); return true; }

        const { produk, flashSale, hargaSatuan, isFlashSale, total, diskon } = order;
        const currentMode = global.paymentMode || PAYMENT_MODE;
        const feeQris = midtrans.calculateFee(total, 'qris');

        if (currentMode === 'both') {
            bulter.sendMessage(m.chat, { react: { text: '🛒', key: m.key } });

            await sendInteractive(bulter, m, generateWAMessageFromContent,
                `🧾 *ɪɴᴠᴏɪᴄᴇ ᴘᴇᴍʙᴇʟɪᴀɴ*\n\n` +
                `╔═ 📋 *ᴅᴇᴛᴀɪʟ ᴏʀᴅᴇʀ* ✦\n` +
                `║ 📦 *Produk:* ${produk.nama}\n` +
                (produk.deskripsi ? `║ 📝 *Desc:* ${produk.deskripsi}\n` : '') +
                `║ 🔢 *Jumlah:* ${jumlah} unit\n` +
                `║ 💰 *Harga:* ${DB.formatRp(hargaSatuan)}\n` +
                (isFlashSale ? `║ ⚡ *Flash Sale:* AKTIF\n` : '') +
                `║ 💵 *Subtotal:* ${DB.formatRp(total + diskon)}\n` +
                (diskon > 0 ? `║ 🎟️ *Voucher:* -${DB.formatRp(diskon)}\n` : '') +
                `║ ─────────────────────\n` +
                `║ 💵 *Total:* *${DB.formatRp(total)}*\n` +
                `╚═════\n\n` +
                `*Pilih Metode Pembayaran:*\n\n` +
                `⚡ *QRIS Otomatis*\n` +
                `   Fee: ${DB.formatRp(feeQris)}\n` +
                `   Total: *${DB.formatRp(total + feeQris)}*\n` +
                `   _Instant, auto konfirmasi_\n\n` +
                `📱 *Transfer Manual*\n` +
                `   Fee: Gratis\n` +
                `   Total: *${DB.formatRp(total)}*\n` +
                `   _Proses 1x24 jam_`,
                `🏪 ${global.namaBot || 'BulterBot'} Store`,
                [
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '⚡ QRIS Otomatis', id: `${prefix}pay_gateway ${id} ${jumlah} ${kodeVoucher || '_'}` }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📱 Transfer Manual', id: `${prefix}pay_manual ${id} ${jumlah} ${kodeVoucher || '_'}` }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '❌ Batal', id: `${prefix}listproduk` }) },
                ]
            );
            return true;
        }

        if (currentMode === 'gateway') {
            bulter.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });
            try {
                const trxId = DB.buatTransaksi(produk.id, sender, namaUser, jumlah, total, kodeVoucher, diskon, 0, 'gateway', feeQris);
                if (kodeVoucher && diskon > 0) DB.gunakanVoucher(kodeVoucher, sender, trxId, diskon);
                if (isFlashSale && flashSale) DB.kurangiStokFlashSale(flashSale.id, jumlah);
                const orderId = `ORDER-${trxId}-${Date.now()}`;
                const totalBayar = total + feeQris;
                const gwResult = await midtrans.createQrisTransaction(orderId, totalBayar, namaUser, sender.split('@')[0]);
                const pgId = DB.simpanPaymentGateway(trxId, sender, 'qris', orderId, gwResult.transactionId, total, feeQris, totalBayar, gwResult.qrUrl || gwResult.qrString, '', '', '', gwResult.transactionId, gwResult.expiry);
                DB.updateTransaksiGateway(trxId, pgId);
                const qrUrl = gwResult.qrUrl || gwResult.qrString || '';
                if (qrUrl) {
                    await bulter.sendMessage(m.chat, {
                        image: { url: qrUrl },
                        caption: `⚡ *ᴘᴇᴍʙᴀʏᴀʀᴀɴ QRIS*\n\n║ 🆔 *TRX:* \`${trxId}\`\n║ 📦 *Produk:* ${produk.nama} (x${jumlah})\n║ 💵 *Subtotal:* ${DB.formatRp(total)}\n║ 💳 *Fee:* ${DB.formatRp(feeQris)}\n║ 💰 *TOTAL:* *${DB.formatRp(totalBayar)}*\n║ ⏰ *Expired:* 10 menit\n\n_Scan QRIS lalu tunggu konfirmasi otomatis_`,
                        mimetype: 'image/png',
                    }, { quoted: m });
                } else {
                    reply(`⚡ *QRIS*\n\n🆔 \`${trxId}\`\n💰 ${DB.formatRp(totalBayar)}\n⏰ 10 menit\n\n_Cek: \`${prefix}cekbayar ${trxId}\`_`);
                }
                bulter.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
                startPaymentPolling(bulter, trxId, orderId);
            } catch (e) {
                bulter.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
                reply(`❌ Gagal QRIS: ${e.message.slice(0, 150)}\n\n_Coba \`${prefix}pay_manual ${produk.id} ${jumlah}\`_`);
            }
            return true;
        }

        const trxId = DB.buatTransaksi(produk.id, sender, namaUser, jumlah, total, kodeVoucher, diskon, 0, 'manual', 0);
        if (kodeVoucher && diskon > 0) DB.gunakanVoucher(kodeVoucher, sender, trxId, diskon);
        if (isFlashSale && flashSale) DB.kurangiStokFlashSale(flashSale.id, jumlah);
        const qrisBuf = getQrisBuffer();
        const invoiceText =
            `🧾 *ɪɴᴠᴏɪᴄᴇ ᴘᴇᴍʙᴇʟɪᴀɴ*\n\n` +
            `╔═ 📋 *ᴅᴇᴛᴀɪʟ* ✦\n` +
            `║ 🆔 *TRX:* \`${trxId}\`\n║ 📦 *Produk:* ${produk.nama}\n║ 🔢 *Jumlah:* ${jumlah}\n║ 💰 *Harga:* ${DB.formatRp(hargaSatuan)}\n` +
            (diskon > 0 ? `║ 🎟️ *Voucher:* -${DB.formatRp(diskon)}\n` : '') +
            `║ 💵 *TOTAL:* *${DB.formatRp(total)}*\n║ 👤 *Pembeli:* ${namaUser}\n╚═════\n\n` +
            `📌 *Cara Bayar:*\n1️⃣ Transfer *${DB.formatRp(total)}*\n2️⃣ Screenshot bukti\n3️⃣ Reply foto + \`${prefix}confirm ${trxId}\`\n\n⏰ _Batal jika 24 jam tidak dikonfirmasi_`;
        bulter.sendMessage(m.chat, { react: { text: '🧾', key: m.key } });
        if (qrisBuf) {
            await bulter.sendMessage(m.chat, { image: qrisBuf, caption: invoiceText, mimetype: 'image/jpeg' }, { quoted: m });
        } else {
            await bulter.sendMessage(m.chat, { text: invoiceText }, { quoted: m });
        }
        return true;
    }

    if (command === 'pay_gateway') {
        const parts = (text || '').trim().split(/\s+/);
        const id = parts[0];
        const jumlah = Math.max(1, parseInt(parts[1]) || 1);
        const kodeVoucher = (parts[2] && parts[2] !== '_' && parts[2] !== 'undefined') ? parts[2].toUpperCase() : '';

        if (!id) { reply('❌ Data tidak valid'); return true; }

        const order = resolveOrderData(id, jumlah, sender, kodeVoucher);
        if (order.error) { reply(`❌ ${order.error}`); return true; }
        if (order.voucherError) { reply(`❌ ${order.voucherError}`); return true; }

        const { produk, flashSale, isFlashSale, total, diskon } = order;
        const feeQris = midtrans.calculateFee(total, 'qris');
        const totalBayar = total + feeQris;

        bulter.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });

        try {
            const trxId = DB.buatTransaksi(produk.id, sender, namaUser, jumlah, total, kodeVoucher, diskon, 0, 'gateway', feeQris);
            if (kodeVoucher && diskon > 0) DB.gunakanVoucher(kodeVoucher, sender, trxId, diskon);
            if (isFlashSale && flashSale) DB.kurangiStokFlashSale(flashSale.id, jumlah);

            const orderId = `ORDER-${trxId}-${Date.now()}`;
            const gwResult = await midtrans.createQrisTransaction(orderId, totalBayar, namaUser, sender.split('@')[0]);
            const pgId = DB.simpanPaymentGateway(trxId, sender, 'qris', orderId, gwResult.transactionId, total, feeQris, totalBayar, gwResult.qrUrl || gwResult.qrString, '', '', '', gwResult.transactionId, gwResult.expiry);
            DB.updateTransaksiGateway(trxId, pgId);

            const qrUrl = gwResult.qrUrl || gwResult.qrString || '';
            if (qrUrl) {
                await bulter.sendMessage(m.chat, {
                    image: { url: qrUrl },
                    caption:
                        `⚡ *ᴘᴇᴍʙᴀʏᴀʀᴀɴ QRIS ᴏᴛᴏᴍᴀᴛɪs*\n\n` +
                        `╔═ 🧾 *ɪɴᴠᴏɪᴄᴇ* ✦\n` +
                        `║ 🆔 *ID:* \`${trxId}\`\n` +
                        `║ 📦 *Produk:* ${produk.nama} (x${jumlah})\n` +
                        `║ 💵 *Subtotal:* ${DB.formatRp(total)}\n` +
                        `║ 💳 *Fee:* ${DB.formatRp(feeQris)}\n` +
                        `║ ─────────────────────\n` +
                        `║ 💰 *TOTAL:* *${DB.formatRp(totalBayar)}*\n` +
                        `║ ⏰ *Expired:* 10 menit\n` +
                        `╚═════\n\n` +
                        `*Cara Bayar:*\n` +
                        `1️⃣ Buka e-wallet / m-banking\n` +
                        `2️⃣ Scan QRIS di atas\n` +
                        `3️⃣ Bayar *${DB.formatRp(totalBayar)}*\n` +
                        `4️⃣ Tunggu konfirmasi otomatis\n\n` +
                        `_Cek manual: \`${prefix}cekbayar ${trxId}\`_`,
                    mimetype: 'image/png',
                }, { quoted: m });
            } else {
                reply(`⚡ *QRIS Dibuat*\n\n🆔 \`${trxId}\`\n💰 ${DB.formatRp(totalBayar)}\n⏰ 10 menit\n\n_Cek: \`${prefix}cekbayar ${trxId}\`_`);
            }

            await sendInteractiveQuoted(bulter, m, generateWAMessageFromContent,
                `⚡ *Aksi Cepat*`,
                `💰 ${DB.formatRp(totalBayar)}`,
                [
                    { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: '📋 Salin ID', copy_code: trxId }) },
                    { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: '💰 Salin Nominal', copy_code: String(totalBayar) }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🔍 Cek Status', id: `${prefix}cekbayar ${trxId}` }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '❌ Batalkan', id: `${prefix}cancelpay ${trxId}` }) },
                ]
            );

            bulter.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
            startPaymentPolling(bulter, trxId, orderId);
        } catch (e) {
            bulter.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            reply(`❌ *Gagal QRIS:* ${e.message.slice(0, 150)}\n\n_Coba manual: \`${prefix}pay_manual ${produk.id} ${jumlah}\`_`);
        }
        return true;
    }

    if (command === 'pay_manual') {
        const parts = (text || '').trim().split(/\s+/);
        const id = parts[0];
        const jumlah = Math.max(1, parseInt(parts[1]) || 1);
        const kodeVoucher = (parts[2] && parts[2] !== '_' && parts[2] !== 'undefined') ? parts[2].toUpperCase() : '';

        if (!id) { reply('❌ Data tidak valid'); return true; }

        const order = resolveOrderData(id, jumlah, sender, kodeVoucher);
        if (order.error) { reply(`❌ ${order.error}`); return true; }
        if (order.voucherError) { reply(`❌ ${order.voucherError}`); return true; }

        const { produk, flashSale, hargaSatuan, isFlashSale, total, diskon } = order;

        const trxId = DB.buatTransaksi(produk.id, sender, namaUser, jumlah, total, kodeVoucher, diskon, 0, 'manual', 0);
        if (kodeVoucher && diskon > 0) DB.gunakanVoucher(kodeVoucher, sender, trxId, diskon);
        if (isFlashSale && flashSale) DB.kurangiStokFlashSale(flashSale.id, jumlah);

        const qrisBuf = getQrisBuffer();
        const invoiceText =
            `🧾 *ɪɴᴠᴏɪᴄᴇ ᴘᴇᴍʙᴇʟɪᴀɴ (ᴍᴀɴᴜᴀʟ)*\n\n` +
            `╔═ 📋 *ᴅᴇᴛᴀɪʟ ᴏʀᴅᴇʀ* ✦\n` +
            `║ 🆔 *ID:* \`${trxId}\`\n` +
            `║ 📦 *Produk:* ${produk.nama}\n` +
            (produk.deskripsi ? `║ 📝 *Desc:* ${produk.deskripsi}\n` : '') +
            `║ 🔢 *Jumlah:* ${jumlah} unit\n` +
            `║ 💰 *Harga:* ${DB.formatRp(hargaSatuan)}\n` +
            (isFlashSale ? `║ ⚡ *Flash Sale:* AKTIF\n` : '') +
            (diskon > 0 ? `║ 🎟️ *Voucher:* -${DB.formatRp(diskon)}\n` : '') +
            `║ 💳 *Fee:* Gratis\n` +
            `║ ─────────────────────\n` +
            `║ 💵 *TOTAL:* *${DB.formatRp(total)}*\n` +
            `║ 👤 *Pembeli:* ${namaUser}\n` +
            `╚═════\n\n` +
            `📌 *Cara Pembayaran:*\n` +
            `1️⃣ Transfer ke QRIS sebesar *${DB.formatRp(total)}*\n` +
            `2️⃣ Screenshot bukti pembayaran\n` +
            `3️⃣ Reply pesan ini dengan foto bukti + ketik:\n` +
            `   \`${prefix}confirm ${trxId}\`\n\n` +
            `⏰ _Batal otomatis jika tidak dikonfirmasi 24 jam_`;

        bulter.sendMessage(m.chat, { react: { text: '🧾', key: m.key } });

        if (qrisBuf) {
            await bulter.sendMessage(m.chat, { image: qrisBuf, caption: invoiceText, mimetype: 'image/jpeg' }, { quoted: m });
        } else {
            await bulter.sendMessage(m.chat, { text: invoiceText }, { quoted: m });
        }

        await sendInteractiveQuoted(bulter, m, generateWAMessageFromContent,
            `⚡ *Aksi Cepat Invoice \`${trxId}\`*`,
            `💵 Total: ${DB.formatRp(total)}`,
            [
                { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: '📋 Salin ID', copy_code: trxId }) },
                { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: '💰 Salin Nominal', copy_code: String(total) }) },
                { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '💬 Tanya Owner', url: ownerUrl, merchant_url: ownerUrl }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📋 Riwayat', id: `${prefix}riwayat` }) },
            ]
        );
        return true;
    }

    if (command === 'confirm' || command === 'konfirmasi' || command === 'buktibayar') {
        const trxId = (text || '').trim();
        if (!trxId) { reply(`✅ Reply foto bukti + \`${prefix}confirm <ID TRX>\``); return true; }
        const trx = DB.getTransaksi(trxId);
        if (!trx) { reply(`❌ TRX \`${trxId}\` tidak ditemukan!`); return true; }
        if (trx.id_user !== sender) { reply(`❌ Bukan milikmu!`); return true; }
        if (trx.status === 'selesai') { reply(`✅ Sudah selesai!`); return true; }
        if (trx.status === 'batal') { reply(`❌ Sudah dibatalkan`); return true; }
        if (trx.payment_method === 'gateway') { reply(`⚡ Transaksi gateway, konfirmasi otomatis.\nCek: \`${prefix}cekbayar ${trxId}\``); return true; }
        const existKnf = DB.getKonfirmasiByTrx(trxId);
        if (existKnf && existKnf.status === 'menunggu') { reply(`⏳ Sudah dikirim, menunggu owner`); return true; }
        const quotedMsg = m.quoted;
        const isImage = quotedMsg && (quotedMsg.mtype === 'imageMessage' || (quotedMsg.msg?.mimetype && quotedMsg.msg.mimetype.startsWith('image/')));
        if (!isImage) { reply(`❌ Reply *foto* bukti bayar + \`${prefix}confirm ${trxId}\``); return true; }
        bulter.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });
        try {
            const imgBuf = await quotedMsg.download();
            const produk = DB.getProduk(trx.id_produk);
            const knfId = DB.simpanKonfirmasi(trxId, trx.id_produk, sender, namaUser, trx.jumlah, trx.total, quotedMsg.id || '');
            DB.updateTransaksi(trxId, 'dikonfirmasi', `KNF-${knfId}`);
            const ownerJid = getOwnerJid();
            if (ownerJid) {
                await bulter.sendMessage(ownerJid, {
                    image: imgBuf,
                    caption: `🔔 *ᴋᴏɴꜰɪʀᴍᴀsɪ ᴍᴀsᴜᴋ*\n\n║ 🆔 *KNF:* \`${knfId}\`\n║ 🆔 *TRX:* \`${trxId}\`\n║ 📦 *Produk:* ${produk?.nama || '-'} (x${trx.jumlah})\n║ 💰 *Total:* ${DB.formatRp(trx.total)}\n║ 👤 *User:* ${namaUser}\n║ 📅 *Waktu:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
                    mimetype: 'image/jpeg',
                });
                const fakeM = { chat: ownerJid, key: { remoteJid: ownerJid } };
                await sendInteractive(bulter, fakeM, generateWAMessageFromContent,
                    `⚡ *Aksi \`${knfId}\`*\n\n👤 ${namaUser} • ${DB.formatRp(trx.total)}`,
                    `🏪 ${global.namaBot || 'BulterBot'} Store`,
                    [
                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '✅ Approve', id: `${prefix}approvebayar ${knfId}` }) },
                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '❌ Tolak', id: `${prefix}rejectbayar ${knfId}` }) },
                        { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '💬 Chat User', url: `https://wa.me/${sender.split('@')[0]}`, merchant_url: `https://wa.me/${sender.split('@')[0]}` }) },
                    ]
                );
            }
            bulter.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
            reply(`✅ Konfirmasi \`${knfId}\` dikirim ke owner.\n⏳ Menunggu verifikasi...`);
        } catch (e) {
            bulter.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            reply(`❌ Gagal: ${e.message.slice(0, 100)}`);
        }
        return true;
    }

    if (command === 'cekbayar' || command === 'cekstatus' || command === 'checkpayment') {
        const trxId = (text || '').trim();
        if (!trxId) { reply(`🔍 Format: \`${prefix}cekbayar <ID TRX>\``); return true; }
        const trx = DB.getTransaksi(trxId);
        if (!trx) { reply(`❌ Tidak ditemukan`); return true; }
        if (trx.id_user !== sender && !isOwner) { reply(`❌ Bukan milikmu!`); return true; }
        if (trx.payment_method === 'manual') {
            reply(`📊 *Status*\n\n🆔 \`${trxId}\`\n📦 ${trx.nama_produk}\n💰 ${DB.formatRp(trx.total)}\n💳 Manual\n📊 ${trx.status.toUpperCase()}`);
            return true;
        }
        const pgRecord = DB.getPaymentGateway(trxId);
        if (!pgRecord) { reply(`❌ Data gateway tidak ditemukan`); return true; }
        try {
            const status = await midtrans.checkStatus(pgRecord.order_id);
            if (status.status !== pgRecord.status) {
                DB.updatePaymentGateway(pgRecord.id, status.status, status.rawStatus, status.paidAt);
                if (status.status === 'paid' && trx.status !== 'selesai') {
                    await processGatewaySuccess(bulter, trx, pgRecord);
                }
            }
            reply(`📊 *Status Pembayaran*\n\n🆔 \`${trxId}\`\n📦 ${trx.nama_produk}\n💰 ${DB.formatRp(pgRecord.total)}\n💳 Fee: ${DB.formatRp(pgRecord.fee)}\n⚡ ${pgRecord.method.toUpperCase()}\n📊 *${status.status.toUpperCase()}*` + (status.paidAt ? `\n✅ Paid: ${status.paidAt}` : ''));
        } catch (e) {
            reply(`❌ Gagal cek: ${e.message.slice(0, 100)}`);
        }
        return true;
    }

    if (command === 'cancelpay' || command === 'batalpay') {
        const trxId = (text || '').trim();
        if (!trxId) { reply(`❌ Format: \`${prefix}cancelpay <ID TRX>\``); return true; }
        const trx = DB.getTransaksi(trxId);
        if (!trx) { reply(`❌ Tidak ditemukan`); return true; }
        if (trx.id_user !== sender && !isOwner) { reply(`❌ Bukan milikmu!`); return true; }
        if (trx.status === 'selesai') { reply(`✅ Sudah selesai`); return true; }
        if (trx.status === 'batal') { reply(`❌ Sudah batal`); return true; }
        const pgRecord = DB.getPaymentGateway(trxId);
        if (pgRecord && pgRecord.status === 'pending') {
            try { await midtrans.cancelTransaction(pgRecord.order_id); } catch {}
            DB.updatePaymentGateway(pgRecord.id, 'cancelled', 'cancel', '');
            cleanupPolling(`${trxId}_${pgRecord.order_id}`);
        }
        DB.updateTransaksi(trxId, 'batal', 'Dibatalkan user');
        bulter.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
        reply(`❌ Transaksi \`${trxId}\` dibatalkan`);
        return true;
    }

    if (command === 'riwayat' || command === 'historibeli' || command === 'myorder') {
        const trxList = DB.getTransaksiUser(sender, 10);
        if (!trxList.length) { reply(`📋 Belum ada transaksi.\n_\`${prefix}listproduk\` untuk belanja_`); return true; }
        const sEmoji = { selesai: '✅', pending: '⏳', batal: '❌', dikonfirmasi: '🔔' };
        let txt = `📋 *ʀɪᴡᴀʏᴀᴛ ʙᴇʟɪ*\n\n`;
        trxList.forEach((t, i) => {
            const se = sEmoji[t.status] || '❓';
            const mi = t.payment_method === 'gateway' ? '⚡' : '📱';
            txt += `*${i+1}.* ${se} *${t.nama_produk || '-'}* (x${t.jumlah})\n   🆔 \`${t.id}\`\n   💰 ${DB.formatRp(t.total)} • ${t.status.toUpperCase()}\n   ${mi} ${t.payment_method === 'gateway' ? 'QRIS' : 'Manual'}\n` + (t.diskon > 0 ? `   🎟️ -${DB.formatRp(t.diskon)}\n` : '') + `   📅 ${DB.fmtDate(t.dibuat)}\n\n`;
        });
        await sendInteractive(bulter, m, generateWAMessageFromContent, txt.trim(), `🏪 ${global.namaBot || 'BulterBot'} Store`,
            [
                { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: '📋 ID Terakhir', copy_code: trxList[0].id }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏪 Belanja', id: `${prefix}listproduk` }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏆 Poin', id: `${prefix}poin` }) },
            ]
        );
        return true;
    }

    if (command === 'addwishlist') {
        const id = (text || '').trim();
        if (!id) { reply(`💖 Format: \`${prefix}addwishlist <ID>\``); return true; }
        const produk = DB.getProduk(id);
        if (!produk) { reply(`❌ Tidak ditemukan`); return true; }
        const result = DB.addWishlist(id, sender);
        if (!result.ok) { reply(`⚠️ ${result.msg}`); return true; }
        bulter.sendMessage(m.chat, { react: { text: '💖', key: m.key } });
        reply(`💖 *${produk.nama}* ditambahkan ke wishlist`);
        return true;
    }

    if (command === 'mywishlist' || command === 'wishlist') {
        const list = DB.getWishlistUser(sender);
        if (!list.length) { reply(`💖 Wishlist kosong`); return true; }
        let txt = `💖 *ᴡɪsʜʟɪsᴛ (${list.length})*\n\n`;
        list.forEach((w, i) => {
            txt += `*${i+1}. ${w.nama}*\n   ${DB.formatRp(w.harga)} • Stok: ${w.stok}\n   \`${w.id_produk}\`\n\n`;
        });
        reply(txt.trim());
        return true;
    }

    if (command === 'clearwishlist') { reply(`🗑️ ${DB.clearWishlistUser(sender)} item dihapus`); return true; }

    if (command === 'ulasan' || command === 'review') {
        const id = (text || '').trim();
        if (!id) { reply(`⭐ Format: \`${prefix}ulasan <ID>\``); return true; }
        const produk = DB.getProduk(id);
        if (!produk) { reply(`❌ Tidak ditemukan`); return true; }
        const ulasan = DB.getUlasanProduk(id, 5);
        const ri = DB.getRatingProduk(id);
        if (!ulasan.length) { reply(`⭐ Belum ada ulasan untuk *${produk.nama}*`); return true; }
        let txt = `⭐ *ᴜʟᴀsᴀɴ* — ${produk.nama}\n⭐ ${ri.avg}/5 (${ri.total} ulasan)\n\n`;
        ulasan.forEach((u, i) => {
            txt += `${i+1}. ${'⭐'.repeat(u.rating)} *${u.nama_user}*\n` + (u.komentar ? `   "${u.komentar}"\n` : '') + `   ${DB.fmtDate(u.dibuat)}\n\n`;
        });
        reply(txt.trim());
        return true;
    }

    if (command === 'addulasan' || command === 'reviewproduk') {
        const parts = (text || '').split('|').map(s => s.trim());
        const [id, rating, ...kParts] = parts;
        const komentar = kParts.join('|').trim();
        if (!id || !rating) { reply(`✍️ Format: \`${prefix}addulasan <ID> | <1-5> | <komentar>\`\nContoh: \`${prefix}addulasan PRD-123 | 5 | Bagus!\``); return true; }
        const produk = DB.getProduk(id);
        if (!produk) { reply(`❌ Tidak ditemukan`); return true; }
        if (!DB.sudahBeli(sender, id)) { reply(`❌ Harus beli dulu`); return true; }
        const trxUser = DB.getTransaksiUser(sender);
        const trxOk = trxUser.find(t => t.id_produk === id && t.status === 'selesai');
        if (!trxOk) { reply(`❌ Belum ada transaksi selesai`); return true; }
        const result = DB.addUlasan(id, sender, namaUser, trxOk.id, parseInt(rating), komentar);
        if (!result.ok) { reply(`❌ ${result.msg}`); return true; }
        bulter.sendMessage(m.chat, { react: { text: '⭐', key: m.key } });
        reply(`⭐ Ulasan ditambahkan!\n\n📦 ${produk.nama}\n${'⭐'.repeat(parseInt(rating))}\n💬 ${komentar || '-'}\n🏆 +10 poin`);
        return true;
    }

    if (command === 'poin' || command === 'mypoin') {
        const p = DB.getPoinUser(sender);
        if (!p) { reply(`🏆 Belum punya poin. Belanja dulu!`); return true; }
        const rw = DB.getRiwayatPoin(sender, 5);
        let rwTxt = '';
        if (rw.length) {
            rwTxt = '\n\n📋 *Riwayat:*\n';
            rw.forEach((r, i) => { rwTxt += `${i+1}. ${r.tipe === 'tambah' ? '+' : '-'}${Math.abs(r.perubahan)} — ${r.keterangan}\n`; });
        }
        reply(`🏆 *Poin Reward*\n\n🏆 Aktif: *${p.poin.toLocaleString()}*\n📊 Total: *${p.total_poin.toLocaleString()}*${rwTxt}\n\n_1000 poin = Rp 1.000_`);
        return true;
    }

    if (command === 'leaderboard' || command === 'topbuyer') {
        const top = DB.getLeaderboardPoin(10);
        if (!top.length) { reply(`🏆 Kosong`); return true; }
        let txt = `🏆 *ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ*\n\n`;
        top.forEach((u, i) => {
            const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
            txt += `${m} *${u.nama_user || u.id_user.split('@')[0]}*${u.id_user === sender ? ' ⬅️' : ''}\n   🏆 ${u.total_poin.toLocaleString()} poin\n\n`;
        });
        reply(txt.trim());
        return true;
    }

    return false;
}

module.exports = { handle };
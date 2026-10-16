'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(process.cwd(), 'database');
const DB_PATH = path.join(DB_DIR, 'store.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS produk (
    id          TEXT PRIMARY KEY,
    nama        TEXT NOT NULL,
    deskripsi   TEXT DEFAULT '',
    stok        INTEGER DEFAULT 0,
    harga       INTEGER DEFAULT 0,
    harga_coret INTEGER DEFAULT 0,
    kategori    TEXT DEFAULT 'umum',
    gambar_key  TEXT DEFAULT '',
    terjual     INTEGER DEFAULT 0,
    aktif       INTEGER DEFAULT 1,
    dibuat      INTEGER DEFAULT (strftime('%s','now')),
    diupdate    INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS transaksi (
    id             TEXT PRIMARY KEY,
    id_produk      TEXT NOT NULL,
    id_user        TEXT NOT NULL,
    nama_user      TEXT DEFAULT '',
    jumlah         INTEGER DEFAULT 1,
    total          INTEGER DEFAULT 0,
    total_asli     INTEGER DEFAULT 0,
    kode_voucher   TEXT DEFAULT '',
    diskon         INTEGER DEFAULT 0,
    poin_dipakai   INTEGER DEFAULT 0,
    payment_method TEXT DEFAULT 'manual',
    gateway_id     TEXT DEFAULT '',
    gateway_fee    INTEGER DEFAULT 0,
    status         TEXT DEFAULT 'pending',
    catatan        TEXT DEFAULT '',
    dibuat         INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (id_produk) REFERENCES produk(id)
  );

  CREATE TABLE IF NOT EXISTS konfirmasi (
    id            TEXT PRIMARY KEY,
    id_transaksi  TEXT NOT NULL,
    id_produk     TEXT NOT NULL,
    id_user       TEXT NOT NULL,
    nama_user     TEXT DEFAULT '',
    jumlah        INTEGER DEFAULT 1,
    total         INTEGER DEFAULT 0,
    bukti_key     TEXT DEFAULT '',
    status        TEXT DEFAULT 'menunggu',
    catatan_owner TEXT DEFAULT '',
    dibuat        INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (id_transaksi) REFERENCES transaksi(id)
  );

  CREATE TABLE IF NOT EXISTS kategori (
    id        TEXT PRIMARY KEY,
    nama      TEXT NOT NULL UNIQUE,
    emoji     TEXT DEFAULT '',
    deskripsi TEXT DEFAULT '',
    aktif     INTEGER DEFAULT 1,
    dibuat    INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS ulasan (
    id           TEXT PRIMARY KEY,
    id_produk    TEXT NOT NULL,
    id_user      TEXT NOT NULL,
    nama_user    TEXT DEFAULT '',
    id_transaksi TEXT NOT NULL,
    rating       INTEGER DEFAULT 5,
    komentar     TEXT DEFAULT '',
    aktif        INTEGER DEFAULT 1,
    dibuat       INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (id_produk) REFERENCES produk(id),
    FOREIGN KEY (id_transaksi) REFERENCES transaksi(id)
  );

  CREATE TABLE IF NOT EXISTS wishlist (
    id        TEXT PRIMARY KEY,
    id_produk TEXT NOT NULL,
    id_user   TEXT NOT NULL,
    dibuat    INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(id_produk, id_user),
    FOREIGN KEY (id_produk) REFERENCES produk(id)
  );

  CREATE TABLE IF NOT EXISTS voucher (
    id             TEXT PRIMARY KEY,
    kode           TEXT NOT NULL UNIQUE,
    tipe           TEXT DEFAULT 'persen',
    nilai          INTEGER DEFAULT 0,
    min_belanja    INTEGER DEFAULT 0,
    max_diskon     INTEGER DEFAULT 0,
    kuota          INTEGER DEFAULT 1,
    terpakai       INTEGER DEFAULT 0,
    aktif          INTEGER DEFAULT 1,
    berlaku_dari   INTEGER DEFAULT (strftime('%s','now')),
    berlaku_sampai INTEGER DEFAULT (strftime('%s','now', '+7 days')),
    dibuat         INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS voucher_log (
    id           TEXT PRIMARY KEY,
    kode_voucher TEXT NOT NULL,
    id_user      TEXT NOT NULL,
    id_transaksi TEXT NOT NULL,
    diskon       INTEGER DEFAULT 0,
    dibuat       INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS notifikasi (
    id     TEXT PRIMARY KEY,
    id_user TEXT NOT NULL,
    pesan  TEXT NOT NULL,
    tipe   TEXT DEFAULT 'info',
    dibaca INTEGER DEFAULT 0,
    dibuat INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS stok_log (
    id         TEXT PRIMARY KEY,
    id_produk  TEXT NOT NULL,
    perubahan  INTEGER DEFAULT 0,
    stok_lama  INTEGER DEFAULT 0,
    stok_baru  INTEGER DEFAULT 0,
    keterangan TEXT DEFAULT '',
    dibuat     INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (id_produk) REFERENCES produk(id)
  );

  CREATE TABLE IF NOT EXISTS flash_sale (
    id           TEXT PRIMARY KEY,
    id_produk    TEXT NOT NULL,
    harga_sale   INTEGER DEFAULT 0,
    stok_sale    INTEGER DEFAULT 0,
    terjual_sale INTEGER DEFAULT 0,
    mulai        INTEGER NOT NULL,
    selesai      INTEGER NOT NULL,
    aktif        INTEGER DEFAULT 1,
    dibuat       INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (id_produk) REFERENCES produk(id)
  );

  CREATE TABLE IF NOT EXISTS poin_user (
    id_user    TEXT PRIMARY KEY,
    nama_user  TEXT DEFAULT '',
    poin       INTEGER DEFAULT 0,
    total_poin INTEGER DEFAULT 0,
    diupdate   INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS poin_log (
    id         TEXT PRIMARY KEY,
    id_user    TEXT NOT NULL,
    perubahan  INTEGER DEFAULT 0,
    tipe       TEXT DEFAULT 'tambah',
    keterangan TEXT DEFAULT '',
    dibuat     INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS keranjang (
    id        TEXT PRIMARY KEY,
    id_user   TEXT NOT NULL,
    id_produk TEXT NOT NULL,
    jumlah    INTEGER DEFAULT 1,
    dibuat    INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(id_user, id_produk),
    FOREIGN KEY (id_produk) REFERENCES produk(id)
  );

  CREATE TABLE IF NOT EXISTS alamat_user (
    id       TEXT PRIMARY KEY,
    id_user  TEXT NOT NULL,
    nama     TEXT DEFAULT '',
    telepon  TEXT DEFAULT '',
    alamat   TEXT DEFAULT '',
    kota     TEXT DEFAULT '',
    provinsi TEXT DEFAULT '',
    kodepos  TEXT DEFAULT '',
    utama    INTEGER DEFAULT 0,
    dibuat   INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS payment_gateway (
    id             TEXT PRIMARY KEY,
    id_transaksi   TEXT NOT NULL,
    id_user        TEXT NOT NULL,
    gateway        TEXT DEFAULT 'midtrans',
    method         TEXT DEFAULT 'qris',
    order_id       TEXT DEFAULT '',
    transaction_id TEXT DEFAULT '',
    amount         INTEGER DEFAULT 0,
    fee            INTEGER DEFAULT 0,
    total          INTEGER DEFAULT 0,
    qr_url         TEXT DEFAULT '',
    deeplink_url   TEXT DEFAULT '',
    snap_url       TEXT DEFAULT '',
    snap_token     TEXT DEFAULT '',
    reference      TEXT DEFAULT '',
    status         TEXT DEFAULT 'pending',
    raw_status     TEXT DEFAULT '',
    paid_at        TEXT DEFAULT '',
    expired_at     TEXT DEFAULT '',
    dibuat         INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (id_transaksi) REFERENCES transaksi(id)
  );
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_transaksi_user   ON transaksi(id_user);
  CREATE INDEX IF NOT EXISTS idx_transaksi_produk ON transaksi(id_produk);
  CREATE INDEX IF NOT EXISTS idx_ulasan_produk    ON ulasan(id_produk);
  CREATE INDEX IF NOT EXISTS idx_wishlist_user    ON wishlist(id_user);
  CREATE INDEX IF NOT EXISTS idx_notif_user       ON notifikasi(id_user);
  CREATE INDEX IF NOT EXISTS idx_poin_user        ON poin_user(id_user);
  CREATE INDEX IF NOT EXISTS idx_keranjang_user   ON keranjang(id_user);
  CREATE INDEX IF NOT EXISTS idx_stoklog_produk   ON stok_log(id_produk);
  CREATE INDEX IF NOT EXISTS idx_pg_transaksi     ON payment_gateway(id_transaksi);
  CREATE INDEX IF NOT EXISTS idx_pg_orderid       ON payment_gateway(order_id);
  CREATE INDEX IF NOT EXISTS idx_pg_user          ON payment_gateway(id_user);
`);

const _migrations = [
    `ALTER TABLE produk     ADD COLUMN harga_coret   INTEGER DEFAULT 0`,
    `ALTER TABLE produk     ADD COLUMN gambar_key    TEXT    DEFAULT ''`,
    `ALTER TABLE produk     ADD COLUMN terjual       INTEGER DEFAULT 0`,
    `ALTER TABLE transaksi  ADD COLUMN payment_method TEXT   DEFAULT 'manual'`,
    `ALTER TABLE transaksi  ADD COLUMN pg_id          TEXT   DEFAULT ''`,
    `ALTER TABLE transaksi  ADD COLUMN voucher_kode   TEXT   DEFAULT ''`,
    `ALTER TABLE transaksi  ADD COLUMN diskon         INTEGER DEFAULT 0`,
    `ALTER TABLE transaksi  ADD COLUMN poin_dipakai   INTEGER DEFAULT 0`,
    `ALTER TABLE transaksi  ADD COLUMN nama_produk    TEXT   DEFAULT ''`,
];
for (const _sql of _migrations) {
    try { db.prepare(_sql).run(); } catch {}
}

function genId(prefix = 'P') {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
    return `${prefix}-${ts}${rand}`;
}

function formatRp(num) {
    return 'Rp ' + Number(num).toLocaleString('id-ID');
}

function fmtDate(ts) {
    return new Date(Number(ts) * 1000).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function nowTs() {
    return Math.floor(Date.now() / 1000);
}

function addProduk(nama, deskripsi = '', stok = 0, harga = 0, kategori = 'umum', hargaCoret = 0, gambarKey = '') {
    const id = genId('PRD');
    db.prepare(`INSERT INTO produk (id, nama, deskripsi, stok, harga, harga_coret, kategori, gambar_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, nama.trim(), deskripsi.trim(), Number(stok), Number(harga), Number(hargaCoret), kategori.trim(), gambarKey);
    _logStok(id, stok, 0, stok, 'Stok awal produk dibuat');
    return id;
}

function editProduk(id, fields = {}) {
    const allowed = ['nama', 'deskripsi', 'stok', 'harga', 'harga_coret', 'kategori', 'aktif', 'gambar_key'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) {
        if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (!sets.length) return false;
    sets.push(`diupdate = strftime('%s','now')`);
    vals.push(id);
    db.prepare(`UPDATE produk SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return true;
}

function delProduk(id) { return db.prepare(`UPDATE produk SET aktif = 0 WHERE id = ?`).run(id).changes > 0; }
function delProdukPermanent(id) { return db.prepare(`DELETE FROM produk WHERE id = ?`).run(id).changes > 0; }

function getAllProduk(kategori = null) {
    if (kategori) {
        return db.prepare(`SELECT p.*, COALESCE(AVG(u.rating), 0) as avg_rating, COUNT(u.id) as jml_ulasan FROM produk p LEFT JOIN ulasan u ON p.id = u.id_produk AND u.aktif = 1 WHERE p.aktif = 1 AND p.kategori = ? GROUP BY p.id ORDER BY p.dibuat DESC`).all(kategori);
    }
    return db.prepare(`SELECT p.*, COALESCE(AVG(u.rating), 0) as avg_rating, COUNT(u.id) as jml_ulasan FROM produk p LEFT JOIN ulasan u ON p.id = u.id_produk AND u.aktif = 1 WHERE p.aktif = 1 GROUP BY p.id ORDER BY p.dibuat DESC`).all();
}

function getProduk(id) {
    return db.prepare(`SELECT p.*, COALESCE(AVG(u.rating), 0) as avg_rating, COUNT(u.id) as jml_ulasan FROM produk p LEFT JOIN ulasan u ON p.id = u.id_produk AND u.aktif = 1 WHERE p.id = ? AND p.aktif = 1 GROUP BY p.id`).get(id);
}

function cariProduk(keyword) {
    const q = `%${keyword}%`;
    return db.prepare(`SELECT p.*, COALESCE(AVG(u.rating), 0) as avg_rating, COUNT(u.id) as jml_ulasan FROM produk p LEFT JOIN ulasan u ON p.id = u.id_produk AND u.aktif = 1 WHERE p.aktif = 1 AND (p.nama LIKE ? OR p.deskripsi LIKE ? OR p.kategori LIKE ?) GROUP BY p.id ORDER BY p.terjual DESC`).all(q, q, q);
}

function getProdukTerlaris(limit = 5) {
    return db.prepare(`SELECT p.*, COALESCE(AVG(u.rating), 0) as avg_rating, COUNT(u.id) as jml_ulasan FROM produk p LEFT JOIN ulasan u ON p.id = u.id_produk AND u.aktif = 1 WHERE p.aktif = 1 GROUP BY p.id ORDER BY p.terjual DESC LIMIT ?`).all(limit);
}

function getProdukTerbaik(limit = 5) {
    return db.prepare(`SELECT p.*, COALESCE(AVG(u.rating), 0) as avg_rating, COUNT(u.id) as jml_ulasan FROM produk p LEFT JOIN ulasan u ON p.id = u.id_produk AND u.aktif = 1 WHERE p.aktif = 1 GROUP BY p.id HAVING jml_ulasan > 0 ORDER BY avg_rating DESC, jml_ulasan DESC LIMIT ?`).all(limit);
}

function getProdukStokMenipis(batas = 5) {
    return db.prepare(`SELECT * FROM produk WHERE aktif = 1 AND stok <= ? AND stok > 0 ORDER BY stok ASC`).all(batas);
}

function getProdukStokHabis() {
    return db.prepare(`SELECT * FROM produk WHERE aktif = 1 AND stok = 0`).all();
}

function kurangiStok(id, jumlah = 1, keterangan = '') {
    const produk = getProduk(id);
    if (!produk) return { ok: false, msg: 'Produk tidak ditemukan' };
    if (produk.stok < jumlah) return { ok: false, msg: `Stok tidak cukup (tersisa ${produk.stok})` };
    const stokLama = produk.stok;
    db.prepare(`UPDATE produk SET stok = stok - ?, terjual = terjual + ?, diupdate = strftime('%s','now') WHERE id = ?`).run(jumlah, jumlah, id);
    _logStok(id, -jumlah, stokLama, stokLama - jumlah, keterangan || 'Stok dikurangi (pembelian)');
    return { ok: true };
}

function tambahStok(id, jumlah = 1, keterangan = '') {
    const produk = getProduk(id);
    if (!produk) return false;
    const stokLama = produk.stok;
    db.prepare(`UPDATE produk SET stok = stok + ?, diupdate = strftime('%s','now') WHERE id = ?`).run(jumlah, id);
    _logStok(id, jumlah, stokLama, stokLama + jumlah, keterangan || 'Stok ditambah (restock)');
    return true;
}

function addKategori(nama, emoji = '', deskripsi = '') {
    const id = genId('KTG');
    try { db.prepare(`INSERT INTO kategori (id, nama, emoji, deskripsi) VALUES (?, ?, ?, ?)`).run(id, nama.trim(), emoji, deskripsi.trim()); return id; }
    catch { return null; }
}

function getAllKategori() {
    return db.prepare(`SELECT k.*, COUNT(p.id) as jml_produk FROM kategori k LEFT JOIN produk p ON p.kategori = k.nama AND p.aktif = 1 WHERE k.aktif = 1 GROUP BY k.id ORDER BY k.nama ASC`).all();
}

function editKategori(id, fields = {}) {
    const allowed = ['nama', 'emoji', 'deskripsi', 'aktif'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) { if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); } }
    if (!sets.length) return false;
    vals.push(id);
    db.prepare(`UPDATE kategori SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return true;
}

function delKategori(id) { return db.prepare(`UPDATE kategori SET aktif = 0 WHERE id = ?`).run(id).changes > 0; }

function buatTransaksi(idProduk, idUser, namaUser = '', jumlah = 1, total = 0, kodeVoucher = '', diskon = 0, poinDipakai = 0, paymentMethod = 'manual', gatewayFee = 0) {
    const id = genId('TRX');
    const totalAsli = total + diskon + poinDipakai;
    db.prepare(`INSERT INTO transaksi (id, id_produk, id_user, nama_user, jumlah, total, total_asli, kode_voucher, diskon, poin_dipakai, payment_method, gateway_fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, idProduk, idUser, namaUser, jumlah, total, totalAsli, kodeVoucher, diskon, poinDipakai, paymentMethod, gatewayFee);
    return id;
}

function updateTransaksi(id, status, catatan = '') {
    db.prepare(`UPDATE transaksi SET status = ?, catatan = ? WHERE id = ?`).run(status, catatan, id);
}

function updateTransaksiGateway(id, gatewayId) {
    db.prepare(`UPDATE transaksi SET gateway_id = ? WHERE id = ?`).run(gatewayId, id);
}

function getTransaksi(id) {
    return db.prepare(`SELECT t.*, p.nama as nama_produk, p.harga FROM transaksi t LEFT JOIN produk p ON t.id_produk = p.id WHERE t.id = ?`).get(id);
}

function getAllTransaksi(limit = 30, status = null) {
    if (status) {
        return db.prepare(`SELECT t.*, p.nama as nama_produk FROM transaksi t LEFT JOIN produk p ON t.id_produk = p.id WHERE t.status = ? ORDER BY t.dibuat DESC LIMIT ?`).all(status, limit);
    }
    return db.prepare(`SELECT t.*, p.nama as nama_produk FROM transaksi t LEFT JOIN produk p ON t.id_produk = p.id ORDER BY t.dibuat DESC LIMIT ?`).all(limit);
}

function getTransaksiUser(idUser, limit = 10) {
    return db.prepare(`SELECT t.*, p.nama as nama_produk, p.harga FROM transaksi t LEFT JOIN produk p ON t.id_produk = p.id WHERE t.id_user = ? ORDER BY t.dibuat DESC LIMIT ?`).all(idUser, limit);
}

function sudahBeli(idUser, idProduk) {
    return !!db.prepare(`SELECT id FROM transaksi WHERE id_user = ? AND id_produk = ? AND status = 'selesai' LIMIT 1`).get(idUser, idProduk);
}

function simpanKonfirmasi(idTransaksi, idProduk, idUser, namaUser, jumlah, total, buktiKey = '') {
    const id = genId('KNF');
    db.prepare(`INSERT INTO konfirmasi (id, id_transaksi, id_produk, id_user, nama_user, jumlah, total, bukti_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, idTransaksi, idProduk, idUser, namaUser, jumlah, total, buktiKey);
    return id;
}

function getKonfirmasi(id) { return db.prepare(`SELECT * FROM konfirmasi WHERE id = ?`).get(id); }
function getKonfirmasiByTrx(idTransaksi) { return db.prepare(`SELECT * FROM konfirmasi WHERE id_transaksi = ? ORDER BY dibuat DESC LIMIT 1`).get(idTransaksi); }

function getKonfirmasiPending() {
    return db.prepare(`SELECT k.*, p.nama as nama_produk FROM konfirmasi k LEFT JOIN produk p ON k.id_produk = p.id WHERE k.status = 'menunggu' ORDER BY k.dibuat ASC`).all();
}

function updateKonfirmasi(id, status, catatanOwner = '') {
    db.prepare(`UPDATE konfirmasi SET status = ?, catatan_owner = ? WHERE id = ?`).run(status, catatanOwner, id);
}

function addUlasan(idProduk, idUser, namaUser, idTransaksi, rating = 5, komentar = '') {
    const existing = db.prepare(`SELECT id FROM ulasan WHERE id_produk = ? AND id_user = ? AND aktif = 1`).get(idProduk, idUser);
    if (existing) return { ok: false, msg: 'Kamu sudah pernah mengulas produk ini' };
    if (!sudahBeli(idUser, idProduk)) return { ok: false, msg: 'Kamu harus membeli produk ini terlebih dulu' };
    const id = genId('ULS');
    rating = Math.min(5, Math.max(1, Number(rating)));
    db.prepare(`INSERT INTO ulasan (id, id_produk, id_user, nama_user, id_transaksi, rating, komentar) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, idProduk, idUser, namaUser, idTransaksi, rating, komentar.trim());
    tambahPoin(idUser, namaUser, 10, 'Menulis ulasan produk');
    return { ok: true, id };
}

function getUlasanProduk(idProduk, limit = 10) {
    return db.prepare(`SELECT * FROM ulasan WHERE id_produk = ? AND aktif = 1 ORDER BY dibuat DESC LIMIT ?`).all(idProduk, limit);
}

function getRatingProduk(idProduk) {
    const result = db.prepare(`SELECT AVG(rating) as avg, COUNT(id) as total FROM ulasan WHERE id_produk = ? AND aktif = 1`).get(idProduk);
    return { avg: Math.round((result.avg || 0) * 10) / 10, total: result.total || 0 };
}

function delUlasan(id) { return db.prepare(`UPDATE ulasan SET aktif = 0 WHERE id = ?`).run(id).changes > 0; }

function addWishlist(idProduk, idUser) {
    try { const id = genId('WSH'); db.prepare(`INSERT INTO wishlist (id, id_produk, id_user) VALUES (?, ?, ?)`).run(id, idProduk, idUser); return { ok: true }; }
    catch { return { ok: false, msg: 'Produk sudah ada di wishlist' }; }
}

function delWishlist(idProduk, idUser) { return db.prepare(`DELETE FROM wishlist WHERE id_produk = ? AND id_user = ?`).run(idProduk, idUser).changes > 0; }

function getWishlistUser(idUser) {
    return db.prepare(`SELECT w.*, p.nama, p.harga, p.stok, p.gambar_key, COALESCE(AVG(u.rating), 0) as avg_rating FROM wishlist w LEFT JOIN produk p ON w.id_produk = p.id LEFT JOIN ulasan u ON p.id = u.id_produk AND u.aktif = 1 WHERE w.id_user = ? AND p.aktif = 1 GROUP BY w.id ORDER BY w.dibuat DESC`).all(idUser);
}

function cekWishlist(idProduk, idUser) { return !!db.prepare(`SELECT id FROM wishlist WHERE id_produk = ? AND id_user = ?`).get(idProduk, idUser); }
function clearWishlistUser(idUser) { return db.prepare(`DELETE FROM wishlist WHERE id_user = ?`).run(idUser).changes; }

function addVoucher(kode, tipe = 'persen', nilai = 0, minBelanja = 0, maxDiskon = 0, kuota = 1, hariAktif = 7) {
    const id = genId('VCR');
    const berlakuDari = nowTs();
    const berlakuSampai = berlakuDari + (hariAktif * 86400);
    try { db.prepare(`INSERT INTO voucher (id, kode, tipe, nilai, min_belanja, max_diskon, kuota, berlaku_dari, berlaku_sampai) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, kode.toUpperCase().trim(), tipe, Number(nilai), Number(minBelanja), Number(maxDiskon), Number(kuota), berlakuDari, berlakuSampai); return { ok: true, id, kode: kode.toUpperCase() }; }
    catch { return { ok: false, msg: 'Kode voucher sudah ada' }; }
}

function pakaiVoucher(kode, idUser, totalBelanja) {
    const now = nowTs();
    const vcr = db.prepare(`SELECT * FROM voucher WHERE kode = ? AND aktif = 1`).get(kode.toUpperCase());
    if (!vcr) return { ok: false, msg: 'Voucher tidak ditemukan' };
    if (now < vcr.berlaku_dari) return { ok: false, msg: 'Voucher belum aktif' };
    if (now > vcr.berlaku_sampai) return { ok: false, msg: 'Voucher sudah kadaluarsa' };
    if (vcr.terpakai >= vcr.kuota) return { ok: false, msg: 'Kuota voucher habis' };
    if (totalBelanja < vcr.min_belanja) return { ok: false, msg: `Minimal belanja ${formatRp(vcr.min_belanja)}` };
    const sudahPakai = db.prepare(`SELECT id FROM voucher_log WHERE kode_voucher = ? AND id_user = ?`).get(kode.toUpperCase(), idUser);
    if (sudahPakai) return { ok: false, msg: 'Kamu sudah pernah memakai voucher ini' };
    let diskon = 0;
    if (vcr.tipe === 'persen') {
        diskon = Math.round(totalBelanja * vcr.nilai / 100);
        if (vcr.max_diskon > 0) diskon = Math.min(diskon, vcr.max_diskon);
    } else { diskon = vcr.nilai; }
    diskon = Math.min(diskon, totalBelanja);
    return { ok: true, diskon, vcr };
}

function gunakanVoucher(kode, idUser, idTransaksi, diskon) {
    const id = genId('VLG');
    db.prepare(`INSERT INTO voucher_log (id, kode_voucher, id_user, id_transaksi, diskon) VALUES (?, ?, ?, ?, ?)`).run(id, kode.toUpperCase(), idUser, idTransaksi, diskon);
    db.prepare(`UPDATE voucher SET terpakai = terpakai + 1 WHERE kode = ?`).run(kode.toUpperCase());
}

function getAllVoucher() { return db.prepare(`SELECT * FROM voucher ORDER BY dibuat DESC`).all(); }
function getVoucher(kode) { return db.prepare(`SELECT * FROM voucher WHERE kode = ?`).get(kode.toUpperCase()); }

function editVoucher(id, fields = {}) {
    const allowed = ['nilai', 'min_belanja', 'max_diskon', 'kuota', 'aktif', 'berlaku_sampai'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) { if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); } }
    if (!sets.length) return false;
    vals.push(id);
    db.prepare(`UPDATE voucher SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return true;
}

function delVoucher(id) { return db.prepare(`UPDATE voucher SET aktif = 0 WHERE id = ?`).run(id).changes > 0; }

function addFlashSale(idProduk, hargaSale, stokSale, durasiMenit = 60) {
    const id = genId('FSL');
    const mulai = nowTs();
    const selesai = mulai + (durasiMenit * 60);
    db.prepare(`UPDATE flash_sale SET aktif = 0 WHERE id_produk = ?`).run(idProduk);
    db.prepare(`INSERT INTO flash_sale (id, id_produk, harga_sale, stok_sale, mulai, selesai) VALUES (?, ?, ?, ?, ?, ?)`).run(id, idProduk, Number(hargaSale), Number(stokSale), mulai, selesai);
    return id;
}

function getFlashSale(idProduk) {
    const now = nowTs();
    return db.prepare(`SELECT fs.*, p.nama as nama_produk, p.harga as harga_asli FROM flash_sale fs LEFT JOIN produk p ON fs.id_produk = p.id WHERE fs.id_produk = ? AND fs.aktif = 1 AND fs.mulai <= ? AND fs.selesai >= ? LIMIT 1`).get(idProduk, now, now);
}

function getAllFlashSale() {
    const now = nowTs();
    return db.prepare(`SELECT fs.*, p.nama as nama_produk, p.harga as harga_asli FROM flash_sale fs LEFT JOIN produk p ON fs.id_produk = p.id WHERE fs.aktif = 1 AND fs.mulai <= ? AND fs.selesai >= ? ORDER BY fs.selesai ASC`).all(now, now);
}

function stopFlashSale(id) { return db.prepare(`UPDATE flash_sale SET aktif = 0 WHERE id = ?`).run(id).changes > 0; }

function kurangiStokFlashSale(id, jumlah = 1) {
    const fs = db.prepare(`SELECT * FROM flash_sale WHERE id = ?`).get(id);
    if (!fs) return { ok: false, msg: 'Flash sale tidak ditemukan' };
    const sisa = fs.stok_sale - fs.terjual_sale;
    if (sisa < jumlah) return { ok: false, msg: `Stok flash sale tidak cukup (sisa ${sisa})` };
    db.prepare(`UPDATE flash_sale SET terjual_sale = terjual_sale + ? WHERE id = ?`).run(jumlah, id);
    return { ok: true };
}

function tambahPoin(idUser, namaUser, jumlah, keterangan = '') {
    const existing = db.prepare(`SELECT * FROM poin_user WHERE id_user = ?`).get(idUser);
    if (existing) {
        db.prepare(`UPDATE poin_user SET poin = poin + ?, total_poin = total_poin + ?, nama_user = ?, diupdate = strftime('%s','now') WHERE id_user = ?`).run(jumlah, jumlah, namaUser, idUser);
    } else {
        db.prepare(`INSERT INTO poin_user (id_user, nama_user, poin, total_poin) VALUES (?, ?, ?, ?)`).run(idUser, namaUser, jumlah, jumlah);
    }
    const logId = genId('PLG');
    db.prepare(`INSERT INTO poin_log (id, id_user, perubahan, tipe, keterangan) VALUES (?, ?, ?, 'tambah', ?)`).run(logId, idUser, jumlah, keterangan);
}

function kurangiPoin(idUser, jumlah, keterangan = '') {
    const user = getPoinUser(idUser);
    if (!user) return { ok: false, msg: 'User tidak punya poin' };
    if (user.poin < jumlah) return { ok: false, msg: `Poin tidak cukup (tersisa ${user.poin})` };
    db.prepare(`UPDATE poin_user SET poin = poin - ?, diupdate = strftime('%s','now') WHERE id_user = ?`).run(jumlah, idUser);
    const logId = genId('PLG');
    db.prepare(`INSERT INTO poin_log (id, id_user, perubahan, tipe, keterangan) VALUES (?, ?, ?, 'kurang', ?)`).run(logId, idUser, jumlah, keterangan);
    return { ok: true };
}

function getPoinUser(idUser) { return db.prepare(`SELECT * FROM poin_user WHERE id_user = ?`).get(idUser); }
function getLeaderboardPoin(limit = 10) { return db.prepare(`SELECT * FROM poin_user ORDER BY total_poin DESC LIMIT ?`).all(limit); }
function getRiwayatPoin(idUser, limit = 10) { return db.prepare(`SELECT * FROM poin_log WHERE id_user = ? ORDER BY dibuat DESC LIMIT ?`).all(idUser, limit); }

function addKeranjang(idUser, idProduk, jumlah = 1) {
    const existing = db.prepare(`SELECT * FROM keranjang WHERE id_user = ? AND id_produk = ?`).get(idUser, idProduk);
    if (existing) { db.prepare(`UPDATE keranjang SET jumlah = jumlah + ? WHERE id_user = ? AND id_produk = ?`).run(jumlah, idUser, idProduk); return { ok: true, update: true }; }
    const id = genId('KRJ');
    db.prepare(`INSERT INTO keranjang (id, id_user, id_produk, jumlah) VALUES (?, ?, ?, ?)`).run(id, idUser, idProduk, jumlah);
    return { ok: true, update: false };
}

function editKeranjang(idUser, idProduk, jumlah) {
    if (jumlah <= 0) return delKeranjang(idUser, idProduk);
    return db.prepare(`UPDATE keranjang SET jumlah = ? WHERE id_user = ? AND id_produk = ?`).run(jumlah, idUser, idProduk).changes > 0;
}

function delKeranjang(idUser, idProduk) { return db.prepare(`DELETE FROM keranjang WHERE id_user = ? AND id_produk = ?`).run(idUser, idProduk).changes > 0; }

function getKeranjangUser(idUser) {
    return db.prepare(`SELECT k.*, p.nama, p.harga, p.stok, p.gambar_key, (k.jumlah * p.harga) as subtotal FROM keranjang k LEFT JOIN produk p ON k.id_produk = p.id WHERE k.id_user = ? AND p.aktif = 1 ORDER BY k.dibuat DESC`).all(idUser);
}

function totalKeranjang(idUser) {
    const items = getKeranjangUser(idUser);
    return items.reduce((sum, i) => sum + i.subtotal, 0);
}

function clearKeranjang(idUser) { return db.prepare(`DELETE FROM keranjang WHERE id_user = ?`).run(idUser).changes; }

function addNotif(idUser, pesan, tipe = 'info') {
    const id = genId('NTF');
    db.prepare(`INSERT INTO notifikasi (id, id_user, pesan, tipe) VALUES (?, ?, ?, ?)`).run(id, idUser, pesan, tipe);
    return id;
}

function getNotifUser(idUser, onlyUnread = false) {
    if (onlyUnread) return db.prepare(`SELECT * FROM notifikasi WHERE id_user = ? AND dibaca = 0 ORDER BY dibuat DESC`).all(idUser);
    return db.prepare(`SELECT * FROM notifikasi WHERE id_user = ? ORDER BY dibuat DESC LIMIT 20`).all(idUser);
}

function bacaNotif(idUser) { return db.prepare(`UPDATE notifikasi SET dibaca = 1 WHERE id_user = ?`).run(idUser).changes; }
function countNotifUnread(idUser) { return db.prepare(`SELECT COUNT(*) as c FROM notifikasi WHERE id_user = ? AND dibaca = 0`).get(idUser).c; }

function _logStok(idProduk, perubahan, stokLama, stokBaru, keterangan = '') {
    const id = genId('SLG');
    db.prepare(`INSERT INTO stok_log (id, id_produk, perubahan, stok_lama, stok_baru, keterangan) VALUES (?, ?, ?, ?, ?, ?)`).run(id, idProduk, perubahan, stokLama, stokBaru, keterangan);
}

function getStokLog(idProduk, limit = 10) { return db.prepare(`SELECT * FROM stok_log WHERE id_produk = ? ORDER BY dibuat DESC LIMIT ?`).all(idProduk, limit); }

function addAlamat(idUser, nama, telepon, alamat, kota, provinsi, kodepos = '') {
    const id = genId('ALM');
    db.prepare(`UPDATE alamat_user SET utama = 0 WHERE id_user = ?`).run(idUser);
    db.prepare(`INSERT INTO alamat_user (id, id_user, nama, telepon, alamat, kota, provinsi, kodepos, utama) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(id, idUser, nama, telepon, alamat, kota, provinsi, kodepos);
    return id;
}

function getAlamatUser(idUser) { return db.prepare(`SELECT * FROM alamat_user WHERE id_user = ? ORDER BY utama DESC, dibuat DESC`).all(idUser); }
function getAlamatUtama(idUser) { return db.prepare(`SELECT * FROM alamat_user WHERE id_user = ? AND utama = 1 LIMIT 1`).get(idUser); }

function setAlamatUtama(id, idUser) {
    db.prepare(`UPDATE alamat_user SET utama = 0 WHERE id_user = ?`).run(idUser);
    return db.prepare(`UPDATE alamat_user SET utama = 1 WHERE id = ? AND id_user = ?`).run(id, idUser).changes > 0;
}

function delAlamat(id, idUser) { return db.prepare(`DELETE FROM alamat_user WHERE id = ? AND id_user = ?`).run(id, idUser).changes > 0; }

function simpanPaymentGateway(idTransaksi, idUser, method, orderId, transactionId, amount, fee, total, qrUrl, deeplinkUrl, snapUrl, snapToken, reference, expiredAt) {
    const id = genId('PGW');
    db.prepare(`INSERT INTO payment_gateway (id, id_transaksi, id_user, method, order_id, transaction_id, amount, fee, total, qr_url, deeplink_url, snap_url, snap_token, reference, expired_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, idTransaksi, idUser, method, orderId, transactionId || '', amount, fee, total, qrUrl || '', deeplinkUrl || '', snapUrl || '', snapToken || '', reference || '', expiredAt || '');
    return id;
}

function getPaymentGateway(idTransaksi) {
    return db.prepare(`SELECT * FROM payment_gateway WHERE id_transaksi = ? ORDER BY dibuat DESC LIMIT 1`).get(idTransaksi);
}

function getPaymentGatewayByOrderId(orderId) {
    return db.prepare(`SELECT * FROM payment_gateway WHERE order_id = ? LIMIT 1`).get(orderId);
}

function updatePaymentGateway(id, status, rawStatus = '', paidAt = '') {
    db.prepare(`UPDATE payment_gateway SET status = ?, raw_status = ?, paid_at = ? WHERE id = ?`).run(status, rawStatus, paidAt, id);
}

function getPaymentGatewayPending() {
    return db.prepare(`SELECT pg.*, t.nama_user, t.jumlah, p.nama as nama_produk FROM payment_gateway pg LEFT JOIN transaksi t ON pg.id_transaksi = t.id LEFT JOIN produk p ON t.id_produk = p.id WHERE pg.status = 'pending' ORDER BY pg.dibuat ASC`).all();
}

function getGatewayStats() {
    const total = db.prepare(`SELECT COUNT(*) as c FROM payment_gateway`).get().c;
    const paid = db.prepare(`SELECT COUNT(*) as c FROM payment_gateway WHERE status = 'paid'`).get().c;
    const pending = db.prepare(`SELECT COUNT(*) as c FROM payment_gateway WHERE status = 'pending'`).get().c;
    const expired = db.prepare(`SELECT COUNT(*) as c FROM payment_gateway WHERE status = 'expired'`).get().c;
    const failed = db.prepare(`SELECT COUNT(*) as c FROM payment_gateway WHERE status = 'failed'`).get().c;
    const totalAmount = db.prepare(`SELECT SUM(total) as s FROM payment_gateway WHERE status = 'paid'`).get().s || 0;
    const totalFee = db.prepare(`SELECT SUM(fee) as s FROM payment_gateway WHERE status = 'paid'`).get().s || 0;
    return { total, paid, pending, expired, failed, totalAmount, totalFee };
}

function getStatistik() {
    const totalProduk = db.prepare(`SELECT COUNT(*) as c FROM produk WHERE aktif = 1`).get().c;
    const totalTrx = db.prepare(`SELECT COUNT(*) as c FROM transaksi`).get().c;
    const trxSelesai = db.prepare(`SELECT COUNT(*) as c FROM transaksi WHERE status = 'selesai'`).get().c;
    const trxPending = db.prepare(`SELECT COUNT(*) as c FROM transaksi WHERE status = 'pending'`).get().c;
    const trxDitolak = db.prepare(`SELECT COUNT(*) as c FROM transaksi WHERE status = 'ditolak'`).get().c;
    const pendingKnf = db.prepare(`SELECT COUNT(*) as c FROM konfirmasi WHERE status = 'menunggu'`).get().c;
    const totalOmzet = db.prepare(`SELECT SUM(total) as s FROM transaksi WHERE status = 'selesai'`).get().s || 0;
    const totalVoucher = db.prepare(`SELECT COUNT(*) as c FROM voucher WHERE aktif = 1`).get().c;
    const totalUlasan = db.prepare(`SELECT COUNT(*) as c FROM ulasan WHERE aktif = 1`).get().c;
    const stokMenipis = db.prepare(`SELECT COUNT(*) as c FROM produk WHERE aktif = 1 AND stok <= 5 AND stok > 0`).get().c;
    const stokHabis = db.prepare(`SELECT COUNT(*) as c FROM produk WHERE aktif = 1 AND stok = 0`).get().c;
    const flashSaleAktif = db.prepare(`SELECT COUNT(*) as c FROM flash_sale WHERE aktif = 1 AND selesai >= ?`).get(nowTs()).c;
    const totalPelanggan = db.prepare(`SELECT COUNT(DISTINCT id_user) as c FROM transaksi`).get().c;
    const avgRating = db.prepare(`SELECT AVG(rating) as a FROM ulasan WHERE aktif = 1`).get().a || 0;
    const startOfDay = Math.floor(new Date().setHours(0,0,0,0) / 1000);
    const omzetHariIni = db.prepare(`SELECT SUM(total) as s FROM transaksi WHERE status = 'selesai' AND dibuat >= ?`).get(startOfDay).s || 0;
    const startOfMonth = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
    const omzetBulanIni = db.prepare(`SELECT SUM(total) as s FROM transaksi WHERE status = 'selesai' AND dibuat >= ?`).get(startOfMonth).s || 0;
    const gwStats = getGatewayStats();
    return { totalProduk, totalTrx, trxSelesai, trxPending, trxDitolak, pendingKnf, totalOmzet, totalVoucher, totalUlasan, stokMenipis, stokHabis, flashSaleAktif, totalPelanggan, avgRating: Math.round(avgRating * 10) / 10, omzetHariIni, omzetBulanIni, gwStats };
}

function getStatProduk() {
    return db.prepare(`SELECT p.id, p.nama, p.terjual, p.stok, COUNT(t.id) as total_order, SUM(t.total) as total_omzet, COALESCE(AVG(u.rating), 0) as avg_rating FROM produk p LEFT JOIN transaksi t ON p.id = t.id_produk AND t.status = 'selesai' LEFT JOIN ulasan u ON p.id = u.id_produk AND u.aktif = 1 WHERE p.aktif = 1 GROUP BY p.id ORDER BY p.terjual DESC`).all();
}

function getTopPelanggan(limit = 10) {
    return db.prepare(`SELECT id_user, nama_user, COUNT(id) as total_order, SUM(total) as total_belanja FROM transaksi WHERE status = 'selesai' GROUP BY id_user ORDER BY total_belanja DESC LIMIT ?`).all(limit);
}

module.exports = {
    addProduk, editProduk, delProduk, delProdukPermanent,
    getAllProduk, getProduk, cariProduk,
    getProdukTerlaris, getProdukTerbaik,
    getProdukStokMenipis, getProdukStokHabis,
    kurangiStok, tambahStok,
    addKategori, getAllKategori, editKategori, delKategori,
    buatTransaksi, updateTransaksi, updateTransaksiGateway, getTransaksi,
    getAllTransaksi, getTransaksiUser, sudahBeli,
    simpanKonfirmasi, getKonfirmasi, getKonfirmasiByTrx,
    getKonfirmasiPending, updateKonfirmasi,
    addUlasan, getUlasanProduk, getRatingProduk, delUlasan,
    addWishlist, delWishlist, getWishlistUser,
    cekWishlist, clearWishlistUser,
    addVoucher, pakaiVoucher, gunakanVoucher,
    getAllVoucher, getVoucher, editVoucher, delVoucher,
    addFlashSale, getFlashSale, getAllFlashSale,
    stopFlashSale, kurangiStokFlashSale,
    tambahPoin, kurangiPoin, getPoinUser,
    getLeaderboardPoin, getRiwayatPoin,
    addKeranjang, editKeranjang, delKeranjang,
    getKeranjangUser, totalKeranjang, clearKeranjang,
    addNotif, getNotifUser, bacaNotif, countNotifUnread,
    getStokLog,
    addAlamat, getAlamatUser, getAlamatUtama,
    setAlamatUtama, delAlamat,
    simpanPaymentGateway, getPaymentGateway, getPaymentGatewayByOrderId,
    updatePaymentGateway, getPaymentGatewayPending, getGatewayStats,
    getStatistik, getStatProduk, getTopPelanggan,
    formatRp, fmtDate, genId, nowTs,
};
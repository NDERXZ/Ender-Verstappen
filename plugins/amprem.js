const axios = require('axios');
const crypto = require('crypto');

const cfg = {
 key: Buffer.from('QUl6YVN5RHRHMUFVMjJFcm5RRDYwQXpCQWNha255U2l6OV9DRXEw', 'base64').toString('utf8'),
 idt: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty',
 stk: 'https://securetoken.googleapis.com/v1/token',
 vfy: 'https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase'
};

const dip = () => [crypto.randomInt(1,255), crypto.randomInt(0,255), crypto.randomInt(0,255), crypto.randomInt(1,255)].join('.');

const sp = h => ({
 ...h,
 'x-forwarded-for': dip(),
 'x-real-ip': dip(),
 'client-ip': dip(),
 'x-client-ip': dip(),
 'x-originating-ip': dip(),
 'x-cluster-client-ip': dip()
});

const h1 = {
 'content-type': 'application/json',
 'x-android-package': 'com.alightcreative.motion',
 'x-android-cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
 'user-agent': 'dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)'
};

const h2 = {
 'content-type': 'application/json; charset=utf-8',
 'user-agent': 'okhttp/3.12.1',
 'accept-encoding': 'gzip'
};

const bad = e => {
 const d = e.response?.data;
 return d ? (typeof d === 'object' ? JSON.stringify(d) : String(d)) : e.message;
};

async function link(email) {
 const c1 = { identifier: email, continueUri: 'http://localhost' };
 const c2 = {
 requestType: 6,
 email: email,
 androidInstallApp: true,
 canHandleCodeInApp: true,
 continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
 iosBundleId: 'com.alightcreative.motion',
 androidPackageName: 'com.alightcreative.motion',
 androidMinimumVersion: '585',
 clientType: 'CLIENT_TYPE_ANDROID'
 };
 try {
 await axios.post(`${cfg.idt}/createAuthUri?key=${cfg.key}`, c1, { headers: sp(h1) });
 const r = await axios.post(`${cfg.idt}/getOobConfirmationCode?key=${cfg.key}`, c2, { headers: sp(h1) });
 return { ok: true, r: r.data };
 } catch (e) {
 return { ok: false, why: bad(e) };
 }
}

function code(raw) {
 if (!raw) return null;
 let s = String(raw).replace(/&/g, '&');
 try {
 s = decodeURIComponent(s);
 } catch {}
 try {
 const u = new URL(s);
 let c = u.searchParams.get('oobCode');
 if (!c) {
 const n = u.searchParams.get('link') || u.searchParams.get('q') || u.searchParams.get('url');
 if (n) {
 try {
 c = new URL(n).searchParams.get('oobCode');
 } catch {}
 }
 }
 if (c) return c.replace(/[^a-zA-Z0-9_-]/g, '');
 } catch {}
 const m = s.match(/oobCode=([a-zA-Z0-9_-]+)/i);
 if (m) return m[1];
 const t = raw.trim();
 if (/^[a-zA-Z0-9_-]{10,}$/.test(t) && !t.includes('://')) return t;
 return null;
}

async function auth(email, raw) {
 const c = code(raw);
 if (!c) return { ok: false, why: 'Code tidak ditemukan' };
 try {
 const a = await axios.post(`${cfg.idt}/emailLinkSignin?key=${cfg.key}`, {
 email: email,
 oobCode: c,
 clientType: 'CLIENT_TYPE_ANDROID'
 }, { headers: sp(h1) });
 let u = null;
 try {
 const b = await axios.post(`${cfg.idt}/getAccountInfo?key=${cfg.key}`, {
 idToken: a.data.idToken
 }, { headers: sp(h1) });
 u = b.data?.users?.[0] || null;
 } catch {}
 return {
 ok: true,
 email: email,
 id: a.data.idToken,
 ref: a.data.refreshToken,
 uid: a.data.localId,
 baru: !!a.data.isNewUser,
 user: u
 };
 } catch (e) {
 return { ok: false, why: bad(e) };
 }
}

async function pro(id) {
 const o = 'neo-' + crypto.randomBytes(6).toString('hex');
 const b = {
 data: {
 productId: 'am.full.sub.annual.19q4',
 token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
 skuType: 'subs',
 orderId: o
 }
 };
 const h = {
 ...h2,
 authorization: 'Bearer ' + id,
 'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
 };
 try {
 const r = await axios.post(cfg.vfy, b, { headers: sp(h) });
 return { ok: true, order: o, r: r.data };
 } catch (e) {
 return { ok: false, why: bad(e) };
 }
}

async function re(ref) {
 try {
 const r = await axios.post(`${cfg.stk}?key=${cfg.key}`, {
 grant_type: 'refresh_token',
 refresh_token: ref
 });
 return { ok: true, id: r.data.id_token, ref: r.data.refresh_token };
 } catch (e) {
 return { ok: false, why: bad(e) };
 }
}

const sessions = new Map();

let handler = async (m, { Cantarella, text, usedPrefix, command }) => {
 if (!text) {
 await Cantarella.sendMessage(m.chat, { 
 text: `⚠️ *Format salah!*\n\n📌 *Cara Penggunaan:*\n\n1️⃣ Kirim link verifikasi:\n${usedPrefix + command} email@example.com\n\n2️⃣ Verifikasi & Premium:\n${usedPrefix + command} email@example.com | link_verifikasi` 
 }, { quoted: m });
 return;
 }

 if (text.includes('|')) {

 const parts = text.split('|').map(p => p.trim());
 const em = parts[0];
 const linkUrl = parts[1];
 
 if (!em || !linkUrl) {
 await Cantarella.sendMessage(m.chat, { 
 text: `⚠️ Format salah!\n\n📌 Gunakan:\n${usedPrefix + command} email@example.com | link_verifikasi` 
 }, { quoted: m });
 return;
 }
 

 const sender = m.sender;
 if (!sessions.has(sender)) {
 sessions.set(sender, {});
 }
 const session = sessions.get(sender);
 session.email = em;
 
 const v = await auth(em, linkUrl);
 if (!v.ok) {
 await Cantarella.sendMessage(m.chat, { 
 text: `❌ Gagal verifikasi: ${v.why}` 
 }, { quoted: m });
 return;
 }
 
 await Cantarella.sendMessage(m.chat, { 
 text: `✅ *Login berhasil!*\n📧 Email: ${v.email}\n🆕 Akun baru: ${v.baru ? 'Ya' : 'Tidak'}\n\n⏳ *Mempromosikan akun...*` 
 }, { quoted: m });
 
 const q = await pro(v.id);
 if (q.ok) {

 const sessionData = sessions.get(sender) || {};
 sessionData.email = em;
 sessionData.id = v.id;
 sessionData.ref = v.ref;
 sessionData.uid = v.uid;
 sessionData.pro = true;
 sessions.set(sender, sessionData);
 
 await Cantarella.sendMessage(m.chat, { 
 text: `✅ *PREMIUM SUCCESS!*\n\n📧 Email: ${em}\n🆔 Order: ${q.order}\n📅 Status: Active\n\n🎉 Akun Alight Motion telah dipremium!` 
 }, { quoted: m });
 } else {
 await Cantarella.sendMessage(m.chat, { 
 text: `❌ Gagal mempromosikan: ${q.why}` 
 }, { quoted: m });
 }
 } else {

 const isEmail = text.includes('@') && !text.includes('http');
 const isLink = text.includes('http') || text.includes('oobCode');

 if (isEmail) {

 const em = text.trim();
 const r = await link(em);
 if (r.ok) {

 const sender = m.sender;
 if (!sessions.has(sender)) {
 sessions.set(sender, {});
 }
 const session = sessions.get(sender);
 session.email = em;
 
 await Cantarella.sendMessage(m.chat, { 
 text: `✅ *Link verifikasi telah dikirim!*\n\n📧 Email: ${em}\n📬 Cek inbox atau folder spam\n📋 Copy link verifikasi, lalu gunakan:\n${usedPrefix + command} ${em} | <link>` 
 }, { quoted: m });
 } else {
 await Cantarella.sendMessage(m.chat, { 
 text: `❌ Gagal mengirim link: ${r.why}` 
 }, { quoted: m });
 }
 } else if (isLink) {

 const sender = m.sender;
 const session = sessions.get(sender);
 let em = session?.email || null;
 
 if (!em) {
 await Cantarella.sendMessage(m.chat, { 
 text: `⚠️ Email tidak ditemukan. Gunakan format:\n.amprem-verif email@example.com | link_verifikasi` 
 }, { quoted: m });
 return;
 }
 
 const v = await auth(em, text);
 if (!v.ok) {
 await Cantarella.sendMessage(m.chat, { 
 text: `❌ Gagal verifikasi: ${v.why}` 
 }, { quoted: m });
 return;
 }
 
 await Cantarella.sendMessage(m.chat, { 
 text: `✅ *Login berhasil!*\n📧 Email: ${v.email}\n🆕 Akun baru: ${v.baru ? 'Ya' : 'Tidak'}\n\n⏳ *Mempromosikan akun...*` 
 }, { quoted: m });
 
 const q = await pro(v.id);
 if (q.ok) {
 // Save session
 const sessionData = sessions.get(sender) || {};
 sessionData.email = em;
 sessionData.id = v.id;
 sessionData.ref = v.ref;
 sessionData.uid = v.uid;
 sessionData.pro = true;
 sessions.set(sender, sessionData);
 
 await Cantarella.sendMessage(m.chat, { 
 text: `✅ *PREMIUM SUCCESS!*\n\n📧 Email: ${em}\n🆔 Order: ${q.order}\n📅 Status: Active\n\n🎉 Akun Alight Motion telah dipremium!` 
 }, { quoted: m });
 } else {
 await Cantarella.sendMessage(m.chat, { 
 text: `❌ Gagal mempromosikan: ${q.why}` 
 }, { quoted: m });
 }
 } else {
 await Cantarella.sendMessage(m.chat, { 
 text: `⚠️ Format tidak valid!\n\n📌 *Cara Penggunaan:*\n\n1️⃣ Kirim link:\n${usedPrefix + command} email@example.com\n\n2️⃣ Verifikasi:\n${usedPrefix + command} email@example.com | link_verifikasi` 
 }, { quoted: m });
 }
 }
};

handler.help = ['amprem-send', 'amprem-verif'];
handler.tags = ['premium'];
handler.command = /^(amprem-send|amprem-verif)$/i;
handler.limit = true;
handler.premium = true;

module.exports = handler;
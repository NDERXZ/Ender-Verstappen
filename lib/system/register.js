'use strict';
const {
    loadRegistrationState, saveRegistrationState,
    getRegisteredProfile, upsertRegisteredProfile,
} = require('./registrationStore');


function clearRegState(jid) {
    const s = loadRegistrationState(); delete s.users[jid]; saveRegistrationState(s);
}

function _parseDob(input) {
    const t = String(input||'').trim();
    const m = t.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/) ||
              t.match(/^(\d{2})(\d{2})(\d{4})$/) ||
              t.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
    if (!m) return null;
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(y, mo-1, d);
    if (dt.getFullYear()!==y || dt.getMonth()!==mo-1 || dt.getDate()!==d) return null;
    return { day:d, month:mo, year:y, date:dt };
}

function _calcAge(dob) {
    const t = new Date(); let age = t.getFullYear() - dob.year;
    if (t.getMonth() < dob.month-1 || (t.getMonth()===dob.month-1 && t.getDate()<dob.day)) age--;
    return age;
}

function _normSpace(t) { return String(t||'').replace(/\s+/g,' ').trim(); }

function _cleanName(input) {
    const t = _normSpace(input)
        .replace(/^(my name is|i am|i'm|im|name is|this is)\s+/i,'')
        .replace(/[.,!?]+$/g,'').trim();
    if (!t || /\d{6,}/.test(t) || t.length < 2 || t.length > 30) return null;
    return t;
}

function _parseBioChoice(input) {
    const n = _normSpace(input).toLowerCase();
    if (['yes','y','haan','han','ha','bio','sure','ok','okay','iya','ya','boleh','mau'].includes(n)) return 'yes';
    if (['no','n','skip','nope','nah','tidak','ga','gak','nggak','kagak','enggak','ogah'].includes(n)) return 'no';
    return null;
}

async function _groqAsk(step, input) {
    try {
        // Pakai groqChat multi-key dari bulter.js via global
        const fn = global._groqChatFn;
        if (typeof fn !== 'function') return null;
        const _SYSTEM = 'Extract registration data from WhatsApp messages. Return STRICT JSON only. ' +
            'For step=name: {"type":"name","value":"..."} or {"type":"unknown"}. ' +
            'For step=dob: {"type":"dob","value":"DD/MM/YYYY"} or {"type":"unknown"}. ' +
            'For step=bio_choice: {"type":"bio_choice","value":"yes"} or {"type":"bio_choice","value":"no"} or {"type":"unknown"}. ' +
            'For step=bio_text: {"type":"bio","value":"..."} or {"type":"unknown"}. ' +
            'NEVER invent data. Only extract what user typed.';
        const _userMsg = _SYSTEM + '\n\nInput: ' + JSON.stringify({ step, input });
        const result = await fn(_userMsg, {
            model: 'llama8b',
            temp: 'precise',
            maxTokens: 120,
            jsonMode: true,
        });
        const text = (typeof result === 'object' && result !== null) ? (result.text || result.content || '') : String(result || '');
        if (!text) return null;
        // Strip markdown code fences jika ada
        const clean = text.replace(/```json|```/g,'').trim();
        return JSON.parse(clean);
    } catch { return null; }
}

async function _resolveName(input) {
    const h = _cleanName(input); if (h) return h;
    const ai = await _groqAsk('name', input);
    if (ai?.type==='name' && ai.value) { const c = _cleanName(ai.value); if (c) return c; }
    return null;
}

async function _resolveDob(input) {
    const h = _parseDob(input); if (h) return h;
    const ai = await _groqAsk('dob', input);
    if (ai?.type==='dob' && ai.value) return _parseDob(ai.value);
    return null;
}

async function _resolveBioChoice(input) {
    const h = _parseBioChoice(input); if (h) return h;
    const ai = await _groqAsk('bio_choice', input);
    if (ai?.type==='bio_choice' && ['yes','no'].includes(ai.value)) return ai.value;
    return null;
}

async function _resolveBio(input) {
    const t = _normSpace(input).slice(0,80); if (t) return t;
    const ai = await _groqAsk('bio_text', input);
    return ai?.type==='bio' && ai.value ? _normSpace(ai.value).slice(0,80) : '';
}

function formatRegProfile(profile) {
    const lines = [
        `╔═ ✅ *ᴘʀᴏꜰɪʟ ᴛᴇʀᴅᴀꜰᴛᴀʀ* ✦`,
        `║ 📛 Nama  : *${profile.name}*`,
        `║ 🆔 ID    : *${profile.userId}*`,
        `║ 🎂 DOB   : *${profile.dob || '-'}*`,
        `║ 🎯 Usia  : *${profile.age != null ? profile.age + ' tahun' : '-'}*`,
        profile.bio ? `║ 📝 Bio   : _${profile.bio.slice(0,50)}_` : null,
        `║ 🌐 Net   : *${profile.network || 'BulterBot'}*`,
        `║ 🃏 Card  : *${(profile.card || 'starter').toUpperCase()}*`,
        `║ ✅ Status: *${profile.status || 'active'}*`,
        `╚═════`,
    ].filter(Boolean).join('\n');
    return lines;
}
const _exReply = (sock, chatId, message, text, thumbnail) =>
    sock.sendMessage(chatId, {
        text,
        contextInfo: {
            externalAdReply: {
                title: `${global.namaBot || 'Bot'} • Registrasi`,
                body: '',
                thumbnailUrl: thumbnail || global?.thumnail2 || '',
                mediaType: 1, previewType: 0,
                sourceUrl: "",
            }
        }
    }, { quoted: message });

async function startRegisterCommand(sock, chatId, message, senderId) {
    const existing = getRegisteredProfile(senderId);
    if (existing) {
        clearRegState(senderId);
        return _exReply(sock, chatId, message,
            `✅ *Kamu sudah terdaftar!*\n\n${formatRegProfile(existing)}\n\n_Ketik ${global?.prefix || '.'}profilereg untuk melihat kartu profil._`
        );
    }

    const s = loadRegistrationState();
    s.users[senderId] = { step:'name', data:{}, invalidDobCount:0 };
    saveRegistrationState(s);

    await _exReply(sock, chatId, message,
        `🔐 *SELAMAT DATANG DI REGISTRASI*\n\n` +
        `╔═ 📋 *ᴘʀᴏꜱᴇs ʀᴇɢɪsᴛʀᴀsɪ* ✦\n` +
        `║ Langkah 1/3: Nama\n` +
        `║ Langkah 2/3: Tanggal Lahir\n` +
        `║ Langkah 3/3: Bio (opsional)\n` +
        `╚═════\n\n` +
        `Pertama, siapa *namamu*? 👤`
    );
}

async function handleRegisterReply(sock, chatId, message, senderId, rawText) {
    const input = String(rawText||'').trim();
    if (!input || input.startsWith('.') || input.startsWith('/') || input.startsWith('#')) return false;

    const s = loadRegistrationState();
    const cur = s.users[senderId];
    if (!cur) return false;

    if (cur.step === 'name') {
        const name = await _resolveName(input);
        if (!name) {
            await _exReply(sock, chatId, message,
                `❓ *Nama tidak valid.*\n\nCoba ketik nama lengkap kamu ya!\nContoh: _Ryo Yamada_`
            );
            return true;
        }
        cur.data.name = name;
        cur.step = 'dob';
        cur.invalidDobCount = 0;
        saveRegistrationState(s);
        await _exReply(sock, chatId, message,
            `✅ Halo, *${name}*!\n\n` +
            `╔═ 📅 *ᴛᴀɴɢɢᴀʟ ʟᴀʜɪʀ* ✦\n` +
            `║ Langkah 2/3\n` +
            `║ Format: *DD/MM/YYYY*\n` +
            `╚═════\n\n` +
            `Kapan kamu lahir? 🎂`
        );
        return true;
    }

    if (cur.step === 'dob') {
        const dob = await _resolveDob(input);
        if (!dob) {
            cur.invalidDobCount = (cur.invalidDobCount || 0) + 1;
            saveRegistrationState(s);
            await _exReply(sock, chatId, message,
                cur.invalidDobCount > 1
                    ? `❓ Format: *DD/MM/YYYY*\nContoh: _02/04/2003_`
                    : `❓ *Tanggal lahir tidak valid.*\n\nKirim dalam format *DD/MM/YYYY*\nContoh: _02/04/2003_`
            );
            return true;
        }
        cur.data.dob = `${String(dob.day).padStart(2,'0')}/${String(dob.month).padStart(2,'0')}/${dob.year}`;
        cur.data.age = _calcAge(dob);
        cur.step = 'bio_choice';
        cur.invalidDobCount = 0;
        saveRegistrationState(s);
        await _exReply(sock, chatId, message,
            `✅ Tanggal lahir tersimpan! (Usia: *${cur.data.age} tahun*)\n\n` +
            `╔═ 📝 *ʙɪᴏ* ✦\n` +
            `║ Langkah 3/3\n` +
            `║ Mau tambah bio/deskripsi diri?\n` +
            `╚═════\n\n` +
            `Ketik *ya* untuk isi bio, atau *skip* untuk lewati.`
        );
        return true;
    }

    if (cur.step === 'bio_choice') {
        const choice = await _resolveBioChoice(input);
        if (choice === 'yes') {
            cur.step = 'bio_text';
            saveRegistrationState(s);
            await _exReply(sock, chatId, message,
                `📝 *Isi bio kamu!*\n\n_Ceritakan sedikit tentang dirimu (max 80 karakter)_`
            );
            return true;
        }
        if (choice === 'no') {
            const profile = upsertRegisteredProfile(senderId, cur.data);
            delete s.users[senderId];
            saveRegistrationState(s);
            await _sendComplete(sock, chatId, message, senderId, profile);
            return true;
        }
        await _exReply(sock, chatId, message,
            `Ketik *ya* untuk isi bio, atau *skip* untuk lewati. 😊`
        );
        return true;
    }

    if (cur.step === 'bio_text') {
        cur.data.bio = await _resolveBio(input);
        const profile = upsertRegisteredProfile(senderId, cur.data);
        delete s.users[senderId];
        saveRegistrationState(s);
        await _sendComplete(sock, chatId, message, senderId, profile);
        return true;
    }

    return false;
}

async function _sendComplete(sock, chatId, message, senderId, profile) {
    let avatarUrl = null;
    try { avatarUrl = await sock.profilePictureUrl(senderId, 'image'); } catch {}

    try {
        const { generateRegisterCard } = require('../canvas/registerCardCanvas');
        const image = await generateRegisterCard({
            name:      profile.name,
            userId:    profile.userId,
            dob:       profile.dob,
            age:       profile.age,
            bio:       profile.bio || 'new recruit',
            avatarUrl,
            network:   profile.network || 'BulterBot',
            cardType:  profile.card || 'starter',
            status:    profile.status || 'active',
        });
        await sock.sendMessage(chatId, {
            image,
            mimetype: 'image/png',
            caption:
                `🎉 *REGISTRASI BERHASIL!*\n\n` +
                formatRegProfile(profile) + `\n\n` +
                `_Selamat bergabung! Nikmati semua fitur bot sekarang 🚀_`,
            mentions: [senderId],
        }, { quoted: message });
        return;
    } catch(e) { console.error('[Register] card error:', e.message); }

    // fallback text
    await sock.sendMessage(chatId, {
        text:
            `🎉 *REGISTRASI BERHASIL!*\n\n` +
            formatRegProfile(profile) + `\n\n` +
            `_Selamat bergabung! Nikmati semua fitur bot sekarang 🚀_`,
        mentions: [senderId],
    }, { quoted: message });
}

module.exports = {
    startRegisterCommand,
    handleRegisterReply,
    getRegisteredProfile,
    clearRegState,
    formatRegProfile,
};

/**
 * Agentic AI Assistant for Ender Verstappen Bot
 * Exclusively responds to Owner and Bot in Groups
 * Features:
 * - Direct AI Chat & Reasoning with Gemini 3.6 Flash
 * - Full Bot Knowledge Base & Troubleshooting
 * - Autonomous Action Engine (Stickers, Music, Brat, Image Search)
 * Creator: Chaidar
 */

const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');

const getExif = () => { try { return require('./exif'); } catch (_) { return {}; } };
const getBrat = () => { try { return require('./canvas/brat'); } catch (_) { return {}; } };
const getYoutubeDl = () => { try { return require('./scrape/youtube_dl'); } catch (_) { return {}; } };

// Sesi memori percakapan (per-grup)
const _historyMap = new Map();
const MAX_HISTORY = 16;
const HISTORY_TTL = 30 * 60 * 1000; // 30 menit idle

async function sendDocCard(Cantarella, jid, text, quoted, mentions = []) {
    try {
        const docBuf = fs.existsSync("./package.json") ? fs.readFileSync("./package.json") : Buffer.from('{}');
        const thumbBuf = fs.existsSync("./assets/doc.jpg") 
            ? fs.readFileSync("./assets/doc.jpg") 
            : (fs.existsSync("./assets/thumb.jpg") ? fs.readFileSync("./assets/thumb.jpg") : undefined);
        return await Cantarella.sendMessage(jid, {
            document: docBuf,
            fileName: global.filename || global.namaBot || 'Ender Verstappen',
            fileLength: 99999999999999,
            mimetype: 'image/png',
            jpegThumbnail: thumbBuf,
            caption: "\n" + String(text),
            contextInfo: {
                mentionedJid: Array.isArray(mentions) ? mentions : []
            }
        }, { quoted: quoted, ephemeralExpiration: 86400 });
    } catch (_) {
        return await Cantarella.sendMessage(jid, { text: String(text), mentions }, { quoted });
    }
}

function _cleanNum(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

/**
 * Mengumpulkan semua ID/JID/LID unik milik bot untuk deteksi mention & anti-loop
 */
function getBotIdentifiers(Cantarella, botNumber, groupMetadata, botLid = null) {
    const ids = new Set();
    const add = (val) => {
        const c = _cleanNum(val);
        if (c && c.length >= 5) ids.add(c);
    };

    add(botNumber);
    add(global.nobot);
    add(Cantarella?.user?.id);
    add(Cantarella?.user?.lid);
    add(Cantarella?.authState?.creds?.me?.lid);
    add(Cantarella?.authState?.creds?.me?.id);
    if (botLid) add(botLid);

    const botNumClean = _cleanNum(botNumber || global.nobot || Cantarella?.user?.id);

    // Ambil nomor / LID bot dari metadata partisipan grup jika tersedia
    if (groupMetadata?.participants && Array.isArray(groupMetadata.participants)) {
        for (const part of groupMetadata.participants) {
            const idClean = _cleanNum(part.id);
            const jidClean = _cleanNum(part.jid);
            const lidClean = _cleanNum(part.lid);
            if ((idClean && idClean === botNumClean) || (jidClean && jidClean === botNumClean)) {
                if (idClean) add(idClean);
                if (jidClean) add(jidClean);
                if (lidClean) add(lidClean);
            }
        }
    }

    // Variasi format nomor Indonesia (628xxx -> 08xxx dan 8xxx)
    if (botNumClean && botNumClean.startsWith('62')) {
        ids.add('0' + botNumClean.slice(2));
        ids.add(botNumClean.slice(2));
    }
    return ids;
}

/**
 * Validasi apakah pengirim adalah Owner asli (manusia, bukan bot)
 */
function isGenuineOwner(m, botNumber, explicitIsOwner = false, groupMetadata = null) {
    if (m.key?.fromMe) return false;
    if (explicitIsOwner) return true;

    const sender = _cleanNum(m.sender || m.participant || '');
    const bot = _cleanNum(botNumber || global.nobot || '');
    if (sender && bot && sender === bot) return false;

    const nomorOwner = _cleanNum(global.nomorowner || '');
    if (nomorOwner && sender === nomorOwner) return true;
    const ownerList = (Array.isArray(global.owner) ? global.owner : [global.owner]).filter(Boolean).map(_cleanNum);
    if (ownerList.includes(sender)) return true;

    // Cek mapping partisipan jika sender berupa LID di grup
    if (groupMetadata?.participants && Array.isArray(groupMetadata.participants)) {
        for (const part of groupMetadata.participants) {
            const pId = _cleanNum(part.id);
            const pLid = _cleanNum(part.lid);
            const pJid = _cleanNum(part.jid);
            if ((pId && pId === sender) || (pLid && pLid === sender)) {
                if (nomorOwner && pJid === nomorOwner) return true;
                if (ownerList.includes(pJid)) return true;
                if (nomorOwner && pId === nomorOwner) return true;
                if (ownerList.includes(pId)) return true;
            }
        }
    }

    return false;
}

const isOwnerOrBot = isGenuineOwner;

/**
 * Validasi apakah pesan berasal dari bot (anti bot loop)
 */
function isMessageFromBot(m, Cantarella, botNumber, groupMetadata, botLid = null) {
    if (m.key?.fromMe) return true;
    if (m.isBaileys) return true;
    if (m.id && (m.id.startsWith('BAE5') || m.id.startsWith('CantarellaHaxor_') || m.id.startsWith('EnderVerstappen_'))) return true;

    const botIds = getBotIdentifiers(Cantarella, botNumber, groupMetadata, botLid);
    const sender = _cleanNum(m.sender || m.participant || m.key?.participant || '');
    if (sender && botIds.has(sender)) return true;

    return false;
}

/**
 * Validasi apakah pesan memanggil/mention bot di grup
 */
function isTriggered(m, body, Cantarella, botNumber, groupMetadata, forceTrigger = false, mentionByTag = [], botLid = null) {
    if (forceTrigger) return true;
    if (!body || typeof body !== 'string' || !body.trim()) return false;

    const cleanBody = body.toLowerCase().trim();

    // 1. BLOKIR MUTLAK PERINTAH COMMAND BOT BIASA:
    // Jika pesan berawalan titik (.) atau prefix command lain (#, !, /)
    // dan BUKAN perintah AI (.ai), JANGAN PERNAH direspon oleh AI Assistant!
    // Biarkan sistem bot mengeksekusi command aslinya (contoh: .allmenu, .menu, .ping, .owner, dll)
    const isAiCommand = (
        cleanBody.startsWith('.ai ') ||
        cleanBody.startsWith('/ai ') ||
        cleanBody.startsWith('!ai ') ||
        cleanBody === '.ai' ||
        cleanBody === '/ai' ||
        cleanBody === '!ai'
    );
    if (!isAiCommand && /^[.#!]/.test(cleanBody)) {
        return false;
    }

    // 2. DI GRUP: AI HANYA BISA DIPANGGIL LEWAT TAG (Wajib ada karakter '@' di teks) atau command .ai
    // Jika tidak ada '@' dan bukan command .ai, tolak langsung!
    // Ini mencegah pesan reply biasa / quoted message yang membawa contextInfo.mentionedJid
    if (m.isGroup && !cleanBody.includes('@') && !isAiCommand) {
        return false;
    }

    const botIds = getBotIdentifiers(Cantarella, botNumber, groupMetadata, botLid);

    // 3. Tag WA bot (mentions di grup via contextInfo / mentionedJid)
    const mentionedList = [
        ...(Array.isArray(m.mentionedJid) ? m.mentionedJid : []),
        ...(Array.isArray(mentionByTag) ? mentionByTag : []),
        ...(Array.isArray(m.message?.extendedTextMessage?.contextInfo?.mentionedJid) ? m.message.extendedTextMessage.contextInfo.mentionedJid : []),
        ...(Array.isArray(m.msg?.contextInfo?.mentionedJid) ? m.msg.contextInfo.mentionedJid : [])
    ];
    const isTagged = mentionedList.some(j => {
        const c = _cleanNum(j);
        if (!c) return false;
        if (botIds.has(c)) return true;
        return Array.from(botIds).some(id => (id.length >= 8 && (c.includes(id) || id.includes(c))));
    });

    // 4. Mention nomor bot dalam teks (@628xx, @+628xx, @08xx, @8xx, @+62 877...)
    const atMatches = (cleanBody.match(/@\+?[\d\s\-\.]+/g) || []).map(s => s.replace(/[^0-9]/g, ''));
    const isAtNumberMentioned = atMatches.some(num => {
        if (!num || num.length < 5) return false;
        return Array.from(botIds).some(id => id === num || (id.length >= 8 && (num.endsWith(id) || id.endsWith(num))));
    });

    const isDirectNumberMentioned = Array.from(botIds).some(id => {
        if (id.length < 6) return false;
        return cleanBody.includes('@' + id) || cleanBody.includes('@+' + id);
    });

    // 5. Tag nama bot teks (@bot, @ender, @namaBot)
    const botName = String(global.namaBot || 'Ender Verstappen').trim().toLowerCase();
    const firstName = botName.split(/\s+/)[0];
    const isAtBotTag = (
        cleanBody.includes('@bot') ||
        cleanBody.includes('@ender') ||
        cleanBody.includes(`@${firstName}`) ||
        cleanBody.includes(`@${botName}`) ||
        new RegExp(`@(?:${firstName}|bot|ai|ender)\\b`, 'i').test(body)
    );

    const isTag = isTagged || isAtNumberMentioned || isDirectNumberMentioned || isAtBotTag || isAiCommand;

    if (m.isGroup) {
        return isTag;
    }

    // Di Private Chat (DM/PC): bisa via tag, command .ai, atau awalan bot / ender
    const isPcTrigger = (
        isTag ||
        cleanBody.startsWith('bot ') ||
        cleanBody.startsWith('ender ') ||
        cleanBody.startsWith(`${firstName} `) ||
        cleanBody.startsWith('.bot ') ||
        cleanBody.startsWith('.ender ') ||
        cleanBody.startsWith('/bot ') ||
        cleanBody.startsWith('/ender ')
    );

    return isPcTrigger;
}

/**
 * Scraper gambar Bing Image Search untuk pembuatan stiker/meme
 */
async function searchImages(query) {
    try {
        const res = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&first=1`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
        if (!res.ok) return [];
        const html = await res.text();
        const regex = /murl&quot;:&quot;(http[^&]+)&quot;/g;
        let match;
        const urls = [];
        while ((match = regex.exec(html)) !== null) {
            urls.push(match[1]);
        }
        return urls;
    } catch (e) {
        return [];
    }
}

/**
 * Ganti nama bot di settings.js dan memori
 */
function actionSetBotName(newName) {
    if (!newName || typeof newName !== 'string') throw new Error('Nama bot tidak valid');
    const clean = newName.trim();
    const settingsPath = path.join(process.cwd(), 'settings.js');
    let content = fs.readFileSync(settingsPath, 'utf8');
    content = content.replace(/global\.namaBot\s*=\s*["'].*?["']/, `global.namaBot = "${clean}"`);
    content = content.replace(/global\.nama\s*=\s*["'].*?["']/, `global.nama = "${clean}"`);
    content = content.replace(/global\.packname\s*=\s*["'].*?["']/, `global.packname = "${clean}"`);
    fs.writeFileSync(settingsPath, content, 'utf8');
    global.namaBot = clean;
    global.nama = clean;
    global.packname = clean;
    return clean;
}

/**
 * Ganti nama owner di settings.js dan memori
 */
function actionSetOwnerName(newOwner) {
    if (!newOwner || typeof newOwner !== 'string') throw new Error('Nama owner tidak valid');
    const clean = newOwner.trim();
    const settingsPath = path.join(process.cwd(), 'settings.js');
    let content = fs.readFileSync(settingsPath, 'utf8');
    content = content.replace(/global\.namaowner\s*=\s*["'].*?["']/, `global.namaowner = "${clean}"`);
    content = content.replace(/global\.author\s*=\s*["'].*?["']/, `global.author = "${clean}"`);
    fs.writeFileSync(settingsPath, content, 'utf8');
    global.namaowner = clean;
    global.author = clean;
    return clean;
}

/**
 * Tambah / Update case command baru ke Cantarella.js
 */
function actionAddCase(cmdName, codeSnippet) {
    if (!cmdName || !codeSnippet) throw new Error('Nama case dan kode wajib diisi');
    const cleanCmd = cmdName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const cantarellaPath = path.join(process.cwd(), 'Cantarella.js');
    let content = fs.readFileSync(cantarellaPath, 'utf8');

    let codeToInject = codeSnippet.trim();
    if (!codeToInject.startsWith('case ')) {
        codeToInject = `case '${cleanCmd}': {\n${codeToInject}\n    break;\n}`;
    }

    const timestamp = new Date().toLocaleString('id-ID');
    const block = `\n// === AI_ADDCASE: ${cleanCmd} (${timestamp}) ===\n${codeToInject}\n// === END AI_ADDCASE: ${cleanCmd} ===\n`;

    const aiMarkerRegex = new RegExp(`\\n// === AI_ADDCASE: ${cleanCmd}[\\s\\S]*?// === END AI_ADDCASE: ${cleanCmd} ===\\n`, 'g');
    let newContent;

    if (aiMarkerRegex.test(content)) {
        newContent = content.replace(aiMarkerRegex, block);
    } else if (content.includes(`case '${cleanCmd}':`) || content.includes(`case "${cleanCmd}":`)) {
        const caseMarker = content.includes(`case '${cleanCmd}':`) ? `case '${cleanCmd}':` : `case "${cleanCmd}":`;
        const startIdx = content.indexOf(caseMarker);
        const breakIdx = content.indexOf('break;', startIdx);
        if (startIdx !== -1 && breakIdx !== -1) {
            newContent = content.slice(0, startIdx) + block + content.slice(breakIdx + 'break;'.length);
        } else {
            const defaultMarker = '\ndefault:';
            newContent = content.replace(defaultMarker, block + defaultMarker);
        }
    } else {
        const defaultMarker = '\ndefault:';
        if (!content.includes(defaultMarker)) {
            throw new Error('Titik injeksi default: tidak ditemukan di Cantarella.js');
        }
        newContent = content.replace(defaultMarker, block + defaultMarker);
    }

    fs.writeFileSync(cantarellaPath + '.ai_tmp', newContent, 'utf8');
    try {
        execSync(`node -c "${cantarellaPath}.ai_tmp"`, { timeout: 10000 });
    } catch (syntaxErr) {
        try { fs.unlinkSync(cantarellaPath + '.ai_tmp'); } catch (_) {}
        throw new Error(`Sintaks error pada kode case: ${syntaxErr.message}`);
    }

    try { fs.unlinkSync(cantarellaPath + '.ai_tmp'); } catch (_) {}
    fs.writeFileSync(cantarellaPath + '.bak', content, 'utf8');
    fs.writeFileSync(cantarellaPath, newContent, 'utf8');
    return cleanCmd;
}

/**
 * Edit file codingan secara presisi dengan syntax verification
 */
function actionEditCode(relPath, targetStr, replacementStr) {
    if (!relPath || !targetStr) throw new Error('Path file dan target teks wajib diisi');
    const safePath = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(process.cwd(), safePath);

    if (!fs.existsSync(fullPath)) {
        throw new Error(`File '${relPath}' tidak ditemukan`);
    }

    let content = fs.readFileSync(fullPath, 'utf8');
    if (!content.includes(targetStr)) {
        const normContent = content.replace(/\r\n/g, '\n');
        const normTarget = targetStr.replace(/\r\n/g, '\n');
        if (normContent.includes(normTarget)) {
            content = normContent;
            targetStr = normTarget;
            replacementStr = replacementStr.replace(/\r\n/g, '\n');
        } else {
            throw new Error(`Teks target tidak ditemukan di file '${relPath}'`);
        }
    }

    const newContent = content.replace(targetStr, replacementStr);
    if (fullPath.endsWith('.js')) {
        fs.writeFileSync(fullPath + '.ai_tmp', newContent, 'utf8');
        try {
            execSync(`node -c "${fullPath}.ai_tmp"`, { timeout: 10000 });
            fs.unlinkSync(fullPath + '.ai_tmp');
        } catch (syntaxErr) {
            try { fs.unlinkSync(fullPath + '.ai_tmp'); } catch (_) {}
            throw new Error(`Edit dibatalkan karena sintaks error: ${syntaxErr.message}`);
        }
    }

    fs.writeFileSync(fullPath + '.bak', content, 'utf8');
    fs.writeFileSync(fullPath, newContent, 'utf8');
    return safePath;
}

/**
 * Eksekusi perintah terminal shell (khusus Owner)
 */
async function actionExecShell(cmd) {
    if (!cmd || typeof cmd !== 'string') throw new Error('Perintah shell tidak valid');
    return new Promise((resolve) => {
        exec(cmd, { cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                resolve(`❌ Error: ${err.message}\n${(stderr || '').slice(0, 1000)}`);
            } else {
                resolve((stdout || stderr || 'Perintah selesai tanpa output.').slice(0, 2500));
            }
        });
    });
}

/**
 * Panggil Google Gemini API
 */
async function callGemini(prompt, history = [], userMeta = {}) {
    const { isOwner = false, userName = 'User' } = userMeta;
    const apiKey = global.googleAiApiKey || process.env.GOOGLE_AI_API_KEY || '';
    const models = [
        'gemini-3.7-flash',
        'gemini-3.5-flash',
        'gemini-3-flash-preview',
        'gemini-3.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3.6-flash'
    ];

    const botName = global.namaBot || 'Ender Verstappen';
    const ownerName = global.namaowner || 'Chaidar';

    const senderRoleDesc = isOwner
        ? `Kamu sedang berbicara langsung dengan OWNER / penciptamu (${ownerName}). Hormati dia sebagai bos/penciptamu, panggil dengan "bos", "bang Chaidar", atau "kak". Sangat loyal dan sigap memenuhi apapun permintaannya termasuk modifikasi bot, codingan, nama, dan fitur!`
        : `Kamu sedang berbicara dengan anggota grup bernama "${userName}". Bersikaplah ramah, santai, asik, solutif, dan gaul. Panggil dia dengan namanya atau "kak". Tetap banggakan penciptamu ${ownerName} jika ditanya tentang pembuat bot.`;

    const systemPrompt = `Kamu adalah ${botName}, Asisten Pintar AI untuk WhatsApp.
Pencipta dan Owner kamu adalah ${ownerName}.

STATUS PERCAKAPAN SAAT INI:
${senderRoleDesc}

KEPRIBADIAN & GAYA KOMUNIKASI:
- Sangat cerdas, santai, gaul, akrab, solutif.
- Menggunakan bahasa santai (gue-lo / santai akrab), jangan kaku seperti robot atau customer service.
- Jangan pernah merespon atau berbicara dengan akun bot lain.

KNOWLEDGE BASE LENGKAP FITUR BOT:
1. DOWNLOADER:
   - .play <judul/query>: Cari lagu di YouTube, kirim info & thumbnail lalu langsung kirim audio MP3.
   - .play2 <judul/query>: Interactive HTML Music Player dengan lirik tersinkronisasi (LRCLIB), audio visualizer widget WhatsApp, thumbnail cover art, dan embedded audio.
   - .ytplay / .ytp <judul/url>: Pemutar video YouTube interaktif HTML5 (in-app WebView) dengan WebSocket streaming & custom UI player.
   - .youtube / .yt [query]: YouTube Mini App lengkap langsung di WhatsApp dengan fitur Search, 16:9 Video Player, kecepatan putar, volume, dan antrean video rekomendasi (tanpa tombol like/subscribe).
   - .spotify / .spot [query]: Spotify Web Player Mini interaktif lengkap dengan nuansa hijau Spotify, cover album HD, play/pause, seekbar, loop & volume.
   - .soundcloud / .sc [query/url]: SoundCloud HTML Music Player di WhatsApp (arsitektur ringan seperti ytp) dengan tema oranye khas SoundCloud, cover art HD, seekbar, dan streaming langsung.
   - .ytmp3 <url>: Download audio MP3 dari video YouTube.
   - .ytmp4 <url>: Download video 720p/360p dari YouTube secara otomatis.
   - .igdl <url>: Download Reels, Video, Foto, Carousel Instagram (multi-provider SnapSave).
   - .fbdl <url>: Download video Facebook kualitas tertinggi otomatis tanpa pertanyaan.
   - .ttdl / .tiktok <url>: Download video TikTok tanpa watermark.
2. STIKER & MEDIA:
   - .s / .sticker: Convert foto atau video pendek (<10 detik) jadi stiker WhatsApp. Bisa reply foto atau beri caption .s saat kirim foto!
   - .brat <teks>: Membuat stiker teks gaya Brat aesthetic hijau/putih.
   - .bratvid <teks>: Membuat stiker animasi video teks Brat.
   - .wm <pack|author>: Mengganti watermark pada stiker.
   - .toimg: Mengubah stiker kembali menjadi foto.
3. AI & TOOLS:
   - .gpt52 <tanya>: AI OpenAI GPT-5.2.
   - .gemini <tanya>: Google Gemini AI.
4. GRUP & OWNER:
   - .owner / .creator: Mengirim kontak vCard resmi dan profil owner (${ownerName}).
   - .addcase / .delcase / .getcase: Manajemen case fitur bot secara dinamis.
   - .clearsession: Membersihkan session yang corrupt tanpa logout.
   - .restart: Restart server bot.

KEMAMPUAN AKSI OTOMATIS & AUTONOMOUS LIVE CODING:
Jika user meminta kamu untuk membuatkan sesuatu atau memodifikasi bot, kamu BISA langsung mengeksekusinya secara otomatis menggunakan tag aksi di dalam jawabanmu:

1. Buat Stiker Meme / Karakter / Foto:
   Sertakan: [[ACTION:STICKER|kata kunci pencarian gambar]]
   Contoh: "Siap, ini stiker meme Sucipto-nya! [[ACTION:STICKER|meme sucipto]] Langsung tak buatin ya!"

2. Putar Musik / Lagu:
   Sertakan: [[ACTION:PLAY|judul lagu]]
   Contoh: "Gas, ini lagunya! [[ACTION:PLAY|gala bunga matahari]] Mohon tunggu audio terkirim."

3. Buat Stiker Teks Brat:
   Sertakan: [[ACTION:BRAT|teks brat]]
   Contoh: "Nih stiker brat-nya! [[ACTION:BRAT|santai dulu kawan]]"

4. Cari Gambar:
   Sertakan: [[ACTION:IMAGE|kata kunci gambar]]
   Contoh: "Ini foto yang diminta! [[ACTION:IMAGE|kucing lucu]]"

5. Ganti Nama Bot (Khusus Owner):
   Sertakan: [[ACTION:SET_BOT_NAME|nama_baru]]
   Contoh: "Siap bos! Nama bot gue ubah jadi Ender Verstappen V2. [[ACTION:SET_BOT_NAME|Ender Verstappen V2]]"

6. Ganti Nama Owner (Khusus Owner):
   Sertakan: [[ACTION:SET_OWNER_NAME|nama_owner_baru]]
   Contoh: "Siap bos Chaidar! Nama owner diubah ke Chaidar. [[ACTION:SET_OWNER_NAME|Chaidar]]"

7. Tambah Fitur / Case Baru ke Cantarella.js (Khusus Owner):
   Format: [[ACTION:ADD_CASE|nama_command|||case 'nama_command': {\n    // kode eksekusi\n    break;\n}]]
   Contoh: "Siap bos, fitur .halo langsung gue tambahkan ke Cantarella.js! [[ACTION:ADD_CASE|halo|||case 'halo': {\n    reply('Halo bang Chaidar!');\n    break;\n}]]"

8. Edit File / Kodingan / Pengaturan (Khusus Owner):
   Format: [[ACTION:EDIT_CODE|path_file|||teks_lama|||teks_baru]]
   Contoh: "Siap bos, kodingan di settings.js langsung gue perbaiki! [[ACTION:EDIT_CODE|settings.js|||global.autoreactsw = false|||global.autoreactsw = true]]"

9. Jalankan Perintah Terminal / Shell (Khusus Owner):
   Format: [[ACTION:EXEC_SHELL|perintah_shell]]
   Contoh: "Siap bos, perintah dijalankan di terminal. [[ACTION:EXEC_SHELL|npm list --depth=0]]"

10. Restart Bot (Khusus Owner):
    Format: [[ACTION:RESTART]]
    Contoh: "Siap bos Chaidar! Server bot gue restart sekarang ya. [[ACTION:RESTART]]"

ATURAN PENTING:
- Jika user BIASA (bukan owner) meminta modifikasi kodingan/nama bot/restart, tolak secara sopan bahwa akses itu hanya milik Owner (${ownerName}).
- Jika hanya ngobrol biasa, diskusi fitur, tanya jawab, atau salam: jawablah secara natural, asik, cerdas, dan hangat TANPA menyertakan tag aksi.`;

    // Buat riwayat percakapan untuk API
    const contents = [];
    contents.push({
        role: 'user',
        parts: [{ text: `[SYSTEM INSTRUCTION]\n${systemPrompt}\n[END SYSTEM INSTRUCTION]` }]
    });
    contents.push({
        role: 'model',
        parts: [{ text: `Siap dimengerti! Gue adalah ${botName}, asisten cerdas WhatsApp yang siap bantu.` }]
    });

    for (const h of history) {
        contents.push({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.content }]
        });
    }

    contents.push({
        role: 'user',
        parts: [{ text: prompt }]
    });

    let lastError = null;
    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents }),
                signal: AbortSignal.timeout(15000)
            });
            const data = await res.json();
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
            if (data.error) lastError = data.error.message;
        } catch (e) {
            lastError = e.message;
        }
    }

    throw new Error(lastError || 'Gemini API call failed');
}

/**
 * Main Handler yang dipanggil dari Cantarella.js
 */
async function handleAiAssistant(Cantarella, m, chatInfo = {}) {
    const {
        botNumber,
        botLid,
        groupName,
        pushname,
        isOwner: explicitIsOwner,
        forceTrigger,
        mentionByTag,
        groupMetadata,
        body: passedBody
    } = chatInfo;

    // 1. BLOKIR MUTLAK: Bot TIDAK BOLEH merespon pesan dari dirinya sendiri maupun bot lain
    if (isMessageFromBot(m, Cantarella, botNumber, groupMetadata, botLid)) {
        return false;
    }

    const isSenderOwner = isGenuineOwner(m, botNumber, explicitIsOwner, groupMetadata);

    // 2. Validasi Akses:
    // - Jika di Private Chat (PC/DM): Hanya Owner atau yang memanggil dengan command (.ai/.bot/.ender)
    // - Jika di Grup: Siapapun di grup boleh memanggil bot JIKA di-tag atau dipanggil namanya
    if (!m.isGroup && !isSenderOwner && !forceTrigger) {
        return false;
    }

    // 3. Validasi Trigger
    const rawBody = String(passedBody || m.text || m.body || m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
    
    // Blokir mutlak command bot biasa yang berawalan titik / prefix command
    if (!forceTrigger && /^[.#!]/.test(rawBody) && !/^[.#!](?:ai|bot|ender)\b/i.test(rawBody)) {
        return false;
    }

    if (!m.isGroup) {
        if (!forceTrigger && !isTriggered(m, rawBody, Cantarella, botNumber, groupMetadata, false, mentionByTag, botLid)) {
            return false;
        }
    } else {
        if (!isTriggered(m, rawBody, Cantarella, botNumber, groupMetadata, forceTrigger, mentionByTag, botLid)) {
            return false;
        }
    }

    const botIds = getBotIdentifiers(Cantarella, botNumber, groupMetadata, botLid);
    // Bersihkan teks dari trigger panggilan / tag
    let cleanText = rawBody;
    cleanText = cleanText.replace(/@\+?[\d\s\-\.]+/g, (match) => {
        const digits = match.replace(/[^0-9]/g, '');
        if (digits && Array.from(botIds).some(id => id === digits || (id.length >= 8 && digits.endsWith(id)))) {
            return '';
        }
        return match;
    });
    for (const id of botIds) {
        cleanText = cleanText.replace(new RegExp('@?' + id, 'g'), '');
    }
    cleanText = cleanText
        .replace(/^[.#/!]?(?:ai|bot|ender)\b/i, '')
        .replace(/@?(?:ender\s*verstappen|ender|bot)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!cleanText) cleanText = 'Halo';

    console.log(`[AI Assistant] 🤖 Active request from ${m.sender} (${pushname || 'User'}${isSenderOwner ? ' [OWNER]' : ''}): "${cleanText}"`);

    // React loading
    try {
        await Cantarella.sendMessage(m.chat, { react: { text: '🤖', key: m.key } });
    } catch (_) {}

    try {
        // Ambil riwayat chat grup
        const sessKey = m.chat;
        let session = _historyMap.get(sessKey);
        if (!session || (Date.now() - session.lastActive) > HISTORY_TTL) {
            session = { history: [], lastActive: Date.now() };
            _historyMap.set(sessKey, session);
        }
        session.lastActive = Date.now();

        // Panggil Gemini AI
        const aiResponse = await callGemini(cleanText, session.history, {
            isOwner: isSenderOwner,
            userName: pushname || 'User'
        });

        // Update riwayat
        session.history.push({ role: 'user', content: cleanText });
        session.history.push({ role: 'assistant', content: aiResponse });
        if (session.history.length > MAX_HISTORY) {
            session.history = session.history.slice(-MAX_HISTORY);
        }

        // Cek apakah ada Action Tag
        const actionMatch = aiResponse.match(/\[\[ACTION:([A-Z_]+)(?:\|([\s\S]*?))?\]\]/);
        let cleanReply = aiResponse.replace(/\[\[ACTION:[A-Z_]+(?:\|[\s\S]*?)?\]\]/g, '').trim();

        if (actionMatch) {
            const actionType = actionMatch[1];
            const actionArg = actionMatch[2]?.trim();

            if (actionType === 'STICKER' && actionArg) {
                // Aksi: Buat Stiker Meme / Gambar
                await Cantarella.sendMessage(m.chat, { react: { text: '🎨', key: m.key } });
                const { imageToWebp, addExif } = getExif();
                const images = await searchImages(actionArg);
                let sentSticker = false;

                if (imageToWebp && addExif) {
                    for (let i = 0; i < Math.min(images.length, 5); i++) {
                        try {
                            const imgRes = await fetch(images[i], {
                                headers: { 'User-Agent': 'Mozilla/5.0' },
                                signal: AbortSignal.timeout(8000)
                            });
                            if (!imgRes.ok) continue;
                            const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                            const webpBuf = await imageToWebp(imgBuf);
                            const stickerBuf = await addExif(
                                webpBuf,
                                global.packname || global.namaBot || 'Ender Verstappen',
                                global.author || global.namaowner || 'Chaidar'
                            );

                            await Cantarella.sendMessage(m.chat, { sticker: stickerBuf }, { quoted: m });
                            sentSticker = true;
                            break;
                        } catch (_) {}
                    }
                }

                if (!sentSticker) {
                    cleanReply += `\n\n_(Maaf bos, gambar untuk "${actionArg}" gagal diunduh atau diproses jadi stiker)_`;
                }
            } else if (actionType === 'PLAY' && actionArg) {
                // Aksi: Putar Musik
                await Cantarella.sendMessage(m.chat, { react: { text: '🎵', key: m.key } });
                const { searchAndDownloadAudio } = getYoutubeDl();
                try {
                    if (searchAndDownloadAudio) {
                        const audioResult = await searchAndDownloadAudio(actionArg);
                        if (audioResult && audioResult.buffer) {
                            if (audioResult.title) {
                                await sendDocCard(
                                    Cantarella,
                                    m.chat,
                                    `╔═ 𝗬𝗢𝗨𝗧𝗨𝗕𝗘 𝗣𝗟𝗔𝗬 ✦\n║ » Judul     : *${audioResult.title}*\n║ » Request   : *${actionArg}*\n╚═════ ${global.namaBot || 'Ender Verstappen'}\n\n_Sedang mengirim audio..._`,
                                    m
                                );
                            }
                            await Cantarella.sendMessage(m.chat, {
                                audio: audioResult.buffer,
                                mimetype: 'audio/mpeg',
                                fileName: `${audioResult.title || actionArg}.mp3`
                            }, { quoted: m });
                        }
                    }
                } catch (playErr) {
                    cleanReply += `\n\n_(Gagal mendownload lagu: ${playErr.message})_`;
                }
            } else if (actionType === 'BRAT' && actionArg) {
                // Aksi: Buat Stiker Brat Teks
                await Cantarella.sendMessage(m.chat, { react: { text: '✨', key: m.key } });
                const { generateBrat } = getBrat();
                const { imageToWebp, addExif } = getExif();
                try {
                    if (generateBrat && imageToWebp && addExif) {
                        const pngBuf = await generateBrat(actionArg);
                        const webpBuf = await imageToWebp(pngBuf);
                        const stickerBuf = await addExif(
                            webpBuf,
                            global.packname || global.namaBot || 'Ender Verstappen',
                            global.author || global.namaowner || 'Chaidar'
                        );
                        await Cantarella.sendMessage(m.chat, { sticker: stickerBuf }, { quoted: m });
                    }
                } catch (bratErr) {
                    cleanReply += `\n\n_(Gagal membuat stiker brat: ${bratErr.message})_`;
                }
            } else if (actionType === 'IMAGE' && actionArg) {
                // Aksi: Kirim Gambar
                await Cantarella.sendMessage(m.chat, { react: { text: '🖼️', key: m.key } });
                const images = await searchImages(actionArg);
                if (images.length > 0) {
                    try {
                        const imgRes = await fetch(images[0]);
                        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                        await Cantarella.sendMessage(m.chat, {
                            image: imgBuf,
                            caption: `🖼️ Hasil pencarian: *${actionArg}*`
                        }, { quoted: m });
                    } catch (_) {}
                }
            } else if (actionType === 'SET_BOT_NAME') {
                if (!isSenderOwner) {
                    cleanReply += '\n\n⚠️ *Akses Ditolak:* Perintah mengubah nama bot hanya boleh dijalankan oleh Owner (Chaidar).';
                } else {
                    try {
                        const newName = actionSetBotName(actionArg);
                        cleanReply += `\n\n╔═ 𝗦𝗨𝗞𝗦𝗘𝗦 ✦\n║ » Status  : *Nama Bot Berhasil Diubah*\n║ » Nama    : *${newName}*\n╚═════ ${newName}`;
                    } catch (e) {
                        cleanReply += `\n\n❌ *Gagal mengubah nama bot:* ${e.message}`;
                    }
                }
            } else if (actionType === 'SET_OWNER_NAME') {
                if (!isSenderOwner) {
                    cleanReply += '\n\n⚠️ *Akses Ditolak:* Perintah mengubah nama owner hanya boleh dijalankan oleh Owner (Chaidar).';
                } else {
                    try {
                        const newOwner = actionSetOwnerName(actionArg);
                        cleanReply += `\n\n╔═ 𝗦𝗨𝗞𝗦𝗘𝗦 ✦\n║ » Status  : *Nama Owner Berhasil Diubah*\n║ » Owner   : *${newOwner}*\n╚═════ ${global.namaBot || 'Ender Verstappen'}`;
                    } catch (e) {
                        cleanReply += `\n\n❌ *Gagal mengubah nama owner:* ${e.message}`;
                    }
                }
            } else if (actionType === 'ADD_CASE') {
                if (!isSenderOwner) {
                    cleanReply += '\n\n⚠️ *Akses Ditolak:* Perintah menambahkan fitur/case kodingan hanya boleh dijalankan oleh Owner (Chaidar).';
                } else {
                    try {
                        const [cmdName, ...codeParts] = (actionArg || '').split('|||');
                        const codeSnippet = codeParts.join('|||');
                        const addedCmd = actionAddCase(cmdName, codeSnippet);
                        cleanReply += `\n\n╔═ 𝗙𝗜𝗧𝗨𝗥 𝗕𝗔𝗥𝗨 ✦\n║ » Command : *.${addedCmd}*\n║ » File    : *Cantarella.js*\n║ » Status  : *Aktif & Syntax Verified*\n╚═════ ${global.namaBot || 'Ender Verstappen'}`;
                    } catch (e) {
                        cleanReply += `\n\n❌ *Gagal menambahkan case baru:* ${e.message}`;
                    }
                }
            } else if (actionType === 'EDIT_CODE') {
                if (!isSenderOwner) {
                    cleanReply += '\n\n⚠️ *Akses Ditolak:* Perintah memodifikasi kodingan hanya boleh dijalankan oleh Owner (Chaidar).';
                } else {
                    try {
                        const [relPath, targetStr, replacementStr] = (actionArg || '').split('|||');
                        const edited = actionEditCode(relPath, targetStr, replacementStr);
                        cleanReply += `\n\n╔═ 𝗞𝗢𝗗𝗜𝗡𝗚𝗔𝗡 𝗗𝗜𝗨𝗕𝗔𝗛 ✦\n║ » File    : *${edited}*\n║ » Status  : *Berhasil Disimpan & Syntax Aman*\n╚═════ ${global.namaBot || 'Ender Verstappen'}`;
                    } catch (e) {
                        cleanReply += `\n\n❌ *Gagal mengedit kodingan:* ${e.message}`;
                    }
                }
            } else if (actionType === 'EXEC_SHELL') {
                if (!isSenderOwner) {
                    cleanReply += '\n\n⚠️ *Akses Ditolak:* Perintah terminal shell hanya boleh dijalankan oleh Owner (Chaidar).';
                } else {
                    try {
                        await Cantarella.sendMessage(m.chat, { react: { text: '⚡', key: m.key } });
                        const shellOutput = await actionExecShell(actionArg);
                        cleanReply += `\n\n💻 *Terminal Output:*\n\`\`\`\n${shellOutput}\n\`\`\``;
                    } catch (e) {
                        cleanReply += `\n\n❌ *Gagal menjalankan terminal:* ${e.message}`;
                    }
                }
            } else if (actionType === 'RESTART') {
                if (!isSenderOwner) {
                    cleanReply += '\n\n⚠️ *Akses Ditolak:* Perintah restart server hanya boleh dijalankan oleh Owner (Chaidar).';
                } else {
                    cleanReply += `\n\n🔄 *Memulai ulang sistem bot (restart)...*`;
                    setTimeout(() => {
                        process.exit(0);
                    }, 2000);
                }
            }
        }

        // Kirim respon teks jika ada (menggunakan Document Card)
        if (cleanReply) {
            await sendDocCard(Cantarella, m.chat, cleanReply, m, [m.sender]);
        }

        // React selesai
        try {
            await Cantarella.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        } catch (_) {}

        return true;

    } catch (err) {
        console.error('[AI Assistant Error]', err);
        try {
            await Cantarella.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            await sendDocCard(Cantarella, m.chat, `⚠️ *AI Error:* ${err.message.slice(0, 150)}`, m);
        } catch (_) {}
        return true;
    }
}

module.exports = {
    handleAiAssistant,
    isOwnerOrBot,
    isGenuineOwner,
    isMessageFromBot,
    getBotIdentifiers,
    isTriggered,
    callGemini,
    searchImages
};
/**
 * Audio Sticker Engine for Ender Verstappen
 * Static & Animated WebP Stickers with Embedded WhatsApp Sound Track
 * 
 * Author: Nimzz (Adapted for Ender Verstappen)
 */

const {
    prepareWAMessageMedia,
    proto,
    downloadMediaMessage,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const { randomBytes } = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);
const MAX_DURATION = 25; // Maks 25 detik sesuai batas durasi audio sticker WhatsApp
const SESSION_SECONDS = 60; // Sesi tunggu audio 60 detik

if (!globalThis.__audioStickerSessions) {
    globalThis.__audioStickerSessions = new Map();
}
const sessions = globalThis.__audioStickerSessions;

/**
 * Patch Baileys protobuf encoder to support WhatsApp Audio Sticker format
 * - StickerMessage tag 210: audioMessage
 * - Message tag 1074: audioStickerMessage (FutureProofMessage)
 */
function patchProtoInstance(p) {
    const M = p?.Message;
    if (!M || M.__audioStickerPatchedV3) return;

    if (M.StickerMessage) {
        const prevStickerEncode = M.StickerMessage.encode;
        M.StickerMessage.encode = function (message, writer) {
            const audio = message?.audioMessage;
            if (audio && Object.prototype.hasOwnProperty.call(message, 'audioMessage')) {
                delete message.audioMessage;
            }
            const w = prevStickerEncode.call(this, message, writer);
            if (audio && M.AudioMessage) {
                message.audioMessage = audio;
                M.AudioMessage.encode(audio, w.uint32(210).fork()).ldelim();
            }
            return w;
        };

        if (typeof M.StickerMessage.fromObject === 'function') {
            const prevStickerFromObj = M.StickerMessage.fromObject;
            M.StickerMessage.fromObject = function (object) {
                const msg = prevStickerFromObj.call(this, object);
                if (object?.audioMessage) {
                    msg.audioMessage = M.AudioMessage?.fromObject
                        ? M.AudioMessage.fromObject(object.audioMessage)
                        : object.audioMessage;
                }
                return msg;
            };
        }
    }

    const prevMsgEncode = M.encode;
    M.encode = function (message, writer) {
        const asm = message?.audioStickerMessage;
        if (asm) {
            if (Object.prototype.hasOwnProperty.call(message, 'stickerMessage')) {
                delete message.stickerMessage;
            }
            if (Object.prototype.hasOwnProperty.call(message, 'audioStickerMessage')) {
                delete message.audioStickerMessage;
            }
        }
        const w = prevMsgEncode.call(this, message, writer);
        if (asm && M.FutureProofMessage) {
            message.audioStickerMessage = asm;
            M.FutureProofMessage.encode(asm, w.uint32(1074).fork()).ldelim();
        }
        return w;
    };

    if (typeof M.fromObject === 'function') {
        const prevMsgFromObj = M.fromObject;
        M.fromObject = function (object) {
            const msg = prevMsgFromObj.call(this, object);
            if (object?.audioStickerMessage) {
                const inner = object.audioStickerMessage.message || object.audioStickerMessage;
                if (inner?.stickerMessage && object.audioStickerMessage.message?.stickerMessage?.audioMessage) {
                    inner.stickerMessage.audioMessage = object.audioStickerMessage.message.stickerMessage.audioMessage;
                }
                msg.audioStickerMessage = { message: inner };
                delete msg.stickerMessage;
                if (inner) {
                    Object.setPrototypeOf(msg, inner);
                }
            }
            return msg;
        };
    }

    M.__audioStickerPatchedV3 = true;
}

function ensurePatched() {
    patchProtoInstance(proto);
    try {
        const mod = require('@whiskeysockets/baileys');
        if (mod?.proto) patchProtoInstance(mod.proto);
    } catch {}
}
ensurePatched();

function getSessionKey(m) {
    const chat = m.chat || m.key?.remoteJid || '';
    const sender = m.sender || m.key?.participant || (m.key?.fromMe ? 'me' : chat);
    return `${chat}:${sender}`;
}

function clearUserSession(key) {
    const existing = sessions.get(key);
    if (existing?.timer) clearTimeout(existing.timer);
    sessions.delete(key);
}

function unwrapMessageContainer(raw) {
    let cur = raw;
    for (let i = 0; i < 6 && cur; i++) {
        const next =
            cur.ephemeralMessage?.message ||
            cur.viewOnceMessageV2?.message ||
            cur.viewOnceMessageV2Extension?.message ||
            cur.viewOnceMessage?.message ||
            cur.documentWithCaptionMessage?.message ||
            cur.editedMessage?.message;
        if (!next) break;
        cur = next;
    }
    return cur || {};
}

function detectMediaInfo(node) {
    if (!node) return { kind: null, mime: '', seconds: 0, mediaObj: null, dlType: null };

    const container = unwrapMessageContainer(node.message || node.fakeObj?.message || {});
    const mtype =
        node.mtype ||
        node.type ||
        Object.keys(container).find(k =>
            /imageMessage|videoMessage|stickerMessage|audioMessage|documentMessage/i.test(k)
        ) ||
        '';

    const directMsg =
        node.msg && typeof node.msg === 'object' && (node.msg.mediaKey || node.msg.url || node.msg.directPath || node.msg.mimetype)
            ? node.msg
            : null;

    const mediaObj =
        directMsg ||
        container[mtype] ||
        container.videoMessage ||
        container.imageMessage ||
        container.stickerMessage ||
        container.audioMessage ||
        container.documentMessage ||
        (node.mediaKey || node.url || node.directPath ? node : null);

    const mime = String(node.mimetype || mediaObj?.mimetype || node.msg?.mimetype || '').toLowerCase();
    const seconds = Number(mediaObj?.seconds || node.seconds || node.msg?.seconds || 0);

    if (/video/i.test(mime) || /videoMessage/i.test(mtype)) {
        const dlType = /documentMessage/i.test(mtype) ? 'document' : 'video';
        return { kind: 'video', mime: mime || 'video/mp4', seconds, mediaObj, dlType };
    }
    if (/webp/i.test(mime) || /stickerMessage/i.test(mtype)) {
        const isAnim = Boolean(mediaObj?.isAnimated);
        return { kind: 'webp', mime: 'image/webp', seconds, isAnimated: isAnim, mediaObj, dlType: 'sticker' };
    }
    if (/image/i.test(mime) || /imageMessage/i.test(mtype)) {
        const dlType = /documentMessage/i.test(mtype) ? 'document' : 'image';
        return { kind: 'image', mime: mime || 'image/jpeg', seconds: 0, mediaObj, dlType };
    }
    if (/audio|ogg|opus|mpeg|mp3|wav|m4a|aac/i.test(mime) || /audioMessage/i.test(mtype)) {
        const dlType = /documentMessage/i.test(mtype) ? 'document' : 'audio';
        return { kind: 'audio', mime: mime || 'audio/mpeg', seconds, mediaObj, dlType };
    }
    return { kind: null, mime: '', seconds: 0, mediaObj: null, dlType: null };
}

async function downloadBuffer(node, info, client) {
    if (!node) return null;

    // 1. Direct stream from mediaObj
    if (info?.mediaObj && info?.dlType && (info.mediaObj.mediaKey || info.mediaObj.directPath || info.mediaObj.url)) {
        try {
            const stream = await downloadContentFromMessage(info.mediaObj, info.dlType);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buf = Buffer.concat(chunks);
            if (buf && buf.length > 0) return buf;
        } catch {}
    }

    // 2. downloadMediaMessage from node or fakeObj
    if (node.fakeObj?.message || node.message) {
        try {
            const msgObj = node.fakeObj?.message ? node.fakeObj : node;
            const buf = await downloadMediaMessage(
                msgObj,
                'buffer',
                {},
                {
                    logger: { info: () => {}, error: () => {}, warn: () => {} },
                    reuploadRequest: client?.updateMediaMessage
                }
            );
            if (buf && buf.length > 0) return buf;
        } catch {}
    }

    // 3. client.downloadMediaMessage
    if (typeof client?.downloadMediaMessage === 'function') {
        try {
            const buf = await client.downloadMediaMessage(node);
            if (buf && buf.length > 0) return buf;
        } catch {}
    }

    // 4. node.download
    if (typeof node.download === 'function') {
        try {
            const buf = await node.download();
            if (buf && buf.length > 0) return buf;
        } catch {}
    }

    return null;
}

function buildExifPayload(packname, author) {
    const json = {
        'sticker-pack-id': 'com.ender.audiosticker',
        'sticker-pack-name': String(packname ?? ''),
        'sticker-pack-publisher': String(author ?? ''),
        emojis: ['🔊']
    };
    const exifAttr = Buffer.from([
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);
    const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8');
    const exif = Buffer.concat([exifAttr, jsonBuff]);
    exif.writeUIntLE(jsonBuff.length, 14, 4);
    return exif;
}

function injectExifRiffFallback(webpBuffer, exifData) {
    if (
        !Buffer.isBuffer(webpBuffer) ||
        webpBuffer.length < 16 ||
        webpBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
        webpBuffer.toString('ascii', 8, 12) !== 'WEBP'
    ) {
        return webpBuffer;
    }

    const chunks = [];
    let offset = 12;
    let hasVp8x = false;
    let isAnim = false;

    while (offset + 8 <= webpBuffer.length) {
        const id = webpBuffer.toString('ascii', offset, offset + 4);
        const size = webpBuffer.readUInt32LE(offset + 4);
        const padded = size + (size % 2);
        const end = Math.min(webpBuffer.length, offset + 8 + padded);
        const rawChunk = Buffer.from(webpBuffer.subarray(offset, end));

        if (id === 'VP8X') hasVp8x = true;
        if (id === 'ANIM' || id === 'ANMF') isAnim = true;
        if (id !== 'EXIF') chunks.push({ id, rawChunk });

        offset = end;
    }

    if (!hasVp8x) {
        const vp8x = Buffer.alloc(18);
        vp8x.write('VP8X', 0, 4, 'ascii');
        vp8x.writeUInt32LE(10, 4);
        vp8x[8] = 0x18;
        vp8x.writeUIntLE(511, 12, 3);
        vp8x.writeUIntLE(511, 15, 3);
        chunks.unshift({ id: 'VP8X', rawChunk: vp8x });
    } else {
        const vp8xEntry = chunks.find(c => c.id === 'VP8X');
        if (vp8xEntry && vp8xEntry.rawChunk.length >= 18) {
            vp8xEntry.rawChunk[8] |= 0x08;
            if (isAnim) vp8xEntry.rawChunk[8] |= 0x02;
        }
    }

    const padByte = exifData.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);
    const exifHeader = Buffer.alloc(8);
    exifHeader.write('EXIF', 0, 4, 'ascii');
    exifHeader.writeUInt32LE(exifData.length, 4);
    chunks.push({ id: 'EXIF', rawChunk: Buffer.concat([exifHeader, exifData, padByte]) });

    const body = Buffer.concat(chunks.map(c => c.rawChunk));
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 4, 'ascii');
    header.writeUInt32LE(body.length + 4, 4);
    header.write('WEBP', 8, 4, 'ascii');

    return Buffer.concat([header, body]);
}

async function addStickerExif(webpBuffer, packname, author) {
    const exifData = buildExifPayload(packname, author);
    try {
        const webpMod = require('node-webpmux');
        const WebpImage = webpMod.Image || webpMod.default?.Image || webpMod.default;
        if (WebpImage) {
            const img = new WebpImage();
            await img.load(webpBuffer);
            img.exif = exifData;
            return await img.save(null);
        }
    } catch {}
    return injectExifRiffFallback(webpBuffer, exifData);
}

function isWebpAnimated(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 22) return false;
    if (buf.toString('ascii', 12, 16) === 'VP8X' && (buf[20] & 0x02) !== 0) return true;
    return buf.includes(Buffer.from('ANIM'));
}

async function videoBufferToAnimatedWebp(buffer) {
    const tmpId = randomBytes(6).toString('hex');
    const inPath = path.join(os.tmpdir(), `as_vid_${tmpId}.mp4`);
    const outPath = path.join(os.tmpdir(), `as_out_${tmpId}.webp`);

    const encodeAttempt = async (fps, qv) => {
        await execFileAsync('ffmpeg', [
            '-y',
            '-i', inPath,
            '-t', String(MAX_DURATION),
            '-vf', `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1`,
            '-c:v', 'libwebp',
            '-lossless', '0',
            '-compression_level', '6',
            '-q:v', String(qv),
            '-loop', '0',
            '-preset', 'picture',
            '-an',
            '-vsync', '0',
            outPath
        ]);
        return await fs.readFile(outPath);
    };

    try {
        await fs.writeFile(inPath, buffer);
        const profiles = [
            [10, 50],
            [8, 36],
            [6, 24],
            [5, 16]
        ];
        let webp = null;
        for (const [fps, qv] of profiles) {
            webp = await encodeAttempt(fps, qv);
            if (webp && webp.length <= 880 * 1024) break;
        }
        return webp;
    } finally {
        await fs.unlink(inPath).catch(() => {});
        await fs.unlink(outPath).catch(() => {});
    }
}

async function imageBufferToWebp(buffer) {
    const tmpId = randomBytes(6).toString('hex');
    const inPath = path.join(os.tmpdir(), `as_img_${tmpId}.jpg`);
    const outPath = path.join(os.tmpdir(), `as_img_out_${tmpId}.webp`);
    try {
        await fs.writeFile(inPath, buffer);
        await execFileAsync('ffmpeg', [
            '-y',
            '-i', inPath,
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1',
            '-c:v', 'libwebp',
            '-lossless', '0',
            '-q:v', '80',
            '-an',
            outPath
        ]);
        return await fs.readFile(outPath);
    } finally {
        await fs.unlink(inPath).catch(() => {});
        await fs.unlink(outPath).catch(() => {});
    }
}

async function buildStickerWithExif(buffer, kind, packname, author) {
    let rawWebp = buffer;
    if (kind === 'video') {
        rawWebp = await videoBufferToAnimatedWebp(buffer);
    } else if (kind === 'image') {
        rawWebp = await imageBufferToWebp(buffer);
    }
    return await addStickerExif(rawWebp, packname, author);
}

function parseFfmpegDuration(stderrText) {
    const matches = [...String(stderrText || '').matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    if (!matches.length) return 0;
    const last = matches[matches.length - 1];
    const sec = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
    return Number.isFinite(sec) ? sec : 0;
}

function generateWaveform(seedBuf, length = 64) {
    const wf = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
        const b = seedBuf && seedBuf.length ? seedBuf[(i * 19 + 7) % seedBuf.length] : i * 11;
        wf[i] = 18 + (b % 76);
    }
    return wf;
}

async function convertToOggOpus(buffer, ext = 'mp3') {
    const tmpId = randomBytes(6).toString('hex');
    const inPath = path.join(os.tmpdir(), `ptt_in_${tmpId}.${ext}`);
    const outPath = path.join(os.tmpdir(), `ptt_out_${tmpId}.ogg`);
    try {
        await fs.writeFile(inPath, buffer);
        const { stderr } = await execFileAsync('ffmpeg', [
            '-y',
            '-i', inPath,
            '-vn',
            '-map', '0:a:0?',
            '-t', String(MAX_DURATION),
            '-af', 'aresample=48000:async=1:first_pts=0',
            '-c:a', 'libopus',
            '-b:a', '48k',
            '-vbr', 'on',
            '-compression_level', '10',
            '-ac', '1',
            '-ar', '48000',
            '-application', 'audio',
            '-avoid_negative_ts', 'make_zero',
            '-f', 'ogg',
            outPath
        ]);
        const oggBuffer = await fs.readFile(outPath);
        if (!oggBuffer || oggBuffer.length < 200) {
            throw new Error('Jalur audio kosong atau tidak ditemukan pada file.');
        }
        const realSeconds = parseFfmpegDuration(stderr);
        return { oggBuffer, realSeconds };
    } finally {
        await fs.unlink(inPath).catch(() => {});
        await fs.unlink(outPath).catch(() => {});
    }
}

async function buildAudioMessageFromBuffer(client, buffer, ext, fallbackSeconds = 0) {
    const { oggBuffer, realSeconds } = await convertToOggOpus(buffer, ext);

    const uploadFn = client?.waUploadToServer || client?.sock?.waUploadToServer;
    const { audioMessage } = await prepareWAMessageMedia(
        { audio: oggBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true },
        { upload: uploadFn }
    );

    const chosenSec = realSeconds > 0 ? realSeconds : fallbackSeconds > 0 ? fallbackSeconds : 5;
    const finalSeconds = Math.max(1, Math.min(MAX_DURATION, Math.round(chosenSec)));

    audioMessage.seconds = finalSeconds;
    audioMessage.ptt = true;
    audioMessage.mimetype = 'audio/ogg; codecs=opus';
    if (!audioMessage.waveform || !audioMessage.waveform.length) {
        audioMessage.waveform = generateWaveform(oggBuffer);
    }

    return audioMessage;
}

async function sendCombinedAudioSticker(client, chat, stickerBuffer, isAnimated, audioMsg) {
    ensurePatched();

    const uploadFn = client?.waUploadToServer || client?.sock?.waUploadToServer;
    const prepared = await prepareWAMessageMedia(
        { sticker: stickerBuffer, isAnimated: Boolean(isAnimated) },
        { upload: uploadFn }
    );

    prepared.stickerMessage.isAnimated = Boolean(isAnimated);
    prepared.stickerMessage.audioMessage = audioMsg;

    const payload = {
        __proto__: prepared,
        audioStickerMessage: { message: prepared },
        messageContextInfo: { messageSecret: randomBytes(32) }
    };

    await client.relayMessage(chat, payload, {});
}

function startStickerSession({ m, client, send, stickerBuffer, isAnimated, packname, author, usedPrefix, command }) {
    const key = getSessionKey(m);
    clearUserSession(key);

    const timer = setTimeout(() => {
        if (sessions.has(key)) {
            sessions.delete(key);
            if (client?.sendMessage) {
                client.sendMessage(m.chat, {
                    text: `⏰ *SESI AUDIO STICKER BERAKHIR*\n> _Waktu tunggu ${SESSION_SECONDS} detik telah habis. Silakan kirim ulang foto jika ingin membuat Audio Sticker._`
                }, { quoted: m }).catch(() => {});
            }
        }
    }, SESSION_SECONDS * 1000);

    sessions.set(key, {
        stickerBuffer,
        isAnimated,
        packname,
        author,
        expiresAt: Date.now() + SESSION_SECONDS * 1000,
        processing: false,
        timer
    });

    return send(
        `✦ *SESI AUDIO STICKER AKTIF* ✦\n` +
        `> _Media stiker berhasil disimpan ke dalam sesi sementara._\n\n` +
        `╭─「 *DETAIL SESI* 」\n` +
        `│ ◦ *Pack* : *${packname}*\n` +
        `│ ◦ *Author* : *${author}*\n` +
        `│ ◦ *Tipe* : \`${isAnimated ? 'Animated GIF' : 'Static Image'}\`\n` +
        `│ ◦ *Durasi Audio Maks* : \`${MAX_DURATION} Detik\`\n` +
        `│ ◦ *Estimasi Waktu* : \`${SESSION_SECONDS} Detik\`\n` +
        `╰───────────────\n\n` +
        `╭─「 *LANGKAH SELANJUTNYA* 」\n` +
        `│ 1. Kirim *Audio MP3 / Voice Note / Video* langsung ke chat ini\n` +
        `│ 2. Atau *Reply Audio / Voice Note / Video* dengan \`${usedPrefix}${command}\`\n` +
        `│ 3. Ketik \`${usedPrefix}${command} batal\` untuk membatalkan\n` +
        `╰───────────────`
    );
}

async function consumeSessionWithAudio(m, client, send, react, session, audioNode, audioInfo) {
    const key = getSessionKey(m);
    session.processing = true;
    await react('⏳');

    try {
        const audioBuf = await downloadBuffer(audioNode, audioInfo, client);
        if (!audioBuf || !audioBuf.length) throw new Error('Gagal mengunduh file audio/video.');

        const ext =
            audioInfo.kind === 'video'
                ? 'mp4'
                : /ogg|opus/i.test(audioInfo.mime)
                    ? 'ogg'
                    : /mp4|m4a|aac/i.test(audioInfo.mime)
                        ? 'm4a'
                        : 'mp3';

        const audioMsg = await buildAudioMessageFromBuffer(client, audioBuf, ext, audioInfo.seconds);

        await sendCombinedAudioSticker(
            client,
            m.chat,
            session.stickerBuffer,
            session.isAnimated,
            audioMsg
        );

        clearUserSession(key);
        await react('✅');
    } catch (err) {
        session.processing = false;
        console.error('[AUDIOSTICKER SESSION ERROR]', err);
        await react('❌');
        await send(`❌ Gagal menggabungkan suara ke stiker: ${err?.message || String(err)}`);
    }
}

/**
 * Main Handler for Audio Sticker Command
 */
async function handleAudioSticker(m, extra = {}) {
    const {
        Cantarella,
        sock,
        conn,
        text = '',
        reply,
        usedPrefix = '.',
        prefix = '.',
        command = 'audiosticker'
    } = extra;

    const client = Cantarella || sock || conn || m.conn || global.conn || global.sock || global.Cantarella;
    const send = reply || (t => client.sendMessage(m.chat, { text: t }, { quoted: m }));
    const react = async (emoji) => {
        if (client?.sendMessage && m.key) {
            await client.sendMessage(m.chat, { react: { text: emoji, key: m.key } }).catch(() => {});
        }
    };

    const key = getSessionKey(m);
    const activeSession = sessions.get(key);
    const rawText = String(text || '').trim();

    // 1. Check for cancel
    if (/^(batal|cancel|stop)$/i.test(rawText)) {
        if (!activeSession) return send('⚠️ Tidak ada sesi Audio Sticker yang sedang aktif.');
        clearUserSession(key);
        await react('✅');
        return send('✅ Sesi Audio Sticker berhasil dibatalkan.');
    }

    const ownInfo = detectMediaInfo(m);
    const quoted = m.quoted;
    const quotedInfo = detectMediaInfo(quoted);

    const hasOwnVisual = ownInfo.kind === 'video' || ownInfo.kind === 'image' || ownInfo.kind === 'webp';
    const hasQuotedVisual = quotedInfo.kind === 'video' || quotedInfo.kind === 'image' || quotedInfo.kind === 'webp';
    const hasOwnAudio = ownInfo.kind === 'audio';
    const hasQuotedAudio = quotedInfo.kind === 'audio';

    // 2. Active session consuming audio
    if (activeSession && !activeSession.processing && (hasOwnAudio || hasQuotedAudio) && !hasOwnVisual) {
        const targetAudioNode = hasOwnAudio ? m : quoted;
        const targetAudioInfo = hasOwnAudio ? ownInfo : quotedInfo;
        return await consumeSessionWithAudio(m, client, send, react, activeSession, targetAudioNode, targetAudioInfo);
    }

    // 3. No media at all provided
    if (!hasOwnVisual && !hasQuotedVisual && !hasOwnAudio && !hasQuotedAudio) {
        if (activeSession) {
            const remSec = Math.max(1, Math.ceil((activeSession.expiresAt - Date.now()) / 1000));
            return send(
                `⏳ *SESI AUDIO STICKER MASIH AKTIF*\n\n` +
                `> Sisa waktu: *${remSec} detik*\n` +
                `• Kirim atau balas file *Audio / Voice Note / Video* sekarang.\n` +
                `• Atau ketik \`${usedPrefix || prefix}${command} batal\` untuk membatalkan.`
            );
        }
        return send(
            `🔊 *AUDIO STICKER (STIKER BERSUARA)* 🔊\n\n` +
            `> Buat stiker WhatsApp yang memiliki efek suara saat dikirim!\n\n` +
            `📌 *Cara Penggunaan:*\n` +
            `1️⃣ *Dari Video (Otomatis Visual + Suara):*\n` +
            `   Kirim/balas video (maks ${MAX_DURATION}s) dengan perintah:\n` +
            `   \`${usedPrefix || prefix}${command}\`\n\n` +
            `2️⃣ *Dari Foto / Stiker + Audio (2 Langkah):*\n` +
            `   • Kirim/balas foto atau stiker dengan \`${usedPrefix || prefix}${command}\`\n` +
            `   • Lalu kirim/balas audio atau VN yang ingin dijadikan suaranya!\n\n` +
            `3️⃣ *Kustomisasi Pack & Author:*\n` +
            `   \`${usedPrefix || prefix}${command} NamaPack | NamaAuthor\`\n\n` +
            `4️⃣ *Membatalkan Sesi:*\n` +
            `   \`${usedPrefix || prefix}${command} batal\``
        );
    }

    // Parse packname and author
    let packname = global.namaBot || 'Ender Verstappen';
    let author = global.namaowner || 'Chaidar';
    if (rawText && !/^(batal|cancel|stop)$/i.test(rawText)) {
        if (rawText.includes('|')) {
            const parts = rawText.split('|').map(s => s.trim());
            if (parts[0]) packname = parts[0];
            if (parts[1]) author = parts[1];
        } else if (rawText) {
            packname = rawText;
        }
    }

    const targetVisualNode = hasOwnVisual ? m : (hasQuotedVisual ? quoted : null);
    const targetVisualInfo = hasOwnVisual ? ownInfo : (hasQuotedVisual ? quotedInfo : null);

    // Case 1: Video provided (contains visual + audio)
    if (targetVisualInfo && targetVisualInfo.kind === 'video') {
        await react('⏳');
        try {
            const vidBuf = await downloadBuffer(targetVisualNode, targetVisualInfo, client);
            if (!vidBuf || !vidBuf.length) throw new Error('Gagal mengunduh file video.');

            const stickerBuf = await buildStickerWithExif(vidBuf, 'video', packname, author);
            const audioMsg = await buildAudioMessageFromBuffer(client, vidBuf, 'mp4', targetVisualInfo.seconds);

            await sendCombinedAudioSticker(client, m.chat, stickerBuf, true, audioMsg);
            await react('✅');
            clearUserSession(key);
            return;
        } catch (err) {
            console.error('[AUDIOSTICKER VIDEO ERROR]', err);
            await react('❌');
            return send(`❌ Gagal membuat Audio Sticker dari video: ${err.message || String(err)}`);
        }
    }

    // Case 2: Visual (image or webp) provided
    if (targetVisualInfo && (targetVisualInfo.kind === 'image' || targetVisualInfo.kind === 'webp')) {
        const targetAudioNode = hasOwnAudio ? m : (hasQuotedAudio ? quoted : null);
        const targetAudioInfo = hasOwnAudio ? ownInfo : (hasQuotedAudio ? quotedInfo : null);

        // Subcase 2A: Both visual and audio are in this single interaction!
        if (targetAudioNode && targetAudioInfo) {
            await react('⏳');
            try {
                const visBuf = await downloadBuffer(targetVisualNode, targetVisualInfo, client);
                if (!visBuf || !visBuf.length) throw new Error('Gagal mengunduh gambar/stiker.');
                const isAnim = targetVisualInfo.kind === 'webp' ? isWebpAnimated(visBuf) : false;
                const stickerBuf = await buildStickerWithExif(visBuf, targetVisualInfo.kind, packname, author);

                const audBuf = await downloadBuffer(targetAudioNode, targetAudioInfo, client);
                if (!audBuf || !audBuf.length) throw new Error('Gagal mengunduh audio.');
                const ext = targetAudioInfo.kind === 'video' ? 'mp4' : (/ogg|opus/i.test(targetAudioInfo.mime) ? 'ogg' : 'mp3');
                const audioMsg = await buildAudioMessageFromBuffer(client, audBuf, ext, targetAudioInfo.seconds);

                await sendCombinedAudioSticker(client, m.chat, stickerBuf, isAnim, audioMsg);
                await react('✅');
                clearUserSession(key);
                return;
            } catch (err) {
                console.error('[AUDIOSTICKER COMBO ERROR]', err);
                await react('❌');
                return send(`❌ Gagal menggabungkan audio dan stiker: ${err.message || String(err)}`);
            }
        }

        // Subcase 2B: Only visual provided -> start 60s session!
        await react('⏳');
        try {
            const visBuf = await downloadBuffer(targetVisualNode, targetVisualInfo, client);
            if (!visBuf || !visBuf.length) throw new Error('Gagal mengunduh gambar/stiker.');
            const isAnim = targetVisualInfo.kind === 'webp' ? isWebpAnimated(visBuf) : false;
            const stickerBuf = await buildStickerWithExif(visBuf, targetVisualInfo.kind, packname, author);

            await react('✅');
            return startStickerSession({
                m,
                client,
                send,
                stickerBuffer: stickerBuf,
                isAnimated: isAnim,
                packname,
                author,
                usedPrefix: usedPrefix || prefix,
                command
            });
        } catch (err) {
            console.error('[AUDIOSTICKER PREPARE ERROR]', err);
            await react('❌');
            return send(`❌ Gagal memproses media stiker: ${err.message || String(err)}`);
        }
    }

    // Case 3: Only audio provided but no visual and no active session
    if ((hasOwnAudio || hasQuotedAudio) && !hasOwnVisual && !hasQuotedVisual) {
        return send(
            `⚠️ Kamu mengirim/membalas audio, tetapi belum ada foto atau stiker yang dipilih!\n\n` +
            `💡 *Caranya:*\n` +
            `1. Balas foto atau stiker dengan \`${usedPrefix || prefix}${command}\` terlebih dahulu.\n` +
            `2. Setelah sesi aktif, kirim/balas audio ini kembali!`
        );
    }
}

/**
 * Check if incoming message should auto-consume an active Audio Sticker session
 */
async function checkActiveSession(m, extra = {}) {
    const key = getSessionKey(m);
    const activeSession = sessions.get(key);
    if (!activeSession || activeSession.processing) return false;

    const ownInfo = detectMediaInfo(m);
    const hasOwnAudio = ownInfo.kind === 'audio' || ownInfo.kind === 'video';
    if (!hasOwnAudio) return false;

    const client = extra.Cantarella || extra.sock || extra.conn || global.Cantarella;
    const send = extra.reply || (t => client.sendMessage(m.chat, { text: t }, { quoted: m }));
    const react = async (emoji) => {
        if (client?.sendMessage && m.key) {
            await client.sendMessage(m.chat, { react: { text: emoji, key: m.key } }).catch(() => {});
        }
    };

    await consumeSessionWithAudio(m, client, send, react, activeSession, m, ownInfo);
    return true;
}

module.exports = {
    handleAudioSticker,
    checkActiveSession,
    sessions,
    patchProtoInstance,
    ensurePatched
};

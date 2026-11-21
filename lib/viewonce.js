/**
 * View Once Engine for Ender Verstappen
 * Realtime background interception, persistent caching, and multi-tier recovery.
 */
const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
let fileType = null;
try { fileType = require('file-type'); } catch (_) {}

const VO_DIR = path.join(__dirname, '../database/viewonce');
const VO_INDEX = path.join(VO_DIR, 'index.json');
const MAX_VO_ITEMS = 60;

// In-memory caches
const voCache = new Map();         // id -> { id, chat, sender, fromMe, mediaType, caption, mimetype, filePath, buffer, timestamp, mediaNode }
const lastVoByChat = new Map();    // chat -> id

// Ensure dir exists
if (!fs.existsSync(VO_DIR)) {
    try { fs.mkdirSync(VO_DIR, { recursive: true }); } catch (_) {}
}

// Helper: download stream with timeout
async function downloadWithTimeout(mediaNode, streamType, timeoutMs = 15000) {
    if (!mediaNode || !mediaNode.mediaKey) return null;
    return new Promise(async (resolve, reject) => {
        let isDone = false;
        const timer = setTimeout(() => {
            if (!isDone) {
                isDone = true;
                reject(new Error(`Download timeout after ${timeoutMs}ms`));
            }
        }, timeoutMs);

        try {
            const stream = await downloadContentFromMessage(mediaNode, streamType);
            const chunks = [];
            for await (const chunk of stream) {
                if (isDone) break;
                chunks.push(chunk);
            }
            if (!isDone) {
                isDone = true;
                clearTimeout(timer);
                resolve(Buffer.concat(chunks));
            }
        } catch (err) {
            if (!isDone) {
                isDone = true;
                clearTimeout(timer);
                reject(err);
            }
        }
    });
}

// Load persisted index on startup
function loadIndex() {
    try {
        if (fs.existsSync(VO_INDEX)) {
            const raw = fs.readFileSync(VO_INDEX, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item && item.id) {
                        // Check if file still exists on disk
                        if (item.filePath && fs.existsSync(item.filePath)) {
                            voCache.set(item.id, item);
                            if (item.chat) lastVoByChat.set(item.chat, item.id);
                        }
                    }
                }
            }
            console.log(`[VO Engine] Loaded ${voCache.size} view once entries from disk index.`);
        }
    } catch (e) {
        console.error('[VO Engine] Failed to load index:', e.message);
    }
}
loadIndex();

function saveIndex() {
    try {
        const arr = Array.from(voCache.values()).map(item => ({
            id: item.id,
            chat: item.chat,
            sender: item.sender,
            fromMe: item.fromMe,
            mediaType: item.mediaType,
            caption: item.caption,
            mimetype: item.mimetype,
            filePath: item.filePath,
            timestamp: item.timestamp
        }));
        fs.writeFileSync(VO_INDEX, JSON.stringify(arr.slice(-MAX_VO_ITEMS), null, 2));
    } catch (e) {
        console.error('[VO Engine] Failed to save index:', e.message);
    }
}

function pruneOldItems() {
    if (voCache.size > MAX_VO_ITEMS) {
        const excess = voCache.size - MAX_VO_ITEMS;
        const keys = Array.from(voCache.keys());
        for (let i = 0; i < excess; i++) {
            const k = keys[i];
            const item = voCache.get(k);
            if (item?.filePath && fs.existsSync(item.filePath)) {
                try { fs.unlinkSync(item.filePath); } catch (_) {}
            }
            voCache.delete(k);
        }
        saveIndex();
    }
}

/**
 * Unwrap message safely without recursion or circular loops
 */
function extractViewOnce(msgObj) {
    if (!msgObj || typeof msgObj !== 'object') return null;
    let current = msgObj.message || msgObj;
    let isVO = Boolean(msgObj.isViewOnce || msgObj.viewOnce);

    const seen = new Set();
    for (let depth = 0; depth < 8; depth++) {
        if (!current || typeof current !== 'object' || seen.has(current)) break;
        seen.add(current);

        if (current.viewOnceMessage) {
            isVO = true;
            current = current.viewOnceMessage.message || current.viewOnceMessage;
            continue;
        }
        if (current.viewOnceMessageV2) {
            isVO = true;
            current = current.viewOnceMessageV2.message || current.viewOnceMessageV2;
            continue;
        }
        if (current.viewOnceMessageV2Extension) {
            isVO = true;
            current = current.viewOnceMessageV2Extension.message || current.viewOnceMessageV2Extension;
            continue;
        }
        if (current.ephemeralMessage) {
            current = current.ephemeralMessage.message || current.ephemeralMessage;
            continue;
        }
        if (current.documentWithCaptionMessage) {
            current = current.documentWithCaptionMessage.message || current.documentWithCaptionMessage;
            continue;
        }
        if (current.editedMessage) {
            current = current.editedMessage.message || current.editedMessage;
            continue;
        }
        break;
    }

    if (!current || typeof current !== 'object') return null;

    let mediaNode = null;
    let mediaType = null;

    if (current.imageMessage) {
        mediaNode = current.imageMessage;
        mediaType = 'image';
        if (mediaNode.viewOnce) isVO = true;
    } else if (current.videoMessage) {
        mediaNode = current.videoMessage;
        mediaType = 'video';
        if (mediaNode.viewOnce) isVO = true;
    } else if (current.audioMessage) {
        mediaNode = current.audioMessage;
        mediaType = 'audio';
        if (mediaNode.viewOnce) isVO = true;
    } else if (current.mimetype) {
        mediaNode = current;
        if (/image/.test(current.mimetype)) mediaType = 'image';
        else if (/video/.test(current.mimetype)) mediaType = 'video';
        else if (/audio/.test(current.mimetype)) mediaType = 'audio';
        if (current.viewOnce) isVO = true;
    }

    if (!isVO && !mediaNode?.viewOnce && !msgObj.isViewOnce) return null;
    if (!mediaNode) return null;

    return {
        mediaNode,
        mediaType: mediaType || 'image',
        caption: mediaNode.caption || current.caption || msgObj.caption || '',
        mimetype: mediaNode.mimetype || ''
    };
}

/**
 * Handle incoming message (regardless of fromMe) to immediately cache View Once media
 */
async function handleMessage(mek, client) {
    if (!mek || !mek.key || !mek.key.id) return;
    const extracted = extractViewOnce(mek);
    if (!extracted) return;

    const id = mek.key.id;
    const chat = mek.key.remoteJid;
    const fromMe = Boolean(mek.key.fromMe);
    const sender = mek.key.participant || (fromMe ? (client?.user?.id || '') : chat);
    const { mediaNode, mediaType, caption, mimetype } = extracted;

    console.log(`[VO Engine] 📥 Intercepted View Once ${id} (${mediaType}) in ${chat} from ${sender}`);

    // Immediately cache in memory & disk index so synchronous lookups find it right away
    const voEntry = {
        id,
        chat,
        sender,
        fromMe,
        mediaType,
        caption,
        mimetype,
        mediaNode,
        timestamp: Date.now(),
        buffer: null,
        filePath: null
    };

    voCache.set(id, voEntry);
    if (chat) lastVoByChat.set(chat, id);
    saveIndex();

    // Asynchronously pre-download the media buffer
    if (mediaNode?.mediaKey) {
        try {
            const streamType = mediaType === 'voice' ? 'audio' : mediaType;
            const buf = await downloadWithTimeout(mediaNode, streamType, 20000);

            if (buf && buf.length > 0) {
                voEntry.buffer = buf;
                const ext = mimetype.includes('video') ? 'mp4' : (mimetype.includes('audio') ? 'ogg' : 'jpg');
                const fPath = path.join(VO_DIR, `${id}.${ext}`);
                try {
                    fs.writeFileSync(fPath, buf);
                    voEntry.filePath = fPath;
                } catch (wErr) {
                    console.error('[VO Engine] Write file error:', wErr.message);
                }
                saveIndex();
                pruneOldItems();
                console.log(`[VO Engine] ✅ Successfully cached View Once: ${id} (${mediaType}, ${buf.length} bytes) in ${chat}`);
            }
        } catch (err) {
            console.error(`[VO Engine] ⚠️ Pre-download err for ${id}:`, err.message);
        }
    } else {
        console.warn(`[VO Engine] ⚠️ Message ${id} has no mediaKey in proto.`);
    }
}

function getVoById(id) {
    if (!id) return null;
    const item = voCache.get(id);
    if (item && !item.buffer && item.filePath && fs.existsSync(item.filePath)) {
        try { item.buffer = fs.readFileSync(item.filePath); } catch (_) {}
    }
    return item || null;
}

function getLatestVoInChat(chat) {
    if (!chat) return null;
    const lastId = lastVoByChat.get(chat);
    if (lastId) return getVoById(lastId);
    return null;
}

/**
 * Retrieve View Once media buffer & details for .rvo command
 */
async function resolveViewOnce(m, store, client) {
    const quotedId = m.msg?.contextInfo?.stanzaId || m.quoted?.id;
    let target = null;
    let resolveSource = '';

    // Tier 1: Check by quotedId in cache (in-memory or disk)
    if (quotedId) {
        target = getVoById(quotedId);
        if (target) resolveSource = 'Tier 1 (VO Cache by QuotedId)';
    }

    // Tier 2: Check Baileys store by quotedId
    if (!target && quotedId && store?.loadMessage) {
        try {
            const foundMsg = await store.loadMessage(m.chat, quotedId);
            if (foundMsg) {
                const ext = extractViewOnce(foundMsg);
                if (ext) {
                    target = {
                        id: quotedId,
                        chat: m.chat,
                        sender: foundMsg.key?.participant || (foundMsg.key?.fromMe ? client?.user?.id : m.chat),
                        fromMe: Boolean(foundMsg.key?.fromMe),
                        ...ext
                    };
                    resolveSource = 'Tier 2 (Baileys Store by QuotedId)';
                }
            }
        } catch (e) {
            console.error('[VO Engine] store.loadMessage error:', e.message);
        }
    }

    // Tier 3: If no quote provided, get the LATEST View Once in this chat from cache
    if (!target && !quotedId && m.chat) {
        target = getLatestVoInChat(m.chat);
        if (target) resolveSource = 'Tier 3 (Latest VO in Chat Cache)';
    }

    // Tier 4: If no quote provided, scan Baileys store backwards in this chat for the newest View Once
    if (!target && !quotedId && m.chat && store?.messages) {
        const chatMsgs = store.messages[m.chat];
        const arr = typeof chatMsgs?.array === 'function' ? chatMsgs.array : (Array.isArray(chatMsgs) ? chatMsgs : (chatMsgs?.array || []));
        for (let i = arr.length - 1; i >= 0; i--) {
            const cand = arr[i];
            const ext = extractViewOnce(cand);
            if (ext) {
                target = {
                    id: cand.key?.id,
                    chat: m.chat,
                    sender: cand.key?.participant || (cand.key?.fromMe ? client?.user?.id : m.chat),
                    fromMe: Boolean(cand.key?.fromMe),
                    ...ext
                };
                resolveSource = 'Tier 4 (Store Backward Scan)';
                break;
            }
        }
    }

    // Tier 5: Direct quote extraction from m.quoted or contextInfo.quotedMessage
    if (!target && (m.quoted || m.msg?.contextInfo?.quotedMessage)) {
        const rawQuote = m.msg?.contextInfo?.quotedMessage || m.quoted?.message || m.quoted;
        const ext = extractViewOnce(rawQuote) || (m.quoted ? extractViewOnce(m.quoted) : null);
        if (ext) {
            target = {
                id: quotedId || m.quoted?.id,
                chat: m.chat,
                sender: m.quoted?.sender || m.msg?.contextInfo?.participant,
                fromMe: Boolean(m.quoted?.fromMe),
                ...ext
            };
            resolveSource = 'Tier 5 (Direct Quote Proto)';
        } else if (m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'videoMessage' || m.quoted.mtype === 'audioMessage' || /image|video|audio/.test(m.quoted.mimetype || ''))) {
            target = {
                id: m.quoted.id,
                chat: m.chat,
                sender: m.quoted.sender,
                fromMe: Boolean(m.quoted.fromMe),
                mediaNode: m.quoted.msg || m.quoted,
                mediaType: m.quoted.mtype?.replace('Message', '').toLowerCase() || (m.quoted.mimetype ? m.quoted.mimetype.split('/')[0] : 'image'),
                caption: m.quoted.caption || m.quoted.text || '',
                mimetype: m.quoted.mimetype || ''
            };
            resolveSource = 'Tier 5 (Direct Quote Media Fallback)';
        }
    }

    if (!target) {
        console.log('[VO Engine] ❌ No VO target found in any tier for chat:', m.chat);
        return null;
    }

    console.log(`[VO Engine] 🎯 Target resolved via ${resolveSource}:`, {
        id: target.id,
        mediaType: target.mediaType,
        hasBuffer: Boolean(target.buffer),
        hasFilePath: Boolean(target.filePath),
        hasMediaKey: Boolean(target.mediaNode?.mediaKey)
    });

    // Resolve buffer
    let buffer = target.buffer || null;
    if (!buffer && target.filePath && fs.existsSync(target.filePath)) {
        try { buffer = fs.readFileSync(target.filePath); } catch (_) {}
    }

    // If no buffer yet, try downloading via mediaNode stream (only if mediaKey is available)
    if (!buffer && target.mediaNode?.mediaKey) {
        try {
            const streamType = target.mediaType === 'voice' ? 'audio' : target.mediaType;
            buffer = await downloadWithTimeout(target.mediaNode, streamType, 15000);
            if (buffer?.length) console.log(`[VO Engine] Downloaded via mediaNode stream (${buffer.length} bytes)`);
        } catch (e) {
            console.error('[VO Engine] Stream download err:', e.message);
        }
    }

    // Fallback: client.downloadMediaMessage (only if mediaKey is available)
    if (!buffer && client?.downloadMediaMessage && (target.mediaNode?.mediaKey || target.mediaKey)) {
        try {
            buffer = await client.downloadMediaMessage(target.mediaNode || target);
            if (buffer?.length) console.log(`[VO Engine] Downloaded via client.downloadMediaMessage (${buffer.length} bytes)`);
        } catch (e) {
            console.error('[VO Engine] client.downloadMediaMessage err:', e.message);
        }
    }

    if (!buffer || buffer.length === 0) {
        console.warn('[VO Engine] ⚠️ Target found but buffer is empty for id:', target.id);
        return {
            failed: true,
            target,
            hasQuoted: Boolean(quotedId),
            error: target.mediaNode?.mediaKey ? 'Gagal mengunduh media dari server WhatsApp' : 'Kunci dekripsi (mediaKey) tidak ditemukan (pesan dikirim sebelum bot aktif)'
        };
    }

    // Cache successful download to disk & RAM
    if (buffer && buffer.length > 0 && target.id) {
        target.buffer = buffer;
        if (!target.filePath) {
            const ext = (target.mimetype || '').includes('video') ? 'mp4' : ((target.mimetype || '').includes('audio') ? 'ogg' : 'jpg');
            const fPath = path.join(VO_DIR, `${target.id}.${ext}`);
            try {
                fs.writeFileSync(fPath, buffer);
                target.filePath = fPath;
            } catch (_) {}
        }
        voCache.set(target.id, target);
        if (target.chat) lastVoByChat.set(target.chat, target.id);
        saveIndex();
    }

    // Detect mediaType if ambiguous
    let mediaType = target.mediaType;
    if (fileType) {
        try {
            const det = await fileType.fromBuffer(buffer);
            if (det) {
                if (/video/.test(det.mime)) mediaType = 'video';
                else if (/audio/.test(det.mime)) mediaType = 'audio';
                else if (/image/.test(det.mime)) mediaType = 'image';
            }
        } catch (_) {}
    }

    return {
        id: target.id,
        chat: target.chat,
        sender: target.sender,
        fromMe: target.fromMe,
        mediaType: mediaType || 'image',
        caption: target.caption || '',
        mimetype: target.mimetype || (mediaType === 'video' ? 'video/mp4' : (mediaType === 'audio' ? 'audio/ogg' : 'image/jpeg')),
        buffer
    };
}

module.exports = {
    handleMessage,
    resolveViewOnce,
    extractViewOnce,
    getVoById,
    getLatestVoInChat
};

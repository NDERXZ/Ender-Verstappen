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
    } catch (_) {}
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
 * Recursively unwrap message to check for View Once media
 */
function extractViewOnce(msgObj) {
    if (!msgObj || typeof msgObj !== 'object') return null;
    let current = msgObj.message || msgObj;
    let isVO = false;

    let depth = 0;
    while (current && typeof current === 'object' && depth < 6) {
        depth++;
        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            continue;
        }
        if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
            continue;
        }
        if (current.viewOnceMessage?.message) {
            isVO = true;
            current = current.viewOnceMessage.message;
            continue;
        }
        if (current.viewOnceMessageV2?.message) {
            isVO = true;
            current = current.viewOnceMessageV2.message;
            continue;
        }
        if (current.viewOnceMessageV2Extension?.message) {
            isVO = true;
            current = current.viewOnceMessageV2Extension.message;
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

    // Immediately cache in memory so synchronous lookups find it right away
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

    // Asynchronously pre-download the media buffer
    if (mediaNode?.mediaKey) {
        try {
            const streamType = mediaType === 'voice' ? 'audio' : mediaType;
            const stream = await downloadContentFromMessage(mediaNode, streamType);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buf = Buffer.concat(chunks);

            if (buf && buf.length > 0) {
                voEntry.buffer = buf;
                const ext = mimetype.includes('video') ? 'mp4' : (mimetype.includes('audio') ? 'ogg' : 'jpg');
                const fPath = path.join(VO_DIR, `${id}.${ext}`);
                try {
                    fs.writeFileSync(fPath, buf);
                    voEntry.filePath = fPath;
                } catch (_) {}
                saveIndex();
                pruneOldItems();
                console.log(`[VO Engine] ✅ Cached View Once: ${id} (${mediaType}, ${buf.length} bytes) in ${chat}`);
            }
        } catch (err) {
            console.error(`[VO Engine] ⚠️ Pre-download err for ${id}:`, err.message);
        }
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

    // Tier 1: Check by quotedId in cache (in-memory or disk)
    if (quotedId) {
        target = getVoById(quotedId);
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
                }
            }
        } catch (_) {}
    }

    // Tier 3: If no quote or not found by quote, get the LATEST View Once in this chat from cache
    if (!target && m.chat) {
        target = getLatestVoInChat(m.chat);
    }

    // Tier 4: Scan Baileys store backwards in this chat for the newest View Once
    if (!target && m.chat && store?.messages) {
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
                break;
            }
        }
    }

    // Tier 5: Direct quote extraction from m.quoted
    if (!target && m.quoted) {
        const ext = extractViewOnce(m.quoted) || extractViewOnce(m.quoted.message);
        if (ext) {
            target = {
                id: m.quoted.id,
                chat: m.chat,
                sender: m.quoted.sender,
                fromMe: Boolean(m.quoted.fromMe),
                ...ext
            };
        } else if (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'videoMessage' || m.quoted.mtype === 'audioMessage' || /image|video|audio/.test(m.quoted.mimetype || '')) {
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
        }
    }

    if (!target) return null;

    // Resolve buffer
    let buffer = target.buffer || null;
    if (!buffer && target.filePath && fs.existsSync(target.filePath)) {
        try { buffer = fs.readFileSync(target.filePath); } catch (_) {}
    }

    // If no buffer yet, try downloading via mediaNode stream
    if (!buffer && target.mediaNode?.mediaKey) {
        try {
            const streamType = target.mediaType === 'voice' ? 'audio' : target.mediaType;
            const stream = await downloadContentFromMessage(target.mediaNode, streamType);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            buffer = Buffer.concat(chunks);
        } catch (e) {
            console.error('[VO Engine] Stream download err:', e.message);
        }
    }

    // Fallback: client.downloadMediaMessage
    if (!buffer && client?.downloadMediaMessage) {
        try {
            buffer = await client.downloadMediaMessage(target.mediaNode || target);
        } catch (_) {}
    }

    // Fallback: m.quoted.download()
    if (!buffer && m.quoted?.download) {
        try { buffer = await m.quoted.download(); } catch (_) {}
    }

    if (!buffer || buffer.length === 0) return null;

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
        buffer,
        mediaType: mediaType || 'image',
        mimetype: target.mimetype || (mediaType === 'video' ? 'video/mp4' : (mediaType === 'audio' ? 'audio/ogg; codecs=opus' : 'image/jpeg')),
        caption: target.caption || '',
        sender: target.sender || '',
        id: target.id || ''
    };
}

module.exports = {
    handleMessage,
    extractViewOnce,
    getVoById,
    getLatestVoInChat,
    resolveViewOnce,
    voCache,
    lastVoByChat
};

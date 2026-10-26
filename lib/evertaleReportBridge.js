const WebSocket = require('ws');
const fs = require('fs');

const EVERTALE_CONFIG = {
    panelUrl: process.env.EVERTALE_PANEL_URL || 'https://panel.ultraservers.com',
    apiKey: process.env.EVERTALE_API_KEY || '',
    serverId: process.env.EVERTALE_SERVER_ID || 'f61dc82f',
    targetGroupName: process.env.EVERTALE_TARGET_GROUP || 'EvertaleMC (COMING SOON)',
    targetGroupJid: process.env.EVERTALE_GROUP_JID || '120363413247847627@g.us'
};

let cachedGroupJid = null;
let activeWs = null;
let isConnecting = false;
let reconnectTimer = null;

function getActiveSocket() {
    try {
        if (global._BOT_SESSIONS) {
            const sessions = [...global._BOT_SESSIONS.values()];
            const main = sessions.find(s => s.isMain && s.sock && s.status === 'CONNECTED');
            if (main && main.sock) return main.sock;
            const anyActive = sessions.find(s => s.sock && s.status === 'CONNECTED');
            if (anyActive && anyActive.sock) return anyActive.sock;
        }
        if (global._AB_SOCK) return global._AB_SOCK;
    } catch (e) {
        console.error('[EvertaleBridge] getActiveSocket error:', e.message);
    }
    return null;
}

async function resolveGroupJid(sock) {
    if (EVERTALE_CONFIG.targetGroupJid) return EVERTALE_CONFIG.targetGroupJid;
    if (cachedGroupJid) return cachedGroupJid;
    try {
        if (!sock || typeof sock.groupFetchAllParticipating !== 'function') {
            console.warn('[EvertaleBridge] Socket is not ready to fetch groups');
            return null;
        }
        const groups = await sock.groupFetchAllParticipating();
        const lowerTarget = EVERTALE_CONFIG.targetGroupName.toLowerCase().trim();

        for (const [id, meta] of Object.entries(groups)) {
            const subj = (meta.subject || '').toLowerCase().trim();
            if (subj === lowerTarget || subj.includes(lowerTarget)) {
                cachedGroupJid = id;
                console.log(`[EvertaleBridge] Found target group: "${meta.subject}" -> ${id}`);
                return id;
            }
        }
    } catch (err) {
        console.error('[EvertaleBridge] Error resolving group JID:', err.message);
    }
    return cachedGroupJid;
}

async function sendEvertaleReport(data) {
    const sock = getActiveSocket();
    if (!sock) {
        console.error('[EvertaleBridge] Cannot send report: WhatsApp bot is not connected yet.');
        return { ok: false, error: 'Bot is not connected' };
    }

    const groupJid = await resolveGroupJid(sock);
    if (!groupJid) {
        console.error('[EvertaleBridge] Cannot send report: Target WhatsApp group not found.');
        return { ok: false, error: 'Target group not found' };
    }

    const reporter = String(data.reporter || 'Player').trim();
    const target = String(data.target || 'Unknown').trim();
    const reason = String(data.reason || '-').trim();
    const world = String(data.world || 'world').trim();
    const x = data.x !== undefined ? data.x : '?';
    const y = data.y !== undefined ? data.y : '?';
    const z = data.z !== undefined ? data.z : '?';

    // Format time in WIB (UTC+7)
    let wibTime = '';
    try {
        wibTime = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(new Date());
    } catch {
        wibTime = new Date().toISOString();
    }

    const messageText = 
`╔═ 𝗘𝗩𝗘𝗥𝗧𝗔𝗟𝗘 𝗥𝗘𝗣𝗢𝗥𝗧 ✦
║ » Pelapor   : *${reporter}*
║ » Terlapor  : *${target}*
║ » Alasan    : *${reason}*
╚═════

╔═ 𝗜𝗡𝗙𝗢 ✦
║ » World     : *${world}*
║ » Koordinat : *X: ${x}, Y: ${y}, Z: ${z}*
║ » Waktu     : *${wibTime} WIB*
╚═════ EvertaleMC`;

    try {
        // Format dokumen card seperti .mcstatus dengan foto & tulisan Ender Verstappen
        const docBuf = fs.existsSync("./package.json") ? fs.readFileSync("./package.json") : Buffer.from('{}');
        const thumbBuf = fs.existsSync("./assets/doc.jpg") 
            ? fs.readFileSync("./assets/doc.jpg") 
            : (fs.existsSync("./assets/thumb.jpg") ? fs.readFileSync("./assets/thumb.jpg") : undefined);

        await sock.sendMessage(groupJid, {
            document: docBuf,
            fileName: global.filename || global.namaBot || 'Ender Verstappen',
            fileLength: 99999999999999,
            mimetype: 'image/png',
            jpegThumbnail: thumbBuf,
            caption: "\n" + messageText
        });

        console.log(`[EvertaleBridge] Report for ${target} sent with Ender Verstappen card to WhatsApp (${groupJid})`);
        return { ok: true, groupJid };
    } catch (sendErr) {
        console.error('[EvertaleBridge] Failed to send report message:', sendErr.message);
        return { ok: false, error: sendErr.message };
    }
}

global.sendEvertaleReport = sendEvertaleReport;

async function connectBridge() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        console.log('[EvertaleBridge] Requesting Pterodactyl WebSocket token from UltraServers...');
        const res = await fetch(`${EVERTALE_CONFIG.panelUrl}/api/client/servers/${EVERTALE_CONFIG.serverId}/websocket`, {
            headers: {
                'Authorization': `Bearer ${EVERTALE_CONFIG.apiKey}`,
                'Accept': 'application/json'
            }
        });

        if (!res.ok) {
            throw new Error(`UltraServers API HTTP ${res.status}`);
        }

        const json = await res.json();
        const { token, socket } = json.data;

        console.log('[EvertaleBridge] Connecting to Pterodactyl WebSocket stream...');
        const ws = new WebSocket(socket, {
            headers: {
                'Origin': EVERTALE_CONFIG.panelUrl
            }
        });

        activeWs = ws;

        ws.on('open', () => {
            console.log('[EvertaleBridge] WebSocket open. Authenticating...');
            ws.send(JSON.stringify({
                event: 'auth',
                args: [token]
            }));
        });

        ws.on('message', async (rawData) => {
            try {
                const msg = JSON.parse(rawData.toString());
                if (msg.event === 'auth success') {
                    console.log('\x1b[32m[EvertaleBridge] Authenticated successfully with EvertaleMC console stream!\x1b[0m');
                } else if (msg.event === 'token expiring') {
                    console.log('[EvertaleBridge] Token expiring, refreshing token...');
                    const refreshRes = await fetch(`${EVERTALE_CONFIG.panelUrl}/api/client/servers/${EVERTALE_CONFIG.serverId}/websocket`, {
                        headers: {
                            'Authorization': `Bearer ${EVERTALE_CONFIG.apiKey}`,
                            'Accept': 'application/json'
                        }
                    });
                    const refreshJson = await refreshRes.json();
                    ws.send(JSON.stringify({
                        event: 'auth',
                        args: [refreshJson.data.token]
                    }));
                } else if (msg.event === 'token expired') {
                    ws.close();
                } else if (msg.event === 'console output') {
                    const line = String(msg.args?.[0] || '');
                    if (line.includes('[EVERTALE_REPORT]')) {
                        handleConsoleReport(line);
                    }
                }
            } catch {}
        });

        ws.on('close', (code, reason) => {
            console.warn(`[EvertaleBridge] WebSocket closed (code: ${code}). Reconnecting in 10s...`);
            activeWs = null;
            isConnecting = false;
            scheduleReconnect(10000);
        });

        ws.on('error', (err) => {
            console.error('[EvertaleBridge] WebSocket error:', err.message);
        });

    } catch (err) {
        console.error('[EvertaleBridge] Connection error:', err.message);
        isConnecting = false;
        scheduleReconnect(15000);
    }
}

function scheduleReconnect(delayMs) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        connectBridge().catch(() => {});
    }, delayMs);
}

function handleConsoleReport(line) {
    try {
        console.log('[EvertaleBridge] Received in-game report:', line);
        const idx = line.indexOf('[EVERTALE_REPORT]');
        const dataPart = line.substring(idx + '[EVERTALE_REPORT]'.length).trim();
        const parts = dataPart.split('|');
        const reportData = {};
        for (const part of parts) {
            const sepIdx = part.indexOf(':');
            if (sepIdx !== -1) {
                const k = part.substring(0, sepIdx).trim();
                const v = part.substring(sepIdx + 1).trim();
                reportData[k] = v;
            }
        }
        sendEvertaleReport(reportData);
    } catch (err) {
        console.error('[EvertaleBridge] Error parsing report:', err.message);
    }
}

function initEvertaleBridge() {
    console.log('[EvertaleBridge] Initializing EvertaleMC report bridge...');
    connectBridge().catch((e) => console.error('[EvertaleBridge] Bridge init error:', e.message));
}

module.exports = {
    initEvertaleBridge,
    sendEvertaleReport,
    resolveGroupJid
};

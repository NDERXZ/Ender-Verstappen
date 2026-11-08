const WebSocket = require('ws');
const fs = require('fs');

const EVERTALE_CONFIG = {
    panelUrl: process.env.EVERTALE_PANEL_URL || 'https://panel.ultraservers.com',
    apiKey: process.env.EVERTALE_API_KEY || '',
    serverId: process.env.EVERTALE_SERVER_ID || 'f61dc82f',
    targetGroupName: process.env.EVERTALE_TARGET_GROUP || 'EvertaleMC Admin Gokil',
    targetGroupJid: process.env.EVERTALE_GROUP_JID || '120363413247847627@g.us'
};

let cachedGroupJid = null;
let activeWs = null;
let isConnecting = false;
let reconnectTimer = null;
let pingTimer = null;
let watchdogTimer = null;

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
    if (!sock) return cachedGroupJid || EVERTALE_CONFIG.targetGroupJid;

    try {
        if (typeof sock.groupFetchAllParticipating === 'function') {
            const groups = await sock.groupFetchAllParticipating();
            const lowerTarget = (EVERTALE_CONFIG.targetGroupName || '').toLowerCase().trim();

            // 1. Exact match with targetGroupName
            for (const [id, meta] of Object.entries(groups)) {
                const subj = (meta.subject || '').toLowerCase().trim();
                if (subj === lowerTarget) {
                    cachedGroupJid = id;
                    return id;
                }
            }

            // 2. Partial match with targetGroupName
            if (lowerTarget) {
                for (const [id, meta] of Object.entries(groups)) {
                    const subj = (meta.subject || '').toLowerCase().trim();
                    if (subj.includes(lowerTarget)) {
                        cachedGroupJid = id;
                        return id;
                    }
                }
            }

            // 3. Fallback match: contains 'evertale' and 'admin'
            for (const [id, meta] of Object.entries(groups)) {
                const subj = (meta.subject || '').toLowerCase().trim();
                if (subj.includes('evertale') && subj.includes('admin')) {
                    cachedGroupJid = id;
                    console.log(`[EvertaleBridge] Found target group by keyword: "${meta.subject}" -> ${id}`);
                    return id;
                }
            }

            // 4. If targetGroupJid is in participating groups, verify it
            if (EVERTALE_CONFIG.targetGroupJid && groups[EVERTALE_CONFIG.targetGroupJid]) {
                cachedGroupJid = EVERTALE_CONFIG.targetGroupJid;
                return cachedGroupJid;
            }
        }
    } catch (err) {
        console.error('[EvertaleBridge] Error resolving group JID dynamically:', err.message);
    }

    if (cachedGroupJid) return cachedGroupJid;
    return EVERTALE_CONFIG.targetGroupJid || null;
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
        console.warn('[EvertaleBridge] Document card send failed, trying text fallback:', sendErr.message);
        try {
            await sock.sendMessage(groupJid, { text: messageText });
            console.log(`[EvertaleBridge] Report for ${target} sent as text fallback to WhatsApp (${groupJid})`);
            return { ok: true, groupJid };
        } catch (fbErr) {
            console.error('[EvertaleBridge] Failed to send report message:', fbErr.message);
            return { ok: false, error: fbErr.message };
        }
    }
}

global.sendEvertaleReport = sendEvertaleReport;

function stopPing() {
    if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
    }
}

function startPing(ws) {
    stopPing();
    pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    event: 'send stats',
                    args: [null]
                }));
            } catch {}
        }
    }, 25000);
}

function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
            console.warn('[EvertaleBridge] Watchdog check: WebSocket is not open (readyState=' + (activeWs ? activeWs.readyState : 'null') + '). Reconnecting...');
            isConnecting = false;
            connectBridge().catch(() => {});
        }
    }, 45000);
}

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
            isConnecting = false;
            ws.send(JSON.stringify({
                event: 'auth',
                args: [token]
            }));
            startPing(ws);
        });

        ws.on('message', async (rawData) => {
            try {
                const msg = JSON.parse(rawData.toString());
                if (msg.event === 'auth success') {
                    console.log('\x1b[32m[EvertaleBridge] Authenticated successfully with EvertaleMC console stream!\x1b[0m');
                } else if (msg.event === 'token expiring') {
                    console.log('[EvertaleBridge] Token expiring, refreshing token...');
                    try {
                        const refreshRes = await fetch(`${EVERTALE_CONFIG.panelUrl}/api/client/servers/${EVERTALE_CONFIG.serverId}/websocket`, {
                            headers: {
                                'Authorization': `Bearer ${EVERTALE_CONFIG.apiKey}`,
                                'Accept': 'application/json'
                            }
                        });
                        if (!refreshRes.ok) throw new Error(`HTTP ${refreshRes.status}`);
                        const refreshJson = await refreshRes.json();
                        const newToken = refreshJson.data?.token;
                        if (newToken && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                event: 'auth',
                                args: [newToken]
                            }));
                            console.log('[EvertaleBridge] Refreshed token sent to WebSocket stream');
                        } else {
                            throw new Error('Token is missing or socket not open');
                        }
                    } catch (tokenErr) {
                        console.error('[EvertaleBridge] Token refresh error:', tokenErr.message);
                        try { ws.close(); } catch {}
                    }
                } else if (msg.event === 'token expired') {
                    console.warn('[EvertaleBridge] Token expired, closing WebSocket to force reconnect...');
                    try { ws.close(); } catch {}
                } else if (msg.event === 'console output') {
                    const line = String(msg.args?.[0] || '');
                    if (line.includes('[EVERTALE_REPORT]')) {
                        handleConsoleReport(line);
                    }
                }
            } catch (msgErr) {
                // Silent parse error
            }
        });

        ws.on('close', (code, reason) => {
            console.warn(`[EvertaleBridge] WebSocket closed (code: ${code}). Reconnecting in 5s...`);
            stopPing();
            activeWs = null;
            isConnecting = false;
            scheduleReconnect(5000);
        });

        ws.on('error', (err) => {
            console.error('[EvertaleBridge] WebSocket error:', err.message);
            stopPing();
            try { ws.close(); } catch {}
        });

    } catch (err) {
        console.error('[EvertaleBridge] Connection error:', err.message);
        stopPing();
        activeWs = null;
        isConnecting = false;
        scheduleReconnect(10000);
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
    startWatchdog();
    connectBridge().catch((e) => console.error('[EvertaleBridge] Bridge init error:', e.message));
}

module.exports = {
    initEvertaleBridge,
    sendEvertaleReport,
    resolveGroupJid
};

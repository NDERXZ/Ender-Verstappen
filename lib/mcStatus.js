const net = require('net');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');

const MC_CONFIG_PATH = path.join(process.cwd(), 'database', 'mcserver.json');

const DEFAULT_CONFIG = {
    pteroPanelUrl: 'https://panel.ultraservers.com',
    pteroApiKey: process.env.PTERO_CLIENT_KEY || '',
    pteroServerId: 'f61dc82f',
    host: 'evertalemc.id',
    port: 19005,
    rconPort: 25575,
    rconPassword: '',
    serverName: 'EvertaleMC',
    version: '1.8.x - 1.21.x'
};

function getMcConfig() {
    try {
        if (fs.existsSync(MC_CONFIG_PATH)) {
            const raw = JSON.parse(fs.readFileSync(MC_CONFIG_PATH, 'utf8'));
            return { ...DEFAULT_CONFIG, ...raw };
        }
    } catch {}
    return { ...DEFAULT_CONFIG };
}

function saveMcConfig(cfg) {
    const current = getMcConfig();
    const updated = { ...current, ...cfg };
    fs.mkdirSync(path.dirname(MC_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(MC_CONFIG_PATH, JSON.stringify(updated, null, 2));
    return updated;
}

function parsePanelInput(rawUrl) {
    let str = String(rawUrl || '').trim();
    if (!str) return { panelUrl: '', serverId: '' };
    if (!/^https?:\/\//i.test(str)) {
        str = 'https://' + str;
    }
    try {
        const u = new URL(str);
        const panelUrl = `${u.protocol}//${u.host}`;
        const m = u.pathname.match(/\/server\/([a-zA-Z0-9\-]+)/i);
        return {
            panelUrl,
            serverId: m ? m[1] : ''
        };
    } catch {
        return {
            panelUrl: str.replace(/\/+$/, ''),
            serverId: ''
        };
    }
}

function stripMcColors(str) {
    return String(str || '')
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
        .replace(/[§&][0-9a-fk-orx]/gi, '')
        .replace(/[\uE000-\uF8FF]/g, '')
        .replace(/\r/g, '')
        .trim();
}

function cleanConsoleLine(line) {
    let s = stripMcColors(line);
    // Strip standard MC server log prefix e.g. [00:33:57 INFO]: or [12:34:56] [Server thread/INFO]:
    s = s.replace(/^\[?\d{2}:\d{2}:\d{2}[^\]]*\]?:?\s*(?:\[[^\]]*?\]:?\s*)?/i, '');
    return s.trim();
}

function writeVarInt(val) {
    const bytes = [];
    let v = val >>> 0;
    while (true) {
        if ((v & ~0x7f) === 0) {
            bytes.push(v);
            break;
        }
        bytes.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    return Buffer.from(bytes);
}

function readVarInt(buf, offset = 0) {
    let numRead = 0;
    let result = 0;
    let read;
    do {
        if (offset + numRead >= buf.length) return null;
        read = buf[offset + numRead];
        const value = read & 0x7f;
        result |= value << (7 * numRead);
        numRead++;
        if (numRead > 5) throw new Error('VarInt too big');
    } while ((read & 0x80) !== 0);
    return { value: result, length: numRead };
}

function resolveSrvRecord(host, defaultPort = 25565) {
    return new Promise((resolve) => {
        if (!host) return resolve({ host: '', port: defaultPort });
        if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || defaultPort !== 25565) {
            return resolve({ host, port: defaultPort });
        }
        dns.resolveSrv(`_minecraft._tcp.${host}`, (err, addresses) => {
            if (!err && Array.isArray(addresses) && addresses.length > 0) {
                resolve({ host: addresses[0].name, port: addresses[0].port });
            } else {
                resolve({ host, port: defaultPort });
            }
        });
    });
}

async function pingMcJava(rawHost, rawPort = 25565, timeoutMs = 5000) {
    if (!rawHost) return { online: false, error: 'Host kosong' };
    const target = await resolveSrvRecord(rawHost, Number(rawPort) || 25565);
    return new Promise((resolve) => {
        const startTime = Date.now();
        let settled = false;
        const done = (res) => {
            if (settled) return;
            settled = true;
            try { sock.destroy(); } catch {}
            resolve(res);
        };

        const sock = new net.Socket();
        sock.setTimeout(timeoutMs);

        let chunks = Buffer.alloc(0);

        sock.on('connect', () => {
            const connectLatency = Date.now() - startTime;
            sock._connectLatency = connectLatency;

            const hostBuf = Buffer.from(target.host, 'utf8');
            const portBuf = Buffer.alloc(2);
            portBuf.writeUInt16BE(target.port, 0);

            const handshakeData = Buffer.concat([
                writeVarInt(0x00),
                writeVarInt(767),
                writeVarInt(hostBuf.length),
                hostBuf,
                portBuf,
                writeVarInt(1)
            ]);
            const handshakePacket = Buffer.concat([writeVarInt(handshakeData.length), handshakeData]);
            const statusReqPacket = Buffer.from([0x01, 0x00]);

            sock.write(Buffer.concat([handshakePacket, statusReqPacket]));
        });

        sock.on('data', (data) => {
            chunks = Buffer.concat([chunks, data]);
            try {
                const pktLen = readVarInt(chunks, 0);
                if (!pktLen) return;
                const totalNeeded = pktLen.length + pktLen.value;
                if (chunks.length < totalNeeded) return;

                const pktId = readVarInt(chunks, pktLen.length);
                if (!pktId || pktId.value !== 0x00) return;

                const strLenOffset = pktLen.length + pktId.length;
                const strLen = readVarInt(chunks, strLenOffset);
                if (!strLen) return;

                const jsonStart = strLenOffset + strLen.length;
                const jsonStr = chunks.slice(jsonStart, jsonStart + strLen.value).toString('utf8');
                const parsed = JSON.parse(jsonStr);

                let motd = '';
                if (typeof parsed.description === 'string') {
                    motd = parsed.description;
                } else if (parsed.description) {
                    motd = (parsed.description.text || '') +
                        (Array.isArray(parsed.description.extra) ? parsed.description.extra.map(e => e.text || '').join('') : '');
                }

                const samplePlayers = Array.isArray(parsed.players?.sample)
                    ? parsed.players.sample
                        .map(p => stripMcColors(p.name))
                        .filter(name => name && !/^anonymous/i.test(name))
                    : [];

                done({
                    online: true,
                    host: rawHost,
                    resolvedHost: target.host,
                    port: target.port,
                    latencyMs: sock._connectLatency || (Date.now() - startTime),
                    version: stripMcColors(parsed.version?.name || 'Unknown'),
                    playersOnline: parsed.players?.online ?? 0,
                    playersMax: parsed.players?.max ?? 0,
                    playersList: samplePlayers,
                    motd: stripMcColors(motd)
                });
            } catch (e) {
                done({ online: false, error: e.message });
            }
        });

        sock.on('timeout', () => done({ online: false, error: 'Connection timeout' }));
        sock.on('error', (err) => done({ online: false, error: err.message }));

        sock.connect(target.port, target.host);
    });
}

function buildRconPacket(reqId, type, payloadStr) {
    const bodyBuf = Buffer.from(String(payloadStr || ''), 'utf8');
    const length = 4 + 4 + bodyBuf.length + 2;
    const buf = Buffer.alloc(4 + length);
    buf.writeInt32LE(length, 0);
    buf.writeInt32LE(reqId, 4);
    buf.writeInt32LE(type, 8);
    bodyBuf.copy(buf, 12);
    buf.writeInt16LE(0, 12 + bodyBuf.length);
    return buf;
}

function execRconCommands(host, port, password, commands = [], timeoutMs = 6000) {
    return new Promise((resolve) => {
        if (!host || !port || !password) {
            return resolve({ ok: false, error: 'RCON belum dikonfigurasi' });
        }
        let settled = false;
        const results = {};
        const sock = new net.Socket();
        sock.setTimeout(timeoutMs);

        const done = (res) => {
            if (settled) return;
            settled = true;
            try { sock.destroy(); } catch {}
            resolve(res);
        };

        let recvBuf = Buffer.alloc(0);
        let authed = false;
        let cmdIndex = 0;

        const sendNextCommand = () => {
            if (cmdIndex >= commands.length) {
                return done({ ok: true, results });
            }
            const cmd = commands[cmdIndex];
            sock.write(buildRconPacket(100 + cmdIndex, 2, cmd));
        };

        sock.on('connect', () => {
            sock.write(buildRconPacket(1, 3, password));
        });

        sock.on('data', (chunk) => {
            recvBuf = Buffer.concat([recvBuf, chunk]);
            while (recvBuf.length >= 4) {
                const pktLen = recvBuf.readInt32LE(0);
                if (recvBuf.length < 4 + pktLen) break;

                const reqId = recvBuf.readInt32LE(4);
                const type = recvBuf.readInt32LE(8);
                const body = recvBuf.slice(12, 4 + pktLen - 2).toString('utf8');
                recvBuf = recvBuf.slice(4 + pktLen);

                if (!authed) {
                    if (reqId === -1) {
                        return done({ ok: false, error: 'Password RCON salah' });
                    }
                    if (type === 2 || reqId === 1) {
                        authed = true;
                        sendNextCommand();
                    }
                } else if (reqId >= 100) {
                    const idx = reqId - 100;
                    const cmdName = commands[idx];
                    results[cmdName] = (results[cmdName] || '') + body;
                    cmdIndex++;
                    sendNextCommand();
                }
            }
        });

        sock.on('timeout', () => done({ ok: authed, results, error: 'RCON timeout' }));
        sock.on('error', (err) => done({ ok: false, error: err.message }));

        sock.connect(Number(port), host);
    });
}

function queryPteroWebsocketConsole(panelUrl, wsUrl, token, commands = ['spark tps', 'list'], waitMs = 2600) {
    return new Promise((resolve) => {
        const lines = [];
        let settled = false;
        let collectTimer = null;

        const done = (ok, err = '') => {
            if (settled) return;
            settled = true;
            if (collectTimer) clearTimeout(collectTimer);
            try { ws.close(); } catch {}
            resolve({ ok, lines, error: err });
        };

        let ws;
        try {
            ws = new WebSocket(wsUrl, {
                headers: { Origin: panelUrl },
                handshakeTimeout: 5000,
                rejectUnauthorized: false
            });
        } catch (e) {
            return done(false, e.message);
        }

        const hardTimeout = setTimeout(() => {
            done(lines.length > 0, lines.length > 0 ? '' : 'WebSocket console timeout');
        }, waitMs + 3500);

        ws.on('open', () => {
            ws.send(JSON.stringify({ event: 'auth', args: [token] }));
        });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.event === 'auth success') {
                    commands.forEach((cmd, idx) => {
                        setTimeout(() => {
                            try {
                                ws.send(JSON.stringify({ event: 'send command', args: [cmd] }));
                            } catch {}
                        }, idx * 150);
                    });
                    collectTimer = setTimeout(() => {
                        clearTimeout(hardTimeout);
                        done(true);
                    }, waitMs);
                } else if (msg.event === 'console output' && Array.isArray(msg.args)) {
                    for (const arg of msg.args) {
                        const split = String(arg).split('\n');
                        for (const l of split) {
                            const cl = cleanConsoleLine(l);
                            if (cl) lines.push(cl);
                        }
                    }
                }
            } catch {}
        });

        ws.on('error', (err) => {
            clearTimeout(hardTimeout);
            done(lines.length > 0, err.message);
        });

        ws.on('close', () => {
            clearTimeout(hardTimeout);
            done(lines.length > 0);
        });
    });
}

function parseConsoleTpsAndList(lines) {
    const tpsLines = [];
    let playersOnline = null;
    let playersMax = null;
    let playersList = [];
    const playersByRank = [];
    let captureSparkBlock = false;
    let inListSection = false;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        if (!rawLine || /^(spark tps|list|\[Essentials\] CONSOLE issued)/i.test(rawLine)) continue;

        // Check if it's a Spark [⚡] line
        if (rawLine.startsWith('[⚡]')) {
            const cleanSpark = rawLine.replace(/^\[⚡\]\s*/, '').trim();
            if (cleanSpark) {
                tpsLines.push(cleanSpark);
            }
            continue;
        }

        // Match standard / Essentials / Paper /list header:
        // "There are 13 out of maximum 777 players online."
        // or "There are 3 of a max of 100 players online: PlayerA, PlayerB"
        const listMatch = rawLine.match(/There are\s+(\d+)\s+(?:of a max of|out of maximum|\/)\s+(\d+)\s+players online\.?:?(.*)/i);
        if (listMatch) {
            playersOnline = Number(listMatch[1]);
            playersMax = Number(listMatch[2]);
            inListSection = true;
            captureSparkBlock = false;
            const rest = (listMatch[3] || '').trim();
            if (rest) {
                const splitP = rest.split(',').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
                playersList.push(...splitP);
            }
            continue;
        }

        // Match standard non-[⚡] TPS lines
        if (/TPS from last/i.test(rawLine) || /Tick durations/i.test(rawLine) || /CPU usage from last/i.test(rawLine)) {
            captureSparkBlock = true;
            inListSection = false;
            tpsLines.push(rawLine);
            continue;
        }

        if (captureSparkBlock) {
            if (/^[\d*]+(\.\d+)?/.test(rawLine) || /(?:ms|%|min\/med|5s,\s*10s|10s,\s*1m|\(system\)|\(process\))/i.test(rawLine)) {
                tpsLines.push(rawLine);
                continue;
            } else {
                captureSparkBlock = false;
            }
        }

        // If we are right after "There are X out of maximum Y players online."
        if (inListSection) {
            // Stop if another unrelated server log line comes in
            if (/^\[/.test(rawLine) || /\b(issued server command|joined the game|left the game|lost connection|moved too quickly|UUID of player)\b/i.test(rawLine)) {
                continue;
            }
            const rankMatch = rawLine.match(/^([a-zA-Z0-9_\-]+)\s*:\s*(.+)$/);
            if (rankMatch) {
                const rankName = rankMatch[1].trim();
                const membersRaw = rankMatch[2].replace(/\s+/g, ' ').trim();
                playersByRank.push({ rank: rankName, members: membersRaw });
                const membersArr = membersRaw.split(',').map(s => s.trim()).filter(Boolean);
                playersList.push(...membersArr);
                continue;
            } else if (playersList.length === 0 && playersOnline > 0) {
                const membersArr = rawLine.split(',').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
                playersList.push(...membersArr);
            }
        }
    }

    let tpsValues = '';
    for (let j = 0; j < tpsLines.length; j++) {
        if (/TPS from last/i.test(tpsLines[j])) {
            const afterColon = tpsLines[j].split(':').slice(1).join(':').trim();
            if (afterColon) {
                tpsValues = afterColon;
            } else if (tpsLines[j + 1]) {
                tpsValues = tpsLines[j + 1].trim();
            }
            break;
        }
    }
    if (!tpsValues && tpsLines.length > 0) {
        const numLine = tpsLines.find(l => /^[\d*]+(\.\d+)?\s*,/.test(l));
        tpsValues = numLine || tpsLines[0];
    }

    return {
        sparkTps: tpsLines.join('\n').trim(),
        tpsValues,
        playersOnline,
        playersMax,
        playersList,
        playersByRank
    };
}

async function queryPteroServer(panelUrlInput, apiKey, preferredServerId = '') {
    const { panelUrl, serverId: urlServerId } = parsePanelInput(panelUrlInput);
    const targetId = preferredServerId || urlServerId;

    if (!panelUrl || !apiKey) {
        return { ok: false, error: 'URL Panel atau Client API Key (ptlc_) belum diisi' };
    }

    const headers = {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'Application/vnd.pterodactyl.v1+json',
        'Content-Type': 'application/json'
    };

    try {
        let serverAttr = null;

        if (targetId) {
            const detailRes = await axios.get(`${panelUrl}/api/client/servers/${targetId}`, { headers, timeout: 7000 });
            serverAttr = detailRes.data?.attributes || null;
        } else {
            const listRes = await axios.get(`${panelUrl}/api/client`, { headers, timeout: 7000 });
            const servers = Array.isArray(listRes.data?.data) ? listRes.data.data.map(d => d.attributes) : [];
            if (servers.length === 0) {
                return { ok: false, error: 'Tidak ada server yang ditemukan pada API Key tersebut' };
            }
            // Prefer server with "mc" / "evertale" / "minecraft" or port 25565, otherwise first server
            serverAttr = servers.find(s => /evertale|mc|minecraft|smp|survival/i.test(s.name || '')) ||
                servers.find(s => {
                    const allocs = s.relationships?.allocations?.data || [];
                    return allocs.some(a => a.attributes?.port === 25565 || a.attributes?.port >= 19132);
                }) ||
                servers[0];
        }

        if (!serverAttr) {
            return { ok: false, error: 'Data server tidak ditemukan di Panel' };
        }

        const identifier = serverAttr.identifier;
        const allocs = serverAttr.relationships?.allocations?.data || [];
        const defAlloc = (allocs.find(a => a.attributes?.is_default) || allocs[0])?.attributes || {};
        const allocHost = defAlloc.ip_alias || defAlloc.ip || '';
        const allocPort = defAlloc.port || 25565;

        // Fetch live resources
        const resResp = await axios.get(`${panelUrl}/api/client/servers/${identifier}/resources`, { headers, timeout: 7000 });
        const resAttr = resResp.data?.attributes || {};
        const currentState = resAttr.current_state || 'offline';
        const resources = resAttr.resources || {};

        let consoleData = { sparkTps: '', playersOnline: null, playersMax: null, playersList: [] };
        let wsError = '';

        if (currentState === 'running') {
            try {
                const wsResp = await axios.get(`${panelUrl}/api/client/servers/${identifier}/websocket`, { headers, timeout: 7000 });
                const wsToken = wsResp.data?.data?.token;
                const wsSocket = wsResp.data?.data?.socket;
                if (wsToken && wsSocket) {
                    const wsResult = await queryPteroWebsocketConsole(panelUrl, wsSocket, wsToken, ['spark tps', 'list'], 2600);
                    if (wsResult.ok && wsResult.lines.length > 0) {
                        consoleData = parseConsoleTpsAndList(wsResult.lines);
                        if (!consoleData.sparkTps && wsResult.lines.length > 0) {
                            // Fallback: include last 8 lines of output if custom TPS plugin format is used
                            consoleData.rawConsoleSample = wsResult.lines.slice(-8).join('\n');
                        }
                    } else if (wsResult.error) {
                        wsError = wsResult.error;
                    }
                }
            } catch (e) {
                wsError = e.response?.data?.errors?.[0]?.detail || e.message;
            }
        }

        return {
            ok: true,
            panelUrl,
            identifier,
            name: serverAttr.name || 'Minecraft Server',
            node: serverAttr.node || '-',
            allocHost,
            allocPort,
            state: currentState,
            limits: serverAttr.limits || {},
            resources: {
                memoryBytes: resources.memory_bytes || 0,
                cpuAbsolute: resources.cpu_absolute || 0,
                diskBytes: resources.disk_bytes || 0,
                uptimeMs: resources.uptime || 0,
                networkRxBytes: resources.network_rx_bytes || 0,
                networkTxBytes: resources.network_tx_bytes || 0
            },
            consoleData,
            wsError
        };
    } catch (err) {
        const status = err.response?.status;
        const detail = err.response?.data?.errors?.[0]?.detail || err.message;
        return {
            ok: false,
            error: status ? `HTTP ${status}: ${detail}` : detail
        };
    }
}

async function queryFullMcStatus(customCfg = null) {
    const cfg = customCfg ? { ...getMcConfig(), ...customCfg } : getMcConfig();

    let pteroInfo = null;
    if (cfg.pteroPanelUrl && cfg.pteroApiKey) {
        pteroInfo = await queryPteroServer(cfg.pteroPanelUrl, cfg.pteroApiKey, cfg.pteroServerId);
    }

    const targetHost = cfg.host || pteroInfo?.allocHost || '';
    const targetPort = cfg.port || pteroInfo?.allocPort || 25565;

    if (!targetHost && !pteroInfo?.ok) {
        return {
            configured: false,
            hasApiKeyOnly: !!cfg.pteroApiKey && !cfg.pteroPanelUrl,
            pteroError: pteroInfo?.error || ''
        };
    }

    const pingRes = targetHost
        ? await pingMcJava(targetHost, targetPort)
        : { online: false };

    let sparkTpsText = pteroInfo?.consoleData?.sparkTps || pteroInfo?.consoleData?.rawConsoleSample || '';
    let consolePlayers = pteroInfo?.consoleData?.playersList || [];
    let rconError = pteroInfo?.wsError || '';

    // If RCON is also configured and we still don't have TPS, try RCON
    if (!sparkTpsText && cfg.rconPassword && cfg.rconPort && targetHost) {
        const rconHost = pingRes.resolvedHost || targetHost;
        const rconRes = await execRconCommands(
            rconHost,
            cfg.rconPort,
            cfg.rconPassword,
            ['spark tps', 'tps', 'list']
        );

        if (rconRes.ok && rconRes.results) {
            const rawSpark = stripMcColors(rconRes.results['spark tps'] || '');
            const rawTps = stripMcColors(rconRes.results['tps'] || '');
            if (rawSpark && !/unknown|incomplete|not found/i.test(rawSpark)) {
                sparkTpsText = rawSpark;
            } else if (rawTps && !/unknown|incomplete|not found/i.test(rawTps)) {
                sparkTpsText = rawTps;
            }

            const rawList = stripMcColors(rconRes.results['list'] || '');
            if (rawList && rawList.includes(':')) {
                const afterColon = rawList.split(':').slice(1).join(':').trim();
                const parsedRconPlayers = afterColon
                    ? afterColon.split(',').map(s => s.trim()).filter(Boolean)
                    : [];
                if (parsedRconPlayers.length > 0) consolePlayers = parsedRconPlayers;
            }
        } else if (rconRes.error) {
            rconError = rconRes.error;
        }
    }

    const finalPlayersList = consolePlayers.length > 0
        ? consolePlayers
        : (pingRes.playersList || []);

    const isOnline = pteroInfo?.ok
        ? (pteroInfo.state === 'running' || !!pingRes.online)
        : !!pingRes.online;

    return {
        configured: true,
        serverName: pteroInfo?.name || cfg.serverName || targetHost,
        host: targetHost || '-',
        port: targetPort,
        online: isOnline,
        state: pteroInfo?.state || (pingRes.online ? 'running' : 'offline'),
        latencyMs: pingRes.latencyMs || 0,
        version: cfg.version || (pingRes.version && !/^(Paper|Spigot|Bukkit|Purpur)/i.test(pingRes.version) ? pingRes.version : '1.8.x - 1.21.x'),
        backendVersion: pingRes.version || '-',
        motd: pingRes.motd || '-',
        playersOnline: pteroInfo?.consoleData?.playersOnline ?? pingRes.playersOnline ?? finalPlayersList.length,
        playersMax: pteroInfo?.consoleData?.playersMax ?? pingRes.playersMax ?? 0,
        playersList: finalPlayersList,
        playersByRank: pteroInfo?.consoleData?.playersByRank || [],
        sparkTps: sparkTpsText,
        tpsValues: pteroInfo?.consoleData?.tpsValues || sparkTpsText.split('\n')[0] || '',
        ptero: pteroInfo?.ok ? {
            identifier: pteroInfo.identifier,
            node: pteroInfo.node,
            limits: pteroInfo.limits,
            resources: pteroInfo.resources
        } : null,
        pteroError: pteroInfo && !pteroInfo.ok ? pteroInfo.error : '',
        rconConfigured: !!(pteroInfo?.ok || (cfg.rconPassword && cfg.rconPort)),
        rconError
    };
}

module.exports = {
    getMcConfig,
    saveMcConfig,
    parsePanelInput,
    pingMcJava,
    execRconCommands,
    queryPteroServer,
    queryFullMcStatus
};

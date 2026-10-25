const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');

function maskPhone(phone) {
    const clean = String(phone || '').replace(/[^0-9]/g, '');
    if (clean.length < 8) return clean || 'Unknown';
    const prefix = clean.slice(0, 5);
    const suffix = clean.slice(-4);
    return `+${prefix.slice(0, 2)} ${prefix.slice(2)}-****-${suffix}`;
}

function normalizePhone(raw) {
    let clean = String(raw || '').trim().replace(/[^0-9]/g, '');
    if (clean.startsWith('08')) {
        clean = '62' + clean.slice(1);
    } else if (clean.startsWith('8')) {
        clean = '62' + clean;
    }
    return clean;
}

let _cachedCommandsData = null;
function loadCommandsCatalog() {
    if (_cachedCommandsData) return _cachedCommandsData;
    const categories = [
        { id: 'main', icon: 'bi-grid-1x2', label: 'Core & System', desc: 'Diagnostik sistem, status runtime, dan informasi gateway', cmds: ['menu','help','mcstatus','setmc','tps','ping','status','speed','owner','ceksewa','bothealth','antibanstatus','safemode','warmupstatus','queuestatus','securityreport','auditlog','incidents','delayanalytics','forensiclog','reconnectstatus'] },
        { id: 'ai', icon: 'bi-cpu', label: 'AI & LLM', desc: 'Integrasi model bahasa multi-provider', cmds: ['ai','chatgpt','openai','gpt4o','deepseek','deepseekr1','gemini','geminipro','geminiflash','groq','llama','mixtral','qwen','gemma','claude','codeai','muslimai','mathgpt','cici','dola'] },
        { id: 'aiimg', icon: 'bi-bounding-box', label: 'Vision & Imaging', desc: 'Pemrosesan citra dan sintesis gambar', cmds: ['txt2img','imagine','animegen','sora2','nanobanana','imgedit','removebg','nobg','toghibli','toanime','tochibi','tofigure','tohijab','to3d','tocartoon','tomanga','tooilpainting'] },
        { id: 'download', icon: 'bi-cloud-arrow-down', label: 'Media Extractor', desc: 'Ekstraksi media dari platform pihak ketiga', cmds: ['tt','tiktok','ttmp3','igdl','fbdl','fbhd','ytmp3','ytmp4','ytplay','youtube','spotify','threads','mediafire','capcut','soundcloud','terabox','snackvideodl','pixeldraindl','videy'] },
        { id: 'sticker', icon: 'bi-layers', label: 'Sticker & Asset', desc: 'Konversi media ke format WebP dan utilitas stiker', cmds: ['sticker','s','toimg','attp','ttp','brat','bratvid','furbrat','emojimix','quotesimage','wallpaper','colongsw','pinterest','qc'] },
        { id: 'grup', icon: 'bi-people', label: 'Group Administration', desc: 'Manajemen anggota, izin, dan konfigurasi grup', cmds: ['promote','demote','kick','kickall','add','kickinactive','cleangrup','tagall','hidetag','delete','setnamegc','setdesc','infogc','setppgc','copygc','pin','unpin','revoke','joinapproval','slowmode','lockgrup','autoswgc','topaktif'] },
        { id: 'proteksi', icon: 'bi-shield-check', label: 'Group Security', desc: 'Filter otomatis, anti-spam, dan mitigasi raid', cmds: ['addblacklist','removeblacklist','listblacklist','antinsfw','antiocrlink','antiraid','antilink','antilinkWA','antispam','antivortex','antiautobot','antiimage','antivideo','antisticker','warn','maxwarn','resetwarn','shadowban','captcha','inviteguard'] },
        { id: 'game', icon: 'bi-controller', label: 'Interactive Modules', desc: 'Modul interaktif berbasis sesi grup', cmds: ['tebakkata','susunkata','scramble','caklontong','suit','rps','tebakgambar','family100','asahotak','siapakahaku'] },
        { id: 'rpg', icon: 'bi-bar-chart', label: 'Progression & Economy', desc: 'Manajemen data statistik pengguna dan aktivitas', cmds: ['rpg','rpgmenu','rpgprofile','rpgstats','usercard','kartu','minicard','profile','daily','claim','exp','koin','saldo','leaderboard','top','afk'] },
        { id: 'hiburan', icon: 'bi-chat-square-text', label: 'Community Tools', desc: 'Utilitas interaksi sosial dalam grup', cmds: ['ship','truth','dare','confess','menfess','soulmatch','cekkhodam','khodam','rate','apakah','akankah','siapa','puisi','cekcantik','cekganteng','cekwibu','cekhoki','cekbucin'] },
        { id: 'audio', icon: 'bi-soundwave', label: 'Audio DSP', desc: 'Pemrosesan sinyal audio FFmpeg dan sintesis suara', cmds: ['tts','ttsgoku','ttseminem','ttsmickey','ttsnahida','nightcore','bassboost','slowed','fast','robot','reverse','earrape','echo','tupai'] },
        { id: 'canvas', icon: 'bi-vector-pen', label: 'Canvas & Typography', desc: 'Render template grafis secara dinamis', cmds: ['wanted','wasted','jail','ektp','fakediscord','fakedana','fakeovo','fakejago','glitchtext','neonglitch','glowingtext','luxurygold','galaxystyle','royaltext','cartoonstyle'] },
        { id: 'tools', icon: 'bi-wrench-adjustable', label: 'System Utilities', desc: 'Alat bantu produktivitas, OCR, dan jaringan', cmds: ['ocr','wikipedia','brainly','wattpad','jadwalbola','jadwalsholat','asmaulhusna','kisahnabi','doa','zodiak','tafsirmimpi','artinama','checklink','shortlink','ssweb'] },
        { id: 'security', icon: 'bi-shield-lock', label: 'Engine Security', desc: 'Diagnostik sesi, firewall internal, dan proteksi rate-limit', cmds: ['doctor','healthcheck','autofix','sysinfo','sessionhealth','firewall','honeypot','lockdown','quarantine','messagevault','sandboxscan'] }
    ];

    let totalCases = 869;
    try {
        const mainPath = path.join(process.cwd(), 'Cantarella.js');
        if (fs.existsSync(mainPath)) {
            const raw = fs.readFileSync(mainPath, 'utf8');
            const matches = [...raw.matchAll(/^\s*case\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
            const unique = [...new Set(matches)];
            if (unique.length > 0) {
                totalCases = unique.length;
                const existing = new Set();
                categories.forEach(c => c.cmds.forEach(cmd => existing.add(cmd)));
                const extra = unique.filter(cmd => !existing.has(cmd));
                if (extra.length > 0) {
                    categories.push({
                        id: 'extended',
                        icon: 'bi-sliders',
                        label: 'Extended Modules',
                        desc: 'Modul perintah tambahan yang terdaftar pada sistem',
                        cmds: extra
                    });
                }
            }
        }
    } catch {}

    _cachedCommandsData = { total: totalCases, categories };
    return _cachedCommandsData;
}

function readJsonBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 64 * 1024) req.destroy();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                resolve({});
            }
        });
        req.on('error', () => resolve({}));
    });
}

function sendJson(res, statusCode, data) {
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(payload);
}

function serveStaticAsset(pathname, res) {
    const safeName = path.basename(pathname);
    const allowed = new Set(['banner.jpg', 'thumb.jpg', 'creator.jpg', 'profile.jpg', 'script.jpg', 'doc.jpg']);
    if (!allowed.has(safeName)) {
        res.writeHead(404);
        return res.end('Not Found');
    }
    const filePath = path.join(process.cwd(), 'assets', safeName);
    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end('Not Found');
    }
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
}

function getAppHtml() {
    const botName = global.botname || 'Cantarella';
    const ownerName = global.ownername || 'Ender';

    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#010101">
<title>${botName}</title>
<link rel="icon" type="image/jpeg" href="/assets/profile.jpg">
<link rel="stylesheet" href="https://cdn.nebula.style/icons/bootstrap/bootstrap-icons.css">
<link rel="stylesheet" href="https://cdn.nebula.style/icons/lucide/lucide.css">

<!-- NEBULA V2.0-1 VARIABLES (SYNCED WITH PANEL.ENDERTURU.MY.ID) -->
<style id="nebula-variables">
  :root {
    --sidebarPrimary: #ffffff;
    --sidebarPrimaryHover: #ffffff;
    --sidebarSecondary: #131010;
    --sidebarSecondaryHover: #1c1818;
    --sidebarSecondaryActive: #252020;
    --sidebarSecondarySelected: #fb4242;
    --sidebarButtonActive: #fb4242;

    --pagePrimary: #e9eaee;
    --pagePrimaryHover: #fb4242;
    --pageSecondary: #131010;
    --pageSecondaryHover: #1c1818;
    --pageSecondaryActive: #252020;
    --pageSecondarySelected: #2f2828;
    --pageButtonDefault: #fb4242;
    --pageButtonHover: #3a3232;

    --statusOffline: #524b4b;
    --statusError: #fb4242;
    --statusStarting: #e8bd15;
    --statusOnline: #42e33d;

    --sidebarBackground: #010101;
    --pageBackground: #010101;

    --borderRadius: 10px;
    --borderRadiusSidebar: 10px;
    --statusorb-background: var(--statusOnline);
    --statusorb-animation-name: online;
  }
</style>

<!-- NEBULA V2.0-1 CORE PANEL & SIDEBAR THEME -->
<style id="nebula-components">
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  ::-webkit-scrollbar {
    width: 3px !important;
    height: 3px !important;
  }
  ::-webkit-scrollbar-thumb {
    box-shadow: unset !important;
    border-radius: 4px !important;
    background-color: color-mix(in hsl, white 15%, transparent) !important;
  }

  html {
    background-color: var(--pageBackground) !important;
    color: var(--pagePrimary);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  body {
    padding-left: 75px;
    color: #fff;
    background-color: var(--pageBackground);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  button, input, select {
    font-family: inherit;
    color: inherit;
  }

  @keyframes online {
    0% { opacity: 1; }
    50% { opacity: 0.6; }
    100% { opacity: 1; }
  }

  @keyframes nebula-animation {
    0% {
      position: relative;
      bottom: -35px;
      opacity: 0;
    }
    100% {
      position: relative;
      bottom: 0px;
      opacity: 1;
    }
  }

  .nebula-fade {
    animation: nebula-animation 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  /* =========================================================
   * EXACT NEBULA 75PX FLOATING SIDEBAR
   * ========================================================= */
  .sidebar {
    transition: left 0.5s, width 1s !important;
    position: fixed;
    left: 0;
    top: 0px;
    width: 75px;
    height: 100%;
    background-color: var(--sidebarBackground);
    z-index: 50;
    border-radius: 0px var(--borderRadiusSidebar) var(--borderRadiusSidebar) 0px;
  }

  .sidebarContentContainer {
    margin: 0px 0px 10px 10px;
    overflow: visible;
  }

  .sidebarContent {
    height: 100vh;
    padding-top: 10px;
    overflow-y: scroll;
    overflow-x: visible;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .sidebarContent::-webkit-scrollbar {
    display: none;
  }

  .tooltip-toggle {
    position: relative;
    display: block;
  }

  .sidebarButton {
    border: none;
    background-color: var(--sidebarSecondary);
    width: calc(75px - 10px - 10px);
    height: calc(75px - 10px - 10px);
    border-radius: var(--borderRadiusSidebar);
    margin-bottom: 10px;
    overflow: hidden;
    position: relative;
    left: 0px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background-color 0.3s,
      border 0.2s,
      margin-left 0.3s,
      left 0.3s,
      height 0.3s !important;
  }

  .sidebarButton:hover {
    background-color: var(--sidebarSecondaryHover);
  }

  .sidebarButton:active {
    background-color: var(--sidebarSecondaryActive);
  }

  .sidebarButtonSelected {
    background-color: var(--sidebarButtonActive) !important;
  }

  .sidebarIcon {
    color: var(--sidebarPrimary);
    font-size: calc(32px * 0.9);
    line-height: 1;
    transition: color 0.3s, opacity 0.3s !important;
  }

  .sidebarSpacer {
    padding-bottom: 12px;
    margin-left: 12.5%;
    margin-right: 12.5%;
    width: calc(75% - 10px);
    border-top: 1px solid var(--sidebarSecondary);
  }

  @media screen and (min-width: 760px) {
    .sidebarButton:hover {
      position: relative;
      left: 7px;
    }
  }

  /* NEBULA TIPPY-STYLE RIGHT TOOLTIP */
  .tooltip-toggle .nebula-tip {
    position: fixed;
    left: 78px;
    background-color: var(--sidebarSecondaryActive);
    color: var(--sidebarPrimary);
    border-radius: var(--borderRadiusSidebar);
    padding: 5px 11px;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transform: translateX(-10px);
    transition: opacity 0.18s ease, transform 0.18s ease;
    z-index: 9999;
  }
  @media screen and (min-width: 760px) {
    .tooltip-toggle:hover .nebula-tip {
      opacity: 1;
      transform: translateX(0);
    }
  }

  /* =========================================================
   * NEBULA MOBILE NAVIGATION (< 760px)
   * ========================================================= */
  .nebula-mobile-nav {
    display: none;
  }
  .nebula-mobile-overlay {
    display: none;
  }

  @media screen and (max-width: 760px) {
    body {
      padding-left: unset !important;
      padding-bottom: 85px;
    }
    .sidebar {
      display: none;
      z-index: 101;
    }
    .nebula-mobile-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 80px;
      z-index: 99;
      display: flex;
      justify-content: center;
      align-items: center;
      flex-direction: row;
      background: linear-gradient(180deg, transparent 0%, var(--pageBackground) 100%);
    }
    .mobile-nav-container {
      margin-left: 12px;
      margin-right: 12px;
    }
    .mobile-nav-icon {
      font-size: 20px;
      color: var(--sidebarPrimary);
    }
    .mobile-nav-button {
      border: none;
      background-color: var(--sidebarSecondary);
      border-radius: 100px;
      padding: 10px 25px;
      cursor: pointer;
    }
    .nebula-mobile-overlay {
      width: 100%;
      height: 100%;
      opacity: 0;
      display: none;
      position: fixed;
      left: -200px;
      top: 0;
      transition: opacity 0.4s, left 0.4s;
      z-index: 100;
      background: linear-gradient(90deg, var(--pageBackground) 75%, transparent 100%);
    }
  }

  /* =========================================================
   * PTERODACTYL + NEBULA PAGE CONTENT CONTAINER
   * ========================================================= */
  .PageContentBlock {
    width: 100%;
    max-width: 1200px;
    margin: 2rem auto;
    padding: 0 1.5rem;
    flex: 1;
  }

  /* TOP SERVER HEADER + POWER PILL BUTTONS */
  .nebula-header-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;
    margin-bottom: 1.25rem;
    align-items: end;
  }

  .nebula-header-left {
    grid-column: span 3 / span 3;
  }

  h1.nebula-server-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #f9fafb;
    line-height: 1.625;
    display: flex;
    align-items: center;
  }

  h1.nebula-server-title::before {
    content: '';
    display: inline-block;
    width: 12.5px;
    height: 12.5px;
    border-radius: 6.25px;
    background-color: var(--statusorb-background);
    margin-right: 10px;
    flex-shrink: 0;
    transition: background-color 0.3s;
    animation-name: var(--statusorb-animation-name);
    animation-duration: 5s;
    animation-iteration-count: infinite;
    animation-timing-function: linear;
  }

  .nebula-server-desc {
    margin-left: 23px;
    font-size: 0.875rem;
    color: var(--pagePrimary);
    opacity: 0.78;
  }

  .nebula-power-group {
    grid-column: span 1 / span 1;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .nebula-power-btn {
    border: none;
    background-color: var(--pageSecondary);
    color: var(--pagePrimary);
    border-radius: 100px;
    width: 33.3%;
    height: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.3s;
  }

  .nebula-power-btn:hover {
    background-color: var(--pageSecondaryHover);
  }

  .nebula-power-btn i {
    font-size: 21px;
    line-height: 1;
  }

  /* =========================================================
   * EXACT NEBULA SERVER CARDS (serversCards.css)
   * ========================================================= */
  .nebula-cards-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .ServerRow__StatusIndicatorBox {
    position: relative;
    height: 155px;
    background-color: var(--pageSecondary);
    border-radius: var(--borderRadius);
    overflow: hidden;
    border: none;
    transition: background-color 0.3s;
  }

  .ServerRow__StatusIndicatorBox:hover {
    background-color: var(--pageSecondaryHover);
  }

  .ServerRow__StatusIndicatorBox .status-bar {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-top: var(--ActiveColor) solid 5px !important;
    background: linear-gradient(180deg, color-mix(in hsl, var(--ActiveColor) 15%, transparent) 0, rgba(0, 0, 0, 0) 75%);
    z-index: 1;
    pointer-events: none;
  }

  .ServerRow__StatusIndicatorBox.is-online {
    --ActiveColor: var(--statusOnline);
  }

  .ServerRow__StatusIndicatorBox.is-starting {
    --ActiveColor: var(--statusStarting);
  }

  .ServerRow__StatusIndicatorBox.is-offline {
    --ActiveColor: var(--statusOffline);
  }

  .server-card-top {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .server-card-id {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .server-card-icon {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    background-color: var(--pageSecondaryHover);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .server-card-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .server-card-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--pagePrimary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .server-card-sub {
    font-size: 0.78rem;
    color: var(--pagePrimary);
    opacity: 0.65;
    display: block;
  }

  .server-card-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .card-act-btn {
    border: none;
    background-color: var(--pageSecondaryActive);
    color: var(--pagePrimary);
    height: 30px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: background-color 0.2s;
  }

  .card-act-btn:hover {
    background-color: var(--pageSecondarySelected);
  }

  .card-act-btn.danger:hover {
    background-color: var(--statusError);
    color: #fff;
  }

  .server-card-bottom {
    position: absolute;
    bottom: 10px;
    left: 10px;
    right: 10px;
    z-index: 2;
    display: flex;
    gap: 8px;
  }

  .server-card-pill {
    background-color: var(--pageSecondaryHover);
    padding: 10px 12px;
    border-radius: 6px;
    flex: 1 1 0%;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    color: var(--pagePrimary);
    min-width: 0;
  }

  .server-card-pill i {
    color: var(--pagePrimary);
    opacity: 0.75;
    font-size: 14px;
  }

  .server-card-pill span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  /* =========================================================
   * NEBULA 4-COLUMN CONSOLE & ROTATED-WATERMARK STAT CARDS
   * ========================================================= */
  .nebula-console-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;
    margin-bottom: 1.25rem;
    align-items: start;
  }

  .nebula-console-main {
    grid-column: span 3 / span 3;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .nebula-stats-col {
    grid-column: span 1 / span 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* EXACT NEBULA WATERMARK TELEMETRY CARD (style-module_2Vp6MaXq) */
  .style-module_2Vp6MaXq {
    background-color: var(--pageSecondary);
    border-radius: var(--borderRadius);
    padding: 1rem 1.25rem;
    position: relative;
    overflow: hidden;
    color: #fff !important;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 74px;
  }

  .stat-card-info {
    position: relative;
    z-index: 5;
  }

  .stat-card-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--pagePrimary);
    opacity: 0.65;
    font-weight: 600;
  }

  .stat-card-val {
    font-size: 1.05rem;
    font-weight: 700;
    color: #ffffff;
    margin-top: 2px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .stat-watermark-icon {
    z-index: 4;
    margin-right: 18px;
    scale: 4.2;
    rotate: -20deg;
    color: #ffffff12 !important;
    transition: color 0.3s, scale 0.3s, background-color 0.3s;
    pointer-events: none;
  }

  .style-module_2Vp6MaXq:hover .stat-watermark-icon {
    scale: 4.5;
    color: #ffffff18 !important;
  }

  /* =========================================================
   * NEBULA TITLED GREY BOX (Settings / Provisioning Box)
   * ========================================================= */
  .TitledGreyBox {
    background-color: var(--pageSecondary);
    border-radius: var(--borderRadius);
    overflow: hidden;
  }

  .TitledGreyBox-header {
    background-color: var(--pageSecondary);
    padding: 1rem 1.25rem 0.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .TitledGreyBox-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--pagePrimary);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .TitledGreyBox-body {
    padding: 1rem 1.25rem 1.25rem;
  }

  .nebula-form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 0.75rem;
    align-items: end;
  }

  .nebula-label {
    display: block;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--pagePrimary);
    opacity: 0.8;
    margin-bottom: 6px;
  }

  .nebula-input {
    width: 100%;
    height: 42px;
    padding: 0 14px;
    background-color: var(--pageSecondaryActive);
    border: none;
    border-radius: var(--borderRadius);
    color: var(--pagePrimary);
    font-size: 0.9rem;
    outline: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    transition: background-color 0.2s;
  }

  .nebula-input:focus {
    background-color: var(--pageSecondarySelected);
  }

  .nebula-input::placeholder {
    color: var(--pagePrimary);
    opacity: 0.35;
  }

  /* NEBULA PRIMARY BUTTON (.cDkCmT) */
  .cDkCmT {
    height: 42px;
    padding: 0 20px;
    border: none;
    border-radius: var(--borderRadius);
    background-color: var(--pageButtonDefault);
    color: #ffffff;
    font-weight: 800;
    font-size: 0.88rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: background-color 0.4s;
    white-space: nowrap;
  }

  .cDkCmT:hover:not(:disabled) {
    background-color: var(--pageButtonHover);
  }

  .cDkCmT:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .nebula-btn-secondary {
    background-color: var(--pageSecondaryHover);
    font-weight: 700;
  }

  .nebula-btn-secondary:hover:not(:disabled) {
    background-color: var(--pageSecondaryActive);
  }

  /* PAIRING CODE VAULT (MessageBox style) */
  .MessageBox {
    margin-top: 1rem;
    background: var(--pageSecondaryHover);
    border-radius: var(--borderRadius);
    padding: 15px;
    display: none;
  }

  .MessageBox.active {
    display: block;
  }

  .pairing-code-banner {
    background-color: var(--pageSecondaryActive);
    border-radius: var(--borderRadius);
    padding: 14px;
    text-align: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 1.75rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    color: #ffffff;
    margin: 10px 0;
    user-select: all;
  }

  /* =========================================================
   * EXACT NEBULA XTERM TERMINAL (xterm-screen)
   * ========================================================= */
  .nebula-xterm-wrapper {
    position: relative;
    background-color: var(--pageSecondary);
    border-radius: var(--borderRadius);
    overflow: hidden;
  }

  .xterm-search-bar__addon {
    position: absolute;
    top: 0.65rem;
    right: 0.65rem;
    background-color: var(--pageSecondaryHover);
    z-index: 10;
    display: flex;
    align-items: center;
    border-radius: 100px;
    padding: 6px 10px;
    gap: 6px;
  }

  .xterm-search-bar__addon input {
    background-color: color-mix(in hsl, var(--pageSecondaryActive) 96%, white);
    color: #ccc;
    border: 0;
    padding: 2px 10px;
    height: 22px;
    width: 190px;
    border-radius: 100px;
    font-size: 12px;
    outline: none;
  }

  .xterm-screen {
    background-color: var(--pageSecondary) !important;
    padding: 1.25rem;
    height: 320px;
    overflow-y: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 13px;
    line-height: 1.55;
    color: var(--pagePrimary);
  }

  .xterm-line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  }

  .xterm-time {
    color: #888;
    margin-right: 6px;
  }

  .xterm-tag {
    color: var(--pagePrimaryHover);
    font-weight: 700;
    margin-right: 6px;
  }

  .xterm-cmd-bar {
    display: flex;
    align-items: center;
    background-color: var(--pageSecondaryHover);
    padding: 0 14px;
    height: 42px;
    gap: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
  }

  .xterm-cmd-bar input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: var(--pagePrimary);
    font-family: inherit;
    font-size: 13px;
  }

  /* =========================================================
   * NEBULA FILE-OBJECT-ROW STYLE COMMAND DIRECTORY
   * ========================================================= */
  .nebula-cat-bar {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 6px;
    margin-bottom: 12px;
  }

  .VersionBtn {
    border: none;
    background-color: var(--pageSecondary);
    color: var(--pagePrimary);
    border-radius: 100px;
    padding: 7px 14px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background-color 0.2s;
  }

  .VersionBtn:hover {
    background-color: var(--pageSecondaryHover);
  }

  .VersionBtn.selected {
    background-color: var(--pageSecondaryActive) !important;
    color: var(--pagePrimaryHover);
  }

  .nebula-files-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
    gap: 7px;
  }

  .style-module_1WqkLT9X {
    border-radius: var(--borderRadius);
    background-color: var(--pageSecondary);
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    transition: background-color 0.35s;
    color: var(--pagePrimary);
    opacity: 0.9;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
  }

  .style-module_1WqkLT9X:hover {
    background-color: var(--pageSecondaryHover);
    opacity: 1;
  }

  /* =========================================================
   * NEBULA WATERMARK FOOTER & FLOATING NOTIFICATION
   * ========================================================= */
  .nebulaFooter {
    text-align: center;
    font-size: 12px;
    font-weight: 300;
    color: #9aa5b1;
    text-decoration: none;
    padding-bottom: 12px;
    margin-top: 1.5rem;
  }

  .nebula-toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 90;
    background-color: var(--pageSecondaryHover);
    color: var(--pagePrimary);
    border-radius: var(--borderRadius);
    padding: 11px 16px;
    font-size: 13px;
    font-weight: 600;
    display: none;
    align-items: center;
    gap: 8px;
    box-shadow: var(--pageBackground) 0px 0px 27px 0px;
  }

  .nebula-toast.show {
    display: inline-flex;
  }

  @media screen and (max-width: 1015px) {
    .nebula-header-grid,
    .nebula-console-grid,
    .nebula-cards-grid {
      grid-template-columns: 1fr;
    }
    .nebula-header-left,
    .nebula-power-group,
    .nebula-console-main,
    .nebula-stats-col {
      grid-column: span 1 / span 1;
    }
    .nebula-form-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
</head>
<body>

<!-- =========================================================
     EXACT NEBULA 75PX FLOATING SIDEBAR
     ========================================================= -->
<div id="sidebar" class="sidebar">
  <div class="sidebarContentContainer">
    <div class="sidebarContent">

      <!-- Item: Home (Overview & Nodes) -->
      <div class="tooltip-toggle">
        <span class="nebula-tip">Overview</span>
        <button type="button" onclick="switchNebulaView('overview', this)" id="sidebarMainHome" class="sidebarButton sidebarButtonSelected">
          <i class="sidebarIcon icon-layers"></i>
        </button>
      </div>

      <div class="sidebarSpacer"></div>

      <!-- Category: Server / Gateway Management -->
      <div id="sidebarCategoryServer">
        <!-- Item: Terminal -->
        <div class="tooltip-toggle">
          <span class="nebula-tip">Terminal</span>
          <button type="button" onclick="switchNebulaView('terminal', this)" id="sidebarServerTerminal" class="sidebarButton">
            <i class="sidebarIcon icon-terminal-square"></i>
          </button>
        </div>

        <!-- Item: Network / Pairing -->
        <div class="tooltip-toggle">
          <span class="nebula-tip">Network &amp; Pairing</span>
          <button type="button" onclick="switchNebulaView('pairing', this)" id="sidebarServerNetwork" class="sidebarButton">
            <i class="sidebarIcon icon-network"></i>
          </button>
        </div>

        <!-- Item: Files / Command Modules -->
        <div class="tooltip-toggle">
          <span class="nebula-tip">Modules</span>
          <button type="button" onclick="switchNebulaView('modules', this)" id="sidebarServerFilemanager" class="sidebarButton">
            <i class="sidebarIcon icon-folder-open"></i>
          </button>
        </div>

        <!-- Item: Activity -->
        <div class="tooltip-toggle">
          <span class="nebula-tip">Activity</span>
          <button type="button" onclick="switchNebulaView('activity', this)" id="sidebarServerActivity" class="sidebarButton">
            <i class="sidebarIcon icon-scroll-text"></i>
          </button>
        </div>

        <div class="sidebarSpacer"></div>
      </div>

      <!-- Category: General / Panel Links -->
      <div id="sidebarCategoryGeneral">
        <!-- Item: Pterodactyl Panel -->
        <a href="https://panel.enderturu.my.id" target="_blank" rel="noopener">
          <div class="tooltip-toggle">
            <span class="nebula-tip">Panel</span>
            <button type="button" class="sidebarButton">
              <i class="sidebarIcon icon-sliders-horizontal"></i>
            </button>
          </div>
        </a>

        <!-- Item: Status API -->
        <a href="/api/status" target="_blank" rel="noopener">
          <div class="tooltip-toggle">
            <span class="nebula-tip">API</span>
            <button type="button" class="sidebarButton">
              <i class="sidebarIcon icon-globe"></i>
            </button>
          </div>
        </a>
      </div>

    </div>
  </div>
</div>

<!-- NEBULA MOBILE OVERLAY & BOTTOM BAR -->
<div class="nebula-mobile-overlay" id="mobileOverlay" onclick="closeMobileNav()"></div>
<div class="nebula-mobile-nav">
  <div class="mobile-nav-container">
    <button type="button" class="mobile-nav-button" onclick="switchNebulaView('overview', document.getElementById('sidebarMainHome'))">
      <i class="mobile-nav-icon bi bi-house-fill"></i>
    </button>
  </div>
  <div class="mobile-nav-container">
    <button type="button" class="mobile-nav-button" onclick="switchNebulaView('pairing', document.getElementById('sidebarServerNetwork'))">
      <i class="mobile-nav-icon bi bi-hdd-network"></i>
    </button>
  </div>
  <div class="mobile-nav-container">
    <button type="button" class="mobile-nav-button" onclick="toggleMobileNav()">
      <i class="mobile-nav-icon bi bi-list"></i>
    </button>
  </div>
</div>

<!-- =========================================================
     MAIN PTERODACTYL NEBULA PAGE CONTENT BLOCK
     ========================================================= -->
<main class="PageContentBlock nebula-fade" id="nebulaAppContainer">

  <!-- TOP SERVER HEADER + POWER PILL BUTTONS -->
  <div class="nebula-header-grid">
    <div class="nebula-header-left">
      <h1 class="nebula-server-title" id="pageHeaderTitle">${botName}</h1>
      <p class="nebula-server-desc" id="pageHeaderDesc">WhatsApp Multi-Device Gateway &middot; enderturu.my.id:25565</p>
    </div>
    <div class="nebula-power-group">
      <button type="button" class="nebula-power-btn" title="Pair New Device" onclick="document.getElementById('pairPhone').focus()">
        <i class="bi bi-play-fill"></i>
      </button>
      <button type="button" class="nebula-power-btn" title="Sync Status" id="topSyncBtn">
        <i class="bi bi-arrow-repeat"></i>
      </button>
      <button type="button" class="nebula-power-btn" title="Command Modules" onclick="switchNebulaView('modules', document.getElementById('sidebarServerFilemanager'))">
        <i class="bi bi-collection"></i>
      </button>
    </div>
  </div>

  <!-- SECTION: NEBULA SERVER CARDS (ACTIVE WHATSAPP SESSIONS) -->
  <section id="sec-server-cards">
    <div class="nebula-cards-grid" id="serverCardsContainer">
      <div class="ServerRow__StatusIndicatorBox is-online">
        <div class="status-bar"></div>
        <div class="server-card-top">
          <div class="server-card-id">
            <div class="server-card-icon"><img src="/assets/thumb.jpg" alt="Node"></div>
            <div>
              <div class="server-card-title">Memuat Node...</div>
              <span class="server-card-sub">Primary Gateway Node</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- SECTION: 4-COLUMN NEBULA CONSOLE + WATERMARK TELEMETRY CARDS -->
  <section class="nebula-console-grid" id="sec-console-workspace">
    <!-- LEFT 3 COLUMNS -->
    <div class="nebula-console-main">

      <!-- NODE PROVISIONING (TITLED GREY BOX) -->
      <div class="TitledGreyBox" id="box-provisioning">
        <div class="TitledGreyBox-header">
          <div class="TitledGreyBox-title">
            <i class="bi bi-hdd-network"></i>
            <span>Node Provisioning &amp; Session Filter</span>
          </div>
          <div style="width: 240px;">
            <input type="text" class="nebula-input" style="height: 32px; font-size: 12px;" id="filterSessionPhone" placeholder="Filter / Unmask nomor Anda...">
          </div>
        </div>
        <div class="TitledGreyBox-body">
          <form id="pairForm" class="nebula-form-grid" autocomplete="off">
            <div>
              <label class="nebula-label" for="pairPhone">Target WhatsApp Number</label>
              <input type="tel" class="nebula-input" id="pairPhone" placeholder="6281973866718" required>
            </div>
            <div>
              <label class="nebula-label" for="pairCustomCode">Custom Pairing Key (8 Chars)</label>
              <input type="text" class="nebula-input" id="pairCustomCode" maxlength="8" placeholder="OPTIONAL">
            </div>
            <button type="submit" class="cDkCmT" id="pairSubmitBtn">
              <i class="bi bi-key-fill"></i>
              <span>Generate Pairing Code</span>
            </button>
          </form>

          <!-- PAIRING CODE VAULT -->
          <div class="MessageBox" id="pairResultBox">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12.5px;">
              <span id="pairStatusLabel">Menunggu otorisasi perangkat...</span>
              <span id="pairCountdownLabel" style="font-family: monospace; font-weight: 700;">180s</span>
            </div>
            <div class="pairing-code-banner" id="pairCodeText">--------</div>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
              <span style="font-size: 12px; opacity: 0.75;">WhatsApp &rarr; Perangkat Tertaut &rarr; Tautkan dengan nomor telepon</span>
              <div style="display: flex; gap: 8px;">
                <button type="button" class="cDkCmT nebula-btn-secondary" style="height: 34px; padding: 0 14px; font-size: 12px;" id="copyCodeBtn">
                  <i class="bi bi-clipboard"></i> Salin Kode
                </button>
                <button type="button" class="cDkCmT nebula-btn-secondary" style="height: 34px; padding: 0 14px; font-size: 12px;" id="refreshPairBtn">
                  <i class="bi bi-arrow-repeat"></i> Request Ulang
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- NEBULA XTERM TERMINAL -->
      <div class="nebula-xterm-wrapper" id="box-terminal">
        <div class="xterm-search-bar__addon">
          <i class="bi bi-search" style="color: #aaa; font-size: 12px;"></i>
          <input type="text" id="logFilterInput" placeholder="Filter console logs...">
        </div>
        <div class="xterm-screen" id="xtermLogScreen"></div>
        <div class="xterm-cmd-bar">
          <i class="bi bi-chevron-right" style="color: var(--pagePrimaryHover);"></i>
          <input type="text" id="quickSearchCmdInput" placeholder="Ketik nama command untuk mencari di modul (contoh: .sticker, .ai, .tiktok)...">
        </div>
      </div>

    </div>

    <!-- RIGHT 1 COLUMN: 7 SIGNATURE NEBULA ROTATED-WATERMARK TELEMETRY CARDS -->
    <div class="nebula-stats-col">
      <div class="style-module_2Vp6MaXq">
        <div class="stat-card-info">
          <div class="stat-card-label">Address</div>
          <div class="stat-card-val">enderturu.my.id</div>
        </div>
        <i class="bi bi-hdd-network stat-watermark-icon"></i>
      </div>

      <div class="style-module_2Vp6MaXq">
        <div class="stat-card-info">
          <div class="stat-card-label">Uptime</div>
          <div class="stat-card-val" id="statUptime">0j 0m</div>
        </div>
        <i class="bi bi-clock-history stat-watermark-icon"></i>
      </div>

      <div class="style-module_2Vp6MaXq">
        <div class="stat-card-info">
          <div class="stat-card-label">Active Nodes</div>
          <div class="stat-card-val" id="statNodes">1 / 1 Online</div>
        </div>
        <i class="bi bi-diagram-3 stat-watermark-icon"></i>
      </div>

      <div class="style-module_2Vp6MaXq">
        <div class="stat-card-info">
          <div class="stat-card-label">Memory (RSS)</div>
          <div class="stat-card-val" id="statMemory">-- MB</div>
        </div>
        <i class="bi bi-memory stat-watermark-icon"></i>
      </div>

      <div class="style-module_2Vp6MaXq">
        <div class="stat-card-info">
          <div class="stat-card-label">Commands Executed</div>
          <div class="stat-card-val" id="statCmdsRun">0</div>
        </div>
        <i class="bi bi-terminal stat-watermark-icon"></i>
      </div>

      <div class="style-module_2Vp6MaXq">
        <div class="stat-card-info">
          <div class="stat-card-label">Loaded Modules</div>
          <div class="stat-card-val" id="statTotalModules">869 Modules</div>
        </div>
        <i class="bi bi-layers stat-watermark-icon"></i>
      </div>

      <div class="style-module_2Vp6MaXq">
        <div class="stat-card-info">
          <div class="stat-card-label">Runtime Engine</div>
          <div class="stat-card-val" id="statRuntime">Node.js v20</div>
        </div>
        <i class="bi bi-cpu stat-watermark-icon"></i>
      </div>
    </div>
  </section>

  <!-- SECTION: NEBULA FILE-MANAGER STYLE COMMAND DIRECTORY -->
  <section class="TitledGreyBox" id="sec-modules-directory">
    <div class="TitledGreyBox-header">
      <div class="TitledGreyBox-title">
        <i class="bi bi-folder2-open"></i>
        <span>Command Modules Directory (<span id="dirTotalLabel">869</span>)</span>
      </div>
      <div style="width: 260px;">
        <input type="text" class="nebula-input" style="height: 34px; font-size: 12.5px;" id="cmdSearchInput" placeholder="Search module syntax...">
      </div>
    </div>
    <div class="TitledGreyBox-body">
      <div class="nebula-cat-bar" id="cmdCategoryTabs"></div>
      <div class="nebula-files-grid" id="cmdGridContainer"></div>
      <div style="margin-top: 14px; text-align: center;" id="cmdMoreWrap">
        <button type="button" class="VersionBtn" id="cmdLoadMoreBtn">
          <i class="bi bi-plus-lg"></i> Load More Modules
        </button>
      </div>
    </div>
  </section>

  <p class="nebulaFooter">
    <a href="https://panel.enderturu.my.id" class="nebulaFooter">
      <i style="font-size:12px; margin-right: 3px;" class="bi bi-exclude"></i> Powered by Nebula.
    </a>
  </p>
</main>

<div class="nebula-toast" id="toastBox">
  <i class="bi bi-check-circle-fill" style="color: var(--pagePrimaryHover);"></i>
  <span id="toastText"></span>
</div>

<script>
(function() {
  // Mobile Navigation (Exact Nebula behavior)
  let mobileNavigationVisible = false;
  let navPossible = true;
  window.toggleMobileNav = function() {
    if (mobileNavigationVisible) closeMobileNav();
    else openMobileNav();
  };
  window.closeMobileNav = function() {
    if (!navPossible) return;
    navPossible = false;
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    sidebar.style.left = '-200px';
    overlay.style.left = null;
    overlay.style.opacity = null;
    setTimeout(() => {
      sidebar.style.display = null;
      overlay.style.display = null;
      navPossible = true;
    }, 300);
    mobileNavigationVisible = false;
  };
  window.openMobileNav = function() {
    if (!navPossible) return;
    navPossible = false;
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    sidebar.style.left = '-200px';
    overlay.style.left = '-200px';
    overlay.style.opacity = '0';
    sidebar.style.display = 'block';
    overlay.style.display = 'block';
    setTimeout(() => {
      overlay.style.opacity = '.7';
      sidebar.style.left = '0px';
      overlay.style.left = '0px';
      navPossible = true;
    }, 50);
    mobileNavigationVisible = true;
  };

  // Sidebar View Switcher with Nebula Fade-Up Animation
  window.switchNebulaView = function(view, btnEl) {
    document.querySelectorAll('.sidebar .sidebarButton').forEach(b => b.classList.remove('sidebarButtonSelected'));
    if (btnEl) btnEl.classList.add('sidebarButtonSelected');
    if (mobileNavigationVisible) window.closeMobileNav();

    const container = document.getElementById('nebulaAppContainer');
    container.classList.remove('nebula-fade');
    void container.offsetWidth;
    container.classList.add('nebula-fade');

    const secCards = document.getElementById('sec-server-cards');
    const secConsole = document.getElementById('sec-console-workspace');
    const boxProv = document.getElementById('box-provisioning');
    const boxTerm = document.getElementById('box-terminal');
    const secModules = document.getElementById('sec-modules-directory');

    if (view === 'overview') {
      secCards.style.display = '';
      secConsole.style.display = '';
      boxProv.style.display = '';
      boxTerm.style.display = '';
      secModules.style.display = '';
    } else if (view === 'terminal' || view === 'activity') {
      secCards.style.display = 'none';
      secConsole.style.display = '';
      boxProv.style.display = 'none';
      boxTerm.style.display = '';
      secModules.style.display = 'none';
    } else if (view === 'pairing') {
      secCards.style.display = '';
      secConsole.style.display = '';
      boxProv.style.display = '';
      boxTerm.style.display = 'none';
      secModules.style.display = 'none';
    } else if (view === 'modules') {
      secCards.style.display = 'none';
      secConsole.style.display = 'none';
      secModules.style.display = '';
    }
  };

  function notify(msg) {
    const box = document.getElementById('toastBox');
    document.getElementById('toastText').textContent = msg;
    box.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => box.classList.remove('show'), 3000);
  }

  // Pairing Logic
  let activePairPhone = '';
  let pairPollTimer = null;
  let pairCountdownTimer = null;
  let secondsRemaining = 180;

  function startCountdown() {
    clearInterval(pairCountdownTimer);
    secondsRemaining = 180;
    const lbl = document.getElementById('pairCountdownLabel');
    pairCountdownTimer = setInterval(() => {
      secondsRemaining = Math.max(0, secondsRemaining - 1);
      lbl.textContent = secondsRemaining + 's';
      if (secondsRemaining <= 0) clearInterval(pairCountdownTimer);
    }, 1000);
  }

  async function requestPairingCode(phoneRaw, customCodeRaw) {
    const btn = document.getElementById('pairSubmitBtn');
    const box = document.getElementById('pairResultBox');
    const codeEl = document.getElementById('pairCodeText');
    const statusEl = document.getElementById('pairStatusLabel');

    btn.disabled = true;
    box.classList.add('active');
    codeEl.textContent = '........';
    statusEl.textContent = 'Menghubungi gateway WhatsApp...';

    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneRaw, customCode: customCodeRaw })
      });
      const data = await res.json();

      if (!data.ok) {
        codeEl.textContent = 'ERROR';
        statusEl.textContent = data.error || 'Permintaan gagal';
        notify(data.error || 'Gagal membuat kode pairing');
      } else if (data.status === 'CONNECTED') {
        codeEl.textContent = 'CONNECTED';
        statusEl.textContent = 'Perangkat sudah terhubung dan aktif';
        notify('Nomor +' + data.phone + ' sudah aktif.');
        fetchStatus();
      } else {
        activePairPhone = data.phone;
        const rawCode = String(data.code || '');
        codeEl.textContent = rawCode.length === 8 ? (rawCode.slice(0, 4) + '-' + rawCode.slice(4)) : rawCode;
        statusEl.textContent = 'Target: +' + data.phone + ' (Waiting for Link)';
        startCountdown();
        notify('Kode pairing berhasil diterbitkan.');
        fetchStatus();

        clearInterval(pairPollTimer);
        pairPollTimer = setInterval(async () => {
          if (!activePairPhone) return;
          try {
            const sr = await fetch('/api/session/' + encodeURIComponent(activePairPhone));
            const sd = await sr.json();
            if (sd.ok && sd.session && sd.session.status === 'CONNECTED') {
              clearInterval(pairPollTimer);
              clearInterval(pairCountdownTimer);
              codeEl.textContent = 'CONNECTED';
              statusEl.textContent = 'Otorisasi perangkat berhasil';
              notify('Node +' + activePairPhone + ' terhubung.');
              fetchStatus();
            }
          } catch {}
        }, 2500);
      }
    } catch {
      codeEl.textContent = 'FAILED';
      statusEl.textContent = 'Kesalahan jaringan';
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById('pairForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const phone = document.getElementById('pairPhone').value.trim();
    const customCode = document.getElementById('pairCustomCode').value.trim();
    if (!phone) return;
    requestPairingCode(phone, customCode);
  });

  document.getElementById('copyCodeBtn').addEventListener('click', () => {
    const raw = document.getElementById('pairCodeText').textContent.replace(/[^A-Z0-9]/gi, '');
    if (raw && raw !== 'CONNECTED' && raw !== 'ERROR' && raw !== 'FAILED') {
      navigator.clipboard.writeText(raw);
      notify('Kode pairing disalin ke clipboard.');
    }
  });

  document.getElementById('refreshPairBtn').addEventListener('click', () => {
    const phone = document.getElementById('pairPhone').value.trim() || activePairPhone;
    const customCode = document.getElementById('pairCustomCode').value.trim();
    if (phone) requestPairingCode(phone, customCode);
  });

  // Render Nebula Server Cards (serversCards.css replica)
  let currentSessions = [];
  let currentFeed = [];

  function renderServerCards() {
    const container = document.getElementById('serverCardsContainer');
    const filterVal = document.getElementById('filterSessionPhone').value.trim().replace(/[^0-9]/g, '');
    const list = currentSessions.filter(s => !filterVal || s.phone.includes(filterVal));

    if (list.length === 0) {
      container.innerHTML = '<div class="TitledGreyBox" style="grid-column: 1 / -1; padding: 20px; text-align: center; opacity: 0.7;">Tidak ada node sesi yang cocok dengan filter.</div>';
      return;
    }

    container.innerHTML = list.map(s => {
      const stateClass = s.status === 'CONNECTED' ? 'is-online' : (s.status === 'PAIRING' || s.status === 'CONNECTING' ? 'is-starting' : 'is-offline');
      const displayPhone = (filterVal && s.phone.includes(filterVal)) ? ('+' + s.phone) : s.maskedPhone;
      const roleLabel = s.isMain ? 'Primary Gateway Node' : 'Client Session Node';
      const avatarSrc = s.isMain ? '/assets/thumb.jpg' : '/assets/profile.jpg';

      return '<div class="ServerRow__StatusIndicatorBox ' + stateClass + '">' +
        '<div class="status-bar"></div>' +
        '<div class="server-card-top">' +
          '<div class="server-card-id">' +
            '<div class="server-card-icon"><img src="' + avatarSrc + '" alt="Node"></div>' +
            '<div>' +
              '<div class="server-card-title">' + displayPhone + '</div>' +
              '<span class="server-card-sub">' + roleLabel + ' &middot; ' + s.status + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="server-card-actions">' +
            '<button type="button" class="card-act-btn" title="Switch Mode" onclick="window._nodeAction(\\'' + s.phone + '\\', \\'mode\\')">' +
              '<i class="bi bi-sliders"></i><span>' + (s.publicMode ? 'Self' : 'Public') + '</span>' +
            '</button>' +
            '<button type="button" class="card-act-btn" title="Restart Node" onclick="window._nodeAction(\\'' + s.phone + '\\', \\'restart\\')">' +
              '<i class="bi bi-arrow-repeat"></i>' +
            '</button>' +
            '<button type="button" class="card-act-btn danger" title="Terminate Session" onclick="window._nodeAction(\\'' + s.phone + '\\', \\'logout\\')">' +
              '<i class="bi bi-power"></i>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="server-card-bottom">' +
          '<div class="server-card-pill"><i class="bi bi-shield-check"></i><span>' + (s.publicMode ? 'PUBLIC' : 'SELF') + '</span></div>' +
          '<div class="server-card-pill"><i class="bi bi-terminal"></i><span>' + (s.cmdCount || 0) + ' Cmds</span></div>' +
          '<div class="server-card-pill"><i class="bi bi-clock-history"></i><span>' + (s.uptime || '0m') + '</span></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderXtermLogs() {
    const screen = document.getElementById('xtermLogScreen');
    const q = document.getElementById('logFilterInput').value.trim().toLowerCase();
    const lines = [];

    lines.push(
      '<div class="xterm-line">' +
        '<span><span class="xterm-time">[SYSTEM]</span><span class="xterm-tag">[NEBULA-DAEMON]</span>Gateway container running on Node.js ' + (window._lastNodeVer || 'v20') + ' (Baileys Multi-Device)</span>' +
        '<span style="color: var(--statusOnline);">ONLINE</span>' +
      '</div>'
    );

    currentSessions.forEach(s => {
      lines.push(
        '<div class="xterm-line">' +
          '<span><span class="xterm-time">[NODE]</span><span class="xterm-tag">[' + s.maskedPhone + ']</span>Session state: ' + s.status + ' | Policy: ' + (s.publicMode ? 'PUBLIC' : 'SELF') + ' | Uptime: ' + (s.uptime || '0m') + '</span>' +
          '<span style="color: ' + (s.status === 'CONNECTED' ? 'var(--statusOnline)' : 'var(--statusStarting)') + ';">' + s.status + '</span>' +
        '</div>'
      );
    });

    currentFeed.forEach(item => {
      if (q && !item.cmd.toLowerCase().includes(q) && !item.maskedSender.toLowerCase().includes(q)) return;
      lines.push(
        '<div class="xterm-line">' +
          '<span><span class="xterm-time">[' + item.time + ']</span><span class="xterm-tag">[EXEC]</span>' + item.maskedSender + ' (' + item.chatType + ')</span>' +
          '<span style="color: var(--pagePrimaryHover); font-weight: 700;">.' + item.cmd + '</span>' +
        '</div>'
      );
    });

    screen.innerHTML = lines.join('');
  }

  window._nodeAction = async function(phone, action) {
    if (action === 'logout' && !confirm('Konfirmasi terminasi dan penghapusan sesi untuk nomor +' + phone + '?')) return;
    try {
      const res = await fetch('/api/session/' + encodeURIComponent(phone) + '/' + action, { method: 'POST' });
      const data = await res.json();
      notify(data.message || 'Operasi berhasil dijalankan.');
      fetchStatus();
    } catch {
      notify('Gagal menghubungi server.');
    }
  };

  document.getElementById('filterSessionPhone').addEventListener('input', renderServerCards);
  document.getElementById('logFilterInput').addEventListener('input', renderXtermLogs);
  document.getElementById('topSyncBtn').addEventListener('click', () => {
    fetchStatus();
    notify('Status node berhasil disinkronkan.');
  });

  document.getElementById('quickSearchCmdInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (!val) return;
      document.getElementById('cmdSearchInput').value = val;
      displayLimit = 72;
      renderCommandDirectory();
      document.getElementById('sec-modules-directory').scrollIntoView({ behavior: 'smooth' });
    }
  });

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (!data.ok) return;

      currentSessions = data.sessions || [];
      currentFeed = data.liveFeed || [];
      window._lastNodeVer = data.nodeVersion || 'v20';

      renderServerCards();
      renderXtermLogs();

      const connCount = data.connectedCount || 0;
      const totalCount = data.totalSessions || currentSessions.length || 1;
      document.getElementById('statUptime').textContent = data.serverUptime || '0j 0m';
      document.getElementById('statNodes').textContent = connCount + ' / ' + totalCount + ' Online';
      document.getElementById('statMemory').textContent = (data.memoryMb || '--') + ' MB';
      document.getElementById('statCmdsRun').textContent = data.totalCommandsRun || 0;
      document.getElementById('statRuntime').textContent = 'Node ' + (data.nodeVersion || 'v20');

      document.documentElement.style.setProperty(
        '--statusorb-background',
        connCount > 0 ? 'var(--statusOnline)' : 'var(--statusStarting)'
      );
    } catch {}
  }

  fetchStatus();
  setInterval(fetchStatus, 5000);

  // Command Directory
  let categories = [];
  let activeCategory = 'all';
  let displayLimit = 72;

  function renderCommandDirectory() {
    const query = document.getElementById('cmdSearchInput').value.trim().toLowerCase().replace(/^\\./, '');
    const matched = [];

    categories.forEach(cat => {
      if (activeCategory !== 'all' && cat.id !== activeCategory) return;
      cat.cmds.forEach(cmd => {
        if (!query || cmd.toLowerCase().includes(query) || cat.label.toLowerCase().includes(query)) {
          matched.push({ cmd, cat: cat.label });
        }
      });
    });

    const visible = matched.slice(0, displayLimit);
    const grid = document.getElementById('cmdGridContainer');
    grid.innerHTML = visible.map(item =>
      '<div class="style-module_1WqkLT9X" onclick="navigator.clipboard.writeText(\\'.' + item.cmd + '\\'); window._copyCmd(\\'.' + item.cmd + '\\')">' +
        '<span><i class="bi bi-file-earmark-code" style="margin-right: 7px; opacity: 0.65;"></i>.' + item.cmd + '</span>' +
        '<i class="bi bi-copy" style="font-size: 12px; opacity: 0.6;"></i>' +
      '</div>'
    ).join('');

    document.getElementById('cmdMoreWrap').style.display = matched.length > displayLimit ? 'block' : 'none';
  }

  window._copyCmd = function(c) {
    notify('Command ' + c + ' disalin ke clipboard.');
  };

  async function fetchCommands() {
    try {
      const res = await fetch('/api/commands');
      const data = await res.json();
      categories = data.categories || [];
      const total = data.total || 869;

      document.getElementById('statTotalModules').textContent = total + ' Modules';
      document.getElementById('dirTotalLabel').textContent = total;

      const tabsEl = document.getElementById('cmdCategoryTabs');
      tabsEl.innerHTML = '<button type="button" class="VersionBtn selected" data-cat="all"><i class="bi bi-grid"></i><span>All (' + total + ')</span></button>' +
        categories.map(c =>
          '<button type="button" class="VersionBtn" data-cat="' + c.id + '"><i class="bi ' + (c.icon || 'bi-terminal') + '"></i><span>' + c.label + ' (' + c.cmds.length + ')</span></button>'
        ).join('');

      tabsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-cat]');
        if (!btn) return;
        tabsEl.querySelectorAll('.VersionBtn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        activeCategory = btn.getAttribute('data-cat');
        displayLimit = 72;
        renderCommandDirectory();
      });

      renderCommandDirectory();
    } catch {}
  }

  fetchCommands();

  document.getElementById('cmdSearchInput').addEventListener('input', () => {
    displayLimit = 72;
    renderCommandDirectory();
  });

  document.getElementById('cmdLoadMoreBtn').addEventListener('click', () => {
    displayLimit += 96;
    renderCommandDirectory();
  });
})();
</script>
</body>
</html>`;
}

function startWebServer() {
    if (global._JOYBOT_WEB_SERVER) return global._JOYBOT_WEB_SERVER;
    const port = Number(process.env.SERVER_PORT || process.env.PORT || 25565);

    const server = http.createServer(async (req, res) => {
        try {
            const parsed = url.parse(req.url, true);
            const pathname = parsed.pathname || '/';

            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                });
                return res.end();
            }

            if (pathname.startsWith('/assets/') && req.method === 'GET') {
                return serveStaticAsset(pathname, res);
            }

            if (pathname === '/api/status' && req.method === 'GET') {
                const sessions = typeof global.getWebBotSessions === 'function' ? global.getWebBotSessions() : [];
                const connectedCount = sessions.filter(s => s.status === 'CONNECTED').length;
                const diffSec = Math.floor((Date.now() - (global._WEB_START_TIME || Date.now())) / 1000);
                const hrs = Math.floor(diffSec / 3600);
                const mins = Math.floor((diffSec % 3600) / 60);
                const memoryMb = (process.memoryUsage().rss / 1048576).toFixed(1);
                return sendJson(res, 200, {
                    ok: true,
                    connectedCount,
                    totalSessions: sessions.length,
                    totalCommandsRun: global._WEB_TOTAL_CMDS || 0,
                    serverUptime: `${hrs}j ${mins}m`,
                    memoryMb,
                    nodeVersion: process.version,
                    platform: `${os.type()} ${os.arch()}`,
                    sessions,
                    liveFeed: (global._WEB_LIVE_FEED || []).slice(0, 30)
                });
            }

            if (pathname === '/api/commands' && req.method === 'GET') {
                return sendJson(res, 200, { ok: true, ...loadCommandsCatalog() });
            }

            if (pathname === '/api/pair' && req.method === 'POST') {
                const body = await readJsonBody(req);
                const cleanPhone = normalizePhone(body.phone);
                if (!cleanPhone || cleanPhone.length < 9 || cleanPhone.length > 15) {
                    return sendJson(res, 400, { ok: false, error: 'Masukkan nomor WhatsApp yang valid (contoh: 6281973866718)' });
                }
                const customCode = String(body.customCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
                if (typeof global.startWebBotSession !== 'function') {
                    return sendJson(res, 500, { ok: false, error: 'Mesin multi-sesi belum siap' });
                }
                const result = await global.startWebBotSession(cleanPhone, customCode);
                return sendJson(res, 200, result);
            }

            const sessMatch = pathname.match(/^\/api\/session\/([0-9]+)(?:\/(mode|restart|logout))?$/);
            if (sessMatch) {
                const phone = normalizePhone(sessMatch[1]);
                const action = sessMatch[2];
                if (!action && req.method === 'GET') {
                    const sessions = typeof global.getWebBotSessions === 'function' ? global.getWebBotSessions() : [];
                    const found = sessions.find(s => s.phone === phone);
                    return sendJson(res, 200, { ok: true, session: found || null });
                }
                if (action === 'mode' && req.method === 'POST') {
                    const msg = typeof global.toggleWebBotMode === 'function' ? await global.toggleWebBotMode(phone) : 'Mode diubah';
                    return sendJson(res, 200, { ok: true, message: msg });
                }
                if (action === 'restart' && req.method === 'POST') {
                    if (typeof global.startWebBotSession === 'function') {
                        await global.startWebBotSession(phone, '', true);
                    }
                    return sendJson(res, 200, { ok: true, message: `Sesi ${phone} sedang di-restart...` });
                }
                if (action === 'logout' && req.method === 'POST') {
                    if (typeof global.stopWebBotSession === 'function') {
                        await global.stopWebBotSession(phone, true);
                    }
                    return sendJson(res, 200, { ok: true, message: `Sesi ${phone} berhasil diputus dan dihapus.` });
                }
            }

            const html = getAppHtml();
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache'
            });
            res.end(html);
        } catch (err) {
            sendJson(res, 500, { ok: false, error: err?.message || 'Internal Server Error' });
        }
    });

    server.on('error', (err) => {
        console.error('[WebServer] Error:', err.message);
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`\x1b[32m[WebServer] Nebula Panel Console aktif di port ${port}\x1b[0m`);
    });

    global._JOYBOT_WEB_SERVER = server;
    return server;
}

module.exports = { startWebServer, maskPhone, normalizePhone };

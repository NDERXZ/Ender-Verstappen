'use strict';

const { randomUUID } = require('crypto');
const fetch = globalThis.fetch || require('node-fetch');

let axios;
try {
    axios = require('axios');
} catch (_) {
    axios = {
        get: async (url, opts = {}) => {
            const res = await fetch(url, opts);
            if (opts.responseType === 'arraybuffer') {
                return { data: Buffer.from(await res.arrayBuffer()) };
            }
            return { data: await res.json() };
        }
    };
}

let yts;
try {
    yts = require('yt-search');
} catch (_) {
    yts = async () => null;
}

let downloadSaveNow = async () => ({ status: false });
let downloadCobalt = async () => ({ status: false });
let ytdlAuto = async () => ({ status: false });

try {
    const ytdlModule = require('./scrape/youtube_dl');
    downloadSaveNow = ytdlModule.downloadSaveNow || downloadSaveNow;
    downloadCobalt = ytdlModule.downloadCobalt || downloadCobalt;
} catch (_) {}

try {
    const ytModule = require('./scrape/youtube');
    ytdlAuto = ytModule.ytdlAuto || ytdlAuto;
} catch (_) {}

function escapeHtmlJs(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\`/g, '\\`') 
        .replace(/\$\{/g, '\\${')
        .replace(/</g, '\\x3C');
}

/* =========================================================================
 * SPOTIFY SCRAPER ENGINE (Berdasarkan arsitektur spotifyscraper tanpa API key)
 * ========================================================================= */

let cachedAnonymousToken = null;
let tokenExpiresAt = 0;

/**
 * Mendapatkan anonymous access token dari Spotify Embed page (__NEXT_DATA__)
 * Token ini di-cache di memory hingga mendekati masa kadaluarsa (biasanya 1 jam).
 */
async function getAnonymousToken() {
    if (cachedAnonymousToken && Date.now() < tokenExpiresAt - 60000) {
        return cachedAnonymousToken;
    }

    try {
        const res = await fetch('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });
        const html = await res.text();
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!match) return null;

        const data = JSON.parse(match[1]);
        const session = data.props?.pageProps?.state?.settings?.session;
        if (session?.accessToken) {
            cachedAnonymousToken = session.accessToken;
            tokenExpiresAt = session.accessTokenExpirationTimestampMs || (Date.now() + 3600000);
            return cachedAnonymousToken;
        }
    } catch (_) {}

    return null;
}

/**
 * Mengekstrak metadata track langsung dari embed Spotify (metode parse_embed spotifyscraper)
 * Mendapatkan title, artist, cover art HD, duration, dan 30s official MP3 previewUrl.
 */
async function scrapeSpotifyEmbed(idOrUrl) {
    let id = String(idOrUrl || '').trim();
    const match = id.match(/(?:track\/|track:)([a-zA-Z0-9]+)/i);
    if (match) id = match[1];

    try {
        const res = await fetch(`https://open.spotify.com/embed/track/${id}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });
        const html = await res.text();
        const matchScript = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!matchScript) return null;

        const data = JSON.parse(matchScript[1]);
        const entity = data.props?.pageProps?.state?.data?.entity;
        if (!entity) return null;

        const session = data.props?.pageProps?.state?.settings?.session;
        if (session?.accessToken) {
            cachedAnonymousToken = session.accessToken;
            tokenExpiresAt = session.accessTokenExpirationTimestampMs || (Date.now() + 3600000);
        }

        const title = entity.name || entity.title || 'Spotify Track';
        const artist = entity.artists?.map(a => a.name).join(', ') || 'Spotify Artist';
        const cover = entity.visualIdentity?.image?.[0]?.url || entity.coverArt?.sources?.[0]?.url || '';
        const duration = entity.duration ? Math.floor(entity.duration / 1000) : 0;
        const previewUrl = entity.audioPreview?.url || '';

        return {
            id: entity.id || id,
            title,
            artist,
            album: entity.album?.name || 'Single',
            cover,
            duration,
            previewUrl
        };
    } catch (_) {
        return null;
    }
}

/**
 * Mencari track di Spotify via Pathfinder GraphQL (metode searchDesktop spotifyscraper)
 * Menggunakan persisted query hash resmi Web Player tanpa perlu Spotify Developer App ID.
 */
async function searchSpotifyPathfinder(query) {
    const token = await getAnonymousToken();
    if (!token) return null;

    try {
        const variables = {
            searchTerm: query,
            offset: 0,
            limit: 5,
            numberOfTopResults: 3,
            includeAudiobooks: false,
            includePreReleases: false,
            includeAlbumPreReleases: false,
            includeAuthors: false,
            includeEpisodeContentRatingsV2: false
        };
        const extensions = {
            persistedQuery: {
                version: 1,
                sha256Hash: 'eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0'
            }
        };

        const params = new URLSearchParams({
            operationName: 'searchDesktop',
            variables: JSON.stringify(variables),
            extensions: JSON.stringify(extensions)
        });

        const sRes = await fetch(`https://api-partner.spotify.com/pathfinder/v1/query?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'app-platform': 'WebPlayer',
                'spotify-app-version': '1.2.52.442.g01893f04'
            }
        });

        if (!sRes.ok) return null;
        const result = await sRes.json();
        const tracks = result.data?.searchV2?.tracksV2?.items;
        if (!tracks || tracks.length === 0) return null;

        const item = tracks[0].item?.data;
        if (!item) return null;

        return {
            id: item.id,
            title: item.name,
            artist: item.artists?.items?.map(a => a.profile?.name).join(', ') || 'Spotify Artist',
            album: item.albumOfTrack?.name || 'Spotify',
            cover: item.albumOfTrack?.coverArt?.sources?.[0]?.url || '',
            duration: item.duration?.totalMilliseconds ? Math.floor(item.duration.totalMilliseconds / 1000) : 0,
            previewUrl: ''
        };
    } catch (_) {
        return null;
    }
}


/**
 * Merakit antarmuka HTML Spotify Player (Lightweight <25KB, WebSocket Streaming seperti ytp & soundcloud)
 */
function buildSpotifyPlayerHtml({ title, artist, duration, streamUrl, wsUrl, posterBase64 }) {
    const safeTitle = escapeHtmlJs(title);
    const safeArtist = escapeHtmlJs(artist);
    const safeDuration = escapeHtmlJs(duration);
    const safeStreamUrl = escapeHtmlJs(streamUrl);
    const safeWsUrl = escapeHtmlJs(wsUrl);

    return `<style>
*{
-webkit-tap-highlight-color:transparent;
-webkit-user-select:none;
user-select:none;
-webkit-touch-callout:none;
box-sizing:border-box
}
body{
margin:0;
background:#0a0a0a;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
color:#fff;
touch-action:manipulation;
cursor:pointer
}
input[type=range]{
width:100%;
height:4px;
accent-color:#1db954;
cursor:pointer
}
.player-wrap{
width:100%;
max-width:420px;
margin:auto;
padding:12px
}
.player{
position:relative;
overflow:hidden;
background:#121212;
border:1px solid rgba(29,185,84,.2);
border-radius:20px;
box-shadow:0 14px 45px rgba(0,0,0,.8)
}
.bg{
position:absolute;
inset:-25px;
background-position:center;
background-size:cover;
filter:blur(28px);
opacity:.35;
transform:scale(1.15);
pointer-events:none
}
.bg-overlay{
position:absolute;
inset:0;
background:linear-gradient(180deg, rgba(18,18,18,.4) 0%, rgba(18,18,18,.88) 60%, #121212 100%);
pointer-events:none
}
.content{
position:relative;
padding:18px;
z-index:2
}
.top{
display:flex;
align-items:center;
justify-content:space-between;
margin-bottom:15px
}
.top-brand{
display:flex;
align-items:center;
gap:8px
}
.top-brand svg{
width:24px;
height:24px;
fill:#1db954
}
.top-brand span{
font-size:13px;
font-weight:800;
letter-spacing:.8px;
color:#fff;
text-transform:uppercase
}
.top-tag{
font-size:10px;
font-weight:700;
color:#1db954;
background:rgba(29,185,84,.14);
padding:3px 8px;
border-radius:12px;
letter-spacing:.5px
}
.cover-frame{
position:relative;
width:100%;
aspect-ratio:1/1;
max-width:270px;
margin:0 auto 16px;
border-radius:16px;
overflow:hidden;
background:#181818;
box-shadow:0 14px 35px rgba(0,0,0,.65);
cursor:pointer
}
.cover-frame img{
width:100%;
height:100%;
object-fit:cover;
display:block
}
.cover-play-overlay{
position:absolute;
inset:0;
display:flex;
align-items:center;
justify-content:center;
background:rgba(0,0,0,.22);
transition:opacity .2s;
z-index:3
}
.cover-play-btn{
width:62px;
height:62px;
border:0;
border-radius:50%;
background:#1db954;
color:#000;
display:flex;
align-items:center;
justify-content:center;
padding:0;
box-shadow:0 8px 24px rgba(29,185,84,.45);
cursor:pointer
}
.cover-play-btn svg{
width:26px;
height:26px;
fill:currentColor;
margin-left:3px
}
.frame-playing .cover-play-overlay{
opacity:0;
pointer-events:none
}
.info{
text-align:center;
margin-bottom:12px
}
.song-title{
font-size:18px;
font-weight:700;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
color:#fff
}
.artist{
font-size:13px;
color:#999;
margin-top:4px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis
}
.progress{
margin-top:14px
}
.times{
display:flex;
justify-content:space-between;
font-size:11px;
color:#888;
margin-top:6px;
font-variant-numeric:tabular-nums
}
.controls{
display:flex;
align-items:center;
justify-content:center;
gap:20px;
margin-top:12px
}
.side-btn{
width:40px;
height:40px;
border:0;
background:transparent;
color:#999;
display:flex;
align-items:center;
justify-content:center;
padding:0;
cursor:pointer
}
.side-btn:active{
color:#fff;
transform:scale(.92)
}
.side-btn svg{
width:22px;
height:22px;
fill:none;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round
}
.main-play-btn{
width:54px;
height:54px;
border:0;
border-radius:50%;
background:#1db954;
color:#000;
display:flex;
align-items:center;
justify-content:center;
padding:0;
box-shadow:0 6px 20px rgba(29,185,84,.35);
cursor:pointer
}
.main-play-btn svg{
width:22px;
height:22px;
fill:currentColor
}
.bottom{
display:flex;
align-items:center;
justify-content:space-between;
margin-top:14px;
padding-top:12px;
border-top:1px solid rgba(255,255,255,.06)
}
.icon-btn{
width:32px;
height:32px;
border:0;
background:transparent;
color:#888;
display:flex;
align-items:center;
justify-content:center;
padding:0;
cursor:pointer
}
.icon-btn.is-active{
color:#1db954
}
.icon-btn svg{
width:18px;
height:18px;
fill:none;
stroke:currentColor;
stroke-width:2
}
.volume-wrap{
display:flex;
align-items:center;
gap:8px
}
.volume{
width:85px
}
.debug-wrap{
margin-top:12px;
background:#101010;
border:1px solid rgba(29,185,84,.18);
border-radius:14px;
padding:10px;
font-family:monospace
}
.debug-head{
display:flex;
align-items:center;
justify-content:space-between;
margin-bottom:6px
}
.debug-title{
font-size:10px;
font-weight:700;
color:#1db954;
letter-spacing:.8px
}
.debug-state{
font-size:9px;
font-weight:700;
padding:2px 6px;
border-radius:12px;
background:rgba(29,185,84,.15);
color:#1db954
}
.debug-log{
height:70px;
overflow-y:auto;
background:rgba(0,0,0,.4);
border-radius:6px;
padding:5px 8px;
font-size:9px;
line-height:1.5;
color:#777
}
</style>

<body>
<div class="player-wrap">
  <div class="player">
    <div class="bg" id="background"></div>
    <div class="bg-overlay"></div>

    <div class="content">
      <!-- HEADER -->
      <div class="top">
        <div class="top-brand">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.35-1.435-5.308-1.76-8.793-.963-.335.077-.67-.133-.746-.468-.077-.334.132-.67.467-.746 3.808-.87 7.076-.496 9.722 1.115.294.18.386.562.207.855zm1.226-2.727c-.226.367-.707.482-1.074.256-2.69-1.653-6.79-2.132-9.972-1.167-.413.125-.85-.107-.975-.52-.125-.414.108-.85.52-.976 3.632-1.102 8.147-.568 11.245 1.333.367.226.482.707.256 1.074zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71c-.494.15-1.016-.128-1.166-.623-.15-.495.128-1.016.623-1.166 3.532-1.072 9.404-.866 13.115 1.337.445.264.59.838.327 1.282-.264.443-.838.59-1.28.323z"/></svg>
          <span>Spotify</span>
        </div>
        <div class="top-tag">PLAYER</div>
      </div>

      <!-- ALBUM COVER WITH PLAY BUTTON -->
      <div class="cover-frame" id="coverFrame" onclick="togglePlay()">
        <img id="coverImg" src="${posterBase64 || 'https://open.spotifycdn.com/cdn/images/favicon.0f31d2ea.ico'}" alt="cover">
        <div class="cover-play-overlay" id="coverOverlay">
          <button class="cover-play-btn" type="button" onclick="event.stopPropagation();togglePlay()">
            <svg id="bigPlayIcon" viewBox="0 0 24 24"><polygon points="7 4 19 12 7 20 7 4"></polygon></svg>
          </button>
        </div>
      </div>

      <!-- HIDDEN AUDIO ELEMENT -->
      <audio id="mediaPlayer" preload="none"></audio>

      <!-- TRACK INFO -->
      <div class="info">
        <div class="song-title" id="songTitle">${safeTitle}</div>
        <div class="artist" id="artist">${safeArtist}</div>
      </div>

      <!-- PROGRESS / SEEKBAR -->
      <div class="progress">
        <input id="progress" type="range" min="0" max="100" value="0" step="0.1" oninput="seekAudio(this.value)">
        <div class="times">
          <span id="currentTime">0:00</span>
          <span id="duration">${safeDuration || '0:00'}</span>
        </div>
      </div>

      <!-- CONTROLS -->
      <div class="controls">
        <button class="side-btn" type="button" onclick="rewind10()" title="Mundur 10 detik">
          <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>

        <button class="main-play-btn" id="mainPlayBtn" type="button" onclick="togglePlay()">
          <svg id="playIcon" viewBox="0 0 24 24"><polygon points="7 4 19 12 7 20 7 4"></polygon></svg>
          <svg id="pauseIcon" viewBox="0 0 24 24" style="display:none"><rect x="6.5" y="4" width="3.5" height="16" rx="1"></rect><rect x="14" y="4" width="3.5" height="16" rx="1"></rect></svg>
        </button>

        <button class="side-btn" type="button" onclick="forward10()" title="Maju 10 detik">
          <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>
      </div>

      <!-- BOTTOM ROW -->
      <div class="bottom">
        <button class="icon-btn" id="heartBtn" type="button" onclick="toggleHeart()">
          <svg viewBox="0 0 24 24"><path d="M20.8 5.6 a5.1 5.1 0 0 0-7.2 0 L12 7.2 l-1.6-1.6 a5.1 5.1 0 0 0-7.2 7.2 l1.6 1.6 L12 21.6 l7.2-7.2 1.6-1.6 a5.1 5.1 0 0 0 0-7.2z"/></svg>
        </button>

        <div class="volume-wrap">
          <button class="icon-btn" type="button" onclick="toggleMute()">
            <svg id="volIcon" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="M19 9a5 5 0 0 1 0 6"></path></svg>
          </button>
          <input class="volume" id="volume" type="range" min="0" max="1" step="0.01" value="1" oninput="changeVolume(this.value)">
        </div>
      </div>
    </div>
  </div>

  <!-- STREAM STATUS -->
  <div class="debug-wrap">
    <div class="debug-head">
      <div class="debug-title">SPOTIFY STREAM</div>
      <div class="debug-state" id="wsState">CONNECTING</div>
    </div>
    <div class="debug-log" id="debugLog"></div>
  </div>
</div>

<script>
var audio = document.getElementById("mediaPlayer");
var coverFrame = document.getElementById("coverFrame");
var progress = document.getElementById("progress");
var currentTime = document.getElementById("currentTime");
var durationEl = document.getElementById("duration");
var playIcon = document.getElementById("playIcon");
var pauseIcon = document.getElementById("pauseIcon");
var mainPlayBtn = document.getElementById("mainPlayBtn");
var heartBtn = document.getElementById("heartBtn");
var volBar = document.getElementById("volume");
var bg = document.getElementById("background");

var posterSrc = "${posterBase64}";
if (posterSrc) {
  bg.style.backgroundImage = "url('" + posterSrc + "')";
}

function fmt(sec) {
  if (!isFinite(sec) || isNaN(sec)) return "0:00";
  var m = Math.floor(sec / 60);
  var s = Math.floor(sec % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function setUI(playing) {
  if (playing) {
    playIcon.style.display = "none";
    pauseIcon.style.display = "block";
    coverFrame.classList.add("frame-playing");
  } else {
    playIcon.style.display = "block";
    pauseIcon.style.display = "none";
    coverFrame.classList.remove("frame-playing");
  }
}

function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) {
    var p = audio.play();
    if (p && p.catch) p.catch(function() {});
  } else {
    audio.pause();
  }
}

function rewind10() {
  if (!audio.duration) return;
  audio.currentTime = Math.max(0, audio.currentTime - 10);
}

function forward10() {
  if (!audio.duration) return;
  audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
}

function seekAudio(val) {
  if (!audio.duration) return;
  audio.currentTime = (Number(val) / 100) * audio.duration;
}

function changeVolume(val) {
  audio.volume = Number(val);
  audio.muted = (audio.volume === 0);
}

function toggleMute() {
  audio.muted = !audio.muted;
}

function toggleHeart() {
  heartBtn.classList.toggle("is-active");
  heartBtn.style.color = heartBtn.classList.contains("is-active") ? "#1db954" : "#888";
}

audio.addEventListener("timeupdate", function() {
  if (!isFinite(audio.duration) || !audio.duration) return;
  var pct = (audio.currentTime / audio.duration) * 100;
  progress.value = pct;
  currentTime.textContent = fmt(audio.currentTime);
  durationEl.textContent = fmt(audio.duration);
});

audio.addEventListener("play", function() { setUI(true); });
audio.addEventListener("pause", function() { setUI(false); });
audio.addEventListener("ended", function() { setUI(false); progress.value = 0; currentTime.textContent = "0:00"; });

/* =========================================================
 * WEBSOCKET AUDIO STREAMER (Identik dengan soundcloud & ytp)
 * ========================================================= */
var wsUrl = "${safeWsUrl}";
var streamUrl = "${safeStreamUrl}";
var wsAudio = null;
var wsChunks = [];
var wsDone = false;

function setWs(state) {
  var el = document.getElementById("wsState");
  if (el) el.textContent = state;
}

function log(msg) {
  var el = document.getElementById("debugLog");
  if (!el) return;
  var div = document.createElement("div");
  div.textContent = msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

if (!wsUrl && streamUrl) {
  wsUrl = "wss://stream.kanara.my.id/?url=" + encodeURIComponent(streamUrl);
}

if (wsUrl && typeof WebSocket !== "undefined") {
  log("Connecting to Spotify stream...");
  setWs("CONNECTING");

  try {
    wsAudio = new WebSocket(wsUrl);
    wsAudio.binaryType = "arraybuffer";

    wsAudio.onopen = function() {
      log("WebSocket connected");
      setWs("CONNECTED");
    };

    wsAudio.onmessage = function(ev) {
      if (typeof ev.data === "string") {
        try {
          var m = JSON.parse(ev.data);
          if (m.type === "start") {
            log("Stream started: " + (m.mime || "audio/mp3"));
            setWs("STREAMING");
          }
        } catch(e) {}
        return;
      }
      wsChunks.push(ev.data);
    };

    wsAudio.onclose = function() {
      if (wsDone) return;
      wsDone = true;
      log("Stream download finished");
      setWs("READY");

      if (wsChunks.length > 0) {
        var blob = new Blob(wsChunks, { type: "audio/mp3" });
        audio.src = URL.createObjectURL(blob);
        audio.load();
        log("Player ready! Klik Play");
        setTimeout(function() {
          var p = audio.play();
          if (p && p.catch) p.catch(function() {});
        }, 300);
      }
    };

    wsAudio.onerror = function() {
      log("WS stream fallback to direct audio link");
      if (streamUrl) {
        audio.src = streamUrl;
        audio.load();
      }
    };
  } catch(e) {
    if (streamUrl) {
      audio.src = streamUrl;
      audio.load();
    }
  }
} else if (streamUrl) {
  audio.src = streamUrl;
  audio.load();
}
</script>
</body>`;
}

/**
 * Mencari track Spotify dan mendapatkan info YouTube stream yang kompatibel
 */
async function searchSpotifyTrack(query) {
    const text = String(query || '').trim();
    const isUrl = /(?:https?:\/\/)?(?:open\.)?spotify\.com\/track\/([a-zA-Z0-9]+)/i.test(text) || /^spotify:track:([a-zA-Z0-9]+)/i.test(text);

    let title = text;
    let artist = 'Spotify Artist';
    let album = 'Spotify Track';
    let thumb = '';
    let duration = 0;
    let previewUrl = '';

    // 1. Scraping langsung menggunakan teknik spotifyscraper
    if (isUrl) {
        const embedTrack = await scrapeSpotifyEmbed(text);
        if (embedTrack) {
            title = embedTrack.title;
            artist = embedTrack.artist;
            album = embedTrack.album;
            thumb = embedTrack.cover;
            duration = embedTrack.duration;
            previewUrl = embedTrack.previewUrl;
        }
    } else {
        // Coba Pathfinder GraphQL search terlebih dahulu (paling akurat untuk Spotify)
        const pathfinderTrack = await searchSpotifyPathfinder(text);
        if (pathfinderTrack) {
            title = pathfinderTrack.title;
            artist = pathfinderTrack.artist;
            album = pathfinderTrack.album;
            thumb = pathfinderTrack.cover;
            duration = pathfinderTrack.duration;
            previewUrl = pathfinderTrack.previewUrl;
        } else {
            // Fallback ke iTunes API jika Pathfinder diblokir
            try {
                const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(text)}&entity=song&limit=1`;
                const res = await axios.get(itunesUrl, { timeout: 8000 });
                const item = res.data?.results?.[0];
                if (item) {
                    title = item.trackName || text;
                    artist = item.artistName || 'Spotify Artist';
                    album = item.collectionName || 'Single';
                    thumb = (item.artworkUrl100 || '').replace('100x100bb', '600x600bb');
                    duration = item.trackTimeMillis ? Math.floor(item.trackTimeMillis / 1000) : 180;
                    previewUrl = item.previewUrl || '';
                }
            } catch (_) {}
        }
    }

    // 2. Cari stream audio yang lancar via engine YouTube (SaveNow / ytdlAuto / Cobalt)
    let streamInfo = null;
    try {
        const searchQuery = `${title} ${artist}`;
        const searchRes = await yts(searchQuery);
        const vid = searchRes?.videos?.[0];
        if (vid) {
            if (!thumb) thumb = vid.thumbnail || vid.image;
            if (!duration) duration = vid.seconds;

            // Direct URL dari yt_player scraper (utamakan format mp3 lagu penuh)
            streamInfo = await getYoutubeDirectUrl(vid.url, 'mp3');
        }
    } catch (_) {}

    // 3. Fallback audio: jika YouTube gagal, gunakan official preview audio Spotify jika ada
    const chosenStreamUrl = streamInfo?.url || previewUrl || '';
    const chosenWsUrl = chosenStreamUrl ? ('wss://stream.kanara.my.id/?url=' + encodeURIComponent(chosenStreamUrl)) : '';

    return {
        title,
        artist,
        album,
        thumb,
        duration,
        streamUrl: chosenStreamUrl,
        wsUrl: chosenWsUrl
    };
}

/**
 * Mendapatkan direct stream URL lagu penuh dari provider SaveNow / ytdlAuto / Cobalt
 */
async function getYoutubeDirectUrl(youtubeUrl, quality = 'mp3') {
    let meta = {};
    try {
        const searchRes = await yts(youtubeUrl);
        const vid = searchRes?.videos?.[0];
        if (vid) {
            meta = {
                title: vid.title,
                author: vid.author?.name,
                duration: vid.seconds,
                thumb: vid.thumbnail || vid.image
            };
        }
    } catch (_) {}

    // 1. Coba SaveNow
    try {
        const sn = await downloadSaveNow(youtubeUrl, quality);
        if (sn && sn.status && sn.download_url) {
            return {
                url: sn.download_url,
                title: sn.title || meta.title,
                author: meta.author,
                duration: sn.duration || meta.duration,
                thumb: sn.thumbnail || meta.thumb
            };
        }
    } catch (_) {}

    // 2. Coba ytdlAuto
    try {
        const ya = await ytdlAuto(youtubeUrl, quality);
        if (ya && ya.status && ya.download_url) {
            return {
                url: ya.download_url,
                title: ya.title || meta.title,
                author: meta.author,
                duration: meta.duration,
                thumb: meta.thumb
            };
        }
    } catch (_) {}

    // 3. Coba Cobalt
    try {
        const cb = await downloadCobalt(youtubeUrl, quality);
        if (cb && cb.status && cb.download_url) {
            return {
                url: cb.download_url,
                title: cb.title || meta.title,
                author: meta.author,
                duration: meta.duration,
                thumb: meta.thumb
            };
        }
    } catch (_) {}

    // Fallback format 360 jika MP3 gagal
    if (quality !== '360') {
        try {
            const snFallback = await downloadSaveNow(youtubeUrl, '360');
            if (snFallback && snFallback.status && snFallback.download_url) {
                return {
                    url: snFallback.download_url,
                    title: snFallback.title || meta.title,
                    author: meta.author,
                    duration: snFallback.duration || meta.duration,
                    thumb: snFallback.thumbnail || meta.thumb
                };
            }
        } catch (_) {}
    }

    return null;
}

/**
 * Handler utama fitur Spotify Player
 */
async function handleSpotify(Cantarella, m, query) {
    const text = String(query || '').trim();
    if (!text) {
        return await Cantarella.sendMessage(m.chat, {
            text: 'Masukkan judul lagu Spotify atau link Spotify.\n\nContoh:\n.spotify another love\n.spotify feather sabrina carpenter\n.spotify https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'
        }, { quoted: m });
    }

    try {
        await Cantarella.sendMessage(m.chat, { react: { text: '🟢', key: m.key } });
    } catch (_) {}

    const info = await searchSpotifyTrack(text);
    if (!info?.streamUrl && !info?.wsUrl) {
        throw new Error('Lagu tidak ditemukan atau stream gagal disiapkan.');
    }

    let posterBase64 = '';
    if (info.thumb) {
        try {
            const thumbRes = await axios.get(info.thumb, {
                responseType: 'arraybuffer',
                timeout: 10000
            });
            posterBase64 = 'data:image/jpeg;base64,' + Buffer.from(thumbRes.data).toString('base64');
        } catch (_) {
            posterBase64 = '';
        }
    }

    const durationStr = info.duration
        ? `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}`
        : '0:00';

    const htmlPayload = buildSpotifyPlayerHtml({
        title: info.title,
        artist: info.artist,
        duration: durationStr,
        streamUrl: info.streamUrl,
        wsUrl: info.wsUrl,
        posterBase64
    });

    const responseId = randomUUID();

    await Cantarella.relayMessage(
        m.chat,
        {
            messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2,
                botMetadata: {
                    messageDisclaimerText: '',
                    botResponseId: responseId
                }
            },
            botForwardedMessage: {
                message: {
                    richResponseMessage: {
                        messageType: 1,
                        submessages: [{ messageType: 2, messageText: info.title || 'Spotify Player' }],
                        unifiedResponse: {
                            data: Buffer.from(
                                JSON.stringify({
                                    response_id: responseId,
                                    sections: [
                                        {
                                            view_model: {
                                                primitive: {
                                                    __typename: 'GenAIaeacdsnwHtmlPrimitive',
                                                    payload: htmlPayload,
                                                    trusted_sources: []
                                                },
                                                __typename: 'GenAISingleLayoutViewModel'
                                            }
                                        }
                                    ]
                                })
                            ).toString('base64')
                        },
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
                            forwardOrigin: 4
                        }
                    }
                }
            }
        },
        { messageId: responseId }
    );

    try {
        await Cantarella.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
    } catch (_) {}
}

module.exports = {
    handleSpotify,
    buildSpotifyPlayerHtml,
    searchSpotifyTrack,
    scrapeSpotifyEmbed,
    searchSpotifyPathfinder
};


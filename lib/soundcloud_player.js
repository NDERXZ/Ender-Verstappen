'use strict';

const { randomUUID } = require('crypto');
const fetch = globalThis.fetch || require('node-fetch');
const sc = require('./scrape/soundcloud');

function escapeHtmlJs(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\`/g, '\\`') 
        .replace(/\$\{/g, '\\${')
        .replace(/</g, '\\x3C');
}

/**
 * Merakit antarmuka HTML SoundCloud Player (Lightweight <25KB, WebSocket Streaming seperti ytp)
 */
function buildSoundCloudPlayerHtml({ title, artist, duration, streamUrl, wsUrl, posterBase64 }) {
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
accent-color:#ff5500;
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
background:#141414;
border:1px solid rgba(255,85,0,.15);
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
background:linear-gradient(180deg, rgba(20,20,20,.4) 0%, rgba(20,20,20,.88) 60%, #141414 100%);
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
width:26px;
height:26px;
fill:#ff5500
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
color:#ff5500;
background:rgba(255,85,0,.12);
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
background:#1c1c1c;
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
background:#ff5500;
color:#fff;
display:flex;
align-items:center;
justify-content:center;
padding:0;
box-shadow:0 8px 24px rgba(255,85,0,.45);
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
background:#ff5500;
color:#fff;
display:flex;
align-items:center;
justify-content:center;
padding:0;
box-shadow:0 6px 20px rgba(255,85,0,.35);
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
color:#ff5500
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
border:1px solid rgba(255,85,0,.15);
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
color:#ff5500;
letter-spacing:.8px
}
.debug-state{
font-size:9px;
font-weight:700;
padding:2px 6px;
border-radius:12px;
background:rgba(255,85,0,.15);
color:#ff5500
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
          <svg viewBox="0 0 24 24"><path d="M11.56 8.87V17h1.49V9.61c.42-.48.97-.74 1.57-.74 1.25 0 2.22 1.02 2.22 2.33v5.8h1.49v-5.8c0-2.13-1.63-3.79-3.71-3.79-.86 0-1.65.29-2.31.81-.39-.75-1.12-1.28-1.99-1.39v10.17h1.49V9.22c.26-.22.56-.35.84-.35zM8.58 11.23V17h1.49v-6.23c-.35.09-.7.25-1.01.46h-.48zM5.6 13.06V17h1.49v-4.63c-.45.19-.89.47-1.26.83h-.23zM2.62 14.54V17h1.49v-2.73c-.5.06-1 .15-1.49.27zm16.48-1.92c-.17 0-.34.01-.5.04V17h4.4c.55 0 1-.45 1-1 0-.55-.45-1-1-1-.2 0-.39.06-.55.17-.18-1.45-1.4-2.55-2.85-2.55-.17 0-.33.02-.5.06z"/></svg>
          <span>SoundCloud</span>
        </div>
        <div class="top-tag">PLAYER</div>
      </div>

      <!-- ALBUM COVER WITH PLAY BUTTON -->
      <div class="cover-frame" id="coverFrame" onclick="togglePlay()">
        <img id="coverImg" src="${posterBase64 || 'https://a-v2.sndcdn.com/assets/images/default/cloud-dark-44243a.png'}" alt="cover">
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
      <div class="debug-title">SOUNDCLOUD STREAM</div>
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
  heartBtn.style.color = heartBtn.classList.contains("is-active") ? "#ff5500" : "#888";
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
 * WEBSOCKET AUDIO STREAMER (Identik dengan ytp yang lancar)
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
  log("Connecting to SoundCloud stream...");
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
 * Handler utama pemutar lagu SoundCloud WhatsApp
 */
async function handleSoundCloudPlay(Cantarella, m, query) {
    const text = String(query || '').trim();

    if (!text) {
        return await Cantarella.sendMessage(m.chat, {
            text: 'Masukkan judul lagu atau link SoundCloud.\n\nContoh:\n.sc alan walker faded\n.soundcloud https://soundcloud.com/alanwalker/faded'
        }, { quoted: m });
    }

    try {
        await Cantarella.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });
    } catch (_) {}

    // 1. Cari atau resolve track SoundCloud
    const searchRes = await sc.search(text);
    if (!searchRes?.tracks || searchRes.tracks.length === 0) {
        throw new Error('Lagu SoundCloud tidak ditemukan.');
    }

    const track = searchRes.tracks[0];

    // 2. Dapatkan direct audio stream link
    const dlLinks = await sc.getDownloadLinks(track.media, searchRes.clientId);
    if (!dlLinks?.mp3) {
        throw new Error('Gagal mendapatkan link streaming audio SoundCloud.');
    }

    // 3. Download thumbnail poster dalam format Base64 (hanya thumbnail gambar, sangat ringan)
    let posterBase64 = '';
    if (track.cover) {
        try {
            const res = await fetch(track.cover);
            if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                posterBase64 = 'data:image/jpeg;base64,' + buf.toString('base64');
            }
        } catch (_) {
            posterBase64 = '';
        }
    }

    const durationStr = track.duration
        ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}`
        : '0:00';

    const wsUrl = 'wss://stream.kanara.my.id/?url=' + encodeURIComponent(dlLinks.mp3);

    // 4. Rakit payload HTML SoundCloud (<25KB)
    const htmlPayload = buildSoundCloudPlayerHtml({
        title: track.title || 'SoundCloud Track',
        artist: track.artist || 'SoundCloud Artist',
        duration: durationStr,
        streamUrl: dlLinks.mp3,
        wsUrl,
        posterBase64
    });

    const responseId = randomUUID();

    // 5. Kirimkan pesan dengan format yang 100% lolos di WhatsApp (sama persis seperti ytp)
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
                        submessages: [{ messageType: 2, messageText: track.title || 'SoundCloud Player' }],
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
        await Cantarella.sendMessage(m.chat, { react: { text: '🟠', key: m.key } });
    } catch (_) {}
}

module.exports = {
    handleSoundCloudPlay,
    buildSoundCloudPlayerHtml
};

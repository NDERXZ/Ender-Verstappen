'use strict';

const { randomUUID } = require('crypto');
const yts = require('yt-search');
const { downloadSaveNow, downloadCobalt } = require('./scrape/youtube_dl');
const { ytdlAuto } = require('./scrape/youtube');

function escapeHtmlJs(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\`/g, '\\`')
        .replace(/\$\{/g, '\\${')
        .replace(/</g, '\\x3C');
}

function formatViews(views) {
    const n = Number(views);
    if (!Number.isFinite(n)) return String(views || '');
    if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'M views';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + ' jt views';
    if (n >= 1000) return (n / 1000).toFixed(1) + ' rb views';
    return n + ' views';
}

/**
 * Mencari video YouTube lengkap dengan metadata
 */
async function searchYoutubeVideos(query = 'Trending Indonesia', limit = 12) {
    try {
        const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i.test(query);
        const searchRes = await yts(query);
        const videos = searchRes?.videos || [];

        return videos.slice(0, limit).map(v => ({
            videoId: v.videoId || '',
            title: v.title || 'Untitled Video',
            channel: v.author?.name || 'YouTube Channel',
            views: v.views ? formatViews(v.views) : '',
            ago: v.ago || '',
            duration: v.timestamp || '0:00',
            thumbnail: v.thumbnail || v.image || '',
            url: v.url || ''
        }));
    } catch (_) {
        return [];
    }
}

/**
 * Mendapatkan direct video stream URL
 */
async function getDirectVideoStream(youtubeUrl) {
    if (!youtubeUrl) return null;

    try {
        const sn = await downloadSaveNow(youtubeUrl, '360');
        if (sn && sn.status && sn.download_url) {
            return sn.download_url;
        }
    } catch (_) {}

    try {
        const ya = await ytdlAuto(youtubeUrl, '360');
        if (ya && ya.status && ya.download_url) {
            return ya.download_url;
        }
    } catch (_) {}

    try {
        const cb = await downloadCobalt(youtubeUrl, '360');
        if (cb && cb.status && cb.download_url) {
            return cb.download_url;
        }
    } catch (_) {}

    return null;
}

/**
 * Merakit HTML5 YouTube Mini Web App (Tanpa like/dislike/subscribe)
 */
function buildYouTubeAppHtml({ initialQuery = '', initialVideos = [], primaryStreamUrl = '' }) {
    const safeQuery = escapeHtmlJs(initialQuery);
    const safeVideosJson = escapeHtmlJs(JSON.stringify(initialVideos));
    const safeStreamUrl = escapeHtmlJs(primaryStreamUrl);

    return `<style>
*{
  box-sizing:border-box;
  -webkit-tap-highlight-color:transparent;
  margin:0;
  padding:0;
}
body{
  background:#090909;
  color:#fff;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  padding:12px;
  overflow-x:hidden;
}
.yt-wrap{
  max-width:460px;
  margin:0 auto;
  background:#0f0f0f;
  border-radius:18px;
  border:1px solid rgba(255,255,255,.1);
  overflow:hidden;
  box-shadow:0 14px 44px rgba(0,0,0,.8);
  position:relative;
}

/* HEADER */
.yt-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:14px 16px 10px;
  border-bottom:1px solid rgba(255,255,255,.06);
}
.yt-brand{
  display:flex;
  align-items:center;
  gap:8px;
}
.yt-logo{
  width:30px;
  height:21px;
  background:#f00;
  border-radius:7px;
  display:flex;
  align-items:center;
  justify-content:center;
}
.yt-logo svg{
  width:12px;
  height:12px;
  fill:#fff;
  margin-left:2px;
}
.yt-brand-title{
  font-size:17px;
  font-weight:800;
  letter-spacing:-.6px;
  color:#fff;
}
.yt-badge{
  font-size:10px;
  font-weight:700;
  padding:3px 9px;
  border-radius:12px;
  background:rgba(255,0,0,.15);
  color:#ff4e4e;
  border:1px solid rgba(255,0,0,.3);
  letter-spacing:.5px;
}

/* SEARCH BAR */
.yt-search-section{
  padding:12px 16px 8px;
}
.yt-search-bar{
  display:flex;
  gap:8px;
  margin-bottom:10px;
}
.yt-input{
  flex:1;
  background:#1a1a1a;
  border:1px solid rgba(255,255,255,.12);
  border-radius:24px;
  padding:9px 15px;
  color:#fff;
  font-size:13px;
  outline:none;
  user-select:text;
  -webkit-user-select:text;
  transition:border-color .2s;
}
.yt-input:focus{
  border-color:#f00;
}
.yt-btn-search{
  background:#cc0000;
  color:#fff;
  border:none;
  border-radius:24px;
  padding:0 16px;
  font-size:12px;
  font-weight:700;
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:4px;
  transition:all .15s;
}
.yt-btn-search:active{
  transform:scale(.94);
  background:#ff0000;
}

/* CATEGORY CHIPS */
.yt-chips{
  display:flex;
  gap:6px;
  overflow-x:auto;
  padding-bottom:8px;
  scrollbar-width:none;
}
.yt-chips::-webkit-scrollbar{display:none;}
.yt-chip{
  background:#272727;
  border:1px solid rgba(255,255,255,.08);
  border-radius:16px;
  padding:5px 12px;
  font-size:11px;
  color:#f1f1f1;
  white-space:nowrap;
  cursor:pointer;
  transition:all .15s;
}
.yt-chip:hover,.yt-chip:active{
  background:#fff;
  color:#000;
}

/* VIDEO PLAYER SECTION */
.yt-player-wrap{
  padding:0 16px 12px;
}
.yt-player-box{
  position:relative;
  width:100%;
  aspect-ratio:16/9;
  background:#000;
  border-radius:14px;
  overflow:hidden;
  box-shadow:0 8px 28px rgba(0,0,0,.6);
  cursor:pointer;
}
.yt-video{
  width:100%;
  height:100%;
  display:block;
  background:#000;
  object-fit:contain;
}
.yt-big-play{
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  background:rgba(0,0,0,.28);
  transition:opacity .2s;
  z-index:3;
}
.yt-big-btn{
  width:60px;
  height:60px;
  border-radius:50%;
  background:rgba(204,0,0,.92);
  border:none;
  display:flex;
  align-items:center;
  justify-content:center;
  box-shadow:0 6px 20px rgba(255,0,0,.45);
  cursor:pointer;
  transition:transform .15s;
}
.yt-big-btn:active{
  transform:scale(.92);
}
.yt-big-btn svg{
  width:24px;
  height:24px;
  fill:#fff;
  margin-left:3px;
}
.yt-playing .yt-big-play{
  opacity:0;
  pointer-events:none;
}

/* VIDEO CONTROLS */
.yt-controls{
  background:#1a1a1a;
  border-radius:0 0 14px 14px;
  padding:8px 12px;
  border:1px solid rgba(255,255,255,.08);
  border-top:none;
}
.yt-progress{
  width:100%;
  height:4px;
  accent-color:#f00;
  background:#383838;
  border-radius:2px;
  cursor:pointer;
  margin-bottom:6px;
}
.yt-ctrl-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.yt-ctrl-left,.yt-ctrl-right{
  display:flex;
  align-items:center;
  gap:10px;
}
.yt-btn-icon{
  background:none;
  border:none;
  color:#fff;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:4px;
  opacity:.88;
  transition:opacity .15s;
}
.yt-btn-icon:hover,.yt-btn-icon:active{
  opacity:1;
}
.yt-btn-icon svg{
  width:18px;
  height:18px;
  fill:currentColor;
}
.yt-time{
  font-size:11px;
  color:#aaa;
  font-family:monospace;
}
.yt-speed-btn{
  background:#272727;
  color:#fff;
  border:1px solid rgba(255,255,255,.1);
  border-radius:12px;
  padding:2px 8px;
  font-size:10px;
  font-weight:700;
  cursor:pointer;
}
.yt-vol{
  width:65px;
  height:3px;
  accent-color:#f00;
  cursor:pointer;
}

/* ACTIVE VIDEO INFO (Clean, NO Like/Dislike/Subscribe) */
.yt-info{
  padding:12px 16px 14px;
  border-bottom:1px solid rgba(255,255,255,.06);
}
.yt-title{
  font-size:15px;
  font-weight:700;
  line-height:1.35;
  margin-bottom:6px;
  color:#fff;
}
.yt-meta{
  font-size:12px;
  color:#aaa;
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
}
.yt-channel{
  color:#fff;
  font-weight:600;
}
.yt-dot{
  color:#555;
}

/* VIDEO FEED / PLAYLIST QUEUE */
.yt-feed{
  padding:14px 16px;
}
.yt-feed-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-bottom:12px;
}
.yt-feed-title{
  font-size:13px;
  font-weight:700;
  letter-spacing:.4px;
  color:#aaa;
  text-transform:uppercase;
}
.yt-feed-count{
  font-size:11px;
  color:#666;
}
.yt-list{
  display:flex;
  flex-direction:column;
  gap:10px;
  max-height:280px;
  overflow-y:auto;
  padding-right:2px;
}
.yt-list::-webkit-scrollbar{
  width:4px;
}
.yt-list::-webkit-scrollbar-thumb{
  background:rgba(255,255,255,.18);
  border-radius:4px;
}
.yt-item{
  display:flex;
  gap:10px;
  padding:6px;
  border-radius:10px;
  background:rgba(255,255,255,.03);
  cursor:pointer;
  transition:all .15s;
  border:1px solid transparent;
}
.yt-item:hover,.yt-item:active{
  background:rgba(255,255,255,.07);
}
.yt-item.active{
  border-color:#f00;
  background:rgba(255,0,0,.08);
}
.yt-thumb-wrap{
  position:relative;
  width:115px;
  aspect-ratio:16/9;
  border-radius:8px;
  overflow:hidden;
  flex-shrink:0;
  background:#222;
}
.yt-thumb{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block;
}
.yt-dur{
  position:absolute;
  bottom:4px;
  right:4px;
  background:rgba(0,0,0,.85);
  color:#fff;
  font-size:9px;
  font-weight:700;
  padding:2px 4px;
  border-radius:4px;
  font-family:monospace;
}
.yt-item-info{
  flex:1;
  min-width:0;
  display:flex;
  flex-direction:column;
  justify-content:center;
}
.yt-item-title{
  font-size:12px;
  font-weight:600;
  line-height:1.3;
  color:#fff;
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
  margin-bottom:3px;
}
.yt-item.active .yt-item-title{
  color:#ff4e4e;
}
.yt-item-channel{
  font-size:11px;
  color:#aaa;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  margin-bottom:2px;
}
.yt-item-stats{
  font-size:10px;
  color:#777;
}

.yt-status{
  text-align:center;
  font-size:10px;
  color:#ff4e4e;
  padding:6px 0;
  opacity:.9;
}
</style>

<body>
<div class="yt-wrap">
  <!-- HEADER -->
  <div class="yt-head">
    <div class="yt-brand">
      <div class="yt-logo">
        <svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
      </div>
      <span class="yt-brand-title">YouTube</span>
    </div>
    <div class="yt-badge">MINI APP</div>
  </div>

  <!-- SEARCH SECTION -->
  <div class="yt-search-section">
    <div class="yt-search-bar">
      <input type="text" class="yt-input" id="ytSearchInput" placeholder="Cari video YouTube..." value="${safeQuery}">
      <button class="yt-btn-search" type="button" onclick="doYtSearch()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        Cari
      </button>
    </div>

    <!-- QUICK CATEGORY CHIPS -->
    <div class="yt-chips">
      <div class="yt-chip" onclick="quickYtSearch('Trending Indonesia')">🔥 Trending</div>
      <div class="yt-chip" onclick="quickYtSearch('Top Music Videos')">🎵 Musik</div>
      <div class="yt-chip" onclick="quickYtSearch('Gaming Indonesia')">🎮 Gaming</div>
      <div class="yt-chip" onclick="quickYtSearch('Podcast Indonesia')">🎙️ Podcast</div>
      <div class="yt-chip" onclick="quickYtSearch('Berita Terkini')">📰 Berita</div>
      <div class="yt-chip" onclick="quickYtSearch('Tutorial Edukasi')">💡 Edukasi</div>
    </div>
  </div>

  <!-- VIDEO PLAYER -->
  <div class="yt-player-wrap">
    <div class="yt-player-box" id="ytPlayerBox" onclick="toggleYtPlay()">
      <video class="yt-video" id="ytVideo" playsinline webkit-playsinline preload="metadata"></video>
      <div class="yt-big-play" id="ytBigPlay">
        <button class="yt-big-btn" type="button" onclick="event.stopPropagation();toggleYtPlay()">
          <svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
        </button>
      </div>
    </div>

    <!-- CONTROLS -->
    <div class="yt-controls">
      <input type="range" class="yt-progress" id="ytProgress" min="0" max="100" value="0" step="0.1" oninput="seekYtVideo(this.value)">
      <div class="yt-ctrl-row">
        <div class="yt-ctrl-left">
          <button class="yt-btn-icon" id="ytPlayIconBtn" type="button" onclick="toggleYtPlay()">
            <svg id="ytSvgPlay" viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
            <svg id="ytSvgPause" viewBox="0 0 24 24" style="display:none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
          </button>
          <button class="yt-btn-icon" type="button" onclick="prevYtVideo()" title="Sebelumnya">
            <svg viewBox="0 0 24 24"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"></line></svg>
          </button>
          <button class="yt-btn-icon" type="button" onclick="nextYtVideo()" title="Berikutnya">
            <svg viewBox="0 0 24 24"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line></svg>
          </button>
          <span class="yt-time"><span id="ytTimeCurrent">0:00</span> / <span id="ytTimeDuration">0:00</span></span>
        </div>

        <div class="yt-ctrl-right">
          <button class="yt-speed-btn" id="ytSpeedBtn" type="button" onclick="cycleSpeed()">1.0x</button>
          <button class="yt-btn-icon" type="button" onclick="toggleYtMute()">
            <svg id="ytMuteIcon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
          <input type="range" class="yt-vol" id="ytVol" min="0" max="1" step="0.05" value="1" oninput="changeYtVolume(this.value)">
          <button class="yt-btn-icon" type="button" onclick="toggleFullScreen()" title="Layar Penuh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ACTIVE VIDEO INFO (Clean, NO Like/Dislike/Subscribe) -->
  <div class="yt-info">
    <div class="yt-title" id="activeTitle">Memuat video...</div>
    <div class="yt-meta">
      <span class="yt-channel" id="activeChannel">-</span>
      <span class="yt-dot">•</span>
      <span id="activeViews">0 views</span>
      <span class="yt-dot">•</span>
      <span id="activeAgo">-</span>
    </div>
  </div>

  <!-- VIDEO FEED / RECOMMENDATIONS QUEUE -->
  <div class="yt-feed">
    <div class="yt-feed-head">
      <span class="yt-feed-title" id="feedTitle">Video Terkait</span>
      <span class="yt-feed-count" id="feedCount">0 video</span>
    </div>

    <div class="yt-list" id="ytVideoList">
      <div style="text-align:center;padding:20px;color:#777;font-size:12px;">Memuat daftar video...</div>
    </div>
  </div>

  <div class="yt-status" id="ytStatus">Siap memutar video</div>
</div>

<script>
var video = document.getElementById("ytVideo");
var playerBox = document.getElementById("ytPlayerBox");
var progress = document.getElementById("ytProgress");
var timeCurrent = document.getElementById("ytTimeCurrent");
var timeDuration = document.getElementById("ytTimeDuration");
var playSvg = document.getElementById("ytSvgPlay");
var pauseSvg = document.getElementById("ytSvgPause");
var speedBtn = document.getElementById("ytSpeedBtn");
var volBar = document.getElementById("ytVol");
var activeTitle = document.getElementById("activeTitle");
var activeChannel = document.getElementById("activeChannel");
var activeViews = document.getElementById("activeViews");
var activeAgo = document.getElementById("activeAgo");
var videoListEl = document.getElementById("ytVideoList");
var feedTitleEl = document.getElementById("feedTitle");
var feedCountEl = document.getElementById("feedCount");
var searchInput = document.getElementById("ytSearchInput");
var statusLabel = document.getElementById("ytStatus");

var videos = [];
try {
  videos = JSON.parse("${safeVideosJson}") || [];
} catch(e) {
  videos = [];
}

var currentIdx = 0;
var speeds = [1.0, 1.25, 1.5, 2.0, 0.75];
var currentSpeedIdx = 0;
var primaryStream = "${safeStreamUrl}";

function fmtTime(sec) {
  if (!isFinite(sec) || isNaN(sec)) return "0:00";
  var m = Math.floor(sec / 60);
  var s = Math.floor(sec % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function updatePlayUi(playing) {
  if (playing) {
    playSvg.style.display = "none";
    pauseSvg.style.display = "block";
    playerBox.classList.add("yt-playing");
    statusLabel.textContent = "Sedang Memutar: " + (videos[currentIdx]?.title || "");
  } else {
    playSvg.style.display = "block";
    pauseSvg.style.display = "none";
    playerBox.classList.remove("yt-playing");
    statusLabel.textContent = "Jeda";
  }
}

function renderVideoList() {
  if (!videos.length) {
    videoListEl.innerHTML = '<div style="text-align:center;padding:24px;color:#777;font-size:12px;">Tidak ada video ditemukan. Coba cari kata kunci lain.</div>';
    feedCountEl.textContent = "0 video";
    return;
  }
  feedCountEl.textContent = videos.length + " video";

  var html = "";
  for (var i = 0; i < videos.length; i++) {
    var v = videos[i];
    var isActive = (i === currentIdx);
    html += '<div class="yt-item ' + (isActive ? 'active' : '') + '" onclick="selectYtVideo(' + i + ')">';
    html += '<div class="yt-thumb-wrap">';
    html += '<img class="yt-thumb" src="' + (v.thumbnail || '') + '" alt="thumb" onerror="this.src=\\'https://www.youtube.com/s/desktop/f46f3dc8/img/favicon.ico\\'">';
    html += '<span class="yt-dur">' + (v.duration || '0:00') + '</span>';
    html += '</div>';
    html += '<div class="yt-item-info">';
    html += '<div class="yt-item-title">' + escapeHtml(v.title) + '</div>';
    html += '<div class="yt-item-channel">' + escapeHtml(v.channel) + '</div>';
    html += '<div class="yt-item-stats">' + (v.views || '') + (v.ago ? ' • ' + v.ago : '') + '</div>';
    html += '</div>';
    html += '</div>';
  }
  videoListEl.innerHTML = html;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadYtVideo(idx, autoplay) {
  if (!videos.length || idx < 0 || idx >= videos.length) return;
  currentIdx = idx;
  var v = videos[idx];

  activeTitle.textContent = v.title || "Unknown Title";
  activeChannel.textContent = v.channel || "YouTube Channel";
  activeViews.textContent = v.views || "";
  activeAgo.textContent = v.ago || "";

  video.poster = v.thumbnail || "";
  timeDuration.textContent = v.duration || "0:00";
  progressBar.value = 0;
  timeCurrent.textContent = "0:00";

  renderVideoList();

  // Jika ini video pertama dan sudah ada primary stream URL dari server
  var streamUrl = (idx === 0 && primaryStream) ? primaryStream : "";

  if (streamUrl) {
    video.src = streamUrl;
    video.load();
    if (autoplay) {
      var p = video.play();
      if (p && p.catch) p.catch(function() {});
    }
  } else {
    // Stream via WebSocket proxy
    statusLabel.textContent = "Menghubungkan stream video...";
    startWsStream(v.url || ("https://www.youtube.com/watch?v=" + v.videoId), autoplay);
  }
}

var currentWs = null;
function startWsStream(videoUrl, autoplay) {
  if (currentWs) {
    try { currentWs.close(); } catch(e) {}
    currentWs = null;
  }

  var wsUrl = "wss://stream.kanara.my.id/?url=" + encodeURIComponent(videoUrl);
  var wsChunks = [];
  var wsDone = false;

  try {
    currentWs = new WebSocket(wsUrl);
    currentWs.binaryType = "arraybuffer";

    currentWs.onopen = function() {
      statusLabel.textContent = "Buffering video stream...";
    };

    currentWs.onmessage = function(ev) {
      if (typeof ev.data === "string") {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.type === "end") {
            if (wsDone) return;
            wsDone = true;
            var blob = new Blob(wsChunks, { type: "video/mp4" });
            video.src = URL.createObjectURL(blob);
            video.load();
            if (autoplay) {
              setTimeout(function() {
                var p = video.play();
                if (p && p.catch) p.catch(function() {});
              }, 200);
            }
          }
        } catch(e) {}
        return;
      }
      wsChunks.push(ev.data);
    };

    currentWs.onerror = function() {
      statusLabel.textContent = "Gagal memuat stream video";
    };
  } catch(e) {
    statusLabel.textContent = "Koneksi WebSocket gagal";
  }
}

function selectYtVideo(idx) {
  loadYtVideo(idx, true);
}

function toggleYtPlay() {
  if (!videos.length) return;
  if (!video.src) {
    loadYtVideo(0, true);
    return;
  }
  if (video.paused) {
    var p = video.play();
    if (p && p.catch) p.catch(function() {});
  } else {
    video.pause();
  }
}

function nextYtVideo() {
  if (!videos.length) return;
  var nextIdx = (currentIdx + 1) % videos.length;
  loadYtVideo(nextIdx, true);
}

function prevYtVideo() {
  if (!videos.length) return;
  if (video.currentTime > 3) {
    video.currentTime = 0;
    return;
  }
  var prevIdx = (currentIdx - 1 + videos.length) % videos.length;
  loadYtVideo(prevIdx, true);
}

function seekYtVideo(val) {
  if (!video.duration) return;
  video.currentTime = (Number(val) / 100) * video.duration;
}

function changeYtVolume(val) {
  video.volume = Number(val);
  if (video.volume > 0) video.muted = false;
}

function toggleYtMute() {
  video.muted = !video.muted;
}

function cycleSpeed() {
  currentSpeedIdx = (currentSpeedIdx + 1) % speeds.length;
  var s = speeds[currentSpeedIdx];
  video.playbackRate = s;
  speedBtn.textContent = s.toFixed(2).replace(".00", "") + "x";
}

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    if (playerBox.requestFullscreen) playerBox.requestFullscreen();
    else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}

video.addEventListener("timeupdate", function() {
  if (!isFinite(video.duration) || !video.duration) return;
  var pct = (video.currentTime / video.duration) * 100;
  progress.value = pct;
  timeCurrent.textContent = fmtTime(video.currentTime);
  timeDuration.textContent = fmtTime(video.duration);
});

video.addEventListener("play", function() { updatePlayUi(true); });
video.addEventListener("pause", function() { updatePlayUi(false); });
video.addEventListener("ended", function() { nextYtVideo(); });
video.addEventListener("error", function() {
  statusLabel.textContent = "Error memutar video";
  updatePlayUi(false);
});

// CLIENT-SIDE SEARCH (Mencari di daftar lokal atau video iTunes HD)
function doYtSearch() {
  var q = searchInput.value.trim().toLowerCase();
  if (!q) return;

  statusLabel.textContent = "Mencari \\"" + q + "\\"...";
  feedTitleEl.textContent = "Hasil: " + q;

  // 1. Coba filter daftar lokal terlebih dahulu
  var filtered = videos.filter(function(v) {
    return v.title.toLowerCase().includes(q) || v.channel.toLowerCase().includes(q);
  });

  if (filtered.length > 0) {
    videos = filtered;
    loadYtVideo(0, true);
    statusLabel.textContent = "Ditemukan " + filtered.length + " video";
    return;
  }

  // 2. Jika tidak ada di lokal, cari video HD publik (CORS supported)
  fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(q) + "&entity=musicVideo&limit=12")
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var items = data.results || [];
      var newVideos = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it.previewUrl) continue;
        newVideos.push({
          videoId: String(it.trackId || i),
          title: it.trackName || "Unknown Video",
          channel: it.artistName || "YouTube",
          views: "HD Video",
          ago: "Music Video",
          duration: it.trackTimeMillis ? fmtTime(it.trackTimeMillis / 1000) : "0:30",
          thumbnail: (it.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
          url: it.previewUrl
        });
      }

      if (newVideos.length) {
        videos = newVideos;
        primaryStream = newVideos[0].url;
        loadYtVideo(0, true);
        statusLabel.textContent = "Ditemukan " + newVideos.length + " video";
      } else {
        videoListEl.innerHTML = '<div style="text-align:center;padding:24px;color:#777;font-size:12px;">Video tidak ditemukan. Coba kata kunci lain.</div>';
        feedCountEl.textContent = "0 video";
        statusLabel.textContent = "Video tidak ditemukan";
      }
    })
    .catch(function(err) {
      statusLabel.textContent = "Gagal memuat hasil pencarian";
    });
}

function quickYtSearch(cat) {
  searchInput.value = cat;
  doYtSearch();
}

searchInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    doYtSearch();
  }
});

// INITIAL LOAD
if (videos.length > 0) {
  loadYtVideo(0, false);
}
</script>
</body>`;
}

/**
 * Handler utama fitur YouTube Mini App WhatsApp
 */
async function handleYouTubeApp(Cantarella, m, query) {
    const q = String(query || '').trim();

    try {
        await Cantarella.sendMessage(m.chat, { react: { text: '📺', key: m.key } });
    } catch (_) {}

    const searchTerm = q || 'Trending Indonesia';
    const videos = await searchYoutubeVideos(searchTerm, 12);

    if (!videos.length) {
        return await Cantarella.sendMessage(m.chat, {
            text: '❌ Video YouTube tidak ditemukan untuk kata kunci tersebut.'
        }, { quoted: m });
    }

    // Ambil direct video stream untuk video pertama
    let primaryStreamUrl = '';
    if (videos[0]?.url) {
        try {
            primaryStreamUrl = await getDirectVideoStream(videos[0].url);
        } catch (_) {
            primaryStreamUrl = '';
        }
    }

    const htmlPayload = buildYouTubeAppHtml({
        initialQuery: q,
        initialVideos: videos,
        primaryStreamUrl: primaryStreamUrl || ''
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
                        submessages: [{ messageType: 2, messageText: videos[0]?.title || 'YouTube Player' }],
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
        await Cantarella.sendMessage(m.chat, { react: { text: '🔴', key: m.key } });
    } catch (_) {}
}

module.exports = {
    handleYouTubeApp,
    buildYouTubeAppHtml,
    searchYoutubeVideos,
    getDirectVideoStream
};

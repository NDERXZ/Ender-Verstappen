const axios = require('axios');
const yts = require('yt-search');
const https = require('https');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile, execSync } = require('child_process');

const agent = new https.Agent({ rejectUnauthorized: false });
const SAVENOW_KEY = 'dfcb6d76f2f6a9894gjkege8a4ab232222';

// In-memory stream cache for localhost fallback
let streamServer = null;
let streamPort = 0;
const streamCache = new Map();

function ensureStreamServer() {
  if (streamServer && streamPort) return Promise.resolve(streamPort);
  return new Promise((resolve) => {
    streamServer = http.createServer((req, res) => {
      const match = req.url.match(/^\/stream\/([a-zA-Z0-9_\-]+)$/);
      if (match && streamCache.has(match[1])) {
        const item = streamCache.get(match[1]);
        res.writeHead(200, {
          'Content-Type': item.mime,
          'Content-Length': item.buffer.length
        });
        res.end(item.buffer);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    streamServer.listen(0, '127.0.0.1', () => {
      streamPort = streamServer.address().port;
      resolve(streamPort);
    });
  });
}

function getYtDlpBin() {
  const candidates = [
    path.join(__dirname, '../../bin/yt-dlp'),
    path.join(process.cwd(), 'bin/yt-dlp'),
    '/home/container/bin/yt-dlp',
    '/tmp/yt-dlp',
    '/usr/local/bin/yt-dlp'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch {}
    }
  }
  // Try system PATH
  try {
    const which = execSync('which yt-dlp 2>/dev/null').toString().trim();
    if (which && fs.existsSync(which)) return which;
  } catch {}

  // Auto-download standalone yt-dlp if missing
  try {
    const dlPath = path.join(process.cwd(), 'bin/yt-dlp');
    fs.mkdirSync(path.dirname(dlPath), { recursive: true });
    execSync(`curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${dlPath}" && chmod +x "${dlPath}"`);
    if (fs.existsSync(dlPath)) return dlPath;
  } catch {}

  return null;
}

/**
 * Provider: Local yt-dlp (Native extraction with FFmpeg transcoding, 100% resilient)
 */
async function downloadYtDlp(url, format = 'mp3') {
  const bin = getYtDlpBin();
  if (!bin) return { status: false, message: 'yt-dlp binary not available' };

  const isAudio = format === 'mp3' || format === 'audio';
  const id = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const outTemplate = path.join('/tmp', `ytdl_${id}.%(ext)s`);

  const args = isAudio
    ? ['--no-playlist', '--no-warnings', '--no-check-certificates', '--ffmpeg-location', '/usr/bin/ffmpeg', '-x', '--audio-format', 'mp3', '--audio-quality', '128K', '-o', outTemplate, url]
    : ['--no-playlist', '--no-warnings', '--no-check-certificates', '--ffmpeg-location', '/usr/bin/ffmpeg', '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', outTemplate, url];

  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, async (err, stdout, stderr) => {
      const ext = isAudio ? 'mp3' : 'mp4';
      const expectedFile = path.join('/tmp', `ytdl_${id}.${ext}`);
      let targetFile = expectedFile;

      if (!fs.existsSync(targetFile)) {
        try {
          const files = fs.readdirSync('/tmp').filter(f => f.startsWith(`ytdl_${id}.`));
          if (files.length > 0) {
            targetFile = path.join('/tmp', files[0]);
          }
        } catch {}
      }

      if (!fs.existsSync(targetFile)) {
        return resolve({ status: false, message: 'yt-dlp failed: ' + (err?.message || 'File not created') });
      }

      try {
        const buffer = fs.readFileSync(targetFile);
        try { fs.unlinkSync(targetFile); } catch {}

        const port = await ensureStreamServer();
        const token = id;
        streamCache.set(token, { buffer, mime: isAudio ? 'audio/mpeg' : 'video/mp4' });
        setTimeout(() => streamCache.delete(token), 300000); // 5 min TTL

        resolve({
          status: true,
          title: 'YouTube ' + (isAudio ? 'Audio' : 'Video'),
          download_url: `http://127.0.0.1:${port}/stream/${token}`,
          buffer: buffer,
          duration: 0
        });
      } catch (e) {
        resolve({ status: false, message: e.message });
      }
    });
  });
}

/**
 * Provider (Backup): NexRay API
 */
async function downloadNexray(url, format = 'mp3') {
  const isAudio = format === 'mp3' || format === 'audio';
  if (!isAudio) return { status: false, message: 'NexRay only supports mp3' };

  const endpoints = [
    'https://api.nexray.web.id/downloader/ytmp3?url=',
    'https://api.nexray.eu.cc/downloader/ytmp3?url='
  ];

  for (const ep of endpoints) {
    try {
      const res = await axios.get(ep + encodeURIComponent(url), {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (res.data && res.data.status && res.data.result && res.data.result.url) {
        return {
          status: true,
          title: res.data.result.title || 'YouTube Audio',
          download_url: res.data.result.url,
          duration: Math.round(res.data.result.duration || 0),
          filesize: res.data.result.filesize || 0
        };
      }
    } catch {}
  }
  return { status: false, message: 'NexRay failed' };
}

/**
 * Provider (Backup): SaveNow / LBServer API
 */
async function downloadSaveNow(url, format = 'mp3') {
  const hosts = ['https://p.savenow.to', 'https://p.lbserver.xyz'];
  const fmt = format === 'audio' || format === 'mp3' ? 'mp3' : (format || '720');

  for (const host of hosts) {
    try {
      const { data: init } = await axios.get(`${host}/ajax/download.php`, {
        params: {
          copyright: 0,
          format: fmt,
          audio_quality: '128',
          url: url,
          api: SAVENOW_KEY
        },
        httpsAgent: agent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 6000
      });

      if (!init || !init.success || !init.progress_url) continue;

      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const { data: progress } = await axios.get(init.progress_url, {
            httpsAgent: agent,
            timeout: 6000
          });

          if (progress.success === 1 && progress.download_url) {
            return {
              status: true,
              title: progress.title || init.title || 'YouTube Media',
              download_url: progress.download_url,
              thumbnail: progress.thumbnail_url || init.thumbnail_url || null,
              duration: progress.video_duration || 0
            };
          }
          if (progress.success === -1) break;
        } catch {}
      }
    } catch (e) {}
  }
  return { status: false, message: 'SaveNow failed' };
}

/**
 * Provider (Backup): Cobalt API
 */
async function downloadCobalt(url, format = 'mp3') {
  const instances = [
    'https://cobalt-api.kwiatekm.tokyo',
    'https://api.cobalt.tools',
    'https://co.wuk.sh'
  ];

  const isAudio = format === 'mp3' || format === 'audio';

  for (const instance of instances) {
    try {
      const res = await axios.post(`${instance}/`, {
        url: url,
        downloadMode: isAudio ? 'audio' : 'auto',
        audioFormat: 'mp3',
        videoQuality: '720'
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 6000
      });

      if (res.data && res.data.url) {
        return {
          status: true,
          title: 'YouTube Media',
          download_url: res.data.url,
          thumbnail: null
        };
      }
    } catch {}
  }
  return { status: false, message: 'Cobalt failed' };
}

/**
 * Universal YouTube Downloader using native yt-dlp as primary
 */
async function getYoutubeDownload(url, format = 'mp3') {
  // 1. Langsung pakai yt-dlp secara native
  try {
    const result = await downloadYtDlp(url, format);
    if (result && result.status && (result.download_url || result.buffer)) {
      return result;
    }
    if (result && !result.status) {
      console.error('[yt-dlp failed]', result.message);
    }
  } catch (e) {
    console.error('[yt-dlp exception]', e.message);
  }

  // 2. Fallback jika yt-dlp gagal (misal link privat/spesifik)
  try {
    const result = await downloadNexray(url, format);
    if (result && result.status && result.download_url) {
      return result;
    }
  } catch {}

  // 3. Fallback: SaveNow
  try {
    const result = await downloadSaveNow(url, format);
    if (result && result.status && result.download_url) {
      return result;
    }
  } catch {}

  // 4. Fallback: Cobalt
  try {
    const result = await downloadCobalt(url, format);
    if (result && result.status && result.download_url) {
      return result;
    }
  } catch {}

  return { status: false, message: 'Semua server dan downloader YouTube sedang sibuk.' };
}

module.exports = {
  getYoutubeDownload,
  downloadYtDlp,
  downloadNexray,
  downloadSaveNow,
  downloadCobalt
};

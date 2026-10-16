const axios = require('axios');
const yts = require('yt-search');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });
const SAVENOW_KEY = 'dfcb6d76f2f6a9894gjkege8a4ab232222';

/**
 * Provider 1: SaveNow / LBServer API (Stabil & bebas blokir datacenter)
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
        timeout: 25000
      });

      if (!init || !init.success || !init.progress_url) continue;

      // Poll progress URL
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const { data: progress } = await axios.get(init.progress_url, {
            httpsAgent: agent,
            timeout: 15000
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
    } catch (e) {
      // lanjut host berikutnya jika error
    }
  }
  return { status: false, message: 'SaveNow failed' };
}

/**
 * Provider 2: Cobalt public API fallback
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
        timeout: 15000
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
 * Universal YouTube Downloader (Audio / Video)
 */
async function getYoutubeDownload(url, format = 'mp3') {
  let result = await downloadSaveNow(url, format);
  if (result && result.status && result.download_url) {
    return result;
  }

  result = await downloadCobalt(url, format);
  if (result && result.status && result.download_url) {
    return result;
  }

  return { status: false, message: 'Semua server download YouTube sedang sibuk.' };
}

module.exports = {
  getYoutubeDownload,
  downloadSaveNow,
  downloadCobalt
};

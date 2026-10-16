'use strict';

const fs = require('fs');
const path = require('path');
const fetch = globalThis.fetch || require('node-fetch');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CACHE_FILE = path.join(__dirname, '.client_id');

/**
 * Helper to get the cached SoundCloud client_id.
 */
function getCachedClientId() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const id = fs.readFileSync(CACHE_FILE, 'utf8').trim();
      if (id && id.length === 32) return id;
    }
  } catch (e) {}
  return null;
}

/**
 * Helper to save the SoundCloud client_id to cache.
 */
function saveCachedClientId(id) {
  try {
    fs.writeFileSync(CACHE_FILE, id, 'utf8');
  } catch (e) {}
}

/**
 * Scrapes a fresh client_id from SoundCloud assets.
 */
async function scrapeClientId() {
  const res = await fetch('https://soundcloud.com', {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!res.ok) {
    throw new Error('Failed to fetch SoundCloud homepage to scrape client_id');
  }
  const html = await res.text();
  
  const scriptRegex = /<script\s+[^>]*src="([^"]+)"/gi;
  let match;
  const scriptUrls = [];
  while ((match = scriptRegex.exec(html)) !== null) {
    scriptUrls.push(match[1]);
  }
  
  // Search from the bottom script assets (often where main client script bundles are loaded)
  for (const url of scriptUrls.reverse()) {
    try {
      const scriptRes = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!scriptRes.ok) continue;
      const code = await scriptRes.text();
      
      const clientIdMatch = code.match(/client_id[:=]"([a-zA-Z0-9]{32})"/i) || 
                            code.match(/client_id=([a-zA-Z0-9]{32})/i) ||
                            code.match(/client_id:"([a-zA-Z0-9]{32})"/i);
      if (clientIdMatch) {
        const id = clientIdMatch[1];
        saveCachedClientId(id);
        return id;
      }
    } catch (e) {}
  }
  throw new Error('Could not find SoundCloud client_id in asset scripts');
}

/**
 * Resolves or refreshes client_id.
 */
async function getClientId(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCachedClientId();
    if (cached) return cached;
  }
  return await scrapeClientId();
}

/**
 * Wraps SoundCloud API calls with auto-retry and client_id rotation if it expires.
 */
async function callApi(urlBuilder) {
  let clientId = await getClientId();
  try {
    const res = await fetch(urlBuilder(clientId), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.status === 401) {
      // client_id expired, refresh and retry
      clientId = await getClientId(true);
      const retryRes = await fetch(urlBuilder(clientId), { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!retryRes.ok) throw new Error(`API call failed with status: ${retryRes.status}`);
      return await retryRes.json();
    }
    if (!res.ok) throw new Error(`API call failed with status: ${res.status}`);
    return await res.json();
  } catch (err) {
    // Retry fallback
    clientId = await getClientId(true);
    const retryRes = await fetch(urlBuilder(clientId), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!retryRes.ok) throw new Error(`API call failed after client_id refresh: ${retryRes.status}`);
    return await retryRes.json();
  }
}

/**
 * Converts a low-res artwork URL to a high-res (500x500) cover image URL.
 */
function getHighResCover(url) {
  if (!url) return 'https://a-v2.sndcdn.com/assets/images/default/cloud-dark-44243a.png';
  return url.replace('-large.', '-t500x500.');
}

/**
 * Initiates a search query or resolves a direct SoundCloud URL.
 * 
 * @param {string} queryOrUrl - SoundCloud track URL or search term.
 * @returns {Promise<{ tracks: Array<object>, clientId: string }>} List of tracks.
 */
async function search(queryOrUrl) {
  if (!queryOrUrl || typeof queryOrUrl !== 'string') {
    throw new Error('Query or URL must be a non-empty string');
  }

  const isUrl = queryOrUrl.startsWith('http://') || queryOrUrl.startsWith('https://');

  if (isUrl) {
    // Resolve single track URL directly
    const trackInfo = await callApi((clientId) => 
      `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(queryOrUrl)}&client_id=${clientId}`
    );
    
    // Check if the resolved resource is a playlist/album
    if (trackInfo.kind === 'playlist') {
      const playlistTracks = (trackInfo.tracks || []).map(t => ({
        id: t.id,
        title: t.title,
        artist: t.user?.username || 'Unknown Artist',
        cover: getHighResCover(t.artwork_url || trackInfo.artwork_url),
        url: t.permalink_url,
        duration: t.duration ? Math.floor(t.duration / 1000) : 0,
        media: t.media
      }));
      return { tracks: playlistTracks, clientId: await getClientId() };
    }

    return {
      tracks: [{
        id: trackInfo.id,
        title: trackInfo.title,
        artist: trackInfo.user?.username || 'Unknown Artist',
        cover: getHighResCover(trackInfo.artwork_url),
        url: trackInfo.permalink_url,
        duration: trackInfo.duration ? Math.floor(trackInfo.duration / 1000) : 0,
        media: trackInfo.media
      }],
      clientId: await getClientId()
    };
  } else {
    // Query search term
    const searchResult = await callApi((clientId) => 
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(queryOrUrl)}&client_id=${clientId}&limit=15`
    );
    
    const tracks = (searchResult.collection || []).map(t => ({
      id: t.id,
      title: t.title,
      artist: t.user?.username || 'Unknown Artist',
      cover: getHighResCover(t.artwork_url),
      url: t.permalink_url,
      duration: t.duration ? Math.floor(t.duration / 1000) : 0,
      media: t.media
    }));

    return {
      tracks,
      clientId: await getClientId()
    };
  }
}

/**
 * Fetches the direct CDN audio stream link for a specific track.
 * 
 * @param {object} trackMedia - The media property of the track object.
 * @param {string} clientId - The current client_id.
 * @returns {Promise<{ mp3: string|null, protocol: string, mimeType: string }>} Direct stream URLs.
 */
async function getDownloadLinks(trackMedia, clientId) {
  if (!trackMedia || !trackMedia.transcodings) {
    throw new Error('Track contains no transcoding information');
  }

  const transcodings = trackMedia.transcodings;
  
  // Find progressive (preferred) format or fallback to HLS format
  const progressive = transcodings.find(t => t.format?.protocol === 'progressive');
  const hls = transcodings.find(t => t.format?.protocol === 'hls');
  
  const targetTranscoding = progressive || hls;
  if (!targetTranscoding) {
    throw new Error('No supported stream formats found for this track');
  }

  // Get stream CDN URL
  const cid = clientId || await getClientId();
  const res = await fetch(`${targetTranscoding.url}?client_id=${cid}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  if (!res.ok) {
    throw new Error(`Failed to retrieve stream URL from transcoding endpoint. Status: ${res.status}`);
  }

  const data = await res.json();
  
  return {
    mp3: data.url || null,
    protocol: targetTranscoding.format?.protocol || 'progressive',
    mimeType: targetTranscoding.format?.mime_type || 'audio/mpeg'
  };
}

/**
 * Direct single-step resolver from track URL to audio CDN URL.
 * 
 * @param {string} soundCloudUrl - SoundCloud track URL.
 * @returns {Promise<{ id: number, title: string, artist: string, cover: string, url: string, duration: number, downloadLinks: object }>} Track and stream info.
 */
async function downloadDirect(soundCloudUrl) {
  const result = await search(soundCloudUrl);
  if (!result.tracks || result.tracks.length === 0) {
    throw new Error('No tracks found for the provided SoundCloud URL');
  }
  const track = result.tracks[0];
  const downloadLinks = await getDownloadLinks(track.media, result.clientId);
  
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    url: track.url,
    duration: track.duration,
    downloadLinks
  };
}

module.exports = {
  search,
  getDownloadLinks,
  downloadDirect,
  getClientId
};

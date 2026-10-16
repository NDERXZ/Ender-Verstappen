const vm = require('node:vm');
const crypto = require('node:crypto');

async function scrapeSnapSave(targetUrl) {
    const body = new URLSearchParams();
    body.append('url', targetUrl.trim());

    const res = await fetch('https://snapsave.app/action.php?lang=en', {
        method: 'POST',
        headers: {
            'origin': 'https://snapsave.app',
            'referer': 'https://snapsave.app/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'accept': '*/*'
        },
        body: body
    });

    if (!res.ok) throw new Error(`SnapSave HTTP ${res.status}`);
    const text = await res.text();

    const ctx = {
        window: {},
        document: { getElementById: () => ({ value: '' }) },
        console: console,
        eval: (res) => res
    };
    vm.createContext(ctx);
    const decoded = vm.runInContext(text, ctx);
    if (!decoded || typeof decoded !== 'string') throw new Error('SnapSave unpack failed');

    const regexRapid = /https:\/\/d\.rapidcdn\.app\/v2\?[^"'\\]+/g;
    const matchesRapid = [...new Set((decoded.match(regexRapid) || []).map(u => u.replace(/&amp;/g, '&').replace(/\\/g, '')))];

    if (matchesRapid.length === 0) {
        const regexDirect = /https:\/\/[^"'\\]*(?:cdninstagram\.com|fbcdn\.net)[^"'\\]+/g;
        const matchesDirect = [...new Set((decoded.match(regexDirect) || []).map(u => u.replace(/&amp;/g, '&').replace(/\\/g, '')))];
        if (matchesDirect.length > 0) {
            return matchesDirect.map(url => ({
                type: /mp4|video/i.test(url) ? 'video' : 'image',
                url: url,
                backupUrl: url
            }));
        }
        throw new Error('SnapSave: tidak ada media ditemukan');
    }

    const results = [];
    for (const dlUrl of matchesRapid) {
        let directUrl = dlUrl;
        let type = 'video';
        try {
            const token = new URL(dlUrl).searchParams.get('token');
            if (token) {
                const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                if (payload.url) {
                    directUrl = payload.url;
                    if (/\.(jpg|jpeg|png|webp)/i.test(payload.url) || payload.filename?.endsWith('.jpg')) {
                        type = 'image';
                    }
                }
            }
        } catch (_) {}

        results.push({
            type,
            url: directUrl,
            backupUrl: dlUrl
        });
    }
    return results;
}

async function scrapeReelsVideo(targetUrl) {
    const ts = Math.floor(Date.now() / 1000);
    const tt = crypto.createHash('md5').update(ts + 'X-Fc-Pp-Ty-eZ').digest('hex');

    const body = new URLSearchParams();
    body.append('id', targetUrl.trim());
    body.append('locale', 'en');
    body.append('cf-turnstile-response', '');
    body.append('tt', tt);
    body.append('ts', ts.toString());

    const res = await fetch('https://reelsvideo.io/reel/DUU67gXiTwU/?igsh=MTZxdm1yd3pnN3Rvdg==/', {
        method: 'POST',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'hx-request': 'true',
            'hx-current-url': 'https://reelsvideo.io/',
            'hx-target': 'target',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Origin': 'https://reelsvideo.io',
            'Referer': 'https://reelsvideo.io/'
        },
        body: body
    });

    if (!res.ok) throw new Error(`ReelsVideo HTTP ${res.status}`);
    const html = await res.text();
    const results = [];

    const vidMatches = html.match(/class=["'][^"']*type_videos[^"']*["'][^>]*href=["']([^"']+)["']/g) || [];
    for (const m of vidMatches) {
        const h = m.match(/href=["']([^"']+)["']/);
        if (h && h[1]) results.push({ type: 'video', url: h[1], backupUrl: h[1] });
    }
    const imgMatches = html.match(/class=["'][^"']*type_images[^"']*["'][^>]*href=["']([^"']+)["']/g) || [];
    for (const m of imgMatches) {
        const h = m.match(/href=["']([^"']+)["']/);
        if (h && h[1]) results.push({ type: 'image', url: h[1], backupUrl: h[1] });
    }
    if (results.length === 0) throw new Error('ReelsVideo: media tidak ditemukan');
    return results;
}

async function scrapeBtch(targetUrl) {
    try {
        const btch = require('btch-downloader');
        if (typeof btch.igdl === 'function') {
            const res = await btch.igdl(targetUrl);
            if (Array.isArray(res) && res.length > 0) {
                return res.map(item => ({
                    type: (item.url && /\.mp4/i.test(item.url)) ? 'video' : 'image',
                    url: item.url || item.downloadUrl,
                    backupUrl: item.url || item.downloadUrl
                }));
            }
        }
    } catch (_) {}
    throw new Error('btch-downloader unavailable');
}

async function igdl(url) {
    let lastError = null;

    // 1. SnapSave (Primary - very fast and stable)
    try {
        const data = await scrapeSnapSave(url);
        if (data && data.length > 0) return { status: true, source: 'snapsave', data };
    } catch (e) {
        lastError = e;
    }

    // 2. ReelsVideo (Fallback 1)
    try {
        const data = await scrapeReelsVideo(url);
        if (data && data.length > 0) return { status: true, source: 'reelsvideo', data };
    } catch (e) {
        lastError = e;
    }

    // 3. btch-downloader (Fallback 2)
    try {
        const data = await scrapeBtch(url);
        if (data && data.length > 0) return { status: true, source: 'btch', data };
    } catch (e) {
        lastError = e;
    }

    return {
        status: false,
        message: lastError ? lastError.message : 'Gagal mengunduh media dari link Instagram.'
    };
}

module.exports = {
    igdl,
    scrapeSnapSave,
    scrapeReelsVideo,
    scrapeBtch
};
const axios = require('axios');
const cheerio = require('cheerio');
const vm = require('node:vm');

/**
 * Resolves short links (e.g. pin.it) to full pinterest.com/pin/... URL
 */
async function resolvePinterestUrl(rawUrl) {
    let url = rawUrl.trim();
    if (/pin\.it/i.test(url)) {
        try {
            const res = await axios.get(url, {
                maxRedirects: 5,
                validateStatus: status => status >= 200 && status < 400,
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });
            const finalUrl = res.request?.res?.responseUrl || res.request?.responseURL || res.config?.url || url;
            return finalUrl;
        } catch (e) {
            if (e.response?.headers?.location) {
                return e.response.headers.location;
            }
        }
    }
    return url;
}

/**
 * Method 1: Scrape Pinterest page directly
 */
async function scrapeDirect(targetUrl) {
    const headers = {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'referer': 'https://www.pinterest.com/'
    };

    const res = await axios.get(targetUrl, { headers, timeout: 15000 });
    const html = res.data;
    if (!html || typeof html !== 'string') throw new Error('Respon HTML kosong');

    const $ = cheerio.load(html);
    let videoUrl = null;
    let imageUrl = null;
    let title = $('meta[property="og:title"]').attr('content') || $('title').text() || 'Pinterest Media';
    title = title.replace(/ - Pinterest.*$/i, '').trim();

    // 1. Check LD+JSON
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).html());
            if (json['@type'] === 'VideoObject' && json.contentUrl) {
                videoUrl = json.contentUrl;
                if (json.name) title = json.name;
            }
            if (json.image) {
                const img = typeof json.image === 'string' ? json.image : (json.image.url || json.image[0]);
                if (img && !imageUrl) imageUrl = img;
            }
        } catch (_) {}
    });

    // 2. Check __PWS_DATA__ or __PWS_INITIAL_PROPS__
    const pwsScript = $('#__PWS_INITIAL_PROPS__').html() || $('#__PWS_DATA__').html();
    if (pwsScript && (!videoUrl || !imageUrl)) {
        try {
            const pwsJson = JSON.parse(pwsScript);
            const pins = pwsJson?.initialReduxState?.pins || pwsJson?.props?.initialReduxState?.pins;
            if (pins) {
                for (const pk of Object.keys(pins)) {
                    const pin = pins[pk];
                    if (pin?.videos?.video_list) {
                        const vl = pin.videos.video_list;
                        for (const q of ['V_720P', 'V_EXP7', 'V_480P', 'V_360P', 'V_HLSV4']) {
                            if (vl[q]?.url && vl[q].url.endsWith('.mp4')) {
                                videoUrl = vl[q].url;
                                break;
                            }
                        }
                    }
                    if (pin?.images?.orig?.url && !imageUrl) {
                        imageUrl = pin.images.orig.url;
                    }
                    if (pin?.title && title === 'Pinterest Media') title = pin.title;
                }
            }
        } catch (_) {}
    }

    // 3. Check OpenGraph tags
    if (!videoUrl) {
        videoUrl = $('meta[property="og:video"]').attr('content') ||
                   $('meta[property="og:video:secure_url"]').attr('content') ||
                   $('meta[name="twitter:player:stream"]').attr('content') || null;
    }
    if (!imageUrl) {
        imageUrl = $('meta[property="og:image"]').attr('content') || null;
        if (imageUrl) {
            imageUrl = imageUrl.replace(/\/\d+x\//, '/originals/');
        }
    }

    // 4. Regex fallback on raw HTML
    if (!videoUrl) {
        const vidMatch = html.match(/https:\/\/v1\.pinimg\.com\/videos\/mc\/[^\s"'<>]+\.mp4/);
        if (vidMatch) videoUrl = vidMatch[0];
    }
    if (!imageUrl) {
        const imgMatch = html.match(/https:\/\/i\.pinimg\.com\/originals\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/);
        if (imgMatch) imageUrl = imgMatch[0];
    }

    if (videoUrl) {
        return {
            type: 'video',
            url: videoUrl,
            title,
            source: targetUrl
        };
    }

    if (imageUrl) {
        return {
            type: 'image',
            url: imageUrl,
            title,
            source: targetUrl
        };
    }

    throw new Error('Tidak ditemukan media langsung di halaman Pinterest');
}

/**
 * Method 2: SaveFrom worker
 */
async function scrapeSaveFrom(targetUrl) {
    const body = new URLSearchParams({
        'sf_url': encodeURI(targetUrl),
        'sf_submit': '',
        'new': 2,
        'lang': 'id',
        'app': '',
        'country': 'id',
        'os': 'Windows',
        'browser': 'Chrome',
        'channel': ' main',
        'sf-nomad': 1
    });

    const { data } = await axios({
        url: 'https://worker.sf-tools.com/savefrom.php',
        method: 'POST',
        data: body,
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://id.savefrom.net',
            'referer': 'https://id.savefrom.net/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        timeout: 20000
    });

    let exec = '[]["filter"]["constructor"](b).call(a);';
    const modified = data.replace(exec, `\ntry {\ni++;\nif (i === 2) scriptResult = ${exec.split('.call')[0]}.toString();\nelse (\n${exec.replace(/;/, '')}\n);\n} catch {}`);
    const context = { scriptResult: '', i: 0 };
    vm.createContext(context);
    new vm.Script(modified).runInContext(context);

    const jsonStr = context.scriptResult.split('window.parent.sf.videoResult.show(')?.[1]?.split(');')?.[0];
    if (!jsonStr) throw new Error('SaveFrom payload kosong');
    const parsed = JSON.parse(jsonStr);

    if (parsed && Array.isArray(parsed.url) && parsed.url.length > 0) {
        const item = parsed.url[0];
        const isVid = /mp4|video/i.test(item.type || item.ext || item.name || '') || (item.url && item.url.includes('.mp4'));
        return {
            type: isVid ? 'video' : 'image',
            url: item.url,
            title: parsed.meta?.title || 'Pinterest Media',
            source: targetUrl
        };
    }
    throw new Error('SaveFrom tidak menemukan file');
}

/**
 * Method 3: btch-downloader
 */
async function scrapeBtch(targetUrl) {
    const btch = require('btch-downloader');
    if (typeof btch.pinterest === 'function') {
        const res = await btch.pinterest(targetUrl);
        if (res) {
            const vid = res.video || (typeof res.url === 'string' && res.url.includes('.mp4') ? res.url : null);
            const img = res.image || res.url || res.result;
            if (vid) {
                return {
                    type: 'video',
                    url: Array.isArray(vid) ? vid[0] : vid,
                    title: res.title || 'Pinterest Video',
                    source: targetUrl
                };
            }
            if (img) {
                return {
                    type: 'image',
                    url: Array.isArray(img) ? img[0] : img,
                    title: res.title || 'Pinterest Image',
                    source: targetUrl
                };
            }
        }
    }
    throw new Error('btch-downloader gagal mengambil media Pinterest');
}

/**
 * Main pindl function with multi-provider fallback
 */
async function pindl(url) {
    if (!url) {
        return {
            status: false,
            message: 'Masukkan link Pinterest!'
        };
    }

    let targetUrl = url.trim();
    try {
        targetUrl = await resolvePinterestUrl(targetUrl);
    } catch (_) {}

    let lastError = null;

    // 1. Direct Scrape
    try {
        const res = await scrapeDirect(targetUrl);
        if (res && res.url) return { status: true, source: 'direct', ...res };
    } catch (e) {
        lastError = e;
    }

    // 2. SaveFrom Worker
    try {
        const res = await scrapeSaveFrom(targetUrl);
        if (res && res.url) return { status: true, source: 'savefrom', ...res };
    } catch (e) {
        lastError = e;
    }

    // 3. btch-downloader
    try {
        const res = await scrapeBtch(targetUrl);
        if (res && res.url) return { status: true, source: 'btch', ...res };
    } catch (e) {
        lastError = e;
    }

    return {
        status: false,
        message: lastError ? lastError.message : 'Gagal mengunduh media dari link Pinterest.'
    };
}

module.exports = {
    pindl,
    resolvePinterestUrl,
    scrapeDirect,
    scrapeSaveFrom,
    scrapeBtch
};

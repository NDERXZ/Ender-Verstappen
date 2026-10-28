const fs = require('fs');
const path = require('path');
const axios = require('axios');
const moment = require('moment-timezone');
moment.locale('id');

const DB_DIR = './database';
const HISTORY_PATH = path.join(DB_DIR, 'mbg_history.json');
const TARGET_USERNAME = 'sppg_maguwoharjo3';

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_PATH)) {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify({ lastSentId: '', sentIds: [] }, null, 2));
}

function readHistory() {
    try {
        const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
        return JSON.parse(raw);
    } catch {
        return { lastSentId: '', sentIds: [] };
    }
}

function writeHistory(data) {
    try {
        fs.writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[MBG] Error writing history:', e.message);
    }
}

/**
 * Rekursif mencari data GraphQL tersemat dalam struktur __bbox Instagram
 */
function extractEmbeddedQueryData(obj, results = []) {
    if (!obj || typeof obj !== 'object') return results;
    if (Array.isArray(obj)) {
        for (const item of obj) extractEmbeddedQueryData(item, results);
        return results;
    }
    if (obj.__bbox?.result?.data) {
        results.push(obj.__bbox.result.data);
    }
    for (const key of Object.keys(obj)) {
        extractEmbeddedQueryData(obj[key], results);
    }
    return results;
}

/**
 * Mengambil daftar postingan terbaru dari akun Instagram
 * Menggunakan embed endpoint sebagai jalur utama (bebas login wall & anti 302)
 * Memfilter video / reels dan hanya mengambil postingan foto / carousel
 */
async function fetchMbgPosts(username = TARGET_USERNAME) {
    // ── Jalur 1: Instagram Profile Embed (Sangat stabil & bebas login wall) ──
    try {
        const embedUrl = `https://www.instagram.com/${encodeURIComponent(username)}/embed/`;
        const res = await axios.get(embedUrl, {
            headers: {
                'User-Agent': 'curl/7.81.0',
                'Accept': '*/*'
            },
            timeout: 15000
        });

        const html = res.data;
        if (html && typeof html === 'string') {
            const match = html.match(/["']contextJSON["']\s*:\s*("[^"\\]*(?:\\.[^"\\]*)*")/);
            if (match) {
                const parsedCtx = JSON.parse(JSON.parse(match[1]));
                const rawMedia = parsedCtx.context?.graphql_media || [];
                const validPhotoPosts = [];

                for (const item of rawMedia) {
                    const sm = item.shortcode_media;
                    if (!sm) continue;

                    // Filter video
                    const isVideo = Boolean(sm.is_video || sm.__typename === 'GraphVideo');
                    if (isVideo) continue;

                    // Cek gambar (jika carousel / sidecar, ambil slide non-video)
                    const images = [];
                    if (sm.__typename === 'GraphSidecar' || sm.edge_sidecar_to_children?.edges?.length) {
                        for (const edge of (sm.edge_sidecar_to_children?.edges || [])) {
                            const child = edge.node;
                            if (child && !child.is_video) {
                                const src = child.display_url || child.display_resources?.[child.display_resources.length - 1]?.src;
                                if (src) images.push(src);
                            }
                        }
                        // Jika semua slide berupa video, skip
                        if (images.length === 0) continue;
                    } else {
                        if (sm.display_url) {
                            images.push(sm.display_url);
                        } else if (sm.display_resources?.length) {
                            images.push(sm.display_resources[sm.display_resources.length - 1].src);
                        }
                    }

                    if (images.length === 0) continue;

                    const shortcode = sm.shortcode;
                    const caption = sm.edge_media_to_caption?.edges?.[0]?.node?.text || '';
                    const timestamp = sm.taken_at_timestamp ? sm.taken_at_timestamp * 1000 : Date.now();
                    const dateStr = moment(timestamp).tz('Asia/Jakarta').format('dddd, D MMMM YYYY | HH:mm [WIB]');

                    validPhotoPosts.push({
                        id: String(sm.id || shortcode),
                        shortcode,
                        url: `https://www.instagram.com/p/${shortcode}/`,
                        caption: caption.trim(),
                        accessibilityCaption: sm.accessibility_caption || '',
                        images,
                        timestamp,
                        dateStr
                    });
                }

                if (validPhotoPosts.length > 0) {
                    return validPhotoPosts;
                }
            }
        }
    } catch (e) {
        // Lanjut ke fallback jika jalur embed mengalami error
    }

    // ── Jalur 2: Web Profile HTML Fallback ──
    const headers = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cookie': 'sessionid=; mid=; ig_pr=1; ig_vw=1920; csrftoken=; s_network=; ds_user_id=;'
    };

    const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;
    const res = await axios.get(url, {
        headers,
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: s => s < 400
    });

    if (!res.data || typeof res.data !== 'string') {
        throw new Error('Gagal memuat halaman Instagram');
    }

    const jsonScripts = res.data.match(/<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    const allData = [];
    for (const tag of jsonScripts) {
        const jsonStr = tag.replace(/^<script\s+type="application\/json"[^>]*>/i, '').replace(/<\/script>$/i, '');
        try {
            allData.push(...extractEmbeddedQueryData(JSON.parse(jsonStr)));
        } catch {}
    }

    let timelineEdges = [];
    for (const block of allData) {
        const user = block.xig_user_by_username;
        if (user?.polaris_ordered_timeline_connection?.edges) {
            timelineEdges = user.polaris_ordered_timeline_connection.edges;
            break;
        }
        if (user?.edge_owner_to_timeline_media?.edges) {
            timelineEdges = user.edge_owner_to_timeline_media.edges;
            break;
        }
    }

    if (timelineEdges.length === 0) {
        throw new Error('Tidak dapat menemukan data timeline postingan pada profil Instagram.');
    }

    const validPhotoPosts = [];

    for (const edge of timelineEdges) {
        const node = edge.node;
        if (!node) continue;

        // FILTER: Lewati jika berupa video / Reels konten
        const isVideo = Boolean(
            node.is_video ||
            node.media_type === 2 ||
            node.__typename === 'XIGPolarisVideoMedia' ||
            node.__typename === 'GraphVideo' ||
            node.video_url
        );
        if (isVideo) {
            continue; // Filter agar video tidak terkirim
        }

        const shortcode = node.code || node.shortcode;
        const caption = typeof node.caption === 'string'
            ? node.caption
            : (node.caption?.text || node.edge_media_to_caption?.edges?.[0]?.node?.text || '');

        let timestamp = Date.now();
        if (node.taken_at) {
            timestamp = node.taken_at * 1000;
        } else if (node.taken_at_timestamp) {
            timestamp = node.taken_at_timestamp * 1000;
        } else if (node.pk) {
            try {
                timestamp = Number(BigInt(node.pk) >> 23n) + 1314220021000;
            } catch {
                timestamp = Date.now();
            }
        }

        const dateStr = moment(timestamp).tz('Asia/Jakarta').format('dddd, D MMMM YYYY | HH:mm [WIB]');

        const images = [];
        if (node.carousel_media && Array.isArray(node.carousel_media)) {
            for (const slide of node.carousel_media) {
                if (!slide.is_video) {
                    if (slide.display_uri) images.push(slide.display_uri);
                    else if (slide.image_versions2?.candidates?.[0]?.url) images.push(slide.image_versions2.candidates[0].url);
                }
            }
        }
        if (images.length === 0 && node.display_uri) {
            images.push(node.display_uri);
        } else if (images.length === 0 && node.image_versions2?.candidates?.[0]?.url) {
            images.push(node.image_versions2.candidates[0].url);
        } else if (images.length === 0 && node.display_url) {
            images.push(node.display_url);
        }

        if (images.length === 0) continue;

        validPhotoPosts.push({
            id: String(node.id || node.pk || shortcode),
            shortcode,
            url: `https://www.instagram.com/p/${shortcode}/`,
            caption: caption.trim(),
            accessibilityCaption: node.accessibility_caption || '',
            images,
            timestamp,
            dateStr
        });
    }

    return validPhotoPosts;
}

/**
 * Format pesan informasi MBG yang rapi & profesional
 */
function formatMbgCaption(post) {
    let captionText = post.caption ? post.caption.slice(0, 1000) : '';
    let visualDesc = '';
    if (post.accessibilityCaption) {
        const match = post.accessibilityCaption.match(/May be an image of (.+)/i);
        if (match) {
            visualDesc = `\n🔍 *Visual:* ${match[1].replace(/\.$/, '')}`;
        }
    }

    return (
`🍱 *INFORMASI MAKAN BERGIZI GRATIS (MBG)*
🏢 SPPG Maguwoharjo 3

📅 *Waktu:* ${post.dateStr}
🔗 *Tautan:* ${post.url}${visualDesc}

📝 *Detail Menu & Informasi:*
${captionText || 'Dokumentasi menu Makan Bergizi Gratis (MBG).'}`
    );
}

/**
 * Mengirim postingan MBG ke target JID (grup atau private)
 */
async function sendMbgToTarget(sock, targetJid, post) {
    if (!sock || !targetJid || !post) return false;

    const caption = formatMbgCaption(post);
    const primaryImg = post.images[0];

    try {
        if (primaryImg) {
            await sock.sendMessage(targetJid, {
                image: { url: primaryImg },
                caption: caption
            });
        } else {
            await sock.sendMessage(targetJid, { text: caption });
        }
        return true;
    } catch (err) {
        console.error(`[MBG] Gagal kirim ke ${targetJid}:`, err.message);
        return false;
    }
}

function markMbgAsSent(postId, targetGid = null) {
    if (!postId) return;
    const history = readHistory();
    if (!Array.isArray(history.sentIds)) history.sentIds = [];
    if (!history.sentPerGroup || typeof history.sentPerGroup !== 'object') history.sentPerGroup = {};

    if (!history.sentIds.includes(postId)) {
        history.sentIds.push(postId);
        if (history.sentIds.length > 50) history.sentIds = history.sentIds.slice(-50);
    }
    history.lastSentId = postId;
    if (targetGid) {
        history.sentPerGroup[targetGid] = postId;
    }
    writeHistory(history);
}

/**
 * Watcher berkala untuk Auto-MBG
 */
async function watcherMbg(sock) {
    if (!sock) return;

    // Ambil semua grup yang mengaktifkan autombg
    const _db = require('./db');
    const allGs = _db.gsLoadAll();
    const activeGroupJids = [];

    for (const [gid, s] of Object.entries(allGs)) {
        if (s && s.autombg === true) {
            activeGroupJids.push(gid);
        }
    }

    if (activeGroupJids.length === 0) {
        return; // Tidak ada grup yang mengaktifkan autombg
    }

    try {
        const posts = await fetchMbgPosts();
        if (!posts || posts.length === 0) return;

        const latest = posts[0];
        const history = readHistory();
        if (!Array.isArray(history.sentIds)) history.sentIds = [];
        if (!history.sentPerGroup || typeof history.sentPerGroup !== 'object') history.sentPerGroup = {};

        // Inisialisasi awal saat bot baru start: tandai post saat ini agar tidak membroadcast post lama
        if (!history.lastSentId) {
            history.lastSentId = latest.id;
            history.sentIds.push(latest.id);
            writeHistory(history);
            return;
        }

        // Cek apakah postingan ini sudah pernah dikirimkan secara global
        if (history.sentIds.includes(latest.id) || history.lastSentId === latest.id) {
            return;
        }

        // Filter grup yang belum menerima post ini
        const pendingGroups = activeGroupJids.filter(gid => history.sentPerGroup[gid] !== latest.id);
        if (pendingGroups.length === 0) {
            return;
        }

        console.log(`[MBG] Postingan baru terdeteksi: ${latest.shortcode}. Mengirim ke ${pendingGroups.length} grup...`);

        for (const gid of pendingGroups) {
            const ok = await sendMbgToTarget(sock, gid, latest);
            if (ok) {
                history.sentPerGroup[gid] = latest.id;
            }
            await new Promise(r => setTimeout(r, 2000)); // Jeda 2s antar grup
        }

        // Simpan ke riwayat
        history.lastSentId = latest.id;
        history.sentIds.push(latest.id);
        if (history.sentIds.length > 50) history.sentIds = history.sentIds.slice(-50);
        writeHistory(history);

    } catch (err) {
        console.error('[MBG Watcher] Polling error:', err.message);
    }
}

/**
 * Helper untuk test kirim HANYA ke nomor owner
 */
async function testMbgToOwner(sock) {
    if (!sock) throw new Error('Bot belum terhubung');

    const ownerNum = (global.nomorowner || global.owner?.[0] || '62895327468806').replace(/[^0-9]/g, '');
    const ownerJid = `${ownerNum}@s.whatsapp.net`;

    const posts = await fetchMbgPosts();
    if (!posts || posts.length === 0) {
        throw new Error('Tidak ada postingan foto MBG yang ditemukan.');
    }

    const latest = posts[0];
    const success = await sendMbgToTarget(sock, ownerJid, latest);
    return { success, ownerJid, post: latest };
}

module.exports = {
    fetchMbgPosts,
    formatMbgCaption,
    sendMbgToTarget,
    watcherMbg,
    testMbgToOwner,
    markMbgAsSent
};

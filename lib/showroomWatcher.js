const fs = require('fs')
const fetch = require('node-fetch')
const moment = require('moment-timezone')

const databasePath = './database/showroom_history.json'

if (!fs.existsSync('./database')) fs.mkdirSync('./database', { recursive: true })
if (!fs.existsSync(databasePath)) {
    fs.writeFileSync(databasePath, JSON.stringify({
        history: {},
        lastRecentId: ""
    }, null, 2))
}

// ====== Konfigurasi endpoint (sama kayak SHOWROOJKT48_REALTIME.js) ======
const SHOWROOM_LIVE_URL = process.env.SHOWROOM_LIVE_URL || "https://jkt48showroom-api.my.id/api/rooms/onlives"
const IDN_LIVE_URL = process.env.IDN_LIVE_URL || "https://jkt48showroom-api.my.id/api/idn_lives"
const RECENT_URL = process.env.RECENT_URL || "https://api.crstlnz.my.id/api/recent?group=jkt48&type=all"
const GIFT_BASE_URL = process.env.GIFT_BASE_URL || "https://jkt48showroom-api.my.id/api/rooms/total-rank"
const FETCH_TOTAL_GIFT = (process.env.FETCH_TOTAL_GIFT || 'true') !== 'false'

// ====== Helper DB (pola sama kayak jkt48show.js) ======
const getToday = () => moment().tz('Asia/Jakarta').format('YYYY-MM-DD')

const bacaDB = () => {
    try {
        const raw = fs.readFileSync(databasePath, 'utf8')
        const parsed = JSON.parse(raw)
        if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
        if (!parsed.history) parsed.history = {}
        if (!parsed.lastRecentId) parsed.lastRecentId = ''
        return parsed
    } catch {
        const defaultDB = { history: {}, lastRecentId: '' }
        tulisDB(defaultDB)
        return defaultDB
    }
}

const tulisDB = (data) => fs.writeFileSync(databasePath, JSON.stringify(data, null, 2))

const sudahTerkirim = (key) => {
    const db = bacaDB()
    const today = getToday()
    if (!db.history[today]) return false
    return db.history[today].includes(key)
}

const tambahTerkirim = (key) => {
    const db = bacaDB()
    const today = getToday()
    if (!Array.isArray(db.history[today])) db.history[today] = []
    if (!db.history[today].includes(key)) db.history[today].push(key)
    tulisDB(db)
}

const updateRecent = (id) => {
    const db = bacaDB()
    db.lastRecentId = id
    tulisDB(db)
}

// ====== Helper umum ======
const delay = ms => new Promise(r => setTimeout(r, ms))

const fetchJson = async (url) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} (${url})`)
    return await res.json()
}

const fetchJsonSafe = async (url) => {
    try {
        return await fetchJson(url)
    } catch (e) {
        console.log('[Showroom] Gagal fetch:', e.message)
        return null
    }
}

const formatWaktu = (t) => moment(t).tz('Asia/Jakarta').format('dddd, D MMMM YYYY | HH:mm:ss [WIB]')

const formatAngka = (n) => {
    if (n === null || n === undefined || n === '') return '-'
    const num = Number(n)
    return Number.isFinite(num) ? num.toLocaleString('id-ID') : String(n)
}

const durasi = (start, end) => {
    const ms = new Date(end) - new Date(start)
    if (!Number.isFinite(ms) || ms < 0) return '-'
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const firstDefined = (...values) => values.find(v => v !== undefined && v !== null && v !== '')

const firstArray = (value, depth = 0) => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== 'object' || depth > 5) return []
    const preferredKeys = ['data', 'rooms', 'onlives', 'lives', 'recents', 'result', 'items']
    for (const key of preferredKeys) {
        if (key in value) {
            const found = firstArray(value[key], depth + 1)
            if (found.length || Array.isArray(value[key])) return found
        }
    }
    for (const child of Object.values(value)) {
        const found = firstArray(child, depth + 1)
        if (found.length) return found
    }
    return []
}

// ====== Normalisasi data mentah (diadaptasi dari SHOWROOJKT48_REALTIME.js) ======
const normalizeShowroom = (item) => {
    const info = item?.room_info || item?.room || {}
    const member = item?.member || {}
    const roomId = firstDefined(item?.room_id, item?.roomId, info?.room_id, info?.roomId, item?.id)
    const roomKey = firstDefined(item?.room_url_key, item?.room_url, item?.room_name, info?.room_url_key, info?.room_url, info?.room_name, item?.url)
    const name = firstDefined(item?.name, item?.nickname, item?.member_name, member?.nickname, member?.name, info?.nickname, info?.name, roomKey, `Room ${roomId ?? 'unknown'}`)
    return {
        platform: 'showroom',
        name: String(name),
        roomId: roomId == null ? null : String(roomId),
        roomKey: roomKey == null ? null : String(roomKey),
        viewers: firstDefined(item?.viewers, item?.view_count, item?.view_num, info?.viewers, info?.view_count) ?? null,
        startedAt: firstDefined(item?.started_at, item?.start_time, item?.live_info?.date?.start) ?? null,
        imageUrl: firstDefined(item?.image_url, item?.image, member?.image, info?.image) ?? null,
        url: roomKey ? `https://www.showroom-live.com/r/${encodeURIComponent(roomKey)}` : null,
    }
}

const normalizeIdn = (item) => {
    const user = item?.user || {}
    const username = firstDefined(user?.username, item?.username)
    const slug = firstDefined(item?.slug, item?.live_slug)
    return {
        platform: 'idn',
        name: String(firstDefined(user?.name, item?.name, username, 'IDN Live')),
        username: username == null ? null : String(username),
        slug: slug == null ? null : String(slug),
        viewers: firstDefined(item?.view_count, item?.viewers, item?.viewers_count) ?? null,
        startedAt: firstDefined(item?.live_at, item?.started_at) ?? null,
        title: firstDefined(item?.title, '') || '',
        imageUrl: firstDefined(item?.image, user?.avatar) ?? null,
        status: firstDefined(item?.status, 'live'),
        url: username && slug ? `https://www.idn.app/${encodeURIComponent(username)}/live/${encodeURIComponent(slug)}` : null,
    }
}

const normalizeRecent = (item) => {
    const member = item?.member || {}
    const liveInfo = item?.live_info || {}
    const viewers = liveInfo?.viewers || {}
    return {
        id: String(firstDefined(item?._id, item?.data_id, item?.id, `${member?.url || member?.nickname || 'unknown'}-${liveInfo?.date?.start || 'unknown'}`)),
        platform: item?.type === 'idn' ? 'idn' : 'showroom',
        nickname: String(firstDefined(member?.nickname, member?.name, member?.url, 'Unknown')),
        startedAt: liveInfo?.date?.start || null,
        endedAt: liveInfo?.date?.end || null,
        viewers: firstDefined(viewers?.num, liveInfo?.viewers, liveInfo?.view_count) ?? null,
        points: firstDefined(item?.points, item?.point) ?? null,
    }
}

const normalizeGift = (payload) => {
    const rows = firstArray(payload)
    if (!rows.length) return null
    const totalPoints = rows.reduce((sum, item) => {
        const p = Number(firstDefined(item?.point, item?.points, item?.gift_point, item?.total_point))
        return sum + (Number.isFinite(p) ? p : 0)
    }, 0)
    return totalPoints || null
}

const ambilTotalGift = async (roomId) => {
    if (!FETCH_TOTAL_GIFT || !roomId) return null
    const payload = await fetchJsonSafe(`${GIFT_BASE_URL}/${encodeURIComponent(roomId)}`)
    return payload ? normalizeGift(payload) : null
}

// ====== Watcher utama (dipanggil dari index.js pas connection === 'open') ======
const watcherShowroom = async (Cantarella, chats = []) => {
    // --- Showroom & IDN yang lagi live ---
    const [showroomRaw, idnRaw] = await Promise.all([
        fetchJsonSafe(SHOWROOM_LIVE_URL),
        fetchJsonSafe(IDN_LIVE_URL),
    ])

    const showroomLive = firstArray(showroomRaw).map(normalizeShowroom)
    const idnLive = firstArray(idnRaw).map(normalizeIdn).filter(i => i.status === 'live')
    const semuaLive = [...showroomLive, ...idnLive]

    for (const data of semuaLive) {
        const key = data.platform === 'showroom'
            ? `showroom:${data.roomId || data.roomKey}`
            : `idn:${data.username}:${data.slug}`

        if (sudahTerkirim(key)) continue

        const totalGift = data.platform === 'showroom' ? await ambilTotalGift(data.roomId) : null

        const lines = [
            `🎥 ${data.name} sedang LIVE (${data.platform.toUpperCase()})!`,
            '',
        ]
        if (data.title) lines.push(`📝 ${data.title}`)
        lines.push(`👥 Penonton: ${formatAngka(data.viewers)}`)
        if (totalGift != null) lines.push(`🎁 Total Gift: ${formatAngka(totalGift)}G (± Rp ${(totalGift * 2500).toLocaleString('id-ID')})`)
        lines.push(`📅 ${formatWaktu(new Date())}`)
        lines.push('')
        lines.push(`🔗 ${data.url || '-'}`)

        const pesan = lines.join('\n')

        for (let jid of chats) {
            if (data.imageUrl) {
                await Cantarella.sendMessage(jid, {
                    image: { url: data.imageUrl },
                    caption: pesan,
                    mimetype: 'image/jpeg'
                })
            } else {
                await Cantarella.sendMessage(jid, { text: pesan })
            }
            await delay(1000)
        }

        tambahTerkirim(key)
    }

    // --- Live yang baru aja berakhir ---
    const db = bacaDB()
    const recentRaw = await fetchJsonSafe(RECENT_URL)
    const recentList = firstArray(recentRaw?.recents ? recentRaw.recents : recentRaw).map(normalizeRecent)
    const last = recentList[0]

    if (last && db.lastRecentId !== last.id) {
        const lines = [
            `🔴 Live ${last.platform.toUpperCase()} ${last.nickname} telah berakhir.`,
            '',
            `🕒 Durasi: ${durasi(last.startedAt, last.endedAt)}`,
            `🗓️ ${formatWaktu(last.startedAt)} ➡️ ${formatWaktu(last.endedAt)}`,
            '',
            `👥 ${formatAngka(last.viewers)} penonton`,
        ]
        if (last.points != null) lines.push(`🎁 ${formatAngka(last.points)}G (± Rp ${(Number(last.points) * 2500).toLocaleString('id-ID')})`)

        const endMsg = lines.join('\n')

        for (let jid of chats) {
            await Cantarella.sendMessage(jid, { text: endMsg })
            await delay(1000)
        }

        updateRecent(last.id)
    }
}

module.exports = { watcherShowroom }

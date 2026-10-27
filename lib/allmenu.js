const fs = require('fs')
const axios = require('axios')

let _cachedTotalCmd = null
function _getTotalCmd() {
    if (_cachedTotalCmd !== null) return _cachedTotalCmd
    try {
        const _mMainFile = global.mainFile || './Cantarella.js'
        if (fs.existsSync(_mMainFile)) {
            const _mContent = fs.readFileSync(_mMainFile, 'utf8')
            const _mMatches = _mContent.match(/^\s*case\s+'[^']+'/gm) || []
            _cachedTotalCmd = _mMatches.length || '150+'
        } else {
            _cachedTotalCmd = '150+'
        }
    } catch (e) {
        _cachedTotalCmd = '150+'
    }
    return _cachedTotalCmd
}

const _mcAllCats = {
    main: {
        emoji:'🏠', label:'MAIN', desc:'Command utama & monitoring bot',
        cmds:['menu','help','ping','mcstatus','tps','setmc','status','speed','owner','ceksewa','bothealth','antibanstatus','safemode','warmupstatus','queuestatus','securityreport','auditlog','incidents','delayanalytics','forensiclog','reconnectstatus']
    },
    download: {
        emoji:'📥', label:'DOWNLOAD', desc:'Downloader berbagai platform',
        cmds:['tt','tiktok','ttmp3','igdl','fbdl','fbhd','ytmp3','ytmp4','ytplay','ytp','youtube','yt','spotify','spot','threads','mediafire','capcut','soundcloud','sc','scplay','terabox','tb','snackvideodl','svdl','pixeldraindl','pdl','videy','videydl','pindl','pinterestdl']
    },
    hiburan: {
        emoji:'🎮', label:'HIBURAN', desc:'Fun, sticker & hiburan',
        cmds:['sticker','s','toimg','attp','ttp','quotesimage','wallpaper','emojimix','ship','shipping','truth','truthq','dare','tantang','confess','menfess','soulmatch','match','cekkhodam','khodam','rate','nilai','apakah','apa','akankah','akan','mimpiworld','dream','siapa','who','puisi','sajak']
    },
    tts: {
        emoji:'🎤', label:'TTS', desc:'Text to Speech berbagai karakter',
        cmds:['tts','say','ttsgoku','ttseminem','ttsmickey','ttsnahida','ttselon','ttsoptimus']
    },
    game: {
        emoji:'🎲', label:'GAME', desc:'Game interaktif di grup',
        cmds:['tebakkata','tebakword','susunkata','scramble','caklontong','cak','suit','rps']
    },
    stalker: {
        emoji:'🔍', label:'STALKER', desc:'Cek info akun sosmed & game',
        cmds:['igstalk','instagramstalk','tiktokstalk','ttstalk','ffstalk','stalkff','githubstalk','ghstalk']
    },
    cek: {
        emoji:'🎯', label:'CEK', desc:'Cek kepribadian & karakter',
        cmds:['cekcantik','cantik','cekganteng','ganteng','cekwibu','wibu','cekotaku','otaku','cekgamer','gamer','cekhoki','hoki','ceksial','sial','cekrezeki','rezeki','ceksetia','setia','cekbucin','bucin','cekgila','gila','cekmalas','malas']
    },
    primbon: {
        emoji:'🔮', label:'PRIMBON', desc:'Zodiak, mimpi & arti nama',
        cmds:['zodiak','horoscope','tafsirmimpi','mimpi','artinama','namameaning']
    },
    audio: {
        emoji:'🎵', label:'AUDIO FX', desc:'Efek suara dengan FFmpeg',
        cmds:['nightcore','nc','bass','bassboost','slow','slowed','fast','speed','robot','robotvoice','reverse','balik','earrape','loud','echo','gema','tupai','chipmunk']
    },
    canvas: {
        emoji:'🖼️', label:'CANVAS', desc:'Efek gambar & fake generator',
        cmds:['wanted','wantedposter','wasted','gta','jail','penjara','ektp','ktp','fakediscord','fakedc']
    },
    ephoto: {
        emoji:'✨', label:'EPHOTO', desc:'Efek teks dari ephoto360.com',
        cmds:['glitchtext','neonglitch','glowingtext','gradienttext','luxurygold','watercolortext','galaxystyle','summerbeach','royaltext','effectclouds','rainytext','cartoonstyle','papercutstyle','underwatertext','pixelglitch']
    },
    religi: {
        emoji:'🕌', label:'RELIGI', desc:'Jadwal sholat, doa & islami',
        cmds:['jadwalsholat','sholat2','asmaulhusna','asmaul','kisahnabi','nabi','doa','doaharian']
    },
    user: {
        emoji:'👤', label:'USER', desc:'Profil, level, koin & leaderboard',
        cmds:['profile','profil','daily','claim','exp','xp','koin','saldo','leaderboard','top']
    },
    search: {
        emoji:'🔎', label:'SEARCH', desc:'Brainly, Wattpad, bola & puisi',
        cmds:['brainly','brain','wattpad','jadwalbola','bola','puisi','sajak']
    },
    utility: {
        emoji:'🛠️', label:'UTILITY', desc:'Tools berguna sehari-hari',
        cmds:['ocr','readtext','wikipedia','wiki']
    },
    tools: {
        emoji:'🔧', label:'TOOLS', desc:'Utilitas & curl tools',
        cmds:['curl','download','npm','install','backup','autobackup','checklink','ceklink','delayanalytics','killswitch','resetwarn','fakedana','fakeff','fakejago','fakeovo','ampremium','amverify']
    },
    sewa: {
        emoji:'💰', label:'SEWA', desc:'Manajemen sewa bot',
        cmds:['ceksewa','addsewa','delsewa','extsewa','listsewa','sewa','invoice','inv']
    },
    statistik: {
        emoji:'📊', label:'STATISTIK', desc:'Statistik grup & keamanan',
        cmds:['statsgrup','groupstats','resetstats','reputation','rep','replist','bothealth','incidents','securitydashboard']
    },
    ai: {
        emoji:'🤖', label:'AI CHAT', desc:'Berbagai model AI chat',
        cmds:['chatgpt','openai','gptfree','freegpt','gptdemo','gpt4o','onlinegpt','gptlogin','gptchatly','gptonl','aichatfree','aifree','freechat','gptnet','deepseek','deepseekai','deepseekv3','deepseekr1','dsr1','gemini','geminiai','geminipro','geminiflash','geminithink','geminisearch','geminicode','learnlm','testgemini','groq','groqai','llama','llamaai','llamacode','mixtral','mixtralai','qwen','qwenai','gemma','gemmaai','mistralgroq','codechat','codeai','ai4chat','aichat','talkai','dola','cici','glm4','gitagpt','muslimai','mathgpt','dolphin','dolphinai','deepai2']
    },
    aiimg: {
        emoji:'🎨', label:'AI IMAGE', desc:'Generate & edit gambar dengan AI',
        cmds:['txt2img','imagine','animegen','aianimegen','sora2','soraai','nanobanana','imgedit','removebg','nobg','toghibli','ghiblistyle','toanime','animefy','toblack','tohitam','tochibi','chibistyle','tofigure','figurestyle','tofigurev2','tohijab','hijabstyle','tojapanese','japanesestyle','tomekah','meccabg','toemotebatu','to3d','3dfy','tocartoon','cartoonify','tomanga','mangafy','tooilpainting','oilpainting','tofigurine','figurine']
    },
    sticker: {
        emoji:'🪄', label:'STICKER', desc:'Buat & edit sticker kreatif',
        cmds:['sticker','s','toimg','attp','ttp','brat','bratvid','bratvideo','furbrat','removebg','nobg','emojimix','quotesimage','wallpaper','colongsw','pinterest']
    },
    grup: {
        emoji:'👥', label:'GRUP', desc:'Manajemen anggota & pengaturan grup',
        cmds:['promote','jadiadmin','demote','turonadmin','kick','keluarkan','kickall','add','tambah','kickinactive','cleangrup','tagall','everyone','hidetag','h','delete','del','setname','setnamegc','setdesc','cleardesc','infogc','groupinfo','setppgc','fotogrup','copygc','copymember','curimember','stealmbr','pin','pinpesan','unpin','unpinpesan','revoke','resetlink','setjoin','joinapproval','slowmode','proteksi','lockgrup','lockprofile','autoswgc','backupgrup','gpanel','topaktif','topmember','inaktif','memberinaktif','adminonly','onlyadmin','autombg','mbg']
    },
    proteksi: {
        emoji:'🛡️', label:'PROTEKSI', desc:'Sistem proteksi & moderasi grup',
        cmds:['addblacklist','removeblacklist','listblacklist','antinsfw','antiocrlink','antiocrtext','antiraid','antilink','antilinkWA','antispam','antivortex','antiautobot','antiimage','antivideo','antidocument','antisticker','antiforward','warn','setwarn','maxwarn','listwarn','resetwarn','shadowban','sban','unshadowban','listshadowban','captcha','inviteguard','setantiraid','setantinsfw','infouser','whois']
    },
    security: {
        emoji:'🔐', label:'SECURITY', desc:'Keamanan lanjutan & forensik',
        cmds:['firewall','honeypot','lockdown','quarantine','threatintel','escalation','fullbackupsec','twofactor','2fa','trusteddevice','vault','messagevault','cmdacl','accesscontrol','sandboxscan','deeplink','linkanalysis','floodforensic','anomalycorrelation','mediascan','integritycheck','integritycek','rolehierarchy','repdecay','idlestatus','anomalystatus','forensicsearch','sessionhealth2','presencestatus','entropystatus','contentstatus','interactionstatus','degradationstatus','circadianstatus','poissoncheck','antiqueue','pausequeue','resumequeue']
    },
    doctor: {
        emoji:'🩺', label:'DOCTOR', desc:'AutoDoctor, health & diagnostik',
        cmds:['doctor','healthcheck','errorlog','autofix','sysinfo','repairlog','healthlog','bothealth','cekbot','sessionhealth','antibanstatus','safemode','warmupstatus','queuestatus','reconnectstatus','delayanalytics','forensiclog','circadianstatus','poissoncheck','degradationstatus','entropystatus']
    },
    rpg: {
        emoji:'⚔️', label:'RPG', desc:'Game RPG & kartu profil interaktif',
        cmds:['rpg','rpgmenu','rpgprofile','rpgstats','usercard','kartu','minicard','mc','mycard','profile','profil','daily','claim','exp','xp','koin','saldo','leaderboard','top','readvo','rvo','afk']
    },
    owner: {
        emoji:'👑', label:'OWNER', desc:'Panel khusus owner bot', ownerOnly: true,
        cmds:['addblacklist','removeblacklist','listblacklist','setmc','addcase','approvecase','editcase','previewcase','cancelcase','listcase','rollbackcase','historycase','delcase','hapuscase','eval','ev','restart','self','public','npm','install','killswitch','safemode','addsewa','delsewa','extsewa','listsewa','addpremium','addprem','delpremium','delprem','listpremium','addowner','delowner','listowner','ban','unban','listban','backup','autobackup','backupdb','broadcast','bc','bcimg','setppbot','setnamebot','setbio','join','leave','block','unblock','addnomer','delnomer','curl','download','checklink','delayanalytics','forensiclog','auditlog','antibanstatus','warmupstatus','queuestatus','reconnectstatus']
    }
}

function _toSmallCaps(str) {
    const map = {'a':'ᴀ','b':'ʙ','c':'ᴄ','d':'ᴅ','e':'ᴇ','f':'ꜰ','g':'ɢ','h':'ʜ','i':'ɪ','j':'ᴊ','k':'ᴋ','l':'ʟ','m':'ᴍ','n':'ɴ','o':'ᴏ','p':'ᴘ','q':'ǫ','r':'ʀ','s':'ꜱ','t':'ᴛ','u':'ᴜ','v':'ᴠ','w':'ᴡ','x':'x','y':'ʏ','z':'ᴢ',' ':' '}
    return str.toLowerCase().split('').map(c => map[c] || c).join('')
}

function _toBoldSans(str) {
    const chars = {
        'A':'𝗔','B':'𝗕','C':'𝗖','D':'𝗗','E':'𝗘','F':'𝗙','G':'𝗚','H':'𝗛','I':'𝗜','J':'𝗝','K':'𝗞','L':'𝗟','M':'𝗠',
        'N':'𝗡','O':'𝗢','P':'𝗣','Q':'𝗤','R':'𝗥','S':'𝗦','T':'𝗧','U':'𝗨','V':'𝗩','W':'𝗪','X':'𝗫','Y':'𝗬','Z':'𝗭',
        'a':'𝗮','b':'𝗯','c':'𝗰','d':'𝗱','e':'𝗲','f':'𝗳','g':'𝗴','h':'𝗵','i':'𝗶','j':'𝗷','k':'𝗸','l':'𝗹','m':'𝗺',
        'n':'𝗻','o':'𝗼','p':'𝗽','q':'𝗾','r':'𝗿','s':'𝘀','t':'𝘁','u':'𝘂','v':'𝘃','w':'𝘄','x':'𝘅','y':'𝘆','z':'𝘇',
        '0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵'
    }
    return (str || '').split('').map(c => chars[c] || c).join('')
}

function _renderCat(k, prefix) {
    const c = _mcAllCats[k]
    if (!c) return ''
    let t = `╔═ ${c.emoji} ${_toBoldSans(c.label)} ✦\n`
    for (const cmd of c.cmds) t += `║ » ${prefix}${cmd}\n`
    t += `╚═════`
    return t
}

global.allmenuCantarella = (prefix, isOwner) => {
    const _mBot   = global.namaBot   || 'Ender Verstappen'
    const _mOwner = global.namaowner || 'Chaidar'
    const _mUp    = Math.floor(process.uptime())
    const _mUpD   = Math.floor(_mUp / 86400)
    const _mUpH   = Math.floor((_mUp % 86400) / 3600)
    const _mUpM   = Math.floor((_mUp % 3600) / 60)
    const _mUpS   = Math.floor(_mUp % 60)
    const _mRam   = (process.memoryUsage().rss / 1048576).toFixed(1)
    const _mJam   = new Date().toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Jakarta' })
    const _mTgl   = new Date().toLocaleDateString('id-ID', { weekday:'long', day:'2-digit', month:'long', year:'numeric', timeZone:'Asia/Jakarta' })

    const _mCreatorName = _mOwner.toLowerCase() === 'chaidar' ? 'Chaidar//ENDERTURU' : _mOwner
    const _mOwnerNum = (global.nomorowner || (Array.isArray(global.owner) ? global.owner[0] : global.owner) || '').replace(/[^0-9]/g, '')
    const _mBotSmall = _toSmallCaps(_mBot)
    const _mUpStr = `${_mUpD}h ${_mUpH}j ${_mUpM}m`

    const _visibleCats = Object.keys(_mcAllCats).filter(k => !(_mcAllCats[k].ownerOnly && !isOwner))

    let t = ''

t += `ᴀɴᴅᴀ sᴇᴅᴀɴɢ ᴍᴇɴɢɢᴜɴᴀᴋᴀɴ ${_mBotSmall}

ʙᴏᴛ ɪɴɪ ᴅɪ ᴄɪᴘᴛᴀᴋᴀɴ ᴜɴᴛᴜᴋ ᴍᴇᴍᴘᴇʀᴍᴜᴅᴀʜ ᴘᴇᴋᴇʀᴊᴀᴀɴ ᴍᴀɴᴜsɪᴀ ᴅᴇɴɢᴀɴ ʙᴇʀʙᴀɢᴀɪ ғɪᴛᴜʀ ᴅᴀɴ sɪsᴛᴇᴍ ᴏᴛᴏᴍᴀᴛɪsᴀsɪ

ɢᴜɴᴀᴋᴀɴ ${prefix}ᴀʟʟᴍᴇɴᴜ ᴜɴᴛᴜᴋ ᴍᴇɴᴀᴍᴘɪʟᴋᴀɴ ꜱᴇᴍᴜᴀ ᴄᴏᴍᴍᴀɴᴅ ʙᴏᴛ

ᴊɪᴋᴀ ᴍᴇɴᴇᴍᴜᴋᴀɴ ᴍᴀsᴀʟᴀʜ sɪʟᴀʜᴋᴀɴ ʜᴜʙᴜɴɢɪ ${prefix}ᴏᴡɴᴇʀ

╔═══〖 *ʙ ᴏ ᴛ - ɪ ɴ ғ ᴏ* 〗═══
╠═ 👤 *ɴᴀᴍᴇ*
║ ${_mBot}
╠═ 👑 *ᴄʀᴇᴀᴛᴏʀ*
║ ${_mCreatorName}
╠═ 📞 *ᴏᴡɴᴇʀ*
║ @${_mOwnerNum}
╠═ ⚡ *ᴜᴘᴛɪᴍᴇ*
║ ${_mUpStr}
╠═ 💾 *ʀᴀᴍ*
║ ${_mRam} ᴍʙ
╠═ 🧩 *ғɪᴛᴜʀ*
║ 1578 sᴄʀᴀᴘᴇ ᴏɴʟʏ
╚═══════════════════

🕐 ${_mJam} ᴡɪʙ
📅 ${_mTgl}

✨ ᴘɪʟɪʜ ᴍᴇɴᴜ ʏᴀɴɢ ᴋᴀᴍᴜ ʙᴜᴛᴜʜᴋᴀɴ,
ᴅᴀɴ ɴɪᴋᴍᴀᴛɪ ᴘᴇɴɢᴀʟᴀᴍᴀɴɴʏᴀ.\n\n`

    for (const k of _visibleCats) {
        t += _renderCat(k, prefix) + '\n\n'
    }

    t += `> ✦ _Gunakan tombol di bawah untuk navigasi cepat_`
    return t
}

global.mainmenuCantarella      = (prefix) => _renderCat('main', prefix)
global.downloadmenuCantarella  = (prefix) => _renderCat('download', prefix)
global.hiburanmenuCantarella   = (prefix) => _renderCat('hiburan', prefix)
global.ttsmenuCantarella       = (prefix) => _renderCat('tts', prefix)
global.gamemenuCantarella      = (prefix) => _renderCat('game', prefix)
global.stalkermenuCantarella   = (prefix) => _renderCat('stalker', prefix)
global.cekmenuCantarella       = (prefix) => _renderCat('cek', prefix)
global.primbonmenuCantarella   = (prefix) => _renderCat('primbon', prefix)
global.audiomenuCantarella     = (prefix) => _renderCat('audio', prefix)
global.canvasmenuCantarella    = (prefix) => _renderCat('canvas', prefix)
global.ephotomenuCantarella    = (prefix) => _renderCat('ephoto', prefix)
global.religimenuCantarella    = (prefix) => _renderCat('religi', prefix)
global.usermenuCantarella      = (prefix) => _renderCat('user', prefix)
global.searchmenuCantarella    = (prefix) => _renderCat('search', prefix)
global.utilitymenuCantarella   = (prefix) => _renderCat('utility', prefix)
global.toolsmenuCantarella     = (prefix) => _renderCat('tools', prefix)
global.sewamenuCantarella      = (prefix) => _renderCat('sewa', prefix)
global.statistikmenuCantarella = (prefix) => _renderCat('statistik', prefix)
global.aimenuCantarella        = (prefix) => _renderCat('ai', prefix)
global.aiimgmenuCantarella     = (prefix) => _renderCat('aiimg', prefix)
global.stickermenuCantarella   = (prefix) => _renderCat('sticker', prefix)
global.grupmenuCantarella      = (prefix) => _renderCat('grup', prefix)
global.proteksimenuCantarella  = (prefix) => _renderCat('proteksi', prefix)
global.securitymenuCantarella  = (prefix) => _renderCat('security', prefix)
global.doctormenuCantarella    = (prefix) => _renderCat('doctor', prefix)
global.rpgmenuCantarella       = (prefix) => _renderCat('rpg', prefix)
global.ownermenuCantarella     = (prefix) => _renderCat('owner', prefix)

async function sendAllMenu(bulter, m, prefix, pushname, isOwner, isCreator, isPremium = false) {
    try { await bulter.sendMessage(m.chat, { react: { text: '⚡', key: m.key } }) } catch {}

    let _genMsg, _prepMedia
    try {
        const _bl  = require('@whiskeysockets/baileys')
        _genMsg    = _bl.generateWAMessageFromContent
        _prepMedia = _bl.prepareWAMessageMedia
    } catch (e) {
        console.error('[allmenu] gagal load baileys:', e.message)
    }

    // ── Variabel dasar ──
    const _mBot      = global.namaBot     || 'Ender Verstappen'
    const _mOwner    = global.namaowner   || 'Chaidar'
    const _mPrefix   = prefix
    const _mSaluran  = global.linkSaluran || 'https://whatsapp.com/channel/'
    const _mOwnerNum = (global.nomorowner || (Array.isArray(global.owner) ? global.owner[0] : global.owner) || '').replace(/[^0-9]/g, '')
    const _mOwnerWa  = `https://wa.me/${_mOwnerNum}`
    const _mNewsJid  = global.saluranId || global.idch || '120363407326732377@newsletter'
    const _mNewsName = global.saluranName || _mBot
    const _mCreatorName = _mOwner.toLowerCase() === 'chaidar' ? 'Chaidar//ENDERTURU' : _mOwner

    // ── Mentions (user + owner) ──
    const _mMentions = [m.sender]
    if (_mOwnerNum) {
        const _mOwnerJid = `${_mOwnerNum}@s.whatsapp.net`
        if (!_mMentions.includes(_mOwnerJid)) _mMentions.push(_mOwnerJid)
    }

    // ── Role user ──
    const _mRole = isOwner || isCreator ? `👑 Owner`
                 : isPremium            ? `💎 Premium`
                 : `👤 User Biasa`

    // ── Runtime & memory ──
    const _mUp    = Math.floor(process.uptime())
    const _mUpD   = Math.floor(_mUp / 86400)
    const _mUpH   = Math.floor((_mUp % 86400) / 3600)
    const _mUpM   = Math.floor((_mUp % 3600) / 60)
    const _mRam   = (process.memoryUsage().rss / 1048576).toFixed(1)
    const _mUpStr = `${_mUpD}h ${_mUpH}j ${_mUpM}m`

    // ── Hitung total command (menggunakan cache memory agar instan 0ms) ──
    const _mTotalCmd = _getTotalCmd()

    // ── Jam & tanggal (Asia/Jakarta) ──
    const _mNow  = new Date()
    const _mJam  = _mNow.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
    const _mTgl  = _mNow.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
    const _mHour = parseInt(_mNow.toLocaleTimeString('id-ID', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }))
    const _mSapa = _mHour >= 4 && _mHour < 11  ? 'Pagi'
                 : _mHour >= 11 && _mHour < 15 ? 'Siang'
                 : _mHour >= 15 && _mHour < 18 ? 'Sore'
                 : 'Malam'

    // ── Header umum axios (hindari 403 dari host yang nolak request tanpa User-Agent) ──
    const _mAxiosHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/*,video/*,*/*;q=0.8'
    }

    // ── Media Menu: Prioritaskan gambar banner lokal untuk kecepatan instan & stabil (seperti di .menu) ──
    let _mThumbBuf = null
    let _mIsGif    = false

    const _localCandidates = [
        global.menuBg,
        global.thumnail2,
        global.defaultThumb,
        './assets/banner.jpg',
        './assets/thumb.jpg'
    ]
    for (const loc of _localCandidates) {
        if (loc && typeof loc === 'string' && fs.existsSync(loc)) {
            try {
                _mThumbBuf = fs.readFileSync(loc)
                _mIsGif = false
                break
            } catch {}
        }
    }

    if (!_mThumbBuf && global.menuGif && typeof global.menuGif === 'string' && fs.existsSync(global.menuGif)) {
        try {
            _mThumbBuf = fs.readFileSync(global.menuGif)
            _mIsGif = true
        } catch {}
    }

    // Fallback remote HANYA jika diset di settings dan berupa URL http/https
    if (!_mThumbBuf) {
        const _mGifUrl = global.menuGif
        if (_mGifUrl && /^https?:\/\//i.test(_mGifUrl)) {
            try {
                const _mGifRes = await axios.get(_mGifUrl, { responseType: 'arraybuffer', timeout: 4000, headers: _mAxiosHeaders })
                _mThumbBuf = Buffer.from(_mGifRes.data)
                _mIsGif = true
            } catch {}
        }
        const _mRemoteUrl = (typeof global.thumnail2 === 'string' && /^https?:\/\//i.test(global.thumnail2)) ? global.thumnail2 : null
        if (!_mThumbBuf && _mRemoteUrl) {
            try {
                const _mImgRes = await axios.get(_mRemoteUrl, { responseType: 'arraybuffer', timeout: 4000, headers: _mAxiosHeaders })
                _mThumbBuf = Buffer.from(_mImgRes.data)
                _mIsGif = false
            } catch {}
        }
    }

    // Cadangan lokal terakhir jika semua gagal
    if (!_mThumbBuf) {
        if (fs.existsSync('./assets/banner.jpg')) {
            try { _mThumbBuf = fs.readFileSync('./assets/banner.jpg'); _mIsGif = false; } catch {}
        } else if (fs.existsSync('./assets/thumb.jpg')) {
            try { _mThumbBuf = fs.readFileSync('./assets/thumb.jpg'); _mIsGif = false; } catch {}
        }
    }

    // ── Teks utama menu (redesign) ──
    const _mGreet = _mSapa === 'Pagi'  ? '🌤 ɢᴏᴏᴅ ᴍᴏʀɴɪɴɢ' :
                    _mSapa === 'Siang' ? '☀️ ɢᴏᴏᴅ ᴀꜰᴛᴇʀɴᴏᴏɴ' :
                    _mSapa === 'Sore'  ? '🌇 ɢᴏᴏᴅ ᴇᴠᴇɴɪɴɢ' :
                                         '🌙 ɢᴏᴏᴅ ɴɪɢʜᴛ'
    const _mRoleIcon = (isOwner || isCreator) ? '👑' : isPremium ? '💎' : '🌌'
    const _mModeStr  = bulter.public ? 'PUBLIC' : 'SELF'
    const _mBotSmall = _toSmallCaps(_mBot)
    const _uName     = pushname || (m.sender || '').split('@')[0].split(':')[0]
    const _mGreetCard =
`ʜᴇʟʟᴏ, @${_uName} 👋
${_mGreet}, sᴇɴᴀɴɢ ʙᴇʀᴛᴇᴍᴜ ᴅᴇɴɢᴀɴᴍᴜ!

ᴀɴᴅᴀ sᴇᴅᴀɴɢ ᴍᴇɴɢɢᴜɴᴀᴋᴀɴ ${_mBotSmall}

ʙᴏᴛ ɪɴɪ ᴅɪ ᴄɪᴘᴛᴀᴋᴀɴ ᴜɴᴛᴜᴋ ᴍᴇᴍᴘᴇʀᴍᴜᴅᴀʜ ᴘᴇᴋᴇʀᴊᴀᴀɴ ᴍᴀɴᴜsɪᴀ ᴅᴇɴɢᴀɴ ʙᴇʀʙᴀɢᴀɪ ғɪᴛᴜʀ ᴅᴀɴ sɪsᴛᴇᴍ ᴏᴛᴏᴍᴀᴛɪsᴀsɪ

ɢᴜɴᴀᴋᴀɴ ${_mPrefix}ᴀʟʟᴍᴇɴᴜ ᴜɴᴛᴜᴋ ᴍᴇɴᴀᴍᴘɪʟᴋᴀɴ ꜱᴇᴍᴜᴀ ᴄᴏᴍᴍᴀɴᴅ ʙᴏᴛ

ᴊɪᴋᴀ ᴍᴇɴᴇᴍᴜᴋᴀɴ ᴍᴀsᴀʟᴀʜ sɪʟᴀʜᴋᴀɴ ʜᴜʙᴜɴɢɪ ${_mPrefix}ᴏᴡɴᴇʀ

╔═══〖 *ʙ ᴏ ᴛ - ɪ ɴ ғ ᴏ* 〗═══
╠═ 👤 *ɴᴀᴍᴇ*
║ ${_mBot}
╠═ 👑 *ᴄʀᴇᴀᴛᴏʀ*
║ ${_mCreatorName}
╠═ 📞 *ᴏᴡɴᴇʀ*
║ @${_mOwnerNum}
╠═ ⚡ *ᴜᴘᴛɪᴍᴇ*
║ ${_mUpStr}
╠═ 💾 *ʀᴀᴍ*
║ ${_mRam} ᴍʙ
╠═ 🧩 *ғɪᴛᴜʀ*
║ 1578 sᴄʀᴀᴘᴇ ᴏɴʟʏ
╚═══════════════════

🕐 ${_mJam} ᴡɪʙ
📅 ${_mTgl}

✨ ᴘɪʟɪʜ ᴍᴇɴᴜ ʏᴀɴɢ ᴋᴀᴍᴜ ʙᴜᴛᴜʜᴋᴀɴ,
ᴅᴀɴ ɴɪᴋᴍᴀᴛɪ ᴘᴇɴɢᴀʟᴀᴍᴀɴɴʏᴀ.\n`

    // Daftar lengkap semua command per kategori — sekarang manggil tiap fungsi per-kategori
    // (mainmenuCantarella, downloadmenuCantarella, hiburanmenuCantarella, dst) satu-satu, sesuai nama
    // kategori di _mcAllCats (pola nama fungsinya: `${key}menuCantarella`), lalu digabung.
    const _mVisibleCatsForList = Object.keys(_mcAllCats)
        .filter(k => !(_mcAllCats[k].ownerOnly && !(isOwner || isCreator)))
    const _mFullList = _mVisibleCatsForList
        .map(k => {
            const _mCatFn = global[`${k}menuCantarella`]
            if (typeof _mCatFn !== 'function') {
                console.error(`[allmenu] global.${k}menuCantarella belum terdefinisi, kategori dilewati`)
                return ''
            }
            try {
                return _mCatFn(prefix)
            } catch (e) {
                console.error(`[allmenu] gagal jalanin global.${k}menuCantarella:`, e.message)
                return ''
            }
        })
        .filter(Boolean)
        .join('\n\n')
    const _mText = _mGreetCard + (_mFullList ? `\n\n${_mFullList}` : '')

    // ── Category rows untuk single_select popup ──
    // NOTE: daftar ini manual/terpisah dari _mcAllCats di atas. Kalau kamu nambah/ubah
    // command di _mcAllCats, ingat update juga daftar ini biar nggak beda-beda sendiri.
    const _mCategories = [
        { header: `🏠 𝗠𝗔𝗜𝗡`,       title: `Command utama bot`,             description: `menu, ping, owner, ceksewa dll`,           id: `${_mPrefix}mcat main`      },
        { header: `👥 𝗚𝗥𝗨𝗣`,        title: `Panel manajemen grup`,          description: `kick, ban, promote, mute, warn dll`,       id: `${_mPrefix}mcat grup`      },
        { header: `🛡️ 𝗣𝗥𝗢𝗧𝗘𝗞𝗦𝗜`,  title: `Proteksi grup`,                 description: `antilink, antiraid, antinsfw dll`,         id: `${_mPrefix}mcat proteksi`  },
        { header: `📥 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗`,   title: `TikTok, YouTube, Terabox dll`, description: `tt, ytmp3, igdl, terabox, videy dll`,      id: `${_mPrefix}mcat download`  },
        { header: `🎮 𝗛𝗜𝗕𝗨𝗥𝗔𝗡`,    title: `Fun, game & hiburan`,           description: `ship, truth, dare, rate, siapa dll`,       id: `${_mPrefix}mcat hiburan`   },
        { header: `🎤 𝗧𝗧𝗦`,         title: `Text to Speech`,                description: `tts, ttsgoku, ttseminem, ttsmickey dll`,   id: `${_mPrefix}mcat tts`       },
        { header: `🎲 𝗚𝗔𝗠𝗘`,        title: `Game interaktif di grup`,       description: `tebakkata, susunkata, caklontong, suit`,   id: `${_mPrefix}mcat game`      },
        { header: `🔍 𝗦𝗧𝗔𝗟𝗞𝗘𝗥`,     title: `Cek info sosmed & game`,        description: `igstalk, tiktokstalk, ffstalk, ghstalk`,   id: `${_mPrefix}mcat stalker`   },
        { header: `🎯 𝗖𝗘𝗞`,         title: `Cek kepribadian & karakter`,    description: `cekcantik, cekwibu, cekhoki, cekrezeki`,   id: `${_mPrefix}mcat cek`       },
        { header: `🔮 𝗣𝗥𝗜𝗠𝗕𝗢𝗡`,    title: `Zodiak, mimpi & arti nama`,     description: `zodiak, tafsirmimpi, artinama`,            id: `${_mPrefix}mcat primbon`   },
        { header: `🎵 𝗔𝗨𝗗𝗜𝗢 𝗙𝗫`,   title: `Efek suara audio`,              description: `nightcore, bass, slow, reverse dll`,       id: `${_mPrefix}mcat audio`     },
        { header: `🖼️ 𝗖𝗔𝗡𝗩𝗔𝗦`,    title: `Efek gambar & fake generator`,  description: `wanted, wasted, jail, ektp, fakedc`,       id: `${_mPrefix}mcat canvas`    },
        { header: `✨ 𝗘𝗣𝗛𝗢𝗧𝗢`,      title: `Efek teks dari ephoto360`,      description: `glitchtext, neonglitch, gradienttext dll`, id: `${_mPrefix}mcat ephoto`    },
        { header: `🕌 𝗥𝗘𝗟𝗜𝗚𝗜`,      title: `Jadwal sholat & islami`,        description: `jadwalsholat, asmaulhusna, doa dll`,       id: `${_mPrefix}mcat religi`    },
        { header: `👤 𝗨𝗦𝗘𝗥`,        title: `Profil, level & koin`,          description: `profile, daily, exp, koin, leaderboard`,   id: `${_mPrefix}mcat user`      },
        { header: `🔎 𝗦𝗘𝗔𝗥𝗖𝗛`,      title: `Brainly, Wattpad & info`,       description: `brainly, wattpad, jadwalbola, puisi`,      id: `${_mPrefix}mcat search`    },
        { header: `🛠️ 𝗨𝗧𝗜𝗟𝗜𝗧𝗬`,   title: `Tools berguna sehari-hari`,     description: `ocr, wikipedia dll`,                       id: `${_mPrefix}mcat utility`   },
        { header: `🔧 𝗧𝗢𝗢𝗟𝗦`,       title: `Utilitas & owner tools`,        description: `curl, backup, checklink dll`,              id: `${_mPrefix}mcat tools`     },
        { header: `💰 𝗦𝗘𝗪𝗔`,        title: `Info & manajemen sewa bot`,     description: `ceksewa, addsewa, invoice dll`,            id: `${_mPrefix}mcat sewa`      },
        { header: `📊 𝗦𝗧𝗔𝗧𝗜𝗦𝗧𝗜𝗞`,   title: `Statistik grup & keamanan`,     description: `statsgrup, reputation, incidents dll`,     id: `${_mPrefix}mcat statistik` },
        { header: `🤖 𝗔𝗜 𝗖𝗛𝗔𝗧`,     title: `Berbagai model AI chat`,        description: `chatgpt, gemini, groq, deepseek dll`,      id: `${_mPrefix}mcat ai`        },
        { header: `🎨 𝗔𝗜 𝗜𝗠𝗔𝗚𝗘`,    title: `Generate & edit gambar AI`,     description: `txt2img, animegen, toghibli, toanime dll`, id: `${_mPrefix}mcat aiimg`     },
        { header: `🪄 𝗦𝗧𝗜𝗖𝗞𝗘𝗥`,    title: `Buat & edit sticker kreatif`,   description: `brat, furbrat, attp, ttp, emojimix dll`,   id: `${_mPrefix}mcat sticker`   },
        { header: `🔐 𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬`,  title: `Keamanan lanjutan & forensik`,  description: `firewall, vault, 2fa, sandboxscan dll`,    id: `${_mPrefix}mcat security`  },
        { header: `🩺 𝗗𝗢𝗖𝗧𝗢𝗥`,     title: `AutoDoctor & diagnostik bot`,   description: `doctor, bothealth, sysinfo, errorlog dll`, id: `${_mPrefix}mcat doctor`    },
        { header: `⚔️ 𝗥𝗣𝗚`,        title: `RPG, kartu & profil user`,      description: `rpg, usercard, minicard, mycard dll`,      id: `${_mPrefix}mcat rpg`       },
        ...(isOwner || isCreator ? [
        { header: `👑 𝗢𝗪𝗡𝗘𝗥`,       title: `Panel khusus owner bot`,        description: `addcase, delcase, eval, restart dll`,      id: `${_mPrefix}mcat owner`     }
        ] : [])
    ]

    // ── fakeQuoted Kontak dengan Profil Owner ──
    const _mTargetOwnerNum = _mOwnerNum || '62895327468806'
    const _mTargetOwnerJid = `${_mTargetOwnerNum}@s.whatsapp.net`

    const _mQuoted = {
        key: {
            participant: _mTargetOwnerJid,
            remoteJid:   `status@broadcast`
        },
        message: {
            contactMessage: {
                displayName: `🌌 ${_mBot}`,
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;${_mOwner};;;\nFN:${_mBot}\nORG:${_mOwner};\nitem1.TEL;waid=${_mTargetOwnerNum}:+${_mTargetOwnerNum}\nitem1.X-ABLabel:Owner\nEND:VCARD`,
                sendEphemeral: true
            }
        }
    }

    // ── contextInfo ──
    // NOTE: expiration_time diperbaiki dari `Date.now() * 999` (overflow ke tahun ~50000)
    // jadi `Date.now() + 24 jam`. Ubah durasinya kalau kamu mau lebih lama/singkat.
    const _mExpirationTime = Date.now() + 24 * 60 * 60 * 1000

    const _mCtx = {
        mentionedJid: _mMentions,
        forwardingScore: 9999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid:   _mNewsJid,
            newsletterName:  _mNewsName,
            serverMessageId: 127
        },
        externalAdReply: {
            title:   _mBot,
            body:    `v2.0 • ${_mModeStr}`,
            mediaType: 1,
            showAdAttribution: false,
            renderLargerThumbnail: true,
            ...((_mThumbBuf && !_mIsGif) ? { thumbnail: _mThumbBuf } : {}),
            sourceUrl: _mSaluran
        },
        limited_time_offer: {
            text: `Gunakan bot ini dengan bijak yak`,
            url: _mSaluran,
            copy_code: _mBot,
            expiration_time: _mExpirationTime
        }
    }

    const _mButtons = [
        {
            name: 'single_select',
            buttonParamsJson: JSON.stringify({ has_multiple_buttons: true })
        },
        {
            name: 'call_permission_request',
            buttonParamsJson: JSON.stringify({ has_multiple_buttons: true })
        },
        {
            name: 'single_select',
            buttonParamsJson: JSON.stringify({
                title: '⌗ ᴅᴀꜰᴛᴀʀ ᴋᴀᴛᴇɢᴏʀɪ ᴍᴇɴᴜ',
                sections: [{
                    title: '𓍢ִ໋ ᴘɪʟɪʜ ᴋᴀᴛᴇɢᴏʀɪ ʏᴀɴɢ ᴋᴀᴍᴜ ɪɴɢɪɴᴋᴀɴ',
                    highlight_label: _mBot,
                    rows: _mCategories
                }],
                has_multiple_buttons: true
            })
        },
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: 'ꜱᴀʟᴜʀᴀɴ ᴏꜰꜰɪᴄɪᴀʟ',
                url: _mSaluran,
                merchant_url: _mSaluran
            })
        },
        {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text: `⎙ ᴅᴇᴠ: ${_mOwner}`,
                copy_code: _mOwner
            })
        },
        {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({ display_text: '</> ꜱᴇᴍᴜᴀ ᴄᴏᴍᴍᴀɴᴅ', id: `${_mPrefix}allmenu` })
        },
        {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({ display_text: '⛁ ɪɴꜰᴏ ꜱᴇᴡᴀ ʙᴏᴛ', id: `${_mPrefix}ceksewa` })
        },
        {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({ display_text: 'ⓘ ꜱᴛᴀᴛᴜꜱ ʙᴏᴛ', id: `${_mPrefix}ping` })
        },
        ...(isOwner || isCreator ? [{
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({ display_text: '♔ ᴘᴀɴᴇʟ ᴏᴡɴᴇʀ', id: `${_mPrefix}mcat owner` })
        }] : [])
    ]

    const _mFlowParams = JSON.stringify({
        limited_time_offer: {
            text: `ꜱᴇʟᴀᴍᴀᴛ ᴅᴀᴛᴀɴɢ ᴅɪ ${_mBot} !`,
            url: _mSaluran,
            copy_code: _mBot,
            expiration_time: _mExpirationTime
        },
        bottom_sheet: {
            in_thread_buttons_limit: 2,
            divider_indices: [2, 3, 4, 5, 6, 999],
            list_title: 'ᴘɪʟɪʜ ᴋᴀᴛᴇɢᴏʀɪ ᴍᴇɴᴜ',
            button_title: 'ᴊᴇʟᴀᴊᴀʜɪ ᴍᴇɴᴜ ꜱᴇᴋᴀʀᴀɴɢ'
        }
    })

    if (!m.isGroup) {
        // DI PRIVATE CHAT: Kirim langsung Gambar/GIF + Teks Menu lengkap dengan sendMessage & quoted: m
        // Respon super cepat, tanpa relayMessage, tanpa fake quote status@broadcast yang bikin 'Menunggu pesan ini'
        try {
            await bulter.sendMessage(m.chat, {
                image: _mThumbBuf || { url: 'https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/assets/icon.png' },
                caption: _mText,
                mentions: _mMentions,
                contextInfo: {
                    mentionedJid: _mMentions,
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid:   _mNewsJid,
                        newsletterName:  _mNewsName,
                        serverMessageId: 127
                    }
                }
            }, { quoted: m });
        } catch (_pcErr) {
            try {
                if (_mThumbBuf) {
                    await bulter.sendMessage(m.chat, {
                        image: _mThumbBuf,
                        caption: _mGreetCard,
                        mentions: _mMentions
                    }, { quoted: m });
                }
                await bulter.sendMessage(m.chat, { text: _mFullList || _mText, mentions: _mMentions }, { quoted: m });
            } catch {
                await bulter.sendMessage(m.chat, { text: _mText, mentions: _mMentions }, { quoted: m });
            }
        }
        try { await bulter.sendMessage(m.chat, { react: { text: '🌌', key: m.key } }); } catch {}
        return;
    }

    try {
        // Upload media (image banner atau fallback) ke WA server
        if (!_genMsg || !_prepMedia) throw new Error('baileys generateWAMessageFromContent/prepareWAMessageMedia tidak tersedia')
        if (!_mThumbBuf) throw new Error('tidak ada media untuk diupload')

        const _mMediaPrep = await _prepMedia(
            _mIsGif ? { video: _mThumbBuf, gifPlayback: true } : { image: _mThumbBuf },
            { upload: bulter.waUploadToServer }
        )

        const _mHeader = _mIsGif
            ? { hasMediaAttachment: true, videoMessage: _mMediaPrep.videoMessage }
            : { hasMediaAttachment: true, imageMessage: _mMediaPrep.imageMessage }

        // Bangun proto interactiveMessage dengan header image/media
        const _mProto = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    interactiveMessage: {
                        header: _mHeader,
                        body:   { text: _mText },
                        footer: { text: global.Foah || _mBotSmall },
                        contextInfo: {
                            mentionedJid: _mMentions,
                            forwardingScore: 999,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid:   _mNewsJid,
                                newsletterName:  _mNewsName,
                                serverMessageId: 127
                            }
                        },
                        nativeFlowMessage: {
                            messageParamsJson: _mFlowParams,
                            buttons: _mButtons
                        }
                    }
                }
            }
        }

        const _mGenMsg = _genMsg(m.chat, _mProto, { quoted: m })
        await bulter.relayMessage(m.chat, _mGenMsg.message, { messageId: _mGenMsg.key.id })

    } catch (_mErr) {
        console.error('[allmenu] gagal kirim interactive+media:', _mErr.message)
        // Fallback 1: interactiveMessage biasa + thumbnail di externalAdReply
        try {
            await bulter.sendMessage(m.chat, {
                interactiveMessage: {
                    title: _mText,
                    footer: global.Foah || _mBotSmall,
                    contextInfo: _mCtx,
                    nativeFlowMessage: {
                        messageParamsJson: _mFlowParams,
                        buttons: _mButtons
                    }
                }
            }, { quoted: m })
        } catch (_mErr2) {
            console.error('[allmenu] gagal kirim interactive fallback 1:', _mErr2.message)
            // Fallback 2: kirim image langsung + caption plain
            try {
                await bulter.sendMessage(m.chat, {
                    image: _mThumbBuf || { url: _mThumbUrl },
                    mimetype: 'image/jpeg',
                    caption: _mText,
                    mentions: _mMentions,
                    contextInfo: _mCtx
                }, { quoted: m })
            } catch (_mErr3) {
                console.error('[allmenu] gagal kirim media langsung, fallback teks polos:', _mErr3.message)
                await bulter.sendMessage(m.chat, {
                    text: _mText,
                    mentions: _mMentions,
                    contextInfo: _mCtx
                }, { quoted: m })
            }
        }
    }

    try { await bulter.sendMessage(m.chat, { react: { text: '🌌', key: m.key } }) } catch {}
}
module.exports = { _mcAllCats, sendAllMenu }

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(`Update ${__filename}`)
    delete require.cache[file]
    require(file)
})
require("./Cantarella")
const fs = require('fs')

// Load environment variables from .env if exists
if (fs.existsSync('./.env')) {
    const envLines = fs.readFileSync('./.env', 'utf8').split('\n');
    for (const line of envLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [k, ...v] = trimmed.split('=');
        if (k && v.length) process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
    }
}

global.owner = ["62895327468806"] //NOMOR OWNER
global.nobot = "6281973866718" //NOMOR BOT
global.nomorowner = '62895327468806' //NOMOR OWNER
global.namaowner = "Chaidar" //NAMA OWNER LO
global.namaBot = "Ender Verstappen" //NAMA BOT LO
global.pairingCode = "ENDERDEV" // CUSTOM PAIRING CODE (8 KARAKTER)
global.thumnail2 = "./assets/thumb.jpg" //REPLY IMAGE / THUMBNAIL LOKAL
global.replyimg = "./assets/script.jpg" //REPLY IMAGE LOKAL
global.creator = `${nomorowner}@s.whatsapp.net` //GAUSAH LO OPREK
global.foother = `© ${namaBot}` //GAUSAH LO OPREK
global.ppowner = './assets/creator.jpg' //PROFILE OWNER LOKAL
global.versi ="Ender Verstappen" //JANGAN LO UBAH
global.menuBg = './assets/banner.jpg' //THUMBNAIL MENU LOKAL (BISA PATH LOKAL ATAU URL)
global.menuGif = './assets/menu.mp4' //VIDEO / GIF MENU LOKAL (BISA PATH LOKAL ATAU URL)
global.menuMusic = './assets/menu.mp3' //AUDIO MUSIK MENU LOKAL
global.defaultThumb = './assets/thumb.jpg' //THUMBNAIL CADANGAN / FALLBACK JIKA THUMBNAIL LAIN KOSONG
global.idch = "120363407326732377@newsletter" //UBAH PAKE IDCH LO
global.saluranId = global.idch
global.saluranName = global.namaBot
global.filename = "Ender Verstappen"
global.linkSaluran = "https://whatsapp.com/channel/0029Vb7WeqhAYlULyAOiEv2q" //SAMA UBAH JUGA
global.linkGc = "https://chat.whatsapp.com/CyqYBNPiYyNLZruhCKtsWl" //LINK GROUP KOMUNITAS
//KALO MAU GANTI BACKGROUND WELCOME/GOODBYE UBAH AJA
global.welcomeBg = './assets/banner.jpg'
//UBAH SESUKA LO
global.mess = {
    owner: "You are not owner",
    prem: "You are not premium",
    group: "Only group command",
    admin: "You are not Admin",
    botadmin: "Bot Harus Jadi Admin",
    private: "Only Private Chat",
    done: "Done"
}
//===BAGIAN STORE UNTUK PAYMENT GETWA =====
global.midtransServerKey = '';
global.midtransClientKey = '';
global.midtransProduction = false;
global.paymentMode = 'both';
global.googleAiApiKey = process.env.GOOGLE_AI_API_KEY || "";
global.notifBackup = false // NOTIFIKASI AUTO BACKUP KE WHATSAPP OWNER (false = MATI / SILENT)
//================ AUTO REACT STATIS WHATSAPP =============

global.autoreactsw = false
global.autoreactemoji = '💛'

//===GAUSAH LO UBAH APA APA =====
global.mute = false
global.onlygc = false
global.allowedGroupIds = global.allowedGroupIds || [""];
global.nama = namaBot
global.namach = nama
global.namafile = foother
global.author = namaowner
global.welcome = true
global.leave = true
global.antitags = false
global.welcomeMessage = "Selamat datang di grup!"
global.leaveMessage = "Selamat tinggal!"
global.autoreadsw = false
global.autoreactsw = false
global.autoreactemoji = '😂'
global.prefix = [".", "/", "#", "?", "!"]
global.flaming = 'https://www6.flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=sketch-name&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&text='
global.fluming = 'https://www6.flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=fluffy-logo&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&text='
global.flarun = 'https://www6.flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=runner-logo&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&text='
global.flasmurf = 'https://www6.flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=smurfs-logo&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&text='
global.keyopenai = process.env.OPENAI_API_KEY || "";
global.packname = namaBot
global.author = namaowner
//==================================
let file = require.resolve(__filename)
require('fs').watchFile(file, () => {
    require('fs').unwatchFile(file)
    console.log('\x1b[0;32m' + __filename + ' \x1b[1;32mupdated!\x1b[0m')
    delete require.cache[file]
    require(file)
})
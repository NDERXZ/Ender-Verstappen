'use strict';

const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const PP_FALLBACK = path.join(process.cwd(), 'assets', 'profile.jpg');

const W = 700;
const H = 1960;

const CARD_IMG_BASE = 'https://ishtarcollective.blob.core.windows.net/rider-waite-tarot/major-';

// Fallback URL map per card (slug → trustedtarot.com + sacred-texts)
const CARD_SLUGS = {
    0:  'the-fool',        1:  'the-magician',    2:  'the-high-priestess',
    3:  'the-empress',     4:  'the-emperor',     5:  'the-heirophant',
    6:  'the-lovers',      7:  'the-chariot',     8:  'strength',
    9:  'the-hermit',      10: 'wheel-of-fortune',11: 'justice',
    12: 'the-hanged-man',  13: 'death',           14: 'temperance',
    15: 'the-devil',       16: 'the-tower',       17: 'the-star',
    18: 'the-moon',        19: 'the-sun',         20: 'judgement',
    21: 'the-world',
};

async function _loadCardImg(imgId) {
    const { loadImage } = require('skia-canvas');
    const slug = CARD_SLUGS[imgId] || '';
    const nn   = String(imgId).padStart(2, '0');

    const urls = [
        // Primary: ishtarcollective Azure blob (format confirmed: major-0.jpg)
        `https://ishtarcollective.blob.core.windows.net/rider-waite-tarot/major-${imgId}.jpg`,
        // Fallback 1: trustedtarot.com PNG
        slug ? `https://www.trustedtarot.com/img/cards/${slug}.png` : null,
        // Fallback 2: sacred-texts.com scans (format: rwcs01.jpg → rwcs22.jpg, 0=fool=01)
        `https://www.sacred-texts.com/tarot/rwcs/img/rwcs${String(imgId + 1).padStart(2,'0')}.jpg`,
        // Fallback 3: raw githubusercontent metabismuth tarot-json cards
        `https://raw.githubusercontent.com/metabismuth/tarot-json/master/cards/${nn}.jpg`,
        // Fallback 4: jsdelivr from same repo
        `https://cdn.jsdelivr.net/gh/metabismuth/tarot-json@master/cards/${nn}.jpg`,
    ].filter(Boolean);

    for (const url of urls) {
        try {
            const buf = await _fetch(url);
            if (buf && buf.length > 2000) {
                const img = await loadImage(buf);
                if (img && img.width > 0) return img;
            }
        } catch {}
    }
    return null;
}

const CARDS = [
    {
        id: 0, name: 'THE FOOL', number: 'O', imgId: 0,
        accent: '#E8C97A', accentDark: '#8B6914', textLight: '#FFF8E7',
        keywords: ['Awal Baru','Petualangan','Kebebasan','Spontanitas'],
        upright:  'Hari ini adalah awal dari babak baru. Ambil langkah berani tanpa rasa takut. Semesta mendukungmu untuk mencoba hal yang belum pernah kamu lakukan. Jiwa mudamu adalah kekuatanmu.',
        reversed: 'Kamu mungkin bertindak terlalu gegabah hari ini. Ambil napas, pikirkan kembali keputusan besarmu sebelum melangkah. Kehati-hatian adalah kebijaksanaan.',
    },
    {
        id: 1, name: 'THE MAGICIAN', number: 'I', imgId: 1,
        accent: '#E8C97A', accentDark: '#8B6914', textLight: '#FFF8E7',
        keywords: ['Kekuatan','Kreativitas','Manifestasi','Fokus'],
        upright:  'Semua yang kamu butuhkan sudah ada di tanganmu. Saatnya bertindak dan mewujudkan mimpi. Energi semesta mengalir melaluimu — gunakan kreativitas dan kemampuanmu sekarang.',
        reversed: 'Waspada terhadap manipulasi atau pikiran yang tidak jujur. Pastikan niatmu murni sebelum bertindak. Kekuatanmu bisa disalahgunakan jika tidak diarahkan dengan benar.',
    },
    {
        id: 2, name: 'HIGH PRIESTESS', number: 'II', imgId: 2,
        accent: '#C8A8E8', accentDark: '#5A3080', textLight: '#F8F0FF',
        keywords: ['Intuisi','Misteri','Kebijaksanaan','Batin'],
        upright:  'Dengarkan suara batinmu hari ini. Jawaban yang kamu cari bukan di luar sana — melainkan tersembunyi di dalam dirimu. Meditasi dan ketenangan akan membukakan pintu pemahaman.',
        reversed: 'Kamu mungkin mengabaikan firasat pentingmu. Jangan biarkan kebisingan dunia luar menutupi suara hatimu yang paling dalam. Percayai instingmu.',
    },
    {
        id: 3, name: 'THE EMPRESS', number: 'III', imgId: 3,
        accent: '#8FD98F', accentDark: '#2D6E2D', textLight: '#F0FFF0',
        keywords: ['Kelimpahan','Kesuburan','Kasih Sayang','Alam'],
        upright:  'Kelimpahan mengalir kepadamu. Ini saat yang tepat untuk merawat hubungan, proyek, atau impian yang sedang tumbuh. Cinta dan kreativitas akan berbuah indah jika kamu memberinya perhatian.',
        reversed: 'Mungkin kamu terlalu bergantung pada orang lain atau mengabaikan dirimu sendiri. Kembalilah ke dirimu — rawat kebutuhanmu terlebih dahulu sebelum merawat yang lain.',
    },
    {
        id: 4, name: 'THE EMPEROR', number: 'IV', imgId: 4,
        accent: '#E88A8A', accentDark: '#8B1A1A', textLight: '#FFF0F0',
        keywords: ['Otoritas','Struktur','Stabilitas','Kepemimpinan'],
        upright:  'Ambil kendali hari ini. Jadilah pemimpin yang tegas namun adil — di pekerjaan, keluarga, maupun dirimu sendiri. Struktur dan disiplin adalah kunci kesuksesanmu saat ini.',
        reversed: 'Kamu mungkin terlalu kaku atau otoriter. Fleksibilitas bukan kelemahan. Dengarkan orang di sekitarmu dan pertimbangkan perspektif lain.',
    },
    {
        id: 5, name: 'THE HIEROPHANT', number: 'V', imgId: 5,
        accent: '#E8C97A', accentDark: '#8B6914', textLight: '#FFF8E7',
        keywords: ['Tradisi','Bimbingan','Kepercayaan','Konvensi'],
        upright:  'Cari bimbingan dari seseorang yang lebih berpengalaman. Tradisi dan nilai-nilai yang telah teruji waktu menjadi landasanmu hari ini. Bergabunglah dengan komunitas yang sejalan dengan nilaimu.',
        reversed: 'Pertanyakan aturan yang tidak lagi masuk akal bagimu. Saatnya berpikir mandiri dan berani keluar dari pola lama yang membatasimu.',
    },
    {
        id: 6, name: 'THE LOVERS', number: 'VI', imgId: 6,
        accent: '#F0A0C0', accentDark: '#8B2050', textLight: '#FFF0F8',
        keywords: ['Cinta','Pilihan','Harmoni','Komitmen'],
        upright:  'Hari yang baik untuk hubungan dan keputusan penting hati. Energi cinta mengalir derasmu — ekspresikan perasaanmu dengan tulus. Pilihan yang kamu buat hari ini akan membekas lama.',
        reversed: 'Ada ketidakselarasan dalam hubungan atau pilihan yang kamu hadapi. Periksa kembali nilai-nilaimu — apa yang benar-benar penting bagimu?',
    },
    {
        id: 7, name: 'THE CHARIOT', number: 'VII', imgId: 7,
        accent: '#8AD8E8', accentDark: '#1A6080', textLight: '#F0FBFF',
        keywords: ['Kemenangan','Tekad','Kontrol','Ambisi'],
        upright:  'Kamu berada di jalur kemenangan. Pertahankan fokus dan doronganmu — rintangan ada, tapi kamu cukup kuat untuk melewatinya. Kendalikan emosimu dan tetap pada tujuan.',
        reversed: 'Kamu mungkin kehilangan arah atau tercerai-berai. Fokuskan energimu pada satu tujuan utama dan jangan biarkan ego mengambil alih.',
    },
    {
        id: 8, name: 'STRENGTH', number: 'VIII', imgId: 8,
        accent: '#F0C080', accentDark: '#8B5010', textLight: '#FFF8F0',
        keywords: ['Keberanian','Kesabaran','Keteguhan','Kelemah-lembutan'],
        upright:  'Kekuatanmu yang sesungguhnya bukan dari otot melainkan dari hati. Hadapi tantangan dengan kasih sayang dan kesabaran. Kelemah-lembutanmu adalah senjata terbesar hari ini.',
        reversed: 'Kamu mungkin meragukan kemampuanmu. Ingat: keberanian bukan ketiadaan rasa takut, melainkan melangkah meski takut. Percayai dirimu lebih dari yang kamu lakukan.',
    },
    {
        id: 9, name: 'THE HERMIT', number: 'IX', imgId: 9,
        accent: '#C8D8E8', accentDark: '#304050', textLight: '#F0F8FF',
        keywords: ['Kesendirian','Introspeksi','Cahaya Batin','Petunjuk'],
        upright:  'Ambil waktu untuk menyendiri dan merenung. Jauhkan dirimu dari keramaian sebentar — dalam keheningan itulah kamu akan menemukan jawaban. Kebijaksanaanmu adalah cahayamu.',
        reversed: 'Kamu mungkin terlalu menarik diri dari dunia. Isolasi yang berkepanjangan bisa merugikan. Saatnya keluar dan berbagi cahayamu dengan orang lain.',
    },
    {
        id: 10, name: 'WHEEL OF FORTUNE', number: 'X', imgId: 10,
        accent: '#E8C97A', accentDark: '#8B6914', textLight: '#FFF8E7',
        keywords: ['Takdir','Siklus','Keberuntungan','Perubahan'],
        upright:  'Roda keberuntungan berputar ke arahmu! Peluang tak terduga akan datang hari ini — bersiaplah dan jangan lewatkan momen. Semesta sedang bekerja demi kebaikanmu.',
        reversed: 'Siklus yang sulit sedang berlangsung. Ingat bahwa roda selalu berputar — ini tidak akan selamanya. Bersabarlah dan percayai prosesnya.',
    },
    {
        id: 11, name: 'JUSTICE', number: 'XI', imgId: 11,
        accent: '#8FD98F', accentDark: '#2D6E2D', textLight: '#F0FFF0',
        keywords: ['Keadilan','Keseimbangan','Kebenaran','Sebab-akibat'],
        upright:  'Kebenaran akan terungkap hari ini. Setiap tindakanmu memiliki konsekuensi — bertindaklah dengan integritas dan kejujuran. Karma sedang bekerja, dan keadilan akan ditegakkan.',
        reversed: 'Mungkin ada ketidakadilan yang sedang kamu alami atau lakukan. Periksa kembali situasinya dari sudut pandang yang lebih objektif. Kesalahan bisa diperbaiki jika diakui.',
    },
    {
        id: 12, name: 'THE HANGED MAN', number: 'XII', imgId: 12,
        accent: '#A8C8E8', accentDark: '#204060', textLight: '#F0F8FF',
        keywords: ['Penangguhan','Perspektif Baru','Pengorbanan','Pelepasan'],
        upright:  'Berhentilah sejenak dan lihat dari sudut yang berbeda. Pengorbanan kecil hari ini akan membuka pemahaman yang besar. Melepaskan kendali bisa jadi kebebasan yang sesungguhnya.',
        reversed: 'Kamu mungkin terjebak dan menolak perubahan. Pengorbanan yang kamu hindari justru yang paling dibutuhkan. Saatnya melepaskan yang sudah tidak melayanimu.',
    },
    {
        id: 13, name: 'DEATH', number: 'XIII', imgId: 13,
        accent: '#C8B8D8', accentDark: '#402858', textLight: '#F8F0FF',
        keywords: ['Transformasi','Akhir & Awal','Perubahan','Peralihan'],
        upright:  'Jangan takut — ini bukan tentang kematian fisik. Sebuah fase hidupmu akan berakhir hari ini, membuka ruang untuk yang baru dan lebih baik. Lepaskan masa lalu dan sambut transformasi.',
        reversed: 'Kamu mungkin menolak perubahan yang tak terelakkan. Ketakutan pada akhir membuat kamu terjebak. Perubahan adalah satu-satunya kepastian dalam hidup.',
    },
    {
        id: 14, name: 'TEMPERANCE', number: 'XIV', imgId: 14,
        accent: '#8FD9C8', accentDark: '#1A6050', textLight: '#F0FFFC',
        keywords: ['Keseimbangan','Moderasi','Kesabaran','Penyesuaian'],
        upright:  'Cari keseimbangan dalam segala hal hari ini. Jangan berlebihan atau kekurangan — titik tengah adalah kekuatanmu. Kesabaran dan moderasi akan membawamu ke harmoni.',
        reversed: 'Ada ketidakseimbangan dalam hidupmu yang perlu diperhatikan. Mungkin kamu bekerja terlalu keras, atau sebaliknya terlalu malas. Cari titik equilibrium.',
    },
    {
        id: 15, name: 'THE DEVIL', number: 'XV', imgId: 15,
        accent: '#E87070', accentDark: '#8B1010', textLight: '#FFF0F0',
        keywords: ['Keterikatan','Bayangan','Godaan','Pembebasan'],
        upright:  'Waspadai kebiasaan atau hubungan yang mengikatmu secara negatif. Kamu lebih bebas dari yang kamu kira — rantai itu mungkin hanya ada di pikiranmu. Saatnya menghadapi bayanganmu.',
        reversed: 'Kamu mulai melepaskan diri dari ikatan yang membatasimu. Langkah pertama menuju kebebasan sudah diambil. Teruslah maju dan jangan melihat ke belakang.',
    },
    {
        id: 16, name: 'THE TOWER', number: 'XVI', imgId: 16,
        accent: '#E8A040', accentDark: '#8B4010', textLight: '#FFF8F0',
        keywords: ['Guncangan','Pencerahan Tiba-tiba','Kehancuran','Wahyu'],
        upright:  'Sesuatu yang mengejutkan mungkin terjadi hari ini — namun di balik guncangan ini ada pencerahan besar. Apa yang runtuh sudah seharusnya pergi. Bangun di atas fondasi yang lebih kuat.',
        reversed: 'Kamu berhasil menghindari krisis besar, atau mungkin kamu menunda perubahan yang diperlukan. Ingat: menahan kehancuran yang diperlukan hanya memperlama penderitaan.',
    },
    {
        id: 17, name: 'THE STAR', number: 'XVII', imgId: 17,
        accent: '#A0C8F0', accentDark: '#1A4880', textLight: '#F0F8FF',
        keywords: ['Harapan','Inspirasi','Ketenangan','Kepercayaan'],
        upright:  'Bintang-bintang menyinarimu hari ini. Setelah kegelapan, tibalah cahaya. Percayai prosesmu — mimpimu sedang dalam perjalanan terwujud. Harapan adalah obat terbaik.',
        reversed: 'Kamu mungkin merasa putus asa atau kehilangan harapan. Ingat: bintang masih bersinar meski tertutup awan. Percayakan dirimu pada waktu.',
    },
    {
        id: 18, name: 'THE MOON', number: 'XVIII', imgId: 18,
        accent: '#C0B0E0', accentDark: '#403060', textLight: '#F8F0FF',
        keywords: ['Ilusi','Intuisi','Alam Bawah Sadar','Mimpi'],
        upright:  'Tidak semua yang tampak adalah kenyataan hari ini. Percayai intuisimu di tengah kebingungan. Bawa apa yang tersembunyi ke permukaan — jangan takut menghadapi sisi gelapmu.',
        reversed: 'Kebingungan mulai berkurang dan kejelasan datang. Ilusi yang selama ini membutakanmu mulai menyingkap kebenarannya. Teruslah mencari cahaya.',
    },
    {
        id: 19, name: 'THE SUN', number: 'XIX', imgId: 19,
        accent: '#F0D060', accentDark: '#907010', textLight: '#FFFFF0',
        keywords: ['Kebahagiaan','Kesuksesan','Vitalitas','Kejayaan'],
        upright:  'Hari yang luar biasa menanti! Energi positif meluap-luap — kebahagiaan, kesuksesan, dan kejayaan ada dalam genggamanmu. Nikmati setiap momen hari ini dengan sepenuh hati.',
        reversed: 'Mungkin kebahagiaan terasa jauh hari ini. Cari sumber cahaya kecil di sekitarmu — gratitude untuk hal-hal sederhana bisa mengubah perspektifmu secara dramatis.',
    },
    {
        id: 20, name: 'JUDGEMENT', number: 'XX', imgId: 20,
        accent: '#D0B890', accentDark: '#806040', textLight: '#FFF8F0',
        keywords: ['Kebangkitan','Refleksi','Absolution','Panggilan'],
        upright:  'Saatnya mempertanggungjawabkan pilihanmu dan bangkit menjadi versi terbaik dirimu. Dengarkan panggilanmu yang sejati. Masa lalu telah mengajarimu cukup — saatnya berevolusi.',
        reversed: 'Kamu mungkin terlalu keras menghakimi dirimu atau orang lain. Maaf adalah kebebasan. Lepaskan beban rasa bersalah dan buka halaman baru.',
    },
    {
        id: 21, name: 'THE WORLD', number: 'XXI', imgId: 21,
        accent: '#98D898', accentDark: '#2A6E2A', textLight: '#F0FFF0',
        keywords: ['Penyelesaian','Integrasi','Pencapaian','Kepenuhan'],
        upright:  'Kamu berada di puncak siklus! Rayakan pencapaianmu hari ini — kamu telah menyelesaikan sesuatu yang luar biasa. Semesta memelukmu dengan penuh rasa bangga.',
        reversed: 'Kamu hampir mencapai tujuan tapi ada yang belum tuntas. Jangan berhenti di garis terakhir — sedikit lagi dan segalanya akan sempurna.',
    },
];

const FORTUNES = {
    love:    ['Buka hatimu — seseorang melihatmu lebih dari yang kamu kira.','Komunikasi jujur akan memperkuat ikatan emosionalmu.','Cinta sejati dimulai dari mencintai dirimu sendiri.','Pertemuan tak terduga bisa membawa kejutan manis.','Jaga jarak sejenak untuk menjernihkan perasaan.'],
    career:  ['Ide kreatifmu hari ini layak untuk diperjuangkan.','Kerja keras hari ini akan membuahkan hasil memuaskan.','Jangan takut memimpin — tim membutuhkan arahanmu.','Kolaborasi lebih kuat dari kerja sendiri hari ini.','Peluang baru sedang mengetuk pintumu — buka!'],
    health:  ['Istirahat yang cukup adalah investasi terbaik harimu.','Dengarkan tubuhmu — ia tahu apa yang dibutuhkan.','Gerakan ringan meningkatkan energi dan fokusmu.','Keseimbangan pikiran dan tubuh adalah kunci vitalitasmu.','Makan dengan sadar dan nikmati setiap suapan.'],
    lucky:   ['7','3','21','14','9','38','42','1','17','28'],
    element: ['Api 🔥','Air 💧','Tanah 🌿','Udara 🌬️','Eter ✨'],
    planet:  ['Merkurius ☿','Venus ♀','Mars ♂','Jupiter ♃','Saturnus ♄','Bulan 🌙','Matahari ☀️'],
};

function _rng(seed) {
    let v = Math.abs(seed) || 42;
    return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; };
}

async function _fetch(url) {
    return new Promise((res, rej) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: 14000 }, (r) => {
            if (r.statusCode === 301 || r.statusCode === 302) { req.destroy(); return _fetch(r.headers.location).then(res).catch(rej); }
            if (r.statusCode !== 200) { req.destroy(); return rej(new Error('HTTP '+r.statusCode)); }
            const ch = []; r.on('data', c => ch.push(c)); r.on('end', () => res(Buffer.concat(ch))); r.on('error', rej);
        });
        req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('Timeout')); });
    });
}

async function _loadImg(src) {
    const { loadImage } = require('skia-canvas');
    if (!src) return null;
    try {
        if (Buffer.isBuffer(src) && src.length > 800) return await loadImage(src);
        if (typeof src === 'string' && /^https?:\/\//.test(src)) {
            const buf = await _fetch(src);
            if (buf && buf.length > 1500) return await loadImage(buf);
            return null;
        }
        if (typeof src === 'string' && fs.existsSync(src)) return await loadImage(fs.readFileSync(src));
    } catch {}
    return null;
}

async function _getAvatar(src) {
    let img = await _loadImg(src);
    if (img) return img;
    if (fs.existsSync(PP_FALLBACK)) { img = await _loadImg(PP_FALLBACK); if (img) return img; }
    return null;
}

function _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
}

function _wrapText(ctx, text, maxW) {
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) {
        const test = cur ? cur+' '+w : w;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
        else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
}

function _star(ctx, cx, cy, rO, rI, n, color, alpha) {
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let i = 0; i < n*2; i++) {
        const r = i%2===0 ? rO : rI;
        const a = (i*Math.PI)/n - Math.PI/2;
        i===0 ? ctx.moveTo(cx+r*Math.cos(a), cy+r*Math.sin(a))
               : ctx.lineTo(cx+r*Math.cos(a), cy+r*Math.sin(a));
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
}

function _drawOrnamentBorder(ctx, w, h, accent, accentDark) {
    const m = 12;
    ctx.save();
    ctx.strokeStyle = accentDark; ctx.lineWidth = 6;
    _rrect(ctx, m, m, w-m*2, h-m*2, 6); ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    _rrect(ctx, m+6, m+6, w-m*2-12, h-m*2-12, 4); ctx.stroke();
    ctx.strokeStyle = accentDark; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.6;
    _rrect(ctx, m+10, m+10, w-m*2-20, h-m*2-20, 3); ctx.stroke();
    ctx.globalAlpha = 1;

    const corners = [[m+18,m+18],[w-m-18,m+18],[m+18,h-m-18],[w-m-18,h-m-18]];
    corners.forEach(([cx,cy]) => _star(ctx,cx,cy,10,5,4,accent,0.85));

    const mid = [[w/2,m+9],[w/2,h-m-9],[m+9,h/2],[w-m-9,h/2]];
    mid.forEach(([cx,cy]) => {
        ctx.beginPath(); ctx.arc(cx,cy,4,0,Math.PI*2);
        ctx.fillStyle=accent; ctx.globalAlpha=0.75; ctx.fill(); ctx.globalAlpha=1;
    });

    [['top',m+18,m+8],[' bottom',m+18,h-m-8]].forEach(([,x,y]) => {
        ctx.save(); ctx.strokeStyle=accent; ctx.lineWidth=1; ctx.globalAlpha=0.45;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(w-x,y); ctx.stroke(); ctx.restore();
    });
    ctx.restore();
}

function _drawTopLabel(ctx, number, W, accent, accentDark) {
    ctx.save();
    ctx.font = 'bold 22px serif'; ctx.fillStyle = accentDark;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.shadowColor = accent; ctx.shadowBlur = 8;
    ctx.fillText(number, 32, 42);
    ctx.textAlign = 'right';
    ctx.fillText(number, W-32, 42);
    ctx.restore();
}

function _drawCardNameBanner(ctx, name, y, w, accent, accentDark, textLight) {
    const banH = 52;
    ctx.save();
    const banG = ctx.createLinearGradient(0, y, 0, y+banH);
    banG.addColorStop(0,   'rgba(0,0,0,0.85)');
    banG.addColorStop(0.3, 'rgba(0,0,0,0.78)');
    banG.addColorStop(1,   'rgba(0,0,0,0.70)');
    ctx.fillStyle = banG; ctx.fillRect(0, y, w, banH);

    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.60;
    ctx.beginPath(); ctx.moveTo(24, y+1); ctx.lineTo(w-24, y+1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24, y+banH-1); ctx.lineTo(w-24, y+banH-1); ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.font = 'bold 26px serif'; ctx.fillStyle = textLight;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = accent; ctx.shadowBlur = 14;
    ctx.fillText(name, w/2, y + banH/2);
    ctx.restore();
    return y + banH;
}

function _drawKeywords(ctx, keywords, y, w, accent, accentDark) {
    ctx.save();
    ctx.font = 'italic 14px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';

    const text = keywords.join('  ·  ');
    ctx.fillStyle = accentDark; ctx.shadowColor = 'transparent';
    ctx.fillText(text, w/2, y+1);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent; ctx.shadowBlur = 6;
    ctx.fillText(text, w/2, y);
    ctx.restore();
}

function _drawFortune(ctx, text, x, y, maxW, textLight) {
    ctx.save();
    ctx.font = '14px serif'; ctx.fillStyle = textLight; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
    const lines = _wrapText(ctx, text, maxW);
    lines.forEach((l,i) => ctx.fillText(l, x, y + i*20));
    ctx.restore();
    return y + lines.length * 20;
}

function _drawInfoRow(ctx, items, x, y, w, accent, accentDark, textLight) {
    const colW = w / items.length;
    ctx.save();
    items.forEach(({label,value}, i) => {
        const cx = x + i*colW + colW/2;
        ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = accent;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.globalAlpha = 0.85;
        ctx.fillText(label, cx, y);
        ctx.font = '12px sans-serif'; ctx.fillStyle = textLight; ctx.globalAlpha = 0.75;
        ctx.fillText(value, cx, y+14);
        if (i < items.length-1) {
            ctx.strokeStyle = accent; ctx.lineWidth = 0.5; ctx.globalAlpha = 0.25;
            ctx.beginPath(); ctx.moveTo(x+((i+1)*colW), y); ctx.lineTo(x+((i+1)*colW), y+30); ctx.stroke();
        }
    });
    ctx.globalAlpha = 1; ctx.restore();
}

function _drawAvatarCircle(ctx, img, cx, cy, r, accent) {
    ctx.save();
    ctx.shadowColor = accent; ctx.shadowBlur = 20; ctx.shadowOffsetY = 4;
    ctx.beginPath(); ctx.arc(cx, cy, r+4, 0, Math.PI*2);
    ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath(); ctx.arc(cx, cy, r+1, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.clip();
    const sc = Math.max((r*2)/img.width, (r*2)/img.height);
    ctx.drawImage(img, cx-img.width*sc/2, cy-img.height*sc/2, img.width*sc, img.height*sc);
    ctx.restore();
}

async function createTarotCard(opts = {}) {
    const { Canvas } = require('skia-canvas');
    const {
        username  = 'Unknown',
        avatar    = null,
        cardIndex = null,
        reversed  = null,
    } = opts;

    const seed   = username.split('').reduce((a,c) => a+c.charCodeAt(0), 0);
    const dayOfY = Math.floor((new Date() - new Date(new Date().getFullYear(),0,0)) / 86400000);
    const rng    = _rng(seed + dayOfY * 17);

    const idx  = cardIndex !== null ? cardIndex % CARDS.length : Math.floor(rng() * CARDS.length);
    const card = CARDS[idx];
    const isRev = reversed !== null ? reversed : rng() > 0.72;
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];

    const loveF   = pick(FORTUNES.love);
    const careerF = pick(FORTUNES.career);
    const healthF = pick(FORTUNES.health);
    const luckyN  = pick(FORTUNES.lucky);
    const element = pick(FORTUNES.element);
    const planet  = pick(FORTUNES.planet);

    const [cardImgRaw, avatarImg] = await Promise.all([
        _loadCardImg(card.imgId).catch(() => null),
        _getAvatar(avatar),
    ]);

    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle = '#1A1208'; ctx.fillRect(0, 0, W, H);

    const CARD_Y = 60;
    const CARD_H = Math.round(W * 1.62);
    const CARD_W = W;

    if (cardImgRaw) {
        if (isRev) {
            ctx.save();
            ctx.translate(W/2, CARD_Y + CARD_H/2);
            ctx.rotate(Math.PI);
            ctx.drawImage(cardImgRaw, -CARD_W/2, -CARD_H/2, CARD_W, CARD_H);
            ctx.restore();
        } else {
            ctx.drawImage(cardImgRaw, 0, CARD_Y, CARD_W, CARD_H);
        }
        const fadeG = ctx.createLinearGradient(0, CARD_Y + CARD_H*0.55, 0, CARD_Y + CARD_H);
        fadeG.addColorStop(0, 'rgba(0,0,0,0)');
        fadeG.addColorStop(0.55, 'rgba(0,0,0,0.72)');
        fadeG.addColorStop(1, 'rgba(0,0,0,0.95)');
        ctx.fillStyle = fadeG; ctx.fillRect(0, CARD_Y, W, CARD_H);

        const topFade = ctx.createLinearGradient(0, CARD_Y, 0, CARD_Y+80);
        topFade.addColorStop(0, 'rgba(0,0,0,0.72)');
        topFade.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = topFade; ctx.fillRect(0, CARD_Y, W, 80);
    } else {
        const fbG = ctx.createLinearGradient(0, CARD_Y, W, CARD_Y+CARD_H);
        fbG.addColorStop(0, '#1A1208'); fbG.addColorStop(1, '#2C2010');
        ctx.fillStyle = fbG; ctx.fillRect(0, CARD_Y, W, CARD_H);
    }

    _drawOrnamentBorder(ctx, W, H, card.accent, card.accentDark);
    _drawTopLabel(ctx, card.number, W, card.accent, card.accentDark);

    const INFO_PANEL_Y = CARD_Y + CARD_H - 10;
    const PAD = 28;
    let curY = INFO_PANEL_Y;

    curY = _drawCardNameBanner(ctx, card.name + (isRev ? '  ↓' : ''), curY, W, card.accent, card.accentDark, card.textLight);
    curY += 12;

    _drawKeywords(ctx, card.keywords, curY, W, card.accent, card.accentDark);
    curY += 26;

    ctx.save(); ctx.strokeStyle = card.accent; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.30;
    ctx.beginPath(); ctx.moveTo(PAD, curY); ctx.lineTo(W-PAD, curY); ctx.stroke();
    ctx.restore(); curY += 12;

    curY = _drawFortune(ctx, isRev ? card.reversed : card.upright, W/2, curY, W - PAD*2 - 8, card.textLight);
    curY += 14;

    ctx.save(); ctx.strokeStyle = card.accent; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.moveTo(PAD, curY); ctx.lineTo(W-PAD, curY); ctx.stroke();
    ctx.restore(); curY += 10;

    _drawInfoRow(ctx, [
        { label: 'CINTA',   value: loveF.split(' ').slice(0,3).join(' ')+'…' },
        { label: 'KARIER',  value: careerF.split(' ').slice(0,3).join(' ')+'…' },
        { label: 'HEALTH',  value: healthF.split(' ').slice(0,3).join(' ')+'…' },
    ], PAD, curY, W-PAD*2, card.accent, card.accentDark, card.textLight);
    curY += 38;

    ctx.save(); ctx.strokeStyle = card.accent; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.20;
    ctx.beginPath(); ctx.moveTo(PAD, curY); ctx.lineTo(W-PAD, curY); ctx.stroke();
    ctx.restore(); curY += 10;

    _drawInfoRow(ctx, [
        { label: '🍀 LUCKY', value: luckyN },
        { label: '⚡ ELEMEN', value: element },
        { label: '🪐 PLANET', value: planet },
    ], PAD, curY, W-PAD*2, card.accent, card.accentDark, card.textLight);
    curY += 36;

    ctx.save(); ctx.strokeStyle = card.accent; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.20;
    ctx.beginPath(); ctx.moveTo(PAD, curY); ctx.lineTo(W-PAD, curY); ctx.stroke();
    ctx.restore(); curY += 12;

    if (avatarImg) {
        const AV_R = 32, AV_CX = W/2, AV_CY = curY + AV_R + 2;
        _drawAvatarCircle(ctx, avatarImg, AV_CX, AV_CY, AV_R, card.accent);
        curY = AV_CY + AV_R + 10;
    }

    ctx.save();
    ctx.font = 'bold 13px serif'; ctx.fillStyle = card.textLight;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = card.accent; ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.85;
    ctx.fillText(`✦  ${username.toUpperCase()}  ✦`, W/2, curY);
    curY += 18;
    ctx.font = '11px sans-serif'; ctx.fillStyle = card.accent; ctx.globalAlpha = 0.60;
    ctx.shadowBlur = 0;
    const todayStr = new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    ctx.fillText(todayStr + (isRev ? '  ·  Terbalik' : ''), W/2, curY);
    ctx.restore();

    const FINAL_H = Math.min(curY + 40, H);
    if (FINAL_H < H - 10) {
        const fc = new Canvas(W, FINAL_H);
        const fx = fc.getContext('2d');
        fx.drawImage(canvas, 0, 0);
        return fc.toBuffer('image/jpeg', { quality: 0.96 });
    }

    return canvas.toBuffer('image/jpeg', { quality: 0.96 });
}

function getTarotCard(username) {
    const seed   = username.split('').reduce((a,c) => a+c.charCodeAt(0), 0);
    const dayOfY = Math.floor((new Date() - new Date(new Date().getFullYear(),0,0)) / 86400000);
    const rng    = _rng(seed + dayOfY * 17);
    const idx    = Math.floor(rng() * CARDS.length);
    return CARDS[idx];
}

module.exports = { createTarotCard, getTarotCard, CARDS };

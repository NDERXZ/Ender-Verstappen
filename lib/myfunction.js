
const { extractMessageContent, jidNormalizedUser, proto, delay, getContentType, areJidsSameUser, generateWAMessage } = require("@whiskeysockets/baileys")
const chalk = require('chalk')
const fs = require('fs')
const Crypto = require('crypto')
const axios = require('axios')
const moment = require('moment-timezone')
const { sizeFormatter } = require('human-readable')
const util = require('util')
const { defaultMaxListeners } = require('stream')
const { read, MIME_JPEG, RESIZE_BILINEAR, AUTO, jimp } = require('jimp')

const unixTimestampSeconds = (date = new Date()) => Math.floor(date.getTime() / 1000)

exports.unixTimestampSeconds = unixTimestampSeconds


exports.resize = async (image, width, height) => {
    let oyy = await jimp.read(image)
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(jimp.MIME_JPEG)
    return kiyomasa
}


exports.generateMessageTag = (epoch) => {
    let tag = (0, exports.unixTimestampSeconds)().toString();
    if (epoch)
        tag += '.--' + epoch; // attach epoch if provided
    return tag;
}

exports.processTime = (timestamp, now) => {
  return moment.duration(now - moment(timestamp * 1000)).asSeconds()
}

exports.getRandom = (ext) => {
    return `${Math.floor(Math.random() * 10000)}${ext}`
}

exports.getBuffer = async (url, options) => {
  try {
    options ? options : {}
    const res = await axios({
      method: "get",
      url,
      headers: {
        'DNT': 1,
        'Upgrade-Insecure-Request': 1
      },
      ...options,
      responseType: 'arraybuffer'
    })
    return res.data
  } catch (err) {
    return err
  }
}

exports.formatSize = (bytes) => {
const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
if (bytes === 0) return '0 Bytes';
const i = Math.floor(Math.log(bytes) / Math.log(1024));
return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
};

exports.fetchJson = async (url, options) => {
    try {
        options ? options : {}
        const res = await axios({
            method: 'GET',
            url: url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36'
            },
            ...options
        })
        return res.data
    } catch (err) {
        return err
    }
}

exports.runtime = function(seconds) {
  seconds = Number(seconds);
  var d = Math.floor(seconds / (3600 * 24));
  var h = Math.floor(seconds % (3600 * 24) / 3600);
  var m = Math.floor(seconds % 3600 / 60);
  var s = Math.floor(seconds % 60);
  var dDisplay = d > 0 ? d + (d == 1 ? " day, " : " days, ") : "";
  var hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : "";
  var mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : "";
  var sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
  return dDisplay + hDisplay + mDisplay + sDisplay;
}

exports.clockString = (ms) => {
    let h = isNaN(ms) ? '--' : Math.floor(ms / 3600000)
    let m = isNaN(ms) ? '--' : Math.floor(ms / 60000) % 60
    let s = isNaN(ms) ? '--' : Math.floor(ms / 1000) % 60
    return [h, m, s].map(v => v.toString().padStart(2, 0)).join(':')
}

exports.reSize = async (buffer, x, z) => {
      return new Promise(async (resolve, reject) => {
         var buff = await read(buffer)
         var ab = await buff.resize(x, z).getBufferAsync(MIME_JPEG)
         resolve(ab)
      })
}

exports.sleep = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

exports.isUrl = (url) => {
    return url.match(new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/, 'gi'))
}

exports.getTime = (format, date) => {
  if (date) {
    return moment(date).locale('id').format(format)
  } else {
    return moment.tz('Asia/Jakarta').locale('id').format(format)
  }
}

exports.formatDate = (n, locale = 'id') => {
  let d = new Date(n)
  return d.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  })
}

exports.tanggal = (numer) => {
  myMonths = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
        myDays = ['Minggu','Senin','Selasa','Rabu','Kamis','Jum’at','Sabtu']; 
        var tgl = new Date(numer);
        var day = tgl.getDate()
        bulan = tgl.getMonth()
        var thisDay = tgl.getDay(),
        thisDay = myDays[thisDay];
        var yy = tgl.getYear()
        var year = (yy < 1000) ? yy + 1900 : yy; 
        const time = moment.tz('Asia/Jakarta').format('DD/MM HH:mm:ss')
        let d = new Date
        let locale = 'id'
        let gmt = new Date(0).getTime() - new Date('1 January 1970').getTime()
        let weton = ['Pahing', 'Pon','Wage','Kliwon','Legi'][Math.floor(((d * 1) + gmt) / 84600000) % 5]

        return`${thisDay}, ${day} - ${myMonths[bulan]} - ${year}`
}

exports.formatp = sizeFormatter({
    std: 'JEDEC', //'SI' = default | 'IEC' | 'JEDEC'
    decimalPlaces: 2,
    keepTrailingZeroes: false,
    render: (literal, symbol) => `${literal} ${symbol}B`,
})

exports.jsonformat = (string) => {
    return JSON.stringify(string, null, 2)
}

function format(...args) {
  return util.format(...args)
}

exports.logic = (check, inp, out) => {
  if (inp.length !== out.length) throw new Error('Input and Output must have same length')
  for (let i in inp)
    if (util.isDeepStrictEqual(check, inp[i])) return out[i]
  return null
}

exports.generateProfilePicture = async (buffer) => {
  const jimp = await Jimp.read(buffer)
  const min = jimp.getWidth()
  const max = jimp.getHeight()
  const cropped = jimp.crop(0, 0, min, max)
  return {
    img: await cropped.scaleToFit(720, 720).getBufferAsync(Jimp.MIME_JPEG),
    preview: await cropped.scaleToFit(720, 720).getBufferAsync(Jimp.MIME_JPEG)
  }
}

exports.sendGmail = async (senderEmail, message) => {
  try {
      const nodemailer = require("nodemailer")
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: "kiuurOTP",
        pass: "boqamuoocnticxpm", 
      },
    });

    const mailOptions = {
      from: "kiuurotp@gmail.com",
      to: "client@gmail.com",
      subject: 'New Message from ' + senderEmail,
      html: message,
    };

    await transporter.sendMail(mailOptions);
    console.log('Message sent to your Gmail.');
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

exports.bytesToSize = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

exports.getSizeMedia = (path) => {
    return new Promise((resolve, reject) => {
        if (/http/.test(path)) {
            axios.get(path)
            .then((res) => {
                let length = parseInt(res.headers['content-length'])
                let size = exports.bytesToSize(length, 3)
                if(!isNaN(length)) resolve(size)
            })
        } else if (Buffer.isBuffer(path)) {
            let length = Buffer.byteLength(path)
            let size = exports.bytesToSize(length, 3)
            if(!isNaN(length)) resolve(size)
        } else {
            reject('error gatau apah')
        }
    })
}

exports.parseMention = (text = '') => {
    return [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v => v[1] + '@s.whatsapp.net')
}

exports.getGroupAdmins = (participants) => {
        let admins = []
        for (let i of participants) {
            i.admin === "superadmin" ? admins.push(i.id) :  i.admin === "admin" ? admins.push(i.id) : ''
        }
        return admins || []
     }

/**
 * Serialize Message
 * @param {WAConnection} conn 
 * @param {Object} m 
 * @param {store} store 
 */
 
 exports.smsg = (client, m, store) => {
    if (!m) return m;
    
    const M = proto.WebMessageInfo;
    
    // Process message key
    if (m.key) {
        m.id = m.key.id;
        
        // Handle status updates
        if (m.key.remoteJid?.startsWith('status')) {
            m.from = jidNormalizedUser(m.key.participant || m.participant);
        } else {
            m.from = jidNormalizedUser(m.key.remoteJid);
        }
        
        m.isBaileys = m.id?.startsWith('BAE5') && m.id.length === 16;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat?.endsWith('@g.us') || false;
        m.isNewsletter = m.chat?.endsWith('@newsletter') || false;
        
        m.sender = client.decodeJid(
            (m.fromMe && client.user.id) || 
            m.participant || 
            m.key.participant || 
            m.chat || ''
        );
        
        if (m.isGroup && m.key.participant) {
            m.participant = client.decodeJid(m.key.participant);
        }
    }
    
    // Process message content
    if (m.message) {
        m.mtype = getContentType(m.message);
        
        // Handle viewOnceMessage
        if (m.mtype === 'viewOnceMessage') {
            const viewOnceContent = m.message.viewOnceMessage?.message;
            if (viewOnceContent) {
                const viewOnceType = getContentType(viewOnceContent);
                m.msg = viewOnceContent[viewOnceType];
            }
        } else if (m.mtype === 'viewOnceMessageV2') {
            const viewOnceContent = m.message.viewOnceMessageV2?.message;
            if (viewOnceContent) {
                const viewOnceType = getContentType(viewOnceContent);
                m.msg = viewOnceContent[viewOnceType];
            }
        } else {
            m.msg = m.message[m.mtype];
        }
        m.mimetype = m.msg?.mimetype || '';
        
        // Extract message body
        m.body = (
            m.message.conversation ||
            m.msg?.caption ||
            m.msg?.text ||
            (m.mtype === 'listResponseMessage' && m.msg?.singleSelectReply?.selectedRowId) ||
            (m.mtype === 'buttonsResponseMessage' && m.msg?.selectedButtonId) ||
            (m.mtype === 'viewOnceMessage' && m.msg?.caption) ||
            m.text ||
            ''
        ).toString();
    }
    
    // Process quoted message
    const quoted = m.msg?.contextInfo?.quotedMessage;
    m.quoted = quoted || null;
    m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];
    
    if (m.quoted) {
        const originalQuoted = m.quoted;
        let type = getContentType(m.quoted);
        
        // Extract quoted content
        if (type && m.quoted[type]) {
            m.quoted = m.quoted[type];
        }
        
        // Handle productMessage and other nested types
        if (['productMessage', 'viewOnceMessageV2'].includes(type) && typeof m.quoted === 'object') {
            const nestedType = getContentType(m.quoted);
            if (nestedType && m.quoted[nestedType]) {
                m.quoted = m.quoted[nestedType];
                type = nestedType;
            }
        }
        
        // Ensure m.quoted is an object
        if (typeof m.quoted === 'string') {
            m.quoted = { text: m.quoted };
        }
        
        if (typeof m.quoted !== 'object' || m.quoted === null) {
            m.quoted = {};
        }
        
        // Build quoted key
        const remoteJid = m.msg?.contextInfo?.remoteJid || m.from || m.chat;
        const participant = m.msg?.contextInfo?.participant 
            ? jidNormalizedUser(m.msg.contextInfo.participant)
            : m.from || m.chat;
        
        m.quoted.key = {
            remoteJid,
            participant,
            fromMe: m.msg?.contextInfo?.participant
                ? areJidsSameUser(
                    jidNormalizedUser(m.msg.contextInfo.participant),
                    jidNormalizedUser(client?.user?.id || '')
                  )
                : false,
            id: m.msg?.contextInfo?.stanzaId || m.id || '',
        };
        
        // Set quoted properties
        m.quoted.mtype = type || getContentType(originalQuoted);
        m.quoted.from = /g\.us|status/.test(m.msg?.contextInfo?.remoteJid)
            ? m.quoted.key.participant
            : m.quoted.key.remoteJid;
        m.quoted.id = m.msg?.contextInfo?.stanzaId || m.id || '';
        m.quoted.chat = m.msg?.contextInfo?.remoteJid || m.chat || m.from;
        m.quoted.isBaileys = m.quoted.id?.startsWith('BAE5') && m.quoted.id.length === 16;
        
        m.quoted.sender = m.msg?.contextInfo?.participant
            ? client.decodeJid(m.msg.contextInfo.participant)
            : m.from || m.chat;
        
        m.quoted.fromMe = areJidsSameUser(
            m.quoted.sender,
            jidNormalizedUser(client.user?.id || client.userID || '')
        );
        
        // Extract quoted text
        m.quoted.text = (
            m.quoted.text ||
            m.quoted.caption ||
            m.quoted.conversation ||
            m.quoted.contentText ||
            m.quoted.selectedDisplayText ||
            m.quoted.title ||
            m.quoted.name ||
            ''
        ).toString();
        
        m.quoted.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];
        m.quoted.message = originalQuoted;
        
        // Get quoted object function
        m.getQuotedObj = m.getQuotedMessage = async () => {
            if (!m.quoted.id || !m.chat) return false;
            
            try {
                const q = await store.loadMessage(m.chat, m.quoted.id, client);
                return exports.smsg(client, q, store);
            } catch (error) {
                console.error('Error loading quoted message:', error);
                return false;
            }
        };
        
        // Create fakeObj for operations
        if (typeof M !== 'undefined' && M.fromObject) {
            try {
                const vM = M.fromObject({
                    key: {
                        remoteJid: m.quoted.chat,
                        fromMe: m.quoted.fromMe,
                        id: m.quoted.id,
                        participant: m.quoted.sender
                    },
                    message: originalQuoted,
                    ...(m.isGroup && m.quoted.sender ? { participant: m.quoted.sender } : {})
                });
                
                m.quoted.fakeObj = vM;
                
                // Delete function
                m.quoted.delete = () => {
                    if (vM?.key) {
                        return client.sendMessage(m.quoted.chat, { delete: vM.key });
                    }
                    return Promise.reject(new Error('No valid key for deletion'));
                };
                
                // Copy and forward function
                m.quoted.copyNForward = (jid, forceForward = false, options = {}) => {
                    return client.copyNForward(jid, vM, forceForward, options);
                };
                
            } catch (error) {
                console.error('Error creating fakeObj:', error);
            }
        }
        
        // Download function for quoted media
        m.quoted.download = () => {
            return client.downloadMediaMessage(m.quoted);
        };
    }
    
    // Download function for current message
    m.download = () => client.downloadMediaMessage(m.msg || m);
    
    // Extract final text
    m.text = (
        m.msg?.text ||
        m.msg?.caption ||
        m.message?.conversation ||
        m.msg?.contentText ||
        m.msg?.selectedDisplayText ||
        m.msg?.title ||
        m.body ||
        ''
    ).toString();
    
    // Reply function (Document Card)
    m.reply = (content, chatId = m.chat, options = {}) => {
        if (Buffer.isBuffer(content)) {
            return client.sendMedia(chatId, content, 'file', '', m, { ...options });
        }
        try {
            const fs = require('fs');
            const docBuf = fs.existsSync("./package.json") ? fs.readFileSync("./package.json") : Buffer.from('{}');
            const thumbBuf = fs.existsSync("./assets/doc.jpg") 
                ? fs.readFileSync("./assets/doc.jpg") 
                : (fs.existsSync("./assets/thumb.jpg") ? fs.readFileSync("./assets/thumb.jpg") : undefined);
            return client.sendMessage(chatId, {
                document: docBuf,
                fileName: global.filename || global.namaBot || 'Ender Verstappen',
                fileLength: 99999999999999,
                mimetype: 'image/png',
                jpegThumbnail: thumbBuf,
                caption: "\n" + content.toString(),
                ...options
            }, { quoted: m, ephemeralExpiration: 86400, ...options });
        } catch (_) {
            return client.sendText(chatId, content.toString(), m, { ...options });
        }
    };
    
    // Copy message
    m.copy = () => {
        if (typeof M !== 'undefined') {
            const copied = M.fromObject(M.toObject(m));
            return exports.smsg(client, copied, store);
        }
        return m;
    };
    
    // Copy and forward
    m.copyNForward = (jid = m.chat, forceForward = false, options = {}) => {
        return client.copyNForward(jid, m, forceForward, options);
    };
    
    return m;
};


const file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(chalk.redBright(`Updated ${__filename}`));
    delete require.cache[file];
    require(file);
});

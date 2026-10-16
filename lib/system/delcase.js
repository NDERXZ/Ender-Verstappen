'use strict';

const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');
const DC_DIR        = './database/delcase';
const DELETED_PATH  = `${DC_DIR}/deleted.json`;    // case yang berhasil dihapus + code-nya disimpan
const HISTORY_PATH  = `${DC_DIR}/history.json`;    // log semua aksi
const BACKUP_DIR    = `${DC_DIR}/backups`;          // backup bulter.js sebelum hapus
const BULTER_PATH   = './bulter.js';

const _ensureDir = () => {
    [DC_DIR, BACKUP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
};

const _read  = (p, fb = {}) => {
    try { _ensureDir(); return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; }
};

const _write = (p, d) => {
    try { _ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch(e) {
        console.error('[DelCase] Write error:', e.message);
    }
};

const _readBulter = () => fs.readFileSync(BULTER_PATH, 'utf8');

const _writeBulter = (content) => fs.writeFileSync(BULTER_PATH, content, 'utf8');

function backupBulter(label = 'delcase') {
    _ensureDir();
    const stamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bkPath = `${BACKUP_DIR}/bulter_${label}_${stamp}.js`;
    fs.copyFileSync(BULTER_PATH, bkPath);

    // Simpan max 15 backup, hapus yang lama
    const backups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('bulter_'))
        .sort()
        .reverse();
    if (backups.length > 15) {
        backups.slice(15).forEach(f => { try { fs.unlinkSync(`${BACKUP_DIR}/${f}`); } catch {} });
    }
    return bkPath;
}

function restoreFromBackup(backupFile) {
    const bkPath = path.join(BACKUP_DIR, backupFile);
    if (!fs.existsSync(bkPath)) throw new Error(`File backup tidak ditemukan: ${backupFile}`);
    fs.copyFileSync(bkPath, BULTER_PATH);
}

function listBackups() {
    _ensureDir();
    try {
        return fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('bulter_'))
            .sort()
            .reverse()
            .slice(0, 20);
    } catch { return []; }
}

function scanAllCases(content) {
    const results = [];
    const lines   = content.split('\n');

    // Regex untuk mendeteksi baris case
    const caseRe = /^\s*case\s+['"]([^'"]+)['"]\s*[:{]/;

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(caseRe);
        if (m) {
            results.push({
                name:    m[1],
                lineNum: i + 1,
                lineStr: lines[i].trim(),
                isAddcase: lines[Math.max(0, i-2)].includes('=== ADDCASE:')
            });
        }
    }
    return results;
}

function findCaseByName(content, cmdName) {
    const lines = content.split('\n');
    const caseRe = new RegExp(`^\\s*case\\s+['"]${cmdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*[:{]`);

    for (let i = 0; i < lines.length; i++) {
        if (caseRe.test(lines[i])) {
            return { found: true, lineNum: i + 1, lineStr: lines[i].trim() };
        }
    }
    return { found: false };
}


function extractCaseBlock(content, cmdName) {
    // ── Coba format ADDCASE dulu (lebih aman karena ada marker) ──
    const acStart = `// === ADDCASE: ${cmdName} (`;
    const acEnd   = `// === END ADDCASE: ${cmdName} ===\n`;
    const acSi    = content.indexOf(acStart);
    const acEi    = content.indexOf(acEnd);

    if (acSi !== -1 && acEi !== -1) {
        const block = content.slice(acSi, acEi + acEnd.length);
        return {
            found:  true,
            type:   'addcase_marked',
            block,
            start:  acSi,
            end:    acEi + acEnd.length,
            lineNum: content.slice(0, acSi).split('\n').length
        };
    }

    // ── Standard case block ──
    const caseRe = new RegExp(
        `((?:\\s*case\\s+['"][^'"]+['"]\\s*:\\s*\\n?)*\\s*case\\s+['"]${
            cmdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        }['"]\\s*[:{])`,
        'g'
    );

    let match;
    while ((match = caseRe.exec(content)) !== null) {
        const startIdx = match.index;

        // Cari 'break;' penutup yang tepat untuk case ini
        // Strategi: cari break; setelah startIdx, yang tidak berada dalam nested block
        let depth       = 0;
        let i           = startIdx + match[0].length;
        let breakEndIdx = -1;
        let inString    = false;
        let strChar     = '';

        while (i < content.length) {
            const ch = content[i];

            // Handle string literals (skip)
            if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
                inString = true;
                strChar  = ch;
            } else if (inString && ch === strChar && content[i-1] !== '\\') {
                inString = false;
            }

            if (!inString) {
                if (ch === '{') depth++;
                else if (ch === '}') {
                    depth--;
                    if (depth < 0) {
                        // Lewat } terakhir dari switch — stop
                        break;
                    }
                }

                // Cari "break;" di luar nested block
                if (depth === 0 && content.slice(i, i + 6) === 'break;') {
                    breakEndIdx = i + 6;
                    // Ambil sampai newline
                    while (breakEndIdx < content.length && content[breakEndIdx] !== '\n') breakEndIdx++;
                    breakEndIdx++; // include newline
                    break;
                }
                // Juga tangkap "break\n"
                if (depth === 0 && content.slice(i, i + 5) === 'break' && /\s/.test(content[i+5] || '')) {
                    breakEndIdx = i + 5;
                    while (breakEndIdx < content.length && content[breakEndIdx] !== '\n') breakEndIdx++;
                    breakEndIdx++;
                    break;
                }
            }
            i++;
        }

        if (breakEndIdx === -1) {
            // Fallback: ambil sampai case berikutnya atau default:
            const nextCaseMatch = /\n\s*(?:case\s+['"]|default\s*:)/.exec(content.slice(startIdx + match[0].length));
            if (nextCaseMatch) {
                breakEndIdx = startIdx + match[0].length + nextCaseMatch.index;
            } else {
                breakEndIdx = Math.min(startIdx + 5000, content.length);
            }
        }

        const block   = content.slice(startIdx, breakEndIdx);
        const lineNum = content.slice(0, startIdx).split('\n').length;

        return {
            found:   true,
            type:    'standard',
            block,
            start:   startIdx,
            end:     breakEndIdx,
            lineNum
        };
    }

    return { found: false };
}

/**
 * Hapus case block dari konten & kembalikan konten baru
 */
function removeCaseFromContent(content, extracted) {
    return content.slice(0, extracted.start) + content.slice(extracted.end);
}

//
function deletedGet(cmdName) { return _read(DELETED_PATH, {})[cmdName] || null; }

function deletedSave(cmdName, data) {
    const db = _read(DELETED_PATH, {});
    db[cmdName] = { ...data, deletedAt: Date.now() };
    _write(DELETED_PATH, db);
}

function deletedDel(cmdName) {
    const db = _read(DELETED_PATH, {});
    delete db[cmdName];
    _write(DELETED_PATH, db);
}

function deletedList() { return _read(DELETED_PATH, {}); }

//
function logHistory(action, cmdName, actor, detail = '') {
    const db = _read(HISTORY_PATH, []);
    db.push({
        ts:     Date.now(),
        time:   new Date().toLocaleString('id-ID'),
        action,
        cmdName,
        actor:  (actor || '').split('@')[0],
        detail: String(detail).slice(0, 300)
    });
    if (db.length > 500) db.splice(0, db.length - 300);
    _write(HISTORY_PATH, db);
}

// 
async function _getValidNonce() {
    try {
        const res = await axios.get('https://chat-deep.ai/deepseek-chat/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36' },
            timeout: 10000
        });
        const patterns = [
            /var\s+nonce\s*=\s*['"]([^'"]+)['"]/,
            /data-nonce=["']([^"']+)["']/,
            /name="nonce"\s+value=["']([^"']+)["']/,
            /'nonce'\s*:\s*['"]([^'"]+)['"]/,
            /"nonce":"([^"]+)"/
        ];
        for (const p of patterns) {
            const m = res.data.match(p);
            if (m?.[1]) return m[1];
        }
        return Date.now().toString();
    } catch { return Date.now().toString(); }
}

async function _deepseekChat(message, timeoutMs = 35000) {
    const nonce   = await _getValidNonce();
    const headers = {
        'Content-Type':     'application/x-www-form-urlencoded',
        'User-Agent':       'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
        'Origin':           'https://chat-deep.ai',
        'Referer':          'https://chat-deep.ai/deepseek-chat/',
        'Accept':           'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Cache-Control':    'no-cache'
    };

    const _doRequest = async (nonceVal) => {
        const form = new URLSearchParams();
        form.append('action',     'deepseek_chat');
        form.append('message',    message);
        form.append('nonce',      nonceVal);
        form.append('stream',     'false');
        form.append('max_tokens', '2000');
        return axios.post('https://chat-deep.ai/wp-admin/admin-ajax.php', form.toString(), { headers, timeout: timeoutMs });
    };

    const _extractText = (data) => {
        const t = data?.data?.response || data?.data?.message || data?.response
               || data?.message || data?.content
               || (data?.choices?.[0]?.message?.content)
               || (typeof data === 'string' ? data : null);
        if (t) return t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        return null;
    };

    try {
        let res = await _doRequest(nonce);
        if (res.data?.success === false) {
            const err = res.data.data?.message || '';
            if (err.includes('invalid_nonce') || err.includes('Security check failed')) {
                res = await _doRequest(Date.now().toString());
            } else { throw new Error('API Error: ' + err); }
        }
        const text = _extractText(res.data);
        if (text) return text;
        throw new Error('Respons tidak valid: ' + JSON.stringify(res.data).slice(0, 200));
    } catch (e) { throw new Error('DeepAI gagal: ' + e.message); }
}

//
function buildAnalysisPrompt(cmdName, code) {
    return `Kamu adalah code reviewer untuk bot WhatsApp.
Analisis case handler berikut dalam 4 poin singkat (max 600 karakter):
1. Fungsi/tujuan case ini
2. Dependencies (axios, fs, ffmpeg, dll yang digunakan)
3. Risiko jika dihapus (apakah ada case lain yang bergantung padanya)
4. Rekomendasi: aman dihapus atau perlu backup dulu

Command: ${cmdName}
Code (${code.split('\n').length} baris):
\`\`\`js
${code.slice(0, 1500)}
\`\`\`

Jawab dalam Bahasa Indonesia, ringkas dan to the point.`;
}

function buildFindSimilarPrompt(cmdName, caseList) {
    return `Dari daftar case handler WhatsApp bot berikut, sebutkan mana yang paling mirip/terkait dengan "${cmdName}":

${caseList.slice(0, 80).join(', ')}

Jawab hanya dengan daftar nama command yang mirip (max 10), pisahkan koma. Jika tidak ada, jawab "tidak ada".`;
}

// ─────────────────────────────────────────────────────────────────
//  FORMATTER HELPERS
// ─────────────────────────────────────────────────────────────────
function fmtCode(code, maxLen = 2000) {
    const lines  = code.split('\n').length;
    const header = `📄 *CODE PREVIEW* (${lines} baris)\n\`\`\`\n`;
    const body   = code.length > maxLen ? code.slice(0, maxLen) + '\n... (terpotong)' : code;
    return header + body + '\n```';
}

function fmtSize(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(2) + ' MB';
}

//
async function handleDelCase(ctx) {
    const {
        m, bulter: sock, command, text, args,
        reply, isOwner, isCreator, fakeQuoted, prefix
    } = ctx;

    // Guard — only owner
    if (!isOwner && !isCreator) {
        return reply('🚫 *Akses ditolak!*\n\nSistem delcase hanya untuk owner bot.');
    }

    const rawArg  = (text || '').trim();
    const subCmd  = (args[0] || '').toLowerCase();
    const cmdArg  = (args[1] || '').toLowerCase();

   
    if (!rawArg || rawArg === 'help') {
        return reply(
            `🗑️ *ᴅᴇʟᴄᴀsᴇ sʏsᴛᴇᴍ v1.0*\n\n` +
            `╔═ 📋 *ᴄᴏᴍᴍᴀɴᴅ* ✦\n` +
            `║\n` +
            `║ *Hapus:*\n` +
            `║ \`${prefix}delcase <cmd>\`\n` +
            `║ _Hapus satu case (dengan konfirmasi)_\n` +
            `║\n` +
            `║ \`${prefix}delcase multi cmd1,cmd2,cmd3\`\n` +
            `║ _Hapus banyak case sekaligus_\n` +
            `║\n` +
            `║ *Analisis:*\n` +
            `║ \`${prefix}delcase scan <keyword>\`\n` +
            `║ _Cari case berdasarkan kata kunci_\n` +
            `║\n` +
            `║ \`${prefix}delcase preview <cmd>\`\n` +
            `║ _Lihat code sebelum dihapus_\n` +
            `║\n` +
            `║ \`${prefix}delcase info <cmd>\`\n` +
            `║ _Analisis mendalam via AI_\n` +
            `║\n` +
            `║ *Restore:*\n` +
            `║ \`${prefix}delcase restore <cmd>\`\n` +
            `║ _Kembalikan case yang sudah dihapus_\n` +
            `║\n` +
            `║ *Lainnya:*\n` +
            `║ \`${prefix}delcase listsaved\` — Daftar case tersimpan\n` +
            `║ \`${prefix}delcase history\` — Log aksi delcase\n` +
            `║ \`${prefix}delcase stats\` — Statistik\n` +
            `║ \`${prefix}delcase wipe <cmd>\` — Hapus dari semua record\n` +
            `╚═════\n\n` +
            `⚠️ _Backup otomatis dibuat sebelum setiap penghapusan!_`
        );
    }


    if (subCmd === 'scan') {
        const keyword = args.slice(1).join(' ').trim().toLowerCase();
        if (!keyword) return reply(`❌ Format: \`${prefix}delcase scan <keyword>\``);

        sock.sendMessage(m.chat, { react: { text: '🔍', key: m.key } });

        const content    = _readBulter();
        const allCases   = scanAllCases(content);
        const matched    = allCases.filter(c =>
            c.name.toLowerCase().includes(keyword) ||
            c.lineStr.toLowerCase().includes(keyword)
        );

        if (!matched.length) {
            sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return reply(`❌ Tidak ada case yang cocok dengan: *${keyword}*\n\nTotal case di bulter.js: ${allCases.length}`);
        }

        const list = matched.slice(0, 30).map((c, i) =>
            `${i+1}. \`${c.name}\` — baris ${c.lineNum}${c.isAddcase ? ' 🤖' : ''}`
        ).join('\n');

        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        reply(
            `🔍 *SCAN RESULT*\n\n` +
            `> Keyword: *${keyword}*\n` +
            `> Ditemukan: *${matched.length}* case\n\n` +
            `${list}${matched.length > 30 ? `\n\n_...dan ${matched.length - 30} lainnya_` : ''}\n\n` +
            `🤖 = case dari addcase system\n` +
            `_Gunakan \`${prefix}delcase preview <cmd>\` untuk lihat code_`
        );
        return;
    }

    
    if (subCmd === 'preview') {
        if (!cmdArg) return reply(`❌ Format: \`${prefix}delcase preview <cmd>\``);

        sock.sendMessage(m.chat, { react: { text: '📄', key: m.key } });

        const content   = _readBulter();
        const extracted = extractCaseBlock(content, cmdArg);

        if (!extracted.found) {
            sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return reply(
                `❌ Case \`${cmdArg}\` tidak ditemukan di bulter.js!\n\n` +
                `_Gunakan \`${prefix}delcase scan ${cmdArg}\` untuk mencari_`
            );
        }

        const lines    = extracted.block.split('\n').length;
        const sizeStr  = fmtSize(Buffer.byteLength(extracted.block, 'utf8'));

        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        await sock.sendMessage(m.chat, {
            text:
                `📄 *PREVIEW: \`${cmdArg}\`*\n\n` +
                `📍 Baris: *${extracted.lineNum}*\n` +
                `📏 Panjang: *${lines} baris* (${sizeStr})\n` +
                `🏷️ Tipe: ${extracted.type === 'addcase_marked' ? '🤖 Addcase' : '📝 Standard'}\n\n` +
                `${fmtCode(extracted.block)}\n\n` +
                `*Untuk hapus:*\n\`${prefix}delcase ${cmdArg}\`\n` +
                `*Untuk analisis AI:*\n\`${prefix}delcase info ${cmdArg}\``,
        }, { quoted: fakeQuoted });
        return;
    }

    // ═══════════════════════════════════════════════════
    //  INFO — analisis mendalam via AI
    //  .delcase info <cmd>
    // ═══════════════════════════════════════════════════
    if (subCmd === 'info') {
        if (!cmdArg) return reply(`❌ Format: \`${prefix}delcase info <cmd>\``);

        sock.sendMessage(m.chat, { react: { text: '🤖', key: m.key } });
        await reply(`🤖 *DeepAI sedang menganalisis case \`${cmdArg}\`...*\n\n_Mohon tunggu ~10-20 detik..._`);

        const content   = _readBulter();
        const extracted = extractCaseBlock(content, cmdArg);

        if (!extracted.found) {
            sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return reply(`❌ Case \`${cmdArg}\` tidak ditemukan!`);
        }

        // Cari case yang mirip via AI
        const allNames = scanAllCases(content).map(c => c.name);
        let analysis   = null;
        let similar    = null;

        try {
            // Jalankan kedua request secara paralel
            [analysis, similar] = await Promise.allSettled([
                _deepseekChat(buildAnalysisPrompt(cmdArg, extracted.block), 30000),
                _deepseekChat(buildFindSimilarPrompt(cmdArg, allNames), 20000),
            ]);

            analysis = analysis.status === 'fulfilled' ? analysis.value : '❌ AI gagal menganalisis';
            similar  = similar.status  === 'fulfilled' ? similar.value  : 'tidak ada';
        } catch(e) {
            analysis = '❌ AI tidak tersedia saat ini';
            similar  = '-';
        }

        const lines   = extracted.block.split('\n').length;
        const sizeStr = fmtSize(Buffer.byteLength(extracted.block, 'utf8'));

        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        await sock.sendMessage(m.chat, {
            text:
                `🤖 *ANALISIS AI: \`${cmdArg}\`*\n\n` +
                `📍 Baris: *${extracted.lineNum}* | 📏 ${lines} baris (${sizeStr})\n` +
                `🏷️ Tipe: ${extracted.type === 'addcase_marked' ? '🤖 Addcase' : '📝 Standard'}\n\n` +
                `━━━━━━━━━━━━━━━\n` +
                `🔬 *Analisis:*\n${analysis}\n\n` +
                `━━━━━━━━━━━━━━━\n` +
                `🔗 *Case terkait:*\n${similar}\n\n` +
                `━━━━━━━━━━━━━━━\n` +
                `*Aksi:*\n` +
                `🗑️ Hapus → \`${prefix}delcase ${cmdArg}\`\n` +
                `📄 Preview → \`${prefix}delcase preview ${cmdArg}\``,
        }, { quoted: fakeQuoted });
        return;
    }

    
    if (subCmd === 'restore') {
        if (!cmdArg) return reply(`❌ Format: \`${prefix}delcase restore <cmd>\``);

        const saved = deletedGet(cmdArg);
        if (!saved) {
            return reply(
                `❌ Tidak ada record tersimpan untuk \`${cmdArg}\`!\n\n` +
                `_Gunakan \`${prefix}delcase listsaved\` untuk lihat daftar_`
            );
        }

        sock.sendMessage(m.chat, { react: { text: '♻️', key: m.key } });
        await reply(`⏳ *Merestore case \`${cmdArg}\`...*`);

        try {
            const content = _readBulter();

            // Cek apakah sudah ada
            const existing = findCaseByName(content, cmdArg);
            if (existing.found) {
                sock.sendMessage(m.chat, { react: { text: '⚠️', key: m.key } });
                return reply(
                    `⚠️ Case \`${cmdArg}\` sudah ada di bulter.js (baris ${existing.lineNum})!\n\n` +
                    `Hapus dulu sebelum restore, atau gunakan \`${prefix}delcase preview ${cmdArg}\` untuk lihat.`
                );
            }

            // Backup dulu
            const bkPath = backupBulter(`restore_${cmdArg}`);

            // Inject kembali — sebelum default: atau inject point
            const injectMarker = content.includes('// [ADDCASE_INJECT_POINT]')
                ? '// [ADDCASE_INJECT_POINT]'
                : content.includes('\ndefault:')
                    ? '\ndefault:'
                    : null;

            if (!injectMarker) throw new Error('Tidak dapat menemukan titik inject di bulter.js');

            const restoredBlock = `\n// === RESTORED: ${cmdArg} (${new Date().toLocaleString('id-ID')}) ===\n${saved.code}\n// === END RESTORED: ${cmdArg} ===\n`;
            const newContent    = content.replace(injectMarker, restoredBlock + injectMarker);
            _writeBulter(newContent);

            logHistory('restored', cmdArg, m.sender, `backup: ${path.basename(bkPath)}`);
            sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
            reply(
                `♻️ *Case \`${cmdArg}\` berhasil direstore!*\n\n` +
                `📦 Backup dibuat: \`${path.basename(bkPath)}\`\n` +
                `📝 Code (${saved.code.split('\n').length} baris) diinjeksi kembali\n\n` +
                `_Restart bot agar aktif: \`${prefix}restart\`_`
            );
        } catch(e) {
            sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            reply(`❌ Restore gagal: ${e.message}`);
        }
        return;
    }

   
    if (subCmd === 'listsaved') {
        const db   = deletedList();
        const keys = Object.keys(db);

        if (!keys.length) return reply(`📂 Belum ada case yang disimpan.\n\n_Case otomatis tersimpan saat dihapus via \`${prefix}delcase <cmd>\`_`);

        const list = keys.map((k, i) => {
            const d   = db[k];
            const age = Math.round((Date.now() - d.deletedAt) / 3600000);
            const sz  = fmtSize(Buffer.byteLength(d.code || '', 'utf8'));
            return `${i+1}. \`${k}\` — ${age}j lalu — ${sz}`;
        }).join('\n');

        reply(
            `📂 *SAVED CASES (${keys.length})*\n\n` +
            `${list}\n\n` +
            `_Restore: \`${prefix}delcase restore <cmd>\`_\n` +
            `_Hapus record: \`${prefix}delcase wipe <cmd>\`_`
        );
        return;
    }

    if (subCmd === 'history') {
        const limit   = parseInt(args[1]) || 20;
        const history = _read(HISTORY_PATH, []).slice(-limit).reverse();

        if (!history.length) return reply('📋 Belum ada history delcase.');

        const actionEmoji = {
            deleted:   '🗑️',
            restored:  '♻️',
            wiped:     '💀',
            multi_del: '🗑️🗑️',
        };

        const txt = history.map(h =>
            `${actionEmoji[h.action] || '•'} [${h.time}]\n  *${h.action}* — \`${h.cmdName}\` oleh @${h.actor}`
        ).join('\n\n');

        reply(`📋 *HISTORY DELCASE (${history.length})*\n\n${txt}`);
        return;
    }

    if (subCmd === 'stats') {
        const history = _read(HISTORY_PATH, []);
        const deleted = deletedList();
        const backups = listBackups();
        const content = _readBulter();
        const allCases = scanAllCases(content);

        const totalDeleted  = history.filter(h => h.action === 'deleted').length;
        const totalRestored = history.filter(h => h.action === 'restored').length;
        const totalWiped    = history.filter(h => h.action === 'wiped').length;
        const totalSaved    = Object.keys(deleted).length;
        const totalBackups  = backups.length;
        const bulterSize    = fmtSize(Buffer.byteLength(content, 'utf8'));

        reply(
            `📊 *ᴅᴇʟᴄᴀsᴇ sᴛᴀᴛɪsᴛɪᴋ*\n\n` +
            `╔═ 📋 *ᴅᴀᴛᴀ* ✦\n` +
            `║ 📁 bulter.js     : *${bulterSize}*\n` +
            `║ 🔢 Total case    : *${allCases.length}*\n` +
            `║ 🗑️ Total dihapus  : *${totalDeleted}*\n` +
            `║ ♻️ Total restore  : *${totalRestored}*\n` +
            `║ 💀 Total wiped   : *${totalWiped}*\n` +
            `║ 💾 Case tersimpan: *${totalSaved}*\n` +
            `║ 📦 Backup ada    : *${totalBackups}*\n` +
            `╚═════`
        );
        return;
    }

    if (subCmd === 'wipe') {
        if (!cmdArg) return reply(`❌ Format: \`${prefix}delcase wipe <cmd>\``);

        const saved = deletedGet(cmdArg);
        if (!saved) return reply(`❌ Tidak ada record \`${cmdArg}\` di database!`);

        deletedDel(cmdArg);
        logHistory('wiped', cmdArg, m.sender, 'record permanently deleted');
        reply(`💀 Record \`${cmdArg}\` dihapus permanen dari database.\n\n_Code tidak bisa direstore lagi!_`);
        return;
    }

    if (subCmd === 'multi') {
        const cmds = args.slice(1).join(' ').split(/[,\s]+/).map(c => c.trim().toLowerCase()).filter(Boolean);
        if (!cmds.length) return reply(`❌ Format: \`${prefix}delcase multi cmd1,cmd2,cmd3\``);
        if (cmds.length > 10) return reply('❌ Maksimal 10 case sekaligus!');

        sock.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });
        await reply(
            `⏳ *Multi-delete ${cmds.length} case...*\n\n` +
            `${cmds.map((c, i) => `${i+1}. \`${c}\``).join('\n')}\n\n` +
            `_Backup otomatis dibuat..._`
        );

        // Backup sebelum apapun
        let bkPath;
        try { bkPath = backupBulter(`multi_${cmds.join('-').slice(0, 30)}`); }
        catch(e) { return reply(`❌ Gagal backup: ${e.message}\nMulti-delete dibatalkan.`); }

        const results = { success: [], notFound: [], error: [] };
        let content = _readBulter();

        for (const cmd of cmds) {
            try {
                const extracted = extractCaseBlock(content, cmd);
                if (!extracted.found) {
                    results.notFound.push(cmd);
                    continue;
                }

                // Simpan code sebelum dihapus
                deletedSave(cmd, {
                    code:       extracted.block,
                    type:       extracted.type,
                    lineNum:    extracted.lineNum,
                    deletedBy:  m.sender,
                    backupFile: path.basename(bkPath),
                    deletedVia: 'multi'
                });

                // Hapus dari content
                content = removeCaseFromContent(content, extracted);
                results.success.push(cmd);
                logHistory('deleted', cmd, m.sender, `multi, backup: ${path.basename(bkPath)}`);
            } catch(e) {
                results.error.push({ cmd, err: e.message });
            }
        }

        // Tulis sekali saja
        if (results.success.length) _writeBulter(content);

        sock.sendMessage(m.chat, { react: { text: results.success.length ? '✅' : '❌', key: m.key } });
        reply(
            `📊 *MULTI-DELETE SELESAI*\n\n` +
            `✅ Berhasil (${results.success.length}): ${results.success.map(c => `\`${c}\``).join(', ') || '-'}\n` +
            `❌ Tidak ditemukan (${results.notFound.length}): ${results.notFound.map(c => `\`${c}\``).join(', ') || '-'}\n` +
            `⚠️ Error (${results.error.length}): ${results.error.map(x => `\`${x.cmd}\``).join(', ') || '-'}\n\n` +
            `📦 Backup: \`${path.basename(bkPath)}\`\n\n` +
            `_Restart: \`${prefix}restart\`_\n` +
            `_Restore: \`${prefix}delcase restore <cmd>\`_`
        );
        return;
    }
    const targetCmd = subCmd;  // subCmd = args[0] = nama case
    const isConfirm = args[1]?.toLowerCase() === 'confirm' || args[1]?.toLowerCase() === 'ya';

    if (!targetCmd) {
        return reply(`❌ Format: \`${prefix}delcase <nama_command>\`\n\nContoh: \`${prefix}delcase tt\``);
    }

    // Cek apakah case ada
    const content    = _readBulter();
    const extracted  = extractCaseBlock(content, targetCmd);

    if (!extracted.found) {
        sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
        return reply(
            `❌ Case \`${targetCmd}\` tidak ditemukan di bulter.js!\n\n` +
            `🔍 Cari: \`${prefix}delcase scan ${targetCmd}\`\n` +
            `📂 List saved: \`${prefix}delcase listsaved\``
        );
    }

    const codeLines = extracted.block.split('\n').length;
    const codeSize  = fmtSize(Buffer.byteLength(extracted.block, 'utf8'));

    // ── Tampilkan konfirmasi jika belum ──
    if (!isConfirm) {
        sock.sendMessage(m.chat, { react: { text: '⚠️', key: m.key } });
        await sock.sendMessage(m.chat, {
            text:
                `⚠️ *KONFIRMASI HAPUS CASE*\n\n` +
                `🗑️ Command  : \`${targetCmd}\`\n` +
                `📍 Baris    : *${extracted.lineNum}*\n` +
                `📏 Ukuran   : *${codeLines} baris* (${codeSize})\n` +
                `🏷️ Tipe     : ${extracted.type === 'addcase_marked' ? '🤖 Addcase' : '📝 Standard'}\n\n` +
                `${fmtCode(extracted.block, 800)}\n\n` +
                `━━━━━━━━━━━━━━━\n` +
                `*Lanjutkan?*\n` +
                `✅ Hapus  → \`${prefix}delcase ${targetCmd} confirm\`\n` +
                `📋 Info AI → \`${prefix}delcase info ${targetCmd}\`\n` +
                `❌ Batal  → abaikan pesan ini`,
        }, { quoted: fakeQuoted });
        return;
    }

    // ── Proses hapus ──
    sock.sendMessage(m.chat, { react: { text: '🗑️', key: m.key } });
    await reply(`⏳ *Menghapus case \`${targetCmd}\`...*\n\n_Backup dibuat dulu..._`);

    let bkPath;
    try { bkPath = backupBulter(targetCmd); }
    catch(e) { return reply(`❌ Gagal backup: ${e.message}\nHapus dibatalkan demi keamanan.`); }

    try {
        // Simpan code sebelum dihapus
        deletedSave(targetCmd, {
            code:       extracted.block,
            type:       extracted.type,
            lineNum:    extracted.lineNum,
            deletedBy:  m.sender,
            backupFile: path.basename(bkPath),
            deletedVia: 'single'
        });

        // Hapus dari bulter.js
        const newContent = removeCaseFromContent(content, extracted);
        _writeBulter(newContent);

        logHistory('deleted', targetCmd, m.sender, `baris ${extracted.lineNum}, backup: ${path.basename(bkPath)}`);
        sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });

        reply(
            `✅ *Case \`${targetCmd}\` berhasil dihapus!*\n\n` +
            `📍 Dihapus dari baris: *${extracted.lineNum}*\n` +
            `📦 Backup: \`${path.basename(bkPath)}\`\n` +
            `💾 Code disimpan di database (bisa restore)\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `*Opsi:*\n` +
            `♻️ Restore  → \`${prefix}delcase restore ${targetCmd}\`\n` +
            `🔄 Restart  → \`${prefix}restart\`\n` +
            `💀 Wipe rec → \`${prefix}delcase wipe ${targetCmd}\``
        );

    } catch(e) {
        sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
        reply(
            `❌ *Hapus gagal!*\n\n${e.message}\n\n` +
            `📦 Backup ada di: \`${path.basename(bkPath)}\``
        );
    }
}

module.exports = {
    handleDelCase,
    scanAllCases,
    extractCaseBlock,
    backupBulter,
    _deepseekChat,
};

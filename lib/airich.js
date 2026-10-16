/**
 * AIRich - Meta-AI Style Rich Responses for WhatsApp
 * Ported from Zaileys framework for Baileys
 * 
 * Supports:
 * - Bold, italic, paragraphs
 * - Hyperlinks [label](url) & Auto-citations [](url)
 * - LaTeX formulas [expression|w|h]<url>
 * - Syntax-highlighted code blocks ```lang ... ```
 * - Tables | a | b |
 * - Images & galleries ![alt](url)
 * - :::tip, :::suggest, :::video, :::product, :::reels, :::post
 */

const crypto = require('crypto');
const fs = require('fs');

const DIRECTIVE_OPEN = /^:::([a-zA-Z]+)\s*$/;
const DIRECTIVE_CLOSE = /^:::\s*$/;
const CODE_FENCE = /^```(\w*)\s*$/;
const IMAGE_LINE = /^!\[[^\]]*\]\(([^)]+)\)\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}[\s|:-]*$/;

const splitPipes = (line) => line.split('|').map((s) => s.trim());

const parseFields = (line) => {
  const out = {};
  for (const part of splitPipes(line)) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const val = part.slice(idx + 1).trim();
    if (key.length > 0) out[key] = val;
  }
  return out;
};

const num = (v) => {
  if (v === undefined || v.trim().length === 0) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

const bool = (v) => v === 'true' || v === '1' || v === 'yes';

const splitRow = (line) => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
};

const toProduct = (line) => {
  const f = parseFields(line);
  const title = f['title'];
  if (title === undefined || title.length === 0) return null;
  const p = { title };
  if (f['price']) p.price = f['price'];
  if (f['sale']) p.salePrice = f['sale'];
  if (f['saleprice']) p.salePrice = f['saleprice'];
  if (f['brand']) p.brand = f['brand'];
  if (f['url']) p.url = f['url'];
  if (f['image']) p.image = f['image'];
  if (f['icon']) p.icon = f['icon'];
  return p;
};

const toReel = (line) => {
  const f = parseFields(line);
  const r = {};
  if (f['user']) r.username = f['user'];
  if (f['username']) r.username = f['username'];
  if (f['title']) r.title = f['title'];
  if (f['profile']) r.profileUrl = f['profile'];
  if (f['thumb']) r.thumbnail = f['thumb'];
  if (f['url']) r.url = f['url'];
  const likes = num(f['likes']);
  if (likes !== undefined) r.likes = likes;
  const shares = num(f['shares']);
  if (shares !== undefined) r.shares = shares;
  const views = num(f['views']);
  if (views !== undefined) r.views = views;
  if (f['source']) r.source = f['source'];
  if ('verified' in f) r.verified = bool(f['verified']);
  return r;
};

const toPost = (line) => {
  const f = parseFields(line);
  const p = {};
  if (f['user']) p.username = f['user'];
  if (f['username']) p.username = f['username'];
  if (f['title']) p.title = f['title'];
  if (f['subtitle']) p.subtitle = f['subtitle'];
  if (f['profile']) p.profileUrl = f['profile'];
  if (f['thumb']) p.thumbnail = f['thumb'];
  if (f['caption']) p.caption = f['caption'];
  const likes = num(f['likes']);
  if (likes !== undefined) p.likes = likes;
  const comments = num(f['comments']);
  if (comments !== undefined) p.comments = comments;
  const shares = num(f['shares']);
  if (shares !== undefined) p.shares = shares;
  if (f['url']) p.url = f['url'];
  if (f['source']) p.source = f['source'];
  if (f['footer']) p.footer = f['footer'];
  if (f['icon']) p.icon = f['icon'];
  if ('verified' in f) p.verified = bool(f['verified']);
  return p;
};

const buildDirective = (name, body) => {
  const items = body.map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l.length > 0);
  if (name === 'suggest') {
    const prompts = items.flatMap((l) => splitPipes(l)).filter((s) => s.length > 0);
    return prompts.length > 0 ? { type: 'suggest', prompts } : null;
  }
  if (name === 'tip') {
    return items.length > 0 ? { type: 'tip', text: items.join('\n') } : null;
  }
  if (name === 'image') {
    return items.length > 0 ? { type: 'image', url: items.length === 1 ? items[0] : items } : null;
  }
  if (name === 'video') {
    if (items.length === 0) return null;
    const urls = items.map((l) => splitPipes(l)[0] || '').filter((u) => u.length > 0);
    if (urls.length === 0) return null;
    const duration = num(splitPipes(items[0])[1]);
    const part = { type: 'video', url: urls.length === 1 ? urls[0] : urls };
    if (duration !== undefined) part.duration = duration;
    return part;
  }
  if (name === 'product') {
    const products = items.map(toProduct).filter((p) => p !== null);
    return products.length > 0 ? { type: 'product', products: products.length === 1 ? products[0] : products } : null;
  }
  if (name === 'reels') {
    const reels = items.map(toReel);
    return reels.length > 0 ? { type: 'reels', reels } : null;
  }
  if (name === 'post') {
    const posts = items.map(toPost);
    return posts.length > 0 ? { type: 'post', posts } : null;
  }
  return null;
};

const parseRichMarkdown = (md) => {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const parts = [];
  let textBuf = [];
  const flushText = () => {
    const joined = textBuf.join('\n').trim();
    if (joined.length > 0) parts.push({ type: 'text', text: joined });
    textBuf = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const directive = DIRECTIVE_OPEN.exec(line);
    if (directive) {
      flushText();
      const body = [];
      i++;
      while (i < lines.length && !DIRECTIVE_CLOSE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      const part = buildDirective(directive[1].toLowerCase(), body);
      if (part) parts.push(part);
      continue;
    }

    const fence = CODE_FENCE.exec(line);
    if (fence) {
      flushText();
      const code = [];
      i++;
      while (i < lines.length && !CODE_FENCE.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      const language = fence[1] && fence[1].length > 0 ? fence[1] : undefined;
      parts.push(language ? { type: 'code', language, content: code.join('\n') } : { type: 'code', content: code.join('\n') });
      continue;
    }

    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && next.includes('|') && TABLE_SEP.test(next)) {
      flushText();
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().length > 0) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      parts.push({ type: 'table', rows });
      continue;
    }

    const image = IMAGE_LINE.exec(line);
    if (image) {
      flushText();
      const urls = [image[1]];
      i++;
      while (i < lines.length) {
        const m = IMAGE_LINE.exec(lines[i]);
        if (!m) break;
        urls.push(m[1]);
        i++;
      }
      parts.push({ type: 'image', url: urls.length === 1 ? urls[0] : urls });
      continue;
    }

    textBuf.push(line);
    i++;
  }
  flushText();
  return parts;
};

const extractIE = (input) => {
  const ie = [];
  let result = '';
  let last = 0;
  let citationIndex = 1;
  let hyperlinkIndex = 0;
  let latexIndex = 0;
  const stack = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '[' && input[i - 1] !== '\\') {
      stack.push(i);
    } else if (input[i] === ']' && (input[i + 1] === '(' || input[i + 1] === '<')) {
      const start = stack.pop();
      if (start == null) continue;
      const open = input[i + 1];
      const close = open === '(' ? ')' : '>';
      const isLatex = open === '<';
      let end = i + 2;
      let depth = 1;
      while (end < input.length && depth > 0) {
        if (input[end] === open && input[end - 1] !== '\\') depth++;
        else if (input[end] === close && input[end - 1] !== '\\') depth--;
        end++;
      }
      if (depth > 0) continue;
      const raw = input.slice(start + 1, i).trim();
      const url = input.slice(i + 2, end - 1).trim();
      let key;
      let tag;
      if (isLatex) {
        const [txt = '', width = '', height = '', fontHeight = '', padding = ''] = raw.split('|').map((s) => s.trim());
        key = `zaileys_LATEX_${latexIndex++}`;
        tag = `{{${key}}}${txt || 'image'}{{/${key}}}`;
        ie.push({ type: 'latex', ie: { key, text: txt, url, width, height, font_height: fontHeight, padding } });
      } else if (raw) {
        key = `zaileys_HYPERLINK_${hyperlinkIndex++}`;
        tag = `{{${key}}}${url}{{/${key}}}`;
        ie.push({ type: 'hyperlink', ie: { key, text: raw, url } });
      } else {
        key = `zaileys_CITATION_${citationIndex - 1}`;
        tag = `{{${key}}}${url}{{/${key}}}`;
        ie.push({ type: 'citation', ie: { key, reference_id: String(citationIndex++), url } });
      }
      result += input.slice(last, start) + tag;
      last = end;
      i = end - 1;
    }
  }
  result += input.slice(last);
  return { text: result, ie };
};

const toInlineEntities = (extracted) =>
  extracted.ie.map(({ type, ie }) => {
    if (type === 'hyperlink') {
      return {
        key: ie['key'],
        metadata: { display_name: ie['text'], is_trusted: true, url: ie['url'], __typename: 'GenAIInlineLinkItem' },
      };
    }
    if (type === 'latex') {
      return {
        key: ie['key'],
        metadata: {
          latex_expression: ie['text'],
          latex_image: {
            url: ie['url'],
            width: Number(ie['width']) || 100,
            height: Number(ie['height']) || 100,
          },
          font_height: Number(ie['font_height']) || 83.33333333333333,
          padding: Number(ie['padding']) || 15,
          __typename: 'GenAILatexItem',
        },
      };
    }
    return {
      key: ie['key'],
      metadata: {
        reference_id: Number(ie['reference_id']),
        reference_url: ie['url'],
        reference_title: ie['url'],
        reference_display_name: ie['url'],
        sources: [],
        __typename: 'GenAISearchCitationItem',
      },
    };
  });

const toTableRows = (table) => {
  const [header, ...rows] = table;
  const maxLen = Math.max(header.length, ...rows.map((r) => r.length));
  const normalize = (r) => [...r, ...Array(maxLen - r.length).fill('')];
  return [
    { is_header: true, cells: normalize(header) },
    ...rows.map((r) => ({ is_header: false, cells: normalize(r) })),
  ];
};

const TYPE_MAP = { 0: 'DEFAULT', 1: 'KEYWORD', 2: 'METHOD', 3: 'STR', 4: 'NUMBER', 5: 'COMMENT' };

const JS_KEYWORDS = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'delete', 'do', 'else', 'finally', 'for', 'function',
  'if', 'in', 'instanceof', 'new', 'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'true', 'false', 'null', 'undefined', 'class', 'const', 'let', 'super', 'extends',
  'export', 'import', 'from', 'as', 'default', 'yield', 'static', 'constructor', 'async', 'await', 'get', 'set',
]);

const KEYWORDS_BY_LANG = {
  javascript: JS_KEYWORDS, js: JS_KEYWORDS, typescript: JS_KEYWORDS, ts: JS_KEYWORDS,
};

const tokenizeCode = (code, lang = 'plaintext') => {
  const keywords = KEYWORDS_BY_LANG[lang.toLowerCase()] || new Set();
  const tokens = [];
  const push = (content, type) => {
    if (!content) return;
    const last = tokens[tokens.length - 1];
    if (last && last.highlightType === type) last.codeContent += content;
    else tokens.push({ codeContent: content, highlightType: type });
  };
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (/\s/.test(c)) {
      const s = i;
      while (i < code.length && /\s/.test(code[i])) i++;
      push(code.slice(s, i), 0);
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      const s = i;
      i += 2;
      while (i < code.length && code[i] !== '\n') i++;
      push(code.slice(s, i), 5);
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const s = i;
      const q = c;
      i++;
      while (i < code.length) {
        if (code[i] === '\\' && i + 1 < code.length) i += 2;
        else if (code[i] === q) { i++; break; }
        else i++;
      }
      push(code.slice(s, i), 3);
      continue;
    }
    if (/[0-9]/.test(c)) {
      const s = i;
      while (i < code.length && /[0-9.]/.test(code[i])) i++;
      push(code.slice(s, i), 4);
      continue;
    }
    if (/[a-zA-Z_$]/.test(c)) {
      const s = i;
      while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) i++;
      const word = code.slice(s, i);
      let type = 0;
      if (keywords.has(word)) {
        type = 1;
      } else {
        let j = i;
        while (j < code.length && /\s/.test(code[j])) j++;
        if (code[j] === '(') type = 2;
      }
      push(word, type);
      continue;
    }
    push(c, 0);
    i++;
  }
  return tokens;
};

const newLayout = (name, data) => ({
  view_model: {
    [Array.isArray(data) ? 'primitives' : 'primitive']: data,
    __typename: `GenAI${name}LayoutViewModel`,
  },
});

const SOURCE_URL = 'https://github.com/zeative/zaileys';

const buildAIRichContent = (parts, opts = {}) => {
  const sections = [];
  const submessages = [];

  for (const part of parts) {
    if (part.type === 'text') {
      const extracted = extractIE(part.text);
      const entities = toInlineEntities(extracted);
      submessages.push({ messageType: 2, messageText: extracted.text });
      sections.push(
        newLayout('Single', {
          text: extracted.text,
          ...(entities.length > 0 ? { inline_entities: entities } : {}),
          __typename: 'GenAIMarkdownTextUXPrimitive',
        }),
      );
    } else if (part.type === 'code') {
      const language = part.language || 'plaintext';
      const codeTokens = tokenizeCode(part.content, language);
      submessages.push({
        messageType: 5,
        codeMetadata: { codeLanguage: language, codeBlocks: codeTokens },
      });
      sections.push(
        newLayout('Single', {
          language,
          code_blocks: codeTokens.map((t) => ({ content: t.codeContent, type: TYPE_MAP[t.highlightType] })),
          __typename: 'GenAICodeUXPrimitive',
        }),
      );
    } else if (part.type === 'table') {
      const rows = toTableRows(part.rows);
      submessages.push({
        messageType: 4,
        tableMetadata: { title: '', rows: rows.map((r) => ({ items: r.cells, ...(r.is_header ? { isHeading: true } : {}) })) },
      });
      sections.push(newLayout('Single', { rows, __typename: 'GenATableUXPrimitive' }));
    } else if (part.type === 'image') {
      const urls = Array.isArray(part.url) ? part.url : [part.url];
      submessages.push({
        messageType: 1,
        gridImageMetadata: {
          gridImageUrl: { imagePreviewUrl: urls[0] },
          imageUrls: urls.map((url) => ({ imagePreviewUrl: url, imageHighResUrl: url, sourceUrl: SOURCE_URL })),
        },
      });
      for (const url of urls) {
        sections.push(
          newLayout('Single', {
            media: { url, mime_type: 'image/png' },
            imagine_type: 'IMAGE',
            status: { status: 'READY' },
            __typename: 'GenAIImaginePrimitive',
          }),
        );
      }
    } else if (part.type === 'video') {
      const urls = Array.isArray(part.url) ? part.url : [part.url];
      submessages.push({ messageType: 2, messageText: '[ CANNOT_LOAD_VIDEO ]' });
      for (const url of urls) {
        sections.push(
          newLayout('Single', {
            media: { url, mime_type: 'video/mp4', duration: part.duration || 0 },
            imagine_type: 'ANIMATE',
            status: { status: 'READY' },
            __typename: 'GenAIImaginePrimitive',
          }),
        );
      }
    } else if (part.type === 'product') {
      const isList = Array.isArray(part.products);
      const items = isList ? part.products : [part.products];
      submessages.push({ messageType: 2, messageText: '[ CANNOT_LOAD_PRODUCT ]' });
      const primitives = items.map((p) => ({
        title: p.title,
        brand: p.brand || '',
        price: p.price || '',
        sale_price: p.salePrice || '',
        product_url: p.url || '',
        image: { url: p.image || '' },
        additional_images: [{ url: p.icon || '' }],
        __typename: 'GenAIProductItemCardPrimitive',
      }));
      sections.push(isList ? newLayout('HScroll', primitives) : newLayout('Single', primitives[0]));
    } else if (part.type === 'reels') {
      const items = Array.isArray(part.reels) ? part.reels : [part.reels];
      submessages.push({
        messageType: 9,
        contentItemsMetadata: {
          contentType: 1,
          itemsMetadata: items.map((r) => ({
            reelItem: {
              title: r.username || '',
              profileIconUrl: r.profileUrl || '',
              thumbnailUrl: r.thumbnail || '',
              videoUrl: r.url || '',
            },
          })),
        },
      });
      sections.push(
        newLayout(
          'HScroll',
          items.map((r) => ({
            reels_url: r.url || '',
            thumbnail_url: r.thumbnail || '',
            creator: r.username || r.title || '',
            avatar_url: r.profileUrl || '',
            reels_title: r.title || '',
            likes_count: r.likes || 0,
            shares_count: r.shares || 0,
            view_count: r.views || 0,
            reel_source: r.source || 'IG',
            is_verified: !!r.verified,
            __typename: 'GenAIReelPrimitive',
          })),
        ),
      );
    } else if (part.type === 'post') {
      const items = Array.isArray(part.posts) ? part.posts : [part.posts];
      submessages.push({ messageType: 2, messageText: '[ CANNOT_LOAD_POST ]' });
      sections.push(
        newLayout(
          'HScroll',
          items.map((p) => ({
            title: p.title || '',
            subtitle: p.subtitle || '',
            username: p.username || '',
            profile_picture_url: p.profileUrl || '',
            is_verified: !!p.verified,
            thumbnail_url: p.thumbnail || '',
            post_caption: p.caption || '',
            likes_count: p.likes || 0,
            comments_count: p.comments || 0,
            shares_count: p.shares || 0,
            post_url: p.url || '',
            post_deeplink: p.deeplink || '',
            source_app: p.source || 'INSTAGRAM',
            footer_label: p.footer || '',
            footer_icon: p.icon || '',
            is_carousel: items.length > 1,
            orientation: p.orientation || 'LANDSCAPE',
            post_type: p.postType || 'VIDEO',
            __typename: 'GenAIPostPrimitive',
          })),
        ),
      );
    } else if (part.type === 'tip') {
      submessages.push({ messageType: 2, messageText: part.text });
      sections.push(newLayout('Single', { text: part.text, __typename: 'GenAIMetadataTextPrimitive' }));
    } else if (part.type === 'suggest') {
      const prompts = Array.isArray(part.prompts) ? part.prompts : [part.prompts];
      sections.push(
        newLayout(
          'ActionRow',
          prompts.map((text) => ({
            prompt_text: text,
            prompt_type: 'SUGGESTED_PROMPT',
            __typename: 'GenAIFollowUpSuggestionPillPrimitive',
          })),
        ),
      );
    }
  }

  if (opts.footer && opts.footer.length > 0) {
    sections.push(newLayout('Single', { text: opts.footer, __typename: 'GenAIMetadataTextPrimitive' }));
  }

  const richResponseSources = (opts.sources || []).map(([profileUrl, url, text]) => ({
    source_type: 'THIRD_PARTY',
    source_display_name: text || '',
    source_subtitle: 'AI',
    source_url: url || '',
    favicon: { url: profileUrl || '', mime_type: 'image/jpeg', width: 16, height: 16 },
  }));

  const inner = {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      messageSecret: crypto.randomBytes(32),
      botMetadata: {
        messageDisclaimerText: opts.title || '',
        richResponseSourcesMetadata: { sources: richResponseSources },
      },
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages,
          unifiedResponse: {
            data: Buffer.from(JSON.stringify({ response_id: crypto.randomUUID(), sections })).toString('base64'),
          },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: '0@bot' },
            forwardOrigin: 4,
          },
        },
      },
    },
  };

  return inner;
};

/**
 * Send an AIRich message using Baileys socket
 */
const sendAIRich = async (sock, jid, markdown, opts = {}, quoted = null) => {
  const parts = parseRichMarkdown(markdown);
  if (!parts.length) {
    throw new Error('AIRich: markdown tidak boleh kosong');
  }
  const inner = buildAIRichContent(parts, opts);

  let _genMsg = null;
  try {
    const bl = require('@whiskeysockets/baileys');
    _genMsg = bl.generateWAMessageFromContent;
  } catch {
    try {
      const bl = require('baileys');
      _genMsg = bl.generateWAMessageFromContent;
    } catch {}
  }

  const userJid = (sock.user?.id || '').split(':')[0] + '@s.whatsapp.net';
  const genOptions = { userJid };
  if (quoted) genOptions.quoted = quoted;

  let waMsg;
  if (typeof _genMsg === 'function') {
    waMsg = _genMsg(jid, inner, genOptions);
  } else {
    const key = {
      remoteJid: jid,
      fromMe: true,
      id: 'AIRICH_' + crypto.randomBytes(8).toString('hex').toUpperCase(),
    };
    waMsg = { key, message: inner };
  }

  if (typeof sock.relayMessage === 'function') {
    await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id });
    return waMsg;
  } else if (typeof sock.sendMessage === 'function') {
    return await sock.sendMessage(jid, { forward: waMsg }, { quoted });
  } else {
    throw new Error('Socket tidak mendukung relayMessage atau sendMessage');
  }
};

module.exports = {
  parseRichMarkdown,
  buildAIRichContent,
  sendAIRich,
};

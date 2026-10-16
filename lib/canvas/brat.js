'use strict';

const path = require('path');
const fs = require('fs');

let canvasLib = null;
try {
  canvasLib = require('canvas');
} catch {
  try {
    canvasLib = require('skia-canvas');
  } catch {}
}

const FONT_PATH = path.join(__dirname, 'arialnarrow.ttf');
let fontLoaded = false;

function ensureFont() {
  if (fontLoaded || !canvasLib) return;
  try {
    if (canvasLib.registerFont && fs.existsSync(FONT_PATH)) {
      canvasLib.registerFont(FONT_PATH, { family: 'Arial Narrow' });
      fontLoaded = true;
    } else if (canvasLib.FontLibrary && fs.existsSync(FONT_PATH)) {
      canvasLib.FontLibrary.use('Arial Narrow', FONT_PATH);
      fontLoaded = true;
    }
  } catch {}
}

async function generateBrat(text, width = 512, height = 512) {
  ensureFont();
  if (!canvasLib) throw new Error('Canvas library tidak tersedia');

  const { createCanvas } = canvasLib;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background putih
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const rawText = String(text || '').trim();
  if (!rawText) throw new Error('Teks kosong');

  const padding = 36;
  const maxWidth = width - (padding * 2);
  const maxHeight = height - (padding * 2);

  // Cari font size yang pas
  let fontSize = 68;
  const fontFam = fontLoaded ? '"Arial Narrow", Arial, sans-serif' : 'Arial, sans-serif';

  const words = rawText.split(/\s+/);
  let lines = [];

  while (fontSize >= 18) {
    ctx.font = `${fontSize}px ${fontFam}`;
    lines = [];
    let cur = words[0] || '';

    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      const test = cur + ' ' + w;
      if (ctx.measureText(test).width <= maxWidth) {
        cur = test;
      } else {
        lines.push(cur);
        cur = w;
      }
    }
    lines.push(cur);

    const lineH = fontSize * 1.16;
    if (lines.length * lineH <= maxHeight) {
      break;
    }
    fontSize -= 3;
  }

  ctx.font = `${fontSize}px ${fontFam}`;
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const lineHeight = fontSize * 1.16;
  let y = padding;

  for (const line of lines) {
    ctx.fillText(line, padding, y);
    y += lineHeight;
  }

  if (canvas.toBuffer) {
    return canvas.toBuffer('image/png');
  }
  return Buffer.from([]);
}

module.exports = {
  generateBrat
};
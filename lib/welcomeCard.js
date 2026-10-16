const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const _wcCacheDir = path.join(process.cwd(), 'temp', 'wlcache');
if (!fs.existsSync(_wcCacheDir)) fs.mkdirSync(_wcCacheDir, { recursive: true });

const PALETTE = {
  welcome: {
    primary: '#00D26A',
    secondary: '#00B85C',
    accent: '#00FFA3',
    glow: 'rgba(0, 210, 106, 0.35)',
    glowSoft: 'rgba(0, 210, 106, 0.12)',
    glowUltra: 'rgba(0, 210, 106, 0.04)',
    badge: '#00D26A',
    ring: ['#00D26A', '#00FFA3', '#00D26A'],
    particle: 'rgba(0, 210, 106, 0.06)',
    barGlow: ['rgba(0, 210, 106, 0)', 'rgba(0, 210, 106, 0.5)', 'rgba(0, 255, 163, 0.5)', 'rgba(0, 210, 106, 0)'],
    cardTint: 'rgba(0, 210, 106, 0.02)',
    infoBg: 'rgba(0, 210, 106, 0.05)',
    infoBorder: 'rgba(0, 210, 106, 0.12)',
    dotted: 'rgba(0, 210, 106, 0.18)',
    cornerAlpha: 0.25,
  },
  goodbye: {
    primary: '#FF4757',
    secondary: '#FF3344',
    accent: '#FF6B7A',
    glow: 'rgba(255, 71, 87, 0.35)',
    glowSoft: 'rgba(255, 71, 87, 0.10)',
    glowUltra: 'rgba(255, 71, 87, 0.03)',
    badge: '#FF4757',
    ring: ['#FF4757', '#FF6B7A', '#FF4757'],
    particle: 'rgba(255, 71, 87, 0.05)',
    barGlow: ['rgba(255, 71, 87, 0)', 'rgba(255, 71, 87, 0.45)', 'rgba(255, 107, 122, 0.45)', 'rgba(255, 71, 87, 0)'],
    cardTint: 'rgba(255, 71, 87, 0.015)',
    infoBg: 'rgba(255, 71, 87, 0.04)',
    infoBorder: 'rgba(255, 71, 87, 0.10)',
    dotted: 'rgba(255, 71, 87, 0.15)',
    cornerAlpha: 0.2,
  },
  base: {
    bgDeep: '#080C12',
    bgDark: '#0D1117',
    bgCard: '#12171F',
    bgCardInner: '#161D28',
    textWhite: '#FFFFFF',
    textPrimary: '#E6EDF3',
    textSecondary: '#8B949E',
    textMuted: '#6E7681',
    textDim: '#484F58',
    border: 'rgba(255, 255, 255, 0.05)',
    borderLight: 'rgba(255, 255, 255, 0.08)',
    overlayHeavy: 'rgba(0, 0, 0, 0.55)',
    overlayMedium: 'rgba(0, 0, 0, 0.35)',
    overlayLight: 'rgba(0, 0, 0, 0.18)',
  }
};

function seededRng(seed) {
  let v = seed || 42;
  return function () {
    v = (v * 16807) % 2147483647;
    return (v - 1) / 2147483646;
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const radii = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : { tl: r.tl || 0, tr: r.tr || 0, br: r.br || 0, bl: r.bl || 0 };
  ctx.beginPath();
  ctx.moveTo(x + radii.tl, y);
  ctx.lineTo(x + w - radii.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radii.tr);
  ctx.lineTo(x + w, y + h - radii.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radii.br, y + h);
  ctx.lineTo(x + radii.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radii.bl);
  ctx.lineTo(x, y + radii.tl);
  ctx.quadraticCurveTo(x, y, x + radii.tl, y);
  ctx.closePath();
}

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (ctx.measureText(t + '…').width > maxWidth && t.length > 0) t = t.slice(0, -1);
  return t + '…';
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16)
  };
}

function drawStarField(ctx, w, h, count, seed) {
  const rng = seededRng(seed);
  for (let i = 0; i < count; i++) {
    const sx = rng() * w;
    const sy = rng() * h;
    const sr = rng() * 1.0 + 0.2;
    const sa = rng() * 0.35 + 0.05;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${sa})`;
    ctx.fill();
  }
}

function drawSoftParticles(ctx, w, h, colorHex, count, seed, maxRadius) {
  const rng = seededRng(seed);
  const rgb = hexToRgb(colorHex);
  for (let i = 0; i < count; i++) {
    const px = rng() * w;
    const py = rng() * h;
    const pr = rng() * (maxRadius || 40) + 8;
    const pa = rng() * 0.03 + 0.008;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, pr);
    grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${pa})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

function drawNoiseTexture(ctx, w, h, alpha, seed) {
  const rng = seededRng(seed || 1337);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (rng() - 0.5) * 2;
    const val = noise > 0 ? 255 : 0;
    const a = Math.abs(noise) * alpha * 255;
    data[i] = Math.min(255, data[i] + val * (a / 255));
    data[i + 1] = Math.min(255, data[i + 1] + val * (a / 255));
    data[i + 2] = Math.min(255, data[i + 2] + val * (a / 255));
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawFineMesh(ctx, w, h, spacing, colorHex, alpha) {
  const rgb = hexToRgb(colorHex);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`;
  ctx.lineWidth = 0.3;
  for (let x = 0; x < w; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFloatingRings(ctx, w, h, colorHex, count, seed) {
  const rng = seededRng(seed);
  const rgb = hexToRgb(colorHex);
  for (let i = 0; i < count; i++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const radius = rng() * 60 + 20;
    const a = rng() * 0.04 + 0.01;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
    ctx.lineWidth = rng() * 1.5 + 0.3;
    ctx.stroke();
  }
}

function drawOrbitalDots(ctx, cx, cy, radius, count, colorHex, alpha, dotRadius) {
  const rgb = hexToRgb(colorHex);
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i;
    const dx = cx + Math.cos(angle) * radius;
    const dy = cy + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.arc(dx, dy, dotRadius || 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    ctx.fill();
  }
}

function drawWaveLine(ctx, w, yBase, amplitude, frequency, colorHex, alpha, lineWidth, phase) {
  const rgb = hexToRgb(colorHex);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.lineWidth = lineWidth || 0.8;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 1.5) {
    const y = yBase
      + Math.sin((x * frequency) / 100 + (phase || 0)) * amplitude
      + Math.sin((x * frequency * 0.4) / 100 + (phase || 0) * 1.3) * (amplitude * 0.4);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawCornerBrackets(ctx, w, h, colorHex, size, alpha, margin) {
  const rgb = hexToRgb(colorHex);
  const m = margin || 18;
  ctx.save();
  ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';

  ctx.beginPath(); ctx.moveTo(m, m + size); ctx.lineTo(m, m); ctx.lineTo(m + size, m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w - m - size, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, m + size); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(m, h - m - size); ctx.lineTo(m, h - m); ctx.lineTo(m + size, h - m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w - m - size, h - m); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m, h - m - size); ctx.stroke();

  ctx.restore();
}

function drawDiamond(ctx, x, y, size, colorHex, alpha) {
  const rgb = hexToRgb(colorHex);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDottedLine(ctx, x1, y1, x2, y2, colorHex, alpha, dotR, gap) {
  const rgb = hexToRgb(colorHex);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const step = (dotR || 1) * 2 + (gap || 5);
  const count = Math.floor(dist / step);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    ctx.beginPath();
    ctx.arc(x1 + dx * t, y1 + dy * t, dotR || 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSeparatorLine(ctx, x1, x2, y, colorHex, alpha) {
  const rgb = hexToRgb(colorHex);
  const grad = ctx.createLinearGradient(x1, y, x2, y);
  grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
  grad.addColorStop(0.3, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`);
  grad.addColorStop(0.7, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`);
  grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

async function fetchImage(src) {
  if (!src) return null;
  if (Buffer.isBuffer(src)) {
    try { return await loadImage(src); } catch { return null; }
  }
  if (typeof src === 'string') {
    if (src.startsWith('http://') || src.startsWith('https://')) {
      try { return await loadImage(src); } catch {}
      try {
        const buf = await new Promise((resolve, reject) => {
          const mod = src.startsWith('https') ? https : http;
          mod.get(src, { timeout: 15000 }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
              mod.get(res.headers.location, { timeout: 15000 }, (res2) => {
                const chunks = [];
                res2.on('data', c => chunks.push(c));
                res2.on('end', () => resolve(Buffer.concat(chunks)));
                res2.on('error', reject);
              }).on('error', reject);
              return;
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
          }).on('error', reject);
        });
        return await loadImage(buf);
      } catch { return null; }
    }
    if (fs.existsSync(src)) {
      try { return await loadImage(fs.readFileSync(src)); } catch { return null; }
    }
  }
  return null;
}

async function getAvatar(avatarSrc) {
  const img = await fetchImage(avatarSrc);
  if (img) return img;
  const c = createCanvas(256, 256);
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, '#2D333B');
  g.addColorStop(1, '#1C2333');
  cx.fillStyle = g;
  cx.beginPath(); cx.arc(128, 128, 128, 0, Math.PI * 2); cx.fill();
  cx.fillStyle = '#6E7681';
  cx.beginPath(); cx.arc(128, 98, 38, 0, Math.PI * 2); cx.fill();
  cx.beginPath(); cx.ellipse(128, 190, 52, 38, 0, Math.PI, 0, true); cx.fill();
  return await loadImage(c.toBuffer());
}

function applyStackBlur(imageData, width, height, radius) {
  if (radius < 1) return;
  const pixels = imageData.data;
  const div = 2 * radius + 1;
  const widthMinus1 = width - 1;
  const heightMinus1 = height - 1;
  const radiusPlus1 = radius + 1;
  const sumFactor = radiusPlus1 * (radiusPlus1 + 1) / 2;

  const stackStart = new Array(div);
  const stackEnd = new Array(div);

  let p, rbs;
  const mul_sum = 1 / (sumFactor * 2 + radius + 1);

  for (let y = 0; y < height; y++) {
    let rInSum = 0, gInSum = 0, bInSum = 0, aInSum = 0;
    let rOutSum = 0, gOutSum = 0, bOutSum = 0, aOutSum = 0;
    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;

    for (let i = -radius; i <= radius; i++) {
      const srcIdx = (y * width + Math.min(widthMinus1, Math.max(0, i))) * 4;
      const stackIdx = i + radius;
      stackStart[stackIdx] = [pixels[srcIdx], pixels[srcIdx + 1], pixels[srcIdx + 2], pixels[srcIdx + 3]];
      rbs = radiusPlus1 - Math.abs(i);
      rSum += pixels[srcIdx] * rbs;
      gSum += pixels[srcIdx + 1] * rbs;
      bSum += pixels[srcIdx + 2] * rbs;
      aSum += pixels[srcIdx + 3] * rbs;
      if (i > 0) { rInSum += pixels[srcIdx]; gInSum += pixels[srcIdx + 1]; bInSum += pixels[srcIdx + 2]; aInSum += pixels[srcIdx + 3]; }
      else { rOutSum += pixels[srcIdx]; gOutSum += pixels[srcIdx + 1]; bOutSum += pixels[srcIdx + 2]; aOutSum += pixels[srcIdx + 3]; }
    }

    let stackIn = radius;
    let stackOut = 0;

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      pixels[idx] = Math.round(rSum * mul_sum);
      pixels[idx + 1] = Math.round(gSum * mul_sum);
      pixels[idx + 2] = Math.round(bSum * mul_sum);
      pixels[idx + 3] = Math.round(aSum * mul_sum);

      rSum -= rOutSum;
      gSum -= gOutSum;
      bSum -= bOutSum;
      aSum -= aOutSum;

      const outStack = stackStart[stackOut];
      rOutSum -= outStack[0];
      gOutSum -= outStack[1];
      bOutSum -= outStack[2];
      aOutSum -= outStack[3];

      const srcX = Math.min(widthMinus1, x + radius + 1);
      const srcIdx = (y * width + srcX) * 4;
      outStack[0] = pixels[srcIdx];
      outStack[1] = pixels[srcIdx + 1];
      outStack[2] = pixels[srcIdx + 2];
      outStack[3] = pixels[srcIdx + 3];

      rInSum += outStack[0];
      gInSum += outStack[1];
      bInSum += outStack[2];
      aInSum += outStack[3];

      rSum += rInSum;
      gSum += gInSum;
      bSum += bInSum;
      aSum += aInSum;

      stackIn = (stackIn + 1) % div;
      const inStack = stackStart[stackIn];

      rOutSum += inStack[0];
      gOutSum += inStack[1];
      bOutSum += inStack[2];
      aOutSum += inStack[3];

      rInSum -= inStack[0];
      gInSum -= inStack[1];
      bInSum -= inStack[2];
      aInSum -= inStack[3];

      stackOut = (stackOut + 1) % div;
    }
  }

  for (let x = 0; x < width; x++) {
    let rInSum = 0, gInSum = 0, bInSum = 0, aInSum = 0;
    let rOutSum = 0, gOutSum = 0, bOutSum = 0, aOutSum = 0;
    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;

    for (let i = -radius; i <= radius; i++) {
      const srcY = Math.min(heightMinus1, Math.max(0, i));
      const srcIdx = (srcY * width + x) * 4;
      const stackIdx = i + radius;
      stackStart[stackIdx] = [pixels[srcIdx], pixels[srcIdx + 1], pixels[srcIdx + 2], pixels[srcIdx + 3]];
      rbs = radiusPlus1 - Math.abs(i);
      rSum += pixels[srcIdx] * rbs;
      gSum += pixels[srcIdx + 1] * rbs;
      bSum += pixels[srcIdx + 2] * rbs;
      aSum += pixels[srcIdx + 3] * rbs;
      if (i > 0) { rInSum += pixels[srcIdx]; gInSum += pixels[srcIdx + 1]; bInSum += pixels[srcIdx + 2]; aInSum += pixels[srcIdx + 3]; }
      else { rOutSum += pixels[srcIdx]; gOutSum += pixels[srcIdx + 1]; bOutSum += pixels[srcIdx + 2]; aOutSum += pixels[srcIdx + 3]; }
    }

    let stackIn = radius;
    let stackOut = 0;

    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      pixels[idx] = Math.round(rSum * mul_sum);
      pixels[idx + 1] = Math.round(gSum * mul_sum);
      pixels[idx + 2] = Math.round(bSum * mul_sum);
      pixels[idx + 3] = Math.round(aSum * mul_sum);

      rSum -= rOutSum;
      gSum -= gOutSum;
      bSum -= bOutSum;
      aSum -= aOutSum;

      const outStack = stackStart[stackOut];
      rOutSum -= outStack[0];
      gOutSum -= outStack[1];
      bOutSum -= outStack[2];
      aOutSum -= outStack[3];

      const srcY = Math.min(heightMinus1, y + radius + 1);
      const srcIdx = (srcY * width + x) * 4;
      outStack[0] = pixels[srcIdx];
      outStack[1] = pixels[srcIdx + 1];
      outStack[2] = pixels[srcIdx + 2];
      outStack[3] = pixels[srcIdx + 3];

      rInSum += outStack[0];
      gInSum += outStack[1];
      bInSum += outStack[2];
      aInSum += outStack[3];

      rSum += rInSum;
      gSum += gInSum;
      bSum += bInSum;
      aSum += aInSum;

      stackIn = (stackIn + 1) % div;
      const inStack = stackStart[stackIn];

      rOutSum += inStack[0];
      gOutSum += inStack[1];
      bOutSum += inStack[2];
      aOutSum += inStack[3];

      rInSum -= inStack[0];
      gInSum -= inStack[1];
      bInSum -= inStack[2];
      aInSum -= inStack[3];

      stackOut = (stackOut + 1) % div;
    }
  }
}

function drawBlurredBackground(ctx, img, w, h, blurRadius, overlayColor, overlayAlpha) {
  if (!img) return;
  const scale = Math.max(w / img.width, h / img.height);
  const iw = img.width * scale;
  const ih = img.height * scale;
  const ix = (w - iw) / 2;
  const iy = (h - ih) / 2;

  const tempCanvas = createCanvas(w, h);
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(img, ix, iy, iw, ih);

  if (blurRadius > 0) {
    const imageData = tempCtx.getImageData(0, 0, w, h);
    const passes = Math.ceil(blurRadius / 12);
    const passRadius = Math.ceil(blurRadius / passes);
    for (let i = 0; i < passes; i++) {
      applyStackBlur(imageData, w, h, Math.min(passRadius, 50));
    }
    tempCtx.putImageData(imageData, 0, 0);
  }

  ctx.drawImage(tempCanvas, 0, 0);

  const oa = overlayAlpha !== undefined ? overlayAlpha : 0.5;
  ctx.fillStyle = overlayColor || `rgba(0, 0, 0, ${oa})`;
  if (!overlayColor) {
    ctx.fillStyle = `rgba(0, 0, 0, ${oa})`;
  }
  ctx.fillRect(0, 0, w, h);
}

function drawBaseBackground(ctx, w, h, tintHex) {
  const rgb = tintHex ? hexToRgb(tintHex) : { r: 0, g: 0, b: 0 };
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, PALETTE.base.bgDeep);
  grad.addColorStop(0.35, `rgba(${Math.min(255, rgb.r + 13)}, ${Math.min(255, rgb.g + 17)}, ${Math.min(255, rgb.b + 24)}, 1)`);
  grad.addColorStop(0.65, PALETTE.base.bgDark);
  grad.addColorStop(1, PALETTE.base.bgDeep);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawAmbientGlow(ctx, w, h, colorHex, positions) {
  const rgb = hexToRgb(colorHex);
  (positions || []).forEach(pos => {
    const grad = ctx.createRadialGradient(pos.x * w, pos.y * h, 0, pos.x * w, pos.y * h, pos.r || 280);
    grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${pos.a || 0.04})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
}

function drawMainCard(ctx, x, y, w, h, r, theme) {
  ctx.save();
  ctx.shadowColor = theme.glowSoft;
  ctx.shadowBlur = 35;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, w, h, r);
  const cardGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  cardGrad.addColorStop(0, 'rgba(18, 23, 31, 0.94)');
  cardGrad.addColorStop(0.5, 'rgba(22, 29, 40, 0.90)');
  cardGrad.addColorStop(1, 'rgba(18, 23, 31, 0.94)');
  ctx.fillStyle = cardGrad;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.restore();

  const rgb = hexToRgb(theme.primary);
  roundRect(ctx, x, y, w, h, r);
  const borderGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  borderGrad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.30)`);
  borderGrad.addColorStop(0.25, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.06)`);
  borderGrad.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
  borderGrad.addColorStop(0.75, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.06)`);
  borderGrad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.30)`);
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const innerGrad = ctx.createRadialGradient(x + w / 2, y, 0, x + w / 2, y, w * 0.55);
  innerGrad.addColorStop(0, theme.cardTint);
  innerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = innerGrad;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawTopAccentBar(ctx, cardX, cardY, cardW, cardH, cardR, barGlowColors) {
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.clip();
  const grad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY);
  barGlowColors.forEach((c, i) => grad.addColorStop(i / (barGlowColors.length - 1), c));
  ctx.fillStyle = grad;
  ctx.fillRect(cardX + 60, cardY + 1, cardW - 120, 1.5);
  ctx.restore();
}

function drawAvatarSection(ctx, cx, cy, radius, avatarImg, theme, badgeChar) {
  const rgb = hexToRgb(theme.primary);
  const accentRgb = hexToRgb(theme.accent);

  const outerGlow = ctx.createRadialGradient(cx, cy, radius * 0.7, cx, cy, radius + 30);
  outerGlow.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`);
  outerGlow.addColorStop(0.6, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05)`);
  outerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = outerGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 30, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 12, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.04)`;
  ctx.lineWidth = 0.6;
  ctx.setLineDash([3, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawOrbitalDots(ctx, cx, cy, radius + 12, 12, theme.primary, 0.12, 1);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3.5, 0, Math.PI * 2);
  const ringGrad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  theme.ring.forEach((c, i) => ringGrad.addColorStop(i / (theme.ring.length - 1), c));
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatarImg, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  const bx = cx + radius * 0.72;
  const by = cy + radius * 0.72;
  ctx.beginPath();
  ctx.arc(bx, by, 11, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.base.bgCard;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx, by, 8, 0, Math.PI * 2);
  const badgeGrad = ctx.createRadialGradient(bx, by, 0, bx, by, 8);
  badgeGrad.addColorStop(0, theme.accent);
  badgeGrad.addColorStop(1, theme.primary);
  ctx.fillStyle = badgeGrad;
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeChar || '✓', bx, by);
}

function drawInfoPill(ctx, cx, cy, w, h, r, label, value, theme, valueColor) {
  const rgb = hexToRgb(theme.primary);
  ctx.save();
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, r);
  ctx.fillStyle = theme.infoBg;
  ctx.fill();
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, r);
  ctx.strokeStyle = theme.infoBorder;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.restore();

  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.base.textDim;
  ctx.fillText(label, cx, cy - 7);

  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = valueColor || PALETTE.base.textPrimary;
  ctx.fillText(value, cx, cy + 9);
}

function drawDecorations(ctx, w, h, theme) {
  drawDiamond(ctx, 55, 55, 3.5, theme.primary, 0.18);
  drawDiamond(ctx, w - 55, 55, 2.5, theme.accent, 0.14);
  drawDiamond(ctx, w - 70, h - 65, 3, theme.primary, 0.12);
  drawDiamond(ctx, 65, h - 55, 2.5, theme.accent, 0.14);
  drawDiamond(ctx, w / 2 - 140, h - 45, 2, theme.primary, 0.08);
  drawDiamond(ctx, w / 2 + 140, h - 45, 2, theme.accent, 0.08);
}

async function createWelcomeCard(options = {}) {
  const username = options.username || 'Member';
  const groupName = options.groupName || 'Group';
  const memberCount = options.memberCount || '?';
  const avatarUrl = options.avatar || null;
  const botName = options.botName || global.namaBot || 'Bot';
  const customMsg = options.message || '';
  const bgSrc = options.background || null;
  const bgBlur = options.blur !== undefined ? Math.max(0, Math.min(options.blur, 60)) : 12;
  const bgOverlay = options.backgroundOverlay !== undefined ? options.backgroundOverlay : 0.48;
  const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const theme = PALETTE.welcome;

  const W = 900;
  const H = 450;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawBaseBackground(ctx, W, H, theme.primary);

  const bgImg = await fetchImage(bgSrc);
  if (bgImg) {
    drawBlurredBackground(ctx, bgImg, W, H, bgBlur, null, bgOverlay);
  }

  drawFineMesh(ctx, W, H, 48, theme.primary, 0.012);
  drawStarField(ctx, W, H, 70, 12345);
  drawSoftParticles(ctx, W, H, theme.primary, 18, 777, 45);
  drawFloatingRings(ctx, W, H, theme.primary, 6, 4444);
  drawAmbientGlow(ctx, W, H, theme.primary, [
    { x: 0.15, y: 0.05, r: 220, a: 0.045 },
    { x: 0.85, y: 0.95, r: 260, a: 0.03 },
    { x: 0.5, y: 0.3, r: 320, a: 0.02 },
  ]);

  drawWaveLine(ctx, W, H * 0.82, 6, 2.8, theme.primary, 0.04, 0.7, 0);
  drawWaveLine(ctx, W, H * 0.86, 4, 2.2, theme.accent, 0.03, 0.5, 1.2);
  drawWaveLine(ctx, W, H * 0.14, 3.5, 3.5, theme.primary, 0.02, 0.4, 0.5);

  drawNoiseTexture(ctx, W, H, 0.012, 9999);

  const cardX = 28;
  const cardY = 28;
  const cardW = W - 56;
  const cardH = H - 56;
  const cardR = 18;

  drawMainCard(ctx, cardX, cardY, cardW, cardH, cardR, theme);
  drawTopAccentBar(ctx, cardX, cardY, cardW, cardH, cardR, theme.barGlow);
  drawCornerBrackets(ctx, W, H, theme.primary, 22, theme.cornerAlpha, 20);
  drawDecorations(ctx, W, H, theme);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = theme.primary;
  ctx.globalAlpha = 0.7;
  const headerText = 'W E L C O M E';
  ctx.fillText(headerText, W / 2, 56);
  ctx.globalAlpha = 1;

  drawSeparatorLine(ctx, W / 2 - 70, W / 2 + 70, 68, theme.primary, 0.15);

  const avCx = W / 2;
  const avCy = 148;
  const avR = 52;
  const avImg = await getAvatar(avatarUrl);
  drawAvatarSection(ctx, avCx, avCy, avR, avImg, theme, '✓');

  const nameY = 228;
  ctx.font = 'bold 26px sans-serif';
  const displayName = truncateText(ctx, username, cardW - 140);
  ctx.save();
  ctx.shadowColor = theme.glowSoft;
  ctx.shadowBlur = 14;
  ctx.fillStyle = PALETTE.base.textWhite;
  ctx.fillText(displayName, W / 2, nameY);
  ctx.restore();

  ctx.font = '13px sans-serif';
  ctx.fillStyle = PALETTE.base.textSecondary;
  ctx.fillText('Bergabung di grup', W / 2, nameY + 28);

  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = theme.accent;
  const displayGroup = truncateText(ctx, groupName, cardW - 180);
  ctx.fillText(displayGroup, W / 2, nameY + 52);

  if (customMsg) {
    ctx.font = '11px sans-serif';
    ctx.fillStyle = PALETTE.base.textMuted;
    const displayMsg = truncateText(ctx, customMsg, cardW - 220);
    ctx.fillText(displayMsg, W / 2, nameY + 76);
  }

  drawSeparatorLine(ctx, W / 2 - 200, W / 2 + 200, H - 110, theme.primary, 0.06);

  const infoY = H - 80;
  const spacing = 170;
  drawInfoPill(ctx, W / 2 - spacing, infoY, 130, 40, 8, 'MEMBER KE', `#${memberCount}`, theme, theme.primary);
  drawInfoPill(ctx, W / 2, infoY, 145, 40, 8, 'TANGGAL', dateStr, theme);
  drawInfoPill(ctx, W / 2 + spacing, infoY, 120, 40, 8, 'WAKTU', timeStr, theme);

  ctx.font = '8px sans-serif';
  ctx.fillStyle = PALETTE.base.textDim;
  ctx.globalAlpha = 0.35;
  ctx.fillText(`Powered by ${botName}`, W / 2, H - 36);
  ctx.globalAlpha = 1;

  return canvas.toBuffer('image/png');
}

async function createGoodbyeCard(options = {}) {
  const username = options.username || 'Member';
  const groupName = options.groupName || 'Group';
  const memberCount = options.memberCount || '?';
  const avatarUrl = options.avatar || null;
  const botName = options.botName || global.namaBot || 'Bot';
  const customMsg = options.message || '';
  const reason = options.reason || '';
  const bgSrc = options.background || null;
  const bgBlur = options.blur !== undefined ? Math.max(0, Math.min(options.blur, 60)) : 12;
  const bgOverlay = options.backgroundOverlay !== undefined ? options.backgroundOverlay : 0.5;
  const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const theme = PALETTE.goodbye;

  const W = 900;
  const H = 450;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawBaseBackground(ctx, W, H, theme.primary);

  const bgImg = await fetchImage(bgSrc);
  if (bgImg) {
    drawBlurredBackground(ctx, bgImg, W, H, bgBlur, null, bgOverlay);
  }

  drawFineMesh(ctx, W, H, 48, theme.primary, 0.010);
  drawStarField(ctx, W, H, 55, 54321);
  drawSoftParticles(ctx, W, H, theme.primary, 14, 333, 40);
  drawFloatingRings(ctx, W, H, theme.primary, 5, 8888);
  drawAmbientGlow(ctx, W, H, theme.primary, [
    { x: 0.85, y: 0.05, r: 200, a: 0.035 },
    { x: 0.15, y: 0.95, r: 240, a: 0.025 },
    { x: 0.5, y: 0.4, r: 300, a: 0.015 },
  ]);

  drawWaveLine(ctx, W, H * 0.82, 6, 2.8, theme.primary, 0.035, 0.7, 0.3);
  drawWaveLine(ctx, W, H * 0.86, 4, 2.2, theme.accent, 0.025, 0.5, 1.5);
  drawWaveLine(ctx, W, H * 0.14, 3.5, 3.5, theme.primary, 0.018, 0.4, 0.8);

  drawNoiseTexture(ctx, W, H, 0.012, 7777);

  const cardX = 28;
  const cardY = 28;
  const cardW = W - 56;
  const cardH = H - 56;
  const cardR = 18;

  drawMainCard(ctx, cardX, cardY, cardW, cardH, cardR, theme);
  drawTopAccentBar(ctx, cardX, cardY, cardW, cardH, cardR, theme.barGlow);
  drawCornerBrackets(ctx, W, H, theme.primary, 22, theme.cornerAlpha, 20);
  drawDecorations(ctx, W, H, theme);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = theme.primary;
  ctx.globalAlpha = 0.7;
  ctx.fillText('G O O D B Y E', W / 2, 56);
  ctx.globalAlpha = 1;

  drawSeparatorLine(ctx, W / 2 - 70, W / 2 + 70, 68, theme.primary, 0.15);

  const avCx = W / 2;
  const avCy = 148;
  const avR = 52;
  const avImg = await getAvatar(avatarUrl);
  drawAvatarSection(ctx, avCx, avCy, avR, avImg, theme, '✕');

  ctx.save();
  ctx.beginPath();
  ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(avCx - avR, avCy - avR, avR * 2, avR * 2);
  ctx.restore();

  const nameY = 228;
  ctx.font = 'bold 26px sans-serif';
  const displayName = truncateText(ctx, username, cardW - 140);
  ctx.save();
  ctx.shadowColor = theme.glowSoft;
  ctx.shadowBlur = 14;
  ctx.fillStyle = PALETTE.base.textWhite;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayName, W / 2, nameY);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = PALETTE.base.textSecondary;
  ctx.fillText('Telah meninggalkan grup', W / 2, nameY + 28);

  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = theme.accent;
  const displayGroup = truncateText(ctx, groupName, cardW - 180);
  ctx.fillText(displayGroup, W / 2, nameY + 52);

  if (reason) {
    ctx.font = '11px sans-serif';
    ctx.fillStyle = PALETTE.base.textMuted;
    const displayReason = truncateText(ctx, `Alasan: ${reason}`, cardW - 220);
    ctx.fillText(displayReason, W / 2, nameY + 76);
  } else if (customMsg) {
    ctx.font = '11px sans-serif';
    ctx.fillStyle = PALETTE.base.textMuted;
    const displayMsg = truncateText(ctx, customMsg, cardW - 220);
    ctx.fillText(displayMsg, W / 2, nameY + 76);
  }

  drawSeparatorLine(ctx, W / 2 - 200, W / 2 + 200, H - 110, theme.primary, 0.06);

  const infoY = H - 80;
  const spacing = 170;
  drawInfoPill(ctx, W / 2 - spacing, infoY, 130, 40, 8, 'SISA MEMBER', `${memberCount}`, theme, theme.primary);
  drawInfoPill(ctx, W / 2, infoY, 145, 40, 8, 'TANGGAL', dateStr, theme);
  drawInfoPill(ctx, W / 2 + spacing, infoY, 120, 40, 8, 'WAKTU', timeStr, theme);

  ctx.font = '8px sans-serif';
  ctx.fillStyle = PALETTE.base.textDim;
  ctx.globalAlpha = 0.35;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Powered by ${botName}`, W / 2, H - 36);
  ctx.globalAlpha = 1;

  return canvas.toBuffer('image/png');
}

module.exports = { createWelcomeCard, createGoodbyeCard };
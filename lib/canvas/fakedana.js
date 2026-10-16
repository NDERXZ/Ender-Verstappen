'use strict';
const path = require('path');
const { Canvas, loadImage, FontLibrary } = require('skia-canvas');

const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'Epep.ttf');
const BG_URL    = 'https://raw.githubusercontent.com/uploader762/dat3/main/uploads/9c18e0-1772932032348.jpg';
const LOGO_URL  = 'https://raw.githubusercontent.com/uploader762/dat3/main/uploads/d0f081-1772929197100.png';

let _fontLoaded = false;
function _loadFont() {
    if (_fontLoaded) return;
    try {
        const fs = require('fs');
        if (fs.existsSync(FONT_PATH)) {
            FontLibrary.use('CartoonVibes', FONT_PATH);
            _fontLoaded = true;
        }
    } catch {}
}

async function generateFakeDana(nominal) {
    _loadFont();

    const saldo = Number(String(nominal).replace(/[^0-9]/g, ''))
        .toLocaleString('id-ID');

    if (!saldo || saldo === '0') throw new Error('Nominal tidak valid');

    const [bg, logo] = await Promise.all([
        loadImage(BG_URL),
        loadImage(LOGO_URL),
    ]);

    const canvas = new Canvas(bg.width, bg.height);
    const ctx    = canvas.getContext('2d');

    ctx.drawImage(bg, 0, 0);

    ctx.font         = _fontLoaded ? '205px CartoonVibes' : '205px Arial';
    ctx.fillStyle    = 'white';
    ctx.textBaseline = 'top';

    const x = 664;
    const y = 293;

    ctx.fillText(saldo, x, y);

    const textWidth = ctx.measureText(saldo).width;
    const logoSize  = 370;
    const logoX     = x + textWidth + 11;
    const logoY     = y + (-31);

    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);

    return await canvas.png;
}

module.exports = { generateFakeDana };
/**
 * Audio Sticker Plugin (Static & Animated GIF with Sound)
 * Author: Nimzz (Adapted for Ender Verstappen)
 */

const { handleAudioSticker } = require('../lib/audiosticker');

const handler = async (m, plugCtx) => {
    await handleAudioSticker(m, plugCtx);
};

handler.help = ['audiosticker', 'stikersuara', 'soundsticker'];
handler.tags = ['sticker'];
handler.command = /^(audiosticker|asticker|stikersuara|stickersuara|soundsticker|stikerbunyi|sfxsticker)$/i;

module.exports = handler;

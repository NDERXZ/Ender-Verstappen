'use strict';

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const fs = require('fs');
const path = require('path');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// ─────────────────────────────────────────
//   HDV PRESETS
// ─────────────────────────────────────────
const HDV_PRESETS = {
    2: {
        label: '2× HD Video',
        emoji: '🔹',
        desc: 'Upscale ringan 2x resolusi',
        timeEst: '~10 detik',
        crf: 20,
        preset: 'fast',
        passes: 1,
        denoise: '2:1:2:3',
        unsharp: '5:5:0.8:3:3:0.4',
        brightness: 0.02,
        contrast: 1.05,
        saturation: 1.1
    },
    4: {
        label: '4× Standar HD',
        emoji: '🔷',
        desc: 'Standar HD jernih',
        timeEst: '~20 detik',
        crf: 18,
        preset: 'medium',
        passes: 1,
        denoise: '3:2:3:4',
        unsharp: '5:5:1.0:3:3:0.5',
        brightness: 0.03,
        contrast: 1.08,
        saturation: 1.15
    },
    6: {
        label: '6× Super Jernih',
        emoji: '🔵',
        desc: 'Video jernih sangat detail',
        timeEst: '~40 detik',
        crf: 17,
        preset: 'medium',
        passes: 2,
        denoise: '4:2:4:5',
        unsharp: '5:5:1.2:3:3:0.6',
        brightness: 0.04,
        contrast: 1.10,
        saturation: 1.18
    },
    8: {
        label: '8× Super HD',
        emoji: '🟣',
        desc: 'Super HD resolusi tinggi',
        timeEst: '~1 menit',
        crf: 16,
        preset: 'slow',
        passes: 2,
        denoise: '4:3:4:5',
        unsharp: '7:7:1.3:3:3:0.6',
        brightness: 0.05,
        contrast: 1.12,
        saturation: 1.20
    },
    10: {
        label: '10× Ultra Detail',
        emoji: '🟠',
        desc: 'Detail sangat tinggi',
        timeEst: '~2 menit',
        crf: 15,
        preset: 'slow',
        passes: 2,
        denoise: '5:3:5:6',
        unsharp: '7:7:1.5:3:3:0.7',
        brightness: 0.05,
        contrast: 1.14,
        saturation: 1.22
    },
    12: {
        label: '12× Ultra HD',
        emoji: '🔴',
        desc: 'Ultra HD maksimal',
        timeEst: '~3 menit',
        crf: 14,
        preset: 'slower',
        passes: 3,
        denoise: '5:4:5:7',
        unsharp: '7:7:1.8:5:5:0.8',
        brightness: 0.06,
        contrast: 1.16,
        saturation: 1.25
    },
    16: {
        label: '16× Ekstrem HD',
        emoji: '🟤',
        desc: 'Kualitas ekstrem',
        timeEst: '~5 menit',
        crf: 12,
        preset: 'slower',
        passes: 3,
        denoise: '6:4:6:8',
        unsharp: '9:9:2.0:5:5:0.9',
        brightness: 0.07,
        contrast: 1.18,
        saturation: 1.28
    },
    18: {
        label: '18× Maximum Ultra',
        emoji: '⚫',
        desc: 'Kualitas maximum ultra',
        timeEst: '~7 menit',
        crf: 10,
        preset: 'veryslow',
        passes: 3,
        denoise: '7:5:7:9',
        unsharp: '9:9:2.2:5:5:1.0',
        brightness: 0.08,
        contrast: 1.20,
        saturation: 1.30
    }
};

// ─────────────────────────────────────────
//   GET VIDEO INFO
// ─────────────────────────────────────────
function getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) return reject(err);
            const vs = metadata.streams.find(s => s.codec_type === 'video');
            resolve({
                width: vs?.width || 0,
                height: vs?.height || 0,
                duration: metadata.format.duration || 0,
                size: metadata.format.size || 0
            });
        });
    });
}

// ─────────────────────────────────────────
//   SINGLE PASS UPSCALE
// ─────────────────────────────────────────
function singlePassUpscale(inputPath, outputPath, targetW, targetH, preset) {
    return new Promise((resolve, reject) => {
        const vf = [
            `hqdn3d=${preset.denoise}`,
            `scale=${targetW}:${targetH}:flags=lanczos`,
            `unsharp=${preset.unsharp}`,
            `eq=brightness=${preset.brightness}:contrast=${preset.contrast}:saturation=${preset.saturation}`
        ].join(',');

        ffmpeg(inputPath)
            .outputOptions([
                `-vf ${vf}`,
                `-c:v libx264`,
                `-preset ${preset.preset}`,
                `-crf ${preset.crf}`,
                `-c:a aac`,
                `-b:a 192k`,
                `-movflags +faststart`,
                `-pix_fmt yuv420p`
            ])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

// ─────────────────────────────────────────
//   MULTI PASS UPSCALE
// ─────────────────────────────────────────
async function multiPassUpscale(inputPath, outputPath, targetW, targetH, preset, passes) {
    const tmpDir = os.tmpdir();
    let currentInput = inputPath;

    // Hitung resolusi tiap pass
    const stepW = Math.round((targetW - (targetW / passes)) / passes);
    const stepH = Math.round((targetH - (targetH / passes)) / passes);

    for (let i = 1; i <= passes; i++) {
        const isLast = i === passes;
        const passW = isLast ? targetW : Math.round(targetW * (i / passes));
        const passH = isLast ? targetH : Math.round(targetH * (i / passes));
        const passOutput = isLast ? outputPath : path.join(tmpDir, `hdvid_pass${i}_${Date.now()}.mp4`);

        // Kurangi crf di pass awal agar tidak kehilangan detail
        const passCrf = isLast ? preset.crf : preset.crf + (passes - i) * 2;
        const passPreset = { ...preset, crf: passCrf };

        await singlePassUpscale(currentInput, passOutput, passW, passH, passPreset);

        // Hapus file pass sebelumnya (bukan input asli)
        if (currentInput !== inputPath && fs.existsSync(currentInput)) {
            fs.unlinkSync(currentInput);
        }

        currentInput = passOutput;
    }
}

// ─────────────────────────────────────────
//   MAIN: HD VIDEO UPSCALE
// ─────────────────────────────────────────
async function hdVideoUpscale(buffer, factor) {
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const inputPath = path.join(tmpDir, `hdvid_input_${ts}.mp4`);
    const outputPath = path.join(tmpDir, `hdvid_output_${ts}.mp4`);

    try {
        // Tulis buffer ke file
        fs.writeFileSync(inputPath, buffer);

        // Ambil info video asli
        const info = await getVideoInfo(inputPath);
        if (!info.width || !info.height) throw new Error('Resolusi video tidak terdeteksi');

        // Hitung target resolusi
        const targetW = Math.round(info.width * factor);
        const targetH = Math.round(info.height * factor);

        const preset = HDV_PRESETS[factor];
        if (!preset) throw new Error(`Preset ${factor}x tidak tersedia`);

        // Pilih mode berdasarkan passes
        if (preset.passes >= 2) {
            await multiPassUpscale(inputPath, outputPath, targetW, targetH, preset, preset.passes);
        } else {
            await singlePassUpscale(inputPath, outputPath, targetW, targetH, preset);
        }

        // Baca hasil
        const resultBuffer = fs.readFileSync(outputPath);

        return resultBuffer;

    } finally {
        // Cleanup
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

module.exports = { hdVideoUpscale, HDV_PRESETS };
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HD_PRESETS = {
    2:  { label: '2x HD',    emoji: '🔹', desc: 'Resolusi 2× lebih besar',  timeEst: '~5 detik'   },
    4:  { label: '4x HD',    emoji: '🔷', desc: 'Resolusi 4× lebih besar',  timeEst: '~10 detik'  },
    6:  { label: '6x HD',    emoji: '🔵', desc: 'Resolusi 6× lebih besar',  timeEst: '~20 detik'  },
    8:  { label: '8x HD',    emoji: '🟣', desc: 'Resolusi 8× lebih besar',  timeEst: '~30 detik'  },
    10: { label: '10x HD',   emoji: '🟠', desc: 'Resolusi 10× lebih besar', timeEst: '~45 detik'  },
    12: { label: '12x HD',   emoji: '🔴', desc: 'Resolusi 12× lebih besar', timeEst: '~60 detik'  },
    16: { label: '16x HD',   emoji: '🟤', desc: 'Resolusi 16× lebih besar', timeEst: '~90 detik'  },
    18: { label: '18x Ultra',emoji: '⚫', desc: 'Resolusi 18× ULTRA',        timeEst: '~2 menit'   },
};

const MAX_OUTPUT_PX = 16000;

const ADVANCED_DENOISE_MATRIX = {
    low: { spatial: 1.2, temporal: 1.2, spatial_chroma: 5, temporal_chroma: 5 },
    medium: { spatial: 1.5, temporal: 1.5, spatial_chroma: 6, temporal_chroma: 6 },
    high: { spatial: 2.0, temporal: 2.0, spatial_chroma: 7, temporal_chroma: 7 },
    ultra: { spatial: 2.5, temporal: 2.5, spatial_chroma: 8, temporal_chroma: 8 }
};

const SHARPNESS_PROFILES = {
    soft: { luma_x: 3, luma_y: 3, luma_amount: 0.5, chroma_x: 2, chroma_y: 2, chroma_amount: 0.2 },
    balanced: { luma_x: 5, luma_y: 5, luma_amount: 0.8, chroma_x: 3, chroma_y: 3, chroma_amount: 0.3 },
    sharp: { luma_x: 5, luma_y: 5, luma_amount: 1.2, chroma_x: 3, chroma_y: 3, chroma_amount: 0.5 },
    extreme: { luma_x: 7, luma_y: 7, luma_amount: 1.5, chroma_x: 5, chroma_y: 5, chroma_amount: 0.7 }
};

const COLOR_ENHANCEMENT_CURVES = {
    natural: { saturation: 1.05, contrast: 1.02, gamma: 0.99, brightness: 0.00 },
    vivid: { saturation: 1.08, contrast: 1.03, gamma: 0.98, brightness: 0.01 },
    enhanced: { saturation: 1.10, contrast: 1.04, gamma: 0.97, brightness: 0.02 },
    cinematic: { saturation: 1.12, contrast: 1.05, gamma: 0.96, brightness: 0.03 },
    dramatic: { saturation: 1.15, contrast: 1.07, gamma: 0.95, brightness: 0.04 }
};

function calculateOptimalDenoise(factor) {
    if (factor <= 2) return ADVANCED_DENOISE_MATRIX.low;
    if (factor <= 6) return ADVANCED_DENOISE_MATRIX.medium;
    if (factor <= 12) return ADVANCED_DENOISE_MATRIX.high;
    return ADVANCED_DENOISE_MATRIX.ultra;
}

function selectSharpnessProfile(factor, stage) {
    if (stage === 'initial') {
        return factor <= 4 ? SHARPNESS_PROFILES.sharp : SHARPNESS_PROFILES.extreme;
    }
    if (stage === 'intermediate') {
        return factor <= 8 ? SHARPNESS_PROFILES.balanced : SHARPNESS_PROFILES.sharp;
    }
    return SHARPNESS_PROFILES.soft;
}

function determineColorProfile(factor) {
    if (factor <= 2) return COLOR_ENHANCEMENT_CURVES.natural;
    if (factor <= 4) return COLOR_ENHANCEMENT_CURVES.vivid;
    if (factor <= 8) return COLOR_ENHANCEMENT_CURVES.enhanced;
    if (factor <= 12) return COLOR_ENHANCEMENT_CURVES.cinematic;
    return COLOR_ENHANCEMENT_CURVES.dramatic;
}

function applyAdvancedDenoise(denoise) {
    return `hqdn3d=${denoise.spatial}:${denoise.temporal}:${denoise.spatial_chroma}:${denoise.temporal_chroma}`;
}

function applyUnsharpMask(profile) {
    return `unsharp=lx=${profile.luma_x}:ly=${profile.luma_y}:la=${profile.luma_amount}:cx=${profile.chroma_x}:cy=${profile.chroma_y}:ca=${profile.chroma_amount}`;
}

function applyColorCorrection(colorProfile) {
    return `eq=saturation=${colorProfile.saturation}:contrast=${colorProfile.contrast}:gamma=${colorProfile.gamma}:brightness=${colorProfile.brightness}`;
}

function applyEdgeEnhancement(strength) {
    const intensity = Math.min(strength * 0.1, 1.0);
    return `edgedetect=low=0.1:high=0.4:mode=colormix,blend=all_mode=overlay:all_opacity=${intensity}`;
}

function applyNoiseReduction(level) {
    return `nlmeans=s=${level}:p=7:r=15`;
}

function buildMultiStageScaling(factor, targetScale, stageProfile) {
    const filters = [];
    filters.push(`scale=iw*${targetScale}:ih*${targetScale}:flags=lanczos+accurate_rnd+full_chroma_int`);
    filters.push(applyUnsharpMask(stageProfile));
    
    if (targetScale >= 2) {
        filters.push(`gblur=sigma=0.5:steps=1`);
        filters.push(`cas=0.3`);
    }
    
    return filters.join(',');
}

function buildFilter(factor) {
    const denoise = calculateOptimalDenoise(factor);
    const colorProfile = determineColorProfile(factor);
    const filterStages = [];

    filterStages.push(applyAdvancedDenoise(denoise));
    filterStages.push(`pp=al|lb|ha|vb`);

    if (factor <= 2) {
        const sharpProfile = selectSharpnessProfile(factor, 'initial');
        filterStages.push(buildMultiStageScaling(factor, factor, sharpProfile));
        filterStages.push(`atadenoise=0a=0.02:0b=0.04`);
        filterStages.push(applyColorCorrection(colorProfile));
        filterStages.push(`vibrance=intensity=0.1`);
        return filterStages.join(',');
    }

    if (factor <= 4) {
        const stage1Profile = selectSharpnessProfile(factor, 'initial');
        const stage2Profile = selectSharpnessProfile(factor, 'intermediate');
        
        filterStages.push(buildMultiStageScaling(factor, 2, stage1Profile));
        filterStages.push(applyNoiseReduction(2.0));
        filterStages.push(buildMultiStageScaling(factor, factor / 2, stage2Profile));
        filterStages.push(`atadenoise=0a=0.03:0b=0.05`);
        filterStages.push(applyColorCorrection(colorProfile));
        filterStages.push(`vibrance=intensity=0.15`);
        filterStages.push(`tmix=frames=3:weights=1 1 1`);
        return filterStages.join(',');
    }

    if (factor <= 8) {
        const stage1Profile = selectSharpnessProfile(factor, 'initial');
        const stage2Profile = selectSharpnessProfile(factor, 'intermediate');
        const stage3Profile = selectSharpnessProfile(factor, 'final');
        
        filterStages.push(buildMultiStageScaling(factor, 2, stage1Profile));
        filterStages.push(applyNoiseReduction(2.5));
        filterStages.push(`dctdnoiz=sigma=4`);
        filterStages.push(buildMultiStageScaling(factor, 4, stage2Profile));
        filterStages.push(`atadenoise=0a=0.04:0b=0.06`);
        filterStages.push(buildMultiStageScaling(factor, factor / 4, stage3Profile));
        filterStages.push(applyColorCorrection(colorProfile));
        filterStages.push(`vibrance=intensity=0.2`);
        filterStages.push(`tmix=frames=5:weights=1 2 2 2 1`);
        filterStages.push(`limiter=min=16:max=235`);
        return filterStages.join(',');
    }

    const stage1Profile = selectSharpnessProfile(factor, 'initial');
    const stage2Profile = selectSharpnessProfile(factor, 'intermediate');
    const stage3Profile = SHARPNESS_PROFILES.balanced;
    const stage4Profile = selectSharpnessProfile(factor, 'final');
    
    filterStages.push(buildMultiStageScaling(factor, 2, stage1Profile));
    filterStages.push(applyNoiseReduction(3.0));
    filterStages.push(`dctdnoiz=sigma=5`);
    filterStages.push(buildMultiStageScaling(factor, 4, stage2Profile));
    filterStages.push(`atadenoise=0a=0.05:0b=0.07`);
    filterStages.push(`vaguedenoiser=threshold=2:method=hard:nsteps=6`);
    filterStages.push(buildMultiStageScaling(factor, 8, stage3Profile));
    filterStages.push(applyNoiseReduction(3.5));
    filterStages.push(buildMultiStageScaling(factor, factor / 8, stage4Profile));
    filterStages.push(applyColorCorrection(colorProfile));
    filterStages.push(`vibrance=intensity=0.25`);
    filterStages.push(`tmix=frames=7:weights=1 2 3 3 3 2 1`);
    filterStages.push(`limiter=min=16:max=235`);
    filterStages.push(`deflicker=mode=pm:size=5`);
    
    return filterStages.join(',');
}

async function hdUpscale(inputBuffer, factor) {
    factor = parseInt(factor);
    if (!HD_PRESETS[factor]) throw new Error(`Faktor ${factor}x tidak didukung`);

    const tmpDir  = os.tmpdir();
    const ts      = Date.now();
    const inPath  = path.join(tmpDir, `hd_in_${ts}.jpg`);
    const outPath = path.join(tmpDir, `hd_out_${ts}.jpg`);

    fs.writeFileSync(inPath, inputBuffer);

    try {
        const safePxFilter = `scale=min(iw\\*${factor}\\,${MAX_OUTPUT_PX}):min(ih\\*${factor}\\,${MAX_OUTPUT_PX}):force_original_aspect_ratio=decrease:flags=lanczos`;

        const filterChain = factor > 1
            ? buildFilter(factor)
            : `${safePxFilter},unsharp=lx=5:ly=5:la=0.8:cx=3:cy=3:ca=0.3,eq=saturation=1.05:contrast=1.02`;

        const finalFilter = filterChain.replace(
            /scale=iw\*[\d.]+:ih\*[\d.]+/g,
            (m, offset, str) => {
                const isLast = str.lastIndexOf(m) === offset;
                if (isLast) {
                    const fMatch = m.match(/iw\*(\d+(?:\.\d+)?)/);
                    const f = fMatch ? fMatch[1] : '1';
                    return `scale=min(iw\\*${f}\\,${MAX_OUTPUT_PX}):min(ih\\*${f}\\,${MAX_OUTPUT_PX}):force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int`;
                }
                return m;
            }
        );

        const cmd = [
            'ffmpeg',
            '-y',
            `-i "${inPath}"`,
            `-vf "${filterChain}"`,
            '-frames:v 1',
            '-update 1',
            '-q:v 1',
            '-compression_level 0',
            '-pix_fmt yuvj444p',
            '-color_range jpeg',
            '-colorspace bt709',
            `"${outPath}"`
        ].join(' ');

        execSync(cmd, { stdio: 'ignore', timeout: 180000 });

        if (!fs.existsSync(outPath)) throw new Error('Output tidak terbuat');

        const outBuf = fs.readFileSync(outPath);
        return outBuf;
    } finally {
        try { fs.unlinkSync(inPath); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
    }
}

module.exports = { hdUpscale, HD_PRESETS };
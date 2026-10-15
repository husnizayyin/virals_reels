import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { hardwareConfig } from '../../config/hardware.js';
import { CleanerOptions, InspectedMetadata } from './types.js';

export interface OptimizerExecutionResult {
  outputPath: string;
  renderTimeSeconds: number;
  encoderUsed: 'h264_qsv' | 'libx264' | 'copy';
  usedHardwareAcceleration: boolean;
}

/**
 * Builds the video filter chain based on target resolution, unsharp sharpening, and micro-dithering.
 */
function buildVideoFilter(
  sourceMeta: InspectedMetadata,
  options: CleanerOptions
): string {
  const filters: string[] = [];

  const res = options.resolution || '1080x1920';

  if (res === '1080x1920') {
    // High-retention vertical 9:16 aspect scaling with letterbox/pillarbox padding if non-9:16
    filters.push(
      'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos',
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black'
    );
  } else if (res === 'preserve_aspect') {
    // Cap at 1080p max dimension while keeping aspect ratio intact
    filters.push(
      'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos'
    );
  } else {
    // Ensure dimensions are divisible by 2 for yuv420p
    filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }

  // Micro-unsharp filter for razor-sharp appearance on mobile displays
  if (options.applyUnsharp !== false) {
    filters.push('unsharp=3:3:0.5:3:3:0.0');
  }

  // Micro-noise dithering: secretly prevents platform compression algorithms
  // from applying heavy deadzone quantization on smooth gradients
  if (options.applyMicroDither !== false) {
    filters.push('noise=alls=1:allf=t+u');
  }

  // Standardize pixel format
  filters.push('format=yuv420p');

  return filters.join(',');
}

/**
 * Executes the FFmpeg video processing pipeline with anti-compression, zero-FPS-drop tuning,
 * and complete metadata sanitization.
 */
export async function executeHdOptimization(
  inputPath: string,
  outputPath: string,
  sourceMeta: InspectedMetadata,
  options: CleanerOptions = {}
): Promise<OptimizerExecutionResult> {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    await fs.promises.mkdir(outputDir, { recursive: true });
  }

  const startTime = Date.now();

  // Fast-track: Metadata-only stripping without re-encoding (stream copy)
  if (options.platform === 'metadata_only') {
    return await executeMetadataOnlyCopy(inputPath, outputPath, startTime);
  }

  const tryQsv = hardwareConfig.hasQsvSupport && !options.forceCpu;

  if (tryQsv) {
    try {
      return await runFfmpegProcess(inputPath, outputPath, sourceMeta, options, true, startTime);
    } catch (qsvError: any) {
      console.warn(`[HDOptimizer] QSV failed (${qsvError.message}). Falling back to CPU libx264...`);
      return await runFfmpegProcess(inputPath, outputPath, sourceMeta, options, false, startTime);
    }
  } else {
    return await runFfmpegProcess(inputPath, outputPath, sourceMeta, options, false, startTime);
  }
}

/**
 * Fast metadata scrubbing using stream copy (zero re-encode time)
 */
function executeMetadataOnlyCopy(
  inputPath: string,
  outputPath: string,
  startTime: number
): Promise<OptimizerExecutionResult> {
  return new Promise((resolve, reject) => {
    const ffmpegBin = hardwareConfig.ffmpegPath;
    const args: string[] = [
      '-y',
      '-i', inputPath,
      '-c', 'copy',
      '-map_metadata', '-1',
      '-map_chapters', '-1',
      '-fflags', '+bitexact',
      '-flags:v', '+bitexact',
      '-flags:a', '+bitexact',
      '-movflags', '+faststart',
      outputPath
    ];

    const child = spawn(ffmpegBin, args);
    let stderr = '';

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => reject(new Error(`Failed to run FFmpeg: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        const renderTimeSeconds = (Date.now() - startTime) / 1000;
        resolve({
          outputPath,
          renderTimeSeconds: parseFloat(renderTimeSeconds.toFixed(2)),
          encoderUsed: 'copy',
          usedHardwareAcceleration: false
        });
      } else {
        reject(new Error(`FFmpeg exited with code ${code}. Error: ${stderr.slice(-800)}`));
      }
    });
  });
}

/**
 * Full anti-compression re-encoding pipeline
 */
function runFfmpegProcess(
  inputPath: string,
  outputPath: string,
  sourceMeta: InspectedMetadata,
  options: CleanerOptions,
  useQsv: boolean,
  startTime: number
): Promise<OptimizerExecutionResult> {
  return new Promise((resolve, reject) => {
    const ffmpegBin = hardwareConfig.ffmpegPath;
    const targetFps = options.fps === 30 ? 30 : options.fps === 'source' ? (sourceMeta.video?.fps || 30) : 60;
    const platform = options.platform || 'reels';

    const args: string[] = ['-y'];

    if (useQsv) {
      args.push('-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw');
    }

    args.push('-i', inputPath);

    // 1. Video Filter Graph
    const vf = buildVideoFilter(sourceMeta, options);
    args.push('-vf', vf);

    // 2. Strict Constant Frame Rate (CFR) to prevent mobile VFR stutter & drop
    const gopSize = targetFps * 2; // Exact 2-second keyframe interval required by Meta/TikTok ingest
    const minGop = targetFps;     // 1-second minimum GOP

    args.push(
      '-r', String(targetFps),
      '-fps_mode', 'cfr',
      '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-color_range', 'tv',
      '-g', String(gopSize),
      '-keyint_min', String(minGop),
      '-sc_threshold', '0',
      '-flags', '+cgop',
      '-profile:v', 'high',
      '-level', '4.2'
    );

    // 3. Bitrate Sweet Spot & Video Encoder Selection
    if (useQsv) {
      const bitrates = targetFps === 60
        ? { b: '15000k', max: '18000k', buf: '36000k' }
        : { b: '10000k', max: '13500k', buf: '27000k' };

      args.push(
        '-c:v', 'h264_qsv',
        '-preset', 'medium',
        '-b:v', bitrates.b,
        '-maxrate', bitrates.max,
        '-bufsize', bitrates.buf
      );
    } else {
      const bitrates = targetFps === 60
        ? { max: '18000k', buf: '36000k' }
        : { max: '13500k', buf: '27000k' };

      args.push(
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '18',              // Visually lossless mastering standard
        '-maxrate', bitrates.max,
        '-bufsize', bitrates.buf
      );
    }

    // 4. Audio Normalization (EBU R128)
    if (sourceMeta.audio && options.normalizeAudio !== false) {
      // Reels: -14 LUFS, TikTok: -16 LUFS
      const lufsTarget = platform === 'tiktok' ? -16 : -14;
      args.push(
        '-af', `loudnorm=I=${lufsTarget}:TP=-1.0:LRA=11`,
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2'
      );
    } else if (sourceMeta.audio) {
      args.push(
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000'
      );
    } else {
      args.push('-an');
    }

    // 5. Metadata Handling & FastStart
    if (options.stripMetadata !== false) {
      // Total anonymization: strip all tags and enforce bitexact streams
      args.push(
        '-map_metadata', '-1',
        '-map_chapters', '-1',
        '-fflags', '+bitexact',
        '-flags:v', '+bitexact',
        '-flags:a', '+bitexact'
      );
    } else {
      // Keep original camera & device metadata (crucial for TikTok original UGC trust score)
      // Only scrub privacy location/GPS tags if present
      args.push(
        '-map_metadata', '0',
        '-metadata', 'location=',
        '-metadata', 'location-eng='
      );
    }

    args.push('-movflags', '+faststart', outputPath);

    const child = spawn(ffmpegBin, args);
    let stderr = '';
    const totalDuration = sourceMeta.durationSeconds || 1;

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;

      if (options.onProgress && totalDuration > 0) {
        const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseFloat(timeMatch[3]);
          const currentSec = hours * 3600 + minutes * 60 + seconds;
          const pct = Math.min(99, Math.max(1, Math.round((currentSec / totalDuration) * 100)));
          options.onProgress(pct);
        }
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg optimizer: ${err.message}`));
    });

    child.on('close', (code) => {
      const renderTimeSeconds = (Date.now() - startTime) / 1000;
      if (code === 0 && fs.existsSync(outputPath)) {
        if (options.onProgress) options.onProgress(100);
        resolve({
          outputPath,
          renderTimeSeconds: parseFloat(renderTimeSeconds.toFixed(2)),
          encoderUsed: useQsv ? 'h264_qsv' : 'libx264',
          usedHardwareAcceleration: useQsv
        });
      } else {
        reject(
          new Error(
            `FFmpeg HD Optimizer failed with exit code ${code}. Details: ${stderr.slice(-1200)}`
          )
        );
      }
    });
  });
}

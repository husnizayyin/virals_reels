import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { hardwareConfig } from '../config/hardware.js';

export interface CompositorOptions {
  forceCpu?: boolean;
  onProgress?: (percent: number) => void;
  totalDurationSeconds?: number;
}

export interface CompositorResult {
  outputPath: string;
  usedHardwareAcceleration: boolean;
  encoderUsed: 'h264_qsv' | 'libx264';
  durationSeconds: number;
  renderTimeSeconds: number;
}

/**
 * Escapes file path for FFmpeg filtergraph (ass='...')
 */
function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * Runs video compositing: 9:16 auto-crop, ASS subtitle burning, and loudnorm EBU R128 audio normalization.
 * Automatically tries Intel QSV first if available, with resilient CPU fallback if QSV fails.
 */
export async function compositeVideo(
  inputVideoPath: string,
  assFilePath: string,
  outputVideoPath: string,
  options: CompositorOptions = {}
): Promise<CompositorResult> {
  const outputDir = path.dirname(outputVideoPath);
  if (!fs.existsSync(outputDir)) {
    await fs.promises.mkdir(outputDir, { recursive: true });
  }

  const startTime = Date.now();
  const tryQsv = hardwareConfig.hasQsvSupport && !options.forceCpu;

  if (tryQsv) {
    try {
      return await executeFfmpegComposite(inputVideoPath, assFilePath, outputVideoPath, true, options, startTime);
    } catch (qsvError: any) {
      console.warn(`[VideoCompositor] QSV encoding failed (${qsvError.message}). Falling back to CPU libx264...`);
      // Fallback to CPU encoding
      return await executeFfmpegComposite(inputVideoPath, assFilePath, outputVideoPath, false, options, startTime);
    }
  } else {
    return await executeFfmpegComposite(inputVideoPath, assFilePath, outputVideoPath, false, options, startTime);
  }
}

function executeFfmpegComposite(
  inputVideoPath: string,
  assFilePath: string,
  outputVideoPath: string,
  useQsv: boolean,
  options: CompositorOptions,
  startTime: number
): Promise<CompositorResult> {
  return new Promise((resolve, reject) => {
    const ffmpegBin = hardwareConfig.ffmpegPath;
    const escapedAss = escapeFilterPath(assFilePath);

    const videoFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,ass='${escapedAss}',format=yuv420p`;
    const audioFilter = 'loudnorm=I=-14:TP=-1.0:LRA=11';

    const args: string[] = ['-y'];

    if (useQsv) {
      args.push('-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw');
    }

    args.push('-i', inputVideoPath);
    args.push('-vf', videoFilter);
    args.push('-af', audioFilter);

    // Social Media Ultra-Quality & Zero FPS Drop Tuning:
    // 1. Force Constant Frame Rate (CFR) at 30fps to avoid mobile VFR stutter
    // 2. Strict 2-second GOP (keyframe every 60 frames) per Meta/TikTok guidelines
    // 3. High Profile Level 4.2 with yuv420p and Rec.709 color tagging
    args.push(
      '-r', '30',
      '-fps_mode', 'cfr',
      '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-g', '60',
      '-keyint_min', '30',
      '-profile:v', 'high',
      '-level', '4.2'
    );

    if (useQsv) {
      args.push(
        '-c:v', 'h264_qsv',
        '-preset', 'medium',
        '-b:v', '8500k',
        '-maxrate', '12000k',
        '-bufsize', '24000k'
      );
    } else {
      args.push(
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '18',              // Visually lossless mastering quality
        '-maxrate', '12000k',
        '-bufsize', '24000k'
      );
    }

    args.push(
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',             // Studio standard 48kHz audio
      '-movflags', '+faststart',
      outputVideoPath
    );

    const child = spawn(ffmpegBin, args);

    let stderr = '';

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;

      // Extract progress if duration is provided
      if (options.totalDurationSeconds && options.onProgress) {
        const timeMatch = chunk.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseFloat(timeMatch[3]);
          const currentSec = hours * 3600 + minutes * 60 + seconds;
          const pct = Math.min(100, Math.round((currentSec / options.totalDurationSeconds) * 100));
          options.onProgress(pct);
        }
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start FFmpeg: ${err.message}`));
    });

    child.on('close', (code) => {
      const renderTimeSeconds = (Date.now() - startTime) / 1000;

      if (code === 0 && fs.existsSync(outputVideoPath)) {
        resolve({
          outputPath: outputVideoPath,
          usedHardwareAcceleration: useQsv,
          encoderUsed: useQsv ? 'h264_qsv' : 'libx264',
          durationSeconds: options.totalDurationSeconds || 0,
          renderTimeSeconds: parseFloat(renderTimeSeconds.toFixed(2))
        });
      } else {
        reject(
          new Error(
            `FFmpeg exited with error code ${code}. Details: ${stderr.slice(-1200)}`
          )
        );
      }
    });
  });
}

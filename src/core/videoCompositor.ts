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

    const videoFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,ass='${escapedAss}'`;
    const audioFilter = 'loudnorm=I=-14:TP=-1.0:LRA=11';

    const args: string[] = ['-y'];

    if (useQsv) {
      args.push('-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw');
    }

    args.push('-i', inputVideoPath);
    args.push('-vf', videoFilter);
    args.push('-af', audioFilter);

    if (useQsv) {
      args.push(
        '-c:v', 'h264_qsv',
        '-preset', 'veryfast',
        '-b:v', '6500k',
        '-maxrate', '8500k',
        '-bufsize', '13000k'
      );
    } else {
      args.push(
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '22'
      );
    }

    args.push(
      '-c:a', 'aac',
      '-b:a', '192k',
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

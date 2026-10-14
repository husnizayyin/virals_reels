import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { hardwareConfig } from '../config/hardware.js';
import { env } from '../config/env.js';

const execFileAsync = promisify(execFile);

export interface MediaMetadata {
  duration: number;
  width: number;
  height: number;
  formatName: string;
  hasAudio: boolean;
  audioChannels: number;
  audioSampleRate: number;
  fileSizeBytes: number;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates an uploaded media file using ffprobe and checks size, duration, format, and audio channel requirements.
 */
export async function validateAndInspectMedia(filePath: string): Promise<MediaMetadata> {
  if (!fs.existsSync(filePath)) {
    throw new ValidationError(`Input file does not exist: ${filePath}`);
  }

  const stat = await fs.promises.stat(filePath);
  const maxSizeBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
  if (stat.size > maxSizeBytes) {
    const sizeStr = stat.size >= 1024 * 1024 * 1024
      ? `${(stat.size / 1024 / 1024 / 1024).toFixed(2)} GB`
      : `${(stat.size / 1024 / 1024).toFixed(1)} MB`;
    const maxStr = env.MAX_FILE_SIZE_MB >= 1024
      ? `${(env.MAX_FILE_SIZE_MB / 1024).toFixed(0)} GB`
      : `${env.MAX_FILE_SIZE_MB} MB`;
    throw new ValidationError(
      `File size (${sizeStr}) exceeds maximum allowed limit of ${maxStr}`
    );
  }

  const ffprobeBin = hardwareConfig.ffprobePath;

  try {
    const { stdout } = await execFileAsync(ffprobeBin, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ], { maxBuffer: 10 * 1024 * 1024 });

    const info = JSON.parse(stdout);

    const streams = info.streams || [];
    const videoStream = streams.find((s: any) => s.codec_type === 'video');
    const audioStream = streams.find((s: any) => s.codec_type === 'audio');

    if (!videoStream) {
      throw new ValidationError('File does not contain a valid video track.');
    }

    if (!audioStream) {
      throw new ValidationError('Video must contain at least 1 audio track for speech transcription.');
    }

    const audioChannels = parseInt(audioStream.channels, 10) || 0;
    if (audioChannels < 1) {
      throw new ValidationError('Audio stream has 0 channels.');
    }

    const duration = parseFloat(info.format?.duration || videoStream.duration || audioStream.duration || '0');
    if (duration <= 0) {
      throw new ValidationError('Unable to determine video duration.');
    }

    if (duration > env.MAX_VIDEO_DURATION_SEC) {
      throw new ValidationError(
        `Video duration (${duration.toFixed(1)}s) exceeds maximum allowed of ${env.MAX_VIDEO_DURATION_SEC} seconds.`
      );
    }

    return {
      duration,
      width: parseInt(videoStream.width, 10) || 1080,
      height: parseInt(videoStream.height, 10) || 1920,
      formatName: info.format?.format_name || 'unknown',
      hasAudio: true,
      audioChannels,
      audioSampleRate: parseInt(audioStream.sample_rate, 10) || 16000,
      fileSizeBytes: stat.size
    };
  } catch (err: any) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`Failed to probe video: ${err.message}`);
  }
}

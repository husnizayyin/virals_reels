import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { hardwareConfig } from '../config/hardware.js';

const execFileAsync = promisify(execFile);

export interface SilenceInterval {
  startMs: number;
  endMs: number;
}

export interface AudioExtractionResult {
  wavPath: string;
  duration?: number;
  silenceIntervals: SilenceInterval[];
}

/**
 * Detects silence intervals using FFmpeg silencedetect filter (noise < -32dB for >= 250ms).
 */
export async function detectSilenceIntervals(wavPath: string): Promise<SilenceInterval[]> {
  const ffmpegBin = hardwareConfig.ffmpegPath;
  const args = [
    '-i', wavPath,
    '-af', 'silencedetect=noise=-32dB:d=0.25',
    '-f', 'null',
    '-'
  ];

  try {
    const { stderr } = await execFileAsync(ffmpegBin, args, { maxBuffer: 10 * 1024 * 1024 });
    const intervals: SilenceInterval[] = [];
    let currentStart: number | null = null;
    const lines = stderr.split('\n');

    for (const line of lines) {
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      if (startMatch) {
        currentStart = parseFloat(startMatch[1]) * 1000;
      }
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      if (endMatch && currentStart !== null) {
        const end = parseFloat(endMatch[1]) * 1000;
        intervals.push({ startMs: Math.round(currentStart), endMs: Math.round(end) });
        currentStart = null;
      }
    }
    return intervals;
  } catch (err) {
    console.warn('[AudioExtractor] Silence detection warning:', err);
    return [];
  }
}

/**
 * Extracts a 16kHz mono 16-bit PCM WAV audio file from an input video and detects silence ranges.
 */
export async function extractAudioForWhisper(
  inputVideoPath: string,
  outputWavPath: string
): Promise<AudioExtractionResult> {
  const targetDir = path.dirname(outputWavPath);
  if (!fs.existsSync(targetDir)) {
    await fs.promises.mkdir(targetDir, { recursive: true });
  }

  const ffmpegBin = hardwareConfig.ffmpegPath;

  const args = [
    '-y',
    '-i', inputVideoPath,
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    outputWavPath
  ];

  try {
    await execFileAsync(ffmpegBin, args, { maxBuffer: 10 * 1024 * 1024 });

    if (!fs.existsSync(outputWavPath)) {
      throw new Error(`Output WAV file was not created at ${outputWavPath}`);
    }

    const stat = await fs.promises.stat(outputWavPath);
    if (stat.size === 0) {
      throw new Error(`Extracted audio file is empty (0 bytes)`);
    }

    const silenceIntervals = await detectSilenceIntervals(outputWavPath);

    return {
      wavPath: outputWavPath,
      silenceIntervals
    };
  } catch (err: any) {
    throw new Error(`Audio extraction failed: ${err.message}`);
  }
}

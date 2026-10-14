import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { hardwareConfig } from '../config/hardware.js';

const execFileAsync = promisify(execFile);

export interface AudioExtractionResult {
  wavPath: string;
  duration?: number;
}

/**
 * Extracts a 16kHz mono 16-bit PCM WAV audio file from an input video.
 * Specification: ffmpeg -y -i "{input_path}" -vn -ar 16000 -ac 1 -c:a pcm_s16le "{output_wav_path}"
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

    return { wavPath: outputWavPath };
  } catch (err: any) {
    throw new Error(`Audio extraction failed: ${err.message}`);
  }
}

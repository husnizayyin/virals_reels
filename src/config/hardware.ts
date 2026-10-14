import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { env } from './env.js';

export interface HardwareInfo {
  cpuModel: string;
  totalCores: number;
  logicalThreads: number;
  whisperThreadCap: number;
  workerConcurrency: number;
  maxMemoryBytes: number;
  hasQsvSupport: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  whisperCliPath: string;
}

/**
 * Resolves the path to a binary executable by checking:
 * 1. Explicit environment variable or custom path
 * 2. Project ./bin/ directory
 * 3. System PATH
 */
export function resolveBinary(name: string, customPath?: string): string {
  // 1. Explicit path
  if (customPath && customPath.trim() !== '') {
    const resolved = path.isAbsolute(customPath) ? customPath : path.resolve(process.cwd(), customPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  // 2. Project ./bin/
  const ext = process.platform === 'win32' ? '.exe' : '';
  const localBin = path.resolve(process.cwd(), 'bin', `${name}${ext}`);
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  // Also check without extension if win32
  const localBinNoExt = path.resolve(process.cwd(), 'bin', name);
  if (fs.existsSync(localBinNoExt)) {
    return localBinNoExt;
  }

  // 3. Fallback to system name
  return name;
}

/**
 * Checks if the resolved FFmpeg binary has Intel QuickSync (h264_qsv) support.
 */
function detectQsvSupport(ffmpegBinary: string): boolean {
  if (env.FORCE_CPU_ENCODING) {
    return false;
  }

  try {
    const output = execSync(`"${ffmpegBinary}" -encoders`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const hasEncoder = output.includes('h264_qsv');

    // On Linux, verify DRM / render node accessibility for hardware device
    if (hasEncoder && process.platform === 'linux') {
      const driExists = fs.existsSync('/dev/dri/renderD128') || fs.existsSync('/dev/dri/card0');
      return driExists;
    }

    return hasEncoder;
  } catch {
    return false;
  }
}

// Global cached hardware resolution
const cpus = os.cpus();
const ffmpegPath = resolveBinary('ffmpeg', env.FFMPEG_PATH);
const ffprobePath = resolveBinary('ffprobe', env.FFPROBE_PATH);
const whisperCliPath = resolveBinary('whisper-cli', env.WHISPER_BIN_PATH);

export const hasQsvSupport = detectQsvSupport(ffmpegPath);

export const hardwareConfig: HardwareInfo = {
  cpuModel: cpus[0]?.model || 'Intel Core i5-1235U Baseline',
  totalCores: cpus.length,
  logicalThreads: cpus.length,
  whisperThreadCap: env.WHISPER_THREADS,
  workerConcurrency: env.WORKER_CONCURRENCY,
  maxMemoryBytes: 2.5 * 1024 * 1024 * 1024, // 2.5 GB Headroom cap per PRD
  hasQsvSupport,
  ffmpegPath,
  ffprobePath,
  whisperCliPath
};

/**
 * Re-evaluate hardware detection (useful after environment setup script runs)
 */
export function refreshHardwareDetection(): HardwareInfo {
  hardwareConfig.ffmpegPath = resolveBinary('ffmpeg', env.FFMPEG_PATH);
  hardwareConfig.ffprobePath = resolveBinary('ffprobe', env.FFPROBE_PATH);
  hardwareConfig.whisperCliPath = resolveBinary('whisper-cli', env.WHISPER_BIN_PATH);
  hardwareConfig.hasQsvSupport = detectQsvSupport(hardwareConfig.ffmpegPath);
  return hardwareConfig;
}

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { hardwareConfig } from '../../config/hardware.js';
import { InspectedMetadata, StreamMetadata } from './types.js';

const execFileAsync = promisify(execFile);

function parseFraction(fracStr?: string): number {
  if (!fracStr) return 0;
  if (!fracStr.includes('/')) return parseFloat(fracStr) || 0;
  const [num, den] = fracStr.split('/').map(Number);
  if (!den || isNaN(num) || isNaN(den)) return 0;
  return parseFloat((num / den).toFixed(2));
}

/**
 * Inspects a media file using FFprobe and parses comprehensive container & stream metadata,
 * including privacy tags (GPS, camera model, editor signatures) and frame rate consistency.
 */
export async function inspectMediaFile(filePath: string): Promise<InspectedMetadata> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = await fs.promises.stat(filePath);
  const ffprobeBin = hardwareConfig.ffprobePath;

  const { stdout } = await execFileAsync(
    ffprobeBin,
    [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ],
    { maxBuffer: 15 * 1024 * 1024 }
  );

  const parsed = JSON.parse(stdout);
  const format = parsed.format || {};
  const streams: any[] = parsed.streams || [];

  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  let videoMeta: StreamMetadata | null = null;
  if (videoStream) {
    const avgFps = parseFraction(videoStream.avg_frame_rate);
    const rFps = parseFraction(videoStream.r_frame_rate);
    // VFR detection: If average frame rate differs from declared nominal frame rate by > 0.05
    const isVfr = Math.abs(avgFps - rFps) > 0.05 || avgFps.toString().includes('.');

    videoMeta = {
      codecName: videoStream.codec_name || 'unknown',
      codecType: 'video',
      width: videoStream.width ? parseInt(videoStream.width, 10) : undefined,
      height: videoStream.height ? parseInt(videoStream.height, 10) : undefined,
      fps: rFps || avgFps || 30,
      isVfr,
      bitrateKbps: videoStream.bit_rate ? Math.round(parseInt(videoStream.bit_rate, 10) / 1000) : undefined,
      colorSpace: videoStream.color_space || undefined,
      colorPrimaries: videoStream.color_primaries || undefined,
      colorTransfer: videoStream.color_trc || undefined
    };
  }

  let audioMeta: StreamMetadata | null = null;
  if (audioStream) {
    audioMeta = {
      codecName: audioStream.codec_name || 'unknown',
      codecType: 'audio',
      fps: 0,
      isVfr: false,
      bitrateKbps: audioStream.bit_rate ? Math.round(parseInt(audioStream.bit_rate, 10) / 1000) : undefined,
      sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : undefined,
      channels: audioStream.channels ? parseInt(audioStream.channels, 10) : undefined
    };
  }

  // Combine format tags and stream tags to check for privacy markers
  const allTags: Record<string, string> = {
    ...(format.tags || {})
  };

  streams.forEach((s) => {
    if (s.tags) {
      Object.entries(s.tags).forEach(([k, v]) => {
        allTags[`stream_${s.index}_${k}`] = String(v);
      });
    }
  });

  const tagKeys = Object.keys(allTags);
  const tagKeysLower = tagKeys.map((k) => k.toLowerCase());

  // Detect GPS
  const gpsKey = tagKeys.find((k) => {
    const lower = k.toLowerCase();
    return lower.includes('location') || lower.includes('gps') || lower.includes('iso6709') || lower.includes('coord');
  });
  const hasGps = Boolean(gpsKey);
  const gpsCoordinates = gpsKey ? allTags[gpsKey] : undefined;

  // Detect Camera / Device Make & Model
  const modelKey = tagKeys.find((k) => {
    const lower = k.toLowerCase();
    return lower.includes('model') || lower.includes('make') || lower.includes('device');
  });
  const cameraMakeModel = modelKey ? allTags[modelKey] : undefined;

  // Detect Creation Date
  const dateKey = tagKeys.find((k) => {
    const lower = k.toLowerCase();
    return lower.includes('creation_time') || lower.includes('date');
  });
  const creationTime = dateKey ? allTags[dateKey] : undefined;

  // Detect Editing Software / Encoder signatures
  const softwareKey = tagKeys.find((k) => {
    const lower = k.toLowerCase();
    return lower.includes('software') || lower.includes('encoder') || lower.includes('handler_name') || lower.includes('vendor');
  });
  const detectedSoftware = softwareKey ? allTags[softwareKey] : undefined;

  const durationSeconds = parseFloat(format.duration || (videoStream && videoStream.duration) || '0');

  return {
    durationSeconds: parseFloat(durationSeconds.toFixed(2)),
    fileSizeBytes: stat.size,
    formatName: format.format_name || 'unknown',
    video: videoMeta,
    audio: audioMeta,
    hasGps,
    gpsCoordinates,
    cameraMakeModel,
    creationTime,
    detectedSoftware,
    atomTagsCount: tagKeys.length,
    rawTags: allTags
  };
}

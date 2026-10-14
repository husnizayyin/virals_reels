export type PlatformPreset = 'reels' | 'tiktok' | 'universal' | 'metadata_only';
export type FpsTarget = 30 | 60 | 'source';
export type ResolutionTarget = '1080x1920' | 'preserve_aspect' | 'original';

export interface CleanerOptions {
  platform?: PlatformPreset;
  fps?: FpsTarget;
  resolution?: ResolutionTarget;
  stripMetadata?: boolean;
  applyMicroDither?: boolean;
  applyUnsharp?: boolean;
  normalizeAudio?: boolean;
  forceCpu?: boolean;
  onProgress?: (percent: number) => void;
}

export interface StreamMetadata {
  codecName: string;
  codecType: string;
  width?: number;
  height?: number;
  fps: number;
  isVfr: boolean;
  bitrateKbps?: number;
  colorSpace?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
  sampleRate?: number;
  channels?: number;
}

export interface InspectedMetadata {
  durationSeconds: number;
  fileSizeBytes: number;
  formatName: string;
  video: StreamMetadata | null;
  audio: StreamMetadata | null;
  // Privacy & Tracking metadata
  hasGps: boolean;
  gpsCoordinates?: string;
  cameraMakeModel?: string;
  creationTime?: string;
  detectedSoftware?: string;
  atomTagsCount: number;
  rawTags: Record<string, string>;
}

export interface CleanerResult {
  outputPath: string;
  outputFileName: string;
  fileSizeBytes: number;
  durationSeconds: number;
  renderTimeSeconds: number;
  encoderUsed: 'h264_qsv' | 'libx264' | 'copy';
  usedHardwareAcceleration: boolean;
  before: InspectedMetadata;
  after: InspectedMetadata;
}

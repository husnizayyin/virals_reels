import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Redis
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // Media Binaries & Paths
  WHISPER_BIN_PATH: z.string().default('./bin/whisper-cli'),
  WHISPER_MODEL_PATH: z.string().default('./models/ggml-base.bin'),
  FFMPEG_PATH: z.string().optional().default(''),
  FFPROBE_PATH: z.string().optional().default(''),

  // Hardware Tuning & Performance Limits
  WHISPER_THREADS: z.coerce.number().min(1).max(12).default(4),
  WORKER_CONCURRENCY: z.coerce.number().min(1).max(4).default(1),
  FORCE_CPU_ENCODING: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),

  // Storage and file limits
  STORAGE_DIR: z.string().default('./storage'),
  MAX_FILE_SIZE_MB: z.coerce.number().default(500),
  MAX_VIDEO_DURATION_SEC: z.coerce.number().default(180),
  TEMP_CLEANUP_HOURS: z.coerce.number().default(24)
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Environment configuration validation error:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;

// Resolved absolute paths
export const STORAGE_PATH = path.resolve(process.cwd(), env.STORAGE_DIR);
export const UPLOADS_DIR = path.join(STORAGE_PATH, 'uploads');
export const TEMP_DIR = path.join(STORAGE_PATH, 'temp');
export const OUTPUTS_DIR = path.join(STORAGE_PATH, 'outputs');

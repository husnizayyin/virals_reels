import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { OUTPUTS_DIR } from '../../config/env.js';
import { CleanerOptions, CleanerResult, InspectedMetadata } from './types.js';
import { inspectMediaFile } from './metadataScrubber.js';
import { executeHdOptimization } from './hdOptimizerEngine.js';

export interface CleanerJobState {
  jobId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  message: string;
  originalFileName: string;
  inputPath: string;
  outputPath?: string;
  result?: CleanerResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// In-memory job registry for HD cleaner tasks (isolated from BullMQ whisper jobs)
const cleanerJobs = new Map<string, CleanerJobState>();

export function getCleanerJob(jobId: string): CleanerJobState | undefined {
  return cleanerJobs.get(jobId);
}

export function getAllCleanerJobs(): CleanerJobState[] {
  return Array.from(cleanerJobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function createCleanerJob(
  originalFileName: string,
  inputPath: string
): string {
  const jobId = `clean_${crypto.randomUUID()}`;
  const now = Date.now();

  const state: CleanerJobState = {
    jobId,
    status: 'PENDING',
    progress: 0,
    message: 'Task initiated.',
    originalFileName,
    inputPath,
    createdAt: now,
    updatedAt: now
  };

  cleanerJobs.set(jobId, state);
  return jobId;
}

/**
 * Executes the complete video cleaning pipeline asynchronously.
 */
export async function runCleanerPipeline(
  jobId: string,
  options: CleanerOptions = {}
): Promise<CleanerResult> {
  const job = cleanerJobs.get(jobId);
  if (!job) {
    throw new Error(`Cleaner job '${jobId}' not found.`);
  }

  job.status = 'PROCESSING';
  job.progress = 5;
  job.message = 'Inspecting source video metadata...';
  job.updatedAt = Date.now();

  try {
    // 1. Inspect Source Metadata (Before)
    const before = await inspectMediaFile(job.inputPath);

    job.progress = 15;
    job.message = 'Optimizing video stream (CFR, GOP & bitexact sanitization)...';
    job.updatedAt = Date.now();

    // 2. Prepare Output Path
    if (!fs.existsSync(OUTPUTS_DIR)) {
      await fs.promises.mkdir(OUTPUTS_DIR, { recursive: true });
    }

    const outputFileName = `hd_cleaned_${job.jobId}.mp4`;
    const outputPath = path.join(OUTPUTS_DIR, outputFileName);
    job.outputPath = outputPath;

    // 3. Run Optimization Engine with progress callback
    const execResult = await executeHdOptimization(
      job.inputPath,
      outputPath,
      before,
      {
        ...options,
        onProgress: (pct) => {
          // Map encoding progress from 15% to 90%
          const overall = Math.round(15 + (pct * 0.75));
          job.progress = Math.min(90, overall);
          job.message = `Encoding video frame graph (${pct}%)...`;
          job.updatedAt = Date.now();
        }
      }
    );

    job.progress = 92;
    job.message = 'Verifying sanitized output metadata...';
    job.updatedAt = Date.now();

    // 4. Inspect Output Metadata (After)
    const after = await inspectMediaFile(outputPath);
    const outputStat = await fs.promises.stat(outputPath);

    const cleanerResult: CleanerResult = {
      outputPath,
      outputFileName,
      fileSizeBytes: outputStat.size,
      durationSeconds: after.durationSeconds,
      renderTimeSeconds: execResult.renderTimeSeconds,
      encoderUsed: execResult.encoderUsed,
      usedHardwareAcceleration: execResult.usedHardwareAcceleration,
      before,
      after
    };

    job.status = 'COMPLETED';
    job.progress = 100;
    job.message = 'Video successfully sanitized and HD optimized!';
    job.result = cleanerResult;
    job.updatedAt = Date.now();

    return cleanerResult;
  } catch (err: any) {
    job.status = 'FAILED';
    job.error = err.message || 'Optimization failed.';
    job.message = `Processing failed: ${err.message}`;
    job.updatedAt = Date.now();
    throw err;
  }
}

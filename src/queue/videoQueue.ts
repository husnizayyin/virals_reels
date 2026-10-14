import { Queue } from 'bullmq';
import { redisConnectionOptions } from './connection.js';

export const QUEUE_NAME = 'video-processing';

export type JobStatus =
  | 'QUEUED'
  | 'EXTRACTING_AUDIO'
  | 'TRANSCRIBING'
  | 'GENERATING_SUBTITLES'
  | 'COMPOSITING'
  | 'COMPLETED'
  | 'FAILED';

export interface VideoJobData {
  jobId: string;
  originalFileName: string;
  inputFilePath: string;
  language: string;
  highlightColor: string;
  marginV?: number;
  maxWordsPerChunk?: number;
  duration?: number;
  prompt?: string;
}

export interface JobResult {
  downloadUrl: string;
  duration: number;
  processingTimeSeconds: number;
  hardwareAccelerationUsed: boolean;
  encoderUsed: string;
  outputPath?: string;
}

export interface JobStateResponse {
  jobId: string;
  status: JobStatus;
  progress: number;
  message?: string;
  result: JobResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// In-memory fast cache for real-time status polling
const jobStateStore = new Map<string, JobStateResponse>();

export function setJobState(jobId: string, stateUpdate: Partial<JobStateResponse>): JobStateResponse {
  const current = jobStateStore.get(jobId) || {
    jobId,
    status: 'QUEUED',
    progress: 0,
    message: 'Job submitted to queue',
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const updated: JobStateResponse = {
    ...current,
    ...stateUpdate,
    updatedAt: new Date().toISOString()
  };

  jobStateStore.set(jobId, updated);
  return updated;
}

export function getJobState(jobId: string): JobStateResponse | undefined {
  return jobStateStore.get(jobId);
}

export function getAllRecentJobs(): JobStateResponse[] {
  return Array.from(jobStateStore.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

let videoQueueInstance: Queue<VideoJobData> | null = null;

export function getVideoQueue(): Queue<VideoJobData> {
  if (!videoQueueInstance) {
    videoQueueInstance = new Queue<VideoJobData>(QUEUE_NAME, {
      connection: redisConnectionOptions,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 }
      }
    });
  }
  return videoQueueInstance;
}

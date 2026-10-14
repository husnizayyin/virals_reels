import { Worker, Job } from 'bullmq';
import path from 'path';
import fs from 'fs';
import { redisConnectionOptions } from './connection.js';
import {
  QUEUE_NAME,
  VideoJobData,
  JobResult,
  setJobState
} from './videoQueue.js';
import { extractAudioForWhisper } from '../core/audioExtractor.js';
import { runWhisperTranscription } from '../core/whisperRunner.js';
import { generateAssSubtitleFile } from '../core/assBuilder.js';
import { compositeVideo } from '../core/videoCompositor.js';
import { cleanJobTempDir } from '../utils/fileCleaner.js';
import { TEMP_DIR, OUTPUTS_DIR } from '../config/env.js';
import { hardwareConfig } from '../config/hardware.js';

let workerInstance: Worker<VideoJobData, JobResult> | null = null;

export function initVideoWorker(): Worker<VideoJobData, JobResult> {
  if (workerInstance) return workerInstance;

  workerInstance = new Worker<VideoJobData, JobResult>(
    QUEUE_NAME,
    async (job: Job<VideoJobData, JobResult>) => {
      const { jobId, inputFilePath, language, highlightColor, marginV, maxWordsPerChunk, duration } = job.data;
      const jobStartTime = Date.now();

      // Ensure job directories
      const jobTempDir = path.join(TEMP_DIR, jobId);
      if (!fs.existsSync(jobTempDir)) {
        await fs.promises.mkdir(jobTempDir, { recursive: true });
      }

      const tempWavPath = path.join(jobTempDir, 'audio_16k.wav');
      const tempAssPath = path.join(jobTempDir, 'subtitles.ass');
      const outputFileName = `${jobId}.mp4`;
      const finalOutputPath = path.join(OUTPUTS_DIR, outputFileName);

      try {
        console.log(`[Worker] Starting job ${jobId} for file: ${job.data.originalFileName}`);

        // Step 1: EXTRACTING_AUDIO & SILENCE DETECTION (15%)
        setJobState(jobId, {
          status: 'EXTRACTING_AUDIO',
          progress: 15,
          message: 'Extracting 16kHz audio & detecting voice activity boundaries...'
        });
        await job.updateProgress(15);
        const audioExtractResult = await extractAudioForWhisper(inputFilePath, tempWavPath);

        // Step 2: TRANSCRIBING (45%)
        setJobState(jobId, {
          status: 'TRANSCRIBING',
          progress: 45,
          message: `Transcribing speech with Whisper.cpp (Language: ${language}, Threads: ${hardwareConfig.whisperThreadCap})...`
        });
        await job.updateProgress(45);
        const transcription = await runWhisperTranscription(tempWavPath, {
          language,
          threads: hardwareConfig.whisperThreadCap,
          prompt: job.data.prompt,
          silenceIntervals: audioExtractResult.silenceIntervals
        });
        console.log(`[Worker] Job ${jobId} transcribed ${transcription.tokens.length} words.`);

        // Step 3: GENERATING_SUBTITLES (60%)
        setJobState(jobId, {
          status: 'GENERATING_SUBTITLES',
          progress: 60,
          message: 'Compiling high-retention karaoke ASS subtitles with silence elimination...'
        });
        await job.updateProgress(60);
        await generateAssSubtitleFile(transcription.tokens, tempAssPath, {
          highlightColorHex: highlightColor,
          marginV: marginV ?? 480,
          maxWordsPerChunk: maxWordsPerChunk ?? 3,
          allCaps: true,
          silenceIntervals: audioExtractResult.silenceIntervals
        });

        // Step 4: COMPOSITING (90%)
        setJobState(jobId, {
          status: 'COMPOSITING',
          progress: 80,
          message: `Rendering 9:16 video with ${hardwareConfig.hasQsvSupport ? 'Intel QSV' : 'CPU x264'} & loudness normalization...`
        });
        await job.updateProgress(80);

        const compositeResult = await compositeVideo(inputFilePath, tempAssPath, finalOutputPath, {
          totalDurationSeconds: duration,
          onProgress: (pct) => {
            const mappedProgress = Math.round(80 + (pct * 0.18)); // 80% to 98%
            setJobState(jobId, { progress: mappedProgress });
            job.updateProgress(mappedProgress).catch(() => {});
          }
        });

        const totalProcessingTime = parseFloat(((Date.now() - jobStartTime) / 1000).toFixed(2));

        const result: JobResult = {
          downloadUrl: `/api/v1/downloads/${outputFileName}`,
          duration: duration || compositeResult.durationSeconds || 0,
          processingTimeSeconds: totalProcessingTime,
          hardwareAccelerationUsed: compositeResult.usedHardwareAcceleration,
          encoderUsed: compositeResult.encoderUsed,
          outputPath: finalOutputPath
        };

        // Step 5: COMPLETED (100%)
        setJobState(jobId, {
          status: 'COMPLETED',
          progress: 100,
          message: 'Processing completed successfully.',
          result
        });
        await job.updateProgress(100);

        console.log(`[Worker] Job ${jobId} completed in ${totalProcessingTime}s using ${compositeResult.encoderUsed}`);
        return result;
      } catch (error: any) {
        console.error(`[Worker] Job ${jobId} failed:`, error);
        setJobState(jobId, {
          status: 'FAILED',
          message: `Failed: ${error.message}`,
          error: error.message
        });
        throw error;
      } finally {
        // Step 5.2 Failure & Temporary Cleanup Policy:
        // Temp files in storage/temp/{jobId}/* must be cleaned up in finally block
        console.log(`[Worker] Cleaning up temporary files for job ${jobId}...`);
        await cleanJobTempDir(jobId);
      }
    },
    {
      connection: redisConnectionOptions,
      concurrency: hardwareConfig.workerConcurrency // strictly 1 per PRD 2.2
    }
  );

  workerInstance.on('completed', (job) => {
    console.log(`[Worker] BullMQ event: Job ${job.id} completed.`);
  });

  workerInstance.on('failed', (job, err) => {
    console.warn(`[Worker] BullMQ event: Job ${job?.id} failed:`, err.message);
  });

  return workerInstance;
}

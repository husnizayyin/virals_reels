import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pipeline from 'stream/promises';
import { UPLOADS_DIR, OUTPUTS_DIR } from '../config/env.js';
import { validateAndInspectMedia, ValidationError } from '../core/ingestion.js';
import {
  getVideoQueue,
  setJobState,
  getJobState,
  getAllRecentJobs,
  VideoJobData
} from '../queue/videoQueue.js';
import { hardwareConfig, refreshHardwareDetection } from '../config/hardware.js';
import { COLOR_PRESETS, DEFAULT_PRESET } from '../config/presets.js';

export const jobRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Ensure directories exist
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

  /**
   * POST /api/v1/jobs
   * Multipart upload to submit a video processing job
   */
  fastify.post('/api/v1/jobs', async (req, reply) => {
    const isMultipart = req.isMultipart();
    if (!isMultipart) {
      return reply.code(400).send({
        success: false,
        error: 'Content-Type must be multipart/form-data'
      });
    }

    const parts = req.parts();
    const jobId = `job_${crypto.randomUUID()}`;

    let uploadedFilePath: string | null = null;
    let originalFileName = 'video.mp4';
    let language = 'id';
    let highlightColor = '#FFE600';
    let marginV = 480;
    let maxWordsPerChunk = 3;
    let prompt: string | undefined = undefined;

    try {
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          originalFileName = part.filename;
          const ext = path.extname(part.filename).toLowerCase() || '.mp4';
          const allowedExts = ['.mp4', '.mov', '.mkv'];

          if (!allowedExts.includes(ext)) {
            return reply.code(400).send({
              success: false,
              error: `Unsupported container format '${ext}'. Allowed formats: .mp4, .mov, .mkv`
            });
          }

          const targetFileName = `${jobId}${ext}`;
          uploadedFilePath = path.join(UPLOADS_DIR, targetFileName);

          // Stream directly to disk to preserve memory
          const writeStream = fs.createWriteStream(uploadedFilePath);
          await pipeline.pipeline(part.file, writeStream);
        } else if (part.type === 'field') {
          if (part.fieldname === 'language' && typeof part.value === 'string') {
            language = part.value.trim().toLowerCase() || 'id';
          } else if (part.fieldname === 'highlightColor' && typeof part.value === 'string') {
            highlightColor = part.value.trim() || '#FFE600';
          } else if (part.fieldname === 'prompt' && typeof part.value === 'string') {
            prompt = part.value.trim() || undefined;
          } else if (part.fieldname === 'marginV') {
            const parsed = parseInt(String(part.value), 10);
            if (!isNaN(parsed)) marginV = parsed;
          } else if (part.fieldname === 'maxWordsPerChunk') {
            const parsed = parseInt(String(part.value), 10);
            if (!isNaN(parsed)) maxWordsPerChunk = parsed;
          }
        }
      }

      if (!uploadedFilePath || !fs.existsSync(uploadedFilePath)) {
        return reply.code(400).send({
          success: false,
          error: "Required file field 'file' is missing in multipart upload."
        });
      }

      // Step 4.1 Ingestion & Validation via FFprobe
      const mediaMeta = await validateAndInspectMedia(uploadedFilePath);

      // Register Job in State Store
      setJobState(jobId, {
        jobId,
        status: 'QUEUED',
        progress: 0,
        message: 'Job enqueued for processing.'
      });

      // Submit to BullMQ Queue
      const jobData: VideoJobData = {
        jobId,
        originalFileName,
        inputFilePath: uploadedFilePath,
        language,
        highlightColor,
        marginV,
        maxWordsPerChunk,
        duration: mediaMeta.duration,
        prompt
      };

      const queue = getVideoQueue();
      await queue.add(`job-${jobId}`, jobData, {
        jobId,
        removeOnComplete: true
      });

      return reply.code(202).send({
        success: true,
        jobId,
        status: 'QUEUED',
        message: 'Video successfully scheduled for processing.',
        metadata: {
          durationSeconds: mediaMeta.duration,
          fileSizeBytes: mediaMeta.fileSizeBytes,
          width: mediaMeta.width,
          height: mediaMeta.height
        }
      });
    } catch (err: any) {
      // Clean up uploaded file if validation failed
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try {
          await fs.promises.unlink(uploadedFilePath);
        } catch {}
      }

      if (err instanceof ValidationError) {
        return reply.code(400).send({
          success: false,
          error: err.message
        });
      }

      return reply.code(500).send({
        success: false,
        error: `Job ingestion failed: ${err.message}`
      });
    }
  });

  /**
   * GET /api/v1/jobs/:jobId
   * Query status, progress, and result of a specific job
   */
  fastify.get('/api/v1/jobs/:jobId', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };

    const state = getJobState(jobId);
    if (!state) {
      return reply.code(404).send({
        success: false,
        error: `Job with ID '${jobId}' not found.`
      });
    }

    return reply.code(200).send({
      jobId: state.jobId,
      status: state.status,
      progress: state.progress,
      message: state.message,
      result: state.result,
      error: state.error,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    });
  });

  /**
   * GET /api/v1/jobs
   * Query recent job history
   */
  fastify.get('/api/v1/jobs', async (_req, reply) => {
    const jobs = getAllRecentJobs();
    return reply.code(200).send({
      success: true,
      jobs
    });
  });

  /**
   * GET /api/v1/downloads/:filename
   * Stream or download rendered video
   */
  fastify.get('/api/v1/downloads/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    const sanitized = path.basename(filename);
    const filePath = path.join(OUTPUTS_DIR, sanitized);

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({
        error: `Rendered file '${sanitized}' not found.`
      });
    }

    const stat = await fs.promises.stat(filePath);

    // Support HTTP Range requests for video seeking in browser
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = end - start + 1;

      const stream = fs.createReadStream(filePath, { start, end });
      reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', chunksize)
        .header('Content-Type', 'video/mp4');

      return reply.send(stream);
    } else {
      reply
        .code(200)
        .header('Content-Length', stat.size)
        .header('Content-Type', 'video/mp4')
        .header('Content-Disposition', `inline; filename="${sanitized}"`);

      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    }
  });

  /**
   * GET /api/v1/hardware
   * Inspect detected hardware status, QSV acceleration, and resource limits
   */
  fastify.get('/api/v1/hardware', async (_req, reply) => {
    const currentHardware = refreshHardwareDetection();
    return reply.code(200).send({
      hardware: currentHardware,
      presets: {
        defaultPreset: DEFAULT_PRESET,
        colorPresets: COLOR_PRESETS
      }
    });
  });

  /**
   * GET /api/v1/presets
   * Get available styling presets
   */
  fastify.get('/api/v1/presets', async (_req, reply) => {
    return reply.code(200).send({
      defaultPreset: DEFAULT_PRESET,
      colorPresets: COLOR_PRESETS
    });
  });
};

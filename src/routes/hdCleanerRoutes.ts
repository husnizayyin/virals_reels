import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pipeline from 'stream/promises';
import { UPLOADS_DIR, OUTPUTS_DIR } from '../config/env.js';
import {
  createCleanerJob,
  getCleanerJob,
  getAllCleanerJobs,
  runCleanerPipeline
} from '../modules/hd-cleaner/cleanerService.js';
import { inspectMediaFile } from '../modules/hd-cleaner/metadataScrubber.js';
import { CleanerOptions, PlatformPreset, FpsTarget, ResolutionTarget } from '../modules/hd-cleaner/types.js';

export const hdCleanerRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Ensure directories exist
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

  /**
   * POST /api/v1/cleaner/inspect
   * Quick inspection endpoint: Uploads video to probe metadata and tracking flags
   */
  fastify.post('/api/v1/cleaner/inspect', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ success: false, error: 'Multipart form-data expected.' });
    }

    const parts = req.parts();
    let tempPath: string | null = null;

    try {
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          const ext = path.extname(part.filename).toLowerCase() || '.mp4';
          const tempId = `inspect_${crypto.randomUUID()}${ext}`;
          tempPath = path.join(UPLOADS_DIR, tempId);

          const writeStream = fs.createWriteStream(tempPath);
          await pipeline.pipeline(part.file, writeStream);
        }
      }

      if (!tempPath || !fs.existsSync(tempPath)) {
        return reply.code(400).send({ success: false, error: 'No video file provided.' });
      }

      const metadata = await inspectMediaFile(tempPath);

      // Clean up inspect temp file
      try {
        await fs.promises.unlink(tempPath);
      } catch {}

      return reply.code(200).send({
        success: true,
        metadata
      });
    } catch (err: any) {
      if (tempPath && fs.existsSync(tempPath)) {
        try { await fs.promises.unlink(tempPath); } catch {}
      }
      return reply.code(500).send({
        success: false,
        error: `Inspection failed: ${err.message}`
      });
    }
  });

  /**
   * POST /api/v1/cleaner/jobs
   * Submits a video for anti-compression optimization & metadata sanitization
   */
  fastify.post('/api/v1/cleaner/jobs', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ success: false, error: 'Multipart form-data expected.' });
    }

    const parts = req.parts();
    const tempJobId = crypto.randomUUID();

    let uploadedPath: string | null = null;
    let originalFileName = 'video.mp4';
    let platform: PlatformPreset = 'reels';
    let fps: FpsTarget = 60;
    let resolution: ResolutionTarget = '1080x1920';
    let stripMetadata = true;
    let applyMicroDither = true;
    let applyUnsharp = true;
    let normalizeAudio = true;
    let forceCpu = false;

    try {
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          originalFileName = part.filename;
          const ext = path.extname(part.filename).toLowerCase() || '.mp4';
          const allowed = ['.mp4', '.mov', '.mkv', '.webm'];
          if (!allowed.includes(ext)) {
            return reply.code(400).send({
              success: false,
              error: `Unsupported format ${ext}. Allowed: .mp4, .mov, .mkv, .webm`
            });
          }

          uploadedPath = path.join(UPLOADS_DIR, `input_clean_${tempJobId}${ext}`);
          const writeStream = fs.createWriteStream(uploadedPath);
          await pipeline.pipeline(part.file, writeStream);
        } else if (part.type === 'field') {
          const val = typeof part.value === 'string' ? part.value.trim() : '';
          if (part.fieldname === 'platform') {
            platform = (val as PlatformPreset) || 'reels';
          } else if (part.fieldname === 'fps') {
            fps = val === '30' ? 30 : val === 'source' ? 'source' : 60;
          } else if (part.fieldname === 'resolution') {
            resolution = (val as ResolutionTarget) || '1080x1920';
          } else if (part.fieldname === 'stripMetadata') {
            stripMetadata = val !== 'false';
          } else if (part.fieldname === 'applyMicroDither') {
            applyMicroDither = val !== 'false';
          } else if (part.fieldname === 'applyUnsharp') {
            applyUnsharp = val !== 'false';
          } else if (part.fieldname === 'normalizeAudio') {
            normalizeAudio = val !== 'false';
          } else if (part.fieldname === 'forceCpu') {
            forceCpu = val === 'true';
          }
        }
      }

      if (!uploadedPath || !fs.existsSync(uploadedPath)) {
        return reply.code(400).send({
          success: false,
          error: "Required file field 'file' is missing."
        });
      }

      // Initialize cleaner job state
      const jobId = createCleanerJob(originalFileName, uploadedPath);

      const options: CleanerOptions = {
        platform,
        fps,
        resolution,
        stripMetadata,
        applyMicroDither,
        applyUnsharp,
        normalizeAudio,
        forceCpu
      };

      // Launch processing asynchronously (does not block HTTP response)
      runCleanerPipeline(jobId, options).catch((err) => {
        console.error(`[CleanerService] Job ${jobId} encountered error:`, err);
      });

      return reply.code(202).send({
        success: true,
        jobId,
        status: 'PROCESSING',
        message: 'Video optimization job initiated.'
      });
    } catch (err: any) {
      if (uploadedPath && fs.existsSync(uploadedPath)) {
        try { await fs.promises.unlink(uploadedPath); } catch {}
      }
      return reply.code(500).send({
        success: false,
        error: `Submission failed: ${err.message}`
      });
    }
  });

  /**
   * GET /api/v1/cleaner/jobs/:jobId
   * Query status, progress and before/after comparison
   */
  fastify.get('/api/v1/cleaner/jobs/:jobId', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = getCleanerJob(jobId);

    if (!job) {
      return reply.code(404).send({
        success: false,
        error: `Cleaner job '${jobId}' not found.`
      });
    }

    return reply.code(200).send({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: job.message,
      originalFileName: job.originalFileName,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    });
  });

  /**
   * GET /api/v1/cleaner/jobs
   * List recent cleaner jobs
   */
  fastify.get('/api/v1/cleaner/jobs', async (_req, reply) => {
    const jobs = getAllCleanerJobs();
    return reply.code(200).send({
      success: true,
      jobs
    });
  });

  /**
   * GET /api/v1/cleaner/download/:filename
   * Download or stream optimized video
   */
  fastify.get('/api/v1/cleaner/download/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    const sanitized = path.basename(filename);
    const filePath = path.join(OUTPUTS_DIR, sanitized);

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({
        error: `Optimized file '${sanitized}' not found.`
      });
    }

    const stat = await fs.promises.stat(filePath);
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
        .header('Content-Disposition', `attachment; filename="${sanitized}"`);

      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    }
  });
};

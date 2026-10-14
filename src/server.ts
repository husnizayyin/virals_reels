import fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import path from 'path';
import fs from 'fs';
import { env, STORAGE_PATH } from './config/env.js';
import { hardwareConfig } from './config/hardware.js';
import { jobRoutes } from './routes/jobRoutes.js';
import { initVideoWorker } from './queue/videoWorker.js';
import { checkRedisHealth, getSharedRedis } from './queue/connection.js';
import { cleanExpiredOutputs } from './utils/fileCleaner.js';

const app = fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname'
            }
          }
        : undefined
  }
});

async function main() {
  // Register CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Register Multipart with generous body limits
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
      files: 1
    }
  });

  // Register Static UI
  const publicDir = path.resolve(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/'
  });

  // Register API routes
  await app.register(jobRoutes);

  // Check Redis connectivity before initializing queue worker
  const isRedisUp = await checkRedisHealth();
  if (isRedisUp) {
    console.log(`[Queue] Redis connection confirmed. Initializing BullMQ Video Worker...`);
    initVideoWorker();
  } else {
    console.warn(
      `[Queue] WARNING: Redis is not reachable at ${env.REDIS_HOST}:${env.REDIS_PORT}.` +
      ` Jobs will remain queued until Redis is started.`
    );
  }

  // Periodic cleanup job (every 1 hour, cleans files > 24 hours old)
  setInterval(() => {
    cleanExpiredOutputs(env.TEMP_CLEANUP_HOURS).then((cleaned) => {
      if (cleaned > 0) {
        console.log(`[StorageCleanup] Removed ${cleaned} expired output videos.`);
      }
    });
  }, 60 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      const redis = getSharedRedis();
      redis.disconnect();
      console.log('Server stopped cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start HTTP Listener
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log('\n======================================================');
    console.log(`🚀 ViralReels Studio running on http://${env.HOST}:${env.PORT}`);
    console.log(`   - Hardware Baseline: ${hardwareConfig.cpuModel}`);
    console.log(`   - Intel QSV Acceleration: ${hardwareConfig.hasQsvSupport ? 'ENABLED (Hardware accelerated)' : 'DISABLED (Using CPU libx264 fallback)'}`);
    console.log(`   - Whisper Thread Cap: ${hardwareConfig.whisperThreadCap} threads`);
    console.log(`   - Max File Size: ${env.MAX_FILE_SIZE_MB} MB`);
    console.log(`   - Storage Path: ${STORAGE_PATH}`);
    console.log('======================================================\n');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

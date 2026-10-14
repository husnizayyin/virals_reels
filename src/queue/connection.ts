import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redisConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 150, 3000);
    return delay;
  }
};

let sharedRedisInstance: Redis | null = null;

export function getSharedRedis(): Redis {
  if (!sharedRedisInstance) {
    sharedRedisInstance = new Redis(redisConnectionOptions);

    sharedRedisInstance.on('error', (err) => {
      console.warn(`[Redis] Connection notice: ${err.message}`);
    });

    sharedRedisInstance.on('connect', () => {
      console.log(`[Redis] Connected to ${env.REDIS_HOST}:${env.REDIS_PORT}`);
    });
  }

  return sharedRedisInstance;
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const redis = getSharedRedis();
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

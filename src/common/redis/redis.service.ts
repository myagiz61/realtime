import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private redis: Redis | null = null;

  constructor() {
    if (!process.env.REDIS_URL) {
      console.log('🟡 Redis disabled (no REDIS_URL)');
      return;
    }

    this.redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    this.redis.on('error', (err) => {
      console.log('Redis error:', err.message);
    });
  }

  get client() {
    return this.redis;
  }

  /* =========================
     SAFE METHODS
  ========================= */

  async setJson(key: string, value: unknown, ttlSeconds?: number) {
    if (!this.redis) return;

    const payload = JSON.stringify(value);

    if (ttlSeconds) {
      await this.redis.set(key, payload, 'EX', ttlSeconds);
      return;
    }

    await this.redis.set(key, payload);
  }

  async getJson<T = any>(key: string): Promise<T | null> {
    if (!this.redis) return null;

    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async del(key: string) {
    if (!this.redis) return;
    await this.redis.del(key);
  }

  async keys(pattern: string) {
    if (!this.redis) return [];
    return this.redis.keys(pattern);
  }

  async sadd(key: string, ...members: string[]) {
    if (!this.redis || !members.length) return;
    await this.redis.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]) {
    if (!this.redis || !members.length) return;
    await this.redis.srem(key, ...members);
  }

  async smembers(key: string) {
    if (!this.redis) return [];
    return this.redis.smembers(key);
  }

  async set(
    key: string,
    value: string,
    options?: {
      NX?: boolean;
      XX?: boolean;
      PX?: number;
      EX?: number;
    },
  ) {
    if (!this.redis) return;

    if (!options) {
      return this.redis.set(key, value);
    }

    const args: any[] = [];

    if (options.NX) args.push('NX');
    if (options.XX) args.push('XX');

    if (options.PX) {
      args.push('PX', options.PX);
    }

    if (options.EX) {
      args.push('EX', options.EX);
    }

    return this.redis.set(key, value, ...args);
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

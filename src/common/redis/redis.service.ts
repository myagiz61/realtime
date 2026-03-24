import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: '127.0.0.1',
      port: 6379,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }

  get client() {
    return this.redis;
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number) {
    const payload = JSON.stringify(value);

    if (ttlSeconds) {
      await this.redis.set(key, payload, 'EX', ttlSeconds);
      return;
    }

    await this.redis.set(key, payload);
  }

  async getJson<T = any>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  async keys(pattern: string) {
    return this.redis.keys(pattern);
  }

  async sadd(key: string, ...members: string[]) {
    if (!members.length) return;
    await this.redis.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]) {
    if (!members.length) return;
    await this.redis.srem(key, ...members);
  }

  async smembers(key: string) {
    return this.redis.smembers(key);
  }

  async onModuleDestroy() {
    await this.redis.quit();
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
    if (!options) {
      return this.client.set(key, value);
    }

    const args: any[] = [];

    if (options.NX) args.push('NX');
    if (options.XX) args.push('XX');

    if (options.PX) {
      args.push('PX');
      args.push(options.PX);
    }

    if (options.EX) {
      args.push('EX');
      args.push(options.EX);
    }

    return this.client.set(key, value, ...args);
  }
}

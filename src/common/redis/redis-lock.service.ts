import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';
import { randomUUID } from 'crypto';

@Injectable()
export class RedisLockService {
  constructor(private readonly redis: RedisService) {}

  async acquire(lockKey: string, ttlMs = 5000): Promise<string | null> {
    const client = this.redis.client;
    if (!client) return null; // 🔥 Redis yoksa lock yok

    const token = randomUUID();

    const result = await client.set(lockKey, token, 'PX', ttlMs, 'NX');

    if (result !== 'OK') return null;

    return token;
  }

  async release(lockKey: string, token: string): Promise<boolean> {
    const client = this.redis.client;
    if (!client) return false; // 🔥 Redis yoksa release yok

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await client.eval(script, {
      keys: [lockKey],
      arguments: [token],
    } as any);

    return Number(result) === 1;
  }
}

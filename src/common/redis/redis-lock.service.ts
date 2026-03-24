import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';
import { randomUUID } from 'crypto';

@Injectable()
export class RedisLockService {
  constructor(private readonly redis: RedisService) {}

  async acquire(lockKey: string, ttlMs = 5000): Promise<string | null> {
    const token = randomUUID();

    const result = await this.redis.client.set(
      lockKey,
      token,
      'PX',
      ttlMs,
      'NX',
    );

    if (result !== 'OK') return null;

    return token;
  }

  async release(lockKey: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.redis.client.eval(script, {
      keys: [lockKey],
      arguments: [token],
    } as any);

    return Number(result) === 1;
  }
}

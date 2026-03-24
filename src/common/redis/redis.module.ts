import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { SocketRedisService } from './socket-redis.service';
import { RedisLockService } from './redis-lock.service';

@Global()
@Module({
  providers: [RedisService, SocketRedisService, RedisLockService],
  exports: [RedisService, SocketRedisService, RedisLockService],
})
export class RedisModule {}

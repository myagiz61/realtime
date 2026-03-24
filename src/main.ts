import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/socket/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ✅ Redis sadece varsa bağlan
  if (process.env.REDIS_URL) {
    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
    console.log('🟢 Redis connected');
  } else {
    console.log('🟡 Redis not configured, running without Redis');
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

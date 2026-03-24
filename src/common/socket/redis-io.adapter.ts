import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import { SocketRedisService } from '../redis/socket-redis.service';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const socketRedis = this.app.get(SocketRedisService);

    await socketRedis.connect();

    const pubClient = socketRedis.getPubClient();
    const subClient = socketRedis.getSubClient();

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: '*',
        credentials: true,
      },
    });

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}

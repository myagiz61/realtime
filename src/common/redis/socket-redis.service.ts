import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class SocketRedisService implements OnModuleDestroy {
  private pubClient: RedisClientType;
  private subClient: RedisClientType;
  private connected = false;

  constructor() {
    this.pubClient = createClient({
      url: 'redis://127.0.0.1:6379',
    });

    this.subClient = this.pubClient.duplicate();
  }

  async connect() {
    if (this.connected) return;

    await this.pubClient.connect();
    await this.subClient.connect();
    this.connected = true;
  }

  getPubClient() {
    return this.pubClient;
  }

  getSubClient() {
    return this.subClient;
  }

  async onModuleDestroy() {
    if (this.connected) {
      await this.pubClient.quit();
      await this.subClient.quit();
      this.connected = false;
    }
  }
}

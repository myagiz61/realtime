import { Injectable, OnModuleInit } from '@nestjs/common';
import { RoomService } from './rooms.service';

@Injectable()
export class RoomForfeitWorker implements OnModuleInit {
  constructor(private readonly rooms: RoomService) {}

  onModuleInit() {
    setInterval(async () => {
      try {
        await this.rooms.forfeitExpiredDisconnections();
      } catch (err) {
        console.error('Forfeit worker error:', err);
      }
    }, 5000); // 5 saniyede bir kontrol
  }
}

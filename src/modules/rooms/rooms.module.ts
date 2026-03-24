import { Module, forwardRef } from '@nestjs/common';
import { RoomService } from './rooms.service';
import { RoomController } from './rooms.controller';
import { WalletModule } from '../wallet/wallet.module';
import { RoomsGateway } from './rooms.gateway';
import { GameModule } from '../games/game.module';
import { RoomForfeitWorker } from './room-forfeit.worker';

@Module({
  imports: [
    WalletModule,
    forwardRef(() => GameModule), // 🔴 önemli
  ],
  controllers: [RoomController],
  providers: [RoomService, RoomsGateway, RoomForfeitWorker],
  exports: [RoomService],
})
export class RoomModule {}

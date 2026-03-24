import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './common/prisma/prisma.module';

import { WalletModule } from './modules/wallet/wallet.module';
import { RoomModule } from './modules/rooms/rooms.module';
import { UserModule } from './modules/users/user.module';
import { GameModule } from './modules/games/game.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RedisModule } from './common/redis/redis.module';

@Module({
  imports: [
    // 🔒 GLOBAL API RATE LIMIT
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000, // 60 saniye
          limit: 60, // 60 request
        },
      ],
    }),

    UserModule,
    PrismaModule,

    WalletModule,
    RoomModule,
    GameModule,
    AuthModule,
    AdminModule,
    PaymentsModule,
    RedisModule,
  ],

  controllers: [AppController],

  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

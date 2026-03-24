import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaService } from '../../common/prisma/prisma.service';

@Module({
  imports: [
    JwtModule.register({
      secret: 'SUPER_SECRET_KEY', // sonra .env'e alacağız
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PrismaService],
})
export class AuthModule {}

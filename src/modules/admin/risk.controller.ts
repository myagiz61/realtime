import { Controller, Get, Param } from '@nestjs/common';
import { RiskEngineService } from '../games/risk-engine.service';
import { FraudDetectionService } from '../games/fraud-detection.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('risk')
export class RiskController {
  constructor(
    private readonly riskEngine: RiskEngineService,
    private readonly fraudDetection: FraudDetectionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('user/:userId/evaluate')
  async evaluateUser(@Param('userId') userId: string) {
    return this.riskEngine.evaluateUser(userId);
  }

  @Get('room/:roomId/evaluate')
  async evaluateRoom(@Param('roomId') roomId: string) {
    await this.fraudDetection.evaluateRoom({
      roomId,
      gameType: 'UNKNOWN',
    });

    return this.riskEngine.evaluateRoomUsers(roomId);
  }

  @Get('user/:userId/profile')
  async getUserProfile(@Param('userId') userId: string) {
    return this.prisma.playerRiskProfile.findUnique({
      where: { userId },
    });
  }

  @Get('cases/open')
  async getOpenCases() {
    return this.prisma.fraudCase.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('actions/:userId')
  async getUserActions(@Param('userId') userId: string) {
    return this.prisma.riskActionLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

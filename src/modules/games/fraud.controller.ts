import { Controller, Get, Param } from '@nestjs/common';
import { FraudDetectionService } from '../games/fraud-detection.service';

@Controller('fraud')
export class FraudController {
  constructor(private readonly fraudDetection: FraudDetectionService) {}

  @Get('room/:roomId/evaluate')
  async evaluateRoom(@Param('roomId') roomId: string) {
    return this.fraudDetection.evaluateRoom({
      roomId,
      gameType: 'UNKNOWN',
    });
  }
}

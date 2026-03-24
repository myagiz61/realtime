import { Module, forwardRef } from '@nestjs/common';
import { AdminMonitoringController } from './admin-monitoring.controller';
import { AdminMonitoringService } from './admin-monitoring.service';
import { GameModule } from '../games/game.module';

@Module({
  imports: [forwardRef(() => GameModule)],
  controllers: [AdminMonitoringController],
  providers: [AdminMonitoringService],
  exports: [AdminMonitoringService],
})
export class AdminModule {}

import { Module, forwardRef } from '@nestjs/common';
import { GameEngineService } from './game-engine.service';
import { TurnTimerService } from './turn-timer.service';
import { ReplayLogService } from './replay-log.service';
import { FraudDetectionService } from './fraud-detection.service';
import { RoomModule } from '../rooms/rooms.module';
import { RiskEngineService } from './risk-engine.service';
import { PistiBot } from './bots/pisti.bot';
import { TavlaBot } from './bots/tavla.bot';
import { OkeyBot } from './bots/okey.bot';
import { Okey101Bot } from './bots/okey101.bot';
import { GameBotRegistry } from './bots/game-bot.registry';
import { BotOrchestratorService } from './bots/bot-orchestrator.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [forwardRef(() => RoomModule), WalletModule],
  providers: [
    GameEngineService,
    TurnTimerService,
    ReplayLogService,
    FraudDetectionService,
    RiskEngineService,
    PistiBot,
    TavlaBot,
    OkeyBot,
    Okey101Bot,
    GameBotRegistry,
    BotOrchestratorService,
  ],
  exports: [
    GameEngineService,
    ReplayLogService,
    FraudDetectionService,
    RiskEngineService,
  ],
})
export class GameModule {}

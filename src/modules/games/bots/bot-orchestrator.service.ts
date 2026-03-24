import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { GameEngineService } from '../game-engine.service';
import { GameBotRegistry } from './game-bot.registry';

@Injectable()
export class BotOrchestratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotOrchestratorService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly gameEngine: GameEngineService,
    private readonly botRegistry: GameBotRegistry,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 1200);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    const games = this.gameEngine.getActiveGamesSnapshot();

    for (const snapshot of games) {
      try {
        if (snapshot.finished || snapshot.finishedHandled) {
          continue;
        }

        const bot = this.botRegistry.getBot(snapshot.state.gameType);
        if (!bot) continue;

        const engineState: any = this.gameEngine.getInternalState(
          snapshot.roomId,
        );
        const turn = engineState?.turn;

        if (typeof turn !== 'number') {
          continue;
        }

        const currentPlayer = snapshot.players[turn];
        if (!currentPlayer) {
          continue;
        }

        // basit bot işaretleme:
        // userId BOT_ ile başlıyorsa bot kabul ediyoruz
        const isBot = currentPlayer.userId.startsWith('BOT_');
        if (!isBot) {
          continue;
        }

        const publicState = this.gameEngine.getPublicState(
          snapshot.roomId,
          currentPlayer.userId,
        );

        const decision = bot.decide({
          gameType: snapshot.state.gameType,
          roomId: snapshot.roomId,
          botUserId: currentPlayer.userId,
          snapshot,
          engineState,
          publicState,
        });

        if (!decision.shouldAct || !decision.action) {
          continue;
        }

        this.gameEngine.dispatch(
          snapshot.roomId,
          currentPlayer.userId,
          decision.action,
        );

        this.logger.debug(
          `Bot acted room=${snapshot.roomId} user=${currentPlayer.userId} game=${snapshot.state.gameType}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Bot tick error room=${snapshot.roomId}: ${err?.message ?? err}`,
        );
      }
    }
  }
}

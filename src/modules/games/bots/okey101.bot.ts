import { Injectable } from '@nestjs/common';
import { GameType } from '@prisma/client';
import { GameBot, BotActionDecision } from './game-bot.types';

@Injectable()
export class Okey101Bot implements GameBot {
  supports(gameType: GameType): boolean {
    return gameType === GameType.OKEY101;
  }

  decide(): BotActionDecision {
    return { shouldAct: false };
  }
}

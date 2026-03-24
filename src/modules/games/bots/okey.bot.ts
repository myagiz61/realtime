import { Injectable } from '@nestjs/common';
import { GameType } from '@prisma/client';
import { GameBot, BotActionDecision } from './game-bot.types';

@Injectable()
export class OkeyBot implements GameBot {
  supports(gameType: GameType): boolean {
    return gameType === GameType.OKEY;
  }

  decide(): BotActionDecision {
    return { shouldAct: false };
  }
}

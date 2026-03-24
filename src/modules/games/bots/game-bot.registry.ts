import { Injectable } from '@nestjs/common';
import { GameType } from '@prisma/client';
import { GameBot } from './game-bot.types';
import { PistiBot } from './pisti.bot';
import { TavlaBot } from './tavla.bot';
import { OkeyBot } from './okey.bot';
import { Okey101Bot } from './okey101.bot';

@Injectable()
export class GameBotRegistry {
  private readonly bots: GameBot[];

  constructor(
    pistiBot: PistiBot,
    tavlaBot: TavlaBot,
    okeyBot: OkeyBot,
    okey101Bot: Okey101Bot,
  ) {
    this.bots = [pistiBot, tavlaBot, okeyBot, okey101Bot];
  }

  getBot(gameType: GameType): GameBot | null {
    return this.bots.find((bot) => bot.supports(gameType)) ?? null;
  }
}

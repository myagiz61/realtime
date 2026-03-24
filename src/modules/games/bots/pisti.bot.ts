import { Injectable } from '@nestjs/common';
import { GameType } from '@prisma/client';
import { GameBot, BotActionDecision } from './game-bot.types';

@Injectable()
export class PistiBot implements GameBot {
  supports(gameType: GameType): boolean {
    return gameType === GameType.PISTI;
  }

  decide(params: {
    gameType: GameType;
    roomId: string;
    botUserId: string;
    snapshot: any;
    engineState: any;
    publicState: any;
  }): BotActionDecision {
    const state = params.engineState;
    const hand = state?.hands?.[params.botUserId] ?? [];
    const table = state?.table ?? [];
    const top = table.length ? table[table.length - 1] : null;

    if (!Array.isArray(hand) || hand.length === 0) {
      return { shouldAct: false };
    }

    if (typeof state?.turn !== 'number') {
      return { shouldAct: false };
    }

    const currentPlayerId = state.players?.[state.turn];
    if (currentPlayerId !== params.botUserId) {
      return { shouldAct: false };
    }

    if (top) {
      const sameIndex = hand.findIndex((c: any) => c.value === top.value);
      if (sameIndex !== -1) {
        return {
          shouldAct: true,
          action: {
            type: 'PLAY_CARD',
            cardIndex: sameIndex,
          },
        };
      }

      const jackIndex = hand.findIndex((c: any) => c.value === 11);
      if (jackIndex !== -1) {
        return {
          shouldAct: true,
          action: {
            type: 'PLAY_CARD',
            cardIndex: jackIndex,
          },
        };
      }
    }

    return {
      shouldAct: true,
      action: {
        type: 'PLAY_CARD',
        cardIndex: 0,
      },
    };
  }
}

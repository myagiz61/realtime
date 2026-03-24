import { GameType } from '@prisma/client';
import { ActiveGameSnapshot } from '../game-engine.service';

export type BotActionDecision = {
  shouldAct: boolean;
  action?: any;
};

export interface GameBot {
  supports(gameType: GameType): boolean;

  decide(params: {
    gameType: GameType;
    roomId: string;
    botUserId: string;
    snapshot: ActiveGameSnapshot;
    engineState: any;
    publicState: any;
  }): BotActionDecision;
}

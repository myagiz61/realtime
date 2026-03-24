import { GameType } from '@prisma/client';

export type GamePhase = 'WAITING' | 'PLAYING' | 'FINISHED';

export interface GamePlayer {
  userId: string;
  walletId: string;
  seat: number;
  connected: boolean;
}

export interface GameState {
  roomId: string;
  gameType: GameType;
  phase: GamePhase;
  players: GamePlayer[];
  turnIndex: number;
  mode?: 'SOLO' | 'TEAM';
  payload: any;
}

export interface GameEngine {
  start(
    players: string[],
    mode?: 'SOLO' | 'TEAM',
    options?: Record<string, any>,
  ): any;

  move(state: any, playerId: string, action: any): any;

  validateMove?(state: any, playerId: string, action: any): boolean;

  isFinished(state: any): boolean;

  getWinner(state: any): number | null;

  getPublicState(state: any, viewerIndex: number | null): any;
}

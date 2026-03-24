export type CardSuit = 'H' | 'D' | 'S' | 'C'; // Heart, Diamond, Spade, Club

export type Card = {
  suit: CardSuit;
  value: number; // 1-13 => A,2..10,J,Q,K
};

export type PistiPhase = 'PLAYING' | 'FINISHED';

export type PistiHistoryItem = {
  playerId: string;
  action: 'PLAY_CARD';
  playedCard: Card;
  captured: boolean;
  pisti: boolean;
  valePisti: boolean;
  capturedCount: number;
  tableBefore: Card[];
  timestamp: number;
};

export type PistiLastMove = {
  playerId: string;
  playedCard: Card;
  captured: boolean;
  pisti: boolean;
  valePisti: boolean;
};

export type PistiState = {
  players: string[];
  mode?: 'SOLO' | 'TEAM';

  phase: PistiPhase;

  deck: Card[];
  hands: Record<string, Card[]>;
  table: Card[];

  captured: Record<string, Card[]>;
  scores: Record<string, number>;

  turn: number;
  round: number;

  lastCapturer: string | null;

  pistiCount: Record<string, number>;
  valePistiCount: Record<string, number>;

  history: PistiHistoryItem[];
  lastMove: PistiLastMove | null;
};

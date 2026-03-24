export type OkeyColor = 'RED' | 'BLUE' | 'BLACK' | 'YELLOW' | 'JOKER';

export type OkeyPhase = 'PLAYING' | 'FINISHED';
export type OkeyMode = 'SOLO' | 'TEAM';

export type OkeyFinishReason =
  | 'NORMAL_WIN'
  | 'CIFTTEN_BITIS'
  | 'OKEY_ILE_BITIS'
  | 'DECK_EXHAUSTED'
  | 'FORCE_FINISH';

export type Tile = {
  id: string;
  color: OkeyColor;
  value: number; // 1..13, fake okey için 0
  isFakeOkey?: boolean;
};

export type OkeyPlayerState = {
  userId: string;
  seat: number; // 0..3
  hand: Tile[];
};

export type OkeyLastAction =
  | { seat: number; type: 'DRAW_DECK'; tile: Tile | null; at: number }
  | { seat: number; type: 'DRAW_DISCARD'; tile: Tile | null; at: number }
  | { seat: number; type: 'DISCARD'; tile: Tile | null; at: number }
  | { seat: number; type: 'DECLARE_CIFT'; tile: null; at: number }
  | { seat: number; type: 'DECLARE_WIN'; tile: null; at: number }
  | { seat: number | null; type: 'FORCE_FINISH'; tile: null; at: number };

export type OkeyState = {
  players: OkeyPlayerState[];

  deck: Tile[];
  discarded: Tile[];

  indicator: Tile; // gösterge
  okey: Tile; // gerçek okey taşı

  phase: OkeyPhase;
  mode: OkeyMode;

  turn: number; // 0..3
  drewThisTurn: boolean;

  winnerSeat?: number | null;
  winnerTeam?: number | null;
  finishReason?: OkeyFinishReason;

  lastDiscardedBySeat?: number | null;
  lastAction?: OkeyLastAction;

  // oyuncu çifte gittiğini ilan ettiyse burada tutulur
  cifteGidiyorSeat?: number | null;
  justDrawnTileId?: string | null;
  drawSource?: 'DECK' | 'DISCARD' | null;
};

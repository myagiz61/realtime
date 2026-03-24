export type OkeyAction =
  | { type: 'DRAW_DECK' }
  | { type: 'DRAW_DISCARD' }
  | { type: 'DISCARD'; tileId: string }
  | { type: 'DECLARE_CIFT' }
  | { type: 'DECLARE_WIN' }
  | { type: 'FORCE_FINISH'; winnerSeat: number | null };

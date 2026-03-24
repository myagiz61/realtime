export type SpadesSuit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';

export type SpadesRank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type SpadesCard = {
  id: string;
  suit: SpadesSuit;
  rank: SpadesRank;
};

export type SpadesPhase =
  | 'BIDDING'
  | 'PLAYING'
  | 'ROUND_FINISHED'
  | 'MATCH_FINISHED';

export type SpadesMode = 'TEAM';

export type SpadesBidType = 'NORMAL' | 'NIL' | 'BLIND_NIL';

export type SpadesPlayer = {
  userId: string;
  seat: number;
  hand: SpadesCard[];

  bid: number | null;
  bidType: SpadesBidType | null;

  tricksWon: number;

  score: number;
  bags: number;
};

export type SpadesPlayedCard = {
  seat: number;
  userId: string;
  card: SpadesCard;
};

export type SpadesTrick = {
  leaderSeat: number;
  leadSuit: SpadesSuit | null;
  plays: SpadesPlayedCard[];
  winnerSeat: number | null;
};

export type SpadesRoundScore = {
  team: 0 | 1;
  bidTotal: number;
  tricksWon: number;
  bagsThisRound: number;
  bagsTotalAfterRound: number;
  scoreDelta: number;
  nilBonusDelta: number;
  bagPenaltyApplied: boolean;
};

export type SpadesLastMove =
  | {
      type: 'BID';
      seat: number;
      bid: number;
      bidType: SpadesBidType;
      at: number;
    }
  | {
      type: 'PLAY_CARD';
      seat: number;
      card: SpadesCard;
      trickSize: number;
      at: number;
    }
  | {
      type: 'TRICK_FINISHED';
      winnerSeat: number;
      winningCard: SpadesCard;
      at: number;
    }
  | {
      type: 'ROUND_FINISHED';
      scores: SpadesRoundScore[];
      at: number;
    };

export type SpadesHistoryItem =
  | {
      type: 'BID';
      seat: number;
      userId: string;
      bid: number;
      bidType: SpadesBidType;
      at: number;
    }
  | {
      type: 'PLAY_CARD';
      seat: number;
      userId: string;
      card: SpadesCard;
      leadSuit: SpadesSuit | null;
      at: number;
    }
  | {
      type: 'TRICK_FINISHED';
      winnerSeat: number;
      trick: SpadesTrick;
      at: number;
    }
  | {
      type: 'ROUND_FINISHED';
      round: number;
      scores: SpadesRoundScore[];
      at: number;
    };

export type SpadesState = {
  players: SpadesPlayer[];

  mode: SpadesMode;
  phase: SpadesPhase;

  dealer: number;
  turn: number;

  currentTrick: SpadesTrick | null;
  completedTricks: SpadesTrick[];

  round: number;
  targetScore: number;

  teamScores: [number, number];
  teamBags: [number, number];

  spadesBroken: boolean;

  roundWinnerTeam: 0 | 1 | null;
  winnerTeam: 0 | 1 | null;

  lastMove: SpadesLastMove | null;
  history: SpadesHistoryItem[];
};

export type SpadesPublicPlayer = {
  seat: number;
  userId: string;

  handCount: number;
  hand?: SpadesCard[];

  bid: number | null;
  bidType: SpadesBidType | null;

  tricksWon: number;

  score: number;
  bags: number;
};

export type SpadesPublicState = {
  phase: SpadesPhase;
  mode: SpadesMode;

  turn: number;
  round: number;
  targetScore: number;

  teamScores: [number, number];
  teamBags: [number, number];

  spadesBroken: boolean;

  currentTrick: SpadesTrick | null;
  completedTrickCount: number;

  roundWinnerTeam: 0 | 1 | null;
  winnerTeam: 0 | 1 | null;

  players: SpadesPublicPlayer[];

  lastMove: SpadesLastMove | null;
  historyCount: number;
};

export type SpadesAction =
  | {
      type: 'BID';
      bid: number;
      bidType: SpadesBidType;
    }
  | {
      type: 'PLAY_CARD';
      cardId: string;
    }
  | {
      type: 'START_NEXT_ROUND';
    }
  | {
      type: 'FORCE_FINISH';
      winnerSeat: number | null;
    };

export type Okey101Color = 'RED' | 'BLUE' | 'BLACK' | 'YELLOW' | 'JOKER';

/* =====================================================
   TILE
===================================================== */

export type Okey101Tile = {
  id: string;

  color: Okey101Color;

  value: number; // 1..13

  isJoker?: boolean; // gerçek okey

  isFakeOkey?: boolean; // sahte okey
};

/* =====================================================
   FINISH TYPES
===================================================== */

export type Okey101FinishType = 'NORMAL' | 'ELDEN' | 'OKEY_ILE' | 'CIFT_BITIS';

/* =====================================================
   MELDS
===================================================== */

export type Okey101MeldType = 'RUN' | 'SET' | 'PAIR';

export type Okey101Meld = {
  id: string;

  ownerSeat: number;

  type: Okey101MeldType;

  tiles: Okey101Tile[];
};

/* =====================================================
   PLAYER
===================================================== */

export type Okey101Player = {
  userId: string;

  seat: number;

  hand: Okey101Tile[];

  melds: Okey101Meld[];

  opened: boolean;

  finished: boolean;

  score: number;
};

/* =====================================================
   GAME PHASE
===================================================== */

export type Okey101Phase = 'PLAYING' | 'ROUND_FINISHED' | 'MATCH_FINISHED';

/* =====================================================
   SCORING
===================================================== */

export type Okey101ScoringMode = 'KATLAMALI' | 'KATLAMASIZ';

/* =====================================================
   OPEN HISTORY
===================================================== */

export type Okey101OpeningHistory = {
  seat: number;

  team: 0 | 1;

  points: number;

  kind: 'NORMAL' | 'PAIR';
};

/* =====================================================
   PAIR HISTORY
===================================================== */

export type Okey101PairHistory = {
  seat: number;

  team: 0 | 1;

  pairCount: number;

  at: number;
};

/* =====================================================
   PENALTY EVENTS
===================================================== */

export type Okey101PenaltyEvent =
  | {
      type: 'INVALID_PAIR_OPEN';
      seat: number;
      amount: 101;
      at: number;
    }
  | {
      type: 'OKEY_CAPTURED';
      offenderSeat: number;
      takerSeat: number;
      amount: 101;
      at: number;
    };

/* =====================================================
   STATE
===================================================== */

export type Okey101State = {
  players: Okey101Player[];

  deck: Okey101Tile[];

  discarded: Okey101Tile[];

  indicator: Okey101Tile;

  okey: Okey101Tile;

  tableMelds: Okey101Meld[];

  phase: Okey101Phase;

  mode: 'SOLO' | 'TEAM';

  turn: number;

  drewThisTurn: boolean;

  round: number;

  maxRounds: number;

  starterSeat: number;

  baseOpeningPoints: number;

  scoringMode: Okey101ScoringMode;

  /* =====================================================
     TEAM OPENING
  ===================================================== */

  teamOpeningThresholds: {
    0: number;
    1: number;
  };

  teamPairThresholds: {
    0: number;
    1: number;
  };

  /* =====================================================
     HISTORY
  ===================================================== */

  openingHistory: Okey101OpeningHistory[];

  pairCountHistory: Okey101PairHistory[];

  penaltyEvents: Okey101PenaltyEvent[];

  okeyCapturedEvents: Okey101PenaltyEvent[];

  /* =====================================================
     ROUND RESULT
  ===================================================== */

  winnerSeat: number | null;

  roundWinnerSeat: number | null;

  finishType: Okey101FinishType | null;

  /* =====================================================
     SPECIAL RULES
  ===================================================== */

  okeyDiscardedBySeat: number | null;

  openedThisTurn: number | null;
};

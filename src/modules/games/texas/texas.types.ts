export type TexasPhase =
  | 'PREFLOP'
  | 'FLOP'
  | 'TURN'
  | 'RIVER'
  | 'SHOWDOWN'
  | 'FINISHED';

export type TexasSuit = 'S' | 'H' | 'D' | 'C';

export type TexasRank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'T'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

export type TexasCard = `${TexasRank}${TexasSuit}`;

export type TexasPlayerStatus = 'ACTIVE' | 'FOLDED' | 'ALL_IN';

export type TexasAction =
  | { type: 'FOLD' }
  | { type: 'CHECK' }
  | { type: 'CALL' }
  | { type: 'BET'; amount: number }
  | { type: 'RAISE'; amount: number }
  | { type: 'ALL_IN' }
  | { type: 'FORCE_FINISH'; winnerSeat: number | null };

export type TexasActionLog = {
  seat: number;
  userId: string;
  type: TexasAction['type'];
  amount: number;
  phase: TexasPhase;
  at: number;
};

export type TexasPlayerState = {
  userId: string;
  seat: number;
  cards: TexasCard[];

  stack: number;
  committed: number;
  roundCommitted: number;

  folded: boolean;
  allIn: boolean;
  actedThisStreet: boolean;
};

export type TexasPot = {
  potNo: number;
  amount: number;
  eligibleSeats: number[];
};

export type TexasWinner = {
  seat: number;
  userId: string;
  amount: number;
  handName: string;
  bestFiveCards: TexasCard[];
  rankValue: number[];
  potNos: number[];
};

export type TexasShowdownEntry = {
  seat: number;
  userId: string;
  handName: string;
  bestFiveCards: TexasCard[];
  rankValue: number[];
};

export type TexasInternalState = {
  phase: TexasPhase;

  stake: number;
  smallBlind: number;
  bigBlind: number;

  players: TexasPlayerState[];

  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  turnIndex: number | null;

  deck: TexasCard[];
  burnCards: TexasCard[];
  communityCards: TexasCard[];

  currentBet: number;
  minRaise: number;
  pot: number;
  sidePots: TexasPot[];

  actionHistory: TexasActionLog[];
  winners: TexasWinner[];
  showdown: TexasShowdownEntry[];

  startedAt: number;
  endedAt: number | null;
};

export type TexasPublicPlayer = {
  seat: number;
  userId: string;
  cards: TexasCard[] | ['XX', 'XX'];

  stack: number;
  committed: number;
  roundCommitted: number;

  folded: boolean;
  allIn: boolean;
  actedThisStreet: boolean;
};

export type TexasPublicPayload = {
  pokerPhase: TexasPhase;
  communityCards: TexasCard[];
  burnCount: number;

  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;

  currentBet: number;
  minRaise: number;
  pot: number;
  sidePots: TexasPot[];

  players: TexasPublicPlayer[];
  legalActions: Array<
    | { type: 'FOLD' }
    | { type: 'CHECK' }
    | { type: 'CALL'; amount: number }
    | { type: 'BET'; min: number; max: number }
    | { type: 'RAISE'; min: number; max: number }
    | { type: 'ALL_IN'; amount: number }
  >;

  lastAction: TexasActionLog | null;
  showdown: TexasShowdownEntry[];
  winners: TexasWinner[];
};

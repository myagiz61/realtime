export type CardSuit = 'H' | 'D' | 'S' | 'C';

export type Card = {
  suit: CardSuit;
  value: number; // 1=A, 11=J, 12=Q, 13=K
};

export type BlackjackPhase =
  | 'PLAYER_TURN'
  | 'DEALER_TURN'
  | 'INSURANCE_DECISION'
  | 'FINISHED';

export type BlackjackHandResult =
  | 'BLACKJACK'
  | 'WIN'
  | 'LOSE'
  | 'PUSH'
  | 'BUST'
  | 'SURRENDER';

export type BlackjackResult =
  | 'BLACKJACK'
  | 'WIN'
  | 'LOSE'
  | 'PUSH'
  | 'BUST'
  | 'SURRENDER'
  | 'MIXED';

export type BlackjackConfig = {
  deckCount: number; // 1, 2, 4, 6, 8
  dealerHitsSoft17: boolean;
  blackjackPayout: number; // default 1.5
  allowDouble: boolean;
  allowSplit: boolean;
  allowSurrender: boolean;
  allowInsurance: boolean;
  maxSplitHands: number;
  hitSplitAces: boolean;
};

export type PlayerHandState = {
  cards: Card[];
  doubled: boolean;
  surrendered: boolean;
  stood: boolean;
  busted: boolean;
  blackjack: boolean;
  finished: boolean;
  result: BlackjackHandResult | null;
  betMultiplier: number; // 1 normal, 2 double, split eller için de ayrı takip
  splitFromAces?: boolean;
};

export type BlackjackLastMove = {
  playerId: string;
  action: 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT' | 'INSURANCE' | 'SURRENDER';
  handIndex: number;
  drawnCard?: Card | null;
  extraDrawnCard?: Card | null;
};

export type BlackjackHistoryItem = {
  playerId: string;
  action: 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT' | 'INSURANCE' | 'SURRENDER';
  handIndex: number;
  drawnCard?: Card | null;
  extraDrawnCard?: Card | null;
  timestamp: number;
};

export type BlackjackState = {
  players: string[];
  mode?: 'SOLO' | 'TEAM';

  phase: BlackjackPhase;
  turn: number; // mevcut GameEngine uyumu için 0

  deck: Card[];
  dealerHand: Card[];

  hands: PlayerHandState[];
  activeHandIndex: number;

  insuranceOffered: boolean;
  insuranceTaken: boolean;
  insuranceResolved: boolean;
  insuranceBetMultiplier: number; // 0 veya 0.5

  finished: boolean;
  result: BlackjackResult | null;
  winner: number | null;

  dealerScore: number;
  history: BlackjackHistoryItem[];
  lastMove: BlackjackLastMove | null;

  config: BlackjackConfig;
};

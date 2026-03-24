export type HitAction = {
  type: 'HIT';
};

export type StandAction = {
  type: 'STAND';
};

export type DoubleAction = {
  type: 'DOUBLE';
};

export type SplitAction = {
  type: 'SPLIT';
};

export type InsuranceAction = {
  type: 'INSURANCE';
  take: boolean;
};

export type SurrenderAction = {
  type: 'SURRENDER';
};

export type BlackjackAction =
  | HitAction
  | StandAction
  | DoubleAction
  | SplitAction
  | InsuranceAction
  | SurrenderAction;

import { randomUUID } from 'crypto';
import { GameEngine } from '../games.types';
import {
  Okey101Color,
  Okey101Meld,
  Okey101Player,
  Okey101State,
  Okey101Tile,
} from './okey101.types';

type Okey101Action =
  | { type: 'DRAW_DECK' }
  | { type: 'DRAW_DISCARD' }
  | { type: 'DISCARD'; tileIndex: number }
  | { type: 'OPEN'; melds: Okey101Meld[]; discardIndex: number }
  | { type: 'OPEN_PAIRS'; pairTileIds: string[]; discardIndex: number }
  | {
      type: 'ADD_TO_TABLE';
      nextTableMelds: Okey101Meld[];
      discardIndex: number;
    }
  | { type: 'START_NEXT_ROUND' }
  | { type: 'FORCE_FINISH'; winnerSeat: number | null };

type ScoringMode = 'KATLAMALI' | 'KATLAMASIZ';

type StartOptions = {
  mode?: 'SOLO' | 'TEAM';
  maxRounds?: 1 | 3 | 4;
  scoringMode?: ScoringMode;
  baseOpeningPoints?: number;
};

type RunResolution = {
  valid: boolean;
  values: number[];
  color: Exclude<Okey101Color, 'JOKER'> | null;
};

type OpeningKind = 'NORMAL' | 'PAIR';

type FinishType = 'NORMAL' | 'ELDEN' | 'OKEY_ILE' | 'CIFT_BITIS';

type PenaltyEvent =
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

export class Okey101Engine implements GameEngine {
  private static readonly FIRST_PLAYER_HAND = 22;
  private static readonly OTHER_PLAYER_HAND = 21;
  private static readonly DRAWN_HAND = 22;
  private static readonly UNDRAWN_HAND = 21;

  private static readonly DEFAULT_MAX_ROUNDS: 1 | 3 | 4 = 1;
  private static readonly DEFAULT_SCORING_MODE: ScoringMode = 'KATLAMASIZ';
  private static readonly DEFAULT_OPENING_POINTS = 101;

  private static readonly REQUIRED_PAIR_COUNT = 5;
  private static readonly INVALID_PAIR_OPEN_PENALTY = 101;
  private static readonly OKEY_CAPTURE_PENALTY = 101;

  // Backward-compatible:
  // start(players, mode) veya start(players, { ...options })
  start(
    players: string[],
    modeOrOptions: 'SOLO' | 'TEAM' | StartOptions = 'SOLO',
  ): Okey101State {
    if (players.length !== 4) {
      throw new Error('OKEY101 requires 4 players');
    }

    const opts =
      typeof modeOrOptions === 'string'
        ? { mode: modeOrOptions }
        : modeOrOptions;

    return this.buildFreshRoundState({
      players,
      mode: opts.mode ?? 'SOLO',
      round: 1,
      maxRounds: opts.maxRounds ?? Okey101Engine.DEFAULT_MAX_ROUNDS,
      scores: new Map<number, number>(),
      scoringMode: opts.scoringMode ?? Okey101Engine.DEFAULT_SCORING_MODE,
      baseOpeningPoints:
        opts.baseOpeningPoints ?? Okey101Engine.DEFAULT_OPENING_POINTS,
    });
  }

  move(
    state: Okey101State,
    playerId: string,
    action: Okey101Action,
  ): Okey101State {
    if (action.type === 'FORCE_FINISH') {
      state.phase = 'MATCH_FINISHED';
      state.winnerSeat = action.winnerSeat ?? null;
      state.roundWinnerSeat = action.winnerSeat ?? null;
      return state;
    }

    if (action.type === 'START_NEXT_ROUND') {
      return this.handleStartNextRound(state);
    }

    if (state.phase !== 'PLAYING') {
      return state;
    }

    const seat = this.getSeat(state, playerId);
    if (seat !== state.turn) {
      throw new Error('Not your turn');
    }

    if (state.players[seat].finished) {
      throw new Error('Finished player cannot act');
    }

    switch (action.type) {
      case 'DRAW_DECK':
        return this.handleDrawDeck(state, seat);

      case 'DRAW_DISCARD':
        return this.handleDrawDiscard(state, seat);

      case 'DISCARD':
        return this.handleDiscard(state, seat, action.tileIndex);

      case 'OPEN':
        return this.handleOpen(state, seat, action.melds, action.discardIndex);

      case 'OPEN_PAIRS':
        return this.handleOpenPairs(
          state,
          seat,
          action.pairTileIds,
          action.discardIndex,
        );

      case 'ADD_TO_TABLE':
        return this.handleAddToTable(
          state,
          seat,
          action.nextTableMelds,
          action.discardIndex,
        );

      default:
        return state;
    }
  }

  getPublicState(state: Okey101State, viewerSeat: number | null) {
    const topDiscard =
      state.discarded.length > 0
        ? state.discarded[state.discarded.length - 1]
        : null;

    return {
      phase: state.phase,
      turn: state.turn,
      drewThisTurn: state.drewThisTurn,

      indicator: state.indicator,
      okey: state.okey,
      mode: state.mode,
      scoringMode: state.scoringMode,

      deckCount: state.deck.length,
      discardTop: topDiscard,
      discardCount: state.discarded.length,

      round: state.round,
      maxRounds: state.maxRounds,
      winnerSeat: state.winnerSeat,
      roundWinnerSeat: state.roundWinnerSeat,
      finishType: state.finishType,
      starterSeat: state.starterSeat,

      baseOpeningPoints: state.baseOpeningPoints,
      teamOpeningThresholds: state.teamOpeningThresholds,
      teamPairThresholds: state.teamPairThresholds,
      openingHistory: [...state.openingHistory],
      pairCountHistory: [...(state.pairCountHistory ?? [])],
      penaltyEvents: [...(state.penaltyEvents ?? [])],
      okeyCapturedEvents: [...(state.okeyCapturedEvents ?? [])],

      tableMelds: this.cloneMelds(state.tableMelds),

      players: state.players.map((p, idx) => ({
        seat: p.seat,
        userId: p.userId,
        count: p.hand.length,
        opened: p.opened,
        finished: p.finished,
        score: p.score,
        melds: idx === viewerSeat ? this.cloneMelds(p.melds) : undefined,
        hand: idx === viewerSeat ? [...p.hand] : undefined,
      })),
    };
  }

  isFinished(state: Okey101State): boolean {
    return state.phase === 'MATCH_FINISHED';
  }

  getWinner(state: Okey101State): number | null {
    return state.winnerSeat;
  }

  /* =====================================================
     ROUND BUILD
  ===================================================== */

  private isPairOpening(player: Okey101Player): boolean {
    return (
      player.melds.length > 0 && player.melds.every((m) => m.type === 'PAIR')
    );
  }

  private detectFinishType(
    state: Okey101State,
    seat: number,
    lastDiscardedTile: Okey101Tile,
  ): FinishType {
    const player = state.players[seat];

    if (this.isRealOkey(lastDiscardedTile, state.okey)) {
      return 'OKEY_ILE';
    }

    if (this.isPairOpening(player)) {
      return 'CIFT_BITIS';
    }

    if (
      player.opened &&
      player.hand.length === 0 &&
      state.openedThisTurn === seat
    ) {
      return 'ELDEN';
    }

    return 'NORMAL';
  }

  private buildFreshRoundState(params: {
    players: string[];
    mode: 'SOLO' | 'TEAM';
    round: number;
    maxRounds: number;
    scores: Map<number, number>;
    scoringMode: ScoringMode;
    baseOpeningPoints: number;
  }): Okey101State {
    const deck = this.createDeck();
    this.shuffle(deck);

    const indicator = deck.pop();
    if (!indicator) throw new Error('Indicator missing');
    if (indicator.color === 'JOKER') {
      throw new Error('Indicator cannot be fake okey');
    }

    const okey = this.computeOkey(indicator);

    const starterSeat = (params.round - 1) % 4;

    const playerStates: Okey101Player[] = params.players.map(
      (userId, seat) => ({
        userId,
        seat,
        hand: [],
        melds: [],
        opened: false,
        finished: false,
        score: params.scores.get(seat) ?? 0,
      }),
    );

    for (let i = 0; i < playerStates.length; i++) {
      const actualSeat = i;
      const count =
        actualSeat === starterSeat
          ? Okey101Engine.FIRST_PLAYER_HAND
          : Okey101Engine.OTHER_PLAYER_HAND;

      playerStates[actualSeat].hand = deck
        .splice(0, count)
        .sort(this.sortTiles);
    }

    return {
      players: playerStates,
      deck,
      discarded: [],
      indicator,
      okey,
      tableMelds: [],
      phase: 'PLAYING',
      mode: params.mode,

      scoringMode: params.scoringMode,
      baseOpeningPoints: params.baseOpeningPoints,
      teamOpeningThresholds: {
        0: params.baseOpeningPoints,
        1: params.baseOpeningPoints,
      },
      teamPairThresholds: {
        0: Okey101Engine.REQUIRED_PAIR_COUNT,
        1: Okey101Engine.REQUIRED_PAIR_COUNT,
      },
      openingHistory: [],
      pairCountHistory: [],
      penaltyEvents: [],
      okeyCapturedEvents: [],

      okeyDiscardedBySeat: null,
      openedThisTurn: null,

      starterSeat,
      turn: starterSeat,
      drewThisTurn: true,

      round: params.round,
      maxRounds: params.maxRounds,

      winnerSeat: null,
      roundWinnerSeat: null,
      finishType: null,
    } as Okey101State;
  }

  private handleStartNextRound(state: Okey101State): Okey101State {
    if (state.phase !== 'ROUND_FINISHED') {
      throw new Error('Cannot start next round now');
    }

    if (state.round >= state.maxRounds) {
      state.phase = 'MATCH_FINISHED';
      state.winnerSeat = this.resolveMatchWinner(state);
      return state;
    }

    const currentScores = new Map<number, number>();
    for (const p of state.players) {
      currentScores.set(p.seat, p.score);
    }

    const next = this.buildFreshRoundState({
      players: state.players.map((p) => p.userId),
      mode: state.mode,
      round: state.round + 1,
      maxRounds: state.maxRounds,
      scores: currentScores,
      scoringMode: state.scoringMode,
      baseOpeningPoints: state.baseOpeningPoints,
    });

    Object.assign(state, next);
    return state;
  }

  /* =====================================================
     DRAW / DISCARD
  ===================================================== */

  private handleDrawDeck(state: Okey101State, seat: number): Okey101State {
    this.assertCanDraw(state, seat);

    const tile = state.deck.pop();
    if (!tile) {
      this.finishRoundAsDraw(state);
      return state;
    }

    state.players[seat].hand.push(tile);
    state.players[seat].hand.sort(this.sortTiles);
    state.drewThisTurn = true;

    return state;
  }

  private handleDrawDiscard(state: Okey101State, seat: number): Okey101State {
    this.assertCanDraw(state, seat);

    const tile = state.discarded.pop();
    if (!tile) {
      throw new Error('Discard pile empty');
    }

    state.players[seat].hand.push(tile);
    state.players[seat].hand.sort(this.sortTiles);
    state.drewThisTurn = true;

    if (
      state.okeyDiscardedBySeat !== null &&
      this.isRealOkey(tile, state.okey) &&
      state.okeyDiscardedBySeat !== seat
    ) {
      this.applyPenalty(
        state,
        state.okeyDiscardedBySeat,
        Okey101Engine.OKEY_CAPTURE_PENALTY,
      );

      state.okeyCapturedEvents.push({
        type: 'OKEY_CAPTURED',
        offenderSeat: state.okeyDiscardedBySeat,
        takerSeat: seat,
        amount: 101,
        at: Date.now(),
      });

      state.okeyDiscardedBySeat = null;
    }

    return state;
  }

  private handleDiscard(
    state: Okey101State,
    seat: number,
    tileIndex: number,
  ): Okey101State {
    this.assertCanDiscard(state, seat);

    const hand = state.players[seat].hand;
    const tile = hand[tileIndex];
    if (!tile) {
      throw new Error('Invalid tileIndex');
    }

    hand.splice(tileIndex, 1);
    state.discarded.push(tile);

    if (this.isRealOkey(tile, state.okey)) {
      state.okeyDiscardedBySeat = seat;
    } else {
      state.okeyDiscardedBySeat = null;
    }

    if (hand.length === 0) {
      const finishType = this.detectFinishType(state, seat, tile);
      this.finishRoundWithWinner(state, seat, finishType);
      return state;
    }

    this.advanceTurn(state);
    return state;
  }

  /* =====================================================
     OPEN NORMAL
  ===================================================== */

  private handleOpen(
    state: Okey101State,
    seat: number,
    melds: Okey101Meld[],
    discardIndex: number,
  ): Okey101State {
    const player = state.players[seat];

    if (player.opened) {
      throw new Error('Player already opened');
    }

    this.assertCanDiscard(state, seat);

    if (!melds?.length) {
      throw new Error('Melds required');
    }

    for (const meld of melds) {
      this.validateMeld(meld, state.okey);
    }

    const handCopy = [...player.hand];
    this.consumePlayerTilesForMelds(handCopy, melds);

    const openPoints = this.calculateOpenPoints(melds, state.okey);
    const requiredOpeningPoints = this.getRequiredOpeningPoints(state, seat);

    if (openPoints < requiredOpeningPoints) {
      throw new Error(
        `Open total must be at least ${requiredOpeningPoints}, got ${openPoints}`,
      );
    }

    const discardTile = handCopy[discardIndex];
    if (!discardTile) {
      throw new Error('Invalid discardIndex after open');
    }

    handCopy.splice(discardIndex, 1);

    player.hand = handCopy.sort(this.sortTiles);
    player.opened = true;
    player.melds.push(...this.cloneMelds(melds));

    const normalizedMelds = this.cloneMelds(melds).map((m) => ({
      ...m,
      ownerSeat:
        typeof (m as any).ownerSeat === 'number' ? (m as any).ownerSeat : seat,
    }));

    state.tableMelds.push(...normalizedMelds);
    state.discarded.push(discardTile);
    state.openedThisTurn = seat;

    if (this.isRealOkey(discardTile, state.okey)) {
      state.okeyDiscardedBySeat = seat;
    } else {
      state.okeyDiscardedBySeat = null;
    }

    this.registerOpening(state, seat, openPoints, 'NORMAL');

    if (player.hand.length === 0) {
      const finishType = this.detectFinishType(state, seat, discardTile);
      this.finishRoundWithWinner(state, seat, finishType);
      return state;
    }

    this.advanceTurn(state);
    return state;
  }

  /* =====================================================
     OPEN BY 5+ PAIRS
  ===================================================== */

  private handleOpenPairs(
    state: Okey101State,
    seat: number,
    pairTileIds: string[],
    discardIndex: number,
  ): Okey101State {
    const player = state.players[seat];

    if (player.opened) {
      throw new Error('Player already opened');
    }

    this.assertCanDiscard(state, seat);

    if (!Array.isArray(pairTileIds)) {
      throw new Error('pairTileIds required');
    }

    let pairMelds: Okey101Meld[];
    try {
      pairMelds = this.extractAndValidatePairOpening(
        state,
        player.hand,
        pairTileIds,
        seat,
      );
    } catch (err) {
      this.applyPenalty(state, seat, Okey101Engine.INVALID_PAIR_OPEN_PENALTY);
      state.penaltyEvents.push({
        type: 'INVALID_PAIR_OPEN',
        seat,
        amount: 101,
        at: Date.now(),
      });
      throw err;
    }

    const pairCount = pairMelds.length;
    this.assertPairOpeningThreshold(state, seat, pairCount);

    const handCopy = [...player.hand];
    this.consumePlayerTilesForMelds(handCopy, pairMelds);

    const discardTile = handCopy[discardIndex];
    if (!discardTile) {
      throw new Error('Invalid discardIndex after pair open');
    }

    handCopy.splice(discardIndex, 1);

    player.hand = handCopy.sort(this.sortTiles);
    player.opened = true;
    player.melds.push(...this.cloneMelds(pairMelds));
    state.tableMelds.push(...this.cloneMelds(pairMelds));
    state.discarded.push(discardTile);
    state.openedThisTurn = seat;

    if (this.isRealOkey(discardTile, state.okey)) {
      state.okeyDiscardedBySeat = seat;
    } else {
      state.okeyDiscardedBySeat = null;
    }

    this.registerOpening(state, seat, 0, 'PAIR', pairCount);

    if (player.hand.length === 0) {
      const finishType = this.detectFinishType(state, seat, discardTile);
      this.finishRoundWithWinner(state, seat, finishType);
      return state;
    }

    this.advanceTurn(state);
    return state;
  }

  private extractAndValidatePairOpening(
    state: Okey101State,
    hand: Okey101Tile[],
    pairTileIds: string[],
    ownerSeat: number,
  ): Okey101Meld[] {
    if (pairTileIds.length < Okey101Engine.REQUIRED_PAIR_COUNT * 2) {
      throw new Error(
        `At least ${Okey101Engine.REQUIRED_PAIR_COUNT} pairs required`,
      );
    }

    if (pairTileIds.length % 2 !== 0) {
      throw new Error('Pair opening tile count must be even');
    }

    const uniqueIds = new Set(pairTileIds);
    if (uniqueIds.size !== pairTileIds.length) {
      throw new Error('Duplicate tile id in pair opening');
    }

    const selectedTiles = pairTileIds.map((id) => {
      const tile = hand.find((t) => t.id === id);
      if (!tile) {
        throw new Error('Selected pair tile not found in player hand');
      }
      return tile;
    });

    const groups = new Map<string, Okey101Tile[]>();
    for (const tile of selectedTiles) {
      const key = this.getExactPairKey(tile);
      const arr = groups.get(key) ?? [];
      arr.push(tile);
      groups.set(key, arr);
    }

    const pairMelds: Okey101Meld[] = [];

    for (const tiles of groups.values()) {
      if (tiles.length !== 2) {
        throw new Error('Each pair must contain exactly 2 identical tiles');
      }

      if (!this.isExactPair(tiles[0], tiles[1])) {
        throw new Error('Pair tiles must be exactly identical');
      }

      pairMelds.push({
        id: randomUUID(),
        type: 'PAIR' as any,
        ownerSeat,
        tiles: [{ ...tiles[0] }, { ...tiles[1] }],
      });
    }

    if (pairMelds.length < Okey101Engine.REQUIRED_PAIR_COUNT) {
      throw new Error(
        `At least ${Okey101Engine.REQUIRED_PAIR_COUNT} valid pairs required`,
      );
    }

    return pairMelds;
  }

  /* =====================================================
     ADD TO TABLE
  ===================================================== */

  private handleAddToTable(
    state: Okey101State,
    seat: number,
    nextTableMelds: Okey101Meld[],
    discardIndex: number,
  ): Okey101State {
    const player = state.players[seat];

    if (!player.opened) {
      throw new Error('Player must open first');
    }

    this.assertCanDiscard(state, seat);

    if (!nextTableMelds?.length) {
      throw new Error('nextTableMelds required');
    }

    for (const meld of nextTableMelds) {
      this.validateMeld(meld, state.okey);
    }

    const oldTableTiles = this.flattenMelds(state.tableMelds);
    const newTableTiles = this.flattenMelds(nextTableMelds);

    const tempNew = [...newTableTiles];
    for (const oldTile of oldTableTiles) {
      const idx = tempNew.findIndex((t) => this.sameTile(t, oldTile));
      if (idx === -1) {
        throw new Error('Existing table tiles cannot disappear');
      }
      tempNew.splice(idx, 1);
    }

    const handCopy = [...player.hand];
    for (const added of tempNew) {
      const idx = handCopy.findIndex((t) => this.sameTile(t, added));
      if (idx === -1) {
        throw new Error('Player does not own added table tiles');
      }
      handCopy.splice(idx, 1);
    }

    const discardTile = handCopy[discardIndex];
    if (!discardTile) {
      throw new Error('Invalid discardIndex after table add');
    }

    handCopy.splice(discardIndex, 1);

    player.hand = handCopy.sort(this.sortTiles);
    state.tableMelds = this.cloneMelds(nextTableMelds);
    state.discarded.push(discardTile);

    if (this.isRealOkey(discardTile, state.okey)) {
      state.okeyDiscardedBySeat = seat;
    } else {
      state.okeyDiscardedBySeat = null;
    }

    if (player.hand.length === 0) {
      const finishType = this.detectFinishType(state, seat, discardTile);
      this.finishRoundWithWinner(state, seat, finishType);
      return state;
    }

    this.advanceTurn(state);
    return state;
  }

  /* =====================================================
     ROUND / MATCH FINISH
  ===================================================== */

  private finishRoundWithWinner(
    state: Okey101State,
    winnerSeat: number,
    finishType: FinishType = 'NORMAL',
  ) {
    state.phase = 'ROUND_FINISHED';
    state.roundWinnerSeat = winnerSeat;
    state.finishType = finishType;

    this.applyRoundScores(state, winnerSeat, finishType);

    if (state.round >= state.maxRounds) {
      state.phase = 'MATCH_FINISHED';
      state.winnerSeat = this.resolveMatchWinner(state);
      return;
    }

    state.winnerSeat = null;
  }

  private finishRoundAsDraw(state: Okey101State) {
    state.phase = 'ROUND_FINISHED';
    state.roundWinnerSeat = null;
    state.finishType = null;
    this.applyRoundScores(state, null, 'NORMAL');

    if (state.round >= state.maxRounds) {
      state.phase = 'MATCH_FINISHED';
      state.winnerSeat = this.resolveMatchWinner(state);
      return;
    }

    state.winnerSeat = null;
  }

  private applyRoundScores(
    state: Okey101State,
    winnerSeat: number | null,
    finishType: FinishType = 'NORMAL',
  ) {
    const multiplier =
      finishType === 'NORMAL'
        ? 1
        : finishType === 'ELDEN'
          ? 2
          : finishType === 'OKEY_ILE'
            ? 2
            : finishType === 'CIFT_BITIS'
              ? 2
              : 1;

    for (const player of state.players) {
      if (winnerSeat !== null && player.seat === winnerSeat) {
        player.finished = true;
        continue;
      }

      const penalty = this.calculateHandPenalty(player.hand, state.okey);
      player.score += penalty * multiplier;
    }
  }

  private resolveMatchWinner(state: Okey101State): number | null {
    if (state.mode === 'SOLO') {
      return this.findLowestScoreSeat(state);
    }

    const team0 = state.players
      .filter((p) => p.seat % 2 === 0)
      .reduce((sum, p) => sum + p.score, 0);

    const team1 = state.players
      .filter((p) => p.seat % 2 === 1)
      .reduce((sum, p) => sum + p.score, 0);

    if (team0 === team1) return 0;
    return team0 < team1 ? 0 : 1;
  }

  private calculateHandPenalty(hand: Okey101Tile[], okey: Okey101Tile): number {
    let total = 0;

    for (const tile of hand) {
      if (this.isWildcard(tile, okey)) {
        total += 25;
      } else {
        total += tile.value;
      }
    }

    return total;
  }

  private findLowestScoreSeat(state: Okey101State): number | null {
    if (!state.players.length) return null;

    let bestSeat = state.players[0].seat;
    let bestScore = state.players[0].score;

    for (const p of state.players) {
      if (p.score < bestScore) {
        bestScore = p.score;
        bestSeat = p.seat;
      }
    }

    return bestSeat;
  }

  /* =====================================================
     OPEN RULES
  ===================================================== */

  private getRequiredOpeningPoints(state: Okey101State, seat: number): number {
    if (state.mode !== 'TEAM') {
      return state.baseOpeningPoints;
    }

    if (state.scoringMode !== 'KATLAMALI') {
      return state.baseOpeningPoints;
    }

    const team = (seat % 2) as 0 | 1;
    return state.teamOpeningThresholds[team];
  }

  private getRequiredPairCount(state: Okey101State, seat: number): number {
    if (state.mode !== 'TEAM') {
      return Okey101Engine.REQUIRED_PAIR_COUNT;
    }

    if (state.scoringMode !== 'KATLAMALI') {
      return Okey101Engine.REQUIRED_PAIR_COUNT;
    }

    const team = (seat % 2) as 0 | 1;
    return state.teamPairThresholds[team];
  }

  private assertPairOpeningThreshold(
    state: Okey101State,
    seat: number,
    pairCount: number,
  ) {
    const required = this.getRequiredPairCount(state, seat);
    if (pairCount < required) {
      throw new Error(
        `Pair opening must be at least ${required} pairs, got ${pairCount}`,
      );
    }
  }

  private registerOpening(
    state: Okey101State,
    seat: number,
    points: number,
    kind: OpeningKind,
    pairCount?: number,
  ): void {
    if (state.mode !== 'TEAM') return;
    if (state.scoringMode !== 'KATLAMALI') return;

    const team = (seat % 2) as 0 | 1;
    const enemyTeam = (1 - team) as 0 | 1;

    state.openingHistory.push({ seat, team, points, kind });

    if (kind === 'NORMAL') {
      if (points + 1 > state.teamOpeningThresholds[enemyTeam]) {
        state.teamOpeningThresholds[enemyTeam] = points + 1;
      }
      return;
    }

    const effectivePairCount = pairCount ?? Okey101Engine.REQUIRED_PAIR_COUNT;
    state.pairCountHistory.push({
      seat,
      team,
      pairCount: effectivePairCount,
      at: Date.now(),
    });

    if (effectivePairCount + 1 > state.teamPairThresholds[enemyTeam]) {
      state.teamPairThresholds[enemyTeam] = effectivePairCount + 1;
    }
  }

  /* =====================================================
     VALIDATION
  ===================================================== */

  private assertCanDraw(state: Okey101State, seat: number) {
    const handLen = state.players[seat]?.hand.length;
    if (handLen === undefined) {
      throw new Error('Invalid player');
    }

    if (handLen !== Okey101Engine.UNDRAWN_HAND) {
      throw new Error('Cannot draw now');
    }

    if (state.drewThisTurn) {
      throw new Error('Already drew this turn');
    }
  }

  private assertCanDiscard(state: Okey101State, seat: number) {
    const handLen = state.players[seat]?.hand.length;
    if (handLen === undefined) {
      throw new Error('Invalid player');
    }

    if (handLen !== Okey101Engine.DRAWN_HAND) {
      throw new Error('Must draw before discard');
    }
  }

  private validateMeld(meld: Okey101Meld, okey: Okey101Tile) {
    if (meld.type === 'PAIR') {
      if (meld.tiles.length !== 2) {
        throw new Error('PAIR must contain exactly 2 tiles');
      }

      this.validatePair(meld.tiles, okey);
      return;
    }

    if (meld.tiles.length < 3) {
      throw new Error('RUN/SET meld must contain at least 3 tiles');
    }

    if (meld.type === 'SET') {
      this.validateSet(meld.tiles, okey);
      return;
    }

    if (meld.type === 'RUN') {
      this.validateRun(meld.tiles, okey);
      return;
    }

    throw new Error('Invalid meld type');
  }

  private validatePair(tiles: Okey101Tile[], okey: Okey101Tile) {
    if (tiles.length !== 2) {
      throw new Error('PAIR must contain exactly 2 tiles');
    }

    if (this.isWildcard(tiles[0], okey) || this.isWildcard(tiles[1], okey)) {
      throw new Error('Wildcard cannot be used in PAIR opening');
    }

    if (!this.isExactPair(tiles[0], tiles[1])) {
      throw new Error('PAIR must be two identical tiles');
    }
  }

  private validateSet(tiles: Okey101Tile[], okey: Okey101Tile) {
    if (tiles.length < 3 || tiles.length > 4) {
      throw new Error('Set length must be 3 or 4');
    }

    const normals = tiles.filter((t) => !this.isWildcard(t, okey));
    const jokers = tiles.filter((t) => this.isWildcard(t, okey));

    if (normals.length === 0) {
      throw new Error('Set cannot be all jokers');
    }

    const value = normals[0].value;
    const colors = new Set<string>();

    for (const t of normals) {
      if (t.color === 'JOKER') {
        throw new Error('Invalid normal tile in set');
      }

      if (t.value !== value) {
        throw new Error('Invalid set values');
      }

      if (colors.has(t.color)) {
        throw new Error('Duplicate color in set');
      }

      colors.add(t.color);
    }

    if (colors.size + jokers.length > 4) {
      throw new Error('Set exceeds max distinct colors');
    }
  }

  private validateRun(tiles: Okey101Tile[], okey: Okey101Tile) {
    const resolution = this.resolveRun(tiles, okey);
    if (!resolution.valid) {
      throw new Error('Invalid run');
    }
  }

  private resolveRun(tiles: Okey101Tile[], okey: Okey101Tile): RunResolution {
    const wildcards = tiles.filter((t) => this.isWildcard(t, okey));
    const normals = tiles
      .filter((t) => !this.isWildcard(t, okey))
      .sort((a, b) => a.value - b.value);

    if (normals.length === 0) {
      return { valid: false, values: [], color: null };
    }

    const color = normals[0].color;
    if (color === 'JOKER') {
      return { valid: false, values: [], color: null };
    }

    for (const t of normals) {
      if (t.color !== color) {
        return { valid: false, values: [], color: null };
      }
    }

    const normalValues = normals.map((t) => t.value);
    const uniqueValues = new Set(normalValues);
    if (uniqueValues.size !== normalValues.length) {
      return { valid: false, values: [], color: null };
    }

    const runLength = tiles.length;
    let bestValues: number[] | null = null;

    for (let start = 1; start <= 13 - runLength + 1; start++) {
      const seq = Array.from({ length: runLength }, (_, i) => start + i);

      const missingNormals = normalValues.filter((v) => !seq.includes(v));
      if (missingNormals.length > 0) continue;

      const missingCount = seq.filter((v) => !uniqueValues.has(v)).length;
      if (missingCount !== wildcards.length) continue;

      bestValues = seq;
      break;
    }

    if (!bestValues) {
      return { valid: false, values: [], color: null };
    }

    return {
      valid: true,
      values: bestValues,
      color,
    };
  }

  private calculateOpenPoints(melds: Okey101Meld[], okey: Okey101Tile): number {
    let total = 0;
    for (const meld of melds) {
      if (meld.type === 'PAIR') continue;
      total += this.calculateMeldPoints(meld, okey);
    }
    return total;
  }

  private calculateMeldPoints(meld: Okey101Meld, okey: Okey101Tile): number {
    if (meld.type === 'PAIR') {
      return 0;
    }

    if (meld.type === 'SET') {
      const base = meld.tiles.find((t) => !this.isWildcard(t, okey));
      if (!base) return 0;
      return base.value * meld.tiles.length;
    }

    const run = this.resolveRun(meld.tiles, okey);
    if (!run.valid) {
      throw new Error('Invalid run for point calculation');
    }

    return run.values.reduce((sum, v) => sum + v, 0);
  }

  private consumePlayerTilesForMelds(
    hand: Okey101Tile[],
    melds: Okey101Meld[],
  ) {
    for (const meld of melds) {
      for (const tile of meld.tiles) {
        const idx = hand.findIndex((h) => this.sameTile(h, tile));
        if (idx === -1) {
          throw new Error('Player does not own meld tiles');
        }
        hand.splice(idx, 1);
      }
    }
  }

  /* =====================================================
     HELPERS
  ===================================================== */

  private getSeat(state: Okey101State, playerId: string): number {
    const seat = state.players.findIndex((p) => p.userId === playerId);
    if (seat === -1) {
      throw new Error('Player not in game');
    }
    return seat;
  }

  private advanceTurn(state: Okey101State) {
    state.turn = (state.turn + 1) % state.players.length;
    state.drewThisTurn = false;
    state.openedThisTurn = null;
  }

  private applyPenalty(state: Okey101State, seat: number, amount: number) {
    state.players[seat].score += amount;
  }

  private isRealOkey(tile: Okey101Tile, okey: Okey101Tile): boolean {
    return tile.color === okey.color && tile.value === okey.value;
  }

  private isFakeOkey(tile: Okey101Tile): boolean {
    return !!tile.isFakeOkey || tile.color === 'JOKER';
  }

  private isWildcard(tile: Okey101Tile, okey: Okey101Tile): boolean {
    return this.isRealOkey(tile, okey) || this.isFakeOkey(tile);
  }

  private sameTile(a: Okey101Tile, b: Okey101Tile): boolean {
    return a.id === b.id;
  }

  private isExactPair(a: Okey101Tile, b: Okey101Tile): boolean {
    return (
      a.color === b.color &&
      a.value === b.value &&
      !a.isFakeOkey &&
      !b.isFakeOkey &&
      a.color !== 'JOKER' &&
      b.color !== 'JOKER'
    );
  }

  private getExactPairKey(tile: Okey101Tile): string {
    return `${tile.color}-${tile.value}`;
  }

  private flattenMelds(melds: Okey101Meld[]): Okey101Tile[] {
    return melds.flatMap((m) => m.tiles);
  }

  private cloneMelds(melds: Okey101Meld[]): Okey101Meld[] {
    return melds.map((m) => ({
      ...m,
      tiles: m.tiles.map((t) => ({ ...t })),
    }));
  }

  private createDeck(): Okey101Tile[] {
    const colors: Exclude<Okey101Color, 'JOKER'>[] = [
      'RED',
      'BLUE',
      'BLACK',
      'YELLOW',
    ];

    const deck: Okey101Tile[] = [];

    for (const color of colors) {
      for (let value = 1; value <= 13; value++) {
        deck.push({ id: randomUUID(), color, value });
        deck.push({ id: randomUUID(), color, value });
      }
    }

    deck.push({
      id: randomUUID(),
      color: 'JOKER',
      value: 0,
      isFakeOkey: true,
    });

    deck.push({
      id: randomUUID(),
      color: 'JOKER',
      value: 0,
      isFakeOkey: true,
    });

    return deck;
  }

  private computeOkey(indicator: Okey101Tile): Okey101Tile {
    if (indicator.color === 'JOKER') {
      throw new Error('Indicator cannot be fake okey');
    }

    return {
      id: `OKEY-${indicator.color}-${indicator.value}`,
      color: indicator.color,
      value: indicator.value === 13 ? 1 : indicator.value + 1,
    };
  }

  private shuffle(deck: Okey101Tile[]) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  private sortTiles(a: Okey101Tile, b: Okey101Tile) {
    const colorOrder: Record<Okey101Color, number> = {
      RED: 1,
      BLUE: 2,
      BLACK: 3,
      YELLOW: 4,
      JOKER: 5,
    };

    if (colorOrder[a.color] !== colorOrder[b.color]) {
      return colorOrder[a.color] - colorOrder[b.color];
    }

    return a.value - b.value;
  }
}

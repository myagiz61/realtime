import {
  Tile,
  OkeyColor,
  OkeyMode,
} from '../src/modules/games/okey/okey.types';

export type OkeyBotPublicPlayer = {
  seat: number;
  userId: string;
  count: number;
  hand?: Tile[];
};

export type OkeyBotState = {
  phase: 'PLAYING' | 'FINISHED';
  turn: number;
  drewThisTurn: boolean;
  indicator: Tile;
  okey: Tile;
  mode: OkeyMode;
  deckCount: number;
  discardTop: Tile | null;
  discardCount: number;
  winnerSeat?: number | null;
  finishReason?: string | null;
  lastDiscardedBySeat?: number | null;
  lastAction?: any;
  cifteGidiyorSeat?: number | null;
  justDrawnTileId?: string | null;
  drawSource?: 'DECK' | 'DISCARD' | null;
  players: OkeyBotPublicPlayer[];
};

export type OkeyBotDecision =
  | { type: 'WAIT'; reason: string; debug?: any }
  | { type: 'DECLARE_CIFT'; reason: string; debug?: any }
  | { type: 'DECLARE_WIN'; reason: string; debug?: any }
  | { type: 'DRAW_DECK'; reason: string; debug?: any }
  | { type: 'DRAW_DISCARD'; reason: string; debug?: any }
  | { type: 'DISCARD'; tileId: string; reason: string; debug?: any };

type WinningKind = 'NONE' | 'NORMAL' | 'CIFT' | 'OKEY_ILE';

type TileEval = {
  tile: Tile;
  keepScore: number;
  reasons: string[];
};

type HandEvaluation = {
  totalPotential: number;
  runPotential: number;
  setPotential: number;
  pairPotential: number;
  jokerCount: number;
  tileScores: TileEval[];
};

export class ProfessionalOkeyBot {
  private recentDiscardsBySeat = new Map<number, string[]>();

  decide(state: OkeyBotState, myUserId: string): OkeyBotDecision {
    if (state.phase !== 'PLAYING') {
      return { type: 'WAIT', reason: 'phase-not-playing' };
    }

    const me = state.players.find((p) => p.userId === myUserId);
    if (!me) {
      return { type: 'WAIT', reason: 'player-not-found' };
    }

    this.trackRecentDiscard(state);

    if (state.turn !== me.seat) {
      return { type: 'WAIT', reason: 'not-my-turn' };
    }

    const hand = me.hand ? this.sortTiles(me.hand) : [];
    const declaredCift = state.cifteGidiyorSeat === me.seat;

    if (hand.length === 14) {
      return this.decideAt14(state, me.seat, hand, declaredCift);
    }

    if (hand.length === 15) {
      return this.decideAt15(state, me.seat, hand, declaredCift);
    }

    return {
      type: 'WAIT',
      reason: `unexpected-hand-len-${hand.length}`,
      debug: { handLen: hand.length },
    };
  }

  private decideAt14(
    state: OkeyBotState,
    mySeat: number,
    hand: Tile[],
    declaredCift: boolean,
  ): OkeyBotDecision {
    const winKind = this.getWinningKind(hand, state.okey, null, declaredCift);
    if (winKind !== 'NONE') {
      return {
        type: 'DECLARE_WIN',
        reason: `already-winning-${winKind.toLowerCase()}`,
        debug: { winKind },
      };
    }

    if (!declaredCift && this.canGoCift(hand, state.okey)) {
      const ciftStrength = this.getCiftStrength(hand, state.okey);
      if (ciftStrength >= 7) {
        return {
          type: 'DECLARE_CIFT',
          reason: 'strong-cift-structure',
          debug: { ciftStrength },
        };
      }
    }

    if (state.discardTop) {
      const discardDecision = this.shouldTakeDiscard(
        hand,
        state.discardTop,
        state.okey,
        declaredCift,
        state,
        mySeat,
      );

      if (discardDecision.take) {
        return {
          type: 'DRAW_DISCARD',
          reason: discardDecision.reason,
          debug: discardDecision.debug,
        };
      }
    }

    return {
      type: 'DRAW_DECK',
      reason: 'draw-from-deck',
      debug: {
        deckCount: state.deckCount,
        discardTop: state.discardTop ? this.tileLabel(state.discardTop) : null,
      },
    };
  }

  private decideAt15(
    state: OkeyBotState,
    mySeat: number,
    hand: Tile[],
    declaredCift: boolean,
  ): OkeyBotDecision {
    const candidate = this.chooseBestDiscard(
      hand,
      state.okey,
      declaredCift,
      mySeat,
      state,
    );

    return {
      type: 'DISCARD',
      tileId: candidate.tile.id,
      reason: candidate.reason,
      debug: candidate.debug,
    };
  }

  private shouldTakeDiscard(
    hand: Tile[],
    discardTop: Tile,
    okey: Tile,
    declaredCift: boolean,
    state: OkeyBotState,
    mySeat: number,
  ): { take: boolean; reason: string; debug: any } {
    const afterTake = this.sortTiles([...hand, discardTop]);

    const instantWin = this.findWinningDiscard(afterTake, okey, declaredCift);
    if (instantWin) {
      return {
        take: true,
        reason: `discard-creates-${instantWin.kind.toLowerCase()}`,
        debug: {
          discardTop: this.tileLabel(discardTop),
          winningDiscard: this.tileLabel(instantWin.discardTile),
          winKind: instantWin.kind,
        },
      };
    }

    const baseEval = this.evaluateHand(hand, okey);
    const takeEval = this.evaluateBest14From15(afterTake, okey, declaredCift);

    const discardSupport = this.localTileSupport(discardTop, afterTake, okey);
    const discardValue = this.tileStrategicValue(discardTop, afterTake, okey);

    const drawDiscardRisk = this.discardDangerPenalty(
      discardTop,
      state,
      mySeat,
      okey,
    );

    const beforeScore = this.aggregateEvalScore(baseEval);
    const improvement = takeEval.bestScore - beforeScore;

    const exactPairBoost =
      this.exactPairCount(discardTop, hand, okey) > 0 ? 1 : 0;
    const runBoost = this.runNeighborhoodStrength(discardTop, hand, okey);

    if (discardSupport >= 8) {
      return {
        take: true,
        reason: 'discard-has-very-strong-support',
        debug: {
          discardTop: this.tileLabel(discardTop),
          discardSupport,
          discardValue,
          improvement,
          drawDiscardRisk,
        },
      };
    }

    if (improvement >= 30) {
      return {
        take: true,
        reason: 'discard-improves-hand-structure',
        debug: {
          discardTop: this.tileLabel(discardTop),
          improvement,
          beforeScore,
          afterScore: takeEval.bestScore,
        },
      };
    }

    if (exactPairBoost && runBoost >= 1) {
      return {
        take: true,
        reason: 'discard-builds-multi-structure',
        debug: {
          discardTop: this.tileLabel(discardTop),
          exactPairBoost,
          runBoost,
        },
      };
    }

    if (!declaredCift) {
      const ciftStrength = this.getCiftStrength(afterTake.slice(0, 14), okey);
      if (ciftStrength >= 6) {
        return {
          take: true,
          reason: 'discard-enables-cift-plan',
          debug: {
            discardTop: this.tileLabel(discardTop),
            ciftStrength,
          },
        };
      }
    }

    return {
      take: false,
      reason: 'deck-is-better',
      debug: {
        discardTop: this.tileLabel(discardTop),
        discardSupport,
        discardValue,
        improvement,
        drawDiscardRisk,
      },
    };
  }

  private chooseBestDiscard(
    hand: Tile[],
    okey: Tile,
    declaredCift: boolean,
    mySeat: number,
    state: OkeyBotState,
  ): { tile: Tile; reason: string; debug: any } {
    const winning = this.findWinningDiscard(hand, okey, declaredCift);
    if (winning) {
      return {
        tile: winning.discardTile,
        reason: `winning-discard-${winning.kind.toLowerCase()}`,
        debug: {
          kind: winning.kind,
          discardTile: this.tileLabel(winning.discardTile),
        },
      };
    }

    let bestDiscard: Tile | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestDebug: any = null;

    const myRecentDiscards = this.recentDiscardsBySeat.get(mySeat) ?? [];

    for (const tile of hand) {
      if (
        state.drawSource === 'DISCARD' &&
        state.justDrawnTileId &&
        tile.id === state.justDrawnTileId
      ) {
        continue;
      }

      const nextHand = hand.filter((t) => t.id !== tile.id);
      const eval14 = this.evaluateHand(nextHand, okey);

      const tileSupport = this.localTileSupport(tile, hand, okey);
      const tileStrategic = this.tileStrategicValue(tile, hand, okey);
      const dangerPenalty = this.discardDangerPenalty(
        tile,
        state,
        mySeat,
        okey,
      );
      const jokerPenalty = this.jokerDiscardPenalty(tile, okey);
      const ciftPenalty = declaredCift
        ? this.breakPairPenalty(tile, hand, okey)
        : 0;

      const repeatPenalty = myRecentDiscards.includes(this.tileLooseKey(tile))
        ? 40
        : 0;

      const edgePenalty = tile.value === 1 || tile.value === 13 ? 6 : 0;

      const sameDiscardLoopPenalty =
        state.discardTop &&
        this.tileLooseKey(state.discardTop) === this.tileLooseKey(tile)
          ? 25
          : 0;

      const score =
        this.aggregateEvalScore(eval14) -
        tileSupport * 7 -
        tileStrategic * 4 -
        dangerPenalty -
        jokerPenalty -
        ciftPenalty -
        repeatPenalty -
        edgePenalty -
        sameDiscardLoopPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestDiscard = tile;
        bestDebug = {
          score,
          tileSupport,
          tileStrategic,
          dangerPenalty,
          jokerPenalty,
          ciftPenalty,
          repeatPenalty,
          sameDiscardLoopPenalty,
          eval14,
        };
      }
    }

    if (!bestDiscard) {
      // sadece discard'tan çekilen tek taş kaldıysa fallback
      const fallback =
        hand.find((t) => t.id !== state.justDrawnTileId) ?? hand[0];
      return {
        tile: fallback,
        reason: 'fallback-discard',
        debug: { fallback: this.tileLabel(fallback) },
      };
    }

    return {
      tile: bestDiscard,
      reason: 'best-heuristic-discard',
      debug: bestDebug,
    };
  }

  private evaluateBest14From15(
    hand15: Tile[],
    okey: Tile,
    declaredCift: boolean,
  ): {
    discardTile: Tile;
    bestScore: number;
  } {
    let bestTile = hand15[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const tile of hand15) {
      if (this.isRealOkeyTile(tile, okey)) continue;

      const nextHand = hand15.filter((t) => t.id !== tile.id);
      const win = this.getWinningKind(nextHand, okey, tile, declaredCift);

      if (win !== 'NONE') {
        return {
          discardTile: tile,
          bestScore: 999999,
        };
      }

      const eval14 = this.evaluateHand(nextHand, okey);
      const score = this.aggregateEvalScore(eval14);

      if (score > bestScore) {
        bestScore = score;
        bestTile = tile;
      }
    }

    return {
      discardTile: bestTile,
      bestScore,
    };
  }

  private evaluateHand(hand: Tile[], okey: Tile): HandEvaluation {
    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));
    const tileScores: TileEval[] = [];

    let totalPotential = 0;
    let pairPotential = 0;
    let runPotential = 0;
    let setPotential = 0;
    let jokerCount = 0;

    for (const tile of hand) {
      if (this.isRealOkeyTile(tile, okey)) jokerCount++;
      const scoreResult = this.evaluateTileKeepScore(tile, normalized, okey);
      tileScores.push(scoreResult);

      totalPotential += scoreResult.keepScore;
      if (scoreResult.reasons.some((x) => x.startsWith('pair')))
        pairPotential++;
      if (scoreResult.reasons.some((x) => x.startsWith('run'))) runPotential++;
      if (scoreResult.reasons.some((x) => x.startsWith('set'))) setPotential++;
    }

    return {
      tileScores,
      totalPotential,
      pairPotential,
      runPotential,
      setPotential,
      jokerCount,
    };
  }

  private aggregateEvalScore(eval14: HandEvaluation): number {
    return (
      eval14.totalPotential * 8 +
      eval14.runPotential * 5 +
      eval14.setPotential * 5 +
      eval14.pairPotential * 2 +
      eval14.jokerCount * 30
    );
  }

  private evaluateTileKeepScore(
    rawTile: Tile,
    normalizedHand: Tile[],
    okey: Tile,
  ): TileEval {
    const tile = this.normalizeTileForHand(rawTile, okey);
    const reasons: string[] = [];
    let score = 0;

    if (this.isRealOkeyTile(rawTile, okey)) {
      score += 120;
      reasons.push('joker:real-okey');
      return { tile: rawTile, keepScore: score, reasons };
    }

    if (rawTile.isFakeOkey) {
      score += 24;
      reasons.push('special:fake-okey');
    }

    const sameValueDiffColor = normalizedHand.filter(
      (t) =>
        t.id !== tile.id && t.value === tile.value && t.color !== tile.color,
    ).length;

    if (sameValueDiffColor >= 1) {
      score += sameValueDiffColor * 10;
      reasons.push(`set:${sameValueDiffColor}`);
    }

    const sameExact = normalizedHand.filter(
      (t) =>
        t.id !== tile.id && t.value === tile.value && t.color === tile.color,
    ).length;

    if (sameExact >= 1) {
      score += sameExact * 7;
      reasons.push(`pair:${sameExact}`);
    }

    const sameColor = normalizedHand.filter(
      (t) => t.id !== tile.id && t.color === tile.color,
    );

    const prev1 = sameColor.some((t) => t.value === tile.value - 1);
    const next1 = sameColor.some((t) => t.value === tile.value + 1);
    const prev2 = sameColor.some((t) => t.value === tile.value - 2);
    const next2 = sameColor.some((t) => t.value === tile.value + 2);

    if (prev1) {
      score += 9;
      reasons.push('run:prev1');
    }
    if (next1) {
      score += 9;
      reasons.push('run:next1');
    }
    if (prev2) {
      score += 4;
      reasons.push('run:prev2');
    }
    if (next2) {
      score += 4;
      reasons.push('run:next2');
    }
    if (prev1 && next1) {
      score += 14;
      reasons.push('run:middle');
    }

    if (tile.value >= 5 && tile.value <= 10) {
      score += 2;
      reasons.push('mid:value');
    }

    return {
      tile: rawTile,
      keepScore: score,
      reasons,
    };
  }

  private localTileSupport(tile: Tile, hand: Tile[], okey: Tile): number {
    const normalizedHand = hand.map((t) => this.normalizeTileForHand(t, okey));
    const normTile = this.normalizeTileForHand(tile, okey);

    if (this.isRealOkeyTile(tile, okey)) return 999;

    let score = 0;

    for (const t of normalizedHand) {
      if (t.id === normTile.id) continue;

      if (t.value === normTile.value && t.color !== normTile.color) score += 3;
      if (
        t.color === normTile.color &&
        Math.abs(t.value - normTile.value) === 1
      ) {
        score += 4;
      }
      if (
        t.color === normTile.color &&
        Math.abs(t.value - normTile.value) === 2
      ) {
        score += 2;
      }
    }

    return score;
  }

  private tileStrategicValue(tile: Tile, hand: Tile[], okey: Tile): number {
    const normalizedHand = hand.map((t) => this.normalizeTileForHand(t, okey));
    const t = this.normalizeTileForHand(tile, okey);

    if (this.isRealOkeyTile(tile, okey)) return 999;
    if (tile.isFakeOkey) return 30;

    let value = 0;

    const sameValue = normalizedHand.filter(
      (x) => x.id !== t.id && x.value === t.value,
    ).length;

    const sameColor = normalizedHand.filter(
      (x) => x.id !== t.id && x.color === t.color,
    );

    value += sameValue * 7;

    const consecutive = sameColor.filter(
      (x) => Math.abs(x.value - t.value) <= 2,
    ).length;
    value += consecutive * 5;

    if (t.value >= 5 && t.value <= 10) value += 4;
    if (t.value === 1 || t.value === 13) value -= 1;

    return value;
  }

  private discardDangerPenalty(
    tile: Tile,
    state: OkeyBotState,
    mySeat: number,
    okey: Tile,
  ): number {
    let penalty = 0;

    if (this.isRealOkeyTile(tile, okey)) penalty += 7000;
    if (tile.isFakeOkey) penalty += 200;

    const nextSeat = (mySeat + 1) % 4;
    const nextPlayer = state.players.find((p) => p.seat === nextSeat);

    if (nextPlayer) {
      if (state.mode === 'TEAM' && nextSeat % 2 === mySeat % 2) {
        penalty -= 8;
      } else {
        penalty += 18;
      }
    }

    if (tile.value >= 6 && tile.value <= 10) penalty += 6;

    const opponentRecent = this.recentDiscardsBySeat.get(nextSeat) ?? [];
    if (opponentRecent.includes(this.tileLooseKey(tile))) {
      penalty -= 10;
    }

    return penalty;
  }

  private jokerDiscardPenalty(tile: Tile, okey: Tile): number {
    if (this.isRealOkeyTile(tile, okey)) return 100000;
    if (tile.isFakeOkey) return 1000;
    return 0;
  }

  private breakPairPenalty(tile: Tile, hand: Tile[], okey: Tile): number {
    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));
    const t = this.normalizeTileForHand(tile, okey);

    const sameExact = normalized.filter(
      (x) => x.id !== t.id && x.value === t.value && x.color === t.color,
    ).length;

    return sameExact > 0 ? 140 : 0;
  }

  private findWinningDiscard(
    hand15: Tile[],
    okey: Tile,
    declaredCift: boolean,
  ): { discardTile: Tile; kind: WinningKind } | null {
    for (const discardTile of hand15) {
      const nextHand = hand15.filter((t) => t.id !== discardTile.id);
      const kind = this.getWinningKind(
        nextHand,
        okey,
        discardTile,
        declaredCift,
      );

      if (kind !== 'NONE') {
        return { discardTile, kind };
      }
    }

    return null;
  }

  private getWinningKind(
    hand: Tile[],
    okey: Tile,
    lastDiscardedTile: Tile | null,
    declaredCift: boolean,
  ): WinningKind {
    if (hand.length !== 14) return 'NONE';

    if (declaredCift && this.isPairWinningHand(hand, okey)) {
      return 'CIFT';
    }

    if (this.isNormalWinningHand(hand, okey)) {
      if (lastDiscardedTile && this.isRealOkeyTile(lastDiscardedTile, okey)) {
        return 'OKEY_ILE';
      }
      return 'NORMAL';
    }

    return 'NONE';
  }

  private canGoCift(hand: Tile[], okey: Tile): boolean {
    if (this.isPairWinningHand(hand, okey)) return true;

    const strength = this.getCiftStrength(hand, okey);
    return strength >= 5;
  }

  private getCiftStrength(hand: Tile[], okey: Tile): number {
    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));
    const jokerCount = normalized.filter((t) =>
      this.isRealOkeyTile(t, okey),
    ).length;
    const normals = normalized.filter((t) => !this.isRealOkeyTile(t, okey));

    const counts = new Map<string, number>();
    for (const t of normals) {
      const k = this.tileKey(t);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    let pairCount = 0;
    let singleCount = 0;

    for (const c of counts.values()) {
      pairCount += Math.floor(c / 2);
      singleCount += c % 2;
    }

    const coveredSingles = Math.min(singleCount, jokerCount);
    pairCount += coveredSingles;

    const remainingJokers = jokerCount - coveredSingles;
    pairCount += Math.floor(remainingJokers / 2);

    return pairCount;
  }

  private isNormalWinningHand(hand: Tile[], okey: Tile): boolean {
    if (hand.length !== 14) return false;

    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));
    const { jokers, normals } = this.splitJokers(normalized, okey);
    const counts = this.toCounts(normals);
    const memo = new Map<string, boolean>();

    return this.canPartition(counts, jokers, memo);
  }

  private normalizeTileForHand(tile: Tile, okey: Tile): Tile {
    if (!tile.isFakeOkey) return tile;

    const indicatorValue = okey.value === 1 ? 13 : okey.value - 1;

    return {
      ...tile,
      color: okey.color,
      value: indicatorValue,
      isFakeOkey: false,
    };
  }

  private isPairWinningHand(hand: Tile[], okey: Tile): boolean {
    if (hand.length !== 14) return false;

    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));

    const jokerCount = normalized.filter((t) =>
      this.isRealOkeyTile(t, okey),
    ).length;
    const normals = normalized.filter((t) => !this.isRealOkeyTile(t, okey));

    const counts = new Map<string, number>();
    for (const t of normals) {
      const k = this.tileKey(t);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    let pairCount = 0;
    let singleCount = 0;

    for (const c of counts.values()) {
      pairCount += Math.floor(c / 2);
      singleCount += c % 2;
    }

    if (singleCount > jokerCount) return false;

    const remainingJokers = jokerCount - singleCount;
    pairCount += singleCount;
    pairCount += Math.floor(remainingJokers / 2);

    return pairCount >= 7;
  }

  private splitJokers(hand: Tile[], okey: Tile) {
    let jokers = 0;
    const normals: Tile[] = [];

    for (const t of hand) {
      if (this.isRealOkeyTile(t, okey)) {
        jokers++;
      } else {
        normals.push(t);
      }
    }

    return { jokers, normals };
  }

  private isRealOkeyTile(tile: Tile, okey: Tile): boolean {
    return (
      !tile.isFakeOkey && tile.color === okey.color && tile.value === okey.value
    );
  }

  private toCounts(tiles: Tile[]) {
    const map = new Map<string, number>();
    for (const t of tiles) {
      const k = this.tileKey(t);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }

  private tileKey(tile: Tile): string {
    return `${tile.color}:${tile.value}`;
  }

  private tileLooseKey(tile: Tile): string {
    const normalized = tile.isFakeOkey
      ? `FAKE:${tile.color}:${tile.value}`
      : `${tile.color}:${tile.value}`;
    return normalized;
  }

  private memoKey(counts: Map<string, number>, jokers: number): string {
    return JSON.stringify([...counts]) + '|' + jokers;
  }

  private canPartition(
    counts: Map<string, number>,
    jokers: number,
    memo: Map<string, boolean>,
  ): boolean {
    const key = this.memoKey(counts, jokers);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const remaining = this.totalCount(counts);
    if (remaining === 0) {
      const ok = jokers === 0;
      memo.set(key, ok);
      return ok;
    }

    const anchor = this.firstTileKey(counts);
    if (!anchor) {
      const ok = jokers === 0;
      memo.set(key, ok);
      return ok;
    }

    const [anchorColorRaw, anchorValueRaw] = anchor.split(':');
    const anchorColor = anchorColorRaw as OkeyColor;
    const anchorValue = Number(anchorValueRaw);

    for (const size of [3, 4] as const) {
      if (
        this.trySetGroup(counts, jokers, anchorColor, anchorValue, size, memo)
      ) {
        memo.set(key, true);
        return true;
      }
    }

    for (let len = 3; len <= 5; len++) {
      if (
        this.tryRunGroup(counts, jokers, anchorColor, anchorValue, len, memo)
      ) {
        memo.set(key, true);
        return true;
      }
    }

    memo.set(key, false);
    return false;
  }

  private trySetGroup(
    counts: Map<string, number>,
    jokers: number,
    anchorColor: OkeyColor,
    value: number,
    size: 3 | 4,
    memo: Map<string, boolean>,
  ): boolean {
    const colors: OkeyColor[] = ['RED', 'BLUE', 'BLACK', 'YELLOW'];
    const available = colors.filter(
      (c) => (counts.get(`${c}:${value}`) ?? 0) > 0,
    );

    if (!available.includes(anchorColor)) return false;

    const others = available.filter((c) => c !== anchorColor);
    const subsets = this.subsets(others);

    for (const sub of subsets) {
      const realCount = 1 + sub.length;
      if (realCount > size) continue;

      const needJ = size - realCount;
      if (needJ > jokers) continue;

      const usedKeys = [
        `${anchorColor}:${value}`,
        ...sub.map((c) => `${c}:${value}`),
      ];

      for (const k of usedKeys) this.dec(counts, k);
      const ok = this.canPartition(counts, jokers - needJ, memo);
      for (const k of usedKeys) this.inc(counts, k);

      if (ok) return true;
    }

    return false;
  }

  private tryRunGroup(
    counts: Map<string, number>,
    jokers: number,
    color: OkeyColor,
    anchorValue: number,
    len: number,
    memo: Map<string, boolean>,
  ): boolean {
    const minStart = Math.max(1, anchorValue - (len - 1));
    const maxStart = Math.min(anchorValue, 14 - len);

    for (let start = minStart; start <= maxStart; start++) {
      const end = start + len - 1;
      if (end > 13) continue;

      const anchorKey = `${color}:${anchorValue}`;
      if ((counts.get(anchorKey) ?? 0) <= 0) continue;

      const realKeys: string[] = [];
      let missing = 0;

      for (let v = start; v <= end; v++) {
        const k = `${color}:${v}`;
        if ((counts.get(k) ?? 0) > 0) realKeys.push(k);
        else missing++;
      }

      if (missing > jokers) continue;

      const consumeSet = new Set(realKeys);
      consumeSet.add(anchorKey);

      for (const k of consumeSet) this.dec(counts, k);
      const ok = this.canPartition(counts, jokers - missing, memo);
      for (const k of consumeSet) this.inc(counts, k);

      if (ok) return true;
    }

    return false;
  }

  private exactPairCount(tile: Tile, hand: Tile[], okey: Tile): number {
    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));
    const t = this.normalizeTileForHand(tile, okey);

    return normalized.filter(
      (x) => x.id !== t.id && x.color === t.color && x.value === t.value,
    ).length;
  }

  private runNeighborhoodStrength(
    tile: Tile,
    hand: Tile[],
    okey: Tile,
  ): number {
    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));
    const t = this.normalizeTileForHand(tile, okey);

    let strength = 0;
    for (const x of normalized) {
      if (x.id === t.id) continue;
      if (x.color !== t.color) continue;
      const diff = Math.abs(x.value - t.value);
      if (diff === 1) strength += 2;
      else if (diff === 2) strength += 1;
    }
    return strength;
  }

  private totalCount(counts: Map<string, number>) {
    let sum = 0;
    for (const v of counts.values()) sum += v;
    return sum;
  }

  private firstTileKey(counts: Map<string, number>): string | null {
    const keys = [...counts.keys()].sort();
    for (const k of keys) {
      if ((counts.get(k) ?? 0) > 0) return k;
    }
    return null;
  }

  private dec(counts: Map<string, number>, k: string, n = 1) {
    const cur = counts.get(k) ?? 0;
    if (cur < n) throw new Error('Count underflow');
    if (cur === n) counts.delete(k);
    else counts.set(k, cur - n);
  }

  private inc(counts: Map<string, number>, k: string, n = 1) {
    counts.set(k, (counts.get(k) ?? 0) + n);
  }

  private subsets<T>(arr: T[]): T[][] {
    const res: T[][] = [[]];
    for (const x of arr) {
      const curLen = res.length;
      for (let i = 0; i < curLen; i++) {
        res.push([...res[i], x]);
      }
    }
    return res;
  }

  private sortTiles(hand: Tile[]): Tile[] {
    const colorRank: Record<OkeyColor, number> = {
      RED: 1,
      BLUE: 2,
      BLACK: 3,
      YELLOW: 4,
      JOKER: 5,
    };

    return [...hand].sort((a, b) => {
      const c = colorRank[a.color] - colorRank[b.color];
      if (c !== 0) return c;
      if (a.value !== b.value) return a.value - b.value;
      return a.id.localeCompare(b.id);
    });
  }

  private tileLabel(t: Tile | null | undefined): string {
    if (!t) return 'null';
    if (t.isFakeOkey) return `FAKE_OKEY(${t.id})`;
    return `${t.color}-${t.value}(${t.id})`;
  }

  private trackRecentDiscard(state: OkeyBotState) {
    const action = state.lastAction;
    if (!action) return;
    if (action.type !== 'DISCARD') return;
    if (!action.tile) return;
    if (typeof action.seat !== 'number') return;

    const arr = this.recentDiscardsBySeat.get(action.seat) ?? [];
    const key = this.tileLooseKey(action.tile);
    if (arr[arr.length - 1] !== key) {
      arr.push(key);
      if (arr.length > 6) arr.shift();
      this.recentDiscardsBySeat.set(action.seat, arr);
    }
  }
}

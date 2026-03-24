// src/modules/games/tavla/tavla.engine.ts
import { GameEngine } from '../games.types';

type PlayerIndex = 0 | 1;
type TavlaInnerPhase = 'OPENING' | 'PLAYING' | 'FINISHED';

export type TavlaState = {
  // length 24. index 0 => point 1, index 23 => point 24
  // positive => P0 checkers, negative => P1 checkers
  board: number[];
  bar: [number, number]; // [P0, P1] checkers on bar
  off: [number, number]; // borne off counts

  // TURN always means "whose turn to act right now"
  // - in OPENING: whose turn to roll start
  // - in PLAYING: whose turn to play
  turn: PlayerIndex;

  // NEW: tavla internal phase
  phase: TavlaInnerPhase;

  // NEW: opening roll state (each player rolls 1 die, higher starts; tie reroll)
  opening: {
    rolled: [number | null, number | null];
  };

  dice: number[]; // remaining dice this turn (doubles => 4 dice)
  rolled: boolean; // indicates dice rolled for PLAYING phase

  winner: PlayerIndex | null;

  // NEW: scoring (mars/katmerli)
  score: [number, number];
  lastGameValue: number; // 0 if none yet, else 1/2/3
  lastWinType: 'NORMAL' | 'MARS' | 'KATMERLI' | null;

  history: Array<{
    by: PlayerIndex;
    from: number | 'BAR';
    to: 'OFF' | number; // points are 1..24
    die: number;
    hit: boolean;
    at: number;
  }>;
};

export type TavlaAction =
  | { type: 'ROLL_START' }
  | { type: 'ROLL' }
  | { type: 'MOVE'; from: number | 'BAR'; to: 'OFF' | number; die: number }
  | { type: 'END_TURN' }
  | { type: 'FORCE_FINISH'; winnerSeat: number };

export type TavlaLegalMove = {
  from: number | 'BAR';
  to: 'OFF' | number;
  die: number;
  hit: boolean;
};

export type PublicTavlaState = {
  board: number[];
  bar: [number, number];
  off: [number, number];
  turn: PlayerIndex;

  // NEW
  phase: TavlaInnerPhase;
  opening?: { rolled: [number | null, number | null] };
  score: [number, number];
  lastGameValue: number;
  lastWinType: TavlaState['lastWinType'];

  // only for viewer on turn (PLAYING phase)
  dice?: number[];
  legalMoves?: TavlaLegalMove[];

  lastMove: TavlaState['history'][number] | null;
  winner: PlayerIndex | null;
  rolled?: boolean; // ✅ EKLE
};

function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

function signOf(p: PlayerIndex) {
  return p === 0 ? 1 : -1;
}

function abs(n: number) {
  return n < 0 ? -n : n;
}

function pointIndex(point: number) {
  // point: 1..24
  return point - 1;
}

function pointNumber(idx: number) {
  // idx: 0..23
  return idx + 1;
}

function assertPoint(point: number) {
  if (!Number.isInteger(point) || point < 1 || point > 24) {
    throw new Error('Invalid point');
  }
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function isOwnChecker(v: number, p: PlayerIndex) {
  return p === 0 ? v > 0 : v < 0;
}

function isOpponentChecker(v: number, p: PlayerIndex) {
  return p === 0 ? v < 0 : v > 0;
}

// ✅ Turkish (Erkek Tavlası) initial layout
function initialBoard(): number[] {
  const b = Array(24).fill(0);

  // PLAYER 0 (Beyaz – alt, 24 → 1)
  b[23] = +2; // 24
  b[12] = +5; // 13
  b[7] = +3; // 8
  b[5] = +5; // 6

  // PLAYER 1 (Siyah – üst, 1 → 24)
  b[0] = -2; // 1
  b[11] = -5; // 12
  b[16] = -3; // 17
  b[18] = -5; // 19

  return b;
}

function homeRange(p: PlayerIndex): number[] {
  // Player0 home: points 1..6
  // Player1 home: points 19..24
  if (p === 0) return [1, 2, 3, 4, 5, 6];
  return [19, 20, 21, 22, 23, 24];
}

function allInHome(state: TavlaState, p: PlayerIndex) {
  if (state.bar[p] > 0) return false;

  const hr = new Set(homeRange(p).map((pt) => pointIndex(pt)));
  for (let i = 0; i < 24; i++) {
    const v = state.board[i];
    if (!isOwnChecker(v, p)) continue;
    if (!hr.has(i)) return false;
  }
  return true;
}

function entryPointFromBar(p: PlayerIndex, die: number) {
  // Enter from bar:
  // P0 enters into points 24..19: point = 25 - die
  // P1 enters into points 1..6:   point = die
  return p === 0 ? 25 - die : die;
}

function computeToPoint(p: PlayerIndex, fromPoint: number, die: number) {
  // P0 decreases, P1 increases
  return p === 0 ? fromPoint - die : fromPoint + die;
}

function isBlocked(destPoint: number, state: TavlaState, p: PlayerIndex) {
  const v = state.board[pointIndex(destPoint)];
  if (!isOpponentChecker(v, p)) return false;
  return abs(v) >= 2;
}

function canHit(destPoint: number, state: TavlaState, p: PlayerIndex) {
  const v = state.board[pointIndex(destPoint)];
  return isOpponentChecker(v, p) && abs(v) === 1;
}

function hasHigherInHome(state: TavlaState, p: PlayerIndex, fromPoint: number) {
  // bearing off overshoot rule:
  // P0 home 1..6: higher means > fromPoint
  // P1 home 19..24: higher means < fromPoint
  if (p === 0) {
    for (let pt = fromPoint + 1; pt <= 6; pt++) {
      if (isOwnChecker(state.board[pointIndex(pt)], p)) return true;
    }
    return false;
  } else {
    for (let pt = fromPoint - 1; pt >= 19; pt--) {
      if (isOwnChecker(state.board[pointIndex(pt)], p)) return true;
    }
    return false;
  }
}

function canBearOffWithDie(
  state: TavlaState,
  p: PlayerIndex,
  fromPoint: number,
  die: number,
) {
  if (!allInHome(state, p)) return false;

  const distToOff = p === 0 ? fromPoint : 25 - fromPoint;

  if (die === distToOff) return true;

  // overshoot allowed only if no higher checkers
  if (die > distToOff && !hasHigherInHome(state, p, fromPoint)) return true;

  return false;
}

function removeDieOnce(dice: number[], die: number): number[] {
  const i = dice.indexOf(die);
  if (i === -1) throw new Error('Die not available');
  const copy = dice.slice();
  copy.splice(i, 1);
  return copy;
}

function cloneState(s: TavlaState): TavlaState {
  return {
    ...s,
    board: s.board.slice(),
    bar: [s.bar[0], s.bar[1]],
    off: [s.off[0], s.off[1]],
    dice: s.dice.slice(),
    opening: { rolled: [s.opening.rolled[0], s.opening.rolled[1]] },
    score: [s.score[0], s.score[1]],
    history: s.history.slice(),
  };
}

/**
 * RAW LEGAL MOVES (no "must use both dice / must use bigger" filtering)
 * Used internally for sequence search.
 */
function getLegalMovesRaw(state: TavlaState, p: PlayerIndex): TavlaLegalMove[] {
  const moves: TavlaLegalMove[] = [];

  if (state.phase !== 'PLAYING') return moves;
  if (!state.rolled) return moves;
  if (state.dice.length === 0) return moves;
  if (state.winner !== null) return moves;

  const dice = [...state.dice];

  // BAR mandatory
  if (state.bar[p] > 0) {
    for (const die of dice) {
      const entry = entryPointFromBar(p, die);
      if (entry < 1 || entry > 24) continue;
      if (isBlocked(entry, state, p)) continue;

      moves.push({
        from: 'BAR',
        to: entry,
        die,
        hit: canHit(entry, state, p),
      });
    }
    return moves;
  }

  // normal moves
  for (let i = 0; i < 24; i++) {
    const v = state.board[i];
    if (!isOwnChecker(v, p)) continue;

    const fromPoint = pointNumber(i);

    for (const die of dice) {
      const toPoint = computeToPoint(p, fromPoint, die);

      // board move
      if (toPoint >= 1 && toPoint <= 24) {
        if (!isBlocked(toPoint, state, p)) {
          moves.push({
            from: fromPoint,
            to: toPoint,
            die,
            hit: canHit(toPoint, state, p),
          });
        }
        continue;
      }

      // bearing off (outside)
      const outside = p === 0 ? toPoint <= 0 : toPoint >= 25;
      if (outside && canBearOffWithDie(state, p, fromPoint, die)) {
        moves.push({
          from: fromPoint,
          to: 'OFF',
          die,
          hit: false,
        });
      }
    }
  }

  return moves;
}

/**
 * Professional dice-usage enforcement:
 * - Prefer sequences that play the maximum number of dice.
 * - If only 1 die can be played, prefer the bigger die.
 * Returns best sequences (each a list of moves).
 */
function getBestMoveSequences(
  state: TavlaState,
  p: PlayerIndex,
): TavlaLegalMove[][] {
  if (state.phase !== 'PLAYING') return [];
  if (!state.rolled || state.dice.length === 0 || state.winner !== null)
    return [];

  const sequences: TavlaLegalMove[][] = [];

  function rec(s: TavlaState, seq: TavlaLegalMove[]) {
    const raw = getLegalMovesRaw(s, p);
    if (raw.length === 0) {
      sequences.push(seq);
      return;
    }

    for (const mv of raw) {
      const ns = cloneState(s);
      applyLegalMove(ns, p, mv, { scoring: false }); // sequence search should not score/end match side effects
      rec(ns, seq.concat(mv));
    }
  }

  rec(state, []);

  if (sequences.length === 0) return [];

  const maxLen = Math.max(...sequences.map((x) => x.length));
  let best = sequences.filter((x) => x.length === maxLen);

  if (maxLen === 1) {
    const maxDie = Math.max(...best.map((x) => x[0]?.die ?? 0));
    best = best.filter((x) => (x[0]?.die ?? 0) === maxDie);
  }

  return best;
}

/**
 * SINGLE SOURCE OF TRUTH for UI + validation:
 * This returns only moves that respect dice-usage rules (max dice, else bigger die).
 */
function getLegalMoves(state: TavlaState, p: PlayerIndex): TavlaLegalMove[] {
  const bestSeq = getBestMoveSequences(state, p);
  if (bestSeq.length === 0) return [];

  const firstMoves = bestSeq
    .map((seq) => seq[0])
    .filter(Boolean) as TavlaLegalMove[];

  const seen = new Set<string>();
  const uniq: TavlaLegalMove[] = [];
  for (const m of firstMoves) {
    const k = `${m.from}->${m.to}@${m.die}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(m);
  }
  return uniq;
}

function opponentHasCheckerInWinnersHome(
  state: TavlaState,
  winner: PlayerIndex,
) {
  const opp = other(winner);
  const hr = homeRange(winner);
  for (const pt of hr) {
    const v = state.board[pointIndex(pt)];
    if (isOwnChecker(v, opp)) return true;
  }
  return false;
}

function computeWinValue(state: TavlaState, winner: PlayerIndex) {
  const opp = other(winner);
  if (state.off[opp] > 0) return { value: 1 as const, type: 'NORMAL' as const };

  // Mars candidate
  const hasBar = state.bar[opp] > 0;
  const hasInHome = opponentHasCheckerInWinnersHome(state, winner);

  if (hasBar || hasInHome)
    return { value: 3 as const, type: 'KATMERLI' as const };
  return { value: 2 as const, type: 'MARS' as const };
}

function checkFinish(state: TavlaState) {
  if (state.phase === 'FINISHED') return;

  if (state.off[0] >= 15) {
    finalizeWin(state, 0);
  } else if (state.off[1] >= 15) {
    finalizeWin(state, 1);
  }
}

function finalizeWin(state: TavlaState, winner: PlayerIndex) {
  state.winner = winner;
  state.phase = 'FINISHED';

  const win = computeWinValue(state, winner);
  state.lastGameValue = win.value;
  state.lastWinType = win.type;
  state.score[winner] += win.value;
}

function applyLegalMove(
  state: TavlaState,
  p: PlayerIndex,
  mv: TavlaLegalMove,
  opts: { scoring: boolean } = { scoring: true },
) {
  const die = mv.die;

  // BAR -> point
  if (mv.from === 'BAR') {
    if (state.bar[p] <= 0) throw new Error('No checker on BAR');

    const toPoint = mv.to;
    if (toPoint === 'OFF') throw new Error('BAR cannot go OFF');
    assertPoint(toPoint);

    if (isBlocked(toPoint, state, p)) throw new Error('Destination blocked');

    state.bar[p] -= 1;

    let hit = false;
    if (canHit(toPoint, state, p)) {
      hit = true;
      const opp = other(p);
      state.board[pointIndex(toPoint)] = 0;
      state.bar[opp] += 1;
    }

    state.board[pointIndex(toPoint)] += signOf(p);
    state.dice = removeDieOnce(state.dice, die);

    state.history.push({
      by: p,
      from: 'BAR',
      to: toPoint,
      die,
      hit,
      at: Date.now(),
    });

    return;
  }

  // from is point
  const fromPoint = mv.from;
  assertPoint(fromPoint);

  const fromIdx = pointIndex(fromPoint);
  const fromVal = state.board[fromIdx];
  if (!isOwnChecker(fromVal, p)) throw new Error('No checker at from point');

  // point -> OFF
  if (mv.to === 'OFF') {
    if (!canBearOffWithDie(state, p, fromPoint, die)) {
      throw new Error('Invalid bearing off');
    }

    state.board[fromIdx] -= signOf(p);
    state.off[p] += 1;
    state.dice = removeDieOnce(state.dice, die);

    state.history.push({
      by: p,
      from: fromPoint,
      to: 'OFF',
      die,
      hit: false,
      at: Date.now(),
    });

    return;
  }

  // point -> point
  const toPoint = mv.to;
  assertPoint(toPoint);

  // must match geometry
  const expected = computeToPoint(p, fromPoint, die);
  if (expected !== toPoint) throw new Error('Move does not match die');

  if (isBlocked(toPoint, state, p)) throw new Error('Destination blocked');

  // move out
  state.board[fromIdx] -= signOf(p);

  // hit?
  let hit = false;
  if (canHit(toPoint, state, p)) {
    hit = true;
    const opp = other(p);
    state.board[pointIndex(toPoint)] = 0;
    state.bar[opp] += 1;
  }

  state.board[pointIndex(toPoint)] += signOf(p);
  state.dice = removeDieOnce(state.dice, die);

  state.history.push({
    by: p,
    from: fromPoint,
    to: toPoint,
    die,
    hit,
    at: Date.now(),
  });
}

export class TavlaEngine implements GameEngine {
  start(players: string[]) {
    if (players.length !== 2) throw new Error('TAVLA requires 2 players');

    const state: TavlaState = {
      board: initialBoard(),
      bar: [0, 0],
      off: [0, 0],
      turn: 0,

      phase: 'OPENING',
      opening: { rolled: [null, null] },

      dice: [],
      rolled: false,
      winner: null,

      score: [0, 0],
      lastGameValue: 0,
      lastWinType: null,

      history: [],
    };

    return state;
  }

  move(stateAny: any, _playerId: string, action: TavlaAction) {
    // Engine is PURE: it does not authorize playerId/seat.
    // Authorization must be done in GameEngineService / Gateway.
    const state = cloneState(stateAny as TavlaState);

    // 🔥 SYSTEM FORCE FINISH (AFK, timeout, admin vs)
    if (action.type === 'FORCE_FINISH') {
      if (action.winnerSeat !== 0 && action.winnerSeat !== 1) {
        throw new Error('Invalid winner seat');
      }
      const winner = action.winnerSeat as PlayerIndex;

      state.winner = winner;
      state.phase = 'FINISHED';

      const win = computeWinValue(state, winner);
      state.lastGameValue = win.value;
      state.lastWinType = win.type;
      state.score[winner] += win.value;
      return state;
    }

    if (state.winner !== null || state.phase === 'FINISHED') {
      throw new Error('Game already finished');
    }

    switch (action.type) {
      case 'ROLL_START': {
        if (state.phase !== 'OPENING') throw new Error('Not in opening');

        const p = state.turn;

        if (state.opening.rolled[p] !== null)
          throw new Error('Already rolled opening');

        const d = rollDie();
        state.opening.rolled[p] = d;

        // swap to other player for their opening roll
        state.turn = other(p);

        const a = state.opening.rolled[0];
        const b = state.opening.rolled[1];

        // if both rolled:
        if (a !== null && b !== null) {
          if (a === b) {
            // tie -> reroll
            state.opening.rolled = [null, null];
            state.turn = 0;
            return state;
          }

          const starter: PlayerIndex = a > b ? 0 : 1;

          state.phase = 'PLAYING';
          state.turn = starter;
          state.rolled = false;
          state.dice = [];
        }

        return state;
      }

      case 'ROLL': {
        if (state.phase !== 'PLAYING') throw new Error('Game not started');
        if (state.rolled) throw new Error('Already rolled');

        const d1 = rollDie();
        const d2 = rollDie();
        state.rolled = true;
        state.dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
        return state;
      }

      case 'MOVE': {
        if (state.phase !== 'PLAYING') throw new Error('Game not started');
        if (!state.rolled) throw new Error('Roll first');
        if (state.dice.length === 0) throw new Error('No dice left, end turn');

        const p = state.turn;

        const legal = getLegalMoves(state, p);

        const found = legal.find(
          (m) =>
            m.from === action.from &&
            m.to === action.to &&
            m.die === action.die,
        );
        if (!found) throw new Error('Illegal move');

        applyLegalMove(state, p, found);

        // ✅ OYUN BURADA BİTER
        checkFinish(state);

        return state;
      }

      case 'END_TURN': {
        if (state.phase !== 'PLAYING') throw new Error('Game not started');
        if (!state.rolled) throw new Error('Roll first');

        const p = state.turn;
        const legal = getLegalMoves(state, p);

        if (legal.length > 0) {
          throw new Error('Legal move exists; cannot end turn');
        }

        // PASS / end
        state.dice = [];
        state.rolled = false;
        state.turn = other(state.turn);
        checkFinish(state);

        return state;
      }

      default:
        throw new Error('Unknown action');
    }
  }

  isFinished(stateAny: any): boolean {
    const state = stateAny as TavlaState;
    return state.winner !== null || state.phase === 'FINISHED';
  }

  getWinner(stateAny: any): number | null {
    const state = stateAny as TavlaState;
    if (state.winner === null) return null;
    return state.winner; // 0 veya 1
  }

  getPublicState(stateAny: any, viewerIndex: number | null) {
    const s = stateAny as TavlaState;

    if (viewerIndex === null) {
      return {
        phase: s.phase,
        turnIndex: s.turn,
        payload: {
          board: s.board,
          bar: s.bar,
          off: s.off,
          opening:
            s.phase === 'OPENING' ? { rolled: s.opening.rolled } : undefined,
          score: s.score,
          lastGameValue: s.lastGameValue,
          lastWinType: s.lastWinType,
          rolled: s.rolled,
          dice: undefined,
          legalMoves: undefined,
          lastMove: s.history.at(-1) ?? null,
          winner: s.winner,
        },
      };
    }

    const viewer = viewerIndex as PlayerIndex;
    const isMyTurn = s.turn === viewer;

    return {
      phase: s.phase,
      turnIndex: s.turn,
      payload: {
        board: s.board,
        bar: s.bar,
        off: s.off,
        opening:
          s.phase === 'OPENING' ? { rolled: s.opening.rolled } : undefined,
        score: s.score,
        lastGameValue: s.lastGameValue,
        lastWinType: s.lastWinType,
        rolled: s.rolled,
        dice: s.phase === 'PLAYING' && isMyTurn ? s.dice : undefined,
        legalMoves:
          s.phase === 'PLAYING' && isMyTurn
            ? getLegalMoves(s, viewer)
            : undefined,
        lastMove: s.history.at(-1) ?? null,
        winner: s.winner,
      },
    };
  }
}

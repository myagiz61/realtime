import { GameEngine } from '../games.types';
import { PistiAction } from './pisti.actions';
import { createDeck, shuffle } from './pisti.cards';
import {
  Card,
  PistiHistoryItem,
  PistiLastMove,
  PistiState,
} from './pisti.types';
import { validateAction } from './validatePistiActions';
import { calculateTotalScore } from './pisti.score';

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function ensureSupportedPlayerCount(players: string[]) {
  if (players.length !== 2 && players.length !== 4) {
    throw new Error('Pişti supports only 2 or 4 players');
  }
}

function allHandsEmpty(state: PistiState): boolean {
  return state.players.every((playerId) => state.hands[playerId].length === 0);
}

function dealFourCardsToEach(state: PistiState) {
  for (const playerId of state.players) {
    const cards = state.deck.splice(0, 4);
    state.hands[playerId].push(...cards);
  }
}

function buildInitialTable(deck: Card[]): Card[] {
  const table: Card[] = [];

  while (table.length < 4) {
    const next = deck.shift();

    if (!next) {
      throw new Error('Deck exhausted while building initial table');
    }

    // son açık kart vale olmasın
    if (table.length === 3 && next.value === 11) {
      deck.push(next);
      continue;
    }

    table.push(next);
  }

  return table;
}

function buildHistoryItem(params: {
  playerId: string;
  playedCard: Card;
  captured: boolean;
  pisti: boolean;
  valePisti: boolean;
  capturedCount: number;
  tableBefore: Card[];
}): PistiHistoryItem {
  return {
    playerId: params.playerId,
    action: 'PLAY_CARD',
    playedCard: params.playedCard,
    captured: params.captured,
    pisti: params.pisti,
    valePisti: params.valePisti,
    capturedCount: params.capturedCount,
    tableBefore: params.tableBefore,
    timestamp: Date.now(),
  };
}

function buildLastMove(params: {
  playerId: string;
  playedCard: Card;
  captured: boolean;
  pisti: boolean;
  valePisti: boolean;
}): PistiLastMove {
  return {
    playerId: params.playerId,
    playedCard: params.playedCard,
    captured: params.captured,
    pisti: params.pisti,
    valePisti: params.valePisti,
  };
}

function finalizeScores(state: PistiState) {
  const allCapturedCounts = state.players.map(
    (playerId) => state.captured[playerId].length,
  );

  for (const playerId of state.players) {
    state.scores[playerId] = calculateTotalScore({
      cards: state.captured[playerId],
      pistiCount: state.pistiCount[playerId],
      valePistiCount: state.valePistiCount[playerId],
      allCapturedCounts,
    });
  }
}

export class PistiEngine implements GameEngine {
  start(players: string[], mode?: 'SOLO' | 'TEAM'): PistiState {
    ensureSupportedPlayerCount(players);

    const deck = shuffle(createDeck());

    const hands: Record<string, Card[]> = {};
    const captured: Record<string, Card[]> = {};
    const scores: Record<string, number> = {};
    const pistiCount: Record<string, number> = {};
    const valePistiCount: Record<string, number> = {};

    for (const playerId of players) {
      hands[playerId] = [];
      captured[playerId] = [];
      scores[playerId] = 0;
      pistiCount[playerId] = 0;
      valePistiCount[playerId] = 0;
    }

    for (const playerId of players) {
      hands[playerId] = deck.splice(0, 4);
    }

    const table = buildInitialTable(deck);

    return {
      players,
      mode,
      phase: 'PLAYING',
      deck,
      hands,
      table,
      captured,
      scores,
      turn: 0,
      round: 1,
      lastCapturer: null,
      pistiCount,
      valePistiCount,
      history: [],
      lastMove: null,
    };
  }

  move(state: PistiState, playerId: string, action: PistiAction): PistiState {
    const next = cloneState(state);

    validateAction(next, playerId, action);

    if (!next.hands[playerId]) {
      throw new Error('Player hand not found');
    }

    if (action.type !== 'PLAY_CARD') {
      throw new Error('Unsupported action');
    }

    const hand = next.hands[playerId];
    const playedCard = hand.splice(action.cardIndex, 1)[0];

    if (!playedCard) {
      throw new Error('Played card not found');
    }

    const tableBefore = [...next.table];
    const topCard = next.table[next.table.length - 1];

    let captured = false;
    let pisti = false;
    let valePisti = false;
    let capturedCount = 0;

    const isJack = playedCard.value === 11;
    const sameValueAsTop = !!topCard && playedCard.value === topCard.value;

    if (topCard && (isJack || sameValueAsTop)) {
      captured = true;

      if (next.table.length === 1) {
        if (isJack) {
          valePisti = true;
        } else if (sameValueAsTop) {
          pisti = true;
        }
      }

      const wonCards = [...next.table, playedCard];
      capturedCount = wonCards.length;

      next.captured[playerId].push(...wonCards);
      next.table = [];
      next.lastCapturer = playerId;

      if (pisti) {
        next.pistiCount[playerId] += 1;
      }

      if (valePisti) {
        next.valePistiCount[playerId] += 1;
      }
    } else {
      next.table.push(playedCard);
    }

    next.lastMove = buildLastMove({
      playerId,
      playedCard,
      captured,
      pisti,
      valePisti,
    });

    next.history.push(
      buildHistoryItem({
        playerId,
        playedCard,
        captured,
        pisti,
        valePisti,
        capturedCount,
        tableBefore,
      }),
    );

    next.turn = (next.turn + 1) % next.players.length;

    if (allHandsEmpty(next) && next.deck.length > 0) {
      dealFourCardsToEach(next);
      next.round += 1;
    }

    if (allHandsEmpty(next) && next.deck.length === 0) {
      if (next.table.length > 0 && next.lastCapturer) {
        next.captured[next.lastCapturer].push(...next.table);
        next.table = [];
      }

      finalizeScores(next);
      next.phase = 'FINISHED';
    }

    return next;
  }

  validateMove(
    state: PistiState,
    playerId: string,
    action: PistiAction,
  ): boolean {
    try {
      validateAction(state, playerId, action);
      return true;
    } catch {
      return false;
    }
  }

  isFinished(state: PistiState): boolean {
    return state.phase === 'FINISHED';
  }

  getWinner(state: PistiState): number | null {
    if (state.phase !== 'FINISHED') {
      return null;
    }

    const playerScores = state.players.map(
      (playerId) => state.scores[playerId],
    );
    const maxScore = Math.max(...playerScores);

    const winnerIndexes = playerScores
      .map((score, index) => ({ score, index }))
      .filter((item) => item.score === maxScore)
      .map((item) => item.index);

    if (winnerIndexes.length !== 1) {
      return null;
    }

    return winnerIndexes[0];
  }

  getPublicState(state: PistiState, viewerIndex: number | null) {
    const viewerPlayerId =
      viewerIndex !== null &&
      viewerIndex >= 0 &&
      viewerIndex < state.players.length
        ? state.players[viewerIndex]
        : null;

    const hands: Record<string, Card[] | number> = {};
    const capturedCounts: Record<string, number> = {};

    for (const playerId of state.players) {
      if (playerId === viewerPlayerId) {
        hands[playerId] = state.hands[playerId];
      } else {
        hands[playerId] = state.hands[playerId].length;
      }

      capturedCounts[playerId] = state.captured[playerId].length;
    }

    return {
      players: state.players,
      mode: state.mode,
      phase: state.phase,
      turn: state.turn,
      round: state.round,
      table: state.table,
      hands,
      capturedCounts,
      scores: state.scores,
      pistiCount: state.pistiCount,
      valePistiCount: state.valePistiCount,
      deckCount: state.deck.length,
      lastCapturer: state.lastCapturer,
      lastMove: state.lastMove,
      historyCount: state.history.length,
    };
  }
}

import { GameEngine } from '../games.types';
import { BlackjackAction } from './blackjack.actions';
import { createDeck, drawOne, shuffle } from './blackjack.cards';
import {
  BlackjackConfig,
  BlackjackHandResult,
  BlackjackHistoryItem,
  BlackjackLastMove,
  BlackjackResult,
  BlackjackState,
  Card,
  PlayerHandState,
} from './blackjack.types';
import {
  calculateHandTotal,
  canSplit,
  isBlackjack,
  isBust,
  isSoftTotal,
} from './blackjack.scoring';

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function ensureSupportedPlayerCount(players: string[]) {
  if (players.length !== 1) {
    throw new Error('Blackjack supports only 1 player in this version');
  }
}

function defaultConfig(): BlackjackConfig {
  return {
    deckCount: 6,
    dealerHitsSoft17: false,
    blackjackPayout: 1.5,
    allowDouble: true,
    allowSplit: true,
    allowSurrender: true,
    allowInsurance: true,
    maxSplitHands: 4,
    hitSplitAces: false,
  };
}

function buildHistoryItem(params: {
  playerId: string;
  action: 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT' | 'INSURANCE' | 'SURRENDER';
  handIndex: number;
  drawnCard?: Card | null;
  extraDrawnCard?: Card | null;
}): BlackjackHistoryItem {
  return {
    playerId: params.playerId,
    action: params.action,
    handIndex: params.handIndex,
    drawnCard: params.drawnCard ?? null,
    extraDrawnCard: params.extraDrawnCard ?? null,
    timestamp: Date.now(),
  };
}

function buildLastMove(params: {
  playerId: string;
  action: 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT' | 'INSURANCE' | 'SURRENDER';
  handIndex: number;
  drawnCard?: Card | null;
  extraDrawnCard?: Card | null;
}): BlackjackLastMove {
  return {
    playerId: params.playerId,
    action: params.action,
    handIndex: params.handIndex,
    drawnCard: params.drawnCard ?? null,
    extraDrawnCard: params.extraDrawnCard ?? null,
  };
}

function getActiveHand(state: BlackjackState): PlayerHandState {
  const hand = state.hands[state.activeHandIndex];
  if (!hand) throw new Error('Active hand not found');
  return hand;
}

function refreshHandFlags(hand: PlayerHandState) {
  hand.blackjack = isBlackjack(hand.cards);
  hand.busted = isBust(hand.cards);
}

function refreshAllHands(state: BlackjackState) {
  for (const hand of state.hands) {
    refreshHandFlags(hand);
    if (hand.busted) {
      hand.finished = true;
      hand.result = 'BUST';
    }
  }

  state.dealerScore = calculateHandTotal(state.dealerHand);
}

function markHandStand(hand: PlayerHandState) {
  hand.stood = true;
  hand.finished = true;
}

function markHandSurrender(hand: PlayerHandState) {
  hand.surrendered = true;
  hand.finished = true;
  hand.result = 'SURRENDER';
}

function allPlayerHandsFinished(state: BlackjackState): boolean {
  return state.hands.every((h) => h.finished);
}

function moveToNextHand(state: BlackjackState) {
  for (let i = state.activeHandIndex + 1; i < state.hands.length; i++) {
    if (!state.hands[i].finished) {
      state.activeHandIndex = i;
      return;
    }
  }
}

function finishState(
  state: BlackjackState,
  overallResult: BlackjackResult,
  winner: number | null,
) {
  state.phase = 'FINISHED';
  state.result = overallResult;
  state.winner = winner;
  state.finished = true;
  state.dealerScore = calculateHandTotal(state.dealerHand);
}

function settleHandAgainstDealer(
  hand: PlayerHandState,
  dealerCards: Card[],
): BlackjackHandResult {
  const playerTotal = calculateHandTotal(hand.cards);
  const dealerTotal = calculateHandTotal(dealerCards);

  if (hand.surrendered) return 'SURRENDER';
  if (hand.busted) return 'BUST';
  if (hand.blackjack && !isBlackjack(dealerCards)) return 'BLACKJACK';
  if (!hand.blackjack && isBlackjack(dealerCards)) return 'LOSE';
  if (dealerTotal > 21) return 'WIN';
  if (playerTotal > dealerTotal) return 'WIN';
  if (playerTotal < dealerTotal) return 'LOSE';
  return 'PUSH';
}

function resolveOverallResult(state: BlackjackState): BlackjackResult {
  const results = state.hands.map((h) => h.result).filter(Boolean);

  if (!results.length) return 'LOSE';

  const unique = Array.from(new Set(results));

  if (unique.length === 1) {
    return unique[0] as BlackjackResult;
  }

  return 'MIXED';
}

function dealerShouldHit(state: BlackjackState): boolean {
  const total = calculateHandTotal(state.dealerHand);

  if (total < 17) return true;

  if (
    total === 17 &&
    state.config.dealerHitsSoft17 &&
    isSoftTotal(state.dealerHand)
  ) {
    return true;
  }

  return false;
}

function runDealerTurn(state: BlackjackState) {
  state.phase = 'DEALER_TURN';
  state.dealerScore = calculateHandTotal(state.dealerHand);

  while (dealerShouldHit(state)) {
    const card = drawOne(state.deck);
    state.dealerHand.push(card);
    state.dealerScore = calculateHandTotal(state.dealerHand);
  }

  for (const hand of state.hands) {
    if (!hand.result) {
      hand.result = settleHandAgainstDealer(hand, state.dealerHand);
      hand.finished = true;
    }
  }

  const overall = resolveOverallResult(state);

  const winner = overall === 'WIN' || overall === 'BLACKJACK' ? 0 : null;

  finishState(state, overall, winner);
}

function resolveInsuranceIfNeeded(state: BlackjackState) {
  if (!state.insuranceOffered || state.insuranceResolved) return;

  const dealerBj = isBlackjack(state.dealerHand);

  state.insuranceResolved = true;

  if (dealerBj) {
    for (const hand of state.hands) {
      if (!hand.result) {
        if (hand.blackjack) {
          hand.result = 'PUSH';
        } else {
          hand.result = 'LOSE';
        }
        hand.finished = true;
      }
    }

    finishState(state, state.hands[0].blackjack ? 'PUSH' : 'LOSE', null);
  } else {
    state.phase = 'PLAYER_TURN';
  }
}

function validateAction(
  state: BlackjackState,
  playerId: string,
  action: BlackjackAction,
) {
  if (state.finished || state.phase === 'FINISHED') {
    throw new Error('Game already finished');
  }

  if (!state.players.includes(playerId)) {
    throw new Error('Player not found');
  }

  const currentPlayerId = state.players[state.turn];
  if (currentPlayerId !== playerId) {
    throw new Error('Not your turn');
  }

  if (
    !['HIT', 'STAND', 'DOUBLE', 'SPLIT', 'INSURANCE', 'SURRENDER'].includes(
      action.type,
    )
  ) {
    throw new Error('Unsupported action');
  }

  if (state.phase === 'INSURANCE_DECISION') {
    if (action.type !== 'INSURANCE') {
      throw new Error('Only INSURANCE decision is allowed now');
    }
    return;
  }

  if (state.phase !== 'PLAYER_TURN') {
    throw new Error('Game is not in PLAYER_TURN');
  }

  const hand = getActiveHand(state);

  if (hand.finished) {
    throw new Error('Active hand already finished');
  }

  if (
    action.type === 'DOUBLE' &&
    (!state.config.allowDouble || hand.cards.length !== 2)
  ) {
    throw new Error('DOUBLE not allowed');
  }

  if (
    action.type === 'SPLIT' &&
    (!state.config.allowSplit ||
      !canSplit(hand.cards) ||
      state.hands.length >= state.config.maxSplitHands)
  ) {
    throw new Error('SPLIT not allowed');
  }

  if (
    action.type === 'SURRENDER' &&
    (!state.config.allowSurrender || hand.cards.length !== 2)
  ) {
    throw new Error('SURRENDER not allowed');
  }

  if (
    hand.splitFromAces &&
    !state.config.hitSplitAces &&
    (action.type === 'HIT' || action.type === 'DOUBLE')
  ) {
    throw new Error('Cannot hit split aces');
  }
}

export class BlackjackEngine implements GameEngine {
  start(players: string[], mode?: 'SOLO' | 'TEAM'): BlackjackState {
    ensureSupportedPlayerCount(players);

    const config = defaultConfig();
    const deck = shuffle(createDeck(config.deckCount));

    const playerHand = [drawOne(deck), drawOne(deck)];
    const dealerHand = [drawOne(deck), drawOne(deck)];

    const initialHand: PlayerHandState = {
      cards: playerHand,
      doubled: false,
      surrendered: false,
      stood: false,
      busted: false,
      blackjack: false,
      finished: false,
      result: null,
      betMultiplier: 1,
      splitFromAces: false,
    };

    const state: BlackjackState = {
      players,
      mode,
      phase: 'PLAYER_TURN',
      turn: 0,
      deck,
      dealerHand,
      hands: [initialHand],
      activeHandIndex: 0,
      insuranceOffered: false,
      insuranceTaken: false,
      insuranceResolved: false,
      insuranceBetMultiplier: 0,
      finished: false,
      result: null,
      winner: null,
      dealerScore: 0,
      history: [],
      lastMove: null,
      config,
    };

    refreshAllHands(state);

    const playerBj = isBlackjack(initialHand.cards);
    const dealerBj = isBlackjack(state.dealerHand);

    if (state.config.allowInsurance && state.dealerHand[0]?.value === 1) {
      state.insuranceOffered = true;
      state.phase = 'INSURANCE_DECISION';
    }

    if (playerBj && dealerBj) {
      initialHand.result = 'PUSH';
      initialHand.finished = true;
      finishState(state, 'PUSH', null);
      return state;
    }

    if (playerBj) {
      initialHand.result = 'BLACKJACK';
      initialHand.finished = true;
      finishState(state, 'BLACKJACK', 0);
      return state;
    }

    if (dealerBj && !state.insuranceOffered) {
      initialHand.result = 'LOSE';
      initialHand.finished = true;
      finishState(state, 'LOSE', null);
      return state;
    }

    return state;
  }

  move(
    state: BlackjackState,
    playerId: string,
    action: BlackjackAction,
  ): BlackjackState {
    const next = cloneState(state);

    validateAction(next, playerId, action);

    if (action.type === 'INSURANCE') {
      next.insuranceTaken = action.take;
      next.insuranceBetMultiplier = action.take ? 0.5 : 0;
      next.lastMove = buildLastMove({
        playerId,
        action: 'INSURANCE',
        handIndex: next.activeHandIndex,
      });
      next.history.push(
        buildHistoryItem({
          playerId,
          action: 'INSURANCE',
          handIndex: next.activeHandIndex,
        }),
      );

      resolveInsuranceIfNeeded(next);
      return next;
    }

    const hand = getActiveHand(next);

    if (action.type === 'HIT') {
      const card = drawOne(next.deck);
      hand.cards.push(card);
      refreshHandFlags(hand);

      next.lastMove = buildLastMove({
        playerId,
        action: 'HIT',
        handIndex: next.activeHandIndex,
        drawnCard: card,
      });

      next.history.push(
        buildHistoryItem({
          playerId,
          action: 'HIT',
          handIndex: next.activeHandIndex,
          drawnCard: card,
        }),
      );

      if (hand.busted) {
        hand.finished = true;
        hand.result = 'BUST';
      }

      if (hand.finished) {
        if (allPlayerHandsFinished(next)) {
          runDealerTurn(next);
        } else {
          moveToNextHand(next);
        }
      }

      refreshAllHands(next);
      return next;
    }

    if (action.type === 'DOUBLE') {
      hand.doubled = true;
      hand.betMultiplier = 2;

      const card = drawOne(next.deck);
      hand.cards.push(card);
      refreshHandFlags(hand);

      next.lastMove = buildLastMove({
        playerId,
        action: 'DOUBLE',
        handIndex: next.activeHandIndex,
        drawnCard: card,
      });

      next.history.push(
        buildHistoryItem({
          playerId,
          action: 'DOUBLE',
          handIndex: next.activeHandIndex,
          drawnCard: card,
        }),
      );

      if (hand.busted) {
        hand.result = 'BUST';
      }

      hand.finished = true;

      if (allPlayerHandsFinished(next)) {
        runDealerTurn(next);
      } else {
        moveToNextHand(next);
      }

      refreshAllHands(next);
      return next;
    }

    if (action.type === 'STAND') {
      markHandStand(hand);

      next.lastMove = buildLastMove({
        playerId,
        action: 'STAND',
        handIndex: next.activeHandIndex,
      });

      next.history.push(
        buildHistoryItem({
          playerId,
          action: 'STAND',
          handIndex: next.activeHandIndex,
        }),
      );

      if (allPlayerHandsFinished(next)) {
        runDealerTurn(next);
      } else {
        moveToNextHand(next);
      }

      refreshAllHands(next);
      return next;
    }

    if (action.type === 'SURRENDER') {
      markHandSurrender(hand);

      next.lastMove = buildLastMove({
        playerId,
        action: 'SURRENDER',
        handIndex: next.activeHandIndex,
      });

      next.history.push(
        buildHistoryItem({
          playerId,
          action: 'SURRENDER',
          handIndex: next.activeHandIndex,
        }),
      );

      if (allPlayerHandsFinished(next)) {
        finishState(next, 'SURRENDER', null);
      } else {
        moveToNextHand(next);
      }

      refreshAllHands(next);
      return next;
    }

    if (action.type === 'SPLIT') {
      const [c1, c2] = hand.cards;

      const firstHand: PlayerHandState = {
        cards: [c1, drawOne(next.deck)],
        doubled: false,
        surrendered: false,
        stood: false,
        busted: false,
        blackjack: false,
        finished: false,
        result: null,
        betMultiplier: 1,
        splitFromAces: c1.value === 1,
      };

      const secondHand: PlayerHandState = {
        cards: [c2, drawOne(next.deck)],
        doubled: false,
        surrendered: false,
        stood: false,
        busted: false,
        finished: false,
        blackjack: false,
        result: null,
        betMultiplier: 1,
        splitFromAces: c2.value === 1,
      };

      refreshHandFlags(firstHand);
      refreshHandFlags(secondHand);

      if (firstHand.splitFromAces && !next.config.hitSplitAces) {
        firstHand.finished = true;
        firstHand.stood = true;
      }

      if (secondHand.splitFromAces && !next.config.hitSplitAces) {
        secondHand.finished = true;
        secondHand.stood = true;
      }

      next.hands.splice(next.activeHandIndex, 1, firstHand, secondHand);

      next.lastMove = buildLastMove({
        playerId,
        action: 'SPLIT',
        handIndex: next.activeHandIndex,
        drawnCard: firstHand.cards[1],
        extraDrawnCard: secondHand.cards[1],
      });

      next.history.push(
        buildHistoryItem({
          playerId,
          action: 'SPLIT',
          handIndex: next.activeHandIndex,
          drawnCard: firstHand.cards[1],
          extraDrawnCard: secondHand.cards[1],
        }),
      );

      if (firstHand.finished) {
        moveToNextHand(next);
      }

      if (allPlayerHandsFinished(next)) {
        runDealerTurn(next);
      }

      refreshAllHands(next);
      return next;
    }

    throw new Error('Unsupported action');
  }

  validateMove(
    state: BlackjackState,
    playerId: string,
    action: BlackjackAction,
  ): boolean {
    try {
      validateAction(state, playerId, action);
      return true;
    } catch {
      return false;
    }
  }

  isFinished(state: BlackjackState): boolean {
    return state.finished || state.phase === 'FINISHED';
  }

  getWinner(state: BlackjackState): number | null {
    if (!this.isFinished(state)) {
      return null;
    }

    return state.winner;
  }

  getPublicState(state: BlackjackState, viewerIndex: number | null) {
    const viewerPlayerId =
      viewerIndex !== null &&
      viewerIndex >= 0 &&
      viewerIndex < state.players.length
        ? state.players[viewerIndex]
        : null;

    const isOwner = viewerPlayerId === state.players[0];

    const dealerVisible =
      state.phase === 'FINISHED'
        ? state.dealerHand
        : [state.dealerHand[0], { suit: 'X', value: 0 }];

    const outcome =
      state.finished || state.phase === 'FINISHED'
        ? {
            result: state.result,
            winner: state.winner,
            dealerScore: calculateHandTotal(state.dealerHand),
            hands: state.hands.map((h) => ({
              result: h.result,
              total: calculateHandTotal(h.cards),
              busted: h.busted,
              blackjack: h.blackjack,
              surrendered: h.surrendered,
              stood: h.stood,
              doubled: h.doubled,
              betMultiplier: h.betMultiplier,
            })),
          }
        : null;

    return {
      phase: state.phase,
      turnIndex: state.turn,
      payload: {
        players: state.players,
        mode: state.mode,
        activeHandIndex: state.activeHandIndex,

        hands: isOwner
          ? state.hands.map((h) => ({
              cards: h.cards,
              total: calculateHandTotal(h.cards),
              doubled: h.doubled,
              surrendered: h.surrendered,
              stood: h.stood,
              busted: h.busted,
              blackjack: h.blackjack,
              finished: h.finished,
              result: h.result,
              betMultiplier: h.betMultiplier,
              splitFromAces: h.splitFromAces ?? false,
            }))
          : state.hands.length,

        dealerHand: dealerVisible,
        dealerScore:
          state.phase === 'FINISHED'
            ? calculateHandTotal(state.dealerHand)
            : calculateHandTotal([state.dealerHand[0]]),

        insuranceOffered: state.insuranceOffered,
        insuranceTaken: state.insuranceTaken,
        insuranceResolved: state.insuranceResolved,
        insuranceBetMultiplier: state.insuranceBetMultiplier,

        result: state.result,
        outcome,
        finished: state.finished,
        deckCount: state.deck.length,
        lastMove: state.lastMove,
        historyCount: state.history.length,
        config: state.config,
      },
    };
  }
}

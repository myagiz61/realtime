import { GameEngine } from '../games.types';
import {
  TexasAction,
  TexasActionLog,
  TexasInternalState,
  TexasPublicPayload,
  TexasShowdownEntry,
  TexasWinner,
} from './texas.types';
import { createDeck, shuffleDeck } from './texas.deck';
import {
  buildSidePots,
  dealBoard,
  getAlivePlayers,
  getFirstAliveIndex,
  isOnlyOnePlayerLeft,
  recomputePot,
} from './texas.helpers';
import { compareRankValues, evaluatePlayer } from './texas.evaluator';

export class TexasEngine implements GameEngine {
  start(
    players: string[],
    _mode?: 'SOLO' | 'TEAM',
    options?: Record<string, any>,
  ): TexasInternalState {
    if (players.length < 2) {
      throw new Error('Texas Poker requires at least 2 players');
    }

    const stake = Number(options?.stake ?? 100);
    const smallBlind = Number(
      options?.smallBlind ?? Math.max(1, Math.floor(stake / 20)),
    );
    const bigBlind = Number(
      options?.bigBlind ?? Math.max(2, Math.floor(stake / 10)),
    );

    if (
      !Number.isFinite(stake) ||
      !Number.isFinite(smallBlind) ||
      !Number.isFinite(bigBlind) ||
      stake <= 0 ||
      smallBlind <= 0 ||
      bigBlind <= 0 ||
      bigBlind < smallBlind
    ) {
      throw new Error('Invalid Texas options');
    }

    const deck = shuffleDeck(createDeck());

    const state: TexasInternalState = {
      phase: 'PREFLOP',
      stake,
      smallBlind,
      bigBlind,

      players: players.map((userId, seat) => ({
        userId,
        seat,
        cards: [],
        stack: stake,
        committed: 0,
        roundCommitted: 0,
        folded: false,
        allIn: false,
        actedThisStreet: false,
      })),

      dealerIndex: 0,
      smallBlindIndex: players.length === 2 ? 0 : 1,
      bigBlindIndex: players.length === 2 ? 1 : 2,
      turnIndex: null,

      deck,
      burnCards: [],
      communityCards: [],

      currentBet: 0,
      minRaise: bigBlind,
      pot: 0,
      sidePots: [],

      actionHistory: [],
      winners: [],
      showdown: [],

      startedAt: Date.now(),
      endedAt: null,
    };

    for (let round = 0; round < 2; round++) {
      for (const player of state.players) {
        const card = state.deck.shift();
        if (!card) throw new Error('Deck exhausted while dealing');
        player.cards.push(card);
      }
    }

    this.postBlind(state, state.smallBlindIndex, state.smallBlind, 'BET');
    this.postBlind(state, state.bigBlindIndex, state.bigBlind, 'BET');

    state.currentBet = state.players[state.bigBlindIndex].roundCommitted;
    state.minRaise = bigBlind;

    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (!p.folded && !p.allIn) {
        p.actedThisStreet = i === state.bigBlindIndex;
      }
    }

    state.turnIndex =
      players.length === 2
        ? state.smallBlindIndex
        : this.getNextActorIndex(state, state.bigBlindIndex);

    recomputePot(state);

    return state;
  }

  move(
    state: TexasInternalState,
    playerId: string,
    action: TexasAction,
  ): TexasInternalState {
    if (!action || typeof action.type !== 'string') {
      throw new Error('Invalid action');
    }

    if (action.type === 'FORCE_FINISH') {
      return this.forceFinish(state, action.winnerSeat);
    }

    if (this.isFinished(state)) {
      throw new Error('Game already finished');
    }

    const playerIndex = state.players.findIndex((p) => p.userId === playerId);
    if (playerIndex === -1) {
      throw new Error('Player not found');
    }

    if (state.turnIndex === null || playerIndex !== state.turnIndex) {
      throw new Error('Not your turn');
    }

    const player = state.players[playerIndex];

    if (player.folded) throw new Error('Folded player cannot act');
    if (player.allIn) throw new Error('All-in player cannot act');

    switch (action.type) {
      case 'FOLD':
        this.applyFold(state, playerIndex);
        break;

      case 'CHECK':
        this.applyCheck(state, playerIndex);
        break;

      case 'CALL':
        this.applyCall(state, playerIndex);
        break;

      case 'BET':
        this.applyBet(state, playerIndex, action.amount);
        break;

      case 'RAISE':
        this.applyRaise(state, playerIndex, action.amount);
        break;

      case 'ALL_IN':
        this.applyAllIn(state, playerIndex);
        break;

      default:
        throw new Error(`Unsupported Texas action: ${(action as any).type}`);
    }

    recomputePot(state);

    if (isOnlyOnePlayerLeft(state)) {
      return this.finishByFold(state);
    }

    if (this.areAllRemainingPlayersAllIn(state)) {
      this.runBoardToShowdown(state);
      return state;
    }

    if (this.isBettingRoundClosed(state)) {
      this.advanceStreet(state);
      return state;
    }

    state.turnIndex = this.getNextActorIndex(state, playerIndex);
    return state;
  }

  validateMove(
    state: TexasInternalState,
    playerId: string,
    action: TexasAction,
  ): boolean {
    try {
      if (!action || typeof action.type !== 'string') return false;
      if (action.type === 'FORCE_FINISH') return true;
      if (this.isFinished(state)) return false;

      const idx = state.players.findIndex((p) => p.userId === playerId);
      if (idx === -1) return false;
      if (state.turnIndex === null || idx !== state.turnIndex) return false;

      const player = state.players[idx];
      if (player.folded || player.allIn) return false;

      const legal = this.getLegalActions(state, idx).map((a) => a.type);
      return legal.includes(action.type as any);
    } catch {
      return false;
    }
  }

  isFinished(state: TexasInternalState): boolean {
    return state.phase === 'FINISHED';
  }

  getWinner(state: TexasInternalState): number | null {
    return state.winners.length ? state.winners[0].seat : null;
  }

  getPublicState(state: TexasInternalState, viewerIndex: number | null) {
    const payload: TexasPublicPayload = {
      pokerPhase: state.phase,
      communityCards: state.communityCards,
      burnCount: state.burnCards.length,

      dealerIndex: state.dealerIndex,
      smallBlindIndex: state.smallBlindIndex,
      bigBlindIndex: state.bigBlindIndex,

      currentBet: state.currentBet,
      minRaise: state.minRaise,
      pot: state.pot,
      sidePots: state.sidePots,

      players: state.players.map((p, idx) => ({
        seat: p.seat,
        userId: p.userId,
        cards:
          state.phase === 'FINISHED' ||
          state.phase === 'SHOWDOWN' ||
          viewerIndex === idx
            ? p.cards
            : (['XX', 'XX'] as ['XX', 'XX']),
        stack: p.stack,
        committed: p.committed,
        roundCommitted: p.roundCommitted,
        folded: p.folded,
        allIn: p.allIn,
        actedThisStreet: p.actedThisStreet,
      })),

      legalActions:
        viewerIndex !== null &&
        state.turnIndex === viewerIndex &&
        !this.isFinished(state) &&
        !state.players[viewerIndex].folded &&
        !state.players[viewerIndex].allIn
          ? this.getLegalActions(state, viewerIndex)
          : [],

      lastAction: state.actionHistory.length
        ? state.actionHistory[state.actionHistory.length - 1]
        : null,

      showdown: state.showdown,
      winners: state.winners,
    };

    return {
      phase: this.isFinished(state) ? 'FINISHED' : 'PLAYING',
      turnIndex:
        this.isFinished(state) || state.turnIndex === null
          ? 0
          : state.turnIndex,
      payload,
    };
  }

  private getLegalActions(state: TexasInternalState, playerIndex: number) {
    const player = state.players[playerIndex];
    const toCall = Math.max(0, state.currentBet - player.roundCommitted);

    if (toCall === 0) {
      const actions: any[] = [{ type: 'CHECK' }];

      if (player.stack > 0) {
        if (player.stack >= state.bigBlind) {
          actions.push({
            type: 'BET',
            min: state.bigBlind,
            max: player.stack,
          });
        }

        actions.push({
          type: 'ALL_IN',
          amount: player.stack,
        });
      }

      return actions;
    }

    const actions: any[] = [{ type: 'FOLD' }];

    if (player.stack <= toCall) {
      actions.push({
        type: 'ALL_IN',
        amount: player.stack,
      });
      return actions;
    }

    actions.push({
      type: 'CALL',
      amount: toCall,
    });

    const minRaiseTo = state.currentBet + state.minRaise;
    const minRaiseAmount = minRaiseTo - player.roundCommitted;

    if (player.stack >= minRaiseAmount) {
      actions.push({
        type: 'RAISE',
        min: minRaiseAmount,
        max: player.stack,
      });
    }

    actions.push({
      type: 'ALL_IN',
      amount: player.stack,
    });

    return actions;
  }

  private postBlind(
    state: TexasInternalState,
    playerIndex: number,
    amount: number,
    type: TexasActionLog['type'],
  ) {
    const player = state.players[playerIndex];
    const actual = Math.min(amount, player.stack);

    player.stack -= actual;
    player.committed += actual;
    player.roundCommitted += actual;

    if (player.stack === 0) {
      player.allIn = true;
    }

    recomputePot(state);

    state.actionHistory.push({
      seat: player.seat,
      userId: player.userId,
      type,
      amount: actual,
      phase: state.phase,
      at: Date.now(),
    });
  }

  private applyFold(state: TexasInternalState, playerIndex: number) {
    const player = state.players[playerIndex];
    player.folded = true;
    player.actedThisStreet = true;

    state.actionHistory.push({
      seat: player.seat,
      userId: player.userId,
      type: 'FOLD',
      amount: 0,
      phase: state.phase,
      at: Date.now(),
    });
  }

  private applyCheck(state: TexasInternalState, playerIndex: number) {
    const player = state.players[playerIndex];
    const toCall = state.currentBet - player.roundCommitted;

    if (toCall !== 0) {
      throw new Error('Cannot check facing a bet');
    }

    player.actedThisStreet = true;

    state.actionHistory.push({
      seat: player.seat,
      userId: player.userId,
      type: 'CHECK',
      amount: 0,
      phase: state.phase,
      at: Date.now(),
    });
  }

  private applyCall(state: TexasInternalState, playerIndex: number) {
    const player = state.players[playerIndex];
    const toCall = Math.max(0, state.currentBet - player.roundCommitted);

    if (toCall <= 0) {
      throw new Error('Nothing to call');
    }

    if (player.stack < toCall) {
      throw new Error('Insufficient stack for call');
    }

    player.stack -= toCall;
    player.committed += toCall;
    player.roundCommitted += toCall;
    player.actedThisStreet = true;

    if (player.stack === 0) {
      player.allIn = true;
    }

    state.actionHistory.push({
      seat: player.seat,
      userId: player.userId,
      type: 'CALL',
      amount: toCall,
      phase: state.phase,
      at: Date.now(),
    });
  }

  private applyBet(
    state: TexasInternalState,
    playerIndex: number,
    amount: number,
  ) {
    const player = state.players[playerIndex];

    if (state.currentBet !== 0) {
      throw new Error('Cannot bet when current bet already exists');
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Invalid bet amount');
    }

    if (amount > player.stack) {
      throw new Error('Insufficient stack');
    }

    if (amount < state.bigBlind && amount !== player.stack) {
      throw new Error('Bet below minimum');
    }

    player.stack -= amount;
    player.committed += amount;
    player.roundCommitted += amount;
    player.actedThisStreet = true;

    if (player.stack === 0) {
      player.allIn = true;
    }

    state.currentBet = player.roundCommitted;
    state.minRaise = amount;

    for (let i = 0; i < state.players.length; i++) {
      if (
        i !== playerIndex &&
        !state.players[i].folded &&
        !state.players[i].allIn
      ) {
        state.players[i].actedThisStreet = false;
      }
    }

    state.actionHistory.push({
      seat: player.seat,
      userId: player.userId,
      type: 'BET',
      amount,
      phase: state.phase,
      at: Date.now(),
    });
  }

  private applyRaise(
    state: TexasInternalState,
    playerIndex: number,
    amount: number,
  ) {
    const player = state.players[playerIndex];
    const toCall = Math.max(0, state.currentBet - player.roundCommitted);

    if (state.currentBet <= 0) {
      throw new Error('No bet to raise');
    }

    if (!Number.isFinite(amount) || amount <= toCall) {
      throw new Error('Invalid raise amount');
    }

    if (amount > player.stack) {
      throw new Error('Insufficient stack');
    }

    const raiseTo = player.roundCommitted + amount;
    const minRaiseTo = state.currentBet + state.minRaise;
    const isAllIn = amount === player.stack;

    if (raiseTo < minRaiseTo && !isAllIn) {
      throw new Error('Raise below minimum');
    }

    player.stack -= amount;
    player.committed += amount;
    player.roundCommitted += amount;
    player.actedThisStreet = true;

    if (player.stack === 0) {
      player.allIn = true;
    }

    const raiseSize = player.roundCommitted - state.currentBet;
    const isFullRaise = raiseTo >= minRaiseTo;

    state.currentBet = player.roundCommitted;

    if (isFullRaise) {
      state.minRaise = raiseSize;

      for (let i = 0; i < state.players.length; i++) {
        if (
          i !== playerIndex &&
          !state.players[i].folded &&
          !state.players[i].allIn
        ) {
          state.players[i].actedThisStreet = false;
        }
      }
    }

    state.actionHistory.push({
      seat: player.seat,
      userId: player.userId,
      type: 'RAISE',
      amount,
      phase: state.phase,
      at: Date.now(),
    });
  }

  private applyAllIn(state: TexasInternalState, playerIndex: number) {
    const player = state.players[playerIndex];

    if (player.stack <= 0) {
      throw new Error('Player has no stack');
    }

    const amount = player.stack;
    const oldCurrentBet = state.currentBet;

    player.stack = 0;
    player.committed += amount;
    player.roundCommitted += amount;
    player.allIn = true;
    player.actedThisStreet = true;

    if (oldCurrentBet === 0) {
      state.currentBet = player.roundCommitted;
      state.minRaise = player.roundCommitted;

      for (let i = 0; i < state.players.length; i++) {
        if (
          i !== playerIndex &&
          !state.players[i].folded &&
          !state.players[i].allIn
        ) {
          state.players[i].actedThisStreet = false;
        }
      }
    } else if (player.roundCommitted > oldCurrentBet) {
      const raiseSize = player.roundCommitted - oldCurrentBet;
      const isFullRaise = raiseSize >= state.minRaise;

      state.currentBet = player.roundCommitted;

      if (isFullRaise) {
        state.minRaise = raiseSize;

        for (let i = 0; i < state.players.length; i++) {
          if (
            i !== playerIndex &&
            !state.players[i].folded &&
            !state.players[i].allIn
          ) {
            state.players[i].actedThisStreet = false;
          }
        }
      }
    }

    state.actionHistory.push({
      seat: player.seat,
      userId: player.userId,
      type: 'ALL_IN',
      amount,
      phase: state.phase,
      at: Date.now(),
    });
  }

  private finishByFold(state: TexasInternalState) {
    const idx = getFirstAliveIndex(state);
    if (idx === null) {
      throw new Error('Winner not found');
    }

    recomputePot(state);
    state.sidePots = buildSidePots(state.players);

    const winnerPlayer = state.players[idx];

    state.winners = [
      {
        seat: winnerPlayer.seat,
        userId: winnerPlayer.userId,
        amount: state.pot,
        handName: 'Fold Win',
        bestFiveCards: [],
        rankValue: [999999],
        potNos: state.sidePots.map((p) => p.potNo),
      },
    ];

    state.phase = 'FINISHED';
    state.turnIndex = null;
    state.endedAt = Date.now();

    return state;
  }

  private runBoardToShowdown(state: TexasInternalState) {
    while (!this.isFinished(state)) {
      switch (state.phase) {
        case 'PREFLOP':
          dealBoard(state, 3);
          state.phase = 'FLOP';
          this.resetStreetState(state);
          break;

        case 'FLOP':
          dealBoard(state, 1);
          state.phase = 'TURN';
          this.resetStreetState(state);
          break;

        case 'TURN':
          dealBoard(state, 1);
          state.phase = 'RIVER';
          this.resetStreetState(state);
          break;

        case 'RIVER':
          this.resolveShowdown(state);
          return;

        default:
          return;
      }
    }
  }

  private advanceStreet(state: TexasInternalState) {
    switch (state.phase) {
      case 'PREFLOP':
        dealBoard(state, 3);
        state.phase = 'FLOP';
        this.resetStreetState(state);
        state.turnIndex = this.getFirstPostflopActor(state);
        return;

      case 'FLOP':
        dealBoard(state, 1);
        state.phase = 'TURN';
        this.resetStreetState(state);
        state.turnIndex = this.getFirstPostflopActor(state);
        return;

      case 'TURN':
        dealBoard(state, 1);
        state.phase = 'RIVER';
        this.resetStreetState(state);
        state.turnIndex = this.getFirstPostflopActor(state);
        return;

      case 'RIVER':
        this.resolveShowdown(state);
        return;

      default:
        throw new Error(`Cannot advance from ${state.phase}`);
    }
  }

  private resolveShowdown(state: TexasInternalState) {
    recomputePot(state);
    state.sidePots = buildSidePots(state.players);
    state.phase = 'SHOWDOWN';

    const contenders = getAlivePlayers(state.players);
    const evaluated: TexasShowdownEntry[] = contenders.map((p) =>
      evaluatePlayer(p, state.communityCards),
    );

    state.showdown = evaluated;

    const winners: TexasWinner[] = [];

    for (const pot of state.sidePots) {
      const eligible = evaluated.filter((e) =>
        pot.eligibleSeats.includes(e.seat),
      );
      if (!eligible.length) continue;

      let best = eligible[0];

      for (let i = 1; i < eligible.length; i++) {
        if (compareRankValues(eligible[i].rankValue, best.rankValue) > 0) {
          best = eligible[i];
        }
      }

      const potWinners = eligible.filter(
        (e) => compareRankValues(e.rankValue, best.rankValue) === 0,
      );

      const share = Math.floor(pot.amount / potWinners.length);
      let remainder = pot.amount - share * potWinners.length;

      const ordered = [...potWinners].sort((a, b) => a.seat - b.seat);

      for (const winner of ordered) {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder--;

        winners.push({
          seat: winner.seat,
          userId: winner.userId,
          amount: share + extra,
          handName: winner.handName,
          bestFiveCards: winner.bestFiveCards,
          rankValue: winner.rankValue,
          potNos: [pot.potNo],
        });
      }
    }

    state.winners = this.mergeWinners(winners);
    state.phase = 'FINISHED';
    state.turnIndex = null;
    state.endedAt = Date.now();
  }

  private mergeWinners(winners: TexasWinner[]): TexasWinner[] {
    const map = new Map<string, TexasWinner>();

    for (const winner of winners) {
      const key = `${winner.seat}:${winner.userId}`;
      const existing = map.get(key);

      if (!existing) {
        map.set(key, {
          ...winner,
          potNos: [...winner.potNos],
        });
        continue;
      }

      existing.amount += winner.amount;
      existing.potNos = [
        ...new Set([...existing.potNos, ...winner.potNos]),
      ].sort((a, b) => a - b);
    }

    return [...map.values()].sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.seat - b.seat;
    });
  }

  private forceFinish(state: TexasInternalState, winnerSeat: number | null) {
    if (winnerSeat !== null) {
      const winner = state.players[winnerSeat];
      if (!winner) {
        throw new Error('Invalid force finish winner seat');
      }

      recomputePot(state);
      state.sidePots = buildSidePots(state.players);

      state.winners = [
        {
          seat: winner.seat,
          userId: winner.userId,
          amount: state.pot,
          handName: 'Force Finish',
          bestFiveCards: [],
          rankValue: [888888],
          potNos: state.sidePots.map((p) => p.potNo),
        },
      ];
    } else {
      state.winners = [];
    }

    state.phase = 'FINISHED';
    state.turnIndex = null;
    state.endedAt = Date.now();

    return state;
  }

  private resetStreetState(state: TexasInternalState) {
    state.currentBet = 0;
    state.minRaise = state.bigBlind;

    for (const player of state.players) {
      player.roundCommitted = 0;
      player.actedThisStreet = player.folded || player.allIn;
    }
  }

  private getNextActorIndex(
    state: TexasInternalState,
    fromIndex: number,
  ): number | null {
    const len = state.players.length;

    for (let i = 1; i <= len; i++) {
      const idx = (fromIndex + i) % len;
      const player = state.players[idx];

      if (!player.folded && !player.allIn) {
        return idx;
      }
    }

    return null;
  }

  private getFirstPostflopActor(state: TexasInternalState): number | null {
    const len = state.players.length;

    for (let i = 1; i <= len; i++) {
      const idx = (state.dealerIndex + i) % len;
      const player = state.players[idx];

      if (!player.folded && !player.allIn) {
        return idx;
      }
    }

    return null;
  }

  private isBettingRoundClosed(state: TexasInternalState): boolean {
    const activePlayers = state.players.filter((p) => !p.folded && !p.allIn);

    if (activePlayers.length === 0) {
      return true;
    }

    return activePlayers.every(
      (player) =>
        player.actedThisStreet && player.roundCommitted === state.currentBet,
    );
  }

  private areAllRemainingPlayersAllIn(state: TexasInternalState): boolean {
    const alivePlayers = state.players.filter((p) => !p.folded);

    if (alivePlayers.length <= 1) {
      return false;
    }

    return alivePlayers.every((p) => p.allIn);
  }
}

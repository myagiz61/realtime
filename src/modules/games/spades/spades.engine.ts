import { GameEngine } from '../games.types';
import {
  SpadesAction,
  SpadesBidType,
  SpadesCard,
  SpadesHistoryItem,
  SpadesLastMove,
  SpadesPlayedCard,
  SpadesPlayer,
  SpadesPublicState,
  SpadesRoundScore,
  SpadesState,
  SpadesSuit,
  SpadesTrick,
} from './spades.types';
import { createDeck, dealHands, shuffle, sortHand } from './spades.deck';
import { calculateRoundScores } from './spades.scoring';

const RULES = {
  TARGET_SCORE: 500,
  SANDBAG_LIMIT: 10,
  SANDBAG_PENALTY: 100,
  NIL_BONUS: 100,
  NIL_PENALTY: -100,
  BLIND_NIL_BONUS: 200,
  BLIND_NIL_PENALTY: -200,
  MERCY_SCORE: -200,
  MAX_ROUNDS: 50,
} as const;

function clone<T>(v: T): T {
  return structuredClone(v);
}

function teamOfSeat(seat: number): 0 | 1 {
  return (seat % 2) as 0 | 1;
}

function partnerSeat(seat: number): number {
  return (seat + 2) % 4;
}

function createPlayer(
  userId: string,
  seat: number,
  hand: SpadesCard[],
): SpadesPlayer {
  return {
    userId,
    seat,
    hand: sortHand(hand),
    bid: null,
    bidType: null,
    tricksWon: 0,
    score: 0,
    bags: 0,
  };
}

function hasSuit(hand: SpadesCard[], suit: SpadesSuit): boolean {
  return hand.some((c) => c.suit === suit);
}

function getCard(player: SpadesPlayer, cardId: string): SpadesCard {
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) throw new Error('Card not in hand');
  return card;
}

function removeCard(player: SpadesPlayer, cardId: string): SpadesCard {
  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error('Card not in hand');

  const [card] = player.hand.splice(idx, 1);
  if (!card) throw new Error('Card removal failed');
  return card;
}

function findTwoClubsSeat(players: SpadesPlayer[]): number {
  const p = players.find((player) =>
    player.hand.some((c) => c.suit === 'CLUBS' && c.rank === 2),
  );
  if (!p) throw new Error('2♣ not found');
  return p.seat;
}

function canLeadSpade(
  state: SpadesState,
  player: SpadesPlayer,
  card: SpadesCard,
): boolean {
  if (card.suit !== 'SPADES') return true;
  if (state.spadesBroken) return true;

  const nonSpades = player.hand.filter((c) => c.suit !== 'SPADES');
  return nonSpades.length === 0;
}

function allBidsSubmitted(state: SpadesState): boolean {
  return state.players.every((p) => p.bid !== null && p.bidType !== null);
}

function allHandsEmpty(state: SpadesState): boolean {
  return state.players.every((p) => p.hand.length === 0);
}

function winningPlay(trick: SpadesTrick): SpadesPlayedCard {
  if (trick.plays.length !== 4) {
    throw new Error('Cannot resolve incomplete trick');
  }

  if (!trick.leadSuit) {
    throw new Error('Lead suit missing');
  }

  const lead = trick.leadSuit;
  let winner = trick.plays[0];

  for (const play of trick.plays.slice(1)) {
    const a = winner.card;
    const b = play.card;

    const aSpade = a.suit === 'SPADES';
    const bSpade = b.suit === 'SPADES';

    if (bSpade && !aSpade) {
      winner = play;
      continue;
    }

    if (bSpade && aSpade && b.rank > a.rank) {
      winner = play;
      continue;
    }

    if (!bSpade && aSpade) {
      continue;
    }

    if (b.suit === lead && a.suit !== lead) {
      winner = play;
      continue;
    }

    if (b.suit === lead && a.suit === lead && b.rank > a.rank) {
      winner = play;
    }
  }

  return winner;
}

function winningTeamFromScores(
  teamScores: [number, number],
  teamBags: [number, number],
): 0 | 1 {
  if (teamScores[0] === teamScores[1]) {
    return teamBags[0] <= teamBags[1] ? 0 : 1;
  }

  return teamScores[0] > teamScores[1] ? 0 : 1;
}

function buildBidHistoryItem(params: {
  seat: number;
  userId: string;
  bid: number;
  bidType: SpadesBidType;
}): SpadesHistoryItem {
  return {
    type: 'BID',
    seat: params.seat,
    userId: params.userId,
    bid: params.bid,
    bidType: params.bidType,
    at: Date.now(),
  };
}

function buildPlayHistoryItem(params: {
  seat: number;
  userId: string;
  card: SpadesCard;
  leadSuit: SpadesSuit | null;
}): SpadesHistoryItem {
  return {
    type: 'PLAY_CARD',
    seat: params.seat,
    userId: params.userId,
    card: params.card,
    leadSuit: params.leadSuit,
    at: Date.now(),
  };
}

function buildBidLastMove(params: {
  seat: number;
  bid: number;
  bidType: SpadesBidType;
}): SpadesLastMove {
  return {
    type: 'BID',
    seat: params.seat,
    bid: params.bid,
    bidType: params.bidType,
    at: Date.now(),
  };
}

function buildPlayLastMove(params: {
  seat: number;
  card: SpadesCard;
  trickSize: number;
}): SpadesLastMove {
  return {
    type: 'PLAY_CARD',
    seat: params.seat,
    card: params.card,
    trickSize: params.trickSize,
    at: Date.now(),
  };
}

function buildTrickFinishedMove(params: {
  winnerSeat: number;
  winningCard: SpadesCard;
}): SpadesLastMove {
  return {
    type: 'TRICK_FINISHED',
    winnerSeat: params.winnerSeat,
    winningCard: params.winningCard,
    at: Date.now(),
  };
}

function buildRoundFinishedMove(scores: SpadesRoundScore[]): SpadesLastMove {
  return {
    type: 'ROUND_FINISHED',
    scores,
    at: Date.now(),
  };
}

function trimHistory(state: SpadesState) {
  if (state.history.length > 300) {
    state.history = state.history.slice(-300);
  }
}

function freshRound(params: {
  players: string[];
  round: number;
  dealer: number;
  scores: [number, number];
  bags: [number, number];
  target: number;
}): SpadesState {
  const deck = shuffle(createDeck());
  const hands = dealHands(deck, 4);

  const players = params.players.map((id, seat) =>
    createPlayer(id, seat, hands[seat]),
  );

  const firstBidder = (params.dealer + 1) % 4;

  return {
    players,
    mode: 'TEAM',
    phase: 'BIDDING',
    dealer: params.dealer,
    turn: firstBidder,
    currentTrick: null,
    completedTricks: [],
    round: params.round,
    targetScore: params.target,
    teamScores: params.scores,
    teamBags: params.bags,
    spadesBroken: false,
    roundWinnerTeam: null,
    winnerTeam: null,
    lastMove: null,
    history: [],
  };
}

export class SpadesEngine implements GameEngine {
  start(players: string[], mode?: 'SOLO' | 'TEAM'): SpadesState {
    if (players.length !== 4) {
      throw new Error('Spades requires 4 players');
    }

    if (mode && mode !== 'TEAM') {
      throw new Error('Spades supports TEAM mode only');
    }

    return freshRound({
      players,
      round: 1,
      dealer: 3,
      scores: [0, 0],
      bags: [0, 0],
      target: RULES.TARGET_SCORE,
    });
  }

  private validateBid(
    state: SpadesState,
    seat: number,
    action: Extract<SpadesAction, { type: 'BID' }>,
  ) {
    if (state.phase !== 'BIDDING') {
      throw new Error('Not bidding phase');
    }

    if (state.turn !== seat) {
      throw new Error('Not your turn');
    }

    if (!Number.isInteger(action.bid)) {
      throw new Error('Bid must be integer');
    }

    const player = state.players[seat];
    if (!player) {
      throw new Error('Player not found');
    }

    if (player.bid !== null || player.bidType !== null) {
      throw new Error('Player already bid');
    }

    const bidType: SpadesBidType = action.bidType ?? 'NORMAL';

    if (bidType === 'NORMAL') {
      if (action.bid < 1 || action.bid > 13) {
        throw new Error('Normal bid must be 1-13');
      }
      return;
    }

    if (bidType === 'NIL' || bidType === 'BLIND_NIL') {
      if (action.bid !== 0) {
        throw new Error('Nil and blind nil bids must use bid=0');
      }

      if (bidType === 'BLIND_NIL') {
        const partner = state.players[partnerSeat(seat)];
        if (partner?.bidType === 'BLIND_NIL') {
          throw new Error('Both teammates cannot bid blind nil');
        }
      }

      return;
    }

    throw new Error('Invalid bid type');
  }

  private validatePlay(
    state: SpadesState,
    seat: number,
    action: Extract<SpadesAction, { type: 'PLAY_CARD' }>,
  ) {
    if (state.phase !== 'PLAYING') {
      throw new Error('Not playing phase');
    }

    if (state.turn !== seat) {
      throw new Error('Not your turn');
    }

    const player = state.players[seat];
    if (!player) throw new Error('Player not found');

    const card = getCard(player, action.cardId);
    const trick = state.currentTrick;
    if (!trick) {
      throw new Error('Current trick missing');
    }

    if (trick.plays.length === 0) {
      if (state.completedTricks.length === 0) {
        const twoSeat = findTwoClubsSeat(state.players);

        if (seat !== twoSeat) {
          throw new Error('2♣ must start the round');
        }

        if (!(card.suit === 'CLUBS' && card.rank === 2)) {
          throw new Error('First card must be 2♣');
        }
      } else if (!canLeadSpade(state, player, card)) {
        throw new Error('Spades not broken');
      }

      return;
    }

    if (!trick.leadSuit) {
      throw new Error('Lead suit missing');
    }

    if (card.suit !== trick.leadSuit && hasSuit(player.hand, trick.leadSuit)) {
      throw new Error('Must follow suit');
    }
  }

  move(
    state: SpadesState,
    playerId: string,
    action: SpadesAction,
  ): SpadesState {
    const next = clone(state);

    if (action.type === 'FORCE_FINISH') {
      next.phase = 'MATCH_FINISHED';
      next.winnerTeam =
        typeof action.winnerSeat === 'number'
          ? teamOfSeat(action.winnerSeat)
          : null;
      next.roundWinnerTeam = next.winnerTeam;
      return next;
    }

    const seat = next.players.findIndex((p) => p.userId === playerId);
    if (seat === -1) {
      throw new Error('Player not found');
    }

    if (action.type === 'START_NEXT_ROUND') {
      if (next.phase !== 'ROUND_FINISHED') {
        throw new Error('Round not finished');
      }

      const dealer = (next.dealer + 1) % 4;

      return freshRound({
        players: next.players.map((p) => p.userId),
        round: next.round + 1,
        dealer,
        scores: next.teamScores,
        bags: next.teamBags,
        target: next.targetScore,
      });
    }

    if (next.phase === 'MATCH_FINISHED') {
      throw new Error('Match finished');
    }

    if (action.type === 'BID') {
      this.validateBid(next, seat, action);

      const player = next.players[seat];
      const bidType: SpadesBidType = action.bidType ?? 'NORMAL';

      player.bid = action.bid;
      player.bidType = bidType;

      next.lastMove = buildBidLastMove({
        seat,
        bid: action.bid,
        bidType,
      });

      next.history.push(
        buildBidHistoryItem({
          seat,
          userId: player.userId,
          bid: action.bid,
          bidType,
        }),
      );
      trimHistory(next);

      if (allBidsSubmitted(next)) {
        const first = findTwoClubsSeat(next.players);

        next.phase = 'PLAYING';
        next.turn = first;
        next.currentTrick = {
          leaderSeat: first,
          leadSuit: null,
          plays: [],
          winnerSeat: null,
        };

        return next;
      }

      next.turn = (next.turn + 1) % 4;
      return next;
    }

    if (action.type === 'PLAY_CARD') {
      this.validatePlay(next, seat, action);

      const player = next.players[seat];
      const trick = next.currentTrick;
      if (!trick) {
        throw new Error('Current trick missing');
      }

      const previewCard = getCard(player, action.cardId);

      if (trick.plays.length === 0) {
        trick.leadSuit = previewCard.suit;
        trick.leaderSeat = seat;
      }

      const card = removeCard(player, action.cardId);

      if (
        card.suit === 'SPADES' &&
        trick.leadSuit &&
        trick.leadSuit !== 'SPADES'
      ) {
        next.spadesBroken = true;
      }

      if (
        card.suit === 'SPADES' &&
        trick.plays.length === 0 &&
        next.completedTricks.length > 0
      ) {
        next.spadesBroken = true;
      }

      trick.plays.push({
        seat,
        userId: player.userId,
        card,
      });

      next.lastMove = buildPlayLastMove({
        seat,
        card,
        trickSize: trick.plays.length,
      });

      next.history.push(
        buildPlayHistoryItem({
          seat,
          userId: player.userId,
          card,
          leadSuit: trick.leadSuit,
        }),
      );
      trimHistory(next);

      if (trick.plays.length < 4) {
        next.turn = (seat + 1) % 4;
        return next;
      }

      const win = winningPlay(trick);
      trick.winnerSeat = win.seat;

      next.completedTricks.push(clone(trick));
      next.players[win.seat].tricksWon += 1;

      next.lastMove = buildTrickFinishedMove({
        winnerSeat: win.seat,
        winningCard: win.card,
      });

      next.history.push({
        type: 'TRICK_FINISHED',
        winnerSeat: win.seat,
        trick: clone(trick),
        at: Date.now(),
      });
      trimHistory(next);

      if (allHandsEmpty(next)) {
        const result = calculateRoundScores({
          players: next.players,
          currentTeamScores: next.teamScores,
          currentTeamBags: next.teamBags,
          rules: {
            sandbagLimit: RULES.SANDBAG_LIMIT,
            sandbagPenalty: RULES.SANDBAG_PENALTY,
            nilBonus: RULES.NIL_BONUS,
            nilPenalty: RULES.NIL_PENALTY,
            blindNilBonus: RULES.BLIND_NIL_BONUS,
            blindNilPenalty: RULES.BLIND_NIL_PENALTY,
          },
        });

        next.teamScores = result.nextTeamScores;
        next.teamBags = result.nextTeamBags;

        for (const p of next.players) {
          p.score = next.teamScores[teamOfSeat(p.seat)];
          p.bags = next.teamBags[teamOfSeat(p.seat)];
        }

        next.roundWinnerTeam = winningTeamFromScores(
          next.teamScores,
          next.teamBags,
        );

        const reached =
          next.teamScores[0] >= next.targetScore ||
          next.teamScores[1] >= next.targetScore;

        const mercy =
          next.teamScores[0] <= RULES.MERCY_SCORE ||
          next.teamScores[1] <= RULES.MERCY_SCORE;

        const maxRounds = next.round >= RULES.MAX_ROUNDS;

        next.phase =
          reached || mercy || maxRounds ? 'MATCH_FINISHED' : 'ROUND_FINISHED';

        if (next.phase === 'MATCH_FINISHED') {
          next.winnerTeam = winningTeamFromScores(
            next.teamScores,
            next.teamBags,
          );
        }

        next.lastMove = buildRoundFinishedMove(result.roundScores);
        next.history.push({
          type: 'ROUND_FINISHED',
          round: next.round,
          scores: result.roundScores,
          at: Date.now(),
        });
        trimHistory(next);

        next.currentTrick = null;
        return next;
      }

      next.currentTrick = {
        leaderSeat: win.seat,
        leadSuit: null,
        plays: [],
        winnerSeat: null,
      };
      next.turn = win.seat;

      return next;
    }

    throw new Error('Unsupported action');
  }

  validateMove(state: SpadesState, playerId: string, action: SpadesAction) {
    try {
      this.move(state, playerId, action);
      return true;
    } catch {
      return false;
    }
  }

  isFinished(state: SpadesState) {
    return state.phase === 'MATCH_FINISHED';
  }

  getWinner(state: SpadesState) {
    if (state.phase !== 'MATCH_FINISHED') {
      return null;
    }

    if (state.winnerTeam === null) {
      return null;
    }

    return (
      state.players.find((p) => teamOfSeat(p.seat) === state.winnerTeam)
        ?.seat ?? null
    );
  }

  getPublicState(state: SpadesState, viewerIndex: number | null) {
    const payload: SpadesPublicState = {
      phase: state.phase,
      mode: state.mode,
      turn: state.turn,
      round: state.round,
      targetScore: state.targetScore,
      teamScores: state.teamScores,
      teamBags: state.teamBags,
      spadesBroken: state.spadesBroken,
      currentTrick: state.currentTrick,
      completedTrickCount: state.completedTricks.length,
      roundWinnerTeam: state.roundWinnerTeam,
      winnerTeam: state.winnerTeam,
      players: state.players.map((p, i) => ({
        seat: p.seat,
        userId: p.userId,
        handCount: p.hand.length,
        hand: viewerIndex === i ? sortHand(p.hand) : undefined,
        bid: p.bid,
        bidType: p.bidType,
        tricksWon: p.tricksWon,
        score: p.score,
        bags: p.bags,
      })),
      lastMove: state.lastMove,
      historyCount: state.history.length,
    };

    return {
      phase: state.phase,
      turnIndex: state.turn,
      payload,
    };
  }
}

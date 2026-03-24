import { TexasInternalState, TexasPlayerState, TexasPot } from './texas.types';

export function getAlivePlayers(players: TexasPlayerState[]) {
  return players.filter((p) => !p.folded);
}

export function isOnlyOnePlayerLeft(state: TexasInternalState): boolean {
  return getAlivePlayers(state.players).length === 1;
}

export function getFirstAliveIndex(state: TexasInternalState): number | null {
  const idx = state.players.findIndex((p) => !p.folded);
  return idx === -1 ? null : idx;
}

export function getNextAliveIndex(
  players: TexasPlayerState[],
  fromIndex: number,
): number | null {
  const len = players.length;

  for (let i = 1; i <= len; i++) {
    const idx = (fromIndex + i) % len;
    if (!players[idx].folded && !players[idx].allIn) {
      return idx;
    }
  }

  return null;
}

export function getNextContenderIndex(
  players: TexasPlayerState[],
  fromIndex: number,
): number | null {
  const len = players.length;

  for (let i = 1; i <= len; i++) {
    const idx = (fromIndex + i) % len;
    if (!players[idx].folded) return idx;
  }

  return null;
}

export function resetStreet(state: TexasInternalState) {
  state.currentBet = 0;
  state.minRaise = state.bigBlind;

  for (const p of state.players) {
    p.roundCommitted = 0;
    p.actedThisStreet = p.folded || p.allIn;
  }
}

export function recomputePot(state: TexasInternalState) {
  state.pot = state.players.reduce((sum, p) => sum + p.committed, 0);
}

export function everyoneSettledThisStreet(state: TexasInternalState): boolean {
  const contenders = state.players.filter((p) => !p.folded && !p.allIn);

  if (!contenders.length) return true;

  return contenders.every(
    (p) => p.actedThisStreet && p.roundCommitted === state.currentBet,
  );
}

export function areAllRemainingPlayersAllIn(
  state: TexasInternalState,
): boolean {
  const contenders = state.players.filter((p) => !p.folded);
  if (contenders.length <= 1) return false;
  return contenders.every((p) => p.allIn);
}

export function dealOne(state: TexasInternalState) {
  const card = state.deck.shift();
  if (!card) throw new Error('Deck exhausted');
  return card;
}

export function burnOne(state: TexasInternalState) {
  const card = dealOne(state);
  state.burnCards.push(card);
}

export function dealBoard(state: TexasInternalState, count: number) {
  burnOne(state);

  for (let i = 0; i < count; i++) {
    state.communityCards.push(dealOne(state));
  }
}

export function buildSidePots(players: TexasPlayerState[]): TexasPot[] {
  const contenders = players
    .filter((p) => p.committed > 0)
    .map((p) => ({
      seat: p.seat,
      committed: p.committed,
      eligible: !p.folded,
    }))
    .sort((a, b) => a.committed - b.committed);

  if (!contenders.length) return [];

  const levels = [...new Set(contenders.map((p) => p.committed))].sort(
    (a, b) => a - b,
  );

  const pots: TexasPot[] = [];
  let prev = 0;

  for (const level of levels) {
    const contributors = contenders.filter((p) => p.committed >= level);
    const eligibleSeats = contributors
      .filter((p) => p.eligible)
      .map((p) => p.seat)
      .sort((a, b) => a - b);

    const amount = (level - prev) * contributors.length;

    if (amount > 0 && eligibleSeats.length > 0) {
      pots.push({
        potNo: pots.length,
        amount,
        eligibleSeats,
      });
    }

    prev = level;
  }

  return pots;
}

export function getFirstToAct(
  players: TexasPlayerState[],
  dealerIndex: number,
): number {
  let idx = dealerIndex;

  while (true) {
    idx = (idx + 1) % players.length;

    const player = players[idx];

    if (!player.folded && !player.allIn) {
      return idx;
    }
  }
}

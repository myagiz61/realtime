import { randomUUID } from 'crypto';
import { SpadesCard, SpadesRank, SpadesSuit } from './spades.types';

const SUITS: SpadesSuit[] = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'];
const RANKS: SpadesRank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function createDeck(): SpadesCard[] {
  const deck: SpadesCard[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: randomUUID(),
        suit,
        rank,
      });
    }
  }

  if (deck.length !== 52) {
    throw new Error('Deck generation failed');
  }

  return deck;
}

export function shuffle(deck: SpadesCard[]): SpadesCard[] {
  const copy = [...deck];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

export function sortHand(cards: SpadesCard[]): SpadesCard[] {
  const suitOrder: Record<SpadesSuit, number> = {
    CLUBS: 1,
    DIAMONDS: 2,
    HEARTS: 3,
    SPADES: 4,
  };

  return [...cards].sort((a, b) => {
    const suitCmp = suitOrder[a.suit] - suitOrder[b.suit];
    if (suitCmp !== 0) return suitCmp;
    return a.rank - b.rank;
  });
}

export function dealHands(
  deck: SpadesCard[],
  playerCount: number,
): SpadesCard[][] {
  if (playerCount !== 4) {
    throw new Error('Spades requires exactly 4 players');
  }

  if (deck.length !== 52) {
    throw new Error('Spades deck must contain 52 cards');
  }

  const hands: SpadesCard[][] = Array.from({ length: playerCount }, () => []);

  for (let i = 0; i < deck.length; i++) {
    hands[i % playerCount].push(deck[i]);
  }

  return hands.map(sortHand);
}

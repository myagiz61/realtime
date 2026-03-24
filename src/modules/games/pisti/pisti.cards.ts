import { Card, CardSuit } from './pisti.types';

const SUITS: CardSuit[] = ['H', 'D', 'S', 'C'];

export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of SUITS) {
    for (let value = 1; value <= 13; value++) {
      deck.push({ suit, value });
    }
  }

  return deck;
}

// Production'da seeded shuffle daha iyi olur.
// Şimdilik local test için yeterli.
export function shuffle(deck: Card[]): Card[] {
  const copy = [...deck];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

export function cardLabel(card: Card): string {
  const valueMap: Record<number, string> = {
    1: 'A',
    11: 'J',
    12: 'Q',
    13: 'K',
  };

  return `${valueMap[card.value] ?? card.value}${card.suit}`;
}

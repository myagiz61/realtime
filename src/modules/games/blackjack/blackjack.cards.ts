import { Card, CardSuit } from './blackjack.types';

const SUITS: CardSuit[] = ['H', 'D', 'S', 'C'];

export function createDeck(deckCount = 6): Card[] {
  const deck: Card[] = [];

  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (let value = 1; value <= 13; value++) {
        deck.push({ suit, value });
      }
    }
  }

  return deck;
}

export function shuffle(deck: Card[]): Card[] {
  const copy = [...deck];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

export function drawOne(deck: Card[]): Card {
  const card = deck.shift();

  if (!card) {
    throw new Error('Deck is empty');
  }

  return card;
}

import { Card } from './blackjack.types';

export function getCardPoint(card: Card): number {
  if (card.value === 1) return 11;
  if (card.value >= 10) return 10;
  return card.value;
}

export function calculateHandTotal(cards: Card[]): number {
  let total = 0;
  let aceCount = 0;

  for (const card of cards) {
    total += getCardPoint(card);
    if (card.value === 1) aceCount++;
  }

  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount--;
  }

  return total;
}

export function isSoftTotal(cards: Card[]): boolean {
  let total = 0;
  let aceCount = 0;

  for (const card of cards) {
    total += getCardPoint(card);
    if (card.value === 1) aceCount++;
  }

  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount--;
  }

  // Hâlâ 11 sayılan en az bir as varsa soft'tur
  return cards.some((c) => c.value === 1) && total <= 21 && total + 10 > 21;
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && calculateHandTotal(cards) === 21;
}

export function isBust(cards: Card[]): boolean {
  return calculateHandTotal(cards) > 21;
}

export function canSplit(cards: Card[]): boolean {
  if (cards.length !== 2) return false;

  const a = cards[0];
  const b = cards[1];

  const va = a.value >= 10 ? 10 : a.value;
  const vb = b.value >= 10 ? 10 : b.value;

  return va === vb;
}

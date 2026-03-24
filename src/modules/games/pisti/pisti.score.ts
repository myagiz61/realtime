import { Card } from './pisti.types';

export type ScoreBreakdown = {
  base: number;
  pistiBonus: number;
  valePistiBonus: number;
  majorityBonus: number;
  total: number;
};

export function getCardPoint(card: Card): number {
  // As
  if (card.value === 1) return 1;

  // Vale
  if (card.value === 11) return 1;

  // Sinek 2
  if (card.value === 2 && card.suit === 'C') return 2;

  // Karo 10
  if (card.value === 10 && card.suit === 'D') return 3;

  return 0;
}

export function calculateBasePoints(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + getCardPoint(card), 0);
}

export function hasMajorityBonus(
  playerCapturedCount: number,
  allCapturedCounts: number[],
): boolean {
  const max = Math.max(...allCapturedCounts);
  const maxCount = allCapturedCounts.filter((x) => x === max).length;

  // eşitlikte bonus yok
  if (maxCount > 1) return false;

  return playerCapturedCount === max;
}

export function calculateScoreBreakdown(params: {
  cards: Card[];
  pistiCount: number;
  valePistiCount: number;
  allCapturedCounts: number[];
}): ScoreBreakdown {
  const base = calculateBasePoints(params.cards);
  const capturedCount = params.cards.length;
  const pistiBonus = params.pistiCount * 10;
  const valePistiBonus = params.valePistiCount * 20;
  const majorityBonus = hasMajorityBonus(
    capturedCount,
    params.allCapturedCounts,
  )
    ? 3
    : 0;

  return {
    base,
    pistiBonus,
    valePistiBonus,
    majorityBonus,
    total: base + pistiBonus + valePistiBonus + majorityBonus,
  };
}

export function calculateTotalScore(params: {
  cards: Card[];
  pistiCount: number;
  valePistiCount: number;
  allCapturedCounts: number[];
}): number {
  return calculateScoreBreakdown(params).total;
}

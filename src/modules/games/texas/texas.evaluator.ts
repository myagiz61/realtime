import { TexasCard, TexasPlayerState, TexasShowdownEntry } from './texas.types';

type HandCategory =
  | 'HIGH_CARD'
  | 'ONE_PAIR'
  | 'TWO_PAIR'
  | 'THREE_OF_A_KIND'
  | 'STRAIGHT'
  | 'FLUSH'
  | 'FULL_HOUSE'
  | 'FOUR_OF_A_KIND'
  | 'STRAIGHT_FLUSH'
  | 'ROYAL_FLUSH';

type EvaluatedFive = {
  category: HandCategory;
  handName: string;
  rankValue: number[];
  bestFiveCards: TexasCard[];
};

const RANK_MAP: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const CATEGORY_SCORE: Record<HandCategory, number> = {
  HIGH_CARD: 1,
  ONE_PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9,
  ROYAL_FLUSH: 10,
};

function combinations<T>(arr: T[], choose: number): T[][] {
  const result: T[][] = [];

  function walk(start: number, path: T[]) {
    if (path.length === choose) {
      result.push([...path]);
      return;
    }

    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]);
      walk(i + 1, path);
      path.pop();
    }
  }

  walk(0, []);
  return result;
}

function parseCard(card: TexasCard) {
  return {
    raw: card,
    rank: RANK_MAP[card[0]],
    suit: card[1],
  };
}

function sortDesc(nums: number[]) {
  return [...nums].sort((a, b) => b - a);
}

export function compareRankValues(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;

    if (av > bv) return 1;
    if (av < bv) return -1;
  }

  return 0;
}

function straightHigh(ranks: number[]): number | null {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);

  if (unique.includes(14)) {
    unique.push(1);
  }

  for (let i = 0; i <= unique.length - 5; i++) {
    const window = unique.slice(i, i + 5);
    let ok = true;

    for (let j = 0; j < 4; j++) {
      if (window[j] - 1 !== window[j + 1]) {
        ok = false;
        break;
      }
    }

    if (ok) return window[0] === 1 ? 5 : window[0];
  }

  return null;
}

function evaluateFive(cards: TexasCard[]): EvaluatedFive {
  const parsed = cards.map(parseCard);
  const ranks = parsed.map((c) => c.rank);
  const suits = parsed.map((c) => c.suit);

  const counts = new Map<number, number>();
  for (const r of ranks) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }

  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.rank - a.rank;
    });

  const isFlush = new Set(suits).size === 1;
  const sHigh = straightHigh(ranks);

  if (isFlush && sHigh) {
    if (sHigh === 14) {
      return {
        category: 'ROYAL_FLUSH',
        handName: 'Royal Flush',
        rankValue: [CATEGORY_SCORE.ROYAL_FLUSH],
        bestFiveCards: cards,
      };
    }

    return {
      category: 'STRAIGHT_FLUSH',
      handName: 'Straight Flush',
      rankValue: [CATEGORY_SCORE.STRAIGHT_FLUSH, sHigh],
      bestFiveCards: cards,
    };
  }

  if (groups[0].count === 4) {
    return {
      category: 'FOUR_OF_A_KIND',
      handName: 'Four of a Kind',
      rankValue: [
        CATEGORY_SCORE.FOUR_OF_A_KIND,
        groups[0].rank,
        groups[1].rank,
      ],
      bestFiveCards: cards,
    };
  }

  if (groups[0].count === 3 && groups[1].count === 2) {
    return {
      category: 'FULL_HOUSE',
      handName: 'Full House',
      rankValue: [CATEGORY_SCORE.FULL_HOUSE, groups[0].rank, groups[1].rank],
      bestFiveCards: cards,
    };
  }

  if (isFlush) {
    return {
      category: 'FLUSH',
      handName: 'Flush',
      rankValue: [CATEGORY_SCORE.FLUSH, ...sortDesc(ranks)],
      bestFiveCards: cards,
    };
  }

  if (sHigh) {
    return {
      category: 'STRAIGHT',
      handName: 'Straight',
      rankValue: [CATEGORY_SCORE.STRAIGHT, sHigh],
      bestFiveCards: cards,
    };
  }

  if (groups[0].count === 3) {
    const kickers = groups
      .slice(1)
      .map((g) => g.rank)
      .sort((a, b) => b - a);
    return {
      category: 'THREE_OF_A_KIND',
      handName: 'Three of a Kind',
      rankValue: [CATEGORY_SCORE.THREE_OF_A_KIND, groups[0].rank, ...kickers],
      bestFiveCards: cards,
    };
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
    return {
      category: 'TWO_PAIR',
      handName: 'Two Pair',
      rankValue: [CATEGORY_SCORE.TWO_PAIR, pairs[0], pairs[1], groups[2].rank],
      bestFiveCards: cards,
    };
  }

  if (groups[0].count === 2) {
    const kickers = groups
      .slice(1)
      .map((g) => g.rank)
      .sort((a, b) => b - a);
    return {
      category: 'ONE_PAIR',
      handName: 'One Pair',
      rankValue: [CATEGORY_SCORE.ONE_PAIR, groups[0].rank, ...kickers],
      bestFiveCards: cards,
    };
  }

  return {
    category: 'HIGH_CARD',
    handName: 'High Card',
    rankValue: [CATEGORY_SCORE.HIGH_CARD, ...sortDesc(ranks)],
    bestFiveCards: cards,
  };
}

export function evaluatePlayer(
  player: TexasPlayerState,
  communityCards: TexasCard[],
): TexasShowdownEntry {
  const all = [...player.cards, ...communityCards];

  if (all.length !== 7) {
    throw new Error(`Texas evaluator expected 7 cards, got ${all.length}`);
  }

  const combos = combinations(all, 5);

  let best = evaluateFive(combos[0]);

  for (let i = 1; i < combos.length; i++) {
    const current = evaluateFive(combos[i]);
    if (compareRankValues(current.rankValue, best.rankValue) > 0) {
      best = current;
    }
  }

  return {
    seat: player.seat,
    userId: player.userId,
    handName: best.handName,
    bestFiveCards: best.bestFiveCards,
    rankValue: best.rankValue,
  };
}

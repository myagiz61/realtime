import { TexasCard, TexasRank, TexasSuit } from './texas.types';

const SUITS: TexasSuit[] = ['S', 'H', 'D', 'C'];
const RANKS: TexasRank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
];

export function createDeck(): TexasCard[] {
  const deck: TexasCard[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }

  return deck;
}

export function shuffleDeck(input: TexasCard[]): TexasCard[] {
  const deck = [...input];

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

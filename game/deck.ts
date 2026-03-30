export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs' | 'joker';

export type CardValue = 
  | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 // 11=J
  | 12 // 12=Q
  | 13 // 13=K
  | 14 // 14=A
  | 2; // 2=Curinga

export interface Card {
  id: string; // Ex: '1-hearts-5' (deck 1, copas, 5)
  deck: 1 | 2;
  suit: Suit;
  value: CardValue;
  isJoker: boolean;
}

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const VALUES: CardValue[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2];

export function generateDeck(withPhysicalJokers: boolean = false): Card[] {
  const cards: Card[] = [];

  for (let d = 1; d <= 2; d++) {
    for (const suit of SUITS) {
      for (const value of VALUES) {
        cards.push({
          id: `${d}-${suit}-${value}`,
          deck: d as 1 | 2,
          suit,
          value,
          isJoker: value === 2,
        });
      }
    }
    // 2 jokers físicos por baralho = 4 no total
    if (withPhysicalJokers) {
      for (let j = 1; j <= 2; j++) {
        cards.push({
          id: `${d}-joker-${j}`,
          deck: d as 1 | 2,
          suit: 'joker',
          value: 2,
          isJoker: true,
        });
      }
    }
  }

  return cards;
}

export function shuffle(cards: Card[]): Card[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', joker: '',
};

const VALUE_LABELS: Record<number, string> = {
  2: '★', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export function cardLabel(card: Card): string {
  if (card.suit === 'joker') return '🃏';
  const val = card.value === 2 ? '2' : (VALUE_LABELS[card.value] || card.value.toString());
  return `${val}${SUIT_SYMBOLS[card.suit]}`;
}

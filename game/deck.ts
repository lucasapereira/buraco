export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

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

export function generateDeck(): Card[] {
  const cards: Card[] = [];
  
  // Criar 2 baralhos (sem os Jokers reais de 54 cartas, o buraco usa o 2 como curinga, então 52x2=104 cartas)
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
  hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠',
};

const VALUE_LABELS: Record<number, string> = {
  2: '★', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export function cardLabel(card: Card): string {
  if (card.isJoker) return '★';
  const val = VALUE_LABELS[card.value] || card.value.toString();
  return `${val}${SUIT_SYMBOLS[card.suit]}`;
}

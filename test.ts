import { validateSequence, sortGameCards, checkCanasta } from './game/rules';
import { Card } from './game/deck';

const cardsToPlay: Card[] = [
  { id: '1', deck: 1, suit: 'diamonds', value: 3, isJoker: false },
  { id: '2', deck: 1, suit: 'diamonds', value: 4, isJoker: false },
  { id: '3', deck: 1, suit: 'diamonds', value: 5, isJoker: false },
  { id: '4', deck: 1, suit: 'diamonds', value: 6, isJoker: false },
  { id: '5', deck: 1, suit: 'diamonds', value: 7, isJoker: false },
  { id: '6', deck: 1, suit: 'diamonds', value: 8, isJoker: false },
  { id: '7', deck: 1, suit: 'diamonds', value: 9, isJoker: false },
  { id: '8', deck: 1, suit: 'diamonds', value: 10, isJoker: false },
  { id: '9', deck: 1, suit: 'diamonds', value: 11, isJoker: false },
  { id: '10', deck: 1, suit: 'diamonds', value: 12, isJoker: false },
  { id: '11', deck: 1, suit: 'diamonds', value: 13, isJoker: false },
  { id: '12', deck: 1, suit: 'diamonds', value: 14, isJoker: false },
  { id: '13', deck: 1, suit: 'spades', value: 2, isJoker: true }, // Unnatural joker
  { id: '14', deck: 2, suit: 'diamonds', value: 14, isJoker: false }, // Second ace
];

console.log('Valid:', validateSequence(cardsToPlay));
const sorted = sortGameCards(cardsToPlay);
console.log('Sorted length:', sorted.length);
console.log('Sorted values:', sorted.map(c => c.value));
console.log('Canasta type:', checkCanasta(sorted));

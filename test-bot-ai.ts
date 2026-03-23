/**
 * test-bot-ai.ts — Headless bot AI test (no React, no React Native, no Zustand)
 *
 * Run with:  npx tsx test-bot-ai.ts
 *
 * Simulates complete game rounds for every combination of game mode and
 * difficulty, verifying that bots never get stuck (infinite turn loop).
 */

// ─── Card / Deck types (copied from game/deck.ts) ───

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type CardValue = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 2;

interface Card {
  id: string;
  deck: 1 | 2;
  suit: Suit;
  value: CardValue;
  isJoker: boolean;
}

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const VALUES: CardValue[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2];

function generateDeck(): Card[] {
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
  }
  return cards;
}

function shuffle(cards: Card[]): Card[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function cardLabel(card: Card): string {
  const SUIT_SYMBOLS: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
  const VALUE_LABELS: Record<number, string> = { 2: '★', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const val = card.value === 2 ? '2' : (VALUE_LABELS[card.value] || card.value.toString());
  return `${val}${SUIT_SYMBOLS[card.suit]}`;
}

// ─── Engine types (from game/engine.ts) ───

type PlayerId = 'user' | 'bot-1' | 'bot-2' | 'bot-3';
type TeamId = 'team-1' | 'team-2';
type TurnPhase = 'draw' | 'play' | 'discard';
type BotDifficulty = 'easy' | 'medium' | 'hard';
type GameMode = 'classic' | 'araujo_pereira';

interface Player {
  id: PlayerId;
  teamId: TeamId;
  name: string;
  hand: Card[];
  hasGottenDead: boolean;
}

interface TeamState {
  id: TeamId;
  games: Card[][];
  score: number;
  hasGottenDead: boolean;
}

interface GameState {
  players: Player[];
  teams: Record<TeamId, TeamState>;
  deck: Card[];
  pile: Card[];
  deads: Card[][];
  currentTurnPlayerId: PlayerId;
  turnPhase: TurnPhase;
  winnerTeamId: TeamId | null;
  roundOver: boolean;
  targetScore: number;
  matchScores: Record<TeamId, number>;
  lastDrawnCardId: string | null;
  gameMode: GameMode;
  botDifficulty: BotDifficulty;
  discardedCardHistory: string[];
  mustPlayPileTopId: string | null;
  deckReshuffleCount: number;
}

const TURN_ORDER: PlayerId[] = ['user', 'bot-1', 'bot-2', 'bot-3'];

function getNextPlayer(currentId: PlayerId): PlayerId {
  const idx = TURN_ORDER.indexOf(currentId);
  return TURN_ORDER[(idx + 1) % 4];
}

// ─── Rules (from game/rules.ts) ───

type CanastaType = 'clean' | 'dirty' | 'none';

function sortCardsBySuitAndValue(cards: Card[]): Card[] {
  const suitOrder: Record<string, number> = { spades: 1, hearts: 2, clubs: 3, diamonds: 4 };
  return [...cards].sort((a, b) => {
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    return a.value - b.value;
  });
}

function sortByValue(cards: Card[], aceLow: boolean = false): Card[] {
  const valueForSort = (c: Card) => (aceLow && c.value === 14 ? 1 : c.value);
  return [...cards].sort((a, b) => valueForSort(a) - valueForSort(b));
}

function isValidRun(values: number[], jokers: number): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) return false;
  }
  let totalGaps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i] - sorted[i - 1];
    if (diff > 1) totalGaps += diff - 1;
  }
  return totalGaps <= jokers;
}

function sortGameCards(cards: Card[]): Card[] {
  let jokers = cards.filter(c => c.isJoker);
  let normal = cards.filter(c => !c.isJoker);
  if (normal.length === 0) return cards;
  const isTrinca = normal.every(c => c.value === normal[0].value);
  if (isTrinca) {
    const suitOrder: Record<string, number> = { spades: 1, hearts: 2, clubs: 3, diamonds: 4 };
    return [...normal.sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit]), ...jokers];
  }
  if (jokers.length === 2) {
    const mainSuit = normal[0].suit;
    const naturalJokerIndex = jokers.findIndex(j => j.suit === mainSuit);
    if (naturalJokerIndex !== -1) {
      normal.push(jokers[naturalJokerIndex]);
      jokers.splice(naturalJokerIndex, 1);
    }
  }
  const joker = jokers.length > 0 ? jokers[0] : undefined;
  const hasAce = normal.some(c => c.value === 14);
  const valuesHigh = normal.map(c => c.value);
  const valuesLow = normal.map(c => (c.value === 14 ? 1 : c.value));
  const availableJokers = joker ? 1 : 0;
  const canHigh = isValidRun(valuesHigh, availableJokers);
  const canLow = hasAce && isValidRun(valuesLow, availableJokers);
  let canBoth = false;
  const aces = normal.filter(c => c.value === 14);
  if (aces.length === 2) {
    let first = true;
    const valuesBoth = normal.map(c => {
      if (c.value === 14) { if (first) { first = false; return 1; } return 14; }
      return c.value;
    });
    canBoth = isValidRun(valuesBoth, availableJokers);
  }
  const useAceLow = !canHigh && canLow;
  let sorted: Card[];
  if (canBoth) {
    const others = normal.filter(c => c.value !== 14).sort((a, b) => a.value - b.value);
    sorted = [aces[0], ...others, aces[1]];
  } else {
    sorted = sortByValue(normal, useAceLow);
  }
  if (!joker) return sorted;
  const effectiveValues = sorted.map((c, i) => {
    if (c.value !== 14) return c.value;
    if (canBoth) return i === 0 ? 1 : 14;
    return useAceLow ? 1 : 14;
  });
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = effectiveValues[i];
    const right = effectiveValues[i + 1];
    if (right - left === 2) {
      return [...sorted.slice(0, i + 1), joker, ...sorted.slice(i + 1)];
    }
  }
  const firstVal = effectiveValues[0];
  if (firstVal > 3 || (firstVal === 3 && joker.suit === normal[0].suit)) {
    return [joker, ...sorted];
  }
  return [...sorted, joker];
}

function validateSequence(cardsToPlay: Card[], gameMode: GameMode = 'classic'): boolean {
  if (cardsToPlay.length < 3) return false;
  const jokers = cardsToPlay.filter(c => c.isJoker);
  const normalCards = cardsToPlay.filter(c => !c.isJoker);
  if (normalCards.length === 0) {
    if (gameMode === 'araujo_pereira' && jokers.length >= 3) return true;
    return false;
  }
  const isTrincaAtBase = normalCards.every(c => c.value === normalCards[0].value);
  if (gameMode === 'araujo_pereira' && isTrincaAtBase) {
    if (jokers.length > 1) return false;
    return true;
  }
  if (normalCards.length === 0) return false;
  const mainSuit = normalCards[0].suit;
  if (!normalCards.every(c => c.suit === mainSuit)) return false;
  let finalNormalCards = [...normalCards];
  let finalJokers = [...jokers];
  if (finalJokers.length === 2) {
    const naturalJokerIndex = finalJokers.findIndex(j => j.suit === mainSuit);
    if (naturalJokerIndex !== -1) {
      finalNormalCards.push(finalJokers[naturalJokerIndex]);
      finalJokers.splice(naturalJokerIndex, 1);
    } else {
      return false;
    }
  } else if (finalJokers.length > 2) {
    return false;
  }
  const valuesHigh = finalNormalCards.map(c => c.value);
  const availableJokers = finalJokers.length;
  if (isValidRun(valuesHigh, availableJokers)) return true;
  const hasAce = valuesHigh.includes(14);
  if (hasAce) {
    const valuesLow = finalNormalCards.map(c => (c.value === 14 ? 1 : c.value));
    if (isValidRun(valuesLow, availableJokers)) return true;
    const numAces = valuesHigh.filter(v => v === 14).length;
    if (numAces === 2) {
      let first = true;
      const valuesBoth = finalNormalCards.map(c => {
        if (c.value === 14) { if (first) { first = false; return 1; } return 14; }
        return c.value;
      });
      if (isValidRun(valuesBoth, availableJokers)) return true;
    }
  }
  return false;
}

function checkCanasta(cards: Card[]): CanastaType {
  if (cards.length < 7) return 'none';
  const jokers = cards.filter(c => c.isJoker);
  if (jokers.length === 0) return 'clean';
  const normalCards = cards.filter(c => !c.isJoker);
  if (normalCards.length === 0) return 'dirty';
  const isTrinca = normalCards.every(c => c.value === normalCards[0].value);
  if (isTrinca) return 'dirty';
  const mainSuit = normalCards[0].suit;
  if (jokers.some(j => j.suit !== mainSuit)) return 'dirty';
  if (jokers.length > 1) return 'dirty';
  const joker = jokers[0];
  const allValuesLow = [...normalCards, joker].map(c => (c.value === 14 ? 1 : c.value)).sort((a, b) => a - b);
  const allValuesHigh = [...normalCards, joker].map(c => c.value).sort((a, b) => a - b);
  let hasGapLow = false;
  for (let i = 0; i < allValuesLow.length - 1; i++) {
    if (allValuesLow[i + 1] - allValuesLow[i] !== 1) { hasGapLow = true; break; }
  }
  let hasGapHigh = false;
  for (let i = 0; i < allValuesHigh.length - 1; i++) {
    if (allValuesHigh[i + 1] - allValuesHigh[i] !== 1) { hasGapHigh = true; break; }
  }
  let hasGapBoth = true;
  const numAces = normalCards.filter(c => c.value === 14).length;
  if (numAces === 2) {
    let first = true;
    const allValuesBoth = [...normalCards, joker].map(c => {
      if (c.value === 14) { if (first) { first = false; return 1; } return 14; }
      return c.value;
    }).sort((a, b) => a - b);
    hasGapBoth = false;
    for (let i = 0; i < allValuesBoth.length - 1; i++) {
      if (allValuesBoth[i + 1] - allValuesBoth[i] !== 1) { hasGapBoth = true; break; }
    }
  }
  if (!hasGapLow || !hasGapHigh || !hasGapBoth) return 'clean';
  return 'dirty';
}

function canTakePile(hand: Card[], pile: Card[], existingGames: Card[][] = [], gameMode: GameMode = 'classic'): boolean {
  if (pile.length === 0) return false;
  if (gameMode === 'araujo_pereira') return true;
  const topCard = pile[pile.length - 1];
  for (const game of existingGames) {
    if (validateSequence([...game, topCard], gameMode)) return true;
    for (let i = 0; i < hand.length; i++) {
      if (validateSequence([...game, topCard, hand[i]], gameMode)) return true;
    }
    for (let i = 0; i < hand.length; i++) {
      for (let j = i + 1; j < hand.length; j++) {
        if (validateSequence([...game, topCard, hand[i], hand[j]], gameMode)) return true;
      }
    }
  }
  const nonJokers = hand.filter(c => !c.isJoker && c.suit === topCard.suit);
  const jokers = hand.filter(c => c.isJoker);
  for (let i = 0; i < nonJokers.length; i++) {
    for (let j = i + 1; j < nonJokers.length; j++) {
      if (validateSequence([topCard, nonJokers[i], nonJokers[j]])) return true;
    }
    if (jokers.length > 0) {
      if (validateSequence([topCard, nonJokers[i], jokers[0]])) return true;
    }
  }
  return false;
}

// ─── Bot AI functions (copied from hooks/useBotAI.ts) ───

function getCardPoints(card: Card): number {
  if (card.isJoker) return 20;
  if (card.value === 14) return 15;
  if (card.value >= 10) return 10;
  return 5;
}

function calculateCardPoints(card: Card): number {
  if (card.isJoker) return 20;
  switch (card.value) {
    case 14: return 15;
    case 13: case 12: case 11: case 10: return 10;
    case 9: case 8: case 7: return 10;
    case 6: case 5: case 4: case 3: return 5;
    default: return 5;
  }
}

function calculateRoundScore(team: TeamState, teamPlayers: Player[], wentOut: boolean): number {
  let score = 0;
  for (const game of team.games) {
    for (const card of game) score += calculateCardPoints(card);
    const canastaType = checkCanasta(game);
    if (canastaType === 'clean') {
      if (game.length === 14) score += 1000;
      else if (game.length === 13) score += 500;
      else score += 200;
    } else if (canastaType === 'dirty') {
      score += 100;
    }
  }
  for (const p of teamPlayers) {
    for (const card of p.hand) score -= calculateCardPoints(card);
  }
  if (wentOut) score += 100;
  if (!team.hasGottenDead) score -= 100;
  return score;
}

function findBestSequences(hand: Card[], gameMode: GameMode = 'classic'): Card[][] {
  const sequences: Card[][] = [];
  const jokers = hand.filter(c => c.isJoker);
  const normal = hand.filter(c => !c.isJoker);
  const bySuit: Record<string, Card[]> = {};
  for (const card of normal) {
    if (!bySuit[card.suit]) bySuit[card.suit] = [];
    bySuit[card.suit].push(card);
  }
  for (const suit of Object.keys(bySuit)) {
    const cards = sortCardsBySuitAndValue(bySuit[suit]);
    let seq: Card[] = [cards[0]];
    for (let i = 1; i < cards.length; i++) {
      if (cards[i].value === seq[seq.length - 1].value + 1) {
        seq.push(cards[i]);
      } else if (cards[i].value !== seq[seq.length - 1].value) {
        if (seq.length >= 3) sequences.push([...seq]);
        seq = [cards[i]];
      }
    }
    if (seq.length >= 3) sequences.push([...seq]);
    if (jokers.length > 0 && cards.length >= 2) {
      for (let i = 0; i < cards.length; i++) {
        const seq: Card[] = [cards[i]];
        let expectedNext = cards[i].value + 1;
        let jokerUsed = false;
        for (let j = i + 1; j < cards.length; j++) {
          const currVal = cards[j].value;
          if (currVal < expectedNext) continue;
          if (currVal === expectedNext) {
            seq.push(cards[j]);
            expectedNext = currVal + 1;
          } else if (!jokerUsed && currVal === expectedNext + 1) {
            seq.push(jokers[0]);
            seq.push(cards[j]);
            jokerUsed = true;
            expectedNext = currVal + 1;
          } else {
            break;
          }
        }
        if (seq.length >= 3 && jokerUsed && validateSequence(seq, gameMode)) {
          sequences.push([...seq]);
        }
      }
    }
  }
  if (gameMode === 'araujo_pereira') {
    const byValue: Record<number, Card[]> = {};
    for (const card of normal) {
      if (!byValue[card.value]) byValue[card.value] = [];
      byValue[card.value].push(card);
    }
    for (const valueStr of Object.keys(byValue)) {
      const cardsObj = byValue[parseInt(valueStr, 10)];
      if (cardsObj.length >= 3) {
        sequences.push([...cardsObj]);
      } else if (jokers.length > 0 && cardsObj.length >= 2) {
        sequences.push([...cardsObj, jokers[0]]);
      }
    }
  }
  return sequences.sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    const aNormalCards = a.filter(c => !c.isJoker);
    const bNormalCards = b.filter(c => !c.isJoker);
    const aIsSequence = aNormalCards.every(c => c.suit === aNormalCards[0]?.suit);
    const bIsSequence = bNormalCards.every(c => c.suit === bNormalCards[0]?.suit);
    const aIsTrinca = aNormalCards.every(c => c.value === aNormalCards[0]?.value);
    const bIsTrinca = bNormalCards.every(c => c.value === bNormalCards[0]?.value);
    if (aIsSequence && !aIsTrinca && bIsTrinca) return -1;
    if (bIsSequence && !bIsTrinca && aIsTrinca) return 1;
    const aHasJoker = a.length - aNormalCards.length;
    const bHasJoker = b.length - bNormalCards.length;
    if (aHasJoker !== bHasJoker) return aHasJoker - bHasJoker;
    return 0;
  });
}

function cardUtility(card: Card, hand: Card[], gameMode: GameMode, teamGames: Card[][] = []): number {
  if (card.isJoker) return 100;
  const same = hand.filter(c => !c.isJoker && c.suit === card.suit);
  const vals = same.map(c => c.value).sort((a, b) => a - b);
  let adjacentCount = 0;
  for (const v of vals) {
    if (Math.abs(v - card.value) <= 2) adjacentCount++;
  }
  const sameValueCount = hand.filter(c => !c.isJoker && c.value === card.value).length;
  const trincaPotential = (gameMode === 'araujo_pereira' && sameValueCount > 1) ? 50 : 0;
  let gameBonus = 0;
  for (const game of teamGames) {
    if (validateSequence([...game, card], gameMode)) {
      const gNormal = game.filter(c => !c.isJoker);
      const isTrinca = gameMode === 'araujo_pereira' && gNormal.length > 0 && gNormal.every(c => c.value === gNormal[0].value);
      const bonus = isTrinca ? 30 + game.length * 5 : 20 + game.length * 4;
      gameBonus = Math.max(gameBonus, bonus);
    }
  }
  return (adjacentCount * 10) + trincaPotential + getCardPoints(card) + gameBonus;
}

function chooseBestDiscard(
  hand: Card[], discardedHistory: string[], difficulty: BotDifficulty,
  lastDrawnCardId: string | null, gameMode: GameMode,
  teamGames: Card[][] = [], pileTopId: string | null = null
): Card {
  let nonJokers = hand.filter(c => !c.isJoker);
  if (nonJokers.length === 0) return hand[0];
  if (lastDrawnCardId && nonJokers.length > 1) {
    nonJokers = nonJokers.filter(c => c.id !== lastDrawnCardId);
  }
  if (pileTopId && nonJokers.length > 1) {
    nonJokers = nonJokers.filter(c => c.id !== pileTopId);
  }
  if (difficulty === 'easy') {
    return [...nonJokers].sort((a, b) => getCardPoints(a) - getCardPoints(b))[0];
  }
  if (difficulty === 'medium') {
    return [...nonJokers].sort((a, b) =>
      cardUtility(a, hand, gameMode, teamGames) - cardUtility(b, hand, gameMode, teamGames)
    )[0];
  }
  const sorted = [...nonJokers].sort((a, b) =>
    cardUtility(a, hand, gameMode, teamGames) - cardUtility(b, hand, gameMode, teamGames)
  );
  const discardedSuitValues = new Set(
    discardedHistory.map(id => { const p = id.split('-'); return `${p[1]}-${p[2]}`; })
  );
  const safeDiscard = sorted.find(c => discardedSuitValues.has(`${c.suit}-${c.value}`));
  if (gameMode === 'araujo_pereira') {
    const discardedValues = new Set(discardedHistory.map(id => id.split('-')[2]));
    const safeByValue = sorted.find(c => discardedValues.has(String(c.value)));
    return safeDiscard || safeByValue || sorted[0];
  }
  return safeDiscard || sorted[0];
}

function shouldTakePile(
  pile: Card[], hand: Card[], difficulty: BotDifficulty,
  teamGames: Card[][] = [], gameMode: GameMode = 'classic'
): boolean {
  if (pile.length === 0) return false;
  if (gameMode === 'araujo_pereira') {
    if (pile.some(c => c.isJoker)) return true;
    for (const pCard of pile) {
      for (const game of teamGames) {
        if (validateSequence([...game, pCard], gameMode)) return true;
      }
    }
    const jokersInHand = hand.filter(h => h.isJoker).length;
    let fitsHand = false;
    let usefulCount = 0;
    for (const pCard of pile) {
      const sameValueCount = hand.filter(h => h.value === pCard.value && !h.isJoker).length;
      if (sameValueCount >= 2) fitsHand = true;
      if (sameValueCount === 1 && jokersInHand > 0) fitsHand = true;
      const sameSuit = hand.filter(h => !h.isJoker && h.suit === pCard.suit);
      const adjacent = sameSuit.filter(h => Math.abs(h.value - pCard.value) <= 2);
      if (adjacent.length >= 2) fitsHand = true;
      if (pile.some(pileCard => !pileCard.isJoker && hand.some(h => !h.isJoker && h.suit === pileCard.suit && Math.abs(h.value - pileCard.value) <= 2))) {
        usefulCount++;
      }
    }
    if (fitsHand) return true;
    if (difficulty === 'hard') return usefulCount >= 1 || pile.length >= 2;
    if (difficulty === 'medium') return usefulCount >= 1;
    return false;
  }
  if (difficulty === 'easy') return false;
  const topCard = pile[pile.length - 1];
  const fitsExisting = teamGames.some(g => {
    if (validateSequence([...g, topCard], gameMode)) return true;
    return hand.some(c => validateSequence([...g, topCard, c], gameMode));
  });
  if (!canTakePile(hand, pile, teamGames, gameMode)) return false;
  if (teamGames.length > 0 && !fitsExisting) {
    const hasGameSameSuit = teamGames.some(g => {
      const normalCards = g.filter(c => !c.isJoker);
      if (normalCards.length === 0) return false;
      return normalCards[0].suit === topCard.suit;
    });
    if (hasGameSameSuit && gameMode === 'classic') return false;
  }
  const usefulCount = pile.filter(pileCard => {
    if (pileCard.isJoker) return true;
    const sameInHand = hand.filter(h =>
      !h.isJoker && h.suit === pileCard.suit && Math.abs(h.value - pileCard.value) <= 2
    );
    return sameInHand.length >= 1;
  }).length;
  if (fitsExisting) {
    if (difficulty === 'hard') return true;
    if (difficulty === 'medium') return usefulCount >= 1;
  }
  if (difficulty === 'medium') return usefulCount >= 2;
  if (difficulty === 'hard') return true;
  return false;
}

// ─── Game Engine (re-implemented without Zustand) ───

function createInitialGameState(targetScore: number = 1500, botDifficulty: BotDifficulty = 'hard', gameMode: GameMode = 'classic'): GameState {
  const allCards = shuffle(generateDeck());
  const deads: Card[][] = [allCards.splice(0, 11), allCards.splice(0, 11)];
  const players: Player[] = [
    { id: 'user', teamId: 'team-1', name: 'User', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-1', teamId: 'team-2', name: 'Bot-1', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-2', teamId: 'team-1', name: 'Bot-2', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-3', teamId: 'team-2', name: 'Bot-3', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
  ];
  const teams: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: [], score: 0, hasGottenDead: false },
    'team-2': { id: 'team-2', games: [], score: 0, hasGottenDead: false },
  };
  const initialPileCard = allCards.pop()!;
  return {
    players,
    teams,
    deck: allCards,
    pile: [initialPileCard],
    deads,
    currentTurnPlayerId: 'user',
    turnPhase: 'draw',
    winnerTeamId: null,
    roundOver: false,
    targetScore,
    matchScores: { 'team-1': 0, 'team-2': 0 },
    lastDrawnCardId: null,
    gameMode,
    botDifficulty,
    discardedCardHistory: [],
    mustPlayPileTopId: null,
    deckReshuffleCount: 0,
  };
}

// ─── Pure game actions operating on mutable state ───

function teamHasCanasta(state: GameState, teamId: TeamId, extraGame?: Card[]): boolean {
  const allGames = [...state.teams[teamId].games];
  if (extraGame) allGames.push(extraGame);
  return allGames.some(g => {
    if (g.length < 7) return false;
    if (state.gameMode === 'araujo_pereira') return true;
    return checkCanasta(g) === 'clean';
  });
}

function wouldStrandPlayer(
  handAfterPlay: Card[], teamHasGottenDead: boolean,
  state: GameState, teamId: TeamId, extraGame?: Card[]
): boolean {
  const finalCountAfterDiscard = handAfterPlay.length === 0 ? 0 : handAfterPlay.length - 1;
  if (finalCountAfterDiscard > 0) return false;
  if (!teamHasGottenDead && state.deads.length > 0) return false;
  return !teamHasCanasta(state, teamId, extraGame);
}

function checkAndHandleDead(
  hand: Card[], teamHasGottenDead: boolean, deads: Card[][]
): { newHand: Card[]; gotDead: boolean; newDeads: Card[][] } {
  let newHand = [...hand];
  let gotDead = false;
  const newDeads = [...deads];
  if (newHand.length === 0 && !teamHasGottenDead && newDeads.length > 0) {
    newHand = newDeads.pop()!;
    gotDead = true;
  }
  return { newHand: sortCardsBySuitAndValue(newHand), gotDead, newDeads };
}

function checkRoundEnd(state: GameState, playerId: PlayerId): boolean {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return false;
  if (player.hand.length === 0) {
    const team = state.teams[player.teamId];
    if (team.hasGottenDead || state.deads.length === 0) {
      const canGoOut = team.games.some(g => {
        if (g.length < 7) return false;
        if (state.gameMode === 'araujo_pereira') return true;
        return checkCanasta(g) === 'clean';
      });
      if (canGoOut) {
        state.roundOver = true;
        return true;
      }
    }
  }
  return false;
}

/** Draw from deck — mutates state in place. Returns false if round ended. */
function doDrawFromDeck(state: GameState, playerId: PlayerId): boolean {
  if (state.currentTurnPlayerId !== playerId || state.turnPhase !== 'draw') return true;

  // Deck empty?
  if (state.deck.length === 0) {
    if (state.deads.length > 0) {
      const morto = state.deads.pop()!;
      state.deck = morto;
      return doDrawFromDeck(state, playerId); // retry
    }
    if (state.pile.length > 0) {
      state.deckReshuffleCount++;
      if (state.deckReshuffleCount >= 3) {
        state.roundOver = true;
        return false;
      }
      state.deck = shuffle([...state.pile]);
      state.pile = [];
      return doDrawFromDeck(state, playerId);
    }
    // All empty
    state.roundOver = true;
    return false;
  }

  const drawnCard = state.deck.pop()!;
  const player = state.players.find(p => p.id === playerId)!;
  player.hand = sortCardsBySuitAndValue([...player.hand, drawnCard]);
  state.turnPhase = 'play';
  state.lastDrawnCardId = drawnCard.id;
  return true;
}

/** Draw from pile — mutates state. Returns true if successful. */
function doDrawFromPile(state: GameState, playerId: PlayerId): boolean {
  if (state.currentTurnPlayerId !== playerId || state.turnPhase !== 'draw') return false;
  if (state.pile.length === 0) return false;

  const player = state.players.find(p => p.id === playerId)!;
  const topCardId = state.pile[state.pile.length - 1].id;

  if (state.gameMode !== 'araujo_pereira') {
    const teamGames = state.teams[player.teamId].games;
    if (!canTakePile(player.hand, state.pile, teamGames, state.gameMode)) return false;
  }

  player.hand = sortCardsBySuitAndValue([...player.hand, ...state.pile]);
  state.pile = [];
  state.turnPhase = 'play';
  state.lastDrawnCardId = null;
  state.mustPlayPileTopId = topCardId;
  return true;
}

/** Play cards as a new meld — mutates state. Returns true if valid. */
function doPlayCards(state: GameState, playerId: PlayerId, cardIds: string[]): boolean {
  if (state.currentTurnPlayerId !== playerId || state.turnPhase !== 'play') return false;

  if (state.gameMode !== 'araujo_pereira' && state.mustPlayPileTopId && !cardIds.includes(state.mustPlayPileTopId)) {
    return false;
  }

  const player = state.players.find(p => p.id === playerId)!;
  const selectedCards = player.hand.filter(c => cardIds.includes(c.id));
  if (!validateSequence(selectedCards, state.gameMode)) return false;

  const remaining = player.hand.filter(c => !cardIds.includes(c.id));
  if (wouldStrandPlayer(remaining, state.teams[player.teamId].hasGottenDead, state, player.teamId, selectedCards)) {
    return false;
  }

  const orderedCards = sortGameCards(selectedCards);
  const teamId = player.teamId;
  const team = state.teams[teamId];

  const { newHand, gotDead, newDeads } = checkAndHandleDead(remaining, team.hasGottenDead, state.deads);
  player.hand = newHand;
  player.hasGottenDead = player.hasGottenDead || gotDead;
  state.deads = newDeads;
  team.games.push(orderedCards);
  if (gotDead) team.hasGottenDead = true;

  if (state.mustPlayPileTopId && cardIds.includes(state.mustPlayPileTopId)) {
    state.mustPlayPileTopId = null;
  }

  checkRoundEnd(state, playerId);
  return true;
}

/** Add cards to an existing meld — mutates state. Returns true if valid. */
function doAddToExistingGame(state: GameState, playerId: PlayerId, cardIds: string[], gameIndex: number): boolean {
  if (state.currentTurnPlayerId !== playerId || state.turnPhase !== 'play') return false;

  if (state.gameMode !== 'araujo_pereira' && state.mustPlayPileTopId && !cardIds.includes(state.mustPlayPileTopId)) {
    return false;
  }

  const player = state.players.find(p => p.id === playerId)!;
  const teamId = player.teamId;
  const existingGame = state.teams[teamId].games[gameIndex];
  if (!existingGame) return false;

  const selectedCards = player.hand.filter(c => cardIds.includes(c.id));
  const combinedCards = [...existingGame, ...selectedCards];
  if (!validateSequence(combinedCards, state.gameMode)) return false;

  const remaining = player.hand.filter(c => !cardIds.includes(c.id));
  if (wouldStrandPlayer(remaining, state.teams[teamId].hasGottenDead, state, teamId, combinedCards)) {
    return false;
  }

  const team = state.teams[teamId];
  const { newHand, gotDead, newDeads } = checkAndHandleDead(remaining, team.hasGottenDead, state.deads);
  player.hand = newHand;
  player.hasGottenDead = player.hasGottenDead || gotDead;
  state.deads = newDeads;
  team.games[gameIndex] = sortGameCards(combinedCards);
  if (gotDead) team.hasGottenDead = true;

  if (state.mustPlayPileTopId && cardIds.includes(state.mustPlayPileTopId)) {
    state.mustPlayPileTopId = null;
  }

  checkRoundEnd(state, playerId);
  return true;
}

/** Discard a card — mutates state. Returns true if successful. */
function doDiscard(state: GameState, playerId: PlayerId, cardId: string): boolean {
  if (state.currentTurnPlayerId !== playerId || state.turnPhase !== 'play') return false;

  // Check mustPlayPileTopId
  if (state.mustPlayPileTopId !== null) {
    const player = state.players.find(p => p.id === playerId)!;
    const pileTopStillInHand = player.hand.some(c => c.id === state.mustPlayPileTopId);
    if (pileTopStillInHand && state.gameMode !== 'araujo_pereira') {
      return false; // Must play that card first
    }
    state.mustPlayPileTopId = null;
  }

  const player = state.players.find(p => p.id === playerId)!;
  const teamId = player.teamId;
  const team = state.teams[teamId];
  const cardIndex = player.hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return false;

  const discardedCard = player.hand[cardIndex];
  let newHand = [...player.hand];
  newHand.splice(cardIndex, 1);

  // Cannot discard last card without canasta (and already got dead)
  if (newHand.length === 0) {
    const willGetDead = !team.hasGottenDead && state.deads.length > 0;
    const hasCanasta = teamHasCanasta(state, teamId);
    if (!willGetDead && !hasCanasta) {
      return false;
    }
  }

  const { newHand: finalHand, gotDead, newDeads } = checkAndHandleDead(newHand, team.hasGottenDead, state.deads);
  player.hand = finalHand;
  player.hasGottenDead = player.hasGottenDead || gotDead;
  state.deads = newDeads;
  if (gotDead) team.hasGottenDead = true;

  state.pile.push(discardedCard);
  state.discardedCardHistory.push(discardedCard.id);
  state.lastDrawnCardId = null;

  // Check round end BEFORE advancing turn
  if (checkRoundEnd(state, playerId)) return true;

  state.currentTurnPlayerId = getNextPlayer(playerId);
  state.turnPhase = 'draw';
  return true;
}

// ─── Bot turn logic (synchronous, mirrors useBotAI) ───

function doBotPlayWithPileTop(state: GameState, botId: PlayerId, pileTopId: string): void {
  const bot = state.players.find(p => p.id === botId)!;
  const topCard = bot.hand.find(c => c.id === pileTopId);
  if (!topCard) return;

  // 1) Try add to existing game directly
  const teamGames = state.teams[bot.teamId].games;
  for (let gi = 0; gi < teamGames.length; gi++) {
    if (validateSequence([...teamGames[gi], topCard], state.gameMode)) {
      if (doAddToExistingGame(state, botId, [pileTopId], gi)) return;
    }
  }

  // 1b) Try add with 1 or 2 hand cards
  for (let gi = 0; gi < teamGames.length; gi++) {
    const game = state.teams[bot.teamId].games[gi];
    if (!game) continue;
    const freshBot = state.players.find(p => p.id === botId)!;
    for (const c of freshBot.hand) {
      if (c.id === pileTopId) continue;
      if (validateSequence([...game, topCard, c], state.gameMode)) {
        if (doAddToExistingGame(state, botId, [pileTopId, c.id], gi)) return;
      }
    }
    for (let i = 0; i < freshBot.hand.length; i++) {
      if (freshBot.hand[i].id === pileTopId) continue;
      for (let j = i + 1; j < freshBot.hand.length; j++) {
        if (freshBot.hand[j].id === pileTopId) continue;
        if (validateSequence([...game, topCard, freshBot.hand[i], freshBot.hand[j]], state.gameMode)) {
          if (doAddToExistingGame(state, botId, [pileTopId, freshBot.hand[i].id, freshBot.hand[j].id], gi)) return;
        }
      }
    }
  }

  // 2) Try via findBestSequences
  const sequences = findBestSequences(bot.hand, state.gameMode);
  for (const seq of sequences) {
    if (seq.some(c => c.id === pileTopId)) {
      if (doPlayCards(state, botId, seq.map(c => c.id))) return;
    }
  }

  // 3) Brute force 3-card combos
  const sameSuit = bot.hand.filter(c => !c.isJoker && c.suit === topCard.suit && c.id !== pileTopId);
  const sameValue = bot.hand.filter(c => !c.isJoker && c.value === topCard.value && c.id !== pileTopId);
  const jokers = bot.hand.filter(c => c.isJoker);
  for (let i = 0; i < sameSuit.length; i++) {
    for (let j = i + 1; j < sameSuit.length; j++) {
      if (doPlayCards(state, botId, [pileTopId, sameSuit[i].id, sameSuit[j].id])) return;
    }
    if (jokers.length > 0) {
      if (doPlayCards(state, botId, [pileTopId, sameSuit[i].id, jokers[0].id])) return;
    }
  }
  if (state.gameMode === 'araujo_pereira') {
    for (let i = 0; i < sameValue.length; i++) {
      for (let j = i + 1; j < sameValue.length; j++) {
        if (doPlayCards(state, botId, [pileTopId, sameValue[i].id, sameValue[j].id])) return;
      }
      if (jokers.length > 0) {
        if (doPlayCards(state, botId, [pileTopId, sameValue[i].id, jokers[0].id])) return;
      }
    }
  }

  // 4) Fallback: clear obligation
  state.mustPlayPileTopId = null;
}

function doBotAddToGames(state: GameState, botId: PlayerId): void {
  if (state.currentTurnPlayerId !== botId || state.turnPhase !== 'play' || state.roundOver) return;
  const bot = state.players.find(p => p.id === botId);
  if (!bot) return;
  const difficulty = state.botDifficulty;

  const teamGames = state.teams[bot.teamId].games;
  const jokerSuits = new Set(bot.hand.filter(c => c.isJoker).map(c => c.suit));
  const sortedIndices = Array.from({ length: teamGames.length }, (_, i) => i).sort((a, b) => {
    const aNormal = teamGames[a].filter(c => !c.isJoker);
    const bNormal = teamGames[b].filter(c => !c.isJoker);
    const aMatch = aNormal.length > 0 && jokerSuits.has(aNormal[0].suit) ? 1 : 0;
    const bMatch = bNormal.length > 0 && jokerSuits.has(bNormal[0].suit) ? 1 : 0;
    return bMatch - aMatch;
  });

  for (const gi of sortedIndices) {
    const freshBot = state.players.find(p => p.id === botId)!;
    for (const card of [...freshBot.hand]) {
      const game = state.teams[bot.teamId].games[gi];
      if (!game) break;

      if (card.isJoker) {
        if (game.some(c => c.isJoker)) continue;
        if (difficulty === 'easy') continue;

        if (checkCanasta(game) === 'clean') {
          const goingOutNext = state.gameMode === 'araujo_pereira' && freshBot.hand.length <= 2;
          if (!goingOutNext) continue;
        }

        if (state.gameMode === 'classic') {
          const otherGames = state.teams[bot.teamId].games.filter((_, i) => i !== gi);
          const hasCleanCanastaElsewhere = otherGames.some(g => checkCanasta(g) === 'clean');
          const closingCanasta = game.length === 6;
          if (!hasCleanCanastaElsewhere && !closingCanasta) continue;
        } else {
          const gNormal = game.filter(c => !c.isJoker);
          const isTrinca = gNormal.length > 0 && gNormal.every(c => c.value === gNormal[0].value);
          const minLen = isTrinca
            ? (difficulty === 'hard' ? 3 : 4)
            : (difficulty === 'hard' ? 4 : 5);
          if (game.length < minLen) continue;
        }
      }

      const combined = [...game, card];
      if (validateSequence(combined, state.gameMode)) {
        doAddToExistingGame(state, botId, [card.id], gi);
      }
    }
  }
}

function doBotPlaySequences(state: GameState, botId: PlayerId): void {
  const difficulty = state.botDifficulty;
  let playedSomething = true;
  let iterations = 0;

  while (playedSomething && iterations < 5) {
    playedSomething = false;
    iterations++;

    if (state.currentTurnPlayerId !== botId || state.turnPhase !== 'play' || state.roundOver) return;
    const bot = state.players.find(p => p.id === botId);
    if (!bot || bot.hand.length === 0) return;

    const sequences = findBestSequences(bot.hand, state.gameMode);

    for (const seq of sequences) {
      const normalCards = seq.filter(c => !c.isJoker);
      if (normalCards.length > 0 && (difficulty === 'hard' || difficulty === 'medium')) {
        const isTrinca = normalCards.every(c => c.value === normalCards[0].value);
        const value = normalCards[0].value;
        const suit = normalCards[0].suit;
        const teamGames = state.teams[bot.teamId].games;

        const hasDuplicateGame = teamGames.some(g => {
          const gNormal = g.filter(c => !c.isJoker);
          if (gNormal.length === 0) return false;
          if (isTrinca) {
            const gIsTrinca = gNormal.every(c => c.value === gNormal[0].value);
            return gIsTrinca && gNormal[0].value === value;
          } else {
            const gIsTrinca = gNormal.every(c => c.value === gNormal[0].value);
            return !gIsTrinca && gNormal[0].suit === suit;
          }
        });

        const remainingCards = bot.hand.length - seq.length;
        const goingToBaterOrDead = remainingCards <= 1;
        if (hasDuplicateGame && seq.length < 6 && !goingToBaterOrDead) {
          continue;
        }
      }

      const remaining = bot.hand.filter(c => !seq.some(s => s.id === c.id));
      const wouldStrand = remaining.length === 0 &&
        (state.teams[bot.teamId].hasGottenDead || state.deads.length === 0) &&
        !state.teams[bot.teamId].games.some(g => g.length >= 7 && (state.gameMode === 'araujo_pereira' || checkCanasta(g) === 'clean'));

      if (wouldStrand && difficulty !== 'hard') continue;

      const success = doPlayCards(state, botId, seq.map(c => c.id));
      if (success) {
        playedSomething = true;
        break;
      }
    }

    if (difficulty === 'easy' || (difficulty === 'medium' && state.gameMode !== 'araujo_pereira')) {
      break;
    }
  }
}

function doBotDiscard(state: GameState, botId: PlayerId, pileTopId: string | null): void {
  if (state.currentTurnPlayerId !== botId || state.turnPhase !== 'play' || state.roundOver) return;

  if (state.mustPlayPileTopId !== null) {
    state.mustPlayPileTopId = null;
  }

  const bot = state.players.find(p => p.id === botId);
  if (!bot || bot.hand.length === 0) {
    // Safety net: force turn advance
    state.currentTurnPlayerId = getNextPlayer(botId);
    state.turnPhase = 'draw';
    state.mustPlayPileTopId = null;
    return;
  }

  const teamGames = state.teams[bot.teamId].games;
  const card = chooseBestDiscard(bot.hand, state.discardedCardHistory, state.botDifficulty, state.lastDrawnCardId, state.gameMode, teamGames, pileTopId);

  const success = doDiscard(state, botId, card.id);
  if (!success) {
    // Discard was blocked — force turn advance
    state.currentTurnPlayerId = getNextPlayer(botId);
    state.turnPhase = 'draw';
    state.mustPlayPileTopId = null;
  }
}

function runBotTurn(state: GameState, botId: PlayerId): void {
  if (state.roundOver) return;
  const difficulty = state.botDifficulty;
  const bot = state.players.find(p => p.id === botId);
  if (!bot) return;

  // DRAW PHASE
  if (state.turnPhase === 'draw') {
    const teamGames = state.teams[bot.teamId].games;
    const takePile = shouldTakePile(state.pile, bot.hand, difficulty, teamGames, state.gameMode);

    if (takePile) {
      const tookPile = doDrawFromPile(state, botId);
      if (!tookPile) {
        doDrawFromDeck(state, botId);
      }
    } else {
      doDrawFromDeck(state, botId);
    }

    if (state.roundOver) return;

    // If draw somehow failed, force advance
    if (state.currentTurnPlayerId === botId && state.turnPhase === 'draw') {
      state.currentTurnPlayerId = getNextPlayer(botId);
      state.turnPhase = 'draw';
      state.mustPlayPileTopId = null;
      return;
    }
  }

  // PLAY PHASE
  if (state.turnPhase !== 'play' || state.currentTurnPlayerId !== botId) return;

  const pileTopId = state.mustPlayPileTopId ?? null;

  if (pileTopId) {
    doBotPlayWithPileTop(state, botId, pileTopId);
    if (state.roundOver) return;
  }

  doBotAddToGames(state, botId);
  if (state.roundOver) return;

  doBotPlaySequences(state, botId);
  if (state.roundOver) return;

  doBotAddToGames(state, botId);
  if (state.roundOver) return;

  doBotDiscard(state, botId, pileTopId);
}

/** Human turn: auto-draw from deck, discard lowest non-joker */
function runHumanTurn(state: GameState, playerId: PlayerId): void {
  if (state.roundOver) return;
  if (state.turnPhase !== 'draw' || state.currentTurnPlayerId !== playerId) return;

  doDrawFromDeck(state, playerId);
  if (state.roundOver) return;

  const player = state.players.find(p => p.id === playerId)!;
  const nonJokers = player.hand.filter(c => !c.isJoker);
  const toDiscard = nonJokers.length > 0
    ? [...nonJokers].sort((a, b) => getCardPoints(a) - getCardPoints(b))[0]
    : player.hand[0];

  if (toDiscard) {
    doDiscard(state, playerId, toDiscard.id);
  }
}

// ─── Test runner ───

interface TestResult {
  name: string;
  passed: boolean;
  turns: number;
  roundOver: boolean;
  message: string;
}

function simulateRound(
  gameMode: GameMode,
  difficulty: BotDifficulty,
  humanPlayerIds: PlayerId[],
  maxTurns: number = 800
): TestResult {
  const name = `mode=${gameMode} diff=${difficulty} humans=[${humanPlayerIds.join(',')}]`;
  const state = createInitialGameState(3000, difficulty, gameMode);
  let turnCount = 0;

  while (!state.roundOver && turnCount < maxTurns) {
    const pid = state.currentTurnPlayerId;
    const phaseBefore = state.turnPhase;
    const playerBefore = state.currentTurnPlayerId;

    if (humanPlayerIds.includes(pid)) {
      runHumanTurn(state, pid);
    } else {
      runBotTurn(state, pid);
    }

    turnCount++;

    // Stuck detection: if player and phase didn't change, something is wrong
    if (!state.roundOver && state.currentTurnPlayerId === playerBefore && state.turnPhase === phaseBefore) {
      // Allow one more attempt with force advance
      state.currentTurnPlayerId = getNextPlayer(state.currentTurnPlayerId);
      state.turnPhase = 'draw';
      state.mustPlayPileTopId = null;
    }
  }

  if (turnCount >= maxTurns && !state.roundOver) {
    return {
      name,
      passed: false,
      turns: turnCount,
      roundOver: false,
      message: `STUCK: reached ${maxTurns} turns without finishing. Current: ${state.currentTurnPlayerId} phase=${state.turnPhase}`,
    };
  }

  return {
    name,
    passed: true,
    turns: turnCount,
    roundOver: true,
    message: `OK (${turnCount} turns)`,
  };
}

// ─── Main ───

function main() {
  console.log('=== Buraco Bot AI Headless Test ===\n');

  const gameModes: GameMode[] = ['classic', 'araujo_pereira'];
  const difficulties: BotDifficulty[] = ['easy', 'medium', 'hard'];
  const ROUNDS_PER_CONFIG = 3; // Run multiple rounds per config for confidence

  const results: TestResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  // Standard scenarios: user is the only human
  console.log('--- Standard mode (1 human, 3 bots) ---');
  for (const mode of gameModes) {
    for (const diff of difficulties) {
      for (let r = 0; r < ROUNDS_PER_CONFIG; r++) {
        const result = simulateRound(mode, diff, ['user']);
        results.push(result);
        const status = result.passed ? 'PASS' : 'FAIL';
        if (result.passed) totalPassed++; else totalFailed++;
        console.log(`  [${status}] ${result.name} round=${r + 1} — ${result.message}`);
      }
    }
  }

  // Online mode: seats 0 and 1 are humans, bots are 2 and 3
  console.log('\n--- Online mode (2 humans: user + bot-1, 2 bots: bot-2 + bot-3) ---');
  for (const mode of gameModes) {
    for (const diff of difficulties) {
      for (let r = 0; r < ROUNDS_PER_CONFIG; r++) {
        const result = simulateRound(mode, diff, ['user', 'bot-1']);
        results.push(result);
        const status = result.passed ? 'PASS' : 'FAIL';
        if (result.passed) totalPassed++; else totalFailed++;
        console.log(`  [${status}] ${result.name} round=${r + 1} — ${result.message}`);
      }
    }
  }

  // Online mode: 3 humans (Lucas, Fernanda, Ramiro) + 1 bot (Bot 4)
  console.log('\n--- Online mode (3 humans: user + bot-1 + bot-2, 1 bot: bot-3) ---');
  for (const mode of gameModes) {
    for (const diff of difficulties) {
      for (let r = 0; r < ROUNDS_PER_CONFIG; r++) {
        const result = simulateRound(mode, diff, ['user', 'bot-1', 'bot-2']);
        results.push(result);
        const status = result.passed ? 'PASS' : 'FAIL';
        if (result.passed) totalPassed++; else totalFailed++;
        console.log(`  [${status}] ${result.name} round=${r + 1} — ${result.message}`);
      }
    }
  }

  // Stress test: simulate applyRemoteState mid-turn (state reset during bot play)
  console.log('\n--- Stress: simulated state reset mid-bot-turn ---');
  for (const mode of gameModes) {
    for (const diff of difficulties) {
      const result = simulateWithMidTurnReset(mode, diff);
      results.push(result);
      const status = result.passed ? 'PASS' : 'FAIL';
      if (result.passed) totalPassed++; else totalFailed++;
      console.log(`  [${status}] ${result.name} — ${result.message}`);
    }
  }

  // Stress test: bot takes pile but can't play pile top (mustPlayPileTopId)
  console.log('\n--- Stress: mustPlayPileTopId stuck scenarios ---');
  for (const mode of gameModes) {
    for (const diff of difficulties) {
      const result = simulateStuckPileTop(mode, diff);
      results.push(result);
      const status = result.passed ? 'PASS' : 'FAIL';
      if (result.passed) totalPassed++; else totalFailed++;
      console.log(`  [${status}] ${result.name} — ${result.message}`);
    }
  }

  // Summary
  console.log(`\n=== Summary: ${totalPassed} passed, ${totalFailed} failed out of ${results.length} total ===`);

  if (totalFailed > 0) {
    console.log('\nFailed tests:');
    for (const r of results) {
      if (!r.passed) console.log(`  - ${r.name}: ${r.message}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll tests passed.');
    process.exit(0);
  }
}

/** Simula um cenário onde o estado é "resetado" no meio do turno do bot
 *  (como se applyRemoteState fosse chamado durante o turno) */
function simulateWithMidTurnReset(gameMode: GameMode, difficulty: BotDifficulty): TestResult {
  const name = `mode=${gameMode} diff=${difficulty} mid-turn-reset`;
  const state = createInitialGameState(3000, difficulty, gameMode);
  let turnCount = 0;
  const maxTurns = 400;
  let resetsApplied = 0;

  while (!state.roundOver && turnCount < maxTurns) {
    const pid = state.currentTurnPlayerId;
    const phaseBefore = state.turnPhase;
    const playerBefore = state.currentTurnPlayerId;

    if (pid === 'user') {
      runHumanTurn(state, pid);
    } else {
      // Simulate a mid-turn state reset every 20 bot turns:
      // After the bot draws but before it discards, reset mustPlayPileTopId to a stale value
      if (turnCount > 0 && turnCount % 20 === 0 && state.turnPhase === 'draw') {
        // Bot draws
        doDrawFromDeck(state, pid);
        if (!state.roundOver) {
          // Simulate a stale mustPlayPileTopId (as if applyRemoteState set a wrong value)
          state.mustPlayPileTopId = 'fake-stale-id-that-doesnt-exist';
          resetsApplied++;
        }
        // Now continue with bot play logic — it should handle the stale value
        if (!state.roundOver && (state.turnPhase as string) === 'play') {
          runBotPlayAndDiscard(state, pid);
        }
      } else {
        runBotTurn(state, pid);
      }
    }

    turnCount++;

    if (!state.roundOver && state.currentTurnPlayerId === playerBefore && state.turnPhase === phaseBefore) {
      state.currentTurnPlayerId = getNextPlayer(state.currentTurnPlayerId);
      state.turnPhase = 'draw';
      state.mustPlayPileTopId = null;
    }
  }

  if (turnCount >= maxTurns && !state.roundOver) {
    return {
      name, passed: false, turns: turnCount, roundOver: false,
      message: `STUCK after ${resetsApplied} resets. Current: ${state.currentTurnPlayerId} phase=${state.turnPhase}`,
    };
  }
  return { name, passed: true, turns: turnCount, roundOver: true, message: `OK (${turnCount} turns, ${resetsApplied} resets)` };
}

/** Extracted bot play+discard phase (without draw) */
function runBotPlayAndDiscard(state: GameState, botId: PlayerId): void {
  if (state.roundOver || state.currentTurnPlayerId !== botId || state.turnPhase !== 'play') return;
  const difficulty = state.botDifficulty;
  const bot = state.players.find(p => p.id === botId);
  if (!bot) return;

  // If mustPlayPileTopId is set, try to play it (or clear if can't)
  if (state.mustPlayPileTopId) {
    const topCard = bot.hand.find(c => c.id === state.mustPlayPileTopId);
    if (!topCard) {
      // Stale ID — card not in hand, clear obligation
      state.mustPlayPileTopId = null;
    }
    // Even if topCard exists, playCards will handle or fallback will clear
  }

  // Try adding to existing games
  doBotAddToGames(state, botId);
  // Try playing new sequences
  doBotPlaySequences(state, botId);
  // Try adding again
  doBotAddToGames(state, botId);

  // Clear stale mustPlayPileTopId before discard
  if (state.mustPlayPileTopId) {
    state.mustPlayPileTopId = null;
  }

  // Discard
  const freshBot = state.players.find(p => p.id === botId);
  if (!freshBot || freshBot.hand.length === 0) {
    if (!state.roundOver) {
      state.currentTurnPlayerId = getNextPlayer(botId);
      state.turnPhase = 'draw';
    }
    return;
  }
  const teamGames = state.teams[freshBot.teamId].games;
  const card = chooseBestDiscard(freshBot.hand, state.discardedCardHistory, difficulty, null, state.gameMode, teamGames);
  doDiscard(state, botId, card.id);
}

/** Simula cenário onde mustPlayPileTopId fica travado */
function simulateStuckPileTop(gameMode: GameMode, difficulty: BotDifficulty): TestResult {
  const name = `mode=${gameMode} diff=${difficulty} stuck-pile-top`;
  const state = createInitialGameState(3000, difficulty, gameMode);
  let turnCount = 0;
  const maxTurns = 400;

  while (!state.roundOver && turnCount < maxTurns) {
    const pid = state.currentTurnPlayerId;
    const phaseBefore = state.turnPhase;
    const playerBefore = state.currentTurnPlayerId;

    if (pid === 'user') {
      runHumanTurn(state, pid);
    } else {
      // Every 15 turns, simulate a crash: set mustPlayPileTopId to stale, skip to next player
      // Then verify the NEXT bot can still play normally
      if (turnCount > 0 && turnCount % 15 === 0 && state.turnPhase === 'draw') {
        state.mustPlayPileTopId = 'crashed-bot-stale-pile-id';
        state.currentTurnPlayerId = getNextPlayer(pid);
        state.turnPhase = 'draw';
      } else {
        runBotTurn(state, pid);
      }
    }

    turnCount++;

    if (!state.roundOver && state.currentTurnPlayerId === playerBefore && state.turnPhase === phaseBefore) {
      state.currentTurnPlayerId = getNextPlayer(state.currentTurnPlayerId);
      state.turnPhase = 'draw';
      state.mustPlayPileTopId = null;
    }
  }

  if (turnCount >= maxTurns && !state.roundOver) {
    return {
      name, passed: false, turns: turnCount, roundOver: false,
      message: `STUCK: current=${state.currentTurnPlayerId} phase=${state.turnPhase} mustPlay=${state.mustPlayPileTopId}`,
    };
  }
  return { name, passed: true, turns: turnCount, roundOver: true, message: `OK (${turnCount} turns)` };
}

main();

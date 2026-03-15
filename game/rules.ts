import { Card } from './deck';
import { GameMode } from './engine';

export type CanastaType = 'clean' | 'dirty' | 'none';

/**
 * Ordena as cartas na mão do jogador por Naipe e depois por Valor
 */
export function sortCardsBySuitAndValue(cards: Card[]): Card[] {
  const suitOrder: Record<string, number> = { spades: 1, hearts: 2, clubs: 3, diamonds: 4 };
  return [...cards].sort((a, b) => {
    if (a.suit !== b.suit) {
      return suitOrder[a.suit] - suitOrder[b.suit];
    }
    return a.value - b.value;
  });
}

/**
 * Ordena apenas por valor (para validação de sequência)
 */
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

/**
 * Ordena cartas de um jogo já validado, posicionando o curinga
 * na lacuna correta da sequência (ex: 5♠ ★ 7♠ — não ★ 5♠ 7♠).
 */
export function sortGameCards(cards: Card[]): Card[] {
  const joker = cards.find(c => c.isJoker);
  const normal = cards.filter(c => !c.isJoker);
  if (normal.length === 0) return cards;

  const hasAce = normal.some(c => c.value === 14);
  const valuesHigh = normal.map(c => c.value);
  const valuesLow = normal.map(c => (c.value === 14 ? 1 : c.value));
  const jokers = joker ? 1 : 0;

  const canHigh = isValidRun(valuesHigh, jokers);
  const canLow = hasAce && isValidRun(valuesLow, jokers);
  const useAceLow = !canHigh && canLow;

  const sorted = sortByValue(normal, useAceLow);

  if (!joker) return sorted;

  // Encontra onde o joker encaixa (na lacuna entre dois valores)
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = useAceLow && sorted[i].value === 14 ? 1 : sorted[i].value;
    const right = useAceLow && sorted[i + 1].value === 14 ? 1 : sorted[i + 1].value;
    if (right - left === 2) {
      // Lacuna de 1 entre sorted[i] e sorted[i+1] — joker vai aqui
      return [
        ...sorted.slice(0, i + 1),
        joker,
        ...sorted.slice(i + 1),
      ];
    }
  }

  // Se não tem lacuna no meio: joker vai no início ou fim
  // Dica: se o menor valor > 3, pode ser antes; senão, no fim
  const firstVal = useAceLow && sorted[0].value === 14 ? 1 : sorted[0].value;
  if (firstVal > 3) {
    return [joker, ...sorted]; // Ex: ★ 5♠ 6♠ → curinga como 4
  }
  return [...sorted, joker]; // Ex: 5♠ 6♠ ★ → curinga como 7
}

/**
 * Valida se um conjunto de cartas forma uma sequência válida no STBL.
 *
 * Regras:
 * - Mínimo 3 cartas
 * - Mesmo naipe (exceto curingas)
 * - Valores consecutivos formando uma sequência (runs), sem trincas
 * - Máximo 1 curinga (carta com valor 2) por jogo
 * - Deck duplo: até 2 cartas com mesmo valor/naipe são permitidas DESDE QUE sejam de decks diferentes
 *   (no entanto, na mesma sequência normalmente não se repetem valores — exceto se uma delas é curinga)
 * - Na prática, como cada sequência pede valores CONSECUTIVOS e sem repetição,
 *   duas cartas de mesmo valor no mesmo jogo só são válidas se uma delas for o curinga utilizado como "2"
 * - No modo "araujo_pereira", trincas (3+ cartas do mesmo valor, naipes diferentes ou iguais) são permitidas.
 */
export function validateSequence(cardsToPlay: Card[], gameMode: GameMode = 'classic'): boolean {
  if (cardsToPlay.length < 3) return false;

  const jokers = cardsToPlay.filter(c => c.isJoker);
  const normalCards = cardsToPlay.filter(c => !c.isJoker);

  // Máximo 1 curinga por jogo
  if (jokers.length > 1) return false;
  if (normalCards.length === 0) return false;

  const mainSuit = normalCards[0].suit;
  const isSameSuit = normalCards.every(c => c.suit === mainSuit);
  const isTrinca = normalCards.every(c => c.value === normalCards[0].value);

  if (gameMode === 'araujo_pereira' && isTrinca) {
    return true; // Trinca válida
  }

  // Todas as cartas normais devem ser do mesmo naipe para sequência normal
  if (!isSameSuit) return false;

  const valuesHigh = normalCards.map(c => c.value);
  const availableJokers = jokers.length;

  if (isValidRun(valuesHigh, availableJokers)) return true;

  // Permite Ás como 1 (ex: A ★ 3 4 ...)
  const hasAce = valuesHigh.includes(14);
  if (hasAce) {
    const valuesLow = normalCards.map(c => (c.value === 14 ? 1 : c.value));
    if (isValidRun(valuesLow, availableJokers)) return true;
  }

  return false;
}

/**
 * Retorna o tipo de canasta de um jogo.
 * - clean: 7+ cartas, sem curingas
 * - dirty: 7+ cartas, com curinga
 * - none: menos de 7 cartas
 */
export function checkCanasta(cards: Card[]): CanastaType {
  if (cards.length < 7) return 'none';
  
  const jokers = cards.filter(c => c.isJoker);
  if (jokers.length === 0) return 'clean';
  
  // No STBL, se tem 2(s) do naipe correto em posição natural, a canastra pode ser limpa.
  // Mas se for trinca (mesmo valor), com curinga é sempre suja.
  const normalCards = cards.filter(c => !c.isJoker);
  if (normalCards.length === 0) return 'dirty'; // Caso improvável

  const isTrinca = normalCards.every(c => c.value === normalCards[0].value);
  if (isTrinca) return 'dirty';

  // Para sequências (mesmo naipe):
  const mainSuit = normalCards[0].suit;
  
  // Se qualquer curinga for de naipe diferente, é suja
  if (jokers.some(j => j.suit !== mainSuit)) return 'dirty';
  
  // Se tem mais de um curinga (mesmo sendo do mesmo naipe), é suja
  // No Buraco, você só pode ter um curinga por jogo, a menos que um deles seja o 2 natural.
  // Mas para simplificar e seguir a regra de "máximo 1 curinga" definida anteriormente:
  if (jokers.length > 1) return 'dirty';

  const joker = jokers[0];
  
  // Ordenar cartas normais para ver onde o 2 se encaixa
  const sortedNormal = [...normalCards].sort((a, b) => {
    const vA = a.value === 14 ? 1 : a.value;
    const vB = b.value === 14 ? 1 : b.value;
    return vA - vB;
  });

  const firstVal = sortedNormal[0].value === 14 ? 1 : sortedNormal[0].value;
  
  // Se a sequência normal não tem buracos:
  let hasGap = false;
  for (let i = 0; i < sortedNormal.length - 1; i++) {
    const v1 = sortedNormal[i].value === 14 ? 1 : sortedNormal[i].value;
    const v2 = sortedNormal[i+1].value === 14 ? 1 : sortedNormal[i+1].value;
    if (v2 - v1 !== 1 && !(v1 === 13 && sortedNormal[i+1].value === 14)) {
      hasGap = true;
      break;
    }
  }

  if (!hasGap) {
    // Se não tem buraco, o 2 está no início ou fim.
    // Natural se for J Q K A 2 (não existe, 2 é baixo) ou A 2 3 ou 2 3 4.
    // No Buraco o 2 natural fica entre o A e o 3 ou antes do 3.
    if (firstVal === 3 || (firstVal === 1 && sortedNormal[1]?.value === 3)) {
      return 'clean';
    }
  }

  return 'dirty';
}

/**
 * Verifica se uma lista de cartas pode ser adicionada a um jogo existente.
 * Mais permissiva: valida a combinação completa como uma sequência.
 */
export function canAddToGame(existingGame: Card[], newCards: Card[], gameMode: GameMode = 'classic'): boolean {
  const combined = [...existingGame, ...newCards];
  return validateSequence(combined, gameMode);
}

/**
 * Verifica se o jogador pode pegar o lixo.
 * Regra: a carta do TOPO do lixo (última da array) deve obrigatoriamente
 * fazer parte de um jogo novo formado com cartas da mão do jogador.
 */
export function canTakePile(
  hand: Card[],
  pile: Card[],
  existingGames: Card[][] = [],
  gameMode: GameMode = 'classic'
): boolean {
  if (pile.length === 0) return false;
  if (gameMode === 'araujo_pereira') return true; // Always can take in this mode

  const topCard = pile[pile.length - 1];

  // Se a carta do topo encaixa diretamente em algum jogo existente, pode pegar
  for (const game of existingGames) {
    if (validateSequence([...game, topCard], gameMode)) return true;

    // Ou encaixa junto com 1 carta da mão
    for (let i = 0; i < hand.length; i++) {
      if (validateSequence([...game, topCard, hand[i]], gameMode)) return true;
    }

    // Ou encaixa junto com 2 cartas da mão
    for (let i = 0; i < hand.length; i++) {
      for (let j = i + 1; j < hand.length; j++) {
        if (validateSequence([...game, topCard, hand[i], hand[j]], gameMode)) return true;
      }
    }
  }

  // Tenta combinar a carta do topo com 2+ cartas da mão
  const nonJokers = hand.filter(c => !c.isJoker && c.suit === topCard.suit);
  const jokers = hand.filter(c => c.isJoker);

  // Testa sequências de 3 com a carta do topo: topCard + 2 da mão
  for (let i = 0; i < nonJokers.length; i++) {
    for (let j = i + 1; j < nonJokers.length; j++) {
      if (validateSequence([topCard, nonJokers[i], nonJokers[j]])) return true;
    }
    // Com 1 curinga
    if (jokers.length > 0) {
      if (validateSequence([topCard, nonJokers[i], jokers[0]])) return true;
    }
  }
  return false;
}

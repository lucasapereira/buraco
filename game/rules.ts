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
  let jokers = cards.filter(c => c.isJoker);
  let normal = cards.filter(c => !c.isJoker);
  if (normal.length === 0) return cards;

  const isTrinca = normal.every(c => c.value === normal[0].value);
  if (isTrinca) {
    // Trinca: ordena por naipe e junta jokers no final
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
      if (c.value === 14) {
        if (first) { first = false; return 1; }
        return 14;
      }
      return c.value;
    });
    canBoth = isValidRun(valuesBoth, availableJokers);
  }

  const useAceLow = !canHigh && canLow;
  let sorted: Card[];
  
  if (canBoth) {
    const others = normal.filter(c => c.value !== 14).sort((a,b) => a.value - b.value);
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
      return [
        ...sorted.slice(0, i + 1),
        joker,
        ...sorted.slice(i + 1),
      ];
    }
  }

  const firstVal = effectiveValues[0];
  if (firstVal > 3 || (firstVal === 3 && joker.suit === normal[0].suit)) {
    return [joker, ...sorted];
  }
  return [...sorted, joker];
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

  if (normalCards.length === 0) {
    // Caso especial: trinca de 2? (raro, mas permitido em alguns modos)
    if (gameMode === 'araujo_pereira' && jokers.length >= 3) {
      return true;
    }
    return false;
  }

  // --- Caso TRINCA (Araujo Pereira) ---
  const isTrincaAtBase = normalCards.every(c => c.value === normalCards[0].value);
  if (gameMode === 'araujo_pereira' && isTrincaAtBase) {
    // Em trinca, no máximo um curinga (tipo 2 de outro naipe).
    // Nota: um '2' do mesmo valor da trinca (trinca de 2) já cairia no case acima ou seria tratado como joker aqui.
    // Mas se é trinca de 8, e tem dois 2s, é inválido no Buraco.
    if (jokers.length > 1) return false;
    return true; 
  }

  // --- Caso SEQUÊNCIA (STBL) ---
  if (normalCards.length === 0) return false;
  const mainSuit = normalCards[0].suit;

  // No STBL, todas as cartas "normais" devem ser do mesmo naipe
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

  // Permite Ás como 1 (ex: A ★ 3 4 ...)
  const hasAce = valuesHigh.includes(14);
  if (hasAce) {
    const valuesLow = finalNormalCards.map(c => (c.value === 14 ? 1 : c.value));
    if (isValidRun(valuesLow, availableJokers)) return true;
    
    // Suporta dois Ases (um como 1, outro como 14)
    const numAces = valuesHigh.filter(v => v === 14).length;
    if (numAces === 2) {
      let first = true;
      const valuesBoth = finalNormalCards.map(c => {
        if (c.value === 14) {
          if (first) { first = false; return 1; }
          return 14;
        }
        return c.value;
      });
      if (isValidRun(valuesBoth, availableJokers)) return true;
    }
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
  
  // Trata o joker como a carta natural de valor 2 para testar se há lacunas
  // AceLow mapeia o Ás para 1
  const allValuesLow = [...normalCards, joker]
    .map(c => (c.value === 14 ? 1 : c.value))
    .sort((a, b) => a - b);
    
  // allValuesHigh mantém o Ás como 14
  const allValuesHigh = [...normalCards, joker]
    .map(c => c.value)
    .sort((a, b) => a - b);

  let hasGapLow = false;
  for (let i = 0; i < allValuesLow.length - 1; i++) {
    if (allValuesLow[i + 1] - allValuesLow[i] !== 1) {
      hasGapLow = true;
      break;
    }
  }

  let hasGapHigh = false;
  for (let i = 0; i < allValuesHigh.length - 1; i++) {
    if (allValuesHigh[i + 1] - allValuesHigh[i] !== 1) {
      hasGapHigh = true;
      break;
    }
  }

  let hasGapBoth = true;
  const numAces = normalCards.filter(c => c.value === 14).length;
  if (numAces === 2) {
    let first = true;
    const allValuesBoth = [...normalCards, joker].map(c => {
      if (c.value === 14) {
        if (first) { first = false; return 1; }
        return 14;
      }
      return c.value;
    }).sort((a, b) => a - b);
    
    hasGapBoth = false;
    for (let i = 0; i < allValuesBoth.length - 1; i++) {
      if (allValuesBoth[i + 1] - allValuesBoth[i] !== 1) {
        hasGapBoth = true;
        break;
      }
    }
  }

  // Se não tem buraco quando o 2 está em sua posição natural, a canastra é limpa
  if (!hasGapLow || !hasGapHigh || !hasGapBoth) {
    return 'clean';
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

// Helpers puros para decisão do bot. Sem dependências de React Native ou store —
// reutilizáveis tanto pelo hook (useBotAI) quanto pelo harness de simulação headless.

import { Card } from './deck';
import { BotDifficulty, GameMode } from './engine';
import { canTakePile, sortCardsBySuitAndValue, validateSequence, checkCanasta } from './rules';

export function getCardPoints(card: Card): number {
  if (card.isJoker) return 20;
  if (card.value === 14) return 15;
  if (card.value >= 10) return 10;
  return 5;
}

/**
 * Verifica se adicionar um isJoker card realmente SUJA o jogo.
 * Um 2♥ adicionado a um jogo de copas na posição natural (valor 2) NÃO suja — é carta natural.
 * Coringas físicos (suit='joker') SEMPRE sujam. 2s de outro naipe SEMPRE sujam.
 */
export function wouldDirtyGame(card: Card, game: Card[]): boolean {
  if (!card.isJoker) return false;
  if (card.suit === 'joker') return true;
  const normalCards = game.filter(c => !c.isJoker);
  if (normalCards.length === 0) return true;
  if (normalCards.every(c => c.value === normalCards[0].value)) return true;
  if (card.suit === normalCards[0].suit) {
    const simulated = [...game, card];
    if (simulated.length >= 7) return checkCanasta(simulated) !== 'clean';
    const vals = simulated.map(c => c.value === 14 ? 1 : c.value).sort((a, b) => a - b);
    let consecutive = true;
    for (let i = 0; i < vals.length - 1; i++) {
      if (vals[i + 1] - vals[i] !== 1) { consecutive = false; break; }
    }
    if (consecutive) return false;
  }
  return true;
}

/**
 * Escolhe qual coringa gastar: prefere coringa físico (🃏) ao invés de 2-curinga,
 * pois o 2-curinga pode ser carta natural num jogo de seu naipe.
 */
export function pickBestJokerToSpend(jokers: Card[], teamGames: Card[][]): Card {
  const physical = jokers.find(j => j.suit === 'joker');
  if (physical) return physical;
  const gameSuits = new Set<string>();
  for (const g of teamGames) {
    const normal = g.filter(c => !c.isJoker);
    if (normal.length > 0 && normal.every(c => c.suit === normal[0].suit)) {
      gameSuits.add(normal[0].suit);
    }
  }
  const nonMatchingWild = jokers.find(j => !gameSuits.has(j.suit));
  if (nonMatchingWild) return nonMatchingWild;
  return jokers[0];
}

/**
 * Verifica se um jogo limpo (candidato a canastra limpa) tem chance REAL de chegar a 7 cartas.
 */
export function canCleanCandidateGrow(game: Card[], allTableGames: Card[][], botHand: Card[]): boolean {
  const normalCards = game.filter(c => !c.isJoker);
  if (normalCards.length === 0) return false;
  const suit = normalCards[0].suit;
  const values = normalCards.map(c => c.value).sort((a, b) => a - b);
  const minVal = values[0];
  const maxVal = values[values.length - 1];
  const cardsNeeded = 7 - game.length;
  if (cardsNeeded <= 0) return true;

  const possibleValues: number[] = [];
  for (let v = minVal - 1; v >= 3; v--) possibleValues.push(v);
  if (minVal <= 4) possibleValues.push(14);
  for (let v = maxVal + 1; v <= 14; v++) possibleValues.push(v);

  const COPIES = 2;
  const locked = new Map<number, number>();
  for (const tg of allTableGames) {
    for (const c of tg) {
      if (c.suit === suit && !c.isJoker) {
        locked.set(c.value, (locked.get(c.value) || 0) + 1);
      }
    }
  }

  const inHand = new Map<number, number>();
  for (const c of botHand) {
    if (c.suit === suit && !c.isJoker) {
      inHand.set(c.value, (inHand.get(c.value) || 0) + 1);
    }
  }

  let availableCards = 0;
  for (const v of possibleValues) {
    const onTable = locked.get(v) || 0;
    const freeCopies = Math.max(0, COPIES - onTable);
    if (freeCopies > 0) availableCards += freeCopies;
    if (availableCards >= cardsNeeded) return true;
  }
  return false;
}

/**
 * Time pode bater AGORA: canastra adequada e pegou o morto.
 * Clássico exige canastra limpa; Araujo Pereira aceita qualquer canastra.
 */
export function canTeamBater(teamGames: Card[][], gameMode: GameMode, hasGottenDead: boolean): boolean {
  if (!hasGottenDead) return false;
  return teamGames.some(g => {
    if (g.length < 7) return false;
    if (gameMode === 'araujo_pereira') return true;
    return checkCanasta(g) === 'clean';
  });
}

/** Encontra todas as sequências válidas (e trincas) possíveis dentro de uma mão. */
export function findBestSequences(hand: Card[], gameMode: GameMode = 'classic'): Card[][] {
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
      const jokerToUse = pickBestJokerToSpend(jokers, []);
      for (let i = 0; i < cards.length; i++) {
        const innerSeq: Card[] = [cards[i]];
        let expectedNext = cards[i].value + 1;
        let jokerUsed = false;
        for (let j = i + 1; j < cards.length; j++) {
          const currVal = cards[j].value;
          if (currVal < expectedNext) continue;
          if (currVal === expectedNext) {
            innerSeq.push(cards[j]);
            expectedNext = currVal + 1;
          } else if (!jokerUsed && currVal === expectedNext + 1) {
            innerSeq.push(jokerToUse);
            innerSeq.push(cards[j]);
            jokerUsed = true;
            expectedNext = currVal + 1;
          } else {
            break;
          }
        }
        if (innerSeq.length >= 3 && jokerUsed && validateSequence(innerSeq, gameMode)) {
          sequences.push([...innerSeq]);
        }

        if (cards.length >= 2) {
          const nextIdx = cards.findIndex((c, idx) => idx > i && c.value === cards[i].value + 1);
          if (nextIdx >= 0 && cards[i].value + 2 <= 14) {
            const tailSeq = [cards[i], cards[nextIdx], jokerToUse];
            if (validateSequence(tailSeq, gameMode)) sequences.push([...tailSeq]);
          }
          if (nextIdx >= 0 && cards[i].value - 1 >= 3) {
            const headSeq = [jokerToUse, cards[i], cards[nextIdx]];
            if (validateSequence(headSeq, gameMode)) sequences.push([...headSeq]);
          }
        }
      }

      const aces = cards.filter(c => c.value === 14);
      const threes = cards.filter(c => c.value === 3);
      if (aces.length > 0 && threes.length > 0) {
        const aceLowSeq = [aces[0], jokerToUse, threes[0]];
        if (validateSequence(aceLowSeq, gameMode)) sequences.push([...aceLowSeq]);
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

export function cardUtility(card: Card, hand: Card[], gameMode: GameMode, teamGames: Card[][] = []): number {
  if (card.isJoker) {
    const jokersInHand = hand.filter(c => c.isJoker).length;
    const baseValue = card.suit === 'joker' ? 110 : 100;
    return Math.max(50, baseValue - (jokersInHand - 1) * 15);
  }

  const same = hand.filter(c => !c.isJoker && c.suit === card.suit);
  const vals = same.map(c => c.value).sort((a, b) => a - b);

  let adjacentCount = 0;
  for (const v of vals) {
    if (v !== card.value && Math.abs(v - card.value) <= 2) adjacentCount++;
  }

  const sameValueCount = hand.filter(c => !c.isJoker && c.value === card.value).length;
  const trincaPotential = (gameMode === 'araujo_pereira' && sameValueCount > 1) ? 50 : 0;

  let gameBonus = 0;
  for (const game of teamGames) {
    if (validateSequence([...game, card], gameMode)) {
      const gNormal = game.filter(c => !c.isJoker);
      const isTrinca = gameMode === 'araujo_pereira' && gNormal.length > 0 && gNormal.every(c => c.value === gNormal[0].value);
      let bonus = isTrinca ? 30 + game.length * 5 : 20 + game.length * 4;
      if (game.length === 6) {
        const simulated = [...game, card];
        const canastaType = checkCanasta(simulated);
        if (canastaType === 'clean') bonus += 100;
        else if (canastaType === 'dirty') bonus += 50;
      }
      gameBonus = Math.max(gameBonus, bonus);
    }
  }

  return (adjacentCount * 10) + trincaPotential + getCardPoints(card) + gameBonus;
}

export function opponentDangerScore(card: Card, opponentGames: Card[][], gameMode: GameMode): number {
  if (card.isJoker) return 200;
  let danger = 0;
  const oppSuitsWithSeq = new Set<string>();

  for (const game of opponentGames) {
    const normal = game.filter(c => !c.isJoker);
    if (normal.length === 0) continue;
    const isSeq = normal.every(c => c.suit === normal[0].suit);
    const isTrinca = normal.every(c => c.value === normal[0].value);

    if (isSeq) oppSuitsWithSeq.add(normal[0].suit);

    if (validateSequence([...game, card], gameMode)) {
      const closeness = Math.min(game.length, 7);
      danger = Math.max(danger, 80 + closeness * 10);
      continue;
    }

    if (isSeq && normal[0].suit === card.suit) {
      const vals = normal.map(c => c.value).sort((a, b) => a - b);
      const min = vals[0];
      const max = vals[vals.length - 1];
      const nearLow = card.value >= Math.max(3, min - 2) && card.value < min;
      const nearHigh = card.value > max && card.value <= Math.min(14, max + 2);
      if (nearLow || nearHigh) danger = Math.max(danger, 40 + game.length * 3);
    }

    if (gameMode === 'araujo_pereira' && isTrinca && normal[0].value === card.value) {
      danger = Math.max(danger, 80 + game.length * 5);
    }
  }

  if (danger === 0 && oppSuitsWithSeq.has(card.suit)) danger = 12;
  return danger;
}

export function opponentRecentlyTookPile(gameLog: { type: string; playerId: string }[], opponentIds: string[]): boolean {
  const recent = gameLog.slice(-10);
  return recent.some(ev => ev.type === 'draw_pile' && opponentIds.includes(ev.playerId));
}

export function chooseBestDiscard(
  hand: Card[],
  discardedHistory: string[],
  difficulty: BotDifficulty,
  lastDrawnCardId: string | null,
  gameMode: GameMode,
  teamGames: Card[][] = [],
  pileTopId: string | null = null,
  opponentGames: Card[][] = [],
  opponentTookPileRecently: boolean = false
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

  const discardedSuitValues = new Set(
    discardedHistory.map(id => { const p = id.split('-'); return `${p[1]}-${p[2]}`; })
  );
  const discardedValues = new Set(
    discardedHistory.map(id => id.split('-')[2])
  );

  const dangerWeight = difficulty === 'hard' ? 1.0 : 0.4;
  const aggressionMultiplier = opponentTookPileRecently ? 1.25 : 1.0;
  const safeWeight = difficulty === 'hard' ? 1.0 : 0.5;

  const scored = nonJokers.map(c => {
    const util = cardUtility(c, hand, gameMode, teamGames);
    const danger = opponentDangerScore(c, opponentGames, gameMode) * dangerWeight * aggressionMultiplier;
    const sameCopyBonus = discardedSuitValues.has(`${c.suit}-${c.value}`) ? 15 * safeWeight : 0;
    const sameValueBonus = (gameMode === 'araujo_pereira' && discardedValues.has(String(c.value))) ? 8 * safeWeight : 0;
    return { card: c, score: util + danger - sameCopyBonus - sameValueBonus };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored[0].card;
}

/** Decisão heurística de pegar o lixo (baseline — conta "cartas úteis"). */
export function shouldTakePile(
  pile: Card[], hand: Card[], difficulty: BotDifficulty, teamGames: Card[][] = [], gameMode: GameMode = 'classic'
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
    let usefulCount = 0;
    let fitsHand = false;

    for (const pCard of pile) {
      const sameValueCount = hand.filter(h => h.value === pCard.value && !h.isJoker).length;
      if (sameValueCount >= 2) fitsHand = true;
      if (sameValueCount === 1 && jokersInHand > 0) fitsHand = true;

      const sameSuit = hand.filter(h => !h.isJoker && h.suit === pCard.suit);
      const adjacent = sameSuit.filter(h => Math.abs(h.value - pCard.value) <= 2);
      if (adjacent.length >= 2) fitsHand = true;

      if (!pCard.isJoker && hand.some(h => !h.isJoker && h.suit === pCard.suit && Math.abs(h.value - pCard.value) <= 2)) {
        usefulCount++;
      }
      if (pCard.isJoker) usefulCount++;
    }

    if (fitsHand) return true;
    if (difficulty === 'hard') return usefulCount >= 1 || pile.length >= 2;
    if (difficulty === 'medium') return usefulCount >= 1;
    return false;
  }

  if (difficulty === 'easy') return false;

  const topCard = pile[pile.length - 1];

  if (topCard.isJoker && canTakePile(hand, pile, teamGames, gameMode)) {
    const hasCleanCanasta = teamGames.some(g => checkCanasta(g) === 'clean');
    const isNaturalFit = teamGames.some(g => !wouldDirtyGame(topCard, g) && validateSequence([...g, topCard], gameMode));
    if (isNaturalFit) return true;

    const canFormCleanPlay = (() => {
      const suit = topCard.suit !== 'joker' ? topCard.suit : null;
      if (!suit) return false;
      const sameSuit = hand.filter(c => !c.isJoker && c.suit === suit);
      for (let i = 0; i < sameSuit.length; i++) {
        for (let j = i + 1; j < sameSuit.length; j++) {
          if (validateSequence([topCard, sameSuit[i], sameSuit[j]], gameMode)) return true;
        }
      }
      return false;
    })();
    if (canFormCleanPlay) return true;

    if (!hasCleanCanasta) {
      const hasCleanCandidate = teamGames.some(g => !g.some(c => c.isJoker) && g.length >= 4);
      if (hasCleanCandidate) return false;
      const canFormAnyPlay = (() => {
        const nonJokers = hand.filter(c => !c.isJoker);
        for (let i = 0; i < nonJokers.length; i++) {
          for (let j = i + 1; j < nonJokers.length; j++) {
            if (validateSequence([topCard, nonJokers[i], nonJokers[j]], gameMode)) return true;
          }
        }
        return false;
      })();
      return canFormAnyPlay;
    }

    const hasGoodTableTarget = teamGames.some(g => {
      if (checkCanasta(g) === 'clean') return false;
      if (g.some(c => c.isJoker)) return false;
      return validateSequence([...g, topCard], gameMode);
    });
    return hasGoodTableTarget;
  }

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
      !h.isJoker && h.suit === pileCard.suit &&
      Math.abs(h.value - pileCard.value) <= 2
    );
    return sameInHand.length >= 1;
  }).length;

  if (fitsExisting) {
    if (difficulty === 'hard') return true;
    if (difficulty === 'medium') return usefulCount >= 1;
  }

  if (difficulty === 'hard') return usefulCount >= 1 || pile.length >= 3;
  if (difficulty === 'medium') return usefulCount >= 2;
  return false;
}

// ──────────────────────────────────────────────────────────────
// ITEM #2 — pile-take com simulação 1-ply
// ──────────────────────────────────────────────────────────────

/**
 * Avalia o potencial de pontos meldáveis de uma mão + jogos na mesa.
 * - Pontos de cartas que encaixam direto em jogos do time (fechando gaps, estendendo)
 * - Pontos de sequências NOVAS que podem ser baixadas da mão
 * - Bônus agressivo por proximidade de canastra (6 cartas → +200 se for virar limpa, +100 suja)
 */
function canastaBonusValue(game: Card[]): number {
  const ct = checkCanasta(game);
  if (ct === 'none') return 0;
  if (ct === 'dirty') return 100;
  if (game.length >= 14) return 1000;
  if (game.length === 13) return 500;
  return 200;
}

function evaluateHandPotential(hand: Card[], teamGames: Card[][], gameMode: GameMode): number {
  let score = 0;

  // 1) Adições diretas a jogos existentes (valor da carta + delta de bônus de canastra).
  //    Delta cobre: 6→7 (nenhuma → clean/dirty), dirty→clean por reposicionamento de coringa
  //    em qualquer tamanho, e upgrades de clean→canastra real (13/14).
  const usedIds = new Set<string>();
  for (const game of teamGames) {
    let growingGame = [...game];
    let prevBonus = canastaBonusValue(growingGame);
    for (const c of hand) {
      if (usedIds.has(c.id)) continue;
      if (validateSequence([...growingGame, c], gameMode)) {
        score += getCardPoints(c);
        growingGame = [...growingGame, c];
        const newBonus = canastaBonusValue(growingGame);
        if (newBonus > prevBonus) score += (newBonus - prevBonus);
        prevBonus = newBonus;
        usedIds.add(c.id);
      }
    }
  }

  // 2) Novas sequências baixáveis da mão (sem reusar cartas já atribuídas acima)
  const remaining = hand.filter(c => !usedIds.has(c.id));
  const sequences = findBestSequences(remaining, gameMode);
  const seqUsed = new Set<string>();
  for (const seq of sequences) {
    if (seq.some(c => seqUsed.has(c.id))) continue;
    for (const c of seq) score += getCardPoints(c);
    // Bônus por tamanho da sequência (incentiva baixar mais, não só 3 cartas)
    if (seq.length >= 4) score += (seq.length - 3) * 15;
    for (const c of seq) seqUsed.add(c.id);
  }

  return score;
}

// ──────────────────────────────────────────────────────────────
// ITEM #1 — descarte com modelo de oponente
// ──────────────────────────────────────────────────────────────

/**
 * Estima o "calor" (probabilidade de que o oponente segure cartas úteis) de uma
 * carta candidata a descarte, baseado em pistas implícitas:
 *  - Pegou recentemente do lixo cartas do mesmo naipe / valores próximos → likely has
 *  - Descartou recentemente cartas do mesmo naipe / valor → doesn't have / doesn't want
 *
 * Retorna score ≥ 0 (maior = mais perigoso descartar essa carta).
 */
export function opponentHandHeat(
  card: Card,
  opponentPickedUp: Card[],
  opponentDiscarded: Card[],
  gameMode: GameMode
): number {
  if (card.isJoker) return 100; // coringa é sempre quente

  let heat = 0;

  // Pegou do lixo cartas do mesmo naipe com valores próximos → sequência formando
  // Peso modesto: evita dominar sobre o opponentDangerScore (baseado em melds visíveis).
  for (const pu of opponentPickedUp) {
    if (pu.isJoker) continue;
    if (pu.suit === card.suit) {
      const diff = Math.abs(pu.value - card.value);
      if (diff === 0) heat += 10;      // duplicata na mão
      else if (diff === 1) heat += 7;  // adjacente direto
      else if (diff === 2) heat += 3;  // 1 gap (coringa fecha)
    }
    if (gameMode === 'araujo_pereira' && pu.value === card.value) {
      heat += 8; // trinca
    }
  }
  heat = Math.min(heat, 40);

  // Descartou carta igual (mesmo naipe+valor) → sinal forte de não ter interesse
  const discardedExactCopy = opponentDiscarded.some(d => !d.isJoker && d.suit === card.suit && d.value === card.value);
  if (discardedExactCopy) heat -= 20;

  // Descartou carta do mesmo naipe com valor próximo → sinal de não estar coletando aquele naipe
  const discardedSameSuitNear = opponentDiscarded.some(d =>
    !d.isJoker && d.suit === card.suit && Math.abs(d.value - card.value) <= 1
  );
  if (discardedSameSuitNear) heat -= 8;

  return Math.max(0, heat);
}

/**
 * Versão "smart" de chooseBestDiscard: além da utility/danger padrão, incorpora
 * modelo de oponente (pickup + discard histories per-player) pra evitar alimentar
 * cartas que um oponente provavelmente segura.
 */
export function chooseBestDiscardSmart(
  hand: Card[],
  discardedHistory: string[],
  difficulty: BotDifficulty,
  lastDrawnCardId: string | null,
  gameMode: GameMode,
  teamGames: Card[][],
  pileTopId: string | null,
  opponentGames: Card[][],
  opponentTookPileRecently: boolean,
  opponentPickedUp: Record<string, Card[]>,
  opponentDiscarded: Record<string, Card[]>
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

  const discardedSuitValues = new Set(
    discardedHistory.map(id => { const p = id.split('-'); return `${p[1]}-${p[2]}`; })
  );
  const discardedValues = new Set(
    discardedHistory.map(id => id.split('-')[2])
  );

  const dangerWeight = difficulty === 'hard' ? 1.0 : 0.4;
  const aggressionMultiplier = opponentTookPileRecently ? 1.25 : 1.0;
  const safeWeight = difficulty === 'hard' ? 1.0 : 0.5;
  const heatWeight = difficulty === 'hard' ? 1.0 : 0.5;

  const oppIds = Object.keys(opponentPickedUp);

  const scored = nonJokers.map(c => {
    const util = cardUtility(c, hand, gameMode, teamGames);
    const danger = opponentDangerScore(c, opponentGames, gameMode) * dangerWeight * aggressionMultiplier;

    // Heat agregado por todos os oponentes (soma; assumindo independência)
    let heat = 0;
    for (const oid of oppIds) {
      heat += opponentHandHeat(c, opponentPickedUp[oid] || [], opponentDiscarded[oid] || [], gameMode);
    }
    heat *= heatWeight;

    const sameCopyBonus = discardedSuitValues.has(`${c.suit}-${c.value}`) ? 15 * safeWeight : 0;
    const sameValueBonus = (gameMode === 'araujo_pereira' && discardedValues.has(String(c.value))) ? 8 * safeWeight : 0;
    return { card: c, score: util + danger + heat - sameCopyBonus - sameValueBonus };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored[0].card;
}

/**
 * Versão "smart" de shouldTakePile: simula pegar vs não pegar e compara o potencial
 * real. Mais caro que a heurística baseline mas captura interações que a contagem
 * de "cartas úteis" ignora (fechamento de canastra, múltiplas melds habilitadas, etc).
 *
 * Mantém as regras-rígidas de mustPlay/canTakePile e a proteção de coringa do baseline —
 * só substitui a decisão final "pega ou não" pela comparação de valores.
 */
export function shouldTakePileSmart(
  pile: Card[], hand: Card[], difficulty: BotDifficulty, teamGames: Card[][] = [], gameMode: GameMode = 'classic'
): boolean {
  if (pile.length === 0) return false;

  // Regras estruturais: no clássico precisa conseguir montar jogo com o topo
  if (gameMode === 'classic') {
    const topCard = pile[pile.length - 1];
    if (!canTakePile(hand, pile, teamGames, gameMode)) return false;

    // Proteção de coringa no clássico: se pegar um coringa vai sujar candidato a canastra limpa, evita.
    if (topCard.isJoker) {
      const hasCleanCanasta = teamGames.some(g => checkCanasta(g) === 'clean');
      const isNaturalFit = teamGames.some(g => !wouldDirtyGame(topCard, g) && validateSequence([...g, topCard], gameMode));
      const canFormCleanPlay = (() => {
        const suit = topCard.suit !== 'joker' ? topCard.suit : null;
        if (!suit) return false;
        const sameSuit = hand.filter(c => !c.isJoker && c.suit === suit);
        for (let i = 0; i < sameSuit.length; i++) {
          for (let j = i + 1; j < sameSuit.length; j++) {
            if (validateSequence([topCard, sameSuit[i], sameSuit[j]], gameMode)) return true;
          }
        }
        return false;
      })();
      if (!isNaturalFit && !canFormCleanPlay && !hasCleanCanasta) {
        const hasCleanCandidate = teamGames.some(g => !g.some(c => c.isJoker) && g.length >= 4);
        if (hasCleanCandidate) return false;
      }
    }
  }

  // Comparação por potencial: avalia mão atual vs mão+lixo, escolhe se ganhar acima do threshold
  const baseline = evaluateHandPotential(hand, teamGames, gameMode);
  const withPile = evaluateHandPotential([...hand, ...pile], teamGames, gameMode);
  const delta = withPile - baseline;

  // Custo implícito de pegar lixo: mão maior = mais difícil de bater, adversário vê crescimento
  const pileSize = pile.length;
  // Threshold calibrado para competir com a heurística atual:
  // - pilhas grandes (5+ cartas): basta ganho modesto (30), pois a massa de cartas tem valor
  // - pilhas pequenas (1-2 cartas): exige ganho significativo (80+) para compensar handicap
  const threshold = Math.max(20, 90 - pileSize * 12);

  return delta >= threshold;
}

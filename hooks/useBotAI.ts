import { useEffect, useRef } from 'react';
import { AppState, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Card } from '../game/deck';
import { BotDifficulty, GameMode, PlayerId } from '../game/engine';
import { canTakePile, sortCardsBySuitAndValue, validateSequence, checkCanasta } from '../game/rules';
import { useGameStore } from '../store/gameStore';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

// ──────────────────────────────────────
// UTILITÁRIOS
// ──────────────────────────────────────

function getCardPoints(card: Card): number {
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
function wouldDirtyGame(card: Card, game: Card[]): boolean {
  if (!card.isJoker) return false; // Carta normal nunca suja
  if (card.suit === 'joker') return true; // Coringa físico sempre suja
  // Suit-2 wild: verifica se é do mesmo naipe e se encaixa como 2 natural
  const normalCards = game.filter(c => !c.isJoker);
  if (normalCards.length === 0) return true;
  // Em trincas, 2 curinga sempre suja
  if (normalCards.every(c => c.value === normalCards[0].value)) return true;
  // Em sequência: se o naipe coincide, checkCanasta vai avaliar se é limpa
  // Simulamos adicionando: se checkCanasta retorna clean, não suja
  if (card.suit === normalCards[0].suit) {
    const simulated = [...game, card];
    if (simulated.length >= 7) return checkCanasta(simulated) !== 'clean';
    // Com menos de 7, verifica se o 2 encaixa na posição natural (valor 2 consecutivo)
    const vals = simulated.map(c => c.value === 14 ? 1 : c.value).sort((a, b) => a - b);
    let consecutive = true;
    for (let i = 0; i < vals.length - 1; i++) {
      if (vals[i + 1] - vals[i] !== 1) { consecutive = false; break; }
    }
    if (consecutive) return false; // 2 natural na posição certa — não suja
  }
  return true; // Naipe diferente ou não encaixa naturalmente
}

/**
 * Escolhe qual coringa gastar: prefere coringa físico (🃏) ao invés de 2-curinga,
 * pois o 2-curinga pode ser carta natural num jogo de seu naipe.
 * Se nenhum coringa físico disponível, escolhe o 2-curinga de naipe DIFERENTE dos jogos do time.
 */
function pickBestJokerToSpend(jokers: Card[], teamGames: Card[][]): Card {
  // 1. Coringa físico primeiro (não tem valor natural em nenhum jogo)
  const physical = jokers.find(j => j.suit === 'joker');
  if (physical) return physical;
  // 2. 2-curinga cujo naipe NÃO coincide com nenhum jogo na mesa
  const gameSuits = new Set<string>();
  for (const g of teamGames) {
    const normal = g.filter(c => !c.isJoker);
    if (normal.length > 0 && normal.every(c => c.suit === normal[0].suit)) {
      gameSuits.add(normal[0].suit);
    }
  }
  const nonMatchingWild = jokers.find(j => !gameSuits.has(j.suit));
  if (nonMatchingWild) return nonMatchingWild;
  // 3. Qualquer um
  return jokers[0];
}

/**
 * Verifica se um jogo limpo (candidato a canastra limpa) tem chance REAL de chegar a 7 cartas.
 * Analisa quais cartas são necessárias para estender a sequência e quantas cópias
 * ainda estão livres (não presas em jogos na mesa de nenhum time).
 *
 * Exemplo: jogo=[5♥,6♥,7♥,8♥,9♥] precisa de +2 cartas. Candidatos: 4♥, 10♥, 3♥, J♥, etc.
 * Se ambas as cópias do 4♥ e 10♥ estão na mesa, o caminho mais curto é impossível.
 * Mas se 3♥ ou J♥ têm cópias livres, ainda é viável (precisa crescer mais).
 *
 * @param game - o jogo limpo candidato (sequência de mesmo naipe, sem coringas)
 * @param allTableGames - TODOS os jogos na mesa (ambos os times) para contar cartas "presas"
 * @param botHand - mão do bot (cartas que ele já tem disponíveis)
 * @returns true se existe caminho viável para chegar a 7+ cartas limpas
 */
function canCleanCandidateGrow(game: Card[], allTableGames: Card[][], botHand: Card[]): boolean {
  const normalCards = game.filter(c => !c.isJoker);
  if (normalCards.length === 0) return false;
  const suit = normalCards[0].suit;
  const values = normalCards.map(c => c.value).sort((a, b) => a - b);
  const minVal = values[0];
  const maxVal = values[values.length - 1];
  const cardsNeeded = 7 - game.length;
  if (cardsNeeded <= 0) return true; // Já é canastra

  // Valores que poderiam estender a sequência (consecutivos para cima e para baixo)
  const possibleValues: number[] = [];
  for (let v = minVal - 1; v >= 3; v--) possibleValues.push(v);
  if (minVal <= 4) possibleValues.push(14); // Ás como low
  for (let v = maxVal + 1; v <= 14; v++) possibleValues.push(v);

  // Deck duplo: 2 cópias de cada carta (naipe+valor)
  const COPIES = 2;

  // Conta cartas do mesmo naipe presas em jogos na mesa
  const locked = new Map<number, number>();
  for (const tg of allTableGames) {
    for (const c of tg) {
      if (c.suit === suit && !c.isJoker) {
        locked.set(c.value, (locked.get(c.value) || 0) + 1);
      }
    }
  }

  // Conta cartas do mesmo naipe na mão do bot
  const inHand = new Map<number, number>();
  for (const c of botHand) {
    if (c.suit === suit && !c.isJoker) {
      inHand.set(c.value, (inHand.get(c.value) || 0) + 1);
    }
  }

  // Para cada valor possível, calcula cópias livres (não na mesa)
  // Cartas na mão do bot são livres MAS já subtraídas das cópias totais se não estão na mesa
  let availableCards = 0;
  for (const v of possibleValues) {
    const onTable = locked.get(v) || 0;
    const heldByBot = inHand.get(v) || 0;
    // Cópias livres = total - presas na mesa. Bot já tem "heldByBot" dessas.
    // O máximo que pode conseguir é: cópias livres (inclui as da mão + deck + mãos adversárias)
    const freeCopies = Math.max(0, COPIES - onTable);
    if (freeCopies > 0) {
      // Pelo menos 1 cópia PODE existir fora da mesa (deck, mão, lixo)
      // Bot já tem certeza de "heldByBot" delas
      availableCards += freeCopies;
    }
    if (availableCards >= cardsNeeded) return true;
  }

  return false; // Não há cartas livres suficientes para completar a canastra
}

/** Encontra todas as sequências válidas (e trincas) possíveis dentro de uma mão */
function findBestSequences(hand: Card[], gameMode: GameMode = 'classic'): Card[][] {
  const sequences: Card[][] = [];
  const jokers = hand.filter(c => c.isJoker);
  const normal = hand.filter(c => !c.isJoker);

  // Por naipe
  const bySuit: Record<string, Card[]> = {};
  for (const card of normal) {
    if (!bySuit[card.suit]) bySuit[card.suit] = [];
    bySuit[card.suit].push(card);
  }

  for (const suit of Object.keys(bySuit)) {
    const cards = sortCardsBySuitAndValue(bySuit[suit]);

    // Sequências contíguas sem curinga
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

    // Sequências com 1 curinga — detecta a sequência mais longa possível
    if (jokers.length > 0 && cards.length >= 2) {
      const jokerToUse = pickBestJokerToSpend(jokers, []);
      for (let i = 0; i < cards.length; i++) {
        // --- Gap no meio: [card, ..., joker_gap, ..., card]
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
            seq.push(jokerToUse);
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

        // --- Joker no final (tail): [card, card, joker] — estende um par consecutivo
        if (cards.length >= 2) {
          const nextIdx = cards.findIndex((c, idx) => idx > i && c.value === cards[i].value + 1);
          if (nextIdx >= 0 && cards[i].value + 2 <= 14) {
            const tailSeq = [cards[i], cards[nextIdx], jokerToUse];
            if (validateSequence(tailSeq, gameMode)) {
              sequences.push([...tailSeq]);
            }
          }
          // Joker no início: [joker, card, card]
          if (nextIdx >= 0 && cards[i].value - 1 >= 3) {
            const headSeq = [jokerToUse, cards[i], cards[nextIdx]];
            if (validateSequence(headSeq, gameMode)) {
              sequences.push([...headSeq]);
            }
          }
        }
      }

      // --- Ace-low com coringa: A-joker-3 (Ás como 1, coringa como 2)
      const aces = cards.filter(c => c.value === 14);
      const threes = cards.filter(c => c.value === 3);
      if (aces.length > 0 && threes.length > 0) {
        const aceLowSeq = [aces[0], jokerToUse, threes[0]];
        if (validateSequence(aceLowSeq, gameMode)) {
          sequences.push([...aceLowSeq]);
        }
      }
    }
  }

  // Se modo araujo_pereira, achar Trincas
  if (gameMode === 'araujo_pereira') {
    const byValue: Record<number, Card[]> = {};
    for (const card of normal) {
      if (!byValue[card.value]) byValue[card.value] = [];
      byValue[card.value].push(card);
    }
    for (const valueStr of Object.keys(byValue)) {
      const cardsObj = byValue[parseInt(valueStr, 10)];
      if (cardsObj.length >= 3) {
        sequences.push([...cardsObj]); // Trinca Limpa — preferível, preserva o curinga
      } else if (jokers.length > 0 && cardsObj.length >= 2) {
        sequences.push([...cardsObj, jokers[0]]); // Trinca Suja — só se não tem limpa
      }
    }
  }

  // Ordenar do mais longo para o mais curto
  // E para mesmo tamanho, prioriza sequências ao invés de trincas, e sem curinga ao invés de com curinga
  return sequences.sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;

    // Verificações de Trinca x Sequência
    // Uma sequência normal tem naipes iguais (ignorando curinga)
    const aNormalCards = a.filter(c => !c.isJoker);
    const bNormalCards = b.filter(c => !c.isJoker);

    const aIsSequence = aNormalCards.every(c => c.suit === aNormalCards[0]?.suit);
    const bIsSequence = bNormalCards.every(c => c.suit === bNormalCards[0]?.suit);
    const aIsTrinca = aNormalCards.every(c => c.value === aNormalCards[0]?.value);
    const bIsTrinca = bNormalCards.every(c => c.value === bNormalCards[0]?.value);

    // Se um é sequência pura e o outro é trinca pura, prioriza sequência
    if (aIsSequence && !aIsTrinca && bIsTrinca) return -1;
    if (bIsSequence && !bIsTrinca && aIsTrinca) return 1;

    // Prioriza os que NÃO tem curinga
    const aHasJoker = a.length - aNormalCards.length;
    const bHasJoker = b.length - bNormalCards.length;
    if (aHasJoker !== bHasJoker) return aHasJoker - bHasJoker; // menor curinga ganha

    return 0;
  });
}

/** Avalia utilidade de uma carta para a mão (quanto vale mantê-la) */
function cardUtility(card: Card, hand: Card[], gameMode: GameMode, teamGames: Card[][] = []): number {
  if (card.isJoker) {
    // Escala valor do coringa: quanto mais coringas na mão, menos vale cada um
    const jokersInHand = hand.filter(c => c.isJoker).length;
    const baseValue = card.suit === 'joker' ? 110 : 100; // Físico vale mais (sem posição natural)
    // Diminui utilidade marginal: 1o=base, 2o=base-15, 3o=base-30...
    return Math.max(50, baseValue - (jokersInHand - 1) * 15);
  }

  const same = hand.filter(c => !c.isJoker && c.suit === card.suit);
  const vals = same.map(c => c.value).sort((a, b) => a - b);

  // Verifica se carta é adjacente a OUTRAS (potencial sequência) — exclui a própria carta
  let adjacentCount = 0;
  for (const v of vals) {
    if (v !== card.value && Math.abs(v - card.value) <= 2) adjacentCount++;
  }

  // Verifica potencial de trinca (cartas de mesmo valor)
  const sameValueCount = hand.filter(c => !c.isJoker && c.value === card.value).length;
  const trincaPotential = (gameMode === 'araujo_pereira' && sameValueCount > 1) ? 50 : 0;

  // Bônus: carta que encaixa em jogo já na mesa — escala forte perto de canastra
  let gameBonus = 0;
  for (const game of teamGames) {
    if (validateSequence([...game, card], gameMode)) {
      const gNormal = game.filter(c => !c.isJoker);
      const isTrinca = gameMode === 'araujo_pereira' && gNormal.length > 0 && gNormal.every(c => c.value === gNormal[0].value);
      let bonus = isTrinca ? 30 + game.length * 5 : 20 + game.length * 4;
      // Bônus enorme se fecha canastra (6→7 cartas)
      if (game.length === 6) {
        const simulated = [...game, card];
        const canastaType = checkCanasta(simulated);
        if (canastaType === 'clean') bonus += 100; // Canastra limpa = +200 pontos
        else if (canastaType === 'dirty') bonus += 50; // Canastra suja = +100 pontos
      }
      gameBonus = Math.max(gameBonus, bonus);
    }
  }

  return (adjacentCount * 10) + trincaPotential + getCardPoints(card) + gameBonus;
}

/** Escolhe a carta a descartar (menor utilidade) */
function chooseBestDiscard(hand: Card[], discardedHistory: string[], difficulty: BotDifficulty, lastDrawnCardId: string | null, gameMode: GameMode, teamGames: Card[][] = [], pileTopId: string | null = null): Card {
  let nonJokers = hand.filter(c => !c.isJoker);
  if (nonJokers.length === 0) return hand[0]; // Só tem curinga

  // Evita descartar a carta que acabou de comprar, se tiver outras opções
  if (lastDrawnCardId && nonJokers.length > 1) {
    nonJokers = nonJokers.filter(c => c.id !== lastDrawnCardId);
  }

  // Evita descartar o topo do lixo que acabou de pegar (seria devolver ao lixo)
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

  // Difícil: menor utilidade + preferência por descartar naipe/valor já descartado
  const sorted = [...nonJokers].sort((a, b) =>
    cardUtility(a, hand, gameMode, teamGames) - cardUtility(b, hand, gameMode, teamGames)
  );

  // Deck duplo: compara por naipe+valor (não por ID) — descarte da cópia 1 torna cópia 2 "segura"
  const discardedSuitValues = new Set(
    discardedHistory.map(id => { const p = id.split('-'); return `${p[1]}-${p[2]}`; })
  );
  const safeDiscard = sorted.find(c => discardedSuitValues.has(`${c.suit}-${c.value}`));

  // Buraco Mole: também verifica por VALOR (trincas não dependem de naipe)
  // Descartar um 7 é mais seguro se outro 7 (qualquer naipe) já apareceu no lixo
  if (gameMode === 'araujo_pereira') {
    const discardedValues = new Set(
      discardedHistory.map(id => id.split('-')[2])
    );
    const safeByValue = sorted.find(c => discardedValues.has(String(c.value)));
    return safeDiscard || safeByValue || sorted[0];
  }

  return safeDiscard || sorted[0];
}

/** Avalia se vale a pena pegar o lixo (respeitando a regra obrigatória) */
function shouldTakePile(
  pile: Card[], hand: Card[], difficulty: BotDifficulty, teamGames: Card[][] = [], gameMode: GameMode = 'classic'
): boolean {
  if (pile.length === 0) return false;

  if (gameMode === 'araujo_pereira') {
    // Se o lixo tem um curinga, pega com certeza.
    if (pile.some(c => c.isJoker)) return true;

    // Se o lixo tem alguma carta que encaixa em jogos na mesa, pega.
    for (const pCard of pile) {
      for (const game of teamGames) {
        if (validateSequence([...game, pCard], gameMode)) return true; // encaixa
      }
    }

    // Verifica utilidade imediata para a mão
    const jokersInHand = hand.filter(h => h.isJoker).length;
    let usefulCount = 0;
    let fitsHand = false;

    for (const pCard of pile) {
      // Tem pelo menos duas cartas iguais na mão? (formaria trinca limpa)
      const sameValueCount = hand.filter(h => h.value === pCard.value && !h.isJoker).length;
      if (sameValueCount >= 2) fitsHand = true;
      // Tem uma igual e um curinga na mão? (formaria trinca suja)
      if (sameValueCount === 1 && jokersInHand > 0) fitsHand = true;

      // Formaria sequência normal?
      const sameSuit = hand.filter(h => !h.isJoker && h.suit === pCard.suit);
      const adjacent = sameSuit.filter(h => Math.abs(h.value - pCard.value) <= 2);
      if (adjacent.length >= 2) fitsHand = true;

      // Conta utilidade desta carta do lixo especificamente
      if (!pCard.isJoker && hand.some(h => !h.isJoker && h.suit === pCard.suit && Math.abs(h.value - pCard.value) <= 2)) {
        usefulCount++;
      }
      if (pCard.isJoker) usefulCount++; // Curinga no lixo sempre é útil
    }

    if (fitsHand) return true;
    // Hard pega lixo se tem carta útil OU se o lixo é grande (mais opções)
    // Evita pegar lixo de 1 carta inútil que só polui a mão
    if (difficulty === 'hard') return usefulCount >= 1 || pile.length >= 2;
    if (difficulty === 'medium') return usefulCount >= 1;

    return false;
  }

  if (difficulty === 'easy') return false; // Fácil nunca pega lixo

  const topCard = pile[pile.length - 1];

  // Se o topo do lixo é um coringa, é extremamente valioso — prioriza pegar
  if (topCard.isJoker && canTakePile(hand, pile, teamGames, gameMode)) return true;

  // Encaixe direto OU com carta da mão preenchendo lacuna (consistente com canTakePile)
  const fitsExisting = teamGames.some(g => {
    if (validateSequence([...g, topCard], gameMode)) return true;
    return hand.some(c => validateSequence([...g, topCard, c], gameMode));
  });

  // REGRA: só pode pegar se consegue montar jogo com o topo
  if (!canTakePile(hand, pile, teamGames, gameMode)) return false;

  // Evita pegar lixo só para criar jogo de naipe duplicado (sem benefício ao jogo existente)
  if (teamGames.length > 0 && !fitsExisting) {
    const hasGameSameSuit = teamGames.some(g => {
      const normalCards = g.filter(c => !c.isJoker);
      if (normalCards.length === 0) return false;
      return normalCards[0].suit === topCard.suit;
    });
    if (hasGameSameSuit && gameMode === 'classic') return false;
  }

  // Conta quantas cartas do lixo são úteis para a mão
  const usefulCount = pile.filter(pileCard => {
    if (pileCard.isJoker) return true;
    const sameInHand = hand.filter(h =>
      !h.isJoker && h.suit === pileCard.suit &&
      Math.abs(h.value - pileCard.value) <= 2
    );
    return sameInHand.length >= 1;
  }).length;

  // Se encaixa em jogo existente
  if (fitsExisting) {
    if (difficulty === 'hard') return true;
    if (difficulty === 'medium') return usefulCount >= 1;
  }

  // Hard: com 12 coringas no jogo, ser mais seletivo para não queimar coringas formando jogos fracos
  // Só pega se o lixo tem pelo menos 2 cartas úteis ou o lixo é grande (3+)
  if (difficulty === 'hard') return usefulCount >= 2 || pile.length >= 3;
  if (difficulty === 'medium') return usefulCount >= 2;
  return false;
}

// ──────────────────────────────────────
// HOOK PRINCIPAL
// ──────────────────────────────────────

export function useBotAI(options: { disabled?: boolean; humanPlayerIds?: string[]; isOnline?: boolean } = {}) {
  const roundOver = useGameStore(s => s.roundOver);
  const botRunningRef = useRef(false);
  const lastActionTimeRef = useRef<number>(Date.now());

  // Atualiza o timer de AFK a cada nova ação registrada no jogo
  const lastEventId = useGameStore(s => s.gameLog[s.gameLog.length - 1]?.id);
  useEffect(() => {
    lastActionTimeRef.current = Date.now();
  }, [lastEventId, options.isOnline]);

  // Reseta o timer de AFK quando muda o turno (evita que espera no lobby conte como AFK)
  const currentTurnPlayerId = useGameStore(s => s.currentTurnPlayerId);
  useEffect(() => {
    lastActionTimeRef.current = Date.now();
  }, [currentTurnPlayerId]);

  // ── Efeito principal: dispara o bot quando muda o jogador/fase ──
  useEffect(() => {
    if (options.disabled) return;
    const s = useGameStore.getState();
    const botId = s.currentTurnPlayerId;
    const humanIds = options.humanPlayerIds ?? ['user'];
    if (humanIds.includes(botId) || roundOver) return;

    const timer = setTimeout(() => {
      if (botRunningRef.current) return; // Mesmo bot já rodando (re-fire do turnPhase change)
      botRunningRef.current = true;
      runBotTurnAsync(botId).finally(() => { botRunningRef.current = false; });
    }, 500);

    return () => clearTimeout(timer);
  }, [useGameStore(s => s.currentTurnPlayerId), useGameStore(s => s.turnPhase), roundOver]);

  // ── Watchdog: detecta bot travado e reinicia (cobre app voltando do background, etc) ──
  useEffect(() => {
    if (options.disabled) return;

    const checkStuckBot = () => {
      const s = useGameStore.getState();
      if (s.roundOver) return;
      const humanIds = options.humanPlayerIds ?? ['user'];
      const isHuman = humanIds.includes(s.currentTurnPlayerId);
      
      if (isHuman) {
        // AFK Timeout: Se o humano não jogar por 30 segundos, o bot assume o resto do turno dele.
        // Apenas válido para o modo online! Em modo offline, os humanos têm tempo ilimitado.
        if (options.isOnline && Date.now() - lastActionTimeRef.current > 30000) {
          if (!botRunningRef.current) {
            botRunningRef.current = true;
            runBotTurnAsync(s.currentTurnPlayerId).finally(() => { botRunningRef.current = false; });
          }
        }
        return;
      }

      // É turno de um bot — se ninguém está rodando, dispara
      if (!botRunningRef.current) {
        botRunningRef.current = true;
        runBotTurnAsync(s.currentTurnPlayerId).finally(() => { botRunningRef.current = false; });
      }
    };

    // Verifica a cada 2 segundos o status da mesa
    const watchdog = setInterval(checkStuckBot, 2000);

    // Quando o app volta do background, verifica imediatamente
    const appStateListener = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        setTimeout(checkStuckBot, 500);
      }
    });

    return () => {
      clearInterval(watchdog);
      appStateListener.remove();
    };
  }, [options.disabled, options.humanPlayerIds?.join(','), roundOver]);

  async function runBotTurnAsync(botId: PlayerId) {
    const s = useGameStore.getState();
    if (s.currentTurnPlayerId !== botId || s.roundOver) {
      return;
    }

    const difficulty = s.botDifficulty;
    const bot = s.players.find(p => p.id === botId);
    if (!bot) return;

    try {
      // ── FASE DRAW ──
      if (s.turnPhase === 'draw') {
        await delay(1500); // Tempo para o bot "pensar" na mesa

        // Re-valida com estado fresco (pode ter mudado durante o delay via applyRemoteState)
        const fresh = useGameStore.getState();
        if (fresh.currentTurnPlayerId !== botId || fresh.turnPhase !== 'draw' || fresh.roundOver) {
          return; // Estado mudou — o useEffect vai tratar o novo estado
        }

        const freshBot = fresh.players.find(p => p.id === botId);
        if (!freshBot) return;
        const pile = fresh.pile;
        const teamGames = fresh.teams[freshBot.teamId].games;
        const takePile = shouldTakePile(pile, freshBot.hand, difficulty, teamGames, fresh.gameMode);

        animate(); // Animação de compra
        if (takePile) {
          const tookPile = useGameStore.getState().drawFromPile(botId);
          if (!tookPile) {
            // Lixo não pôde ser pego (condição mudou) — compra do monte como fallback
            useGameStore.getState().drawFromDeck(botId);
          }
        } else {
          useGameStore.getState().drawFromDeck(botId);
        }

        // Verifica se a compra realmente avançou a fase (pode falhar silenciosamente em modo online)
        const afterDraw = useGameStore.getState();
        if (afterDraw.currentTurnPlayerId === botId && afterDraw.turnPhase === 'draw' && !afterDraw.roundOver) {
          // Compra falhou — força avanço de turno para não travar
          const { getNextPlayer } = require('../game/engine');
          const botName = afterDraw.players.find(p => p.id === botId)?.name ?? botId;
          useGameStore.setState(prev => ({
            currentTurnPlayerId: getNextPlayer(botId),
            turnPhase: 'draw' as const,
            mustPlayPileTopId: null,
            gameLog: [...prev.gameLog.slice(-19), {
              id: Date.now(),
              playerId: botId,
              playerName: botName,
              type: 'draw_deck' as const,
              message: `${botName} passou o turno (sync)`,
              timestamp: Date.now(),
            }],
          }));
          return;
        }

        await delay(800); // Pausa depois curinha para olhar a mão
        await doBotPlayAsync(botId);
        return;
      }

      if (s.turnPhase === 'play') {
        // Com o botRunningRef, a dupla execução já é prevenida.
        // Se chegou aqui com mustPlayPileTopId setado, significa que a instância
        // original (draw phase) falhou. Processa normalmente para recuperar.
        await doBotPlayAsync(botId);
      }
    } catch (e: any) {
      console.error('Bot turn failed:', e);
      // Failsafe absoluto: Emite notificação e repassa o turno forçadamente.
      useGameStore.setState(s => ({
        gameLog: [...s.gameLog.slice(-19), {
          id: Date.now(),
          playerId: botId,
          playerName: 'SYS',
          type: 'round_end',
          message: `CRASH BOT AI: ${e?.message || 'Erro Desconhecido'}`,
          timestamp: Date.now()
        }],
        currentTurnPlayerId: require('../game/engine').getNextPlayer(botId),
        turnPhase: 'draw' as const,
        mustPlayPileTopId: null, // Limpa obrigação para não travar turnos futuros
      }));
    }
  }

  async function doBotPlayAsync(botId: PlayerId) {
    const s = useGameStore.getState();
    if (s.currentTurnPlayerId !== botId || s.turnPhase !== 'play' || s.roundOver) {
      return;
    }

    const difficulty = s.botDifficulty;

    // Captura o topo do lixo ANTES de qualquer jogada (pode ser limpo depois)
    const pileTopId = s.mustPlayPileTopId ?? null;

    // Se pegou do lixo, PRIMEIRO deve jogar um jogo com o topo
    if (pileTopId) {
      await doBotPlayWithPileTop(botId, pileTopId);
      await delay(800);
    }

    // Tenta adicionar a jogos existentes PRIMEIRO (para não matar canastras)
    await doBotAddToGamesAsync(botId);

    // Tenta baixar jogos adicionais
    await doBotPlaySequencesAsync(botId, difficulty);

    // Como as sequências podem ter liberado cartas, tenta adicionar novamente
    await doBotAddToGamesAsync(botId);

    // Descarta (só funciona se mustPlayPileTopId foi limpo)
    await delay(1000); // tempo de respiro longo antes de passar o "BEM!"
    doBotDiscard(botId, pileTopId);
  }

  /** Força jogar uma sequência que inclua o topo do lixo */
  async function doBotPlayWithPileTop(botId: PlayerId, pileTopId: string) {
    const s = useGameStore.getState();
    const bot = s.players.find(p => p.id === botId);
    if (!bot) return;

    const topCard = bot.hand.find(c => c.id === pileTopId);
    if (!topCard) return;

    // 1) Tenta ADICIONAR a um jogo existente (topo encaixa diretamente)
    const teamGames = s.teams[bot.teamId].games;
    for (let gi = 0; gi < teamGames.length; gi++) {
      if (validateSequence([...teamGames[gi], topCard], s.gameMode)) {
        animate();
        if (useGameStore.getState().addToExistingGame(botId, [pileTopId], gi)) return;
      }
    }

    // 1b) Tenta ADICIONAR com topCard + carta(s) da mão para preencher lacuna no jogo existente
    //     Ex: mesa=[3,4,5], mão=[6], topo=7 → addToExistingGame([6,7], jogo[3,4,5])
    for (let gi = 0; gi < teamGames.length; gi++) {
      const freshState = useGameStore.getState();
      const game = freshState.teams[bot.teamId].games[gi];
      if (!game) continue;
      const freshBot = freshState.players.find(p => p.id === botId);
      if (!freshBot) return;

      // Com 1 carta da mão
      for (const c of freshBot.hand) {
        if (c.id === pileTopId) continue;
        if (validateSequence([...game, topCard, c], freshState.gameMode)) {
          animate();
          if (useGameStore.getState().addToExistingGame(botId, [pileTopId, c.id], gi)) return;
        }
      }
      // Com 2 cartas da mão
      for (let i = 0; i < freshBot.hand.length; i++) {
        if (freshBot.hand[i].id === pileTopId) continue;
        for (let j = i + 1; j < freshBot.hand.length; j++) {
          if (freshBot.hand[j].id === pileTopId) continue;
          if (validateSequence([...game, topCard, freshBot.hand[i], freshBot.hand[j]], freshState.gameMode)) {
            animate();
            if (useGameStore.getState().addToExistingGame(botId, [pileTopId, freshBot.hand[i].id, freshBot.hand[j].id], gi)) return;
          }
        }
      }
    }

    // 2) Tenta via findBestSequences (novo jogo)
    const sequences = findBestSequences(bot.hand, s.gameMode);
    for (const seq of sequences) {
      if (seq.some(c => c.id === pileTopId)) {
        animate();
        if (useGameStore.getState().playCards(botId, seq.map(c => c.id))) return;
      }
    }

    // 3) Tenta combinações brutas de 3 cartas com o topo
    const sameSuit = bot.hand.filter(c => !c.isJoker && c.suit === topCard.suit && c.id !== pileTopId);
    const sameValue = bot.hand.filter(c => !c.isJoker && c.value === topCard.value && c.id !== pileTopId);
    const jokers = bot.hand.filter(c => c.isJoker);

    // Tenta sequência do mesmo naipe
    for (let i = 0; i < sameSuit.length; i++) {
      for (let j = i + 1; j < sameSuit.length; j++) {
        animate();
        if (useGameStore.getState().playCards(botId, [pileTopId, sameSuit[i].id, sameSuit[j].id])) return;
      }
      if (jokers.length > 0) {
        animate();
        if (useGameStore.getState().playCards(botId, [pileTopId, sameSuit[i].id, jokers[0].id])) return;
      }
    }

    // Tenta trinca do mesmo valor (Araujo Pereira)
    if (s.gameMode === 'araujo_pereira') {
      for (let i = 0; i < sameValue.length; i++) {
        for (let j = i + 1; j < sameValue.length; j++) {
          animate();
          if (useGameStore.getState().playCards(botId, [pileTopId, sameValue[i].id, sameValue[j].id])) return;
        }
        if (jokers.length > 0) {
          animate();
          if (useGameStore.getState().playCards(botId, [pileTopId, sameValue[i].id, jokers[0].id])) return;
        }
      }
    }

    // 4) Fallback: impossível jogar o topo — limpa a obrigação pra não travar o bot
    useGameStore.setState({ mustPlayPileTopId: null });
  }



  async function doBotPlaySequencesAsync(botId: PlayerId, difficulty: BotDifficulty) {
    let playedSomething = true;
    let iterations = 0;

    // Loop until we can't play any more sequences.
    // Fácil/Médio play exactly 1 sequence max. Hard plays as many as it can.
    while (playedSomething && iterations < 5) {
      playedSomething = false;
      iterations++;

      const s = useGameStore.getState();
      if (s.currentTurnPlayerId !== botId || s.turnPhase !== 'play' || s.roundOver) return;
      const bot = s.players.find(p => p.id === botId);
      if (!bot || bot.hand.length === 0) return;

      const sequences = findBestSequences(bot.hand, s.gameMode);

      for (const seq of sequences) {
        // Evita criar um NOVO jogo de um naipe que já temos na mesa.
        const normalCards = seq.filter(c => !c.isJoker);
        if (normalCards.length > 0 && (difficulty === 'hard' || difficulty === 'medium')) {
          const isTrinca = normalCards.every(c => c.value === normalCards[0].value);
          const value = normalCards[0].value;
          const suit = normalCards[0].suit;
          const teamGames = s.teams[bot.teamId].games;

          const hasDuplicateGame = teamGames.some(g => {
            const gNormal = g.filter(c => !c.isJoker);
            if (gNormal.length === 0) return false;
            
            if (isTrinca) {
              const gIsTrinca = gNormal.length > 0 && gNormal.every(c => c.value === gNormal[0].value);
              return gIsTrinca && gNormal[0].value === value;
            } else {
              const gIsTrinca = gNormal.length > 0 && gNormal.every(c => c.value === gNormal[0].value);
              return !gIsTrinca && gNormal[0].suit === suit;
            }
          });

          // Se for pra bater ou ir pro morto (0 ou 1 carta restando), ignora a regra de não dar duplicate
          const remainingCards = bot.hand.length - seq.length;
          const goingToBaterOrDead = remainingCards <= 1;

          if (hasDuplicateGame && seq.length < 6 && !goingToBaterOrDead) {
            continue; // Retém as cartas, não "mata" a canastra ou cria jogo duplicado!
          }
        }

        // No clássico sem canastra limpa: evita baixar jogo NOVO com curinga (suja desde o início)
        // pois isso desperdiça o coringa e cria mais um jogo que nunca será canastra limpa.
        // EXCEÇÃO: se o curinga é um 2 natural que encaixa limpo no jogo, permite.
        if (s.gameMode === 'classic' && seq.some(c => c.isJoker)) {
          // Verifica se todos os "coringas" na seq encaixam como 2 natural (limpos)
          const normalInSeq = seq.filter(c => !c.isJoker);
          const seqSuit = normalInSeq.length > 0 ? normalInSeq[0].suit : null;
          const allJokersAreNatural = seq.filter(c => c.isJoker).every(j =>
            j.suit !== 'joker' && j.suit === seqSuit // 2 do mesmo naipe
          );
          if (!allJokersAreNatural) {
            const hasCleanCanasta = s.teams[bot.teamId].games.some(g => checkCanasta(g) === 'clean');
            if (!hasCleanCanasta) {
              const remainingAfter = bot.hand.length - seq.length;
              const goingForDead = remainingAfter <= 1 && !s.teams[bot.teamId].hasGottenDead;
              if (!goingForDead) {
                // Verifica se existe algum candidato VIÁVEL a canastra limpa na mesa
                // Se não existe nenhum viável, não adianta guardar o coringa
                const opponentTeamId = bot.teamId === 'team-1' ? 'team-2' : 'team-1';
                const allTableGames = [...s.teams[bot.teamId].games, ...s.teams[opponentTeamId].games];
                const cleanCandidates = s.teams[bot.teamId].games.filter(g =>
                  !g.some(c => c.isJoker) && g.length >= 5
                );
                const hasViableCandidate = cleanCandidates.some(g =>
                  canCleanCandidateGrow(g, allTableGames, bot.hand)
                );
                if (hasViableCandidate) continue; // Preserva coringa para candidato viável
                // Nenhum candidato viável — permite usar coringa em jogo novo
              }
            }
          }
        }

        // Verifica se a jogada não vai deixar o bot travado
        const remaining = bot.hand.filter(c => !seq.some(s => s.id === c.id));
        const wouldStrand = remaining.length === 0 &&
          (s.teams[bot.teamId].hasGottenDead || s.deads.length === 0) &&
          !s.teams[bot.teamId].games.some(g => g.length >= 7 && (s.gameMode === 'araujo_pereira' || checkCanasta(g) === 'clean'));

        if (wouldStrand && difficulty !== 'hard') continue; // Fácil/Médio evita

        animate();
        const success = useGameStore.getState().playCards(botId, seq.map(c => c.id));
        if (success) {
          playedSomething = true;
          await delay(800); // Dá pra ver baixar
          break; // Recomeça o loop com a mão atualizada (só entra se for hard ou re-add)
        }
      }

      // Para o modo hard e araujo_pereira (medium), joga tudo que pode
      if (difficulty === 'easy' || (difficulty === 'medium' && s.gameMode !== 'araujo_pereira')) {
        break; // Stop after first cycle for easy/medium
      }
    }
  }

  async function doBotAddToGamesAsync(botId: PlayerId) {
    const s = useGameStore.getState();
    if (s.currentTurnPlayerId !== botId || s.turnPhase !== 'play' || s.roundOver) return;
    const bot = s.players.find(p => p.id === botId);
    if (!bot) return;
    const difficulty = s.botDifficulty;

    const teamGames = s.teams[bot.teamId].games;

    // Prioriza jogos perto de canastra (mais cartas = mais urgente para completar)
    // IMPORTANTE: jogos LIMPOS antes de sujos — canastra limpa (+200) > suja (+100)
    const jokerSuits = new Set(bot.hand.filter(c => c.isJoker && c.suit !== 'joker').map(c => c.suit));
    const sortedIndices = Array.from({ length: teamGames.length }, (_, i) => i).sort((a, b) => {
      const aLen = teamGames[a].length;
      const bLen = teamGames[b].length;
      const aClean = !teamGames[a].some(c => c.isJoker);
      const bClean = !teamGames[b].some(c => c.isJoker);
      // Prioridade 1: jogo LIMPO de 6 cartas → fechar canastra limpa (+200)
      const aClosingClean = (aLen === 6 && aClean) ? 1 : 0;
      const bClosingClean = (bLen === 6 && bClean) ? 1 : 0;
      if (aClosingClean !== bClosingClean) return bClosingClean - aClosingClean;
      // Prioridade 2: jogo de 6 cartas (sujo) → fechar canastra suja (+100)
      const aClosing = aLen === 6 ? 1 : 0;
      const bClosing = bLen === 6 ? 1 : 0;
      if (aClosing !== bClosing) return bClosing - aClosing;
      // Prioridade 3: jogos limpos antes de sujos (protege caminho para canastra limpa)
      if (aClean !== bClean) return aClean ? -1 : 1;
      // Prioridade 4: jogos maiores primeiro (mais perto de canastra)
      if (aLen !== bLen) return bLen - aLen;
      // Prioridade 5: naipe do curinga coincide com o jogo (para 2-curinga natural)
      const aNormal = teamGames[a].filter(c => !c.isJoker);
      const bNormal = teamGames[b].filter(c => !c.isJoker);
      const aMatch = aNormal.length > 0 && jokerSuits.has(aNormal[0].suit) ? 1 : 0;
      const bMatch = bNormal.length > 0 && jokerSuits.has(bNormal[0].suit) ? 1 : 0;
      return bMatch - aMatch;
    });

    for (const gi of sortedIndices) {
      const freshBot = useGameStore.getState().players.find(p => p.id === botId);
      if (!freshBot) return;

      for (const card of [...freshBot.hand]) {
        const freshState = useGameStore.getState();
        const game = freshState.teams[bot.teamId].games[gi];
        if (!game) break;

        if (card.isJoker) {
          // Se o 2 é carta NATURAL neste jogo (mesmo naipe, posição 2), não é curinga — deixa passar
          if (!wouldDirtyGame(card, game)) {
            // É um 2 natural encaixando limpo — não precisa das proteções de coringa
          } else {
          if (game.some(c => c.isJoker)) continue; // Já tem curinga
          if (difficulty === 'easy') continue; // Fácil nunca suja

          if (checkCanasta(game) === 'clean') {
            // Sujar uma canastra limpa perde +200 de bônus — só é aceitável no Buraco Mole
            // quando o bot vai bater em seguida (canastra suja ainda permite bater).
            const goingOutNext = freshState.gameMode === 'araujo_pereira' && freshBot.hand.length <= 2;
            if (!goingOutNext) continue;
            // Mesmo indo bater: só suja a canastra real se não houver outro jogo que aceite o curinga
            const hasAlternativeGame = freshState.teams[bot.teamId].games.some((g, altIdx) => {
              if (altIdx === gi) return false;        // Pula o jogo atual
              if (g.some(c => c.isJoker)) return false; // Já tem curinga nesse jogo
              if (checkCanasta(g) === 'clean') return false; // Não queremos sujar outra canastra real
              return validateSequence([...g, card], freshState.gameMode);
            });
            if (hasAlternativeGame) continue;
          }

          if (freshState.gameMode === 'classic') {
            // No clássico, sujar é arriscado: sem canastra limpa separada, você não pode bater.
            const allGames = freshState.teams[bot.teamId].games;
            const otherGames = allGames.filter((_, i) => i !== gi);
            const hasCleanCanastaElsewhere = otherGames.some(g => checkCanasta(g) === 'clean');
            const closingCanasta = game.length === 6;

            if (!hasCleanCanastaElsewhere) {
              // O time NÃO tem canastra limpa ainda.
              // Conta quantos jogos limpos com 5+ cartas existem (candidatos a virar canastra limpa).
              const cleanCandidates = allGames.filter(g =>
                !g.some(c => c.isJoker) && g.length >= 5
              );

              // Coleta TODOS os jogos na mesa (ambos os times) para análise de viabilidade
              const opponentTeamId = bot.teamId === 'team-1' ? 'team-2' : 'team-1';
              const allTableGames = [...allGames, ...freshState.teams[opponentTeamId].games];

              if (cleanCandidates.length <= 1 && !game.some(c => c.isJoker) && game.length >= 5) {
                // Este jogo é o ÚLTIMO (ou único) candidato a canastra limpa.
                // Verifica se é VIÁVEL: as cartas necessárias ainda estão disponíveis?
                const isViable = canCleanCandidateGrow(game, allTableGames, freshBot.hand);
                if (isViable) {
                  // Candidato viável — NUNCA suja! Preserva para canastra limpa natural.
                  continue;
                }
                // Candidato INVIÁVEL (cartas presas na mesa) — não adianta preservar.
                // Se está fechando canastra suja (6→7), permite sujar.
                if (!closingCanasta) continue; // Mesmo inviável, não suja um jogo <6 sem motivo
                // closingCanasta + inviável → suja para ao menos ter canastra suja
              }

              // Se temos vários candidatos a canastra limpa E vamos fechar uma canastra suja (6→7),
              // aí pode sujar este, desde que sobre pelo menos um candidato VIÁVEL limpo.
              const otherViableCandidates = cleanCandidates.filter(g =>
                g !== game && canCleanCandidateGrow(g, allTableGames, freshBot.hand)
              );
              if (closingCanasta && otherViableCandidates.length >= 1) {
                // OK, fecha essa como suja — temos outro candidato viável para canastra limpa
              } else if (!closingCanasta) {
                // Verifica se ALGUM candidato (incluindo este) é viável
                const thisIsViable = canCleanCandidateGrow(game, allTableGames, freshBot.hand);
                if (thisIsViable) continue; // Preserva — ainda tem chance
                // Nenhum candidato é viável? Libera sujar se vantajoso
                if (otherViableCandidates.length === 0 && !thisIsViable) {
                  // Nenhum caminho para canastra limpa — permite sujar para não ficar travado
                } else {
                  continue;
                }
              } else {
                // closingCanasta mas nenhum outro candidato viável
                const hasGottenDead = freshState.teams[bot.teamId].hasGottenDead;
                if (hasGottenDead) {
                  // Depois do morto: verifica se este jogo é viável
                  const thisIsViable = canCleanCandidateGrow(game, allTableGames, freshBot.hand);
                  if (thisIsViable) continue; // Preserva — ainda tem chance de canastra limpa
                  // Inviável mesmo depois do morto — suja para não travar
                }
                // Antes do morto: permite sujar para fechar canastra e bater (pegar morto)
              }
            } else {
              // Já tem canastra limpa — pode sujar, mas com critério:
              // 6→7 (fechar canastra suja): sempre vale (+100 bônus)
              // 5→6: só se este jogo NÃO tem mais chance de virar canastra limpa
              //       (cartas necessárias presas na mesa) — aí prepara para canastra suja futura
              // <5: nunca suja — longe de canastra, desperdício de coringa
              if (closingCanasta) {
                // OK — fecha canastra suja
              } else if (game.length >= 5) {
                // Só suja se este jogo não tem mais chance de virar canastra limpa
                const opponentTeamId = bot.teamId === 'team-1' ? 'team-2' : 'team-1';
                const allTableGames = [...allGames, ...freshState.teams[opponentTeamId].games];
                const isViable = canCleanCandidateGrow(game, allTableGames, freshBot.hand);
                if (isViable) continue; // Preserva — ainda pode virar canastra limpa
                // Inviável para limpa — sujar para preparar canastra suja futura
              } else {
                continue; // <5 cartas — nunca suja, muito longe de canastra
              }
            }
          } else {
            // Araujo Pereira: qualquer canastra conta → mas sujar tem custo estratégico
            // Só suja se está fechando canastra (6 → 7 suja) ou se jogo tem cartas suficientes.
            // Thresholds conservadores para evitar sujar jogos limpos desnecessariamente:
            // hard ≥ 5 cartas, medium ≥ 6 cartas (fechar canastra sempre é permitido).
            const closingCanasta = game.length === 6;
            const minLen = difficulty === 'hard' ? 5 : 6;
            if (!closingCanasta && game.length < minLen) continue;
          }
          } // fecha else wouldDirtyGame
        }

        const combined = [...game, card];
        if (validateSequence(combined, freshState.gameMode)) {
          animate();
          useGameStore.getState().addToExistingGame(botId, [card.id], gi);
          await delay(600); // Visualiza o adding
        }
      }
    }
  }

  function doBotDiscard(botId: PlayerId, pileTopId: string | null = null) {
    // Sempre lê estado fresco (pode ter mudado durante os delays assíncronos)
    const s = useGameStore.getState();
    if (s.currentTurnPlayerId !== botId || s.turnPhase !== 'play' || s.roundOver) {
      return;
    }

    // Garante que mustPlayPileTopId não bloqueia o descarte
    if (s.mustPlayPileTopId !== null) {
      useGameStore.setState({ mustPlayPileTopId: null });
    }

    // Re-lê estado fresco APÓS limpar mustPlayPileTopId
    const fresh = useGameStore.getState();
    const bot = fresh.players.find(p => p.id === botId);
    if (!bot || bot.hand.length === 0) {
      // Safety net: forçar passe de turno
      const { getNextPlayer } = require('../game/engine');
      useGameStore.setState({
        currentTurnPlayerId: getNextPlayer(botId),
        turnPhase: 'draw' as const,
        mustPlayPileTopId: null,
      });
      return;
    }

    const teamGames = fresh.teams[bot.teamId].games;
    const card = chooseBestDiscard(bot.hand, fresh.discardedCardHistory, fresh.botDifficulty, fresh.lastDrawnCardId, fresh.gameMode, teamGames, pileTopId);
    animate(); // anim do lixo
    useGameStore.getState().discard(botId, card.id);

    // Safety net: se o discard foi bloqueado (estado não mudou), força passe de turno
    const after = useGameStore.getState();
    if (after.currentTurnPlayerId === botId && after.turnPhase === 'play' && !after.roundOver) {
      const { getNextPlayer } = require('../game/engine');
      useGameStore.setState({
        currentTurnPlayerId: getNextPlayer(botId),
        turnPhase: 'draw' as const,
        mustPlayPileTopId: null,
      });
    }
  }
}

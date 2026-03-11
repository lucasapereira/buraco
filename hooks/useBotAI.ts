import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { PlayerId, BotDifficulty } from '../game/engine';
import { validateSequence, sortCardsBySuitAndValue, canTakePile } from '../game/rules';
import { Card, cardLabel } from '../game/deck';

// ──────────────────────────────────────
// UTILITÁRIOS
// ──────────────────────────────────────

function getCardPoints(card: Card): number {
  if (card.isJoker) return 20;
  if (card.value === 14) return 15;
  if (card.value >= 10) return 10;
  return 5;
}

/** Encontra todas as sequências válidas possíveis dentro de uma mão */
function findBestSequences(hand: Card[]): Card[][] {
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
      if (cards[i].value === cards[i - 1].value + 1) {
        seq.push(cards[i]);
      } else {
        if (seq.length >= 3) sequences.push([...seq]);
        seq = [cards[i]];
      }
    }
    if (seq.length >= 3) sequences.push([...seq]);

    // Sequências com 1 curinga cobrindo lacuna
    if (jokers.length > 0 && cards.length >= 2) {
      for (let i = 0; i < cards.length - 1; i++) {
        const gap = cards[i + 1].value - cards[i].value;
        if (gap === 2) {
          // Tem lacuna que o curinga cobre
          const withJoker = [cards[i], jokers[0], cards[i + 1]];
          if (validateSequence(withJoker)) sequences.push(withJoker);
        }
      }
    }
  }

  // Ordenar do mais longo para o mais curto (prioriza canastas)
  return sequences.sort((a, b) => b.length - a.length);
}

/** Avalia utilidade de uma carta para a mão (quanto vale mantê-la) */
function cardUtility(card: Card, hand: Card[]): number {
  if (card.isJoker) return 100; // Nunca descarta curinga
  const same = hand.filter(c => !c.isJoker && c.suit === card.suit);
  const vals = same.map(c => c.value).sort((a, b) => a - b);
  const idx = vals.indexOf(card.value);

  // Verifica se carta é adjacente a outras (potencial sequência)
  let adjacentCount = 0;
  for (const v of vals) {
    if (Math.abs(v - card.value) <= 2) adjacentCount++;
  }

  return adjacentCount * 10 + getCardPoints(card);
}

/** Escolhe a carta a descartar (menor utilidade) */
function chooseBestDiscard(hand: Card[], discardedHistory: string[], difficulty: BotDifficulty): Card {
  const nonJokers = hand.filter(c => !c.isJoker);
  if (nonJokers.length === 0) return hand[0];

  if (difficulty === 'easy') {
    // Fácil: descarta a de menor valor simplesmente
    return [...nonJokers].sort((a, b) => getCardPoints(a) - getCardPoints(b))[0];
  }

  if (difficulty === 'medium') {
    // Médio: descarta a que tem menor utilidade para a mão
    return [...nonJokers].sort((a, b) =>
      cardUtility(a, hand) - cardUtility(b, hand)
    )[0];
  }

  // Difícil: Descarta carta que:
  // 1. Tem menor utilidade para a própria mão
  // 2. E que o adversário JÁ DESCARTOU antes (menos útil pra ele pegar)
  const sorted = [...nonJokers].sort((a, b) =>
    cardUtility(a, hand) - cardUtility(b, hand)
  );

  // Prefere descartar algo que o adversário já jogou (menos chance de ajudar)
  const alreadyDiscarded = sorted.find(c => discardedHistory.includes(c.id));
  return alreadyDiscarded || sorted[0];
}

/** Avalia se vale a pena pegar o lixo (respeitando a regra obrigatória) */
function shouldTakePile(
  pile: Card[], hand: Card[], difficulty: BotDifficulty, teamGames: Card[][] = []
): boolean {
  if (pile.length === 0) return false;
  if (difficulty === 'easy') return false; // Fácil nunca pega lixo

  // REGRA: só pode pegar se consegue montar jogo com o topo
  if (!canTakePile(hand, pile)) return false;

  const topCard = pile[pile.length - 1];

  // Regra Avançada: Não pega o lixo se isso nos obrigar a criar um NOVO jogo
  // de um naipe que a nossa equipe JÁ TEM na mesa. Criar dois jogos do mesmo naipe
  // "mata" a canastra.
  if (teamGames && teamGames.length > 0) {
    const hasGameSameSuit = teamGames.some(g => {
      const normalCards = g.filter(c => !c.isJoker);
      if (normalCards.length === 0) return false;
      return normalCards[0].suit === topCard.suit;
    });
    
    // Se já temos o naipe na mesa, preferimos NÃO pegar o lixo.
    // (A dificuldade 'easy' já retornou false no início da função).
    if (hasGameSameSuit) {
      return false;
    }
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

  if (difficulty === 'medium') return usefulCount >= 2;
  if (difficulty === 'hard') return true; // Se passou o canTakePile, pega
  return false;
}

// ──────────────────────────────────────
// HOOK PRINCIPAL
// ──────────────────────────────────────

export function useBotAI() {
  const currentTurnPlayerId = useGameStore(s => s.currentTurnPlayerId);
  const turnPhase = useGameStore(s => s.turnPhase);
  const roundOver = useGameStore(s => s.roundOver);
  const processingRef = useRef(false);

  useEffect(() => {
    if (currentTurnPlayerId === 'user') {
      processingRef.current = false;
      return;
    }
    if (roundOver) return;
    if (processingRef.current) return;

    processingRef.current = true;
    const botId = currentTurnPlayerId;

    const timer = setTimeout(() => {
      runBotTurn(botId);
    }, 700);

    return () => clearTimeout(timer);
  }, [currentTurnPlayerId, roundOver]);

  function runBotTurn(botId: PlayerId) {
    const s = useGameStore.getState();
    if (s.currentTurnPlayerId !== botId || s.roundOver) {
      processingRef.current = false;
      return;
    }

    const difficulty = s.botDifficulty;
    const bot = s.players.find(p => p.id === botId);
    if (!bot) { processingRef.current = false; return; }

    // ── FASE DRAW ──
    if (s.turnPhase === 'draw') {
      const pile = s.pile;
      const teamGames = s.teams[bot.teamId].games;
      const takePile = shouldTakePile(pile, bot.hand, difficulty, teamGames);

      if (takePile) {
        useGameStore.getState().drawFromPile(botId);
      } else {
        useGameStore.getState().drawFromDeck(botId);
      }

      setTimeout(() => doBotPlay(botId), 500);
      return;
    }

    if (s.turnPhase === 'play') {
      doBotPlay(botId);
    }
  }

  function doBotPlay(botId: PlayerId) {
    const s = useGameStore.getState();
    if (s.currentTurnPlayerId !== botId || s.turnPhase !== 'play' || s.roundOver) {
      processingRef.current = false;
      return;
    }

    const difficulty = s.botDifficulty;

    // Se pegou do lixo, PRIMEIRO deve jogar um jogo com o topo
    if (s.mustPlayPileTopId) {
      doBotPlayWithPileTop(botId, s.mustPlayPileTopId);
    }

    // Tenta adicionar a jogos existentes PRIMEIRO (para não matar canastras)
    doBotAddToGames(botId);

    // Tenta baixar jogos adicionais
    doBotPlaySequences(botId, difficulty);

    // Como as sequências podem ter liberado cartas, tenta adicionar novamente
    doBotAddToGames(botId);

    // Descarta (só funciona se mustPlayPileTopId foi limpo)
    setTimeout(() => doBotDiscard(botId), 350);
  }

  /** Força jogar uma sequência que inclua o topo do lixo */
  function doBotPlayWithPileTop(botId: PlayerId, pileTopId: string) {
    const s = useGameStore.getState();
    const bot = s.players.find(p => p.id === botId);
    if (!bot) return;

    const topCard = bot.hand.find(c => c.id === pileTopId);
    if (!topCard) return; // Carta não está mais na mão (já foi jogada)

    // 1) Tenta via findBestSequences
    const sequences = findBestSequences(bot.hand);
    for (const seq of sequences) {
      if (seq.some(c => c.id === pileTopId)) {
        if (useGameStore.getState().playCards(botId, seq.map(c => c.id))) return;
      }
    }

    // 2) Tenta combinações brutas de 3 cartas com o topo
    const sameNaipe = bot.hand.filter(c => !c.isJoker && c.suit === topCard.suit && c.id !== pileTopId);
    const jokers = bot.hand.filter(c => c.isJoker);

    for (let i = 0; i < sameNaipe.length; i++) {
      for (let j = i + 1; j < sameNaipe.length; j++) {
        if (useGameStore.getState().playCards(botId, [pileTopId, sameNaipe[i].id, sameNaipe[j].id])) return;
      }
      // Com curinga
      if (jokers.length > 0) {
        if (useGameStore.getState().playCards(botId, [pileTopId, sameNaipe[i].id, jokers[0].id])) return;
      }
    }

    // 3) Fallback: impossível jogar o topo — limpa a obrigação pra não travar o bot
    // (situação rara: canTakePile validou mas validateSequence não encontra combo)
    useGameStore.setState({ mustPlayPileTopId: null });
  }

  function doBotPlaySequences(botId: PlayerId, difficulty: BotDifficulty) {
    let playedSomething = true;
    let iterations = 0;

    // Loop until we can't play any more sequences.
    // Fácil/Médio play exactly 1 sequence max. Hard plays as many as it can.
    while (playedSomething && iterations < 5) {
      playedSomething = false;
      iterations++;

      const s = useGameStore.getState();
      const bot = s.players.find(p => p.id === botId);
      if (!bot || bot.hand.length === 0) return;

      const sequences = findBestSequences(bot.hand);

      for (const seq of sequences) {
        // Evita criar um NOVO jogo de um naipe que já temos na mesa.
        const normalCards = seq.filter(c => !c.isJoker);
        if (normalCards.length > 0 && (difficulty === 'hard' || difficulty === 'medium')) {
          const suit = normalCards[0].suit;
          const teamGames = s.teams[bot.teamId].games;
          const hasGameSameSuit = teamGames.some(g => {
            const gNormal = g.filter(c => !c.isJoker);
            return gNormal.length > 0 && gNormal[0].suit === suit;
          });
          
          if (hasGameSameSuit && seq.length < 6) {
            continue; // Retém as cartas, não "mata" a canastra!
          }
        }

        // Verifica se a jogada não vai deixar o bot travado
        const remaining = bot.hand.filter(c => !seq.some(s => s.id === c.id));
        const wouldStrand = remaining.length === 0 &&
          bot.hasGottenDead &&
          !s.teams[bot.teamId].games.some(g => g.length >= 7 && !g.some(c => c.isJoker));

        if (wouldStrand && difficulty !== 'hard') continue; // Fácil/Médio evita

        const success = useGameStore.getState().playCards(botId, seq.map(c => c.id));
        if (success) {
          playedSomething = true;
          break; // Recomeça o loop com a mão atualizada (só entra se for hard ou re-add)
        }
      }

      if (difficulty !== 'hard') {
        break; // Stop after first cycle for easy/medium
      }
    }
  }

  function doBotAddToGames(botId: PlayerId) {
    const s = useGameStore.getState();
    const bot = s.players.find(p => p.id === botId);
    if (!bot) return;

    const teamGames = s.teams[bot.teamId].games;
    for (let gi = 0; gi < teamGames.length; gi++) {
      const freshBot = useGameStore.getState().players.find(p => p.id === botId);
      if (!freshBot) return;

      for (const card of [...freshBot.hand]) {
        if (card.isJoker) continue;
        const freshState = useGameStore.getState();
        const game = freshState.teams[bot.teamId].games[gi];
        if (!game) break;
        const combined = [...game, card];
        if (validateSequence(combined)) {
          useGameStore.getState().addToExistingGame(botId, [card.id], gi);
        }
      }
    }
  }

  function doBotDiscard(botId: PlayerId) {
    const s = useGameStore.getState();
    if (s.currentTurnPlayerId !== botId || s.turnPhase !== 'play' || s.roundOver) {
      processingRef.current = false;
      return;
    }

    const bot = s.players.find(p => p.id === botId);
    if (!bot || bot.hand.length === 0) {
      // Safety net: forçar passe de turno
      const { getNextPlayer } = require('../game/engine');
      useGameStore.setState({
        currentTurnPlayerId: getNextPlayer(botId),
        turnPhase: 'draw' as const,
      });
      processingRef.current = false;
      return;
    }

    const card = chooseBestDiscard(bot.hand, s.discardedCardHistory, s.botDifficulty);
    s.discard(botId, card.id);
    processingRef.current = false;
  }
}

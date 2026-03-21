import { useEffect } from 'react';
import { LayoutAnimation, Platform, UIManager } from 'react-native';
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

    // Sequências com 1 curinga — detecta a sequência mais longa possível (não só pares)
    if (jokers.length > 0 && cards.length >= 2) {
      for (let i = 0; i < cards.length; i++) {
        const seq: Card[] = [cards[i]];
        let expectedNext = cards[i].value + 1;
        let jokerUsed = false;
        for (let j = i + 1; j < cards.length; j++) {
          const currVal = cards[j].value;
          if (currVal < expectedNext) continue; // pula duplicata ou valor já passado
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
  if (card.isJoker) return 100; // Nunca descarta curinga
  const same = hand.filter(c => !c.isJoker && c.suit === card.suit);
  const vals = same.map(c => c.value).sort((a, b) => a - b);

  // Verifica se carta é adjacente a outras (potencial sequência)
  let adjacentCount = 0;
  for (const v of vals) {
    if (Math.abs(v - card.value) <= 2) adjacentCount++;
  }

  // Verifica potencial de trinca (cartas de mesmo valor)
  const sameValueCount = hand.filter(c => !c.isJoker && c.value === card.value).length;
  const trincaPotential = (gameMode === 'araujo_pereira' && sameValueCount > 1) ? 50 : 0;

  // Bônus: carta que encaixa em jogo já na mesa (mais perto da canastra = mais valiosa)
  let gameBonus = 0;
  for (const game of teamGames) {
    if (validateSequence([...game, card], gameMode)) {
      const gNormal = game.filter(c => !c.isJoker);
      const isTrinca = gameMode === 'araujo_pereira' && gNormal.length > 0 && gNormal.every(c => c.value === gNormal[0].value);
      // Trinca: bônus maior pois qualquer naipe serve, mais fácil completar canastra
      const bonus = isTrinca ? 30 + game.length * 5 : 20 + game.length * 4;
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

      // Conta utilidade
      if (pile.some(pileCard => !pileCard.isJoker && hand.some(h => !h.isJoker && h.suit === pileCard.suit && Math.abs(h.value - pileCard.value) <= 2))) {
        usefulCount++;
      }
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

  // Se encaixa em jogo existente, o bot Hard sempre pega. O Medium pega se tiver +1 útil.
  if (fitsExisting) {
    if (difficulty === 'hard') return true;
    if (difficulty === 'medium') return usefulCount >= 1;
  }

  if (difficulty === 'medium') return usefulCount >= 2;
  if (difficulty === 'hard') return true; // Se passou o canTakePile, pega
  return false;
}

// ──────────────────────────────────────
// HOOK PRINCIPAL
// ──────────────────────────────────────

export function useBotAI() {
  const roundOver = useGameStore(s => s.roundOver);

  useEffect(() => {
    const s = useGameStore.getState();
    const botId = s.currentTurnPlayerId;
    if (botId === 'user' || roundOver) return;

    const timer = setTimeout(() => {
      runBotTurnAsync(botId);
    }, 500);

    return () => clearTimeout(timer);
  }, [useGameStore(s => s.currentTurnPlayerId), useGameStore(s => s.turnPhase), roundOver]);

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

        const pile = s.pile;
        const teamGames = s.teams[bot.teamId].games;
        const takePile = shouldTakePile(pile, bot.hand, difficulty, teamGames, s.gameMode);

        animate(); // Animação de compra
        if (takePile) {
          useGameStore.getState().drawFromPile(botId);
        } else {
          useGameStore.getState().drawFromDeck(botId);
        }

        await delay(800); // Pausa depois curinha para olhar a mão
        await doBotPlayAsync(botId);
        return;
      }

      if (s.turnPhase === 'play') {
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
        turnPhase: 'draw' as const
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
    const bot = s.players.find(p => p.id === botId);
    if (!bot) return;
    const difficulty = s.botDifficulty;

    const teamGames = s.teams[bot.teamId].games;
    for (let gi = 0; gi < teamGames.length; gi++) {
      const freshBot = useGameStore.getState().players.find(p => p.id === botId);
      if (!freshBot) return;

      for (const card of [...freshBot.hand]) {
        const freshState = useGameStore.getState();
        const game = freshState.teams[bot.teamId].games[gi];
        if (!game) break;

        if (card.isJoker) {
          if (game.some(c => c.isJoker)) continue; // Já tem curinga
          if (difficulty === 'easy') continue; // Fácil nunca suja

          if (freshState.gameMode === 'classic') {
            // No clássico, sujar é arriscado: sem canastra limpa separada, você pode ficar travado.
            // Só suja se o time já tem uma canastra limpa em OUTRO jogo (garantia de poder bater),
            // ou se esse jogo está a 1 carta de virar canastra (6+ → curinga fecha os 7).
            const otherGames = freshState.teams[bot.teamId].games.filter((_, i) => i !== gi);
            const hasCleanCanastaElsewhere = otherGames.some(
              g => g.length >= 7 && checkCanasta(g) === 'clean'
            );
            const closingCanasta = game.length >= 6; // curinga fecha os 7
            if (!hasCleanCanastaElsewhere && !closingCanasta) continue;
          } else {
            // Araujo Pereira: qualquer canastra conta → pode sujar mais livremente
            const gNormal = game.filter(c => !c.isJoker);
            const isTrinca = gNormal.length > 0 && gNormal.every(c => c.value === gNormal[0].value);
            const minLen = isTrinca
              ? (difficulty === 'hard' ? 3 : 4)
              : (difficulty === 'hard' ? 4 : 5);
            if (game.length < minLen) continue;
          }
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
    const s = useGameStore.getState();
    if (s.currentTurnPlayerId !== botId || s.turnPhase !== 'play' || s.roundOver) {
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
      return;
    }

    const teamGames = s.teams[bot.teamId].games;
    const card = chooseBestDiscard(bot.hand, s.discardedCardHistory, s.botDifficulty, s.lastDrawnCardId, s.gameMode, teamGames, pileTopId);
    animate(); // anim do lixo
    s.discard(botId, card.id);
  }
}

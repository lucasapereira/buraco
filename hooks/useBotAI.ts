import { useEffect, useRef } from 'react';
import { AppState, LayoutAnimation } from 'react-native';
import { Card } from '../game/deck';
import { BotDifficulty, GameMode, PlayerId } from '../game/engine';
import { validateSequence, checkCanasta } from '../game/rules';
import {
  wouldDirtyGame,
  canCleanCandidateGrow,
  canTeamBater,
  findBestSequences,
  chooseBestDiscard,
  opponentRecentlyTookPile,
  shouldTakePileSmart,
} from '../game/botHelpers';
import { useGameStore } from '../store/gameStore';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);


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

    const difficulty: BotDifficulty = 'hard' as BotDifficulty;
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
        const takePile = shouldTakePileSmart(pile, freshBot.hand, difficulty, teamGames, fresh.gameMode);

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

    const difficulty: BotDifficulty = 'hard' as BotDifficulty;

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

    const teamGames = s.teams[bot.teamId].games;
    // Ordena jogos: naipe natural do topo primeiro (2♦ prefere jogo de ouros), canastras limpas por último.
    const sortedGameIndices = Array.from({ length: teamGames.length }, (_, i) => i).sort((a, b) => {
      const aGame = teamGames[a];
      const bGame = teamGames[b];
      const aNormal = aGame.filter(c => !c.isJoker);
      const bNormal = bGame.filter(c => !c.isJoker);
      // Prioridade 1: se o topo é curinga de naipe X, jogo de naipe X vem primeiro (encaixe natural)
      if (topCard.isJoker && topCard.suit !== 'joker') {
        const aMatch = aNormal.length > 0 && aNormal[0].suit === topCard.suit ? 1 : 0;
        const bMatch = bNormal.length > 0 && bNormal[0].suit === topCard.suit ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
      }
      // Prioridade 2: canastras limpas por último (para não sujá-las desnecessariamente)
      const aCleanCanasta = checkCanasta(aGame) === 'clean' ? 1 : 0;
      const bCleanCanasta = checkCanasta(bGame) === 'clean' ? 1 : 0;
      return aCleanCanasta - bCleanCanasta;
    });

    // ─────────────────────────────────────────────────────────────
    // FASE A: TENTATIVAS LIMPAS (prefere nunca sujar nenhum jogo)
    // Evita o bug clássico do bot sujar 2♦ num jogo de paus quando
    // poderia formar NOVO jogo limpo de ouros com cartas da mão.
    // ─────────────────────────────────────────────────────────────

    // A1) Adiciona topo a jogo existente SEM sujar
    for (const gi of sortedGameIndices) {
      const game = useGameStore.getState().teams[bot.teamId].games[gi];
      if (!game) continue;
      if (topCard.isJoker && wouldDirtyGame(topCard, game)) continue;
      const combined = [...game, topCard];
      if (validateSequence(combined, s.gameMode)) {
        // Carta NORMAL também pode sujar canastra limpa (gap força coringa natural a sair)
        if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
        animate();
        if (useGameStore.getState().addToExistingGame(botId, [pileTopId], gi)) return;
      }
    }

    // A2) Adiciona topo + carta(s) da mão a jogo existente SEM sujar
    for (const gi of sortedGameIndices) {
      const freshState = useGameStore.getState();
      const game = freshState.teams[bot.teamId].games[gi];
      if (!game) continue;
      if (topCard.isJoker && wouldDirtyGame(topCard, game)) continue;
      const freshBot = freshState.players.find(p => p.id === botId);
      if (!freshBot) return;

      for (const c of freshBot.hand) {
        if (c.id === pileTopId) continue;
        const combined = [...game, topCard, c];
        if (validateSequence(combined, freshState.gameMode)) {
          if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
          animate();
          if (useGameStore.getState().addToExistingGame(botId, [pileTopId, c.id], gi)) return;
        }
      }
      for (let i = 0; i < freshBot.hand.length; i++) {
        if (freshBot.hand[i].id === pileTopId) continue;
        for (let j = i + 1; j < freshBot.hand.length; j++) {
          if (freshBot.hand[j].id === pileTopId) continue;
          const combined = [...game, topCard, freshBot.hand[i], freshBot.hand[j]];
          if (validateSequence(combined, freshState.gameMode)) {
            if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
            animate();
            if (useGameStore.getState().addToExistingGame(botId, [pileTopId, freshBot.hand[i].id, freshBot.hand[j].id], gi)) return;
          }
        }
      }
    }

    // A3) Forma NOVO jogo onde topo (2-curinga) é colocado naturalmente.
    // Só considera sequências em que topo é do mesmo naipe da seq e TODOS os demais
    // curingas da seq também são naturais do mesmo naipe — ou seja, jogada 100% limpa.
    if (topCard.isJoker && topCard.suit !== 'joker') {
      const sequences = findBestSequences(bot.hand, s.gameMode);
      for (const seq of sequences) {
        if (!seq.some(c => c.id === pileTopId)) continue;
        const seqNormal = seq.filter(c => !c.isJoker);
        const seqSuit = seqNormal.length > 0 ? seqNormal[0].suit : null;
        if (seqSuit !== topCard.suit) continue;
        const allJokersNatural = seq.filter(c => c.isJoker).every(j => j.suit === seqSuit);
        if (!allJokersNatural) continue;
        animate();
        if (useGameStore.getState().playCards(botId, seq.map(c => c.id))) return;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // FASE B: FALLBACK — permite sujar, mas ainda protege canastras limpas
    // ─────────────────────────────────────────────────────────────

    // B1) Adiciona topo a jogo existente (protege apenas canastra limpa)
    for (let pass = 0; pass < 2; pass++) {
      for (const gi of sortedGameIndices) {
        const game = useGameStore.getState().teams[bot.teamId].games[gi];
        if (!game) continue;
        if (pass === 0 && topCard.isJoker && wouldDirtyGame(topCard, game) && checkCanasta(game) === 'clean') continue;
        const combined = [...game, topCard];
        if (validateSequence(combined, s.gameMode)) {
          // Carta normal pode degradar canastra limpa também — protege no pass 0
          if (pass === 0 && checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
          animate();
          if (useGameStore.getState().addToExistingGame(botId, [pileTopId], gi)) return;
        }
      }
    }

    // B2) Adiciona topo + cartas da mão (protege apenas canastra limpa no pass 0)
    for (let pass = 0; pass < 2; pass++) {
      for (const gi of sortedGameIndices) {
        const freshState = useGameStore.getState();
        const game = freshState.teams[bot.teamId].games[gi];
        if (!game) continue;
        const freshBot = freshState.players.find(p => p.id === botId);
        if (!freshBot) return;
        if (pass === 0 && topCard.isJoker && wouldDirtyGame(topCard, game) && checkCanasta(game) === 'clean') continue;

        for (const c of freshBot.hand) {
          if (c.id === pileTopId) continue;
          const combined = [...game, topCard, c];
          if (validateSequence(combined, freshState.gameMode)) {
            if (pass === 0 && checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
            animate();
            if (useGameStore.getState().addToExistingGame(botId, [pileTopId, c.id], gi)) return;
          }
        }
        for (let i = 0; i < freshBot.hand.length; i++) {
          if (freshBot.hand[i].id === pileTopId) continue;
          for (let j = i + 1; j < freshBot.hand.length; j++) {
            if (freshBot.hand[j].id === pileTopId) continue;
            const combined = [...game, topCard, freshBot.hand[i], freshBot.hand[j]];
            if (validateSequence(combined, freshState.gameMode)) {
              if (pass === 0 && checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
              animate();
              if (useGameStore.getState().addToExistingGame(botId, [pileTopId, freshBot.hand[i].id, freshBot.hand[j].id], gi)) return;
            }
          }
        }
      }
    }

    // B3) Tenta via findBestSequences (qualquer jogo novo, mesmo com curinga sujo)
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

      const teamState = s.teams[bot.teamId];
      // Endgame: se o time já pode bater e a mão é pequena, acelera — não retém
      // cartas pra evitar duplicate-suit, esvazia tudo pra bater o quanto antes.
      const accelerating = canTeamBater(teamState.games, s.gameMode, teamState.hasGottenDead)
        && bot.hand.length <= 5;

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

          if (hasDuplicateGame && seq.length < 6 && !goingToBaterOrDead && !accelerating) {
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
                // Bloqueia meld NOVA de 3 cartas com coringa antes do time ter qualquer canastra —
                // uma seq de 3 com coringa nunca vira canastra limpa naquele naipe.
                if (seq.length === 3) continue;
                // Nenhum candidato viável — permite usar coringa em jogo novo (>=4 cartas)
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
    const difficulty: BotDifficulty = 'hard' as BotDifficulty;

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
      // Prioridade 3: naipe do 2-curinga coincide com o jogo → encaixe natural (não suja)
      // Elevado antes de tamanho/limpo para garantir que 2♦ vai ao jogo de ouros primeiro
      const aNormal = teamGames[a].filter(c => !c.isJoker);
      const bNormal = teamGames[b].filter(c => !c.isJoker);
      const aMatch = aNormal.length > 0 && jokerSuits.has(aNormal[0].suit) ? 1 : 0;
      const bMatch = bNormal.length > 0 && jokerSuits.has(bNormal[0].suit) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      // Prioridade 4: jogos limpos antes de sujos (protege caminho para canastra limpa)
      if (aClean !== bClean) return aClean ? -1 : 1;
      // Prioridade 5: jogos maiores primeiro (mais perto de canastra)
      if (aLen !== bLen) return bLen - aLen;
      return 0;
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
            // Nunca suja canastra limpa — EXCETO se o bot vai bater em seguida
            // e ainda sobra pelo menos outra canastra limpa para cumprir a condição de bater.
            const goingOutNext = freshBot.hand.length <= 2;
            const cleanCanastas = freshState.teams[bot.teamId].games.filter(g => checkCanasta(g) === 'clean');
            const hasAnotherCleanCanasta = cleanCanastas.length > 1;
            if (!goingOutNext || !hasAnotherCleanCanasta) continue;
            // Indo bater com 2+ canastras limpas: só suja esta se não houver outro jogo disponível
            const hasAlternativeGame = freshState.teams[bot.teamId].games.some((g, altIdx) => {
              if (altIdx === gi) return false;
              if (g.some(c => c.isJoker)) return false;
              if (checkCanasta(g) === 'clean') return false;
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
              // Já tem canastra limpa: pode usar o coringa livremente nos outros jogos.
              // Não precisa de threshold de tamanho — sem risco de ficar sem poder bater.
              // (a canastra limpa já está protegida pelo checkCanasta === 'clean' acima)
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
          // Proteção extra: carta NORMAL também pode sujar canastra limpa
          // (ex.: jogar 9♠ num [A♠..7♠] força o 2♠ natural a sair da posição).
          // Bloqueia a menos que esteja indo bater AGORA e ainda sobre outra canastra limpa.
          if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') {
            const freshBotNow = freshState.players.find(p => p.id === botId);
            const goingOutNext = (freshBotNow?.hand.length ?? 99) <= 2;
            const otherCleanCanastas = freshState.teams[bot.teamId].games
              .filter((g, idx) => idx !== gi && checkCanasta(g) === 'clean');
            if (!goingOutNext || otherCleanCanastas.length === 0) continue;
          }
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
    const opponentTeamId = bot.teamId === 'team-1' ? 'team-2' : 'team-1';
    const opponentGames = fresh.teams[opponentTeamId].games;
    const opponentIds = fresh.players.filter(p => p.teamId === opponentTeamId).map(p => p.id);
    const tookPileRecently = opponentRecentlyTookPile(fresh.gameLog as any, opponentIds);
    const card = chooseBestDiscard(
      bot.hand,
      fresh.discardedCardHistory,
      'hard',
      fresh.lastDrawnCardId,
      fresh.gameMode,
      teamGames,
      pileTopId,
      opponentGames,
      tookPileRecently
    );
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

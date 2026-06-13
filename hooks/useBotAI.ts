import { useEffect, useRef } from 'react';
import { AppState, LayoutAnimation } from 'react-native';
import { Card } from '../game/deck';
import { BotDifficulty, GameMode, PlayerId } from '../game/engine';
import { validateSequence, checkCanasta, findPileTopPlay } from '../game/rules';
import {
  wouldDirtyGame,
  canCleanCandidateGrow,
  canTeamBater,
  findBestSequences,
  chooseBestDiscard,
  opponentRecentlyTookPile,
  shouldTakePileSmart,
  canastaBonusValue,
  findPileTopNonDegradingPlay,
  pileTakeForcesDirtyingCleanPath,
  longestNaturalRun,
  wouldLockRedeemableWild,
  wildTopTakeVeto,
} from '../game/botHelpers';
import { useGameStore } from '../store/gameStore';
import { pimcShouldTakePile, pimcChooseDiscard, pimcShouldHoldMelds, meldsAvailable } from '../game/pimc';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

// Aggressiveness no pile-take por jogador. Threshold do shouldTakePileSmart é
// dividido por esse valor — maior = bot pega lixo com mais facilidade.
// Validado no scripts/botSim.ts (n=4500, 8 variantes): especialização "só bot-3
// agressivo" (1.0/1.7) é robusta contra humano envenenando lixo (54% win T2),
// equivalente ao simétrico 1.5/1.5 (55%) com a metade da agressão. Variante
// 1.3/1.7 (assimetria moderada) PIORA sob poison (51%) — bot-1 fica preso com
// lixos pisados sem leverage suficiente. Bot-2 (parceiro do user) mantido em
// 1.0 pra não roubar lixo do humano (UX).
//
// IMPORTANTE: aplicado APENAS no modo offline (single-player). Em multiplayer
// online, todos os bots/AFK-takeovers usam 1.0 — fair entre os jogadores
// humanos sentados em qualquer "cadeira" da mesa.
const PILE_AGGRESSIVENESS_OFFLINE: Record<PlayerId, number> = {
  'user': 1.0,
  'bot-1': 1.0,
  'bot-2': 1.0,
  'bot-3': 1.7,
};


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

    // Quando o app volta do background, reseta o timer de AFK — tempo parado em
    // background não deve contar como AFK do humano, senão o host ao voltar
    // dispara takeover em cima de estado local desatualizado (antes do Firebase
    // sincronizar) e gera desync entre os devices.
    const appStateListener = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        lastActionTimeRef.current = Date.now();
        // Ainda dispara o check imediato para bots travados (não afeta humanos,
        // já que o reset acima zerou a janela de 30s de AFK).
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

    // PIMC ('expert') só no modo offline (single-player); online usa heurística
    // pra ser justo entre humanos. O resto do turno segue 'hard' (PIMC só
    // sobrepõe a decisão de pegar-lixo).
    const difficulty: BotDifficulty = 'hard' as BotDifficulty;
    const isExpert = !options.isOnline && s.botDifficulty === 'expert';
    const bot = s.players.find(p => p.id === botId);
    if (!bot) return;

    try {
      // ── FASE DRAW ──
      if (s.turnPhase === 'draw') {
        // Expert: pré-delay curto (o PIMC computa em seguida); piso de tempo
        // total ~1.5s aplicado depois, pra o bot difícil não agir MAIS RÁPIDO
        // que o normal (seria um "tell" da dificuldade + estranho na UX).
        const turnStart = Date.now();
        await delay(isExpert ? 300 : 1500);

        // Re-valida com estado fresco (pode ter mudado durante o delay via applyRemoteState)
        const fresh = useGameStore.getState();
        if (fresh.currentTurnPlayerId !== botId || fresh.turnPhase !== 'draw' || fresh.roundOver) {
          return; // Estado mudou — o useEffect vai tratar o novo estado
        }

        const freshBot = fresh.players.find(p => p.id === botId);
        if (!freshBot) return;
        const pile = fresh.pile;
        const teamGames = fresh.teams[freshBot.teamId].games;
        const aggressiveness = options.isOnline ? 1.0 : (PILE_AGGRESSIVENESS_OFFLINE[botId] ?? 1.0);
        let takePile: boolean;
        if (isExpert) {
          // Busca PIMC, fatiada (cede o frame) — não trava a UI. Anytime.
          takePile = await pimcShouldTakePile(fresh, botId, {
            onYield: async () => { await delay(0); },
          });
          // Re-valida: o cômputo é async (~1.2s); estado pode ter mudado.
          const f2 = useGameStore.getState();
          if (f2.currentTurnPlayerId !== botId || f2.turnPhase !== 'draw' || f2.roundOver) return;
          // Piso de UX: garante ~1.5s de "pensar" mesmo se o PIMC for rápido.
          const elapsed = Date.now() - turnStart;
          if (elapsed < 1500) await delay(1500 - elapsed);
        } else {
          takePile = shouldTakePileSmart(pile, freshBot.hand, difficulty, teamGames, fresh.gameMode, aggressiveness);
        }

        // VETOS difícil-agnósticos (cobrem o PIMC 'expert', que decide por rollout
        // material). (1) Não pega o lixo se cumprir a obrigação do topo forçar
        // sujar uma meld limpa protegida (canastra, ou candidata viável ≥5 sem
        // canastra). (2) Topo-CORINGA sem encaixe natural/limpo: não pega se isso
        // queimar o coringa contra a via de canastra limpa (wildTopTakeVeto —
        // report "agora ele usa o coringa pra pegar lixo"; swap n=300 +4.0pp
        // simétrico). Mesmas regras que shouldTakePileSmart aplica na heurística;
        // aqui garantem o caminho PIMC também.
        if (takePile) {
          const vs = useGameStore.getState();
          const vbot = vs.players.find(p => p.id === botId);
          if (vbot && (
            pileTakeForcesDirtyingCleanPath(vbot.hand, vs.pile, vs.teams[vbot.teamId].games, vs.gameMode)
            || wildTopTakeVeto(vs.pile, vbot.hand, vs.teams[vbot.teamId].games, vs.gameMode)
          )) {
            takePile = false;
          }
        }

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

    // Stage 4 (meldHold): no expert, a busca PIMC decide o TIMING de baixar —
    // "baixo tudo agora vs seguro este turno" por rollout (a obrigação do lixo
    // já foi cumprida acima; segurar nunca a viola). Swap n=300: +8.0pp
    // simétrico, canastras limpas +28/+55% e REAIS ~2× por assento. Só busca
    // quando baixar mudaria algo (meldsAvailable) — senão hold == play.
    const expertTurn = !options.isOnline && s.botDifficulty === 'expert';
    let holdMelds = false;
    if (expertTurn) {
      const fresh = useGameStore.getState();
      if (fresh.currentTurnPlayerId === botId && fresh.turnPhase === 'play' && !fresh.roundOver
          && meldsAvailable(fresh, botId)) {
        holdMelds = await pimcShouldHoldMelds(fresh, botId, {
          onYield: async () => { await delay(0); },
        });
        // Re-valida: o cômputo é async; estado pode ter mudado.
        const f2 = useGameStore.getState();
        if (f2.currentTurnPlayerId !== botId || f2.turnPhase !== 'play' || f2.roundOver) return;
      }
    }

    if (!holdMelds) {
      // Tenta adicionar a jogos existentes PRIMEIRO (para não matar canastras)
      await doBotAddToGamesAsync(botId);

      // Tenta baixar jogos adicionais
      await doBotPlaySequencesAsync(botId, difficulty);

      // Como as sequências podem ter liberado cartas, tenta adicionar novamente
      await doBotAddToGamesAsync(botId);
    }

    // Descarta (só funciona se mustPlayPileTopId foi limpo). No expert a busca
    // PIMC do descarte já é o "tempo de pensar" — encurta o respiro pra não
    // empilhar com o cômputo (~1,2s) e deixar o turno lento.
    await delay(expertTurn ? 150 : 1000);
    await doBotDiscard(botId, pileTopId);
  }

  /** Força jogar uma sequência que inclua o topo do lixo */
  async function doBotPlayWithPileTop(botId: PlayerId, pileTopId: string, allowWild3 = false) {
    const s = useGameStore.getState();
    const bot = s.players.find(p => p.id === botId);
    if (!bot) return;

    const topCard = bot.hand.find(c => c.id === pileTopId);
    if (!topCard) return;

    const teamGames = s.teams[bot.teamId].games;

    // CUMPRIMENTO SEM DEGRADAR (1ª tentativa, antes das fases A/B): procura uma
    // jogada que mele o topo sem sujar NENHUMA meld limpa — canastra OU candidata
    // (<7). Inclui formar jogo NOVO (mesmo sujo) quando essa é a única forma de
    // não tocar numa meld limpa. Isso conserta o ordering-bug: as fases B sujavam
    // uma canastra/candidata limpa ANTES de tentar um jogo novo que a preservaria.
    if (!allowWild3) {
      const handNoTop = bot.hand.filter(c => c.id !== pileTopId);
      const nd = findPileTopNonDegradingPlay(handNoTop, topCard, teamGames, s.gameMode, true);
      if (nd) {
        animate();
        const ok = nd.gameIndex >= 0
          ? useGameStore.getState().addToExistingGame(botId, nd.cardIds, nd.gameIndex)
          : useGameStore.getState().playCards(botId, nd.cardIds);
        if (ok) return;
      }
    }

    // Disciplina de coringa no caminho da OBRIGAÇÃO do lixo (espelha item #3,
    // que só existia em doBotPlaySequencesAsync). No 1º passe (strict) NÃO cria
    // meld NOVA de 3 cartas com coringa não-natural sem canastra limpa — assim
    // o bot tenta cumprir a obrigação de forma limpa/natural/maior primeiro.
    // Se nada mais satisfizer a obrigação, faz um retry relaxado (allowWild3)
    // pra a regra do Clássico ("baixar o topo") continuar sempre cumprível.
    const teamHasCleanCanasta = teamGames.some(g => checkCanasta(g) === 'clean');
    const isBadWild3 = (seq: Card[]): boolean => {
      if (allowWild3 || s.gameMode !== 'classic' || teamHasCleanCanasta) return false;
      if (seq.length !== 3) return false;
      const jk = seq.filter(c => c.isJoker);
      if (jk.length === 0) return false;
      const sn = seq.filter(c => !c.isJoker);
      const seqSuit = sn.length > 0 ? sn[0].suit : null;
      const allNatural = jk.every(j => j.suit !== 'joker' && j.suit === seqSuit);
      if (allNatural) return false;
      const remainingAfter = bot.hand.length - seq.length;
      const goingForDead = remainingAfter <= 1 && !s.teams[bot.teamId].hasGottenDead;
      return !goingForDead;
    };
    // Pre-computa delta de bônus de canastra que o topCard provoca em cada jogo.
    // Ex.: 7♣ entrando em [3,4,5,6, 2♣(wild), 8,9] desloca o coringa para a posição
    // natural do "2", subindo a canastra de suja (+100) → limpa (+200): delta = +100.
    // Só conta se a adição for válida — caso contrário, delta = 0 (sort cai pros tiebreakers).
    const topCardDelta = teamGames.map(g => {
      if (!validateSequence([...g, topCard], s.gameMode)) return 0;
      return canastaBonusValue([...g, topCard]) - canastaBonusValue(g);
    });
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
      // Prioridade 2: jogo onde o topo provoca o MAIOR upgrade de canastra (suja→limpa, fechamento)
      if (topCardDelta[a] !== topCardDelta[b]) return topCardDelta[b] - topCardDelta[a];
      // Prioridade 3: canastras limpas por último (para não sujá-las desnecessariamente)
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
      const sequences = findBestSequences(bot.hand, s.gameMode, true); // issue A: aloca coringa por naipe
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
        // HARD RULE (vale também no pass 1, fallback do mustPlay): NUNCA suja
        // canastra limpa de 500 (13) ou 1000 (14). Perder 400/900 pra cumprir
        // obrigação de meldar o topo é absurdo — prefere falhar e deixar o
        // motor lidar (em último caso o bot resolve via B3 ou descarta).
        const wouldDirty = topCard.isJoker && wouldDirtyGame(topCard, game) && checkCanasta(game) === 'clean';
        if (wouldDirty && game.length >= 13) continue;
        if (pass === 0 && wouldDirty) continue;
        const combined = [...game, topCard];
        if (validateSequence(combined, s.gameMode)) {
          // Carta normal pode degradar canastra limpa também — hard rule + pass-0 guard
          const wouldDegrade = checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean';
          if (wouldDegrade && game.length >= 13) continue;
          if (pass === 0 && wouldDegrade) continue;
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
        // HARD RULE: nunca suja canastra limpa de 13/14 cartas, nem mesmo no pass 1.
        const wouldDirty = topCard.isJoker && wouldDirtyGame(topCard, game) && checkCanasta(game) === 'clean';
        if (wouldDirty && game.length >= 13) continue;
        if (pass === 0 && wouldDirty) continue;

        for (const c of freshBot.hand) {
          if (c.id === pileTopId) continue;
          const combined = [...game, topCard, c];
          if (validateSequence(combined, freshState.gameMode)) {
            const wouldDegrade = checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean';
            if (wouldDegrade && game.length >= 13) continue;
            if (pass === 0 && wouldDegrade) continue;
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
              const wouldDegrade = checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean';
              if (wouldDegrade && game.length >= 13) continue;
              if (pass === 0 && wouldDegrade) continue;
              animate();
              if (useGameStore.getState().addToExistingGame(botId, [pileTopId, freshBot.hand[i].id, freshBot.hand[j].id], gi)) return;
            }
          }
        }
      }
    }

    // B3) Tenta via findBestSequences (qualquer jogo novo, mesmo com curinga sujo)
    const sequences = findBestSequences(bot.hand, s.gameMode, true); // issue A: aloca coringa por naipe
    for (const seq of sequences) {
      if (seq.some(c => c.id === pileTopId)) {
        if (isBadWild3(seq)) continue; // adia meld de 3 com coringa não-natural
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
      if (jokers.length > 0 && !isBadWild3([topCard, sameSuit[i], jokers[0]])) {
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

    // Nada satisfez a obrigação no passe strict → retry permitindo coringa-em-3
    // (a regra do Clássico exige baixar o topo; melhor sujar do que travar).
    if (!allowWild3) { await doBotPlayWithPileTop(botId, pileTopId, true); return; }

    // 4) Fallback exaustivo: espelha canTakePile via findPileTopPlay. Garante que
    // toda pegada de lixo permitida pela regra seja de fato cumprida — sem isso,
    // lacunas entre canTakePile e as fases acima largam a obrigação (bot fica com o
    // lixo sem baixar o topo, jogada ilegal no Clássico).
    {
      const fs = useGameStore.getState();
      const fbot = fs.players.find(p => p.id === botId);
      const ftop = fbot?.hand.find(c => c.id === pileTopId);
      if (fbot && ftop) {
        const handWithoutTop = fbot.hand.filter(c => c.id !== pileTopId);
        const teamGamesNow = fs.teams[fbot.teamId].games;
        // Recusa jogadas que sujariam canastra limpa de 500/1000 (≥13): prefere
        // largar a obrigação a perder 400/900 (ver feedback_bot_nunca_suja_500_1000).
        const realize = findPileTopPlay(handWithoutTop, ftop, teamGamesNow, fs.gameMode, (gi, cardIds) => {
          if (gi < 0) return true;
          const game = teamGamesNow[gi];
          if (game.length < 13 || checkCanasta(game) !== 'clean') return true;
          const added = fbot.hand.filter(c => cardIds.includes(c.id));
          return checkCanasta([...game, ...added]) === 'clean';
        });
        if (realize) {
          animate();
          const ok = realize.gameIndex >= 0
            ? useGameStore.getState().addToExistingGame(botId, realize.cardIds, realize.gameIndex)
            : useGameStore.getState().playCards(botId, realize.cardIds);
          if (ok) return;
        }
      }
    }

    // 5) Impossível jogar o topo — limpa a obrigação pra não travar o bot
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

      const sequences = findBestSequences(bot.hand, s.gameMode, true); // issue A: aloca coringa por naipe

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
                // Não gasta coringa pra fazer um gap numa meld NOVA quando a MÃO já
                // tem uma corrida natural limpa de ≥3 no mesmo naipe (report: 3,4,5
                // + ★ + 7 → baixava [..★..] sujo em vez de baixar [3,4,5] limpo e
                // guardar o ★). Checa o naipe na MÃO, não só na seq — senão o bot
                // rota por uma sub-seq menor ([4,5,★,7]) e remonta a meld suja no
                // doBotAddToGamesAsync. seq.length===3 cobre o gap puro ([3,★,5]).
                const handSuitRun = seqSuit
                  ? longestNaturalRun(bot.hand.filter(c => !c.isJoker && c.suit === seqSuit))
                  : 0;
                if (seq.length === 3 || handSuitRun >= 3) continue;
                // Sem corrida limpa de ≥3 no naipe e sem candidato viável: o coringa
                // é realmente necessário → permite usar em jogo novo (>=4 cartas).
              }
            }
          }
        }

        // ISSUE C: guarda ≥1 coringa pra pegar lixo gordo depois — não gasta o
        // ÚLTIMO coringa numa meld nova pequena (<5) não-crítica. Escape: indo
        // bater/morto, pode bater já, deck baixo, ou acelerando pra bater.
        if (s.gameMode === 'classic') {
          const wildsInSeq = seq.filter(c => c.isJoker).length;
          const wildsInHand = bot.hand.filter(c => c.isJoker).length;
          if (wildsInSeq > 0 && wildsInHand - wildsInSeq === 0 && seq.length < 5) {
            const remainingAfter = bot.hand.length - seq.length;
            const canBaterNow = canTeamBater(teamState.games, s.gameMode, teamState.hasGottenDead);
            const deckLow = s.deck.length <= 8;
            if (remainingAfter > 1 && !canBaterNow && !deckLow && !accelerating) continue;
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
    // Para cada jogo, calcula o MAIOR delta de bônus de canastra alcançável adicionando
    // qualquer carta natural (não-coringa) da mão. Captura oportunidades de "limpar"
    // canastra suja (coringa cai na posição 2 natural quando o naipe se completa) que
    // a sort baseada só em tamanho/limpo não enxergava.
    const gameUpgradeDelta = teamGames.map(g => {
      const base = canastaBonusValue(g);
      let maxDelta = 0;
      for (const c of bot.hand) {
        if (c.isJoker) continue; // coringa nunca limpa; só naturais provocam upgrade
        if (validateSequence([...g, c], s.gameMode)) {
          const delta = canastaBonusValue([...g, c]) - base;
          if (delta > maxDelta) maxDelta = delta;
        }
      }
      return maxDelta;
    });
    const sortedIndices = Array.from({ length: teamGames.length }, (_, i) => i).sort((a, b) => {
      const aLen = teamGames[a].length;
      const bLen = teamGames[b].length;
      const aClean = !teamGames[a].some(c => c.isJoker);
      const bClean = !teamGames[b].some(c => c.isJoker);
      // Prioridade 1: jogo LIMPO de 6 cartas → fechar canastra limpa (+200)
      const aClosingClean = (aLen === 6 && aClean) ? 1 : 0;
      const bClosingClean = (bLen === 6 && bClean) ? 1 : 0;
      if (aClosingClean !== bClosingClean) return bClosingClean - aClosingClean;
      // Prioridade 2: jogo onde alguma carta da mão provoca upgrade de canastra
      // (suja→limpa, fechamento, 13/14 cartas). Vem ANTES de "fechar canastra suja"
      // porque limpar uma canastra suja vale mais (+100 de bônus) que estendê-la sem upgrade.
      if (gameUpgradeDelta[a] !== gameUpgradeDelta[b]) return gameUpgradeDelta[b] - gameUpgradeDelta[a];
      // Prioridade 3: jogo de 6 cartas (sujo) → fechar canastra suja (+100)
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
            // HARD RULE (sem exceção): canastra limpa de 500 (13) ou 1000 (14)
            // NUNCA é sujada. O trade -400/-900 vs +100 da batida é absurdo,
            // e o usuário pediu explicitamente "em hipótese alguma".
            if (game.length >= 13) continue;
            // Para canastras limpas de 7-12 cartas (200), só suja se for bater
            // em seguida e ainda sobrar outra canastra limpa para cumprir a condição.
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
            // No clássico, sujar é arriscado: sem canastra limpa separada, você
            // não pode bater. Protege QUALQUER candidata limpa viável (sem
            // coringa, qualquer tamanho) de ser suja — única via de canastra
            // LIMPA. INCLUI
            // fechar 6→7 sujo: dirty NÃO habilita bater, só destrói a via limpa
            // (report do usuário: "sapecou joker na 3-8♠ de 6 cartas, sem
            // canastra, começo de jogo"). O carve-out `closingCanasta` antigo era
            // o furo (sujava candidata de 6). Escape: indo bater no próximo lance
            // (mão ≤ 2). Candidata NÃO-viável segue fechando suja (senão o coringa
            // encalha num naipe sem saída).
            const allGames = freshState.teams[bot.teamId].games;
            const hasCleanCanastaElsewhere = allGames.some((g, i) => i !== gi && checkCanasta(g) === 'clean');
            if (!hasCleanCanastaElsewhere) {
              const opponentTeamId = bot.teamId === 'team-1' ? 'team-2' : 'team-1';
              const allTableGames = [...allGames, ...freshState.teams[opponentTeamId].games];
              const goingOutNext = freshBot.hand.length <= 2;
              if (!goingOutNext && !game.some(c => c.isJoker)
                  && canCleanCandidateGrow(game, allTableGames, freshBot.hand)) {
                continue;
              }
            }
            // Já tem canastra limpa: usa o coringa livremente (a canastra limpa em
            // si já está protegida pelo checkCanasta === 'clean' acima).
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

        // Não trava o coringa de uma canastra suja regatável metendo carta natural
        // no miolo (report: J♣ na [4..9♣ + 2♣] prende o 2♣ no 10). Escape: indo bater.
        const handNow = freshState.players.find(p => p.id === botId)?.hand.length ?? freshBot.hand.length;
        if (!card.isJoker && handNow > 2 && wouldLockRedeemableWild(game, card, freshState.gameMode)) continue;
        const combined = [...game, card];
        if (validateSequence(combined, freshState.gameMode)) {
          // Proteção extra: carta NORMAL também pode sujar canastra limpa
          // (ex.: jogar 9♠ num [A♠..7♠] força o 2♠ natural a sair da posição).
          // Bloqueia a menos que esteja indo bater AGORA e ainda sobre outra canastra limpa.
          if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') {
            // HARD RULE: nunca degrada canastra limpa de 500/1000, nem pra bater.
            if (game.length >= 13) continue;
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

  async function doBotDiscard(botId: PlayerId, pileTopId: string | null = null) {
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
    const heurCard = chooseBestDiscard(
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
    let cardId = heurCard.id;

    // Expert ('Difícil'): escolhe o descarte por busca PIMC (mesma estrutura do
    // pile-take — determinização + rollout, com correção de perigo de info real).
    // Async/fatiado pra não travar a UI; só offline. Fallback = heurística acima.
    const isExpertDiscard = !options.isOnline && fresh.botDifficulty === 'expert';
    if (isExpertDiscard && bot.hand.length > 1) {
      const pimcId = await pimcChooseDiscard(fresh, botId, {
        onYield: async () => { await delay(0); },
      });
      // Re-valida: o cômputo é async; estado pode ter mudado.
      const f2 = useGameStore.getState();
      if (f2.currentTurnPlayerId !== botId || f2.turnPhase !== 'play' || f2.roundOver) return;
      const f2bot = f2.players.find(p => p.id === botId);
      if (pimcId && f2bot && f2bot.hand.some(c => c.id === pimcId)) cardId = pimcId;
    }
    animate(); // anim do lixo
    useGameStore.getState().discard(botId, cardId);

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

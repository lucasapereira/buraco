import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, cardLabel } from '../game/deck';
import {
  BotDifficulty,
  GameEvent,
  GameMode,
  GameState,
  UndoState,
  PlayerId, TeamId,
  calculateRoundScore,
  createInitialGameState,
  getNextPlayer
} from '../game/engine';
import { canTakePile, sortCardsBySuitAndValue, sortGameCards, validateSequence, checkCanasta } from '../game/rules';

type TurnPhase = 'draw' | 'play' | 'discard';

interface GameActions {
  startNewGame: (targetScore?: number, difficulty?: BotDifficulty, gameMode?: GameMode) => void;
  startNewRound: () => void;
  startLayoutTest: () => void;
  drawFromDeck: (playerId: PlayerId) => void;
  drawFromPile: (playerId: PlayerId) => boolean; // false = não pode pegar (regra)
  discard: (playerId: PlayerId, cardId: string) => void;
  playCards: (playerId: PlayerId, cardIds: string[]) => boolean;
  addToExistingGame: (playerId: PlayerId, cardIds: string[], gameIndex: number) => boolean;
  undoLastPlay: (playerId: PlayerId) => boolean;
  applyRemoteState: (remoteState: Record<string, unknown>) => void;
}

let eventCounter = 0;

function makeEvent(
  playerId: PlayerId, playerName: string,
  type: GameEvent['type'], message: string, cardLabelStr?: string
): GameEvent {
  return {
    id: ++eventCounter,
    playerId, playerName, type, message,
    cardLabel: cardLabelStr,
    timestamp: Date.now(),
  };
}

function addLog(log: GameEvent[], event: GameEvent): GameEvent[] {
  return [...log.slice(-19), event]; // Mantém últimos 20 eventos
}

function createUndoState(state: GameState): UndoState {
  return {
    players: state.players,
    teams: state.teams,
    deads: state.deads,
    gameLog: state.gameLog,
    mustPlayPileTopId: state.mustPlayPileTopId,
  };
}

function getPlayerName(players: GameState['players'], id: PlayerId): string {
  return players.find(p => p.id === id)?.name || id;
}

function checkAndHandleDead(
  hand: Card[],
  teamHasGottenDead: boolean,
  deads: Card[][]
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

function checkRoundEnd(state: GameState, playerId: PlayerId): Partial<GameState> | null {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return null;

  if (player.hand.length === 0) {
    const team = state.teams[player.teamId];
    if (team.hasGottenDead || state.deads.length === 0) {
      const canGoOut = team.games.some(g => {
        if (g.length < 7) return false;
        if (state.gameMode === 'araujo_pereira') return true; // Any canasta works
        return checkCanasta(g) === 'clean'; // Must be clean for classic
      });

      if (canGoOut) {
        const t1Players = state.players.filter(p => p.teamId === 'team-1');
        const t2Players = state.players.filter(p => p.teamId === 'team-2');
        const t1Score = calculateRoundScore(state.teams['team-1'], t1Players, player.teamId === 'team-1');
        const t2Score = calculateRoundScore(state.teams['team-2'], t2Players, player.teamId === 'team-2');
        const newMatchScores = {
          'team-1': state.matchScores['team-1'] + t1Score,
          'team-2': state.matchScores['team-2'] + t2Score,
        };
        let winnerTeamId: TeamId | null = null;
        if (newMatchScores['team-1'] >= state.targetScore || newMatchScores['team-2'] >= state.targetScore) {
          winnerTeamId = newMatchScores['team-1'] >= newMatchScores['team-2'] ? 'team-1' : 'team-2';
        }
        return {
          roundOver: true,
          winnerTeamId,
          matchScores: newMatchScores,
          teams: {
            'team-1': { ...state.teams['team-1'], score: t1Score },
            'team-2': { ...state.teams['team-2'], score: t2Score },
          },
          gameLog: addLog(state.gameLog, makeEvent(
            player.id, getPlayerName(state.players, player.id),
            'round_end', `🏆 ${getPlayerName(state.players, player.id)} BATEU!`
          )),
        };
      }
    }
  }
  return null;
}

function teamHasCleanCanasta(state: GameState, teamId: TeamId, extraGame?: Card[]): boolean {
  const allGames = [...state.teams[teamId].games];
  if (extraGame) allGames.push(extraGame);

  return allGames.some(g => {
    if (g.length < 7) return false;
    if (state.gameMode === 'araujo_pereira') return true; // Any canasta is enough
    return checkCanasta(g) === 'clean';
  });
}

function wouldStrandPlayer(
  handAfterPlay: Card[], teamHasGottenDead: boolean,
  state: GameState, teamId: TeamId, extraGame?: Card[]
): boolean {
  // Considera que o jogador sempre terá que descartar uma carta ao final.
  // Se após jogar e descartar, ele ficaria com 0 cartas, verifica se ele pode "bater" ou pegar o morto.
  const finalCountAfterDiscard = handAfterPlay.length === 0 ? 0 : handAfterPlay.length - 1;

  if (finalCountAfterDiscard > 0) return false;
  if (!teamHasGottenDead && state.deads.length > 0) return false;
  return !teamHasCleanCanasta(state, teamId, extraGame);
}

import { persist, createJSONStorage } from 'zustand/middleware';

const persistentStorage = createJSONStorage(() => AsyncStorage);

export const useGameStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      ...createInitialGameState(),

  startNewGame: (targetScore = 3000, difficulty = 'medium' as BotDifficulty, gameMode = 'classic' as GameMode) => {
    eventCounter = 0;
    set(createInitialGameState(targetScore, difficulty, gameMode));
  },

  // Usado pelo modo online: aplica estado recebido do Firebase
  applyRemoteState: (remoteState: Record<string, unknown>) => {
    const { animatingDrawPlayerId, animatingDiscard, lastDrawnCardId: _ld, _writerUid, _writerInstanceId, ...rest } = remoteState as any;
    
    // Firebase exclui propriedades que são atribuídas como `null`.
    // Restauramos esses campos explicitamente para `null` caso não existam no payload.
    rest.mustPlayPileTopId = rest.mustPlayPileTopId !== undefined ? rest.mustPlayPileTopId : null;
    rest.winnerTeamId = rest.winnerTeamId !== undefined ? rest.winnerTeamId : null;
    
    // Firebase converte arrays vazios em null — restaura os campos críticos
    const localState = get();

    // Verifica se a notificação do Firebase pertence à MESMA rodada (ou nova).
    // Se for da MESMA rodada, a trava de hasGottenDead não permite reverter pra false.
    const remoteRoundNumber = rest.roundNumber ?? 1;
    if (remoteRoundNumber < localState.roundNumber) {
      return; // Ignora completamente pacotes atrasados de rodadas anteriores
    }
    const isSameRound = remoteRoundNumber === localState.roundNumber;

    if (rest.teams) {
      for (const teamId of ['team-1', 'team-2'] as const) {
        if (rest.teams[teamId]) {
          const t = rest.teams[teamId];
          // Firebase converte arrays corrompidos/encolhidos em objetos. Garantimos resiliência:
          let rawGames = t.games;
          if (rawGames && typeof rawGames === 'object' && !Array.isArray(rawGames)) {
            rawGames = Object.values(rawGames);
          }
          t.games = Array.isArray(rawGames) ? rawGames.map((g: any) => g ?? []) : [];
          if (t.hasGottenDead === undefined) t.hasGottenDead = false;

          // Protege contra reversão: checa tanto o team quanto qualquer player do team no estado local
          if (isSameRound && (
            localState.teams[teamId]?.hasGottenDead ||
            localState.players?.some((p: any) => p.teamId === teamId && p.hasGottenDead)
          )) {
            t.hasGottenDead = true;
          }
        }
      }
    }

    // --- Processa deads ANTES dos players para garantir consistência ---
    rest.pile             = Array.isArray(rest.pile)  ? rest.pile  : [];
    rest.deck             = Array.isArray(rest.deck)  ? rest.deck  : [];
    rest.gameLog          = rest.gameLog          ?? [];
    rest.turnHistory      = rest.turnHistory      ?? [];
    rest.discardedCardHistory = rest.discardedCardHistory ?? [];
    // Firebase agrupa arrays afetados por pop() transformando-os em objetos
    let rawDeads = rest.deads;
    if (rawDeads && typeof rawDeads === 'object' && !Array.isArray(rawDeads)) {
      rawDeads = Object.values(rawDeads);
    }
    if (Array.isArray(rawDeads)) {
      rest.deads = rawDeads
        .map((d: any) => {
          let inner = d;
          if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            inner = Object.values(inner);
          }
          return Array.isArray(inner) ? inner : null;
        })
        .filter((d: any) => d !== null && d.length > 0);
    } else {
      rest.deads = [];
    }

    // Protege deads: nunca pode aumentar dentro da mesma rodada (morto pego não volta)
    if (isSameRound && rest.deads.length > localState.deads.length) {
      rest.deads = localState.deads;
    }

    // Garante consistência entre hasGottenDead e deads:
    // Se N times pegaram morto, máximo de deads é 2 - N
    if (rest.teams) {
      const numTeamsWithDead = (['team-1', 'team-2'] as const).filter(
        tid => rest.teams[tid]?.hasGottenDead
      ).length;
      const maxDeads = 2 - numTeamsWithDead;
      if (rest.deads.length > maxDeads) {
        rest.deads = rest.deads.slice(0, maxDeads);
      }
    }

    if (Array.isArray(rest.players)) {
      rest.players = rest.players.map((p: any, i: number) => {
        const localPlayer = localState.players[i];
        const playerTeamId = p?.teamId ?? localPlayer?.teamId;
        let hgd = p?.hasGottenDead || false;
        // Protege contra reversão APENAS checando o próprio player local.
        // Se sincronizarmos com a flag do time, daremos a caveirinha (💀) para ambos os jogadores.
        if (isSameRound && localPlayer?.hasGottenDead) {
          hgd = true;
        }
        return {
          ...p,
          hand: p?.hand ?? [],
          hasGottenDead: hgd,
        };
      });
    }
    set(rest);
  },

  startNewRound: () => {
    const state = get();
    const fresh = createInitialGameState(state.targetScore, state.botDifficulty, state.gameMode);
    // Preserva os nomes reais dos jogadores (definidos pelo modo online ou pelo usuário)
    const freshPlayers = fresh.players.map((fp, i) => ({
      ...fp,
      name: state.players[i]?.name ?? fp.name,
    }));
    // Adiciona um evento de início de rodada para que a sincronização online
    // detecte a mudança (o subscribe compara referência do gameLog — sem este
    // evento o gameLog ficaria vazio e o subscriber nunca dispararia o sync).
    const roundStartEvent = makeEvent('user', 'Sistema', 'round_end', '▶ Nova rodada iniciada');
    set({
      ...fresh,
      players: freshPlayers,
      gameLog: [roundStartEvent],
      matchScores: state.matchScores,
      botDifficulty: state.botDifficulty,
      gameMode: state.gameMode,
      roundNumber: state.roundNumber + 1,
      gameId: state.gameId, // preserva o ID da partida entre rodadas
    });
  },

  startLayoutTest: () => {
    eventCounter = 0;
    // Helper para criar carta
    const c = (deck: 1|2, suit: 'spades'|'hearts'|'diamonds'|'clubs', value: number): Card => ({
      id: `${deck}-${suit}-${value}`,
      deck, suit,
      value: value as Card['value'],
      isJoker: value === 2,
    });

    // Jogos do time-1 (nós)
    const myGames: Card[][] = [
      // Canastra limpa: 3-4-5-6-7-8-9 de espadas
      [c(1,'spades',3),c(1,'spades',4),c(1,'spades',5),c(1,'spades',6),c(1,'spades',7),c(1,'spades',8),c(1,'spades',9)],
      // Canastra suja: 3-4-[joker]-6-7-8-9 de copas
      [c(1,'hearts',3),c(1,'hearts',4),c(1,'hearts',2),c(1,'hearts',6),c(1,'hearts',7),c(1,'hearts',8),c(1,'hearts',9)],
      // Jogo médio (5 cartas): 5-6-7-8-9 de ouros
      [c(1,'diamonds',5),c(1,'diamonds',6),c(1,'diamonds',7),c(1,'diamonds',8),c(1,'diamonds',9)],
      // Jogo curto (3 cartas): 10-J-Q de paus
      [c(1,'clubs',10),c(1,'clubs',11),c(1,'clubs',12)],
      // Jogo de 4: K-A-... wait, let me do J-Q-K-A de ouros
      [c(1,'diamonds',11),c(1,'diamonds',12),c(1,'diamonds',13),c(1,'diamonds',14)],
    ];

    // Jogos do time-2 (adversários)
    const opGames: Card[][] = [
      // Canastra suja: 5-6-[joker]-8-9-10-J de espadas
      [c(2,'spades',5),c(2,'spades',6),c(2,'spades',2),c(2,'spades',8),c(2,'spades',9),c(2,'spades',10),c(2,'spades',11)],
      // Jogo médio (4): 9-10-J-Q de paus
      [c(2,'clubs',9),c(2,'clubs',10),c(2,'clubs',11),c(2,'clubs',12)],
      // Jogo curto (3): 3-4-5 de ouros
      [c(2,'diamonds',3),c(2,'diamonds',4),c(2,'diamonds',5)],
      // Jogo longo (6): 6-7-8-9-10-J de copas
      [c(2,'hearts',6),c(2,'hearts',7),c(2,'hearts',8),c(2,'hearts',9),c(2,'hearts',10),c(2,'hearts',11)],
      // Jogo extra (3): 3-4-5 de espadas
      [c(2,'spades',3),c(2,'spades',4),c(2,'spades',5)],
    ];

    // Mão do usuário (10 cartas interessantes)
    const userHand: Card[] = [
      c(2,'diamonds',7), c(2,'diamonds',8), c(2,'diamonds',9), c(2,'diamonds',10), // pode estender nosso jogo de ouros
      c(2,'clubs',13), c(2,'clubs',14),                                             // K-A de paus
      c(2,'hearts',12), c(2,'hearts',13),                                           // Q-K de copas
      c(1,'diamonds',2),                                                            // curinga
      c(2,'spades',12),                                                             // Q de espadas
    ];

    // Mãos dos bots (5 cartas cada)
    const bot1Hand: Card[] = [c(1,'spades',10),c(1,'spades',11),c(1,'spades',12),c(1,'spades',13),c(1,'spades',14)];
    const bot2Hand: Card[] = [c(1,'hearts',10),c(1,'hearts',11),c(1,'hearts',12),c(1,'hearts',13),c(1,'hearts',14)];
    const bot3Hand: Card[] = [c(1,'clubs',3),c(1,'clubs',4),c(1,'clubs',5),c(1,'clubs',6),c(1,'clubs',7)];

    // Monte residual
    const deckCards: Card[] = [c(1,'clubs',8),c(1,'clubs',9),c(1,'clubs',13),c(1,'clubs',14),
      c(2,'clubs',3),c(2,'clubs',4),c(2,'clubs',5),c(2,'clubs',6),c(2,'clubs',7),c(2,'clubs',8),
      c(2,'hearts',3),c(2,'hearts',4),c(2,'hearts',5),c(2,'hearts',12),c(2,'hearts',13),c(2,'hearts',14),
      c(2,'diamonds',6),c(2,'diamonds',11),c(2,'diamonds',12),c(2,'diamonds',13),c(2,'diamonds',14),
      c(2,'spades',13),c(2,'spades',14),c(1,'diamonds',3),c(1,'diamonds',4),c(1,'diamonds',10),
    ];

    // Lixo (5 cartas, topo = 7 de espadas deck 2)
    const pileCards: Card[] = [c(2,'spades',7),c(2,'clubs',2),c(1,'hearts',5),c(1,'diamonds',2),c(2,'spades',6)];

    set({
      ...createInitialGameState(1500, 'hard', 'classic'),
      players: [
        { id: 'user', teamId: 'team-1', name: 'Você', hand: sortCardsBySuitAndValue(userHand), hasGottenDead: true },
        { id: 'bot-1', teamId: 'team-2', name: 'Adv 1', hand: sortCardsBySuitAndValue(bot1Hand), hasGottenDead: true },
        { id: 'bot-2', teamId: 'team-1', name: 'Parceiro', hand: sortCardsBySuitAndValue(bot2Hand), hasGottenDead: true },
        { id: 'bot-3', teamId: 'team-2', name: 'Adv 2', hand: sortCardsBySuitAndValue(bot3Hand), hasGottenDead: true },
      ],
      teams: {
        'team-1': { id: 'team-1', games: myGames, score: 0, hasGottenDead: true },
        'team-2': { id: 'team-2', games: opGames, score: 0, hasGottenDead: true },
      },
      deck: deckCards,
      pile: pileCards,
      deads: [],
      currentTurnPlayerId: 'user',
      turnPhase: 'play',
      matchScores: { 'team-1': 450, 'team-2': 300 },
      roundOver: false,
      winnerTeamId: null,
      lastDrawnCardId: null,
      mustPlayPileTopId: null,
      gameLog: [{ id: 1, playerId: 'user', playerName: 'SYS', type: 'draw_deck', message: '🔧 Modo Layout', timestamp: Date.now() }],
      discardedCardHistory: [],
      deckReshuffleCount: 0,
      turnHistory: [],
    });
  },

  drawFromDeck: (playerId) => {
    const state = get();
    if (state.currentTurnPlayerId !== playerId) return;
    if (state.turnPhase !== 'draw') return;

    const name = getPlayerName(state.players, playerId);

    // Monte esgotado?
    if (state.deck.length === 0) {
      // 1. Verifica se tem morto sobrando
      if (state.deads.length > 0) {
        const nextDeads = [...state.deads];
        const mortoParaMonte = nextDeads.pop()!;
        
        set((s) => ({
          deck: mortoParaMonte,
          deads: nextDeads,
          gameLog: addLog(s.gameLog, makeEvent(
            playerId, name, 'morto_to_deck',
            '📦 Monte esgotado! O MORTO foi para o MONTE!'
          )),
        }));
        
        // Tenta comprar novamente do novo monte
        get().drawFromDeck(playerId);
        return;
      }

      // 2. Se não tem morto, tenta o lixo (reembaralhamento)
      if (state.pile.length > 0) {
        const newReshuffleCount = state.deckReshuffleCount + 1;
        const MAX_RESHUFFLES = 3;

        if (newReshuffleCount >= MAX_RESHUFFLES) {
          const t1Players = state.players.filter(p => p.teamId === 'team-1');
          const t2Players = state.players.filter(p => p.teamId === 'team-2');
          const t1Score = calculateRoundScore(state.teams['team-1'], t1Players, false);
          const t2Score = calculateRoundScore(state.teams['team-2'], t2Players, false);
          const newMatchScores = {
            'team-1': state.matchScores['team-1'] + t1Score,
            'team-2': state.matchScores['team-2'] + t2Score,
          };
          let winnerTeamId: TeamId | null = null;
          if (newMatchScores['team-1'] >= state.targetScore || newMatchScores['team-2'] >= state.targetScore) {
            winnerTeamId = newMatchScores['team-1'] >= newMatchScores['team-2'] ? 'team-1' : 'team-2';
          }
          set({
            roundOver: true,
            winnerTeamId,
            matchScores: newMatchScores,
            teams: {
              'team-1': { ...state.teams['team-1'], score: t1Score },
              'team-2': { ...state.teams['team-2'], score: t2Score },
            },
            gameLog: addLog(state.gameLog, makeEvent(
              playerId, name, 'round_end', '⏹️ Baralho esgotado 3x — rodada encerrada!'
            )),
          });
          return;
        }

        const { shuffle } = require('../game/deck');
        const newDeck = shuffle([...state.pile]);
        set((s) => ({
          deck: newDeck,
          pile: [],
          deckReshuffleCount: newReshuffleCount,
          gameLog: addLog(s.gameLog, makeEvent(
            playerId, name, 'draw_deck',
            `🔀 Monte esgotado (${newReshuffleCount}/${MAX_RESHUFFLES}) — Lixo reembaralhado!`
          )),
        }));
        // Tenta comprar novamente
        get().drawFromDeck(playerId);
        return;
      }

      // 3. Monte, mortos e lixo vazios → encerra rodada (empate técnico / fim de cartas)
      const t1Players = state.players.filter(p => p.teamId === 'team-1');
      const t2Players = state.players.filter(p => p.teamId === 'team-2');
      const t1Score = calculateRoundScore(state.teams['team-1'], t1Players, false);
      const t2Score = calculateRoundScore(state.teams['team-2'], t2Players, false);
      const newMatchScores = {
        'team-1': state.matchScores['team-1'] + t1Score,
        'team-2': state.matchScores['team-2'] + t2Score,
      };
      let winnerTeamId: TeamId | null = null;
      if (newMatchScores['team-1'] >= state.targetScore || newMatchScores['team-2'] >= state.targetScore) {
        winnerTeamId = newMatchScores['team-1'] >= newMatchScores['team-2'] ? 'team-1' : 'team-2';
      }
      set({
        roundOver: true,
        winnerTeamId,
        matchScores: newMatchScores,
        teams: {
          'team-1': { ...state.teams['team-1'], score: t1Score },
          'team-2': { ...state.teams['team-2'], score: t2Score },
        },
        gameLog: addLog(state.gameLog, makeEvent(
          playerId, name, 'round_end', '🃏 Tudo esgotado — rodada encerrada!'
        )),
      });
      return;
    }

    // Caso normal: Deck tem cartas
    const nextDeck = [...state.deck];
    const drawnCard = nextDeck.pop()!;

    set((s) => {
      const playerIndex = s.players.findIndex(p => p.id === playerId);
      const updatedPlayers = [...s.players];
      updatedPlayers[playerIndex] = {
        ...updatedPlayers[playerIndex],
        hand: sortCardsBySuitAndValue([...updatedPlayers[playerIndex].hand, drawnCard]),
      };

      return {
        deck: nextDeck,
        players: updatedPlayers,
        turnPhase: 'play' as const,
        lastDrawnCardId: drawnCard.id,
        animatingDrawPlayerId: playerId,
        gameLog: addLog(s.gameLog, makeEvent(
          playerId, name, 'draw_deck',
          `${name} comprou do monte`,
          playerId === 'user' ? cardLabel(drawnCard) : undefined
        )),
      };
    });

    setTimeout(() => {
      set({ animatingDrawPlayerId: null });
    }, 1500);
  },


  drawFromPile: (playerId) => {
    const state = get();
    if (state.currentTurnPlayerId !== playerId) return false;
    if (state.turnPhase !== 'draw') return false;
    if (state.pile.length === 0) return false;

    const name = getPlayerName(state.players, playerId);
    const player = state.players.find(p => p.id === playerId);
    if (!player) return false;

    // REGRA: só pode pegar o lixo se conseguir montar um jogo com o topo
    // EXCETO no modo Araujo Pereira, onde pegar o lixo é livre
    const topCardId = state.pile[state.pile.length - 1].id;
    let canTake = false;

    if (state.gameMode === 'araujo_pereira') {
      canTake = true; // Free to take
    } else {
      const teamGames = state.teams[player.teamId].games;
      canTake = canTakePile(player.hand, state.pile, teamGames, state.gameMode);
    }

    if (!canTake) return false;

    const pileCount = state.pile.length;

    set((s) => {
      const playerIndex = s.players.findIndex(p => p.id === playerId);
      const updatedPlayers = [...s.players];
      updatedPlayers[playerIndex] = {
        ...updatedPlayers[playerIndex],
        hand: sortCardsBySuitAndValue([...updatedPlayers[playerIndex].hand, ...s.pile]),
      };
      return {
        pile: [],
        players: updatedPlayers,
        turnPhase: 'play' as const,
        lastDrawnCardId: null,
        mustPlayPileTopId: topCardId,
        turnHistory: [],
        gameLog: addLog(s.gameLog, makeEvent(
          playerId, name, 'draw_pile',
          `${name} pegou o lixo (${pileCount} cartas)`
        )),
      };
    });
    return true;
  },

  discard: (playerId, cardId) => {
    const state = get();
    if (state.currentTurnPlayerId !== playerId) return;
    if (state.turnPhase !== 'play') return;

    // Bloqueia descarte se ainda não baixou jogo com o topo do lixo.
    // Verifica também se a carta ainda está na mão — se saiu, foi jogada de alguma forma
    if (state.mustPlayPileTopId !== null) {
      const player = state.players.find(p => p.id === playerId);
      const pileTopStillInHand = player?.hand.some(c => c.id === state.mustPlayPileTopId);
      
      if (pileTopStillInHand && state.gameMode !== 'araujo_pereira') {
        return; // Mandatory play in STBL
      }
      
      // Clear obligation if played or if in Araujo Pereira (where it's just a hint)
      set({ mustPlayPileTopId: null });
    }

    const name = getPlayerName(state.players, playerId);

    set((s) => {
      const playerIndex = s.players.findIndex(p => p.id === playerId);
      const teamId = s.players[playerIndex].teamId;
      const tState = s.teams[teamId];
      const hand = s.players[playerIndex].hand;
      const cardIndex = hand.findIndex(c => c.id === cardId);
      if (cardIndex === -1) return s;

      const discardedCard = hand[cardIndex];
      let newHand = [...hand];
      newHand.splice(cardIndex, 1);

      // REGRA: Não pode descartar a última carta se não tiver canastra (e já tiver pego o morto)
      if (newHand.length === 0) {
        const willGetDead = !tState.hasGottenDead && s.deads.length > 0;
        const hasCanasta = teamHasCleanCanasta(s, teamId);
        if (!willGetDead && !hasCanasta) {
          return s; // Bloqueia descarte ilegal
        }
      }

      const updatedPlayers = [...s.players];
      const { newHand: finalHand, gotDead, newDeads } = checkAndHandleDead(
        newHand, tState.hasGottenDead, s.deads
      );

      updatedPlayers[playerIndex] = {
        ...updatedPlayers[playerIndex],
        hand: finalHand,
        hasGottenDead: s.players[playerIndex].hasGottenDead || gotDead,
      };

      const nextPlayerId = getNextPlayer(playerId);

      let log = addLog(s.gameLog, makeEvent(
        playerId, name, 'discard',
        `${name} descartou ${cardLabel(discardedCard)}`,
        cardLabel(discardedCard)
      ));

      if (gotDead) {
        log = addLog(log, makeEvent(
          playerId, name, 'got_dead',
          `📦 ${name} pegou o MORTO!`
        ));
      }

      const baseUpdate = {
        pile: [...s.pile, discardedCard],
        players: updatedPlayers,
        currentTurnPlayerId: nextPlayerId,
        turnPhase: 'draw' as const,
        deads: newDeads,
        lastDrawnCardId: null,
        gameLog: log,
        discardedCardHistory: [...s.discardedCardHistory, discardedCard.id],
        turnHistory: [],
        teams: {
          ...s.teams,
          [teamId]: {
            ...tState,
            hasGottenDead: tState.hasGottenDead || gotDead,
          },
        },
      };

      const newState = { ...s, ...baseUpdate };
      const roundEnd = checkRoundEnd(newState, playerId);
      if (roundEnd) {
        return { ...baseUpdate, ...roundEnd };
      }

      setTimeout(() => {
        set({ animatingDiscard: null });
      }, 1500);

      return {
        ...baseUpdate,
        animatingDiscard: { playerId, card: discardedCard }
      };
    });
  },

  playCards: (playerId, cardIds) => {
    const state = get();
    if (state.currentTurnPlayerId !== playerId) return false;
    if (state.turnPhase !== 'play') return false;

    // REGRA: Primeira jogada após comprar o lixo DEVE ser criando um novo jogo com a carta do topo
    if (state.gameMode !== 'araujo_pereira' && state.mustPlayPileTopId && !cardIds.includes(state.mustPlayPileTopId)) {
      return false;
    }

    const player = state.players.find(p => p.id === playerId);
    if (!player) return false;

    const selectedCards = player.hand.filter(c => cardIds.includes(c.id));
    if (!validateSequence(selectedCards, state.gameMode)) return false;

    const remaining = player.hand.filter(c => !cardIds.includes(c.id));
    if (wouldStrandPlayer(remaining, state.teams[player.teamId].hasGottenDead, state, player.teamId, selectedCards)) {
      return false;
    }

    const name = getPlayerName(state.players, playerId);
    const cardsStr = sortCardsBySuitAndValue(selectedCards).map(c => cardLabel(c)).join(' ');

    set((s) => {
      const currentPlayer = s.players.find(p => p.id === playerId)!;
      const teamId = currentPlayer.teamId;
      const tState = s.teams[teamId];
      const rem = currentPlayer.hand.filter(c => !cardIds.includes(c.id));
      const playerIndex = s.players.findIndex(p => p.id === playerId);
      const updatedPlayers = [...s.players];

      const { newHand, gotDead, newDeads } = checkAndHandleDead(
        rem, tState.hasGottenDead, s.deads
      );

      updatedPlayers[playerIndex] = {
        ...currentPlayer,
        hand: newHand,
        hasGottenDead: currentPlayer.hasGottenDead || gotDead,
      };

      const orderedCards = sortGameCards(selectedCards);

      let log = addLog(s.gameLog, makeEvent(
        playerId, name, 'play_cards',
        `${name} baixou: ${cardsStr}`
      ));

      if (gotDead) {
        log = addLog(log, makeEvent(
          playerId, name, 'got_dead',
          `📦 ${name} pegou o MORTO!`
        ));
      }

      const baseUpdate = {
        players: updatedPlayers,
        deads: newDeads,
        gameLog: log,
        // Limpa obrigação se a carta do topo do lixo foi usada nesta jogada
        mustPlayPileTopId: (s.mustPlayPileTopId && cardIds.includes(s.mustPlayPileTopId)) ? null : s.mustPlayPileTopId,
        turnHistory: [...s.turnHistory, createUndoState(s)],
        teams: {
          ...s.teams,
          [teamId]: {
            ...tState,
            games: [...tState.games, orderedCards],
            hasGottenDead: tState.hasGottenDead || gotDead,
          },
        },
      };

      const newState = { ...s, ...baseUpdate };
      const roundEnd = checkRoundEnd(newState, playerId);
      if (roundEnd) {
        return { ...baseUpdate, ...roundEnd };
      }

      return baseUpdate;
    });

    return true;
  },

  addToExistingGame: (playerId, cardIds, gameIndex) => {
    const state = get();
    if (state.currentTurnPlayerId !== playerId) return false;
    if (state.turnPhase !== 'play') return false;

    // REGRA: Primeira jogada após comprar o lixo DEVE ser novo jogo. Não pode adicionar a jogo existente.
    if (state.gameMode !== 'araujo_pereira' && state.mustPlayPileTopId && !cardIds.includes(state.mustPlayPileTopId)) {
      return false;
    }

    const player = state.players.find(p => p.id === playerId);
    if (!player) return false;

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

    const name = getPlayerName(state.players, playerId);
    const cardsStr = selectedCards.map(c => cardLabel(c)).join(' ');

    set((s) => {
      const currentPlayer = s.players.find(p => p.id === playerId)!;
      const tState = s.teams[teamId];
      const rem = currentPlayer.hand.filter(c => !cardIds.includes(c.id));
      const playerIndex = s.players.findIndex(p => p.id === playerId);
      const updatedPlayers = [...s.players];

      const { newHand, gotDead, newDeads } = checkAndHandleDead(
        rem, tState.hasGottenDead, s.deads
      );

      updatedPlayers[playerIndex] = {
        ...currentPlayer,
        hand: newHand,
        hasGottenDead: currentPlayer.hasGottenDead || gotDead,
      };

      const orderedCombined = sortGameCards(combinedCards);
      const newGames = [...tState.games];
      newGames[gameIndex] = orderedCombined;

      let log = addLog(s.gameLog, makeEvent(
        playerId, name, 'add_to_game',
        `${name} adicionou ${cardsStr} ao jogo`
      ));

      if (gotDead) {
        log = addLog(log, makeEvent(
          playerId, name, 'got_dead',
          `📦 ${name} pegou o MORTO!`
        ));
      }

      const baseUpdate = {
        players: updatedPlayers,
        deads: newDeads,
        gameLog: log,
        mustPlayPileTopId: (s.mustPlayPileTopId && cardIds.includes(s.mustPlayPileTopId)) ? null : s.mustPlayPileTopId,
        turnHistory: [...s.turnHistory, createUndoState(s)],
        teams: {
          ...s.teams,
          [teamId]: {
            ...tState,
            games: newGames,
            hasGottenDead: tState.hasGottenDead || gotDead,
          },
        },
      };

      const newState = { ...s, ...baseUpdate };
      const roundEnd = checkRoundEnd(newState, playerId);
      if (roundEnd) {
        return { ...baseUpdate, ...roundEnd };
      }

      return baseUpdate;
    });

    return true;
  },

  undoLastPlay: (playerId) => {
    const state = get();
    if (state.currentTurnPlayerId !== playerId) return false;
    if (state.turnPhase !== 'play') return false;
    if (state.turnHistory.length === 0) return false;

    const previousState = state.turnHistory[state.turnHistory.length - 1];
    
    set((s) => ({
      ...s,
      players: previousState.players,
      teams: previousState.teams,
      deads: previousState.deads,
      gameLog: previousState.gameLog,
      mustPlayPileTopId: previousState.mustPlayPileTopId,
      turnHistory: s.turnHistory.slice(0, -1)
    }));
    return true;
  },
}), {
  name: 'buraco-game-storage',
  storage: persistentStorage,
  // Exclui estado transitório de animação — não faz sentido persistir
  partialize: (state) => {
    const { animatingDrawPlayerId, animatingDiscard, ...rest } = state as any;
    return rest;
  },
  // Limpa qualquer animação travada ao reabrir o app
  onRehydrateStorage: () => (state) => {
    if (state) {
      (state as any).animatingDrawPlayerId = null;
      (state as any).animatingDiscard = null;
    }
  },
}));

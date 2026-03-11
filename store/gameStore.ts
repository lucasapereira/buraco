import { create } from 'zustand';
import {
  GameState, GameEvent, createInitialGameState, PlayerId, TeamId,
  getNextPlayer, calculateRoundScore, BotDifficulty,
} from '../game/engine';
import { Card, cardLabel } from '../game/deck';
import { validateSequence, sortCardsBySuitAndValue, checkCanasta, sortGameCards, canTakePile } from '../game/rules';

type TurnPhase = 'draw' | 'play' | 'discard';

interface GameActions {
  startNewGame: (targetScore?: number, difficulty?: BotDifficulty) => void;
  startNewRound: () => void;
  drawFromDeck: (playerId: PlayerId) => void;
  drawFromPile: (playerId: PlayerId) => boolean; // false = não pode pegar (regra)
  discard: (playerId: PlayerId, cardId: string) => void;
  playCards: (playerId: PlayerId, cardIds: string[]) => boolean;
  addToExistingGame: (playerId: PlayerId, cardIds: string[], gameIndex: number) => boolean;
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

function getPlayerName(players: GameState['players'], id: PlayerId): string {
  return players.find(p => p.id === id)?.name || id;
}

function checkAndHandleDead(
  hand: Card[],
  player: { hasGottenDead: boolean },
  deads: Card[][]
): { newHand: Card[]; gotDead: boolean; newDeads: Card[][] } {
  let newHand = [...hand];
  let gotDead = false;
  const newDeads = [...deads];

  if (newHand.length === 0 && !player.hasGottenDead && newDeads.length > 0) {
    newHand = newDeads.pop()!;
    gotDead = true;
  }

  return { newHand: sortCardsBySuitAndValue(newHand), gotDead, newDeads };
}

function checkRoundEnd(state: GameState): Partial<GameState> | null {
  for (const player of state.players) {
    if (player.hand.length === 0 && player.hasGottenDead) {
      const team = state.teams[player.teamId];
      const hasCleanCanasta = team.games.some(g =>
        g.length >= 7 && g.filter(c => c.isJoker).length === 0
      );

      if (hasCleanCanasta) {
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

function teamHasCleanCanasta(teams: GameState['teams'], teamId: TeamId, extraGame?: Card[]): boolean {
  const allGames = [...teams[teamId].games];
  if (extraGame) allGames.push(extraGame);
  return allGames.some(g => g.length >= 7 && g.filter(c => c.isJoker).length === 0);
}

function wouldStrandPlayer(
  handAfterPlay: Card[], player: { hasGottenDead: boolean },
  deads: Card[][], teams: GameState['teams'], teamId: TeamId, extraGame?: Card[]
): boolean {
  if (handAfterPlay.length > 0) return false;
  if (!player.hasGottenDead && deads.length > 0) return false;
  return !teamHasCleanCanasta(teams, teamId, extraGame);
}

export const useGameStore = create<GameState & GameActions>((set, get) => ({
  ...createInitialGameState(),

  startNewGame: (targetScore = 3000, difficulty = 'medium' as BotDifficulty) => {
    eventCounter = 0;
    set(createInitialGameState(targetScore, difficulty));
  },

  startNewRound: () => {
    const state = get();
    const fresh = createInitialGameState(state.targetScore, state.botDifficulty);
    set({
      ...fresh,
      matchScores: state.matchScores,
      botDifficulty: state.botDifficulty,
    });
  },

  drawFromDeck: (playerId) => {
    const state = get();
    if (state.currentTurnPlayerId !== playerId) return;
    if (state.turnPhase !== 'draw') return;

    const name = getPlayerName(state.players, playerId);

    // Monte e Lixo ambos vazios → encerra rodada
    if (state.deck.length === 0 && state.pile.length === 0) {
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
        gameLog: addLog(state.gameLog, makeEvent(
          playerId, name, 'round_end', '🃏 Monte e Lixo esgotados — rodada encerrada!'
        )),
      });
      return;
    }

    // Monte vazio mas Lixo tem cartas → reembaralha lixo como novo monte
    if (state.deck.length === 0 && state.pile.length > 0) {
      const newReshuffleCount = state.deckReshuffleCount + 1;

      // Se já reembaralhamos 3 vezes → empate técnico, encerra rodada
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
      // Agora tenta comprar de novo
      get().drawFromDeck(playerId);
      return;
    }

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
        gameLog: addLog(s.gameLog, makeEvent(
          playerId, name, 'draw_deck',
          `${name} comprou do monte`,
          playerId === 'user' ? cardLabel(drawnCard) : undefined
        )),
      };
    });
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
    if (!canTakePile(player.hand, state.pile)) return false;

    const pileCount = state.pile.length;
    const pileTopId = state.pile[state.pile.length - 1].id;

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
        mustPlayPileTopId: pileTopId,
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
      if (pileTopStillInHand) return; // Ainda na mão, bloqueia
      // Não está mais na mão — limpa a obrigação silenciosamente
      set({ mustPlayPileTopId: null });
    }

    const name = getPlayerName(state.players, playerId);

    set((s) => {
      const playerIndex = s.players.findIndex(p => p.id === playerId);
      const hand = s.players[playerIndex].hand;
      const cardIndex = hand.findIndex(c => c.id === cardId);
      if (cardIndex === -1) return s;

      const discardedCard = hand[cardIndex];
      let newHand = [...hand];
      newHand.splice(cardIndex, 1);

      const updatedPlayers = [...s.players];
      const { newHand: finalHand, gotDead, newDeads } = checkAndHandleDead(
        newHand, s.players[playerIndex], s.deads
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
      };

      const newState = { ...s, ...baseUpdate };
      const roundEnd = checkRoundEnd(newState);
      if (roundEnd) {
        return { ...baseUpdate, ...roundEnd };
      }

      return baseUpdate;
    });
  },

  playCards: (playerId, cardIds) => {
    const state = get();
    if (state.currentTurnPlayerId !== playerId) return false;
    if (state.turnPhase !== 'play') return false;

    // REGRA: Primeira jogada após comprar o lixo DEVE ser criando um novo jogo com a carta do topo
    if (state.mustPlayPileTopId && !cardIds.includes(state.mustPlayPileTopId)) {
      return false;
    }

    const player = state.players.find(p => p.id === playerId);
    if (!player) return false;

    const selectedCards = player.hand.filter(c => cardIds.includes(c.id));
    if (!validateSequence(selectedCards)) return false;

    const remaining = player.hand.filter(c => !cardIds.includes(c.id));
    if (wouldStrandPlayer(remaining, player, state.deads, state.teams, player.teamId, selectedCards)) {
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
        rem, currentPlayer, s.deads
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
        teams: {
          ...s.teams,
          [teamId]: {
            ...tState,
            games: [...tState.games, orderedCards],
          },
        },
      };

      const newState = { ...s, ...baseUpdate };
      const roundEnd = checkRoundEnd(newState);
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
    if (state.mustPlayPileTopId) {
      return false;
    }

    const player = state.players.find(p => p.id === playerId);
    if (!player) return false;

    const teamId = player.teamId;
    const existingGame = state.teams[teamId].games[gameIndex];
    if (!existingGame) return false;

    const selectedCards = player.hand.filter(c => cardIds.includes(c.id));
    const combinedCards = [...existingGame, ...selectedCards];

    if (!validateSequence(combinedCards)) return false;

    const remaining = player.hand.filter(c => !cardIds.includes(c.id));
    if (wouldStrandPlayer(remaining, player, state.deads, state.teams, teamId, combinedCards)) {
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
        rem, currentPlayer, s.deads
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
        teams: {
          ...s.teams,
          [teamId]: {
            ...tState,
            games: newGames,
          },
        },
      };

      const newState = { ...s, ...baseUpdate };
      const roundEnd = checkRoundEnd(newState);
      if (roundEnd) {
        return { ...baseUpdate, ...roundEnd };
      }

      return baseUpdate;
    });

    return true;
  },
}));

/**
 * Harness headless para comparar shouldTakePile (baseline) vs shouldTakePileSmart (item #2).
 *
 * Roda N partidas completas com 4 bots. Time configurado com `smart=true` usa
 * `shouldTakePileSmart`, o outro usa `shouldTakePile`. Todas as outras decisões
 * (play, add, discard) são idênticas — isola o efeito da decisão de lixo.
 *
 * Rodar:  npx tsx scripts/botSim.ts
 */

import { Card, generateDeck, shuffle, cardLabel } from '../game/deck';
import {
  GameState, GameMode, PlayerId, TeamId, Player, TeamState,
  TURN_ORDER, getNextPlayer, calculateRoundScore,
} from '../game/engine';
import { validateSequence, checkCanasta, sortCardsBySuitAndValue, sortGameCards, canTakePile } from '../game/rules';
import {
  shouldTakePile,
  shouldTakePileSmart,
  findBestSequences,
  chooseBestDiscard,
  chooseBestDiscardSmart,
  canTeamBater,
  wouldDirtyGame,
  canCleanCandidateGrow,
  opponentRecentlyTookPile,
} from '../game/botHelpers';

// ─── Config ───────────────────────────────────────────────
const N_GAMES = 500;
const TARGET_SCORE = 1500;
const GAME_MODE: GameMode = 'classic';
const MAX_RESHUFFLES = 99; // sem cap prático, como a engine real

// Quais times usam as heurísticas "smart"
// SMART_PILE  = item #2 (shouldTakePileSmart, lookahead 1-ply ao pegar lixo)
// SMART_DISCARD = item #1 (chooseBestDiscardSmart, modelo de oponente por jogador)
const TEAM_SMART_PILE: Record<TeamId, boolean> = {
  'team-1': false,
  'team-2': false,
};
const TEAM_SMART_DISCARD: Record<TeamId, boolean> = {
  'team-1': false,
  'team-2': false,
};
// SMART_WILD = item #3 (wild-card discipline): bloqueia meld nova de 3 cartas com coringa
// Mergeado em produção — deixar ambos TRUE pra baseline refletir estado atual.
const TEAM_SMART_WILD: Record<TeamId, boolean> = {
  'team-1': true,
  'team-2': true,
};
// SMART_CLOSE = regra "não suje ao fechar canastra (6→7) se candidato limpo é viável"
const TEAM_SMART_CLOSE: Record<TeamId, boolean> = {
  'team-1': false,
  'team-2': false,
};

// ─── Inicialização ────────────────────────────────────────
function freshState(gameMode: GameMode): GameState {
  const allCards = shuffle(generateDeck(gameMode === 'classic'));
  const deads: Card[][] = [allCards.splice(0, 11), allCards.splice(0, 11)];
  const players: Player[] = [
    { id: 'user',  teamId: 'team-1', name: 'user',  hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
  ];
  const teams: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: [], score: 0, hasGottenDead: false },
    'team-2': { id: 'team-2', games: [], score: 0, hasGottenDead: false },
  };
  const initialPileCard = allCards.pop()!;
  return {
    players, teams,
    deck: allCards,
    pile: [initialPileCard],
    deads,
    currentTurnPlayerId: 'user',
    turnPhase: 'draw',
    winnerTeamId: null,
    roundOver: false,
    targetScore: TARGET_SCORE,
    matchScores: { 'team-1': 0, 'team-2': 0 },
    gameLog: [],
    lastDrawnCardId: null,
    gameMode,
    discardedCardHistory: [],
    mustPlayPileTopId: null,
    deckReshuffleCount: 0,
    turnHistory: [],
    roundNumber: 1,
    gameId: Math.random().toString(36).slice(2, 10),
  };
}

// Nova rodada mantendo o placar da partida
function newRound(prev: GameState): GameState {
  const fresh = freshState(prev.gameMode);
  fresh.targetScore = prev.targetScore;
  fresh.matchScores = { ...prev.matchScores };
  fresh.roundNumber = prev.roundNumber + 1;
  fresh.gameId = prev.gameId;
  // Dealer rotation — usa jogador que começa como roundNumber % 4
  fresh.currentTurnPlayerId = TURN_ORDER[prev.roundNumber % 4];
  return fresh;
}

// ─── Mecânica de turno (versão enxuta, sem animações) ─────
function playerOf(s: GameState, id: PlayerId): Player {
  return s.players.find(p => p.id === id)!;
}
function teamOf(s: GameState, id: PlayerId): TeamState {
  return s.teams[playerOf(s, id).teamId];
}
function updatePlayerHand(s: GameState, id: PlayerId, newHand: Card[], hasGottenDead?: boolean): void {
  const p = playerOf(s, id);
  p.hand = sortCardsBySuitAndValue(newHand);
  if (hasGottenDead !== undefined) p.hasGottenDead = hasGottenDead;
}
function teamHasCleanCanasta(teamGames: Card[][], gameMode: GameMode, extraGame?: Card[]): boolean {
  const all = extraGame ? [...teamGames, extraGame] : teamGames;
  return all.some(g => {
    if (g.length < 7) return false;
    if (gameMode === 'araujo_pereira') return true;
    return checkCanasta(g) === 'clean';
  });
}

/** Retorna true se a jogada tiraria o jogador sem conseguir bater nem pegar morto. */
function wouldStrand(s: GameState, playerId: PlayerId, remaining: Card[], extraGame?: Card[]): boolean {
  const team = teamOf(s, playerId);
  const canBaterAfter = (() => {
    const tempGames = extraGame ? [...team.games, extraGame] : team.games;
    return s.gameMode === 'araujo_pereira'
      ? tempGames.some(g => g.length >= 7)
      : tempGames.some(g => g.length >= 7 && checkCanasta(g) === 'clean');
  })();
  // remaining=0 (vai pegar morto ou bater): ok se já pegou morto e pode bater, OU tem morto disponível
  if (remaining.length === 0) {
    if (team.hasGottenDead) return !canBaterAfter;
    return s.deads.length === 0 && !canBaterAfter;
  }
  // remaining=1 (precisa descartar última): ok se descartar trigger pegar morto OU bater
  if (remaining.length === 1) {
    const willGetDeadOnDiscard = !team.hasGottenDead && s.deads.length > 0;
    if (willGetDeadOnDiscard) return false; // descartar vai pegar morto — caminho válido
    return !canBaterAfter; // caso contrário, precisa poder bater
  }
  return false;
}

/** Trata pegar morto quando mão zera e time ainda não pegou. */
function handleDeadIfApplicable(s: GameState, playerId: PlayerId): void {
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  if (p.hand.length === 0 && !team.hasGottenDead && s.deads.length > 0) {
    const popped = s.deads.pop()!;
    updatePlayerHand(s, playerId, popped, true);
    team.hasGottenDead = true;
  }
}

/** Verifica se bateu (hand 0, team can bater). Retorna true se a rodada terminou. */
function checkBater(s: GameState, playerId: PlayerId): boolean {
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  if (p.hand.length !== 0) return false;
  if (!team.hasGottenDead && s.deads.length > 0) return false; // pegou morto em vez de bater
  if (!canTeamBater(team.games, s.gameMode, team.hasGottenDead)) return false;
  endRound(s, true, team.id);
  return true;
}

function endRound(s: GameState, wentOut: boolean, lastPlayerTeamId?: TeamId): void {
  const t1Players = s.players.filter(p => p.teamId === 'team-1');
  const t2Players = s.players.filter(p => p.teamId === 'team-2');
  const t1Score = calculateRoundScore(s.teams['team-1'], t1Players, wentOut && lastPlayerTeamId === 'team-1');
  const t2Score = calculateRoundScore(s.teams['team-2'], t2Players, wentOut && lastPlayerTeamId === 'team-2');
  s.teams['team-1'].score = t1Score;
  s.teams['team-2'].score = t2Score;
  s.matchScores['team-1'] += t1Score;
  s.matchScores['team-2'] += t2Score;
  s.roundOver = true;
  if (s.matchScores['team-1'] >= s.targetScore || s.matchScores['team-2'] >= s.targetScore) {
    s.winnerTeamId = s.matchScores['team-1'] >= s.matchScores['team-2'] ? 'team-1' : 'team-2';
  }
}

function drawFromDeck(s: GameState, playerId: PlayerId): boolean {
  // Monte esgotado
  while (s.deck.length === 0) {
    if (s.deads.length > 0) {
      // Morto vira monte (regra oficial — só quando time já pegou outro morto ou está vazio, mas aqui só se tiver sobrando)
      s.deck = s.deads.pop()!;
      continue;
    }
    if (s.pile.length > 0) {
      s.deckReshuffleCount += 1;
      if (s.deckReshuffleCount >= MAX_RESHUFFLES) {
        endRound(s, false);
        return false;
      }
      s.deck = shuffle([...s.pile]);
      s.pile = [];
      continue;
    }
    // Tudo vazio
    endRound(s, false);
    return false;
  }
  const drawn = s.deck.pop()!;
  const p = playerOf(s, playerId);
  updatePlayerHand(s, playerId, [...p.hand, drawn]);
  s.lastDrawnCardId = drawn.id;
  s.turnPhase = 'play';
  return true;
}

// Histórico por jogador — usado pelo modelo de oponente (item #1)
const perPlayerPickedUp: Record<PlayerId, Card[]> = { 'user': [], 'bot-1': [], 'bot-2': [], 'bot-3': [] };
const perPlayerDiscarded: Record<PlayerId, Card[]> = { 'user': [], 'bot-1': [], 'bot-2': [], 'bot-3': [] };
function resetPerPlayerHistories(): void {
  for (const id of ['user', 'bot-1', 'bot-2', 'bot-3'] as PlayerId[]) {
    perPlayerPickedUp[id] = [];
    perPlayerDiscarded[id] = [];
  }
}

// ─── Discriminador de item #1 ─────────────────────────────
// Conta quantas vezes chooseBestDiscardSmart escolhe carta DIFERENTE de chooseBestDiscard
// no mesmo estado de mão/histórico. Ativo quando um dos times tem TEAM_SMART_DISCARD=true.
const discardDiff = { total: 0, diff: 0 };

// ─── Instrumentação de leak de coringa (item #3 diagnóstico) ──────
// Conta, por time, onde coringas entram em mesa e quantos ficam encalhados na mão
// ao final da rodada. Natural-slot (2 de copas numa seq de copas) NÃO conta como leak.
type WildLeakStats = {
  inNewMeld: number;                // #coringas em meld nova
  inNewMeldBySize: number[];        // tamanho da meld na hora do play (inclui o coringa)
  inNewMeldTurnsIntoRound: number[]; // turnos decorridos quando a meld com coringa entrou
  addedToGame: number;              // #coringas adicionados a jogo existente (que sujaram)
  addedToGameSizeBefore: number[];  // tamanho do jogo ANTES da adição
  strandedAtRoundEnd: number;       // #coringas nas mãos dos jogadores do time ao fim da rodada
};
const wildLeak: Record<TeamId, WildLeakStats> = {
  'team-1': { inNewMeld: 0, inNewMeldBySize: [], inNewMeldTurnsIntoRound: [], addedToGame: 0, addedToGameSizeBefore: [], strandedAtRoundEnd: 0 },
  'team-2': { inNewMeld: 0, inNewMeldBySize: [], inNewMeldTurnsIntoRound: [], addedToGame: 0, addedToGameSizeBefore: [], strandedAtRoundEnd: 0 },
};
// Contador de turnos transcorridos na rodada corrente (incrementado em runBotTurn)
let currentRoundTurnCount = 0;

/** Quantos coringas neste seq atuam como wild (não-natural). */
function countNonNaturalWilds(seq: Card[], gameMode: GameMode): number {
  const jokers = seq.filter(c => c.isJoker);
  if (jokers.length === 0) return 0;
  if (gameMode !== 'classic') {
    // Trincas em araujo_pereira: coringa nunca tem posição natural — todo coringa é wild.
    return jokers.length;
  }
  const normalInSeq = seq.filter(c => !c.isJoker);
  if (normalInSeq.length === 0) return jokers.length;
  const allSameValue = normalInSeq.every(c => c.value === normalInSeq[0].value);
  if (allSameValue) return jokers.length; // trinca em classic (não deveria ocorrer, mas safe)
  const seqSuit = normalInSeq[0].suit;
  let wilds = 0;
  for (const j of jokers) {
    if (j.suit === 'joker') wilds++;        // coringa físico
    else if (j.suit !== seqSuit) wilds++;   // 2 de naipe errado
    // else: 2 no naipe certo — carta natural, não conta
  }
  return wilds;
}

function drawFromPile(s: GameState, playerId: PlayerId): boolean {
  if (s.pile.length === 0) return false;
  const p = playerOf(s, playerId);
  const teamGames = teamOf(s, playerId).games;
  if (s.gameMode !== 'araujo_pereira') {
    if (!canTakePile(p.hand, s.pile, teamGames, s.gameMode)) return false;
  }
  const topCard = s.pile[s.pile.length - 1];
  perPlayerPickedUp[playerId].push(...s.pile);
  updatePlayerHand(s, playerId, [...p.hand, ...s.pile]);
  s.pile = [];
  s.lastDrawnCardId = topCard.id;
  s.turnPhase = 'play';
  if (s.gameMode !== 'araujo_pereira') {
    s.mustPlayPileTopId = topCard.id;
  }
  return true;
}

function playCards(s: GameState, playerId: PlayerId, cardIds: string[]): boolean {
  if (s.turnPhase !== 'play') return false;
  const p = playerOf(s, playerId);
  if (s.gameMode !== 'araujo_pereira' && s.mustPlayPileTopId && !cardIds.includes(s.mustPlayPileTopId)) return false;
  const selected = p.hand.filter(c => cardIds.includes(c.id));
  if (selected.length !== cardIds.length) return false;
  if (!validateSequence(selected, s.gameMode)) return false;
  const remaining = p.hand.filter(c => !cardIds.includes(c.id));
  if (wouldStrand(s, playerId, remaining, selected)) return false;

  const team = teamOf(s, playerId);
  team.games.push(sortGameCards(selected));
  updatePlayerHand(s, playerId, remaining);
  s.mustPlayPileTopId = null;
  handleDeadIfApplicable(s, playerId);
  // Instrumentation: contar coringas wild na meld nova
  const wildsInSeq = countNonNaturalWilds(selected, s.gameMode);
  if (wildsInSeq > 0) {
    wildLeak[team.id].inNewMeld += wildsInSeq;
    wildLeak[team.id].inNewMeldBySize.push(selected.length);
    wildLeak[team.id].inNewMeldTurnsIntoRound.push(currentRoundTurnCount);
  }
  return true;
}

function addToExistingGame(s: GameState, playerId: PlayerId, cardIds: string[], gameIndex: number): boolean {
  if (s.turnPhase !== 'play') return false;
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  const game = team.games[gameIndex];
  if (!game) return false;
  if (s.gameMode !== 'araujo_pereira' && s.mustPlayPileTopId && !cardIds.includes(s.mustPlayPileTopId)) return false;
  const selected = p.hand.filter(c => cardIds.includes(c.id));
  if (selected.length !== cardIds.length) return false;
  const combined = [...game, ...selected];
  if (!validateSequence(combined, s.gameMode)) return false;
  const remaining = p.hand.filter(c => !cardIds.includes(c.id));
  if (wouldStrand(s, playerId, remaining)) return false;

  // Instrumentation: coringas que sujam jogo existente
  const gameSizeBefore = game.length;
  for (const c of selected) {
    if (c.isJoker && wouldDirtyGame(c, game)) {
      wildLeak[team.id].addedToGame += 1;
      wildLeak[team.id].addedToGameSizeBefore.push(gameSizeBefore);
    }
  }

  team.games[gameIndex] = sortGameCards(combined);
  updatePlayerHand(s, playerId, remaining);
  s.mustPlayPileTopId = null;
  handleDeadIfApplicable(s, playerId);
  return true;
}

function discard(s: GameState, playerId: PlayerId, cardId: string): boolean {
  if (s.turnPhase !== 'play') return false;
  if (s.mustPlayPileTopId !== null) return false;
  const p = playerOf(s, playerId);
  const card = p.hand.find(c => c.id === cardId);
  if (!card) return false;
  const remainingAfter = p.hand.length - 1;
  if (remainingAfter === 0) {
    const team = teamOf(s, playerId);
    const willGetDead = !team.hasGottenDead && s.deads.length > 0;
    const canBater = canTeamBater(team.games, s.gameMode, team.hasGottenDead);
    if (!willGetDead && !canBater) return false; // não pode descartar última
  }
  updatePlayerHand(s, playerId, p.hand.filter(c => c.id !== cardId));
  s.pile = [...s.pile, card];
  s.discardedCardHistory = [...s.discardedCardHistory, card.id];
  perPlayerDiscarded[playerId].push(card);
  // Se descartou a última carta e time ainda não pegou morto, pega agora
  const postTeam = teamOf(s, playerId);
  if (p.hand.length === 0 && !postTeam.hasGottenDead && s.deads.length > 0) {
    const dead = s.deads.pop()!;
    updatePlayerHand(s, playerId, sortCardsBySuitAndValue(dead), true);
    postTeam.hasGottenDead = true;
  }
  return true;
}

// ─── Orquestração do turno do bot ─────────────────────────
const DIFFICULTY = 'hard' as const;

function chooseTakePile(s: GameState, playerId: PlayerId): boolean {
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  const useSmart = TEAM_SMART_PILE[team.id];
  const fn = useSmart ? shouldTakePileSmart : shouldTakePile;
  return fn(s.pile, p.hand, DIFFICULTY, team.games, s.gameMode);
}

/** Tenta jogar uma meld contendo o pileTopId (obrigatório após pegar lixo clássico). */
function playWithPileTop(s: GameState, playerId: PlayerId, pileTopId: string): void {
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  const topCard = p.hand.find(c => c.id === pileTopId);
  if (!topCard) { s.mustPlayPileTopId = null; return; }

  const gameIndices = team.games.map((_, i) => i).sort((a, b) => {
    const aClean = checkCanasta(team.games[a]) === 'clean' ? 1 : 0;
    const bClean = checkCanasta(team.games[b]) === 'clean' ? 1 : 0;
    return aClean - bClean; // limpas por último
  });

  // (1) adiciona só o topo a jogo existente (sem sujar)
  for (const gi of gameIndices) {
    const game = team.games[gi];
    if (topCard.isJoker && wouldDirtyGame(topCard, game)) continue;
    if (validateSequence([...game, topCard], s.gameMode)) {
      const combined = [...game, topCard];
      if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
      if (addToExistingGame(s, playerId, [pileTopId], gi)) return;
    }
  }
  // (2) adiciona topo + 1-2 cartas da mão a jogo existente
  for (const gi of gameIndices) {
    const game = team.games[gi];
    if (topCard.isJoker && wouldDirtyGame(topCard, game)) continue;
    for (const c of p.hand) {
      if (c.id === pileTopId) continue;
      const combined = [...game, topCard, c];
      if (validateSequence(combined, s.gameMode)) {
        if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
        if (addToExistingGame(s, playerId, [pileTopId, c.id], gi)) return;
      }
    }
  }
  // (3) forma nova sequência com o topo
  const sequences = findBestSequences(p.hand, s.gameMode);
  for (const seq of sequences) {
    if (!seq.some(c => c.id === pileTopId)) continue;
    if (playCards(s, playerId, seq.map(c => c.id))) return;
  }
  // (4) brute-force — 3 cartas do mesmo naipe com o topo
  const sameSuit = p.hand.filter(c => !c.isJoker && c.suit === topCard.suit && c.id !== pileTopId);
  for (let i = 0; i < sameSuit.length; i++) {
    for (let j = i + 1; j < sameSuit.length; j++) {
      if (playCards(s, playerId, [pileTopId, sameSuit[i].id, sameSuit[j].id])) return;
    }
  }
  // fallback — limpa obrigação
  s.mustPlayPileTopId = null;
}

function playSequencesPhase(s: GameState, playerId: PlayerId): void {
  for (let iter = 0; iter < 5; iter++) {
    const p = playerOf(s, playerId);
    const team = teamOf(s, playerId);
    if (p.hand.length === 0) return;
    const accelerating = canTeamBater(team.games, s.gameMode, team.hasGottenDead) && p.hand.length <= 5;
    const sequences = findBestSequences(p.hand, s.gameMode);
    let played = false;
    for (const seq of sequences) {
      const normalCards = seq.filter(c => !c.isJoker);
      if (normalCards.length > 0) {
        const isTrinca = normalCards.every(c => c.value === normalCards[0].value);
        const value = normalCards[0].value;
        const suit = normalCards[0].suit;
        const hasDuplicateGame = team.games.some(g => {
          const gNormal = g.filter(c => !c.isJoker);
          if (gNormal.length === 0) return false;
          if (isTrinca) {
            const gIsTrinca = gNormal.every(c => c.value === gNormal[0].value);
            return gIsTrinca && gNormal[0].value === value;
          } else {
            const gIsTrinca = gNormal.every(c => c.value === gNormal[0].value);
            return !gIsTrinca && gNormal[0].suit === suit;
          }
        });
        const remainingCards = p.hand.length - seq.length;
        const goingToBaterOrDead = remainingCards <= 1;
        if (hasDuplicateGame && seq.length < 6 && !goingToBaterOrDead && !accelerating) continue;
      }
      // guarda coringa em novo meld (clássico) se ainda há candidato a canastra limpa viável
      if (s.gameMode === 'classic' && seq.some(c => c.isJoker)) {
        const normalInSeq = seq.filter(c => !c.isJoker);
        const seqSuit = normalInSeq.length > 0 ? normalInSeq[0].suit : null;
        const allJokersNatural = seq.filter(c => c.isJoker).every(j => j.suit !== 'joker' && j.suit === seqSuit);
        if (!allJokersNatural) {
          const hasCleanCanasta = team.games.some(g => checkCanasta(g) === 'clean');
          if (!hasCleanCanasta) {
            const remainingAfter = p.hand.length - seq.length;
            const goingForDead = remainingAfter <= 1 && !team.hasGottenDead;
            if (!goingForDead) {
              const oppTeamId: TeamId = team.id === 'team-1' ? 'team-2' : 'team-1';
              const allTableGames = [...team.games, ...s.teams[oppTeamId].games];
              const cleanCandidates = team.games.filter(g => !g.some(c => c.isJoker) && g.length >= 5);
              const hasViable = cleanCandidates.some(g => canCleanCandidateGrow(g, allTableGames, p.hand));
              if (hasViable) continue;
              // SMART_WILD (item #3): também bloqueia meld nova de 3 cartas com coringa
              // antes do time ter qualquer canastra — previne "comprometer" suit com coringa cedo.
              if (TEAM_SMART_WILD[team.id] && seq.length === 3) continue;
            }
          }
        }
      }
      if (playCards(s, playerId, seq.map(c => c.id))) {
        played = true;
        break;
      }
    }
    if (!played) return;
    if (s.roundOver) return;
  }
}

function addToGamesPhase(s: GameState, playerId: PlayerId): void {
  const team = teamOf(s, playerId);
  const p = playerOf(s, playerId);
  const jokerSuits = new Set(p.hand.filter(c => c.isJoker && c.suit !== 'joker').map(c => c.suit));
  const sortedIndices = team.games.map((_, i) => i).sort((a, b) => {
    const aLen = team.games[a].length;
    const bLen = team.games[b].length;
    const aClean = !team.games[a].some(c => c.isJoker);
    const bClean = !team.games[b].some(c => c.isJoker);
    const aClosingClean = (aLen === 6 && aClean) ? 1 : 0;
    const bClosingClean = (bLen === 6 && bClean) ? 1 : 0;
    if (aClosingClean !== bClosingClean) return bClosingClean - aClosingClean;
    const aClosing = aLen === 6 ? 1 : 0;
    const bClosing = bLen === 6 ? 1 : 0;
    if (aClosing !== bClosing) return bClosing - aClosing;
    const aNormal = team.games[a].filter(c => !c.isJoker);
    const bNormal = team.games[b].filter(c => !c.isJoker);
    const aMatch = aNormal.length > 0 && jokerSuits.has(aNormal[0].suit) ? 1 : 0;
    const bMatch = bNormal.length > 0 && jokerSuits.has(bNormal[0].suit) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    if (aClean !== bClean) return aClean ? -1 : 1;
    if (aLen !== bLen) return bLen - aLen;
    return 0;
  });

  for (const gi of sortedIndices) {
    let moved = true;
    while (moved) {
      moved = false;
      const pNow = playerOf(s, playerId);
      for (const card of [...pNow.hand]) {
        const game = team.games[gi];
        if (!game) break;
        if (card.isJoker && wouldDirtyGame(card, game)) {
          if (game.some(c => c.isJoker)) continue;
          if (checkCanasta(game) === 'clean') {
            const goingOutNext = pNow.hand.length <= 2;
            const cleanCanastas = team.games.filter(g => checkCanasta(g) === 'clean');
            if (!goingOutNext || cleanCanastas.length <= 1) continue;
          }
          if (s.gameMode === 'classic') {
            // preserva candidatos viáveis a canastra limpa
            const oppTeamId: TeamId = team.id === 'team-1' ? 'team-2' : 'team-1';
            const allTableGames = [...team.games, ...s.teams[oppTeamId].games];
            const hasCleanElsewhere = team.games.some((g, idx) => idx !== gi && checkCanasta(g) === 'clean');
            if (!hasCleanElsewhere) {
              const cleanCandidates = team.games.filter(g => !g.some(c => c.isJoker) && g.length >= 5);
              const closingCanasta = game.length === 6;
              // SMART_CLOSE: ao fechar (size 6→7), também protege se candidato viável existir.
              // Escape: goingOutNext — bater agora vale o dirty close.
              const goingOutNext = pNow.hand.length <= 2 && canTeamBater([...team.games.slice(0, gi), [...game, card], ...team.games.slice(gi + 1)], s.gameMode, team.hasGottenDead);
              const smartCloseActive = TEAM_SMART_CLOSE[team.id] && !goingOutNext;
              if (cleanCandidates.length <= 1 && !game.some(c => c.isJoker) && game.length >= 5) {
                const isViable = canCleanCandidateGrow(game, allTableGames, pNow.hand);
                if (isViable && (!closingCanasta || smartCloseActive)) continue;
              } else if (!closingCanasta || smartCloseActive) {
                const thisIsViable = canCleanCandidateGrow(game, allTableGames, pNow.hand);
                if (thisIsViable) continue;
              }
            }
          }
        }
        if (validateSequence([...game, card], s.gameMode)) {
          const combined = [...game, card];
          if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') {
            const goingOutNext = pNow.hand.length <= 2;
            const otherClean = team.games.filter((g, idx) => idx !== gi && checkCanasta(g) === 'clean').length;
            if (!goingOutNext || otherClean === 0) continue;
          }
          if (addToExistingGame(s, playerId, [card.id], gi)) {
            moved = true;
            break;
          }
        }
      }
    }
  }
}

export let DEBUG_LOG = false;
function dlog(...args: any[]) { if (DEBUG_LOG) console.log('   ', ...args); }

function runBotTurn(s: GameState, playerId: PlayerId): void {
  currentRoundTurnCount++;
  const p0 = playerOf(s, playerId);
  dlog(`turn ${playerId} (hand=${p0.hand.length}, phase=${s.turnPhase}, pile=${s.pile.length}, deck=${s.deck.length}, must=${s.mustPlayPileTopId})`);
  // Draw — só se estiver em draw phase
  if (s.turnPhase === 'draw') {
    if (chooseTakePile(s, playerId)) {
      dlog(`  take pile (${s.pile.length} cards)`);
      if (!drawFromPile(s, playerId)) {
        dlog(`  drawPile failed, fallback deck`);
        if (!drawFromDeck(s, playerId)) return;
      }
    } else {
      if (!drawFromDeck(s, playerId)) { dlog(`  drawDeck returned false, roundOver=${s.roundOver}`); return; }
    }
  }
  if (s.roundOver) return;
  dlog(`  after draw: hand=${playerOf(s, playerId).hand.length}, phase=${s.turnPhase}, must=${s.mustPlayPileTopId}`);

  // Play
  if (s.mustPlayPileTopId) {
    playWithPileTop(s, playerId, s.mustPlayPileTopId);
  }
  addToGamesPhase(s, playerId);
  playSequencesPhase(s, playerId);
  addToGamesPhase(s, playerId);

  // Se bateu durante o play, encerra
  if (checkBater(s, playerId)) return;

  // Discard
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  if (p.hand.length === 0) {
    // Pegou morto — precisa descartar alguma carta do morto
  }
  if (p.hand.length > 0) {
    const oppTeamId: TeamId = team.id === 'team-1' ? 'team-2' : 'team-1';
    const oppGames = s.teams[oppTeamId].games;
    const oppIds = s.players.filter(pl => pl.teamId === oppTeamId).map(pl => pl.id);
    const tookPile = opponentRecentlyTookPile(s.gameLog as any, oppIds);
    const useSmartDiscard = TEAM_SMART_DISCARD[team.id];
    let card: Card;
    if (useSmartDiscard) {
      const oppPickedUp: Record<string, Card[]> = {};
      const oppDiscarded: Record<string, Card[]> = {};
      for (const oid of oppIds) {
        oppPickedUp[oid] = perPlayerPickedUp[oid];
        oppDiscarded[oid] = perPlayerDiscarded[oid];
      }
      const smartCard = chooseBestDiscardSmart(
        p.hand, s.discardedCardHistory, DIFFICULTY, s.lastDrawnCardId, s.gameMode,
        team.games, null, oppGames, tookPile, oppPickedUp, oppDiscarded
      );
      // Discriminador: compara com a escolha do baseline no mesmo estado
      const baselineCard = chooseBestDiscard(
        p.hand, s.discardedCardHistory, DIFFICULTY, s.lastDrawnCardId, s.gameMode,
        team.games, null, oppGames, tookPile
      );
      discardDiff.total++;
      if (smartCard.id !== baselineCard.id) discardDiff.diff++;
      card = smartCard;
    } else {
      card = chooseBestDiscard(
        p.hand, s.discardedCardHistory, DIFFICULTY, s.lastDrawnCardId, s.gameMode,
        team.games, null, oppGames, tookPile
      );
    }
    // Se o descarte foi bloqueado (empataria bater ilegal), tenta outras cartas
    if (!discard(s, playerId, card.id)) {
      let discarded = false;
      for (const c of p.hand) {
        if (discard(s, playerId, c.id)) { discarded = true; break; }
      }
      if (!discarded) {
        // impossível descartar — trata como strand e força fim turno
        return;
      }
    }
  }

  // Verifica bater após discard (bater clássico exige descartar a última carta)
  if (p.hand.length === 0) {
    endRound(s, true, team.id);
    return;
  }

  // Avança turno
  s.currentTurnPlayerId = getNextPlayer(playerId);
  s.turnPhase = 'draw';
  s.lastDrawnCardId = null;
}

// ─── Loop principal ───────────────────────────────────────
type NoBaterDiagnostic = {
  team: TeamId;
  hasGottenDead: boolean;
  cleanCanastas: number;
  dirtyCanastas: number;
  minHandThisRound: number;
  finalHandSize: number;
  couldTeamBaterAtEnd: boolean;
};

function runOneGame(gameIdx: number, verbose: boolean): { winner: TeamId | null; t1: number; t2: number; rounds: number; bater: number; noBater: number; exhaustHandSizes: number[][]; noBaterDiag: NoBaterDiagnostic[] } {
  const exhaustHandSizes: number[][] = [];
  const noBaterDiag: NoBaterDiagnostic[] = [];
  resetPerPlayerHistories();
  let state = freshState(GAME_MODE);
  let rounds = 0;
  let baterCount = 0;
  let noBaterCount = 0;
  while (!state.winnerTeamId) {
    rounds++;
    currentRoundTurnCount = 0;
    let safety = 0;
    // track min hand size per player during this round
    const minHand: Record<PlayerId, number> = { 'user': 11, 'bot-1': 11, 'bot-2': 11, 'bot-3': 11 };
    while (!state.roundOver && safety < 400) {
      safety++;
      const before = state.currentTurnPlayerId;
      const handsBefore = state.players.map(p => p.hand.length);
      runBotTurn(state, state.currentTurnPlayerId);
      for (const p of state.players) {
        if (p.hand.length < minHand[p.id]) minHand[p.id] = p.hand.length;
      }
      if (state.currentTurnPlayerId === before && !state.roundOver) {
        if (verbose) {
          console.log(`    ⚠️ turn didn't advance: player=${before} handsBefore=${handsBefore} handsAfter=${state.players.map(p => p.hand.length)} mustPlay=${state.mustPlayPileTopId}`);
        }
        state.currentTurnPlayerId = getNextPlayer(before);
        state.turnPhase = 'draw';
        state.mustPlayPileTopId = null;
      }
    }
    if (safety >= 400) {
      if (verbose) console.log(`  ⚠️  game ${gameIdx} round ${rounds}: safety hit, forcing end`);
      endRound(state, false);
    }
    // wentOut? checa pela mensagem — aqui só: se um dos times acabou de ganhar hand=0 com canasta
    const wentOut = state.players.some(p => p.hand.length === 0) &&
      (canTeamBater(state.teams['team-1'].games, state.gameMode, state.teams['team-1'].hasGottenDead) ||
       canTeamBater(state.teams['team-2'].games, state.gameMode, state.teams['team-2'].hasGottenDead));
    if (wentOut) baterCount++;
    else {
      noBaterCount++;
      exhaustHandSizes.push(state.players.map(p => p.hand.length));
      // Registra diagnóstico por time
      for (const teamId of ['team-1', 'team-2'] as TeamId[]) {
        const t = state.teams[teamId];
        const cleanCan = t.games.filter(g => g.length >= 7 && checkCanasta(g) === 'clean').length;
        const dirtyCan = t.games.filter(g => g.length >= 7 && checkCanasta(g) === 'dirty').length;
        const teamPlayers = state.players.filter(p => p.teamId === teamId);
        const minH = Math.min(...teamPlayers.map(p => minHand[p.id]));
        const finalH = Math.min(...teamPlayers.map(p => p.hand.length));
        noBaterDiag.push({
          team: teamId,
          hasGottenDead: t.hasGottenDead,
          cleanCanastas: cleanCan,
          dirtyCanastas: dirtyCan,
          minHandThisRound: minH,
          finalHandSize: finalH,
          couldTeamBaterAtEnd: canTeamBater(t.games, state.gameMode, t.hasGottenDead),
        });
      }
    }
    if (verbose) {
      console.log(`  round ${rounds}: T1=${state.teams['team-1'].score} T2=${state.teams['team-2'].score}  match=${state.matchScores['team-1']}/${state.matchScores['team-2']}`);
      if (!wentOut) {
        const t1 = state.teams['team-1'];
        const t2 = state.teams['team-2'];
        const describe = (t: TeamState) => {
          const canastras = t.games.filter(g => g.length >= 7);
          const clean = canastras.filter(g => checkCanasta(g) === 'clean').length;
          const dirty = canastras.filter(g => checkCanasta(g) === 'dirty').length;
          return `games=${t.games.length} (lens=${t.games.map(g => g.length).join(',')}) clean=${clean} dirty=${dirty} gotDead=${t.hasGottenDead}`;
        };
        console.log(`    T1 ${describe(t1)}`);
        console.log(`    T2 ${describe(t2)}`);
        console.log(`    deads=${state.deads.length} reshuffles=${state.deckReshuffleCount} safety=${safety}`);
      }
    }
    // Instrumentation: coringas encalhados na mão ao fim da rodada
    for (const teamId of ['team-1', 'team-2'] as TeamId[]) {
      const teamPlayers = state.players.filter(p => p.teamId === teamId);
      const stranded = teamPlayers.reduce((acc, pl) => acc + pl.hand.filter(c => c.isJoker).length, 0);
      wildLeak[teamId].strandedAtRoundEnd += stranded;
    }
    if (state.winnerTeamId) break;
    resetPerPlayerHistories();
    state = newRound(state);
  }
  return {
    winner: state.winnerTeamId,
    t1: state.matchScores['team-1'],
    t2: state.matchScores['team-2'],
    rounds,
    bater: baterCount,
    noBater: noBaterCount,
    exhaustHandSizes,
    noBaterDiag,
  };
}

function main() {
  const label = (t: TeamId) => {
    const bits: string[] = [];
    if (TEAM_SMART_PILE[t]) bits.push('SMART pile');
    if (TEAM_SMART_DISCARD[t]) bits.push('SMART discard');
    if (TEAM_SMART_WILD[t]) bits.push('SMART wild');
    if (TEAM_SMART_CLOSE[t]) bits.push('SMART close');
    return bits.length ? bits.join(' + ') : 'baseline';
  };
  console.log(`\n=== Buraco Bot Sim ===`);
  console.log(`N_GAMES=${N_GAMES}  TARGET=${TARGET_SCORE}  MODE=${GAME_MODE}`);
  console.log(`team-1 (user + bot-2):   ${label('team-1')}`);
  console.log(`team-2 (bot-1 + bot-3):  ${label('team-2')}\n`);

  let t1Wins = 0, t2Wins = 0;
  let t1TotalScore = 0, t2TotalScore = 0;
  let totalRounds = 0, totalBater = 0, totalNoBater = 0;
  const results: ReturnType<typeof runOneGame>[] = [];
  for (let i = 1; i <= N_GAMES; i++) {
    const r = runOneGame(i, i === 1);
    results.push(r);
    if (r.winner === 'team-1') t1Wins++;
    if (r.winner === 'team-2') t2Wins++;
    t1TotalScore += r.t1;
    t2TotalScore += r.t2;
    totalRounds += r.rounds;
    totalBater += r.bater;
    totalNoBater += r.noBater;
    const tag = r.winner === 'team-1' ? '🟢' : r.winner === 'team-2' ? '🔴' : '⚪';
    console.log(`game ${String(i).padStart(2)}: ${tag} T1=${String(r.t1).padStart(5)}  T2=${String(r.t2).padStart(5)}  (${r.rounds} rounds, ${r.bater} bater / ${r.noBater} sem bater)`);
  }

  console.log(`\n─── RESULTADO ─────────────────────────────`);
  console.log(`vitórias   T1 (${label('team-1')}): ${t1Wins}/${N_GAMES}`);
  console.log(`vitórias   T2 (${label('team-2')}): ${t2Wins}/${N_GAMES}`);
  console.log(`empates                 : ${N_GAMES - t1Wins - t2Wins}`);
  console.log(`score total T1 / T2     : ${t1TotalScore} / ${t2TotalScore}  (Δ=${t1TotalScore - t2TotalScore})`);
  console.log(`score médio T1 / T2     : ${Math.round(t1TotalScore / N_GAMES)} / ${Math.round(t2TotalScore / N_GAMES)}`);
  console.log(`rodadas totais          : ${totalRounds} (média ${(totalRounds / N_GAMES).toFixed(1)}/partida)`);
  console.log(`rodadas com bater       : ${totalBater}  sem bater: ${totalNoBater}`);

  // Distribuição de tamanho de mão ao esgotamento (para diagnóstico de hoarding)
  const allExhausts = results.flatMap(r => r.exhaustHandSizes);
  if (allExhausts.length > 0) {
    const t1Avg = allExhausts.reduce((s, h) => s + h[0] + h[2], 0) / allExhausts.length / 2;
    const t2Avg = allExhausts.reduce((s, h) => s + h[1] + h[3], 0) / allExhausts.length / 2;
    console.log(`mão média por jogador em rodadas exauridas:  T1=${t1Avg.toFixed(1)}  T2=${t2Avg.toFixed(1)}`);
  }

  // ─── Diagnóstico de rodadas sem bater (por que nunca bate?) ─────
  const allDiag = results.flatMap(r => r.noBaterDiag);
  if (allDiag.length > 0) {
    const bucket = (d: NoBaterDiagnostic): 'noCanasta' | 'noDead' | 'stranded' | 'closeCall' | 'other' => {
      const hasCanasta = d.cleanCanastas + d.dirtyCanastas > 0;
      if (!hasCanasta) return 'noCanasta';
      if (!d.hasGottenDead) return 'noDead';
      if (d.couldTeamBaterAtEnd && d.minHandThisRound <= 1) return 'closeCall';
      if (d.couldTeamBaterAtEnd) return 'stranded';
      return 'other';
    };
    const countFor = (teamId: TeamId) => {
      const teamDiag = allDiag.filter(d => d.team === teamId);
      const counts: Record<string, number> = { noCanasta: 0, noDead: 0, stranded: 0, closeCall: 0, other: 0 };
      for (const d of teamDiag) counts[bucket(d)]++;
      return { teamDiag, counts };
    };
    const fmt = (c: Record<string, number>, total: number) => {
      const pct = (n: number) => `${n} (${Math.round(100 * n / total)}%)`;
      return `noCanasta=${pct(c.noCanasta)}  noDead=${pct(c.noDead)}  stranded=${pct(c.stranded)}  closeCall=${pct(c.closeCall)}  other=${pct(c.other)}`;
    };
    console.log(`\n─── DIAGNÓSTICO: por que não bateu? ─────────────`);
    const t1 = countFor('team-1');
    const t2 = countFor('team-2');
    console.log(`T1 (${label('team-1')}) rodadas sem bater: ${t1.teamDiag.length}`);
    console.log(`   ${fmt(t1.counts, t1.teamDiag.length)}`);
    console.log(`T2 (${label('team-2')}) rodadas sem bater: ${t2.teamDiag.length}`);
    console.log(`   ${fmt(t2.counts, t2.teamDiag.length)}`);
    // Stats agregados
    const avg = (arr: number[]) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
    for (const teamId of ['team-1', 'team-2'] as TeamId[]) {
      const td = allDiag.filter(d => d.team === teamId);
      const canastasPerRound = avg(td.map(d => d.cleanCanastas + d.dirtyCanastas));
      const cleanPerRound = avg(td.map(d => d.cleanCanastas));
      const gotDeadPct = 100 * td.filter(d => d.hasGottenDead).length / td.length;
      const couldBaterPct = 100 * td.filter(d => d.couldTeamBaterAtEnd).length / td.length;
      const avgMinHand = avg(td.map(d => d.minHandThisRound));
      console.log(`   ${teamId}: canastras/rod=${canastasPerRound.toFixed(2)} (clean=${cleanPerRound.toFixed(2)})  %gotDead=${gotDeadPct.toFixed(0)}  %couldBater=${couldBaterPct.toFixed(0)}  avgMinHand=${avgMinHand.toFixed(1)}`);
    }
  }

  // ─── Leak de coringa (item #3 diagnóstico) ────────────
  console.log(`\n─── LEAK DE CORINGA (por time, por rodada) ─────────────`);
  const roundsTotal = totalRounds;
  for (const teamId of ['team-1', 'team-2'] as TeamId[]) {
    const w = wildLeak[teamId];
    const avgSize = w.inNewMeldBySize.length ? (w.inNewMeldBySize.reduce((s, x) => s + x, 0) / w.inNewMeldBySize.length) : 0;
    const avgTurn = w.inNewMeldTurnsIntoRound.length ? (w.inNewMeldTurnsIntoRound.reduce((s, x) => s + x, 0) / w.inNewMeldTurnsIntoRound.length) : 0;
    const avgBefore = w.addedToGameSizeBefore.length ? (w.addedToGameSizeBefore.reduce((s, x) => s + x, 0) / w.addedToGameSizeBefore.length) : 0;
    const perRound = (n: number) => (n / roundsTotal).toFixed(2);
    console.log(`${teamId} (${label(teamId)}):`);
    console.log(`  em meld nova:        ${w.inNewMeld} total (${perRound(w.inNewMeld)}/rod)  meld size média=${avgSize.toFixed(1)}  turno médio=${avgTurn.toFixed(1)}`);
    console.log(`  adicionado sujando:  ${w.addedToGame} total (${perRound(w.addedToGame)}/rod)  jogo size antes média=${avgBefore.toFixed(1)}`);
    console.log(`  encalhado em mão:    ${w.strandedAtRoundEnd} total (${perRound(w.strandedAtRoundEnd)}/rod)`);
    // Distribuição de meld sizes para identificar 3-card new melds cedo (principal suspeita)
    if (w.inNewMeldBySize.length > 0) {
      const sizeHisto: Record<number, number> = {};
      for (const sz of w.inNewMeldBySize) sizeHisto[sz] = (sizeHisto[sz] || 0) + 1;
      const sizes = Object.keys(sizeHisto).map(Number).sort((a, b) => a - b);
      const parts = sizes.map(sz => `${sz}c:${sizeHisto[sz]}`).join(' ');
      console.log(`  meld sizes:          ${parts}`);
    }
    if (w.addedToGameSizeBefore.length > 0) {
      const sizeHisto: Record<number, number> = {};
      for (const sz of w.addedToGameSizeBefore) sizeHisto[sz] = (sizeHisto[sz] || 0) + 1;
      const sizes = Object.keys(sizeHisto).map(Number).sort((a, b) => a - b);
      const parts = sizes.map(sz => `${sz}→${sz + 1}:${sizeHisto[sz]}`).join(' ');
      console.log(`  add-at sizes:        ${parts}`);
    }
  }

  // ─── Discriminador item #1 ─────────────────────────────
  if (discardDiff.total > 0) {
    const pct = (100 * discardDiff.diff / discardDiff.total).toFixed(1);
    console.log(`\n─── DISCRIMINADOR item #1 (smart discard vs baseline) ─────────────`);
    console.log(`decisões smart comparadas: ${discardDiff.total}`);
    console.log(`escolheu carta DIFERENTE:   ${discardDiff.diff}  (${pct}%)`);
    console.log(`escolheu carta IGUAL:       ${discardDiff.total - discardDiff.diff}`);
  }
}

main();

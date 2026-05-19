/**
 * headlessEngine.ts — motor de turno headless, SEM animação/store/instrumentação.
 *
 * Port FIEL da mecânica validada do scripts/botSim.ts (mesmos nomes de função
 * p/ auditabilidade 1:1), auditada contra as regras reais do gameStore
 * (scripts/auditEngine.ts: 0 divergências em 249 estados). É a primitiva de
 * rollout do PIMC de produção (game/pimc.ts).
 *
 * Diferenças vs botSim: zero contadores/toggles de pesquisa. A POLÍTICA de
 * rollout é fixa = produção real (useBotAI offline): shouldTakePileSmart com
 * proximity ON (item #9), wild-discipline ON (item #3), sem smart-close (#4
 * descartado), sem proxy/PIMC/poison, descarte = chooseBestDiscard (baseline,
 * o que produção usa). PILE_AGGRESSIVENESS = mapa offline de produção.
 */
import { Card, shuffle } from './deck';
import {
  GameState, GameMode, PlayerId, TeamId, Player, TeamState,
  getNextPlayer, calculateRoundScore,
} from './engine';
import { canTakePile, sortCardsBySuitAndValue, sortGameCards, validateSequence, checkCanasta } from './rules';
import {
  shouldTakePileSmart, findBestSequences, chooseBestDiscard, canTeamBater,
  wouldDirtyGame, canCleanCandidateGrow, opponentRecentlyTookPile, canastaBonusValue,
} from './botHelpers';

const MAX_RESHUFFLES = 99;
const DIFFICULTY = 'hard' as const;
// Espelha PILE_AGGRESSIVENESS_OFFLINE de hooks/useBotAI.ts (só bot-3 agressivo).
const PILE_AGGRESSIVENESS: Record<string, number> = {
  user: 1.0, 'bot-1': 1.0, 'bot-2': 1.0, 'bot-3': 1.7,
};

export function playerOf(s: GameState, id: PlayerId): Player {
  return s.players.find(p => p.id === id)!;
}
export function teamOf(s: GameState, id: PlayerId): TeamState {
  return s.teams[playerOf(s, id).teamId];
}
function updatePlayerHand(s: GameState, id: PlayerId, newHand: Card[], hasGottenDead?: boolean): void {
  const p = playerOf(s, id);
  p.hand = sortCardsBySuitAndValue(newHand);
  if (hasGottenDead !== undefined) p.hasGottenDead = hasGottenDead;
}

function wouldStrand(s: GameState, playerId: PlayerId, remaining: Card[], extraGame?: Card[]): boolean {
  const team = teamOf(s, playerId);
  const canBaterAfter = (() => {
    const tempGames = extraGame ? [...team.games, extraGame] : team.games;
    return s.gameMode === 'araujo_pereira'
      ? tempGames.some(g => g.length >= 7)
      : tempGames.some(g => g.length >= 7 && checkCanasta(g) === 'clean');
  })();
  if (remaining.length === 0) {
    if (team.hasGottenDead) return !canBaterAfter;
    return s.deads.length === 0 && !canBaterAfter;
  }
  if (remaining.length === 1) {
    const willGetDeadOnDiscard = !team.hasGottenDead && s.deads.length > 0;
    if (willGetDeadOnDiscard) return false;
    return !canBaterAfter;
  }
  return false;
}

function handleDeadIfApplicable(s: GameState, playerId: PlayerId): void {
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  if (p.hand.length === 0 && !team.hasGottenDead && s.deads.length > 0) {
    const popped = s.deads.pop()!;
    updatePlayerHand(s, playerId, popped, true);
    team.hasGottenDead = true;
  }
}

export function checkBater(s: GameState, playerId: PlayerId): boolean {
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  if (p.hand.length !== 0) return false;
  if (!team.hasGottenDead && s.deads.length > 0) return false;
  if (!canTeamBater(team.games, s.gameMode, team.hasGottenDead)) return false;
  endRound(s, true, team.id);
  return true;
}

export function endRound(s: GameState, wentOut: boolean, lastPlayerTeamId?: TeamId): void {
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

export function drawFromDeck(s: GameState, playerId: PlayerId): boolean {
  while (s.deck.length === 0) {
    if (s.deads.length > 0) { s.deck = s.deads.pop()!; continue; }
    if (s.pile.length > 0) {
      s.deckReshuffleCount += 1;
      if (s.deckReshuffleCount >= MAX_RESHUFFLES) { endRound(s, false); return false; }
      s.deck = shuffle([...s.pile]);
      s.pile = [];
      continue;
    }
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

export function drawFromPile(s: GameState, playerId: PlayerId): boolean {
  if (s.pile.length === 0) return false;
  const p = playerOf(s, playerId);
  const teamGames = teamOf(s, playerId).games;
  if (s.gameMode !== 'araujo_pereira') {
    if (!canTakePile(p.hand, s.pile, teamGames, s.gameMode)) return false;
  }
  const topCard = s.pile[s.pile.length - 1];
  updatePlayerHand(s, playerId, [...p.hand, ...s.pile]);
  s.pile = [];
  s.lastDrawnCardId = topCard.id;
  s.turnPhase = 'play';
  if (s.gameMode !== 'araujo_pereira') s.mustPlayPileTopId = topCard.id;
  return true;
}

export function playCards(s: GameState, playerId: PlayerId, cardIds: string[]): boolean {
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
  return true;
}

export function addToExistingGame(s: GameState, playerId: PlayerId, cardIds: string[], gameIndex: number): boolean {
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
  team.games[gameIndex] = sortGameCards(combined);
  updatePlayerHand(s, playerId, remaining);
  s.mustPlayPileTopId = null;
  handleDeadIfApplicable(s, playerId);
  return true;
}

export function discard(s: GameState, playerId: PlayerId, cardId: string): boolean {
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
    if (!willGetDead && !canBater) return false;
  }
  updatePlayerHand(s, playerId, p.hand.filter(c => c.id !== cardId));
  s.pile = [...s.pile, card];
  s.discardedCardHistory = [...s.discardedCardHistory, card.id];
  const postTeam = teamOf(s, playerId);
  if (p.hand.length === 0 && !postTeam.hasGottenDead && s.deads.length > 0) {
    const dead = s.deads.pop()!;
    updatePlayerHand(s, playerId, sortCardsBySuitAndValue(dead), true);
    postTeam.hasGottenDead = true;
  }
  return true;
}

/** Política de rollout: pegar-lixo via heurística smart de produção (proximity ON). */
function chooseTakePileHeuristic(s: GameState, playerId: PlayerId): boolean {
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  const aggr = PILE_AGGRESSIVENESS[playerId] ?? 1.0;
  return shouldTakePileSmart(s.pile, p.hand, DIFFICULTY, team.games, s.gameMode, aggr, true);
}

function playWithPileTop(s: GameState, playerId: PlayerId, pileTopId: string, allowWild3 = false): void {
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  const topCard = p.hand.find(c => c.id === pileTopId);
  if (!topCard) { s.mustPlayPileTopId = null; return; }
  // Espelha a disciplina de coringa do useBotAI no caminho da obrigação:
  // 1º passe não cria meld de 3 com coringa não-natural sem canastra limpa.
  const teamHasCleanCanasta = team.games.some(g => checkCanasta(g) === 'clean');
  const isBadWild3 = (seq: Card[]): boolean => {
    if (allowWild3 || s.gameMode !== 'classic' || teamHasCleanCanasta) return false;
    if (seq.length !== 3) return false;
    const jk = seq.filter(c => c.isJoker);
    if (jk.length === 0) return false;
    const sn = seq.filter(c => !c.isJoker);
    const seqSuit = sn.length > 0 ? sn[0].suit : null;
    if (jk.every(j => j.suit !== 'joker' && j.suit === seqSuit)) return false;
    const remainingAfter = p.hand.length - seq.length;
    const goingForDead = remainingAfter <= 1 && !team.hasGottenDead;
    return !goingForDead;
  };
  const topCardDelta = team.games.map(g => {
    if (!validateSequence([...g, topCard], s.gameMode)) return 0;
    return canastaBonusValue([...g, topCard]) - canastaBonusValue(g);
  });
  const gameIndices = team.games.map((_, i) => i).sort((a, b) => {
    if (topCardDelta[a] !== topCardDelta[b]) return topCardDelta[b] - topCardDelta[a];
    const aClean = checkCanasta(team.games[a]) === 'clean' ? 1 : 0;
    const bClean = checkCanasta(team.games[b]) === 'clean' ? 1 : 0;
    return aClean - bClean;
  });
  for (const gi of gameIndices) {
    const game = team.games[gi];
    if (topCard.isJoker && wouldDirtyGame(topCard, game)) continue;
    if (validateSequence([...game, topCard], s.gameMode)) {
      const combined = [...game, topCard];
      if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
      if (addToExistingGame(s, playerId, [pileTopId], gi)) return;
    }
  }
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
  const sequences = findBestSequences(p.hand, s.gameMode);
  for (const seq of sequences) {
    if (!seq.some(c => c.id === pileTopId)) continue;
    if (isBadWild3(seq)) continue;
    if (playCards(s, playerId, seq.map(c => c.id))) return;
  }
  const sameSuit = p.hand.filter(c => !c.isJoker && c.suit === topCard.suit && c.id !== pileTopId);
  for (let i = 0; i < sameSuit.length; i++) {
    for (let j = i + 1; j < sameSuit.length; j++) {
      if (playCards(s, playerId, [pileTopId, sameSuit[i].id, sameSuit[j].id])) return;
    }
  }
  if (!allowWild3) { playWithPileTop(s, playerId, pileTopId, true); return; }
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
              // wild-discipline (item #3, mergeado em produção): bloqueia meld
              // nova de 3 cartas com coringa antes de qualquer canastra.
              if (seq.length === 3) continue;
            }
          }
        }
      }
      if (playCards(s, playerId, seq.map(c => c.id))) { played = true; break; }
    }
    if (!played) return;
    if (s.roundOver) return;
  }
}

function addToGamesPhase(s: GameState, playerId: PlayerId): void {
  const team = teamOf(s, playerId);
  const p = playerOf(s, playerId);
  const jokerSuits = new Set(p.hand.filter(c => c.isJoker && c.suit !== 'joker').map(c => c.suit));
  const gameUpgradeDelta = team.games.map(g => {
    const base = canastaBonusValue(g);
    let maxDelta = 0;
    for (const c of p.hand) {
      if (c.isJoker) continue;
      if (validateSequence([...g, c], s.gameMode)) {
        const delta = canastaBonusValue([...g, c]) - base;
        if (delta > maxDelta) maxDelta = delta;
      }
    }
    return maxDelta;
  });
  const sortedIndices = team.games.map((_, i) => i).sort((a, b) => {
    const aLen = team.games[a].length;
    const bLen = team.games[b].length;
    const aClean = !team.games[a].some(c => c.isJoker);
    const bClean = !team.games[b].some(c => c.isJoker);
    const aClosingClean = (aLen === 6 && aClean) ? 1 : 0;
    const bClosingClean = (bLen === 6 && bClean) ? 1 : 0;
    if (aClosingClean !== bClosingClean) return bClosingClean - aClosingClean;
    if (gameUpgradeDelta[a] !== gameUpgradeDelta[b]) return gameUpgradeDelta[b] - gameUpgradeDelta[a];
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
            const oppTeamId: TeamId = team.id === 'team-1' ? 'team-2' : 'team-1';
            const allTableGames = [...team.games, ...s.teams[oppTeamId].games];
            const hasCleanElsewhere = team.games.some((g, idx) => idx !== gi && checkCanasta(g) === 'clean');
            if (!hasCleanElsewhere) {
              const cleanCandidates = team.games.filter(g => !g.some(c => c.isJoker) && g.length >= 5);
              const closingCanasta = game.length === 6;
              if (cleanCandidates.length <= 1 && !game.some(c => c.isJoker) && game.length >= 5) {
                const isViable = canCleanCandidateGrow(game, allTableGames, pNow.hand);
                if (isViable && !closingCanasta) continue;
              } else if (!closingCanasta) {
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
          if (addToExistingGame(s, playerId, [card.id], gi)) { moved = true; break; }
        }
      }
    }
  }
}

/**
 * Um turno completo do bot com a política heurística de produção.
 * `forcedDraw`: se definido, força a 1ª decisão pegar-lixo (true) / comprar
 * (false) — usado pelo PIMC pra avaliar as 2 ações a partir do mesmo estado.
 */
export function botTurn(s: GameState, playerId: PlayerId, forcedDraw?: boolean): void {
  if (s.turnPhase === 'draw') {
    const take = forcedDraw !== undefined ? forcedDraw : chooseTakePileHeuristic(s, playerId);
    if (take) {
      if (!drawFromPile(s, playerId)) {
        if (!drawFromDeck(s, playerId)) return;
      }
    } else {
      if (!drawFromDeck(s, playerId)) return;
    }
  }
  if (s.roundOver) return;

  if (s.mustPlayPileTopId) playWithPileTop(s, playerId, s.mustPlayPileTopId);
  addToGamesPhase(s, playerId);
  playSequencesPhase(s, playerId);
  addToGamesPhase(s, playerId);

  if (checkBater(s, playerId)) return;

  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  if (p.hand.length > 0) {
    const oppTeamId: TeamId = team.id === 'team-1' ? 'team-2' : 'team-1';
    const oppGames = s.teams[oppTeamId].games;
    const oppIds = s.players.filter(pl => pl.teamId === oppTeamId).map(pl => pl.id);
    const tookPile = opponentRecentlyTookPile(s.gameLog as any, oppIds);
    const card = chooseBestDiscard(
      p.hand, s.discardedCardHistory, DIFFICULTY, s.lastDrawnCardId, s.gameMode,
      team.games, null, oppGames, tookPile
    );
    if (!discard(s, playerId, card.id)) {
      let discarded = false;
      for (const c of p.hand) { if (discard(s, playerId, c.id)) { discarded = true; break; } }
      if (!discarded) return;
    }
  }

  if (p.hand.length === 0) { endRound(s, true, team.id); return; }

  s.currentTurnPlayerId = getNextPlayer(playerId);
  s.turnPhase = 'draw';
  s.lastDrawnCardId = null;
}

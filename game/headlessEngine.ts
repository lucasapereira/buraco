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
import { canTakePile, findPileTopPlay, sortCardsBySuitAndValue, sortGameCards, validateSequence, checkCanasta } from './rules';
import {
  shouldTakePileSmart, findBestSequences, chooseBestDiscard, canTeamBater,
  wouldDirtyGame, canCleanCandidateGrow, opponentRecentlyTookPile, canastaBonusValue,
  findPileTopNonDegradingPlay, longestNaturalRun, wouldLockRedeemableWild,
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
  // Cartas ENTERRADAS (todas menos o topo) não podem formar a meld que cumpre a
  // obrigação — a captura tem de ser justificada pela MÃO (espelha gameStore).
  const buriedIds = s.gameMode !== 'araujo_pereira'
    ? s.pile.filter(c => c.id !== topCard.id).map(c => c.id)
    : [];
  updatePlayerHand(s, playerId, [...p.hand, ...s.pile]);
  s.pile = [];
  s.lastDrawnCardId = topCard.id;
  s.turnPhase = 'play';
  if (s.gameMode !== 'araujo_pereira') {
    s.mustPlayPileTopId = topCard.id;
    s.pileTakenBuriedIds = buriedIds;
  }
  return true;
}

export function playCards(s: GameState, playerId: PlayerId, cardIds: string[]): boolean {
  if (s.turnPhase !== 'play') return false;
  const p = playerOf(s, playerId);
  if (s.gameMode !== 'araujo_pereira' && s.mustPlayPileTopId && !cardIds.includes(s.mustPlayPileTopId)) return false;
  // A jogada que CUMPRE a obrigação do lixo não pode usar cartas ENTERRADAS.
  if (s.gameMode !== 'araujo_pereira' && s.mustPlayPileTopId
      && cardIds.includes(s.mustPlayPileTopId)
      && cardIds.some(id => id !== s.mustPlayPileTopId && (s.pileTakenBuriedIds ?? []).includes(id))) {
    return false;
  }
  const selected = p.hand.filter(c => cardIds.includes(c.id));
  if (selected.length !== cardIds.length) return false;
  if (!validateSequence(selected, s.gameMode)) return false;
  const remaining = p.hand.filter(c => !cardIds.includes(c.id));
  if (wouldStrand(s, playerId, remaining, selected)) return false;
  const team = teamOf(s, playerId);
  team.games.push(sortGameCards(selected));
  updatePlayerHand(s, playerId, remaining);
  if (s.mustPlayPileTopId && cardIds.includes(s.mustPlayPileTopId)) s.pileTakenBuriedIds = [];
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
  // A jogada que CUMPRE a obrigação do lixo não pode usar cartas ENTERRADAS.
  if (s.gameMode !== 'araujo_pereira' && s.mustPlayPileTopId
      && cardIds.includes(s.mustPlayPileTopId)
      && cardIds.some(id => id !== s.mustPlayPileTopId && (s.pileTakenBuriedIds ?? []).includes(id))) {
    return false;
  }
  const selected = p.hand.filter(c => cardIds.includes(c.id));
  if (selected.length !== cardIds.length) return false;
  const combined = [...game, ...selected];
  if (!validateSequence(combined, s.gameMode)) return false;
  const remaining = p.hand.filter(c => !cardIds.includes(c.id));
  if (wouldStrand(s, playerId, remaining)) return false;
  team.games[gameIndex] = sortGameCards(combined);
  updatePlayerHand(s, playerId, remaining);
  if (s.mustPlayPileTopId && cardIds.includes(s.mustPlayPileTopId)) s.pileTakenBuriedIds = [];
  s.mustPlayPileTopId = null;
  handleDeadIfApplicable(s, playerId);
  return true;
}

/** Nº de descartes recentes mantidos por jogador (sinal de inferência). */
export const RECENT_DISCARD_K = 3;

/** Registra o descarte mais recente do jogador (lazy-init, cap K). Mantido por
 *  TODOS os motores de discard (headless, botSim, gameStore) p/ a inferência. */
export function pushRecentDiscard(s: GameState, playerId: PlayerId, cardId: string): void {
  if (!s.recentDiscardsByPlayer) {
    s.recentDiscardsByPlayer = { 'user': [], 'bot-1': [], 'bot-2': [], 'bot-3': [] };
  }
  const arr = s.recentDiscardsByPlayer[playerId] ?? [];
  const next = [...arr, cardId];
  s.recentDiscardsByPlayer[playerId] = next.length > RECENT_DISCARD_K ? next.slice(next.length - RECENT_DISCARD_K) : next;
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
  pushRecentDiscard(s, playerId, card.id);
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

export function playWithPileTop(s: GameState, playerId: PlayerId, pileTopId: string, allowWild3 = false): void {
  const p = playerOf(s, playerId);
  const team = teamOf(s, playerId);
  const topCard = p.hand.find(c => c.id === pileTopId);
  if (!topCard) { s.mustPlayPileTopId = null; return; }
  // Cartas ENTERRADAS não podem compor a meld que cumpre a obrigação (regra do
  // engine). Excluí-las de TODA busca abaixo evita o bug em que um coringa (ou
  // natural) enterrado é escolhido antes da carta REAL equivalente, fazendo o
  // engine rejeitar e a obrigação ser largada mesmo havendo jogada válida na MÃO.
  const buried = new Set(s.pileTakenBuriedIds ?? []);
  // CUMPRIMENTO SEM DEGRADAR (1ª tentativa — espelha useBotAI): jogada que mele o
  // topo sem sujar nenhuma meld limpa (canastra ou candidata <7), inclusive jogo
  // novo. Tentada ANTES das fases abaixo que poderiam sujar uma canastra limpa.
  if (!allowWild3) {
    const handNoTop = p.hand.filter(c => c.id !== pileTopId && !buried.has(c.id));
    const nd = findPileTopNonDegradingPlay(handNoTop, topCard, team.games, s.gameMode, true);
    if (nd) {
      const ok = nd.gameIndex >= 0
        ? addToExistingGame(s, playerId, nd.cardIds, nd.gameIndex)
        : playCards(s, playerId, nd.cardIds);
      if (ok) return;
    }
  }
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
      if (c.id === pileTopId || buried.has(c.id)) continue;
      const combined = [...game, topCard, c];
      if (validateSequence(combined, s.gameMode)) {
        if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') continue;
        if (addToExistingGame(s, playerId, [pileTopId, c.id], gi)) return;
      }
    }
  }
  const sequences = findBestSequences(p.hand.filter(c => !buried.has(c.id)), s.gameMode, true); // issue A: aloca coringa por naipe
  for (const seq of sequences) {
    if (!seq.some(c => c.id === pileTopId)) continue;
    if (isBadWild3(seq)) continue;
    if (playCards(s, playerId, seq.map(c => c.id))) return;
  }
  const sameSuit = p.hand.filter(c => !c.isJoker && c.suit === topCard.suit && c.id !== pileTopId && !buried.has(c.id));
  for (let i = 0; i < sameSuit.length; i++) {
    for (let j = i + 1; j < sameSuit.length; j++) {
      if (playCards(s, playerId, [pileTopId, sameSuit[i].id, sameSuit[j].id])) return;
    }
  }
  if (!allowWild3) { playWithPileTop(s, playerId, pileTopId, true); return; }

  // Fallback exaustivo: espelha canTakePile via findPileTopPlay. Garante que toda
  // pegada de lixo permitida pela regra seja de fato cumprida — sem isso, lacunas
  // entre canTakePile e as fases acima largam a obrigação (bot fica com o lixo sem
  // baixar o topo, jogada ilegal no Clássico). Recusa jogadas que sujariam canastra
  // limpa de 500/1000 (≥13): prefere largar a obrigação a perder 400/900.
  // LOOP DE RETRY: findPileTopPlay devolve a 1ª combinação válida por validateSequence,
  // mas o engine pode rejeitá-la (strand, degradação). Pulamos candidatas já tentadas
  // até o engine aceitar uma — senão o bot largava a obrigação havendo jogada legal.
  const handWithoutTop = p.hand.filter(c => c.id !== pileTopId && !buried.has(c.id));
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 16; attempt++) {
    const realize = findPileTopPlay(handWithoutTop, topCard, team.games, s.gameMode, (gi, cardIds) => {
      const key = gi + ':' + [...cardIds].sort().join(',');
      if (tried.has(key)) return false;
      if (gi < 0) return true;
      const game = team.games[gi];
      if (game.length < 13 || checkCanasta(game) !== 'clean') return true;
      const added = p.hand.filter(c => cardIds.includes(c.id));
      return checkCanasta([...game, ...added]) === 'clean';
    });
    if (!realize) break;
    tried.add(realize.gameIndex + ':' + [...realize.cardIds].sort().join(','));
    const ok = realize.gameIndex >= 0
      ? addToExistingGame(s, playerId, realize.cardIds, realize.gameIndex)
      : playCards(s, playerId, realize.cardIds);
    if (ok) return;
  }
  s.mustPlayPileTopId = null;
  s.pileTakenBuriedIds = [];
}

export function playSequencesPhase(s: GameState, playerId: PlayerId): void {
  for (let iter = 0; iter < 5; iter++) {
    const p = playerOf(s, playerId);
    const team = teamOf(s, playerId);
    if (p.hand.length === 0) return;
    const accelerating = canTeamBater(team.games, s.gameMode, team.hasGottenDead) && p.hand.length <= 5;
    const sequences = findBestSequences(p.hand, s.gameMode, true); // issue A: aloca coringa por naipe
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
              // wild-discipline (espelha useBotAI): não gasta coringa pra fazer um
              // gap numa meld NOVA quando a MÃO já tem uma corrida natural limpa de
              // ≥3 no mesmo naipe (report: 3,4,5 + ★ + 7 → baixava [..★..] sujo em
              // vez de baixar [3,4,5] limpo e guardar o ★). Checa o naipe na MÃO,
              // não só na seq — senão o bot rota por uma sub-seq menor ([4,5,★,7])
              // e remonta a meld suja no addToGamesPhase. seq.length===3 cobre o
              // gap puro ([3,★,5]) sem corrida limpa.
              const handSuitRun = seqSuit
                ? longestNaturalRun(p.hand.filter(c => !c.isJoker && c.suit === seqSuit))
                : 0;
              if (seq.length === 3 || handSuitRun >= 3) continue;
            }
          }
        }
      }
      // ISSUE C: guarda ≥1 coringa pra pegar lixo gordo depois — não gasta o
      // ÚLTIMO coringa numa meld nova pequena (<5) não-crítica. Escape: indo
      // bater/morto, pode bater já, deck baixo, ou acelerando pra bater.
      if (s.gameMode === 'classic') {
        const wildsInSeq = seq.filter(c => c.isJoker).length;
        const wildsInHand = p.hand.filter(c => c.isJoker).length;
        if (wildsInSeq > 0 && wildsInHand - wildsInSeq === 0 && seq.length < 5) {
          const remainingAfter = p.hand.length - seq.length;
          const canBaterNow = canTeamBater(team.games, s.gameMode, team.hasGottenDead);
          const deckLow = s.deck.length <= 8;
          if (remainingAfter > 1 && !canBaterNow && !deckLow && !accelerating) continue;
        }
      }
      if (playCards(s, playerId, seq.map(c => c.id))) { played = true; break; }
    }
    if (!played) return;
    if (s.roundOver) return;
  }
}

export function addToGamesPhase(s: GameState, playerId: PlayerId): void {
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
    // Prioridade 3.5: NÃO engordar canastra JÁ COMPLETA que não ganha bônus.
    // Um jogo que ainda NÃO é canastra (rumo a uma nova) deve receber a carta antes
    // de uma canastra pronta cujo bônus não muda (delta 0). Caso do report: 8♣ cabe
    // tanto numa canastra suja completa quanto num jogo crescendo — alimentar o que
    // cresce vale mais (rumo a 2ª canastra) que engordar a pronta de graça. Upgrades
    // reais (suja→limpa, 13/14) já vêm antes via gameUpgradeDelta (Prioridade 2).
    const aStagnant = checkCanasta(team.games[a]) !== 'none' && gameUpgradeDelta[a] === 0 ? 1 : 0;
    const bStagnant = checkCanasta(team.games[b]) !== 'none' && gameUpgradeDelta[b] === 0 ? 1 : 0;
    if (aStagnant !== bStagnant) return aStagnant - bStagnant; // canastra parada vai por último
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
            // HARD RULE: 500/1000 nunca é sujada (espelha hooks/useBotAI.ts).
            if (game.length >= 13) continue;
            const goingOutNext = pNow.hand.length <= 2;
            const cleanCanastas = team.games.filter(g => checkCanasta(g) === 'clean');
            if (!goingOutNext || cleanCanastas.length <= 1) continue;
          }
          if (s.gameMode === 'classic') {
            const oppTeamId: TeamId = team.id === 'team-1' ? 'team-2' : 'team-1';
            const allTableGames = [...team.games, ...s.teams[oppTeamId].games];
            const hasCleanElsewhere = team.games.some((g, idx) => idx !== gi && checkCanasta(g) === 'clean');
            if (!hasCleanElsewhere) {
              // Protege QUALQUER candidata limpa viável (sem coringa, qualquer
              // tamanho) de ser suja — é a única via de canastra LIMPA (bater no
              // clássico). INCLUI fechar 6→7 sujo: dirty NÃO habilita bater, só
              // destrói a via limpa (report: "sapecou joker na 3-8♠ de 6 cartas,
              // sem canastra, começo de jogo"). O carve-out `closingCanasta`
              // antigo era o furo. Escape: indo bater no próximo lance (mão ≤ 2).
              // Candidata NÃO-viável segue fechando suja (senão o coringa encalha
              // num naipe sem saída).
              const goingOutNext = pNow.hand.length <= 2;
              if (!goingOutNext && !game.some(c => c.isJoker)
                  && canCleanCandidateGrow(game, allTableGames, pNow.hand)) {
                continue;
              }
            }
          }
        }
        // Não trava o coringa de uma canastra suja regatável metendo carta natural
        // no miolo (report: J♣ na [4..9♣ + 2♣] prende o 2♣ no 10). Escape: indo bater.
        if (!card.isJoker && pNow.hand.length > 2 && wouldLockRedeemableWild(game, card, s.gameMode)) continue;
        if (validateSequence([...game, card], s.gameMode)) {
          const combined = [...game, card];
          if (checkCanasta(game) === 'clean' && checkCanasta(combined) !== 'clean') {
            // HARD RULE: 500/1000 nunca é sujada (espelha hooks/useBotAI.ts).
            if (game.length >= 13) continue;
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
 * Plano de meld DESTE turno (a obrigação do lixo é cumprida ANTES, sempre).
 *  - `playAll`: baixa tudo que puder (greedy = política heurística de produção).
 *  - `extendOnly`: só ESTENDE melds existentes (addToGames) — não revela meld
 *    nova da mão (esconde info, mantém cartas flexíveis pra descarte/futuro).
 *  - `holdAll`: não baixa nada neste turno (acumula dívida de pontos, mas
 *    esconde tudo e preserva coringa/cartas).
 * O PIMC (game/pimc.ts) escolhe o plano por rollout. Generaliza o meldHold
 * binário (Stage 4), que era só {playAll, holdAll}, com o meio-termo extendOnly.
 */
export type MeldPlan = 'playAll' | 'extendOnly' | 'holdAll';

export function applyMeldPlan(s: GameState, playerId: PlayerId, plan: MeldPlan): void {
  if (plan === 'holdAll') return;
  if (plan === 'extendOnly') { addToGamesPhase(s, playerId); return; }
  // playAll: add (não mata canastra) → seq nova → add (absorve cartas liberadas).
  addToGamesPhase(s, playerId);
  playSequencesPhase(s, playerId);
  addToGamesPhase(s, playerId);
}

/**
 * Um turno completo do bot com a política heurística de produção.
 * `forcedDraw`: se definido, força a 1ª decisão pegar-lixo (true) / comprar
 * (false) — usado pelo PIMC pra avaliar as 2 ações a partir do mesmo estado.
 * `holdMelds`: pula as fases de meld DESTE turno (a obrigação do lixo segue
 * cumprida — é regra) — usado pelo PIMC de timing (segurar vs baixar).
 * `meldPlan`: se definido, sobrepõe holdMelds e aplica um plano específico —
 * usado pelo PIMC de escolha de meld.
 */
export function botTurn(s: GameState, playerId: PlayerId, forcedDraw?: boolean, holdMelds = false, meldPlan?: MeldPlan): void {
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
  const plan: MeldPlan = meldPlan ?? (holdMelds ? 'holdAll' : 'playAll');
  applyMeldPlan(s, playerId, plan);

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

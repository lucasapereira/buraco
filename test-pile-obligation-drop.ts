/**
 * test-pile-obligation-drop.ts — caça empírica ao bug "bot pega o lixo (clássico)
 * mas LARGA a obrigação do topo" (report do usuário: descartei 3♠, bot fez 2 jogos
 * e não usou o 3♠). Força pegar o lixo sempre que canTakePile permite e verifica que
 * a obrigação SEMPRE é cumprida por uma meld que contém o topo.
 * Run: npx tsx test-pile-obligation-drop.ts
 */
// PRNG determinístico (mulberry32) p/ comparar runs antes/depois do fix.
let _seed = 0x9e3779b9;
function mulberry32() {
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = mulberry32;

import { Card, generateDeck, shuffle } from './game/deck';
import { GameState, Player, TeamState, TeamId, PlayerId, getNextPlayer, TURN_ORDER } from './game/engine';
import { canTakePile, findPileTopPlay, checkCanasta, sortCardsBySuitAndValue } from './game/rules';
import {
  drawFromDeck, drawFromPile, playWithPileTop, applyMeldPlan, discard,
  checkBater, endRound, playerOf, teamOf, playCards, addToExistingGame,
} from './game/headlessEngine';

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

// Existe uma jogada legal (mão NÃO-enterrada, aceita pelo engine, sem strand) que
// cumpre a obrigação? Testa cada candidata de findPileTopPlay num clone.
function legalFulfillmentExists(s: GameState, pid: PlayerId, topId: string): boolean {
  const p = playerOf(s, pid);
  const buried = new Set(s.pileTakenBuriedIds ?? []);
  const top = p.hand.find(c => c.id === topId);
  if (!top) return false;
  const usable = p.hand.filter(c => c.id !== topId && !buried.has(c.id));
  // Enumera candidatas via findPileTopPlay com accept que testa cada uma num clone.
  const games = teamOf(s, pid).games;
  const r = findPileTopPlay(usable, top, games, s.gameMode, (gi, cardIds) => {
    // Espelha o guard 500/1000 do passo-4: o bot RECUSA sujar canastra limpa de
    // ≥13 (designed) — não conta como "fulfillment legal disponível".
    if (gi >= 0) {
      const game = games[gi];
      if (game.length >= 13 && checkCanasta(game) === 'clean') {
        const added = p.hand.filter(c => cardIds.includes(c.id));
        if (checkCanasta([...game, ...added]) !== 'clean') return false;
      }
    }
    const c = clone(s);
    const ok = gi >= 0 ? addToExistingGame(c, pid, cardIds, gi) : playCards(c, pid, cardIds);
    return ok; // só aceita candidata se o engine de fato a executa
  });
  return r !== null;
}

function freshState(seedTag: number): GameState {
  const allCards = shuffle(generateDeck());
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
  return {
    players, teams, deck: allCards, pile: [allCards.pop()!], deads,
    currentTurnPlayerId: TURN_ORDER[seedTag % 4], turnPhase: 'draw',
    winnerTeamId: null, roundOver: false, roundStatsRecorded: false,
    targetScore: 3000, matchScores: { 'team-1': 0, 'team-2': 0 }, gameLog: [],
    lastDrawnCardId: null, gameMode: 'classic', botDifficulty: 'hard',
    discardedCardHistory: [], mustPlayPileTopId: null, pileTakenBuriedIds: [],
    deckReshuffleCount: 0, turnHistory: [], roundNumber: 1, gameId: 'sim' + seedTag,
  } as GameState;
}

let realBugDrops = 0;
let artifactDrops = 0;
const dropSamples: string[] = [];

function manualTurn(s: GameState, pid: PlayerId): void {
  if (s.turnPhase === 'draw') {
    // FORÇA pegar o lixo sempre que for legal (estressa a obrigação ao máximo).
    const canTake = s.pile.length > 0 && canTakePile(playerOf(s, pid).hand, s.pile, teamOf(s, pid).games, s.gameMode);
    if (canTake) {
      if (!drawFromPile(s, pid)) { if (!drawFromDeck(s, pid)) return; }
    } else {
      if (!drawFromDeck(s, pid)) return;
    }
  }
  if (s.roundOver) return;

  if (s.mustPlayPileTopId) {
    const topId = s.mustPlayPileTopId;
    const buriedSnapshot = [...(s.pileTakenBuriedIds ?? [])];
    // Existia jogada legal ANTES de tentar cumprir? (se não, o drop é por strand/
    // captura impossível — artefato do sim, não bug de cumprimento.)
    const legalExisted = legalFulfillmentExists(s, pid, topId);
    playWithPileTop(s, pid, topId);
    // DROP detectado: obrigação limpa mas o topo ainda está na mão.
    const stillInHand = playerOf(s, pid).hand.some(c => c.id === topId);
    if (s.mustPlayPileTopId === null && stillInHand) {
      if (legalExisted) {
        realBugDrops++;
        if (dropSamples.length < 8) {
          const top = playerOf(s, pid).hand.find(c => c.id === topId)!;
          const hand = playerOf(s, pid).hand.map(c => c.id).join(',');
          const games = teamOf(s, pid).games.map(g => g.map(c => c.id).join('-')).join(' | ');
          dropSamples.push(`top=${top.id} buried=[${buriedSnapshot.join(',')}]\n     hand=${hand}\n     games=${games}`);
        }
      } else {
        artifactDrops++;
      }
    }
  }
  applyMeldPlan(s, pid, 'playAll');
  if (checkBater(s, pid)) return;

  const p = playerOf(s, pid);
  if (p.hand.length > 0) {
    // descarte simples: primeira carta descartável
    let discarded = false;
    for (const c of p.hand) { if (discard(s, pid, c.id)) { discarded = true; break; } }
    if (!discarded) return;
  }
  if (p.hand.length === 0) { endRound(s, true, teamOf(s, pid).id); return; }
  s.currentTurnPlayerId = getNextPlayer(pid);
  s.turnPhase = 'draw';
  s.lastDrawnCardId = null;
}

const GAMES = 4000;
let takes = 0;
for (let g = 0; g < GAMES; g++) {
  const s = freshState(g);
  let safety = 0;
  while (!s.roundOver && safety < 400) {
    safety++;
    const before = s.currentTurnPlayerId;
    const hadObligationBefore = !!s.mustPlayPileTopId;
    manualTurn(s, before);
    if (hadObligationBefore || (s.turnPhase === 'play')) { /* noop */ }
    if (s.currentTurnPlayerId === before && !s.roundOver) {
      // travou — força avanço
      s.currentTurnPlayerId = getNextPlayer(before);
      s.turnPhase = 'draw';
      s.mustPlayPileTopId = null;
      s.pileTakenBuriedIds = [];
    }
    if (s.deck.length === 0) break;
  }
}

console.log(`\nSimulação clássica: ${GAMES} rodadas.`);
console.log(`Drops por STRAND/captura-impossível (artefato do sim, não bug): ${artifactDrops}`);
console.log(`Drops REAIS (existia jogada legal na mão, mas a obrigação foi largada): ${realBugDrops}`);
if (dropSamples.length) {
  console.log('\nAmostras de drop REAL:');
  dropSamples.forEach((d, i) => console.log(`  [${i}] ${d}`));
}
console.log(realBugDrops === 0 ? '\n✅ Nenhum drop real — obrigação sempre cumprida quando há jogada legal.' : `\n❌ ${realBugDrops} drops reais detectados.`);
process.exit(realBugDrops === 0 ? 0 : 1);

/**
 * test-discard-vetoes.ts — reproduz os dois reports (jogo clássico, Difícil):
 *  (1) parceiro com 5 cartas descartou a carta que COMPLETAVA a canastra REAL
 *      do time (meldHold segurou os melds → o descarte era o único filtro);
 *  (2) lixo com ~20 cartas: bot descartou carta que encaixava DIRETO na meld
 *      visível do oponente, que capturou o lixo inteiro.
 * Verifica os VETOS DUROS nos dois escolhedores (chooseBestDiscard heurístico —
 * também usado pelo rollout do headless — e candidatas do PIMC), incluindo o
 * fallback quando TODAS as candidatas são vetadas.
 * Run: npx tsx test-discard-vetoes.ts
 */
// PRNG determinístico (mulberry32) p/ runs reprodutíveis.
let _seed = 0x9e3779b9;
function mulberry32() {
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = mulberry32;

import { Card, generateDeck } from './game/deck';
import { GameState, Player, TeamState, TeamId } from './game/engine';
import { sortCardsBySuitAndValue } from './game/rules';
import { chooseBestDiscard, isVetoedDiscard, discardCompletesTeamCanasta, discardFeedsBigPile } from './game/botHelpers';
import { pimcChooseDiscardSync } from './game/pimc';

/** Remove e retorna a 1ª carta (suit, value) ainda disponível no pool. */
function pull(pool: Card[], suit: string, value: number): Card {
  const i = pool.findIndex(c => c.suit === suit && c.value === value);
  if (i < 0) throw new Error(`carta ${suit}-${value} indisponível`);
  return pool.splice(i, 1)[0];
}

interface Setup {
  botHand: [string, number][];
  teamGames: [string, number][][];   // jogos do time do bot (team-1)
  oppGames: [string, number][][];    // jogos do oponente (team-2)
  pileSize: number;
}

function buildState(setup: Setup): GameState {
  const pool = generateDeck();
  const teamGames = setup.teamGames.map(g => g.map(([s, v]) => pull(pool, s, v)));
  const oppGames = setup.oppGames.map(g => g.map(([s, v]) => pull(pool, s, v)));
  const botHand = sortCardsBySuitAndValue(setup.botHand.map(([s, v]) => pull(pool, s, v)));
  const pile = pool.splice(0, setup.pileSize);
  const deads: Card[][] = [pool.splice(0, 11), pool.splice(0, 11)];
  const players: Player[] = [
    { id: 'user',  teamId: 'team-1', name: 'user',  hand: pool.splice(0, 9), hasGottenDead: false },
    { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: pool.splice(0, 9), hasGottenDead: false },
    { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: botHand, hasGottenDead: false },
    { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: pool.splice(0, 9), hasGottenDead: false },
  ];
  const teams: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: teamGames, score: 0, hasGottenDead: false },
    'team-2': { id: 'team-2', games: oppGames, score: 0, hasGottenDead: false },
  };
  return {
    players, teams, deck: pool, pile, deads,
    currentTurnPlayerId: 'bot-2', turnPhase: 'play',
    winnerTeamId: null, roundOver: false, roundStatsRecorded: false,
    targetScore: 3000, matchScores: { 'team-1': 0, 'team-2': 0 }, gameLog: [],
    lastDrawnCardId: null, gameMode: 'classic', botDifficulty: 'expert',
    discardedCardHistory: [], mustPlayPileTopId: null, pileTakenBuriedIds: [],
    deckReshuffleCount: 0, turnHistory: [], roundNumber: 1, gameId: 'veto-test',
  } as GameState;
}

let failures = 0;
function check(label: string, ok: boolean, detail: string = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function discardChoices(s: GameState): { heur: string; pimc: string | null } {
  const bot = s.players.find(p => p.id === 'bot-2')!;
  const heur = chooseBestDiscard(
    bot.hand, s.discardedCardHistory, 'hard', s.lastDrawnCardId, s.gameMode,
    s.teams['team-1'].games, null, s.teams['team-2'].games, false, s.pile.length
  ).id;
  const pimc = pimcChooseDiscardSync(s, 'bot-2', { determinizations: 20 });
  return { heur, pimc };
}

// ── Caso 1: report "descartou a 7ª da canastra real" ────────────────────────
// Time tem 5♣..10♣ LIMPO (6 cartas); bot (parceiro, 5 cartas) tem o J♣ que
// completa a canastra real. J♣ JAMAIS pode ser descartado.
{
  const s = buildState({
    botHand: [['clubs', 11], ['hearts', 3], ['spades', 7], ['hearts', 12], ['diamonds', 4]],
    teamGames: [[['clubs', 5], ['clubs', 6], ['clubs', 7], ['clubs', 8], ['clubs', 9], ['clubs', 10]]],
    oppGames: [],
    pileSize: 2,
  });
  const jClubs = s.players.find(p => p.id === 'bot-2')!.hand.find(c => c.suit === 'clubs' && c.value === 11)!;
  check('caso 1: veto detecta a carta que completa a canastra real',
    discardCompletesTeamCanasta(jClubs, s.teams['team-1'].games, 'classic'));
  for (let run = 0; run < 30; run++) {
    const { heur, pimc } = discardChoices(s);
    if (heur === jClubs.id || pimc === jClubs.id) {
      check('caso 1: J♣ nunca é descartado (30 runs)', false, `run ${run}: heur=${heur} pimc=${pimc}`);
      break;
    }
    if (run === 29) check('caso 1: J♣ nunca é descartado (30 runs)', true);
  }
}

// ── Caso 2: report "lixo de ~20 cartas alimentado" ───────────────────────────
// Oponente tem 5♦..9♦ visível; lixo com 20 cartas; bot tem o 10♦ (encaixe
// direto = entrega garantida do lixo). 10♦ JAMAIS pode ser descartado.
{
  const s = buildState({
    botHand: [['diamonds', 10], ['hearts', 4], ['spades', 8], ['clubs', 13], ['hearts', 9], ['spades', 12]],
    teamGames: [],
    oppGames: [[['diamonds', 5], ['diamonds', 6], ['diamonds', 7], ['diamonds', 8], ['diamonds', 9]]],
    pileSize: 20,
  });
  const tenD = s.players.find(p => p.id === 'bot-2')!.hand.find(c => c.suit === 'diamonds' && c.value === 10)!;
  check('caso 2: veto detecta encaixe direto no oponente com lixo grande',
    discardFeedsBigPile(tenD, s.teams['team-2'].games, s.pile.length, 'classic'));
  for (let run = 0; run < 30; run++) {
    const { heur, pimc } = discardChoices(s);
    if (heur === tenD.id || pimc === tenD.id) {
      check('caso 2: 10♦ nunca é descartado (30 runs)', false, `run ${run}: heur=${heur} pimc=${pimc}`);
      break;
    }
    if (run === 29) check('caso 2: 10♦ nunca é descartado (30 runs)', true);
  }
}

// ── Caso 2b: lixo PEQUENO não dispara o veto de pile-feed ───────────────────
{
  const s = buildState({
    botHand: [['diamonds', 10], ['hearts', 4]],
    teamGames: [],
    oppGames: [[['diamonds', 5], ['diamonds', 6], ['diamonds', 7], ['diamonds', 8], ['diamonds', 9]]],
    pileSize: 2,
  });
  const tenD = s.players.find(p => p.id === 'bot-2')!.hand.find(c => c.suit === 'diamonds' && c.value === 10)!;
  check('caso 2b: lixo pequeno (2) não veta o encaixe direto',
    !discardFeedsBigPile(tenD, s.teams['team-2'].games, s.pile.length, 'classic'));
}

// ── Caso 3: fallback — TODAS as candidatas vetadas ⇒ ainda descarta ─────────
{
  const s = buildState({
    botHand: [['diamonds', 10], ['diamonds', 4]], // ambas estendem 5♦..9♦
    teamGames: [],
    oppGames: [[['diamonds', 5], ['diamonds', 6], ['diamonds', 7], ['diamonds', 8], ['diamonds', 9]]],
    pileSize: 20,
  });
  const bot = s.players.find(p => p.id === 'bot-2')!;
  const allVetoed = bot.hand.every(c =>
    isVetoedDiscard(c, s.teams['team-1'].games, s.teams['team-2'].games, s.pile.length, 'classic'));
  check('caso 3: setup — todas as candidatas vetadas', allVetoed);
  const { heur, pimc } = discardChoices(s);
  check('caso 3: heurística ainda descarta algo (fallback)', bot.hand.some(c => c.id === heur));
  check('caso 3: PIMC ainda descarta algo (fallback)', pimc !== null && bot.hand.some(c => c.id === pimc));
}

console.log(failures === 0 ? '\n✅ Todos os vetos de descarte OK.' : `\n❌ ${failures} falhas.`);
process.exit(failures === 0 ? 0 : 1);

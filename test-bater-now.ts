/**
 * test-bater-now.ts — report "parceiro tinha o Ás que fechava a canastra de 1000
 * (jogo 2♦..A♦ de 13, limpo) e mais 1 carta; podia BATER fechando a de mil e
 * preferiu descartar o Ás". Cadeia do bug: meldHold segurava (no rollout as duas
 * branches acabam batendo → diferença = ruído → hold ganha ~50%) e o descarte
 * PIMC, sem sinal de auto-encaixe, jogava o Ás fora.
 * Fixes verificados aqui:
 *  (1) canBaterNow detecta o bater disponível → curto-circuita o hold;
 *  (2) as fases de meld fecham a canastra de 14 (dois Ases, engine aceita) e o
 *      descarte da última carta bate;
 *  (3) mesmo se algum caminho segurasse, o VETO de descarte nunca entrega o Ás.
 * Run: npx tsx test-bater-now.ts
 */
let _seed = 0xBADA55;
function mulberry32() {
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = mulberry32;

import { Card, generateDeck } from './game/deck';
import { GameState, Player, TeamState, TeamId } from './game/engine';
import { validateSequence, checkCanasta } from './game/rules';
import { chooseBestDiscard, canastaBonusValue } from './game/botHelpers';
import { canBaterNow, pimcChooseDiscardSync } from './game/pimc';
import { addToGamesPhase, playSequencesPhase, discard, playerOf } from './game/headlessEngine';

function pull(pool: Card[], suit: string, value: number): Card {
  const i = pool.findIndex(c => c.suit === suit && c.value === value);
  if (i < 0) throw new Error(`sem ${suit}-${value}`);
  return pool.splice(i, 1)[0];
}

let failures = 0;
function check(label: string, ok: boolean, detail: string = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function buildReportState(extraHand: [string, number][]): { s: GameState; ace: Card } {
  const pool = generateDeck();
  // Jogo 1: 2♦..A♦ (13 cartas, limpo, 500) — o 2♦ é natural na posição
  const run13 = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(v => pull(pool, 'diamonds', v));
  // Jogo 2: J♣ Q♣ + 2♣ (coringa do naipe)
  const jqw = [pull(pool, 'clubs', 11), pull(pool, 'clubs', 12), pull(pool, 'clubs', 2)];
  // Mão do parceiro (bot-2): o SEGUNDO A♦ + extras
  const ace = pull(pool, 'diamonds', 14);
  const hand = [ace, ...extraHand.map(([su, v]) => pull(pool, su, v))];
  const players: Player[] = [
    { id: 'user',  teamId: 'team-1', name: 'user',  hand: pool.splice(0, 9), hasGottenDead: true },
    { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: pool.splice(0, 9), hasGottenDead: false },
    { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand, hasGottenDead: false },
    { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: pool.splice(0, 9), hasGottenDead: false },
  ];
  const teams: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: [run13, jqw], score: 0, hasGottenDead: true }, // morto já pego
    'team-2': { id: 'team-2', games: [], score: 0, hasGottenDead: false },
  };
  const s: GameState = {
    players, teams, deck: pool, pile: [pool.pop()!], deads: [pool.splice(0, 11)],
    currentTurnPlayerId: 'bot-2', turnPhase: 'play',
    winnerTeamId: null, roundOver: false, roundStatsRecorded: false,
    targetScore: 3000, matchScores: { 'team-1': 0, 'team-2': 0 }, gameLog: [],
    lastDrawnCardId: null, gameMode: 'classic', botDifficulty: 'expert',
    discardedCardHistory: [], mustPlayPileTopId: null, pileTakenBuriedIds: [],
    deckReshuffleCount: 0, turnHistory: [], roundNumber: 1, gameId: 'bater',
  } as GameState;
  return { s, ace };
}

// ── (0) sanidade do engine: dois Ases fecham a de 14 ────────────────────────
{
  const { s, ace } = buildReportState([['hearts', 8]]);
  const run13 = s.teams['team-1'].games[0];
  check('engine aceita A♦ extra no 2♦..A♦ (14 cartas)', validateSequence([...run13, ace], 'classic'));
  check('a de 14 é canastra LIMPA de 1000',
    checkCanasta([...run13, ace]) === 'clean' && canastaBonusValue([...run13, ace]) === 1000);
}

// ── (1) canBaterNow detecta o bater disponível ───────────────────────────────
{
  const { s } = buildReportState([['hearts', 8]]); // mão = A♦ + 8♥
  check('canBaterNow = true (A♦ fecha a de 1000, 8♥ é o descarte final)', canBaterNow(s, 'bot-2'));
}

// ── (2) fases de meld + descarte final = bateu com a canastra de mil ─────────
{
  const { s } = buildReportState([['hearts', 8]]);
  addToGamesPhase(s, 'bot-2');
  playSequencesPhase(s, 'bot-2');
  addToGamesPhase(s, 'bot-2');
  const hand = playerOf(s, 'bot-2').hand;
  const g0 = s.teams['team-1'].games[0];
  check('fase de meld jogou o A♦ (jogo virou 14 limpo)', g0.length === 14 && checkCanasta(g0) === 'clean');
  check('sobrou só o descarte final', hand.length === 1);
  const ok = hand.length === 1 && discard(s, 'bot-2', hand[0].id);
  check('descarte final aceito → mão zerou (bateu)', ok && playerOf(s, 'bot-2').hand.length === 0);
}

// ── (3) safety net: o Ás NUNCA é descartável, mesmo segurando melds ──────────
{
  const { s, ace } = buildReportState([['hearts', 8]]);
  const bot = s.players.find(p => p.id === 'bot-2')!;
  const heur = chooseBestDiscard(
    bot.hand, s.discardedCardHistory, 'hard', null, 'classic',
    s.teams['team-1'].games, null, s.teams['team-2'].games, false, s.pile.length
  );
  check('heurística não descarta o A♦', heur.id !== ace.id);
  for (let r = 0; r < 20; r++) {
    const pimc = pimcChooseDiscardSync(s, 'bot-2', { determinizations: 15 });
    if (pimc === ace.id) { check('PIMC não descarta o A♦ (20 runs)', false, `run ${r}`); break; }
    if (r === 19) check('PIMC não descarta o A♦ (20 runs)', true);
  }
}

// ── (4) negativo: mão que NÃO bate não dispara o curto-circuito ──────────────
{
  const { s } = buildReportState([['hearts', 8], ['spades', 5], ['hearts', 13]]); // 4 cartas, 3 mortas
  check('canBaterNow = false com 3 cartas mortas sobrando', !canBaterNow(s, 'bot-2'));
}

console.log(failures === 0 ? '\n✅ Bater disponível nunca mais é segurado/descartado.' : `\n❌ ${failures} falhas.`);
process.exit(failures === 0 ? 0 : 1);

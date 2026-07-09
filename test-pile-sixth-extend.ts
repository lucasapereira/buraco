/**
 * test-pile-sixth-extend.ts — report "o adversário tem um jogo de 5 cartas, eu
 * descarto a 6ª e ele NÃO pega o lixo". Diagnóstico: o rollout material do PIMC
 * recusava 27% (meld limpa) a 37% (suja) dessas extensões diretas com lixo
 * pequeno. Fix: override positivo pileTopExtendsTeamMeld (botHelpers) aplicado
 * pós-PIMC em useBotAI + botSim (gate PILEFIT).
 * Verifica: (1) o predicado nas formas certas (e NÃO nas erradas), (2) a decisão
 * composta (PIMC + override + vetos) pega 100% no cenário do report.
 * Run: npx tsx test-pile-sixth-extend.ts
 */
let _seed = 0xC0FFEE;
function mulberry32() {
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = mulberry32;

import { Card, generateDeck, shuffle } from './game/deck';
import { GameState, Player, TeamState, TeamId } from './game/engine';
import { canTakePile } from './game/rules';
import { pileTopExtendsTeamMeld, pileTakeForcesDirtyingCleanPath, wildTopTakeVeto } from './game/botHelpers';
import { pimcDecideSync } from './game/pimc';

function pull(pool: Card[], suit: string, value: number): Card {
  const i = pool.findIndex(c => c.suit === suit && c.value === value && (value === 2 || !c.isJoker));
  if (i < 0) throw new Error(`sem ${suit}-${value}`);
  return pool.splice(i, 1)[0];
}

let failures = 0;
function check(label: string, ok: boolean, detail: string = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// ── Parte 1: o predicado ─────────────────────────────────────────────────────
{
  const pool = generateDeck();
  const clean5 = [5, 6, 7, 8, 9].map(v => pull(pool, 'hearts', v));
  const wild = pull(pool, 'spades', 2);
  const dirty5 = [wild, ...[6, 7, 8, 9].map(v => pull(pool, 'diamonds', v))];
  const clean6 = [4, 5, 6, 7, 8, 9].map(v => pull(pool, 'clubs', v));
  const canasta8 = [3, 4, 5, 6, 7, 8, 9, 10].map(v => pull(pool, 'spades', v));

  const tenH = pull(pool, 'hearts', 10);
  check('estende limpa 5→6 (natural)', pileTopExtendsTeamMeld([tenH], [clean5], 'classic'));
  const tenD = pull(pool, 'diamonds', 10);
  check('estende suja 5→6 (natural)', pileTopExtendsTeamMeld([tenD], [dirty5], 'classic'));
  const tenC = pull(pool, 'clubs', 10);
  check('fecha canastra 6→7 (delta>0)', pileTopExtendsTeamMeld([tenC], [clean6], 'classic'));
  const wildTop = pull(pool, 'diamonds', 2); // coringa no topo sujaria a limpa de 5
  check('NÃO dispara: coringa degradaria limpa', !pileTopExtendsTeamMeld([wildTop], [clean5], 'classic'));
  const jS = pull(pool, 'spades', 11);
  check('NÃO dispara: canastra 8 estagnada (delta 0)', !pileTopExtendsTeamMeld([jS], [canasta8], 'classic'));
  const kH = pull(pool, 'hearts', 13);
  check('NÃO dispara: carta que não encaixa', !pileTopExtendsTeamMeld([kH], [clean5], 'classic'));
}

// ── Parte 2: decisão composta no cenário do report (40 mãos aleatórias) ─────
{
  const TRIALS = 40;
  let takes = 0, n = 0;
  for (let t = 0; t < TRIALS; t++) {
    const pool = shuffle(generateDeck());
    const meld = [5, 6, 7, 8, 9].map(v => pull(pool, 'hearts', v));
    const top = pull(pool, 'hearts', 10);
    const deads: Card[][] = [pool.splice(0, 11), pool.splice(0, 11)];
    const players: Player[] = [
      { id: 'user',  teamId: 'team-1', name: 'user',  hand: pool.splice(0, 9), hasGottenDead: false },
      { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: pool.splice(0, 10), hasGottenDead: false },
      { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: pool.splice(0, 9), hasGottenDead: false },
      { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: pool.splice(0, 9), hasGottenDead: false },
    ];
    const teams: Record<TeamId, TeamState> = {
      'team-1': { id: 'team-1', games: [], score: 0, hasGottenDead: false },
      'team-2': { id: 'team-2', games: [meld], score: 0, hasGottenDead: false },
    };
    const s: GameState = {
      players, teams, deck: pool, pile: [top], deads,
      currentTurnPlayerId: 'bot-1', turnPhase: 'draw',
      winnerTeamId: null, roundOver: false, roundStatsRecorded: false,
      targetScore: 3000, matchScores: { 'team-1': 0, 'team-2': 0 }, gameLog: [],
      lastDrawnCardId: null, gameMode: 'classic', botDifficulty: 'expert',
      discardedCardHistory: [], mustPlayPileTopId: null, pileTakenBuriedIds: [],
      deckReshuffleCount: 0, turnHistory: [], roundNumber: 1, gameId: 'sixth' + t,
    } as GameState;
    const bot = players[1];
    if (!canTakePile(bot.hand, s.pile, teams['team-2'].games, 'classic')) continue;
    n++;
    // Réplica exata da composição de produção (useBotAI fase draw, expert):
    let take = pimcDecideSync(s, 'bot-1', { determinizations: 60 });
    if (!take && pileTopExtendsTeamMeld(s.pile, teams['team-2'].games, s.gameMode)) take = true;
    if (take && (
      pileTakeForcesDirtyingCleanPath(bot.hand, s.pile, teams['team-2'].games, s.gameMode)
      || wildTopTakeVeto(s.pile, bot.hand, teams['team-2'].games, s.gameMode)
    )) take = false;
    if (take) takes++;
  }
  check(`decisão composta pega 100% (${takes}/${n})`, n > 0 && takes === n);
}

console.log(failures === 0 ? '\n✅ Extensão direta do lixo OK.' : `\n❌ ${failures} falhas.`);
process.exit(failures === 0 ? 0 : 1);

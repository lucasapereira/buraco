/**
 * test-place-clean-vs-dirty.ts — repro do report:
 * "dois jogos de paus aceitavam o 8♣; um já era canastra suja, o outro ia virar
 *  canastra real (limpa). O bot botou no jogo sujo."
 *
 * Roda addToGamesPhase (mesma lógica do doBotAddToGamesAsync em useBotAI.ts).
 * Run:  npx tsx test-place-clean-vs-dirty.ts
 */
import { createInitialGameState, GameState, PlayerId } from './game/engine';
import { Card } from './game/deck';
import { addToGamesPhase } from './game/headlessEngine';
import { checkCanasta } from './game/rules';

function card(id: string, suit: Card['suit'], value: Card['value']): Card {
  return { id, deck: 1, suit, value, isJoker: value === 2 || suit === 'joker' };
}
const C = (vals: number[], p: string): Card[] =>
  vals.map(v => card(`${p}-${v}`, 'clubs', v as Card['value']));
const wildD = (id: string): Card => card(id, 'diamonds', 2); // coringa (2♦)
const eight = (): Card => card('8c', 'clubs', 8);

// Canastra SUJA completa de paus que aceita 8♣ no topo: [A,2♦,3,4,5,6,7♣] (len7).
// (lado alto 9-A só dá 6 cartas, então a única canastra suja que aceita 8♣ termina no 7)
const dirtyCanasta = (p: string): Card[] =>
  [card(`${p}-A`, 'clubs', 14), wildD(`${p}-w`), ...C([3,4,5,6,7], p)];

let pass = 0, fail = 0;
function run(name: string, games: Card[][], expectIdx: number) {
  const botId: PlayerId = 'bot-1';
  const s: GameState = createInitialGameState(1500, 'classic', 'hard');
  s.currentTurnPlayerId = botId;
  s.turnPhase = 'play';
  s.gameLog = [];
  const bot = s.players.find(p => p.id === botId)!;
  const team = s.teams[bot.teamId];
  team.hasGottenDead = true;
  team.games = games.map(g => [...g]);
  // cartas extras (não encaixam em paus) p/ adicionar 8♣ não esvaziar a mão (bater ilegal)
  bot.hand = [eight(), card('h9', 'hearts', 9), card('sj', 'spades', 11)];

  console.log(`\n── ${name} ──`);
  games.forEach((g, i) =>
    console.log(`   jogo[${i}] len=${g.length} canasta=${checkCanasta(g)} hasJoker=${g.some(c => c.isJoker)} :: ${g.map(c => c.value + c.suit[0]).join(' ')}`));

  addToGamesPhase(s, botId);

  const g8 = team.games.findIndex(g => g.some(c => c.id === '8c'));
  const ok = g8 === expectIdx;
  if (ok) pass++; else fail++;
  console.log(`   → 8♣ foi p/ jogo[${g8}] (esperado [${expectIdx}])  ${ok ? '✅' : '❌ BUG'}`);
}

// A: limpo SEM coringa (3-7♣ len5) vs suja completa. Esperado: limpo (idx1).
run('A: limpo s/coringa 3-7♣(len5)  vs  suja completa',
  [dirtyCanasta('da'), C([3,4,5,6,7], 'a')], 1);

// B: natural-2 (2-7♣ len6, FECHA canastra real com 8♣) vs suja completa. Esperado: limpo (idx1).
run('B: natural-2  2-7♣(len6, fecha REAL)  vs  suja completa',
  [dirtyCanasta('db'), C([2,3,4,5,6,7], 'b')], 1);

// C: crescendo com coringa-diamante embutido (aClean=false, NÃO fecha, delta0) vs suja completa.
//    [3♦w,4,5,6,7♣] len5. Esperado: o crescendo (idx1) — alimentar canastra futura, não engordar a completa.
run('C: cresc. c/coringa 4-7♣+2♦(len5, delta0)  vs  suja completa',
  [dirtyCanasta('dc'), [wildD('cw'), ...C([4,5,6,7], 'c')]], 1);

console.log(`\n=== ${pass} pass / ${fail} fail ===`);

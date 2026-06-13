/**
 * Reprodução dos 2 reports do usuário (2026-06-06):
 *  (1) Bot tem [4..9♣ + 2♣wild] (canastra suja REGATÁVEL: o 2♣ está na ponta,
 *      um 3♣ natural a limparia). Bot mete um J♣ → trava o coringa no miolo (10),
 *      e a canastra fica suja PARA SEMPRE. Burro.
 *  (2) Bot tem canastra grande suja regatável; humano descarta o 3 que a limparia
 *      (suja→limpa, podendo virar 500). Bot não pega o lixo.
 * Run: npx tsx test-wild-lock-repro.ts
 */
import { Card } from './game/deck';
import { GameState } from './game/engine';
import { createInitialGameState } from './game/engine';
import { botTurn } from './game/headlessEngine';
import { shouldTakePileSmart } from './game/botHelpers';
import { checkCanasta } from './game/rules';

function card(id: string, suit: Card['suit'], value: number): Card {
  return { id, deck: 1, suit, value: value as Card['value'], isJoker: value === 2 || suit === 'joker' };
}
const clubs = (v: number, d = 1) => card(`c${v}-${d}`, 'clubs', v);
const wildClub = card('w-clubs', 'clubs', 2); // 2♣ = coringa (na ponta da seq, regatável)

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${detail}`); }
}

function baseState(): GameState {
  const s = createInitialGameState(3000, 'classic', 'hard');
  // Zera mãos e mesa pra controle total
  for (const p of s.players) p.hand = [];
  s.teams['team-1'].games = [];
  s.teams['team-2'].games = [];
  s.teams['team-1'].hasGottenDead = true;
  s.teams['team-2'].hasGottenDead = true;
  for (const p of s.players) p.hasGottenDead = true;
  s.deads = [];
  s.deck = [card('dk1', 'spades', 7), card('dk2', 'hearts', 7)];
  s.pile = [];
  return s;
}

// ── Issue 1: bot não deve travar o coringa metendo J♣ na canastra regatável ──
console.log('\n── Issue 1: trava de coringa por extensão ──');
{
  const s = baseState();
  // Canastra suja regatável: 4,5,6,7,8,9 de paus + 2♣ (coringa na ponta).
  const dirtyCanasta = [clubs(4), clubs(5), clubs(6), clubs(7), clubs(8), clubs(9), wildClub];
  s.teams['team-1'].games = [dirtyCanasta];
  console.log('  canastra inicial:', checkCanasta(dirtyCanasta), `(len ${dirtyCanasta.length})`);
  // Bot-2 (team-1) joga. Mão: J♣ + cartas de descarte irrelevantes.
  const bot = s.players.find(p => p.id === 'bot-2')!;
  bot.hand = [clubs(11), card('h4', 'hearts', 4), card('s9', 'spades', 9), card('d5', 'diamonds', 5)];
  s.currentTurnPlayerId = 'bot-2';
  s.turnPhase = 'play';
  s.mustPlayPileTopId = null;
  botTurn(s, 'bot-2');
  const g = s.teams['team-1'].games[0];
  console.log('  canastra final:', checkCanasta(g), `(len ${g.length}) =`, g.map(c => c.isJoker ? '★' + c.suit[0] : c.value + c.suit[0]).join(' '));
  check('NÃO travou o coringa (canastra continua regatável/limpa, ou J não foi metido)',
    !(g.length === 8 && checkCanasta(g) === 'dirty'),
    `→ ficou ${checkCanasta(g)} len ${g.length}`);
}

// ── Issue 2: bot deve pegar o lixo quando o topo (3♣) limpa uma canastra suja grande ──
console.log('\n── Issue 2: pegar lixo que limpa canastra suja → 500 ──');
{
  // Canastra suja regatável de 12 cartas (4..13♣ = 10 naturais + 2♣wild = ... )
  // Construímos: 3-coringa na ponta. Naturais 4..13 (10 cartas) + 2♣ wild = 11.
  // Adicionar 3♣ natural → 2(nat),3,4..13 = 12 naturais limpos? len 12 não dá 500.
  // Pra 500 precisamos len 13 limpa. Façamos naturais 4..K + extra duplicata.
  // Simplificação: canastra suja de 12 onde 3♣ a limpa (suja→limpa, +100 base; e
  // chega a 13 = 500). naturais: 4,5,6,7,8,9,10,J,Q,K (10) + 2 duplicatas + wild?
  // Mantemos só o teste de decisão: top=3♣ deve ser pego.
  const nat = [4,5,6,7,8,9,10,11,12,13].map(v => clubs(v));
  const dup = [clubs(4, 2), clubs(5, 2)]; // duplicatas de deck 2 (mesmo valor permitido? não em seq)
  // Sequência não permite duplicata. Usamos canastra suja de 12: 2♣wild + 4..14(A) = 12.
  const big = [wildClub, ...[4,5,6,7,8,9,10,11,12,13,14].map(v => clubs(v))]; // 12 cartas, dirty (wild ponta baixa)
  console.log('  canastra:', checkCanasta(big), `len ${big.length}`);
  const s = baseState();
  s.teams['team-1'].games = [big];
  const bot = s.players.find(p => p.id === 'bot-2')!;
  // Mão com algo + o 3♣ está no LIXO (topo). Mão precisa poder meldar o topo:
  // o 3♣ estende a canastra (2,3,4..14) → limpa. canTakePile = true (estende jogo).
  bot.hand = [card('h7', 'hearts', 7), card('s8', 'spades', 8), card('d9', 'diamonds', 9)];
  const pile = [card('px', 'hearts', 6), clubs(3)]; // topo = 3♣
  const take = shouldTakePileSmart(pile, bot.hand, 'hard', s.teams['team-1'].games, 'classic', 1.0, true);
  // valida que adicionar 3♣ limpa:
  const cleaned = checkCanasta([...big, clubs(3)]);
  console.log('  3♣ adicionado →', cleaned, `(seria 500? len ${big.length + 1})`);
  check('pega o lixo (3♣ limpa a canastra suja)', take === true, `→ take=${take}`);
}

// ── Regressão negativa: o guard NÃO deve tornar o bot passivo. Deve ESTENDER quando
//    a canastra não é regatável (coringa físico / 2 off-suit) ou já é limpa. ──
console.log('\n── Regressão: bot ainda estende quando não há trava a evitar ──');
import { wouldLockRedeemableWild } from './game/botHelpers';
{
  const physWild = card('joker1', 'joker', 0 as any); physWild.isJoker = true;
  const dirtyPhysical = [clubs(4), clubs(5), clubs(6), clubs(7), clubs(8), clubs(9), physWild]; // coringa físico, nunca regatável
  check('coringa físico: J♣ NÃO é trava (estende livre)',
    wouldLockRedeemableWild(dirtyPhysical, clubs(11), 'classic') === false);

  const offSuitWild = card('wh', 'hearts', 2); // 2♥ usado como wild em paus
  const dirtyOffSuit = [clubs(4), clubs(5), clubs(6), clubs(7), clubs(8), clubs(9), offSuitWild];
  check('2 off-suit: J♣ NÃO é trava (nunca regatável)',
    wouldLockRedeemableWild(dirtyOffSuit, clubs(11), 'classic') === false);

  const cleanCanasta = [clubs(3), clubs(4), clubs(5), clubs(6), clubs(7), clubs(8), clubs(9)]; // 7 naturais, limpa
  check('canastra limpa: J♣ NÃO é trava',
    wouldLockRedeemableWild(cleanCanasta, clubs(11), 'classic') === false);

  // E o caso positivo isolado (suja regatável → J trava):
  const redeemable = [clubs(4), clubs(5), clubs(6), clubs(7), clubs(8), clubs(9), wildClub];
  check('suja regatável: J♣ É trava (bloqueia)',
    wouldLockRedeemableWild(redeemable, clubs(11), 'classic') === true);
  // ...mas o redeemer (3♣) NÃO é trava (limpa):
  check('suja regatável: 3♣ (redeemer) NÃO é trava',
    wouldLockRedeemableWild(redeemable, clubs(3), 'classic') === false);
  // ...e estender pro 10♣ natural mantém regatável (coringa segue na ponta) → NÃO trava:
  check('suja regatável: 10♣ mantém regatabilidade (NÃO trava)',
    wouldLockRedeemableWild(redeemable, clubs(10), 'classic') === false);
}

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

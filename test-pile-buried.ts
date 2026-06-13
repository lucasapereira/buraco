/**
 * test-pile-buried.ts — a meld que CUMPRE a obrigação do lixo (clássico) não
 * pode usar cartas ENTERRADAS do lixo; a captura tem de ser justificada pela MÃO.
 * Run: npx tsx test-pile-buried.ts
 *
 * Report do usuário (2026-06-05): pega o lixo (topo 10♥) com 9♥+coringa na mão,
 * mas o 8♥ está enterrado no lixo. Baixa [9,10,coringa] (legal), aperta VOLTAR e
 * baixa [8,9,10] usando o 8 enterrado → economiza o coringa e faz jogo limpo.
 * Isso é ilegal: a captura tem de usar cartas da MÃO, não do lixo.
 * O voltar continua funcionando p/ o caso legítimo (topo cabe em 2 jogos da mesa).
 */
const asPath = require.resolve('@react-native-async-storage/async-storage');
require.cache[asPath] = {
  id: asPath, filename: asPath, loaded: true, paths: [],
  exports: { __esModule: true, default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
} as any;

import { Card } from './game/deck';
const { useGameStore } = require('./store/gameStore');

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${detail}`); }
}
function card(id: string, suit: Card['suit'], value: Card['value']): Card {
  return { id, deck: 1, suit, value, isJoker: value === 2 || suit === 'joker' };
}
function setup(opts: { pile: Card[]; userHand: Card[]; t1games?: Card[][] }) {
  useGameStore.getState().startNewGame?.('classic', 1500, 'hard');
  useGameStore.setState({
    currentTurnPlayerId: 'user', turnPhase: 'draw', pile: opts.pile, deads: [], gameMode: 'classic',
    players: [
      { id: 'user',  teamId: 'team-1', name: 'Você', hand: opts.userHand, hasGottenDead: true },
      { id: 'bot-1', teamId: 'team-2', name: 'B1', hand: [card('y1','spades',4)], hasGottenDead: true },
      { id: 'bot-2', teamId: 'team-1', name: 'B2', hand: [card('y2','spades',5)], hasGottenDead: true },
      { id: 'bot-3', teamId: 'team-2', name: 'B3', hand: [card('y3','spades',6)], hasGottenDead: true },
    ],
    teams: {
      'team-1': { id: 'team-1', name: 'NÓS', games: opts.t1games ?? [], score: 0, hasGottenDead: true },
      'team-2': { id: 'team-2', name: 'ELES', games: [], score: 0, hasGottenDead: true },
    },
  });
}
const pileTopBuried = () => [card('h8', 'hearts', 8), card('c5', 'clubs', 5), card('h10', 'hearts', 10)];
const hand9wild = () => [card('h9','hearts',9), card('w','diamonds',2 as Card['value']), card('z','spades',13)];

// ── P1: cumprir a obrigação com o 8 ENTERRADO ([8,9,10]) é REJEITADO (direto) ──
console.log('\n── P1: capturar com carta enterrada do lixo é ilegal ──');
{
  setup({ pile: pileTopBuried(), userHand: hand9wild() });
  useGameStore.getState().drawFromPile('user');
  check('playCards [8,9,10] (8 enterrado) === false', useGameStore.getState().playCards('user', ['h8','h9','h10']) === false);
}

// ── P2: capturar com cartas da MÃO ([9,10,coringa]) é PERMITIDO ──
console.log('\n── P2: capturar com cartas da mão é legal ──');
{
  setup({ pile: pileTopBuried(), userHand: hand9wild() });
  useGameStore.getState().drawFromPile('user');
  check('playCards [9,10,coringa] === true', useGameStore.getState().playCards('user', ['h9','h10','w']) === true);
}

// ── P3: o EXPLOIT via VOLTAR — captura legal, undo, recaptura com 8 enterrado → REJEITADO ──
console.log('\n── P3: exploit via voltar (recapturar com carta enterrada) bloqueado ──');
{
  setup({ pile: pileTopBuried(), userHand: hand9wild() });
  useGameStore.getState().drawFromPile('user');
  check('captura legal [9,10,coringa]', useGameStore.getState().playCards('user', ['h9','h10','w']) === true);
  check('undoLastPlay', useGameStore.getState().undoLastPlay('user') === true);
  check('recaptura [8,9,10] (8 enterrado) === false', useGameStore.getState().playCards('user', ['h8','h9','h10']) === false);
}

// ── P4: VOLTAR legítimo — topo cabe em 2 jogos da mesa, troca de um pro outro ──
console.log('\n── P4: voltar legítimo (topo cabe em 2 jogos) continua funcionando ──');
{
  const m1 = [7,8,9].map(v => card(`a${v}`,'hearts',v as Card['value']));   // 10♥ estende → [7,8,9,10]
  const m2 = [11,12,13].map(v => card(`b${v}`,'hearts',v as Card['value'])); // 10♥ estende → [10,J,Q,K]
  // mão grande (3 cartas soltas) pra não encurralar (evita o bloqueio de bater ilegal)
  setup({ pile: [card('h10','hearts',10)], userHand: [card('z1','spades',13), card('z2','clubs',4), card('z3','diamonds',7)], t1games: [m1, m2] });
  useGameStore.getState().drawFromPile('user');
  check('add topo ao jogo 0', useGameStore.getState().addToExistingGame('user', ['h10'], 0) === true);
  check('undoLastPlay', useGameStore.getState().undoLastPlay('user') === true);
  check('add topo ao jogo 1 (escolha alternativa)', useGameStore.getState().addToExistingGame('user', ['h10'], 1) === true);
}

// ── P5: DEPOIS de capturar legal, a carta enterrada vira carta normal e pode ser usada ──
console.log('\n── P5: pós-captura, carta enterrada (8♥) pode estender o jogo ──');
{
  setup({ pile: pileTopBuried(), userHand: hand9wild() });
  useGameStore.getState().drawFromPile('user');
  check('captura legal [9,10,coringa]', useGameStore.getState().playCards('user', ['h9','h10','w']) === true);
  // obrigação cumprida → mustPlay=null, pileTakenBuriedIds=[]; agora o 8♥ é carta normal
  check('add 8♥ ao jogo de copas (já livre) === true', useGameStore.getState().addToExistingGame('user', ['h8'], 0) === true);
}

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

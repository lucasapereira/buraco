/**
 * test-pile-deadlock.ts — guarda de "não pode pegar o lixo (bater ilegal)" no
 * gameStore (caminho do JOGADOR humano). Run: npx tsx test-pile-deadlock.ts
 *
 * Report do usuário (2026-06-05): topo do lixo Q♣ FECHAVA a canastra limpa
 * (estendia 6-J♣ → 6-7-8-9-10-J-Q limpa de 7), habilitando o bater — mas o jogo
 * bloqueou ("sua equipe não tem canastra limpa"). Causa: o caminho de ESTENDER
 * jogo existente checava teamHasCleanCanasta do estado ATUAL, não da meld
 * pós-jogada (`combined`). Fix em store/gameStore.ts.
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
function setup(opts: { pile: Card[]; userHand: Card[]; t1games: Card[][] }) {
  useGameStore.getState().startNewGame?.('classic', 1500, 'hard');
  useGameStore.setState({
    currentTurnPlayerId: 'user', turnPhase: 'draw', pile: opts.pile, deads: [], gameMode: 'classic',
    players: [
      { id: 'user',  teamId: 'team-1', name: 'Você', hand: opts.userHand, hasGottenDead: true },
      { id: 'bot-1', teamId: 'team-2', name: 'B1', hand: [card('y1','hearts',9)], hasGottenDead: true },
      { id: 'bot-2', teamId: 'team-1', name: 'B2', hand: [card('y2','hearts',8)], hasGottenDead: true },
      { id: 'bot-3', teamId: 'team-2', name: 'B3', hand: [card('y3','hearts',7)], hasGottenDead: true },
    ],
    teams: {
      'team-1': { id: 'team-1', name: 'NÓS', games: opts.t1games, score: 0, hasGottenDead: true },
      'team-2': { id: 'team-2', name: 'ELES', games: [], score: 0, hasGottenDead: true },
    },
  });
}

// ── P1 (report): Q♣ estende 6-J♣ → canastra LIMPA de 7 → PODE pegar e bater ──
console.log('\n── P1: topo fecha canastra limpa estendendo jogo → permite pegar ──');
{
  const clubs6 = [6, 7, 8, 9, 10, 11].map(v => card(`c${v}`, 'clubs', v as Card['value']));
  setup({ pile: [card('cq', 'clubs', 12)], userHand: [card('xk', 'spades', 13)], t1games: [clubs6] });
  check('drawFromPile(user) === true', useGameStore.getState().drawFromPile('user') === true);
}

// ── P2 (controle): deadlock REAL — estende mas NÃO vira canastra → bloqueia ──
console.log('\n── P2-controle: estende sem fechar canastra, sem limpa, sem morto → bloqueia ──');
{
  const clubs4 = [8, 9, 10, 11].map(v => card(`c${v}`, 'clubs', v as Card['value'])); // 5 cartas após Q → não-canastra
  setup({ pile: [card('cq', 'clubs', 12)], userHand: [card('xk', 'spades', 13)], t1games: [clubs4] });
  check('drawFromPile(user) === false (deadlock legítimo)', useGameStore.getState().drawFromPile('user') === false);
}

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

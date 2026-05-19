/**
 * auditEngine.ts — teste DIFERENCIAL: motor do botSim (reimplementação) vs
 * gameStore.ts (regras reais do jogo). Gate antes de reusar o motor do botSim
 * no PIMC de produção (decisão do usuário: "reusar + auditar").
 *
 * Para N estados de meio-de-jogo amostrados, aplica a MESMA ação primitiva
 * pelos 2 motores e compara o GameState normalizado. Diferença = drift de
 * regras que iria pra produção silenciosamente.
 *
 * Rodar:  npx tsx scripts/auditEngine.ts
 */

// ── Mock do AsyncStorage ANTES de importar o store (persist crasha headless) ──
const asPath = require.resolve('@react-native-async-storage/async-storage');
const memMock = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
require.cache[asPath] = {
  id: asPath, filename: asPath, loaded: true, paths: [],
  exports: { __esModule: true, default: memMock },
} as any;

import { Card } from '../game/deck';
import { GameState, PlayerId } from '../game/engine';
// require (não import) p/ NO_MAIN valer ANTES de carregar o botSim — import
// é hoisted e rodaria main() antes desta linha.
process.env.NO_MAIN = '1';
const sim = require('./botSim');               // só p/ GERAR estados de meio-de-jogo
const eng = require('../game/headlessEngine');  // motor de PRODUÇÃO sob auditoria
const { useGameStore } = require('../store/gameStore');

const clone = (x: GameState): GameState => JSON.parse(JSON.stringify(x));

/** Projeção normalizada p/ comparar (ignora métodos do store, gameLog, ordem). */
function norm(s: GameState): string {
  const ms = (cs: Card[]) => cs.map(c => c.id).sort().join(',');
  return JSON.stringify({
    hands: s.players.map(p => ({ id: p.id, h: ms(p.hand), gd: p.hasGottenDead })),
    games: (['team-1', 'team-2'] as const).map(t => ({
      t, gd: s.teams[t].hasGottenDead,
      g: s.teams[t].games.map(g => ms(g)).sort(),
    })),
    pile: ms(s.pile),
    deckLen: s.deck.length,
    deadsLen: s.deads.map(d => d.length),
    phase: s.turnPhase,
    turn: s.currentTurnPlayerId,
    must: s.mustPlayPileTopId,
    over: s.roundOver,
  });
}

/** Conservação: 104 cartas (clássico) somando mãos+jogos+lixo+baralho+mortos. */
function cardCount(s: GameState): number {
  let n = s.deck.length + s.pile.length + s.deads.reduce((a, d) => a + d.length, 0);
  n += s.players.reduce((a, p) => a + p.hand.length, 0);
  for (const t of ['team-1', 'team-2'] as const) n += s.teams[t].games.reduce((a, g) => a + g.length, 0);
  return n;
}

function applyStore(snap: GameState, fn: (st: any) => void): GameState {
  // merge (NÃO replace) — replace=true apagaria os métodos de ação do store
  useGameStore.setState(clone(snap));
  fn(useGameStore.getState());
  return clone(useGameStore.getState());
}

type Diff = { action: string; simN: string; storeN: string; conserv: [number, number] };

function main() {
  const N_STATES = 250;
  const diffs: Diff[] = [];
  let tested = 0;
  let skippedReshuffle = 0;

  for (let i = 0; i < N_STATES; i++) {
    // Estado de meio-de-jogo: freshState + alguns turnos heurísticos.
    const base = sim.freshState('classic');
    const steps = 3 + Math.floor(Math.random() * 30);
    let st = base;
    for (let k = 0; k < steps && !st.roundOver; k++) {
      const before = st.currentTurnPlayerId;
      sim.runBotTurn(st, st.currentTurnPlayerId);
      if (st.currentTurnPlayerId === before && !st.roundOver) break;
    }
    if (st.roundOver) continue;
    const pid: PlayerId = st.currentTurnPlayerId;
    const player = st.players.find((p: any) => p.id === pid)!;

    // Escolhe uma ação primitiva legal-ish pro estado atual.
    type Act = { name: string; sim: (s: GameState) => void; store: (st: any) => void };
    const acts: Act[] = [];
    if (st.turnPhase === 'draw') {
      acts.push({ name: 'drawFromDeck', sim: s => { eng.drawFromDeck(s, pid); }, store: st => st.drawFromDeck(pid) });
      if (st.pile.length > 0) {
        acts.push({ name: 'drawFromPile', sim: s => { eng.drawFromPile(s, pid); }, store: st => st.drawFromPile(pid) });
      }
    } else if (player.hand.length > 0) {
      const card = player.hand[Math.floor(Math.random() * player.hand.length)];
      acts.push({
        name: `discard:${card.id}`,
        sim: s => { eng.discard(s, pid, card.id); },
        store: st => st.discard(pid, card.id),
      });
    }
    if (acts.length === 0) continue;
    const act = acts[Math.floor(Math.random() * acts.length)];

    // Pula casos com reshuffle (mortos→baralho é aleatório → divergência legítima).
    if (act.name === 'drawFromDeck' && st.deck.length === 0) { skippedReshuffle++; continue; }

    const snap = clone(st);
    const simState = clone(snap);
    try { act.sim(simState); } catch (e: any) { diffs.push({ action: act.name, simN: 'THREW:' + e.message, storeN: '-', conserv: [-1, -1] }); continue; }
    let storeState: GameState;
    try { storeState = applyStore(snap, act.store); } catch (e: any) { diffs.push({ action: act.name, simN: '-', storeN: 'THREW:' + e.message, conserv: [-1, -1] }); continue; }

    tested++;
    const sn = norm(simState), tn = norm(storeState);
    if (sn !== tn) {
      diffs.push({ action: act.name, simN: sn, storeN: tn, conserv: [cardCount(simState), cardCount(storeState)] });
    }
  }

  console.log(`\n─── AUDIT motor headlessEngine (produção) vs gameStore ─────────────`);
  console.log(`estados testados: ${tested}   (pulados reshuffle: ${skippedReshuffle})`);
  console.log(`divergências: ${diffs.length}`);
  const byAction: Record<string, number> = {};
  for (const d of diffs) { const k = d.action.split(':')[0]; byAction[k] = (byAction[k] || 0) + 1; }
  console.log(`por ação: ${JSON.stringify(byAction)}`);
  for (const d of diffs.slice(0, 6)) {
    console.log(`\n  AÇÃO ${d.action}  cartas[sim=${d.conserv[0]} store=${d.conserv[1]}]`);
    console.log(`   sim  : ${d.simN.slice(0, 320)}`);
    console.log(`   store: ${d.storeN.slice(0, 320)}`);
  }
  if (diffs.length === 0) console.log(`\n✅ Sem divergências em ${tested} estados — headlessEngine fiel às regras reais (gameStore).`);
}

main();

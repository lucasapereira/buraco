/**
 * wildHealthCheck.ts — A/B de saúde do bot (produção: game/headlessEngine).
 *
 * Roda N rodadas independentes de self-play (4 bots 'hard', clássico) e agrega
 * métricas de QUALIDADE — não win-rate (self-play simétrico ≈ 50/50), mas sinais
 * que as correções de disciplina de coringa devem MELHORAR ou manter:
 *   - bater%        : fração de rodadas em que alguém bateu (resolve limpo)
 *   - canastras limpas / suja por rodada
 *   - coringas encalhados na mão ao fim (quanto MENOR melhor — desperdício)
 *   - pontos médios baixados
 *
 * Uso:  N=3000 npx tsx scripts/wildHealthCheck.ts
 * A/B:  rodar com código novo, `git stash`, rodar de novo, comparar.
 */
import { createInitialGameState, getNextPlayer, PlayerId, TeamId } from '../game/engine';
import { botTurn } from '../game/headlessEngine';
import { checkCanasta } from '../game/rules';

const N = process.env.N ? parseInt(process.env.N, 10) : 3000;

let baterRounds = 0;
let cleanCan = 0, dirtyCan = 0;
let strandedWilds = 0;       // coringas (2/joker) na mão ao fim
let meldedPoints = 0;
let rounds = 0;
let pileTakes = 0, turns = 0; // taxa de pegar-lixo (sinal de over-refusal do veto)

const pts = (v: number, isJoker: boolean, suit: string) =>
  suit === 'joker' ? 20 : isJoker ? 10 : v === 14 ? 15 : v >= 8 ? 10 : 5;

for (let i = 0; i < N; i++) {
  const s = createInitialGameState(100000, 'classic', 'hard'); // target alto → 1 rodada
  let safety = 0;
  while (!s.roundOver && safety < 400) {
    safety++;
    const before = s.currentTurnPlayerId;
    const pileLenBefore = s.pile.length;
    botTurn(s, s.currentTurnPlayerId);
    turns++;
    // compra-do-monte cresce o lixo em +1 (descarte); pegar-lixo zera e +1 descarte
    // → após o turno o lixo é MENOR que before+1 ⟺ pegou o lixo.
    if (!s.roundOver && s.pile.length < pileLenBefore + 1) pileTakes++;
    if (s.currentTurnPlayerId === before && !s.roundOver) {
      s.currentTurnPlayerId = getNextPlayer(before);
      s.turnPhase = 'draw';
      s.mustPlayPileTopId = null;
    }
  }
  rounds++;
  const wentOut = s.players.some(p => p.hand.length === 0);
  if (wentOut) baterRounds++;
  for (const t of ['team-1', 'team-2'] as TeamId[]) {
    for (const g of s.teams[t].games) {
      const ct = checkCanasta(g);
      if (ct === 'clean') cleanCan++;
      else if (ct === 'dirty') dirtyCan++;
      for (const c of g) meldedPoints += pts(c.value, c.isJoker, c.suit);
    }
  }
  for (const p of s.players) strandedWilds += p.hand.filter(c => c.isJoker).length;
}

const f = (x: number) => (x / rounds).toFixed(3);
console.log(`N=${rounds} rodadas (headlessEngine, clássico, 4× hard)`);
console.log(`bater%              : ${(100 * baterRounds / rounds).toFixed(1)}%`);
console.log(`canastras limpas/rod: ${f(cleanCan)}`);
console.log(`canastras sujas/rod : ${f(dirtyCan)}`);
console.log(`coringas encalhados : ${f(strandedWilds)}  (menor = melhor)`);
console.log(`pontos baixados/rod : ${(meldedPoints / rounds).toFixed(0)}`);
console.log(`pile-take rate      : ${(100 * pileTakes / turns).toFixed(1)}%  (queda forte = over-refusal)`);

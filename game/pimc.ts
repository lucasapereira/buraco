/**
 * pimc.ts — PIMC de PRODUÇÃO (tier de dificuldade "Difícil").
 *
 * Decisão de pegar-lixo por busca: amostra D estados escondidos consistentes
 * com o que o bot sabe (determinização), simula as 2 ações (pega / compra)
 * `depth` plies à frente com a política heurística de produção
 * (game/headlessEngine), avalia o horizonte e escolhe a de maior valor médio.
 *
 * Validado no harness (scripts/botSim): +39pp simétrico vs heurística.
 * Async + fatiado pra NÃO travar a UI; motor de rollout auditado vs gameStore.
 */
import { Card, generateDeck, shuffle } from './deck';
import { GameState, PlayerId, TeamId } from './engine';
import { checkCanasta } from './rules';
import { getCardPoints, canastaBonusValue } from './botHelpers';
import { botTurn } from './headlessEngine';

// ── fastClone: copia TODA a estrutura de containers, COMPARTILHA os Card
//    (imutáveis — o motor só os MOVE entre arrays, nunca muta um Card).
//    ~5-10× mais barato que JSON.parse(JSON.stringify) — o gargalo real
//    on-device (60+ clones/decisão). NÃO é shallow (armadilha): cada array
//    aninhado é recriado, só as folhas Card são partilhadas.
export function fastClone(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map(p => ({ ...p, hand: p.hand.slice() })),
    teams: {
      'team-1': { ...s.teams['team-1'], games: s.teams['team-1'].games.map(g => g.slice()) },
      'team-2': { ...s.teams['team-2'], games: s.teams['team-2'].games.map(g => g.slice()) },
    },
    deck: s.deck.slice(),
    pile: s.pile.slice(),
    deads: s.deads.map(d => d.slice()),
    discardedCardHistory: s.discardedCardHistory.slice(),
    gameLog: s.gameLog.slice(),
    turnHistory: s.turnHistory ? s.turnHistory.slice() : [],
    matchScores: { ...s.matchScores },
  };
}

/** Valor da posição p/ `myTeam` num estado de meio-de-jogo. Espelha o scoring
 *  real: pts melded + bônus de canastra − pts na mão − 100 se sem morto. */
export function horizonEval(state: GameState, myTeam: TeamId): number {
  const oppTeam: TeamId = myTeam === 'team-1' ? 'team-2' : 'team-1';
  const pseudo = (t: TeamId): number => {
    const team = state.teams[t];
    let v = 0;
    for (const g of team.games) {
      for (const c of g) v += getCardPoints(c);
      v += canastaBonusValue(g);
    }
    v -= state.players.filter(p => p.teamId === t)
      .reduce((a, p) => a + p.hand.reduce((x, c) => x + getCardPoints(c), 0), 0);
    if (!team.hasGottenDead) v -= 100;
    return v;
  };
  return pseudo(myTeam) - pseudo(oppTeam);
}

/** Amostra um GameState consistente com o que `selfId` sabe (mão própria,
 *  melds, lixo); reamostra mãos dos outros 3 + 2 mortos + baralho por tamanho
 *  (v1 uniforme — ignora soft-constraints; strategy fusion é fraqueza conhecida
 *  do PIMC, medir baseline antes de refinar). */
export function determinize(real: GameState, selfId: PlayerId): GameState {
  const s = fastClone(real);
  const allCards = generateDeck(real.gameMode === 'classic');
  const known = new Set<string>();
  for (const c of s.players.find(p => p.id === selfId)!.hand) known.add(c.id);
  for (const t of ['team-1', 'team-2'] as TeamId[]) {
    for (const g of s.teams[t].games) for (const c of g) known.add(c.id);
  }
  for (const c of s.pile) known.add(c.id);
  const pool = shuffle(allCards.filter(c => !known.has(c.id)));
  let k = 0;
  for (const p of s.players) {
    if (p.id === selfId) continue;
    const n = p.hand.length;
    p.hand = pool.slice(k, k + n);
    k += n;
  }
  s.deads = real.deads.map(d => { const sl = pool.slice(k, k + d.length); k += d.length; return sl; });
  s.deck = pool.slice(k);
  return s;
}

/** Avalia 1 determinização: roda as 2 ações `depth` plies e devolve os valores
 *  de horizonte. Núcleo compartilhado por pimcShouldTakePile (async/produção) e
 *  pimcDecideSync (harness A/B) — garante que os 2 caminhos são idênticos. */
function scoreDeterminization(
  real: GameState, selfId: PlayerId, myTeam: TeamId, depth: number
): { take: number; deck: number } {
  const det = determinize(real, selfId); // mesmo hidden state p/ as 2 ações
  const out = { take: 0, deck: 0 };
  for (const action of [true, false]) {
    const c = fastClone(det);
    let plies = 0;
    botTurn(c, selfId, action); // 1ª ação forçada
    plies++;
    while (!c.roundOver && plies < depth) {
      const before = c.currentTurnPlayerId;
      botTurn(c, c.currentTurnPlayerId);
      plies++;
      if (c.currentTurnPlayerId === before && !c.roundOver) break;
    }
    const v = horizonEval(c, myTeam);
    if (action) out.take = v; else out.deck = v;
  }
  return out;
}

/** Versão SÍNCRONA (sem yield/deadline) — usada pelo harness pra A/B do
 *  re-port contra o +39pp. Produção usa a async fatiada abaixo. */
export function pimcDecideSync(
  real: GameState, selfId: PlayerId,
  opts: { determinizations?: number; depth?: number } = {}
): boolean {
  const D = opts.determinizations ?? 30;
  const DEPTH = opts.depth ?? 8;
  const myTeam = real.players.find(p => p.id === selfId)!.teamId;
  let sumTake = 0, sumDeck = 0;
  for (let d = 0; d < D; d++) {
    const r = scoreDeterminization(real, selfId, myTeam, DEPTH);
    sumTake += r.take; sumDeck += r.deck;
  }
  return sumTake >= sumDeck;
}

export interface PimcOpts {
  determinizations?: number;
  depth?: number;
  deadlineMs?: number;
  /** chama o yield (cede o frame) a cada ~yieldEveryMs de trabalho síncrono */
  yieldEveryMs?: number;
  /** primitiva de yield fornecida pelo caller (RN: InteractionManager/rAF) */
  onYield?: () => Promise<void>;
}

/**
 * Decisão PIMC de pegar-lixo. ASYNC e fatiada: cede o frame periodicamente pra
 * não congelar a UI. Anytime — se estourar o deadline usa o que já computou.
 * Retorna true = pegar lixo.
 */
export async function pimcShouldTakePile(
  real: GameState,
  selfId: PlayerId,
  opts: PimcOpts = {}
): Promise<boolean> {
  const D = opts.determinizations ?? 30;
  const DEPTH = opts.depth ?? 8;
  const deadline = Date.now() + (opts.deadlineMs ?? 1200);
  const yieldEvery = opts.yieldEveryMs ?? 50;
  const doYield = opts.onYield ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  const myTeam = real.players.find(p => p.id === selfId)!.teamId;

  let sumTake = 0;
  let sumDeck = 0;
  let done = 0;
  let lastYield = Date.now();

  for (let d = 0; d < D; d++) {
    const r = scoreDeterminization(real, selfId, myTeam, DEPTH);
    sumTake += r.take; sumDeck += r.deck;
    done++;
    if (Date.now() - lastYield >= yieldEvery) { await doYield(); lastYield = Date.now(); }
    if (Date.now() >= deadline) break; // anytime: usa o que completou
  }
  return done === 0 ? false : sumTake >= sumDeck;
}

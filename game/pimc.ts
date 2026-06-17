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
import { GameState, PlayerId, TeamId, getNextPlayer } from './engine';
import { checkCanasta } from './rules';
import { getCardPoints, canastaBonusValue, opponentDangerScore, canTeamBater } from './botHelpers';
import { botTurn, discard, endRound, playerOf, teamOf, addToGamesPhase, playSequencesPhase, applyMeldPlan, MeldPlan } from './headlessEngine';

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
    recentDiscardsByPlayer: s.recentDiscardsByPlayer ? {
      'user': s.recentDiscardsByPlayer['user'].slice(),
      'bot-1': s.recentDiscardsByPlayer['bot-1'].slice(),
      'bot-2': s.recentDiscardsByPlayer['bot-2'].slice(),
      'bot-3': s.recentDiscardsByPlayer['bot-3'].slice(),
    } : undefined,
    gameLog: s.gameLog.slice(),
    turnHistory: s.turnHistory ? s.turnHistory.slice() : [],
    matchScores: { ...s.matchScores },
  };
}

/** Crédito de PROGRESSO rumo à canastra limpa OBRIGATÓRIA (clássico). Sem ela
 *  o time não bate, mas o rollout truncado (8 plies) raramente alcança a batida
 *  — o eval material puro é cego a isso e troca a via limpa por pontos (report:
 *  bot não suja a canastra limpa que tem, mas fica sem condições de FAZER uma;
 *  pega lixo com topo-coringa e queima o coringa em meld suja). Espelha o
 *  cleanCanastaProximityBonus do evaluateHandPotential (+7.4pp validado):
 *  candidata limpa de 6 cartas → +90, de 5 → +45; zera quando o time já tem a
 *  canastra limpa (daí o gradiente vem do próprio canastaBonusValue). */
function cleanPathProximity(games: Card[][]): number {
  let best = 0;
  for (const g of games) {
    if (checkCanasta(g) === 'clean') return 0; // requisito já cumprido
    if (g.length >= 7 || g.some(c => c.isJoker)) continue;
    if (g.length === 6) best = Math.max(best, 90);
    else if (g.length === 5) best = Math.max(best, 45);
  }
  return best;
}

/** Valor da posição p/ `myTeam` num estado de meio-de-jogo. Espelha o scoring
 *  real: pts melded + bônus de canastra − pts na mão − 100 se sem morto.
 *  `cleanEval` liga o crédito de proximidade de canastra limpa (clássico). */
export function horizonEval(state: GameState, myTeam: TeamId, cleanEval: boolean = true): number {
  const oppTeam: TeamId = myTeam === 'team-1' ? 'team-2' : 'team-1';
  const pseudo = (t: TeamId): number => {
    const team = state.teams[t];
    let v = 0;
    for (const g of team.games) {
      for (const c of g) v += getCardPoints(c);
      v += canastaBonusValue(g);
    }
    if (cleanEval && state.gameMode === 'classic') v += cleanPathProximity(team.games);
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
export function determinize(real: GameState, selfId: PlayerId, infer: boolean = false): GameState {
  const s = fastClone(real);
  const allCards = generateDeck(real.gameMode === 'classic');
  const known = new Set<string>();
  for (const c of s.players.find(p => p.id === selfId)!.hand) known.add(c.id);
  for (const t of ['team-1', 'team-2'] as TeamId[]) {
    for (const g of s.teams[t].games) for (const c of g) known.add(c.id);
  }
  for (const c of s.pile) known.add(c.id);
  const pool = shuffle(allCards.filter(c => !known.has(c.id)));

  const rd = real.recentDiscardsByPlayer;
  if (!infer || !rd) {
    // v1 UNIFORME: partição por tamanho de mão, sem usar pistas.
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

  // INFERÊNCIA (soft constraints): enviesa as mãos dos OUTROS jogadores pra LONGE
  // das cartas que conflitam com seus descartes recentes — quem jogou 7♠ dificil-
  // mente segura 5–9♠ adjacentes ou outro 7 (teria guardado pra construir). As
  // cartas "rejeitadas" sobram pro deck/mortos (que ninguém recusou). Atribuição
  // gulosa: cada jogador pega 1º as não-conflitantes do pool (já embaralhado, então
  // a escolha dentro de cada grupo é aleatória). Cancela viés de assento (vale p/
  // parceiro e oponentes igualmente — é modelagem correta, não favorecimento).
  const conflictsWith = (c: Card, pid: PlayerId): boolean => {
    if (c.isJoker) return false; // coringa nunca é descarte previsível
    const discs = rd[pid] ?? [];
    for (const id of discs) {
      const parts = id.split('-'); // "${deck}-${suit}-${value}"
      const dVal = parseInt(parts[parts.length - 1], 10);
      if (c.value === dVal) return true;                          // mesmo valor (par/trinca)
      if (c.suit === parts[1] && Math.abs(c.value - dVal) <= 2) return true; // vizinho de seq
    }
    return false;
  };
  let remaining = pool;
  for (const p of s.players) {
    if (p.id === selfId) continue;
    const n = p.hand.length;
    const nonConf: Card[] = [], conf: Card[] = [];
    for (const c of remaining) (conflictsWith(c, p.id) ? conf : nonConf).push(c);
    const take = nonConf.slice(0, n);
    if (take.length < n) take.push(...conf.slice(0, n - take.length));
    const takenIds = new Set(take.map(c => c.id));
    p.hand = take;
    remaining = remaining.filter(c => !takenIds.has(c.id));
  }
  s.deads = real.deads.map(d => { const sl = remaining.slice(0, d.length); remaining = remaining.slice(d.length); return sl; });
  s.deck = remaining;
  return s;
}

/** Avalia 1 determinização: roda as 2 ações `depth` plies e devolve os valores
 *  de horizonte. Núcleo compartilhado por pimcShouldTakePile (async/produção) e
 *  pimcDecideSync (harness A/B) — garante que os 2 caminhos são idênticos. */
function scoreDeterminization(
  real: GameState, selfId: PlayerId, myTeam: TeamId, depth: number, cleanEval: boolean, infer: boolean
): { take: number; deck: number } {
  const det = determinize(real, selfId, infer); // mesmo hidden state p/ as 2 ações
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
    const v = horizonEval(c, myTeam, cleanEval);
    if (action) out.take = v; else out.deck = v;
  }
  return out;
}

/** Versão SÍNCRONA (sem yield/deadline) — usada pelo harness pra A/B do
 *  re-port contra o +39pp. Produção usa a async fatiada abaixo. */
export function pimcDecideSync(
  real: GameState, selfId: PlayerId,
  opts: { determinizations?: number; depth?: number; cleanEval?: boolean; infer?: boolean } = {}
): boolean {
  const D = opts.determinizations ?? 30;
  const DEPTH = opts.depth ?? 8;
  const cleanEval = opts.cleanEval ?? true;
  const infer = opts.infer ?? false;
  const myTeam = real.players.find(p => p.id === selfId)!.teamId;
  let sumTake = 0, sumDeck = 0;
  for (let d = 0; d < D; d++) {
    const r = scoreDeterminization(real, selfId, myTeam, DEPTH, cleanEval, infer);
    sumTake += r.take; sumDeck += r.deck;
  }
  return sumTake >= sumDeck;
}

/** Peso default da correção de perigo no descarte PIMC (ver dangerPenalties).
 *  Calibrado no harness — ver scripts/botSim.ts swap test. */
export const DEFAULT_DISCARD_DANGER_WEIGHT = 1.0;

export interface PimcOpts {
  determinizations?: number;
  depth?: number;
  deadlineMs?: number;
  /** peso da penalidade de perigo (estende meld visível do oponente) no descarte */
  dangerWeight?: number;
  /** chama o yield (cede o frame) a cada ~yieldEveryMs de trabalho síncrono */
  yieldEveryMs?: number;
  /** primitiva de yield fornecida pelo caller (RN: InteractionManager/rAF) */
  onYield?: () => Promise<void>;
  /** crédito de proximidade de canastra limpa no horizonEval (default ON) */
  cleanEval?: boolean;
  /** escala a penalidade de perigo pela proximidade de bater do oponente
   *  (default ON — validado swap n=300: +4.7pp simétrico) */
  dangerProximity?: boolean;
  /** inferência no determinize: enviesa mãos ocultas pra longe dos conflitos com
   *  descartes recentes do jogador (default OFF até validar no harness) */
  infer?: boolean;
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
  const cleanEval = opts.cleanEval ?? true;
  const infer = opts.infer ?? false;
  const deadline = Date.now() + (opts.deadlineMs ?? 1200);
  const yieldEvery = opts.yieldEveryMs ?? 50;
  const doYield = opts.onYield ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  const myTeam = real.players.find(p => p.id === selfId)!.teamId;

  let sumTake = 0;
  let sumDeck = 0;
  let done = 0;
  let lastYield = Date.now();

  for (let d = 0; d < D; d++) {
    const r = scoreDeterminization(real, selfId, myTeam, DEPTH, cleanEval, infer);
    sumTake += r.take; sumDeck += r.deck;
    done++;
    if (Date.now() - lastYield >= yieldEvery) { await doYield(); lastYield = Date.now(); }
    if (Date.now() >= deadline) break; // anytime: usa o que completou
  }
  return done === 0 ? false : sumTake >= sumDeck;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIMC TIMING DE MELD (Stage 4) — decisão binária "baixo agora vs seguro este
// turno". A fase de meld era a última grande decisão 100% heurística (a
// heurística SEMPRE baixa o que pode, sujeito às regras de disciplina). Baixar
// cedo revela informação e alimenta jogos que o oponente estende; segurar
// acumula dívida de pontos na mão e atrasa canastra/morto. O timing certo é
// exatamente o tipo de plano multi-turno que o rollout enxerga e a heurística
// não. Mesma estrutura do pile-take: 2 ações × D determinizações × depth plies.
// "hold" vale só para ESTE turno (a política de rollout volta a baixar
// normalmente nos turnos seguintes) e NUNCA pula a obrigação do lixo (regra).
// ─────────────────────────────────────────────────────────────────────────────

/** true se as fases de meld da política mudariam a mão AGORA (senão segurar ==
 *  baixar e a busca é desperdício — pula). Roda as fases num clone. */
export function meldsAvailable(real: GameState, selfId: PlayerId): boolean {
  const c = fastClone(real);
  c.turnPhase = 'play';
  c.mustPlayPileTopId = null;
  const before = playerOf(c, selfId).hand.length;
  addToGamesPhase(c, selfId);
  playSequencesPhase(c, selfId);
  addToGamesPhase(c, selfId);
  return playerOf(c, selfId).hand.length !== before;
}

/** Avalia 1 determinização: roda "baixa" vs "segura" e devolve os valores. */
function scoreHoldDeterminization(
  real: GameState, selfId: PlayerId, myTeam: TeamId, depth: number, cleanEval: boolean, infer: boolean
): { play: number; hold: number } {
  const det = determinize(real, selfId, infer); // mesmo hidden state p/ as 2 ações
  const out = { play: 0, hold: 0 };
  for (const hold of [false, true]) {
    const c = fastClone(det);
    let plies = 0;
    botTurn(c, selfId, undefined, hold); // turnPhase já é 'play' → só meld+descarte
    plies++;
    while (!c.roundOver && plies < depth) {
      const before = c.currentTurnPlayerId;
      botTurn(c, c.currentTurnPlayerId);
      plies++;
      if (c.currentTurnPlayerId === before && !c.roundOver) break;
    }
    const v = horizonEval(c, myTeam, cleanEval);
    if (hold) out.hold = v; else out.play = v;
  }
  return out;
}

/** Versão SÍNCRONA (harness A/B). true = SEGURAR os melds neste turno.
 *  Empate → baixa (comportamento atual). */
export function pimcShouldHoldMeldsSync(
  real: GameState, selfId: PlayerId,
  opts: { determinizations?: number; depth?: number; cleanEval?: boolean; infer?: boolean } = {}
): boolean {
  const D = opts.determinizations ?? 30;
  const DEPTH = opts.depth ?? 8;
  const cleanEval = opts.cleanEval ?? true;
  const infer = opts.infer ?? false;
  const myTeam = real.players.find(p => p.id === selfId)!.teamId;
  let sumPlay = 0, sumHold = 0;
  for (let d = 0; d < D; d++) {
    const r = scoreHoldDeterminization(real, selfId, myTeam, DEPTH, cleanEval, infer);
    sumPlay += r.play; sumHold += r.hold;
  }
  return sumHold > sumPlay;
}

/** Decisão PIMC de timing de meld. ASYNC e fatiada (produção). Anytime.
 *  true = segurar os melds neste turno. */
export async function pimcShouldHoldMelds(
  real: GameState, selfId: PlayerId, opts: PimcOpts = {}
): Promise<boolean> {
  const D = opts.determinizations ?? 30;
  const DEPTH = opts.depth ?? 8;
  const cleanEval = opts.cleanEval ?? true;
  const infer = opts.infer ?? false;
  const deadline = Date.now() + (opts.deadlineMs ?? 1200);
  const yieldEvery = opts.yieldEveryMs ?? 50;
  const doYield = opts.onYield ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  const myTeam = real.players.find(p => p.id === selfId)!.teamId;
  let sumPlay = 0, sumHold = 0, done = 0;
  let lastYield = Date.now();
  for (let d = 0; d < D; d++) {
    const r = scoreHoldDeterminization(real, selfId, myTeam, DEPTH, cleanEval, infer);
    sumPlay += r.play; sumHold += r.hold;
    done++;
    if (Date.now() - lastYield >= yieldEvery) { await doYield(); lastYield = Date.now(); }
    if (Date.now() >= deadline) break; // anytime
  }
  return done === 0 ? false : sumHold > sumPlay;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIMC ESCOLHA DE MELD (Stage 5) — generaliza o meldHold binário pra um MENU de
// planos: além de "baixo tudo" (playAll) vs "seguro tudo" (holdAll), o meio-termo
// "só estendo melds existentes, sem revelar meld nova" (extendOnly). A heurística
// SEMPRE baixa tudo; o plano certo (esconder info, guardar cartas/coringa, ou
// comprometer) é plano multi-turno que o rollout enxerga e a heurística não.
// Mesma estrutura do pile-take/meldHold: N planos × D determinizações × depth
// plies, common random numbers (o MESMO mundo escondido pontua todos os planos).
// ─────────────────────────────────────────────────────────────────────────────

const MELD_PLAN_ORDER: MeldPlan[] = ['playAll', 'extendOnly', 'holdAll'];

/** Assinatura da mão de `selfId` (ids ordenados) — pra deduplicar planos que
 *  produzem o MESMO resultado (ex.: sem meld nova, playAll ≡ extendOnly). */
function handSig(s: GameState, selfId: PlayerId): string {
  return playerOf(s, selfId).hand.map(c => c.id).sort().join(',');
}

/** Planos DISTINTOS disponíveis neste turno (turnPhase 'play', obrigação já
 *  cumprida). Dedup por assinatura da mão resultante, preservando a ordem de
 *  prioridade (playAll > extendOnly > holdAll). ≤1 plano ⇒ nada a decidir. */
export function availableMeldPlans(real: GameState, selfId: PlayerId): MeldPlan[] {
  const seen = new Set<string>();
  const out: MeldPlan[] = [];
  for (const plan of MELD_PLAN_ORDER) {
    const c = fastClone(real);
    c.turnPhase = 'play';
    c.mustPlayPileTopId = null;
    applyMeldPlan(c, selfId, plan);
    const sig = handSig(c, selfId);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(plan);
  }
  return out;
}

/** Pontua TODOS os planos contra UMA determinização (common random numbers). */
function scoreMeldPlanDet(
  real: GameState, selfId: PlayerId, myTeam: TeamId, plans: MeldPlan[],
  depth: number, sums: number[], cleanEval: boolean, infer: boolean
): void {
  const det = determinize(real, selfId, infer); // mesmo hidden state p/ todos os planos
  for (let pi = 0; pi < plans.length; pi++) {
    const c = fastClone(det);
    let plies = 0;
    botTurn(c, selfId, undefined, false, plans[pi]); // turnPhase 'play' → meld(plan)+descarte
    plies++;
    while (!c.roundOver && plies < depth) {
      const before = c.currentTurnPlayerId;
      botTurn(c, c.currentTurnPlayerId);
      plies++;
      if (c.currentTurnPlayerId === before && !c.roundOver) break;
    }
    sums[pi] += horizonEval(c, myTeam, cleanEval);
  }
}

/** Melhor plano por média de rollout. Empate → mais "ativo" (ordem do array =
 *  playAll > extendOnly > holdAll), espelhando o "empate → baixa" do meldHold. */
function bestMeldPlan(plans: MeldPlan[], sums: number[]): MeldPlan {
  let bestIdx = 0, bestScore = -Infinity;
  for (let pi = 0; pi < plans.length; pi++) {
    if (sums[pi] > bestScore) { bestScore = sums[pi]; bestIdx = pi; }
  }
  return plans[bestIdx];
}

/** Versão SÍNCRONA (harness A/B). Retorna o plano de meld a aplicar. */
export function pimcChooseMeldPlanSync(
  real: GameState, selfId: PlayerId,
  opts: { determinizations?: number; depth?: number; cleanEval?: boolean; infer?: boolean } = {}
): MeldPlan {
  const D = opts.determinizations ?? 30;
  const DEPTH = opts.depth ?? 8;
  const cleanEval = opts.cleanEval ?? true;
  const infer = opts.infer ?? false;
  const myTeam = real.players.find(p => p.id === selfId)!.teamId;
  const plans = availableMeldPlans(real, selfId);
  if (plans.length <= 1) return plans[0] ?? 'playAll';
  const sums = new Array(plans.length).fill(0);
  for (let d = 0; d < D; d++) scoreMeldPlanDet(real, selfId, myTeam, plans, DEPTH, sums, cleanEval, infer);
  return bestMeldPlan(plans, sums);
}

/** Decisão PIMC de escolha de meld. ASYNC e fatiada (produção). Anytime. */
export async function pimcChooseMeldPlan(
  real: GameState, selfId: PlayerId, opts: PimcOpts = {}
): Promise<MeldPlan> {
  const D = opts.determinizations ?? 30;
  const DEPTH = opts.depth ?? 8;
  const cleanEval = opts.cleanEval ?? true;
  const infer = opts.infer ?? false;
  const deadline = Date.now() + (opts.deadlineMs ?? 1200);
  const yieldEvery = opts.yieldEveryMs ?? 50;
  const doYield = opts.onYield ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  const myTeam = real.players.find(p => p.id === selfId)!.teamId;
  const plans = availableMeldPlans(real, selfId);
  if (plans.length <= 1) return plans[0] ?? 'playAll';
  const sums = new Array(plans.length).fill(0);
  let done = 0;
  let lastYield = Date.now();
  for (let d = 0; d < D; d++) {
    scoreMeldPlanDet(real, selfId, myTeam, plans, DEPTH, sums, cleanEval, infer);
    done++;
    if (Date.now() - lastYield >= yieldEvery) { await doYield(); lastYield = Date.now(); }
    if (Date.now() >= deadline) break; // anytime
  }
  return done === 0 ? 'playAll' : bestMeldPlan(plans, sums);
}

// ─────────────────────────────────────────────────────────────────────────────
// PIMC DESCARTE (Stage 2) — busca por determinização na decisão de QUAL carta
// descartar. Espelha a estrutura do pile-take: amostra D estados escondidos e,
// pra CADA carta candidata, simula o resto da rodada `depth` plies à frente com
// a política heurística e avalia o horizonte. Common random numbers: o MESMO
// estado escondido pontua todas as candidatas (determinize FORA do loop de
// candidatas) — crítico porque os deltas entre candidatas são pequenos.
//
// Sinal novo vs heurística: o rollout enxerga se o descarte ALIMENTA o lixo do
// próximo oponente (ele pega e ganha → horizonEval cai) e o timing de bater/
// morto, coisas que a heurística (opponentDangerScore + cardUtility) só aproxima.
// ─────────────────────────────────────────────────────────────────────────────

/** Candidatas a descarte: não-coringas distintas por naipe+valor (cartas
 *  idênticas são intercambiáveis). A legalidade (bater ilegal ao zerar mão) é
 *  filtrada na hora pelo retorno de `discard`. */
function discardCandidates(hand: Card[]): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const c of hand) {
    if (c.isJoker) continue;
    const key = `${c.suit}-${c.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Roda o estado `depth` plies à frente com a política heurística e avalia. */
function rolloutFromState(c: GameState, myTeam: TeamId, depth: number, cleanEval: boolean): number {
  let plies = 0;
  while (!c.roundOver && plies < depth) {
    const before = c.currentTurnPlayerId;
    botTurn(c, c.currentTurnPlayerId);
    plies++;
    if (c.currentTurnPlayerId === before && !c.roundOver) break;
  }
  return horizonEval(c, myTeam, cleanEval);
}

/** Pontua TODAS as candidatas contra UMA determinização (common random numbers).
 *  Núcleo compartilhado por pimcChooseDiscardSync (harness) e pimcChooseDiscard
 *  (produção async) — garante que o que medimos é o que enviamos. */
function scoreDiscardDet(
  det: GameState, selfId: PlayerId, myTeam: TeamId, cands: Card[],
  depth: number, sums: number[], valid: number[], cleanEval: boolean
): void {
  for (let ci = 0; ci < cands.length; ci++) {
    const c = fastClone(det);
    const me = playerOf(c, selfId);
    const team = teamOf(c, selfId);
    // Força o descarte da candidata (turnPhase já é 'play' no clone). Se ilegal
    // (zeraria a mão sem poder bater nem pegar morto), pula nesta determinização.
    if (!discard(c, selfId, cands[ci].id)) continue;
    valid[ci]++;
    if (me.hand.length === 0) {
      endRound(c, true, team.id); // bateu
    } else {
      // descarte normal (ou pegou morto, mão=11) → encerra turno, passa a vez
      c.currentTurnPlayerId = getNextPlayer(selfId);
      c.turnPhase = 'draw';
      c.lastDrawnCardId = null;
    }
    sums[ci] += rolloutFromState(c, myTeam, depth, cleanEval);
  }
}

/** Penalidade de PERIGO por candidata, calculada do estado REAL (não
 *  determinizado). `determinize` randomiza as mãos ocultas dos oponentes, então
 *  o rollout é CEGO ao sinal "esse descarte estende uma meld VISÍVEL do
 *  oponente" — o eval material do horizonEval ainda premia despejar a carta de
 *  maior pontos. Reinjetamos aqui a info real que a determinização destrói.
 *  (Confound documentado pelo advisor — sem isso, o PIMC só despeja carta alta.)
 *
 *  `proximity`: escala a penalidade pela PROXIMIDADE DE BATER do oponente —
 *  alimentar o lixo de quem já pode bater com mão curta é muito mais caro que
 *  alimentar quem tem 9 cartas (o danger estático tratava igual). Gated p/ A/B. */
function dangerPenalties(
  real: GameState, selfId: PlayerId, cands: Card[], weight: number, proximity: boolean
): number[] {
  if (weight <= 0) return cands.map(() => 0);
  const myTeam = real.players.find(p => p.id === selfId)!.teamId;
  const oppTeam: TeamId = myTeam === 'team-1' ? 'team-2' : 'team-1';
  const oppGames = real.teams[oppTeam].games;
  let mult = 1.0;
  if (proximity) {
    const oppHands = real.players.filter(p => p.teamId === oppTeam).map(p => p.hand.length);
    const minHand = oppHands.length ? Math.min(...oppHands) : 99;
    const oppCanBater = canTeamBater(oppGames, real.gameMode, real.teams[oppTeam].hasGottenDead);
    if (oppCanBater && minHand <= 3) mult = 2.0;
    else if (oppCanBater && minHand <= 6) mult = 1.5;
  }
  return cands.map(c => weight * mult * opponentDangerScore(c, oppGames, real.gameMode));
}

/** Escolhe a candidata de maior (média de rollout − penalidade de perigo). */
function bestDiscard(cands: Card[], sums: number[], valid: number[], penalty: number[]): string | null {
  let bestIdx = -1, bestScore = -Infinity;
  for (let ci = 0; ci < cands.length; ci++) {
    if (valid[ci] === 0) continue;
    const score = sums[ci] / valid[ci] - penalty[ci];
    if (score > bestScore) { bestScore = score; bestIdx = ci; }
  }
  return bestIdx >= 0 ? cands[bestIdx].id : null;
}

/** Versão SÍNCRONA — usada pelo harness (scripts/botSim) p/ A/B. Retorna o id
 *  da carta a descartar, ou null se não houver candidata (cai na heurística). */
export function pimcChooseDiscardSync(
  real: GameState, selfId: PlayerId,
  opts: { determinizations?: number; depth?: number; dangerWeight?: number; cleanEval?: boolean; dangerProximity?: boolean; infer?: boolean } = {}
): string | null {
  const D = opts.determinizations ?? 20;
  const DEPTH = opts.depth ?? 8;
  const W = opts.dangerWeight ?? DEFAULT_DISCARD_DANGER_WEIGHT;
  const cleanEval = opts.cleanEval ?? true;
  const dangerProx = opts.dangerProximity ?? true;
  const infer = opts.infer ?? false;
  const self = real.players.find(p => p.id === selfId)!;
  const myTeam = self.teamId;
  const cands = discardCandidates(self.hand);
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0].id;
  const sums = new Array(cands.length).fill(0);
  const valid = new Array(cands.length).fill(0);
  for (let d = 0; d < D; d++) {
    const det = determinize(real, selfId, infer);
    scoreDiscardDet(det, selfId, myTeam, cands, DEPTH, sums, valid, cleanEval);
  }
  return bestDiscard(cands, sums, valid, dangerPenalties(real, selfId, cands, W, dangerProx));
}

/** Decisão PIMC de descarte. ASYNC e fatiada (cede o frame) — não trava a UI.
 *  Anytime (deadline). Retorna o id da carta, ou null (→ fallback heurístico). */
export async function pimcChooseDiscard(
  real: GameState, selfId: PlayerId, opts: PimcOpts = {}
): Promise<string | null> {
  const D = opts.determinizations ?? 20;
  const DEPTH = opts.depth ?? 8;
  const W = opts.dangerWeight ?? DEFAULT_DISCARD_DANGER_WEIGHT;
  const cleanEval = opts.cleanEval ?? true;
  const dangerProx = opts.dangerProximity ?? true;
  const infer = opts.infer ?? false;
  const deadline = Date.now() + (opts.deadlineMs ?? 1200);
  const yieldEvery = opts.yieldEveryMs ?? 50;
  const doYield = opts.onYield ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  const self = real.players.find(p => p.id === selfId)!;
  const myTeam = self.teamId;
  const cands = discardCandidates(self.hand);
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0].id;
  const sums = new Array(cands.length).fill(0);
  const valid = new Array(cands.length).fill(0);
  let lastYield = Date.now();
  let done = 0;
  for (let d = 0; d < D; d++) {
    const det = determinize(real, selfId, infer);
    scoreDiscardDet(det, selfId, myTeam, cands, DEPTH, sums, valid, cleanEval);
    done++;
    if (Date.now() - lastYield >= yieldEvery) { await doYield(); lastYield = Date.now(); }
    if (Date.now() >= deadline) break; // anytime
  }
  return done === 0 ? null : bestDiscard(cands, sums, valid, dangerPenalties(real, selfId, cands, W, dangerProx));
}

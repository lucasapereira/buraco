/**
 * pimcBot.ts — Stage 1: PIMC (Perfect Information Monte Carlo) com rollout
 * truncado, SÓ pra decisão de pegar-lixo (binária). Escopo travado com advisor.
 *
 * Por que existe: o GATE do proxy mostrou que o bot de produção está no teto
 * heurístico — mais heurística rende pouco. O gargalo real é falta de
 * planejamento multi-turno. PIMC ataca isso por busca: amostra estados
 * escondidos possíveis (determinização), simula cada um à frente com a política
 * heurística, e escolhe a ação com melhor valor médio.
 *
 * Benchmark (gate): rollout 8-ply ≈ 1270/s no Node → ~159–318/s on-device →
 * ~318+ rollouts no budget de 2s. PIMC take-pile precisa de ~60/decisão.
 * Folga de 6–13×. Viável.
 *
 * Este módulo expõe só funções PURAS (sem motor de turno): a orquestração de
 * rollout vive no botSim, onde runBotTurn está em escopo. Reusa baterDistance
 * do proxyBot.
 */
import { Card, generateDeck, shuffle } from '../game/deck';
import { GameState, PlayerId, TeamId } from '../game/engine';
import { checkCanasta } from '../game/rules';
import { getCardPoints, canastaBonusValue } from '../game/botHelpers';

// ──────────────────────────────────────────────────────────────
// (a) EVAL DE HORIZONTE
// ──────────────────────────────────────────────────────────────
/**
 * Valor da posição para `myTeam` num estado de meio-de-jogo (rollout truncado
 * não chega ao terminal). É o sinal de valor do PIMC — se for fraco, nenhum
 * número de rollouts salva (advisor).
 *
 * Pseudo-score por time, espelhando o scoring real (game/engine):
 *   + pontos das cartas já melded na mesa
 *   + bônus de canastra (limpa/suja/13/14) via canastaBonusValue
 *   − pontos das cartas ainda na mão dos jogadores do time (viram dívida no fim)
 *   − 100 se o time ainda não pegou o morto (penalidade real "morto não coletado")
 * valor = pseudo(me) − pseudo(opp).
 */
export function horizonEval(state: GameState, myTeam: TeamId): number {
  const oppTeam: TeamId = myTeam === 'team-1' ? 'team-2' : 'team-1';

  const pseudo = (t: TeamId): number => {
    const team = state.teams[t];
    let s = 0;
    for (const g of team.games) {
      for (const c of g) s += getCardPoints(c);
      s += canastaBonusValue(g);
    }
    const handPts = state.players
      .filter(p => p.teamId === t)
      .reduce((a, p) => a + p.hand.reduce((x, c) => x + getCardPoints(c), 0), 0);
    s -= handPts;
    if (!team.hasGottenDead) s -= 100;
    return s;
  };

  return pseudo(myTeam) - pseudo(oppTeam);
}

// ──────────────────────────────────────────────────────────────
// (b) DETERMINIZADOR
// ──────────────────────────────────────────────────────────────
/**
 * Amostra um GameState completo consistente com o que `selfId` realmente sabe:
 * sua própria mão, todas as melds na mesa (dos 2 times), o lixo atual.
 * O resto (mãos dos outros 3 jogadores — inclusive o parceiro, que você NÃO vê
 * no Buraco —, os 2 mortos, e a ordem do baralho) é partição uniforme do pool
 * desconhecido, respeitando só os tamanhos atuais (v1: ignora constraints
 * soft, ex. "quem não pegou o lixo provavelmente não tem carta que o torna
 * pegável" — strategy fusion é fraqueza conhecida do PIMC, medir baseline antes).
 *
 * Retorna um clone profundo determinizado (não muta `real`).
 */
export function determinize(real: GameState, selfId: PlayerId): GameState {
  const isClassic = real.gameMode === 'classic';
  const allCards = generateDeck(isClassic);

  // Conjunto conhecido: minha mão + todas as cartas em melds + lixo.
  const knownIds = new Set<string>();
  const selfHand = real.players.find(p => p.id === selfId)!.hand;
  for (const c of selfHand) knownIds.add(c.id);
  for (const t of ['team-1', 'team-2'] as TeamId[]) {
    for (const g of real.teams[t].games) for (const c of g) knownIds.add(c.id);
  }
  for (const c of real.pile) knownIds.add(c.id);

  const pool = shuffle(allCards.filter(c => !knownIds.has(c.id)));

  // Clone profundo do estado (estrutura suficiente p/ runBotTurn).
  const s: GameState = JSON.parse(JSON.stringify(real));

  let k = 0;
  // Mãos dos outros 3 jogadores: mesmo TAMANHO atual, cartas reamostradas.
  for (const p of s.players) {
    if (p.id === selfId) continue;
    const size = p.hand.length;
    p.hand = pool.slice(k, k + size);
    k += size;
  }
  // Mortos: mesmos tamanhos atuais.
  s.deads = real.deads.map(d => {
    const slice = pool.slice(k, k + d.length);
    k += d.length;
    return slice;
  });
  // Resto vira o baralho (ordem aleatória — já embaralhado).
  s.deck = pool.slice(k);
  return s;
}

// ──────────────────────────────────────────────────────────────
// helper p/ validação de eval (passo (a) do advisor)
// ──────────────────────────────────────────────────────────────
export function _evalSelfCheck(): void {
  const mk = (id: string, suit: string, v: number, joker = false): Card =>
    ({ id, suit, value: v, isJoker: joker } as Card);
  const seq = (suit: string, lo: number, hi: number) => {
    const g: Card[] = [];
    for (let v = lo; v <= hi; v++) g.push(mk(`1-${suit}-${v}`, suit, v));
    return g;
  };
  const base = (): GameState => ({
    players: [
      { id: 'user', teamId: 'team-1', name: 'user', hand: [], hasGottenDead: false },
      { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: [], hasGottenDead: false },
      { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: [], hasGottenDead: false },
      { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: [], hasGottenDead: false },
    ],
    teams: {
      'team-1': { id: 'team-1', games: [], score: 0, hasGottenDead: false },
      'team-2': { id: 'team-2', games: [], score: 0, hasGottenDead: false },
    },
    deck: [], pile: [], deads: [[], []], currentTurnPlayerId: 'user',
    turnPhase: 'draw', winnerTeamId: null, roundOver: false, roundStatsRecorded: false,
    targetScore: 1500, matchScores: { 'team-1': 0, 'team-2': 0 }, gameLog: [],
    lastDrawnCardId: null, gameMode: 'classic', botDifficulty: 'hard', discardedCardHistory: [],
    mustPlayPileTopId: null, deckReshuffleCount: 0, turnHistory: [],
    roundNumber: 1, gameId: 'x',
  } as GameState);

  // S1: simétrico vazio → ~0
  const s1 = base();
  // S2: team-1 com canastra limpa (7♥ 4..10) + morto pego → deve ser >> 0
  const s2 = base();
  s2.teams['team-1'].games = [seq('hearts', 4, 10)];
  s2.teams['team-1'].hasGottenDead = true;
  // S3: team-1 segurando 11 cartas altas, team-2 com 2 canastras → deve ser << 0
  const s3 = base();
  s3.teams['team-2'].games = [seq('spades', 3, 9), seq('clubs', 4, 10)];
  s3.teams['team-2'].hasGottenDead = true;
  s3.players[0].hand = Array.from({ length: 11 }, (_, i) => mk(`1-d-${13 + i}`, 'diamonds', 13));

  const e1 = horizonEval(s1, 'team-1');
  const e2 = horizonEval(s2, 'team-1');
  const e3 = horizonEval(s3, 'team-1');
  console.log(`\n─── EVAL self-check (deve: S2 ≫ S1 ≈ 0 ≫ S3) ─────────────`);
  console.log(`S1 simétrico vazio        : ${e1}`);
  console.log(`S2 canastra limpa+morto   : ${e2}   ${e2 > 200 ? 'OK' : 'FALHOU'}`);
  console.log(`S3 mão alta vs 2 canastras: ${e3}   ${e3 < -200 ? 'OK' : 'FALHOU'}`);
}

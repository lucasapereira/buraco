/**
 * proxyBot.ts — adversário-alvo "humano forte" para o harness (scripts/botSim.ts).
 *
 * NÃO é código de produção. Existe só pra dar uma régua: se o bot de produção
 * (heurístico, raso, 1-ply) encostar nesse proxy, isso é sinal de jogo
 * estrategicamente competente — proxy melhor que ser bot-vs-bot-igual, que a
 * memória já registra como métrica que não prevê win rate contra humano.
 *
 * Escopo BOUNDED (revisado com advisor) — exatamente 2 mecanismos:
 *   1. Planner de DISTÂNCIA-DE-BATER: estima quantas "ações de descarte" faltam
 *      pra bater legalmente; recusa pile-take que afasta do bater quando perto,
 *      e escolhe descarte que mais aproxima do bater.
 *   2. Modelo de oponente: reusa chooseBestDiscardSmart (item #1, rejeitado em
 *      produção mas OK aqui — o proxy pode usar o que produção não usa) como
 *      desempate de segurança entre descartes equidistantes do bater.
 *
 * Fora de escopo deliberadamente: bluff/disguise (hard de codificar; o planner
 * de bater cobre a maior parte implicitamente). Interceptar a fase de meld
 * (auto-play) também fica fora — limitação conhecida do proxy.
 *
 * Desacoplado de GameState de propósito: as funções tomam primitivos (hand,
 * teamGames, …) pra serem reaproveitáveis como solver por-determinização no
 * Stage 1 (PIMC).
 */
import { Card } from '../game/deck';
import { GameMode } from '../game/engine';
import { validateSequence, checkCanasta } from '../game/rules';
import { canCleanCandidateGrow, findBestSequences, getCardPoints, canTeamBater } from '../game/botHelpers';

const INF = 99;
/** Detour obrigatório: esvaziar a mão sem ter pego o morto FORÇA pegar 11
 *  cartas — não é bater, é re-inchar. Pesa como um desvio caro. */
const DEAD_DETOUR = 9;
/** Perto-de-bater: a esse ponto, preservar o caminho de saída vale mais que
 *  qualquer ganho de pontos do lixo. */
export const CLOSE_TO_BATER = 3;

function teamHasCleanCanasta(teamGames: Card[][]): boolean {
  return teamGames.some(g => g.length >= 7 && checkCanasta(g) === 'clean');
}

/**
 * Quantas cartas da mão NÃO dão pra escoar imediatamente (nem encaixam num jogo
 * do time, nem entram numa sequência baixável). Cada uma dessas vira ~1 turno de
 * descarte até a mão zerar. Estimativa, não busca.
 */
function unmeldableCount(hand: Card[], teamGames: Card[][], gameMode: GameMode): number {
  const escoavel = new Set<string>();
  for (const g of teamGames) {
    for (const c of hand) {
      if (escoavel.has(c.id)) continue;
      if (validateSequence([...g, c], gameMode)) escoavel.add(c.id);
    }
  }
  const resto = hand.filter(c => !escoavel.has(c.id));
  for (const seq of findBestSequences(resto, gameMode)) {
    for (const c of seq) escoavel.add(c.id);
  }
  return hand.length - escoavel.size;
}

/**
 * Distância heurística até um bater legal (menor = mais perto). Combina:
 *  - cartas inúteis na mão (precisam ser descartadas, ~1/turno)
 *  - se ainda não há canastra limpa (clássico): + cartas que faltam pra fechá-la,
 *    ou INF se nem dá pra fechar (nenhum candidato limpo cresce)
 *  - se o morto ainda não foi pego e há mortos: + DEAD_DETOUR (re-incha antes)
 */
export function baterDistance(
  hand: Card[],
  teamGames: Card[][],
  gameMode: GameMode,
  hasGottenDead: boolean,
  deadsLeft: number
): number {
  let dist = unmeldableCount(hand, teamGames, gameMode);

  if (gameMode === 'classic' && !teamHasCleanCanasta(teamGames)) {
    // Precisa de canastra limpa pra bater. Tem candidato limpo que ainda cresce?
    const candidatos = teamGames.filter(g => g.length < 7 && !g.some(c => c.isJoker));
    const algumCresce = candidatos.some(g => canCleanCandidateGrow(g, teamGames, hand));
    if (!algumCresce) return INF;
    const melhor = candidatos.reduce((m, g) => Math.max(m, g.length), 0);
    dist += Math.max(0, 7 - melhor);
  }

  if (!hasGottenDead && deadsLeft > 0) dist += DEAD_DETOUR;
  return dist;
}

/**
 * Ajuste de pile-take.
 *
 * LIÇÃO DO GATE v1: disciplina de distância NÃO pode valer cedo. Um proxy que
 * recusa lixo "perto de bater" antes de ter canastra limpa vira rush-bot —
 * bate rápido com mão fina/suja e PERDE nos pontos (medido: −15pp vs produção,
 * clean canastras 0.60 vs 0.88). Jogador forte CONSTRÓI primeiro; só fecha com
 * disciplina DEPOIS que já pode bater (canastra limpa + morto resolvido).
 *
 * Então: enquanto o time NÃO pode bater → deixa a heurística de valor mandar
 * (constrói). Quando JÁ pode bater → não incha: recusa lixo que afasta a saída.
 */
export function proxyAdjustTakePile(
  baseDecision: boolean,
  pile: Card[],
  hand: Card[],
  teamGames: Card[][],
  gameMode: GameMode,
  hasGottenDead: boolean,
  deadsLeft: number
): boolean {
  if (!baseDecision) return false; // nunca força pegar onde o smart já não pega
  // Fase de construção: ainda não dá pra bater → pega valor normalmente.
  if (!canTeamBater(teamGames, gameMode, hasGottenDead)) return baseDecision;

  // Fase de fechamento: já pode bater. Não inche a mão sem necessidade.
  const dNow = baterDistance(hand, teamGames, gameMode, hasGottenDead, deadsLeft);
  if (dNow > CLOSE_TO_BATER) return baseDecision; // ainda longe → valor ajuda
  const dWith = baterDistance([...hand, ...pile], teamGames, gameMode, hasGottenDead, deadsLeft);
  return dWith <= dNow; // só pega se NÃO atrasar a saída
}

/**
 * Escolhe descarte.
 *
 * Fase de construção (não pode bater ainda): usa o modelo de oponente
 * (smartCard) — segurança/utilidade importam, rush não. Fase de fechamento (já
 * pode bater): prioriza aproximar do bater, com o modelo de oponente como
 * desempate entre cartas equidistantes da saída.
 */
export function proxyChooseDiscard(
  candidates: Card[],
  smartCard: Card,
  hand: Card[],
  teamGames: Card[][],
  gameMode: GameMode,
  hasGottenDead: boolean,
  deadsLeft: number
): Card {
  if (candidates.length === 0) return smartCard;
  if (!canTeamBater(teamGames, gameMode, hasGottenDead)) return smartCard;

  const dist = (descartada: Card) =>
    baterDistance(
      hand.filter(c => c.id !== descartada.id),
      teamGames, gameMode, hasGottenDead, deadsLeft
    );

  let melhor = candidates[0];
  let melhorD = dist(melhor);
  for (const c of candidates.slice(1)) {
    const d = dist(c);
    if (d < melhorD) { melhor = c; melhorD = d; }
  }

  // Desempate de segurança: se o modelo de oponente quer uma carta que também
  // está no mínimo de distância, ela é o melhor dos dois mundos.
  if (candidates.some(c => c.id === smartCard.id) && dist(smartCard) === melhorD) {
    return smartCard;
  }
  // Senão, entre as equidistantes mínimas, a de menor valor de carta.
  const empatadas = candidates.filter(c => dist(c) === melhorD);
  return empatadas.reduce((a, b) => (getCardPoints(a) <= getCardPoints(b) ? a : b));
}

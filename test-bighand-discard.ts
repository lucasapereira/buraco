/**
 * test-bighand-discard.ts — report: bot pegou lixo de ~25 cartas e LOGO descartou
 * uma carta que servia numa meld do time. Com mão grande, strand/proteção-pra-bater
 * NÃO se aplica. Suspeita do usuário: a meld-alvo já tinha coringa.
 *
 * Força pile-take sempre (gera mãos grandes) e, em CADA descarte com mão > 7,
 * detecta se a carta descartada ENCAIXA (validateSequence) em alguma meld do time
 * e classifica POR QUE não foi meldada (replica os guards do addToGamesPhase):
 *   - LOCK_WILD     : wouldLockRedeemableWild (meld = canastra suja regatável)
 *   - CLEAN_PROTECT : adicionar degradaria canastra limpa
 *   - OTHER         : encaixaria sem guard (bug de fluxo) — não deveria acontecer
 * Reporta também se a meld-alvo tinha coringa, e a util do descarte vs a min da mão.
 *
 * Run: npx tsx test-bighand-discard.ts
 */
let _seed = 0x9e3779b9;
function mulberry32() {
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = mulberry32;

import { Card, generateDeck, shuffle } from './game/deck';
import { GameState, Player, TeamState, TeamId, PlayerId, getNextPlayer, TURN_ORDER } from './game/engine';
import { canTakePile, validateSequence, checkCanasta, sortCardsBySuitAndValue } from './game/rules';
import {
  chooseBestDiscard, opponentRecentlyTookPile, wouldLockRedeemableWild, wouldDirtyGame,
  canCleanCandidateGrow, cardUtility,
} from './game/botHelpers';
import {
  drawFromDeck, drawFromPile, playWithPileTop, applyMeldPlan, discard,
  checkBater, endRound, playerOf, teamOf,
} from './game/headlessEngine';

function freshState(seedTag: number): GameState {
  const allCards = shuffle(generateDeck());
  const deads: Card[][] = [allCards.splice(0, 11), allCards.splice(0, 11)];
  const players: Player[] = [
    { id: 'user',  teamId: 'team-1', name: 'user',  hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
  ];
  const teams: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: [], score: 0, hasGottenDead: false },
    'team-2': { id: 'team-2', games: [], score: 0, hasGottenDead: false },
  };
  return {
    players, teams, deck: allCards, pile: [allCards.pop()!], deads,
    currentTurnPlayerId: TURN_ORDER[seedTag % 4], turnPhase: 'draw',
    winnerTeamId: null, roundOver: false, roundStatsRecorded: false,
    targetScore: 3000, matchScores: { 'team-1': 0, 'team-2': 0 }, gameLog: [],
    lastDrawnCardId: null, gameMode: 'classic', botDifficulty: 'hard',
    discardedCardHistory: [], mustPlayPileTopId: null, pileTakenBuriedIds: [],
    deckReshuffleCount: 0, turnHistory: [], roundNumber: 1, gameId: 'sim' + seedTag,
  } as GameState;
}

// Por que a carta encaixante (validateSequence) não foi meldada? Replica os guards
// do addToGamesPhase pra o par (card, meld). hand>2 garantido (mão grande).
function reason(card: Card, g: Card[], mode: GameState['gameMode']): string {
  if (!validateSequence([...g, card], mode)) return 'NO_FIT';
  if (card.isJoker) {
    if (wouldDirtyGame(card, g)) return 'JOKER_DISCIPLINE'; // (raro com validateSequence true)
    return 'OTHER_JOKER';
  }
  if (wouldLockRedeemableWild(g, card, mode)) return 'LOCK_WILD';
  if (checkCanasta(g) === 'clean' && checkCanasta([...g, card]) !== 'clean') return 'CLEAN_PROTECT';
  return 'OTHER';
}

const reasonCount: Record<string, number> = {};
let bigHandFitDiscards = 0;
let targetHadJoker = 0;
const samples: string[] = [];

function turn(s: GameState, pid: PlayerId): void {
  if (s.turnPhase === 'draw') {
    // Deixa o lixo CRESCER: só pega quando já está grande (≥12) — reproduz a
    // pegada gigante do report (e mão > 20 logo depois).
    const canTake = s.pile.length >= 12 && canTakePile(playerOf(s, pid).hand, s.pile, teamOf(s, pid).games, s.gameMode);
    if (canTake) { if (!drawFromPile(s, pid)) { if (!drawFromDeck(s, pid)) return; } }
    else { if (!drawFromDeck(s, pid)) return; }
  }
  if (s.roundOver) return;
  if (s.mustPlayPileTopId) playWithPileTop(s, pid, s.mustPlayPileTopId);
  applyMeldPlan(s, pid, 'playAll');
  if (checkBater(s, pid)) return;

  const p = playerOf(s, pid);
  const team = teamOf(s, pid);
  if (p.hand.length > 0) {
    const oppTeamId: TeamId = team.id === 'team-1' ? 'team-2' : 'team-1';
    const oppGames = s.teams[oppTeamId].games;
    const oppIds = s.players.filter(pl => pl.teamId === oppTeamId).map(pl => pl.id);
    const tookPile = opponentRecentlyTookPile(s.gameLog as any, oppIds);
    const card = chooseBestDiscard(p.hand, s.discardedCardHistory, 'hard', s.lastDrawnCardId, s.gameMode, team.games, null, oppGames, tookPile);

    // CONDIÇÃO DO REPORT: mão grande (>7, sem strand) e o descarte ENCAIXA numa meld.
    if (p.hand.length > 7) {
      const fitting = team.games.filter(g => validateSequence([...g, card], s.gameMode));
      if (fitting.length > 0) {
        bigHandFitDiscards++;
        // melhor (menos-pior) razão entre as melds que ele encaixa
        const reasons = fitting.map(g => reason(card, g, s.gameMode));
        // prioridade de "explicação": LOCK_WILD > CLEAN_PROTECT > OTHER
        const r = reasons.includes('LOCK_WILD') ? 'LOCK_WILD'
          : reasons.includes('CLEAN_PROTECT') ? 'CLEAN_PROTECT'
          : reasons.includes('OTHER') ? 'OTHER' : reasons[0];
        reasonCount[r] = (reasonCount[r] ?? 0) + 1;
        if (fitting.some(g => g.some(c => c.isJoker))) targetHadJoker++;
        if (samples.length < 12) {
          const minUtil = Math.min(...p.hand.map(c => cardUtility(c, p.hand, s.gameMode, team.games)));
          const cu = cardUtility(card, p.hand, s.gameMode, team.games);
          const g = fitting.find(x => reason(card, x, s.gameMode) === r) ?? fitting[0];
          samples.push(`[${r}] hand=${p.hand.length} descartou=${card.id} (util=${cu.toFixed(0)}, minMão=${minUtil.toFixed(0)})\n      meld-alvo=${g.map(c => c.id).join('-')} (canastra=${checkCanasta(g)})`);
        }
      }
    }

    if (!discard(s, pid, card.id)) { for (const c of p.hand) if (discard(s, pid, c.id)) break; }
  }
  if (playerOf(s, pid).hand.length === 0) { endRound(s, true, team.id); return; }
  s.currentTurnPlayerId = getNextPlayer(pid);
  s.turnPhase = 'draw';
  s.lastDrawnCardId = null;
}

const GAMES = 4000;
for (let g = 0; g < GAMES; g++) {
  const s = freshState(g);
  let safety = 0;
  while (!s.roundOver && safety < 500) {
    safety++;
    const before = s.currentTurnPlayerId;
    turn(s, before);
    if (s.currentTurnPlayerId === before && !s.roundOver) {
      s.currentTurnPlayerId = getNextPlayer(before); s.turnPhase = 'draw'; s.mustPlayPileTopId = null; s.pileTakenBuriedIds = [];
    }
  }
}

console.log(`\nForça pile-take, ${GAMES} rodadas.\n`);
console.log(`Descartes de carta-que-encaixa em meld do time, com mão > 7 (sem strand): ${bigHandFitDiscards}`);
console.log(`  desses, a meld-alvo tinha coringa: ${targetHadJoker}`);
console.log(`\nPor que a carta encaixante não foi meldada:`);
Object.entries(reasonCount).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log(`  ${r}: ${n}`));
if (samples.length) {
  console.log('\nAmostras (carta que encaixa, descartada de mão grande):');
  samples.forEach((d, i) => console.log(`  ${i}: ${d}`));
}

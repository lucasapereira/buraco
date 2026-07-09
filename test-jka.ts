/**
 * test-jka.ts — report: meld do time = [coringão, K, A] (3 cartas, coringa físico
 * fazendo a Q), bot acabou de pegar o morto, tinha a Q natural e DESCARTOU a Q
 * em vez de adicioná-la ao jogo. Reproduz o estado exato e checa addToGamesPhase +
 * o descarte.
 *
 * Run: npx tsx test-jka.ts
 */
import { Card } from './game/deck';
import { GameState, Player, TeamState, TeamId } from './game/engine';
import { validateSequence, checkCanasta } from './game/rules';
import { chooseBestDiscard, wouldLockRedeemableWild, isRedeemableDirty, cardUtility } from './game/botHelpers';
import { addToGamesPhase, playerOf, teamOf, addToExistingGame, discard } from './game/headlessEngine';

const C = (deck: number, suit: Card['suit'], value: number, isJoker = false): Card =>
  ({ id: `${deck}-${suit}-${value}`, deck: deck as Card['deck'], suit, value: value as Card['value'], isJoker });
const JOKER = (deck: number): Card => ({ id: `${deck}-joker-0`, deck: deck as Card['deck'], suit: 'joker', value: 0 as Card['value'], isJoker: true });

const Qs = C(1, 'spades', 12);   // Q♠ natural
const Ks = C(1, 'spades', 13);   // K♠
const As = C(1, 'spades', 14);   // A♠
const jk = JOKER(1);             // coringão físico

// meld = [coringa, K, A] (físico faz a Q): sequência Q*,K,A
const meld = [jk, Ks, As];
console.log('meld =', meld.map(c => c.id).join(','));
console.log('  validateSequence(meld) =', validateSequence(meld, 'classic'));
console.log('  checkCanasta(meld) =', checkCanasta(meld), '(3 cartas → não-canastra)');
console.log('  validateSequence(meld + Q♠) =', validateSequence([...meld, Qs], 'classic'));
console.log('  isRedeemableDirty(meld) =', isRedeemableDirty(meld), '(precisa ser canastra 7+ p/ true)');
console.log('  wouldLockRedeemableWild(meld, Q♠) =', wouldLockRedeemableWild(meld, Qs, 'classic'));
console.log('  checkCanasta(meld+Q) =', checkCanasta([...meld, Qs]));

// Estado: bot-2 (time-1) acabou de pegar o morto → mão grande com a Q dentro.
const botHand = [Qs, C(1, 'hearts', 5), C(1, 'clubs', 9), C(2, 'diamonds', 4), C(1, 'clubs', 6), C(2, 'hearts', 8), C(1, 'spades', 7), C(2, 'clubs', 11), C(1, 'diamonds', 9), C(2, 'spades', 3), C(1, 'hearts', 13)];
const players: Player[] = [
  { id: 'user',  teamId: 'team-1', name: 'user',  hand: [], hasGottenDead: true },
  { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: [], hasGottenDead: true },
  { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: [...botHand], hasGottenDead: true },
  { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: [], hasGottenDead: true },
];
const teams: Record<TeamId, TeamState> = {
  'team-1': { id: 'team-1', games: [[...meld]], score: 0, hasGottenDead: true },
  'team-2': { id: 'team-2', games: [], score: 0, hasGottenDead: true },
};
const s = {
  players, teams, deck: new Array(20).fill(0).map((_, i) => C(1, 'clubs', 2)), pile: [], deads: [],
  currentTurnPlayerId: 'bot-2', turnPhase: 'play', winnerTeamId: null, roundOver: false,
  roundStatsRecorded: false, targetScore: 3000, matchScores: { 'team-1': 0, 'team-2': 0 }, gameLog: [],
  lastDrawnCardId: null, gameMode: 'classic', botDifficulty: 'hard', discardedCardHistory: [],
  mustPlayPileTopId: null, pileTakenBuriedIds: [], deckReshuffleCount: 0, turnHistory: [], roundNumber: 1, gameId: 'jka',
} as unknown as GameState;

console.log('\n--- antes do addToGamesPhase ---');
console.log('mão bot-2:', playerOf(s, 'bot-2').hand.map(c => c.id).join(','));
console.log('Q♠ na mão?', playerOf(s, 'bot-2').hand.some(c => c.id === Qs.id));

addToGamesPhase(s, 'bot-2');

console.log('\n--- depois do addToGamesPhase ---');
console.log('meld do time:', teamOf(s, 'bot-2').games[0].map(c => c.id).join(','));
console.log('Q♠ ainda na mão?', playerOf(s, 'bot-2').hand.some(c => c.id === Qs.id));
const added = teamOf(s, 'bot-2').games[0].some(c => c.id === Qs.id);
console.log(added ? '✅ Q♠ foi ADICIONADA ao jogo' : '❌ Q♠ NÃO foi adicionada (ficou na mão → seria descartável)');

// E o que o chooseBestDiscard faria com a mão original?
const disc = chooseBestDiscard([...botHand], [], 'hard', null, 'classic', [[...meld]], null, [], false);
console.log('\nchooseBestDiscard escolheria descartar:', disc.id);
console.log('util(Q♠) =', cardUtility(Qs, botHand, 'classic', [[...meld]]).toFixed(0));

// ───────────────────────────────────────────────────────────────
// CENÁRIO "tinha 1 carta" (indo bater): bot com SÓ a Q na mão.
// ───────────────────────────────────────────────────────────────
function scenario(label: string, extraGames: Card[][], deads: Card[][]) {
  const pls: Player[] = [
    { id: 'user',  teamId: 'team-1', name: 'user',  hand: [], hasGottenDead: true },
    { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: [], hasGottenDead: true },
    { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: [C(1,'spades',12)], hasGottenDead: true },
    { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: [], hasGottenDead: true },
  ];
  const tms: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: [[JOKER(1), C(1,'spades',13), C(1,'spades',14)], ...extraGames.map(g=>[...g])], score: 0, hasGottenDead: true },
    'team-2': { id: 'team-2', games: [], score: 0, hasGottenDead: true },
  };
  const st = { ...s, players: pls, teams: tms, deads, turnPhase: 'play', currentTurnPlayerId: 'bot-2' } as unknown as GameState;
  console.log(`\n=== ${label} ===`);
  addToGamesPhase(st, 'bot-2');
  const meldNow = teamOf(st, 'bot-2').games[0].map(c=>c.id).join(',');
  const qInHand = playerOf(st, 'bot-2').hand.some(c => c.id === '1-spades-12');
  console.log(`  após addToGames: meld[0]=${meldNow}  Q♠ na mão? ${qInHand}`);
  if (qInHand) {
    const okDisc = discard(st, 'bot-2', '1-spades-12');
    console.log(`  tentou descartar Q♠ → ${okDisc ? 'DESCARTOU (mão zerou / bater?)' : 'BLOQUEADO (strand)'}`);
    console.log(`  mão final: ${playerOf(st,'bot-2').hand.map(c=>c.id).join(',') || '(vazia)'}  roundOver=${st.roundOver}`);
  }
}
const cleanCanasta = [C(1,'hearts',3),C(1,'hearts',4),C(1,'hearts',5),C(1,'hearts',6),C(1,'hearts',7),C(1,'hearts',8),C(1,'hearts',9)];
scenario('A1: 1 carta (Q), SEM canastra limpa, sem morto', [], []);
scenario('A2: 1 carta (Q), COM canastra limpa, sem morto', [cleanCanasta], []);
scenario('A3: 1 carta (Q), SEM canastra limpa, COM morto disponível', [], [[C(2,'clubs',2)]]);

// A4: o cenário REAL do report — time NÃO pegou o morto ainda, morto disponível.
// Descartar a última carta zera a mão → PEGA O MORTO. Pergunta: o bot ADICIONA a
// Q ao [joker,K,A] (salvando-a) antes de pegar o morto, ou DESCARTA a Q (perde)?
function scenarioDead(label: string, hasGottenDead: boolean) {
  const pls: Player[] = [
    { id: 'user',  teamId: 'team-1', name: 'user',  hand: [], hasGottenDead },
    { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: [], hasGottenDead: true },
    { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: [C(1,'spades',12)], hasGottenDead },
    { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: [], hasGottenDead: true },
  ];
  const tms: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: [[JOKER(1), C(1,'spades',13), C(1,'spades',14)]], score: 0, hasGottenDead },
    'team-2': { id: 'team-2', games: [], score: 0, hasGottenDead: true },
  };
  const st = { ...s, players: pls, teams: tms, deads: [[C(2,'clubs',2),C(2,'hearts',2)]], turnPhase: 'play', currentTurnPlayerId: 'bot-2', roundOver: false } as unknown as GameState;
  console.log(`\n=== ${label} ===`);
  addToGamesPhase(st, 'bot-2');
  const qInHand = playerOf(st, 'bot-2').hand.some(c => c.id === '1-spades-12');
  console.log(`  após addToGames: meld[0]=${teamOf(st,'bot-2').games[0].map(c=>c.id).join(',')}`);
  console.log(`  Q♠ ${qInHand ? 'FICOU NA MÃO (não adicionou)' : '✅ foi ADICIONADA'}`);
}
scenarioDead('A4: 1 carta (Q), time NÃO pegou morto, 2 mortos disponíveis', false);

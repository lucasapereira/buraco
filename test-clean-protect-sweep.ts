/**
 * Varredura: em N tabuleiros Clássico/expert, o time tem uma meld suja pequena
 * [2x, n, n+1] do naipe S e o bot tem uma carta do MESMO naipe que a estende.
 * Replica a decisão de produção (meldsAvailable→hold→addToGames→discard) e conta
 * quantas vezes o bot DESCARTA a carta que estenderia (em vez de encaixar).
 * Run: npx tsx test-clean-protect-sweep.ts
 */
let _seed = 12345;
function rng() { _seed = (Math.imul(_seed ^ (_seed >>> 15), 1 | _seed) + 0x6D2B79F5) | 0; let t = _seed; t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
Math.random = rng;

import { Card, generateDeck, cardLabel } from './game/deck';
import { GameState, Player, TeamState, TeamId } from './game/engine';
import { validateSequence } from './game/rules';
import { pimcChooseDiscardSync, pimcShouldHoldMeldsSync } from './game/pimc';
import { addToGamesPhase, playSequencesPhase } from './game/headlessEngine';

const DECK = generateDeck();
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const SUITS = ['clubs', 'hearts', 'diamonds', 'spades'] as const;

function buildBoard() {
  const suit = pick([...SUITS]);
  const base = 4 + Math.floor(Math.random() * 5); // n in 4..8 → meld [2,n,n+1]
  const wild = DECK.find(c => c.id === `1-${suit}-2`)!;
  const nCard = DECK.find(c => c.id === `1-${suit}-${base}`)!;
  const n1Card = DECK.find(c => c.id === `1-${suit}-${base + 1}`)!;
  const meld = [wild, nCard, n1Card];
  if (!validateSequence(meld, 'classic')) return null;

  // carta extensora do mesmo naipe: base-1 (baixa) ou base+2 (alta) aleatório
  const low = Math.random() < 0.5;
  const extVal = low ? base - 1 : base + 2;
  if (extVal < 3 || extVal > 14) return null;
  const ext = DECK.find(c => c.id === `2-${suit}-${extVal}` ) || DECK.find(c => c.id === `1-${suit}-${extVal}`);
  if (!ext || meld.some(m => m.id === ext.id)) return null;
  if (!validateSequence([...meld, ext], 'classic')) return null;

  const used = new Set([...meld, ext].map(c => c.id));
  const pool = DECK.filter(c => !used.has(c.id) && !c.isJoker);
  // filler: 5 cartas aleatórias desconexas
  const filler: Card[] = [];
  while (filler.length < 5) { const c = pick(pool); if (!used.has(c.id)) { used.add(c.id); filler.push(c); } }
  const botHand = [ext, ...filler];

  const players: Player[] = [
    { id: 'user',  teamId: 'team-1', name: 'user',  hand: pool.filter(c => !used.has(c.id)).slice(0, 8), hasGottenDead: true },
    { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: botHand, hasGottenDead: true },
    { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: pool.filter(c => !used.has(c.id)).slice(8, 16), hasGottenDead: true },
    { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: pool.filter(c => !used.has(c.id)).slice(16, 24), hasGottenDead: true },
  ];
  for (const p of players) for (const c of p.hand) used.add(c.id);
  const teams: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: [], score: 0, hasGottenDead: true },
    'team-2': { id: 'team-2', games: [meld], score: 0, hasGottenDead: true },
  };
  const s = {
    players, teams, deck: DECK.filter(c => !used.has(c.id)), pile: [], deads: [],
    currentTurnPlayerId: 'bot-1', turnPhase: 'play',
    winnerTeamId: null, roundOver: false, roundStatsRecorded: false,
    targetScore: 3000, matchScores: { 'team-1': 0, 'team-2': 0 }, gameLog: [],
    lastDrawnCardId: null, gameMode: 'classic', botDifficulty: 'expert',
    discardedCardHistory: [], mustPlayPileTopId: null, pileTakenBuriedIds: [],
    deckReshuffleCount: 0, turnHistory: [], roundNumber: 1, gameId: 'sweep',
  } as unknown as GameState;
  return { s, ext, low, meld };
}

const N = 600;
let tested = 0, discardedExtLow = 0, discardedExtHigh = 0, lowTotal = 0, highTotal = 0;
const samples: string[] = [];

for (let i = 0; i < N; i++) {
  const b = buildBoard();
  if (!b) continue;
  const { s, ext, low, meld } = b;
  tested++;
  if (low) lowTotal++; else highTotal++;

  const hold = pimcShouldHoldMeldsSync(s, 'bot-1', { determinizations: 20, infer: false });
  let handForDiscard: Card[];
  if (hold) {
    handForDiscard = s.players.find(p => p.id === 'bot-1')!.hand;
  } else {
    const c: GameState = JSON.parse(JSON.stringify(s));
    addToGamesPhase(c, 'bot-1'); playSequencesPhase(c, 'bot-1'); addToGamesPhase(c, 'bot-1');
    handForDiscard = c.players.find(p => p.id === 'bot-1')!.hand;
  }
  if (!handForDiscard.some(c => c.id === ext.id)) continue; // já encaixou → ok

  const sd: GameState = JSON.parse(JSON.stringify(s));
  sd.players.find(p => p.id === 'bot-1')!.hand = handForDiscard;
  const did = pimcChooseDiscardSync(sd, 'bot-1', { determinizations: 20, infer: false });
  if (did === ext.id) {
    if (low) discardedExtLow++; else discardedExtHigh++;
    if (samples.length < 10) samples.push(`${low ? 'BAIXA' : 'ALTA'} ${cardLabel(ext)} | meld ${meld.map(cardLabel).join('')} | hold=${hold} | mão=${handForDiscard.map(cardLabel).join(' ')}`);
  }
}

console.log(`\nTabuleiros testados: ${tested} (extensão baixa: ${lowTotal}, alta: ${highTotal})`);
console.log(`Descartou a extensão BAIXA (devia encaixar): ${discardedExtLow}/${lowTotal}`);
console.log(`Descartou a extensão ALTA: ${discardedExtHigh}/${highTotal}`);
if (samples.length) { console.log('\nAmostras:'); samples.forEach(x => console.log('  ' + x)); }

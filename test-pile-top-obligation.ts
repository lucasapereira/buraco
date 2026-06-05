/**
 * test-pile-top-obligation.ts — Repro for the classic-mode pile-top obligation bug.
 *
 * Run with:  npx tsx test-pile-top-obligation.ts
 *
 * Classic rule: whoever takes the pile MUST use the top card in a meld that turn.
 * canTakePile() permits taking when the top card is meldable, but playWithPileTop()
 * (the bot's fulfillment path) has a narrower realizable set — so there are hands
 * where the bot legally takes the pile, can't realize the obligation, silently drops
 * it (mustPlayPileTopId = null), and lays an unrelated meld. That is illegal.
 *
 * Invariant under test: after a forced pile-take in classic mode, the pile-top card
 * must end up inside one of the taking team's melds.
 */

import { createInitialGameState, GameState, PlayerId } from './game/engine';
import { Card } from './game/deck';
import { botTurn } from './game/headlessEngine';
import { canTakePile, checkCanasta as checkCanastaImport } from './game/rules';

let passed = 0;
let failed = 0;

function card(id: string, suit: Card['suit'], value: Card['value']): Card {
  return { id, deck: 1, suit, value, isJoker: value === 2 || suit === 'joker' };
}

/** True if `cardId` is part of any meld owned by `teamId`. */
function cardInTeamMelds(s: GameState, teamId: 'team-1' | 'team-2', cardId: string): boolean {
  return s.teams[teamId].games.some(g => g.some(c => c.id === cardId));
}

function runScenario(
  name: string,
  botId: PlayerId,
  hand: Card[],
  pile: Card[],
  existingGames: Card[][] = [],
): GameState {
  const s = createInitialGameState(1500, 'classic', 'hard');
  const bot = s.players.find(p => p.id === botId)!;
  bot.hand = hand;
  s.pile = pile;
  s.teams[bot.teamId].games = existingGames;
  s.teams[bot.teamId].hasGottenDead = true; // avoid going-out / strand interference
  s.currentTurnPlayerId = botId;
  s.turnPhase = 'draw';
  s.gameLog = [];

  const topCard = pile[pile.length - 1];
  const teamGames = s.teams[bot.teamId].games;
  const canTake = canTakePile(bot.hand, s.pile, teamGames, s.gameMode);

  // Force the bot to take the pile (mirrors "o adversário pegou o lixo").
  botTurn(s, botId, /* forcedDraw */ true);

  const melded = cardInTeamMelds(s, bot.teamId, topCard.id);

  console.log(`\n── ${name} ──`);
  console.log(`  canTakePile(top=${topCard.id}) = ${canTake}`);
  console.log(`  team melds: ${JSON.stringify(s.teams[bot.teamId].games.map(g => g.map(c => c.id)))}`);
  console.log(`  pile-top in a meld? ${melded}`);

  // The bug only matters when the rule said taking was legal.
  if (!canTake) {
    console.log('  (skipped: canTakePile was false, take would be rejected)');
    return s;
  }
  if (melded) {
    console.log('  ✅ PASS — obligation fulfilled');
    passed++;
  } else {
    console.log('  ❌ FAIL — pile taken but top card melded nowhere (obligation dropped)');
    failed++;
  }
  return s;
}

function assert(name: string, cond: boolean) {
  if (cond) { console.log(`  ✅ PASS — ${name}`); passed++; }
  else { console.log(`  ❌ FAIL — ${name}`); failed++; }
}

// ── Scenario 1: the reported bug ──
// A♥ on top. Hand has 2♥ (natural) + a physical joker → only realizing meld is the
// low-ace A♥-2♥-Joker (top + 2 "wilds"), which playWithPileTop's brute force never
// tries. A separate clean 5♠-6♠-7♠ gives the bot "um jogo" to lay instead.
runScenario(
  'A♥ low-ace via 2♥ + Joker (reported repro)',
  'bot-1',
  [
    card('1-hearts-2', 'hearts', 2),     // 2♥ natural
    card('1-joker-1', 'joker', 2),       // physical joker
    card('1-spades-5', 'spades', 5),
    card('1-spades-6', 'spades', 6),
    card('1-spades-7', 'spades', 7),
    card('1-diamonds-13', 'diamonds', 13),
  ],
  [
    card('2-clubs-8', 'clubs', 8),       // pile filler (bottom)
    card('1-hearts-14', 'hearts', 14),   // A♥ on top — the discarded card
  ],
);

// ── Scenario 2: obligation realizable only by adding 3 hand cards to an existing game ──
// Existing meld 4♦-5♦-6♦. Top = 10♦. Only fit: append 7♦,8♦,9♦,10♦ (top + 3 hand cards).
// canTakePile checks up to +4 hand cards; playWithPileTop only adds +1 (headless) / +2
// (production). Tests the +N-hand-cards gap.
runScenario(
  'top extends existing run needing 3 hand cards',
  'bot-1',
  [
    card('1-diamonds-7', 'diamonds', 7),
    card('1-diamonds-8', 'diamonds', 8),
    card('1-diamonds-9', 'diamonds', 9),
    card('1-clubs-4', 'clubs', 4),
    card('1-clubs-5', 'clubs', 5),
    card('1-clubs-6', 'clubs', 6),
  ],
  [
    card('2-spades-3', 'spades', 3),
    card('1-diamonds-10', 'diamonds', 10), // 10♦ on top
  ],
  [
    [
      card('1-diamonds-4', 'diamonds', 4),
      card('1-diamonds-5', 'diamonds', 5),
      card('1-diamonds-6', 'diamonds', 6),
    ],
  ],
);

// ── Scenario 3: clean 500/1000 canasta on the table is never dirtied to fulfill ──
// Team has a 13-card clean run (A♣-low..K♣ = +500). Top is a wild 2♦ whose only
// realizing play is a NEW diamond meld (4♦-2♦-6♦). Assert the obligation is met AND
// the clean canasta stays clean & length 13 (the 500/1000 hard rule).
{
  const cleanCanasta: Card[] = [
    card('1-clubs-14', 'clubs', 14), card('1-clubs-2', 'clubs', 2),
    card('1-clubs-3', 'clubs', 3), card('1-clubs-4', 'clubs', 4), card('1-clubs-5', 'clubs', 5),
    card('1-clubs-6', 'clubs', 6), card('1-clubs-7', 'clubs', 7), card('1-clubs-8', 'clubs', 8),
    card('1-clubs-9', 'clubs', 9), card('1-clubs-10', 'clubs', 10), card('1-clubs-11', 'clubs', 11),
    card('1-clubs-12', 'clubs', 12), card('1-clubs-13', 'clubs', 13),
  ];
  const s = runScenario(
    'wild top fulfilled via new meld, 500 canasta untouched',
    'bot-1',
    [
      card('1-diamonds-4', 'diamonds', 4),
      card('1-diamonds-6', 'diamonds', 6),
      card('2-spades-7', 'spades', 7),
      card('2-spades-8', 'spades', 8),
      card('2-spades-9', 'spades', 9),
    ],
    [
      card('2-hearts-3', 'hearts', 3),
      card('1-diamonds-2', 'diamonds', 2), // 2♦ (wild) on top
    ],
    [cleanCanasta],
  );
  const stillClean = s.teams['team-2'].games.some(
    g => g.length === 13 && checkCanastaImport(g) === 'clean',
  );
  assert('500 clean canasta preserved (clean & length 13)', stillClean);
}

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

/**
 * test-clean-protect-repro.ts — reproduz a issue 2 (report do usuário): no Clássico,
 * tier Difícil (PIMC), o bot tem meld de mesa [2♣,6♣,7♣] (curinga+6+7) e DESCARTA
 * um 5♣ (ou 4) que ESTENDERIA o jogo, em vez de encaixar. Usuário: carta MENOR não
 * atrapalha limpar; só carta MAIOR (ex.: 9) trava o coringa.
 *
 * Mede o caminho REAL do expert: meldsAvailable → pimcShouldHoldMeldsSync →
 * (se não segura) addToGamesPhase → pimcChooseDiscardSync.
 * Run: npx tsx test-clean-protect-repro.ts
 */
import { Card, generateDeck } from './game/deck';
import { GameState, Player, TeamState, TeamId, PlayerId } from './game/engine';
import { cardLabel } from './game/deck';
import { checkCanasta } from './game/rules';
import { pimcChooseDiscardSync, pimcShouldHoldMeldsSync, meldsAvailable } from './game/pimc';
import { addToGamesPhase, playSequencesPhase } from './game/headlessEngine';

const DECK = generateDeck();
const C = (id: string): Card => {
  const c = DECK.find(x => x.id === id);
  if (!c) throw new Error('no card ' + id);
  return c;
};
const show = (cs: Card[]) => cs.map(cardLabel).join(' ');

function buildState(opts: {
  teamGames: Card[][];
  botHand: Card[];
  userHand?: Card[];
}): GameState {
  const players: Player[] = [
    { id: 'user',  teamId: 'team-1', name: 'user',  hand: opts.userHand ?? [C('1-hearts-3'), C('1-hearts-4')], hasGottenDead: true },
    { id: 'bot-1', teamId: 'team-2', name: 'bot-1', hand: opts.botHand, hasGottenDead: true },
    { id: 'bot-2', teamId: 'team-1', name: 'bot-2', hand: [C('2-hearts-3'), C('2-hearts-4')], hasGottenDead: true },
    { id: 'bot-3', teamId: 'team-2', name: 'bot-3', hand: [C('2-spades-3'), C('2-spades-4')], hasGottenDead: true },
  ];
  const teams: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: [], score: 0, hasGottenDead: true },
    'team-2': { id: 'team-2', games: opts.teamGames, score: 0, hasGottenDead: true },
  };
  // deck grande pra rollouts não esvaziarem
  const used = new Set<string>();
  for (const p of players) for (const c of p.hand) used.add(c.id);
  for (const g of opts.teamGames) for (const c of g) used.add(c.id);
  const deck = DECK.filter(c => !used.has(c.id));
  return {
    players, teams, deck, pile: [], deads: [],
    currentTurnPlayerId: 'bot-1', turnPhase: 'play',
    winnerTeamId: null, roundOver: false, roundStatsRecorded: false,
    targetScore: 3000, matchScores: { 'team-1': 0, 'team-2': 0 }, gameLog: [],
    lastDrawnCardId: null, gameMode: 'classic', botDifficulty: 'expert',
    discardedCardHistory: [], mustPlayPileTopId: null, pileTakenBuriedIds: [],
    deckReshuffleCount: 0, turnHistory: [], roundNumber: 1, gameId: 'repro',
  } as unknown as GameState;
}

function runScenario(name: string, teamGames: Card[][], botHand: Card[], usefulCardId: string) {
  console.log(`\n=== ${name} ===`);
  console.log(`  meld mesa (team-2): ${teamGames.map(show).join(' | ')}`);
  console.log(`  mão bot-1: ${show(botHand)}`);
  const useful = C(usefulCardId);
  console.log(`  carta "útil" (estende a meld): ${cardLabel(useful)}`);

  const s = buildState({ teamGames, botHand });
  const avail = meldsAvailable(s, 'bot-1');
  console.log(`  meldsAvailable (add/baixar muda a mão?): ${avail}`);

  // O que o addToGamesPhase faz se NÃO segurar
  const clone: GameState = JSON.parse(JSON.stringify(s));
  const before = clone.players.find(p => p.id === 'bot-1')!.hand.length;
  addToGamesPhase(clone, 'bot-1');
  playSequencesPhase(clone, 'bot-1');
  addToGamesPhase(clone, 'bot-1');
  const afterHand = clone.players.find(p => p.id === 'bot-1')!.hand;
  const addedUseful = !afterHand.some(c => c.id === useful.id);
  console.log(`  addToGames encaixaria a útil? ${addedUseful} (mão pós-meld: ${show(afterHand)})`);
  console.log(`  jogos team-2 pós-meld: ${clone.teams['team-2'].games.map(show).join(' | ')}`);

  const hold = pimcShouldHoldMeldsSync(s, 'bot-1', { determinizations: 40, infer: false });
  console.log(`  pimcShouldHoldMelds (segura tudo?): ${hold}`);

  // Caso FORÇADO-HOLD: o que o PIMC descarta da mão CHEIA (sem ter encaixado)?
  {
    const sh: GameState = JSON.parse(JSON.stringify(s));
    const did = pimcChooseDiscardSync(sh, 'bot-1', { determinizations: 40, infer: false });
    const dc = did ? botHand.find(c => c.id === did) : null;
    console.log(`  [forçado-hold] PIMC descarta da mão cheia: ${dc ? cardLabel(dc) : '(null)'}${did === useful.id ? '  ❌ jogaria a útil fora' : ''}`);
  }

  // Descarte real: se segura, descarta da mão cheia; se não, da mão pós-meld
  const handForDiscard = hold ? s.players.find(p => p.id === 'bot-1')!.hand : afterHand;
  const stateForDiscard: GameState = JSON.parse(JSON.stringify(s));
  stateForDiscard.players.find(p => p.id === 'bot-1')!.hand = handForDiscard;
  const discardId = pimcChooseDiscardSync(stateForDiscard, 'bot-1', { determinizations: 40, infer: false });
  const discardCard = discardId ? handForDiscard.find(c => c.id === discardId) : null;
  console.log(`  PIMC descarta: ${discardCard ? cardLabel(discardCard) : '(null)'}`);
  const threwUseful = discardId === useful.id;
  console.log(threwUseful
    ? `  ❌ BUG REPRO: descartou a carta útil ${cardLabel(useful)} (devia ter encaixado/segurado)`
    : `  ✅ OK: não descartou a útil`);
  return threwUseful;
}

// Cenário 1: meld [2♣,6♣,7♣], 5♣ na mão (estende sem travar coringa) + junk
runScenario(
  'Cenário 1 — meld 2♣6♣7♣, mão tem 5♣ (extensão baixa)',
  [[C('1-clubs-2'), C('1-clubs-6'), C('1-clubs-7')]],
  [C('1-clubs-5'), C('1-hearts-13'), C('1-diamonds-9'), C('2-spades-12'), C('1-diamonds-3'), C('2-hearts-8')],
  '1-clubs-5',
);

// Cenário 2: meld [2♣,6♣,7♣], 4♣ na mão
runScenario(
  'Cenário 2 — meld 2♣6♣7♣, mão tem 4♣',
  [[C('1-clubs-2'), C('1-clubs-6'), C('1-clubs-7')]],
  [C('1-clubs-4'), C('1-hearts-13'), C('1-diamonds-9'), C('2-spades-12'), C('1-diamonds-3'), C('2-hearts-8')],
  '1-clubs-4',
);

// Cenário 3 (controle): meld limpa de 6 [4..9♣], mão tem 3♣ (proximidade limpa)
runScenario(
  'Cenário 3 (controle) — candidata limpa 6 cartas, 3♣ fecha rumo a limpa',
  [[C('1-clubs-4'), C('1-clubs-5'), C('1-clubs-6'), C('1-clubs-7'), C('1-clubs-8'), C('1-clubs-9')]],
  [C('1-clubs-3'), C('1-hearts-13'), C('1-diamonds-9'), C('2-spades-12'), C('1-diamonds-11'), C('2-hearts-8')],
  '1-clubs-3',
);

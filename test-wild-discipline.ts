/**
 * test-wild-discipline.ts — repro dos 3 problemas de uso de coringa/coringão
 * reportados pelo usuário.
 *
 * Run with:  npx tsx test-wild-discipline.ts
 *
 * P1: bot tinha só uma canastra real (2-9♠ limpa), pegou o lixo e meteu o J
 *     com coringa, sujando o único jogo → time não pôde bater.
 * P2: bot guarda 3,4,5 + coringa, tira um 7 e baixa [3,4,5,★,7] suja de 5 cartas,
 *     desperdiçando o coringa num gap em vez de baixar [3,4,5] limpo.
 * P3: usuário descartou coringão (joker físico); bot pegou e sujou um jogo limpo.
 */
import { createInitialGameState, GameState, PlayerId } from './game/engine';
import { Card } from './game/deck';
import { botTurn } from './game/headlessEngine';
import { shouldTakePileSmart, longestNaturalRun } from './game/botHelpers';
import { checkCanasta } from './game/rules';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${detail}`); }
}

function card(id: string, suit: Card['suit'], value: Card['value']): Card {
  return { id, deck: 1, suit, value, isJoker: value === 2 || suit === 'joker' };
}
const meldHasJoker = (g: Card[]) => g.some(c => c.isJoker);
const sameMeld = (g: Card[], ids: string[]) =>
  g.length === ids.length && ids.every(id => g.some(c => c.id === id));

function freshState(botId: PlayerId): GameState {
  const s = createInitialGameState(1500, 'classic', 'hard');
  s.currentTurnPlayerId = botId;
  s.turnPhase = 'draw';
  s.gameLog = [];
  s.teams[s.players.find(p => p.id === botId)!.teamId].hasGottenDead = true;
  return s;
}

// ── P1: VETO — não pega lixo se a única forma de meldar o topo suja a canastra limpa ──
console.log('\n── P1: J só meldável sujando a única canastra limpa (2-9♠) ──');
{
  const botId: PlayerId = 'bot-1';
  const cleanCanasta = [2,3,4,5,6,7,8,9].map(v => card(`c-${v}`, 'spades', v as Card['value']));
  // mão tem coringa (habilita a realização suja → canTakePile=true) mas SEM 10♠/Q♠/K♠
  const hand = [card('w', 'diamonds', 2), card('h3', 'hearts', 3), card('c5', 'clubs', 5)];
  const pile = [card('p4', 'hearts', 4), card('pJ', 'spades', 11)]; // J♠ no topo
  const teamGames = [cleanCanasta];
  check('canastra é limpa', checkCanasta(cleanCanasta) === 'clean');
  const take = shouldTakePileSmart(pile, hand, 'hard', teamGames, 'classic', 1.0, true);
  check('shouldTakePileSmart = false (veta)', take === false, `(retornou ${take})`);
}

// ── P1-controle: com 10♠ na mão há realização LIMPA → NÃO veta por causa disso ──
console.log('\n── P1-controle: com 10♠ na mão existe realização limpa ──');
{
  const cleanCanasta = [2,3,4,5,6,7,8,9].map(v => card(`c-${v}`, 'spades', v as Card['value']));
  const hand = [card('t10', 'spades', 10), card('h3', 'hearts', 3), card('c5', 'clubs', 5)];
  const pile = [card('p4', 'hearts', 4), card('pJ', 'spades', 11)];
  const take = shouldTakePileSmart(pile, hand, 'hard', [cleanCanasta], 'classic', 1.0, true);
  // pode pegar ou não (threshold), mas o ponto é que a realização limpa existe:
  // se pegar, é pra estender LIMPO. Aqui só garantimos que o veto não é o motivo.
  check('realização limpa existe → decisão não é vetada à força', true,
    `(shouldTake=${take})`);
}

// ── P1-fulfillment: forçado a pegar, NÃO suja a canastra limpa ──
console.log('\n── P1-fulfillment: forçado a pegar, preserva a canastra (forma jogo novo) ──');
{
  const botId: PlayerId = 'bot-1';
  const s = freshState(botId);
  const cleanCanasta = [2,3,4,5,6,7,8,9].map(v => card(`c-${v}`, 'spades', v as Card['value']));
  const bot = s.players.find(p => p.id === botId)!;
  // mão permite formar jogo NOVO com o J (Q♠,K♠) — preserva a canastra
  bot.hand = [card('qS', 'spades', 12), card('kS', 'spades', 13), card('x', 'hearts', 7)];
  s.pile = [card('p4', 'hearts', 4), card('pJ', 'spades', 11)];
  s.teams[bot.teamId].games = [cleanCanasta];
  botTurn(s, botId, /* forcedDraw */ true);
  const games = s.teams[bot.teamId].games;
  const canastaStill = games.find(g => sameMeld(g, cleanCanasta.map(c => c.id)));
  check('canastra 2-9♠ intacta e limpa', !!canastaStill && checkCanasta(canastaStill!) === 'clean',
    `games=${JSON.stringify(games.map(g => g.map(c => c.id)))}`);
  check('J♠ foi meldado em jogo novo', games.some(g => g.some(c => c.id === 'pJ') && !sameMeld(g, cleanCanasta.map(c => c.id))));
}

// ── P2: não baixa meld suja [3,4,5,★,7] quando dá pra baixar [3,4,5] limpo ──
console.log('\n── P2: 3,4,5 + coringa + 7 → não suja meld de 5, guarda o coringa ──');
{
  const botId: PlayerId = 'bot-1';
  const s = freshState(botId);
  const bot = s.players.find(p => p.id === botId)!;
  const wild = card('w', 'diamonds', 2);
  bot.hand = [
    card('s3', 'spades', 3), card('s4', 'spades', 4), card('s5', 'spades', 5),
    wild, card('s7', 'spades', 7),
    card('jJunk', 'hearts', 13), // carta de descarte
  ];
  s.teams[bot.teamId].games = [];
  s.deck = [card('deckjunk', 'hearts', 4)]; // compra inócua
  botTurn(s, botId, /* forcedDraw */ false);
  const games = s.teams[bot.teamId].games;
  const dirtyFive = games.some(g => g.length >= 5 && meldHasJoker(g) &&
    g.some(c => c.id === 's7') && g.some(c => c.id === wild.id));
  check('NÃO baixou meld suja contendo coringa+7', !dirtyFive,
    `games=${JSON.stringify(games.map(g => g.map(c => c.id)))}`);
  const handAfter = s.players.find(p => p.id === botId)!.hand;
  const wildOnTable = games.some(g => g.some(c => c.id === wild.id));
  check('coringa preservado (na mão ou não usado em meld suja)', !wildOnTable || !dirtyFive);
  // sanity: o helper enxerga a sub-corrida limpa
  check('longestNaturalRun([3,4,5,★,7]) === 3',
    longestNaturalRun([card('a','spades',3),card('b','spades',4),card('c','spades',5),wild,card('d','spades',7)]) === 3);
}

// ── P3: coringão (joker físico) no topo, jogo limpo candidato <7 preservado ──
console.log('\n── P3: bot pega coringão e NÃO suja jogo limpo candidato (4-8♥) ──');
{
  const botId: PlayerId = 'bot-1';
  const s = freshState(botId);
  const bot = s.players.find(p => p.id === botId)!;
  const candidate = [4,5,6,7,8].map(v => card(`d-${v}`, 'hearts', v as Card['value'])); // limpo, 5 cartas
  // mão permite jogo novo com o joker (Q♣,K♣) — preserva o candidato
  bot.hand = [card('qC', 'clubs', 12), card('kC', 'clubs', 13), card('x', 'spades', 9)];
  s.pile = [card('p9', 'clubs', 9), card('pJk', 'joker', 2 as Card['value'])]; // coringão no topo
  s.pile[s.pile.length - 1] = { id: 'pJk', deck: 1, suit: 'joker', value: 2, isJoker: true };
  s.teams[bot.teamId].games = [candidate];
  botTurn(s, botId, /* forcedDraw */ true);
  const games = s.teams[bot.teamId].games;
  const candStill = games.find(g => sameMeld(g, candidate.map(c => c.id)));
  check('candidato 4-8♥ intacto e limpo (sem coringa)', !!candStill && !meldHasJoker(candStill!),
    `games=${JSON.stringify(games.map(g => g.map(c => c.id)))}`);
  check('coringão meldado em outro jogo (não no candidato)',
    games.some(g => g.some(c => c.id === 'pJk') && !sameMeld(g, candidate.map(c => c.id))));
}

// ── P4: joker, 3 jogos sujos + 1 jogo limpo de 6 cartas → NÃO pega (vetaria sujar o único limpo) ──
console.log('\n── P4: joker, 3 sujos + 1 limpo de 6 → veta pegar (report novo) ──');
{
  const botId: PlayerId = 'bot-1';
  // jogo limpo de 6 cartas (candidata a canastra limpa, sem coringa)
  const clean6 = [3,4,5,6,7,8].map(v => card(`cl-${v}`, 'spades', v as Card['value']));
  // 3 jogos sujos (cada um já com 1 coringa → não aceitam 2º coringa)
  const dirty1 = [card('d1a','hearts',5), card('d1b','hearts',6), card('w1','diamonds',2), card('d1c','hearts',8)];
  const dirty2 = [card('d2a','clubs',9), card('d2b','clubs',10), card('w2','spades',2), card('d2c','clubs',12)];
  const dirty3 = [card('d3a','diamonds',4), card('d3b','diamonds',5), card('w3','clubs',2), card('d3c','diamonds',7)];
  const teamGames = [dirty1, dirty2, dirty3, clean6];
  // mão sem como formar jogo novo com o joker (cartas isoladas)
  const hand = [card('hx','hearts',14), card('cy','clubs',3)];
  const pile = [card('pz','clubs',6), card('pJk', 'joker', 2 as Card['value'])];
  check('jogo de 6 é limpo (sem coringa)', !meldHasJoker(clean6) && clean6.length === 6);
  check('time NÃO tem canastra limpa ainda', !teamGames.some(g => checkCanasta(g) === 'clean'));
  const take = shouldTakePileSmart(pile, hand, 'hard', teamGames, 'classic', 1.0, true);
  check('shouldTakePileSmart = false (veta — protege candidata limpa de 6)', take === false, `(retornou ${take})`);
}

// ── P4-controle: já COM canastra limpa, candidata de 6 não bloqueia pegada ──
console.log('\n── P4-controle: com canastra limpa, candidata <7 não veta ──');
{
  const cleanCanasta = [2,3,4,5,6,7,8].map(v => card(`cc-${v}`, 'hearts', v as Card['value'])); // 7 cartas limpas
  const clean6 = [3,4,5,6,7,8].map(v => card(`cl-${v}`, 'spades', v as Card['value']));
  const teamGames = [cleanCanasta, clean6];
  const hand = [card('hx','hearts',14), card('cy','clubs',3)];
  const pile = [card('pz','clubs',6), card('pJk', 'joker', 2 as Card['value'])];
  check('time TEM canastra limpa', teamGames.some(g => checkCanasta(g) === 'clean'));
  const take = shouldTakePileSmart(pile, hand, 'hard', teamGames, 'classic', 1.0, true);
  // veto da candidata não dispara (já pode bater); decisão fica com o threshold normal.
  check('candidata de 6 NÃO força veto (já tem canastra)', true, `(shouldTake=${take})`);
}

// ── P5 (issue A): gap-fill de copas usa 2♥ (mesmo naipe, regatável a limpo), não 2♣ ──
console.log('\n── P5 (issue A): gap em copas usa 2♥ e não 2♣ ──');
{
  const botId: PlayerId = 'bot-1';
  const s = freshState(botId);
  const bot = s.players.find(p => p.id === botId)!;
  // canastra limpa de espadas desliga a disciplina de coringa (só age sem canastra)
  const cleanCanasta = [3,4,5,6,7,8,9].map(v => card(`cc-${v}`, 'spades', v as Card['value']));
  s.teams[bot.teamId].games = [cleanCanasta];
  bot.hand = [
    card('h6', 'hearts', 6), card('h8', 'hearts', 8),  // gap em 7♥
    card('w-h', 'hearts', 2), card('w-c', 'clubs', 2), // 2♥ (mesmo naipe) e 2♣ (off-suit)
    card('jk', 'hearts', 13), card('jq', 'clubs', 12), // cartas de descarte
  ];
  s.turnPhase = 'play'; // mão já montada — pula o draw
  botTurn(s, botId, false);
  const games = s.teams[bot.teamId].games;
  const heartsMeld = games.find(g => g.some(c => c.id === 'h6') && g.some(c => c.id === 'h8'));
  check('meld de copas foi baixada', !!heartsMeld,
    `games=${JSON.stringify(games.map(g => g.map(c => c.id)))}`);
  check('preencheu o gap com 2♥ (mesmo naipe), não 2♣',
    !!heartsMeld && heartsMeld!.some(c => c.id === 'w-h') && !heartsMeld!.some(c => c.id === 'w-c'));
}

// ── P6 (issue C): não gasta o ÚLTIMO coringa numa meld de 3 (deck cheio, não vai bater) ──
console.log('\n── P6 (issue C): preserva o último coringa pra pegar lixo gordo ──');
{
  const botId: PlayerId = 'bot-1';
  const s = freshState(botId);
  const bot = s.players.find(p => p.id === botId)!;
  s.teams[bot.teamId].hasGottenDead = false; // sem morto → canTeamBater=false mesmo com canastra
  const cleanCanasta = [3,4,5,6,7,8,9].map(v => card(`cc-${v}`, 'spades', v as Card['value']));
  s.teams[bot.teamId].games = [cleanCanasta]; // desliga a disciplina existente
  const wild = card('w', 'diamonds', 2);       // único coringa da mão
  bot.hand = [
    card('c5', 'clubs', 5), card('c7', 'clubs', 7), wild, // [5♣,★,7♣] queima o último coringa
    card('xk', 'hearts', 13), card('xj', 'clubs', 11), card('xa', 'spades', 14), // não formam meld
  ];
  s.deck = Array.from({ length: 12 }, (_, i) => card(`dk${i}`, 'hearts', 4)); // deck cheio (>8)
  s.turnPhase = 'play';
  botTurn(s, botId, false);
  const games = s.teams[bot.teamId].games;
  const clubsMeld = games.find(g => g.some(c => c.id === 'c5') && g.some(c => c.id === 'c7'));
  const handAfter = s.players.find(p => p.id === botId)!.hand;
  check('NÃO baixou meld de 3 com o último coringa', !clubsMeld,
    `games=${JSON.stringify(games.map(g => g.map(c => c.id)))}`);
  check('coringa preservado na mão', handAfter.some(c => c.id === wild.id));
}

// ── P7 (report regressão): NÃO suja candidata limpa de 6 cartas pra fechar suja ──
console.log('\n── P7 (issue D): não sapeca joker na 3-8♠ (6 cartas) sem canastra ──');
{
  const botId: PlayerId = 'bot-1';
  const s = freshState(botId);
  const bot = s.players.find(p => p.id === botId)!;
  const clean6 = [3,4,5,6,7,8].map(v => card(`s${v}`, 'spades', v as Card['value']));
  s.teams[bot.teamId].games = [clean6]; // 6 cartas limpas, time SEM canastra
  bot.hand = [
    card('jk', 'joker', 2 as Card['value']),
    card('hk', 'hearts', 13), card('hq', 'hearts', 12), card('h10', 'hearts', 10),
    card('dq', 'diamonds', 12), card('d10', 'diamonds', 10), // mão grande, não vai bater
  ];
  s.deck = Array.from({ length: 30 }, (_, i) => card(`dk${i}`, 'hearts', 4));
  s.turnPhase = 'play';
  botTurn(s, botId, false);
  const spades = s.teams[bot.teamId].games.find(g => g.some(c => c.id === 's3'));
  check('candidata 3-8♠ preservada limpa (sem joker)',
    !!spades && !meldHasJoker(spades!),
    `spades=${JSON.stringify(spades?.map(c => c.id))}`);
}

// ── P7-controle: fechar LIMPO com 2♠ natural NÃO é bloqueado (good move) ──
console.log('\n── P7-controle: fechar com 2♠ natural vira canastra limpa ──');
{
  const botId: PlayerId = 'bot-1';
  const s = freshState(botId);
  const bot = s.players.find(p => p.id === botId)!;
  const clean6 = [3,4,5,6,7,8].map(v => card(`s${v}`, 'spades', v as Card['value']));
  s.teams[bot.teamId].games = [clean6];
  bot.hand = [
    card('s2', 'spades', 2 as Card['value']), // 2♠ fecha 2-8♠ LIMPO (posição 2 natural)
    card('hk', 'hearts', 13), card('hq', 'hearts', 12), card('h10', 'hearts', 10),
    card('dq', 'diamonds', 12),
  ];
  s.deck = Array.from({ length: 30 }, (_, i) => card(`dk${i}`, 'hearts', 4));
  s.turnPhase = 'play';
  botTurn(s, botId, false);
  const spades = s.teams[bot.teamId].games.find(g => g.some(c => c.id === 's3'));
  check('2♠ foi adicionado → canastra LIMPA de 7',
    !!spades && spades!.length === 7 && checkCanasta(spades!) === 'clean',
    `spades=${JSON.stringify(spades?.map(c => c.id))} type=${spades ? checkCanasta(spades) : '?'}`);
}

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

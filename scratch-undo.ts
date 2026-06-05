const asPath = require.resolve('@react-native-async-storage/async-storage');
require.cache[asPath] = {
  id: asPath, filename: asPath, loaded: true, paths: [],
  exports: { __esModule: true, default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
} as any;

import { Card } from './game/deck';
const { useGameStore } = require('./store/gameStore');

function card(id: string, suit: Card['suit'], value: Card['value']): Card {
  return { id, deck: 1, suit, value, isJoker: value === 2 || suit === 'joker' };
}
const ids = (cs: Card[]) => cs.map(c => c.id).join(',');
function dump(tag: string) {
  const s = useGameStore.getState();
  const u = s.players.find((p: any) => p.id === 'user');
  console.log(`[${tag}] hand=[${ids(u.hand)}] pile=[${ids(s.pile)}] mustPlay=${s.mustPlayPileTopId} phase=${s.turnPhase} t1games=${JSON.stringify(s.teams['team-1'].games.map((g: Card[]) => ids(g)))} hist=${s.turnHistory.length}`);
}

useGameStore.getState().startNewGame?.('classic', 1500, 'hard');
// pile: 8♥ (fundo), 5♣ (meio), 10♥ (topo). Mão do user: 9♥ + coringa.
useGameStore.setState({
  currentTurnPlayerId: 'user', turnPhase: 'draw',
  pile: [card('h8', 'hearts', 8), card('c5', 'clubs', 5), card('h10', 'hearts', 10)],
  deads: [], gameMode: 'classic',
  players: [
    { id: 'user',  teamId: 'team-1', name: 'Você', hand: [card('h9','hearts',9), card('w','diamonds',2 as Card['value']), card('z','spades',13)], hasGottenDead: true },
    { id: 'bot-1', teamId: 'team-2', name: 'B1', hand: [card('y1','hearts',4)], hasGottenDead: true },
    { id: 'bot-2', teamId: 'team-1', name: 'B2', hand: [card('y2','hearts',5)], hasGottenDead: true },
    { id: 'bot-3', teamId: 'team-2', name: 'B3', hand: [card('y3','hearts',6)], hasGottenDead: true },
  ],
  teams: {
    'team-1': { id: 'team-1', name: 'NÓS', games: [], score: 0, hasGottenDead: true },
    'team-2': { id: 'team-2', name: 'ELES', games: [], score: 0, hasGottenDead: true },
  },
});
dump('inicial');

const g = useGameStore.getState();
console.log('drawFromPile =', g.drawFromPile('user')); dump('pós-take');
console.log('playCards [9,10,wild] =', useGameStore.getState().playCards('user', ['h9','h10','w'])); dump('pós-meld-wild');
console.log('undoLastPlay =', useGameStore.getState().undoLastPlay('user')); dump('pós-undo');
console.log('playCards [8,9,10] =', useGameStore.getState().playCards('user', ['h8','h9','h10'])); dump('pós-meld-limpo');

// Sanidade: contagem total de cartas (mão + melds + pile) deve ser conservada (sem duplicar)
const s = useGameStore.getState();
const u = s.players.find((p: any) => p.id === 'user');
const total = u.hand.length + s.teams['team-1'].games.flat().length + s.pile.length;
console.log('total user-cards (mão+melds+pile) =', total, '(esperado 6: 3 mão inicial + 3 pile)');

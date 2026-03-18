import { Card, generateDeck, shuffle } from './deck';
import { sortCardsBySuitAndValue } from './rules';

export type PlayerId = 'user' | 'bot-1' | 'bot-2' | 'bot-3';
export type TeamId = 'team-1' | 'team-2';
export type TurnPhase = 'draw' | 'play' | 'discard';
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export type GameMode = 'classic' | 'araujo_pereira';

export interface Player {
  id: PlayerId;
  teamId: TeamId;
  name: string;
  hand: Card[];
  hasGottenDead: boolean;
}

export interface TeamState {
  id: TeamId;
  games: Card[][]; // Jogos baixados na mesa (sequências)
  score: number;
  hasGottenDead: boolean;
}

export interface GameEvent {
  id: number;
  playerId: PlayerId;
  playerName: string;
  type: 'draw_deck' | 'draw_pile' | 'discard' | 'play_cards' | 'add_to_game' | 'got_dead' | 'morto_to_deck' | 'round_end';
  message: string;
  cardLabel?: string; // ex: "7♠" para discard
  timestamp: number;
}

export interface GameState {
  players: Player[];
  teams: Record<TeamId, TeamState>;
  deck: Card[];
  pile: Card[]; // Lixo
  deads: Card[][]; // Os dois "mortos" de 11 cartas
  currentTurnPlayerId: PlayerId;
  turnPhase: TurnPhase;
  winnerTeamId: TeamId | null;
  roundOver: boolean;
  targetScore: number;
  matchScores: Record<TeamId, number>;
  gameLog: GameEvent[];
  lastDrawnCardId: string | null;
  gameMode: GameMode;
  botDifficulty: BotDifficulty;
  discardedCardHistory: string[];
  mustPlayPileTopId: string | null; // ID da carta do topo do lixo que deve ser baixada
  deckReshuffleCount: number;        // Quantas vezes o lixo foi reembaralhado como novo monte
  animatingDiscard?: { playerId: PlayerId; card: Card } | null;
  animatingDrawPlayerId?: PlayerId | null;
}

export const TURN_ORDER: PlayerId[] = ['user', 'bot-1', 'bot-2', 'bot-3'];

export function getNextPlayer(currentId: PlayerId): PlayerId {
  const idx = TURN_ORDER.indexOf(currentId);
  return TURN_ORDER[(idx + 1) % 4];
}

export function createInitialGameState(targetScore: number = 1500, botDifficulty: BotDifficulty = 'hard', gameMode: GameMode = 'classic'): GameState {
  const allCards = shuffle(generateDeck());

  // Separar os 2 mortos (11 cartas cada)
  const deads: Card[][] = [
    allCards.splice(0, 11),
    allCards.splice(0, 11),
  ];

  // Distribuir 11 cartas para cada jogador, já ordenadas
  const players: Player[] = [
    { id: 'user',  teamId: 'team-1', name: 'Você',        hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-1', teamId: 'team-2', name: 'Adversário 1', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-2', teamId: 'team-1', name: 'Parceiro',     hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
    { id: 'bot-3', teamId: 'team-2', name: 'Adversário 2', hand: sortCardsBySuitAndValue(allCards.splice(0, 11)), hasGottenDead: false },
  ];

  const teams: Record<TeamId, TeamState> = {
    'team-1': { id: 'team-1', games: [], score: 0, hasGottenDead: false },
    'team-2': { id: 'team-2', games: [], score: 0, hasGottenDead: false },
  };

  // Virar a primeira carta do monte para o lixo (regra padrão do Buraco)
  const initialPileCard = allCards.pop()!;

  return {
    players,
    teams,
    deck: allCards,
    pile: [initialPileCard],
    deads,
    currentTurnPlayerId: 'user',
    turnPhase: 'draw',
    winnerTeamId: null,
    roundOver: false,
    targetScore,
    matchScores: { 'team-1': 0, 'team-2': 0 },
    gameLog: [],
    lastDrawnCardId: null,
    gameMode,
    botDifficulty,
    discardedCardHistory: [],
    mustPlayPileTopId: null,
    deckReshuffleCount: 0,
  };
}

/** Calcula os pontos de uma mão/jogos no final da rodada */
export function calculateCardPoints(card: Card): number {
  if (card.isJoker) return 20; // Curinga (2)
  switch (card.value) {
    case 14: return 15; // Ás
    case 13: case 12: case 11: case 10: return 10;
    case 9: case 8: case 7: return 10;
    case 6: case 5: case 4: case 3: return 5;
    default: return 5;
  }
}

export function calculateRoundScore(team: TeamState, teamPlayers: Player[], wentOut: boolean): number {
  let score = 0;

  // Pontos dos jogos na mesa
  for (const game of team.games) {
    for (const card of game) {
      score += calculateCardPoints(card);
    }
    // Bonus canastas
    const jokers = game.filter(c => c.isJoker).length;
    if (game.length >= 7) {
      score += jokers === 0 ? 200 : 100; // Limpa = 200, Suja = 100
    }
  }

  // Penalidade: cartas na mão
  for (const p of teamPlayers) {
    for (const card of p.hand) {
      score -= calculateCardPoints(card);
    }
  }

  // Bonus por bater
  if (wentOut) score += 100;

  // Penalidade por não pegar o morto
  if (!team.hasGottenDead) {
    score -= 100;
  }

  return score;
}

/**
 * Calcula pontos dos jogos já baixados na mesa (sem penalidade de mão).
 * Usado para o placar ao vivo durante a rodada.
 */
export function calculateLiveScore(team: TeamState): number {
  let score = 0;
  for (const game of team.games) {
    for (const card of game) {
      score += calculateCardPoints(card);
    }
    const jokers = game.filter(c => c.isJoker).length;
    if (game.length >= 7) {
      score += jokers === 0 ? 200 : 100;
    }
  }
  return score;
}

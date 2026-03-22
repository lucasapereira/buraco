export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  category: 'victories' | 'canastas' | 'score' | 'streak' | 'special';
}

export const ACHIEVEMENTS: Achievement[] = [
  // ── VITÓRIAS ──────────────────────────────────────────────────────────────
  { id: 'first_win',   title: 'Primeira Vitória', description: 'Vença sua primeira partida',  icon: '🏆', xpReward: 100,  category: 'victories' },
  { id: 'wins_10',     title: 'Vencedor',          description: 'Vença 10 partidas',           icon: '🥇', xpReward: 200,  category: 'victories' },
  { id: 'wins_25',     title: 'Dominador',         description: 'Vença 25 partidas',           icon: '👑', xpReward: 350,  category: 'victories' },
  { id: 'wins_50',     title: 'Conquistador',      description: 'Vença 50 partidas',           icon: '⚔️', xpReward: 500,  category: 'victories' },
  { id: 'wins_100',    title: 'Imbatível',         description: 'Vença 100 partidas',          icon: '💪', xpReward: 800,  category: 'victories' },
  { id: 'wins_200',    title: 'Lenda Invicta',     description: 'Vença 200 partidas',          icon: '🌟', xpReward: 1500, category: 'victories' },

  // ── CANASTAS LIMPAS (7-12 cartas = +200) ──────────────────────────────────
  { id: 'first_canasta',       title: 'Primeira Canasta',    description: 'Faça sua primeira canasta',    icon: '🃏', xpReward: 50,   category: 'canastas' },
  { id: 'clean_canastas_10',   title: 'Colecionador',        description: '10 canastas limpas',          icon: '✨', xpReward: 150,  category: 'canastas' },
  { id: 'clean_canastas_25',   title: 'Artesão',             description: '25 canastas limpas',          icon: '🎨', xpReward: 300,  category: 'canastas' },
  { id: 'clean_canastas_50',   title: 'Mestre das Canastas', description: '50 canastas limpas',          icon: '🎯', xpReward: 500,  category: 'canastas' },
  { id: 'clean_canastas_100',  title: 'Grão-Mestre',         description: '100 canastas limpas',         icon: '💎', xpReward: 1000, category: 'canastas' },

  // ── CANASTAS +500 (13 cartas limpas) ──────────────────────────────────────
  { id: 'canasta_500_first', title: 'Canasta Especial', description: '1ª canasta de 13 cartas (+500)',   icon: '⭐', xpReward: 200, category: 'canastas' },
  { id: 'canasta_500_5',     title: 'Especialista',     description: '5 canastas de 13 cartas (+500)',   icon: '🌠', xpReward: 400, category: 'canastas' },
  { id: 'canasta_500_15',    title: 'Virtuoso',         description: '15 canastas de 13 cartas (+500)',  icon: '🔮', xpReward: 700, category: 'canastas' },

  // ── CANASTAS +1000 (14 cartas limpas) ─────────────────────────────────────
  { id: 'canasta_1000_first', title: 'Canasta Suprema', description: '1ª canasta de 14 cartas (+1000)', icon: '💫', xpReward: 400,  category: 'canastas' },
  { id: 'canasta_1000_3',     title: 'Impiedoso',       description: '3 canastas de 14 cartas (+1000)', icon: '⚡', xpReward: 700,  category: 'canastas' },
  { id: 'canasta_1000_10',    title: 'O Escolhido',     description: '10 canastas de 14 cartas (+1000)',icon: '🌌', xpReward: 1200, category: 'canastas' },

  // ── PONTUAÇÃO ACUMULADA ────────────────────────────────────────────────────
  { id: 'points_10k',  title: 'Milionário',      description: 'Acumule 10.000 pontos',   icon: '💰', xpReward: 200,  category: 'score' },
  { id: 'points_50k',  title: 'Grande Pontuador',description: 'Acumule 50.000 pontos',   icon: '🤑', xpReward: 500,  category: 'score' },
  { id: 'points_100k', title: 'Lendário',        description: 'Acumule 100.000 pontos',  icon: '🏅', xpReward: 1000, category: 'score' },
  { id: 'points_250k', title: 'Deus do Buraco',  description: 'Acumule 250.000 pontos',  icon: '☄️', xpReward: 2000, category: 'score' },

  // ── PONTUAÇÃO POR RODADA ───────────────────────────────────────────────────
  { id: 'round_500',  title: 'Rodada Perfeita', description: 'Ganhe 500+ pontos em uma rodada',   icon: '🎆', xpReward: 150, category: 'score' },
  { id: 'round_1000', title: 'Explosão',        description: 'Ganhe 1.000+ pontos em uma rodada', icon: '🎇', xpReward: 300, category: 'score' },
  { id: 'round_1500', title: 'ULTRA',           description: 'Ganhe 1.500+ pontos em uma rodada', icon: '🔥', xpReward: 600, category: 'score' },

  // ── STREAK DIÁRIO ──────────────────────────────────────────────────────────
  { id: 'streak_3',   title: 'Dedicado',  description: '3 dias consecutivos',   icon: '🔆', xpReward: 100,  category: 'streak' },
  { id: 'streak_7',   title: 'Habitual',  description: '7 dias consecutivos',   icon: '📅', xpReward: 200,  category: 'streak' },
  { id: 'streak_30',  title: 'Fanático',  description: '30 dias consecutivos',  icon: '🗓️', xpReward: 500,  category: 'streak' },
  { id: 'streak_100', title: 'Obsessão',  description: '100 dias consecutivos', icon: '⚡', xpReward: 1500, category: 'streak' },

  // ── ESPECIAIS ──────────────────────────────────────────────────────────────
  { id: 'first_batida',  title: 'Bateu!',           description: 'Bata pela primeira vez',            icon: '🎴', xpReward: 50,  category: 'special' },
  { id: 'win_by_1000',   title: 'Esmagador',        description: 'Vença com 1.000+ de diferença',     icon: '💥', xpReward: 300, category: 'special' },
  { id: 'hard_wins_10',  title: 'Mestre do Difícil',description: '10 vitórias no nível Difícil',      icon: '🔴', xpReward: 500, category: 'special' },
  { id: 'win_streak_5',  title: 'Implacável',       description: '5 vitórias consecutivas',           icon: '⚡', xpReward: 400, category: 'special' },
];

// ── NÍVEIS ────────────────────────────────────────────────────────────────────
// 20 níveis; valor = XP mínimo para atingir o nível
export const LEVEL_THRESHOLDS = [
     0,    // 1
   300,    // 2
   700,    // 3
  1300,    // 4
  2100,    // 5
  3200,    // 6
  4600,    // 7
  6300,    // 8
  8400,    // 9
 11000,    // 10
 14200,    // 11
 18100,    // 12
 22700,    // 13
 28100,    // 14
 34500,    // 15
 42000,    // 16
 51000,    // 17
 61500,    // 18
 74000,    // 19
 88500,    // 20
];

export const RANKS = [
  'Novato',           // 1
  'Novato',           // 2
  'Curioso',          // 3
  'Curioso',          // 4
  'Aprendiz',         // 5
  'Aprendiz',         // 6
  'Jogador',          // 7
  'Jogador',          // 8
  'Experiente',       // 9
  'Experiente',       // 10
  'Veterano',         // 11
  'Veterano',         // 12
  'Veterano',         // 13
  'Especialista',     // 14
  'Especialista',     // 15
  'Especialista',     // 16
  'Mestre',           // 17
  'Mestre',           // 18
  'Grande Mestre',    // 19
  'Lenda do Buraco',  // 20
];

export function getLevelFromXP(xp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return Math.min(level, 20);
}

export function getRank(level: number): string {
  return RANKS[Math.min(level - 1, 19)];
}

export function getXPForNextLevel(level: number): number {
  if (level >= 20) return LEVEL_THRESHOLDS[19];
  return LEVEL_THRESHOLDS[level]; // threshold for level+1
}

export function getDailyRewardXP(streakDays: number): number {
  if (streakDays >= 30) return 500;
  if (streakDays >= 14) return 300;
  if (streakDays >= 7)  return 200;
  if (streakDays >= 3)  return 100;
  return 50;
}

// ── CHECK DE CONQUISTAS ───────────────────────────────────────────────────────
export interface CheckableStats {
  matchesWon: number;
  totalCleanCanastas: number;
  total500Canastas: number;
  total1000Canastas: number;
  totalPointsEarned: number;
  currentStreak: number;
  biggestRoundScore: number;
  biggestMatchDiff: number;
  hardWins: number;
  currentWinStreak: number;
  totalBatidas: number;
  totalCanastas: number;
}

export function checkNewAchievements(
  stats: CheckableStats,
  alreadyUnlocked: string[],
): string[] {
  const newlyUnlocked: string[] = [];

  const check = (id: string, condition: boolean) => {
    if (condition && !alreadyUnlocked.includes(id) && !newlyUnlocked.includes(id)) {
      newlyUnlocked.push(id);
    }
  };

  // Vitórias
  check('first_win',  stats.matchesWon >= 1);
  check('wins_10',    stats.matchesWon >= 10);
  check('wins_25',    stats.matchesWon >= 25);
  check('wins_50',    stats.matchesWon >= 50);
  check('wins_100',   stats.matchesWon >= 100);
  check('wins_200',   stats.matchesWon >= 200);

  // Canastas limpas (todas)
  check('first_canasta',      stats.totalCanastas >= 1);
  check('clean_canastas_10',  stats.totalCleanCanastas >= 10);
  check('clean_canastas_25',  stats.totalCleanCanastas >= 25);
  check('clean_canastas_50',  stats.totalCleanCanastas >= 50);
  check('clean_canastas_100', stats.totalCleanCanastas >= 100);

  // Canastas 500
  check('canasta_500_first', stats.total500Canastas >= 1);
  check('canasta_500_5',     stats.total500Canastas >= 5);
  check('canasta_500_15',    stats.total500Canastas >= 15);

  // Canastas 1000
  check('canasta_1000_first', stats.total1000Canastas >= 1);
  check('canasta_1000_3',     stats.total1000Canastas >= 3);
  check('canasta_1000_10',    stats.total1000Canastas >= 10);

  // Pontuação acumulada
  check('points_10k',  stats.totalPointsEarned >= 10000);
  check('points_50k',  stats.totalPointsEarned >= 50000);
  check('points_100k', stats.totalPointsEarned >= 100000);
  check('points_250k', stats.totalPointsEarned >= 250000);

  // Rodada especial
  check('round_500',  stats.biggestRoundScore >= 500);
  check('round_1000', stats.biggestRoundScore >= 1000);
  check('round_1500', stats.biggestRoundScore >= 1500);

  // Streak
  check('streak_3',   stats.currentStreak >= 3);
  check('streak_7',   stats.currentStreak >= 7);
  check('streak_30',  stats.currentStreak >= 30);
  check('streak_100', stats.currentStreak >= 100);

  // Especiais
  check('first_batida', stats.totalBatidas >= 1);
  check('win_by_1000',  stats.biggestMatchDiff >= 1000);
  check('hard_wins_10', stats.hardWins >= 10);
  check('win_streak_5', stats.currentWinStreak >= 5);

  return newlyUnlocked;
}

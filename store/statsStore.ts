import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  ACHIEVEMENTS,
  CheckableStats,
  checkNewAchievements,
  getDailyRewardXP,
  getLevelFromXP,
} from '../game/achievements';
import { BotDifficulty } from '../game/engine';

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ── Dados enviados quando uma rodada termina ────────────────────────────────
export interface RoundEndData {
  matchEnded: boolean;       // partida terminou (alguém atingiu a meta)
  matchWon: boolean;         // time-1 venceu a partida
  myRoundScore: number;      // pontuação líquida do time-1 nesta rodada
  myMatchScore: number;      // placar acumulado do time-1 na partida
  theirMatchScore: number;   // placar acumulado do time-2 na partida
  cleanCanastas: number;     // canastas limpas 7-12 cartas (+200)
  dirtyCanastas: number;     // canastas sujas
  canastas500: number;       // canastas limpas de 13 cartas (+500)
  canastas1000: number;      // canastas limpas de 14 cartas (+1000)
  userBated: boolean;        // o jogador 'user' bateu
  difficulty: BotDifficulty;
}

export interface DailyRewardInfo {
  available: boolean;
  xp: number;
  streakDays: number; // streak que ficará após resgatar
}

// ── Estado ──────────────────────────────────────────────────────────────────
interface StatsState {
  playerId: string; // UUID — pronto para online

  // XP / Nível
  totalXP: number;
  level: number;

  // Partidas
  matchesPlayed: number;
  matchesWon: number;
  roundsPlayed: number;

  // Pontuação
  totalPointsEarned: number; // soma dos round scores positivos
  biggestRoundScore: number;
  biggestMatchDiff: number;  // maior margem de vitória numa partida

  // Canastas
  totalCanastas: number;
  totalCleanCanastas: number; // todas as limpas (inclui 500 e 1000)
  total500Canastas: number;
  total1000Canastas: number;
  totalDirtyCanastas: number;
  totalBatidas: number;

  // Streaks de vitória
  currentWinStreak: number;
  longestWinStreak: number;
  hardWins: number;

  // Streak diário
  currentStreak: number;
  longestStreak: number;
  lastDailyRewardDate: string; // YYYY-MM-DD

  // Conquistas
  unlockedAchievements: string[];
  newlyUnlocked: string[]; // fila de conquistas para mostrar como toast
}

interface StatsActions {
  recordRound: (data: RoundEndData) => void;
  checkDailyReward: () => DailyRewardInfo;
  claimDailyReward: () => void;
  shiftNewlyUnlocked: () => void;
}

const INITIAL: Omit<StatsState, 'playerId'> = {
  totalXP: 0,
  level: 1,
  matchesPlayed: 0,
  matchesWon: 0,
  roundsPlayed: 0,
  totalPointsEarned: 0,
  biggestRoundScore: 0,
  biggestMatchDiff: 0,
  totalCanastas: 0,
  totalCleanCanastas: 0,
  total500Canastas: 0,
  total1000Canastas: 0,
  totalDirtyCanastas: 0,
  totalBatidas: 0,
  currentWinStreak: 0,
  longestWinStreak: 0,
  hardWins: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastDailyRewardDate: '',
  unlockedAchievements: [],
  newlyUnlocked: [],
};

// ── Store ────────────────────────────────────────────────────────────────────
export const useStatsStore = create<StatsState & StatsActions>()(
  persist(
    (set, get) => ({
      playerId: generateId(),
      ...INITIAL,

      recordRound: (data: RoundEndData) => {
        const s = get();
        let xp = 0;

        // XP por canastas desta rodada
        xp += data.cleanCanastas * 30;
        xp += data.canastas500 * 50;
        xp += data.canastas1000 * 100;
        xp += data.dirtyCanastas * 10;
        if (data.userBated) xp += 20;

        // Canastas acumuladas
        const totalCleanCanastas =
          s.totalCleanCanastas + data.cleanCanastas + data.canastas500 + data.canastas1000;
        const total500Canastas = s.total500Canastas + data.canastas500;
        const total1000Canastas = s.total1000Canastas + data.canastas1000;
        const totalDirtyCanastas = s.totalDirtyCanastas + data.dirtyCanastas;
        const totalCanastas = totalCleanCanastas + totalDirtyCanastas;
        const totalBatidas = s.totalBatidas + (data.userBated ? 1 : 0);

        // Pontuação
        const totalPointsEarned = s.totalPointsEarned + Math.max(0, data.myRoundScore);
        const biggestRoundScore = Math.max(s.biggestRoundScore, data.myRoundScore);

        // Rodadas
        const roundsPlayed = s.roundsPlayed + 1;

        // Partidas (só quando a partida termina)
        let { matchesPlayed, matchesWon, currentWinStreak, longestWinStreak, hardWins, biggestMatchDiff } = s;

        if (data.matchEnded) {
          matchesPlayed++;
          if (data.matchWon) {
            matchesWon++;
            currentWinStreak++;
            longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
            if (data.difficulty === 'hard') hardWins++;
            const diff = Math.abs(data.myMatchScore - data.theirMatchScore);
            biggestMatchDiff = Math.max(biggestMatchDiff, diff);
            xp += 150;
          } else {
            currentWinStreak = 0;
            xp += 30;
          }
        }

        // Checar conquistas
        const checkStats: CheckableStats = {
          matchesWon,
          totalCleanCanastas,
          total500Canastas,
          total1000Canastas,
          totalPointsEarned,
          currentStreak: s.currentStreak,
          biggestRoundScore,
          biggestMatchDiff,
          hardWins,
          currentWinStreak,
          totalBatidas,
          totalCanastas,
        };

        const newAchievements = checkNewAchievements(checkStats, s.unlockedAchievements);
        let achXP = 0;
        newAchievements.forEach((id) => {
          const a = ACHIEVEMENTS.find((a) => a.id === id);
          if (a) achXP += a.xpReward;
        });

        const finalXP = s.totalXP + xp + achXP;
        const finalLevel = getLevelFromXP(finalXP);

        set({
          totalXP: finalXP,
          level: finalLevel,
          matchesPlayed,
          matchesWon,
          roundsPlayed,
          totalPointsEarned,
          biggestRoundScore,
          biggestMatchDiff,
          totalCanastas,
          totalCleanCanastas,
          total500Canastas,
          total1000Canastas,
          totalDirtyCanastas,
          totalBatidas,
          currentWinStreak,
          longestWinStreak,
          hardWins,
          unlockedAchievements: [...s.unlockedAchievements, ...newAchievements],
          newlyUnlocked: [...s.newlyUnlocked, ...newAchievements],
        });
      },

      checkDailyReward: (): DailyRewardInfo => {
        const s = get();
        const today = todayISO();
        if (s.lastDailyRewardDate === today) {
          return { available: false, xp: 0, streakDays: s.currentStreak };
        }
        // Qual seria o streak após resgatar
        let newStreak = 1;
        if (s.lastDailyRewardDate === yesterdayISO()) newStreak = s.currentStreak + 1;
        const xp = getDailyRewardXP(newStreak);
        return { available: true, xp, streakDays: newStreak };
      },

      claimDailyReward: () => {
        const s = get();
        const today = todayISO();
        if (s.lastDailyRewardDate === today) return;

        let newStreak = 1;
        if (s.lastDailyRewardDate === yesterdayISO()) newStreak = s.currentStreak + 1;
        const longestStreak = Math.max(s.longestStreak, newStreak);

        const xp = getDailyRewardXP(newStreak);

        // Checar conquistas de streak
        const checkStats: CheckableStats = {
          matchesWon: s.matchesWon,
          totalCleanCanastas: s.totalCleanCanastas,
          total500Canastas: s.total500Canastas,
          total1000Canastas: s.total1000Canastas,
          totalPointsEarned: s.totalPointsEarned,
          currentStreak: newStreak,
          biggestRoundScore: s.biggestRoundScore,
          biggestMatchDiff: s.biggestMatchDiff,
          hardWins: s.hardWins,
          currentWinStreak: s.currentWinStreak,
          totalBatidas: s.totalBatidas,
          totalCanastas: s.totalCanastas,
        };

        const newAchievements = checkNewAchievements(checkStats, s.unlockedAchievements);
        let achXP = 0;
        newAchievements.forEach((id) => {
          const a = ACHIEVEMENTS.find((a) => a.id === id);
          if (a) achXP += a.xpReward;
        });

        const finalXP = s.totalXP + xp + achXP;
        const finalLevel = getLevelFromXP(finalXP);

        set({
          totalXP: finalXP,
          level: finalLevel,
          currentStreak: newStreak,
          longestStreak,
          lastDailyRewardDate: today,
          unlockedAchievements: [...s.unlockedAchievements, ...newAchievements],
          newlyUnlocked: [...s.newlyUnlocked, ...newAchievements],
        });
      },

      shiftNewlyUnlocked: () => {
        const s = get();
        if (s.newlyUnlocked.length === 0) return;
        set({ newlyUnlocked: s.newlyUnlocked.slice(1) });
      },
    }),
    {
      name: 'buraco-stats-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

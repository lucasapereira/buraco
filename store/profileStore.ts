/**
 * profileStore — perfil online do jogador no Firebase.
 *
 * - Reserva única de username (transação atômica em /usernames/{nameLower})
 * - Espelha o estado local (statsStore) em /users/{uid}
 * - Lê todos os perfis para a tela de ranking
 * - Permite trocar de nome com cooldown de 30 dias
 *
 * O fluxo é "client-side optimista": cada cliente escreve no próprio /users/{auth.uid}.
 * Não há anti-cheat — é app de família.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  get as dbGet,
  ref,
  remove,
  runTransaction,
  set as dbSet,
  update,
} from 'firebase/database';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { auth, db } from '../config/firebase';
import { useStatsStore, RecentMatch } from './statsStore';

const NAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export interface MonthlyChampion {
  month: string; // YYYY-MM
  uid: string;
  displayName: string;
  rating: number;
  matches: number;
  awardedAt: number;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonthKey(ref: string): string {
  const [y, m] = ref.split('-').map(n => parseInt(n, 10));
  const pm = m - 1;
  return pm === 0 ? `${y - 1}-12` : `${y}-${String(pm).padStart(2, '0')}`;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  displayNameLower: string;
  joinedAt: number;
  lastSeen: number;
  lastNameChangeAt?: number;

  level: number;
  totalXP: number;
  matchesPlayed: number;
  matchesWon: number;
  totalCanastas: number;
  totalCleanCanastas: number;
  total500Canastas: number;
  total1000Canastas: number;
  totalDirtyCanastas: number;
  totalBatidas: number;
  biggestRoundScore: number;
  biggestMatchDiff: number;
  totalPointsEarned: number;
  longestStreak: number;
  longestWinStreak: number;

  botMatchesPlayed: number;
  botMatchesWon: number;
  currentBotWinStreak: number;
  longestBotWinStreak: number;
  hardWins: number;

  onlineMatchesPlayed: number;
  onlineMatchesWon: number;
  onlineRating: number;

  unlockedAchievements: string[];
  recentMatches: RecentMatch[];
}

interface ProfileState {
  myUid: string | null;
  myUsername: string | null;       // forma exibível (case original)
  myUsernameLower: string | null;  // chave canônica
  joinedAt: number | null;
  lastNameChangeAt: number | null;
  migratedFromLocal: boolean;
  isClaiming: boolean;
  claimError: string | null;
}

interface ProfileActions {
  /** Reserva atomicamente o username. Lança erro se já estiver em uso por outro UID. */
  claimUsername: (rawName: string) => Promise<void>;
  /** Troca o nome (libera o slot antigo + reserva o novo). Respeita cooldown de 30 dias. */
  changeUsername: (rawName: string) => Promise<void>;
  /** Empurra o snapshot atual do statsStore para /users/{uid}. */
  syncProfileToFirebase: () => Promise<void>;
  /** Carrega TODOS os perfis (ranking). Retorna em ordem arbitrária — caller ordena. */
  loadAllProfiles: () => Promise<UserProfile[]>;
  /** Lê um perfil específico. */
  loadProfile: (uid: string) => Promise<UserProfile | null>;
  /** Importa stats locais para o perfil online (idempotente). */
  migrateLocalStatsIfNeeded: () => Promise<void>;
  /** Lê campeões mensais (passados). */
  loadMonthlyChampions: () => Promise<MonthlyChampion[]>;
  /** Finaliza mês(es) anterior(es): se ninguém ainda gravou o campeão, computa do snapshot atual. */
  finalizePastMonthlyChampions: () => Promise<void>;
  /** Reseta o estado local (não toca no Firebase). */
  resetProfile: () => void;
}

const PROFILE_DEFAULTS = {
  myUid: null,
  myUsername: null,
  myUsernameLower: null,
  joinedAt: null,
  lastNameChangeAt: null,
  migratedFromLocal: false,
  isClaiming: false,
  claimError: null,
};

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '');
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'Nome muito curto (mínimo 2 letras)';
  if (trimmed.length > 16) return 'Nome muito longo (máx 16)';
  if (!/^[\p{L}0-9 _-]+$/u.test(trimmed)) return 'Use apenas letras, números, espaço, _ ou -';
  return null;
}

function snapshotStatsForFirebase(uid: string, displayName: string, displayNameLower: string, joinedAt: number, lastNameChangeAt: number | null): Omit<UserProfile, never> {
  const s = useStatsStore.getState();
  return {
    uid,
    displayName,
    displayNameLower,
    joinedAt,
    lastSeen: Date.now(),
    ...(lastNameChangeAt ? { lastNameChangeAt } : {}),
    level: s.level,
    totalXP: s.totalXP,
    matchesPlayed: s.matchesPlayed,
    matchesWon: s.matchesWon,
    totalCanastas: s.totalCanastas,
    totalCleanCanastas: s.totalCleanCanastas,
    total500Canastas: s.total500Canastas,
    total1000Canastas: s.total1000Canastas,
    totalDirtyCanastas: s.totalDirtyCanastas,
    totalBatidas: s.totalBatidas,
    biggestRoundScore: s.biggestRoundScore,
    biggestMatchDiff: s.biggestMatchDiff,
    totalPointsEarned: s.totalPointsEarned,
    longestStreak: s.longestStreak,
    longestWinStreak: s.longestWinStreak,
    botMatchesPlayed: s.botMatchesPlayed,
    botMatchesWon: s.botMatchesWon,
    currentBotWinStreak: s.currentBotWinStreak,
    longestBotWinStreak: s.longestBotWinStreak,
    hardWins: s.hardWins,
    onlineMatchesPlayed: s.onlineMatchesPlayed,
    onlineMatchesWon: s.onlineMatchesWon,
    onlineRating: s.onlineRating,
    unlockedAchievements: s.unlockedAchievements,
    recentMatches: s.recentMatches,
  };
}

export const useProfileStore = create<ProfileState & ProfileActions>()(
  persist(
    (set, get) => ({
      ...PROFILE_DEFAULTS,

      claimUsername: async (rawName) => {
        const validationError = validateName(rawName);
        if (validationError) { set({ claimError: validationError }); throw new Error(validationError); }

        const uid = auth.currentUser?.uid;
        if (!uid) { set({ claimError: 'Sem autenticação' }); throw new Error('Sem autenticação'); }

        const display = rawName.trim();
        const lower = normalize(display);
        set({ isClaiming: true, claimError: null });

        try {
          // Tenta reservar o slot. Se outro UID já tem, abortamos.
          const result = await runTransaction(ref(db, `usernames/${lower}`), (current) => {
            if (current === null) return { uid };
            if (current.uid === uid) return current; // idempotente
            return undefined; // abort — taken
          });
          if (!result.committed) {
            const err = 'Esse nome já está em uso. Escolha outro.';
            set({ claimError: err, isClaiming: false });
            throw new Error(err);
          }

          const now = Date.now();
          const joinedAt = get().joinedAt ?? now;
          const profile = snapshotStatsForFirebase(uid, display, lower, joinedAt, null);
          // JSON round-trip remove undefined (Firebase rejeita)
          await dbSet(ref(db, `users/${uid}`), JSON.parse(JSON.stringify(profile)));

          set({
            myUid: uid,
            myUsername: display,
            myUsernameLower: lower,
            joinedAt,
            isClaiming: false,
            claimError: null,
          });
        } catch (e: any) {
          if (!get().claimError) set({ claimError: e?.message ?? 'Erro ao reservar nome', isClaiming: false });
          set({ isClaiming: false });
          throw e;
        }
      },

      changeUsername: async (rawName) => {
        const validationError = validateName(rawName);
        if (validationError) { set({ claimError: validationError }); throw new Error(validationError); }

        const { myUid, myUsernameLower, lastNameChangeAt } = get();
        if (!myUid || !myUsernameLower) {
          // Sem nome ainda — vira claim
          return get().claimUsername(rawName);
        }

        if (lastNameChangeAt && Date.now() - lastNameChangeAt < NAME_CHANGE_COOLDOWN_MS) {
          const restMs = NAME_CHANGE_COOLDOWN_MS - (Date.now() - lastNameChangeAt);
          const restDays = Math.ceil(restMs / (24 * 60 * 60 * 1000));
          const err = `Você só pode trocar de nome 1x por mês. Falta ${restDays} dia(s).`;
          set({ claimError: err });
          throw new Error(err);
        }

        const display = rawName.trim();
        const lower = normalize(display);
        if (lower === myUsernameLower) return; // sem mudança

        set({ isClaiming: true, claimError: null });
        try {
          // Reserva o novo PRIMEIRO; se falhar, mantém o velho intacto.
          const result = await runTransaction(ref(db, `usernames/${lower}`), (current) => {
            if (current === null) return { uid: myUid };
            if (current.uid === myUid) return current;
            return undefined;
          });
          if (!result.committed) {
            const err = 'Esse nome já está em uso. Escolha outro.';
            set({ claimError: err, isClaiming: false });
            throw new Error(err);
          }

          // Libera o slot antigo e atualiza o perfil
          await Promise.all([
            remove(ref(db, `usernames/${myUsernameLower}`)).catch(() => {}),
            update(ref(db, `users/${myUid}`), {
              displayName: display,
              displayNameLower: lower,
              lastNameChangeAt: Date.now(),
              lastSeen: Date.now(),
            }),
          ]);

          set({
            myUsername: display,
            myUsernameLower: lower,
            lastNameChangeAt: Date.now(),
            isClaiming: false,
            claimError: null,
          });
        } catch (e: any) {
          set({ isClaiming: false });
          throw e;
        }
      },

      syncProfileToFirebase: async () => {
        const { myUid, myUsername, myUsernameLower, joinedAt, lastNameChangeAt } = get();
        if (!myUid || !myUsername || !myUsernameLower) return;
        try {
          const profile = snapshotStatsForFirebase(
            myUid,
            myUsername,
            myUsernameLower,
            joinedAt ?? Date.now(),
            lastNameChangeAt,
          );
          // JSON round-trip remove undefined (Firebase rejeita)
          await dbSet(ref(db, `users/${myUid}`), JSON.parse(JSON.stringify(profile)));
        } catch (_) {
          // Falha silenciosa — próxima rodada tenta de novo
        }
      },

      loadAllProfiles: async () => {
        try {
          const snap = await dbGet(ref(db, 'users'));
          if (!snap.exists()) return [];
          const profiles: UserProfile[] = [];
          snap.forEach((child) => {
            const v = child.val();
            if (v && v.displayName) profiles.push(v as UserProfile);
          });
          return profiles;
        } catch (_) {
          return [];
        }
      },

      loadProfile: async (uid: string) => {
        try {
          const snap = await dbGet(ref(db, `users/${uid}`));
          if (!snap.exists()) return null;
          return snap.val() as UserProfile;
        } catch (_) {
          return null;
        }
      },

      loadMonthlyChampions: async () => {
        try {
          const snap = await dbGet(ref(db, 'monthlyChampions'));
          if (!snap.exists()) return [];
          const list: MonthlyChampion[] = [];
          snap.forEach(child => {
            const v = child.val();
            if (v && v.uid) list.push({ ...v, month: child.key as string });
          });
          return list.sort((a, b) => (a.month < b.month ? 1 : -1));
        } catch (_) {
          return [];
        }
      },

      finalizePastMonthlyChampions: async () => {
        try {
          const current = currentMonthKey();
          // Varre o último mês. Transação garante que só o primeiro a tentar
          // escreve — os demais abortam. Sem histórico: só 1 mês pra trás por chamada.
          const target = prevMonthKey(current);
          const champRef = ref(db, `monthlyChampions/${target}`);
          const existing = await dbGet(champRef);
          if (existing.exists()) return;

          // Precisa de pelo menos 1 partida online no snapshot atual
          const usersSnap = await dbGet(ref(db, 'users'));
          if (!usersSnap.exists()) return;
          let winner: UserProfile | null = null;
          usersSnap.forEach(child => {
            const p = child.val() as UserProfile;
            if (!p || (p.onlineMatchesPlayed ?? 0) === 0) return;
            if (!winner) { winner = p; return; }
            const wRating = winner.onlineRating ?? 1000;
            const pRating = p.onlineRating ?? 1000;
            if (pRating > wRating) winner = p;
            else if (pRating === wRating && (p.onlineMatchesWon ?? 0) > (winner.onlineMatchesWon ?? 0)) winner = p;
          });
          if (!winner) return;

          const payload: Omit<MonthlyChampion, 'month'> = {
            uid: (winner as UserProfile).uid,
            displayName: (winner as UserProfile).displayName,
            rating: Math.round((winner as UserProfile).onlineRating ?? 1000),
            matches: (winner as UserProfile).onlineMatchesPlayed ?? 0,
            awardedAt: Date.now(),
          };
          const tx = await runTransaction(champRef, (cur) => {
            if (cur !== null) return cur; // alguém já gravou
            return payload;
          });
          if (!tx.committed) return;
        } catch (_) {
          // silencioso
        }
      },

      migrateLocalStatsIfNeeded: async () => {
        const { myUid, migratedFromLocal } = get();
        if (!myUid || migratedFromLocal) return;
        // O snapshot já incorpora o estado local — basta marcar migrado e empurrar.
        await get().syncProfileToFirebase();
        set({ migratedFromLocal: true });
      },

      resetProfile: () => set(PROFILE_DEFAULTS),
    }),
    {
      name: 'buraco-profile-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        myUid: s.myUid,
        myUsername: s.myUsername,
        myUsernameLower: s.myUsernameLower,
        joinedAt: s.joinedAt,
        lastNameChangeAt: s.lastNameChangeAt,
        migratedFromLocal: s.migratedFromLocal,
      }),
    },
  ),
);

// ── Auto-sync: empurra perfil pro Firebase quando stats locais mudam ──────
// Disparado depois de cada recordRound; debounce de 1s pra evitar burst.
let syncTimer: ReturnType<typeof setTimeout> | null = null;
useStatsStore.subscribe((state, prev) => {
  if (state === prev) return;
  const { myUid } = useProfileStore.getState();
  if (!myUid) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    useProfileStore.getState().syncProfileToFirebase();
  }, 1000);
});

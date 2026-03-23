import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInAnonymously, updateProfile } from 'firebase/auth';
import { equalTo, get as dbGet, onValue, ref, remove, set as dbSet, update, query, orderByChild, endAt } from 'firebase/database';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { auth, db } from '../config/firebase';
import { BotDifficulty, GameMode } from '../game/engine';

// ── Constantes ────────────────────────────────────────────────────────────────
export const SEAT_PLAYER_IDS = ['user', 'bot-1', 'bot-2', 'bot-3'] as const;
export type SeatPlayerId = typeof SEAT_PLAYER_IDS[number];

export const TEAM_OF_SEAT: Record<number, 'team-1' | 'team-2'> = {
  0: 'team-1', // user
  1: 'team-2', // bot-1
  2: 'team-1', // bot-2 (parceiro)
  3: 'team-2', // bot-3
};

export interface SeatInfo {
  uid: string;
  name: string;
}

export interface PublicRoomInfo {
  code: string;
  mode: GameMode;
  targetScore: number;
  playerCount: number;
  createdAt: number;
}

// Gera código de sala: 4 letras maiúsculas + 2 dígitos (ex: "BURA42")
function generateRoomCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  code += String(Math.floor(10 + Math.random() * 90));
  return code;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface OnlineState {
  // Auth (persistido)
  uid: string | null;
  displayName: string;

  // Sala (não persistido — recriado ao entrar na sala)
  roomCode: string | null;
  roomStatus: 'idle' | 'lobby' | 'playing' | 'finished';
  isHost: boolean;
  mySeat: number | null;             // 0-3
  seats: (SeatInfo | null)[];        // [seat0, seat1, seat2, seat3]

  // Configurações da sala (definidas pelo host)
  roomMode: GameMode;
  roomTarget: number;
  roomDifficulty: BotDifficulty;

  error: string | null;
  isLoading: boolean;
}

interface OnlineActions {
  // Configuração
  setDisplayName: (name: string) => void;
  setRoomSettings: (mode: GameMode, target: number, difficulty: BotDifficulty) => void;
  setError: (e: string | null) => void;

  // Auth
  ensureAuth: () => Promise<string>; // retorna uid

  // Sala
  createRoom: (isPublic: boolean) => Promise<string>; // retorna código da sala
  joinRoom: (code: string) => Promise<void>;
  fetchPublicRooms: () => Promise<PublicRoomInfo[]>;
  leaveRoom: () => Promise<void>;
  startGame: (initialGameState: object) => Promise<void>; // host inicia o jogo

  // Chamado pelo hook de sincronização ao receber dados do Firebase
  applyRoomSnapshot: (snap: {
    status: string;
    seats: (SeatInfo | null)[];
    mode: GameMode;
    target: number;
    difficulty: BotDifficulty;
  }) => void;

  resetRoom: () => void;
}

const ROOM_DEFAULTS = {
  roomCode: null,
  roomStatus: 'idle' as const,
  isHost: false,
  mySeat: null,
  seats: [null, null, null, null],
  error: null,
  isLoading: false,
};

// ── Store ─────────────────────────────────────────────────────────────────────
export const useOnlineStore = create<OnlineState & OnlineActions>()(
  persist(
    (set, get) => ({
      uid: null,
      displayName: '',
      roomMode: 'classic',
      roomTarget: 1500,
      roomDifficulty: 'hard',
      ...ROOM_DEFAULTS,

      setDisplayName: (name) => set({ displayName: name.trim() }),

      setRoomSettings: (mode, target, difficulty) =>
        set({ roomMode: mode, roomTarget: target, roomDifficulty: difficulty }),

      setError: (error) => set({ error }),

      ensureAuth: async () => {
        const state = get();
        // Verifica se já tem UID válido no Firebase auth
        if (auth.currentUser) {
          if (!state.uid) set({ uid: auth.currentUser.uid });
          return auth.currentUser.uid;
        }
        // Faz login anônimo
        const cred = await signInAnonymously(auth);
        const uid = cred.user.uid;
        const displayName = state.displayName || `Jogador`;
        await updateProfile(cred.user, { displayName });
        set({ uid });
        return uid;
      },

      createRoom: async (isPublic: boolean) => {
        set({ isLoading: true, error: null });
        try {
          const uid = await get().ensureAuth();
          const { displayName, roomMode, roomTarget, roomDifficulty } = get();
          const code = generateRoomCode();

          // Limpa salas com mais de 24h (best-effort, não bloqueia criação)
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          dbGet(query(ref(db, 'rooms'), orderByChild('meta/createdAt'), endAt(cutoff)))
            .then(snap => {
              snap.forEach(child => { remove(child.ref).catch(() => {}); });
            }).catch(() => {});

          await dbSet(ref(db, `rooms/${code}`), {
            meta: {
              status: 'lobby',
              hostUid: uid,
              mode: roomMode,
              targetScore: roomTarget,
              difficulty: roomDifficulty,
              isPublic,
              createdAt: Date.now(),
            },
            seats: {
              0: { uid, name: displayName || 'Host' },
              1: null,
              2: null,
              3: null,
            },
            gameState: null,
          });

          set({
            roomCode: code,
            roomStatus: 'lobby',
            isHost: true,
            mySeat: 0,
            seats: [{ uid, name: displayName || 'Host' }, null, null, null],
            isLoading: false,
          });

          return code;
        } catch (e: any) {
          set({ error: e.message ?? 'Erro ao criar sala', isLoading: false });
          throw e;
        }
      },

      joinRoom: async (code: string) => {
        set({ isLoading: true, error: null });
        try {
          const uid = await get().ensureAuth();
          const { displayName } = get();
          const upperCode = code.toUpperCase().trim();

          const snapshot = await dbGet(ref(db, `rooms/${upperCode}`));
          if (!snapshot.exists()) throw new Error('Sala não encontrada');

          const room = snapshot.val();
          if (room.meta.status !== 'lobby') throw new Error('Este jogo já começou');

          // Encontra o primeiro assento livre
          const seats: (SeatInfo | null)[] = [0, 1, 2, 3].map(i => room.seats?.[i] ?? null);
          const freeSeat = seats.findIndex(s => s === null);
          if (freeSeat === -1) throw new Error('Sala cheia (4/4)');

          await update(ref(db, `rooms/${upperCode}/seats`), {
            [freeSeat]: { uid, name: displayName || 'Jogador' },
          });

          const updatedSeats = [...seats];
          updatedSeats[freeSeat] = { uid, name: displayName || 'Jogador' };

          set({
            roomCode: upperCode,
            roomStatus: 'lobby',
            isHost: false,
            mySeat: freeSeat,
            seats: updatedSeats,
            roomMode: room.meta.mode,
            roomTarget: room.meta.targetScore,
            roomDifficulty: room.meta.difficulty,
            isLoading: false,
          });
        } catch (e: any) {
          set({ error: e.message ?? 'Erro ao entrar na sala', isLoading: false });
          throw e;
        }
      },

      leaveRoom: async () => {
        const { roomCode, mySeat, isHost } = get();
        if (!roomCode) return;
        try {
          if (isHost) {
            // Host sai → remove a sala toda
            await remove(ref(db, `rooms/${roomCode}`));
          } else if (mySeat !== null) {
            await dbSet(ref(db, `rooms/${roomCode}/seats/${mySeat}`), null);
          }
        } catch (_) {}
        get().resetRoom();
      },

      startGame: async (initialGameState: object) => {
        const { roomCode, roomMode, roomTarget, roomDifficulty } = get();
        if (!roomCode) return;
        try {
          const uid = auth.currentUser?.uid;
          const cleanState = JSON.parse(JSON.stringify({ ...initialGameState, _writerUid: uid }));
          await update(ref(db, `rooms/${roomCode}`), {
            'meta/status': 'playing',
            gameState: cleanState,
          });
          set({ roomStatus: 'playing' });
        } catch (e: any) {
          set({ error: e.message ?? 'Erro ao iniciar jogo' });
        }
      },

      fetchPublicRooms: async () => {
        try {
          const snap = await dbGet(query(ref(db, 'rooms'), orderByChild('meta/isPublic'), equalTo(true)));
          if (!snap.exists()) return [];
          const rooms: PublicRoomInfo[] = [];
          snap.forEach(child => {
            const val = child.val();
            if (!val?.meta || val.meta.status !== 'lobby') return;
            const seats: (SeatInfo | null)[] = [0, 1, 2, 3].map(i => val.seats?.[i] ?? null);
            rooms.push({
              code: child.key as string,
              mode: val.meta.mode,
              targetScore: val.meta.targetScore,
              playerCount: seats.filter(Boolean).length,
              createdAt: val.meta.createdAt,
            });
          });
          return rooms.sort((a, b) => b.createdAt - a.createdAt);
        } catch {
          return [];
        }
      },

      applyRoomSnapshot: (snap) => {
        set({
          roomStatus: snap.status as any,
          seats: snap.seats,
          roomMode: snap.mode,
          roomTarget: snap.target,
          roomDifficulty: snap.difficulty,
        });
      },

      resetRoom: () => set(ROOM_DEFAULTS),
    }),
    {
      name: 'buraco-online-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Persiste só auth; sala é transiente
      partialize: (s) => ({ uid: s.uid, displayName: s.displayName }),
    },
  ),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInAnonymously, updateProfile } from 'firebase/auth';
import { get as dbGet, onDisconnect, onValue, ref, remove, set as dbSet, update, query, orderByChild, endAt } from 'firebase/database';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { auth, db } from '../config/firebase';
import { GameMode } from '../game/engine';

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

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

// Sweep de 24h em rooms/ E publicRooms/. Best-effort (não bloqueia caller).
// Por que client-side em publicRooms: evita exigir .indexOn na regra do Firebase
// e o índice é pequeno (sempre <100 entradas mesmo com vazamento).
function cleanupOldRooms(): void {
  const cutoff = Date.now() - ROOM_TTL_MS;
  dbGet(query(ref(db, 'rooms'), orderByChild('meta/createdAt'), endAt(cutoff)))
    .then(snap => { snap.forEach(child => { remove(child.ref).catch(() => {}); }); })
    .catch(() => {});
  dbGet(ref(db, 'publicRooms'))
    .then(snap => {
      snap.forEach(child => {
        const val = child.val();
        if (val?.createdAt && val.createdAt < cutoff) {
          remove(child.ref).catch(() => {});
        }
      });
    })
    .catch(() => {});
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface OnlineState {
  // Auth (persistido)
  uid: string | null;
  displayName: string;

  // Sala (não persistido — recriado ao entrar na sala)
  roomCode: string | null;
  roomStatus: 'idle' | 'lobby' | 'playing' | 'finished' | 'abandoned';
  isHost: boolean;
  mySeat: number | null;             // 0-3
  seats: (SeatInfo | null)[];        // [seat0, seat1, seat2, seat3]

  // Configurações da sala (definidas pelo host)
  roomMode: GameMode;
  roomTarget: number;
  roomIsPublic: boolean;

  // Malhação (zoeira) — 1 mensagem ativa por assento, auto-expira em 4s
  taunts: Record<number, TauntEntry | undefined>;

  error: string | null;
  isLoading: boolean;
}

export interface TauntEntry {
  msg: string;
  ts: number;
  id: string; // muda a cada envio — permite detectar nova mensagem mesmo com texto repetido
}

interface OnlineActions {
  // Configuração
  setDisplayName: (name: string) => void;
  setRoomSettings: (mode: GameMode, target: number) => void;
  setError: (e: string | null) => void;

  // Auth
  ensureAuth: () => Promise<string>; // retorna uid

  // Sala
  createRoom: (isPublic: boolean) => Promise<string>; // retorna código da sala
  joinRoom: (code: string) => Promise<void>;
  fetchPublicRooms: () => Promise<PublicRoomInfo[]>;
  leaveRoom: () => Promise<void>;
  switchSeat: (seatIdx: number) => Promise<void>;
  startGame: (initialGameState: object) => Promise<void>; // host inicia o jogo
  rematch: (initialGameState: object) => Promise<void>; // host inicia revanche com mesmos jogadores

  // Chamado pelo hook de sincronização ao receber dados do Firebase
  applyRoomSnapshot: (snap: {
    status: string;
    seats: (SeatInfo | null)[];
    mode: GameMode;
    target: number;
  }) => void;

  // Malhação
  sendTaunt: (msg: string) => Promise<void>;
  applyTauntsSnapshot: (taunts: Record<number, TauntEntry | undefined>) => void;

  resetRoom: () => void;
}

const ROOM_DEFAULTS = {
  roomCode: null,
  roomStatus: 'idle' as const,
  isHost: false,
  mySeat: null,
  seats: [null, null, null, null],
  taunts: {} as Record<number, TauntEntry | undefined>,
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
      roomIsPublic: true,
      ...ROOM_DEFAULTS,

      setDisplayName: (name) => set({ displayName: name.trim() }),

      setRoomSettings: (mode, target) =>
        set({ roomMode: mode, roomTarget: target }),

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
          const { displayName, roomMode, roomTarget } = get();
          const code = generateRoomCode();

          // Limpa salas/índices com mais de 24h (best-effort, não bloqueia criação)
          cleanupOldRooms();

          const now = Date.now();
          await dbSet(ref(db, `rooms/${code}`), {
            meta: {
              status: 'lobby',
              hostUid: uid,
              mode: roomMode,
              targetScore: roomTarget,
              isPublic,
              createdAt: now,
            },
            seats: {
              0: { uid, name: displayName || 'Host' },
              1: null,
              2: null,
              3: null,
            },
            gameState: null,
          });

          // Nota: NÃO removemos sala via onDisconnect — o Firebase detecta
          // disconnect agressivamente (ir pro WhatsApp e voltar já dispara),
          // então salas sumiam enquanto o host só compartilhava o código.
          // Cleanup fica por conta de leaveRoom explícito e do TTL sweep (24h).

          // Índice de salas públicas (caminho separado com regras permissivas)
          if (isPublic) {
            await dbSet(ref(db, `publicRooms/${code}`), {
              mode: roomMode,
              targetScore: roomTarget,
              playerCount: 1,
              createdAt: now,
            });
          }

          set({
            roomCode: code,
            roomStatus: 'lobby',
            isHost: true,
            mySeat: 0,
            seats: [{ uid, name: displayName || 'Host' }, null, null, null],
            roomIsPublic: isPublic,
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
          const { displayName, roomCode: currentRoomCode } = get();
          const upperCode = code.toUpperCase().trim();

          const snapshot = await dbGet(ref(db, `rooms/${upperCode}`));
          if (!snapshot.exists()) throw new Error('Sala não encontrada');

          const room = snapshot.val();
          const metaStatus = room?.meta?.status;
          if (metaStatus === 'abandoned') throw new Error('Sala abandonada');
          if (!metaStatus) throw new Error('Sala inválida');
          if (metaStatus !== 'lobby') throw new Error('Este jogo já começou');

          // Encontra os assentos atuais
          const seats: (SeatInfo | null)[] = [0, 1, 2, 3].map(i => room.seats?.[i] ?? null);

          // Se o uid já tá num assento, duas possibilidades:
          //  (a) mesma sessão local reingressando (navegou fora e voltou) — ok
          //  (b) mesma conta Google logada em outro dispositivo — bloqueia
          const existingSeat = seats.findIndex(s => s?.uid === uid);
          let assignedSeat: number;

          if (existingSeat !== -1) {
            if (currentRoomCode === upperCode) {
              // Reingresso in-session: mantém o assento atual
              assignedSeat = existingSeat;
            } else {
              throw new Error('Sua conta já está nesta sala em outro dispositivo. Saia do outro antes de entrar.');
            }
          } else {
            // Sessão nova — pega o primeiro livre
            assignedSeat = seats.findIndex(s => s === null);
            if (assignedSeat === -1) throw new Error('Sala cheia (4/4)');
          }

          // Atualiza/Reconfirma a posse do assento
          await update(ref(db, `rooms/${upperCode}/seats`), {
            [assignedSeat]: { uid, name: displayName || 'Jogador' },
          });

          // Nota: NÃO liberamos assento via onDisconnect — vai pro WhatsApp e
          // volta já dispara desconexão no Firebase, e o guest perdia o lugar.
          // Cleanup fica por conta de leaveRoom explícito e do TTL sweep.

          // Atualiza contador no índice público
          const updatedSeats = [...seats];
          updatedSeats[assignedSeat] = { uid, name: displayName || 'Jogador' };
          const newCount = updatedSeats.filter(Boolean).length;
          dbGet(ref(db, `publicRooms/${upperCode}`)).then(s => {
            if (s.exists()) update(ref(db, `publicRooms/${upperCode}`), { playerCount: newCount }).catch(() => {});
          }).catch(() => {});

          set({
            roomCode: upperCode,
            roomStatus: 'lobby',
            isHost: false,
            mySeat: assignedSeat,
            seats: updatedSeats,
            roomMode: room.meta.mode,
            roomTarget: room.meta.targetScore,
            roomIsPublic: room.meta.isPublic ?? false,
            isLoading: false,
          });
        } catch (e: any) {
          set({ error: e.message ?? 'Erro ao entrar na sala', isLoading: false });
          throw e;
        }
      },

      leaveRoom: async () => {
        const { roomCode, mySeat, isHost, roomStatus } = get();
        if (!roomCode) return;
        try {
          if (isHost) {
            // Cancela TODAS as onDisconnects ativas (lobby + playing phases)
            onDisconnect(ref(db, `rooms/${roomCode}`)).cancel().catch(() => {});
            onDisconnect(ref(db, `publicRooms/${roomCode}`)).cancel().catch(() => {});
            onDisconnect(ref(db, `rooms/${roomCode}/meta/status`)).cancel().catch(() => {});
            if (roomStatus === 'playing') {
              // Partida em andamento: marca como abandonada pros guests receberem
              // o aviso. Cleanup da sala vira responsabilidade do TTL sweep.
              await update(ref(db, `rooms/${roomCode}/meta`), { status: 'abandoned' });
              remove(ref(db, `publicRooms/${roomCode}`)).catch(() => {});
            } else {
              // Lobby ou terminado: remove direto
              await remove(ref(db, `rooms/${roomCode}`));
              remove(ref(db, `publicRooms/${roomCode}`)).catch(() => {});
            }
          } else if (mySeat !== null) {
            onDisconnect(ref(db, `rooms/${roomCode}/seats/${mySeat}`)).cancel().catch(() => {});
            await dbSet(ref(db, `rooms/${roomCode}/seats/${mySeat}`), null);
            // Decrementa contador no índice público (se ainda existir — sala em lobby).
            // Se cair pra 0, remove a entrada inteira pra não aparecer "0/4" na lista.
            dbGet(ref(db, `publicRooms/${roomCode}`)).then(s => {
              if (!s.exists()) return;
              const newCount = Math.max(0, (s.val()?.playerCount ?? 1) - 1);
              if (newCount === 0) remove(ref(db, `publicRooms/${roomCode}`)).catch(() => {});
              else update(ref(db, `publicRooms/${roomCode}`), { playerCount: newCount }).catch(() => {});
            }).catch(() => {});
          }
        } catch (_) {}
        get().resetRoom();
      },

      switchSeat: async (targetSeatIdx: number) => {
        const { roomCode, mySeat, seats, displayName, uid } = get();
        if (!roomCode || mySeat === null || mySeat === targetSeatIdx || targetSeatIdx < 0 || targetSeatIdx > 3) return;
        // Se o assento alvo já está ocupado, não faz nada
        if (seats[targetSeatIdx] !== null) {
          set({ error: 'Este assento já está ocupado' });
          return;
        }

        try {
          const updates: Record<string, any> = {};
          updates[`seats/${mySeat}`] = null;
          updates[`seats/${targetSeatIdx}`] = { uid, name: displayName || 'Jogador' };
          await update(ref(db, `rooms/${roomCode}`), updates);
          // Realoca o auto-remove no disconnect pro novo seat
          onDisconnect(ref(db, `rooms/${roomCode}/seats/${mySeat}`)).cancel().catch(() => {});
          onDisconnect(ref(db, `rooms/${roomCode}/seats/${targetSeatIdx}`)).set(null).catch(() => {});
          set({ mySeat: targetSeatIdx, error: null });
        } catch (e: any) {
          set({ error: 'Erro ao trocar de assento: ' + e?.message });
        }
      },

      startGame: async (initialGameState: object) => {
        const { roomCode } = get();
        if (!roomCode) return;
        try {
          const uid = auth.currentUser?.uid;
          const cleanState = JSON.parse(JSON.stringify({ ...initialGameState, _writerUid: uid }));
          await update(ref(db, `rooms/${roomCode}`), {
            'meta/status': 'playing',
            gameState: cleanState,
          });
          // Game começou: substitui o auto-remove por um auto-marca-abandonado.
          // Se o host perder conexão ou fechar o app, os guests recebem o flag
          // e podem sair sem ficar travados.
          onDisconnect(ref(db, `rooms/${roomCode}`)).cancel().catch(() => {});
          onDisconnect(ref(db, `rooms/${roomCode}/meta/status`)).set('abandoned').catch(() => {});
          remove(ref(db, `publicRooms/${roomCode}`)).catch(() => {});
          set({ roomStatus: 'playing' });
        } catch (e: any) {
          set({ error: e.message ?? 'Erro ao iniciar jogo' });
        }
      },

      rematch: async (initialGameState: object) => {
        const { roomCode } = get();
        if (!roomCode) return;
        try {
          const uid = auth.currentUser?.uid;
          const cleanState = JSON.parse(JSON.stringify({ ...initialGameState, _writerUid: uid }));
          await update(ref(db, `rooms/${roomCode}`), {
            gameState: cleanState,
            taunts: null,
          });
        } catch (e: any) {
          set({ error: e.message ?? 'Erro ao iniciar revanche' });
        }
      },

      fetchPublicRooms: async () => {
        try {
          await get().ensureAuth();
          // Aproveita pra varrer entradas vencidas (best-effort, não bloqueia listagem)
          cleanupOldRooms();
          const cutoff = Date.now() - ROOM_TTL_MS;
          const snap = await dbGet(ref(db, 'publicRooms'));
          if (!snap.exists()) return [];
          const rooms: PublicRoomInfo[] = [];
          snap.forEach(child => {
            const val = child.val();
            if (!val) return;
            // Filtra entradas vencidas que ainda não foram removidas pelo sweep
            if (val.createdAt && val.createdAt < cutoff) return;
            rooms.push({
              code: child.key as string,
              mode: val.mode,
              targetScore: val.targetScore,
              playerCount: val.playerCount ?? 1,
              createdAt: val.createdAt,
            });
          });
          return rooms.sort((a, b) => b.createdAt - a.createdAt);
        } catch (e) {
          set({ error: 'Erro ao buscar salas: ' + (e as any)?.message });
          return [];
        }
      },

      applyRoomSnapshot: (snap) => {
        set({
          roomStatus: snap.status as any,
          seats: snap.seats,
          roomMode: snap.mode,
          roomTarget: snap.target,
        });
      },

      sendTaunt: async (msg: string) => {
        const { roomCode, mySeat } = get();
        if (!roomCode || mySeat === null) return;
        const entry: TauntEntry = {
          msg: msg.slice(0, 40),
          ts: Date.now(),
          id: Math.random().toString(36).slice(2, 10),
        };
        try {
          await dbSet(ref(db, `rooms/${roomCode}/taunts/${mySeat}`), entry);
        } catch (_) { /* silencioso — malhação falhou, vida que segue */ }
      },

      applyTauntsSnapshot: (taunts) => {
        set({ taunts });
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

/**
 * useOnlineSync
 *
 * Dois papéis:
 * 1. Escuta o Firebase (rooms/{code}/gameState) e aplica no gameStore local.
 * 2. Depois de cada ação LOCAL que pertence ao "meu turno", sincroniza o estado para o Firebase.
 *
 * Quem sincroniza:
 * - Qualquer jogador: apenas quando é a vez do SEU player ID.
 * - Host (mySeat === 0): também sincroniza os turnos dos bots (assentos sem humanos).
 */

import { auth, db } from '../config/firebase';
import { onValue, ref, set as dbSet } from 'firebase/database';
import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useOnlineStore, SEAT_PLAYER_IDS } from '../store/onlineStore';

export function useOnlineSync() {
  const { roomCode, mySeat, seats, roomStatus } = useOnlineStore();
  const isOnline = roomStatus === 'playing' && roomCode !== null;
  const myPlayerId = mySeat !== null ? SEAT_PLAYER_IDS[mySeat] : null;
  const isHost = mySeat === 0;

  // IDs de players controlados por esta instância
  const myPlayerIds = (() => {
    if (!isOnline) return [];
    const mine: string[] = myPlayerId ? [myPlayerId] : [];
    if (isHost) {
      // Host controla todos os bots (assentos sem humano)
      seats.forEach((s, idx) => {
        if (s === null && idx !== mySeat) mine.push(SEAT_PLAYER_IDS[idx]);
      });
    }
    return mine;
  })();

  // Flag para evitar loop: Firebase → local → Firebase
  const applyingRemote = useRef(false);

  // ── 1. Escuta o Firebase e aplica no gameStore ──────────────────────────
  useEffect(() => {
    if (!isOnline || !roomCode) return;

    const gameRef = ref(db, `rooms/${roomCode}/gameState`);
    const unsubscribeGame = onValue(gameRef, (snapshot) => {
      if (applyingRemote.current) return;
      const remoteState = snapshot.val();
      if (!remoteState) return;

      // Ignora atualizações que eu mesmo escrevi
      const myUid = auth.currentUser?.uid;
      if (remoteState._writerUid === myUid) return;

      applyingRemote.current = true;
      useGameStore.getState().applyRemoteState(remoteState);
      applyingRemote.current = false;
    });

    return () => unsubscribeGame();
  }, [isOnline, roomCode]);

  // ── 2. Escuta o Firebase para mudanças na sala (status, seats) ──────────
  useEffect(() => {
    if (!roomCode) return;

    const metaRef = ref(db, `rooms/${roomCode}/meta`);
    const seatsRef = ref(db, `rooms/${roomCode}/seats`);

    const unsubMeta = onValue(metaRef, (snapshot) => {
      const meta = snapshot.val();
      if (!meta) return;
      const { applyRoomSnapshot, roomMode, roomTarget, roomDifficulty, seats: currentSeats } = useOnlineStore.getState();
      if (meta.status !== useOnlineStore.getState().roomStatus) {
        applyRoomSnapshot({
          status: meta.status,
          seats: currentSeats,
          mode: meta.mode ?? roomMode,
          target: meta.targetScore ?? roomTarget,
          difficulty: meta.difficulty ?? roomDifficulty,
        });
      }
    });

    const unsubSeats = onValue(seatsRef, (snapshot) => {
      const raw = snapshot.val() ?? {};
      const seats: any[] = [0, 1, 2, 3].map(i => raw[i] ?? null);
      const { applyRoomSnapshot, roomStatus, roomMode, roomTarget, roomDifficulty } = useOnlineStore.getState();
      applyRoomSnapshot({
        status: roomStatus,
        seats,
        mode: roomMode,
        target: roomTarget,
        difficulty: roomDifficulty,
      });
    });

    return () => {
      unsubMeta();
      unsubSeats();
    };
  }, [roomCode]);

  // ── 3. Sincroniza para o Firebase após cada ação minha ──────────────────
  useEffect(() => {
    if (!isOnline || !roomCode || myPlayerIds.length === 0) return;

    let prevLogLength = useGameStore.getState().gameLog.length;

    const unsubscribe = useGameStore.subscribe((state) => {
      const gameLog = state.gameLog;
      if (applyingRemote.current) return;
      if (gameLog.length <= prevLogLength) { prevLogLength = gameLog.length; return; }
      prevLogLength = gameLog.length;

      // Verifica se a última ação foi minha (ou de um bot que controlo)
      const lastEvent = gameLog[gameLog.length - 1];
      if (!myPlayerIds.includes(lastEvent.playerId)) return;

        const myUid = auth.currentUser?.uid;
        const currentState = useGameStore.getState();

        // Extrai só os campos do GameState (exclui funções e animações transientes)
        const {
          animatingDrawPlayerId, animatingDiscard, // excluir
          startNewGame, startNewRound, startLayoutTest, // funções — excluir
          drawFromDeck, drawFromPile, discard, playCards, addToExistingGame,
          undoLastPlay, applyRemoteState,
          ...gameStateFields
        } = currentState as any;

        // JSON round-trip remove undefined (Firebase não aceita undefined)
        const payload = JSON.parse(JSON.stringify({
          ...gameStateFields,
          _writerUid: myUid,
        }));
        dbSet(ref(db, `rooms/${roomCode}/gameState`), payload).catch(() => {});
      },
    );

    return () => unsubscribe();
  }, [isOnline, roomCode, myPlayerIds.join(',')]);
}

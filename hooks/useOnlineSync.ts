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

// ID único por instância do app — estável durante toda a sessão,
// independente do estado de auth (evita bug quando auth.currentUser é null)
const INSTANCE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

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
      console.log('[sync] recv', !!remoteState, remoteState?._writerInstanceId?.slice?.(0, 4), 'lastEvent=', remoteState?.gameLog?.[remoteState.gameLog.length - 1]?.type);
      if (!remoteState) return;

      // Ignora atualizações que eu mesmo escrevi (usa instance ID estável,
      // não auth.currentUser que pode ser undefined durante refresh de token)
      if (remoteState._writerInstanceId === INSTANCE_ID) return;

      // Fallback: também verifica _writerUid se disponível (compatibilidade)
      const myUid = auth.currentUser?.uid;
      if (myUid && remoteState._writerUid === myUid) return;

      applyingRemote.current = true;
      try {
        useGameStore.getState().applyRemoteState(remoteState);
      } finally {
        applyingRemote.current = false;
      }
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

    // Usa referência do array (não .length) para detectar mudanças —
    // gameLog é capped em 20 entradas, então .length para de crescer e
    // a comparação por tamanho deixa de funcionar após ~10 turnos.
    let prevGameLog = useGameStore.getState().gameLog;

    const unsubscribe = useGameStore.subscribe((state) => {
      const gameLog = state.gameLog;
      if (applyingRemote.current) return;
      if (gameLog === prevGameLog) return; // mesma referência = nenhum log novo
      prevGameLog = gameLog;

      // Verifica se a última ação foi minha (ou de um bot que controlo).
      // Host também sincroniza ações de humanos em AFK takeover — o host roda o turno
      // do jogador ausente localmente, mas o playerId do lastEvent é o do guest,
      // então sem esta exceção o host nunca faria push e os outros ficariam travados.
      const lastEvent = gameLog[gameLog.length - 1];
      if (!lastEvent) return;
      // Host sincroniza qualquer ação local — isso cobre tanto seus próprios turnos
      // quanto AFK takeover de guests (o playerId do evento seria do guest, não do host).
      // Guests só sincronizam suas próprias ações.
      if (!isHost && !myPlayerIds.includes(lastEvent.playerId)) {
        console.log('[sync] skip (not mine)', lastEvent.type, 'by', lastEvent.playerId, 'myIds=', myPlayerIds.join(','));
        return;
      }

      const myUid = auth.currentUser?.uid;
      console.log('[sync] push', lastEvent.type, 'by', lastEvent.playerId, 'auth=', myUid ?? 'NULL', 'isHost=', isHost);
      const currentState = useGameStore.getState();

      // Extrai só os campos do GameState (exclui funções, animações e estado visual local)
      const {
        animatingDrawPlayerId, animatingDiscard, // excluir — animações transientes
        lastDrawnCardId, // excluir — puramente visual/local, não deve sobrescrever o badge "N" de outro device
        startNewGame, startNewRound, startLayoutTest, // funções — excluir
        drawFromDeck, drawFromPile, discard, playCards, addToExistingGame,
        undoLastPlay, applyRemoteState,
        ...gameStateFields
      } = currentState as any;

      // JSON round-trip remove undefined (Firebase não aceita undefined)
      const payload = JSON.parse(JSON.stringify({
        ...gameStateFields,
        _writerUid: myUid,
        _writerInstanceId: INSTANCE_ID,
      }));
      dbSet(ref(db, `rooms/${roomCode}/gameState`), payload)
        .then(() => console.log('[sync] push OK', lastEvent.type))
        .catch(err => console.warn('[sync] push FAIL', err?.code, err?.message, 'auth=', auth.currentUser?.uid ?? 'NULL'));
    });

    return () => unsubscribe();
  }, [isOnline, roomCode, myPlayerIds.join(',')]);
}

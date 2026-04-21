import * as NavigationBar from 'expo-navigation-bar';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { showAlert } from '../../components/ThemedAlert';
import * as Clipboard from 'expo-clipboard';
import { useKeepAwake } from 'expo-keep-awake';
import { SafeAreaView } from 'react-native-safe-area-context';
import { onValue, ref } from 'firebase/database';
import { db } from '../../config/firebase';
import { GameMode, createInitialGameState } from '../../game/engine';
import { useGameStore } from '../../store/gameStore';
import { useOnlineStore, SEAT_PLAYER_IDS, SeatInfo, PublicRoomInfo } from '../../store/onlineStore';
import { useProfileStore } from '../../store/profileStore';
import { signInWithGoogle, unlinkGoogle } from '../../hooks/useGoogleAuth';
import { ScreenBackground } from '../../components/ScreenBackground';
import { GameColors, Radius, Elevation } from '../../constants/colors';

const TEAM_LABEL: Record<number, string> = { 0: 'Time 1', 1: 'Time 2', 2: 'Time 1', 3: 'Time 2' };
const TEAM_COLOR: Record<number, string> = { 0: GameColors.team.green, 1: GameColors.team.red, 2: GameColors.team.green, 3: GameColors.team.red };

import { auth } from '../../config/firebase';
function GoogleLinkStatus({ onLink, onUnlink, loading }: { onLink: () => void; onUnlink: () => void; loading: boolean }) {
  const user = auth.currentUser;
  const linked = user && !user.isAnonymous;
  if (linked) {
    return (
      <View style={styles.googleLinkedBox}>
        <Text style={styles.googleLinkedText}>✓ Vinculado ao Google</Text>
        <Text style={styles.googleLinkedSub}>{user?.email ?? ''}</Text>
        <TouchableOpacity
          style={[styles.googleUnlinkBtn, loading && styles.btnDisabled]}
          onPress={onUnlink}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text style={styles.googleUnlinkBtnText}>Desvincular</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={[styles.googleLinkBtn, loading && styles.btnDisabled]}
      onPress={onLink}
      disabled={loading}
      activeOpacity={0.85}
    >
      {loading ? <ActivityIndicator color="#0A1C30" /> : <Text style={styles.googleLinkBtnText}>🔐 Vincular ao Google</Text>}
    </TouchableOpacity>
  );
}

export default function OnlineScreen() {
  useKeepAwake();
  const router = useRouter();
  const store = useOnlineStore();
  const { startNewGame } = useGameStore();

  const [step, setStep] = useState<'name' | 'home' | 'create' | 'lobby' | 'browse'>('name');
  const [joinCode, setJoinCode] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [publicRooms, setPublicRooms] = useState<PublicRoomInfo[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const nameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    }
    // Se já tem nome RESERVADO no Firebase, vai direto pra home
    if (useProfileStore.getState().myUsername) setStep('home');
  }, []);

  // Quando a sala muda para 'playing', navega para o jogo.
  // Quando volta para 'idle'/'abandoned'/'finished' (ex: leaveRoom após partida), reseta o step.
  useEffect(() => {
    if (store.roomStatus === 'playing') {
      router.replace('/(tabs)/explore' as any);
    } else if (
      (store.roomStatus === 'idle' || store.roomStatus === 'abandoned' || store.roomStatus === 'finished') &&
      (step === 'lobby' || step === 'create')
    ) {
      // Garante que state local da sala foi limpo (caso a sala tenha sido abandonada
      // via listener sem leaveRoom explícito)
      if (store.roomCode) useOnlineStore.getState().leaveRoom();
      setStep(store.displayName.trim().length > 0 ? 'home' : 'name');
    }
  }, [store.roomStatus]);

  // Escuta assentos e meta do Firebase enquanto estiver no lobby
  useEffect(() => {
    const roomCode = store.roomCode;
    if (!roomCode || step !== 'lobby') return;

    const unsubSeats = onValue(ref(db, `rooms/${roomCode}/seats`), (snap) => {
      const raw = snap.val() ?? {};
      const seats: (SeatInfo | null)[] = [0, 1, 2, 3].map(i => raw[i] ?? null);
      const { applyRoomSnapshot, roomStatus, roomMode, roomTarget } = useOnlineStore.getState();
      applyRoomSnapshot({ status: roomStatus, seats, mode: roomMode, target: roomTarget });
    });

    const unsubMeta = onValue(ref(db, `rooms/${roomCode}/meta`), (snap) => {
      const meta = snap.val();
      // Sala foi removida ou nunca existiu — limpa state local e manda pra home
      if (!meta) {
        useOnlineStore.getState().leaveRoom();
        setStep('home');
        return;
      }
      const { applyRoomSnapshot, roomMode, roomTarget, seats } = useOnlineStore.getState();
      applyRoomSnapshot({ status: meta.status, seats, mode: meta.mode ?? roomMode, target: meta.targetScore ?? roomTarget });
    });

    return () => { unsubSeats(); unsubMeta(); };
  }, [store.roomCode, step]);

  const handleSaveName = async () => {
    if (store.displayName.trim().length < 2) {
      store.setError('Nome muito curto (mínimo 2 letras)');
      return;
    }
    store.setError(null);
    try {
      // Garante auth antes de tentar reservar (transação precisa de um uid)
      await store.ensureAuth();
      const profile = useProfileStore.getState();
      if (profile.myUsername && profile.myUsernameLower === store.displayName.trim().toLowerCase().replace(/\s+/g, '')) {
        // Já é o meu nome — só avança
        setStep('home');
        return;
      }
      if (profile.myUsername) {
        await profile.changeUsername(store.displayName);
      } else {
        await profile.claimUsername(store.displayName);
      }
      await useProfileStore.getState().migrateLocalStatsIfNeeded();
      setStep('home');
    } catch (e: any) {
      store.setError(useProfileStore.getState().claimError ?? e?.message ?? 'Erro ao reservar nome');
    }
  };

  const handleCreate = async () => {
    try {
      await store.createRoom(isPublic);
      setStep('lobby');
    } catch (_) {}
  };

  const handleBrowse = async () => {
    setStep('browse');
    setBrowseLoading(true);
    const rooms = await store.fetchPublicRooms();
    setPublicRooms(rooms);
    setBrowseLoading(false);
  };

  const handleJoinPublic = async (code: string) => {
    try {
      await store.joinRoom(code);
      setStep('lobby');
    } catch (_) {}
  };

  const handleJoin = async () => {
    if (joinCode.trim().length < 4) {
      store.setError('Código inválido');
      return;
    }
    try {
      await store.joinRoom(joinCode.trim());
      setStep('lobby');
    } catch (_) {}
  };

  const [googleLoading, setGoogleLoading] = useState(false);
  const handleUnlink = () => {
    showAlert(
      'Desvincular Google?',
      'Seu perfil e stats ficam salvos — ao entrar de novo com Google, tudo é restaurado. Você voltará a ser um jogador anônimo neste aparelho.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desvincular',
          style: 'destructive',
          onPress: async () => {
            setGoogleLoading(true);
            try {
              await unlinkGoogle();
              store.setDisplayName('');
              setStep('name');
            } finally {
              setGoogleLoading(false);
            }
          },
        },
      ],
    );
  };
  const handleGoogle = async () => {
    setGoogleLoading(true);
    store.setError(null);
    try {
      await store.ensureAuth(); // garante que tem uid anônimo
      const res = await signInWithGoogle();
      if (!res.ok) {
        if (res.error !== 'Login cancelado') {
          showAlert('Falha no login Google', res.error);
          store.setError(res.error);
        }
        return;
      }
      const { myUsername } = useProfileStore.getState();
      if (myUsername) {
        showAlert('Login OK', `Bem-vindo de volta, ${myUsername}! Stats restaurados.`);
        store.setDisplayName(myUsername);
        setStep('home');
      } else {
        // Logou mas não tem perfil — provavelmente é recuperação de reinstalação
        // cujo uid antigo não tinha Google linkado. Avisa e deixa escolher nome novo.
        showAlert(
          'Login com Google OK',
          'Não achei perfil antigo vinculado a essa conta Google. Se você tinha um perfil antes e quer recuperá-lo, me chama que recupero manualmente pelo seu nome antigo. Por enquanto, escolha um nome pra continuar.',
        );
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleLeave = async () => {
    await store.leaveRoom();
    setStep('home');
  };

  const handleStartGame = async () => {
    // Host: cria o estado inicial e envia pro Firebase
    const { roomMode, roomTarget, seats } = store;
    const initialState = createInitialGameState(roomTarget, roomMode);

    // Substitui os nomes dos players pelos nomes reais das pessoas na sala
    initialState.players = initialState.players.map((p, idx) => {
      const seat = seats[idx];
      return { ...p, name: seat?.name ?? p.name };
    });

    // Aplica localmente com nomes reais (bots recebem nome genérico)
    startNewGame(roomTarget, roomMode);
    const playersWithNames = useGameStore.getState().players.map((p, idx) => {
      const seat = seats[idx];
      return { ...p, name: seat?.name ?? `Bot ${idx + 1}` };
    });
    useGameStore.setState({ players: playersWithNames });

    const currentState = useGameStore.getState();

    // Extrai só campos de dados (exclui funções do Zustand)
    const {
      startNewGame: _a, startNewRound: _b, startLayoutTest: _c,
      drawFromDeck: _d, drawFromPile: _e, discard: _f, playCards: _g,
      addToExistingGame: _h, undoLastPlay: _i, applyRemoteState: _j,
      animatingDrawPlayerId: _k, animatingDiscard: _l,
      ...gameStateFields
    } = currentState as any;

    await store.startGame({ ...gameStateFields });
  };

  const filledSeats = store.seats.filter(Boolean).length;

  // ── STEP: NOME ────────────────────────────────────────────────────────────
  if (step === 'name') {
    return (
      <ScreenBackground><SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.title}>Como você se chama?</Text>
          <Text style={styles.subtitle}>Aparecerá para os outros jogadores</Text>
          <TextInput
            ref={nameInputRef}
            style={styles.nameInput}
            value={store.displayName}
            onChangeText={store.setDisplayName}
            placeholder="Seu nome"
            placeholderTextColor="rgba(255,255,255,0.3)"
            maxLength={16}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSaveName}
          />
          {store.error && <Text style={styles.errorText}>{store.error}</Text>}
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveName} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>CONTINUAR →</Text>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.googleBtn, googleLoading && styles.btnDisabled]}
            onPress={handleGoogle}
            disabled={googleLoading}
            activeOpacity={0.85}
          >
            {googleLoading
              ? <ActivityIndicator color="#0A1C30" />
              : <Text style={styles.googleBtnText}>🔐 Entrar com Google</Text>}
          </TouchableOpacity>
          <Text style={styles.googleHint}>Recupera seu perfil mesmo após reinstalar o app</Text>

          <TouchableOpacity style={styles.backLink} onPress={() => router.replace('/(tabs)' as any)}>
            <Text style={styles.backLinkText}>← Voltar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView></ScreenBackground>
    );
  }

  // ── STEP: HOME ────────────────────────────────────────────────────────────
  if (step === 'home') {
    return (
      <ScreenBackground><SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.title}>Jogar Online</Text>
          <Text style={styles.playerName}>👤 {store.displayName}</Text>
          <TouchableOpacity
            style={styles.nameEditBtn}
            onPress={() => setStep('name')}
            activeOpacity={0.7}
          >
            <Text style={styles.nameEditText}>Mudar nome</Text>
          </TouchableOpacity>

          <GoogleLinkStatus onLink={handleGoogle} onUnlink={handleUnlink} loading={googleLoading} />

          <View style={styles.homeButtons}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setStep('create')}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>🏠 CRIAR SALA</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={handleBrowse}
              activeOpacity={0.85}
            >
              <Text style={styles.secondaryBtnText}>🌐 VER SALAS PÚBLICAS</Text>
            </TouchableOpacity>

            <View style={styles.joinRow}>
              <TextInput
                style={styles.joinInput}
                value={joinCode}
                onChangeText={v => setJoinCode(v.toUpperCase())}
                placeholder="Código da sala"
                placeholderTextColor="rgba(255,255,255,0.3)"
                maxLength={6}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={[styles.joinBtn, store.isLoading && styles.btnDisabled]}
                onPress={handleJoin}
                disabled={store.isLoading}
                activeOpacity={0.85}
              >
                {store.isLoading
                  ? <ActivityIndicator color="#1B5E20" />
                  : <Text style={styles.joinBtnText}>ENTRAR</Text>}
              </TouchableOpacity>
            </View>

            {store.error && <Text style={styles.errorText}>{store.error}</Text>}
          </View>

          <TouchableOpacity style={styles.backLink} onPress={() => router.replace('/(tabs)' as any)}>
            <Text style={styles.backLinkText}>← Menu principal</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView></ScreenBackground>
    );
  }

  // ── STEP: CONFIGURAR SALA (host) ──────────────────────────────────────────
  if (step === 'create') {
    const { roomMode, roomTarget } = store;
    return (
      <ScreenBackground><SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>Configurar Sala</Text>

          <Text style={styles.sectionLabel}>Modo de Jogo</Text>
          <View style={styles.optionRow}>
            {(['classic', 'araujo_pereira'] as GameMode[]).map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.optionBtn, roomMode === m && styles.optionBtnActive]}
                onPress={() => store.setRoomSettings(m, roomTarget)}
                activeOpacity={0.8}
              >
                <Text style={[styles.optionText, roomMode === m && styles.optionTextActive]}>
                  {m === 'classic' ? 'Clássico' : 'Buraco Mole'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Meta de Pontos</Text>
          <View style={styles.optionRow}>
            {[1500, 3000, 5000].map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.optionBtn, roomTarget === t && styles.optionBtnActive]}
                onPress={() => store.setRoomSettings(roomMode, t)}
                activeOpacity={0.8}
              >
                <Text style={[styles.optionText, roomTarget === t && styles.optionTextActive]}>
                  {t.toLocaleString()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Visibilidade da Sala</Text>
          <View style={styles.optionRow}>
            {([{ value: true, label: '🌐 Pública' }, { value: false, label: '🔒 Privada' }]).map(opt => (
              <TouchableOpacity
                key={String(opt.value)}
                style={[styles.optionBtn, isPublic === opt.value && styles.optionBtnActive]}
                onPress={() => setIsPublic(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.optionText, isPublic === opt.value && styles.optionTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.visibilityHint}>
            {isPublic
              ? 'Qualquer jogador pode encontrar e entrar nesta sala'
              : 'Somente quem tiver o código pode entrar'}
          </Text>

          {store.error && <Text style={styles.errorText}>{store.error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, store.isLoading && styles.btnDisabled]}
            onPress={handleCreate}
            disabled={store.isLoading}
            activeOpacity={0.85}
          >
            {store.isLoading
              ? <ActivityIndicator color="#1B5E20" />
              : <Text style={styles.primaryBtnText}>CRIAR SALA →</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.backLink} onPress={() => setStep('home')}>
            <Text style={styles.backLinkText}>← Voltar</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView></ScreenBackground>
    );
  }

  // ── STEP: SALAS PÚBLICAS ──────────────────────────────────────────────────
  if (step === 'browse') {
    return (
      <ScreenBackground><SafeAreaView style={styles.container}>
        <View style={styles.browseHeader}>
          <Text style={styles.title}>Salas Públicas</Text>
          <TouchableOpacity
            onPress={async () => {
              setBrowseLoading(true);
              const rooms = await store.fetchPublicRooms();
              setPublicRooms(rooms);
              setBrowseLoading(false);
            }}
            activeOpacity={0.7}
            style={styles.refreshBtn}
          >
            <Text style={styles.refreshBtnText}>↻ Atualizar</Text>
          </TouchableOpacity>
        </View>

        {store.error && <Text style={[styles.errorText, { paddingHorizontal: 24 }]}>{store.error}</Text>}

        {browseLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#FFD600" size="large" />
            <Text style={[styles.waitingText, { marginTop: 12 }]}>Buscando salas...</Text>
          </View>
        ) : publicRooms.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyText}>Nenhuma sala pública disponível</Text>
            <Text style={styles.emptySubText}>Crie uma sala pública para começar!</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.browseList}>
            {publicRooms.map(room => (
              <View key={room.code} style={styles.roomCard}>
                <View style={styles.roomCardLeft}>
                  <Text style={styles.roomCode}>{room.code}</Text>
                  <Text style={styles.roomMeta}>
                    {room.mode === 'classic' ? 'Clássico' : 'Buraco Mole'} · {room.targetScore.toLocaleString()} pts
                  </Text>
                  <View style={styles.roomPlayers}>
                    {[0, 1, 2, 3].map(i => (
                      <View
                        key={i}
                        style={[styles.playerDot, i < room.playerCount ? styles.playerDotFilled : styles.playerDotEmpty]}
                      />
                    ))}
                    <Text style={styles.playerCountText}>{room.playerCount}/4 jogadores</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.joinRoomBtn, (room.playerCount >= 4 || store.isLoading) && styles.btnDisabled]}
                  onPress={() => handleJoinPublic(room.code)}
                  disabled={room.playerCount >= 4 || store.isLoading}
                  activeOpacity={0.85}
                >
                  {store.isLoading
                    ? <ActivityIndicator color="#1B5E20" size="small" />
                    : <Text style={styles.joinRoomBtnText}>{room.playerCount >= 4 ? 'Cheia' : 'ENTRAR'}</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        <TouchableOpacity style={[styles.backLink, { alignSelf: 'center', marginBottom: 16 }]} onPress={() => setStep('home')}>
          <Text style={styles.backLinkText}>← Voltar</Text>
        </TouchableOpacity>
      </SafeAreaView></ScreenBackground>
    );
  }

  // ── STEP: LOBBY (aguardando jogadores) ────────────────────────────────────
  return (
    <ScreenBackground><SafeAreaView style={styles.container}>
      <View style={styles.centered}>
        {/* Badge público/privado */}
        <View style={[styles.visibilityBadge, store.roomIsPublic ? styles.visibilityBadgePublic : styles.visibilityBadgePrivate]}>
          <Text style={styles.visibilityBadgeText}>
            {store.roomIsPublic ? '🌐 Sala Pública' : '🔒 Sala Privada'}
          </Text>
        </View>

        {/* Código da sala */}
        <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Código da Sala</Text>
        <TouchableOpacity
          style={styles.codeBox}
          onPress={async () => {
            await Clipboard.setStringAsync(store.roomCode ?? '');
            setCopyFeedback(true);
            setTimeout(() => setCopyFeedback(false), 1500);
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.codeText}>{store.roomCode}</Text>
          <Text style={styles.codeCopy}>{copyFeedback ? '✓ Copiado!' : 'Toque para copiar'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.whatsappBtn}
          onPress={() => {
            const msg = `Bora jogar Buraco? 🃏\nEntra na sala e digita o código:\n\n${store.roomCode}`;
            const url = `whatsapp://send?text=${encodeURIComponent(msg)}`;
            Linking.openURL(url).catch(() => {});
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.whatsappBtnText}>Compartilhar no WhatsApp</Text>
        </TouchableOpacity>

        {/* Assentos */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Jogadores ({filledSeats}/4)</Text>
        <View style={styles.seatsList}>
          {[0, 1, 2, 3].map(seatIdx => {
            const seat = store.seats[seatIdx];
            const isMe = seatIdx === store.mySeat;
            return (
              <TouchableOpacity
                key={seatIdx}
                style={[
                  styles.seatRow,
                  isMe && styles.seatRowMe,
                  !seat && !isMe ? styles.seatRowEmpty : null
                ]}
                activeOpacity={(!seat && !isMe) ? 0.7 : 1}
                onPress={() => {
                   if (!seat && !isMe) store.switchSeat(seatIdx);
                }}
              >
                <View style={[styles.seatTeamDot, { backgroundColor: TEAM_COLOR[seatIdx] }]} />
                <View style={styles.seatInfo}>
                  <Text style={styles.seatName}>
                    {seat ? seat.name : SEAT_PLAYER_IDS[seatIdx].startsWith('bot') ? '🤖 Bot (toque para sentar)' : '...livre (toque para sentar)'}
                    {isMe ? ' (você)' : ''}
                  </Text>
                  <Text style={styles.seatTeamLabel}>{TEAM_LABEL[seatIdx]}</Text>
                </View>
                {seat && <Text style={styles.seatConnected}>●</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Botão Iniciar (só host) */}
        {store.isHost && (
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 24 }, store.isLoading && styles.btnDisabled]}
            onPress={handleStartGame}
            disabled={store.isLoading}
            activeOpacity={0.85}
          >
            {store.isLoading
              ? <ActivityIndicator color="#1B5E20" />
              : <Text style={styles.primaryBtnText}>
                  {filledSeats < 2 ? 'Aguardando jogadores...' : '▶ INICIAR JOGO'}
                </Text>}
          </TouchableOpacity>
        )}

        {!store.isHost && (
          <View style={styles.waitingBox}>
            <ActivityIndicator color="#FFD600" style={{ marginRight: 10 }} />
            <Text style={styles.waitingText}>Aguardando o host iniciar...</Text>
          </View>
        )}

        {store.error && <Text style={styles.errorText}>{store.error}</Text>}

        <TouchableOpacity style={styles.backLink} onPress={handleLeave}>
          <Text style={styles.backLinkText}>← Sair da sala</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView></ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  scrollContent: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 40, paddingBottom: 40 },

  title: { color: GameColors.gold, fontSize: 30, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  subtitle: { color: GameColors.text.muted, fontSize: 14, marginBottom: 26 },
  playerName: { color: GameColors.text.primary, fontSize: 22, fontWeight: '900', marginBottom: 4 },

  nameEditBtn: { marginBottom: 32 },
  nameEditText: { color: GameColors.gold, opacity: 0.7, fontSize: 13, fontWeight: '600' },

  nameInput: {
    width: '100%',
    backgroundColor: GameColors.surface.mid,
    borderRadius: Radius.md,
    paddingHorizontal: 18,
    paddingVertical: 16,
    color: GameColors.text.primary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
    textAlign: 'center',
  },

  homeButtons: { width: '100%', gap: 12, marginBottom: 8 },

  primaryBtn: {
    backgroundColor: GameColors.gold,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    width: '100%',
    ...Elevation.goldGlow,
  },
  primaryBtnText: { color: GameColors.text.onGold, fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  btnDisabled: { opacity: 0.5 },

  joinRow: { flexDirection: 'row', gap: 8 },
  joinInput: {
    flex: 1,
    backgroundColor: GameColors.surface.mid,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: GameColors.text.primary,
    fontSize: 18,
    fontWeight: '900',
    borderWidth: 1,
    borderColor: GameColors.surface.border,
    letterSpacing: 4,
    textAlign: 'center',
  },
  joinBtn: {
    backgroundColor: GameColors.gold,
    borderRadius: Radius.md,
    paddingHorizontal: 20,
    paddingVertical: 14,
    justifyContent: 'center',
    ...Elevation.goldGlow,
  },
  joinBtnText: { color: GameColors.text.onGold, fontSize: 15, fontWeight: '900' },

  sectionLabel: {
    color: GameColors.text.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  optionRow: { flexDirection: 'row', gap: 8, width: '100%', marginBottom: 22 },
  optionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: Radius.sm,
    backgroundColor: GameColors.surface.low,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
  },
  optionBtnActive: { backgroundColor: GameColors.gold, borderColor: GameColors.gold, ...Elevation.goldGlow },
  optionText: { color: GameColors.text.secondary, fontSize: 14, fontWeight: '700' },
  optionTextActive: { color: GameColors.text.onGold, fontWeight: '900' },

  // Lobby
  codeBox: {
    backgroundColor: GameColors.goldSoft,
    borderRadius: Radius.lg,
    paddingHorizontal: 36,
    paddingVertical: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: GameColors.gold,
    marginBottom: 6,
    ...Elevation.card,
  },
  codeText: { color: GameColors.gold, fontSize: 42, fontWeight: '900', letterSpacing: 8 },
  codeCopy: { color: GameColors.text.muted, fontSize: 12, marginTop: 4 },
  whatsappBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    borderRadius: Radius.sm,
    paddingHorizontal: 22,
    paddingVertical: 13,
    marginTop: 10,
    marginBottom: 4,
    ...Elevation.btn,
  },
  whatsappBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  seatsList: { width: '100%', gap: 10 },
  seatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GameColors.surface.low,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
    gap: 12,
  },
  seatRowMe: { borderColor: GameColors.goldBorder, backgroundColor: GameColors.goldSoft },
  seatRowEmpty: { borderColor: GameColors.surface.high, borderStyle: 'dashed' },
  seatTeamDot: { width: 12, height: 12, borderRadius: 6 },
  seatInfo: { flex: 1 },
  seatName: { color: GameColors.text.primary, fontSize: 15, fontWeight: '700' },
  seatTeamLabel: { color: GameColors.text.muted, fontSize: 11, marginTop: 2 },
  seatConnected: { color: GameColors.success, fontSize: 16 },

  waitingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    backgroundColor: GameColors.surface.low,
    borderRadius: Radius.md,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
  },
  waitingText: { color: GameColors.text.secondary, fontSize: 14 },

  errorText: { color: GameColors.dangerSoft, fontSize: 13, marginTop: 8, textAlign: 'center' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 14, width: '100%' },
  dividerLine: { flex: 1, height: 1, backgroundColor: GameColors.surface.border },
  dividerText: { color: GameColors.text.muted, marginHorizontal: 12, fontSize: 12, fontWeight: '600' },

  googleBtn: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    width: '100%',
    ...Elevation.btn,
  },
  googleBtnText: { color: '#222', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  googleHint: { color: GameColors.text.muted, fontSize: 12, marginTop: 10, textAlign: 'center' },

  googleLinkBtn: {
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    alignItems: 'center',
    marginBottom: 18,
  },
  googleLinkBtnText: { color: '#222', fontSize: 13, fontWeight: '800' },
  googleLinkedBox: { alignItems: 'center', marginBottom: 18 },
  googleLinkedText: { color: GameColors.successSoft, fontSize: 13, fontWeight: '800' },
  googleLinkedSub: { color: GameColors.text.muted, fontSize: 11, marginTop: 2 },
  googleUnlinkBtn: {
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,138,128,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,138,128,0.5)',
  },
  googleUnlinkBtnText: { color: GameColors.dangerSoft, fontSize: 12, fontWeight: '700' },

  backLink: { marginTop: 22 },
  backLinkText: { color: GameColors.text.muted, fontSize: 14, fontWeight: '600' },

  secondaryBtn: {
    backgroundColor: GameColors.goldSoft,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: GameColors.goldBorder,
    width: '100%',
  },
  secondaryBtnText: { color: GameColors.gold, fontSize: 15, fontWeight: '800', letterSpacing: 1 },

  visibilityHint: {
    color: GameColors.text.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: -12,
    marginBottom: 22,
    paddingHorizontal: 8,
  },

  browseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 10,
  },
  refreshBtn: { padding: 8 },
  refreshBtnText: { color: GameColors.gold, fontSize: 14, fontWeight: '700' },

  browseList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 12 },

  roomCard: {
    backgroundColor: GameColors.surface.low,
    borderRadius: Radius.md,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
  },
  roomCardLeft: { flex: 1 },
  roomCode: { color: GameColors.gold, fontSize: 22, fontWeight: '900', letterSpacing: 3, marginBottom: 2 },
  roomMeta: { color: GameColors.text.secondary, fontSize: 12, marginBottom: 8 },
  roomPlayers: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  playerDot: { width: 10, height: 10, borderRadius: 5 },
  playerDotFilled: { backgroundColor: GameColors.success },
  playerDotEmpty: { backgroundColor: GameColors.surface.high },
  playerCountText: { color: GameColors.text.muted, fontSize: 11, marginLeft: 6 },

  joinRoomBtn: {
    backgroundColor: GameColors.gold,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    alignItems: 'center',
    minWidth: 74,
    ...Elevation.goldGlow,
  },
  joinRoomBtnText: { color: GameColors.text.onGold, fontSize: 13, fontWeight: '900' },

  emptyText: { color: GameColors.text.secondary, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  emptySubText: { color: GameColors.text.muted, fontSize: 13 },

  visibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  visibilityBadgePublic: {
    backgroundColor: 'rgba(102,187,106,0.15)',
    borderColor: 'rgba(102,187,106,0.5)',
  },
  visibilityBadgePrivate: {
    backgroundColor: GameColors.goldSoft,
    borderColor: GameColors.goldBorder,
  },
  visibilityBadgeText: { color: GameColors.text.primary, fontSize: 13, fontWeight: '700' },
});

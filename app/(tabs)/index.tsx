import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, Platform, ScrollView } from 'react-native';
import { showAlert } from '../../components/ThemedAlert';
import { useRouter } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { useStatsStore, DailyRewardInfo } from '../../store/statsStore';
import { useOnlineStore } from '../../store/onlineStore';
import { GameMode } from '../../game/engine';
import * as NavigationBar from 'expo-navigation-bar';
import Constants from 'expo-constants';
import { ScreenBackground } from '../../components/ScreenBackground';
import { GameColors, Radius, Elevation } from '../../constants/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStore } from '../../store/themeStore';
import { THEME_LABELS, type ThemeName } from '../../constants/themes';

const APP_VERSION = Constants.expoConfig?.version ?? '?';

const TARGETS = [1500, 3000, 5000];

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { startNewGame, startLayoutTest, players, gameLog, winnerTeamId } = useGameStore();
  const { level, checkDailyReward, claimDailyReward } = useStatsStore();
  const { resetRoom, roomStatus } = useOnlineStore();
  const [targetScore, setTargetScore] = useState(1500);
  const [gameMode, setGameMode] = useState<GameMode>('classic');
  const [dailyReward, setDailyReward] = useState<DailyRewardInfo | null>(null);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const currentTheme = useThemeStore(s => s.theme);
  const setTheme = useThemeStore(s => s.setTheme);

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    }
  }, []);

  useEffect(() => {
    const reward = checkDailyReward();
    if (reward.available) setDailyReward(reward);
  }, []);

  const isGameInProgress = (gameLog.length > 0 || players.some(p => p.hand.length !== 11)) && !winnerTeamId;

  const handleStart = () => {
    if (roomStatus !== 'idle') resetRoom();
    startNewGame(targetScore, gameMode);
    router.replace('/(tabs)/explore' as any);
  };

  const handleRestart = () => {
    showAlert('Reiniciar', 'Tem certeza que deseja apagar a partida atual?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sim, Apagar', style: 'destructive', onPress: () => {
          if (roomStatus !== 'idle') resetRoom();
          startNewGame(targetScore, gameMode);
      }}
    ]);
  };

  const handleContinue = () => {
    if (roomStatus !== 'idle') resetRoom();
    router.replace('/(tabs)/explore' as any);
  };

  return (
    <ScreenBackground>
    <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={styles.container} bounces={false}>
      {/* Modal Recompensa Diária */}
      <Modal visible={!!dailyReward} transparent animationType="fade">
        <View style={styles.dailyOverlay}>
          <View style={styles.dailyBox}>
            <Text style={styles.dailyEmoji}>🎁</Text>
            <Text style={styles.dailyTitle}>Recompensa Diária!</Text>
            <Text style={styles.dailyStreak}>
              {dailyReward && dailyReward.streakDays > 1
                ? `🔥 ${dailyReward.streakDays} dias seguidos!`
                : 'Bem-vindo de volta!'}
            </Text>
            <View style={styles.dailyXPBadge}>
              <Text style={styles.dailyXPText}>+{dailyReward?.xp ?? 0}</Text>
              <Text style={styles.dailyXPLabel}>XP</Text>
            </View>
            <TouchableOpacity
              style={styles.dailyBtn}
              onPress={() => { claimDailyReward(); setDailyReward(null); }}
              activeOpacity={0.85}
            >
              <Text style={styles.dailyBtnText}>RESGATAR</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Botão de Perfil */}
      <TouchableOpacity
        style={[styles.profileBtn, { top: insets.top + 8 }]}
        onPress={() => router.replace('/(tabs)/stats' as any)}
        activeOpacity={0.8}
      >
        <Text style={styles.profileBtnLevel}>Nv {level}</Text>
        <Text style={styles.profileBtnIcon}>👤</Text>
      </TouchableOpacity>

      {/* Botão de Tema */}
      <TouchableOpacity
        style={[styles.themeBtn, { top: insets.top + 8 }]}
        onPress={() => setThemePickerOpen(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.themeBtnIcon}>🎨</Text>
      </TouchableOpacity>

      {/* Modal Seletor de Tema */}
      <Modal visible={themePickerOpen} transparent animationType="fade" onRequestClose={() => setThemePickerOpen(false)}>
        <TouchableOpacity style={styles.themeOverlay} activeOpacity={1} onPress={() => setThemePickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.themeBox}>
            <Text style={styles.themeTitle}>Escolha o tema</Text>
            <Text style={styles.themeSubtitle}>O app vai recarregar pra aplicar.</Text>
            {(Object.keys(THEME_LABELS) as ThemeName[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.themeOption, currentTheme === t && styles.themeOptionActive]}
                onPress={() => {
                  setThemePickerOpen(false);
                  if (t !== currentTheme) setTheme(t);
                }}
                activeOpacity={0.85}
              >
                <Text style={[styles.themeOptionText, currentTheme === t && styles.themeOptionTextActive]}>
                  {THEME_LABELS[t]}
                </Text>
                {currentTheme === t && <Text style={styles.themeCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Título */}
      <View style={styles.titleBox}>
        <View style={styles.cardFan}>
          <View style={[styles.miniCard, styles.miniCardLeft]}>
            <Text style={[styles.miniCardRank, styles.suitBlack]}>K</Text>
            <Text style={[styles.miniCardSuit, styles.suitBlack]}>♠</Text>
          </View>
          <View style={[styles.miniCard, styles.miniCardCenter]}>
            <Text style={[styles.miniCardRank, styles.suitRed]}>Q</Text>
            <Text style={[styles.miniCardSuit, styles.suitRed]}>♥</Text>
          </View>
          <View style={[styles.miniCard, styles.miniCardRight]}>
            <Text style={[styles.miniCardRank, styles.suitRed]}>A</Text>
            <Text style={[styles.miniCardSuit, styles.suitRed]}>♦</Text>
          </View>
        </View>
        <Text style={styles.titleCursive}>Queti's</Text>
        <Text style={styles.title}>BURACO</Text>
        <View style={styles.titleDivider} />
      </View>

      {/* Seletor de Modo de Jogo */}
      <Text style={styles.sectionTitle}>Modo de Jogo</Text>
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, gameMode === 'classic' && styles.modeBtnActive]}
          onPress={() => setGameMode('classic')}
          activeOpacity={0.8}
        >
          <Text style={[styles.modeText, gameMode === 'classic' && styles.modeTextActive]}>Clássico</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, gameMode === 'araujo_pereira' && styles.modeBtnActive]}
          onPress={() => setGameMode('araujo_pereira')}
          activeOpacity={0.8}
        >
          <Text style={[styles.modeText, gameMode === 'araujo_pereira' && styles.modeTextActive]}>Buraco Mole</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.diffDesc}>
        {gameMode === 'classic' ? 'Regras originais: sem trincas, bater limpo.' : 'Regras da família: trincas liberadas, lixo livre, bate sujo.'}
      </Text>

      {/* Seletor de Meta */}
      <Text style={styles.sectionTitle}>Meta de Pontos</Text>
      <View style={styles.targetRow}>
        {TARGETS.map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.targetBtn, targetScore === t && styles.targetBtnActive]}
            onPress={() => setTargetScore(t)}
            activeOpacity={0.8}
          >
            <Text style={[styles.targetText, targetScore === t && styles.targetTextActive]}>
              {t.toLocaleString()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Botão Continuar/Jogar */}
      {isGameInProgress && (
        <TouchableOpacity 
          style={[styles.playBtn, { backgroundColor: '#4CAF50', marginBottom: 12, shadowColor: '#4CAF50' }]} 
          onPress={handleContinue} 
          activeOpacity={0.85}
        >
          <Text style={[styles.playText, { color: '#fff' }]}>CONTINUAR JOGO</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.playBtn} onPress={isGameInProgress ? handleRestart : handleStart} activeOpacity={0.85}>
        <Text style={styles.playText}>{isGameInProgress ? 'REINICIAR' : '🃏 JOGAR'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.playBtn, { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#FFD600', marginTop: 12 }]}
        onPress={() => router.replace('/(tabs)/online' as any)}
        activeOpacity={0.85}
      >
        <Text style={[styles.playText, { color: '#FFD600' }]}>🌐 JOGAR ONLINE</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.playBtn, { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#FFD600', marginTop: 12 }]}
        onPress={() => router.replace('/(tabs)/ranking' as any)}
        activeOpacity={0.85}
      >
        <Text style={[styles.playText, { color: '#FFD600' }]}>🏆 RANKING</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.layoutBtn}
        onPress={() => { startLayoutTest(); router.replace('/(tabs)/explore' as any); }}
        activeOpacity={0.7}
      >
        <Text style={styles.layoutBtnText}>Layout</Text>
      </TouchableOpacity>

      <Text style={styles.version}>v{APP_VERSION}</Text>
    </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 50,
  },
  titleBox: {
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 52,
    fontWeight: '900',
    color: GameColors.gold,
    letterSpacing: 6,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
    marginTop: -2,
  },
  titleCursive: {
    fontSize: 26,
    color: GameColors.gold,
    fontStyle: 'italic',
    fontWeight: '700',
    letterSpacing: 1.5,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
    marginTop: 8,
  },
  titleDivider: {
    marginTop: 10,
    width: 120,
    height: 2,
    backgroundColor: GameColors.goldBorder,
    borderRadius: 2,
  },
  subtitle: {
    fontSize: 18,
    color: GameColors.text.secondary,
    letterSpacing: 2,
    marginTop: 4,
  },
  cardFan: {
    flexDirection: 'row',
    height: 64,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: 6,
  },
  miniCard: {
    width: 42,
    height: 60,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
    paddingTop: 4,
    paddingLeft: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  miniCardLeft: {
    transform: [{ rotate: '-14deg' }, { translateY: 4 }, { translateX: 8 }],
    zIndex: 1,
  },
  miniCardCenter: {
    transform: [{ translateY: -4 }],
    zIndex: 2,
  },
  miniCardRight: {
    transform: [{ rotate: '14deg' }, { translateY: 4 }, { translateX: -8 }],
    zIndex: 1,
  },
  miniCardRank: {
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 16,
  },
  miniCardSuit: {
    fontSize: 14,
    lineHeight: 16,
    marginTop: -1,
  },
  suitBlack: {
    color: '#1F2430',
  },
  suitRed: {
    color: '#D32F2F',
  },
  sectionTitle: {
    color: GameColors.text.secondary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    alignSelf: 'flex-start',
    marginBottom: 10,
    marginTop: 4,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 10,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
    backgroundColor: GameColors.surface.low,
  },
  modeBtnActive: {
    backgroundColor: GameColors.gold,
    borderColor: GameColors.gold,
    ...Elevation.goldGlow,
  },
  modeText: {
    color: GameColors.text.secondary,
    fontSize: 16,
    fontWeight: '700',
  },
  modeTextActive: {
    color: GameColors.text.onGold,
    fontWeight: '900',
  },
  diffRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 8,
  },
  diffBtn: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 2,
    backgroundColor: GameColors.surface.dark,
  },
  diffEmoji: {
    fontSize: 25,
    marginBottom: 4,
  },
  diffLabel: {
    color: GameColors.text.primary,
    fontSize: 17,
    fontWeight: '700',
  },
  diffDesc: {
    color: GameColors.text.muted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 30,
    paddingHorizontal: 8,
    lineHeight: 20,
  },
  targetRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 38,
  },
  targetBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: Radius.sm,
    backgroundColor: GameColors.surface.low,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
  },
  targetBtnActive: {
    backgroundColor: GameColors.gold,
    borderColor: GameColors.gold,
    ...Elevation.goldGlow,
  },
  targetText: {
    color: GameColors.text.secondary,
    fontSize: 18,
    fontWeight: '700',
  },
  targetTextActive: {
    color: GameColors.text.onGold,
    fontWeight: '900',
  },
  playBtn: {
    backgroundColor: GameColors.gold,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: Radius.pill,
    ...Elevation.goldGlow,
    width: '100%',
    alignItems: 'center',
  },
  playText: {
    color: GameColors.text.onGold,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
  layoutBtn: {
    position: 'absolute',
    bottom: 14,
    left: 20,
    backgroundColor: GameColors.surface.low,
    borderRadius: Radius.xs,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
  },
  layoutBtnText: {
    color: GameColors.text.faint,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  version: {
    position: 'absolute',
    bottom: 16,
    right: 20,
    color: GameColors.text.faint,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
  },

  // Botão de perfil
  profileBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: GameColors.goldSoft,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: GameColors.goldBorder,
  },
  profileBtnLevel: {
    color: GameColors.gold,
    fontSize: 14,
    fontWeight: '900',
  },
  profileBtnIcon: {
    fontSize: 18,
  },

  // Botão de tema (canto esquerdo superior)
  themeBtn: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GameColors.goldSoft,
    borderWidth: 1,
    borderColor: GameColors.goldBorder,
  },
  themeBtnIcon: {
    fontSize: 20,
  },

  // Modal seletor de tema
  themeOverlay: {
    flex: 1,
    backgroundColor: GameColors.overlay.modal,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  themeBox: {
    backgroundColor: GameColors.bg.surfaceSoft,
    borderRadius: Radius.lg,
    padding: 22,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
    ...Elevation.modal,
  },
  themeTitle: {
    color: GameColors.gold,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 1,
  },
  themeSubtitle: {
    color: GameColors.text.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Radius.sm,
    backgroundColor: GameColors.surface.low,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
    marginBottom: 8,
  },
  themeOptionActive: {
    backgroundColor: GameColors.goldSoft,
    borderColor: GameColors.goldBorder,
  },
  themeOptionText: {
    color: GameColors.text.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  themeOptionTextActive: {
    color: GameColors.gold,
    fontWeight: '900',
  },
  themeCheck: {
    color: GameColors.gold,
    fontSize: 18,
    fontWeight: '900',
  },

  // Modal diário
  dailyOverlay: {
    flex: 1,
    backgroundColor: GameColors.overlay.modal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dailyBox: {
    backgroundColor: GameColors.bg.surfaceSoft,
    borderRadius: Radius.xl,
    padding: 32,
    alignItems: 'center',
    width: '82%',
    borderWidth: 2,
    borderColor: GameColors.gold,
    ...Elevation.goldGlow,
  },
  dailyEmoji: { fontSize: 58, marginBottom: 10 },
  dailyTitle: {
    color: GameColors.gold,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  dailyStreak: {
    color: GameColors.text.secondary,
    fontSize: 16,
    marginBottom: 22,
  },
  dailyXPBadge: {
    alignItems: 'center',
    backgroundColor: GameColors.goldSoft,
    borderRadius: Radius.md,
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    marginBottom: 26,
  },
  dailyXPText: {
    color: GameColors.gold,
    fontSize: 42,
    fontWeight: '900',
    lineHeight: 46,
  },
  dailyXPLabel: {
    color: GameColors.gold,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2,
  },
  dailyBtn: {
    backgroundColor: GameColors.gold,
    paddingVertical: 14,
    paddingHorizontal: 50,
    borderRadius: Radius.pill,
    ...Elevation.goldGlow,
  },
  dailyBtnText: {
    color: GameColors.text.onGold,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
});

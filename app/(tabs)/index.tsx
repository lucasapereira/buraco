import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, Platform, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { useStatsStore, DailyRewardInfo } from '../../store/statsStore';
import { useOnlineStore } from '../../store/onlineStore';
import { BotDifficulty, GameMode } from '../../game/engine';
import * as NavigationBar from 'expo-navigation-bar';
import Constants from 'expo-constants';

const APP_VERSION = Constants.expoConfig?.version ?? '?';

const DIFFICULTIES: { key: BotDifficulty; label: string; emoji: string; desc: string; color: string }[] = [
  {
    key: 'easy',
    label: 'Fácil',
    emoji: '🟢',
    desc: 'Joga sequências óbvias, nunca pega o lixo',
    color: '#2E7D32',
  },
  {
    key: 'medium',
    label: 'Médio',
    emoji: '🟡',
    desc: 'Estratégico, pega lixo quando vale a pena',
    color: '#F57F17',
  },
  {
    key: 'hard',
    label: 'Difícil',
    emoji: '🔴',
    desc: 'Memoriza descartes e joga defensivamente',
    color: '#B71C1C',
  },
];

const TARGETS = [1500, 3000, 5000];

export default function HomeScreen() {
  const router = useRouter();
  const { startNewGame, startLayoutTest, players, gameLog, winnerTeamId } = useGameStore();
  const { level, checkDailyReward, claimDailyReward } = useStatsStore();
  const { resetRoom, roomStatus } = useOnlineStore();
  const [difficulty, setDifficulty] = useState<BotDifficulty>('hard');
  const [targetScore, setTargetScore] = useState(1500);
  const [gameMode, setGameMode] = useState<GameMode>('classic');
  const [dailyReward, setDailyReward] = useState<DailyRewardInfo | null>(null);

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
    startNewGame(targetScore, difficulty, gameMode);
    router.replace('/(tabs)/explore' as any);
  };

  const handleRestart = () => {
    Alert.alert('Reiniciar', 'Tem certeza que deseja apagar a partida atual?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sim, Apagar', style: 'destructive', onPress: () => {
          if (roomStatus !== 'idle') resetRoom();
          startNewGame(targetScore, difficulty, gameMode);
      }}
    ]);
  };

  const handleContinue = () => {
    if (roomStatus !== 'idle') resetRoom();
    router.replace('/(tabs)/explore' as any);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#1B5E20' }} contentContainerStyle={styles.container} bounces={false}>
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
        style={styles.profileBtn}
        onPress={() => router.replace('/(tabs)/stats' as any)}
        activeOpacity={0.8}
      >
        <Text style={styles.profileBtnLevel}>Nv {level}</Text>
        <Text style={styles.profileBtnIcon}>👤</Text>
      </TouchableOpacity>

      {/* Título */}
      <View style={styles.titleBox}>
        <Text style={styles.title}>♠ BURACO ♠</Text>
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

      {/* Seletor de Dificuldade */}
      <Text style={styles.sectionTitle}>Nível de Dificuldade</Text>
      <View style={styles.diffRow}>
        {DIFFICULTIES.map(d => (
          <TouchableOpacity
            key={d.key}
            style={[
              styles.diffBtn,
              { borderColor: d.color },
              difficulty === d.key && { backgroundColor: d.color },
            ]}
            onPress={() => setDifficulty(d.key)}
            activeOpacity={0.8}
          >
            <Text style={styles.diffEmoji}>{d.emoji}</Text>
            <Text style={[styles.diffLabel, difficulty === d.key && { color: '#fff', fontWeight: '900' }]}>
              {d.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.diffDesc}>
        {DIFFICULTIES.find(d => d.key === difficulty)?.desc}
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
        style={styles.layoutBtn}
        onPress={() => { startLayoutTest(); router.replace('/(tabs)/explore' as any); }}
        activeOpacity={0.7}
      >
        <Text style={styles.layoutBtnText}>Layout</Text>
      </TouchableOpacity>

      <Text style={styles.version}>v{APP_VERSION}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#1B5E20',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 50,
  },
  titleBox: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 45,
    fontWeight: '900',
    color: '#FFD600',
    letterSpacing: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  subtitle: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 2,
    marginTop: 4,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    alignSelf: 'flex-start',
    marginBottom: 10,
    marginTop: 4,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 8,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  modeBtnActive: {
    backgroundColor: '#FFD600',
    borderColor: '#FFD600',
  },
  modeText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 17,
    fontWeight: '700',
  },
  modeTextActive: {
    color: '#1B5E20',
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
    borderRadius: 14,
    borderWidth: 2,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  diffEmoji: {
    fontSize: 25,
    marginBottom: 4,
  },
  diffLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 17,
    fontWeight: '700',
  },
  diffDesc: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  targetRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 36,
  },
  targetBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  targetBtnActive: {
    backgroundColor: '#FFD600',
    borderColor: '#FFD600',
  },
  targetText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 18,
    fontWeight: '700',
  },
  targetTextActive: {
    color: '#1B5E20',
    fontWeight: '900',
  },
  playBtn: {
    backgroundColor: '#FFD600',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 30,
    shadowColor: '#FFD600',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  playText: {
    color: '#1B5E20',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  layoutBtn: {
    position: 'absolute',
    bottom: 14,
    left: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  layoutBtnText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  version: {
    position: 'absolute',
    bottom: 16,
    right: 20,
    color: 'rgba(255,255,255,0.25)',
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
    gap: 4,
    backgroundColor: 'rgba(255,214,0,0.15)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,214,0,0.4)',
  },
  profileBtnLevel: {
    color: '#FFD600',
    fontSize: 14,
    fontWeight: '900',
  },
  profileBtnIcon: {
    fontSize: 18,
  },

  // Modal diário
  dailyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dailyBox: {
    backgroundColor: '#1B5E20',
    borderRadius: 24,
    padding: 30,
    alignItems: 'center',
    width: '80%',
    borderWidth: 2,
    borderColor: '#FFD600',
    shadowColor: '#FFD600',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 16,
  },
  dailyEmoji: { fontSize: 56, marginBottom: 8 },
  dailyTitle: {
    color: '#FFD600',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  dailyStreak: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 17,
    marginBottom: 20,
  },
  dailyXPBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,214,0,0.15)',
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: '#FFD600',
    marginBottom: 24,
  },
  dailyXPText: {
    color: '#FFD600',
    fontSize: 40,
    fontWeight: '900',
    lineHeight: 44,
  },
  dailyXPLabel: {
    color: '#FFD600',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2,
  },
  dailyBtn: {
    backgroundColor: '#FFD600',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 28,
  },
  dailyBtnText: {
    color: '#1B5E20',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
});

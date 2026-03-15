import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { BotDifficulty, GameMode } from '../../game/engine';
import { Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { useEffect } from 'react';

const { width: SW } = Dimensions.get('window');

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
  const startNewGame = useGameStore(s => s.startNewGame);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('hard');
  const [targetScore, setTargetScore] = useState(1500);
  const [gameMode, setGameMode] = useState<GameMode>('classic');

  const handleStart = () => {
    startNewGame(targetScore, difficulty, gameMode);
    router.replace('/(tabs)/explore' as any);
  };

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
      NavigationBar.setBehaviorAsync('inset-touch');
    }
  }, []);

  return (
    <View style={styles.container}>
      {/* Título */}
      <View style={styles.titleBox}>
        <Text style={styles.title}>♠ BURACO ♠</Text>
        <Text style={styles.subtitle}>STBL — Contra Robôs</Text>
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
          <Text style={[styles.modeText, gameMode === 'araujo_pereira' && styles.modeTextActive]}>Araujo Pereira</Text>
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

      {/* Botão Jogar */}
      <TouchableOpacity style={styles.playBtn} onPress={handleStart} activeOpacity={0.85}>
        <Text style={styles.playText}>🃏 JOGAR</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1B5E20',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  titleBox: {
    alignItems: 'center',
    marginBottom: 36,
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
    fontSize: 16,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 2,
    marginTop: 4,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
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
    fontSize: 15,
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
    fontSize: 15,
    fontWeight: '700',
  },
  diffDesc: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
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
    fontSize: 16,
    fontWeight: '700',
  },
  targetTextActive: {
    color: '#1B5E20',
    fontWeight: '900',
  },
  playBtn: {
    backgroundColor: '#FFD600',
    paddingVertical: 16,
    paddingHorizontal: 60,
    borderRadius: 30,
    shadowColor: '#FFD600',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  playText: {
    color: '#1B5E20',
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 2,
  },
});

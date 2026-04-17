import { useRouter } from 'expo-router';
import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ACHIEVEMENTS, getRank, LEVEL_THRESHOLDS } from '../../game/achievements';
import { useStatsStore } from '../../store/statsStore';

const CATEGORY_LABELS: Record<string, string> = {
  victories: '🏆 Vitórias',
  canastas:  '🃏 Canastas',
  score:     '💰 Pontuação',
  streak:    '🔥 Streak',
  special:   '⚡ Especiais',
};

const CATEGORIES = ['victories', 'canastas', 'score', 'streak', 'special'] as const;

export default function StatsScreen() {
  const router = useRouter();
  const stats = useStatsStore();

  const level = stats.level;
  const xp = stats.totalXP;
  const currentThreshold = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const nextThreshold = level < 20 ? LEVEL_THRESHOLDS[level] : LEVEL_THRESHOLDS[19];
  const xpInLevel = xp - currentThreshold;
  const xpNeeded = nextThreshold - currentThreshold;
  const progress = level >= 20 ? 1 : Math.min(xpInLevel / xpNeeded, 1);
  const rank = getRank(level);
  const winRate = stats.matchesPlayed > 0
    ? Math.round((stats.matchesWon / stats.matchesPlayed) * 100)
    : 0;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)' as any)} style={styles.backBtn}>
          <Text style={styles.backText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Perfil</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── CARD DE NÍVEL ─────────────────────────────────────────────── */}
        <View style={styles.levelCard}>
          <View style={styles.levelRow}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelNum}>{level}</Text>
            </View>
            <View style={styles.levelInfo}>
              <Text style={styles.rankText}>{rank}</Text>
              <Text style={styles.xpText}>
                {level >= 20 ? 'Nível máximo!' : `${xpInLevel.toLocaleString()} / ${xpNeeded.toLocaleString()} XP`}
              </Text>
            </View>
            <View>
              <Text style={styles.totalXPLabel}>XP Total</Text>
              <Text style={styles.totalXPValue}>{xp.toLocaleString()}</Text>
            </View>
          </View>

          {/* Barra de progresso */}
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          {level < 20 && (
            <Text style={styles.nextLevel}>Nível {level + 1}: {getRank(level + 1)}</Text>
          )}
        </View>

        {/* ── STREAK ────────────────────────────────────────────────────── */}
        <View style={styles.streakCard}>
          <View style={styles.streakRow}>
            <Text style={styles.streakIcon}>🔥</Text>
            <View style={styles.streakTexts}>
              <Text style={styles.streakValue}>{stats.currentStreak} dia{stats.currentStreak !== 1 ? 's' : ''} seguidos</Text>
              <Text style={styles.streakSub}>Maior sequência: {stats.longestStreak} dias</Text>
            </View>
          </View>
        </View>

        {/* ── ESTATÍSTICAS ──────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Estatísticas</Text>
        <View style={styles.statsGrid}>
          <StatBox label="Partidas" value={stats.matchesPlayed.toString()} />
          <StatBox label="Vitórias" value={stats.matchesWon.toString()} color="#4CAF50" />
          <StatBox label="Taxa" value={`${winRate}%`} color="#FFD600" />
          <StatBox label="Rodadas" value={stats.roundsPlayed.toString()} />
          <StatBox label="Pts Totais" value={stats.totalPointsEarned.toLocaleString()} color="#FFD600" />
          <StatBox label="Melhor Rdada" value={stats.biggestRoundScore.toLocaleString()} color="#FF9800" />
          <StatBox label="Canastas" value={stats.totalCanastas.toString()} />
          <StatBox label="Limpas" value={stats.totalCleanCanastas.toString()} color="#4CAF50" />
          <StatBox label="+500" value={stats.total500Canastas.toString()} color="#FFD600" />
          <StatBox label="+1000" value={stats.total1000Canastas.toString()} color="#FF5722" />
          <StatBox label="Batidas" value={stats.totalBatidas.toString()} />
          <StatBox label="Seq. Vitórias" value={`${stats.currentWinStreak} / ${stats.longestWinStreak}`} />
        </View>

        {/* ── CONQUISTAS ────────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>
          Conquistas ({stats.unlockedAchievements.length}/{ACHIEVEMENTS.length})
        </Text>

        {CATEGORIES.map((cat) => {
          const catAchievements = ACHIEVEMENTS.filter((a) => a.category === cat);
          return (
            <View key={cat} style={styles.categoryBlock}>
              <Text style={styles.categoryTitle}>{CATEGORY_LABELS[cat]}</Text>
              <View style={styles.achievementsGrid}>
                {catAchievements.map((a) => {
                  const unlocked = stats.unlockedAchievements.includes(a.id);
                  return (
                    <View key={a.id} style={[styles.achievementBadge, unlocked && styles.achievementUnlocked]}>
                      <Text style={[styles.achievementIcon, !unlocked && styles.achievementIconLocked]}>
                        {unlocked ? a.icon : '🔒'}
                      </Text>
                      <Text style={[styles.achievementTitle, !unlocked && styles.achievementTitleLocked]}>
                        {a.title}
                      </Text>
                      {unlocked && (
                        <Text style={styles.achievementXP}>+{a.xpReward} XP</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1B5E20' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0D3B1E',
  },
  backBtn: { padding: 4 },
  backText: { color: '#FFD600', fontSize: 15, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1 },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Level card
  levelCard: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,214,0,0.3)',
  },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  levelBadge: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFD600',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelNum: { fontSize: 24, fontWeight: '900', color: '#1B5E20' },
  levelInfo: { flex: 1 },
  rankText: { color: '#FFD600', fontSize: 18, fontWeight: '900' },
  xpText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  totalXPLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, textAlign: 'right' },
  totalXPValue: { color: '#fff', fontSize: 16, fontWeight: '900', textAlign: 'right' },
  progressBg: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    backgroundColor: '#FFD600',
    borderRadius: 4,
  },
  nextLevel: { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 },

  // Streak card
  streakCard: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,152,0,0.3)',
  },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  streakIcon: { fontSize: 32 },
  streakTexts: { flex: 1 },
  streakValue: { color: '#FF9800', fontSize: 18, fontWeight: '900' },
  streakSub: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },

  // Section
  sectionTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  statBox: {
    width: '30.5%',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '900' },
  statLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 2, textAlign: 'center' },

  // Achievements
  categoryBlock: { marginBottom: 20 },
  categoryTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  achievementsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  achievementBadge: {
    width: '30.5%',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  achievementUnlocked: {
    backgroundColor: 'rgba(255,214,0,0.1)',
    borderColor: 'rgba(255,214,0,0.4)',
  },
  achievementIcon: { fontSize: 26, marginBottom: 4 },
  achievementIconLocked: { opacity: 0.4 },
  achievementTitle: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  achievementTitleLocked: { color: 'rgba(255,255,255,0.3)' },
  achievementXP: {
    color: '#FFD600',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
});

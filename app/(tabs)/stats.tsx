import { useRouter } from 'expo-router';
import React from 'react';
import {
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
import { ScreenBackground } from '../../components/ScreenBackground';
import { GameColors, Radius, Elevation } from '../../constants/colors';

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
    <ScreenBackground>
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
          <StatBox label="Vitórias" value={stats.matchesWon.toString()} color={GameColors.success} />
          <StatBox label="Taxa" value={`${winRate}%`} color={GameColors.gold} />
          <StatBox label="Rodadas" value={stats.roundsPlayed.toString()} />
          <StatBox label="Pts Totais" value={stats.totalPointsEarned.toLocaleString()} color={GameColors.gold} />
          <StatBox label="Melhor Rdada" value={stats.biggestRoundScore.toLocaleString()} color={GameColors.warning} />
          <StatBox label="Canastas" value={stats.totalCanastas.toString()} />
          <StatBox label="Limpas" value={stats.totalCleanCanastas.toString()} color={GameColors.success} />
          <StatBox label="+500" value={stats.total500Canastas.toString()} color={GameColors.gold} />
          <StatBox label="+1000" value={stats.total1000Canastas.toString()} color={GameColors.canasta.c1000Border} />
          <StatBox label="Batidas" value={stats.totalBatidas.toString()} />
          <StatBox label="Seq. Vitórias" value={`${stats.currentWinStreak} / ${stats.longestWinStreak}`} />
          <StatBox label="Rating Online" value={stats.onlineRating.toString()} color={GameColors.info} />
          <StatBox label="Online V/D" value={`${stats.onlineMatchesWon}/${stats.onlineMatchesPlayed - stats.onlineMatchesWon}`} color={GameColors.info} />
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
    </ScreenBackground>
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
  container: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: GameColors.bg.header,
    borderBottomWidth: 1,
    borderBottomColor: GameColors.surface.border,
  },
  backBtn: { padding: 4 },
  backText: { color: GameColors.gold, fontSize: 15, fontWeight: '700' },
  headerTitle: { color: GameColors.text.primary, fontSize: 18, fontWeight: '900', letterSpacing: 1.5 },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Level card
  levelCard: {
    backgroundColor: GameColors.surface.dark,
    borderRadius: Radius.lg,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: GameColors.goldBorder,
    ...Elevation.card,
  },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  levelBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: GameColors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    ...Elevation.goldGlow,
  },
  levelNum: { fontSize: 26, fontWeight: '900', color: GameColors.text.onGold },
  levelInfo: { flex: 1 },
  rankText: { color: GameColors.gold, fontSize: 18, fontWeight: '900' },
  xpText: { color: GameColors.text.muted, fontSize: 12, marginTop: 2 },
  totalXPLabel: { color: GameColors.text.muted, fontSize: 10, textAlign: 'right' },
  totalXPValue: { color: GameColors.text.primary, fontSize: 16, fontWeight: '900', textAlign: 'right' },
  progressBg: {
    height: 9,
    backgroundColor: GameColors.surface.high,
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: 9,
    backgroundColor: GameColors.gold,
    borderRadius: 5,
  },
  nextLevel: { color: GameColors.text.muted, fontSize: 11, marginTop: 6 },

  // Streak card
  streakCard: {
    backgroundColor: GameColors.surface.dark,
    borderRadius: Radius.md,
    padding: 16,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,167,38,0.3)',
    ...Elevation.card,
  },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  streakIcon: { fontSize: 34 },
  streakTexts: { flex: 1 },
  streakValue: { color: GameColors.warning, fontSize: 18, fontWeight: '900' },
  streakSub: { color: GameColors.text.muted, fontSize: 12, marginTop: 2 },

  // Section
  sectionTitle: {
    color: GameColors.text.secondary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
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
    backgroundColor: GameColors.surface.dark,
    borderRadius: Radius.sm,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GameColors.surface.border,
  },
  statValue: { color: GameColors.text.primary, fontSize: 18, fontWeight: '900' },
  statLabel: { color: GameColors.text.muted, fontSize: 10, marginTop: 3, textAlign: 'center', letterSpacing: 0.3 },

  // Achievements
  categoryBlock: { marginBottom: 22 },
  categoryTitle: {
    color: GameColors.text.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  achievementsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  achievementBadge: {
    width: '30.5%',
    backgroundColor: GameColors.surface.dark,
    borderRadius: Radius.sm,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GameColors.surface.border,
  },
  achievementUnlocked: {
    backgroundColor: GameColors.goldSoft,
    borderColor: GameColors.goldBorder,
  },
  achievementIcon: { fontSize: 28, marginBottom: 4 },
  achievementIconLocked: { opacity: 0.35 },
  achievementTitle: {
    color: GameColors.text.primary,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  achievementTitleLocked: { color: GameColors.text.faint },
  achievementXP: {
    color: GameColors.gold,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
});

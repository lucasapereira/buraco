/**
 * Tela de Ranking — duas tabs (vs Bot / Online).
 *
 * - Lista todos os jogadores ordenados por (vitorias - derrotas) desc, tie por vitórias
 * - Tap numa linha abre modal de detalhe do perfil
 * - Avatar = inicial colorida (sem upload de imagem)
 * - Marca 🔥 quem está invicto vs bot (currentBotWinStreak >= 5 e nunca perdeu)
 */

import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { getRank } from '../../game/achievements';
import { useProfileStore, UserProfile, MonthlyChampion } from '../../store/profileStore';
import { ScreenBackground } from '../../components/ScreenBackground';
import { GameColors, Radius, Elevation } from '../../constants/colors';

type Board = 'bot' | 'online';

const AVATAR_COLORS = ['#FF5252', '#4CAF50', '#2196F3', '#FFD600', '#9C27B0', '#FF9800', '#00BCD4', '#E91E63'];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function fmtScore(p: UserProfile, board: Board): { wins: number; losses: number; total: number; diff: number } {
  if (board === 'bot') {
    const wins = p.botMatchesWon ?? 0;
    const total = p.botMatchesPlayed ?? 0;
    const losses = total - wins;
    return { wins, losses, total, diff: wins - losses };
  } else {
    const wins = p.onlineMatchesWon ?? 0;
    const total = p.onlineMatchesPlayed ?? 0;
    const losses = total - wins;
    return { wins, losses, total, diff: wins - losses };
  }
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'agora';
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h`;
  return `${Math.floor(sec / 86400)} d`;
}

export default function RankingScreen() {
  useKeepAwake();
  const router = useRouter();
  const { loadAllProfiles, loadMonthlyChampions, finalizePastMonthlyChampions, myUid } = useProfileStore();

  const [board, setBoard] = useState<Board>('bot');
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [champions, setChampions] = useState<MonthlyChampion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserProfile | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      await finalizePastMonthlyChampions();
      const [list, champs] = await Promise.all([loadAllProfiles(), loadMonthlyChampions()]);
      if (mounted) {
        setProfiles(list);
        setChampions(champs);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Conta troféus por uid
  const trophiesByUid = useMemo(() => {
    const map: Record<string, number> = {};
    champions.forEach(c => { map[c.uid] = (map[c.uid] ?? 0) + 1; });
    return map;
  }, [champions]);

  const sorted = useMemo(() => {
    const arr = profiles
      .map(p => ({ p, score: fmtScore(p, board) }))
      .filter(x => x.score.total > 0); // só lista quem jogou pelo menos 1 partida do tipo
    arr.sort((a, b) => {
      if (b.score.diff !== a.score.diff) return b.score.diff - a.score.diff;
      if (b.score.wins !== a.score.wins) return b.score.wins - a.score.wins;
      return (b.p.onlineRating ?? 1000) - (a.p.onlineRating ?? 1000);
    });
    return arr;
  }, [profiles, board]);

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)' as any)} style={styles.backBtn}>
          <Text style={styles.backText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🏆 Ranking</Text>
        <View style={{ width: 70 }} />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, board === 'bot' && styles.tabActive]}
          onPress={() => setBoard('bot')}
        >
          <Text style={[styles.tabText, board === 'bot' && styles.tabTextActive]}>🤖 vs Bot</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, board === 'online' && styles.tabActive]}
          onPress={() => setBoard('online')}
        >
          <Text style={[styles.tabText, board === 'online' && styles.tabTextActive]}>🌐 Online (PvP)</Text>
        </TouchableOpacity>
      </View>

      {!loading && board === 'online' && champions.length > 0 && (
        <View style={styles.championsBar}>
          <Text style={styles.championsTitle}>🏆 Campeões do Mês</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.championsRow}>
            {champions.slice(0, 12).map(c => (
              <View key={c.month} style={styles.championChip}>
                <Text style={styles.championMonth}>{c.month}</Text>
                <Text style={styles.championName} numberOfLines={1}>👑 {c.displayName}</Text>
                <Text style={styles.championRating}>{c.rating} pts</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#FFD600" size="large" />
          <Text style={styles.loadingText}>Carregando...</Text>
        </View>
      ) : sorted.length === 0 ? (
        <View style={styles.loadingBox}>
          <Text style={styles.emptyText}>
            {board === 'bot'
              ? 'Ninguém tem partidas vs bot ainda.'
              : 'Ninguém tem partidas online ainda.'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {sorted.map((row, idx) => {
            const { p, score } = row;
            const isMe = p.uid === myUid;
            const invicto = board === 'bot'
              && (p.botMatchesPlayed ?? 0) >= 5
              && (p.currentBotWinStreak ?? 0) === (p.botMatchesPlayed ?? 0);
            return (
              <TouchableOpacity
                key={p.uid}
                style={[styles.row, isMe && styles.rowMe]}
                onPress={() => setSelected(p)}
                activeOpacity={0.7}
              >
                <Text style={styles.rank}>{idx + 1}</Text>
                <View style={[styles.avatar, { backgroundColor: avatarColor(p.displayName) }]}>
                  <Text style={styles.avatarText}>{initial(p.displayName)}</Text>
                </View>
                <View style={styles.nameCol}>
                  <Text style={styles.name}>
                    {p.displayName}
                    {trophiesByUid[p.uid] > 0 && <Text style={styles.fire}>  {'🏆'.repeat(Math.min(trophiesByUid[p.uid], 3))}</Text>}
                    {invicto && <Text style={styles.fire}>  🔥</Text>}
                    {isMe && <Text style={styles.meTag}>  (você)</Text>}
                  </Text>
                  <Text style={styles.subText}>
                    Nível {p.level ?? 1} · {getRank(p.level ?? 1)}
                    {board === 'online' && ` · ${Math.round(p.onlineRating ?? 1000)} pts`}
                  </Text>
                </View>
                <View style={styles.scoreCol}>
                  <Text style={styles.scoreMain}>{score.wins}–{score.losses}</Text>
                  <Text style={styles.scoreSub}>{score.total} jogos</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ProfileDetailModal
        profile={selected}
        onClose={() => setSelected(null)}
        myProfile={profiles.find(p => p.uid === myUid) ?? null}
        championMonths={selected ? champions.filter(c => c.uid === selected.uid).map(c => c.month) : []}
      />
      </SafeAreaView>
    </ScreenBackground>
  );
}

// ── Modal de detalhe ──────────────────────────────────────────────────────────
function ProfileDetailModal({ profile, onClose, myProfile, championMonths }: { profile: UserProfile | null; onClose: () => void; myProfile: UserProfile | null; championMonths: string[] }) {
  if (!profile) return null;
  const p = profile;
  const h2h = (() => {
    if (!myProfile || myProfile.uid === p.uid) return null;
    const matches = (myProfile.recentMatches ?? []).filter(m =>
      m.mode === 'online' && (m.opponentNames ?? []).includes(p.displayName)
    );
    if (matches.length === 0) return null;
    const wins = matches.filter(m => m.won).length;
    return { wins, losses: matches.length - wins, total: matches.length };
  })();
  const botTotal = p.botMatchesPlayed ?? 0;
  const botWon = p.botMatchesWon ?? 0;
  const botLost = botTotal - botWon;
  const onlineTotal = p.onlineMatchesPlayed ?? 0;
  const onlineWon = p.onlineMatchesWon ?? 0;
  const onlineLost = onlineTotal - onlineWon;
  const invicto = botTotal >= 5 && (p.currentBotWinStreak ?? 0) === botTotal;
  const rank = getRank(p.level ?? 1);

  return (
    <Modal visible={!!profile} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBox}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>

            {/* Header com avatar + nome */}
            <View style={styles.detailHeader}>
              <View style={[styles.detailAvatar, { backgroundColor: avatarColor(p.displayName) }]}>
                <Text style={styles.detailAvatarText}>{initial(p.displayName)}</Text>
              </View>
              <Text style={styles.detailName}>{p.displayName}</Text>
              <Text style={styles.detailRank}>Nível {p.level ?? 1} · {rank}</Text>
              {p.lastSeen && <Text style={styles.detailLastSeen}>Visto {timeAgo(p.lastSeen)} atrás</Text>}
            </View>

            {/* Bot */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🤖 vs Bot</Text>
              <Stat label="Partidas" value={botTotal} />
              <Stat label="Vitórias" value={botWon} />
              <Stat label="Derrotas" value={botLost} />
              <Stat label="Streak atual" value={`${p.currentBotWinStreak ?? 0} 🔥`} />
              <Stat label="Maior streak" value={p.longestBotWinStreak ?? 0} />
              {invicto && (
                <View style={styles.invictoBadge}>
                  <Text style={styles.invictoText}>🏅 INVICTO vs BOT — {botTotal} partidas, nenhuma derrota!</Text>
                </View>
              )}
            </View>

            {/* Online */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🌐 Online (PvP)</Text>
              <Stat label="Partidas" value={onlineTotal} />
              <Stat label="Vitórias" value={onlineWon} />
              <Stat label="Derrotas" value={onlineLost} />
              <Stat label="Rating" value={Math.round(p.onlineRating ?? 1000)} />
            </View>

            {/* Troféus mensais */}
            {championMonths.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>🏆 Troféus mensais ({championMonths.length})</Text>
                <View style={styles.trophyRow}>
                  {championMonths.map(m => (
                    <View key={m} style={styles.trophyBadge}>
                      <Text style={styles.trophyEmoji}>🏆</Text>
                      <Text style={styles.trophyMonth}>{m}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Confronto direto */}
            {h2h && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>⚔️ Confronto direto</Text>
                <View style={styles.h2hBox}>
                  <Text style={styles.h2hLine}>Você × {p.displayName}</Text>
                  <Text style={styles.h2hScore}>
                    <Text style={{ color: '#B9F6CA' }}>{h2h.wins}V</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.7)' }}> – </Text>
                    <Text style={{ color: '#FF8A80' }}>{h2h.losses}D</Text>
                  </Text>
                  <Text style={styles.h2hSub}>em {h2h.total} partidas online</Text>
                </View>
              </View>
            )}

            {/* Canastas */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🃏 Canastas</Text>
              <Stat label="Limpas (200)" value={(p.totalCleanCanastas ?? 0) - (p.total500Canastas ?? 0) - (p.total1000Canastas ?? 0)} />
              <Stat label="500 (13 cartas)" value={p.total500Canastas ?? 0} />
              <Stat label="1000 (14 cartas)" value={p.total1000Canastas ?? 0} />
              <Stat label="Sujas (100)" value={p.totalDirtyCanastas ?? 0} />
              <Stat label="Total" value={p.totalCanastas ?? 0} />
              <Stat label="Batidas" value={p.totalBatidas ?? 0} />
            </View>

            {/* Recordes */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📊 Recordes</Text>
              <Stat label="Maior pontuação numa rodada" value={p.biggestRoundScore ?? 0} />
              <Stat label="Maior diferença numa partida" value={p.biggestMatchDiff ?? 0} />
              <Stat label="Pontos totais" value={p.totalPointsEarned ?? 0} />
              <Stat label="XP" value={p.totalXP ?? 0} />
              <Stat label="Maior streak diário" value={p.longestStreak ?? 0} />
            </View>

            {/* Histórico */}
            {p.recentMatches && p.recentMatches.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📜 Últimas partidas</Text>
                {p.recentMatches.map((m, i) => (
                  <View key={i} style={styles.matchRow}>
                    <Text style={[styles.matchResult, { color: m.won ? '#B9F6CA' : '#FF8A80' }]}>
                      {m.won ? 'V' : 'D'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.matchScore}>
                        {m.myScore} × {m.theirScore} {m.mode === 'bot' ? '· bot' : '· online'}
                        {typeof m.ratingDelta === 'number' && (
                          <Text style={{ color: m.ratingDelta >= 0 ? '#B9F6CA' : '#FF8A80' }}>
                            {' '}({m.ratingDelta >= 0 ? '+' : ''}{m.ratingDelta})
                          </Text>
                        )}
                      </Text>
                      {m.opponentNames && m.opponentNames.length > 0 && (
                        <Text style={styles.matchOpps}>vs {m.opponentNames.join(', ')}</Text>
                      )}
                    </View>
                    <Text style={styles.matchTime}>{timeAgo(m.ts)}</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>Fechar</Text>
            </TouchableOpacity>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  backText: { color: GameColors.gold, fontSize: 16, fontWeight: '700' },
  headerTitle: { color: GameColors.text.primary, fontSize: 22, fontWeight: '900' },

  tabs: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 10 },
  tab: {
    flex: 1, paddingVertical: 11, borderRadius: Radius.sm,
    backgroundColor: GameColors.surface.low,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GameColors.surface.border,
  },
  tabActive: { backgroundColor: GameColors.gold, borderColor: GameColors.gold, ...Elevation.goldGlow },
  tabText: { color: GameColors.text.secondary, fontSize: 15, fontWeight: '700' },
  tabTextActive: { color: GameColors.text.onGold, fontWeight: '900' },

  list: { flex: 1 },
  listContent: { padding: 16, paddingTop: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: GameColors.surface.low,
    borderRadius: Radius.md,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
  },
  rowMe: {
    backgroundColor: GameColors.goldSoft,
    borderColor: GameColors.goldBorder,
  },
  rank: { color: GameColors.text.muted, fontSize: 16, fontWeight: '900', minWidth: 26, textAlign: 'right' },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)',
  },
  avatarText: { color: GameColors.text.primary, fontSize: 18, fontWeight: '900' },
  nameCol: { flex: 1 },
  name: { color: GameColors.text.primary, fontSize: 16, fontWeight: '800' },
  fire: { fontSize: 16 },
  meTag: { color: GameColors.gold, fontSize: 13, fontWeight: '700' },
  subText: { color: GameColors.text.muted, fontSize: 12, marginTop: 2 },
  scoreCol: { alignItems: 'flex-end' },
  scoreMain: { color: GameColors.successSoft, fontSize: 17, fontWeight: '900' },
  scoreSub: { color: GameColors.text.muted, fontSize: 11 },

  championsBar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: GameColors.surface.border,
  },
  championsTitle: { color: GameColors.gold, fontSize: 12, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  championsRow: { gap: 8, paddingRight: 16 },
  championChip: {
    backgroundColor: GameColors.goldSoft,
    borderWidth: 1,
    borderColor: GameColors.goldBorder,
    borderRadius: Radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 120,
    maxWidth: 160,
  },
  championMonth: { color: GameColors.text.muted, fontSize: 10, fontWeight: '700' },
  championName: { color: GameColors.text.primary, fontSize: 13, fontWeight: '800', marginTop: 2 },
  championRating: { color: GameColors.successSoft, fontSize: 11, fontWeight: '700', marginTop: 1 },

  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: GameColors.text.secondary, marginTop: 12 },
  emptyText: { color: GameColors.text.secondary, fontSize: 16, textAlign: 'center', paddingHorizontal: 40 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: GameColors.overlay.modalDeep,
    justifyContent: 'center',
    padding: 16,
  },
  modalBox: {
    backgroundColor: GameColors.bg.surfaceSoft,
    borderRadius: Radius.lg,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: GameColors.surface.border,
    ...Elevation.modal,
  },
  modalScroll: { padding: 20 },
  detailHeader: { alignItems: 'center', marginBottom: 16 },
  detailAvatar: {
    width: 84, height: 84, borderRadius: 42,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 3, borderColor: GameColors.goldBorder,
  },
  detailAvatarText: { color: GameColors.text.primary, fontSize: 36, fontWeight: '900' },
  detailName: { color: GameColors.text.primary, fontSize: 24, fontWeight: '900' },
  detailRank: { color: GameColors.gold, fontSize: 14, fontWeight: '700', marginTop: 4 },
  detailLastSeen: { color: GameColors.text.muted, fontSize: 12, marginTop: 2 },

  section: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: GameColors.surface.border },
  sectionTitle: { color: GameColors.gold, fontSize: 16, fontWeight: '900', marginBottom: 10, letterSpacing: 0.5 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  statLabel: { color: GameColors.text.secondary, fontSize: 14 },
  statValue: { color: GameColors.text.primary, fontSize: 14, fontWeight: '700' },
  invictoBadge: {
    marginTop: 12, padding: 12,
    backgroundColor: GameColors.goldSoft,
    borderWidth: 1, borderColor: GameColors.gold,
    borderRadius: Radius.sm,
  },
  invictoText: { color: GameColors.gold, fontSize: 13, fontWeight: '900', textAlign: 'center' },

  trophyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trophyBadge: {
    backgroundColor: GameColors.goldSoft,
    borderWidth: 1,
    borderColor: GameColors.goldBorder,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  trophyEmoji: { fontSize: 18 },
  trophyMonth: { color: GameColors.gold, fontSize: 10, fontWeight: '700' },

  h2hBox: { alignItems: 'center', paddingVertical: 8 },
  h2hLine: { color: GameColors.text.secondary, fontSize: 14, fontWeight: '700' },
  h2hScore: { fontSize: 28, fontWeight: '900', marginVertical: 6 },
  h2hSub: { color: GameColors.text.muted, fontSize: 12 },

  matchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 10 },
  matchResult: { fontSize: 18, fontWeight: '900', minWidth: 20, textAlign: 'center' },
  matchScore: { color: GameColors.text.primary, fontSize: 13 },
  matchOpps: { color: GameColors.text.muted, fontSize: 11, marginTop: 1 },
  matchTime: { color: GameColors.text.faint, fontSize: 11 },

  closeBtn: {
    marginTop: 22, paddingVertical: 14, borderRadius: Radius.sm,
    backgroundColor: GameColors.gold, alignItems: 'center',
    ...Elevation.goldGlow,
  },
  closeBtnText: { color: GameColors.text.onGold, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
});

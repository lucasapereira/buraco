import React, { useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, Alert, Modal, Dimensions, Platform, StatusBar,
} from 'react-native';
import { useGameStore } from '../../store/gameStore';
import { Hand } from '../../components/Hand';
import { Card } from '../../components/Card';
import { useBotAI } from '../../hooks/useBotAI';
import { checkCanasta, validateSequence, canTakePile } from '../../game/rules';
import { calculateLiveScore, calculateCardPoints } from '../../game/engine';
import { useRouter } from 'expo-router';
import { EventBanner, EventLog } from '../../components/EventBanner';
import { cardLabel as getCardLabel } from '../../game/deck';

const { width: SW } = Dimensions.get('window');

export default function GameScreen() {
  const {
    players, deck, pile, deads, teams, currentTurnPlayerId,
    turnPhase, roundOver, winnerTeamId, matchScores, targetScore,
    drawFromDeck, drawFromPile, discard, playCards, addToExistingGame,
    startNewRound, startNewGame,
    gameLog, lastDrawnCardId, mustPlayPileTopId,
  } = useGameStore();

  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const router = useRouter();

  useBotAI();

  const user = players.find(p => p.id === 'user');
  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Volte e inicie um Novo Jogo</Text>
      </View>
    );
  }

  const isMyTurn = currentTurnPlayerId === 'user';
  const myTeamGames = teams['team-1'].games;
  const opTeamGames = teams['team-2'].games;

  // === HANDLERS ===
  const handleToggleCard = (cardId: string) => {
    setSelectedCards(prev =>
      prev.includes(cardId) ? prev.filter(id => id !== cardId) : [...prev, cardId]
    );
  };

  const handleDrawDeck = () => {
    if (!isMyTurn) {
      const current = players.find(p => p.id === currentTurnPlayerId);
      Alert.alert('Aguarde', `É a vez de ${current?.name || 'outro jogador'}. Fase: ${turnPhase}`);
      return;
    }
    if (turnPhase !== 'draw') {
      Alert.alert('Já comprou', 'Você já comprou neste turno. Baixe jogos ou selecione 1 carta e descarte.');
      return;
    }
    drawFromDeck('user');
  };

  const handleDrawPile = () => {
    if (!isMyTurn) {
      const current = players.find(p => p.id === currentTurnPlayerId);
      Alert.alert('Aguarde', `É a vez de ${current?.name || 'outro jogador'}.`);
      return;
    }
    if (turnPhase !== 'draw') {
      Alert.alert('Já comprou', 'Você já comprou neste turno.');
      return;
    }
    if (pile.length === 0) {
      Alert.alert('Lixo vazio', 'O lixo está vazio.');
      return;
    }
    // Verifica regra: precisa ter jogo com o topo do lixo
    if (!canTakePile(user.hand, pile)) {
      const topCard = pile[pile.length - 1];
      Alert.alert(
        '❌ Não pode pegar o lixo',
        `Você precisa ter 2 cartas para montar um jogo com o topo do lixo.`
      );
      return;
    }
    drawFromPile('user');
  };

  const handleDiscard = () => {
    if (!isMyTurn || turnPhase !== 'play') return;
    if (mustPlayPileTopId !== null) {
      const pileTopStillInHand = user.hand.some(c => c.id === mustPlayPileTopId);
      if (pileTopStillInHand) {
        Alert.alert(
          '⚠️ Baixe o jogo primeiro',
          'Você pegou o lixo e deve baixar um jogo usando a carta do topo antes de descartar.'
        );
        return;
      }
      // Carta não está mais na mão — foi jogada, deixa continuar
    }
    if (selectedCards.length !== 1) {
      Alert.alert('Selecione 1 carta', 'Para descartar, selecione exatamente 1 carta.');
      return;
    }
    discard('user', selectedCards[0]);
    setSelectedCards([]);
  };

  const handlePlayCards = () => {
    if (!isMyTurn || turnPhase !== 'play') return;
    if (mustPlayPileTopId && !selectedCards.includes(mustPlayPileTopId)) {
      Alert.alert('⚠️ Regra do Lixo', 'Sua primeira jogada DEVE ser com a carta comprada do topo do lixo para formar um NOVO jogo de pelo menos 3 cartas.');
      return;
    }
    if (selectedCards.length < 3) {
      Alert.alert('Mínimo 3 cartas', 'Selecione no mínimo 3 cartas para baixar um jogo STBL.');
      return;
    }
    const success = playCards('user', selectedCards);
    if (success) {
      setSelectedCards([]);
    } else {
      Alert.alert('Sequência inválida', 'As cartas selecionadas não formam uma sequência válida no STBL.\n\nLembre: mesmo naipe, valores consecutivos, máximo 1 curinga (2).');
    }
  };

  const handleAddToGame = (gameIndex: number) => {
    if (!isMyTurn || turnPhase !== 'play') return;
    if (mustPlayPileTopId) {
      Alert.alert('⚠️ Regra do Lixo', 'Você deve PRIMEIRO baixar um NOVO jogo usando a carta do topo do lixo antes de adicionar cartas a jogos existentes.');
      return;
    }
    if (selectedCards.length === 0) {
      Alert.alert('Selecione cartas', 'Selecione as cartas da sua mão que deseja adicionar a este jogo.');
      return;
    }
    const success = addToExistingGame('user', selectedCards, gameIndex);
    if (success) {
      setSelectedCards([]);
    } else {
      Alert.alert('Inválido', 'As cartas selecionadas não encaixam neste jogo.');
    }
  };

  // Indicador visual da fase
  const phaseLabel = turnPhase === 'draw' ? '🃏 COMPRE' : '🎴 JOGUE/DESCARTE';
  const phaseColor = turnPhase === 'draw' ? '#FF9800' : '#4CAF50';

  // Placar acumulado
  const myAccum = matchScores['team-1'];
  const opAccum = matchScores['team-2'];
  // Pontos vivos da rodada (jogos já na mesa)
  const myLive = calculateLiveScore(teams['team-1']);
  const opLive = calculateLiveScore(teams['team-2']);
  // Penalidade estimada das cartas na mão
  const myHandPenalty = players
    .filter(p => p.teamId === 'team-1')
    .reduce((sum, p) => sum + p.hand.reduce((s, c) => s + calculateCardPoints(c), 0), 0);
  const opHandPenalty = players
    .filter(p => p.teamId === 'team-2')
    .reduce((sum, p) => sum + p.hand.reduce((s, c) => s + calculateCardPoints(c), 0), 0);
  // Score total atual = acumulado + jogos na mesa esta rodada
  const myTotal = myAccum + myLive;
  const opTotal = opAccum + opLive;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor="#0D3B1E" barStyle="light-content" translucent={false} />
      {/* HEADER */}
      <View style={styles.header}>
        {/* ☰ + NÓS lado esquerdo */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => setShowMenu(true)} style={styles.menuBtn}>
            <Text style={styles.menuBtnText}>☰</Text>
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.scoreLabel}>NÓS</Text>
            <Text style={styles.scoreMain}>{myTotal}</Text>
            {myLive > 0 && <Text style={styles.scoreLive}>+{myLive} rodada</Text>}
          </View>
        </View>
        {/* Centro: turno */}
        <View style={styles.turnBox}>
          <Text style={styles.turnName}>
            {isMyTurn ? 'SUA VEZ' : players.find(p => p.id === currentTurnPlayerId)?.name}
          </Text>
          {isMyTurn && (
            <Text style={[styles.phaseLabel, { backgroundColor: phaseColor }]}>{phaseLabel}</Text>
          )}
          <Text style={styles.targetText}>Meta: {targetScore}</Text>
        </View>
        {/* ELES lado direito */}
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.scoreLabel}>ELES</Text>
          <Text style={[styles.scoreMain, { color: '#FF8A80' }]}>{opTotal}</Text>
          {opLive > 0 && <Text style={styles.scoreLive}>+{opLive} rodada</Text>}
        </View>
      </View>

      {/* BANNER DE EVENTO — no fluxo normal, não absolute */}
      <EventBanner events={gameLog} />

      {/* BOARD */}
      <View style={styles.board}>
        {/* Jogos montados */}
        <ScrollView style={styles.gamesScroll} showsVerticalScrollIndicator={false}>

          {/* Nossos jogos */}
          <Text style={styles.sectionLabel}>🟢 Nossos Jogos</Text>
          {myTeamGames.length === 0 && <Text style={styles.emptyGames}>Nenhum jogo ainda</Text>}
          <View style={styles.gamesGrid}>
            {myTeamGames.map((gameCards, idx) => {
              const canasta = checkCanasta(gameCards);
              const canAdd = (() => {
                if (!isMyTurn || turnPhase !== 'play' || selectedCards.length === 0) return false;
                const selCards = user.hand.filter(c => selectedCards.includes(c.id));
                const combined = [...gameCards, ...selCards];
                return combined.length >= 3 && validateSequence(combined);
              })();
              const normalCards = gameCards.filter(c => !c.isJoker);
              const hasJoker = gameCards.some(c => c.isJoker);
              // No compacto: extremos das cartas NORMAIS (sem curinga)
              const compactFirst = normalCards[0] ?? gameCards[0];
              const compactLast = normalCards[normalCards.length - 1] ?? gameCards[gameCards.length - 1];
              const middleCount = gameCards.length - 2;
              const compact = gameCards.length >= 6;
              return (
                <TouchableOpacity
                  key={`my-${idx}`}
                  style={[
                    styles.gameCard,
                    canasta !== 'none' && (canasta === 'clean' ? styles.cleanCanasta : styles.dirtyCanasta),
                    canAdd && styles.gameCardHighlight,
                  ]}
                  onPress={() => handleAddToGame(idx)}
                  activeOpacity={0.6}
                  hitSlop={{ top: 20, bottom: 20, left: 15, right: 15 }}
                >
                  {compact ? (
                    // Modo compacto: extremos normais + badge curinga no meio
                    <>
                      <Card card={compactFirst} small />
                      <View style={styles.gameCardMid}>
                        <Text style={styles.gameCardMidText}>+{middleCount}</Text>
                        {hasJoker && <Text style={styles.jokerBadge}>★</Text>}
                        {canasta !== 'none' && <Text style={styles.canastaTag}>{canasta === 'clean' ? '🏆' : '📦'}</Text>}
                        {canAdd && <Text style={styles.addTag}>➕</Text>}
                      </View>
                      <Card card={compactLast} small />
                    </>
                  ) : (
                    // Modo completo: todas as cartas
                    <>
                      <View style={styles.gameCards}>
                        {gameCards.map((c, ci) => (
                          <View key={c.id} style={ci > 0 ? { marginLeft: -28 } : undefined}>
                            <Card card={c} small />
                          </View>
                        ))}
                      </View>
                      <View style={styles.gameCardMid}>
                        {canasta !== 'none' && <Text style={styles.canastaTag}>{canasta === 'clean' ? '🏆' : '📦'}</Text>}
                        {canAdd && <Text style={styles.addTag}>➕</Text>}
                      </View>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Jogos dos adversários */}
          <Text style={[styles.sectionLabel, { marginTop: 8 }]}>🔴 Jogos Adversário</Text>
          {opTeamGames.length === 0 && <Text style={styles.emptyGames}>Nenhum jogo ainda</Text>}
          <View style={styles.gamesGrid}>
            {opTeamGames.map((gameCards, idx) => {
              const canasta = checkCanasta(gameCards);
              const normalCards = gameCards.filter(c => !c.isJoker);
              const hasJoker = gameCards.some(c => c.isJoker);
              const compactFirst = normalCards[0] ?? gameCards[0];
              const compactLast = normalCards[normalCards.length - 1] ?? gameCards[gameCards.length - 1];
              const middleCount = gameCards.length - 2;
              const compact = gameCards.length >= 6;
              return (
                <View
                  key={`op-${idx}`}
                  style={[
                    styles.gameCard,
                    styles.opponentGame,
                    canasta !== 'none' && (canasta === 'clean' ? styles.cleanCanasta : styles.dirtyCanasta),
                  ]}
                >
                  {compact ? (
                    <>
                      <Card card={compactFirst} small />
                      <View style={styles.gameCardMid}>
                        <Text style={styles.gameCardMidText}>+{middleCount}</Text>
                        {hasJoker && <Text style={styles.jokerBadge}>★</Text>}
                        {canasta !== 'none' && <Text style={styles.canastaTag}>{canasta === 'clean' ? '🏆' : '📦'}</Text>}
                      </View>
                      <Card card={compactLast} small />
                    </>
                  ) : (
                    <>
                      <View style={styles.gameCards}>
                        {gameCards.map((c, ci) => (
                          <View key={c.id} style={ci > 0 ? { marginLeft: -28 } : undefined}>
                            <Card card={c} small />
                          </View>
                        ))}
                      </View>
                      {canasta !== 'none' && (
                        <View style={styles.gameCardMid}>
                          <Text style={styles.canastaTag}>{canasta === 'clean' ? '🏆' : '📦'}</Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Monte e Lixo no lado direito */}
        <View style={styles.pilesColumn}>
          <View style={styles.pileBox}>
            <Text style={styles.pileLabel}>Lixo ({pile.length})</Text>
            {pile.length > 0 ? (
              <Card card={pile[pile.length - 1]} onPress={handleDrawPile} />
            ) : (
              <TouchableOpacity onPress={handleDrawPile}>
                <View style={styles.emptySlot}><Text style={styles.emptySlotText}>Vazio</Text></View>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.pileBox}>
            <Text style={styles.pileLabel}>Monte ({deck.length})</Text>
            {deck.length > 0 ? (
              <Card card={{ id: '__hidden__', suit: 'spades', value: 3, deck: 1, isJoker: false }} isHidden onPress={handleDrawDeck} />
            ) : (
              <TouchableOpacity onPress={handleDrawDeck}>
                <View style={styles.emptySlot}><Text style={styles.emptySlotText}>Vazio</Text></View>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* AÇÕES */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.playBtn, (!isMyTurn || turnPhase !== 'play' || selectedCards.length < 3) && styles.disabled]}
          onPress={handlePlayCards}
          disabled={!isMyTurn || turnPhase !== 'play' || selectedCards.length < 3}
        >
          <Text style={styles.actionText}>⬇ Baixar</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.discardBtn, (!isMyTurn || turnPhase !== 'play' || selectedCards.length !== 1) && styles.disabled]}
          onPress={handleDiscard}
          disabled={!isMyTurn || turnPhase !== 'play' || selectedCards.length !== 1}
        >
          <Text style={styles.actionText}>🗑 Descartar</Text>
        </TouchableOpacity>

        {selectedCards.length > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.clearBtn]}
            onPress={() => setSelectedCards([])}
          >
            <Text style={styles.actionText}>✕</Text>
          </TouchableOpacity>
        )}
        {/* Reiniciar removido daqui — agora no menu ☰ */}
      </View>

      {/* MÃO DO JOGADOR */}
      <View style={styles.handArea}>
        <Hand
          cards={user.hand}
          selectedCards={selectedCards}
          onToggleCard={handleToggleCard}
          highlightCardId={mustPlayPileTopId ?? lastDrawnCardId}
        />
      </View>

      {/* MODAL MENU */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={styles.menuBox}>
            <Text style={styles.menuTitle}>Menu</Text>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                Alert.alert(
                  'Reiniciar Partida',
                  'Tem certeza? O progresso atual será perdido.',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Reiniciar', style: 'destructive', onPress: () => { startNewGame(); setSelectedCards([]); } },
                  ]
                );
              }}
            >
              <Text style={styles.menuItemText}>🔄 Reiniciar Partida</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                Alert.alert(
                  'Sair',
                  'Deseja sair para o menu principal?',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Sair', onPress: () => router.replace('/(tabs)' as any) },
                  ]
                );
              }}
            >
              <Text style={styles.menuItemText}>🚪 Sair do Jogo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, styles.menuClose]} onPress={() => setShowMenu(false)}>
              <Text style={[styles.menuItemText, { color: 'rgba(255,255,255,0.5)' }]}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MODAL FIM DE RODADA */}
      <Modal visible={roundOver} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            {/* Título */}
            <Text style={styles.modalTitle}>
              {winnerTeamId
                ? (winnerTeamId === 'team-1' ? '🏆 VOCÊ VENCEU A PARTIDA!' : '😢 Adversários venceram!')
                : 'Rodada Encerrada'
              }
            </Text>

            {/* Quem bateu */}
            {gameLog.slice().reverse().find(e => e.type === 'round_end') && (
              <Text style={styles.modalWhoWent}>
                {gameLog.slice().reverse().find(e => e.type === 'round_end')?.message}
              </Text>
            )}

            {/* Breakdown Nós */}
            <View style={styles.modalTeamBlock}>
              <Text style={styles.modalTeamTitle}>🟢 Nossa equipe</Text>
              <Text style={styles.modalScoreRow}>Jogos na mesa: +{calculateLiveScore(teams['team-1'])}</Text>
              <Text style={styles.modalScoreRow}>Penalidade mão: -{myHandPenalty}</Text>
              <Text style={styles.modalScoreRow}>Esta rodada: {teams['team-1'].score}</Text>
              <Text style={styles.modalScoreTotal}>Total: {matchScores['team-1']}</Text>
            </View>

            {/* Breakdown Eles */}
            <View style={styles.modalTeamBlock}>
              <Text style={styles.modalTeamTitle}>🔴 Equipe adversária</Text>
              <Text style={styles.modalScoreRow}>Jogos na mesa: +{calculateLiveScore(teams['team-2'])}</Text>
              <Text style={styles.modalScoreRow}>Penalidade mão: -{opHandPenalty}</Text>
              <Text style={styles.modalScoreRow}>Esta rodada: {teams['team-2'].score}</Text>
              <Text style={styles.modalScoreTotal}>Total: {matchScores['team-2']}</Text>
            </View>

            <Text style={styles.modalTarget}>Meta: {targetScore} pontos</Text>

            {winnerTeamId ? (
              <TouchableOpacity style={styles.modalBtn} onPress={() => { startNewGame(); router.replace('/(tabs)' as any); }}>
                <Text style={styles.modalBtnText}>Novo Jogo</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.modalBtn} onPress={() => { startNewRound(); setSelectedCards([]); }}>
                <Text style={styles.modalBtnText}>Próxima Rodada ▶</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1B5E20', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0 },
  emptyText: { color: '#fff', textAlign: 'center', marginTop: 100, fontSize: 18 },

  // HEADER
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  scoreLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  scoreMain: { color: '#B9F6CA', fontSize: 22, fontWeight: '900' },
  scoreLive: { color: '#FFD600', fontSize: 11, fontWeight: '700' },
  scoreText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  targetText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 2 },
  restartBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  restartText: { fontSize: 16 },

  // MÃO
  handTopBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  handArea: { backgroundColor: 'rgba(0,0,0,0.5)', paddingBottom: 12 },
  turnBox: { alignItems: 'center' },
  turnName: { color: '#FFD600', fontWeight: '900', fontSize: 16 },
  phaseLabel: {
    color: '#fff', fontWeight: '800', fontSize: 11,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, marginTop: 2,
    overflow: 'hidden',
  },
  infoText: { color: '#B9F6CA', fontSize: 12, textAlign: 'right' },

  // BOARD
  board: { flex: 1, flexDirection: 'row', paddingHorizontal: 8, paddingTop: 6 },
  gamesScroll: { flex: 1 },
  sectionLabel: { color: '#E8F5E9', fontWeight: '800', fontSize: 14, marginBottom: 4 },
  emptyGames: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 8, fontStyle: 'italic' },
  // GRADE DE JOGOS
  gamesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 4,
    justifyContent: 'space-between',
  },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    // ~50% width minus gap, 2 per row
    minWidth: '46%',
    maxWidth: '48%',
    flex: 0,
    justifyContent: 'space-between',
  },
  gameCardHighlight: {
    borderWidth: 1.5, borderColor: '#FFD600', backgroundColor: 'rgba(255,214,0,0.12)',
  },
  gameCardMid: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 2,
  },
  gameCardMidText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
  },
  canastaTag: { fontSize: 13 },
  addTag: { fontSize: 12 },
  jokerBadge: { fontSize: 11, color: '#FFD600', fontWeight: '900' },

  // Mantidos para compatibilidade
  gameRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 6,
  },
  gameRowHighlight: {
    borderWidth: 1.5, borderColor: '#FFD600', backgroundColor: 'rgba(255,214,0,0.12)',
  },
  opponentGame: { backgroundColor: 'rgba(255,0,0,0.08)' },
  cleanCanasta: { borderLeftWidth: 3, borderLeftColor: '#FFD600' },
  dirtyCanasta: { borderLeftWidth: 3, borderLeftColor: '#FF9800' },
  gameCards: { flexDirection: 'row', flex: 1 },
  canastaLabel: { fontSize: 10, color: '#FFD600', fontWeight: '800', marginLeft: 4 },
  gameCardCount: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginLeft: 4 },
  gameInfo: { alignItems: 'flex-end', marginLeft: 4 },
  addLabel: { fontSize: 9, color: '#FFD600', fontWeight: '800' },

  // PILES
  pilesColumn: { width: 80, alignItems: 'center', justifyContent: 'center', gap: 20 },
  pileBox: { alignItems: 'center' },
  pileLabel: { color: '#E8F5E9', fontSize: 10, fontWeight: '700', marginBottom: 1 },

  // MENU ☰
  menuBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  menuBtnText: { fontSize: 14, color: '#fff' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 80, paddingRight: 12 },
  menuBox: { backgroundColor: '#1B4A28', borderRadius: 12, padding: 8, minWidth: 200, elevation: 10 },
  menuTitle: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700', textAlign: 'center', marginBottom: 6, letterSpacing: 1 },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 8, marginBottom: 4, backgroundColor: 'rgba(255,255,255,0.06)' },
  menuItemText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  menuClose: { backgroundColor: 'transparent', marginTop: 4 },
  emptySlot: {
    width: 60, height: 86, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
    borderStyle: 'dashed', borderRadius: 6, justifyContent: 'center', alignItems: 'center',
  },
  emptySlotText: { color: 'rgba(255,255,255,0.3)', fontSize: 9 },

  // AÇÕES
  actionsRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 12, gap: 8,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  actionBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, minWidth: 90, alignItems: 'center',
  },
  playBtn: { backgroundColor: '#2E7D32' },
  discardBtn: { backgroundColor: '#C62828' },
  clearBtn: { backgroundColor: '#616161', minWidth: 40 },
  disabled: { opacity: 0.35 },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  // MODAL
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#1B5E20', borderRadius: 16, padding: 24,
    width: SW * 0.85, alignItems: 'center',
    borderWidth: 2, borderColor: '#FFD600',
  },
  modalTitle: { color: '#FFD600', fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 16 },
  modalScores: { marginBottom: 12, width: '100%' },
  modalScoreText: { color: '#fff', fontSize: 16, marginBottom: 4 },
  modalWhoWent: { color: '#FFD600', fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  modalTeamBlock: { width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: 10, marginBottom: 8 },
  modalTeamTitle: { color: '#fff', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  modalScoreRow: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginBottom: 2 },
  modalScoreTotal: { color: '#FFD600', fontSize: 14, fontWeight: '900', marginTop: 4 },
  modalTarget: { color: '#B9F6CA', fontSize: 13, marginBottom: 16 },
  modalBtn: {
    backgroundColor: '#FFD600', paddingHorizontal: 32, paddingVertical: 12,
    borderRadius: 24,
  },
  modalBtnText: { color: '#1B5E20', fontWeight: '900', fontSize: 16 },
});

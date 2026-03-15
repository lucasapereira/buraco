import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, Alert, Modal, Dimensions, Platform, StatusBar, LayoutAnimation
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
import { useGameSounds } from '../../hooks/useGameSounds';
import * as NavigationBar from 'expo-navigation-bar';

const { width: SW } = Dimensions.get('window');

export default function GameScreen() {
  const {
    players, deck, pile, deads, teams, currentTurnPlayerId,
    turnPhase, roundOver, winnerTeamId, matchScores, targetScore,
    drawFromDeck, drawFromPile, discard, playCards, addToExistingGame,
    startNewRound, startNewGame,
    gameLog, lastDrawnCardId, mustPlayPileTopId, gameMode, botDifficulty,
    animatingDiscard, animatingDrawPlayerId
  } = useGameStore();

  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const router = useRouter();
  const { playSound } = useGameSounds();

  // === EFEITOS SONOROS ===
  const prevDeadsLength = useRef(2);
  useEffect(() => {
    if (deads.length < prevDeadsLength.current) {
      playSound('morto');
    }
    prevDeadsLength.current = deads.length;
  }, [deads.length, playSound]);

  const prevCanastaCount = useRef(0);
  useEffect(() => {
    let count = 0;
    teams['team-1'].games.forEach(g => { if (checkCanasta(g) !== 'none') count++; });
    teams['team-2'].games.forEach(g => { if (checkCanasta(g) !== 'none') count++; });
    if (count > prevCanastaCount.current && count > 0) {
      playSound('canastra');
    }
    prevCanastaCount.current = count;
  }, [teams, playSound]);

  const prevRoundWinner = useRef<string | null>(null);
  useEffect(() => {
    if (winnerTeamId && winnerTeamId !== prevRoundWinner.current) {
      playSound('bater');
    }
    prevRoundWinner.current = winnerTeamId;
  }, [winnerTeamId, playSound]);

  const prevTurnPlayer = useRef<string | null>(null);
  useEffect(() => {
    if (currentTurnPlayerId === 'user' && currentTurnPlayerId !== prevTurnPlayer.current) {
      playSound('turno');
    }
    prevTurnPlayer.current = currentTurnPlayerId;
  }, [currentTurnPlayerId, playSound]);

  useBotAI();

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
      NavigationBar.setBehaviorAsync('inset-touch');
    }
  }, []);

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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    drawFromDeck('user');
  };

  const handlePileClick = () => {
    if (!isMyTurn) {
      const current = players.find(p => p.id === currentTurnPlayerId);
      Alert.alert('Aguarde', `É a vez de ${current?.name || 'outro jogador'}.`);
      return;
    }
    if (turnPhase === 'play') {
      handleDiscard();
      return;
    }
    if (pile.length === 0) {
      Alert.alert('Lixo vazio', 'O lixo está vazio.');
      return;
    }
    // Verifica regra: precisa ter jogo com o topo do lixo (exceto Araujo Pereira)
    if (gameMode !== 'araujo_pereira') {
      const team = teams['team-1'];
      const hasClean = team.games.some(g => checkCanasta(g) === 'clean');

      if (!canTakePile(user.hand, pile, myTeamGames, gameMode, {
        hasGottenDead: team.hasGottenDead,
        hasDeadsAvailable: deads.length > 0,
        hasCleanCanasta: hasClean
      })) {
        Alert.alert(
          '❌ Não pode pegar o lixo',
          `Você precisa usar a carta do topo do lixo em um jogo e essa jogada deve ser legal (não pode se enforcar).`
        );
        return;
      }
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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

    // Validação UX: Não permite descartar a última sem canastra/morto
    if (user.hand.length === 1) {
      const team = teams['team-1'];
      const willGetDead = !team.hasGottenDead && deads.length > 0;
      const hasCanasta = myTeamGames.some(g => {
        const type = checkCanasta(g);
        return type !== 'none' && (gameMode === 'araujo_pereira' || type === 'clean');
      });

      if (!willGetDead && !hasCanasta) {
        Alert.alert(
          '⚠️ Não pode bater',
          `Sua equipe precisa de uma canastra ${gameMode === 'araujo_pereira' ? '' : 'limpa '}para bater e encerrar a rodada.`
        );
        return;
      }
    }

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
    const result = playCards('user', selectedCards);
    if (result.success) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSelectedCards([]);
    } else {
      if (result.error === 'stranding_prohibited') {
        Alert.alert(
          '⚠️ Não pode ficar sem cartas',
          'Você não pode baixar essa sequência agora porque ficaria sem cartas na mão sem ter uma canastra limpa para bater.'
        );
      } else if (result.error === 'top_card_required') {
        // Já tem mensagem no início do handlePlayCards, mas por segurança:
        Alert.alert('⚠️ Regra do Lixo', 'Sua primeira jogada DEVE ser com a carta comprada do topo do lixo.');
      } else {
        Alert.alert(
          'Sequência inválida',
          'As cartas selecionadas não formam uma sequência válida no STBL.\n\nLembre: mesmo naipe, valores consecutivos, máximo 1 curinga (2).'
        );
      }
    }
  };

  const handleAddToGame = (gameIndex: number) => {
    if (!isMyTurn || turnPhase !== 'play') return;
    if (mustPlayPileTopId && !selectedCards.includes(mustPlayPileTopId)) {
      Alert.alert('⚠️ Regra do Lixo', 'Você deve usar a carta do topo do lixo na sua primeira jogada (novo jogo ou adicionar a um existente).');
      return;
    }
    if (selectedCards.length === 0) {
      Alert.alert('Selecione cartas', 'Selecione as cartas da sua mão que deseja adicionar a este jogo.');
      return;
    }
    const result = addToExistingGame('user', selectedCards, gameIndex);
    if (result.success) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSelectedCards([]);
    } else {
      if (result.error === 'stranding_prohibited') {
        Alert.alert(
          '⚠️ Não pode ficar sem cartas',
          'Adicionar estas cartas deixaria você sem mão antes de ter uma canastra limpa para bater.'
        );
      } else if (result.error === 'top_card_required') {
         Alert.alert('⚠️ Regra do Lixo', 'Sua primeira jogada deve ser usando a carta do topo do lixo.');
      } else {
        Alert.alert('Inválido', 'As cartas selecionadas não encaixam neste jogo.');
      }
    }
  };

  const handleTableClick = () => {
    if (isMyTurn && turnPhase === 'play' && selectedCards.length >= 3) {
      handlePlayCards();
    } else {
      setSelectedCards([]);
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

      {/* STATUS BAR DOS JOGADORES */}
      <View style={styles.statusBar}>
        {players.map(p => {
          let shortName = p.name;
          if (p.id === 'bot-1') shortName = 'Adv 1';
          if (p.id === 'bot-2') shortName = 'Parc';
          if (p.id === 'bot-3') shortName = 'Adv 2';
          if (p.id === 'user') shortName = 'Você';

          return (
            <View key={p.id}>
              <View style={[styles.statusItem, p.id === 'user' && { borderColor: 'rgba(76,175,80,0.5)', borderWidth: 1 }]}>
                <Text style={styles.statusName}>{shortName}</Text>
                <Text style={styles.statusCards}>
                  {p.hand.length} 🎴 {teams[p.teamId].hasGottenDead ? '💀' : ''}
                </Text>
              </View>
              {/* Animação Compra */}
              {animatingDrawPlayerId === p.id && (
                <View style={styles.animCardContainer}>
                  <Card card={{ id: 'anim-draw', suit: 'spades', value: 3, deck: 1, isJoker: false }} isHidden small />
                </View>
              )}
              {/* Animação Descarte */}
              {animatingDiscard?.playerId === p.id && (
                <View style={styles.animCardContainer}>
                  <Card card={animatingDiscard.card} small />
                </View>
              )}
            </View>
          );
        })}
        <View style={[styles.statusItem, { backgroundColor: 'rgba(255,214,0,0.1)' }]}>
          <Text style={styles.statusName}>Mortos</Text>
          <Text style={[styles.statusCards, { color: '#FFD600' }]}>{deads.length} 📦</Text>
        </View>
      </View>

      {/* BANNER DE EVENTO — no fluxo normal, não absolute */}
      <EventBanner events={gameLog} />

      {/* BOARD */}
      <View style={styles.board}>
        {/* Jogos montados */}
        <ScrollView 
          style={styles.gamesScroll} 
          contentContainerStyle={[styles.gamesScrollContent, { flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity 
            activeOpacity={1} 
            onPress={handleTableClick}
            style={{ flexGrow: 1 }} 
          >
            {(() => {
              const totalGames = (myTeamGames || []).length + (opTeamGames || []).length;
              const denseLevel = totalGames > 15 ? 2 : totalGames > 10 ? 1 : 0;
              const denseMode = denseLevel > 0;
              const tightMode = denseLevel > 1;
              const scale = 1;

            return (
              <>
                {/* Jogos dos adversários */}
                <Text style={styles.sectionLabel}>🔴 Jogos Adversário</Text>
                {opTeamGames.length === 0 && <Text style={styles.emptyGames}>Nenhum jogo ainda</Text>}
                <View style={[
                  styles.gamesGrid,
                  denseMode && styles.gamesGridDense,
                  tightMode && styles.gamesGridTight,
                ]}>
                  {opTeamGames.map((gameCards, idx) => {
                    const canasta = checkCanasta(gameCards);
                    const normalCards = gameCards.filter(c => !c.isJoker);
                    
                    let visibleCards = gameCards;
                    let isCanasta = canasta !== 'none';
                    let cardMargin = -20;

                    if (isCanasta) {
                      const idxs = new Set<number>([0, gameCards.length - 1]);
                      const jIdx = gameCards.findIndex(c => c.isJoker);
                      const isTrinca = normalCards.length >= 2 && normalCards.every(c => c.value === normalCards[0].value);

                      if (isTrinca) {
                        if (jIdx !== -1) {
                          idxs.add(jIdx);
                        }
                        // Trincas sempre mostram 3 cartas para não ficar estranho
                        if (idxs.size < 3 && gameCards.length > 2) {
                           idxs.add(1); 
                        }
                        if (idxs.size < 3 && gameCards.length > 3) {
                           idxs.add(2);
                        }
                      } else {
                        // Sequências
                        if (jIdx !== -1) {
                          idxs.add(jIdx);
                          if (jIdx > 0) idxs.add(jIdx - 1);
                          if (jIdx < gameCards.length - 1) idxs.add(jIdx + 1);
                        } else {
                          if (gameCards.length > 2) idxs.add(gameCards.length - 2);
                        }
                      }
                      
                      visibleCards = Array.from(idxs).sort((a, b) => a - b).map(i => gameCards[i]);
                    } 
                    
                    if (visibleCards.length > 1) {
                      const containerWidth = (SW - 90) / 3; // Estimativa para 3 por linha
                      const calcMargin = Math.floor((containerWidth - 50) / (visibleCards.length - 1)) - 50;
                      cardMargin = Math.min(isCanasta ? -24 : -18, calcMargin);
                    }

                    return (
                      <View
                        key={`op-${idx}`}
                        style={[
                          styles.gameCard,
                          denseMode && styles.gameCardDense,
                          tightMode && styles.gameCardTight,
                          styles.opponentGame,
                          canasta !== 'none' && (canasta === 'clean' ? styles.cleanCanasta : styles.dirtyCanasta),
                          { transform: [{ scale }] }
                        ]}
                      >
                        <View style={styles.gameCardInner}>
                          <View style={[
                            styles.gameCardsWrap,
                            denseMode && styles.gameCardsWrapCompact,
                            tightMode && styles.gameCardsWrapTight,
                          ]}>
                            <View style={[
                              styles.gameCards,
                              denseMode && styles.gameCardsDense,
                            ]}>
                              {visibleCards.map((c, ci) => {
                                return (
                                  <View key={c.id} style={ci > 0 ? { marginLeft: cardMargin } : undefined}>
                                    <View style={[
                                      styles.cardClip,
                                      denseMode && styles.cardClipCompact,
                                      tightMode && styles.cardClipTight,
                                    ]}>
                                      <Card card={c} small />
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                            {isCanasta && (
                              <View pointerEvents="none" style={[styles.canastaRibbon, canasta === 'clean' ? styles.ribbonClean : styles.ribbonDirty]}>
                                <Text style={styles.ribbonText}>{canasta === 'clean' ? 'LIMPA' : 'SUJA'}</Text>
                              </View>
                            )}
                             <View style={styles.gameCardOverlay}>
                               <View style={[
                                 styles.counterBadgeOverlay,
                                 isCanasta && (canasta === 'clean' ? styles.badgeClean : styles.badgeDirty)
                               ]}>
                                 <Text style={styles.counterTextOverlay}>
                                   {isCanasta && (canasta === 'clean' ? '✨ ' : '★ ')}
                                   {gameCards.length}
                                 </Text>
                               </View>
                             </View>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* Nossos jogos */}
                <Text style={[styles.sectionLabel, { marginTop: 5 }]}>🟢 Nossos Jogos</Text>
                {myTeamGames.length === 0 && <Text style={styles.emptyGames}>Nenhum jogo ainda</Text>}
                <View style={[
                  styles.gamesGrid,
                  denseMode && styles.gamesGridDense,
                  tightMode && styles.gamesGridTight,
                ]}>
                  {myTeamGames.map((gameCards, idx) => {
                    const canasta = checkCanasta(gameCards);
                    const normalCards = gameCards.filter(c => !c.isJoker);
                    
                    let visibleCards = gameCards;
                    let isCanasta = canasta !== 'none';
                    let cardMargin = -20;

                    if (isCanasta) {
                      const idxs = new Set<number>([0, gameCards.length - 1]);
                      const jIdx = gameCards.findIndex(c => c.isJoker);
                      const isTrinca = normalCards.length >= 2 && normalCards.every(c => c.value === normalCards[0].value);

                      if (isTrinca) {
                        if (jIdx !== -1) {
                          idxs.add(jIdx);
                        }
                        // Trincas sempre mostram 3 cartas para não ficar estranho
                        if (idxs.size < 3 && gameCards.length > 2) {
                           idxs.add(1); 
                        }
                        if (idxs.size < 3 && gameCards.length > 3) {
                           idxs.add(2);
                        }
                      } else {
                        // Sequências
                        if (jIdx !== -1) {
                          idxs.add(jIdx);
                          if (jIdx > 0) idxs.add(jIdx - 1);
                          if (jIdx < gameCards.length - 1) idxs.add(jIdx + 1);
                        } else {
                          if (gameCards.length > 2) idxs.add(gameCards.length - 2);
                        }
                      }
                      
                      visibleCards = Array.from(idxs).sort((a, b) => a - b).map(i => gameCards[i]);
                    } 
                    
                    if (visibleCards.length > 1) {
                      const containerWidth = (SW - 90) / 3;
                      const calcMargin = Math.floor((containerWidth - 50) / (visibleCards.length - 1)) - 50;
                      cardMargin = Math.min(isCanasta ? -24 : -18, calcMargin);
                    }

                    const canAdd = (() => {
                      if (!isMyTurn || turnPhase !== 'play' || selectedCards.length === 0) return false;
                      const selCards = user.hand.filter(c => selectedCards.includes(c.id));
                      const combined = [...gameCards, ...selCards];
                      return combined.length >= 3 && validateSequence(combined, gameMode);
                    })();

                    return (
                      <TouchableOpacity
                        key={`my-${idx}`}
                        style={[
                          styles.gameCard,
                          denseMode && styles.gameCardDense,
                          tightMode && styles.gameCardTight,
                          canasta !== 'none' && (canasta === 'clean' ? styles.cleanCanasta : styles.dirtyCanasta),
                          canAdd && styles.gameCardHighlight,
                          { transform: [{ scale }] }
                        ]}
                        onPress={() => handleAddToGame(idx)}
                        activeOpacity={0.6}
                      >
                        <View pointerEvents="none" style={styles.gameCardInner}>
                          <View style={[
                            styles.gameCardsWrap,
                            denseMode && styles.gameCardsWrapCompact,
                            tightMode && styles.gameCardsWrapTight,
                          ]}>
                            <View style={[
                              styles.gameCards,
                              denseMode && styles.gameCardsDense,
                            ]}>
                              {visibleCards.map((c, ci) => {
                                return (
                                  <View key={c.id} style={ci > 0 ? { marginLeft: cardMargin } : undefined}>
                                    <View style={[
                                      styles.cardClip,
                                      denseMode && styles.cardClipCompact,
                                      tightMode && styles.cardClipTight,
                                    ]}>
                                      <Card card={c} small />
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                            {isCanasta && (
                              <View pointerEvents="none" style={[styles.canastaRibbon, canasta === 'clean' ? styles.ribbonClean : styles.ribbonDirty]}>
                                <Text style={styles.ribbonText}>{canasta === 'clean' ? 'LIMPA' : 'SUJA'}</Text>
                              </View>
                            )}
                             <View style={styles.gameCardOverlay}>
                               <View style={[
                                 styles.counterBadgeOverlay,
                                 isCanasta && (canasta === 'clean' ? styles.badgeClean : styles.badgeDirty)
                               ]}>
                                 <Text style={styles.counterTextOverlay}>
                                   {isCanasta && (canasta === 'clean' ? '✨ ' : '★ ')}
                                   {gameCards.length}
                                 </Text>
                               </View>
                               {canAdd && <Text style={styles.addTag}>➕</Text>}
                             </View>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
            </>
          );
        })()}
          </TouchableOpacity>
        </ScrollView>

        {/* Monte e Lixo no lado direito */}
        <View style={styles.pilesColumn}>
          <View style={styles.pileBox}>
            {pile.length > 0 ? (
              <View>
                <Card card={pile[pile.length - 1]} small onPress={handlePileClick} />
                <View pointerEvents="none" style={styles.pileCounterBadge}><Text style={styles.counterText}>{pile.length}</Text></View>
                <View pointerEvents="none" style={styles.pileNameTag}><Text style={styles.pileNameText}>Lixo</Text></View>
              </View>
            ) : (
              <TouchableOpacity onPress={handlePileClick}>
                <View style={styles.emptySlot}><Text style={styles.emptySlotText}>Lixo</Text></View>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.pileBox}>
            {deck.length > 0 ? (
              <View>
                <Card card={{ id: '__hidden__', suit: 'spades', value: 3, deck: 1, isJoker: false }} isHidden small onPress={handleDrawDeck} />
                <View pointerEvents="none" style={styles.pileCounterBadge}><Text style={styles.counterText}>{deck.length}</Text></View>
                <View pointerEvents="none" style={styles.pileNameTag}><Text style={styles.pileNameText}>Monte</Text></View>
              </View>
            ) : (
              <TouchableOpacity onPress={handleDrawDeck}>
                <View style={styles.emptySlot}><Text style={styles.emptySlotText}>Monte</Text></View>
              </TouchableOpacity>
            )}
          </View>
        </View>
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
                    { text: 'Reiniciar', style: 'destructive', onPress: () => { startNewGame(targetScore, botDifficulty, gameMode); setSelectedCards([]); } },
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
              <TouchableOpacity style={styles.modalBtn} onPress={() => { startNewGame(targetScore, botDifficulty, gameMode); router.replace('/(tabs)' as any); }}>
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
  emptyText: { color: '#fff', textAlign: 'center', marginTop: 100, fontSize: 20 },

  // HEADER
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  scoreLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  scoreMain: { color: '#B9F6CA', fontSize: 25, fontWeight: '900' },
  scoreLive: { color: '#FFD600', fontSize: 13, fontWeight: '700' },
  scoreText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  targetText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  restartBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  restartText: { fontSize: 18 },

  // STATUS BAR
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  statusItem: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 46,
  },
  statusName: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  statusCards: {
    color: '#B9F6CA',
    fontSize: 13,
    fontWeight: '800',
  },

  // MÃO
  handTopBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  handArea: { backgroundColor: 'rgba(0,0,0,0.2)', paddingBottom: 0, overflow: 'visible' },
  turnBox: { alignItems: 'center' },
  turnName: { color: '#FFD600', fontWeight: '900', fontSize: 18 },
  phaseLabel: {
    color: '#fff', fontWeight: '800', fontSize: 13,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, marginTop: 2,
    overflow: 'hidden',
  },
  infoText: { color: '#B9F6CA', fontSize: 14, textAlign: 'right' },

  // BOARD
  board: { flex: 1, flexDirection: 'row', paddingHorizontal: 2, paddingTop: 2 },
  gamesScroll: { flex: 1 },
  gamesScrollContent: { paddingLeft: 6, paddingRight: 6, paddingBottom: 10, flexGrow: 1 },
  sectionLabel: { color: '#E8F5E9', fontWeight: '800', fontSize: 13, marginBottom: 2 },
  emptyGames: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 6, fontStyle: 'italic' },
  // GRADE DE JOGOS
  gamesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
    columnGap: 6,
    marginBottom: 4,
    justifyContent: 'flex-start',
    overflow: 'visible',
    gap: 6
  },
  gamesGridDense: {
    rowGap: 8,
    columnGap: 6,
  },
  gamesGridTight: {
    rowGap: 6,
    columnGap: 6,
  },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 3,
    flexBasis: '31%',
    minWidth: '31%',
    maxWidth: '32.5%',
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'space-between',
    overflow: 'visible',
  },
  gameCardDense: {
    paddingVertical: 3,
    paddingHorizontal: 3,
  },
  gameCardTight: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  gameCardInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'visible',
  },
  gameCardsWrap: {
    flex: 1,
    position: 'relative',
    minHeight: 74, 
    justifyContent: 'center',
    paddingTop: 4,
    overflow: 'visible',
  },
  gameCardsWrapCompact: {
    minHeight: 70,
    paddingTop: 3,
  },
  gameCardsWrapTight: {
    minHeight: 66,
    paddingTop: 2,
  },
  trincaChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  trincaChipText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  gameCardHighlight: {
    borderWidth: 1.5, borderColor: '#FFD600', backgroundColor: 'rgba(255,214,0,0.12)',
  },
  gameCardOverlay: {
    position: 'absolute',
    top: 2,
    right: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hiddenCountTag: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '900',
  },
  canastaTag: { fontSize: 15 },
  addTag: { fontSize: 14 },
  jokerBadge: { fontSize: 13, color: '#FFD600', fontWeight: '900' },
  counterBadgeOverlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    minWidth: 19,
    height: 19,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  counterText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  counterTextOverlay: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  pileCounterBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    minWidth: 23,
    height: 23,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  pileNameTag: {
    position: 'absolute',
    bottom: -6,
    left: -4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  pileNameText: {
    color: '#E8F5E9',
    fontSize: 11,
    fontWeight: '800',
  },
  animCardContainer: {
    position: 'absolute',
    top: -40,
    alignSelf: 'center',
    zIndex: 100,
  },

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
  gameCards: { flexDirection: 'row', flex: 1, overflow: 'visible', paddingLeft: 2, paddingRight: 6 },
  gameCardsDense: { paddingLeft: 4, paddingRight: 4 },
  cardClip: { 
    overflow: 'hidden',
    height: 72, // Exatamente a altura do small card
  },
  cardClipCompact: { height: 68 },
  cardClipTight: { height: 64 },
  cardClipLast: { width: 28 },
  cardClipLastTight: { width: 24 },
  canastaLabel: { fontSize: 12, color: '#FFD600', fontWeight: '800', marginLeft: 4 },
  gameCardCount: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginLeft: 4 },
  gameInfo: { alignItems: 'flex-end', marginLeft: 4 },
  addLabel: { fontSize: 11, color: '#FFD600', fontWeight: '800' },

  canastaRibbon: {
    position: 'absolute',
    bottom: 2,
    left: '50%',
    transform: [{ translateX: -22 }], 
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  ribbonClean: {
    backgroundColor: '#388E3C',
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  ribbonDirty: {
    backgroundColor: '#E65100', // Laranja escuro para Suja
    borderWidth: 1.5,
    borderColor: '#FFD180',
  },
  ribbonText: {
    color: '#fff',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  badgeClean: {
    backgroundColor: '#FFD600',
    borderColor: '#FFF176',
  },
  badgeDirty: {
    backgroundColor: '#E65100',
    borderColor: '#FFD180',
  },

  // PILES
  pilesColumn: { width: 66, alignItems: 'center', justifyContent: 'center', gap: 8 },
  pileBox: { alignItems: 'center' },
  pileLabel: { color: '#E8F5E9', fontSize: 12, fontWeight: '700', marginBottom: 1 },

  // MENU ☰
  menuBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  menuBtnText: { fontSize: 16, color: '#fff' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 80, paddingRight: 12 },
  menuBox: { backgroundColor: '#1B4A28', borderRadius: 12, padding: 8, minWidth: 200, elevation: 10 },
  menuTitle: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 6, letterSpacing: 1 },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 8, marginBottom: 4, backgroundColor: 'rgba(255,255,255,0.06)' },
  menuItemText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  menuClose: { backgroundColor: 'transparent', marginTop: 4 },
  emptySlot: {
    width: 66, height: 94, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
    borderStyle: 'dashed', borderRadius: 6, justifyContent: 'center', alignItems: 'center',
  },
  emptySlotText: { color: 'rgba(255,255,255,0.3)', fontSize: 11 },

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
  modalTitle: { color: '#FFD600', fontSize: 25, fontWeight: '900', textAlign: 'center', marginBottom: 16 },
  modalScores: { marginBottom: 12, width: '100%' },
  modalScoreText: { color: '#fff', fontSize: 18, marginBottom: 4 },
  modalWhoWent: { color: '#FFD600', fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  modalTeamBlock: { width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: 10, marginBottom: 8 },
  modalTeamTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  modalScoreRow: { color: 'rgba(255,255,255,0.75)', fontSize: 14, marginBottom: 2 },
  modalScoreTotal: { color: '#FFD600', fontSize: 16, fontWeight: '900', marginTop: 4 },
  modalTarget: { color: '#B9F6CA', fontSize: 15, marginBottom: 16 },
  modalBtn: {
    backgroundColor: '#FFD600', paddingHorizontal: 32, paddingVertical: 12,
    borderRadius: 24,
  },
  modalBtnText: { color: '#1B5E20', fontWeight: '900', fontSize: 18 },
});

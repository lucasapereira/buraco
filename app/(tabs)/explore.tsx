import * as NavigationBar from 'expo-navigation-bar';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  LayoutAnimation,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text, TouchableOpacity,
  View
} from 'react-native';
import { Card } from '../../components/Card';
import { EventBanner } from '../../components/EventBanner';
import { Hand } from '../../components/Hand';
import { calculateCardPoints, calculateLiveScore } from '../../game/engine';
import { canTakePile, checkCanasta, validateSequence } from '../../game/rules';
import { useBotAI } from '../../hooks/useBotAI';
import { useGameSounds } from '../../hooks/useGameSounds';
import { useGameStore } from '../../store/gameStore';
import { cardLabel } from '../../game/deck';

const { width: SW } = Dimensions.get('window');

export default function GameScreen() {
  const {
    players, deck, pile, deads, teams, currentTurnPlayerId,
    turnPhase, roundOver, winnerTeamId, matchScores, targetScore,
    drawFromDeck, drawFromPile, discard, playCards, addToExistingGame,
    startNewRound, startNewGame,
    gameLog, lastDrawnCardId, mustPlayPileTopId, gameMode, botDifficulty,
    animatingDiscard, animatingDrawPlayerId,
    turnHistory, undoLastPlay
  } = useGameStore();

  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [tempOpenGame, setTempOpenGame] = useState<{ teamId: string; index: number } | null>(null);
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
    if (gameMode !== 'araujo_pereira' && !canTakePile(user.hand, pile, myTeamGames, gameMode)) {
      const topCard = pile[pile.length - 1];
      Alert.alert(
        '❌ Não pode pegar o lixo',
        `Você precisa usar o ${cardLabel(topCard)} em um jogo (novo ou existente).`
      );
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    drawFromPile('user');
  };

  const handleDiscard = () => {
    if (!isMyTurn || turnPhase !== 'play') return;
    if (mustPlayPileTopId !== null && gameMode !== 'araujo_pereira') {
      const pileTopStillInHand = user.hand.some(c => c.id === mustPlayPileTopId);
      if (pileTopStillInHand) {
        const topCard = user.hand.find(c => c.id === mustPlayPileTopId);
        const label = topCard ? cardLabel(topCard) : 'do topo';
        Alert.alert(
          '⚠️ Baixe o jogo primeiro',
          `Você pegou o lixo e deve baixar um jogo usando o ${label} antes de descartar.`
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
    if (gameMode !== 'araujo_pereira' && mustPlayPileTopId && !selectedCards.includes(mustPlayPileTopId)) {
      const topCard = user.hand.find(c => c.id === mustPlayPileTopId);
      const label = topCard ? cardLabel(topCard) : 'comprada';
      Alert.alert('⚠️ Regra do Lixo', `Sua primeira jogada DEVE ser com o ${label} (topo do lixo) para formar um NOVO jogo de pelo menos 3 cartas.`);
      return;
    }
    if (selectedCards.length < 3) {
      Alert.alert('Mínimo 3 cartas', 'Selecione no mínimo 3 cartas para baixar um jogo STBL.');
      return;
    }
    const success = playCards('user', selectedCards);
    if (success) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSelectedCards([]);
    } else {
      // Feedback melhorado dependendo do motivo da falha
      const fits = validateSequence(user.hand.filter(c => selectedCards.includes(c.id)), gameMode);
      if (!fits) {
        const msg = gameMode === 'araujo_pereira' 
          ? 'As cartas não formam uma sequência válida ou trinca (máximo 1 curinga em trincas).'
          : 'As cartas selecionadas não formam uma sequência válida.\n\nLembre: mesmo naipe, valores consecutivos, máximo 1 curinga (2).';
        Alert.alert('Combinação Inválida', msg);
      } else {
        // Encaixa, mas o store recusou (provavelmente trancaria o jogador)
        Alert.alert('⚠️ Ação bloqueada', 'Você não pode ficar sem cartas na mão sem ter uma canastra ou pegar o morto.');
      }
    }
  };

  const handleAddToGame = (gameIndex: number) => {
    const hasSelection = selectedCards.length > 0;
    const canPlay = isMyTurn && turnPhase === 'play';

    // Se NÃO tem cartas selecionadas, o objetivo é apenas ver o jogo (ZOOM)
    if (!hasSelection) {
      setTempOpenGame({ teamId: 'team-1', index: gameIndex });
      setTimeout(() => {
        setTempOpenGame(prev => (prev?.teamId === 'team-1' && prev?.index === gameIndex) ? null : prev);
      }, 8000);
      return;
    }

    // Se tem cartas selecionadas mas não é a vez do jogador, abre o ZOOM
    if (!canPlay) {
      setTempOpenGame({ teamId: 'team-1', index: gameIndex });
      return;
    }

    // Regra do Lixo
    if (gameMode !== 'araujo_pereira' && mustPlayPileTopId && !selectedCards.includes(mustPlayPileTopId)) {
      const topCard = user.hand.find(c => c.id === mustPlayPileTopId);
      const label = topCard ? cardLabel(topCard) : 'do topo';
      Alert.alert('⚠️ Regra do Lixo', `Você deve usar o ${label} (topo do lixo) na sua primeira jogada (novo jogo ou adicionar a um existente).`);
      return;
    }

    // Tenta adicionar
    const success = addToExistingGame('user', selectedCards, gameIndex);
    if (success) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSelectedCards([]);
      // SUCESSO: Não abre o modal, para o jogador ver a carta entrando no jogo
    } else {
      // Se falhou, verifica o motivo para dar um feedback melhor
      const player = players.find(p => p.id === 'user');
      if (player) {
        const selCards = player.hand.filter(c => selectedCards.includes(c.id));
        const combined = [...teams['team-1'].games[gameIndex], ...selCards];
        const fits = validateSequence(combined, gameMode);
        
        if (!fits) {
          // Se falhou por regra do jogo, abre o ZOOM para o jogador conferir o jogo e entender o erro
          setTempOpenGame({ teamId: 'team-1', index: gameIndex });
          Alert.alert('Inválido', 'As cartas selecionadas não encaixam neste jogo.');
        } else {
          // Encaixa, mas o store recusou (provavelmente "wouldStrandPlayer")
          Alert.alert('⚠️ Ação bloqueada', 'Você não pode ficar sem cartas na mão sem ter uma canastra ou pegar o morto.');
        }
      }
    }
  };

  const handleOpenOpponentGame = (idx: number) => {
    // Abre qualquer jogo do adversário para ver melhor
    setTempOpenGame({ teamId: 'team-2', index: idx });
    setTimeout(() => {
      setTempOpenGame(prev => (prev?.teamId === 'team-2' && prev?.index === idx) ? null : prev);
    }, 8000);
  };

  const getVisibleCards = (gameCards: any[], teamId: string, gameIdx: number, ignoreTempOpen = false) => {
    const canasta = checkCanasta(gameCards);
    const normalCards = gameCards.filter(c => !c.isJoker);
    const isTrinca = normalCards.length >= 2 && normalCards.every(c => c.value === normalCards[0].value);
    
    // Regra: esconde se for maior que 5 cartas
    const hideMiddle = gameCards.length > 5;

    let mappedCards = gameCards.map(c => ({ ...c, _isObscured: false }));

    if (hideMiddle) {
      const jIdx = mappedCards.findIndex(c => c.isJoker);
      
      if (isTrinca) {
        // Trinca: esconde tudo que não for pontas e coringa
        mappedCards.forEach((c, i) => {
          if (i !== 0 && i !== mappedCards.length - 1 && i !== jIdx) {
            c._isObscured = true;
          }
        });
      } else {
        // Sequência
        mappedCards.forEach((c, i) => {
          // Default: esconde tudo que não for as extremidades
          if (i !== 0 && i !== mappedCards.length - 1) {
            c._isObscured = true;
          }
        });
        
        // Se tiver coringa, mostra ele e os vizinhos
        if (jIdx !== -1) {
          mappedCards[jIdx]._isObscured = false;
          if (jIdx > 0) mappedCards[jIdx - 1]._isObscured = false;
          if (jIdx < mappedCards.length - 1) mappedCards[jIdx + 1]._isObscured = false;
        }
      }

      // SEMPRE mostrar a penúltima
      if (mappedCards.length > 2) {
        mappedCards[mappedCards.length - 2]._isObscured = false;
      }
    }

    // Opcional: manter o coringa em primeiro nas trincas se ele estiver visível
    if (isTrinca && hideMiddle) {
      const finalJokerIdx = mappedCards.findIndex(c => c.isJoker);
      if (finalJokerIdx !== -1 && finalJokerIdx !== 0) {
        const joker = mappedCards.splice(finalJokerIdx, 1)[0];
        mappedCards.unshift(joker);
      }
    }

    return { visibleCards: mappedCards, hideMiddle };
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

  // Informações da batida para exibição no breakdown
  const lastRoundEndEvent = gameLog.slice().reverse().find(e => e.type === 'round_end');
  const hitterId = lastRoundEndEvent?.playerId;
  const hitterTeamId = players.find(p => p.id === hitterId)?.teamId;

  // Score total atual = acumulado + jogos na mesa esta rodada
  // Se a rodada acabou, matchScores já contém o total atualizado, não precisa somar o live
  const myTotal = roundOver ? myAccum : myAccum + myLive;
  const opTotal = roundOver ? opAccum : opAccum + opLive;
  const myRodadaDisplay = roundOver ? teams['team-1'].score : myLive;
  const opRodadaDisplay = roundOver ? teams['team-2'].score : opLive;

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
            {myRodadaDisplay !== 0 && (
              <Text style={styles.scoreLive}>
                {myRodadaDisplay > 0 ? '+' : ''}{myRodadaDisplay} rodada
              </Text>
            )}
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
          {opRodadaDisplay !== 0 && (
            <Text style={styles.scoreLive}>
              {opRodadaDisplay > 0 ? '+' : ''}{opRodadaDisplay} rodada
            </Text>
          )}
        </View>
      </View>


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
                  {opTeamGames.length === 0 && <Text style={styles.emptyGames}>Nenhum jogo ainda</Text>}
                  <View style={[
                    styles.gamesGrid,
                    denseMode && styles.gamesGridDense,
                    tightMode && styles.gamesGridTight,
                  ]}>
                    {opTeamGames.map((gameCards, idx) => {
                      const canasta = checkCanasta(gameCards);
                      const { visibleCards, hideMiddle } = getVisibleCards(gameCards, 'team-2', idx);
                      const isTrinca = gameCards.length >= 3 && gameCards.filter(c => !c.isJoker).every((c, _, arr) => c.value === arr[0].value);
                      const isCanasta = canasta !== 'none';

                      let cardMargin = -28;
                      const obscuredMargin = -46;
                      if (visibleCards.length > 1) {
                        const containerWidth = (SW - 90) / 3;
                        const numObscured = visibleCards.filter((c: any) => c._isObscured).length;
                        const numNormalNotFirst = visibleCards.length - 1 - numObscured;
                        
                        let normalMargin = isCanasta ? -30 : -28;
                        if (numNormalNotFirst > 0) {
                           const obscuredWidth = numObscured * (50 + obscuredMargin);
                           const spaceForNormal = containerWidth - 50 - obscuredWidth + 16; // 16px gained by clipping last card
                           const calcMargin = Math.floor(spaceForNormal / numNormalNotFirst) - 50;
                           normalMargin = Math.max(-34, Math.min(normalMargin, calcMargin));
                        }
                        cardMargin = normalMargin;
                      }

                      return (
                        <TouchableOpacity
                          key={`op-${idx}`}
                          activeOpacity={0.7}
                          onPress={() => handleOpenOpponentGame(idx)}
                          style={[
                            styles.gameCard,
                            denseMode && styles.gameCardDense,
                            tightMode && styles.gameCardTight,
                            styles.opponentGame,
                            canasta !== 'none' && (canasta === 'clean' ? styles.cleanCanasta : styles.dirtyCanasta),
                            { transform: [{ scale }] }
                          ]}
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
                                {visibleCards.map((c: any, ci: number) => {
                                  const isPrevObscured = ci > 0 && visibleCards[ci - 1]._isObscured;
                                  return (
                                    <View key={c.id} style={ci > 0 ? { marginLeft: isPrevObscured ? obscuredMargin : cardMargin } : undefined}>
                                      <View style={[
                                        styles.cardClip,
                                        denseMode && styles.cardClipCompact,
                                        tightMode && styles.cardClipTight,
                                        ci === visibleCards.length - 1 && styles.cardClipLast,
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
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* ========================================================== */}
                  {/* INÍCIO DA ÁREA CENTRAL (PLACAR/STATUS) DIVIDINDO OS JOGOS */}
                  {/* ========================================================== */}
                  <View style={styles.middleDividerContainer}>
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
                      <View style={[
                        styles.statusItem, 
                        { backgroundColor: 'rgba(255,214,0,0.1)' },
                        deads.length === 0 && { borderColor: '#FF5252', borderWidth: 1 }
                      ]}>
                        <Text style={styles.statusName}>Mortos</Text>
                        <Text style={[styles.statusCards, { color: deads.length === 0 ? '#FF5252' : '#FFD600' }]}>
                          {deads.length} {deads.length === 0 ? '🚫' : '📦'}
                        </Text>
                      </View>
                    </View>
                    {/* BANNER DE EVENTO — no fluxo normal, não absolute */}
                    <EventBanner events={gameLog} />
                  </View>
                  {/* ========================================================== */}
                  {/* Nossos jogos */}
                  <View style={[
                    styles.gamesGrid,
                    denseMode && styles.gamesGridDense,
                    tightMode && styles.gamesGridTight,
                  ]}>
                    {myTeamGames.map((gameCards, idx) => {
                      const canasta = checkCanasta(gameCards);
                      const { visibleCards, hideMiddle } = getVisibleCards(gameCards, 'team-1', idx);
                      const isTrinca = gameCards.length >= 3 && gameCards.filter(c => !c.isJoker).every((c, _, arr) => c.value === arr[0].value);
                      const isCanasta = canasta !== 'none';

                      let cardMargin = -28;
                      const obscuredMargin = -46;
                      if (visibleCards.length > 1) {
                        const containerWidth = (SW - 90) / 3;
                        const numObscured = visibleCards.filter((c: any) => c._isObscured).length;
                        const numNormalNotFirst = visibleCards.length - 1 - numObscured;
                        
                        let normalMargin = isCanasta ? -30 : -28;
                        if (numNormalNotFirst > 0) {
                           const obscuredWidth = numObscured * (50 + obscuredMargin);
                           const spaceForNormal = containerWidth - 50 - obscuredWidth + 16;
                           const calcMargin = Math.floor(spaceForNormal / numNormalNotFirst) - 50;
                           normalMargin = Math.max(-34, Math.min(normalMargin, calcMargin));
                        }
                        cardMargin = normalMargin;
                      }

                      const canAdd = (() => {
                        if (!isMyTurn || turnPhase !== 'play' || selectedCards.length === 0) return false;
                        if (!user) return false;

                        // Regra do Lixo: se pegou o lixo, a seleção deve conter o topo
                        if (mustPlayPileTopId && !selectedCards.includes(mustPlayPileTopId)) return false;

                        const selCards = user.hand.filter(c => selectedCards.includes(c.id));
                        if (selCards.length === 0) return false;

                        const combined = [...gameCards, ...selCards];
                        
                        // Valida a combinação usando as regras do jogo atual
                        return validateSequence(combined, gameMode);
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
                                {visibleCards.map((c: any, ci: number) => {
                                  const isPrevObscured = ci > 0 && visibleCards[ci - 1]._isObscured;
                                  return (
                                    <View key={c.id} style={ci > 0 ? { marginLeft: isPrevObscured ? obscuredMargin : cardMargin } : undefined}>
                                      <View style={[
                                        styles.cardClip,
                                        denseMode && styles.cardClipCompact,
                                        tightMode && styles.cardClipTight,
                                        ci === visibleCards.length - 1 && styles.cardClipLast,
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

      </View>


      {/* ACTION BAR INFERIOR */}
      <View style={styles.actionBar}>
        <View style={styles.actionBarLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {isMyTurn && turnPhase === 'play' && turnHistory.length > 0 && (
              <TouchableOpacity
                style={styles.undoButtonInline}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  undoLastPlay('user');
                  setSelectedCards([]);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.undoButtonText}>↩️</Text>
              </TouchableOpacity>
            )}

            <View style={styles.handCounterSmall}>
               <Text style={styles.handCounterLabel}>VOCÊ</Text>
               <Text style={styles.handCounterValue}>{user.hand.length}</Text>
            </View>
          </View>
        </View>

        <View style={styles.actionBarRight}>
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

      {/* MODAL JOGO EXPANDIDO */}
      <Modal visible={!!tempOpenGame} transparent animationType="fade" onRequestClose={() => setTempOpenGame(null)}>
        <TouchableOpacity style={styles.expandedOverlay} activeOpacity={1} onPress={() => setTempOpenGame(null)}>
          <View style={styles.expandedBox}>
            <Text style={styles.expandedTitle}>
              {tempOpenGame?.teamId === 'team-1' ? 'Nosso Jogo' : 'Jogo Adversário'}
            </Text>
            <View style={styles.expandedContent}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.expandedCardsScroll}>
                {tempOpenGame && (tempOpenGame.teamId === 'team-1' ? teams['team-1'].games : teams['team-2'].games)[tempOpenGame.index].map((c) => (
                  <View key={c.id} style={styles.expandedCardWrapper}>
                    <Card card={c} />
                  </View>
                ))}
              </ScrollView>
            </View>
            <Text style={styles.expandedCloseHint}>Toque fora para fechar</Text>
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
              {hitterTeamId === 'team-1' && (
                <Text style={[styles.modalScoreRow, { color: '#B9F6CA' }]}>Batida: +100</Text>
              )}
              {!teams['team-1'].hasGottenDead && (
                <Text style={[styles.modalScoreRow, { color: '#FF8A80' }]}>Não pegou morto: -100</Text>
              )}
              <Text style={styles.modalScoreRow}>Esta rodada: {teams['team-1'].score}</Text>
              <Text style={styles.modalScoreTotal}>Total: {matchScores['team-1']}</Text>
            </View>

            {/* Breakdown Eles */}
            <View style={styles.modalTeamBlock}>
              <Text style={styles.modalTeamTitle}>🔴 Equipe adversária</Text>
              <Text style={styles.modalScoreRow}>Jogos na mesa: +{calculateLiveScore(teams['team-2'])}</Text>
              <Text style={styles.modalScoreRow}>Penalidade mão: -{opHandPenalty}</Text>
              {hitterTeamId === 'team-2' && (
                <Text style={[styles.modalScoreRow, { color: '#B9F6CA' }]}>Batida: +100</Text>
              )}
              {!teams['team-2'].hasGottenDead && (
                <Text style={[styles.modalScoreRow, { color: '#FF8A80' }]}>Não pegou morto: -100</Text>
              )}
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
  handArea: { 
    height: 110,
    overflow: 'visible',
    paddingBottom: 0,
    justifyContent: 'flex-start',
  },
  turnBox: { alignItems: 'center' },
  turnName: { color: '#FFD600', fontWeight: '900', fontSize: 18 },
  phaseLabel: {
    color: '#fff', fontWeight: '800', fontSize: 13,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, marginTop: 2,
    overflow: 'hidden',
  },
  infoText: { color: '#B9F6CA', fontSize: 14, textAlign: 'right' },

  // BOARD
  board: { flex: 1, flexDirection: 'row', paddingHorizontal: 4, paddingTop: 4 },
  gamesScroll: { flex: 1 },
  gamesScrollContent: { paddingLeft: 6, paddingRight: 6, paddingBottom: 10, flexGrow: 1 },
  sectionLabel: { color: '#E8F5E9', fontWeight: '800', fontSize: 16, marginBottom: 4 },
  emptyGames: { color: 'rgba(255,255,255,0.4)', fontSize: 15, marginBottom: 8, fontStyle: 'italic' },
  // GRADE DE JOGOS
  gamesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 8,
    marginBottom: 6,
    justifyContent: 'space-between',
    overflow: 'visible',
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
    paddingVertical: 4,
    paddingHorizontal: 4,
    flexBasis: '31%',
    minWidth: '31%',
    flexGrow: 0,
    flexShrink: 1,
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
    minHeight: 84,
    justifyContent: 'center',
    paddingTop: 6,
    overflow: 'visible',
  },
  gameCardsWrapCompact: {
    minHeight: 80,
    paddingTop: 4,
  },
  gameCardsWrapTight: {
    minHeight: 76,
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
    borderWidth: 2, 
    borderColor: '#FFD600', 
    backgroundColor: 'rgba(255,214,0,0.2)',
    zIndex: 5,
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
    fontSize: 11,
    fontWeight: '900',
  },
  pileCounterBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FF5722', // Cores mais vivas para facilitar a identificação
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
    zIndex: 100, // Valor bem alto para garantir topo
    elevation: 10,
  },
  pileNameTag: {
    position: 'absolute',
    bottom: -8,
    left: -4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 100,
    elevation: 10,
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
  cardClipLast: { width: 34 },
  cardClipLastTight: { width: 30 },
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
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
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
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 16,
    marginBottom: 0, // Ajustado para dar espaço às cartas inteiras
    zIndex: 10,
  },
  actionBarLeft: {
    flex: 1,
    alignItems: 'flex-start',
    paddingTop: 8,
  },
  actionBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  undoButtonInline: {
    backgroundColor: 'rgba(255,214,0,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FFD600',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  middleDividerContainer: {
    marginTop: -8, // pull up closer to opponent games
    marginBottom: 16,
    borderRadius: 8,
    overflow: 'visible',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pileBox: { 
    alignItems: 'center',
    zIndex: 60, // Individualmente alto também
  },
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
    width: 50, height: 72, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
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

  undoButtonText: {
    color: '#FFD600',
    fontWeight: '900',
    fontSize: 15,
  },

  // EXPANDED GAME MODAL
  expandedOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center', alignItems: 'center',
  },
  expandedBox: {
    width: '100%',
    alignItems: 'center',
  },
  expandedTitle: {
    color: '#FFD600', fontSize: 24, fontWeight: '900', marginBottom: 30,
    textTransform: 'uppercase', letterSpacing: 4,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4,
  },
  expandedContent: {
    height: 180, // Altura suficiente para os cards normais
    width: '100%',
  },
  expandedCardsScroll: {
    paddingHorizontal: 40,
    alignItems: 'center',
    gap: -15, // Overlap elegante
  },
  expandedCardWrapper: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6, shadowRadius: 12, elevation: 15,
    backgroundColor: '#fff', borderRadius: 6, // Garante que a sombra apareça bem
  },
  expandedCloseHint: {
    color: 'rgba(255,255,255,0.4)', fontSize: 15, marginTop: 40,
    fontWeight: '700', letterSpacing: 1,
  },
  handCounterSmall: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 50,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  handCounterLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '700' },
  handCounterValue: { color: '#fff', fontSize: 16, fontWeight: '900' },
});

import * as NavigationBar from 'expo-navigation-bar';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  Animated
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '../../components/Card';
import { EventBanner } from '../../components/EventBanner';
import { Hand } from '../../components/Hand';
import { AchievementToast } from '../../components/AchievementToast';
import { calculateCardPoints, calculateLiveScore } from '../../game/engine';
import { canTakePile, checkCanasta, validateSequence } from '../../game/rules';
import { ACHIEVEMENTS } from '../../game/achievements';
import { useBotAI } from '../../hooks/useBotAI';
import { useGameSounds } from '../../hooks/useGameSounds';
import { useOnlineSync } from '../../hooks/useOnlineSync';
import { useGameStore } from '../../store/gameStore';
import { useStatsStore } from '../../store/statsStore';
import { useOnlineStore, SEAT_PLAYER_IDS, TEAM_OF_SEAT } from '../../store/onlineStore';
import { cardLabel } from '../../game/deck';


/** Retorna label, emoji e chave de estilo para uma canastra */
function getCanastaInfo(canasta: 'clean' | 'dirty' | 'none', length: number) {
  if (canasta === 'dirty') return { label: '+100', emoji: '★', tier: 'dirty' as const };
  if (canasta === 'clean') {
    if (length >= 14) return { label: '+1000', emoji: '🌟', tier: 'c1000' as const };
    if (length >= 13) return { label: '+500',  emoji: '💫', tier: 'c500'  as const };
    return             { label: '+200',  emoji: '✨', tier: 'c200'  as const };
  }
  return { label: '', emoji: '', tier: 'none' as const };
}

export default function GameScreen() {
  useKeepAwake();
  const { width: SW, height: SH } = useWindowDimensions();
  const isLandscape = SW > SH;
  const tabletScale = SW >= 600 ? Math.min(SW / 450, SH / 650, 1.8) : 1.0;
  const {
    players, deck, pile, deads, teams, currentTurnPlayerId,
    turnPhase, roundOver, winnerTeamId, matchScores, targetScore,
    drawFromDeck, drawFromPile, discard, playCards, addToExistingGame,
    startNewRound, startNewGame,
    gameLog, lastDrawnCardId, mustPlayPileTopId, gameMode, botDifficulty,
    animatingDiscard, animatingDrawPlayerId,
    turnHistory, undoLastPlay
  } = useGameStore();

  // Timer de AFK (30 segundos)
  const timerAnim = useRef(new Animated.Value(1)).current;
  const drawPulseAnim = useRef(new Animated.Value(1)).current;
  const lastEventId = gameLog[gameLog.length - 1]?.id;
  useEffect(() => {
    timerAnim.setValue(1);
    if (!isOnlineMode) return; // Em modo offline a barra não corre (fica invisível/parada)
    const anim = Animated.timing(timerAnim, {
      toValue: 0,
      duration: 30000,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [currentTurnPlayerId, lastEventId]);

  // ── Modo Online ────────────────────────────────────────────────────────────
  const { mySeat, roomStatus, seats } = useOnlineStore();
  const isOnlineMode = roomStatus === 'playing';
  // Em modo offline sempre sou 'user' (seat 0); online, uso o assento atribuído
  const myPlayerId = isOnlineMode && mySeat !== null ? SEAT_PLAYER_IDS[mySeat] : 'user';
  const myTeamId   = isOnlineMode && mySeat !== null ? TEAM_OF_SEAT[mySeat] : 'team-1';
  const opTeamId   = myTeamId === 'team-1' ? 'team-2' : 'team-1';
  // Bot AI: offline = sempre. Online = só o host (seat 0) roda os bots.
  const botAIDisabled = isOnlineMode && mySeat !== 0;
  const isHost = !isOnlineMode || mySeat === 0;
  // IDs de jogadores humanos (não devem ser controlados pelo bot AI)
  // Se seats ainda não foi populado (tudo null), usa fallback ['user'] para não correr o bot pelo humano
  const humanPlayerIds = isOnlineMode && seats.some(s => s !== null)
    ? seats.map((s, idx) => s !== null ? SEAT_PLAYER_IDS[idx] : null).filter(Boolean) as string[]
    : ['user'];

  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  // Limpa seleções fantasmas (IDs de cartas que saíram da mão por sync online)
  const userRef = players.find(p => p.id === (isOnlineMode && mySeat !== null ? SEAT_PLAYER_IDS[mySeat] : 'user'));
  const handIds = userRef?.hand.map(c => c.id);
  useEffect(() => {
    if (!handIds) return;
    setSelectedCards(prev => {
      const filtered = prev.filter(id => handIds.includes(id));
      return filtered.length !== prev.length ? filtered : prev;
    });
  }, [handIds?.join(',')]);
  const [showMenu, setShowMenu] = useState(false);
  const [tempOpenGame, setTempOpenGame] = useState<{ teamId: string; index: number } | null>(null);
  const router = useRouter();
  const { playSound } = useGameSounds();
  const { recordRound, newlyUnlocked, shiftNewlyUnlocked } = useStatsStore();
  const roundRecorded = useRef(false);
  const prevSeatsRef = useRef(seats);

  // Sincronização Firebase ↔ gameStore (não faz nada em modo offline)
  useOnlineSync();

  // Detecta jogador que saiu no meio do jogo online
  useEffect(() => {
    if (!isOnlineMode) return;
    const prevSeats = prevSeatsRef.current;
    seats.forEach((seat, idx) => {
      if (prevSeats[idx] !== null && seat === null) {
        const playerId = SEAT_PLAYER_IDS[idx];
        const playerName = prevSeats[idx]?.name ?? playerId;
        const botName = `Bot ${idx + 1}`;
        useGameStore.setState(state => ({
          players: state.players.map(p =>
            p.id === playerId ? { ...p, name: botName } : p
          ),
          gameLog: [
            ...state.gameLog.slice(-19),
            {
              id: Date.now(),
              playerId,
              playerName,
              type: 'player_left' as const,
              message: `${playerName} saiu. ${botName} assumiu.`,
              timestamp: Date.now(),
            },
          ],
        }));
      }
    });
    prevSeatsRef.current = seats;
  }, [seats, isOnlineMode]);

  // Toast de conquistas
  const currentToastAchievement = newlyUnlocked.length > 0
    ? ACHIEVEMENTS.find(a => a.id === newlyUnlocked[0]) ?? null
    : null;

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
    if (currentTurnPlayerId === myPlayerId && currentTurnPlayerId !== prevTurnPlayer.current) {
      playSound('turno');
    }
    prevTurnPlayer.current = currentTurnPlayerId;
  }, [currentTurnPlayerId, playSound]);

  // ── Registrar estatísticas quando a rodada termina ──────────────────────
  useEffect(() => {
    if (!roundOver) {
      roundRecorded.current = false;
      return;
    }
    if (roundRecorded.current) return;
    roundRecorded.current = true;

    // Canastas do meu time nesta rodada
    let cleanCanastas = 0, dirtyCanastas = 0, canastas500 = 0, canastas1000 = 0;
    for (const game of teams[myTeamId].games) {
      const ct = checkCanasta(game);
      if (ct === 'clean') {
        if (game.length >= 14) canastas1000++;
        else if (game.length >= 13) canastas500++;
        else cleanCanastas++;
      } else if (ct === 'dirty') {
        dirtyCanastas++;
      }
    }

    // O meu jogador foi quem bateu?
    const lastRoundEnd = gameLog.slice().reverse().find(e => e.type === 'round_end');
    const userBated = (lastRoundEnd?.playerId === myPlayerId) && (lastRoundEnd?.message?.includes('BATEU') ?? false);

    recordRound({
      matchEnded: winnerTeamId !== null,
      matchWon: winnerTeamId === myTeamId,
      myRoundScore: teams[myTeamId].score,
      myMatchScore: matchScores[myTeamId],
      theirMatchScore: matchScores[opTeamId],
      cleanCanastas,
      dirtyCanastas,
      canastas500,
      canastas1000,
      userBated,
      difficulty: botDifficulty,
    });
  }, [roundOver]);

  useBotAI({ disabled: botAIDisabled, humanPlayerIds, isOnline: isOnlineMode });

  const isMyTurn = currentTurnPlayerId === myPlayerId;

  // Animação de pulso nas pilhas quando é minha vez de comprar
  useEffect(() => {
    if (isMyTurn && turnPhase === 'draw') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(drawPulseAnim, { toValue: 0.2, duration: 500, useNativeDriver: true }),
          Animated.timing(drawPulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => { pulse.stop(); drawPulseAnim.setValue(1); };
    } else {
      drawPulseAnim.setValue(1);
    }
  }, [isMyTurn, turnPhase]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    }
  }, []);

  const user = players.find(p => p.id === myPlayerId);
  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Volte e inicie um Novo Jogo</Text>
      </View>
    );
  }

  const myTeamGames = teams[myTeamId].games;
  const opTeamGames = teams[opTeamId].games;

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
    drawFromDeck(myPlayerId);
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
      const topCard = pile[pile.length - 1];
      const selCards = user.hand.filter(c => selectedCards.includes(c.id));
      let actionToTake: (() => void) | null = null;
      
      const alertDeadlock = () => Alert.alert(
        '❌ Não pode pegar o lixo',
        `Pegar o lixo te forçaria a bater usando o ${cardLabel(topCard)}, mas sua equipe não tem canastra limpa.`
      );

      // Tenta adicionar a um JOGO EXISTENTE com as cartas selecionadas (se houver) + carta do topo
      for (let i = 0; i < myTeamGames.length; i++) {
        if (validateSequence([...myTeamGames[i], ...selCards, topCard], gameMode)) {
          actionToTake = () => {
            const success = drawFromPile(myPlayerId);
            if (success) addToExistingGame(myPlayerId, [...selectedCards, topCard.id], i);
            else alertDeadlock();
          };
          break;
        }
      }

      // Se não encontrou jogo existente, tenta formar um NOVO jogo (mínimo de 2 selecionadas + topo = 3)
      if (!actionToTake && selCards.length >= 2) {
        if (validateSequence([...selCards, topCard], gameMode)) {
          actionToTake = () => {
             const success = drawFromPile(myPlayerId);
             if (success) {
               const playSuccess = playCards(myPlayerId, [...selectedCards, topCard.id]);
               if (!playSuccess) {
                 Alert.alert('⚠️ Ação bloqueada', 'O jogo é válido, mas você não pode ficar sem cartas na mão sem ter completado os requisitos para bater. O lixo foi para a sua mão.');
               }
             } else {
               alertDeadlock();
             }
          };
        }
      }

      if (!actionToTake) {
         if (canTakePile(user.hand, pile, myTeamGames, gameMode)) {
           Alert.alert(
             'Selecione as cartas!',
             `Para pegar o lixo, selecione ANTES na sua mão as cartas que formam jogo com o ${cardLabel(topCard)}.\n` + 
             `(Ou clique se a carta pode incrementar diretamente um jogo seu)`
           );
         } else {
           Alert.alert('❌ Não pode pegar o lixo', `Você precisa usar o ${cardLabel(topCard)} em um jogo (novo ou existente).`);
         }
         return;
      }
      
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      actionToTake();
      setSelectedCards([]);
      return;
    }

    // Modo Araujo Pereira (puxar o lixo é livre)
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const tookPile = drawFromPile(myPlayerId);
    if (tookPile) setSelectedCards([]);
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
      const team = teams[myTeamId];
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
    discard(myPlayerId, selectedCards[0]);
    setSelectedCards([]);
  };

  const handlePlayCards = () => {
    if (!isMyTurn || turnPhase !== 'play') return;
    if (gameMode !== 'araujo_pereira' && mustPlayPileTopId && !selectedCards.includes(mustPlayPileTopId)) {
      const topCard = user.hand.find(c => c.id === mustPlayPileTopId);
      const label = topCard ? cardLabel(topCard) : 'comprada';
      Alert.alert('⚠️ Regra do Lixo', `Sua primeira jogada DEVE incluir o ${label} (topo do lixo).\n\nVocê pode:\n• Tocar num jogo seu já na mesa (selecionando o ${label} + cartas para completar)\n• Ou baixar um novo jogo com 3+ cartas`);
      return;
    }
    if (selectedCards.length < 3) {
      Alert.alert('Mínimo 3 cartas', 'Selecione no mínimo 3 cartas para baixar um jogo STBL.');
      return;
    }
    const success = playCards(myPlayerId, selectedCards);
    if (success) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSelectedCards([]);
    } else {
      // Feedback melhorado dependendo do motivo da falha
      const fits = validateSequence(user.hand.filter(c => selectedCards.includes(c.id)), gameMode);
      if (!fits) {
        const msg = gameMode === 'araujo_pereira' 
          ? 'As cartas não formam uma sequência válida ou trinca (máximo 1 curinga em Buraco Mole).'
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
      setTempOpenGame({ teamId: myTeamId, index: gameIndex });
      setTimeout(() => {
        setTempOpenGame(prev => (prev?.teamId === myTeamId && prev?.index === gameIndex) ? null : prev);
      }, 8000);
      return;
    }

    // Se tem cartas selecionadas mas não é a vez do jogador, abre o ZOOM
    if (!canPlay) {
      setTempOpenGame({ teamId: myTeamId, index: gameIndex });
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
    const success = addToExistingGame(myPlayerId, selectedCards, gameIndex);
    if (success) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSelectedCards([]);
      // SUCESSO: Não abre o modal, para o jogador ver a carta entrando no jogo
    } else {
      // Se falhou, verifica o motivo para dar um feedback melhor
      const player = players.find(p => p.id === myPlayerId);
      if (player) {
        const selCards = player.hand.filter(c => selectedCards.includes(c.id));
        const combined = [...myTeamGames[gameIndex], ...selCards];
        const fits = validateSequence(combined, gameMode);

        if (!fits) {
          // Se falhou por regra do jogo, abre o ZOOM para o jogador conferir o jogo e entender o erro
          setTempOpenGame({ teamId: myTeamId, index: gameIndex });
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
    setTempOpenGame({ teamId: opTeamId, index: idx });
    setTimeout(() => {
      setTempOpenGame(prev => (prev?.teamId === opTeamId && prev?.index === idx) ? null : prev);
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

  // Placar acumulado (relativo ao meu time)
  const myAccum = matchScores[myTeamId];
  const opAccum = matchScores[opTeamId];
  // Pontos vivos da rodada (jogos já na mesa)
  const myLive = calculateLiveScore(teams[myTeamId]);
  const opLive = calculateLiveScore(teams[opTeamId]);
  // Penalidade estimada das cartas na mão
  const myHandPenalty = players
    .filter(p => p.teamId === myTeamId)
    .reduce((sum, p) => sum + p.hand.reduce((s, c) => s + calculateCardPoints(c), 0), 0);
  const opHandPenalty = players
    .filter(p => p.teamId === opTeamId)
    .reduce((sum, p) => sum + p.hand.reduce((s, c) => s + calculateCardPoints(c), 0), 0);

  // Informações da batida para exibição no breakdown
  const lastRoundEndEvent = gameLog.slice().reverse().find(e => e.type === 'round_end');
  const isRealBatida = lastRoundEndEvent?.message?.includes('BATEU') ?? false;
  const hitterId = isRealBatida ? lastRoundEndEvent?.playerId : undefined;
  const hitterTeamId = players.find(p => p.id === hitterId)?.teamId;

  // Score total atual = acumulado + jogos na mesa esta rodada
  // Se a rodada acabou, matchScores já contém o total atualizado, não precisa somar o live
  const myTotal = roundOver ? myAccum : myAccum + myLive;
  const opTotal = roundOver ? opAccum : opAccum + opLive;
  const myRodadaDisplay = roundOver ? teams[myTeamId].score : myLive;
  const opRodadaDisplay = roundOver ? teams[opTeamId].score : opLive;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      {/* HEADER */}
      <View style={styles.header}>
        {/* ☰ + NÓS lado esquerdo */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => setShowMenu(true)}
            style={styles.menuBtn}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          >
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
            {isMyTurn ? 'SUA VEZ' : (() => {
              const tp = players.find(p => p.id === currentTurnPlayerId);
              if (!tp) return '';
              const si = SEAT_PLAYER_IDS.indexOf(tp.id as any);
              return isOnlineMode && si >= 0 ? (seats[si]?.name ?? `Bot ${si + 1}`) : tp.name;
            })()}
          </Text>
          {isMyTurn && (
            <Text style={[styles.phaseLabel, { backgroundColor: phaseColor }]}>{phaseLabel}</Text>
          )}
          <Text style={styles.targetText}>Meta: {targetScore} | {gameMode === 'araujo_pereira' ? 'Buraco Mole' : 'Clássico'}</Text>
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
            style={{ flexGrow: 1, justifyContent: SW >= 600 ? 'center' : 'flex-start' }}
          >
            {(() => {
              const totalGames = (myTeamGames || []).length + (opTeamGames || []).length;
              const denseLevel = isLandscape ? 2 : totalGames > 15 ? 2 : totalGames > 10 ? 1 : 0;
              const denseMode = denseLevel > 0;
              const tightMode = denseLevel > 1;
              const scale = tabletScale;
              const smallCardW = Math.round(50 * scale);
              const landscapeFactor = isLandscape ? 0.78 : 1;
              const clipH = Math.round((tightMode ? 64 : denseMode ? 68 : 72) * scale * landscapeFactor);
              const lastClipW = Math.round(28 * scale);
              const wrapMinH = Math.round((tightMode ? 68 : denseMode ? 72 : 76) * scale * landscapeFactor);

              return (
                <>
                  {/* Jogos dos adversários */}
                  {opTeamGames.length === 0 && <Text style={styles.emptyGames}>Nenhum jogo ainda</Text>}
                  <View style={[
                    styles.gamesGrid,
                    denseMode && styles.gamesGridDense,
                    tightMode && styles.gamesGridTight,
                    { rowGap: Math.round((tightMode ? 1 : denseMode ? 2 : 3) * scale), columnGap: Math.round(8 * scale) }
                  ]}>
                    {opTeamGames.map((gameCards, idx) => {
                      const canasta = checkCanasta(gameCards);
                      const { visibleCards, hideMiddle } = getVisibleCards(gameCards, 'team-2', idx);
                      const isTrinca = gameCards.length >= 3 && gameCards.filter(c => !c.isJoker).every((c, _, arr) => c.value === arr[0].value);
                      const isCanasta = canasta !== 'none';



                      return (
                        <TouchableOpacity
                          key={`op-${idx}`}
                          activeOpacity={0.7}
                          onPress={() => handleOpenOpponentGame(idx)}
                          style={[
                            styles.gameCard,
                            denseMode && styles.gameCardDense,
                            tightMode && styles.gameCardTight,
                            isLandscape && styles.gameCardLandscape,
                            styles.opponentGame,
                            canasta !== 'none' && styles.canastaByTier[getCanastaInfo(canasta, gameCards.length).tier],
                          ]}
                        >
                          <View pointerEvents="none" style={styles.gameCardInner}>
                            <View style={[
                              styles.gameCardsWrap,
                              { minHeight: wrapMinH },
                            ]}>
                              <View style={[
                                styles.gameCards,
                                denseMode && styles.gameCardsDense,
                              ]}>
                                {visibleCards.map((c: any, ci: number) => {
                                    const isLast = ci === visibleCards.length - 1;
                                    const visibleW = c._isObscured 
                                      ? Math.round(4 * scale) 
                                      : (isCanasta ? Math.round(24 * scale) : Math.round(26 * scale));
                                      
                                    return (
                                      <View key={c.id}>
                                        <View style={[
                                          styles.cardClip,
                                          { height: clipH },
                                          { width: isLast ? lastClipW : visibleW },
                                        ]}>
                                          <Card card={c} small />
                                        </View>
                                      </View>
                                    );
                                  })}
                                </View>
                                <View style={styles.gameCardOverlay}>
                                  <View style={[
                                    styles.counterBadgeOverlay,
                                    isCanasta && styles.badgeByTier[getCanastaInfo(canasta, gameCards.length).tier]
                                  ]}>
                                    <Text style={styles.counterTextOverlay}>
                                      {isCanasta && (getCanastaInfo(canasta, gameCards.length).emoji + ' ')}
                                      {gameCards.length}
                                    </Text>
                                  </View>
                                </View>
                              {isCanasta && (
                                <Text style={[styles.canastaBonusLabelBase, styles.canastaBonusByTier[getCanastaInfo(canasta, gameCards.length).tier]]}>
                                  {getCanastaInfo(canasta, gameCards.length).label}
                                </Text>
                              )}
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
                        const seatIdx = SEAT_PLAYER_IDS.indexOf(p.id as any);
                        const displayName = isOnlineMode && seatIdx >= 0
                          ? (seats[seatIdx]?.name ?? `Bot ${seatIdx + 1}`)
                          : p.name;
                        const shortName = displayName.length > 7 ? displayName.slice(0, 7) + '.' : displayName;

                        return (
                          <View key={p.id}>
                            <View style={[
                              styles.statusItem,
                              { minWidth: Math.round(46 * scale), paddingHorizontal: Math.round(6 * scale), paddingVertical: Math.round(4 * scale) },
                              p.id === myPlayerId && { borderColor: 'rgba(76,175,80,0.5)', borderWidth: 1 },
                              p.id === currentTurnPlayerId && styles.statusItemActive,
                            ]}>
                              <Text style={[styles.statusName, { fontSize: Math.round(15 * scale) }]}>{shortName}</Text>
                              <Text style={[styles.statusCards, { fontSize: Math.round(15 * scale) }]}>
                                {p.hand.length} 🎴 {p.hasGottenDead ? '💀' : ''}
                              </Text>
                              {p.id === currentTurnPlayerId && (
                                <View style={{ width: '100%', height: 5, marginTop: 3 }}>
                                  {/* Barra verde: início (timerAnim 0.6–1.0) */}
                                  <Animated.View style={{
                                    position: 'absolute', top: 0, left: 0,
                                    width: '100%', height: 5,
                                    backgroundColor: '#4CAF50',
                                    transform: [{ scaleX: timerAnim }],
                                    opacity: timerAnim.interpolate({ inputRange: [0.5, 0.7], outputRange: [0, 1], extrapolate: 'clamp' }),
                                  }} />
                                  {/* Barra amarela: meio (timerAnim 0.25–0.65) */}
                                  <Animated.View style={{
                                    position: 'absolute', top: 0, left: 0,
                                    width: '100%', height: 5,
                                    backgroundColor: '#FFD600',
                                    transform: [{ scaleX: timerAnim }],
                                    opacity: timerAnim.interpolate({ inputRange: [0.25, 0.45, 0.6, 0.75], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
                                  }} />
                                  {/* Barra vermelha: fim (timerAnim 0–0.35) */}
                                  <Animated.View style={{
                                    position: 'absolute', top: 0, left: 0,
                                    width: '100%', height: 5,
                                    backgroundColor: '#F44336',
                                    transform: [{ scaleX: timerAnim }],
                                    opacity: timerAnim.interpolate({ inputRange: [0.2, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }),
                                  }} />
                                </View>
                              )}
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
                        { minWidth: Math.round(46 * scale), paddingHorizontal: Math.round(6 * scale), paddingVertical: Math.round(4 * scale), backgroundColor: 'rgba(255,214,0,0.1)' },
                        deads.length === 0 && { borderColor: '#FF5252', borderWidth: 1 }
                      ]}>
                        <Text style={[styles.statusName, { fontSize: Math.round(15 * scale) }]}>Mortos</Text>
                        <Text style={[styles.statusCards, { fontSize: Math.round(15 * scale), color: deads.length === 0 ? '#FF5252' : '#FFD600' }]}>
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
                    { rowGap: Math.round((tightMode ? 1 : denseMode ? 2 : 3) * scale), columnGap: Math.round(8 * scale) }
                  ]}>
                    {myTeamGames.map((gameCards, idx) => {
                      const canasta = checkCanasta(gameCards);
                      const { visibleCards, hideMiddle } = getVisibleCards(gameCards, 'team-1', idx);
                      const isTrinca = gameCards.length >= 3 && gameCards.filter(c => !c.isJoker).every((c, _, arr) => c.value === arr[0].value);
                      const isCanasta = canasta !== 'none';



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
                            isLandscape && styles.gameCardLandscape,
                            canasta !== 'none' && (canasta === 'clean' ? styles.cleanCanasta : styles.dirtyCanasta),
                            canAdd && styles.gameCardHighlight,
                          ]}
                          onPress={() => handleAddToGame(idx)}
                          activeOpacity={0.6}
                        >
                          <View pointerEvents="none" style={styles.gameCardInner}>
                            <View style={[
                              styles.gameCardsWrap,
                              { minHeight: wrapMinH },
                            ]}>
                              <View style={[
                                styles.gameCards,
                                denseMode && styles.gameCardsDense,
                              ]}>
                                {visibleCards.map((c: any, ci: number) => {
                                  const isLast = ci === visibleCards.length - 1;
                                  const visibleW = c._isObscured 
                                    ? Math.round(4 * scale) 
                                    : (isCanasta ? Math.round(24 * scale) : Math.round(26 * scale));

                                  return (
                                    <View key={c.id}>
                                      <View style={[
                                        styles.cardClip,
                                        { height: clipH },
                                        { width: isLast ? lastClipW : visibleW },
                                      ]}>
                                        <Card card={c} small />
                                      </View>
                                    </View>
                                  );
                                })}
                              </View>
                              <View style={styles.gameCardOverlay}>
                                <View style={[
                                  styles.counterBadgeOverlay,
                                  isCanasta && styles.badgeByTier[getCanastaInfo(canasta, gameCards.length).tier]
                                ]}>
                                  <Text style={styles.counterTextOverlay}>
                                    {isCanasta && (getCanastaInfo(canasta, gameCards.length).emoji + ' ')}
                                    {gameCards.length}
                                  </Text>
                                </View>
                                {canAdd && <Text style={styles.addTag}>➕</Text>}
                              </View>
                              {isCanasta && (
                                <Text style={[styles.canastaBonusLabelBase, styles.canastaBonusByTier[getCanastaInfo(canasta, gameCards.length).tier]]}>
                                  {getCanastaInfo(canasta, gameCards.length).label}
                                </Text>
                              )}
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
        {/* Background clicável para não ter "ponto cego" na hora de baixar jogo */}
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleTableClick}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.actionBarLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {isMyTurn && turnPhase === 'play' && turnHistory.length > 0 && (
              <TouchableOpacity
                style={styles.undoButtonInline}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  undoLastPlay(myPlayerId);
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
            {isMyTurn && turnPhase === 'draw' && (
              <Animated.View pointerEvents="none" style={[styles.drawPulseIndicator, { opacity: drawPulseAnim }]}>
                <Text style={styles.drawPulseText}>▼</Text>
              </Animated.View>
            )}
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
            {isMyTurn && turnPhase === 'draw' && (
              <Animated.View pointerEvents="none" style={[styles.drawPulseIndicator, { opacity: drawPulseAnim }]}>
                <Text style={styles.drawPulseText}>▼</Text>
              </Animated.View>
            )}
            {deck.length > 0 ? (
              <View>
                <Card card={{ id: '__hidden__', suit: 'spades', value: 3, deck: 1, isJoker: false }} isHidden small onPress={handleDrawDeck} />
              <View pointerEvents="none" style={styles.pileCounterBadge}><Text style={styles.counterText}>{deck.length}</Text></View>
              </View>
            ) : (
              <TouchableOpacity onPress={handleDrawDeck}>
              <View style={styles.emptySlot} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* MÃO DO JOGADOR */}
      {isMyTurn && turnPhase === 'play' && (
        <Animated.View pointerEvents="none" style={[styles.discardHint, { opacity: drawPulseAnim }]}>
          <Text style={styles.discardHintText}>▲ descarte uma carta ▲</Text>
        </Animated.View>
      )}
      <View style={[styles.handArea, { height: Math.round((isLandscape ? 72 : 93) * tabletScale) }]}>
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
              {tempOpenGame?.teamId === myTeamId ? 'Nosso Jogo' : 'Jogo Adversário'}
            </Text>
            <View style={styles.expandedContent}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.expandedCardsScroll}>
                {tempOpenGame && (teams[tempOpenGame.teamId as 'team-1' | 'team-2']?.games ?? [])[tempOpenGame.index]?.map((c) => (
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
                ? (winnerTeamId === myTeamId ? '🏆 VOCÊ VENCEU A PARTIDA!' : '😢 Adversários venceram!')
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
              <Text style={styles.modalScoreRow}>Jogos na mesa: +{calculateLiveScore(teams[myTeamId])}</Text>
              <Text style={styles.modalScoreRow}>Penalidade mão: -{myHandPenalty}</Text>
              {hitterTeamId === myTeamId && (
                <Text style={[styles.modalScoreRow, { color: '#B9F6CA' }]}>Batida: +100</Text>
              )}
              {!teams[myTeamId].hasGottenDead && (
                <Text style={[styles.modalScoreRow, { color: '#FF8A80' }]}>Não pegou morto: -100</Text>
              )}
              <Text style={styles.modalScoreRow}>Esta rodada: {teams[myTeamId].score}</Text>
              <Text style={styles.modalScoreTotal}>Total: {matchScores[myTeamId]}</Text>
            </View>

            {/* Breakdown Eles */}
            <View style={styles.modalTeamBlock}>
              <Text style={styles.modalTeamTitle}>🔴 Equipe adversária</Text>
              <Text style={styles.modalScoreRow}>Jogos na mesa: +{calculateLiveScore(teams[opTeamId])}</Text>
              <Text style={styles.modalScoreRow}>Penalidade mão: -{opHandPenalty}</Text>
              {hitterTeamId === opTeamId && (
                <Text style={[styles.modalScoreRow, { color: '#B9F6CA' }]}>Batida: +100</Text>
              )}
              {!teams[opTeamId].hasGottenDead && (
                <Text style={[styles.modalScoreRow, { color: '#FF8A80' }]}>Não pegou morto: -100</Text>
              )}
              <Text style={styles.modalScoreRow}>Esta rodada: {teams[opTeamId].score}</Text>
              <Text style={styles.modalScoreTotal}>Total: {matchScores[opTeamId]}</Text>
            </View>

            <Text style={styles.modalTarget}>Meta: {targetScore} pontos</Text>

            {winnerTeamId ? (
              isHost ? (
                <TouchableOpacity style={styles.modalBtn} onPress={async () => {
                  if (isOnlineMode) { await useOnlineStore.getState().leaveRoom(); }
                  startNewGame(targetScore, botDifficulty, gameMode);
                  router.replace('/(tabs)' as any);
                }}>
                  <Text style={styles.modalBtnText}>Novo Jogo</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.modalBtn} onPress={async () => {
                  const { leaveRoom } = useOnlineStore.getState();
                  await leaveRoom();
                  router.replace('/(tabs)' as any);
                }}>
                  <Text style={styles.modalBtnText}>Voltar ao Menu</Text>
                </TouchableOpacity>
              )
            ) : (
              isHost ? (
                <TouchableOpacity style={styles.modalBtn} onPress={() => { startNewRound(); setSelectedCards([]); }}>
                  <Text style={styles.modalBtnText}>Próxima Rodada ▶</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.modalWaiting}>Aguardando o host iniciar próxima rodada...</Text>
              )
            )}
          </View>
        </View>
      </Modal>

      {/* Toast de conquista */}
      <AchievementToast
        achievement={currentToastAchievement}
        onDismiss={shiftNewlyUnlocked}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1B5E20' },
  emptyText: { color: '#fff', textAlign: 'center', marginTop: 100, fontSize: 22 },

  // HEADER
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  scoreLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  scoreMain: { color: '#B9F6CA', fontSize: 27, fontWeight: '900' },
  scoreLive: { color: '#FFD600', fontSize: 15, fontWeight: '700' },
  scoreText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  targetText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 2 },
  restartBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  restartText: { fontSize: 20 },

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
    position: 'relative',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 46,
  },
  statusItemActive: {
    backgroundColor: 'rgba(255,214,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,214,0,0.35)',
    elevation: 2,
  },
  statusName: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  statusCards: {
    color: '#B9F6CA',
    fontSize: 15,
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
    height: 93,
    overflow: 'visible',
    paddingBottom: 0,
    justifyContent: 'flex-start',
  },
  turnBox: { alignItems: 'center' },
  turnName: { color: '#FFD600', fontWeight: '900', fontSize: 20 },
  phaseLabel: {
    color: '#fff', fontWeight: '800', fontSize: 15,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, marginTop: 2,
    overflow: 'hidden',
  },
  infoText: { color: '#B9F6CA', fontSize: 16, textAlign: 'right' },

  // BOARD
  board: { flex: 1, flexDirection: 'row', paddingHorizontal: 2, paddingTop: 4 },
  gamesScroll: { flex: 1 },
  gamesScrollContent: { paddingLeft: 4, paddingRight: 4, paddingBottom: 10, flexGrow: 1 },
  sectionLabel: { color: '#E8F5E9', fontWeight: '800', fontSize: 18, marginBottom: 4 },
  emptyGames: { color: 'rgba(255,255,255,0.4)', fontSize: 17, marginBottom: 8, fontStyle: 'italic' },
  // GRADE DE JOGOS
  gamesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 1,
    columnGap: 6,
    marginBottom: 12,
    justifyContent: 'flex-start',
    overflow: 'visible',
  },
  gamesGridDense: {
    rowGap: 2,
    columnGap: 6,
  },
  gamesGridTight: {
    rowGap: 1,
    columnGap: 6,
  },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 0,
    paddingVertical: 1,
    paddingHorizontal: 2,
    flexGrow: 0,
    flexShrink: 0,
    overflow: 'visible',
  },
  gameCardDense: {
    paddingVertical: 1,
    paddingHorizontal: 3,
  },
  gameCardLandscape: {
  },
  gameCardTight: {
    paddingVertical: 0,
    paddingHorizontal: 2,
  },
  gameCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'visible',
  },
  gameCardsWrap: {
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
    fontSize: 16,
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
    fontSize: 14,
    fontWeight: '900',
  },
  canastaTag: { fontSize: 17 },
  addTag: { fontSize: 16 },
  jokerBadge: { fontSize: 15, color: '#FFD600', fontWeight: '900' },
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
    fontSize: 14,
    fontWeight: '900',
  },
  counterTextOverlay: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  canastaBonusLabelBase: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  canastaBonusByTier: {
    dirty: { backgroundColor: '#E65100' },
    c200:  { backgroundColor: '#388E3C' },
    c500:  { backgroundColor: '#0277BD' },
    c1000: { backgroundColor: '#6A1B9A' },
  } as Record<string, object>,
  discardHint: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  discardHintText: {
    color: 'rgba(255,214,0,0.8)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  drawPulseIndicator: {
    position: 'absolute',
    top: -22,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  drawPulseText: {
    color: '#FFD600',
    fontSize: 22,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingHorizontal: 5,
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
  opponentGame: { backgroundColor: 'transparent' },
  cleanCanasta: {},
  dirtyCanasta: {},
  // Lookup maps por tier
  canastaByTier: {
    dirty: {},
    c200:  {},
    c500:  {},
    c1000: { borderLeftWidth: 3, borderLeftColor: '#CE93D8' },
    none:  {},
  } as Record<string, any>,
  gameCards: { flexDirection: 'row', overflow: 'visible', paddingLeft: 0, paddingRight: 4 },
  gameCardsInner: { flexDirection: 'row', alignSelf: 'flex-start', position: 'relative', overflow: 'visible' },
  gameCardsDense: { paddingLeft: 4, paddingRight: 4 },
  cardClip: {
    overflow: 'hidden',
    height: 72, // Exatamente a altura do small card
  },
  cardClipCompact: { height: 68 },
  cardClipTight: { height: 64 },
  cardClipLast: { width: 34 },
  cardClipLastTight: { width: 30 },
  canastaLabel: { fontSize: 14, color: '#FFD600', fontWeight: '800', marginLeft: 4 },
  gameCardCount: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginLeft: 4 },
  gameInfo: { alignItems: 'flex-end', marginLeft: 4 },
  addLabel: { fontSize: 13, color: '#FFD600', fontWeight: '800' },

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
    backgroundColor: '#E65100',
    borderWidth: 1.5,
    borderColor: '#FFD180',
  },
  ribbonText: {
    color: '#fff',
    fontSize: 11,
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
  // Lookup maps por tier
  ribbonByTier: {
    dirty: { backgroundColor: '#E65100', borderWidth: 1.5, borderColor: '#FFD180' },
    c200:  { backgroundColor: '#2E7D32', borderWidth: 1,   borderColor: '#A5D6A7' },
    c500:  { backgroundColor: '#0277BD', borderWidth: 1,   borderColor: '#81D4FA' },
    c1000: { backgroundColor: '#6A1B9A', borderWidth: 1.5, borderColor: '#CE93D8' },
    none:  {},
  } as Record<string, any>,
  badgeByTier: {
    dirty: { backgroundColor: '#E65100', borderColor: '#FFD180' },
    c200:  { backgroundColor: '#388E3C', borderColor: '#A5D6A7' },
    c500:  { backgroundColor: '#0277BD', borderColor: '#81D4FA' },
    c1000: { backgroundColor: '#6A1B9A', borderColor: '#CE93D8' },
    none:  {},
  } as Record<string, any>,

  // PILES
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 16,
    marginBottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)', // Um pouco mais escuro que a mesa
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
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
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'visible',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pileBox: { 
    alignItems: 'center',
    zIndex: 60, // Individualmente alto também
  },
  pileLabel: { color: '#E8F5E9', fontSize: 14, fontWeight: '700', marginBottom: 1 },

  // MENU ☰
  menuBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  menuBtnText: { fontSize: 18, color: '#fff' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 80, paddingRight: 12 },
  menuBox: { backgroundColor: '#1B4A28', borderRadius: 12, padding: 8, minWidth: 200, elevation: 10 },
  menuTitle: { color: 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 6, letterSpacing: 1 },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 8, marginBottom: 4, backgroundColor: 'rgba(255,255,255,0.06)' },
  menuItemText: { color: '#fff', fontSize: 19, fontWeight: '600' },
  menuClose: { backgroundColor: 'transparent', marginTop: 4 },
  emptySlot: {
    width: 50, height: 72, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
    borderStyle: 'dashed', borderRadius: 6, justifyContent: 'center', alignItems: 'center',
  },
  emptySlotText: { color: 'rgba(255,255,255,0.3)', fontSize: 13 },

  // MODAL
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#1B5E20', borderRadius: 16, padding: 24,
    width: '85%', maxWidth: 500, alignItems: 'center',
    borderWidth: 2, borderColor: '#FFD600',
  },
  modalTitle: { color: '#FFD600', fontSize: 27, fontWeight: '900', textAlign: 'center', marginBottom: 16 },
  modalScores: { marginBottom: 12, width: '100%' },
  modalScoreText: { color: '#fff', fontSize: 20, marginBottom: 4 },
  modalWhoWent: { color: '#FFD600', fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  modalTeamBlock: { width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: 10, marginBottom: 8 },
  modalTeamTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 4 },
  modalScoreRow: { color: 'rgba(255,255,255,0.75)', fontSize: 16, marginBottom: 2 },
  modalScoreTotal: { color: '#FFD600', fontSize: 18, fontWeight: '900', marginTop: 4 },
  modalTarget: { color: '#B9F6CA', fontSize: 17, marginBottom: 16 },
  modalBtn: {
    backgroundColor: '#FFD600', paddingHorizontal: 32, paddingVertical: 12,
    borderRadius: 24,
  },
  modalBtnText: { color: '#1B5E20', fontWeight: '900', fontSize: 20 },
  modalWaiting: { color: 'rgba(255,255,255,0.5)', fontSize: 16, textAlign: 'center', marginTop: 8 },

  undoButtonText: {
    color: '#FFD600',
    fontWeight: '900',
    fontSize: 17,
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
    color: '#FFD600', fontSize: 26, fontWeight: '900', marginBottom: 30,
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
    color: 'rgba(255,255,255,0.4)', fontSize: 17, marginTop: 40,
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
  handCounterLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700' },
  handCounterValue: { color: '#fff', fontSize: 18, fontWeight: '900' },
});

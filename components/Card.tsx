import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card as CardType } from '../game/deck';

interface CardProps {
  card: CardType;
  selected?: boolean;
  onPress?: () => void;
  isHidden?: boolean;
  small?: boolean;
  style?: any;
}

export const Card: React.FC<CardProps> = ({ card, selected, onPress, isHidden = false, small = false, style }) => {
  const w = small ? 50 : 60;
  const h = small ? 72 : 86;

  if (isHidden) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[styles.card, styles.hiddenCard, { width: w, height: h }]}
      >
        <Text style={[styles.hiddenText, small && { fontSize: 13 }]}>🂠</Text>
      </TouchableOpacity>
    );
  }

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const color = card.isJoker ? '#9C27B0' : isRed ? '#D32F2F' : '#212121';

  const suitSymbols: Record<string, string> = {
    hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠',
  };

  const getDisplayValue = () => {
    if (card.isJoker && card.value !== 2) return '★'; // No caso de adicionarmos jokers reais sem valor
    switch (card.value) {
      case 2: return '2';
      case 11: return 'J';
      case 12: return 'Q';
      case 13: return 'K';
      case 14: return 'A';
      default: return card.value.toString();
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[
        styles.card,
        { width: w, height: h },
        selected && styles.selectedCard,
        style,
      ]}
    >
      <View style={styles.topCorner}>
        <Text style={[styles.value, { color }, small && { fontSize: 22 }]}>{getDisplayValue()}</Text>
        <Text style={[styles.suitSmall, { color }, small && { fontSize: 14, marginTop: -4 }]}>{suitSymbols[card.suit]}</Text>
      </View>

      <View style={styles.centerBox}>
        <Text style={[styles.suitBig, { color }, small && { fontSize: 28 }]}>{suitSymbols[card.suit]}</Text>
      </View>

      <View style={styles.bottomCorner}>
        <Text style={[styles.value, { color }, small && { fontSize: 22 }]}>{getDisplayValue()}</Text>
        <Text style={[styles.suitSmall, { color }, small && { fontSize: 14, marginTop: -4 }]}>{suitSymbols[card.suit]}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFEF7',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    justifyContent: 'space-between',
    paddingVertical: 1, // Reduzido para aproximar o número da borda
    paddingLeft: 1,
    paddingRight: 5,
  },
  selectedCard: {
    borderColor: '#FFD600',
    borderWidth: 3,
    backgroundColor: '#FFFFF0',
    shadowColor: '#FFD600',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 8,
    transform: [{ scale: 1.05 }],
  },
  hiddenCard: {
    backgroundColor: '#1565C0',
    borderColor: '#0D47A1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hiddenText: {
    fontSize: 26,
  },
  topCorner: {
    alignItems: 'flex-start',
  },
  bottomCorner: {
    alignItems: 'flex-end',
    transform: [{ rotate: '180deg' }],
  },
  value: {
    fontSize: 26,
    fontWeight: '800',
  },
  suitSmall: {
    fontSize: 12,
    marginTop: -5, // Puxa o naipe mais "para cima" (perto do número)
  },
  centerBox: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  suitBig: {
    fontSize: 33,
    opacity: 0.2,
  },
});

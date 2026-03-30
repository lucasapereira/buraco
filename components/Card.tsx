import React from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
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
  const { width, height } = useWindowDimensions();
  // Limita pelo menor entre largura e altura para não crescer demais em landscape
  const cardScale = width >= 600 ? Math.min(width / 600, height / 750, 1.4) : 1.0;
  const w = Math.round((small ? 50 : 60) * cardScale);
  const h = Math.round((small ? 72 : 86) * cardScale);
  const valFontSize = Math.round((small ? 29 : 34) * cardScale);
  const suitSmFontSize = Math.round((small ? 18 : 16) * cardScale);
  const suitBigFontSize = Math.round((small ? 28 : 33) * cardScale);
  const suitSmMargin = -Math.round(5 * cardScale);

  if (isHidden) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[styles.card, styles.hiddenCard, { width: w, height: h }]}
      >
        <Text style={[styles.hiddenText, { fontSize: Math.round(26 * cardScale) }]}>🂠</Text>
      </TouchableOpacity>
    );
  }

  // Joker físico — visual especial
  if (card.suit === 'joker') {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        style={[
          styles.card,
          styles.jokerCard,
          { width: w, height: h },
          selected && styles.selectedCard,
          style,
        ]}
      >
        {selected && (
          <View style={styles.selectedBadge}>
            <Text style={styles.selectedBadgeText}>✓</Text>
          </View>
        )}
        <Text style={[styles.jokerCorner, { fontSize: suitSmFontSize + 2 }]}>🃏</Text>
        <View style={styles.centerBox}>
          <Text style={{ fontSize: suitBigFontSize * 1.1 }}>🃏</Text>
        </View>
        <Text style={[styles.jokerCorner, styles.jokerCornerBottom, { fontSize: suitSmFontSize + 2 }]}>🃏</Text>
      </TouchableOpacity>
    );
  }

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const color = card.isJoker ? '#9C27B0' : isRed ? '#D32F2F' : '#212121';

  const suitSymbols: Record<string, string> = {
    hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠',
  };

  const getDisplayValue = () => {
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
      {selected && (
        <View style={styles.selectedBadge}>
          <Text style={styles.selectedBadgeText}>✓</Text>
        </View>
      )}
      <View style={styles.topCorner}>
        <Text style={[styles.value, { color, fontSize: valFontSize }]}>{getDisplayValue()}</Text>
        <Text style={[styles.suitSmall, { color, fontSize: suitSmFontSize, marginTop: suitSmMargin }]}>{suitSymbols[card.suit]}</Text>
      </View>

    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    justifyContent: 'flex-start',
    paddingVertical: 3,
    paddingLeft: 1,
    paddingRight: 5,
    overflow: 'hidden',
  },
  selectedCard: {
    borderColor: '#FFD600',
    borderWidth: 4,
    backgroundColor: '#FFFDE7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 16,
    transform: [{ scale: 1.1 }, { translateY: -10 }],
  },
  selectedBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#1565C0',
    borderRadius: 12,
    width: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 20,
  },
  selectedBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 15,
  },
  hiddenCard: {
    backgroundColor: '#1565C0',
    borderColor: '#0D47A1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  jokerCard: {
    backgroundColor: '#FFF8E1',
    borderColor: '#FFD600',
    borderWidth: 2,
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingHorizontal: 3,
  },
  jokerCorner: {
    alignSelf: 'flex-start',
  },
  jokerCornerBottom: {
    alignSelf: 'flex-end',
    transform: [{ rotate: '180deg' }],
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

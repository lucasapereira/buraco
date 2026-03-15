import React from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { Card as CardType } from '../game/deck';
import { Card } from './Card';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface HandProps {
  cards: CardType[];
  selectedCards: string[];
  onToggleCard: (cardId: string) => void;
  isHidden?: boolean;
  highlightCardId?: string | null; // Última carta comprada
}

export const Hand: React.FC<HandProps> = ({
  cards, selectedCards, onToggleCard, isHidden = false, highlightCardId
}) => {
  const cardWidth = 60;
  const availableWidth = SCREEN_WIDTH - 40;
  const totalCardsWidth = cards.length * cardWidth;
  const overlap = cards.length > 1
    ? Math.max(-30, -(totalCardsWidth - availableWidth) / (cards.length - 1))
    : 0;
  const needsScroll = totalCardsWidth + overlap * (cards.length - 1) > availableWidth;

  return (
    <View style={styles.container}>
      <View style={styles.cardCount}>
        <Text style={styles.cardCountText}>{cards.length}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          !needsScroll && { justifyContent: 'center', flex: 1 },
        ]}
      >
        {cards.map((card, index) => {
          const isHighlighted = highlightCardId === card.id;
          return (
            <View
              key={card.id}
              style={[
                styles.cardWrapper,
                index > 0 && { marginLeft: Math.min(overlap, -8) },
                isHighlighted && styles.highlightWrapper,
              ]}
            >
              <Card
                card={card}
                isHidden={isHidden}
                selected={selectedCards.includes(card.id)}
                onPress={() => onToggleCard(card.id)}
              />
              {isHighlighted && (
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>N</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 102,
    width: '100%',
  },
  scrollContent: {
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
  },
  cardWrapper: {},
  highlightWrapper: {
    // Glow effect for the newly drawn card
  },
  newBadge: {
    position: 'absolute',
    top: 2,
    left: 16,
    backgroundColor: '#FFD600',
    borderRadius: 10,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    opacity: 0.8,
  },
  newBadgeText: {
    color: '#1B5E20',
    fontSize: 9,
    fontWeight: '900',
  },
  cardCount: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    zIndex: 10,
  },
  cardCountText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});

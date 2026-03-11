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
                  <Text style={styles.newBadgeText}>NOVA</Text>
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
    height: 130,
    width: '100%',
  },
  scrollContent: {
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  cardWrapper: {},
  highlightWrapper: {
    // Glow effect for the newly drawn card
  },
  newBadge: {
    position: 'absolute',
    top: 2,
    left: 2,
    backgroundColor: '#FFD600',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    zIndex: 10,
  },
  newBadgeText: {
    color: '#1B5E20',
    fontSize: 7,
    fontWeight: '900',
  },
  cardCount: {
    position: 'absolute',
    top: 2,
    left: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    zIndex: 10,
  },
  cardCountText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
});

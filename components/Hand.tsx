import React from 'react';
import { useWindowDimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card as CardType } from '../game/deck';
import { Card } from './Card';

interface HandProps {
  cards: CardType[];
  selectedCards: string[];
  onToggleCard: (cardId: string) => void;
  isHidden?: boolean;
  highlightCardId?: string | null; // Última carta comprada
}

export const Hand = ({
  cards, selectedCards, onToggleCard, isHidden = false, highlightCardId
}: HandProps) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const cardScale = SCREEN_WIDTH >= 600 ? Math.min(SCREEN_WIDTH / 600, SCREEN_HEIGHT / 750, 1.4) : 1.0;
  const cardWidth = Math.round(60 * cardScale);
  const containerHeight = Math.round(93 * cardScale);
  const availableWidth = SCREEN_WIDTH - 40;
  const totalCardsWidth = cards.length * cardWidth;
  const overlap = cards.length > 1
    ? Math.max(-30, -(totalCardsWidth - availableWidth) / (cards.length - 1))
    : 0;
  const needsScroll = totalCardsWidth + overlap * (cards.length - 1) > availableWidth;

  return (
    <View style={[styles.container, { height: containerHeight }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ overflow: 'visible' }}
        removeClippedSubviews={false}
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
                <View pointerEvents="none" style={styles.newBadge}>
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
    height: 93,
    width: '100%',
    overflow: 'visible',
  },
  scrollContent: {
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingTop: 0,
    paddingBottom: 0,
    overflow: 'visible',
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
    fontSize: 11,
    fontWeight: '900',
  },
});

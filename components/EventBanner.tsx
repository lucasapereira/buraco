import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { GameEvent } from '../game/engine';

const { width: SW } = Dimensions.get('window');

interface EventBannerProps {
  events: GameEvent[];
}

export const EventBanner: React.FC<EventBannerProps> = ({ events }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-30)).current;
  const lastEventId = useRef(-1);

  const lastEvent = events.length > 0 ? events[events.length - 1] : null;

  useEffect(() => {
    if (!lastEvent || lastEvent.id === lastEventId.current) return;
    lastEventId.current = lastEvent.id;

    // Reset
    opacity.setValue(1);
    translateY.setValue(-20);

    // Animate in
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 120,
        friction: 10,
      }),
    ]).start();

    // Fade out after 3s
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0.4,
        duration: 800,
        useNativeDriver: true,
      }).start();
    }, 3000);

    return () => clearTimeout(timer);
  }, [lastEvent?.id]);

  if (!lastEvent) return null;

  const isImportant = lastEvent.type === 'got_dead' || lastEvent.type === 'round_end' || lastEvent.type === 'play_cards';
  const bgColor = lastEvent.type === 'got_dead' ? '#FF6F00'
    : lastEvent.type === 'round_end' ? '#FFD600'
    : lastEvent.type === 'play_cards' || lastEvent.type === 'add_to_game' ? '#1565C0'
    : lastEvent.type === 'discard' ? '#C62828'
    : lastEvent.type === 'draw_pile' ? '#6A1B9A'
    : '#37474F';

  return (
    <Animated.View style={[
      styles.banner,
      { backgroundColor: bgColor, opacity, transform: [{ translateY }] },
      isImportant && styles.importantBanner,
    ]}>
      <Text style={[styles.bannerText, isImportant && styles.importantText]} numberOfLines={1}>
        {lastEvent.message}
      </Text>
    </Animated.View>
  );
};

interface EventLogProps {
  events: GameEvent[];
  maxItems?: number;
}

export const EventLog: React.FC<EventLogProps> = ({ events, maxItems = 5 }) => {
  const recent = events.slice(-maxItems).reverse();

  return (
    <View style={styles.logContainer}>
      {recent.map((evt, idx) => (
        <Text
          key={evt.id}
          style={[styles.logEntry, { opacity: 1 - idx * 0.15 }]}
          numberOfLines={1}
        >
          {evt.message}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    paddingVertical: 4,
    paddingHorizontal: 16,
    alignItems: 'center',
    overflow: 'hidden',
  },
  importantBanner: {
    paddingVertical: 6,
  },
  bannerText: {
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
    fontSize: 11,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  importantText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#fff',
  },
  logContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  logEntry: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    marginBottom: 1,
  },
});

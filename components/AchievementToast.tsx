import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Achievement } from '../game/achievements';

interface Props {
  achievement: Achievement | null;
  onDismiss: () => void;
}

export function AchievementToast({ achievement, onDismiss }: Props) {
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!achievement) return;

    // Slide in
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();

    // Auto-dismiss after 3.2 s
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -120, duration: 300, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => onDismiss());
    }, 3200);

    return () => {
      clearTimeout(timer);
      translateY.setValue(-120);
      opacity.setValue(0);
    };
  }, [achievement?.id]);

  if (!achievement) return null;

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY }], opacity }]}>
      <Text style={styles.label}>CONQUISTA DESBLOQUEADA</Text>
      <View style={styles.row}>
        <Text style={styles.icon}>{achievement.icon}</Text>
        <View style={styles.texts}>
          <Text style={styles.title}>{achievement.title}</Text>
          <Text style={styles.desc}>{achievement.description}</Text>
        </View>
        <View style={styles.xpBadge}>
          <Text style={styles.xpText}>+{achievement.xpReward}</Text>
          <Text style={styles.xpLabel}>XP</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    zIndex: 999,
    backgroundColor: '#1A3A1A',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FFD600',
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#FFD600',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 12,
  },
  label: {
    color: '#FFD600',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    fontSize: 30,
  },
  texts: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  desc: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 1,
  },
  xpBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,214,0,0.15)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,214,0,0.4)',
  },
  xpText: {
    color: '#FFD600',
    fontSize: 16,
    fontWeight: '900',
  },
  xpLabel: {
    color: '#FFD600',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
});

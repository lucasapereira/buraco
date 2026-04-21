import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';

const COLORS = ['#FFD600', '#FF5252', '#40C4FF', '#B9F6CA', '#E040FB', '#FF9100', '#00E5FF'];

export function Confetti({ trigger, count = 40 }: { trigger: number; count?: number }) {
  const { width, height } = Dimensions.get('window');
  const particles = useRef(
    Array.from({ length: count }, () => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      rot: new Animated.Value(0),
      opacity: new Animated.Value(0),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      startX: 0,
      dx: 0,
      dy: 0,
      rotEnd: 0,
      size: 6 + Math.random() * 6,
    }))
  ).current;

  useEffect(() => {
    if (!trigger) return;
    const animations = particles.map((p) => {
      p.startX = width / 2 + (Math.random() - 0.5) * 40;
      p.dx = (Math.random() - 0.5) * width * 0.9;
      p.dy = height * (0.5 + Math.random() * 0.4);
      p.rotEnd = (Math.random() - 0.5) * 720;
      p.x.setValue(0);
      p.y.setValue(0);
      p.rot.setValue(0);
      p.opacity.setValue(1);
      return Animated.parallel([
        Animated.timing(p.x, { toValue: p.dx, duration: 1800, useNativeDriver: true }),
        Animated.timing(p.y, { toValue: p.dy, duration: 1800, useNativeDriver: true }),
        Animated.timing(p.rot, { toValue: p.rotEnd, duration: 1800, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(1200),
          Animated.timing(p.opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
        ]),
      ]);
    });
    Animated.stagger(8, animations).start();
  }, [trigger]);

  if (!trigger) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            top: height * 0.25,
            left: p.startX,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: 2,
            opacity: p.opacity,
            transform: [
              { translateX: p.x },
              { translateY: p.y },
              { rotate: p.rot.interpolate({ inputRange: [-720, 720], outputRange: ['-720deg', '720deg'] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

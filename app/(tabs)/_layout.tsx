import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useGameStore } from '../../store/gameStore';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { gameLog, players } = useGameStore();

  const storePersist = (useGameStore as any).persist;
  const [hydrated, setHydrated] = useState(() => storePersist.hasHydrated() as boolean);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return storePersist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated || !mounted) return;
    const isGameInProgress = gameLog.length > 0 || players.some(p => p.hand.length !== 11);
    if (isGameInProgress) {
      router.replace('/(tabs)/explore' as any);
    }
  }, [hydrated, mounted]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: { display: 'none' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="paperplane.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}

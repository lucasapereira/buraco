import AsyncStorage from '@react-native-async-storage/async-storage';
import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useGameStore } from '../../store/gameStore';
import { useProfileStore } from '../../store/profileStore';
import { OnboardingGate } from '../../components/OnboardingGate';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { gameLog, players, winnerTeamId } = useGameStore();
  const myUsername = useProfileStore(s => s.myUsername);

  const storePersist = (useGameStore as any).persist;
  const profilePersist = (useProfileStore as any).persist;
  const [hydrated, setHydrated] = useState(() => storePersist.hasHydrated() as boolean);
  const [profileHydrated, setProfileHydrated] = useState(
    () => (profilePersist?.hasHydrated?.() as boolean) ?? false,
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const unsubGame = storePersist.onFinishHydration(() => setHydrated(true));
    const unsubProfile = profilePersist?.onFinishHydration?.(() => setProfileHydrated(true));
    return () => { unsubGame?.(); unsubProfile?.(); };
  }, []);

  useEffect(() => {
    if (!hydrated || !mounted || !profileHydrated) return;
    // Não auto-resume enquanto o onboarding (gate sem username) está ativo:
    // o jogador precisa registrar o nome antes de cair no jogo.
    if (!myUsername) return;
    (async () => {
      // Flag gravada pelo themeStore antes de DevSettings.reload(). Ao
      // trocar tema na home com partida em andamento, não queremos que o
      // auto-resume jogue o usuário pro explore no reload.
      const skip = await AsyncStorage.getItem('skip-autoresume-once');
      if (skip === '1') {
        await AsyncStorage.removeItem('skip-autoresume-once');
        return;
      }
      const isGameInProgress = (gameLog.length > 0 || players.some(p => p.hand.length !== 11)) && !winnerTeamId;
      if (isGameInProgress) {
        router.replace('/(tabs)/explore' as any);
      }
    })();
  }, [hydrated, mounted, profileHydrated, myUsername]);

  // Espera a hidratação do perfil pra não piscar a Home antes do gate.
  if (!profileHydrated) return null;

  // Gate bloqueante de primeiro acesso: sem username reservado, ninguém passa
  // (e portanto todo jogador entra no ranking).
  if (!myUsername) {
    return <OnboardingGate />;
  }

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
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="star.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="online"
        options={{
          title: 'Online',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="wifi" color={color} />,
        }}
      />
      <Tabs.Screen
        name="ranking"
        options={{
          title: 'Ranking',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="star.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}

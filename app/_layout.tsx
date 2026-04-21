import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useForceUpdate } from '@/hooks/useForceUpdate';
import { ThemedAlertHost } from '../components/ThemedAlert';
import { useThemeStore } from '../store/themeStore';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.lucasapereira.buraco';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { needsUpdate, checking } = useForceUpdate();

  // Bloqueia o render das telas até o tema persistido ser aplicado em
  // GameColors (via onRehydrateStorage do themeStore). Sem isso, telas
  // montariam com o tema classic (default) e só atualizariam no próximo
  // reload.
  const themePersist = (useThemeStore as any).persist;
  const [themeHydrated, setThemeHydrated] = useState<boolean>(() => !!themePersist?.hasHydrated?.());
  useEffect(() => {
    if (themeHydrated) return;
    return themePersist?.onFinishHydration?.(() => setThemeHydrated(true));
  }, [themeHydrated]);

  if (checking || !themeHydrated) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FFD600" />
      </View>
    );
  }

  if (needsUpdate) {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>🃏</Text>
        <Text style={styles.title}>Atualização obrigatória</Text>
        <Text style={styles.body}>
          Uma nova versão do Buraco está disponível. Atualize para continuar jogando.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => Linking.openURL(PLAY_STORE_URL)}>
          <Text style={styles.btnText}>Atualizar agora</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <ThemedAlertHost />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emoji: { fontSize: 64, marginBottom: 16 },
  title: {
    color: '#FFD600',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    color: '#ccc',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  btn: {
    backgroundColor: '#FFD600',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: {
    color: '#1a1a2e',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

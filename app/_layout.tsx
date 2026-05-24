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
import { useLocaleStore, useT } from '../store/localeStore';
import { bootstrapAuth } from '../hooks/useGoogleAuth';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.lucasapereira.buraco';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { needsUpdate, checking } = useForceUpdate();
  const t = useT();

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

  // Mesmo padrão pro localeStore: i18n.locale precisa estar setado antes das
  // telas montarem, ou todo Text vai aparecer com o fallback default.
  const localePersist = (useLocaleStore as any).persist;
  const [localeHydrated, setLocaleHydrated] = useState<boolean>(() => !!localePersist?.hasHydrated?.());
  useEffect(() => {
    if (localeHydrated) return;
    return localePersist?.onFinishHydration?.(() => setLocaleHydrated(true));
  }, [localeHydrated]);

  // Restaura a sessão Firebase no startup (reinstalar apaga o token e quebra
  // todas as leituras do Firebase — ranking, perfis). Fire-and-forget; telas
  // que leem cedo (ex.: Ranking) também aguardam isso por conta própria.
  useEffect(() => {
    bootstrapAuth().catch(() => {});
  }, []);

  if (checking || !themeHydrated || !localeHydrated) {
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
        <Text style={styles.title}>{t('update.title')}</Text>
        <Text style={styles.body}>{t('update.body')}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => Linking.openURL(PLAY_STORE_URL)}>
          <Text style={styles.btnText}>{t('update.btn')}</Text>
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

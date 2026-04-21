/**
 * themeStore — escolha de tema visual ('classic' | 'dark').
 *
 * Persiste via AsyncStorage. O root `_layout.tsx` bloqueia o render dos
 * filhos até a hidratação terminar e chama `applyTheme()` no callback
 * `onFinishHydration`, garantindo que os `StyleSheet.create` das telas
 * leiam valores já mutados de `GameColors`.
 *
 * Trocar tema em runtime chama `DevSettings.reload()` porque os
 * stylesheets de nível de módulo já estão cacheados para o tema anterior.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DevSettings } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { applyTheme } from '../constants/colors';
import { THEMES, type ThemeName } from '../constants/themes';

interface ThemeState {
  theme: ThemeName;
  setTheme: (t: ThemeName) => Promise<void>;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'classic',
      setTheme: async (t: ThemeName) => {
        set({ theme: t });
        // Grava direto no AsyncStorage antes do reload — não confia no
        // timing do write interno do zustand-persist, que pode flushar
        // depois do reload em dispositivos lentos.
        try {
          await AsyncStorage.setItem(
            'theme-store',
            JSON.stringify({ state: { theme: t }, version: 0 })
          );
        } catch {
          // Se o write falhar, o tema ainda fica na memória. Usuário pode
          // tentar de novo; o setItem do persist como fallback.
        }
        // Flag one-shot consumida no (tabs)/_layout.tsx. Sem isso, o
        // auto-resume de partida em andamento pula pro explore no reload
        // mesmo que o usuário tenha trocado tema estando na home.
        try {
          await AsyncStorage.setItem('skip-autoresume-once', '1');
        } catch {}
        try {
          DevSettings.reload();
        } catch {
          // DevSettings pode não existir em builds de produção sem expo-dev-client.
          // Nesse caso, o tema será aplicado na próxima vez que o app abrir.
        }
      },
    }),
    {
      name: 'theme-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        // Aplica o tema persistido ANTES de qualquer tela montar.
        // (O _layout.tsx bloqueia o render até hasHydrated() virar true.)
        if (state?.theme && THEMES[state.theme]) {
          applyTheme(THEMES[state.theme]);
        }
      },
    }
  )
);

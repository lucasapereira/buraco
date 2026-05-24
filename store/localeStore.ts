/**
 * localeStore — idioma atual do app ('pt' | 'en' | 'es' | 'ru', etc).
 *
 * Persiste via AsyncStorage. O `_layout.tsx` bloqueia o render até a
 * hidratação terminar — no `onRehydrateStorage`, `i18n.locale` é setado
 * antes de qualquer tela montar.
 *
 * Trocar idioma em runtime chama `DevSettings.reload()` (mesmo padrão do
 * themeStore). Em tese o i18n-js faz lookup dinâmico e o re-render deveria
 * bastar — e de fato funciona em todas as telas EXCETO na própria home, onde
 * a UI visível ficava stale mesmo após o React re-renderizar com o locale
 * novo (logs confirmaram `t()` retornando a tradução correta, mas o display
 * não atualizava até o usuário sair e voltar pra home). Tentativas de
 * isolar a causa (Modal→View overlay, setTimeout no setLocale, key forçando
 * remount do ScrollView) não resolveram. Reload garante consistência.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DevSettings } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { i18n, detectDeviceLocale, type Locale } from '../locales';

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => Promise<void>;
}

// Detectado no carregamento do módulo. Se nada estiver persistido (primeiro boot),
// este valor vira o state inicial — caso contrário, o persist sobrepõe depois.
// Definido aqui (e não no onRehydrateStorage) porque o callback recebe o state
// inicial com `locale: 'pt'` em vez de undefined, então o `??` lá nunca cairia
// no fallback.
const INITIAL_LOCALE: Locale = detectDeviceLocale();
i18n.locale = INITIAL_LOCALE;

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: INITIAL_LOCALE,
      setLocale: async (l: Locale) => {
        i18n.locale = l;
        set({ locale: l });
        // Mesmo padrão do themeStore: grava direto no AsyncStorage antes do
        // reload (não confia no flush interno do zustand-persist).
        try {
          await AsyncStorage.setItem(
            'locale-store',
            JSON.stringify({ state: { locale: l }, version: 0 })
          );
        } catch {}
        // Flag one-shot consumida no (tabs)/_layout.tsx pra evitar que o
        // auto-resume de partida em andamento jogue o usuário pro explore
        // após o reload (caso ele tenha trocado idioma estando na home).
        try {
          await AsyncStorage.setItem('skip-autoresume-once', '1');
        } catch {}
        try {
          DevSettings.reload();
        } catch {
          // DevSettings pode não existir em builds de produção sem expo-dev-client.
          // Nesse caso o idioma já está aplicado em memória e será persistido
          // pelo zustand-persist normalmente — só não tem o reload visual.
        }
      },
    }),
    {
      name: 'locale-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        // Se tem locale persistido, sobrepõe o detectado.
        if (state?.locale) i18n.locale = state.locale;
      },
    }
  )
);

/**
 * Hook reativo: retorna `t(key, opts)` ligada ao locale atual.
 * Causa re-render do componente quando o idioma muda.
 */
export function useT() {
  // Subscreve a mudanças de locale; o valor não é usado diretamente porque
  // o `i18n.t` lê `i18n.locale` dinamicamente em cada chamada.
  const locale = useLocaleStore((s) => s.locale);
  void locale;
  return (key: string, opts?: Record<string, any>): string => i18n.t(key, opts);
}

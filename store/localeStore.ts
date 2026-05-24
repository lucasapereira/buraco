/**
 * localeStore — idioma atual do app ('pt' | 'en' | 'es' | 'ru').
 *
 * Persiste via AsyncStorage. O `_layout.tsx` bloqueia o render até a
 * hidratação terminar — no `onRehydrateStorage`, `i18n.locale` é setado
 * antes de qualquer tela montar.
 *
 * Trocar idioma em runtime NÃO requer reload (i18n-js lookup é dinâmico).
 * Componentes que usam `useT()` re-renderizam automaticamente.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { i18n, detectDeviceLocale, type Locale } from '../locales';

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
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
      setLocale: (l: Locale) => {
        i18n.locale = l;
        set({ locale: l });
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

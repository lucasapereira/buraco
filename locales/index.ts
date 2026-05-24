/**
 * i18n setup — usa i18n-js + expo-localization.
 *
 * Fluxo:
 *  1. `localeStore` (zustand persist) decide qual idioma usar, considerando
 *     o que foi salvo manualmente pelo usuário ou o locale do dispositivo
 *     no primeiro boot.
 *  2. `i18n.locale` é setado no onRehydrateStorage do store, ANTES de
 *     qualquer tela montar (`_layout.tsx` bloqueia o render até hidratar).
 *  3. Componentes usam `useT()` pra obter a função `t(key, opts)` — o hook
 *     subscreve a mudanças de locale e re-renderiza quando trocar.
 */

import { I18n } from 'i18n-js';
import pt from './pt.json';
import en from './en.json';
import es from './es.json';
import ru from './ru.json';
import it from './it.json';
import zh from './zh.json';
import lt from './lt.json';
import lv from './lv.json';
import et from './et.json';

export const SUPPORTED_LOCALES = ['pt', 'en', 'es', 'ru', 'it', 'zh', 'lt', 'lv', 'et'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
  ru: 'Русский',
  it: 'Italiano',
  zh: '中文',
  lt: 'Lietuvių',
  lv: 'Latviešu',
  et: 'Eesti',
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  pt: '🇧🇷',
  en: '🇺🇸',
  es: '🇪🇸',
  ru: '🇷🇺',
  it: '🇮🇹',
  zh: '🇨🇳',
  lt: '🇱🇹',
  lv: '🇱🇻',
  et: '🇪🇪',
};

export const i18n = new I18n({ pt, en, es, ru, it, zh, lt, lv, et });
i18n.defaultLocale = 'pt';
i18n.enableFallback = true;
i18n.locale = 'pt';

export function detectDeviceLocale(): Locale {
  // Lazy-load do expo-localization pra que scripts Node (auditEngine, botSim)
  // que importam gameStore não quebrem ao carregar o módulo. Em Node não há
  // bridge nativa, e o require falharia se fosse top-level.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLocales } = require('expo-localization');
    const locales = getLocales();
    const code = locales[0]?.languageCode?.toLowerCase();
    if (code && (SUPPORTED_LOCALES as readonly string[]).includes(code)) {
      return code as Locale;
    }
  } catch {
    // expo-localization pode falhar em Node (sem expo-modules-core), web SSR, etc.
  }
  return 'pt';
}

/**
 * Função pura de tradução. Use APENAS fora de render (event handlers, stores,
 * lógica de jogo). Dentro de componentes, prefira `useT()` pra que o re-render
 * dispare na troca de idioma.
 */
export function t(key: string, opts?: Record<string, any>): string {
  return i18n.t(key, opts);
}

/**
 * Paletas de tema disponíveis. Cada tema é aplicado via `applyTheme()`
 * em `colors.ts` ANTES das telas montarem seus `StyleSheet.create`.
 *
 * Regra: mantém a mesma estrutura do `GameColors` — só troca os valores.
 * Adicione novos tokens aqui e em `colors.ts` juntos.
 */

export type ThemeName = 'classic' | 'dark';

export interface ThemePalette {
  bg: {
    top: string;
    mid: string;
    bot: string;
    header: string;
    surfaceSoft: string;
    surfaceHard: string;
  };
  // accent only muda pouco entre temas — dourado fica dourado
  goldSoft: string;
  goldBorder: string;
  card: {
    back: string;
    backAccent: string;
  };
}

// Classic — feltro verde escuro saturado (mesa de cassino/carteado)
export const CLASSIC_THEME: ThemePalette = {
  bg: {
    top: '#0D4A22',
    mid: '#093C1A',
    bot: '#052410',
    header: '#082E14',
    surfaceSoft: '#0A3518',
    surfaceHard: '#041A0A',
  },
  goldSoft: 'rgba(255,214,0,0.15)',
  goldBorder: 'rgba(255,214,0,0.4)',
  card: {
    back: '#0D3B6F',
    backAccent: '#1E5BA8',
  },
};

// Dark — grafite/carvão com acentos dourados (look premium)
export const DARK_THEME: ThemePalette = {
  bg: {
    top: '#1B1F27',
    mid: '#14171E',
    bot: '#0A0C10',
    header: '#13151B',
    surfaceSoft: '#1F232C',
    surfaceHard: '#0D0F13',
  },
  goldSoft: 'rgba(255,214,0,0.12)',
  goldBorder: 'rgba(255,214,0,0.35)',
  card: {
    back: '#2A2F3A',
    backAccent: '#4A5163',
  },
};

export const THEMES: Record<ThemeName, ThemePalette> = {
  classic: CLASSIC_THEME,
  dark: DARK_THEME,
};

export const THEME_LABELS: Record<ThemeName, string> = {
  classic: '🟢 Clássico',
  dark: '⚫ Escuro',
};

/**
 * Paleta centralizada do jogo. Todos os arquivos devem importar daqui em vez
 * de usar strings de cor hardcoded — se você achar um `#1B5E20` perdido no
 * código, é um bug e deve virar um token daqui.
 *
 * Suporte a tema: `applyTheme()` muta os campos desta paleta antes das telas
 * montarem seus StyleSheet.create. O root (_layout.tsx) é quem chama isso,
 * bloqueando o render até terminar de hidratar o tema escolhido.
 */

import type { ThemePalette } from './themes';
import { CLASSIC_THEME } from './themes';

export const GameColors = {
  // Gradiente da mesa (usado pelo ScreenBackground)
  bg: {
    top: '#0B3A16',
    mid: '#1B5E20',
    bot: '#0A2E12',
    header: '#0D3B1E',      // barra de header sobre a mesa
    surfaceSoft: '#16451A', // modal / box elevated
    surfaceHard: '#0E2F14', // modal mais escuro
  },

  // Acentos
  gold: '#FFD600',
  goldDark: '#1B5E20',       // texto legível sobre botão dourado
  goldSoft: 'rgba(255,214,0,0.15)',
  goldBorder: 'rgba(255,214,0,0.4)',

  // Texto
  text: {
    primary: '#FFFFFF',
    secondary: 'rgba(255,255,255,0.72)',
    muted: 'rgba(255,255,255,0.48)',
    faint: 'rgba(255,255,255,0.28)',
    onGold: '#1B5E20',
  },

  // Superfícies (glass sobre a mesa)
  surface: {
    low: 'rgba(255,255,255,0.06)',
    mid: 'rgba(255,255,255,0.1)',
    high: 'rgba(255,255,255,0.15)',
    border: 'rgba(255,255,255,0.12)',
    dark: 'rgba(0,0,0,0.25)',
    darker: 'rgba(0,0,0,0.4)',
  },

  // Times (online + lobby)
  team: {
    green: '#66BB6A',
    red: '#EF5350',
  },

  // Status
  success: '#66BB6A',
  successSoft: '#B9F6CA',
  warning: '#FFA726',
  danger: '#EF5350',
  dangerSoft: '#FF8A80',
  info: '#29B6F6',

  // Canastas
  canasta: {
    dirty: '#E65100',
    dirtyBorder: '#FFD180',
    c200: '#2E7D32',
    c200Border: '#A5D6A7',
    c500: '#0277BD',
    c500Border: '#81D4FA',
    c1000: '#6A1B9A',
    c1000Border: '#CE93D8',
  },

  // Cartas
  card: {
    face: '#FFFFFF',
    faceBorder: 'rgba(0,0,0,0.08)',
    red: '#D32F2F',
    black: '#1F2430',
    back: '#0D3B6F',
    backAccent: '#1E5BA8',
    jokerBg: '#FFF8E1',
    jokerBorder: '#FFD600',
    wild: '#9C27B0',
    selectedBorder: '#FFD600',
    selectedBg: '#FFFDE7',
  },

  // Overlays
  overlay: {
    modal: 'rgba(0,0,0,0.7)',
    modalDeep: 'rgba(0,0,0,0.85)',
    light: 'rgba(0,0,0,0.45)',
  },
};

// Gradiente padrão da mesa — use `getTableGradient()` em render time para
// que valores reflitam o tema atual. (A constante TABLE_GRADIENT legacy é
// avaliada no load do módulo e congelaria os valores do tema classic.)
export const getTableGradient = (): [string, string, string] => [
  GameColors.bg.top,
  GameColors.bg.mid,
  GameColors.bg.bot,
];

// Aplica uma paleta de tema mutando GameColors in-place. Deve ser chamado
// ANTES das telas montarem (ou seja, antes de _layout.tsx renderizar filhos).
export function applyTheme(palette: ThemePalette) {
  Object.assign(GameColors.bg, palette.bg);
  GameColors.goldSoft = palette.goldSoft;
  GameColors.goldBorder = palette.goldBorder;
  Object.assign(GameColors.card, palette.card);
}

// Inicializa com o tema classic por padrão — _layout.tsx reescreve se o
// AsyncStorage tiver outro tema salvo.
applyTheme(CLASSIC_THEME);

// Raios de borda padronizados
export const Radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
};

// Sombra "flutuante" pra botões e modais (iOS + Android)
export const Elevation = {
  btn: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 16,
  },
  goldGlow: {
    shadowColor: '#FFD600',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
};

/**
 * Mapeia nomes canônicos em PT (gravados em `Player.name` no createInitialGameState
 * e nos fluxos offline) pra chaves do i18n. Online substitui `name` pelo nome real
 * do jogador, então a função passa direto o que não estiver no mapa.
 *
 * Mantemos o nome PT como "fonte" pra não precisar bumpar o persist version do
 * gameStore — o lookup é puramente cosmético no render.
 */

import { i18n } from '../locales';

const NAME_TO_KEY: Record<string, string> = {
  Você: 'game.players.user',
  Parceiro: 'game.players.partner',
  'Adversário 1': 'game.players.opponent1',
  'Adversário 2': 'game.players.opponent2',
  // Variantes usadas em fluxos antigos (startLayoutTest e talvez saves persistidos)
  'Adv 1': 'game.players.opponent1',
  'Adv 2': 'game.players.opponent2',
};

/** Traduz um nome canônico PT pra o idioma atual; passa direto se não for canônico. */
export function displayName(name: string): string {
  const key = NAME_TO_KEY[name];
  return key ? i18n.t(key) : name;
}

/** Gera o rótulo "Bot N" no idioma atual. */
export function botSeatLabel(seatIndex: number): string {
  return i18n.t('game.players.botSeat', { n: seatIndex + 1 });
}

/**
 * Achievements: traduz `title`/`description` via i18n.t com fallback pro
 * texto PT-BR original (caso falte chave em algum idioma).
 */
import type { Achievement } from './achievements';

export function getAchievementTitle(a: Achievement): string {
  const key = `achievements.${a.id}.title`;
  const translated = i18n.t(key);
  return translated && !translated.startsWith('[missing') ? translated : a.title;
}

export function getAchievementDescription(a: Achievement): string {
  const key = `achievements.${a.id}.description`;
  const translated = i18n.t(key);
  return translated && !translated.startsWith('[missing') ? translated : a.description;
}

/**
 * Rank por nível. Substitui o array RANKS de achievements.ts pelo lookup i18n.
 * Mantém as mesmas faixas (níveis 1-2 = rank 1, 3-4 = rank 3, etc.).
 */
export function getRankName(level: number): string {
  const lvl = Math.max(1, Math.min(20, level));
  const key =
    lvl >= 20 ? '20' :
    lvl >= 19 ? '19' :
    lvl >= 17 ? '17' :
    lvl >= 14 ? '14' :
    lvl >= 11 ? '11' :
    lvl >=  9 ? '9'  :
    lvl >=  7 ? '7'  :
    lvl >=  5 ? '5'  :
    lvl >=  3 ? '3'  : '1';
  return i18n.t(`ranks.${key}`);
}

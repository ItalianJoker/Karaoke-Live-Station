/**
 * Defaults and resolution helpers for operator-customizable Stage overlay messages.
 */
import type { CSSProperties } from 'react';
import type { StageMessageStyle, StageMessagesSettings } from './types';

export const STAGE_MESSAGE_KEYS = [
  'nowSinging',
  'getReady',
  'upNextIntro',
  'nextSong',
  'nextSingerUnassigned',
  'upNextOnStage',
  'followingSinger'
] as const;

export type StageMessageKey = (typeof STAGE_MESSAGE_KEYS)[number];

const DEFAULT_SIZE: Record<StageMessageKey, number> = {
  nowSinging: 28,
  getReady: 28,
  upNextIntro: 14,
  nextSong: 14,
  nextSingerUnassigned: 14,
  upNextOnStage: 16,
  followingSinger: 13
};

export function createDefaultStageMessageStyle(
  key: StageMessageKey,
  overrides: Partial<StageMessageStyle> = {}
): StageMessageStyle {
  return {
    enabled: true,
    text: '',
    bold: key === 'nowSinging' || key === 'getReady' || key === 'upNextOnStage',
    italic: false,
    fontSizePx: DEFAULT_SIZE[key],
    ...overrides
  };
}

export function createDefaultStageMessages(): StageMessagesSettings {
  return {
    nowSinging: createDefaultStageMessageStyle('nowSinging'),
    getReady: createDefaultStageMessageStyle('getReady'),
    upNextIntro: createDefaultStageMessageStyle('upNextIntro'),
    nextSong: createDefaultStageMessageStyle('nextSong'),
    nextSingerUnassigned: createDefaultStageMessageStyle('nextSingerUnassigned'),
    upNextOnStage: createDefaultStageMessageStyle('upNextOnStage'),
    followingSinger: createDefaultStageMessageStyle('followingSinger')
  };
}

export function mergeStageMessages(
  partial?: Partial<StageMessagesSettings> | null
): StageMessagesSettings {
  const defaults = createDefaultStageMessages();
  if (!partial) return defaults;
  const out = { ...defaults };
  for (const key of STAGE_MESSAGE_KEYS) {
    out[key] = { ...defaults[key], ...(partial[key] || {}) };
  }
  return out;
}

/** Deep-merge a partial patch onto current Stage message settings (keeps sibling keys). */
export function patchStageMessages(
  current: StageMessagesSettings | Partial<StageMessagesSettings> | null | undefined,
  patch: Partial<StageMessagesSettings>
): StageMessagesSettings {
  const base = mergeStageMessages(current);
  const out = { ...base };
  for (const key of STAGE_MESSAGE_KEYS) {
    if (patch[key]) {
      out[key] = { ...base[key], ...patch[key] };
    }
  }
  return out;
}

/** Replace `{{name}}` (and other simple tokens) in a Stage message template. */
export function interpolateStageMessage(
  template: string,
  vars: Record<string, string | undefined>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v == null ? '' : v;
  });
}

export interface ResolvedStageMessage {
  enabled: boolean;
  text: string;
  bold: boolean;
  italic: boolean;
  fontSizePx: number;
}

/**
 * Resolve operator overrides against the locale default string.
 * Empty custom text keeps the i18n default.
 */
export function resolveStageMessage(
  style: StageMessageStyle | undefined,
  i18nDefaultText: string,
  vars: Record<string, string | undefined> = {}
): ResolvedStageMessage {
  const merged = {
    enabled: style?.enabled ?? true,
    text: (style?.text || '').trim(),
    bold: style?.bold ?? true,
    italic: style?.italic ?? false,
    fontSizePx: style?.fontSizePx ?? 24
  };
  const raw = merged.text ? merged.text : i18nDefaultText;
  return {
    enabled: merged.enabled,
    text: interpolateStageMessage(raw, vars),
    bold: merged.bold,
    italic: merged.italic,
    fontSizePx: Math.max(10, Math.min(96, Number(merged.fontSizePx) || 24))
  };
}

export function stageMessageCss(
  style: Pick<ResolvedStageMessage, 'bold' | 'italic' | 'fontSizePx'>
): CSSProperties {
  return {
    fontWeight: style.bold ? 800 : 500,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontSize: `${style.fontSizePx}px`,
    lineHeight: 1.15
  };
}

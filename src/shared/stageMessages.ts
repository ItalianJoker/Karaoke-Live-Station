/**
 * Defaults and resolution helpers for operator-customizable Stage overlay messages.
 *
 * Background lifecycle (important for Stage concurrency):
 * - Each message may declare backgroundMode none|color|image.
 * - Stage computes the currently *visible* message keys each frame and picks one backdrop
 *   via STAGE_MESSAGE_BACKGROUND_PRIORITY (fullscreen "up next" wins over chips).
 * - When the visible set becomes empty (banner ended / message disabled), Stage must drop
 *   the override layer so theme/video returns immediately — no app restart.
 * - Image paths stay as absolute filesystem paths in settings; Stage maps them to
 *   karaoke://local/... so Chromium can paint them under the privileged protocol.
 */
import type { CSSProperties } from 'react';
import type { StageMessageBackgroundMode, StageMessageStyle, StageMessagesSettings } from './types';

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
    // Default: do not steal the Stage theme/video backdrop.
    backgroundMode: 'none',
    backgroundColor: '#0f172a',
    backgroundImagePath: '',
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
  backgroundMode: StageMessageBackgroundMode;
  backgroundColor: string;
  backgroundImagePath: string;
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
    fontSizePx: style?.fontSizePx ?? 24,
    backgroundMode: style?.backgroundMode ?? 'none',
    backgroundColor: style?.backgroundColor || '#0f172a',
    backgroundImagePath: (style?.backgroundImagePath || '').trim()
  };
  const raw = merged.text ? merged.text : i18nDefaultText;
  return {
    enabled: merged.enabled,
    text: interpolateStageMessage(raw, vars),
    bold: merged.bold,
    italic: merged.italic,
    fontSizePx: Math.max(10, Math.min(96, Number(merged.fontSizePx) || 24)),
    backgroundMode: merged.backgroundMode,
    backgroundColor: merged.backgroundColor,
    backgroundImagePath: merged.backgroundImagePath
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


/**
 * Visual-dominance order when several Stage messages are visible at once
 * (fullscreen "up next" wins over intro/outro chips).
 */
export const STAGE_MESSAGE_BACKGROUND_PRIORITY: StageMessageKey[] = [
  'upNextOnStage',
  'getReady',
  'nowSinging',
  'nextSong',
  'upNextIntro',
  'followingSinger',
  'nextSingerUnassigned'
];

/** Convert an absolute disk path into the karaoke://local media URL Stage can paint. */
export function stageBackgroundImageUrl(absolutePath: string): string {
  const p = (absolutePath || '').trim();
  if (!p) return '';
  if (p.startsWith('karaoke://') || p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) {
    return p;
  }
  return `karaoke://local/${encodeURIComponent(p)}`;
}

/**
 * Build CSS for a message backdrop override.
 * Returns null when mode is none / incomplete so the caller can restore the normal Stage look.
 */
export function stageMessageBackgroundCss(
  style: Pick<ResolvedStageMessage, 'backgroundMode' | 'backgroundColor' | 'backgroundImagePath'>
): CSSProperties | null {
  if (style.backgroundMode === 'color') {
    return {
      backgroundColor: style.backgroundColor || '#0f172a',
      backgroundImage: 'none'
    };
  }
  if (style.backgroundMode === 'image') {
    const url = stageBackgroundImageUrl(style.backgroundImagePath);
    if (!url) return null;
    return {
      backgroundColor: '#000',
      backgroundImage: `url("${url}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    };
  }
  return null;
}

/**
 * Among currently visible message keys, pick the highest-priority style that
 * actually defines a backdrop. Callers must only pass keys for messages that
 * are both enabled and on-screen; when the set becomes empty the Stage must
 * drop the override layer (restore theme/video).
 */
export function pickActiveStageMessageBackground(
  messages: StageMessagesSettings,
  visibleKeys: StageMessageKey[]
): ResolvedStageMessage | null {
  const visible = new Set(visibleKeys);
  for (const key of STAGE_MESSAGE_BACKGROUND_PRIORITY) {
    if (!visible.has(key)) continue;
    const style = messages[key];
    if (!style?.enabled) continue;
    if ((style.backgroundMode || 'none') === 'none') continue;
    if (style.backgroundMode === 'image' && !(style.backgroundImagePath || '').trim()) continue;
    return resolveStageMessage(style, '');
  }
  return null;
}

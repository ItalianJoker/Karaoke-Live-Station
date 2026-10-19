/**
 * Timed karaoke script contract for Stage word-level STT overlay.
 * Sidecar JSON next to library media (or under .kls-karaoke cache).
 *
 * Word integrity: whisper.cpp `-ojf` emits BPE tokens. Leading space / Ġ marks a
 * word boundary — merge continuations into orthographic words and keep original
 * token timestamps as `syllables[]` (Phase A fill-a-tempo; no proportional remap).
 */

/** Where STT lyrics are shown — mutually exclusive for new downloads. */
export type SttDisplayMode = 'burn-in' | 'stage';

export interface TimedKaraokeSyllable {
  /** Piece text without leading/trailing space */
  text: string;
  startMs: number;
  endMs: number;
}

export interface TimedKaraokeWord {
  /** Orthographic word, e.g. "Accanto" */
  text: string;
  startMs: number;
  endMs: number;
  /** 0–1 confidence when available from the engine */
  confidence?: number;
  /** BPE pieces that formed this word (original Whisper token timings). */
  syllables?: TimedKaraokeSyllable[];
}

export interface TimedKaraokeLine {
  startMs: number;
  endMs: number;
  words: TimedKaraokeWord[];
}

export interface TimedKaraokeScript {
  version: 1;
  sourceTrackId: string;
  sourcePath: string;
  language?: string;
  engine: 'whisper.cpp';
  modelId: string;
  createdAt: string;
  /** true when STT used an AI vocal stem (best-effort) */
  usedVocalStem: boolean;
  /**
   * How this script should be consumed.
   * Absent = legacy dual path (burn-in + Stage overlay both possible) — Zero Regression.
   */
  displayMode?: SttDisplayMode;
  lines: TimedKaraokeLine[];
}

export type WordHighlightState = 'past' | 'current' | 'future';

export function coerceSttDisplayMode(raw: unknown): SttDisplayMode {
  return raw === 'stage' ? 'stage' : 'burn-in';
}

/**
 * Resolve Whisper `-l` language hint from best-available track/UI signal.
 * Falls back to `undefined` (= auto-detect) when unknown.
 */
export function resolveSttLanguageHint(opts: {
  /** Explicit override (track metadata / IPC). */
  explicit?: string | null;
  /** UI language from Settings (`it`/`en`/`es`/`fr`/`autodetect`). */
  uiLanguage?: string | null;
}): string | undefined {
  const normalize = (v: string | null | undefined): string | undefined => {
    if (!v) return undefined;
    const code = String(v).trim().toLowerCase().split(/[-_]/)[0];
    if (!code || code === 'auto' || code === 'autodetect') return undefined;
    // Whisper accepts ISO-639-1 style codes; keep short alphanumeric tags only.
    if (!/^[a-z]{2,3}$/.test(code)) return undefined;
    return code;
  };
  return normalize(opts.explicit) || normalize(opts.uiLanguage) || undefined;
}

export function activeLineAt(
  script: TimedKaraokeScript,
  timeMs: number
): TimedKaraokeLine | null {
  if (!script?.lines?.length || !Number.isFinite(timeMs)) return null;
  for (const line of script.lines) {
    if (timeMs >= line.startMs && timeMs < line.endMs) return line;
  }
  // Prefer last line that already started (end-of-song hold)
  let last: TimedKaraokeLine | null = null;
  for (const line of script.lines) {
    if (timeMs >= line.startMs) last = line;
  }
  if (last && timeMs < last.endMs + 800) return last;
  return null;
}

export type WordHighlightResult = {
  text: string;
  state: WordHighlightState;
  /** 0–1 fill within the current word (syllable-aware when syllables present). */
  progress: number;
  /** Optional per-syllable states for progressive Stage fill. */
  syllables?: Array<{ text: string; state: WordHighlightState; progress: number }>;
};

/**
 * Per-word highlight for Stage overlay.
 * When `syllables` exist, progress / syllable states use original token timings
 * (fill a tempo — no equal-time remapping).
 */
export function wordHighlightState(
  line: TimedKaraokeLine,
  timeMs: number
): WordHighlightResult[] {
  return (line.words || []).map((w) => {
    if (timeMs < w.startMs) {
      return {
        text: w.text,
        state: 'future' as const,
        progress: 0,
        syllables: syllableStates(w, timeMs)
      };
    }
    if (timeMs >= w.endMs) {
      return {
        text: w.text,
        state: 'past' as const,
        progress: 1,
        syllables: syllableStates(w, timeMs)
      };
    }
    const syllables = syllableStates(w, timeMs);
    let progress: number;
    if (syllables && syllables.length > 0) {
      // Word progress = fraction of syllables completed + current syllable fraction.
      const n = syllables.length;
      let done = 0;
      let currentFrac = 0;
      for (const s of syllables) {
        if (s.state === 'past') done += 1;
        else if (s.state === 'current') {
          currentFrac = s.progress;
          break;
        } else break;
      }
      progress = Math.max(0, Math.min(1, (done + currentFrac) / n));
    } else {
      const dur = Math.max(1, w.endMs - w.startMs);
      progress = Math.max(0, Math.min(1, (timeMs - w.startMs) / dur));
    }
    return {
      text: w.text,
      state: 'current' as const,
      progress,
      syllables
    };
  });
}

function syllableStates(
  word: TimedKaraokeWord,
  timeMs: number
): Array<{ text: string; state: WordHighlightState; progress: number }> | undefined {
  const parts = word.syllables;
  if (!parts || parts.length === 0) return undefined;
  return parts.map((s) => {
    if (timeMs < s.startMs) {
      return { text: s.text, state: 'future' as const, progress: 0 };
    }
    if (timeMs >= s.endMs) {
      return { text: s.text, state: 'past' as const, progress: 1 };
    }
    const dur = Math.max(1, s.endMs - s.startMs);
    return {
      text: s.text,
      state: 'current' as const,
      progress: Math.max(0, Math.min(1, (timeMs - s.startMs) / dur))
    };
  });
}

/**
 * Map whisper.cpp JSON (`--output-json-full` / `-ojf`) into TimedKaraokeScript lines.
 * Groups merged words into lines on punctuation or ~4.5s gaps / ~12 words.
 */
export function whisperJsonToTimedScript(opts: {
  raw: unknown;
  sourceTrackId: string;
  sourcePath: string;
  modelId: string;
  language?: string;
  usedVocalStem: boolean;
  /** Mutually exclusive display target for new downloads. */
  displayMode?: SttDisplayMode;
}): TimedKaraokeScript {
  const words = extractWhisperWords(opts.raw);
  const lines = groupWordsIntoLines(words);
  const script: TimedKaraokeScript = {
    version: 1,
    sourceTrackId: opts.sourceTrackId,
    sourcePath: opts.sourcePath,
    language: opts.language,
    engine: 'whisper.cpp',
    modelId: opts.modelId,
    createdAt: new Date().toISOString(),
    usedVocalStem: opts.usedVocalStem,
    lines
  };
  if (opts.displayMode === 'burn-in' || opts.displayMode === 'stage') {
    script.displayMode = opts.displayMode;
  }
  return script;
}

type RawToken = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  /** True when this token starts a new orthographic word (leading space / Ġ). */
  startsWord: boolean;
};

type RawWord = TimedKaraokeWord;

/**
 * Extract + merge BPE tokens into orthographic words.
 * Preserves leading-space / Ġ boundary before trim (fixes “Acc anto” → Accanto).
 * @complexity O(n) tokens
 */
export function extractWhisperWords(raw: unknown): RawWord[] {
  const tokens = collectRawTokens(raw);
  return mergeTokensIntoWords(tokens);
}

/** Exported for unit tests — merge BPE pieces using boundary flags. */
export function mergeTokensIntoWords(tokens: RawToken[]): RawWord[] {
  const words: RawWord[] = [];
  let current: RawWord | null = null;
  let currentPieces: TimedKaraokeSyllable[] = [];

  const flush = () => {
    if (!current) return;
    words.push({
      ...current,
      syllables: currentPieces.length > 0 ? currentPieces : undefined
    });
    current = null;
    currentPieces = [];
  };

  const startWord = (tok: RawToken, piece: string) => {
    flush();
    current = {
      text: piece,
      startMs: tok.startMs,
      endMs: tok.endMs,
      confidence: tok.confidence
    };
    currentPieces = [{ text: piece, startMs: tok.startMs, endMs: tok.endMs }];
  };

  const appendPiece = (tok: RawToken, piece: string) => {
    if (!current) {
      startWord(tok, piece);
      return;
    }
    current.text += piece;
    current.endMs = Math.max(current.endMs, tok.endMs);
    if (tok.confidence != null) current.confidence = tok.confidence;
    currentPieces.push({ text: piece, startMs: tok.startMs, endMs: tok.endMs });
  };

  const isPunctOnly = (t: string) => /^[\p{P}\p{S}]+$/u.test(t);

  for (const tok of tokens) {
    const piece = tok.text;
    if (!piece) continue;

    // Punctuation-only: attach to previous word when possible.
    if (isPunctOnly(piece) && current) {
      appendPiece(tok, piece);
      continue;
    }

    // Merge rule: continuation tokens (!startsWord) append; word-start flushes.
    if (current && !tok.startsWord) {
      appendPiece(tok, piece);
    } else {
      startWord(tok, piece);
    }
  }
  flush();
  return words;
}

function collectRawTokens(raw: unknown): RawToken[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  const out: RawToken[] = [];

  const pushToken = (
    rawText: string,
    startSec: number,
    endSec: number,
    conf?: number,
    /** When the source already provides word-level items (leading space may be absent). */
    forceStartsWord?: boolean
  ) => {
    const original = String(rawText ?? '');
    // Preserve BPE boundary BEFORE trim: leading whitespace or GPT-2 Ġ (U+0120).
    const startsWord =
      forceStartsWord === true ||
      /^\s/.test(original) ||
      original.startsWith('\u0120') ||
      original.startsWith('Ġ');
    let cleaned = original.replace(/\u0120/g, ' ').replace(/Ġ/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    // Skip whisper.cpp special / non-speech tokens from -ojf.
    if (/^\[.*\]$/.test(cleaned) || cleaned === '</s>' || cleaned.startsWith('<|')) return;
    const startMs = Math.max(0, Math.round(startSec * 1000));
    const endMs = Math.max(startMs + 40, Math.round(endSec * 1000));
    out.push({
      text: cleaned,
      startMs,
      endMs,
      confidence: typeof conf === 'number' && Number.isFinite(conf) ? conf : undefined,
      // First emitted token always starts a word even without leading space.
      startsWord: out.length === 0 ? true : startsWord
    });
  };

  if (Array.isArray(root.words)) {
    for (const w of root.words) {
      if (!w || typeof w !== 'object') continue;
      const item = w as Record<string, unknown>;
      const text = String(item.word ?? item.text ?? '');
      const ts = (item.timestamps || item.offsets || item) as Record<string, unknown>;
      const from = Number(ts.from ?? ts.start ?? item.start ?? 0);
      const to = Number(ts.to ?? ts.end ?? item.end ?? from);
      const startSec = from > 1000 ? from / 1000 : from;
      const endSec = to > 1000 ? to / 1000 : to;
      // Flat `words[]` are already orthographic — each starts a word.
      pushToken(text, startSec, endSec, Number(item.probability ?? item.confidence), true);
    }
  }

  if (out.length === 0 && Array.isArray(root.transcription)) {
    for (const seg of root.transcription) {
      if (!seg || typeof seg !== 'object') continue;
      const s = seg as Record<string, unknown>;
      if (Array.isArray(s.tokens)) {
        for (const tok of s.tokens) {
          if (!tok || typeof tok !== 'object') continue;
          const t = tok as Record<string, unknown>;
          const text = String(t.text ?? '');
          const off = (t.offsets || {}) as Record<string, unknown>;
          const fromMs = Number(off.from ?? 0);
          const toMs = Number(off.to ?? fromMs);
          pushToken(text, fromMs / 1000, toMs / 1000);
        }
      } else {
        const text = String(s.text ?? '');
        const off = (s.offsets || {}) as Record<string, unknown>;
        const fromMs = Number(off.from ?? 0);
        const toMs = Number(off.to ?? fromMs);
        // Segment-level only — split on spaces with equal timing slices
        const parts = text.trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) continue;
        const dur = Math.max(parts.length * 40, toMs - fromMs);
        const step = dur / parts.length;
        parts.forEach((p, i) => {
          pushToken(p, (fromMs + i * step) / 1000, (fromMs + (i + 1) * step) / 1000, undefined, true);
        });
      }
    }
  }

  // segments[] style (openai-whisper json)
  if (out.length === 0 && Array.isArray(root.segments)) {
    for (const seg of root.segments) {
      if (!seg || typeof seg !== 'object') continue;
      const s = seg as Record<string, unknown>;
      if (Array.isArray(s.words)) {
        for (const w of s.words) {
          if (!w || typeof w !== 'object') continue;
          const item = w as Record<string, unknown>;
          pushToken(
            String(item.word ?? item.text ?? ''),
            Number(item.start ?? 0),
            Number(item.end ?? item.start ?? 0),
            Number(item.probability),
            true
          );
        }
      }
    }
  }

  return out;
}

function groupWordsIntoLines(words: RawWord[]): TimedKaraokeLine[] {
  if (words.length === 0) return [];
  const lines: TimedKaraokeLine[] = [];
  let current: RawWord[] = [];
  const flush = () => {
    if (!current.length) return;
    lines.push({
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      words: current.map((w) => ({ ...w }))
    });
    current = [];
  };

  for (const w of words) {
    if (current.length === 0) {
      current.push(w);
      continue;
    }
    const prev = current[current.length - 1];
    const gap = w.startMs - prev.endMs;
    const punct = /[.!?…]$/.test(prev.text);
    if (punct || gap > 4500 || current.length >= 12) {
      flush();
    }
    current.push(w);
  }
  flush();
  return lines;
}

/**
 * True when `mediaDir` is the library root or a real subdirectory (separator-bounded).
 * Avoids fragile `startsWith(libraryPath)` false positives (e.g. `/home/foo` vs `/home/foobar`).
 */
export function isMediaDirInsideLibrary(mediaDir: string, libraryPath: string): boolean {
  if (!mediaDir || !libraryPath) return false;
  const norm = (p: string) =>
    String(p)
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');
  const root = norm(libraryPath);
  const dir = norm(mediaDir);
  if (!root || !dir) return false;
  return dir === root || dir.startsWith(`${root}/`);
}

/**
 * Resolve TimedKaraokeScript sidecar path.
 * Always write/lookup the sibling beside media first so promote + Stage stay aligned.
 * Durable `.kls-karaoke/<trackId>` copies are handled by DownloadManager / Stage candidate list.
 */
export function resolveKaraokeScriptPath(opts: {
  mediaPath: string;
  trackId: string;
  libraryPath?: string;
}): string {
  void opts.trackId;
  void opts.libraryPath;
  return `${opts.mediaPath}.karaoke.json`;
}

/** ASS sibling path used for ffmpeg burn-in (`InstrumentalProcessor` subtitles= filter). */
export function resolveKaraokeAssPath(mediaPath: string): string {
  return `${mediaPath}.ass`;
}

function assTimestamp(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const cs = Math.floor(safe / 10) % 100;
  const totalSec = Math.floor(safe / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

function escapeAssText(text: string): string {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

/** Duration in centiseconds for ASS `\kf` (minimum 1). */
function kfCentiseconds(startMs: number, endMs: number): number {
  return Math.max(1, Math.round((Math.max(endMs, startMs + 40) - startMs) / 10));
}

/**
 * Build ASS karaoke from TimedKaraokeScript for ffmpeg burn-in.
 * Uses the same merged words / syllable timings as Stage (`\kf` fill a tempo).
 * PrimaryColour ≈ sung (amber); SecondaryColour ≈ unsung (white).
 * ASS colour order is &HAABBGGRR.
 */
export function timedScriptToAss(script: TimedKaraokeScript): string {
  // Primary = sung amber #fbbf24 → BGR &H0024BFFB; Secondary = unsung white
  const header = [
    '[Script Info]',
    'Title: Karaoke Live Station STT',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1280',
    'PlayResY: 720',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Arial is the OS-safe face already used historically; karaoke colours match Stage roles.
    'Style: Default,Arial,48,&H0024BFFB,&H00A6A6A6,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,0,2,40,40,64,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const dialogues: string[] = [];
  for (const line of script.lines || []) {
    const parts: string[] = [];
    const words = line.words || [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const syllables =
        w.syllables && w.syllables.length > 0
          ? w.syllables
          : [{ text: w.text, startMs: w.startMs, endMs: w.endMs }];
      for (const s of syllables) {
        const piece = escapeAssText(String(s.text || '').trim());
        if (!piece) continue;
        parts.push(`{\\kf${kfCentiseconds(s.startMs, s.endMs)}}${piece}`);
      }
      if (i < words.length - 1) {
        // Inter-word space as a tiny silent karaoke tick so layout keeps word gaps.
        const gapStart = w.endMs;
        const gapEnd = Math.max(gapStart + 40, words[i + 1]?.startMs ?? gapStart + 40);
        parts.push(`{\\kf${kfCentiseconds(gapStart, gapEnd)}} `);
      }
    }
    const text = parts.join('');
    if (!text.trim()) continue;
    const start = assTimestamp(line.startMs);
    const end = assTimestamp(Math.max(line.endMs, line.startMs + 40));
    dialogues.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }
  return `${header.join('\n')}\n${dialogues.join('\n')}\n`;
}

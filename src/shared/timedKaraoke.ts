/**
 * Timed karaoke script contract for Stage word-level STT overlay.
 * Sidecar JSON next to library media (or under .kls-karaoke cache).
 */

export interface TimedKaraokeWord {
  text: string;
  startMs: number;
  endMs: number;
  /** 0–1 confidence when available from the engine */
  confidence?: number;
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
  lines: TimedKaraokeLine[];
}

export type WordHighlightState = 'past' | 'current' | 'future';

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

/**
 * Per-word highlight for Stage overlay.
 * `progress` on current word is 0–1 for optional gradient fill.
 */
export function wordHighlightState(
  line: TimedKaraokeLine,
  timeMs: number
): Array<{ text: string; state: WordHighlightState; progress: number }> {
  return (line.words || []).map((w) => {
    if (timeMs < w.startMs) {
      return { text: w.text, state: 'future' as const, progress: 0 };
    }
    if (timeMs >= w.endMs) {
      return { text: w.text, state: 'past' as const, progress: 1 };
    }
    const dur = Math.max(1, w.endMs - w.startMs);
    const progress = Math.max(0, Math.min(1, (timeMs - w.startMs) / dur));
    return { text: w.text, state: 'current' as const, progress };
  });
}

/**
 * Map whisper.cpp JSON (`--output-json` / words array) into TimedKaraokeScript lines.
 * Groups words into lines on punctuation or ~4.5s gaps / ~12 words.
 */
export function whisperJsonToTimedScript(opts: {
  raw: unknown;
  sourceTrackId: string;
  sourcePath: string;
  modelId: string;
  language?: string;
  usedVocalStem: boolean;
}): TimedKaraokeScript {
  const words = extractWhisperWords(opts.raw);
  const lines = groupWordsIntoLines(words);
  return {
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
}

type RawWord = { text: string; startMs: number; endMs: number; confidence?: number };

function extractWhisperWords(raw: unknown): RawWord[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;

  // Newer whisper.cpp: { transcription: [ { offsets: {from,to}, text, tokens? } ] }
  // Or flat { words: [ { word, timestamps: {from,to} } ] }
  const out: RawWord[] = [];

  const pushWord = (text: string, startSec: number, endSec: number, conf?: number) => {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    // Skip whisper.cpp special / non-speech tokens from -ojf (`[_BEG_]`, `[_TT_…]`, `</s>`, …)
    if (/^\[.*\]$/.test(cleaned) || cleaned === '</s>' || cleaned.startsWith('<|')) return;
    const startMs = Math.max(0, Math.round(startSec * 1000));
    const endMs = Math.max(startMs + 40, Math.round(endSec * 1000));
    out.push({
      text: cleaned,
      startMs,
      endMs,
      confidence: typeof conf === 'number' && Number.isFinite(conf) ? conf : undefined
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
      // whisper sometimes uses ms already in offsets.from
      const startSec = from > 1000 ? from / 1000 : from;
      const endSec = to > 1000 ? to / 1000 : to;
      pushWord(text, startSec, endSec, Number(item.probability ?? item.confidence));
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
          pushWord(text, fromMs / 1000, toMs / 1000);
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
          pushWord(p, (fromMs + i * step) / 1000, (fromMs + (i + 1) * step) / 1000);
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
          pushWord(
            String(item.word ?? item.text ?? ''),
            Number(item.start ?? 0),
            Number(item.end ?? item.start ?? 0),
            Number(item.probability)
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

/** Resolve sidecar path beside media or under library `.kls-karaoke/`. */
export function resolveKaraokeScriptPath(opts: {
  mediaPath: string;
  trackId: string;
  libraryPath?: string;
}): string {
  const mediaDir = opts.mediaPath.replace(/[/\\][^/\\]+$/, '');
  if (opts.libraryPath && mediaDir.startsWith(opts.libraryPath)) {
    return `${opts.libraryPath}/.kls-karaoke/${opts.trackId}.karaoke.json`.replace(
      /\\/g,
      '/'
    );
  }
  // Sibling of media when outside library
  return `${opts.mediaPath}.karaoke.json`;
}

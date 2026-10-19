/**
 * STT input path guards — Whisper must never receive instrumental-only audio.
 * Speech-bearing source = original mix / vocals stem; sidecar attaches to instrumental.
 */
import path from 'path';

/**
 * True when basename looks like an instrumental remux or AI instrumental extract.
 * Examples: `foo.instrumental.mp4`, `dl_1.instrumental.extract.wav`
 */
export function isInstrumentalOnlySttPath(filePath: string | null | undefined): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  const base = path.basename(filePath).toLowerCase();
  // `*.instrumental.extract.wav` or `*.instrumental.mp4` / `.mkv` / `.webm` / `.wav`
  if (/\.instrumental\.extract\.(wav|mp4|mkv|webm|m4a|aac)$/i.test(base)) return true;
  if (/\.instrumental\.(mp4|mkv|webm|wav|m4a|aac)$/i.test(base)) return true;
  return false;
}

/** Stable English error for logs / IPC (renderer maps via i18n when shown). */
export const STT_INSTRUMENTAL_INPUT_REJECTED =
  'STT requires original audio with vocals — instrumental-only files are rejected';

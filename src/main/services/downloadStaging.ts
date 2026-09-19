/**
 * Helpers for locating yt-dlp downloads under userData/temp before
 * Download Instrumental AI / algorithmic remux.
 *
 * Pure filesystem helpers (no Electron) so AppImage staging can be unit-tested.
 */
import fs from 'fs';
import path from 'path';

/** Media extensions accepted as a final yt-dlp artifact for remux / library save. */
export const DOWNLOAD_MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mkv',
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
  '.mid',
  '.kar'
]);

/**
 * yt-dlp `--sub-langs` value for Download Instrumental auto-subs (lyric burn-in).
 *
 * Prefer original-language auto-subs (`it-orig`, `en-orig`, …) plus YouTube’s
 * `default` track. Each comma-separated token is a **Python regex** — use
 * `.*-orig`, never the shell-style glob `*-orig` (leading `*` → “nothing to
 * repeat” → yt-dlp exit 1 with `Wrong regex for subtitlelangs`). Avoid
 * `all,-live_chat`: requesting ~130 subtitle languages triggers YouTube HTTP
 * 429 and fails the whole download.
 *
 * @see https://github.com/yt-dlp/yt-dlp#subtitle-options
 */
export const YTDLP_INSTRUMENTAL_SUB_LANGS = '.*-orig,default';

/**
 * Whether yt-dlp should fetch auto-subs for an instrumental download.
 *
 * Subs are opt-in (`includeSubtitles === true`) and never requested for
 * audio-only jobs. Missing / unmatched subs must not fail the download —
 * burn-in is best-effort after staging.
 */
export function shouldWriteInstrumentalAutoSubs(options: {
  instrumental?: boolean;
  isAudioOnly?: boolean;
  includeSubtitles?: boolean;
}): boolean {
  return (
    options.instrumental === true &&
    options.isAudioOnly !== true &&
    options.includeSubtitles === true
  );
}

/**
 * yt-dlp `-o` template for a staged download.
 *
 * Returns a **relative** basename only (`{downloadId}.%(ext)s`). Callers must
 * spawn yt-dlp with `cwd` (or `-P`) set to `userData/temp` so the file lands in
 * the same staging folder as before. Relative templates avoid Windows
 * drive-letter / `[TYPES:]TEMPLATE` colon parsing and keep `%` out of absolute
 * path strings passed on the argv.
 *
 * Do not put YouTube titles in this template — titles are applied later in
 * saveToLibrary / queue cache with {@link sanitizeFilenamePart}-style rules.
 */
export function buildYtDlpOutputTemplate(downloadId: string): string {
  const id = String(downloadId || '')
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  const safeId = id || 'dl_unknown';
  return `${safeId}.%(ext)s`;
}

/**
 * True when a basename is a yt-dlp intermediate (format fragments, part files,
 * instrumental work products) rather than the final muxed download.
 */
export function isYtDlpTransientMediaName(fileName: string): boolean {
  const base = path.basename(fileName || '');
  if (!base) return true;
  if (/\.(part|ytdl|tmp|temp)$/i.test(base)) return true;
  // Format fragments: dl_xxx.f137.mp4 / dl_xxx.f140.m4a
  if (/\.f\d+\.[a-z0-9]+$/i.test(base)) return true;
  // Instrumental pipeline sidecars under the same downloadId prefix:
  //   {id}.instrumental.mp4 / .wav, {id}.extract.wav, {id}.instrumental.extract.wav
  if (/\.instrumental(\.mp4|\.wav)?$/i.test(base)) return true;
  if (/\.instrumental\.extract\.wav$/i.test(base)) return true;
  if (/\.extract\.wav$/i.test(base)) return true;
  if (/\.partial\.mp4$/i.test(base)) return true;
  if (/\.(srt|ass|vtt|info\.json|description|jpg|jpeg|webp|png)$/i.test(base)) {
    return true;
  }
  return false;
}

/**
 * Parse an absolute/relative output path from a yt-dlp stdout/stderr line.
 * Handles Destination and Merger lines with or without surrounding quotes.
 */
export function parseYtDlpOutputPath(line: string): string | null {
  const trimmed = (line || '').trim();
  if (!trimmed) return null;

  const merger = trimmed.match(
    /\[Merger\]\s+Merging formats into\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i
  );
  if (merger) {
    return (merger[1] || merger[2] || merger[3] || '').trim() || null;
  }

  // [download] Destination: … / [VideoConvertor] … Destination: …
  if (/Destination:/i.test(trimmed)) {
    const dest = trimmed.match(/Destination:\s+(?:"([^"]+)"|'([^']+)'|(.+))$/i);
    if (dest) {
      return (dest[1] || dest[2] || dest[3] || '').trim() || null;
    }
  }

  return null;
}

/** Resolve a yt-dlp-reported path against the staging temp dir when relative. */
export function resolvePathAgainstTempDir(
  tempDir: string,
  candidate: string | null | undefined
): string | null {
  if (!candidate || typeof candidate !== 'string') return null;
  const trimmed = candidate.trim().replace(/^["']+|["']+$/g, '');
  if (!trimmed) return null;
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  return path.resolve(tempDir, trimmed);
}

/**
 * Pick the final muxed media for a downloadId after yt-dlp exits.
 * Prefers a non-transient hint when it exists; otherwise scans tempDir.
 */
export function resolveDownloadedMediaPath(
  tempDir: string,
  downloadId: string,
  detectedHint?: string | null
): string | null {
  const hint = resolvePathAgainstTempDir(tempDir, detectedHint);
  if (
    hint &&
    fs.existsSync(hint) &&
    !isYtDlpTransientMediaName(hint) &&
    DOWNLOAD_MEDIA_EXTENSIONS.has(path.extname(hint).toLowerCase())
  ) {
    return hint;
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(tempDir);
  } catch {
    return null;
  }

  const candidates: { full: string; size: number; exactMp4: boolean }[] = [];
  for (const name of entries) {
    if (!name.startsWith(downloadId)) continue;
    if (isYtDlpTransientMediaName(name)) continue;
    const ext = path.extname(name).toLowerCase();
    if (!DOWNLOAD_MEDIA_EXTENSIONS.has(ext)) continue;
    const full = path.join(tempDir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile() || st.size < 1024) continue;
      candidates.push({
        full,
        size: st.size,
        exactMp4: name.toLowerCase() === `${downloadId.toLowerCase()}.mp4`
      });
    } catch {
      // skip unreadable
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.exactMp4 !== b.exactMp4) return a.exactMp4 ? -1 : 1;
    return b.size - a.size;
  });
  return candidates[0].full;
}

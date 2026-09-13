/**
 * YouTube IFrame embed helpers shared by renderer UI and regression tests.
 *
 * Error 153 ("Video player configuration error") is raised when the embedder
 * identity / Referer is missing or non-HTTP (typical for Electron `file://`
 * parents). The embed URL must carry a stable https origin, and the main
 * process must inject a Referer on youtube(-nocookie) requests that lack one.
 */

/** Canonical https origin used as embed `origin` / Referer for packaged Electron. */
export const YOUTUBE_EMBED_APP_ORIGIN = 'https://localhost';

const YT_ID_RE = /^[\w-]{11}$/;

/**
 * Extracts an 11-char YouTube video id from a raw id, watch URL, or youtu.be link.
 */
export function extractYouTubeVideoId(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (YT_ID_RE.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.replace(/^\//, '').slice(0, 11);
      return YT_ID_RE.test(id) ? id : null;
    }
    const v = parsed.searchParams.get('v');
    if (v && YT_ID_RE.test(v)) return v;
    const nested = parsed.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (nested) return nested[1];
  } catch {
    // not a URL
  }

  const loose = trimmed.match(/(?:v=|\/)([\w-]{11})(?:[^\w-]|$)/);
  return loose ? loose[1] : null;
}

/**
 * Resolves the https origin used for YouTube's `origin` / `widget_referrer` params.
 * Non-http(s) parents (file://, app://, custom schemes) cannot identify the
 * embedder to YouTube — fall back to {@link YOUTUBE_EMBED_APP_ORIGIN}.
 */
export function resolveYouTubeEmbedOrigin(windowOrigin?: string): string {
  const candidate = (windowOrigin || '').trim();
  if (/^https?:\/\//i.test(candidate)) {
    try {
      return new URL(candidate).origin;
    } catch {
      return YOUTUBE_EMBED_APP_ORIGIN;
    }
  }
  return YOUTUBE_EMBED_APP_ORIGIN;
}

export interface YouTubeEmbedOptions {
  videoId: string;
  /** Parent window origin when available (may be file:// in packaged builds). */
  windowOrigin?: string;
  autoplay?: boolean;
  mute?: boolean;
}

/**
 * Builds the iframe `src` actually used at runtime for YouTube previews.
 * Uses youtube-nocookie + enablejsapi + playsinline + https origin params.
 */
export function buildYouTubeEmbedSrc(options: YouTubeEmbedOptions): string {
  const videoId = extractYouTubeVideoId(options.videoId);
  if (!videoId) {
    throw new Error(`Invalid YouTube video id: ${options.videoId}`);
  }
  const origin = resolveYouTubeEmbedOrigin(options.windowOrigin);
  const params = new URLSearchParams({
    autoplay: options.autoplay === false ? '0' : '1',
    mute: options.mute === false ? '0' : '1',
    playsinline: '1',
    enablejsapi: '1',
    origin,
    widget_referrer: origin,
    rel: '0',
    modestbranding: '1'
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

/** Iframe referrerPolicy value used for YouTube embeds (must stay in sync with UI). */
export const YOUTUBE_EMBED_REFERRER_POLICY = 'strict-origin-when-cross-origin';

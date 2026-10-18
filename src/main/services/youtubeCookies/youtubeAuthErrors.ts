/**
 * Detect yt-dlp / YouTube authentication failures that warrant a cookie refresh.
 *
 * Matched against stderr ERROR lines and composed `errorMessage` strings.
 * Keep patterns conservative — network / format errors must not open the login window.
 */

const AUTH_ERROR_PATTERNS: RegExp[] = [
  /\bHTTP Error 401\b/i,
  /\bHTTP Error 403\b/i,
  /\bERROR:\s*.*\b401\b/i,
  /\bERROR:\s*.*\b403\b/i,
  /Sign in to confirm/i,
  /confirm you.?re not a bot/i,
  /login required/i,
  /Please sign in/i,
  /Use --cookies/i,
  /cookies? (are )?(no longer )?(valid|expired)/i,
  /cookie file.*(invalid|expired|empty)/i,
  /account.*(?:login|sign[\s-]?in)/i,
  /This video is only available for (?:registered|Premium)/i,
  /Join this channel to get access/i,
  /requested format is not available.*sign in/i
];

/**
 * True when `text` looks like a YouTube / yt-dlp auth or bot-check failure.
 *
 * @param text - yt-dlp ERROR line, exit detail, or UI errorMessage
 */
export function isYtDlpYouTubeAuthError(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  const sample = text.slice(0, 2000);
  return AUTH_ERROR_PATTERNS.some((re) => re.test(sample));
}

/**
 * Rough check that a download/search URL targets YouTube.
 */
export function isYouTubeUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(url);
}

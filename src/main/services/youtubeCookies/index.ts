/**
 * YouTube cookie authentication package for yt-dlp.
 *
 * Public surface used by Main Process / DownloadManager.
 */

export {
  YouTubeCookieAuth,
  type YouTubeCookieBridge,
  type YouTubeCookieEnsureResult
} from './YouTubeCookieAuth';
export {
  getYouTubeCookieDir,
  getYouTubeCookiesFilePath,
  getYouTubeCookieFileStatus,
  resolveValidCookiesPathForYtDlp,
  type YouTubeCookieFileStatus
} from './YouTubeCookieStore';
export { YouTubeLoginWindow, YOUTUBE_AUTH_PARTITION } from './YouTubeLoginWindow';
export {
  electronCookiesToNetscape,
  cookiesIndicateYouTubeLogin,
  filterYouTubeCookies,
  netscapeFileLooksAuthenticated,
  isYouTubeRelatedDomain
} from './netscapeCookies';
export { isYtDlpYouTubeAuthError, isYouTubeUrl } from './youtubeAuthErrors';

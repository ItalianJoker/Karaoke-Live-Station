/**
 * Minimal YouTube IFrame API helpers for Pre-Ascolto / web-search preview.
 * Used to detect unmute on the embedded player and re-mute until the user confirms
 * same-device (CUE === Master) playback.
 */

export const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

export interface YouTubePreviewPlayer {
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  destroy: () => void;
}

type YtPlayerCtor = new (
  element: HTMLElement | string,
  options: {
    events?: {
      onReady?: (event: { target: YouTubePreviewPlayer }) => void;
      onError?: (event: unknown) => void;
    };
  }
) => YouTubePreviewPlayer;

interface YtApi {
  Player: YtPlayerCtor;
}

declare global {
  interface Window {
    YT?: YtApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YtApi> | null = null;

/** Loads https://www.youtube.com/iframe_api once (shared across preview opens). */
export function loadYouTubeIframeApi(): Promise<YtApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API requires a browser window'));
  }
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YtApi>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        prev?.();
      } catch {
        // ignore prior callback errors
      }
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube IFrame API ready without YT.Player'));
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${YOUTUBE_IFRAME_API_SRC}"]`
    );
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = YOUTUBE_IFRAME_API_SRC;
      tag.async = true;
      tag.onerror = () => {
        apiPromise = null;
        reject(new Error('Failed to load YouTube IFrame API script'));
      };
      document.head.appendChild(tag);
    }
  });

  return apiPromise;
}

/**
 * Wraps an existing preview iframe with YT.Player so mute/unmute can be controlled
 * and polled. The iframe must already have enablejsapi=1 in its src.
 */
export async function attachYouTubePreviewPlayer(
  iframe: HTMLIFrameElement
): Promise<YouTubePreviewPlayer> {
  if (!iframe.id) {
    iframe.id = `yt-preview-${Math.random().toString(36).slice(2, 10)}`;
  }
  const api = await loadYouTubeIframeApi();
  return new Promise<YouTubePreviewPlayer>((resolve, reject) => {
    let settled = false;
    try {
      const player = new api.Player(iframe, {
        events: {
          onReady: (event) => {
            settled = true;
            resolve(event.target);
          },
          onError: (event) => {
            if (!settled) {
              settled = true;
              reject(event instanceof Error ? event : new Error('YouTube player error'));
            }
          }
        }
      });
      // Some embeds fire ready before the constructor returns; also keep a fallback.
      window.setTimeout(() => {
        if (!settled && player && typeof player.isMuted === 'function') {
          settled = true;
          resolve(player);
        }
      }, 2500);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Dedicated Electron BrowserWindow for interactive YouTube / Google login.
 *
 * Uses a persistent session partition (`persist:kls-youtube-auth`) so Chromium
 * cookie jars stay isolated from Control/Stage windows. After the user completes
 * login (2FA / CAPTCHA allowed), Main Process reads cookies via
 * `session.cookies.get` — no Playwright / automation deps.
 *
 * Lifecycle: one window at a time; close without success → cancelled.
 */

import { BrowserWindow, session, type Cookie } from 'electron';
import type { Logger } from '../Logger';
import {
  cookiesIndicateYouTubeLogin,
  electronCookiesToNetscape,
  filterYouTubeCookies
} from './netscapeCookies';
import { saveYouTubeCookiesNetscape } from './YouTubeCookieStore';

/** Isolated Chromium cookie jar for YouTube auth (persists across app restarts). */
export const YOUTUBE_AUTH_PARTITION = 'persist:kls-youtube-auth';

const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true' +
  '&continue=https%3A%2F%2Fwww.youtube.com%2F&hl=en';

const POLL_MS = 1500;
const MAX_WAIT_MS = 15 * 60 * 1000;

export type YouTubeLoginResult =
  | { success: true; cookiesPath: string; cookieCount: number }
  | { success: false; cancelled: true }
  | { success: false; cancelled: false; error: string };

/**
 * Open (or focus) the YouTube login window, wait for auth cookies, export Netscape file.
 */
export class YouTubeLoginWindow {
  private win: BrowserWindow | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<YouTubeLoginResult> | null = null;
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /** Session bound to {@link YOUTUBE_AUTH_PARTITION}. */
  public getAuthSession(): Electron.Session {
    return session.fromPartition(YOUTUBE_AUTH_PARTITION);
  }

  /**
   * Interactive login. Concurrent callers share one in-flight promise / window.
   *
   * @param options.skipExistingSession - When true, always open the BrowserWindow
   *   (used after auth failures so a stale partition cannot short-circuit refresh).
   */
  public loginInteractively(options?: {
    skipExistingSession?: boolean;
  }): Promise<YouTubeLoginResult> {
    if (this.inFlight) {
      this.focus();
      return this.inFlight;
    }

    const skipExisting = options?.skipExistingSession === true;
    this.inFlight = this.runLoginFlow(skipExisting).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Focus an already-open login window (no-op if none). */
  public focus(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.focus();
    }
  }

  /** Close login UI and clear timers (app quit / dispose). */
  public dispose(): void {
    this.clearTimers();
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
  }

  /**
   * Clear partitioned session cookies (Settings logout) without deleting the file
   * — file clearing is handled by YouTubeCookieStore.
   */
  public async clearPartitionCookies(): Promise<void> {
    try {
      await this.getAuthSession().clearStorageData({
        storages: ['cookies', 'localstorage', 'cachestorage']
      });
    } catch (err) {
      this.logger?.warn('YouTubeLoginWindow', 'Failed to clear auth partition', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Re-export cookies from the partition if already logged in (no UI).
   * Useful when the partition still has a session but cookies.txt was deleted.
   */
  public async tryExportFromExistingSession(): Promise<YouTubeLoginResult | null> {
    try {
      const cookies = await this.getAuthSession().cookies.get({});
      if (!cookiesIndicateYouTubeLogin(cookies)) return null;
      return this.persistCookies(cookies);
    } catch {
      return null;
    }
  }

  private async runLoginFlow(skipExistingSession: boolean): Promise<YouTubeLoginResult> {
    // Fast path: partition already authenticated from a prior session.
    if (!skipExistingSession) {
      const existing = await this.tryExportFromExistingSession();
      if (existing?.success) {
        this.logger?.info('YouTubeLoginWindow', 'Reused authenticated partition session', {
          cookieCount: existing.cookieCount
        });
        return existing;
      }
    }

    return new Promise<YouTubeLoginResult>((resolve) => {
      let settled = false;
      const finish = (result: YouTubeLoginResult) => {
        if (settled) return;
        settled = true;
        this.clearTimers();
        if (this.win && !this.win.isDestroyed()) {
          // Delay destroy slightly so Chromium can flush cookie writes.
          const w = this.win;
          this.win = null;
          setTimeout(() => {
            if (!w.isDestroyed()) w.destroy();
          }, 50);
        } else {
          this.win = null;
        }
        resolve(result);
      };

      try {
        const authSession = this.getAuthSession();
        this.win = new BrowserWindow({
          width: 980,
          height: 740,
          minWidth: 640,
          minHeight: 480,
          show: false,
          autoHideMenuBar: true,
          title: 'YouTube Login — Karaoke Live Station',
          webPreferences: {
            session: authSession,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          }
        });

        this.win.once('ready-to-show', () => {
          if (this.win && !this.win.isDestroyed()) {
            this.win.show();
            this.win.focus();
          }
        });

        this.win.on('closed', () => {
          this.win = null;
          // User dismissed the window before we detected login.
          finish({ success: false, cancelled: true });
        });

        const tryCapture = async () => {
          if (settled) return;
          try {
            const cookies = await authSession.cookies.get({});
            if (!cookiesIndicateYouTubeLogin(cookies)) return;
            const persisted = this.persistCookies(cookies);
            finish(persisted);
          } catch (err) {
            this.logger?.warn('YouTubeLoginWindow', 'Cookie poll failed', {
              error: err instanceof Error ? err.message : String(err)
            });
          }
        };

        // Navigate + poll: covers CAPTCHA / 2FA multi-step redirects.
        this.win.webContents.on('did-navigate', () => {
          void tryCapture();
        });
        this.win.webContents.on('did-navigate-in-page', () => {
          void tryCapture();
        });

        this.pollTimer = setInterval(() => {
          void tryCapture();
        }, POLL_MS);

        this.timeoutTimer = setTimeout(() => {
          finish({
            success: false,
            cancelled: false,
            error: 'YouTube login timed out. Please try again from Settings.'
          });
        }, MAX_WAIT_MS);

        this.logger?.info('YouTubeLoginWindow', 'Opening YouTube login window');
        void this.win.loadURL(LOGIN_URL).catch((err) => {
          finish({
            success: false,
            cancelled: false,
            error: `Failed to open YouTube login: ${err instanceof Error ? err.message : String(err)}`
          });
        });
      } catch (err) {
        finish({
          success: false,
          cancelled: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });
  }

  private persistCookies(cookies: Cookie[]): YouTubeLoginResult {
    const filtered = filterYouTubeCookies(cookies);
    if (filtered.length === 0) {
      return {
        success: false,
        cancelled: false,
        error: 'No YouTube/Google cookies available after login'
      };
    }
    try {
      const body = electronCookiesToNetscape(filtered);
      const cookiesPath = saveYouTubeCookiesNetscape(body);
      this.logger?.info('YouTubeLoginWindow', 'Saved YouTube cookies for yt-dlp', {
        cookieCount: filtered.length,
        // Path only — never log cookie values
        cookiesPath
      });
      return { success: true, cookiesPath, cookieCount: filtered.length };
    } catch (err) {
      return {
        success: false,
        cancelled: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  private clearTimers(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}

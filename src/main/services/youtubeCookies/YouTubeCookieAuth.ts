/**
 * Facade: YouTube cookie lifecycle for yt-dlp downloads.
 *
 * Flow:
 * 1. Missing / invalid cookies.txt → open partitioned login BrowserWindow
 * 2. On success → Netscape export under userData/youtube/cookies.txt
 * 3. DownloadManager / search append `--cookies <path>`
 * 4. yt-dlp 401/403/auth-expired → re-open login, refresh file, retry once
 */

import type { Logger } from '../Logger';
import { isYouTubeUrl } from './youtubeAuthErrors';
import { YouTubeLoginWindow, type YouTubeLoginResult } from './YouTubeLoginWindow';
import {
  clearYouTubeCookieFile,
  getYouTubeCookieFileStatus,
  getYouTubeCookiesFilePath,
  resolveValidCookiesPathForYtDlp,
  type YouTubeCookieFileStatus
} from './YouTubeCookieStore';

export type YouTubeCookieEnsureResult =
  | { ok: true; cookiesPath: string; reused: boolean }
  | { ok: false; cancelled: boolean; error?: string };

/**
 * Bridge injected into DownloadManager (keeps Electron UI out of the spawn loop).
 */
export interface YouTubeCookieBridge {
  /** Absolute cookies.txt when valid; otherwise null */
  getValidCookiesPath(): string | null;
  /**
   * Ensure a valid cookies file exists before a YouTube download.
   * Opens the login window when missing/invalid (unless forceLogin).
   */
  ensureForYouTubeDownload(url: string): Promise<YouTubeCookieEnsureResult>;
  /**
   * After yt-dlp reports auth failure: force interactive re-login.
   * @returns true when a fresh cookies file was written
   */
  refreshAfterAuthFailure(url: string): Promise<boolean>;
}

export class YouTubeCookieAuth implements YouTubeCookieBridge {
  private loginWindow: YouTubeLoginWindow;
  private logger?: Logger;
  /** Serialize ensure/refresh so two downloads do not open two windows. */
  private gate: Promise<unknown> = Promise.resolve();

  constructor(logger?: Logger) {
    this.logger = logger;
    this.loginWindow = new YouTubeLoginWindow(logger);
  }

  public getStatus(): YouTubeCookieFileStatus {
    return getYouTubeCookieFileStatus();
  }

  public getCookiesFilePath(): string {
    return getYouTubeCookiesFilePath();
  }

  public getValidCookiesPath(): string | null {
    return resolveValidCookiesPathForYtDlp();
  }

  /**
   * yt-dlp argv fragment: `['--cookies', path]` or `[]`.
   */
  public getYtDlpCookieArgs(): string[] {
    const p = this.getValidCookiesPath();
    return p ? ['--cookies', p] : [];
  }

  public async ensureForYouTubeDownload(url: string): Promise<YouTubeCookieEnsureResult> {
    if (!isYouTubeUrl(url)) {
      const existing = this.getValidCookiesPath();
      return existing
        ? { ok: true, cookiesPath: existing, reused: true }
        : { ok: false, cancelled: false, error: 'Not a YouTube URL' };
    }
    return this.withGate(() => this.ensureInternal(false));
  }

  public async refreshAfterAuthFailure(url: string): Promise<boolean> {
    if (!isYouTubeUrl(url)) return false;
    const result = await this.withGate(() => this.ensureInternal(true));
    return result.ok === true;
  }

  /**
   * Settings / IPC: always show the login window (or reuse partition export).
   */
  public async loginFromSettings(): Promise<YouTubeLoginResult> {
    return this.withGate(async () => {
      // Settings action: show the window so the operator can sign in / switch account.
      // Skip silent partition reuse so the UI is always visible when requested.
      const result = await this.loginWindow.loginInteractively({
        skipExistingSession: true
      });
      return result;
    });
  }

  /**
   * Settings: delete cookies.txt and wipe the auth partition.
   */
  public async clearAll(): Promise<boolean> {
    const fileOk = clearYouTubeCookieFile();
    await this.loginWindow.clearPartitionCookies();
    this.logger?.info('YouTubeCookieAuth', 'Cleared YouTube cookies file and auth partition');
    return fileOk;
  }

  public dispose(): void {
    this.loginWindow.dispose();
  }

  private async ensureInternal(forceLogin: boolean): Promise<YouTubeCookieEnsureResult> {
    if (!forceLogin) {
      const existing = this.getValidCookiesPath();
      if (existing) {
        return { ok: true, cookiesPath: existing, reused: true };
      }

      // cookies.txt missing but Chromium partition may still be logged in.
      const fromPartition = await this.loginWindow.tryExportFromExistingSession();
      if (fromPartition?.success) {
        return {
          ok: true,
          cookiesPath: fromPartition.cookiesPath,
          reused: true
        };
      }
    } else {
      // Stale cookies caused 401/403 — drop file + partition before forcing UI.
      clearYouTubeCookieFile();
      await this.loginWindow.clearPartitionCookies();
    }

    this.logger?.info('YouTubeCookieAuth', 'YouTube cookies missing or refresh requested — opening login', {
      forceLogin
    });

    const result = await this.loginWindow.loginInteractively({
      skipExistingSession: forceLogin
    });
    if (result.success) {
      return { ok: true, cookiesPath: result.cookiesPath, reused: false };
    }
    if ('cancelled' in result && result.cancelled) {
      return { ok: false, cancelled: true, error: 'YouTube login cancelled' };
    }
    return {
      ok: false,
      cancelled: false,
      error: 'error' in result ? result.error : 'YouTube login failed'
    };
  }

  private async withGate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gate.then(fn, fn);
    // Keep the chain alive even when fn rejects.
    this.gate = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

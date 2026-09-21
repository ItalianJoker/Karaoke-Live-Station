import { Logger } from './Logger';
import { AppUpdateInfo } from '../../shared/types';

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubReleaseResponse {
  tag_name: string;
  name: string;
  body?: string;
  published_at: string;
  html_url: string;
  assets?: GitHubReleaseAsset[];
}

/**
 * Compares two semantic version strings (e.g. "2.0.0" vs "v2.0.1").
 * Returns:
 *   1 if v2 > v1 (update available)
 *  -1 if v2 < v1
 *   0 if equal
 */
export function compareSemver(v1: string, v2: string): number {
  const clean = (v: string) =>
    (v || '').replace(/^[vV]/, '').split('-')[0].trim();

  const parts1 = clean(v1).split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = clean(v2).split('.').map((p) => parseInt(p, 10) || 0);

  const maxLen = Math.max(parts1.length, parts2.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] ?? 0;
    const num2 = parts2[i] ?? 0;
    if (num2 > num1) return 1;
    if (num2 < num1) return -1;
  }
  return 0;
}

/**
 * Selects the best release asset matching current host OS and architecture.
 */
export function selectPlatformAsset(
  assets: GitHubReleaseAsset[] = [],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): GitHubReleaseAsset | undefined {
  if (!Array.isArray(assets) || assets.length === 0) return undefined;

  const isWin = platform === 'win32';
  const isMac = platform === 'darwin';
  const isArm = arch === 'arm64';

  if (isWin) {
    // Prefer standalone portable .exe, fallback to -win.zip
    const exe = assets.find((a) => a.name.toLowerCase().endsWith('.exe'));
    if (exe) return exe;
    const winZip = assets.find((a) =>
      a.name.toLowerCase().includes('win') && a.name.toLowerCase().endsWith('.zip')
    );
    if (winZip) return winZip;
  } else if (isMac) {
    // Prefer dmg or mac zip (match arm64 if running on arm)
    const dmg = isArm
      ? assets.find((a) => a.name.toLowerCase().includes('arm64') && a.name.toLowerCase().endsWith('.dmg')) ||
        assets.find((a) => a.name.toLowerCase().endsWith('.dmg'))
      : assets.find((a) => a.name.toLowerCase().endsWith('.dmg'));
    if (dmg) return dmg;
    const macZip = assets.find((a) =>
      a.name.toLowerCase().includes('mac') && a.name.toLowerCase().endsWith('.zip')
    );
    if (macZip) return macZip;
  } else {
    // Linux: prefer AppImage (match arm64/x86_64 if available), fallback to deb
    const appImage = isArm
      ? assets.find((a) => (a.name.toLowerCase().includes('arm64') || a.name.toLowerCase().includes('aarch64')) && a.name.toLowerCase().endsWith('.appimage')) ||
        assets.find((a) => a.name.toLowerCase().endsWith('.appimage'))
      : assets.find((a) => a.name.toLowerCase().endsWith('.appimage'));
    if (appImage) return appImage;
    const deb = assets.find((a) => a.name.toLowerCase().endsWith('.deb'));
    if (deb) return deb;
  }

  // Fallback: any asset matching platform keyword
  const keyword = isWin ? 'win' : isMac ? 'mac' : 'linux';
  return assets.find((a) => a.name.toLowerCase().includes(keyword));
}

export class AppUpdateChecker {
  private currentVersion: string;
  private logger: Logger;
  private repoOwner: string;
  private repoName: string;
  private cachedInfo: AppUpdateInfo | null = null;
  private isChecking: boolean = false;

  constructor(
    currentVersion: string,
    logger: Logger,
    repoOwner = 'ItalianJoker',
    repoName = 'Karaoke-Live-Station'
  ) {
    this.currentVersion = currentVersion;
    this.logger = logger;
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  /**
   * Queries GitHub Releases API for the latest published tag and compares against current version.
   */
  public async checkForUpdates(force = false): Promise<AppUpdateInfo> {
    const now = Date.now();
    // Cache for 10 minutes unless forced
    if (!force && this.cachedInfo && now - (this.cachedInfo.lastChecked || 0) < 600000) {
      return this.cachedInfo;
    }

    if (this.isChecking && this.cachedInfo) {
      return this.cachedInfo;
    }

    this.isChecking = true;
    const endpoint = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;

    try {
      this.logger.info('AppUpdateChecker', `Checking for updates at ${endpoint}...`, {
        currentVersion: this.currentVersion
      });

      const res = await fetch(endpoint, {
        headers: {
          'User-Agent': `KaraokeLiveStation/${this.currentVersion}`,
          Accept: 'application/vnd.github.v3+json'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Nessuna release trovata su GitHub');
        }
        if (res.status === 403) {
          throw new Error('Limite richieste API GitHub superato. Riprova più tardi.');
        }
        throw new Error(`Risposta server GitHub non valida (${res.status} ${res.statusText})`);
      }

      const release = (await res.json()) as GitHubReleaseResponse;
      const latestTag = (release.tag_name || '').trim();
      const hasUpdate = compareSemver(this.currentVersion, latestTag) > 0;
      const bestAsset = selectPlatformAsset(release.assets);

      this.cachedInfo = {
        currentVersion: this.currentVersion,
        latestVersion: latestTag.replace(/^[vV]/, ''),
        hasUpdate,
        releaseName: release.name || latestTag,
        releaseNotes: release.body || '',
        publishedAt: release.published_at,
        releaseUrl: release.html_url,
        downloadUrl: bestAsset?.browser_download_url,
        assetName: bestAsset?.name,
        assetSize: bestAsset?.size,
        lastChecked: now
      };

      this.logger.info('AppUpdateChecker', 'Update check completed', {
        current: this.currentVersion,
        latest: latestTag,
        hasUpdate,
        asset: bestAsset?.name
      });

      return this.cachedInfo;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn('AppUpdateChecker', 'Update check failed', { error: errMsg });

      const fallbackInfo: AppUpdateInfo = {
        currentVersion: this.currentVersion,
        latestVersion: this.currentVersion,
        hasUpdate: false,
        error: errMsg,
        lastChecked: now
      };
      this.cachedInfo = fallbackInfo;
      return fallbackInfo;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Non-blocking background startup probe.
   * If an update is detected, fires the onUpdateFound callback.
   */
  public startBackgroundCheck(
    onUpdateFound: (info: AppUpdateInfo) => void,
    delayMs = 4000
  ): void {
    setTimeout(async () => {
      try {
        const info = await this.checkForUpdates(true);
        if (info.hasUpdate) {
          this.logger.info('AppUpdateChecker', 'New software release detected on startup', {
            latestVersion: info.latestVersion,
            releaseName: info.releaseName
          });
          onUpdateFound(info);
        }
      } catch (e) {
        this.logger.warn('AppUpdateChecker', 'Background startup check error', {
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }, delayMs);
  }
}

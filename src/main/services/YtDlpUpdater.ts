import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { Logger } from './Logger';
import { getUserDataBinDir, resolveYtDlpPath } from './BinaryResolver';
import { YtDlpStatus } from '../../shared/types';

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubReleaseResponse {
  tag_name: string;
  name: string;
  published_at: string;
  assets: GitHubReleaseAsset[];
}

/**
 * Service responsible for:
 * 1. Detecting local yt-dlp binary availability and version.
 * 2. Checking GitHub Releases for latest official yt-dlp binary.
 * 3. Downloading and updating the executable in a user-writable path (userData/bin/).
 * 4. Setting execution permissions (chmod 0755) on POSIX platforms.
 * 5. Providing non-blocking automatic background updates on application startup.
 */
export class YtDlpUpdater {
  private binDir: string;
  private logger: Logger;
  private isUpdating: boolean = false;
  private cachedStatus: YtDlpStatus;

  constructor(userDataPath: string, logger: Logger) {
    this.binDir = userDataPath ? path.join(userDataPath, 'bin') : getUserDataBinDir();
    this.logger = logger;

    // Initialize status snapshot
    const local = this.detectLocalStatus();
    this.cachedStatus = {
      available: local.available,
      version: local.version,
      path: local.path,
      isUpdating: false
    };
  }

  /**
   * Retrieves the current diagnostic status and version of yt-dlp.
   */
  public getStatus(): YtDlpStatus {
    const freshLocal = this.detectLocalStatus();
    this.cachedStatus = {
      ...this.cachedStatus,
      available: freshLocal.available,
      version: freshLocal.version,
      path: freshLocal.path,
      isUpdating: this.isUpdating
    };
    return this.cachedStatus;
  }

  /**
   * Performs an immediate version check against GitHub releases.
   * If an update is found (or if forceDownload is true / binary is missing),
   * downloads and installs the updated binary.
   */
  public async checkForUpdates(forceDownload: boolean = false): Promise<YtDlpStatus> {
    if (this.isUpdating) {
      this.logger.info('YtDlpUpdater', 'Update already in progress, returning active status');
      return this.getStatus();
    }

    this.isUpdating = true;
    this.cachedStatus.isUpdating = true;
    this.cachedStatus.error = undefined;

    try {
      this.logger.info('YtDlpUpdater', 'Checking GitHub for latest yt-dlp release...');
      const release = await this.fetchLatestRelease();
      const latestTag = release.tag_name;
      this.cachedStatus.latestVersion = latestTag;
      this.cachedStatus.lastChecked = Date.now();

      const current = this.detectLocalStatus();
      const shouldUpdate =
        forceDownload ||
        !current.available ||
        !current.version ||
        this.compareVersions(latestTag, current.version) > 0;

      if (!shouldUpdate) {
        this.logger.info('YtDlpUpdater', 'yt-dlp is up to date', {
          currentVersion: current.version,
          latestVersion: latestTag
        });
        this.isUpdating = false;
        this.cachedStatus.isUpdating = false;
        return this.getStatus();
      }

      this.logger.info('YtDlpUpdater', 'Starting yt-dlp binary download and installation...', {
        currentVersion: current.version,
        targetVersion: latestTag,
        forceDownload
      });

      const asset = this.selectBestAsset(release.assets);
      if (!asset) {
        throw new Error(
          `No compatible yt-dlp release asset found for platform=${process.platform}, arch=${process.arch}`
        );
      }

      await this.downloadAndInstallAsset(asset.browser_download_url, latestTag);

      const verified = this.detectLocalStatus();
      this.cachedStatus = {
        available: verified.available,
        version: verified.version,
        path: verified.path,
        isUpdating: false,
        latestVersion: latestTag,
        lastChecked: Date.now()
      };

      this.logger.info('YtDlpUpdater', 'yt-dlp successfully updated and verified', {
        version: this.cachedStatus.version,
        path: this.cachedStatus.path
      });

      return this.cachedStatus;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('YtDlpUpdater', 'Failed to check or update yt-dlp', { error: errMsg });
      this.cachedStatus.error = errMsg;
      return this.cachedStatus;
    } finally {
      this.isUpdating = false;
      this.cachedStatus.isUpdating = false;
    }
  }

  /**
   * Background startup hook. Runs safely without blocking app lifecycle or UI rendering.
   */
  public async checkAndAutoUpdateOnStartup(): Promise<void> {
    try {
      const local = this.detectLocalStatus();
      if (!local.available) {
        this.logger.info('YtDlpUpdater', 'yt-dlp not found on system startup. Initiating auto-download...');
        await this.checkForUpdates(true);
      } else {
        this.logger.info('YtDlpUpdater', 'yt-dlp detected on startup. Checking for background updates...', {
          version: local.version,
          path: local.path
        });
        await this.checkForUpdates(false);
      }
    } catch (err) {
      this.logger.warn('YtDlpUpdater', 'Non-fatal startup yt-dlp check failed', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Detects local executable availability, absolute path, and runtime version string.
   */
  private detectLocalStatus(): { available: boolean; version?: string; path?: string } {
    try {
      const resolved = resolveYtDlpPath();
      const output = execFileSync(resolved, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();

      if (output && /^[0-9]/.test(output)) {
        return {
          available: true,
          version: output,
          path: resolved
        };
      }
    } catch {
      // Executable missing or invocation failed
    }

    return {
      available: false
    };
  }

  /**
   * Fetches latest GitHub release data via GitHub REST API.
   */
  private async fetchLatestRelease(): Promise<GitHubReleaseResponse> {
    const url = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'KaraokeLiveStation/1.0',
        Accept: 'application/vnd.github.v3+json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as GitHubReleaseResponse;
  }

  /**
   * Matches release assets against current operating system and architecture.
   */
  private selectBestAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | undefined {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const isArm = process.arch === 'arm64';

    const candidateNames: string[] = [];

    if (isWin) {
      if (isArm) candidateNames.push('yt-dlp_arm64.exe');
      candidateNames.push('yt-dlp.exe');
    } else if (isMac) {
      candidateNames.push('yt-dlp_macos');
      candidateNames.push('yt-dlp');
    } else {
      // Linux and other POSIX
      if (isArm) candidateNames.push('yt-dlp_linux_aarch64');
      candidateNames.push('yt-dlp_linux');
      candidateNames.push('yt-dlp');
    }

    for (const name of candidateNames) {
      const found = assets.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (found) return found;
    }

    return undefined;
  }

  /**
   * Downloads the remote asset to a temporary file, sets executable permissions,
   * verifies execution, and atomically moves it into userData/bin/.
   */
  private async downloadAndInstallAsset(downloadUrl: string, expectedTag: string): Promise<void> {
    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }

    const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const targetPath = path.join(this.binDir, binaryName);
    const tempPath = path.join(this.binDir, `${binaryName}.download.${Date.now()}`);

    this.logger.info('YtDlpUpdater', `Streaming download from ${downloadUrl} to ${tempPath}`);

    const res = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'KaraokeLiveStation/1.0',
        Accept: 'application/octet-stream'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(120000)
    });

    if (!res.ok) {
      throw new Error(`Asset download failed with HTTP ${res.status}: ${res.statusText}`);
    }

    if (!res.body) {
      throw new Error('Download response body is null or undefined');
    }

    const writeStream = fs.createWriteStream(tempPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pipeline(Readable.fromWeb(res.body as any), writeStream);

    // Apply execution permissions on POSIX
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(tempPath, 0o755);
      } catch (err) {
        this.logger.warn('YtDlpUpdater', 'Failed to chmod temp binary', { error: err });
      }
    }

    // Verify downloaded binary runs properly
    try {
      const verifiedVersion = execFileSync(tempPath, ['--version'], {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();

      this.logger.info('YtDlpUpdater', 'Downloaded binary validated successfully', {
        verifiedVersion,
        expectedTag
      });
    } catch (testErr) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
      throw new Error(
        `Downloaded binary failed execution check: ${
          testErr instanceof Error ? testErr.message : String(testErr)
        }`
      );
    }

    // Replace existing target binary atomically
    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
      } catch (unlinkErr) {
        // Fallback for Windows file locks
        const backupPath = `${targetPath}.old.${Date.now()}`;
        try {
          fs.renameSync(targetPath, backupPath);
          setTimeout(() => {
            try {
              if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
            } catch {}
          }, 10000);
        } catch {
          this.logger.warn('YtDlpUpdater', 'Could not replace locked existing binary', unlinkErr);
        }
      }
    }

    fs.renameSync(tempPath, targetPath);

    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(targetPath, 0o755);
      } catch (err) {
        this.logger.warn('YtDlpUpdater', 'Failed to chmod final binary', { error: err });
      }
    }
  }

  /**
   * Compares two release version strings (e.g. "2026.08.19" vs "2025.10.01").
   * Returns > 0 if v1 > v2, < 0 if v1 < v2, and 0 if equal.
   */
  private compareVersions(v1: string, v2: string): number {
    const clean1 = v1.replace(/^[^\d]*/, '').split('.');
    const clean2 = v2.replace(/^[^\d]*/, '').split('.');

    const maxLen = Math.max(clean1.length, clean2.length);
    for (let i = 0; i < maxLen; i++) {
      const n1 = parseInt(clean1[i] || '0', 10);
      const n2 = parseInt(clean2[i] || '0', 10);
      if (isNaN(n1) || isNaN(n2)) {
        const s1 = clean1[i] || '';
        const s2 = clean2[i] || '';
        if (s1 !== s2) return s1.localeCompare(s2);
      } else if (n1 !== n2) {
        return n1 - n2;
      }
    }

    return 0;
  }
}

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { Logger } from './Logger';
import {
  ensureDir,
  ensureExecutable,
  ensureManagedYtDlpFromBundle,
  getManagedYtDlpPath,
  getUserDataBinDir,
  getYtDlpBinaryName,
  resolveYtDlpPath,
  validateYtDlpBinaryIntegrity
} from './BinaryResolver';
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
 * 2. Persisting the executable exclusively under `<userData>/bin/` (not temp dirs).
 * 3. Seeding from bundled release binaries when the managed copy is missing.
 * 4. Checking GitHub Releases for the latest official yt-dlp binary (auto-update, not re-download every launch).
 * 5. Validating integrity (size + optional SHA-256 + `--version` probe) before install/use.
 * 6. Setting execution permissions (`chmod 0755`) on POSIX platforms.
 * 7. Providing non-blocking automatic background updates on application startup.
 */
export class YtDlpUpdater {
  private binDir: string;
  private logger: Logger;
  private isUpdating: boolean = false;
  private cachedStatus: YtDlpStatus;

  constructor(userDataPath: string, logger: Logger) {
    this.binDir = userDataPath ? path.join(userDataPath, 'bin') : getUserDataBinDir();
    this.logger = logger;

    ensureDir(this.binDir);
    // Prefer durable managed binary; seed from package resources when possible
    ensureManagedYtDlpFromBundle();

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
   * If an update is found (or if forceDownload is true / binary is missing/corrupt),
   * downloads and installs the updated binary into `<userData>/bin/`.
   * Does NOT re-download when the installed version already matches the latest release.
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
      // Repair / seed managed copy before talking to the network
      ensureManagedYtDlpFromBundle();

      this.logger.info('YtDlpUpdater', 'Checking GitHub for latest yt-dlp release...');
      const release = await this.fetchLatestRelease();
      const latestTag = release.tag_name;
      this.cachedStatus.latestVersion = latestTag;
      this.cachedStatus.lastChecked = Date.now();

      const current = this.detectLocalStatus();
      const managedIntegrity = validateYtDlpBinaryIntegrity(getManagedYtDlpPath());
      const shouldUpdate =
        forceDownload ||
        !current.available ||
        !managedIntegrity.ok ||
        !current.version ||
        this.compareVersions(latestTag, current.version) > 0;

      if (!shouldUpdate) {
        this.logger.info('YtDlpUpdater', 'yt-dlp is up to date — skipping re-download', {
          currentVersion: current.version,
          latestVersion: latestTag,
          path: current.path
        });
        this.isUpdating = false;
        this.cachedStatus.isUpdating = false;
        return this.getStatus();
      }

      this.logger.info('YtDlpUpdater', 'Starting yt-dlp binary download and installation...', {
        currentVersion: current.version,
        targetVersion: latestTag,
        forceDownload,
        managedIntegrityOk: managedIntegrity.ok
      });

      const asset = this.selectBestAsset(release.assets);
      if (!asset) {
        throw new Error(
          `No compatible yt-dlp release asset found for platform=${process.platform}, arch=${process.arch}`
        );
      }

      const expectedSha256 = await this.fetchExpectedSha256(release.assets, asset.name);

      await this.downloadAndInstallAsset(asset.browser_download_url, latestTag, {
        expectedSize: asset.size,
        expectedSha256
      });

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
   * Missing/corrupt binaries trigger a download; intact binaries only update when a newer
   * GitHub release exists (not a blind re-download every launch).
   */
  public async checkAndAutoUpdateOnStartup(): Promise<void> {
    try {
      ensureManagedYtDlpFromBundle();
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
   * Prefers the managed `<userData>/bin` path after integrity validation.
   */
  private detectLocalStatus(): { available: boolean; version?: string; path?: string } {
    const managedPath = getManagedYtDlpPath();
    const candidates = [managedPath, resolveYtDlpPath()];

    for (const candidate of candidates) {
      const integrity = validateYtDlpBinaryIntegrity(candidate);
      if (!integrity.ok) continue;

      try {
        ensureExecutable(candidate);
        const output = execFileSync(candidate, ['--version'], {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();

        if (output && /^[0-9]/.test(output)) {
          return {
            available: true,
            version: output,
            path: candidate
          };
        }
      } catch {
        // Try next candidate
      }
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
   * Downloads SHA2-256SUMS (when published) and returns the hex digest for the chosen asset.
   */
  private async fetchExpectedSha256(
    assets: GitHubReleaseAsset[],
    assetName: string
  ): Promise<string | undefined> {
    const sumsAsset =
      assets.find((a) => a.name === 'SHA2-256SUMS') ||
      assets.find((a) => /sha256/i.test(a.name) && /sums/i.test(a.name));

    if (!sumsAsset) {
      this.logger.warn('YtDlpUpdater', 'No SHA2-256SUMS asset found in release; size+exec checks only');
      return undefined;
    }

    try {
      const res = await fetch(sumsAsset.browser_download_url, {
        headers: {
          'User-Agent': 'KaraokeLiveStation/1.0',
          Accept: 'application/octet-stream'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) {
        this.logger.warn('YtDlpUpdater', `Failed to download SHA2-256SUMS (HTTP ${res.status})`);
        return undefined;
      }

      const text = await res.text();
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        // Formats: "<hex>  <filename>" or "<hex> *<filename>"
        const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(trimmed);
        if (!match) continue;
        const [, hash, name] = match;
        if (name.trim() === assetName) {
          return hash.toLowerCase();
        }
      }

      this.logger.warn('YtDlpUpdater', `SHA2-256SUMS did not list asset ${assetName}`);
    } catch (err) {
      this.logger.warn('YtDlpUpdater', 'Unable to parse SHA2-256SUMS', {
        error: err instanceof Error ? err.message : String(err)
      });
    }

    return undefined;
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
   * Downloads the remote asset into `<userData>/bin/` (temp sibling), validates size/SHA/exec,
   * then atomically replaces the managed binary. Never writes the final binary under OS temp.
   */
  private async downloadAndInstallAsset(
    downloadUrl: string,
    expectedTag: string,
    integrity: { expectedSize?: number; expectedSha256?: string }
  ): Promise<void> {
    ensureDir(this.binDir);

    const binaryName = getYtDlpBinaryName();
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

    const sizeCheck = validateYtDlpBinaryIntegrity(tempPath);
    if (!sizeCheck.ok) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup errors
      }
      throw new Error(`Downloaded binary failed integrity size check: ${sizeCheck.reason}`);
    }

    if (integrity.expectedSize && integrity.expectedSize > 0) {
      const actualSize = fs.statSync(tempPath).size;
      // Allow small variance only if Content-Length style size was provided by GitHub
      if (actualSize !== integrity.expectedSize) {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
        throw new Error(
          `Downloaded binary size mismatch: expected ${integrity.expectedSize}, got ${actualSize}`
        );
      }
    }

    if (integrity.expectedSha256) {
      const hash = await this.sha256File(tempPath);
      if (hash !== integrity.expectedSha256.toLowerCase()) {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
        throw new Error(
          `Downloaded binary SHA-256 mismatch: expected ${integrity.expectedSha256}, got ${hash}`
        );
      }
      this.logger.info('YtDlpUpdater', 'SHA-256 integrity verified', {
        sha256: hash
      });
    }

    ensureExecutable(tempPath);

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
      } catch {
        // ignore
      }
      throw new Error(
        `Downloaded binary failed execution check: ${
          testErr instanceof Error ? testErr.message : String(testErr)
        }`
      );
    }

    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
      } catch (unlinkErr) {
        const backupPath = `${targetPath}.old.${Date.now()}`;
        try {
          fs.renameSync(targetPath, backupPath);
          setTimeout(() => {
            try {
              if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
            } catch {
              // ignore
            }
          }, 10000);
        } catch {
          this.logger.warn('YtDlpUpdater', 'Could not replace locked existing binary', unlinkErr);
        }
      }
    }

    fs.renameSync(tempPath, targetPath);
    ensureExecutable(targetPath);

    const finalCheck = validateYtDlpBinaryIntegrity(targetPath, { requireExecutableBit: true });
    if (!finalCheck.ok && process.platform !== 'win32') {
      // Retry chmod then re-check size only — some mounts lack exec bit semantics
      ensureExecutable(targetPath);
      const retry = validateYtDlpBinaryIntegrity(targetPath);
      if (!retry.ok) {
        throw new Error(`Installed binary failed final integrity check: ${retry.reason}`);
      }
    }
  }

  private async sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
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

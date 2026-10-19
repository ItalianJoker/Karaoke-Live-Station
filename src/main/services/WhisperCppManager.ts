import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app, net, BrowserWindow } from 'electron';
import { execFileSync } from 'child_process';
import { Logger } from './Logger';
import {
  WHISPER_MODELS,
  type WhisperModelId,
  type WhisperModelDownloadProgress,
  type WhisperModelDiskInfo,
  type WhisperEngineStatus,
  coerceWhisperModelId
} from '../../shared/whisperStt';

type ModelInstallMeta = {
  id: WhisperModelId;
  url: string;
  size: number;
  installedAt: string;
};

/** Windows NTSTATUS STATUS_DLL_NOT_FOUND (0xC0000135) — unsigned and signed forms. */
const WIN_STATUS_DLL_NOT_FOUND_U = 3221225781;
const WIN_STATUS_DLL_NOT_FOUND_S = -1073741515;

/**
 * Manages whisper.cpp CLI binary under `<userData>/bin/` and GGML models under
 * `<userData>/models/whisper/` — never installer / exe dir / asar / extraResources.
 *
 * Mirrors OfflineVocalModelManager (download + staging + progress) and YtDlpUpdater
 * (managed bin under userData). Public delete APIs reclaim disk space.
 *
 * On Windows the official whisper-blas zip ships whisper-cli.exe plus runtime DLLs
 * (libopenblas, ggml*, whisper.dll). Those DLLs must sit next to the exe under
 * userData/bin or the loader exits with STATUS_DLL_NOT_FOUND before any STT work.
 */
export class WhisperCppManager {
  private readonly logger: Logger;
  private readonly inFlight = new Map<WhisperModelId, Promise<string>>();
  private binaryInFlight: Promise<string> | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Absolute directory for Whisper GGML models (persistent app data). */
  public getModelsDir(): string {
    return path.join(app.getPath('userData'), 'models', 'whisper');
  }

  public getBinDir(): string {
    return path.join(app.getPath('userData'), 'bin');
  }

  public getModelPath(modelId: WhisperModelId): string {
    const id = coerceWhisperModelId(modelId);
    return path.join(this.getModelsDir(), WHISPER_MODELS[id].filename);
  }

  public getBinPath(): string {
    const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    return path.join(this.getBinDir(), name);
  }

  private getInstallMetaPath(modelId: WhisperModelId): string {
    return `${this.getModelPath(modelId)}.meta.json`;
  }

  public getModelDiskInfo(modelId: WhisperModelId): WhisperModelDiskInfo {
    const id = coerceWhisperModelId(modelId);
    const modelPath = this.getModelPath(id);
    try {
      if (!fs.existsSync(modelPath)) {
        return { modelId: id, present: false, bytesOnDisk: 0 };
      }
      const size = fs.statSync(modelPath).size;
      return { modelId: id, present: size > 0, bytesOnDisk: size, path: modelPath };
    } catch {
      return { modelId: id, present: false, bytesOnDisk: 0 };
    }
  }

  public listCachedModels(): Array<{ modelId: WhisperModelId; bytesOnDisk: number; path: string }> {
    const out: Array<{ modelId: WhisperModelId; bytesOnDisk: number; path: string }> = [];
    for (const id of Object.keys(WHISPER_MODELS) as WhisperModelId[]) {
      const info = this.getModelDiskInfo(id);
      if (info.present && info.path) {
        out.push({ modelId: id, bytesOnDisk: info.bytesOnDisk, path: info.path });
      }
    }
    return out;
  }

  public getStatus(): WhisperEngineStatus {
    const bin = this.getBinPath();
    let binaryReady = false;
    try {
      // Size alone is not enough on Windows — exe without sibling DLLs is not runnable.
      binaryReady =
        fs.existsSync(bin) &&
        fs.statSync(bin).size > 100_000 &&
        (process.platform !== 'win32' || this.hasWindowsRuntimeDlls(bin));
    } catch {
      binaryReady = false;
    }
    return {
      binaryReady,
      binaryPath: binaryReady ? bin : undefined,
      modelsDir: this.getModelsDir(),
      models: (Object.keys(WHISPER_MODELS) as WhisperModelId[]).map((id) =>
        this.getModelDiskInfo(id)
      )
    };
  }

  public async isModelCached(modelId: WhisperModelId): Promise<boolean> {
    const id = coerceWhisperModelId(modelId);
    const info = this.getModelDiskInfo(id);
    if (!info.present) return false;
    return info.bytesOnDisk >= WHISPER_MODELS[id].minBytes;
  }

  /**
   * Delete one cached model (+ sidecar). Does not touch ONNX vocal models under userData/models/.
   */
  public async deleteModel(modelId: WhisperModelId): Promise<void> {
    const id = coerceWhisperModelId(modelId);
    const modelPath = this.getModelPath(id);
    const metaPath = this.getInstallMetaPath(id);
    const staging = `${modelPath}.download`;
    for (const p of [modelPath, metaPath, staging]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (err) {
        this.logger.warn('WhisperCppManager', `Failed to delete ${p}`, err);
      }
    }
    this.logger.info('WhisperCppManager', `Deleted Whisper model ${id}`, { modelPath });
    this.emitProgress({
      modelId: id,
      phase: 'ready',
      loaded: 0,
      total: 0,
      message: `Model ${id} removed`
    });
  }

  /** Delete all Whisper GGML models under models/whisper/ (not vocal ONNX root). */
  public async deleteAllModels(): Promise<void> {
    for (const id of Object.keys(WHISPER_MODELS) as WhisperModelId[]) {
      await this.deleteModel(id);
    }
  }

  /**
   * Ensure whisper-cli exists under userData/bin.
   * Prefer existing managed binary; optionally seed from bundled `bin/<platform>/`;
   * otherwise download platform zip from whisper.cpp GitHub releases when available.
   *
   * Broken Windows installs (exe without runtime DLLs / STATUS_DLL_NOT_FOUND probe)
   * are removed and re-fetched so upgrades repair without manual delete.
   */
  public async ensureBinary(signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    const target = this.getBinPath();
    if (fs.existsSync(target)) {
      try {
        if (fs.statSync(target).size > 100_000 && this.isBinaryInstallHealthy(target)) {
          this.ensureExecutable(target);
          return target;
        }
      } catch {
        /* fall through to repair */
      }
      this.removeBrokenBinaryInstall(target);
    }

    // Optional seed from package resources (same pattern as yt-dlp/ffmpeg).
    const seeded = this.trySeedFromBundle();
    if (seeded) return seeded;

    if (this.binaryInFlight) return this.binaryInFlight;
    this.binaryInFlight = this.downloadBinary(signal).finally(() => {
      this.binaryInFlight = null;
    });
    return this.binaryInFlight;
  }

  public async ensureModel(
    modelId: WhisperModelId,
    opts?: { signal?: AbortSignal }
  ): Promise<string> {
    const id = coerceWhisperModelId(modelId);
    if (opts?.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (await this.isModelCached(id)) {
      return this.getModelPath(id);
    }
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const work = this.downloadModel(id, opts?.signal);
    this.inFlight.set(id, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(id);
    }
  }

  private trySeedFromBundle(): string | null {
    try {
      const platform =
        process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
      const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
      const candidates = [
        path.join(process.resourcesPath || '', 'bin', name),
        path.join(app.getAppPath(), 'bin', platform, name),
        path.join(process.cwd(), 'bin', platform, name)
      ];
      for (const src of candidates) {
        if (!fs.existsSync(src)) continue;
        const size = fs.statSync(src).size;
        if (size < 100_000) continue;
        const dest = this.getBinPath();
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        // Bundle may also ship sibling DLLs / shared libs next to the exe.
        this.copyRuntimeLibraries(path.dirname(src), path.dirname(dest));
        this.ensureExecutable(dest);
        if (!this.isBinaryInstallHealthy(dest)) {
          this.logger.warn(
            'WhisperCppManager',
            'Bundled whisper-cli failed health probe — falling through to download'
          );
          this.removeBrokenBinaryInstall(dest);
          continue;
        }
        this.logger.info('WhisperCppManager', 'Seeded whisper-cli from bundle', { src, dest });
        return dest;
      }
    } catch (err) {
      this.logger.debug('WhisperCppManager', 'Bundle seed skipped', err);
    }
    return null;
  }

  private async downloadBinary(signal?: AbortSignal): Promise<string> {
    const dest = this.getBinPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const asset = this.selectBinaryAsset();
    if (!asset) {
      throw new Error(
        'No prebuilt whisper-cli asset for this platform. Place whisper-cli under userData/bin or bin/<platform>/.'
      );
    }
    this.logger.info('WhisperCppManager', `Downloading whisper-cli from ${asset.url}`);
    const zipPath = path.join(this.getBinDir(), `whisper-cli.download.${Date.now()}.zip`);
    await this.downloadUrlToFile(asset.url, zipPath, signal);
    try {
      // Prefer unzip via system; fallback: if asset is raw binary, rename.
      if (asset.url.endsWith('.zip') || zipPath.endsWith('.zip')) {
        await this.extractBinaryFromZip(zipPath, dest, asset.memberHint);
      } else {
        fs.renameSync(zipPath, dest);
      }
      this.ensureExecutable(dest);
      if (process.platform === 'win32' && !this.hasWindowsRuntimeDlls(dest)) {
        throw new Error(
          'Downloaded whisper-cli is missing runtime DLLs (libopenblas / ggml / whisper). Zip extract incomplete.'
        );
      }
      // Probe -h (whisper-cli has no stable --version on all builds).
      // Windows: never mark ready on STATUS_DLL_NOT_FOUND / missing DLLs.
      // Other platforms: keep prior tolerance for large bins that exit oddly on -h.
      const probe = this.probeBinaryHelp(dest);
      if (!probe.ok) {
        const dllFail =
          probe.reason?.includes('STATUS_DLL_NOT_FOUND') ||
          probe.reason?.includes('DLL load') ||
          probe.reason?.includes('runtime DLLs');
        if (process.platform === 'win32' || dllFail || fs.statSync(dest).size < 100_000) {
          throw new Error(
            `Downloaded whisper-cli failed execution probe${probe.reason ? `: ${probe.reason}` : ''}`
          );
        }
        this.logger.warn(
          'WhisperCppManager',
          `whisper-cli -h probe inconclusive (${probe.reason}); accepting large binary`
        );
      }
      this.logger.info('WhisperCppManager', 'whisper-cli ready', { dest });
      return dest;
    } finally {
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
    }
  }

  private selectBinaryAsset(): { url: string; memberHint: string } | null {
    // Official whisper.cpp Windows x64 zip (contains whisper-cli.exe).
    // macOS/Linux: no guaranteed official zip in every release — rely on seed/PATH,
    // but try known release assets when present.
    const tag = 'v1.7.6';
    const base = `https://github.com/ggerganov/whisper.cpp/releases/download/${tag}`;
    if (process.platform === 'win32') {
      return {
        url: `${base}/whisper-blas-bin-x64.zip`,
        memberHint: 'whisper-cli.exe'
      };
    }
    // Community-friendly fallback: try platform-tagged assets if maintainers attach them.
    // When missing, ensureBinary throws and UI shows honesty message.
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      return {
        url: `${base}/whisper-macos-arm64.zip`,
        memberHint: 'whisper-cli'
      };
    }
    if (process.platform === 'linux' && process.arch === 'x64') {
      return {
        url: `${base}/whisper-linux-x64.zip`,
        memberHint: 'whisper-cli'
      };
    }
    return null;
  }

  private async extractBinaryFromZip(
    zipPath: string,
    destPath: string,
    memberHint: string
  ): Promise<void> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const extractDir = `${zipPath}.extract`;
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      if (process.platform === 'win32') {
        await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
          ],
          { timeout: 120000 }
        );
      } else {
        await execFileAsync('unzip', ['-o', zipPath, '-d', extractDir], { timeout: 120000 });
      }
      const found = this.findFileRecursive(extractDir, memberHint);
      if (!found) {
        throw new Error(`whisper-cli binary (${memberHint}) not found inside downloaded zip`);
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(found, destPath);
      // Windows whisper-blas zip: Release/ holds whisper-cli.exe + required DLLs.
      // Copy all runtime shared libraries from the exe's folder next to dest.
      this.copyRuntimeLibraries(path.dirname(found), path.dirname(destPath));
    } finally {
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Copy runtime shared libraries that must sit next to whisper-cli
   * (Windows .dll from Release/; also .so / .dylib when present).
   */
  private copyRuntimeLibraries(srcDir: string, destDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(srcDir, { withFileTypes: true });
    } catch {
      return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    let copied = 0;
    for (const e of entries) {
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (!(lower.endsWith('.dll') || lower.endsWith('.so') || lower.endsWith('.dylib'))) {
        continue;
      }
      const src = path.join(srcDir, e.name);
      const dest = path.join(destDir, e.name);
      fs.copyFileSync(src, dest);
      copied += 1;
    }
    if (copied > 0) {
      this.logger.info('WhisperCppManager', `Copied ${copied} whisper runtime librar${copied === 1 ? 'y' : 'ies'}`, {
        srcDir,
        destDir
      });
    }
  }

  /** True when at least one known whisper.cpp Windows runtime DLL sits beside the exe. */
  private hasWindowsRuntimeDlls(binPath: string): boolean {
    const dir = path.dirname(binPath);
    const markers = ['libopenblas.dll', 'whisper.dll', 'ggml.dll'];
    return markers.some((name) => fs.existsSync(path.join(dir, name)));
  }

  private static isDllNotFoundExit(status: unknown): boolean {
    const n = typeof status === 'number' ? status : Number(status);
    if (!Number.isFinite(n)) return false;
    return n === WIN_STATUS_DLL_NOT_FOUND_U || n === WIN_STATUS_DLL_NOT_FOUND_S;
  }

  /**
   * Run whisper-cli -h. Accept success or non-zero exit that still prints usage.
   * Reject STATUS_DLL_NOT_FOUND / missing-DLL failures even when the exe is large.
   */
  private probeBinaryHelp(binPath: string): { ok: boolean; reason?: string } {
    try {
      execFileSync(binPath, ['-h'], {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return { ok: true };
    } catch (err) {
      const e = err as {
        status?: number;
        code?: string | number;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        message?: string;
      };
      const status = e?.status ?? (typeof e?.code === 'number' ? e.code : undefined);
      if (WhisperCppManager.isDllNotFoundExit(status)) {
        return {
          ok: false,
          reason: 'STATUS_DLL_NOT_FOUND (whisper runtime DLLs missing next to whisper-cli.exe)'
        };
      }
      const stdout = String(e?.stdout ?? '');
      const stderr = String(e?.stderr ?? '');
      const combined = `${stdout}\n${stderr}\n${e?.message ?? ''}`.toLowerCase();
      if (
        /status_dll_not_found|c0000135|3221225781|dll was not found|missing.*\.dll/.test(combined)
      ) {
        return { ok: false, reason: 'DLL load failure during whisper-cli probe' };
      }
      // Some builds exit non-zero on -h but still print usage — treat as success.
      if (/usage:|whisper|options:|\s-m\s|model/.test(combined)) {
        return { ok: true };
      }
      if (fs.existsSync(binPath) && fs.statSync(binPath).size < 100_000) {
        return { ok: false, reason: 'binary too small after probe failure' };
      }
      return { ok: false, reason: 'execution probe failed without usage output' };
    }
  }

  /**
   * Cached install health. Non-Windows: size floor (unchanged).
   * Windows: require sibling runtime DLLs + successful -h probe so exe-only
   * installs from older app versions are force-repaired.
   */
  private isBinaryInstallHealthy(binPath: string): boolean {
    try {
      if (!fs.existsSync(binPath) || fs.statSync(binPath).size <= 100_000) return false;
      if (process.platform !== 'win32') return true;
      if (!this.hasWindowsRuntimeDlls(binPath)) {
        this.logger.warn(
          'WhisperCppManager',
          'whisper-cli present but runtime DLLs missing — will reinstall'
        );
        return false;
      }
      const probe = this.probeBinaryHelp(binPath);
      if (!probe.ok) {
        this.logger.warn(
          'WhisperCppManager',
          `whisper-cli probe failed (${probe.reason}) — will reinstall`
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn('WhisperCppManager', 'whisper-cli health check error — will reinstall', err);
      return false;
    }
  }

  /** Remove broken whisper-cli (+ known Windows runtime DLLs) so ensureBinary can re-fetch. */
  private removeBrokenBinaryInstall(binPath: string): void {
    const dir = path.dirname(binPath);
    try {
      if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
    } catch (err) {
      this.logger.warn('WhisperCppManager', `Failed to delete broken binary ${binPath}`, err);
    }
    if (process.platform === 'win32') {
      try {
        for (const name of fs.readdirSync(dir)) {
          const lower = name.toLowerCase();
          if (!lower.endsWith('.dll')) continue;
          if (
            lower === 'libopenblas.dll' ||
            lower === 'whisper.dll' ||
            lower.startsWith('ggml') ||
            lower.startsWith('whisper')
          ) {
            try {
              fs.unlinkSync(path.join(dir, name));
            } catch {
              /* ignore locked files */
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    this.logger.info('WhisperCppManager', 'Removed broken whisper-cli install for repair', {
      binPath
    });
  }

  private findFileRecursive(dir: string, name: string): string | null {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === name) return full;
      if (e.isDirectory()) {
        const nested = this.findFileRecursive(full, name);
        if (nested) return nested;
      }
    }
    // Case-insensitive fallback
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return full;
    }
    return null;
  }

  private ensureExecutable(filePath: string): void {
    if (process.platform === 'win32') return;
    try {
      fs.chmodSync(filePath, 0o755);
    } catch {
      /* ignore */
    }
    if (process.platform === 'darwin') {
      try {
        execFileSync('xattr', ['-dr', 'com.apple.quarantine', filePath], {
          stdio: 'ignore',
          timeout: 5000
        });
      } catch {
        /* ignore */
      }
    }
  }

  private writeInstallMeta(modelId: WhisperModelId, size: number): void {
    const catalog = WHISPER_MODELS[modelId];
    const payload: ModelInstallMeta = {
      id: modelId,
      url: catalog.url,
      size,
      installedAt: new Date().toISOString()
    };
    fs.writeFileSync(this.getInstallMetaPath(modelId), JSON.stringify(payload, null, 2), 'utf8');
  }

  private emitProgress(progress: WhisperModelDownloadProgress): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('whisper-stt:model-progress', progress);
      } catch {
        /* ignore closed windows */
      }
    }
  }

  private async downloadModel(modelId: WhisperModelId, signal?: AbortSignal): Promise<string> {
    const meta = WHISPER_MODELS[modelId];
    const modelPath = this.getModelPath(modelId);
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    const tempPath = `${modelPath}.download`;
    this.logger.info('WhisperCppManager', `Downloading ${modelId} → ${modelPath}`);
    this.emitProgress({
      modelId,
      phase: 'download',
      loaded: 0,
      total: meta.approxBytes,
      message: `Downloading Whisper ${modelId}…`
    });

    await this.downloadUrlToFile(meta.url, tempPath, signal, (loaded, total) => {
      this.emitProgress({
        modelId,
        phase: 'download',
        loaded,
        total: total || meta.approxBytes,
        message:
          total > 0
            ? `Downloading Whisper ${modelId}… ${Math.round((loaded / total) * 100)}%`
            : `Downloading Whisper ${modelId}… ${Math.round(loaded / (1024 * 1024))} MB`
      });
    });

    const size = fs.statSync(tempPath).size;
    if (size < meta.minBytes) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
      const err = new Error(
        `Downloaded Whisper ${modelId} is too small (${size} bytes) — integrity check failed`
      );
      this.emitProgress({ modelId, phase: 'error', loaded: size, total: size, message: err.message });
      throw err;
    }

    this.emitProgress({
      modelId,
      phase: 'verify',
      loaded: size,
      total: size,
      message: `Verifying Whisper ${modelId}…`
    });
    fs.renameSync(tempPath, modelPath);
    this.writeInstallMeta(modelId, size);
    this.emitProgress({
      modelId,
      phase: 'ready',
      loaded: size,
      total: size,
      message: `Whisper ${modelId} ready`
    });
    this.logger.info('WhisperCppManager', `${modelId} ready (${size} bytes)`, { modelPath });
    return modelPath;
  }

  private async downloadUrlToFile(
    url: string,
    destPath: string,
    signal?: AbortSignal,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      const request = net.request(url);
      const writeStream = fs.createWriteStream(destPath);
      let settled = false;
      let loaded = 0;
      let total = 0;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        try {
          request.abort();
        } catch {
          /* ignore */
        }
        try {
          writeStream.close();
        } catch {
          /* ignore */
        }
        try {
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        reject(err);
      };

      const onAbort = () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        fail(err);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      request.on('response', (response) => {
        const status = response.statusCode || 0;
        // Follow one redirect manually if needed (HF often 302)
        if (status >= 300 && status < 400) {
          const locHeader = response.headers['location'];
          const loc = Array.isArray(locHeader) ? locHeader[0] : locHeader;
          if (loc) {
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            try {
              writeStream.close();
            } catch {
              /* ignore */
            }
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            } catch {
              /* ignore */
            }
            void this.downloadUrlToFile(String(loc), destPath, signal, onProgress).then(
              resolve,
              reject
            );
            return;
          }
        }
        if (status >= 400) {
          fail(new Error(`Download failed with HTTP ${status}`));
          return;
        }
        const lenHeader = response.headers['content-length'];
        const lenRaw = Array.isArray(lenHeader) ? lenHeader[0] : lenHeader;
        total = lenRaw ? parseInt(String(lenRaw), 10) || 0 : 0;

        response.on('data', (chunk: Buffer) => {
          if (settled) return;
          loaded += chunk.length;
          writeStream.write(chunk);
          onProgress?.(loaded, total);
        });

        response.on('end', () => {
          writeStream.end(() => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            resolve();
          });
        });
        response.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
      });
      request.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
      request.end();
    });
  }

  /** Exposed for tests — hash helper unused in v1 (size floor only) but kept for future SHA. */
  public async hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}

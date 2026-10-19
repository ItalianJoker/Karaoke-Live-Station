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
  type WhisperCliBackend,
  coerceWhisperModelId,
  coerceWhisperCliBackend
} from '../../shared/whisperStt';

type ModelInstallMeta = {
  id: WhisperModelId;
  url: string;
  size: number;
  installedAt: string;
};

type WhisperBackendMeta = {
  backend: WhisperCliBackend;
  installedAt: string;
  url: string;
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
  /** Dedup concurrent ensureBinary for the same backend key. */
  private binaryInFlight: Map<WhisperCliBackend, Promise<string>> = new Map();

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

  private getBackendMetaPath(): string {
    return path.join(this.getBinDir(), '.whisper-backend.json');
  }

  private readBackendMeta(): WhisperBackendMeta | null {
    try {
      const p = this.getBackendMetaPath();
      if (!fs.existsSync(p)) return null;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as WhisperBackendMeta;
      if (!raw || typeof raw !== 'object') return null;
      return {
        backend: coerceWhisperCliBackend(raw.backend),
        installedAt: String(raw.installedAt || ''),
        url: String(raw.url || '')
      };
    } catch {
      return null;
    }
  }

  private writeBackendMeta(backend: WhisperCliBackend, url: string): void {
    const payload: WhisperBackendMeta = {
      backend,
      url,
      installedAt: new Date().toISOString()
    };
    fs.mkdirSync(this.getBinDir(), { recursive: true });
    fs.writeFileSync(this.getBackendMetaPath(), JSON.stringify(payload, null, 2), 'utf8');
  }

  /** Effective installed whisper-cli backend (marker), if any. */
  public getInstalledBackend(): WhisperCliBackend | null {
    return this.readBackendMeta()?.backend ?? null;
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
   * Ensure whisper-cli exists under userData/bin for the requested backend.
   * Prefer existing managed binary when healthy + backend marker matches;
   * optionally seed from bundled `bin/<platform>/` (CPU/BLAS only);
   * otherwise download platform zip from whisper.cpp GitHub releases.
   *
   * Broken Windows installs (exe without runtime DLLs / STATUS_DLL_NOT_FOUND probe)
   * are removed and re-fetched so upgrades repair without manual delete.
   * Switching Settings GPU preference (BLAS ↔ cuBLAS) also reinstalls.
   */
  public async ensureBinary(
    signal?: AbortSignal,
    preferredBackend: WhisperCliBackend = 'blas'
  ): Promise<string> {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    const backend = coerceWhisperCliBackend(preferredBackend);
    const target = this.getBinPath();
    const installed = this.readBackendMeta()?.backend;

    if (fs.existsSync(target)) {
      try {
        // CUDA zip without cublas64_11.dll looks “DLL-present” but cannot load — repair companion first.
        if (
          process.platform === 'win32' &&
          backend === 'cublas-11.8' &&
          installed === 'cublas-11.8' &&
          this.hasWindowsRuntimeDlls(target) &&
          !this.hasWindowsCublasCompanionDll(target)
        ) {
          this.logger.warn(
            'WhisperCppManager',
            'CUDA whisper-cli missing cublas64_11.dll companion — repairing without full reinstall'
          );
          try {
            await this.ensureWindowsCublasCompanion(target, signal);
          } catch (err) {
            this.logger.warn(
              'WhisperCppManager',
              `cublas companion repair failed — will reinstall CUDA zip (${
                err instanceof Error ? err.message : String(err)
              })`
            );
          }
        }
        const healthy = fs.statSync(target).size > 100_000 && this.isBinaryInstallHealthy(target);
        // Unmarked installs (pre-backend-marker) are treated as blas.
        const markerOk = installed ? installed === backend : backend === 'blas';
        if (healthy && markerOk) {
          this.ensureExecutable(target);
          if (!installed) this.writeBackendMeta('blas', 'legacy-or-seed');
          return target;
        }
        if (healthy && !markerOk) {
          this.logger.info('WhisperCppManager', 'whisper-cli backend mismatch — reinstalling', {
            installed: installed || 'unmarked',
            requested: backend
          });
        }
      } catch {
        /* fall through to repair */
      }
      this.removeBrokenBinaryInstall(target);
    }

    // Bundle seed is CPU-oriented — only for blas requests.
    if (backend === 'blas') {
      const seeded = this.trySeedFromBundle();
      if (seeded) {
        this.writeBackendMeta('blas', 'bundle-seed');
        return seeded;
      }
    }

    const existing = this.binaryInFlight.get(backend);
    if (existing) return existing;
    const work = this.downloadBinary(signal, backend)
      .catch(async (err) => {
        // CUDA zip missing / probe fail → soft-fallback to BLAS so STT can still run.
        if (backend === 'cublas-11.8') {
          this.logger.warn(
            'WhisperCppManager',
            `CUDA whisper-cli unavailable — falling back to CPU BLAS (${
              err instanceof Error ? err.message : String(err)
            })`
          );
          this.removeBrokenBinaryInstall(this.getBinPath());
          return this.ensureBinary(signal, 'blas');
        }
        throw err;
      })
      .finally(() => {
        this.binaryInFlight.delete(backend);
      });
    this.binaryInFlight.set(backend, work);
    return work;
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

  private async downloadBinary(
    signal: AbortSignal | undefined,
    backend: WhisperCliBackend
  ): Promise<string> {
    const dest = this.getBinPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const asset = this.selectBinaryAsset(backend);
    if (!asset) {
      throw new Error(
        'No prebuilt whisper-cli asset for this platform. Place whisper-cli under userData/bin or bin/<platform>/.'
      );
    }
    this.logger.info('WhisperCppManager', `Downloading whisper-cli (${backend}) from ${asset.url}`);
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
      // Official whisper-cublas-11.8 zip ships cudart + ggml-cuda but omits cublas64_11.dll
      // (hard import of ggml-cuda.dll). Without it, -h exits STATUS_DLL_NOT_FOUND and we
      // soft-fell back to BLAS — STT never used GPU. Fetch/copy the companion before probe.
      if (process.platform === 'win32' && backend === 'cublas-11.8') {
        await this.ensureWindowsCublasCompanion(dest, signal);
      }
      if (process.platform === 'win32' && !this.hasWindowsRuntimeDlls(dest)) {
        throw new Error(
          'Downloaded whisper-cli is missing runtime DLLs (OpenBLAS / CUDA / ggml / whisper). Zip extract incomplete.'
        );
      }
      if (
        process.platform === 'win32' &&
        backend === 'cublas-11.8' &&
        !this.hasWindowsCublasCompanionDll(dest)
      ) {
        throw new Error(
          'CUDA whisper-cli is missing cublas64_11.dll (required by ggml-cuda.dll) — cannot enable GPU STT'
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
      this.writeBackendMeta(backend, asset.url);
      this.logger.info('WhisperCppManager', 'whisper-cli ready', { dest, backend });
      return dest;
    } finally {
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
    }
  }

  private selectBinaryAsset(
    backend: WhisperCliBackend
  ): { url: string; memberHint: string; backend: WhisperCliBackend } | null {
    // Official whisper.cpp release assets (v1.7.6).
    // Win: BLAS (CPU) or cuBLAS 11.8 (NVIDIA CUDA). cuBLAS 12.4 zip is ~443 MB — not default.
    // macOS/Linux: no official CUDA/Vulkan desktop zip here — seed/PATH / platform-tagged try.
    // Use ggml-org (canonical) — ggerganov URLs 301-redirect here.
    const tag = 'v1.7.6';
    const base = `https://github.com/ggml-org/whisper.cpp/releases/download/${tag}`;
    if (process.platform === 'win32') {
      if (backend === 'cublas-11.8') {
        return {
          url: `${base}/whisper-cublas-11.8.0-bin-x64.zip`,
          memberHint: 'whisper-cli.exe',
          backend: 'cublas-11.8'
        };
      }
      return {
        url: `${base}/whisper-blas-bin-x64.zip`,
        memberHint: 'whisper-cli.exe',
        backend: 'blas'
      };
    }
    // Non-Windows: only blas/CPU assets (cuBLAS zip is Win/NVIDIA-only).
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      return {
        url: `${base}/whisper-macos-arm64.zip`,
        memberHint: 'whisper-cli',
        backend: 'blas'
      };
    }
    if (process.platform === 'linux' && process.arch === 'x64') {
      return {
        url: `${base}/whisper-linux-x64.zip`,
        memberHint: 'whisper-cli',
        backend: 'blas'
      };
    }
    return null;
  }

  private async extractBinaryFromZip(
    zipPath: string,
    destPath: string,
    memberHint: string
  ): Promise<void> {
    const extractDir = `${zipPath}.extract`;
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      await this.extractZipArchive(zipPath, extractDir);
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

  /**
   * True when at least one known whisper.cpp Windows runtime DLL sits beside the exe.
   * Covers BLAS (libopenblas) and CUDA (cudart / cublas) official zips — #91 packaging.
   */
  private hasWindowsRuntimeDlls(binPath: string): boolean {
    const dir = path.dirname(binPath);
    const exact = ['libopenblas.dll', 'whisper.dll', 'ggml.dll', 'ggml-cuda.dll'];
    if (exact.some((name) => fs.existsSync(path.join(dir, name)))) return true;
    try {
      for (const name of fs.readdirSync(dir)) {
        const lower = name.toLowerCase();
        if (
          lower.startsWith('cudart') ||
          lower.startsWith('cublas') ||
          lower.startsWith('ggml') ||
          lower === 'whisper.dll'
        ) {
          if (lower.endsWith('.dll')) return true;
        }
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /** ggml-cuda.dll hard-imports cublas64_11.dll — required for CUDA whisper-cli to load. */
  private hasWindowsCublasCompanionDll(binPath: string): boolean {
    return fs.existsSync(path.join(path.dirname(binPath), 'cublas64_11.dll'));
  }

  /**
   * Ensure cublas64_11.dll sits next to whisper-cli.exe for the CUDA zip.
   * Upstream whisper-cublas-11.8.0-bin-x64.zip omits it; without the companion,
   * Windows fails process load (STATUS_DLL_NOT_FOUND) and we incorrectly fell back to BLAS.
   */
  private async ensureWindowsCublasCompanion(
    binPath: string,
    signal?: AbortSignal
  ): Promise<void> {
    const destDir = path.dirname(binPath);
    const destDll = path.join(destDir, 'cublas64_11.dll');
    if (fs.existsSync(destDll) && fs.statSync(destDll).size > 1_000_000) {
      return;
    }

    const fromSystem = this.findSystemCublas64_11();
    if (fromSystem) {
      fs.copyFileSync(fromSystem, destDll);
      this.logger.info('WhisperCppManager', 'Copied system cublas64_11.dll beside whisper-cli', {
        fromSystem,
        destDll
      });
      return;
    }

    // NVIDIA CUDA redistributable DLL via NuGet native runtime package (~62 MB).
    // Package metadata is MIT; the native DLL remains NVIDIA CUDA redistributable.
    const nupkgUrl =
      'https://api.nuget.org/v3-flatcontainer/ntvlibs.cuda11.cublas64_11.runtime.win-x64/11.8.0/ntvlibs.cuda11.cublas64_11.runtime.win-x64.11.8.0.nupkg';
    // Use .zip suffix so Windows Expand-Archive accepts the NuGet package (ZIP container).
    const nupkgPath = path.join(this.getBinDir(), `cublas64_11.download.${Date.now()}.zip`);
    this.logger.info(
      'WhisperCppManager',
      'Fetching cublas64_11.dll companion (missing from official whisper CUDA zip)',
      { nupkgUrl }
    );
    await this.downloadUrlToFile(nupkgUrl, nupkgPath, signal);
    const extractDir = `${nupkgPath}.extract`;
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      await this.extractZipArchive(nupkgPath, extractDir);
      const found = this.findFileRecursive(extractDir, 'cublas64_11.dll');
      if (!found) {
        throw new Error('cublas64_11.dll not found inside CUDA companion package');
      }
      fs.copyFileSync(found, destDll);
      this.logger.info('WhisperCppManager', 'Installed cublas64_11.dll companion', {
        destDll,
        bytes: fs.statSync(destDll).size
      });
    } finally {
      try {
        if (fs.existsSync(nupkgPath)) fs.unlinkSync(nupkgPath);
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  /** Best-effort locate cublas64_11.dll from a local CUDA Toolkit install. */
  private findSystemCublas64_11(): string | null {
    const candidates: string[] = [];
    const pushBin = (root: string | undefined | null) => {
      if (!root) return;
      candidates.push(path.join(root, 'bin', 'cublas64_11.dll'));
      candidates.push(path.join(root, 'cublas64_11.dll'));
    };
    pushBin(process.env.CUDA_PATH);
    pushBin(process.env.CUDA_PATH_V11_8);
    pushBin(process.env.CUDA_PATH_V11_7);
    pushBin(process.env.CUDA_PATH_V11_6);
    const toolkitRoot = 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA';
    try {
      if (fs.existsSync(toolkitRoot)) {
        for (const ent of fs.readdirSync(toolkitRoot, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue;
          if (!/^v11/i.test(ent.name)) continue;
          pushBin(path.join(toolkitRoot, ent.name));
        }
      }
    } catch {
      /* ignore */
    }
    // Also scan PATH entries for a loose DLL (rare).
    const pathEnv = process.env.PATH || '';
    for (const part of pathEnv.split(';')) {
      if (!part) continue;
      candidates.push(path.join(part, 'cublas64_11.dll'));
    }
    for (const p of candidates) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).size > 1_000_000) return p;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  /** Expand a zip/nupkg into extractDir (Windows Expand-Archive / unzip). */
  private async extractZipArchive(zipPath: string, extractDir: string): Promise<void> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    fs.mkdirSync(extractDir, { recursive: true });
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
        ],
        { timeout: 180000 }
      );
    } else {
      await execFileAsync('unzip', ['-o', zipPath, '-d', extractDir], { timeout: 180000 });
    }
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
      // CUDA stack without cublas64_11.dll cannot load (ggml.dll → ggml-cuda → cublas).
      const dir = path.dirname(binPath);
      const hasCudaStack =
        fs.existsSync(path.join(dir, 'ggml-cuda.dll')) ||
        fs.existsSync(path.join(dir, 'cudart64_110.dll'));
      if (hasCudaStack && !this.hasWindowsCublasCompanionDll(binPath)) {
        this.logger.warn(
          'WhisperCppManager',
          'CUDA whisper-cli present but cublas64_11.dll missing — will repair/reinstall'
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
    try {
      const meta = this.getBackendMetaPath();
      if (fs.existsSync(meta)) fs.unlinkSync(meta);
    } catch {
      /* ignore */
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
            lower.startsWith('whisper') ||
            lower.startsWith('cudart') ||
            lower.startsWith('cublas') ||
            lower.startsWith('cufft') ||
            lower.startsWith('cuda')
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

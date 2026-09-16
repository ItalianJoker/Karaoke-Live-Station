import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app, net, BrowserWindow } from 'electron';
import { Logger } from './Logger';
import {
  OFFLINE_VOCAL_MODELS,
  type OfflineVocalModelId,
  type VocalModelDownloadProgress
} from '../../shared/vocalRemover';

type ModelInstallMeta = {
  id: OfflineVocalModelId;
  url: string;
  sha256?: string;
  /** Catalog revision when installed; missing means pre-version sidecar. */
  version?: string;
  size: number;
  installedAt: string;
};

/**
 * Downloads and caches offline vocal-separator ONNX models under `<userData>/models/`.
 *
 * Lifecycle (same rule as managed libraries under userData):
 * - Download only when missing, corrupt (size/SHA), or catalog URL/SHA is newer than the sidecar
 * - Staging file is a sibling under userData (`*.download`), never OS temp as final home
 * - Progress is broadcast to renderer windows for toast / Settings UI
 */
export class OfflineVocalModelManager {
  private readonly logger: Logger;
  private readonly inFlight = new Map<OfflineVocalModelId, Promise<string>>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Absolute directory for all offline vocal models. */
  public getModelsDir(): string {
    return path.join(app.getPath('userData'), 'models');
  }

  public getModelPath(modelId: OfflineVocalModelId): string {
    const meta = OFFLINE_VOCAL_MODELS[modelId];
    return path.join(this.getModelsDir(), meta.filename);
  }

  private getInstallMetaPath(modelId: OfflineVocalModelId): string {
    return `${this.getModelPath(modelId)}.meta.json`;
  }

  private readInstallMeta(modelId: OfflineVocalModelId): ModelInstallMeta | null {
    try {
      const p = this.getInstallMetaPath(modelId);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8')) as ModelInstallMeta;
    } catch {
      return null;
    }
  }

  private writeInstallMeta(modelId: OfflineVocalModelId, size: number): void {
    const catalog = OFFLINE_VOCAL_MODELS[modelId];
    const payload: ModelInstallMeta = {
      id: modelId,
      url: catalog.url,
      sha256: catalog.sha256,
      version: catalog.version,
      size,
      installedAt: new Date().toISOString()
    };
    fs.writeFileSync(this.getInstallMetaPath(modelId), JSON.stringify(payload, null, 2), 'utf8');
  }

  /**
   * True when the on-disk file passes integrity and matches the current catalog URL/SHA/version.
   * Catalog URL, SHA, or version changes count as "newer remote" and force a re-download.
   * If the local model is already current, ensureModel skips download entirely.
   *
   * Async (streaming hash) so large ONNX files never block the Electron main process.
   */
  public async isModelCached(modelId: OfflineVocalModelId): Promise<boolean> {
    const meta = OFFLINE_VOCAL_MODELS[modelId];
    const modelPath = this.getModelPath(modelId);
    try {
      if (!fs.existsSync(modelPath)) return false;
      const size = (await fs.promises.stat(modelPath)).size;
      if (size < meta.minBytes) return false;
      if (meta.sha256) {
        const hash = await this.hashFile(modelPath);
        if (hash !== meta.sha256) return false;
      }
      const install = this.readInstallMeta(modelId);
      if (install) {
        if (install.url !== meta.url) return false;
        if ((install.sha256 || '') !== (meta.sha256 || '')) return false;
        if ((install.version || '') !== (meta.version || '')) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensures the model file exists on disk (download + integrity when missing/corrupt/outdated).
   * Concurrent callers share one in-flight promise per model id.
   */
  public async ensureModel(modelId: OfflineVocalModelId): Promise<string> {
    if (await this.isModelCached(modelId)) {
      // Backfill sidecar for installs that predate meta.json (no re-download).
      const modelPath = this.getModelPath(modelId);
      if (!this.readInstallMeta(modelId) && fs.existsSync(modelPath)) {
        try {
          this.writeInstallMeta(modelId, (await fs.promises.stat(modelPath)).size);
        } catch {
          /* ignore */
        }
      }
      return modelPath;
    }
    const existing = this.inFlight.get(modelId);
    if (existing) return existing;

    const work = this.downloadModel(modelId);
    this.inFlight.set(modelId, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(modelId);
    }
  }

  /**
   * Reads cached model bytes for IPC transfer (legacy). Prefer karaoke://models/ fetch
   * from the renderer/worker so the main process does not serialize huge buffers on the UI path.
   */
  public async readModelBuffer(modelId: OfflineVocalModelId): Promise<ArrayBuffer> {
    const modelPath = await this.ensureModel(modelId);
    const buffer = await fs.promises.readFile(modelPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  /**
   * Resolve a safe absolute path for karaoke://models/<filename>.
   * Only catalog filenames under userData/models are allowed.
   */
  public resolveServableModel(filename: string): string | null {
    const safe = path.basename(filename);
    if (!safe || safe !== filename.replace(/^\/+/, '')) return null;
    const allowed = Object.values(OFFLINE_VOCAL_MODELS).some((m) => m.filename === safe);
    if (!allowed) return null;
    const modelPath = path.join(this.getModelsDir(), safe);
    if (!fs.existsSync(modelPath)) return null;
    return modelPath;
  }

  /** Durable fetch URL for a cached model (renderer/worker; not OS Temp). */
  public getModelFetchUrl(modelId: OfflineVocalModelId): string {
    const meta = OFFLINE_VOCAL_MODELS[modelId];
    return `karaoke://models/${encodeURIComponent(meta.filename)}`;
  }

  /** Streaming SHA-256 — keeps the main event loop free during large model checks. */
  private hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk: string | Buffer) => {
        hash.update(chunk);
      });
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  private emitProgress(progress: VocalModelDownloadProgress): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('vocal-model:download-progress', progress);
      } catch {
        // ignore closed windows
      }
    }
  }

  private async downloadModel(modelId: OfflineVocalModelId): Promise<string> {
    const meta = OFFLINE_VOCAL_MODELS[modelId];
    const modelPath = this.getModelPath(modelId);
    const modelsDir = path.dirname(modelPath);
    fs.mkdirSync(modelsDir, { recursive: true });

    const tempPath = `${modelPath}.download`;
    this.logger.info('OfflineVocalModelManager', `Downloading ${meta.label} → ${modelPath}`);
    this.emitProgress({
      modelId,
      phase: 'download',
      loaded: 0,
      total: 0,
      message: `Downloading ${meta.label}…`
    });

    await new Promise<void>((resolve, reject) => {
      const request = net.request(meta.url);
      const writeStream = fs.createWriteStream(tempPath);
      let settled = false;
      let loaded = 0;
      let total = 0;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try {
          writeStream.close();
        } catch {
          /* ignore */
        }
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        this.emitProgress({
          modelId,
          phase: 'error',
          loaded,
          total,
          message: err.message
        });
        reject(err);
      };

      request.on('response', (response) => {
        const status = response.statusCode || 0;
        if (status >= 400) {
          fail(new Error(`${meta.label} download failed with HTTP ${status}`));
          return;
        }
        const lenHeader = response.headers['content-length'];
        const lenRaw = Array.isArray(lenHeader) ? lenHeader[0] : lenHeader;
        total = lenRaw ? parseInt(String(lenRaw), 10) || 0 : 0;

        response.on('data', (chunk: Buffer) => {
          loaded += chunk.length;
          writeStream.write(chunk);
          this.emitProgress({
            modelId,
            phase: 'download',
            loaded,
            total,
            message:
              total > 0
                ? `Downloading ${meta.label}… ${Math.round((loaded / total) * 100)}%`
                : `Downloading ${meta.label}… ${Math.round(loaded / (1024 * 1024))} MB`
          });
        });

        response.on('end', () => {
          writeStream.end(() => {
            if (settled) return;
            settled = true;
            try {
              const size = fs.statSync(tempPath).size;
              if (size < meta.minBytes) {
                fs.unlinkSync(tempPath);
                const err = new Error(
                  `Downloaded ${meta.label} is too small (${size} bytes) — integrity check failed`
                );
                this.emitProgress({
                  modelId,
                  phase: 'error',
                  loaded: size,
                  total,
                  message: err.message
                });
                reject(err);
                return;
              }

              this.emitProgress({
                modelId,
                phase: 'verify',
                loaded: size,
                total: size,
                message: `Verifying ${meta.label}…`
              });

              void (async () => {
                try {
                  if (meta.sha256) {
                    const hash = await this.hashFile(tempPath);
                    if (hash !== meta.sha256) {
                      fs.unlinkSync(tempPath);
                      const err = new Error(
                        `${meta.label} SHA-256 mismatch (got ${hash.slice(0, 12)}…)`
                      );
                      this.emitProgress({
                        modelId,
                        phase: 'error',
                        loaded: size,
                        total: size,
                        message: err.message
                      });
                      reject(err);
                      return;
                    }
                  }

                  // Atomic install into userData/models (sibling .download staging — not OS temp).
                  fs.renameSync(tempPath, modelPath);
                  this.writeInstallMeta(modelId, size);
                  this.logger.info(
                    'OfflineVocalModelManager',
                    `${meta.label} ready (${size} bytes) under userData/models`
                  );
                  this.emitProgress({
                    modelId,
                    phase: 'ready',
                    loaded: size,
                    total: size,
                    message: `${meta.label} ready`
                  });
                  resolve();
                } catch (err) {
                  reject(err instanceof Error ? err : new Error(String(err)));
                }
              })();
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        });

        response.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
      });

      request.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
      request.end();
    });

    return modelPath;
  }
}

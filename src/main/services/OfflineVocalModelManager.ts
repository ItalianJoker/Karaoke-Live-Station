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

/**
 * Downloads and caches offline vocal-separator ONNX models under `<userData>/models/`.
 *
 * Lifecycle:
 * - First use of an AI method calls ensureModel(id) → download + size/SHA check
 * - Subsequent launches reuse the cached file (fully offline)
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

  public isModelCached(modelId: OfflineVocalModelId): boolean {
    const meta = OFFLINE_VOCAL_MODELS[modelId];
    const modelPath = this.getModelPath(modelId);
    try {
      if (!fs.existsSync(modelPath)) return false;
      const size = fs.statSync(modelPath).size;
      if (size < meta.minBytes) return false;
      if (meta.sha256) {
        const hash = this.hashFileSync(modelPath);
        return hash === meta.sha256;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensures the model file exists on disk (download + integrity when missing).
   * Concurrent callers share one in-flight promise per model id.
   */
  public async ensureModel(modelId: OfflineVocalModelId): Promise<string> {
    if (this.isModelCached(modelId)) {
      return this.getModelPath(modelId);
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

  /** Reads cached model bytes for IPC transfer to the renderer (ORT session load). */
  public async readModelBuffer(modelId: OfflineVocalModelId): Promise<ArrayBuffer> {
    const modelPath = await this.ensureModel(modelId);
    const buffer = fs.readFileSync(modelPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  private hashFileSync(filePath: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
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

              if (meta.sha256) {
                const hash = this.hashFileSync(tempPath);
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

              fs.renameSync(tempPath, modelPath);
              this.logger.info(
                'OfflineVocalModelManager',
                `${meta.label} ready (${size} bytes)`
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

import fs from 'fs';
import path from 'path';
import { app, net } from 'electron';
import { Logger } from './Logger';

/**
 * Manages the on-disk cache of the HTDemucs ONNX model used by demucs-web.
 *
 * The model (~172 MB, Meta HTDemucs embedded export) is downloaded once from
 * Hugging Face and stored under `<userData>/models/`. Subsequent launches reuse
 * the cached file so vocal removal works offline after the first fetch.
 */
export class DemucsModelManager {
  private static readonly MODEL_FILENAME = 'htdemucs_embedded.onnx';
  /** Must match demucs-web CONSTANTS.DEFAULT_MODEL_URL */
  private static readonly MODEL_URL =
    'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
  /** Minimum plausible model size (~100 MB) to reject truncated downloads. */
  private static readonly MIN_BYTES = 100 * 1024 * 1024;

  private readonly logger: Logger;
  private downloadPromise: Promise<string> | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Absolute path to the cached ONNX model file. */
  public getModelPath(): string {
    return path.join(app.getPath('userData'), 'models', DemucsModelManager.MODEL_FILENAME);
  }

  /** Returns true when a valid cached model file is already present. */
  public isModelCached(): boolean {
    const modelPath = this.getModelPath();
    try {
      if (!fs.existsSync(modelPath)) return false;
      const size = fs.statSync(modelPath).size;
      return size >= DemucsModelManager.MIN_BYTES;
    } catch {
      return false;
    }
  }

  /**
   * Ensures the HTDemucs ONNX model is available on disk, downloading it when missing.
   * Concurrent callers share a single in-flight download promise.
   *
   * @returns Absolute filesystem path of the ready model file
   */
  public async ensureModel(): Promise<string> {
    if (this.isModelCached()) {
      return this.getModelPath();
    }
    if (this.downloadPromise) {
      return this.downloadPromise;
    }
    this.downloadPromise = this.downloadModel();
    try {
      return await this.downloadPromise;
    } finally {
      this.downloadPromise = null;
    }
  }

  /**
   * Reads the cached model into an ArrayBuffer for IPC transfer to the renderer.
   */
  public async readModelBuffer(): Promise<ArrayBuffer> {
    const modelPath = await this.ensureModel();
    const buffer = fs.readFileSync(modelPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  private async downloadModel(): Promise<string> {
    const modelPath = this.getModelPath();
    const modelsDir = path.dirname(modelPath);
    fs.mkdirSync(modelsDir, { recursive: true });

    const tempPath = `${modelPath}.download`;
    this.logger.info('DemucsModelManager', `Downloading HTDemucs ONNX model to ${modelPath}`);

    await new Promise<void>((resolve, reject) => {
      const request = net.request(DemucsModelManager.MODEL_URL);
      const writeStream = fs.createWriteStream(tempPath);
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try {
          writeStream.close();
        } catch {
          // ignore
        }
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
        reject(err);
      };

      request.on('response', (response) => {
        const status = response.statusCode || 0;
        if (status >= 400) {
          fail(new Error(`HTDemucs model download failed with HTTP ${status}`));
          return;
        }
        response.on('data', (chunk: Buffer) => {
          writeStream.write(chunk);
        });
        response.on('end', () => {
          writeStream.end(() => {
            if (settled) return;
            settled = true;
            try {
              const size = fs.statSync(tempPath).size;
              if (size < DemucsModelManager.MIN_BYTES) {
                fs.unlinkSync(tempPath);
                reject(new Error(`Downloaded HTDemucs model is too small (${size} bytes)`));
                return;
              }
              fs.renameSync(tempPath, modelPath);
              this.logger.info('DemucsModelManager', `HTDemucs model ready (${size} bytes)`);
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

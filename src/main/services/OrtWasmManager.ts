import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { Logger } from './Logger';
import {
  ORT_WASM_ASSET_FILES,
  ORT_WASM_CPU_FILES,
  ORT_WASM_MANIFEST_FILENAME,
  type OrtWasmManifest,
  type OrtWasmPathsPayload
} from '../../shared/ortWasm';

/**
 * Seeds ONNX Runtime Web WASM/MJS assets into `<userData>/ort/`.
 *
 * Same durability rule as managed yt-dlp under `<userData>/bin/`:
 * - Copy from packaged `public/ort/` (or dist/ort) only when missing, size-mismatched,
 *   or source is newer than the managed copy.
 * - Never use OS temp as the permanent load path.
 * - Renderer loads via `karaoke://ort/...` (privileged fetch), not file:// Temp blobs.
 */
export class OrtWasmManager {
  private readonly logger: Logger;
  private ensurePromise: Promise<OrtWasmPathsPayload> | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public getOrtDir(): string {
    return path.join(app.getPath('userData'), 'ort');
  }

  public getAssetPath(filename: string): string {
    return path.join(this.getOrtDir(), path.basename(filename));
  }

  /** karaoke:// URLs the renderer passes to ort.env.wasm. */
  public getPathsPayload(): OrtWasmPathsPayload {
    const ortDir = this.getOrtDir();
    return {
      ortDir,
      wasmPathsPrefix: 'karaoke://ort/',
      wasmFilePaths: {
        wasm: `karaoke://ort/${ORT_WASM_CPU_FILES.wasm}`,
        mjs: `karaoke://ort/${ORT_WASM_CPU_FILES.mjs}`
      }
    };
  }

  /**
   * Ensures managed ORT assets exist under userData. Concurrent callers share one promise.
   */
  public async ensureOrtWasm(): Promise<OrtWasmPathsPayload> {
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = this.seedIfNeeded();
    try {
      return await this.ensurePromise;
    } finally {
      this.ensurePromise = null;
    }
  }

  /** Resolve a safe absolute path for a karaoke://ort/<filename> request. */
  public resolveServableAsset(rawName: string): string | null {
    const base = path.basename(decodeURIComponent(rawName || ''));
    if (!base || base !== path.basename(base)) return null;
    if (!ORT_WASM_ASSET_FILES.includes(base) && base !== ORT_WASM_MANIFEST_FILENAME) {
      return null;
    }
    const full = this.getAssetPath(base);
    if (!fs.existsSync(full)) return null;
    return full;
  }

  private listBundledOrtDirs(): string[] {
    const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    return [
      path.join(appPath, 'public', 'ort'),
      path.join(appPath, 'dist', 'ort'),
      process.resourcesPath ? path.join(process.resourcesPath, 'ort') : '',
      path.join(process.cwd(), 'public', 'ort'),
      path.join(process.cwd(), 'dist', 'ort')
    ].filter(Boolean);
  }

  private findSourceDir(): string | null {
    for (const dir of this.listBundledOrtDirs()) {
      try {
        const wasm = path.join(dir, ORT_WASM_CPU_FILES.wasm);
        const mjs = path.join(dir, ORT_WASM_CPU_FILES.mjs);
        if (fs.existsSync(wasm) && fs.existsSync(mjs)) {
          const wasmSize = fs.statSync(wasm).size;
          const mjsSize = fs.statSync(mjs).size;
          if (wasmSize > 1024 * 1024 && mjsSize > 1024) {
            return dir;
          }
        }
      } catch {
        // try next
      }
    }
    return null;
  }

  private readManifest(ortDir: string): OrtWasmManifest | null {
    const manifestPath = path.join(ortDir, ORT_WASM_MANIFEST_FILENAME);
    try {
      if (!fs.existsSync(manifestPath)) return null;
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as OrtWasmManifest;
    } catch {
      return null;
    }
  }

  private writeManifest(ortDir: string, sourceDir: string, files: Record<string, number>): void {
    const manifest: OrtWasmManifest = {
      appVersion: app.getVersion?.() || '0.0.0',
      sourceDir,
      files,
      seededAt: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(ortDir, ORT_WASM_MANIFEST_FILENAME),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
  }

  private needsRefresh(destPath: string, srcPath: string): boolean {
    if (!fs.existsSync(destPath)) return true;
    const destStat = fs.statSync(destPath);
    const srcStat = fs.statSync(srcPath);
    if (destStat.size !== srcStat.size) return true;
    // Source newer (packaged update) → refresh managed copy
    if (srcStat.mtimeMs > destStat.mtimeMs + 1000) return true;
    return false;
  }

  private async seedIfNeeded(): Promise<OrtWasmPathsPayload> {
    const ortDir = this.getOrtDir();
    fs.mkdirSync(ortDir, { recursive: true });

    const sourceDir = this.findSourceDir();
    if (!sourceDir) {
      // Keep whatever is already under userData if CPU pair is intact
      const wasmOk = fs.existsSync(this.getAssetPath(ORT_WASM_CPU_FILES.wasm));
      const mjsOk = fs.existsSync(this.getAssetPath(ORT_WASM_CPU_FILES.mjs));
      if (wasmOk && mjsOk) {
        this.logger.warn(
          'OrtWasmManager',
          'Bundled ORT source missing; reusing existing userData/ort assets'
        );
        return this.getPathsPayload();
      }
      throw new Error(
        'ORT WASM assets not found in package (public/ort) and no usable copy under userData/ort'
      );
    }

    const filesMeta: Record<string, number> = {};
    let copied = 0;
    for (const name of ORT_WASM_ASSET_FILES) {
      const src = path.join(sourceDir, name);
      if (!fs.existsSync(src)) continue;
      const dest = this.getAssetPath(name);
      if (this.needsRefresh(dest, src)) {
        const tmp = `${dest}.seed.${Date.now()}`;
        try {
          fs.copyFileSync(src, tmp);
          fs.renameSync(tmp, dest);
          copied += 1;
          this.logger.info('OrtWasmManager', `Seeded ${name} → ${dest}`);
        } catch (err) {
          try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
          } catch {
            /* ignore */
          }
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
      if (fs.existsSync(dest)) {
        filesMeta[name] = fs.statSync(dest).size;
      }
    }

    const wasmDest = this.getAssetPath(ORT_WASM_CPU_FILES.wasm);
    const mjsDest = this.getAssetPath(ORT_WASM_CPU_FILES.mjs);
    if (!fs.existsSync(wasmDest) || !fs.existsSync(mjsDest)) {
      throw new Error('ORT CPU WASM pair missing after seed (ort-wasm-simd-threaded.{wasm,mjs})');
    }

    const prev = this.readManifest(ortDir);
    if (
      copied > 0 ||
      !prev ||
      prev.sourceDir !== sourceDir ||
      prev.appVersion !== (app.getVersion?.() || '0.0.0')
    ) {
      this.writeManifest(ortDir, sourceDir, filesMeta);
    }

    if (copied === 0) {
      this.logger.info('OrtWasmManager', `ORT WASM ready under ${ortDir} (no refresh needed)`);
    } else {
      this.logger.info('OrtWasmManager', `ORT WASM seeded ${copied} file(s) under ${ortDir}`);
    }

    return this.getPathsPayload();
  }
}

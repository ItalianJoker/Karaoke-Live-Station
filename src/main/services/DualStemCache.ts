/**
 * SHA-256–keyed dual-stem disk cache under userData/dual-stem-cache/<hash>/.
 * Stores stem_instrumental.wav + stem_vocals.wav; no work until vocal remover engages.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import {
  DUAL_STEM_INSTRUMENTAL_FILENAME,
  DUAL_STEM_META_FILENAME,
  DUAL_STEM_VOCALS_FILENAME,
  type DualStemCacheMeta,
  type DualStemLookupResult,
  type DualStemSaveResult
} from '../../shared/dualStem';
import { ensureDir } from './BinaryResolver';
import { resolveLocalMediaPath } from './MediaAudioExtractor';

function getDualStemRoot(): string {
  const base =
    typeof app?.getPath === 'function' ? app.getPath('userData') : path.join(process.cwd(), 'userData');
  return path.join(base, 'dual-stem-cache');
}

function cacheDirForHash(sha256: string): string {
  return path.join(getDualStemRoot(), sha256);
}

function toKaraokeUrl(filePath: string): string {
  return `karaoke://local/${encodeURIComponent(filePath)}`;
}

export async function hashFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function readMeta(dir: string): Promise<DualStemCacheMeta | null> {
  const metaPath = path.join(dir, DUAL_STEM_META_FILENAME);
  try {
    const raw = await fs.promises.readFile(metaPath, 'utf8');
    return JSON.parse(raw) as DualStemCacheMeta;
  } catch {
    return null;
  }
}

function stemsExist(dir: string): boolean {
  try {
    const inst = path.join(dir, DUAL_STEM_INSTRUMENTAL_FILENAME);
    const voc = path.join(dir, DUAL_STEM_VOCALS_FILENAME);
    return (
      fs.existsSync(inst) &&
      fs.existsSync(voc) &&
      fs.statSync(inst).size > 1024 &&
      fs.statSync(voc).size > 1024
    );
  } catch {
    return false;
  }
}

/**
 * Resolve media URL → hash → return cached stem URLs when both WAVs are present.
 */
export async function lookupDualStemCache(mediaUrlOrPath: string): Promise<DualStemLookupResult> {
  const filePath = resolveLocalMediaPath(mediaUrlOrPath);
  if (!filePath || !fs.existsSync(filePath)) {
    return { success: false, error: 'Media file not found for dual-stem cache lookup' };
  }

  try {
    const sha256 = await hashFileSha256(filePath);
    const dir = cacheDirForHash(sha256);
    if (!stemsExist(dir)) {
      return { success: true, hit: false, sha256 };
    }
    const meta = await readMeta(dir);
    return {
      success: true,
      hit: true,
      sha256,
      instrumentalUrl: toKaraokeUrl(path.join(dir, DUAL_STEM_INSTRUMENTAL_FILENAME)),
      vocalsUrl: toKaraokeUrl(path.join(dir, DUAL_STEM_VOCALS_FILENAME)),
      meta: meta || undefined
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Persist PCM WAV stem buffers (already encoded) under the source file’s SHA-256 key.
 */
export async function saveDualStemCache(payload: {
  mediaUrlOrPath: string;
  method: string;
  sampleRate: number;
  instrumentalWav: ArrayBuffer;
  vocalsWav: ArrayBuffer;
}): Promise<DualStemSaveResult> {
  const filePath = resolveLocalMediaPath(payload.mediaUrlOrPath);
  if (!filePath || !fs.existsSync(filePath)) {
    return { success: false, error: 'Media file not found for dual-stem cache save' };
  }

  try {
    const stat = await fs.promises.stat(filePath);
    const sha256 = await hashFileSha256(filePath);
    const dir = cacheDirForHash(sha256);
    ensureDir(dir);

    const instPath = path.join(dir, DUAL_STEM_INSTRUMENTAL_FILENAME);
    const vocPath = path.join(dir, DUAL_STEM_VOCALS_FILENAME);
    const stagingInst = `${instPath}.partial`;
    const stagingVoc = `${vocPath}.partial`;

    await fs.promises.writeFile(stagingInst, Buffer.from(payload.instrumentalWav));
    await fs.promises.writeFile(stagingVoc, Buffer.from(payload.vocalsWav));
    await fs.promises.rename(stagingInst, instPath);
    await fs.promises.rename(stagingVoc, vocPath);

    const meta: DualStemCacheMeta = {
      sourcePath: filePath,
      sourceSize: stat.size,
      sourceMtimeMs: stat.mtimeMs,
      sha256,
      sampleRate: payload.sampleRate,
      method: payload.method,
      createdAt: new Date().toISOString()
    };
    await fs.promises.writeFile(
      path.join(dir, DUAL_STEM_META_FILENAME),
      JSON.stringify(meta, null, 2),
      'utf8'
    );

    return {
      success: true,
      sha256,
      instrumentalUrl: toKaraokeUrl(instPath),
      vocalsUrl: toKaraokeUrl(vocPath)
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

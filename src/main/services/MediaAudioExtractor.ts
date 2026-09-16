/**
 * Extracts a PCM WAV audio track from local media (including video containers)
 * for offline AI vocal separation. decodeAudioData often fails on muxed A/V
 * (mp4/webm/mkv); ffmpeg demuxes the audio stream reliably.
 */
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { ensureDir, resolveFfmpegPath } from './BinaryResolver';

const execFileAsync = promisify(execFile);

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v']);
const AUDIO_EXT = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac',
  '.flac',
  '.opus',
  '.wma'
]);

/** Target PCM for Web Audio decodeAudioData (always supported). */
const EXTRACT_SAMPLE_RATE = 44100;

export function isVideoContainerPath(filePath: string): boolean {
  return VIDEO_EXT.has(path.extname(filePath).toLowerCase());
}

export function isAudioContainerPath(filePath: string): boolean {
  return AUDIO_EXT.has(path.extname(filePath).toLowerCase());
}

/**
 * Resolves karaoke://local/…, file://…, or absolute paths to a filesystem path.
 * Mirrors the karaoke:// protocol handler path normalization.
 */
export function resolveLocalMediaPath(mediaUrlOrPath: string): string | null {
  if (!mediaUrlOrPath) return null;
  try {
    if (/^karaoke:\/\/local/i.test(mediaUrlOrPath)) {
      const url = new URL(mediaUrlOrPath);
      const rawPath = decodeURIComponent(url.pathname);
      let filePath =
        process.platform === 'win32' && rawPath.startsWith('/')
          ? rawPath.slice(1)
          : rawPath;
      // encodeURIComponent(absPath) yields pathname "/%2Fhome%2F…" → "//home/…"
      if (process.platform !== 'win32' && filePath.startsWith('//')) {
        filePath = filePath.slice(1);
      }
      return filePath || null;
    }
    if (/^file:/i.test(mediaUrlOrPath)) {
      return fileURLToPath(mediaUrlOrPath);
    }
    if (path.isAbsolute(mediaUrlOrPath)) {
      return mediaUrlOrPath;
    }
  } catch {
    return null;
  }
  return null;
}

function getExtractCacheDir(): string {
  const base =
    typeof app?.getPath === 'function' ? app.getPath('userData') : path.join(process.cwd(), 'userData');
  return path.join(base, 'vocal-audio-cache');
}

function cacheKeyForSource(filePath: string, stat: fs.Stats): string {
  return crypto
    .createHash('sha256')
    .update(`${filePath}|${stat.size}|${stat.mtimeMs}|${EXTRACT_SAMPLE_RATE}`)
    .digest('hex')
    .slice(0, 40);
}

export type ExtractAudioResult = {
  success: boolean;
  /** karaoke://local/… URL to a PCM WAV suitable for decodeAudioData */
  audioUrl?: string;
  wavPath?: string;
  fromCache?: boolean;
  error?: string;
};

/**
 * Demux/transcode the first audio stream to stereo 44.1 kHz PCM WAV.
 * Cached under userData/vocal-audio-cache; reused when source mtime/size match.
 */
export async function extractAudioWavForSeparation(
  mediaUrlOrPath: string
): Promise<ExtractAudioResult> {
  const filePath = resolveLocalMediaPath(mediaUrlOrPath);
  if (!filePath) {
    return { success: false, error: 'Could not resolve local media path for audio extract' };
  }
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `Media file not found: ${filePath}` };
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }

  const cacheDir = getExtractCacheDir();
  ensureDir(cacheDir);
  const wavPath = path.join(cacheDir, `${cacheKeyForSource(filePath, stat)}.wav`);

  if (fs.existsSync(wavPath)) {
    try {
      const wavStat = await fs.promises.stat(wavPath);
      if (wavStat.size > 1024) {
        return {
          success: true,
          wavPath,
          audioUrl: `karaoke://local/${encodeURIComponent(wavPath)}`,
          fromCache: true
        };
      }
    } catch {
      // Re-extract below
    }
  }

  const ffmpegBin = resolveFfmpegPath();
  const stagingPath = `${wavPath}.partial`;
  try {
    if (fs.existsSync(stagingPath)) {
      await fs.promises.unlink(stagingPath).catch(() => undefined);
    }
    // -vn: drop video; pcm_s16le WAV is universally accepted by decodeAudioData
    await execFileAsync(
      ffmpegBin,
      [
        '-y',
        '-i',
        filePath,
        '-vn',
        '-ac',
        '2',
        '-ar',
        String(EXTRACT_SAMPLE_RATE),
        '-c:a',
        'pcm_s16le',
        '-f',
        'wav',
        stagingPath
      ],
      {
        timeout: 10 * 60 * 1000,
        maxBuffer: 2 * 1024 * 1024
      }
    );
    const staged = await fs.promises.stat(stagingPath);
    if (staged.size < 1024) {
      await fs.promises.unlink(stagingPath).catch(() => undefined);
      return { success: false, error: 'ffmpeg produced an empty audio extract' };
    }
    await fs.promises.rename(stagingPath, wavPath);
    return {
      success: true,
      wavPath,
      audioUrl: `karaoke://local/${encodeURIComponent(wavPath)}`,
      fromCache: false
    };
  } catch (err) {
    await fs.promises.unlink(stagingPath).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `ffmpeg audio extract failed: ${message}`
    };
  }
}

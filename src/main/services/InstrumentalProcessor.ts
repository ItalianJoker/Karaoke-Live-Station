/**
 * Offline algorithmic instrumental pipeline for downloaded videos.
 *
 * 1. Demux audio to PCM WAV via ffmpeg
 * 2. Apply mid/side vocal-reduction filters matching AlgorithmicVocalRemoverNode
 * 3. Remux original video with instrumental audio (optional subtitle burn-in)
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import {
  coerceVocalRemoverMethod,
  type AlgorithmicVocalRemoverMethod
} from '../../shared/vocalRemover';
import { resolveFfmpegPath } from './BinaryResolver';

const execFileAsync = promisify(execFile);

export type InstrumentalProcessPhase =
  | 'extracting'
  | 'removing_vocals'
  | 'remuxing';

export type InstrumentalProcessOptions = {
  inputVideoPath: string;
  outputPath: string;
  algorithm?: string;
  /** Optional .srt / .ass / .vtt for burn-in */
  subtitlePath?: string | null;
  onProgress?: (phase: InstrumentalProcessPhase, percent: number) => void;
};

export type InstrumentalProcessResult = {
  success: boolean;
  outputPath?: string;
  lyricsBurned?: boolean;
  error?: string;
};

/**
 * Builds an ffmpeg filter_complex that mirrors AlgorithmicVocalRemoverNode mid/side DSP.
 * mid = (L+R)/2, side = (L−R)/2; then band-split mid and decode back to stereo.
 */
export function buildAlgorithmicVocalRemoverFilter(
  algorithm: AlgorithmicVocalRemoverMethod
): string {
  let low = 1;
  let high = 0.05;
  let side = 1.15;

  switch (algorithm) {
    case 'centerCancel':
      low = 0;
      high = 0;
      side = 1.25;
      break;
    case 'softMid':
      low = 0.85;
      high = 0.28;
      side = 1.05;
      break;
    case 'centerCancelBassKeep':
    default:
      low = 1;
      high = 0.05;
      side = 1.15;
      break;
  }

  // Input label [0:a] assumed by caller when embedding; here we return a chain from [in] → [out]
  return [
    `[0:a]asplit=2[orig][orig2]`,
    `[orig]pan=mono|c0=0.5*c0+0.5*c1[mid]`,
    `[orig2]pan=mono|c0=0.5*c0-0.5*c1[side]`,
    `[mid]asplit=2[midlo][midhi]`,
    `[midlo]lowpass=f=160,volume=${low}[bass]`,
    `[midhi]highpass=f=160,volume=${high}[vband]`,
    `[bass][vband]amix=inputs=2:normalize=0[midf]`,
    `[side]volume=${side}[sidef]`,
    `[midf][sidef]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[ms]`,
    `[ms]pan=stereo|c0=c0+c1|c1=c0-c1[aout]`
  ].join(';');
}

async function runFfmpeg(args: string[], timeoutMs = 20 * 60 * 1000): Promise<void> {
  const ffmpegBin = resolveFfmpegPath();
  await execFileAsync(ffmpegBin, args, {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024
  });
}

function safeUnlink(filePath: string | undefined | null): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup races
  }
}

/**
 * Finds a subtitle file written next to a yt-dlp download (same basename stem).
 */
export function findSiblingSubtitle(videoPath: string): string | null {
  const dir = path.dirname(videoPath);
  const stem = path.basename(videoPath, path.extname(videoPath));
  try {
    const entries = fs.readdirSync(dir);
    const preferred = entries.find((name) => {
      const lower = name.toLowerCase();
      return (
        name.startsWith(stem) &&
        (lower.endsWith('.srt') || lower.endsWith('.ass') || lower.endsWith('.vtt'))
      );
    });
    return preferred ? path.join(dir, preferred) : null;
  } catch {
    return null;
  }
}

/**
 * Demux → algorithmic vocal remove → remux (optional lyrics burn).
 */
export async function processInstrumentalVideo(
  options: InstrumentalProcessOptions
): Promise<InstrumentalProcessResult> {
  const input = path.resolve(options.inputVideoPath);
  const output = path.resolve(options.outputPath);
  const algorithm = coerceVocalRemoverMethod(options.algorithm);

  if (!fs.existsSync(input)) {
    return { success: false, error: `Input video not found: ${input}` };
  }

  const workDir = path.dirname(output);
  const id = path.basename(output, path.extname(output));
  const extractedWav = path.join(workDir, `${id}.extract.wav`);
  const instrumentalWav = path.join(workDir, `${id}.instrumental.wav`);
  const stagingOut = `${output}.partial.mp4`;

  const report = (phase: InstrumentalProcessPhase, percent: number) => {
    try {
      options.onProgress?.(phase, percent);
    } catch {
      /* ignore listener errors */
    }
  };

  try {
    report('extracting', 5);
    await runFfmpeg([
      '-y',
      '-i',
      input,
      '-vn',
      '-ac',
      '2',
      '-ar',
      '44100',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      extractedWav
    ]);

    report('removing_vocals', 35);
    const filter = buildAlgorithmicVocalRemoverFilter(algorithm);
    await runFfmpeg([
      '-y',
      '-i',
      extractedWav,
      '-filter_complex',
      filter,
      '-map',
      '[aout]',
      '-ac',
      '2',
      '-ar',
      '44100',
      '-c:a',
      'pcm_s16le',
      instrumentalWav
    ]);

    report('remuxing', 70);
    const subtitlePath =
      options.subtitlePath && fs.existsSync(options.subtitlePath)
        ? options.subtitlePath
        : findSiblingSubtitle(input);

    let lyricsBurned = false;
    if (subtitlePath) {
      // Escape path for ffmpeg subtitles filter (Windows + special chars)
      const escapedSub = subtitlePath
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'");
      try {
        await runFfmpeg([
          '-y',
          '-i',
          input,
          '-i',
          instrumentalWav,
          '-vf',
          `subtitles='${escapedSub}'`,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          stagingOut
        ]);
        lyricsBurned = true;
      } catch {
        // Fall back to copy+remux without burn if subtitle filter fails
        lyricsBurned = false;
        await runFfmpeg([
          '-y',
          '-i',
          input,
          '-i',
          instrumentalWav,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          stagingOut
        ]);
      }
    } else {
      await runFfmpeg([
        '-y',
        '-i',
        input,
        '-i',
        instrumentalWav,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '-movflags',
        '+faststart',
        stagingOut
      ]);
    }

    const staged = await fs.promises.stat(stagingOut);
    if (staged.size < 1024) {
      safeUnlink(stagingOut);
      return { success: false, error: 'ffmpeg produced an empty instrumental video' };
    }

    if (fs.existsSync(output)) {
      safeUnlink(output);
    }
    await fs.promises.rename(stagingOut, output);

    report('remuxing', 100);
    return { success: true, outputPath: output, lyricsBurned };
  } catch (err) {
    safeUnlink(stagingOut);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Instrumental processing failed: ${message}` };
  } finally {
    safeUnlink(extractedWav);
    safeUnlink(instrumentalWav);
  }
}

/**
 * Lightweight ZIP Central Directory inspection + extract helpers for karaoke
 * MP3/WAV + CDG archives. No third-party zip dependency (Safety-First footprint).
 *
 * Discovery reads only EOCD + Central Directory (non-blocking for UI when
 * scheduled off the hot path). Extraction inflates entries on demand into
 * `userData/temp/zip_cache/<trackId>/`.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

const AUDIO_EXTS = new Set(['.mp3', '.wav']);
const CDG_EXT = '.cdg';

export type ZipCdgPair = {
  /** Entry path inside the archive (forward slashes) */
  audioEntry: string;
  cdgEntry: string;
  audioExt: '.mp3' | '.wav';
};

export type ZipCentralEntry = {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function readUInt32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function readUInt16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

/**
 * Locate End of Central Directory record (supports archives up to ~65k comment).
 */
function findEocdOffset(buf: Buffer): number {
  const minEocd = 22;
  const maxBack = Math.min(buf.length, 22 + 0xffff);
  for (let i = buf.length - minEocd; i >= buf.length - maxBack; i--) {
    if (readUInt32LE(buf, i) === EOCD_SIG) return i;
  }
  throw new Error('ZIP: End of Central Directory not found');
}

/**
 * Parse Central Directory entries from a full zip buffer or a sliced CD region.
 */
export function parseZipCentralDirectory(zipBuffer: Buffer): ZipCentralEntry[] {
  const eocd = findEocdOffset(zipBuffer);
  const cdSize = readUInt32LE(zipBuffer, eocd + 12);
  const cdOffset = readUInt32LE(zipBuffer, eocd + 16);
  if (cdOffset + cdSize > zipBuffer.length) {
    throw new Error('ZIP: Central Directory extends past end of file');
  }

  const entries: ZipCentralEntry[] = [];
  let off = cdOffset;
  const end = cdOffset + cdSize;
  while (off + 46 <= end) {
    if (readUInt32LE(zipBuffer, off) !== CD_SIG) break;
    const compressionMethod = readUInt16LE(zipBuffer, off + 10);
    const compressedSize = readUInt32LE(zipBuffer, off + 20);
    const uncompressedSize = readUInt32LE(zipBuffer, off + 24);
    const nameLen = readUInt16LE(zipBuffer, off + 28);
    const extraLen = readUInt16LE(zipBuffer, off + 30);
    const commentLen = readUInt16LE(zipBuffer, off + 32);
    const localHeaderOffset = readUInt32LE(zipBuffer, off + 42);
    const nameStart = off + 46;
    const fileName = zipBuffer.slice(nameStart, nameStart + nameLen).toString('utf8');
    entries.push({
      fileName: fileName.replace(/\\/g, '/'),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    off = nameStart + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read only the EOCD tail + Central Directory from disk (avoids loading huge zips).
 */
export function readZipCentralDirectoryFromFile(zipPath: string): ZipCentralEntry[] {
  const st = fs.statSync(zipPath);
  const tailSize = Math.min(st.size, 22 + 0xffff + 65536);
  const fd = fs.openSync(zipPath, 'r');
  try {
    const tail = Buffer.alloc(tailSize);
    fs.readSync(fd, tail, 0, tailSize, st.size - tailSize);
    const eocdRel = findEocdOffset(tail);
    const cdSize = readUInt32LE(tail, eocdRel + 12);
    const cdOffset = readUInt32LE(tail, eocdRel + 16);
    if (cdSize > 64 * 1024 * 1024) {
      throw new Error('ZIP: Central Directory unreasonably large');
    }
    const cdBuf = Buffer.alloc(cdSize);
    fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);
    // Pretend CD starts at 0 for parseZipCentralDirectory by synthesizing a mini buffer
    // with EOCD pointing at offset 0.
    const synthetic = Buffer.alloc(cdSize + 22);
    cdBuf.copy(synthetic, 0);
    synthetic.writeUInt32LE(EOCD_SIG, cdSize);
    synthetic.writeUInt16LE(0, cdSize + 4);
    synthetic.writeUInt16LE(0, cdSize + 6);
    synthetic.writeUInt16LE(0, cdSize + 8);
    synthetic.writeUInt16LE(0, cdSize + 10);
    synthetic.writeUInt32LE(cdSize, cdSize + 12);
    synthetic.writeUInt32LE(0, cdSize + 16);
    synthetic.writeUInt16LE(0, cdSize + 20);
    return parseZipCentralDirectory(synthetic);
  } finally {
    fs.closeSync(fd);
  }
}

function entryBaseName(entryPath: string): string {
  const base = path.posix.basename(entryPath);
  const ext = path.posix.extname(base).toLowerCase();
  return base.slice(0, base.length - ext.length).toLowerCase();
}

function entryExt(entryPath: string): string {
  return path.posix.extname(entryPath).toLowerCase();
}

function isUsefulMediaEntry(fileName: string): boolean {
  if (!fileName || fileName.endsWith('/')) return false;
  const lower = fileName.toLowerCase();
  if (lower.startsWith('__macosx/') || lower.includes('/.')) return false;
  return true;
}

/**
 * Inspect a karaoke ZIP for a playable audio (.mp3/.wav) + .cdg pair.
 * Prefers same-basename companions; falls back to any single audio+cdg pair.
 */
export function inspectZipForCdgPair(zipPath: string): ZipCdgPair | null {
  let entries: ZipCentralEntry[];
  try {
    entries = readZipCentralDirectoryFromFile(zipPath);
  } catch {
    return null;
  }

  const media = entries.filter((e) => isUsefulMediaEntry(e.fileName));
  const audios = media.filter((e) => AUDIO_EXTS.has(entryExt(e.fileName)));
  const cdgs = media.filter((e) => entryExt(e.fileName) === CDG_EXT);
  if (!audios.length || !cdgs.length) return null;

  // Prefer same-basename pairs
  for (const audio of audios) {
    const base = entryBaseName(audio.fileName);
    const match = cdgs.find((c) => entryBaseName(c.fileName) === base);
    if (match) {
      const ext = entryExt(audio.fileName) as '.mp3' | '.wav';
      return { audioEntry: audio.fileName, cdgEntry: match.fileName, audioExt: ext };
    }
  }

  // Fallback: first audio + first cdg (common single-song packs)
  const audio = audios[0];
  const cdg = cdgs[0];
  const ext = entryExt(audio.fileName) as '.mp3' | '.wav';
  return { audioEntry: audio.fileName, cdgEntry: cdg.fileName, audioExt: ext };
}

/**
 * True when path is a .zip that contains a CD+G karaoke pair.
 */
export function isKaraokeCdgZip(zipPath: string): boolean {
  if (path.extname(zipPath).toLowerCase() !== '.zip') return false;
  try {
    const st = fs.statSync(zipPath);
    if (!st.isFile() || st.size < 2048) return false;
  } catch {
    return false;
  }
  return inspectZipForCdgPair(zipPath) != null;
}

/**
 * Extract one Central Directory entry to an absolute output path (STORE or DEFLATE).
 * Sync path kept for analysis / CLI callers; prefer {@link extractZipEntryToFileAsync}
 * on the Electron main play-start path so inflate does not freeze Regia.
 */
export function extractZipEntryToFile(
  zipPath: string,
  entry: ZipCentralEntry,
  outputPath: string
): void {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const lfh = Buffer.alloc(30);
    fs.readSync(fd, lfh, 0, 30, entry.localHeaderOffset);
    if (readUInt32LE(lfh, 0) !== LFH_SIG) {
      throw new Error(`ZIP: bad local header for ${entry.fileName}`);
    }
    const nameLen = readUInt16LE(lfh, 26);
    const extraLen = readUInt16LE(lfh, 28);
    const dataOffset = entry.localHeaderOffset + 30 + nameLen + extraLen;
    const compressed = Buffer.alloc(entry.compressedSize);
    if (entry.compressedSize > 0) {
      fs.readSync(fd, compressed, 0, entry.compressedSize, dataOffset);
    }

    let raw: Buffer;
    if (entry.compressionMethod === 0) {
      raw = compressed;
    } else if (entry.compressionMethod === 8) {
      raw = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`ZIP: unsupported compression method ${entry.compressionMethod}`);
    }

    if (entry.uncompressedSize > 0 && raw.length !== entry.uncompressedSize) {
      // Some writers lie about sizes; accept inflate output when method is DEFLATE
      if (entry.compressionMethod === 0) {
        throw new Error(`ZIP: size mismatch for ${entry.fileName}`);
      }
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, raw);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Async extract — uses zlib.inflateRaw (non-blocking) for DEFLATE entries.
 * Time O(compressed size); frees the Electron main event loop during inflate.
 */
export async function extractZipEntryToFileAsync(
  zipPath: string,
  entry: ZipCentralEntry,
  outputPath: string
): Promise<void> {
  const fh = await fs.promises.open(zipPath, 'r');
  try {
    const lfh = Buffer.alloc(30);
    await fh.read(lfh, 0, 30, entry.localHeaderOffset);
    if (readUInt32LE(lfh, 0) !== LFH_SIG) {
      throw new Error(`ZIP: bad local header for ${entry.fileName}`);
    }
    const nameLen = readUInt16LE(lfh, 26);
    const extraLen = readUInt16LE(lfh, 28);
    const dataOffset = entry.localHeaderOffset + 30 + nameLen + extraLen;
    const compressed = Buffer.alloc(entry.compressedSize);
    if (entry.compressedSize > 0) {
      await fh.read(compressed, 0, entry.compressedSize, dataOffset);
    }

    let raw: Buffer;
    if (entry.compressionMethod === 0) {
      raw = compressed;
    } else if (entry.compressionMethod === 8) {
      raw = await new Promise<Buffer>((resolve, reject) => {
        zlib.inflateRaw(compressed, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    } else {
      throw new Error(`ZIP: unsupported compression method ${entry.compressionMethod}`);
    }

    if (entry.uncompressedSize > 0 && raw.length !== entry.uncompressedSize) {
      if (entry.compressionMethod === 0) {
        throw new Error(`ZIP: size mismatch for ${entry.fileName}`);
      }
    }

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, raw);
  } finally {
    await fh.close();
  }
}

/**
 * Extract the CD+G audio+graphics pair from a zip into `destDir`.
 * Returns absolute paths to the extracted files.
 */
export function extractZipCdgPair(
  zipPath: string,
  destDir: string,
  pair?: ZipCdgPair | null
): { audioPath: string; cdgPath: string; audioExt: '.mp3' | '.wav' } {
  const resolved = pair || inspectZipForCdgPair(zipPath);
  if (!resolved) {
    throw new Error(`ZIP is not a karaoke CD+G archive: ${zipPath}`);
  }
  const entries = readZipCentralDirectoryFromFile(zipPath);
  const audioEntry = entries.find((e) => e.fileName === resolved.audioEntry);
  const cdgEntry = entries.find((e) => e.fileName === resolved.cdgEntry);
  if (!audioEntry || !cdgEntry) {
    throw new Error('ZIP pair entries missing from Central Directory');
  }

  const audioName = `track${resolved.audioExt}`;
  const cdgName = 'track.cdg';
  const audioPath = path.join(destDir, audioName);
  const cdgPath = path.join(destDir, cdgName);

  extractZipEntryToFile(zipPath, audioEntry, audioPath);
  extractZipEntryToFile(zipPath, cdgEntry, cdgPath);

  return { audioPath, cdgPath, audioExt: resolved.audioExt };
}

/**
 * Async CD+G pair extract for ZipCdgCache play-start (non-blocking inflate).
 */
export async function extractZipCdgPairAsync(
  zipPath: string,
  destDir: string,
  pair?: ZipCdgPair | null
): Promise<{ audioPath: string; cdgPath: string; audioExt: '.mp3' | '.wav' }> {
  const resolved = pair || inspectZipForCdgPair(zipPath);
  if (!resolved) {
    throw new Error(`ZIP is not a karaoke CD+G archive: ${zipPath}`);
  }
  const entries = readZipCentralDirectoryFromFile(zipPath);
  const audioEntry = entries.find((e) => e.fileName === resolved.audioEntry);
  const cdgEntry = entries.find((e) => e.fileName === resolved.cdgEntry);
  if (!audioEntry || !cdgEntry) {
    throw new Error('ZIP pair entries missing from Central Directory');
  }

  const audioName = `track${resolved.audioExt}`;
  const cdgName = 'track.cdg';
  const audioPath = path.join(destDir, audioName);
  const cdgPath = path.join(destDir, cdgName);

  await extractZipEntryToFileAsync(zipPath, audioEntry, audioPath);
  await extractZipEntryToFileAsync(zipPath, cdgEntry, cdgPath);

  return { audioPath, cdgPath, audioExt: resolved.audioExt };
}

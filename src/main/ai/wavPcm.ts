/**
 * Minimal PCM WAV read/write for instrumental AI (16-bit stereo/mono).
 * Avoids AudioContext — main/utility process friendly.
 */
import fs from 'fs';

export type PcmWav = {
  sampleRate: number;
  channels: number;
  /** Interleaved is not used — planar left/right (mono duplicates to both). */
  left: Float32Array;
  right: Float32Array;
};

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

/** Parse a PCM WAV file into planar float32 channels (-1..1). */
export function readPcmWavFile(filePath: string): PcmWav {
  const buf = fs.readFileSync(filePath);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a RIFF/WAVE file: ${filePath}`);
  }

  let offset = 12;
  let audioFormat = 1;
  let channels = 2;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = readU32(view, offset + 4);
    const chunkStart = offset + 8;
    if (id === 'fmt ') {
      audioFormat = readU16(view, chunkStart);
      channels = readU16(view, chunkStart + 2);
      sampleRate = readU32(view, chunkStart + 4);
      bitsPerSample = readU16(view, chunkStart + 14);
    } else if (id === 'data') {
      dataOffset = chunkStart;
      dataSize = size;
      break;
    }
    offset = chunkStart + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error(`WAV missing data chunk: ${filePath}`);
  if (audioFormat !== 1 || bitsPerSample !== 16) {
    throw new Error(
      `Unsupported WAV format (need PCM 16-bit); got format=${audioFormat} bits=${bitsPerSample}`
    );
  }

  const frameCount = Math.floor(dataSize / (channels * 2));
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  let o = dataOffset;
  for (let i = 0; i < frameCount; i++) {
    const l = view.getInt16(o, true);
    o += 2;
    left[i] = l < 0 ? l / 0x8000 : l / 0x7fff;
    if (channels > 1) {
      const r = view.getInt16(o, true);
      o += 2;
      right[i] = r < 0 ? r / 0x8000 : r / 0x7fff;
    } else {
      right[i] = left[i];
    }
    // Skip extra channels if somehow >2
    for (let c = 2; c < channels; c++) o += 2;
  }

  return { sampleRate, channels: Math.min(2, channels), left, right };
}

/**
 * Read only WAV header fields to compute duration — avoids loading multi-hundred-MB PCM
 * into memory just for AI timeout scaling.
 */
export function readPcmWavDurationSec(filePath: string): number {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    if (fs.readSync(fd, header, 0, 12, 0) < 12) {
      throw new Error(`WAV too short: ${filePath}`);
    }
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error(`Not a RIFF/WAVE file: ${filePath}`);
    }

    let offset = 12;
    let channels = 2;
    let sampleRate = 44100;
    let bitsPerSample = 16;
    let dataSize = 0;
    const chunkHdr = Buffer.alloc(8);

    while (true) {
      const n = fs.readSync(fd, chunkHdr, 0, 8, offset);
      if (n < 8) break;
      const id = chunkHdr.toString('ascii', 0, 4);
      const size = chunkHdr.readUInt32LE(4);
      const chunkStart = offset + 8;
      if (id === 'fmt ') {
        const fmt = Buffer.alloc(Math.min(size, 40));
        fs.readSync(fd, fmt, 0, fmt.length, chunkStart);
        channels = fmt.readUInt16LE(2);
        sampleRate = fmt.readUInt32LE(4);
        bitsPerSample = fmt.readUInt16LE(14);
      } else if (id === 'data') {
        dataSize = size;
        break;
      }
      offset = chunkStart + size + (size % 2);
    }

    if (dataSize <= 0 || sampleRate <= 0 || channels <= 0 || bitsPerSample <= 0) {
      throw new Error(`Could not determine WAV duration: ${filePath}`);
    }
    const bytesPerFrame = channels * (bitsPerSample / 8);
    if (bytesPerFrame <= 0) throw new Error(`Invalid WAV frame size: ${filePath}`);
    return dataSize / bytesPerFrame / sampleRate;
  } finally {
    fs.closeSync(fd);
  }
}

/** Write planar float32 stereo as 16-bit PCM WAV. */
export function writePcmWavFile(
  filePath: string,
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): void {
  const length = Math.min(left.length, right.length);
  const numChannels = 2;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(numChannels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * blockAlign, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sl = Math.max(-1, Math.min(1, left[i]));
    const sr = Math.max(-1, Math.min(1, right[i]));
    out.writeInt16LE(sl < 0 ? Math.round(sl * 0x8000) : Math.round(sl * 0x7fff), offset);
    offset += 2;
    out.writeInt16LE(sr < 0 ? Math.round(sr * 0x8000) : Math.round(sr * 0x7fff), offset);
    offset += 2;
  }
  fs.writeFileSync(filePath, out);
}

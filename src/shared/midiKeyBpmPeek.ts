/**
 * Peek MIDI initial tempo (BPM) and key signature without full MidiParser.
 * Main-process safe (no renderer imports). Used by TrackAnalysisService.
 */

import { keyFromMidiSignature } from './musicalKeys';

export type MidiKeyBpmPeek = {
  initialBpm?: number;
  initialKey?: string;
};

function readVarLen(data: DataView, offsetRef: { o: number }): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const b = data.getUint8(offsetRef.o++);
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return value;
}

/**
 * Scan SMF/KAR buffer for first tempo (0x51) and key signature (0x59) meta events.
 */
export function peekMidiKeyAndBpm(buffer: ArrayBuffer | Buffer): MidiKeyBpmPeek {
  const ab =
    buffer instanceof ArrayBuffer
      ? buffer
      : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const data = new DataView(ab);
  let offset = 0;
  if (data.byteLength < 14) return {};

  const tag =
    String.fromCharCode(data.getUint8(0)) +
    String.fromCharCode(data.getUint8(1)) +
    String.fromCharCode(data.getUint8(2)) +
    String.fromCharCode(data.getUint8(3));
  if (tag !== 'MThd') return {};

  const headerLength = data.getUint32(4);
  const trackCount = data.getUint16(10);
  offset = 8 + headerLength;

  let initialBpm: number | undefined;
  let initialKey: string | undefined;

  for (let t = 0; t < trackCount && offset + 8 <= data.byteLength; t++) {
    const trk =
      String.fromCharCode(data.getUint8(offset)) +
      String.fromCharCode(data.getUint8(offset + 1)) +
      String.fromCharCode(data.getUint8(offset + 2)) +
      String.fromCharCode(data.getUint8(offset + 3));
    if (trk !== 'MTrk') break;
    const trackLen = data.getUint32(offset + 4);
    offset += 8;
    const trackEnd = Math.min(offset + trackLen, data.byteLength);
    const oRef = { o: offset };
    let runningStatus = 0;

    while (oRef.o < trackEnd) {
      readVarLen(data, oRef);
      if (oRef.o >= trackEnd) break;
      let status = data.getUint8(oRef.o);
      if (status < 0x80) {
        status = runningStatus;
      } else {
        oRef.o++;
        if (status < 0xf0) runningStatus = status;
      }

      if (status === 0xff) {
        if (oRef.o >= trackEnd) break;
        const metaType = data.getUint8(oRef.o++);
        const metaLen = readVarLen(data, oRef);
        if (oRef.o + metaLen > trackEnd) break;
        if (metaType === 0x51 && metaLen === 3 && initialBpm == null) {
          const us =
            (data.getUint8(oRef.o) << 16) |
            (data.getUint8(oRef.o + 1) << 8) |
            data.getUint8(oRef.o + 2);
          if (us > 0) initialBpm = Math.round(60000000 / us);
        } else if (metaType === 0x59 && metaLen >= 2 && initialKey == null) {
          const sf = data.getInt8(oRef.o);
          const mi = data.getUint8(oRef.o + 1);
          initialKey = keyFromMidiSignature(sf, mi);
        } else if (metaType === 0x2f) {
          oRef.o += metaLen;
          break;
        }
        oRef.o += metaLen;
      } else if (status === 0xf0 || status === 0xf7) {
        const sysexLen = readVarLen(data, oRef);
        oRef.o += sysexLen;
      } else {
        const high = status & 0xf0;
        if (high === 0xc0 || high === 0xd0) oRef.o += 1;
        else oRef.o += 2;
      }

      if (initialBpm != null && initialKey != null) {
        offset = trackEnd;
        break;
      }
    }
    offset = trackEnd;
  }

  return { initialBpm, initialKey };
}

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV ArrayBuffer (for dual-stem disk cache).
 */
export function encodeWavPcm16(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const out = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(out);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = headerSize;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return out;
}

/** vocals[i] = mix[i] − instrumental[i] (same length / rate). */
export function subtractBuffers(
  mix: AudioBuffer,
  instrumental: AudioBuffer,
  audioContext: BaseAudioContext
): AudioBuffer {
  const length = Math.min(mix.length, instrumental.length);
  const sampleRate = mix.sampleRate;
  const out = audioContext.createBuffer(2, length, sampleRate);
  const mixL = mix.getChannelData(0);
  const mixR = mix.numberOfChannels > 1 ? mix.getChannelData(1) : mixL;
  const instL = instrumental.getChannelData(0);
  const instR = instrumental.numberOfChannels > 1 ? instrumental.getChannelData(1) : instL;
  const outL = out.getChannelData(0);
  const outR = out.getChannelData(1);
  for (let i = 0; i < length; i++) {
    outL[i] = mixL[i] - instL[i];
    outR[i] = mixR[i] - instR[i];
  }
  return out;
}

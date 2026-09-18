/**
 * UVR-MDX-NET Karaoke 2 geometry helpers (offline Download Instrumental path).
 *
 * Inspired by Anjok07/ultimatevocalremovergui `SeperateMDX.demix` / `initialize_model_settings`
 * (AGPL-3.0). We reimplement the math in TypeScript — we do not vendor UVR GUI source.
 *
 * Karaoke 2 model_data (MD5 1d64a6d2…): dim_f=2048, dim_t=2^8=256, n_fft=5120,
 * hop=1024, compensate=1.065, primary_stem=Instrumental.
 */

export const MDX_KARA2 = {
  sampleRate: 44100,
  dimF: 2048,
  dimT: 256,
  nFft: 5120,
  hop: 1024,
  compensation: 1.065,
  /** UVR always zeros spek[:, :, :3, :] before ONNX. */
  muteLowBins: 3
} as const;

/** hop * (dim_t - 1) — samples fed to one ORT window (UVR chunk_size). */
export function mdxChunkSize(hop: number = MDX_KARA2.hop, dimT: number = MDX_KARA2.dimT): number {
  return hop * (dimT - 1);
}

/** n_fft / 2 — UVR trim margin (center STFT margin cropped after OLA). */
export function mdxTrim(nFft: number = MDX_KARA2.nFft): number {
  return nFft >> 1;
}

/** chunk_size - 2*trim — new audio advanced per Default-overlap step. */
export function mdxGenSize(
  chunkSize: number = mdxChunkSize(),
  trim: number = mdxTrim()
): number {
  return chunkSize - 2 * trim;
}

/**
 * UVR MDX overlap → hop between prediction windows.
 * - `default` matches UVR UI "Default": step = chunk_size - n_fft (≈2% overlap).
 * - numeric fraction matches UVR 0.25 / 0.50 / …: step = (1 - overlap) * chunk_size.
 *   Settings UI default is 0.25 (see mdxAdvancedSettings.ts); hop actually changes
 *   when the user moves the overlap slider (not a no-op).
 *
 * KLS previously used 50% triangular OLA (~2× ORT runs vs UVR Default) which made
 * CPU WASM separations look stuck then hit idle/hard timeouts.
 */
export function mdxStepSamples(
  overlap: 'default' | number = 'default',
  chunkSize: number = mdxChunkSize(),
  nFft: number = MDX_KARA2.nFft
): number {
  if (overlap === 'default') {
    return chunkSize - nFft;
  }
  const o = Math.max(0, Math.min(0.99, overlap));
  return Math.max(1, Math.floor((1 - o) * chunkSize));
}

/** Zero-pad length so (trim + mix + pad - trim) is a multiple of gen_size (UVR demix). */
export function mdxTailPadSamples(
  mixLength: number,
  genSize: number = mdxGenSize(),
  trim: number = mdxTrim()
): number {
  if (mixLength <= 0) return genSize + trim;
  return genSize + trim - (mixLength % genSize);
}

/** How many ORT windows UVR Default overlap needs for a mix of `mixLength` samples. */
export function mdxDefaultChunkCount(mixLength: number): number {
  const trim = mdxTrim();
  const genSize = mdxGenSize();
  const step = mdxStepSamples('default');
  const pad = mdxTailPadSamples(mixLength, genSize, trim);
  const mixtureLen = trim + Math.max(0, mixLength) + pad;
  let count = 0;
  for (let i = 0; i < mixtureLen; i += step) count++;
  return Math.max(1, count);
}

/** Prior KLS 50% OLA chunk count (for regression / speedup assertions). */
export function mdxHalfOverlapChunkCount(mixLength: number): number {
  const trim = mdxTrim();
  const chunkSize = mdxChunkSize();
  const step = Math.floor(chunkSize / 2);
  const padded = Math.max(0, mixLength) + 2 * trim;
  let count = 0;
  for (let start = 0; start + chunkSize <= padded; start += step) count++;
  if (padded > chunkSize) {
    const start = Math.max(0, padded - chunkSize);
    if (start % step !== 0) count++;
  }
  return Math.max(1, count);
}

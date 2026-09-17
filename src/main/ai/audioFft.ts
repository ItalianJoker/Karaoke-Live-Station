/**
 * Arbitrary-length complex FFT via Bluestein's chirp-z algorithm,
 * using power-of-two `fft.js` for the convolution kernel.
 *
 * Needed because UVR MDX Karaoke 2 uses n_fft=5120 (not a power of two).
 *
 * Plans are cached per (n, inverse): rebuilding FFT(16384) + chirps every
 * STFT frame made instrumental AI look frozen at ~45% on CPU.
 */
import FFT from 'fft.js';

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

type BluesteinPlan = {
  n: number;
  m: number;
  inverse: boolean;
  sign: number;
  scale: number;
  fft: FFT;
  /** Frequency-domain convolution chirp (fixed for this plan). */
  B: number[];
  /** Scratch: time-domain input with data chirp applied. */
  a: number[];
  /** Scratch: FFT(a). */
  A: number[];
  /** Scratch: pointwise A*B then iFFT back into `a`. */
  C: number[];
  /** Precomputed data-chirp cos/sin for i in [0, n). */
  wr: Float64Array;
  wi: Float64Array;
};

const planCache = new Map<string, BluesteinPlan>();

function planKey(n: number, inverse: boolean): string {
  return `${n}:${inverse ? 1 : 0}`;
}

function getBluesteinPlan(n: number, inverse: boolean): BluesteinPlan {
  const key = planKey(n, inverse);
  const hit = planCache.get(key);
  if (hit) return hit;

  const m = nextPow2(2 * n - 1);
  const fft = new FFT(m);
  const sign = inverse ? 1 : -1;
  const B = fft.createComplexArray() as number[];
  const b = fft.createComplexArray() as number[];

  for (let i = 0; i < m; i++) {
    b[2 * i] = 0;
    b[2 * i + 1] = 0;
  }
  for (let i = 0; i < n; i++) {
    const angle = (-Math.PI * sign * (i * i)) / n;
    b[2 * i] = Math.cos(angle);
    b[2 * i + 1] = Math.sin(angle);
    if (i > 0) {
      b[2 * (m - i)] = b[2 * i];
      b[2 * (m - i) + 1] = b[2 * i + 1];
    }
  }
  fft.transform(B, b);

  const wr = new Float64Array(n);
  const wi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * sign * (i * i)) / n;
    wr[i] = Math.cos(angle);
    wi[i] = Math.sin(angle);
  }

  const plan: BluesteinPlan = {
    n,
    m,
    inverse,
    sign,
    scale: inverse ? 1 / n : 1,
    fft,
    B,
    a: fft.createComplexArray() as number[],
    A: fft.createComplexArray() as number[],
    C: fft.createComplexArray() as number[],
    wr,
    wi
  };
  planCache.set(key, plan);
  return plan;
}

type Pow2Plan = {
  fft: FFT;
  scratchIn: number[];
  scratchOut: number[];
};

const pow2Cache = new Map<number, Pow2Plan>();

function getPow2Plan(n: number): Pow2Plan {
  let plan = pow2Cache.get(n);
  if (plan) return plan;
  const fft = new FFT(n);
  plan = {
    fft,
    scratchIn: fft.createComplexArray() as number[],
    scratchOut: fft.createComplexArray() as number[]
  };
  pow2Cache.set(n, plan);
  return plan;
}

/**
 * In-place complex FFT / iFFT on interleaved Float64Array [re0, im0, re1, im1, …].
 * Length of the complex vector is `n` (array length = 2n).
 */
export function bluesteinFft(data: Float64Array, n: number, inverse: boolean): void {
  if (n <= 0) return;
  if ((n & (n - 1)) === 0) {
    const plan = getPow2Plan(n);
    const { fft, scratchIn, scratchOut } = plan;
    for (let i = 0; i < n * 2; i++) scratchIn[i] = data[i];
    if (inverse) {
      fft.inverseTransform(scratchOut, scratchIn);
    } else {
      fft.transform(scratchOut, scratchIn);
    }
    for (let i = 0; i < n * 2; i++) data[i] = scratchOut[i];
    return;
  }

  const plan = getBluesteinPlan(n, inverse);
  const { m, fft, B, a, A, C, wr, wi, scale } = plan;

  for (let i = 0; i < n; i++) {
    const re = data[2 * i];
    const im = data[2 * i + 1];
    a[2 * i] = re * wr[i] - im * wi[i];
    a[2 * i + 1] = re * wi[i] + im * wr[i];
  }
  for (let i = n; i < m; i++) {
    a[2 * i] = 0;
    a[2 * i + 1] = 0;
  }

  fft.transform(A, a);
  for (let i = 0; i < m; i++) {
    const Ar = A[2 * i];
    const Ai = A[2 * i + 1];
    const Br = B[2 * i];
    const Bi = B[2 * i + 1];
    C[2 * i] = Ar * Br - Ai * Bi;
    C[2 * i + 1] = Ar * Bi + Ai * Br;
  }
  fft.inverseTransform(a, C);

  for (let i = 0; i < n; i++) {
    const re = a[2 * i];
    const im = a[2 * i + 1];
    data[2 * i] = (re * wr[i] - im * wi[i]) * scale;
    data[2 * i + 1] = (re * wi[i] + im * wr[i]) * scale;
  }
}

/** Real forward STFT frame → complex spectrum (length nFft/2+1 bins kept by caller). */
export function realFftFrame(frame: Float32Array, nFft: number): { re: Float32Array; im: Float32Array } {
  const data = new Float64Array(nFft * 2);
  for (let i = 0; i < nFft; i++) {
    data[2 * i] = i < frame.length ? frame[i] : 0;
    data[2 * i + 1] = 0;
  }
  bluesteinFft(data, nFft, false);
  const bins = (nFft >> 1) + 1;
  const re = new Float32Array(bins);
  const im = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    re[k] = data[2 * k];
    im[k] = data[2 * k + 1];
  }
  return { re, im };
}

/** Inverse: complex spectrum (nFft/2+1) → real time frame of length nFft. */
export function realIfftFrame(re: Float32Array, im: Float32Array, nFft: number): Float32Array {
  const data = new Float64Array(nFft * 2);
  const bins = (nFft >> 1) + 1;
  for (let k = 0; k < bins; k++) {
    data[2 * k] = re[k] ?? 0;
    data[2 * k + 1] = im[k] ?? 0;
  }
  // Hermitian mirror for negative frequencies
  for (let k = 1; k < nFft - bins + 1; k++) {
    const src = bins - 1 - k;
    if (src < 0) break;
    const dst = bins - 1 + k;
    if (dst >= nFft) break;
    data[2 * dst] = re[src] ?? 0;
    data[2 * dst + 1] = -(im[src] ?? 0);
  }
  bluesteinFft(data, nFft, true);
  const out = new Float32Array(nFft);
  for (let i = 0; i < nFft; i++) out[i] = data[2 * i];
  return out;
}

export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

/** Test helper — clears cached FFT plans between unit checks. */
export function clearAudioFftCachesForTests(): void {
  planCache.clear();
  pow2Cache.clear();
}

/**
 * Arbitrary-length complex FFT via Bluestein's chirp-z algorithm,
 * using power-of-two `fft.js` for the convolution kernel.
 *
 * Needed because UVR MDX Karaoke 2 uses n_fft=5120 (not a power of two).
 */
import FFT from 'fft.js';

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * In-place complex FFT / iFFT on interleaved Float64Array [re0, im0, re1, im1, …].
 * Length of the complex vector is `n` (array length = 2n).
 */
export function bluesteinFft(data: Float64Array, n: number, inverse: boolean): void {
  if (n <= 0) return;
  if ((n & (n - 1)) === 0) {
    // Fast path: native radix-4
    const fft = new FFT(n);
    const out = fft.createComplexArray() as number[];
    if (inverse) {
      fft.inverseTransform(out, Array.from(data));
    } else {
      fft.transform(out, Array.from(data));
    }
    for (let i = 0; i < out.length; i++) data[i] = out[i];
    return;
  }

  const m = nextPow2(2 * n - 1);
  const fft = new FFT(m);
  const a = fft.createComplexArray() as number[];
  const b = fft.createComplexArray() as number[];
  const A = fft.createComplexArray() as number[];
  const B = fft.createComplexArray() as number[];
  const C = fft.createComplexArray() as number[];

  const sign = inverse ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * sign * (i * i)) / n;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const re = data[2 * i];
    const im = data[2 * i + 1];
    a[2 * i] = re * wr - im * wi;
    a[2 * i + 1] = re * wi + im * wr;
  }
  for (let i = n; i < m; i++) {
    a[2 * i] = 0;
    a[2 * i + 1] = 0;
  }

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

  fft.transform(A, a);
  fft.transform(B, b);
  for (let i = 0; i < m; i++) {
    const Ar = A[2 * i];
    const Ai = A[2 * i + 1];
    const Br = B[2 * i];
    const Bi = B[2 * i + 1];
    C[2 * i] = Ar * Br - Ai * Bi;
    C[2 * i + 1] = Ar * Bi + Ai * Br;
  }
  fft.inverseTransform(a, C);

  const scale = inverse ? 1 / n : 1;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * sign * (i * i)) / n;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const re = a[2 * i];
    const im = a[2 * i + 1];
    data[2 * i] = (re * wr - im * wi) * scale;
    data[2 * i + 1] = (re * wi + im * wr) * scale;
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

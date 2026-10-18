/**
 * worker_threads entry for Key/BPM chromagram + onset FFT.
 * Keeps heavy fft.js work off Electron main (Safety-First / concurrency).
 *
 * Built by vite-plugin-electron alongside instrumentalAiWorker.
 */

import { parentPort, workerData } from 'worker_threads';
import FFT from 'fft.js';

const SAMPLE_RATE = 22050;
const FFT_SIZE = 2048;
const HOP = 512;

export type TrackAnalysisFftRequest = {
  requestId: number;
  /** Mono PCM at 22050 Hz (transferable ArrayBuffer preferred). */
  samples: Float32Array;
};

export type TrackAnalysisFftResponse = {
  requestId: number;
  chroma: number[];
  onset: number[];
  error?: string;
};

/**
 * Chromagram + onset flux (sync). Same math as TrackAnalysisService.computeChromaAndOnset.
 */
export function computeChromaAndOnsetSync(samples: Float32Array): {
  chroma: number[];
  onset: number[];
} {
  const fft = new FFT(FFT_SIZE);
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  }

  const chroma = new Array(12).fill(0);
  const onset: number[] = [];
  let prevMag: Float32Array | null = null;

  const out = fft.createComplexArray() as number[];
  const input = fft.createComplexArray() as number[];

  for (let start = 0; start + FFT_SIZE < samples.length; start += HOP) {
    for (let i = 0; i < FFT_SIZE; i++) {
      input[i * 2] = samples[start + i] * window[i];
      input[i * 2 + 1] = 0;
    }
    fft.transform(out, input);

    const mags = new Float32Array(FFT_SIZE / 2);
    let flux = 0;
    for (let k = 0; k < FFT_SIZE / 2; k++) {
      const re = out[k * 2];
      const im = out[k * 2 + 1];
      const mag = Math.sqrt(re * re + im * im);
      mags[k] = mag;
      if (prevMag) {
        const d = mag - prevMag[k];
        if (d > 0) flux += d;
      }
      if (k === 0) continue;
      const freq = (k * SAMPLE_RATE) / FFT_SIZE;
      if (freq < 50 || freq > 5000) continue;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag;
    }
    onset.push(flux);
    prevMag = mags;
  }

  return { chroma, onset };
}

function handleMessage(msg: TrackAnalysisFftRequest): void {
  try {
    const samples =
      msg.samples instanceof Float32Array
        ? msg.samples
        : new Float32Array((msg as unknown as { samples: ArrayBuffer }).samples);
    const { chroma, onset } = computeChromaAndOnsetSync(samples);
    const response: TrackAnalysisFftResponse = {
      requestId: msg.requestId,
      chroma,
      onset
    };
    parentPort?.postMessage(response);
  } catch (err) {
    const response: TrackAnalysisFftResponse = {
      requestId: msg.requestId,
      chroma: [],
      onset: [],
      error: err instanceof Error ? err.message : String(err)
    };
    parentPort?.postMessage(response);
  }
}

if (parentPort) {
  parentPort.on('message', (msg: TrackAnalysisFftRequest) => {
    handleMessage(msg);
  });
  // Optional one-shot via workerData (unused; message API is primary).
  if (workerData && typeof workerData === 'object' && 'samples' in workerData) {
    handleMessage(workerData as TrackAnalysisFftRequest);
  }
}

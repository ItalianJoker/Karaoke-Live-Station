/**
 * Background Key + BPM analysis for catalog tracks.
 *
 * Never blocks play-start: jobs run via setImmediate queue after scan/import
 * or when a track without analysis becomes current. Results persist to SQLite
 * (`initialKey`, `initialBpm`) and are optional on KaraokeMediaTrack.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import FFT from 'fft.js';
import {
  estimateBpmFromOnsetStrength,
  estimateKeyFromChromagram
} from '../../shared/musicalKeys';
import { peekMidiKeyAndBpm } from '../../shared/midiKeyBpmPeek';
import type { KaraokeMediaTrack } from '../../shared/types';
import type { DatabaseManager } from '../db/database';
import { inspectZipForCdgPair, extractZipEntryToFile, readZipCentralDirectoryFromFile } from '../../shared/zipCdg';

export type TrackAnalysisResult = {
  initialKey?: string;
  initialBpm?: number;
};

type AnalyzeJob = {
  trackId: string;
  localFilePath: string;
  source: KaraokeMediaTrack['source'];
};

const SAMPLE_RATE = 22050;
const ANALYZE_SECONDS = 45;
const FFT_SIZE = 2048;
const HOP = 512;

export class TrackAnalysisService {
  private readonly db: DatabaseManager;
  private readonly ffmpegPath: string | null;
  private readonly queue: AnalyzeJob[] = [];
  private running = false;
  private readonly attempted = new Set<string>();
  private readonly tempDir: string;

  constructor(db: DatabaseManager, tempDir: string, ffmpegPath: string | null) {
    this.db = db;
    this.tempDir = path.join(tempDir, 'analysis');
    this.ffmpegPath = ffmpegPath;
  }

  /**
   * Enqueue analysis when key/BPM are still unknown. Dedupes by trackId.
   */
  enqueue(track: KaraokeMediaTrack): void {
    if (!track?.id || !track.localFilePath) return;
    if (track.initialKey && track.initialBpm) return;
    if (this.attempted.has(track.id)) return;
    if (this.queue.some((j) => j.trackId === track.id)) return;
    this.queue.push({
      trackId: track.id,
      localFilePath: track.localFilePath,
      source: track.source
    });
    this.kick();
  }

  enqueueMany(tracks: KaraokeMediaTrack[]): void {
    for (const t of tracks) this.enqueue(t);
  }

  private kick(): void {
    if (this.running) return;
    this.running = true;
    setImmediate(() => void this.drain());
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const job = this.queue.shift()!;
      this.attempted.add(job.trackId);
      try {
        const result = await this.analyzePath(job);
        if (result.initialKey || result.initialBpm) {
          this.db.updateTrackKeyBpm(job.trackId, result.initialKey, result.initialBpm);
        }
      } catch (err) {
        console.warn('TrackAnalysisService: analyze failed', job.trackId, err);
      }
      // Yield between tracks so scan/play IPC stay snappy
      await new Promise<void>((r) => setImmediate(r));
    }
    this.running = false;
  }

  private async analyzePath(job: AnalyzeJob): Promise<TrackAnalysisResult> {
    const ext = path.extname(job.localFilePath).toLowerCase();

    if (ext === '.mid' || ext === '.kar' || job.source === 'midi') {
      const buf = fs.readFileSync(job.localFilePath);
      return peekMidiKeyAndBpm(buf);
    }

    let audioPath = job.localFilePath;
    let cleanup: string | null = null;

    if (ext === '.zip') {
      const pair = inspectZipForCdgPair(job.localFilePath);
      if (!pair) return {};
      const entries = readZipCentralDirectoryFromFile(job.localFilePath);
      const audioEntry = entries.find((e) => e.fileName === pair.audioEntry);
      if (!audioEntry) return {};
      if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
      cleanup = path.join(this.tempDir, `${job.trackId.replace(/[^a-zA-Z0-9_-]/g, '_')}${pair.audioExt}`);
      extractZipEntryToFile(job.localFilePath, audioEntry, cleanup);
      audioPath = cleanup;
    } else if (!['.mp3', '.wav', '.mp4', '.webm', '.mkv', '.avi', '.m4a', '.ogg'].includes(ext)) {
      return {};
    }

    try {
      return await this.analyzeAudioFile(audioPath);
    } finally {
      if (cleanup) {
        try {
          fs.unlinkSync(cleanup);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async analyzeAudioFile(audioPath: string): Promise<TrackAnalysisResult> {
    if (!this.ffmpegPath || !fs.existsSync(this.ffmpegPath)) {
      return {};
    }
    const pcm = await this.decodePcmMono(audioPath);
    if (!pcm || pcm.length < SAMPLE_RATE) return {};

    const { chroma, onset } = this.computeChromaAndOnset(pcm);
    const initialKey = estimateKeyFromChromagram(chroma);
    const hopSec = HOP / SAMPLE_RATE;
    const initialBpm = estimateBpmFromOnsetStrength(onset, hopSec);
    return { initialKey, initialBpm };
  }

  /** ffmpeg → mono f32le PCM (capped duration). */
  private decodePcmMono(audioPath: string): Promise<Float32Array | null> {
    return new Promise((resolve) => {
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-t',
        String(ANALYZE_SECONDS),
        '-i',
        audioPath,
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        'f32le',
        'pipe:1'
      ];
      const child = spawn(this.ffmpegPath!, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let total = 0;
      const maxBytes = SAMPLE_RATE * ANALYZE_SECONDS * 4;
      child.stdout.on('data', (c: Buffer) => {
        if (total >= maxBytes) return;
        const slice = total + c.length > maxBytes ? c.subarray(0, maxBytes - total) : c;
        chunks.push(slice);
        total += slice.length;
      });
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code !== 0 || !total) {
          resolve(null);
          return;
        }
        const buf = Buffer.concat(chunks);
        resolve(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
      });
    });
  }

  private computeChromaAndOnset(samples: Float32Array): {
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
        // MIDI pitch class
        const midi = 69 + 12 * Math.log2(freq / 440);
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        chroma[pc] += mag;
      }
      onset.push(flux);
      prevMag = mags;
    }

    return { chroma, onset };
  }
}

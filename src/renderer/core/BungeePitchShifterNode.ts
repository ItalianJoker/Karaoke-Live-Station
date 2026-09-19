import {
  BUNGEE_PITCH_ABSOLUTE_MAX,
  BUNGEE_PITCH_ABSOLUTE_MIN,
  clampBungeeAbsoluteSpeed,
  isDspNeutralBypass
} from '../../shared/dspPitch';

/** Max wait for Wasm `initialized` from the AudioWorklet (ms). */
const BUNGEE_INIT_TIMEOUT_MS = 8000;

/**
 * BungeePitchShifterNode
 *
 * Stereo pitch + independent speed via Bungee phase-vocoder Wasm AudioWorklet.
 *
 * **Upstream (runtime Wasm only — no C++ source vendored):**
 * https://github.com/bungee-audio-stretch/bungee — Mozilla Public License 2.0 (MPL-2.0).
 * Prebuilt assets: `public/workers/bungee_processor.js`, `public/workers/bungee.wasm`
 * (see `public/workers/BUNGEE_NOTICE.md`).
 *
 * **Critical invariant (Safety-First):** when pitch === 0 && speed === 1.0,
 * the AudioWorklet is disconnected (`input → output` direct) for true
 * zero-latency / zero-CPU bit-perfect pass-through.
 *
 * {@link create} resolves only after the worklet posts `initialized` (Wasm ready).
 * Timeout / worklet `error` → throw so {@link AudioGraphManager} can fall back to SoundTouch.
 */
export class BungeePitchShifterNode {
  private readonly audioCtx: AudioContext;
  private readonly _input: GainNode;
  private readonly _output: GainNode;
  private worklet: AudioWorkletNode | null = null;
  private semitones = 0;
  private speed = 1.0;
  private bypassActive = true;
  private disposed = false;
  /** True after worklet posts `{ type: 'initialized' }`. */
  private wasmReady = false;

  private constructor(audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
    this._input = audioCtx.createGain();
    this._output = audioCtx.createGain();
    this.applyBypassRouting(true);
  }

  /**
   * Loads the Bungee AudioWorklet (blob URL, same pattern as SpessaSynth),
   * waits for Wasm `initialized`, and returns a ready node.
   * Throws on load / init / timeout so the caller can fall back to SoundTouch.
   */
  public static async create(audioCtx: AudioContext): Promise<BungeePitchShifterNode> {
    const node = new BungeePitchShifterNode(audioCtx);
    await node.loadWorklet();
    return node;
  }

  public get input(): GainNode {
    return this._input;
  }

  public get output(): GainNode {
    return this._output;
  }

  public get isWasmReady(): boolean {
    return this.wasmReady;
  }

  /**
   * Fetches `bungee_processor.js` and registers it via AudioWorklet.
   * Uses a blob URL so Electron `file://` / packaged paths stay CORS-safe.
   *
   * License note at load site: Bungee Wasm from
   * https://github.com/bungee-audio-stretch/bungee (MPL-2.0). No upstream
   * `.cpp`/`.h` trees are present in this repository.
   */
  private async loadWorklet(): Promise<void> {
    // Upstream: https://github.com/bungee-audio-stretch/bungee — MPL-2.0 (Wasm prebuilt only).
    // Fetch as ArrayBuffer to preserve embedded SINGLE_FILE Wasm bytes (nulls / high bytes).
    const scriptUrl = '/workers/bungee_processor.js';
    const response = await fetch(scriptUrl).catch(() =>
      fetch(new URL('workers/bungee_processor.js', window.location.href).href)
    );
    if (!response.ok) {
      throw new Error(`Bungee processor fetch failed: HTTP ${response.status}`);
    }
    const scriptBytes = await response.arrayBuffer();
    const blob = new Blob([scriptBytes], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await this.audioCtx.audioWorklet.addModule(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    this.worklet = new AudioWorkletNode(this.audioCtx, 'bungee-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    });

    await this.waitForWasmReady();

    // Re-send params after Wasm ready (covers any messages lost during async init).
    this.send('setPitch', this.semitones);
    this.send('setSpeed', this.speed);
    this.send('setMix', 1.0);
    this.refreshBypass();
  }

  /**
   * Resolves when the worklet posts `initialized`; rejects on `error` or timeout.
   * Pending setPitch/setSpeed values are already buffered on the processor
   * (`this.pitchSemitones` / `this.speed`) and applied inside initializeWasm.
   */
  private waitForWasmReady(): Promise<void> {
    const worklet = this.worklet;
    if (!worklet) {
      return Promise.reject(new Error('Bungee AudioWorkletNode missing'));
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        worklet.port.onmessage = null;
        reject(new Error(`Bungee Wasm init timed out after ${BUNGEE_INIT_TIMEOUT_MS}ms`));
      }, BUNGEE_INIT_TIMEOUT_MS);

      worklet.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; message?: string };
        if (data?.type === 'initialized') {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          this.wasmReady = true;
          // Keep listening for late errors (do not clear onmessage).
          worklet.port.onmessage = (later: MessageEvent) => {
            const d = later.data as { type?: string; message?: string };
            if (d?.type === 'error') {
              console.warn('[BungeePitchShifterNode]', d.message ?? 'worklet error');
            }
          };
          resolve();
          return;
        }
        if (data?.type === 'error') {
          if (settled) {
            console.warn('[BungeePitchShifterNode]', data.message ?? 'worklet error');
            return;
          }
          settled = true;
          window.clearTimeout(timer);
          worklet.port.onmessage = null;
          reject(new Error(data.message ?? 'Bungee worklet Wasm init failed'));
        }
      };

      // Kick info request — processor also posts `initialized` from initializeWasm.
      this.send('getInfo');
    });
  }

  private send(type: string, value?: number): void {
    if (!this.worklet) return;
    this.worklet.port.postMessage(value === undefined ? { type } : { type, value });
  }

  /**
   * Connects either input→output (bypass) or input→worklet→output.
   * When leaving bypass, wet mix is forced to 1.0 (fully processed).
   */
  private applyBypassRouting(bypass: boolean): void {
    try {
      this._input.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.worklet?.disconnect();
    } catch {
      /* ignore */
    }

    this.bypassActive = bypass;
    if (bypass || !this.worklet) {
      // Flush worklet FIFO / grain state so re-engage does not play stale audio.
      this.send('reset');
      this._input.connect(this._output);
    } else {
      this.send('reset');
      this.send('setMix', 1.0);
      this._input.connect(this.worklet);
      this.worklet.connect(this._output);
    }
  }

  private refreshBypass(): void {
    const needsDsp = !isDspNeutralBypass(this.semitones, this.speed);
    if (needsDsp === this.bypassActive) {
      this.applyBypassRouting(!needsDsp);
    }
  }

  /**
   * Sets live pitch offset in whole semitones (absolute clamp ±12).
   * Neutral with speed 1.0 → true bypass.
   * Values are always posted to the worklet; if Wasm is not ready yet they are
   * also held on the processor side until initializeWasm applies them.
   */
  public setPitchOffset(semitones: number): void {
    const clamped = Math.max(
      BUNGEE_PITCH_ABSOLUTE_MIN,
      Math.min(
        BUNGEE_PITCH_ABSOLUTE_MAX,
        Math.round(Number.isFinite(semitones) ? semitones : 0)
      )
    );
    if (clamped === this.semitones) {
      this.refreshBypass();
      return;
    }
    this.semitones = clamped;
    this.send('setPitch', clamped);
    this.refreshBypass();
  }

  /**
   * Sets independent playback speed (0.50x–1.50x). Neutral with pitch 0 → bypass.
   */
  public setPlaybackSpeed(speed: number): void {
    const clamped = clampBungeeAbsoluteSpeed(speed);
    if (clamped === this.speed) {
      this.refreshBypass();
      return;
    }
    this.speed = clamped;
    this.send('setSpeed', clamped);
    this.refreshBypass();
  }

  /** Resets internal Bungee grain state (e.g. after seek). */
  public reset(): void {
    this.send('reset');
  }

  public get isBypassActive(): boolean {
    return this.bypassActive;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this._input.disconnect();
      this.worklet?.disconnect();
      if (this.worklet) {
        this.worklet.port.onmessage = null;
      }
      this._output.disconnect();
    } catch {
      /* ignore teardown */
    }
    this.worklet = null;
    this.wasmReady = false;
  }
}

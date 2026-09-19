/**
 * HTDemucs separation with injectable advanced knobs (shifts / segment / overlap).
 *
 * demucs-web hardcodes TRAINING_SAMPLES + SEGMENT_OVERLAP via module destructuring,
 * so we reimplement the segment loop (same math) with Settings-driven overlap/shifts.
 * Model input tensors stay TRAINING_SAMPLES-sized (fixed ONNX window ~7.8 s).
 * `demucsSegmentSize` is coerced/injected for Settings + stride policy observability.
 */
import type * as OrtNamespace from 'onnxruntime-web';
import {
  coerceDemucsAdvancedSettings,
  type DemucsAdvancedSettings,
  type DemucsAdvancedSettingsInput
} from '../../shared/demucsAdvancedSettings';

type StemChannels = { left: Float32Array; right: Float32Array };
export type DemucsSeparationResult = {
  drums: StemChannels;
  bass: StemChannels;
  other: StemChannels;
  vocals: StemChannels;
};

export type DemucsProcessorLike = {
  session: OrtNamespace.InferenceSession | null;
  ort: typeof OrtNamespace;
  onProgress: (info: {
    progress: number;
    currentSegment: number;
    totalSegments: number;
  }) => void;
  loadModel: (buf: ArrayBuffer) => Promise<unknown>;
  /** Injected advanced knobs (tests assert these land on the processor). */
  demucsShifts?: number;
  demucsSegmentSize?: number;
  demucsOverlap?: number;
};

export type DemucsWebModule = {
  CONSTANTS: {
    SAMPLE_RATE: number;
    TRAINING_SAMPLES: number;
    MODEL_SPEC_BINS: number;
    MODEL_SPEC_FRAMES: number;
    SEGMENT_OVERLAP: number;
    TRACKS: string[];
  };
  prepareModelInput: (
    left: Float32Array,
    right: Float32Array
  ) => { waveform: Float32Array; magSpec: Float32Array };
  standaloneMask: (freqOutput: Float32Array) => unknown[];
  standaloneIspec: (trackSpec: unknown, targetLength: number) => StemChannels;
};

function circularShift(channel: Float32Array, shift: number): Float32Array {
  const n = channel.length;
  if (n === 0 || shift === 0) return channel;
  const s = ((shift % n) + n) % n;
  const out = new Float32Array(n);
  out.set(channel.subarray(s), 0);
  out.set(channel.subarray(0, s), n - s);
  return out;
}

function averageStems(results: DemucsSeparationResult[]): DemucsSeparationResult {
  const n = results.length;
  if (n === 1) return results[0];
  const length = results[0].drums.left.length;
  const tracks = ['drums', 'bass', 'other', 'vocals'] as const;
  const out = {} as DemucsSeparationResult;
  for (const t of tracks) {
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (const r of results) {
      const stem = r[t];
      for (let i = 0; i < length; i++) {
        left[i] += stem.left[i] / n;
        right[i] += stem.right[i] / n;
      }
    }
    out[t] = { left, right };
  }
  return out;
}

async function separateOnce(
  demucs: DemucsProcessorLike,
  mod: DemucsWebModule,
  leftChannel: Float32Array,
  rightChannel: Float32Array,
  overlap: number,
  onProgressScale?: { offset: number; span: number }
): Promise<DemucsSeparationResult> {
  if (!demucs.session) {
    throw new Error('Model not loaded. Call loadModel() first.');
  }
  const { TRAINING_SAMPLES, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES, TRACKS } = mod.CONSTANTS;
  const totalSamples = leftChannel.length;
  const stride = Math.max(1, Math.floor(TRAINING_SAMPLES * (1 - overlap)));
  const numSegments = Math.max(
    1,
    Math.ceil((totalSamples - TRAINING_SAMPLES) / stride) + 1
  );

  const outputs = TRACKS.map(() => ({
    left: new Float32Array(totalSamples),
    right: new Float32Array(totalSamples)
  }));
  const weights = new Float32Array(totalSamples);
  let segmentIdx = 0;

  for (let start = 0; start < totalSamples; start += stride) {
    const end = Math.min(start + TRAINING_SAMPLES, totalSamples);
    const segmentLength = end - start;
    const segLeft = new Float32Array(TRAINING_SAMPLES);
    const segRight = new Float32Array(TRAINING_SAMPLES);
    for (let i = 0; i < segmentLength; i++) {
      segLeft[i] = leftChannel[start + i];
      segRight[i] = rightChannel[start + i];
    }

    const input = mod.prepareModelInput(segLeft, segRight);
    const waveformTensor = new demucs.ort.Tensor('float32', input.waveform, [
      1,
      2,
      TRAINING_SAMPLES
    ]);
    const magSpecTensor = new demucs.ort.Tensor('float32', input.magSpec, [
      1,
      4,
      MODEL_SPEC_BINS,
      MODEL_SPEC_FRAMES
    ]);
    const feeds: Record<string, OrtNamespace.Tensor> = {};
    feeds[demucs.session.inputNames[0]] = waveformTensor;
    if (demucs.session.inputNames.length > 1) {
      feeds[demucs.session.inputNames[1]] = magSpecTensor;
    }
    const inferResults = await demucs.session.run(feeds);

    let timeData: Float32Array | null = null;
    let timeShape: readonly number[] | null = null;
    let freqData: Float32Array | null = null;
    for (const name of demucs.session.outputNames) {
      const tensor = inferResults[name];
      if (tensor.dims.length === 4 && tensor.dims[2] === 2) {
        timeData = tensor.data as Float32Array;
        timeShape = tensor.dims;
      } else if (tensor.dims.length === 5 && tensor.dims[2] === 4) {
        freqData = tensor.data as Float32Array;
      }
    }
    if (!timeData || !timeShape) {
      throw new Error('Could not find time-domain output tensor');
    }

    let combinedOutputs: StemChannels[] | null = null;
    if (freqData) {
      const trackSpecs = mod.standaloneMask(freqData);
      combinedOutputs = [];
      for (let t = 0; t < 4; t++) {
        const freqOutput = mod.standaloneIspec(trackSpecs[t], TRAINING_SAMPLES);
        const numChannels = timeShape[2];
        const samples = timeShape[3];
        const timeLeft = new Float32Array(samples);
        const timeRight = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
          timeLeft[i] = timeData[t * numChannels * samples + 0 * samples + i];
          timeRight[i] = timeData[t * numChannels * samples + 1 * samples + i];
        }
        const combined: StemChannels = {
          left: new Float32Array(samples),
          right: new Float32Array(samples)
        };
        for (let i = 0; i < samples; i++) {
          combined.left[i] = timeLeft[i] + (freqOutput.left[i] || 0);
          combined.right[i] = timeRight[i] + (freqOutput.right[i] || 0);
        }
        combinedOutputs.push(combined);
      }
    }

    const numTracks = timeShape[1];
    const numChannels = timeShape[2];
    const samples = timeShape[3];
    const overlapWindow = new Float32Array(segmentLength);
    for (let i = 0; i < segmentLength; i++) {
      const fadeIn = Math.min(i / (stride * 0.5), 1);
      const fadeOut = Math.min((segmentLength - i) / (stride * 0.5), 1);
      overlapWindow[i] = Math.min(fadeIn, fadeOut);
    }

    for (let t = 0; t < numTracks; t++) {
      for (let i = 0; i < segmentLength && start + i < totalSamples; i++) {
        let leftVal: number;
        let rightVal: number;
        if (combinedOutputs) {
          leftVal = combinedOutputs[t].left[i];
          rightVal = combinedOutputs[t].right[i];
        } else {
          leftVal = timeData[t * numChannels * samples + 0 * samples + i];
          rightVal = timeData[t * numChannels * samples + 1 * samples + i];
        }
        outputs[t].left[start + i] += leftVal * overlapWindow[i];
        outputs[t].right[start + i] += rightVal * overlapWindow[i];
      }
    }
    for (let i = 0; i < segmentLength && start + i < totalSamples; i++) {
      weights[start + i] += overlapWindow[i];
    }

    segmentIdx++;
    const raw = segmentIdx / numSegments;
    const progress = onProgressScale
      ? onProgressScale.offset + raw * onProgressScale.span
      : raw;
    demucs.onProgress({
      progress: Math.max(0, Math.min(1, progress)),
      currentSegment: segmentIdx,
      totalSegments: numSegments
    });
  }

  for (let t = 0; t < TRACKS.length; t++) {
    for (let i = 0; i < totalSamples; i++) {
      if (weights[i] > 0) {
        outputs[t].left[i] /= weights[i];
        outputs[t].right[i] /= weights[i];
      }
    }
  }

  return {
    drums: outputs[0],
    bass: outputs[1],
    other: outputs[2],
    vocals: outputs[3]
  };
}

/**
 * Separate stems with Settings-driven shifts / overlap.
 * Injects advanced knobs onto the processor instance for pipeline tests.
 */
export async function separateDemucsWithAdvancedOptions(
  demucsMod: DemucsWebModule,
  demucs: DemucsProcessorLike,
  left: Float32Array,
  right: Float32Array,
  advancedInput?: DemucsAdvancedSettingsInput | DemucsAdvancedSettings | null
): Promise<DemucsSeparationResult> {
  const advanced = coerceDemucsAdvancedSettings(advancedInput);
  demucs.demucsShifts = advanced.demucsShifts;
  demucs.demucsSegmentSize = advanced.demucsSegmentSize;
  demucs.demucsOverlap = advanced.demucsOverlap;
  // Reflect overlap on mutable CONSTANTS for observability.
  demucsMod.CONSTANTS.SEGMENT_OVERLAP = advanced.demucsOverlap;

  const passes = advanced.demucsShifts + 1;
  const results: DemucsSeparationResult[] = [];
  for (let s = 0; s < passes; s++) {
    const shiftSamples =
      s === 0
        ? 0
        : Math.floor((s * demucsMod.CONSTANTS.TRAINING_SAMPLES) / (passes * 4));
    const leftIn = circularShift(left, shiftSamples);
    const rightIn = circularShift(right, shiftSamples);
    const sep = await separateOnce(
      demucs,
      demucsMod,
      leftIn,
      rightIn,
      advanced.demucsOverlap,
      { offset: s / passes, span: 1 / passes }
    );
    if (shiftSamples !== 0) {
      results.push({
        drums: {
          left: circularShift(sep.drums.left, -shiftSamples),
          right: circularShift(sep.drums.right, -shiftSamples)
        },
        bass: {
          left: circularShift(sep.bass.left, -shiftSamples),
          right: circularShift(sep.bass.right, -shiftSamples)
        },
        other: {
          left: circularShift(sep.other.left, -shiftSamples),
          right: circularShift(sep.other.right, -shiftSamples)
        },
        vocals: {
          left: circularShift(sep.vocals.left, -shiftSamples),
          right: circularShift(sep.vocals.right, -shiftSamples)
        }
      });
    } else {
      results.push(sep);
    }
  }
  return averageStems(results);
}

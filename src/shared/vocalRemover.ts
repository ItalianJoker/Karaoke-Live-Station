/**
 * Vocal remover method catalog shared by Settings, AudioGraph, and model manager.
 *
 * Algorithmic methods are realtime Web Audio mid/side DSP.
 * AI methods run offline (async separate → crossfade) with ONNX models cached under userData.
 */

/** Classical realtime DSP algorithms (no download). */
export type AlgorithmicVocalRemoverMethod =
  | 'centerCancelBassKeep'
  | 'centerCancel'
  | 'softMid';

/** Offline on-device AI models (download once, then fully offline). */
export type AiVocalRemoverMethod = 'aiMdxKaraoke2' | 'aiHtDemucs' | 'aiBsRoformer';

export type VocalRemoverMethod = AlgorithmicVocalRemoverMethod | AiVocalRemoverMethod;

export const ALGORITHMIC_VOCAL_REMOVER_METHODS: AlgorithmicVocalRemoverMethod[] = [
  'centerCancelBassKeep',
  'centerCancel',
  'softMid'
];

export const AI_VOCAL_REMOVER_METHODS: AiVocalRemoverMethod[] = [
  'aiMdxKaraoke2',
  'aiHtDemucs',
  'aiBsRoformer'
];

export const ALL_VOCAL_REMOVER_METHODS: VocalRemoverMethod[] = [
  ...ALGORITHMIC_VOCAL_REMOVER_METHODS,
  ...AI_VOCAL_REMOVER_METHODS
];

export function isAiVocalRemoverMethod(method: string): method is AiVocalRemoverMethod {
  return (AI_VOCAL_REMOVER_METHODS as string[]).includes(method);
}

export function isAlgorithmicVocalRemoverMethod(
  method: string
): method is AlgorithmicVocalRemoverMethod {
  return (ALGORITHMIC_VOCAL_REMOVER_METHODS as string[]).includes(method);
}

export function isVocalRemoverMethod(method: string): method is VocalRemoverMethod {
  return (ALL_VOCAL_REMOVER_METHODS as string[]).includes(method);
}

/** Stable model ids used for on-disk filenames and IPC. */
export type OfflineVocalModelId = 'mdxKaraoke2' | 'htDemucs' | 'bsRoformer';

export function methodToModelId(method: AiVocalRemoverMethod): OfflineVocalModelId {
  switch (method) {
    case 'aiMdxKaraoke2':
      return 'mdxKaraoke2';
    case 'aiHtDemucs':
      return 'htDemucs';
    case 'aiBsRoformer':
      return 'bsRoformer';
  }
}

export type OfflineVocalModelMeta = {
  id: OfflineVocalModelId;
  /** Approximate download size shown in Settings (MB). */
  approxSizeMb: number;
  /** Minimum accepted file size for integrity check (bytes). */
  minBytes: number;
  /** Expected SHA-256 when known (empty = size-only check). */
  sha256?: string;
  filename: string;
  url: string;
  /** Human label for logs / progress. */
  label: string;
};

/**
 * Catalog of downloadable ONNX weights.
 * URLs point at public Hugging Face / demucs-web mirrors — first use only; then offline.
 */
export const OFFLINE_VOCAL_MODELS: Record<OfflineVocalModelId, OfflineVocalModelMeta> = {
  mdxKaraoke2: {
    id: 'mdxKaraoke2',
    approxSizeMb: 53,
    minBytes: 40 * 1024 * 1024,
    // Politrees/UVR_resources UVR_MDXNET_KARA_2.onnx
    sha256: 'bf32e15105a09c0f7dddd2b67346146334d6f3ecb399ed7638eba2ab07cbf5f4',
    filename: 'UVR_MDXNET_KARA_2.onnx',
    url: 'https://huggingface.co/Politrees/UVR_resources/resolve/main/MDXNet_models/UVR_MDXNET_KARA_2.onnx',
    label: 'UVR-MDX-NET Karaoke 2'
  },
  htDemucs: {
    id: 'htDemucs',
    approxSizeMb: 172,
    minBytes: 100 * 1024 * 1024,
    filename: 'htdemucs_embedded.onnx',
    // Must match demucs-web CONSTANTS.DEFAULT_MODEL_URL
    url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
    label: 'HTDemucs v4'
  },
  bsRoformer: {
    id: 'bsRoformer',
    approxSizeMb: 158,
    minBytes: 100 * 1024 * 1024,
    filename: 'bs_roformer_ep317_sdr12.9755_quantized_uint8.onnx',
    // ViperX BS-RoFormer quantized uint8 — lighter Electron-friendly export
    url: 'https://huggingface.co/xycld/BS-RoFormer-ONNX/resolve/main/bs_roformer_ep317_sdr12.9755_quantized_uint8.onnx',
    label: 'BS-Roformer (ViperX)'
  }
};

export type VocalModelDownloadProgress = {
  modelId: OfflineVocalModelId;
  phase: 'download' | 'verify' | 'ready' | 'error';
  loaded: number;
  total: number;
  message: string;
};

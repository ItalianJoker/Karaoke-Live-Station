/**
 * Vocal remover method catalog shared by Settings, Download Instrumental, and AudioGraph.
 *
 * Algorithmic methods are realtime Web Audio mid/side DSP (live Rimozione Vocale).
 * AI methods are offline ONNX models used by Download Instrumental (not live dual-stem).
 */

/** Classical realtime DSP algorithms (no download). */
export type AlgorithmicVocalRemoverMethod =
  | 'centerCancelBassKeep'
  | 'centerCancel'
  | 'softMid';

/**
 * Offline on-device AI models (download once into userData/models, then fully offline).
 * Download Instrumental Settings only offers Karaoke 2 / HTDemucs; `aiBsRoformer`
 * remains in the type/catalog for orphaned cache + legacy coerce → Karaoke 2.
 */
export type AiVocalRemoverMethod = 'aiMdxKaraoke2' | 'aiHtDemucs' | 'aiBsRoformer';

/** AI methods selectable for Download Instrumental (Settings). */
export type InstrumentalAiMethod = 'aiMdxKaraoke2' | 'aiHtDemucs';

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

/** Download Instrumental dropdown — AI only (no DSP / no Roformer). */
export const INSTRUMENTAL_AI_METHODS: InstrumentalAiMethod[] = [
  'aiMdxKaraoke2',
  'aiHtDemucs'
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

/** Persist Settings values for Download Instrumental; accepts algorithmic + AI ids. */
export function coerceVocalRemoverMethod(method: string | undefined | null): VocalRemoverMethod {
  if (method && isVocalRemoverMethod(method)) return method;
  return 'centerCancelBassKeep';
}

/**
 * Live Rimozione Vocale stays algorithmic-only (no Separazione / dual-stem / AI).
 * Unknown or AI ids coerce to centerCancelBassKeep.
 */
export function coerceAlgorithmicVocalRemoverMethod(
  method: string | undefined | null
): AlgorithmicVocalRemoverMethod {
  if (method && isAlgorithmicVocalRemoverMethod(method)) return method;
  return 'centerCancelBassKeep';
}

export function isInstrumentalAiMethod(method: string): method is InstrumentalAiMethod {
  return (INSTRUMENTAL_AI_METHODS as string[]).includes(method);
}

/**
 * Download Instrumental method. Defaults to recommended AI (UVR-MDX Karaoke 2).
 * Unknown, DSP, and Roformer ids coerce to `aiMdxKaraoke2` (Settings is AI-only).
 */
export function coerceInstrumentalVocalRemoverMethod(
  method: string | undefined | null
): InstrumentalAiMethod {
  if (method && isInstrumentalAiMethod(method)) return method;
  return 'aiMdxKaraoke2';
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
  /**
   * Catalog revision string. When changed, ensureModel treats the remote as newer
   * and re-downloads even if URL/SHA are unchanged. Prefer bumping URL/SHA when the
   * bytes change; bump version for metadata-only catalog refreshes.
   */
  version: string;
  /** Human label for logs / progress. */
  label: string;
};

/**
 * Catalog of downloadable ONNX weights for Download Instrumental.
 * URLs point at public Hugging Face / demucs-web mirrors — first use only; then offline.
 * Update only when missing, corrupt, or catalog URL/SHA/version is newer than local meta.
 */
export const OFFLINE_VOCAL_MODELS: Record<OfflineVocalModelId, OfflineVocalModelMeta> = {
  mdxKaraoke2: {
    id: 'mdxKaraoke2',
    approxSizeMb: 53,
    minBytes: 40 * 1024 * 1024,
    // Tha456/uvr5-models mirror of UVR_MDXNET_KARA_2.onnx (same SHA as Politrees historical upload).
    sha256: 'bf32e15105a09c0f7dddd2b67346146334d6f3ecb399ed7638eba2ab07cbf5f4',
    filename: 'UVR_MDXNET_KARA_2.onnx',
    url: 'https://huggingface.co/Tha456/uvr5-models/resolve/main/UVR_MDXNET_KARA_2.onnx',
    version: '1',
    label: 'UVR-MDX-NET Karaoke 2'
  },
  htDemucs: {
    id: 'htDemucs',
    approxSizeMb: 172,
    minBytes: 100 * 1024 * 1024,
    filename: 'htdemucs_embedded.onnx',
    // Must match demucs-web CONSTANTS.DEFAULT_MODEL_URL
    url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
    version: '1',
    label: 'HTDemucs v4'
  },
  bsRoformer: {
    id: 'bsRoformer',
    approxSizeMb: 158,
    minBytes: 100 * 1024 * 1024,
    filename: 'bs_roformer_ep317_sdr12.9755_quantized_uint8.onnx',
    // ViperX BS-RoFormer quantized uint8 — lighter Electron-friendly export
    url: 'https://huggingface.co/xycld/BS-RoFormer-ONNX/resolve/main/bs_roformer_ep317_sdr12.9755_quantized_uint8.onnx',
    version: '1',
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

/**
 * YouTube results whose titles already say Karaoke / instrumental should not
 * show the "Download Instrumental" action (case-insensitive).
 */
export function isInstrumentalDownloadEligibleTitle(title: string | undefined | null): boolean {
  if (!title || !title.trim()) return false;
  return !/karaoke|instrumental/i.test(title);
}

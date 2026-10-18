/**
 * Whisper.cpp STT catalog + settings helpers for karaoke word-level overlay.
 * Models live ONLY under `<userData>/models/whisper/` — never in the installer.
 */

export type WhisperModelId = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

export const WHISPER_MODEL_IDS: readonly WhisperModelId[] = [
  'tiny',
  'base',
  'small',
  'medium',
  'large-v3'
] as const;

export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = 'medium';

export type WhisperModelCatalogEntry = {
  id: WhisperModelId;
  /** ggml filename on disk under userData/models/whisper/ */
  filename: string;
  /** HuggingFace ggml download URL (ggerganov/whisper.cpp). */
  url: string;
  /** Approximate catalog size for UI honesty (bytes). */
  approxBytes: number;
  /** Minimum acceptable download size (integrity floor). */
  minBytes: number;
  /** Relative singing quality label key suffix (i18n). */
  qualityKey: 'poor' | 'low' | 'medium' | 'good' | 'best';
  /** Relative speed label key suffix. */
  speedKey: 'fastest' | 'fast' | 'moderate' | 'slow' | 'slowest';
  /** HW / RAM expectation (short EN for docs; UI uses i18n). */
  hwHintKey: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  /** UI badge: default product model. */
  isDefault: boolean;
};

/**
 * Official ggml models from HuggingFace ggerganov/whisper.cpp.
 * Never packaged with the app — on-demand into userData only.
 */
export const WHISPER_MODELS: Record<WhisperModelId, WhisperModelCatalogEntry> = {
  tiny: {
    id: 'tiny',
    filename: 'ggml-tiny.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    approxBytes: 75 * 1024 * 1024,
    minBytes: 30 * 1024 * 1024,
    qualityKey: 'poor',
    speedKey: 'fastest',
    hwHintKey: 'tiny',
    isDefault: false
  },
  base: {
    id: 'base',
    filename: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    approxBytes: 150 * 1024 * 1024,
    minBytes: 70 * 1024 * 1024,
    qualityKey: 'low',
    speedKey: 'fast',
    hwHintKey: 'base',
    isDefault: false
  },
  small: {
    id: 'small',
    filename: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    approxBytes: 500 * 1024 * 1024,
    minBytes: 200 * 1024 * 1024,
    qualityKey: 'medium',
    speedKey: 'moderate',
    hwHintKey: 'small',
    isDefault: false
  },
  medium: {
    id: 'medium',
    filename: 'ggml-medium.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
    approxBytes: 1500 * 1024 * 1024,
    minBytes: 700 * 1024 * 1024,
    qualityKey: 'good',
    speedKey: 'slow',
    hwHintKey: 'medium',
    isDefault: true
  },
  'large-v3': {
    id: 'large-v3',
    filename: 'ggml-large-v3.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
    approxBytes: 3 * 1024 * 1024 * 1024,
    minBytes: 1400 * 1024 * 1024,
    qualityKey: 'best',
    speedKey: 'slowest',
    hwHintKey: 'large',
    isDefault: false
  }
};

export type WhisperModelDownloadProgress = {
  modelId: WhisperModelId;
  phase: 'download' | 'verify' | 'ready' | 'error';
  loaded: number;
  total: number;
  message?: string;
};

export type WhisperModelDiskInfo = {
  modelId: WhisperModelId;
  present: boolean;
  bytesOnDisk: number;
  path?: string;
};

export type WhisperEngineStatus = {
  binaryReady: boolean;
  binaryPath?: string;
  modelsDir: string;
  models: WhisperModelDiskInfo[];
};

/** Coerce persisted setting to a whitelist model id (default medium). */
export function coerceWhisperModelId(raw: unknown): WhisperModelId {
  const s = String(raw || '').trim();
  if ((WHISPER_MODEL_IDS as readonly string[]).includes(s)) {
    return s as WhisperModelId;
  }
  return DEFAULT_WHISPER_MODEL_ID;
}

export function formatBytesApprox(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Vocal remover method catalog shared by Settings and AudioGraph.
 * Algorithmic methods are realtime Web Audio mid/side DSP (no ML / ONNX).
 */

/** Classical realtime DSP algorithms (no download). */
export type AlgorithmicVocalRemoverMethod =
  | 'centerCancelBassKeep'
  | 'centerCancel'
  | 'softMid';

/** @deprecated Alias — only algorithmic methods remain. */
export type VocalRemoverMethod = AlgorithmicVocalRemoverMethod;

export const ALGORITHMIC_VOCAL_REMOVER_METHODS: AlgorithmicVocalRemoverMethod[] = [
  'centerCancelBassKeep',
  'centerCancel',
  'softMid'
];

export const ALL_VOCAL_REMOVER_METHODS: VocalRemoverMethod[] = [
  ...ALGORITHMIC_VOCAL_REMOVER_METHODS
];

export function isAlgorithmicVocalRemoverMethod(
  method: string
): method is AlgorithmicVocalRemoverMethod {
  return (ALGORITHMIC_VOCAL_REMOVER_METHODS as string[]).includes(method);
}

export function isVocalRemoverMethod(method: string): method is VocalRemoverMethod {
  return (ALL_VOCAL_REMOVER_METHODS as string[]).includes(method);
}

/** Normalize persisted settings that may still hold removed AI method ids. */
export function coerceVocalRemoverMethod(method: string | undefined | null): VocalRemoverMethod {
  if (method && isVocalRemoverMethod(method)) return method;
  return 'centerCancelBassKeep';
}

/**
 * Vendored ONNX Runtime Web WASM assets.
 *
 * Permanent home at runtime: `<userData>/ort/` (seeded from packaged `public/ort/`).
 * Never load these from OS temp — Electron/Vite may rewrite import.meta.url to Temp and
 * break relative fetch of .mjs/.wasm (Windows: "no available backend found").
 */

/** CPU WASM pair used by our wasm execution provider (not WebGPU/JSEP). */
export const ORT_WASM_CPU_FILES = {
  wasm: 'ort-wasm-simd-threaded.wasm',
  mjs: 'ort-wasm-simd-threaded.mjs'
} as const;

/**
 * Full set copied into userData so any ORT backend variant can resolve without
 * falling back to ephemeral paths next to the bundled JS.
 */
export const ORT_WASM_ASSET_FILES: readonly string[] = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
  'ort-wasm-simd-threaded.jspi.mjs'
];

/** Sidecar manifest written next to seeded assets (version / source bookkeeping). */
export const ORT_WASM_MANIFEST_FILENAME = 'ort-wasm-manifest.json';

export type OrtWasmManifest = {
  /** App version that last seeded these files. */
  appVersion: string;
  /** Absolute source directory used for the last successful seed. */
  sourceDir: string;
  /** Per-file byte sizes at seed time. */
  files: Record<string, number>;
  seededAt: string;
};

export type OrtWasmPathsPayload = {
  /** Directory prefix for ort.env.wasm.wasmPaths (must end with /). */
  wasmPathsPrefix: string;
  /** Explicit absolute URLs for the CPU WASM pair (preferred override). */
  wasmFilePaths: {
    wasm: string;
    mjs: string;
  };
  ortDir: string;
};

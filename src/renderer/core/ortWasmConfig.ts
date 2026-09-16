/**
 * Configure onnxruntime-web WASM to load from durable karaoke://ort/ URLs
 * (assets seeded under `<userData>/ort/`), never from OS Temp / Vite blob paths.
 */
import * as ort from 'onnxruntime-web';

let ortConfigured = false;
let ortConfigurePromise: Promise<void> | null = null;

function applyOrtFlags(wasmPaths: string | { wasm: string; mjs: string }): void {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  // Disable proxy worker — Electron/bundlers often break Worker + import.meta.url → Temp.
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = wasmPaths;
}

/**
 * Ensures ORT WASM paths point at `<userData>/ort` via karaoke://ort/.
 * Safe to call repeatedly; concurrent callers share one IPC round-trip.
 */
export async function configureOrtWasmFromUserData(): Promise<void> {
  if (ortConfigured) return;
  if (ortConfigurePromise) return ortConfigurePromise;

  ortConfigurePromise = (async () => {
    const api = typeof window !== 'undefined' ? window.karaokeApi?.ortWasm : undefined;
    if (!api?.ensure) {
      // Dev / non-Electron fallback: relative public/ort (Vite serves publicDir).
      applyOrtFlags('./ort/');
      ortConfigured = true;
      return;
    }

    const result = await api.ensure();
    if (!result?.success) {
      const err = new Error(
        result?.error ||
          'ORT WASM backend unavailable — could not seed durable assets under app data (userData/ort)'
      );
      (err as Error & { code?: string }).code = 'ORT_WASM_BACKEND';
      throw err;
    }

    // Prefer explicit absolute URLs so ORT never resolves relative to a Temp .mjs.
    if (result.wasmFilePaths?.wasm && result.wasmFilePaths?.mjs) {
      applyOrtFlags({
        wasm: result.wasmFilePaths.wasm,
        mjs: result.wasmFilePaths.mjs
      });
    } else if (result.wasmPathsPrefix) {
      applyOrtFlags(result.wasmPathsPrefix);
    } else {
      applyOrtFlags('karaoke://ort/');
    }
    ortConfigured = true;
  })();

  try {
    await ortConfigurePromise;
  } finally {
    ortConfigurePromise = null;
  }
}

/** Human-readable toast text for ORT / AI backend failures. */
export function formatOrtBackendError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('no available backend') ||
    lower.includes('ort_wasm') ||
    (lower.includes('wasm') && (lower.includes('failed to f') || lower.includes('typeerror'))) ||
    lower.includes('jsep.mjs') ||
    lower.includes('ort-wasm')
  ) {
    return (
      'AI vocal remover backend failed to load (ONNX Runtime WASM). ' +
      'Runtime files must live under app data (userData/ort), not OS Temp. ' +
      'Try again after restart; if it persists, reinstall or clear corrupt userData/ort. ' +
      `(${raw.slice(0, 180)})`
    );
  }
  return raw || 'AI vocal remover failed';
}

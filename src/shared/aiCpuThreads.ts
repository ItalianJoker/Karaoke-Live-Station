/**
 * AI ORT WASM thread count for Download Instrumental (MDX / HTDemucs).
 *
 * `aiCpuThreads` in AppSettings is `number | null`:
 * - `null` / missing → use all detected logical cores (default max power)
 * - finite integer → clamp to [1, totalCpus] at resolve time
 *
 * Never returns ≤0 or NaN — ORT rejects invalid `numThreads`.
 */

/** Fallback when `navigator.hardwareConcurrency` / `os.cpus()` is unavailable. */
export const AI_CPU_THREADS_UI_FALLBACK = 4;

/**
 * Resolve effective ORT WASM thread count.
 *
 * @param configured - Persisted setting (`null` = all cores)
 * @param totalCpus - Detected logical CPU count (must be ≥ 1 after sanitize)
 */
export function resolveAiCpuThreads(
  configured: number | null | undefined,
  totalCpus: number
): number {
  const n = Math.max(1, Math.floor(Number(totalCpus)) || 1);
  if (configured == null || configured === undefined) return n;
  const raw = typeof configured === 'number' ? configured : Number(configured);
  if (!Number.isFinite(raw)) return n;
  const t = Math.floor(raw);
  if (t < 1) return 1;
  return Math.min(t, n);
}

/**
 * Coerce unknown persist/UI values to `number | null`.
 * Corrupt / non-finite → `null` (all cores). Does not clamp to machine N
 * (N varies per host; clamp happens in {@link resolveAiCpuThreads}).
 */
export function coerceAiCpuThreads(value: unknown): number | null {
  if (value == null || value === '' || value === 'auto' || value === 'null') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const t = Math.floor(n);
  if (t < 1) return null;
  return t;
}

/** Detect logical cores in the renderer (Settings UI). */
export function detectUiCpuCoreCount(): number {
  if (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number') {
    const n = Math.floor(navigator.hardwareConcurrency);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return AI_CPU_THREADS_UI_FALLBACK;
}

/** Clamp a UI edit into [1, N] (never ≤0 / NaN). */
export function clampAiCpuThreadsForUi(value: unknown, totalCpus: number): number {
  const asNum =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : value == null
          ? null
          : Number(value);
  return resolveAiCpuThreads(
    asNum !== null && Number.isFinite(asNum as number) ? (asNum as number) : null,
    totalCpus
  );
}

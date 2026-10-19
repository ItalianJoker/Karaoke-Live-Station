/**
 * Cross-platform Instrumental AI GPU preference (Win / macOS / Linux).
 * Vendor-neutral: discrete / high-performance vs integrated / low-power —
 * not NVIDIA-only. Process switches + WebGPU/ORT powerPreference hints.
 */

export type AiGpuPreference = 'high-performance' | 'low-power' | 'system';

export const DEFAULT_AI_GPU_PREFERENCE: AiGpuPreference = 'high-performance';

/** Coerce persisted/UI values; default prefer discrete / high-performance. */
export function coerceAiGpuPreference(value: unknown): AiGpuPreference {
  if (value === 'low-power' || value === 'low' || value === 'integrated') {
    return 'low-power';
  }
  if (value === 'system' || value === 'default' || value === 'auto') {
    return 'system';
  }
  if (
    value === 'high-performance' ||
    value === 'high' ||
    value === 'discrete' ||
    value === true
  ) {
    return 'high-performance';
  }
  // Missing / corrupt → prefer discrete (product default)
  return DEFAULT_AI_GPU_PREFERENCE;
}

/**
 * Map Settings preference → WebGPU / ORT `powerPreference`.
 * `system` leaves Chromium default (omit hint / use high-performance as soft default).
 */
export function aiGpuPreferenceToPowerPreference(
  pref: AiGpuPreference
): 'high-performance' | 'low-power' {
  if (pref === 'low-power') return 'low-power';
  return 'high-performance';
}

/** Chromium switches applied before `app.ready` (all OSes). */
export type AiGpuCommandLineSwitches = {
  forceHighPerformance: boolean;
  forceLowPower: boolean;
  webgpuPowerPreference?: 'high-performance' | 'low-power';
};

export function aiGpuPreferenceToCommandLine(
  pref: AiGpuPreference
): AiGpuCommandLineSwitches {
  if (pref === 'high-performance') {
    return {
      forceHighPerformance: true,
      forceLowPower: false,
      webgpuPowerPreference: 'high-performance'
    };
  }
  if (pref === 'low-power') {
    return {
      forceHighPerformance: false,
      forceLowPower: true,
      webgpuPowerPreference: 'low-power'
    };
  }
  return { forceHighPerformance: false, forceLowPower: false };
}

/** Heuristic GPU class from a device/adapter label (vendor-neutral). */
export function classifyGpuAdapterLabel(
  label: string | undefined | null
): 'high-performance' | 'low-power' | 'unknown' {
  const s = String(label || '').toLowerCase();
  if (!s.trim()) return 'unknown';
  // Integrated / low-power patterns
  if (
    /intel\s*(uhd|iris|hd\s*graphics)|radeon\s*graphics(?!\s*rx)|apple\s*m\d|mali-|adreno|uhd\s*graphics|iris\s*xe/.test(
      s
    )
  ) {
    // Apple Silicon is unified — treat as high-performance single GPU for preference UI
    if (/apple\s*m\d/.test(s)) return 'high-performance';
    return 'low-power';
  }
  // Discrete / high-performance patterns
  if (
    /nvidia|geforce|rtx|gtx|quadro|tesla|amd\s*radeon\s*rx|radeon\s*pro|radeon\s*rx|arc\s*a\d/.test(
      s
    )
  ) {
    return 'high-performance';
  }
  return 'unknown';
}

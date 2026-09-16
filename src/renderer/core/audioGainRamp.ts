/**
 * Schedules a click-free GainNode ramp that works reliably in Chromium/Electron.
 *
 * After `cancelScheduledValues`, a bare `linearRampToValueAtTime` often becomes a
 * no-op (dry path stays at 1 → vocal remover appears to do nothing). Always anchor
 * with `setValueAtTime` first.
 */
export function rampAudioParam(
  param: AudioParam,
  target: number,
  durationSec: number,
  audioContext: BaseAudioContext
): void {
  const now = audioContext.currentTime;
  const safeDuration = Math.max(0.001, durationSec);
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + safeDuration);
}

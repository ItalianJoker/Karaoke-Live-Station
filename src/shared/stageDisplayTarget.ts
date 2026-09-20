/**
 * Stage (Palco) display placement helpers.
 *
 * Pure functions — safe for main-process use and unit tests without Electron.
 * Product expectation (USER_MANUAL): Regia on primary, Stage on the extended
 * secondary monitor (TV / projector). When only one display exists, keep a
 * manageable window so Regia is not covered by exclusive fullscreen.
 */

export type StageDisplayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StageDisplayInfo = {
  id: number;
  bounds: StageDisplayBounds;
};

export type StagePlacement = {
  bounds: StageDisplayBounds;
  /** True when a non-primary (audience) display was selected. */
  usedExternalDisplay: boolean;
  displayId: number;
};

const DEFAULT_STAGE_WIDTH = 1280;
const DEFAULT_STAGE_HEIGHT = 720;

/**
 * Picks bounds for the Stage window.
 *
 * @param displays - All connected displays from `screen.getAllDisplays()`
 * @param primaryId - `screen.getPrimaryDisplay().id`
 * @param options.windowWidth - Single-monitor window width (default 1280)
 * @param options.windowHeight - Single-monitor window height (default 720)
 * @returns Placement bounds + whether an external display was used
 *
 * Why external-first: with Regia maximized on the primary, an unplaced Stage
 * stays behind Control on display 1 — the TV still shows the OS desktop
 * (“Live non si vede nulla, solo il desktop”).
 */
export function resolveStagePlacement(
  displays: StageDisplayInfo[],
  primaryId: number,
  options?: { windowWidth?: number; windowHeight?: number }
): StagePlacement {
  const windowWidth = options?.windowWidth ?? DEFAULT_STAGE_WIDTH;
  const windowHeight = options?.windowHeight ?? DEFAULT_STAGE_HEIGHT;

  if (!Array.isArray(displays) || displays.length === 0) {
    return {
      bounds: { x: 0, y: 0, width: windowWidth, height: windowHeight },
      usedExternalDisplay: false,
      displayId: primaryId
    };
  }

  const external = displays.find((d) => d.id !== primaryId);
  const primary = displays.find((d) => d.id === primaryId);
  const target = external ?? primary ?? displays[0];
  const usedExternalDisplay = Boolean(external);

  if (usedExternalDisplay) {
    // Full bounds — caller enters fullscreen on this display after show().
    return {
      bounds: { ...target.bounds },
      usedExternalDisplay: true,
      displayId: target.id
    };
  }

  // Single monitor: centered window, never auto-fullscreen (would hide Regia).
  const width = Math.min(windowWidth, target.bounds.width);
  const height = Math.min(windowHeight, target.bounds.height);
  const x = target.bounds.x + Math.max(0, Math.floor((target.bounds.width - width) / 2));
  const y = target.bounds.y + Math.max(0, Math.floor((target.bounds.height - height) / 2));

  return {
    bounds: { x, y, width, height },
    usedExternalDisplay: false,
    displayId: target.id
  };
}

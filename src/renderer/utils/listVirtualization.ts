/**
 * Windowed list math for large library result sets (16k+).
 *
 * **Audience (humans):** Avoids mounting every row in the DOM while scrolling.
 *
 * **Audience (AI):** Pure helpers — no React. Keep overscan small; row height must
 * match the visual LibraryPanel row (~88px with thumbnail). Do not change catalog
 * / IPC contracts when wiring this into LibraryPanel.
 */

export interface VirtualWindow {
  /** First index to render (inclusive). */
  startIndex: number;
  /** Last index to render (exclusive). */
  endIndex: number;
  /** Spacer height above the visible window (px). */
  paddingTop: number;
  /** Spacer height below the visible window (px). */
  paddingBottom: number;
}

/**
 * Compute which slice of `itemCount` rows should mount for a scroll container.
 *
 * @param scrollTop - Current scroll offset of the list viewport
 * @param viewportHeight - Visible height of the list viewport
 * @param itemCount - Total number of items
 * @param rowHeight - Fixed row height in pixels
 * @param overscan - Extra rows above/below the viewport
 */
export function computeVirtualWindow(
  scrollTop: number,
  viewportHeight: number,
  itemCount: number,
  rowHeight: number,
  overscan = 8
): VirtualWindow {
  if (itemCount <= 0 || rowHeight <= 0 || viewportHeight < 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const safeScroll = Math.max(0, scrollTop);
  const startIndex = Math.max(0, Math.floor(safeScroll / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(itemCount, startIndex + visibleCount);
  const paddingTop = startIndex * rowHeight;
  const paddingBottom = Math.max(0, (itemCount - endIndex) * rowHeight);
  return { startIndex, endIndex, paddingTop, paddingBottom };
}

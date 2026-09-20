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

/**
 * Variable-height windowing (Studio Desk library cards grow with tags / wrap).
 * `rowHeights[i]` is the full stride including the row's bottom margin.
 */
export function computeVirtualWindowVariable(
  scrollTop: number,
  viewportHeight: number,
  rowHeights: number[],
  overscan = 8
): VirtualWindow {
  const itemCount = rowHeights.length;
  if (itemCount <= 0 || viewportHeight < 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const prefix = new Array<number>(itemCount + 1);
  prefix[0] = 0;
  for (let i = 0; i < itemCount; i++) {
    prefix[i + 1] = prefix[i] + Math.max(1, rowHeights[i] || 1);
  }
  const total = prefix[itemCount];
  const safeScroll = Math.max(0, Math.min(scrollTop, Math.max(0, total - 1)));

  let startIndex = 0;
  while (startIndex < itemCount && prefix[startIndex + 1] <= safeScroll) {
    startIndex++;
  }
  startIndex = Math.max(0, startIndex - overscan);

  const viewEnd = safeScroll + viewportHeight;
  let endIndex = startIndex;
  while (endIndex < itemCount && prefix[endIndex] < viewEnd) {
    endIndex++;
  }
  endIndex = Math.min(itemCount, endIndex + overscan);

  return {
    startIndex,
    endIndex,
    paddingTop: prefix[startIndex],
    paddingBottom: Math.max(0, total - prefix[endIndex])
  };
}

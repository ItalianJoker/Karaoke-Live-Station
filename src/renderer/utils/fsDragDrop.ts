/**
 * Helpers for OS filesystem drag-and-drop import into the library / queue.
 * Why: keep Files-type gating and path resolution in one place so LibraryPanel
 * and ControlWindow do not fight queue reorder DnD or diverge on path APIs.
 */

/** Window event: force-clear Library + Queue OS-file drop overlays (stuck-state teardown). */
export const OS_FILE_DRAG_END_EVENT = 'karaoke:os-file-drag-end';

/**
 * Broadcast end of an OS file drag session so every Regia surface clears overlays.
 * Why: dropping on Queue never hits LibraryPanel.onDrop; Chromium may empty
 * dataTransfer.types on dragleave — panels must not depend on that alone.
 */
export function dispatchOsFileDragEnd(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OS_FILE_DRAG_END_EVENT));
}

/**
 * True when the drag payload includes OS files (not in-app queue reorder).
 */
export function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types || []);
  return types.includes('Files');
}

/**
 * True when the pointer left the drop-zone host (not a child↔child bubble).
 * Why: `currentTarget === target` fails when leave fires from a child; requiring
 * Files in types also fails because Chromium often clears types on leave.
 *
 * @param e - React / DOM dragleave event with currentTarget + relatedTarget
 */
export function isDragLeavingHost(
  e: Pick<DragEvent, 'currentTarget' | 'relatedTarget'>
): boolean {
  const host = e.currentTarget as { contains?: (node: Node | null) => boolean } | null;
  // Duck-type Element.contains — avoids hard dependency on DOM globals in unit probes.
  if (!host || typeof host.contains !== 'function') return true;
  const related = e.relatedTarget;
  if (related != null && host.contains(related as Node)) {
    return false;
  }
  return true;
}

/**
 * Resolve absolute paths from a FileList / File[] using preload webUtils
 * (with legacy File.path fallback inside getPathForFile).
 */
export function resolveDroppedAbsolutePaths(files: ArrayLike<File> | null | undefined): string[] {
  if (!files || files.length === 0) return [];
  const api = typeof window !== 'undefined' ? window.karaokeApi?.library : undefined;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let absolute = '';
    try {
      absolute = api?.getPathForFile?.(file) || '';
    } catch {
      absolute = '';
    }
    if (!absolute) {
      const legacy = (file as File & { path?: string }).path;
      absolute = typeof legacy === 'string' ? legacy : '';
    }
    const trimmed = (absolute || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    paths.push(trimmed);
  }
  return paths;
}

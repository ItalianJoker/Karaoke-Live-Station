/**
 * Helpers for OS filesystem drag-and-drop import into the library / queue.
 * Why: keep Files-type gating and path resolution in one place so LibraryPanel
 * and ControlWindow do not fight queue reorder DnD or diverge on path APIs.
 */

/**
 * True when the drag payload includes OS files (not in-app queue reorder).
 */
export function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types || []);
  return types.includes('Files');
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

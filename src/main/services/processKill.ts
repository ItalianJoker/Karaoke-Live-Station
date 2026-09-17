/**
 * Helpers to stop yt-dlp / ffmpeg process trees cleanly on cancel.
 * yt-dlp often spawns ffmpeg as a child; SIGTERM on the parent alone can leave orphans.
 */
import { spawn, type ChildProcess } from 'child_process';

/**
 * Kill a child and its descendants.
 * Unix: prefers process-group kill when the child was spawned with `detached: true`.
 * Windows: uses `taskkill /T /F`.
 */
export function killProcessTree(child: ChildProcess | null | undefined): void {
  if (!child?.pid) return;
  const pid = child.pid;

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });
      return;
    }

    try {
      // Negative PID = kill the whole process group (requires detached spawn).
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: string }).code;
  return name === 'AbortError' || code === 'ABORT_ERR';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const err = new Error('Aborted');
  err.name = 'AbortError';
  throw err;
}

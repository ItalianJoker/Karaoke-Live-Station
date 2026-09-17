/**
 * karaoke://local URI helpers.
 *
 * Clients build media URLs as:
 *   karaoke://local/${encodeURIComponent(absolutePath)}
 *
 * URL parsers always give `pathname` a leading "/", so a POSIX absolute path
 * "/home/..." becomes pathname "/%2Fhome%2F..." → decode "//home/...".
 * POSIX treats paths that begin with "//" as implementation-defined, and
 * Electron's existsSync can fail even when the real file is at "/home/...".
 */

/**
 * Build a privileged karaoke://local URI from an absolute disk path (or pass
 * through an already-qualified karaoke/http/data URL).
 */
export function buildKaraokeLocalUri(absolutePath: string): string {
  const p = (absolutePath || '').trim();
  if (!p) return '';
  if (
    p.startsWith('karaoke://') ||
    p.startsWith('http://') ||
    p.startsWith('https://') ||
    p.startsWith('data:')
  ) {
    return p;
  }
  return `karaoke://local/${encodeURIComponent(p)}`;
}

/**
 * Resolve a karaoke://local URL pathname (from `new URL(request.url).pathname`)
 * back to a filesystem path suitable for existsSync / createReadStream.
 *
 * @param urlPathname - Raw URL pathname (may still be percent-encoded)
 * @param platform - Override for unit tests (`process.platform` by default)
 */
export function resolveKaraokeLocalFilePath(
  urlPathname: string,
  platform: NodeJS.Platform = process.platform
): string {
  let filePath = decodeURIComponent(urlPathname || '');

  if (platform === 'win32') {
    // URL pathname yields "/C:/Users/..." or "/C:\Users\..." — strip the slash.
    if (/^\/[A-Za-z]:[\\/]/.test(filePath)) {
      return filePath.slice(1);
    }
    // encodeURIComponent("\\\\server\\share\\file") → pathname "/\\server\share\file"
    if (filePath.startsWith('/\\')) {
      return filePath.slice(1);
    }
    // UNC with forward slashes ("//server/share/...") — keep as-is for Node.
    return filePath;
  }

  // POSIX: collapse leading "//" (or more) from percent-encoded absolute paths
  // so "//home/luca/..." → "/home/luca/...".
  if (filePath.startsWith('//')) {
    return `/${filePath.replace(/^\/+/, '')}`;
  }

  return filePath;
}

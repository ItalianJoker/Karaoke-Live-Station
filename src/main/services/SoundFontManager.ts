import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { Logger } from './Logger';
import {
  BUNDLED_SOUNDFONT_FILENAME,
  isEphemeralSoundFontPath
} from '../../shared/soundFontPath';

export { BUNDLED_SOUNDFONT_FILENAME, isEphemeralSoundFontPath } from '../../shared/soundFontPath';

/**
 * Seeds the bundled GeneralUser GS SoundFont into `<userData>/soundfonts/`.
 *
 * Same durability rule as ORT under `<userData>/ort/` and yt-dlp under
 * `<userData>/bin/`: package ships the bank via extraResources (and asar /
 * asarUnpack fallbacks); runtime prefers a stable real-disk copy so
 * `karaoke://local` createReadStream works on AppImage FUSE remounts and
 * never depends on a stale `/tmp/.mount_*` path from localStorage.
 *
 * Does not touch SpessaSynth scheduling / event priority / latencyHint.
 */
export class SoundFontManager {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public getSoundFontsDir(): string {
    return path.join(app.getPath('userData'), 'soundfonts');
  }

  public getManagedBundledPath(): string {
    return path.join(this.getSoundFontsDir(), BUNDLED_SOUNDFONT_FILENAME);
  }

  /**
   * Packaged + dev source candidates for the bundled bank.
   * Prefer real files outside asar (extraResources / asarUnpack) before asar
   * virtual paths — copyFileSync can read asar, but protocol streaming cannot.
   */
  public listBundledSourceCandidates(): string[] {
    const resources = process.resourcesPath || '';
    const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    const exeDir = app.isPackaged ? path.dirname(app.getPath('exe')) : appPath;

    return [
      // electron-builder extraResources → resources/soundfonts/
      path.join(resources, 'soundfonts', BUNDLED_SOUNDFONT_FILENAME),
      // asarUnpack fallbacks (packaged)
      path.join(resources, 'app.asar.unpacked', 'dist', 'soundfonts', BUNDLED_SOUNDFONT_FILENAME),
      path.join(resources, 'app.asar.unpacked', 'public', 'soundfonts', BUNDLED_SOUNDFONT_FILENAME),
      // Next to executable (unusual layouts)
      path.join(exeDir, 'soundfonts', BUNDLED_SOUNDFONT_FILENAME),
      path.join(exeDir, 'resources', 'soundfonts', BUNDLED_SOUNDFONT_FILENAME),
      // Dev / asar-virtual (usable as copy source via Electron fs)
      path.join(process.cwd(), 'public', 'soundfonts', BUNDLED_SOUNDFONT_FILENAME),
      path.join(appPath, 'public', 'soundfonts', BUNDLED_SOUNDFONT_FILENAME),
      path.join(appPath, 'dist', 'soundfonts', BUNDLED_SOUNDFONT_FILENAME)
    ].filter((p): p is string => Boolean(p));
  }

  public findBundledSource(): string | null {
    for (const candidate of this.listBundledSourceCandidates()) {
      try {
        if (candidate && fs.existsSync(candidate)) {
          const size = fs.statSync(candidate).size;
          // GeneralUser GS is ~31 MB; reject empty/corrupt stubs
          if (size > 1024 * 1024) {
            return candidate;
          }
        }
      } catch {
        // try next
      }
    }
    return null;
  }

  /**
   * Ensure `<userData>/soundfonts/GeneralUser-GS.sf2` exists (copy when missing
   * or size-mismatched). Returns the managed path, or a direct packaged path
   * if copy fails, or null if no bank is available.
   */
  public ensureBundledSoundFont(): string | null {
    const managed = this.getManagedBundledPath();
    const source = this.findBundledSource();

    if (!source) {
      if (fs.existsSync(managed)) {
        try {
          if (fs.statSync(managed).size > 1024 * 1024) {
            return managed;
          }
        } catch {
          // fall through
        }
      }
      this.logger.warn(
        'SoundFontManager',
        'Bundled GeneralUser-GS.sf2 not found in package (resources/soundfonts or asar)'
      );
      return null;
    }

    try {
      fs.mkdirSync(this.getSoundFontsDir(), { recursive: true });
      const srcSize = fs.statSync(source).size;
      let needsCopy = true;
      if (fs.existsSync(managed)) {
        try {
          needsCopy = fs.statSync(managed).size !== srcSize;
        } catch {
          needsCopy = true;
        }
      }
      if (needsCopy) {
        const tmp = `${managed}.tmp-${process.pid}`;
        fs.copyFileSync(source, tmp);
        fs.renameSync(tmp, managed);
        this.logger.info('SoundFontManager', 'Seeded bundled SoundFont under userData/soundfonts', {
          source,
          managed,
          bytes: srcSize
        });
      }
      return managed;
    } catch (err) {
      this.logger.warn(
        'SoundFontManager',
        `Failed to seed SoundFont to userData; using packaged path: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { source }
      );
      // Prefer a non-ephemeral packaged path when possible
      if (!isEphemeralSoundFontPath(source) && fs.existsSync(source)) {
        return source;
      }
      return fs.existsSync(managed) ? managed : source;
    }
  }
}

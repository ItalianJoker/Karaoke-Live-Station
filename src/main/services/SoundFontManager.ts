import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { Logger } from './Logger';
import {
  BUNDLED_SOUNDFONT_FILENAME,
  isEphemeralSoundFontPath,
  soundFontDisplayName,
  type SoundFontCatalogEntry
} from '../../shared/soundFontPath';

export {
  BUNDLED_SOUNDFONT_FILENAME,
  isEphemeralSoundFontPath,
  SOUND_FONT_OTHER_OPTION_ID,
  soundFontDisplayName,
  soundFontPathsEqual
} from '../../shared/soundFontPath';
export type { SoundFontCatalogEntry } from '../../shared/soundFontPath';

const MIN_SOUNDFONT_BYTES = 1024 * 1024;

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

  /** Directories that may contain packaged .sf2 banks (scan for dropdown). */
  private listBundledSoundFontDirs(): string[] {
    const resources = process.resourcesPath || '';
    const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    const exeDir = app.isPackaged ? path.dirname(app.getPath('exe')) : appPath;
    return [
      this.getSoundFontsDir(),
      path.join(resources, 'soundfonts'),
      path.join(resources, 'app.asar.unpacked', 'dist', 'soundfonts'),
      path.join(resources, 'app.asar.unpacked', 'public', 'soundfonts'),
      path.join(exeDir, 'soundfonts'),
      path.join(exeDir, 'resources', 'soundfonts'),
      path.join(process.cwd(), 'public', 'soundfonts'),
      path.join(appPath, 'public', 'soundfonts'),
      path.join(appPath, 'dist', 'soundfonts')
    ].filter(Boolean);
  }

  public findBundledSource(): string | null {
    for (const candidate of this.listBundledSourceCandidates()) {
      try {
        if (candidate && fs.existsSync(candidate)) {
          const size = fs.statSync(candidate).size;
          if (size > MIN_SOUNDFONT_BYTES) {
            return candidate;
          }
        }
      } catch {
        // try next
      }
    }
    return null;
  }

  private isUsableSoundFontFile(filePath: string): boolean {
    try {
      if (!filePath || !fs.existsSync(filePath)) return false;
      const st = fs.statSync(filePath);
      if (!st.isFile()) return false;
      // .sf2 banks are large; .dls system banks (Windows gm.dls) can be smaller
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.dls') return st.size > 64 * 1024;
      return st.size > MIN_SOUNDFONT_BYTES;
    } catch {
      return false;
    }
  }

  private collectSf2FromDir(dir: string): string[] {
    const out: string[] = [];
    try {
      if (!dir || !fs.existsSync(dir)) return out;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!/\.(sf2|sf3)$/i.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (this.isUsableSoundFontFile(full)) {
          out.push(full);
        }
      }
    } catch {
      // ignore unreadable dirs
    }
    return out;
  }

  private listOsSoundFontCandidates(): string[] {
    if (process.platform === 'win32') {
      return [path.join(process.env.WINDIR || 'C:\\Windows', 'System32\\drivers\\gm.dls')];
    }
    if (process.platform === 'darwin') {
      return [
        '/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls',
        '/Library/Audio/Sounds/Banks/default.sf2'
      ];
    }
    return [
      '/usr/share/sounds/sf2/default-GM.sf2',
      '/usr/share/sounds/sf2/FluidR3_GM.sf2',
      '/usr/share/soundfonts/default.sf2',
      '/usr/share/sounds/sf2/TimGM6mb.sf2',
      '/usr/share/soundfonts/FluidR3_GM.sf2'
    ];
  }

  /**
   * Catalog of present bundled + system SoundFonts for the Settings dropdown.
   * Always seeds the bundled GeneralUser bank first so AppImage installs show it.
   * Dedupes by basename; prefers managed userData copy over package/mount paths.
   */
  public listCatalog(): SoundFontCatalogEntry[] {
    this.ensureBundledSoundFont();

    const byKey = new Map<string, SoundFontCatalogEntry>();
    const managedDir = this.getSoundFontsDir();

    const rank = (filePath: string, kind: 'bundled' | 'system'): number => {
      if (kind === 'system') return 10;
      if (filePath.startsWith(managedDir)) return 0;
      if (isEphemeralSoundFontPath(filePath)) return 50;
      return 5;
    };

    const add = (filePath: string, kind: 'bundled' | 'system') => {
      if (!this.isUsableSoundFontFile(filePath)) return;
      if (kind === 'bundled' && isEphemeralSoundFontPath(filePath)) return;

      const fileName = path.basename(filePath);
      const key = fileName.toLowerCase();
      const next: SoundFontCatalogEntry = {
        id: `${kind}:${fileName}`,
        path: filePath,
        fileName,
        displayName: soundFontDisplayName(fileName),
        kind
      };
      const existing = byKey.get(key);
      if (!existing || rank(filePath, kind) < rank(existing.path, existing.kind)) {
        byKey.set(key, next);
      }
    };

    for (const dir of this.listBundledSoundFontDirs()) {
      for (const file of this.collectSf2FromDir(dir)) {
        add(file, 'bundled');
      }
    }

    const managed = this.getManagedBundledPath();
    if (this.isUsableSoundFontFile(managed)) {
      add(managed, 'bundled');
    }

    for (const osPath of this.listOsSoundFontCandidates()) {
      add(osPath, 'system');
    }

    const entries = Array.from(byKey.values());
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'bundled' ? -1 : 1;
      if (a.fileName === BUNDLED_SOUNDFONT_FILENAME) return -1;
      if (b.fileName === BUNDLED_SOUNDFONT_FILENAME) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return entries;
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
          if (fs.statSync(managed).size > MIN_SOUNDFONT_BYTES) {
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
      if (!isEphemeralSoundFontPath(source) && fs.existsSync(source)) {
        return source;
      }
      return fs.existsSync(managed) ? managed : source;
    }
  }
}

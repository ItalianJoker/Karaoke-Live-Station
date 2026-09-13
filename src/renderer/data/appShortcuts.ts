/**
 * Canonical keyboard shortcut inventory for Karaoke Live Station.
 *
 * Source of truth for:
 * - Control window live handler (`ControlWindow` keydown)
 * - Stage window fullscreen (F11 / Esc) — Stage only
 * - "?" / F1 ShortcutsHelpModal
 * - Settings → Shortcuts reference list
 *
 * Keep this list in sync when adding handlers. Labels use i18n keys under `shortcuts.*`.
 * Context notes help both human maintainers and AI analysis understand scope (global vs Stage).
 */

export type ShortcutCategory = 'playback' | 'audio' | 'navigation';

export interface AppShortcutDef {
  /** Display key chips (UI order). */
  keys: string[];
  /** i18n description key, e.g. shortcuts.playPause */
  descriptionKey: string;
  category: ShortcutCategory;
  /**
   * Where the handler lives:
   * - control: ControlWindow document keydown (ignored while typing in inputs except Esc)
   * - stage: StageWindow only (fullscreen)
   */
  context: 'control' | 'stage';
}

/**
 * Complete registered shortcuts. Order matches the help modal categories.
 * Do not list input-local keys (singer dropdown arrows) — those are widget chrome, not app shortcuts.
 */
export const APP_SHORTCUTS: AppShortcutDef[] = [
  // Playback (Control)
  { keys: ['Spazio'], descriptionKey: 'shortcuts.playPause', category: 'playback', context: 'control' },
  { keys: ['S'], descriptionKey: 'shortcuts.stop', category: 'playback', context: 'control' },
  { keys: ['R'], descriptionKey: 'shortcuts.restart', category: 'playback', context: 'control' },
  { keys: ['N'], descriptionKey: 'shortcuts.next', category: 'playback', context: 'control' },
  { keys: ['←'], descriptionKey: 'shortcuts.seekBackward', category: 'playback', context: 'control' },
  { keys: ['→'], descriptionKey: 'shortcuts.seekForward', category: 'playback', context: 'control' },

  // Audio & DSP (Control)
  { keys: ['M'], descriptionKey: 'shortcuts.mute', category: 'audio', context: 'control' },
  { keys: ['↑'], descriptionKey: 'shortcuts.volumeUp', category: 'audio', context: 'control' },
  { keys: ['↓'], descriptionKey: 'shortcuts.volumeDown', category: 'audio', context: 'control' },
  { keys: ['+', '-'], descriptionKey: 'shortcuts.pitchUpDown', category: 'audio', context: 'control' },
  { keys: ['Ctrl', '↑ / ↓'], descriptionKey: 'shortcuts.pitchCtrl', category: 'audio', context: 'control' },
  { keys: ['Ctrl', '← / →'], descriptionKey: 'shortcuts.speedCtrl', category: 'audio', context: 'control' },
  { keys: ['V'], descriptionKey: 'shortcuts.vocalRemover', category: 'audio', context: 'control' },
  { keys: ['D'], descriptionKey: 'shortcuts.ducking', category: 'audio', context: 'control' },

  // Navigation & displays
  { keys: ['1'], descriptionKey: 'shortcuts.tabQueue', category: 'navigation', context: 'control' },
  { keys: ['2'], descriptionKey: 'shortcuts.tabLibrary', category: 'navigation', context: 'control' },
  { keys: ['3'], descriptionKey: 'shortcuts.tabHistory', category: 'navigation', context: 'control' },
  { keys: ['Ctrl', 'F'], descriptionKey: 'shortcuts.searchFocus', category: 'navigation', context: 'control' },
  { keys: ['P'], descriptionKey: 'shortcuts.stageWindow', category: 'navigation', context: 'control' },
  { keys: ['F11', 'Esc'], descriptionKey: 'shortcuts.fullscreen', category: 'navigation', context: 'stage' },
  { keys: ['F1', '?'], descriptionKey: 'shortcuts.help', category: 'navigation', context: 'control' },
  { keys: ['Esc'], descriptionKey: 'shortcuts.closeModal', category: 'navigation', context: 'control' }
];

import type { KaraokeMediaTrack } from '../../shared/types';

/** Kind of media the Pre-Ascolto / preview modal should render. */
export type PreviewMediaKind = 'youtube' | 'video' | 'audio' | 'midi' | 'unsupported';

const VIDEO_EXT = ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v'];
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.wma'];
const MIDI_EXT = ['.mid', '.midi', '.kar'];

/**
 * Returns the lowercase file extension (including the leading dot) for a path or URI.
 */
export function getMediaExtension(pathOrUri?: string | null): string {
  if (!pathOrUri) return '';
  const cleaned = pathOrUri.split('?')[0].split('#')[0];
  const base = cleaned.includes('/') ? cleaned.substring(cleaned.lastIndexOf('/') + 1) : cleaned;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  try {
    return decodeURIComponent(base.slice(dot)).toLowerCase();
  } catch {
    return base.slice(dot).toLowerCase();
  }
}

/**
 * Classifies a library track for the preview modal so we do not assume a <video> element
 * for MIDI / MP3 / other audio-only formats.
 */
export function classifyPreviewMedia(track: KaraokeMediaTrack): PreviewMediaKind {
  if (track.source === 'youtube' && !track.localFilePath) {
    return 'youtube';
  }
  if (track.source === 'midi') {
    return 'midi';
  }

  const ext = getMediaExtension(track.localFilePath || track.uri);
  if (
    MIDI_EXT.includes(ext) ||
    track.uri.toLowerCase().includes('.mid') ||
    track.uri.toLowerCase().includes('.kar')
  ) {
    return 'midi';
  }
  if (VIDEO_EXT.includes(ext)) {
    return 'video';
  }
  if (AUDIO_EXT.includes(ext)) {
    return 'audio';
  }

  // Local file without a known extension: prefer an audio-safe player over a broken video frame.
  if (track.localFilePath) {
    return 'audio';
  }
  return 'unsupported';
}

/**
 * Applies HTMLMediaElement.setSinkId when available (Chromium / Electron).
 * Empty / "default" device ids map to the browser default output.
 */
export async function applyMediaSinkId(
  element: HTMLMediaElement | null | undefined,
  deviceId?: string | null
): Promise<boolean> {
  if (!element) return false;
  const media = element as HTMLMediaElement & {
    setSinkId?: (id: string) => Promise<void>;
  };
  if (typeof media.setSinkId !== 'function') return false;
  const sink = !deviceId || deviceId === 'default' || deviceId === 'communications' ? '' : deviceId;
  try {
    await media.setSinkId(sink);
    return true;
  } catch (err) {
    console.warn('Preview setSinkId failed:', err);
    return false;
  }
}

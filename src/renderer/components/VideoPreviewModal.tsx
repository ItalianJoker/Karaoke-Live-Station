import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Plus,
  Film,
  Headphones,
  User,
  Music,
  CheckCircle2,
  FileVideo,
  Info,
  Pause,
  Play
} from 'lucide-react';
import { KaraokeMediaTrack, SingerProfile } from '../../shared/types';
import {
  buildYouTubeEmbedSrc,
  YOUTUBE_EMBED_REFERRER_POLICY
} from '../../shared/youtubeEmbed';
import { AudioGraphManager } from '../core/AudioGraphManager';
import {
  applyMediaSinkId,
  classifyPreviewMedia,
  type PreviewMediaKind
} from '../utils/previewMedia';

interface VideoPreviewModalProps {
  isOpen: boolean;
  track: KaraokeMediaTrack | null;
  singers: SingerProfile[];
  enableFairQueue?: boolean;
  /** CUE / Pre-Ascolto headphone device id (settings.cueAudioDeviceId) */
  cueAudioDeviceId?: string;
  /** Main / stage master output device id (settings.masterAudioDeviceId) */
  masterAudioDeviceId?: string;
  /** SoundFont path for MIDI Pre-Ascolto synthesis */
  midiSoundFontPath?: string;
  onClose: () => void;
  onAddToQueue: (track: KaraokeMediaTrack, singerName?: string, placement?: 'auto' | 'end') => void;
}

/** Normalize Web Audio / settings device ids so "default" aliases compare equal. */
export function normalizeAudioDeviceId(deviceId?: string | null): string {
  const v = (deviceId || 'default').trim().toLowerCase();
  if (!v || v === 'default' || v === 'communications') return 'default';
  return v;
}

/** True when Pre-Ascolto (CUE) and Main Output share the same physical device. */
export function isSameCueAndMasterDevice(
  cueAudioDeviceId?: string | null,
  masterAudioDeviceId?: string | null
): boolean {
  return normalizeAudioDeviceId(cueAudioDeviceId) === normalizeAudioDeviceId(masterAudioDeviceId);
}

/**
 * Extracts human-readable version tags and publisher indicators from song titles and filenames
 * (e.g. KaraFun, Karaoke Academy Italia, con cori, Sing King, etc.)
 */
export function extractVersionTags(track: KaraokeMediaTrack): string[] {
  const text = `${track.title} ${track.localFilePath || ''} ${track.artist}`.toLowerCase();
  const tags: string[] = [];

  if (text.includes('karafun')) tags.push('KaraFun');
  if (text.includes('academy italia')) tags.push('Karaoke Academy Italia');
  if (text.includes('sing king')) tags.push('Sing King');
  if (text.includes('con cori') || text.includes('con i cori')) tags.push('Con Cori');
  if (text.includes('senza cori')) tags.push('Senza Cori');
  if (text.includes('piano')) tags.push('Piano / Acustico');
  if (text.includes('chitarra') || text.includes('acoustic')) tags.push('Acoustic');
  if (text.includes('strumentale') || text.includes('instrumental')) tags.push('Strumentale');
  if (text.includes('sunfly')) tags.push('Sunfly');
  if (text.includes('m-live') || text.includes('songservice')) tags.push('M-Live');

  return tags;
}

/**
 * VideoPreviewModal (Pre-Ascolto)
 *
 * Themed library preview dialog for video / audio / MIDI / YouTube.
 * Preview audio defaults to the CUE (Pre-Ascolto) device via setSinkId.
 * Volume and mute are owned only by the embedded player / MIDI transport — no separate volume bar.
 * Same-device warning fires when the user unmutes from those controls.
 */
export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({
  isOpen,
  track,
  singers,
  enableFairQueue = false,
  cueAudioDeviceId,
  masterAudioDeviceId,
  midiSoundFontPath,
  onClose,
  onAddToQueue
}) => {
  const { t } = useTranslation();
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const midiGraphRef = useRef<AudioGraphManager | null>(null);
  const unmuteAllowedRef = useRef(false);
  const suppressingUnmuteRef = useRef(false);

  const [selectedSinger, setSelectedSinger] = useState('');
  const [placementMode, setPlacementMode] = useState<'auto' | 'end'>('auto');
  const [isQueuedSuccess, setIsQueuedSuccess] = useState(false);
  const [pendingUnmuteConfirm, setPendingUnmuteConfirm] = useState(false);
  const [midiPlaying, setMidiPlaying] = useState(false);
  const [midiMuted, setMidiMuted] = useState(true);
  const [midiStatus, setMidiStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const mediaKind: PreviewMediaKind = track ? classifyPreviewMedia(track) : 'unsupported';

  const stopMidiPreview = () => {
    if (midiGraphRef.current) {
      try {
        midiGraphRef.current.stopMidiPlayback();
        midiGraphRef.current.dispose();
      } catch {
        // ignore teardown errors
      }
      midiGraphRef.current = null;
    }
    setMidiPlaying(false);
    setMidiStatus('idle');
  };

  // Reset when modal opens / track changes; tear down on close
  useEffect(() => {
    if (!isOpen || !track) {
      if (mediaRef.current) {
        mediaRef.current.pause();
        mediaRef.current.removeAttribute('src');
        mediaRef.current.load();
      }
      stopMidiPreview();
      return;
    }

    setIsQueuedSuccess(false);
    setSelectedSinger('');
    setPlacementMode('auto');
    setPendingUnmuteConfirm(false);
    unmuteAllowedRef.current = false;
    suppressingUnmuteRef.current = false;
    setMidiMuted(true);

    return () => {
      stopMidiPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/track boundary only
  }, [isOpen, track?.id, track?.uri]);

  // Route HTML media to the Pre-Ascolto (CUE) device; start muted for autoplay safety
  useEffect(() => {
    if (!isOpen || !track) return;
    if (mediaKind !== 'video' && mediaKind !== 'audio') return;
    const el = mediaRef.current;
    if (!el) return;

    el.muted = true;
    el.volume = 1;
    el.currentTime = 0;
    void applyMediaSinkId(el, cueAudioDeviceId).then(() => {
      el.play().catch(() => {
        // Autoplay may be blocked until user gesture; native controls still work.
      });
    });
  }, [isOpen, track?.id, track?.uri, mediaKind, cueAudioDeviceId]);

  // Same-device warning when unmuting from the embedded player controls
  useEffect(() => {
    if (!isOpen || !track) return;
    if (mediaKind !== 'video' && mediaKind !== 'audio') return;
    const el = mediaRef.current;
    if (!el) return;

    const onVolumeChange = () => {
      if (suppressingUnmuteRef.current) return;
      const unmuted = !el.muted && el.volume > 0;
      if (!unmuted) return;
      if (unmuteAllowedRef.current) return;
      if (!isSameCueAndMasterDevice(cueAudioDeviceId, masterAudioDeviceId)) {
        unmuteAllowedRef.current = true;
        return;
      }
      suppressingUnmuteRef.current = true;
      el.muted = true;
      setPendingUnmuteConfirm(true);
      queueMicrotask(() => {
        suppressingUnmuteRef.current = false;
      });
    };

    el.addEventListener('volumechange', onVolumeChange);
    return () => el.removeEventListener('volumechange', onVolumeChange);
  }, [isOpen, track?.id, mediaKind, cueAudioDeviceId, masterAudioDeviceId]);

  // MIDI Pre-Ascolto on a dedicated graph routed to the CUE sink
  useEffect(() => {
    if (!isOpen || !track || mediaKind !== 'midi') {
      stopMidiPreview();
      return;
    }

    let cancelled = false;
    const run = async () => {
      setMidiStatus('loading');
      stopMidiPreview();
      const graph = new AudioGraphManager();
      midiGraphRef.current = graph;
      try {
        await graph.initAudioContext();
        await graph.setAudioOutputDevice(cueAudioDeviceId || 'default');
        if (midiSoundFontPath) {
          await graph.loadSoundFont(midiSoundFontPath);
        }
        const res = await fetch(track.uri);
        if (!res.ok) throw new Error(`MIDI fetch failed: ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        await graph.loadMidiSong(buffer);
        graph.setMasterVolume(0, true);
        await graph.playMidi();
        if (cancelled) return;
        setMidiPlaying(true);
        setMidiMuted(true);
        setMidiStatus('ready');
      } catch (err) {
        console.error('MIDI Pre-Ascolto failed:', err);
        if (!cancelled) setMidiStatus('error');
      }
    };
    void run();

    return () => {
      cancelled = true;
      stopMidiPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, track?.id, track?.uri, mediaKind, cueAudioDeviceId, midiSoundFontPath]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !track) return null;

  const versionTags = extractVersionTags(track);

  const applyEmbeddedUnmute = () => {
    unmuteAllowedRef.current = true;
    setPendingUnmuteConfirm(false);
    const el = mediaRef.current;
    if (el) {
      suppressingUnmuteRef.current = true;
      el.muted = false;
      if (el.volume <= 0) el.volume = 1;
      queueMicrotask(() => {
        suppressingUnmuteRef.current = false;
      });
    }
  };

  const cancelEmbeddedUnmute = () => {
    setPendingUnmuteConfirm(false);
    const el = mediaRef.current;
    if (el) {
      suppressingUnmuteRef.current = true;
      el.muted = true;
      queueMicrotask(() => {
        suppressingUnmuteRef.current = false;
      });
    }
  };

  const requestMidiUnmute = () => {
    if (isSameCueAndMasterDevice(cueAudioDeviceId, masterAudioDeviceId) && !unmuteAllowedRef.current) {
      setPendingUnmuteConfirm(true);
      return;
    }
    unmuteAllowedRef.current = true;
    setMidiMuted(false);
    midiGraphRef.current?.setMasterVolume(1, false);
  };

  const toggleMidiMute = () => {
    if (midiMuted) {
      requestMidiUnmute();
    } else {
      setMidiMuted(true);
      setPendingUnmuteConfirm(false);
      midiGraphRef.current?.setMasterVolume(0, true);
    }
  };

  const toggleMidiPlay = async () => {
    const graph = midiGraphRef.current;
    if (!graph) return;
    if (midiPlaying) {
      graph.stopMidiPlayback();
      setMidiPlaying(false);
      return;
    }
    await graph.playMidi();
    setMidiPlaying(true);
  };

  const confirmUnmute = () => {
    if (mediaKind === 'midi') {
      unmuteAllowedRef.current = true;
      setPendingUnmuteConfirm(false);
      setMidiMuted(false);
      midiGraphRef.current?.setMasterVolume(1, false);
      return;
    }
    applyEmbeddedUnmute();
  };

  const handleAdd = () => {
    onAddToQueue(track, selectedSinger.trim() || undefined, placementMode);
    setIsQueuedSuccess(true);
    setTimeout(() => onClose(), 900);
  };

  const headerIcon =
    mediaKind === 'midi' || mediaKind === 'audio' ? (
      <Music className="w-4 h-4" />
    ) : (
      <Film className="w-4 h-4" />
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      data-testid="preascolto-preview-modal"
    >
      <div
        className="relative bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 px-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
            <div className="p-2 bg-indigo-950/60 border border-indigo-800/60 rounded-xl text-indigo-400 shrink-0">
              {headerIcon}
            </div>
            <div className="truncate min-w-0">
              <h3 className="font-bold text-sm text-white truncate flex items-center gap-2">
                <span className="truncate">{track.title}</span>
                <span className="text-slate-500 font-normal shrink-0">•</span>
                <span className="text-slate-400 font-medium text-xs truncate">{track.artist}</span>
              </h3>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {track.source === 'local_library' ? 'Locale' : track.source.toUpperCase()}
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-800/50 flex items-center gap-1">
                  <Headphones className="w-3 h-3" />
                  {t('player.cue')}
                </span>
                {versionTags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-800/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            title="Esc"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-y-auto space-y-4">
          {mediaKind === 'video' ? (
            <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-xl flex items-center justify-center">
              <video
                ref={mediaRef as React.RefObject<HTMLVideoElement>}
                src={track.uri}
                controls
                playsInline
                muted
                className="w-full h-full object-contain"
                data-testid="preview-video-element"
              />
            </div>
          ) : mediaKind === 'audio' ? (
            <div
              className="relative w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-xl flex flex-col items-center justify-center gap-4 p-8 min-h-[220px]"
              data-testid="preview-audio-surface"
            >
              <div className="w-20 h-20 rounded-2xl bg-indigo-950/60 border border-indigo-700/50 flex items-center justify-center text-indigo-300">
                <Music className="w-10 h-10" />
              </div>
              <div className="text-center space-y-1">
                <div className="text-sm font-semibold text-slate-100">{track.title}</div>
                <div className="text-xs text-slate-400">{track.artist}</div>
              </div>
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={track.uri}
                controls
                muted
                className="w-full max-w-md"
                data-testid="preview-audio-element"
              />
            </div>
          ) : mediaKind === 'youtube' ? (
            <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-xl">
              <iframe
                src={buildYouTubeEmbedSrc({
                  videoId: track.id,
                  windowOrigin: typeof window !== 'undefined' ? window.location.origin : undefined
                })}
                title={track.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy={YOUTUBE_EMBED_REFERRER_POLICY}
                className="w-full h-full border-0"
              />
            </div>
          ) : mediaKind === 'midi' ? (
            <div
              className="relative w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-xl flex flex-col items-center justify-center gap-4 p-8 min-h-[220px]"
              data-testid="preview-midi-surface"
            >
              <div className="w-20 h-20 rounded-2xl bg-indigo-950/60 border border-indigo-700/50 flex items-center justify-center text-indigo-300">
                <Music className="w-10 h-10" />
              </div>
              <div className="text-center space-y-1 max-w-md">
                <div className="text-sm font-semibold text-slate-100">
                  {t('library.previewMidiTitle', 'Anteprima MIDI / KAR')}
                </div>
                <p className="text-xs text-slate-400">
                  {t(
                    'library.previewMidiHint',
                    'Sintesi sul dispositivo Pre-Ascolto (CUE). Usa i controlli qui sotto — volume e muto solo da questa transport.'
                  )}
                </p>
                {midiStatus === 'loading' && (
                  <p className="text-[11px] text-indigo-300">{t('library.searching')}</p>
                )}
                {midiStatus === 'error' && (
                  <p className="text-[11px] text-rose-300">
                    {t('library.previewMidiError', 'Impossibile avviare anteprima MIDI.')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleMidiPlay()}
                  disabled={midiStatus === 'loading' || midiStatus === 'error'}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500/40 disabled:opacity-40 flex items-center gap-1.5"
                  data-testid="preview-midi-play"
                >
                  {midiPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {midiPlaying ? t('player.pause') : t('player.play')}
                </button>
                <button
                  type="button"
                  onClick={toggleMidiMute}
                  disabled={midiStatus === 'loading' || midiStatus === 'error'}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 ${
                    midiMuted
                      ? 'bg-slate-800 text-slate-300 border-slate-700'
                      : 'bg-amber-600 text-white border-amber-500/40'
                  }`}
                  data-testid="preview-midi-mute"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  {midiMuted ? t('library.previewUnmuteSameDeviceConfirm') : t('player.mute')}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center p-8 space-y-2 rounded-2xl border border-slate-800 bg-slate-950">
              <FileVideo className="w-12 h-12 text-slate-600 mx-auto" />
              <div className="text-xs text-slate-400">
                {t('library.previewUnavailable', 'Anteprima non disponibile per questo formato')}
              </div>
            </div>
          )}

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 sm:p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                {t('library.previewTitle')}
              </span>
            </div>

            {track.localFilePath && (
              <div className="text-[11px] text-slate-400 font-mono bg-slate-900/80 p-2 rounded-xl border border-slate-800 break-all select-all">
                <span className="text-slate-500 font-sans font-medium mr-1.5">File:</span>
                {track.localFilePath}
              </div>
            )}

            <div className="text-[11px] text-slate-500 italic">{t('library.previewSafeAudioNotice')}</div>
          </div>
        </div>

        <div className="p-4 px-5 border-t border-slate-800 bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <input
              type="text"
              list="preview-modal-singers"
              value={selectedSinger}
              onChange={(e) => setSelectedSinger(e.target.value)}
              placeholder={t('library.assignSingerOptional', 'Assegna cantante (opzionale)...')}
              className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-8 pr-4 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
            <User className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <datalist id="preview-modal-singers">
              {singers.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name} {s.isPermanentFavorite ? '★' : ''}
                </option>
              ))}
            </datalist>
          </div>

          {enableFairQueue && (
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded-xl p-1 text-xs">
              <button
                type="button"
                onClick={() => setPlacementMode('auto')}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                  placementMode === 'auto'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={t('queue.placementAutoDesc')}
              >
                {t('queue.placementAuto')}
              </button>
              <button
                type="button"
                onClick={() => setPlacementMode('end')}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                  placementMode === 'end'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={t('queue.placementEndDesc')}
              >
                {t('queue.placementEnd')}
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              {t('common.close')}
            </button>

            <button
              type="button"
              onClick={handleAdd}
              disabled={isQueuedSuccess}
              className={`px-5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md transition-all ${
                isQueuedSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              {isQueuedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {t('library.addedToQueue', 'Aggiunto alla Coda!')}
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  {t('queue.addToQueue')}
                </>
              )}
            </button>
          </div>
        </div>

        {pendingUnmuteConfirm && (
          <div
            className="absolute inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="preview-unmute-title"
            data-testid="preview-unmute-same-device-dialog"
          >
            <div className="bg-slate-900 border border-amber-500/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <h4 id="preview-unmute-title" className="text-sm font-bold text-amber-200">
                {t('library.previewUnmuteSameDeviceTitle')}
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                {t('library.previewUnmuteSameDeviceMessage')}
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700"
                  onClick={mediaKind === 'midi' ? () => setPendingUnmuteConfirm(false) : cancelEmbeddedUnmute}
                >
                  {t('library.previewUnmuteSameDeviceCancel')}
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 shadow-md"
                  data-testid="preview-unmute-same-device-confirm"
                  onClick={confirmUnmute}
                >
                  {t('library.previewUnmuteSameDeviceConfirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

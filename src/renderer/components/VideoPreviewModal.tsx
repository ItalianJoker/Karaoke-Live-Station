import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Plus,
  Volume2,
  VolumeX,
  Film,
  Headphones,
  User,
  Music,
  CheckCircle2,
  FileVideo,
  Info
} from 'lucide-react';
import { KaraokeMediaTrack, SingerProfile } from '../../shared/types';
import {
  buildYouTubeEmbedSrc,
  YOUTUBE_EMBED_REFERRER_POLICY
} from '../../shared/youtubeEmbed';

interface VideoPreviewModalProps {
  isOpen: boolean;
  track: KaraokeMediaTrack | null;
  singers: SingerProfile[];
  enableFairQueue?: boolean;
  onClose: () => void;
  onAddToQueue: (track: KaraokeMediaTrack, singerName?: string, placement?: 'auto' | 'end') => void;
  onPlayCue?: (uri: string) => void;
  onStopCue?: () => void;
  isCueActive?: boolean;
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
 * VideoPreviewModal
 *
 * Dedicated interactive video preview and version inspection modal.
 * Allows the karaoke DJ to preview playback, inspect backing video styling,
 * check whether backing vocals or lyrics countdown are included, and queue
 * directly with singer assignment.
 */
export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({
  isOpen,
  track,
  singers,
  enableFairQueue = false,
  onClose,
  onAddToQueue,
  onPlayCue,
  onStopCue,
  isCueActive = false
}) => {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [volume, setVolume] = useState<number>(0.5);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [selectedSinger, setSelectedSinger] = useState<string>('');
  const [placementMode, setPlacementMode] = useState<'auto' | 'end'>('auto');
  const [isQueuedSuccess, setIsQueuedSuccess] = useState<boolean>(false);

  // Reset state and pause video when modal opens or track changes
  useEffect(() => {
    if (isOpen && track) {
      setIsQueuedSuccess(false);
      setSelectedSinger('');
      setPlacementMode('auto');
      setIsMuted(true);
      if (videoRef.current) {
        videoRef.current.muted = true;
        videoRef.current.volume = volume;
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {
          // Autoplay might require interaction or safe handling
        });
      }
    } else {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    }
  }, [isOpen, track]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !track) return null;

  const versionTags = extractVersionTags(track);
  const isYouTube = track.source === 'youtube' && !track.localFilePath;
  const isVideo =
    track.source === 'local_library' &&
    (track.uri.includes('.mp4') ||
      track.uri.includes('.webm') ||
      track.localFilePath?.endsWith('.mp4') ||
      track.localFilePath?.endsWith('.webm'));
  const isMidi = track.source === 'midi';

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      videoRef.current.muted = newVolume === 0;
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = volume || 0.5;
      }
    } else {
      setIsMuted(true);
      if (videoRef.current) {
        videoRef.current.muted = true;
      }
    }
  };

  const handleAdd = () => {
    onAddToQueue(track, selectedSinger.trim() || undefined, placementMode);
    setIsQueuedSuccess(true);
    setTimeout(() => {
      onClose();
    }, 900);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 px-5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="p-2 bg-indigo-950/60 border border-indigo-800/60 rounded-xl text-indigo-400 shrink-0">
              <Film className="w-4 h-4" />
            </div>
            <div className="truncate">
              <h3 className="font-bold text-sm text-slate-100 truncate flex items-center gap-2">
                <span>{track.title}</span>
                <span className="text-slate-500 font-normal">•</span>
                <span className="text-slate-400 font-medium text-xs">{track.artist}</span>
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {track.source === 'local_library' ? 'Locale' : track.source.toUpperCase()}
                </span>
                {versionTags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 shadow-sm"
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
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-all shrink-0"
            title="Chiudi (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Player Display */}
        <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-y-auto space-y-4">
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-2xl flex items-center justify-center">
            {isVideo || (track.localFilePath && !isYouTube) ? (
              <video
                ref={videoRef}
                src={track.uri}
                controls
                playsInline
                muted={isMuted}
                className="w-full h-full object-contain"
              />
            ) : isYouTube ? (
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
            ) : isMidi ? (
              <div className="text-center p-8 space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-indigo-950/60 border border-indigo-700/60 flex items-center justify-center mx-auto text-indigo-300 shadow-inner">
                  <Music className="w-8 h-8" />
                </div>
                <div className="text-sm font-semibold text-slate-200">
                  Brano Sintetizzato MIDI / KAR
                </div>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Questo file contiene sequenze MIDI e testo sincronizzato. Puoi ascoltarlo in anteprima tramite il canale CUE in cuffia senza interferire con l'uscita sala.
                </p>
                {onPlayCue && onStopCue && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isCueActive) onStopCue();
                      else onPlayCue(track.uri);
                    }}
                    className={`px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-2 mx-auto border transition-all ${
                      isCueActive
                        ? 'bg-amber-950/70 border-amber-600 text-amber-300 shadow-lg'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30'
                    }`}
                  >
                    <Headphones className="w-3.5 h-3.5" />
                    {isCueActive ? 'Ferma Ascolto Cuffia (CUE)' : 'Ascolta in Cuffia (CUE)'}
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center p-8 space-y-2">
                <FileVideo className="w-12 h-12 text-slate-600 mx-auto" />
                <div className="text-xs text-slate-400">Anteprima video non disponibile per questo formato</div>
              </div>
            )}
          </div>

          {/* Version & Technical Inspection Details Card */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 sm:p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                {t('library.previewTitle')}
              </span>
              <div className="flex items-center gap-2">
                {isVideo && (
                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-2.5 py-1 text-slate-300">
                    <button
                      type="button"
                      onClick={toggleMute}
                      className="text-slate-400 hover:text-white"
                      title={isMuted ? 'Riattiva audio' : 'Muto'}
                    >
                      {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                      className="w-16 h-1 bg-slate-700 rounded-lg accent-indigo-500 cursor-pointer"
                      title="Volume anteprima"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* File Path / Origin Details */}
            {track.localFilePath && (
              <div className="text-[11px] text-slate-400 font-mono bg-slate-900/80 p-2 rounded-xl border border-slate-800 break-all select-all">
                <span className="text-slate-500 font-sans font-medium mr-1.5">File:</span>
                {track.localFilePath}
              </div>
            )}

            <div className="text-[11px] text-slate-500 italic">
              {t('library.previewSafeAudioNotice')}
            </div>
          </div>
        </div>

        {/* Footer with Quick Singer Assign & Enqueue */}
        <div className="p-4 px-5 border-t border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <input
              type="text"
              list="preview-modal-singers"
              value={selectedSinger}
              onChange={(e) => setSelectedSinger(e.target.value)}
              placeholder="Assegna cantante (opzionale)..."
              className="w-full bg-slate-900 border border-slate-700/80 rounded-full pl-8 pr-4 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
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
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded-full p-1 text-xs">
              <button
                type="button"
                onClick={() => setPlacementMode('auto')}
                className={`px-3 py-1 rounded-full font-semibold transition-all ${
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
                className={`px-3 py-1 rounded-full font-semibold transition-all ${
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
              className="px-4 py-2 rounded-full text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800 transition-all"
            >
              {t('singers.close')}
            </button>

            <button
              type="button"
              onClick={handleAdd}
              disabled={isQueuedSuccess}
              className={`px-5 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 shadow-lg transition-all ${
                isQueuedSuccess
                  ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                  : 'bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-indigo-600/30'
              }`}
            >
              {isQueuedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  Aggiunto alla Coda!
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Aggiungi alla Coda
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


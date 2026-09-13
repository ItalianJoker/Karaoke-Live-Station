import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  RefreshCw,
  Globe,
  HardDrive,
  Download,
  Plus,
  Loader2,
  XCircle,
  Save,
  Music,
  Headphones,
  UserPlus,
  X,
  User,
  Eye,
  Film,
  Play,
  Sparkles,
  ArrowDownToLine
} from 'lucide-react';
import { KaraokeMediaTrack, DownloadProgressPayload } from '../../shared/types';
import { useKaraokeStore } from '../store/karaokeStore';
import { VideoPreviewModal, extractVersionTags } from './VideoPreviewModal';

interface LibraryPanelProps {
  onPlayCue?: (uri: string) => void;
  onStopCue?: () => void;
  activeCueUri?: string;
}

/**
 * LibraryPanel
 *
 * Provides media browsing, multi-source searching, headphone CUE preview, and enqueueing.
 * Features:
 * 1. Dual Search Modes:
 *    - 'local': Searches the SQLite database for indexed MP3+G, MP4, and MIDI/KAR files.
 *    - 'web': Uses yt-dlp to search YouTube/web for karaoke versions and streams or downloads them.
 * 2. Pre-listening / CUE Routing:
 *    - Plays audio preview through the designated CUE headphone device without affecting the master PA output.
 * 3. Fast Enqueue with Singer Selection:
 *    - Quick singer combobox dropdown with live search, favorite pinning, and song history weighting.
 *    - Instant queue insertion with calculated fair-rotation order.
 * 4. Folder Importer:
 *    - Triggers directory picker and background scanner to index new media into the local SQLite database.
 */
export const LibraryPanel: React.FC<LibraryPanelProps> = ({ onPlayCue, onStopCue, activeCueUri }) => {
  const { t } = useTranslation();
  const [searchMode, setSearchMode] = useState<'local' | 'web'>('local');
  const [query, setQuery] = useState('');
  const [localTracks, setLocalTracks] = useState<KaraokeMediaTrack[]>([]);
  const [searchResults, setSearchResults] = useState<KaraokeMediaTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const storeSingers = useKaraokeStore((state) => state.singers);
  const singers = React.useMemo(() => {
    return Object.values(storeSingers).sort((a, b) => {
      if (a.isPermanentFavorite !== b.isPermanentFavorite) {
        return a.isPermanentFavorite ? -1 : 1;
      }
      if (b.songsSungCount !== a.songsSungCount) {
        return b.songsSungCount - a.songsSungCount;
      }
      return a.name.localeCompare(b.name);
    });
  }, [storeSingers]);

  const [selectedSinger, setSelectedSinger] = useState<string>('');
  const [pendingTrackForQueue, setPendingTrackForQueue] = useState<KaraokeMediaTrack | null>(null);
  const [modalSingerInput, setModalSingerInput] = useState<string>('');
  const [placementMode, setPlacementMode] = useState<'auto' | 'end'>('auto');
  const [activeDownloads, setActiveDownloads] = useState<Record<string, DownloadProgressPayload>>({});
  const [trackMap, setTrackMap] = useState<Record<string, KaraokeMediaTrack>>({});
  const [previewTrack, setPreviewTrack] = useState<KaraokeMediaTrack | null>(null);

  const settings = useKaraokeStore((state) => state.settings);
  const updateSettings = useKaraokeStore((state) => state.updateSettings);
  const addToQueue = useKaraokeStore((state) => state.addToQueue);
  const updateTrackInQueue = useKaraokeStore((state) => state.updateTrackInQueue);

  const loadLocalCatalog = async () => {
    if (window.karaokeApi) {
      const tracks = await window.karaokeApi.db.getTracks();
      setLocalTracks(tracks);
      await useKaraokeStore.getState().loadSingersFromDb();
    }
  };

  useEffect(() => {
    loadLocalCatalog();

    const handleLibraryRefreshed = () => {
      loadLocalCatalog();
    };
    window.addEventListener('karaoke:library-refreshed', handleLibraryRefreshed);

    return () => {
      window.removeEventListener('karaoke:library-refreshed', handleLibraryRefreshed);
    };
  }, [settings.libraryPath]);

  useEffect(() => {
    if (window.karaokeApi) {
      const unSub = window.karaokeApi.downloads.onProgress(async (payload) => {
        setActiveDownloads((prev) => ({ ...prev, [payload.downloadId]: payload }));

        if (payload.status === 'completed' && payload.outputFilePath) {
          const associatedTrack = trackMap[payload.downloadId];
          if (associatedTrack) {
            const localUri = `karaoke://local/${encodeURIComponent(payload.outputFilePath)}`;
            updateTrackInQueue(associatedTrack.id, {
              localFilePath: payload.outputFilePath,
              uri: localUri
            });
            updateTrackInQueue(associatedTrack.uri, {
              localFilePath: payload.outputFilePath,
              uri: localUri
            });

            // Auto-archive web tracks if enabled in settings
            if (settings.autoArchiveWebTracks) {
              try {
                await window.karaokeApi.downloads.saveToLibrary({
                  tempFilePath: payload.outputFilePath,
                  title: associatedTrack.title,
                  artist: associatedTrack.artist,
                  durationSec: associatedTrack.durationSec
                });
                await loadLocalCatalog();
              } catch (err) {
                console.error('Auto-archive failed:', err);
              }
            }
          }
        }
      });
      return () => unSub();
    }
  }, [settings.autoArchiveWebTracks, trackMap, updateTrackInQueue]);

  const handleScanOrRefresh = async () => {
    if (!window.karaokeApi) return;
    let folder: string | null = settings.libraryPath || null;
    if (!folder) {
      // If no library path is set yet, prompt to pick a directory and save it into settings
      folder = await window.karaokeApi.dialog.openDirectory();
      if (!folder) return;
      updateSettings({ libraryPath: folder });
    }

    setIsSearching(true);
    try {
      const discovered = await window.karaokeApi.library.scanFolder(folder);
      await loadLocalCatalog();
      window.dispatchEvent(new CustomEvent('karaoke:library-refreshed', { detail: { count: discovered.length } }));
      alert(t('library.scanSuccess', { count: discovered.length }));
    } catch (err) {
      console.error('Library scan error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      if (searchMode === 'web') {
        if (window.karaokeApi) {
          const ytTracks = await window.karaokeApi.library.searchYouTube(query);
          setSearchResults(ytTracks);
        }
      } else {
        const q = query.toLowerCase();
        const filtered = localTracks.filter(
          (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
        );
        setSearchResults(filtered);
      }
    } finally {
      setIsSearching(false);
    }
  };

  const displayedTracks = query.trim() ? searchResults : localTracks;

  const handleStartDownload = async (track: KaraokeMediaTrack) => {
    if (!window.karaokeApi) return;
    try {
      const downloadId = await window.karaokeApi.downloads.start({ url: track.uri });
      setTrackMap((prev) => ({ ...prev, [downloadId]: track }));
    } catch (err) {
      alert(t('errors.downloadFailed', { error: String(err) }));
    }
  };

  const handleSaveToLibrary = async (downloadId: string) => {
    const dl = activeDownloads[downloadId];
    const track = trackMap[downloadId];
    if (!dl || !dl.outputFilePath || !track || !window.karaokeApi) return;

    try {
      const saved = await window.karaokeApi.downloads.saveToLibrary({
        tempFilePath: dl.outputFilePath,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec
      });
      await loadLocalCatalog();
      alert(t('library.savedSuccess', { title: saved.title }));
    } catch (err) {
      alert(t('errors.downloadFailed', { error: String(err) }));
    }
  };

  const executeAddToQueue = (track: KaraokeMediaTrack, singerName?: string, placement: 'auto' | 'end' = 'auto') => {
    addToQueue(track, singerName?.trim() || undefined, false, 0, placement);
    if (track.source === 'youtube' && !track.localFilePath) {
      const isAlreadyDownloading = Object.keys(activeDownloads).some(
        (id) => trackMap[id]?.uri === track.uri
      );
      if (!isAlreadyDownloading) {
        handleStartDownload(track);
      }
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-3xl p-4 md:p-5 shadow-2xl backdrop-blur-xl flex flex-col h-full min-h-0 overflow-hidden">
      {/* Search Header & Mode Toggle */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-full border border-slate-800/80 text-xs font-semibold shadow-inner">
          <button
            type="button"
            onClick={() => {
              setSearchMode('local');
              setSearchResults([]);
            }}
            className={`px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition-all ${
              searchMode === 'local'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            {t('library.modeLocal')} ({localTracks.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchMode('web');
              setSearchResults([]);
            }}
            className={`px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition-all ${
              searchMode === 'web'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            {t('library.modeWeb')}
          </button>
        </div>

        {searchMode === 'local' && (
          <button
            type="button"
            onClick={handleScanOrRefresh}
            disabled={isSearching}
            title={
              settings.libraryPath
                ? `${t('library.scanFolder')} (${settings.libraryPath})`
                : t('settings.noLibraryPathSelected')
            }
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/80 flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isSearching ? 'animate-spin' : ''}`} />
            {t('library.scanFolder')}
          </button>
        )}
      </div>

      {/* Search Form with Singer Quick Selector */}
      <div className="grid grid-cols-12 gap-2.5 mb-4">
        <form onSubmit={handleSearch} className="col-span-7 sm:col-span-8 flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                searchMode === 'web'
                  ? t('library.searchWebPlaceholder')
                  : t('library.searchPlaceholder')
              }
              className="w-full bg-slate-950/80 border border-slate-800/80 rounded-full pl-9 pr-4 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
            />
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:opacity-50 text-white font-semibold rounded-full text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/25 transition-all"
          >
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : t('library.searchBtn')}
          </button>
        </form>

        {/* Singer Assign Quick Selector with datalist */}
        <div className="col-span-5 sm:col-span-4 relative flex items-center">
          <div className="relative w-full">
            <input
              type="text"
              list="library-known-singers"
              value={selectedSinger}
              onChange={(e) => setSelectedSinger(e.target.value)}
              placeholder="Cantante assegnato..."
              className="w-full bg-slate-950/80 border border-slate-800/80 rounded-full pl-8 pr-7 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
            />
            <User className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            {selectedSinger && (
              <button
                type="button"
                onClick={() => setSelectedSinger('')}
                className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
                title="Rimuovi cantante selezionato"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <datalist id="library-known-singers">
            {singers.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name} {s.isPermanentFavorite ? '★' : ''}
              </option>
            ))}
          </datalist>
        </div>
      </div>

      {/* Active Downloads List */}
      {Object.keys(activeDownloads).length > 0 && (
        <div className="mb-4 bg-slate-950/80 border border-slate-800/80 rounded-2xl p-3.5 space-y-2.5 shadow-inner">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> {t('library.downloadsActive')}
          </div>
          {Object.values(activeDownloads).map((dl) => (
            <div key={dl.downloadId} className="flex items-center justify-between text-xs gap-3">
              <div className="flex-1">
                <div className="flex justify-between text-[10px] text-slate-400 mb-1 font-mono">
                  <span>{dl.status.toUpperCase()} • {dl.speed}</span>
                  <span>{dl.percent.toFixed(1)}% (ETA {dl.eta})</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${dl.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                    style={{ width: `${dl.percent}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1">
                {dl.status === 'completed' && dl.outputFilePath && !settings.autoArchiveWebTracks && (
                  <button
                    type="button"
                    onClick={() => handleSaveToLibrary(dl.downloadId)}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full text-[10px] font-semibold flex items-center gap-1 shadow-sm transition-all"
                  >
                    <Save className="w-3 h-3" /> {t('library.saveToLibrary')}
                  </button>
                )}

                {dl.status === 'downloading' && (
                  <button
                    type="button"
                    onClick={() => window.karaokeApi?.downloads.cancel(dl.downloadId)}
                    className="text-slate-500 hover:text-red-400 p-1.5 rounded-full hover:bg-slate-800 transition-all"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results List */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {displayedTracks.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs italic">
            {isSearching ? t('library.searching') : t('queue.empty')}
          </div>
        ) : (
          displayedTracks.map((track) => {
            const isCueActive = activeCueUri === track.uri;
            const versionTags = extractVersionTags(track);

            return (
              <div
                key={track.id}
                className="p-2.5 sm:p-3 bg-slate-950/40 hover:bg-slate-950/80 border border-slate-800/60 hover:border-slate-700/80 rounded-2xl flex items-center justify-between gap-3 transition-all group/item"
              >
                <div className="flex items-center gap-3 overflow-hidden min-w-0">
                  {/* 16:9 Video / Media Preview Thumbnail */}
                  <div
                    onClick={() => setPreviewTrack(track)}
                    className="w-20 sm:w-24 aspect-video rounded-xl bg-slate-950 border border-slate-800/80 overflow-hidden relative group/thumb shrink-0 cursor-pointer shadow-sm hover:border-indigo-500/80 transition-all flex items-center justify-center"
                    title={t('library.previewVideo')}
                  >
                    {track.thumbnailUrl ? (
                      <img
                        src={track.thumbnailUrl}
                        alt={track.title}
                        className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : track.source === 'midi' ? (
                      <div className="w-full h-full bg-gradient-to-br from-indigo-950 to-slate-900 flex flex-col items-center justify-center text-indigo-400">
                        <Music className="w-4 h-4 mb-0.5" />
                        <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-indigo-300">MIDI</span>
                      </div>
                    ) : (
                      <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center text-slate-500">
                        <Film className="w-4 h-4 mb-0.5" />
                        <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-slate-400">VIDEO</span>
                      </div>
                    )}

                    {/* Hover Play/Preview Overlay */}
                    <div className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity">
                      <div className="p-1.5 rounded-full bg-indigo-600/90 text-white shadow-md">
                        <Play className="w-3 h-3 fill-white ml-0.5" />
                      </div>
                    </div>
                  </div>

                  {/* Track Metadata & Version Chips */}
                  <div className="truncate min-w-0">
                    <div
                      onClick={() => setPreviewTrack(track)}
                      className="font-semibold text-xs text-slate-200 hover:text-indigo-300 transition-colors truncate cursor-pointer"
                      title={track.title}
                    >
                      {track.title}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="truncate">{track.artist}</span>
                      <span className="text-slate-600">•</span>
                      <span className="uppercase text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-slate-800/80 text-indigo-300 border border-slate-700/50">
                        {track.source === 'local_library' ? 'locale' : track.source}
                      </span>
                      {versionTags.map((vTag) => (
                        <span
                          key={vTag}
                          className="text-[9px] font-semibold px-1.5 py-0.2 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 shadow-sm"
                        >
                          {vTag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {/* Video Preview Button */}
                  <button
                    type="button"
                    onClick={() => setPreviewTrack(track)}
                    className="p-2 bg-slate-800/80 hover:bg-slate-700 text-indigo-300 hover:text-white border border-slate-700/80 rounded-full text-xs flex items-center gap-1 transition-all"
                    title={t('library.previewVideo')}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>

                  {/* CUE Headphone Pre-ascolto Button */}
                  {onPlayCue && onStopCue && track.uri && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isCueActive) {
                          onStopCue();
                        } else {
                          onPlayCue(track.uri);
                        }
                      }}
                      className={`p-2 rounded-full text-xs flex items-center gap-1 border transition-all ${
                        isCueActive
                          ? 'bg-amber-950/70 border-amber-600 text-amber-300 shadow-md shadow-amber-900/30'
                          : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/80'
                      }`}
                      title={isCueActive ? t('player.stopCue') : t('player.cue')}
                    >
                      <Headphones className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {track.source === 'youtube' && (
                    <button
                      type="button"
                      onClick={() => handleStartDownload(track)}
                      className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 rounded-full text-xs flex items-center gap-1 transition-all"
                      title={t('library.downloading')}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (selectedSinger.trim()) {
                        executeAddToQueue(track, selectedSinger);
                      } else {
                        useKaraokeStore.getState().loadSingersFromDb();
                        setModalSingerInput('');
                        setPlacementMode('auto');
                        setPendingTrackForQueue(track);
                      }
                    }}
                    className="px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-full text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/25 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> {t('queue.addToQueue')}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal to assign singer when adding to queue */}
      {pendingTrackForQueue && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900/95 border border-slate-800/80 rounded-3xl max-w-md w-full p-6 shadow-2xl backdrop-blur-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2.5 text-indigo-400">
                <div className="p-2 bg-indigo-950/60 rounded-xl border border-indigo-800/50">
                  <UserPlus className="w-4 h-4 text-indigo-400" />
                </div>
                <h3 className="font-bold text-sm text-white">Assegna Cantante al Brano</h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingTrackForQueue(null)}
                className="text-slate-400 hover:text-white p-1.5 rounded-full hover:bg-slate-800/80 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800/80">
              <div className="text-xs font-bold text-slate-200">{pendingTrackForQueue.title}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{pendingTrackForQueue.artist}</div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const singer = modalSingerInput.trim();
                executeAddToQueue(pendingTrackForQueue, singer, placementMode);
                setPendingTrackForQueue(null);
                setModalSingerInput('');
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Chi canterà questo brano?
                </label>
                <input
                  type="text"
                  autoFocus
                  list="modal-singers-datalist"
                  value={modalSingerInput}
                  onChange={(e) => setModalSingerInput(e.target.value)}
                  placeholder="Nome del cantante..."
                  className="w-full bg-slate-950/80 border border-slate-800/80 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                />
                <datalist id="modal-singers-datalist">
                  {singers.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </div>

              {/* Quick clickable chips of existing registered singers */}
              {singers.length > 0 && (
                <div>
                  <span className="text-[11px] font-medium text-slate-400 block mb-1.5">
                    Oppure seleziona un cantante esistente:
                  </span>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                    {singers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setModalSingerInput(s.name)}
                        className={`text-xs px-3 py-1 rounded-full border transition-all ${
                          modalSingerInput === s.name
                            ? 'bg-indigo-600 border-indigo-400 text-white font-semibold shadow-sm'
                            : 'bg-slate-800/80 border-slate-700/70 text-slate-300 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        {s.name} {s.isPermanentFavorite ? '★' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Manual vs Fair Queue placement selection */}
              {settings.enableFairQueue && (
                <div className="space-y-1.5 pt-1">
                  <label className="block text-xs font-medium text-slate-300">
                    {t('queue.placementMode')}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPlacementMode('auto')}
                      className={`p-2.5 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                        placementMode === 'auto'
                          ? 'bg-indigo-950/60 border-indigo-500/80 text-white shadow-sm'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{t('queue.placementAuto')}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 leading-snug">
                        {t('queue.placementAutoDesc')}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPlacementMode('end')}
                      className={`p-2.5 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                        placementMode === 'end'
                          ? 'bg-indigo-950/60 border-indigo-500/80 text-white shadow-sm'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <ArrowDownToLine className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{t('queue.placementEnd')}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 leading-snug">
                        {t('queue.placementEndDesc')}
                      </div>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    executeAddToQueue(pendingTrackForQueue, undefined, placementMode);
                    setPendingTrackForQueue(null);
                  }}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 transition-all"
                >
                  Aggiungi senza cantante
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 shadow-md shadow-indigo-600/30 transition-all"
                >
                  Conferma e Aggiungi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Video Preview & Version Check Modal */}
      <VideoPreviewModal
        isOpen={previewTrack !== null}
        track={previewTrack}
        singers={singers}
        enableFairQueue={settings.enableFairQueue}
        onClose={() => setPreviewTrack(null)}
        onAddToQueue={(trk, sName, placement) => executeAddToQueue(trk, sName, placement)}
        onPlayCue={onPlayCue}
        onStopCue={onStopCue}
        isCueActive={previewTrack ? activeCueUri === previewTrack.uri : false}
      />
    </div>
  );
};

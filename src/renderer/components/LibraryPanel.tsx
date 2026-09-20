import React, { useState, useEffect, useRef, useMemo } from 'react';
import { showToast } from '../utils/toast';
import { useTranslation } from 'react-i18next';
import {
  Search,
  RefreshCw,
  Globe,
  HardDrive,
  Download,
  Plus,
  Loader2,
  Music,
  Headphones,
  UserPlus,
  X,
  Eye,
  Film,
  Play,
  Sparkles,
  ArrowDownToLine,
  Trash2,
  Square,
  AlertCircle,
  FileX
} from 'lucide-react';
import { KaraokeMediaTrack, DownloadProgressPayload } from '../../shared/types';
import { isInstrumentalDownloadEligibleTitle } from '../../shared/vocalRemover';
import { textMatchesSearch } from '../../shared/textNormalize';
import { useKaraokeStore } from '../store/karaokeStore';
import { useScopedLibrarySearch } from '../hooks/useScopedLibrarySearch';
import { VideoPreviewModal, extractVersionTags } from './VideoPreviewModal';
import { InstrumentalSubtitlesModal } from './InstrumentalSubtitlesModal';
import { dataTransferHasFiles, resolveDroppedAbsolutePaths } from '../utils/fsDragDrop';
import {
  checkTrackLocalFileExists,
  trackNeedsLocalFileCheck
} from '../utils/localFileCheck';
import { computeVirtualWindow, computeVirtualWindowVariable } from '../utils/listVirtualization';
import { TrackKeyBpmBadges } from './TrackKeyBpmBadges';

function logLibrary(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  try {
    window.karaokeApi?.logger?.log(level, 'LibraryPanel', message, data);
  } catch {
    /* ignore logger gaps during early boot */
  }
}

/** Approx row height incl. vertical gap — keep in sync with list row padding. */
const LIBRARY_ROW_HEIGHT = 96;
/** Bottom margin between Studio library cards (px). */
const STUDIO_LIBRARY_ROW_GAP = 8;

/**
 * Studio Desk card stride (content + gap). Cards grow with tags / wrapped titles;
 * this estimate must stay ≥ visual height so virtualization never clips buttons.
 */
function estimateStudioLibraryRowStride(track: KaraokeMediaTrack): number {
  const tags = extractVersionTags(track);
  // p-3 vertical ≈ 24; title 1–2 lines; meta; optional tag line; mt-2.5 gap; actions; gap
  let content = 24;
  content += track.title.length > 42 ? 36 : 18;
  if (track.title.length > 84) content += 16;
  content += 20; // artist + chips
  if (tags.length > 0) content += 20; // version pills (e.g. Strumentale)
  content += 12; // padding between info and action row
  content += 40; // action buttons
  return Math.max(156, content) + STUDIO_LIBRARY_ROW_GAP;
}

/** Intent to enqueue only after YouTube download + auto-archive succeed. */
type PendingArchiveEnqueue = {
  track: KaraokeMediaTrack;
  singerName?: string;
  placement: 'auto' | 'end';
};

interface LibraryPanelProps {
  onPlayCue?: (uri: string) => void;
  onStopCue?: () => void;
  activeCueUri?: string;
  /** Optional ref for Ctrl+F focus from ControlWindow shortcuts */
  searchInputRef?: React.RefObject<HTMLInputElement>;
  /**
   * Studio Desk «Ricerca»: when this nonce increments, switch to Web/YouTube mode.
   * Classic Regia never passes this — Locale|Web toggle stays operator-driven.
   */
  webSearchNonce?: number;
  /**
   * Studio Desk «Libreria»: when this nonce increments, switch to Locale mode
   * (mirror of webSearchNonce for Ricerca → Web).
   */
  localSearchNonce?: number;
  /**
   * When true, drop outer card chrome (Studio column already provides the card).
   * Classic Regia omits this — default bordered panel unchanged.
   */
  embedded?: boolean;
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
 * 5. OS filesystem Drag & Drop:
 *    - Drop media files onto the panel to catalog them (mp4/webm/mkv/avi, mp3+cdg, mid/kar)
 *      via library.importFiles; overlay only when dataTransfer.types includes Files.
 */
export const LibraryPanel: React.FC<LibraryPanelProps> = ({
  onPlayCue: _onPlayCue,
  onStopCue: _onStopCue,
  activeCueUri: _activeCueUri,
  searchInputRef,
  webSearchNonce,
  localSearchNonce,
  embedded = false
}) => {
  const { t } = useTranslation();
  const {
    searchMode,
    setSearchMode,
    query,
    setQuery,
    results: searchResults,
    setLocalResults,
    setWebResults,
    isSearching,
    setLocalSearching,
    setWebSearching,
    patchTrackInAllResults,
    revertLibraryMembershipInResults,
    listRef: resultsListRef,
    onListScroll,
    localQuery,
    webQuery
  } = useScopedLibrarySearch();

  // Studio Desk «Ricerca» menu: open directly on Web/YouTube (not Locale).
  useEffect(() => {
    if (webSearchNonce == null || webSearchNonce <= 0) return;
    setSearchMode('web');
  }, [webSearchNonce, setSearchMode]);

  // Studio Desk «Libreria» menu: open directly on Locale (mirror of Ricerca → Web).
  useEffect(() => {
    if (localSearchNonce == null || localSearchNonce <= 0) return;
    setSearchMode('local');
  }, [localSearchNonce, setSearchMode]);

  const [isScanning, setIsScanning] = useState(false);
  /** OS file drag overlay — only when dataTransfer.types includes Files. */
  const [fileDropActive, setFileDropActive] = useState(false);
  const [isImportingDrop, setIsImportingDrop] = useState(false);
  const [webHasMore, setWebHasMore] = useState(false);
  const [webLoadingMore, setWebLoadingMore] = useState(false);
  const webSearchOffsetRef = useRef(0);
  /** Bumped on cancel so late yt-dlp results are ignored and loading flags stay clear. */
  const webSearchGenRef = useRef(0);
  const [localTracks, setLocalTracks] = useState<KaraokeMediaTrack[]>([]);
  const [localCatalogTotal, setLocalCatalogTotal] = useState(0);
  const [localPageCursor, setLocalPageCursor] = useState<{
    artist: string;
    title: string;
    id: string;
  } | null>(null);
  const [localHasMore, setLocalHasMore] = useState(false);
  const [localLoadingMore, setLocalLoadingMore] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ scanned: number; found: number } | null>(
    null
  );
  const LOCAL_PAGE_SIZE = 200;
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

  const [pendingTrackForQueue, setPendingTrackForQueue] = useState<KaraokeMediaTrack | null>(null);
  const [modalSingerInput, setModalSingerInput] = useState<string>('');
  const [placementMode, setPlacementMode] = useState<'auto' | 'end'>('auto');
  const [activeDownloads, setActiveDownloads] = useState<Record<string, DownloadProgressPayload>>({});
  const [trackMap, setTrackMap] = useState<Record<string, KaraokeMediaTrack>>({});
  const [previewTrack, setPreviewTrack] = useState<KaraokeMediaTrack | null>(null);
  /** Pending Download Instrumental track waiting for subtitle-policy modal */
  const [instrumentalSubtitlesTrack, setInstrumentalSubtitlesTrack] =
    useState<KaraokeMediaTrack | null>(null);
  const [trackPendingDelete, setTrackPendingDelete] = useState<KaraokeMediaTrack | null>(null);
  const [isDeletingTrack, setIsDeletingTrack] = useState(false);
  // When auto-archive is on, YouTube→queue waits for library file before enqueue (no remote/temp pointer).
  const pendingArchiveEnqueueRef = useRef<Record<string, PendingArchiveEnqueue>>({});

  const settings = useKaraokeStore((state) => state.settings);
  const updateSettings = useKaraokeStore((state) => state.updateSettings);
  const addToQueue = useKaraokeStore((state) => state.addToQueue);
  const updateTrackInQueue = useKaraokeStore((state) => state.updateTrackInQueue);
  const removeFromQueue = useKaraokeStore((state) => state.removeFromQueue);
  const showMissingFileModal = useKaraokeStore((state) => state.showMissingFileModal);
  const markTrackMissing = useKaraokeStore((state) => state.markTrackMissing);
  const clearTrackMissing = useKaraokeStore((state) => state.clearTrackMissing);
  const missingTrackIds = useKaraokeStore((state) => state.missingTrackIds);
  /** O(1) membership for virtualized rows — store shape stays string[] for persist. */
  const missingTrackIdSet = useMemo(() => new Set(missingTrackIds), [missingTrackIds]);

  const dedupeLocalTracks = (tracks: KaraokeMediaTrack[]): KaraokeMediaTrack[] => {
    const byKey = new Map<string, KaraokeMediaTrack>();
    for (const track of tracks) {
      if (track.source === 'youtube' && !track.localFilePath) continue;
      const pathKey = (track.localFilePath || '').toLowerCase();
      const key = pathKey || track.id;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, track);
        continue;
      }
      const prefer =
        (/^[\w-]{11}$/.test(track.id) ? 2 : 0) + (track.source === 'local_library' ? 1 : 0);
      const prevScore =
        (/^[\w-]{11}$/.test(prev.id) ? 2 : 0) + (prev.source === 'local_library' ? 1 : 0);
      if (prefer >= prevScore) byKey.set(key, track);
    }
    return Array.from(byKey.values());
  };

  /** Warm Local load: first page from SQLite — never IPC-dumps the full catalog. */
  const loadLocalCatalog = async (opts?: { reset?: boolean }) => {
    if (!window.karaokeApi) return;
    const reset = opts?.reset !== false;
    try {
      if (window.karaokeApi.db.getTracksPage) {
        const page = await window.karaokeApi.db.getTracksPage(LOCAL_PAGE_SIZE, null);
        setLocalTracks(dedupeLocalTracks(page.tracks || []));
        setLocalCatalogTotal(page.total || 0);
        setLocalPageCursor(page.nextCursor || null);
        setLocalHasMore(Boolean(page.nextCursor));
      } else {
        // Legacy fallback (pre-Phase-2 preload)
        const tracks = await window.karaokeApi.db.getTracks();
        setLocalTracks(dedupeLocalTracks(tracks));
        setLocalCatalogTotal(tracks.length);
        setLocalPageCursor(null);
        setLocalHasMore(false);
      }
      await useKaraokeStore.getState().loadSingersFromDb();
    } catch (err) {
      logLibrary('error', 'Failed loading local catalog page:', err);
      if (reset) {
        setLocalTracks([]);
        setLocalCatalogTotal(0);
      }
    }
  };

  const loadMoreLocalTracks = async () => {
    if (!window.karaokeApi?.db?.getTracksPage || !localHasMore || localLoadingMore) return;
    if (!localPageCursor) return;
    setLocalLoadingMore(true);
    try {
      const page = await window.karaokeApi.db.getTracksPage(LOCAL_PAGE_SIZE, localPageCursor);
      setLocalTracks((prev) => dedupeLocalTracks([...prev, ...(page.tracks || [])]));
      setLocalCatalogTotal(page.total || localCatalogTotal);
      setLocalPageCursor(page.nextCursor || null);
      setLocalHasMore(Boolean(page.nextCursor));
    } catch (err) {
      logLibrary('error', 'Failed loading more local tracks:', err);
    } finally {
      setLocalLoadingMore(false);
    }
  };

  /**
   * Full Local reindex (scanFolder + catalog reload) so newly archived YouTube files
   * appear with correct ffmpeg thumbnails before enqueue — same effect as “Aggiorna libreria”.
   */
  const refreshLocalLibraryFully = async () => {
    if (window.karaokeApi && settings.libraryPath?.trim()) {
      try {
        await window.karaokeApi.library.scanFolder(settings.libraryPath.trim());
      } catch (err) {
        logLibrary('error', 'Library reindex after archive failed:', err);
      }
    }
    await loadLocalCatalog();
    window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
  };

  useEffect(() => {
    loadLocalCatalog({ reset: true });

    const handleLibraryRefreshed = () => {
      loadLocalCatalog({ reset: true });
    };
    window.addEventListener('karaoke:library-refreshed', handleLibraryRefreshed);
    const unSubReindex = window.karaokeApi?.downloads?.onLibraryReindexed?.(() => {
      loadLocalCatalog({ reset: true });
    });
    const unSubTrackUpdated = window.karaokeApi?.downloads?.onLibraryTrackUpdated?.(
      (tracks) => {
        if (!tracks?.length) return;
        setLocalTracks((prev) => {
          const byId = new Map(prev.map((t) => [t.id, t]));
          const byPath = new Map(
            prev
              .filter((t) => t.localFilePath)
              .map((t) => [t.localFilePath!.toLowerCase(), t.id])
          );
          for (const updated of tracks) {
            const pathKey = updated.localFilePath?.toLowerCase();
            const existingId = byId.has(updated.id)
              ? updated.id
              : pathKey
                ? byPath.get(pathKey)
                : undefined;
            if (existingId) {
              const prevTrack = byId.get(existingId)!;
              byId.set(existingId, { ...prevTrack, ...updated, id: existingId });
            } else {
              byId.set(updated.id, updated);
            }
          }
          return Array.from(byId.values());
        });
      }
    );
    const unSubScanProgress = window.karaokeApi?.library?.onScanProgress?.((progress) => {
      if (progress.phase === 'done') {
        setScanProgress(null);
        return;
      }
      setScanProgress({ scanned: progress.scanned, found: progress.found });
    });

    return () => {
      window.removeEventListener('karaoke:library-refreshed', handleLibraryRefreshed);
      unSubReindex?.();
      unSubTrackUpdated?.();
      unSubScanProgress?.();
    };
  }, [settings.libraryPath]);

  useEffect(() => {
    if (window.karaokeApi) {
      const unSub = window.karaokeApi.downloads.onProgress(async (payload) => {
        setActiveDownloads((prev) => ({ ...prev, [payload.downloadId]: payload }));

        if (payload.status === 'completed' || payload.status === 'error' || payload.status === 'cancelled') {
          window.setTimeout(() => {
            setActiveDownloads((cur) => {
              if (!(payload.downloadId in cur)) return cur;
              const cleaned = { ...cur };
              delete cleaned[payload.downloadId];
              return cleaned;
            });
          }, 450);
        }

        if (payload.status === 'error') {
          const pending = pendingArchiveEnqueueRef.current[payload.downloadId];
          if (pending) {
            delete pendingArchiveEnqueueRef.current[payload.downloadId];
          }
          // Failures surface in the header Downloads menu (errorMessage on the row) —
          // do not toast outside the download queue for in-flight jobs.
          // Drop non-playable YouTube queue items that never got a local file
          const queue = useKaraokeStore.getState().queue;
          for (const item of queue) {
            if (
              item.track.source === 'youtube' &&
              !item.track.localFilePath &&
              (item.track.id === pending?.track.id || item.track.uri === pending?.track.uri)
            ) {
              removeFromQueue(item.queueId);
            }
          }
        }

        if (payload.status === 'cancelled') {
          const pending = pendingArchiveEnqueueRef.current[payload.downloadId];
          if (pending) {
            delete pendingArchiveEnqueueRef.current[payload.downloadId];
            showToast(
              t('library.queueArchiveCancelled', 'Download cancelled — track was not added to the queue.'),
              'error'
            );
          }
        }

        // Download success status stays in the header Downloads menu only —
        // no overlay "Download completato" badge in the library panel.

        if (payload.status === 'completed' && payload.outputFilePath) {
          const associatedTrack = trackMap[payload.downloadId];
          if (associatedTrack) {
            const isFinishedLibraryFile = (filePath: string, source?: KaraokeMediaTrack['source']) => {
              if (source !== 'local_library') return false;
              const lower = filePath.toLowerCase();
              if (!filePath) return false;
              if (lower.includes('queue_cache') || lower.includes(`${'temp'}`) || lower.includes('/tmp')) return false;
              if (lower.endsWith('.part') || lower.endsWith('.ytdl') || lower.endsWith('.tmp')) return false;
              return true;
            };

            const applyLocalPreview = (
              localFilePath: string,
              uri: string,
              source?: KaraokeMediaTrack['source'],
              opts?: { touchLibraryList?: boolean }
            ) => {
              const patch: Partial<KaraokeMediaTrack> = {
                localFilePath,
                uri,
                ...(source ? { source } : {})
              };
              updateTrackInQueue(associatedTrack.id, patch);
              updateTrackInQueue(associatedTrack.uri, patch);
              patchTrackInAllResults(associatedTrack.id, associatedTrack.uri, patch);
              // Only surface complete library files in the Local list. Temp/partial/cache
              // paths must not create ghost rows (they look like duplicates until restart).
              if (opts?.touchLibraryList && isFinishedLibraryFile(localFilePath, source)) {
                setLocalTracks((prev) => {
                  const keyPath = localFilePath.toLowerCase();
                  const filtered = prev.filter(
                    (track) =>
                      track.id !== associatedTrack.id &&
                      track.uri !== associatedTrack.uri &&
                      (track.localFilePath || '').toLowerCase() !== keyPath
                  );
                  return [
                    { ...associatedTrack, ...patch, source: 'local_library' as const, id: associatedTrack.id },
                    ...filtered
                  ];
                });
              }
              setTrackMap((prev) => {
                const existing = prev[payload.downloadId];
                if (!existing) return prev;
                return { ...prev, [payload.downloadId]: { ...existing, ...patch } };
              });
            };

            const pendingEnqueue = pendingArchiveEnqueueRef.current[payload.downloadId];

            // Dedup reuse: progress already points at the permanent/cache file — just relink
            if (payload.alreadyExists) {
              const localUri = `karaoke://local/${encodeURIComponent(payload.outputFilePath)}`;
              const asLibrary = payload.existingLocation === 'library';
              if (pendingEnqueue) {
                delete pendingArchiveEnqueueRef.current[payload.downloadId];
                if (asLibrary) {
                  const localTrack: KaraokeMediaTrack = {
                    ...pendingEnqueue.track,
                    source: 'local_library',
                    localFilePath: payload.outputFilePath,
                    uri: localUri
                  };
                  await refreshLocalLibraryFully();
                  addToQueue(
                    localTrack,
                    pendingEnqueue.singerName?.trim() || undefined,
                    false,
                    0,
                    pendingEnqueue.placement
                  );
                  showToast(t('library.queueArchiveReady', { title: localTrack.title }));
                } else {
                  showToast(
                    t('errors.downloadFailed', {
                      error: 'Existing file is not in the permanent library'
                    }),
                    'error',
                    0
                  );
                }
                return;
              }
              applyLocalPreview(
                payload.outputFilePath,
                localUri,
                asLibrary ? 'local_library' : associatedTrack.source,
                { touchLibraryList: false }
              );
              if (asLibrary) {
                await refreshLocalLibraryFully();
              }
              return;
            }

            // Pending YouTube→queue with auto-archive: archive first, then enqueue LOCAL only
            if (pendingEnqueue && settings.autoArchiveWebTracks) {
              if (!settings.libraryPath?.trim()) {
                delete pendingArchiveEnqueueRef.current[payload.downloadId];
                showToast(
                  t(
                    'errors.libraryPathRequired',
                    'Imposta la cartella libreria nelle impostazioni prima di scaricare.'
                  ),
                  'error',
                  0
                );
                return;
              }
              try {
                const saved = await window.karaokeApi.downloads.saveToLibrary({
                  tempFilePath: payload.outputFilePath,
                  title: pendingEnqueue.track.title,
                  artist: pendingEnqueue.track.artist,
                  durationSec: pendingEnqueue.track.durationSec,
                  targetDirectory: settings.libraryPath,
                  trackId: pendingEnqueue.track.id
                });
                delete pendingArchiveEnqueueRef.current[payload.downloadId];
                if (!saved.localFilePath || !saved.uri) {
                  showToast(
                    t('errors.downloadFailed', { error: 'Archive produced no local file' }),
                    'error',
                    0
                  );
                  return;
                }
                const localTrack: KaraokeMediaTrack = {
                  ...pendingEnqueue.track,
                  ...saved,
                  source: 'local_library',
                  localFilePath: saved.localFilePath,
                  uri: saved.uri
                };
                patchTrackInAllResults(pendingEnqueue.track.id, pendingEnqueue.track.uri, {
                  localFilePath: saved.localFilePath,
                  uri: saved.uri,
                  source: 'local_library'
                });
                await refreshLocalLibraryFully();
                addToQueue(
                  localTrack,
                  pendingEnqueue.singerName?.trim() || undefined,
                  false,
                  0,
                  pendingEnqueue.placement
                );
                showToast(t('library.queueArchiveReady', { title: saved.title || localTrack.title }));
              } catch (err) {
                delete pendingArchiveEnqueueRef.current[payload.downloadId];
                logLibrary('error', 'Auto-archive before queue failed:', err);
                showToast(t('errors.downloadFailed', { error: String(err) }), 'error', 0);
              }
              return;
            }

            const localUri = `karaoke://local/${encodeURIComponent(payload.outputFilePath)}`;
            // Relink queue/search only — never index temp/partial output as a library row
            applyLocalPreview(payload.outputFilePath, localUri, undefined, { touchLibraryList: false });

            // Auto-archive web tracks if enabled (track already in queue, e.g. guest request)
            if (settings.autoArchiveWebTracks) {
              if (!settings.libraryPath?.trim()) {
                logLibrary('error', 'Auto-archive skipped: libraryPath is not configured');
                return;
              }
              try {
                const saved = await window.karaokeApi.downloads.saveToLibrary({
                  tempFilePath: payload.outputFilePath,
                  title: associatedTrack.title,
                  artist: associatedTrack.artist,
                  durationSec: associatedTrack.durationSec,
                  targetDirectory: settings.libraryPath,
                  trackId: associatedTrack.id
                });
                if (saved.localFilePath && saved.uri) {
                  applyLocalPreview(saved.localFilePath, saved.uri, 'local_library', {
                    touchLibraryList: false
                  });
                  updateTrackInQueue(payload.outputFilePath, {
                    localFilePath: saved.localFilePath,
                    uri: saved.uri,
                    source: 'local_library'
                  });
                }
                // Full reindex so Local shows the new file with thumbnail (no manual Aggiorna libreria)
                await refreshLocalLibraryFully();
              } catch (err) {
                logLibrary('error', 'Auto-archive failed:', err);
                showToast(t('errors.downloadFailed', { error: String(err) }), 'error', 0);
              }
            } else {
              // Auto-archive disabled: persist downloaded media into dedicated queue cache directory
              try {
                const cached = await window.karaokeApi.downloads.saveToQueueCache({
                  tempFilePath: payload.outputFilePath,
                  title: associatedTrack.title,
                  artist: associatedTrack.artist,
                  durationSec: associatedTrack.durationSec,
                  trackId: associatedTrack.id
                });
                if (cached.localFilePath && cached.uri) {
                  applyLocalPreview(cached.localFilePath, cached.uri);
                  updateTrackInQueue(payload.outputFilePath, {
                    localFilePath: cached.localFilePath,
                    uri: cached.uri
                  });
                }
              } catch (err) {
                logLibrary('error', 'Queue cache save failed:', err);
              }
            }
          }
        }
      });
      return () => unSub();
    }
  }, [
    settings.autoArchiveWebTracks,
    settings.libraryPath,
    trackMap,
    updateTrackInQueue,
    removeFromQueue,
    addToQueue,
    t
  ]);



  // Continuous LOCAL search only — updates the local bucket; never touches web results/network.
  useEffect(() => {
    if (searchMode !== 'local') return;
    const q = localQuery.trim();
    if (!q) {
      setLocalResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!window.karaokeApi?.db?.searchTracks) {
        setLocalResults(
          localTracks.filter(
            (track) =>
              textMatchesSearch(track.title, q) || textMatchesSearch(track.artist, q)
          )
        );
        return;
      }
      try {
        const matches = await window.karaokeApi.db.searchTracks(q, 200);
        if (!cancelled) setLocalResults(matches);
      } catch (err) {
        logLibrary('error', 'Local library search failed:', err);
        if (!cancelled) {
          setLocalResults(
            localTracks.filter(
              (track) =>
                textMatchesSearch(track.title, q) || textMatchesSearch(track.artist, q)
            )
          );
        }
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [localQuery, localTracks, searchMode, setLocalResults]);


  const handleScanOrRefresh = async () => {
    if (!window.karaokeApi) return;
    let folder: string | null = settings.libraryPath || null;
    if (!folder) {
      // If no library path is set yet, prompt to pick a directory and save it into settings
      folder = await window.karaokeApi.dialog.openDirectory();
      if (!folder) return;
      updateSettings({ libraryPath: folder });
    }

    setIsScanning(true);
    try {
      const discovered = await window.karaokeApi.library.scanFolder(folder);
      await loadLocalCatalog({ reset: true });
      const count =
        (await window.karaokeApi.db.getTracksCount?.()) ??
        discovered.length ??
        localCatalogTotal;
      window.dispatchEvent(
        new CustomEvent('karaoke:library-refreshed', { detail: { count } })
      );
      showToast(t('library.scanSuccess', { count }));
      setScanProgress(null);
    } catch (err) {
      logLibrary('error', 'Library scan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  /**
   * Catalog OS-dropped media files into SQLite and prepend them to the Local list.
   * Why: success toast is intentional for import (download completion stays menu-only).
   */
  const handleOsFileDrop = async (fileList: FileList | null) => {
    if (!window.karaokeApi?.library?.importFiles || isImportingDrop) return;
    const paths = resolveDroppedAbsolutePaths(fileList);
    if (!paths.length) {
      showToast(t('library.importNoFiles'), 'warning');
      return;
    }
    setIsImportingDrop(true);
    try {
      const imported = await window.karaokeApi.library.importFiles(paths);
      if (!imported.length) {
        showToast(t('library.importNoFiles'), 'warning');
        return;
      }
      setLocalTracks((prev) => {
        const ids = new Set<string>();
        const paths = new Set<string>();
        const uris = new Set<string>();
        for (const n of imported) {
          ids.add(n.id);
          if (n.localFilePath) paths.add(n.localFilePath);
          if (n.uri) uris.add(n.uri);
        }
        const filtered = prev.filter(
          (t) =>
            !ids.has(t.id) &&
            !(t.localFilePath && paths.has(t.localFilePath)) &&
            !(t.uri && uris.has(t.uri))
        );
        return [...imported, ...filtered];
      });
      window.dispatchEvent(
        new CustomEvent('karaoke:library-refreshed', { detail: { count: imported.length } })
      );
      showToast(t('library.importSuccess', { count: imported.length }), 'success');
    } catch (err) {
      logLibrary('error', 'Library OS drop import error:', err);
      showToast(t('library.importFailed'), 'error');
    } finally {
      setIsImportingDrop(false);
      setFileDropActive(false);
    }
  };

  const YOUTUBE_PAGE_SIZE = 10;

  const handleStopWebSearch = async () => {
    webSearchGenRef.current += 1;
    setWebSearching(false);
    setWebLoadingMore(false);
    try {
      await window.karaokeApi?.library?.cancelYouTubeSearch?.();
    } catch (err) {
      logLibrary('error', 'Cancel YouTube search error:', err);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // Web search only runs on explicit submit while Web tab is active.
    // Local filtering is live; submit still refreshes the local bucket.
    if (searchMode === 'web') {
      const q = webQuery.trim();
      if (!q) {
        setWebResults([]);
        setWebHasMore(false);
        return;
      }
      const gen = ++webSearchGenRef.current;
      setWebSearching(true);
      setWebHasMore(false);
      webSearchOffsetRef.current = 0;
      try {
        if (window.karaokeApi) {
          const ytTracks = await window.karaokeApi.library.searchYouTube(q, {
            offset: 0,
            limit: YOUTUBE_PAGE_SIZE
          });
          if (gen !== webSearchGenRef.current) return;
          setWebResults(ytTracks);
          webSearchOffsetRef.current = ytTracks.length > 0 ? YOUTUBE_PAGE_SIZE : 0;
          setWebHasMore(ytTracks.length >= YOUTUBE_PAGE_SIZE);
        }
      } finally {
        if (gen === webSearchGenRef.current) {
          setWebSearching(false);
        }
      }
      return;
    }

    const q = localQuery.trim();
    if (!q) {
      setLocalResults([]);
      return;
    }
    setLocalSearching(true);
    try {
      if (window.karaokeApi?.db?.searchTracks) {
        const matches = await window.karaokeApi.db.searchTracks(q, 200);
        setLocalResults(matches);
      } else {
        setLocalResults(
          localTracks.filter(
            (t) => textMatchesSearch(t.title, q) || textMatchesSearch(t.artist, q)
          )
        );
      }
    } finally {
      setLocalSearching(false);
    }
  };

  const handleLoadMoreVideos = async () => {
    if (searchMode !== 'web' || webLoadingMore || !webHasMore) return;
    const q = webQuery.trim();
    if (!q || !window.karaokeApi) return;
    const gen = ++webSearchGenRef.current;
    setWebLoadingMore(true);
    try {
      const offset = webSearchOffsetRef.current;
      const next = await window.karaokeApi.library.searchYouTube(q, {
        offset,
        limit: YOUTUBE_PAGE_SIZE
      });
      if (gen !== webSearchGenRef.current) return;
      setWebResults((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        const appended = next.filter((t) => t.id && !seen.has(t.id));
        return [...prev, ...appended];
      });
      webSearchOffsetRef.current = offset + YOUTUBE_PAGE_SIZE;
      setWebHasMore(next.length >= YOUTUBE_PAGE_SIZE);
    } finally {
      if (gen === webSearchGenRef.current) {
        setWebLoadingMore(false);
      }
    }
  };

  const displayedTracks =
    searchMode === 'local'
      ? localQuery.trim()
        ? searchResults
        : localTracks
      : searchResults;

  // Windowed rendering for 16k+ local catalogs — only mount visible rows
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportH, setListViewportH] = useState(480);
  React.useEffect(() => {
    const el = resultsListRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setListViewportH(el.clientHeight || 480);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [resultsListRef, displayedTracks.length, searchMode]);

  const libraryRowHeight = LIBRARY_ROW_HEIGHT;
  const studioRowStrides = useMemo(() => {
    if (!embedded) return null;
    return displayedTracks.map((t) => estimateStudioLibraryRowStride(t));
  }, [embedded, displayedTracks]);

  const virtWindow = embedded && studioRowStrides
    ? computeVirtualWindowVariable(
        listScrollTop,
        listViewportH,
        studioRowStrides,
        8
      )
    : computeVirtualWindow(
        listScrollTop,
        listViewportH,
        displayedTracks.length,
        libraryRowHeight,
        8
      );
  const virtualizedTracks = displayedTracks.slice(virtWindow.startIndex, virtWindow.endIndex);

  const handleListScroll: React.UIEventHandler<HTMLDivElement> = (e) => {
    onListScroll();
    const el = e.currentTarget;
    setListScrollTop(el.scrollTop);
    // Prefetch next Local page when browsing empty query near the bottom.
    if (
      searchMode === 'local' &&
      !localQuery.trim() &&
      localHasMore &&
      !localLoadingMore &&
      el.scrollHeight - el.scrollTop - el.clientHeight < libraryRowHeight * 12
    ) {
      void loadMoreLocalTracks();
    }
  };

  const handleStartDownload = async (
    track: KaraokeMediaTrack,
    opts?: { instrumental?: boolean; includeSubtitles?: boolean }
  ) => {
    if (!window.karaokeApi) return;
    if (settings.autoArchiveWebTracks && !settings.libraryPath?.trim()) {
      showToast(t('errors.libraryPathRequired', 'Imposta la cartella libreria nelle impostazioni prima di scaricare.'));
      return;
    }
    const instrumental = opts?.instrumental === true;
    if (instrumental) {
      // Non-blocking warning — instrumental AI/algo post-process is heavier than a normal download
      showToast(t('library.instrumentalDownloadWarning'), 'warning', 7000);
    }
    const titleHint = instrumental
      ? /instrumental/i.test(track.title || '')
        ? track.title
        : `${(track.title || 'Unknown').trim()} (Instrumental)`
      : track.title;
    try {
      const method = settings.instrumentalVocalRemoverMethod;
      const isMdx = method === 'aiMdxKaraoke2';
      const isDemucs = method === 'aiHtDemucs';
      const isAi = isMdx || isDemucs;
      const includeSubtitles =
        instrumental && opts?.includeSubtitles === true ? true : undefined;
      const result = await window.karaokeApi.downloads.start({
        url: track.uri,
        titleHint,
        artistHint: track.artist,
        trackId: track.id,
        libraryPath: settings.libraryPath || undefined,
        instrumental,
        vocalRemoverAlgorithm: method,
        // MDX advanced ETA knobs only when UVR-MDX-NET is selected.
        ...(isMdx
          ? {
              mdxSegmentSize: settings.mdxSegmentSize,
              mdxOverlap: settings.mdxOverlap,
              mdxEnableOrt: settings.mdxEnableOrt
            }
          : {}),
        // Demucs advanced knobs only when HTDemucs is selected.
        ...(isDemucs
          ? {
              demucsShifts: settings.demucsShifts,
              demucsSegmentSize: settings.demucsSegmentSize,
              demucsOverlap: settings.demucsOverlap
            }
          : {}),
        ...(isAi
          ? {
              aiCpuThreads: settings.aiCpuThreads,
              aiEnableGpu: settings.aiEnableGpu
            }
          : {}),
        ...(includeSubtitles ? { includeSubtitles: true } : {})
      });

      const mappedTrack: KaraokeMediaTrack = instrumental
        ? { ...track, title: titleHint || track.title }
        : track;
      setTrackMap((prev) => ({ ...prev, [result.downloadId]: mappedTrack }));

      if (result.alreadyExists && result.localFilePath) {
        const localUri = result.uri || `karaoke://local/${encodeURIComponent(result.localFilePath)}`;
        updateTrackInQueue(track.id, {
          localFilePath: result.localFilePath,
          uri: localUri,
          source: result.location === 'library' ? 'local_library' : track.source,
          ...(instrumental ? { title: mappedTrack.title } : {})
        });
        updateTrackInQueue(track.uri, {
          localFilePath: result.localFilePath,
          uri: localUri,
          source: result.location === 'library' ? 'local_library' : track.source,
          ...(instrumental ? { title: mappedTrack.title } : {})
        });
        // Reuse notice is shown in the header Downloads menu (alreadyExists payload),
        // same channel as Instrumental phase / concurrency "queued" labels — no toast.
        if (result.location === 'library') {
          await loadLocalCatalog();
          window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
        }
      }
    } catch (err) {
      // Pre-queue start failures (IPC/bridge) never get a Downloads menu row
      showToast(t('errors.downloadFailed', { error: String(err) }));
    }
  };

  /**
   * Download Instrumental entry: honor persisted subtitle policy, else open modal.
   * Normal (non-instrumental) download never uses this path.
   */
  const handleInstrumentalDownloadClick = (track: KaraokeMediaTrack) => {
    const policy = settings.instrumentalSubtitlesPolicy || 'ask';
    if (policy === 'always') {
      void handleStartDownload(track, { instrumental: true, includeSubtitles: true });
      return;
    }
    if (policy === 'never') {
      void handleStartDownload(track, { instrumental: true, includeSubtitles: false });
      return;
    }
    setInstrumentalSubtitlesTrack(track);
  };

  const executeAddToQueue = async (
    track: KaraokeMediaTrack,
    singerName?: string,
    placement: 'auto' | 'end' = 'auto'
  ) => {
    // Block enqueue when local path is missing (USB unplug / moved / deleted outside app)
    if (trackNeedsLocalFileCheck(track)) {
      const check = await checkTrackLocalFileExists(track);
      if (!check.exists) {
        markTrackMissing(track.id);
        showMissingFileModal({
          filePath: check.path,
          trackTitle: track.title,
          trackArtist: track.artist,
          trackId: track.id,
          context: 'library'
        });
        return;
      }
      clearTrackMissing(track.id);
    }

    // Auto-archive ON: wait for download + library archive, then enqueue the LOCAL file only.
    // Avoids non-playable YouTube/temp queue pointers that need a manual “Refresh Library”.
    if (track.source === 'youtube' && !track.localFilePath && settings.autoArchiveWebTracks) {
      if (!window.karaokeApi) return;
      if (!settings.libraryPath?.trim()) {
        showToast(
          t('errors.libraryPathRequired', 'Imposta la cartella libreria nelle impostazioni prima di scaricare.'),
          'error'
        );
        return;
      }

      const isAlreadyDownloading = Object.keys(activeDownloads).some(
        (id) => trackMap[id]?.uri === track.uri || trackMap[id]?.id === track.id
      );
      if (isAlreadyDownloading) {
        // Attach enqueue intent to the in-flight download if missing
        for (const [downloadId, mapped] of Object.entries(trackMap)) {
          if (mapped.uri === track.uri || mapped.id === track.id) {
            if (!pendingArchiveEnqueueRef.current[downloadId]) {
              pendingArchiveEnqueueRef.current[downloadId] = {
                track,
                singerName: singerName?.trim() || undefined,
                placement
              };
            }
            showToast(t('library.queueArchivePending', { title: track.title }));
            return;
          }
        }
      }

      try {
        showToast(t('library.queueArchivePending', { title: track.title }));
        const result = await window.karaokeApi.downloads.start({
          url: track.uri,
          titleHint: track.title,
          artistHint: track.artist,
          trackId: track.id,
          libraryPath: settings.libraryPath || undefined
        });

        setTrackMap((prev) => ({ ...prev, [result.downloadId]: track }));

        if (result.alreadyExists && result.localFilePath) {
          const localUri = result.uri || `karaoke://local/${encodeURIComponent(result.localFilePath)}`;
          if (result.location === 'library') {
            const localTrack: KaraokeMediaTrack = {
              ...track,
              source: 'local_library',
              localFilePath: result.localFilePath,
              uri: localUri
            };
            await refreshLocalLibraryFully();
            addToQueue(localTrack, singerName?.trim() || undefined, false, 0, placement);
            showToast(t('library.queueArchiveReady', { title: localTrack.title }));
          } else {
            // Rare: file exists only in cache — promote to library before enqueue
            const saved = await window.karaokeApi.downloads.saveToLibrary({
              tempFilePath: result.localFilePath,
              title: track.title,
              artist: track.artist,
              durationSec: track.durationSec,
              targetDirectory: settings.libraryPath,
              trackId: track.id
            });
            const localTrack: KaraokeMediaTrack = {
              ...track,
              ...saved,
              source: 'local_library'
            };
            await refreshLocalLibraryFully();
            addToQueue(localTrack, singerName?.trim() || undefined, false, 0, placement);
            showToast(t('library.queueArchiveReady', { title: localTrack.title }));
          }
          return;
        }

        pendingArchiveEnqueueRef.current[result.downloadId] = {
          track,
          singerName: singerName?.trim() || undefined,
          placement
        };
      } catch (err) {
        showToast(t('errors.downloadFailed', { error: String(err) }), 'error', 0);
      }
      return;
    }

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
    <div
      className={
        embedded
          ? 'flex flex-col h-full min-h-0 overflow-hidden relative p-3'
          : 'bg-slate-900/90 border border-slate-800/80 rounded-3xl p-4 md:p-5 shadow-2xl backdrop-blur-xl flex flex-col h-full min-h-0 overflow-hidden relative'
      }
      data-testid="library-panel-drop-zone"
      onDragEnter={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        setFileDropActive(true);
      }}
      onDragOver={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        if (!fileDropActive) setFileDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        // Only clear when leaving the panel root (not child bubbles)
        if (e.currentTarget === e.target) {
          setFileDropActive(false);
        }
      }}
      onDrop={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        setFileDropActive(false);
        void handleOsFileDrop(e.dataTransfer.files);
      }}
    >
      {fileDropActive && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed border-emerald-400/70 bg-slate-950/80 pointer-events-none"
          data-testid="library-file-drop-overlay"
          aria-hidden
        >
          <span className="text-sm font-semibold text-emerald-200 px-4 text-center">
            {t('library.dropToImport')}
          </span>
        </div>
      )}
      {/* Search Header & Mode Toggle */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-full border border-slate-800/80 text-xs font-semibold shadow-inner">
          <button
            type="button"
            onClick={() => {
              setSearchMode('local');
            }}
            className={`px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition-all ${
              searchMode === 'local'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            {t('library.modeLocal')} ({localCatalogTotal || localTracks.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchMode('web');
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
            disabled={isScanning}
            title={
              settings.libraryPath
                ? `${t('library.scanFolder')} (${settings.libraryPath})`
                : t('settings.noLibraryPathSelected')
            }
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/80 flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isScanning ? 'animate-spin' : ''}`} />
            {isScanning && scanProgress
              ? t('library.scanProgress', {
                  scanned: scanProgress.scanned,
                  found: scanProgress.found
                })
              : t('library.scanFolder')}
          </button>
        )}
      </div>

      {/* Search form — singer is chosen only in the enqueue assign modal */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <input
            ref={searchInputRef}
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
          disabled={isSearching || webLoadingMore}
          className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:opacity-50 text-white font-semibold rounded-full text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/25 transition-all"
        >
          {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : t('library.searchBtn')}
        </button>
        {searchMode === 'web' && (isSearching || webLoadingMore) && (
          <button
            type="button"
            onClick={() => void handleStopWebSearch()}
            className="px-3 py-2 bg-slate-800/90 hover:bg-slate-700 text-slate-100 font-semibold rounded-full text-xs flex items-center gap-1.5 border border-slate-700/80 shadow-sm transition-all"
            title={t('library.stopSearch')}
            aria-label={t('library.stopSearch')}
            data-testid="youtube-stop-search"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            {t('library.stopSearch')}
          </button>
        )}
      </form>

      {/* Results List */}
      <div
        ref={resultsListRef}
        onScroll={handleListScroll}
        className="flex-1 min-h-0 overflow-y-auto pr-1"
        data-testid="library-results-list"
      >
        {displayedTracks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 text-slate-500 gap-2">
            <Music className="w-8 h-8 opacity-25" />
            <p className="text-xs font-medium text-slate-400">
              {isSearching
                ? t('library.searching')
                : searchMode === 'web'
                  ? t('library.emptyWeb', 'Nessun risultato web. Digita e premi Invio per cercare su YouTube.')
                  : localQuery.trim()
                    ? t('library.emptyFilter', 'Nessun brano corrisponde alla ricerca locale.')
                    : t('library.emptyLocal', 'Libreria vuota. Scansiona una cartella o cerca sul web.')}
            </p>
          </div>
        ) : (
          <div
            style={{
              paddingTop: virtWindow.paddingTop,
              paddingBottom: virtWindow.paddingBottom
            }}
            data-testid="library-virtual-window"
          >
          {virtualizedTracks.map((track, windowIdx) => {
            const versionTags = extractVersionTags(track);
            const isMissing = missingTrackIdSet.has(track.id);
            const absIndex = virtWindow.startIndex + windowIdx;
            const studioStride =
              embedded && studioRowStrides
                ? studioRowStrides[absIndex] ?? estimateStudioLibraryRowStride(track)
                : null;

            const trackActions = (
              <div
                className={`flex items-center gap-1.5 sm:gap-2 flex-wrap ${
                  embedded ? 'mt-2.5 shrink-0' : 'shrink-0'
                }`}
                data-testid={embedded ? 'library-row-actions' : undefined}
              >
                {/* Video Preview Button */}
                <button
                  type="button"
                  onClick={() => setPreviewTrack(track)}
                  className="p-2 bg-slate-800/80 hover:bg-slate-700 text-indigo-300 hover:text-white border border-slate-700/80 rounded-full text-xs flex items-center gap-1 transition-all"
                  title={t('library.previewVideo')}
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>

                {/* Pre-Ascolto — opens themed preview modal only (CUE routing inside modal) */}
                <button
                  type="button"
                  onClick={() => setPreviewTrack(track)}
                  className="p-2 bg-slate-800/80 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-slate-700/80 rounded-full text-xs flex items-center gap-1 transition-all"
                  title={t('player.cue')}
                >
                  <Headphones className="w-3.5 h-3.5" />
                </button>

                {track.source === 'youtube' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleStartDownload(track)}
                      className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 rounded-full text-xs flex items-center gap-1 transition-all"
                      title={t('library.download')}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    {isInstrumentalDownloadEligibleTitle(track.title) && (
                      <button
                        type="button"
                        onClick={() => handleInstrumentalDownloadClick(track)}
                        className="p-2 bg-slate-800/80 hover:bg-slate-700 text-emerald-300 hover:text-emerald-200 border border-slate-700/80 rounded-full text-xs flex items-center gap-1 transition-all"
                        title={t('library.downloadInstrumental')}
                        data-testid="download-instrumental-btn"
                      >
                        <Music className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}

                {(track.source === 'local_library' || track.source === 'midi') &&
                  track.localFilePath && (
                    <button
                      type="button"
                      onClick={() => setTrackPendingDelete(track)}
                      className="p-2 bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-700/80 hover:border-rose-700/60 rounded-full text-xs flex items-center gap-1 transition-all"
                      title={t('library.deleteTrack')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                <button
                  type="button"
                  onClick={async () => {
                    // Pre-check before opening singer modal — same gate as executeAddToQueue
                    if (trackNeedsLocalFileCheck(track)) {
                      const check = await checkTrackLocalFileExists(track);
                      if (!check.exists) {
                        markTrackMissing(track.id);
                        showMissingFileModal({
                          filePath: check.path,
                          trackTitle: track.title,
                          trackArtist: track.artist,
                          trackId: track.id,
                          context: 'library'
                        });
                        return;
                      }
                      clearTrackMissing(track.id);
                    }
                    useKaraokeStore.getState().loadSingersFromDb();
                    setModalSingerInput('');
                    setPlacementMode('auto');
                    setPendingTrackForQueue(track);
                  }}
                  className="px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-full text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/25 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> {t('queue.addToQueue')}
                </button>
              </div>
            );

            const thumb = (
              <div
                onClick={() => setPreviewTrack(track)}
                className={`w-20 sm:w-24 aspect-video rounded-xl bg-slate-950 overflow-hidden relative group/thumb shrink-0 cursor-pointer shadow-sm transition-all flex items-center justify-center ${
                  isMissing
                    ? 'border border-rose-500/70'
                    : 'border border-slate-800/80 hover:border-indigo-500/80'
                }`}
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
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-indigo-300">
                      MIDI
                    </span>
                  </div>
                ) : (
                  <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center text-slate-500">
                    <Film className="w-4 h-4 mb-0.5" />
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-slate-400">
                      VIDEO
                    </span>
                  </div>
                )}

                <div className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity">
                  <div className="p-1.5 rounded-full bg-indigo-600/90 text-white shadow-md">
                    <Play className="w-3 h-3 fill-white ml-0.5" />
                  </div>
                </div>
              </div>
            );

            const trackMeta = (
              <>
                <div
                  onClick={() => setPreviewTrack(track)}
                  className={`font-semibold text-xs transition-colors cursor-pointer flex items-start gap-1.5 min-w-0 w-full ${
                    embedded ? 'whitespace-normal break-words' : 'truncate'
                  } ${
                    isMissing
                      ? 'text-rose-200 hover:text-rose-100'
                      : 'text-slate-200 hover:text-indigo-300'
                  }`}
                  title={track.title}
                >
                  <span className={embedded ? 'min-w-0 flex-1' : 'truncate'}>{track.title}</span>
                  {isMissing && (
                    <span
                      className="inline-flex items-center gap-0.5 text-rose-400 shrink-0"
                      title={t('errors.missingFileTooltip')}
                    >
                      <FileX className="w-3.5 h-3.5" />
                      <AlertCircle className="w-3 h-3 opacity-80" />
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5 mt-0.5 min-w-0">
                  <span className="truncate min-w-0 max-w-full">{track.artist}</span>
                  <TrackKeyBpmBadges
                    initialKey={track.initialKey}
                    initialBpm={track.initialBpm}
                  />
                  <span className="text-slate-600">•</span>
                  <span className="uppercase text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-slate-800/80 text-indigo-300 border border-slate-700/50 shrink-0">
                    {track.source === 'local_library' ? 'locale' : track.source}
                  </span>
                  {versionTags.map((vTag) => (
                    <span
                      key={vTag}
                      className="text-[9px] font-semibold px-1.5 py-0.2 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 shadow-sm shrink-0"
                    >
                      {vTag}
                    </span>
                  ))}
                </div>
              </>
            );

            return (
              <div
                key={track.id}
                style={
                  embedded
                    ? {
                        // Grow with content; minHeight keeps bottom inset like short cards.
                        minHeight: (studioStride ?? estimateStudioLibraryRowStride(track)) - STUDIO_LIBRARY_ROW_GAP,
                        marginBottom: STUDIO_LIBRARY_ROW_GAP
                      }
                    : { height: LIBRARY_ROW_HEIGHT - 8, marginBottom: 8 }
                }
                className={`p-2.5 sm:p-3 border rounded-2xl flex gap-3 transition-all group/item box-border ${
                  embedded ? 'items-start overflow-visible' : 'items-center justify-between overflow-hidden'
                } ${
                  isMissing
                    ? 'bg-rose-950/40 border-rose-500/70 hover:bg-rose-950/55'
                    : 'bg-slate-950/40 hover:bg-slate-950/80 border-slate-800/60 hover:border-slate-700/80'
                }`}
                data-missing-file={isMissing ? 'true' : undefined}
                data-studio-library-row={embedded ? 'true' : undefined}
              >
                {embedded ? (
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {thumb}
                    <div className="min-w-0 flex-1 flex flex-col pb-0.5">
                      {trackMeta}
                      {trackActions}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 overflow-hidden min-w-0">
                      {thumb}
                      <div className="truncate min-w-0">{trackMeta}</div>
                    </div>
                    {trackActions}
                  </>
                )}
              </div>
            );
          })}
          </div>
        )}
        {searchMode === 'web' && displayedTracks.length > 0 && webHasMore && (
          <div className="pt-2 pb-1 flex justify-center">
            <button
              type="button"
              onClick={() => void handleLoadMoreVideos()}
              disabled={webLoadingMore || isSearching}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 shadow-sm transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
              data-testid="youtube-load-more"
            >
              {webLoadingMore ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : null}
              {webLoadingMore
                ? t('library.loadingMore', 'Caricamento…')
                : t('library.loadMoreVideos', 'Carica altri video')}
            </button>
          </div>
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
        cueAudioDeviceId={settings.cueAudioDeviceId}
        masterAudioDeviceId={settings.masterAudioDeviceId}
        midiSoundFontPath={settings.midiSoundFontPath}
        onClose={() => setPreviewTrack(null)}
        onAddToQueue={(trk, sName, placement) => executeAddToQueue(trk, sName, placement)}
      />

      <InstrumentalSubtitlesModal
        isOpen={instrumentalSubtitlesTrack !== null}
        track={instrumentalSubtitlesTrack}
        onClose={() => setInstrumentalSubtitlesTrack(null)}
        onConfirm={(choice, remember) => {
          const track = instrumentalSubtitlesTrack;
          setInstrumentalSubtitlesTrack(null);
          if (!track) return;
          const includeSubtitles = choice === 'with-subs';
          if (remember) {
            updateSettings({
              instrumentalSubtitlesPolicy: includeSubtitles ? 'always' : 'never'
            });
          }
          void handleStartDownload(track, { instrumental: true, includeSubtitles });
        }}
      />

      {trackPendingDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4">
            <h3 className="text-white font-semibold text-sm">{t('library.confirmDeleteTitle')}</h3>
            <p className="text-slate-300 text-xs leading-relaxed">
              {t('library.confirmDeleteMessage', {
                title: trackPendingDelete.title,
                artist: trackPendingDelete.artist
              })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeletingTrack}
                onClick={() => setTrackPendingDelete(null)}
                className="px-4 py-2 rounded-full text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 transition-all"
              >
                {t('library.confirmDeleteCancel')}
              </button>
              <button
                type="button"
                disabled={isDeletingTrack}
                onClick={async () => {
                  if (!trackPendingDelete || !window.karaokeApi?.db?.deleteTrack) return;
                  setIsDeletingTrack(true);
                  try {
                    const res = await window.karaokeApi.db.deleteTrack(trackPendingDelete.id);
                    if (res?.success) {
                      showToast(t('library.deleteSuccess'));
                      const deletedId = trackPendingDelete.id;
                      const deletedPath = (trackPendingDelete.localFilePath || '').trim().toLowerCase();
                      // Drop from Local catalog + local search; also clear path aliases.
                      setLocalTracks((prev) =>
                        prev.filter((x) => {
                          if (x.id === deletedId) return false;
                          if (
                            deletedPath &&
                            (x.localFilePath || '').trim().toLowerCase() === deletedPath
                          ) {
                            return false;
                          }
                          return true;
                        })
                      );
                      setLocalResults((prev) =>
                        prev.filter((x) => {
                          if (x.id === deletedId) return false;
                          if (
                            deletedPath &&
                            (x.localFilePath || '').trim().toLowerCase() === deletedPath
                          ) {
                            return false;
                          }
                          return true;
                        })
                      );
                      // Web results keep a patched local_library row after download —
                      // revert so Download (+ Instrumental) show again without re-search.
                      revertLibraryMembershipInResults({
                        id: trackPendingDelete.id,
                        uri: trackPendingDelete.uri,
                        localFilePath: trackPendingDelete.localFilePath
                      });
                      setTrackMap((prev) => {
                        const next = { ...prev };
                        delete next[deletedId];
                        return next;
                      });
                      if (previewTrack?.id === deletedId) setPreviewTrack(null);
                    } else {
                      showToast(t('library.deleteFailed'));
                    }
                  } catch {
                    showToast(t('library.deleteFailed'));
                  } finally {
                    setIsDeletingTrack(false);
                    setTrackPendingDelete(null);
                  }
                }}
                className="px-4 py-2 rounded-full text-xs font-semibold text-white bg-rose-700 hover:bg-rose-600 transition-all"
              >
                {t('library.confirmDeleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

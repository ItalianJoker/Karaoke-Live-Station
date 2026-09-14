import React, { useState, useEffect, useRef } from 'react';
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
  ArrowDownToLine,
  Trash2
} from 'lucide-react';
import { KaraokeMediaTrack, DownloadProgressPayload } from '../../shared/types';
import { useKaraokeStore } from '../store/karaokeStore';
import { useScopedLibrarySearch } from '../hooks/useScopedLibrarySearch';
import { VideoPreviewModal, extractVersionTags } from './VideoPreviewModal';

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
export const LibraryPanel: React.FC<LibraryPanelProps> = ({ onPlayCue: _onPlayCue, onStopCue: _onStopCue, activeCueUri: _activeCueUri, searchInputRef }) => {
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
    listRef: resultsListRef,
    onListScroll,
    localQuery,
    webQuery
  } = useScopedLibrarySearch();
  const [isScanning, setIsScanning] = useState(false);
  const [completedDownloads, setCompletedDownloads] = useState<
    Array<{ id: string; title: string; artist: string }>
  >([]);
  const [localTracks, setLocalTracks] = useState<KaraokeMediaTrack[]>([]);
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
  const [trackPendingDelete, setTrackPendingDelete] = useState<KaraokeMediaTrack | null>(null);
  const [isDeletingTrack, setIsDeletingTrack] = useState(false);
  // When auto-archive is on, YouTube→queue waits for library file before enqueue (no remote/temp pointer).
  const pendingArchiveEnqueueRef = useRef<Record<string, PendingArchiveEnqueue>>({});

  const settings = useKaraokeStore((state) => state.settings);
  const updateSettings = useKaraokeStore((state) => state.updateSettings);
  const addToQueue = useKaraokeStore((state) => state.addToQueue);
  const updateTrackInQueue = useKaraokeStore((state) => state.updateTrackInQueue);
  const removeFromQueue = useKaraokeStore((state) => state.removeFromQueue);

  const loadLocalCatalog = async () => {
    if (window.karaokeApi) {
      const tracks = await window.karaokeApi.db.getTracks();
      // Client-side safety net: one row per local path / stable id
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
      setLocalTracks(Array.from(byKey.values()));
      await useKaraokeStore.getState().loadSingersFromDb();
    }
  };

  useEffect(() => {
    loadLocalCatalog();

    const handleLibraryRefreshed = () => {
      loadLocalCatalog();
    };
    window.addEventListener('karaoke:library-refreshed', handleLibraryRefreshed);
    const unSubReindex = window.karaokeApi?.downloads?.onLibraryReindexed?.(() => {
      loadLocalCatalog();
    });

    return () => {
      window.removeEventListener('karaoke:library-refreshed', handleLibraryRefreshed);
      unSubReindex?.();
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
          showToast(
            t('errors.downloadFailed', { error: payload.errorMessage || 'Unknown error' }),
            'error',
            0
          );
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

        if (payload.status === 'completed') {
          const associatedTrack = trackMap[payload.downloadId];
          if (associatedTrack) {
            setCompletedDownloads((prev) => {
              if (prev.some((c) => c.id === payload.downloadId)) return prev;
              return [
                { id: payload.downloadId, title: associatedTrack.title, artist: associatedTrack.artist },
                ...prev
              ].slice(0, 12);
            });
          }
        }

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
                  await loadLocalCatalog();
                  window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
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
                await loadLocalCatalog();
                window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
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
                await loadLocalCatalog();
                window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
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
                console.error('Auto-archive before queue failed:', err);
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
                console.error('Auto-archive skipped: libraryPath is not configured');
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
                // Single authoritative refresh after upsert — drops any temp/path-hash ghosts
                await loadLocalCatalog();
                window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
              } catch (err) {
                console.error('Auto-archive failed:', err);
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
                console.error('Queue cache save failed:', err);
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
        const lower = q.toLowerCase();
        setLocalResults(
          localTracks.filter(
            (track) =>
              track.title.toLowerCase().includes(lower) ||
              track.artist.toLowerCase().includes(lower)
          )
        );
        return;
      }
      try {
        const matches = await window.karaokeApi.db.searchTracks(q, 200);
        if (!cancelled) setLocalResults(matches);
      } catch (err) {
        console.error('Local library search failed:', err);
        if (!cancelled) {
          const lower = q.toLowerCase();
          setLocalResults(
            localTracks.filter(
              (track) =>
                track.title.toLowerCase().includes(lower) ||
                track.artist.toLowerCase().includes(lower)
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
      await loadLocalCatalog();
      window.dispatchEvent(new CustomEvent('karaoke:library-refreshed', { detail: { count: discovered.length } }));
      showToast(t('library.scanSuccess', { count: discovered.length }));
    } catch (err) {
      console.error('Library scan error:', err);
    } finally {
      setIsScanning(false);
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
        return;
      }
      setWebSearching(true);
      try {
        if (window.karaokeApi) {
          const ytTracks = await window.karaokeApi.library.searchYouTube(q);
          setWebResults(ytTracks);
        }
      } finally {
        setWebSearching(false);
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
        const lower = q.toLowerCase();
        setLocalResults(
          localTracks.filter(
            (t) => t.title.toLowerCase().includes(lower) || t.artist.toLowerCase().includes(lower)
          )
        );
      }
    } finally {
      setLocalSearching(false);
    }
  };

  const displayedTracks =
    searchMode === 'local'
      ? localQuery.trim()
        ? searchResults
        : localTracks
      : searchResults;

  const handleStartDownload = async (track: KaraokeMediaTrack) => {
    if (!window.karaokeApi) return;
    if (settings.autoArchiveWebTracks && !settings.libraryPath?.trim()) {
      showToast(t('errors.libraryPathRequired', 'Imposta la cartella libreria nelle impostazioni prima di scaricare.'));
      return;
    }
    try {
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
        updateTrackInQueue(track.id, {
          localFilePath: result.localFilePath,
          uri: localUri,
          source: result.location === 'library' ? 'local_library' : track.source
        });
        updateTrackInQueue(track.uri, {
          localFilePath: result.localFilePath,
          uri: localUri,
          source: result.location === 'library' ? 'local_library' : track.source
        });
        showToast(
          t('library.alreadyLocal', {
            path: result.localFilePath,
            defaultValue:
              'Brano già presente in locale. Collegato il file esistente senza riscaricare:\n{{path}}'
          })
        );
        if (result.location === 'library') {
          await loadLocalCatalog();
          window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
        }
      }
    } catch (err) {
      showToast(t('errors.downloadFailed', { error: String(err) }));
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
        durationSec: track.durationSec,
        targetDirectory: settings.libraryPath || undefined,
        trackId: track.id
      });
      // Switch queue pointer to the permanent library file
      updateTrackInQueue(track.id, {
        localFilePath: saved.localFilePath,
        uri: saved.uri,
        source: 'local_library'
      });
      updateTrackInQueue(track.uri, {
        localFilePath: saved.localFilePath,
        uri: saved.uri,
        source: 'local_library'
      });
      if (track.localFilePath) {
        updateTrackInQueue(track.localFilePath, {
          localFilePath: saved.localFilePath,
          uri: saved.uri,
          source: 'local_library'
        });
      }
      if (dl.outputFilePath) {
        updateTrackInQueue(dl.outputFilePath, {
          localFilePath: saved.localFilePath,
          uri: saved.uri,
          source: 'local_library'
        });
      }
      await loadLocalCatalog();
      showToast(t('library.savedSuccess', { title: saved.title }));
    } catch (err) {
      showToast(t('errors.downloadFailed', { error: String(err) }));
    }
  };

  const executeAddToQueue = async (
    track: KaraokeMediaTrack,
    singerName?: string,
    placement: 'auto' | 'end' = 'auto'
  ) => {
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
            await loadLocalCatalog();
            window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
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
            await loadLocalCatalog();
            window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
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
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-3xl p-4 md:p-5 shadow-2xl backdrop-blur-xl flex flex-col h-full min-h-0 overflow-hidden">
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
            {t('library.modeLocal')} ({localTracks.length})
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
            {t('library.scanFolder')}
          </button>
        )}
      </div>

      {/* Search Form with Singer Quick Selector */}
      <div className="grid grid-cols-12 gap-2.5 mb-4">
        <form onSubmit={handleSearch} className="col-span-7 sm:col-span-8 flex gap-2">
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

      
      {/* Completed download badges (dismissible) */}
      {completedDownloads.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {completedDownloads.map((item) => (
            <div
              key={item.id}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 text-[11px] font-semibold shadow-sm"
              data-testid="download-complete-badge"
            >
              <span>
                {t('library.downloadComplete', 'Download completato')}: {item.title}
                {item.artist ? ` — ${item.artist}` : ''}
              </span>
              <button
                type="button"
                onClick={() =>
                  setCompletedDownloads((prev) => prev.filter((d) => d.id !== item.id))
                }
                className="p-0.5 rounded-full hover:bg-emerald-900/80 text-emerald-200 hover:text-white transition-colors"
                title={t('common.close', 'Chiudi')}
                aria-label={t('common.close', 'Chiudi')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Results List */}
      <div
        ref={resultsListRef}
        onScroll={onListScroll}
        className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1"
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
          displayedTracks.map((track) => {
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
                    <button
                      type="button"
                      onClick={() => handleStartDownload(track)}
                      className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 rounded-full text-xs flex items-center gap-1 transition-all"
                      title={t('library.downloading')}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}


                  {(track.source === 'local_library' || track.source === 'midi') && track.localFilePath && (
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
        cueAudioDeviceId={settings.cueAudioDeviceId}
        masterAudioDeviceId={settings.masterAudioDeviceId}
        midiSoundFontPath={settings.midiSoundFontPath}
        onClose={() => setPreviewTrack(null)}
        onAddToQueue={(trk, sName, placement) => executeAddToQueue(trk, sName, placement)}
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
                      setLocalTracks((prev) => prev.filter((x) => x.id !== deletedId));
                      setTrackMap((prev) => {
                        const next = { ...prev };
                        delete next[deletedId];
                        return next;
                      });
                      setLocalResults((prev) => prev.filter((x) => x.id !== deletedId));
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

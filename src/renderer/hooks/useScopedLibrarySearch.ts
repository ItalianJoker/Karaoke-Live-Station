import { useCallback, useEffect, useRef, useState } from 'react';
import {
  revertLibraryMembershipInTrackList,
  type DeletedLibraryIdentity
} from '../../shared/libraryMembership';
import type { KaraokeMediaTrack } from '../../shared/types';

/** Sub-tabs under Libreria & Ricerca */
export type LibrarySearchScope = 'local' | 'web';

/** Per-scope search UI state (query, results, loading, scroll). */
export interface ScopedSearchBucket {
  query: string;
  results: KaraokeMediaTrack[];
  isSearching: boolean;
  scrollTop: number;
}

export type ScopedSearchState = Record<LibrarySearchScope, ScopedSearchBucket>;

const STORAGE_MODE = 'kls.library.searchMode';
const STORAGE_LOCAL_QUERY = 'kls.library.localQuery';
const STORAGE_WEB_QUERY = 'kls.library.webQuery';
/** Legacy shared key — migrated once into localQuery */
const STORAGE_LEGACY_QUERY = 'kls.library.query';

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

function emptyBucket(query = ''): ScopedSearchBucket {
  return { query, results: [], isSearching: false, scrollTop: 0 };
}

function loadInitialState(): { mode: LibrarySearchScope; scopes: ScopedSearchState } {
  const mode: LibrarySearchScope = readSession(STORAGE_MODE) === 'web' ? 'web' : 'local';
  const legacy = readSession(STORAGE_LEGACY_QUERY) || '';
  const localQuery = readSession(STORAGE_LOCAL_QUERY) ?? legacy;
  const webQuery = readSession(STORAGE_WEB_QUERY) ?? '';
  return {
    mode,
    scopes: {
      local: emptyBucket(localQuery),
      web: emptyBucket(webQuery)
    }
  };
}

/**
 * Fully separate Libreria vs Web/YouTube search state so tab switches never
 * leak queries/results or trigger the other tab's network search.
 */
export function useScopedLibrarySearch() {
  const initial = useRef(loadInitialState()).current;
  const [searchMode, setSearchModeState] = useState<LibrarySearchScope>(initial.mode);
  const [scopes, setScopes] = useState<ScopedSearchState>(initial.scopes);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchModeRef = useRef(searchMode);
  searchModeRef.current = searchMode;

  const active = scopes[searchMode];

  // Persist mode + both queries (never a single shared query string).
  useEffect(() => {
    writeSession(STORAGE_MODE, searchMode);
    writeSession(STORAGE_LOCAL_QUERY, scopes.local.query);
    writeSession(STORAGE_WEB_QUERY, scopes.web.query);
    writeSession(STORAGE_LEGACY_QUERY, scopes.local.query);
  }, [searchMode, scopes.local.query, scopes.web.query]);

  // Restore scroll when switching scopes (after paint with the restored list).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = scopes[searchMode].scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mode change
  }, [searchMode]);

  const patchScope = useCallback(
    (scope: LibrarySearchScope, patch: Partial<ScopedSearchBucket>) => {
      setScopes((prev) => ({
        ...prev,
        [scope]: { ...prev[scope], ...patch }
      }));
    },
    []
  );

  const setQuery = useCallback(
    (query: string) => {
      patchScope(searchModeRef.current, { query });
    },
    [patchScope]
  );

  /** Always write the Local scope query — used by queue→library reveal while Web may be active. */
  const setLocalQuery = useCallback(
    (query: string) => {
      patchScope('local', { query });
    },
    [patchScope]
  );

  const setResults = useCallback(
    (results: KaraokeMediaTrack[] | ((prev: KaraokeMediaTrack[]) => KaraokeMediaTrack[])) => {
      const scope = searchModeRef.current;
      setScopes((prev) => {
        const nextResults = typeof results === 'function' ? results(prev[scope].results) : results;
        return { ...prev, [scope]: { ...prev[scope], results: nextResults } };
      });
    },
    []
  );

  const setLocalResults = useCallback(
    (results: KaraokeMediaTrack[] | ((prev: KaraokeMediaTrack[]) => KaraokeMediaTrack[])) => {
      setScopes((prev) => {
        const nextResults = typeof results === 'function' ? results(prev.local.results) : results;
        return { ...prev, local: { ...prev.local, results: nextResults } };
      });
    },
    []
  );

  const setWebResults = useCallback(
    (results: KaraokeMediaTrack[] | ((prev: KaraokeMediaTrack[]) => KaraokeMediaTrack[])) => {
      setScopes((prev) => {
        const nextResults = typeof results === 'function' ? results(prev.web.results) : results;
        return { ...prev, web: { ...prev.web, results: nextResults } };
      });
    },
    []
  );

  /** Patch a track in both scopes (e.g. after download completes). */
  const patchTrackInAllResults = useCallback(
    (matchId: string, matchUri: string, patch: Partial<KaraokeMediaTrack>) => {
      const mapTrack = (track: KaraokeMediaTrack) =>
        track.id === matchId || track.uri === matchUri ? { ...track, ...patch } : track;
      setScopes((prev) => ({
        local: { ...prev.local, results: prev.local.results.map(mapTrack) },
        web: { ...prev.web, results: prev.web.results.map(mapTrack) }
      }));
    },
    []
  );

  /**
   * After library delete: restore matching web (and local-scoped) rows that were
   * patched to local_library so Download / Download Instrumental reappear.
   */
  const revertLibraryMembershipInResults = useCallback((deleted: DeletedLibraryIdentity) => {
    setScopes((prev) => {
      const nextLocal = revertLibraryMembershipInTrackList(prev.local.results, deleted);
      const nextWeb = revertLibraryMembershipInTrackList(prev.web.results, deleted);
      if (nextLocal === prev.local.results && nextWeb === prev.web.results) return prev;
      return {
        local: { ...prev.local, results: nextLocal },
        web: { ...prev.web, results: nextWeb }
      };
    });
  }, []);

  const setIsSearching = useCallback(
    (isSearching: boolean) => {
      patchScope(searchModeRef.current, { isSearching });
    },
    [patchScope]
  );

  const setLocalSearching = useCallback(
    (isSearching: boolean) => {
      patchScope('local', { isSearching });
    },
    [patchScope]
  );

  const setWebSearching = useCallback(
    (isSearching: boolean) => {
      patchScope('web', { isSearching });
    },
    [patchScope]
  );

  /** Switch tab: snapshot scroll, swap mode — never clears the other scope or fires search. */
  const setSearchMode = useCallback((next: LibrarySearchScope) => {
    const current = searchModeRef.current;
    if (next === current) return;
    const scrollTop = listRef.current?.scrollTop ?? 0;
    setScopes((prev) => ({
      ...prev,
      [current]: { ...prev[current], scrollTop }
    }));
    setSearchModeState(next);
  }, []);

  const onListScroll = useCallback(() => {
    const scrollTop = listRef.current?.scrollTop ?? 0;
    const mode = searchModeRef.current;
    setScopes((prev) => {
      if (prev[mode].scrollTop === scrollTop) return prev;
      return { ...prev, [mode]: { ...prev[mode], scrollTop } };
    });
  }, []);

  return {
    searchMode,
    setSearchMode,
    query: active.query,
    setQuery,
    setLocalQuery,
    results: active.results,
    setResults,
    localQuery: scopes.local.query,
    localResults: scopes.local.results,
    setLocalResults,
    setLocalSearching,
    webQuery: scopes.web.query,
    webResults: scopes.web.results,
    setWebResults,
    setWebSearching,
    isSearching: active.isSearching,
    setIsSearching,
    patchTrackInAllResults,
    revertLibraryMembershipInResults,
    listRef,
    onListScroll,
    scopes
  };
}

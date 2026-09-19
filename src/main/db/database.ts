import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { KaraokeMediaTrack, SingerProfile, SqlQueryResult } from '../../shared/types';
import { normalizeForSearch } from '../../shared/textNormalize';

/**
 * SQLite Database Manager utilizing better-sqlite3 with Write-Ahead Logging (WAL).
 * Manages persistent storage for the media catalog, singer profiles & pitch preferences,
 * and copyright (SIAE) execution logs.
 */
export class DatabaseManager {
  private db: Database.Database;
  /** Prepared once — reused by upsertTrack / upsertTracksBatch. */
  private upsertTrackStmt: Database.Statement | null = null;
  private deleteByPathExceptStmt: Database.Statement | null = null;

  /**
   * Initializes the SQLite database connection and sets PRAGMA modes.
   *
   * @param storagePath - Directory path where karaoke_station.db will be saved
   */
  constructor(storagePath: string) {
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
    const dbFilePath = path.join(storagePath, 'karaoke_station.db');
    this.db = new Database(dbFilePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // Accent-insensitive SQL search: fold both query and stored title/artist.
    this.db.function('fold_diacritics', (value: unknown) =>
      normalizeForSearch(value == null ? '' : String(value))
    );
    this.initSchema();
    this.prepareTrackStatements();
  }

  /**
   * Prepares track upsert/delete statements once (avoids re-prepare × N on library scan).
   */
  private prepareTrackStatements(): void {
    this.upsertTrackStmt = this.db.prepare(`
      INSERT INTO tracks (id, source, title, artist, durationSec, uri, localFilePath, thumbnailUrl, hasEmbeddedLyrics, isMultiplex, isEmbeddable, initialKey, initialBpm, addedAt, titleNorm, artistNorm)
      VALUES (@id, @source, @title, @artist, @durationSec, @uri, @localFilePath, @thumbnailUrl, @hasEmbeddedLyrics, @isMultiplex, @isEmbeddable, @initialKey, @initialBpm, @addedAt, @titleNorm, @artistNorm)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        title = excluded.title,
        artist = excluded.artist,
        durationSec = excluded.durationSec,
        uri = excluded.uri,
        localFilePath = excluded.localFilePath,
        thumbnailUrl = excluded.thumbnailUrl,
        hasEmbeddedLyrics = excluded.hasEmbeddedLyrics,
        isMultiplex = excluded.isMultiplex,
        isEmbeddable = excluded.isEmbeddable,
        initialKey = COALESCE(excluded.initialKey, tracks.initialKey),
        initialBpm = COALESCE(excluded.initialBpm, tracks.initialBpm),
        titleNorm = excluded.titleNorm,
        artistNorm = excluded.artistNorm
    `);
    this.deleteByPathExceptStmt = this.db.prepare(
      `DELETE FROM tracks WHERE localFilePath = ? AND id != ?`
    );
  }

  /** Bound params for the cached upsert statement. */
  private trackUpsertParams(track: KaraokeMediaTrack): Record<string, unknown> {
    return {
      id: track.id,
      source: track.source,
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec,
      uri: track.uri,
      localFilePath: track.localFilePath ?? null,
      thumbnailUrl: track.thumbnailUrl ?? null,
      hasEmbeddedLyrics: track.hasEmbeddedLyrics ? 1 : 0,
      isMultiplex: track.isMultiplex ? 1 : 0,
      isEmbeddable: track.isEmbeddable ? 1 : 0,
      initialKey: track.initialKey ?? null,
      initialBpm: track.initialBpm ?? null,
      addedAt: Date.now(),
      // Precomputed accent-folded fields — search uses these instead of per-row JS UDF.
      titleNorm: normalizeForSearch(track.title),
      artistNorm: normalizeForSearch(track.artist)
    };
  }

  /**
   * Runs one upsert + optional path-dedupe delete (statements must already be prepared).
   */
  private runUpsertTrack(track: KaraokeMediaTrack): void {
    if (!this.upsertTrackStmt || !this.deleteByPathExceptStmt) {
      this.prepareTrackStatements();
    }
    this.upsertTrackStmt!.run(this.trackUpsertParams(track));
    if (track.localFilePath) {
      this.deleteByPathExceptStmt!.run(track.localFilePath, track.id);
    }
  }

  /**
   * Initializes the SQLite tables and indices if they do not already exist.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        durationSec REAL NOT NULL,
        uri TEXT NOT NULL,
        localFilePath TEXT,
        thumbnailUrl TEXT,
        hasEmbeddedLyrics INTEGER DEFAULT 0,
        isMultiplex INTEGER DEFAULT 0,
        isEmbeddable INTEGER DEFAULT 1,
        initialKey TEXT,
        initialBpm REAL,
        addedAt INTEGER NOT NULL,
        titleNorm TEXT,
        artistNorm TEXT
      );

      CREATE TABLE IF NOT EXISTS singers (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        preferredPitchOffset INTEGER DEFAULT 0,
        songsSungCount INTEGER DEFAULT 0,
        isPermanentFavorite INTEGER DEFAULT 0,
        createdAt INTEGER NOT NULL,
        lastSungAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS siae_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trackTitle TEXT NOT NULL,
        trackArtist TEXT NOT NULL,
        singerName TEXT,
        executedAt INTEGER NOT NULL,
        durationSec REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_search ON tracks(title, artist);
      CREATE INDEX IF NOT EXISTS idx_singers_name ON singers(name);
      CREATE INDEX IF NOT EXISTS idx_tracks_local_path ON tracks(localFilePath);
      CREATE INDEX IF NOT EXISTS idx_siae_executed_at ON siae_logs(executedAt);
    `);

    // Clean up any historical case-insensitive duplicate singers and enforce unique index
    try {
      this.db.exec(`
        DELETE FROM singers WHERE id NOT IN (
          SELECT id FROM singers GROUP BY LOWER(TRIM(name))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_singers_name_nocase ON singers(LOWER(TRIM(name)));
      `);
    } catch (err) {
      console.warn('Singer deduplication or unique index setup notice:', err);
    }

    // Safely migrate existing tables that might lack the thumbnailUrl column
    try {
      this.db.exec('ALTER TABLE tracks ADD COLUMN thumbnailUrl TEXT;');
    } catch {
      // Column already exists
    }
    // Key / BPM catalog columns (nullable — analysis is async / best-effort)
    try {
      this.db.exec('ALTER TABLE tracks ADD COLUMN initialKey TEXT;');
    } catch {
      // Column already exists
    }
    try {
      this.db.exec('ALTER TABLE tracks ADD COLUMN initialBpm REAL;');
    } catch {
      // Column already exists
    }
    // Accent-folded search columns (avoids fold_diacritics UDF full-table scan)
    try {
      this.db.exec('ALTER TABLE tracks ADD COLUMN titleNorm TEXT;');
    } catch {
      // Column already exists
    }
    try {
      this.db.exec('ALTER TABLE tracks ADD COLUMN artistNorm TEXT;');
    } catch {
      // Column already exists
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tracks_title_norm ON tracks(titleNorm);
      CREATE INDEX IF NOT EXISTS idx_tracks_artist_norm ON tracks(artistNorm);
    `);
    this.backfillNormalizedSearchColumns();
  }

  /**
   * One-shot backfill for titleNorm/artistNorm on upgraded DBs.
   * Idempotent: only rows where either norm is NULL/empty are rewritten.
   */
  private backfillNormalizedSearchColumns(): void {
    try {
      const missing = this.db
        .prepare(
          `SELECT id, title, artist FROM tracks
           WHERE titleNorm IS NULL OR titleNorm = '' OR artistNorm IS NULL OR artistNorm = ''`
        )
        .all() as Array<{ id: string; title: string; artist: string }>;
      if (!missing.length) return;
      const upd = this.db.prepare(
        `UPDATE tracks SET titleNorm = ?, artistNorm = ? WHERE id = ?`
      );
      const run = this.db.transaction((rows: Array<{ id: string; title: string; artist: string }>) => {
        for (const r of rows) {
          upd.run(normalizeForSearch(r.title), normalizeForSearch(r.artist), r.id);
        }
      });
      run(missing);
    } catch (err) {
      console.warn('Normalized search column backfill notice:', err);
    }
  }

  /** Map a SQLite tracks row to KaraokeMediaTrack (shared by all readers). */
  private mapTrackRow(r: {
    id: string;
    source: string;
    title: string;
    artist: string;
    durationSec: number;
    uri: string;
    localFilePath: string | null;
    thumbnailUrl: string | null;
    hasEmbeddedLyrics: number;
    isMultiplex: number;
    isEmbeddable: number;
    initialKey?: string | null;
    initialBpm?: number | null;
  }): KaraokeMediaTrack {
    return {
      id: r.id,
      source: r.source as KaraokeMediaTrack['source'],
      title: r.title,
      artist: r.artist,
      durationSec: r.durationSec,
      uri: r.uri,
      localFilePath: r.localFilePath ?? undefined,
      thumbnailUrl: r.thumbnailUrl ?? undefined,
      hasEmbeddedLyrics: Boolean(r.hasEmbeddedLyrics),
      isMultiplex: Boolean(r.isMultiplex),
      isEmbeddable: Boolean(r.isEmbeddable),
      initialKey: r.initialKey ?? undefined,
      initialBpm: r.initialBpm != null ? Number(r.initialBpm) : undefined
    };
  }

  /**
   * Retrieves all catalog tracks ordered by artist and song title.
   */
  public getAllTracks(): KaraokeMediaTrack[] {
    const stmt = this.db.prepare('SELECT * FROM tracks ORDER BY artist ASC, title ASC');
    const rows = stmt.all() as Array<{
      id: string;
      source: string;
      title: string;
      artist: string;
      durationSec: number;
      uri: string;
      localFilePath: string | null;
      thumbnailUrl: string | null;
      hasEmbeddedLyrics: number;
      isMultiplex: number;
      isEmbeddable: number;
      initialKey: string | null;
      initialBpm: number | null;
    }>;

    const mapped = rows.map((r) => this.mapTrackRow(r));
    return this.dedupeTracksByIdentity(mapped);
  }

  /**
   * One logical media file => one row. Prefer stable YouTube ids over path-hash ids.
   */
  private dedupeTracksByIdentity(tracks: KaraokeMediaTrack[]): KaraokeMediaTrack[] {
    const score = (t: KaraokeMediaTrack) => {
      const yt = /^[\w-]{11}$/.test(t.id) ? 2 : t.id.startsWith('track_') ? 0 : 1;
      const local = t.source === 'local_library' ? 1 : 0;
      return yt * 10 + local;
    };
    const byPath = new Map<string, KaraokeMediaTrack>();
    const noPath: KaraokeMediaTrack[] = [];
    for (const t of tracks) {
      const key = t.localFilePath ? t.localFilePath.toLowerCase() : '';
      if (!key) {
        noPath.push(t);
        continue;
      }
      const prev = byPath.get(key);
      if (!prev || score(t) > score(prev)) byPath.set(key, t);
    }
    const byId = new Map<string, KaraokeMediaTrack>();
    for (const t of [...byPath.values(), ...noPath]) {
      const prev = byId.get(t.id);
      if (!prev || score(t) >= score(prev)) byId.set(t.id, t);
    }
    return Array.from(byId.values()).sort((a, b) => {
      const aa = `${a.artist}\0${a.title}`.toLowerCase();
      const bb = `${b.artist}\0${b.title}`.toLowerCase();
      return aa.localeCompare(bb);
    });
  }

  /**
   * Parameterized title/artist search with LIMIT — avoids shipping the full catalog
   * across IPC when the operator types into the library filter on large libraries.
   * Uses precomputed titleNorm/artistNorm (same folding as normalizeForSearch) so
   * SQLite does not invoke the JS fold_diacritics UDF on every row.
   */
  public searchTracks(query: string, limit = 200): KaraokeMediaTrack[] {
    const capped = Math.max(1, Math.min(2000, limit));
    const q = normalizeForSearch(query || '').trim();
    if (!q) {
      // Empty query: LIMIT in SQL — never materialize the full 10k–50k catalog.
      const rows = this.db
        .prepare('SELECT * FROM tracks ORDER BY artist ASC, title ASC LIMIT ?')
        .all(capped) as Array<{
        id: string;
        source: string;
        title: string;
        artist: string;
        durationSec: number;
        uri: string;
        localFilePath: string | null;
        thumbnailUrl: string | null;
        hasEmbeddedLyrics: number;
        isMultiplex: number;
        isEmbeddable: number;
        initialKey: string | null;
        initialBpm: number | null;
      }>;
      return rows.map((r) => this.mapTrackRow(r));
    }
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const stmt = this.db.prepare(
      `SELECT * FROM tracks
       WHERE titleNorm LIKE ? OR artistNorm LIKE ?
       ORDER BY artist ASC, title ASC
       LIMIT ?`
    );
    const rows = stmt.all(like, like, capped) as Array<{
      id: string;
      source: string;
      title: string;
      artist: string;
      durationSec: number;
      uri: string;
      localFilePath: string | null;
      thumbnailUrl: string | null;
      hasEmbeddedLyrics: number;
      isMultiplex: number;
      isEmbeddable: number;
      initialKey: string | null;
      initialBpm: number | null;
    }>;
    return rows.map((r) => this.mapTrackRow(r));
  }

  /**
   * Fetch catalog rows for a small set of absolute local paths (case-insensitive).
   * Why: import/drop must reuse thumbs/key/BPM without dumping getAllTracks() for 50k rows.
   * Chunks IN-lists to stay under SQLite variable limits.
   */
  public getTracksByLocalPaths(localPaths: string[]): KaraokeMediaTrack[] {
    const unique = new Map<string, string>();
    for (const raw of localPaths || []) {
      const trimmed = (raw || '').trim();
      if (!trimmed) continue;
      unique.set(trimmed.toLowerCase(), trimmed);
    }
    if (!unique.size) return [];

    const keys = Array.from(unique.keys());
    const out: KaraokeMediaTrack[] = [];
    const chunkSize = 400;
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(
          `SELECT * FROM tracks WHERE lower(localFilePath) IN (${placeholders})`
        )
        .all(...chunk) as Array<{
        id: string;
        source: string;
        title: string;
        artist: string;
        durationSec: number;
        uri: string;
        localFilePath: string | null;
        thumbnailUrl: string | null;
        hasEmbeddedLyrics: number;
        isMultiplex: number;
        isEmbeddable: number;
        initialKey: string | null;
        initialBpm: number | null;
      }>;
      for (const r of rows) out.push(this.mapTrackRow(r));
    }
    return out;
  }

  /**
   * Tracks that still need a video thumbnail (targeted — no full-catalog dump).
   */
  public getTracksMissingThumbnails(): KaraokeMediaTrack[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tracks
         WHERE (thumbnailUrl IS NULL OR thumbnailUrl = '')
           AND localFilePath IS NOT NULL
           AND localFilePath != ''
           AND (source = 'local_library' OR source = 'youtube')`
      )
      .all() as Array<{
      id: string;
      source: string;
      title: string;
      artist: string;
      durationSec: number;
      uri: string;
      localFilePath: string | null;
      thumbnailUrl: string | null;
      hasEmbeddedLyrics: number;
      isMultiplex: number;
      isEmbeddable: number;
      initialKey: string | null;
      initialBpm: number | null;
    }>;
    return rows.map((r) => this.mapTrackRow(r));
  }

  /**
   * Inserts or updates a track in the library database.
   *
   * @param track - The track payload to persist
   */
  public upsertTrack(track: KaraokeMediaTrack): void {
    this.runUpsertTrack(track);
  }

  /**
   * Batch upsert inside a single SQLite transaction (one prepare, one commit).
   * Used by library scan and OS drag-drop import so ~N tracks do not each auto-commit.
   * Still runs path-dedupe delete per track (anti-ghost) inside the same transaction.
   *
   * @param tracks - Tracks to insert/update (order preserved for callers)
   */
  public upsertTracksBatch(tracks: KaraokeMediaTrack[]): void {
    if (!tracks.length) return;
    if (!this.upsertTrackStmt || !this.deleteByPathExceptStmt) {
      this.prepareTrackStatements();
    }
    const runBatch = this.db.transaction((items: KaraokeMediaTrack[]) => {
      for (const track of items) {
        this.runUpsertTrack(track);
      }
    });
    runBatch(tracks);
  }

  /**
   * Deletes catalog rows that share a local file path but not the kept id.
   * Prevents ghost duplicates when a YouTube id row and a path-hash row point at the same file.
   */
  public deleteTracksByLocalPathExcept(localFilePath: string, keepId: string): number {
    if (!localFilePath) return 0;
    if (!this.deleteByPathExceptStmt) {
      this.prepareTrackStatements();
    }
    const result = this.deleteByPathExceptStmt!.run(localFilePath, keepId);
    return Number(result.changes || 0);
  }

  /** Returns one catalog track by id, or null if missing. */
  public getTrackById(id: string): KaraokeMediaTrack | null {
    const row = this.db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as
      | {
          id: string;
          source: string;
          title: string;
          artist: string;
          durationSec: number;
          uri: string;
          localFilePath: string | null;
          thumbnailUrl: string | null;
          hasEmbeddedLyrics: number;
          isMultiplex: number;
          isEmbeddable: number;
          initialKey: string | null;
          initialBpm: number | null;
        }
      | undefined;
    if (!row) return null;
    return this.mapTrackRow(row);
  }

  /**
   * Persist async key/BPM analysis without clobbering other track fields.
   * Why: analysis must not race a full upsert from a concurrent library scan.
   */
  public updateTrackKeyBpm(
    trackId: string,
    initialKey?: string,
    initialBpm?: number
  ): void {
    if (!trackId) return;
    this.db
      .prepare(
        `UPDATE tracks SET
          initialKey = COALESCE(?, initialKey),
          initialBpm = COALESCE(?, initialBpm)
         WHERE id = ?`
      )
      .run(initialKey ?? null, initialBpm ?? null, trackId);
  }

  /** Deletes a single track by primary key. */
  public deleteTrackById(id: string): void {
    this.db.prepare(`DELETE FROM tracks WHERE id = ?`).run(id);
  }

  /**
   * Retrieves an existing singer by case-insensitive name, or registers a new performer.
   *
   * @param name - Singer display name
   * @returns The existing or newly created SingerProfile
   */
  public getOrCreateSinger(name: string): SingerProfile {
    const normalizedName = name.trim();
    const selectStmt = this.db.prepare('SELECT * FROM singers WHERE LOWER(TRIM(name)) = LOWER(?)');
    const existing = selectStmt.get(normalizedName) as {
      id: string;
      name: string;
      preferredPitchOffset: number;
      songsSungCount: number;
      isPermanentFavorite: number;
      createdAt: number;
      lastSungAt: number | null;
    } | undefined;

    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        preferredPitchOffset: existing.preferredPitchOffset,
        songsSungCount: existing.songsSungCount,
        isPermanentFavorite: Boolean(existing.isPermanentFavorite),
        createdAt: existing.createdAt,
        lastSungAt: existing.lastSungAt ?? undefined
      };
    }

    const newId = `singer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    const insertStmt = this.db.prepare(`
      INSERT INTO singers (id, name, preferredPitchOffset, songsSungCount, isPermanentFavorite, createdAt, lastSungAt)
      VALUES (?, ?, 0, 0, 0, ?, NULL)
    `);
    insertStmt.run(newId, normalizedName, now);

    return {
      id: newId,
      name: normalizedName,
      preferredPitchOffset: 0,
      songsSungCount: 0,
      isPermanentFavorite: false,
      createdAt: now
    };
  }

  /**
   * Updates a singer's remembered pitch preference in semitones.
   */
  public updateSingerPitch(singerId: string, pitchOffset: number): void {
    const stmt = this.db.prepare('UPDATE singers SET preferredPitchOffset = ? WHERE id = ?');
    stmt.run(pitchOffset, singerId);
  }

  /**
   * Increments the count of completed performances for a singer and updates lastSungAt.
   */
  public incrementSingerSongCount(singerId: string): void {
    const stmt = this.db.prepare('UPDATE singers SET songsSungCount = songsSungCount + 1, lastSungAt = ? WHERE id = ?');
    stmt.run(Date.now(), singerId);
  }

  /**
   * Retrieves all registered singers, ordered by favorite status, song count, and name.
   */
  public getAllSingers(): SingerProfile[] {
    const stmt = this.db.prepare('SELECT * FROM singers ORDER BY isPermanentFavorite DESC, songsSungCount DESC, name ASC');
    const rows = stmt.all() as Array<{
      id: string;
      name: string;
      preferredPitchOffset: number;
      songsSungCount: number;
      isPermanentFavorite: number;
      createdAt: number;
      lastSungAt: number | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      preferredPitchOffset: r.preferredPitchOffset,
      songsSungCount: r.songsSungCount,
      isPermanentFavorite: Boolean(r.isPermanentFavorite),
      createdAt: r.createdAt,
      lastSungAt: r.lastSungAt ?? undefined
    }));
  }

  /**
   * Toggles the permanent favorite status of a singer.
   */
  public setSingerPermanentFavorite(singerId: string, isPermanent: boolean): void {
    const stmt = this.db.prepare('UPDATE singers SET isPermanentFavorite = ? WHERE id = ?');
    stmt.run(isPermanent ? 1 : 0, singerId);
  }

  /**
   * Permanently removes a singer from the database roster.
   */
  public deleteSinger(singerId: string): void {
    const stmt = this.db.prepare('DELETE FROM singers WHERE id = ?');
    stmt.run(singerId);
  }

  /**
   * Logs an executed song for copyright reporting (SIAE Borderò).
   */
  public logSiaePerformance(
    trackTitle: string,
    trackArtist: string,
    singerName: string | undefined,
    durationSec: number,
    executedAt?: number | string
  ): void {
    let timestampMs: number;
    if (typeof executedAt === 'number') {
      timestampMs = executedAt;
    } else if (typeof executedAt === 'string') {
      const parsed = new Date(executedAt).getTime();
      timestampMs = isNaN(parsed) ? Date.now() : parsed;
    } else {
      timestampMs = Date.now();
    }

    const stmt = this.db.prepare(`
      INSERT INTO siae_logs (trackTitle, trackArtist, singerName, executedAt, durationSec)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(trackTitle, trackArtist, singerName ?? null, timestampMs, durationSec);
  }

  /**
   * Retrieves all historical SIAE execution logs in reverse chronological order,
   * enriched with precise ISO 8601 formatted timestamp metadata.
   */
  public getSiaeLogs(): Array<{
    id: number;
    trackTitle: string;
    trackArtist: string;
    singerName: string | null;
    executedAt: number;
    executedAtIso: string;
    durationSec: number;
  }> {
    const stmt = this.db.prepare('SELECT * FROM siae_logs ORDER BY executedAt DESC');
    const rows = stmt.all() as Array<{
      id: number;
      trackTitle: string;
      trackArtist: string;
      singerName: string | null;
      executedAt: number;
      durationSec: number;
    }>;

    return rows.map((row) => ({
      ...row,
      executedAtIso: new Date(row.executedAt).toISOString()
    }));
  }

  /**
   * Clears all recorded SIAE execution logs from the persistent SQLite database.
   * This empties the execution history table until new tracks are played.
   */
  public clearSiaeLogs(): void {
    this.db.prepare('DELETE FROM siae_logs').run();
  }

  /**
   * Executes a read-only SQL query returning an array of typed records.
   */
  public query<T>(sql: string, params: unknown[] = []): SqlQueryResult<T[]> {
    try {
      const stmt = this.db.prepare(sql);
      const data = stmt.all(...params) as T[];
      return { success: true, data };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Executes an INSERT, UPDATE, or DELETE SQL statement.
   */
  public run(sql: string, params: unknown[] = []): SqlQueryResult {
    try {
      const stmt = this.db.prepare(sql);
      const info = stmt.run(...params);
      return { success: true, rowsAffected: info.changes };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Safely closes the SQLite database connection.
   */
  public close(): void {
    this.db.close();
  }
}

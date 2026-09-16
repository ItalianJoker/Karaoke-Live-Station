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
        addedAt INTEGER NOT NULL
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
    }>;

    const mapped = rows.map((r) => ({
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
      isEmbeddable: Boolean(r.isEmbeddable)
    }));
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
   * Uses bound LIKE params (no string concat) and the composite title/artist index.
   */
  public searchTracks(query: string, limit = 200): KaraokeMediaTrack[] {
    const q = normalizeForSearch(query || '').trim();
    if (!q) {
      return this.getAllTracks().slice(0, Math.max(1, limit));
    }
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const stmt = this.db.prepare(
      `SELECT * FROM tracks
       WHERE fold_diacritics(title) LIKE ? OR fold_diacritics(artist) LIKE ?
       ORDER BY artist ASC, title ASC
       LIMIT ?`
    );
    const rows = stmt.all(like, like, Math.max(1, Math.min(2000, limit))) as Array<{
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
    }>;
    return rows.map((r) => ({
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
      isEmbeddable: Boolean(r.isEmbeddable)
    }));
  }

  /**
   * Inserts or updates a track in the library database.
   *
   * @param track - The track payload to persist
   */
  public upsertTrack(track: KaraokeMediaTrack): void {
    const stmt = this.db.prepare(`
      INSERT INTO tracks (id, source, title, artist, durationSec, uri, localFilePath, thumbnailUrl, hasEmbeddedLyrics, isMultiplex, isEmbeddable, addedAt)
      VALUES (@id, @source, @title, @artist, @durationSec, @uri, @localFilePath, @thumbnailUrl, @hasEmbeddedLyrics, @isMultiplex, @isEmbeddable, @addedAt)
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
        isEmbeddable = excluded.isEmbeddable
    `);

    stmt.run({
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
      addedAt: Date.now()
    });
    if (track.localFilePath) {
      this.deleteTracksByLocalPathExcept(track.localFilePath, track.id);
    }
  }

  /**
   * Deletes catalog rows that share a local file path but not the kept id.
   * Prevents ghost duplicates when a YouTube id row and a path-hash row point at the same file.
   */
  public deleteTracksByLocalPathExcept(localFilePath: string, keepId: string): number {
    if (!localFilePath) return 0;
    const stmt = this.db.prepare(
      `DELETE FROM tracks WHERE localFilePath = ? AND id != ?`
    );
    const result = stmt.run(localFilePath, keepId);
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
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      source: row.source as KaraokeMediaTrack['source'],
      title: row.title,
      artist: row.artist,
      durationSec: row.durationSec,
      uri: row.uri,
      localFilePath: row.localFilePath ?? undefined,
      thumbnailUrl: row.thumbnailUrl ?? undefined,
      hasEmbeddedLyrics: Boolean(row.hasEmbeddedLyrics),
      isMultiplex: Boolean(row.isMultiplex),
      isEmbeddable: Boolean(row.isEmbeddable)
    };
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

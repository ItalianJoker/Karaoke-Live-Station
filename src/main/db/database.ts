import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { KaraokeMediaTrack, SingerProfile, SqlQueryResult } from '../../shared/types';

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
  public logSiaePerformance(trackTitle: string, trackArtist: string, singerName: string | undefined, durationSec: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO siae_logs (trackTitle, trackArtist, singerName, executedAt, durationSec)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(trackTitle, trackArtist, singerName ?? null, Date.now(), durationSec);
  }

  /**
   * Retrieves all historical SIAE execution logs in reverse chronological order.
   */
  public getSiaeLogs(): Array<{ id: number; trackTitle: string; trackArtist: string; singerName: string | null; executedAt: number; durationSec: number }> {
    const stmt = this.db.prepare('SELECT * FROM siae_logs ORDER BY executedAt DESC');
    return stmt.all() as Array<{
      id: number;
      trackTitle: string;
      trackArtist: string;
      singerName: string | null;
      executedAt: number;
      durationSec: number;
    }>;
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

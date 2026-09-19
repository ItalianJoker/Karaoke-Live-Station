#!/usr/bin/env node
/**
 * Large-library / DnD performance micro-benchmarks (25k tracks).
 *
 * Measures the hot paths called out in the large-library DnD perf plan:
 *   1) Accent search: fold_diacritics (JS UDF per row) vs normalized column + index
 *   2) Path existence: full getAllTracks dump vs WHERE IN / indexed lookup
 *   3) Renderer-style dedup: O(N×M) filter vs Set
 *
 * Also reports analysis-queue membership and empty-query search cost for context.
 * Run: node scripts/benchmark-large-library.js
 * Exit 0 always (informational); prints JSON summary + human table.
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const N = 25_000;
const IMPORT_PATHS = 50;
const DEDUP_IMPORT = 500;
const SEARCH_LIMIT = 200;
const WARMUP = 2;
const ITERS = 5;

/** Mirrors src/shared/textNormalize.ts normalizeForSearch */
function normalizeForSearch(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function hrNow() {
  return process.hrtime.bigint();
}

function msSince(start) {
  return Number(hrNow() - start) / 1e6;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function measure(label, fn, { warmup = WARMUP, iters = ITERS } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  let lastResult;
  for (let i = 0; i < iters; i++) {
    const t0 = hrNow();
    lastResult = fn();
    samples.push(msSince(t0));
  }
  return {
    label,
    medianMs: median(samples),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    samples,
    resultHint: lastResult
  };
}

function seedSchema(db, { withNormalized = false } = {}) {
  db.exec(`
    CREATE TABLE tracks (
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
      addedAt INTEGER NOT NULL
      ${withNormalized ? ', titleNorm TEXT, artistNorm TEXT' : ''}
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_search ON tracks(title, artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_local_path ON tracks(localFilePath);
  `);
  if (withNormalized) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tracks_title_norm ON tracks(titleNorm);
      CREATE INDEX IF NOT EXISTS idx_tracks_artist_norm ON tracks(artistNorm);
    `);
  }
}

function insertTracks(db, count, { withNormalized = false } = {}) {
  const artists = [
    'Vasco Rossi',
    'Laura Pausini',
    'Lucio Battisti',
    'Mina',
    'Eros Ramazzotti',
    'Zucchero',
    'Giorgia',
    'Tiziano Ferro',
    'Jovanotti',
    'Andrea Bocelli'
  ];
  const titleWords = [
    'Amore',
    'Vita',
    'Notte',
    'Sole',
    'Cuore',
    'Sogno',
    'Mare',
    'Cielo',
    'Fuoco',
    'Stella',
    'Morirò',
    'Perché',
    'Caffè',
    'Città',
    'Canción'
  ];

  const insert = withNormalized
    ? db.prepare(`
        INSERT INTO tracks (
          id, source, title, artist, durationSec, uri, localFilePath,
          thumbnailUrl, hasEmbeddedLyrics, isMultiplex, isEmbeddable,
          initialKey, initialBpm, addedAt, titleNorm, artistNorm
        ) VALUES (
          @id, @source, @title, @artist, @durationSec, @uri, @localFilePath,
          NULL, 0, 0, 1, NULL, NULL, @addedAt, @titleNorm, @artistNorm
        )
      `)
    : db.prepare(`
        INSERT INTO tracks (
          id, source, title, artist, durationSec, uri, localFilePath,
          thumbnailUrl, hasEmbeddedLyrics, isMultiplex, isEmbeddable,
          initialKey, initialBpm, addedAt
        ) VALUES (
          @id, @source, @title, @artist, @durationSec, @uri, @localFilePath,
          NULL, 0, 0, 1, NULL, NULL, @addedAt
        )
      `);

  const tx = db.transaction((n) => {
    for (let i = 0; i < n; i++) {
      const artist = artists[i % artists.length];
      const title = `${titleWords[i % titleWords.length]} ${titleWords[(i * 7) % titleWords.length]} ${i}`;
      const localFilePath = `/library/Artist_${i % 200}/Song_${i}.mp4`;
      const row = {
        id: `track_${i}`,
        source: 'local_library',
        title,
        artist,
        durationSec: 180 + (i % 120),
        uri: `karaoke://local/${encodeURIComponent(localFilePath)}`,
        localFilePath,
        addedAt: Date.now() - i * 1000
      };
      if (withNormalized) {
        row.titleNorm = normalizeForSearch(title);
        row.artistNorm = normalizeForSearch(artist);
      }
      insert.run(row);
    }
  });
  tx(count);
}

function mapTrackRow(r) {
  return {
    id: r.id,
    source: r.source,
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

/** Baseline: mirrors DatabaseManager.searchTracks with fold_diacritics UDF */
function searchFold(db, query, limit = SEARCH_LIMIT) {
  const q = normalizeForSearch(query || '').trim();
  if (!q) {
    return db
      .prepare('SELECT * FROM tracks ORDER BY artist ASC, title ASC LIMIT ?')
      .all(Math.max(1, limit))
      .map(mapTrackRow);
  }
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return db
    .prepare(
      `SELECT * FROM tracks
       WHERE fold_diacritics(title) LIKE ? OR fold_diacritics(artist) LIKE ?
       ORDER BY artist ASC, title ASC
       LIMIT ?`
    )
    .all(like, like, Math.max(1, Math.min(2000, limit)))
    .map(mapTrackRow);
}

/** Optimized: normalized columns + LIKE (index-friendly prefix still limited by leading %) */
function searchNormalized(db, query, limit = SEARCH_LIMIT) {
  const q = normalizeForSearch(query || '').trim();
  if (!q) {
    return db
      .prepare('SELECT * FROM tracks ORDER BY artist ASC, title ASC LIMIT ?')
      .all(Math.max(1, limit))
      .map(mapTrackRow);
  }
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return db
    .prepare(
      `SELECT * FROM tracks
       WHERE titleNorm LIKE ? OR artistNorm LIKE ?
       ORDER BY artist ASC, title ASC
       LIMIT ?`
    )
    .all(like, like, Math.max(1, Math.min(2000, limit)))
    .map(mapTrackRow);
}

function getAllTracksMapped(db) {
  return db
    .prepare('SELECT * FROM tracks ORDER BY artist ASC, title ASC')
    .all()
    .map(mapTrackRow);
}

function getTracksByLocalPaths(db, paths) {
  if (!paths.length) return [];
  const placeholders = paths.map(() => '?').join(',');
  // Match importFiles case-insensitive path lookup
  const lowered = paths.map((p) => p.toLowerCase());
  const rows = db
    .prepare(
      `SELECT * FROM tracks WHERE lower(localFilePath) IN (${placeholders})`
    )
    .all(...lowered);
  return rows.map(mapTrackRow);
}

function dedupeNxM(prev, imported) {
  return prev.filter(
    (t) =>
      !imported.some(
        (n) =>
          n.id === t.id ||
          (n.localFilePath && t.localFilePath && n.localFilePath === t.localFilePath) ||
          n.uri === t.uri
      )
  );
}

function dedupeSet(prev, imported) {
  const ids = new Set();
  const paths = new Set();
  const uris = new Set();
  for (const n of imported) {
    ids.add(n.id);
    if (n.localFilePath) paths.add(n.localFilePath);
    if (n.uri) uris.add(n.uri);
  }
  return prev.filter(
    (t) =>
      !ids.has(t.id) &&
      !(t.localFilePath && paths.has(t.localFilePath)) &&
      !(t.uri && uris.has(t.uri))
  );
}

function enqueueLinear(queue, trackId) {
  if (queue.some((j) => j.trackId === trackId)) return false;
  queue.push({ trackId });
  return true;
}

function enqueueSet(queue, queuedIds, trackId) {
  if (queuedIds.has(trackId)) return false;
  queuedIds.add(trackId);
  queue.push({ trackId });
  return true;
}

function main() {
  const phase = process.env.BENCH_PHASE || 'baseline';
  console.log(`\n=== Large library DnD benchmark (${phase}) ===`);
  console.log(`N=${N}, importPaths=${IMPORT_PATHS}, dedupImport=${DEDUP_IMPORT}, iters=${ITERS}\n`);

  // --- DB A: fold_diacritics path (current production shape) ---
  const dbFold = new Database(':memory:');
  dbFold.function('fold_diacritics', (value) =>
    normalizeForSearch(value == null ? '' : String(value))
  );
  seedSchema(dbFold, { withNormalized: false });
  const tSeed0 = hrNow();
  insertTracks(dbFold, N, { withNormalized: false });
  const seedFoldMs = msSince(tSeed0);

  // --- DB B: normalized columns (proposed) ---
  const dbNorm = new Database(':memory:');
  seedSchema(dbNorm, { withNormalized: true });
  const tSeed1 = hrNow();
  insertTracks(dbNorm, N, { withNormalized: true });
  const seedNormMs = msSince(tSeed1);

  const accentQuery = 'moriro'; // folds to match Morirò titles
  const probePaths = [];
  for (let i = 0; i < IMPORT_PATHS; i++) {
    probePaths.push(`/library/Artist_${i % 200}/Song_${i * 17}.mp4`);
  }
  // Mix in some missing paths
  probePaths[0] = '/library/missing/not-there.mp4';

  const allTracks = getAllTracksMapped(dbFold);
  const importedSlice = allTracks.slice(0, DEDUP_IMPORT).map((t) => ({ ...t }));
  // Shift ids slightly so path/uri still collide for realistic merge
  const prevCatalog = allTracks; // N rows

  const results = [];

  results.push(
    measure('search.fold_diacritics (accent query)', () => {
      const rows = searchFold(dbFold, accentQuery, SEARCH_LIMIT);
      return rows.length;
    })
  );

  results.push(
    measure('search.normalized_columns (accent query)', () => {
      const rows = searchNormalized(dbNorm, accentQuery, SEARCH_LIMIT);
      return rows.length;
    })
  );

  results.push(
    measure('search.fold_diacritics (empty → full dump slice)', () => {
      const rows = searchFold(dbFold, '', SEARCH_LIMIT);
      return rows.length;
    })
  );

  results.push(
    measure('pathLookup.getAllTracks + Map (50 paths)', () => {
      const map = new Map();
      for (const t of getAllTracksMapped(dbFold)) {
        if (t.localFilePath) map.set(t.localFilePath.toLowerCase(), t);
      }
      let hits = 0;
      for (const p of probePaths) {
        if (map.has(p.toLowerCase())) hits++;
      }
      return hits;
    })
  );

  results.push(
    measure('pathLookup.WHERE_IN (50 paths)', () => {
      const rows = getTracksByLocalPaths(dbFold, probePaths);
      return rows.length;
    })
  );

  results.push(
    measure('dedup.O(NxM) filter (500 on 25k)', () => {
      const filtered = dedupeNxM(prevCatalog, importedSlice);
      return filtered.length;
    })
  );

  results.push(
    measure('dedup.Set (500 on 25k)', () => {
      const filtered = dedupeSet(prevCatalog, importedSlice);
      return filtered.length;
    })
  );

  // Analysis queue membership: grow to ~5k then probe
  const queueLinear = [];
  for (let i = 0; i < 5000; i++) enqueueLinear(queueLinear, `t_${i}`);
  results.push(
    measure('analysisEnqueue.array.some (5k queue, 200 probes)', () => {
      let accepted = 0;
      for (let i = 0; i < 200; i++) {
        if (enqueueLinear(queueLinear, `t_${i % 5000}`)) accepted++;
        else if (enqueueLinear(queueLinear, `new_${i}`)) accepted++;
      }
      return accepted;
    })
  );

  const queueSet = [];
  const queuedIds = new Set();
  for (let i = 0; i < 5000; i++) enqueueSet(queueSet, queuedIds, `t_${i}`);
  results.push(
    measure('analysisEnqueue.Set (5k queue, 200 probes)', () => {
      let accepted = 0;
      for (let i = 0; i < 200; i++) {
        if (enqueueSet(queueSet, queuedIds, `t_${i % 5000}`)) accepted++;
        else if (enqueueSet(queueSet, queuedIds, `new_${i}`)) accepted++;
      }
      return accepted;
    })
  );

  // Dir cache: simulate F files across D dirs without touching disk heavily
  const fakeFs = {
    dirs: new Map()
  };
  for (let d = 0; d < 40; d++) {
    const entries = [];
    for (let f = 0; f < 80; f++) {
      entries.push({ name: `Song_${d}_${f}.mp4`, isFile: () => true, isDirectory: () => false });
    }
    fakeFs.dirs.set(`/lib/dir_${d}`, entries);
  }
  const fileList = [];
  for (let d = 0; d < 40; d++) {
    for (let f = 0; f < 12; f++) {
      fileList.push(`/lib/dir_${d}/Song_${d}_${f}.mp4`);
    }
  }

  function mapBasenamesNoCache(dir) {
    const filesMap = new Map();
    const entries = fakeFs.dirs.get(dir) || [];
    for (const entry of entries) {
      const ext = path.extname(entry.name).toLowerCase();
      const base = path.basename(entry.name, ext);
      if (!filesMap.has(base)) filesMap.set(base, []);
      filesMap.get(base).push(ext);
    }
    return filesMap;
  }

  results.push(
    measure('scanner.readdir per-file (480 files / 40 dirs)', () => {
      let ops = 0;
      for (const fp of fileList) {
        const dir = path.dirname(fp);
        mapBasenamesNoCache(dir);
        ops++;
      }
      return ops;
    })
  );

  results.push(
    measure('scanner.readdir with dirCache (480 files / 40 dirs)', () => {
      const dirCache = new Map();
      let ops = 0;
      for (const fp of fileList) {
        const dir = path.dirname(fp);
        if (!dirCache.has(dir)) dirCache.set(dir, mapBasenamesNoCache(dir));
        dirCache.get(dir);
        ops++;
      }
      return ops;
    })
  );

  dbFold.close();
  dbNorm.close();

  // Pretty print
  console.log(`Seed fold DB: ${seedFoldMs.toFixed(1)} ms | Seed norm DB: ${seedNormMs.toFixed(1)} ms\n`);
  console.log(
    `${'metric'.padEnd(52)} ${'median_ms'.padStart(10)} ${'min'.padStart(8)} ${'max'.padStart(8)}  hint`
  );
  console.log('-'.repeat(90));
  for (const r of results) {
    console.log(
      `${r.label.padEnd(52)} ${r.medianMs.toFixed(2).padStart(10)} ${r.minMs.toFixed(2).padStart(8)} ${r.maxMs.toFixed(2).padStart(8)}  ${r.resultHint}`
    );
  }

  const byLabel = Object.fromEntries(
    results.map((r) => [
      r.label,
      {
        medianMs: Number(r.medianMs.toFixed(3)),
        minMs: Number(r.minMs.toFixed(3)),
        maxMs: Number(r.maxMs.toFixed(3)),
        resultHint: r.resultHint
      }
    ])
  );

  const ratio = (a, b) => (b > 0 ? Number((a / b).toFixed(2)) : null);
  const summary = {
    phase,
    n: N,
    seedFoldMs: Number(seedFoldMs.toFixed(2)),
    seedNormMs: Number(seedNormMs.toFixed(2)),
    metrics: byLabel,
    speedups: {
      search_fold_vs_norm: ratio(
        byLabel['search.fold_diacritics (accent query)'].medianMs,
        byLabel['search.normalized_columns (accent query)'].medianMs
      ),
      path_dump_vs_where_in: ratio(
        byLabel['pathLookup.getAllTracks + Map (50 paths)'].medianMs,
        byLabel['pathLookup.WHERE_IN (50 paths)'].medianMs
      ),
      dedup_nxm_vs_set: ratio(
        byLabel['dedup.O(NxM) filter (500 on 25k)'].medianMs,
        byLabel['dedup.Set (500 on 25k)'].medianMs
      ),
      enqueue_some_vs_set: ratio(
        byLabel['analysisEnqueue.array.some (5k queue, 200 probes)'].medianMs,
        byLabel['analysisEnqueue.Set (5k queue, 200 probes)'].medianMs
      ),
      readdir_nocache_vs_cache: ratio(
        byLabel['scanner.readdir per-file (480 files / 40 dirs)'].medianMs,
        byLabel['scanner.readdir with dirCache (480 files / 40 dirs)'].medianMs
      )
    },
    bottlenecksConfirmed: {
      foldSearchSlowerThanNormalized:
        byLabel['search.fold_diacritics (accent query)'].medianMs >
        byLabel['search.normalized_columns (accent query)'].medianMs * 1.5,
      fullDumpSlowerThanWhereIn:
        byLabel['pathLookup.getAllTracks + Map (50 paths)'].medianMs >
        byLabel['pathLookup.WHERE_IN (50 paths)'].medianMs * 2,
      nxmDedupSlowerThanSet:
        byLabel['dedup.O(NxM) filter (500 on 25k)'].medianMs >
        byLabel['dedup.Set (500 on 25k)'].medianMs * 2,
      linearEnqueueSlowerThanSet:
        byLabel['analysisEnqueue.array.some (5k queue, 200 probes)'].medianMs >
        byLabel['analysisEnqueue.Set (5k queue, 200 probes)'].medianMs * 1.5,
      readdirWithoutCacheSlower:
        byLabel['scanner.readdir per-file (480 files / 40 dirs)'].medianMs >
        byLabel['scanner.readdir with dirCache (480 files / 40 dirs)'].medianMs * 2
    }
  };

  console.log('\n--- JSON summary ---');
  console.log(JSON.stringify(summary, null, 2));

  const outDir = process.env.BENCH_OUT_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `benchmark-${phase}.json`);
    fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
    console.log(`\nWrote ${outFile}`);
  }

  const confirmed = Object.values(summary.bottlenecksConfirmed).filter(Boolean).length;
  console.log(
    `\nBottlenecks confirmed: ${confirmed}/${Object.keys(summary.bottlenecksConfirmed).length}`
  );
  if (confirmed === 0) {
    console.warn('WARNING: no bottlenecks exceeded thresholds — do not apply speculative fixes.');
    process.exitCode = 2;
  }
}

main();

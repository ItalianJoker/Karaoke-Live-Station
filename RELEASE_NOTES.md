# 🎤 Karaoke Live Station v1.5.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v150-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.5.0

Nuova release GitHub **v1.5.0** (tag nuovo; **non** tocca `v1.4.0` / `v1.3.0` / `v1.2.0` / `v1.1.0`). Parte dalla baseline **v1.4.0**. PR **#72**. Pacchetto **1.4.0 → 1.5.0**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.5.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.5.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.5.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.5.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.5.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### ⚡ Hot path libreria / download / Guest (#72)
- Dedup download via SQL mirato (`findLocalMediaDedupCandidates`) al posto di dump `getAllTracks()`.
- Guest Portal: ricerca FTS/`searchTracks` + lookup per id (niente catalogo completo in memoria).
- Inflate ZIP CD+G asincrono (`inflateRaw`); yield FFT ogni 64 frame in analisi Key/BPM.
- Indici O(1): `pendingById` Map; UI `missingTrackIds` Set.

### 📦 Dipendenze (#72)
- Rimossi orphan inutilizzati: `clsx`, `tailwind-merge`, `autoprefixer`, `postcss` (Tailwind v4 via `@tailwindcss/vite`).
- Lockfile rigenerato; runtime/build critici invariati (ffmpeg, better-sqlite3, ORT, demucs, Signalsmith, SpessaSynth, Socket.IO).

### 🪵 Logging strutturato (#72)
- Migrazione `console.*` → `Logger` (DownloadManager, ZipCdgCache, TrackAnalysis, AudioGraph, Library/Control/store, Signalsmith).
- DEBUG su `before-quit` e extract ZIP; maschera campi secret (`[REDACTED]`).
- Livello da Impostazioni → `logLevel`.

### 🧪 Test & docs (#72)
- Source-lock suite (orphan deps, SQL dedup, guest FTS, async ZIP, FFT yield, logger masking) — **414** test green.
- README + CHANGELOG Keep a Changelog IT/EN.

### 🏷️ Versione
- Badge UI / pacchetto **v1.5.0**.

## ✅ Baseline 1.4.0
Resta incluso: Signalsmith Hi-Fi DSP, ZIP CD+G + Key/BPM, AI WebGPU Hidden Renderer / quit watchdog, Library Phase 2 14k (FTS5 / `getTracksPage` / delta rescan), modal sottotitoli strumentale, Safety-First modularizzazione, baseline 1.3.0.

---

<a name="v150-english"></a>
# 🇬🇧 Release Notes — Version 1.5.0

New GitHub release **v1.5.0** (new tag; does **not** touch `v1.4.0` / `v1.3.0` / `v1.2.0` / `v1.1.0`). Builds on **v1.4.0** baseline. PR **#72**. Package **1.4.0 → 1.5.0**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.5.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.5.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.5.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.5.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.5.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new

### ⚡ Library / download / Guest hot paths (#72)
- Download dedup via targeted SQL (`findLocalMediaDedupCandidates`) instead of `getAllTracks()` dumps.
- Guest Portal: FTS/`searchTracks` + id lookup (no full-catalog materialize).
- Async ZIP CD+G inflate (`inflateRaw`); FFT yield every 64 frames in Key/BPM analysis.
- O(1) indexes: `pendingById` Map; UI `missingTrackIds` Set.

### 📦 Dependencies (#72)
- Removed unused orphans: `clsx`, `tailwind-merge`, `autoprefixer`, `postcss` (Tailwind v4 via `@tailwindcss/vite`).
- Lockfile regenerated; critical runtime/build deps unchanged (ffmpeg, better-sqlite3, ORT, demucs, Signalsmith, SpessaSynth, Socket.IO).

### 🪵 Structured logging (#72)
- Migrated `console.*` → `Logger` (DownloadManager, ZipCdgCache, TrackAnalysis, AudioGraph, Library/Control/store, Signalsmith).
- DEBUG on `before-quit` and ZIP extract; sensitive-key masking (`[REDACTED]`).
- Level from Settings → `logLevel`.

### 🧪 Tests & docs (#72)
- Source-lock suite (orphan deps, SQL dedup, guest FTS, async ZIP, FFT yield, logger masking) — **414** tests green.
- README + Keep a Changelog IT/EN.

### 🏷️ Version
- UI badge / package **v1.5.0**.

## ✅ 1.4.0 baseline
Still includes: Signalsmith Hi-Fi DSP, ZIP CD+G + Key/BPM, AI WebGPU Hidden Renderer / quit watchdog, Library Phase 2 14k (FTS5 / `getTracksPage` / delta rescan), instrumental subtitles modal, Safety-First modularization, plus the 1.3.0 baseline.

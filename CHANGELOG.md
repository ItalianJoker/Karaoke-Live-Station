# Changelog — Karaoke Live Station

All notable changes to Karaoke Live Station.

Format follows [Keep a Changelog](https://keepachangelog.com/)-style sections.

---

## [Unreleased]

### Fixed
- **Library scan misses subfolders** — Refresh Library / startup reindex and download “already on disk” matching now walk all relative subdirectories under `libraryPath` (same audio/video / Instrumental / incomplete-file filters; path-based ids avoid double-count).

## [1.1.0] — AI extract race + web delete sync + download warnings (refresh) — 2026-09-17

Overwrite of GitHub Release `v1.1.0` after PR #27 (Instrumental AI worker ready race) + PR #28 (Web search after library delete) + PR #29 (manual download warnings in Downloads menu).

### Fixed
- **Instrumental AI extract WAV never written** — parent waited a fixed 50ms before posting `separate`; ORT import often took longer, so the utility worker missed the job and never wrote `{id}.instrumental.extract.wav`. Now gates on the worker ready ping, verifies the output WAV, and uses instrumental method coerce.
- **Web search still “in library” after delete** — deleting a track cleared the DB/file and Local list, but Web results kept the post-download `local_library` patch, so only Delete showed. Delete now reverts matching web rows (YouTube id / path / `${ytId}_` filename) back to `youtube` so Download (+ Instrumental) reappear without restart or re-search.
- **Manual download warnings outside Downloads menu** — `alreadyLocal` and in-flight download errors toasted outside the header menu; they now render on Downloads rows (amber, auto-open) like Instrumental phase / queued labels.

## [1.1.0] — AI instrumental debug logs + Actions Node 24 (refresh) — 2026-09-17

Overwrite of GitHub Release `v1.1.0` after PR #25 (Actions Node 24) + PR #26 (Instrumental AI debug / WAV naming).

### Fixed
- **Instrumental extract WAV naming** — demux extract is `{id}.extract.wav` from the source MP4 stem (not `{id}.instrumental.extract.wav`); AI output remains `{id}.instrumental.extract.wav`; per-`downloadId` temp cleanup covers source MP4 + both WAVs.

### Changed
- **Instrumental AI debug logging** — richer `debug`-level stages/fields across extract, model ensure, ORT separate, remux, and cleanup (no secrets).
- **GitHub Actions Node 24** — `actions/checkout`, `setup-node`, `upload-artifact` bumped to Node 24-compatible majors; app `node-version` stays 20.

## [1.1.0] — Instrumental download staging under userData/temp (refresh) — 2026-09-17

Overwrite of GitHub Release `v1.1.0` after PR #24 (reliable yt-dlp original staging before Instrumental AI).

### Fixed
- **Download Instrumental skipped AI / “original never downloaded”** — yt-dlp always staged under `userData/temp` (not the library folder), but Destination/Merger parsing could miss the final muxed MP4 (relative paths, unquoted Merger, format-fragment hints). Instrumental then completed without AI. Staging helpers now prefer `${downloadId}.mp4`, ignore `.f###`/`.part` sidecars, and fail clearly when the original is missing. Remux still lands as `*.instrumental.mp4` then library `(Instrumental)`.

## [1.1.0] — Local media path `//home/...` + SoundFont preference (refresh) — 2026-09-17

Overwrite of GitHub Release `v1.1.0` after PR #23 (`karaoke://local` path normalization + SoundFont candidate order).

### Fixed
- **Local media path `//home/...` (Linux AppImage)** — `karaoke://local/${encodeURIComponent('/abs/...')}` decoded to a double-leading-slash path; POSIX treats `//` as implementation-defined so `existsSync` failed and Chromium reported `DEMUXER_ERROR_COULD_NOT_OPEN`. Shared `resolveKaraokeLocalFilePath` now keeps a single leading slash on POSIX and still strips `/C:/` (and UNC) correctly on Windows. Unicode filenames (å, ò, …) round-trip via `encodeURIComponent` unchanged. Instrumental downloads already register `uri` from the same `destinationPath` written to disk; they now share `buildKaraokeLocalUri`.
- **Bundled SoundFont preference** — prefer `resources/soundfonts/` (extraResources, outside asar) before `app.getAppPath()` asar candidates so MIDI SF2 loads via `karaoke://local` on packaged builds.

## [1.1.0] — AI 45% progress + YouTube load more + clear downloads (refresh) — 2026-09-17

Overwrite of GitHub Release `v1.1.0` after PR #22 (Instrumental AI progress, YouTube pagination, Download clear-all).

### Fixed
- **Instrumental AI stuck at ~45% (“Rimozione voce”)** — phase-aware monotonic progress (no snap-back after model load); intra-chunk STFT/ORT heartbeats; cached Bluestein FFT plans for UVR MDX `n_fft=5120`; safer ONNX/WASM `ArrayBuffer` copies; idle watchdog 20 min.

### Added
- **YouTube “Carica altri video”** — Load more pagination in Web search (`ytsearch` + playlist window).
- **Download menu — Pulisci coda** — clear list and cancel all in-flight/queued downloads (with confirm when active).

## [1.1.0] — Download speed/ETA + instrumental AI timeout (refresh) — 2026-09-17

Overwrite of GitHub Release `v1.1.0` after PR #21 (speed/ETA parsing + Instrumental AI timeout hardening).

### Fixed
- **Download menu speed + ETA** — yt-dlp `--progress-template` `download:` is a *type key*, not output text; progress lines never matched the parser. Template now emits a `KLSPROG|` marker, forces `--progress`, and the Download menu shows speed + remaining time.
- **Instrumental AI “Rimozione voce” timeout** — hard timeout now scales with track length; idle watchdog resets on progress heartbeats; ORT WASM is loaded via in-memory `wasmBinary` in the utility worker (avoids file:// fetch hangs). Conversion ETA updates during AI separation. Cancel unchanged; models still update only if newer under `userData/models`.

## [1.1.0] — Settings split + download cancel + AI Instrumental (refresh) — 2026-09-17

Overwrite of GitHub Release `v1.1.0` after settings split (live DSP vs Instrumental AI), abortable download cancel, and MDX UVR low-bin align (PR #19 + #20).

### Fixed
- **Download cancel** — interrupt from the Download menu now aborts yt-dlp (process tree), instrumental ffmpeg, model download, and AI utility workers; UI clears for traditional and instrumental jobs.
- **MDX Karaoke 2** — zero lowest 3 STFT bins before ONNX (matches UVR `separate.py`), improving low-end behavior.

### Changed
- **Settings split**: live Rimozione Vocale dropdown is algorithmic-only; **Download Instrumental Method** is a separate setting (AI + DSP). Default instrumental method is UVR-MDX Karaoke 2. AI never drives the live `V` button.

### Added
- **Download Instrumental — offline AI vocal removal** (Settings: UVR-MDX Karaoke 2 / HTDemucs / BS-Roformer). Models persist under `userData/models/` and update only when missing, corrupt, or catalog URL/SHA/version is newer. Live Rimozione Vocale stays algorithmic (no Separazione dual-stem).
- **Download menu** (header, left of Settings) for active/queued progress; removed alert-style list above library rows.
- **Max simultaneous downloads** setting (shared pool for normal + instrumental).
- Non-blocking toast warning when starting Download Instrumental (longer / heavier than a normal download).
- `scripts/verify-ai-vocal-path.js` — automated AI routing + abort check for Download Instrumental.

## [1.1.0] — Algorithmic vocal remover + Download Instrumental (refresh) — 2026-09-16

## [1.1.0] — On-demand dual-stem vocal remover (refresh) — 2026-09-16

Overwrite of GitHub Release `v1.1.0` after on-demand dual-stem mixer + vocal-remover no-op fix.

### Added
- **On-demand MP4 dual-stem mixer** — AI vocal remover stays idle until toggle/fader engage (`NATIVE_AUDIO` → `EXTRACTING_AND_SEPARATING` → `DUAL_STEM_ACTIVE`). SHA-256 disk cache (`userData/dual-stem-cache/<hash>/stem_instrumental.wav` + `stem_vocals.wav`). Video muted while dual-stem active; video is clock master; Control fader = guide-vocal level.

### Fixed
- **Vocal remover no-op (voice stays after model ready)** — dry→wet / algorithmic enable GainNode ramps now call `setValueAtTime` before `linearRamp` (Chromium otherwise leaves dry at 1). Video/muxed karaoke tracks demux via ffmpeg to PCM WAV under `userData/vocal-audio-cache` before AI separation so `decodeAudioData` is not fed a video container.
- **AI vocal remover UI freeze during playback** — enabling offline AI (MDX/ORT) no longer blocks the Electron main or renderer UI thread. MDX STFT+inference runs in a Web Worker (with event-loop yields as fallback); model integrity uses streaming async I/O; ONNX weights are fetched via `karaoke://models/` from `<userData>/models/` (not giant sync IPC / Temp). When AI cannot produce a stem, toast + **algorithmic DSP fallback** keeps the toggle useful.

---

## [1.1.0] — ORT WASM userData + MDX durability (refresh) — 2026-09-16

Overwrite of GitHub Release `v1.1.0` after ORT WASM Temp-path fix + durable model installs.

### Fixed
- **ORT WASM backend on Windows Electron** — onnxruntime-web no longer loads `.mjs`/`.wasm` from OS Temp / ephemeral `file://` blobs (fix for `no available backend found` / `wasm-simd-threaded.jsep.mjs`). Assets are seeded once into `<userData>/ort/` (like yt-dlp under `bin/`) and served via `karaoke://ort/`; refresh only when missing, size-mismatched, or packaged source newer. Clearer toast when the WASM backend still fails.
- **Offline AI models durability** — MDX/HTDemucs/BS-Roformer stay under `<userData>/models/` with sibling `.download` staging (not OS temp as final home); sidecar `.meta.json` skips re-download unless missing, corrupt, or catalog URL/SHA newer.

---

## [1.1.0] — Web preview unmute + archive thumbs (refresh) — 2026-09-14

Overwrite of GitHub Release `v1.1.0` after web-search YouTube unmute confirm + auto-archive thumbnail reindex.

### Added
- **Same-device unmute confirm on YouTube web preview** — embedded YouTube / Web-search Pre-Ascolto uses the same themed confirm modal as local video/audio/MIDI when CUE === Main Output

### Fixed
- **Auto-archive → Local thumbnail** — after YouTube download + save to library, full Local reindex (`scanFolder` + ffmpeg cover) runs **before** enqueue so the new track shows the correct thumbnail without manual “Aggiorna libreria”; `save-to-library` also generates the thumb on upsert

---

## [1.1.0] — Icons + YouTube auto-archive queue (refresh) — 2026-09-13

Overwrite of GitHub Release `v1.1.0` after packaging icon + YouTube queue/archive fix.

### Fixed
- **YouTube → queue with auto-archive** — waits for successful download + library archive, refreshes/reindexes Local, then enqueues the **local library file** (no broken remote/temp pointer; failure shows an error and does not leave a non-playable queue item)
- Playback reloads when a queued track’s local path is promoted (temp/cache → permanent library)

### Changed
- **Official logo as app icon** everywhere in packaging: `build/icon.png`, Windows `build/icon.ico`, Linux `build/icons/{size}x{size}.png`, macOS `build/icon.png` (electron-builder → `.icns`); favicons refreshed from `public/logo.png`
- Regenerator: `npm run generate-icons` (`scripts/generate-icons.js`)

---

## [1.1.0] — Refresh (PR #3) — 2026-09-13

Overwrite of GitHub Release `v1.1.0` after merge of `cursor/preascolto-preview-fix-855c`.

### Added
- **Algorithmic Vocal Remover (Experimental)** — real-time classical mid/side DSP (`centerCancelBassKeep`, `centerCancel`, `softMid`); Settings → Audio algorithm dropdown; Control button labeled *(Sperimentale)/(Experimental)*
- **Pre-Ascolto themed preview** — Library headphones opens Settings-styled modal; audio on CUE device; mute/volume via embedded player; same-device unmute warning; works for video / audio-only / MIDI
- **Library delete** — themed confirm modal; SQLite catalog removal; disk delete only for permanent files under `libraryPath` (never queue_cache / temp / incomplete)
- Stage per-message backgrounds (color/image) while overlays are visible
- Settings → Shortcuts parity with **?** / F1 help inventory
- Scoped Library / Web search (separate query & results per sub-tab)
- Stage playback-speed badge (`showSpeedOnStage`)

### Changed
- Vocal removal path is **algorithmic Web Audio only** (no model download, no offline stem separation)
- Pre-Ascolto no longer toggles legacy CUE play/stop as a side effect of opening preview
- Pitch shifter ScriptProcessor stays disconnected at 0 semitones (true bypass)

### Removed
- Demucs / HTDemucs / ONNX neural vocal-separation path (`demucs-web`, `onnxruntime-web`, model IPC, stem cache)

### Fixed
- Choppy / no-op vocal remover behavior by wiring a continuous native AudioNode graph (no main-thread ML)

---

## [1.1.0] — Phases 1–6 pipeline (2026-09-13)

Shipped from PR #1 (`cursor/phase-1-portability-ytdlp-855c`), later refreshed by PR #3 (see above).

### Added
- Per-message Stage background (color/image) while overlay messages are visible.

#### Architecture & portability (Phase 1)
- Portable resolution of managed binaries under Electron `userData` (`<app_userData>/bin/`) for yt-dlp and helpers
- Durable yt-dlp bootstrap / integrity checks without hardcoded user-home paths
- Cross-platform binary layout under `bin/{linux,win,mac}` packaged as resources

#### Core storage (Phase 2)
- Required configurable `libraryPath` (no silent fallback into `userData/library`)
- Persistent `queue_cache` for web downloads when auto-archive is off (survives restart while queued)
- Download deduplication via `findExistingLocalMedia` before network I/O
- Single-instance lock (`requestSingleInstanceLock`) focusing the existing Control window
- Fair Queue enabled by default (`enableFairQueue: true`)
- Queue-cache GC on dequeue / clear queue

#### Audio & playback (Phase 3)
- Real-time algorithmic mid/side vocal reduction (Experimental) — superseded any earlier ML/Demucs experiments
- Perceptual master volume curve `gain = volume²`
- Non-blocking toasts / non-modal native dialogs so Web Audio is not suspended by UI chrome
- Auto-advance **OFF** by default (`autoAdvanceNext: false`) with configurable `transitionPauseSec` (default 3s)
- SIAE history gate: natural end **or** ≥ 120s playback, ISO timestamps, duplicate protection

#### UI/UX (Phase 4)
- Stage ready handshake (fonts / stylesheets / double `requestAnimationFrame`) before reveal
- Stage semitone badge for `+N` / `-N` / `0` with `showPitchOnStage` setting toggle
- YouTube preview embed hardened against error 153 (`youtube-nocookie`, `enablejsapi`, `origin`, `playsinline`, `referrerPolicy`)
- Reactive local library search; dismissible **Download completato** badge
- Right tabs kept mounted (CSS hide) so downloads/search/scroll persist
- Settings thematic tabs (Generale, Libreria & Download, Audio & Riproduzione, Schermo Stage, Scorciatoie) + instant search
- Live shortcuts with register/cleanup; exact hint **Doppio click o Play per avviare**

#### Performance & tests (Phase 5)
- Algorithmic vocal-remover graph with enable crossfade; no stem LRU / ONNX cache
- MIDI voice-release timeout cancellation on `AudioGraphManager.dispose`
- SQLite `searchTracks` + indexes exposed over IPC (`db:search-tracks`)
- Holistic automated suite (Suite 7 rewritten for algorithmic vocal remover)

#### Documentation (Phase 6)
- Exhaustive Italian `USER_MANUAL.md` + `USER_MANUAL_it.md`
- Localized manuals: `USER_MANUAL_en.md`, `USER_MANUAL_es.md`, `USER_MANUAL_fr.md`
- README documentation links (top + Docs section) and `<userData>/bin/` note
- This `CHANGELOG.md`

### Changed
- Settings UI reorganized into searchable thematic tabs without removing options
- First-run library dialogs are parent-less (non-modal) to protect live playback
- Stage pitch badge visibility policy: always show when toggle is on (including `0`)

### Fixed
- Intermittent Stage CSS/string mount before video show
- YouTube iframe preview error 153
- Download “in progress” sticky state after completion
- Orphan MIDI `setTimeout` callbacks after audio graph dispose

### Defaults (operator-facing)

| Setting | Default |
| --- | --- |
| `enableFairQueue` | `true` |
| `autoAdvanceNext` | `false` |
| `transitionPauseSec` | `3` |
| `autoArchiveWebTracks` | `true` |
| `showPitchOnStage` | `true` |
| SIAE log threshold | ≥ 120s or natural end |

### Fixed (follow-up)
- YouTube preview Error 153: Electron Referer injection + shared embed URL builder
- Duplicate local-library rows when queuing from web search (stable YouTube id upsert + scan dedupe)
- Incomplete / in-progress downloads no longer indexed as finished library tracks

### Added (follow-up)
- Stage playback-speed badge toggle (`showSpeedOnStage`), mirroring pitch badge
- PayPal support banner pinned above Settings search (visible on all tabs)

---

## Validation
- `npx tsc --noEmit` / `npm run typecheck` — pass
- `npm test` — pass (algorithmic vocal-remover suite)

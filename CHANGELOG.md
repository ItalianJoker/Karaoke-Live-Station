# Changelog — Karaoke Live Station

All notable changes to Karaoke Live Station.

Format follows [Keep a Changelog](https://keepachangelog.com/)-style sections.

---

## [Unreleased]

### Added
- None yet.

### Changed
- **IT:** Tema **Studio Desk** — polish UX (#77) + **default Regia** `studio-desk` (primo in picker; altri temi etichettati « (Legacy)»); meter MIDI note-on; card libreria `py-3`. Id temi invariati. Persistenza: chi ha già un altro `themeHost` lo conserva. (PR #77)
- **EN:** **Studio Desk** theme UX polish (#77) + **default Control Room** `studio-desk` (first in picker; other themes labeled « (Legacy)»); MIDI note-on meters; library card `py-3`. Theme ids unchanged. Persistence: existing saved `themeHost` kept. (PR #77)

### Fixed
- None yet.

### Breaking Changes
- None yet.

## [1.5.0] — Hot-paths + Studio Desk opt-in + Key/BPM UX — 2026-09-20

Overwrite of GitHub Release **v1.5.0** after PRs **#72** + **#74** + **#76** (same version; does **not** touch `v1.4.0` / `v1.3.0` / `v1.2.0` / `v1.1.0`). Builds on `v1.4.0` baseline. Package stays **1.5.0**.

### 🎛️ UI & Regia
- **IT:** Tema opt-in **Studio Desk** (`studio-desk`): layout Regia Studio (logo+menu, player, MIDI on-demand) e palette cyan/purple; i temi esistenti restano selezionabili e ripristinano la Regia classica. Default invariato (`dark-stage`). (PR #76)
- **EN:** Opt-in **Studio Desk** theme (`studio-desk`): Studio Regia layout (logo+menu, player, on-demand MIDI) and cyan/purple palette; existing themes stay selectable and restore classic Regia. Default unchanged (`dark-stage`). (PR #76)
- **IT:** Chip Key/BPM sempre visibili in Libreria, Coda, Regia e Palco (placeholder «—» se mancanti); etichetta **BPM** accanto al tempo; dialogo istanza singola «Software già in esecuzione» (+ EN/ES/FR). (PR #74)
- **EN:** Always-visible Key/BPM chips in Library, Queue, Control, and Stage (“—” placeholder when unknown); **BPM** unit beside tempo; single-instance dialog “Software already running” (+ IT/ES/FR). (PR #74)

### Fixed
- **IT/EN:** Key/BPM non più nascosti da rendering condizionale / overflow sulle sole tracce analizzate. (PR #74)

### ⚡ Performance & Concurrency
- **IT:** Dedup download via SQL mirato (`findLocalMediaDedupCandidates`) al posto di `getAllTracks()`; Guest Portal su FTS/`searchTracks` + lookup id; inflate ZIP asincrono (`inflateRaw`); yield FFT durante analisi Key/BPM; `pendingById` Map e Set `missingTrackIds` in UI. (PR #72)
- **EN:** Download dedup via targeted SQL (`findLocalMediaDedupCandidates`) instead of `getAllTracks()`; Guest Portal on FTS/`searchTracks` + id lookup; async ZIP inflate (`inflateRaw`); FFT yield during Key/BPM analysis; `pendingById` Map and UI `missingTrackIds` Set. (PR #72)

### 📦 Dependencies
- **IT/EN:** Removed unused `clsx`, `tailwind-merge`, `autoprefixer`, `postcss` (Tailwind v4 via `@tailwindcss/vite`). Lockfile regenerated. (PR #72)

### 🧹 Refactoring & Cleanup
- **IT/EN:** Surgical Map/Set indexing in download dedup; GuestServer callback contract updated (no full-catalog dump). No UI redesign; playback/AI/library contracts preserved. (PR #72)

### 🪵 Logging & Observability
- **IT:** Migrazione `console.*` → Logger strutturato (DownloadManager, ZipCdgCache, TrackAnalysis, AudioGraph, Library/Control/store, Signalsmith); DEBUG su `before-quit` e extract ZIP; maschera campi secret nel Logger. (PR #72)
- **EN:** Migrated `console.*` → structured Logger (DownloadManager, ZipCdgCache, TrackAnalysis, AudioGraph, Library/Control/store, Signalsmith); DEBUG on `before-quit` and ZIP extract; Logger sensitive-key masking. (PR #72)

### 🧪 Tests
- **IT/EN:** New source-lock suite for orphan deps, SQL dedup, guest FTS, async ZIP, FFT yield, logger masking (414 tests green). (PR #72)

### 📚 Documentation & AI Context
- **IT/EN:** README deps stack + AI Context hot-path notes; RELEASE_NOTES IT/EN for **v1.5.0**. (PR #72 + this release)

### Changed
- App version **1.5.0** in `package.json` / lockfile / CHANGELOG / RELEASE_NOTES / Settings footer. (this release)

### Breaking Changes
- None.

## [1.4.0] — Signalsmith Hi-Fi DSP + ZIP CD+G + AI WebGPU + Library Phase 2 — 2026-09-20

Overwrite of GitHub Release **v1.4.0** after PRs **#52**–**#70** (same version; does **not** touch `v1.3.0` / `v1.2.0` / `v1.1.0`). Builds on `v1.3.0` baseline. Package stays **1.4.0** (no 1.5.0).

### Added
- **Library Phase 2 (14k scale)** — Delta rescan (`fileMtimeMs`/`fileSizeBytes`), async `opendir` walk + `library:scan-progress`, FTS5 Local search, keyset `getTracksPage` so empty Local never IPC-dumps the full catalog. ZIP CD inspect deferred off the hot walk. (PR #70)
- **Signalsmith Stretch Hi-Fi pitch DSP (default)** — `SignalsmithPitchShifterNode` (thin `BungeePitchShifterNode` alias) wraps npm `signalsmith-stretch` (MIT AudioWorklet). Settings id `dspEngine: 'signalsmith'` (legacy `bungee` migrates). Tempo via media `playbackRate` + `preservesPitch`; pitch via `schedule({ semitones })`. Mute watchdog → dry pass-through + SoundTouch emergency. Notice: `public/workers/SIGNALSMITH_NOTICE.md`. Lab: `scripts/lab-signalsmith-pitch.js`. MIDI/KAR unchanged (SpessaSynth). (PR #66 / #70; supersedes Bungee Wasm from #52/#56/#60/#63)
- **Bungee default pitch/speed DSP** — *(historical #52 path; removed in #66)* Wasm AudioWorklet phase vocoder (`bungee_processor.js` + `bungee.wasm`, MPL-2.0). Settings `dspEngine: 'bungee' | 'soundtouch'` (default `bungee`). Control pitch UI ±8 / ±4. True bypass when pitch 0 && speed 1.00x. Silent fallback to SoundTouch if init fails. (PR #52)
- **Instrumental subtitles confirmation modal** — Clicking Scarica strumentale opens `InstrumentalSubtitlesModal` (title/artist + amber ASR warning) before download. Actions: with subtitles / instrumental only / cancel (Esc / outside). Optional remember → `instrumentalSubtitlesPolicy: 'ask' | 'always' | 'never'`. `DownloadOptions.includeSubtitles` opt-in; normal download unchanged. (PR #53)
- **Native `.zip` CD+G karaoke packs** — Library scan/import discovers ZIP archives that contain an MP3/WAV + `.cdg` pair (Central Directory inspect). Playback extracts on demand to `userData/temp/zip_cache/<trackId>/`, serves via `karaoke://local/`, and cleans up on dequeue / app quit. Title/artist from the ZIP filename. (PR #54)
- **Key + BPM detection** — Catalog columns `initialKey` / `initialBpm`; async chromagram/onset analysis (MIDI tempo + key-signature meta; audio via FFmpeg PCM). Regia pitch/speed pills show live `base→result` / `bpm→eff` beside existing ±/reset controls (label-only fallback when unknown). Shared helpers in `musicalKeys.ts` (`transposeKey`, `effectiveBpm`). (PR #54)
- **AI GPU-First** — Settings → Library & Download: `aiEnableGpu` (default on) + live GPU badge (green name / amber CPU multithread). IPC `system:get-gpu-status`. ORT providers `webgpu`→`wasm` when enabled+supported; else WASM + `aiCpuThreads`. (PR #55)
- **HTDemucs advanced settings** — When Download Instrumental method is HTDemucs: `demucsShifts` (0|1|2), `demucsSegmentSize` (5–20 s), `demucsOverlap` (0.10–0.50). Payload omitted for MDX (and vice versa). (PR #55)
- **`scripts/verify-ai-options-pipeline.js`** — GPU providers, threads, MDX/Demucs payload separation, coerce Roformer/DSP → Karaoke 2, locale Basic Algorithm strings; wired into `npm test`. (PR #55)
- **Safety-First modularization** — ControlWindow hooks (`useControlPlayback`, `useKeyboardShortcuts`) + `PlayerDeckControls` + `QueueList`; SettingsModal per-tab components; library list windowed virtualization for 16k+ catalogs; dual-audience TSDoc on new exports. (PR #57)
- **AI worker WebGPU telemetry + honest WASM UI** — Instrumental AI reports actual `ortBackend` (`webgpu`|`wasm`) + `ortFallbackReason` to logs/progress (no silent WASM fallback). Stderr parse for ORT `webgpu` / `backend not found`. Diagnostic `scripts/probe-worker-webgpu.js`. Shared `aiWorkerWebGpu` probe skips WebGPU when `navigator.gpu` is missing in `utilityProcess`. Settings GPU badge stays amber WASM when the AI worker cannot host WebGPU (hardware GPU name shown as note only — never false “GPU active”). (PR #60)
- **Settings: Download Instrumental subtitles policy** — Library & Download exposes `instrumentalSubtitlesPolicy` (`ask` / `always` / `never`), same meaning as the modal “Remember my choice”; operators can change or clear the remembered preference later without redesign. (PR #61)
- **Hidden Renderer WebGPU for Instrumental AI** — When Settings GPU is on and `requestAdapter()` succeeds, ORT WebGPU runs in a Hidden BrowserWindow (`workerKind=hidden-renderer`); otherwise existing `utilityProcess` WASM + `aiCpuThreads`. Probe HTML under `userData` (asar-safe); live adapter probe (not sticky snapshot). Settings badge green only when Hidden Renderer adapter OK. (PR #63)
- **Large-library DnD + search hot paths** — Benchmark-first (`scripts/benchmark-large-library.js`) Set-based Library drop dedup, `addToQueueBatch`, scanner `dirCache`, `queuedTrackIds` Set, `titleNorm`/`artistNorm` indexes + `searchTracks`, `getTracksByLocalPaths` / `getTracksMissingThumbnails`, `library:track-updated` thumb backfill (no full-catalog storm). Targets 10k–50k catalogs without UI freeze. (PR #64)
- **AI WebGPU `/all` + Hidden Renderer → utilityProcess fallback** — Import `onnxruntime-web/all` so Electron registers the WebGPU EP. Hidden Renderer never runs in-process multithreaded WASM after WebGPU failure; posts `gpu-fallback-requested` and main re-routes the job to `utilityProcess` (native WASM threads, no SAB deadlock). (PR #66)
- **App quit cleanup + WebGPU device/session watchdog** — Control close: Stage → dispose Hidden Renderer → cancel downloads/search → `app.quit()`. `before-quit`: same dispose + guestServer/temp/zip/`db.close()`. Probe requires `requestAdapter` + `requestDevice` (5s race). 15s watchdog on WebGPU `InferenceSession.create` (MDX + HTDemucs) → `GpuFallbackRequestedError` → utilityProcess WASM. WebGPU uses JSEP `wasmPaths` only (never CPU `wasmBinary`). (PR #68)

### Changed
- **DSP Settings id `signalsmith`** — Legacy `bungee` migrates via `coerceDspPitchEngine` (no settings wipe). `SignalsmithPitchShifterNode` replaces Bungee naming; thin alias kept. (PR #70)
- SoundTouch WSOLA remains selectable as emergency/light engine (hard ±4 ST); no longer the sole media pitch path. (PR #52 / #66)
- README / RELEASE_NOTES attribution for Signalsmith (MIT) + `public/workers/SIGNALSMITH_NOTICE.md` (replaces Bungee MPL notice / Wasm assets removed in #66). (PR #52 → #66)
- **yt-dlp instrumental `--sub-langs`** — Extended from `.*-orig` to `.*-orig,default` (still no bare `all`; 429-safe). Auto-subs flags only when `instrumental && includeSubtitles === true`. (PR #53)
- **Download Instrumental method selector** — AI only: `aiMdxKaraoke2` | `aiHtDemucs` (default Karaoke 2). Removed DSP and BS-Roformer from the download Settings UI. Live Regia vocal remover DSP modes unchanged. (PR #55)
- **Experimental → Basic Algorithm** — Live vocal remover labels in it/en/es/fr (`Algoritmo Base` / `Basic Algorithm` / `Algoritmo Básico` / `Algorithme de Base`); removed Experimental tags from stable HTDemucs blurbs. (PR #55)
- Granular Zustand selectors in extracted Control hooks/components; AudioGraphManager.dispose disconnects Web Audio nodes before `AudioContext.close`; user manuals (it/en/es/fr) chapter parity for OS DnD import, recursive library scan, Bungee/SoundTouch DSP, AppImage SoundFont seeding. (PR #57)
- **Settings AI layout** — Library & Download: GPU card is toggle + badge only; AI instrumental CPU cores live in a sibling CPU card; MDX `mdxEnableOrt` (ONNX Runtime CPU acceleration) grouped into that CPU card (MDX-only visibility unchanged). No settings key / IPC / default changes. (PR #59)
- MDX/HTDemucs try WebGPU-only then WASM (avoids ORT silently stripping webgpu from a combined EP list). InstrumentalProcessor/AiSeparator no longer log `ortNumThreads: 1` when threads are unresolved/null. `probeGpuStatus.isSupported` means Hidden Renderer / worker ORT WebGPU capability (not Chromium hardware presence alone). (PR #60 / #63 / #68)
- Default Hi-Fi engine is **Signalsmith Stretch**; SoundTouch labeled emergency/light in Settings (it/en/es/fr). Removed `bungee_processor.js` / `bungee.wasm` / `BUNGEE_NOTICE.md`. (PR #66)
- App version **1.4.0** in `package.json` / lockfile / CHANGELOG / RELEASE_NOTES / Settings footer. (this release)

### Fixed
- **Signalsmith → SoundTouch pitch bounds** — Fallback / manual SoundTouch clamps UI + live pitch/speed to ±4 ST / 0.75–1.25×; shortcuts honor engine range; Settings syncs via fallback handler. (PR #70)
- **WebGPU → WASM CPU threads** — UtilityProcess re-route reasserts Settings `aiCpuThreads` (`resolveAiCpuThreads`); logs/badge show effective WASM thread count. (PR #70)
- **WebGPU hardware bind + Signalsmith worklet load** — Pre-import `ort.all.bundle.min.mjs` in Hidden Renderer; JSEP `wasmPaths` wasm-only + `powerPreference: 'high-performance'`; Chromium WebGPU flags; static `signalsmith_processor.js` + `ensureWorkletModuleLoaded`; utilityProcess `location.origin` banner. (`ae0135d`)
- **Orphan processes after closing Regia** — Hidden Renderer stayed open so `window-all-closed` / `before-quit` never ran (guestServer + GPU helpers lingered). Control `closed` now disposes Hidden Renderer and calls `app.quit()`. (PR #68)
- **Indefinite freeze on “Creating ORT session (WebGPU)”** — Adapter-only probe was a false positive; `InferenceSession.create` had no timeout; embedding CPU `wasmBinary` broke JSEP. Fixed via `requestDevice` probe, 15s create watchdog → utilityProcess WASM, and JSEP-only `wasmPaths` on WebGPU. (PR #68)
- **Bungee pitch + time-stretch no-op** — *(historical #56; Wasm path removed in #66)* AudioWorklet processor: drop `export default`, Emscripten `ENVIRONMENT_IS_WORKER` detects `AudioWorkletGlobalScope`. `BungeePitchShifterNode.create` waits for Wasm `initialized` (timeout → SoundTouch). Graph re-applies pitch **and** speed on wire; Bungee keeps `HTMLMediaElement.playbackRate = 1.0` (WASM owns tempo, no double rate / chipmunk); SoundTouch still uses element rate. Bypass exits for pitch≠0 **or** speed≠1.0. (PR #56)
- **Per-engine speed UI matrix** — Hi-Fi (`bungee` id) Control 0.50–1.50 (absolute 0.50–2.00); SoundTouch Control 0.75–1.25 (absolute 0.50–1.50). `getSpeedRangeForEngine` / `clampSpeedForEngine`; engine switch re-clamps (e.g. 0.60→0.75). (PR #56 / #66)
- **Bungee `BungeeModule._malloc is not a function`** — *(historical #60; Wasm path removed in #66)* Emscripten MODULARIZE locals (`_malloc` / `HEAPF32`) mirrored onto the Module object. (PR #60)
- **Bungee negative-pitch mute / grain drop** — *(historical #63 FIFO; superseded by Signalsmith in #66)* 8192-frame scratch + stereo output FIFO. (PR #63)
- **Pitch mute on negative semitones** — Replaced broken Bungee Wasm Stretcher with Signalsmith Stretch; mute watchdog auto-falls back to SoundTouch without stopping playback. (PR #66)
- **AI WebGPU missing / WASM freeze in Hidden Renderer** — Bare `onnxruntime-web` resolved to `ort.node.min.js` (no WebGPU EP); after failure, in-process multithreaded WASM deadlocked without COI. Fixed via `onnxruntime-web/all` + utilityProcess re-route. (PR #66)
- **Large-library UI freeze on OS DnD / Local search** — O(N×M) drop dedup, full-catalog import path lookup, accent search without norm indexes, analysis `queue.some`, and uncached scanner readdir replaced with Set/`WHERE IN`/norm indexes/`dirCache` hot paths (25k-safe benchmarks). (PR #64)

### Breaking Changes
- Persisted Download Instrumental methods that were DSP or `aiBsRoformer` coerce to `aiMdxKaraoke2`. (PR #55)
- Missing `dspEngine` in persisted settings coerces to `signalsmith`; legacy `bungee` migrates to `signalsmith`; missing `instrumentalSubtitlesPolicy` coerces to `ask`. (PR #52 / #53 / #70)

## [1.3.0] — Startup maximize / Stage launch / AI CPU cores / Settings layout — 2026-09-19

Code version bump to **1.3.0** (draft PR — **no GitHub release tag until Luca Si**). Builds on `v1.2.0` baseline.

### Added
- **Maximize Regia on launch** — `autoMaximizeControlOnLaunch` (default `true`) calls `BrowserWindow.maximize()` on Control (not exclusive fullscreen). Prefs mirrored to `userData/launch-prefs.json` for boot before Control hydrates. (this PR)
- **Stage on/off at launch** — `autoOpenStageOnLaunch` (default `true`); when false, skips `createStageWindow` at startup. Reopen via **P** / **F2**, header button, `window:reopen-stage`, or alias `stage:open`. (this PR)
- **AI CPU cores (Download Instrumental)** — `aiCpuThreads: number | null` (`null` = all detected cores). Settings → Library & Download: available-core count, slider + numeric 1..N, reset-to-max. ORT `numThreads` clamped; `simd = true`; providers `webgpu`→`wasm` fallback. (this PR)

### Changed
- **SettingsModal layout** — `max-w-5xl` / `h-[88vh]`, left sidebar ~220px, content grids; footer shows **v1.3.0**. (this PR)
- **Instrumental + MDX + AI cores** moved from Audio → **Library & Download** (under download storage). Audio keeps SoundFont, CUE/Master, A/V sync, live Rimozione Vocale DSP, normalization, auto-advance. (this PR)
- App version **1.3.0** in `package.json` / lockfile / CHANGELOG / RELEASE_NOTES / Settings footer. (this PR)

### Fixed
- None.

### Breaking Changes
- None (persisted settings: missing `aiCpuThreads` → all cores; missing launch flags → true).

## [1.2.0] — Drag & Drop, scan, SoundFont, missing files, yt-dlp `.*-orig` — 2026-09-18

Overwrite of GitHub Release `v1.2.0` after PRs **#48** + **#49** (on top of batch #40–#44 + #46–#47; #45 skipped). Same version number; does **not** touch `v1.1.0`.

### Added
- **Missing local media handling** — IPC `library:check-file-exists` → `{ exists, path }` (preload `checkFileExists` → boolean). Library enqueue and Control play/jump/auto-advance probe local paths before AudioGraph/`<video>`; on miss: pause/reset, mark `missingTrackIds` (rose-500/70 + FileX/AlertCircle), open `MissingFileModal` with **Elimina** / **Lascia in elenco**. Mid-play USB unplug / deleted file opens the same modal via `<video onError>`. Never auto-deletes catalog/queue. Remote/YouTube without `localFilePath` and empty/web URLs skip fs. (PR #49)
- **OS filesystem Drag & Drop import** — Drop karaoke media onto Local Library (catalog) or Control queue (catalog + enqueue). Formats: `.mp4`/`.webm`/`.mkv`/`.avi`, `.mp3`+`.cdg`, `.mid`/`.kar`. IPC `library:import-files`, preload `library.importFiles` + `webUtils.getPathForFile`, batch SQLite transaction for multi-file, video thumbnails with yields between files. Overlay only when `dataTransfer.types` includes `Files` (queue reorder unchanged). (PR #47)
- **SoundFont dropdown** — Settings → Audio lists bundled/present banks; **Altro…** opens a file picker for an external `.sf2` / `.sf3`. Selection persists in `midiSoundFontPath` and loads via existing AudioGraphManager / SpessaSynth path (scheduler / latencyHint unchanged). (PR #44)
- **Critical domain invariants source-lock** — `scripts/verify-critical-invariants.js` (pitch-0 SoundTouch bypass, volume², AI MessageEvent unwrap, SIAE ≥120s, queue_cache-only GC, SpessaSynth 5 ms + `latencyHint: 'playback'`, ASAR unpack for `better-sqlite3` / `ffmpeg-static`); wired into `npm test` together with `verify-ai-vocal-path.js`. (PR #41)
- **README AI Context & Critical Invariants** — dual-audience block (human + agents) documenting frozen IPC/Zustand/SQLite contracts and the six absolute guardrails; expanded library citation table. (PR #41)

### Changed
- **Large library scan latency** — Folder scan batch-upserts tracks in one SQLite transaction (prepared statements reused) and no longer runs sync FFmpeg per video on the main thread. Cached/DB thumbnails are reused; missing thumbs generate asynchronously via `execFile` and refresh Local via existing `library:reindexed`. Single-file `download:save-to-library` still generates a sync thumb. IPC contracts unchanged. (PR #46)
- **Library / Web search** — Removed the “Cantante assegnato…” preselect field. Singer assignment happens only in the add-to-queue modal (enqueue / assign). Regia theme chrome unchanged. (PR #43)
- **Safety-First documentation pass (slice 1)** — high-density Why/TSDoc on hot audio, store GC, DownloadManager delete guard, AI worker unwrap, and preload Watchlist surfaces. No IPC / Zustand / SQLite schema / Control↔Stage sync behavior changes. (PR #41)
- **Download completed overlay** — Removed the green dismissible Library overlay badge; completion / errors remain in the header Downloads menu. (PR #42)

### Fixed
- **Download Instrumental yt-dlp HTTP 429** — `--sub-langs all,-live_chat` requested ~130 subtitle languages and YouTube rate-limited the whole download. Use `.*-orig` (original-language auto-subs only; valid Python regex — not bare `*-orig`). (PR #48)
- **AppImage SoundFont path** — Bundled `GeneralUser-GS.sf2` is seeded to `<userData>/soundfonts/` (like ORT/yt-dlp). Persisted `/tmp/.mount_*` AppImage paths are treated as ephemeral and re-resolved on startup so `karaoke://local` no longer 404s. Packaging: top-level `extraResources` ships `public/soundfonts` + `public/ort` **once** (platform blocks only add `bin/` — avoids electron-builder EEXIST/EBUSY double-link). (PR #44)
- **yt-dlp `--sub-langs` invalid regex** — Replaced `en.*,it.*,es.*,fr.*,*-orig` with a valid selector; later tightened to `.*-orig` (PR #48). Log non-zero exit / spawn failures to the structured Logger as well as the Download panel. (PR #40)

### Breaking Changes
- None.

## [1.1.0] — yt-dlp error -1 Download Instrumental (refresh) — 2026-09-18

Overwrite of GitHub Release `v1.1.0` after PR #39 (opaque yt-dlp exit `-1` / relative `-o` staging for Download Instrumental).

### Fixed
- **Download Instrumental yt-dlp “error code -1”** — spawn OS failures (libuv negated errno; EPERM → `-1`) were overwritten by the `close` handler’s opaque message. Preserve the real spawn error; surface yt-dlp `ERROR:` lines on non-zero exits. Use a **relative** `-o` template (`{downloadId}.%(ext)s`) with existing `cwd=userData/temp` (same staging files / AI handoff; no YouTube title in the template).

## [1.1.0] — MDX advanced ETA settings + revert Indigo Regia (refresh) — 2026-09-18

Overwrite of GitHub Release `v1.1.0` after PR #38 (revert Indigo Regia / assigned-singer UX from #36) + PR #35 (UVR-MDX-NET advanced ETA settings for Download Instrumental).

### Added
- **UVR-MDX-NET advanced ETA settings** — When Download Instrumental method is UVR-MDX-NET Karaoke 2 (`aiMdxKaraoke2`), Settings → Audio shows **Impostazioni Avanzate UVR-MDX-NET (Ottimizzazione ETA)** with segment size (default 256), fractional overlap (default 0.25 → `mdxStepSamples`), and an honest ORT WASM CPU acceleration toggle (graph opts + SIMD; ORT remains required). Knobs persist in AppSettings and are omitted from the AI worker payload for Demucs / Roformer / DSP.

### Changed
- **MDX demix hop** — Runtime overlap is the Settings fraction (not hardcoded UVR “Default” `chunk_size - n_fft`); UVR Default remains available via `mdxStepSamples('default')` for geometry helpers / exports.
- **UI** — Reverted Dark Stage Indigo Regia chrome and Library/Web assigned-singer preselect removal (PR #36 via #38).

### Fixed
- None for this change set.

### Breaking Changes
- None.
## [1.1.0] — Stop web search + AI worker MessageEvent IPC (refresh) — 2026-09-18

Overwrite of GitHub Release `v1.1.0` after PR #32 (Interrompi ricerca / cancel stuck YouTube web search) + PR #33 (utilityProcess parentPort MessageEvent unwrap so Instrumental AI `separate` runs).

### Fixed
- **Web search stuck on “Ricerca in corso…”** — no way to recover without restarting. Added **Stop search** (IT/EN/ES/FR): IPC cancel kills the in-flight yt-dlp process tree, clears loading / load-more UI, and ignores late results; a new search aborts any previous child.
- **Instrumental AI silent no-op after ready ping** — child `parentPort.on('message')` receives Electron `{ data, ports }`, not the bare `{ type:'separate', … }` payload, so the worker ignored jobs (`lastPhase: null`, false `ort_silence_timeout`). Unwrap MessageEvent `.data` (bare payloads still work for fork fallback); log worker stdio; lazy-import demucs for HTDemucs only.

## [1.1.0] — Recursive library scan + UVR Default AI chunking (refresh) — 2026-09-18

Overwrite of GitHub Release `v1.1.0` after PR #30 (recursive library subfolder scan) + PR #31 (UVR-aligned MDX chunking / ORT keep-alive).

### Fixed
- **Instrumental AI stuck → timeout** — UVR-MDX Karaoke 2 now uses UVR GUI **Default** overlap (`step = chunk_size - n_fft`) with zero-pad/trim/Hann OLA instead of ~50% triangular windows (~2× fewer ORT runs). Parent keep-alive + 45 min ORT-silence ceiling avoid false idle kills while WASM blocks IPC during `session.run`. Clearer stall/timeout logs; FFT scratch lanes + plan warm-up.
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

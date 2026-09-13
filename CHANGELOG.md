# Changelog — Karaoke Live Station

All notable changes to Karaoke Live Station.

Format follows [Keep a Changelog](https://keepachangelog.com/)-style sections.

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

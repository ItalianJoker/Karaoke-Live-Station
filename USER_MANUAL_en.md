# User Manual — Karaoke Live Station

**Karaoke Live Station** — professional multi-platform station for DJs, KJs, and live karaoke venues.  
Architecture: Electron, React 18, Web Audio DSP, SoundFont/MIDI synthesis, Guest Portal LAN (Express), SQLite catalog.

This document is the complete operator manual (Phases 1–5) in **English**. Intended for the booth / control-room operator.

---

## Table of Contents

1. [Overview and architecture](#1-overview-and-architecture)
2. [Installation and portable paths](#2-installation-and-portable-paths)
3. [Initial setup](#3-initial-setup)
4. [Control console (Regia)](#4-control-console-regia)
5. [Fair Queue, VIP, and cache](#5-fair-queue-vip-and-cache)
6. [Library: search, downloads, and previews](#6-library-search-downloads-and-previews)
7. [Stage screen (Palco)](#7-stage-screen-palco)
8. [Auto-advance and transition pause](#8-auto-advance-and-transition-pause)
9. [Tabbed settings and search](#9-tabbed-settings-and-search)
10. [Keyboard shortcuts](#10-keyboard-shortcuts)
11. [Guest Portal LAN](#11-guest-portal-lan)
12. [SIAE register](#12-siae-register)
13. [Themes and languages (i18n)](#13-themes-and-languages-i18n)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Overview and architecture

Karaoke Live Station runs a karaoke night on **two independent windows** plus a guest portal on the local network.

### 1.1 Control window (Regia — Master)

Full operator console:

- Transport (Play / Pause / Stop / Restart / Next)
- Master volume with a perceptual curve
- Pitch in semitones and speed (time-stretch)
- Guide-vocal removal **(Experimental)** via classical mid/side DSP (algorithmic, realtime)
- Auto-ducking BGM at the microphone
- 16-channel MIDI/KAR mixer
- CUE pre-listen on a secondary device
- Singer queue (Fair Queue), Library & search, SIAE history
- Guest Portal request management

### 1.2 Stage window / Stage screen (Slave)

Display for singer and audience (TV or projector):

- MP4/WebM/MKV video, CD+G graphics, MIDI/KAR lyrics
- Stage audio is **muted** (audio comes only from Control / Master)
- Sync via IPC with Control
- Banners «Ora Canta», «Preparati», «Prossima Esibizione» (Italian UI copy)
- Configurable semitone badge (`showPitchOnStage`)
- Configurable speed badge (`showSpeedOnStage`)
- Fullscreen (F11 / Esc / double-click)

### 1.3 Guest Portal LAN

Built-in web server (Express + Socket.IO) on the venue Wi‑Fi. Guests scan a QR Code and send requests from their phone with no app install.

### 1.4 Single instance (Single Instance Lock)

The application allows **only one running instance**. A second launch is blocked: the new process exits and the already-open Control window is restored and focused. This avoids duplicate Control rooms, audio conflicts, and duplicate Guest Portal ports.

### 1.5 Audio / video flow in brief

1. Control owns the transport and the Web Audio graph.
2. Local media go through the `karaoke://local/` protocol with byte-range streaming (HTTP 206), so Stage can open/close mid-song without desync.
3. Pitch, speed, experimental DSP vocal remover, ducking, normalization, and CUE routing live in Control’s audio graph.
4. MIDI/KAR: parsing → SpessaSynth + SoundFont → 16-channel mixer.
5. Queue advance and the SIAE register are handled in the store; Stage receives state via IPC.

---

## 2. Installation and portable paths

### 2.1 Supported systems

- **Linux** (Ubuntu/Debian, Fedora, Arch and similar)
- **Windows** 10/11 64-bit
- **macOS** 11+ (Apple Silicon and Intel)

Recommended: extended desktop with **two monitors** (Control + Stage) and, if possible, a multi-output USB audio interface to separate Master and CUE headphones.

### 2.2 Application data folder (`userData`)

All app-managed data lives under the Electron `userData` folder (not in `/tmp`):

| Platform | Typical path |
| :--- | :--- |
| Linux | `~/.config/karaoke-live-station/` (or equivalent XDG app name) |
| macOS | `~/Library/Application Support/<App>/` |
| Windows | `%APPDATA%\<App>\` |

Relevant contents:

| Relative path | Contents |
| :--- | :--- |
| `karaoke_station.db` | SQLite database (catalog, singers, SIAE log) in WAL mode |
| `bin/` | Managed binaries, especially **yt-dlp** |
| `temp/` | In-progress downloads |
| `queue_cache/` | Web files not archived to the library, kept while still in queue |
| `thumbnails/` | Generated thumbnails |
| `logs/` | Diagnostic logs |

### 2.3 Managed binaries in `<userData>/bin/`

**yt-dlp** (and other managed binaries) are installed and updated in:

```text
<userData>/bin/yt-dlp      (Linux / macOS)
<userData>/bin/yt-dlp.exe  (Windows)
```

Operational behavior:

1. At startup the app always prefers the copy in `userData/bin/`.
2. If missing or corrupt, it may **seed** from the installed package into `userData/bin/`.
3. Integrity checks (minimum size, executability, `--version` probe).
4. Updates from GitHub Releases only if missing or a newer version exists (does not re-download every launch).
5. Atomic install into `userData/bin/` (temporary sibling file, then replace); on Windows, safe handling of locked files.

**ffmpeg** is resolved from package/bundle/PATH for thumbnails and conversions; yt-dlp remains the web search/download engine.

Under **Settings → Library & Download** you can see yt-dlp status/version and use **Verify / Update** (`Verifica / Aggiorna` in Italian UI).

### 2.4 User media library

The media folder is **not** a silent `userData/library` fallback: it is the **required** `libraryPath` chosen by the operator (often `~/Karaoke` or `C:\Users\<User>\Karaoke`). All saves and automatic archiving use that path exclusively.

---

## 3. Initial setup

At startup, if `libraryPath` is missing or does not exist on disk, the guided setup appears (dialogs are **non-modal** relative to the Chromium parent, so audio is not suspended).

### 3.1 Karaoke Library folder (required)

1. Open **Settings** (gear icon).
2. Tab **Library & Download** (`Libreria & Download`).
3. Item **Karaoke Library Folder** (`Cartella Libreria Karaoke`) → **Browse...** (`Sfoglia...`).
4. Choose the folder with karaoke files (`.mp4`, `.mp3`+`.cdg`, `.mid`, `.kar`, etc.).

Without a folder set:

- downloads with automatic archiving enabled are blocked with the message:  
  **«Imposta la cartella libreria nelle impostazioni prima di scaricare.»** (Italian UI)
- «Salva in Libreria» still requires a valid path.

After choosing, the app can scan and index files in the database. Use **Update Library** (`Aggiorna Libreria`) for a manual rescan.

### 3.2 SoundFont bank (.sf2)

For MIDI/KAR:

1. Tab **Audio & Playback** (`Audio & Riproduzione`) (or General, depending on settings search).
2. **SoundFont Bank Path (.sf2)** (`Percorso Banco SoundFont (.sf2)`).
3. By default a GeneralUser GS SoundFont is included; you can select a custom one.

If not configured, the UI may show **«Nessun SoundFont (.sf2) configurato»** (Italian UI).

### 3.3 Master and CUE audio devices

| Setting | Use |
| :--- | :--- |
| **Main Output Device (Stage Master)** (`Dispositivo Uscita Principale (Master Palco)`) | PA / room speakers |
| **Pre-listen Output Device (CUE Headphones)** (`Dispositivo Uscita Pre-ascolto (Cuffie CUE)`) | Operator headphones for previews without disturbing the room |

Configure them before the event. CUE uses `setSinkId` routing on the secondary card.

### 3.4 Firewall (Guest Portal)

On first run, allow Karaoke Live Station through the firewall (**private** networks). Settings include the **Firewall & LAN Connection Assistant** (`Assistente Firewall & Connessione LAN`) with diagnosis and ready commands (Windows / macOS / Linux UFW / Firewalld). See also the [Troubleshooting section](#14-troubleshooting).

### 3.5 Quick pre-show checklist

1. `libraryPath` set and library updated  
2. SoundFont OK (if you use MIDI)  
3. Master + CUE correct  
4. Stage open on the second monitor (`P` / **Reopen Stage** / `Riapri Palco`)  
5. Guest Portal active and firewall OK (if using smartphone requests)  
6. Fair Queue and auto-advance options as preferred  

---

## 4. Control console (Regia)

Control is organized into three main tabs on the right: **Singer Queue** (`Coda Cantanti`) (`1`), **Library & Search** (`Libreria & Ricerca`) (`2`), **History** (`Storico`) (`3`). The player and audio controls stay available at the top/center.

### 4.1 Transport

| Control | Shortcut | Behavior |
| :--- | :--- | :--- |
| Play / Pause | `Space` (`Spazio`) | Starts or pauses the loaded track |
| Stop | `S` | Stops, rewinds to 0:00, stops DSP/MIDI |
| Restart | `R` | Returns to 0:00 without removing the track from the queue |
| Next Track | `N` | Evaluates SIAE log and advances to the next |
| Seek | `←` / `→` or scrubber | ±5 seconds; Stage realigns |

**Starting from the queue:** on the first track (or with double-click) the hint appears:

> **Doppio click o Play per avviare** (Italian UI)

You can start/pause with the Play button on the first row, or double-click a track in the queue.

**Save to Library:** if the track comes from the web or from `queue_cache`, **Salva in Libreria** appears on the queue row and in the player header, to promote it into the permanent library folder.

### 4.2 Perceptual volume

The Master Volume slider uses a **psychoacoustic quadratic** curve:

\[
Gain = volume^2 \quad (volume\ from\ 0\ to\ 1)
\]

Examples: 100% → full gain; 50% → gain 0.25 (about −12 dB, perceived half loudness); 0% → silence.

- Changes use an **anti-click ramp ~50 ms** (no speaker “thump”).
- **Mute** (`M`): mutes master while keeping the fader position.
- Arrow keys `↑` / `↓`: volume ±5%.
- Optional: **Audio Volume Normalization** (`Normalizzazione Volume Audio`) (automatic leveling across different tracks).

### 4.3 Pitch (semitones) and speed

- **Key:** from **−8 to +8** semitones (`+` / `-` or `Ctrl+↑` / `Ctrl+↓`).
- Pitch is tied to the **queue instance** (and the singer’s pitch memory): it stays stored for that performance.
- At 0 semitones the engine can bypass the shifter (minimal latency/CPU).
- **Speed:** from **0.50× to 1.50×** without changing pitch (WSOLA / SoundTouch). `Ctrl+←` / `Ctrl+→` adjust by ±5%. Clicking the numeric indicator often resets to 1.00×.
- MIDI: transposition acts on note numbers in real time.

### 4.4 Guide-vocal removal (Experimental)

The **`V`** key / **Vocal Remover (Experimental)** control enables the method chosen in **Settings → Audio**:

| Method | Notes |
| --- | --- |
| `centerCancelBassKeep` / `centerCancel` / `softMid` | Classical **realtime** mid/side DSP — light, no download |

On YouTube search results, **Download Instrumental** (when the title does not already contain “Karaoke” or “instrumental”) downloads the video, applies the same algorithm offline via ffmpeg, and saves an instrumental MP4 to the library (burns subtitles when available).

### 4.5 Auto-ducking BGM

**Auto-Ducking BGM** (`D`): automatically lowers background music when the microphone is detected/activated for announcements, then restores the level. Ideal for intros between tracks.

### 4.6 16-channel MIDI mixer

With `.mid` / `.kar` files the **MIDI Channel Mixer** (`Mixer Canali MIDI`) appears:

- Real-time note activity
- Per-channel mute (e.g. **Guide Vocal (Ch 4)** / `Guida Vocale (Ch 4)`, **Bass (Ch 2)** / `Basso (Ch 2)`, **Drums (Ch 10)** / `Batteria (Ch 10)`)
- Hot changes without interrupting SpessaSynth synthesis

### 4.7 CUE pre-listen

Use **Headphone Pre-listen (CUE)** (`Pre-ascolto Cuffie (CUE)`) to listen on headphones while the room hears Master. Configure the CUE device in Settings.

In **Library**, the Pre-Listen button opens the **themed preview modal** (same look as Settings) and routes audio to the CUE device. There is no separate volume bar: mute/volume stay on the embedded player controls (or MIDI transport). If CUE and Main Output are the same device, unmuting shows a confirmation warning so preview audio is not mixed onto the room PA by mistake — including the **Web-search YouTube embed**, which uses the same themed confirm modal as local video/audio/MIDI.

### 4.8 Queue persistence and crash recovery

The setlist (tracks, singers, keys, positions) is saved in local persistence. After close or crash, on reopen the queue returns with the first track ready paused at 0:00.

---

## 5. Fair Queue, VIP, and cache

### 5.1 Fair Queue (default ON)

**Fair Queue Algorithm Active** (`Algoritmo Fair Queue Attivo`) is **enabled by default** (`enableFairQueue: true`).

Position is computed from:

- number of songs already sung by the participant
- request time

Goal: prevent a few singers from monopolizing the night. Those who have sung less rise in priority.

With Fair Queue on, on insert you can choose:

- **Automatic position (Fair Queue)** (`Posizione automatica (Fair Queue)`) — the algorithm places the track
- **At the end of the queue** (`In fondo alla coda`) — fixed last place

**Restore automatic queue** (`Ripristina coda automatica`) recomputes the ideal order after drag & drop or manual overrides (useful if `queue.length > 2`).

### 5.2 VIP and manual management

- **VIP Priority:** force priority for special guests / celebrations.
- **Drag & Drop:** reorder waiting items; the playing track stays locked at the head.
- **Assign Singer** (`Assegna Cantante`) / singer management: unique names (case-insensitive check) so Fair Queue works correctly.
- **Singer key memory:** re-applies the preferred key when the track starts playing.
- **Clear queue:** requires confirmation (**«Sei sicuro di voler svuotare l'intera scaletta della coda?»** — Italian UI); stops playback.

### 5.3 Automatic archiving and `queue_cache`

| Setting | Default | Effect |
| :--- | :--- | :--- |
| **Automatic Archiving of Web Downloads to Library** (`Archiviazione Automatica Download Web in Libreria`) | **ON** | Downloads go to the permanent library (`libraryPath`) |
| OFF (after confirmation) | — | Downloads stay in `<userData>/queue_cache/` |

Disabling archiving shows a mandatory modal:

**Title:** «Attenzione disattivazione archiviazione automatica» (Italian UI)

**Body:**  
«Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata.» (Italian UI)

Confirm with **Confirm deactivation** (`Conferma disattivazione`).

### 5.4 Cache persistence and Garbage Collection

- Files in `queue_cache` **survive restarts** if the track is still in the queue.
- **GC on dequeue:** the file is deleted from disk only when no queue entry references it anymore (end of performance, single removal, clear queue).
- **Salva in Libreria** promotes the file from cache to the library folder and updates paths/`uri` for offline use.
- Download deduplication: before downloading again, the app looks for matches in library / `queue_cache` / catalog (YouTube id, fingerprint, `Artist - Title`). On hit: **«Brano già presente in locale...»** (localized) appears in the **Downloads** menu (not as an out-of-queue toast), with no new network download.

---

## 6. Library: search, downloads, and previews

Tab **Library & Search** (`Libreria & Ricerca`) (`2` or `Ctrl+F`).

### 6.1 Live local search

- **Local** mode (scope independent from Web search)
- **Continuous** filter while typing (`onChange`) on title, artist, code
- Matching is **case- and accent-insensitive** (e.g. `moriro da re` matches `morirò da re`; accented queries still work)
- Distinct empty states:
  - **«Libreria vuota. Scansiona una cartella o cerca sul web.»** (Italian UI)
  - **«Nessun brano corrisponde alla ricerca locale.»** (Italian UI)
- **Update Library** (`Aggiorna Libreria`) rescans `libraryPath` and updates the SQLite catalog
- Query, results, loading, and scroll for **Local** and **Web** are **separate** (scoped hook): switching tabs does not lose state or fire unwanted YouTube searches; persisted in `sessionStorage` for the session; right-hand tabs stay mounted (hidden)

### 6.2 Web search (YouTube)

- **Web / YouTube** mode (scope independent from Local search)
- Type and press **Enter** (not search-on-every-key)
- Engine: **yt-dlp** from `<userData>/bin/`
- Placeholder: **«Cerca brano su YouTube Karaoke...»** (Italian UI)
- Empty: **«Nessun risultato web. Digita e premi Invio per cercare su YouTube.»** (Italian UI)

### 6.3 YouTube preview (anti error 153)

The preview modal embeds video from `youtube-nocookie.com` with anti-block parameters:

- `playsinline=1`
- `enablejsapi=1`
- `origin` and `widget_referrer` (window origin)
- `rel=0`
- `modestbranding=1`
- `referrerPolicy="strict-origin-when-cross-origin"`
- muted autoplay in preview
- same-device unmute confirm (CUE === Main Output) via YouTube IFrame API + themed modal

This reduces the embed **153** error typical of restrictive YouTube iframes.

With **auto-archive** ON, **Add to queue** from YouTube waits for download + library save, then runs a **full Local reindex** (including ffmpeg thumbnail) **before** enqueueing the local file — so the track appears in Local with the correct cover without a manual “Refresh Library”.

### 6.4 Download and «Download completato» badge

1. Start the download from the web result.
2. Progress under **Download in Progress** (`Download in Corso`).
3. On completion (after a short ~450 ms delay from the progress list) a dismissible badge appears:

> **Download completato** (Italian UI)

Close it with the manual **X**.

4. If auto-archive is ON and `libraryPath` is valid → file in library + immediate reindex.  
5. If auto-archive is OFF → file in `queue_cache` (promotable with **Salva in Libreria**).  
6. Errors: persistent toast **«Download fallito: …»** (Italian UI).
7. **Add to queue from YouTube with auto-archive ON**: the app waits until download **and** archive succeed, refreshes Local, then enqueues the **local library file** (not a remote/temp pointer). On failure, an error toast is shown and **no** non-playable queue item is left.

Covers/thumbnails and local previews update without restart (ffmpeg extracts a frame ~at second 4 for local files; YouTube provides web thumbs).

### 6.5 Previews / covers and versions

- 16:9 thumbnails in the list
- Version chip (e.g. KaraFun, Sing King, With Choirs, Instrumental…)
- Click thumbnail / preview icon → **Preview and Version Check** (`Anteprima e Controllo Versione`) with scrubber, file path, add to queue and assign singer
- The **Pre-Listen** button opens the same themed modal with audio on the CUE device (see §4.7)
- With Fair Queue on, Fair vs end-of-queue position choice also from the preview

### 6.6 Delete from library

Local catalog tracks offer **Delete from library** (`Elimina dalla libreria`) with confirmation (**«Eliminare il brano?»** / **Delete this track?**). The action:

1. Removes the row from the SQLite catalog.
2. Deletes from disk **only** permanent files under the library folder (`libraryPath`); it does not delete files in `queue_cache` / `temp` / incomplete downloads.

A success or error toast follows confirmation.

---

## 7. Stage screen (Palco)

### 7.1 Ready handshake

Stage opens hidden (`show: false`) with a black background. Before showing:

1. Waits for fonts and stylesheets
2. Double `requestAnimationFrame`
3. Signals `signalStageReady()` to the main process

So no flash of raw layout appears. If you close Stage, **Reopen Stage** (`Riapri Palco`) or key **`P`** recreates and resyncs it. Closing Control also closes Stage.

### 7.2 Semitone badge and `showPitchOnStage`

Setting **Show key change on the stage screen** (`Mostra variazione tonalità sullo schermo del palco`) (`showPitchOnStage`, typically default ON):

- Shows the badge with semitone offset: **`+N`**, **`-N`**, or **`0`**
- The value **0** is still shown when the toggle is on (the singer sees there is no transposition)
- UI description: «Visualizza il badge con i semitoni di variazione (+/-) sullo schermo del palco per il cantante.» (Italian UI)

### 7.2a Custom Stage message backgrounds

In **Settings → Stage Screen**, each overlay message (Now Singing, Get Ready, Up Next on Stage, …) can set:

- custom text, bold/italic, font size, enable/disable
- **Stage background while shown**: none (keep theme/video), solid color, or image

The backdrop applies **only while that message is visible**. When the banner/card hides (or the message is disabled), Stage restores the normal theme/video background without restarting.

### 7.2b Speed badge and `showSpeedOnStage`

Setting **Show playback speed on stage screen** (`Mostra velocità di riproduzione sullo schermo del palco`) (`showSpeedOnStage`, typically default ON):

- Shows the speed badge (e.g. **`1.00x`**, **`1.25x`**)
- UI description: «Visualizza il badge della velocità di riproduzione (es. 1.00x, 1.25x) sullo schermo del palco per il cantante.» (Italian UI)

### 7.3 Fullscreen and layout

- **`F11`** / **`Esc`** with focus on Stage
- Double-click (or two quick clicks) for borderless fullscreen
- Edge-to-edge video; floating title/artist that fades out (configurable duration, typically 8 s)
- Thin progress bar on the bottom edge
- Banners: **Ora Canta**, **Preparati**, **Prossima Esibizione** / **A seguire** (Italian UI; timings in Settings → Stage Screen)

### 7.4 Content supported on Stage

- Karaoke video (MP4/WebM/MKV)
- CD+G / MP3+G (Canvas)
- MIDI/KAR with synced lyrics (audio from Control)

---

## 8. Auto-advance and transition pause

| Setting | Default | Notes |
| :--- | :--- | :--- |
| **Auto-Advance to Next Track** (`Avanzamento Automatico al Prossimo Brano`) (`autoAdvanceNext`) | **OFF** | The operator decides when to start the next one |
| **Track Transition Pause (Sec)** (`Pausa Transizione Brani (Sec)`) (`transitionPauseSec`) | **3** | Active/useful when auto-advance is ON |

### Behavior with auto-advance OFF (default)

At natural end of the track the queue moves to the next **paused at 0:00**. The operator presses Play (or uses «Doppio click o Play per avviare») to continue. Ideal for live nights with announcements and mic.

### Behavior with auto-advance ON

After the end (and after any countdown **«Prossimo brano tra Xs...»** based on `transitionPauseSec` — Italian UI) the next track starts automatically.

---

## 9. Tabbed settings and search

Open **System Settings** (`Impostazioni di Sistema`) (gear). At the top: field **«Cerca impostazioni...»** (Italian UI).

### 9.1 Tabs

| Tab | Typical contents |
| :--- | :--- |
| **General** (`Generale`) | Control/Stage themes, language, Fair Queue, Guest Portal, SIAE, project support |
| **Library & Download** (`Libreria & Download`) | `libraryPath`, automatic archiving (+ warning), yt-dlp status/update |
| **Audio & Playback** (`Audio & Riproduzione`) | SoundFont, Master/CUE, A/V sync, normalization, **vocal remover algorithm (experimental)**, default vocal remover/ducking, auto-advance, `transitionPauseSec` |
| **Stage Screen** (`Schermo Stage`) | Intro/outro banners, title overlay, next singer in intro, **`showPitchOnStage`**, **`showSpeedOnStage`**, **custom Stage message text/style/background** |
| **Shortcuts** (`Scorciatoie`) | Full live-shortcut inventory (same list as the **?** / F1 panel), searchable |

Search filters labels/descriptions **across all categories** (including Shortcuts in **parity** with the **?** guide); matching is case- and accent-insensitive. Clearing the field returns to tab navigation. No setting is removed by the tab reorganization.

### 9.2 Other useful options

- Audio/video sync offset (ms)
- Intro banner duration / «Preparati» outro trigger
- On-screen title duration
- Show next singer at the start of the track
- Diagnostic log level and open log folder/file
- Export SIAE Register (CSV) from settings as well as from History

Save with **Save and Close** (`Salva e Chiudi`).

---

## 10. Keyboard shortcuts

Open the guide anytime with **`F1`** or **`?`**. Live shortcuts are registered with **cleanup** on component unmount (no orphan listeners after closing modals / changing view).

### 10.1 Playback and setlist

| Key | Action |
| :--- | :--- |
| `Space` (`Spazio`) | Play / Pause |
| `S` | Stop (rewind and stop) |
| `R` | Restart from 0:00 |
| `N` | Next track |
| `←` / `→` | Seek ±5 s |

### 10.2 Audio and DSP

| Key | Action |
| :--- | :--- |
| `M` | Mute master |
| `↑` / `↓` | Volume ±5% |
| `+` / `-` | Pitch ±1 semitone |
| `Ctrl+↑` / `Ctrl+↓` | Pitch ±1 semitone |
| `Ctrl+←` / `Ctrl+→` | Speed ±5% |
| `V` | Guide-vocal removal DSP (experimental) |
| `D` | Auto-ducking BGM |

### 10.3 Navigation and screens

| Key | Action |
| :--- | :--- |
| `1` | Singer Queue tab |
| `2` | Library & Search tab |
| `3` | SIAE History tab |
| `Ctrl+F` | Open Library and focus the search field |
| `P` | Reopen / focus Stage screen |
| `F11` / `Esc` | Stage fullscreen (with focus on Stage) |
| `Esc` | Also closes modals/dialogs in Control |
| `F1` / `?` | Shortcut guide |

Tooltips on Control controls show the same combinations for at-a-glance use.

---


Also documented in Settings → Shortcuts and the **?** / F1 help panel (same inventory): Stop (`S`), Restart (`R`), seek arrows, Ctrl+arrows for pitch/speed, experimental Vocal remover (`V`), Ducking (`D`), tabs `1`/`2`/`3`, Stage (`P`), help (`F1`/`?`). Stage fullscreen uses `F11`/`Esc` on the Stage window.

## 11. Guest Portal LAN

### 11.1 Activation

1. Control PC on the same Wi‑Fi as guests.
2. Enable **Guest Portal LAN for Smartphone Requests** (`Guest Portal LAN per Richieste da Smartphone`) in Settings (typical port **3000**, fallback 3001–3010 if busy).
3. Open the QR Code from the Control bar / guest requests.
4. Typical URL: `http://192.168.x.x:3000`.

### 11.2 Guest flow

1. Scan the QR (iOS/Android, no app).
2. Search the **local catalog** (only tracks actually in the library; no arbitrary free text; accent-insensitive).
3. Enter name and key (typically −4 to +4 semitones on the guest side).
4. Send the request.

### 11.3 Operator flow

- **Guest Requests** badge (`Richieste Guest`) in Control.
- **Approve** (`Approva`) → insert into queue (Fair Queue if on) with requested key.
- **Reject** (`Rifiuta`) → discard without touching the setlist.

### 11.4 Firewall and Wi‑Fi

Use the built-in assistant. Also verify that router **AP Isolation / Client Isolation** is **off**, otherwise phones cannot reach the Control PC even on the same network.

---

## 12. SIAE register

Tab **History** (`Storico`) (`3`) — **Performance History** (`Storico Esecuzioni`) / borderò.

### 12.1 When a performance is logged

A track enters the register if:

1. it reaches **natural end**, or  
2. it is stopped/skipped (`S` / `N` / stop) after at least **120 seconds** of playback.

Under 120 seconds (false start, test, immediate skip) it is **not** logged.

### 12.2 Anti-duplicates

Flag **`alreadyLogged`** on the queue instance: one row per performance even if after 120 s there are further stop/next actions.

### 12.3 Data and export

- SQLite persistence (`siae_logs`)
- **ISO 8601 timestamp** + epoch milliseconds
- Title, artist, singer, effective duration
- Search filter: title / artist / singer (accent-insensitive)
- **Export SIAE (CSV)** (`Esporta SIAE (CSV)`) with ISO date/time and timestamp columns
- **Clear History** (`Svuota Storico`) with safety confirmation

Enable/disable collection with **Automatic SIAE Register** (`Registro SIAE Automatico`) in Settings.

---

## 13. Themes and languages (i18n)

### 13.1 Graphic themes (9)

Independent themes for Control (`themeHost`) and Stage (`themeStage`):

1. Dark Stage (Default)  
2. Midnight Neon (Cyberpunk)  
3. Club Gold (VIP Lounge)  
4. Ocean Breeze (Deep Cyan)  
5. Sunset Crimson (Warm Red)  
6. Emerald Matrix (Live Green)  
7. Royal Amethyst (Deep Purple)  
8. High Contrast (Accessible)  
9. Light Studio (Clean)  

### 13.2 Languages

Full interface in:

- **Italiano** (`it`)
- **English** (`en`)
- **Español** (`es`)
- **Français** (`fr`)

At startup: system language detection (autodetect) with fallback. Change language in **Settings → Interface Language** (`Impostazioni → Lingua Interfaccia`) without restart; preference is persistent.

Translation files are in `locales/it.json`, `en.json`, `es.json`, `fr.json`.

---

## 14. Troubleshooting

### 14.1 Firewall / Guest Portal unreachable

1. Open Settings → Firewall Assistant; refresh the diagnosis.
2. **Windows:** Allow the app on private networks; if needed, rule TCP ports 3000–3010 (`netsh` / PowerShell as on the card).
3. **macOS:** Allow incoming connections for Karaoke Live Station (Firewall → Options).
4. **Linux:** `ufw allow 3000:3010/tcp` or equivalent Firewalld rule (commands copyable from the card).
5. Verify router **AP Isolation** = OFF.
6. Same Wi‑Fi subnet between PC and phones; try the URL shown in the QR from a phone browser.

### 14.2 yt-dlp / web downloads not working

1. Check that `<userData>/bin/yt-dlp` (or `.exe`) exists.
2. In Settings → Library & Download: engine status and **Verify / Update** (`Verifica / Aggiorna`).
3. Do not move yt-dlp to `/tmp` or outside `userData/bin/`: the app only manages the managed path.
4. Check logs in `<userData>/logs/`.
5. If you see «Non installato (verrà scaricato automaticamente)» (Italian UI), wait for bootstrap or force update with network available.

### 14.3 Library not configured

Symptoms: cannot download/archive; message **«Imposta la cartella libreria nelle impostazioni prima di scaricare.»** (Italian UI); failing saves.

Solution: Settings → **Cartella Libreria Karaoke** → Browse → existing folder → Update Library. Do not rely on a hidden `userData/library` folder.

### 14.4 Stage will not open / stays black

1. Press **`P`** or **Riapri Palco**.
2. Wait for the ready handshake (font/CSS); avoid forcing content before the ready signal.
3. Verify the second monitor is active in the OS extended desktop.
4. Retry fullscreen (F11 / double-click on Stage).
5. If HDMI/projector disconnects, restore the cable: the app may reattach; if in doubt reopen Stage.
6. Check you did not start a second instance (single-instance: use the already-open Control).

### 14.5 No audio or wrong device

- Check **Master** and **CUE** in Settings.
- Check mute (`M`) and volume (quadratic curve: below 50% is already quite low).
- MIDI: confirm SoundFont loaded.
- Vocal remover DSP: effect is immediate and light; if the stereo mix has little center vocal, the result may be subtle — try another algorithm in Settings → Audio.

### 14.6 Pitch / speed badges on Stage

- If the singer does not see semitones: enable **Mostra variazione tonalità sullo schermo del palco**.
- If the singer does not see playback speed: enable **Mostra velocità di riproduzione sullo schermo del palco**.
- Expected: `+2`, `-1`, `0`, and e.g. `1.00x` / `1.25x` based on the queue.

### 14.7 YouTube preview error 153

The embed already uses `youtube-nocookie` and anti-153 parameters. If it persists: update the app, check network/DNS, retry preview; for the show, download the track locally.

### 14.8 Queue / cache that “vanishes” from disk

With automatic archiving **OFF**, files in `queue_cache` are deleted on **dequeue**. To keep them: **Salva in Libreria** or re-enable automatic archiving (recommended default).

### 14.9 Diagnostic logs

Settings → Diagnostics & Log Files: level, open folder/file, clear logs. Useful for support tickets (streaming errors, yt-dlp, Stage).

---

## Appendix A — Italian UI strings reference

| Context | String |
| :--- | :--- |
| Queue hint | Doppio click o Play per avviare |
| Download | Download completato |
| Warning auto-archive (title) | Attenzione disattivazione archiviazione automatica |
| Warning auto-archive (body) | Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata. |
| Library error | Imposta la cartella libreria nelle impostazioni prima di scaricare. |
| Save | Salva in Libreria |
| Fair Queue | Fair Queue ATTIVO / Ripristina coda automatica |
| Stage | Ora Canta / Preparati / Prossima Esibizione |
| Settings tabs | Generale · Libreria & Download · Audio & Riproduzione · Schermo Stage · Scorciatoie |

---

## Appendix B — Operational defaults

| Setting | Default |
| :--- | :--- |
| Fair Queue | ON |
| Automatic web archiving | ON |
| Auto-advance next track | OFF |
| Transition pause | 3 s |
| showPitchOnStage | ON |
| showSpeedOnStage | ON |
| Guest Portal port | 3000 |
| SIAE log threshold | ≥ 120 s or natural end |
| Control pitch range | −8 … +8 ST |
| Speed range | 0.50× … 1.50× |
| Theme | dark-stage |

---

## License

Karaoke Live Station is released under the **GNU Affero General Public License v3 (AGPLv3) or any later version**. Full text: [`LICENSE`](./LICENSE).

---

*End of User Manual — Karaoke Live Station (Phase 6, EN documentation).*

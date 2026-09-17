# 🎤 Karaoke Live Station v1.1.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v110-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.1.0 (refresh)

Aggiornamento della release **v1.1.0** (overwrite GitHub): **fix velocità/ETA download** + **timeout AI «Rimozione voce»** (timeout scalato, heartbeat, ORT wasmBinary) + impostazioni separate live/strumentale + annulla download + AI strumentale + menu Download + ricerca senza accenti.

> **In corso (prossimo refresh):** fix barra «Rimozione voce» bloccata al ~45%, **Carica altri video** in ricerca YouTube, **Pulisci coda** nel menu Download.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa refresh

### 📶 Velocità e tempo rimanente nel menu Download
- Progresso yt-dlp corretto (`KLSPROG` / `--progress`): il menu mostra **velocità** e **ETA** durante il download.

### ⏱️ Scarica strumentale — AI senza false timeout
- Timeout AI scalato sulla durata del brano; watchdog idle su heartbeat di progresso.
- ORT WASM caricato in memoria nel utility worker (evita hang `file://`).
- ETA di conversione durante «Rimozione voce»; **Annulla** invariato; modelli aggiornati solo se più nuovi in `userData/models`.

### 🎛️ Impostazioni vocali separate (live vs strumentale)
- **Rimozione Vocale live** (`V`): solo algoritmi DSP in Impostazioni.
- **Metodo Scarica strumentale**: menu dedicato (AI + DSP); default **UVR-MDX Karaoke 2**. L’AI non guida mai il live.

### ⏹️ Annulla download
- Il pulsante interrompi nel menu Download ferma yt-dlp (albero processi), conversione ffmpeg e job AI/modello, anche in fase strumentale.

### 🎙️ Rimozione Vocale live — solo DSP
- Pulsante Regia / tasto `V`: mid/side algoritmico (`centerCancelBassKeep`, `centerCancel`, `softMid`).
- **Niente** spinner «Separazione…» né fader dual-stem live.

### 🤖 Scarica strumentale — AI offline (selezionabile)
- Impostazioni → Audio: UVR-MDX Karaoke 2 / HTDemucs / BS-Roformer (oltre al DSP).
- Modelli in `userData/models/`; aggiornamento solo se mancanti, corrotti o catalogo più nuovo (URL/SHA/version).
- Pipeline: yt-dlp → ensure modello → separazione AI (utility process) o DSP → remux (+ lyric burn se possibile) → libreria `(Instrumental)`.
- Toast di avviso all’avvio (più lungo / più risorse di un download normale).

### 📥 Menu Download + concorrenza
- Progresso attivo/in coda nel menu Download a sinistra di Impostazioni (niente alert sopra le righe brani).
- Impostazione **Download simultanei massimi** (pool condiviso normale + strumentale).

### 🔎 Ricerca senza accenti
- Query senza diacritici trovano titoli accentati (es. `moriro` → *morirò*) su Local, Web, coda, cronologia, Impostazioni e scorciatoie.

### 🔇 Conferma unmute anteprima YouTube (stesso dispositivo)
- Embed YouTube ricerca Web / Pre-Ascolto: stesso modale tematico se CUE === Uscita Principale.

### 🖼️ Archiviazione automatica → thumbnail Local
- Reindex completo Local (scan + cover ffmpeg) **prima** di accodare il file locale.

### 🖼️ Icona ufficiale ovunque
- Packaging Windows / Linux / macOS con logo ufficiale `public/logo.png`.

### 📥 YouTube → coda con archiviazione automatica
- Con archiviazione ON, **Metti in coda** attende download **e** archivio, aggiorna Locale, accoda il **file locale**.

### 🎧 Pre-Ascolto tematico (CUE)
- Modale anteprima tematico sul dispositivo CUE; avviso stesso-dispositivo all’unmute.

### 🗑️ Elimina dalla libreria
- Conferma tematica; rimozione catalogo; cancellazione disco solo sotto `libraryPath`.

### 🎭 Stage & ricerca
- Sfondi per-messaggio; scorciatoie allineate a **?** / F1; ricerca Local/Web separata; badge velocità Stage.

### 🛠️ CI — retry install
- Retry `npm ci` con backoff (bash su tutte le piattaforme) per download intermittenti di `ffmpeg-static`.

### 📜 Licenza
- Progetto sotto **GNU AGPLv3 or later** (`AGPL-3.0-or-later`).

---

<a name="v110-english"></a>
# 🇬🇧 Release Notes — Version 1.1.0 (refresh)

GitHub Release **v1.1.0** overwrite: **download speed/ETA fix** + **Instrumental AI “Rimozione voce” timeout** (scaled timeout, heartbeats, ORT wasmBinary) + split Settings live/instrumental + working cancel + Instrumental AI + Download menu + accent-insensitive search.

> **Upcoming refresh:** fix AI progress stuck at ~45%, YouTube **Load more videos**, Download menu **Clear downloads**.

## 📦 Installers

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this refresh

### 📶 Download menu speed + remaining time
- Correct yt-dlp progress parsing (`KLSPROG` / `--progress`): the Download menu shows **speed** and **ETA** while downloading.

### ⏱️ Download Instrumental — AI without false timeouts
- AI hard timeout scales with track length; idle watchdog resets on progress heartbeats.
- ORT WASM loaded in-memory in the utility worker (avoids `file://` hangs).
- Conversion ETA during “Removing vocals…”; **Cancel** unchanged; models update only if newer under `userData/models`.

### 🎛️ Split vocal settings (live vs instrumental)
- **Live Rimozione Vocale** (`V`): algorithmic DSP methods only in Settings.
- **Download Instrumental method**: separate dropdown (AI + DSP); default **UVR-MDX Karaoke 2**. AI never drives live playback.

### ⏹️ Cancel download
- The Download menu interrupt button stops yt-dlp (process tree), ffmpeg conversion, and AI/model jobs — including during instrumental post-process.

### 🎙️ Live Vocal Remover — DSP only
- Control button / `V`: algorithmic mid/side (`centerCancelBassKeep`, `centerCancel`, `softMid`).
- **No** “Separating…” spinner or live dual-stem fader.

### 🤖 Download Instrumental — selectable offline AI
- Settings → Audio: UVR-MDX Karaoke 2 / HTDemucs / BS-Roformer (plus DSP options).
- Models under `userData/models/`; update only when missing, corrupt, or catalog newer (URL/SHA/version).
- Pipeline: yt-dlp → ensure model → AI (utility process) or DSP separate → remux (+ lyric burn when possible) → library `(Instrumental)`.
- Non-blocking toast on start (longer / heavier than a normal download).

### 📥 Download menu + concurrency
- Active/queued progress in the Download menu left of Settings (no alert list above song rows).
- **Max simultaneous downloads** setting (shared pool for normal + instrumental).

### 🔎 Accent-insensitive search
- Unaccented queries match accented titles (e.g. `moriro` → *morirò*) across Local, Web, queue, history, Settings, and shortcuts.

### 🔇 YouTube preview unmute confirm (same device)
- Web-search / Pre-Listen YouTube embed: same themed confirm when CUE === Main Output.

### 🖼️ Auto-archive → Local thumbnails
- Full Local reindex (scan + ffmpeg cover) before enqueueing the archived local file.

### 🖼️ Official logo as app icon everywhere
- Windows / Linux / macOS packaging use official `public/logo.png`.

### 📥 YouTube → queue with auto-archive
- With auto-archive ON, waits for download **and** archive, refreshes Local, enqueues the **local library file**.

### 🎧 Themed Pre-Ascolto (CUE)
- Themed preview modal on the CUE device; same-device unmute warning.

### 🗑️ Delete from library
- Themed confirm; catalog removal; disk delete only under `libraryPath`.

### 🎭 Stage & search
- Per-message backgrounds; shortcuts aligned with **?** / F1; scoped Local/Web search; Stage speed badge.

### 🛠️ CI — install retries
- `npm ci` retry with backoff (`shell: bash` on all platforms) for flaky `ffmpeg-static` downloads.

### 📜 License
- Project licensed under **GNU AGPLv3 or later** (`AGPL-3.0-or-later`).

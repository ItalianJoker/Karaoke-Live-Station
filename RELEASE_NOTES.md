# 🎤 Karaoke Live Station v1.1.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v110-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.1.0 (refresh)

Aggiornamento della release **v1.1.0** (overwrite GitHub): **scan libreria ricorsivo** (sottocartelle) + **AI strumentale UVR Default overlap / keep-alive ORT** + race worker extract WAV + sync Web dopo Elimina + avvisi Download nel menu + log debug AI + naming WAV + Actions Node 24 + staging Instrumental + path `//home/...` + SoundFont + progresso ~45% + Carica altri / Pulisci coda + velocità/ETA + timeout AI + impostazioni separate + annulla + AI strumentale + ricerca senza accenti.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa refresh

### 📂 Libreria — scan ricorsivo sottocartelle
- **Aggiorna Libreria** / reindex all’avvio e il match «già su disco» nei download percorrono tutte le sottocartelle relative sotto `libraryPath` (stessi filtri audio/video / Instrumental / file incompleti; id basati sul path evitano doppi conteggi).

### ⏱️ Scarica strumentale AI — chunking UVR Default + keep-alive ORT
- UVR-MDX Karaoke 2 usa overlap **Default** UVR (`step = chunk_size - n_fft`) con zero-pad/trim/Hann OLA al posto di finestre triangolari ~50% (~2× meno run ORT).
- Keep-alive parent + tetto 45 min di silenzio ORT evitano false idle kill mentre WASM blocca l’IPC durante `session.run`; log stall/timeout più chiari.

### 🎙️ Scarica strumentale AI — race worker / extract WAV
- Il job `separate` parte solo dopo il ready-ping del utility worker (niente post prematuro durante l’import ORT).
- Verifica che `{id}.instrumental.extract.wav` esista prima del remux; coerce metodo strumentale (non live DSP).
- Test mock pipeline: `scripts/verify-ai-instrumental-extract.js`.

### 🔍 Ricerca Web — Download di nuovo dopo Elimina
- Dopo Elimina dalla libreria, le righe Web tornano a `youtube` (match id / path / prefisso filename) così ricompaiono Download / Scarica strumentale senza ri-cercare.

### 📥 Menu Download — avvisi manuali in coda
- «Già in libreria» e errori download manuali vanno sulle righe del menu Download (non toast fuori coda); tono ambra e auto-apertura menu.

### 🧪 Scarica strumentale AI — log debug + naming WAV
- Log `debug` più ricchi lungo la pipeline Instrumental (extract / modello / ORT / remux / cleanup), senza segreti.
- Extract demux: `{id}.extract.wav` (stem dell’MP4 sorgente); output AI: `{id}.instrumental.extract.wav`; cleanup temp per `downloadId`.

### 🛠️ CI — Actions su runtime Node 24
- `actions/checkout`, `setup-node`, `upload-artifact` aggiornati a major Node 24; toolchain app resta su Node 20.

### 📥 Scarica strumentale — staging originale affidabile
- yt-dlp scrive l’MP4 originale in **`userData/temp`** (su Linux AppImage: `~/.config/karaoke-live-station/temp/`), non nella cartella libreria.
- Risoluzione Destination/Merger più robusta (path relativi, Merger senza virgolette, niente frammenti `.f###`); se manca l’originale, errore chiaro invece di «completato» senza AI.
- Sequenza: download → ensure modello (opz.) → AI/DSP → remux `*.instrumental.mp4` → cleanup originale → salvataggio libreria `(Instrumental)`.

### 📂 Path media locale (`karaoke://local`)
- Correzione del doppio slash `//home/...` dopo `encodeURIComponent` di path assoluti POSIX: playback Instrumental e file locali non falliscono più con `Media file not found` / `DEMUXER_ERROR_COULD_NOT_OPEN`.
- Nomi Unicode (å, ò, …) invariati; Windows drive letter / UNC gestiti.
- SoundFont bundled: priorità a `resources/soundfonts/` (extraResources, fuori asar).

### 🎚️ «Rimozione voce» AI — progresso oltre il 45%
- Mapping di progresso monotono per fase (niente reset al 45% dopo il load del modello).
- Heartbeat intra-chunk durante STFT/ORT/iSTFT; piani FFT Bluestein in cache per `n_fft=5120`.
- Watchdog idle a 20 min; copie ONNX/WASM più sicure.

### 📺 YouTube — Carica altri video
- Pulsante **Carica altri video** in ricerca Web: pagina successiva via yt-dlp (`ytsearch` + playlist-start/end).

### 🧹 Menu Download — Pulisci coda
- **Pulisci coda** annulla i download in corso/in coda e svuota l’elenco (conferma se attivi).

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

GitHub Release **v1.1.0** overwrite: **recursive library scan** (subfolders) + **Instrumental AI UVR Default overlap / ORT keep-alive** + Instrumental AI worker ready race (extract WAV) + Web search after library delete + manual download warnings in Downloads menu + AI debug logs + WAV naming + Actions Node 24 + Instrumental staging + path `//home/...` + SoundFont + ~45% progress + Load more / Clear downloads + speed/ETA + AI timeout + split Settings + cancel + Instrumental AI + accent-insensitive search.

## 📦 Installers

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this refresh

### 📂 Library — recursive subfolder scan
- **Refresh Library** / startup reindex and download “already on disk” matching walk all relative subdirectories under `libraryPath` (same audio/video / Instrumental / incomplete-file filters; path-based ids avoid double-count).

### ⏱️ Instrumental AI — UVR Default chunking + ORT keep-alive
- UVR-MDX Karaoke 2 uses UVR GUI **Default** overlap (`step = chunk_size - n_fft`) with zero-pad/trim/Hann OLA instead of ~50% triangular windows (~2× fewer ORT runs).
- Parent keep-alive + 45 min ORT-silence ceiling avoid false idle kills while WASM blocks IPC during `session.run`; clearer stall/timeout logs.

### 🎙️ Instrumental AI — worker ready race / extract WAV
- `separate` is posted only after the utility-worker ready ping (no early post during ORT import).
- Refuse success if `{id}.instrumental.extract.wav` is missing; use instrumental method coerce (not live DSP).
- Mock pipeline test: `scripts/verify-ai-instrumental-extract.js`.

### 🔍 Web search — Download again after library delete
- After Delete from library, matching Web rows revert to `youtube` (id / path / filename prefix) so Download / Download Instrumental return without re-search.

### 📥 Download menu — manual warnings in-queue
- “Already in library” and manual download errors render on Downloads menu rows (not out-of-queue toasts); amber tone and auto-open menu.

### 🧪 Instrumental AI — debug logs + WAV naming
- Richer `debug` logs across the Instrumental pipeline (extract / model / ORT / remux / cleanup), no secrets.
- Demux extract: `{id}.extract.wav` (source MP4 stem); AI output: `{id}.instrumental.extract.wav`; per-`downloadId` temp cleanup.

### 🛠️ CI — Actions on Node 24 runtimes
- Bumped `actions/checkout`, `setup-node`, `upload-artifact` to Node 24 majors; app toolchain stays on Node 20.

### 📥 Download Instrumental — reliable original staging
- yt-dlp writes the original MP4 under **`userData/temp`** (Linux AppImage: `~/.config/karaoke-live-station/temp/`), not the library folder.
- Stronger Destination/Merger resolution (relative paths, unquoted Merger, ignore `.f###` fragments); clear error if the original is missing instead of “completed” without AI.
- Sequence: download → optional model ensure → AI/DSP → remux `*.instrumental.mp4` → delete original → library save `(Instrumental)`.

### 📂 Local media path (`karaoke://local`)
- Fixed double-slash `//home/...` after `encodeURIComponent` of POSIX absolute paths — Instrumental and local files no longer fail with `Media file not found` / `DEMUXER_ERROR_COULD_NOT_OPEN`.
- Unicode filenames (å, ò, …) unchanged; Windows drive letters / UNC handled.
- Bundled SoundFont: prefer `resources/soundfonts/` (extraResources, outside asar).

### 🎚️ Instrumental AI “Rimozione voce” — progress past 45%
- Phase-aware monotonic progress (no snap-back to 45% after model load).
- Intra-chunk STFT/ORT/iSTFT heartbeats; cached Bluestein FFT plans for `n_fft=5120`.
- Idle watchdog 20 min; safer ONNX/WASM buffer copies.

### 📺 YouTube — Load more videos
- **Load more videos** / **Carica altri video** in Web search: next page via yt-dlp (`ytsearch` + playlist-start/end).

### 🧹 Download menu — Clear downloads
- **Clear downloads** cancels in-flight/queued jobs and empties the list (confirm when active).

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

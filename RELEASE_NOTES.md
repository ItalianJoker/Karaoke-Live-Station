# 🎤 Karaoke Live Station v1.1.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v110-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.1.0 (refresh)

Aggiornamento della release **v1.1.0** (overwrite GitHub): **Rimozione Vocale solo algoritmica** (DSP mid/side) + **Scarica strumentale** YouTube + rimozione completa del percorso AI (ONNX/ORT/MDX/dual-stem) + fix storici UI/archivio/Stage.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa refresh

### 🎙️ Rimozione Vocale (Sperimentale) — solo DSP algoritmico
- Tendina **Impostazioni → Audio**: `centerCancelBassKeep`, `centerCancel`, `softMid` (mid/side in tempo reale).
- **Nessuna** AI / ONNX / ORT / download modelli; niente spinner «Separazione…» né fader dual-stem.
- Pulsante Regia etichettato **(Sperimentale)**; scorciatoia `V`.

### 📥 Scarica strumentale (ricerca YouTube)
- Pulsante accanto a Scarica quando il titolo **non** contiene già `Karaoke` o `instrumental` (case-insensitive).
- Pipeline: download → demux audio → rimozione voce algoritmica (ffmpeg) → remux MP4 strumentale → libreria (`… (Instrumental)`).
- Sottotitoli auto bruciati sul video se disponibili; altrimenti remux senza burn-in.

### 🧹 Rimozione percorso AI
- Eliminati ONNX Runtime, MDX/HTDemucs/BS-Roformer, `karaoke://models` / `karaoke://ort`, model manager, cache dual-stem e dipendenze correlate.

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

GitHub Release **v1.1.0** overwrite: **algorithmic-only vocal remover** (mid/side DSP) + YouTube **Download Instrumental** + full removal of the AI path (ONNX/ORT/MDX/dual-stem) + retained UI/archive/Stage fixes.

## 📦 Installers

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this refresh

### 🎙️ Vocal Remover (Experimental) — algorithmic DSP only
- **Settings → Audio**: `centerCancelBassKeep`, `centerCancel`, `softMid` (realtime mid/side).
- **No** AI / ONNX / ORT / model download; no “Separating…” spinner or dual-stem fader.
- Control button labeled **(Experimental)**; shortcut `V`.

### 📥 Download Instrumental (YouTube search)
- Button next to Download when the title does **not** already contain `Karaoke` or `instrumental` (case-insensitive).
- Pipeline: download → demux audio → algorithmic vocal removal (ffmpeg) → remux instrumental MP4 → library (`… (Instrumental)`).
- Auto-subs burned onto the video when available; otherwise remux without burn-in.

### 🧹 AI path removed
- Removed ONNX Runtime, MDX/HTDemucs/BS-Roformer, `karaoke://models` / `karaoke://ort`, model manager, dual-stem caches, and related dependencies.

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

# 🎤 Karaoke Live Station v1.1.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v110-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.1.0 (refresh)

Aggiornamento della release **v1.1.0** (overwrite GitHub): **fix ORT WASM su Windows** (niente Temp OS) + modelli MDX/ONNX durabili in `userData` + fix URL download UVR-MDX-NET Karaoke 2 (404) + rimozione voce guida AI offline + avviso hardware + retry CI.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa refresh

### 🧩 Fix ORT WASM — niente Temp OS (Windows Electron)
- Errore tipico: `no available backend found` / `…/AppData/Local/Temp/…/wasm-simd-threaded.jsep.mjs` quando onnxruntime-web caricava `.mjs`/`.wasm` da percorsi effimeri.
- Runtime WASM seedati in **`<userData>/ort/`** (come yt-dlp in `bin/`), serviti via **`karaoke://ort/`**; aggiornamento solo se mancanti, size diversa o source packaged più recente.
- Modelli ONNX (MDX / HTDemucs / BS-Roformer) restano in **`<userData>/models/`** con staging sibling e sidecar `.meta.json` — ridownload solo se mancanti, corrotti o catalogo più recente.
- Toast più chiaro se il backend WASM fallisce ancora.

### 🔗 Fix download UVR-MDX-NET Karaoke 2 (HTTP 404)
- URL catalogo aggiornato al mirror pubblico **Tha456/uvr5-models** (stesso SHA-256 / ~53 MB).
- IPC `vocal-model:ensure` / `get-buffer`: risposta strutturata `{ success, error }`.

### 🎙️ Rimuovi Voce Guida (Sperimentale) — DSP + AI offline
- Tendina **Impostazioni → Audio**: metodi **DSP mid/side in tempo reale** (`centerCancelBassKeep`, `centerCancel`, `softMid`) **e** opzioni **AI locale** (nessuna API cloud).
- **UVR-MDX-NET Karaoke 2** (~53 MB) — AI consigliata; ONNX Runtime Web (WASM).
- **HTDemucs v4** (~172 MB) — Experimental (`demucs-web` + ONNX).
- **BS-Roformer (ViperX)** quantizzato (~158 MB) — avanzato; modello in cache locale; STFT band-split non ancora affidabile in Electron WASM (toast + DSP/MDX/HTDemucs restano usabili).
- Percorso AI: separazione async → crossfade sull’instrumental (l’audio dry continua finché non è pronto).
- Pulsante Regia etichettato **(Sperimentale)**; scorciatoia `V`.

### ⚠️ Avviso requisiti hardware (AI)
- Al primo utilizzo di un metodo AI: **modale tematico** + testo guida in Impostazioni (IT/EN/ES/FR).
- Opzione **Non mostrare più**; i metodi algoritmici **non** mostrano l’avviso.

### 🛠️ CI — retry install
- Retry `npm ci` con backoff (bash su tutte le piattaforme) per download intermittenti di `ffmpeg-static`.

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

### 📜 Licenza
- Progetto sotto **GNU AGPLv3 or later** (`AGPL-3.0-or-later`).

---

<a name="v110-english"></a>
# 🇬🇧 Release Notes — Version 1.1.0 (refresh)

GitHub Release **v1.1.0** overwrite: **ORT WASM fix (no OS Temp)** + durable MDX/ONNX under `userData` + UVR-MDX-NET Karaoke 2 download 404 fix + offline AI vocal remover + hardware warning + CI retries.

## 📦 Installers

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this refresh

### 🧩 ORT WASM fix — no OS Temp (Windows Electron)
- Typical error: `no available backend found` / `…/AppData/Local/Temp/…/wasm-simd-threaded.jsep.mjs` when onnxruntime-web loaded `.mjs`/`.wasm` from ephemeral paths.
- WASM runtimes seeded into **`<userData>/ort/`** (same durability as yt-dlp under `bin/`), served via **`karaoke://ort/`**; refresh only when missing, size-mismatched, or packaged source newer.
- ONNX models (MDX / HTDemucs / BS-Roformer) stay under **`<userData>/models/`** with sibling staging + `.meta.json` — re-download only if missing, corrupt, or catalog newer.
- Clearer toast if the WASM backend still fails.

### 🔗 UVR-MDX-NET Karaoke 2 download fix (HTTP 404)
- Catalog URL updated to the public **Tha456/uvr5-models** mirror (same SHA-256 / ~53 MB).
- IPC `vocal-model:ensure` / `get-buffer`: structured `{ success, error }`.

### 🎙️ Vocal Remover (Experimental) — DSP + offline AI
- **Settings → Audio** dropdown: realtime **mid/side DSP** (`centerCancelBassKeep`, `centerCancel`, `softMid`) **and** **local AI** options (no cloud APIs).
- **UVR-MDX-NET Karaoke 2** (~53 MB) — recommended AI; ONNX Runtime Web (WASM).
- **HTDemucs v4** (~172 MB) — Experimental (`demucs-web` + ONNX).
- **BS-Roformer (ViperX)** quantized (~158 MB) — advanced; model cached offline; band-split STFT not yet reliable in Electron WASM (toast + DSP/MDX/HTDemucs remain usable).
- AI path: async separate → instrumental crossfade (dry audio continues until ready).
- Control button labeled **(Experimental)**; shortcut `V`.

### ⚠️ Hardware requirements warning (AI)
- On first AI method select or first AI toggle-on: **themed modal** + Settings helper text (IT/EN/ES/FR).
- Optional **Don’t show again**; algorithmic methods **never** show this warning.

### 🛠️ CI — install retries
- `npm ci` retry with backoff (`shell: bash` on all platforms) for flaky `ffmpeg-static` downloads.

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

### 📜 License
- Project licensed under **GNU AGPLv3 or later** (`AGPL-3.0-or-later`).

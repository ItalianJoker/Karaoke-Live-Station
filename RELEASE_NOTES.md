# 🎤 Karaoke Live Station v1.1.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v110-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.1.0 (refresh)

Aggiornamento della release **v1.1.0** (overwrite GitHub): **fix URL download UVR-MDX-NET Karaoke 2 (404)** + rimozione voce guida con **AI locale offline** (MDX / HTDemucs / BS-Roformer) + avviso hardware + retry CI `npm ci`.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa refresh

### 🔗 Fix download UVR-MDX-NET Karaoke 2 (HTTP 404)
- Il catalogo puntava a `Politrees/UVR_resources` su Hugging Face: il file `UVR_MDXNET_KARA_2.onnx` non è più su `main` → **404** al primo download del modello AI consigliato.
- URL aggiornato al mirror pubblico **Tha456/uvr5-models** (stesso SHA-256 / ~53 MB); HTDemucs e BS-Roformer già OK (HTTP 200).
- IPC `vocal-model:ensure` / `get-buffer`: risposta strutturata `{ success, error }` invece di throw, così la Regia mostra il toast chiaro senza il duplicato “Error invoking remote method”.

### 🎙️ Rimuovi Voce Guida (Sperimentale) — DSP + AI offline
- Tendina **Impostazioni → Audio**: metodi **DSP mid/side in tempo reale** (`centerCancelBassKeep`, `centerCancel`, `softMid`) **e** opzioni **AI locale** (nessuna API cloud).
- **UVR-MDX-NET Karaoke 2** (~53 MB) — AI consigliata; ONNX Runtime Web (WASM).
- **HTDemucs v4** (~172 MB) — Experimental (`demucs-web` + ONNX).
- **BS-Roformer (ViperX)** quantizzato (~158 MB) — avanzato; modello in cache locale; STFT band-split non ancora affidabile in Electron WASM (toast + DSP/MDX/HTDemucs restano usabili).
- Modelli scaricati al primo uso in `<userData>/models/` (progresso + verifica), poi **completamente offline**.
- Percorso AI: separazione async → crossfade sull’instrumental (l’audio dry continua finché non è pronto).
- Pulsante Regia etichettato **(Sperimentale)**; scorciatoia `V`.

### ⚠️ Avviso requisiti hardware (AI)
- Al primo utilizzo di un metodo AI (selezione Impostazioni o attivazione `V`): **modale tematico** + testo guida in Impostazioni (IT/EN/ES/FR).
- CPU moderna consigliata; GPU/ONNX aiutano; BS-Roformer più pesante; primo uso scarica ~50–300 MB.
- Opzione **Non mostrare più**; i metodi algoritmici **non** mostrano l’avviso.

### 🛠️ CI — retry install
- Retry `npm ci` con backoff (bash su tutte le piattaforme) per download intermittenti di `ffmpeg-static` (es. HTTP 500 su darwin-arm64).

### 🔇 Conferma unmute anteprima YouTube (stesso dispositivo)
- Anche sull’embed YouTube della ricerca Web / Pre-Ascolto: se CUE e Uscita Principale coincidono, togliere il muto apre lo **stesso modale tematico** già usato per video/audio/MIDI locali.

### 🖼️ Archiviazione automatica → thumbnail Local
- Dopo download YouTube + salvataggio in libreria: **reindex completo** della Local (scan + cover ffmpeg) **prima** di accodare il file locale.

### 🖼️ Icona ufficiale ovunque
- Packaging Windows / Linux / macOS con logo ufficiale `public/logo.png`.

### 📥 YouTube → coda con archiviazione automatica
- Con archiviazione ON, **Metti in coda** attende download **e** archivio riusciti, aggiorna Locale, poi accoda il **file locale della libreria**.

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

GitHub Release **v1.1.0** overwrite: **UVR-MDX-NET Karaoke 2 download URL 404 fix** + guide-vocal removal with **local offline AI** (MDX / HTDemucs / BS-Roformer) + hardware warning + CI `npm ci` retries.

## 📦 Installers

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.1.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.1.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.1.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.1.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.1.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this refresh

### 🔗 UVR-MDX-NET Karaoke 2 download fix (HTTP 404)
- Catalog pointed at Hugging Face `Politrees/UVR_resources`; `UVR_MDXNET_KARA_2.onnx` is no longer on `main` → **404** on first download of the recommended AI model.
- URL updated to the public **Tha456/uvr5-models** mirror (same SHA-256 / ~53 MB); HTDemucs and BS-Roformer already OK (HTTP 200).
- IPC `vocal-model:ensure` / `get-buffer`: structured `{ success, error }` instead of throw, so Control shows a clear toast without the duplicate “Error invoking remote method”.

### 🎙️ Vocal Remover (Experimental) — DSP + offline AI
- **Settings → Audio** dropdown: realtime **mid/side DSP** (`centerCancelBassKeep`, `centerCancel`, `softMid`) **and** **local AI** options (no cloud APIs).
- **UVR-MDX-NET Karaoke 2** (~53 MB) — recommended AI; ONNX Runtime Web (WASM).
- **HTDemucs v4** (~172 MB) — Experimental (`demucs-web` + ONNX).
- **BS-Roformer (ViperX)** quantized (~158 MB) — advanced; model cached offline; band-split STFT not yet reliable in Electron WASM (toast + DSP/MDX/HTDemucs remain usable).
- Models download on first use into `<userData>/models/` (progress + integrity), then run **fully offline**.
- AI path: async separate → instrumental crossfade (dry audio continues until ready).
- Control button labeled **(Experimental)**; shortcut `V`.

### ⚠️ Hardware requirements warning (AI)
- On first AI method select or first AI toggle-on: **themed modal** + Settings helper text (IT/EN/ES/FR).
- Modern CPU recommended; GPU/ONNX helps; BS-Roformer is heavier; first use downloads ~50–300 MB.
- Optional **Don’t show again**; algorithmic methods **never** show this warning.

### 🛠️ CI — install retries
- `npm ci` retry with backoff (`shell: bash` on all platforms) for flaky `ffmpeg-static` downloads (e.g. HTTP 500 on darwin-arm64).

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

# 🎤 Karaoke Live Station v1.3.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v130-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.3.0

Bump codice a **1.3.0** (bozza — **nessun tag GitHub release finché Luca non dice Si**). Parte dalla baseline **v1.2.0**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.3.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.3.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.3.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.3.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.3.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🖥️ Avvio Regia / Palco
- **Massimizza Regia all’avvio** (`autoMaximizeControlOnLaunch`, default on) — `maximize()`, non fullscreen esclusivo.
- **Apri Schermo Palco all’avvio** (`autoOpenStageOnLaunch`, default on). Se off, il Palco resta chiuso fino a **P** / **F2** / pulsante Stage.
- Preferenze di boot salvate anche in `userData/launch-prefs.json` (leggibili prima dell’hydrate Control).

### 🧠 AI strumentale — core CPU manuali
- Impostazioni → **Libreria & Download**: mostra core disponibili, slider + numerico **1..N**, pulsante **Reimposta su Massimo (N)**.
- Default `aiCpuThreads: null` = tutti i core. Clamp &lt;1→1, &gt;N→N; mai ≤0/NaN.
- MDX / Demucs: `ort.env.wasm.numThreads`, SIMD on, provider `webgpu` con fallback WASM.

### ⚙️ Impostazioni
- Modal più ampia (`max-w-5xl`, `h-[88vh]`), sidebar ~220px, griglia a 2 colonne.
- Metodo Download Strumentale + MDX avanzate + core AI spostati in **Libreria & Download**. Audio: SoundFont, CUE/Master, sync A/V, Rimozione Vocale live, normalizzazione.
- Badge versione UI **v1.3.0**.

## ✅ Baseline 1.2.0
Resta incluso: file locali mancanti, Drag & Drop, scan ~16k, SoundFont AppImage + Altro, yt-dlp `.*-orig`, Safety-First slice 1.

---

<a name="v130-english"></a>
# 🇬🇧 Release Notes — Version 1.3.0

Code bump to **1.3.0** (draft — **no GitHub release tag until Luca says Si**). Builds on **v1.2.0** baseline.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.3.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.3.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.3.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.3.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.3.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new

### 🖥️ Launch — Control / Stage
- **Maximize Regia on launch** (`autoMaximizeControlOnLaunch`, default on) — `maximize()`, not exclusive fullscreen.
- **Open Stage on launch** (`autoOpenStageOnLaunch`, default on). When off, Stage stays closed until **P** / **F2** / Stage button.
- Boot prefs also written to `userData/launch-prefs.json` (readable before Control hydrates).

### 🧠 Instrumental AI — manual CPU cores
- Settings → **Library & Download**: available cores, slider + numeric **1..N**, **Reset to Maximum (N)**.
- Default `aiCpuThreads: null` = all cores. Clamp &lt;1→1, &gt;N→N; never ≤0/NaN.
- MDX / Demucs: `ort.env.wasm.numThreads`, SIMD on, `webgpu` with WASM fallback.

### ⚙️ Settings
- Wider modal (`max-w-5xl`, `h-[88vh]`), ~220px sidebar, 2-column grids.
- Download Instrumental method + MDX advanced + AI cores moved to **Library & Download**. Audio keeps SoundFont, CUE/Master, A/V sync, live vocal remover DSP, normalization.
- UI version badge **v1.3.0**.

## ✅ 1.2.0 baseline
Still includes: missing local files, Drag & Drop, ~16k scan, AppImage SoundFont + Altro, yt-dlp `.*-orig`, Safety-First slice 1.

# 🎤 Karaoke Live Station v1.4.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v140-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.4.0

Sovrascrittura GitHub **v1.4.0** (stesso tag; **non** tocca `v1.3.0` / `v1.2.0` / `v1.1.0`). Parte dalla baseline **v1.3.0**. PRs **#52**–**#57**. Pacchetto resta **1.4.0** (nessuna v1.5.0).

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.4.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.4.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.4.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.4.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.4.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🎵 DSP pitch/speed — Bungee predefinito (#52) + fix udibile (#56)
- Motore media predefinito **Bungee** (phase vocoder Wasm AudioWorklet, MPL-2.0 — solo prebuilt in `public/workers/`, nessun sorgente C++ in-repo).
- **SoundTouch WSOLA** resta selezionabile in Impostazioni come motore legacy/leggero.
- Range UI: ±8 ST (Bungee) / ±4 ST (SoundTouch). Bypass bit-perfect a pitch 0 e velocità 1.00x.
- **Fix #56:** AudioWorklet/Emscripten init, attesa Wasm `initialized`, tempo solo via Wasm (niente doppio `playbackRate`), limiti velocità per motore (Bungee 0.50–1.50 / SoundTouch 0.75–1.25).
- Fallback silenzioso a SoundTouch se Bungee non inizializza. MIDI/KAR invariato (SpessaSynth).

### 📥 Scarica strumentale — modal sottotitoli (#53)
- Conferma prima del download: con sottotitoli / solo strumentale / annulla (Esc / click fuori).
- Policy persistente `ask` / `always` / `never` (`instrumentalSubtitlesPolicy`).
- Auto-subs yt-dlp solo se `includeSubtitles: true`; `--sub-langs .*-orig,default` (anti-429, niente bare `all`).
- Download normale (non strumentale) invariato, senza modal.

### 📦 ZIP CD+G nativo + tonalità/BPM (#54)
- Scan/import `.zip` con MP3/WAV+`.cdg`; estrazione on-demand in `temp/zip_cache`; cleanup a dequeue/uscita.
- Analisi async `initialKey` / `initialBpm`; pillole Pitch/Speed in Regia con etichetta `base→risultato` / BPM accanto a ± (handler invariati).

### 🎛️ AI strumentale — GPU-First + opzioni (#55)
- Toggle **AI GPU** (default on) + badge live; probe `system:get-gpu-status`.
- Metodo Download Strumentale solo **UVR-MDX Karaoke 2** / **HTDemucs** (DSP e Roformer rimossi dalla tendina download; live `V` resta DSP).
- Pannello avanzato HTDemucs (shifts / segmento / overlap); MDX avanzato invariato.
- Etichette live: **Algoritmo Base** (ex Sperimentale).

### 🧹 Safety-First cleanup (#57)
- Modularizzazione Regia/Impostazioni (hook + tab), virtualizzazione libreria 16k+, disconnect Web Audio su dispose, parity manuali it/en/es/fr (DnD OS, scan ricorsivo, Bungee/SoundTouch, SoundFont AppImage).
- **Nessun bump a 1.5.0** — resta **1.4.0**.

### 🏷️ Versione
- Badge UI / pacchetto **v1.4.0**.

## ✅ Baseline 1.3.0
Resta incluso: massimizza Regia all’avvio, Schermo Palco on/off, core CPU AI strumentale, Settings più ampia, baseline 1.2.0.

---

<a name="v140-english"></a>
# 🇬🇧 Release Notes — Version 1.4.0

Overwrite of GitHub release **v1.4.0** (same tag; does **not** touch `v1.3.0` / `v1.2.0` / `v1.1.0`). Builds on **v1.3.0** baseline. PRs **#52**–**#57**. Package stays **1.4.0** (no v1.5.0).

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.4.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.4.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.4.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.4.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.4.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new

### 🎵 Pitch/speed DSP — Bungee default (#52) + audible fix (#56)
- Default media engine is **Bungee** (phase-vocoder Wasm AudioWorklet, MPL-2.0 — runtime prebuilts only under `public/workers/`, no C++ source tree).
- **SoundTouch WSOLA** remains selectable in Settings as the legacy/light engine.
- UI ranges: ±8 ST (Bungee) / ±4 ST (SoundTouch). Bit-perfect bypass at pitch 0 and speed 1.00x.
- **Fix #56:** AudioWorklet/Emscripten init, wait for Wasm `initialized`, tempo via Wasm only (no double `playbackRate`), per-engine speed limits (Bungee 0.50–1.50 / SoundTouch 0.75–1.25).
- Silent fallback to SoundTouch if Bungee init fails. MIDI/KAR unchanged (SpessaSynth).

### 📥 Download Instrumental — subtitles modal (#53)
- Confirm before download: with subtitles / instrumental only / cancel (Esc / outside click).
- Persisted policy `ask` / `always` / `never` (`instrumentalSubtitlesPolicy`).
- yt-dlp auto-subs only when `includeSubtitles: true`; `--sub-langs .*-orig,default` (anti-429, no bare `all`).
- Normal (non-instrumental) download unchanged — no modal.

### 📦 Native ZIP CD+G + Key/BPM (#54)
- Scan/import `.zip` with MP3/WAV+`.cdg`; on-demand extract under `temp/zip_cache`; cleanup on dequeue/quit.
- Async `initialKey` / `initialBpm`; Control Pitch/Speed pills show `base→result` / BPM beside ± (handlers unchanged).

### 🎛️ Instrumental AI — GPU-First + options (#55)
- **AI GPU** toggle (default on) + live badge; `system:get-gpu-status` probe.
- Download Instrumental methods: **UVR-MDX Karaoke 2** / **HTDemucs** only (DSP and Roformer removed from download Settings; live `V` stays DSP).
- HTDemucs advanced panel (shifts / segment / overlap); MDX advanced unchanged.
- Live labels: **Basic Algorithm** (was Experimental).

### 🧹 Safety-First cleanup (#57)
- Control/Settings modularization (hooks + tabs), 16k+ library list virtualization, Web Audio disconnect on dispose, it/en/es/fr manual parity (OS DnD, recursive scan, Bungee/SoundTouch, AppImage SoundFont).
- **No bump to 1.5.0** — stays **1.4.0**.

### 🏷️ Version
- UI badge / package **v1.4.0**.

## ✅ 1.3.0 baseline
Still includes: maximize Control on launch, Stage on/off at boot, instrumental AI CPU cores, wider Settings, plus the 1.2.0 baseline.

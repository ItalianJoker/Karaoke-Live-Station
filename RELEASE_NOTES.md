# 🎤 Karaoke Live Station v1.4.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v140-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.4.0

Release GitHub **v1.4.0** (nuovo tag; **non** tocca `v1.3.0` / `v1.2.0` / `v1.1.0`). Parte dalla baseline **v1.3.0**. PRs **#52** + **#53**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.4.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.4.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.4.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.4.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.4.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🎵 DSP pitch/speed — Bungee predefinito (#52)
- Motore media predefinito **Bungee** (phase vocoder Wasm AudioWorklet, MPL-2.0 — solo prebuilt in `public/workers/`, nessun sorgente C++ in-repo).
- **SoundTouch WSOLA** resta selezionabile in Impostazioni come motore legacy/leggero.
- Range UI: ±8 ST (Bungee) / ±4 ST (SoundTouch). Bypass bit-perfect a pitch 0 e velocità 1.00x.
- Fallback silenzioso a SoundTouch se Bungee non inizializza. MIDI/KAR invariato (SpessaSynth).

### 📥 Scarica strumentale — modal sottotitoli (#53)
- Conferma prima del download: con sottotitoli / solo strumentale / annulla (Esc / click fuori).
- Policy persistente `ask` / `always` / `never` (`instrumentalSubtitlesPolicy`).
- Auto-subs yt-dlp solo se `includeSubtitles: true`; `--sub-langs .*-orig,default` (anti-429, niente bare `all`).
- Download normale (non strumentale) invariato, senza modal.

### 🏷️ Versione
- Badge UI / pacchetto **v1.4.0**.

## ✅ Baseline 1.3.0
Resta incluso: massimizza Regia all’avvio, Schermo Palco on/off, core CPU AI strumentale, Settings più ampia, baseline 1.2.0.

---

<a name="v140-english"></a>
# 🇬🇧 Release Notes — Version 1.4.0

GitHub release **v1.4.0** (new tag; does **not** touch `v1.3.0` / `v1.2.0` / `v1.1.0`). Builds on **v1.3.0** baseline. PRs **#52** + **#53**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.4.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.4.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.4.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.4.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.4.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new

### 🎵 Pitch/speed DSP — Bungee default (#52)
- Default media engine is **Bungee** (phase-vocoder Wasm AudioWorklet, MPL-2.0 — runtime prebuilts only under `public/workers/`, no C++ source tree).
- **SoundTouch WSOLA** remains selectable in Settings as the legacy/light engine.
- UI ranges: ±8 ST (Bungee) / ±4 ST (SoundTouch). Bit-perfect bypass at pitch 0 and speed 1.00x.
- Silent fallback to SoundTouch if Bungee init fails. MIDI/KAR unchanged (SpessaSynth).

### 📥 Download Instrumental — subtitles modal (#53)
- Confirm before download: with subtitles / instrumental only / cancel (Esc / outside click).
- Persisted policy `ask` / `always` / `never` (`instrumentalSubtitlesPolicy`).
- yt-dlp auto-subs only when `includeSubtitles: true`; `--sub-langs .*-orig,default` (anti-429, no bare `all`).
- Normal (non-instrumental) download unchanged — no modal.

### 🏷️ Version
- UI badge / package **v1.4.0**.

## ✅ 1.3.0 baseline
Still includes: maximize Control on launch, Stage on/off at boot, instrumental AI CPU cores, wider Settings, plus the 1.2.0 baseline.

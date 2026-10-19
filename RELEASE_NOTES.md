# 🎤 Karaoke Live Station v2.3.1 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

## [Unreleased]

_(empty)_

---

<a name="v231-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.3.1

Nuova release GitHub **v2.3.1**. Include i fix #86 già su `main`: Cancel AI non lascia più il job ORT appeso, STT karaoke sull’audio originale (non strumentale), preferenza GPU discreta cross-platform. Pacchetto **2.3.1**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.1.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.1-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.1.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.1_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.1-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🛑 Cancel AI strumentale
- Cancel mid-conversione non lascia più il Hidden Renderer ORT “appeso” fino al relaunch.
- `dispose()` della finestra nascosta + `requestId` monotono + single-flight.

### 🎤 STT sull’audio originale
- Whisper riceve il mix originale / WAV demux — mai `*.instrumental*`.
- Sidecar accanto allo strumentale; guard IPC; preferenza stem vocale onesta (mix finché non esiste export vocals).

### 🎮 GPU discreta cross-platform
- Preferenza high-performance / low-power su Win/macOS/Linux (`force_high_performance_gpu` / `force_low_power_gpu`).
- Lista adapter + badge adapter effettivo (non NVIDIA-only).

---

<a name="v231-english"></a>
# 🇬🇧 Release Notes — Version 2.3.1

New GitHub release **v2.3.1**. Ships the #86 fixes already on `main`: Cancel no longer leaves Instrumental AI ORT stuck, karaoke STT runs from original/demux audio (not instrumental), and discrete GPU preference is cross-platform. Package **2.3.1**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.1.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.1-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.1.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.1_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.1-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this version

### 🛑 Instrumental AI Cancel
- Mid-conversion Cancel no longer leaves the Hidden Renderer ORT job stuck until relaunch.
- Dispose the hidden window + monotonic `requestId` + single-flight.

### 🎤 STT from original audio
- Whisper gets the original mix / demux WAV — never `*.instrumental*`.
- Sidecar beside instrumental; IPC guard; honest vocal-stem preference (mix until vocals export exists).

### 🎮 Cross-platform discrete GPU
- High-performance / low-power preference on Win/macOS/Linux (`force_high_performance_gpu` / `force_low_power_gpu`).
- Adapter list + effective adapter badge (not NVIDIA-only).

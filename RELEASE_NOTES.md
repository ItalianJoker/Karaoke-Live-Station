# 🎤 Karaoke Live Station v2.3.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

## [Unreleased]

_(empty)_

---

<a name="v230-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.3.0

Nuova release GitHub **v2.3.0**. Overlay karaoke word-level via **STT offline (whisper.cpp)** sul flusso Download Strumentale, con modelli on-demand in `userData` (mai nell’installer). Pacchetto **2.3.0**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🎤 Karaoke STT (whisper.cpp)
- Terza scelta nel modal Download Strumentale: **Nessun sottotitolo** · **Sottotitoli YouTube** · **Genera testo karaoke (STT)**.
- Default modello **`medium` (Predefinito)**; picker Settings `tiny` → `large-v3`.
- Modelli **solo** in `<userData>/models/whisper/` (es. AppData) — **mai** nell’installer; Rimuovi / Elimina tutti con conferma.
- Dialog warning HW/size/qualità alla prima attivazione o dopo delete.
- Overlay Stage parola-per-parola (burn-in ASS rimandato). Honesty: STT sul canto ≠ lyrics ufficiali / CD+G.

---

<a name="v230-english"></a>
# 🇬🇧 Release Notes — Version 2.3.0

New GitHub release **v2.3.0**. Word-level karaoke overlay via **offline STT (whisper.cpp)** on Download Instrumental, with on-demand models under `userData` (never in the installer). Package **2.3.0**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this version

### 🎤 Karaoke STT (whisper.cpp)
- Third choice in Download Instrumental modal: **No subtitles** · **YouTube subtitles** · **Generate karaoke text (STT)**.
- Default model **`medium` (Default)**; Settings picker `tiny` → `large-v3`.
- Models **only** under `<userData>/models/whisper/` (e.g. AppData) — **never** in the installer; Remove / Delete all with confirm.
- HW/size/quality warning dialog on first activation or after delete.
- Stage word overlay (ASS burn-in deferred). Honesty: singing STT ≠ official lyrics / CD+G.

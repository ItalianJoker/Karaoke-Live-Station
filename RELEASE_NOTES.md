# 🎤 Karaoke Live Station v2.3.4 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

## [Unreleased]

_(empty)_

---

<a name="v234-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.3.4

Nuova release GitHub **v2.3.4**. Fix packaging Windows di `whisper-cli`: DLL runtime accanto all’exe, probe installazione che rifiuta `STATUS_DLL_NOT_FOUND`, riparazione automatica delle installazioni rotte. Pacchetto **2.3.4**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.4.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.4-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.4.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.4_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.4-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🪟 Windows whisper-cli + DLL runtime
- **Extract:** dallo zip ufficiale `whisper-blas-bin-x64` vengono copiate in `<userData>/bin/` sia `whisper-cli.exe` sia tutte le DLL (`libopenblas.dll`, `ggml*.dll`, `whisper.dll`, …).
- **Probe:** `-h` che fallisce con `STATUS_DLL_NOT_FOUND` (exit `3221225781`) non marca più il binario come pronto solo perché è ≥100 KB.
- **Repair:** se esiste un’installazione vecchia (solo exe senza DLL), al prossimo STT l’app la rimuove e riscarica/riestrae automaticamente — niente delete manuale.

---

<a name="v234-english"></a>
# 🇬🇧 Release Notes — Version 2.3.4

New GitHub release **v2.3.4**. Windows `whisper-cli` packaging fix: runtime DLLs next to the exe, install probe that rejects `STATUS_DLL_NOT_FOUND`, automatic repair of broken installs. Package **2.3.4**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.4.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.4-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.4.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.4_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.4-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this version

### 🪟 Windows whisper-cli + runtime DLLs
- **Extract:** from the official `whisper-blas-bin-x64` zip, both `whisper-cli.exe` and all runtime DLLs (`libopenblas.dll`, `ggml*.dll`, `whisper.dll`, …) are copied into `<userData>/bin/`.
- **Probe:** a `-h` failure with `STATUS_DLL_NOT_FOUND` (exit `3221225781`) no longer marks the binary ready just because it is ≥100 KB.
- **Repair:** if an old broken install exists (exe without DLLs), the next STT run removes it and re-downloads/re-extracts automatically — no manual delete.

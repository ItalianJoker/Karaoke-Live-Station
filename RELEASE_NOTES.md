# 🎤 Karaoke Live Station v2.3.5 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

## [Unreleased]

_(empty)_

---

<a name="v235-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.3.5

Nuova release GitHub **v2.3.5**. Lo STT karaoke allinea l’UX all’AI strumentale: **ETA** nel menu Download e stessi controlli GPU/discreta/core CPU, mappati su backend **whisper.cpp** (CUDA cuBLAS vs OpenBLAS multi-thread) — **non** ORT WebGPU. Pacchetto **2.3.5**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.5.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.5-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.5.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.5_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.5-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### ⏱️ ETA durante lo STT
- `whisper-cli` ora usa `-pp` (progress) oltre a `-np`; il menu Download mostra percentuale ed **ETA** come per la conversione strumentale.

### 🎮 GPU / CPU per lo STT (stesse Impostazioni dell’AI)
- Toggle GPU, preferenza GPU discreta/integrata e core CPU AI valgono anche per lo STT.
- **Windows:** GPU on + discreta → zip ufficiale `whisper-cublas-11.8.0-bin-x64` (DLL CUDA/ggml copiate in `<userData>/bin/` come in v2.3.4); altrimenti `whisper-blas-bin-x64` con `-t` e `-ng`. Fallback soft a BLAS se CUDA non è disponibile.
- Lo STT **non** usa WebGPU/ORT (riservato all’AI strumentale). Modello default invariato: **medium**.

---

<a name="v235-english"></a>
# 🇬🇧 Release Notes — Version 2.3.5

New GitHub release **v2.3.5**. Karaoke STT matches Instrumental AI UX: **ETA** in the Downloads menu and the same GPU / discrete preference / CPU core knobs, mapped to **whisper.cpp** backends (CUDA cuBLAS vs OpenBLAS multi-thread) — **not** ORT WebGPU. Package **2.3.5**.

## 📦 Installation Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.5.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.5-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.5.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.5_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.5-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What's new in this version

### ⏱️ ETA during STT
- `whisper-cli` now uses `-pp` (progress) alongside `-np`; the Downloads menu shows percent and **ETA** like instrumental conversion.

### 🎮 GPU / CPU for STT (same Settings as Instrumental AI)
- GPU toggle, discrete/integrated preference, and AI CPU cores also apply to STT.
- **Windows:** GPU on + discrete → official `whisper-cublas-11.8.0-bin-x64` zip (CUDA/ggml DLLs copied into `<userData>/bin/` as in v2.3.4); otherwise `whisper-blas-bin-x64` with `-t` and `-ng`. Soft fallback to BLAS if CUDA is unavailable.
- STT does **not** use WebGPU/ORT (Instrumental AI only). Default model unchanged: **medium**.

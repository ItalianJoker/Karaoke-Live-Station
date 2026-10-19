# 🎤 Karaoke Live Station v2.3.9 — Release Notes

---

# 🇮🇹 Note di Rilascio — Versione 2.3.9

Nuova release GitHub **v2.3.9**. Fix Windows CUDA per STT: v2.3.7 installava `cublas64_11.dll`, ma quella DLL importa **`cublasLt64_11.dll`** (assente dallo zip ufficiale whisper) → ancora `STATUS_DLL_NOT_FOUND` → fallback CPU BLAS. Ora si installano entrambi i companion (CUDA Toolkit 11.x locale oppure download NuGet; Lt ~544 MB, hash verificato). Include v2.3.8 (download modelli Whisper dalle Opzioni). Pacchetto **2.3.9**.

### Cosa c’è di nuovo
- **Companion cublasLt** — catena CUDA whisper completa su Windows (cublas + cublasLt).
- **Nessuna regressione** — ETA STT, Settings modelli Whisper, soft-fail e ordine pipeline invariati.

### Download

| Piattaforma | File | Note |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.9.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.9-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.9.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.9_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.9-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

### Breaking Changes
- Nessuno. Alla prima installazione CUDA senza Toolkit 11.x può scaricare ~544 MB per cublasLt.

---

# 🇬🇧 Release Notes — Version 2.3.9

New GitHub release **v2.3.9**. Windows CUDA STT fix: v2.3.7 installed `cublas64_11.dll`, but that DLL hard-imports **`cublasLt64_11.dll`** (also omitted from the official whisper zip) → still `STATUS_DLL_NOT_FOUND` → CPU BLAS fallback. Both companions are now installed (local CUDA 11.x Toolkit or NuGet fetch; Lt ~544 MB, hash-verified). Includes v2.3.8 (Whisper model download from Settings). Package **2.3.9**.

### What's new
- **cublasLt companion** — full Windows whisper CUDA load chain (cublas + cublasLt).
- **No regression** — STT ETA, Whisper model Settings, soft-fail, and pipeline order unchanged.

### Download

| Platform | File | Notes |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.9.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.9-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.9.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.9_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.9-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

### Breaking Changes
- None. First CUDA ensure without Toolkit 11.x may download ~544 MB for cublasLt.

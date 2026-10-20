# 🎤 Karaoke Live Station v2.3.10 — Release Notes

---

# 🇮🇹 Note di Rilascio — Versione 2.3.10

Nuova release GitHub **v2.3.10**. Il testo karaoke STT è mostrato in **MAIUSCOLO** sia sull’overlay Stage sia nel burn-in ASS (`\kf`), dalla stessa funzione condivisa — così i due percorsi restano allineati. Il sidecar `.karaoke.json` conserva il casing originale Whisper (merge BPE / tempi invariati). Soft-fail, display mode e pipeline STT-before-instrumental invariati. Include v2.3.9 (companion cublasLt Windows CUDA). Pacchetto **2.3.10**.

### Cosa c’è di nuovo
- **Testo STT in MAIUSCOLO** — overlay Stage e parole bruciate sul video.
- Stesso helper di casing per entrambi i percorsi di visualizzazione.

### Download

| Piattaforma | File | Note |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.10.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.10-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.10.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.10_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.10-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

### Breaking Changes
- Nessuno. Casing solo in visualizzazione; merge/timings/displayMode/soft-fail invariati. Companion cublasLt (#96 / v2.3.9) invariato.

---

# 🇬🇧 Release Notes — Version 2.3.10

New GitHub release **v2.3.10**. STT karaoke text is shown in **UPPERCASE** on both the Stage overlay and ASS burn-in (`\kf`), from the same shared helper — so both display paths stay aligned. The `.karaoke.json` sidecar keeps original Whisper casing (BPE merge / timings unchanged). Soft-fail, display mode, and STT-before-instrumental pipeline unchanged. Includes v2.3.9 (Windows CUDA cublasLt companion). Package **2.3.10**.

### What's new
- **STT lyrics in UPPERCASE** — Stage overlay and burned-in video words.
- Same casing helper for both display paths.

### Download

| Platform | File | Notes |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.10.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.10-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.10.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.10_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.10-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

### Breaking Changes
- None. Display-only casing; merge/timings/displayMode/soft-fail unchanged. cublasLt companion (#96 / v2.3.9) unchanged.

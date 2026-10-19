# 🎤 Karaoke Live Station v2.3.7 — Release Notes

---

# 🇮🇹 Note di Rilascio — Versione 2.3.7

Nuova release GitHub **v2.3.7**. In **Impostazioni → Libreria & Download** puoi **scaricare e gestire** tutti i modelli Whisper del catalogo (tiny / base / small / medium / large-v3): stato e taglia, **Scarica**, **Rimuovi**, selettore default STT (fabbrica **medium**), badge **In uso**. Stesso path `userData/models/whisper`; dopo il download funziona offline; niente STT cloud. Pacchetto **2.3.7**.

### Cosa c’è di nuovo
- **Scarica modelli Whisper dalle Opzioni** — non solo al primo job STT.
- **Badge In uso / Predefinito** — modello corrente vs default di fabbrica medium.
- **Progresso in riga** durante il download on-demand.

### Download

| Piattaforma | File | Note |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.7.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.7-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.7.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.7_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.7-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

### Breaking Changes
- Nessuno. Default medium, soft-fail STT, ordine pipeline, display mode (#93), Win DLL/CUDA+ETA (#91/#92) invariati.

---

# 🇬🇧 Release Notes — Version 2.3.7

New GitHub release **v2.3.7**. Under **Settings → Library & Download** you can **download and manage** every Whisper catalog model (tiny / base / small / medium / large-v3): status and size, **Download**, **Remove**, STT default picker (factory **medium**), **In use** badge. Same `userData/models/whisper` path; offline after download; no cloud STT. Package **2.3.7**.

### What's new
- **Download Whisper models from Options** — not only on the first STT job.
- **In use / Default badges** — current model vs factory medium.
- **Per-row progress** during on-demand download.

### Download

| Platform | File | Notes |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.7.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.7-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.7.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.7_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.7-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

### Breaking Changes
- None. Medium default, soft-fail STT, pipeline order, display mode (#93), Win DLL/CUDA+ETA (#91/#92) unchanged.

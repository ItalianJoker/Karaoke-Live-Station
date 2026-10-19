# 🎤 Karaoke Live Station v2.3.6 — Release Notes

---

# 🇮🇹 Note di Rilascio — Versione 2.3.6

Nuova release GitHub **v2.3.6**. Download Strumentale + STT: scelta mutuamente esclusiva **Parole su video** (burn-in ASS karaoke `\kf`) **oppure** **Solo Stage (overlay)**; merge BPE (“Acc anto” → Accanto) con fill a tempo sulle sillabe token; hint lingua per traccia; soft-fail e packaging Win DLL/CUDA invariati. Pacchetto **2.3.6**.

### Cosa c’è di nuovo
- **Parole su video / Solo Stage** — sotto-scelta STT + **Salva scelta** (`sttDisplayMode`); default burn-in.
- **Merge BPE** — token Whisper uniti in parole ortografiche; `syllables[]` con timestamp originali.
- **ASS karaoke** — `\kf` allineato allo Stage (stessa segmentazione).
- **Lingua** — hint Whisper `-l` da lingua UI/traccia quando nota, altrimenti auto.

### Download

| Piattaforma | File | Note |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.6.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.6-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.6.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.6_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.6-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

### Breaking Changes
- Nessuno. Sidecar legacy senza `displayMode` restano a doppia visualizzazione (opzione A). Soft-fail STT, ordine pipeline, default medium, #91/#92 Windows DLL/CUDA+ETA invariati.

---

# 🇬🇧 Release Notes — Version 2.3.6

New GitHub release **v2.3.6**. Download Instrumental + STT: mutually exclusive **Words on video** (ASS karaoke `\kf` burn-in) **or** **Stage overlay only**; BPE merge (“Acc anto” → Accanto) with fill-a-tempo token syllables; per-track language hint; soft-fail and Win DLL/CUDA packaging unchanged. Package **2.3.6**.

### What's new
- **Words on video / Stage only** — STT sub-choice + **Remember choice** (`sttDisplayMode`); default burn-in.
- **BPE merge** — Whisper tokens merged into orthographic words; `syllables[]` keep original timestamps.
- **ASS karaoke** — `\kf` aligned with Stage (same segmentation).
- **Language** — Whisper `-l` from UI/track language when known, else auto.

### Download

| Platform | File | Notes |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.6.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.6-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.6.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.6_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.6-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

### Breaking Changes
- None. Legacy sidecars without `displayMode` keep dual display (option A). Soft-fail STT, pipeline order, medium default, and #91/#92 Win DLL/CUDA+ETA unchanged.

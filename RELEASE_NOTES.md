# 🎤 Karaoke Live Station v2.3.7 — Release Notes

---

# 🇮🇹 Note di Rilascio — Versione 2.3.7

Nuova release GitHub **v2.3.7**. Corregge ETA STT nel menu Download e l’uso GPU CUDA su Windows (companion `cublas64_11.dll` mancante nello zip ufficiale whisper). Soft-fail, ordine pipeline, display mode v2.3.6 e packaging DLL (#91) invariati. Pacchetto **2.3.7**.

### Cosa c’è di nuovo
- **ETA STT** — il chip Downloads mostra di nuovo `· ETA mm:ss` durante `stt_transcribing` (non solo download / rimozione voci).
- **CUDA Windows** — dopo lo zip cuBLAS 11.8 si assicura `cublas64_11.dll` (Toolkit locale o download companion) così whisper-cli non cade sempre su CPU BLAS.
- **Knobs GPU** — DSP+STT e `ensure-binary` rispettano i Settings Instrumental AI.

### Download

| Piattaforma | File | Note |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.7.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.7-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.7.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.7_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.7-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

### Breaking Changes
- Nessuno. Soft-fail STT, ordine pipeline, default medium, burn-in/stage, #91/#92 packaging invariati.

---

# 🇬🇧 Release Notes — Version 2.3.7

New GitHub release **v2.3.7**. Fixes STT Downloads **ETA** visibility and Windows **CUDA** STT (missing `cublas64_11.dll` companion in the official whisper zip). Soft-fail, pipeline order, v2.3.6 display mode, and #91 DLL packaging unchanged. Package **2.3.7**.

### What's new
- **STT ETA** — Downloads chip shows `· ETA mm:ss` again during `stt_transcribing` (not only download / vocal removal).
- **Windows CUDA** — after the cuBLAS 11.8 zip, ensure `cublas64_11.dll` (local Toolkit or companion download) so whisper-cli does not always fall back to CPU BLAS.
- **GPU knobs** — DSP+STT and `ensure-binary` honor Instrumental AI Settings.

### Download

| Platform | File | Notes |
| --- | --- | --- |
| **Windows** | `Karaoke Live Station 2.3.7.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.7-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.7.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.7_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.7-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

### Breaking Changes
- None. Soft-fail STT, pipeline order, medium default, burn-in/stage, #91/#92 packaging unchanged.

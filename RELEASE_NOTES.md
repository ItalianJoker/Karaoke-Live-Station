# 🎤 Karaoke Live Station v2.2.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

## [Unreleased] — Audit remediation (docs, no version bump)

### 🇮🇹
Allineamento documentazione post-**v2.2.0** (pacchetto resta **2.2.0**):
- DSP pitch/speed: default **Signalsmith Stretch Hi-Fi** (`signalsmith`; legacy `bungee` migra); tempo via `playbackRate` + `preservesPitch`; SoundTouch = fallback leggero/emergenza; MIDI/KAR = SpessaSynth.
- Download: completamenti solo nel menu Download header (`library.downloadCompleted`); niente badge/toast fullscreen «Download completato».
- Temi: **10**; **Studio Desk** = default Regia; altri temi Regia Legacy; Palco default Dark Stage.
- Cookie YouTube: obbligatori per ogni download; path `<userData>/youtube/cookies.txt`; Accedi/Cancella in Impostazioni → Libreria & Download; search usa cookie solo se già validi.
- GPU AI: badge Impostazioni = probe capacità; chip Download = backend sessione WebGPU/WASM durante rimozione AI.

### 🇬🇧
Post-**v2.2.0** documentation alignment (package remains **2.2.0**):
- Pitch/speed DSP: default **Signalsmith Stretch Hi-Fi** (`signalsmith`; legacy `bungee` migrates); tempo via `playbackRate` + `preservesPitch`; SoundTouch = light/emergency fallback; MIDI/KAR = SpessaSynth.
- Downloads: completions only in the header Downloads menu (`library.downloadCompleted`); no dismissible fullscreen «Download completato» badge/toast.
- Themes: **10**; **Studio Desk** = default Control; other Control themes Legacy; Stage default Dark Stage.
- YouTube cookies: required for every download; path `<userData>/youtube/cookies.txt`; Sign in / Clear in Settings → Library & Download; search uses cookies only if already valid.
- AI GPU: Settings badge = capability probe; Downloads chip = session WebGPU/WASM during AI removal.

---

<a name="v220-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.2.0

Nuova release GitHub **v2.2.0**. Autenticazione cookie YouTube automatica per yt-dlp (senza export manuale), correzione packaging/runtime macOS per i download web e guida Gatekeeper per le build unsigned. Pacchetto **2.2.0**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.2.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.2.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.2.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.2.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.2.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🔐 Accesso YouTube automatico per yt-dlp
- I **cookie sono obbligatori per ogni download YouTube** (nessun tentativo anonimo). Se mancano o non sono validi, si apre una finestra Electron dedicata (session partition isolata) per il login (2FA e CAPTCHA supportati).
- I cookie vengono convertiti in formato Netscape e salvati in `<userData>/youtube/cookies.txt`, poi usati da yt-dlp con `--cookies`.
- Controlli manuali in **Impostazioni → Libreria & Download**: Accedi a YouTube / Cancella cookie. La ricerca Web usa i cookie solo se già validi (può toastare Accedi senza aprire il login).

### 🍎 Download macOS affidabili
- La release **v2.1.0** pubblicava una zip macOS senza `yt-dlp` nel bundle (l’artifact CI lo conteneva). Da **v2.2.0** il build fallisce se manca `yt-dlp`/`ffmpeg` nel pacchetto.
- Clear della quarantena Gatekeeper sui binari helper dopo seed/download; avvio più rapido dell’auto-download yt-dlp se il binario gestito manca.
- Nel README: procedura passo-passo per aprire la build **unsigned** (quarantine `xattr`, primo avvio).

---

<a name="v220-english"></a>
# 🇬🇧 Release Notes — Version 2.2.0

New GitHub release **v2.2.0**. Automated YouTube cookie authentication for yt-dlp (no manual export), macOS packaging/runtime fixes for web downloads, and Gatekeeper guidance for unsigned builds. Package **2.2.0**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.2.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.2.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.2.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.2.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.2.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this version

### 🔐 Automated YouTube login for yt-dlp
- **Cookies are required for every YouTube download** (no anonymous attempt). When missing or invalid, a dedicated Electron window opens (isolated session partition) for sign-in (2FA and CAPTCHA supported).
- Cookies are converted to Netscape format, saved under `<userData>/youtube/cookies.txt`, and passed to yt-dlp via `--cookies`.
- Manual controls in **Settings → Library & Download**: Sign in to YouTube / Clear cookies. Web search uses cookies only if already valid (may toast Sign in without opening login).

### 🍎 Reliable macOS downloads
- The published **v2.1.0** macOS zip was missing bundled `yt-dlp` (the CI artifact had it). From **v2.2.0** the build fails if `yt-dlp`/`ffmpeg` are absent from the package.
- Gatekeeper quarantine is cleared on helper binaries after seed/download; faster yt-dlp auto-download startup when the managed binary is missing.
- README: step-by-step procedure to run the **unsigned** Mac build (quarantine `xattr`, first open).

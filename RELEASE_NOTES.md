# 🎤 Karaoke Live Station v2.3.3 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

## [Unreleased]

_(empty)_

---

<a name="v233-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.3.3

Nuova release GitHub **v2.3.3**. Fix generazione STT per Stage (`whisper-cli` `-ojf`), log di troubleshooting, soft-fail visibile, promote sidecar più robusto, e **burn-in ASS** sullo strumentale. Pacchetto **2.3.3**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.3.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.3-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.3.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.3_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.3-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🎤 STT Stage + burn-in ASS (#90)
- **Fix CLI:** `whisper-cli` usa `-ojf` (niente più `-ow` invalido) così nasce un `.karaoke.json` reale per l’overlay Stage.
- **Burn-in:** lo script STT scrive un `.ass` bruciato nel MP4 strumentale (stesso path ffmpeg dei sottotitoli YouTube); Stage continua a usare il sidecar.
- **Soft-fail:** se lo STT fallisce, lo strumentale resta utilizzabile ma menu Download + toast ambra avvisano (niente successo silenzioso senza testo).
- **Log:** DEBUG/INFO/WARN/ERROR correlati con `downloadId` per diagnosticare Stage blank.
- **Durabilità:** promote sidecar prima di unlink se la destinazione libreria/coda esiste già.

---

<a name="v233-english"></a>
# 🇬🇧 Release Notes — Version 2.3.3

New GitHub release **v2.3.3**. Stage STT generation fix (`whisper-cli` `-ojf`), troubleshooting logs, visible soft-fail, harder sidecar promote, and **ASS burn-in** on the instrumental. Package **2.3.3**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.3.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.3-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.3.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.3_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.3-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this version

### 🎤 Stage STT + ASS burn-in (#90)
- **CLI fix:** `whisper-cli` uses `-ojf` (no more invalid `-ow`) so a real `.karaoke.json` is written for the Stage overlay.
- **Burn-in:** STT writes an `.ass` burned into the instrumental MP4 (same ffmpeg path as YouTube subs); Stage still uses the sidecar.
- **Soft-fail:** if STT fails, the instrumental stays usable but Downloads menu + amber toast warn (no silent success without lyrics).
- **Logs:** DEBUG/INFO/WARN/ERROR correlated with `downloadId` to diagnose blank Stage.
- **Durability:** promote sidecars before unlink when library/queue destination already exists.

# 🎤 Karaoke Live Station v2.3.2 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

## [Unreleased]

_(empty)_

---

<a name="v232-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.3.2

Nuova release GitHub **v2.3.2**. Include il fix #88 già su `main`: pipeline Download Strumentale + STT nell’ordine corretto — download → Whisper sull’originale → rimozione voci → strumentale → sidecar STT sul finale. Pacchetto **2.3.2**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.2.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.3.2-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.3.2.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.3.2_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.3.2-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🎤 Pipeline STT nell’ordine corretto (#88)
- Download → **Whisper sul video originale** → rimozione voci → remux strumentale → promozione sidecar `.karaoke.json` (e `.ass` se presente) accanto allo strumentale finale.
- I sidecar seguono anche `saveToLibrary` / `saveToQueueCache` così Stage non resta orfano.
- Restano i guard di #86: Whisper non riceve mai `*.instrumental*`.

---

<a name="v232-english"></a>
# 🇬🇧 Release Notes — Version 2.3.2

New GitHub release **v2.3.2**. Ships the #88 fix already on `main`: Download Instrumental + STT in the correct order — download → Whisper on original → remove vocals → instrumental → STT sidecar on final. Package **2.3.2**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.3.2.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.3.2-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.3.2.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.3.2_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.3.2-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this version

### 🎤 STT pipeline in the correct order (#88)
- Download → **Whisper on the original video** → vocal removal → instrumental remux → promote `.karaoke.json` sidecar (and `.ass` if present) beside the final instrumental.
- Sidecars also follow `saveToLibrary` / `saveToQueueCache` so Stage is not orphaned.
- #86 guards kept: Whisper never receives `*.instrumental*`.

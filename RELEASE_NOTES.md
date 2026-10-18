# 🎤 Karaoke Live Station v2.2.1 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

## [Unreleased]

_(empty)_

---

<a name="v221-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.2.1

Nuova release GitHub **v2.2.1**. Include la remediation post-audit già su `main` (#83): allineamento docs/UX con Signalsmith, Studio Desk default Regia, cookie YouTube obbligatori, Cancel durante login, honesty GPU, e fix perf. Pacchetto **2.2.1**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.2.1.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.2.1-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.2.1.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.2.1_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.2.1-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🛠️ Remediation audit (UX / docs / perf)
- **Cancel** durante login cookie YouTube funziona (`awaiting_auth`; chiude/porta avanti la finestra auth).
- DSP pitch/speed docs: default **Signalsmith Stretch Hi-Fi**; tempo via `playbackRate` + `preservesPitch`; toast su fallback SoundTouch.
- Download: completamenti solo nel menu Download header; chip backend AI (WebGPU/WASM); snapshot job attivi dopo refresh; persist marchi file mancante.
- Temi: **10**; **Studio Desk** = default Regia; `embedded` solo su Studio Desk.
- Cookie YouTube: obbligatori per ogni download; path `<userData>/youtube/cookies.txt`; toast Accedi su search auth fail.
- GPU AI: badge Impostazioni = probe capacità; chip Download = backend sessione.
- Perf: Guest `getTrackById`, FFT worker, ZIP analysis async, MIDI Worker, vocal-remover disconnect-when-off, virt prefix memo.

---

<a name="v221-english"></a>
# 🇬🇧 Release Notes — Version 2.2.1

New GitHub release **v2.2.1**. Ships the post-audit remediation already on `main` (#83): docs/UX alignment with Signalsmith, Studio Desk default Control, required YouTube cookies, Cancel during login, GPU honesty, and perf fixes. Package **2.2.1**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.2.1.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.2.1-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.2.1.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.2.1_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.2.1-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this version

### 🛠️ Audit remediation (UX / docs / perf)
- **Cancel** during YouTube cookie login works (`awaiting_auth`; closes/brings auth window front).
- Pitch/speed docs: default **Signalsmith Stretch Hi-Fi**; tempo via `playbackRate` + `preservesPitch`; toast on SoundTouch fallback.
- Downloads: completions only in header Downloads menu; AI backend chip (WebGPU/WASM); active-job snapshot after refresh; persist missing-file marks.
- Themes: **10**; **Studio Desk** = default Control; `embedded` only for Studio Desk.
- YouTube cookies: required for every download; path `<userData>/youtube/cookies.txt`; Sign-in toast on search auth fail.
- AI GPU: Settings badge = capability probe; Downloads chip = session backend.
- Perf: Guest `getTrackById`, FFT worker, ZIP analysis async, MIDI Worker, vocal-remover disconnect-when-off, virt prefix memo.

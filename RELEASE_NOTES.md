# 🎤 Karaoke Live Station v2.0.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v200-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.0.0

Nuova release GitHub **v2.0.0** (tag nuovo; **non** sovrascrive `v1.5.0` / `v1.4.0` / `v1.3.0` / `v1.2.0` / `v1.1.0`). Parte dalla baseline **v1.5.0** (#72 + #74 + #76) e include **#77–#80**. Pacchetto **2.0.0**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.0.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.0.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.0.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.0.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.0.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🎛️ Studio Desk default + polish UX (#77)
- **Default Regia** → tema **`studio-desk`** (primo in picker; altri temi etichettati « (Legacy)»).
- Persistenza: chi ha già un altro `themeHost` salvato **lo conserva**.
- Polish layout Studio: colonne, menu, deck, MIDI note-on meters, card libreria, Stage pill, relaunch al cambio tema Regia.
- Id temi invariati; path Regia classica resta disponibile.

### 🖥️ Palco su display esterno + velocità (#78)
- Stage/Palco posizionato sul monitor non primario (fullscreen su TV/proiettore; finestra centrata su singolo display).
- Badge velocità/tonalità sul Palco in forma parentesi: `1.00x (103 BPM)`, `0 (D)`.
- Fallback CSS opaco `#000` su `.stage-screen-container`.

### 📚 Aggiorna Libreria + DnD overlay (#80)
- **Aggiorna Libreria** ricalcola i flag «file mancante» e toglie i falsi positivi quando il file torna su disco.
- Overlay drag-and-drop Library/Coda non resta bloccato dopo drop sulla coda (Studio + Regia classica).

### 🔎 Mostra in Libreria Locale dalla Coda (#79)
- Pulsante su ogni riga eleggibile della Coda: apre Libreria Locale, cerca/scorre ed evidenzia il brano (id / percorso).
- File mancante → modale esistente; brano non in catalogo → toast. Condiviso classic + Studio Desk.

### 🔑 Già in 1.5.0 (baseline inclusa)
- Key/BPM sempre visibili + dialogo seconda istanza (#74).
- Studio Desk introdotto come tema opt-in (#76) — ora default in 2.0.0 via #77.
- Hot path libreria / download / Guest, Logger strutturato, prune deps (#72).

### 🏷️ Versione
- Badge UI / pacchetto **v2.0.0**.

## ✅ Baseline 1.5.0
Resta incluso: hot path 14k+, Studio Desk shell, Key/BPM UX, Signalsmith Hi-Fi DSP, ZIP CD+G, AI WebGPU / quit watchdog, Library Phase 2 FTS5, modal sottotitoli strumentale, Safety-First modularizzazione.

---

<a name="v200-english"></a>
# 🇬🇧 Release Notes — Version 2.0.0

New GitHub release **v2.0.0** (new tag; does **not** overwrite `v1.5.0` / `v1.4.0` / `v1.3.0` / `v1.2.0` / `v1.1.0`). Builds on **v1.5.0** baseline (#72 + #74 + #76) and includes **#77–#80**. Package **2.0.0**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.0.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.0.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.0.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.0.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.0.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new

### 🎛️ Studio Desk default + UX polish (#77)
- **Default Control Room** → **`studio-desk`** theme (first in picker; other themes labeled « (Legacy)»).
- Persistence: an already-saved different `themeHost` is **kept**.
- Studio layout polish: columns, menu, deck, MIDI note-on meters, library cards, Stage pill, relaunch on Control Room theme change.
- Theme ids unchanged; classic Regia path remains available.

### 🖥️ Stage on external display + speed (#78)
- Stage placed on the non-primary monitor (fullscreen on TV/projector; centered window on single display).
- Stage speed/pitch badges in parentheses form: `1.00x (103 BPM)`, `0 (D)`.
- Opaque `#000` CSS fallback on `.stage-screen-container`.

### 📚 Refresh Library + DnD overlay (#80)
- **Refresh Library** re-checks missing-file flags and clears false positives when the file is back on disk.
- Library/Queue OS drag overlays no longer stick after a queue drop (Studio + classic Regia).

### 🔎 Show in Local Library from Queue (#79)
- Control on each eligible Queue row: opens Local Library, searches/scrolls and highlights the track (id / path).
- Missing file → existing modal; not in catalog → toast. Shared classic + Studio Desk.

### 🔑 Already in 1.5.0 (baseline included)
- Always-visible Key/BPM + second-instance dialog (#74).
- Studio Desk introduced as opt-in (#76) — now default in 2.0.0 via #77.
- Library / download / Guest hot paths, structured Logger, deps prune (#72).

### 🏷️ Version
- UI badge / package **v2.0.0**.

## ✅ 1.5.0 baseline
Still includes: 14k+ hot paths, Studio Desk shell, Key/BPM UX, Signalsmith Hi-Fi DSP, ZIP CD+G, AI WebGPU / quit watchdog, Library Phase 2 FTS5, instrumental subtitles modal, Safety-First modularization.

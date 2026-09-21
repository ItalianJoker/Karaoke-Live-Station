# 🎤 Karaoke Live Station v2.1.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v210-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 2.1.0

Nuova release GitHub **v2.1.0**. Include il nuovo sistema di verifica aggiornamenti, il ripristino affidabile della tonalità al riavvio, migliorie grafiche al layout Studio Desk, gating dei file MIDI e correzioni alla ricerca locale con caratteri speciali. Pacchetto **2.1.0**.

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.1.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-2.1.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-2.1.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_2.1.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-2.1.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 🔄 Controllo Aggiornamenti Software (Fase 1)
- **Verifica automatica all'avvio:** L'applicazione interroga in background le release ufficiali di GitHub (con debounce di 24 ore) e mostra una modale interattiva in caso di nuova versione disponibile.
- **Verifica manuale su richiesta:** Pulsante dedicato in **Impostazioni → Generali** con stato di caricamento e changelog formattato.
- **Configurazione utente:** Possibilità di attivare o disattivare la ricerca automatica degli aggiornamenti nelle preferenze generali.

### 🎵 Ripristino Tonalità al Riavvio (Pitch Offset Restore)
- Se una canzone nella coda viene modificata di tonalità (es. `-2 ST`), chiudendo e riaprendo il programma la canzone parte immediatamente con la tonalità impostata e non con l'originale a `0 ST`.
- Rehydration store istantanea al caricamento e allineamento sincronizzato con Regia, Stage Window e AudioGraphManager (Signalsmith / SpessaSynth).

### 🎛️ Regia Studio Desk: Tipografia & Layout DSP
- Testi dei BPM e della tonalità ingranditi e perfettamente centrati sotto le etichette VELOCITÀ e TONALITÀ.
- Altezza del pannello allineata con i pulsanti di controllo del player.

### 📁 Gating Libreria File MIDI / KAR
- I file MIDI/KAR già presenti permanentemente su disco non mostrano più erroneamente il pulsante "Salva in libreria" nella coda e nei deck di riproduzione.
- Preservato il tipo `midi` durante i salvataggi dalla cache e nella logica di deduplica locale.

### 🔍 Ricerca Locale & "Mostra in Libreria Locale"
- Risolto il problema che causava l'errore "Brano non trovato nella Libreria Locale" su titoli con underscore (`_`) o trattini (`-`).
- Corretta la sintassi FTS5 (`WHERE tracks_fts MATCH ?`) e implementata una tokenizzazione Unicode robusta.
- Fallback LIKE multi-token con escaping sicuro (`ESCAPE '\'`) capace di trovare qualsiasi traccia anche senza corrispondenza FTS esatta.

---

<a name="v210-english"></a>
# 🇬🇧 Release Notes — Version 2.1.0

New GitHub release **v2.1.0**. Introduces the software update checker, reliable pitch offset restoration across restarts, Studio Desk DSP deck typography polish, MIDI library gating, and special-character local search reveal fixes. Package **2.1.0**.

## 📦 Installer Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 2.1.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-2.1.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-2.1.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_2.1.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-2.1.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new

### 🔄 Software Update Checker (Phase 1)
- **Automatic startup check:** Checks GitHub Releases in the background (with 24-hour debounce) and presents an interactive notification modal when a newer release is published.
- **Manual check on demand:** Check button in **Settings → General** displaying live status, version badge, and release changelog.
- **Configurable:** Option to toggle automatic update checks on or off at any time.

### 🎵 Pitch Offset Restore on Restart
- When a song in the queue has an adjusted pitch (e.g. `-2 ST`), restarting the software now retains and plays that pitch rather than reverting to the original at `0 ST`.
- Instant store rehydration on hydration and seamless alignment with Control Room, Stage Window, and AudioGraphManager (Signalsmith / SpessaSynth).

### 🎛️ Studio Desk: DSP Deck Layout & Typography
- Enlarged and centered BPM and pitch numeric displays positioned under SPEED and PITCH labels.
- Panel container height aligned with player transport buttons.

### 📁 MIDI / KAR Library Membership
- Permanent local MIDI/KAR tracks no longer incorrectly display the "Save to library" button in the queue and deck headers.
- Native `midi` source preserved when saving from cache and during catalog deduplication.

### 🔍 Local Search & "Show in Local Library"
- Fixed the issue where clicking "Show in Local Library" on tracks with underscores (`_`) or hyphens (`-`) reported "Track not found in Local Library".
- Fixed FTS5 query syntax (`WHERE tracks_fts MATCH ?`) and Unicode word boundary tokenization.
- Multi-token LIKE fallback with wildcard escaping (`ESCAPE '\'`) ensuring reliable row matching and instant highlighting.

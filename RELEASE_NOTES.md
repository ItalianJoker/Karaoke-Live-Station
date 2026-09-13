# 🎤 Karaoke Live Station v1.0.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.0.0

Benvenuti alla release ufficiale di **Karaoke Live Station**, la workstation desktop professionale, multipiattaforma e autonoma per DJ di karaoke, presentatori di eventi, locali di intrattenimento e feste private.

---

## 📦 File di Installazione ed Eseguibili Inclusi

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.0.0.exe` | Eseguibile portatile autonomo (avvio immediato senza installazione o privilegi admin) |
| **Windows** | `Karaoke Live Station-1.0.0-win.zip` | Archivio compresso completo per Windows a 64-bit |
| **Linux** | `Karaoke Live Station-1.0.0.AppImage` | Pacchetto universale AppImage per tutte le distribuzioni Linux |
| **Linux** | `karaoke-live-station_1.0.0_amd64.deb` | Pacchetto debian nativo per Ubuntu, Debian e Linux Mint |
| **macOS** | `Karaoke Live Station-1.0.0-mac.zip` | Bundle applicativo `.app` per macOS (Intel e Apple Silicon via Rosetta) |

*Tutti i pacchetti includono già i binari necessari compilati per la piattaforma (`yt-dlp`, `ffmpeg`, `better-sqlite3` e il banco sonoro GeneralUser GS SoundFont da 31 MB), garantendo funzionamento offline immediato e zero configurazioni di sistema.*

---

## 🌟 Novità e Funzionalità Principali

### 🛡️ Assistente Firewall & Connessione LAN Multipiattaforma
- **Diagnosi Automatica al Volo**: Rileva in tempo reale il sistema operativo in uso ed esegue un'ispezione non invasiva dello stato del firewall di sistema:
  - **Windows**: Controlla le regole di ingresso di *Windows Defender Firewall* tramite `netsh advfirewall`.
  - **macOS**: Rileva lo stato globale del firewall applicativo (*Application Firewall - ALF*) tramite `socketfilterfw`.
  - **Linux**: Ispeziona lo stato di *UFW* (`/etc/ufw/ufw.conf`) e genera comandi per *UFW* e *Firewalld*.
- **Comandi di Sblocco con Copia in 1 Clic**: Se gli smartphone del pubblico non riescono a caricare la pagina web (porta TCP 3000-3010), l'assistente fornisce il comando terminale o PowerShell pronto all'uso. Ciascun comando è dotato di pulsante di copia dedicato nella testata e visualizzazione orizzontale a scorrimento (`whitespace-pre font-mono`) che garantisce la massima leggibilità senza tagli o troncamenti.
- **Istruzioni Grafiche Passo-Passo (GUI)**: Guida integrata per configurare l'autorizzazione di rete tramite il Pannello di Controllo di Windows o le Impostazioni di Rete di macOS.
- **Avviso Isolamento AP Wi-Fi**: Promemoria per verificare e disattivare l'opzione "Isolamento AP" (AP Client Isolation) nelle impostazioni del router Wi-Fi.
- **Nuovo Modal QR Code a 2 Colonne**: Finestra di dialogo ingrandita e responsive che affianca il codice QR da inquadrare con lo smartphone alla guida di connessione e diagnostica firewall.

### 🌐 Supporto Multilingua Nativo Completo (i18n)
- **4 Lingue Supportate al 100%**:
  - 🇮🇹 **Italiano** (Lingua nativa con interfaccia completa, gestione SIAE e guide)
  - 🇬🇧 **English** (Full international English translation across all dialogs and features)
  - 🇪🇸 **Español** (Traducción completa al español para consola y pantalla del escenario)
  - 🇫🇷 **Français** (Traduction française intégrale de la régie et de la scène)
- **Rilevamento Automatico della Lingua**: All'avvio l'applicazione rileva la lingua del sistema operativo dell'utente con fallback intelligente.
- **Cambio Lingua Istantaneo**: Dalla finestra Opzioni (`Impostazioni` ➔ `Lingua / Language`) è possibile cambiare lingua in qualsiasi momento con salvataggio immediato delle preferenze.

### 🎛️ Architettura a Doppia Finestra Indipendente
- **Finestra Regia (Control Desk)**: Console operatore con scrubber temporale, visualizzatore di forma d'onda, mixer a 16 canali MIDI, gestione scaletta, ricerca catalogo e pre-ascolto CUE in cuffia su scheda audio secondaria.
- **Finestra Palco (Stage Screen)**: Schermo pulito per cantante e pubblico da inviare su TV o videoproiettore (supporto F11 / doppio clic per fullscreen senza bordi). Visualizza video MP4/WebM, grafica CD+G a 30 fps o testo karaoke con banner animati *"Ora Canta"* e *"Preparati"*.
- **Streaming HTTP 206 Partial Content**: Protocollo proprietario `karaoke://local/` con streaming a chunk byte-range per aprire, chiudere o spostare lo schermo del palco senza interruzioni audio né desincronizzazioni.
- **9 Temi Grafici Selezionabili**: Personalizzazione estetica indipendente per regia e palco.

### 🎵 Motore DSP Audio in Tempo Reale
- **Pitch-Shifting SoundTouch WSOLA**: Variazione della tonalità da -8 a +8 semitoni ad altissima fedeltà su audio e video senza distorsioni armoniche.
- **Time-Stretching (0.50x – 1.50x)**: Regolazione fine della velocità di esecuzione senza alterazione del pitch.
- **Vocal Remover DSP Multi-Banda**: Architettura a 3 bande con filtri Butterworth (bassi intatti in mono, cancellazione voce solista stereo differenziale, alte frequenze e riverbero preservati).
- **Normalizzazione Dinamica del Volume (Auto-Leveling)**: Compressore dinamico integrato con soglia a -22 dB e makeup gain a 1.35x per uniformare automaticamente il livello sonoro tra basi YouTube, file locali MP3+G e tracce MIDI.

### 🎹 Sintesi MIDI & KAR con SpessaSynth
- **SoundFont GeneralUser GS (31 MB) Integrato**: Suono acustico realistico preconfigurato out-of-the-box.
- **Scheduler MIDI a Latenza Zero (5 ms)**: Esecuzione su Web Worker con ranking rigoroso delle priorità di evento MIDI.
- **Mixer Live a 16 Canali**: Muting istantaneo di singoli strumenti (es. traccia guida vocale).

### ⚖️ Algoritmo Fair Queue, Persistenza Coda & Memoria Tonalità
- **Rotazione Equa Anti-Monopolio**: Calcola automaticamente la scaletta ideale in base al numero di canzoni già cantate da ciascun partecipante e all'orario di richiesta.
- **Drag & Drop della Coda**: Riordino visivo con il mouse dei brani in attesa nella scaletta.
- **Persistenza Scaletta & Protezione Anti-Crash**: La coda viene memorizzata costantemente nello storage locale e ripristinata automaticamente ad ogni avvio.
- **Pulsante "Svuota Coda"**: Funzione rapida protetta da conferma di sicurezza per azzerare l'intera scaletta e fermare la riproduzione in un solo passaggio.
- **Memoria Tonalità Cantante**: Memorizzazione automatica della trasposizione preferita per ciascun cantante registrato.

### 📁 Gestione Libreria & Anteprima Video 16:9
- **Scelta Guidata al Primo Avvio**: Dialogo interattivo per scegliere tra la cartella predefinita `~/Karaoke` o una directory personalizzata esistente.
- **Auto-Refresh all'Avvio & Pulsante 1-Clic**: Scansione automatica all'apertura del software e refresh manuale istantaneo senza riaprire il selettore di cartelle.
- **Player di Anteprima Video 16:9**: Verifica immediata della versione (KaraFun, Sing King, con cori, strumentale) con player audio/video integrato.

### 📱 Portale Ospiti Mobile via Wi-Fi (Guest Portal)
- **Server LAN Express + Socket.IO Integrato**: Zero configurazioni di rete richieste.
- **Codice QR Dinamico**: Gli ospiti inquadrano il QR code con lo smartphone, cercano brani reali nella libreria e inviano richieste con la propria tonalità desiderata.
- **Approvazione DJ Immediata**: Il gestore approva le richieste con un clic, inserendole in scaletta con la trasposizione corretta.

### 📜 Tab Storico Esecuzioni & Borderò SIAE
- **Registro Cronologico Persistente**: Memorizza tutte le esecuzioni completate su database SQLite (`siae_logs`) con titolo, artista, cantante, data/ora e durata.
- **Esportazione Borderò SIAE (CSV)**: Generazione con un clic del file CSV conforme per la rendicontazione dei diritti d'autore.
- **Sistema di Log Diagnostico**: Log rotativo su file con livelli configurabili (Debug, Info, Warn, Error).

### ☕ Supporto al Progetto
- Banner integrato con collegamento diretto per donazioni libere con PayPal a sostegno dello sviluppo continuo.

---
<br/>

<a name="english"></a>
# 🇬🇧 Release Notes — Version 1.0.0

Welcome to the official release of **Karaoke Live Station**, the professional, cross-platform, standalone live karaoke management workstation designed for live entertainers, KJs, venues, and party hosts.

---

## 📦 Packaged Executables & Distribution Files

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.0.0.exe` | Portable standalone executable (launches instantly without installation or admin rights) |
| **Windows** | `Karaoke Live Station-1.0.0-win.zip` | Full portable compressed archive for 64-bit Windows |
| **Linux** | `Karaoke Live Station-1.0.0.AppImage` | Universal AppImage bundle compatible with all major Linux distributions |
| **Linux** | `karaoke-live-station_1.0.0_amd64.deb` | Native deb package for Debian, Ubuntu, and Linux Mint |
| **macOS** | `Karaoke Live Station-1.0.0-mac.zip` | Standalone `.app` bundle for macOS (Intel & Apple Silicon via Rosetta) |

*All packages bundle precompiled platform-specific binaries (`yt-dlp`, `ffmpeg`, `better-sqlite3`, and the 31 MB GeneralUser GS SoundFont soundbank), delivering out-of-the-box offline operation with zero external dependencies.*

---

## 🌟 What's New & Key Highlights

### 🛡️ Cross-Platform Firewall & LAN Connection Assistant
- **Automated Live Diagnosis**: Dynamically identifies the host operating system and safely probes the local firewall status:
  - **Windows**: Checks inbound access rules in *Windows Defender Firewall* via `netsh advfirewall`.
  - **macOS**: Queries the global state of the *macOS Application Firewall (ALF)* via `socketfilterfw`.
  - **Linux**: Probes *UFW* status (`/etc/ufw/ufw.conf`) and provides rule generation for *UFW* and *Firewalld*.
- **1-Click Copyable Unblock Commands**: If guest smartphones cannot reach the mobile portal (TCP ports 3000–3010), the assistant delivers copy-ready terminal/PowerShell commands. Each command is presented in a dedicated command box with a top-bar copy button and horizontal scrolling (`whitespace-pre font-mono`) to prevent command clipping or mid-token line breaks.
- **Step-by-Step Graphical (GUI) Guides**: Step-by-step instructions for allowing incoming connections through the Windows Defender Control Panel or macOS System Settings.
- **Wi-Fi AP Isolation Guidance**: Diagnostic tip reminding hosts to disable "AP Client Isolation" on wireless routers to ensure phones can reach the host machine.
- **New Responsive 2-Column QR Modal**: Expansive dialog layout showcasing the phone QR code on the left and the LAN firewall assistant on the right.

### 🌐 Full Native Multilingual Support (i18n)
- **4 Complete Translations (100% Coverage)**:
  - 🇮🇹 **Italiano** (Native Italian interface, SIAE reporting, and localized guides)
  - 🇬🇧 **English** (Full international English translation across all dialogs and features)
  - 🇪🇸 **Español** (Comprehensive Spanish translation for control console and stage display)
  - 🇫🇷 **Français** (Complete French translation for operator and audience screens)
- **Automatic System Locale Detection**: Auto-detects host system language upon first launch with fallback.
- **Instant Live Language Switcher**: Switch languages on the fly at any time via Settings (`Settings` ➔ `Language`), with persistent preferences retained across app restarts.

### 🎛️ Dual-Window Live Architecture
- **Control Desk (Regia)**: Complete operator console with timeline scrubbing, audio visualizer, 16-channel MIDI mixer, queue management, catalog search, and headphone pre-listening (CUE).
- **Stage Screen (Palco)**: Clean external display for singers and audience (TV/Projector output with `F11` / double-click borderless fullscreen). Renders MP4/WebM videos, CD+G graphics at 30 fps, or synchronized lyrics with animated *"Now Singing"* and *"Get Ready"* notification banners.
- **HTTP 206 Partial Content Streaming**: Custom `karaoke://local/` protocol with byte-range chunk streaming. The stage screen can be closed, reopened, or dragged across monitors without pausing or desynchronizing audio.
- **9 Distinct Visual Themes**: Independent theme customization for both Control Console and Stage Screen.

### 🎵 Real-Time Audio DSP Engine
- **SoundTouch WSOLA Studio Pitch Shifting**: High-fidelity pitch transposition (-8 to +8 semitones) on audio and video tracks without harmonic distortion or metallic artifacts.
- **Independent Tempo Scaling (0.50x–1.50x)**: Continuous playback speed adjustment without modifying audio pitch.
- **Multi-Band Crossover Vocal Remover DSP**: 3-band Butterworth crossover (sub-bass preserved in mono, center vocal cancelled via stereo differential phase cancellation, highs and reverb preserved).
- **Dynamic Audio Volume Normalization (Auto-Leveling)**: Integrated dynamics compressor with -22 dB threshold and 1.35x makeup gain to automatically balance volume across YouTube videos, local MP3+G files, and MIDI backing tracks.

### 🎹 MIDI & KAR Synthesis with SpessaSynth
- **Bundled GeneralUser GS SoundFont (31 MB)**: Rich, hardware-grade acoustic samples preconfigured as default out-of-the-box.
- **Zero-Latency Smooth Playback (5 ms)**: Web Worker clock with strict MIDI priority ranking for simultaneous events.
- **Live 16-Channel Mixer**: Real-time muting/unmuting of individual tracks (e.g. vocal guide melody).

### ⚖️ Fair Queue Algorithm, Persistence & Singer Pitch Memory
- **Anti-Monopoly Fair Rotation**: Dynamically balances song requests based on rotation fairness and request timestamp.
- **Queue Drag & Drop**: Intuitively reorder waiting queue items with mouse drag-and-drop.
- **Queue Persistence & Crash Protection**: Queue lineup is continuously saved to local storage and restored automatically upon restarting.
- **Safe "Clear Queue" Action**: Dedicated trash button with an interactive confirmation modal to safely reset the playlist in one click.
- **Singer Pitch Memory**: Remembers individual pitch preferences and automatically applies them when a singer's song starts.

### 📁 Configurable Library Path & Video Version Previews
- **Guided First-Launch Setup**: Interactive dialog inviting users to choose between the default `~/Karaoke` folder or an existing custom directory.
- **Automatic Startup Refresh & 1-Click Scan**: Scans on application launch and features a 1-click "Refresh Library" button.
- **Interactive 16:9 Video Previews**: Built-in video player with scrubbing to verify version arrangement (KaraFun, Sing King, backing vocals, instrumental).

### 📱 Embedded LAN Smartphone Guest Portal
- **Built-in Express + Socket.IO Server**: Zero-configuration local Wi-Fi web server.
- **Dynamic QR Code**: Guests scan the on-screen code with their phones, search the indexed local library, and submit requests with singer name and transposition.
- **Instant DJ Approval**: Host approves requests with 1 click, queuing the real media track with the requested pitch.

### 📜 Playback History Tab & Royalty Reporting (SIAE)
- **Persistent Execution Memory**: Automatically logs every finished song into a persistent SQLite database (`siae_logs`).
- **1-Click Royalty CSV Export**: Native dialog to export standardized CSV reports compatible with copyright collecting societies.
- **Diagnostic File Logger**: Continuous disk-backed diagnostic logging with configurable levels.

### ☕ Support the Project
- Integrated PayPal donation banner for voluntary contributions to support continuous development and maintenance.

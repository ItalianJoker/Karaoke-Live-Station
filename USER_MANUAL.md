# 📖 Manuale Utente / User Manual — Karaoke Live Station

> **Karaoke Live Station** — Professional Cross-Platform Live Entertainment & Karaoke Management Station.  
> Architecture: Electron, React 18, Web Audio DSP, SoundFont/MIDI Synth, Express LAN Portal, SQLite Catalog.

---

## 📑 Indice dei Contenuti / Table of Contents

- [🇮🇹 Manuale Utente (Italiano)](#-manuale-utente-italiano)
  - [1. Panoramica e Architettura del Sistema](#1-panoramica-e-architettura-del-sistema)
  - [2. Installazione e Prima Configurazione](#2-installazione-e-prima-configurazione)
  - [3. Guida Operativa alla Console di Regia (DJ / KJ)](#3-guida-operativa-alla-console-di-regia-dj--kj)
  - [4. Guida allo Schermo del Palco (Singer Display)](#4-guida-allo-schermo-del-palco-singer-display)
  - [5. Guest Portal per Smartphone (Richieste via LAN)](#5-guest-portal-per-smartphone-richieste-via-lan)
  - [6. Ricerca, Download e Gestione della Libreria](#6-ricerca-download-e-gestione-della-libreria)
  - [7. Scorciatoie da Tastiera (Keyboard Shortcuts)](#7-scorciatoie-da-tastiera-keyboard-shortcuts)
  - [8. Risoluzione dei Problemi (Troubleshooting) e Registro SIAE](#8-risoluzione-dei-problemi-troubleshooting-e-registro-siae)
- [🇬🇧 User Manual (English)](#-user-manual-english)
  - [1. Overview and Architecture](#1-overview-and-architecture)
  - [2. Installation and Initial Configuration](#2-installation-and-initial-configuration)
  - [3. Control Console Operating Guide (DJ / KJ)](#3-control-console-operating-guide-dj--kj)
  - [4. Stage Screen Guide (Singer Display)](#4-stage-screen-guide-singer-display)
  - [5. Mobile Guest Portal (LAN Song Requests)](#5-mobile-guest-portal-lan-song-requests)
  - [6. Search, Downloads, and Library Management](#6-search-downloads-and-library-management)
  - [7. Complete Keyboard Shortcuts Table](#7-complete-keyboard-shortcuts-table)
  - [8. Troubleshooting and Copyright / SIAE Logging](#8-troubleshooting-and-copyright--siae-logging)

---

# 🇮🇹 Manuale Utente (Italiano)

## 1. Panoramica e Architettura del Sistema

**Karaoke Live Station** è una stazione software professionale concepita per DJ, KJ e operatori dell'intrattenimento dal vivo. Il sistema è strutturato secondo un'architettura **Master / Slave** su doppio display:

1. **Finestra di Regia (Control Window - Master):**  
   Console di controllo operatore completa di transport, gestione Fair Queue con punteggi anti-monopolio, controllo della tonalità e del tempo in tempo reale, rimozione voce guida DSP, ducking microfonico, mixer canali MIDI/KAR a 16 tracce, pre-ascolto in cuffia (CUE) su scheda audio secondaria, motore di ricerca ibrido (locale + YouTube) e registro esecuzioni SIAE.

2. **Finestra del Palco (Stage Window - Slave):**  
   Schermo a tutto schermo proiettato su TV o videoproiettore per il cantante e il pubblico. Completamente mutato (per evitare duplicazioni di segnale rispetto all'impianto audio principale), sincronizzato al fotogramma con la Regia via IPC, con grafica CD+G/MP3+G renderizzata via Canvas 2D, supporto video MP4/WebM/MKV e banner dinamici configurabili ("Ora Canta" e "Preparati").

3. **Guest Portal LAN:**  
   Server web leggero integrato su rete locale (Wi-Fi). Permette agli spettatori in sala di inquadrare un QR Code con il proprio smartphone, consultare il catalogo canzoni e inviare richieste indicando il proprio nome e la tonalità desiderata.

---

## 2. Installazione e Prima Configurazione

### Requisiti di Sistema
- **Sistemi Operativi supportati:** Linux (Ubuntu/Debian, Fedora, Arch), Windows 10/11 (64-bit), macOS 11+ (Apple Silicon & Intel).
- **Audio:** Scheda audio integrata o interfaccia USB multi-canale (consigliata interfaccia 4-out per separare Master e Cuffie CUE).
- **Video:** Configurazione desktop esteso a doppio monitor (Display 1 = Monitor Regia, Display 2 = TV/Proiettore Palco).

### Configurazione Iniziale nelle Opzioni (Icona Ingranaggio)
1. **Cartella Libreria Personale:**  
   In *Opzioni ➔ Cartella Libreria*, seleziona la cartella del tuo computer contenente i file karaoke (`.mp4`, `.mp3+.cdg`, `.mid`, `.kar`). Tutti i file salvati o scaricati verranno archiviati in questo percorso.
2. **Banco Suoni SoundFont (.sf2):**  
   Per la riproduzione ad alta fedeltà dei file MIDI e KAR, seleziona un SoundFont General MIDI standard (incluso per impostazione predefinita in `public/soundfonts/default.sf2` o custom a tua scelta).
3. **Dispositivi Audio (Master e CUE):**  
   - Seleziona l'uscita audio per l'impianto PA principale (*Dispositivo Master*).  
   - Seleziona l'uscita secondaria per le cuffie dell'operatore (*Dispositivo CUE*).
4. **Firewall di Sistema per il Guest Portal:**  
   Alla prima esecuzione, autorizza Karaoke Live Station nel firewall. Se usi Linux o Windows, fai riferimento alla guida interattiva e ai comandi pronti all'uso nella sezione Firewall delle Opzioni.

---

## 3. Guida Operativa alla Console di Regia (DJ / KJ)

### Controlli di Riproduzione & Transport
- **Play / Pausa (Tasto `Spazio`):** Avvia o mette in pausa la traccia correntemente caricata.
- **Stop (Tasto `S`):** Interrompe immediatamente la riproduzione, riavvolge il minutaggio a 0:00 e arresta il motore DSP/MIDI.
- **Ricomincia (Tasto `R`):** Riporta all'inizio (0:00) la canzone in esecuzione senza scaricarla dalla coda.
- **Prossimo Brano (Tasto `N`):** Conclude la traccia corrente, ne registra l'esecuzione nello storico SIAE e avanza al cantante successivo in scaletta.
- **Scrubbing & Salto Temporale (`←` / `→`):** Clicca sulla barra di avanzamento o premi i tasti freccia per saltare indietro o avanti di 5 secondi con riallineamento istantaneo del video sullo schermo del palco.

### Tonalità (Pitch Shift) & Velocità (Tempo)
- **Regolazione Tonalità (`+` / `-` oppure `Ctrl+↑` / `Ctrl+↓`):** Modifica l'intonazione in semitoni (da -8 a +8).  
  *Regola fondamentale:* La tonalità è legata alla singola istanza del brano accodato. Modificando il pitch, la variazione si applica istantaneamente all'audio in riproduzione e rimane memorizzata nella voce in scaletta.
- **Regolazione Velocità (`Ctrl+←` / `Ctrl+→`):** Varia la velocità di esecuzione dal 50% al 150% preservando l'intonazione originale grazie all'algoritmo Time-Stretch WSOLA.

### Curva di Volume Performativa (Curva Quadratica Psicoacustica)
- Lo slider del Volume Master applica una risposta quadratica naturale ($Gain = volume^2$):
  - **100%:** Guadagno pieno (0 dB).
  - **75%:** Attenuazione moderata (-5 dB).
  - **50%:** Dimezzamento psicoacustico percepito dell'intensità sonora (-12 dB).
  - **25%:** Volume di sottofondo morbido (-24 dB).
  - **0%:** Silenzio assoluto.
- **Anti-Click Smooth Ramping:** Tutte le variazioni di volume e di muto utilizzano una rampa lineare di 50 millisecondi per azzerare qualsiasi artefatto di clipping o "thump" su altoparlanti professionali.
- **Muto Master (Tasto `M`):** Azzera istantaneamente il volume del canale master mantenendo la posizione del fader.

### Processore Vocale DSP & Microfono
- **Rimozione Voce Guida (Tasto `V`):** Attiva un filtro di cancellazione spettrale a inversione di fase (Center-Channel Vocal Cancellation) per abbattere la voce solista incisa su tracce audio stereo commerciali.
- **Auto-Ducking BGM (Tasto `D`):** Abbassa automaticamente il livello della musica di sottofondo a -14 dB quando l'operatore parla o effettua un annuncio microfonico, ripristinando il volume standard al termine della voce.

### Fair Queue (Scaletta Intelligente Anti-Monopolio)
- **Punteggio di Equità (Fair Score):** Assegna a ciascun cantante una priorità dinamica basata sul numero di brani già eseguiti nella serata. Chi ha cantato di meno riceve priorità automatica.
- **Priorità VIP:** Permette al DJ di forzare una posizione privilegiata per ospiti speciali, festeggiati o celebrazioni.
- **Riordino Manuale:** È sempre possibile trascinare e rilasciare (Drag & Drop) i brani in scaletta per modificare l'ordine al volo.
- **Ripristina Coda Equa:** Riorganizza con un solo clic la scaletta secondo l'algoritmo matematico Fair Queue.

### Mixer MIDI / KAR a 16 Canali
Quando viene caricata una base MIDI o KAR (`.mid` / `.kar`), la console apre automaticamente il mixer a 16 canali:
- Visualizzazione attività note in tempo reale su ogni canale.
- Pulsanti di Silenziamento (Mute) e Attivazione dedicati per ciascuna traccia (es. Canale 4 Voce Guida, Canale 2 Basso, Canale 10 Batteria).
- Modifiche applicate al volo al motore di sintesi Wavetable senza interruzione del flusso sonoro.

---

## 4. Guida allo Schermo del Palco (Singer Display)

La finestra del Palco è concepita per rimanere aperta sul monitor rivolto al pubblico per l'intera durata dell'evento.

### Pipeline di Rendering Isolata
- Avvio con finestra nascosta (`show: false`) e sfondo nero profondo (`#000000`).
- La finestra viene resa visibile solo dopo che il layout DOM, i font di sistema e lo stato IPC sono stati completati, eliminando qualsiasi sfarfallio visivo o comparsa di markup grezzo.
- **Auto-Recovery:** In caso di disconnessione accidentale del cavo HDMI, spegnimento del videoproiettore o crash del renderer secondario, il Main process ripristina la finestra in background con la coda e il timestamp corretti.
- **Pulsante "Riapri Palco" (Tasto `P`):** Se la finestra del Palco viene chiusa per errore, premendo `P` o il pulsante verde in regia la finestra viene immediatamente riaperta e risincronizzata al secondo esatto.

### Modalità Schermo Intero
- Premi **`F11`** o **`Esc`** mentre hai il fuoco sulla finestra del Palco.
- Fai doppio clic (oppure due clic rapidi) in qualsiasi punto dello schermo per attivare/disattivare il borderless fullscreen.

### Banner Dinamici Configurabili
1. **Banner Iniziale ("Ora Canta"):**  
   All'inizio del brano, un banner animato presenta il nome del cantante corrente. Se abilitato nelle opzioni, mostra anche il nome e il brano del cantante successivo ("A seguire").
2. **Banner Finale ("Preparati"):**  
   Negli ultimi 20 secondi (tempo configurabile), un banner discreto avvisa il cantante successivo di avvicinarsi al microfono.
3. **Titolo Brano in Sovrimpressione:**  
   Mostra titolo e autore in sovrimpressione non invasiva nei primi 8 secondi della canzone.

---

## 5. Guest Portal per Smartphone (Richieste via LAN)

Il **Guest Portal** permette agli ospiti del locale di sfogliare il catalogo delle basi disponibili e prenotare una canzone senza assembramenti presso la console di regia.

### Come Attivare il Portale
1. Assicurati che il computer di regia sia connesso alla rete Wi-Fi del locale.
2. Fai clic sul pulsante **QR Code** nella barra superiore della Regia (oppure usa il pulsante *Richieste Guest*).
3. Mostra il codice QR sul monitor o stampalo sul bancone del bar: gli ospiti lo inquadrano con la fotocamera dello smartphone (compatibile con iOS e Android senza installare alcuna app).
4. L'indirizzo URL locale ha tipicamente la forma: `http://192.168.1.XX:3000` (con fallback automatico sulle porte 3001, 3002 se la 3000 è occupata).

### Flusso di Prenotazione
1. L'ospite cerca il brano per titolo o artista sullo smartphone.
2. Inserisce il proprio nome e seleziona l'eventuale variazione di tonalità (es. -2 semitoni).
3. Invia la richiesta.
4. Nella console di Regia compare un badge sonoro/visivo ("Richieste Guest: 1").
5. L'operatore può:
   - **Accettare (Verde):** La canzone entra istantaneamente nella Fair Queue nella posizione più equa, preservando la tonalità richiesta dal cantante.
   - **Rifiutare (Rosso):** La richiesta viene scartata senza interferire con la scaletta.

---

## 6. Ricerca, Download e Gestione della Libreria

### Ricerca Ibrida
- **Scheda Libreria (Tasto `2` o `Ctrl+F`):**  
  - **Modalità Locale:** Cerca istantaneamente nel database SQLite tra i file residenti sul disco rigido (testi, video e basi MIDI).
  - **Modalità Web / YouTube:** Cerca in tempo reale su YouTube basi musicali karaoke.

### Download & Archiviazione Trasparente
- Aggiungendo un brano YouTube alla coda o premendo l'icona di download, il motore basato su `yt-dlp` avvia lo scaricamento in background.
- Il brano è riproducibile immediatamente non appena completato il download.
- **Salvataggio nella Libreria Permanente:**  
  - Cliccando su *Salva in Libreria* (o impostando *Archiviazione Automatica* nelle Opzioni), il file viene spostato dalla directory temporanea alla cartella della tua libreria.
  - La scaletta in riproduzione viene aggiornata istantaneamente per puntare al nuovo file permanente, evitando qualsiasi errore 404 o fallback indesiderato.
  - I nomi dei file preservano tutti gli accenti (es. `à, è, é, ì, ò, ù`) e gli spazi, garantendo compatibilità universale su Windows, macOS e Linux.

---

## 7. Scorciatoie da Tastiera (Keyboard Shortcuts)

La tabella seguente riassume tutte le scorciatoie utilizzabili dall'operatore durante le serate dal vivo. Puoi visualizzare questa guida in qualsiasi momento premendo **`F1`** o **`?`** sulla tastiera.

| Tasto | Categoria | Azione Eseguita |
| :--- | :--- | :--- |
| **`Spazio`** | Riproduzione | Avvia / Mette in Pausa la canzone corrente |
| **`S`** | Riproduzione | Stop: arresta l'audio e riavvolge a 0:00 |
| **`R`** | Riproduzione | Ricomincia la canzone corrente dall'inizio |
| **`N`** | Riproduzione | Passa al brano successivo in scaletta |
| **`←` / `→`** | Riproduzione | Salto indietro / avanti di 5 secondi |
| **`M`** | Audio & DSP | Attiva / Disattiva il Muto Master |
| **`↑` / `↓`** | Audio & DSP | Regola il Volume Master (±5%) con curva percettiva |
| **`+` / `-`** | Audio & DSP | Alza / Abbassa la Tonalità di 1 semitono |
| **`Ctrl + ↑ / ↓`** | Audio & DSP | Alza / Abbassa la Tonalità di 1 semitono |
| **`Ctrl + ← / →`** | Audio & DSP | Regola la velocità di riproduzione (±5%) |
| **`V`** | Audio & DSP | Attiva / Disattiva la Rimozione Voce Guida |
| **`D`** | Audio & DSP | Attiva / Disattiva l'Auto-Ducking per microfono |
| **`1`** | Navigazione | Passa alla scheda **Coda Cantanti** |
| **`2`** | Navigazione | Passa alla scheda **Ricerca & Libreria** |
| **`3`** | Navigazione | Passa alla scheda **Storico SIAE** |
| **`Ctrl + F`** | Navigazione | Cerca brano (apre la libreria e mette a fuoco il campo) |
| **`P`** | Display | Riapri / Metti a fuoco lo Schermo del Palco |
| **`F11` / `Esc`** | Display | Schermo intero (sul monitor del Palco) |
| **`F1` / `?`** | Aiuto | Mostra la guida interattiva alle scorciatoie |
| **`Esc`** | Finestre | Chiudi qualsiasi finestra modale o popup attiva |

---

## 8. Risoluzione dei Problemi (Troubleshooting) e Registro SIAE

### Gli smartphone non caricano la pagina del Guest Portal
1. **Firewall del Sistema Operativo:**  
   Apri le Opzioni di Karaoke Live Station e consulta la sezione **Firewall**. Su Windows, premi *Consenti accesso* per reti private; su Linux esegui il comando `sudo ufw allow 3000:3010/tcp` (oppure `firewall-cmd`).
2. **Isolamento AP (AP Client Isolation) del Router:**  
   Nei modem dei locali pubblici o negli hotspot per ospiti, verifica che l'opzione "Isolamento AP" o "Client Isolation" sia disattivata. Questa opzione impedisce la comunicazione diretta tra dispositivi connessi al medesimo Wi-Fi.

### Lo Schermo del Palco rimane nero o non si apre
- Fai clic su **"Riapri Palco"** o premi il tasto **`P`** sulla tastiera.
- Se utilizzi cavi HDMI lunghi o adattatori video USB, la finestra si auto-ripristina automaticamente appena il sistema operativo rileva nuovamente il display secondario.

### Registro Esecuzioni e Borderò SIAE
- Ogni canzone eseguita fino al termine viene automaticamente registrata nel database interno con data, ora esatta, titolo, artista, cantante e durata.
- Per esportare il registro ai fini della dichiarazione di diritti musicali (SIAE / SCF / BMI / ASCAP), vai nella scheda **Storico** (Tasto `3`) e clicca su **Esporta SIAE (CSV)** per generare un foglio di calcolo compatibile con Excel o LibreOffice.

---
---

# 🇬🇧 User Manual (English)

## 1. Overview and Architecture

**Karaoke Live Station** is a mission-critical desktop application designed for professional DJs, KJs, and live event hosts. Built on a resilient **Master / Slave** multi-screen architecture:

1. **Control Console (Operator / Master Window):**  
   Comprehensive DJ dashboard featuring audio transport, algorithmic anti-monopoly Fair Queueing, real-time key (pitch) and tempo scaling, DSP center-channel vocal suppression, microphone auto-ducking, a 16-channel MIDI/KAR synthesizer mixer, dedicated headphone CUE routing, hybrid catalog search, and performance copyright reporting.

2. **Stage Display (Singer / Audience Slave Window):**  
   Fullscreen presentation viewport targeting external TVs or video projectors. Secondary audio is intentionally muted to eliminate acoustic phase distortion against the main PA. Fully frame-synchronized via high-frequency IPC, supporting HTML5 Canvas CD+G graphics, high-definition MP4/WebM video, and customizable performer banners ("Now Singing" & "Get Ready").

3. **Mobile LAN Guest Portal:**  
   Built-in zero-configuration local HTTP server. Audience members scan a dynamic QR code with any smartphone to search the song catalog and submit performance requests with custom key preferences.

---

## 2. Installation and Initial Configuration

### System Requirements
- **Operating Systems:** Linux (Ubuntu, Debian, Fedora, Arch), Windows 10/11 (64-bit), macOS 11+ (Apple Silicon & Intel).
- **Audio Output:** Standard integrated soundcard or multi-channel USB audio interface (4-output interface recommended for independent Master + CUE headphone routing).
- **Displays:** Dual-monitor extended desktop (Screen 1: Control Console, Screen 2: Stage Display).

### Initial Configuration (Gear Icon)
1. **Karaoke Library Directory:**  
   Open *Settings ➔ Karaoke Library Folder* and choose your local folder containing video and audio tracks (`.mp4`, `.mp3+.cdg`, `.mid`, `.kar`).
2. **SoundFont Bank (.sf2):**  
   For authentic MIDI/KAR synthesis, ensure a General MIDI SoundFont bank is selected (default included at `public/soundfonts/default.sf2`).
3. **Audio Routing (Master & CUE):**  
   - Select your main venue PA audio output device (*Master Device*).  
   - Select your secondary soundcard or headphone output (*CUE Device*).
4. **Firewall Authorization for Guest Portal:**  
   Allow the application through your system firewall on Private networks to ensure mobile phones can connect over Wi-Fi.

---

## 3. Control Console Operating Guide (DJ / KJ)

### Transport & Playback
- **Play / Pause (`Space`):** Toggles playback for the active track.
- **Stop (`S`):** Immediately stops playback, silences the audio engine, and resets timecode to 0:00.
- **Restart (`R`):** Rewinds the current song back to 0:00 without removing it from the queue.
- **Next Track (`N`):** Logs the completed performance to copyright history and transitions to the next queued singer.
- **Seek & Jump (`←` / `→`):** Click the progress scrubber or press arrow keys to skip backward or forward by 5 seconds with instant Stage screen video re-sync.

### Key (Pitch Shift) & Tempo (Speed)
- **Key Adjustment (`+` / `-` or `Ctrl + ↑ / ↓`):** Shifts pitch by semitones (-8 to +8).  
  *Core Design:* Pitch is linked to the queued song instance. Changing pitch updates the live DSP graph instantly and preserves the setting for that performance.
- **Tempo Adjustment (`Ctrl + ← / →`):** Adjusts playback speed from 50% to 150% without altering pitch using the WSOLA time-stretching engine.

### Perceptual Master Volume Curve
- The Master Volume fader uses an acoustic quadratic power curve ($Gain = volume^2$):
  - **100%:** Unity gain (0 dB).
  - **75%:** Moderate reduction (-5 dB).
  - **50%:** Perceived half-loudness (-12 dB).
  - **25%:** Gentle background ambience (-24 dB).
  - **0%:** Silence.
- **Anti-Click Smooth Ramping:** All gain adjustments transition over a 50ms linear ramp, preventing clicks, pops, and speaker DC transients.
- **Master Mute (`M`):** Instantly mutes master audio output while maintaining slider position.

### DSP Vocal Processor
- **Vocal Remover (`V`):** Activates spectral center-channel phase inversion to suppress lead vocals in commercial stereo mixes.
- **Microphone Auto-Ducking (`D`):** Attenuates background music by -14 dB when speech is detected, restoring full volume when speaking finishes.

### Fair Queue Scheduling
- **Fair Score Algorithm:** Prioritizes singers who have performed the fewest songs, preventing queue monopolization during busy live shows.
- **VIP Priority:** Instantly elevates designated VIP performances when necessary.
- **Manual Drag & Drop:** Freely rearrange upcoming songs by dragging queue items.

### 16-Channel MIDI / KAR Synth Mixer
When a MIDI or KAR file is loaded, the mixer panel automatically exposes all 16 MIDI channels with live note activity indicators and channel-specific mute controls (e.g., Channel 4 vocal melody, Channel 2 bass, Channel 10 drums).

---

## 4. Stage Screen Guide (Singer Display)

### Isolated Rendering Pipeline & Handshake
- Initializes completely hidden (`show: false`) with a solid black backdrop (`#000000`).
- The window reveals itself only after CSS stylesheets, web fonts, and state synchronization handshakes are verified, preventing unstyled layout shifts or flashes of unrendered code.
- **Auto-Recovery:** If an HDMI cable or projector disconnects, the window silently re-establishes synchronization upon reconnection.
- **Reopen Stage (`P`):** If the stage window is closed, pressing `P` or clicking the green status badge immediately relaunches and syncs the display.

### Fullscreen Controls
- Press **`F11`** or **`Esc`** while focused on the Stage window.
- Double-click (or click twice in rapid succession) anywhere on the display to toggle borderless fullscreen.

---

## 5. Mobile Guest Portal (LAN Song Requests)

### Connecting Audience Smartphones
1. Ensure the host laptop is connected to the venue Wi-Fi network.
2. Click the **QR Code** icon in the console navigation bar.
3. Show the QR code to guests; scanning with any standard smartphone camera opens the portal instantly without app store downloads.
4. Portal addresses resolve locally (e.g., `http://192.168.1.50:3000`).

### Request Handling
1. Guests search for songs, enter their name, and choose their preferred key offset.
2. An incoming request badge flashes on the operator screen.
3. The KJ can **Approve** (inserting the song directly into the Fair Queue with the requested key) or **Reject** with one click.

---

## 6. Search, Downloads, and Library Management

### Hybrid Search
- **Local Mode:** Queries the internal SQLite database for files stored on your local disk.
- **Web / YouTube Mode:** Searches YouTube for karaoke backing tracks.

### Background Downloads & Permanent Library Storage
- Adding a web track to the queue downloads the media in the background via `yt-dlp`.
- Clicking *Save to Library* (or enabling *Auto-Archive* in Settings) moves the file into your permanent collection and immediately updates the active queue pointer.
- Filename sanitization preserves spaces and international accented letters (`à, è, é, ì, ò, ù...`) across all operating systems.

---

## 7. Complete Keyboard Shortcuts Table

Press **`F1`** or **`?`** inside the application to open this quick reference at any time.

| Key | Category | Action |
| :--- | :--- | :--- |
| **`Space`** | Playback | Play / Pause current track |
| **`S`** | Playback | Stop playback and rewind to 0:00 |
| **`R`** | Playback | Restart current song from beginning |
| **`N`** | Playback | Advance to next track in queue |
| **`←` / `→`** | Playback | Seek backward / forward 5 seconds |
| **`M`** | Audio & DSP | Toggle Master Mute |
| **`↑` / `↓`** | Audio & DSP | Master Volume adjustment (±5%) with perceptual taper |
| **`+` / `-`** | Audio & DSP | Pitch Shift / Key offset (±1 semitone) |
| **`Ctrl + ↑ / ↓`** | Audio & DSP | Pitch Shift / Key offset (±1 semitone) |
| **`Ctrl + ← / →`** | Audio & DSP | Playback speed / tempo (±5%) |
| **`V`** | Audio & DSP | Toggle Lead Vocal Remover |
| **`D`** | Audio & DSP | Toggle Microphone Auto-Ducking |
| **`1`** | Navigation | Switch to **Queue** tab |
| **`2`** | Navigation | Switch to **Library & Search** tab |
| **`3`** | Navigation | Switch to **History (SIAE)** tab |
| **`Ctrl + F`** | Navigation | Focus search box in Library tab |
| **`P`** | Display | Reopen / Focus Stage Window |
| **`F11` / `Esc`** | Display | Toggle Stage Window Fullscreen |
| **`F1` / `?`** | Help | Show interactive Keyboard Shortcuts guide |
| **`Esc`** | Dialogs | Dismiss active modal or close dialog |

---

## 8. Troubleshooting and Copyright / SIAE Logging

### Smartphones cannot load the Guest Portal
1. **Firewall Settings:** Ensure port 3000 TCP is unblocked. Refer to the built-in *Firewall Assistant* inside Settings for copy-paste system terminal commands.
2. **Wi-Fi Router AP Isolation:** In public routers, disable "AP Client Isolation" or "Guest Network Isolation" so phones can communicate with the host machine.

### Stage Window displays black screen or disconnects
- Click the **"Reopen Stage"** badge or press **`P`**.
- The auto-recovery system monitors HDMI re-attachments and restores video playback and lyrics overlays without requiring an app restart.

### Performance Logging and CSV Export
- Completed performances are logged with timestamp, artist, title, duration, and singer name.
- Click **Export SIAE (CSV)** in the History tab to generate an official borderò report ready for copyright filing.

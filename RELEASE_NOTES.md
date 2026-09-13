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

## 🚀 Note di Rilascio — Versione 1.3.1 (Architettura DSP Vocal Remover In-Phase & Logica Storico SIAE)

### 🎙️ Pipeline DSP Vocal Remover In-Phase Ad Alta Fedeltà
- **Risoluzione Audio Cupo e Soppressione Efficace della Voce Guida**: Riprogettata interamente la catena audio Web Audio DSP per la rimozione della voce solista (tasto `V` o toggle in regia). La precedente architettura a filtri IIR causava sfasamenti a 180° che attenuavano gravemente le alte frequenze ("audio cupo") lasciando udibile la voce.
- **Matrice di Sottrazione Differenziale a Fase Zero**: Il bus di differenza calcola direttamente `diffBus = 0.5 * (L - R)`, garantendo la cancellazione matematica perfetta ($-\infty$ dB) di tutti i segnali posti al centro dello spettro stereo (voce guida solista) con latenza zero e senza rotazioni di fase tra i canali.
- **Rinforzo Dinamico dei Bassi (< 160 Hz)**: La somma mono `0.5 * (L + R)` viene processata da un filtro passa-basso Butterworth del 2° ordine e reiniettata per conservare al 100% l'energia e il punch della cassa della batteria e della linea di basso.
- **Preservazione Acustica degli Alti (> 5500 Hz)**: Ciascun canale stereo ($L$ e $R$) attraversa un filtro passa-alto Butterworth del 2° ordine dedicato, garantendo che i piatti della batteria, il riverbero d'ambiente e la brillantezza ("air") rimangano vividi e dettagliati.
- **Distribuzione In-Phase per Diffusori Acustici**: Il bus di cancellazione viene iniettato con polarità positiva identica sia sul canale sinistro che destro (`OutL` e `OutR`), eliminando qualsiasi cancellazione acustica per interferenza distruttiva nell'aria tra le casse dell'impianto PA della sala.
- **Makeup Gain di Compensazione a 1.25x**: Stadio di guadagno di livellamento per compensare l'attenuazione naturale dovuta alla sottrazione differenziale, mantenendo il volume percepito omogeneo tra bypass e modalità attiva.

### 📜 Ciclo di Vita dello Storico (History) & Metadati SIAE
- **Criterio Rigoroso di Registrazione Esecuzioni**: Il brano in esecuzione viene registrato nello storico e nel registro SIAE se:
  1. La riproduzione giunge al suo **termine naturale** (anche per intermezzi o brani brevi);
  2. Il brano viene interrotto o saltato dall'operatore dopo essere stato riprodotto per **almeno 2 minuti (120 secondi)**.
  - Brani saltati o fermati prima dei 120 secondi (es. avviati per errore o scartati subito) non sporcano il registro delle esecuzioni.
- **Prevenzione Duplicati con Flag di Guardia (`alreadyLogged`)**: Ciascuna istanza di canzone in scaletta tiene traccia dell'avvenuta registrazione. Se un brano supera i 120 secondi e viene fermato/messo in pausa e successivamente ripreso fino al termine o saltato, viene registrato **una sola volta**, prevenendo conteggi doppi o discrepanze nel registro delle esecuzioni.
- **Timestamp Certificato & Esportazione CSV Completa**: Ogni esecuzione viene archiviata con timestamp numerico ad alta risoluzione (epoch ms) e convertita in formato standard ISO 8601 UTC. L'esportazione CSV per la SIAE include le colonne `Data e Ora (ISO 8601)`, `Timestamp (Epoch ms)` e `Data Locale`, pronte per la compilazione dei borderò digitali o cartacei.

### ⌨️ Scorciatoie da Tastiera & Diagnostica Operatore
- **Scorciatoia `V` Reattiva con Log Diagnostico**: Il tasto rapido `V` commuta istantaneamente il Vocal Remover sia con audio in esecuzione che a riposo, emettendo un log esplicativo in console per l'ispezione dello stato da parte dell'operatore o di strumenti di diagnostica.

### 🧪 Suite di Test Automatizzata Estesa (58 Test Totali)
- **Suite 7 (Simulazione DSP In-Phase)**: Verifica matematica della cancellazione a $-\infty$ dB della voce al centro, preservazione dei segnali stereo laterali, mantenimento dei bassi mono a 1.25x e non-annullamento acustico delle onde sonore nella sala.
- **Suite 8 (Ciclo di Vita Storico & Soglia 120s)**: Collaudo completo delle condizioni di logging (termine naturale, superamento soglia 120s, rifiuto sotto 120s, flag anti-duplicato `alreadyLogged`, validità formato ISO 8601 ed intestazioni CSV).

## 🚀 Note di Rilascio — Versione 1.3.0 (Dipendenze Esterne, Cache Coda Persistente, Lock Istanza Singola & Affinamenti UI)

### ⚙️ Gestione Dipendenze Esterne (`yt-dlp`) & Esecuzione Protetta
- **Collocazione Esclusiva in `<app_data_dir>/bin/`**: L'eseguibile `yt-dlp` viene memorizzato ed eseguito unicamente all'interno della cartella dati protetta dell'applicazione (`userData/bin/`), salvaguardando il binario da pulitori automatici di cartelle temporanee (`/tmp`) o sovrascritture di pacchetto.
- **Riuso Senza Riscaricamenti a Vuoto**: Se il binario è già presente ed eseguibile, l'applicazione ne riutilizza l'istanza locale e verifica gli aggiornamenti su GitHub Releases in background in modo non bloccante, scaricando il nuovo file solo in presenza di un effettivo incremento di versione.
- **Risoluzione Dinamica al Download**: I percorsi degli eseguibili vengono ricalcolati dinamicamente all'avvio di ogni download e ricerca, consentendo l'applicazione a caldo di eventuali aggiornamenti senza richiedere il riavvio del software.

### 💾 Ciclo di Vita della Coda Persistente & Cache Dedicata (`<app_data_dir>/queue_cache/`)
- **Single Instance Lock**: Attivato il blocco di istanza singola nativo di Electron (`app.requestSingleInstanceLock()`). Tentativi di apertura di ulteriori istanze dell'applicazione vengono bloccati immediatamente (`app.quit()`), ripristinando e mettendo a fuoco la finestra di regia già aperta.
- **Auto-Refresh Immediato della Libreria**: Il completamento dei download (sia automatici che manuali) emette un evento di re-indicizzazione e ricarica immediata della vista Libreria nel renderer, rendendo i nuovi brani visibili all'istante senza riavvio.
- **Archiviazione Automatica Attiva di Default**: La preferenza `autoArchiveWebTracks` è ora abilitata per impostazione predefinita (`true`).
- **Modale Obbligatorio di Conferma alla Disattivazione**: Se l'utente tenta di disattivare l'archiviazione automatica, viene mostrato un modale di sicurezza vincolante con il messaggio ufficiale multilingua (IT, EN, ES, FR) che avvisa che i brani non archiviati rimarranno disponibili solo nella cache temporanea finché presenti in scaletta.
- **Cache di Coda Persistente**: Quando l'archiviazione automatica è disattivata, i download vengono custoditi nella cartella dedicata `<userData>/queue_cache/`. I file rimangono integri e riproducibili anche riavviando l'app, purché il brano sia ancora presente nella coda salvata.
- **Garbage Collection (GC) Intelligente al Solo Scodamento**: I file della cache di coda vengono rimossi fisicamente dal disco **esclusivamente** quando il brano viene effettivamente rimosso dalla coda (a seguito di avanzamento/esecuzione completata, cancellazione manuale o svuotamento dell'intera coda). Brani identici ancora in attesa in scaletta mantengono protetto il file su disco.
- **Salvataggio Contestuale in Libreria in 1 Clic**: Presente un pulsante dedicato sia nella riga del brano in coda che nella testata del player in esecuzione, consentendo all'operatore di promuovere con un solo clic qualsiasi brano web/cache nella propria libreria locale permanente.

### 🎯 Fair Queue Attiva di Default
- L'algoritmo di rotazione anti-monopolio Fair Queue è ora attivo per impostazione predefinita (`enableFairQueue: true`), garantendo un'esperienza di scaletta bilanciata e meritocratica out-of-the-box.

### 🎛️ Affinamenti UI & Schermo Palco
- **Sfondo Stage durante i messaggi**: Per ogni messaggio overlay (Ora Canta, Preparati, Prossimo cantante, …) è possibile impostare uno sfondo dedicato a colore solido o immagine. Lo Stage applica lo sfondo solo mentre il messaggio è visibile e ripristina tema/video al termine.
- **Toggle Mostra Tonalità su Schermo Palco**: Aggiunta nelle opzioni la possibilità di mostrare o nascondere il badge dei semitoni di variazione (+/-) sullo schermo del palco (`showPitchOnStage`).
- **Aggiornamento Messaggio Guida**: Sostituita la dicitura con *"💡 Doppio click o Play per avviare"* in tutti i componenti e nei file di localizzazione (IT, EN, ES, FR).

## 🚀 Note di Rilascio — Versione 1.2.0 (Aggiornamento Stabilità & Nuove Funzionalità)

### 🖥️ Isolamento Pipeline di Rendering Schermo Palco (Stage Display)
- **Eliminazione Dipendenze CDN a Runtime**: Lo script Tailwind CSS caricato da CDN esterna è stato completamente rimosso. Tailwind v4 è ora compilato AOT tramite Vite direttamente nel bundle statico dell'applicazione, garantendo caricamento istantaneo e funzionamento al 100% offline senza latenze di rete.
- **Handshake di Prontezza IPC (`stage:ready`)**: La finestra secondaria del Palco viene inizializzata nascosta (`show: false`) con sfondo nero profondo (`#000000`). Viene mostrata a video solo dopo che il layout DOM, i font di sistema (`document.fonts.ready`) e la sincronizzazione dello stato sono stati completati, eliminando qualsiasi sfarfallio visivo o comparsa occasionale di stringhe di codice/CSS non renderizzate sul proiettore o TV secondaria.
- **Fallback di Ripristino Automatico**: Timer di sicurezza per garantire la visibilità della finestra anche in caso di rallentamenti dell'hardware video esterno.

### 💾 Risoluzione Path Archiviazione Libreria & Switch Immediato Scaletta
- **Rispetto Rigoroso della Cartella Libreria**: Le operazioni di salvataggio permanente (`download:save-to-library`) utilizzano ora prioritariamente il percorso configurato dall'utente in `settings.libraryPath`, con fallback sicuro su `userData/library`.
- **Switch Dinamico del Puntatore in Coda**: Al completamento del salvataggio di un brano web, la scaletta di riproduzione aggiorna immediatamente il riferimento (`localFilePath` e `uri` `karaoke://local/...`) dal file temporaneo al file definitivo salvato. Questo previene qualsiasi errore 404 e azzera il rischio di fallback indesiderato su streaming YouTube.
- **Preservazione Accenti e Spazi nei Nomi File**: Il modulo di sanitizzazione preserva fedelmente le lettere accentate italiane ed europee (`à, è, é, ì, ò, ù, ñ, ç...`) e gli spazi, ripulendo al contempo i caratteri vietati dai file system (`/ \ ? % * : | " < >`) per la massima compatibilità cross-platform tra Windows, macOS e Linux.

### 🔊 Curva di Volume Performativa (Quadratica Psicoacustica)
- **Risposta Naturale del Fader ($Gain = volume^2$)**: Sostituita la precedente mappatura lineare con una curva quadratica ad alta precisione psicoacustica conforme alla percezione logaritmica dell'orecchio umano (legge di Weber-Fechner). Il volume al 50% corrisponde ora all'esatto dimezzamento percepito della pressione sonora (-12 dB), con attenuazione dolce a bassi livelli e controllo fluido in cima alla corsa.
- **Rampa Lineare Anti-Click a 50ms**: Le regolazioni di volume e l'attivazione/disattivazione del muto applicano una rampa anti-zipper a 50ms che azzera qualsiasi scoppiettio, click o sbalzo DC su impianti audio professionali.

### ⌨️ Nuove Scorciatoie da Tastiera & Modale Interattiva di Aiuto
- **Comandi Rapidi DJ / KJ**:
  - `M`: Attiva / Disattiva Muto Master
  - `V`: Attiva / Disattiva Rimozione Voce Guida DSP
  - `D`: Attiva / Disattiva Microfono Auto-Ducking
  - `S`: Stop riproduzione con riavvolgimento a 0:00
  - `R`: Riavvia la canzone corrente dall'inizio (0:00)
  - `P`: Riapri / Metti a fuoco lo Schermo del Palco
  - `1`, `2`, `3`: Navigazione rapida tra schede (1: Coda, 2: Libreria, 3: Storico SIAE)
  - `F1` o `?`: Mostra la guida alle scorciatoie da tastiera
- **Nuovo Componente `ShortcutsHelpModal`**: Finestra interattiva con barra di ricerca in tempo reale, suddivisione visiva per categorie (Riproduzione, Audio/DSP, Navigazione) e badge tasti `<kbd>` eleganti.
- **Pulsante di Aiuto Rapido**: Icona punto interrogativo integrata direttamente nell'intestazione della console operatore.

### 🧪 Suite di Test Automatizzata & Manuale Utente Dedicato
- **Test Suite Completa (`scripts/run-tests.js`)**: 32 test automatici che verificano monotonicità della curva di volume, sanitizzazione caratteri, aggiornamento della scaletta e parità al 100% delle chiavi di traduzione (`it`, `en`, `es`, `fr`). Integrata con `npm test`.
- **Manuale Utente Dedicato (`USER_MANUAL.md`)**: Documentazione esaustiva e bilingue (Italiano e Inglese) che guida l'utente attraverso tutte le funzionalità del software.

---

## 🌟 Cronologia Versioni Precedenti

### 📦 Note di Rilascio — Versione 1.0.0

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

## 🚀 Release Notes — Version 1.3.1 (In-Phase Vocal Remover DSP & SIAE History Lifecycle)

### 🎙️ High-Fidelity In-Phase Vocal Remover DSP Pipeline
- **Elimination of Muffled Sound & Clean Lead Vocal Cancellation**: Completely re-engineered the Web Audio DSP vocal removal pipeline (shortcut `V` or control console toggle). The previous cascaded IIR filter design suffered from frequency-dependent phase rotations that introduced destructive notches across the treble spectrum ("muffled sound") without effectively suppressing center-panned vocals.
- **Zero-Phase Direct Differential Subtraction Matrix**: The difference bus directly computes `diffBus = 0.5 * (L - R)`, delivering exact mathematical cancellation ($-\infty$ dB) of all center-panned mono energy (lead vocals) across the entire spectrum with zero latency and zero phase distortion.
- **Dynamic Mono Bass Reinforcement (< 160 Hz)**: The mono sum `0.5 * (L + R)` is routed through a 2nd-order Butterworth lowpass filter and reintroduced to retain 100% of kick drum punch, weight, and bassline definition.
- **Stereo Treble & Air Preservation (> 5500 Hz)**: Independent 2nd-order Butterworth highpass filters for left and right channels preserve cymbals, harmonic overtones, reverberation, and spatial width without comb filtering.
- **In-Phase Room Speaker Distribution**: The vocal-canceled difference signal is delivered with identical positive polarity to both left and right speaker channels (`OutL` and `OutR`), eliminating destructive acoustic wave cancellation in the venue room when sound waves combine in air.
- **1.25x Makeup Leveling Gain**: Post-processing leveling gain compensates for energy reduction inherent in difference subtraction, maintaining consistent perceived loudness between bypassed and active states.

### 📜 History Playback Lifecycle & SIAE Metadata Tracking
- **Strict Performance Logging Thresholds**: Songs are recorded into the performance history and SIAE copyright registry if and only if:
  1. The track finishes at its **natural end** (regardless of total song duration);
  2. The track is stopped (`handleStop`) or skipped (`advanceToNextTrack`) by the operator after being actively played for **at least 2 minutes (120 seconds)**.
  - Songs stopped or skipped prematurely before reaching 120 seconds are discarded, preventing false entries from accidental starts or quick tests.
- **Duplicate Prevention Guard (`alreadyLogged`)**: Each queued song instance tracks its logging state. If a track passes the 120-second threshold and is stopped, and later resumed, finished, or skipped, it is logged strictly once, preventing duplicate rows in the SIAE report.
- **Certified Timestamps & Extended CSV Export**: Every recorded performance captures high-resolution epoch milliseconds and standardized ISO 8601 UTC strings. The SIAE CSV export includes `Data e Ora (ISO 8601)`, `Timestamp (Epoch ms)`, and `Data Locale` alongside singer, artist, title, and duration for full legal compliance.

### ⌨️ Keyboard Shortcuts & Diagnostic Logging
- **Responsive `V` Shortcut with Diagnostic Telemetry**: Pressing `V` immediately toggles the Vocal Remover state with smooth crossfading and logs status events to the developer console for instant operator verification.

### 🧪 Extended Automated Test Suite (58 Passing Tests)
- **Suite 7 (In-Phase DSP Simulation)**: Mathematical validation of $-\infty$ dB center vocal cancellation, stereo instrument retention, mono bass preservation, and acoustic in-phase room radiation.
- **Suite 8 (History Lifecycle & 120s Threshold)**: Verification of natural end qualification, 120-second cutoff threshold enforcement, <120s rejection, `alreadyLogged` duplicate prevention, ISO 8601 formatting, and CSV export column integrity.

## 🚀 Release Notes — Version 1.3.0 (External Dependencies, Persistent Queue Cache, Single Instance Lock & UI Refinements)

### ⚙️ External Dependency Management (`yt-dlp`) & Protected Execution
- **Exclusive Placement in `<app_data_dir>/bin/`**: The `yt-dlp` executable is stored and executed exclusively within the application's protected user data directory (`userData/bin/`), safeguarding the binary from temporary file cleanup utilities (`/tmp`) or application bundle overwrites.
- **Reuse Without Redundant Downloads**: If the binary already exists and is executable, the application reuses the local instance and checks GitHub Releases for updates in a non-blocking background check, downloading only when a genuine version increment is available.
- **Dynamic Resolution on Download/Search**: Binary paths are dynamically re-resolved prior to each download and search operation, enabling hot updates to take effect immediately without requiring an application restart.

### 💾 Persistent Queue Lifecycle & Dedicated Cache (`<app_data_dir>/queue_cache/`)
- **Single Instance Lock**: Activated native Electron single-instance enforcement (`app.requestSingleInstanceLock()`). Attempts to open additional instances are terminated immediately (`app.quit()`), automatically restoring and focusing the existing control window.
- **Instant Automatic Library Refresh**: Completion of track downloads (both automated and manual saves) dispatches a re-indexing event that immediately refreshes the Library view in the renderer, making newly saved songs visible without delay.
- **Auto-Archive Enabled by Default**: The `autoArchiveWebTracks` setting is now enabled by default (`true`).
- **Mandatory Confirmation Modal on Disabling**: Attempting to disable automatic archiving triggers a mandatory confirmation modal with the official warning message across all supported languages (IT, EN, ES, FR), advising that unarchived songs will only remain available in the temporary cache while present in the queue.
- **Persistent Queue Cache**: When automatic archiving is disabled, downloaded files are placed into the dedicated `<userData>/queue_cache/` directory. These files remain intact and playable across app restarts as long as the song remains in the persisted queue.
- **Intelligent Garbage Collection (GC) Exclusively on Dequeue**: Queue cache files are physically purged from disk **only** when the song is actually removed from the queue (via track completion, manual item deletion, or clearing the entire queue). If identical songs remain queued elsewhere in the playlist, the cached file is safely preserved.
- **Contextual 1-Click "Save to Library"**: Dedicated 1-click action buttons in both the queue row and active player header allow operators to instantly promote any web or cached track into their permanent local library.

### 🎯 Fair Queue Enabled by Default
- The anti-monopoly Fair Queue rotation algorithm is now turned on by default (`enableFairQueue: true`), providing a balanced and fair singer rotation experience out-of-the-box.

### 🎛️ UI Refinements & Stage Monitor
- **Stage background during messages**: Each overlay message (Now Singing, Get Ready, Up Next, …) can use a dedicated solid-color or image backdrop. Stage applies it only while the message is visible and restores the theme/video look when it hides.
- **Toggle Stage Monitor Pitch Badge**: Added an option in settings to show or hide the semitone shift (+/-) badge on the stage monitor display (`showPitchOnStage`).
- **Updated Guidance Prompt**: Replaced start instructions with *"💡 Double click or Play to start"* across all components and localization bundles (IT, EN, ES, FR).

## 🚀 Release Notes — Version 1.2.0 (Stability Update & New Features)

### 🖥️ Stage Window Rendering Pipeline Isolation
- **Eliminated Runtime CDN Dependencies**: Removed runtime CDN Tailwind CSS script. Tailwind v4 is now compiled Ahead-of-Time (AOT) via Vite directly into the application's static bundle, delivering instant layout initialization and 100% offline reliability without network latency.
- **IPC Readiness Handshake (`stage:ready`)**: The secondary Stage window initializes completely hidden (`show: false`) with a solid black backdrop (`#000000`). It reveals itself only after DOM markup, system web fonts (`document.fonts.ready`), and state synchronization have completed, eliminating visual stutter or flashes of unrendered code/CSS on external TVs and projectors.
- **Safety Fallback Reveal**: Watchdog timer ensures the window reliably displays even if external display hardware delays video signals.

### 💾 Library Storage Path Resolution & Live Queue Pointer Switch
- **Strict Library Directory Enforcement**: Permanent save operations (`download:save-to-library`) prioritize the user-configured `settings.libraryPath`, falling back securely to `userData/library`.
- **Immediate Queue Pointer Redirection**: When a downloaded web track is saved to the library, the playback queue immediately redirects its pointers (`localFilePath` and `uri` `karaoke://local/...`) from the temporary folder to the permanent library path. This prevents 404 file-not-found errors and completely eliminates unwanted fallbacks to YouTube streaming.
- **Accented Letter & Space Preservation**: Filename sanitization preserves Italian and European accented characters (`à, è, é, ì, ò, ù, ñ, ç...`) and spaces while stripping illegal filesystem tokens (`/ \ ? % * : | " < >`) for seamless cross-platform support across Windows, macOS, and Linux.

### 🔊 Perceptual Audio Volume Attenuation Curve
- **Acoustic Quadratic Taper ($Gain = volume^2$)**: Replaced linear gain scaling with a psychoacoustic quadratic power curve aligned with human hearing perception (governed by the Weber-Fechner law). Fader position at 50% now corresponds to perceived half-loudness (-12 dB), delivering smooth low-end control and natural response across the fader travel.
- **50ms Anti-Click Linear Ramp**: Volume adjustments and mute toggling transition smoothly over 50 milliseconds, eliminating audible clicks, zipper noise, or DC offset pops on PA sound systems.

### ⌨️ Advanced Keyboard Shortcuts for DJ/KJ & Interactive Help Modal
- **New Live Operator Shortcuts**:
  - `M`: Toggle Master Mute
  - `V`: Toggle DSP Vocal Remover
  - `D`: Toggle Microphone Auto-Ducking
  - `S`: Stop playback and rewind timecode to 0:00
  - `R`: Restart active song from beginning (0:00)
  - `P`: Reopen / Focus Stage Window
  - `1`, `2`, `3`: Quick tab switching (1: Queue, 2: Library, 3: History)
  - `F1` or `?`: Open interactive Keyboard Shortcuts guide
- **New `ShortcutsHelpModal` Component**: Searchable modal with real-time query filtering, category groupings (Playback, Audio/DSP, Navigation), and stylish `<kbd>` badges.
- **Quick-Access Help Button**: Help button in the operator console header.

### 🧪 Automated Test Suite & Dedicated User Manual
- **Full Automated Test Suite (`scripts/run-tests.js`)**: 32 automated tests validating volume curve linearity and monotonicity, filename sanitization, queue pointer redirection, and 100% i18n translation parity across `it`, `en`, `es`, `fr`. Integrated with `npm test`.
- **Dedicated User Manual (`USER_MANUAL.md`)**: Comprehensive bilingual (Italian and English) operating manual detailing all system modules, multi-monitor configuration, and troubleshooting procedures.

---

## 🌟 Version History

### 📦 Release Notes — Version 1.0.0

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


# 🎤 Karaoke Live Station

<p align="center">
  <img src="public/logo.png" alt="Karaoke Live Station Logo" width="160" />
</p>

<p align="center">
  <strong>The Ultimate Professional Dual-Screen Live Karaoke Suite</strong>
</p>

<p align="center">
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-34.2.0-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" /></a>
  <a href="https://reactjs.org/"><img src="https://img.shields.io/badge/React-18.3.1-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.7.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind" /></a>
  <a href="https://sqlite.org/"><img src="https://img.shields.io/badge/SQLite-WAL_Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" /></a>
  <a href="https://deepmind.google/"><img src="https://img.shields.io/badge/Developed%20with-Google%20Antigravity-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Google Antigravity" /></a>
  <a href="https://cursor.com/"><img src="https://img.shields.io/badge/Developed%20with-Cursor-000000?style=for-the-badge&logo=cursor&logoColor=white" alt="Cursor" /></a>
  <a href="https://www.paypal.com/paypalme/LucaAbagnale"><img src="https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate with PayPal" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="License: AGPL v3" /></a>
  <a href="#-italiano"><img src="https://img.shields.io/badge/Languages-IT%20%7C%20EN%20%7C%20ES%20%7C%20FR-blue?style=for-the-badge&logo=translate" alt="Languages: IT, EN, ES, FR" /></a>
</p>

---

### 📚 Documentazione & Struttura Dati / Documentation & Data Paths
- 🇮🇹 [Manuale utente (IT)](./USER_MANUAL.md) · [USER_MANUAL_it.md](./USER_MANUAL_it.md)
- 🇬🇧 [User manual (EN)](./USER_MANUAL_en.md)
- 🇪🇸 [Manual de usuario (ES)](./USER_MANUAL_es.md)
- 🇫🇷 [Manuel utilisateur (FR)](./USER_MANUAL_fr.md)
- 📋 [CHANGELOG.md](./CHANGELOG.md) · [RELEASE_NOTES.md](./RELEASE_NOTES.md)
- 🧰 **Binari ed eseguibili gestiti / Managed binaries** (`yt-dlp`, `ffmpeg`, helper): `<app_userData>/bin/` (Electron `userData`) — persistenti e portabili tra gli aggiornamenti / portable across updates
- 🧠 **Modelli vocali AI offline / Offline AI vocal models** (UVR-MDX-NET Karaoke 2, HTDemucs): `<app_userData>/models/` — scaricati automaticamente solo se mancanti, corrotti o più recenti / downloaded only when missing, corrupt, or newer
- 🧩 **Runtime ONNX Web / WebGPU / WASM**: `<app_userData>/ort/` — inizializzato dal pacchetto `public/ort`, mai nella cartella temporanea dell'OS / seeded from packaged `public/ort`, never OS Temp

### 🌐 Lingua / Language
- [🇮🇹 **Italiano**](#-italiano) • [☕ *Supporta il Progetto*](#-supporta-il-progetto) • [⚖️ *Disclaimer Legale & Copyright*](#️-disclaimer-legale-copyright--marchi-registrati) • [📚 *Fonti & Licenze Terze*](#-attribuzioni-fonti--licenze-librerie-terze) • [📄 *Licenza*](#-licenza)
- [🇬🇧 **English**](#-english) • [☕ *Support the Project*](#-support-the-project) • [⚖️ *Legal Disclaimer & Trademarks*](#️-legal-disclaimer-copyright--trademarks) • [📚 *Third-Party Sources & Licenses*](#-third-party-libraries-citations--licenses) • [📄 *License*](#-license)

---

<a name="italiano"></a>
# 🇮🇹 Italiano

**Karaoke Live Station** è un'applicazione desktop professionale e multipiattaforma progettata per DJ di karaoke, presentatori di eventi, locali di intrattenimento dal vivo e feste private.

Sviluppata su un'architettura a **doppia finestra indipendente (Regia Operatore + Schermo Palco)**, integra un motore avanzato di **Separazione Vocale AI Offline** (UVR-MDX-NET Karaoke 2 / HTDemucs) con accelerazione hardware GPU nativa (**WebGPU / Vulkan**) e fallback CPU multithread, un processore audio DSP in tempo reale ad alta fedeltà (**Signalsmith Stretch Hi-Fi**) per la trasposizione della tonalità (in semitoni) e la velocità (senza alterazione del pitch), sintesi General MIDI / KAR con banco SoundFont professionale GeneralUser GS da 31 MB, rendering grafico CD+G a 30 fps, coda equa anti-monopolio con memoria delle tonalità dei cantanti, e un **Guest Portal LAN** integrato con codice QR per permettere al pubblico di richiedere brani direttamente dallo smartphone.

> 💡 **Nota di Sviluppo**: Questo software è stato interamente ideato, architettato e sviluppato con **Google Antigravity**, l'ambiente avanzato di sviluppo ad agenti autonomi di Google DeepMind, e con **Cursor**.

---

## 🌟 Caratteristiche Principali

### 🧠 Separazione Vocale AI Offline & Rimozione Voce (WebGPU Hardware Acceleration + Multithread CPU)
- **Isolamento Strumentale AI di Livello Studio (100% Locale e Privato)**: Trasforma qualsiasi brano o video in una traccia strumentale karaoke professionale ad altissima fedeltà acustica grazie a reti neurali all'avanguardia eseguite interamente in locale:
  - **UVR-MDX-NET Karaoke 2 (Predefinito)**: Modello neurale specializzato nell'isolamento ed eliminazione della voce solista, preservando con precisione chirurgica cori, armonie vocali, linea di basso e dinamica ritmica (geometria STFT/iSTFT UVR nativa).
  - **HTDemucs (Demucs v4 4-stem)**: Architettura neurale ibrida tempo/frequenza con opzioni avanzate di spostamento (*shifts*), dimensione segmento (5–20s) e sovrapposizione (*overlap* 10–50%).
- **Accelerazione Hardware GPU Nativa (WebGPU / Vulkan / Dawn)**: Sfrutta tutta la potenza di calcolo della scheda grafica dedicata (NVIDIA GeForce, AMD Radeon, Intel Iris/Arc) attraverso lo stack WebGPU nativo di Chromium ed Electron tramite **ONNX Runtime Web (JSEP)**:
  - **Prestazioni Estreme**: Inferenza ultra-rapida (~1.7 secondi per blocco su GPU dedicata NVIDIA vs oltre 4-6 secondi su CPU ad alto carico). Un intero brano da 4 minuti viene separato e remuxato in pochissimi secondi.
  - **Zero Dipendenze Esterne**: Nessun bisogno di installare Python, PyTorch, CUDA Toolkit o ambienti virtuali. Il runtime neurale è completamente integrato e auto-contenuto nell'eseguibile dell'applicazione.
- **Doppio Percorso Integrato (Live DSP Istantaneo vs AI Profonda)**:
  - **Durante la Serata Live (Tasto `V` - Algoritmo Base)**: Rimozione istantanea a latenza zero tramite elaborazione DSP mid/side in tempo reale (`centerCancelBassKeep`, `centerCancel`, `softMid`) per attenuare al volo la voce guida senza alcun ritardo di buffering.
  - **In Download & Archiviazione (AI Neurale)**: Generazione automatica della traccia strumentale isolata ad alta risoluzione durante il download o l'importazione, con remuxing automatico in video MP4/WebM pronto all'uso con sottotitoli sincronizzati.
- **Watchdog di Sicurezza & Fallback Trasparente su CPU**: Se la GPU non è disponibile o viene disattivata nelle impostazioni, il sistema commuta istantaneamente e in modo trasparente sui worker multithreaded WASM CPU (SIMD), con regolazione automatica o manuale dei core CPU (`aiCpuThreads`).
- **Gestione Offline dei Modelli (`<app_userData>/models/`)**: I file ONNX (~50 MB per MDX) vengono scaricati una sola volta con verifica SHA-256 e archiviati nella cartella utente dell'app. Nessun dato audio viene mai inviato all'esterno o sul cloud.

### 🎛️ Architettura a Doppia Finestra
- **Finestra Regia (Control Desk)**: Console operatore completa con scrubber audio, visualizzatore di forma d'onda, mixer a 16 canali MIDI, gestione coda, ricerca catalogo e pre-ascolto in cuffia (CUE).
- **Finestra Palco (Stage Screen)**: Schermo pulito per cantante e pubblico da inviare su TV o videoproiettore (supporto F11 / doppio clic per fullscreen senza bordi). Visualizza video MP4/WebM, grafica CD+G o testo karaoke sincronizzato con banner animati "Ora Canta" e "Preparati".
- **Streaming HTTP 206 Partial Content**: Protocollo proprietario `karaoke://local/` con streaming a chunk byte-range. Lo schermo del palco può essere aperto, chiuso o riaperto a brano in corso senza pause né desincronizzazioni.
- **Protezione Istanza Singola (Single Instance Lock)**: Previene l'apertura accidentale di istanze duplicate; qualsiasi avvio concorrente ripristina e mette a fuoco la console di regia principale già aperta.
- **Avvio Regia / Palco (v1.3.0)**: Opzione per massimizzare la Regia all’avvio (`maximize()`, non fullscreen esclusivo) e per aprire o meno lo Schermo Palco. Se il Palco è spento all’avvio, riaprilo con **P** / **F2** o il pulsante Stage. Impostazioni più ampie (sidebar) con metodo Download Strumentale, MDX avanzate e **core CPU AI** sotto Libreria & Download (default: tutti i core rilevati).
- **DSP pitch/speed (v1.4.0)**: Motore predefinito **Signalsmith Stretch Hi-Fi** (Wasm AudioWorklet, MIT); **SoundTouch WSOLA** selezionabile. Modal conferma sottotitoli su **Scarica strumentale** (`ask`/`always`/`never`); yt-dlp `--sub-langs .*-orig,default`.
- **Hot path / logging (v1.5.0)**: Dedup download SQL mirato (niente `getAllTracks` dump); Guest FTS/id; ZIP inflate async + yield FFT; prune `clsx`/`tailwind-merge`/`autoprefixer`/`postcss`; Logger strutturato con maschera secret.

### 🎨 9 Temi Grafici & Schermo Palco Ottimizzato Edge-to-Edge
- **9 Combinazioni Cromatiche Complete**: Personalizzazione indipendente per Regia e Palco (*Dark Stage, Midnight Neon, Club Gold, Ocean Breeze, Sunset Crimson, Emerald Matrix, Royal Amethyst, High Contrast, Light Studio*).
- **Video a Tutto Schermo (Edge-to-Edge al 100%)**: Lo Schermo Palco massimizza l'area visiva senza cornici o padding sprecato, adattando video 16:9, 4:3 e panoramici senza distorsioni.
- **Titolo Brano Flottante a Scomparsa**: Titolo e artista appaiono fluttuanti in basso al centro per una durata configurabile nelle opzioni (da 2 a 30 secondi, default 8s) per poi dissolversi dolcemente, lasciando il video e il testo del karaoke privi di ostacoli visivi.
- **Barra di Avanzamento a Basso Profilo**: Barra di avanzamento ultra-sottile integrata a filo sul bordo estremo inferiore.
- **Messaggi Stage personalizzabili (testo, stile, sfondo)**: In Impostazioni → Schermo Stage puoi modificare testo, grassetto/corsivo, dimensione, attivazione e **sfondo dello Stage (colore o immagine) per ogni messaggio** (es. “Prossimo cantante”). Lo sfondo personalizzato vale solo mentre il messaggio è visibile; al termine torna lo sfondo normale del tema/video.
- **Badge Tonalità Configurabile su Schermo Palco**: Possibilità di mostrare o nascondere nelle Opzioni il badge con i semitoni di variazione (+/-) rispetto alla tonalità originale (`showPitchOnStage`).
- **Badge Velocità Configurabile su Schermo Palco**: Opzione per mostrare o nascondere il badge della velocità di riproduzione (es. 1.00x, 1.25x) sul monitor palco (`showSpeedOnStage`).

### 📁 Configurazione Libreria & Anteprima Video Versioni
- **Scelta Guidata al Primo Avvio**: Alla prima apertura, una finestra di dialogo interattiva consente all'utente di scegliere se utilizzare la cartella predefinita "Karaoke" nella propria home utente (`~/Karaoke` o `C:\Users\<Utente>\Karaoke`) oppure selezionare una cartella personalizzata già esistente sul computer.
- **Refresh Automatico all'Avvio & Ricarica Istantanea**: Ad ogni avvio del programma, viene eseguita automaticamente una scansione della cartella (upsert SQLite in batch; miniature FFmpeg in background, senza bloccare la Regia). Inoltre, ogni nuovo download o salvataggio aggiorna istantaneamente la vista Libreria senza attese.
- **Aggiornamento Manuale con 1 Clic**: Il pulsante **"Aggiorna Libreria"** esegue la scansione immediata della cartella configurata con un solo clic, senza dover riaprire la finestra di dialogo del file system.
- **Drag & Drop da filesystem**: Trascina file karaoke (`.mp4` / `.webm` / `.mkv` / `.avi`, `.mp3`+`.cdg`, **`.zip` CD+G** (MP3/WAV+CDG), `.mid` / `.kar`) sulla Libreria Locale per catalogarli, o sulla coda Regia per importarli e metterli in scaletta. Overlay solo con drop OS (`Files`); non interferisce con il riordino drag della coda. Thumbnail video generate in modo non bloccante sul multi-drop.
- **ZIP CD+G nativo**: Gli archivi `.zip` con coppia audio+`.cdg` sono catalogati come brani locali con lyrics; estrazione on-demand in cache temp, cleanup a dequeue/uscita.
- **Tonalità / BPM in Regia**: Rilevamento asincrono di tonalità e BPM; le pillole Pitch/Speed mostrano `base→risultato` accanto ai controlli ± esistenti (senza sostituirli).
- **Archiviazione Automatica & Cache di Coda Persistente**: L'archiviazione automatica è attiva per default (`true`). Disattivandola (con modale di conferma e avviso di sicurezza), i download web vengono custoditi nella cartella protetta `<userData>/queue_cache/`, persistendo tra i riavvii finché in scaletta, e vengono rimossi dal disco tramite Garbage Collection solo allo scodamento effettivo. Con archiviazione ON, **Metti in coda** da YouTube attende download+archivio, aggiorna Locale e accoda il **file locale** (niente puntatori remoti/temp non riproducibili).
- **Icona ufficiale**: packaging Windows/Linux/macOS e favicon usano il logo `public/logo.png` (`build/icon.png`, `build/icon.ico`, `build/icons/`).
- **Salvataggio Contestuale in 1 Clic**: Pulsante "Salva in Libreria" sempre visibile sulle righe della coda e nella testata del player per promuovere qualsiasi traccia web/cache nella libreria definitiva.
- **Ricerca Locale / Web ad ambiti separati**: Le modalità Libreria e Web/YouTube mantengono query, risultati, loading e scroll indipendenti: cambiare tab non perde lo stato né avvia ricerche indesiderate. La ricerca locale (e gli altri filtri in-app) è **case-insensitive e accent-insensitive** (es. `moriro da re` trova `morirò da re`); le query con accenti restano valide.
- **Elimina dalla libreria**: Rimozione dal catalogo SQLite con conferma; i file su disco vengono cancellati solo se permanenti sotto la cartella libreria (`libraryPath`), non dalla cache di coda.
- **File locali mancanti (USB / spostati)**: Prima di mettere in coda o riprodurre, l’app verifica il path locale via IPC `library:check-file-exists`. Se il file non c’è (chiavetta scollegata, spostato/eliminato fuori app), blocca l’azione, evidenzia la riga in rosso e apre un modale **Elimina** / **Lascia in elenco** — nessuna cancellazione automatica dal catalogo o dalla coda. YouTube/remoto senza `localFilePath` salta il check.
- **Anteprima Video 16:9 & Riconoscimento Versioni**: Ciascun brano in libreria e nei risultati di ricerca mostra una miniatura video reale (estratta automaticamente con `ffmpeg` a 4 secondi per i file locali, e da YouTube per le ricerche online) e i chip di riconoscimento versione (es. *KaraFun*, *Karaoke Academy Italia*, *Sing King*, *Con Cori*, *Strumentale*).
- **Modale Anteprima / Pre-Ascolto tematico**: Miniatura, Anteprima (`Eye`) o **Pre-ascolto** aprono un modale tematico con audio sul dispositivo CUE; mute/volume sul player incorporato (niente barra volume dedicata) e avviso se CUE e Master coincidono al unmute (video/audio/MIDI **e** embed YouTube ricerca Web).
- **YouTube → coda (archiviazione ON)**: attende download + archivio, **reindicizza Local con thumbnail**, poi accoda il file locale (senza «Aggiorna libreria» manuale).

### 🎹 Sintesi MIDI & KAR con SpessaSynth
- **SoundFont GeneralUser GS (31 MB) Integrato**: Suono ricco e fedele all'hardware, configurato come predefinito out-of-the-box per Linux, Windows e macOS.
- **Riproduzione Fluida a Latenza Zero**: Scheduler diretto a 5ms su Web Worker con ranking di priorità MIDI degli eventi simultanei (`ProgramChange` ➔ `ControlChange` ➔ `PitchBend` ➔ `NoteOff` ➔ `NoteOn`).
- **Nessuna Interruzione Audio**: Architettura protetta da change guards e buffer `latencyHint: 'playback'` che eliminano qualsiasi scatto o micro-buffer underrun.
- **Mixer Live 16 Canali**: Muting istantaneo di singoli canali (es. traccia guida vocale sul canale 4).
- **Transposizione Live**: Variazione della tonalità da -8 a +8 semitoni applicata direttamente ai numeri di nota MIDI in tempo reale.

### 🎵 Motore DSP Audio & Pre-Ascolto Cuffie (CUE)
- **Pitch-Shifting Professionale (Signalsmith Stretch Hi-Fi predefinito + SoundTouch opzionale)**: Motore DSP predefinito **Signalsmith Stretch** (Wasm AudioWorklet, licenza MIT — processore audio ad altissima fedeltà e minima colorazione armonica). Range UI consigliato ±8 ST (fino a ±12). **SoundTouch WSOLA** resta selezionabile in Impostazioni come motore legacy/leggero (±4 ST). Bypass bit-perfect a pitch 0 e velocità 1.00x (zero latenza e zero carico CPU). MIDI/KAR invariato (SpessaSynth).
- **Time-Stretching e Variazione Velocità Estesa (0.50x–1.50x)**: Regolazione fine del tempo di riproduzione senza alcuna alterazione del pitch. Cliccando sull'indicatore numerico si ripristina istantaneamente la velocità standard 1.00x.
- **Rimuovi Voce Guida Live (Algoritmo Base) — Tasto `V`**: In Regia il toggle applica in tempo reale l'elaborazione **DSP mid/side** (`centerCancelBassKeep`, `centerCancel`, `softMid`) selezionabile da tendina dedicata, ideale per attenuare istantaneamente la traccia vocale durante l'esecuzione live. (Per la separazione strumentale neurale offline ad alta fedeltà, vedi la sezione dedicata **Separazione Vocale AI**).
- **Normalizzazione Dinamica del Volume Audio (Auto-Leveling)**: Stadio DSP basato su processore `DynamicsCompressorNode` (soglia a -22 dB, ratio 6:1, knee 24 dB, attacco ultra-rapido a 3 ms e rilascio a 250 ms) combinato con trucco di makeup gain a 1.35x. Livella in tempo reale la dinamica del volume tra brani diversi, attenuando le tracce con picchi eccessivi e amplificando quelle a basso volume, garantendo un'emissione acustica omogenea e professionale nella sala senza continui interventi manuali sul fader del volume.
- **Pre-ascolto CUE**: Routing audio su scheda secondaria (`setSinkId`); dalla Libreria apre il modale anteprima tematico sul dispositivo CUE (mute via player; avviso stesso-dispositivo all’unmute).
- **Auto-Ducking Intelligente**: Abbassamento automatico e graduale della musica durante gli annunci al microfono.

### ⌨️ Scorciatoie da Tastiera Rapide & Guida Interattiva (Control Console)
Premi **`F1`** o **`?`** in qualsiasi momento per aprire la guida interattiva con ricerca (stesso inventario completo anche in **Impostazioni → Scorciatoie**).
- **`Spazio`**: Play / Pausa immediato.
- **`S`**: Stop con riavvolgimento traccia a 0:00.
- **`R`**: Riavvia la canzone corrente dall'inizio (0:00).
- **`N`**: Salta al prossimo brano in scaletta (con registrazione nello storico SIAE).
- **`M`**: Muto Master On/Off immediato.
- **`V`**: Attiva / Disattiva la Rimozione Voce Guida DSP (**Algoritmo Base**).
- **`D`**: Attiva / Disattiva il Microfono Auto-Ducking.
- **`+` / `-`** oppure **`CTRL + Freccia Su / Giù`**: Regolazione tonalità (±1 semitono; range UI dinamico: Signalsmith ±8, SoundTouch ±4).
- **`CTRL + Freccia Sinistra / Destra`**: Regolazione tempo (±5%, da 0.50x a 1.50x).
- **`Freccia Sinistra / Destra`**: Salto temporale indietro / avanti di 5 secondi.
- **`Freccia Su / Giù`**: Regolazione del volume master (±5%) con curva quadratica psicoacustica ($Gain = volume^2$) e anti-click ramping a 50ms.
- **`1` / `2` / `3`**: Passaggio rapido schede (1: Coda Cantanti, 2: Ricerca & Libreria, 3: Storico SIAE).
- **`CTRL + F`**: Apri la scheda Libreria e focalizza la barra di ricerca.
- **`P` / `F2`**: Riapri / Metti a fuoco lo Schermo del Palco.
- **`F11` / `Esc`**: Schermo intero (sul monitor del Palco).
- **`Esc`**: Chiudi finestre modali o disattiva il focus corrente.
- 📖 Per la guida operativa passo-passo consulta il [Manuale Utente completo (USER_MANUAL.md)](USER_MANUAL.md).

### ⚖️ Algoritmo Fair Queue, Drag & Drop, Ripristino & Memoria Tonalità
- **Rotazione Equa Anti-Monopolio (Attiva di Default)**: Abilitata per impostazione predefinita (`enableFairQueue: true`), prioritizza le richieste calcolando il turno equo in base al numero di canzoni già cantate da ciascun partecipante e all'orario di richiesta, con override manuale VIP.
- **Drag & Drop della Coda**: Possibilità di riordinare visivamente con il mouse i brani in attesa nella scaletta tramite la maniglia di trascinamento laterale. Il primo brano attivo in riproduzione rimane bloccato in testa per evitare disconnessioni dello stage.
- **Pulsante "Ripristina coda automatica"**: Con un solo clic nella testata della coda, reimposta immediatamente l'ordine ideale dell'algoritmo Fair Queue, riequilibrando i turni dei cantanti dopo eventuali modifiche manuali.
- **Scelta Posizione di Inserimento (Fair Queue vs In fondo)**: Quando si aggiunge un brano dalla Libreria o dall'Anteprima Video con l'algoritmo attivo, è possibile scegliere se lasciar calcolare la posizione equa all'algoritmo (*Fair Queue*) oppure inserire il brano direttamente in coda (*In fondo alla coda*).
- **Prevenzione Cantanti Duplicati**: Controllo rigoroso case-insensitive nel database SQLite e nell'interfaccia per evitare la creazione accidentale di profili omonimi e garantire il perfetto funzionamento dell'algoritmo di rotazione.
- **Avvio Diretto del 1° Brano in Coda**: Il pulsante Play sul primo elemento della scaletta consente di avviare o mettere in pausa immediatamente la riproduzione del brano corrente, con stato visivo sincronizzato.
- **Memoria Tonalità Cantante**: Memorizza la tonalità preferita per ciascun cantante e la applica automaticamente quando il brano entra in esecuzione.
- **Persistenza Scaletta & Protezione Anti-Crash**: L'intera scaletta della coda (brani, cantanti assegnati, tonalità e posizioni) viene memorizzata costantemente nello storage locale. Se il software viene chiuso o subisce un riavvio imprevisto, alla riapertura la coda viene ripristinata fedelmente, con il primo brano pronto e in pausa a 0:00 sul banco regia.
- **Pulsante "Svuota Coda" con Conferma di Sicurezza**: Pulsante rapido con icona cestino per azzerare l'intera coda e fermare la riproduzione in un solo passaggio, protetto da finestra di conferma per evitare cancellazioni accidentali durante gli eventi.
- **Banner Schermo Palco "Prossima Esibizione"**: Notifica pulita e uniforme per il cantante e il pubblico che segnala il prossimo brano e performer sul palco.

### 📱 Portale Ospiti Mobile via Wi-Fi (Guest Portal)
- **Server LAN Integrato**: Server Express e Socket.IO integrato a zero configurazione.
- **QR Code Dinamico**: Il pubblico inquadra il QR code con lo smartphone, visualizza la scaletta in tempo reale e invia richieste direttamente dal telefono.
- **Selezione Obbligatoria da Libreria**: Ricerca istantanea con filtro in tempo reale sul catalogo locale. Sostituisce l'inserimento manuale a testo libero: solo i brani realmente presenti nella libreria possono essere prenotati, con selezione del cantante e della tonalità vocale (da -4 a +4 semitoni).
- **Approvazione DJ Immediata**: Il gestore approva le richieste con un clic, inserendo nella scaletta il brano effettivo con la sua tonalità richiesta.

### 🛡️ Assistente Firewall & Connessione LAN Multipiattaforma
- **Diagnosi Automatica al Volo**: Rileva automaticamente il sistema operativo in uso ed esegue un'ispezione non invasiva dello stato del firewall di sistema:
  - **Windows**: Rileva le regole di ingresso di *Windows Defender Firewall* tramite `netsh advfirewall`.
  - **macOS**: Rileva lo stato globale del firewall applicativo di macOS (*ALF*) tramite `socketfilterfw`.
  - **Linux**: Rileva lo stato di *UFW* (`/etc/ufw/ufw.conf`) e genera comandi per *UFW* e *Firewalld*.
- **Comandi di Sblocco con Copia in 1 Clic**: Se gli smartphone non riescono a caricare la pagina del Guest Portal (porta TCP 3000-3010), l'assistente fornisce il comando esatto per PowerShell / Prompt o Terminale, con pulsante di copia dedicato e formattazione a riga singola con scorrimento orizzontale privo di tagli o parole spezzate.
- **Istruzioni Grafiche Passo-Passo (GUI)**: Guida integrata per autorizzare l'applicazione tramite l'interfaccia grafica di sistema (Pannello di controllo di Windows o Impostazioni di Sistema macOS).
- **Verifica Isolamento AP Wi-Fi**: Promemoria integrato per verificare che nelle impostazioni del modem o router l'opzione "Isolamento AP" (AP Client Isolation) sia disattivata.

### 🌐 Supporto Multilingua Nativo (i18n)
- **4 Lingue Supportate al 100%**:
  - 🇮🇹 **Italiano** (Lingua nativa con interfaccia completa, registro SIAE e guide)
  - 🇬🇧 **English** (Full international English translation across all dialogs and features)
  - 🇪🇸 **Español** (Traducción completa al español para consola y pantalla del escenario)
  - 🇫🇷 **Français** (Traduction française intégrale de la régie et de la scène)
- **Rilevamento Automatico della Lingua**: All'avvio il software rileva la lingua del sistema operativo dell'utente impostandola automaticamente.
- **Cambio Lingua Istantaneo**: Dalla finestra Opzioni (`Impostazioni` ➔ `Lingua / Language`) è possibile cambiare lingua in qualsiasi momento in tempo reale, con salvataggio persistente della preferenza senza dover riavviare l'applicazione.

### 📜 Tab Storico Esecuzioni & Borderò SIAE
- **Nuovo Tab Dedicato "Storico"**: Organizzazione a 3 schede nella console di Regia (*Coda*, *Libreria*, *Storico*).
- **Criterio Intelligente di Tracciamento Esecuzioni**: Il brano in esecuzione viene registrato nello storico e nel registro SIAE se giunge al suo **termine naturale** oppure se viene fermato/saltato dall'operatore dopo essere stato riprodotto per **almeno 2 minuti (120 secondi)**. Brani scartati o fermati prima dei 120 secondi non sporcano il registro.
- **Prevenzione Duplicati con Flag di Guardia (`alreadyLogged`)**: Ciascuna istanza di brano tiene traccia dell'avvenuta registrazione, impedendo duplicazioni accidentali in caso di stop successivi o avanzamenti dopo i 120 secondi.
- **Memoria Storica Persistente & Timestamp ISO 8601**: Archiviazione su database SQLite (`siae_logs`) con data/ora in formato standard ISO 8601, timestamp Unix in millisecondi, titolo, artista, cantante e durata effettiva.
- **Filtro di Ricerca Istantaneo**: Permette di cercare rapidamente tra i brani già cantati per titolo, autore o nome del cantante (anche senza digitare gli accenti).
- **Esportazione Borderò SIAE (CSV)**: Generazione con un clic del file CSV conforme con colonne `Data e Ora (ISO 8601)` e `Timestamp (Epoch ms)` per la rendicontazione dei diritti d'autore SIAE.
- **Svuotamento Sicuro con Conferma**: Pulsante "Svuota Storico" con dialogo di sicurezza per azzerare il registro al termine della serata o dell'evento.
- **Log Diagnostico Persistente**: Sistema di log diagnostico continuo su file con rotazione e livelli configurabili (Debug, Info, Warn, Error).

### ⚡ Motore yt-dlp & Gestione Eseguibili Standalone Multipiattaforma
- **Zero Installazioni Esterne nei Pacchetti di Release**: Negli eseguibili distribuiti per Windows (`.exe`), Linux (`.AppImage`, `.deb`) e macOS (`.dmg`), l'applicazione è al 100% autosufficiente. Non richiede l'installazione manuale preliminare di `yt-dlp`, `ffmpeg`, né la manipolazione di variabili di ambiente PATH.
- **Rilevamento e Download Automatico all'Avvio**: All'avvio, il servizio `YtDlpUpdater` controlla la presenza dell'eseguibile sul sistema e interroga in background l'API GitHub di `yt-dlp`. Se l'eseguibile non è presente, viene scaricato automaticamente il binario ufficiale compatibile con il sistema operativo e l'architettura in uso (x86_64 o ARM64).
- **Aggiornamento Trasparente in Background**: Qualora sia disponibile una nuova release di `yt-dlp`, il sistema scarica e valida il nuovo file in una cartella dati utente scrivibile (`userData/bin/`), impostando i permessi di esecuzione (`chmod 0755` su Linux e macOS) e sostituendolo in modo atomico, garantendo che i download web continuino a funzionare anche a fronte di cambi API da parte di YouTube.
- **Risoluzione Relativa delle Risorse (`BinaryResolver`)**: Tutti i path dei binari e delle risorse sono risolti dinamicamente con percorsi relativi conformi ad Electron, prevenendo errori di permessi di sola lettura tipici delle directory di installazione (`C:\Program Files`, `/opt`).
- **Pannello di Controllo Dedicato nelle Impostazioni**: Mostra lo stato di operatività, la versione corrente e il percorso del binario, con pulsante manuale per forzare la verifica e l'aggiornamento.

---

## 📋 Prerequisiti

- **Node.js**: versione `20.x` o `22.x` (LTS consigliata)
- **npm**: versione `10.x` o superiore
- **Sistema Operativo**:
  - **Linux**: Ubuntu 20.04+, Debian 11+, Fedora 36+, Arch Linux o derivate.
  - **Windows**: Windows 10 o Windows 11 (64-bit).
  - **macOS**: macOS 11 Big Sur, 12 Monterey, 13 Ventura, 14 Sonoma o successivi.

---

## 🚀 Installazione ed Esecuzione Rapida

```bash
# 1. Clona il repository o entra nella cartella del progetto
cd KaraokeStation

# 2. Installa le dipendenze
npm install

# 3. Verifica i tipi TypeScript
npm run typecheck

# 4. Compila i bundle frontend e main
npm run build

# 5. Avvia l'applicazione in modalità desktop
npm start
```

Per sviluppare con hot-reload attivo:
```bash
npm run electron:dev
```

---

## 📦 Creazione Pacchetti ed Eseguibili di Release

L'applicazione include un sistema di packaging avanzato basato su `electron-builder` che genera pacchetti autosufficienti, puliti e privi di dipendenze esterne.

### 🧹 Pulizia Automatica di Database e Dati di Test
Prima della generazione di ogni pacchetto di release (`npm run electron:build:*`), il processo di build esegue automaticamente lo script `scripts/clean-test-data.js`:
- **Database di Test**: Rimuove completamente il file SQLite locale `karaoke_station.db` e i relativi file di log WAL/SHM, azzerando brani inseriti durante i test, profili cantante, code temporanee e storico esecuzioni.
- **Dati Utente e Cache di Sessione**: Elimina le directory e i file di stato (`Preferences`, `Local Storage`, `Session Storage`).
- **File Temporanei e Miniature**: Svuota le miniature video generate in cache (`thumbnails/*.jpg`), i download temporanei (`temp/`) e i log di diagnostica (`logs/*.log`).
In questo modo, ogni nuova release compilata è garantita al 100% pulita e pronta per l'utente finale, che partirà da una configurazione iniziale vergine.

### 🐧 Per Linux (AppImage & deb)
```bash
npm run electron:build:linux
```
I file `.AppImage` (238 MB) e `.deb` (209 MB) verranno generati nella cartella `release/`, contenenti esclusivamente i binari Linux (`yt-dlp`, `ffmpeg`, `better-sqlite3` ELF 64-bit).

### 🪟 Per Windows (Portable .exe & Standalone ZIP)
```bash
npm run electron:build:win
```
Verranno generati in `release/` l'eseguibile portatile autonomo `Karaoke Live Station 1.5.0.exe` (avviabile immediatamente senza installazione né privilegi di amministratore) e l'archivio `Karaoke Live Station-1.5.0-win.zip`, con binari esclusivi Win32 PE (`yt-dlp.exe`, `ffmpeg.exe`, `better_sqlite3.node`).

### 🍎 Per macOS (.zip)
```bash
npm run electron:build:mac
```
L'archivio `Karaoke Live Station-1.5.0-mac.zip` contenente l'applicazione `.app` pronta all'uso verrà generato in `release/`, con binari esclusivi Darwin Mach-O (`yt-dlp`, `ffmpeg`, `better_sqlite3.node`).

### 🌐 Creazione Release per tutte le piattaforme
```bash
npm run electron:build:all
```

> 📌 **Primo Avvio & Percorsi di Default**:
> - **Selezione Cartella Libreria**: Alla prima apertura, una finestra di dialogo interattiva invita l'utente a scegliere se utilizzare la cartella predefinita "Karaoke" nella propria home (`~/Karaoke` o `C:\Users\<Utente>\Karaoke`) oppure sfogliare e selezionare una cartella già esistente. Se l'utente annulla, viene utilizzata la cartella predefinita creandola automaticamente.
> - **Refresh Automatico all'Avvio**: Ad ogni apertura del programma, se la cartella della libreria è impostata, viene eseguita automaticamente una scansione in background del percorso per rilevare e indicizzare istantaneamente nel catalogo eventuali nuovi brani aggiunti o rimossi.
> - **SoundFont Predefinito**: Il banco ad alta fedeltà `GeneralUser-GS.sf2` (31 MB) è pre-incluso in tutte le release ed è configurato come predefinito out-of-the-box.
> - **Zero Inquinamento Multipiattaforma**: Ogni pacchetto di release contiene esclusivamente gli eseguibili e le librerie native compilate per quel sistema operativo (nessun eseguibile `.exe` su Linux/Mac, nessun binario ELF su Windows).

---

## ☕ Supporta il Progetto

Se trovi utile **Karaoke Live Station** per le tue serate, feste o eventi e desideri sostenere il continuo sviluppo, l'aggiunta di nuove funzionalità e la manutenzione del software, puoi offrire un caffè o fare una donazione libera tramite PayPal:

<p align="center">
  <a href="https://www.paypal.com/paypalme/LucaAbagnale" target="_blank">
    <img src="https://img.shields.io/badge/Donazione-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Fai una donazione con PayPal" />
  </a>
</p>

<p align="center">
  👉 <a href="https://www.paypal.com/paypalme/LucaAbagnale"><strong>paypal.me/LucaAbagnale</strong></a> 👈
</p>

> ❤️ *Ogni contributo, anche piccolo, è un supporto prezioso per mantenere il progetto aperto, gratuito, aggiornato e indipendente per tutti. Grazie di cuore!*

---

## ⚖️ Disclaimer Legale, Copyright & Marchi Registrati

### 1. Assenza di Contenuti Musicali Inclusi & Licenze di Pubblica Esecuzione (SIAE, SCF, etc.)
- **Karaoke Live Station** è esclusivamente un software gestionale, un player multimediale e un processore audio DSP.
- **Il software NON include, NON distribuisce e NON ospita alcun file musicale o multimediale protetto da diritto d'autore**, né basi commerciali karaoke (MP3+G, MIDI, KAR, MP4, WebM o tracce audio).
- L'utente finale (DJ, animatore, gestore del locale o organizzatore di eventi) è **l'unico ed esclusivo responsabile** dell'acquisizione legittima di tutti i file riprodotti e dell'ottenimento delle necessarie licenze per la pubblica esecuzione e la riproduzione meccanica rilasciate dagli enti competenti di gestione dei diritti d'autore e connessi (in Italia, in via esemplificativa, **SIAE** e **SCF**, ovvero gli organismi di gestione collettiva competenti per territorio all'estero come BMI, ASCAP, PRS for Music, GEMA, SACEM).
- La funzionalità di esportazione *"Borderò SIAE (CSV)"* è fornita unicamente come supporto tecnico e promemoria gestionale per facilitare la compilazione del programma musicale (borderò). L'uso di tale funzione non costituisce, non sostituisce e non esonera in alcun modo l'utente dal possesso di una regolare licenza SIAE/SCF e dal rispetto degli obblighi di legge previsti per le esecuzioni pubbliche.

### 2. Integrazione con Piattaforme Web, YouTube & Download Runtime (yt-dlp)
- La funzione di ricerca e riproduzione da fonti web si appoggia all'utility open source `yt-dlp`. Tale funzionalità è destinata esclusivamente alla ricerca di video a pubblico dominio, licenze Creative Commons, copie di backup personali consentite o contenuti legittimamente fruibili per uso privato e didattico, nel rispetto dei Termini di Servizio delle rispettive piattaforme.
- **Download ed Esecuzione Automatica di yt-dlp**: Il software include un gestore di installazione e aggiornamento automatico (`YtDlpUpdater`) che preleva gli eseguibili compilati ufficiali unicamente dal repository GitHub certificato (`https://github.com/yt-dlp/yt-dlp/releases`). Tali file vengono archiviati esclusivamente nello spazio isolato dei dati applicativi dell'utente (`userData/bin/`) senza modificare file di configurazione globali o cartelle di sistema. L'utente ha sempre la facoltà di indicare o utilizzare un binario personalizzato impostando la variabile d'ambiente `YTDLP_PATH`.
- **YouTube™** è un marchio registrato di titolarità esclusiva di **Google LLC / Alphabet Inc.**
- **Karaoke Live Station** è un progetto open source indipendente e **non è affiliato, approvato, sponsorizzato o associato in alcun modo a Google LLC, YouTube o a produttori/distributori di basi karaoke di terze parti**.
- Gli sviluppatori del software declinano qualsiasi responsabilità civile o penale per eventuali usi illeciti, violazioni del copyright o violazioni dei Termini di Servizio di YouTube o di altre piattaforme web commesse dagli utenti finali.

### 3. Proprietà dei Marchi di Terze Parti (Nominative Fair Use)
- Tutti i marchi registrati, marchi di fabbrica, denominazioni commerciali, loghi o nomi di aziende citati nel presente repository, nell'interfaccia software o nella documentazione (inclusi, a titolo puramente esemplificativo: *YouTube*, *KaraFun*, *M-Live*, *SongService*, *Sing King*, *Sunfly*, *GeneralUser GS*, *SoundTouch*, *SpessaSynth*, *Apple*, *Microsoft Windows*, *Linux*) sono di proprietà esclusiva dei rispettivi titolari legittimi.
- La loro menzione all'interno del progetto (ad esempio nei filtri di riconoscimento versione, nei parser di metadati, nei SoundFont o nelle opzioni di compatibilità audio/sistema) risponde unicamente a finalità di identificazione descrittiva, interoperabilità tecnica e informazione all'utente (*nominative fair use*), senza che ciò costituisca pretesa di appartenenza, sponsorizzazione o affiliazione commerciale.

### 4. Esclusione di Garanzia e Limitazione di Responsabilità ("AS IS")
- Il presente software è distribuito "COSI COM'È" (*AS IS*), senza garanzie di alcun tipo, esplicite o implicite, incluse, a mero titolo di esempio, garanzie di commerciabilità, idoneità a scopi specifici o non violazione. In nessun caso gli autori o collaboratori del progetto potranno essere ritenuti responsabili per qualsivoglia reclamo, sanzione amministrativa, danno diretto o indiretto derivante dall'utilizzo o dalla riproduzione di contenuti tramite questo software.

---

## 🧩 Stack Dipendenze (runtime rilevante per AI / download)

| Pacchetto | Ruolo in Karaoke Live Station |
| :--- | :--- |
| **onnxruntime-web** | Motore neurale con accelerazione GPU nativa (WebGPU JSEP) e fallback WASM multithread CPU per separazione vocale AI (UVR-MDX-NET / HTDemucs) |
| **demucs-web** | Wrapper HTDemucs ONNX (caricato lazy solo sul path HTDemucs) |
| **fft.js** | STFT / iSTFT Bluestein per MDX (`audioFft.ts`) |
| **ffmpeg-static** | Demux / remux strumentale e miniature video |
| **electron** | Main + BrowserWindow nascosto WebGPU per inferenza GPU nativa + utilityProcess worker CPU |
| **zustand** | Persistenza impostazioni (incluso metodo strumentale, toggle GPU-First e knobs MDX/Demucs) |
| **signalsmith-stretch** | Motore Pitch & Speed Hi-Fi su AudioWorklet Wasm (default `dspEngine: 'signalsmith'`) |
| **soundtouchjs** | Algoritmo WSOLA legacy/leggero per pitch/speed selezionabile in Impostazioni |
| **Logger** (`src/main/services/Logger.ts`) | Log diagnostico strutturato su disco con rotazione e mascheramento chiavi sensibili |

### Linee guida Contesto AI (per sviluppatori / agenti)

- **Rimozione Vocale live (`V`)** = solo DSP mid/side algoritmico; mai AI / dual-stem live.
- **Scarica strumentale** = AI offline (modelli in `userData/models`) o DSP; metodo indipendente dal live. Conferma sottotitoli YT (policy ask/always/never, modificabile in Impostazioni → Libreria); `--sub-langs .*-orig,default`.
- Commenti codice in **inglese**; UI/manuali IT/EN/ES/FR.
- Non rivivere PR UI restyle chiuse senza merge; non merge/release overwrite senza **Si** di Luca.
- Knobs MDX avanzati (`mdxSegmentSize` / `mdxOverlap` / `mdxEnableOrt`) solo se metodo = `aiMdxKaraoke2`; altrimenti non inviarli nel payload worker.
- Thread ORT WASM (`aiCpuThreads`): `null` = tutti i core; clamp a `[1, os.cpus().length]` — mai ≤0/NaN.
- GPU-First (`aiEnableGpu`, default on) + probe `system:get-gpu-status` → ORT `executionProviders` `webgpu`→`wasm` oppure solo `wasm`.
- HTDemucs avanzato: `demucsShifts` (0|1|2), `demucsSegmentSize` (5–20 s), `demucsOverlap` (0.10–0.50); MDX knobs invariati.
- **Modularizzazione (Safety-First):** transport/scorciatoie Regia in `useControlPlayback` / `useKeyboardShortcuts` + `PlayerDeckControls` / `QueueList`; tab Impostazioni in `src/renderer/components/settings/`. Lista libreria con virtualizzazione a finestra (`listVirtualization.ts`) per cataloghi 16k+. Preferire selettori Zustand granulari; GC solo `queue_cache` / temp — mai `libraryPath`.
- **Hot path 14k+:** dedup download via SQL `findLocalMediaDedupCandidates` (non `getAllTracks`); Guest Portal `searchTracks`/id; ZIP inflate async; analisi Key/BPM con yield FFT.

---

## 📚 Attribuzioni, Fonti & Licenze Librerie Terze

Karaoke Live Station è realizzato grazie a eccezionali librerie open source, standard aperti e progetti della comunità. Di seguito sono riportate le fonti ufficiali, gli autori, le licenze e il ruolo di ciascuna dipendenza utilizzata:

| Libreria / Risorsa | Autore / Organizzazione | Licenza | Fonte Ufficiale | Utilizzo nel Progetto |
| :--- | :--- | :--- | :--- | :--- |
| **yt-dlp** | yt-dlp team | The Unlicense | [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | Ricerca metadati YouTube, download flussi audio/video e aggiornamento automatico |
| **FFmpeg** | FFmpeg Developers & Eugene Ware (`ffmpeg-static`) | LGPL 2.1+ / GPL 3.0 | [ffmpeg.org](https://ffmpeg.org/) • [github.com/eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | Decodifica multimediale ed estrazione automatica miniature video a 16:9 |
| **SpessaSynth** | Spessa (`spessasus`) | MIT | [github.com/spessasus/SpessaSynth](https://github.com/spessasus/SpessaSynth) | Sintetizzatore SoundFont 2 (SF2) per riproduzione MIDI e KAR a bassissima latenza |
| **Signalsmith Stretch** | Geraint Luff (Signalsmith Audio) | MIT | [github.com/Signalsmith-Audio/signalsmith-stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch) | Algoritmo DSP pitch-shifting e time-stretching Hi-Fi ad altissima fedeltà su Wasm AudioWorklet (motore predefinito) |
| **SoundTouch / SoundTouchJS** | Olli Parviainen & Jakub Fiala | LGPL 2.1 / MIT | [gitlab.com/soundtouch/soundtouch](https://gitlab.com/soundtouch/soundtouch) • [github.com/jakubfiala/soundtouchjs](https://github.com/jakubfiala/soundtouchjs) | Algoritmo WSOLA professionale per variazione tonalità (pitch-shifting) e tempo-stretching (motore legacy selezionabile) |
| **ONNX Runtime Web** | Microsoft | MIT | [github.com/microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | Runtime di inferenza per modelli neurali ONNX con accelerazione nativa GPU (WebGPU JSEP) e fallback CPU WASM |
| **demucs-web** | demucs-web authors | MIT | [npmjs.com/package/demucs-web](https://www.npmjs.com/package/demucs-web) | Libreria per esecuzione ONNX di modelli HTDemucs v4 per separazione strumentale |
| **GeneralUser GS SoundFont** | S. Christian Collins | Permissive GeneralUser License | [schristiancollins.com](http://www.schristiancollins.com/generaluser.php) | Banco sonoro General MIDI da 31 MB integrato per resa acustica realistica |
| **better-sqlite3** | Joshua Wise | MIT | [github.com/WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Database locale sincrono ad altissime prestazioni in modalità WAL (catalogo e SIAE) |
| **Electron** | OpenJS Foundation & Electron Contributors | MIT | [electronjs.org](https://www.electronjs.org/) | Framework desktop nativo multi-finestra (Regia e Schermo Palco) |
| **React** | Meta Platforms, Inc. | MIT | [react.dev](https://react.dev/) | Libreria UI dichiarativa e reattiva per i display operatore e palco |
| **Tailwind CSS** | Tailwind Labs, Inc. | MIT | [tailwindcss.com](https://tailwindcss.com/) | Framework di styling CSS ad alte prestazioni per le 9 palette grafiche |
| **Express** | OpenJS Foundation | MIT | [expressjs.com](https://expressjs.com/) | Server HTTP leggero integrato per il Guest Portal LAN |
| **Socket.IO** | Automattic & Socket.IO Contributors | MIT | [socket.io](https://socket.io/) | Comunicazione bidirezionale in tempo reale tra smartphone del pubblico e console |
| **Lucide Icons** | Lucide Contributors | ISC | [lucide.dev](https://lucide.dev/) | Iconografia vettoriale moderna ed uniforme dell'interfaccia |
| **Zustand** | Paul Henschel & Zustand contributors | MIT | [github.com/pmndrs/zustand](https://github.com/pmndrs/zustand) | Gestione centralizzata e reattiva dello stato globale dell'applicazione |
| **i18next & react-i18next** | i18next Community | MIT | [i18next.com](https://www.i18next.com/) | Internazionalizzazione completa (Italiano, Inglese, Spagnolo, Francese) |

---

## 📄 Licenza

**Karaoke Live Station** è rilasciato sotto la [GNU Affero General Public License v3 (AGPLv3)](https://www.gnu.org/licenses/agpl-3.0.html) o versione successiva (`AGPL-3.0-or-later`).

Il testo completo della licenza è disponibile nel file [`LICENSE`](./LICENSE) alla radice del repository. Le librerie e dipendenze di terze parti restano proprietà intellettuale dei rispettivi autori sotto le rispettive licenze open source indicate sopra.

---

<br/>
<hr/>
<br/>

<a name="english"></a>

# 🇬🇧 English

**Karaoke Live Station** is a professional, mission-critical, cross-platform desktop application designed for karaoke DJs, event entertainers, live music venues, and private party hosts.

Built upon an **independent dual-window architecture (Control Desk + Stage Screen)**, it features studio-grade **Offline AI Vocal Separation** (UVR-MDX-NET Karaoke 2 / HTDemucs) with native GPU hardware acceleration (**WebGPU / Vulkan**) and multithreaded CPU fallback, a real-time Hi-Fi Web Audio DSP pitch & tempo processor (**Signalsmith Stretch**), native General MIDI / KAR synthesis with the bundled 31 MB GeneralUser GS SoundFont bank, 30 fps CD+G subcode graphics decoding, an intelligent Fair Queue algorithm with singer pitch memory, and an embedded **LAN Guest Portal** with dynamic QR code requests for smartphones.

> 💡 **Development Note**: This software was conceived, architected, and developed with **Google Antigravity**, the advanced autonomous agentic coding assistant by Google DeepMind, and with **Cursor**.

---

## 🌟 Key Features

### 🧠 Offline AI Vocal Separation & Instrumental Isolation (WebGPU Acceleration + Multithreaded CPU)
- **Studio-Grade Offline AI Instrumental Extraction (100% Local & Private)**: Converts any song or video into a clean, professional karaoke backing track with cutting-edge deep learning models running entirely on-device:
  - **UVR-MDX-NET Karaoke 2 (Default)**: State-of-the-art neural model tailored to isolate and strip lead vocals while flawlessly preserving backing vocals, harmonies, basslines, and rhythmic punch (native UVR STFT/iSTFT geometry).
  - **HTDemucs (Demucs v4 4-stem)**: Hybrid time/frequency domain architecture with advanced shift iterations (0–2), segment sizing (5–20s), and overlap controls (10–50%).
- **Native GPU Hardware Acceleration (WebGPU / Vulkan / Dawn)**: Leverages dedicated graphics hardware (NVIDIA GeForce, AMD Radeon, Intel Iris/Arc) via Chromium & Electron's native WebGPU stack using **ONNX Runtime Web (JSEP)**:
  - **Blazing Performance**: Ultra-fast inference (~1.7 seconds per chunk on dedicated NVIDIA GPUs vs 4–6+ seconds on heavy CPU loads). A full 4-minute track is separated and remuxed in just seconds.
  - **Zero External Dependencies**: No need to install Python, PyTorch, CUDA Toolkit, or complex system drivers. The neural inference engine is completely bundled and self-contained within the desktop binary.
- **Dual Processing Workflow (Instant Live DSP vs Deep Offline AI)**:
  - **Live During the Show (`V` Key - Basic Algorithm)**: Instantaneous zero-latency mid/side DSP cancellation (`centerCancelBassKeep`, `centerCancel`, `softMid`) to attenuate vocals on the fly without any buffering or delay.
  - **Download & Library Archiving (Deep Neural AI)**: High-resolution chunked neural separation performed automatically upon downloading, remuxing directly into an MP4/WebM instrumental video with synchronized subtitles.
- **Fail-Safe Watchdog & Seamless CPU Fallback**: If a supported GPU is absent, busy, or disabled in Settings, the intelligent watchdog automatically re-routes inference to multithreaded SIMD WASM CPU workers, with dynamic or manual CPU core allocation (`aiCpuThreads`).
- **Offline Model Management (`<app_userData>/models/`)**: Compact ONNX weights (~50 MB for MDX) are downloaded once with SHA-256 integrity verification and cached permanently in the local user data folder. No audio data ever leaves your computer or streams to external clouds.

### 🎛️ Dual-Window Live Architecture
- **Control Desk (Regia)**: Complete operator console with timeline scrubbing, audio visualizer, 16-channel MIDI mixer, queue management, catalog search, and headphone pre-listening (CUE).
- **Stage Screen (Palco)**: Clean external display for singers and audience (TV/Projector output with `F11` / double-click borderless fullscreen). Renders MP4/WebM videos, CD+G graphics, or synchronized lyrics with animated "Now Singing" and "Get Ready" notification banners.
- **HTTP 206 Partial Content Streaming**: Custom `karaoke://local/` protocol with byte-range streaming. The stage screen can be closed and reopened mid-song without pausing or desynchronizing audio.
- **Single Instance Lock Protection**: Native single-instance enforcement prevents duplicate windows; any concurrent launch immediately refocuses and restores the existing control console.
- **Launch Control / Stage (v1.3.0)**: Option to maximize Regia on launch (`maximize()`, not exclusive fullscreen) and to open or skip Stage. If Stage is off at launch, reopen with **P** / **F2** or the Stage button. Wider Settings (sidebar) move Download Instrumental method, MDX advanced, and **AI CPU cores** under Library & Download (default: all detected cores).
- **Pitch/speed DSP (v1.4.0)**: Default **Signalsmith Stretch Hi-Fi** engine (Wasm AudioWorklet, MIT); **SoundTouch WSOLA** selectable. **Download Instrumental** subtitle confirm modal (`ask`/`always`/`never`, editable in Settings → Library); yt-dlp `--sub-langs .*-orig,default`.
- **Hot paths / logging (v1.5.0)**: Targeted SQL download dedup (no `getAllTracks` dump); Guest FTS/id; async ZIP inflate + FFT yield; pruned `clsx`/`tailwind-merge`/`autoprefixer`/`postcss`; structured Logger with secret masking.

### 🎨 9 Color Themes & Edge-to-Edge Stage Screen
- **9 Distinct Visual Themes**: Independent theme customization for both Control Console and Stage Screen (*Dark Stage, Midnight Neon, Club Gold, Ocean Breeze, Sunset Crimson, Emerald Matrix, Royal Amethyst, High Contrast, Light Studio*).
- **100% Edge-to-Edge Video Utilization**: Maximizes available display area on the Stage Screen with zero wasted padding or borders, supporting 16:9, 4:3, and ultrawide video ratios without aspect ratio distortion.
- **Temporary Floating Song Title Banner**: Track title and artist float at the bottom center of the video for a user-configurable duration (2–30 seconds, 8s default) before smoothly fading out, ensuring singer lyrics remain completely unobstructed.
- **Low-Profile Flush Progress Bar**: Ultra-thin progress indicator along the screen's bottom edge with subtle illumination that never hides subtitles.
- **Customizable Stage messages (text, style, background)**: Under Settings → Stage Screen you can edit text, bold/italic, size, enable/disable, and a **per-message Stage background (solid color or image)** (e.g. “Up next”). The custom backdrop applies only while that message is visible; when it hides, the normal theme/video Stage look is restored.
- **Configurable Stage Monitor Pitch Badge**: Option in Settings to show or hide the semitone transposition badge (+/-) on the singer stage monitor (`showPitchOnStage`).
- **Configurable Stage Monitor Speed Badge**: Option to show or hide the playback speed badge (e.g. 1.00x, 1.25x) on the stage monitor (`showSpeedOnStage`).

### 📁 Configurable Library Path & Video Version Previews
- **Guided First-Launch Setup**: On first launch, an interactive dialog invites the user to choose between using the default "Karaoke" folder in their home directory (`~/Karaoke` or `C:\Users\<Username>\Karaoke`) or selecting an existing custom folder.
- **Automatic Refresh on Startup & Instant View Updates**: On every application startup, a catalog scan indexes newly added tracks (batched SQLite upserts; FFmpeg thumbnails fill in asynchronously so the Control window stays responsive). In addition, downloads and saves automatically trigger an instant Library view reload.
- **1-Click Manual Refresh**: The **"Refresh Library"** button scans and indexes the configured directory directly with a single click, without opening file picker dialogs.
- **OS filesystem Drag & Drop**: Drop karaoke files (`.mp4` / `.webm` / `.mkv` / `.avi`, `.mp3`+`.cdg`, **native `.zip` CD+G** (MP3/WAV+CDG), `.mid` / `.kar`) onto the Local Library to catalog them, or onto the Control queue to import and enqueue. Overlay only for OS `Files` drops — does not fight in-app queue reorder. Video thumbnails are generated with yields between files on multi-drop.
- **Native ZIP CD+G**: Archives with an audio+`.cdg` pair are catalogued as local tracks with lyrics; on-demand extract into temp cache, cleanup on dequeue/quit.
- **Key / BPM in Control**: Async key and BPM detection; Pitch/Speed pills show live `base→result` beside existing ± controls (not replacing them).
- **Auto-Archiving & Persistent Queue Cache**: Automatic web track archiving is enabled by default (`true`). When turned off (protected by a safety confirmation modal), downloaded tracks reside in `<userData>/queue_cache/`, persisting across restarts while queued, and cleaned up via intelligent GC strictly upon dequeue. With archiving ON, **Add to queue** from YouTube waits for download+archive, refreshes Local, and enqueues the **local library file** (no non-playable remote/temp pointers).
- **Official app icon**: Windows/Linux/macOS packaging and favicons use `public/logo.png` (`build/icon.png`, `build/icon.ico`, `build/icons/`).
- **Contextual 1-Click "Save to Library"**: Dedicated 1-click button visible in both queue rows and the player bar to promote any cached track to permanent storage.
- **Scoped Local / Web Search**: Library and Web/YouTube modes keep independent query, results, loading, and scroll state so tab switches never leak or fire unwanted searches. Local search (and other in-app filters) is **case- and accent-insensitive** (e.g. `moriro da re` matches `morirò da re`); accented queries still work.
- **Delete from Library**: Confirmed removal from the SQLite catalog; disk files are deleted only when they are permanent files under the library folder (`libraryPath`), not queue-cache entries.
- **Missing local files (USB / moved)**: Before enqueue or play, the app probes the local path via IPC `library:check-file-exists`. If the file is gone (USB unplugged, moved/deleted outside the app), it blocks the action, marks the row red, and opens a **Delete** / **Keep in list** modal — never auto-deletes from catalog or queue. Remote/YouTube without `localFilePath` skips the check.
- **16:9 Video Previews & Version Detection**: Every song in the library and search results features an actual 16:9 video thumbnail (auto-extracted via `ffmpeg` at 4 seconds for local files, and fetched from YouTube for online results) along with version badges (e.g. *KaraFun*, *Karaoke Academy Italia*, *Sing King*, *With Backing Vocals*, *Instrumental*).
- **Themed Preview / Pre-Listen Modal**: Thumbnail, Preview (`Eye`), or **Pre-Listen** opens a Settings-styled modal with audio on the CUE device; mute/volume via the embedded player (no separate volume bar) and a same-device unmute warning when CUE equals Master (local video/audio/MIDI **and** Web-search YouTube embed).
- **YouTube → queue (auto-archive ON)**: waits for download + archive, **reindexes Local with thumbnail**, then enqueues the local file (no manual “Refresh Library”).

### 🎹 MIDI & KAR Synthesis with SpessaSynth
- **Bundled GeneralUser GS SoundFont (31 MB)**: Rich, hardware-grade acoustic samples configured as the default out-of-the-box across Linux, Windows, and macOS.
- **Zero-Latency Smooth Playback**: 5ms Web Worker clock with strict MIDI priority ranking for simultaneous events (`ProgramChange` ➔ `ControlChange` ➔ `PitchBend` ➔ `NoteOff` ➔ `NoteOn`).
- **Stutter-Free Audio**: Protected by change guards and `latencyHint: 'playback'` buffer sizing, preventing audio stuttering and PipeWire/ALSA buffer underruns.
- **Live 16-Channel Mixer**: Real-time muting/unmuting of individual tracks (e.g. vocal guide melody on Channel 4).
- **Live Pitch Shifting**: Transpose songs from -8 to +8 semitones by shifting MIDI note numbers in real time without audio distortion.

### 🎵 Audio DSP Engine & Headphone Monitoring (CUE)
- **Signalsmith Stretch Hi-Fi (default) + SoundTouch (selectable) Studio Pitch/Speed**: Default media DSP is **Signalsmith Stretch** (Wasm AudioWorklet, MIT license — pristine audio quality with minimal artifacting). Recommended UI ±8 ST (up to ±12). **SoundTouch WSOLA** remains a Settings option (legacy/light, hard ±4 ST). Bit-perfect bypass when pitch is 0 and speed is 1.00x (zero latency and zero CPU load). MIDI/KAR unchanged (SpessaSynth).
- **Extended Independent Tempo Scaling (0.50x–1.50x)**: Continuous playback speed adjustment without modifying audio pitch. Clicking the speed indicator immediately resets playback rate to 1.00x.
- **Realtime Lead Vocal Attenuation (Basic Algorithm) — `V` key**: Live Control toggle applies instant **mid/side DSP** cancellation (`centerCancelBassKeep`, `centerCancel`, `softMid`) selected via a dedicated Settings dropdown, ideal for attenuating vocal leads during live performances without delay. (For deep offline studio-grade instrumental extraction, see the **Offline AI Vocal Separation** section).
- **Dynamic Audio Volume Normalization (Auto-Leveling)**: DSP dynamics processor powered by `DynamicsCompressorNode` (-22 dB threshold, 6:1 ratio, 24 dB knee, 3 ms attack, 250 ms release) combined with 1.35x makeup leveling gain. Equalizes acoustic dynamics across diverse songs in real time, taming aggressive volume spikes and lifting quiet backing tracks for a seamless, professional listening experience without riding the master fader. Configurable and toggleable in Audio Settings.
- **CUE Pre-listening**: Route preview audio to a secondary output (`setSinkId`); from the Library, Pre-Listen opens the themed preview modal on the CUE device (mute via player; same-device unmute warning).
- **Intelligent Auto-Ducking**: Automatically and smoothly attenuates background music when speaking into the microphone.

### ⌨️ Quick Keyboard Shortcuts & Interactive Guide (Control Console)
Press **`F1`** or **`?`** at any time to open the searchable interactive guide (same full inventory also under **Settings → Shortcuts**).
- **`Space`**: Instant Play / Pause toggle.
- **`S`**: Stop playback and rewind timecode to 0:00.
- **`R`**: Restart current song from beginning (0:00).
- **`N`**: Skip to next track in queue (with copyright / SIAE logging).
- **`M`**: Toggle Master Mute On/Off.
- **`V`**: Toggle DSP Lead Vocal Remover (**Basic Algorithm**).
- **`D`**: Toggle Microphone Auto-Ducking.
- **`+` / `-`** or **`CTRL + Arrow Up / Down`**: Pitch shift / key adjustment (±1 semitone; dynamic UI range: Signalsmith ±8, SoundTouch ±4).
- **`CTRL + Arrow Left / Right`**: Playback tempo adjustment (±5%, from 0.50x to 1.50x).
- **`Arrow Left / Right`**: Jump playback 5 seconds backward / forward.
- **`Arrow Up / Down`**: Master volume fine adjustment (±5%) with perceptual quadratic power curve ($Gain = volume^2$) and 50ms anti-click ramping.
- **`1` / `2` / `3`**: Quick tab switching (1: Singer Queue, 2: Library & Search, 3: SIAE History).
- **`CTRL + F`**: Switch to Library tab and focus the search input.
- **`P` / `F2`**: Reopen / Focus Stage Window.
- **`F11` / `Esc`**: Fullscreen toggle (when focused on Stage Window).
- **`Esc`**: Dismiss active modal or clear focus.
- 📖 For the complete operating guide, see the [Dedicated User Manual (USER_MANUAL.md)](USER_MANUAL.md).

### ⚖️ Fair Queue Algorithm, Drag & Drop, Restore & Singer Pitch Memory
- **Anti-Monopoly Fair Rotation (Enabled by Default)**: Enabled by default (`enableFairQueue: true`), it dynamically balances song requests based on rotation fairness (number of songs already performed) and request timestamp, with VIP manual override.
- **Queue Drag & Drop**: Intuitively reorder waiting queue items with mouse drag-and-drop using visual grip handles. The currently active track at index 0 remains locked to prevent playback interruptions.
- **"Restore Fair Queue" Button**: One-click button in the queue header to instantly re-sort waiting tracks back into optimal Fair Queue order whenever manual reordering or additions took place.
- **Flexible Queue Placement (Fair Queue vs End of Queue)**: When adding a song from the Library or Video Preview with Fair Queue active, choose between automatic fair scheduling (*Fair Queue*) or direct append (*End of Queue*).
- **Duplicate Singer Prevention**: Robust case-insensitive check in SQLite database and UI to prevent duplicate singer records and keep rotation statistics perfectly accurate.
- **Direct Play/Pause on Top Queue Track**: The play button on the first track in the queue directly starts or pauses playback with live state synchronization.
- **Singer Pitch Memory**: Remembers individual pitch preferences and automatically sets them when a singer's song starts.
- **Queue Persistence & Crash Protection**: The entire queue lineup (tracks, singer names, custom keys, and positions) is persistently stored in local storage. In the event of an accidental shutdown or crash, the queue is faithfully restored upon restarting, with the top track cued and paused at 0:00.
- **Safe "Clear Queue" Action**: Dedicated trash button with an interactive confirmation dialog in the queue header, allowing the host to cleanly wipe the entire waiting lineup and reset playback in one safe action.
- **Stage Screen "Upcoming Performance" Banner**: Clean, synchronized notification displayed on the Stage Screen announcing the next song and performer.

### 📱 Embedded LAN Smartphone Guest Portal
- **Zero-Config LAN Web Server**: Built-in Express and Socket.IO server running on the local Wi-Fi network.
- **Dynamic QR Code**: Guests scan the on-screen QR code with their mobile phone to view the live queue and send requests.
- **Library-Only Song Selection**: Dynamic live search with instant filtering over the indexed local catalog. Replaces manual free-text inputs: only songs actually existing in the library can be selected and requested, including singer name and key transposition (-4 to +4 semitones).
- **1-Click DJ Approval**: Host reviews requests in the queue and approves them with a single click, immediately queueing the real media track with the requested pitch offset.

### 🛡️ Cross-Platform Firewall & LAN Connection Assistant
- **Automated Real-Time Diagnosis**: Automatically identifies the host operating system and safely probes the local firewall state:
  - **Windows**: Inspects *Windows Defender Firewall* inbound rules via `netsh advfirewall`.
  - **macOS**: Queries the *macOS Application Firewall (ALF)* status via `socketfilterfw`.
  - **Linux**: Probes *UFW* state (`/etc/ufw/ufw.conf`) and provides commands for *UFW* and *Firewalld*.
- **1-Click Copyable Unblock Commands**: If guest phones cannot reach the mobile portal (TCP ports 3000–3010), the assistant supplies ready-to-run PowerShell / CMD or Terminal commands, complete with dedicated copy buttons and horizontal scrolling that prevents mid-command truncation or word wrapping.
- **Step-by-Step Graphical (GUI) Guides**: Straightforward step-by-step instructions for allowing incoming traffic via Windows Defender Control Panel or macOS System Settings without opening a terminal.
- **Wi-Fi AP Isolation Guidance**: Alerts the operator to disable "AP Client Isolation" on Wi-Fi routers, ensuring guests' mobile devices can communicate with the host PC.

### 🌐 Full Native Multilingual Support (i18n)
- **4 Complete Translations (100% Coverage)**:
  - 🇮🇹 **Italiano** (Native Italian interface, SIAE reporting, and localized guides)
  - 🇬🇧 **English** (Full international English localization across all modules)
  - 🇪🇸 **Español** (Complete Spanish localization for operator and guests)
  - 🇫🇷 **Français** (Comprehensive French localization for control and stage)
- **Automatic System Locale Detection**: Auto-detects the operating system's native language on first launch with graceful fallbacks.
- **Instant Live Language Switcher**: Switch languages on the fly at any time via Settings (`Settings` ➔ `Language`), with persistent preferences retained across app restarts without requiring a reload.

### 📜 Playback History Tab & Royalty Reporting (SIAE)
- **Dedicated 3-Tab Console Layout**: Smooth segmented switching between *Queue*, *Library*, and *History*.
- **Intelligent Playback Logging Rules**: A track is logged to performance history and the SIAE copyright database if it finishes at its **natural end** or is stopped/skipped after being actively played for **at least 2 minutes (120 seconds)**. Premature skips under 120 seconds are ignored to keep logs clean.
- **Duplicate Prevention Guard (`alreadyLogged`)**: Prevents duplicate log rows if a track is stopped after 120 seconds and subsequently resumed, completed, or skipped.
- **Persistent Execution Memory & ISO 8601 Timestamps**: Records full track details in SQLite (`siae_logs`) with standardized ISO 8601 UTC timestamps, epoch milliseconds, and local date for compliance auditing.
- **Real-Time History Filter**: Instant search across executed tracks by title, artist, or performer name (accent-insensitive; accents in the query still match).
- **1-Click Royalty CSV Export**: Native dialog to export standardized CSV reports including ISO 8601 and epoch timestamps compatible with copyright organizations (such as SIAE Borderò).
- **Safe Clear History Workflow**: "Clear History" button with a confirmation modal to safely reset logs at the end of a gig or event.
- **Persistent Diagnostic Logger**: Disk-backed diagnostic logs with configurable levels (Debug, Info, Warn, Error, Off).

### ⚡ yt-dlp Engine & Zero-Dependency Standalone Executables
- **Zero-Configuration Standalone Packaging**: In packaged executable releases (Windows `.exe`, Linux `.AppImage`/`.deb`, macOS `.dmg`), Karaoke Live Station is completely self-contained. It requires no manual pre-installation of `yt-dlp`, `ffmpeg`, or system PATH adjustments.
- **Automatic Verification & Background Updates on Startup**: Upon launching, `YtDlpUpdater` checks for local executable availability and queries GitHub Releases API for the latest official build. If missing or outdated, it streams the compatible binary, verifies its checksum and integrity, and applies it in the background without freezing the UI or playback.
- **Strict Relative Path Resolution & Safe Permissions**: Employs `BinaryResolver` to resolve runtime dependencies across relative locations. Updated binaries are saved to the user data directory (`userData/bin/`) and granted executable permissions (`chmod 0755` on POSIX), bypassing read-only application folders such as `Program Files` or `/opt`.
- **Manual Control in Settings**: Live diagnostic card in Settings displaying the binary path, current version, operational status, and a manual "Check / Update" button.

---

## 📋 Prerequisites

- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **npm**: `v10.x` or higher
- **Supported Operating Systems**:
  - **Linux**: Ubuntu 20.04+, Debian 11+, Fedora 36+, Arch Linux, or compatible.
  - **Windows**: Windows 10 or Windows 11 (64-bit).
  - **macOS**: macOS 11 Big Sur, 12 Monterey, 13 Ventura, 14 Sonoma, or newer.

---

## 🚀 Installation & Quick Start

```bash
# 1. Clone the repository or navigate to the project directory
cd KaraokeStation

# 2. Install dependencies
npm install

# 3. Run TypeScript typecheck
npm run typecheck

# 4. Build Vite frontend and Electron main bundles
npm run build

# 5. Launch the desktop application
npm start
```

For development with hot-reload enabled:
```bash
npm run electron:dev
```

---

## 📦 Building Executable Releases

The application includes an automated packaging pipeline based on `electron-builder` producing clean, self-contained standalone distributions without external dependencies.

### 🧹 Automated Test Data & Database Cleanup
Prior to generating any release package (`npm run electron:build:*`), the build script automatically invokes `scripts/clean-test-data.js`:
- **Test Database**: Completely purges the local SQLite file `karaoke_station.db` and associated WAL/SHM files, clearing songs added during tests, singer profiles, queues, and performance logs.
- **User Data & Session Storage**: Erases configuration state (`Preferences`, `Local Storage`, `Session Storage`).
- **Temporary Files & Thumbnails**: Deletes cached video thumbnails (`thumbnails/*.jpg`), temporary downloads (`temp/`), and rotating diagnostic logs (`logs/*.log`).
This ensures every release is 100% pristine and clean for the end-user.

### 🐧 Build for Linux (AppImage & deb)
```bash
npm run electron:build:linux
```
Output packages `.AppImage` (238 MB) and `.deb` (209 MB) will be placed in `release/`, containing exclusively Linux binaries (`yt-dlp`, `ffmpeg`, `better-sqlite3` ELF 64-bit).

### 🪟 Build for Windows (Portable .exe & Standalone ZIP)
```bash
npm run electron:build:win
```
The standalone portable executable `Karaoke Live Station 1.5.0.exe` (runs immediately without installation or admin privileges) and `Karaoke Live Station-1.5.0-win.zip` will be generated in `release/`, with exclusive Win32 PE binaries (`yt-dlp.exe`, `ffmpeg.exe`, `better_sqlite3.node`).

### 🍎 Build for macOS (.zip)
```bash
npm run electron:build:mac
```
The standalone `Karaoke Live Station-1.5.0-mac.zip` archive containing `Karaoke Live Station.app` will be generated in `release/`, with exclusive Darwin Mach-O binaries (`yt-dlp`, `ffmpeg`, `better_sqlite3.node`).

### 🌐 Build for all target platforms
```bash
npm run electron:build:all
```

> 📌 **First Launch & Default Paths**:
> - **Library Folder Selection**: On first launch, an interactive modal dialog prompts the user to either use the default "Karaoke" folder in their home directory (`~/Karaoke` on Linux/macOS, `C:\Users\<Username>\Karaoke` on Windows) or browse and select an existing folder. If dismissed or cancelled, the application creates and defaults to the default `Karaoke` directory.
> - **Automatic Refresh on Startup**: Every time the program starts, if a library path is set, it automatically performs a background scan and refresh to detect and index new songs immediately.
> - **Default SoundFont**: The high-definition `GeneralUser-GS.sf2` (31 MB) soundbank is pre-bundled across all releases and active out-of-the-box.
> - **Zero Cross-Platform Pollution**: Each release package contains strictly the binaries and native compiled modules required for that operating system (no `.exe` files in Linux/Mac releases, no ELF binaries in Windows releases).

---

## 📂 Project Structure

```
KaraokeStation/
├── .github/
│   └── workflows/
│       └── build.yml               # Multi-platform CI/CD workflow
├── .gitattributes                  # LF line-ending normalization
├── .gitignore                      # Git ignore patterns
├── locales/                        # Internationalization strings (en, it, es, fr)
├── public/
│   └── soundfonts/
│       └── GeneralUser-GS.sf2      # High-definition 31 MB SoundFont bank
├── src/
│   ├── main/                       # Electron Main Process
│   │   ├── db/database.ts          # SQLite 3 WAL persistent storage
│   │   ├── server/guestServer.ts   # Express + Socket.IO LAN mobile server
│   │   ├── services/
│   │   │   ├── DownloadManager.ts  # yt-dlp child process wrapper
│   │   │   └── Logger.ts           # Rotating diagnostic logger
│   │   └── index.ts                # App lifecycle & HTTP 206 protocol handler
│   ├── preload/
│   │   └── index.ts                # Secure IPC ContextBridge
│   ├── renderer/                   # React Frontend (Control Desk & Stage)
│   │   ├── components/
│   │   │   ├── ControlWindow.tsx   # Regia Operator Console (Material Design 3)
│   │   │   ├── StageWindow.tsx     # Stage Screen for Singer & Audience
│   │   │   ├── LibraryPanel.tsx    # Media Catalog & 1-Click Refresh
│   │   │   ├── HistoryPanel.tsx    # Persistent Execution History & SIAE Export
│   │   │   ├── SettingsModal.tsx   # Hardware, Library & System Preferences
│   │   │   ├── MidiChannelMixer.tsx# 16-Channel Live MIDI Mixer
│   │   │   └── SingersModal.tsx    # Singer Management & History
│   │   ├── core/
│   │   │   ├── AudioGraphManager.ts# Web Audio Graph, DSP & SpessaSynth
│   │   │   ├── MidiParser.ts       # Sub-millisecond MIDI & KAR parser
│   │   │   ├── PitchShifterNode.ts # Phase-vocoder stereo pitch shifter
│   │   │   └── CdgParser.ts        # MP3+G CD+G subcode graphics decoder
│   │   ├── store/
│   │   │   └── karaokeStore.ts     # Zustand reactive global state
│   │   └── styles/
│   │       └── index.css           # Tailwind CSS v4 styling
│   └── shared/
│       └── types.ts                # Shared TypeScript models & contracts
├── package.json                    # Dependencies, scripts, and build settings
├── tsconfig.json                   # TypeScript configuration
└── vite.config.ts                  # Vite & electron plugins configuration
```

---

## ☕ Support the Project

If you find **Karaoke Live Station** valuable for your shows, venues, or private events and would like to support ongoing development, maintenance, and future enhancements, you can buy me a coffee or make a free donation via PayPal:

<p align="center">
  <a href="https://www.paypal.com/paypalme/LucaAbagnale" target="_blank">
    <img src="https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate with PayPal" />
  </a>
</p>

<p align="center">
  👉 <a href="https://www.paypal.com/paypalme/LucaAbagnale"><strong>paypal.me/LucaAbagnale</strong></a> 👈
</p>

> ❤️ *Every contribution, no matter the size, is deeply appreciated and helps keep this software open-source, free, and continuously maintained for everyone. Thank you so much!*

---

## ⚖️ Legal Disclaimer, Copyright & Trademarks

### 1. No Musical Content Bundled & Public Performance Licensing (SIAE, ASCAP, BMI, etc.)
- **Karaoke Live Station** is strictly a media playback management system, user interface, and Web Audio DSP engine.
- **The software DOES NOT contain, distribute, host, or stream any copyrighted musical recordings, backing tracks, or synchronized karaoke media** (MP3+G, MIDI, KAR, MP4, WebM, or audio stems).
- End users (karaoke DJs, performers, venue operators, and event hosts) are **solely and exclusively responsible** for obtaining all media files through lawful channels and procuring the necessary public performance, communication to the public, and mechanical reproduction licenses from competent collecting societies (e.g. **SIAE** and **SCF** in Italy, **ASCAP**, **BMI**, and **SESAC** in the US, **PRS for Music** and **PPL** in the UK, **GEMA** in Germany, **SACEM** in France, etc.).
- The *"SIAE Borderò Export (CSV)"* feature is provided merely as an administrative aid and log-keeping utility to assist users in completing music performance reports. Its use does not substitute, waive, or fulfill the requirement to hold valid performance licenses or pay statutory royalties.

### 2. Third-Party Web Services, YouTube & Runtime Auto-Download (yt-dlp)
- Web search and media playback features rely on the third-party open-source utility `yt-dlp`. This capability is provided exclusively for lawful personal backups, public domain materials, Creative Commons media, or private study in full compliance with third-party Terms of Service.
- **Automated Runtime yt-dlp Download & Secure Updates**: The application includes an automated download and update service (`YtDlpUpdater`) that retrieves official, precompiled binaries strictly from the verified GitHub repository (`https://github.com/yt-dlp/yt-dlp/releases`). Downloaded binaries are isolated in the local user data directory (`userData/bin/`), without altering global operating system configurations or system folders. Users retain full control to override or provide a custom binary via the `YTDLP_PATH` environment variable.
- **YouTube™** is a registered trademark of **Google LLC / Alphabet Inc.**
- **Karaoke Live Station** is an independent, non-affiliated open-source software project and is **NOT endorsed by, sponsored by, affiliated with, or associated with Google LLC, YouTube, or any third-party commercial karaoke content providers**.
- The developers explicitly disclaim any liability for copyright infringement, unauthorized scraping, or violation of third-party platforms' Terms of Service committed by end users.

### 3. Third-Party Trademarks & Nominative Fair Use
- All trademarks, service marks, brand names, product names, and company logos mentioned in this repository, software UI, or documentation (including, but not limited to: *YouTube*, *KaraFun*, *M-Live*, *SongService*, *Sing King*, *Sunfly*, *GeneralUser GS*, *SoundTouch*, *SpessaSynth*, *Apple*, *Microsoft Windows*, *Linux*) are the property of their respective trademark holders.
- Any reference to these marks (e.g., track version detection chips, audio driver interfaces, or SoundFont compatibility) is made strictly for descriptive, identification, and technical interoperability purposes (*nominative fair use*). Such mention does not constitute or imply sponsorship, endorsement, or commercial affiliation.

### 4. Disclaimer of Warranties & Limitation of Liability ("AS IS")
- This software is distributed on an "AS IS" basis, without warranties or conditions of any kind, either express or implied, including without limitation warranties of merchantability, fitness for a particular purpose, or non-infringement. In no event shall the authors or copyright holders be liable for any claims, penalties, direct or consequential damages arising from the use of this software or media played through it.

---

## 🧩 Dependencies Stack (AI / download-relevant runtime)

| Package | Role in Karaoke Live Station |
| :--- | :--- |
| **onnxruntime-web** | Neural engine with native GPU acceleration (WebGPU JSEP) and multithreaded CPU WASM fallback for AI vocal separation (UVR-MDX-NET / HTDemucs) |
| **demucs-web** | HTDemucs ONNX wrapper (lazy-loaded on HTDemucs path only) |
| **fft.js** | Bluestein STFT / iSTFT for MDX (`audioFft.ts`) |
| **ffmpeg-static** | Instrumental demux / remux and thumbnails (ASAR-unpacked) |
| **better-sqlite3** | Catalog + SIAE history (WAL; ASAR-unpacked) |
| **electron** | Main + hidden WebGPU BrowserWindow for native GPU acceleration + utilityProcess CPU worker |
| **zustand** | Persisted settings (including instrumental method, GPU-First toggle, and MDX/Demucs knobs) |
| **signalsmith-stretch** | Hi-Fi Pitch & Speed engine on Wasm AudioWorklet (default `dspEngine: 'signalsmith'`) |
| **soundtouchjs** | Legacy/light live pitch WSOLA (bypassed at pitch 0); selectable in Settings |
| **spessasynth_lib** | MIDI/KAR SoundFont synth (5 ms scheduler, `latencyHint: 'playback'`) |
| **qrcode** | Guest Portal LAN QR generation |
| **Logger** (`src/main/services/Logger.ts`) | Disk diagnostic log; Settings level `debug`/`info`/`warn`/`error`/`off`; sensitive-key masking |

### AI Context & Critical Invariants (for developers / agents)

**AI context**
- **Live Vocal Remover (`V`)** = algorithmic mid/side DSP only; never AI / live dual-stem.
- **Download Instrumental** = offline AI (models under `userData/models`) or DSP; method is independent from live. YT subtitle confirm (policy ask/always/never, editable in Settings → Library); `--sub-langs .*-orig,default`.
- Code comments in **English**; UI/manuals IT/EN/ES/FR.
- Do not revive closed no-merge UI restyle PRs; do not merge/release-overwrite until Luca says **Si**.
- MDX advanced knobs (`mdxSegmentSize` / `mdxOverlap` / `mdxEnableOrt`) only when method is `aiMdxKaraoke2`; otherwise omit them from the worker payload.
- ORT WASM threads (`aiCpuThreads`): `null` = all cores; clamp to `[1, os.cpus().length]` — never ≤0/NaN.
- GPU-First (`aiEnableGpu`, default on) + `system:get-gpu-status` probe → ORT `executionProviders` `webgpu`→`wasm` or WASM-only.
- HTDemucs advanced: `demucsShifts` (0|1|2), `demucsSegmentSize` (5–20 s), `demucsOverlap` (0.10–0.50); MDX knobs unchanged.
- Frozen contracts: IPC / `electronAPI` (`src/preload/index.ts`), `src/shared/types.ts`, Zustand `useKaraokeStore` shape, SQLite WAL schema. Dynamic/preload/Socket.IO/global-shortcut handlers → **Watchlist** (never delete as “dead”).
- **Modularization (Safety-First):** Control transport/shortcuts live in `useControlPlayback` / `useKeyboardShortcuts` + `PlayerDeckControls` / `QueueList`; Settings tabs under `src/renderer/components/settings/`. Library results use windowed virtualization (`listVirtualization.ts`) for 16k+ catalogs. Prefer granular Zustand selectors; GC still only `queue_cache` / temp — never `libraryPath`.
- **14k+ hot paths:** download dedup via SQL `findLocalMediaDedupCandidates` (not `getAllTracks`); Guest Portal `searchTracks`/id lookup; async ZIP inflate; Key/BPM analysis yields during FFT.

**Critical invariants (must not regress)**
| Invariant | Location | Rule |
| :--- | :--- | :--- |
| Pitch/speed DSP bypass | `SignalsmithPitchShifterNode` / `PitchShifterNode` | Signalsmith: pitch 0 → worklet bypass; SoundTouch: pitch 0 → ScriptProcessor off path |
| Volume gain = volume² | `AudioGraphManager.computePerceptualGain` | Clamp volume to [0,1]; mute → 0 |
| AI worker MessageEvent unwrap | `aiWorkerMessage.unwrapAiWorkerInboundMessage` | Prefer bare `type`; else `raw.data` |
| SIAE ≥ 120s | `karaokeStore.logCurrentTrackExecution` | Natural end **or** elapsed ≥ 120s |
| GC only `queue_cache/` | Store + `DownloadManager.deleteCachedFile` | Never delete under `libraryPath` |
| SpessaSynth 5 ms + playback | `AudioGraphManager` | `latencyHint: 'playback'`; scheduler interval **5 ms** |

Automated lock: `scripts/verify-critical-invariants.js` (also run via `npm test`).

---

## 📚 Third-Party Libraries, Citations & Licenses

Karaoke Live Station is powered by open-source libraries, open standards, and community contributions. Below are the official citations, maintainers, licenses, and architectural roles for each third-party component utilized:

| Library / Resource | Author / Organization | License | Official Source | Role in Karaoke Live Station |
| :--- | :--- | :--- | :--- | :--- |
| **yt-dlp** | yt-dlp team | The Unlicense | [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | YouTube metadata querying, stream downloading, and background auto-updating |
| **FFmpeg** | FFmpeg Developers & Eugene Ware (`ffmpeg-static`) | LGPL 2.1+ / GPL 3.0 | [ffmpeg.org](https://ffmpeg.org/) • [github.com/eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | Media stream demuxing and automated 16:9 video thumbnail generation |
| **SpessaSynth** | Spessa (`spessasus`) | MIT | [github.com/spessasus/SpessaSynth](https://github.com/spessasus/SpessaSynth) | SoundFont 2 (SF2) software synthesizer for ultra-low latency MIDI and KAR playback |
| **Signalsmith Stretch** | Geraint Luff (Signalsmith Audio) | MIT | [github.com/Signalsmith-Audio/signalsmith-stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch) | High-fidelity DSP pitch-shifting and time-stretching algorithm on Wasm AudioWorklet (default engine) — see `public/workers/SIGNALSMITH_NOTICE.md` |
| **SoundTouch / SoundTouchJS** | Olli Parviainen & Jakub Fiala | LGPL 2.1 / MIT | [gitlab.com/soundtouch/soundtouch](https://gitlab.com/soundtouch/soundtouch) • [github.com/jakubfiala/soundtouchjs](https://github.com/jakubfiala/soundtouchjs) | Studio-grade WSOLA algorithm for pitch shifting and tempo stretching (selectable legacy engine) |
| **GeneralUser GS SoundFont** | S. Christian Collins | Permissive GeneralUser License | [schristiancollins.com](http://www.schristiancollins.com/generaluser.php) | High-definition 31 MB General MIDI SoundFont bank bundled for realistic instruments |
| **better-sqlite3** | Joshua Wise | MIT | [github.com/WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | High-performance synchronous SQLite driver in WAL mode (media library & SIAE history) |
| **ONNX Runtime Web** | Microsoft | MIT | [github.com/microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | Neural model inference engine with native GPU hardware acceleration (WebGPU JSEP) and multithreaded CPU WASM fallback for AI vocal separation (UVR-MDX-NET / HTDemucs) |
| **demucs-web** | demucs-web authors | MIT | [npmjs.com/package/demucs-web](https://www.npmjs.com/package/demucs-web) | HTDemucs v4 ONNX execution library for high-isolation instrumental backing track generation |
| **fft.js** | Jens Nockert / contributors | MIT | [github.com/indutny/fft.js](https://github.com/indutny/fft.js) | Bluestein FFT for MDX STFT / iSTFT |
| **Electron** | OpenJS Foundation & Electron Contributors | MIT | [electronjs.org](https://www.electronjs.org/) | Multi-window native desktop runtime (Control Desk & Stage Display) |
| **React** / **react-dom** | Meta Platforms, Inc. | MIT | [react.dev](https://react.dev/) | Reactive, component-based UI layer for operator console and stage displays |
| **Tailwind CSS** | Tailwind Labs, Inc. | MIT | [tailwindcss.com](https://tailwindcss.com/) | High-performance CSS framework powering the 9 visual themes |
| **Express** | OpenJS Foundation | MIT | [expressjs.com](https://expressjs.com/) | Embedded lightweight HTTP server powering the local LAN Guest Portal |
| **Socket.IO** | Automattic & Socket.IO Contributors | MIT | [socket.io](https://socket.io/) | Real-time full-duplex WebSocket communication between guest mobiles and DJ desk |
| **qrcode** | Ryan Day / contributors | MIT | [github.com/soldair/node-qrcode](https://github.com/soldair/node-qrcode) | QR encoding for Guest Portal URL |
| **Lucide Icons** | Lucide Contributors | ISC | [lucide.dev](https://lucide.dev/) | Clean, consistent vector iconography throughout the application |
| **Zustand** | Paul Henschel & Zustand contributors | MIT | [github.com/pmndrs/zustand](https://github.com/pmndrs/zustand) | Centralized, reactive global application state management |
| **i18next & react-i18next** | i18next Community | MIT | [i18next.com](https://www.i18next.com/) | Comprehensive internationalization framework (English, Italian, Spanish, French) |

---

## 📄 License

**Karaoke Live Station** is released under the [GNU Affero General Public License v3 (AGPLv3)](https://www.gnu.org/licenses/agpl-3.0.html) or any later version (`AGPL-3.0-or-later`).

The full license text is available in the [`LICENSE`](./LICENSE) file at the repository root. All third-party libraries and dependencies remain the intellectual property of their respective authors under their original open-source licenses as cited above.

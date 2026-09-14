# Manuale Utente — Karaoke Live Station

**Karaoke Live Station** — stazione professionale multipiattaforma per DJ, KJ e locali di karaoke live.  
Architettura: Electron, React 18, Web Audio DSP, sintesi SoundFont/MIDI, Guest Portal LAN (Express), catalogo SQLite.

Questo documento è il manuale operativo completo (Fasi 1–5) in **italiano**. Destinato all’operatore in regia.

---

## Indice

1. [Panoramica e architettura](#1-panoramica-e-architettura)
2. [Installazione e percorsi portabili](#2-installazione-e-percorsi-portabili)
3. [Prima configurazione](#3-prima-configurazione)
4. [Console di Regia](#4-console-di-regia)
5. [Coda Fair Queue, VIP e cache](#5-coda-fair-queue-vip-e-cache)
6. [Libreria: ricerca, download e anteprime](#6-libreria-ricerca-download-e-anteprime)
7. [Schermo Stage (Palco)](#7-schermo-stage-palco)
8. [Avanzamento automatico e pausa di transizione](#8-avanzamento-automatico-e-pausa-di-transizione)
9. [Impostazioni a tab e ricerca](#9-impostazioni-a-tab-e-ricerca)
10. [Scorciatoie da tastiera](#10-scorciatoie-da-tastiera)
11. [Guest Portal LAN](#11-guest-portal-lan)
12. [Registro SIAE](#12-registro-siae)
13. [Temi e lingue (i18n)](#13-temi-e-lingue-i18n)
14. [Risoluzione dei problemi](#14-risoluzione-dei-problemi)

---

## 1. Panoramica e architettura

Karaoke Live Station gestisce una serata karaoke su **due finestre indipendenti** più un portale ospiti in rete locale.

### 1.1 Finestra di Regia (Control — Master)

Console operatore completa:

- Transport (Play / Pausa / Stop / Ricomincia / Prossimo)
- Volume master con curva percettiva
- Pitch in semitoni e velocità (time-stretch)
- Rimozione voce guida **(Sperimentale)** via DSP classico mid/side (algoritmico, tempo reale)
- Auto-ducking BGM al microfono
- Mixer MIDI/KAR a 16 canali
- Pre-ascolto CUE su dispositivo secondario
- Coda cantanti (Fair Queue), Libreria & ricerca, Storico SIAE
- Gestione richieste Guest Portal

### 1.2 Finestra Stage / Schermo Palco (Slave)

Schermo per cantante e pubblico (TV o proiettore):

- Video MP4/WebM/MKV, grafica CD+G, testi MIDI/KAR
- Audio della Stage **mutato** (l’audio esce solo dalla Regia / Master)
- Sincronizzazione via IPC con la Regia
- Banner «Ora Canta», «Preparati», «Prossima Esibizione»
- Badge semitoni configurabile (`showPitchOnStage`)
- Badge velocità configurabile (`showSpeedOnStage`)
- Fullscreen (F11 / Esc / doppio clic)

### 1.3 Guest Portal LAN

Server web integrato (Express + Socket.IO) sulla rete Wi‑Fi del locale. Gli ospiti inquadrano un QR Code e inviano richieste dal telefono senza installare app.

### 1.4 Istanza singola (Single Instance Lock)

L’applicazione consente **una sola istanza** in esecuzione. Un secondo avvio viene bloccato: il processo nuovo termina e la finestra di Regia già aperta viene ripristinata e messa a fuoco. Evita doppie Regie, conflitti audio e porte Guest Portal duplicate.

### 1.5 Flusso audio / video in sintesi

1. La Regia possiede il transport e il grafo Web Audio.
2. I media locali passano dal protocollo `karaoke://local/` con streaming a byte-range (HTTP 206), così lo Stage può aprirsi/chiudersi a brano in corso senza desincronizzare.
3. Pitch, velocità, rimozione voce DSP (sperimentale), ducking, normalizzazione e routing CUE vivono nel grafo audio della Regia.
4. MIDI/KAR: parsing → SpessaSynth + SoundFont → mixer a 16 canali.
5. Avanzamento coda e registro SIAE sono gestiti nello store; lo Stage riceve lo stato via IPC.

---

## 2. Installazione e percorsi portabili

### 2.1 Sistemi supportati

- **Linux** (Ubuntu/Debian, Fedora, Arch e simili)
- **Windows** 10/11 a 64 bit
- **macOS** 11+ (Apple Silicon e Intel)

Consigliati: desktop esteso a **due monitor** (Regia + Palco) e, se possibile, interfaccia audio USB multi-uscita per separare Master e cuffie CUE.

### 2.2 Cartella dati applicazione (`userData`)

Tutti i dati gestiti dall’app vivono sotto la cartella Electron `userData` (non in `/tmp`):

| Piattaforma | Percorso tipico |
| :--- | :--- |
| Linux | `~/.config/karaoke-live-station/` (o nome app equivalente XDG) |
| macOS | `~/Library/Application Support/<App>/` |
| Windows | `%APPDATA%\<App>\` |

Contenuti rilevanti:

| Percorso relativo | Contenuto |
| :--- | :--- |
| `karaoke_station.db` | Database SQLite (catalogo, cantanti, log SIAE) in modalità WAL |
| `bin/` | Binari gestiti, in particolare **yt-dlp** |
| `temp/` | Download in corso |
| `queue_cache/` | File web non archiviati in libreria, persistenti finché in coda |
| `thumbnails/` | Miniature generate |
| `logs/` | Log diagnostici |

### 2.3 Binari gestiti in `<userData>/bin/`

**yt-dlp** (e altri binari gestiti) vengono installati e aggiornati in:

```text
<userData>/bin/yt-dlp      (Linux / macOS)
<userData>/bin/yt-dlp.exe  (Windows)
```

Comportamento operativo:

1. All’avvio l’app preferisce sempre la copia in `userData/bin/`.
2. Se manca o è corrotta, può **seminare** (seed) dal pacchetto installato verso `userData/bin/`.
3. Verifica di integrità (dimensione minima, eseguibilità, probe `--version`).
4. Aggiornamenti da GitHub Releases solo se manca o esiste una versione più recente (non riscarica a ogni avvio).
5. Installazione atomica in `userData/bin/` (file temporaneo sibling, poi sostituzione); su Windows gestione sicura dei file bloccati.

**ffmpeg** viene risolto da pacchetto/bundle/PATH per miniature e conversioni; yt-dlp resta il motore di ricerca/download web.

Nelle **Impostazioni → Libreria & Download** puoi vedere stato/versione di yt-dlp e usare **Verifica / Aggiorna**.

### 2.4 Libreria media dell’utente

La cartella media **non** è `userData/library` di fallback silenzioso: è il percorso **obbligatorio** `libraryPath` scelto dall’operatore (spesso `~/Karaoke` o `C:\Users\<Utente>\Karaoke`). Tutti i salvataggi e l’archiviazione automatica usano esclusivamente quel percorso.

---

## 3. Prima configurazione

All’avvio, se `libraryPath` manca o non esiste sul disco, compare la procedura guidata (dialoghi **non modali** rispetto al parent Chromium, per non sospendere l’audio).

### 3.1 Cartella Libreria Karaoke (obbligatoria)

1. Apri **Impostazioni** (icona ingranaggio).
2. Scheda **Libreria & Download**.
3. Voce **Cartella Libreria Karaoke** → **Sfoglia...**.
4. Scegli la cartella con i file karaoke (`.mp4`, `.mp3`+`.cdg`, `.mid`, `.kar`, ecc.).

Senza cartella impostata:

- i download con archiviazione automatica attiva vengono bloccati con il messaggio:  
  **«Imposta la cartella libreria nelle impostazioni prima di scaricare.»**
- «Salva in Libreria» richiede comunque un percorso valido.

Dopo la scelta, l’app può scansionare e indicizzare i file nel database. Usa **Aggiorna Libreria** per una riscansione manuale.

### 3.2 Banco SoundFont (.sf2)

Per MIDI/KAR:

1. Scheda **Audio & Riproduzione** (o Generale, a seconda della ricerca impostazioni).
2. **Percorso Banco SoundFont (.sf2)**.
3. Di default è incluso un SoundFont GeneralUser GS; puoi selezionarne uno personalizzato.

Se non configurato, l’interfaccia può mostrare **«Nessun SoundFont (.sf2) configurato»**.

### 3.3 Dispositivi audio Master e CUE

| Impostazione | Uso |
| :--- | :--- |
| **Dispositivo Uscita Principale (Master Palco)** | Impianto PA / casse sala |
| **Dispositivo Uscita Pre-ascolto (Cuffie CUE)** | Cuffie operatore per anteprime senza disturbare la sala |

Configurali prima dell’evento. Il CUE usa il routing `setSinkId` sulla scheda secondaria.

### 3.4 Firewall (Guest Portal)

Alla prima esecuzione autorizza Karaoke Live Station sul firewall (reti **private**). Nelle Impostazioni è presente l’**Assistente Firewall & Connessione LAN** con diagnosi e comandi pronti (Windows / macOS / Linux UFW / Firewalld). Vedi anche la [sezione Troubleshooting](#14-risoluzione-dei-problemi).

### 3.5 Checklist rapida pre-serata

1. `libraryPath` impostato e libreria aggiornata  
2. SoundFont OK (se usi MIDI)  
3. Master + CUE corretti  
4. Stage aperto sul secondo monitor (`P` / **Riapri Palco**)  
5. Guest Portal attivo e firewall OK (se usi richieste da smartphone)  
6. Fair Queue e opzioni auto-advance come preferisci  

---

## 4. Console di Regia

La Regia è organizzata in tre schede principali a destra: **Coda Cantanti** (`1`), **Libreria & Ricerca** (`2`), **Storico** (`3`). Il player e i controlli audio restano sempre disponibili in alto/centrale.

### 4.1 Transport

| Controllo | Scorciatoia | Comportamento |
| :--- | :--- | :--- |
| Riproduci / Pausa | `Spazio` | Avvia o mette in pausa il brano caricato |
| Stop | `S` | Ferma, riavvolge a 0:00, arresta DSP/MIDI |
| Ricomincia | `R` | Torna a 0:00 senza togliere il brano dalla coda |
| Prossimo Brano | `N` | Valuta log SIAE e passa al successivo |
| Seek | `←` / `→` o scrubber | ±5 secondi; Stage si riallinea |

**Avvio dalla coda:** sul primo brano (o con doppio clic) compare l’hint:

> **Doppio click o Play per avviare**

Puoi avviare/mettere in pausa con il pulsante Play sulla riga del primo elemento, oppure fare doppio click su un brano in coda.

**Salva in Libreria:** se il brano proviene dal web o da `queue_cache`, compare **Salva in Libreria** sulla riga coda e nella testata player, per promuoverlo nella cartella libreria permanente.

### 4.2 Volume percettivo

Lo slider Volume Master usa una curva **quadratica psicoacustica**:

\[
Gain = volume^2 \quad (volume\ da\ 0\ a\ 1)
\]

Esempi: 100% → guadagno pieno; 50% → guadagno 0,25 (−12 dB circa, dimezzamento percepito); 0% → silenzio.

- Variazioni con **rampa anti-click ~50 ms** (niente “thump” sugli altoparlanti).
- **Muto** (`M`): silenzia il master mantenendo la posizione del fader.
- Frecce `↑` / `↓`: volume ±5%.
- Opzionale: **Normalizzazione Volume Audio** (livellamento automatico tra brani diversi).

### 4.3 Pitch (semitoni) e velocità

- **Tonalità:** da **−8 a +8** semitoni (`+` / `-` oppure `Ctrl+↑` / `Ctrl+↓`).
- Il pitch è legato **all’istanza in coda** (e alla memoria tonalità del cantante): resta memorizzato per quella esecuzione.
- A 0 semitoni il motore può bypassare lo shifter (latenza/CPU minime).
- **Velocità:** da **0,50× a 1,50×** senza alterare il pitch (WSOLA / SoundTouch). `Ctrl+←` / `Ctrl+→` regolano di ±5%. Clic sull’indicatore numerico ripristina spesso 1,00×.
- MIDI: la trasposizione agisce sui numeri di nota in tempo reale.

### 4.4 Rimozione voce guida (DSP sperimentale)

Il tasto **`V`** / controllo **Rimuovi Voce Guida (Sperimentale)** attiva una riduzione voce **algoritmica classica mid/side** (centro-canale / stile karaoke L−R) in **tempo reale**: leggera, senza modelli AI/ML, senza download e senza elaborazione offline.

In **Impostazioni → Audio & Riproduzione** puoi scegliere l’algoritmo usato dal pulsante in Regia:

| Algoritmo (`vocalRemoverAlgorithm`) | Descrizione UI |
| :--- | :--- |
| **`centerCancelBassKeep`** (default) | Cancella centro (mantieni bassi) — consigliato |
| **`centerCancel`** | Cancella centro completo (L−R classico) |
| **`softMid`** | Attenuazione mid soft (meno artefatti) |

Attivazione/disattivazione istantanea sul mix in riproduzione; il risultato dipende dal mix stereo (voci fortemente laterali o dry/wet particolari possono restare udibili).

### 4.5 Auto-ducking BGM

**Auto-Ducking BGM** (`D`): abbassa automaticamente la musica di sottofondo quando rileva/attivi il microfono per annunci, poi ripristina il livello. Ideale per presentazioni tra un brano e l’altro.

### 4.6 Mixer MIDI a 16 canali

Con file `.mid` / `.kar` compare il **Mixer Canali MIDI**:

- Attività note in tempo reale
- Mute per canale (es. **Guida Vocale (Ch 4)**, **Basso (Ch 2)**, **Batteria (Ch 10)**)
- Modifiche a caldo senza interrompere la sintesi SpessaSynth

### 4.7 Pre-ascolto CUE

Usa **Pre-ascolto Cuffie (CUE)** per ascoltare in cuffia mentre la sala sente il Master. Configura il dispositivo CUE nelle Impostazioni.

In **Libreria**, il pulsante Pre-ascolto apre il **modale anteprima** (stesso tema delle Impostazioni) e indirizza l’audio al dispositivo CUE. Non c’è una barra volume dedicata: volume e muto restano sui controlli del player incorporato (o del trasporto MIDI). Se CUE e Uscita Principale coincidono, togliendo il muto compare un avviso di conferma per evitare di mescolare l’anteprima sul PA di sala.

### 4.8 Persistenza coda e anti-crash

La scaletta (brani, cantanti, tonalità, posizioni) viene salvata in persistenza locale. Dopo chiusura o crash, alla riapertura la coda torna con il primo brano pronto in pausa a 0:00.

---

## 5. Coda Fair Queue, VIP e cache

### 5.1 Fair Queue (default ON)

**Algoritmo Fair Queue Attivo** è **abilitato di default** (`enableFairQueue: true`).

Calcola la posizione in base a:

- numero di brani già cantati dal partecipante
- orario di richiesta

Obiettivo: evitare che pochi cantanti monopolizzino la serata. Chi ha cantato di meno sale in priorità.

Con Fair Queue attivo, in inserimento puoi scegliere:

- **Posizione automatica (Fair Queue)** — l’algoritmo colloca il brano
- **In fondo alla coda** — ultimo posto fisso

**Ripristina coda automatica** ricalcola l’ordine ideale dopo drag & drop o override manuali (utile se `queue.length > 2`).

### 5.2 VIP e gestione manuale

- **Priorità VIP:** forza priorità per ospiti speciali / festeggiati.
- **Drag & Drop:** riordina le voci in attesa; il brano in riproduzione resta bloccato in testa.
- **Assegna Cantante** / gestione cantanti: nomi univoci (controllo case-insensitive) per far funzionare correttamente Fair Queue.
- **Memoria tonalità cantante:** ripropone la tonalità preferita quando il brano entra in esecuzione.
- **Svuota coda:** richiede conferma (**«Sei sicuro di voler svuotare l'intera scaletta della coda?»**); ferma la riproduzione.

### 5.3 Archiviazione automatica e `queue_cache`

| Impostazione | Default | Effetto |
| :--- | :--- | :--- |
| **Archiviazione Automatica Download Web in Libreria** | **ON** | I download vanno nella libreria permanente (`libraryPath`) |
| OFF (dopo conferma) | — | I download restano in `<userData>/queue_cache/` |

Disattivando l’archiviazione compare il modale obbligatorio:

**Titolo:** «Attenzione disattivazione archiviazione automatica»

**Testo:**  
«Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata.»

Conferma con **Conferma disattivazione**.

### 5.4 Persistenza cache e Garbage Collection

- File in `queue_cache` **sopravvivono ai riavvii** se il brano è ancora in coda.
- **GC allo scodamento:** il file viene cancellato dal disco solo quando nessuna voce in coda lo referenzia più (fine esecuzione, rimozione singola, svuota coda).
- **Salva in Libreria** promuove il file dalla cache alla cartella libreria e aggiorna percorsi/`uri` per uso offline.
- Deduplicazione download: prima di scaricare di nuovo, l’app cerca corrispondenze in libreria / `queue_cache` / catalogo (id YouTube, fingerprint, `Artista - Titolo`). In caso di hit: **«Brano già presente in locale...»** senza nuovo download di rete.

---

## 6. Libreria: ricerca, download e anteprime

Scheda **Libreria & Ricerca** (`2` o `Ctrl+F`).

### 6.1 Ricerca locale live

- Modalità **Locale** (ambito indipendente dalla ricerca Web)
- Filtro **continuo** mentre digiti (`onChange`) su titolo, artista, codice
- Stati vuoti distinti:
  - **«Libreria vuota. Scansiona una cartella o cerca sul web.»**
  - **«Nessun brano corrisponde alla ricerca locale.»**
- **Aggiorna Libreria** riscansisce `libraryPath` e aggiorna il catalogo SQLite
- Query, risultati, loading e scroll di **Locale** e **Web** sono **separati** (hook scoped): cambiare tab non perde lo stato né avvia ricerche YouTube indesiderate; persistenza in `sessionStorage` durante la sessione; le schede destra restano montate (nascoste)

### 6.2 Ricerca web (YouTube)

- Modalità **Web / YouTube** (ambito indipendente dalla ricerca Locale)
- Digita e premi **Invio** (non ricerca a ogni tasto)
- Motore: **yt-dlp** da `<userData>/bin/`
- Placeholder: **«Cerca brano su YouTube Karaoke...»**
- Vuoto: **«Nessun risultato web. Digita e premi Invio per cercare su YouTube.»**

### 6.3 Anteprima YouTube (anti errore 153)

Il modale anteprima incorpora il video da `youtube-nocookie.com` con parametri anti-blocco:

- `playsinline=1`
- `enablejsapi=1`
- `origin` e `widget_referrer` (origine della finestra)
- `rel=0`
- `modestbranding=1`
- `referrerPolicy="strict-origin-when-cross-origin"`
- autoplay mutato in anteprima

Questo riduce l’errore embed **153** tipico degli iframe YouTube restrittivi.

### 6.4 Download e badge «Download completato»

1. Avvia il download dal risultato web.
2. Progresso in **Download in Corso**.
3. A completamento (dopo un breve ritardo ~450 ms dalla lista progressi) compare il badge dismissibile:

> **Download completato**

Chiudilo con la **X** manuale.

4. Se auto-archive è ON e `libraryPath` è valido → file in libreria + reindicizzazione immediata.  
5. Se auto-archive è OFF → file in `queue_cache` (promuovibile con **Salva in Libreria**).  
6. Errori: toast persistente **«Download fallito: …»**.
7. **Metti in coda da YouTube con archiviazione automatica ON**: l’app attende il successo di download **e** archiviazione, aggiorna Locale, poi mette in coda il **file locale della libreria** (non un puntatore remoto/temp). In caso di errore, toast chiaro e **nessun** elemento non riproducibile in coda.

Copertine/miniature e anteprime locali si aggiornano senza riavviare (ffmpeg estrae frame ~al secondo 4 per i file locali; YouTube fornisce thumb web).

### 6.5 Anteprime / copertine e versioni

- Miniature 16:9 in lista
- Chip versione (es. KaraFun, Sing King, Con Cori, Strumentale…)
- Clic su miniatura / icona anteprima → **Anteprima e Controllo Versione** con scrubber, percorso file, aggiunta in coda e assegnazione cantante
- Il pulsante **Pre-ascolto** apre lo stesso modale tematico con audio sul dispositivo CUE (vedi §4.7)
- Con Fair Queue attivo, scelta posizione Fair vs in fondo anche dall’anteprima

### 6.6 Elimina dalla libreria

Sui brani del catalogo locale è disponibile **Elimina dalla libreria**, con conferma (**«Eliminare il brano?»**). L’azione:

1. Rimuove la voce dal database SQLite.
2. Elimina dal disco **solo** i file permanenti sotto la cartella libreria (`libraryPath`); non cancella file in `queue_cache` / `temp` / download incompleti.

Dopo la conferma compare un toast di esito (successo o errore).

---

## 7. Schermo Stage (Palco)

### 7.1 Handshake ready

Lo Stage si apre nascosto (`show: false`) con sfondo nero. Prima di mostrarsi:

1. Attende font e stylesheet
2. Doppio `requestAnimationFrame`
3. Segnala `signalStageReady()` al main process

Così non compare flash di layout grezzo. Se chiudi lo Stage, **Riapri Palco** o tasto **`P`** lo ricrea e risincronizza. Chiusura della Regia chiude anche lo Stage.

### 7.2 Badge semitoni e `showPitchOnStage`

Impostazione **Mostra variazione tonalità sullo schermo del palco** (`showPitchOnStage`, default tipicamente ON):

- Mostra il badge con offset in semitoni: **`+N`**, **`-N`** oppure **`0`**
- Il valore **0** è comunque visualizzato quando il toggle è attivo (il cantante vede che non c’è trasposizione)
- Descrizione UI: «Visualizza il badge con i semitoni di variazione (+/-) sullo schermo del palco per il cantante.»

### 7.2a Sfondi personalizzati dei messaggi Stage

In **Impostazioni → Schermo Stage**, ogni messaggio overlay (Ora Canta, Preparati, Prossimo sul palco, …) può definire testo/stile/attivazione e uno **sfondo Stage (colore o immagine) valido solo mentre il messaggio è visibile**. Al termine (o se disattivato) torna lo sfondo normale tema/video, senza riavvio.

### 7.2b Badge velocità e `showSpeedOnStage`

Impostazione **Mostra velocità di riproduzione sullo schermo del palco** (`showSpeedOnStage`, default tipicamente ON):

- Mostra il badge velocità (es. **`1.00x`**, **`1.25x`**)
- Descrizione UI: «Visualizza il badge della velocità di riproduzione (es. 1.00x, 1.25x) sullo schermo del palco per il cantante.»

### 7.3 Fullscreen e layout

- **`F11`** / **`Esc`** con focus sullo Stage
- Doppio clic (o due clic rapidi) per fullscreen senza bordi
- Video edge-to-edge; titolo/artista flottante a scomparsa (durata configurabile, tipicamente 8 s)
- Barra avanzamento sottile sul bordo inferiore
- Banner: **Ora Canta**, **Preparati**, **Prossima Esibizione** / **A seguire** (tempi in Impostazioni → Schermo Stage)

### 7.4 Contenuti supportati sul Palco

- Video karaoke (MP4/WebM/MKV)
- CD+G / MP3+G (Canvas)
- MIDI/KAR con testi sincronizzati (audio dalla Regia)

---

## 8. Avanzamento automatico e pausa di transizione

| Impostazione | Default | Note |
| :--- | :--- | :--- |
| **Avanzamento Automatico al Prossimo Brano** (`autoAdvanceNext`) | **OFF** | L’operatore decide quando far partire il successivo |
| **Pausa Transizione Brani (Sec)** (`transitionPauseSec`) | **3** | Attiva/utile quando l’auto-advance è ON |

### Comportamento con auto-advance OFF (default)

Alla fine naturale del brano la coda passa al successivo **in pausa a 0:00**. L’operatore preme Play (o usa «Doppio click o Play per avviare») per continuare. Ideale in serata live per annunci e microfono.

### Comportamento con auto-advance ON

Dopo la fine (e dopo l’eventuale countdown **«Prossimo brano tra Xs...»** basato su `transitionPauseSec`) parte automaticamente il brano successivo.

---

## 9. Impostazioni a tab e ricerca

Apri **Impostazioni di Sistema** (ingranaggio). In alto: campo **«Cerca impostazioni...»**.

### 9.1 Schede

| Tab | Contenuti tipici |
| :--- | :--- |
| **Generale** | Temi Regia/Palco, lingua, Fair Queue, Guest Portal, SIAE, supporto progetto |
| **Libreria & Download** | `libraryPath`, archiviazione automatica (+ warning), yt-dlp stato/aggiornamento |
| **Audio & Riproduzione** | SoundFont, Master/CUE, sync A/V, normalizzazione, **algoritmo rimozione voce (sperimentale)**, vocal remover/ducking di default, auto-advance, `transitionPauseSec` |
| **Schermo Stage** | Banner intro/outro, titolo overlay, prossimo cantante in intro, **`showPitchOnStage`**, **`showSpeedOnStage`**, **sfondi personalizzati messaggi Stage** |
| **Scorciatoie** | Elenco completo delle scorciatoie live (stesso inventario del pannello **?** / F1), ricercabile |

La ricerca filtra etichette/descrizioni **tra tutte le categorie** (inclusa la scheda Scorciatoie in **parità** con la guida **?**); svuotando il campo torni alla navigazione a tab. Nessuna impostazione viene rimossa dalla riorganizzazione a tab.

### 9.2 Altre opzioni utili

- Offset sincronizzazione audio/video (ms)
- Durata banner intro / trigger outro «Preparati»
- Durata titolo a schermo
- Mostra prossimo cantante all’inizio del brano
- Livello log diagnostico e apertura cartella/file log
- Esporta Registro SIAE (CSV) anche dalle impostazioni, oltre che dallo Storico

Salva con **Salva e Chiudi**.

---

## 10. Scorciatoie da tastiera

Apri la guida in qualsiasi momento con **`F1`** o **`?`**. Le scorciatoie live sono registrate con **cleanup** allo smontaggio del componente (nessun listener orfano dopo chiusura modali / cambio vista).

### 10.1 Riproduzione e scaletta

| Tasto | Azione |
| :--- | :--- |
| `Spazio` | Play / Pausa |
| `S` | Stop (riavvolgi e ferma) |
| `R` | Ricomincia da 0:00 |
| `N` | Prossimo brano |
| `←` / `→` | Seek ±5 s |

### 10.2 Audio e DSP

| Tasto | Azione |
| :--- | :--- |
| `M` | Muto master |
| `↑` / `↓` | Volume ±5% |
| `+` / `-` | Pitch ±1 semitono |
| `Ctrl+↑` / `Ctrl+↓` | Pitch ±1 semitono |
| `Ctrl+←` / `Ctrl+→` | Velocità ±5% |
| `V` | Rimozione voce guida DSP (sperimentale) |
| `D` | Auto-ducking BGM |

### 10.3 Navigazione e schermi

| Tasto | Azione |
| :--- | :--- |
| `1` | Scheda Coda Cantanti |
| `2` | Scheda Libreria & Ricerca |
| `3` | Scheda Storico SIAE |
| `Ctrl+F` | Apri Libreria e focus sul campo ricerca |
| `P` | Riapri / focus Schermo Palco |
| `F11` / `Esc` | Fullscreen Stage (con focus sul Palco) |
| `Esc` | Chiude anche modali/dialoghi in Regia |
| `F1` / `?` | Guida scorciatoie |

I tooltip dei controlli in Regia riportano le stesse combinazioni per uso a colpo d’occhio.

---


Anche in Impostazioni → Scorciatoie e nel pannello **?** / F1 (stesso elenco): Stop (`S`), Restart (`R`), frecce seek, Ctrl+frecce per pitch/velocità, Vocal remover sperimentale (`V`), Ducking (`D`), tab `1`/`2`/`3`, Stage (`P`), aiuto (`F1`/`?`). A schermo intero Stage: `F11`/`Esc` sulla finestra Stage.

## 11. Guest Portal LAN

### 11.1 Attivazione

1. PC Regia sulla stessa Wi‑Fi degli ospiti.
2. Abilita **Guest Portal LAN per Richieste da Smartphone** nelle Impostazioni (porta tipica **3000**, fallback 3001–3010 se occupata).
3. Apri il QR Code dalla barra Regia / richieste guest.
4. URL tipico: `http://192.168.x.x:3000`.

### 11.2 Flusso ospite

1. Inquadra il QR (iOS/Android, nessuna app).
2. Cerca nel **catalogo locale** (solo brani realmente in libreria; niente testo libero arbitrario).
3. Inserisce nome e tonalità (tipicamente da −4 a +4 semitoni lato guest).
4. Invia la richiesta.

### 11.3 Flusso operatore

- Badge **Richieste Guest** in Regia.
- **Approva** → inserimento in coda (Fair Queue se attivo) con tonalità richiesta.
- **Rifiuta** → scarta senza toccare la scaletta.

### 11.4 Firewall e Wi‑Fi

Usa l’assistente integrato. Verifica anche che sul router **Isolamento AP / Client Isolation** sia **disattivato**, altrimenti gli smartphone non raggiungono il PC Regia pur essendo sulla stessa rete.

---

## 12. Registro SIAE

Scheda **Storico** (`3`) — **Storico Esecuzioni** / borderò.

### 12.1 Quando viene registrata un’esecuzione

Un brano entra nel registro se:

1. raggiunge il **termine naturale**, oppure  
2. viene fermato/saltato (`S` / `N` / stop) dopo almeno **120 secondi** di riproduzione.

Sotto i 120 secondi (avvio per errore, prova, skip immediato) **non** viene registrato.

### 12.2 Anti-duplicati

Flag **`alreadyLogged`** sull’istanza in coda: una sola riga per esecuzione anche se dopo i 120 s ci sono ulteriori stop/next.

### 12.3 Dati e export

- Persistenza SQLite (`siae_logs`)
- **Timestamp ISO 8601** + epoch millisecondi
- Titolo, artista, cantante, durata effettiva
- Filtro ricerca: titolo / artista / cantante
- **Esporta SIAE (CSV)** con colonne data/ora ISO e timestamp
- **Svuota Storico** con conferma di sicurezza

Attiva/disattiva la raccolta con **Registro SIAE Automatico** nelle Impostazioni.

---

## 13. Temi e lingue (i18n)

### 13.1 Temi grafici (9)

Temi indipendenti per Regia (`themeHost`) e Palco (`themeStage`):

1. Dark Stage (Predefinito)  
2. Midnight Neon (Cyberpunk)  
3. Club Gold (VIP Lounge)  
4. Ocean Breeze (Deep Cyan)  
5. Sunset Crimson (Warm Red)  
6. Emerald Matrix (Live Green)  
7. Royal Amethyst (Deep Purple)  
8. High Contrast (Accessibile)  
9. Light Studio (Clean)  

### 13.2 Lingue

Interfaccia completa in:

- **Italiano** (`it`)
- **English** (`en`)
- **Español** (`es`)
- **Français** (`fr`)

All’avvio: rilevamento lingua di sistema (autodetect) con fallback. Cambio lingua in **Impostazioni → Lingua Interfaccia** senza riavvio, preferenza persistente.

I file di traduzione sono in `locales/it.json`, `en.json`, `es.json`, `fr.json`.

---

## 14. Risoluzione dei problemi

### 14.1 Firewall / Guest Portal non raggiungibile

1. Apri Impostazioni → Assistente Firewall; aggiorna la diagnosi.
2. **Windows:** Consenti app su reti private; se serve, regola TCP porte 3000–3010 (`netsh` / PowerShell come da card).
3. **macOS:** Consenti connessioni in entrata per Karaoke Live Station (Firewall → Opzioni).
4. **Linux:** `ufw allow 3000:3010/tcp` oppure regola Firewalld equivalente (comandi copiabili dalla card).
5. Verifica **Isolamento AP** del router = OFF.
6. Stessa subnet Wi‑Fi tra PC e telefoni; prova l’URL mostrato nel QR da un browser sul telefono.

### 14.2 yt-dlp / download web non funzionano

1. Controlla che esista `<userData>/bin/yt-dlp` (o `.exe`).
2. In Impostazioni → Libreria & Download: stato motore e **Verifica / Aggiorna**.
3. Non spostare yt-dlp in `/tmp` o fuori da `userData/bin/`: l’app gestisce solo il percorso managed.
4. Controlla i log in `<userData>/logs/`.
5. Se vedi «Non installato (verrà scaricato automaticamente)», attendi il bootstrap o forza l’aggiornamento con rete disponibile.

### 14.3 Libreria non configurata

Sintomi: impossibile scaricare/archiviare; messaggio **«Imposta la cartella libreria nelle impostazioni prima di scaricare.»**; salvataggi che falliscono.

Soluzione: Impostazioni → **Cartella Libreria Karaoke** → Sfoglia → cartella esistente → Aggiorna Libreria. Non fare affidamento su una cartella nascosta in `userData/library`.

### 14.4 Stage non si apre / resta nero

1. Premi **`P`** o **Riapri Palco**.
2. Attendi l’handshake ready (font/CSS); evita di forzare contenuti prima del segnale ready.
3. Verifica che il secondo monitor sia attivo nel desktop esteso del SO.
4. Riprova fullscreen (F11 / doppio clic sullo Stage).
5. Se HDMI/proiettore si scollega, ripristina il cavo: l’app può riagganciarsi; in dubbio riapri lo Stage.
6. Controlla di non aver avviato una seconda istanza (single-instance: usa la Regia già aperta).

### 14.5 Audio assente o sul dispositivo sbagliato

- Verifica **Master** e **CUE** nelle Impostazioni.
- Controlla muto (`M`) e volume (curva quadratica: sotto il 50% è già molto basso).
- MIDI: conferma SoundFont caricato.
- Rimozione voce DSP: effetto immediato e leggero; se il mix stereo non ha voce al centro, il risultato può essere minimo — prova un altro algoritmo in Impostazioni → Audio.

### 14.6 Pitch / badge velocità sul Palco

- Se il cantante non vede i semitoni: abilita **Mostra variazione tonalità sullo schermo del palco**.
- Se non vede la velocità: abilita **Mostra velocità di riproduzione sullo schermo del palco**.
- Atteso: `+2`, `-1`, `0`, e ad es. `1.00x` / `1.25x` in base alla coda.

### 14.7 Anteprima YouTube errore 153

L’embed usa già `youtube-nocookie` e i parametri anti-153. Se persiste: aggiorna l’app, verifica rete/DNS, riprova l’anteprima; per la serata scarica il brano in locale.

### 14.8 Coda / cache che “sparisce” dal disco

Con archiviazione automatica **OFF**, i file in `queue_cache` vengono eliminati allo **scodamento**. Per conservarli: **Salva in Libreria** oppure riattiva l’archiviazione automatica (default consigliato).

### 14.9 Log diagnostici

Impostazioni → Diagnostica & File di Log: livello, apri cartella/file, cancella log. Utile per ticket di supporto (errori streaming, yt-dlp, Stage).

---

## Appendice A — Stringhe UI italiane di riferimento

| Contesto | Stringa |
| :--- | :--- |
| Hint coda | Doppio click o Play per avviare |
| Download | Download completato |
| Warning auto-archive (titolo) | Attenzione disattivazione archiviazione automatica |
| Warning auto-archive (corpo) | Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata. |
| Errore libreria | Imposta la cartella libreria nelle impostazioni prima di scaricare. |
| Salvataggio | Salva in Libreria |
| Fair Queue | Fair Queue ATTIVO / Ripristina coda automatica |
| Stage | Ora Canta / Preparati / Prossima Esibizione |
| Tabs impostazioni | Generale · Libreria & Download · Audio & Riproduzione · Schermo Stage · Scorciatoie |

---

## Appendice B — Valori predefiniti operativi

| Impostazione | Default |
| :--- | :--- |
| Fair Queue | ON |
| Archiviazione automatica web | ON |
| Auto-advance prossimo brano | OFF |
| Pausa transizione | 3 s |
| showPitchOnStage | ON |
| showSpeedOnStage | ON |
| Porta Guest Portal | 3000 |
| Soglia log SIAE | ≥ 120 s oppure fine naturale |
| Range pitch Regia | −8 … +8 ST |
| Range velocità | 0,50× … 1,50× |
| Tema | dark-stage |

---

*Fine del Manuale Utente — Karaoke Live Station (Phase 6, documentazione IT).*

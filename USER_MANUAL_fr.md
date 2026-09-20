# Manuel utilisateur — Karaoke Live Station

**Karaoke Live Station** — station professionnelle multiplateforme pour DJ, KJ et établissements de karaoke live.  
Architecture : Electron, React 18, Web Audio DSP, synthèse SoundFont/MIDI, Guest Portal LAN (Express), catalogue SQLite.

Ce document est le manuel opérationnel complet (Phases 1–5) en **français**. Destiné à l’opérateur en régie.

---

## Table des matières

1. [Vue d’ensemble et architecture](#1-vue-densemble-et-architecture)
2. [Installation et chemins portables](#2-installation-et-chemins-portables)
3. [Première configuration](#3-première-configuration)
4. [Console de régie](#4-console-de-régie)
5. [File Fair Queue, VIP et cache](#5-file-fair-queue-vip-et-cache)
6. [Bibliothèque : recherche, téléchargements et aperçus](#6-bibliothèque--recherche-téléchargements-et-aperçus)
7. [Écran Stage (Scène)](#7-écran-stage-scène)
8. [Avancement automatique et pause de transition](#8-avancement-automatique-et-pause-de-transition)
9. [Réglages par onglets et recherche](#9-réglages-par-onglets-et-recherche)
10. [Raccourcis clavier](#10-raccourcis-clavier)
11. [Guest Portal LAN](#11-guest-portal-lan)
12. [Registre SIAE](#12-registre-siae)
13. [Thèmes et langues (i18n)](#13-thèmes-et-langues-i18n)
14. [Résolution des problèmes](#14-résolution-des-problèmes)

---

## 1. Vue d’ensemble et architecture

Karaoke Live Station gère une soirée karaoke sur **deux fenêtres indépendantes** plus un portail invités sur le réseau local.

### 1.1 Fenêtre de régie (Control — Master)

Console opérateur complète :

- Transport (Play / Pause / Stop / Recommencer / Suivant)
- Volume master avec courbe perceptive
- Pitch en demi-tons et vitesse (time-stretch)
- Suppression de la voix guide **(Algorithme de Base)** via DSP classique mid/side (algorithmique, temps réel)
- Auto-ducking BGM au micro
- Mixeur MIDI/KAR à 16 canaux
- Préécoute CUE sur un périphérique secondaire
- File des chanteurs (Fair Queue), Bibliothèque & recherche, Historique SIAE
- Gestion des demandes Guest Portal

### 1.2 Fenêtre Stage / Écran scène (Slave)

Écran pour le chanteur et le public (TV ou projecteur) :

- Vidéo MP4/WebM/MKV, graphismes CD+G, paroles MIDI/KAR
- Audio de la Stage **coupé** (l’audio sort uniquement de la Régie / Master)
- Synchronisation via IPC avec la Régie
- Bannières «Ora Canta», «Preparati», «Prossima Esibizione» (textes d’UI en italien)
- Badge de demi-tons configurable (`showPitchOnStage`)
- Badge de vitesse configurable (`showSpeedOnStage`)
- Plein écran (F11 / Esc / double-clic)

### 1.3 Guest Portal LAN

Serveur web intégré (Express + Socket.IO) sur le Wi‑Fi de l’établissement. Les invités scannent un QR Code et envoient des demandes depuis le téléphone sans installer d’application.

### 1.4 Instance unique (Single Instance Lock)

L’application n’autorise **qu’une seule instance** en cours d’exécution. Un second démarrage est bloqué : le nouveau processus affiche un dialogue (**« Logiciel déjà en cours d’exécution »** / équivalents IT/EN/ES), puis se termine, et la fenêtre de Régie déjà ouverte est restaurée et mise au premier plan. Évite les doubles Régies, les conflits audio et les ports Guest Portal dupliqués.

### 1.5 Flux audio / vidéo en résumé

1. La Régie possède le transport et le graphe Web Audio.
2. Les médias locaux passent par le protocole `karaoke://local/` avec streaming par plages d’octets (HTTP 206), ainsi la Stage peut s’ouvrir/se fermer en cours de morceau sans désynchroniser.
3. Pitch, vitesse, suppression vocale DSP (expérimentale), ducking, normalisation et routage CUE vivent dans le graphe audio de la Régie.
4. MIDI/KAR : parsing → SpessaSynth + SoundFont → mixeur à 16 canaux.
5. L’avancement de file et le registre SIAE sont gérés dans le store ; la Stage reçoit l’état via IPC.

---

## 2. Installation et chemins portables

### 2.1 Systèmes pris en charge

- **Linux** (Ubuntu/Debian, Fedora, Arch et similaires)
- **Windows** 10/11 64 bits
- **macOS** 11+ (Apple Silicon et Intel)

Recommandé : bureau étendu sur **deux moniteurs** (Régie + Scène) et, si possible, interface audio USB multi-sortie pour séparer Master et casque CUE.

### 2.2 Dossier de données de l’application (`userData`)

Toutes les données gérées par l’app vivent sous le dossier Electron `userData` (pas dans `/tmp`) :

| Plateforme | Chemin typique |
| :--- | :--- |
| Linux | `~/.config/karaoke-live-station/` (ou nom d’app XDG équivalent) |
| macOS | `~/Library/Application Support/<App>/` |
| Windows | `%APPDATA%\<App>\` |

Contenus pertinents :

| Chemin relatif | Contenu |
| :--- | :--- |
| `karaoke_station.db` | Base SQLite (catalogue, chanteurs, journal SIAE) en mode WAL |
| `bin/` | Binaires gérés, en particulier **yt-dlp** |
| `temp/` | Téléchargements en cours |
| `queue_cache/` | Fichiers web non archivés en bibliothèque, persistants tant qu’ils sont en file |
| `thumbnails/` | Miniatures générées |
| `logs/` | Journaux de diagnostic |

### 2.3 Binaires gérés dans `<userData>/bin/`

**yt-dlp** (et d’autres binaires gérés) sont installés et mis à jour dans :

```text
<userData>/bin/yt-dlp      (Linux / macOS)
<userData>/bin/yt-dlp.exe  (Windows)
```

Comportement opérationnel :

1. Au démarrage l’app préfère toujours la copie dans `userData/bin/`.
2. Si elle manque ou est corrompue, elle peut **semer** (seed) depuis le paquet installé vers `userData/bin/`.
3. Vérification d’intégrité (taille minimale, exécutabilité, probe `--version`).
4. Mises à jour depuis GitHub Releases uniquement si manquant ou version plus récente (ne re-télécharge pas à chaque démarrage).
5. Installation atomique dans `userData/bin/` (fichier temporaire sibling, puis remplacement) ; sous Windows, gestion sûre des fichiers verrouillés.

**ffmpeg** est résolu depuis paquet/bundle/PATH pour miniatures et conversions ; yt-dlp reste le moteur de recherche/téléchargement web.

Dans **Réglages → Bibliothèque & Téléchargement** (`Impostazioni → Libreria & Download`) vous pouvez voir l’état/version de yt-dlp et utiliser **Vérifier / Mettre à jour** (`Verifica / Aggiorna` dans l’UI italienne).

### 2.4 Bibliothèque média de l’utilisateur

Le dossier média n’est **pas** un repli silencieux `userData/library` : c’est le chemin **obligatoire** `libraryPath` choisi par l’opérateur (souvent `~/Karaoke` ou `C:\Users\<Utilisateur>\Karaoke`). Tous les enregistrements et l’archivage automatique utilisent exclusivement ce chemin.

---

## 3. Première configuration

Au démarrage, si `libraryPath` manque ou n’existe pas sur le disque, la procédure guidée apparaît (dialogues **non modaux** par rapport au parent Chromium, pour ne pas suspendre l’audio).

### 3.1 Dossier Bibliothèque Karaoke (obligatoire)

1. Ouvrez **Réglages** (icône engrenage).
2. Onglet **Bibliothèque & Téléchargement** (`Libreria & Download`).
3. Entrée **Dossier Bibliothèque Karaoke** (`Cartella Libreria Karaoke`) → **Parcourir...** (`Sfoglia...`).
4. Choisissez le dossier contenant les fichiers karaoke (`.mp4`, `.mp3`+`.cdg`, `.mid`, `.kar`, etc.).

Sans dossier configuré :

- les téléchargements avec archivage automatique actif sont bloqués avec le message :  
  **«Imposta la cartella libreria nelle impostazioni prima di scaricare.»** (texte d’UI en italien)
- «Salva in Libreria» exige tout de même un chemin valide.

Après le choix, l’app peut scanner et indexer les fichiers dans la base. Utilisez **Mettre à jour la bibliothèque** (`Aggiorna Libreria`) pour un nouveau scan manuel.

**Scan récursif :** **Mettre à jour la bibliothèque** parcourt **tous les sous-dossiers** sous `libraryPath` (ignore les dossiers inutiles comme `.git` / `node_modules`). Les arbres Artiste/Album imbriqués sont indexés ; la déduplication des téléchargements cherche aussi dans tout l’arbre pour ne pas re-télécharger des fichiers déjà présents.

### 3.2 Banque SoundFont (.sf2)

Pour MIDI/KAR :

1. Onglet **Audio & Lecture** (`Audio & Riproduzione`) (ou Général, selon la recherche des réglages).
2. **Chemin de la banque SoundFont (.sf2)** (`Percorso Banco SoundFont (.sf2)`).
3. Par défaut un SoundFont GeneralUser GS est inclus ; choisissez-le dans la liste ou **Autre** (`Altro`) pour un `.sf2` externe.

**Note AppImage / portable :** la banque est semée sous `userData/soundfonts/` (pas le chemin éphémère `/tmp/.mount_*` de l’AppImage). Après une mise à jour AppImage, si le MIDI est muet rouvrez une fois les Réglages pour recalculer le chemin.

Si non configuré, l’interface peut afficher **«Nessun SoundFont (.sf2) configurato»** (texte d’UI en italien).

### 3.3 Périphériques audio Master et CUE

| Réglage | Usage |
| :--- | :--- |
| **Périphérique de sortie principale (Master scène)** (`Dispositivo Uscita Principale (Master Palco)`) | Sono PA / enceintes de salle |
| **Périphérique de sortie préécoute (Casque CUE)** (`Dispositivo Uscita Pre-ascolto (Cuffie CUE)`) | Casque opérateur pour les aperçus sans déranger la salle |

Configurez-les avant l’événement. Le CUE utilise le routage `setSinkId` sur la carte secondaire.

### 3.4 Pare-feu (Guest Portal)

À la première exécution, autorisez Karaoke Live Station dans le pare-feu (réseaux **privés**). Dans les Réglages se trouve l’**Assistant Pare-feu & Connexion LAN** (`Assistente Firewall & Connessione LAN`) avec diagnostic et commandes prêtes (Windows / macOS / Linux UFW / Firewalld). Voir aussi la [section Résolution des problèmes](#14-résolution-des-problèmes).

### 3.5 Checklist rapide pré-soirée

1. `libraryPath` défini et bibliothèque à jour  
2. SoundFont OK (si vous utilisez MIDI)  
3. Master + CUE corrects  
4. Stage ouvert sur le second moniteur (`P` / **Rouvrir la scène** / `Riapri Palco`)  
5. Guest Portal actif et pare-feu OK (si vous utilisez les demandes smartphone)  
6. Fair Queue et options d’auto-avance selon vos préférences  

---

## 4. Console de régie

La Régie est organisée en trois onglets principaux à droite : **File des chanteurs** (`Coda Cantanti`) (`1`), **Bibliothèque & Recherche** (`Libreria & Ricerca`) (`2`), **Historique** (`Storico`) (`3`). Le lecteur et les commandes audio restent toujours disponibles en haut/au centre.

### 4.1 Transport

| Commande | Raccourci | Comportement |
| :--- | :--- | :--- |
| Lecture / Pause | `Espace` (`Spazio`) | Démarre ou met en pause le morceau chargé |
| Stop | `S` | Arrête, rembobine à 0:00, stoppe DSP/MIDI |
| Recommencer | `R` | Revient à 0:00 sans retirer le morceau de la file |
| Morceau suivant | `N` | Évalue le journal SIAE et passe au suivant |
| Seek | `←` / `→` ou scrubber | ±5 secondes ; la Stage se réaligne |

**Démarrage depuis la file :** sur le premier morceau (ou avec double-clic) apparaît l’indication :

> **Doppio click o Play per avviare** (texte d’UI en italien)

Vous pouvez démarrer/mettre en pause avec le bouton Play de la première ligne, ou double-cliquer un morceau en file.

**Enregistrer dans la bibliothèque :** si le morceau vient du web ou de `queue_cache`, **Salva in Libreria** apparaît sur la ligne de file et dans l’en-tête du lecteur, pour le promouvoir dans le dossier permanent de bibliothèque.

### 4.2 Volume perceptif

Le curseur Volume Master utilise une courbe **quadratique psychoacoustique** :

\[
Gain = volume^2 \quad (volume\ de\ 0\ à\ 1)
\]

Exemples : 100 % → gain plein ; 50 % → gain 0,25 (−12 dB environ, moitié du volume perçu) ; 0 % → silence.

- Les variations utilisent une **rampe anti-clic ~50 ms** (pas de « thump » sur les enceintes).
- **Muet** (`M`) : coupe le master en conservant la position du fader.
- Flèches `↑` / `↓` : volume ±5 %.
- Optionnel : **Normalisation du volume audio** (`Normalizzazione Volume Audio`) (nivellement automatique entre morceaux différents).

### 4.3 Pitch (demi-tons) et vitesse

- **Tonalité :** de **−8 à +8** demi-tons (`+` / `-` ou `Ctrl+↑` / `Ctrl+↓`). À côté des commandes Régie apparaît la **clé musicale** détectée (`Am→Bm` si transposée) ou le placeholder « — » si elle n’est pas encore connue.
- Puces **Key / BPM** aussi sur les lignes Bibliothèque et File (toujours visibles ; placeholder si manquantes).
- À côté du tempo apparaît la valeur BPM avec le libellé **BPM** (ou « — BPM » si inconnue).
- Le pitch est lié à l’**instance en file** (et à la mémoire de tonalité du chanteur) : il reste mémorisé pour cette prestation.
- À 0 demi-ton le moteur peut contourner le shifter (latence/CPU minimales).
- **Vitesse :** selon le moteur (défaut **Bungee** ~0,50×–1,50× ; **SoundTouch** ~0,75×–1,25× en UI). `Ctrl+←` / `Ctrl+→` règlent de ±5 %. Un clic sur l’indicateur numérique restaure souvent 1,00×.
- **Moteur DSP (Réglages → Audio) :** **Bungee** (défaut) — pitch + time-stretch de qualité via Wasm AudioWorklet ; le `playbackRate` média reste à 1,0 pendant l’étirement Bungee. **SoundTouch** — WSOLA classique ; le `playbackRate` de l’élément pilote le tempo. À **0 ST et 1,00×** le graphe contourne le shifter (latence minimale). MIDI/KAR utilise toujours la transposition de notes SpessaSynth (pas Bungee/SoundTouch).
- MIDI : la transposition agit sur les numéros de note en temps réel.

### 4.4 Suppression de la voix guide (Algorithme de Base)

La touche **`V`** / la commande **Suppression Voix Guide (Algorithme de Base)** active la méthode choisie dans **Réglages → Audio** :

| Méthode | Notes |
| --- | --- |
| `centerCancelBassKeep` / `centerCancel` / `softMid` | DSP mid/side **temps réel** — léger, sans téléchargement |

Dans les résultats YouTube, **Télécharger Instrumental** (si le titre ne contient pas déjà « Karaoke » ou « instrumental ») télécharge la vidéo, applique la **Méthode Télécharger Instrumental** de **Réglages → Bibliothèque & Téléchargement** (IA hors ligne comme UVR-MDX-NET Karaoke 2) et enregistre un MP4 instrumental (sous-titres incrustés si disponibles). Avant chaque téléchargement, l’app peut demander s’il faut récupérer les sous-titres auto YouTube ; cochez **Mémoriser mon choix** pour ignorer la question ensuite. Vous pouvez modifier ou effacer cette préférence à tout moment dans **Réglages → Bibliothèque & Téléchargement → Sous-titres Télécharger Instrumental** (`Demander à chaque fois` / `Toujours` / `Jamais`). Avec UVR-MDX-NET sélectionné, **Paramètres avancés UVR-MDX-NET (optimisation ETA)** apparaît sous ce menu : taille de segment, chevauchement et accélération CPU ONNX Runtime — uniquement pour ce chemin MDX.

### 4.5 Auto-ducking BGM

**Auto-Ducking BGM** (`D`) : baisse automatiquement la musique de fond lorsque le micro est détecté/activé pour les annonces, puis restaure le niveau. Idéal pour les présentations entre deux morceaux.

### 4.6 Mixeur MIDI à 16 canaux

Avec des fichiers `.mid` / `.kar` apparaît le **Mixeur de canaux MIDI** (`Mixer Canali MIDI`) :

- Activité des notes en temps réel
- Mute par canal (ex. **Voix guide (Ch 4)** / `Guida Vocale (Ch 4)`, **Basse (Ch 2)** / `Basso (Ch 2)`, **Batterie (Ch 10)** / `Batteria (Ch 10)`)
- Modifications à chaud sans interrompre la synthèse SpessaSynth

### 4.7 Préécoute CUE

Utilisez **Préécoute casque (CUE)** (`Pre-ascolto Cuffie (CUE)`) pour écouter au casque pendant que la salle entend le Master. Configurez le périphérique CUE dans les Réglages.

Dans **Bibliothèque**, le bouton Préécoute ouvre le **modal d’aperçu** (même style que les Paramètres) et route l’audio vers le périphérique CUE. Pas de barre de volume séparée : mute/volume restent sur les contrôles du lecteur intégré (ou transport MIDI). Si CUE et Sortie Principale coïncident, le démutage affiche un avertissement de confirmation pour éviter de mélanger l’aperçu sur le PA de salle — y compris l’**embed YouTube de la recherche Web**, qui utilise le même modal thématique que vidéo/audio/MIDI locaux.

### 4.8 Persistance de la file et anti-crash

La setlist (morceaux, chanteurs, tonalités, positions) est enregistrée en persistance locale. Après fermeture ou crash, à la réouverture la file revient avec le premier morceau prêt en pause à 0:00.

---

## 5. File Fair Queue, VIP et cache

### 5.1 Fair Queue (par défaut ON)

**Algorithme Fair Queue actif** (`Algoritmo Fair Queue Attivo`) est **activé par défaut** (`enableFairQueue: true`).

Calcule la position selon :

- nombre de morceaux déjà chantés par le participant
- heure de la demande

Objectif : éviter que quelques chanteurs monopolisent la soirée. Ceux qui ont chanté le moins montent en priorité.

Avec Fair Queue actif, à l’insertion vous pouvez choisir :

- **Position automatique (Fair Queue)** (`Posizione automatica (Fair Queue)`) — l’algorithme place le morceau
- **En fin de file** (`In fondo alla coda`) — dernière place fixe

**Restaurer la file automatique** (`Ripristina coda automatica`) recalcule l’ordre idéal après drag & drop ou dérogations manuelles (utile si `queue.length > 2`).

### 5.2 VIP et gestion manuelle

- **Priorité VIP :** force la priorité pour invités spéciaux / célébrations.
- **Drag & Drop (réordonner) :** réordonne les entrées en attente ; le morceau en lecture reste verrouillé en tête.
- **Drop fichiers OS (import) :** déposez des fichiers média sur le panneau **File** ou **Bibliothèque** pour les cataloguer (mp4/webm/mkv/avi, mp3+cdg, mid/kar) via `library.importFiles`. Le drop sur la File les enfile aussi. Le DnD de réordonnancement utilise des indices texte et **n’intercepte pas** les drops de fichiers OS.
- **Assigner un chanteur** (`Assegna Cantante`) / gestion des chanteurs : noms uniques (contrôle insensible à la casse) pour que Fair Queue fonctionne correctement.
- **Mémoire de tonalité du chanteur :** repropose la tonalité préférée lorsque le morceau démarre.
- **Vider la file :** demande confirmation (**«Sei sicuro di voler svuotare l'intera scaletta della coda?»** — texte d’UI en italien) ; arrête la lecture.

### 5.3 Archivage automatique et `queue_cache`

| Réglage | Défaut | Effet |
| :--- | :--- | :--- |
| **Archivage automatique des téléchargements web en bibliothèque** (`Archiviazione Automatica Download Web in Libreria`) | **ON** | Les téléchargements vont dans la bibliothèque permanente (`libraryPath`) |
| OFF (après confirmation) | — | Les téléchargements restent dans `<userData>/queue_cache/` |

En désactivant l’archivage apparaît la modale obligatoire :

**Titre :** «Attenzione disattivazione archiviazione automatica» (texte d’UI en italien)

**Texte :**  
«Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata.» (texte d’UI en italien)

Confirmez avec **Confirmer la désactivation** (`Conferma disattivazione`).

### 5.4 Persistance du cache et Garbage Collection

- Les fichiers dans `queue_cache` **survivent aux redémarrages** si le morceau est encore en file.
- **GC au retrait de file :** le fichier est effacé du disque seulement lorsqu’aucune entrée de file ne le référence plus (fin de prestation, suppression individuelle, vidage de file).
- **Salva in Libreria** promeut le fichier du cache vers le dossier bibliothèque et met à jour les chemins/`uri` pour un usage hors ligne.
- Déduplication des téléchargements : avant de retélécharger, l’app cherche des correspondances dans bibliothèque / `queue_cache` / catalogue (id YouTube, fingerprint, `Artiste - Titre`). En cas de hit : l’avis **«Brano già presente in locale...»** (texte localisé) apparaît dans le menu **Téléchargements** (pas en toast hors file), sans nouveau téléchargement réseau.

---

## 6. Bibliothèque : recherche, téléchargements et aperçus

Onglet **Bibliothèque & Recherche** (`Libreria & Ricerca`) (`2` ou `Ctrl+F`).

### 6.1 Recherche locale en direct

- Mode **Locale** (périmètre indépendant de la recherche Web)
- Filtre **continu** pendant la frappe (`onChange`) sur titre, artiste, code
- Correspondance **insensible à la casse et aux accents** (ex. `moriro da re` trouve `morirò da re`)
- États vides distincts :
  - **«Libreria vuota. Scansiona una cartella o cerca sul web.»** (texte d’UI en italien)
  - **«Nessun brano corrisponde alla ricerca locale.»** (texte d’UI en italien)
- **Mettre à jour la bibliothèque** (`Aggiorna Libreria`) rescane `libraryPath` et met à jour le catalogue SQLite
- Requête, résultats, chargement et scroll de **Locale** et **Web** sont **séparés** (périmètres indépendants) : changer d’onglet ne perd pas l’état et ne lance pas de recherches YouTube indésirables ; persistance dans `sessionStorage` pendant la session ; les onglets de droite restent montés (masqués)

### 6.2 Recherche web (YouTube)

- Mode **Web / YouTube** (périmètre indépendant de la recherche Locale)
- Tapez et appuyez sur **Entrée** (pas de recherche à chaque touche)
- Moteur : **yt-dlp** depuis `<userData>/bin/`
- Placeholder : **«Cerca brano su YouTube Karaoke...»** (texte d’UI en italien)
- Vide : **«Nessun risultato web. Digita e premi Invio per cercare su YouTube.»** (texte d’UI en italien)

### 6.3 Aperçu YouTube (anti erreur 153)

La modale d’aperçu intègre la vidéo depuis `youtube-nocookie.com` avec des paramètres anti-blocage :

- `playsinline=1`
- `enablejsapi=1`
- `origin` et `widget_referrer` (origine de la fenêtre)
- `rel=0`
- `modestbranding=1`
- `referrerPolicy="strict-origin-when-cross-origin"`
- autoplay muet en aperçu
- confirmation de démutage même périphérique (CUE === Sortie Principale) via YouTube IFrame API + modal thématique

Cela réduit l’erreur d’embed **153** typique des iframes YouTube restrictifs.

Avec **archivage automatique** ON, **Mettre en file** depuis YouTube attend le téléchargement + sauvegarde bibliothèque, puis exécute une **réindexation Local complète** (miniature ffmpeg incluse) **avant** d’enfiler le fichier local — le titre apparaît donc en Local avec la bonne couverture sans « Actualiser la bibliothèque » manuelle.

### 6.4 Téléchargement et badge «Download completato»

1. Lancez le téléchargement depuis le résultat web.
2. Progression dans **Téléchargement en cours** (`Download in Corso`).
3. À la fin (après un court délai ~450 ms depuis la liste des progressions) apparaît le badge dismissible :

> **Download completato** (texte d’UI en italien)

Fermez-le avec le **X** manuel.

4. Si l’auto-archive est ON et `libraryPath` est valide → fichier en bibliothèque + réindexation immédiate.  
5. Si l’auto-archive est OFF → fichier dans `queue_cache` (promouvable avec **Salva in Libreria**).  
6. Erreurs : toast persistant **«Download fallito: …»** (texte d’UI en italien).
7. **Ajout à la file depuis YouTube avec archivage automatique ON** : l’app attend le succès du téléchargement **et** de l’archivage, rafraîchit Local, puis met en file le **fichier local de la bibliothèque** (pas un pointeur distant/temp). En cas d’échec, toast d’erreur et **aucun** élément non lisible en file.

Pochettes/miniatures et aperçus locaux se mettent à jour sans redémarrer (ffmpeg extrait une image ~à la seconde 4 pour les fichiers locaux ; YouTube fournit des thumbs web).

### 6.5 Aperçus / pochettes et versions

- Miniatures 16:9 dans la liste
- Chip de version (ex. KaraFun, Sing King, Avec chœurs, Instrumental…)
- Clic sur miniature / icône d’aperçu → **Aperçu et contrôle de version** (`Anteprima e Controllo Versione`) avec scrubber, chemin de fichier, ajout en file et attribution de chanteur
- Avec Fair Queue actif, choix de position Fair vs en fin de file aussi depuis l’aperçu
- Le bouton **Préécoute** ouvre le même modal thématique avec audio sur le périphérique CUE (voir §4.7)

### 6.6 Supprimer de la bibliothèque

Sur les titres du catalogue local : **Supprimer de la bibliothèque** (`Elimina dalla libreria`), avec confirmation (**«Eliminare il brano?»**). L’action :

1. Retire l’entrée du catalogue SQLite.
2. Efface du disque **uniquement** les fichiers permanents sous le dossier bibliothèque (`libraryPath`) ; ne supprime pas `queue_cache` / `temp` / téléchargements incomplets.

Un toast de résultat suit la confirmation.

---

## 7. Écran Stage (Scène)

### 7.1 Handshake ready

La Stage s’ouvre masquée (`show: false`) avec fond noir. Avant de s’afficher :

1. Attend polices et feuilles de style
2. Double `requestAnimationFrame`
3. Signale `signalStageReady()` au processus main

Ainsi aucun flash de layout brut n’apparaît. Si vous fermez la Stage, **Rouvrir la scène** (`Riapri Palco`) ou la touche **`P`** la recrée et la resynchronise. La fermeture de la Régie ferme aussi la Stage.

### 7.2 Badge de demi-tons et `showPitchOnStage`

Réglage **Afficher la variation de tonalité sur l’écran de scène** (`Mostra variazione tonalità sullo schermo del palco`) (`showPitchOnStage`, défaut typiquement ON) :

- Affiche le badge avec l’offset en demi-tons : **`+N`**, **`-N`** ou **`0`**
- La valeur **0** est tout de même affichée lorsque le bascule est actif (le chanteur voit qu’il n’y a pas de transposition)
- Description UI : «Visualizza il badge con i semitoni di variazione (+/-) sullo schermo del palco per il cantante.» (texte d’UI en italien)

### 7.2a Fonds personnalisés des messages scène

Dans **Paramètres → Écran scène**, chaque message superposé peut définir texte/style/activation et un **fond scène (couleur ou image) uniquement pendant l’affichage du message**. À la disparition (ou si désactivé), le fond thème/vidéo normal est rétabli sans redémarrage.

### 7.2b Badge de vitesse et `showSpeedOnStage`

Réglage **Afficher la vitesse de lecture sur l’écran de scène** (`Mostra velocità di riproduzione sullo schermo del palco`) (`showSpeedOnStage`, typiquement ON par défaut) :

- Affiche le badge de vitesse (ex. **`1.00x`**, **`1.25x`**)
- Description UI : «Visualizza il badge della velocità di riproduzione (es. 1.00x, 1.25x) sullo schermo del palco per il cantante.» (texte d’UI en italien)

### 7.3 Plein écran et layout

- **`F11`** / **`Esc`** avec le focus sur la Stage
- Double-clic (ou deux clics rapides) pour le plein écran sans bordures
- Vidéo bord à bord ; titre/artiste flottant à disparition (durée configurable, typiquement 8 s)
- Barre de progression fine sur le bord inférieur
- Bannières : **Ora Canta**, **Preparati**, **Prossima Esibizione** / **A seguire** (textes d’UI en italien ; timings dans Réglages → Écran Stage)

### 7.4 Contenus pris en charge sur la scène

- Vidéo karaoke (MP4/WebM/MKV)
- CD+G / MP3+G (Canvas)
- MIDI/KAR avec paroles synchronisées (audio depuis la Régie)

---

## 8. Avancement automatique et pause de transition

| Réglage | Défaut | Notes |
| :--- | :--- | :--- |
| **Avancement automatique au morceau suivant** (`Avanzamento Automatico al Prossimo Brano`) (`autoAdvanceNext`) | **OFF** | L’opérateur décide quand démarrer le suivant |
| **Pause de transition entre morceaux (s)** (`Pausa Transizione Brani (Sec)`) (`transitionPauseSec`) | **3** | Actif/utile lorsque l’auto-avance est ON |

### Comportement avec auto-avance OFF (défaut)

À la fin naturelle du morceau, la file passe au suivant **en pause à 0:00**. L’opérateur appuie sur Play (ou utilise «Doppio click o Play per avviare») pour continuer. Idéal en soirée live pour annonces et micro.

### Comportement avec auto-avance ON

Après la fin (et après l’éventuel compte à rebours **«Prossimo brano tra Xs...»** basé sur `transitionPauseSec` — texte d’UI en italien) le morceau suivant démarre automatiquement.

---

## 9. Réglages par onglets et recherche

Ouvrez **Réglages système** (`Impostazioni di Sistema`) (engrenage). En haut : champ **«Cerca impostazioni...»** (texte d’UI en italien).

### 9.1 Onglets

| Onglet | Contenus typiques |
| :--- | :--- |
| **Général** (`Generale`) | Thèmes Régie/Scène, langue, Fair Queue, Guest Portal, SIAE, support du projet |
| **Bibliothèque & Téléchargement** (`Libreria & Download`) | `libraryPath`, archivage automatique (+ avertissement), état/mise à jour yt-dlp |
| **Audio & Lecture** (`Audio & Riproduzione`) | SoundFont, Master/CUE, sync A/V, normalisation, **algorithme de suppression vocale (expérimental)**, vocal remover/ducking par défaut, auto-avance, `transitionPauseSec` |
| **Écran Stage** (`Schermo Stage`) | Bannières intro/outro, overlay titre, prochain chanteur en intro, **`showPitchOnStage`**, **`showSpeedOnStage`**, **fonds personnalisés des messages scène** |
| **Raccourcis** (`Scorciatoie`) | Inventaire complet des raccourcis live (même liste que le panneau **?** / F1), searchable |

La recherche filtre libellés/descriptions **parmi toutes les catégories** (y compris Raccourcis en **parité** avec le guide **?**) ; en vidant le champ vous revenez à la navigation par onglets. Aucun réglage n’est retiré par la réorganisation en onglets.

### 9.2 Autres options utiles

- Offset de synchronisation audio/vidéo (ms)
- Durée de la bannière intro / déclencheur outro «Preparati»
- Durée du titre à l’écran
- Afficher le prochain chanteur au début du morceau
- Niveau de journal diagnostique et ouverture du dossier/fichier de log
- Exporter le registre SIAE (CSV) aussi depuis les réglages, en plus de l’Historique

Enregistrez avec **Enregistrer et fermer** (`Salva e Chiudi`).

---

## 10. Raccourcis clavier

Ouvrez le guide à tout moment avec **`F1`** ou **`?`**. Les raccourcis live sont enregistrés avec **cleanup** au démontage du composant (aucun listener orphelin après fermeture de modales / changement de vue).

### 10.1 Lecture et setlist

| Touche | Action |
| :--- | :--- |
| `Espace` (`Spazio`) | Play / Pause |
| `S` | Stop (rembobiner et arrêter) |
| `R` | Recommencer depuis 0:00 |
| `N` | Morceau suivant |
| `←` / `→` | Seek ±5 s |

### 10.2 Audio et DSP

| Touche | Action |
| :--- | :--- |
| `M` | Muet master |
| `↑` / `↓` | Volume ±5 % |
| `+` / `-` | Pitch ±1 demi-ton |
| `Ctrl+↑` / `Ctrl+↓` | Pitch ±1 demi-ton |
| `Ctrl+←` / `Ctrl+→` | Vitesse ±5 % |
| `V` | Suppression de la voix guide DSP (expérimental) |
| `D` | Auto-ducking BGM |

### 10.3 Navigation et écrans

| Touche | Action |
| :--- | :--- |
| `1` | Onglet File des chanteurs |
| `2` | Onglet Bibliothèque & Recherche |
| `3` | Onglet Historique SIAE |
| `Ctrl+F` | Ouvrir la Bibliothèque et focuser le champ de recherche |
| `P` | Rouvrir / focuser l’écran Stage |
| `F11` / `Esc` | Plein écran Stage (avec focus sur la scène) |
| `Esc` | Ferme aussi les modales/dialogues en Régie |
| `F1` / `?` | Guide des raccourcis |

Les info-bulles des commandes en Régie affichent les mêmes combinaisons pour un usage d’un coup d’œil.

---


Aussi dans Paramètres → Raccourcis et le panneau **?** / F1 (même inventaire) : Stop (`S`), Restart (`R`), flèches seek, Ctrl+flèches pour pitch/vitesse, Vocal remover expérimental (`V`), Ducking (`D`), onglets `1`/`2`/`3`, Stage (`P`), aide (`F1`/`?`). Plein écran Stage : `F11`/`Esc` sur la fenêtre Stage.

## 11. Guest Portal LAN

### 11.1 Activation

1. PC Régie sur le même Wi‑Fi que les invités.
2. Activez **Guest Portal LAN pour demandes depuis smartphone** (`Guest Portal LAN per Richieste da Smartphone`) dans les Réglages (port typique **3000**, repli 3001–3010 si occupé).
3. Ouvrez le QR Code depuis la barre Régie / demandes guest.
4. URL typique : `http://192.168.x.x:3000`.

### 11.2 Flux invité

1. Scannez le QR (iOS/Android, aucune app).
2. Recherchez dans le **catalogue local** (uniquement les morceaux réellement en bibliothèque ; pas de texte libre arbitraire).
3. Saisit nom et tonalité (typiquement de −4 à +4 demi-tons côté guest).
4. Envoie la demande.

### 11.3 Flux opérateur

- Badge **Demandes Guest** (`Richieste Guest`) en Régie.
- **Approuver** (`Approva`) → insertion en file (Fair Queue si actif) avec la tonalité demandée.
- **Refuser** (`Rifiuta`) → écarte sans toucher à la setlist.

### 11.4 Pare-feu et Wi‑Fi

Utilisez l’assistant intégré. Vérifiez aussi que sur le routeur l’**isolement AP / Client Isolation** est **désactivé**, sinon les smartphones n’atteignent pas le PC Régie tout en étant sur le même réseau.

---

## 12. Registre SIAE

Onglet **Historique** (`Storico`) (`3`) — **Historique des prestations** (`Storico Esecuzioni`) / borderò.

### 12.1 Quand une prestation est enregistrée

Un morceau entre dans le registre si :

1. il atteint la **fin naturelle**, ou  
2. il est arrêté/sauté (`S` / `N` / stop) après au moins **120 secondes** de lecture.

Sous 120 secondes (démarrage par erreur, essai, skip immédiat) il n’est **pas** enregistré.

### 12.2 Anti-doublons

Flag **`alreadyLogged`** sur l’instance en file : une seule ligne par prestation même si après 120 s il y a d’autres stop/next.

### 12.3 Données et export

- Persistance SQLite (`siae_logs`)
- **Horodatage ISO 8601** + epoch millisecondes
- Titre, artiste, chanteur, durée effective
- Filtre de recherche : titre / artiste / chanteur (insensible aux accents)
- **Exporter SIAE (CSV)** (`Esporta SIAE (CSV)`) avec colonnes date/heure ISO et horodatage
- **Vider l’historique** (`Svuota Storico`) avec confirmation de sécurité

Activez/désactivez la collecte avec **Registre SIAE automatique** (`Registro SIAE Automatico`) dans les Réglages.

---

## 13. Thèmes et langues (i18n)

### 13.1 Thèmes graphiques (9)

Thèmes indépendants pour Régie (`themeHost`) et Scène (`themeStage`) :

1. Dark Stage (Par défaut)  
2. Midnight Neon (Cyberpunk)  
3. Club Gold (VIP Lounge)  
4. Ocean Breeze (Deep Cyan)  
5. Sunset Crimson (Warm Red)  
6. Emerald Matrix (Live Green)  
7. Royal Amethyst (Deep Purple)  
8. High Contrast (Accessible)  
9. Light Studio (Clean)  

### 13.2 Langues

Interface complète en :

- **Italiano** (`it`)
- **English** (`en`)
- **Español** (`es`)
- **Français** (`fr`)

Au démarrage : détection de la langue système (autodetect) avec repli. Changement de langue dans **Réglages → Langue de l’interface** (`Impostazioni → Lingua Interfaccia`) sans redémarrage ; préférence persistante.

Les fichiers de traduction sont dans `locales/it.json`, `en.json`, `es.json`, `fr.json`.

---

## 14. Résolution des problèmes

### 14.1 Pare-feu / Guest Portal injoignable

1. Ouvrez Réglages → Assistant Pare-feu ; actualisez le diagnostic.
2. **Windows :** Autoriser l’app sur les réseaux privés ; si besoin, règle TCP ports 3000–3010 (`netsh` / PowerShell comme sur la carte).
3. **macOS :** Autoriser les connexions entrantes pour Karaoke Live Station (Pare-feu → Options).
4. **Linux :** `ufw allow 3000:3010/tcp` ou règle Firewalld équivalente (commandes copiables depuis la carte).
5. Vérifiez l’**isolement AP** du routeur = OFF.
6. Même sous-réseau Wi‑Fi entre PC et téléphones ; essayez l’URL affichée dans le QR depuis un navigateur du téléphone.

### 14.2 yt-dlp / téléchargements web ne fonctionnent pas

1. Vérifiez qu’existe `<userData>/bin/yt-dlp` (ou `.exe`).
2. Dans Réglages → Bibliothèque & Téléchargement : état du moteur et **Vérifier / Mettre à jour** (`Verifica / Aggiorna`).
3. Ne déplacez pas yt-dlp vers `/tmp` ni hors de `userData/bin/` : l’app ne gère que le chemin managed.
4. Consultez les logs dans `<userData>/logs/`.
5. Si vous voyez «Non installato (verrà scaricato automaticamente)» (texte d’UI en italien), attendez le bootstrap ou forcez la mise à jour avec réseau disponible.

### 14.3 Bibliothèque non configurée

Symptômes : impossible de télécharger/archiver ; message **«Imposta la cartella libreria nelle impostazioni prima di scaricare.»** (texte d’UI en italien) ; enregistrements qui échouent.

Solution : Réglages → **Cartella Libreria Karaoke** → Parcourir → dossier existant → Mettre à jour la bibliothèque. Ne vous fiez pas à un dossier caché `userData/library`.

### 14.4 Stage ne s’ouvre pas / reste noir

1. Appuyez sur **`P`** ou **Riapri Palco**.
2. Attendez le handshake ready (polices/CSS) ; évitez de forcer le contenu avant le signal ready.
3. Vérifiez que le second moniteur est actif dans le bureau étendu du SE.
4. Réessayez le plein écran (F11 / double-clic sur la Stage).
5. Si HDMI/projecteur se déconnecte, rétablissez le câble : l’app peut se rattacher ; en cas de doute, rouvrez la Stage.
6. Vérifiez de ne pas avoir démarré une seconde instance (single-instance : utilisez la Régie déjà ouverte).

### 14.5 Audio absent ou sur le mauvais périphérique

- Vérifiez **Master** et **CUE** dans les Réglages.
- Contrôlez le muet (`M`) et le volume (courbe quadratique : sous 50 % c’est déjà très bas).
- MIDI : confirmez SoundFont chargé.
- Suppression vocale DSP : effet immédiat et léger ; si le mix stéréo a peu de voix au centre, le résultat peut être minime — essayez un autre algorithme dans Paramètres → Audio.

### 14.6 Pitch / badge de vitesse sur la scène

- Si le chanteur ne voit pas les demi-tons : activez **Mostra variazione tonalità sullo schermo del palco**.
- S’il ne voit pas la vitesse : activez **Mostra velocità di riproduzione sullo schermo del palco**.
- Attendu : `+2`, `-1`, `0`, et p.ex. `1.00x` / `1.25x` selon la file.

### 14.7 Aperçu YouTube erreur 153

L’embed utilise déjà `youtube-nocookie` et les paramètres anti-153. Si cela persiste : mettez à jour l’app, vérifiez réseau/DNS, réessayez l’aperçu ; pour la soirée, téléchargez le morceau en local.

### 14.8 File / cache qui « disparaît » du disque

Avec l’archivage automatique **OFF**, les fichiers dans `queue_cache` sont supprimés au **retrait de file**. Pour les conserver : **Salva in Libreria** ou réactivez l’archivage automatique (défaut recommandé).

### 14.9 Journaux de diagnostic

Réglages → Diagnostic & fichiers de log : niveau, ouvrir dossier/fichier, effacer les logs. Utile pour les tickets de support (erreurs de streaming, yt-dlp, Stage).

---

## Annexe A — Chaînes UI italiennes de référence

| Contexte | Chaîne |
| :--- | :--- |
| Indication de file | Doppio click o Play per avviare |
| Téléchargement | Download completato |
| Avertissement auto-archive (titre) | Attenzione disattivazione archiviazione automatica |
| Avertissement auto-archive (corps) | Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata. |
| Erreur bibliothèque | Imposta la cartella libreria nelle impostazioni prima di scaricare. |
| Enregistrement | Salva in Libreria |
| Fair Queue | Fair Queue ATTIVO / Ripristina coda automatica |
| Stage | Ora Canta / Preparati / Prossima Esibizione |
| Onglets des réglages | Generale · Libreria & Download · Audio & Riproduzione · Schermo Stage · Scorciatoie |

---

## Annexe B — Valeurs par défaut opérationnelles

| Réglage | Défaut |
| :--- | :--- |
| Fair Queue | ON |
| Archivage automatique web | ON |
| Auto-avance au morceau suivant | OFF |
| Pause de transition | 3 s |
| showPitchOnStage | ON |
| showSpeedOnStage | ON |
| Port Guest Portal | 3000 |
| Seuil journal SIAE | ≥ 120 s ou fin naturelle |
| Plage pitch Régie | −8 … +8 ST |
| Plage vitesse | 0,50× … 1,50× |
| Thème | dark-stage |

---

## Licence

Karaoke Live Station est publié sous la **GNU Affero General Public License v3 (AGPLv3) ou toute version ultérieure**. Texte intégral : [`LICENSE`](./LICENSE).

---

*Fin du Manuel utilisateur — Karaoke Live Station (Phase 6, documentation FR).*

# 🎤 Karaoke Live Station v1.2.0 — Release Notes

<p align="center">
  <a href="#-italiano">🇮🇹 <strong>Italiano</strong></a> • <a href="#-english">🇬🇧 <strong>English</strong></a>
</p>

---

<a name="v120-italiano"></a>
# 🇮🇹 Note di Rilascio — Versione 1.2.0

Nuova release GitHub **v1.2.0** (tag dedicato; **non** sovrascrive `v1.1.0`): batch **#40–#44 + #46–#47** — Drag & Drop filesystem, scan libreria ~16k più reattivo, SoundFont AppImage + dropdown Altro, Safety-First slice 1, fix yt-dlp `--sub-langs`, rimozione toast «Download completato» e preselect Cantante assegnato. (#45 saltata)

## 📦 File di Installazione

| Piattaforma | File | Descrizione |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.2.0.exe` | Eseguibile portatile |
| **Windows** | `Karaoke Live Station-1.2.0-win.zip` | Archivio completo Windows 64-bit |
| **Linux** | `Karaoke Live Station-1.2.0.AppImage` | AppImage universale |
| **Linux** | `karaoke-live-station_1.2.0_amd64.deb` | Pacchetto Debian/Ubuntu |
| **macOS** | `Karaoke Live Station-1.2.0-arm64-mac.zip` | Bundle `.app` (Apple Silicon, build Actions) |

## 🌟 Novità di questa versione

### 📂 Libreria — file locali mancanti (USB / spostati)
- Prima di **mettere in coda** o **riprodurre**, verifica del path locale (`library:check-file-exists`).
- Se il file non esiste: azione bloccata, riga in rosso, modale **Elimina** / **Lascia in elenco** — nessuna cancellazione automatica.
- YouTube/remoto senza `localFilePath` salta il controllo. Stringhe IT/EN/ES/FR.

### 📂 Libreria — Drag & Drop da filesystem
- Trascina file karaoke (`.mp4` / `.webm` / `.mkv` / `.avi`, `.mp3`+`.cdg`, `.mid` / `.kar`) sulla **Libreria Locale** per catalogarli, o sulla **coda Regia** per importarli e metterli in scaletta.
- Pairing automatico `.mp3`↔`.cdg` (stesso basename); metadati `Artist - Title` con fallback Unknown Artist.
- Overlay solo per drop OS (`Files`); il riordino drag della coda resta invariato.
- Thumbnail video solo per i file video importati, con yield tra un file e l’altro sul multi-drop; upsert multipli in una transazione SQLite.

### ⚡ Libreria — scan grandi cataloghi (~16k)
- **Aggiorna Libreria** fa upsert batch in una sola transazione SQLite (prepared statements riusati).
- Niente FFmpeg sync per video sul thread principale: riusa thumb DB/cache; i thumb mancanti si generano in async (`execFile`) e aggiornano Local via `library:reindexed`.
- Il salvataggio singolo `download:save-to-library` genera ancora un thumb sync.

### 🎹 SoundFont — packaging AppImage + dropdown Impostazioni
- Seed di `GeneralUser-GS.sf2` in `<userData>/soundfonts/` (stabile tra remount AppImage); path `/tmp/.mount_*` trattati come effimeri.
- `extraResources` top-level spedisce `soundfonts` + `ort` **una sola volta** (i blocchi linux/win/mac aggiungono solo `bin/` — evita EEXIST/EBUSY).
- Impostazioni → Audio: elenco banche bundled/presenti; **Altro…** apre il file picker `.sf2` / `.sf3` (persiste `midiSoundFontPath`). Scheduler MIDI 5 ms / `latencyHint` invariati.

### 🛡️ Safety-First / Zero Regression (slice 1)
- Blocco **AI Context & Critical Invariants** in README (contratti IPC/Zustand/SQLite congelati + sei guardrail).
- Nuovo `scripts/verify-critical-invariants.js` + `verify-ai-vocal-path.js` in `npm test`.
- TSDoc / Why-comment sui path critici. **Nessun breaking change** di comportamento Control↔Stage.

### 📥 Scarica strumentale — `--sub-langs` yt-dlp + logging
- Sostituito `--sub-langs en.*,it.*,es.*,fr.*,*-orig` (regex invalida → `Wrong regex for subtitlelangs`) con un selettore valido; fallimenti yt-dlp / spawn anche sul Logger strutturato (`karaoke-station.log`).
- **Hotfix post-1.2.0 (in PR):** `all,-live_chat` richiedeva ~130 lingue sottotitolo → HTTP 429 YouTube. Ora `.*-orig` (solo auto-sub lingua originale; non usare `*-orig`).

### 🧹 UI Regia — toast e cantante
- Rimosso il badge overlay verde **Download completato**; stato/errori restano nel menu **Downloads**.
- Rimosso il campo preselect **Cantante assegnato…** da Libreria / Web: l’assegnazione avviene solo nel modal di enqueue (chrome Regia invariato).

## ✅ Baseline 1.1.0

Include tutto quanto già in **v1.1.0** (fix yt-dlp error -1, impostazioni UVR-MDX ETA, Interrompi ricerca, unwrap MessageEvent AI, scan ricorsivo, staging Instrumental, path `karaoke://local`, ecc.).

### 📜 Licenza
- Progetto sotto **GNU AGPLv3 or later** (`AGPL-3.0-or-later`).

---

<a name="v120-english"></a>
# 🇬🇧 Release Notes — Version 1.2.0

New GitHub release **v1.2.0** (dedicated tag; does **not** overwrite `v1.1.0`): batch **#40–#44 + #46–#47** — filesystem Drag & Drop, faster ~16k library scan, AppImage SoundFont seed + Settings Altro dropdown, Safety-First slice 1, yt-dlp `--sub-langs` fix, remove Download-completed overlay toast and assigned-singer preselect. (#45 skipped)

## 📦 Installers

| Platform | File | Description |
| :--- | :--- | :--- |
| **Windows** | `Karaoke Live Station 1.2.0.exe` | Portable executable |
| **Windows** | `Karaoke Live Station-1.2.0-win.zip` | Full Windows 64-bit archive |
| **Linux** | `Karaoke Live Station-1.2.0.AppImage` | Universal AppImage |
| **Linux** | `karaoke-live-station_1.2.0_amd64.deb` | Debian/Ubuntu package |
| **macOS** | `Karaoke Live Station-1.2.0-arm64-mac.zip` | `.app` bundle (Apple Silicon, Actions build) |

## 🌟 What’s new in this version

### 📂 Library — missing local files (USB / moved)
- Before **enqueue** or **play**, probes the local path (`library:check-file-exists`).
- If missing: action blocked, row marked red, **Delete** / **Keep in list** modal — never auto-deletes.
- Remote/YouTube without `localFilePath` skips the check. Strings IT/EN/ES/FR.

### 📂 Library — OS filesystem Drag & Drop
- Drop karaoke files (`.mp4` / `.webm` / `.mkv` / `.avi`, `.mp3`+`.cdg`, `.mid` / `.kar`) onto **Local Library** to catalog them, or onto the **Control queue** to import and enqueue.
- Automatic `.mp3`↔`.cdg` pairing (same basename); `Artist - Title` metadata with Unknown Artist fallback.
- Overlay only for OS `Files` drops; in-app queue reorder is unchanged.
- Video thumbnails only for imported video files, with yields between files on multi-drop; multi-row upsert in one SQLite transaction.

### ⚡ Library — large catalog scan (~16k)
- **Refresh Library** batch-upserts in a single SQLite transaction (reused prepared statements).
- No sync FFmpeg per video on the main thread: reuse DB/cache thumbs; missing thumbs generate asynchronously (`execFile`) and refresh Local via `library:reindexed`.
- Single-file `download:save-to-library` still generates a sync thumb.

### 🎹 SoundFont — AppImage packaging + Settings dropdown
- Seed `GeneralUser-GS.sf2` into `<userData>/soundfonts/` (stable across AppImage remounts); treat `/tmp/.mount_*` paths as ephemeral.
- Top-level `extraResources` ships `soundfonts` + `ort` **once** (platform blocks only add `bin/` — avoids EEXIST/EBUSY).
- Settings → Audio: list bundled/present banks; **Other…** opens `.sf2` / `.sf3` file picker (persists `midiSoundFontPath`). MIDI 5 ms scheduler / `latencyHint` unchanged.

### 🛡️ Safety-First / Zero Regression (slice 1)
- README **AI Context & Critical Invariants** block (frozen IPC/Zustand/SQLite contracts + six guardrails).
- New `scripts/verify-critical-invariants.js` and fold `verify-ai-vocal-path.js` into `npm test`.
- TSDoc / Why-comments on critical paths. **No Control↔Stage behavior breaking changes.**

### 📥 Download Instrumental — yt-dlp `--sub-langs` + logging
- Replaced invalid `--sub-langs en.*,it.*,es.*,fr.*,*-orig` (`Wrong regex for subtitlelangs`) with a valid selector; yt-dlp / spawn failures also write to the structured Logger (`karaoke-station.log`).
- **Post-1.2.0 hotfix (in PR):** `all,-live_chat` requested ~130 subtitle languages → YouTube HTTP 429. Now `.*-orig` (original-language auto-subs only; do not use bare `*-orig`).

### 🧹 Control UI — toast and singer
- Removed the green **Download completed** overlay badge; status/errors remain in the **Downloads** menu.
- Removed Library / Web **Assigned singer…** preselect; assignment happens only in the enqueue modal (Regia chrome unchanged).

## ✅ 1.1.0 baseline

Includes everything already in **v1.1.0** (yt-dlp error -1 fix, UVR-MDX ETA settings, Stop search, AI MessageEvent unwrap, recursive scan, Instrumental staging, `karaoke://local` path fix, etc.).

### 📜 License
- Project under **GNU AGPLv3 or later** (`AGPL-3.0-or-later`).

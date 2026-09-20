# Manual de usuario — Karaoke Live Station

**Karaoke Live Station** — estación profesional multiplataforma para DJ, KJ y locales de karaoke en vivo.  
Arquitectura: Electron, React 18, Web Audio DSP, síntesis SoundFont/MIDI, Guest Portal LAN (Express), catálogo SQLite.

Este documento es el manual operativo completo (Fases 1–5) en **español**. Destinado al operador en la cabina de control (Regia).

---

## Índice

1. [Panorama y arquitectura](#1-panorama-y-arquitectura)
2. [Instalación y rutas portátiles](#2-instalación-y-rutas-portátiles)
3. [Configuración inicial](#3-configuración-inicial)
4. [Consola de Regia](#4-consola-de-regia)
5. [Cola Fair Queue, VIP y caché](#5-cola-fair-queue-vip-y-caché)
6. [Biblioteca: búsqueda, descargas y vistas previas](#6-biblioteca-búsqueda-descargas-y-vistas-previas)
7. [Pantalla Stage (Escenario)](#7-pantalla-stage-escenario)
8. [Avance automático y pausa de transición](#8-avance-automático-y-pausa-de-transición)
9. [Ajustes por pestañas y búsqueda](#9-ajustes-por-pestañas-y-búsqueda)
10. [Atajos de teclado](#10-atajos-de-teclado)
11. [Guest Portal LAN](#11-guest-portal-lan)
12. [Registro SIAE](#12-registro-siae)
13. [Temas e idiomas (i18n)](#13-temas-e-idiomas-i18n)
14. [Resolución de problemas](#14-resolución-de-problemas)

---

## 1. Panorama y arquitectura

Karaoke Live Station gestiona una noche de karaoke con **dos ventanas independientes** más un portal de invitados en la red local.

### 1.1 Ventana de Regia (Control — Master)

Consola completa del operador:

- Transport (Play / Pausa / Stop / Reiniciar / Siguiente)
- Volumen master con curva perceptiva
- Pitch en semitonos y velocidad (time-stretch)
- Eliminación de voz guía **(Algoritmo Básico)** mediante DSP clásico mid/side (algorítmico, tiempo real)
- Auto-ducking BGM al micrófono
- Mezclador MIDI/KAR de 16 canales
- Preescucha CUE en dispositivo secundario
- Cola de cantantes (Fair Queue), Biblioteca y búsqueda, Historial SIAE
- Gestión de solicitudes del Guest Portal

### 1.2 Ventana Stage / Pantalla de escenario (Slave)

Pantalla para cantante y público (TV o proyector):

- Vídeo MP4/WebM/MKV, gráficos CD+G, letras MIDI/KAR
- Audio de Stage **silenciado** (el audio sale solo de Regia / Master)
- Sincronización vía IPC con Regia
- Banners «Ora Canta», «Preparati», «Prossima Esibizione» (textos de UI en italiano)
- Badge de semitonos configurable (`showPitchOnStage`)
- Badge de velocidad configurable (`showSpeedOnStage`)
- Pantalla completa (F11 / Esc / doble clic)

### 1.3 Guest Portal LAN

Servidor web integrado (Express + Socket.IO) en la Wi‑Fi del local. Los invitados escanean un código QR y envían solicitudes desde el teléfono sin instalar ninguna app.

### 1.4 Instancia única (Single Instance Lock)

La aplicación permite **una sola instancia** en ejecución. Un segundo arranque se bloquea: el proceso nuevo muestra un diálogo (**«Software ya en ejecución»** / equivalentes IT/EN/FR), luego termina, y la ventana de Regia ya abierta se restaura y recibe el foco. Evita dobles Regias, conflictos de audio y puertos Guest Portal duplicados.

### 1.5 Flujo de audio / vídeo en síntesis

1. Regia posee el transport y el grafo Web Audio.
2. Los medios locales pasan por el protocolo `karaoke://local/` con streaming por rangos de bytes (HTTP 206), de modo que Stage puede abrirse/cerrarse a mitad de tema sin desincronizar.
3. Pitch, velocidad, eliminador de voz DSP (experimental), ducking, normalización y routing CUE viven en el grafo de audio de Regia.
4. MIDI/KAR: parsing → SpessaSynth + SoundFont → mezclador de 16 canales.
5. El avance de cola y el registro SIAE se gestionan en el store; Stage recibe el estado vía IPC.

---

## 2. Instalación y rutas portátiles

### 2.1 Sistemas admitidos

- **Linux** (Ubuntu/Debian, Fedora, Arch y similares)
- **Windows** 10/11 de 64 bits
- **macOS** 11+ (Apple Silicon e Intel)

Recomendado: escritorio extendido a **dos monitores** (Regia + Escenario) y, si es posible, interfaz de audio USB multi-salida para separar Master y auriculares CUE.

### 2.2 Carpeta de datos de la aplicación (`userData`)

Todos los datos gestionados por la app viven bajo la carpeta Electron `userData` (no en `/tmp`):

| Plataforma | Ruta típica |
| :--- | :--- |
| Linux | `~/.config/karaoke-live-station/` (o nombre de app XDG equivalente) |
| macOS | `~/Library/Application Support/<App>/` |
| Windows | `%APPDATA%\<App>\` |

Contenidos relevantes:

| Ruta relativa | Contenido |
| :--- | :--- |
| `karaoke_station.db` | Base de datos SQLite (catálogo, cantantes, log SIAE) en modo WAL |
| `bin/` | Binarios gestionados, en particular **yt-dlp** |
| `temp/` | Descargas en curso |
| `queue_cache/` | Archivos web no archivados en la biblioteca, persistentes mientras estén en cola |
| `thumbnails/` | Miniaturas generadas |
| `logs/` | Logs de diagnóstico |

### 2.3 Binarios gestionados en `<userData>/bin/`

**yt-dlp** (y otros binarios gestionados) se instalan y actualizan en:

```text
<userData>/bin/yt-dlp      (Linux / macOS)
<userData>/bin/yt-dlp.exe  (Windows)
```

Comportamiento operativo:

1. Al arrancar la app siempre prefiere la copia en `userData/bin/`.
2. Si falta o está corrupta, puede **sembrar** (seed) desde el paquete instalado hacia `userData/bin/`.
3. Verificación de integridad (tamaño mínimo, ejecutabilidad, probe `--version`).
4. Actualizaciones desde GitHub Releases solo si falta o existe una versión más reciente (no vuelve a descargar en cada arranque).
5. Instalación atómica en `userData/bin/` (archivo temporal sibling, luego sustitución); en Windows, gestión segura de archivos bloqueados.

**ffmpeg** se resuelve desde paquete/bundle/PATH para miniaturas y conversiones; yt-dlp sigue siendo el motor de búsqueda/descarga web.

En **Ajustes → Biblioteca y descarga** (`Impostazioni → Libreria & Download`) puedes ver el estado/versión de yt-dlp y usar **Verificar / Actualizar** (`Verifica / Aggiorna` en la UI italiana).

### 2.4 Biblioteca multimedia del usuario

La carpeta multimedia **no** es un `userData/library` de respaldo silencioso: es la ruta **obligatoria** `libraryPath` elegida por el operador (a menudo `~/Karaoke` o `C:\Users\<Usuario>\Karaoke`). Todos los guardados y el archivado automático usan exclusivamente esa ruta.

---

## 3. Configuración inicial

Al arrancar, si `libraryPath` falta o no existe en disco, aparece el asistente guiado (diálogos **no modales** respecto al parent Chromium, para no suspender el audio).

### 3.1 Carpeta Biblioteca Karaoke (obligatoria)

1. Abre **Ajustes** (icono de engranaje).
2. Pestaña **Biblioteca y descarga** (`Libreria & Download`).
3. Opción **Carpeta Biblioteca Karaoke** (`Cartella Libreria Karaoke`) → **Examinar...** (`Sfoglia...`).
4. Elige la carpeta con los archivos karaoke (`.mp4`, `.mp3`+`.cdg`, `.mid`, `.kar`, etc.).

Sin carpeta configurada:

- las descargas con archivado automático activo se bloquean con el mensaje:  
  **«Imposta la cartella libreria nelle impostazioni prima di scaricare.»** (texto de UI en italiano)
- «Salva in Libreria» sigue exigiendo una ruta válida.

Tras la elección, la app puede escanear e indexar los archivos en la base de datos. Usa **Actualizar biblioteca** (`Aggiorna Libreria`) para un reescaneo manual.

**Escaneo recursivo:** **Actualizar biblioteca** recorre **todas las subcarpetas** bajo `libraryPath` (omite directorios basura como `.git` / `node_modules`). Los árboles Artista/Álbum anidados se indexan; la deduplicación de descargas también busca en el árbol completo para no volver a descargar archivos ya presentes.

### 3.2 Banco SoundFont (.sf2)

Para MIDI/KAR:

1. Pestaña **Audio y reproducción** (`Audio & Riproduzione`) (o General, según la búsqueda de ajustes).
2. **Ruta del banco SoundFont (.sf2)** (`Percorso Banco SoundFont (.sf2)`).
3. Por defecto se incluye un SoundFont GeneralUser GS; elígelo en el desplegable o **Otro** (`Altro`) para un `.sf2` externo.

**Nota AppImage / portable:** el banco se siembra en `userData/soundfonts/` (no en la ruta efímera `/tmp/.mount_*` de AppImage). Tras actualizar el AppImage, si el MIDI está mudo abre Ajustes una vez para que se recalcule la ruta.

Si no está configurado, la interfaz puede mostrar **«Nessun SoundFont (.sf2) configurato»** (texto de UI en italiano).

### 3.3 Dispositivos de audio Master y CUE

| Ajuste | Uso |
| :--- | :--- |
| **Dispositivo de salida principal (Master escenario)** (`Dispositivo Uscita Principale (Master Palco)`) | PA / altavoces de sala |
| **Dispositivo de salida de preescucha (Auriculares CUE)** (`Dispositivo Uscita Pre-ascolto (Cuffie CUE)`) | Auriculares del operador para vistas previas sin molestar a la sala |

Configúralos antes del evento. El CUE usa el routing `setSinkId` en la tarjeta secundaria.

### 3.4 Cortafuegos (Guest Portal)

En la primera ejecución autoriza Karaoke Live Station en el cortafuegos (redes **privadas**). En Ajustes está el **Asistente de cortafuegos y conexión LAN** (`Assistente Firewall & Connessione LAN`) con diagnóstico y comandos listos (Windows / macOS / Linux UFW / Firewalld). Véase también la [sección de resolución de problemas](#14-resolución-de-problemas).

### 3.5 Lista de comprobación rápida previa al evento

1. `libraryPath` configurado y biblioteca actualizada  
2. SoundFont OK (si usas MIDI)  
3. Master + CUE correctos  
4. Stage abierto en el segundo monitor (`P` / **Reabrir escenario** / `Riapri Palco`)  
5. Guest Portal activo y cortafuegos OK (si usas solicitudes desde smartphone)  
6. Fair Queue y opciones de auto-avance según preferencia  

---

## 4. Consola de Regia

La Regia está organizada en tres pestañas principales a la derecha: **Cola de cantantes** (`Coda Cantanti`) (`1`), **Biblioteca y búsqueda** (`Libreria & Ricerca`) (`2`), **Historial** (`Storico`) (`3`). El reproductor y los controles de audio permanecen siempre disponibles arriba/en el centro.

### 4.1 Transport

| Control | Atajo | Comportamiento |
| :--- | :--- | :--- |
| Reproducir / Pausa | `Espacio` (`Spazio`) | Inicia o pone en pausa el tema cargado |
| Stop | `S` | Detiene, rebobina a 0:00, para DSP/MIDI |
| Reiniciar | `R` | Vuelve a 0:00 sin quitar el tema de la cola |
| Siguiente tema | `N` | Evalúa el log SIAE y pasa al siguiente |
| Seek | `←` / `→` o scrubber | ±5 segundos; Stage se realinea |

**Inicio desde la cola:** en el primer tema (o con doble clic) aparece la pista:

> **Doppio click o Play per avviare** (texto de UI en italiano)

Puedes iniciar/pausar con el botón Play de la primera fila, o hacer doble clic en un tema de la cola.

**Guardar en biblioteca:** si el tema proviene de la web o de `queue_cache`, aparece **Salva in Libreria** en la fila de cola y en la cabecera del reproductor, para promoverlo a la carpeta permanente de biblioteca.

### 4.2 Volumen perceptivo

El deslizador de Volumen Master usa una curva **cuadrática psicoacústica**:

\[
Gain = volume^2 \quad (volume\ de\ 0\ a\ 1)
\]

Ejemplos: 100% → ganancia plena; 50% → ganancia 0,25 (−12 dB aprox., mitad de volumen percibido); 0% → silencio.

- Las variaciones usan una **rampa anti-click ~50 ms** (sin “golpe” en los altavoces).
- **Mudo** (`M`): silencia el master manteniendo la posición del fader.
- Flechas `↑` / `↓`: volumen ±5%.
- Opcional: **Normalización de volumen de audio** (`Normalizzazione Volume Audio`) (nivelación automática entre temas distintos).

### 4.3 Pitch (semitonos) y velocidad

- **Tonalidad:** de **−8 a +8** semitonos (`+` / `-` o `Ctrl+↑` / `Ctrl+↓`). Junto a los controles de Regia aparece la **clave musical** detectada (`Am→Bm` si se transpone) o el marcador «—» si aún no se conoce.
- Chips **Key / BPM** también en las filas de Biblioteca y Cola (siempre visibles; marcador si faltan).
- Junto al tempo aparece el valor BPM con la etiqueta **BPM** (o «— BPM» si es desconocido).
- El pitch está ligado a la **instancia en cola** (y a la memoria de tonalidad del cantante): permanece memorizado para esa actuación.
- A 0 semitonos el motor puede omitir el shifter (latencia/CPU mínimas).
- **Velocidad:** depende del motor (por defecto **Bungee** ~0,50×–1,50×; **SoundTouch** ~0,75×–1,25× en UI). `Ctrl+←` / `Ctrl+→` ajustan ±5%. Un clic en el indicador numérico suele restaurar 1,00×.
- **Motor DSP (Ajustes → Audio):** **Bungee** (predeterminado) — pitch + time-stretch de calidad vía Wasm AudioWorklet; el `playbackRate` del media se queda en 1,0 mientras Bungee estira. **SoundTouch** — WSOLA clásico; el `playbackRate` del elemento guía el tempo. A **0 ST y 1,00×** el grafo omite el shifter (latencia mínima). MIDI/KAR siempre usa la transposición de notas SpessaSynth (no Bungee/SoundTouch).
- MIDI: la transposición actúa sobre los números de nota en tiempo real.

### 4.4 Eliminación de voz guía (Algoritmo Básico)

La tecla **`V`** / el control **Eliminar Voz Guía (Algoritmo Básico)** activa el método elegido en **Ajustes → Audio**:

| Método | Notas |
| --- | --- |
| `centerCancelBassKeep` / `centerCancel` / `softMid` | DSP mid/side **en tiempo real** — ligero, sin descarga |

En resultados de búsqueda YouTube, **Descargar Instrumental** (si el título no contiene ya “Karaoke” o “instrumental”) descarga el vídeo, aplica el **Método Descargar Instrumental** de **Ajustes → Librería y descarga** (IA offline como UVR-MDX-NET Karaoke 2) y guarda un MP4 instrumental (incrusta subtítulos si hay). Antes de cada descarga la app puede preguntar si descargar subtítulos automáticos de YouTube; marca **Recordar mi elección** para omitir el aviso la próxima vez. Puedes cambiar o borrar esa preferencia en cualquier momento en **Ajustes → Librería y descarga → Subtítulos Descargar Instrumental** (`Preguntar cada vez` / `Siempre` / `Nunca`). Con UVR-MDX-NET seleccionado aparece **Ajustes avanzados UVR-MDX-NET (optimización ETA)** bajo ese menú: tamaño de segmento, solapamiento y aceleración CPU ONNX Runtime — solo para esa ruta MDX.

### 4.5 Auto-ducking BGM

**Auto-Ducking BGM** (`D`): baja automáticamente la música de fondo cuando detecta/activas el micrófono para anuncios, luego restaura el nivel. Ideal para presentaciones entre un tema y otro.

### 4.6 Mezclador MIDI de 16 canales

Con archivos `.mid` / `.kar` aparece el **Mezclador de canales MIDI** (`Mixer Canali MIDI`):

- Actividad de notas en tiempo real
- Mute por canal (p. ej. **Voz guía (Ch 4)** / `Guida Vocale (Ch 4)`, **Bajo (Ch 2)** / `Basso (Ch 2)`, **Batería (Ch 10)** / `Batteria (Ch 10)`)
- Cambios en caliente sin interrumpir la síntesis SpessaSynth

### 4.7 Preescucha CUE

Usa **Preescucha en auriculares (CUE)** (`Pre-ascolto Cuffie (CUE)`) para escuchar en auriculares mientras la sala oye el Master. Configura el dispositivo CUE en Ajustes.

En **Biblioteca**, el botón Preescucha abre el **modal de vista previa** (mismo estilo que Ajustes) y enruta el audio al dispositivo CUE. No hay barra de volumen aparte: silencio/volumen quedan en los controles del reproductor embebido (o transporte MIDI). Si CUE y Salida Principal coinciden, al quitar el silencio aparece un aviso de confirmación para no mezclar la previa en el PA de sala — incluido el **embed de YouTube de la búsqueda Web**, que usa el mismo modal temático que vídeo/audio/MIDI locales.

### 4.8 Persistencia de cola y anti-crash

La escaleta (temas, cantantes, tonalidades, posiciones) se guarda en persistencia local. Tras un cierre o un crash, al reabrir la cola vuelve con el primer tema listo en pausa a 0:00.

---

## 5. Cola Fair Queue, VIP y caché

### 5.1 Fair Queue (por defecto ON)

**Algoritmo Fair Queue activo** (`Algoritmo Fair Queue Attivo`) está **habilitado por defecto** (`enableFairQueue: true`).

Calcula la posición según:

- número de temas ya cantados por el participante
- hora de la solicitud

Objetivo: evitar que pocos cantantes monopolicen la noche. Quien ha cantado menos sube en prioridad.

Con Fair Queue activo, al insertar puedes elegir:

- **Posición automática (Fair Queue)** (`Posizione automatica (Fair Queue)`) — el algoritmo coloca el tema
- **Al final de la cola** (`In fondo alla coda`) — último puesto fijo

**Restaurar cola automática** (`Ripristina coda automatica`) recalcula el orden ideal tras drag & drop o anulaciones manuales (útil si `queue.length > 2`).

### 5.2 VIP y gestión manual

- **Prioridad VIP:** fuerza prioridad para invitados especiales / celebraciones.
- **Drag & Drop (reordenar):** reordena las entradas en espera; el tema en reproducción permanece bloqueado en cabeza.
- **Drop de archivos OS (importar):** suelta archivos multimedia en el panel **Cola** o **Biblioteca** para catalogarlos (mp4/webm/mkv/avi, mp3+cdg, mid/kar) vía `library.importFiles`. El drop en Cola también los encola. El DnD de reordenación usa índices de texto y **no** captura los drops de archivos OS.
- **Asignar cantante** (`Assegna Cantante`) / gestión de cantantes: nombres únicos (control sin distinción de mayúsculas) para que Fair Queue funcione correctamente.
- **Memoria de tonalidad del cantante:** vuelve a proponer la tonalidad preferida cuando el tema entra en reproducción.
- **Vaciar cola:** requiere confirmación (**«Sei sicuro di voler svuotare l'intera scaletta della coda?»** — texto de UI en italiano); detiene la reproducción.

### 5.3 Archivado automático y `queue_cache`

| Ajuste | Por defecto | Efecto |
| :--- | :--- | :--- |
| **Archivado automático de descargas web en biblioteca** (`Archiviazione Automatica Download Web in Libreria`) | **ON** | Las descargas van a la biblioteca permanente (`libraryPath`) |
| OFF (tras confirmación) | — | Las descargas permanecen en `<userData>/queue_cache/` |

Al desactivar el archivado aparece el modal obligatorio:

**Título:** «Attenzione disattivazione archiviazione automatica» (texto de UI en italiano)

**Texto:**  
«Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata.» (texto de UI en italiano)

Confirma con **Confirmar desactivación** (`Conferma disattivazione`).

### 5.4 Persistencia de caché y Garbage Collection

- Los archivos en `queue_cache` **sobreviven a los reinicios** si el tema sigue en cola.
- **GC al sacar de cola:** el archivo se borra del disco solo cuando ninguna entrada de cola lo referencia (fin de actuación, eliminación individual, vaciar cola).
- **Salva in Libreria** promueve el archivo de la caché a la carpeta de biblioteca y actualiza rutas/`uri` para uso sin conexión.
- Deduplicación de descargas: antes de volver a descargar, la app busca coincidencias en biblioteca / `queue_cache` / catálogo (id de YouTube, fingerprint, `Artista - Título`). En caso de acierto: el aviso **«Brano già presente in locale...»** (texto localizado) aparece en el menú **Descargas** (no como toast fuera de la cola), sin nueva descarga de red.

---

## 6. Biblioteca: búsqueda, descargas y vistas previas

Pestaña **Biblioteca y búsqueda** (`Libreria & Ricerca`) (`2` o `Ctrl+F`).

### 6.1 Búsqueda local en vivo

- Modo **Local** (ámbito independiente de la búsqueda Web)
- Filtro **continuo** mientras escribes (`onChange`) sobre título, artista, código
- Coincidencia **sin distinguir mayúsculas/minúsculas ni acentos** (p. ej. `moriro da re` encuentra `morirò da re`)
- Estados vacíos distintos:
  - **«Libreria vuota. Scansiona una cartella o cerca sul web.»** (texto de UI en italiano)
  - **«Nessun brano corrisponde alla ricerca locale.»** (texto de UI en italiano)
- **Actualizar biblioteca** (`Aggiorna Libreria`) vuelve a escanear `libraryPath` y actualiza el catálogo SQLite
- Consulta, resultados, carga y scroll de **Local** y **Web** quedan **separados** (ámbitos independientes): cambiar de pestaña no pierde estado ni lanza búsquedas YouTube no deseadas; persistencia en `sessionStorage` durante la sesión; las pestañas derechas siguen montadas (ocultas)

### 6.2 Búsqueda web (YouTube)

- Modo **Web / YouTube** (ámbito independiente de la búsqueda Local)
- Escribe y pulsa **Intro** (`Invio`) (no busca en cada tecla)
- Motor: **yt-dlp** desde `<userData>/bin/`
- Placeholder: **«Cerca brano su YouTube Karaoke...»** (texto de UI en italiano)
- Vacío: **«Nessun risultato web. Digita e premi Invio per cercare su YouTube.»** (texto de UI en italiano)

### 6.3 Vista previa de YouTube (anti error 153)

El modal de vista previa incrusta el vídeo desde `youtube-nocookie.com` con parámetros anti-bloqueo:

- `playsinline=1`
- `enablejsapi=1`
- `origin` y `widget_referrer` (origen de la ventana)
- `rel=0`
- `modestbranding=1`
- `referrerPolicy="strict-origin-when-cross-origin"`
- autoplay silenciado en vista previa
- confirmación de unmute mismo dispositivo (CUE === Salida Principal) vía YouTube IFrame API + modal temático

Esto reduce el error de embed **153** típico de los iframes restrictivos de YouTube.

Con **archivado automático** ON, **Añadir a cola** desde YouTube espera descarga + guardado en biblioteca, luego ejecuta una **reindexación Local completa** (miniatura ffmpeg incluida) **antes** de encolar el archivo local — así el tema aparece en Local con la portada correcta sin «Actualizar biblioteca» manual.

### 6.4 Descarga y badge «Download completato»

1. Inicia la descarga desde el resultado web.
2. Progreso en **Descarga en curso** (`Download in Corso`).
3. Al completar (tras un breve retraso ~450 ms desde la lista de progresos) aparece el badge descartable:

> **Download completato** (texto de UI en italiano)

Ciérralo con la **X** manual.

4. Si auto-archive está ON y `libraryPath` es válido → archivo en biblioteca + reindexación inmediata.  
5. Si auto-archive está OFF → archivo en `queue_cache` (promovible con **Salva in Libreria**).  
6. Errores: toast persistente **«Download fallito: …»** (texto de UI en italiano).
7. **Añadir a la cola desde YouTube con archivado automático ON**: la app espera a que el download **y** el archivo tengan éxito, actualiza Local y luego encola el **archivo local de la biblioteca** (no un puntero remoto/temp). Si falla, toast de error y **ningún** elemento no reproducible en cola.

Portadas/miniaturas y vistas previas locales se actualizan sin reiniciar (ffmpeg extrae un fotograma ~al segundo 4 para archivos locales; YouTube proporciona thumbs web).

### 6.5 Vistas previas / portadas y versiones

- Miniaturas 16:9 en la lista
- Chip de versión (p. ej. KaraFun, Sing King, Con coros, Instrumental…)
- Clic en miniatura / icono de vista previa → **Vista previa y control de versión** (`Anteprima e Controllo Versione`) con scrubber, ruta de archivo, añadir a cola y asignar cantante
- Con Fair Queue activo, elección de posición Fair vs al final también desde la vista previa
- El botón **Preescucha** abre el mismo modal temático con audio en el dispositivo CUE (véase §4.7)

### 6.6 Eliminar de la biblioteca

En los temas del catálogo local está **Eliminar de la biblioteca** (`Elimina dalla libreria`), con confirmación (**«Eliminare il brano?»**). La acción:

1. Quita la fila del catálogo SQLite.
2. Borra del disco **solo** los archivos permanentes bajo la carpeta de biblioteca (`libraryPath`); no borra archivos en `queue_cache` / `temp` / descargas incompletas.

Tras confirmar aparece un toast de resultado (éxito o error).

---

## 7. Pantalla Stage (Escenario)

### 7.1 Handshake ready

Stage se abre oculto (`show: false`) con fondo negro. Antes de mostrarse:

1. Espera fuentes y hojas de estilo
2. Doble `requestAnimationFrame`
3. Señaliza `signalStageReady()` al proceso main

El proceso main **coloca Stage en el monitor externo** (TV/proyector) cuando está disponible y entra a pantalla completa; con una sola pantalla permanece una ventana centrada para no cubrir la Regia. Reabrir / `P` vuelve a colocarla.

Así no aparece un flash de layout bruto. Si cierras Stage, **Reabrir escenario** (`Riapri Palco`) o la tecla **`P`** lo recrea y resincroniza. Cerrar Regia también cierra Stage.

### 7.2 Badge de semitonos y `showPitchOnStage`

Ajuste **Mostrar variación de tonalidad en la pantalla del escenario** (`Mostra variazione tonalità sullo schermo del palco`) (`showPitchOnStage`, por defecto típicamente ON):

- Muestra el badge con el offset en semitonos: **`+N`**, **`-N`** o **`0`**
- El valor **0** se visualiza igualmente cuando el interruptor está activo (el cantante ve que no hay transposición)
- Descripción de UI: «Visualizza il badge con i semitoni di variazione (+/-) sullo schermo del palco per il cantante.» (texto de UI en italiano)

### 7.2a Fondos personalizados de los mensajes del escenario

En **Ajustes → Pantalla de escenario**, cada mensaje superpuesto puede definir texto/estilo/activación y un **fondo del escenario (color o imagen) solo mientras el mensaje es visible**. Al ocultarse (o si se desactiva), se restaura el fondo normal de tema/vídeo sin reiniciar.

### 7.2b Badge de velocidad y `showSpeedOnStage`

Ajuste **Mostrar velocidad de reproducción en la pantalla del escenario** (`Mostra velocità di riproduzione sullo schermo del palco`) (`showSpeedOnStage`, por defecto típicamente ON):

- Muestra el badge **Velocidad** con multiplicador (p. ej. **`1.00x`**, **`1.25x`**) y BPM efectivo
- El overlay de título también muestra el chip `N.NNx` junto a Key/BPM
- Descripción UI: «Visualizza il badge della velocità di riproduzione (es. 1.00x, 1.25x) sullo schermo del palco per il cantante.» (texto de UI en italiano)

### 7.3 Pantalla completa y layout

- **`F11`** / **`Esc`** con foco en Stage
- Doble clic (o dos clics rápidos) para pantalla completa sin bordes
- Vídeo de borde a borde; título/artista flotante que desaparece (duración configurable, típicamente 8 s)
- Barra de progreso fina en el borde inferior
- Banners: **Ora Canta**, **Preparati**, **Prossima Esibizione** / **A seguire** (textos de UI en italiano; tiempos en Ajustes → Pantalla Stage)

### 7.4 Contenidos admitidos en el escenario

- Vídeo karaoke (MP4/WebM/MKV)
- CD+G / MP3+G (Canvas)
- MIDI/KAR con letras sincronizadas (audio desde Regia)

---

## 8. Avance automático y pausa de transición

| Ajuste | Por defecto | Notas |
| :--- | :--- | :--- |
| **Avance automático al siguiente tema** (`Avanzamento Automatico al Prossimo Brano`) (`autoAdvanceNext`) | **OFF** | El operador decide cuándo arrancar el siguiente |
| **Pausa de transición entre temas (s)** (`Pausa Transizione Brani (Sec)`) (`transitionPauseSec`) | **3** | Activa/útil cuando el auto-avance está ON |

### Comportamiento con auto-avance OFF (por defecto)

Al final natural del tema la cola pasa al siguiente **en pausa a 0:00**. El operador pulsa Play (o usa «Doppio click o Play per avviare») para continuar. Ideal en noche en vivo para anuncios y micrófono.

### Comportamiento con auto-avance ON

Tras el final (y tras la eventual cuenta atrás **«Prossimo brano tra Xs...»** basada en `transitionPauseSec` — texto de UI en italiano) arranca automáticamente el tema siguiente.

---

## 9. Ajustes por pestañas y búsqueda

Abre **Ajustes del sistema** (`Impostazioni di Sistema`) (engranaje). Arriba: campo **«Cerca impostazioni...»** (texto de UI en italiano).

### 9.1 Pestañas

| Pestaña | Contenidos típicos |
| :--- | :--- |
| **General** (`Generale`) | Temas Regia/Escenario, idioma, Fair Queue, Guest Portal, SIAE, soporte del proyecto |
| **Biblioteca y descarga** (`Libreria & Download`) | `libraryPath`, archivado automático (+ aviso), estado/actualización de yt-dlp |
| **Audio y reproducción** (`Audio & Riproduzione`) | SoundFont, Master/CUE, sync A/V, normalización, **algoritmo de eliminación de voz (experimental)**, vocal remover/ducking por defecto, auto-avance, `transitionPauseSec` |
| **Pantalla Stage** (`Schermo Stage`) | Banners intro/outro, overlay de título, siguiente cantante en intro, **`showPitchOnStage`**, **`showSpeedOnStage`**, **fondos personalizados de mensajes Stage** |
| **Atajos** (`Scorciatoie`) | Inventario completo de atajos en vivo (misma lista que el panel **?** / F1), con búsqueda |

La búsqueda filtra etiquetas/descripciones **entre todas las categorías** (incluida Atajos en **paridad** con la guía **?**); al vaciar el campo vuelves a la navegación por pestañas. Ningún ajuste se elimina por la reorganización en pestañas.

### 9.2 Otras opciones útiles

- Offset de sincronización audio/vídeo (ms)
- Duración del banner de intro / disparador outro «Preparati»
- Duración del título en pantalla
- Mostrar el siguiente cantante al inicio del tema
- Nivel de log de diagnóstico y apertura de carpeta/archivo de log
- Exportar registro SIAE (CSV) también desde ajustes, además del Historial

Guarda con **Guardar y cerrar** (`Salva e Chiudi`).

---

## 10. Atajos de teclado

Abre la guía en cualquier momento con **`F1`** o **`?`**. Los atajos en vivo se registran con **cleanup** al desmontar el componente (ningún listener huérfano tras cerrar modales / cambiar de vista).

### 10.1 Reproducción y escaleta

| Tecla | Acción |
| :--- | :--- |
| `Espacio` (`Spazio`) | Play / Pausa |
| `S` | Stop (rebobinar y parar) |
| `R` | Reiniciar desde 0:00 |
| `N` | Siguiente tema |
| `←` / `→` | Seek ±5 s |

### 10.2 Audio y DSP

| Tecla | Acción |
| :--- | :--- |
| `M` | Mudo master |
| `↑` / `↓` | Volumen ±5% |
| `+` / `-` | Pitch ±1 semitono |
| `Ctrl+↑` / `Ctrl+↓` | Pitch ±1 semitono |
| `Ctrl+←` / `Ctrl+→` | Velocidad ±5% |
| `V` | Eliminación de voz guía DSP (experimental) |
| `D` | Auto-ducking BGM |

### 10.3 Navegación y pantallas

| Tecla | Acción |
| :--- | :--- |
| `1` | Pestaña Cola de cantantes |
| `2` | Pestaña Biblioteca y búsqueda |
| `3` | Pestaña Historial SIAE |
| `Ctrl+F` | Abrir Biblioteca y enfocar el campo de búsqueda |
| `P` | Reabrir / enfocar pantalla Stage |
| `F11` / `Esc` | Pantalla completa Stage (con foco en el escenario) |
| `Esc` | También cierra modales/diálogos en Regia |
| `F1` / `?` | Guía de atajos |

Los tooltips de los controles en Regia muestran las mismas combinaciones para uso a simple vista.

---


También en Ajustes → Atajos y el panel **?** / F1 (mismo inventario): Stop (`S`), Restart (`R`), flechas de seek, Ctrl+flechas para tono/velocidad, Vocal remover experimental (`V`), Ducking (`D`), pestañas `1`/`2`/`3`, Stage (`P`), ayuda (`F1`/`?`). Pantalla completa Stage: `F11`/`Esc` en la ventana Stage.

## 11. Guest Portal LAN

### 11.1 Activación

1. PC de Regia en la misma Wi‑Fi que los invitados.
2. Activa **Guest Portal LAN para solicitudes desde smartphone** (`Guest Portal LAN per Richieste da Smartphone`) en Ajustes (puerto típico **3000**, fallback 3001–3010 si está ocupado).
3. Abre el código QR desde la barra de Regia / solicitudes guest.
4. URL típica: `http://192.168.x.x:3000`.

### 11.2 Flujo del invitado

1. Escanea el QR (iOS/Android, sin app).
2. Busca en el **catálogo local** (solo temas realmente en biblioteca; sin texto libre arbitrario).
3. Introduce nombre y tonalidad (típicamente de −4 a +4 semitonos en el lado guest).
4. Envía la solicitud.

### 11.3 Flujo del operador

- Badge **Solicitudes Guest** (`Richieste Guest`) en Regia.
- **Aprobar** (`Approva`) → inserción en cola (Fair Queue si está activo) con la tonalidad solicitada.
- **Rechazar** (`Rifiuta`) → descarta sin tocar la escaleta.

### 11.4 Cortafuegos y Wi‑Fi

Usa el asistente integrado. Verifica también que en el router el **aislamiento AP / Client Isolation** esté **desactivado**; de lo contrario los smartphones no alcanzan el PC de Regia pese a estar en la misma red.

---

## 12. Registro SIAE

Pestaña **Historial** (`Storico`) (`3`) — **Historial de actuaciones** (`Storico Esecuzioni`) / borderò.

### 12.1 Cuándo se registra una actuación

Un tema entra en el registro si:

1. alcanza el **final natural**, o  
2. se detiene/salta (`S` / `N` / stop) tras al menos **120 segundos** de reproducción.

Por debajo de 120 segundos (arranque por error, prueba, skip inmediato) **no** se registra.

### 12.2 Anti-duplicados

Flag **`alreadyLogged`** en la instancia de cola: una sola fila por actuación aunque tras los 120 s haya más stop/next.

### 12.3 Datos y exportación

- Persistencia SQLite (`siae_logs`)
- **Timestamp ISO 8601** + epoch en milisegundos
- Título, artista, cantante, duración efectiva
- Filtro de búsqueda: título / artista / cantante (insensible a acentos)
- **Exportar SIAE (CSV)** (`Esporta SIAE (CSV)`) con columnas de fecha/hora ISO y timestamp
- **Vaciar historial** (`Svuota Storico`) con confirmación de seguridad

Activa/desactiva la recogida con **Registro SIAE automático** (`Registro SIAE Automatico`) en Ajustes.

---

## 13. Temas e idiomas (i18n)

### 13.1 Temas gráficos (10)

Temas independientes para Regia (`themeHost`) y Escenario (`themeStage`):

1. Dark Stage (Predeterminado)  
2. Midnight Neon (Cyberpunk)  
3. Club Gold (VIP Lounge)  
4. Ocean Breeze (Deep Cyan)  
5. Sunset Crimson (Warm Red)  
6. Emerald Matrix (Live Green)  
7. Royal Amethyst (Deep Purple)  
8. High Contrast (Accesible)  
9. Light Studio (Clean)  
10. Studio Desk (Diseño Regia) — **opt-in**: al seleccionarlo como tema Regia activa el shell Studio; cualquier otro tema Regia restaura el diseño clásico.  

### 13.2 Idiomas

Interfaz completa en:

- **Italiano** (`it`)
- **English** (`en`)
- **Español** (`es`)
- **Français** (`fr`)

Al arrancar: detección del idioma del sistema (autodetect) con fallback. Cambio de idioma en **Ajustes → Idioma de la interfaz** (`Impostazioni → Lingua Interfaccia`) sin reinicio; preferencia persistente.

Los archivos de traducción están en `locales/it.json`, `en.json`, `es.json`, `fr.json`.

---

## 14. Resolución de problemas

### 14.1 Cortafuegos / Guest Portal no alcanzable

1. Abre Ajustes → Asistente de cortafuegos; actualiza el diagnóstico.
2. **Windows:** Permitir la app en redes privadas; si hace falta, regla TCP puertos 3000–3010 (`netsh` / PowerShell como en la tarjeta).
3. **macOS:** Permitir conexiones entrantes para Karaoke Live Station (Cortafuegos → Opciones).
4. **Linux:** `ufw allow 3000:3010/tcp` o regla Firewalld equivalente (comandos copiables desde la tarjeta).
5. Verifica **aislamiento AP** del router = OFF.
6. Misma subred Wi‑Fi entre PC y teléfonos; prueba la URL del QR desde un navegador del teléfono.

### 14.2 yt-dlp / descargas web no funcionan

1. Comprueba que exista `<userData>/bin/yt-dlp` (o `.exe`).
2. En Ajustes → Biblioteca y descarga: estado del motor y **Verificar / Actualizar** (`Verifica / Aggiorna`).
3. No muevas yt-dlp a `/tmp` ni fuera de `userData/bin/`: la app solo gestiona la ruta managed.
4. Revisa los logs en `<userData>/logs/`.
5. Si ves «Non installato (verrà scaricato automaticamente)» (texto de UI en italiano), espera el bootstrap o fuerza la actualización con red disponible.

### 14.3 Biblioteca no configurada

Síntomas: imposible descargar/archivar; mensaje **«Imposta la cartella libreria nelle impostazioni prima di scaricare.»** (texto de UI en italiano); guardados que fallan.

Solución: Ajustes → **Cartella Libreria Karaoke** → Examinar → carpeta existente → Actualizar biblioteca. No confíes en una carpeta oculta `userData/library`.

### 14.4 Stage no se abre / permanece negro

1. Pulsa **`P`** o **Riapri Palco**.
2. Espera el handshake ready (fuentes/CSS); evita forzar contenidos antes de la señal ready.
3. Verifica que el segundo monitor esté activo en el escritorio extendido del SO.
4. Reintenta pantalla completa (F11 / doble clic en Stage).
5. Si se desconecta HDMI/proyector, restaura el cable: la app puede reengancharse; en duda, reabre Stage.
6. Comprueba que no hayas arrancado una segunda instancia (single-instance: usa la Regia ya abierta).

### 14.5 Audio ausente o en el dispositivo equivocado

- Verifica **Master** y **CUE** en Ajustes.
- Comprueba mudo (`M`) y volumen (curva cuadrática: por debajo del 50% ya es muy bajo).
- MIDI: confirma SoundFont cargado.
- Eliminación de voz DSP: efecto inmediato y ligero; si el mix stereo tiene poca voz al centro, el resultado puede ser mínimo — prueba otro algoritmo en Ajustes → Audio.

### 14.6 Pitch / badge de velocidad en el escenario

- Si el cantante no ve los semitonos: activa **Mostra variazione tonalità sullo schermo del palco**.
- Si no ve la velocidad: activa **Mostra velocità di riproduzione sullo schermo del palco**.
- Esperado: `+2`, `-1`, `0`, y p. ej. `1.00x` / `1.25x` según la cola.

### 14.7 Vista previa de YouTube error 153

El embed ya usa `youtube-nocookie` y los parámetros anti-153. Si persiste: actualiza la app, verifica red/DNS, reintenta la vista previa; para la noche descarga el tema en local.

### 14.8 Cola / caché que “desaparece” del disco

Con archivado automático **OFF**, los archivos en `queue_cache` se eliminan al **sacar de cola**. Para conservarlos: **Salva in Libreria** o reactiva el archivado automático (valor por defecto recomendado).

### 14.9 Logs de diagnóstico

Ajustes → Diagnóstico y archivos de log: nivel, abrir carpeta/archivo, borrar logs. Útil para tickets de soporte (errores de streaming, yt-dlp, Stage).

---

## Apéndice A — Cadenas de UI italianas de referencia

| Contexto | Cadena |
| :--- | :--- |
| Pista de cola | Doppio click o Play per avviare |
| Descarga | Download completato |
| Aviso auto-archivo (título) | Attenzione disattivazione archiviazione automatica |
| Aviso auto-archivo (cuerpo) | Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata. |
| Error de biblioteca | Imposta la cartella libreria nelle impostazioni prima di scaricare. |
| Guardado | Salva in Libreria |
| Fair Queue | Fair Queue ATTIVO / Ripristina coda automatica |
| Stage | Ora Canta / Preparati / Prossima Esibizione |
| Pestañas de ajustes | Generale · Libreria & Download · Audio & Riproduzione · Schermo Stage · Scorciatoie |

---

## Apéndice B — Valores predeterminados operativos

| Ajuste | Por defecto |
| :--- | :--- |
| Fair Queue | ON |
| Archivado automático web | ON |
| Auto-avance al siguiente tema | OFF |
| Pausa de transición | 3 s |
| showPitchOnStage | ON |
| showSpeedOnStage | ON |
| Puerto Guest Portal | 3000 |
| Umbral de log SIAE | ≥ 120 s o final natural |
| Rango de pitch Regia | −8 … +8 ST |
| Rango de velocidad | 0,50× … 1,50× |
| Tema | dark-stage |

---

## Licencia

Karaoke Live Station se publica bajo la **GNU Affero General Public License v3 (AGPLv3) o cualquier versión posterior**. Texto completo: [`LICENSE`](./LICENSE).

---

*Fin del Manual de usuario — Karaoke Live Station (Fase 6, documentación ES).*

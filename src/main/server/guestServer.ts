import http from 'http';
import fs from 'fs';
import path from 'path';
import express, { Express, Request, Response } from 'express';
import { Server as SocketIOServer, Socket } from 'socket.io';
import os from 'os';
import QRCode from 'qrcode';
import { GuestSongRequest, QueueItem, ActivePlaybackState, KaraokeMediaTrack } from '../../shared/types';

/**
 * Callback contracts invoked by the embedded Guest Portal server.
 */
export interface GuestServerCallbacks {
  /** Invoked when a mobile smartphone guest submits a song request */
  onRequestReceived: (request: GuestSongRequest) => void;
  /** Supplies the sanitized public queue for guests */
  getPublicQueue: () => QueueItem[];
  /** Supplies current playback status for the mobile UI */
  getPlaybackState: () => ActivePlaybackState;
  /** Supplies available catalog tracks from the local library */
  getLibraryTracks: () => KaraokeMediaTrack[];
}

/**
 * Embedded HTTP and WebSocket server (Express + Socket.IO) running on the local LAN network.
 * Provides a responsive mobile web interface allowing guests to scan a QR code,
 * view the real-time queue, select their pitch preference, and request songs.
 */
export class GuestPortalServer {
  private app: Express;
  private server: http.Server | null = null;
  private io: SocketIOServer | null = null;
  private port: number;
  private callbacks: GuestServerCallbacks;
  private localIpAddress: string = '127.0.0.1';
  private qrCodeDataUrl: string = '';

  constructor(port: number, callbacks: GuestServerCallbacks) {
    this.port = port;
    this.callbacks = callbacks;
    this.app = express();
    this.resolveLocalIp();
    this.setupRoutes();
  }

  /**
   * Scans local network adapters to find the host machine's primary LAN IPv4 address.
   * Explicitly filters out virtual, container, and VPN bridges (Docker, Libvirt/QEMU, VirtualBox, VMware)
   * and prioritizes physical Wi-Fi and Ethernet adapters.
   */
  public resolveLocalIp(): string {
    const interfaces = os.networkInterfaces();
    const candidates: { name: string; ip: string; priority: number }[] = [];

    for (const name of Object.keys(interfaces)) {
      const lowerName = name.toLowerCase();
      // Exclude container, virtual bridge, tunnel, and loopback adapters
      if (
        lowerName.includes('docker') ||
        lowerName.includes('virbr') ||
        lowerName.includes('vbox') ||
        lowerName.includes('vmnet') ||
        lowerName.includes('br-') ||
        lowerName.includes('veth') ||
        lowerName.includes('tun') ||
        lowerName.includes('tap') ||
        lowerName.includes('tailscale') ||
        lowerName.includes('wg')
      ) {
        continue;
      }

      const netList = interfaces[name];
      if (!netList) continue;

      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          let priority = 10;
          if (lowerName.startsWith('wl') || lowerName.includes('wifi') || lowerName.includes('wlan')) {
            priority = 100;
          } else if (lowerName.startsWith('en') || lowerName.startsWith('eth') || lowerName.includes('lan')) {
            priority = 90;
          } else if (net.address.startsWith('192.168.')) {
            priority = 80;
          } else if (net.address.startsWith('10.')) {
            priority = 70;
          }
          candidates.push({ name, ip: net.address, priority });
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.priority - a.priority);
      this.localIpAddress = candidates[0].ip;
      return this.localIpAddress;
    }

    // Fallback: search all available non-internal IPv4 interfaces
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          this.localIpAddress = net.address;
          return this.localIpAddress;
        }
      }
    }

    this.localIpAddress = '127.0.0.1';
    return this.localIpAddress;
  }

  /**
   * Returns the actual bound network port currently used by the server.
   */
  public getActualPort(): number {
    return this.port;
  }

  /**
   * Returns the resolved LAN IP address.
   */
  public getLocalIp(): string {
    this.resolveLocalIp();
    return this.localIpAddress;
  }

  /**
   * Generates the public LAN URL for the guest portal using the dynamically resolved IP.
   */
  public getPortalUrl(): string {
    this.resolveLocalIp();
    return `http://${this.localIpAddress}:${this.port}`;
  }

  /**
   * Generates or returns the cached base64 QR Code data URL pointing to the portal.
   */
  public async getQrCode(): Promise<string> {
    const portalUrl = this.getPortalUrl();
    if (this.qrCodeDataUrl) return this.qrCodeDataUrl;
    try {
      this.qrCodeDataUrl = await QRCode.toDataURL(portalUrl, {
        margin: 2,
        width: 300,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });
      return this.qrCodeDataUrl;
    } catch (err) {
      console.error('Failed to generate QR Code:', err);
      return '';
    }
  }

  /**
   * Configures Express middleware, API endpoints, and serves the mobile web client HTML.
   */
  private setupRoutes(): void {
    this.app.use(express.json());

    // Serve application logo for the guest portal
    this.app.get('/logo.png', (_req: Request, res: Response) => {
      const candidates = [
        path.join(process.cwd(), 'public/logo.png'),
        path.join(__dirname, '../../public/logo.png'),
        path.join(__dirname, '../../../public/logo.png'),
        process.resourcesPath ? path.join(process.resourcesPath, 'public/logo.png') : '',
        process.resourcesPath ? path.join(process.resourcesPath, 'logo.png') : ''
      ].filter(Boolean);

      for (const p of candidates) {
        if (fs.existsSync(p)) {
          return res.sendFile(p);
        }
      }
      res.status(404).end();
    });

    // API endpoint for queue status
    this.app.get('/api/queue', (_req: Request, res: Response) => {
      const currentQueue = this.callbacks.getPublicQueue();
      const playback = this.callbacks.getPlaybackState();
      res.json({
        queue: currentQueue.map((item) => ({
          title: item.track.title,
          artist: item.track.artist,
          singer: item.assignedSingerName || 'Anonymous',
          isNowPlaying: item.track.id === playback.currentTrackId
        })),
        isPlaying: playback.isPlaying,
        currentTime: playback.currentTime
      });
    });

    // API endpoint for retrieving or searching available library catalog songs
    this.app.get('/api/songs', (req: Request, res: Response) => {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const allTracks = this.callbacks.getLibraryTracks();
      const sanitized = allTracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        durationSec: t.durationSec,
        source: t.source
      }));

      if (!q) {
        res.json({ total: allTracks.length, songs: sanitized.slice(0, 100) });
        return;
      }

      const filtered = sanitized.filter(
        (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
      );
      res.json({ total: allTracks.length, songs: filtered.slice(0, 100) });
    });

    // API endpoint for submitting a request
    this.app.post('/api/request', (req: Request, res: Response) => {
      const { singerName, trackId, preferredPitch } = req.body;

      if (!singerName || !String(singerName).trim()) {
        res.status(400).json({ error: 'Inserisci il tuo nome o gruppo' });
        return;
      }

      if (!trackId) {
        res.status(400).json({ error: 'Seleziona un brano dalla libreria karaoke' });
        return;
      }

      const allTracks = this.callbacks.getLibraryTracks();
      const matchedTrack = allTracks.find((t) => t.id === trackId);

      if (!matchedTrack) {
        res.status(400).json({ error: 'Il brano selezionato non è presente nella libreria karaoke' });
        return;
      }

      const newRequest: GuestSongRequest = {
        requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        singerName: String(singerName).trim(),
        trackId: matchedTrack.id,
        trackTitle: matchedTrack.title,
        trackArtist: matchedTrack.artist,
        sourceUri: matchedTrack.uri,
        requestedAt: Date.now(),
        preferredPitch: typeof preferredPitch === 'number' ? Math.max(-8, Math.min(8, preferredPitch)) : 0,
        status: 'pending'
      };

      this.callbacks.onRequestReceived(newRequest);
      res.json({ success: true, request: newRequest });
    });

    // Embedded mobile guest Web App HTML
    this.app.get('*', (_req: Request, res: Response) => {
      res.send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Karaoke Live Station - Guest Portal</title>
  <link rel="icon" type="image/png" href="/logo.png">
  <link rel="apple-touch-icon" href="/logo.png">
  <style>
    :root { --bg: #090d16; --card: #131b2e; --accent: #6366f1; --accent-hover: #4f46e5; --text: #f8fafc; --sub: #94a3b8; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 1rem; }
    header { text-align: center; padding: 1.5rem 0 1rem; }
    h1 { font-size: 1.4rem; color: #fff; font-weight: 800; letter-spacing: -0.5px; }
    p.sub { font-size: 0.85rem; color: var(--sub); margin-top: 0.25rem; }
    .card { background: var(--card); border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; border: 1px solid rgba(255,255,255,0.06); }
    h2 { font-size: 1.05rem; margin-bottom: 0.75rem; color: #cbd5e1; }
    label { display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; color: var(--sub); margin-top: 0.75rem; margin-bottom: 0.35rem; }
    input, select, button { width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: #0b1120; color: #fff; font-size: 0.95rem; }
    input:focus { outline: none; border-color: var(--accent); }
    button { background: var(--accent); font-weight: 700; border: none; margin-top: 1.25rem; cursor: pointer; transition: opacity 0.2s; }
    button:active { opacity: 0.8; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .badge-count { font-size: 0.7rem; background: rgba(99, 102, 241, 0.2); color: #a5b4fc; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
    
    /* Search & Song Picker */
    .search-container { position: relative; width: 100%; }
    .search-dropdown {
      position: relative;
      max-height: 220px;
      overflow-y: auto;
      background: #070c17;
      border: 1px solid rgba(99, 102, 241, 0.4);
      border-radius: 8px;
      margin-top: 6px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.6);
      z-index: 10;
    }
    .search-item {
      padding: 0.7rem 0.85rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: background 0.15s;
    }
    .search-item:last-child { border-bottom: none; }
    .search-item:active, .search-item:hover { background: rgba(99, 102, 241, 0.22); }
    .search-item .item-title { font-size: 0.9rem; font-weight: 700; color: #fff; }
    .search-item .item-artist { font-size: 0.78rem; color: #a5b4fc; }
    .search-empty { padding: 1rem; text-align: center; color: var(--sub); font-size: 0.82rem; font-style: italic; }

    /* Selected Song Card */
    .selected-song-card {
      background: rgba(99, 102, 241, 0.14);
      border: 1px solid #6366f1;
      border-radius: 8px;
      padding: 0.75rem 0.9rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .selected-song-info { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
    .selected-song-icon { font-size: 1.4rem; flex-shrink: 0; }
    .selected-song-text { display: flex; flex-direction: column; min-width: 0; }
    .selected-song-text strong { font-size: 0.92rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .selected-song-text span { font-size: 0.8rem; color: #818cf8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btn-change-song {
      width: auto !important;
      margin-top: 0 !important;
      padding: 0.45rem 0.85rem !important;
      font-size: 0.75rem !important;
      font-weight: 600 !important;
      background: #1e293b !important;
      border: 1px solid rgba(255,255,255,0.15) !important;
      border-radius: 6px !important;
      color: #e2e8f0 !important;
      flex-shrink: 0;
    }

    .queue-item { display: flex; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem; }
    .queue-item:last-child { border-bottom: none; }
    .badge { background: rgba(99, 102, 241, 0.2); color: #818cf8; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; }
    #msg { margin-top: 0.75rem; font-size: 0.85rem; text-align: center; }
  </style>
</head>
<body>
  <header style="display: flex; flex-direction: column; align-items: center; padding: 1.25rem 0 1rem;">
    <img src="/logo.png" alt="Karaoke Live Station" style="width: 76px; height: 76px; object-fit: contain; margin-bottom: 0.75rem; filter: drop-shadow(0 4px 18px rgba(99, 102, 241, 0.5));">
    <h1>Karaoke Live Station</h1>
    <p class="sub">Prenota il tuo brano dal tuo smartphone</p>
  </header>

  <div class="card">
    <h2>Prenota la tua Canzone</h2>
    <form id="reqForm">
      <label for="singer">Il Tuo Nome / Nome Gruppo</label>
      <input type="text" id="singer" required placeholder="Es. Marco & Sara">

      <label>
        <span>Seleziona Canzone dalla Libreria</span>
        <span id="libBadge" class="badge-count">Caricamento...</span>
      </label>

      <!-- Picker Container -->
      <div id="songPicker">
        <div id="searchBoxContainer" class="search-container">
          <input type="text" id="songSearch" placeholder="🔍 Cerca per titolo o artista..." autocomplete="off">
          <div id="searchResults" class="search-dropdown" style="display: none;"></div>
        </div>

        <div id="selectedSongCard" class="selected-song-card" style="display: none;">
          <div class="selected-song-info">
            <span class="selected-song-icon">🎵</span>
            <div class="selected-song-text">
              <strong id="selectedTitle"></strong>
              <span id="selectedArtist"></span>
            </div>
          </div>
          <button type="button" id="btnChangeSong" class="btn-change-song">Cambia</button>
        </div>
      </div>
      <input type="hidden" id="selectedTrackId" value="">

      <label for="pitch">Tonalità Vocale Desiderata</label>
      <select id="pitch">
        <option value="-4">-4 Semitoni (Molto più bassa)</option>
        <option value="-3">-3 Semitoni</option>
        <option value="-2">-2 Semitoni</option>
        <option value="-1">-1 Semitono</option>
        <option value="0" selected>Tonalità Originale (0)</option>
        <option value="1">+1 Semitono</option>
        <option value="2">+2 Semitoni</option>
        <option value="3">+3 Semitoni</option>
        <option value="4">+4 Semitoni (Molto più alta)</option>
      </select>

      <button type="submit" id="btnSubmit">Invia Richiesta in Regia</button>
      <div id="msg"></div>
    </form>
  </div>

  <div class="card">
    <h2>Scaletta in Tempo Reale</h2>
    <div id="queueList"><p class="sub">Caricamento scaletta...</p></div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    let initialSongs = [];
    let selectedSong = null;

    // 1. Scaletta in tempo reale
    async function loadQueue() {
      try {
        const res = await fetch('/api/queue');
        const data = await res.json();
        const container = document.getElementById('queueList');
        if (!data.queue || data.queue.length === 0) {
          container.innerHTML = '<p class="sub">Nessun cantante in coda. Sii il primo!</p>';
          return;
        }
        container.innerHTML = data.queue.map(item => \`
          <div class="queue-item">
            <div>
              <strong>\${item.title}</strong> - \${item.artist}<br>
              <span class="sub">Cantante: \${item.singer}</span>
            </div>
            \${item.isNowPlaying ? '<span class="badge">SUL PALCO</span>' : ''}
          </div>
        \`).join('');
      } catch (err) {
        console.error(err);
      }
    }

    socket.on('queue:updated', () => loadQueue());
    loadQueue();

    // 2. Caricamento catalogo libreria
    async function initLibrary() {
      try {
        const res = await fetch('/api/songs');
        const data = await res.json();
        initialSongs = data.songs || [];
        const total = typeof data.total === 'number' ? data.total : initialSongs.length;
        document.getElementById('libBadge').textContent = total > 0 ? (total + ' brani') : '0 brani';
      } catch (err) {
        console.error('Failed to load songs:', err);
        document.getElementById('libBadge').textContent = 'Errore libreria';
      }
    }
    initLibrary();

    // 3. Ricerca e selezione brano
    const songSearch = document.getElementById('songSearch');
    const searchResults = document.getElementById('searchResults');
    const searchBoxContainer = document.getElementById('searchBoxContainer');
    const selectedSongCard = document.getElementById('selectedSongCard');
    const selectedTitle = document.getElementById('selectedTitle');
    const selectedArtist = document.getElementById('selectedArtist');
    const selectedTrackId = document.getElementById('selectedTrackId');
    const btnChangeSong = document.getElementById('btnChangeSong');
    let debounceTimer = null;

    function renderSearchResults(songs) {
      if (!songs || songs.length === 0) {
        searchResults.innerHTML = '<div class="search-empty">Nessun brano trovato nella libreria</div>';
        searchResults.style.display = 'block';
        return;
      }
      searchResults.innerHTML = songs.map(s => \`
        <div class="search-item" data-id="\${s.id}">
          <span class="item-title">\${s.title}</span>
          <span class="item-artist">\${s.artist}</span>
        </div>
      \`).join('');
      searchResults.style.display = 'block';

      searchResults.querySelectorAll('.search-item').forEach(el => {
        el.addEventListener('click', () => {
          const songId = el.getAttribute('data-id');
          const found = songs.find(s => s.id === songId);
          if (found) selectSong(found);
        });
      });
    }

    function selectSong(song) {
      selectedSong = song;
      selectedTrackId.value = song.id;
      selectedTitle.textContent = song.title;
      selectedArtist.textContent = song.artist;
      searchBoxContainer.style.display = 'none';
      searchResults.style.display = 'none';
      selectedSongCard.style.display = 'flex';
      document.getElementById('msg').textContent = '';
    }

    function clearSongSelection() {
      selectedSong = null;
      selectedTrackId.value = '';
      selectedSongCard.style.display = 'none';
      searchBoxContainer.style.display = 'block';
      songSearch.value = '';
      songSearch.focus();
    }

    btnChangeSong.addEventListener('click', clearSongSelection);

    songSearch.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = songSearch.value.trim();
      debounceTimer = setTimeout(async () => {
        if (!q) {
          renderSearchResults(initialSongs);
          return;
        }
        try {
          const res = await fetch('/api/songs?q=' + encodeURIComponent(q));
          const data = await res.json();
          renderSearchResults(data.songs || []);
        } catch (err) {
          console.error(err);
        }
      }, 150);
    });

    songSearch.addEventListener('focus', () => {
      const q = songSearch.value.trim();
      if (!q) {
        renderSearchResults(initialSongs);
      } else {
        searchResults.style.display = 'block';
      }
    });

    // Chiudi dropdown se si tocca all'esterno
    document.addEventListener('click', (e) => {
      if (!songSearch.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
      }
    });

    // 4. Invio richiesta
    document.getElementById('reqForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('msg');

      if (!selectedSong || !selectedTrackId.value) {
        msg.textContent = 'Seleziona prima una canzone dalla libreria!';
        msg.style.color = '#f87171';
        return;
      }

      msg.textContent = 'Invio in corso...';
      msg.style.color = '#94a3b8';
      const body = {
        singerName: document.getElementById('singer').value,
        trackId: selectedTrackId.value,
        preferredPitch: parseInt(document.getElementById('pitch').value, 10)
      };

      try {
        const res = await fetch('/api/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const result = await res.json();
        if (result.success) {
          msg.textContent = 'Richiesta inviata con successo alla regia!';
          msg.style.color = '#34d399';
          clearSongSelection();
        } else {
          msg.textContent = result.error || 'Errore durante l\\'invio';
          msg.style.color = '#f87171';
        }
      } catch (err) {
        msg.textContent = 'Errore di connessione al server locale';
        msg.style.color = '#f87171';
      }
    });
  </script>
</body>
</html>`);
    });
  }

  /**
   * Starts the HTTP and Socket.IO server, automatically trying adjacent ports if in use.
   */
  public async start(): Promise<void> {
    const tryListen = (port: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        const srv = http.createServer(this.app);
        const ioServer = new SocketIOServer(srv, {
          cors: { origin: '*' }
        });

        srv.once('error', (err: NodeJS.ErrnoException) => {
          srv.close();
          ioServer.close();
          if (err.code === 'EADDRINUSE' && port < 3020) {
            console.log(`[GuestPortal] Port ${port} in use, trying ${port + 1}...`);
            this.port = port + 1;
            this.qrCodeDataUrl = '';
            tryListen(this.port).then(resolve).catch(reject);
          } else {
            reject(err);
          }
        });

        srv.listen(port, '0.0.0.0', () => {
          this.server = srv;
          this.io = ioServer;
          this.io.on('connection', (socket: Socket) => {
            socket.emit('queue:updated', { queue: this.callbacks.getPublicQueue() });
          });
          console.log(`[GuestPortal] Running on http://${this.localIpAddress}:${this.port}`);
          resolve();
        });
      });
    };

    await tryListen(this.port);
  }

  /**
   * Broadcasts a 'queue:updated' event to all connected guest smartphone clients.
   */
  public notifyQueueChanged(): void {
    if (this.io) {
      this.io.emit('queue:updated', {
        queue: this.callbacks.getPublicQueue()
      });
    }
  }

  /**
   * Gracefully shuts down the Socket.IO and HTTP server.
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.io) {
        this.io.close();
        this.io = null;
      }
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

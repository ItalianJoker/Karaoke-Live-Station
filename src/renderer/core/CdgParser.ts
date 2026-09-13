/**
 * CD+G (CDG) Graphics Protocol Decoder for Canvas Rendering
 * Decodes standard 300x216 CDG Subcode Packets (24 bytes per packet, 75 packets per second of audio)
 */
export class CdgParser {
  public static readonly CDG_WIDTH = 300;
  public static readonly CDG_HEIGHT = 216;

  private buffer: Uint8Array;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pColorTable: number[] = new Array(16).fill(0); // 16 RGBA colors
  private pPixels: Uint8Array = new Uint8Array(CdgParser.CDG_WIDTH * CdgParser.CDG_HEIGHT);
  private lastPacketIndex: number = 0;

  constructor(cdgBuffer: ArrayBuffer, canvas: HTMLCanvasElement) {
    this.buffer = new Uint8Array(cdgBuffer);
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cannot get 2d context for CDG canvas');
    this.ctx = context;
    this.canvas.width = CdgParser.CDG_WIDTH;
    this.canvas.height = CdgParser.CDG_HEIGHT;
    this.reset();
  }

  public reset(): void {
    this.pColorTable.fill(0);
    this.pPixels.fill(0);
    this.lastPacketIndex = 0;
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, CdgParser.CDG_WIDTH, CdgParser.CDG_HEIGHT);
  }

  /**
   * Syncs and renders the CDG graphics up to currentTimeSec.
   * Standard CDG stream runs at 300 packets/sec (4 sectors/sec * 75 packets/sector).
   */
  public renderAtTime(timeSec: number): void {
    const totalPackets = Math.floor(this.buffer.length / 24);
    const targetPacketIndex = Math.min(totalPackets, Math.floor(timeSec * 300));

    if (targetPacketIndex < this.lastPacketIndex) {
      // Seek backwards detected -> Reset and decode up to target
      this.reset();
    }

    while (this.lastPacketIndex < targetPacketIndex) {
      const offset = this.lastPacketIndex * 24;
      this.processPacket(offset);
      this.lastPacketIndex++;
    }

    this.drawToCanvas();
  }

  private processPacket(offset: number): void {
    const command = this.buffer[offset] & 0x3f;
    if (command !== 0x09) return; // CDG SubCode Command

    const instruction = this.buffer[offset + 1] & 0x3f;
    const data = this.buffer.subarray(offset + 4, offset + 20);

    switch (instruction) {
      case 1: // Memory Preset
        this.cmdMemoryPreset(data);
        break;
      case 2: // Border Preset
        this.cmdBorderPreset(data);
        break;
      case 6: // Tile Block Normal
        this.cmdTileBlock(data, false);
        break;
      case 38: // Tile Block XOR
        this.cmdTileBlock(data, true);
        break;
      case 30: // Load Color Table (0..7)
        this.cmdLoadColorTable(data, 0);
        break;
      case 31: // Load Color Table (8..15)
        this.cmdLoadColorTable(data, 8);
        break;
      default:
        break;
    }
  }

  private cmdMemoryPreset(data: Uint8Array): void {
    const color = data[0] & 0x0f;
    this.pPixels.fill(color);
  }

  private cmdBorderPreset(data: Uint8Array): void {
    const color = data[0] & 0x0f;
    // Set border pixels (outer 12 pixels top/bottom/left/right)
    for (let y = 0; y < CdgParser.CDG_HEIGHT; y++) {
      for (let x = 0; x < CdgParser.CDG_WIDTH; x++) {
        if (x < 6 || x >= CdgParser.CDG_WIDTH - 6 || y < 12 || y >= CdgParser.CDG_HEIGHT - 12) {
          this.pPixels[y * CdgParser.CDG_WIDTH + x] = color;
        }
      }
    }
  }

  private cmdTileBlock(data: Uint8Array, isXor: boolean): void {
    const color0 = data[0] & 0x0f;
    const color1 = data[1] & 0x0f;
    const row = data[2] & 0x1f;
    const col = data[3] & 0x3f;

    const startX = col * 6;
    const startY = row * 12;

    if (startX + 6 > CdgParser.CDG_WIDTH || startY + 12 > CdgParser.CDG_HEIGHT) return;

    for (let y = 0; y < 12; y++) {
      const byte = data[4 + y] & 0x3f;
      for (let x = 0; x < 6; x++) {
        const bit = (byte >> (5 - x)) & 1;
        const color = bit ? color1 : color0;
        const pixelIndex = (startY + y) * CdgParser.CDG_WIDTH + (startX + x);

        if (isXor) {
          this.pPixels[pixelIndex] ^= color;
        } else {
          this.pPixels[pixelIndex] = color;
        }
      }
    }
  }

  private cmdLoadColorTable(data: Uint8Array, startIndex: number): void {
    for (let i = 0; i < 8; i++) {
      const colorVal = ((data[i * 2] & 0x3f) << 6) | (data[i * 2 + 1] & 0x3f);
      // Format: 4-bit Red, 4-bit Green, 4-bit Blue
      const r = ((colorVal >> 8) & 0x0f) * 17;
      const g = ((colorVal >> 4) & 0x0f) * 17;
      const b = (colorVal & 0x0f) * 17;
      // Store 32-bit RGBA integer
      this.pColorTable[startIndex + i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  }

  private drawToCanvas(): void {
    const imgData = this.ctx.createImageData(CdgParser.CDG_WIDTH, CdgParser.CDG_HEIGHT);
    const buf32 = new Uint32Array(imgData.data.buffer);

    for (let i = 0; i < this.pPixels.length; i++) {
      const colorIdx = this.pPixels[i] & 0x0f;
      buf32[i] = this.pColorTable[colorIdx];
    }

    this.ctx.putImageData(imgData, 0, 0);
  }
}

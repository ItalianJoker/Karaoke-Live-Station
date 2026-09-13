import { MidiLyricEvent, MidiParsedSong, MidiParsedTrackInfo } from '../../shared/types';

/**
 * Represents a parsed MIDI event scheduled at an absolute millisecond timestamp.
 */
export interface TimedMidiEvent {
  /** Timestamp in milliseconds from the beginning of the song */
  timeMs: number;
  /** MIDI event action type */
  type: 'noteOn' | 'noteOff' | 'programChange' | 'controlChange' | 'pitchBend';
  /** MIDI channel index (0 to 15) */
  channel: number;
  /** MIDI key number (0 to 127) */
  note?: number;
  /** Key velocity (0 to 127) */
  velocity?: number;
  /** General MIDI patch / instrument program index */
  program?: number;
  /** Controller index (e.g. 7 for volume, 10 for pan, 64 for sustain) */
  controller?: number;
  /** Controller or pitch wheel value */
  value?: number;
}

/**
 * Standard MIDI (SMF) and KAR (Karaoke MIDI) binary parser.
 * Reads 'MThd' and 'MTrk' chunks, handles running status bytes, variable-length delta times,
 * calculates absolute millisecond timing through dynamic tempo map changes (0x51),
 * and extracts synchronized lyric text events (0x05 / 0x01).
 */
export class MidiParser {
  /**
   * Parses a raw ArrayBuffer containing standard MIDI or KAR data into a structured song
   * and a chronologically sorted array of timed events.
   *
   * @param buffer - Binary ArrayBuffer of the MIDI file
   * @returns Parsed song structure and list of timed events
   */
  public static parse(buffer: ArrayBuffer): { song: MidiParsedSong; events: TimedMidiEvent[] } {
    const data = new DataView(buffer);
    let offset = 0;

    // Header Chunk
    const headerTag = String.fromCharCode(
      data.getUint8(offset++),
      data.getUint8(offset++),
      data.getUint8(offset++),
      data.getUint8(offset++)
    );

    if (headerTag !== 'MThd') {
      throw new Error('Invalid MIDI file: Missing MThd header chunk');
    }

    const headerLength = data.getUint32(offset);
    offset += 4;
    // Format (0, 1, or 2)
    offset += 2;
    const trackCount = data.getUint16(offset);
    offset += 2;
    const timeDivision = data.getUint16(offset);
    offset += 2;

    // Skip any extra header bytes if headerLength > 6
    if (headerLength > 6) {
      offset += headerLength - 6;
    }

    const ticksPerQuarterNote = timeDivision & 0x7fff;
    let initialBpm = 120;

    const rawTrackEvents: Array<Array<{ tick: number; event: any }>> = [];
    const lyricsList: MidiLyricEvent[] = [];
    const trackInfoMap: Map<number, { name: string; noteCount: number; isDrum: boolean }> = new Map();

    for (let ch = 0; ch < 16; ch++) {
      trackInfoMap.set(ch, {
        name: ch === 9 ? 'Percussion / Drums' : `MIDI Channel ${ch + 1}`,
        noteCount: 0,
        isDrum: ch === 9
      });
    }

    // Read Tracks
    for (let t = 0; t < trackCount && offset < data.byteLength; t++) {
      if (offset + 8 > data.byteLength) break;
      const trackTag = String.fromCharCode(
        data.getUint8(offset++),
        data.getUint8(offset++),
        data.getUint8(offset++),
        data.getUint8(offset++)
      );

      const trackLength = data.getUint32(offset);
      offset += 4;

      if (trackTag !== 'MTrk') {
        offset += trackLength;
        continue;
      }

      const trackEnd = offset + trackLength;
      let currentTick = 0;
      let runningStatus = 0;
      const trackEvents: Array<{ tick: number; event: any }> = [];

      while (offset < trackEnd && offset < data.byteLength) {
        // Read Variable Length Quantity for delta time
        let deltaTime = 0;
        let b = 0;
        do {
          b = data.getUint8(offset++);
          deltaTime = (deltaTime << 7) | (b & 0x7f);
        } while (b & 0x80);

        currentTick += deltaTime;

        let statusByte = data.getUint8(offset);
        if (statusByte & 0x80) {
          offset++;
          // Only Channel Voice messages (0x80-0xEF) set running status; Meta/SysEx clear it
          if (statusByte < 0xf0) {
            runningStatus = statusByte;
          } else {
            runningStatus = 0;
          }
        } else {
          statusByte = runningStatus;
        }

        // Meta Events
        if (statusByte === 0xff) {
          const metaType = data.getUint8(offset++);
          let metaLength = 0;
          let mb = 0;
          do {
            mb = data.getUint8(offset++);
            metaLength = (metaLength << 7) | (mb & 0x7f);
          } while (mb & 0x80);

          const metaData = new Uint8Array(buffer, offset, metaLength);
          offset += metaLength;

          // Tempo Change
          if (metaType === 0x51 && metaLength === 3) {
            const us = (metaData[0] << 16) | (metaData[1] << 8) | metaData[2];
            trackEvents.push({
              tick: currentTick,
              event: { type: 'tempo', usPerQuarterNote: us }
            });
          }
          // Track Name
          else if (metaType === 0x03) {
            const trackName = new TextDecoder('latin1').decode(metaData);
            trackEvents.push({
              tick: currentTick,
              event: { type: 'trackName', name: trackName }
            });
          }
          // Lyric (0x05) or Text (0x01) used in KAR files
          else if (metaType === 0x05 || metaType === 0x01) {
            const rawText = new TextDecoder('latin1').decode(metaData);
            trackEvents.push({
              tick: currentTick,
              event: { type: 'lyric', text: rawText }
            });
          }
        }
        // SysEx Events
        else if (statusByte === 0xf0 || statusByte === 0xf7) {
          let sysexLength = 0;
          let sb = 0;
          do {
            sb = data.getUint8(offset++);
            sysexLength = (sysexLength << 7) | (sb & 0x7f);
          } while (sb & 0x80);
          offset += sysexLength;
        }
        // Channel Voice Messages
        else {
          const messageType = statusByte & 0xf0;
          const channel = statusByte & 0x0f;

          switch (messageType) {
            case 0x80: { // Note Off
              const note = data.getUint8(offset++);
              const velocity = data.getUint8(offset++);
              trackEvents.push({
                tick: currentTick,
                event: { type: 'noteOff', channel, note, velocity }
              });
              break;
            }
            case 0x90: { // Note On
              const note = data.getUint8(offset++);
              const velocity = data.getUint8(offset++);
              const isActualNoteOn = velocity > 0;
              if (isActualNoteOn) {
                const info = trackInfoMap.get(channel);
                if (info) info.noteCount++;
              }
              trackEvents.push({
                tick: currentTick,
                event: {
                  type: isActualNoteOn ? 'noteOn' : 'noteOff',
                  channel,
                  note,
                  velocity
                }
              });
              break;
            }
            case 0xb0: { // Control Change
              const controller = data.getUint8(offset++);
              const value = data.getUint8(offset++);
              trackEvents.push({
                tick: currentTick,
                event: { type: 'controlChange', channel, controller, value }
              });
              break;
            }
            case 0xc0: { // Program Change
              const program = data.getUint8(offset++);
              trackEvents.push({
                tick: currentTick,
                event: { type: 'programChange', channel, program }
              });
              break;
            }
            case 0xe0: { // Pitch Bend
              const lsb = data.getUint8(offset++);
              const msb = data.getUint8(offset++);
              const bendValue = (msb << 7) | lsb;
              trackEvents.push({
                tick: currentTick,
                event: { type: 'pitchBend', channel, value: bendValue }
              });
              break;
            }
            case 0xa0: // Polyphonic Aftertouch
            case 0xd0: // Channel Pressure
              offset++;
              break;
            default:
              break;
          }
        }
      }

      rawTrackEvents.push(trackEvents);
    }

    // Merge and calculate absolute millisecond time based on dynamic tempo map
    const rawTempoMap: Array<{ tick: number; usPerQuarterNote: number }> = [];

    for (const track of rawTrackEvents) {
      for (const item of track) {
        if (item.event.type === 'tempo') {
          rawTempoMap.push({
            tick: item.tick,
            usPerQuarterNote: item.event.usPerQuarterNote
          });
        }
      }
    }

    rawTempoMap.sort((a, b) => a.tick - b.tick);

    // Build deduplicated tempo points list
    const tempoPoints: Array<{ tick: number; usPerQuarterNote: number; startMs: number }> = [];
    let initialTempoUs = 500000;

    // Check if there's an explicit tempo at tick 0
    const tickZeroEvents = rawTempoMap.filter((t) => t.tick === 0);
    if (tickZeroEvents.length > 0) {
      initialTempoUs = tickZeroEvents[tickZeroEvents.length - 1].usPerQuarterNote;
    }
    initialBpm = Math.round(60000000 / initialTempoUs);

    tempoPoints.push({
      tick: 0,
      usPerQuarterNote: initialTempoUs,
      startMs: 0
    });

    let currentTempoUs = initialTempoUs;
    let lastTick = 0;
    let cumulativeMs = 0;

    for (const t of rawTempoMap) {
      if (t.tick === 0) continue;
      if (t.tick > lastTick) {
        const deltaTicks = t.tick - lastTick;
        cumulativeMs += (deltaTicks * currentTempoUs) / (ticksPerQuarterNote * 1000);
        tempoPoints.push({
          tick: t.tick,
          usPerQuarterNote: t.usPerQuarterNote,
          startMs: cumulativeMs
        });
        lastTick = t.tick;
        currentTempoUs = t.usPerQuarterNote;
      } else if (t.tick === lastTick) {
        // Multiple tempo events at the same tick; update active tempo
        currentTempoUs = t.usPerQuarterNote;
        tempoPoints[tempoPoints.length - 1].usPerQuarterNote = t.usPerQuarterNote;
      }
    }

    const tickToMs = (tick: number): number => {
      let activeIndex = 0;
      for (let i = tempoPoints.length - 1; i >= 0; i--) {
        if (tick >= tempoPoints[i].tick) {
          activeIndex = i;
          break;
        }
      }
      const point = tempoPoints[activeIndex];
      const deltaTicks = tick - point.tick;
      return point.startMs + (deltaTicks * point.usPerQuarterNote) / (ticksPerQuarterNote * 1000);
    };

    // Flatten and convert all events to timed events
    const timedMidiEvents: TimedMidiEvent[] = [];
    let maxMs = 0;

    for (const track of rawTrackEvents) {
      for (const item of track) {
        const timeMs = Math.round(tickToMs(item.tick) * 100) / 100;
        if (timeMs > maxMs) maxMs = timeMs;

        if (item.event.type === 'lyric') {
          const raw = item.event.text;
          const isParagraphBreak = raw.startsWith('/') || raw.startsWith('\\');
          const isLineBreak = isParagraphBreak || raw.includes('\n') || raw.includes('\r');
          const cleanText = raw.replace(/^[/\\@]/, '');
          if (cleanText.trim().length > 0) {
            lyricsList.push({
              timeMs,
              text: cleanText,
              isLineBreak,
              isParagraphBreak
            });
          }
        } else if (
          item.event.type === 'noteOn' ||
          item.event.type === 'noteOff' ||
          item.event.type === 'programChange' ||
          item.event.type === 'controlChange' ||
          item.event.type === 'pitchBend'
        ) {
          timedMidiEvents.push({
            timeMs,
            type: item.event.type,
            channel: item.event.channel,
            note: item.event.note,
            velocity: item.event.velocity,
            program: item.event.program,
            controller: item.event.controller,
            value: item.event.value
          });
        }
      }
    }

    // Strict MIDI priority ranking for simultaneous events
    const eventTypeRank: Record<TimedMidiEvent['type'], number> = {
      programChange: 1,
      controlChange: 2,
      pitchBend: 3,
      noteOff: 4,
      noteOn: 5
    };

    timedMidiEvents.sort((a, b) => {
      if (Math.abs(a.timeMs - b.timeMs) > 0.001) {
        return a.timeMs - b.timeMs;
      }
      return (eventTypeRank[a.type] || 0) - (eventTypeRank[b.type] || 0);
    });
    lyricsList.sort((a, b) => a.timeMs - b.timeMs);

    const tracksList: MidiParsedTrackInfo[] = [];
    trackInfoMap.forEach((info, channel) => {
      if (info.noteCount > 0 || channel === 9) {
        tracksList.push({
          channel,
          name: info.name,
          noteCount: info.noteCount,
          isDrumTrack: info.isDrum
        });
      }
    });

    return {
      song: {
        durationMs: maxMs,
        tracks: tracksList,
        lyrics: lyricsList,
        initialBpm
      },
      events: timedMidiEvents
    };
  }
}

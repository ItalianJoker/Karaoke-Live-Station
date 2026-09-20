/**
 * Type shims for the official Signalsmith Stretch Web Audio release.
 * @see https://www.npmjs.com/package/signalsmith-stretch (MIT)
 */
declare module 'signalsmith-stretch' {
  export type SignalsmithScheduleOptions = {
    output?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  };

  export type SignalsmithConfigureOptions = {
    blockMs?: number | null;
    intervalMs?: number;
    splitComputation?: boolean;
    preset?: 'default' | 'cheaper';
  };

  export type SignalsmithStretchNode = AudioWorkletNode & {
    inputTime: number;
    schedule: (
      opts: SignalsmithScheduleOptions,
      adjustPrevious?: boolean
    ) => Promise<SignalsmithScheduleOptions>;
    start: (
      when?: number | SignalsmithScheduleOptions,
      offset?: number,
      duration?: number,
      rate?: number,
      semitones?: number
    ) => Promise<unknown>;
    stop: (when?: number) => Promise<unknown>;
    latency: () => Promise<number>;
    configure: (opts: SignalsmithConfigureOptions) => Promise<unknown>;
    addBuffers: (channels: Float32Array[], transfer?: ArrayBuffer[]) => Promise<number>;
    dropBuffers: (toSeconds?: number) => Promise<unknown>;
    setUpdateInterval: (seconds: number, callback?: (t: number) => void) => Promise<unknown>;
  };

  export default function SignalsmithStretch(
    audioContext: BaseAudioContext,
    channelOptions?: AudioWorkletNodeOptions
  ): Promise<SignalsmithStretchNode>;
}

# Signalsmith Stretch (Hi-Fi pitch DSP)

Runtime dependency via npm `signalsmith-stretch` (bundled into the renderer by Vite).
**No C++ / header source trees are vendored in this repository.**

The previous `bungee-pitch-shift@1.0.8` AudioWorklet assets (`bungee_processor.js` /
`bungee.wasm`) were removed — that Stretcher muted within ~20 ms on negative pitch
when fed 128-frame quanta.

## Upstream

- **Signalsmith Stretch:** https://github.com/Signalsmith-Audio/signalsmith-stretch
- **License:** MIT
- **npm:** `signalsmith-stretch` (official Web Audio / AudioWorklet release)

## App wiring

- Settings engine id `signalsmith` = Hi-Fi Signalsmith (legacy `bungee` migrates automatically).
- `SignalsmithPitchShifterNode` wraps `SignalsmithStretch(audioContext)`.
- Tempo: `HTMLMediaElement.playbackRate` + `preservesPitch`.
- Pitch: `stretch.schedule({ semitones })` while pitch ≠ 0; true bypass at pitch 0.
- Mute watchdog → dry pass-through + SoundTouch emergency fallback (pitch/speed bounds switch to SoundTouch ±4 / 0.75–1.25×).

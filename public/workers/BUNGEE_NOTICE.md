# Bungee (prebuilt Wasm / AudioWorklet)

Runtime-only artifacts. **No C++ / header source trees are vendored in this repository.**

| File | Role |
| --- | --- |
| `bungee_processor.js` | AudioWorklet processor + Emscripten glue (embedded Wasm binary via SINGLE_FILE) |
| `bungee.wasm` | Same Wasm binary as a standalone file (MPL source-form pointer; load path uses the embedded copy in the processor for Electron blob-URL safety) |

## Upstream

- **Bungee** (C++ library → Wasm): https://github.com/bungee-audio-stretch/bungee
- **License:** Mozilla Public License 2.0 (MPL-2.0)
- **Source Form:** obtain from the upstream repository (not copied into this tree)

## JS packaging used to obtain these prebuilts

- npm package `bungee-pitch-shift` @ 1.0.8 (MIT) — used only to extract prebuilt `dist/` runtime files; not required at app runtime beyond the copied assets.

To refresh assets after upgrading the npm package:

```bash
cp node_modules/bungee-pitch-shift/dist/bungee-processor-bundled.js public/workers/bungee_processor.js
cp node_modules/bungee-pitch-shift/dist/bungee-wasm.wasm public/workers/bungee.wasm
```

After copying, **re-apply the Karaoke Live Station AudioWorklet patches** (required for Electron / Chromium AudioWorkletGlobalScope):

1. Remove the Emscripten glue trailing `export default createBungeeModule;` (keep `createBungeeModule` as a free function for `registerProcessor`).
2. Widen worker detection so Wasm init runs inside AudioWorklet:
   `ENVIRONMENT_IS_WORKER=!!(globalThis.WorkerGlobalScope||globalThis.AudioWorkletGlobalScope)||typeof registerProcessor=="function"`
3. Expose Emscripten alloc + heaps on the Module object (MODULARIZE locals are not on Module by default — AppImage otherwise throws `BungeeModule._malloc is not a function`):
   - In `assignWasmExports`: `Module["_malloc"]=_malloc;Module["_free"]=_free`
   - In `updateMemoryViews`: mirror `HEAPF32` (and sibling HEAP views) onto `Module[…]`
4. Definitive pitch/speed continuity (negative pitch mute fix):
   - Allocate Wasm input/output scratch for **8192 stereo frames** (`WASM_MAX_FRAMES`), not `blockSize` (128).
   - Implement a stereo **output FIFO** (enqueue all Bungee frames; dequeue exactly one Web Audio quantum). Never `Math.min(outputFrames, frameCount)` discard.
   - Clear the FIFO on `reset` and when entering neutral bypass.

`BungeePitchShifterNode.create` waits for the worklet `initialized` message (timeout → SoundTouch fallback).

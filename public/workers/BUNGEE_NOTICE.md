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

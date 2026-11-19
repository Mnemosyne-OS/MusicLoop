# Signalsmith Stretch, vendored

`SignalsmithStretch.mjs` is the ES module of the npm package
[`signalsmith-stretch`](https://www.npmjs.com/package/signalsmith-stretch)
version **1.3.2** (published 2025-06-27), byte for byte. It is the official
JS/WASM release of Signalsmith Stretch: one file that holds the AudioWorklet
processor and the WebAssembly binary. Nothing here is edited: the cartridge
calls it from `src/audio/timebase.ts` through the types of
that file (it is shipped as an asset, not bundled: a minifier breaks the
worklet it builds from its own text), and never changes it.

- sha256 of the file: `97530b11d5bc01015af4cde40d6aa55ff10c40aa1294ca4c8c5762027d517a46`
- sha1 of the npm tarball: `8549203d56c12c1ddf6f4083e4781bab19eae839`

`src/vendor.test.ts` computes the sha256 again and fails when the file moved.

## Licence

MIT. The npm package says so in its `package.json` and ships no licence file.
`LICENSE.txt` here is the one of the library's repository
(`Signalsmith-Audio/signalsmith-stretch` on GitHub, the mirror the author
names), fetched on 2026-11-19: Copyright (c) 2022 Geraint Luff / Signalsmith
Audio Ltd.

Not read: the licences of what the WebAssembly binary was compiled from beyond
the library itself (its own `signalsmith-linear` dependency, the Emscripten
runtime). Nobody here has opened the binary to check what went in.

## Why a copy and not a dependency

A new package in `apps/*` changes `pnpm-lock.yaml` for every session and the
CI. One file of 114 KB under MIT is cheaper to carry than that, and it is the
shape the author ships for a `<script>` tag anyway.

## Updating

1. `npm pack signalsmith-stretch@<version>` in an empty folder outside the
   repository, and read what the tarball holds.
2. Copy `package/SignalsmithStretch.mjs` over this one.
3. Put the new version, date and sha256 in this file and in `src/vendor.test.ts`.
4. Run the browser checks of doc 249 §12 again: the length rendered, the pitch
   kept, the level kept. The node's interface is not typed upstream.

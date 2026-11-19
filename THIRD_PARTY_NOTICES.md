# Third-party notices

MusicLoop's own code is under the MIT License in `LICENSE`. It carries one
library it did not write, kept here with its notice and shown on the
cartridge's credits screen.

## Signalsmith Stretch, by Geraint Luff / Signalsmith Audio Ltd.

`src/vendor/signalsmith-stretch/SignalsmithStretch.mjs` is the JS/WASM release
of https://signalsmith-audio.co.uk/code/stretch/, copied unchanged from the npm
package `signalsmith-stretch` version 1.3.2. MIT License, Copyright (c) 2022
Geraint Luff / Signalsmith Audio Ltd.: the full text is
`src/vendor/signalsmith-stretch/LICENSE.txt`.

MusicLoop uses it for one thing: changing the speed of a loop without changing
its pitch, and its pitch without its speed (`src/audio/timebase.ts`).

`src/vendor/signalsmith-stretch/VENDOR.md` says where the file came from, how
it was checked and how to update it.

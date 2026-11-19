<div align="center">

<img src="https://raw.githubusercontent.com/Mnemosyne-OS/Mnemosyne-Neural-OS/main/assets/banner-mnemosyne-os.png" width="100%" alt="Mnemosyne OS — Your memory. Your machine. Your rules." />

🌐 [**mnemosyne-os.io**](https://mnemosyne-os.io) — the product&ensp;·&ensp;[**mnemosyne-os.com**](https://mnemosyne-os.com) — for organizations&ensp;·&ensp;📖 [**docs.mnemosyne-os.io**](https://docs.mnemosyne-os.io) — the documentation

</div>

# MusicLoop

Pick a stretch of a sound, loop it, shape it, and save it at the length of a short.

MusicLoop is a cartridge for [Mnemosyne OS](https://github.com/Mnemosyne-OS).

- **A loop with no click.** Open a sound, or the sound track of a film. Two
  handles mark the loop on the waveform. The end is crossfaded into what comes
  before the start, so the wrap is one ordinary step of the sound.
- **On the beat.** The tempo is found from the sound itself. The handles snap
  to the beats, and a loop of 1, 2, 4, 8 or 16 beats is one click.
- **Bass, treble and effects.** A three-band equaliser, a filter on one knob,
  saturation, echo, reverb. A limiter holds the level.
- **Speed and pitch.** Slower or faster with the pitch kept, the pitch moved on
  its own, or both together like a record. Backwards too.
- **A WAV for a short.** 15, 30 or 60 seconds, any length up to four minutes,
  or one lap that loops again in an editor, effects included. The file goes to
  the folder Mnemosyne OS gives the app.
- **Kept loops.** A loop is kept as the path of its sound, its two handles and
  its settings. The sound itself is never copied.

Everything runs on the computer: Web Audio, no account, no network.

## Status

Version 0.1.0, an early build. It is covered by its own tests, and it has had
little real use yet: expect rough edges, and open an issue when you meet one.

Saving the WAV inside Mnemosyne OS, and the list of sounds captured by the
Recorder's music mode, need a host newer than 2.2.1. On an older host the
cartridge opens, loops and shapes a sound, and says in words that the file
was not saved.

## Build

The source is here to read and to change. The cartridge is developed inside
the Mnemosyne OS workspace (its SDK is a workspace package), so `dist/` is
committed: installing it builds nothing on your machine.

## Credits

The speed change with the pitch kept is Signalsmith Stretch by Geraint Luff,
MIT License. See `THIRD_PARTY_NOTICES.md`; the credits screen of the cartridge
shows the same, with the licence in full.

## License

MIT for this cartridge's own code (`LICENSE`).

## Where Mnemosyne OS lives

This cartridge runs inside **Mnemosyne OS**, the sovereign, local-first memory operating system published by XPACEGEMS LLC. Its official addresses:

- Product site: <https://mnemosyne-os.io>
- Organizations: <https://mnemosyne-os.com>
- Documentation: <https://docs.mnemosyne-os.io>
- Host source: <https://github.com/Mnemosyne-OS/Mnemosyne-Neural-OS>
- Packages: the npm scope `@mnemosyne_os`

---

<sub>**[Mnemosyne OS](https://mnemosyne-os.io)** — the sovereign, local-first memory OS this cartridge runs in.
Get it at [mnemosyne-os.io/download](https://mnemosyne-os.io/download), install cartridges from the built-in MnemoHub store, or [build your own](https://mnemosyne-os.io/dev).</sub>

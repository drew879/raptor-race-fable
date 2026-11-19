# Tools for the music work

Kept from the session that built the recorded music (2026-11-19). The story and the lessons are in `docs/NOTES.md` under "The music in Ableton Live, and recorded layers in the game".

Run everything from the repo's root. The Python scripts need numpy and scipy: make a virtual environment in your own scratch folder, not here.

## Measuring

- `loud.py`: K-weighted loudness (BS.1770, no gating), momentary loudness and peak. The others import it.
- `stems.py <export folder>`: checks what Live exported. Is each track there, how loud is it, and how late do its notes speak.
- `lag.py <export folder> <file prefix>`: timing of one exported track against another.
- `v2.py <export folder> <file prefix>`: levels of an export, track by track.
- `checklayers.py`: checks the layer files in `public/music/chase` (lengths, levels, the loop join).
- `recv.mjs`: `node music/tools/recv.mjs` listens on port 8787 and writes sound files the browser posts to `music/tools/out`. `src/audio/preview.ts` posts to it (`send`), which is how clips of the game's own engine are made.

## Driving Ableton Live (`ui/`)

`ui/ui.js` clicks, types and captures the screen through System Events: `osascript -l JavaScript music/tools/ui/ui.js '<json list of actions>'`. `ui/wins.js` lists windows. `ui/shot.sh` and `ui/win.sh` capture a region or a window.

**This takes over Drew's pointer and keyboard.** `ui/HOLD` is committed on purpose: while it exists the driver refuses to act. Move it aside only when Drew has said to go for that stretch of work, put it back when the stretch is done, and never commit its removal. The driver also refuses during a Zoom meeting and while he's typing or moving the mouse. Switch Live's audio engine off first (Options, Audio Engine On) so nothing can play aloud. Export still works.

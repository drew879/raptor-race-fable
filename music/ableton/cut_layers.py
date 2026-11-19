#!/usr/bin/env python3
"""Cut the game's music layers out of what Ableton Live exports from "Chase Strings".

In Live: File, Export Audio/Video, with Rendered Track set to All Individual Tracks, Render Start
1.1.1, Render Length 36.0.0, 48000 Hz, any file type. Save into a folder of its own. Then:

    python3 music/ableton/cut_layers.py <that folder>

It needs ffmpeg, and afconvert (which every Mac has). It writes public/music/chase: one file for
each layer the game switches on and off, the build under the egg's dash, the landing, and
layers.json, which tells the game how the files are laid out and how loud to play them.

What it does to the sound:
  * Adds up the tracks that make one layer (the game's "base" is the short strings, the held
    strings and the kick, which always play together).
  * Moves each track by its track delay. Live plays track delays but leaves them out of the
    files it exports for single tracks, so they are put back here, from the same numbers
    (make_set.py).
  * Cuts the loop from its second time through (bars 9 to 16), which has the first time's echoes
    under its start, and makes it run into its own start without a seam (see `cut`).
  * Turns every file up by the same amount, so the loudest sits just under full scale, and tells
    the game how much to turn them back down. The balance between the layers is Live's.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_set  # noqa: E402  (the track names, their delays, and where things are in the arrangement)

OUT = os.path.join(HERE, '..', '..', 'public', 'music', 'chase')
PAD = 0.25
JOIN = 0.08
LOOP = 16.0
BUILD = 9.0
LANDING = 6.5

# Which of Live's tracks make each of the game's layers, and whether the layer is kept in stereo.
LAYERS = {
    'base': (['Short strings', 'Held strings', 'Kick'], True),
    'octave': (['Short strings 8va'], True),
    'cello': (['Cellos', 'Cellos (the start of each note)'], True),
    'tune': (['Violin tune', 'Violin tune (the start of each note)'], True),
    'high': (['High strings'], True),
    'push': (['Kick push', 'Toms'], False),
    'snare': (['Snare'], False),
    'hats': (['Hats eighths'], False),
    'busy': (['Hats sixteenths'], False),
    'build': (['Ending swell', 'Ending roll'], True),
    'landing': (['Landing chord', 'Landing chord (the start)', 'Landing drum', 'Landing cymbal'], True),
}

# The level of the files as Live exports them, against the level the game's own band plays at:
# how many dB to turn Live's level up for the game. Measured on 2026-11-19 by drawing the same
# sixteen seconds both ways through the game's own sound engine (src/audio/preview.ts), every part
# playing, and comparing their K-weighted loudness: with this they come out within 0.1 dB.
GAME_DB = float(os.environ.get('CHASE_GAME_DB', '0.25'))

DELAY = {t['name']: t['delay'] / 1000 for t in make_set.tracks}
SECONDS = 0.5  # a beat, at 120 to the minute


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def find(folder, prefix, track):
    for ext in ('flac', 'wav', 'aif', 'aiff'):
        path = os.path.join(folder, f'{prefix} {track}.{ext}')
        if os.path.exists(path):
            return path
    sys.exit(f'No export of the track "{track}" in {folder} (looked for "{prefix} {track}.flac" and the like)')


def cut(folder, prefix, layer, out, gain_db=0.0):
    """One layer to a WAV file at 44100 Hz. Returns the file's peak in dB."""
    names, stereo = LAYERS[layer]
    loop = layer not in ('build', 'landing')
    if layer == 'build':
        start, length = make_set.LONG_AT * SECONDS, BUILD
    elif layer == 'landing':
        start, length = make_set.LAND * SECONDS, LANDING
    else:
        start, length = make_set.LOOPS[1] * SECONDS, LOOP + PAD
    args = ['ffmpeg', '-v', 'info', '-y']
    chains = []
    for i, name in enumerate(names):
        args += ['-i', find(folder, prefix, name)]
        a = start - DELAY[name]  # (a delay is negative for a track that plays early: its sound is found later in the file)
        chains.append(f'[{i}:a]atrim=start={a:.6f}:end={a + length:.6f},asetpts=PTS-STARTPTS[x{i}]')
    chains.append(''.join(f'[x{i}]' for i in range(len(names))) + f'amix=inputs={len(names)}:normalize=0[m]')
    if loop:
        # The loop is its second time through, and has to run into its own start without a seam. The
        # players never play a bar the same way twice, so its end does not meet its start: what does
        # follow its end is the start of the third time through. So the loop's first moments are
        # made of that, turning into the loop's own start over a twelfth of a second. In front goes
        # the loop's own last quarter second, for a player coming in just before the bar line.
        part = lambda a, b, more='': f'atrim=start={a:.6f}:end={b:.6f},asetpts=PTS-STARTPTS{more}'
        chains += [
            '[m]asplit=5[m0][m1][m2][m3][m4]',
            f'[m0]{part(LOOP - PAD, LOOP)}[pre]',
            f'[m1]{part(LOOP, LOOP + JOIN, f",afade=t=out:d={JOIN}")}[ha]',
            f'[m2]{part(0, JOIN, f",afade=t=in:d={JOIN}")}[hb]',
            f'[m3]{part(JOIN, LOOP)}[body]',
            f'[m4]{part(LOOP, LOOP + PAD)}[post]',
            '[ha][hb]amix=inputs=2:normalize=0[head]',
            '[pre][head][body][post]concat=n=4:v=0:a=1[whole]',
        ]
        last = '[whole]anull'
    else:
        fade = 0.5 if layer == 'build' else 0.6
        last = f'[m]afade=t=in:d=0.004,afade=t=out:st={length - fade}:d={fade}'
    chains.append(f'{last},volume={gain_db:.3f}dB,volumedetect[out]')
    args += ['-filter_complex', ';'.join(chains), '-map', '[out]', '-ar', '44100', '-ac', '2' if stereo else '1', '-c:a', 'pcm_s24le', out]
    done = subprocess.run(args, check=True, capture_output=True, text=True)
    found = re.search(r'max_volume: (-?[\d.]+) dB', done.stderr)
    return float(found.group(1)) if found else 0.0


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    folder = sys.argv[1]
    prefix = sys.argv[2] if len(sys.argv) > 2 else 'Chase Strings'
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        peaks = {layer: cut(folder, prefix, layer, os.path.join(tmp, f'{layer}.wav')) for layer in LAYERS}
        lift = -2.0 - max(peaks.values())
        for layer, (_, stereo) in LAYERS.items():
            wav = os.path.join(tmp, f'{layer}.wav')
            peak = cut(folder, prefix, layer, wav, lift)
            # (afconvert is Apple's encoder; the bit rate is for the whole file, both channels)
            run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '128000' if stereo else '72000', '-q', '127', wav, os.path.join(OUT, f'{layer}.m4a')])
            print(f'{layer:8} {"stereo" if stereo else "mono  "}  peak {peak:6.1f} dB  {os.path.getsize(os.path.join(OUT, layer + ".m4a")) // 1024:5d} KB')
    sheet = {'gain': round(10 ** ((GAME_DB - lift) / 20), 4), 'length': LOOP, 'pad': PAD}
    with open(os.path.join(OUT, 'layers.json'), 'w') as fh:
        json.dump(sheet, fh)
        fh.write('\n')
    print(f'turned up {lift:.1f} dB for the files; the game plays them at {sheet["gain"]} ({GAME_DB - lift:+.1f} dB)')


if __name__ == '__main__':
    main()

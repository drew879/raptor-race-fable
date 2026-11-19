import sys, os, glob, subprocess, json, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loud import read, lk, peak, momentary
from scipy.io import wavfile
D = sys.argv[1]; pre = sys.argv[2]; SR = 48000
OUT = os.path.dirname(os.path.abspath(__file__)) + '/out'
def load(name):
    path = f'{D}/{pre}{name}.flac'; wav = path[:-5] + '.wav'
    if not os.path.exists(wav) or os.path.getmtime(wav) < os.path.getmtime(path):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-ar', str(SR), '-c:a', 'pcm_f32le', wav], check=True)
    sr, x = wavfile.read(wav); return x.astype(np.float64)
def env(x, hop=48):
    m = np.abs(x).mean(1); n = len(m) // hop
    return m[: n * hop].reshape(n, hop).mean(1)
def around(x, times, before=150, after=350):
    """The average envelope round the written times, and when it peaks and reaches half."""
    e = env(x); acc = np.zeros(before + after); k = 0
    for t in times:
        i = int(round(t * 1000))
        if i - before < 0 or i + after > len(e): continue
        acc += e[i - before: i + after]; k += 1
    acc /= max(k, 1)
    pk = int(np.argmax(acc)) - before
    base = acc[:20].mean()
    half = int(np.argmax(acc > base + 0.5 * (acc.max() - base))) - before
    return pk, half
bars = [16 + 2 * b for b in range(8)]
print('--- when notes speak (ms after the written time; negative is early)')
for name, times in [('Cellos (the start of each note)', [b + h for b in bars for h in (0, 1)]), ('Cellos', [b + h for b in bars for h in (0, 1)]), ('Landing chord (the start)', [48]), ('Landing chord', [48]), ('Kick', [b + h for b in bars for h in (0, 1)]), ('Snare', [b + h for b in bars for h in (0.5, 1.5)]),
                    ('Violin tune (the start of each note)', [16, 16.5, 17, 18, 18.5, 19, 20, 20.5, 21]), ('Held strings', bars), ('High strings', bars), ('Ending swell', [64])]:
    pk, half = around(load(name), times)
    print(f'  {name:38} peak {pk:5d}   half-way {half:5d}')
# the short strings: sixteenths run together, so look at the comb: fold the envelope on 125 ms
for name in ['Short strings', 'Short strings 8va']:
    e = env(load(name))[16000:32000]
    fold = e.reshape(-1, 125).mean(0)
    print(f'  {name:38} folded on a sixteenth: loudest at {int(np.argmax(fold))} ms, quietest at {int(np.argmin(fold))} ms after each sixteenth; depth {20*np.log10(fold.max()/fold.min()):.1f} dB')
print('--- levels of the game layers (sum of their tracks), loop second time through')
layers = {'short': ['Short strings'], 'bed': ['Held strings'], 'kick': ['Kick'], 'octave': ['Short strings 8va'], 'cello': ['Cellos', 'Cellos (the start of each note)'], 'tune': ['Violin tune', 'Violin tune (the start of each note)'], 'high': ['High strings'],
          'kickpush': ['Kick push'], 'toms': ['Toms'], 'snare': ['Snare'], 'hats8': ['Hats eighths'], 'hats16': ['Hats sixteenths']}
synth = json.load(open(OUT + '/synth-levels.json'))
smap = {'short': ('solo-spic', lk), 'bed': ('solo-bed', lk), 'kick': ('solo45-kick', momentary), 'octave': ('solo-octave', lk), 'cello': ('solo-cello', lk), 'tune': ('solo-violin', lk), 'high': ('solo-trem', lk), 'toms': ('solo-tom', momentary), 'snare': ('solo-snare', momentary), 'hats8': ('solo45-hat', momentary)}
total = None; res = {}
for layer, names in layers.items():
    x = sum(load(n) for n in names)
    total = x if total is None else total + x
    line = f'  {layer:9} LK {lk(x, SR, 16, 32):6.1f}  mom {momentary(x, SR, 16, 32):6.1f}  peak {peak(x, SR, 16, 32):6.1f}'
    if layer in smap:
        sf, f = smap[layer]; sr, y = read(f'{OUT}/{sf}.wav'); d = f(x, SR, 16, 32) - f(y, sr, 16, 32); res[layer] = d
        line += f'   against the synth {d:+6.1f} dB'
    for n in names:
        if len(names) > 1: line += f' | {n[:14]} {lk(load(n), SR, 16, 32):6.1f}'
    print(line)
sr, y = read(f'{OUT}/solo-all.wav')
print(f'  all the loop layers together: LK {lk(total, SR, 16, 32):6.1f} peak {peak(total, SR, 16, 32):6.1f}   synth: LK {lk(y, sr, 16, 32):6.1f} peak {peak(y, sr, 16, 32):6.1f}')
vals = [res[k] for k in ('short', 'bed', 'octave', 'cello', 'tune', 'high')]
print('  mean offset of the string layers %.1f dB' % np.mean(vals))
print('--- the ending')
dash = total + load('Ending swell') + load('Ending roll')
land = sum(load(n) for n in ['Landing chord', 'Landing chord (the start)', 'Landing drum', 'Landing cymbal'])
print(f'  chase alone, loop:            LK {lk(total, SR, 16, 32):6.1f}')
print(f'  dash bar second half (46+1..48): LK {lk(dash, SR, 47, 47.95):6.1f}  (the synth: chase +4.6)')
print(f'  swell alone, long version 2-8 s: LK {lk(load("Ending swell"), SR, 66, 72):6.1f}   roll alone: LK {lk(load("Ending roll"), SR, 66, 72):6.1f}')
for a, b, want in [(48, 49, '+3.4'), (49, 50, '+1.9'), (50, 51, '-7.1')]:
    print(f'  landing {a-48}-{b-48} s: LK {lk(land, SR, a, b):6.1f} peak {peak(land, SR, a, b):6.1f}  (the synth: chase {want})')
for n in ['Landing chord', 'Landing chord (the start)', 'Landing drum', 'Landing cymbal']:
    print(f'     {n:28} first second LK {lk(load(n), SR, 48, 49):6.1f} peak {peak(load(n), SR, 48, 49):6.1f}')
sr, m = wavfile.read(f'{D}/{pre.strip()}.wav') if os.path.exists(f'{D}/{pre.strip()}.wav') else (0, None)

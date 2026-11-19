import sys, os, subprocess, json, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loud import lk, peak, momentary, read
from scipy.io import wavfile
P = 'public/music/chase/'
T = os.path.dirname(os.path.abspath(__file__)) + '/layers-decoded/'
os.makedirs(T, exist_ok=True)
sheet = json.load(open(P + 'layers.json')); PAD = sheet['pad']; SR = 48000
def load(name):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', P + name + '.m4a', '-ar', str(SR), '-ac', '2', '-c:a', 'pcm_f32le', T + name + '.wav'], check=True)
    sr, x = wavfile.read(T + name + '.wav'); return x.astype(np.float64)
def env(x, hop=48):
    m = np.abs(x).mean(1); n = len(m) // hop
    return m[: n * hop].reshape(n, hop).mean(1)
names = ['base', 'octave', 'cello', 'tune', 'high', 'push', 'snare', 'hats', 'busy']
X = {n: load(n) for n in names + ['build', 'landing']}
print('--- lengths (a loop file should be %.3f s)' % (16 + 2 * PAD))
for n, x in X.items(): print(f'  {n:8} {len(x) / SR:7.3f} s')
print('--- the join: how alike are the quarter second before the loop and the quarter second that ends it; and after it and its start')
for n in names:
    x = X[n]; a = int(PAD * SR); L = 16 * SR
    def alike(u, v):
        u = u.mean(1); v = v.mean(1); d = np.sqrt((u * u).sum() * (v * v).sum())
        return (u * v).sum() / d if d > 0 else 1
    print(f'  {n:8} before {alike(x[:a], x[L:L + a]):.3f}   after {alike(x[a + L: a + L + a - 480], x[a: 2 * a - 480]):.3f}')
print('--- timing: the envelope folded on the beat (ms after the written time)')
def fold(x, period_ms, start_ms=0):
    e = env(x)[int(PAD * 1000) + start_ms: int(PAD * 1000) + 16000]
    k = len(e) // period_ms
    f = e[: k * period_ms].reshape(k, period_ms).mean(0)
    return f
kick = fold(X['push'], 2000)  # push kick at 1.25 s of each bar, toms at the end of bar 8
print('  push kick: loudest at %d ms into the bar (written 1250)' % int(np.argmax(kick)))
f = fold(X['snare'], 1000); print('  snare: loudest at %d ms into the half bar (written 500)' % int(np.argmax(f)))
f = fold(X['hats'], 250); print('  hats: loudest at %d ms after each eighth' % int(np.argmax(f)))
f = fold(X['busy'], 250); print('  busy hats: loudest at %d ms after each eighth (written 125)' % int(np.argmax(f)))
f = fold(X['base'], 1000); print('  base: loudest at %d ms after each half bar (the kick is written at 0)' % int(np.argmax(f)))
f = fold(X['octave'], 125); print('  octave (short strings): loudest %d ms, quietest %d ms after each sixteenth' % (int(np.argmax(f)), int(np.argmin(f))))
f = fold(X['cello'], 1000); print('  cello: steepest rise at %d ms relative to each half bar' % (int(np.argmax(np.diff(np.concatenate([f[-200:], f[:300]])))) - 200))
e = env(X['landing']); print('  landing: peak at %d ms, half-way at %d ms' % (int(np.argmax(e[:600])), int(np.argmax(e > 0.5 * e[:600].max()))))
e = env(X['build']); print('  build: level by second: ' + ' '.join('%.0f' % (20 * np.log10(max(e[i * 1000:(i + 1) * 1000].mean(), 1e-6))) for i in range(9)))
print('--- level')
tot = sum(X[n] for n in names)[int(PAD * SR): int((PAD + 16) * SR)]
sr, y = read(os.path.dirname(os.path.abspath(__file__)) + '/out/solo-all.wav')
ls = lk(y, sr, 16, 32) + 6.02  # at the music bus's input
lt = lk(tot, SR)
print(f'  all nine loop layers as filed: LK {lt:.2f}, peak {peak(tot, SR, 0, 16):.1f}; times the sheet gain {sheet["gain"]}: LK {lt + 20 * np.log10(sheet["gain"]):.2f}')
print(f'  the synth band, every part, at the same point in the game: LK {ls:.2f}  -> the sheet gain should be {10 ** ((ls - lt) / 20):.4f}')
land = X['landing']; print(f'  landing first second LK {lk(land, SR, 0, 1):.1f} ({lk(land, SR, 0, 1) - lt:+.1f} against the loop; the synth +3.4), second {lk(land, SR, 1, 2) - lt:+.1f} (synth +1.9), third {lk(land, SR, 2, 3) - lt:+.1f} (synth -7.1)')
b = X['build']; dash = tot[int(15 * SR): int(15.95 * SR)] + b[int(1 * SR): int(1.95 * SR)]
print(f'  the dash bar\'s second half with the build over it: {lk(dash, SR) - lt:+.1f} against the loop (the synth +4.6)')

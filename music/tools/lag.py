import sys, os, numpy as np
from scipy.io import wavfile
D = sys.argv[1]; pre = sys.argv[2]
SR = 48000
def load(name):
    sr, x = wavfile.read(f'{D}/{pre}{name}.wav'); return x.astype(np.float64)
def env(x, hop=48):
    m = np.abs(x).mean(1); n = len(m) // hop
    return m[: n * hop].reshape(n, hop).mean(1)
def lag(x, times, lo=-30, hi=160):
    e = env(x)
    # smooth 3 ms, then the rise
    k = np.ones(3) / 3; e = np.convolve(e, k, 'same')
    rise = np.maximum(0, np.diff(e, prepend=e[0]))
    best = None
    scores = []
    for l in range(lo, hi):
        s = sum(rise[int(round(t * 1000)) + l] for t in times if 0 <= int(round(t * 1000)) + l < len(rise))
        scores.append(s)
    scores = np.array(scores)
    l = int(np.argmax(scores)) + lo
    # and the time the envelope takes to reach half of its peak after each written time
    half = []
    for t in times:
        i = int(round(t * 1000)); seg = e[i: i + 400]
        if len(seg) < 400 or seg.max() < 1e-5: continue
        base = e[max(0, i - 5): i + 1].min()
        target = base + 0.5 * (seg.max() - base)
        half.append(int(np.argmax(seg >= target)))
    return l, int(np.median(half)) if half else None
OST = [0, 0, 7, 0, 12, 0, 7, 0, 0, 0, 7, 0, 12, 7, 0, 7]
bars = [16 + 2 * b for b in range(8)]
grid16 = [b + i * 0.125 for b in bars for i in range(16)]
parts = {
 'Short strings': grid16, 'Short strings 8va': grid16,
 'Cellos': [b + h for b in bars for h in (0, 1)],
 'Held strings': bars, 'High strings': bars,
 'Violin tune': None,
 'Kick': [b + h for b in bars for h in (0, 1)], 'Snare': [b + h for b in bars for h in (0.5, 1.5)],
 'Hats eighths': [b + i * 0.25 for b in bars for i in range(8)], 'Hats sixteenths': [b + i * 0.25 + 0.125 for b in bars for i in range(8)],
 'Kick push': [b + 1.25 for b in bars], 'Toms': [30 + 1.5 + i * 0.125 for i in range(4)],
 'Bells (amber line)': [b + i * 0.25 for b in bars for i in range(8)],
 'Landing chord': [48], 'Landing drum': [48], 'Landing cymbal': [48], 'Ending swell': [46, 64], 'Ending roll': [46 + i * 0.072 for i in range(27)],
}
TUNE = [[(73,4),(76,4),(80,6),(81,2)],[(80,4),(76,4),(73,8)],[(78,4),(81,4),(85,6),(84,2)],[(80,8),(84,4),(80,4)],[(73,4),(76,4),(80,6),(81,2)],[(81,4),(80,4),(76,4),(73,4)],[(74,4),(78,4),(81,6),(80,2)],[(80,4),(75,4),(72,8)]]
tt = []
for b, bar in enumerate(TUNE):
    at = 0
    for p, l in bar:
        tt.append(16 + 2 * b + at * 0.125); at += l
parts['Violin tune'] = tt
for name, times in parts.items():
    x = load(name)
    l, h = lag(x, times)
    print(f'{name:22} rise is strongest {l:4d} ms after the written time; half-way up after {h} ms')

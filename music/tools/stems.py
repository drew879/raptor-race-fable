"""Measure the stems Live exported: is each one there, how loud, and how late do its notes speak."""
import sys, os, glob, subprocess, json
import numpy as np
from scipy.io import wavfile
from scipy.signal import correlate

D = sys.argv[1]
SR = 48000
BEAT = 0.5
def load(path):
    wav = path[:-5] + '.wav'
    if not os.path.exists(wav):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-ar', str(SR), '-c:a', 'pcm_f32le', wav], check=True)
    sr, x = wavfile.read(wav)
    assert sr == SR
    x = x.astype(np.float64)
    if x.ndim == 1: x = np.stack([x, x], 1)
    return x
def db(v): return 20 * np.log10(max(v, 1e-9))
def env(x, hop=48):  # 1 ms steps
    m = np.abs(x).mean(1)
    n = len(m) // hop
    return m[: n * hop].reshape(n, hop).mean(1)
def onset_lag(x, times, span=0.12):
    """How many ms after the written times the sound's rise comes, by matching a spike train to the rise of the envelope."""
    e = env(x)
    rise = np.maximum(0, np.diff(e, prepend=e[0]))
    spikes = np.zeros_like(rise)
    for t in times:
        i = int(round(t * 1000))
        if 0 <= i < len(spikes): spikes[i] = 1
    lags = np.arange(-40, int(span * 1000))
    score = [np.dot(rise[max(0, l):len(rise) + min(0, l)], spikes[max(0, -l):len(spikes) - max(0, l)]) for l in lags]
    return int(lags[int(np.argmax(score))])
out = {}
for path in sorted(glob.glob(D + '/*.flac')):
    name = os.path.basename(path)[:-5]
    x = load(path)
    dur = len(x) / SR
    seg = x[int(16 * SR): int(32 * SR)]          # the loop's second time through
    end = x[int(46 * SR): int(56 * SR)]          # the dash bar and the landing
    lng = x[int(64 * SR): int(72 * SR)]          # the long build
    out[name] = dict(dur=round(dur, 2), peak=round(db(np.abs(x).max()), 1), loop_rms=round(db(np.sqrt((seg ** 2).mean())), 1), loop_peak=round(db(np.abs(seg).max()), 1),
                     end_rms=round(db(np.sqrt((end ** 2).mean())), 1), long_rms=round(db(np.sqrt((lng ** 2).mean())), 1))
    print(f"{name:45} {dur:6.2f}s peak {out[name]['peak']:6.1f}  loop rms {out[name]['loop_rms']:6.1f} peak {out[name]['loop_peak']:6.1f}  end rms {out[name]['end_rms']:6.1f}  long rms {out[name]['long_rms']:6.1f}")
json.dump(out, open(D + '/levels.json', 'w'), indent=1)

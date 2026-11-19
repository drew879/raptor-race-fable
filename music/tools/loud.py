"""K-weighted loudness (BS.1770, no gating) of a stretch of a file."""
import numpy as np
from scipy.io import wavfile
from scipy.signal import lfilter
def kweight(x, sr):
    assert sr == 48000
    x = lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x, axis=0)
    return lfilter([1.0, -2.0, 1.0], [1, -1.99004745483398, 0.99007225036621], x, axis=0)
def read(path):
    sr, x = wavfile.read(path)
    x = x.astype(np.float64)
    if x.ndim == 1: x = np.stack([x, x], 1)
    return sr, x
def lk(x, sr, a=None, b=None):
    y = kweight(x, sr)
    y = y[int((a or 0) * sr): int(b * sr) if b else None]
    return -0.691 + 10 * np.log10(max((y ** 2).mean(0).sum(), 1e-12))
def peak(x, sr, a, b):
    return 20 * np.log10(max(np.abs(x[int(a * sr): int(b * sr)]).max(), 1e-9))
def momentary(x, sr, a, b, win=0.1):
    """The loudest stretch of `win` seconds, K-weighted: how loud the hits are, however far apart."""
    y = kweight(x, sr)[int(a * sr): int(b * sr)]
    p = (y ** 2).sum(1)
    n = int(win * sr)
    c = np.cumsum(np.concatenate([[0], p]))
    m = (c[n:] - c[:-n]) / n
    # the mean of the top hits, not the single loudest: the 95th percentile of the windows that hold a hit
    return -0.691 + 10 * np.log10(max(np.percentile(m, 99), 1e-12))

"""Rough tempo + energy profile for music candidates (cannot listen, so measure).
Usage: python audio_tempo.py <paths.txt> <out.json>
Per file (first 90 s, mono 22.05 kHz): spectral-flux onset envelope ->
autocorrelation peak in 70..190 BPM (may be half/double of the felt tempo),
onset density (onsets/s), 1 s-RMS spread (dynamics), high-band (>2 kHz)
share (distortion/cymbal brightness proxy), spectral flatness (noisiness,
distorted guitars and noise-heavy mixes read higher). ASCII only.
"""
import sys, json, subprocess
import numpy as np

SR = 22050

def decode(p):
    r = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-t", "90", "-i", p, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)

def analyse(p):
    x = decode(p)
    n = 1024
    hop = 512
    nf = 1 + (len(x) - n) // hop
    if nf < 100:
        return {"error": "too short"}
    win = np.hanning(n)
    mags = np.empty((nf, n // 2 + 1))
    for i in range(nf):
        mags[i] = np.abs(np.fft.rfft(x[i * hop:i * hop + n] * win))
    lm = np.log1p(mags)
    flux = np.maximum(lm[1:] - lm[:-1], 0).sum(axis=1)
    flux = flux - np.convolve(flux, np.ones(16) / 16, mode="same")
    flux = np.maximum(flux, 0)
    fps = SR / hop
    ac = np.correlate(flux, flux, mode="full")[len(flux) - 1:]
    lo = int(fps * 60 / 190)
    hi = int(fps * 60 / 70)
    lag = lo + int(np.argmax(ac[lo:hi]))
    bpm = 60 * fps / lag
    thr = flux.mean() + 1.5 * flux.std()
    peaks = np.where((flux[1:-1] > thr) & (flux[1:-1] >= flux[:-2]) & (flux[1:-1] >= flux[2:]))[0]
    dens = len(peaks) / (len(x) / SR)
    s = SR
    k = len(x) // s
    e = 20 * np.log10(np.maximum(np.sqrt(np.mean(x[:k * s].reshape(k, s) ** 2, axis=1)), 1e-9))
    spec = (mags ** 2).sum(axis=0)
    f = np.fft.rfftfreq(n, 1.0 / SR)
    hi_share = float(spec[f >= 2000].sum() / spec.sum())
    ps = spec[1:] + 1e-18
    flat = float(np.exp(np.mean(np.log(ps))) / np.mean(ps))
    return {"bpm_est": round(float(bpm), 1), "onsets_per_s": round(float(dens), 2),
            "rms1s_p10_p90_db": [round(float(np.percentile(e, 10)), 1), round(float(np.percentile(e, 90)), 1)],
            "gt2k_share": round(hi_share, 3), "flatness": round(flat, 4), "analysed_s": round(len(x) / SR, 1)}

res = {}
for p in [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]:
    try:
        res[p] = analyse(p)
    except Exception as ex:
        res[p] = {"error": repr(ex)[:200]}
    print(p.split("/")[-1][:60], res[p], flush=True)
json.dump(res, open(sys.argv[2], "w", encoding="utf-8"), indent=1)

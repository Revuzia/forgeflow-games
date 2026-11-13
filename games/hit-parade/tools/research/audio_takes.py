"""Segment multi-take SFX files into individual takes (silence-gap split).
Usage: python audio_takes.py <paths.txt> <out.json> [--gap-ms 120] [--floor-db 35]
A take = run of 10 ms frames whose RMS is within --floor-db of the file's
loudest frame, bridged across gaps shorter than --gap-ms. For each take:
start/end ms, peak frame dBFS, rms dBFS, centroid Hz, low (<150 Hz) share,
high (>4 kHz) share. Mono downmix, 44.1 kHz. ASCII only.
"""
import sys, json, subprocess, argparse
import numpy as np

def decode(path, sr=44100):
    p = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)

def spec_stats(seg, sr):
    if len(seg) < 1024:
        seg = np.pad(seg, (0, 1024 - len(seg)))
    n = 1 << int(np.ceil(np.log2(min(len(seg), 1 << 16))))
    s = np.abs(np.fft.rfft(seg[:n] * np.hanning(min(n, len(seg[:n]))), n)) ** 2
    f = np.fft.rfftfreq(n, 1.0 / sr)
    t = s.sum() + 1e-18
    return int((s * f).sum() / t), round(float(s[f < 150].sum() / t), 3), round(float(s[f >= 4000].sum() / t), 3)

def takes(path, gap_ms, floor_db, sr=44100):
    x = decode(path, sr)
    hop = int(sr * 0.01)
    n = len(x) // hop
    if n < 3:
        return []
    fr = x[: n * hop].reshape(n, hop)
    e = 20 * np.log10(np.maximum(np.sqrt(np.mean(fr * fr, axis=1)), 1e-9))
    thr = e.max() - floor_db
    on = e > thr
    segs = []
    i = 0
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            segs.append([i, j])
            i = j
        else:
            i += 1
    merged = []
    for s in segs:
        if merged and (s[0] - merged[-1][1]) * 10 < gap_ms:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    out = []
    for a, b in merged:
        if (b - a) < 3:
            continue
        seg = x[a * hop: b * hop]
        c, lo, hi = spec_stats(seg, sr)
        out.append({"start_ms": a * 10, "end_ms": b * 10, "len_ms": (b - a) * 10,
                    "peak_db": round(float(e[a:b].max()), 1),
                    "rms_db": round(float(20 * np.log10(max(np.sqrt(np.mean(seg * seg)), 1e-9))), 1),
                    "centroid_hz": c, "lt150": lo, "gt4k": hi})
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths")
    ap.add_argument("out")
    ap.add_argument("--gap-ms", type=float, default=120)
    ap.add_argument("--floor-db", type=float, default=35)
    a = ap.parse_args()
    res = {}
    for p in [l.strip() for l in open(a.paths, encoding="utf-8") if l.strip()]:
        t = takes(p, a.gap_ms, a.floor_db)
        res[p] = t
        print(len(t), "takes", p[-90:], flush=True)
    json.dump(res, open(a.out, "w", encoding="utf-8"), indent=1)

if __name__ == "__main__":
    main()

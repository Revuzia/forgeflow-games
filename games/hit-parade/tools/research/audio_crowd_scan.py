"""Scan long crowd / ambience recordings for usable regions.
Usage: python audio_crowd_scan.py <paths.txt> <out.json>
Decodes the WHOLE file to 16 kHz mono and reports:
  - bursts: top 8 non-overlapping 3 s windows by RMS (candidate cheer / reaction
    bursts), with each window's rise over the file median (dB), spectral
    flatness (noise-like crowd ~ high, whistle/tonal ~ low) and centroid Hz
  - beds: best 3 non-overlapping 20 s windows for a loop bed = level within
    6 dB of the file's 75th percentile and the lowest 500 ms-RMS spread
  - dips: top 4 3 s windows with the sharpest level DROP after a peak
    (candidate gasp/ooh-then-silence moments are not detectable; reported only
    as level shape)
ASCII only.
"""
import sys, json, subprocess
import numpy as np

SR = 16000

def decode(p):
    r = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", p, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)

def db(v):
    return 20 * np.log10(np.maximum(v, 1e-9))

def win_stats(seg):
    n = 2048
    if len(seg) < n:
        return 0, 0.0
    idx = np.linspace(0, len(seg) - n, min(40, max(1, len(seg) // n))).astype(int)
    spec = np.zeros(n // 2 + 1)
    for i in idx:
        spec += np.abs(np.fft.rfft(seg[i:i + n] * np.hanning(n))) ** 2
    f = np.fft.rfftfreq(n, 1.0 / SR)
    ps = spec[1:] + 1e-18
    return int((spec * f).sum() / (spec.sum() + 1e-18)), round(float(np.exp(np.mean(np.log(ps))) / np.mean(ps)), 4)

def scan(p):
    x = decode(p)
    if len(x) < SR * 4:
        return {"error": "too short"}
    h = SR // 2
    n = len(x) // h
    e = db(np.sqrt(np.mean(x[: n * h].reshape(n, h) ** 2, axis=1)))
    med = float(np.median(e))
    p75 = float(np.percentile(e, 75))
    out = {"duration_s": round(len(x) / SR, 1), "median_db": round(med, 1), "p75_db": round(p75, 1),
           "p95_db": round(float(np.percentile(e, 95)), 1), "max_db": round(float(e.max()), 1)}
    # bursts: 3 s windows = 6 half-second frames
    w = 6
    cs = np.convolve(10 ** (e / 10), np.ones(w) / w, mode="valid")
    cdb = 10 * np.log10(np.maximum(cs, 1e-18))
    order = np.argsort(-cdb)
    used = np.zeros(len(cdb), bool)
    bursts = []
    for i in order:
        if used[max(0, i - w):i + w].any():
            continue
        used[i] = True
        seg = x[i * h:(i + w) * h]
        c, fl = win_stats(seg)
        bursts.append({"start_s": round(i * 0.5, 1), "end_s": round((i + w) * 0.5, 1),
                       "level_db": round(float(cdb[i]), 1), "over_median_db": round(float(cdb[i] - med), 1),
                       "centroid_hz": c, "flatness": fl})
        if len(bursts) >= 8:
            break
    out["bursts"] = bursts
    # beds: 20 s windows = 40 frames
    W = 40
    beds = []
    if n > W:
        cand = []
        for i in range(0, n - W, 4):
            s = e[i:i + W]
            lvl = 10 * np.log10(np.mean(10 ** (s / 10)))
            if abs(lvl - p75) <= 6:
                cand.append((float(np.percentile(s, 90) - np.percentile(s, 10)), i, float(lvl)))
        cand.sort()
        taken = []
        for spread, i, lvl in cand:
            if any(abs(i - j) < W for j in taken):
                continue
            taken.append(i)
            seg = x[i * h:(i + W) * h]
            c, fl = win_stats(seg)
            beds.append({"start_s": round(i * 0.5, 1), "end_s": round((i + W) * 0.5, 1), "level_db": round(lvl, 1),
                         "spread_db": round(spread, 1), "centroid_hz": c, "flatness": fl,
                         "seam_db": round(float(abs(e[i] - e[i + W - 1])), 1)})
            if len(beds) >= 3:
                break
    out["beds"] = beds
    # dips: sharpest drop from a 1.5 s window to the following 1.5 s window
    d = []
    for i in range(3, n - 3):
        a = 10 * np.log10(np.mean(10 ** (e[i - 3:i] / 10)))
        b = 10 * np.log10(np.mean(10 ** (e[i:i + 3] / 10)))
        d.append((a - b, i))
    d.sort(reverse=True)
    dips = []
    for drop, i in d:
        if any(abs(i - j["_i"]) < 8 for j in dips):
            continue
        dips.append({"_i": i, "at_s": round(i * 0.5, 1), "drop_db": round(float(drop), 1)})
        if len(dips) >= 4:
            break
    for j in dips:
        del j["_i"]
    out["dips"] = dips
    return out

import os
res = {}
if os.path.exists(sys.argv[2]):
    res = json.load(open(sys.argv[2], encoding="utf-8"))
for p in [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]:
    if p in res:
        continue
    res[p] = scan(p)
    print(p[-80:], json.dumps(res[p].get("bursts", [])[:2]), flush=True)
    json.dump(res, open(sys.argv[2], "w", encoding="utf-8"), indent=1)

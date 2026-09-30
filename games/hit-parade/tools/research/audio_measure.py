"""HIT PARADE audio research: measure a list of audio files.

Usage:
  python audio_measure.py <paths.txt> <out.jsonl> [--max-sec 120] [--workers 8]

For every path: ffprobe (duration/channels/rate/codec/size), ffmpeg ebur128 +
volumedetect (integrated LUFS, true peak, LRA, mean/max volume), and a numpy
pass on a mono mixdown (sample peak, RMS, spectral centroid, band energy
split, onset/peak/decay timing, transient count, leading silence, envelope
spread). Files longer than --max-sec are analysed on their first --max-sec
seconds only (flag "analysed_sec" records it).
Resumable: paths already present in out.jsonl are skipped.
ASCII only.
"""
import sys, os, json, subprocess, re, argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np

FFPROBE = "ffprobe"
FFMPEG = "ffmpeg"


def run(cmd, binary=False, timeout=600):
    if cmd[0] == FFMPEG and "-nostdin" not in cmd:
        cmd = [cmd[0], "-nostdin"] + cmd[1:]
    p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if binary:
        return p.returncode, p.stdout, p.stderr.decode("utf-8", "replace")
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def probe(path):
    rc, out, err = run([FFPROBE, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path])
    if rc != 0:
        return {"probe_error": err.strip()[:300]}
    j = json.loads(out)
    st = [s for s in j.get("streams", []) if s.get("codec_type") == "audio"]
    if not st:
        return {"probe_error": "no audio stream"}
    s = st[0]
    fmt = j.get("format", {})
    dur = s.get("duration") or fmt.get("duration")
    return {
        "codec": s.get("codec_name"),
        "channels": s.get("channels"),
        "sample_rate": int(s.get("sample_rate", 0) or 0),
        "bits": s.get("bits_per_raw_sample") or s.get("bits_per_sample"),
        "duration_s": round(float(dur), 3) if dur else None,
        "bit_rate": int(fmt.get("bit_rate", 0) or 0),
    }


def loudness(path, max_sec):
    cmd = [FFMPEG, "-hide_banner", "-nostats", "-t", str(max_sec), "-i", path,
           "-af", "ebur128=peak=true,volumedetect", "-f", "null", "-"]
    rc, out, err = run(cmd)
    res = {}
    # ebur128 summary block
    summ = err[err.rfind("Summary:"):] if "Summary:" in err else ""
    m = re.search(r"I:\s+(-?[\d.]+|-inf)\s+LUFS", summ)
    if m:
        res["lufs_i"] = None if "inf" in m.group(1) else float(m.group(1))
    m = re.search(r"LRA:\s+(-?[\d.]+)\s+LU", summ)
    if m:
        res["lra_lu"] = float(m.group(1))
    m = re.search(r"Peak:\s+(-?[\d.]+|-inf)\s+dBFS", summ)
    if m:
        res["true_peak_dbtp"] = None if "inf" in m.group(1) else float(m.group(1))
    m = re.search(r"mean_volume:\s+(-?[\d.]+|-inf) dB", err)
    if m:
        res["mean_volume_db"] = None if "inf" in m.group(1) else float(m.group(1))
    m = re.search(r"max_volume:\s+(-?[\d.]+|-inf) dB", err)
    if m:
        res["max_volume_db"] = None if "inf" in m.group(1) else float(m.group(1))
    return res


def analyse(path, max_sec, sr):
    cmd = [FFMPEG, "-hide_banner", "-v", "error", "-t", str(max_sec), "-i", path,
           "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    rc, raw, err = run(cmd, binary=True)
    if rc != 0 or not raw:
        return {"analyse_error": err.strip()[:300]}
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    n = len(x)
    res = {"analysed_sec": round(n / sr, 3)}
    if n < 64:
        return res
    peak = float(np.max(np.abs(x)))
    rms = float(np.sqrt(np.mean(x * x)))
    db = lambda v: round(20 * np.log10(max(v, 1e-9)), 1)
    res["sample_peak_dbfs"] = db(peak)
    res["rms_dbfs"] = db(rms)
    # 10 ms envelope
    hop = max(1, int(sr * 0.010))
    nfr = n // hop
    if nfr < 2:
        return res
    fr = x[: nfr * hop].reshape(nfr, hop)
    env = np.sqrt(np.mean(fr * fr, axis=1))
    envdb = 20 * np.log10(np.maximum(env, 1e-9))
    mx = float(envdb.max())
    ipk = int(envdb.argmax())
    above30 = np.where(envdb > mx - 30)[0]
    above40 = np.where(envdb > mx - 40)[0]
    res["lead_silence_ms"] = int(above40[0] * 10) if len(above40) else 0
    res["onset_ms"] = int(above30[0] * 10) if len(above30) else 0
    res["peak_ms"] = ipk * 10
    res["attack_ms"] = int(max(0, (ipk - (above30[0] if len(above30) else ipk)) * 10))
    res["decay30_ms"] = int((above30[-1] - ipk) * 10) if len(above30) else 0
    res["active_ms"] = int((above30[-1] - above30[0] + 1) * 10) if len(above30) else 0
    # transient count: local maxima of 10ms envelope that rise >= 9 dB above
    # the minimum of the previous 80 ms and sit within 20 dB of the max,
    # separated by >= 80 ms
    thr = mx - 20
    cnt = 0
    last = -1000
    onsets = []
    for i in range(8, nfr - 1):
        if envdb[i] >= thr and envdb[i] >= envdb[i - 1] and envdb[i] >= envdb[i + 1]:
            if envdb[i] - envdb[i - 8:i].min() >= 9 and (i - last) >= 8:
                cnt += 1
                last = i
                if len(onsets) < 40:
                    onsets.append(i * 10)
    # include a hit right at file start
    if envdb[:8].max() >= thr and (not onsets or onsets[0] > 80):
        cnt += 1
        onsets.insert(0, int(envdb[:8].argmax()) * 10)
    res["transients"] = cnt
    res["transient_ms"] = onsets[:40]
    # 100 ms envelope spread (steadiness of beds/loops)
    h2 = max(1, int(sr * 0.100))
    n2 = n // h2
    if n2 >= 5:
        f2 = x[: n2 * h2].reshape(n2, h2)
        e2 = 20 * np.log10(np.maximum(np.sqrt(np.mean(f2 * f2, axis=1)), 1e-9))
        act = e2[e2 > e2.max() - 50]
        if len(act) >= 3:
            p10, p50, p90 = np.percentile(act, [10, 50, 90])
            res["env100_p10_p50_p90_db"] = [round(float(p10), 1), round(float(p50), 1), round(float(p90), 1)]
            res["env100_spread_db"] = round(float(p90 - p10), 1)
        # loop seam: level of first vs last 100 ms
        res["seam_first_last_db"] = [round(float(e2[0]), 1), round(float(e2[-1]), 1)]
    # spectrum over the active region (energy-weighted frames of 2048)
    a0 = above30[0] * hop if len(above30) else 0
    a1 = (above30[-1] + 1) * hop if len(above30) else n
    seg = x[a0:a1]
    if len(seg) < 2048:
        seg = np.pad(seg, (0, 2048 - len(seg)))
    win = np.hanning(2048)
    step = 1024
    nseg = 1 + (len(seg) - 2048) // step
    if nseg > 400:
        idx = np.linspace(0, nseg - 1, 400).astype(int)
    else:
        idx = np.arange(nseg)
    spec = np.zeros(1025)
    for k in idx:
        s = seg[k * step: k * step + 2048] * win
        spec += np.abs(np.fft.rfft(s)) ** 2
    freqs = np.fft.rfftfreq(2048, 1.0 / sr)
    tot = spec.sum() + 1e-18
    res["centroid_hz"] = int((spec * freqs).sum() / tot)
    def band(lo, hi):
        m = (freqs >= lo) & (freqs < hi)
        return round(float(spec[m].sum() / tot), 3)
    res["band_lt150"] = band(0, 150)
    res["band_150_1k"] = band(150, 1000)
    res["band_1k_4k"] = band(1000, 4000)
    res["band_gt4k"] = band(4000, sr / 2 + 1)
    # spectral flatness (noisiness) 0..1
    ps = spec[1:] + 1e-18
    res["flatness"] = round(float(np.exp(np.mean(np.log(ps))) / np.mean(ps)), 4)
    return res


def measure(path, max_sec):
    rec = {"path": path.replace("\\", "/")}
    try:
        rec["size_bytes"] = os.path.getsize(path)
    except OSError as e:
        rec["error"] = str(e)
        return rec
    rec.update(probe(path))
    if "probe_error" in rec:
        return rec
    sr = 44100
    if (rec.get("duration_s") or 0) > 30:
        sr = 22050
    rec.update(loudness(path, max_sec))
    rec.update(analyse(path, max_sec, sr))
    rec["analysis_sr"] = sr
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths")
    ap.add_argument("out")
    ap.add_argument("--max-sec", type=float, default=120)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    paths = [l.strip() for l in open(a.paths, encoding="utf-8") if l.strip() and not l.startswith("#")]
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out, encoding="utf-8"):
            try:
                done.add(json.loads(l)["path"])
            except Exception:
                pass
    todo = [p for p in dict.fromkeys(paths) if p.replace("\\", "/") not in done]
    print("total", len(paths), "done", len(done), "todo", len(todo), flush=True)
    n = 0
    with open(a.out, "a", encoding="utf-8") as fo, ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(measure, p, a.max_sec): p for p in todo}
        for f in as_completed(futs):
            try:
                rec = f.result()
            except Exception as e:
                rec = {"path": futs[f].replace("\\", "/"), "error": repr(e)[:300]}
            fo.write(json.dumps(rec, default=lambda o: o.item() if hasattr(o, "item") else str(o)) + "\n")
            fo.flush()
            n += 1
            if n % 50 == 0:
                print("measured", n, flush=True)
    print("finished", n, flush=True)


if __name__ == "__main__":
    main()

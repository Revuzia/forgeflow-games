"""Print compact measurement rows for files whose path matches a regex.
Usage: python audio_query.py <measure.jsonl> <regex> [--sort key]
Columns: dur ch sr LUFS TP peak rms cent lt150 150-1k 1k-4k gt4k flat onset attack decay30 trans spread path
ASCII only.
"""
import sys, json, re

f, rx = sys.argv[1], re.compile(sys.argv[2], re.I)
key = None
if "--sort" in sys.argv:
    key = sys.argv[sys.argv.index("--sort") + 1]
rows = []
for l in open(f, encoding="utf-8"):
    r = json.loads(l)
    if rx.search(r["path"]):
        rows.append(r)
if key:
    rows.sort(key=lambda r: (r.get(key) is None, r.get(key) or 0))
else:
    rows.sort(key=lambda r: r["path"])
def g(r, k, fmt="%s"):
    v = r.get(k)
    return "-" if v is None else (fmt % v)
print("dur    ch sr    LUFS   TP    pk    rms   cent  <150  150-1k 1-4k  >4k   flat   on  atk dec30 tr spr  path")
for r in rows:
    p = r["path"]
    for pre in ["F:/games/forgeflow-games-assets/", "F:/games/unity-assets/"]:
        p = p.replace(pre, "")
    if "error" in r or "probe_error" in r:
        print("ERR", r.get("error") or r.get("probe_error"), p)
        continue
    print("%-6s %-2s %-5s %-6s %-5s %-5s %-5s %-5s %-5s %-6s %-5s %-5s %-6s %-4s %-3s %-5s %-2s %-4s %s" % (
        g(r, "duration_s"), g(r, "channels"), g(r, "sample_rate"), g(r, "lufs_i"), g(r, "true_peak_dbtp"),
        g(r, "sample_peak_dbfs"), g(r, "rms_dbfs"), g(r, "centroid_hz"), g(r, "band_lt150"), g(r, "band_150_1k"),
        g(r, "band_1k_4k"), g(r, "band_gt4k"), g(r, "flatness"), g(r, "onset_ms"), g(r, "attack_ms"),
        g(r, "decay30_ms"), g(r, "transients"), g(r, "env100_spread_db"), p[-95:]))
print(len(rows), "rows")

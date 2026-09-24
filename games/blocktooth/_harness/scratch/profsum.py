import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
n = int(sys.argv[2]) if len(sys.argv) > 2 else 25
print("gpuSupported", d["gpuSupported"], "frames", d["frames"], "gpuMean", d["gpuMean"], "gpuP", d["gpuP"])
print("rawP", d["rawP"], "cpuP", d["cpuP"])
print("mean", json.dumps(d["mean"]))
print("max ", json.dumps(d["max"]))
def top(sec, k=5):
    return " ".join("%s=%.1f" % kv for kv in sorted(sec.items(), key=lambda kv: -kv[1])[:k])
for f in d["worst"][:n]:
    p = f.get("prev") or {}
    print("#%d raw %.1f | cur: cpu %.1f gpu %.1f sim %.1f/%dt dHeap %dK prog%+d geo%+d tex%+d %s [%s] %s" % (
        f["id"], f["raw"], f["cpu"], f["gpu"], f["sim"], f["ticks"], f["dHeap"], f["dProg"], f["dGeo"], f["dTex"], f["screen"], f["note"], top(f["sec"])))
    if p:
        print("      prev: cpu %.1f gpu %.1f sim %.1f/%dt dHeap %dK prog%+d geo%+d tex%+d %s [%s] %s" % (
            p["cpu"], p["gpu"], p["sim"], p["ticks"], p["dHeap"], p["dProg"], p["dGeo"], p["dTex"], p["screen"], p["note"], top(p["sec"])))
print("LoAF >= 50ms:")
for l in d["loaf"]:
    if l["dur"] >= 50:
        print("  t%d dur %d block %d render %d style %d | %s" % (l["t"], l["dur"], l["block"], l["render"], l["style"], " ; ".join(l["scripts"][:4])))

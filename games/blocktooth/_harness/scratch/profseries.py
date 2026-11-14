import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
S = d["series"]
tot = {0: [0, 0], 1: [0, 0]}
for i, (raw, cpu, gpu, ticks, dh, play, *_r) in enumerate(S):
    tot[play][0] += 1
    if raw > 30: tot[play][1] += 1
print("frames play: %d (%d > 30ms) · non-play(draft etc): %d (%d > 30ms)" % (tot[1][0], tot[1][1], tot[0][0], tot[0][1]))
neg = [(i, dh, S[i][0], S[i+1][0] if i + 1 < len(S) else None) for i, s in enumerate(S) for dh in [s[4]] if dh < 0]
print("heap drops (GC) — idx, dHeapK, raw this, raw next:", neg[:40])
g = [s[2] for s in S if s[2] >= 0]
print("gpu>18:", sum(1 for x in g if x > 18), "of", len(g))
# transitions
line = "".join("D" if not s[5] else ("#" if s[0] > 30 else ".") for s in S)
for k in range(0, len(line), 120): print(line[k:k+120])

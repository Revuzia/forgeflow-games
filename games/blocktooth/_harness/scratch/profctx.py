import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
S = d["series"]
thr = float(sys.argv[2]) if len(sys.argv) > 2 else 30
for i, s in enumerate(S):
    if s[0] > thr or s[6] > 12 or s[7]:
        lo, hi = max(0, i - 2), min(len(S), i + 2)
        print("---", i)
        for j in range(lo, hi):
            r = S[j]
            print("  %s idx %d id %d raw %.1f cpu %.1f gpu %.1f ticks %d dHeap %d %s render %.1f %s" % (
                "*" if j == i else " ", j, r[8], r[0], r[1], r[2], r[3], r[4], "play" if r[5] else "DRAFT", r[6], r[7]))

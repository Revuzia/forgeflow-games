import json, sys
for fn in sys.argv[1:]:
    d = json.load(open(fn, encoding="utf-8"))
    ft = [x for x in d["ft"] if x > 0]
    print("==", fn.split("\\")[-1].split("/")[-1], "n", len(ft), "over22", sum(1 for x in ft if x > 22), "22-30:", [round(x,1) for x in ft if 22 < x <= 30], ">30:", [round(x,1) for x in ft if x > 30])
    P = d.get("prof")
    if not isinstance(P, dict): continue
    S = P["series"]  # [raw, cpu, gpu, ticks, dHeap, play, render, note, id, scale]
    for i, s in enumerate(S):
        if s[0] > 22:
            ctx = S[max(0, i-3):i+2]
            print("  #%d raw %.1f" % (s[8], s[0]), " | ".join("%s%.0f c%.1f g%.1f %s %s %s" % ("*" if c is s else "", c[0], c[1], c[2], "P" if c[5] else "D", c[9], (c[7] or "")[:40]) for c in ctx))

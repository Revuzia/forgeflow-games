import json, sys
for fn in sys.argv[1:]:
    d = json.load(open(fn, encoding="utf-8")); S = d["series"]
    cats = {}
    for i, s in enumerate(S):
        if s[0] <= 22: continue
        p = S[i-1] if i else None
        pn = (p[7] or '') if p else ''
        if 'resize' in pn or 'resize' in (s[7] or ''): c = 'resize-stall'
        elif p and p[1] > 15: c = 'cpu-heavy-prev(%s %.0fms)' % (pn[:12], p[1])
        elif p and p[4] < -5000 or s[4] < -5000: c = 'gc'
        elif not s[5] and p and p[5]: c = 'draft-open'
        elif s[5] and p and not p[5]: c = 'draft-close'
        elif not s[5]: c = 'in-draft'
        else: c = 'play-gpu'
        cats[c] = cats.get(c, 0) + 1
    notes = [x[7] for x in S if x[7] and ('dyn' in x[7])]
    sc = {}
    for x in S:
        if len(x) > 9: sc[x[9]] = sc.get(x[9], 0) + 1
    ov = {}
    for x in S:
        if len(x) > 9 and x[0] > 22 and x[5]: ov[x[9]] = ov.get(x[9], 0) + 1
    print(fn.split("-")[-1], "over22:", sum(cats.values()), cats, notes, "scale frames", sc, "play-over by scale", ov)

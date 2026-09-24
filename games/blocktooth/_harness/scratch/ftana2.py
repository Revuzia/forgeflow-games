import json, sys
for fn in sys.argv[1:]:
    d = json.load(open(fn, encoding="utf-8"))
    ft = [x for x in d["ft"] if x > 0]
    sc = d.get("scale") or []
    scales = {}
    t0 = d.get("t0") or 0
    path = []
    for t, s, scr, dy in sc:
        if t >= t0: scales[s] = scales.get(s, 0) + 1
        if not path or path[-1][1] != s: path.append((round(t - t0, 1), s))
    last = sc[-1][3] if sc else None
    first = sc[0][3] if sc else None
    print(path); print("%s over22 %d (>30: %d) scales %s dynres first %s last %s" % (fn.split("-")[-1], sum(1 for x in ft if x > 22), sum(1 for x in ft if x > 30), scales, first, last))

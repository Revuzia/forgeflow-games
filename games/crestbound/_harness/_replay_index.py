import json, glob, os, re, sys
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_playreports")
out = []
def g(x, *keys):
    for k in keys:
        if k in x and x[k]: return x[k]
    return ""
for f in sorted(glob.glob(os.path.join(D, "*.json"))):
    b = os.path.basename(f)
    if b.startswith("_") or b.endswith(".worked.json"): continue
    course = b[:-5]
    d = json.load(open(f, encoding="utf-8"))
    for i, x in enumerate(d.get("defects", [])):
        did = g(x, "did", "what_i_did", "what")
        hap = g(x, "happened", "what_happened")
        sho = g(x, "should", "what_should_happen")
        out.append({
            "key": "%s#%02d" % (course, i),
            "course": course,
            "id": x.get("id") or x.get("seg") or "",
            "sev": str(g(x, "severity", "sev")),
            "where": g(x, "where"),
            "did": did, "happened": hap, "should": sho,
            "png": x.get("png", ""), "note": g(x, "note", "evidence"),
            "owner_item": x.get("owner_item", ""),
        })
json.dump(out, open(os.path.join(D, "_defects_index.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("defects:", len(out))

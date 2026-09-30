"""Measure Tekken 8 frame data per MOVE CLASS across the roster.

Source: wavu.wiki Cargo table "Move" (Tekken 8 movelists),
https://wavu.wiki/w/api.php?action=cargoquery&tables=Move
Usage:
  python fg_t8_class_stats.py <cache_dir> <out_txt>
Parsing takes the first signed integer of a cell ("i12~14" -> 12,
"+20a (+15)" -> 20). Only single-input (non-string-continuation) moves are
classified, i.e. rows whose input does not start with ",".
ASCII only.
"""
import json
import os
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request

API = "https://wavu.wiki/w/api.php"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")
FIELDS = "id,name,input,target,damage,startup,recv,tot,block,hit,ch,crush"


def get_json(params, tries=4):
    url = API + "?" + urllib.parse.urlencode(params)
    delay = 2.0
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            print("retry", type(e).__name__, e)
            time.sleep(delay)
            delay *= 2
    raise SystemExit("FAILED: " + url)


def fetch_all(cache):
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return json.load(f)
    rows, offset = [], 0
    while True:
        d = get_json({"action": "cargoquery", "tables": "Move",
                      "fields": FIELDS, "limit": 500, "offset": offset,
                      "format": "json"})
        batch = [r["title"] for r in d.get("cargoquery", [])]
        rows.extend(batch)
        if len(batch) < 500:
            break
        offset += 500
        time.sleep(0.8)
    with open(cache, "w", encoding="utf-8") as f:
        json.dump(rows, f)
    return rows


def s(v):
    return "" if v is None else re.sub(r"\[\[[^|\]]*\|([^\]]*)\]\]", r"\1",
                                       str(v)).strip()


def first_int(v):
    m = re.search(r"[-+]?\d+", s(v))
    return int(m.group(0)) if m else None


def chara(r):
    return s(r.get("id")).split("-")[0]


def classify(r):
    inp = s(r.get("input"))
    if not inp or inp.startswith(","):
        return None
    mid = s(r.get("id"))
    rest = mid.split("-", 1)[1] if "-" in mid else ""
    if rest != inp:  # stance-prefixed or odd ids: skip for purity
        return None
    tgt = s(r.get("target")).lower()
    hit = s(r.get("hit"))
    name = s(r.get("name")).lower()
    if "rage art" in name:
        return "rage art"
    if inp == "2+3":
        return "heat burst (2+3)"
    if tgt.startswith("th"):
        if inp in ("1+3", "2+4"):
            return "generic throw (1+3 / 2+4)"
        return "command throw"
    if inp == "1":
        return "jab (1)"
    if inp == "2":
        return "right punch (2)"
    if inp == "df+1":
        return "mid check (df+1)"
    if inp in ("d+4", "d+3") and tgt in ("l", "sl"):
        return "low poke (d+3/d+4)"
    if "," in tgt:
        return None
    if re.search(r"\d+a\b", hit) or re.search(r"\d+a \(", hit):
        return "launcher (single input, 'a' on hit)"
    if tgt == "l":
        return "other single low"
    if tgt == "m":
        return "other single mid"
    if tgt == "h":
        return "other single high"
    return None


def summarize(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return "-"
    med = statistics.median(vals)
    ms = ("%.1f" % med) if med != int(med) else "%d" % med
    return "%s [%d..%d] n=%d" % (ms, min(vals), max(vals), len(vals))


def main():
    cache_dir, out_txt = sys.argv[1], sys.argv[2]
    os.makedirs(cache_dir, exist_ok=True)
    rows = fetch_all(os.path.join(cache_dir, "t8_moves.json"))
    classes = {}
    for r in rows:
        c = classify(r)
        if c:
            classes.setdefault(c, []).append(r)
    out = ["Tekken 8 per-move-class statistics (median [min..max] n)",
           "source: https://wavu.wiki (Cargo table Move)",
           "rows fetched: %d ; characters: %d" % (
               len(rows), len(set(chara(r) for r in rows))), ""]
    order = ["jab (1)", "right punch (2)", "mid check (df+1)",
             "low poke (d+3/d+4)", "other single high", "other single mid",
             "other single low", "launcher (single input, 'a' on hit)",
             "generic throw (1+3 / 2+4)", "command throw",
             "heat burst (2+3)", "rage art"]
    for c in order:
        rs = classes.get(c, [])
        out.append("== %s (rows=%d)" % (c, len(rs)))
        for fname in ("startup", "recv", "tot", "block", "hit", "damage"):
            out.append("   %-8s %s" % (fname, summarize(
                [first_int(r.get(fname)) for r in rs])))
        out.append("")
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()

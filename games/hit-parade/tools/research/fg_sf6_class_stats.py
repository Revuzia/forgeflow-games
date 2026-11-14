"""Measure SF6 frame data per MOVE CLASS across the whole roster.

Source: SuperCombo wiki Cargo tables SF6_FrameData + SF6_CharacterData
(https://wiki.supercombo.gg/w/Street_Fighter_6/Game_Data), queried through
https://wiki.supercombo.gg/api.php?action=cargoquery .

Usage:
  python fg_sf6_class_stats.py <cache_dir> <out_txt>
Raw JSON is cached in cache_dir (scratchpad); the summary goes to out_txt.
Only numbers present in the table are reported; parsing takes the FIRST signed
integer of a cell (e.g. "12(10)" -> 12, "KD +40" -> 40 with KD flag).
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

API = "https://wiki.supercombo.gg/api.php"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")
FD_FIELDS = ("moveId,moveType,chara,input,name,damage,chip,startup,active,"
             "recovery,guard,hitAdv,blockAdv,hitstun,blockstun,hitstop,"
             "driveDmgBlk,driveDmgHit,driveGain,superGainHit,superGainBlk,"
             "invuln,jugStart,jugIncrease,jugLimit,atkRange,pushbackHit,"
             "pushbackBlk,projSpeed")
CD_FIELDS = ("name,hp,throwRange,throwHurtbox,fwdWalkSpd,bwdWalkSpd,"
             "fwdDashSpd,bwdDashSpd,fwdDashDist,bwdDashDist,jumpSpd,"
             "fwdJumpDist,bwdJumpDist,jumpApex")


def get_json(params, tries=4):
    url = API + "?" + urllib.parse.urlencode(params)
    delay = 2.0
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # transient -> backoff
            print("retry", type(e).__name__, e)
            time.sleep(delay)
            delay *= 2
    raise SystemExit("FAILED after retries: " + url)


def cargo_all(table, fields, cache):
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return json.load(f)
    rows, offset = [], 0
    while True:
        d = get_json({"action": "cargoquery", "tables": table,
                      "fields": fields, "limit": 500, "offset": offset,
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


def clean(v):
    if v is None:
        return ""
    v = re.sub(r"<[^>]+>", "", v).replace("'''", "").replace("''", "")
    return "" if v.startswith("{{{") else v.strip()


def first_int(v):
    m = re.search(r"[-+]?\d+", clean(v))
    return int(m.group(0)) if m else None


def first_float(v):
    m = re.search(r"[-+]?\d+(?:\.\d+)?", clean(v))
    return float(m.group(0)) if m else None


def classify(r):
    mt = clean(r.get("moveType")).lower()
    inp = clean(r.get("input"))
    name = clean(r.get("name")).lower()
    act = clean(r.get("active"))
    sg = first_int(r.get("superGainHit"))
    if mt == "ground_normal":
        base = inp
        table = {"5LP": "stand light", "5LK": "stand light",
                 "2LP": "crouch light", "2LK": "crouch light",
                 "5MP": "stand medium", "5MK": "stand medium",
                 "2MP": "crouch medium", "2MK": "crouch medium",
                 "5HP": "stand heavy", "5HK": "stand heavy",
                 "2HP": "crouch heavy (2HP)", "2HK": "sweep (2HK)"}
        if base in table:
            return table[base]
        if re.fullmatch(r"[346]\w\w", base) and "~" not in base:
            return "command normal (dir+button)"
        return None
    if mt == "air_normal":
        if inp in ("j.LP", "j.LK"):
            return "air light"
        if inp in ("j.MP", "j.MK"):
            return "air medium"
        if inp in ("j.HP", "j.HK"):
            return "air heavy"
        return None
    if mt == "throw" and inp in ("LPLK",):
        return "normal throw (fwd)"
    if mt == "drive":
        if inp == "HPHK":
            return "drive impact"
        return None
    if mt == "super":
        if sg is not None and sg <= -30000:
            return "super Lv3/CA"
        if sg is not None and sg <= -20000:
            return "super Lv2"
        if sg is not None and sg <= -10000:
            return "super Lv1"
        return None
    if mt == "special":
        # skip OD (EX) versions: they cost drive (superGain -20000 in the
        # driveGain column for OD, flagged by double-button inputs)
        od = bool(re.search(r"(PP|KK)$", inp))
        if od:
            return None
        if re.match(r"623[LMH][PK]$", inp):
            return "DP / anti-air reversal (623)"
        if (re.match(r"236[LMH]P$", inp) and act in ("-", "")) or \
                any(w in name for w in ("hadoken", "sonic boom",
                                        "yoga fire", "sand blast",
                                        "tiger shot", "fireball")):
            return "projectile (236P-class)"
        g = clean(r.get("guard")).upper()
        if g == "T" or "throw" in g.lower() or "grab" in name or \
                "screw piledriver" in name or "piledriver" in name:
            return "command grab"
        return None
    return None


FIELDS = [("startup", first_int), ("active", first_int),
          ("recovery", first_int), ("hitAdv", first_int),
          ("blockAdv", first_int), ("damage", first_int),
          ("hitstun", first_int), ("blockstun", first_int),
          ("hitstop", first_int), ("driveGain", first_int),
          ("superGainHit", first_int), ("driveDmgBlk", first_int),
          ("pushbackBlk", first_float), ("atkRange", first_float)]


def summarize(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return "-"
    med = statistics.median(vals)
    if isinstance(med, float) and med != int(med):
        ms = "%.2f" % med
    else:
        ms = "%g" % med
    return "%s [%g..%g] n=%d" % (ms, min(vals), max(vals), len(vals))


def main():
    cache_dir, out_txt = sys.argv[1], sys.argv[2]
    os.makedirs(cache_dir, exist_ok=True)
    fd = cargo_all("SF6_FrameData", FD_FIELDS,
                   os.path.join(cache_dir, "sf6_framedata.json"))
    cd = cargo_all("SF6_CharacterData", CD_FIELDS,
                   os.path.join(cache_dir, "sf6_chardata.json"))
    out = []
    p = out.append
    p("SF6 per-move-class statistics (median [min..max] n=rows)")
    p("source: https://wiki.supercombo.gg (Cargo SF6_FrameData, SF6_CharacterData)")
    p("frame-data rows fetched: %d ; characters: %d" % (len(fd), len(cd)))
    p("")
    classes = {}
    kd = {}
    for r in fd:
        c = classify(r)
        if not c:
            continue
        classes.setdefault(c, []).append(r)
        if "KD" in clean(r.get("hitAdv")).upper():
            kd[c] = kd.get(c, 0) + 1
    order = ["stand light", "crouch light", "stand medium", "crouch medium",
             "stand heavy", "crouch heavy (2HP)", "sweep (2HK)",
             "command normal (dir+button)", "air light", "air medium",
             "air heavy", "normal throw (fwd)", "projectile (236P-class)",
             "DP / anti-air reversal (623)", "command grab", "drive impact",
             "super Lv1", "super Lv2", "super Lv3/CA"]
    for c in order:
        rows = classes.get(c, [])
        p("== %s (rows=%d, knockdown-on-hit rows=%d)" %
          (c, len(rows), kd.get(c, 0)))
        for fname, fn in FIELDS:
            p("   %-13s %s" % (fname, summarize([fn(r.get(fname))
                                                 for r in rows])))
        if c in ("command grab", "DP / anti-air reversal (623)",
                 "projectile (236P-class)"):
            ex = sorted(set("%s %s" % (clean(r.get("chara")),
                                       clean(r.get("input"))) for r in rows))
            p("   examples: " + "; ".join(ex[:24]))
        if c.startswith("DP"):
            inv = [clean(r.get("invuln")) for r in rows if clean(r.get("invuln"))]
            p("   invuln cells: " + "; ".join(sorted(set(inv))[:12]))
        p("")
    # character data
    p("== Character data (SF6_CharacterData)")
    for fname in ("hp", "throwRange", "throwHurtbox", "fwdWalkSpd",
                  "bwdWalkSpd", "fwdDashDist", "bwdDashDist", "fwdJumpDist",
                  "jumpApex"):
        p("   %-13s %s" % (fname, summarize([first_float(r.get(fname))
                                             for r in cd])))
    p("   jumpSpd cells: " + "; ".join(sorted(set(
        clean(r.get("jumpSpd")) for r in cd if clean(r.get("jumpSpd"))))))
    p("")
    p("   per character: name | hp | throwRange | fwdWalk | bwdWalk | fwdDash | bwdDash")
    for r in sorted(cd, key=lambda r: clean(r.get("name"))):
        p("   %s | %s | %s | %s | %s | %s | %s" % tuple(
            clean(r.get(k)) for k in ("name", "hp", "throwRange",
                                      "fwdWalkSpd", "bwdWalkSpd",
                                      "fwdDashDist", "bwdDashDist")))
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()

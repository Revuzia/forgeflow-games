#!/usr/bin/env python
"""anchors - the planted faults' TEXT ANCHORS (Wave 10 tools lane, 2026-11-19). Two jobs, no browser:

1. Line-ending independent matching. count() / apply() find an anchor the same way in an LF tree and in a CRLF tree
   (core.autocrlf=true checkouts serve maps.js etc. with CRLF; an anchor written with "\\n" that spans lines used to be found
   0 times there and the plant went COULD-NOT-JUDGE). The anchor (and its replacement) take the source's line ending; nothing
   else changes: a plant applies exactly the edit it always did, and an anchor that is missing or found the wrong number of
   times is still a miss (the plant run stays COULD-NOT-JUDGE, never a silent no-op).

2. The census behind `gate.py --check-anchors` (also `python _harness/anchors.py`): every planted fault that patches a source
   file by an exact text anchor, checked against the CURRENT tree (and, for a gate.py control pinned to a frozen --rev, at that
   rev) by replaying the plant's own edits in its own order with its own rule (exactly once, or at least once where that plant
   replaces the first). It prints every miss and exits 1 on any miss, 0 when every anchor is found as wanted. Plants that inject
   a JS snippet, edit a baked table or mutate the world in memory have no text anchor: the census counts the gate.py controls it
   does not know as 'no text anchor known here' (information; never a pass of the control itself - only its run is).

The census reads each plant's anchors from the harness module that plants them (its PLANTS / NO_* / *_ANCHOR constants), so an
edit to a plant is followed automatically. Anchors written inline in a function are copied into INLINE below WITH a guard: the
guard text must still occur in that harness file's source, else the census row reads 'registry-stale' (a miss).
"""
from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # games/last-circle
RB = "runtime/3d/royale/"


# ───────────────────────── 1. line-ending independent matching ─────────────────────────
def _eol_like(src, s):
    """`s` with the line ending of `src` (CRLF when src has any CRLF, else LF); str or bytes."""
    crlf, lf = (b"\r\n", b"\n") if isinstance(src, bytes) else ("\r\n", "\n")
    if lf not in s:
        return s
    s = s.replace(crlf, lf)
    return s.replace(lf, crlf) if crlf in src else s


def count(src, old):
    """occurrences of anchor `old` in `src`, independent of LF / CRLF line endings."""
    return src.count(_eol_like(src, old))


class AnchorMiss(Exception):
    pass


def apply(src, old, new, want=1, what=""):
    """replace the anchor `old` by `new` (both given the line ending of `src`). want = 1: it must occur exactly once;
    want = '+': at least once (the FIRST is replaced, as such plants always did). Raises AnchorMiss otherwise."""
    o = _eol_like(src, old)
    n = src.count(o)
    if (want == "+" and n < 1) or (want != "+" and n != want):
        raise AnchorMiss("anchor%s found %d times (want %s): %r" % ((" in " + what) if what else "", n, "at least 1" if want == "+" else want, old[:80]))
    return src.replace(o, _eol_like(src, new), 1)


# ───────────────────────── 2. the census ─────────────────────────
def _load(rel_py):
    """import a harness module by its path (not as __main__: a gate's main() never runs)."""
    path = os.path.join(HERE, rel_py.replace("/", os.sep))
    for p in (HERE, os.path.dirname(path)):
        if p not in sys.path:
            sys.path.insert(0, p)
    name = "_anch_" + re.sub(r"\W", "_", rel_py)
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


def _edit_list(v):
    """[(rel, [(old, new), ...]), ...] - the serve_patched plant shape."""
    return (isinstance(v, (list, tuple)) and len(v) > 0 and all(
        isinstance(x, (list, tuple)) and len(x) == 2 and isinstance(x[0], str) and isinstance(x[1], (list, tuple))
        and all(isinstance(e, (list, tuple)) and len(e) == 2 and isinstance(e[0], str) for e in x[1]) for x in v))


def _pairs(v):
    return isinstance(v, (list, tuple)) and len(v) > 0 and all(isinstance(e, (list, tuple)) and len(e) == 2 and isinstance(e[0], str) for e in v)


def _plants_editlist(m, eol=True):
    return {k: [(rel, list(ed), 1, eol) for rel, ed in v] for k, v in m.PLANTS.items() if _edit_list(v)}


def _plants_pairs(m, rel, eol=True, want=1):
    return {k: [(rel, list(v), want, eol)] for k, v in m.PLANTS.items() if _pairs(v)}


def _consts(m, table, rel, eol=True, want=1):
    return {plant: [(rel, list(getattr(m, const)), want, eol)] for plant, const in table.items() if hasattr(m, const)}


# (script, how): how(module) -> {plant: [(rel, [(old, new), ...], want, eol), ...]}. want 1 = each edit exactly once, in order;
# '+' = at least once (first replaced). eol True = the plant's match does not depend on line endings (anchors.count, or the plant
# reads the source in Python text mode / strips CR itself, as sfxcheck, citykit_probe, player_camwall, housegen_demo_looks do);
# False = byte-exact (a one-line anchor is unaffected either way; a multi-line one is reported with a CRLF hint).
SOURCES = [
    # p23lib.serve_patched users (line-ending independent since this lane)
    ("p23/waterlook.py", lambda m: _plants_editlist(m)),
    ("p23/gunhold.py", lambda m: _plants_editlist(m)),
    ("p23/lootlook.py", lambda m: _plants_editlist(m)),
    ("probe_match.py", lambda m: _plants_pairs(m, RB + "bots.js")),
    ("p23/dbno.py", lambda m: _consts(m, {"no-commit": "NO_COMMIT", "no-revive-threat": "NO_REVIVE_THREAT"}, RB + "bots.js")),
    ("p23/fall.py", lambda m: _consts(m, {"no-fall-guard": "NO_FALL_GUARD", "no-turn-reprobe": "NO_TURN_REPROBE", "calm-guard-off": "CALM_GUARD_OFF"}, RB + "bots.js")),
    # bespoke applicators
    ("citykit_probe.py", lambda m: {k: [(RB + "citykit.js", list(v["patch"]), 1, True)] for k, v in m.PLANTS.items()}),
    ("p23/sfxcheck.py", lambda m: {k: [(RB + "audio.js", list(v[1]), "+", True)] for k, v in m.PLANTS.items() if v[0] == "audio" and _pairs(v[1])}),
    ("p23/netlive.py", lambda m: {k: [(RB + "net.js", [tuple(v)], "+", False)] for k, v in m.PLANTS.items()}),
    ("new/sky_probe.py", lambda m: _plants_pairs(m, RB + "maps.js", eol=False, want="+")),
    ("new/sky_lowtier.py", lambda m: _plants_pairs(m, RB + "maps.js", eol=False, want="+")),
    ("new/player_dive.py", lambda m: {k: [(RB + "player.js", [tuple(v)], 1, False)] for k, v in m.PLANTS.items()}),
    ("new/player_camwall.py", lambda m: {"settle-requery": [(RB + "loot.js", [(m.SETTLE_ANCHOR, m.SETTLE_ANCHOR + m.PLANT_SETTLE)], 1, True)]}),
    ("worldcheck.py", lambda m: {"rng-shift": [(RB + "maps.js", [(m.RNG_ANCHOR, m.RNG_ANCHOR)], 1, False)]}),
    ("navcheck.py", lambda m: {p: [("runtime/3d/ffg_royale3d.js", [(m.HOOK_ANCHOR, m.HOOK_TEXT)], 1, False)] for p in ("raw-strafe", "heal-yaw", "pocket-raw")}),
    ("new/hud_checks.py", lambda m: {"pill-unclamped": [(RB + "hud.js", [(m.EDGE_CLAMP_LINE.decode("utf-8"), "")], "+", False)]}),
    ("housegen_demo_looks.py", lambda m: {k: [(RB + "housegen.js", [tuple(v)], 1, True)] for k, v in m.PLANT_EDIT.items()}),
    ("worldlive.py", lambda m: {p: [(RB + "player.js", "ONE_OF", ["if (!K.rampBlocks(c, x, z, yd, h, r, STEP_UP)) continue;",
                                                               "if (!K.rampBlocksA(c, RBA)) continue;"], False)] for p in m.PLANTS}),
]

# anchors written inline in a function: (script, plant, rel, edits, want, eol, guard) - `guard` must still occur in the harness file
INLINE = [
    ("navcheck.py", "coarse-indoor", RB + "bots.js", [("maxMs: 0, lazy: true, noFloor }", "")], 1, False, 'anchor = "maxMs: 0, lazy: true, noFloor }"'),
    ("coldcache.py", "bare-import", RB + "net.js", [('import("./maps.js" + V)', "")], "+", False, """ntxt.replace('import("./maps.js" + V)'"""),
    ("squadguard_live.py", "no-guard", RB + "net.js", [("if (l === r) return null;", "")], "+", False, 't.replace("if (l === r) return null;"'),
    ("squadguard_live.py", "bare-import", RB + "net.js", [('import("./maps.js" + V)', "")], "+", False, """t.replace('import("./maps.js" + V)'"""),
    ("squadguard_live.py", "no-fallback", RB + "net.js", [("function leaveForFallback(W, fb) {", "")], "+", False, 'anchor = "function leaveForFallback(W, fb) {"'),
    ("new/loot_beams_rings.py", "storm-ignore", RB + "loot.js", [("float stormK(vec3 st, vec2 p) {", "")], "+", False, 'key, put = "float stormK(vec3 st, vec2 p) {"'),
    ("new/loot_beams_rings.py", "chest-beams-short", RB + "loot.js", [("float far = aBeam.w;", "")], "+", False, 'key, put = "float far = aBeam.w;"'),
    ("new/loot_beams_rings.py", "flush-clear", RB + "loot.js", [("function queueRange(a, start, count) {", "")], "+", False, 'key, put = "function queueRange(a, start, count) {"'),
]

# plants that find their spot by a REGEX (copied, with the same guard rule): (script, plant, rel, pattern, want, guard)
REGEX = [
    ("feelcheck.py", "kill-marker-short", RB + "hud.js", r"(kill:\s*\{[^}]*?hold:\s*)(\d*\.?\d+)", "+", r'pat = re.compile(rb"(kill:\s*\{[^}]*?hold:\s*)(\d*\.?\d+)")'),
    ("genversion.py", "savanna-shift", RB + "towngen.js", r"(compounds: \{ count: )30(, themes)", "+", r're.search(r"(compounds: \{ count: )30(, themes)", src)'),
    ("kitcollide.py", "q1-sign", RB + "citykit.js", re.escape("else if (q === 1) { a = z0; b = z1; c = -x1; d = -x0; }"), "+", 's.replace("else if (q === 1) { a = z0; b = z1; c = -x1; d = -x0; }"'),
    ("new/warm_programs.py", "no-arm", "runtime/3d/ffg_warmup.js", r"try \{ dv = armDepthVariants\([^)]*\);[^\n]*", "+", r're.sub(r"try \{ dv = armDepthVariants\([^)]*\);[^\n]*"'),
    ("new/warm_programs.py", "no-icons", RB + "hud.js", r"\n[ \t]*warmIcons\(W\);[^\n]*", "+", r're.sub(r"\n[ \t]*warmIcons\(W\);[^\n]*"'),
]

_CACHE = {}
DEFAULT_REV = None          # anchors.py --rev: the files of that revision instead of the working tree
EXTRA = {}                  # planted census entries (anchors.py --plant)


def _read(rel, rev=None):
    rev = rev or DEFAULT_REV
    key = (rel, rev)
    if key not in _CACHE:
        if rev:
            r = subprocess.run(["git", "-C", ROOT, "show", "%s:./%s" % (rev, rel)], capture_output=True)
            _CACHE[key] = r.stdout.decode("utf-8", "replace") if r.returncode == 0 else None
        else:
            p = os.path.join(ROOT, rel.replace("/", os.sep))
            _CACHE[key] = open(p, "rb").read().decode("utf-8", "replace") if os.path.isfile(p) else None
    return _CACHE[key]


def _check_edits(src, edits, want, eol):
    """replay the plant's edits in order on `src`: (ok, detail)."""
    if src is None:
        return False, "file not in the tree"
    for old, new in edits:
        o = _eol_like(src, old) if eol else old
        n = src.count(o)
        if (want == "+" and n < 1) or (want != "+" and n != want):
            hint = ""
            if not eol and count(src, old) != n:
                hint = " (found %d times ignoring line endings: this byte-exact plant misses in a %s tree)" % (count(src, old), "CRLF" if "\r\n" in src else "LF")
            return False, "found %d times (want %s): %r%s" % (n, "at least 1" if want == "+" else want, old[:90], hint)
        src = src.replace(o, (_eol_like(src, new) if eol else new), 1)
    return True, "%d anchor(s) found as wanted" % len(edits)


def census_plants():
    """{(script, plant): [spec, ...]} + load problems [(script, error)]."""
    out, probs = {}, []
    for script, how in SOURCES:
        try:
            for plant, specs in how(_load(script)).items():
                out[(script, plant)] = specs
        except Exception as e:                         # a module whose plants cannot be read is a miss
            probs.append((script, "%s: %s" % (type(e).__name__, str(e)[:160])))
    for script, plant, rel, edits, want, eol, guard in INLINE:
        out[(script, plant)] = [(rel, edits, want, eol, guard)]
    for script, plant, rel, pattern, want, guard in REGEX:
        out[(script, plant)] = [(rel, ("REGEX", pattern), want, False, guard)]
    out.update(EXTRA)
    return out, probs


def _negative_rows():
    """gate.py's registered controls: [(name, script, plant or None, rev or None)]"""
    g = _load("gate.py")
    rows = []
    for ent in list(getattr(g, "NEGATIVE", [])):
        name, script, extra = ent[0], ent[1], list(ent[2])
        plant = extra[extra.index("--plant") + 1] if "--plant" in extra else None
        rev = extra[extra.index("--rev") + 1] if "--rev" in extra else None
        rows.append((name, script, plant, rev))
    return rows


def check(verbose=True):
    """the census: (misses, ok_lines). A miss = an anchor not found as wanted, a module whose plants cannot be read, or a stale INLINE copy."""
    plants, probs = census_plants()
    misses = ["%s: plants not readable: %s" % (s, e) for s, e in probs]
    lines = []
    try:
        neg = _negative_rows()
    except Exception as e:
        neg = []
        misses.append("gate.py: NEGATIVE not readable: %s" % e)
    targets = [(script, plant, None, None) for (script, plant) in sorted(plants)]
    targets += [(s, p, r, n) for (n, s, p, r) in neg if p and r and (s, p) in plants]     # a control pinned to a frozen --rev: at that rev too
    for script, plant, rev, cname in targets:
        for spec in plants[(script, plant)]:
            rel, edits, want, eol = spec[:4]
            tag = "%s --plant %s [%s @ %s]%s" % (script, plant, rel, ("git " + rev) if rev else "tree", (" control " + cname) if cname else "")
            if len(spec) > 4:
                with open(os.path.join(HERE, script.replace("/", os.sep)), encoding="utf-8") as fh:
                    if spec[4] not in fh.read():
                        misses.append(tag + " :: registry-stale: the inline anchor is no longer in %s (update anchors.INLINE)" % script)
                        continue
            src = _read(rel, rev)
            if isinstance(edits, tuple) and edits[0] == "REGEX":
                n = len(re.findall(edits[1], src)) if src is not None else 0
                good = n >= 1 if want == "+" else n == want
                det = "regex %r matched %d times (want %s)" % (edits[1][:70], n, "at least 1" if want == "+" else want)
            elif edits == "ONE_OF":
                if src is None:
                    good, det = False, "file not in the tree"
                else:
                    hits = [(a, src.count(a)) for a in want]
                    found = [h for h in hits if h[1]]
                    good = len(found) == 1 and found[0][1] == 1
                    det = "exactly one of %d spellings exactly once: " % len(want) + ", ".join("%r x%d" % (a[:50], n) for a, n in hits)
            else:
                good, det = _check_edits(src, edits, want, eol)
            if good:
                lines.append(tag + " :: " + det)
            else:
                misses.append(tag + " :: " + det)
    cov = sum(1 for (n, s, p, r) in neg if p and (s, p) in plants)
    unk = sorted(set("%s --plant %s" % (s, p) for (n, s, p, r) in neg if p and (s, p) not in plants))
    nop = sum(1 for (n, s, p, r) in neg if not p)
    if verbose:
        for ln in lines:
            print("  ok    " + ln)
        for m in misses:
            print("  MISS  " + m)
        print("gate.py NEGATIVE: %d controls run a text-anchor plant checked here; %d other --plant controls (%d distinct plants) have no text anchor "
              "known here (JS snippet / table / in-memory plants); %d controls have no --plant (a frozen --rev, a --control or a drop-token)"
              % (cov, sum(1 for (n, s, p, r) in neg if p and (s, p) not in plants), len(unk), nop))
        print("ANCHORS %s: %d anchor sets found as wanted, %d miss(es)" % ("PASS" if not misses else "FAIL", len(lines), len(misses)))
    return misses, lines


PLANTS = {
    # the census's own planted faults (each MUST exit 1): a plant whose anchor is not in the tree; an INLINE copy whose literal left its harness file
    "missing-anchor": ("p23/waterlook.py", "_planted-missing", [(RB + "maps.js", [("/* W10 tools planted anchor: never in any source */", "")], 1, True)]),
    "stale-inline": ("navcheck.py", "_planted-stale", [(RB + "bots.js", [("maxMs: 0", "")], "+", False, "/* W10 tools planted guard: never in navcheck.py */")]),
}


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plant", default=None, choices=sorted(PLANTS), help="a planted fault of the census itself (it must then exit 1)")
    ap.add_argument("--rev", default=None, help="check the anchors in this git revision's files instead of the working tree")
    args, _rest = ap.parse_known_args(argv)        # gate.py's --disk / --base / --headed / --gpu do not apply (no browser)
    global DEFAULT_REV
    DEFAULT_REV = args.rev
    if args.plant:
        script, plant, specs = PLANTS[args.plant]
        EXTRA[(script, plant)] = specs
        print("PLANTED FAULT %s: %s --plant %s %r" % (args.plant, script, plant, specs))
    t0 = __import__("time").time()
    misses, lines = check()
    label = "FAIL" if misses else "PASS"
    print("VERDICT anchors: %s  (%d pass, %d fail, 0 could-not-judge)%s  [%.1f s]" % (label, len(lines), len(misses), ("  first fail: " + misses[0][:200]) if misses else "",
                                                                                      __import__("time").time() - t0))
    return 1 if misses else 0


if __name__ == "__main__":
    sys.exit(main())

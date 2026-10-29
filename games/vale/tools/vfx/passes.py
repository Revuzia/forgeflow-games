"""House-rule passes applied when content/vfx.json is built (tools/vfx/build_vfx.py).

The bespoke kits (tools/vfx/bespoke/*.py) were authored before fighters owned a hue; these passes apply the
rules the benchmark (r12) set for every kit, so each source keeps reading as authored and the rule lives in
one place:

  signature_pass   (M12) team identity only on the danger edges. In a bespoke def every "team" colour moves to
                   the caster's "signature" except: shockwave / ring layers (the danger edge), decals (ground
                   rings and marks), mesh fresnel rims and particle rims (the enemy danger rim). Mesh dissolve
                   edges follow the body into the signature.
  ult_pass         (M13) every ultimate IMPACT def (it carries a T4 flash): a 1.3 s ground mark at L* <= 55 as
                   the dissipation (an existing dark mark is lengthened instead); dome / shell meshes (dome, orb,
                   column, pillar, wall, tornado) fade with an eased alpha over >= 0.3 s; a lensing ring on the
                   landing (distort: T4, never on Low).
  secondary_pass   (m5) a T2 ability def without a mid-scale secondary shape (a glow sprite >= 0.5 m, a ribbon,
                   or a mesh of 0.5-1.2 m) gets a 0.8 m signature glow between its core and its chips.
  drop_shake       (m4) no ability shakes the camera: feel layers lose `shake` (a feel layer left with nothing
                   else to do is removed). Impact is sold by flash, the exposure envelope, particles and marks.
  light_pass       (closing C1) the fighter's hue carries the LIGHT of its third ability and ultimate in play, not just
                   the layer count: in a third-ability / ultimate def (not a wind-up) team colour lives on ONE thin
                   keyline (the brightest team shockwave lip, emissive <= 2 and width <= 0.22 m; else the ground-ring
                   edge) and every other team ref becomes the signature; fixed bright neutrals (warm whites, creams,
                   Dawnglass, ice, lavender greys, a fixed orange) in light layers (flash, light, additive and emissive
                   layers, emissive decals) stay only as the first 12 % of a gradient (the 1-2 frame core) and become
                   the signature (flash, light) or the fighter's pale companion (else the signature) for the rest of
                   their life. Surfaces (ink, chip, alpha bodies) keep their own colours. Idempotent.
"""
from __future__ import annotations

import copy

from vfxkit import INK2, L

SHELLS = {"dome", "orb", "column", "pillar", "wall", "tornado"}


def _map_colors(v, f):
    if isinstance(v, str):
        return f(v)
    if isinstance(v, list):
        out = []
        for x in v:
            if isinstance(x, list) and len(x) == 2 and isinstance(x[0], (int, float)) and isinstance(x[1], str):
                out.append([x[0], f(x[1])])
            elif isinstance(x, str):
                out.append(f(x))
            else:
                out.append(x)
        return out
    return v


def _refs(v) -> list[str]:
    if isinstance(v, str):
        return [v]
    if isinstance(v, list):
        return [x[1] if isinstance(x, list) else x for x in v if isinstance(x, (str, list))]
    return []


def signature_pass(d: dict) -> dict:
    to_sig = lambda c: "signature" if c == "team" else c  # noqa: E731
    for l in d["layers"]:
        t = l["type"]
        if t in ("shockwave", "ring", "decal", "feel", "bind"):
            continue
        if "color" in l:
            l["color"] = _map_colors(l["color"], to_sig)
        if t == "mesh" and l.get("edge") == "team":
            l["edge"] = "signature"
    return d


def _curve_keys(v, life_default=None):
    """a curve as [[t, v], …] (numbers / pairs / evenly spaced / keys)"""
    if isinstance(v, (int, float)):
        return [[0, v], [1, v]]
    if isinstance(v, list) and v and all(isinstance(x, list) for x in v):
        return [list(x) for x in v]
    if isinstance(v, list) and v and all(isinstance(x, (int, float)) for x in v):
        n = len(v)
        return [[i / (n - 1) if n > 1 else 0, x] for i, x in enumerate(v)]
    return None


def _sample(keys, t):
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, a), (t1, b) in zip(keys, keys[1:]):
        if t <= t1:
            return a + (b - a) * ((t - t0) / (t1 - t0) if t1 > t0 else 1)
    return keys[-1][1]


def _eased_tail(alpha, life: float, fade: float = 0.32):
    keys = _curve_keys(alpha)
    if not keys:
        return alpha
    t0 = max(0.0, 1 - fade / life)
    a0 = _sample(keys, t0)
    if a0 <= 0.02:
        return alpha
    head = [k for k in keys if k[0] < t0 - 1e-6]
    tail = [[round(t0, 3), round(a0, 3)], [round(t0 + (1 - t0) * 0.45, 3), round(a0 * 0.34, 3)],
            [round(t0 + (1 - t0) * 0.78, 3), round(a0 * 0.09, 3)], [1, 0]]
    return head + tail


def _is_t4_impact(d: dict) -> bool:
    for l in d["layers"]:
        if l["type"] == "flash" and (l.get("core") or (l.get("intensity") or 0) >= 10):
            return True
    return False


def ult_pass(d: dict) -> dict:
    if not _is_t4_impact(d):
        return d
    flash_delay = min((l.get("delay", 0) for l in d["layers"] if l["type"] == "flash"), default=0)
    dark = [l for l in d["layers"] if l["type"] == "decal" and any(c in (INK2, "#17181B", "#2A2C33") for c in _refs(l.get("color")))]
    if dark:
        for l in dark:
            if (l.get("life") or 0) < 1.2:
                l["life"] = 1.3
            if l.get("rim") == "team":
                l["rim"] = "signature"
            # the mark is the dissipation: it reads dark (L* <= 55), its rim a glint, not a second flash
            if isinstance(l.get("emissive"), (int, float)) and l["emissive"] > 1.0:
                l["emissive"] = 1.0
    else:
        d["layers"].append(L("decal", at="ground", shape="circle", style="scorch", radius=[[0, 0.6], [0.12, 1.0], [1, 1.05]], life=1.3,
                             color=INK2, alpha=[[0, 0.75], [0.7, 0.55], [1, 0]], emissive=0.6, rim="signature", fit=True,
                             delay=round(flash_delay + 0.1, 3) or None))
    for l in d["layers"]:
        if l["type"] == "mesh" and l.get("shape") in SHELLS:
            life = float(l.get("life") or 0.3)
            if life < 0.5:
                l["life"] = 0.5
                life = 0.5
            l["alpha"] = _eased_tail(l.get("alpha", [1, 0]), life)
    if not any(l["type"] == "distort" for l in d["layers"]):
        d["layers"].append(L("distort", at="ground", mode="ring", size=[[0, 0.5], [1, 2.2]], strength=[[0, 0.013], [0.5, 0.006], [1, 0]],
                             life=0.5, align="ground", fit=True, delay=flash_delay or None))
    return d


def _has_secondary_shape(d: dict) -> bool:
    for l in d["layers"]:
        t = l["type"]
        if t in ("ribbon", "trail", "beam"):
            return True
        if t == "sprite":
            sz = l.get("size")
            m = max(x[1] if isinstance(x, list) else x for x in sz) if isinstance(sz, list) else (sz or 0)
            if m >= 0.5:
                return True
        if t == "mesh":
            sc = _curve_keys(l.get("scale", 0.5)) or [[0, 0.5]]
            m = max(k[1] for k in sc)
            if 0.5 <= m <= 1.2 or (l.get("fit") and m <= 1.2):
                return True
    return False


def secondary_pass(d: dict) -> dict:
    """T2 bespoke ability defs (not passives, not ultimates) get a mid-scale signature glow when they lack one"""
    i = d["id"]
    if "_ult_" in i or "_passive_" in i or i.endswith("_windup") or "_atk_" in i or _has_secondary_shape(d):
        return d
    ats = [l.get("at") for l in d["layers"] if l.get("at")]
    at = max(set(ats), key=ats.count) if ats else "origin"
    d["layers"].append(L("sprite", at=at, texture="glow", size=[[0, 0.5], [0.25, 0.8], [1, 0.86]], color=["signature", "secondary"], emissive=2.4,
                         alpha=[[0, 0], [0.12, 0.85], [1, 0]], life=0.32, soft=0.25, follow=True if at == "path" else None,
                         hold=1 if at == "path" else None))
    return d


def drop_shake(d: dict) -> dict:
    keep = []
    for l in d["layers"]:
        if l["type"] == "feel":
            l = dict(l)
            l.pop("shake", None)
            l.pop("who", None)
            if not any(k in l for k in ("hitFlash", "hitStop", "squash", "exposure")):
                continue
        keep.append(l)
    d["layers"] = keep
    return d


# ── closing C1: light share ──────────────────────────────────────────────────────────────────────────────────────────
_GAME = __import__("pathlib").Path(__file__).resolve().parent.parent.parent
_SIGS: dict = {}


def _hsv(h: str):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    mx, mn = max(r, g, b), min(r, g, b)
    s = (mx - mn) / mx if mx > 0 else 0
    if mx == mn:
        hue = 0.0
    elif mx == r:
        hue = ((g - b) / (mx - mn)) % 6
    elif mx == g:
        hue = (b - r) / (mx - mn) + 2
    else:
        hue = (r - g) / (mx - mn) + 4
    return (hue * 60 + 360) % 360, s, mx


def fighter_sig(fid: str):
    """the fighter's signature pair and whether its companion is pale (light) or dark (a deep tone)"""
    if fid not in _SIGS:
        import json
        p = _GAME / "content" / "fighters" / f"{fid}.json"
        v = json.loads(p.read_text(encoding="utf-8")).get("vfx") if p.exists() else None
        _SIGS[fid] = v and {"sig": v["signature"], "sec": v["secondary"], "secPale": _hsv(v["secondary"])[2] >= 0.85}
    return _SIGS[fid]


def _neutral(c, sig_hex: str, heal_ok: bool = True) -> bool:
    """a fixed bright colour off the signature's hue (or near-white): light that is neither the fighter nor the team"""
    if not isinstance(c, str) or not c.startswith("#") or len(c) != 7:
        return False
    h, s, v = _hsv(c)
    if v < 0.5:
        return False          # ink, smoke, stone: surfaces, not light
    if s >= 0.35 and 125 <= h <= 150 and heal_ok:
        return False          # HEAL green is a functional colour (tokens vfx.reservedHuesHSV heal): its keyline keeps it
    if s < 0.35:
        return True           # warm white, cream, Dawnglass, ice, lavender grey
    sh = _hsv(sig_hex)[0]
    d = abs(h - sh)
    return min(d, 360 - d) > 12   # a fixed saturated colour off the fighter's own hue (a fixed orange, a resin green)


def _keys(v):
    if isinstance(v, str):
        return [[0, v]]
    if isinstance(v, list) and v and all(isinstance(x, list) and len(x) == 2 for x in v):
        return [list(x) for x in v]
    if isinstance(v, list) and v and all(isinstance(x, str) for x in v):
        n = len(v)
        return [[round(i / (n - 1), 3) if n > 1 else 0, x] for i, x in enumerate(v)]
    return None


def _light_grad(v, sig_hex: str, repl: str, heal_ok: bool = True):
    """a light gradient: a neutral stays only as the 12 % core at t 0; later neutral keys become `repl`"""
    ks = _keys(v)
    if not ks:
        return v
    if len(ks) == 1:
        return repl if _neutral(ks[0][1], sig_hex, heal_ok) else v
    out = [ks[0]] + [[t, repl if _neutral(c, sig_hex, heal_ok) else c] for t, c in ks[1:]]
    if _neutral(out[0][1], sig_hex, heal_ok) and out[1][0] > 0.12:
        out.insert(1, [0.12, out[1][1]])
    if out == ks:
        return v
    return out


def _is_light(l: dict) -> bool:
    t, blend = l["type"], l.get("blend")
    if t in ("flash", "light"):
        return True
    if blend in ("ink", "chip", "alpha"):
        return False
    if t == "decal":
        ks = _curve_keys(l.get("emissive", 0)) or [[0, 0]]
        return max(k[1] for k in ks) > 0
    return t in ("sprite", "emitter", "mesh", "shockwave", "ring", "ribbon", "beam", "trail")


def _team_in(v) -> bool:
    return v == "team" or (isinstance(v, list) and any(x == "team" or (isinstance(x, list) and len(x) == 2 and x[1] == "team") for x in v))


COLOR_KEYS = ("color", "rim", "edge", "core")
# a signature too dark to register as light on its own (Dunsom's indigo, relative luminance ~0.05): its light layers
# open on the pale same-hue companion and settle into the signature (the reviewer's indigo column, lavender coil)
DARK_SIG = {"dunsom"}
# surface marks whose pale colour, painted over the lane, reads as off-hue light: tinted toward the fighter
SURFACE_TINT = {"marund_a3_mortar": {"#C9C3B5": "#A8CDBE"}}


def _heal(c) -> bool:
    if not isinstance(c, str) or not c.startswith("#"):
        return False
    h, s, v = _hsv(c)
    return s >= 0.35 and v >= 0.5 and 125 <= h <= 150


def _lift_dark(v):
    """['…', 'signature'] light → the first signature key becomes the pale companion, the gradient ends in the signature"""
    ks = _keys(v)
    if not ks:
        return v
    idx = next((k for k, (t, c) in enumerate(ks) if c == "signature" and (k > 0 or len(ks) == 1 or ks[0][1] == "signature")), None)
    if idx is None:
        return v
    ks[idx][1] = "secondary"
    if ks[-1][1] != "signature" or len(ks) == 1:
        ks.append([1.0, "signature"]) if ks[-1][0] < 1 or len(ks) == 1 else ks.__setitem__(-1, [ks[-1][0], "signature"])
    if len(ks) >= 2 and ks[0][0] == ks[-1][0]:
        ks[-1][0] = 1.0
    return ks


def light_pass(d: dict) -> dict:
    i = d["id"]
    fid = i.split("_", 1)[0]
    sg = fighter_sig(fid)
    if not sg or i.endswith("_windup"):
        return d
    sig_hex = sg["sig"]
    companion = "secondary" if sg["secPale"] else "signature"
    to_sig = lambda c: "signature" if c == "team" else c  # noqa: E731
    # the one keyline: the brightest team-coloured (additive) shockwave, else the first ground-ring edge in team
    waves = [l for l in d["layers"] if l["type"] in ("shockwave", "ring") and l.get("blend") != "ink" and _team_in(l.get("color"))]
    key = max(waves, key=lambda l: l.get("emissive") if isinstance(l.get("emissive"), (int, float)) else 0) if waves else None
    if key is None:
        key = next((l for l in d["layers"] if l["type"] == "decal" and l.get("rim") == "team"), None)
        if key is not None and isinstance(key.get("emissive"), (int, float)) and key["emissive"] > 0.8:
            key["emissive"] = 0.8   # a ground-ring keyline is a glint, not a light floor
    # HEAL green (a helper's mend): like team, one keyline keeps it (the first heal-coloured ring), the body is the fighter's
    heal_key = next((l for l in d["layers"] if l["type"] in ("shockwave", "ring") and any(_heal(c) for c in _refs(l.get("color")))), None)
    for l in d["layers"]:
        for k in COLOR_KEYS:
            if k not in l:
                continue
            if l is key and ((k == "color" and key["type"] != "decal") or (k == "rim" and key["type"] == "decal")):
                continue
            if _team_in(l[k]):
                l[k] = _map_colors(l[k], to_sig)
        if l is key and key["type"] != "decal":
            e = l.get("emissive")
            if isinstance(e, (int, float)) and e > 2.0:
                l["emissive"] = 2.0
            elif isinstance(e, list) and (_curve_keys(e) and max(k[1] for k in _curve_keys(e)) > 2.0):
                l["emissive"] = [[k[0], min(k[1], 2.0)] for k in _curve_keys(e)]
            w = l.get("width")
            if isinstance(w, (int, float)):
                l["width"] = min(w, 0.22)
            elif isinstance(w, list):
                l["width"] = [[x[0], min(x[1], 0.22)] if isinstance(x, list) else min(x, 0.22) for x in w]
            if l.get("color") != "team":
                l["color"] = "team"
        if not _is_light(l):
            continue
        if l is key and key["type"] != "decal":
            continue
        t = l["type"]
        heal_ok = l is heal_key
        if "color" in l:
            l["color"] = _light_grad(l["color"], sig_hex, "signature" if t in ("flash", "light") else companion, heal_ok)
            if fid in DARK_SIG and sg["secPale"] and t not in ("flash", "light"):
                l["color"] = _lift_dark(l["color"])
        for k in ("rim", "edge"):
            if k in l:
                l[k] = _light_grad(l[k], sig_hex, "signature", heal_ok)
    tint = SURFACE_TINT.get(i)
    if tint:
        for l in d["layers"]:
            if l["type"] in ("decal", "emitter") and l.get("blend") in (None, "alpha") and "color" in l:
                l["color"] = _map_colors(l["color"], lambda c: tint.get(c, c))
    return d


def is_rekey_slot(i: str) -> bool:
    """the defs light_pass re-keys: a fighter's third ability and ultimate (and the a1/a2 defs listed in LIGHT_EXTRA)"""
    return (("_a3_" in i or "_ult_" in i) and not i.endswith("_windup")) or i in LIGHT_EXTRA


# a1 / a2 defs whose light the integrated in-play measure found off the signature (closing C1 baseline,
# _harness/_reports/fw_CW1_kit_hue_base.json: ardit a2 0.44, marund a2 0.30, odrum a1 0.35, sukri a1 0.15, vashil a1 0.14)
LIGHT_EXTRA: set = {"ardit_a2_glare", "marund_a2_raise", "marund_a2_dome", "odrum_a1_set", "odrum_a1_resin", "sukri_a1_mote",
                    "sukri_a1_toss", "sukri_a1_mend", "vashil_a1_peal"}


def bespoke(defs: list) -> list:
    out = [secondary_pass(ult_pass(signature_pass(drop_shake(copy.deepcopy(d))))) for d in defs]
    return [light_pass(d) if is_rekey_slot(d["id"]) else d for d in out]

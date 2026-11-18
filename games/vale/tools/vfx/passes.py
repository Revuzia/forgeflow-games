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
    to_comp = lambda c: companion if c == "team" else c  # noqa: E731
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
# a pure movement (Dunsom's Step Through Dusk: a blink, no area, no harm) carries no danger keyline: all its light is his
NO_KEYLINE = {"dunsom_a3_step"}
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
    to_comp = lambda c: companion if c == "team" else c  # noqa: E731
    # the one keyline: the brightest team-coloured (additive) shockwave, else the first ground-ring edge in team
    waves = [l for l in d["layers"] if l["type"] in ("shockwave", "ring") and l.get("blend") != "ink" and _team_in(l.get("color"))]
    key = max(waves, key=lambda l: l.get("emissive") if isinstance(l.get("emissive"), (int, float)) else 0) if waves else None
    if i in NO_KEYLINE:
        key = False
    elif key is None:
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
                # an ultimate's short light floor under the impact (a team decal, emissive >= 2, <= 0.5 s: the ground core
                # of the beat) takes the pale companion, so a dark signature still lights the ground (r12 M13 core)
                floor = l["type"] == "decal" and k == "color" and float(l.get("life") or 1) <= 0.5 and \
                    max(x[1] for x in (_curve_keys(l.get("emissive", 0)) or [[0, 0]])) >= 2
                l[k] = _map_colors(l[k], to_comp if floor else to_sig)
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


# ── max VFX-2: every projectile, skillshot and dash lights the ground under its head ───────────────────────────────
DASH_WORDS = ("dash", "leap", "step", "hop", "spring", "rush", "lunge", "bound", "backstep", "kick", "shoulder", "beardown", "wrap")


def _rides_path(l: dict) -> bool:
    if l.get("at") == "path" and l["type"] in ("mesh", "ribbon", "emitter", "sprite"):
        return True
    return l["type"] in ("ribbon", "trail") and l.get("at") in (None, "path") and not l.get("arcRadius") and not l.get("socket")


def _ground_lit(d: dict) -> bool:
    return any((l["type"] == "decal" and l.get("at") == "path") or (l["type"] == "light" and l.get("at") == "path") for l in d["layers"])


def ground_light_pass(d: dict) -> dict:
    """max VFX-2: a def that rides a path (a shot, a skillshot, a dash) gets a soft light pool on the ground under its
    head in the caster's signature (a wick or a structure: its team), held while the head flies and fading where it lets
    go (system.ts: a path `light` decal is the one decal T1 draws). Ultimates and T3 shots (a Needle) add a wider, dimmer
    second pool. Idempotent: a def that already lights the ground under its path is left alone."""
    i = d["id"]
    if i.endswith("_windup") or not any(_rides_path(l) for l in d["layers"]) or _ground_lit(d):
        return d
    dash = any(w in i for w in DASH_WORDS) and not i.endswith("_shot")
    big = "_ult_" in i or "needle" in i
    r, a, e = (1.0, 0.22, 1.2) if dash else (1.1, 0.28, 1.4)
    keys = lambda peak: [[0, 0], [0.06, peak], [0.35, peak], [1, 0]]  # noqa: E731
    layers = [L("decal", at="path", follow=True, shape="circle", style="light", texture="glow", radius=r, life=0.45, hold=0.35,
                color="signature", alpha=keys(a), emissive=e)]
    if big:
        layers.append(L("decal", at="path", follow=True, shape="circle", style="light", texture="glow", radius=2.0, life=0.6, hold=0.35,
                        color="signature", alpha=keys(0.09), emissive=1.1))
    d = copy.deepcopy(d)
    d["layers"] = d["layers"] + layers
    return d


def post(d: dict) -> dict:
    """passes applied to every def after its source (and its bespoke/tuned.json hand tuning) is chosen"""
    return ult_body_pass(ult_pool_pass(ult_detail_pass(heavy_crack_pass(ink_form_pass(dust_pass(ult_feel_pass(ground_light_pass(d))))))))


# orch1 W2-B fix 1: Nurrow's lull dome (#2B2433 ink at 0.5 over a 2 m dome) laid a near-black bowl over the struck unit and
# held the first beat's core at luma 208; its ground ink peaks at 0.3 (the dome's form and the decal's print stay). A tried
# caster-hue print under Rishal's / Vashil's beat did not move their victim-box white (0.635 / 0.425): that white is the
# post chain's ground top (post.ts GROUND_TOP_REKEYED 0.97), ruling 51. Idempotent.
NURROW_DOME_ALPHA = 0.3


# The first beat's core (ruling 51: luma >= the 218 clip) read 209 / 216 on Nurrow / Hesmi under their dark landing layers at
# t 0-0.1 s: Nurrow's plum smoke burst (22 puffs of #2B2433 up to 1.8 m at alpha 0.9: a near-black cloud on the victim, the
# blot the ink rule removes elsewhere) is held to the dust alpha (0.45) and its ink ring to 0.45; Hesmi's ink ring to 0.45.
ULT_INK_RING_MAX = 0.45


def _cap_alpha(l: dict, cap: float) -> None:
    m = _alpha_max(l.get("alpha", 1))
    if m > cap:
        l["alpha"] = _scale_alpha(l.get("alpha", 1), cap / m)


def ult_pool_pass(d: dict) -> dict:
    if d["id"] not in ("nurrow_ult_lull", "hesmi_ult_shard"):
        return d
    d = copy.deepcopy(d)
    for l in d["layers"]:
        if d["id"] == "nurrow_ult_lull" and l["type"] == "mesh" and l.get("blend") == "ink" and l.get("shape") == "dome":
            _cap_alpha(l, NURROW_DOME_ALPHA)
        elif d["id"] == "nurrow_ult_lull" and l["type"] == "emitter" and l.get("blend") not in ("add", "chip") \
                and any(isinstance(c, str) and c.upper() == "#2B2433" for c in _refs(l.get("color"))):
            _cap_alpha(l, DUST_ALPHA_MAX)
        elif l["type"] == "shockwave" and l.get("blend") == "ink":
            _cap_alpha(l, ULT_INK_RING_MAX)
    return d


# orch1 W2-B (VFX-O8): Hesmi's, Nurrow's and Vashil's ultimate landings left the struck body flat for two beats (probe
# combat_polish ult: detail 0.33-0.38, 2 frames lost; with the victim flash hidden 0.93-0.99): the landing's feel boost of the
# victim flash (hitFlash 0.55-0.7) is what flattened it. The beat keeps its envelope, core and squash; the body flash is held to
# ULT_DETAIL_FLASH of it. Idempotent (a value already at or under it stays).
ULT_DETAIL_DEFS = {"hesmi_ult_shard", "hesmi_ult_shadow", "nurrow_ult_lull", "vashil_ult_toll"}
# fix 1 (verifier r1: lost 2 / 2 / 1; a boosted flash of k 0.19-0.23 alone cost the body 0.25-0.35 of its detail): 0.12
ULT_DETAIL_FLASH = 0.12
# fix 1: Nurrow's pillar of light on the struck unit (additive, emissive 8) bloomed back over the silhouette at the beat
ULT_DETAIL_PILLAR_EMISSIVE = 4


def ult_detail_pass(d: dict) -> dict:
    if d["id"] not in ULT_DETAIL_DEFS:
        return d
    d = copy.deepcopy(d)
    for l in d["layers"]:
        if l["type"] == "feel" and (l.get("hitFlash") or 0) > ULT_DETAIL_FLASH:
            l["hitFlash"] = ULT_DETAIL_FLASH
        if d["id"] == "nurrow_ult_lull" and l["type"] == "mesh" and l.get("shape") == "pillar" and isinstance(l.get("emissive"), (int, float)) \
                and l["emissive"] > ULT_DETAIL_PILLAR_EMISSIVE:
            l["emissive"] = ULT_DETAIL_PILLAR_EMISSIVE
    return d


# orch1 W2-B (VFX-O6): the near-black ink puffs (#17181B / #2A2C33 particles) read as black blots on the lifted ground at the
# game camera (Wick deaths, hit backings, status specks, wind-up smoke). Outside the Shade family's own defs (the true-damage
# hit, the Shade bolts / bursts / orbs / zone / ultimate, the Longshade) a particle never emits ink: it becomes warm-grey dust
# (#57544E / #6E6A62, L* 36-46) at alpha <= 0.45 with a faint rim. Shaped ink (meshes, decals, ribbons) keeps its colour: a
# dial or a hand is a form, not a blot. Rule: tokens.json vfx.rules.inkParticles. Idempotent.
INK_HEX = {"#17181B": "#57544E", "#2A2C33": "#6E6A62"}
SHADE_OWN = {"lib_bolt_shade", "lib_burst_shade", "lib_orb_shade", "lib_ult_shade", "lib_zone_shade", "lib_hit_true"}
DUST_ALPHA_MAX = 0.45
DUST_RIM_MAX = 0.3


def shade_own(def_id: str) -> bool:
    return def_id in SHADE_OWN or def_id.startswith("lib_longshade_")


def _scale_alpha(a, k: float):
    if isinstance(a, (int, float)):
        return round(a * k, 3)
    if isinstance(a, list):
        return [[x[0], round(x[1] * k, 3)] if isinstance(x, list) else round(x * k, 3) if isinstance(x, (int, float)) else x for x in a]
    return a


def _alpha_max(a) -> float:
    if isinstance(a, (int, float)):
        return float(a)
    if isinstance(a, list):
        vals = [x[1] if isinstance(x, list) else x for x in a if isinstance(x, (int, float, list))]
        return float(max(vals)) if vals else 1.0
    return 1.0


def dust_pass(d: dict) -> dict:
    if shade_own(d["id"]):
        return d
    hit = [i for i, l in enumerate(d["layers"]) if l["type"] == "emitter" and l.get("blend") != "chip"
           and any(isinstance(c, str) and c.upper() in INK_HEX for c in _refs(l.get("color")))]
    if not hit:
        return d
    d = copy.deepcopy(d)
    for i in hit:
        l = d["layers"][i]
        l["color"] = _map_colors(l["color"], lambda c: INK_HEX.get(c.upper(), c) if isinstance(c, str) else c)
        m = _alpha_max(l.get("alpha", 1))
        if m > DUST_ALPHA_MAX:
            l["alpha"] = _scale_alpha(l.get("alpha", 1), DUST_ALPHA_MAX / m)
        if (l.get("rimAlpha") or 0) > DUST_RIM_MAX:
            l["rimAlpha"] = DUST_RIM_MAX
    return d


# orch1 W2-B fix 1 (verifier r1: black shaped-ink stars under rooted, feared and summoned units): the dust pass left ink on
# the shaped layers (decals, sprites, meshes, ribbons, shockwaves). Outside the Shade family:
#   a ground MARK (an ink- or plain-styled decal, a sprite) becomes the same warm-grey dust as the particles, alpha <= 0.45:
#     a status star under a unit is a soft dust print, not a black hole in the stone;
#   a FORM (mesh, ribbon, shockwave, a crack / scorch decal's lines) keeps its shape in a deep warm slate (#3A3731 / #4A463F,
#     L* ~23 / ~30), a value step under the ruling-46 lane (L* ~51) instead of #17181B (L* ~9).
# Rule: tokens.json vfx.rules.inkParticles (ruling 51). Idempotent.
INK_FORM_HEX = {"#17181B": "#3A3731", "#2A2C33": "#4A463F"}
INK_MARK_STYLES = {"ink", "plain", None}


def ink_form_pass(d: dict) -> dict:
    if shade_own(d["id"]):
        return d
    hit = [i for i, l in enumerate(d["layers"]) if l["type"] in ("decal", "sprite", "mesh", "ribbon", "shockwave")
           and any(isinstance(c, str) and c.upper() in INK_HEX for c in _refs(l.get("color")))]
    if not hit:
        return d
    d = copy.deepcopy(d)
    for i in hit:
        l = d["layers"][i]
        mark = l["type"] == "sprite" or (l["type"] == "decal" and l.get("style") in INK_MARK_STYLES)
        table = INK_HEX if mark else INK_FORM_HEX
        l["color"] = _map_colors(l["color"], lambda c: table.get(c.upper(), c) if isinstance(c, str) else c)
        if mark:
            m = _alpha_max(l.get("alpha", 1))
            if m > DUST_ALPHA_MAX:
                l["alpha"] = _scale_alpha(l.get("alpha", 1), DUST_ALPHA_MAX / m)
    return d


# orch1 W2-B (VFX-O7): the heavy physical hit's mark is a chalk crack star, not a dark navy ellipse with a team rune (it
# read as a hole under the target on every heavy auto). Fix 1 (verifier r1: the crack showed in no capture): at L* ~50 the
# lines sat at the ruling-46 lane's own value (L* ~51) and vanished, so the fracture lines are a deep warm grey (#4A453D,
# L* ~29: thin lines, never a disc) and the chalk glint in them is pale and lit (#F1E2C6, emissive 0.9, cooling over the
# life); system.ts lets a crack mark draw for a T1 basic attack. Idempotent.
CRACK_CHALK = "#4A453D"


def heavy_crack_pass(d: dict) -> dict:
    if d["id"] != "lib_hit_phys_heavy":
        return d
    d = copy.deepcopy(d)
    for l in d["layers"]:
        if l["type"] == "decal" and l.get("style") == "crack":
            l["color"] = CRACK_CHALK
            l["rim"] = "#F1E2C6"
            l["emissive"] = 0.9
            l["alpha"] = [0.9, 0.75, 0]
    return d


# orch1 W2-B fix 2 (VFX-O8, verifier r2: Vashil's toll left the struck body flat on its first beat, detail 0.36 with the VFX
# on vs 0.87 with them off): the toll's white flash is half as hot and smaller (10 -> 5, 1.6 -> 1.1 m), the glass bell's
# first frames read by their rim (fill 0.55 -> 0.12, emissive 2 -> 1: the ruling-50 shell rule), its light 22 -> 14.
# Measured: body min 0.36 -> 0.48, box white 0.418 -> 0.249, core 231.7 (clip 218). Ruling 52. Idempotent.
def ult_body_pass(d: dict) -> dict:
    if d["id"] != "vashil_ult_toll":
        return d
    d = copy.deepcopy(d)
    for l in d["layers"]:
        if l["type"] == "flash":
            l["intensity"] = min(l.get("intensity", 5), 5)
            l["radius"] = min(l.get("radius", 1.1), 1.1)
        elif l["type"] == "mesh" and l.get("shape") == "dome":
            l["alpha"] = [[0, 0.12], [0.12, 0.12], [0.3, 0.1], [0.5, 0.05], [0.872, 0.015], [1, 0]]
            l["emissive"] = [[0, 1], [0.2, 0.8], [1, 0.7]]
        elif l["type"] == "light":
            l["intensity"] = min(l.get("intensity", 14), 14)
    return d


def ult_feel_pass(d: dict) -> dict:
    """max VFX-7: an ultimate's landing squashes the body it strikes (feel squash, no hit flash: the T4 beat already
    lights the victim, and the body must keep its detail); defs that carry their own feel are left alone. Idempotent."""
    if "_ult_" not in d["id"] or d["id"].endswith("_windup") or not _is_t4_impact(d) or any(l["type"] == "feel" for l in d["layers"]):
        return d
    d = copy.deepcopy(d)
    at = next((l.get("at") for l in d["layers"] if l["type"] == "flash"), "ground")
    d["layers"] = d["layers"] + [L("feel", at=at, squash=0.14)]
    return d

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


def bespoke(defs: list) -> list:
    return [secondary_pass(ult_pass(signature_pass(drop_shake(copy.deepcopy(d))))) for d in defs]

#!/usr/bin/env python3
"""material_library.py — index the F: Poly Haven PBR texture sets by surface, and
deterministically pick() a set for a (theme, surface, seed).

Keystone context (see pipeline/engine/AAA_HANDOFF.md): the AAA Three.js kernel renders
MeshStandard PBR, but the generator never feeds it real materials — F: holds 40 Poly
Haven sets referenced by nothing. This is the index + chooser the Three-kernel author
target (Tier 3) calls to dress scenery.

On-disk layout (via the junction pipeline/assets -> F:/games/forgeflow-games-assets):
    _downloaded/polyhaven-textures/<set>/{diffuse,rough,ao,displacement}.jpg
NOTE the sets carry NO normal map and NO metalness map — texture_transcode.derive_normal
synthesizes a tangent-space normal from displacement at stage time (the "missing normals"
fix); metalness defaults to 0 (these are all dielectric ground/wall surfaces).

If F: isn't mounted, root() returns None and pick() returns None so callers skip cleanly.
"""
import hashlib
from pathlib import Path

ART_DIR = Path(__file__).resolve().parent
# pipeline/art -> pipeline -> forgeflow-games ; assets is a junction to F:
TEX_ROOT = ART_DIR.parent / "assets" / "_downloaded" / "polyhaven-textures"

# map filenames on disk -> logical PBR channel
_CHANNEL_FILES = {
    "diffuse": ["diffuse.jpg", "diff.jpg", "albedo.jpg", "color.jpg"],
    "rough":   ["rough.jpg", "roughness.jpg"],
    "ao":      ["ao.jpg", "ambientocclusion.jpg"],
    "disp":    ["displacement.jpg", "disp.jpg", "height.jpg"],
    "normal":  ["nor_gl.jpg", "normal.jpg", "nor.jpg"],   # usually absent -> derived
}

# surface bucket -> substrings matched against the set name (a set may match several)
SURFACE_KEYWORDS = {
    "grass":    ["grass", "lawn", "meadow", "turf"],
    "ground":   ["ground", "dirt", "mud", "soil", "bitumen", "gravel", "forest_floor", "earth"],
    "rock":     ["rock", "stone", "cliff", "boulder", "slate"],
    "sand":     ["sand", "beach", "desert", "dune"],
    "concrete": ["concrete", "cement", "asphalt", "pavement", "tarmac", "asbestos",
                 "anti_slip", "anti_skid", "tiles", "tile", "pit_lane", "track"],
    "metal":    ["metal", "steel", "iron", "rust", "beam", "corrugated", "aluminium",
                 "plate", "scifi", "sci_fi"],
    "wood":     ["wood", "plank", "bark", "timber", "log", "board", "planks"],
    "brick":    ["brick", "wall", "stucco", "masonry", "paint_plaster"],
}

# theme -> surfaces preferred (soft bias only; surface arg is the hard filter)
THEME_SURFACE_BIAS = {
    "forest":  ["grass", "ground", "rock", "wood"],
    "desert":  ["sand", "rock", "ground"],
    "urban":   ["concrete", "brick", "metal"],
    "ruins":   ["brick", "concrete", "rock", "ground"],
    "indoor":  ["wood", "brick", "concrete"],
    "snow":    ["ground", "rock", "concrete"],
    "scifi":   ["metal", "concrete"],
    "default": [],
}


def root():
    """Return the texture root Path if F: is mounted, else None."""
    return TEX_ROOT if TEX_ROOT.exists() else None


def _channels(set_dir: Path) -> dict:
    files = {p.name.lower(): p.name for p in set_dir.iterdir() if p.is_file()}
    out = {}
    for chan, names in _CHANNEL_FILES.items():
        for n in names:
            if n in files:
                out[chan] = files[n]
                break
    return out


def index() -> dict:
    """{set_name: {"dir": Path, "channels": {chan: filename}, "surfaces": [..]}}.
    Only sets that have at least a diffuse map are included."""
    r = root()
    if not r:
        return {}
    out = {}
    for d in sorted(r.iterdir()):
        if not d.is_dir():
            continue
        chans = _channels(d)
        if "diffuse" not in chans:
            continue
        name = d.name.lower()
        surfaces = [s for s, kws in SURFACE_KEYWORDS.items() if any(k in name for k in kws)]
        out[d.name] = {"dir": d, "channels": chans, "surfaces": surfaces}
    return out


def surfaces() -> dict:
    """{surface: [set_name,...]} — which real sets back each surface bucket."""
    idx = index()
    out = {s: [] for s in SURFACE_KEYWORDS}
    for name, meta in idx.items():
        for s in meta["surfaces"]:
            out[s].append(name)
    return out


def _stable_int(*parts) -> int:
    h = hashlib.sha1("::".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return int(h[:8], 16)


def pick(theme="default", surface="ground", seed=0) -> dict | None:
    """Deterministically choose a material set for (theme, surface, seed).

    Returns {"name", "dir": Path, "channels": {chan: filename}, "surface", "theme",
    "files": {chan: Path}} or None if F: not mounted / no set matches the surface.
    Same (theme, surface, seed) -> same set, always (sha1-seeded, not salted hash()).
    """
    idx = index()
    if not idx:
        return None
    candidates = sorted(n for n, m in idx.items() if surface in m["surfaces"])
    if not candidates:                       # surface unknown -> any set, still deterministic
        candidates = sorted(idx.keys())
    if not candidates:
        return None
    # soft theme bias: if the theme prefers this surface, keep candidates as-is; the
    # seed still spreads picks across the bucket so neighbouring scenery varies.
    choice = candidates[_stable_int(theme, surface, seed) % len(candidates)]
    meta = idx[choice]
    return {
        "name": choice,
        "dir": meta["dir"],
        "channels": meta["channels"],
        "surface": surface,
        "theme": theme,
        "files": {chan: meta["dir"] / fn for chan, fn in meta["channels"].items()},
    }


if __name__ == "__main__":
    import json
    r = root()
    if not r:
        print("polyhaven-textures not mounted (F: junction absent)")
        raise SystemExit(0)
    s = surfaces()
    print("sets indexed:", len(index()))
    print(json.dumps({k: len(v) for k, v in s.items()}, indent=1))
    for surf in SURFACE_KEYWORDS:
        p = pick("forest", surf, 1)
        print(f"  pick(forest,{surf},1) -> {p['name'] if p else None}  "
              f"channels={list(p['channels']) if p else []}")

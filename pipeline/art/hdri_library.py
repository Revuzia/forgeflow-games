#!/usr/bin/env python3
"""hdri_library.py — index the F: Poly Haven HDRIs by lighting theme and pick() one
for image-based lighting (IBL) in the Three.js kernel (scene.environment via RGBELoader
+ PMREM). pick() returns the real 2k .hdr path; stage() prefilters it to a small env
that fits the payload budget (_hdr_codec downsamples 6.6MB -> ~0.5MB).

Layout (junction pipeline/assets -> F:): _downloaded/polyhaven-hdris/<name>/<name>_2k.hdr
Themes: indoor | night | dusk | day  (keyword-classified from the HDRI name; default day
for outdoor, indoor for interiors). If F: not mounted, root() is None and pick() is None.
"""
import hashlib
from pathlib import Path

ART_DIR = Path(__file__).resolve().parent
HDRI_ROOT = ART_DIR.parent / "assets" / "_downloaded" / "polyhaven-hdris"

# theme -> name substrings (checked in this priority order; first hit wins)
THEME_KEYWORDS = [
    ("night",  ["night", "moonlit", "midnight", "stars", "dikhololo_night"]),
    ("dusk",   ["dusk", "sunset", "sunrise", "dawn", "golden", "evening", "twilight"]),
    ("indoor", ["interior", "indoor", "room", "hall", "workshop", "garage", "canteen",
                "lounge", "bakery", "factory", "museum", "terminal", "waterworks",
                "shell", "hopper", "studio", "office", "warehouse", "church_interior",
                "bedroom", "kitchen", "basement", "hangar", "shed", "house"]),
    ("day",    ["field", "park", "bridge", "exterior", "sky", "noon", "afternoon",
                "alps", "beach", "forest", "meadow", "outdoor", "street", "square",
                "courtyard", "garden", "lake", "hill", "desert", "snow", "morning"]),
]
DEFAULT_THEME = "day"

# requested game theme -> preferred IBL theme(s)
GAME_THEME_BIAS = {
    "forest": ["day", "dusk"], "desert": ["day"], "urban": ["day", "dusk"],
    "ruins": ["indoor", "dusk"], "indoor": ["indoor"], "snow": ["day"],
    "scifi": ["indoor", "night"], "night": ["night"], "default": ["day"],
}


def root():
    return HDRI_ROOT if HDRI_ROOT.exists() else None


def _classify(name: str) -> str:
    n = name.lower()
    for theme, kws in THEME_KEYWORDS:
        if any(k in n for k in kws):
            return theme
    return DEFAULT_THEME


def _hdr_file(set_dir: Path) -> Path | None:
    # prefer 2k (small enough to decode fast, downsampled at stage time); else any .hdr
    for suffix in ("_2k.hdr", "_1k.hdr"):
        cand = set_dir / f"{set_dir.name}{suffix}"
        if cand.exists():
            return cand
    hdrs = sorted(set_dir.glob("*.hdr"))
    return hdrs[0] if hdrs else None


def index() -> dict:
    """{name: {"dir", "file": Path, "theme"}} for every HDRI set with a .hdr."""
    r = root()
    if not r:
        return {}
    out = {}
    for d in sorted(r.iterdir()):
        if not d.is_dir():
            continue
        f = _hdr_file(d)
        if f:
            out[d.name] = {"dir": d, "file": f, "theme": _classify(d.name)}
    return out


def themes() -> dict:
    out = {"indoor": [], "night": [], "dusk": [], "day": []}
    for name, m in index().items():
        out[m["theme"]].append(name)
    return out


def _stable_int(*parts) -> int:
    h = hashlib.sha1("::".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return int(h[:8], 16)


def pick(theme="default", seed=0) -> dict | None:
    """Pick an HDRI for a game theme. Returns {"name","file":Path,"theme","ibl_theme"}
    or None if F: not mounted. Deterministic on (theme, seed)."""
    idx = index()
    if not idx:
        return None
    prefs = GAME_THEME_BIAS.get(theme, GAME_THEME_BIAS["default"])
    candidates = sorted(n for n, m in idx.items() if m["theme"] in prefs)
    if not candidates:
        candidates = sorted(idx.keys())
    choice = candidates[_stable_int(theme, seed) % len(candidates)]
    m = idx[choice]
    return {"name": choice, "file": m["file"], "theme": theme, "ibl_theme": m["theme"]}


def stage(hdri: dict, out_path, target_h: int = 256) -> int:
    """Prefilter the picked HDRI to a small env .hdr at out_path. Returns byte size."""
    from _hdr_codec import stage_hdr
    return stage_hdr(str(hdri["file"]), str(out_path), target_h)


if __name__ == "__main__":
    import json
    if not root():
        print("polyhaven-hdris not mounted (F: junction absent)"); raise SystemExit(0)
    t = themes()
    print("HDRIs indexed:", len(index()))
    print(json.dumps({k: len(v) for k, v in t.items()}, indent=1))
    for gt in ("forest", "indoor", "scifi", "night"):
        p = pick(gt, 1)
        print(f"  pick({gt},1) -> {p['name'] if p else None} (ibl={p['ibl_theme'] if p else None})")

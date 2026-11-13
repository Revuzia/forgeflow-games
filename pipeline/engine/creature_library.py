"""creature_library — query the unified CC0/CC-BY creature catalog and bundle
models into pipeline-built games.

The catalog is `pipeline/assets/3d-models/CREATURES_INDEX.json` (1,555 models from
Quaternius, Poly Pizza, Kenney, OpenGameArt). Each entry:
    {name, source, file (rel to 3d-models/), format, browser_ready,
     license, license_class ("CC0"|"CC-BY"), attribution, type, animated}

The binaries are gitignored (re-downloadable) — this helper resolves a request to
a model file on the LOCAL library and copies it into a game. On a fresh checkout
where the binaries are absent, bundle() returns False and callers degrade
gracefully (the game still builds, just without that creature).

LICENSE rule: CC0 = use freely. CC-BY = must credit (the `attribution` field). For
monetized games prefer license_class="CC0"; if you take a CC-BY model, record its
attribution into the game's content['credits'] (build_order does this for you).

CLI:
    python creature_library.py --stats
    python creature_library.py --query --type sea --license CC0 --limit 10
    python creature_library.py --pick  --type sea --name Shark --license CC0
"""
import json
import hashlib
import shutil
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
LIB = ENGINE.parent / "assets" / "3d-models"
INDEX = LIB / "CREATURES_INDEX.json"

_cache = None


def load_index():
    global _cache
    if _cache is None:
        _cache = json.loads(INDEX.read_text(encoding="utf-8"))
    return _cache


def query(*, type=None, license_class=None, browser_ready=True,
          name_contains=None, animated=None, source=None, format=None):
    """Return catalog entries matching the filters (browser_ready GLB/glTF by default)."""
    models = load_index().get("models", [])
    nc = (name_contains or "").lower()

    def ok(m):
        if browser_ready and not m.get("browser_ready"):
            return False
        if type and m.get("type") != type:
            return False
        if license_class and m.get("license_class") != license_class:
            return False
        if source and m.get("source") != source:
            return False
        if format and (m.get("format") or "").lower() != format.lower():
            return False
        if animated is not None and bool(m.get("animated")) != animated:
            return False
        if nc and nc not in (m.get("name") or "").lower():
            return False
        return True

    return [m for m in models if ok(m)]


def pick(*, n=1, seed=None, prefer_cc0=True, **filters):
    """Pick up to n entries. Deterministic given a seed (hash-ordered). If
    prefer_cc0 and no license filter is set, CC0 results sort ahead of CC-BY so
    monetized games default to no-attribution models."""
    res = query(**filters)
    if not res:
        return []
    if prefer_cc0 and not filters.get("license_class"):
        res.sort(key=lambda m: 0 if m.get("license_class") == "CC0" else 1)
    if seed is not None:
        keyed = sorted(res, key=lambda m: hashlib.md5((str(seed) + m["file"]).encode()).hexdigest())
        if prefer_cc0 and not filters.get("license_class"):
            keyed.sort(key=lambda m: 0 if m.get("license_class") == "CC0" else 1)
        res = keyed
    return res[:n]


def find(file_rel):
    """Look up a single entry by its index `file` path (rel to 3d-models/)."""
    for m in load_index().get("models", []):
        if m.get("file") == file_rel:
            return m
    return None


def resolve_path(entry_or_file):
    """Absolute path to a model on the local library."""
    f = entry_or_file["file"] if isinstance(entry_or_file, dict) else entry_or_file
    return LIB / f


def bundle(entry_or_file, dest_abs):
    """Copy a library model to dest_abs (an absolute Path). Returns True on success,
    False if the source binary is absent (gitignored / not downloaded)."""
    src = resolve_path(entry_or_file)
    if not src.exists():
        return False
    dest_abs = Path(dest_abs)
    dest_abs.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest_abs)
    return True


def attribution_line(entry):
    """A credit string for a CC-BY model (empty for CC0)."""
    if not entry or entry.get("license_class") == "CC0":
        return ""
    name = entry.get("name", "model")
    attr = entry.get("attribution") or entry.get("source") or "unknown"
    return f"{name} — {attr} (CC-BY), via {entry.get('source', 'library')}"


# A sensible default ocean set for naval / battleship 3D games: real CC0 sea
# creatures + a (CC-BY) flying seagull. Each slot: model dest + a library lookup
# (file) + render hints (length, rotY so the nose faces +X, count, air flag).
DEFAULT_OCEAN_LIFE = {
    "gull":    {"file": "polypizza/animals/Hawk Lp Rigged.glb",  "dest": "assets/creatures/bird.glb",    "length": 4.6, "rotY": -1.5707963267948966, "count": 5, "air": True, "animated": True, "clip": "Fly"},
    "dolphin": {"file": "polypizza/animals/Dolphin.glb",        "dest": "assets/creatures/dolphin.glb", "length": 8,   "rotY": 1.5707963267948966, "count": 2},
    "shark":   {"file": "polypizza/animals/Shark.glb",          "dest": "assets/creatures/shark.glb",   "length": 13,  "rotY": 1.5707963267948966, "count": 1},
    "whale":   {"file": "polypizza/animals/Whale-JGFwp6.glb",   "dest": "assets/creatures/whale.glb",   "length": 24,  "rotY": 1.5707963267948966, "count": 1},
    "manta":   {"file": "polypizza/animals/Manta ray.glb",      "dest": "assets/creatures/manta.glb",   "length": 11,  "rotY": 1.5707963267948966, "count": 1},
}


def _main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--query", action="store_true")
    ap.add_argument("--pick", action="store_true")
    ap.add_argument("--type")
    ap.add_argument("--license", dest="license_class")
    ap.add_argument("--name", dest="name_contains")
    ap.add_argument("--source")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--seed")
    a = ap.parse_args()
    if a.stats:
        idx = load_index()
        print("total:", idx.get("total"))
        for k in ("by_type", "by_license", "by_source"):
            if k in idx:
                print(k + ":", json.dumps(idx[k]))
        return
    filt = dict(type=a.type, license_class=a.license_class, name_contains=a.name_contains, source=a.source)
    if a.pick:
        res = pick(n=a.limit, seed=a.seed, **filt)
    else:
        res = query(**filt)
    print(f"{len(res)} match(es):")
    for m in res[:a.limit]:
        exists = "OK " if resolve_path(m).exists() else "MISS"
        print(f"  [{exists}] [{m.get('license_class')}] {m.get('name'):26} {m.get('file')}")


if __name__ == "__main__":
    _main()

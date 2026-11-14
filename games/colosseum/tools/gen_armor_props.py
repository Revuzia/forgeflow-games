#!/usr/bin/env python3
"""Generate REAL armor/weapon props via Meshy text-to-3D (static, no rig).

The procedural galea/lorica read as toys next to the Meshy bodies — the audit
called the armor gap and the owner wants AAA-standard pieces. These are STATIC
props: they attach to bones through the existing equipment solves (world-space
full-basis align + bbox fit), so no rigging credits are spent.

Each prop: preview (5cr) + refine w/ texture (10cr) ≈ 15 credits.

usage:
  python games/colosseum/tools/gen_armor_props.py            # all pending
  python games/colosseum/tools/gen_armor_props.py galea_murmillo
  python games/colosseum/tools/gen_armor_props.py --dry-run
"""
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
# Reuse the proven helpers (api, poll, compress) from the roster generator.
import gen_gladiators as G  # noqa: E402

OUT = HERE.parent / "assets" / "props"
STATE = HERE.parent / "assets" / "props" / "_gen_state.json"

PROPS = {
    "galea_murmillo": (
        "A Roman murmillo gladiator helmet (galea): polished bronze, broad curved brim, "
        "high angular crest ridge for a horsehair plume, full face guard with a round "
        "perforated grille over the face, small round eye openings, neck guard flaring at "
        "the back. Museum-quality reproduction, worn bronze with dents and patina. "
        "Single object on a plain background, upright as if worn, front facing the camera."
    ),
    "lorica_musculata": (
        "A Roman muscled bronze cuirass (lorica musculata): sculpted idealized torso "
        "muscles in polished bronze, front chest plate with anatomical detail, leather "
        "shoulder straps with bronze buckles, row of leather pteruges strips hanging at "
        "the waist. Museum-quality, battle-worn. Single object on a plain background, "
        "upright, front facing the camera."
    ),
    "gladius_ornate": (
        "A Roman gladius short sword: straight double-edged steel blade with a subtle "
        "central fuller, ornate hilt with ivory grip ridges, bronze guard and heavy "
        "spherical bronze pommel with engraved ring detail. Blade pointing straight up, "
        "single object on a plain background."
    ),
    "spatha_ornate": (
        "A Roman spatha cavalry longsword: long straight double-edged steel blade, "
        "dark leather-wrapped grip, bronze crossguard and disc pommel with silver inlay. "
        "Blade pointing straight up, single object on a plain background."
    ),
}


def poll2(tid, label, timeout_s=1800):
    """v2-endpoint poll — G.poll hardcodes /openapi/v1/."""
    import time as _t
    t0 = _t.time()
    last = -1
    while _t.time() - t0 < timeout_s:
        t = G.api(f"/openapi/v2/text-to-3d/{tid}")
        st, pr = t.get("status"), t.get("progress", 0)
        if pr != last:
            print(f"    {label}: {st} {pr}%")
            last = pr
        if st == "SUCCEEDED":
            return t
        if st in ("FAILED", "CANCELED"):
            raise RuntimeError(f"{label}: {st} {t.get('task_error')}")
        _t.sleep(8)
    raise RuntimeError(f"{label}: poll timeout")


def state():
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}


def save(s):
    OUT.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(s, indent=1), encoding="utf-8")


def build(name, prompt, st):
    rec = st.setdefault(name, {})
    if rec.get("done"):
        print(f"  {name}: already built")
        return
    if "prev_id" not in rec:
        rec["prev_id"] = G.api("/openapi/v2/text-to-3d", {
            "mode": "preview", "prompt": prompt, "art_style": "realistic",
            "topology": "triangle", "target_polycount": 12000,
        })["result"]
        save(st)
        print(f"  {name}: preview submitted {rec['prev_id']}")
    prev = poll2(rec["prev_id"], name)
    if "ref_id" not in rec:
        rec["ref_id"] = G.api("/openapi/v2/text-to-3d", {
            "mode": "refine", "preview_task_id": rec["prev_id"], "enable_pbr": True,
        })["result"]
        save(st)
        print(f"  {name}: refine submitted {rec['ref_id']}")
    ref = poll2(rec["ref_id"], name)
    url = ref["model_urls"]["glb"]
    raw = OUT / f"{name}_raw.glb"
    dst = OUT / f"{name}.glb"
    G.download(url, raw)
    size, note = G.compress(raw, dst)
    raw.unlink(missing_ok=True)
    rec["done"] = True
    save(st)
    print(f"  {name}: {size // 1024} KB ({note})")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    names = args or list(PROPS)
    if "--dry-run" in sys.argv:
        print(f"{len(names)} props x ~15 credits = ~{len(names) * 15}; balance {G.balance()}")
        return 0
    st = state()
    print(f"=== ARMOR PROP GENERATION === balance {G.balance()}")
    for n in names:
        if n not in PROPS:
            print("unknown:", n)
            continue
        try:
            build(n, PROPS[n], st)
        except Exception as e:
            print(f"  {name if False else n}: FAILED — {e}")
    print(f"done. balance {G.balance()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

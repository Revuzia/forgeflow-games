#!/usr/bin/env python3
"""Generate REAL Roman spectators for the crowd impostor atlas (Meshy).

WHY THIS IS FREE AT RUNTIME
The crowd renders as impostors: every spectator is a 2-triangle camera-facing
card sampling one cell of a baked atlas. The atlas is a PHOTOGRAPH of a real
model, so the source can be as detailed as we like — 300k triangles or 3k, the
frame cost is identical. Detail here buys looks at zero FPS.

The atlas has been baked from ONE body (the player's own gladiator), which is
why 18,000 people in the stands read as 18,000 copies of the same man. These
are the variety: six civilians, three calm and three cheering, so the bake can
give every seat a different person and a different pose.

NOT RIGGED. gen_gladiators pays 20 credits per body because a fighter needs a
skeleton; a spectator is photographed once and never animates in the mesh (the
bob, bounce, lean and wave all happen in the card's vertex shader). Image-to-3D
only: ~10 credits each, ~60 for the set.

usage:
  python games/colosseum/tools/gen_crowd_people.py            # all pending
  python games/colosseum/tools/gen_crowd_people.py --dry-run
"""
import base64
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gen_gladiators as G  # noqa: E402  (api / gen_art / poll / download / compress)

OUT = HERE.parent / "assets" / "crowd"
SRC = HERE / "_crowd_src"
STATE = OUT / "_gen_state.json"

# Framing shared by every prompt: the bake photographs these from eight yaws at
# a shallow downward angle, so the whole figure must be visible and centred.
FRAME = (" Full figure from head to feet, centred, plain flat background, "
         "even neutral lighting, no props, no shadows, front three-quarter view.")

PEOPLE = {
    # --- calm / seated ------------------------------------------------------
    "plebs_m1": (
        "A Roman plebeian man in his thirties seated on a stone bench, plain "
        "undyed wool tunic belted at the waist, bare forearms, short dark hair, "
        "leaning forward with elbows on knees, watching intently." + FRAME),
    "matron_f1": (
        "A Roman woman seated on a stone bench, long saffron-yellow stola over a "
        "white under-tunic, hair bound up with a fillet, hands folded in her lap, "
        "calm and upright." + FRAME),
    "senator_m1": (
        "An older Roman senator seated, white toga with a broad purple stripe over "
        "the shoulder, grey hair, lined face, one hand resting on his knee, "
        "dignified and still." + FRAME),
    # --- cheering / arms up -------------------------------------------------
    "plebs_m2_cheer": (
        "A Roman plebeian man standing and cheering, both arms raised overhead, "
        "russet-red wool tunic, mouth open shouting, weight on the front foot." + FRAME),
    "woman_f2_cheer": (
        "A Roman woman standing and cheering, one arm raised waving a strip of "
        "cloth, deep blue stola, dark hair loose at the shoulders, "
        "leaning forward excitedly." + FRAME),
    "youth_m3_cheer": (
        "A young Roman man standing and shouting, both fists raised, short green "
        "tunic, lean build, dark curly hair, caught mid-yell." + FRAME),
}


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
    SRC.mkdir(parents=True, exist_ok=True)
    art = SRC / f"{name}.jpg"
    if not art.exists():
        print(f"  [art]  {name} ...", flush=True)
        G.gen_art(prompt, art)
    if not rec.get("img_id"):
        b64 = base64.b64encode(art.read_bytes()).decode()
        rec["img_id"] = G.api("/openapi/v1/image-to-3d", {
            "image_url": f"data:image/jpeg;base64,{b64}",
            "model_type": "smart-topology", "ai_model": "meshy-t2",
            "should_texture": True, "target_polycount": 10000,
        })["result"]
        save(st)
    print(f"  [mesh] {name} ...", flush=True)
    task = G.poll("image-to-3d", rec["img_id"], name)

    urls = []

    def harvest(node, prefix=""):
        if isinstance(node, str) and node.startswith("http"):
            urls.append((prefix, node))
        elif isinstance(node, dict):
            for k, v in node.items():
                harvest(v, k)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                harvest(v, f"{prefix}{i}")

    harvest(task.get("model_urls"))
    harvest(task.get("result"))
    glb = next((u for k, u in urls if u.split("?")[0].endswith(".glb")), None)
    if not glb:
        raise RuntimeError(f"{name}: no glb in response")

    OUT.mkdir(parents=True, exist_ok=True)
    raw = SRC / f"{name}_raw.glb"
    dst = OUT / f"{name}.glb"
    G.download(glb, raw)
    size, note = G.compress(raw, dst)
    raw.unlink(missing_ok=True)
    rec["done"] = True
    rec["credits"] = task.get("consumed_credits")
    save(st)
    print(f"  {name}: {size // 1024} KB ({note})")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    names = args or list(PEOPLE)
    if "--dry-run" in sys.argv:
        print(f"{len(names)} spectators x ~10 credits = ~{len(names) * 10}; balance {G.balance()}")
        return 0
    st = state()
    print(f"=== CROWD PEOPLE === balance {G.balance()}")
    for n in names:
        if n not in PEOPLE:
            print("unknown:", n)
            continue
        try:
            build(n, PEOPLE[n], st)
        except Exception as e:
            print(f"  {n}: FAILED — {e}")
    print(f"done. balance {G.balance()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Generate the full gladiator roster: xAI T-pose art -> Meshy -> compressed GLB.

Proven by the 20-credit pilot (see reference_meshy_smart_topology):
  * Smart Topology (meshy-t2, TEXTURED) IS auto-riggable — 15 credits
  * auto-rig — 5 credits, and it bundles walk + run clips free
  * NO remesh needed: T2 caps at 15k faces, far under the 300k rig limit
  * the T2 rig's 24 bone names are IDENTICAL to the existing ForgeFlow rig, so
    the combat clips (slash1/slash2/parry/hit/death/finisher) retarget with NO
    animation credits spent

So each fighter costs a flat 20 credits plus ~$0.02 of source art.

Every body is generated WITHOUT a helmet: the galea is an equipment piece that
attaches to the Head bone at runtime, so one body serves helmeted and bare.

usage:
  python games/colosseum/tools/gen_gladiators.py            # all pending
  python games/colosseum/tools/gen_gladiators.py secutor    # named subset
  python games/colosseum/tools/gen_gladiators.py --list
  python games/colosseum/tools/gen_gladiators.py --dry-run  # cost only
"""
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CFG = Path(os.path.expandvars("%APPDATA%")) / "Nomi" / "api_config.json"
HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "assets" / "chars"
SRC = OUT / "_src"
STATE = HERE / "_gladiator_state.json"
LEDGER = Path(r"C:\Users\TestRun\Claude Claw\state\usage\meshy_3d.jsonl")

_c = json.loads(CFG.read_text(encoding="utf-8"))
MESHY_KEY = _c["meshy"]["api_key"]
XAI_KEY = (_c.get("xai") or _c["providers"]["xai"])["api_key"]

CREDITS_PER = 20

# The T-pose recipe that makes auto-rig succeed first try. Every clause here
# exists because of a documented failure: capes block rigging outright, held
# props get skinned across body bones, spread fingers become claws.
TPOSE = ("full-body character reference, entire figure from head to feet clearly visible, "
         "standing in a strict symmetrical T-POSE with BOTH ARMS extended straight out "
         "horizontally to the sides at shoulder height, hands open with fingers straight and held "
         "TOGETHER (fingers NOT spread apart), palms facing down, legs straight and slightly apart, "
         "feet flat, facing directly forward, perfectly symmetrical and centered, "
         "NOTHING held in the hands, NO helmet, NO cape, NO cloak, NO flowing fabric, NO weapon, "
         "isolated on a plain flat dark charcoal background, photorealistic, clean even studio "
         "lighting, ultra detailed, no text, no border, no watermark")

# Historically-grounded kit per armatura. Helmets are deliberately absent.
ROSTER = {
    "murmillo": "A Roman gladiator of the MURMILLO type: bare muscular torso and bare legs, wide studded brown leather belt over a short red loincloth, segmented bronze armguard on the RIGHT arm only, tall bronze greave on the LEFT shin only, bare feet, close-cropped dark hair, olive Mediterranean skin, scarred and weathered, powerfully built. ",
    "secutor": "A Roman gladiator of the SECUTOR type: bare muscular torso, wide dark leather belt over a dull crimson loincloth, segmented iron armguard on the RIGHT arm, tall iron greave on the LEFT shin, bare feet, shaved head, pale olive skin, heavily scarred, thickset and broad. ",
    "retiarius": "A Roman gladiator of the RETIARIUS type: completely bare torso with NO armour on the body, a wide leather belt over a plain blue-grey loincloth, a segmented bronze armguard on the LEFT arm topped by a tall flaring bronze shoulder guard rising above the left shoulder, bare legs, bare feet, dark curly hair, lean and wiry athletic build, tanned skin. ",
    "thraex": "A Roman gladiator of the THRAEX type: bare muscular torso, wide studded belt over a deep green loincloth, segmented bronze armguard on the RIGHT arm, TWO tall bronze greaves reaching above the knee on BOTH legs over quilted white leg wrappings, bare feet, dark hair and short beard, Thracian features, compact and muscular. ",
    "hoplomachus": "A Roman gladiator of the HOPLOMACHUS type: bare muscular torso, wide belt over an ochre-yellow loincloth, segmented bronze armguard on the RIGHT arm, TWO tall bronze greaves on BOTH legs over thick quilted leg padding, bare feet, short dark hair, Greek features, tall and lean. ",
    "dimachaerus": "A Roman gladiator of the DIMACHAERUS type: bare muscular torso with NO shield and no body armour, wide leather belt over a black loincloth, segmented iron armguards on BOTH arms, low bronze greaves on both shins, bare feet, long dark hair tied back, whipcord-lean and fast-looking, many old scars. ",
    "provocator": "A Roman gladiator of the PROVOCATOR type: bare torso except for a rectangular bronze chest plate (cardiophylax) strapped across the chest, wide belt over a white loincloth, segmented armguard on the RIGHT arm, one greave on the LEFT shin, bare feet, short military haircut, clean-shaven, sturdy Roman soldier build. ",
    "crupellarius": "A Gaulish gladiator of the CRUPELLARIUS type: almost entirely encased in dull riveted iron plate armour covering torso, both arms and both legs, heavy and immobile looking, only the head bare showing a grim scarred face with matted fair hair, enormous and slow, dark tarnished metal. ",
    # 2026-07-27 additions — the eques finally gets his own body (jousts have
    # been borrowing the shared fighter), and the arena gets its first
    # mythological SPECTACLE opponent. Historical note kept honest: minotaurs
    # were never real combatants — but Rome staged mythological pageants and
    # fatal charades in the arena, so the ludus billing "The Bull of Knossos"
    # as a spectacle bout is period-plausible theatre. Humanoid frame is the
    # point: Meshy's auto-rig is humanoid-only and the shared 24-bone names
    # mean he inherits EVERY existing combat clip for free.
    "eques": "A Roman gladiator of the EQUES type, a mounted cavalry fighter on foot: fitted white sleeveless tunic with a red leather cuirass over it, wide belt, bare muscular arms, snug riding trousers to mid-calf, low leather riding boots, athletic horseman's build, short dark hair, clean-shaven, upright proud posture. ",
    "minotaur": "A massive MINOTAUR arena spectacle fighter: the head of a great horned bull with dark fur, on an enormous muscular HUMAN body standing upright on two human legs, thick dark fur over the shoulders fading to bronzed human skin on the torso and arms, wide studded leather belt over a ragged dark loincloth, heavy leather wraps on the forearms, human hands and human feet, hunched powerful shoulders, arena-scarred hide. ",
    "scissor": "A Roman gladiator of the SCISSOR type: bare muscular torso under a short chainmail shirt (lorica hamata) reaching the hips, wide belt over a dark loincloth, a segmented iron armguard on the RIGHT arm, low greaves on both shins, bare feet, close-cropped hair, hard weathered face, compact powerful build. ",
}

MESHY = "https://api.meshy.ai"


def api(path, body=None, timeout=120):
    req = urllib.request.Request(
        MESHY + path, data=json.dumps(body).encode() if body is not None else None,
        method="POST" if body is not None else "GET",
        headers={"Authorization": f"Bearer {MESHY_KEY}", "Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {path}: {e.read().decode('utf-8','replace')[:250]}") from None


def balance():
    return api("/openapi/v1/balance")["balance"]


def state():
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}


def save(s):
    STATE.write_text(json.dumps(s, indent=1), encoding="utf-8")


def gen_art(prompt, dest):
    payload = json.dumps({"model": "grok-imagine-image", "prompt": prompt,
                          "n": 1, "response_format": "b64_json"}).encode()
    req = urllib.request.Request("https://api.x.ai/v1/images/generations", data=payload,
                                 method="POST",
                                 headers={"Authorization": f"Bearer {XAI_KEY}",
                                          "Content-Type": "application/json"})
    for attempt in range(1, 4):
        try:
            body = json.loads(urllib.request.urlopen(req, timeout=240).read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403) or attempt == 3:
                raise RuntimeError(f"xAI HTTP {e.code}: {e.read().decode('utf-8','replace')[:200]}") from None
            time.sleep(2 ** attempt)
    raw = base64.b64decode(body["data"][0]["b64_json"])
    from PIL import Image
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    if max(w, h) > 1024:
        im = im.resize((round(w * 1024 / h), 1024) if h >= w else (1024, round(h * 1024 / w)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=93)
    return dest


def poll(kind, tid, label, timeout_s=1200):
    t0 = time.time()
    last = -1
    while time.time() - t0 < timeout_s:
        t = api(f"/openapi/v1/{kind}/{tid}")
        st, pr = t.get("status"), t.get("progress", 0)
        if pr != last:
            print(f"      {label} {st} {pr}%", flush=True)
            last = pr
        if st == "SUCCEEDED":
            return t
        if st in ("FAILED", "CANCELED", "EXPIRED"):
            raise RuntimeError(f"{label} {st}: {json.dumps(t.get('task_error') or {})[:250]}")
        time.sleep(6)
    raise RuntimeError(f"{label} timed out")


def download(url, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=420) as r, dst.open("wb") as f:
        f.write(r.read())
    return dst.stat().st_size


def compress(src: Path, dst: Path):
    """
    Texture-compress the rigged GLB. simplify is OFF deliberately — decimating a
    skinned mesh destroys the vertex weights and the character comes apart.
    """
    exe = shutil.which("gltf-transform") or shutil.which("gltf-transform.cmd")
    if not exe:
        shutil.copy(src, dst)
        return dst.stat().st_size, "gltf-transform NOT FOUND — shipped uncompressed"
    cmd = [exe, "optimize", str(src), str(dst),
           "--texture-size", "1024", "--texture-compress", "webp",
           "--simplify", "false", "--compress", "draco"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or not dst.exists():
        shutil.copy(src, dst)
        return dst.stat().st_size, f"optimize failed ({r.stderr.strip()[:120]}) — shipped raw"
    return dst.stat().st_size, "ok"


def build_one(name, st):
    prompt = ROSTER[name] + TPOSE
    rec = st.setdefault(name, {})
    art = SRC / f"{name}_tpose.jpg"
    dest_dir = OUT / name

    if not art.exists():
        print(f"  [art] {name} ...", flush=True)
        gen_art(prompt, art)
    if not rec.get("img_id"):
        b64 = base64.b64encode(art.read_bytes()).decode()
        rec["img_id"] = api("/openapi/v1/image-to-3d", {
            "image_url": f"data:image/jpeg;base64,{b64}",
            "model_type": "smart-topology", "ai_model": "meshy-t2",
            "should_texture": True, "target_polycount": 12000,
        })["result"]
        save(st)
    print(f"  [mesh] {name} ...", flush=True)
    img = poll("image-to-3d", rec["img_id"], name)
    rec["img_credits"] = img.get("consumed_credits")
    save(st)

    if not rec.get("rig_id"):
        rec["rig_id"] = api("/openapi/v1/rigging", {
            "input_task_id": rec["img_id"], "height_meters": 1.82})["result"]
        save(st)
    print(f"  [rig]  {name} ...", flush=True)
    rig = poll("rigging", rec["rig_id"], name)
    rec["rig_credits"] = rig.get("consumed_credits")

    # Harvest every URL — the response shape varies by Meshy version.
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

    harvest(rig.get("result"))
    harvest(rig.get("model_urls"))
    harvest(rig.get("basic_animations"))

    dest_dir.mkdir(parents=True, exist_ok=True)
    tmp = SRC / f"{name}_rigged_raw.glb"
    got = {}
    for key, u in urls:
        base = u.split("?")[0]
        if not base.endswith(".glb"):
            continue
        if "rigged_character" in key and "base" not in got:
            download(u, tmp)
            got["base"] = True
        elif "walking_armature" in key:
            download(u, dest_dir / "walk_arm.glb"); got["walk"] = True
        elif "running_armature" in key:
            download(u, dest_dir / "run_arm.glb"); got["run"] = True

    if got.get("base"):
        size, note = compress(tmp, dest_dir / "base.glb")
        rec["base_kb"] = size // 1024
        rec["compress"] = note
        print(f"      base.glb {size//1024} KB ({note})")
        try:
            tmp.unlink()
        except OSError:
            pass

    # Combat clips are SHARED — the rigs are bone-identical, so every fighter
    # reuses one authored set instead of buying animations per character.
    shared = OUT / "_shared_clips"
    if shared.exists():
        for clip in shared.glob("anim_*.glb"):
            tgt = dest_dir / clip.name
            if not tgt.exists():
                shutil.copy(clip, tgt)

    rec["done"] = True
    save(st)
    return rec


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}

    if "--list" in flags:
        for k in ROSTER:
            print(f"  {k}")
        return 0

    st = state()
    names = args or list(ROSTER)
    unknown = [n for n in names if n not in ROSTER]
    if unknown:
        print("unknown:", ", ".join(unknown))
        return 2
    todo = [n for n in names if not st.get(n, {}).get("done")]

    bal = balance()
    print(f"\n=== GLADIATOR ROSTER GENERATION ===")
    print(f"balance {bal} credits")
    print(f"{len(todo)} to build x {CREDITS_PER} credits = {len(todo) * CREDITS_PER}")
    print(f"  {', '.join(todo) if todo else '(nothing pending)'}\n")
    if "--dry-run" in flags or not todo:
        return 0
    if len(todo) * CREDITS_PER > bal:
        print("ABORT — not enough credits")
        return 1

    ok, failed = [], []
    for n in todo:
        print(f"[{n}]", flush=True)
        try:
            build_one(n, st)
            ok.append(n)
        except Exception as e:
            print(f"  FAILED: {e}")
            failed.append((n, str(e)[:160]))

    after = balance()
    spent = bal - after
    print(f"\nbuilt {len(ok)}/{len(todo)}  spent {spent} credits  balance {after}")
    for n, e in failed:
        print(f"  FAILED {n}: {e}")
    ledger_entry = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "game": "colosseum",
                    "op": "gladiator_roster", "built": ok, "failed": [f[0] for f in failed],
                    "spent": spent, "balance_after": after}
    try:
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with LEDGER.open("a", encoding="utf-8") as f:
            f.write(json.dumps(ledger_entry) + "\n")
    except Exception:
        pass
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())

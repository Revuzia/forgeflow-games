#!/usr/bin/env python3
"""Meshy SMART TOPOLOGY pilot — one gladiator, ~20 credits.

THE QUESTION THIS ANSWERS
-------------------------
Meshy's Smart Topology (`model_type: smart-topology`, `ai_model: meshy-t2`) is
HALF the price of meshy-6 at every tier and caps at 15k faces — under the 300k
auto-rigging limit, which would let us skip the 5-credit remesh step entirely.

But the docs are SILENT on whether its output can be auto-rigged, and there are
two reasons to doubt it:
  1. Meshy's rigging docs exclude "untextured meshes" outright, so the headline
     5-credit tier is dead for characters. Only the 15-credit textured tier is
     even a candidate.
  2. T2 advertises "natively separated parts", and separated geometry is a KNOWN
     rig-killer on this account — re-rigging the dungeon-forge knight failed
     three times at the same 84% because of its cape.

So: spend 20 on ONE character and find out. Rigging credits are refunded on
failure, so a failed pilot costs 15, not 20.

  PASS -> six gladiator archetypes cost ~120 credits total
  FAIL -> fall back to the proven meshy-6 + remesh + rig path at ~40 each (~240)

Either way the answer is bought once and reused.

usage:
  python games/colosseum/tools/meshy_pilot.py            # run it
  python games/colosseum/tools/meshy_pilot.py --status   # poll an in-flight run
  python games/colosseum/tools/meshy_pilot.py --dry-run  # plan + balance only
"""
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CFG = Path(os.path.expandvars("%APPDATA%")) / "Nomi" / "api_config.json"
HERE = Path(__file__).resolve().parent
GAME = HERE.parent
OUT = GAME / "assets" / "chars" / "_pilot"
STATE = HERE / "_meshy_pilot_state.json"
LEDGER = Path(r"C:\Users\TestRun\Claude Claw\state\usage\meshy_3d.jsonl")

_cfg = json.loads(CFG.read_text(encoding="utf-8"))
MESHY_KEY = _cfg["meshy"]["api_key"]
XAI_KEY = (_cfg.get("xai") or _cfg["providers"]["xai"])["api_key"]

# The T-pose recipe that makes Meshy's auto-rig come out clean, from
# reference_meshy_char_rig_calibration: strict T-pose, fingers TOGETHER, empty
# hands, NO CAPE (a cape is a deterministic auto-rig failure), plain background.
TPOSE = ("full-body video-game character reference sheet, entire figure from head to feet "
         "clearly visible, standing in a strict symmetrical T-POSE with BOTH ARMS extended "
         "straight out horizontally to the sides at shoulder height, hands open with fingers "
         "straight and held TOGETHER (fingers NOT spread apart), palms facing down, legs "
         "straight and slightly apart, feet flat on the ground, facing directly forward, "
         "perfectly symmetrical and centered, NOTHING held in the hands, NO cape, NO cloak, "
         "NO flowing fabric, isolated on a plain flat dark charcoal background, "
         "clean even studio lighting, ultra detailed, no text, no border, no watermark")

SUBJECT = (
    "A Roman gladiator of the MURMILLO type, historically accurate: bare muscular torso and bare legs, "
    "a wide studded brown leather belt (balteus) over a short red loincloth (subligaculum), "
    "a segmented bronze armguard (manica) on the RIGHT arm only, a tall bronze greave on the LEFT shin only, "
    "bare feet, close-cropped dark hair, no helmet, olive-toned Mediterranean skin, scarred and weathered. "
)

PILOT = {"id": "murmillo_pilot", "prompt": SUBJECT + TPOSE, "height_m": 1.82}

MESHY = "https://api.meshy.ai"


# ---------------------------------------------------------------------------

def api(path, body=None, method=None, timeout=120):
    req = urllib.request.Request(
        MESHY + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method or ("POST" if body is not None else "GET"),
        headers={"Authorization": f"Bearer {MESHY_KEY}", "Content-Type": "application/json"},
    )
    try:
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {path}: {e.read().decode('utf-8','replace')[:300]}") from None


def balance():
    return api("/openapi/v1/balance")["balance"]


def ledger(entry):
    try:
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with LEDGER.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"  (ledger write failed: {e})")


def load_state():
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}


def save_state(s):
    STATE.write_text(json.dumps(s, indent=1), encoding="utf-8")


# ---------------------------------------------------------------------------

def gen_tpose_art(prompt, dest):
    """xAI T-pose reference, ~$0.02."""
    payload = json.dumps({"model": "grok-imagine-image", "prompt": prompt,
                          "n": 1, "response_format": "b64_json"}).encode()
    req = urllib.request.Request(
        "https://api.x.ai/v1/images/generations", data=payload, method="POST",
        headers={"Authorization": f"Bearer {XAI_KEY}", "Content-Type": "application/json"})
    body = json.loads(urllib.request.urlopen(req, timeout=240).read().decode())
    raw = base64.b64decode(body["data"][0]["b64_json"])
    from PIL import Image
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    if max(w, h) > 1024:
        im = im.resize((round(w * 1024 / h), 1024) if h >= w else (1024, round(h * 1024 / w)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=93)
    return dest


def poll(kind, task_id, label, timeout_s=900):
    """Poll a Meshy task to a terminal state."""
    t0 = time.time()
    last = -1
    while time.time() - t0 < timeout_s:
        t = api(f"/openapi/v1/{kind}/{task_id}")
        st = t.get("status")
        pr = t.get("progress", 0)
        if pr != last:
            print(f"    {label}: {st} {pr}%", flush=True)
            last = pr
        if st == "SUCCEEDED":
            return t
        if st in ("FAILED", "CANCELED", "EXPIRED"):
            raise RuntimeError(f"{label} {st}: {json.dumps(t.get('task_error') or {})[:300]}")
        time.sleep(6)
    raise RuntimeError(f"{label} timed out after {timeout_s}s")


def download(url, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as r, dst.open("wb") as f:
        f.write(r.read())
    return dst.stat().st_size


# ---------------------------------------------------------------------------

def main():
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    st = load_state()

    bal = balance()
    print(f"\n=== MESHY SMART-TOPOLOGY PILOT ===")
    print(f"live balance: {bal} credits")
    print(f"plan: image-to-3d smart-topology TEXTURED (15) + auto-rig (5) = 20 credits")
    print(f"      rigging is refunded on failure, so a failed pilot costs 15\n")

    if "--dry-run" in flags:
        print("dry run — nothing spent")
        return 0

    if "--status" in flags:
        print(json.dumps(st, indent=1))
        return 0

    st.setdefault("started_balance", bal)
    art = OUT / f"{PILOT['id']}_tpose.jpg"

    # --- 1. source art ------------------------------------------------------
    if not art.exists():
        print("[1/4] generating T-pose reference art (xAI, ~$0.02) ...", flush=True)
        gen_tpose_art(PILOT["prompt"], art)
        print(f"      -> {art.name} ({art.stat().st_size // 1024} KB)")
    else:
        print(f"[1/4] reusing existing art {art.name}")

    # --- 2. image-to-3d, SMART TOPOLOGY --------------------------------------
    if not st.get("img_id"):
        b64 = base64.b64encode(art.read_bytes()).decode()
        body = {
            "image_url": f"data:image/jpeg;base64,{b64}",
            # THE PILOT VARIABLE — the untested path.
            "model_type": "smart-topology",
            "ai_model": "meshy-t2",
            "should_texture": True,          # untextured CANNOT be rigged
            "target_polycount": 12000,       # T2 range is 100..15000
        }
        print("[2/4] image-to-3d (smart-topology / meshy-t2, textured) ...", flush=True)
        st["img_id"] = api("/openapi/v1/image-to-3d", body)["result"]
        save_state(st)
        print(f"      task {st['img_id']}")
    else:
        print(f"[2/4] resuming image-to-3d {st['img_id']}")

    img = poll("image-to-3d", st["img_id"], "image-to-3d")
    st["img_credits"] = img.get("consumed_credits")
    save_state(st)
    glb_url = (img.get("model_urls") or {}).get("glb")
    print(f"      SUCCEEDED, consumed {st['img_credits']} credits")
    if glb_url:
        raw_dst = OUT / f"{PILOT['id']}_raw.glb"
        print(f"      downloaded raw mesh: {download(glb_url, raw_dst) // 1024} KB")

    # --- 3. auto-rig — THE ACTUAL TEST ---------------------------------------
    rig_ok, rig_err = False, None
    if not st.get("rig_id"):
        print("[3/4] auto-rigging (THE TEST — does smart-topology output rig?) ...", flush=True)
        try:
            st["rig_id"] = api("/openapi/v1/rigging", {
                "input_task_id": st["img_id"],
                "height_meters": PILOT["height_m"],
            })["result"]
            save_state(st)
            print(f"      task {st['rig_id']}")
        except Exception as e:
            rig_err = str(e)
            print(f"      REJECTED AT SUBMIT: {rig_err}")
    if st.get("rig_id") and not rig_err:
        try:
            rig = poll("rigging", st["rig_id"], "rigging")
            st["rig_credits"] = rig.get("consumed_credits")
            rig_ok = True

            # The rigging response shape varies by Meshy version, so pull every
            # http(s) URL out of it rather than guessing one key.
            def harvest(node, found, prefix=""):
                if isinstance(node, str) and node.startswith("http"):
                    found.append((prefix or "model", node))
                elif isinstance(node, dict):
                    for k, v in node.items():
                        harvest(v, found, k)
                elif isinstance(node, list):
                    for i, v in enumerate(node):
                        harvest(v, found, f"{prefix}{i}")

            urls = []
            harvest(rig.get("result"), urls)
            harvest(rig.get("model_urls"), urls)
            harvest(rig.get("basic_animations"), urls)

            seen = set()
            for key, u in urls:
                if u in seen or not u.split("?")[0].endswith((".glb", ".fbx")):
                    continue
                seen.add(u)
                name = f"{PILOT['id']}_{key}".replace("_url", "")
                ext = ".glb" if ".glb" in u.split("?")[0] else ".fbx"
                kb = download(u, OUT / f"{name}{ext}") // 1024
                print(f"      {key}: {kb} KB")

            st["rig_raw"] = {k: v for k, v in rig.items() if k not in ("preceding_tasks",)}
            save_state(st)
        except Exception as e:
            rig_err = str(e)
            print(f"      RIG FAILED: {rig_err}")

    # --- 4. verdict ----------------------------------------------------------
    time.sleep(3)
    after = balance()
    spent = st["started_balance"] - after
    st.update({"ended_balance": after, "spent": spent, "rig_ok": rig_ok, "rig_error": rig_err})
    save_state(st)

    print(f"\n[4/4] VERDICT")
    print(f"      smart-topology mesh : {'OK' if st.get('img_credits') is not None else 'FAILED'}")
    print(f"      auto-rig            : {'OK' if rig_ok else 'FAILED'}")
    print(f"      balance {st['started_balance']} -> {after}  (spent {spent})")
    if rig_ok:
        print(f"      => Smart Topology IS riggable. Six archetypes ~= {6 * spent} credits.")
    else:
        print(f"      => Smart Topology is NOT riggable for characters.")
        print(f"         Fall back to meshy-6 + remesh + rig (~40 each, ~240 for six).")

    ledger({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "game": "colosseum",
            "op": "smart_topology_pilot", "char": PILOT["id"],
            "img_credits": st.get("img_credits"), "rig_credits": st.get("rig_credits"),
            "spent": spent, "rig_ok": rig_ok, "rig_error": rig_err,
            "balance_after": after})
    print(f"      ledgered to {LEDGER}")
    print(f"      artefacts in {OUT}")
    return 0 if rig_ok else 1


if __name__ == "__main__":
    sys.exit(main())

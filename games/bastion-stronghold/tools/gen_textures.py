#!/usr/bin/env python3
"""Generate original ground textures + key art for Bastion Realms: Stronghold via xAI grok-imagine-image.
Post-processes each ground texture into a guaranteed-seamless square tile (mirror fold)."""
import base64, json, os, sys, urllib.request
from pathlib import Path
from PIL import Image
import io

NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"
OUT = Path(__file__).resolve().parents[1] / "assets" / "textures"
OUT.mkdir(parents=True, exist_ok=True)

cfg = json.loads((NOMI / "api_config.json").read_text(encoding="utf-8"))
KEY = cfg["providers"]["xai"]["api_key"]

BASE = ("Strictly top-down orthographic view of a game ground texture, seamless tileable, "
        "uniform diffuse lighting, no shadows from objects, no borders or vignette, "
        "stylized painterly low-fantasy game art, muted rich colors, high detail. ")

JOBS = {
    "ground_colosseum": BASE + "Ancient roman colosseum arena floor: packed golden sand over worn "
                        "travertine flagstones, faint chariot wheel ruts and rake marks.",
    "ground_gothic":    BASE + "Gothic castle courtyard at night: dark rain-slick cobblestones with "
                        "moss in the joints, deep grey-blue stones.",
    "ground_sky":       BASE + "Floating sky citadel pavement: white and pale-blue marble tiles with "
                        "thin gold inlay lines, faint cloud wisps across the surface.",
    "ground_crystal":   BASE + "Enchanted crystal fortress floor: polished amethyst and violet geode "
                        "tiles with glowing lavender veins between them.",
    "ground_dwarven":   BASE + "Dwarven mountain forge hall floor: dark basalt hexagonal setts with "
                        "brass rivets and thin glowing ember cracks.",
    "keyart":           "Epic fantasy game key art, dramatic wide shot: a majestic stone bastion keep "
                        "with crimson banners standing at the center of a besieged arena, converging "
                        "roads with glowing catapult fire and construct armies advancing from all sides, "
                        "sunset storm light, painterly AAA splash-art style, no text, no watermark.",
}

def gen(prompt: str) -> bytes:
    req = urllib.request.Request(
        "https://api.x.ai/v1/images/generations",
        data=json.dumps({
            "model": "grok-imagine-image",
            "prompt": prompt,
            "response_format": "b64_json",
        }).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    resp = json.load(urllib.request.urlopen(req, timeout=120))
    return base64.b64decode(resp["data"][0]["b64_json"])

def seamless_square(img: Image.Image, size=512) -> Image.Image:
    """Center-crop square, then mirror-fold quadrant -> guaranteed seamless tile."""
    w, h = img.size
    s = min(w, h)
    img = img.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize((size, size), Image.LANCZOS)
    q = img.resize((size // 2, size // 2), Image.LANCZOS)
    tile = Image.new("RGB", (size, size))
    tile.paste(q, (0, 0))
    tile.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (size // 2, 0))
    tile.paste(q.transpose(Image.FLIP_TOP_BOTTOM), (0, size // 2))
    tile.paste(q.transpose(Image.ROTATE_180), (size // 2, size // 2))
    return tile

failed = []
for name, prompt in JOBS.items():
    out = OUT / f"{name}.jpg"
    if out.exists() and out.stat().st_size > 30_000:
        print(f"[skip] {name}")
        continue
    print(f"[gen] {name}…", flush=True)
    try:
        raw = gen(prompt)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        if name.startswith("ground_"):
            seamless_square(img, 512).save(out, "JPEG", quality=88)
        else:
            img.save(out, "JPEG", quality=90)
        print(f"  -> OK {out.stat().st_size // 1024}KB")
    except Exception as e:
        print(f"  -> ERROR {e}")
        failed.append(name)

print("FAILED:", failed if failed else "none")
sys.exit(1 if failed else 0)

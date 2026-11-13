#!/usr/bin/env python3
"""Generate seamless tileable PBR material sets from xAI grok-imagine-image.

WHY THIS EXISTS
---------------
`texture_transcode.py` can derive a normal map, but it is wired to the Poly
Haven sets on F: — there was NO path from a generated 2D image to a full PBR
material. This closes that gap, so any ForgeFlow game can mint original,
licence-free floors/walls/ground without hunting a library.

Each job produces FOUR maps from ONE generated image:
    <name>_albedo.webp      base colour, seamless
    <name>_normal.webp      tangent-space (OpenGL +Y), derived from luminance
    <name>_rough.webp       roughness, from inverted local contrast
    <name>_ao.webp          ambient occlusion, from large-scale luminance

The maps are DERIVED, not guessed: a photographic albedo already encodes most
of its own relief in luminance, so a high-pass of the luma is a serviceable
height field, and the same signal at two different scales separates
"micro-detail -> roughness" from "broad cavities -> AO".

SEAMLESSNESS
------------
Two strategies, picked per material:
  offset  — wrap-shift by half, then feather the resulting cross-seam with a
            mirrored blend. Preserves large-scale structure. DEFAULT.
  mirror  — quadrant mirror-fold. Guarantees a seam-free tile but imposes
            obvious 4-fold symmetry, so it is only for fine, near-isotropic
            grain (sand, gravel) where the symmetry does not read.

The old siegeheart generator used `mirror` for everything, which is very
visible on structured surfaces like brick and flagstone.

usage:
  python pipeline/art/gen_pbr_materials.py                 # all jobs
  python pipeline/art/gen_pbr_materials.py sand_arena wall_travertine
  python pipeline/art/gen_pbr_materials.py --list
  python pipeline/art/gen_pbr_materials.py --dry-run       # cost only, no spend
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

import numpy as np
from PIL import Image, ImageFilter

try:
    from scipy import ndimage
    HAVE_SCIPY = True
except ImportError:                     # numpy fallback keeps this dependency-light
    HAVE_SCIPY = False

NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"
OUT = Path(__file__).resolve().parents[2] / "pipeline" / "assets" / "generated-materials"
MODEL = "grok-imagine-image"            # $0.02/image; -quality is $0.05
COST_PER_IMAGE_USD = 0.02

BASE = ("Strictly top-down orthographic photograph of a surface, filling the entire frame, "
        "seamless tileable texture, flat even diffuse lighting with no cast shadows, "
        "no vignette, no border, no object, no horizon, no perspective, "
        "photorealistic, high detail, sharp focus. ")

# `seam` picks the tiling strategy; `rough` biases the roughness map
# (0 = mirror-smooth, 1 = fully matte).
JOBS = {
    # --- the Colosseum ----------------------------------------------------
    # NOTE: "raked into fine parallel furrows" made Grok produce WOOD PLANKING —
    # the parallel-line cue overrode the material. Describe the GRAINS, and say
    # what it must not be.
    "sand_arena":       dict(seam="mirror", rough=0.97, prompt=BASE + "Loose dry granular golden-ochre sand, close-up macro of countless individual sand grains and small pebbles, gritty uneven granular surface, shallow scuff marks. This is loose sand, NOT wood, NOT planks, NOT any straight parallel lines."),
    # sand_bloodied was REMOVED: xAI content-moderation rejects blood-stained
    # ground ("imagine:content-moderated", and the attempt is still billed).
    # It was redundant regardless — sand.js composites blood into the harena
    # from a live damage render target, which is both cheaper and reactive.
    "wall_travertine":  dict(seam="offset", rough=0.88, prompt=BASE + "Ancient Roman travertine limestone block wall, large ashlar blocks, warm cream and honey tones, weathered pitting and hairline cracks, fine mortar joints."),
    "floor_marble":     dict(seam="offset", rough=0.35, prompt=BASE + "Polished white and grey veined Roman marble floor slabs, rectangular tiles, subtle grey veining, thin dark joints."),
    "floor_mosaic":     dict(seam="offset", rough=0.45, prompt=BASE + "Ancient Roman floor mosaic of small square tesserae in cream, terracotta red, black and ochre, simple geometric meander border pattern, slightly uneven tiles."),
    "wall_brick_roman": dict(seam="offset", rough=0.90, prompt=BASE + "Ancient Roman opus latericium brickwork, thin flat red-orange bricks in regular courses with thick pale mortar beds, weathered."),
    "wood_planks":      dict(seam="offset", rough=0.86, prompt=BASE + "Heavy aged oak planks with iron banding, dark weathered timber, visible grain and knots, tight joints."),
    "stone_cobble":     dict(seam="offset", rough=0.92, prompt=BASE + "Ancient Roman road cobblestones, large irregular polygonal basalt setts fitted tightly, worn smooth on top, dirt in the joints."),
    "iron_plate":       dict(seam="offset", rough=0.42, prompt=BASE + "Dark hammered wrought iron plate, subtle hammer dimples, faint rust bloom at the edges, slightly oiled."),
    "bronze_worn":      dict(seam="offset", rough=0.38, prompt=BASE + "Aged bronze sheet with warm golden-brown patina and traces of green verdigris in the recesses, hammered surface."),
    "cloth_banner":     dict(seam="offset", rough=0.95, prompt=BASE + "Deep crimson coarse woven wool cloth, visible weave threads, slight fading and wear."),
    "leather_worn":     dict(seam="offset", rough=0.80, prompt=BASE + "Worn dark brown leather, natural grain, faint creasing and scuffing, matte."),

    # --- general-purpose, reusable by any ForgeFlow game -------------------
    "grass_meadow":     dict(seam="mirror", rough=0.96, prompt=BASE + "Lush green meadow grass seen from directly above, dense fine blades, a few tiny wildflowers, natural variation."),
    "dirt_packed":      dict(seam="mirror", rough=0.96, prompt=BASE + "Packed dry earth ground, fine cracked clay surface, small stones and grit."),
    "snow_fresh":       dict(seam="mirror", rough=0.72, prompt=BASE + "Fresh clean snow surface, soft granular texture, subtle wind ripples."),
    "sand_desert":      dict(seam="mirror", rough=0.97, prompt=BASE + "Fine pale desert sand with delicate wind ripples, no footprints."),
    "rock_cliff":       dict(seam="offset", rough=0.93, prompt=BASE + "Grey granite rock face, rough fractured surface, deep crevices and lichen patches."),
    "water_surface":    dict(seam="offset", rough=0.10, prompt=BASE + "Clear shallow water surface with gentle ripples, seen from directly above, blue-green."),
}


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def api_key() -> str:
    cfg = json.loads((NOMI / "api_config.json").read_text(encoding="utf-8"))
    return cfg["providers"]["xai"]["api_key"]


def preflight(key: str) -> dict:
    """$0 health check. team_blocked => every image call 403s regardless."""
    req = urllib.request.Request(
        "https://api.x.ai/v1/api-key", headers={"Authorization": f"Bearer {key}"}
    )
    return json.load(urllib.request.urlopen(req, timeout=30))


def generate(prompt: str, key: str, retries: int = 3) -> bytes:
    """One image. Retries 429/5xx with backoff per the project error policy."""
    body = json.dumps({"model": MODEL, "prompt": prompt, "response_format": "b64_json"}).encode()
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(
            "https://api.x.ai/v1/images/generations", data=body,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
        try:
            resp = json.load(urllib.request.urlopen(req, timeout=180))
            return base64.b64decode(resp["data"][0]["b64_json"])
        except urllib.error.HTTPError as e:
            code = e.code
            detail = e.read().decode("utf-8", "replace")[:200]
            # 400/401/403 are logic/credential errors — never retry them.
            if code in (400, 401, 403) or attempt == retries:
                raise RuntimeError(f"HTTP {code}: {detail}") from None
            wait = 2 ** attempt
            print(f"    HTTP {code}, retry {attempt}/{retries - 1} in {wait}s", flush=True)
            time.sleep(wait)
        except Exception as e:
            if attempt == retries:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


# ---------------------------------------------------------------------------
# Seamless tiling
# ---------------------------------------------------------------------------

def _center_square(img: Image.Image, size: int) -> Image.Image:
    w, h = img.size
    s = min(w, h)
    return img.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize(
        (size, size), Image.LANCZOS)


def seamless_mirror(img: Image.Image, size: int) -> Image.Image:
    """Quadrant mirror-fold. Seam-free, but 4-fold symmetric — fine grain only."""
    img = _center_square(img, size)
    q = img.resize((size // 2, size // 2), Image.LANCZOS)
    tile = Image.new("RGB", (size, size))
    tile.paste(q, (0, 0))
    tile.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (size // 2, 0))
    tile.paste(q.transpose(Image.FLIP_TOP_BOTTOM), (0, size // 2))
    tile.paste(q.transpose(Image.ROTATE_180), (size // 2, size // 2))
    return tile


def seamless_offset(img: Image.Image, size: int, feather: float = 0.18) -> Image.Image:
    """
    Wrap-shift by half, then heal the cross-seam by blending in the mirrored
    image with a soft mask centred on the seam. Keeps large-scale structure
    (courses, joints, veining) that a mirror-fold would destroy.
    """
    base = _center_square(img, size)
    a = np.asarray(base, dtype=np.float32)

    # roll so the former edges meet in the middle
    rolled = np.roll(np.roll(a, size // 2, axis=0), size // 2, axis=1)

    # mask: 1 on the seam cross, falling off to 0
    fw = max(2, int(size * feather))
    ramp = np.ones(size, dtype=np.float32)
    c = size // 2
    for i in range(fw):
        v = i / fw
        w = 0.5 - 0.5 * np.cos(np.pi * v)          # smootherstep-ish
        ramp[c - fw + i] = 1.0 - w
        ramp[c + fw - i - 1] = 1.0 - w
    ramp[c - 1:c + 1] = 0.0
    mx = np.minimum.outer(np.ones(size, np.float32), ramp)
    my = np.minimum.outer(ramp, np.ones(size, np.float32))
    mask = np.minimum(mx, my)[..., None]

    # heal with a mirrored copy so the replacement content still matches in tone
    healer = np.asarray(base.transpose(Image.ROTATE_180), dtype=np.float32)
    healer = np.roll(np.roll(healer, size // 2, axis=0), size // 2, axis=1)
    out = rolled * mask + healer * (1.0 - mask)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


# ---------------------------------------------------------------------------
# PBR derivation
# ---------------------------------------------------------------------------

def _luma(rgb: np.ndarray) -> np.ndarray:
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]) / 255.0


def _blur(a: np.ndarray, sigma: float) -> np.ndarray:
    if HAVE_SCIPY:
        return ndimage.gaussian_filter(a, sigma=sigma, mode="wrap")
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32) / 255.0


def derive_height(albedo: Image.Image, detail: float = 1.0) -> np.ndarray:
    """
    Height from luminance, with the broad lighting gradient removed.

    Subtracting a heavy blur is what stops a slightly-brighter corner of the
    source photo from becoming a giant phantom bump in the normal map.
    """
    l = _luma(np.asarray(albedo, dtype=np.float32))
    lowfreq = _blur(l, sigma=max(4.0, albedo.size[0] / 24))
    h = (l - lowfreq) * detail + 0.5
    return np.clip(h, 0.0, 1.0)


def derive_normal(height: np.ndarray, strength: float = 2.6) -> Image.Image:
    """Tangent-space OpenGL normal (+Y up). Wrap mode keeps the tile seamless."""
    if HAVE_SCIPY:
        gx = ndimage.sobel(height, axis=1, mode="wrap") / 4.0
        gy = ndimage.sobel(height, axis=0, mode="wrap") / 4.0
    else:
        gy, gx = np.gradient(height)
    nx = -gx * strength
    ny = gy * strength
    nz = np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5
    return Image.fromarray((rgb * 255).astype(np.uint8))


def derive_roughness(albedo: Image.Image, base_rough: float = 0.9) -> Image.Image:
    """
    Roughness from micro-contrast: busy areas scatter, smooth areas reflect.
    Centred on `base_rough` so the material's character is authored, not guessed.
    """
    l = _luma(np.asarray(albedo, dtype=np.float32))
    detail = np.abs(l - _blur(l, sigma=2.0))
    d = detail / (detail.max() + 1e-6)
    r = np.clip(base_rough + (d - 0.35) * 0.30, 0.04, 1.0)
    return Image.fromarray((r * 255).astype(np.uint8)).convert("L")


def derive_ao(height: np.ndarray, strength: float = 0.85) -> Image.Image:
    """
    Cheap cavity AO: how far below its neighbourhood a texel sits. Real AO needs
    ray casting, but on a tiling surface this reads correctly and costs nothing.
    """
    broad = _blur(height, sigma=max(3.0, height.shape[0] / 64))
    cav = np.clip((height - broad) * 3.0 + 1.0, 0.0, 1.0)
    ao = 1.0 - (1.0 - cav) * strength
    return Image.fromarray((np.clip(ao, 0, 1) * 255).astype(np.uint8)).convert("L")


# ---------------------------------------------------------------------------

def build_material(name: str, spec: dict, raw: bytes, size: int, outdir: Path) -> dict:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    tile = (seamless_mirror if spec.get("seam") == "mirror" else seamless_offset)(img, size)

    height = derive_height(tile)
    maps = {
        "albedo": tile,
        "normal": derive_normal(height),
        "rough": derive_roughness(tile, spec.get("rough", 0.9)),
        "ao": derive_ao(height),
    }
    outdir.mkdir(parents=True, exist_ok=True)
    written = {}
    for kind, im in maps.items():
        p = outdir / f"{name}_{kind}.webp"
        im.save(p, "WEBP", quality=92 if kind in ("normal",) else 86, method=6)
        written[kind] = p.stat().st_size
    return written


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}

    if "--list" in flags:
        for n, s in JOBS.items():
            print(f"  {n:20} seam={s['seam']:7} rough={s['rough']}")
        return 0

    names = args or list(JOBS)
    unknown = [n for n in names if n not in JOBS]
    if unknown:
        print("unknown job(s):", ", ".join(unknown))
        return 2

    size = 1024
    todo = [n for n in names if not (OUT / f"{n}_albedo.webp").exists()]
    print(f"{len(names)} requested, {len(todo)} to generate "
          f"(~${len(todo) * COST_PER_IMAGE_USD:.2f} at ${COST_PER_IMAGE_USD}/image)")
    if "--dry-run" in flags:
        for n in todo:
            print(f"  would generate {n}")
        return 0
    if not todo:
        print("all present — nothing to do")
        return 0

    key = api_key()
    pf = preflight(key)
    if pf.get("team_blocked") or pf.get("api_key_blocked") or pf.get("api_key_disabled"):
        print("ABORT — xAI key/team is blocked:", json.dumps(pf))
        return 1
    print(f"preflight OK ({pf.get('name')})")

    ok, failed, total_bytes = [], [], 0
    for n in todo:
        print(f"[gen] {n} ...", flush=True)
        try:
            raw = generate(JOBS[n]["prompt"], key)
            written = build_material(n, JOBS[n], raw, size, OUT)
            b = sum(written.values())
            total_bytes += b
            ok.append(n)
            print("      " + "  ".join(f"{k}:{v // 1024}KB" for k, v in written.items()))
        except Exception as e:
            print(f"      FAILED: {e}")
            failed.append((n, str(e)[:120]))

    print(f"\ngenerated {len(ok)}/{len(todo)}  ({total_bytes / 1048576:.2f} MB)  "
          f"spent ~${len(ok) * COST_PER_IMAGE_USD:.2f}")
    print(f"out: {OUT}")
    if failed:
        print("failures:")
        for n, e in failed:
            print(f"  {n}: {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

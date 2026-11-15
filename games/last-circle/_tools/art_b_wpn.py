#!/usr/bin/env python3
"""art_b_wpn.py - render the six Last Circle weapon silhouettes for the HUD (dev-only; _tools/ never ships).

Output: assets/hud/wpn_<id>.png for id in pistol smg ar shotgun sniper glauncher
        160x60 RGBA, flat WHITE silhouette on transparent, muzzle to the RIGHT, side view, fitted to the box with a
        4 px margin (aspect kept; each gun fills its own box - relative gun size is NOT preserved, the sniper and
        the pistol are both full-width-or-full-height so a 64 px kill-feed chip stays legible).

Source geometry: the game's OWN weapon models (assets/props/meshy_wpn/wpn_<id>.glb, Meshy-generated on the owner's
account = original to this game, no third-party licence). They are fetched through the game itself so the in-game
orientation fix-ups (barrel to +Z, the manual AR / launcher flips, sights up) apply exactly as they do in a hand:
`__LC__.W.weaponProto(id)` -> Group, barrel +Z, up +Y. A second WebGLRenderer on an offscreen canvas draws each proto
with a white MeshBasicMaterial (orthographic camera on the -X side looking +X, so +Z is image-right) at 6x
(960x360) and Pillow downsamples with LANCZOS -> clean anti-aliased edges, alpha only.

The game files are READ only (served from the working copy through page routing, --disk).

USAGE   python games/last-circle/_tools/art_b_wpn.py [--check]   (--check = only validate what is on disk)
Exit codes: 0 ok, 1 an assertion failed, 2 could-not-judge (browser/boot problem, never a pass).
"""
from __future__ import annotations

import argparse
import base64
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
sys.path.insert(0, str(GAME / "_harness"))
OUT = GAME / "assets" / "hud"
IDS = ["pistol", "smg", "ar", "shotgun", "sniper", "glauncher"]
W_PX, H_PX, MARGIN, SS = 160, 60, 4, 6

# HUD-only corrections (the game files are never touched):
#  * smg: the proto the game builds has its MUZZLE at -Z (probe render with the real material, 2026-10-05:
#    orange muzzle device on the -Z end, stock on +Z; the in-game stock-vs-barrel vertex heuristic in
#    weapons.js counted 577 verts in the +Z third vs 870 in the -Z third and did not flip it, and WPN_FLIP lists
#    only ar + glauncher). An icon must read muzzle-right, so the HUD silhouette is mirrored. The in-hand
#    orientation is reported to the weapons owner, not fixed here.
#  * sniper: the Meshy model's butt-stock floats ~4 px (at 160 px) clear of the receiver. The icon bridges a
#    horizontal gap of up to 2 x radius px (at the 6x render) with a horizontal-only morphological closing,
#    limited to the stock end of the icon (so the trigger-guard hole survives), so it reads as one gun; no other
#    silhouette is touched.
HUD_FLIP = {"smg"}
HUD_BRIDGE = {"sniper": (30, 0.36)}      # (closing radius in 6x px, only the left <fraction> of the icon)

RENDER_JS = """
async ({ids, W, H, M, SS}) => {
  const THREE = await import('three');
  const LC = window.__LC__;
  const out = {};
  const canvas = document.createElement('canvas');
  canvas.width = W * SS; canvas.height = H * SS;
  const gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  gl.setPixelRatio(1); gl.setSize(W * SS, H * SS, false);
  gl.setClearColor(0x000000, 0);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  for (const id of ids) {
    const proto = await LC.W.weaponProto(id);
    if (!proto) { out[id] = { err: 'no proto' }; continue; }
    const g = proto.clone(true);
    g.traverse((o) => { if (o.isMesh) o.material = white; });
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.set(1, 1, 1);
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g);
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    const k = Math.min((W - 2 * M) / sz.z, (H - 2 * M) / sz.y);          // px per metre at 1x
    const cam = new THREE.OrthographicCamera(-W / 2 / k, W / 2 / k, H / 2 / k, -H / 2 / k, 0.01, 100);
    cam.position.set(c.x - 10, c.y, c.z); cam.up.set(0, 1, 0); cam.lookAt(c.x, c.y, c.z);
    cam.updateMatrixWorld(true);
    const scene = new THREE.Scene(); scene.add(g);
    gl.render(scene, cam);
    out[id] = { png: canvas.toDataURL('image/png'), size: [sz.x, sz.y, sz.z], k, tris: (() => { let n = 0; g.traverse((o) => { if (o.isMesh) { const gg = o.geometry; n += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } }); return n | 0; })() };
    scene.remove(g);
  }
  gl.dispose();
  return out;
}
"""


def validate(p: Path) -> tuple[bool, str]:
    if not p.exists():
        return False, "missing"
    im = Image.open(p)
    if im.size != (W_PX, H_PX) or im.mode != "RGBA":
        return False, f"{im.size} {im.mode}"
    a = np.asarray(im)
    al = a[..., 3]
    white_ok = bool((a[..., :3][al > 200] == 255).all())
    ys, xs = np.where(al > 24)
    if len(xs) == 0:
        return False, "empty"
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    fill = max(bw / (W_PX - 2 * MARGIN), bh / (H_PX - 2 * MARGIN))
    cover = float((al > 24).mean())
    edge_clear = al[0].max() == 0 and al[-1].max() == 0 and al[:, 0].max() == 0 and al[:, -1].max() == 0
    ok = white_ok and edge_clear and 0.9 <= fill <= 1.05 and 0.04 <= cover <= 0.6
    return ok, f"bbox {bw}x{bh} fill {fill:.2f} coverage {cover * 100:.1f}% white {white_ok} edge_clear {edge_clear} {p.stat().st_size} B"


def render(args) -> int:
    from common import Session, EnvFailure, HarnessError, add_common_args  # noqa: E402
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        with Session(args, name="art_b_wpn") as s:
            s.boot()
            res = s.js(RENDER_JS, {"ids": IDS, "W": W_PX, "H": H_PX, "M": MARGIN, "SS": SS})
            errs = [e for e in s.page_errors]
            if errs:
                print("page errors:", errs[:3])
    except (EnvFailure, HarnessError) as e:
        print("could-not-judge:", e)
        return 2
    for i in IDS:
        r = res.get(i) or {}
        if "png" not in r:
            print(f"FAIL {i}: {r.get('err', 'no render')}")
            return 1
        big = Image.open(io.BytesIO(base64.b64decode(r["png"].split(",", 1)[1]))).convert("RGBA")
        # alpha-only downsample: keep RGB pure white so a bilinear sample never darkens a fringe
        al = np.asarray(big.getchannel("A")).copy()
        if i in HUD_BRIDGE:
            rad, frac = HUD_BRIDGE[i]
            h, w = al.shape
            orig = al
            pad = np.pad(al, ((0, 0), (rad, rad)), mode="constant")
            dil = np.max([pad[:, k:k + w] for k in range(2 * rad + 1)], axis=0)
            pad2 = np.pad(dil, ((0, 0), (rad, rad)), mode="constant")
            closed = np.min([pad2[:, k:k + w] for k in range(2 * rad + 1)], axis=0)
            al = orig.copy()
            cut = int(w * frac)
            al[:, :cut] = closed[:, :cut]
        a = Image.fromarray(al).resize((W_PX, H_PX), Image.LANCZOS)
        if i in HUD_FLIP:
            a = a.transpose(Image.FLIP_LEFT_RIGHT)
        out = Image.new("RGBA", (W_PX, H_PX), (255, 255, 255, 0))
        out.putalpha(a)
        out.save(OUT / f"wpn_{i}.png", optimize=True)
        print(f"{i:10s} model {r['tris']} tris  bbox m x={r['size'][0]:.3f} y={r['size'][1]:.3f} z={r['size'][2]:.3f}  {r['k']:.1f} px/m")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    from common import add_common_args
    add_common_args(ap)
    ap.add_argument("--check", action="store_true")
    ap.set_defaults(disk=True)
    args = ap.parse_args()
    if not args.check:
        rc = render(args)
        if rc:
            return rc
    bad = 0
    total = 0
    for i in IDS:
        p = OUT / f"wpn_{i}.png"
        ok, why = validate(p)
        bad += 0 if ok else 1
        total += p.stat().st_size if p.exists() else 0
        print(f"{'ok  ' if ok else 'FAIL'} wpn_{i}.png  {why}")
    print(f"total {total} B")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

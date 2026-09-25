#!/usr/bin/env python
"""Cross-check the sim's screenOut (ai/enemies.ts: default-zoom camera rebuilt from config) against the
LIVE camera projection for every enemy on the field: max |ndc| both ways, at a given level.
    python _harness/scratch/view/screenout_check.py --base http://localhost:5240 --level 7"""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
sys.path.insert(0, HERE)
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402
from viewcheck import level_to  # noqa: E402

JS = r"""() => {
  const W = __H_W__(), T = W.titan, c = __BTCAM__, cam = c.camera, V = cam.position.constructor;
  const D = c.autoDist, p = 54 * Math.PI / 180, yaw = Math.PI / 4;
  const ox = Math.cos(p) * Math.sin(yaw), oy = Math.sin(p), oz = Math.cos(p) * Math.cos(yaw);
  const ux = -Math.sin(p) * Math.sin(yaw), uy = Math.cos(p), uz = -Math.sin(p) * Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), th = Math.tan(15 * Math.PI / 180), A = 16 / 9;
  const lx = T.vx * 0.25, lz = T.vz * 0.25, ty = T.height * 0.45;
  const rows = [];
  for (const e of W.enemies) {
    if (!e.alive) continue;
    const dx = e.x - (T.x + lx + D * ox), dy = -(ty + D * oy), dz = e.z - (T.z + lz + D * oz);
    const depth = -(dx * ox + dy * oy + dz * oz);
    const sx = (dx * rx + dz * rz) / depth, sy = (dx * ux + dy * uy + dz * uz) / depth;
    const mine = Math.max(Math.abs(sx) / (th * A), Math.abs(sy) / th);
    const v = new V(e.x, 0, e.z).project(cam);
    rows.push([+mine.toFixed(3), +Math.max(Math.abs(v.x), Math.abs(v.y)).toFixed(3), +(sx / (th * A)).toFixed(2), +(sy / th).toFixed(2), +v.x.toFixed(2), +v.y.toFixed(2)]);
  }
  return { D, dist: c.distance, camAspect: cam.aspect, target: c.target, titan: [T.x, T.z], rows: rows.slice(0, 12) };
}"""

def main():
    ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument('--level', type=int, default=7)
    args = ap.parse_args()
    with Session(args, 'screenout') as s:
        s.goto(build_url(args.base, autostart=1, dev=1, noslate=1, titan='molo', biome='grideast', seed=5))
        s.wait_bt(60); s.wait_screen(['play', 'slate', 'draft'], 90); ensure_play(s, 20); s.cheat('god', True)
        if args.level > 1: level_to(s, args.level, print)
        t_end = time.time() + 30
        while time.time() < t_end:
            st = s.state()
            if st['screen'] == 'draft': s.press('Digit1')
            elif st['drafts']['pending'] <= 0 and st['screen'] == 'play': break
            time.sleep(0.4)
        time.sleep(6)
        s.bt_call('freeze', True); time.sleep(0.5)
        print(json.dumps(s.js(JS)))
    return 0

if __name__ == '__main__':
    sys.exit(main())

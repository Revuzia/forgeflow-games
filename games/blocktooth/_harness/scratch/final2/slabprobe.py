#!/usr/bin/env python
"""Final battery: what is the red-striped slab at the top-right of the Size V PARKADE-6 shots?
Sets up the parkade_intro shot (MOLO Size V, GRID-EAST, bossSpawn parkade6, frozen), then lists the
meshes whose projected bounding sphere covers the NDC probe point, nearest first (read-only)."""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402

PICK_JS = r"""
([nx, ny, boss]) => {
  const c = window.__BT__.debugCore; const cam = c.camera; const V = cam.position.constructor;
  cam.updateMatrixWorld(); const out = [];
  c.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let vis = true; for (let p = o.parent; p; p = p.parent) if (!p.visible) { vis = false; break; }
    if (!vis) return;
    const g = o.geometry; if (!g) return; if (!g.boundingSphere) g.computeBoundingSphere();
    const bs = g.boundingSphere; if (!bs) return;
    const w = new V().copy(bs.center).applyMatrix4(o.matrixWorld);
    const s = new V(); o.getWorldScale(s); const r = bs.radius * Math.max(s.x, s.y, s.z);
    const d = w.distanceTo(cam.position);
    const p = w.clone().project(cam);
    const edge = w.clone().add(new V(r, 0, 0).applyQuaternion(cam.quaternion)).project(cam);
    const rn = Math.abs(edge.x - p.x);
    if (Math.hypot(p.x - nx, (p.y - ny) * 0.5625) < rn && p.z < 1) {
      const path = []; for (let q = o; q && q !== c.scene; q = q.parent) path.push(q.name || q.type);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      out.push({ path: path.reverse().join('/'), d: +d.toFixed(1), r: +r.toFixed(1), ndc: [+p.x.toFixed(2), +p.y.toFixed(2)],
        inst: !!o.isInstancedMesh, count: o.count, mat: m && m.name, color: m && m.color && m.color.getHexString(),
        pos: [+w.x.toFixed(1), +w.y.toFixed(1), +w.z.toFixed(1)] });
    }
  });
  out.sort((a, b) => a.d - b.d);
  const W = window.__BT__.world; const b = W.boss;
  return { cam: [cam.position.x, cam.position.y, cam.position.z].map((v) => +v.toFixed(1)), near: cam.near,
           titan: [W.titan.x, W.titan.z, W.titan.height], boss: b && [b.x, b.z, b.id], hits: out.slice(0, 12) };
}
"""

def main():
    ap = argparse.ArgumentParser(); add_common_args(ap)
    ap.add_argument("--boss", type=int, default=1)
    a = ap.parse_args()
    with Session(a, "slabprobe") as s:
        s.goto(build_url(a.base, dev=1, noslate=1, autostart=1, titan="molo", biome="grideast", seed=7))
        s.wait_bt(90); s.wait_screen(("play", "draft"), 90); ensure_play(s, 20)
        s.cheat("god", True); s.cheat("noSpawns", True); s.cheat("killAll"); s.cheat("level", 35)
        time.sleep(0.6); ensure_play(s, 10)
        if a.boss:
            s.cheat("bossSpawn", "parkade6")
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
        from shots import Battery
        r = s.js(Battery.PARKADE_STEP_JS, ["intro", "intro", 1.3, 1, 30 * 240])
        print("step", r)
        time.sleep(1.2)
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "slab_%d.png" % a.boss)
        s.screenshot(out)
        print("shot", out)
        from PIL import Image
        import io
        vp = s.page.viewport_size
        clip = {"x": vp["width"] * 0.88, "y": vp["height"] * 0.15, "width": vp["width"] * 0.1, "height": vp["height"] * 0.2}
        def redfrac():
            im = Image.open(io.BytesIO(s.page.screenshot(clip=clip))).convert("RGB").resize((40, 40))
            px = list(im.getdata())
            return sum(1 for q in px if q[0] > 200 and q[1] < 110 and q[2] < 120) / len(px)
        def redfull(tag):
            im = Image.open(io.BytesIO(s.page.screenshot())).convert("RGB")
            W, H = im.size
            c = im.crop((int(W * 0.88), int(H * 0.15), int(W * 0.99), int(H * 0.35))).resize((40, 40))
            px = list(c.getdata())
            f = sum(1 for q in px if q[0] > 200 and q[1] < 110 and q[2] < 120) / len(px)
            print("  red", tag, round(f, 3), flush=True)
            return f
        redfull("t0")
        for nm in ("debris:slab", "debris:rock", "fx", "bosses", "view:projectiles", "objectives", "civilians"):
            s.js("(n) => { const o = window.__BT__.debugCore.scene.children.find((c) => c.name === n); if (o) o.visible = false; }", nm)
            time.sleep(0.12)
            redfull("hide " + nm)
            s.js("(n) => { const o = window.__BT__.debugCore.scene.children.find((c) => c.name === n); if (o) o.visible = true; }", nm)
            time.sleep(0.12)
            redfull("show " + nm)
        print(s.js("() => { const o = window.__BT__.debugCore.scene.children.find((c) => c.name === 'debris:slab'); const out = []; o.traverse((m) => { if (m.isMesh) out.push([m.name, m.count, m.isInstancedMesh]); }); return out; }"))


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""titans fix group: measure how a titan separates from its ground (F07 / PC-05).

For each titan x biome x rank: start a run, set the rank, walk, freeze, then in ONE JS task render
(a) a titan-only mask pass (every other scene root hidden, black background, no fog) and
(b) the normal frame, for each rim strength in --strengths (uniform poked live, no recompile).
Reports: titan-pixel mean luma, local background mean luma (bbox ring), boundary contrast, full-frame
and centre-crop (critic metric) mean luma. Saves the normal frame of the shipped strength as PNG.
"""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from common import Session, add_common_args, build_url, ensure_play, set_rank, world_to_keys  # noqa

MEASURE_JS = r"""
async ([strengths, savePng]) => {
  const B = window.__BT__; const core = B.debugCore; const scene = core.scene; const r = core.renderer;
  let root = null; for (const c of scene.children) if (c.name && c.name.startsWith('titan:')) root = c;
  if (!root) return { err: 'no titan root' };
  let skin = null; root.traverse((o) => { if (o.material && o.material.name && o.material.name.startsWith('titanSkin')) skin = o.material; });
  const u = r.properties.get(skin).uniforms || {};
  const shipped = u.uRimStrength ? [u.uRimStrength.value, u.uRimFill ? u.uRimFill.value : 0] : null;
  const hulls = []; root.traverse((o) => { if (o.material && o.material.isShaderMaterial) hulls.push(o); });
  const gl = r.getContext(); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const read = () => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const L = (p, i) => 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
  // mask pass
  const vis = scene.children.map((c) => c.visible); const bg = scene.background; const fog = scene.fog;
  scene.children.forEach((c) => { if (c !== root && !c.isLight) c.visible = false; });
  scene.background = null; scene.fog = null; r.setClearColor(0x000000, 0);
  hulls.forEach((h) => { h.visible = false; });
  core.render(); const mp = read();
  hulls.forEach((h) => { h.visible = true; });
  scene.children.forEach((c, i) => { c.visible = vis[i]; }); scene.background = bg; scene.fog = fog;
  const mask = new Uint8Array(W * H); let x0 = W, x1 = 0, y0 = H, y1 = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (mp[i * 4 + 3] > 8 || L(mp, i * 4) > 6) { mask[i] = 1; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  const out = { W, H, maskPx: n, bbox: [x0, y0, x1, y1], shipped, runs: [] };
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.5);
  const bx0 = Math.max(0, x0 - pad), bx1 = Math.min(W - 1, x1 + pad), by0 = Math.max(0, y0 - pad), by1 = Math.min(H - 1, y1 + pad);
  let png = null;
  for (const s of strengths.concat([shipped])) {
    if (u.uRimStrength && s !== null) { u.uRimStrength.value = s[0]; if (u.uRimFill) u.uRimFill.value = s[1]; }
    core.render(); const p = read();
    let tS = 0, tN = 0, gS = 0, gN = 0, fS = 0, cS = 0, cN = 0, eS = 0, eN = 0; const tl = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; const l = L(p, i * 4); fS += l;
      if (x > W * 3 / 8 && x < W * 5 / 8 && y > H * 3 / 8 && y < H * 5 / 8) { cS += l; cN++; }
      if (mask[i]) { tS += l; tN++; tl.push(l); }
      else if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) { gS += l; gN++; }
      // boundary: titan pixel with a non-titan 4-neighbour 2 px away
      if (mask[i] && x > 2 && x < W - 3 && y > 2 && y < H - 3) {
        for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) { const j = (y + dy) * W + x + dx; if (!mask[j]) { eS += Math.abs(l - L(p, j * 4)); eN++; } }
      }
    }
    tl.sort((a, b) => a - b);
    out.runs.push({ strength: s, titan: +(tS / Math.max(1, tN)).toFixed(1), titanP90: +(tl[Math.floor(tl.length * 0.9)] || 0).toFixed(1),
      bg: +(gS / Math.max(1, gN)).toFixed(1), edge: +(eS / Math.max(1, eN)).toFixed(1), full: +(fS / (W * H)).toFixed(1), centre: +(cS / cN).toFixed(1) });
  }
  if (u.uRimStrength) { u.uRimStrength.value = shipped[0]; if (u.uRimFill) u.uRimFill.value = shipped[1]; }
  if (savePng) { core.render(); png = r.domElement.toDataURL('image/png'); }
  out.png = png;
  return out;
}
"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--titans", default="voltkite,molo,hearthback,briarwick")
    ap.add_argument("--biomes", default="lockwater")
    ap.add_argument("--ranks", default="0,2")
    ap.add_argument("--strengths", default="0")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--out", default="_shots/titans_fix/probe")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    strengths = [[float(v) for v in x.split(":")] for x in a.strengths.split(",") if x]
    res = []
    with Session(a, "rimprobe") as sess:
        for biome in a.biomes.split(","):
            for titan in a.titans.split(","):
                sess.goto(build_url(a.base, autostart=1, dev=1, titan=titan, biome=biome, seed=a.seed, noslate=1))
                sess.wait_bt(90); sess.wait_screen(("play", "draft", "slate"), 90); ensure_play(sess, 20)
                sess.cheat("god", True)
                for rk in [int(x) for x in a.ranks.split(",")]:
                    set_rank(sess, rk, settle_s=0.5); ensure_play(sess, 20)
                    time.sleep(2.5)
                    s = sess.state() or {}
                    h = s.get("heading") or 0.0
                    import math
                    keys = world_to_keys(math.sin(h), math.cos(h)) or {"KeyW"}
                    t_end = time.time() + 1.0
                    while time.time() < t_end:
                        ensure_play(sess, 5); sess.hold(keys); time.sleep(0.1)
                    sess.release_all(); time.sleep(1.2)
                    sess.bt_call("freeze", True); time.sleep(0.3)
                    m = sess.js(MEASURE_JS, [strengths, True])
                    sess.bt_call("freeze", False)
                    png = m.pop("png", None) if isinstance(m, dict) else None
                    name = "%s_%s_r%d" % (titan, biome, rk)
                    if png:
                        import base64
                        open(os.path.join(a.out, name + ".png"), "wb").write(base64.b64decode(png.split(",", 1)[1]))
                    print(name, json.dumps(m))
                    res.append({"name": name, **(m if isinstance(m, dict) else {"err": m})})
    json.dump(res, open(os.path.join(a.out, "probe.json"), "w"), indent=1)


if __name__ == "__main__":
    main()

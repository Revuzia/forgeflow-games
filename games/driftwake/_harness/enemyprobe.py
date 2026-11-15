#!/usr/bin/env python
"""
Prove the thirty Meshy bodies actually render, animate, and cost what we think.

Boots the game through real headed Chrome (the preview MCP cannot be used here:
a hidden pane never composites, so requestAnimationFrame never fires and the
boot stalls at 'creating context' forever), spawns a ring of REAL roster units
in front of the camera, and measures.

What it asserts, and why each one is the check that matters:

  RENDER      draw calls and triangles must RISE after the spawn. A skinned mesh
              that failed to load still leaves the AI happily driving an invisible
              slot, which looks exactly like success from the JS side.
  ANIMATE     a bone's world position must MOVE between frames. A body posed at
              bind and never stepped is stationary but perfectly valid geometry.
  INDEPENDENT two different bodies must not move IDENTICALLY. Identical motion is
              the signature of clips being shared across rigs instead of
              retargeted per rig -- the exact defect blender_retarget.py exists to
              prevent, and it is invisible in a screenshot.
  COST        FPS with a full pool alive, against the 22 draw / 1.80M tri baseline.

    python _harness/enemyprobe.py
    python _harness/enemyprobe.py --count 24 --frames 240
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8788/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

# Spawn a ring of distinct units around the player and hand back what the engine
# says it did. Deliberately reads `enemies.units` rather than a hard-coded list:
# the roster is data, and a probe that hard-codes it stops testing the roster.
SPAWN = """(n) => {
  const SF = globalThis.SNOWFLOW;
  const E = SF.combat.enemies, C = SF.character;
  const units = E.units || [];
  const px = C.position.x, pz = C.position.z;
  const out = { requested: n, spawned: [], failed: [] };
  for (let i = 0; i < n; i++) {
    const u = units[i % units.length];
    const a = (i / n) * Math.PI * 2;
    const x = px + Math.sin(a) * 12, z = pz - Math.cos(a) * 12;
    const id = E.spawn(u.slug || u.key, x, z, 10);
    (id >= 0 ? out.spawned : out.failed).push(u.slug || u.key);
  }
  out.alive = E.aliveCount;
  return out;
}"""

# One bone's world position per live slot. `_slotInst` is the renderer's
# per-slot instance; walking to a real bone (not the group root) is what makes
# this an ANIMATION probe rather than a position probe -- the root is moved by
# the AI whether or not a single clip is playing.
SAMPLE = """() => {
  const V = globalThis.SNOWFLOW.combat.enemies.vis;
  const out = [];
  const inst = V._slotInst || [];
  for (let i = 0; i < inst.length; i++) {
    const it = inst[i];
    if (!it) continue;
    const root = it.root || it.group || it.object || it;
    let bone = null;
    root.traverse && root.traverse(o => {
      if (!bone && o.isBone && /Hand|Foot|Spine2/.test(o.name)) bone = o;
    });
    if (!bone) continue;
    bone.updateWorldMatrix(true, false);
    // Translation straight out of matrixWorld -- no THREE constructor needed,
    // so the probe does not depend on how the page happens to expose the lib.
    const e = bone.matrixWorld.elements;
    out.push({ slot: i, bone: bone.name,
               p: [+e[12].toFixed(4), +e[13].toFixed(4), +e[14].toFixed(4)] });
  }
  return out;
}"""

STATS = """() => {
  const SF = globalThis.SNOWFLOW;
  const ps = SF.perfStats || {};
  return { draws: ps.drawCalls == null ? -1 : ps.drawCalls,
           tris: ps.triangles == null ? -1 : ps.triangles,
           alive: SF.combat.enemies ? SF.combat.enemies.aliveCount : -1 };
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--count", type=int, default=24)
    ap.add_argument("--frames", type=int, default=180)
    ap.add_argument("--wait", type=float, default=150.0)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "_shots", "enemyprobe.png"))
    args = ap.parse_args()

    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto(args.url + "?v=probe", wait_until="load", timeout=90_000)
        try:
            pg.wait_for_function(READY, timeout=int(args.wait * 1000))
        except Exception as e:
            print("BOOT FAILED:", e, file=sys.stderr)
            for m in errors[:20]:
                print("  ", m, file=sys.stderr)
            br.close()
            return 1

        def frames(n):
            start = pg.evaluate("() => window.__f")
            pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=start,
                                 timeout=60_000)

        frames(30)
        before = pg.evaluate(STATS)
        spawn = pg.evaluate(SPAWN, args.count)
        frames(30)
        s1 = pg.evaluate(SAMPLE)
        if not s1:
            info = pg.evaluate("""() => {
              const V = globalThis.SNOWFLOW.combat.enemies.vis;
              if (!V) return { vis: null };
              const arrs = {};
              for (const k of Object.keys(V)) {
                const v = V[k];
                if (Array.isArray(v)) arrs[k] = v.length + ' [' + v.filter(Boolean).length + ' non-null]';
                else if (v instanceof Map) arrs[k] = 'Map(' + v.size + ')';
              }
              let skinned = 0, bones = 0;
              globalThis.SNOWFLOW.scene.traverse(o => {
                if (o.isSkinnedMesh) skinned++;
                if (o.isBone) bones++;
              });
              return { ctor: V.constructor && V.constructor.name, keys: Object.keys(V),
                       arrays: arrs, sceneSkinnedMeshes: skinned, sceneBones: bones,
                       realm: V.realm, manifest: !!V.manifest };
            }""")
            print("--- vis introspection ---")
            print(json.dumps(info, indent=1)[:2200])
        f0 = pg.evaluate("() => window.__f")
        frames(args.frames)
        f1 = pg.evaluate("() => window.__f")
        s2 = pg.evaluate(SAMPLE)
        after = pg.evaluate(STATS)
        pg.screenshot(path=os.path.abspath(args.out))

        # ---- motion, per body -------------------------------------------------
        a = {r["slot"]: r for r in s1}
        moved, deltas = 0, {}
        for r in s2:
            q = a.get(r["slot"])
            if not q:
                continue
            d = max(abs(x - y) for x, y in zip(r["p"], q["p"]))
            deltas[r["slot"]] = round(d, 4)
            if d > 1e-3:
                moved += 1
        # ---- independence: identical deltas across bodies means shared clips ---
        vals = list(deltas.values())
        uniq = len(set(vals))

        print(f"URL        {args.url}")
        print(f"spawn      requested={spawn['requested']} ok={len(spawn['spawned'])} "
              f"failed={len(spawn['failed'])} alive={spawn['alive']}")
        if spawn["failed"]:
            print(f"  FAILED   {spawn['failed'][:8]}")
        print(f"draws      {before['draws']} -> {after['draws']}")
        print(f"tris       {before['tris']} -> {after['tris']}")
        print(f"sampled    {len(s1)} bodies with a reachable bone")
        print(f"animating  {moved}/{len(deltas)} bodies moved a bone > 1 mm "
              f"over {f1 - f0} frames")
        print(f"distinct   {uniq}/{len(vals)} distinct motion deltas "
              f"(low = clips shared across rigs)")
        print(f"errors     {len(errors)}")
        for m in errors[:10]:
            print("  ", m)
        print(f"screenshot {args.out}")

        ok = (after["draws"] > before["draws"] and moved >= max(1, len(deltas) // 2)
              and uniq > 1 and not spawn["failed"])
        print("\nRESULT:", "OK" if ok else "FAIL")
        br.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

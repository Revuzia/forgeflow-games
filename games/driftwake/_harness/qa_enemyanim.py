#!/usr/bin/env python
"""Per-BODY animation audit: name the slugs that are not moving, and prove that the
ones that are moving are not moving together.

`enemyprobe.py` reports the aggregate ("9/14 bodies moved a bone > 1 mm") and then
prints RESULT: OK, which is exactly the shape of report that lets five dead rigs
ship. This resolves the same measurement per slot, with the slug, the AI state,
the clip name and the per-sample delta trail, so a static body can be attributed
to a cause (dead / culled / no clip / clip not stepped) instead of averaged away.

Independence is re-tested on the MOVING bodies only. Cold-zero deltas from static
bodies collapse into one bucket and inflate the "shared clips" signal in the
aggregate probe -- 14 bodies, 5 static, 9 moving distinct reads as "10/14
distinct" and looks like a retarget bug that is not there.

    python _harness/qa_enemyanim.py --count 12 --realm cold
"""
import argparse
import json
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.terrain || !SF.rig || !SF.combat) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

SPAWN = """(n) => {
  const SF = globalThis.SNOWFLOW;
  const E = SF.combat.enemies, C = SF.character;
  const units = E.units || [];
  const out = { requested: n, ok: [], failed: [], units: units.length };
  for (let i = 0; i < n; i++) {
    const u = units[i % units.length];
    const a = (i / n) * Math.PI * 2;
    const id = E.spawn(u.slug || u.key, C.position.x + Math.sin(a) * 12,
                       C.position.z - Math.cos(a) * 12, 10);
    (id >= 0 ? out.ok : out.failed).push(u.slug || u.key);
  }
  out.alive = E.aliveCount;
  return out;
}"""

# One bone per slot PLUS the identity of the thing it belongs to. Attribution is
# the entire point: "slot 7 static" is unactionable, "73_v3_sand_mummy, state
# dead, clip death, hp 0" is a closed question.
SAMPLE = """() => {
  const SF = globalThis.SNOWFLOW;
  const E = SF.combat.enemies, V = E.vis;
  const inst = V._slotInst || [];
  const out = [];
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
    const e = bone.matrixWorld.elements;
    // The clip actually weighted right now, if the instance exposes a mixer.
    let clip = null, wsum = 0;
    const mx = it.mixer || it._mixer;
    if (mx && mx._actions) {
      let best = 0;
      for (const act of mx._actions) {
        const w = act.getEffectiveWeight ? act.getEffectiveWeight() : act.weight;
        wsum += w || 0;
        if ((w || 0) > best) { best = w; clip = act._clip && act._clip.name; }
      }
    }
    const u = (E.slots && E.slots[i]) || (E.units && E.units[i]) || {};
    out.push({ slot: i, slug: it.slug || it.key || u.slug || u.key || null,
               bone: bone.name, state: u.state || u.ai || null,
               hp: u.hp === undefined ? null : u.hp,
               clip: clip, weight: +wsum.toFixed(3),
               p: [+e[12].toFixed(5), +e[13].toFixed(5), +e[14].toFixed(5)] });
  }
  return out;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8788/games/driftwake/index.html")
    ap.add_argument("--count", type=int, default=12)
    ap.add_argument("--realm", default="cold")
    ap.add_argument("--frames", type=int, default=180)
    ap.add_argument("--wait", type=float, default=180.0)
    args = ap.parse_args()

    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto(args.url + "?v=anim" + args.realm, wait_until="load", timeout=90_000)
        pg.wait_for_function(READY, timeout=int(args.wait * 1000))

        def frames(n):
            s = pg.evaluate("() => window.__f")
            pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s, timeout=90_000)

        frames(40)
        if args.realm != "cold":
            pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", args.realm)
            frames(140)
        spawn = pg.evaluate(SPAWN, args.count)
        frames(30)

        # Three samples, not two: a body can be mid-pause in a clip between any
        # one pair of frames, and a single zero delta would convict it.
        snaps = []
        for _ in range(3):
            snaps.append(pg.evaluate(SAMPLE))
            frames(args.frames // 2)
        after = pg.evaluate("""() => {const p=globalThis.SNOWFLOW.perfStats||{};
            return {draws:p.drawCalls, tris:p.triangles,
                    alive:globalThis.SNOWFLOW.combat.enemies.aliveCount};}""")
        pg.screenshot(path=f"_shots/qa_enemyanim_{args.realm}.png")
        br.close()

    idx = [{r["slot"]: r for r in s} for s in snaps]
    slots = sorted(idx[0].keys())
    print(f"realm {args.realm}  spawn requested={spawn['requested']} "
          f"ok={len(spawn['ok'])} failed={len(spawn['failed'])} "
          f"alive={spawn['alive']}  roster units={spawn['units']}")
    print(f"after  draws={after['draws']} tris={after['tris']} alive={after['alive']}")
    print(f"{'slot':>4} {'slug':<32}{'state':<10}{'hp':>6} {'clip':<16}"
          f"{'d1(mm)':>9}{'d2(mm)':>9}  verdict")
    moving = {}
    for s in slots:
        r0, r1, r2 = idx[0].get(s), idx[1].get(s), idx[2].get(s)
        if not (r0 and r1 and r2):
            continue
        d1 = max(abs(x - y) for x, y in zip(r1["p"], r0["p"])) * 1000.0
        d2 = max(abs(x - y) for x, y in zip(r2["p"], r1["p"])) * 1000.0
        best = max(d1, d2)
        if best > 1.0:
            moving[s] = (round(d1, 4), round(d2, 4))
        print(f"{s:>4} {str(r0['slug'])[:31]:<32}{str(r0['state'])[:9]:<10}"
              f"{str(r0['hp']):>6} {str(r0['clip'])[:15]:<16}"
              f"{d1:9.3f}{d2:9.3f}  {'MOVING' if best > 1.0 else 'STATIC'}")
    uniq = len(set(moving.values()))
    print(f"\nmoving   {len(moving)}/{len(slots)} bodies")
    print(f"distinct {uniq}/{len(moving)} distinct delta pairs AMONG MOVING BODIES"
          f"  ({'independent' if uniq == len(moving) else 'SHARED CLIPS SUSPECTED'})")
    print(f"errors   {len(errors)}")
    for e in errors[:6]:
        print("  ", e)
    return 0


if __name__ == "__main__":
    sys.exit(main())

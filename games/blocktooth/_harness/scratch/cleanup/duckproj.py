"""cleanup lane: (a) big-sting music duck engages (duck GainNode value after bossSpawn / rankUp), and never
in ordinary busy combat; (b) projectile view still draws every live projectile kind after the A4 union trim."""
import os, sys, time, json, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.dirname(HERE))
from common import Session, add_common_args, build_url
from flows import AUDIO_JS
ap = argparse.ArgumentParser(); add_common_args(ap)
args = ap.parse_args(); args.no_serve = True
S = Session(args, "duckproj"); S.start(); S.page.add_init_script(AUDIO_JS)
DUCK = "() => { const A = window.__AU__; return A.gains[4] ? +A.gains[4].gain.value.toFixed(3) : null; }"
PROJ = """() => { const B = window.__BT__, sc = B.debugCore.scene, root = sc.getObjectByName('view:projectiles');
  const out = {}; root.traverse(o => { if (o.isInstancedMesh && o.visible && o.count > 0 && o.name.startsWith('proj:')) out[o.name] = o.count; });
  const live = {}; for (const p of B.world.projectiles) if (p.alive) live[p.kind] = (live[p.kind] || 0) + 1; return { drawn: out, live }; }"""
try:
    S.goto(build_url(args.base, autostart=1, seed=99, titan="voltkite", biome="grideast", dev=1)); S.wait_bt(60); S.wait_screen("slate", 60); time.sleep(1.2)
    S.press("Enter"); S.wait_screen("play", 10); time.sleep(0.5)
    S.cheat("god", True)
    for k, n in (("android", 10), ("squad", 5), ("drone", 4), ("tank", 3), ("walker", 3), ("buggy", 3), ("apc", 2)): S.cheat("spawn", k, n)
    busy = []; seen = {}; drawn = {}
    for i in range(30):
        st = S.state() or {}
        if st.get("screen") == "draft": S.release_all(); S.press("Digit1"); time.sleep(0.5); continue
        S.hold([{"KeyW"}, {"KeyD"}, {"KeyS"}, {"KeyA"}][i % 4] | ({"Space"} if i % 4 == 0 else set())); time.sleep(0.2)
        busy.append(S.js(DUCK)); r = S.js(PROJ)
        for k, v in r["live"].items(): seen[k] = max(seen.get(k, 0), v)
        for k, v in r["drawn"].items(): drawn[k] = max(drawn.get(k, 0), v)
    S.release_all()
    print("busy duck min/max", min(b for b in busy if b is not None), max(b for b in busy if b is not None))
    print("projectile kinds live (max count)", json.dumps(seen)); print("projectile meshes drawn (max count)", json.dumps(drawn))
    def watch(label, secs=3.4):
        vals = []; t0 = time.time()
        while time.time() - t0 < secs:
            st = S.state() or {}
            if st.get("screen") == "draft": S.press("Digit1")
            vals.append((round(time.time() - t0, 2), S.js(DUCK))); time.sleep(0.1)
        print(label, "duck min", min(v for _, v in vals), "trace", vals[::4])
    S.cheat("rank", 1); watch("rankUp")
    time.sleep(2.5)
    S.cheat("boss"); watch("bossSpawn", 4.2)
    print("errors", json.dumps(S.diagnostics().get("page_errors") or [])[:600])
finally:
    S.close()

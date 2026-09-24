"""cleanup lane / F12 remainder: hazard paint fades out during the run-end aftermath.
Real keys make hazards (titan attacks + Space hook); then the titan is killed (test-only world poke)
so the sim emits runEnd; the hazard view root is sampled every ~100 ms (visible draw objects +
instance counts) while the sim's hazards are still alive, plus screenshots at +0 / +0.3 / +1.0 s."""
import os, sys, time, json, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url
ap = argparse.ArgumentParser(); add_common_args(ap)
ap.add_argument("--titan", default="hearthback"); ap.add_argument("--biome", default="whitestacks")
args = ap.parse_args(); args.no_serve = True
S = Session(args, "hazfade"); S.start()
SHOTS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "..", "_shots")
PROBE = """() => { const B = window.__BT__, W = B.world, sc = B.debugCore.scene;
  const root = sc.getObjectByName('view:hazards'); let vis = 0, inst = 0;
  root.traverse(o => { if (!o.isMesh || !o.visible) return; let p = o, ok = true; while (p) { if (!p.visible) { ok = false; break; } p = p.parent; }
    if (!ok) return; vis++; inst += (o.isInstancedMesh ? o.count : (o.geometry && o.geometry.instanceCount !== undefined && o.geometry.instanceCount !== Infinity ? o.geometry.instanceCount : 1)); });
  const alive = W.hazards.filter(h => h.alive); const kinds = {}; for (const h of alive) kinds[h.kind] = (kids => kids + 1)(kinds[h.kind] || 0);
  const tg = sc.getObjectByName('view:telegraphs'); let tvis = 0; tg && tg.traverse(o => { if (o.isMesh && o.visible) tvis++; });
  return { t: performance.now(), screen: B.state().screen, alive: alive.length, kinds, visMeshes: vis, instances: inst, tgVisMeshes: tvis }; }"""
try:
    S.goto(build_url(args.base, autostart=1, seed=777, titan=args.titan, biome=args.biome, dev=1)); S.wait_bt(60); S.wait_screen("slate", 60); time.sleep(1.2)
    S.press("Enter"); S.wait_screen("play", 10); time.sleep(0.5)
    S.cheat("god", True); S.cheat("rank", 1); time.sleep(1.5)
    for k, n in (("android", 10), ("tank", 3), ("walker", 2)): S.cheat("spawn", k, n)
    CIRCLE = [{"KeyW"}, {"KeyD"}, {"KeyS"}, {"KeyA"}]
    pre = None
    for i in range(80):
        st = S.state() or {}
        if st.get("screen") == "draft":
            S.release_all(); S.press("Digit1"); time.sleep(0.6); continue
        if st.get("screen") != "play": time.sleep(0.3); continue
        S.hold(CIRCLE[i % 4] | ({"Space"} if i % 3 == 0 else set())); time.sleep(0.25)
        pre = S.js(PROBE)
        if i > 16 and pre["alive"] >= 2 and pre["screen"] == "play": break
    S.release_all(); time.sleep(0.1)
    pre = S.js(PROBE); print("pre", json.dumps(pre))
    S.cheat("god", False)
    S.js("() => { const T = window.__BT__.world.titan; T.hp = 0; T.alive = false; }")
    t0 = time.time(); samples = []; shots = {}
    while time.time() - t0 < 1.6:
        r = S.js(PROBE); r["dt"] = round(time.time() - t0, 2); samples.append(r)
        for tag, at in (("a0", 0.0), ("a03", 0.3), ("a10", 1.0)):
            if tag not in shots and r["dt"] >= at:
                p = os.path.abspath(os.path.join(SHOTS, "cleanup_hazfade_%s_%s.png" % (args.titan, tag))); S.page.screenshot(path=p); shots[tag] = p
        time.sleep(0.08)
    for r in samples: print(r["dt"], r["screen"], "alive", r["alive"], r["kinds"], "hzVisMeshes", r["visMeshes"], "inst", r["instances"], "tgVis", r["tgVisMeshes"])
    print("shots", json.dumps(shots)); print("errors", json.dumps(S.diagnostics().get("page_errors") or [])[:400])
finally:
    S.close()

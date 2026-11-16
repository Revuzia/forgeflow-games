import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import common as C, argparse, probe_match as PM
ap = argparse.ArgumentParser(); C.add_common_args(ap); args = ap.parse_args(); args.disk = True
js = PM.SWIMCHECK_JS
old = "if (tripped == null && bb && bb.escUntil > W.t)"
assert js.count(old) == 1
js = js.replace(old, "if (bb && (pinTicks % 15 === 1)) (window.__SW = window.__SW || []).push([si, b.id, +(W.t - t0).toFixed(2), b.brain.state, mt ? [+mt.x.toFixed(1), +mt.z.toFixed(1)] : null, +(bb.trapT - W.t).toFixed(2), [+bb.trapX.toFixed(1), +bb.trapZ.toFixed(1)], +(bb.escUntil - W.t).toFixed(2), !!bb.chestId, !!b.healing, !!b.emoting, !!b.swimming, +(bb.paceT||0).toFixed(1)]); " + old)
with C.Session(args, "probe_match", viewport={"width": 960, "height": 600}) as s:
    s.boot(); s.freeze_loop()
    s.start_match("quick", PM.SWIM_SEED, PM.SWIM_MAP, enter=True); s.freeze_loop()
    s.page.evaluate("() => window.__LC__.fastForward(20, 1 / 30)")
    r = s.page.evaluate(js, [PM.SWIM_SPOTS, PM.SWIM_PIN_S, PM.SWIM_FREE_S])
    sw = s.page.evaluate("() => window.__SW")
    print(json.dumps(r)[:600])
    for x in sw:
        if x[0] == 2: print(x)

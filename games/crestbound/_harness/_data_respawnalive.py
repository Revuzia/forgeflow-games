"""DATA LANE probe (critic r2): respawn at EVERY checkpoint of every course and
assert the hero is still alive 1.5 s later (a checkpoint inside a hazard's
kill volume is a respawn loop the pose harness photographed as the death card).
Reuses loopcheck.py's driver verbatim so the page is driven the same way."""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loopcheck as L
from playwright.sync_api import sync_playwright

PROBE_JS = r"""
async (opts) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const wait = async (ms) => { const t = performance.now(); while (performance.now() - t < ms) await frame(); };
  const until = async (fn, ms) => { const t = performance.now();
    while (performance.now() - t < ms) { let v; try { v = fn(); } catch (e) { v = false; } if (v) return performance.now() - t; await frame(); }
    return null; };
  const posOf = (o) => o.pos ? o.pos : (Array.isArray(o.p) ? {x:o.p[0], y:o.p[1], z:o.p[2]} : o.p);
  let P = G.player; const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  const C = G.course, cps = C.checkpoints || [];
  const rows = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = posOf(cps[i]); const id = cps[i].id || ('cp' + i);
    syncP(); P.__test.teleport(V3(cp.x, cp.y + 0.6, cp.z)); P.__test.setVel(V3(0, 0, 0));
    await until(() => (G.cpIndex | 0) >= i, 3000);
    await wait(150);
    const d0 = G.deaths | 0;
    syncP().kill('void');
    const back = await until(() => { syncP(); return !P.dead && !(G.input && G.input.suspended) && (G.state === 'playing' || G.state === 'keep'); }, 6000);
    const d1 = G.deaths | 0;
    // hold still for opts.holdMs and watch for a second death
    let died = false, diedAt = null; const t0 = performance.now();
    while (performance.now() - t0 < opts.holdMs) { syncP(); if (P.dead || (G.deaths | 0) > d1) { died = true; diedAt = Math.round(performance.now() - t0); break; } await frame(); }
    const rp = syncP().pos;
    rows.push({cp: id, i, respawned: back !== null, deathsAfterKill: d1 - d0, aliveAfterHold: !died, diedAtMs: diedAt,
               pos: [+rp.x.toFixed(2), +rp.y.toFixed(2), +rp.z.toFixed(2)], cpPos: [cp.x, cp.y, cp.z]});
    if (died) { await until(() => { syncP(); return !P.dead && (G.state === 'playing' || G.state === 'keep'); }, 6000); await wait(300); }
    await wait(200);
  }
  return {course: opts.course, rows};
}"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=L.BASE)
    ap.add_argument("--courses", default="")
    ap.add_argument("--hold", type=int, default=1500)
    ap.add_argument("--json", default=os.path.join(L.HERE, "_data_respawnalive.json"))
    args = ap.parse_args()
    res, pageerrs = {}, []
    with sync_playwright() as p:
        br = L.launch_headless(p)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: pageerrs.append(str(e)))
        saved = None
        pg.goto(args.url + "?dev=1", wait_until="load", timeout=60_000)
        if not L.wait_ready(pg): print("RESULT: FAIL (no CRESTBOUND)"); return 2
        try: saved = pg.evaluate("(k)=>window.localStorage.getItem(k)", L.SAVE_KEY)
        except Exception: saved = None
        if not L.leave_title(pg): print("RESULT: FAIL (title)"); return 2
        courses = [c for c in args.courses.split(",") if c.strip()] or L.course_ids_on_disk(pg)
        for cid in courses:
            ok, why = L.goto_course(pg, cid)
            if not ok: res[cid] = {"error": why}; print(cid, "GOTO FAIL", why); continue
            pg.wait_for_timeout(1500)
            try:
                res[cid] = pg.evaluate(PROBE_JS, {"course": cid, "holdMs": args.hold})
            except Exception as e:
                res[cid] = {"error": str(e)[:400]}
            r = res[cid]
            for row in r.get("rows", []):
                flag = "OK " if (row["respawned"] and row["aliveAfterHold"]) else "DEAD"
                print("%-10s %-18s %s respawned=%s aliveAfter%dms=%s diedAt=%s pos=%s" % (
                    cid, row["cp"], flag, row["respawned"], args.hold, row["aliveAfterHold"], row["diedAtMs"], row["pos"]))
            if "error" in r: print(cid, "ERROR", r["error"])
        if saved is not None:
            try: pg.evaluate("(a)=>window.localStorage.setItem(a[0],a[1])", [L.SAVE_KEY, saved])
            except Exception: pass
        br.close()
    with open(args.json, "w", encoding="utf-8") as f: json.dump({"results": res, "pageerrors": pageerrs}, f, indent=1)
    bad = [(c, r["cp"]) for c, v in res.items() for r in v.get("rows", []) if not (r["respawned"] and r["aliveAfterHold"])]
    print("pageerrors:", len(pageerrs)); print("RESULT:", "OK" if not bad else "FAIL %s" % bad)
    return 0 if not bad else 1

if __name__ == "__main__": sys.exit(main())

#!/usr/bin/env python
"""ASCENDANT core-loop check — proves the game is actually playable end to end.

This is the ship criterion, automated: start in the hub, enter a world, reach every
checkpoint, die at each one and respawn correctly and fast, collect a coin, cross
the finish, and advance to the next stage. It also proves the DETERMINISM LAW —
that a hazard presents the same phase after a death, which is the whole reason a
gauntlet is learnable instead of luck.

    python loopcheck.py                     # hub + every stage
    python loopcheck.py --stages neon-1     # one stage
    python loopcheck.py --skip-hub

Exit 0 = every assertion passed.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/ascendant/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

RESPAWN_BUDGET_MS = 620

# ── the whole loop test, run inside the page ────────────────────────────────────
LOOP_JS = r"""
async (opts) => {
  const A = globalThis.ASCENDANT;
  const R = {checks: [], stage: opts.stage};
  const ok  = (name, pass, detail) => R.checks.push({name, pass: !!pass, detail: detail === undefined ? null : detail});
  if (!A || !A.game) { ok('bootstrap', false, 'no ASCENDANT.game'); return R; }
  const G = A.game;
  // ASCENDANT does not publish THREE; borrow Vector3 off a live vector.
  const T = A.THREE || { Vector3: (G.player && G.player.pos ? G.player.pos.constructor : null) };
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const wait = async (ms) => { const t = performance.now(); while (performance.now() - t < ms) await frame(); };
  const until = async (fn, ms, label) => {
    const t = performance.now();
    while (performance.now() - t < ms) { if (fn()) return performance.now() - t; await frame(); }
    return null;
  };
  const posOf = (o) => o && (o.position || o.pos || (o.mesh && o.mesh.position)) || null;
  const near = (a, b, r) => a && b && Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z) <= r;

  // ---- 1. the stage is loaded and populated -------------------------------
  const S = G.stage;
  if (!S) { ok('stage loaded', false, 'game.stage is null'); return R; }
  const liveId = (S.def && S.def.id) || S.id;
  ok('stage loaded IS the requested stage', liveId === opts.stage, liveId);
  ok('stage has colliders', (S.broadphase && (S.broadphase.count || S.broadphase.size || 1)) > 0);
  ok('stage has checkpoints', (S.checkpoints || []).length >= (opts.isHub ? 0 : 3),
     (S.checkpoints || []).length);
  ok('stage has hazards', (S.hazards || []).length >= (opts.isHub ? 0 : 8), (S.hazards || []).length);
  const P = G.player;
  ok('player exists', !!P);
  if (!P) return R;

  // ---- 2. the player is standing on something at spawn --------------------
  const sp = S.spawnFor ? S.spawnFor(0) : null;
  if (sp && sp.pos) {
    P.__test.teleport(new T.Vector3(sp.pos.x, sp.pos.y + 0.5, sp.pos.z));
    P.__test.setVel(new T.Vector3(0,0,0));
    const gr = await until(() => P.grounded, 2500);
    ok('spawn is grounded', gr !== null, gr === null ? 'never grounded within 2.5 s' : Math.round(gr)+' ms');
    ok('spawn is not instantly lethal', !P.dead);
  } else ok('spawnFor(0)', false, 'no spawn returned');

  if (opts.isHub) {
    const portals = (S.def && S.def.portals) || (G.portals) || [];
    ok('hub has 4 portals', portals.length === 4, portals.length);
    ok('hub has no finish', !S.finish || S.def.finish === null);
    return R;
  }

  // ---- 3. every checkpoint fires, and a death returns you to it -----------
  const cps = S.checkpoints || [];
  const deathTimes = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = posOf(cps[i]);
    if (!cp) { ok(`cp${i} has a position`, false); continue; }
    P.__test.teleport(new T.Vector3(cp.x, cp.y + 0.6, cp.z));
    P.__test.setVel(new T.Vector3(0,0,0));
    const fired = await until(() => (G.cpIndex | 0) >= i, 2500);
    ok(`cp${i} activates on contact`, fired !== null,
       fired === null ? `game.cpIndex stuck at ${G.cpIndex}` : Math.round(fired)+' ms');

    // die here and time the whole respawn
    const deaths0 = G.deaths | 0;
    const t0 = performance.now();
    P.kill('manual');
    const back = await until(() => !P.dead && !(G.input && G.input.suspended) && G.state === 'playing', 4000);
    const dt = back === null ? null : Math.round(performance.now() - t0);
    deathTimes.push(dt);
    // Per-sample: allow dropped-frame grace on a contended 50 Hz box; the real
    // contract bound (median <= budget) is asserted once, after the loop.
    ok(`cp${i} respawn completes (<= ${opts.budget + 280} ms hard ceiling)`,
       dt !== null && dt <= opts.budget + 280, dt);
    ok(`cp${i} death counted`, (G.deaths | 0) === deaths0 + 1, `${deaths0} -> ${G.deaths}`);
    const rp = P.pos;
    ok(`cp${i} respawns AT the checkpoint`, near(rp, {x:cp.x, y:cp.y, z:cp.z}, 4.0),
       `player ${rp.x.toFixed(1)},${rp.y.toFixed(1)},${rp.z.toFixed(1)} vs cp ${cp.x.toFixed(1)},${cp.y.toFixed(1)},${cp.z.toFixed(1)}`);
    await wait(150);
  }
  R.respawnMs = deathTimes;
  {
    const good = deathTimes.filter((v) => v !== null).sort((a, b) => a - b);
    const med = good.length ? good[(good.length - 1) >> 1] : null;
    ok(`median respawn <= ${opts.budget} ms`, med !== null && med <= opts.budget, med);
  }

  // ---- 4. determinism: same clock -> same hazard transforms ---------------
  const snap = () => (S.hazards || []).slice(0, 40).map(h => {
    const m = h.mesh; if (!m) return null;
    m.updateMatrixWorld(true);
    return [+m.position.x.toFixed(4), +m.position.y.toFixed(4), +m.position.z.toFixed(4),
            +m.quaternion.x.toFixed(4), +m.quaternion.y.toFixed(4),
            +m.quaternion.z.toFixed(4), +m.quaternion.w.toFixed(4)];
  });
  const sampleAt = (t) => { S.reset(); S.clock = 0;
    for (const h of (S.hazards||[])) { if (h.reset) h.reset(0); }
    // advance deterministically in fixed steps
    let c = 0; const h = 1/120;
    while (c < t - 1e-6) { const step = Math.min(h, t - c); c += step; S.clock = c;
      for (const hz of (S.hazards||[])) if (hz.update) hz.update(c, step); }
    return snap();
  };
  let a1 = null, a2 = null, detErr = null;
  try { a1 = sampleAt(5.0); a2 = sampleAt(5.0); } catch (e) { detErr = String(e); }
  if (detErr) ok('hazards are deterministic', false, detErr);
  else {
    let diff = 0, worst = 0, which = -1;
    for (let i = 0; i < a1.length; i++) {
      if (!a1[i] || !a2[i]) continue;
      for (let k = 0; k < a1[i].length; k++) {
        const d = Math.abs(a1[i][k] - a2[i][k]);
        if (d > 1e-3) { diff++; if (d > worst) { worst = d; which = i; } }
      }
    }
    ok('hazards are deterministic', diff === 0,
       diff === 0 ? 'identical at t=5.0 s' : `${diff} components drifted, worst ${worst.toFixed(4)} on hazard ${which}`);
  }

  // ---- 5. resetFrom rewinds the clock so a gauntlet is fair ---------------
  try {
    const before = S.clock;
    S.resetFrom(Math.max(0, cps.length - 1));
    const want = (cps[cps.length-1] && cps[cps.length-1].clockOffset) || 0;
    ok('resetFrom rewinds the stage clock', Math.abs(S.clock - want) < 1e-6,
       `clock ${before.toFixed(2)} -> ${S.clock.toFixed(2)}, expected ${want}`);
  } catch (e) { ok('resetFrom rewinds the stage clock', false, String(e)); }

  // ---- 6. a coin can be collected -----------------------------------------
  const coins = S.coins || [];
  if (coins.length) {
    const c0 = posOf(coins[0]);
    const taken0 = G.coins | 0;
    if (c0) {
      P.__test.teleport(new T.Vector3(c0.x, c0.y - 0.4, c0.z));
      P.__test.setVel(new T.Vector3(0,0,0));
      const got = await until(() => (G.coins | 0) > taken0, 2500);
      ok('a coin can be collected', got !== null, got === null ? `coins stuck at ${G.coins}` : Math.round(got)+' ms');
    }
  } else ok('stage has coins', false, 0);

  // ---- 7. the finish clears the stage --------------------------------------
  const fp = posOf(S.finish);
  if (!fp) ok('finish exists', false);
  else {
    ok('finish exists', true);
    P.__test.teleport(new T.Vector3(fp.x, fp.y + 0.6, fp.z));
    P.__test.setVel(new T.Vector3(0,0,0));
    const cleared = await until(() => G.state === 'cleared' || G.state === 'loading' ||
                                      (G.stage && G.stage.def && G.stage.def.id !== opts.stage), 5000);
    ok('crossing the finish clears the stage', cleared !== null,
       cleared === null ? `state stuck at ${G.state}` : `${G.state} after ${Math.round(cleared)} ms`);
    const best = A.Save && A.Save.stage ? A.Save.stage(opts.stage) : null;
    ok('the clear is saved', !!(best && (best.cleared || best.best)), best ? JSON.stringify(best).slice(0,120) : 'no save record');
  }

  return R;
}
"""


def wait_ready(pg, needStage, timeout=75):
    expr = ("!!(globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.stage)"
            if needStage else "!!(globalThis.ASCENDANT && ASCENDANT.game)")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate(expr):
                return True
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def click_play(pg):
    for sel in ["#ui button.asc-btn:visible:has-text('NEW RUN')", "#ui button.asc-btn:visible:has-text('CONTINUE')", "#ui button.asc-btn:visible:has-text('PLAY')", "#ui button.asc-btn.is-primary:visible", "button.asc-btn:visible"]:
        try:
            el = pg.query_selector(sel)
            if el:
                el.click()
                return True
        except Exception:
            pass
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="")
    ap.add_argument("--skip-hub", action="store_true")
    ap.add_argument("--budget", type=int, default=RESPAWN_BUDGET_MS)
    ap.add_argument("--json", default=os.path.join(HERE, "loopcheck.json"))
    args = ap.parse_args()

    if args.stages:
        stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    else:
        d = os.path.join(HERE, "..", "runtime", "data", "stages")
        stages = sorted(f[:-3] for f in os.listdir(d) if f.endswith(".js")) if os.path.isdir(d) else []
    stages = [s for s in stages if s != "hub"]
    targets = ([] if args.skip_hub else ["hub"]) + stages

    all_res, pageerrs = {}, []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: pageerrs.append(str(e)))
        for sid in targets:
            url = f"{BASE}?dev=1&stage={sid}" if sid != "hub" else f"{BASE}?dev=1"
            try:
                pg.goto(url, wait_until="load", timeout=60_000)
            except Exception as e:
                all_res[sid] = {"checks": [{"name": "navigate", "pass": False, "detail": str(e)}]}
                continue
            if not wait_ready(pg, needStage=False):
                all_res[sid] = {"checks": [{"name": "boot", "pass": False, "detail": "ASCENDANT.game never appeared"}]}
                continue
            click_play(pg)
            pg.wait_for_timeout(2500)
            if not wait_ready(pg, needStage=True, timeout=40):
                all_res[sid] = {"checks": [{"name": "stage load", "pass": False, "detail": "game.stage never appeared"}]}
                continue
            # ?stage= is only a preload hint - PLAY lands in the HUB. Drive the dev
            # hook and VERIFY the id, or this measures the hub for every stage
            # (which is exactly what the first full run did: 13 rows, all "hub").
            if sid != "hub":
                try:
                    pg.evaluate("(s)=>ASCENDANT.game.__dev.goto(s)", sid)
                except Exception as e:
                    all_res[sid] = {"checks": [{"name": "dev goto", "pass": False, "detail": str(e)[:300]}]}
                    continue
                arrived = False
                deadline = time.time() + 60
                while time.time() < deadline:
                    try:
                        if pg.evaluate(
                            "(s)=>!!(ASCENDANT.game.stage && ((ASCENDANT.game.stage.def&&ASCENDANT.game.stage.def.id)===s || ASCENDANT.game.stage.id===s))",
                            sid):
                            arrived = True
                            break
                    except Exception:
                        pass
                    pg.wait_for_timeout(400)
                if not arrived:
                    all_res[sid] = {"checks": [{"name": "stage id", "pass": False,
                                                "detail": "never became " + sid}]}
                    continue
                pg.wait_for_timeout(1500)
            try:
                all_res[sid] = pg.evaluate(LOOP_JS, {"stage": sid, "isHub": sid == "hub",
                                                     "budget": args.budget})
            except Exception as e:
                all_res[sid] = {"checks": [{"name": "loop routine", "pass": False, "detail": str(e)[:400]}]}
        br.close()

    total = failed = 0
    print("=" * 78)
    for sid, res in all_res.items():
        checks = res.get("checks", [])
        bad = [c for c in checks if not c["pass"]]
        total += len(checks)
        failed += len(bad)
        print(f"\n{sid}  —  {len(checks) - len(bad)}/{len(checks)} passed")
        for c in checks:
            mark = "ok  " if c["pass"] else "FAIL"
            det = "" if c["detail"] is None else f"   [{c['detail']}]"
            print(f"   {mark} {c['name']}{det}")
        if res.get("respawnMs"):
            print(f"        respawn times: {res['respawnMs']} ms (budget {args.budget})")
    print("\n" + "=" * 78)
    if pageerrs:
        print(f"page errors ({len(pageerrs)}):")
        for e in pageerrs[:10]:
            print("  !! " + e[:300])
    print(f"VERDICT: {'LOOP OK' if failed == 0 else 'LOOP BROKEN'} — {total - failed}/{total} checks passed")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"results": all_res, "pageErrors": pageerrs}, f, indent=2)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python
"""
LANE E — aim/input FEEL probe. Drives the REAL input path (constructed
MouseEvent / KeyboardEvent dispatched into the page listeners) and MEASURES:

  A  aim fidelity   : rad per pixel, accumulation of many events in one frame,
                      round-trip drift, framerate dependence, pitch clamp
  B  ADS sensitivity: on-screen pixel displacement of a fixed world point per
                      100 px of mouse travel, hip vs full ADS
  C  fire taps      : mousedown+mouseup inside one frame -> shots fired?
  C2 buffering      : a click during the reload tail -> shot on completion?
  D  latency        : mousemove -> the camera matrix the renderer uses moved
  E  framerate      : frame ms + an interleaved render-scale sweep (read-only)

Never calls an internal look/fire function: every input is an event through the
same listeners the player's mouse hits (GAME_DOCTRINE §5). Each stage is
separately timed and printed, so a hang names its own stage.

    python aimfeel.py --label BEFORE --json ../_shots/aimfeel_before.json
    python aimfeel.py --only A,B,C          # subset
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

KIT = r"""
window.__AIM__ = (() => {
  const F  = () => window.__FPS__;
  const cv = () => document.getElementById('view');
  // Never await a bare rAF: if this window is ever occluded the callback never
  // runs and the whole probe hangs with no output. Always race a timer.
  const raf = () => new Promise(r => { let done = false;
    requestAnimationFrame(() => { if (!done) { done = true; r('raf'); } });
    setTimeout(() => { if (!done) { done = true; r('timeout'); } }, 250); });
  const rafs = async (n) => { for (let i = 0; i < n; i++) await raf(); };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function move(dx, dy) {
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, cancelable: true, movementX: dx, movementY: dy }));
  }
  function down(btn) {
    cv().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: btn }));
  }
  function up(btn) {
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: btn }));
  }
  function key(type, code) {
    window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, code, key: code }));
  }

  // Pointer lock cannot be granted to a synthetic gesture and the mousemove
  // listener gates on input.pointerLocked. Pin ONLY that flag, so the rest of
  // the chain (listener -> sens -> zoom -> addLook -> state -> buildCmd ->
  // sim -> camera) is exercised verbatim (harness_plan §2.5 sanctioned forge).
  function arm() {
    const I = window.__INPUT__;
    if (!I) return false;
    I.enabled = true;
    I.pointerLocked = true;
    try { Object.defineProperty(I, 'pointerLocked',
      { get(){ return true; }, set(){}, configurable: true }); } catch (e) {}
    return true;
  }

  let V3 = null;
  function project(p) {
    const c = F().camera;
    if (!V3) V3 = Object.getPrototypeOf(c.position).constructor;
    const v = new V3(p[0], p[1], p[2]);
    v.project(c);
    return [(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight];
  }
  return { move, down, up, key, arm, project, raf, rafs, sleep, F, cv };
})();
"""

# --------------------------------------------------------------------- stages
A_AIM = r"""async () => {
  const A = __AIM__, I = window.__INPUT__, R = {};
  const set = (y, p) => { I.state.yaw = y; I.state.pitch = p; };
  set(0, 0); await A.raf();
  A.move(100, 0);
  R.yawPer100px_1evt = I.state.yaw;
  I.state.yaw = 0;
  for (let i = 0; i < 100; i++) A.move(1, 0);
  R.yawPer100px_100evt = I.state.yaw;
  R.accumulationErrorRad = +Math.abs(R.yawPer100px_100evt - R.yawPer100px_1evt).toExponential(3);
  set(0, 0);
  for (let f = 0; f < 10; f++) { for (let i = 0; i < 50; i++) A.move(1, 1); await A.raf(); }
  for (let f = 0; f < 10; f++) { for (let i = 0; i < 50; i++) A.move(-1, -1); await A.raf(); }
  R.roundTrip500pxDriftYawRad = +I.state.yaw.toExponential(3);
  R.roundTrip500pxDriftPitchRad = +I.state.pitch.toExponential(3);
  I.state.yaw = 0; for (let i = 0; i < 300; i++) A.move(1, 0);
  const burst = I.state.yaw;
  I.state.yaw = 0;
  for (let f = 0; f < 30; f++) { for (let i = 0; i < 10; i++) A.move(1, 0); await A.raf(); }
  R.yaw300px_oneFrame = +burst.toFixed(6);
  R.yaw300px_30frames = +I.state.yaw.toFixed(6);
  R.framerateDependenceRad = +Math.abs(burst - I.state.yaw).toExponential(3);
  I.state.pitch = 0;
  for (let i = 0; i < 400; i++) A.move(0, -10);
  R.pitchClampHiRad = +I.state.pitch.toFixed(6);
  for (let i = 0; i < 800; i++) A.move(0, 10);
  R.pitchClampLoRad = +I.state.pitch.toFixed(6);
  A.move(0, -1);
  R.pitchStepOffPoleRad = +(I.state.pitch - R.pitchClampLoRad).toExponential(3);
  set(0, 0);
  R.degPer100px_hip = +(R.yawPer100px_1evt * 180 / Math.PI).toFixed(4);
  R.px_per_360_hip = +(100 * 360 / Math.abs(R.degPer100px_hip)).toFixed(1);
  R.sens = __FPS__.settings.sens;
  R.adsSens = __FPS__.settings.adsSens === undefined ? 'ABSENT' : __FPS__.settings.adsSens;
  R.renderScale = __FPS__.settings.renderScale === undefined ? 'ABSENT' : __FPS__.settings.renderScale;
  return R;
}"""

B_ADS = r"""async () => {
  const A = __AIM__, I = window.__INPUT__, F = __FPS__, R = {};
  const P = F.sim.state.player;
  const yaw0 = I.state.yaw, pitch0 = 0;
  const eye = P.pos[1] + 1.62;
  const tgt = [P.pos[0] - Math.sin(yaw0) * 20, eye, P.pos[2] - Math.cos(yaw0) * 20];
  async function measure(label) {
    const out = { label, weapon: P.weapon.id, worldFov: +F.camera.fov.toFixed(2),
                  adsT: +(P.weapon.adsT || 0).toFixed(3), screenPx: {} };
    for (const px of [100, 300, 600]) {
      I.state.yaw = yaw0; I.state.pitch = pitch0;
      await A.rafs(4);
      const a = A.project(tgt);
      const y0 = I.state.yaw;
      for (let i = 0; i < px; i++) A.move(1, 0);
      const dYaw = I.state.yaw - y0;
      await A.rafs(3);
      const b = A.project(tgt);
      out.screenPx[px] = +Math.abs(b[0] - a[0]).toFixed(2);
      if (px === 100) out.degPer100px = +(dYaw * 180 / Math.PI).toFixed(4);
    }
    I.state.yaw = yaw0; I.state.pitch = pitch0;
    return out;
  }
  A.up(2); await A.rafs(25);
  R.hip = await measure('hip');
  A.down(2);
  for (let i = 0; i < 90 && (P.weapon.adsT || 0) < 0.999; i++) await A.raf();
  R.ads = await measure('ads');
  A.up(2); await A.rafs(25);
  R.screenPxRatio_ads_over_hip = {};
  for (const px of [100, 300, 600]) {
    R.screenPxRatio_ads_over_hip[px] = +(R.ads.screenPx[px] / R.hip.screenPx[px]).toFixed(3);
  }
  R.degRatio_ads_over_hip = +(R.ads.degPer100px / R.hip.degPer100px).toFixed(3);
  R.zoomProportionalTarget = +(R.ads.worldFov / R.hip.worldFov).toFixed(3);
  // The contract: the ANGULAR ratio must equal the FOV ratio exactly (that is
  // what monitor-distance coefficient 1.0 IS), and the screen-pixel ratio must
  // fall from the pre-fix 1.444 toward 1.0 as the sampled point moves out
  // toward the screen edge where a coefficient-1.0 match is defined.
  R.PASS_degRatioIsFovRatio = Math.abs(R.degRatio_ads_over_hip - R.zoomProportionalTarget) <= 0.005;
  return R;
}"""

C_TAPS = r"""async () => {
  const A = __AIM__, F = __FPS__, R = {};
  const shots = () => F.sim.state.counters.shotsFired;
  async function taps(n, holdMs) {
    await A.rafs(25);
    const per = [];
    for (let i = 0; i < n; i++) {
      const a = shots();
      A.down(0);
      if (holdMs > 0) await A.sleep(holdMs);
      A.up(0);
      await A.sleep(300);
      per.push(shots() - a);
    }
    await A.rafs(15);
    return { total: per.reduce((x, y) => x + y, 0),
             tapsThatFired: per.filter(x => x > 0).length, per };
  }
  // Top the magazine up between phases. Warden holds 30; three 10-tap phases
  // can spend exactly 30 rounds and the last phase would then be measuring an
  // EMPTY GUN rather than the input path (this is what produced the
  // [2,2,2,2,2,0,0,0,0,0] pattern on the first AFTER run).
  async function topUp() {
    const W = F.sim.state.player.weapon;
    if (W.mag >= 28) return W.mag;
    A.key('keydown', 'KeyR'); A.key('keyup', 'KeyR');
    for (let i = 0; i < 400 && W.mag < 28; i++) await A.raf();
    await A.rafs(10);
    return W.mag;
  }
  R.magAtStart = F.sim.state.player.weapon.mag;
  R.subFrame_0ms = await taps(10, 0);
  R.magBefore40 = await topUp();
  R.hold_40ms    = await taps(10, 40);
  R.magBefore120 = await topUp();
  R.hold_120ms   = await taps(10, 120);
  R.magAtEnd = F.sim.state.player.weapon.mag;
  return R;
}"""

C2_BUF = r"""async () => {
  // Doctrine §2 / combat_spec §1.8: a verb pressed at a non-actionable moment
  // is BUFFERED 0.35 s and fires on the first eligible tick INSIDE that window.
  // It is not "held until the action ends" — a tap 0.15 s into a 2.1 s reload
  // is SUPPOSED to expire. So both cases below put the press inside the window.
  const A = __AIM__, F = __FPS__, R = {};
  const P = () => F.sim.state.player;
  const W = () => F.sim.state.player.weapon;
  const shots = () => F.sim.state.counters.shotsFired;
  const simT = () => F.sim.state.time;

  // ---- case 1: fire pressed DURING SPRINT (Warden sprint-out 210 ms < 350) --
  A.key('keydown', 'KeyW'); A.key('keydown', 'ShiftLeft');
  for (let i = 0; i < 200 && F.sim.state.player._m?.sprintState === 'none'; i++) await A.raf();
  R.sprintState = P()._m ? P()._m.sprintState : 'unknown';
  await A.rafs(20);
  {
    const s0 = shots(), t0 = simT();
    A.down(0); A.up(0);                    // SUB-FRAME tap while sprinting
    A.key('keyup', 'ShiftLeft');           // release sprint the same instant
    for (let i = 0; i < 200 && shots() === s0; i++) await A.raf();
    R.sprintOut_fired = shots() - s0 > 0;
    R.sprintOut_delayS = +(simT() - t0).toFixed(3);
    R.sprintOut_withinBuffer = R.sprintOut_fired && R.sprintOut_delayS <= 0.35 + 0.05;
  }
  A.key('keyup', 'KeyW'); A.up(0); await A.rafs(30);

  // ---- case 2: fire pressed in the RELOAD TAIL, inside the 0.35 s window ----
  // Two passes: pass 1 times the reload, pass 2 taps (reloadS - 0.20) into it.
  async function reloadOnce(tapAt) {
    A.down(0); await A.rafs(14); A.up(0); await A.rafs(25);   // spend rounds
    A.key('keydown', 'KeyR'); A.key('keyup', 'KeyR');
    for (let i = 0; i < 60 && !/reload/i.test(W().state); i++) await A.raf();
    if (!/reload/i.test(W().state)) return null;
    const t0 = simT();
    let tapped = false, s0 = 0, tapT = 0;
    for (let i = 0; i < 400; i++) {
      if (!/reload/i.test(W().state)) break;
      if (tapAt != null && !tapped && (W().stateT || 0) >= tapAt) {
        tapped = true; s0 = shots(); tapT = simT();
        A.down(0); A.up(0);                                  // SUB-FRAME tap
      }
      await A.raf();
    }
    const durS = +(simT() - t0).toFixed(3);
    if (tapAt == null) return { durS };
    for (let i = 0; i < 120 && shots() === s0; i++) await A.raf();
    A.up(0);
    return { durS, fired: shots() - s0 > 0, delayS: +(simT() - tapT).toFixed(3) };
  }
  const cal = await reloadOnce(null);
  R.reloadDurS = cal ? cal.durS : null;
  await A.rafs(25);
  if (cal) {
    const tapAt = Math.max(0.05, cal.durS - 0.20);
    const hit = await reloadOnce(tapAt);
    R.reloadTail_tapAt = +tapAt.toFixed(3);
    R.reloadTail_pass2DurS = hit ? hit.durS : null;
    // Did the tap actually land in the tail THIS pass? If pass 2's reload ran
    // longer than pass 1's, the tap was mid-reload and expiring is CORRECT
    // behaviour, not a defect — the window is 0.35 s, not "until it ends".
    R.reloadTail_secondsBeforeEnd = hit ? +(hit.durS - tapAt).toFixed(3) : null;
    R.reloadTail_tapWasInsideWindow = !!(hit && (hit.durS - tapAt) <= 0.35);
    R.reloadTail_fired = hit ? !!hit.fired : null;
    R.reloadTail_delayS = hit ? hit.delayS : null;
    R.reloadTail_withinBuffer = !!(hit && hit.fired && hit.delayS <= 0.35 + 0.05);
  }
  await A.rafs(20);
  return R;
}"""

D_LAT = r"""async () => {
  const A = __AIM__, F = __FPS__;
  const s = [];
  for (let k = 0; k < 24; k++) {
    await A.raf();
    await A.sleep(3);
    const t0 = performance.now();
    const y0 = F.camera.rotation.y;
    A.move(60, 0);
    for (let i = 0; i < 8; i++) {
      await A.raf();
      if (F.camera.rotation.y !== y0) { s.push(performance.now() - t0); break; }
    }
  }
  s.sort((a, b) => a - b);
  const fm = F.perfStats.frameMs;
  const med = s.length ? s[Math.floor(s.length / 2)] : 0;
  return { n: s.length, medianMs: +med.toFixed(2),
           minMs: +(s[0] || 0).toFixed(2), maxMs: +(s[s.length - 1] || 0).toFixed(2),
           frameMs: +fm.toFixed(2), medianFrames: +(med / Math.max(1e-6, fm)).toFixed(2) };
}"""

E_FR = r"""async () => {
  const A = __AIM__, F = __FPS__, R = { dprNow: F.renderer.getPixelRatio(),
    viewport: window.innerWidth + 'x' + window.innerHeight };
  async function sample(n) {
    const t = []; let last = performance.now();
    for (let i = 0; i < n; i++) { await A.raf(); const x = performance.now(); t.push(x - last); last = x; }
    t.sort((a, b) => a - b);
    return { p50: +t[Math.floor(t.length * 0.5)].toFixed(2),
             p95: +t[Math.floor(t.length * 0.95)].toFixed(2),
             fps: +(1000 / t[Math.floor(t.length * 0.5)]).toFixed(1) };
  }
  const r = F.renderer, base = r.getPixelRatio();
  async function at(s, n) {
    r.setPixelRatio(s); r.setSize(window.innerWidth, window.innerHeight, false);
    await sample(25);                       // discard: resize + post chain rebuild
    const m = await sample(n);
    return { scale: s, buffer: r.domElement.width + 'x' + r.domElement.height, ...m };
  }
  await sample(30);
  R.native = await at(1.0, 140);
  // Interleaved A/B: re-measure 1.0 after every scale so machine-load drift
  // shows up as a moving baseline instead of contaminating the curve.
  R.sweep = []; R.baselineDrift = [];
  for (const s of [0.9, 0.8, 0.75, 0.7, 0.65, 0.6]) {
    R.sweep.push(await at(s, 110));
    R.baselineDrift.push((await at(1.0, 70)).p50);
  }
  // Is the frame actually GPU-bound right now? If p50 barely moves between 1.0
  // and 0.6 the run hit a refresh/throttle ceiling and the curve says nothing.
  const lo = R.sweep[R.sweep.length - 1].p50;
  R.gpuBound = (R.native.p50 - lo) / R.native.p50 > 0.15;
  r.setPixelRatio(base); r.setSize(window.innerWidth, window.innerHeight, false);
  await sample(25);
  R.restoredDpr = r.getPixelRatio();
  return R;
}"""

STAGES = [("A_aim", A_AIM, 90_000), ("B_ads", B_ADS, 90_000), ("C_taps", C_TAPS, 120_000),
          ("C2_buffer", C2_BUF, 90_000), ("D_latency", D_LAT, 90_000), ("E_frames", E_FR, 420_000)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=os.path.join(HERE, "..", "_shots", "aimfeel.json"))
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--label", default="")
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true", help="measure even on a contended box")
    args = ap.parse_args()
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    ensure_server()

    out = {"label": args.label, "t": time.strftime("%Y-%m-%d %H:%M:%S")}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="load", timeout=60_000)
        pg.bring_to_front()

        t0 = time.time()
        while time.time() - t0 < 150:
            if pg.evaluate("!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim && __FPS__.__test)"):
                break
            pg.wait_for_timeout(400)
        else:
            print("NEVER BOOTED", file=sys.stderr); br.close(); return 2
        print(f"[boot] ready in {time.time()-t0:.1f}s", flush=True)

        pg.evaluate(KIT)
        # A REAL mission, never setScenario: scenarios.js pins a frozen cmd over
        # input.buildCmd and overwrites settings.fov for pose framing, so every
        # number this probe exists to take would be an artefact of the harness.
        pg.set_default_timeout(180_000)
        pg.evaluate("async () => { await __FPS__.__test.startMission({}); }")
        pg.wait_for_timeout(2500)
        out["armed"] = pg.evaluate("() => __AIM__.arm()")
        out["version"] = pg.evaluate("() => __FPS__.version")
        out["live"] = pg.evaluate("""() => ({
            phase: __FPS__.sim.state.phase,
            enabled: window.__INPUT__.enabled,
            locked: window.__INPUT__.pointerLocked,
            paused: !!(window.__PAUSE__ && __FPS__.sim.state.paused),
            weapon: __FPS__.sim.state.player.weapon.id,
            mag: __FPS__.sim.state.player.weapon.mag,
            fov: __FPS__.settings.fov,
            alive: __FPS__.sim.state.player.alive,
        })""")
        print(f"[setup] armed={out['armed']} version={out['version']} live={out['live']}", flush=True)
        # LOAD GUARD. Every number this probe takes is a timing number, and on
        # this box four headed-Chrome lanes can share one integrated GPU. A run
        # at 4 fps does not measure the game, it measures the contention: the
        # sim's 5-step clamp puts it in slow motion, so tap intervals, buffer
        # windows and latency all read as defects that are not there. Measure
        # the frame first and stamp the verdict on the output.
        out["load"] = pg.evaluate("""async () => {
            const t = []; let last = performance.now();
            for (let i = 0; i < 90; i++) {
              await __AIM__.raf(); const x = performance.now(); t.push(x - last); last = x;
            }
            t.sort((a, b) => a - b);
            return { p50: +t[45].toFixed(2), p95: +t[85].toFixed(2), fps: +(1000 / t[45]).toFixed(1) };
        }""")
        out["loadVerdict"] = ("OK" if out["load"]["p50"] <= 45 else
                              "CONTENDED — timing stages are NOT valid at this frame time")
        print(f"[load] {out['load']} -> {out['loadVerdict']}", flush=True)
        if out["load"]["p50"] > 45 and not args.force:
            print("ABORTING: box is contended. Re-run when it is quiet, or pass --force.",
                  file=sys.stderr, flush=True)
            out["ABORTED"] = True
            br.close()
            os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump(out, f, indent=2)
            return 3
        # God mode + no-target: the bots must not kill the probe mid-measurement
        # or change what is being measured.
        pg.evaluate("() => { __FPS__.__test.god(true); __FPS__.__test.noTarget(true); }")

        for name, src, ms in STAGES:
            if only and name.split("_")[0] not in only and name not in only:
                continue
            s = time.time()
            try:
                pg.set_default_timeout(ms)
                out[name] = pg.evaluate(src)
                print(f"[{name}] {time.time()-s:.1f}s  {json.dumps(out[name])[:400]}", flush=True)
            except Exception as e:
                out[name] = {"ERROR": str(e)[:400]}
                print(f"[{name}] FAILED after {time.time()-s:.1f}s: {e}", flush=True)

        out["pageErrors"] = errs + pg.evaluate("() => window.__BOOT_ERRORS__ || []")
        br.close()

    # ------------------------------------------------------------- verdict
    # LANE E acceptance criteria, stated so a future run reports a RESULT and
    # not a wall of numbers somebody has to interpret.
    v, fails = {}, []
    A = out.get("A_aim"); B = out.get("B_ads")
    C = out.get("C_taps"); C2 = out.get("C2_buffer")
    if A and "ERROR" not in A:
        v["look is 1:1 (no framerate dependence)"] = A["framerateDependenceRad"] == 0
        v["mouse events accumulate losslessly"] = abs(A["accumulationErrorRad"]) < 1e-12
        v["no round-trip drift"] = abs(A["roundTrip500pxDriftYawRad"]) < 1e-12
        v["pitch clamps cleanly, no snap"] = (
            abs(A["pitchClampHiRad"] - 1.55) < 1e-6 and abs(A["pitchClampLoRad"] + 1.55) < 1e-6
            and abs(abs(A["pitchStepOffPoleRad"]) - 0.0022) < 1e-5)
        v["adsSens setting exists"] = A["adsSens"] != "ABSENT"
        v["renderScale setting exists"] = A["renderScale"] != "ABSENT"
        v["renderScale defaults to native"] = A["renderScale"] == 1
    if B and "ERROR" not in B:
        v["ADS look is zoom-proportional (MDC 1.0)"] = bool(B.get("PASS_degRatioIsFovRatio"))
        r = B.get("screenPxRatio_ads_over_hip")
        if isinstance(r, dict) and "300" in r:
            v["ADS sweeps ~same screen px as hip (300 px flick)"] = abs(r["300"] - 1) <= 0.05
    if C and "ERROR" not in C:
        for k in ("subFrame_0ms", "hold_40ms", "hold_120ms"):
            d = C.get(k)
            if isinstance(d, dict):
                v["every %s tap fires a round" % k] = d.get("tapsThatFired") == 10
    if C2 and "ERROR" not in C2:
        v["fire during sprint is buffered <=0.35 s (doctrine 2)"] = bool(C2.get("sprintOut_withinBuffer"))
    for k in v:
        if not v[k]:
            fails.append(k)
    out["verdict"] = v
    out["VERDICT"] = "PASS" if not fails else "FAIL: " + "; ".join(fails)

    os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
    with open(args.json, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("--- VERDICT ---", flush=True)
    for k in v:
        print("  %s  %s" % ("PASS" if v[k] else "FAIL", k), flush=True)
    print(out["VERDICT"], flush=True)
    print("wrote " + os.path.abspath(args.json), flush=True)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())

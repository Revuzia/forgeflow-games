"""Feasibility probe for the proposed Last Circle gates (harness-gates audit lane).

READ-ONLY: drives the build served by the already-running scoped server; writes only
into this scratch dir. Headless Chrome with the d3d11 flags the reference harnesses use.

Measures, on the CURRENT build, the observables each proposed gate would assert:
  boot   console errors / warnings, page errors, window errors, failed requests, boot time
  rig    per actor: head-to-foot height (9 m stretch), weapon holder parent bone,
         weapon-mesh centre to hand-bone distance (invisible gun), barrel dir vs aim yaw (backwards gun)
  chute  canopies on grounded actors after the drop
  cam    camera yaw/pitch drift over 3 s with no input
  audio  every AudioBufferSourceNode.start(): reports inside the PLAYED window (7-reports bug)
  fov    camera.fov in a portrait viewport vs the kernel's portrait fit (in-flight kernel edit)
"""
import json, math, sys, time
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required"]
OUT = sys.argv[1] if len(sys.argv) > 1 else "lc_gate_probe.json"

INIT = r"""
(() => {
  window.__H_ERR__ = [];
  addEventListener('error', e => window.__H_ERR__.push('error: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || '')));
  addEventListener('unhandledrejection', e => window.__H_ERR__.push('rejection: ' + String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).slice(0, 300)));
  window.__H_FRAMES__ = 0;
  const tick = () => { window.__H_FRAMES__++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  window.__H_AUD__ = [];
  const S = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, off, dur) {
    try { window.__H_AUD__.push({ buf: this.buffer, off: off || 0, dur: dur, t: performance.now() }); } catch (e) {}
    return S.apply(this, arguments);
  };
})();
"""

RIG_JS = r"""
(label) => {
  const C = window.__LC__, W = C.W, THREE = W.THREE;
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), z = new THREE.Vector3();
  W.scene.updateMatrixWorld(true);
  const rows = [];
  for (const a of W.actors) {
    if (!a || !a.alive || !a.obj) continue;
    let head = null, lf = null, rf = null;
    a.obj.traverse((o) => { if (!o.isBone) return;
      if (/Head$/.test(o.name) && !/HeadTop/.test(o.name) && !head) head = o;
      if (/LeftFoot$/.test(o.name) && !lf) lf = o; if (/RightFoot$/.test(o.name) && !rf) rf = o; });
    let height = null;
    if (head && lf && rf) {
      const hy = head.getWorldPosition(v).y; const fy = Math.min(lf.getWorldPosition(v).y, rf.getWorldPosition(v).y);
      height = +(hy - fy).toFixed(3);
    }
    const parent = a.hand && a.hand.parent;
    let gunToHand = null, barrelDotAim = null, hasGeom = false;
    const wm = a.weaponMesh || (a.hand && a.hand.children[0]);
    if (wm) wm.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o.geometry) hasGeom = true; });
    if (wm && hasGeom && a.handBone) {
      const box = new THREE.Box3().setFromObject(wm); const c = box.getCenter(new THREE.Vector3());
      gunToHand = +c.distanceTo(a.handBone.getWorldPosition(v)).toFixed(3);
      a.hand.getWorldQuaternion(q); z.set(0, 0, 1).applyQuaternion(q);
      const yaw = a.yaw; const ax = -Math.sin(yaw), az = -Math.cos(yaw);
      const hl = Math.hypot(z.x, z.z) || 1;
      barrelDotAim = +((z.x * ax + z.z * az) / hl).toFixed(3);
    }
    rows.push({ id: a.id, skin: a.skin, bot: !!a.isBot, onGround: !!a.onGround, gliding: !!a.gliding,
      swimming: !!a.swimming, emoting: !!a.emoting, armMode: a._armMode || null,
      chute: !!a.chute, height, handParent: parent ? parent.name : null, handParentIsBone: !!(parent && parent.isBone),
      weapon: a.weapon ? a.weapon.id : null, gunToHand, barrelDotAim });
  }
  const audit = {}; for (const k in (W._rigAudit || {})) { const r = W._rigAudit[k]; audit[k] = { ok: r.ok, missing: r.missing, handBone: r.handBone && r.handBone.name }; }
  return { label, phase: W.phase, t: +W.t.toFixed(2), frames: window.__H_FRAMES__, rows, rigAudit: audit,
           camFov: +W.camera.fov.toFixed(2), camFit: W.kernel._camFit ? Object.assign({}, W.kernel._camFit) : null,
           canvas: [W.kernel.renderer.domElement.width, W.kernel.renderer.domElement.height], dpr: W.kernel.renderer.getPixelRatio() };
}
"""

CAM_JS = r"""
() => { const c = window.__LC__.W.camera; const e = new window.__LC__.W.THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ');
        return { yaw: e.y, pitch: e.x, x: c.position.x, y: c.position.y, z: c.position.z, frames: window.__H_FRAMES__,
                 lock: !!document.pointerLockElement }; }
"""

AUD_JS = r"""
() => {
  const rows = [];
  for (const r of window.__H_AUD__) {
    const b = r.buf; if (!b || b.duration < 0.05) continue;
    const d = b.getChannelData(0), sr = b.sampleRate, n = d.length;
    let peak = 0; for (let i = 0; i < n; i++) { const x = Math.abs(d[i]); if (x > peak) peak = x; }
    if (peak <= 0) continue;
    // reports = onsets >= 40 ms apart crossing 35 % of the file peak (the same rule audio.js oneShotSlice uses)
    const count = (i0, i1) => { let k = 0, last = -1e9; const gap = Math.floor(sr * 0.04);
      for (let i = i0; i < i1; i++) { if (Math.abs(d[i]) > peak * 0.35 && i - last >= gap) { k++; last = i; } } return k; };
    const i0 = Math.floor((r.off || 0) * sr), i1 = r.dur != null ? Math.min(n, i0 + Math.floor(r.dur * sr)) : n;
    rows.push({ fileDur: +b.duration.toFixed(3), off: +(r.off || 0).toFixed(3), dur: r.dur == null ? null : +r.dur.toFixed(3),
                reportsInFile: count(0, n), reportsPlayed: count(i0, i1) });
  }
  return rows;
}
"""


def run(pw, viewport, label, do_match_checks=True):
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    ctx = br.new_context(viewport=viewport)
    ctx.add_init_script(INIT)
    pg = ctx.new_page()
    con, perr, freq, bad = [], [], [], []
    pg.on("console", lambda m: con.append({"type": m.type, "text": m.text[:300]}))
    pg.on("pageerror", lambda e: perr.append(str(e)[:300]))
    pg.on("requestfailed", lambda r: freq.append(r.url[:160] + " " + str(r.failure)))
    pg.on("response", lambda r: bad.append(f"{r.status} {r.url[:160]}") if r.status >= 400 else None)
    t0 = time.time()
    pg.goto(URL, wait_until="load", timeout=120000)
    ok = False
    for _ in range(300):
        if pg.evaluate("!!(window.__LC__ && window.__LC__.W)"): ok = True; break
        pg.wait_for_timeout(200)
    res = {"label": label, "viewport": viewport, "bootS": round(time.time() - t0, 1), "lcReady": ok}
    if not ok:
        res.update(console=con, pageErrors=perr); br.close(); return res
    pg.evaluate("async () => { await window.__LC__.startMatch({ mode: 'standard', seed: 7 }); }")
    for _ in range(300):
        ph = pg.evaluate("window.__LC__.W.phase")
        if ph in ("drop", "match"): break
        pg.wait_for_timeout(200)
    res["phaseAfterLobby"] = pg.evaluate("window.__LC__.W.phase")
    pg.wait_for_timeout(1500)
    res["drop"] = pg.evaluate(RIG_JS, "drop")
    if do_match_checks:
        # land everyone: glide is ~25 s; fast-forward is rAF-free, then let the view render
        pg.evaluate("() => window.__LC__.fastForward(45, 1/30)")
        pg.wait_for_timeout(1500)
        res["landed"] = pg.evaluate(RIG_JS, "landed")
        # camera drift with NO input for 3 s (pointer unlocked in headless)
        a = pg.evaluate(CAM_JS); pg.wait_for_timeout(3000); b = pg.evaluate(CAM_JS)
        res["camDrift"] = {"dYawDeg": round(math.degrees(b["yaw"] - a["yaw"]), 4),
                           "dPitchDeg": round(math.degrees(b["pitch"] - a["pitch"]), 4),
                           "frames": b["frames"] - a["frames"], "lock": b["lock"]}
        # real mouse clicks on the canvas centre = trigger pulls
        n0 = pg.evaluate("window.__H_AUD__.length")
        for _ in range(6):
            pg.mouse.move(viewport["width"] // 2, viewport["height"] // 2)
            pg.mouse.down(); pg.wait_for_timeout(60); pg.mouse.up(); pg.wait_for_timeout(450)
        res["shotsFired"] = pg.evaluate("window.__LC__.W.stats.shotsFired")
        res["audioStartsDuringClicks"] = pg.evaluate("window.__H_AUD__.length") - n0
        res["audio"] = pg.evaluate(AUD_JS)
        res["audioCtx"] = pg.evaluate("window.__AUDIO_CTX__ ? window.__AUDIO_CTX__.state : null")
    res["winErrors"] = pg.evaluate("window.__H_ERR__")
    res["console"] = con; res["pageErrors"] = perr; res["failedRequests"] = freq; res["http4xx5xx"] = bad
    br.close()
    return res


def main():
    out = {}
    with sync_playwright() as pw:
        out["desktop"] = run(pw, {"width": 1280, "height": 720}, "desktop")
        out["portrait"] = run(pw, {"width": 390, "height": 844}, "portrait", do_match_checks=False)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("wrote", OUT)


main()

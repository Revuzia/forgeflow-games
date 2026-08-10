# -*- coding: utf-8 -*-
"""
qa_tpose_live2.py -- discriminator follow-up to qa_tpose_live.py.

Q1  Are the B-flags (arms near horizontal + quasi-static over 0.6 s) the
    designed telegraph windup scrub (meshEnemies.js:1570-1576 "THE TELL":
    a.paused = true; a.time = flash * dur * WINDUP_FRAC) or a bind pose?
    Method: spawn 02_cold_glacier_brute adjacent, sample per-frame; whenever
    the flag condition holds record flash, inst.atk, the attack action's
    weight/paused, and which clip carries max weight.
Q2  Where does weight-sum 2.0 come from (sand/50 Dune Warden, ash/86
    Volcanic Plate Knight)? Per-frame getEffectiveWeight sums through
    wake -> attack -> death; record the max sum and the top actions at max.
Q3  Ambient redo with the camera AIMED at the pack every sample so meshes
    are actually visible (v1 had visSamples=0: pack 60 m away, culled).
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
GAME = Path(__file__).resolve().parents[1]
PORT = 8804
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]
SHOTS = GAME / "_shots"
SHOTS.mkdir(exist_ok=True)

HELPERS = """
const __qa = () => {
  const SF = globalThis.SNOWFLOW;
  const reg = SF.combat.registry;
  const gameWait = (sec) => new Promise((res) => {
    const t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res()
        : requestAnimationFrame(tick);
    tick();
  });
  const armState = (inst) => {
    const bones = inst.skeleton ? inst.skeleton.bones : [];
    const L = bones.find(b => /LeftArm$/.test(b.name));
    const R = bones.find(b => /RightArm$/.test(b.name));
    const LF = bones.find(b => /LeftForeArm$/.test(b.name));
    const RF = bones.find(b => /RightForeArm$/.test(b.name));
    if (!(L && R && LF && RF)) return null;
    const V3 = bones[0].position.constructor;
    const ap = new V3(), fp = new V3();
    const elev = (A, F) => {
      A.getWorldPosition(ap); F.getWorldPosition(fp);
      const dx = fp.x - ap.x, dy = fp.y - ap.y, dz = fp.z - ap.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      return Math.abs(Math.asin(Math.max(-1, Math.min(1, dy / len))))
          * 180 / Math.PI;
    };
    return { dl: elev(L, LF), dr: elev(R, RF), L, R };
  };
  return { SF, reg, gameWait, armState };
};
"""

# Q1 + Q2 combined per unit: per-frame trace with cause attribution.
TRACE_JS = HELPERS + """
async (cfg) => {
  const { SF, reg, gameWait, armState } = __qa();
  const E = SF.combat.enemies, v = E.vis, enc = SF.combat.encounters;
  const c = SF.character;
  enc._nextSpawnAt = 1e9; enc._clearAll(); E.clear();
  await gameWait(0.2);
  const px = c.position.x, pz = c.position.z;
  const id = E.spawn(cfg.key, px + 1.6, pz, cfg.level);
  if (id < 0) return { err: "spawn -1" };
  let slot = -1;
  for (let i = 0; i < E.alive.length; i++)
    if (E.alive[i] && E.id[i] === id) { slot = i; break; }
  let t0 = reg.time;
  while (!v._slotInst[slot]) {
    await gameWait(0.1);
    if (reg.time - t0 > 25) return { err: "inst never bound" };
  }
  const inst = v._slotInst[slot];
  E.homeX[slot] = E.x[slot]; E.homeZ[slot] = E.z[slot];
  reg.damage(id, 1, {});

  const QT = inst.skeleton.bones[0].quaternion.constructor;
  const hist = [];
  const qd = (a, b) => {
    let m1 = 0, m2 = 0;
    for (let k = 0; k < 4; k++) {
      m1 = Math.max(m1, Math.abs(a[k] - b[k]));
      m2 = Math.max(m2, Math.abs(a[k] + b[k]));
    }
    return Math.min(m1, m2);
  };

  const out = { key: cfg.key, flagged: [], maxSum: 0, maxSumAt: null,
                frames: 0 };
  let killed = false;
  t0 = reg.time;
  while (reg.time - t0 < 26) {
    await new Promise(r => requestAnimationFrame(r));
    c.health = c.healthMax;
    if (v._slotInst[slot] !== inst) break;            // freed after death
    const alive = E.alive[slot] && E.id[slot] === id;
    if (!killed && reg.time - t0 > 18 && alive) {
      reg.damage(id, 99999, {}); killed = true;
    }
    if (!alive && !killed) break;
    out.frames++;
    const t = reg.time - t0;
    // weight census
    let wsum = 0; const ws = [];
    for (let k = 0; k < inst.acts.length; k++) {
      const a = inst.acts[k];
      const w = a ? a.getEffectiveWeight() : 0;
      wsum += w; ws.push(+w.toFixed(3));
    }
    if (wsum > out.maxSum) {
      out.maxSum = +wsum.toFixed(3);
      out.maxSumAt = { t: +t.toFixed(2), ws: ws.slice(),
        atk: inst.atk, striking: inst.striking, dying: inst.dying,
        flash: +E.flash[slot].toFixed(3), lunge: +E.lunge[slot].toFixed(3),
        dissolve: +v.dissolve[slot].toFixed(3),
        pausedAtk: inst.atk >= 0 && inst.acts[inst.atk]
            ? inst.acts[inst.atk].paused : null };
    }
    // arm flag condition (B): horizontal + static over >=0.6 s
    const st = armState(inst);
    if (st) {
      const ql = new QT(), qr = new QT();
      st.L.getWorldQuaternion(ql); st.R.getWorldQuaternion(qr);
      const cur = { t, ql: [ql.x, ql.y, ql.z, ql.w],
                    qr: [qr.x, qr.y, qr.z, qr.w] };
      let ref = null;
      for (let i = hist.length - 1; i >= 0; i--)
        if (t - hist[i].t >= 0.6) { ref = hist[i]; break; }
      hist.push(cur); if (hist.length > 200) hist.shift();
      if (ref && st.dl <= 20 && st.dr <= 20) {
        const delta = Math.max(qd(cur.ql, ref.ql), qd(cur.qr, ref.qr));
        if (delta < 0.005 && out.flagged.length < 12) {
          out.flagged.push({
            t: +t.toFixed(2), armDegL: +st.dl.toFixed(1),
            armDegR: +st.dr.toFixed(1), quatDelta: +delta.toFixed(5),
            flash: +E.flash[slot].toFixed(3),
            lunge: +E.lunge[slot].toFixed(3),
            atk: inst.atk, striking: inst.striking,
            atkPaused: inst.atk >= 0 && inst.acts[inst.atk]
                ? inst.acts[inst.atk].paused : null,
            atkW: inst.atk >= 0 && inst.acts[inst.atk]
                ? +inst.acts[inst.atk].getEffectiveWeight().toFixed(3) : null,
            atkTime: inst.atk >= 0 && inst.acts[inst.atk]
                ? +inst.acts[inst.atk].time.toFixed(3) : null,
            wsum: +wsum.toFixed(3), ws: ws.slice(),
            dissolve: +v.dissolve[slot].toFixed(3)
          });
        }
      }
    }
  }
  E.clear(); enc._clearAll();
  return out;
}
"""

AMBIENT_JS = HELPERS + """
async () => {
  const { SF, reg, gameWait, armState } = __qa();
  const E = SF.combat.enemies, v = E.vis, enc = SF.combat.encounters;
  const c = SF.character;
  E.clear(); enc._clearAll();
  enc._nextSpawnAt = 0;
  const t0 = reg.time;
  let moves = 0;
  while (enc.packName == null && reg.time - t0 < 90) {
    await gameWait(2);
    c.health = c.healthMax;
    if (enc.packName == null && (reg.time - t0) > (moves + 1) * 8) {
      const yaw = SF.rig.yaw || 0;
      const nx = c.position.x + Math.sin(yaw) * 60;
      const nz = c.position.z - Math.cos(yaw) * 60;
      c.position.x = nx; c.position.z = nz;
      c.position.y = SF.terrain.heightAt(nx, nz) + 1.2;
      moves++;
    }
  }
  if (enc.packName == null) return { err: "no pack in 90 s game time" };
  const pack = enc.packName;
  // move the player NEAR the pack so bodies render, and keep aiming at it
  const aim = () => {
    let best = -1, bd = 1e9;
    for (let i = 0; i < E.alive.length; i++) {
      if (!E.alive[i]) continue;
      const dx = E.x[i] - c.position.x, dz = E.z[i] - c.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (best >= 0) {
      const dx = E.x[best] - c.position.x, dz = E.z[best] - c.position.z;
      SF.rig.yaw = Math.atan2(dx, -dz);
      c.facing = SF.rig.yaw;
    }
    return { best, dist: Math.sqrt(bd) };
  };
  let a0 = aim();
  if (a0.best >= 0 && a0.dist > 25) {
    const dx = E.x[a0.best] - c.position.x, dz = E.z[a0.best] - c.position.z;
    const k = (a0.dist - 18) / a0.dist;
    const nx = c.position.x + dx * k, nz = c.position.z + dz * k;
    c.position.x = nx; c.position.z = nz;
    c.position.y = SF.terrain.heightAt(nx, nz) + 1.2;
  }
  const QT = null;
  const dets = new Map();   // inst -> {hist}
  const qd = (a, b) => {
    let m1 = 0, m2 = 0;
    for (let k = 0; k < 4; k++) {
      m1 = Math.max(m1, Math.abs(a[k] - b[k]));
      m2 = Math.max(m2, Math.abs(a[k] + b[k]));
    }
    return Math.min(m1, m2);
  };
  let flags = 0, samples = 0, visSamples = 0, minW = 1e9, maxW = -1e9;
  const detail = [];
  const t1 = reg.time;
  while (reg.time - t1 < 20) {
    await gameWait(0.4);
    aim();
    c.health = c.healthMax;
    for (let i = 0; i < E.alive.length; i++) {
      if (!E.alive[i]) continue;
      const inst = v._slotInst[i];
      if (!inst) continue;
      let d = dets.get(inst);
      if (!d) { d = { hist: [] }; dets.set(inst, d); }
      const t = reg.time - t1;
      let wsum = 0;
      for (let k = 0; k < inst.acts.length; k++) {
        const a = inst.acts[k];
        if (a) wsum += a.getEffectiveWeight();
      }
      const visible = inst.mesh ? !!inst.mesh.visible : false;
      samples++;
      let flagged = false, armInfo = null;
      const st = armState(inst);
      if (st) {
        const Q = inst.skeleton.bones[0].quaternion.constructor;
        const ql = new Q(), qr = new Q();
        st.L.getWorldQuaternion(ql); st.R.getWorldQuaternion(qr);
        const cur = { t, ql: [ql.x, ql.y, ql.z, ql.w],
                      qr: [qr.x, qr.y, qr.z, qr.w] };
        let ref = null;
        for (let n = d.hist.length - 1; n >= 0; n--)
          if (t - d.hist[n].t >= 0.6) { ref = d.hist[n]; break; }
        d.hist.push(cur); if (d.hist.length > 90) d.hist.shift();
        if (ref && st.dl <= 20 && st.dr <= 20) {
          const delta = Math.max(qd(cur.ql, ref.ql), qd(cur.qr, ref.qr));
          if (delta < 0.005) {
            flagged = true;
            armInfo = { dl: +st.dl.toFixed(1), dr: +st.dr.toFixed(1),
                        delta: +delta.toFixed(5) };
          }
        }
      }
      if (visible) {
        visSamples++;
        minW = Math.min(minW, wsum); maxW = Math.max(maxW, wsum);
        if (wsum < 0.5 || flagged) {
          flags++;
          if (detail.length < 10)
            detail.push({ slot: i, unit: E.units[E.unitOf[i]].name,
              t: +t.toFixed(2), wsum: +wsum.toFixed(3),
              flash: +E.flash[i].toFixed(2), arm: armInfo });
        }
      }
    }
  }
  const a1 = aim();
  return { pack, moves, samples, visSamples, flags, detail,
           minW: +minW.toFixed(3), maxW: +maxW.toFixed(3),
           aimedDist: +a1.dist.toFixed(1), instances: dets.size,
           aliveNow: E.aliveCount };
}
"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    page_errors = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False,
                                    args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("pageerror", lambda e: page_errors.append(str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(3000)

            # Q1: windup discriminator on a heavily-flagged cold unit
            pg.evaluate("(r) => SNOWFLOW.enterRealm(r)", "cold")
            pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
            r = pg.evaluate(TRACE_JS, {"key": "02_cold_glacier_brute",
                                       "level": 1})
            print("Q1 glacier_brute trace:", flush=True)
            print(json.dumps(r, indent=1), flush=True)

            # Q2: the two wsum=2.0 units
            for realm, key, lvl in [("sand", "50_v2_sand_dune_warden", 8),
                                    ("ash", "86_v3_ash_volcanic_plate_knight",
                                     18)]:
                pg.evaluate("(r) => SNOWFLOW.enterRealm(r)", realm)
                pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
                r = pg.evaluate(TRACE_JS, {"key": key, "level": lvl})
                print(f"\nQ2 {key} maxSum={r.get('maxSum')} "
                      f"at={json.dumps(r.get('maxSumAt'))}", flush=True)
                print(f"   flagged({len(r.get('flagged', []))}):",
                      json.dumps(r.get("flagged", [])[:6]), flush=True)

            # Q3: ambient redo, camera aimed
            pg.evaluate("(r) => SNOWFLOW.enterRealm(r)", "cold")
            pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
            amb = pg.evaluate(AMBIENT_JS)
            print("\nQ3 ambient:", json.dumps(amb), flush=True)
            pg.wait_for_timeout(500)
            shot = SHOTS / "tpose_ambient_pack.png"
            pg.screenshot(path=str(shot))
            print(f"screenshot: {shot}", flush=True)
            br.close()
        print(f"\npage errors: {len(page_errors)}", flush=True)
        for e in page_errors[:10]:
            print("  PAGEERROR:", e, flush=True)
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""
qa_tpose_live.py -- prove NO enemy ever renders bind/T-pose in real gameplay.

Coverage: all 36 spawnable units across cold/sand/ash through the REAL
pipeline (enemies.spawn -> vis.spawnUnit -> per-instance mixer). Per unit:
wake -> ~8 s idle/locomotion sampling, teleport adjacent -> attack sampling,
kill -> death sampling. T-detector per sample:
  flagA: sum of effective action weights < 0.5 while mesh visible
  flagB: both upper arms within 20 deg of horizontal AND both arm world
         quaternions moved < 0.005 (max abs component, sign-safe) over 0.6 s
         of GAME time.
Then an ambient pass: real director spawns a pack naturally, 20 s detector
over every live instance, screenshot aimed at the nearest enemy.
All waits are GAME-TIME (registry.time), never wall-clock.
Exit 0 only if every unit passes and ambient shows zero flags.
"""
import json
import subprocess
import sys
import time as _time
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

# Shared in-page helpers: game-time wait + the T-detector factory.
HELPERS = """
const __qaHelpers = () => {
  const SF = globalThis.SNOWFLOW;
  const reg = SF.combat.registry;
  const gameWait = (sec) => new Promise((res) => {
    const t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res()
        : requestAnimationFrame(tick);
    tick();
  });
  const mkDetector = (inst) => {
    const bones = inst.skeleton ? inst.skeleton.bones : [];
    const L = bones.find(b => /LeftArm$/.test(b.name));
    const R = bones.find(b => /RightArm$/.test(b.name));
    const LF = bones.find(b => /LeftForeArm$/.test(b.name));
    const RF = bones.find(b => /RightForeArm$/.test(b.name));
    const hasArms = !!(L && R && LF && RF);
    const V3 = bones.length ? bones[0].position.constructor : null;
    const QT = bones.length ? bones[0].quaternion.constructor : null;
    const hist = [];
    const qd = (a, b) => {          // sign-safe max abs component delta
      let m1 = 0, m2 = 0;
      for (let i = 0; i < 4; i++) {
        m1 = Math.max(m1, Math.abs(a[i] - b[i]));
        m2 = Math.max(m2, Math.abs(a[i] + b[i]));
      }
      return Math.min(m1, m2);
    };
    return {
      hasArms,
      sample(t) {
        let wsum = 0; const clips = [];
        for (let k = 0; k < inst.acts.length; k++) {
          const a = inst.acts[k]; if (!a) continue;
          const w = a.getEffectiveWeight(); wsum += w;
          if (w > 0.3) clips.push(k);
        }
        let horiz = false, armDeg = null, quatDelta = null;
        if (hasArms) {
          const ap = new V3(), fp = new V3();
          const elev = (A, F) => {
            A.getWorldPosition(ap); F.getWorldPosition(fp);
            const dx = fp.x - ap.x, dy = fp.y - ap.y, dz = fp.z - ap.z;
            const len = Math.hypot(dx, dy, dz) || 1;
            return Math.abs(Math.asin(Math.max(-1, Math.min(1, dy / len))))
                * 180 / Math.PI;
          };
          const dl = elev(L, LF), dr = elev(R, RF);
          armDeg = Math.max(dl, dr);          // deg from horizontal, worst arm
          horiz = dl <= 20 && dr <= 20;
          const ql = new QT(), qr = new QT();
          L.getWorldQuaternion(ql); R.getWorldQuaternion(qr);
          const cur = { t, ql: [ql.x, ql.y, ql.z, ql.w],
                        qr: [qr.x, qr.y, qr.z, qr.w] };
          let ref = null;
          for (let i = hist.length - 1; i >= 0; i--) {
            if (t - hist[i].t >= 0.6) { ref = hist[i]; break; }
          }
          if (ref) quatDelta = Math.max(qd(cur.ql, ref.ql),
                                        qd(cur.qr, ref.qr));
          hist.push(cur); if (hist.length > 90) hist.shift();
        }
        const visible = inst.mesh ? !!inst.mesh.visible : false;
        const flagA = visible && wsum < 0.5;
        const flagB = visible && hasArms && horiz && quatDelta !== null
            && quatDelta < 0.005;
        return { wsum, clips, visible, flagA, flagB, armDeg, quatDelta };
      }
    };
  };
  return { SF, reg, gameWait, mkDetector };
};
"""

UNIT_JS = HELPERS + """
async (cfg) => {
  const { SF, reg, gameWait, mkDetector } = __qaHelpers();
  const E = SF.combat.enemies, v = E.vis, enc = SF.combat.encounters;
  const c = SF.character;
  enc._nextSpawnAt = 1e9; enc._clearAll(); E.clear();
  await gameWait(0.2);

  const px = c.position.x, pz = c.position.z;
  const id = E.spawn(cfg.key, px, pz - 12, cfg.level);
  if (id < 0) return { key: cfg.key, err: "spawn returned -1" };
  let slot = -1;
  for (let i = 0; i < E.alive.length; i++)
    if (E.alive[i] && E.id[i] === id) { slot = i; break; }
  if (slot < 0) return { key: cfg.key, err: "no slot for id" };
  let t0 = reg.time;
  while (!v._slotInst[slot]) {
    await gameWait(0.1);
    if (reg.time - t0 > 25) return { key: cfg.key, err: "inst never bound" };
  }
  const inst = v._slotInst[slot];
  const det = mkDetector(inst);
  const row = {
    key: cfg.key, name: E.units[E.unitOf[slot]].name,
    hasArms: det.hasArms, clips: {}, samples: 0, visSamples: 0,
    flags: 0, flagDetail: [], minW: 1e9, maxW: -1e9,
    minArmDeg: 999, minQuatDelta: 1e9,
    boltFired: false, flashSeen: false, lungeSeen: false,
    deathW: 0, deathFirst: null, dissolveEnd: 0, notes: []
  };
  const take = (phase) => {
    if (!E.alive[slot] || E.id[slot] !== id) return null;
    const s = det.sample(reg.time);
    row.samples++;
    for (const k of s.clips) row.clips[k] = (row.clips[k] || 0) + 1;
    if (s.visible) {
      row.visSamples++;
      row.minW = Math.min(row.minW, s.wsum);
      row.maxW = Math.max(row.maxW, s.wsum);
      if (s.flagA || s.flagB) {
        row.flags++;
        row.flagDetail.push({ phase, t: +(reg.time - t0).toFixed(2),
          A: s.flagA, B: s.flagB, wsum: +s.wsum.toFixed(3),
          armDeg: s.armDeg, quatDelta: s.quatDelta });
      }
    }
    if (s.armDeg !== null) row.minArmDeg = Math.min(row.minArmDeg, s.armDeg);
    if (s.quatDelta !== null)
      row.minQuatDelta = Math.min(row.minQuatDelta, s.quatDelta);
    if (E.flash[slot] > 0) row.flashSeen = true;
    if (E.lunge[slot] > 0) row.lungeSeen = true;
    for (let b = 0; b < E.boltAlive.length; b++)
      if (E.boltAlive[b]) { row.boltFired = true; break; }
    c.health = c.healthMax;          // keep the target alive
    return s;
  };

  // ---- phase A: wake, idle/locomotion (~8 s game time, 0.4 s cadence)
  reg.damage(id, 1, {});
  t0 = reg.time;
  for (let t = 0; t < 8; t += 0.4) {
    await gameWait(0.4);
    if (take("A") === null) { row.notes.push("died in phase A"); break; }
  }

  // ---- phase B: teleport adjacent, sample through the attack (>=5 s,
  //      extend to 14 s until an attack is observed; re-teleport if it kites)
  let lastTp = -99, attackSeen = false;
  const attackClipSeen = () =>
    Object.keys(row.clips).some(k => (+k) >= 5);
  for (let t = 0; t < 14; t += 0.3) {
    if (!E.alive[slot] || E.id[slot] !== id) {
      row.notes.push("died in phase B"); break;
    }
    const dx = E.x[slot] - c.position.x, dz = E.z[slot] - c.position.z;
    const dist = Math.hypot(dx, dz);
    if ((dist > 4 || t === 0) && (t - lastTp) >= 2 && !attackSeen) {
      E.x[slot] = c.position.x + 1.6; E.z[slot] = c.position.z;
      E.homeX[slot] = E.x[slot]; E.homeZ[slot] = E.z[slot];
      lastTp = t;
    }
    await gameWait(0.3);
    if (take("B") === null) { row.notes.push("died in phase B"); break; }
    attackSeen = attackClipSeen() || row.boltFired;
    if (attackSeen && t >= 5) break;
  }

  // ---- phase C: death (fine cadence to catch the first weighted frame)
  if (E.alive[slot] && E.id[slot] === id) {
    reg.damage(id, 99999, {});
    for (let t = 0; t < 3.5; t += 0.1) {
      await gameWait(0.1);
      if (v._slotInst[slot] !== inst) break;      // slot freed, death done
      const a = inst.acts[4];
      const w = a ? a.getEffectiveWeight() : 0;
      const dis = v.dissolve[slot];
      if (w > row.deathW) row.deathW = w;
      if (w > 0.3 && !row.deathFirst)
        row.deathFirst = { t: +t.toFixed(2),
          actTime: a ? +a.time.toFixed(3) : null,
          dissolve: +dis.toFixed(3) };
      row.dissolveEnd = Math.max(row.dissolveEnd, dis);
      const s = det.sample(reg.time);
      row.samples++;
      for (const k of s.clips) row.clips[k] = (row.clips[k] || 0) + 1;
      if (s.visible) {
        row.visSamples++;
        row.minW = Math.min(row.minW, s.wsum);
        row.maxW = Math.max(row.maxW, s.wsum);
        if (s.flagA || s.flagB) {
          row.flags++;
          row.flagDetail.push({ phase: "C", t: +t.toFixed(2),
            A: s.flagA, B: s.flagB, wsum: +s.wsum.toFixed(3),
            armDeg: s.armDeg, quatDelta: s.quatDelta });
        }
      }
    }
  } else {
    row.notes.push("dead before phase C damage");
  }

  E.clear(); enc._clearAll();
  return row;
}
"""

AMBIENT_JS = HELPERS + """
async () => {
  const { SF, reg, gameWait, mkDetector } = __qaHelpers();
  const E = SF.combat.enemies, v = E.vis, enc = SF.combat.encounters;
  const c = SF.character;
  E.clear(); enc._clearAll();
  enc._nextSpawnAt = 0;                       // restore the director
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
  if (enc.packName == null)
    return { err: "no natural pack within 90 s game time", moves };
  const pack = enc.packName;
  const dets = new Map();
  let flags = 0, samples = 0, visSamples = 0, minW = 1e9, maxAlive = 0;
  const detail = [];
  const t1 = reg.time;
  while (reg.time - t1 < 20) {
    await gameWait(0.4);
    let aliveNow = 0;
    for (let i = 0; i < E.alive.length; i++) {
      if (!E.alive[i]) continue;
      aliveNow++;
      const inst = v._slotInst[i];
      if (!inst) continue;
      let d = dets.get(inst);
      if (!d) { d = dets.get(inst) || mkDetector(inst); dets.set(inst, d); }
      const s = d.sample(reg.time);
      samples++;
      if (s.visible) {
        visSamples++;
        minW = Math.min(minW, s.wsum);
        if (s.flagA || s.flagB) {
          flags++;
          detail.push({ slot: i, unit: E.units[E.unitOf[i]].name,
            t: +(reg.time - t1).toFixed(2), A: s.flagA, B: s.flagB,
            wsum: +s.wsum.toFixed(3), armDeg: s.armDeg,
            quatDelta: s.quatDelta });
        }
      }
    }
    maxAlive = Math.max(maxAlive, aliveNow);
    c.health = c.healthMax;
  }
  // aim the camera at the nearest live enemy for the screenshot
  let best = -1, bd = 1e9;
  for (let i = 0; i < E.alive.length; i++) {
    if (!E.alive[i]) continue;
    const dx = E.x[i] - c.position.x, dz = E.z[i] - c.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = i; }
  }
  let aimed = null;
  if (best >= 0) {
    const dx = E.x[best] - c.position.x, dz = E.z[best] - c.position.z;
    SF.rig.yaw = Math.atan2(dx, -dz);
    c.facing = SF.rig.yaw;
    aimed = { slot: best, unit: E.units[E.unitOf[best]].name,
              dist: +Math.sqrt(bd).toFixed(1) };
  }
  return { pack, moves, samples, visSamples, flags, detail,
           minW: +minW.toFixed(3), maxAlive, aimed, instances: dets.size };
}
"""

REALMS = [("cold", 1), ("sand", 8), ("ash", 18)]
IDLE_LOCO = {0, 1, 2}


def judge(row):
    """Return (passed, list of failure reasons) for one unit row."""
    fails = []
    if "err" in row:
        return False, [row["err"]]
    if row["flags"] > 0:
        fails.append(f"T-detector flagged {row['flags']}x: "
                     f"{json.dumps(row['flagDetail'][:3])}")
    clipset = {int(k) for k in row["clips"]}
    if not (clipset & IDLE_LOCO):
        fails.append(f"no idle/locomotion clip carried >0.3 (saw {sorted(clipset)})")
    attack = any(k >= 5 for k in clipset) or row["boltFired"]
    if not attack:
        fails.append(f"no attack clip (>=5) and no bolt fired "
                     f"(clips {sorted(clipset)}, flash={row['flashSeen']}, "
                     f"lunge={row['lungeSeen']})")
    if row["deathFirst"] is None:
        fails.append(f"death clip never exceeded 0.3 (peak {row['deathW']:.3f})")
    else:
        if row["deathFirst"]["actTime"] is None or row["deathFirst"]["actTime"] > 0.6:
            fails.append(f"death action not young on first weighted frame: "
                         f"{row['deathFirst']}")
    if row["visSamples"] > 0 and (row["minW"] < 0.5 or row["maxW"] > 1.6):
        fails.append(f"weight-sum out of [0.5,1.6]: min {row['minW']:.3f} "
                     f"max {row['maxW']:.3f}")
    if row["visSamples"] == 0:
        fails.append("mesh never visible during sampling")
    return len(fails) == 0, fails


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    page_errors = []
    all_pass = True
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

            rows = []
            for realm, lvl in REALMS:
                print(f"\n==== REALM {realm} (level {lvl}) ====", flush=True)
                pg.evaluate("(r) => SNOWFLOW.enterRealm(r)", realm)
                pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
                pg.wait_for_function(
                    "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                    timeout=300000)
                units = pg.evaluate(
                    "(r) => SNOWFLOW.combat.enemies.units"
                    ".filter(u => u.realm === r)"
                    ".map(u => ({slug: u.slug, key: u.key, name: u.name}))",
                    realm)
                print(f"units in realm: {len(units)}", flush=True)
                for u in units:
                    t_start = _time.time()
                    row = pg.evaluate(UNIT_JS, {"key": u["slug"], "level": lvl})
                    row["realm"] = realm
                    ok, fails = judge(row)
                    rows.append((row, ok, fails))
                    all_pass = all_pass and ok
                    clipset = sorted(int(k) for k in row.get("clips", {}))
                    print(f"[{'PASS' if ok else 'FAIL'}] {realm}/{u['slug']} "
                          f"({row.get('name', '?')}) clips={clipset} "
                          f"wsum[{row.get('minW', 0):.2f},{row.get('maxW', 0):.2f}] "
                          f"flags={row.get('flags', '?')} "
                          f"armDegMin={row.get('minArmDeg', '?')and round(row.get('minArmDeg', 999), 1)} "
                          f"death={json.dumps(row.get('deathFirst'))} "
                          f"bolt={row.get('boltFired')} "
                          f"({_time.time() - t_start:.0f}s wall)", flush=True)
                    for f in fails:
                        print(f"       - {f}", flush=True)

            # ---- ambient pass (cold, real director)
            print("\n==== AMBIENT PASS (cold, real director) ====", flush=True)
            pg.evaluate("(r) => SNOWFLOW.enterRealm(r)", "cold")
            pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
            pg.wait_for_function(
                "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                timeout=300000)
            amb = pg.evaluate(AMBIENT_JS)
            print("ambient:", json.dumps(amb), flush=True)
            shot = SHOTS / "tpose_ambient_pack.png"
            pg.wait_for_timeout(400)
            pg.screenshot(path=str(shot))
            print(f"screenshot: {shot}", flush=True)
            amb_ok = ("err" not in amb) and amb.get("flags", 1) == 0 \
                and amb.get("samples", 0) > 0
            all_pass = all_pass and amb_ok
            print(f"ambient {'PASS' if amb_ok else 'FAIL'}", flush=True)

            br.close()

        print(f"\npage errors: {len(page_errors)}", flush=True)
        for e in page_errors[:10]:
            print("  PAGEERROR:", e, flush=True)
        if page_errors:
            all_pass = False

        n_pass = sum(1 for _, ok, _ in rows if ok)
        print(f"\n==== SUMMARY: {n_pass}/{len(rows)} units pass, "
              f"ambient {'ok' if amb_ok else 'FAIL'}, "
              f"pageErrors={len(page_errors)} ====", flush=True)
        print("VERDICT:", "PASS" if all_pass else "FAIL", flush=True)
        sys.exit(0 if all_pass else 1)
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()

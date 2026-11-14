# -*- coding: utf-8 -*-
"""
qa_tpose_live3.py -- final discriminators.

A. For three units (two B-flagged, one control that passed): spawn UNWOKEN at
   5 m in front of the camera, pure idle. Report the idle clip name, whether
   the idle clip contains quaternion tracks that target the upper-arm bones,
   the LOCAL arm-bone quaternion movement over 2 s (bind-pose arms would be
   exactly static locally), the arm elevation, and a close-up screenshot.
B. Dune Warden acts[4] mystery: list every act's clip name, then per-frame
   watch of acts[4] effective weight vs the shadow inst.weights[4], dissolve,
   enemy state, through wake -> melee -> kill. Records every w4 change.
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
  return { SF, reg, gameWait };
};
"""

IDLE_JS = HELPERS + """
async (cfg) => {
  const { SF, reg, gameWait } = __qa();
  const E = SF.combat.enemies, v = E.vis, enc = SF.combat.encounters;
  const c = SF.character;
  enc._nextSpawnAt = 1e9; enc._clearAll(); E.clear();
  await gameWait(0.2);
  const yaw = SF.rig.yaw || 0;
  const fx = Math.sin(yaw), fz = -Math.cos(yaw);
  const ex = c.position.x + fx * 5, ez = c.position.z + fz * 5;
  const id = E.spawn(cfg.key, ex, ez, cfg.level);
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
  // face the enemy toward the camera so the screenshot shows the front
  E.yaw[slot] = Math.atan2(-fx, fz);
  const bones = inst.skeleton.bones;
  const L = bones.find(b => /LeftArm$/.test(b.name));
  const R = bones.find(b => /RightArm$/.test(b.name));
  const LF = bones.find(b => /LeftForeArm$/.test(b.name));
  const out = { key: cfg.key, name: E.units[E.unitOf[slot]].name };
  out.clipNames = inst.type.clipNames ? inst.type.clipNames.slice() : null;
  const idleAct = inst.acts[0];
  out.idleClip = idleAct ? idleAct.getClip().name : null;
  // does the idle clip animate the arm bones?
  if (idleAct && L) {
    const tracks = idleAct.getClip().tracks.map(t => t.name);
    out.idleTrackCount = tracks.length;
    out.armQuatTracks = tracks.filter(n =>
      /(Left|Right)Arm\\.quaternion$/.test(n));
    out.armAnyTracks = tracks.filter(n => /(Left|Right)(Fore)?Arm/.test(n))
        .slice(0, 8);
  }
  // LOCAL arm quaternion motion over 2 s of pure idle (bind = exactly 0)
  if (L && R) {
    const q0L = [L.quaternion.x, L.quaternion.y, L.quaternion.z,
                 L.quaternion.w];
    const q0R = [R.quaternion.x, R.quaternion.y, R.quaternion.z,
                 R.quaternion.w];
    let maxL = 0, maxR = 0;
    const t1 = reg.time;
    while (reg.time - t1 < 2.0) {
      await new Promise(r => requestAnimationFrame(r));
      const dL = Math.max(
        Math.abs(L.quaternion.x - q0L[0]), Math.abs(L.quaternion.y - q0L[1]),
        Math.abs(L.quaternion.z - q0L[2]), Math.abs(L.quaternion.w - q0L[3]));
      const dR = Math.max(
        Math.abs(R.quaternion.x - q0R[0]), Math.abs(R.quaternion.y - q0R[1]),
        Math.abs(R.quaternion.z - q0R[2]), Math.abs(R.quaternion.w - q0R[3]));
      maxL = Math.max(maxL, dL); maxR = Math.max(maxR, dR);
    }
    out.localArmDeltaL = +maxL.toFixed(4);
    out.localArmDeltaR = +maxR.toFixed(4);
    // arm elevation right now
    if (LF) {
      const V3 = bones[0].position.constructor;
      const ap = new V3(), fp = new V3();
      L.getWorldPosition(ap); LF.getWorldPosition(fp);
      const dx = fp.x - ap.x, dy = fp.y - ap.y, dz = fp.z - ap.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      out.armElevDeg = +(Math.abs(Math.asin(dy / len)) * 180 / Math.PI)
          .toFixed(1);
    }
    // idle action state
    out.idleW = idleAct ? +idleAct.getEffectiveWeight().toFixed(3) : null;
    out.idleTime = idleAct ? +idleAct.time.toFixed(3) : null;
    out.idleRunning = idleAct ? idleAct.isRunning() : null;
  }
  return out;
}
"""

W4_JS = HELPERS + """
async (cfg) => {
  const { SF, reg, gameWait } = __qa();
  const E = SF.combat.enemies, v = E.vis, enc = SF.combat.encounters;
  const c = SF.character;
  enc._nextSpawnAt = 1e9; enc._clearAll(); E.clear();
  await gameWait(0.2);
  const id = E.spawn(cfg.key, c.position.x + 1.6, c.position.z, cfg.level);
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
  const out = { key: cfg.key,
    actNames: inst.acts.map(a => a ? a.getClip().name : null),
    events: [] };
  reg.damage(id, 1, {});
  let last4 = -1, killed = false;
  t0 = reg.time;
  while (reg.time - t0 < 24) {
    await new Promise(r => requestAnimationFrame(r));
    c.health = c.healthMax;
    if (v._slotInst[slot] !== inst) { out.freedAt = +(reg.time - t0).toFixed(2); break; }
    if (!killed && reg.time - t0 > 16 && E.alive[slot] && E.id[slot] === id) {
      reg.damage(id, 99999, {}); killed = true;
      out.events.push({ t: +(reg.time - t0).toFixed(2), ev: "KILL" });
    }
    const a4 = inst.acts[4];
    const w4 = a4 ? a4.getEffectiveWeight() : -1;
    if (Math.abs(w4 - last4) > 0.02 && out.events.length < 60) {
      out.events.push({
        t: +(reg.time - t0).toFixed(2), w4: +w4.toFixed(3),
        shadow4: +inst.weights[4].toFixed(3),
        target4: +inst.targets[4].toFixed(3),
        dissolve: +v.dissolve[slot].toFixed(3),
        state: E.state[slot], flash: +E.flash[slot].toFixed(2),
        lunge: +E.lunge[slot].toFixed(2), atk: inst.atk,
        dying: inst.dying,
        a4time: a4 ? +a4.time.toFixed(3) : null,
        a4paused: a4 ? a4.paused : null,
        shielded: E.shielded ? E.shielded[slot] : null,
        reformed: E.reformed ? E.reformed[slot] : null
      });
      last4 = w4;
    }
  }
  E.clear(); enc._clearAll();
  return out;
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

            pg.evaluate("(r) => SNOWFLOW.enterRealm(r)", "cold")
            pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
            for key in ("02_cold_glacier_brute", "39_v2_cold_blizzard_assassin",
                        "34_v2_cold_ice_cultist"):
                r = pg.evaluate(IDLE_JS, {"key": key, "level": 1})
                print(f"\nA {key}:", json.dumps(r, indent=1), flush=True)
                shot = SHOTS / f"tpose_idle_{key}.png"
                pg.screenshot(path=str(shot))
                print(f"   shot: {shot}", flush=True)

            pg.evaluate("(r) => SNOWFLOW.enterRealm(r)", "sand")
            pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
            r = pg.evaluate(W4_JS, {"key": "50_v2_sand_dune_warden",
                                    "level": 8})
            print("\nB dune_warden acts[4] trace:",
                  json.dumps(r, indent=1), flush=True)
            br.close()
        print(f"\npage errors: {len(page_errors)}", flush=True)
        for e in page_errors[:10]:
            print("  PAGEERROR:", e, flush=True)
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()

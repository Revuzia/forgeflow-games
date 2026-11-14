# -*- coding: utf-8 -*-
"""
qa_feelfix.py -- the four "feel" defects, measured on the live game.

A. CORPSE AIM-LOCK. enemies.js keeps a killed body registered for DEATH_S =
   1.2 s (ST_DYING), and the registry's `alive[]` is the SLOT-OCCUPIED flag,
   not "has hit points". The bolt aim assist filtered on `alive[]`, so inside
   that 1.2 s window a corpse that is more centred than a live enemy wins the
   pure-cosine compare and the shot is led into empty snow. The probe kills A,
   parks a LIVE enemy B beside it, and fans nine shots across the gap from
   "aimed at the corpse" to "aimed at B", reporting the selected registry id
   per shot. PASS = no shot selects the corpse id, and the shots that have B
   in the cone select B. Also reports the corpse's cached lead velocity.

B. VIGNETTE ON WALL TIME. hurtFx's flash decayed on performance.now(), so it
   drained through a paused frame. Flash, pause, hold 2 s of WALL time, read
   the opacity twice. PASS = the two reads are identical, and the flash
   resumes draining after the unpause.

C. HIT-STOP INTO A PAUSED FRAME. hitstop.update() ran unguarded, so a kill
   event welded a camera punch and trauma into the frozen frame. The probe
   freezes, drops a kill event in the ring, calls hitstop.update() directly,
   and re-reads the rig. PASS = punchPitch/punchYaw/trauma and the trigger
   counters are all unmoved, and the time scale is exactly 1.

D. MOTES OFF THE MAP + SILENT PICKUP. spawnAt did not clamp to the play disc
   (620 m), so a boss killed at the edge scattered motes the player cannot
   reach; and no `pickup_mote` row existed in the sfx event table, so the heal
   was silent. The probe drops 8 motes at the edge and 8 well outside it, then
   walks a mote into the player. PASS = every drop is inside playRadius, and
   the pickup increments both `motes.stats.picked` and the pickup_mote sfx
   counter.

Usage:  python _harness/qa_feelfix.py
Port 8914. Serves the repo root (three levels up from the game dir).
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8914
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# --------------------------------------------------------------- shared prelude
PRELUDE = """
const SF = SNOWFLOW;
const reg = SF.combat.registry;
// GAME-TIME wait: the registry clock, ticked by rAF. Never a wall sleep.
const gameWait = (sec) => new Promise((res) => {
    const t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res()
        : requestAnimationFrame(tick);
    tick();
});
const frames = (n) => new Promise((res) => {
    let k = n;
    const tick = () => (--k <= 0) ? res() : requestAnimationFrame(tick);
    tick();
});
const wallWait = (ms) => new Promise((res) => setTimeout(res, ms));
"""

# ------------------------------------------------------------------------- A
JS_A = PRELUDE + """
const en = SF.combat.enemies, ch = SF.character, sh = SF.combat.spellHits;
en.clear();
await frames(2);

// Two bodies 12 m due -Z of the player, 0.9 m apart. 12 m puts them well
// inside ASSIST_RANGE (25 m); 0.9 m at 12 m is 4.3 deg of separation, so a
// shot aimed at one has the other just outside the 3.5 deg cone and a shot
// aimed at the midpoint has BOTH inside it.
const px = ch.position.x, pz = ch.position.z;
const cx = px - 0.45, cz = pz - 12;     // A -> becomes the corpse
const lx = px + 0.45, lz = pz - 12;     // B -> stays alive
const idCorpse = en.spawn('rimeImp', cx, cz, 10);
const idLive   = en.spawn('rimeImp', lx, lz, 10);
await frames(2);                         // a fresh spawn's slot lands NEXT frame
reg.damage(idCorpse, 1, {});             // wake them
// Stun B for 5 s so it holds its mark: the fan's whole point is a controlled
// separation, and an awake imp closes on the player between spawn and fire.
reg.damage(idLive, 1, { cc: 'stun', ccDur: 5 });
await gameWait(0.25);

// Kill A. enemies.js holds it in ST_DYING for DEATH_S = 1.2 s.
reg.damage(idCorpse, 99999, {});
await frames(2);

const sC = reg.slot(idCorpse), sL = reg.slot(idLive);
const corpseState = {
    stillRegistered: sC >= 0,
    aliveFlag: sC >= 0 ? reg.alive[sC] : null,
    hp: sC >= 0 ? reg.hp[sC] : null,
    cachedLeadVel: sC >= 0
        ? +Math.hypot(sh._vX[sC], sh._vZ[sC]).toFixed(4) : null,
};

// The fan uses the bodies' CURRENT registry positions, not the spawn coords:
// B is awake and closing, so by now it has walked off its spawn point. Every
// shot below is fired in ONE synchronous turn, so the geometry cannot move
// between shots.
const px2 = reg.x[sC], pz2 = reg.z[sC];
const lx2 = reg.x[sL], lz2 = reg.z[sL];

// Muzzle: the player's chest, aiming into the gap. The fan sweeps the aim
// point from exactly-on-the-corpse (t=0) to exactly-on-B (t=1).
const oy = ch.position.y + 1.2;
const aimY = reg.y[sL] + reg.height[sL] * 0.55;
const shots = [];
for (let k = 0; k < 9; k++) {
    const t = k / 8;
    const tx = px2 + (lx2 - px2) * t, tz = pz2 + (lz2 - pz2) * t;
    let dx = tx - px, dy = aimY - oy, dz = tz - pz;
    const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
    SF.spells.bolt.fire(px, oy, pz, dx, dy, dz, 42, 40, 0, 1);
    shots.push({
        aimT: +t.toFixed(3),
        chosen: sh.assistStats.lastTargetId,
        what: sh.assistStats.lastTargetId === idCorpse ? 'CORPSE'
            : sh.assistStats.lastTargetId === idLive ? 'live'
            : 'none',
    });
}
// FAN 2 -- the literal ask: bolts fired AT the live enemy while the corpse
// stands beside it. Seven shots swept +/-2.5 deg (inside the 3.5 deg cone)
// along the corpse->live axis, centred on B. Every one must select B.
const ux = (lx2 - px2), uz = (lz2 - pz2);
const ul = Math.hypot(ux, uz) || 1;
const nx = ux / ul, nz = uz / ul;
const distB = Math.hypot(lx2 - px, lz2 - pz);
const atB = [];
for (let k = 0; k < 7; k++) {
    const degOff = -2.5 + (5.0 * k) / 6;
    const lateral = Math.tan(degOff * Math.PI / 180) * distB;
    const tx = lx2 + nx * lateral, tz = lz2 + nz * lateral;
    let dx = tx - px, dy = aimY - oy, dz = tz - pz;
    const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
    SF.spells.bolt.fire(px, oy, pz, dx, dy, dz, 42, 40, 0, 1);
    atB.push({ offDeg: +degOff.toFixed(2),
               chosen: sh.assistStats.lastTargetId,
               what: sh.assistStats.lastTargetId === idCorpse ? 'CORPSE'
                   : sh.assistStats.lastTargetId === idLive ? 'live' : 'none' });
}

const deathFadeLeft = reg.slot(idCorpse) >= 0;
const gap = +Math.hypot(lx2 - px2, lz2 - pz2).toFixed(3);
en.clear();
return { idCorpse, idLive, corpseState, deathFadeLeft, corpseToLiveGapM: gap,
         fan1_gapSweep: shots,
         fan2_aimedAtLive: atB,
         corpseShots: shots.filter(s => s.what === 'CORPSE').length
             + atB.filter(s => s.what === 'CORPSE').length,
         fan2AllLive: atB.every(s => s.what === 'live') };
"""

# ------------------------------------------------------------------------- B
JS_B = PRELUDE + """
const hf = SF.hurtFx;
SF.S.freezeTime = false;
await frames(2);
// onPlayerHit early-returns unless the layer is shown (pointer-lock gate);
// force it so the probe can drive the seam headless.
hf._show = true;
hf.onPlayerHit(1, 0, 40);
SF.S.freezeTime = true;          // pause IMMEDIATELY, inside the 250 ms flash
await frames(3);
hf._show = true;
const op0 = hf._vig.style.opacity;
const t0 = reg.time;
await wallWait(2000);            // 2 SECONDS OF WALL TIME, paused
const op1 = hf._vig.style.opacity;
const gameElapsed = +(reg.time - t0).toFixed(4);
SF.S.freezeTime = false;         // unpause
hf._show = true;
await gameWait(0.10);
hf._show = true;
const op2 = hf._vig.style.opacity;
await gameWait(0.40);            // past the 250 ms flash
const op3 = hf._vig.style.opacity;
return { op0, op1, op2, op3, gameElapsedWhilePaused: gameElapsed,
         heldAcrossPause: op0 === op1,
         resumedAfterUnpause: parseFloat(op2) < parseFloat(op0),
         drainedToZero: parseFloat(op3) === 0 };
"""

# ------------------------------------------------------------------------- C
JS_C = PRELUDE + """
const en = SF.combat.enemies, ch = SF.character, hs = SF.hitstop, rig = SF.rig;
SF.S.freezeTime = false;
en.clear();
await frames(2);
const id = en.spawn('rimeImp', ch.position.x, ch.position.z - 10, 10);
await frames(2);
reg.damage(id, 1, {});
await gameWait(0.2);

SF.S.freezeTime = true;
await frames(3);
const before = { punchPitch: +rig.punchPitch.toFixed(6),
                 punchYaw: +rig.punchYaw.toFixed(6),
                 trauma: +rig.trauma.toFixed(6),
                 kill: hs.stats.triggers.kill,
                 scaleNow: hs.stats.scaleNow };

// A kill event in the ring, then hitstop.update() called DIRECTLY in the same
// synchronous turn, so no frame can clear the ring between the two.
reg.damage(id, 99999, {});
const ringKills = (() => { let n = 0;
    for (let e = 0; e < reg.eventCount; e++) if (reg.evType[e] === 1) n++;
    return n; })();
hs.update(0.016);
const afterDirect = { punchPitch: +rig.punchPitch.toFixed(6),
                      punchYaw: +rig.punchYaw.toFixed(6),
                      trauma: +rig.trauma.toFixed(6),
                      kill: hs.stats.triggers.kill,
                      scaleNow: hs.stats.scaleNow };

// And across half a second of WALL time, catching main.js's own unguarded
// hitstop.update(dtMs/1000) call on every paused frame.
await wallWait(500);
const afterLoop = { punchPitch: +rig.punchPitch.toFixed(6),
                    punchYaw: +rig.punchYaw.toFixed(6),
                    trauma: +rig.trauma.toFixed(6),
                    kill: hs.stats.triggers.kill,
                    scaleNow: hs.stats.scaleNow };
// ---- CONTROL: the same kill, UNPAUSED, must still punch ------------------
// A guard that no-ops the envelope everywhere would pass every assertion
// above while deleting the feature. This is the disconfirming half.
SF.S.freezeTime = false;
await gameWait(0.35);                    // clear the 250 ms anti-strobe cooldown
rig.punchPitch = 0; rig.punchYaw = 0; rig.trauma = 0;
const ctlBefore = { kill: hs.stats.triggers.kill };
const id2 = en.spawn('rimeImp', ch.position.x, ch.position.z - 10, 10);
await frames(2);
reg.damage(id2, 1, {});
await gameWait(0.15);
reg.damage(id2, 99999, {});
await frames(3);
const ctlAfter = { punchPitch: +rig.punchPitch.toFixed(6),
                   trauma: +rig.trauma.toFixed(6),
                   kill: hs.stats.triggers.kill };
en.clear();
const same = (a, b) => a.punchPitch === b.punchPitch && a.punchYaw === b.punchYaw
    && a.trauma === b.trauma && a.kill === b.kill;
return { ringKills, before, afterDirect, afterLoop,
         directNoMotion: same(before, afterDirect),
         loopNoMotion: same(before, afterLoop),
         scaleIsUnity: afterDirect.scaleNow === 1 && afterLoop.scaleNow === 1,
         control_unpaused: { ctlBefore, ctlAfter,
             stillFires: ctlAfter.kill > ctlBefore.kill
                 && ctlAfter.punchPitch !== 0 && ctlAfter.trauma !== 0 } };
"""

# ------------------------------------------------------------------------- D
JS_D = PRELUDE + """
const m = SF.motes, ch = SF.character, T = SF.terrain;
SF.S.freezeTime = false;
const R = T.playRadius;
m.clear();
await frames(2);

// 1. the edge, and 2. a point far outside the disc.
m.spawnAt(R, 0, 8);
m.spawnAt(R * 0.9, R * 0.9, 8);      // |p| = 789 m, well outside 620
const drops = [];
for (let i = 0; i < m.x.length; i++) {
    if (!m.alive[i]) continue;
    drops.push({ i, r: +Math.hypot(m.x[i], m.z[i]).toFixed(3) });
}
const outside = drops.filter(d => d.r > R + 1e-3);

// pickup: sfx counter + the heal
m.clear();
await frames(2);
const sfxBefore = SF.sfx.stats.triggers.pickup_mote;
const rowExists = sfxBefore !== undefined;
const pickedBefore = m.stats.picked;
ch.health = ch.healthMax * 0.5;
m.spawnAt(ch.position.x, ch.position.z, 1);
await gameWait(0.8);
const sfxAfter = SF.sfx.stats.triggers.pickup_mote;
m.clear();
return { playRadius: R, dropCount: drops.length,
         maxDropR: drops.length ? Math.max(...drops.map(d => d.r)) : null,
         outsideCount: outside.length, outside: outside.slice(0, 6),
         allInside: outside.length === 0,
         sfxRowExists: rowExists, sfxBefore, sfxAfter,
         sfxFired: rowExists && sfxAfter > sfxBefore,
         pickedBefore, pickedAfter: m.stats.picked,
         healed: +m.stats.healed.toFixed(2) };
"""


def run(pg, name, js):
    try:
        out = pg.evaluate("(async () => {" + js + "})()")
    except Exception as exc:                      # noqa: BLE001
        out = {"PROBE_ERROR": str(exc)[:400]}
    print("\n===== " + name + " " + "=" * (58 - len(name)))
    print(json.dumps(out, indent=2, default=str))
    return out


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)

            run(pg, "A  corpse aim-lock", JS_A)
            run(pg, "B  vignette vs pause", JS_B)
            run(pg, "C  hit-stop vs pause", JS_C)
            run(pg, "D  motes: clamp + pickup sfx", JS_D)

            print("\npage errors:", errs if errs else "none")
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()

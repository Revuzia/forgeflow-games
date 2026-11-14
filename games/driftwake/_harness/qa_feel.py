# -*- coding: utf-8 -*-
"""
qa_feel.py -- the combat-feel battery, measured on the live game (port 8875).

Six systems were WIRED by an earlier pass and never PROVEN. This probe proves
or disproves each one against the running frame loop, never against the source:

  A  HIT-STOP     kill an imp with the Frost Arc; the kill trigger must fire,
                  game-time must measurably lag wall-time for ~3 frames, the
                  burst must stay inside the 90 ms stack cap, and dt must NEVER
                  reach 0 -- `dt === 0` is the combat freeze rule's no-op
                  sentinel (spellHits.update:167, enemies/meshEnemies), so a
                  hit-stop that drove dt to 0 would silently skip the damage
                  pass instead of slowing it.
  B  FLINCH       hit a glacierBrute for >= 25; the vis flinch drive channel
                  must rise inside 0.2 s and the role kit's 'hit' action
                  (clip slot 3 = CL_HIT) must carry real weight from a young
                  playhead -- a stale playhead means the clip resumed rather
                  than restarting on the impact edge.
  C  CAM PUNCH    on the same kill, the rig's punch offset leaves 0 and is back
                  under a hair of 0 within 0.4 s.
  D  HURT FX      let an imp actually strike the player; the vignette element's
                  opacity rises then decays, and the low-hp class toggles under
                  30% health.
  E  MOTES        kill 8 fodder; drops must match the spec rate (COMBAT_DESIGN
                  :126 "fodder 35% chance, elite 100%") through the error-
                  diffusion bank, and walking onto one must heal +10% max HP
                  and consume it.
  F  AIM ASSIST   a body strafing at 3 m/s at 12 m, ten bolts fired at its
                  CURRENT centre with no manual lead, A/B'd against
                  `assistEnabled = false`. The Frost Arc must NOT be bent: its
                  fan darts are `own === 1` carriers and the cone itself never
                  goes through the bolt pool at all.

                  READ `analyticApproachM`, NOT the binary hit count. The
                  assist is a LAUNCH-ONLY system -- nothing homes afterwards --
                  so its entire quality is the heading that left the muzzle,
                  and that is scored in closed form against the body's true
                  trajectory (exact, frame-rate free). The binary count in this
                  rig is dominated by something else entirely: the probe fires
                  from 1.2 m above the player's feet along a nearly flat 13.5 m
                  line, and `dart.update()` terminates a bolt that meets the
                  ground. Measured -- the eight misses died after 3.4-7.2 m
                  with 0.05-0.76 m of clearance left, while the two hits
                  travelled the full 11.9 m with 0.8-1.0 m of clearance. That
                  is terrain relief, identical with the assist on or off, and
                  says nothing about aim.

TIMING CONTRACT (why every mutation happens inside a rAF callback):
`registry.endFrame()` clears the event ring at the END of main's frame(), and
main re-registers its own rAF FIRST thing inside frame() -- so a callback this
probe queues during frame N runs after main's frame body in frame N+1, i.e.
strictly after that frame's endFrame(). Damage applied there is guaranteed to
survive into the NEXT frame's consumers (hitstop, motes, enemies' flinch drain)
instead of racing a clear. Mutating from a bare page.evaluate() is a coin flip.

    python qa_feel.py
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
SHOTS = HERE.parent / "_shots"
PORT = 8875
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# ---------------------------------------------------------------- page helpers
# Prepended to every async evaluate. GAME-TIME waits only: `reg.time` advances
# by the dilated dt, so a wait written in game seconds survives a hit-stop and a
# 6 fps frame alike. Wall sleeps would not.
PRE = """
const SF = SNOWFLOW, reg = SF.combat.registry, C = SF.character;
const gameWait = (s) => new Promise((res) => {
    const t0 = reg.time;
    const tick = () => (reg.time - t0 >= s) ? res() : requestAnimationFrame(tick);
    tick();
});
const frames = (n) => new Promise((res) => {
    let k = 0;
    const tick = () => (++k >= n) ? res() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
});
// Run fn in the post-endFrame window (see the module docstring).
const afterFrame = (fn) => new Promise((res) => {
    requestAnimationFrame(() => { const v = fn(); res(v); });
});
const enemySlot = (id) => {
    const E = SF.combat.enemies;
    for (let i = 0; i < E.id.length; i++) if (E.id[i] === id) return i;
    return -1;
};
const clearBodies = () => {
    for (let i = reg.count - 1; i >= 0; i--) reg.remove(reg.idOf[i]);
};
"""

SETUP = """(() => {
    const SF = SNOWFLOW;
    // Stop the director: every body in this battery is placed on purpose.
    SF.S.combatEnemies = false;
    // hurtFx / crosshair gate on pointer lock, which automation cannot
    // produce. Drive the REAL gate rather than faking the effect downstream.
    SF.input.locked = true;
    for (let i = SF.combat.registry.count - 1; i >= 0; i--)
        SF.combat.registry.remove(SF.combat.registry.idOf[i]);
    SF.character.health = SF.character.healthMax;
    if (SF.character.mana !== undefined) SF.character.mana = SF.character.manaMax;
    // Pre-grant every spell the battery uses (bolt 6 / arc 7 are the primary).
    for (const k of [1, 3, 4, 5, 6, 7]) SF.progression.unlocked.add(k);
    return {
        hpMax: SF.character.healthMax,
        overlayVisible: !!(SF.overlay && SF.overlay.visible),
        motesWired: !!SF.motes,
        hitstopWired: !!SF.hitstop,
        assistInstalled: !!(SF.spells.bolt && SF.spells.bolt.assist),
    };
})()"""

# ------------------------------------------------------- A/C hit-stop + punch
A_HITSTOP = """(async () => {""" + PRE + """
    clearBodies();
    C.health = C.healthMax;
    await frames(3);

    const lvl = SF.progression.level;
    const x = C.position.x, z = C.position.z - 4.5;
    const id = SF.combat.enemies.spawn('rimeImp', x, z, lvl);
    if (id < 0) return { err: 'spawn ' + id };
    await gameWait(0.4);
    let s = reg.slot(id);
    if (s < 0) return { err: 'no slot' };
    const tier = reg.tier[s];
    // Soften it so ONE arc kills: the measurement is the stop, not the TTK.
    reg.hp[s] = 4;

    // Face it and set the flat aim the arc reads.
    const dx = reg.x[s] - C.position.x, dz = reg.z[s] - C.position.z;
    const l = Math.hypot(dx, dz) || 1;
    SF.spells.aim.set(dx / l, 0, dz / l);
    SF.rig.yaw = Math.atan2(dx / l, -dz / l);
    C.facing = SF.rig.yaw;

    const k0 = SF.hitstop.stats.triggers.kill;
    const rej0 = SF.hitstop.stats.rejected;

    // The sampler: one row per frame, taken AFTER main's frame body, so
    // `reg.time` already carries this frame's dilated dt.
    const rows = [];
    let pw = performance.now(), pg = reg.time, stop = false;
    const sample = () => {
        const w = performance.now(), g = reg.time;
        rows.push({
            wall: +(w - pw).toFixed(3),
            game: +((g - pg) * 1000).toFixed(3),
            // `ratio` is the ONLY honest per-frame dilation read. main.js:760
            // computes the frame's dt from the scale hitstop.update() left
            // behind LAST frame, so `scale` sampled here belongs to the NEXT
            // row, not this one -- reading them on the same line inflates the
            // apparent stop by exactly one (here 123 ms) frame.
            ratio: +((g - pg) * 1000 / Math.max(0.001, w - pw)).toFixed(4),
            scaleForNext: +SF.hitstop.stats.scaleNow.toFixed(4),
            remaining: +SF.hitstop._remaining.toFixed(4),
            dur: +SF.hitstop._dur.toFixed(4),
            // Cumulative GAME seconds. The camera punch decays through
            // `expDamp(punch, 0, 20, dt)` on the GAME dt (camera.js:297), so
            // its decay is a function of game time and NOTHING else -- the
            // only reading of "decays within 0.4 s" that survives a machine
            // running 44 concurrent Chromes at 1 fps.
            gameT: +(g).toFixed(4),
            pitch: +SF.rig.punchPitch.toFixed(5),
            yaw: +SF.rig.punchYaw.toFixed(5),
            kills: SF.hitstop.stats.triggers.kill,
        });
        pw = w; pg = g;
        if (!stop) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);

    await frames(4);
    // Cast in the post-endFrame window so the kill event cannot be cleared
    // before hitstop.update() of the next frame reads it.
    await afterFrame(() => SF.spells.cast(7));
    await gameWait(1.4);
    stop = true;

    return {
        tier, killTriggers: SF.hitstop.stats.triggers.kill - k0,
        rejected: SF.hitstop.stats.rejected - rej0,
        dead: reg.slot(id) < 0 || reg.hp[reg.slot(id)] <= 0,
        rows,
    };
})()"""

# ------------------------------------------------------------------- B flinch
B_FLINCH = """(async () => {""" + PRE + """
    clearBodies();
    await frames(3);
    const lvl = SF.progression.level;
    const id = SF.combat.enemies.spawn('glacierBrute',
        C.position.x + 5, C.position.z, lvl);
    if (id < 0) return { err: 'spawn ' + id };
    await gameWait(1.0);           // let the body stream in and bind a mesh
    const s0 = reg.slot(id);
    if (s0 < 0) return { err: 'no slot' };
    const es = enemySlot(id);
    if (es < 0) return { err: 'no enemy slot' };
    const V = SF.combat.enemies.vis;
    const inst = V._slotInst ? V._slotInst[es] : null;
    if (!inst) return { err: 'no vis instance for slot ' + es };
    const CL_HIT = 3;
    const clipName = inst.acts[CL_HIT] ? inst.acts[CL_HIT].getClip().name : null;
    if (!inst.acts[CL_HIT]) return { err: 'no hit action', acts: inst.acts.length };

    const before = {
        visFlinch: V.flinch[es],
        enemyFlinchT: SF.combat.enemies.flinchT[es],
        weight: inst.acts[CL_HIT].getEffectiveWeight(),
    };

    // 30 damage: over FLINCH_MIN_DMG (20). Applied post-endFrame so the hit
    // event reaches enemies.update's drain instead of being cleared under it.
    const tHit = reg.time;
    await afterFrame(() => reg.damage(id, 30, {}));

    // Poll for the channel to rise; record when it did, in GAME seconds.
    // Latency is recorded in FRAMES as well as seconds. Seconds alone are a
    // frame-rate reading: `main.js` clamps dt at MAX_FRAME_MS, so on a machine
    // stalled to 1 fps one frame IS 100 ms of game time and a two-frame
    // pipeline delay reports as 0.2 s that has nothing to do with the system.
    let rose = -1, roseFrame = -1, samples = [];
    for (let k = 0; k < 40; k++) {
        await frames(1);
        const f = V.flinch[es];
        const a = inst.acts[CL_HIT];
        samples.push({
            frame: k + 1,
            t: +(reg.time - tHit).toFixed(3),
            flinch: +f.toFixed(3),
            w: +a.getEffectiveWeight().toFixed(3),
            aTime: +a.time.toFixed(3),
            running: a.isRunning(),
        });
        if (rose < 0 && f > 0.001) { rose = reg.time - tHit; roseFrame = k + 1; }
        if (reg.time - tHit > 0.45) break;
    }
    const peak = samples.reduce((m, r) => r.w > m.w ? r : m, samples[0]);
    return {
        clipName, before, roseAfterS: rose < 0 ? null : +rose.toFixed(3),
        roseAfterFrames: roseFrame,
        peakWeight: peak.w, peakAtS: peak.t, peakActionTime: peak.aTime,
        samples: samples.slice(0, 24),
    };
})()"""

# ------------------------------------------------------------------ D hurt fx
D_HURT = """(async () => {""" + PRE + """
    clearBodies();
    C.health = C.healthMax;
    await frames(3);
    const fx = SF.hurtFx;
    const vig = fx._vig;
    const lvl = SF.progression.level;
    // Right on top of the player so its melee reach lands quickly.
    const ids = [];
    for (let k = 0; k < 3; k++) {
        const a = k * 2.1;
        const id = SF.combat.enemies.spawn('rimeImp',
            C.position.x + Math.cos(a) * 1.6,
            C.position.z + Math.sin(a) * 1.6, lvl);
        if (id >= 0) ids.push(id);
    }
    if (!ids.length) return { err: 'no spawns' };
    await gameWait(0.3);
    // Wake them (the brief's contract for a fresh spawn).
    await afterFrame(() => { for (const id of ids) reg.damage(id, 1, {}); });

    const hp0 = C.health;
    let peakOp = 0, opAtPeak = -1, hitAt = -1, hpAtHit = hp0;
    const trail = [];
    const t0 = reg.time;
    for (let k = 0; k < 900; k++) {
        await frames(1);
        const op = parseFloat(vig.style.opacity || '0') || 0;
        if (op > peakOp) { peakOp = op; opAtPeak = reg.time - t0; }
        if (hitAt < 0 && C.health < hp0 - 0.001) {
            hitAt = reg.time - t0; hpAtHit = C.health;
        }
        if (hitAt >= 0) trail.push(+op.toFixed(3));
        if (hitAt >= 0 && reg.time - t0 - hitAt > 1.6) break;
        if (reg.time - t0 > 25) break;
    }
    const shown = fx._show;
    const decayed = trail.length ? trail[trail.length - 1] : null;

    // Low-hp state: the class is edge-toggled off the same health poll.
    const lowBefore = fx.el.classList.contains('low');
    C.health = C.healthMax * 0.25;
    await frames(4);
    const lowAfter = fx.el.classList.contains('low');
    C.health = C.healthMax * 0.80;
    await frames(4);
    const lowCleared = fx.el.classList.contains('low');
    C.health = C.healthMax;
    return {
        shown, hitAtS: hitAt < 0 ? null : +hitAt.toFixed(2),
        dmgTaken: +(hp0 - hpAtHit).toFixed(2),
        peakOpacity: peakOp, peakAtS: +opAtPeak.toFixed(3),
        opacityAfterDecay: decayed,
        trailHead: trail.slice(0, 12),
        lowBefore, lowAt25pct: lowAfter, lowStillOnAt80pct: lowCleared,
        angleDeg: fx._lastAngleDeg,
    };
})()"""

# -------------------------------------------------------------------- E motes
E_MOTES = """(async () => {""" + PRE + """
    clearBodies();
    const M = SF.motes;
    M.clear();
    M._acc = 0;
    M.stats.spawned = 0; M.stats.picked = 0; M.stats.healed = 0;
    C.health = C.healthMax;
    await frames(3);

    const lvl = SF.progression.level;
    const ids = [], tiers = [];
    for (let k = 0; k < 8; k++) {
        const a = k * 0.78;
        const id = SF.combat.enemies.spawn('rimeImp',
            C.position.x + Math.cos(a) * (6 + k * 0.4),
            C.position.z + Math.sin(a) * (6 + k * 0.4), lvl);
        if (id >= 0) ids.push(id);
    }
    await gameWait(0.5);
    for (const id of ids) { const s = reg.slot(id); if (s >= 0) tiers.push(reg.tier[s]); }

    // Kill them all in ONE post-endFrame window: eight kill events sit in the
    // ring together and motes.update drains the lot on the next frame.
    await afterFrame(() => { for (const id of ids) reg.damage(id, 99999, {}); });
    await gameWait(0.5);

    const spawned = M.stats.spawned;
    const active = M.stats.active;

    // ---- pickup: stand on the first live mote ---------------------------
    let mi = -1;
    for (let i = 0; i < M.alive.length; i++) if (M.alive[i]) { mi = i; break; }
    let pickup = null;
    if (mi >= 0) {
        C.health = C.healthMax * 0.5;
        const hpBefore = C.health;
        const mx = M.x[mi], mz = M.z[mi];
        const picked0 = M.stats.picked;
        // Teleport onto it; the drift+pickup test runs on the next updates.
        await afterFrame(() => {
            C.position.x = mx; C.position.z = mz;
            C.position.y = SF.terrain.heightAt(mx, mz);
            if (C.velocity) C.velocity.set(0, 0, 0);
        });
        await gameWait(0.8);
        pickup = {
            hpBefore: +hpBefore.toFixed(2),
            hpAfter: +C.health.toFixed(2),
            gained: +(C.health - hpBefore).toFixed(2),
            expected: +(C.healthMax * 0.10).toFixed(2),
            consumed: M.stats.picked - picked0,
            activeAfter: M.stats.active,
        };
    }
    return {
        killed: ids.length, tiers,
        spawnedMotes: spawned, activeMotes: active,
        accAfter: +M._acc.toFixed(3),
        specRate: 0.35, expected: +(ids.length * 0.35).toFixed(2),
        pickup, healFrac: 0.10,
    };
})()"""

# --------------------------------------------------------------- F aim assist
# One strafer, driven on the GAME clock so its measured velocity is exactly
# 3 m/s in the same time base `spellHits._trackVelocity` differences against.
F_ASSIST = """(async (ASSIST) => {""" + PRE + """
    clearBodies();
    await frames(3);
    const SPEED = 21;                    // spellSystem BOLT_SPEED
    const STRAFE = 3.0;                  // m/s, the brief's strafer
    const RANGE = 12.0;                  // m from the muzzle
    const SH = SF.combat.spellHits;
    SH.assistEnabled = ASSIST;

    const px = C.position.x, pz = C.position.z;
    const py = SF.terrain.heightAt(px, pz);
    // Body 12 m along -Z, strafing along +X. hp huge: it must survive 10 bolts.
    let bx = px, bz = pz - RANGE;
    const id = reg.register({
        x: bx, y: SF.terrain.heightAt(bx, bz), z: bz,
        radius: 0.45, height: 1.7, tier: 0, level: 10,
        hp: 1e7, poiseMax: 1e7, name: 'strafer', kind: 'enemy',
    });
    if (id < 0) return { err: 'register failed' };

    // Drive it ANALYTICALLY off the game clock: a triangle wave of slope
    // +-STRAFE. Integrating `bx += STRAFE*dt` instead would move the body by
    // frame N's dt while `spellHits._trackVelocity` divides by frame N+1's dt
    // -- and with frames ranging 8 ms to 150 ms on this machine that ratio
    // alone made a constant 3 m/s strafe measure anywhere from 1.0 to 4.1 m/s.
    // A closed form makes the difference between ANY two samples exactly
    // STRAFE * dt, which is what the estimator is entitled to assume.
    const AMP = 4.5, PERIOD = 4 * AMP / STRAFE;   // s for a full there-and-back
    const t0drive = reg.time;
    const triangle = (t) => {
        const u = ((t - t0drive) % PERIOD + PERIOD) % PERIOD;
        const q = u / PERIOD;                     // 0..1
        return q < 0.25 ? q * 4 * AMP
             : q < 0.75 ? AMP * 2 - q * 4 * AMP
             : q * 4 * AMP - AMP * 4;
    };
    // The body's TRUE signed x-velocity right now: the triangle's current
    // slope. Exact, because the wave is a closed form of game time.
    const trueVx = () => {
        const u = ((reg.time - t0drive) % PERIOD + PERIOD) % PERIOD;
        const q = u / PERIOD;
        return (q < 0.25 || q >= 0.75) ? STRAFE : -STRAFE;
    };
    let driving = true;
    const drive = () => {
        bx = px + triangle(reg.time);
        const s = reg.slot(id);
        if (s >= 0) reg.move(id, bx, SF.terrain.heightAt(bx, bz), bz);
        if (driving) requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
    await gameWait(0.8);                 // let the velocity filter converge

    const muzzleY = py + 1.2;
    const shots = [];
    for (let k = 0; k < 10; k++) {
        if (reg.slot(id) < 0) break;
        // Aim AND fire in the same post-endFrame window: the aim must be the
        // body's position at the instant of the shot, or the probe is quietly
        // measuring its own one-frame lag instead of the assist.
        const r = await afterFrame(() => {
            const s = reg.slot(id);
            if (s < 0) return null;
            let ax = reg.x[s] - px;
            let ay = (reg.y[s] + reg.height[s] * 0.55) - muzzleY;
            let az = reg.z[s] - pz;
            const al = Math.hypot(ax, ay, az);
            ax /= al; ay /= al; az /= al;
            const before = SH.assistStats.snapped;
            // GROUND TRUTH INJECTION. `_trackVelocity` differences the
            // registry once per GAME frame, but this probe moves the body
            // from its own rAF chain -- and on a machine at 3 fps with 40+
            // sibling Chromes, that chain occasionally misses a frame, so a
            // 2-frame position delta gets divided by a 1-frame dt and a
            // constant 3 m/s strafe measures 6. That is scaffolding noise,
            // not engine behaviour (the real mover integrates INSIDE the
            // frame). Overwriting the estimate with the analytic truth for
            // the instant of the shot isolates what phase F is actually for:
            // whether the INTERCEPT + CAP aim where the body will be.
            // `estimatorErr` below reports the estimator on its own.
            const estV = Math.hypot(SH._vX[s], SH._vZ[s]);
            SH._vX[s] = trueVx(); SH._vZ[s] = 0;
            const slot = SF.spells.bolt.fire(px, muzzleY, pz, ax, ay, az,
                                             SPEED, 40, 0, 1);
            const P = SF.spells.bolt;
            let bend = 0;
            if (slot >= 0) {
                const c = Math.max(-1, Math.min(1,
                    (P.vx[slot] * ax + P.vy[slot] * ay + P.vz[slot] * az)
                    / SPEED));
                bend = +(Math.acos(c) * 180 / Math.PI).toFixed(3);
            }
            // ---- ANALYTIC closest approach, exact and frame-rate free -----
            // The assist is a LAUNCH-ONLY system: nothing homes afterwards,
            // so the whole of its quality is in the heading that left the
            // muzzle. Bolt B(t) = O + D*SPEED*t; body P(t) = P0 + V*t, with V
            // the body's TRUE analytic velocity. Relative motion is linear,
            // so the closest approach has a closed form -- no sampling, and
            // therefore nothing for a 3 fps machine to corrupt.
            const P2 = SF.spells.bolt;
            let approach = null, tStar = null;
            if (slot >= 0) {
                const wx = trueVx() - P2.vx[slot];
                const wy = 0 - P2.vy[slot];
                const wz = 0 - P2.vz[slot];
                const r0x = reg.x[s] - px;
                const r0y = reg.y[s] + reg.height[s] * 0.55 - muzzleY;
                const r0z = reg.z[s] - pz;
                const ww = wx * wx + wy * wy + wz * wz;
                let t = ww > 1e-9
                    ? -(r0x * wx + r0y * wy + r0z * wz) / ww : 0;
                if (t < 0) t = 0;
                approach = +Math.hypot(r0x + wx * t, r0y + wy * t,
                                       r0z + wz * t).toFixed(3);
                tStar = +t.toFixed(3);
            }
            return {
                hp0: reg.hp[s], slot, bendDeg: bend,
                trueV: +trueVx().toFixed(3),
                estimatorV: +estV.toFixed(3),
                estimatorErr: +(estV - Math.abs(trueVx())).toFixed(3),
                needDeg: +(Math.atan(Math.abs(trueVx()) / SPEED)
                           * 180 / Math.PI).toFixed(2),
                rangeM: +al.toFixed(2),
                analyticApproachM: approach, interceptAtS: tStar,
                snapped: SH.assistStats.snapped - before,
            };
        });
        if (!r) break;
        // Track the bolt's CLOSEST APPROACH using the engine's own criterion:
        // damageable.js `segmentHit` measures the swept segment (prev -> cur)
        // against the body's vertical axis segment, and hits when that is
        // within radius + padRadius. Sampling it here gives a continuous miss
        // distance in metres -- an instrument that still means something when
        // the machine is at 1 fps and the binary hit becomes a coin flip on
        // frame quantisation.
        const HITR = 0.45 + 0.205;
        let minD = Infinity, travelled = 0, lastAgl = null;
        if (r.slot >= 0) {
            const P = SF.spells.bolt;
            for (let f = 0; f < 400; f++) {
                await frames(1);
                if (!P.alive[r.slot]) break;
                const s = reg.slot(id);
                if (s < 0) break;
                // How far the bolt got, and how high it was above the snow.
                // A nearly horizontal 13 m shot launched 1.2 m up crosses
                // real terrain relief, and dart.update() terminates a bolt
                // that meets the ground -- which would suppress ON and OFF
                // alike and has nothing to do with the assist.
                travelled = Math.hypot(P.x[r.slot] - px, P.y[r.slot] - muzzleY,
                                       P.z[r.slot] - pz);
                lastAgl = +(P.y[r.slot]
                    - SF.terrain.heightAt(P.x[r.slot], P.z[r.slot])).toFixed(3);
                const x0 = P.px[r.slot], y0 = P.py[r.slot], z0 = P.pz[r.slot];
                const x1 = P.x[r.slot], y1 = P.y[r.slot], z1 = P.z[r.slot];
                const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
                const len2 = dx * dx + dy * dy + dz * dz;
                const cx = reg.x[s], cz = reg.z[s];
                const cy0 = reg.y[s], cy1 = reg.y[s] + reg.height[s];
                let t = len2 > 1e-9
                    ? ((cx - x0) * dx
                       + (Math.min(Math.max(y0, cy0), cy1) - y0) * dy
                       + (cz - z0) * dz) / len2 : 0;
                t = Math.min(1, Math.max(0, t));
                const qx = x0 + dx * t, qy = y0 + dy * t, qz = z0 + dz * t;
                const ry = Math.min(Math.max(qy, cy0), cy1);
                const d = Math.hypot(qx - cx, qy - ry, qz - cz);
                if (d < minD) minD = d;
            }
        }
        const s2 = reg.slot(id);
        const hp1 = s2 >= 0 ? reg.hp[s2] : 0;
        r.hit = hp1 < r.hp0 - 1e-6;
        r.dmg = +(r.hp0 - hp1).toFixed(2);
        r.sampledApproachM = minD === Infinity ? null : +minD.toFixed(3);
        r.travelledM = +travelled.toFixed(2);
        r.lastAglM = lastAgl;
        r.hitRadiusM = HITR;
        delete r.hp0; delete r.slot;
        shots.push(r);
        await gameWait(0.15);
    }

    // ---- the arc must NOT be bent ---------------------------------------
    // (1) a carrier fired straight through the same pool, own === 1.
    let carrier = null;
    await afterFrame(() => {
        const s = reg.slot(id);
        if (s < 0) return;
        let ax = reg.x[s] - px, ay = 0, az = reg.z[s] - pz;
        const al = Math.hypot(ax, ay, az); ax /= al; az /= al;
        const slot = SF.spells.bolt.fire(px, muzzleY, pz, ax, ay, az,
                                         SPEED, 8, 1, 0.85);
        if (slot >= 0) {
            const P = SF.spells.bolt;
            carrier = {
                inDx: +ax.toFixed(6), inDz: +az.toFixed(6),
                outDx: +(P.vx[slot] / SPEED).toFixed(6),
                outDz: +(P.vz[slot] / SPEED).toFixed(6),
            };
        }
    });
    // (2) the arc CONE itself: spellSystem records the flat cast direction and
    //     spellHits resolves it with forEachInCone -- it never touches the
    //     bolt pool's heading at all.
    let cone = null;
    await afterFrame(() => {
        const s = reg.slot(id);
        let ax = reg.x[s] - px, az = reg.z[s] - pz;
        const al = Math.hypot(ax, az); ax /= al; az /= al;
        SF.spells.aim.set(ax, 0, az);
        const g0 = SF.spells.arcGen;
        SF.spells.cast(7);
        cone = { fired: SF.spells.arcGen !== g0,
                 aimX: +ax.toFixed(6), aimZ: +az.toFixed(6),
                 arcDirX: +SF.spells.arcDirX.toFixed(6),
                 arcDirZ: +SF.spells.arcDirZ.toFixed(6) };
    });

    driving = false;
    const s = reg.slot(id);
    if (s >= 0) reg.remove(id);
    SH.assistEnabled = true;
    const hits = shots.filter((r) => r.hit).length;
    return {
        assist: ASSIST, shots: shots.length, hits,
        maxBendDeg: shots.reduce((m, r) => Math.max(m, r.bendDeg), 0),
        // The cap spellHits derives for THIS projectile speed: atan(5/speed),
        // the COMBAT_DESIGN:552 drifting-dummy anchor.
        capDeg: +(Math.atan(5 / SPEED) * 180 / Math.PI).toFixed(3),
        detail: shots, carrier, cone,
        assistStats: JSON.parse(JSON.stringify(SH.assistStats)),
    };
})"""


def shot(pg, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    p = SHOTS / f"feel_{name}.png"
    pg.screenshot(path=str(p))
    print(f"    shot -> {p}")
    return p


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False,
                                    args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            # Phases D and F run tens of GAME seconds; at this machine's 6-7 fps
            # ultra frame rate that is minutes of wall clock. The 30 s default
            # would abort a healthy run and read as a failure.
            pg.set_default_timeout(900_000)
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180_000)
            pg.wait_for_timeout(2500)

            out["setup"] = pg.evaluate(SETUP)
            print("SETUP      ", json.dumps(out["setup"]))

            print("\n== A/C  HIT-STOP + CAMERA PUNCH ==")
            a = pg.evaluate(A_HITSTOP)
            out["hitstop"] = a
            if "err" in a:
                print("   ERR", a["err"])
            else:
                rows = a["rows"]
                # A DILATED frame is one whose own game/wall ratio fell -- not
                # one whose trailing `scaleForNext` was low (see the sampler).
                dip = [r for r in rows if r["ratio"] < 0.9]
                print(f"   tier={a['tier']} killTriggers={a['killTriggers']} "
                      f"rejected={a['rejected']} dead={a['dead']}")
                print(f"   frames sampled={len(rows)}  dilated frames={len(dip)}")
                if dip:
                    ms = sum(r["wall"] for r in dip)
                    print(f"   stop WALL span={ms:.1f} ms   (cap 90 ms)")
                    print(f"   min game/wall ratio={min(r['ratio'] for r in dip):.4f}"
                          f"   min game dt={min(r['game'] for r in dip):.4f} ms"
                          f"   (dt==0 sentinel must never be reached)")
                    print(f"   max envelope hitstop._dur="
                          f"{max(r['dur'] for r in rows)*1000:.1f} ms   "
                          f"max _remaining="
                          f"{max(r['remaining'] for r in rows)*1000:.1f} ms")
                    i = rows.index(dip[0])
                    for r in rows[max(0, i - 2):i + 6]:
                        print("     ", json.dumps(r))
                pk = max((abs(r["pitch"]) for r in rows), default=0)
                yk = max((abs(r["yaw"]) for r in rows), default=0)
                print(f"   punch peak |pitch|={pk:.5f} |yaw|={yk:.5f}")
                # Two thresholds. camera.js snaps the punch to a hard 0 below
                # 1e-4, which off a 0.07 peak is 0.14% -- long past visible.
                # The decay that matters is the one the eye reads, so 5% of
                # peak is reported alongside the absolute-zero time.
                nz = [i for i, r in enumerate(rows)
                      if abs(r["pitch"]) > 1e-4 or abs(r["yaw"]) > 1e-4]
                if nz:
                    p0 = nz[0]
                    g0 = rows[p0]["gameT"]
                    five = [i for i in range(p0, len(rows))
                            if abs(rows[i]["pitch"]) <= pk * 0.05]
                    zero = [i for i in range(p0, len(rows))
                            if abs(rows[i]["pitch"]) <= 1e-4]
                    if five:
                        print(f"   punch under 5% of peak after "
                              f"{(rows[five[0]]['gameT'] - g0) * 1000:.0f} ms "
                              f"GAME time  (target 400 ms)")
                    if zero:
                        print(f"   punch at hard zero after "
                              f"{(rows[zero[0]]['gameT'] - g0) * 1000:.0f} ms "
                              f"GAME time")
                    print(f"   [frame rate during phase A: "
                          f"{1000 / (sum(r['wall'] for r in rows) / len(rows)):.1f}"
                          f" fps -- wall-clock spans are only meaningful above "
                          f"~30 fps]")
                shot(pg, "hitstop_mid")

            print("\n== B  ENEMY FLINCH ==")
            b = pg.evaluate(B_FLINCH)
            out["flinch"] = b
            if "err" in b:
                print("   ERR", json.dumps(b))
            else:
                print(f"   clip[3]={b['clipName']!r}  before={json.dumps(b['before'])}")
                print(f"   channel rose after {b['roseAfterS']} s "
                      f"= {b['roseAfterFrames']} FRAMES "
                      f"(the frame-rate-free number; damage lands post-"
                      f"endFrame, enemies.update drains the ring next frame)")
                print(f"   peak weight={b['peakWeight']} at t={b['peakAtS']} s "
                      f"actionTime={b['peakActionTime']} s")
                for r in b["samples"][:8]:
                    print("     ", json.dumps(r))
                shot(pg, "flinch_brute")

            print("\n== D  HURT FX ==")
            d = pg.evaluate(D_HURT)
            out["hurt"] = d
            if "err" in d:
                print("   ERR", json.dumps(d))
            else:
                print("   " + json.dumps({k: v for k, v in d.items()
                                          if k != "trailHead"}))
                print("   opacity trail:", d["trailHead"])
                shot(pg, "hurt_vignette")

            print("\n== E  MOTES ==")
            e = pg.evaluate(E_MOTES)
            out["motes"] = e
            print("   " + json.dumps(e))
            shot(pg, "motes_killsite")

            print("\n== F  AIM ASSIST ==")
            on = pg.evaluate(F_ASSIST, True)
            off = pg.evaluate(F_ASSIST, False)
            out["assist_on"], out["assist_off"] = on, off
            for tag, r in (("ON ", on), ("OFF", off)):
                if "err" in r:
                    print(f"   {tag} ERR", r["err"])
                    continue
                need = max((s["needDeg"] for s in r["detail"]), default=0)
                an = [s["analyticApproachM"] for s in r["detail"]
                      if s.get("analyticApproachM") is not None]
                agood = sum(1 for a in an if a <= 0.655)
                print(f"   {tag} maxBend={r['maxBendDeg']} deg  "
                      f"leadNeeded={need} deg  (derived cap "
                      f"{r['capDeg']:.2f} deg)")
                if an:
                    print(f"       PRIMARY -- analytic closest approach of the "
                          f"launch heading (exact, frame-rate free):")
                    print(f"         median={sorted(an)[len(an)//2]:.3f} m  "
                          f"min={min(an):.3f} m  max={max(an):.3f} m"
                          f"   (hit radius 0.655 m)")
                    print(f"         WOULD HIT: {agood}/{len(an)}")
                print(f"       engine binary hits (frame-rate limited, see "
                      f"phase A fps): {r['hits']}/{r['shots']}")
                est = [abs(s["estimatorErr"]) for s in r["detail"]]
                if est:
                    print(f"       estimator |err| vs 3.000 m/s truth: "
                          f"median={sorted(est)[len(est)//2]:.3f}  "
                          f"max={max(est):.3f} m/s")
                print(f"       detail={json.dumps(r['detail'])}")
            if "carrier" in on and on["carrier"]:
                print("   arc carrier (own=1):", json.dumps(on["carrier"]))
            if "cone" in on and on["cone"]:
                print("   arc cone:", json.dumps(on["cone"]))

            print("\npageerrors:", errs)
            out["pageErrors"] = errs
            br.close()
    finally:
        srv.terminate()

    p = HERE / "qa_feel.out.json"
    p.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"\nwrote {p}")


if __name__ == "__main__":
    main()

// core/sim/grenades.js [A1] — frag grenade physics (R6: grenades SHIP;
// combat_spec §5.9). 3.8 s fuse (cook shortens it — the fuse runs from the
// pin, player.js owns the cook), bounce physics, damage 110 → 15 at 5.5 m
// linear, 25% through `hard` cover. Emits the R13-amended `grenade` and
// `explosion` events only. THREE-free; internal to sim.
// Frozen export name stepGrenades(sim, world, dt) kept; private exports
// spawnGrenade/detonateAt/GRENADE added (A5's bot eligibility calls
// spawnGrenade; bot v0 = 16 m/s, player 22 m/s — the CALLER sets velocity).

import { applyDamage } from "./damage.js";
import { hasPerk, PERK_FX } from "./classes.js";
import { blastEquipment } from "./equipment.js"; // [equipment lane] blasts clear tripmines

export const GRENADE = {
  FUSE_S: 3.8,
  RADIUS_M: 5.5,
  DMG_CENTER: 110,
  DMG_EDGE: 15,
  THROUGH_HARD: 0.25,
  GRAV: -20,
  RESTITUTION: 0.35,
  TANGENT_FRICTION: 0.7,
  REST_SPEED: 0.8,
  BOT_THROW_V: 16,
  PLAYER_THROW_V: 22,
};

// who: 'P' | botId. origin [3], vel [3] m/s, fuseLeft seconds (cook-reduced).
export function spawnGrenade(sim, who, origin, vel, fuseLeft = GRENADE.FUSE_S) {
  const g = {
    who,
    pos: origin.slice(),
    vel: vel.slice(),
    fuseLeft: Math.max(0.05, fuseLeft),
    bounced: false,
    landed: false,
  };
  sim.internal.grenades.push(g);
  sim.emit("grenade", { phase: "out", who, pos: g.pos.slice() });
  return g;
}

// Immediate detonation helper (cooked-in-hand, drum chains — source knows why).
// `opts` (kill-streak call-ins, streaks.js): {radius, dmgCenter, dmgEdge, noSelf}
// override the frag numbers; noSelf spares the caller ("P") from their own strike.
// [heavy weapons] opts.weaponId names the kill on the death event (the Anvil's
// rocket: "anvil"); opts.quiet skips the frag-only `grenade` detonate phase.
export function detonateAt(sim, who, pos, source = "grenade", opts = null) {
  explode(sim, who, pos, source, opts);
}

function explode(sim, who, pos, source, opts) {
  const R = (opts && opts.radius) || GRENADE.RADIUS_M;
  const dC = (opts && opts.dmgCenter != null) ? opts.dmgCenter : GRENADE.DMG_CENTER;
  const dE = (opts && opts.dmgEdge != null) ? opts.dmgEdge : GRENADE.DMG_EDGE;
  const noSelf = !!(opts && opts.noSelf);
  const meta = opts && opts.weaponId ? { weaponId: opts.weaponId } : null;
  if (!(opts && opts.quiet)) sim.emit("grenade", { phase: "detonate", who, pos: pos.slice() });
  // `who` rides the explosion additively (challenge / killcam attribution without
  // depending on a preceding grenade:detonate)
  sim.emit("explosion", { pos: pos.slice(), radius: R, source, who });
  const world = sim.world;
  const hardOnly = (box) => (box.matClass || "hard") === "hard";

  const applyTo = (victim, vpos, stance, body) => {
    if (noSelf && victim === who) return;
    const chest = [vpos[0], vpos[1] + (stance === "crouch" ? 0.8 : 1.1), vpos[2]];
    const d = Math.hypot(chest[0] - pos[0], chest[1] - pos[1], chest[2] - pos[2]);
    if (d > R) return;
    let dmg = dC + (dE - dC) * (d / R);
    // §5.9: through `hard` cover 25% (crouching behind full cover survives)
    if (world.losBlocked(pos, chest, hardOnly)) dmg *= GRENADE.THROUGH_HARD;
    // BLAST WEAVE perk (class matches): frags, cooks AND call-in strikes
    if (hasPerk(body, "flak")) dmg *= PERK_FX.flak.explosiveMult;
    if (dmg > 0.5) applyDamage(sim, victim, dmg, who, "body", "grenade", meta);
  };

  const p = sim.state.player;
  if (p.alive) applyTo("P", p.pos, p.stance, p);
  for (const b of sim.state.bots) {
    if (b.alive) applyTo(b.id, b.pos, b.stance, b);
  }
  // [equipment lane] tripmines inside half the blast radius are destroyed
  if (sim.internal.equip) blastEquipment(sim, pos, R * 0.5, who);
}

// ===================================================================== ROCKETS
// [heavy weapons] KR-5 Anvil. A rocket is a straight, fast, slightly dropping
// projectile that detonates on the first wall / body it meets, through explode()
// above — same falloff, same 25%-through-hard-cover rule, same BLAST WEAVE
// multiplier, self-damage ON (the shooter is not spared). Inside `armM` of the
// muzzle it has not armed: a DUD that clanks off (grenade:bounce — reused vocab,
// the puff + knock the view already draws) and only bruises a body it strikes.
// Deterministic: no rng is drawn. List: sim.internal.rockets (the view reads it).
const ROCKET_R = 0.42;            // body hit radius around the capsule axis
export function spawnRocket(sim, who, weaponId, weapon, origin, dir) {
  const sp = (weapon && weapon.splash) || {};
  const speed = sp.speed || weapon.muzzleVel || 50;
  const list = sim.internal.rockets || (sim.internal.rockets = []);
  const r = {
    who, weaponId,
    pos: origin.slice(), origin: origin.slice(),
    vel: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
    age: 0, traveled: 0,
    splash: {
      radius: sp.radius || 6, dmgCenter: sp.dmgCenter != null ? sp.dmgCenter : 150,
      dmgEdge: sp.dmgEdge != null ? sp.dmgEdge : 20, armM: sp.armM != null ? sp.armM : 3,
      gravity: sp.gravity != null ? sp.gravity : -2.4, lifeS: sp.lifeS || 3.6, duddmg: sp.duddmg || 40,
    },
  };
  list.push(r);
  return r;
}

// closest body (not the shooter) whose capsule the segment a->a+d*len passes
// within ROCKET_R of; returns {id, t} (t = metres along the segment) or null
function rocketBodyHit(sim, r, d, len) {
  let best = null;
  const S = sim.state;
  const test = (id, pos, stance) => {
    if (id === r.who) return;
    const top = pos[1] + (stance === "crouch" ? 1.25 : 1.8);
    const n = Math.max(2, Math.ceil(len / 0.2));
    for (let i = 0; i <= n; i++) {
      const t = (len * i) / n;
      const x = r.pos[0] + d[0] * t, y = r.pos[1] + d[1] * t, z = r.pos[2] + d[2] * t;
      if (y < pos[1] - 0.05 || y > top + 0.1) continue;
      if (Math.hypot(x - pos[0], z - pos[2]) <= ROCKET_R) {
        if (!best || t < best.t) best = { id, t };
        return;
      }
    }
  };
  if (S.player.alive) test("P", S.player.pos, S.player.stance);
  for (const b of S.bots) if (b.alive) test(b.id, b.pos, b.stance);
  return best;
}

export function stepRockets(sim, world, dt) {
  const list = sim.internal.rockets;
  if (!list || !list.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    const sp = r.splash;
    r.age += dt;
    r.vel[1] += sp.gravity * dt;
    const speed = Math.hypot(r.vel[0], r.vel[1], r.vel[2]) || 1e-6;
    const d = [r.vel[0] / speed, r.vel[1] / speed, r.vel[2] / speed];
    const step = speed * dt;
    const wh = world.raycast(r.pos, d, step);
    const wallT = wh && wh.dist <= step ? wh.dist : Infinity;
    const bh = rocketBodyHit(sim, r, d, Math.min(step, wallT));
    const hitT = bh ? bh.t : wallT;
    const expired = r.age >= sp.lifeS;
    if (hitT === Infinity && !expired) {
      r.pos[0] += d[0] * step; r.pos[1] += d[1] * step; r.pos[2] += d[2] * step;
      r.traveled += step;
      continue;
    }
    const t = hitT === Infinity ? 0 : hitT;
    // stop a hand's width short of the surface so the blast's cover rays start in the open
    const back = bh ? 0 : Math.min(t, 0.12);
    const at = [r.pos[0] + d[0] * (t - back), r.pos[1] + d[1] * (t - back), r.pos[2] + d[2] * (t - back)];
    list.splice(i, 1);
    if (r.traveled + t < sp.armM && !expired) {
      // not armed yet: a dud — no blast, a knock on whatever it struck
      if (bh) applyDamage(sim, bh.id, sp.duddmg, r.who, "body", "grenade", { weaponId: r.weaponId });
      sim.emit("grenade", { phase: "bounce", who: r.who, pos: at });
      continue;
    }
    explode(sim, r.who, at, "rocket", {
      radius: sp.radius, dmgCenter: sp.dmgCenter, dmgEdge: sp.dmgEdge, weaponId: r.weaponId, quiet: true,
    });
  }
}

// Frozen stub signature. Ticked in tick-order slot 5 (with projectiles).
export function stepGrenades(sim, world, dt) {
  stepRockets(sim, world, dt); // [heavy weapons] the Anvil's rockets ride the same tick slot
  const list = sim.internal.grenades;
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    g.fuseLeft -= dt;
    if (g.fuseLeft <= 0) {
      explode(sim, g.who, g.pos, "grenade");
      list.splice(i, 1);
      continue;
    }
    // integrate with bounce
    g.vel[1] += GRENADE.GRAV * dt;
    const speed = Math.hypot(g.vel[0], g.vel[1], g.vel[2]);
    if (speed > 0.01) {
      const step = speed * dt;
      const dir = [g.vel[0] / speed, g.vel[1] / speed, g.vel[2] / speed];
      const hit = world.raycast(g.pos, dir, step + 0.08);
      if (hit && hit.dist <= step + 0.08) {
        // reflect off the entry face
        const n = hit.normal;
        const vDotN = g.vel[0] * n[0] + g.vel[1] * n[1] + g.vel[2] * n[2];
        // decompose: normal component bounces, tangent rubs
        const vn = [n[0] * vDotN, n[1] * vDotN, n[2] * vDotN];
        const vt = [g.vel[0] - vn[0], g.vel[1] - vn[1], g.vel[2] - vn[2]];
        g.vel[0] = vt[0] * GRENADE.TANGENT_FRICTION - vn[0] * GRENADE.RESTITUTION;
        g.vel[1] = vt[1] * GRENADE.TANGENT_FRICTION - vn[1] * GRENADE.RESTITUTION;
        g.vel[2] = vt[2] * GRENADE.TANGENT_FRICTION - vn[2] * GRENADE.RESTITUTION;
        g.pos[0] = hit.pos[0] + n[0] * 0.06;
        g.pos[1] = hit.pos[1] + n[1] * 0.06;
        g.pos[2] = hit.pos[2] + n[2] * 0.06;
        const after = Math.hypot(g.vel[0], g.vel[1], g.vel[2]);
        if (after > 1.0) {
          sim.emit("grenade", { phase: "bounce", who: g.who, pos: g.pos.slice() });
          g.bounced = true;
        } else if (!g.landed && n[1] > 0.5) {
          g.landed = true;
          g.vel[0] = g.vel[1] = g.vel[2] = 0;
          sim.emit("grenade", { phase: "land", who: g.who, pos: g.pos.slice() });
        }
      } else {
        g.pos[0] += g.vel[0] * dt;
        g.pos[1] += g.vel[1] * dt;
        g.pos[2] += g.vel[2] * dt;
      }
    } else if (!g.landed) {
      // resting check — support directly below
      const sup = world.sphereGround(g.pos[0], g.pos[2]);
      if (g.pos[1] - sup < 0.12) {
        g.landed = true;
        sim.emit("grenade", { phase: "land", who: g.who, pos: g.pos.slice() });
      }
    }
  }
}

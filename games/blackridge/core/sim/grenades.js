// core/sim/grenades.js [A1] — frag grenade physics (R6: grenades SHIP;
// combat_spec §5.9). 3.8 s fuse (cook shortens it — the fuse runs from the
// pin, player.js owns the cook), bounce physics, damage 110 → 15 at 5.5 m
// linear, 25% through `hard` cover. Emits the R13-amended `grenade` and
// `explosion` events only. THREE-free; internal to sim.
// Frozen export name stepGrenades(sim, world, dt) kept; private exports
// spawnGrenade/detonateAt/GRENADE added (A5's bot eligibility calls
// spawnGrenade; bot v0 = 16 m/s, player 22 m/s — the CALLER sets velocity).

import { applyDamage } from "./damage.js";

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
export function detonateAt(sim, who, pos, source = "grenade") {
  explode(sim, who, pos, source);
}

function explode(sim, who, pos, source) {
  sim.emit("grenade", { phase: "detonate", who, pos: pos.slice() });
  sim.emit("explosion", { pos: pos.slice(), radius: GRENADE.RADIUS_M, source });
  const world = sim.world;
  const hardOnly = (box) => (box.matClass || "hard") === "hard";

  const applyTo = (victim, vpos, stance) => {
    const chest = [vpos[0], vpos[1] + (stance === "crouch" ? 0.8 : 1.1), vpos[2]];
    const d = Math.hypot(chest[0] - pos[0], chest[1] - pos[1], chest[2] - pos[2]);
    if (d > GRENADE.RADIUS_M) return;
    let dmg = GRENADE.DMG_CENTER + (GRENADE.DMG_EDGE - GRENADE.DMG_CENTER) * (d / GRENADE.RADIUS_M);
    // §5.9: through `hard` cover 25% (crouching behind full cover survives)
    if (world.losBlocked(pos, chest, hardOnly)) dmg *= GRENADE.THROUGH_HARD;
    if (dmg > 0.5) applyDamage(sim, victim, dmg, who, "body", "grenade");
  };

  const p = sim.state.player;
  if (p.alive) applyTo("P", p.pos, p.stance);
  for (const b of sim.state.bots) {
    if (b.alive) applyTo(b.id, b.pos, b.stance);
  }
}

// Frozen stub signature. Ticked in tick-order slot 5 (with projectiles).
export function stepGrenades(sim, world, dt) {
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

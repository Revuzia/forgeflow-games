// core/sim/streaks.js — KILL STREAKS + special attacks + medals, THREE-free.
//
// "We need special attacks for 3 kills in a row, or 5, or 10."
//
// A STREAK is consecutive kills by the human WITHOUT DYING (a death resets the
// count; it never takes away a call-in you already earned). Kills made BY a
// streak (an airstrike's bombs) do not feed the streak — the Call of Duty rule —
// so a lucky strike cannot chain itself to the top.
//
//   3 kills  ->  SIGNAL SWEEP       key 6   a recon drone loiters overhead for 24 s;
//                                           every 2.4 s it sweeps the map and pings
//                                           every living enemy (compass + through-
//                                           wall markers). Information, not damage:
//                                           a UAV-class reward that is not a copy of
//                                           the Call of Duty minimap UAV.
//   5 kills  ->  MORTAR STRIKE      key 7   a 4-shell salvo walked onto the
//                                           spot you are looking at (2.4 s ETA)
//   7 kills  ->  AIRSTRIKE          key 8   a bomb run, 7 bombs in a straight line
//                                           away from you through the target
//   10 kills ->  ORBITAL BARRAGE    key 9   18 heavy rounds saturating a ~20 m
//                                           circle over 5.5 s — clears a courtyard
//
// Earned call-ins sit in a stock (max 2 per type) until used. Using one marks the
// point under your crosshair (or 45 m ahead if you aim at the sky) and the
// strike lands after its delay. Your own call-ins never hurt YOU; in a team match
// the existing friendly-fire gate protects your teammates, so only the enemy
// takes damage.
//
// MEDALS ride the same hook: DOUBLE/TRIPLE/QUAD/MULTI KILL inside a 3.5 s window,
// plus (2026-10-14) HEADSHOT, LONGSHOT (> 40 m), REVENGE (the man who last killed
// you) and FIRST BLOOD (the first kill of the match/mission by anyone, if it is
// yours) — each with its bonus points — plus a score toast per kill. The HUD only
// renders what these events say.
//
// Events (all additive, bridge-visible):
//   streak {phase:"earned", tier, id, name, count, stock}
//   streak {phase:"call",   tier, id, name, target:[3], eta, impacts:n, key}
//   streak {phase:"impact", tier, id, pos:[3], radius, index, of}
//   streak {phase:"sweep",  tier, id, contacts:[{id,pos:[3]}], index, of, endT}   (recon)
//   streak {phase:"done",   tier, id}
//   streak {phase:"denied", tier, reason}              (nothing in stock / dead)
//   medal  {text, sub, kind}                            (HUD banner)
//   score  {points, why, headshot}                       (+100 style popup)
//
// Determinism: only sim time, positions, and a private mulberry32 seeded from the
// activation tick — no shared rng stream is consumed.

import { detonateAt } from "./grenades.js";

export const STREAK_TIERS = [
  { id: "recon", tier: 1, at: 3, key: 6, name: "SIGNAL SWEEP",
    delay: 0.9, duration: 24, period: 2.4 },
  { id: "mortar", tier: 2, at: 5, key: 7, name: "MORTAR STRIKE",
    delay: 2.4, shells: 4, scatter: 4.5, gap: 0.42, radius: 6.0, dmgCenter: 135, dmgEdge: 18 },
  { id: "airstrike", tier: 3, at: 7, key: 8, name: "AIRSTRIKE",
    delay: 3.2, shells: 7, length: 34, gap: 0.22, radius: 6.5, dmgCenter: 150, dmgEdge: 20 },
  { id: "orbital", tier: 4, at: 10, key: 9, name: "ORBITAL BARRAGE",
    delay: 3.6, shells: 18, scatter: 10.0, span: 5.5, radius: 7.5, dmgCenter: 175, dmgEdge: 25 },
];

const MAX_STOCK = 2;
const MULTI_WINDOW_S = 3.5;
const KILL_POINTS = 100;
const HEADSHOT_BONUS = 50;
const MAX_RANGE = 140;

// Where a call-in aimed from (yaw, pitch) lands: first thing under the crosshair
// (pulled back off a wall), else the ground 45 m out; clamped inside the map and
// dropped onto the walkable surface. SHARED with the view (streakfx designator
// preview), so the ring the player confirms is exactly where the strike lands.
export function streakTarget(sim, yaw, pitch) {
  const p = sim.state.player;
  const eye = [p.pos[0], p.pos[1] + (p.stance === "crouch" ? 1.10 : 1.62), p.pos[2]];
  const cp = Math.cos(pitch);
  const dir = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  const hit = sim.world.raycast(eye, dir, MAX_RANGE);
  let target;
  if (hit) {
    target = [hit.pos[0] + hit.normal[0] * 0.6, hit.pos[1] + hit.normal[1] * 0.6, hit.pos[2] + hit.normal[2] * 0.6];
  } else {
    target = [eye[0] + dir[0] * 45, p.pos[1], eye[2] + dir[2] * 45];
  }
  const b = sim.colliders.bounds;
  target[0] = Math.max(b.min[0] + 2, Math.min(b.max[0] - 2, target[0]));
  target[2] = Math.max(b.min[2] + 2, Math.min(b.max[2] - 2, target[2]));
  const y0 = hit ? hit.pos[1] : p.pos[1];
  target[1] = sim.world.supportAt ? sim.world.supportAt(target[0], target[2], y0, 0.3) : sim.world.sphereGround(target[0], target[2]);
  return target;
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeStreaks(sim) {
  const S = sim.state;
  S.streak = {
    count: 0, best: 0,
    stock: STREAK_TIERS.map(() => 0),   // per tier (index = tier-1)
    flights: [],            // call-ins in the air: {tier, plan:[{t,pos}], i, endT}
    medalChain: [],         // kill times inside the multi-kill window
    totalScore: 0,
    nemesis: null,          // id of whoever last killed the player (REVENGE)
    anyKill: false,         // has anyone drawn first blood yet
  };
  const st = S.streak;

  function isEnemyKill(d) {
    if (!d || d.attacker !== "P" || d.victim === "P" || d.victim == null) return false;
    if (sim.match && sim.match.sameTeam && sim.match.sameTeam("P", d.victim)) return false;
    return true;
  }

  function earn(tier, count) {
    const def = STREAK_TIERS[tier - 1];
    if (st.stock[tier - 1] >= MAX_STOCK) return;
    st.stock[tier - 1]++;
    sim.emit("streak", { phase: "earned", tier, id: def.id, name: def.name, count, stock: st.stock[tier - 1], key: def.key });
  }

  // living hostiles, for the recon sweep (match: the roster team rule; campaign:
  // the mirrored team int — every campaign bot is team 1 against the team-0 player)
  function hostiles() {
    const out = [];
    const pt = S.player.team | 0;
    for (const b of S.bots) {
      if (!b || !b.alive) continue;
      if (sim.match && sim.match.sameTeam) { if (sim.match.sameTeam("P", b.id)) continue; }
      else if ((b.team | 0) === pt) continue;
      out.push({ id: b.id, pos: [b.pos[0], b.pos[1], b.pos[2]] });
    }
    return out;
  }

  function medal(text, sub, kind) {
    sim.emit("medal", { text, sub: sub || "", kind: kind || "multi" });
  }

  const MULTI_NAMES = { 2: "DOUBLE KILL", 3: "TRIPLE KILL", 4: "QUAD KILL" };
  const LONGSHOT_M = 40;

  function bonus(points, why, text, kind) {
    st.totalScore += points;
    medal(text, "+" + points, kind);
    sim.emit("score", { points, why, headshot: kind === "headshot" });
  }

  const api = {
    onDeath(simRef, d) {
      void simRef;
      if (!d) return;
      // first blood: the first death anyone CAUSED (no attacker = environment)
      const firstBlood = !st.anyKill && d.attacker != null && d.victim != null && d.attacker !== d.victim;
      if (firstBlood) st.anyKill = true;
      if (d.victim === "P") {
        if (d.attacker != null && d.attacker !== "P") st.nemesis = d.attacker;
        // dying ends the streak; earned call-ins survive
        st.count = 0;
        st.medalChain.length = 0;
        sim.emit("streak", { phase: "reset", count: 0 });
        return;
      }
      if (!isEnemyKill(d)) return;
      const t = S.time;
      // ---- score + headshot toast (every kill, streak-made or not)
      const hs = !!d.headshot;
      const pts = KILL_POINTS + (hs ? HEADSHOT_BONUS : 0);
      st.totalScore += pts;
      sim.emit("score", { points: pts, why: hs ? "HEADSHOT" : "KILL", headshot: hs });
      // ---- skill medals (streak-made kills earn points but not these)
      if (!sim.internal.streakBlast) {
        if (firstBlood) bonus(100, "FIRST BLOOD", "FIRST BLOOD", "firstblood");
        if (st.nemesis != null && d.victim === st.nemesis) { st.nemesis = null; bonus(50, "REVENGE", "REVENGE", "revenge"); }
        const vb = S.bots.find((b) => b.id === d.victim);
        if (vb) {
          const pp = S.player.pos;
          const dist = Math.hypot(vb.pos[0] - pp[0], vb.pos[1] - pp[1], vb.pos[2] - pp[2]);
          if (dist > LONGSHOT_M) bonus(50, "LONGSHOT", "LONGSHOT", "longshot");
        }
        if (hs) medal("HEADSHOT", "+" + HEADSHOT_BONUS, "headshot");
      }
      if (sim.internal.streakBlast) return; // a call-in's own kills never feed the streak

      // ---- multi-kill medals
      st.medalChain = st.medalChain.filter((x) => t - x <= MULTI_WINDOW_S);
      st.medalChain.push(t);
      const n = st.medalChain.length;
      if (n >= 2) {
        const bonus = n * 25;
        st.totalScore += bonus;
        medal(MULTI_NAMES[n] || "MULTI KILL x" + n, "+" + bonus + " bonus", "multi");
        sim.emit("score", { points: bonus, why: MULTI_NAMES[n] || "MULTI KILL", headshot: false });
      }

      // ---- the streak itself
      st.count++;
      if (st.count > st.best) st.best = st.count;
      sim.emit("streak", { phase: "count", count: st.count });
      for (const def of STREAK_TIERS) {
        if (st.count === def.at) {
          earn(def.tier, st.count);
          medal(def.at + " KILL STREAK", def.name + " READY  [" + def.key + "]", "streak");
        }
      }
    },

    // cmd.streak = tier (1..3). Called from sim.step right after player movement.
    activate(simRef, tier) {
      void simRef;
      const def = STREAK_TIERS[tier - 1];
      if (!def) return false;
      const p = S.player;
      if (!p.alive) { sim.emit("streak", { phase: "denied", tier, reason: "dead" }); return false; }
      if (st.stock[tier - 1] <= 0) { sim.emit("streak", { phase: "denied", tier, reason: "none" }); return false; }
      if (st.flights.some((f) => f.tier === tier)) { sim.emit("streak", { phase: "denied", tier, reason: "busy" }); return false; }

      if (def.id === "recon") {
        // no target: the drone takes station over the whole map
        const plan = [];
        const t0 = S.time + def.delay;
        for (let t = 0; t <= def.duration + 1e-6; t += def.period) plan.push({ t: t0 + t });
        st.stock[tier - 1]--;
        st.flights.push({ tier, id: def.id, plan, i: 0, endT: t0 + def.duration + 0.4 });
        sim.emit("streak", {
          phase: "call", tier, id: def.id, name: def.name, target: null, eta: def.delay,
          impacts: plan.length, key: def.key, duration: def.duration, endT: t0 + def.duration,
          plan: plan.map((q) => ({ t: q.t })),
        });
        return true;
      }

      // ---- target: first thing under the crosshair, else the ground 45 m out
      // (streakTarget — the designator preview draws the same point)
      const target = streakTarget(sim, p.yaw, p.pitch);
      const b = sim.colliders.bounds;
      const gy = (x, z, y0) => (sim.world.supportAt ? sim.world.supportAt(x, z, y0, 0.3) : sim.world.sphereGround(x, z));

      const rng = mulberry((S.tick * 2654435761 + tier * 40503) >>> 0);
      const fwd = [-Math.sin(p.yaw), -Math.cos(p.yaw)]; // flat view direction
      const plan = [];
      const t0 = S.time + def.delay;
      if (def.id === "mortar") {
        for (let i = 0; i < def.shells; i++) {
          const a = rng() * Math.PI * 2, r = def.scatter * Math.sqrt(rng());
          const x = i === 0 ? target[0] : target[0] + Math.cos(a) * r;
          const z = i === 0 ? target[2] : target[2] + Math.sin(a) * r;
          plan.push({ t: t0 + i * def.gap, pos: [x, gy(x, z, target[1]) + 0.15, z] });
        }
      } else if (def.id === "airstrike") {
        // bomb run: from just BEFORE the target out along the view direction
        const step = def.length / (def.shells - 1);
        for (let i = 0; i < def.shells; i++) {
          const along = -def.length * 0.2 + i * step;
          const jx = (rng() - 0.5) * 2.2, jz = (rng() - 0.5) * 2.2;
          const x = target[0] + fwd[0] * along + jx, z = target[2] + fwd[1] * along + jz;
          const cx = Math.max(b.min[0] + 1, Math.min(b.max[0] - 1, x));
          const cz = Math.max(b.min[2] + 1, Math.min(b.max[2] - 1, z));
          plan.push({ t: t0 + i * def.gap, pos: [cx, gy(cx, cz, target[1]) + 0.15, cz] });
        }
      } else {
        for (let i = 0; i < def.shells; i++) {
          const a = rng() * Math.PI * 2, r = def.scatter * Math.sqrt(rng());
          const x = target[0] + Math.cos(a) * r, z = target[2] + Math.sin(a) * r;
          const cx = Math.max(b.min[0] + 1, Math.min(b.max[0] - 1, x));
          const cz = Math.max(b.min[2] + 1, Math.min(b.max[2] - 1, z));
          plan.push({ t: t0 + (i / (def.shells - 1)) * def.span, pos: [cx, gy(cx, cz, target[1]) + 0.15, cz] });
        }
      }
      plan.sort((a, c) => a.t - c.t);

      st.stock[tier - 1]--;
      st.flights.push({ tier, id: def.id, plan, i: 0, endT: plan[plan.length - 1].t + 0.5 });
      sim.emit("streak", {
        phase: "call", tier, id: def.id, name: def.name, target: target.slice(),
        eta: def.delay, impacts: plan.length, key: def.key,
        dir: [fwd[0], fwd[1]], span: def.length || def.scatter || 0, radius: def.radius,
        // the full firing plan, so the view layer can draw the incoming rounds/bombs/jet
        plan: plan.map((q) => ({ t: q.t, pos: q.pos.slice() })),
      });
      return true;
    },

    tick(simRef, dt) {
      void simRef; void dt;
      if (!st.flights.length) return;
      const t = S.time;
      for (let k = st.flights.length - 1; k >= 0; k--) {
        const f = st.flights[k];
        const def = STREAK_TIERS[f.tier - 1];
        if (f.id === "recon") {
          while (f.i < f.plan.length && f.plan[f.i].t <= t) {
            f.i++;
            sim.emit("streak", { phase: "sweep", tier: f.tier, id: f.id, contacts: hostiles(),
              index: f.i, of: f.plan.length, endT: f.endT - 0.4 });
          }
          if (f.i >= f.plan.length && t >= f.endT) {
            st.flights.splice(k, 1);
            sim.emit("streak", { phase: "done", tier: f.tier, id: f.id });
          }
          continue;
        }
        while (f.i < f.plan.length && f.plan[f.i].t <= t) {
          const imp = f.plan[f.i++];
          sim.emit("streak", { phase: "impact", tier: f.tier, id: f.id, pos: imp.pos.slice(), radius: def.radius, index: f.i, of: f.plan.length });
          sim.internal.streakBlast = true;
          try {
            detonateAt(sim, "P", imp.pos, "streak", {
              radius: def.radius, dmgCenter: def.dmgCenter, dmgEdge: def.dmgEdge, noSelf: true,
            });
          } finally { sim.internal.streakBlast = false; }
        }
        if (f.i >= f.plan.length && t >= f.endT) {
          st.flights.splice(k, 1);
          sim.emit("streak", { phase: "done", tier: f.tier, id: f.id });
        }
      }
    },

    // test / HUD helpers
    give(tier, n = 1) { for (let i = 0; i < n; i++) earn(tier, st.count); },
    tiers: STREAK_TIERS,
  };
  return api;
}

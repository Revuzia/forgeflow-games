// GENESIS — things in flight (CONTRACT.md §11.4, §6.3 cadence 1): what the hand throws, what a tornado lifts, what a
// gravity slip lets go of. A projectile is a point on a planet (unit vector + altitude) with a velocity in m/s, flying
// a true ballistic arc on the SPHERE under the planet's gravity (and a little air drag), integrated in half-second
// steps inside each one-minute tick; a long flight carries over to the next tick. Where it comes down it IMPACTS:
//
//   a person      lands hurt by the speed of the fall (killed when it is fast), shaken, afraid of the hand
//   an animal     survives a soft landing and joins (or makes) a herd; a hard one leaves meat on the ground
//   a tree        set down gently it takes root; thrown, it is a load of wood and a blow to whatever it hits
//   a rock        a small crater, a blast that hurts and wrecks around it
//   food / wood   landing in a settlement is a GIFT to its store — which it may refuse (taboo, terror): left to rot
//   any item      else lies on the ground (a thing to wonder at)
//   a building    set down gently it stands again where it lands; thrown, it is rubble and a wrecking blow
//   the creature  comes down hurt and less trusting
// Near the landing people are afraid; far off, they wonder. Water breaks the fall (and splashes).

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Payload, ProjectileState, V3 } from './state.ts';
import type { ProjectileView } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, MEMK } from '../people/defs.ts';
import { die } from '../people/lifecycle.ts';
import { interrupt, dropItem } from '../people/people.ts';
import { schedule } from '../people/sched.ts';
import { ruin } from '../people/buildings.ts';
import { distM } from '../people/world.ts';
import { spawnHerd } from '../life/herds.ts';
import { brush } from '../fields/terrain.ts';
import { waterImpulse } from '../fields/hydrology.ts';
import { hurtPeople, wreckBuildings } from './harm.ts';
import { godAct } from './belief.ts';
import { giveTo } from './gifts.ts';
import { nearestSettlement, norm, r3 } from './util.ts';
import { agentName } from '../people/util.ts';

/** seconds per tick (1 tick = 1 game minute) and the integration step */
const TICK_S = 60;
const DT = 0.5;
/** a flight longer than this (game seconds) is brought down (zero gravity must not keep things up for ever) */
const MAX_FLIGHT = 1800;

/** put something into the air at `pos` (unit), `alt` metres above the ground (or water) there, with velocity `vel` (m/s, body frame) */
export function launch(u: Universe, p: Planet, payload: Payload, pos: V3, alt: number, vel: V3, god: number): ProjectileState {
  const at = norm(pos);
  const c0 = p.cellAt(at);
  const ground = p.f.surface[c0] + Math.max(0, p.f.water[c0]);
  const pr: ProjectileState = { id: u.ids.alloc('projectile'), planet: p.id, pos: at, alt: ground + Math.max(0, alt), vel: [vel[0], vel[1], vel[2]], payload, god, t0: u.tick, from: [...at] as V3 };
  u.god.projectiles.push(pr);
  // a person in flight is out of the world's hands: no decisions until they land
  if (payload.kind === 'agent' && p.people) {
    const x = makeCtx(u, p);
    const s = x.A.slotOf(payload.id);
    if (s >= 0) { schedule(x, s, u.tick + 100000); x.A.remember(s, MEMK.fear, u.tick, 0); }
  }
  u.emit({ t: 'thrown', planet: p.id, pos: [...pr.pos], a: Math.hypot(vel[0], vel[1], vel[2]), b: alt, data: { id: pr.id, payload: payload.kind, vel: [r3(vel[0]), r3(vel[1]), r3(vel[2])] } });
  return pr;
}

/** every tick: integrate every flight; land the ones that come down */
export function projectilesStep(u: Universe): void {
  const list = u.god.projectiles;
  if (!list.length) return;
  for (const pr of list.slice()) {
    const p = u.planet(pr.planet);
    if (!p || !p.alive) { u.god.projectiles = u.god.projectiles.filter((q) => q !== pr); continue; }
    const R = p.st.radius;
    const g = p.st.gravity;
    const drag = p.airy ? 0.004 * Math.min(2, p.st.atmosphere.pressure) : 0;
    let X = pr.pos[0] * (R + pr.alt), Y = pr.pos[1] * (R + pr.alt), Z = pr.pos[2] * (R + pr.alt);
    let [vx, vy, vz] = pr.vel;
    let landed = false;
    let ground = 0;
    const flown = (u.tick - pr.t0) * TICK_S;
    for (let t = 0; t < TICK_S; t += DT) {
      const r = Math.hypot(X, Y, Z);
      // gravity toward the centre, falling off with the square of the distance (a very high throw on a small world
      // feels it weaken); a little drag
      const k = (g * (R / r) * (R / r) * DT) / r;
      vx -= X * k; vy -= Y * k; vz -= Z * k;
      const dk = 1 - drag * DT;
      vx *= dk; vy *= dk; vz *= dk;
      // hold weightless things down after a long drift
      if (flown + t > MAX_FLIGHT) { const s = 2 * DT / r; vx -= X * s; vy -= Y * s; vz -= Z * s; }
      X += vx * DT; Y += vy * DT; Z += vz * DT;
      const rr = Math.hypot(X, Y, Z);
      const c = p.grid.nearestCell(X / rr, Y / rr, Z / rr);
      ground = p.f.surface[c] + Math.max(0, p.f.water[c]);
      if (rr - R <= ground) { landed = true; break; }
    }
    const rr = Math.hypot(X, Y, Z);
    pr.pos = [X / rr, Y / rr, Z / rr];
    pr.alt = rr - R;
    pr.vel = [vx, vy, vz];
    if (landed) {
      u.god.projectiles = u.god.projectiles.filter((q) => q !== pr);
      land(u, p, pr, Math.hypot(vx, vy, vz));
    } else if (rr > R * ESCAPE_RADII && pr.payload.kind !== 'creature' && g > 0) {
      // far out and still faster than the world's pull can bring back: thrown off the world for good
      const v2 = vx * vx + vy * vy + vz * vz;
      const radial = (vx * X + vy * Y + vz * Z) / rr;
      if (radial > 0 && v2 / 2 > (g * R * R) / rr) {
        u.god.projectiles = u.god.projectiles.filter((q) => q !== pr);
        lost(u, p, pr);
      }
    }
  }
}

/** beyond this many planet radii, a body faster than escape speed is gone */
const ESCAPE_RADII = 8;

/** something thrown faster than the world's escape speed: it never comes down */
function lost(u: Universe, p: Planet, pr: ProjectileState): void {
  const pl = pr.payload;
  let what: string = pl.kind;
  if (pl.kind === 'agent' && p.people) {
    const x = makeCtx(u, p);
    const s = x.A.slotOf(pl.id);
    if (s >= 0) {
      what = agentName(x, s);
      die(x, s, DEATH.god);
      u.chronicleAdd(p, 'god', `${what} was hurled into the sky by the god and never came down.`, 2);
    }
  } else if (pl.kind === 'building' && p.people) {
    u.chronicleAdd(p, 'god', `A ${u.content.buildings.list[pl.b.type]?.name.toLowerCase() ?? 'building'} was flung from the world into the stars.`, 1);
  }
  godAct(u, p, pr.from, 2000, { wonder: 0.4 }, Math.max(0, pr.god));
  u.emit({ t: 'lost', planet: p.id, pos: [...pr.pos], b: pr.alt, text: 'flung off the world', data: { id: pr.id, payload: pl.kind } });
}

/** where it comes down: what it does there */
function land(u: Universe, p: Planet, pr: ProjectileState, speed: number): void {
  const pos = pr.pos;
  const c = p.cellAt(pos);
  const wet = p.f.water[c] > 0.3;
  // water breaks a fall (a deep one more)
  const hit = wet ? speed * Math.max(0.25, 1 - Math.min(0.75, p.f.water[c] / 4)) : speed;
  const pl = pr.payload;
  let what = pl.kind as string;
  let note = '';
  if (wet && speed > 4) {
    waterImpulse(p, pos, Math.max(p.edgeM * 0.5, 4 + speed * 0.3), Math.min(3, speed * 0.02), null, -1);
    u.emit({ t: 'splash', planet: p.id, pos: [...pos], a: speed, data: { payload: pl.kind } });
  }
  switch (pl.kind) {
    case 'agent': note = landAgent(u, p, pr, pl.id, hit); break;
    case 'animal': {
      if (!p.people) break;
      const x = makeCtx(u, p);
      if (hit < 18) {
        // set down in water, it swims for the nearest shore (and drowns if there is none near)
        const to = wet ? dryCellNear(p, pos, 1500) : c;
        if (to < 0) { note = 'drowns'; break; }
        const near = x.ps.herds.find((h) => h.species === pl.species && h.cell === to);
        if (near) near.count = Math.round((near.count + pl.count) * 1000) / 1000;
        else spawnHerd(x, pl.species, to, pl.count);
        note = wet ? 'swims ashore' : 'lands on its feet';
      } else {
        const meat = x.c.items.idx('meat');
        if (meat >= 0) dropItem(x, meat, Math.max(1, Math.round(pl.count * 4)), [pos[0], pos[1], pos[2]], c, false);
        note = 'dies in the fall';
      }
      break;
    }
    case 'tree': {
      if (hit < 9 && !wet) {
        p.f.tree[c] = Math.min(1, p.f.tree[c] + 0.12);
        p.f.treeSpecies[c] = pl.species;
        p.bump('tree'); p.bump('treeSpecies'); p.vegDirty = true;
        note = 'takes root';
      } else {
        if (p.people) { const x = makeCtx(u, p); const wood = x.c.items.idx('wood'); if (wood >= 0) dropItem(x, wood, 6, [pos[0], pos[1], pos[2]], c, false); }
        wreckBuildings(u, p, pos, 12, Math.min(1.5, hit / 40), 'tree');
        hurtPeople(u, p, pos, 10, Math.min(1.2, hit / 35), DEATH.god, { fear: 0.3 });
        note = 'smashes';
      }
      break;
    }
    case 'rock': {
      const energy = 0.5 * pl.mass * hit * hit;
      const radius = Math.max(4, Math.min(120, Math.cbrt(energy) * 0.05));
      if (hit > 12) brush(u, p, 'crater', pos, radius, Math.min(2, 0.4 + hit / 80));
      hurtPeople(u, p, pos, radius * 2, Math.min(2, hit / 30), DEATH.god, { fear: 0.4 });
      wreckBuildings(u, p, pos, radius * 2, Math.min(2, hit / 25), 'rock');
      note = hit > 12 ? 'craters the ground' : 'thuds down';
      break;
    }
    case 'item': {
      if (!p.people) break;
      const x = makeCtx(u, p);
      // into a settlement's store: a gift (which may be refused)
      const st = nearestSettlement(p, pos, 400, (s) => !s.band);
      if (st && distM(p, st.pos, pos) <= Math.max(60, st.territory * 0.6) && hit < 30) {
        const r = giveTo(u, p, st, pl.item, pl.qty, pos, pr.god);
        note = r.accepted ? `a gift to ${st.name}` : `refused by ${st.name}`;
        what = r.accepted ? 'gift' : 'refused';
      } else {
        dropItem(x, pl.item, pl.qty, [pos[0], pos[1], pos[2]], c, pl.artifact);
        if (hit > 25) hurtPeople(u, p, pos, 6, Math.min(1, hit / 60), DEATH.god);
        note = 'lies where it fell';
      }
      break;
    }
    case 'building': {
      if (!p.people) break;
      const x = makeCtx(u, p);
      const b = pl.b;
      b.pos = [pos[0], pos[1], pos[2]];
      b.cell = c;
      // it belongs to whoever's land it stands on now
      const owner = nearestSettlement(p, pos, 2000, (s) => !s.band);
      if (owner && distM(p, owner.pos, pos) <= owner.territory + 50) b.settlement = owner.id;
      b.occupants = 0;
      b.household = -1;
      x.ps.addBuilding(b);
      if (hit >= 6 || wet) {
        ruin(x, x.ps.settlement(b.settlement), b, 'thrown');
        wreckBuildings(u, p, pos, 15, Math.min(2, hit / 20), 'thrown');
        hurtPeople(u, p, pos, 15, Math.min(1.5, hit / 25), DEATH.god, { fear: 0.4 });
        note = 'breaks apart';
      } else note = 'stands where it was set down';
      break;
    }
    case 'creature': {
      const cr = u.god.creature(pl.id);
      if (cr) {
        cr.pos = [pos[0], pos[1], pos[2]];
        cr.from = [...cr.pos]; cr.to = [...cr.pos]; cr.t0 = u.tick; cr.t1 = u.tick;
        cr.held = null;
        if (hit > 10) { cr.energy = Math.max(0, cr.energy - Math.min(0.6, hit / 60)); cr.trust = Math.max(-1, cr.trust - 0.2); note = 'lands hard and glares at you'; }
        else note = 'lands lightly';
        cr.next = u.tick + 1;
      }
      break;
    }
  }
  // fear near, wonder far
  if (pr.god >= 0) {
    if (hit > 8) godAct(u, p, pos, 80, { harm: Math.min(1, hit / 40) }, pr.god);
    godAct(u, p, pos, 500, { wonder: 0.25 }, pr.god);
  }
  u.emit({ t: 'landed', planet: p.id, pos: [...pos], a: r3(hit), text: note, data: { id: pr.id, payload: what, speed: r3(hit) } });
}

function landAgent(u: Universe, p: Planet, pr: ProjectileState, id: number, hit: number): string {
  if (!p.people) return '';
  const x = makeCtx(u, p);
  const A = x.A;
  const s = A.slotOf(id);
  if (s < 0) return 'is gone';
  const pos = pr.pos;
  const c = p.cellAt(pos);
  A.place(s, pos[0], pos[1], pos[2], u.tick);
  A.cell[s] = c;
  x.ps.buckets.move(s, c);
  A.fear[s * 4] = Math.min(1, A.fear[s * 4] + Math.min(0.6, 0.15 + hit / 40));
  A.remember(s, MEMK.injured, u.tick, 0);
  // the speed of the fall: ~8 m/s is a hard jump, ~20 m/s is lethal for most
  const harm = hit <= 7 ? 0 : (hit - 7) / 14;
  if (harm > 0) A.health[s] -= harm;
  if (A.health[s] <= 0) { die(x, s, pr.god >= 0 ? DEATH.god : DEATH.disaster); return 'dies in the fall'; }
  interrupt(x, s);
  return harm > 0.3 ? 'is badly hurt' : harm > 0 ? 'picks themself up' : 'lands unhurt';
}


/** what is in the air over planet p, for the renderer */
export function projectileViews(u: Universe, p: Planet): ProjectileView[] {
  const out: ProjectileView[] = [];
  for (const pr of u.god.projectiles) {
    if (pr.planet !== p.id) continue;
    const pl = pr.payload;
    const c = p.cellAt(pr.pos);
    let what = -1, content = '';
    switch (pl.kind) {
      case 'rock': what = Math.round(pl.mass); break;
      case 'tree': what = pl.species; content = u.content.plants.list[pl.species]?.id ?? ''; break;
      case 'item': what = pl.item; content = u.content.items.list[pl.item]?.id ?? ''; break;
      case 'animal': what = pl.species; content = u.content.animals.list[pl.species]?.id ?? ''; break;
      case 'building': what = pl.b.type; content = u.content.buildings.list[pl.b.type]?.id ?? ''; break;
      case 'creature': case 'agent': what = pl.id; break;
    }
    out.push({
      id: pr.id, planet: p.id, kind: pl.kind, what, content, pos: [pr.pos[0], pr.pos[1], pr.pos[2]],
      alt: r3(Math.max(0, pr.alt - p.f.surface[c])), vel: [r3(pr.vel[0]), r3(pr.vel[1]), r3(pr.vel[2])],
    });
  }
  return out;
}

/** the nearest dry land cell to pos within `radius` metres (-1 none) */
function dryCellNear(p: Planet, pos: ArrayLike<number>, radius: number): number {
  let best = -1, bd = Infinity;
  for (const c of p.cellsNear(pos, radius)) {
    if (p.s.ocean[c] || p.f.water[c] > 0.3) continue;
    const d = distM(p, pos, p.grid.pos.subarray(c * 3, c * 3 + 3));
    if (d < bd || (d === bd && c < best)) { bd = d; best = c; }
  }
  return best;
}

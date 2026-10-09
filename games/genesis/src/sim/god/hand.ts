// GENESIS — the hand (CONTRACT.md §11.4): one per god, a sim entity with a position (the client sends the cursor's
// ground point with hand.move), what it holds and a pose. It grabs ANYTHING: a person, an animal out of a herd, a tree
// out of a forest, a boulder out of the ground, an item lying about (or one conjured into the palm), a small building
// off its foundations, the creature (if it lets you). It lets go with a velocity — the thing flies a ballistic arc
// under the planet's gravity (projectiles.ts) and lands with consequences: hurt, crater, splash, a gift in a store (which
// may be refused). It sets things down gently (place), drops them, SLAPS (hurts a person, punishes the creature, cracks
// a wall) and STROKES (comforts and heals a little, rewards the creature). Everything it does is witnessed.

import type { CommandRegistry, ParamSchema, Args } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { EntityRef, HandView, UnitVec } from '../types.ts';
import type { HandState, Payload, V3 } from './state.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { MEMK, DEATH } from '../people/defs.ts';
import { interrupt } from '../people/people.ts';
import { schedule } from '../people/sched.ts';
import { leaveShelter } from '../people/tasks.ts';
import { removeBuilding } from '../people/buildings.ts';
import { die } from '../people/lifecycle.ts';
import { agentName } from '../people/util.ts';
import { distM } from '../people/world.ts';
import { herdPos, reindexHerds, animalDef } from '../life/herds.ts';
import { launch } from './projectiles.ts';
import { godAct } from './belief.ts';
import { rewardCreature, punishCreature } from './creature.ts';
import { actor, cellPos3, fail, frame, herePos, norm, ok, r3, tangent } from './util.ts';

/** the hand of a god on a planet (made on first use) */
export function handOf(u: Universe, god: number, p: Planet): HandState {
  let h = u.god.hand(god);
  if (!h) {
    const pos = herePos(u, p);
    h = { god, planet: p.id, pos, alt: 8, held: null, pose: 'open', poseUntil: 0, prev: [...pos], prevTick: u.tick };
    u.god.hands.push(h);
    u.god.hands.sort((a, b) => a.god - b.god);
  }
  return h;
}

/** buildings small enough to pick up (huts, hearths, shrines, wells — not temples or walls) */
const SMALL_BUILDING = 4.5;

const _pt = [0, 0, 0];

/** what the hand holds, as an entity reference (conjured things have id -1) */
export function heldRef(h: HandState): EntityRef | null {
  const pl = h.held;
  if (!pl) return null;
  switch (pl.kind) {
    case 'agent': return { kind: 'agent', id: pl.id, planet: h.planet };
    case 'creature': return { kind: 'creature', id: pl.id, planet: h.planet };
    case 'building': return { kind: 'building', id: pl.b.id, planet: h.planet };
    case 'animal': return { kind: 'animal', id: pl.herd, planet: h.planet };
    case 'tree': return { kind: 'tree', id: pl.species, planet: h.planet };
    case 'rock': return { kind: 'rock', id: Math.round(pl.mass), planet: h.planet };
    case 'item': return { kind: 'item', id: pl.item, planet: h.planet };
  }
}

export function handView(u: Universe): HandView | null {
  const h = u.god.hand(0);
  const p = h ? u.planet(h.planet) : u.planetFor(undefined);
  if (!p) return null;
  const g = u.god.god(0);
  if (!h) {
    const pos = herePos(u, p);
    return { planet: p.id, pos: [pos[0], pos[1], pos[2]], alt: 8, held: null, pose: 'open', alignment: g?.alignment ?? 0 };
  }
  const v: HandView = { planet: h.planet, pos: [h.pos[0], h.pos[1], h.pos[2]], alt: h.alt, held: heldRef(h), pose: h.poseUntil > u.tick ? h.pose : h.held ? 'grab' : h.pose === 'point' || h.pose === 'cast' ? h.pose : 'open', alignment: g?.alignment ?? 0 };
  if (h.held) (v as HandView & { heldKind?: string }).heldKind = h.held.kind;
  return v;
}

/** keep a held person under the hand */
function carry(u: Universe, p: Planet, h: HandState): void {
  if (h.held?.kind !== 'agent' || !p.people) return;
  const x = makeCtx(u, p);
  const s = x.A.slotOf(h.held.id);
  if (s < 0) { h.held = null; return; }
  x.A.place(s, h.pos[0], h.pos[1], h.pos[2], u.tick);
  const c = p.cellAt(h.pos);
  x.A.cell[s] = c;
  x.ps.buckets.move(s, c);
  schedule(x, s, u.tick + 100000);
}

/** resolve a target: an EntityRef-like object, "kind:id", or kind + id params */
function targetOf(a: Args): { kind: string; id: number } | null {
  const t = a.target;
  if (t && typeof t === 'object' && typeof (t as EntityRef).kind === 'string') return { kind: (t as EntityRef).kind, id: Number((t as EntityRef).id) };
  if (typeof t === 'string') { const m = t.match(/^(\w+)[:#](\d+)$/); if (m) return { kind: m[1], id: Number(m[2]) }; }
  if (typeof a.kind === 'string' && typeof a.id === 'number') return { kind: a.kind, id: a.id };
  if (typeof a.agent === 'number') return { kind: 'agent', id: a.agent };
  if (typeof a.creature === 'number') return { kind: 'creature', id: a.creature };
  if (typeof a.building === 'number') return { kind: 'building', id: a.building };
  return null;
}

/** the nearest grabbable thing of `kind` (or any) within `radius` of pos */
function nearest(u: Universe, p: Planet, pos: ArrayLike<number>, kind: string | null, radius: number): { kind: string; id: number } | null {
  const R = radius;
  let best: { kind: string; id: number } | null = null, bd = Infinity;
  const consider = (k: string, id: number, at: ArrayLike<number>) => {
    const d = distM(p, at, pos);
    if (d <= R && d < bd) { bd = d; best = { kind: k, id }; }
  };
  if (!kind || kind === 'creature') for (const c of u.god.creatures) if (c.alive && c.planet === p.id && !c.held) consider('creature', c.id, c.pos);
  const ps = p.people;
  if (ps && (!kind || kind === 'agent')) {
    const A = ps.agents;
    for (let s = 0; s < A.hi; s++) if (A.alive[s]) { A.posAt(s, u.tick, _pt); consider('agent', A.id[s], _pt); }
  }
  if (ps && (!kind || kind === 'animal')) for (const hd of ps.herds) { herdPos(hd, u.tick, _pt); consider('animal', hd.id, _pt); }
  if (ps && (!kind || kind === 'item')) for (const it of ps.items) consider('item', it.id, it.pos);
  if (ps && (!kind || kind === 'building')) for (const b of ps.buildings) if (!(b.flags & BuildingFlag.ruined) && (u.content.buildings.list[b.type]?.footprint ?? 99) <= SMALL_BUILDING) consider('building', b.id, b.pos);
  return best;
}

/** take hold of something; returns a message or an error */
function grab(u: Universe, p: Planet, h: HandState, a: Args): { ok: boolean; msg: string } {
  if (h.held) return { ok: false, msg: 'The hand is full: release, place or drop what it holds first.' };
  const at = (a.pos as V3 | null) ?? h.pos;
  // conjure into the palm: an item (by content id), a boulder, a tree
  if (typeof a.item === 'string') {
    const it = u.content.items.idx(a.item);
    if (it < 0) return { ok: false, msg: `There is no such thing as '${a.item}'.` };
    const qty = Math.max(1, Math.min(1e5, Number(a.qty ?? 10)));
    h.held = { kind: 'item', item: it, qty, artifact: true };
    return { ok: true, msg: `${qty} ${u.content.items.list[it].name.toLowerCase()} appear in your hand.` };
  }
  const kindAsked = typeof a.kind === 'string' ? a.kind : null;
  if (kindAsked === 'rock') {
    const mass = Math.max(10, Math.min(2e6, Number(a.mass ?? 1500)));
    const c = p.cellAt(at);
    p.f.rock[c] -= Math.min(0.5, mass / 2.6e6);
    p.updSurface(c);
    p.bump('rock'); p.bump('surface');
    h.held = { kind: 'rock', mass };
    return { ok: true, msg: `You tear a boulder of ${Math.round(mass)} kg out of the ground.` };
  }
  if (kindAsked === 'tree') {
    let c = p.cellAt(at), best = -1;
    for (const o of [c, ...p.cellsNear(at, 120)]) if (p.f.tree[o] >= 0.08 && (best < 0 || p.f.tree[o] > p.f.tree[best])) best = o;
    if (best < 0) return { ok: false, msg: 'There is no tree there to pull up.' };
    c = best;
    const sp = p.f.treeSpecies[c];
    p.f.tree[c] = Math.max(0, p.f.tree[c] - 0.08);
    p.bump('tree'); p.vegDirty = true;
    h.held = { kind: 'tree', species: sp >= 0 ? sp : 0 };
    return { ok: true, msg: `You pull up a ${u.content.plants.list[sp]?.name.toLowerCase() ?? 'tree'}, roots and all.` };
  }
  const t = targetOf(a) ?? nearest(u, p, at, kindAsked, Number(a.radius ?? 60));
  if (!t) return { ok: false, msg: `There is nothing ${kindAsked ? `(${kindAsked}) ` : ''}within reach of the hand there.` };
  const ps = p.people;
  switch (t.kind) {
    case 'agent': {
      if (!ps) break;
      const x = makeCtx(u, p);
      const s = x.A.slotOf(t.id);
      if (s < 0) return { ok: false, msg: 'That person is not alive.' };
      if (x.A.inside[s] >= 0) leaveShelter(x, s);
      h.held = { kind: 'agent', id: t.id };
      x.A.remember(s, MEMK.fear, u.tick, 0);
      x.A.fear[s * 4] = Math.min(1, x.A.fear[s * 4] + 0.15);
      x.A.flags[s] |= AgentFlag.sees_god;
      carry(u, p, h);
      godAct(u, p, h.pos, 150, { wonder: 0.25 }, h.god);
      return { ok: true, msg: `You lift ${agentName(x, s)} into the air.` };
    }
    case 'animal': {
      if (!ps) break;
      const hd = ps.herd(t.id);
      if (!hd || hd.count < 0.5) return { ok: false, msg: 'There is no such herd.' };
      const n = Math.min(hd.count, Math.max(1, Math.round(Number(a.qty ?? 1))));
      hd.count = Math.round((hd.count - n) * 1000) / 1000;
      hd.state = 2;
      hd.scared = u.tick;
      h.held = { kind: 'animal', species: hd.species, count: n, herd: hd.id };
      if (hd.count < 0.5) { ps.herds = ps.herds.filter((q) => q !== hd); reindexHerds(makeCtx(u, p)); }
      ps.version++;
      return { ok: true, msg: `You pick up ${n === 1 ? 'a' : n} ${animalDef(makeCtx(u, p), hd.species).name.toLowerCase()}${n === 1 ? '' : 's'}.` };
    }
    case 'item': {
      if (!ps) break;
      const i = ps.items.findIndex((g) => g.id === t.id);
      if (i < 0) return { ok: false, msg: 'That thing is gone.' };
      const g = ps.items[i];
      ps.items.splice(i, 1);
      ps.iByCell.remove(g.cell, g.id);
      ps.version++;
      h.held = { kind: 'item', item: g.item, qty: g.qty, artifact: g.artifact };
      return { ok: true, msg: `You pick up the ${u.content.items.list[g.item]?.name.toLowerCase() ?? 'thing'}.` };
    }
    case 'building': {
      if (!ps) break;
      const b = ps.building(t.id);
      if (!b) return { ok: false, msg: 'That building is gone.' };
      const def = u.content.buildings.list[b.type];
      if ((def?.footprint ?? 99) > SMALL_BUILDING) return { ok: false, msg: `The ${def?.name.toLowerCase() ?? 'building'} is too big to lift.` };
      const x = makeCtx(u, p);
      // whoever was inside tumbles out
      for (let s = 0; s < x.A.hi; s++) if (x.A.alive[s] && x.A.inside[s] === b.id) leaveShelter(x, s);
      for (const st of ps.settlements) for (const hh of st.households) if (hh.home === b.id) hh.home = -1;
      for (let s = 0; s < x.A.hi; s++) if (x.A.alive[s] && x.A.home[s] === b.id) x.A.home[s] = -1;
      removeBuilding(x, b);
      h.held = { kind: 'building', b: { ...b, pos: [...b.pos] as V3, books: b.books.slice() } };
      godAct(u, p, b.pos, 200, { harm: 0.3, wonder: 0.3 }, h.god);
      return { ok: true, msg: `You lift the ${def?.name.toLowerCase() ?? 'building'} off its foundations.` };
    }
    case 'creature': {
      const c = u.god.creature(t.id);
      if (!c || !c.alive) return { ok: false, msg: 'There is no such creature.' };
      if (c.god !== h.god && c.trust < 0.5) return { ok: false, msg: `${c.name} is not yours, and will not be lifted.` };
      if (c.trust < 0.2) return { ok: false, msg: `${c.name} pulls away from your hand: it does not trust you (stroke it more, slap it less).` };
      h.held = { kind: 'creature', id: c.id };
      c.held = { kind: 'creature', id: c.id };
      return { ok: true, msg: `${c.name} lets you lift it.` };
    }
  }
  return { ok: false, msg: `The hand cannot hold a ${t.kind}.` };
}

/** let go with a velocity (m/s, body frame); null = straight down */
function release(u: Universe, p: Planet, h: HandState, vel: V3): string {
  const pl = h.held;
  if (!pl) return 'The hand is empty.';
  h.held = null;
  if (pl.kind === 'creature') { const c = u.god.creature(pl.id); if (c) c.held = null; }
  launch(u, p, pl, [...h.pos] as V3, Math.max(0.5, h.alt), vel, h.god);
  const sp = Math.hypot(vel[0], vel[1], vel[2]);
  const what = pl.kind === 'item' ? u.content.items.list[pl.item]?.name.toLowerCase() ?? 'it' : pl.kind;
  return sp > 15 ? `You hurl the ${what} (${Math.round(sp)} m/s).` : sp > 2 ? `You toss the ${what}.` : `You let the ${what} fall.`;
}

/** a throw: toward a point at an angle, else along the hand's last motion, else straight ahead north */
function throwVel(u: Universe, p: Planet, h: HandState, a: Args): V3 {
  if (Array.isArray(a.vel)) return [Number(a.vel[0]), Number(a.vel[1]), Number(a.vel[2])];
  const speed = Math.max(0, Number(a.speed ?? 30)) * u.god.law('hand.strength');
  const ang = (Math.max(0, Math.min(89, Number(a.angle ?? 35))) * Math.PI) / 180;
  let dir: V3;
  const to = a.toward as V3 | null;
  if (to) dir = norm(tangent(h.pos, [to[0] - h.pos[0], to[1] - h.pos[1], to[2] - h.pos[2]]));
  else {
    const mv = tangent(h.pos, [h.pos[0] - h.prev[0], h.pos[1] - h.prev[1], h.pos[2] - h.prev[2]]);
    dir = Math.hypot(mv[0], mv[1], mv[2]) > 1e-7 ? norm(mv) : frame(h.pos).north;
  }
  // for a target point, pick the speed that reaches it (flat ground, no drag) when none was given
  let v = speed;
  if (to && a.speed === undefined) {
    const range = distM(p, h.pos, to);
    v = Math.sqrt(Math.max(1, range * p.st.gravity / Math.max(0.05, Math.sin(2 * ang))));
    v = Math.min(v, 2000);
  }
  const up = h.pos;
  return [dir[0] * v * Math.cos(ang) + up[0] * v * Math.sin(ang), dir[1] * v * Math.cos(ang) + up[1] * v * Math.sin(ang), dir[2] * v * Math.cos(ang) + up[2] * v * Math.sin(ang)];
}

function slapOrStroke(u: Universe, p: Planet, h: HandState, a: Args, slap: boolean): { ok: boolean; msg: string } {
  const at = (a.pos as V3 | null) ?? h.pos;
  h.pose = slap ? 'slap' : 'stroke';
  h.poseUntil = u.tick + 3;
  const t = targetOf(a) ?? nearest(u, p, at, typeof a.kind === 'string' ? a.kind : null, Number(a.radius ?? 40));
  if (!t) return { ok: false, msg: `There is nothing there to ${slap ? 'slap' : 'stroke'}.` };
  if (t.kind === 'creature') {
    const c = u.god.creature(t.id);
    if (!c) return { ok: false, msg: 'There is no such creature.' };
    const r = slap ? punishCreature(u, c, 1) : rewardCreature(u, c, 1);
    return { ok: true, msg: r };
  }
  if (t.kind === 'agent' && p.people) {
    const x = makeCtx(u, p);
    const s = x.A.slotOf(t.id);
    if (s < 0) return { ok: false, msg: 'That person is not alive.' };
    x.A.posAt(s, u.tick, _pt);
    const name = agentName(x, s);
    if (slap) {
      x.A.health[s] -= 0.3;
      x.A.fear[s * 4] = Math.min(1, x.A.fear[s * 4] + 0.3);
      x.A.remember(s, MEMK.injured, u.tick, 0);
      godAct(u, p, _pt, 120, { harm: 0.35 }, h.god);
      if (x.A.health[s] <= 0) { die(x, s, DEATH.god); return { ok: true, msg: `You strike ${name} down.` }; }
      if (!(x.A.flags[s] & AgentFlag.possessed)) interrupt(x, s);
      return { ok: true, msg: `You slap ${name}. They will remember it.` };
    }
    x.A.health[s] = Math.min(1, x.A.health[s] + 0.15);
    x.A.love[s * 4] = Math.min(1, x.A.love[s * 4] + 0.2);
    x.A.fear[s * 4] = Math.max(0, x.A.fear[s * 4] - 0.1);
    x.A.mood[s] = Math.min(1, x.A.mood[s] + 0.3);
    x.A.remember(s, MEMK.miracle, u.tick, 0);
    godAct(u, p, _pt, 120, { help: 0.25 }, h.god);
    return { ok: true, msg: `You stroke ${name}; their fear eases and their bruises close.` };
  }
  if (t.kind === 'building' && p.people) {
    const b = p.people.building(t.id);
    if (!b) return { ok: false, msg: 'That building is gone.' };
    if (slap) {
      b.damage = Math.min(1, b.damage + 0.35);
      p.people.version++;
      godAct(u, p, b.pos, 150, { harm: 0.3 }, h.god);
      return { ok: true, msg: `The walls crack under your hand.` };
    }
    b.damage = Math.max(0, b.damage - 0.2);
    p.people.version++;
    return { ok: true, msg: 'You smooth the cracks in the walls.' };
  }
  if (t.kind === 'animal' && p.people) {
    const hd = p.people.herd(t.id);
    if (!hd) return { ok: false, msg: 'There is no such herd.' };
    if (slap) { hd.state = 2; hd.scared = u.tick; return { ok: true, msg: 'The herd scatters in panic.' }; }
    hd.hunger = Math.max(0, hd.hunger - 0.2);
    return { ok: true, msg: 'The animals calm under your hand.' };
  }
  return { ok: false, msg: `You cannot ${slap ? 'slap' : 'stroke'} that.` };
}

const pos = (required = false): ParamSchema => ({ type: 'pos', required, desc: 'where (unit vector or lat/lon)' });
const anyT: ParamSchema = { type: 'any', desc: 'an entity { kind, id } or "kind:id"' };
const KINDS = ['agent', 'animal', 'tree', 'rock', 'item', 'building', 'creature'];

export function registerHandCommands(r: CommandRegistry): void {
  r.register('hand.move', ({ u, p, cmd }, a) => {
    const h = handOf(u, actor(cmd), p);
    if (h.planet !== p.id && h.held) return fail('Put down what the hand holds before reaching to another world.');
    h.prev = [...h.pos] as V3;
    h.prevTick = u.tick;
    h.planet = p.id;
    h.pos = norm(a.pos ?? herePos(u, p));
    if (typeof a.alt === 'number') h.alt = a.alt;
    if (typeof a.pose === 'string') { h.pose = a.pose; h.poseUntil = 0; }
    carry(u, p, h);
    if (h.held?.kind === 'creature') { const c = u.god.creature(h.held.id); if (c) { c.pos = [...h.pos] as V3; c.from = [...c.pos]; c.to = [...c.pos]; } }
    return { ok: true };
  }, { desc: 'Move the hand', category: 'Hand', params: { pos: pos(), alt: { type: 'number', min: 0, max: 100000, desc: 'metres above the ground' }, pose: { type: 'enum', values: ['open', 'grab', 'point', 'cast', 'slap', 'stroke'] } } });

  r.register('hand.grab', ({ u, p, cmd }, a) => {
    const h = handOf(u, actor(cmd), p);
    if (a.pos) { h.prev = [...h.pos] as V3; h.pos = norm(a.pos); h.planet = p.id; }
    const res = grab(u, p, h, a);
    if (res.ok) { h.pose = 'grab'; h.poseUntil = 0; }
    return res.ok ? ok(res.msg, heldRef(h) ? [heldRef(h)!] : undefined) : fail(res.msg);
  }, {
    desc: 'Grab anything: a person, an animal, a tree, a rock, an item, a small building, the creature', category: 'Hand',
    params: {
      pos: pos(), target: anyT, kind: { type: 'enum', values: KINDS }, id: { type: 'int', min: 0 }, radius: { type: 'number', min: 1, max: 2000, default: 60 },
      item: { type: 'enum', values: (u) => u.content.items.ids(), desc: 'conjure an item into the hand' }, qty: { type: 'number', min: 1, max: 100000 },
      mass: { type: 'number', min: 10, max: 2e6, desc: 'kg (a boulder)' },
    },
  });

  const throwSchema: Record<string, ParamSchema> = {
    vel: { type: 'vec3', desc: 'm/s, body frame' }, toward: { type: 'pos', desc: 'throw at this point' },
    speed: { type: 'number', min: 0, max: 3000, desc: 'm/s' }, angle: { type: 'number', min: 0, max: 89, default: 35, desc: 'degrees above the ground' },
  };
  r.register('hand.release', ({ u, p, cmd }, a) => {
    const h = handOf(u, actor(cmd), p);
    if (!h.held) return fail('The hand holds nothing.');
    const vel = a.vel || a.toward || a.speed !== undefined ? throwVel(u, p, h, a) : [0, 0, 0] as V3;
    h.pose = 'open'; h.poseUntil = u.tick + 2;
    return ok(release(u, p, h, vel));
  }, { desc: 'Let go (with a velocity: a throw)', category: 'Hand', params: throwSchema });
  r.register('hand.throw', ({ u, p, cmd }, a) => {
    const h = handOf(u, actor(cmd), p);
    if (!h.held) return fail('The hand holds nothing to throw.');
    const vel = throwVel(u, p, h, { ...a, speed: a.speed ?? (a.toward ? undefined : 40) });
    h.pose = 'open'; h.poseUntil = u.tick + 2;
    return ok(release(u, p, h, vel));
  }, { desc: 'Throw what the hand holds', category: 'Hand', params: throwSchema });
  r.register('hand.drop', ({ u, p, cmd }) => {
    const h = handOf(u, actor(cmd), p);
    if (!h.held) return fail('The hand holds nothing.');
    return ok(release(u, p, h, [0, 0, 0]));
  }, { desc: 'Drop what the hand holds', category: 'Hand', params: {} });
  r.register('hand.place', ({ u, p, cmd }, a) => {
    const h = handOf(u, actor(cmd), p);
    if (!h.held) return fail('The hand holds nothing.');
    if (a.pos) { h.prev = [...h.pos] as V3; h.pos = norm(a.pos); }
    // set down gently: from just above the ground, barely moving
    h.alt = 0.6;
    return ok(release(u, p, h, [0, 0, 0]).replace(/You let the (.*) fall\./, 'You set the $1 down gently.'));
  }, { desc: 'Set something down gently', category: 'Hand', params: { pos: pos() } });
  r.register('hand.slap', ({ u, p, cmd }, a) => {
    const h = handOf(u, actor(cmd), p);
    if (a.pos) h.pos = norm(a.pos);
    const res = slapOrStroke(u, p, h, a, true);
    return res.ok ? ok(res.msg) : fail(res.msg);
  }, { desc: 'Slap (punish)', category: 'Hand', params: { pos: pos(), target: anyT, kind: { type: 'enum', values: KINDS }, id: { type: 'int', min: 0 }, radius: { type: 'number', min: 1, max: 1000, default: 40 } } });
  r.register('hand.stroke', ({ u, p, cmd }, a) => {
    const h = handOf(u, actor(cmd), p);
    if (a.pos) h.pos = norm(a.pos);
    const res = slapOrStroke(u, p, h, a, false);
    return res.ok ? ok(res.msg) : fail(res.msg);
  }, { desc: 'Stroke (comfort, reward)', category: 'Hand', params: { pos: pos(), target: anyT, kind: { type: 'enum', values: KINDS }, id: { type: 'int', min: 0 }, radius: { type: 'number', min: 1, max: 1000, default: 40 } } });
  r.register('hand.pose', ({ u, p, cmd }, a) => {
    const h = handOf(u, actor(cmd), p);
    h.pose = String(a.pose);
    h.poseUntil = typeof a.ticks === 'number' ? u.tick + a.ticks : 0;
    return { ok: true };
  }, { desc: 'Shape the hand (point, cast, open)', category: 'Hand', params: { pose: { type: 'enum', values: ['open', 'grab', 'point', 'cast', 'slap', 'stroke'], required: true }, ticks: { type: 'int', min: 0, max: 1000 } } });
}

export type { UnitVec, Payload };
export { cellPos3, r3 };

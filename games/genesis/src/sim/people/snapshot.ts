// GENESIS — peoples in snapshots (CONTRACT.md §14, types.ts): agents as a MoverBlock (unit-vector positions at the
// snapshot tick, per-tick velocity for extrapolation, animation state, flags, carried item, settlement, scale by age and
// caste, a tint from the species' palette), animals materialised around their herds, buildings as a BuildingBlock,
// settlements as SettlementViews, population per species. Fresh typed arrays every time (transferable).

import type { BuildingBlock, MoverBlock, SettlementView } from '../types.ts';
import { AgentFlag, AnimalFlag, AnimState, BuildingFlag } from '../types.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { makeCtx, packColor } from './ctx.ts';
import { animalBase, animalDef, herdPos } from '../life/herds.ts';
import { lightOf } from './buildings.ts';
import { cohortTotal } from './cohorts.ts';
import { offsetPoint } from './world.ts';
import { ERAS } from '../content.ts';
import { SettlementFlag } from '../types.ts';
import { musicOf, styleVariant } from './culture.ts';
import { atWar, enemiesOf, polityName } from './war.ts';
import { hasMarket } from './economy.ts';

function emptyMovers(n: number): MoverBlock {
  return {
    count: n, id: new Uint32Array(n), species: new Uint16Array(n), pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
    alt: new Float32Array(n), heading: new Float32Array(n), anim: new Uint8Array(n), phase: new Float32Array(n),
    flags: new Uint16Array(n), carry: new Int16Array(n), group: new Int32Array(n), scale: new Float32Array(n), tint: new Uint32Array(n),
  };
}

const _p = [0, 0, 0];

export function agentBlock(u: Universe, p: Planet): MoverBlock {
  const ps = p.people;
  const A = ps.agents;
  const out = emptyMovers(A.count);
  if (!A.count) return out;
  const x = makeCtx(u, p);
  const t = u.tick;
  let i = 0;
  for (let s = 0; s < A.hi && i < A.count; s++) {
    if (!A.alive[s]) continue;
    const sp = x.info[A.species[s]];
    A.posAt(s, t, _p);
    out.id[i] = A.id[s];
    out.species[i] = A.species[s];
    out.pos[i * 3] = _p[0]; out.pos[i * 3 + 1] = _p[1]; out.pos[i * 3 + 2] = _p[2];
    const dt = A.t1[s] - A.t0[s];
    if (dt > 0 && t < A.t1[s]) {
      out.vel[i * 3] = (A.tx[s] - A.fx[s]) / dt;
      out.vel[i * 3 + 1] = (A.ty[s] - A.fy[s]) / dt;
      out.vel[i * 3 + 2] = (A.tz[s] - A.fz[s]) / dt;
    }
    let alt = 0;
    if (sp.def.fly) alt = sp.def.alt ?? 2;
    else if (p.f.water[A.cell[s]] > 0.6) alt = -Math.min(1.2, p.f.water[A.cell[s]] - 0.4);
    out.alt[i] = alt;
    out.heading[i] = A.heading[s];
    // moving without a segment means idle: show the work anim only while working
    out.anim[i] = A.flags[s] & AgentFlag.sleepingIndoors ? AnimState.sleep : A.anim[s];
    out.phase[i] = (hash32(A.id[s], 0xa41) >>> 8) / 16777216;
    out.flags[i] = A.flags[s];
    // afloat: `carry` is the boat they ride (types.ts AgentFlag.boat; the client draws raft / boat / sail from it)
    const carried = A.flags[s] & AgentFlag.boat && A.boat[s] >= 0 ? A.boat[s] : A.carryItem(s);
    out.carry[i] = carried >= 0 ? carried : A.tool[s];
    out.group[i] = A.settlement[s];
    const age = (t - A.birth[s]) / x.year;
    let scale = age < sp.def.maturity ? 0.5 + 0.5 * Math.min(1, age / Math.max(0.5, sp.def.maturity)) : 1;
    if (sp.def.hive) {
      const caste = sp.def.hive.castes[A.caste[s]];
      scale *= caste === sp.def.hive.queen ? 1.45 : caste === 'soldier' ? 1.15 : caste === 'drone' ? 0.9 : 1;
      out.tint[i] = sp.caste[A.caste[s]] ?? sp.skin[0];
    } else {
      // clothing colour, or skin when unclothed (stone-age bands)
      const pal = A.gear[s] >= 0 && sp.cloth.length ? sp.cloth : sp.skin;
      out.tint[i] = pal[hash32(A.id[s], 0x7171) % pal.length];
    }
    out.scale[i] = scale * (0.94 + 0.12 * hashFloat(A.id[s], 0x5ca1e));
    i++;
  }
  if (i < out.count) {
    // defensive: a store whose count disagrees with its slots (should not happen) yields a short block
    const r = emptyMovers(i);
    for (const k of Object.keys(r) as (keyof MoverBlock)[]) {
      if (k === 'count') continue;
      const src = out[k] as unknown as { subarray(a: number, b: number): ArrayLike<number> };
      const per = k === 'pos' || k === 'vel' ? 3 : 1;
      (r[k] as unknown as { set(a: ArrayLike<number>): void }).set(src.subarray(0, i * per));
    }
    return r;
  }
  return out;
}

/** individual animals drawn around each herd (deterministic offsets that drift slowly) */
export function animalBlock(u: Universe, p: Planet): MoverBlock {
  const ps = p.people;
  const x = makeCtx(u, p);
  let n = 0;
  const shown: number[] = [];
  for (const h of ps.herds) {
    const a = animalDef(x, h.species);
    const cap = a.swarm ? 1 : a.kind === 'fish' ? 8 : a.size > 3 ? 4 : 10;
    const k = Math.max(0, Math.min(cap, Math.ceil(h.count)));
    shown.push(k);
    n += k;
  }
  const out = emptyMovers(n);
  const t = u.tick;
  let i = 0;
  ps.herds.forEach((h, hi) => {
    const a = animalDef(x, h.species);
    // a species born on this world is drawn with its ancestor's body, at its own size and colours
    const base = animalBase(x, h.species);
    const sizeK = a.size / Math.max(1e-3, x.c.animals.list[base]?.size ?? a.size);
    const k = shown[hi];
    if (!k) return;
    herdPos(h, t, _p);
    const dt = h.t1 - h.t0;
    const moving = dt > 0 && t < h.t1;
    const spread = 3 + Math.sqrt(h.count) * 1.6 * Math.max(0.5, Math.min(3, a.size));
    const cols = a.colors.map(packColor);
    let flags = 0;
    if (h.owner >= 0 || a.domestic) flags |= AnimalFlag.domestic;
    if (a.kind === 'predator') flags |= AnimalFlag.predator;
    if (a.swarm) flags |= AnimalFlag.swarm;
    if (a.kind === 'fish') flags |= AnimalFlag.fish;
    if (a.habitat === 'air') flags |= AnimalFlag.flying;
    if (h.state === 2) flags |= AnimalFlag.fleeing;
    if (h.state === 4) flags |= AnimalFlag.penned;
    const anim = h.state === 2 ? AnimState.run : moving ? AnimState.walk : a.habitat === 'air' ? AnimState.fly : a.kind === 'fish' ? AnimState.swim : AnimState.graze;
    for (let j = 0; j < k; j++) {
      // each animal keeps its place in the herd, wandering a little over the hours
      const drift = (t / 600 + hashFloat(h.id, j, 0xd21)) * 0.6;
      const r = spread * Math.sqrt(hashFloat(h.id, j, 0x5e7)) * (a.swarm ? 0 : 1);
      const ang = hashFloat(h.id, j, 0x5e8) * Math.PI * 2 + Math.sin(drift) * 0.4;
      offsetPoint(_p, r, ang, p.st.radius, _q);
      out.id[i] = (h.id * 64 + j) >>> 0;
      out.species[i] = base;
      out.pos[i * 3] = _q[0]; out.pos[i * 3 + 1] = _q[1]; out.pos[i * 3 + 2] = _q[2];
      if (moving) {
        out.vel[i * 3] = (h.to[0] - h.from[0]) / dt;
        out.vel[i * 3 + 1] = (h.to[1] - h.from[1]) / dt;
        out.vel[i * 3 + 2] = (h.to[2] - h.from[2]) / dt;
      }
      out.alt[i] = a.habitat === 'air' ? 4 + 8 * hashFloat(h.id, j, 0xa17) : a.kind === 'fish' ? -1.5 : 0;
      out.heading[i] = moving ? headingOf(h.from, h.to) : hashFloat(h.id, j, 0x4ed) * Math.PI * 2;
      out.anim[i] = anim;
      out.phase[i] = hashFloat(h.id, j, 0x9a5);
      out.flags[i] = flags | (j > 0 && hashFloat(h.id, j, 0x40) < 0.2 ? AnimalFlag.young : 0);
      out.carry[i] = -1;
      out.group[i] = h.id;
      out.scale[i] = (a.swarm ? Math.max(1, Math.sqrt(h.count) / 10) : sizeK) * (out.flags[i] & AnimalFlag.young ? 0.6 : 0.9 + 0.2 * hashFloat(h.id, j, 0x5c));
      out.tint[i] = cols.length ? cols[hash32(h.id, j, 0xc0) % cols.length] : 0x808080;
      i++;
    }
  });
  return out;
}
const _q = [0, 0, 0];

function headingOf(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ex = a[2], ez = -a[0];
  let el = Math.hypot(ex, ez);
  if (el < 1e-9) { ex = 1; ez = 0; el = 1; }
  ex /= el; ez /= el;
  const nx = a[1] * ez, ny = a[2] * ex - a[0] * ez, nz = -a[1] * ex;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return Math.atan2(dx * ex + dz * ez, dx * nx + dy * ny + dz * nz);
}

export function buildingBlock(u: Universe, p: Planet): BuildingBlock {
  const ps = p.people;
  const x = makeCtx(u, p);
  const n = ps.buildings.length;
  const out: BuildingBlock = {
    count: n, id: new Uint32Array(n), type: new Uint16Array(n), material: new Uint8Array(n), style: new Uint8Array(n),
    pos: new Float32Array(n * 3), rot: new Float32Array(n), scale: new Float32Array(n), progress: new Float32Array(n),
    flags: new Uint16Array(n), light: new Uint16Array(n), settlement: new Int32Array(n), damage: new Float32Array(n),
  };
  ps.buildings.forEach((b, i) => {
    out.id[i] = b.id;
    out.type[i] = b.type;
    out.material[i] = b.material;
    out.style[i] = b.style;
    out.pos[i * 3] = b.pos[0]; out.pos[i * 3 + 1] = b.pos[1]; out.pos[i * 3 + 2] = b.pos[2];
    out.rot[i] = b.rot;
    out.scale[i] = b.scale;
    out.progress[i] = b.progress;
    let f = b.flags;
    if (b.occupants > 0) f |= BuildingFlag.occupied;
    if (b.fuel > 0) f |= BuildingFlag.lit;
    const st = ps.settlement(b.settlement);
    if (st && st.fallen >= 0) f |= BuildingFlag.abandoned;
    out.flags[i] = f;
    out.light[i] = lightOf(x, st, b);
    out.settlement[i] = b.settlement;
    out.damage[i] = b.damage;
  });
  return out;
}

export function settlementViews(u: Universe, p: Planet): SettlementView[] {
  const ps = p.people;
  if (!ps.settlements.length) return [];
  const x = makeCtx(u, p);
  return ps.settlements.map((st) => {
    const agents = ps.members.get(st.id)?.length ?? 0;
    const cohort = Math.round(cohortTotal(st));
    const war = st.fallen < 0 && !st.band && atWar(x, st);
    const foes = war ? enemiesOf(x, st.polity) : [];
    const port = ps.of(st.id).some((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && x.c.buildings.list[b.type].function === 'dock');
    const tributary = (ps.polity(st.polity)?.overlord ?? -1) >= 0;
    let flags = (st.band ? SettlementFlag.band : 0) | (st.fallen >= 0 ? SettlementFlag.fallen : 0) | (war ? SettlementFlag.atWar : 0)
      | (st.besieged >= 0 ? SettlementFlag.besieged : 0) | (port ? SettlementFlag.port : 0) | (tributary ? SettlementFlag.tributary : 0);
    if (st.fallen < 0 && hasMarket(x, st)) flags |= SettlementFlag.market;
    if (st.age.kind === 'golden') flags |= SettlementFlag.golden;
    if (st.age.kind === 'dark') flags |= SettlementFlag.dark;
    // trading partners: settlements a caravan of this one has visited lately, or that came here
    const trade: number[] = [];
    for (const m of ps.missions) {
      if (m.kind !== 'trade') continue;
      const o = m.from === st.id ? m.to : m.to === st.id ? m.from : -1;
      if (o >= 0 && !trade.includes(o)) trade.push(o);
    }
    return {
      id: st.id, name: st.band ? `Band of ${st.name}` : st.name, species: st.species, pos: [st.pos[0], st.pos[1], st.pos[2]],
      population: agents + cohort, agents, cohort, alignment: st.culture.alignment, belief: st.belief, god: st.god,
      era: ERAS[st.era] ?? 'stone', color: st.color, polity: st.polity, language: st.language, nightLight: st.nightLight,
      knowledgeCount: st.library.length, flags,
      style: styleVariant(st), music: musicOf(st, war), polityName: st.band ? undefined : polityName(x, ps.polity(st.polity)),
      war: war ? ps.settlements.filter((o) => o.fallen < 0 && !o.band && foes.includes(o.polity)).map((o) => o.id) : [],
      trade, besieged: st.besieged >= 0, age: st.age.kind, disbelief: st.recent.disbelief ?? 0,
      factions: st.factions.map((f) => ({ kind: f.kind, share: f.share })),
    };
  });
}

export function populationBySpecies(u: Universe, p: Planet): number[] {
  const out = new Array<number>(u.content.species.size).fill(0);
  const A = p.people.agents;
  for (let s = 0; s < A.hi; s++) if (A.alive[s]) out[A.species[s]]++;
  for (const st of p.people.settlements) if (st.fallen < 0) out[st.species] += Math.round(cohortTotal(st));
  return out;
}

// GENESIS — the creature (CONTRACT.md §11.5): a giant beast that belongs to a god (or to a people that raised it) and
// LEARNS. It has hunger and energy, grows (height, strength), and an alignment (-1 cruel .. +1 good) earned by what it
// does, which MORPHS its body (good: round, bright, glowing; cruel: gaunt, spiky, dark). Its brain is a set of
// behaviour DESIRES — eat, sleep, play, throw, help, attack, cast, impress, terrify, poop, explore, follow, eat-people,
// throw-people — weighted by its state and its leash, and RESHAPED by the god: a stroke rewards the behaviour it did
// last (it will do it more), a slap punishes it (less). It WATCHES the hand: a miracle cast near it is learned with a
// skill that grows each time, and it casts what it knows when its village needs it.
//
// Leash: to a settlement or a point, with a mode — tend (help the village), defend (attack its enemies), impress (awe),
// terrify (fear), explore (roam). More than one may exist; a people with animal husbandry and a sacred beast may raise
// one of their own. Movement is a segment between ticks (like agents); it thinks when it arrives or finishes an act.

import type { CommandRegistry, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { CreatureDef } from '../content.ts';
import type { CreatureView, AnimStateId } from '../types.ts';
import type { CreatureState, V3 } from './state.ts';
import type { Settlement } from '../people/state.ts';
import { AnimState, AgentFlag, BuildingFlag } from '../types.ts';
import { hashFloat, hash32 } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, MEMK } from '../people/defs.ts';
import { die } from '../people/lifecycle.ts';
import { interrupt } from '../people/people.ts';
import { workOn } from '../people/buildings.ts';
import { foodDays, storeAdd, storeTake } from '../people/store.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars, agentName } from '../people/util.ts';
import { distM } from '../people/world.ts';
import { herdPos } from '../life/herds.ts';
import { enemiesOf } from '../people/war.ts';
import { CREATURE_BEHAVIOURS } from '../content.ts';
import { watchHooks } from './watch.ts';
import { godAct } from './belief.ts';
import { castMiracle, MIRACLES } from './miracles.ts';
import { launch } from './projectiles.ts';
import { hurtPeople, wreckBuildings } from './harm.ts';
import { actor, bearingDir, cellPos3, clamp, fail, headingOf, herePos, moveBy, nearestSettlement, norm, ok, r3, tangent } from './util.ts';

export const LEASH_MODES = ['tend', 'defend', 'impress', 'terrify', 'explore'] as const;

const NAMES = ['Grom', 'Ysolde', 'Bramble', 'Tor', 'Mirra', 'Oskar', 'Wen', 'Kalla', 'Thud', 'Ilse', 'Moss', 'Baru', 'Fenn', 'Asha', 'Rook', 'Nim'];

/** behaviour -> moral weight (what doing it makes of the creature) */
const VALENCE: Record<string, number> = {
  eat: 0, sleep: 0, play: 0.003, throw: -0.004, help: 0.015, attack: -0.05, cast: 0.01, impress: 0.006, terrify: -0.03, poop: 0,
  explore: 0, follow: 0.002, 'eat-people': -0.15, 'throw-people': -0.09,
};

/** good miracles push the caster's alignment up, cruel ones down */
const MIRACLE_VALENCE: Record<string, number> = { water: 0.03, food: 0.04, heal: 0.05, forest: 0.03, storm: -0.01, fire: 0.01, fireball: -0.05, shield: 0.03, lightning: -0.04, wood: 0.02, fertility: 0.04, calm: 0.03, teach: 0.03, meteor: -0.08 };

// ───────────────────────────── making one ─────────────────────────────

export function adoptCreature(u: Universe, p: Planet, template: string, pos: V3, o: { god: number; settlement?: number; name?: string }): CreatureState | string {
  const def = u.content.creatures.find(template);
  if (!def) return `There is no creature called '${template}'. Known: ${u.content.creatures.ids().join(', ')}.`;
  const id = u.ids.alloc('creature');
  const name = o.name ?? NAMES[hash32(id, u.seed, 0xc2e) % NAMES.length];
  const desires: Record<string, number> = {};
  for (const b of CREATURE_BEHAVIOURS) desires[b] = r3(def.desires[b] ?? 0.1);
  const c: CreatureState = {
    id, planet: p.id, name, template: def.id, god: o.god, settlement: o.settlement ?? -1,
    pos: norm(pos), from: norm(pos), to: norm(pos), t0: u.tick, t1: u.tick, heading: 0,
    height: def.size[0], growth: 0, alignment: 0, hunger: 0.3, energy: 0.9, strength: def.strength * 0.5, intelligence: def.intelligence,
    desires, miracles: { ...(def.miracles ?? {}) }, last: { kind: 'none', tick: u.tick, target: -1, obj: '' },
    doing: { kind: 'idle', until: u.tick, target: -1, obj: '', at: null, acted: true }, leash: null, activity: 'looking around',
    anim: AnimState.idle, held: null, trust: o.god >= 0 ? 0.5 : 0.3, next: u.tick + 1, born: u.tick, counts: {}, alive: true, upd: u.tick,
  };
  if (o.settlement !== undefined && o.settlement >= 0) c.leash = { mode: 'tend', settlement: o.settlement, point: null, length: 900 };
  u.god.creatures.push(c);
  u.god.creatures.sort((a, b) => a.id - b.id);
  return c;
}

// ───────────────────────────── where it is ─────────────────────────────

export function creaturePos(c: CreatureState, tick: number): V3 {
  if (tick >= c.t1 || c.t1 <= c.t0) return [c.to[0], c.to[1], c.to[2]];
  const k = clamp((tick - c.t0) / (c.t1 - c.t0), 0, 1);
  return norm([c.from[0] + (c.to[0] - c.from[0]) * k, c.from[1] + (c.to[1] - c.from[1]) * k, c.from[2] + (c.to[2] - c.from[2]) * k]);
}

function defOf(u: Universe, c: CreatureState): CreatureDef {
  return u.content.creatures.find(c.template) ?? u.content.creatures.list[0];
}

/** metres per tick (a grown creature strides further) */
function speedOf(u: Universe, c: CreatureState): number {
  return defOf(u, c).speed * 60 * (0.6 + c.growth * 0.9) * (c.energy < 0.15 ? 0.5 : 1);
}

function walk(u: Universe, p: Planet, c: CreatureState, to: V3): number {
  const from = creaturePos(c, u.tick);
  const d = distM(p, from, to);
  const t = Math.max(1, Math.ceil(d / Math.max(1, speedOf(u, c))));
  c.from = from; c.to = norm(to); c.t0 = u.tick; c.t1 = u.tick + t;
  if (d > 1) c.heading = r3(headingOf(from, tangent(from, [to[0] - from[0], to[1] - from[1], to[2] - from[2]])));
  c.pos = from;
  return t;
}

/** the leash's anchor point */
function anchor(u: Universe, p: Planet, c: CreatureState): V3 | null {
  if (!c.leash) return c.settlement >= 0 ? stPos(p, c.settlement) : null;
  if (c.leash.settlement >= 0) return stPos(p, c.leash.settlement);
  return c.leash.point;
}

function stPos(p: Planet, sid: number): V3 | null {
  const st = p.people?.settlement(sid);
  return st && st.fallen < 0 ? [st.pos[0], st.pos[1], st.pos[2]] : null;
}

function homeSettlement(p: Planet, c: CreatureState): Settlement | null {
  const sid = c.leash?.settlement ?? c.settlement;
  if (sid !== undefined && sid >= 0) { const st = p.people?.settlement(sid); if (st && st.fallen < 0) return st; }
  return nearestSettlement(p, c.pos, 900, (s) => !s.band);
}

// ───────────────────────────── the brain ─────────────────────────────

/** every tick: wake the creatures whose walk or act is over */
export function creaturesStep(u: Universe): void {
  const list = u.god.creatures;
  if (!list.length) return;
  for (const c of list) {
    if (!c.alive || c.held || u.tick < c.next) continue;
    const p = u.planet(c.planet);
    if (!p || !p.alive) { c.alive = false; continue; }
    upkeep(u, c);
    c.pos = creaturePos(c, u.tick);
    if (!c.doing.acted) {
      act(u, p, c);
      c.doing.acted = true;
      c.next = Math.max(u.tick + 1, c.doing.until);
      continue;
    }
    think(u, p, c);
  }
}

/** hunger, energy and growth since the last wake */
function upkeep(u: Universe, c: CreatureState): void {
  const def = defOf(u, c);
  const h = Math.max(0, (u.tick - c.upd) / 60);
  c.upd = u.tick;
  if (h <= 0) return;
  const sleeping = c.doing.kind === 'sleep' && c.doing.acted;
  c.hunger = r3(clamp(c.hunger + def.appetite * h * (sleeping ? 0.5 : 1), 0, 1));
  c.energy = r3(clamp(c.energy + (sleeping ? 0.14 : -0.022) * h, 0, 1));
  const fed = c.hunger < 0.6 ? 1 : 0.15;
  c.growth = Math.round(clamp(c.growth + 0.0006 * h * fed * u.god.law('creature.growth'), 0, 1) * 10000) / 10000;
  c.height = r3(def.size[0] + (def.size[1] - def.size[0]) * c.growth);
  c.strength = r3(def.strength * (0.5 + c.growth) * (c.hunger > 0.9 ? 0.7 : 1));
}

const _U = new Map<string, number>();

function think(u: Universe, p: Planet, c: CreatureState): void {
  const D = c.desires;
  const home = homeSettlement(p, c);
  const anc = anchor(u, p, c);
  const mode = c.leash?.mode ?? '';
  // a leashed creature that strayed comes back first
  if (c.leash && anc && distM(p, c.pos, anc) > c.leash.length) {
    const t = walk(u, p, c, moveBy(anc, bearingDir(anc, hashFloat(c.id, u.tick, 0x1ea) * 6.283), c.leash.length * 0.3, p.st.radius));
    begin(c, 'return', u.tick + t, -1, 'home', null);
    c.activity = 'coming back to its leash';
    c.anim = AnimState.walk;
    c.doing.acted = true;
    c.next = u.tick + t;
    return;
  }
  const night = isNight(u, p, c.pos);
  const need = home ? villageNeed(u, p, home) : 0;
  const peopleNear = !!p.people && p.people.agents.count > 0;
  const enemies = home ? enemyTarget(u, p, c, home) : null;
  const knows = Object.keys(c.miracles).some((k) => (c.miracles[k] ?? 0) > 0.05);
  const hand = u.god.hand(Math.max(0, c.god));
  _U.clear();
  _U.set('eat', D.eat * (Math.pow(c.hunger, 1.5) * 2.4 + 0.05));
  _U.set('eat-people', peopleNear ? D['eat-people'] * c.hunger * 1.8 : 0);
  _U.set('sleep', D.sleep * (Math.pow(1 - c.energy, 2) * 2.6 + (night ? 0.35 : 0)));
  _U.set('play', D.play * c.energy * 0.55);
  _U.set('throw', D.throw * c.energy * 0.45);
  _U.set('throw-people', peopleNear ? D['throw-people'] * c.energy * 0.45 : 0);
  _U.set('help', home ? D.help * (mode === 'tend' ? 1.3 : 0.45) * (0.3 + need) : 0);
  _U.set('attack', D.attack * (enemies ? 1 : 0.12) * (mode === 'defend' ? 1.6 : mode === 'terrify' ? 1.1 : 0.6));
  _U.set('cast', knows ? D.cast * (need > 0.2 ? 1 : 0.3) * (mode === 'impress' ? 1.4 : 1) : 0);
  _U.set('impress', home ? D.impress * (mode === 'impress' ? 1.3 : 0.35) : 0);
  _U.set('terrify', home ? D.terrify * (mode === 'terrify' ? 1.3 : 0.25) : 0);
  _U.set('poop', D.poop * ((c.counts._meal ?? 0) > 0 ? 0.9 : 0));
  _U.set('explore', D.explore * c.energy * (mode === 'explore' ? 1.5 : c.leash ? 0.25 : 0.6));
  _U.set('follow', hand && hand.planet === p.id && !c.leash ? D.follow * 0.6 : 0);
  // a little deterministic whim, and tiredness wins at the end of its strength
  let best = 'explore', bv = -Infinity;
  for (const k of CREATURE_BEHAVIOURS) {
    const v = (_U.get(k) ?? 0) + (hashFloat(c.id, u.tick, k.length * 131 + k.charCodeAt(0), 0xb4a1) - 0.5) * 0.12;
    if (v > bv) { bv = v; best = k; }
  }
  if (c.energy < 0.06) best = 'sleep';
  if (!plan(u, p, c, best, home, enemies)) {
    // nothing to do that way: stand and look about for a while
    begin(c, 'idle', u.tick + 20, -1, '', null);
    c.activity = 'looking around';
    c.anim = AnimState.idle;
    c.doing.acted = true;
    c.next = u.tick + 20;
  }
}

function begin(c: CreatureState, kind: string, until: number, target: number, obj: string, at: V3 | null): void {
  c.doing = { kind, until, target, obj, at, acted: false };
}

function isNight(u: Universe, p: Planet, pos: ArrayLike<number>): boolean {
  const s = u.sun(p, u.tick).dir;
  return pos[0] * s[0] + pos[1] * s[1] + pos[2] * s[2] < -0.05;
}

/** how much its village needs help 0..1 (hunger, thirsty fields, sites unbuilt, the sick) */
function villageNeed(u: Universe, p: Planet, st: Settlement): number {
  const x = makeCtx(u, p);
  const pop = (x.ps.members.get(st.id)?.length ?? 0) + 1;
  let n = 0;
  if (foodDays(x, st) < pop * 3) n += 0.5;
  if (st.sites.length) n += 0.3;
  if (st.fields.some((c) => p.f.moisture[c] < 0.25)) n += 0.3;
  const A = x.A;
  for (const m of x.ps.members.get(st.id) ?? []) if (A.disease[m] >= 0 || A.health[m] < 0.5) { n += 0.3; break; }
  return Math.min(1, n);
}

function enemyTarget(u: Universe, p: Planet, c: CreatureState, home: Settlement): Settlement | null {
  const x = makeCtx(u, p);
  const foes = enemiesOf(x, home.polity);
  let best: Settlement | null = null, bd = Infinity;
  for (const st of x.ps.settlements) {
    if (st.fallen >= 0 || st.id === home.id || st.band) continue;
    const hostile = foes.includes(st.polity) || (c.god >= 0 && st.god >= 0 && st.god !== c.god && (st.faith[st.god] ?? 0) > 0.2);
    if (!hostile) continue;
    const d = distM(p, st.pos, c.pos);
    if (d < bd && d < 3000) { bd = d; best = st; }
  }
  return best;
}

/** choose the target of a behaviour and walk there; false = nothing to do that way */
function plan(u: Universe, p: Planet, c: CreatureState, kind: string, home: Settlement | null, enemy: Settlement | null): boolean {
  const def = defOf(u, c);
  const here = c.pos;
  const ps = p.people;
  let to: V3 | null = null;
  let obj = '';
  let target = -1;
  const pt = [0, 0, 0];
  switch (kind) {
    case 'eat': {
      for (const food of def.diet) {
        if (food === 'people') continue;
        if (food === 'animal' && ps) {
          let bd = 700;
          for (const h of ps.herds) {
            herdPos(h, u.tick, pt);
            const d = distM(p, pt, here);
            if (d < bd && h.count >= 1) { bd = d; to = [pt[0], pt[1], pt[2]]; target = h.id; obj = h.owner >= 0 ? 'livestock' : 'animal'; }
          }
        } else if (food === 'store' && home && foodDays(makeCtx(u, p), home) > 0.5) { to = [...home.pos] as V3; target = home.id; obj = 'store'; }
        else if (food === 'crop' || food === 'tree' || food === 'grass') {
          const field = food === 'crop' ? p.f.crop : food === 'tree' ? p.f.tree : p.f.grass;
          const cells = p.cellsNear(here, 500);
          let bv = food === 'grass' ? 0.25 : 0.15, bc = -1;
          for (const cc of cells) if (field[cc] > bv) { bv = field[cc]; bc = cc; }
          if (bc >= 0) { to = cellPos3(p, bc); target = bc; obj = food; }
        } else if (food === 'fish') {
          for (const cc of p.cellsNear(here, 500)) if (p.f.water[cc] > 1) { to = cellPos3(p, cc); target = cc; obj = 'fish'; break; }
        }
        if (to) break;
      }
      break;
    }
    case 'eat-people':
    case 'throw-people': {
      if (!ps) break;
      const A = ps.agents;
      let bd = 600;
      for (let s = 0; s < A.hi; s++) {
        if (!A.alive[s] || u.god.isHeld('agent', A.id[s])) continue;
        A.posAt(s, u.tick, pt);
        const d = distM(p, pt, here);
        if (d < bd) { bd = d; to = [pt[0], pt[1], pt[2]]; target = A.id[s]; obj = 'people'; }
      }
      break;
    }
    case 'sleep': to = here; obj = 'ground'; break;
    case 'play': case 'throw': case 'poop': case 'explore': {
      const anc = anchor(u, p, c);
      const base = kind === 'explore' ? here : anc ?? here;
      const dist = kind === 'explore' ? 400 + 800 * hashFloat(c.id, u.tick, 0xe7) : 40 + 160 * hashFloat(c.id, u.tick, 0xe8);
      let goal = moveBy(base, bearingDir(base, hashFloat(c.id, u.tick, 0xe9) * 6.283), dist, p.st.radius);
      if (kind === 'poop' && home && home.fields.length) { goal = cellPos3(p, home.fields[hash32(c.id, u.tick) % home.fields.length]); obj = 'field'; }
      if (c.leash && anc && distM(p, goal, anc) > c.leash.length) goal = moveBy(anc, bearingDir(anc, hashFloat(c.id, u.tick, 0xea) * 6.283), c.leash.length * 0.6, p.st.radius);
      to = goal;
      obj ||= kind === 'throw' ? 'rock' : kind;
      break;
    }
    case 'help': case 'impress': case 'terrify': case 'cast': {
      if (!home) break;
      to = moveBy(home.pos, bearingDir(home.pos, hashFloat(c.id, u.tick, 0xeb) * 6.283), Math.min(home.territory * 0.6, 60), p.st.radius);
      target = home.id;
      obj = kind === 'cast' ? pickMiracle(u, p, c, home) ?? '' : home.name;
      if (kind === 'cast' && !obj) to = null;
      break;
    }
    case 'attack': {
      if (!enemy) break;
      to = [...enemy.pos] as V3; target = enemy.id; obj = 'settlement';
      break;
    }
    case 'follow': {
      const h = u.god.hand(Math.max(0, c.god));
      if (!h || h.planet !== p.id) break;
      to = moveBy(h.pos, bearingDir(h.pos, hashFloat(c.id, u.tick, 0xec) * 6.283), 25, p.st.radius);
      obj = 'hand';
      break;
    }
  }
  if (!to) return false;
  const t = walk(u, p, c, to);
  begin(c, kind, u.tick + t, target, obj, to);
  c.next = u.tick + t;
  c.anim = t > 1 ? (kind === 'attack' || kind === 'eat-people' ? AnimState.run : AnimState.walk) : AnimState.idle;
  c.activity = describe(kind, obj, home) + (t > 1 ? ' (on the way)' : '');
  return true;
}

function describe(kind: string, obj: string, home: Settlement | null): string {
  const v = home ? home.name : 'the land';
  switch (kind) {
    case 'eat': return obj === 'store' ? `raiding the stores of ${v}` : obj === 'livestock' ? 'eating the herds' : `eating ${obj === 'animal' ? 'wild beasts' : obj}`;
    case 'eat-people': return 'hunting people';
    case 'throw-people': return 'picking up a person';
    case 'sleep': return 'sleeping';
    case 'play': return 'playing';
    case 'throw': return 'throwing rocks';
    case 'help': return `helping ${v}`;
    case 'attack': return 'attacking its enemies';
    case 'cast': return `calling ${obj} for ${v}`;
    case 'impress': return `showing off to ${v}`;
    case 'terrify': return `terrifying ${v}`;
    case 'poop': return 'leaving a pile on the fields';
    case 'explore': return 'exploring';
    case 'follow': return 'following your hand';
    default: return kind;
  }
}

function pickMiracle(u: Universe, p: Planet, c: CreatureState, home: Settlement): string | null {
  const x = makeCtx(u, p);
  const know = (k: string) => (c.miracles[k] ?? 0) > 0.05;
  const pop = (x.ps.members.get(home.id)?.length ?? 0) + 1;
  const wants: string[] = [];
  if (home.fields.some((cc) => p.f.moisture[cc] < 0.3) || p.f.fire[home.cell] > 0) wants.push('water');
  for (const m of x.ps.members.get(home.id) ?? []) if (x.A.disease[m] >= 0 || x.A.health[m] < 0.5) { wants.push('heal'); break; }
  if (foodDays(x, home) < pop * 3) wants.push('food', 'fertility');
  if (x.ps.of(home.id).some((b) => b.progress >= 1 && b.fuel <= 0 && x.c.buildings.list[b.type].heat > 0)) wants.push('fire');
  if (home.sites.length) wants.push('wood');
  if (c.leash?.mode === 'terrify' || c.leash?.mode === 'defend') wants.push('lightning', 'storm', 'fireball');
  wants.push('forest', 'calm', 'shield', 'storm', 'water');
  for (const w of wants) if (know(w)) return w;
  return null;
}

/** at the destination: do it */
function act(u: Universe, p: Planet, c: CreatureState): void {
  const kind = c.doing.kind;
  const obj = c.doing.obj;
  const at = c.pos;
  const ps = p.people;
  const g = Math.max(0, c.god);
  let dur = 30;
  c.anim = AnimState.idle;
  const home = homeSettlement(p, c);
  switch (kind) {
    case 'eat': {
      dur = 40;
      c.anim = AnimState.eat;
      if (obj === 'animal' || obj === 'livestock') {
        const h = ps?.herd(c.doing.target);
        if (h && h.count >= 0.5) {
          const n = Math.min(h.count, 1 + Math.round(c.growth * 2));
          h.count = Math.round((h.count - n) * 1000) / 1000;
          h.state = 2; h.scared = u.tick;
          c.hunger = r3(Math.max(0, c.hunger - 0.25 * n));
          if (obj === 'livestock') { const owner = ps!.settlement(h.owner); if (owner) godAct(u, p, owner.pos, owner.territory + 100, { harm: 0.2 }, g); }
          if (h.count < 0.5) ps!.herds = ps!.herds.filter((q) => q !== h);
          ps!.version++;
        }
      } else if (obj === 'store' && home && ps) {
        const x = makeCtx(u, p);
        let got = 0;
        for (const it of x.info[home.species].foods) { if (got >= 8) break; got += storeTake(home, it, Math.min(8 - got, home.store[it] ?? 0)); }
        c.hunger = r3(Math.max(0, c.hunger - 0.06 * got));
        godAct(u, p, home.pos, home.territory + 50, { harm: 0.25 }, g);
      } else if (obj === 'crop' || obj === 'tree' || obj === 'grass') {
        const field = obj === 'crop' ? p.f.crop : obj === 'tree' ? p.f.tree : p.f.grass;
        for (const cc of p.cellsNear(at, 30 + c.height)) field[cc] = Math.max(0, field[cc] - (obj === 'tree' ? 0.08 : 0.3));
        p.bump(obj === 'crop' ? 'crop' : obj === 'tree' ? 'tree' : 'grass'); p.vegDirty = true;
        c.hunger = r3(Math.max(0, c.hunger - (obj === 'crop' ? 0.35 : 0.2)));
        if (obj === 'crop') { const st = nearestSettlement(p, at, 400); if (st) godAct(u, p, st.pos, st.territory + 50, { harm: 0.12 }, g); }
      } else if (obj === 'fish') c.hunger = r3(Math.max(0, c.hunger - 0.3));
      c.counts._meal = 1;
      break;
    }
    case 'eat-people': {
      dur = 40;
      c.anim = AnimState.eat;
      if (ps) {
        const x = makeCtx(u, p);
        const s = x.A.slotOf(c.doing.target);
        if (s >= 0) {
          const name = agentName(x, s);
          const st = x.ps.settlement(x.A.settlement[s]);
          die(x, s, DEATH.predator);
          c.hunger = r3(Math.max(0, c.hunger - 0.6));
          godAct(u, p, at, 500, { harm: 1 }, g);
          if (st) tell(u, p, 'creature.eat', vars(x, st, -1, { agent: name, animal: c.name, text: `${c.name} ate ${name} of ${st.name}.` }), st, [settlementRef(x, st)], 2);
        }
      }
      c.counts._meal = 1;
      break;
    }
    case 'sleep':
      dur = 120 + Math.round(240 * (1 - c.energy));
      c.anim = AnimState.sleep;
      break;
    case 'play':
      dur = 30;
      c.anim = AnimState.dance;
      godAct(u, p, at, 200, { wonder: 0.08 }, g);
      break;
    case 'throw': {
      dur = 20;
      c.anim = AnimState.work;
      const b = hashFloat(c.id, u.tick, 0x7b) * 6.283;
      const dir = bearingDir(at, b);
      const sp = 15 + 10 * c.growth;
      launch(u, p, { kind: 'rock', mass: 200 + 800 * c.growth }, at, c.height * 0.8, [dir[0] * sp + at[0] * sp * 0.7, dir[1] * sp + at[1] * sp * 0.7, dir[2] * sp + at[2] * sp * 0.7], g);
      break;
    }
    case 'throw-people': {
      dur = 20;
      c.anim = AnimState.work;
      if (ps) {
        const x = makeCtx(u, p);
        const s = x.A.slotOf(c.doing.target);
        if (s >= 0) {
          const pt = [0, 0, 0];
          x.A.posAt(s, u.tick, pt);
          const dir = bearingDir(pt, hashFloat(c.id, u.tick, 0x7c) * 6.283);
          const sp = 14 + 12 * c.growth;
          launch(u, p, { kind: 'agent', id: c.doing.target }, [pt[0], pt[1], pt[2]], c.height * 0.8, [dir[0] * sp + pt[0] * sp * 0.8, dir[1] * sp + pt[1] * sp * 0.8, dir[2] * sp + pt[2] * sp * 0.8], g);
          godAct(u, p, pt, 300, { harm: 0.6, wonder: 0.2 }, g);
        }
      }
      break;
    }
    case 'help': {
      dur = 60;
      c.anim = AnimState.work;
      if (home && ps) helpVillage(u, p, c, home);
      break;
    }
    case 'attack': {
      dur = 30;
      c.anim = AnimState.fight;
      const st = ps?.settlement(c.doing.target);
      if (st) {
        const k = 0.5 + c.strength / 8;
        wreckBuildings(u, p, at, 20 + c.height, 0.9 * k, 'creature');
        hurtPeople(u, p, at, 20 + c.height, 0.6 * k, DEATH.predator, { chance: 0.6, salt: c.id, fear: 0.5 });
        godAct(u, p, st.pos, st.territory + 200, { harm: 0.6 }, g);
      }
      break;
    }
    case 'cast': {
      dur = 30;
      c.anim = AnimState.pray;
      const m = obj;
      const skill = c.miracles[m] ?? 0;
      if (skill > 0.05) {
        const r = castMiracle(u, p, m, at, { god: g, by: 'creature', power: clamp(skill * (0.5 + c.intelligence / 10), 0.1, 2) });
        if (r.ok) c.alignment = r3(clamp(c.alignment + (MIRACLE_VALENCE[m] ?? 0), -1, 1));
        c.counts[`cast.${m}`] = (c.counts[`cast.${m}`] ?? 0) + 1;
      }
      break;
    }
    case 'impress':
      dur = 40;
      c.anim = AnimState.dance;
      if (home) godAct(u, p, home.pos, home.territory + 150, { wonder: 0.4 + c.growth * 0.3, help: 0.05 }, g);
      break;
    case 'terrify': {
      dur = 30;
      c.anim = AnimState.fight;
      if (home && ps) {
        godAct(u, p, home.pos, home.territory + 150, { harm: 0.35 + c.growth * 0.2 }, g);
        const x = makeCtx(u, p);
        for (const m of (x.ps.members.get(home.id) ?? []).slice(0, 30)) if (!(x.A.flags[m] & AgentFlag.possessed) && !u.god.isHeld('agent', x.A.id[m])) { x.A.fear[m * 4] = Math.min(1, x.A.fear[m * 4] + 0.05); x.A.remember(m, MEMK.fear, u.tick, 0); interrupt(x, m); }
      }
      break;
    }
    case 'poop': {
      dur = 15;
      for (const cc of p.cellsNear(at, 40 + c.height)) p.f.fertility[cc] = Math.min(1, p.f.fertility[cc] + 0.25);
      p.bump('fertility');
      c.counts._meal = 0;
      break;
    }
    case 'explore': case 'follow': case 'return':
      dur = 10;
      break;
  }
  c.doing.until = u.tick + dur;
  c.activity = describe(kind, obj, home);
  // what it did is what a stroke or a slap will judge
  if (kind !== 'return' && kind !== 'idle') {
    c.last = { kind, tick: u.tick, target: c.doing.target, obj };
    c.counts[kind] = (c.counts[kind] ?? 0) + 1;
    c.alignment = r3(clamp(c.alignment + (VALENCE[kind] ?? 0), -1, 1));
  }
}

/** help the village with whatever it lacks */
function helpVillage(u: Universe, p: Planet, c: CreatureState, st: Settlement): void {
  const x = makeCtx(u, p);
  const g = Math.max(0, c.god);
  // a building site: carry and lift
  const site = st.sites.map((id) => x.ps.building(id)).find((b) => b && !(b.flags & BuildingFlag.ruined));
  if (site) {
    const def = x.c.buildings.list[site.type];
    site.delivered = Math.min(def.cost, site.delivered + Math.max(2, def.cost * 0.4));
    workOn(x, st, site, 240, 0.9);
    c.doing.obj = 'building';
    godAct(u, p, st.pos, st.territory + 100, { help: 0.3 }, g);
    return;
  }
  // thirsty fields
  const dry = st.fields.filter((cc) => p.f.moisture[cc] < 0.3);
  if (dry.length) {
    for (const cc of dry.slice(0, 12)) p.f.moisture[cc] = Math.min(1, p.f.moisture[cc] + 0.35);
    p.bump('moisture');
    c.doing.obj = 'water';
    godAct(u, p, st.pos, st.territory + 100, { help: 0.3 }, g);
    return;
  }
  // hungry people: it hunts and brings the meat
  const pop = (x.ps.members.get(st.id)?.length ?? 0) + 1;
  if (foodDays(x, st) < pop * 3) {
    const meat = x.c.items.idx('meat');
    if (meat >= 0) storeAdd(x, st, meat, 6 + Math.round(6 * c.growth));
    c.doing.obj = 'food';
    godAct(u, p, st.pos, st.territory + 100, { help: 0.35 }, g);
    return;
  }
  // else wood for the fires
  const wood = x.c.items.idx('wood');
  if (wood >= 0) storeAdd(x, st, wood, 5);
  c.doing.obj = 'wood';
  godAct(u, p, st.pos, st.territory + 100, { help: 0.15 }, g);
}

// ───────────────────────────── learning ─────────────────────────────

function learnRate(u: Universe, c: CreatureState): number {
  return u.god.law('creature.learning') * (0.4 + c.intelligence / 10);
}

/** a stroke: the last behaviour pleased its god */
export function rewardCreature(u: Universe, c: CreatureState, amount: number): string {
  const k = c.last.kind;
  c.trust = r3(clamp(c.trust + 0.1 * amount, -1, 1));
  c.energy = r3(clamp(c.energy + 0.03, 0, 1));
  if (k === 'none') return `${c.name} leans into your hand.`;
  const before = c.desires[k] ?? 0;
  c.desires[k] = r3(clamp(before + 0.2 * amount * learnRate(u, c) * (1 - before * 0.5), 0, 1));
  c.counts.rewarded = (c.counts.rewarded ?? 0) + 1;
  u.emit({ t: 'creature.reward', planet: c.planet, pos: [...c.pos], a: c.desires[k], text: k, ref: { kind: 'creature', id: c.id, planet: c.planet }, data: { behaviour: k, before, after: c.desires[k] } });
  return `${c.name} learns that ${behaviourWords(k, c.last.obj)} pleases you (${Math.round(before * 100)}% → ${Math.round(c.desires[k] * 100)}%).`;
}

/** a slap: the last behaviour displeased its god */
export function punishCreature(u: Universe, c: CreatureState, amount: number): string {
  const k = c.last.kind;
  c.trust = r3(clamp(c.trust - 0.06 * amount, -1, 1));
  c.energy = r3(clamp(c.energy - 0.05 * amount, 0, 1));
  if (k === 'none') return `${c.name} flinches. It does not know what it did.`;
  const before = c.desires[k] ?? 0;
  c.desires[k] = r3(clamp(before - 0.25 * amount * learnRate(u, c) * (0.5 + before * 0.5), 0, 1));
  c.counts.punished = (c.counts.punished ?? 0) + 1;
  u.emit({ t: 'creature.punish', planet: c.planet, pos: [...c.pos], a: c.desires[k], text: k, ref: { kind: 'creature', id: c.id, planet: c.planet }, data: { behaviour: k, before, after: c.desires[k] } });
  return `${c.name} learns not to ${behaviourWords(k, c.last.obj, true)} (${Math.round(before * 100)}% → ${Math.round(c.desires[k] * 100)}%).`;
}

function behaviourWords(k: string, obj: string, bare = false): string {
  const w: Record<string, [string, string]> = {
    eat: [`eating ${obj || 'that'}`, `eat ${obj || 'that'}`], 'eat-people': ['eating people', 'eat people'], sleep: ['sleeping', 'sleep then'],
    play: ['playing', 'play like that'], throw: ['throwing things', 'throw things'], 'throw-people': ['throwing people', 'throw people'],
    help: ['helping the village', 'help that way'], attack: ['attacking', 'attack'], cast: [`calling ${obj || 'miracles'}`, `call ${obj || 'miracles'}`],
    impress: ['showing off', 'show off'], terrify: ['frightening people', 'frighten people'], poop: ['fertilising the fields', 'leave piles on the fields'],
    explore: ['wandering', 'wander off'], follow: ['following you', 'follow you'],
  };
  return (w[k] ?? [k, k])[bare ? 1 : 0];
}

/** a miracle cast near a creature: it watches, and learns it (better each time) */
function watch(u: Universe, p: Planet, pos: ArrayLike<number>, miracle: string, god: number): void {
  if (!(MIRACLES as readonly string[]).includes(miracle)) return;
  for (const c of u.god.creatures) {
    if (!c.alive || c.planet !== p.id) continue;
    const cp = creaturePos(c, u.tick);
    if (distM(p, cp, pos) > 650) continue;
    const before = c.miracles[miracle] ?? 0;
    const gain = 0.2 * learnRate(u, c) * (c.god === god ? 1 : 0.5);
    c.miracles[miracle] = r3(Math.min(1, Math.max(before, 0.12) + gain * (1 - before)));
    if (before <= 0.05) {
      u.emit({ t: 'creature.learned', planet: p.id, pos: cp, a: c.miracles[miracle], text: miracle, ref: { kind: 'creature', id: c.id, planet: p.id }, data: { miracle } });
      u.chronicleAdd(p, 'god', `${c.name} watched the god call ${miracle}, and tried it for itself.`, 1, [{ kind: 'creature', id: c.id, planet: p.id }]);
    }
  }
}
watchHooks.push(watch);

// ───────────────────────────── a people raises its own ─────────────────────────────

/** daily: a settlement with animal husbandry and a sacred beast may raise a creature of that kind */
export function raiseCreatures(u: Universe, p: Planet): void {
  const ps = p.people;
  if (!ps || !ps.settlements.length || !u.content.creatures.size) return;
  const x = makeCtx(u, p);
  const husbandry = ['animal-husbandry', 'dog-taming', 'pasture'].map((k) => x.rt.byId.get(k)).filter((k): k is number => k !== undefined);
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    if (!husbandry.some((k) => st.library.includes(k))) continue;
    const sacred = st.culture.sacred.filter((s) => s.startsWith('animal:')).map((s) => s.slice(7));
    if (!sacred.length) continue;
    if (u.god.creatures.some((c) => c.alive && c.settlement === st.id && c.planet === p.id)) continue;
    const tpl = u.content.creatures.list.find((t) => (t.animals ?? []).some((a) => sacred.includes(a)));
    if (!tpl || hashFloat(st.id, u.tick, 0xc4ea) >= 0.06) continue;
    const c = adoptCreature(u, p, tpl.id, [...st.pos] as V3, { god: st.god, settlement: st.id });
    if (typeof c === 'string') continue;
    c.leash = { mode: st.culture.alignment < -0.25 ? 'defend' : 'tend', settlement: st.id, point: null, length: 900 };
    tell(u, p, 'creature.raised', vars(x, st, -1, { animal: tpl.name.toLowerCase(), text: `The people of ${st.name} raised a sacred ${tpl.name.toLowerCase()} until it stood taller than their houses. They call it ${c.name}.` }), st, [settlementRef(x, st), { kind: 'creature', id: c.id, planet: p.id }], 2);
  }
}

// ───────────────────────────── views ─────────────────────────────

export function creatureViews(u: Universe): CreatureView[] {
  const out: CreatureView[] = [];
  for (const c of u.god.creatures) {
    if (!c.alive) continue;
    const def = defOf(u, c);
    const h = u.god.hands.find((hh) => hh.held?.kind === 'creature' && hh.held.id === c.id);
    const pos = h ? h.pos : creaturePos(c, u.tick);
    const fat = clamp(0.55 - c.hunger * 0.5 + Math.max(0, c.alignment) * 0.25, 0, 1);
    const strong = clamp(c.strength / 10, 0, 1);
    const spiky = clamp(-c.alignment, 0, 1);
    const glow = clamp(c.alignment, 0, 1);
    const anim = (h ? AnimState.held : u.tick < c.t1 ? (c.anim === AnimState.idle ? AnimState.walk : c.anim) : c.anim) as AnimStateId;
    out.push({
      id: c.id, planet: c.planet, name: c.name, body: def.body, pos: [pos[0], pos[1], pos[2]], heading: c.heading, height: c.height,
      alignment: c.alignment, anim, phase: (hash32(c.id, 0xa5) >>> 8) / 16777216, activity: c.activity,
      leash: c.leash?.settlement ?? (c.settlement >= 0 ? c.settlement : -1), held: null, hunger: c.hunger, energy: c.energy,
      morph: [r3(fat), r3(strong), r3(spiky), r3(glow)],
    });
  }
  return out;
}

// ───────────────────────────── commands ─────────────────────────────

const cPos: ParamSchema = { type: 'pos', desc: 'where (unit vector or lat/lon)' };
const cId: ParamSchema = { type: 'int', min: 1, desc: 'creature id (default: your first)' };

/** the creature a command means: an id, else the actor's first living one */
function pick(u: Universe, a: Record<string, unknown>, god: number): CreatureState | undefined {
  if (typeof a.id === 'number') return u.god.creature(a.id);
  if (typeof a.creature === 'number') return u.god.creature(a.creature);
  if (typeof a.name === 'string') { const n = a.name.toLowerCase(); const c = u.god.creatures.find((q) => q.alive && q.name.toLowerCase() === n); if (c) return c; }
  return u.god.creatures.find((c) => c.alive && c.god === god) ?? u.god.creatures.find((c) => c.alive);
}

export function registerCreatureCommands(r: CommandRegistry): void {
  r.register('creature.adopt', ({ u, p, cmd }, a) => {
    const g = actor(cmd);
    const c = adoptCreature(u, p, String(a.template), norm(a.pos ?? herePos(u, p)), { god: g, name: typeof a.name === 'string' && a.name ? a.name.slice(0, 30) : undefined });
    if (typeof c === 'string') return fail(c);
    const st = nearestSettlement(p, c.pos, 1500);
    u.chronicleAdd(p, 'god', `The god took a young ${defOf(u, c).name.toLowerCase()} for its own and named it ${c.name}.`, 2, [{ kind: 'creature', id: c.id, planet: p.id }]);
    if (st) godAct(u, p, c.pos, 400, { wonder: 0.4 }, g);
    return ok(`${c.name} the ${defOf(u, c).name.toLowerCase()} is yours. Stroke what you want it to do again; slap what you do not.`, [{ kind: 'creature', id: c.id, planet: p.id }]);
  }, { desc: 'Adopt a creature', category: 'Creature', params: { template: { type: 'enum', values: (u) => u.content.creatures.ids(), default: 'ape' }, pos: cPos, name: { type: 'string' } } });

  r.register('creature.leash', ({ u, p, cmd }, a) => {
    const c = pick(u, a, actor(cmd));
    if (!c) return fail('You have no creature. Adopt one first.');
    let sid = -1;
    if (typeof a.settlement === 'number') sid = a.settlement;
    else if (typeof a.settlement === 'string') { const n = a.settlement.toLowerCase(); sid = p.people?.settlements.find((s) => s.name.toLowerCase().startsWith(n))?.id ?? -1; }
    const point = a.pos ? norm(a.pos) : null;
    if (sid < 0 && !point) { const st = nearestSettlement(p, creaturePos(c, u.tick), 3000); if (st) sid = st.id; }
    if (sid < 0 && !point) return fail('Leash it to what? Name a settlement or point at a place.');
    c.leash = { mode: String(a.mode ?? c.leash?.mode ?? 'tend'), settlement: sid, point: sid >= 0 ? null : point, length: Number(a.length ?? 900) };
    c.next = u.tick + 1;
    c.doing.acted = true;
    const where = sid >= 0 ? p.people?.settlement(sid)?.name ?? 'the village' : 'that place';
    return ok(`${c.name} is leashed to ${where}: ${c.leash.mode}.`);
  }, {
    desc: 'Leash the creature to a village or a point, with a mode', category: 'Creature',
    params: { id: cId, settlement: { type: 'any' }, pos: cPos, mode: { type: 'enum', values: [...LEASH_MODES] }, length: { type: 'number', min: 50, max: 20000, default: 900 } },
  });
  r.register('creature.unleash', ({ u, cmd }, a) => {
    const c = pick(u, a, actor(cmd));
    if (!c) return fail('You have no creature.');
    c.leash = null;
    return ok(`${c.name} is free to roam.`);
  }, { desc: 'Let the creature roam free', category: 'Creature', params: { id: cId } });
  r.register('creature.set-mode', ({ u, cmd }, a) => {
    const c = pick(u, a, actor(cmd));
    if (!c) return fail('You have no creature.');
    if (!c.leash) c.leash = { mode: String(a.mode), settlement: c.settlement, point: [...c.pos] as V3, length: 900 };
    else c.leash.mode = String(a.mode);
    c.next = u.tick + 1; c.doing.acted = true;
    return ok(`${c.name} will ${({ tend: 'tend its village', defend: 'defend its village', impress: 'impress the people', terrify: 'terrify the people', explore: 'explore' } as Record<string, string>)[String(a.mode)] ?? a.mode}.`);
  }, { desc: 'Set what the leashed creature should do', category: 'Creature', params: { id: cId, mode: { type: 'enum', values: [...LEASH_MODES], required: true } } });
  r.register('creature.reward', ({ u, cmd }, a) => {
    const c = pick(u, a, actor(cmd));
    if (!c) return fail('You have no creature.');
    return ok(rewardCreature(u, c, Number(a.amount ?? 1)));
  }, { desc: 'Reward the creature for what it just did', category: 'Creature', params: { id: cId, amount: { type: 'number', min: 0.1, max: 5, default: 1 } } });
  r.register('creature.punish', ({ u, cmd }, a) => {
    const c = pick(u, a, actor(cmd));
    if (!c) return fail('You have no creature.');
    return ok(punishCreature(u, c, Number(a.amount ?? 1)));
  }, { desc: 'Punish the creature for what it just did', category: 'Creature', params: { id: cId, amount: { type: 'number', min: 0.1, max: 5, default: 1 } } });
  r.register('creature.teach-by-example', ({ u, p, cmd }, a) => {
    const g = actor(cmd);
    const c = pick(u, a, g);
    if (!c) return fail('You have no creature.');
    const k = String(a.miracle);
    const cp = creaturePos(c, u.tick);
    const at = moveBy(cp, bearingDir(cp, hashFloat(c.id, u.tick, 0x7e) * 6.283), 60, p.st.radius);
    const before = c.miracles[k] ?? 0;
    const res = castMiracle(u, p, k, at, { god: g, by: 'god' });
    // watched up close and slowly: it learns faster than from a glimpse
    c.miracles[k] = r3(Math.min(1, Math.max(c.miracles[k] ?? 0, 0.12) + 0.15 * learnRate(u, c)));
    return { ok: true, msg: `${res.msg ?? ''} ${c.name} watches closely: ${k} ${Math.round(before * 100)}% → ${Math.round(c.miracles[k] * 100)}%.`.trim() };
  }, { desc: 'Cast a miracle for the creature to learn', category: 'Creature', params: { id: cId, miracle: { type: 'enum', values: [...MIRACLES], required: true } } });
  r.register('creature.move', ({ u, p, cmd }, a) => {
    const c = pick(u, a, actor(cmd));
    if (!c) return fail('You have no creature.');
    const t = walk(u, p, c, norm(a.pos ?? herePos(u, p)));
    begin(c, 'follow', u.tick + t, -1, 'hand', null);
    c.next = u.tick + t;
    return ok(`${c.name} walks there.`);
  }, { desc: 'Send the creature somewhere', category: 'Creature', params: { id: cId, pos: cPos } });
  r.register('creature.rename', ({ u, cmd }, a) => {
    const c = pick(u, { id: a.id }, actor(cmd));
    if (!c) return fail('You have no creature.');
    const before = c.name;
    c.name = String(a.to).trim().slice(0, 30) || c.name;
    return ok(`${before} is now called ${c.name}.`);
  }, { desc: 'Rename the creature', category: 'Creature', params: { id: cId, to: { type: 'string', required: true } } });
  // the god grows (or shrinks) the creature at once: years of feeding in a moment (growth 0..1 spans its kind's size)
  r.register('creature.grow', ({ u, cmd }, a) => {
    const c = pick(u, { id: a.id }, actor(cmd));
    if (!c) return fail('You have no creature.');
    upkeep(u, c);
    const def = defOf(u, c);
    const before = c.height;
    const g = Math.round(clamp(c.growth + (a.amount as number), 0, 1) * 10000) / 10000;
    if (g === c.growth) return fail(`${c.name} is already as ${(a.amount as number) > 0 ? 'big' : 'small'} as a ${def.name.toLowerCase()} can be (${r3(c.height)} m).`);
    c.growth = g;
    c.height = r3(def.size[0] + (def.size[1] - def.size[0]) * c.growth);
    c.strength = r3(def.strength * (0.5 + c.growth) * (c.hunger > 0.9 ? 0.7 : 1));
    return ok(`${c.name} ${c.height > before ? 'grows' : 'shrinks'} from ${r3(before)} m to ${r3(c.height)} m tall.`);
  }, { desc: 'Grow (or shrink) the creature at once', category: 'Creature', params: { id: cId, amount: { type: 'number', min: -1, max: 1, default: 0.25, desc: 'growth added (its kind spans 0..1)' } } });
  r.register('creature.release', ({ u, p, cmd }, a) => {
    const c = pick(u, a, actor(cmd));
    if (!c) return fail('You have no creature.');
    c.alive = false;
    u.chronicleAdd(p, 'god', `${c.name} was set free and walked out of the world's stories.`, 1);
    return ok(`${c.name} goes its own way.`);
  }, { desc: 'Set the creature free (it leaves)', category: 'Creature', params: { id: cId } });
}

export { cellPos3 };

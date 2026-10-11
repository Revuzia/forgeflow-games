// GENESIS — lookdev's god layer: a fabricated hand, creatures, disasters, weather systems, projectiles and events for
// developing and screenshotting the god-layer visuals (render/hand.ts, render/life/creature.ts, render/fx/**) without
// the sim. It answers the sim's own command names where it can (hand.move / hand.pose / hand.grab / hand.release,
// creature.adopt, disaster.spawn / cancel, weather.paint / clear, miracle.<kind>) so a shot spec reads the same on
// both backends, plus lookdev.* commands that pin a state exactly (a meteor at 40 % of its fall, a creature mid-stride,
// a field painted with lava). Disasters age with the lookdev tick and act on the fabricated fields: a meteor carves a
// crater and lights its rim when it lands, a volcano pours lava, a tsunami's wall of water runs at the coast, a
// wildfire burns, a weather system paints cloud and precipitation. It is not the sim: nothing here is deterministic
// or conserved — it only has to look like the god at work.

import type {
  Command, CommandResult, CreatureView, DisasterView, EntityRef, FieldName, HandView, MoverBlock, PlanetSnap, ProjectileView, SimEvent, UnitVec, WeatherView,
} from '../sim/types.ts';
import { AnimState } from '../sim/types.ts';
import type { IcoGrid } from '../sim/grid/icogrid.ts';
import { hashFloat } from '../sim/core/rng.ts';
import { BASE_PACK } from '../data/index.ts';

type Fields = Partial<Record<FieldName, Float32Array>>;

/** the parts of a lookdev planet the god layer touches */
export interface GodPlanet {
  snap: PlanetSnap;
  fields: Fields;
  dirty: Set<FieldName>;
  grid: IcoGrid;
}

interface LookDisaster {
  view: DisasterView;
  t0: number;
  life: number;
  /** a fixed progress (lookdev.disaster) instead of aging */
  pin: number | null;
  alt0: number;
  vel: [number, number, number];
  render: Record<string, number>;
  ended: boolean;
  lastFx: number;
  base?: { cells: number[]; water: Float32Array; surface: Float32Array };
}

interface LookCreature { view: CreatureView; speed: number; t0: number; from: UnitVec; heading0: number }
interface LookProjectile { view: ProjectileView; t0: number; pos0: UnitVec; alt0: number; vel0: [number, number, number] }

const DIS = new Map<string, { render: Record<string, number>; radius: number; intensity: number; life: [number, number]; speed?: number; name: string }>(
  ((BASE_PACK as unknown as { disasters?: { id: string; name: string; render: Record<string, number>; radius: number; intensity: number; life: [number, number]; speed?: number }[] }).disasters ?? [])
    .map((d) => [d.id, { render: d.render ?? {}, radius: d.radius, intensity: d.intensity, life: d.life, speed: d.speed, name: d.name }]),
);
const CREATURES = new Map<string, { body: string; size: [number, number]; name: string; speed: number }>(
  ((BASE_PACK as unknown as { creatures?: { id: string; body: string; size: [number, number]; name: string; speed: number }[] }).creatures ?? [])
    .map((c) => [c.id, c]),
);

function unit(v: ArrayLike<number>): UnitVec {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function latlon(lat: number, lon: number): UnitVec {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}
function posOf(c: Command, key = 'pos'): UnitVec | null {
  const p = c[key];
  if (Array.isArray(p) && p.length >= 3) return unit(p as number[]);
  if (typeof c.lat === 'number' && typeof c.lon === 'number' && key === 'pos') return latlon(c.lat, c.lon);
  return null;
}
/** a unit tangent at u pointing along `bearing` (rad, 0 north, + east) */
function bearingDir(u: UnitVec, bearing: number): UnitVec {
  let ex = u[2], ez = -u[0];
  const el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  const nx = u[1] * ez, ny = u[2] * ex - u[0] * ez, nz = -u[1] * ex;
  // east has no y component
  return unit([ex * Math.sin(bearing) + nx * Math.cos(bearing), ny * Math.cos(bearing), ez * Math.sin(bearing) + nz * Math.cos(bearing)]);
}
function angle(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

export class LookdevGod {
  private hand: HandView | null = null;
  private handPoseUntil = 0;
  private creatures: LookCreature[] = [];
  private disasters = new Map<number, LookDisaster[]>();
  private weather = new Map<number, (WeatherView & { lightning: number })[]>();
  private projectiles: LookProjectile[] = [];
  private events: SimEvent[] = [];
  private nextId = 1;
  private weatherBase = new Map<string, Float32Array>();
  activity: number | null = null;

  /** handle a command; null when it is not one of the god layer's */
  cmd(c: Command, lp: GodPlanet, tick: number): CommandResult | null {
    const R = lp.snap.params.radius;
    switch (c.k) {
      case 'hand.move': case 'lookdev.hand': {
        const p = posOf(c) ?? this.hand?.pos ?? [0, 1, 0];
        this.hand = { planet: lp.snap.id, pos: p, alt: typeof c.alt === 'number' ? c.alt : this.hand?.alt ?? 8, held: this.hand?.held ?? null, pose: typeof c.pose === 'string' ? c.pose : this.hand?.pose ?? 'open', alignment: typeof c.alignment === 'number' ? c.alignment : this.hand?.alignment ?? 0 };
        if (c.k === 'lookdev.hand' && c.held && typeof c.held === 'object') this.hand.held = { kind: String((c.held as { kind: string }).kind) as EntityRef['kind'], id: Number((c.held as { id: number }).id) };
        if (c.k === 'lookdev.hand' && c.held === null) this.hand.held = null;
        this.handPoseUntil = 0;
        return { ok: true, msg: 'The hand moves.' };
      }
      case 'hand.pose': {
        if (!this.hand) this.hand = { planet: lp.snap.id, pos: [0, 1, 0], alt: 8, held: null, pose: 'open', alignment: 0 };
        this.hand.pose = String(c.pose ?? 'open');
        this.handPoseUntil = typeof c.ticks === 'number' ? tick + c.ticks : 0;
        return { ok: true };
      }
      case 'hand.grab': {
        if (!this.hand) return { ok: false, msg: 'move the hand first (hand.move)' };
        const t = c.target as { kind?: string; id?: number } | undefined;
        if (t && typeof t.id === 'number') this.hand.held = { kind: (t.kind ?? 'agent') as 'agent', id: t.id };
        else if (typeof c.kind === 'string') this.hand.held = { kind: c.kind as 'rock', id: Number(c.mass ?? c.id ?? 400) };
        else return { ok: false, msg: 'grab what? (target or kind)' };
        this.hand.pose = 'grab';
        return { ok: true, msg: 'You lift it into the air.', created: [this.hand.held!] };
      }
      case 'hand.release': case 'hand.throw': case 'hand.drop': case 'hand.place': {
        if (!this.hand?.held) return { ok: false, msg: 'The hand holds nothing.' };
        const held = this.hand.held;
        const v = Array.isArray(c.vel) ? (c.vel as number[]) : null;
        if (c.k !== 'hand.place' && held.kind !== 'agent') {
          const vel: [number, number, number] = v ? [v[0], v[1], v[2]] : [0, 0, 0];
          if (!v && c.k === 'hand.throw') { const d = bearingDir(this.hand.pos, 0); const up = this.hand.pos; for (let i = 0; i < 3; i++) vel[i] = d[i] * 25 + up[i] * 18; }
          this.projectiles.push({ view: { id: this.nextId++, planet: lp.snap.id, kind: held.kind, what: held.id, content: '', pos: [...this.hand.pos], alt: this.hand.alt, vel }, t0: tick, pos0: [...this.hand.pos], alt0: this.hand.alt, vel0: vel });
          this.events.push({ t: 'thrown', tick, planet: lp.snap.id, pos: [...this.hand.pos], a: Math.hypot(vel[0], vel[1], vel[2]), b: this.hand.alt, data: { payload: held.kind, vel } });
        }
        this.hand.held = null;
        this.hand.pose = 'open';
        return { ok: true };
      }
      case 'hand.slap': case 'hand.stroke': {
        if (!this.hand) return { ok: false, msg: 'move the hand first' };
        this.hand.pose = c.k === 'hand.slap' ? 'slap' : 'stroke';
        this.handPoseUntil = tick + 3;
        return { ok: true };
      }
      case 'creature.adopt': case 'lookdev.creature': {
        const tplId = String(c.template ?? c.body ?? 'ape');
        const tpl = CREATURES.get(tplId) ?? [...CREATURES.values()].find((q) => q.body === tplId) ?? { body: tplId, size: [4, 16] as [number, number], name: tplId, speed: 1.5 };
        const id = typeof c.id === 'number' ? c.id : this.nextId++;
        const p = posOf(c) ?? [0, 1, 0];
        const ex = this.creatures.find((q) => q.view.id === id);
        const align = typeof c.alignment === 'number' ? c.alignment : 0;
        const morph: [number, number, number, number] = Array.isArray(c.morph) ? (c.morph as [number, number, number, number]) : [
          Math.max(0, Math.min(1, 0.45 + Math.max(0, align) * 0.25)), Math.min(1, 0.5), Math.max(0, -align), Math.max(0, align),
        ];
        const anim = typeof c.anim === 'string' ? (AnimState as Record<string, number>)[c.anim] ?? AnimState.idle : typeof c.anim === 'number' ? c.anim : AnimState.idle;
        const view: CreatureView = {
          id, planet: lp.snap.id, name: String(c.name ?? tpl.name), body: tpl.body, pos: p, heading: typeof c.heading === 'number' ? c.heading : 0,
          height: typeof c.height === 'number' ? c.height : tpl.size[0] + (tpl.size[1] - tpl.size[0]) * 0.5, alignment: align,
          anim: anim as CreatureView['anim'], phase: hashFloat(id, 5), activity: String(c.activity ?? 'standing'), leash: -1, held: null,
          hunger: 0.3, energy: 0.8, morph,
        };
        const lc: LookCreature = { view, speed: typeof c.speed === 'number' ? c.speed : 0, t0: tick, from: [...p], heading0: view.heading };
        if (ex) Object.assign(ex, lc); else this.creatures.push(lc);
        return { ok: true, msg: `${view.name} stands.`, created: [{ kind: 'creature', id, planet: lp.snap.id }] };
      }
      case 'disaster.spawn': case 'lookdev.disaster': {
        const kind = String(c.kind ?? 'meteor');
        const def = DIS.get(kind);
        if (!def) return { ok: false, msg: `no disaster '${kind}'` };
        const p = posOf(c) ?? this.hand?.pos ?? [0, 1, 0];
        const id = this.nextId++;
        const radius = typeof c.radius === 'number' ? c.radius : def.radius;
        const intensity = typeof c.intensity === 'number' ? c.intensity : def.intensity;
        const life = typeof c.life === 'number' ? c.life : def.life[0] < 0 ? 4320 : Math.round((def.life[0] + def.life[1]) / 2);
        const render: Record<string, number> = { ...def.render, ...(c.params && typeof c.params === 'object' ? c.params as Record<string, number> : {}) };
        const view: DisasterView = { id, kind, planet: lp.snap.id, pos: p, radius, intensity, progress: 0, frozen: false, params: { ...render } };
        const d: LookDisaster = { view, t0: tick, life, pin: typeof c.progress === 'number' ? c.progress : null, alt0: render.alt ?? 0, vel: [0, 0, 0], render, ended: false, lastFx: -1e9 };
        // a falling body comes in at a slant from a hashed bearing
        if (render.alt !== undefined) {
          const b = bearingDir(p, (typeof c.bearing === 'number' ? c.bearing : hashFloat(id, 3) * 360) * Math.PI / 180);
          const down = 0.62;
          const dir = unit([b[0] * (1 - down) - p[0] * down, b[1] * (1 - down) - p[1] * down, b[2] * (1 - down) - p[2] * down]);
          view.params.dirX = dir[0]; view.params.dirY = dir[1]; view.params.dirZ = dir[2];
        }
        const speed = typeof c.speed === 'number' ? c.speed : def.speed ?? 0;
        if (speed > 0) {
          const to = posOf(c, 'toward');
          const dir = to ? unit([to[0] - p[0], to[1] - p[1], to[2] - p[2]]) : bearingDir(p, ((typeof c.heading === 'number' ? c.heading : 90) * Math.PI) / 180);
          const k = speed / R;
          d.vel = [dir[0] * k, dir[1] * k, dir[2] * k];
        }
        const list = this.disasters.get(lp.snap.id) ?? [];
        list.push(d);
        this.disasters.set(lp.snap.id, list);
        this.events.push({ t: 'disaster', tick, planet: lp.snap.id, pos: [...p], a: radius, b: intensity, text: def.name, ref: { kind: 'disaster', id, planet: lp.snap.id }, data: { kind, id } });
        this.onStart(d, lp, tick);
        this.age(d, lp, tick);
        return { ok: true, msg: `${def.name}.`, created: [{ kind: 'disaster', id, planet: lp.snap.id }] };
      }
      case 'disaster.cancel': {
        for (const [, list] of this.disasters) for (const d of list) if (c.all || d.view.id === c.id || d.view.kind === c.kind) d.ended = true;
        return { ok: true };
      }
      case 'weather.paint': case 'lookdev.weather': {
        const kind = String(c.kind ?? 'rain');
        const wdef = ((BASE_PACK as unknown as { weather?: { id: string; render?: { lightning?: number } }[] }).weather ?? []).find((w) => w.id === kind);
        const p = posOf(c) ?? [0, 1, 0];
        const w = { id: this.nextId++, kind, planet: lp.snap.id, pos: p, radius: typeof c.radius === 'number' ? c.radius : 900, intensity: typeof c.intensity === 'number' ? c.intensity : 1, pinned: true, vel: [0, 0, 0] as UnitVec, lightning: Number(wdef?.render?.lightning ?? 0) };
        const list = this.weather.get(lp.snap.id) ?? [];
        list.push(w);
        this.weather.set(lp.snap.id, list);
        this.paintWeather(lp, w);
        return { ok: true, msg: `${kind} over the land.`, created: [{ kind: 'weather', id: w.id, planet: lp.snap.id }] };
      }
      case 'weather.clear': {
        this.weather.set(lp.snap.id, []);
        for (const [k, base] of this.weatherBase) { const f = lp.fields[k as FieldName]; if (f) { f.set(base); lp.dirty.add(k as FieldName); } }
        this.weatherBase.clear();
        return { ok: true };
      }
      case 'weather.global': {
        lp.snap.params.globalWeather = typeof c.kind === 'string' && c.kind ? c.kind : null;
        return { ok: true };
      }
      case 'lookdev.event': {
        const p = posOf(c);
        this.events.push({ t: String(c.t ?? 'impact'), tick, planet: lp.snap.id, pos: p ?? undefined, a: Number(c.a ?? 0), b: Number(c.b ?? 0), text: typeof c.text === 'string' ? c.text : undefined, data: (c.data as Record<string, unknown>) ?? {} });
        return { ok: true };
      }
      case 'lookdev.projectile': {
        const p = posOf(c) ?? [0, 1, 0];
        const v = Array.isArray(c.vel) ? (c.vel as number[]) : [0, 0, 0];
        const vel: [number, number, number] = [v[0], v[1], v[2]];
        this.projectiles.push({ view: { id: this.nextId++, planet: lp.snap.id, kind: String(c.kind ?? 'rock'), what: Number(c.what ?? 600), content: String(c.content ?? ''), pos: p, alt: Number(c.alt ?? 30), vel }, t0: tick, pos0: [...p], alt0: Number(c.alt ?? 30), vel0: vel });
        return { ok: true };
      }
      case 'lookdev.field': {
        const name = String(c.field) as FieldName;
        const f = lp.fields[name];
        const p = posOf(c);
        if (!f || !p) return { ok: false, msg: 'lookdev.field needs a field and a pos' };
        const r = Number(c.radius ?? 100), v = Number(c.value ?? 1), add = !!c.add;
        const P = lp.grid.pos;
        for (const cell of lp.grid.cellsWithin(p[0], p[1], p[2], r / R)) {
          const d = angle(p, [P[cell * 3], P[cell * 3 + 1], P[cell * 3 + 2]]) * R / r;
          const k = Math.max(0, 1 - d * d);
          f[cell] = add ? f[cell] + v * k : Math.max(f[cell] * (1 - k), v * k);
        }
        lp.dirty.add(name);
        return { ok: true };
      }
      case 'lookdev.star': {
        if (typeof c.activity === 'number') this.activity = c.activity;
        return { ok: true };
      }
      case 'planet.set': {
        if (typeof c.magnetism === 'number') lp.snap.params.magnetism = c.magnetism;
        if (typeof c.gravity === 'number') lp.snap.params.gravity = c.gravity;
        return { ok: true };
      }
      case 'lookdev.clear': {
        this.creatures = []; this.disasters.clear(); this.weather.clear(); this.projectiles = []; this.hand = null;
        return { ok: true };
      }
    }
    if (c.k.startsWith('miracle.')) {
      const kind = c.k === 'miracle.cast' ? String(c.kind ?? 'heal') : c.k.slice(8);
      const p = posOf(c) ?? this.hand?.pos ?? [0, 1, 0];
      const RAD: Record<string, number> = { water: 180, food: 300, heal: 160, forest: 220, storm: 450, fire: 80, fireball: 60, shield: 220, lightning: 30, wood: 300, fertility: 300, calm: 500, teach: 400, meteor: 90 };
      const r = typeof c.radius === 'number' ? c.radius : RAD[kind] ?? 150;
      if (kind === 'lightning') this.events.push({ t: 'lightning', tick, planet: lp.snap.id, pos: [...p], a: 1.5, data: { god: 0 } });
      if (kind === 'fireball') this.events.push({ t: 'fireball', tick, planet: lp.snap.id, pos: [...p], a: r, b: 1 });
      if (kind === 'shield') this.events.push({ t: 'shield', tick, planet: lp.snap.id, pos: [...p], a: r, b: tick + 1440, data: { id: this.nextId++ } });
      if (kind === 'meteor') return this.cmd({ k: 'disaster.spawn', kind: 'meteor', pos: p, radius: 90 }, lp, tick);
      if (kind === 'storm') this.cmd({ k: 'weather.paint', kind: 'thunderstorm', pos: p, radius: r }, lp, tick);
      if (kind === 'water') this.cmd({ k: 'weather.paint', kind: 'rain', pos: p, radius: r * 1.4 }, lp, tick);
      this.events.push({ t: 'miracle', tick, planet: lp.snap.id, pos: [...p], a: r, b: 1, text: kind, data: { kind, god: 0, by: 'god' } });
      if (this.hand) { this.hand.pose = 'cast'; this.handPoseUntil = tick + 12; }
      return { ok: true, msg: `A miracle: ${kind}.` };
    }
    return null;
  }

  // ───────────────────────────── aging ─────────────────────────────

  private onStart(d: LookDisaster, lp: GodPlanet, tick: number): void {
    const v = d.view;
    switch (v.kind) {
      case 'volcano': case 'supervolcano':
        this.events.push({ t: 'eruption', tick, planet: lp.snap.id, pos: [...v.pos], a: v.intensity });
        this.paintField(lp, 'lava', v.pos, v.radius * 0.35, 2.5, false);
        this.paintField(lp, 'ash', v.pos, v.radius * 1.2, 0.4, true);
        break;
      case 'wildfire': case 'firestorm':
        this.paintField(lp, 'fire', v.pos, v.radius * 0.5, 0.9, false);
        break;
      case 'quake':
        this.events.push({ t: 'quake', tick, planet: lp.snap.id, pos: [...v.pos], a: Number(d.render.magnitude ?? 6.5), b: v.radius });
        break;
      case 'blight': this.paintField(lp, 'blight', v.pos, v.radius, 0.9, false); break;
      case 'ice-age': this.paintField(lp, 'snow', v.pos, v.radius * 2, 1.2, true); break;
    }
  }

  private age(d: LookDisaster, lp: GodPlanet, tick: number): void {
    const v = d.view;
    const R = lp.snap.params.radius;
    const prog = d.pin ?? Math.max(0, Math.min(1, (tick - d.t0) / Math.max(1, d.life)));
    v.progress = Math.round(prog * 1000) / 1000;
    const P = v.params;
    const env = prog < 0.1 ? prog / 0.1 : prog > 0.8 ? (1 - prog) / 0.2 : 1;
    if (d.render.alt !== undefined) P.alt = Math.round(d.alt0 * (1 - prog));
    if (d.render.plume !== undefined) P.plume = Math.round(d.render.plume * Math.sqrt(v.intensity) * env);
    if (d.render.height !== undefined && v.kind === 'tornado') P.height = Math.round(d.render.height * (0.85 + 0.15 * Math.sin((tick - d.t0) * 0.3)) * Math.sqrt(v.intensity));
    if (d.render.magnitude !== undefined) P.magnitude = d.render.magnitude + Math.log2(Math.max(0.1, v.intensity));
    if (d.render.coverage !== undefined) P.coverage = d.render.coverage * Math.min(1, prog / 0.04, (1 - prog) / 0.04);
    if (d.render.activity !== undefined) P.activity = this.activity ?? 0.9;
    P.radius = v.radius; P.intensity = v.intensity;
    // a moving front
    if (!d.pin && (d.vel[0] || d.vel[1] || d.vel[2])) {
      const dt = tick - d.t0;
      const p0 = (d as LookDisaster & { p0?: UnitVec }).p0 ?? ((d as LookDisaster & { p0?: UnitVec }).p0 = [...v.pos]);
      v.pos = unit([p0[0] + d.vel[0] * dt, p0[1] + d.vel[1] * dt, p0[2] + d.vel[2] * dt]);
    }
    // the tsunami's wall of water, running out from its origin
    if (v.kind === 'tsunami' || v.kind === 'flood') this.wave(d, lp, prog);
    // periodic effects
    const since = tick - d.lastFx;
    if ((v.kind === 'volcano' || v.kind === 'supervolcano') && since > 30) {
      d.lastFx = tick;
      this.paintField(lp, 'lava', v.pos, v.radius * (0.35 + 0.4 * prog), 2.0, false);
    }
    if (v.kind === 'quake' && since > 6 && prog < 1) {
      d.lastFx = tick;
      this.events.push({ t: 'quake', tick, planet: lp.snap.id, pos: [...v.pos], a: Number(P.magnitude ?? 6.5), b: v.radius });
    }
    if ((v.kind === 'meteor' || v.kind === 'comet' || v.kind === 'moon-fall') && prog >= 1 && !d.ended) {
      d.ended = true;
      this.events.push({ t: 'impact', tick, planet: lp.snap.id, pos: [...v.pos], a: v.radius, b: v.intensity, data: { kind: v.kind } });
      this.crater(lp, v.pos, v.radius, R);
    }
    if (prog >= 1 && d.pin === null) d.ended = true;
  }

  /** a bowl with a raised rim, scorched and burning at its edge, ash thrown wide */
  private crater(lp: GodPlanet, p: UnitVec, radius: number, R: number): void {
    const f = lp.fields, P = lp.grid.pos;
    const S = f.surface!, RK = f.rock!, burnt = f.burnt, fire = f.fire, ash = f.ash, water = f.water;
    const depth = radius * 0.22;
    for (const c of lp.grid.cellsWithin(p[0], p[1], p[2], (radius * 3) / R)) {
      const d = (angle(p, [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]]) * R) / radius;
      let dh = 0;
      if (d < 1) dh = -depth * (1 - d * d) + depth * 0.25 * Math.max(0, (d - 0.7) / 0.3);
      else dh = depth * 0.25 * Math.exp(-(d - 1) * (d - 1) * 5);
      S[c] += dh; RK[c] += dh;
      if (water && d < 1.2) water[c] = Math.max(0, water[c] * 0.2);
      if (burnt) burnt[c] = Math.max(burnt[c], Math.max(0, 1 - d / 1.8));
      if (fire && d > 0.8 && d < 1.8) fire[c] = Math.max(fire[c], 0.7 * (1 - Math.abs(d - 1.2) / 0.6));
      if (ash) ash[c] += Math.max(0, 0.5 * (1 - d / 3));
      for (const k of ['grass', 'shrub', 'tree', 'crop'] as FieldName[]) { const v = f[k]; if (v && d < 1.6) v[c] *= Math.min(1, d / 1.6); }
    }
    for (const k of ['surface', 'rock', 'burnt', 'fire', 'ash', 'water', 'grass', 'shrub', 'tree', 'crop'] as FieldName[]) lp.dirty.add(k);
  }

  private paintField(lp: GodPlanet, name: FieldName, p: UnitVec, r: number, v: number, add: boolean): void {
    const f = lp.fields[name];
    if (!f) return;
    const R = lp.snap.params.radius, P = lp.grid.pos;
    for (const c of lp.grid.cellsWithin(p[0], p[1], p[2], r / R)) {
      const d = (angle(p, [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]]) * R) / r;
      const k = Math.max(0, 1 - d * d) * (0.75 + 0.5 * hashFloat(c, 77));
      f[c] = add ? f[c] + v * k : Math.max(f[c], v * k);
    }
    lp.dirty.add(name);
  }

  /** a tsunami: a wall of water running out from its origin over the sea and up onto the land, with its flow */
  private wave(d: LookDisaster, lp: GodPlanet, prog: number): void {
    const f = lp.fields, P = lp.grid.pos, R = lp.snap.params.radius;
    const W = f.water!, S = f.surface!;
    const v = d.view;
    const reach = v.radius * 2.6;
    if (!d.base) {
      const cells = lp.grid.cellsWithin(v.pos[0], v.pos[1], v.pos[2], reach / R);
      d.base = { cells, water: Float32Array.from(cells, (c) => W[c]), surface: Float32Array.from(cells, (c) => S[c]) };
    }
    const H = Number(d.render.height ?? 16) * Math.sqrt(v.intensity);
    const front = reach * Math.min(1, prog * 1.15);
    const width = v.radius * 0.35;
    const FX = f.flowX, FY = f.flowY, FZ = f.flowZ;
    const sea = lp.snap.params.seaLevel;
    for (let i = 0; i < d.base.cells.length; i++) {
      const c = d.base.cells[i];
      const u: UnitVec = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
      const dist = angle(v.pos, u) * R;
      const x = (dist - front) / width;
      // the crest, a trough ahead of it and the water left behind draining
      const prof = Math.exp(-x * x * 2.2) - 0.18 * Math.exp(-(x - 1.2) * (x - 1.2) * 3) + (x < 0 ? 0.18 * Math.exp(x * 0.6) : 0);
      const ground = d.base.surface[i];
      // on land the wall runs up and loses height
      const land = Math.max(0, ground - sea);
      const h = Math.max(0, H * prof * (1 - Math.min(0.85, land / (H * 1.6))));
      W[c] = d.base.water[i] + (ground < sea ? h : Math.max(0, h - land * 0.35));
      if (FX && FY && FZ) {
        // outward from the origin, fastest at the crest (m/tick)
        let dx = u[0] - v.pos[0], dy = u[1] - v.pos[1], dz = u[2] - v.pos[2];
        const dd = dx * u[0] + dy * u[1] + dz * u[2];
        dx -= u[0] * dd; dy -= u[1] * dd; dz -= u[2] * dd;
        const l = Math.hypot(dx, dy, dz) || 1;
        const sp = 60 * 14 * Math.max(0, prof);
        FX[c] = (dx / l) * sp; FY[c] = (dy / l) * sp; FZ[c] = (dz / l) * sp;
      }
    }
    lp.dirty.add('water'); lp.dirty.add('flowX'); lp.dirty.add('flowY'); lp.dirty.add('flowZ');
  }

  private paintWeather(lp: GodPlanet, w: WeatherView): void {
    const f = lp.fields, P = lp.grid.pos, R = lp.snap.params.radius;
    const type: Record<string, number> = { rain: 1, drizzle: 1, monsoon: 1, storm: 1, thunderstorm: 1, hurricane: 1, snow: 2, blizzard: 2, hail: 3, ashfall: 4, 'acid-rain': 5, 'blood-rain': 6, sandstorm: 7 };
    const rate: Record<string, number> = { drizzle: 1.5, rain: 6, monsoon: 18, storm: 14, thunderstorm: 22, hurricane: 35, snow: 4, blizzard: 10, hail: 12, ashfall: 3, 'acid-rain': 6, 'blood-rain': 5, sandstorm: 6 };
    for (const k of ['cloud', 'precip', 'precipType'] as FieldName[]) if (!this.weatherBase.has(k) && f[k]) this.weatherBase.set(k, f[k]!.slice());
    const t = type[w.kind] ?? 0;
    for (const c of lp.grid.cellsWithin(w.pos[0], w.pos[1], w.pos[2], w.radius / R)) {
      const d = (angle(w.pos, [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]]) * R) / w.radius;
      const k = Math.max(0, 1 - d * d);
      if (f.cloud) f.cloud[c] = Math.max(f.cloud[c], Math.min(1, 0.6 + 0.4 * k) * (k > 0 ? 1 : 0));
      if (t && f.precip && f.precipType) { f.precip[c] = Math.max(f.precip[c], (rate[w.kind] ?? 5) * k * w.intensity); f.precipType[c] = t; }
    }
    lp.dirty.add('cloud'); lp.dirty.add('precip'); lp.dirty.add('precipType');
  }

  // ───────────────────────────── snapshots ─────────────────────────────

  /** the god layer's part of one planet's snapshot (disasters, weather, projectiles; a held person moved) */
  planetSnap(lp: GodPlanet, tick: number, snap: PlanetSnap): void {
    const id = lp.snap.id;
    const list = this.disasters.get(id) ?? [];
    for (const d of list) this.age(d, lp, tick);
    const live = list.filter((d) => !d.ended);
    this.disasters.set(id, live);
    snap.disasters = live.map((d) => ({ ...d.view, pos: [...d.view.pos], params: { ...d.view.params } }));
    const ws = this.weather.get(id) ?? [];
    snap.weather = [...(snap.weather ?? []), ...ws.map(({ lightning: _l, ...w }) => w)];
    // lightning from the storms now and then
    for (const w of ws) {
      if (w.lightning <= 0) continue;
      const k = Math.floor(tick / 7);
      if (hashFloat(w.id, k, 1) < 0.35 * w.lightning && (this as unknown as { lastBolt?: number }).lastBolt !== k) {
        (this as unknown as { lastBolt?: number }).lastBolt = k;
        const a = hashFloat(w.id, k, 2) * Math.PI * 2, r = Math.sqrt(hashFloat(w.id, k, 3)) * w.radius * 0.7;
        const b = bearingDir(w.pos, a);
        const p = unit([w.pos[0] + (b[0] * r) / lp.snap.params.radius, w.pos[1] + (b[1] * r) / lp.snap.params.radius, w.pos[2] + (b[2] * r) / lp.snap.params.radius]);
        this.events.push({ t: 'lightning', tick, planet: id, pos: p, a: 1, data: {} });
      }
    }
    // things in flight: a ballistic arc under the planet's gravity
    const g = lp.snap.params.gravity, R = lp.snap.params.radius;
    const fl: ProjectileView[] = [];
    for (const pr of this.projectiles) {
      if (pr.view.planet !== id) continue;
      const t = (tick - pr.t0) * 6; // lookdev: game seconds in flight (a tick is a game minute; flights are seconds)
      const up = pr.pos0;
      const vu = pr.vel0[0] * up[0] + pr.vel0[1] * up[1] + pr.vel0[2] * up[2];
      const alt = pr.alt0 + vu * t - 0.5 * g * t * t;
      const p = unit([up[0] * R + (pr.vel0[0] - up[0] * vu) * t, up[1] * R + (pr.vel0[1] - up[1] * vu) * t, up[2] * R + (pr.vel0[2] - up[2] * vu) * t]);
      if (alt <= 0 && t > 0) {
        if (pr.view.alt > 0) this.events.push({ t: 'landed', tick, planet: id, pos: p, a: Math.hypot(pr.vel0[0], pr.vel0[1], pr.vel0[2] - g * t), data: { payload: pr.view.kind } });
        pr.view.alt = -1;
        continue;
      }
      pr.view.pos = p; pr.view.alt = alt;
      pr.view.vel = [pr.vel0[0] - up[0] * g * t, pr.vel0[1] - up[1] * g * t, pr.vel0[2] - up[2] * g * t];
      fl.push({ ...pr.view });
    }
    this.projectiles = this.projectiles.filter((p) => p.view.alt >= 0);
    if (fl.length) snap.projectiles = fl;
    // a held person hangs under the hand (the sim's overlayMovers)
    if (this.hand?.held?.kind === 'agent' && this.hand.planet === id && snap.agents) this.overlayHeld(snap.agents, this.hand);
  }

  private overlayHeld(b: MoverBlock, h: HandView): void {
    for (let i = 0; i < b.count; i++) {
      if (b.id[i] !== h.held!.id) continue;
      b.pos[i * 3] = h.pos[0]; b.pos[i * 3 + 1] = h.pos[1]; b.pos[i * 3 + 2] = h.pos[2];
      b.vel[i * 3] = b.vel[i * 3 + 1] = b.vel[i * 3 + 2] = 0;
      b.alt[i] = Math.max(0, h.alt - 1.6);
      b.anim[i] = AnimState.held;
    }
  }

  /** the global part: creatures (walking their headings), the hand, and the events since the last snapshot */
  global(tick: number, R: number): { creatures: CreatureView[]; hand: HandView | null; events: SimEvent[] } {
    for (const c of this.creatures) {
      if (c.speed > 0) {
        const t = tick - c.t0;
        const dir = bearingDir(c.from, c.heading0);
        const k = (c.speed * 60 * t) / R / 10;
        c.view.pos = unit([c.from[0] + dir[0] * k, c.from[1] + dir[1] * k, c.from[2] + dir[2] * k]);
        c.view.heading = c.heading0;
      }
    }
    if (this.hand && this.handPoseUntil && tick > this.handPoseUntil) { this.hand.pose = this.hand.held ? 'grab' : 'open'; this.handPoseUntil = 0; }
    const ev = this.events;
    this.events = [];
    return { creatures: this.creatures.map((c) => ({ ...c.view, pos: [...c.view.pos] as UnitVec, morph: [...c.view.morph] as [number, number, number, number] })), hand: this.hand ? { ...this.hand, pos: [...this.hand.pos] as UnitVec } : null, events: ev };
  }
}

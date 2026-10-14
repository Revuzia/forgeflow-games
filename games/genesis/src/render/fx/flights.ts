// GENESIS — things in flight (CONTRACT.md §11.4, §15.7 "projectiles in flight from PlanetSnap.projectiles").
//
// The sim integrates a whole minute of flight inside one tick, so at 1x a throw is over between two snapshots: the
// 'thrown' event (where, how fast, from how high, what) and the 'landed' / 'splash' events arrive together. The
// renderer therefore flies each throw itself, in FX time, along the same ballistic arc under the planet's gravity
// (a few real seconds), and plays the landing when ITS flight comes down (the sim's landing event is held until then).
// What flies is drawn: a boulder, an uprooted tree, a bundle, a hut torn off its foundations (lit props, tumbling), a
// person (the crowds draw them where the flight says, tumbling, in the thrown pose) or the creature (its visual
// follows the flight); a pale streak of displaced air trails anything fast. Projectiles the snapshot still carries
// that no event announced (a long flight, a gravity slip, a reload) are flown from their snapshot state.

import { BufferGeometry, Group, Matrix4, Mesh, Vector3, type IUniform, type MeshStandardMaterial } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import type { ProjectileView, SimEvent } from '../../sim/types.ts';
import { AnimState } from '../../sim/types.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { boulderGeo } from '../hand.ts';
import { makePropMaterial } from './propmat.ts';
import { SYS } from './vfx.ts';
import type { FxCtx } from './disasters.ts';

interface Flight {
  id: number;
  kind: string;
  what: number;
  p: Vector3;
  v: Vector3;
  t0: number;
  last: number;
  mesh: Mesh | null;
  spin: Vector3;
  size: number;
  landing: SimEvent | null;
  trail: number;
  /** set down, not thrown (the Touch let it go barely moving): a person comes down on their feet */
  gentle: boolean;
}

const _m = new Matrix4(), _q = new Vector3(), _up = new Vector3();

export class Flights {
  readonly group = new Group();
  private flights = new Map<number, Flight>();
  private mat: MeshStandardMaterial | null = null;
  private geos = new Map<string, BufferGeometry>();
  private shared: Record<string, IUniform>;
  private seenProj = new Set<number>();
  /** agents and creatures flying now: id → body-frame point and tumble (crowds / creature layers draw them) */
  readonly agentPins = new Map<number, { x: number; y: number; z: number; tumble: number; anim: number }>();
  readonly creaturePins = new Map<number, Vector3>();
  /**
   * (additive, the god layer: render/fx/throwfx.ts) the drawn scale of a flying prop — present.ts raises it so a hurled
   * boulder reads from the god's height and eases it back to its true size before it lands; null draws its true size
   */
  sizeOf: ((kind: string, trueSize: number, age: number, p: Vector3, v: Vector3, id: number) => number) | null = null;
  private holdLanding = new Map<number, SimEvent>();
  private nextLocal = 1e9;

  constructor(shared: Record<string, IUniform>) {
    this.shared = shared;
    this.group.name = 'flights';
    this.group.matrixAutoUpdate = false;
  }

  /** (additive) every flight in the air now: id, kind, body-frame position and velocity, FX age (s) */
  forEach(f: (id: number, kind: string, p: Vector3, v: Vector3, age: number) => void, now: number): void {
    for (const [id, fl] of this.flights) f(id, fl.kind, fl.p, fl.v, now - fl.t0);
  }

  /** a 'thrown' event: fly it; a 'landed' / 'splash' for a flight in the air: hold it until the flight lands */
  onEvent(e: SimEvent, ctx: FxCtx): boolean {
    const data = (e.data ?? {}) as { id?: number; payload?: string; vel?: number[] };
    if (e.t === 'thrown' && e.pos) {
      const id = typeof data.id === 'number' ? data.id : this.nextLocal++;
      const u = new Vector3(e.pos[0], e.pos[1], e.pos[2]).normalize();
      const g = groundHeight(ctx.pv.ground, u.x, u.y, u.z);
      const p = u.clone().multiplyScalar(g + Math.max(0.5, e.b ?? 2));
      const v = data.vel ? new Vector3(data.vel[0], data.vel[1], data.vel[2]) : u.clone().multiplyScalar(12);
      const kind = data.payload ?? 'rock';
      this.start(id, kind, -1, p, v, ctx);
      // the sim's landing may already be queued behind it
      const held = this.holdLanding.get(id);
      if (held) { this.flights.get(id)!.landing = held; this.holdLanding.delete(id); }
      return true;
    }
    if ((e.t === 'landed' || e.t === 'splash') && typeof data.id === 'number') {
      const f = this.flights.get(data.id);
      if (f) { f.landing = e; return true; }
      // the landing came first (events of one tick in any order): keep it a moment for its throw
      if (e.t === 'landed') { this.holdLanding.set(data.id, e); return true; }
    }
    return false;
  }

  private start(id: number, kind: string, what: number, p: Vector3, v: Vector3, ctx: FxCtx): void {
    if (this.flights.has(id)) return;
    const f: Flight = { id, kind, what, p: p.clone(), v: v.clone(), t0: ctx.now, last: ctx.now, mesh: null, spin: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), size: 1, landing: null, trail: 0, gentle: v.length() < 3.5 };
    if (kind === 'rock' || kind === 'tree' || kind === 'item' || kind === 'building') {
      if (!this.mat) this.mat = makePropMaterial(this.shared, { key: 'flight', roughness: 0.9 });
      let geo = this.geos.get(kind);
      if (!geo) { geo = kind === 'rock' ? boulderGeo(11) : boulderGeo(5); this.geos.set(kind, geo); }
      f.mesh = new Mesh(geo, this.mat);
      f.mesh.matrixAutoUpdate = false;
      f.mesh.frustumCulled = false;
      f.mesh.layers.enable(1);
      this.group.add(f.mesh);
      f.size = kind === 'rock' ? 0.8 : kind === 'tree' ? 2.5 : kind === 'building' ? 3 : 0.6;
    }
    f.trail = ctx.vfx.emit({ sys: SYS.steam, x: p.x, y: p.y, z: p.z, size: 0.7, life: 1.2, count: 64, p0: 0.5, r: 0.85, g: 0.85, b: 0.87, power: 0.35 }, ctx.now);
    this.flights.set(id, f);
  }

  update(ctx: FxCtx, projectiles: ProjectileView[]): void {
    const pv = ctx.pv;
    this.agentPins.clear();
    this.creaturePins.clear();
    // projectiles in the snapshot nobody announced: fly them from where they are
    for (const pr of projectiles) {
      if (this.flights.has(pr.id) || this.seenProj.has(pr.id)) continue;
      this.seenProj.add(pr.id);
      const u = new Vector3(pr.pos[0], pr.pos[1], pr.pos[2]).normalize();
      const g = groundHeight(pv.ground, u.x, u.y, u.z);
      this.start(pr.id, pr.kind, pr.what, u.multiplyScalar(g + Math.max(0, pr.alt)), new Vector3(pr.vel[0], pr.vel[1], pr.vel[2]), ctx);
    }
    if (this.seenProj.size > 512) this.seenProj.clear();
    const gr = pv.params.gravity || 9.8;
    const R = pv.params.radius;
    for (const [id, f] of this.flights) {
      // integrate the arc in FX seconds (sub-steps for long frames)
      let dt = Math.max(0, ctx.now - f.last);
      f.last = ctx.now;
      let landed = false;
      while (dt > 0 && !landed) {
        const h = Math.min(dt, 1 / 30);
        dt -= h;
        const r = f.p.length();
        const gk = gr * (R / r) * (R / r);
        f.v.addScaledVector(f.p, (-gk * h) / r);
        f.p.addScaledVector(f.v, h);
        const u = _up.copy(f.p).normalize();
        if (f.p.length() <= groundHeight(pv.ground, u.x, u.y, u.z) && ctx.now - f.t0 > 0.1) landed = true;
        if (ctx.now - f.t0 > 30) landed = true;
      }
      const up = _up.copy(f.p).normalize();
      if (f.trail) ctx.vfx.set(f.trail, { x: f.p.x, y: f.p.y, z: f.p.z, power: Math.min(0.5, f.v.length() * 0.02) });
      if (landed) {
        const g = groundHeight(pv.ground, up.x, up.y, up.z);
        f.p.copy(up).multiplyScalar(g);
        this.land(f, ctx);
        if (f.mesh) { this.group.remove(f.mesh); }
        if (f.trail) ctx.vfx.stop(f.trail, ctx.now);
        this.flights.delete(id);
        continue;
      }
      const age = ctx.now - f.t0;
      if (f.kind === 'agent') {
        // (set down gently: upright, feet first, standing — not the flailing tumble of a throw)
        if (f.gentle) this.agentPins.set(id, { x: f.p.x + up.x * 1.6, y: f.p.y + up.y * 1.6, z: f.p.z + up.z * 1.6, tumble: 0, anim: AnimState.idle });
        else this.agentPins.set(id, { x: f.p.x + up.x * 1.6, y: f.p.y + up.y * 1.6, z: f.p.z + up.z * 1.6, tumble: age * 5.5, anim: AnimState.thrown });
      } else if (f.kind === 'creature') {
        this.creaturePins.set(id, f.p.clone());
      } else if (f.mesh) {
        const s = this.sizeOf ? this.sizeOf(f.kind, f.size, age, f.p, f.v, id) : f.size;
        _m.makeRotationAxis(f.spin, age * 6).scale(_q.set(s, s, s)).setPosition(f.p);
        f.mesh.matrix.copy(_m);
        f.mesh.matrixWorldNeedsUpdate = true;
      }
    }
    // landings held for throws that never came: play them now
    for (const [id, e] of this.holdLanding) { this.holdLanding.delete(id); ctx.landed?.(e); }
  }

  /** where it comes down: dust or a splash, by what it was and how hard */
  private land(f: Flight, ctx: FxCtx): void {
    const e = f.landing;
    const speed = e?.a ?? f.v.length();
    const water = (() => { const w = ctx.pv.fields.get('water'); const u = _up.copy(f.p).normalize(); return !!w && ctx.pv.grid.sample(w, u.x, u.y, u.z) > 0.3; })();
    ctx.landed?.({ t: water ? 'splash' : 'landed', tick: e?.tick ?? 0, planet: ctx.pv.id, pos: [f.p.x, f.p.y, f.p.z], a: speed, data: { payload: f.kind } });
    if (f.kind === 'rock' && speed > 15 && !water) ctx.debris.burst(f.p, 6, speed * 0.25, 0.5, ctx.now);
  }

  dispose(): void {
    for (const f of this.flights.values()) if (f.mesh) this.group.remove(f.mesh);
    this.flights.clear();
    for (const g of this.geos.values()) g.dispose();
    this.mat?.dispose();
  }
}

export type { PlanetView };

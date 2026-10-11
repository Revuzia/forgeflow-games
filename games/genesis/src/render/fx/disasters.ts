// GENESIS — disasters, seen (CONTRACT.md §11.3, §15.7). Every live DisasterView of the primary world becomes FX that
// fade in when it appears and play out when it ends (emitters stop being born, meshes fade, decals dim — nothing
// pops), and the sim's events add the moments: an impact's flash, shockwave, plume and debris; a quake's dust and
// fissures; an eruption; a building's collapse; a splash.
//
//   meteor / moon-fall / comet  a bolide (head, sheath, trail), plasma streaks, a smoke trail left along its path, the
//                     glow it throws on the ground as it comes, a converging reticle where it will land; a comet is a
//                     coma and a two-part tail high in the sky until it enters
//   impact (event)    a flash and its light, a condensation shell racing out, a dust ring on the ground, a mushroom
//                     plume, ejecta sparks and tumbling rocks, a glowing crater and scorched ground
//   meteor shower     streaks from one radiant high over the place (its impacts are meteors of their own)
//   volcano           an ash column spreading into an umbrella downwind, lightning in the plume, lava fountains, embers,
//                     the vent's glow and light, pyroclastic flows at its height, an ashen sky under the plume
//   quake             the shake (events), dust bursting from the ground, fissures at the epicentre, collapses
//   tornado           a roped funnel, its dust skirt, a ring of debris, chevrons where it is heading, wall-cloud bolts
//   hurricane         its spiral is the cloud pass's (weather systems); spray over the sea under its eye wall
//   tsunami / flood   spray thrown along the moving water front (from the water and flow fields)
//   wildfire / storm  smoke columns, embers, heat light and an orange sky near a firestorm (flames: the fire field)
//   plague / blight   miasma wisps and flies; a sick tint over the land; spores
//   swarm / infest.   a flock of thousands of specks and its shadow
//   flare / magnetic  a white wash of the sky, the aurora surging (GodFx feeds sky/aurora.ts)
//   gravity slip      rocks and dust lifting off the ground
//   eclipse           the occluder, the corona, the land darkening
//   rift / sinkhole   glowing cracks venting steam; a pit
//   acid rain, ice age, heat wave, drought, dust bowl, impact winter, glass storm, overgrowth, leviathan, forgetting
//   fog, stampede, rogue flyby — tints, frost, cracks, blowing dust, bolts on the dunes, pollen, a serpent's back,
//   a fog bank, a dust cloud, a dark world sliding past

import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, SphereGeometry, Vector3, type IUniform, type MeshStandardMaterial } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import type { DisasterView, SimEvent } from '../../sim/types.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { DECAL, decal, type Decal, type DecalPass } from './decals.ts';
import { SYS, type EmitterDef, type Vfx } from './vfx.ts';
import { Bolide, Comet, Debris, Dome, Fireball, Funnel, Shell } from './meshfx.ts';
import type { Lightning } from './lightning.ts';
import type { ScreenState } from './screenfx.ts';
import { clamp01, fxHash, smooth } from './fxcommon.ts';
import { makePropMaterial } from './propmat.ts';

export interface FxCtx {
  pv: PlanetView;
  now: number;
  dt: number;
  camBody: Vector3;
  vfx: Vfx;
  decals: DecalPass;
  debris: Debris;
  bolts: Lightning;
  screen: ScreenState;
  sunTint: Vector3;
  /** aurora surge (sky/aurora.ts) */
  aurora: { boost: number };
  /** the particle budget's scale (quality) */
  q: number;
  /** push a thunder event for the audio (a bolt the renderer added) */
  thunder: (pos: Vector3, k: number) => void;
  sunDirBody: Vector3;
  sunE: Vector3;
  /** play a landing (dust, a splash) now — flights hold the sim's landing until their own flight comes down */
  landed?: (e: SimEvent) => void;
  /** the camera's forward axis in the body frame */
  camFwd?: Vector3;
}

interface DState {
  id: number;
  kind: string;
  fade: number;
  seen: boolean;
  gone: boolean;
  /** smoothed body-frame unit position, ground point and its radius */
  u: Vector3;
  g: Vector3;
  emit: Map<string, number>;
  meshes: { obj: Mesh | Group; dispose(): void }[];
  t0: number;
  next: number;
  next2: number;
  alt: number;
  altTick: number;
  altRate: number;
  axis: Vector3;
  view: DisasterView;
  extra: Record<string, unknown>;
}

interface Transient { t0: number; dur: number; step(age: number, k: number, ctx: FxCtx): void; end?(ctx: FxCtx): void }

const _v = new Vector3(), _w = new Vector3(), _a = new Vector3(), _b = new Vector3();
const _m = new Matrix4();

/** the ground point (body m) under a unit vector, and the water surface if higher */
function groundAt(pv: PlanetView, u: Vector3, out: Vector3, water = true): Vector3 {
  let g = groundHeight(pv.ground, u.x, u.y, u.z);
  if (water) {
    const w = pv.fields.get('water'), s = pv.fields.get('surface');
    if (w && s) g = Math.max(g, pv.params.radius + pv.grid.sample(s, u.x, u.y, u.z) + pv.grid.sample(w, u.x, u.y, u.z));
  }
  return out.copy(u).multiplyScalar(g);
}

function windAt(pv: PlanetView, u: Vector3, out: Vector3): Vector3 {
  const wx = pv.fields.get('windX'), wy = pv.fields.get('windY'), wz = pv.fields.get('windZ');
  if (wx && wy && wz) return out.set(pv.grid.sample(wx, u.x, u.y, u.z), pv.grid.sample(wy, u.x, u.y, u.z), pv.grid.sample(wz, u.x, u.y, u.z));
  // no wind field: a light easterly
  out.set(u.z, 0, -u.x);
  const l = out.length() || 1;
  return out.multiplyScalar(2.5 / l);
}

/** a tangent direction at u from a bearing (rad, 0 north, + east) */
function bearing(u: Vector3, b: number, out: Vector3): Vector3 {
  let ex = u.z, ez = -u.x;
  const el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  const nx = u.y * ez, ny = u.z * ex - u.x * ez, nz = -u.y * ex;
  return out.set(ex * Math.sin(b) + nx * Math.cos(b), ny * Math.cos(b), ez * Math.sin(b) + nz * Math.cos(b)).normalize();
}

export class DisasterFx {
  readonly group = new Group();
  private states = new Map<number, DState>();
  private transients: Transient[] = [];
  private fx: Record<string, IUniform>;
  private shared: Record<string, IUniform>;
  private serpentMat: MeshStandardMaterial | null = null;
  private rogueMat: MeshStandardMaterial | null = null;

  constructor(fx: Record<string, IUniform>, shared: Record<string, IUniform>) {
    this.fx = fx;
    this.shared = shared;
    this.group.name = 'disasters';
    this.group.matrixAutoUpdate = false;
  }

  // ───────────────────────────── events ─────────────────────────────

  onEvent(e: SimEvent, ctx: FxCtx): void {
    if (!e.pos) return;
    const pv = ctx.pv;
    const u = new Vector3(e.pos[0], e.pos[1], e.pos[2]).normalize();
    const p = groundAt(pv, u, new Vector3());
    switch (e.t) {
      case 'impact': this.impact(p, Math.max(4, e.a ?? 40), Math.max(0.2, e.b ?? 1), ctx, String((e.data as { kind?: string } | undefined)?.kind ?? '')); break;
      case 'eruption': this.eruptionBurst(p, e.a ?? 1, ctx); break;
      case 'collapsed': {
        ctx.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: 4, life: 6, count: 64, p0: 6, p1: 8, burst: true, r: 0.42, g: 0.37, b: 0.3 }, ctx.now);
        ctx.debris.burst(p, 8, 7, 0.9, ctx.now);
        break;
      }
      case 'landslide': {
        ctx.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: 7, life: 9, count: 96, p0: 20, p1: 10, burst: true, r: 0.45, g: 0.39, b: 0.31 }, ctx.now);
        ctx.debris.burst(p, 14, 6, 1.4, ctx.now);
        break;
      }
      case 'steam': ctx.vfx.emit({ sys: SYS.steam, x: p.x, y: p.y, z: p.z, size: 6, life: 7, count: 64, p0: 20, duration: 6, r: 0.85, g: 0.86, b: 0.88 }, ctx.now); break;
      case 'splash': case 'landed': {
        const sp = Math.max(4, e.a ?? 10);
        const wet = e.t === 'splash' || this.isWater(pv, u);
        if (wet) {
          ctx.vfx.emit({ sys: SYS.spray, x: p.x, y: p.y, z: p.z, size: 1.2 + sp * 0.04, life: 1.8, count: 96, p0: 1.5, p1: Math.min(30, sp * 0.6), burst: true, r: 0.9, g: 0.93, b: 0.95 }, ctx.now);
          ctx.decals.add(Object.assign(decal(DECAL.ripple, [p.x, p.y, p.z], 12), { cr: 0.6, cg: 0.7, cb: 0.75, p0: 2, p1: 1, p2: 1 }));
          this.transients.push({ t0: ctx.now, dur: 3, step: (age, k, c) => c.decals.add(Object.assign(decal(DECAL.ripple, [p.x, p.y, p.z], 4 + age * 9), { cr: 0.5, cg: 0.6, cb: 0.65, p0: 1 + age * 7, p1: 0.8 + age, p2: (1 - k) * 0.6, q0: 2 })) });
        } else {
          ctx.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: 0.8 + sp * 0.04, life: 3, count: 64, p0: 1, p1: Math.min(10, sp * 0.2), burst: true, r: 0.42, g: 0.36, b: 0.28 }, ctx.now);
        }
        break;
      }
      case 'fireball': this.fireball(p, Math.max(10, e.a ?? 60), ctx); break;
    }
  }

  private isWater(pv: PlanetView, u: Vector3): boolean {
    const w = pv.fields.get('water');
    return !!w && pv.grid.sample(w, u.x, u.y, u.z) > 0.3;
  }

  /** an impact: R the crater radius (m), I its strength */
  impact(p: Vector3, R: number, I: number, ctx: FxCtx, kind = ''): void {
    const big = kind === 'meteor' || kind === 'comet' || kind === 'moon-fall' || R > 30;
    const s = Math.sqrt(I);
    const up = _v.copy(p).normalize();
    const pc = p.clone();
    // the flash (and the light it throws)
    ctx.vfx.emit({ sys: SYS.flash, x: p.x, y: p.y, z: p.z, size: R * 7, life: big ? 2.2 : 0.8, count: 1, p0: R * 0.6, p1: big ? 400 : 60, burst: true, r: 1, g: 0.85, b: 0.6 }, ctx.now);
    this.transients.push({
      t0: ctx.now, dur: big ? 14 : 3, step: (age, k, c) => {
        const flash = Math.exp(-age * 3.5);
        const glow = (1 - k) * 0.25;
        const d = decal(DECAL.light, [pc.x, pc.y, pc.z], R * 30);
        d.cr = 1; d.cg = 0.62 + 0.3 * flash; d.cb = 0.3 + 0.4 * flash;
        d.p0 = R * 30; d.p1 = (flash * 2.5e5 + glow * 2e4) * R * R / 900 * s; d.p2 = R * 0.8; d.p3 = R * 0.8;
        c.decals.add(d);
        // the view washes white for an instant
        const f = Math.exp(-age * 9) * (big ? 0.25 : 0.04) * clamp01(1 - pc.distanceTo(c.camBody) / (R * 400));
        c.screen.flash.addScalar(f);
      },
    });
    if (!big) {
      ctx.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: R * 0.5, life: 4, count: 96, p0: R * 0.5, p1: R * 0.6, burst: true, r: 0.42, g: 0.36, b: 0.29 }, ctx.now);
      ctx.debris.burst(p, 10, R * 1.5, R * 0.1, ctx.now);
      this.transients.push({ t0: ctx.now, dur: 10, step: (age, k, c) => c.decals.add(Object.assign(decal(DECAL.scorch, [pc.x, pc.y, pc.z], R * 1.6), { p0: R * 1.4, p1: 0.6 * (1 - k * k), p2: 3.3 })) });
      return;
    }
    // the condensation shell racing out, the dust ring on the ground
    const shell = new Shell(this.fx);
    this.group.add(shell.mesh);
    const shellUp = up.clone();
    this.transients.push({
      t0: ctx.now, dur: 1.6, step: (age) => {
        const r = R * 2 + age * 340;
        frameAt(pc, shellUp, r, shell.mesh.matrix);
        shell.mesh.matrixWorldNeedsUpdate = true;
        shell.u.uK.value = Math.sin(Math.min(1, age / 1.6) * Math.PI) * 0.8;
        (shell.u.uLight.value as Vector3).copy(ctx.sunE).multiplyScalar(0.25).addScalar(0.05);
      }, end: () => { this.group.remove(shell.mesh); shell.dispose(); },
    });
    this.transients.push({
      t0: ctx.now, dur: 9, step: (age, k, c) => {
        const r = Math.min(R * 16, R * 1.5 + age * 160);
        c.decals.add(Object.assign(decal(DECAL.ring, [pc.x, pc.y, pc.z], r + R * 2), { cr: 0.45, cg: 0.38, cb: 0.3, ca: (1 - k) * 0.7, p0: r, p1: R * (0.4 + age * 0.15), q0: R * 3 }));
      },
    });
    // the mushroom plume, ejecta, rocks
    const H = R * 9 * s;
    ctx.vfx.emit({ sys: SYS.plume, x: p.x, y: p.y, z: p.z, size: R * 1.1, life: 40, count: Math.round(900 * ctx.q), p0: H, p1: R * 4, duration: 22, r: 0.36, g: 0.31, b: 0.26 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: R * 0.9, life: 14, count: Math.round(400 * ctx.q), p0: R * 1.5, p1: R * 4, burst: true, r: 0.44, g: 0.38, b: 0.3 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.sparks, x: p.x, y: p.y, z: p.z, size: Math.max(0.8, R * 0.04), life: 4, count: 320, p1: 30 + R * 0.6, burst: true, r: 1, g: 0.6, b: 0.25 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.embers, x: p.x, y: p.y, z: p.z, size: Math.max(0.6, R * 0.03), life: 9, count: 256, p0: R, p1: 12 + R * 0.2, burst: true }, ctx.now);
    ctx.debris.burst(p, 70, 18 + R * 0.9, Math.max(1, R * 0.07), ctx.now);
    // the crater glows and the ground around it is scorched
    this.transients.push({
      t0: ctx.now, dur: 60, step: (age, k, c) => {
        c.decals.add(Object.assign(decal(DECAL.scorch, [pc.x, pc.y, pc.z], R * 3), { p0: R * 2.6, p1: 0.75 * (1 - k * k * k), p2: 1.7, q0: R * 1.5 }));
        const glow = Math.exp(-age / 14);
        c.decals.add(Object.assign(decal(DECAL.glow, [pc.x, pc.y, pc.z], R * 1.2), { cr: 1, cg: 0.3, cb: 0.05, p0: R * 1.05, p1: 0.35, p2: 25 * glow, p3: 3.3, q0: R * 1.2 }));
        if (glow > 0.05) {
          const d = decal(DECAL.light, [pc.x, pc.y, pc.z], R * 5);
          d.cr = 1; d.cg = 0.35; d.cb = 0.08; d.p0 = R * 5; d.p1 = 4e3 * glow * R * R / 900; d.p2 = R * 0.3; d.p3 = R * 0.5;
          c.decals.add(d);
        }
      },
    });
  }

  private eruptionBurst(p: Vector3, a: number, ctx: FxCtx): void {
    ctx.vfx.emit({ sys: SYS.lava, x: p.x, y: p.y, z: p.z, size: 3, life: 5, count: 192, p0: 20, p1: 40 * Math.sqrt(Math.max(0.3, a)), burst: true }, ctx.now);
    ctx.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: 25, life: 12, count: 128, p0: 40, p1: 60, burst: true, r: 0.25, g: 0.23, b: 0.22 }, ctx.now);
  }

  private fireball(p: Vector3, R: number, ctx: FxCtx): void {
    const fb = new Fireball(this.fx);
    this.group.add(fb.mesh);
    const pc = p.clone(), up = p.clone().normalize();
    ctx.vfx.emit({ sys: SYS.flash, x: p.x, y: p.y, z: p.z, size: R * 4, life: 1.6, count: 1, p0: R * 0.8, p1: 120, burst: true, r: 1, g: 0.7, b: 0.35 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.smoke, x: p.x, y: p.y, z: p.z, size: R * 0.5, life: 18, count: 300, p0: R * 4, p1: 1, duration: 4, r: 0.12, g: 0.11, b: 0.1 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.embers, x: p.x, y: p.y, z: p.z, size: 0.8, life: 6, count: 200, p0: R * 0.5, p1: 14, burst: true }, ctx.now);
    this.transients.push({
      t0: ctx.now, dur: 4, step: (age, k, c) => {
        const r = R * (0.35 + 0.9 * (1 - Math.exp(-age * 2.4)));
        _m.makeScale(r, r, r).setPosition(pc.x + up.x * r * 0.7, pc.y + up.y * r * 0.7, pc.z + up.z * r * 0.7);
        fb.mesh.matrix.copy(_m); fb.mesh.matrixWorldNeedsUpdate = true;
        fb.u.uHeat.value = Math.max(0, 1 - age / 3);
        fb.u.uK.value = Math.min(1, age * 10) * (1 - smooth(0.6, 1, k));
        const d = decal(DECAL.light, [pc.x, pc.y, pc.z], R * 12);
        d.cr = 1; d.cg = 0.5; d.cb = 0.15; d.p0 = R * 12; d.p1 = 6e4 * Math.max(0, 1 - age / 3) * R * R / 3600; d.p2 = r; d.p3 = r;
        c.decals.add(d);
      }, end: () => { this.group.remove(fb.mesh); fb.dispose(); },
    });
  }

  // ───────────────────────────── live disasters ─────────────────────────────

  update(list: DisasterView[], ctx: FxCtx): void {
    const pv = ctx.pv;
    const R = pv.params.radius;
    for (const s of this.states.values()) s.seen = false;
    for (const d of list) {
      let st = this.states.get(d.id);
      if (!st) {
        st = {
          id: d.id, kind: d.kind, fade: 0, seen: true, gone: false, u: new Vector3(d.pos[0], d.pos[1], d.pos[2]).normalize(), g: new Vector3(),
          emit: new Map(), meshes: [], t0: ctx.now, next: ctx.now, next2: ctx.now, alt: d.params.alt ?? 0, altTick: pv.paramsTick, altRate: 0,
          axis: new Vector3(), view: d, extra: {},
        };
        this.states.set(d.id, st);
      }
      st.seen = true;
      st.gone = false;
      st.view = d;
      // a moving front glides (snapshots are sparse); a big jump (moved by the god) snaps
      _v.set(d.pos[0], d.pos[1], d.pos[2]).normalize();
      if (_v.angleTo(st.u) * R > 400) st.u.copy(_v); else st.u.lerp(_v, 1 - Math.exp(-ctx.dt * 3)).normalize();
      groundAt(pv, st.u, st.g, true);
      // altitude of a falling body: extrapolated between snapshots at the rate it falls
      if (d.params.alt !== undefined) {
        if (d.params.alt !== st.alt) {
          const dtk = pv.paramsTick - st.altTick;
          if (dtk > 0) st.altRate = (d.params.alt - st.alt) / dtk;
          st.alt = d.params.alt; st.altTick = pv.paramsTick;
        }
      }
    }
    for (const st of this.states.values()) {
      if (!st.seen) st.gone = true;
      const want = st.gone ? 0 : 1;
      st.fade += (want - st.fade) * Math.min(1, ctx.dt * (want ? 1.4 : 0.7));
      if (st.gone && st.fade < 0.02) { this.retire(st, ctx); this.states.delete(st.id); continue; }
      this.step(st, ctx);
    }
    // transients (impacts, fireballs, shells…)
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      const age = ctx.now - t.t0;
      if (age > t.dur) { t.end?.(ctx); this.transients.splice(i, 1); continue; }
      t.step(Math.max(0, age), clamp01(age / t.dur), ctx);
    }
  }

  private retire(st: DState, ctx: FxCtx): void {
    for (const id of st.emit.values()) ctx.vfx.stop(id, ctx.now);
    for (const m of st.meshes) { this.group.remove(m.obj); m.dispose(); }
    st.meshes.length = 0;
  }

  /** start (or update) an emitter keyed `key` of this disaster */
  private em(st: DState, key: string, def: EmitterDef, ctx: FxCtx): number {
    let id = st.emit.get(key);
    if (id && !ctx.vfx.alive(id)) id = undefined;
    if (!id) {
      id = ctx.vfx.emit(def, ctx.now);
      if (id) st.emit.set(key, id);
      return id;
    }
    ctx.vfx.set(id, def);
    return id;
  }
  private stopEm(st: DState, key: string, ctx: FxCtx): void {
    const id = st.emit.get(key);
    if (id) { ctx.vfx.stop(id, ctx.now); st.emit.delete(key); }
  }

  private step(st: DState, ctx: FxCtx): void {
    const d = st.view, pv = ctx.pv;
    const k = st.fade;
    const g = st.g, u = st.u;
    const camD = g.distanceTo(ctx.camBody);
    const P = d.params;
    const Rd = Math.max(5, P.radius ?? d.radius);
    const I = Math.max(0.1, P.intensity ?? d.intensity);
    const q = ctx.q;
    const far = camD > Math.max(30000, Rd * 40);
    switch (d.kind) {
      case 'meteor': case 'moon-fall': case 'comet': {
        // altitude now (extrapolated), the body's place on its slanting path, its size
        const tickNow = pv.renderTick ?? pv.paramsTick;
        const alt = Math.max(0, st.alt + st.altRate * Math.max(0, tickNow - st.altTick));
        const dir = _a.set(P.dirX ?? -u.x, P.dirY ?? -u.y, P.dirZ ?? -u.z);
        if (dir.lengthSq() < 1e-6) dir.copy(u).negate();
        dir.normalize();
        const down = Math.max(0.2, -dir.dot(u));
        const sAlong = alt / down;
        const head = _b.copy(g).addScaledVector(dir, -sAlong);
        const size = P.size ?? (d.kind === 'moon-fall' ? 400 : 12);
        const dist = head.distanceTo(ctx.camBody);
        const comet = d.kind === 'comet' && alt > 25000;
        if (comet) {
          let cm = st.extra.comet as Comet | undefined;
          if (!cm) { cm = new Comet(this.fx); st.extra.comet = cm; this.group.add(cm.group); st.meshes.push({ obj: cm.group, dispose: () => cm!.dispose() }); }
          (cm.u.uHead.value as Vector3).copy(head);
          (cm.u.uAway.value as Vector3).copy(ctx.sunDirBody).negate();
          cm.u.uLen.value = Math.min(alt * 0.6, 120000);
          cm.u.uW.value = Math.max(size * 20, dist * 0.004);
          (cm.u.uCamB.value as Vector3).copy(ctx.camBody);
          cm.u.uK.value = k;
        } else {
          let bo = st.extra.bolide as Bolide | undefined;
          if (!bo) { bo = new Bolide(this.fx); st.extra.bolide = bo; this.group.add(bo.group); st.meshes.push({ obj: bo.group, dispose: () => bo!.dispose() }); }
          const r = Math.max(size * 0.6, dist * 0.003);
          bo.place(head, dir, r, ctx.camBody);
          bo.u.uK.value = k * (alt > 0.5 ? 1 : 0);
          bo.u.uLen.value = Math.min(sAlong * 0.9 + r * 10, 900 + size * 60);
          bo.u.uW.value = r * 0.9;
          const trailLen = Math.min(4000, (P.alt0 ?? 24000) / down) ;
          this.em(st, 'plasma', { sys: SYS.plasma, x: head.x, y: head.y, z: head.z, ax: dir.x, ay: dir.y, az: dir.z, size: r * 0.8, life: 0.6, count: 160, p0: Math.min(sAlong, r * 40), r: 1, g: 0.7, b: 0.35, power: k }, ctx);
          // the smoke trail it leaves, along its path
          this.em(st, 'trail', { sys: SYS.trail, x: g.x, y: g.y, z: g.z, ax: -dir.x, ay: -dir.y, az: -dir.z, size: r * 2.2, life: 25, count: Math.round(420 * q), p0: sAlong, p1: Math.max(sAlong + 1, trailLen), p2: Math.max(50, (st.altRate === 0 ? 1000 : -st.altRate) * 10 / down), r: 0.5, g: 0.47, b: 0.44, power: k }, ctx);
          // the ground lit from above as it comes; the reticle where it will land
          const L = decal(DECAL.light, [g.x, g.y, g.z], Math.min(6000, 600 + alt * 0.6));
          L.cr = 1; L.cg = 0.75; L.cb = 0.5; L.p0 = Math.min(6000, 600 + alt * 0.6); L.p1 = 2e5 * (size / 12) * k; L.p2 = Math.max(50, alt); L.p3 = 50;
          ctx.decals.add(L);
          const ret = decal(DECAL.reticle, [g.x, g.y, g.z], Rd * 1.4);
          ret.cr = 1.6; ret.cg = 0.3; ret.cb = 0.15; ret.ca = k; ret.p0 = Rd; ret.p1 = clamp01(alt / Math.max(1, P.alt0 ?? 24000)); ret.p2 = 1.6; ret.p3 = 1 - ret.p1;
          ret.q0 = Rd * 0.6;
          ctx.decals.add(ret);
        }
        break;
      }
      case 'meteor-shower': {
        const rad = st.extra.rad as Vector3 | undefined ?? (st.extra.rad = bearing(u, fxHash(d.id, 1) * 6.283, new Vector3()).addScaledVector(u, -0.6).normalize()) as Vector3;
        this.em(st, 'shower', { sys: SYS.shower, x: g.x, y: g.y, z: g.z, ax: rad.x, ay: rad.y, az: rad.z, size: Math.max(2, camD * 0.0012), life: 1.1, count: Math.round(160 * q), p0: 1600, p1: Rd * 3, power: k * (P.density ?? 1) }, ctx);
        break;
      }
      case 'volcano': case 'supervolcano': {
        const plume = Math.max(0, P.plume ?? 1800);
        const sup = d.kind === 'supervolcano' ? 1 : 0;
        const wind = windAt(pv, u, _w);
        const H = Math.max(200, plume);
        this.em(st, 'ash', { sys: SYS.ash, x: g.x, y: g.y, z: g.z, ax: wind.x * 0.25, ay: wind.y * 0.25, az: wind.z * 0.25, size: H * 0.045, life: 45, count: Math.round((sup ? 1800 : 1200) * q), p0: H, p1: H * (0.6 + sup * 0.6), p2: 1, r: 0.27, g: 0.25, b: 0.24, power: k * smooth(50, 400, plume) }, ctx);
        this.em(st, 'lava', { sys: SYS.lava, x: g.x, y: g.y, z: g.z, size: 3.5 * (1 + sup), life: 4.5, count: Math.round(260 * q), p0: Rd * 0.06, p1: 34 * Math.sqrt(I) * (1 + sup * 0.6), power: k }, ctx);
        this.em(st, 'embers', { sys: SYS.embers, x: g.x, y: g.y, z: g.z, ax: wind.x, ay: wind.y, az: wind.z, size: 1.4, life: 9, count: Math.round(240 * q), p0: 30, p1: 22, power: k }, ctx);
        // the vent's glow and its light
        ctx.decals.add(Object.assign(decal(DECAL.glow, [g.x, g.y, g.z], Rd * 0.35), { cr: 1, cg: 0.32, cb: 0.05, p0: Rd * 0.3, p1: 0.3, p2: 40 * k, p3: d.id, q0: Rd * 0.4 }));
        const L = decal(DECAL.light, [g.x, g.y, g.z], Rd * 3);
        L.cr = 1; L.cg = 0.38; L.cb = 0.08; L.p0 = Rd * 3; L.p1 = 3e5 * k * (0.85 + 0.15 * Math.sin(ctx.now * 7)); L.p2 = 60; L.p3 = 60;
        ctx.decals.add(L);
        // lightning in the plume
        if (ctx.now > st.next && plume > 400 && !far) {
          st.next = ctx.now + 1.2 + Math.random() * 3;
          const up = _v.copy(u);
          const side = bearing(u, Math.random() * 6.28, new Vector3());
          const a = g.clone().addScaledVector(up, H * (0.45 + 0.3 * Math.random())).addScaledVector(side, H * 0.12).addScaledVector(wind, H * 0.02);
          const toGround = Math.random() < 0.3;
          const b = toGround ? g.clone().addScaledVector(side, Rd * (0.4 + Math.random())) : g.clone().addScaledVector(up, H * (0.2 + 0.2 * Math.random())).addScaledVector(side, -H * 0.15);
          if (toGround) groundAt(pv, b.clone().normalize(), b);
          ctx.bolts.strike(a, b, ctx.now, 0.8, toGround ? 5 : 2);
          ctx.thunder(b, 0.8);
        }
        // pyroclastic flows at the height of the eruption
        if (d.progress > 0.15 && d.progress < 0.7 && ctx.now > st.next2) {
          st.next2 = ctx.now + 18 + Math.random() * 14;
          ctx.vfx.emit({ sys: SYS.pyro, x: g.x, y: g.y, z: g.z, ax: wind.x, ay: wind.y, az: wind.z, size: 18 + sup * 20, life: 26, count: Math.round(260 * q), p0: Rd * (2 + sup * 2), r: 0.3, g: 0.27, b: 0.25, burst: true }, ctx.now);
        }
        // under the plume the sky turns ashen
        const under = (1 - smooth(H * 0.4, H * 1.6, camD)) * k;
        ctx.screen.tintSky.multiply(_v.set(1 - 0.35 * under, 1 - 0.42 * under, 1 - 0.48 * under));
        ctx.sunTint.multiplyScalar(1 - 0.55 * under);
        break;
      }
      case 'quake': {
        if (ctx.now > st.next && !far) {
          st.next = ctx.now + 0.35 + Math.random() * 0.4;
          const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * Rd;
          const b = bearing(u, a, new Vector3());
          const pu = u.clone().multiplyScalar(pv.params.radius).addScaledVector(b, r).normalize();
          const p = groundAt(pv, pu, new Vector3(), false);
          ctx.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: 6, life: 7, count: 48, p0: 12, p1: 6, burst: true, r: 0.45, g: 0.39, b: 0.32 }, ctx.now);
          if (Math.random() < 0.3) ctx.debris.burst(p, 4, 6, 0.8, ctx.now);
        }
        // fissures at the epicentre
        for (let i = 0; i < 3; i++) {
          const ax = bearing(u, fxHash(d.id, i) * 6.283, _w);
          const c = decal(DECAL.cracks, [g.x, g.y, g.z], Rd * 0.6);
          c.ax = ax.x; c.ay = ax.y; c.az = ax.z; c.ca = k * 0.85; c.p0 = Rd * (0.25 + 0.3 * fxHash(d.id, i, 2)); c.p1 = 6; c.p3 = d.id + i;
          c.q0 = 8;
          ctx.decals.add(c);
        }
        break;
      }
      case 'tornado': {
        const h = Math.max(100, P.height ?? 900), w = Math.max(10, P.width ?? 60);
        let fn = st.extra.funnel as Funnel | undefined;
        if (!fn) { fn = new Funnel(this.fx); st.extra.funnel = fn; fn.u.uSeed.value = d.id * 1.7; this.group.add(fn.group); st.meshes.push({ obj: fn.group, dispose: () => fn!.dispose() }); }
        fn.u.uH.value = h; fn.u.uRBase.value = w * 0.32; fn.u.uRTop.value = w * 2.4; fn.u.uK.value = k;
        // light on the funnel: the sun through the air and the sky
        const el = clamp01(u.dot(ctx.sunDirBody) * 2 + 0.2);
        (fn.u.uLight.value as Vector3).copy(ctx.sunE).multiplyScalar(0.08 * el).addScalar(0.035 + 0.08 * el);
        frameAt(g, u, 1, _m);
        fn.place(g, _m);
        // motion: the smoothed position's drift sets the path ahead
        const prev = st.extra.prev as Vector3 | undefined;
        if (prev) { const mv = _a.copy(g).sub(prev); if (mv.length() > 0.01) st.axis.lerp(mv.normalize(), 0.1); }
        st.extra.prev = g.clone();
        this.em(st, 'skirt', { sys: SYS.skirt, x: g.x, y: g.y, z: g.z, size: w * 0.45, life: 6, count: Math.round(520 * q), p0: w * 1.1, p1: h * 0.12, r: 0.36, g: 0.29, b: 0.21, power: k }, ctx);
        this.em(st, 'debris', { sys: SYS.swarm, x: g.x, y: g.y, z: g.z, size: Math.max(0.8, camD * 0.002), life: 30, count: Math.round(260 * q), p0: w * 1.4, p1: h * 0.08, r: 0.12, g: 0.09, b: 0.06, power: k }, ctx);
        if (st.axis.lengthSq() > 0.5) {
          const pa = decal(DECAL.path, [g.x, g.y, g.z], w * 12);
          pa.ax = st.axis.x; pa.ay = st.axis.y; pa.az = st.axis.z; pa.cr = 1.5; pa.cg = 0.5; pa.cb = 0.2; pa.ca = 0.6 * k; pa.p0 = w * 10; pa.p1 = w * 0.9; pa.q0 = w;
          ctx.decals.add(pa);
        }
        if (ctx.now > st.next && !far) {
          st.next = ctx.now + 4 + Math.random() * 6;
          const top = g.clone().addScaledVector(u, h * 0.98).addScaledVector(bearing(u, Math.random() * 6.28, _w), w * 4);
          const gp = groundAt(pv, top.clone().normalize(), new Vector3(), false);
          ctx.bolts.strike(top, gp, ctx.now, 0.9, 5);
          ctx.thunder(gp, 0.9);
        }
        break;
      }
      case 'hurricane': {
        // spray over the sea under the eye wall when the camera is near it
        const near = camD < Rd * 1.2;
        if (near && this.isWater(pv, _v.copy(ctx.camBody).normalize())) {
          const cu = _v.copy(ctx.camBody).normalize();
          const cg = groundAt(pv, cu, new Vector3());
          const wind = windAt(pv, cu, _w);
          this.em(st, 'spray', { sys: SYS.spray, x: cg.x, y: cg.y, z: cg.z, ax: wind.x * 0.4, ay: wind.y * 0.4, az: wind.z * 0.4, size: 4, life: 3, count: Math.round(300 * q), p0: 120, p1: 6, r: 0.85, g: 0.88, b: 0.9, power: k * 0.8 }, ctx);
        } else this.stopEm(st, 'spray', ctx);
        const inside = (1 - smooth(Rd * 0.3, Rd * 1.3, camD)) * k;
        ctx.screen.tintSky.multiply(_v.set(1 - 0.3 * inside, 1 - 0.25 * inside, 1 - 0.18 * inside));
        break;
      }
      case 'tsunami': case 'flood': {
        this.waterFront(st, ctx, d.kind === 'tsunami' ? 1 : 0.5);
        break;
      }
      case 'wildfire': case 'firestorm': {
        const storm = d.kind === 'firestorm';
        if (storm && !far) {
          const wind = windAt(pv, u, _w);
          this.em(st, 'columns', { sys: SYS.smoke, x: g.x, y: g.y, z: g.z, ax: wind.x, ay: wind.y, az: wind.z, size: Rd * 0.1, life: 30, count: Math.round(700 * q), p0: Rd * 3, p1: 1, r: 0.11, g: 0.1, b: 0.09, power: k }, ctx);
          this.em(st, 'embers', { sys: SYS.embers, x: g.x, y: g.y, z: g.z, ax: wind.x, ay: wind.y, az: wind.z, size: 1.5, life: 10, count: Math.round(400 * q), p0: Rd * 0.6, p1: 18, power: k }, ctx);
          const L = decal(DECAL.light, [g.x, g.y, g.z], Rd * 3);
          L.cr = 1; L.cg = 0.4; L.cb = 0.1; L.p0 = Rd * 3; L.p1 = 2e5 * k; L.p2 = 40; L.p3 = Rd * 0.3;
          ctx.decals.add(L);
        }
        // an orange sky near a great fire
        const near = (1 - smooth(Rd, Rd * (storm ? 6 : 3), camD)) * k * (storm ? 1 : 0.45);
        ctx.screen.tintSky.multiply(_v.set(1 + 0.15 * near, 1 - 0.32 * near, 1 - 0.55 * near));
        ctx.screen.tintGround.multiply(_v.set(1 + 0.05 * near, 1 - 0.1 * near, 1 - 0.2 * near));
        break;
      }
      case 'plague': {
        this.em(st, 'miasma', { sys: SYS.miasma, x: g.x, y: g.y, z: g.z, size: Math.max(6, Rd * 0.12), life: 26, count: Math.round(420 * q), p0: Rd, r: 0.42, g: 0.47, b: 0.3, power: k * (P.miasma ?? 1) }, ctx);
        this.em(st, 'flies', { sys: SYS.swarm, x: g.x, y: g.y, z: g.z, size: 0.25, life: 30, count: Math.round(200 * q), p0: Rd * 0.25, p1: 3, r: 0.05, g: 0.05, b: 0.04, power: k }, ctx);
        ctx.decals.add(Object.assign(decal(DECAL.tint, [g.x, g.y, g.z], Rd * 1.3), { cr: 0.82, cg: 0.9, cb: 0.68, ca: k, p0: Rd * 1.2, p1: 0.7, p2: 0.4, p3: d.id, q0: Rd * 0.4 }));
        break;
      }
      case 'blight': {
        ctx.decals.add(Object.assign(decal(DECAL.tint, [g.x, g.y, g.z], Rd * 1.4), { cr: 0.82, cg: 0.66, cb: 0.38, ca: k, p0: Rd * 1.3, p1: 0.85, p2: 0.25, p3: d.id, q0: Rd * 0.4 }));
        this.em(st, 'spores', { sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.5, life: 12, count: Math.round(220 * q), p0: Rd * 0.8, r: 0.6, g: 0.55, b: 0.2, power: k * 0.25 }, ctx);
        break;
      }
      case 'swarm': case 'infestation': {
        const hgt = P.height ?? 20;
        this.em(st, 'swarm', { sys: SYS.swarm, x: g.x, y: g.y, z: g.z, size: Math.max(0.35, camD * 0.0016), life: 30, count: Math.round((d.kind === 'swarm' ? 3200 : 1600) * q), p0: Rd * 0.55, p1: hgt, r: 0.11, g: 0.09, b: 0.05, power: k * (P.density ?? 1) }, ctx);
        ctx.decals.add(Object.assign(decal(DECAL.tint, [g.x, g.y, g.z], Rd * 0.8), { cr: 0.7, cg: 0.68, cb: 0.62, ca: k, p0: Rd * 0.7, p1: 0.6, p2: 0.06, p3: ctx.now * 0.3, q0: Rd * 0.3 }));
        break;
      }
      case 'solar-flare': case 'magnetic-storm': {
        const act = P.activity ?? 0.9;
        ctx.aurora.boost += (d.kind === 'solar-flare' ? 2 + 2 * act : 3) * k;
        if (d.kind === 'solar-flare') {
          const w = k * act * (0.6 + 0.4 * Math.sin(ctx.now * 0.7));
          ctx.screen.tintSky.multiply(_v.set(1 + 0.35 * w, 1 + 0.28 * w, 1 + 0.12 * w));
          ctx.sunTint.multiplyScalar(1 + 0.35 * w);
        }
        break;
      }
      case 'gravity-slip': {
        if (ctx.now > st.next && !far) {
          st.next = ctx.now + 1.2;
          ctx.debris.burst(g, Math.round(14 * q + 4), 0, 1.6, ctx.now, 1);
        }
        this.em(st, 'motes', { sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.6, life: 10, count: Math.round(300 * q), p0: Rd * 0.7, r: 0.6, g: 0.55, b: 0.9, power: k * 0.35 }, ctx);
        this.em(st, 'dust', { sys: SYS.steam, x: g.x, y: g.y, z: g.z, ax: u.x, ay: u.y, az: u.z, size: 6, life: 12, count: Math.round(160 * q), p0: Rd * 0.8, r: 0.5, g: 0.47, b: 0.42, power: k * 0.5 }, ctx);
        break;
      }
      case 'eclipse': {
        ctx.screen.eclipse = Math.max(ctx.screen.eclipse, (P.coverage ?? 0.82) * k);
        break;
      }
      case 'rift': {
        const L = P.length ?? 1400;
        const ax = bearing(u, fxHash(d.id, 4) * 6.283, _w);
        for (const type of [DECAL.cracks, DECAL.crackGlow]) {
          const c = decal(type, [g.x, g.y, g.z], L * 0.55);
          c.ax = ax.x; c.ay = ax.y; c.az = ax.z; c.cr = 1; c.cg = 0.35; c.cb = 0.06; c.ca = k;
          c.p0 = L * 0.5; c.p1 = Math.max(20, Rd * 0.25); c.p2 = 30 * k; c.p3 = d.id;
          c.q0 = 40;
          ctx.decals.add(c);
        }
        this.em(st, 'steam', { sys: SYS.steam, x: g.x, y: g.y, z: g.z, ax: ax.x, ay: ax.y, az: ax.z, size: 10, life: 10, count: Math.round(320 * q), p0: L * 0.9, r: 0.85, g: 0.85, b: 0.86, power: k }, ctx);
        for (let i = -2; i <= 2; i++) {
          const pp = g.clone().addScaledVector(ax, (i / 2) * L * 0.4);
          const Lg = decal(DECAL.light, [pp.x, pp.y, pp.z], 300);
          Lg.cr = 1; Lg.cg = 0.35; Lg.cb = 0.07; Lg.p0 = 300; Lg.p1 = 3e4 * k; Lg.p2 = 6; Lg.p3 = 20;
          ctx.decals.add(Lg);
        }
        break;
      }
      case 'sinkhole': {
        ctx.decals.add(Object.assign(decal(DECAL.pit, [g.x, g.y, g.z], Rd * 1.3), { ca: k, p0: Rd, p1: 0.92, p2: d.id, q0: Math.max(10, Rd * 0.6) }));
        if (!st.extra.burst) { st.extra.burst = true; ctx.vfx.emit({ sys: SYS.dust, x: g.x, y: g.y, z: g.z, size: Rd * 0.4, life: 10, count: 200, p0: Rd, p1: Rd * 0.5, burst: true, r: 0.42, g: 0.36, b: 0.3 }, ctx.now); }
        break;
      }
      case 'acid-rain': {
        ctx.decals.add(Object.assign(decal(DECAL.tint, [g.x, g.y, g.z], Rd * 1.2), { cr: 0.9, cg: 0.95, cb: 0.68, ca: k, p0: Rd * 1.1, p1: 0.6, p2: 0.3, p3: d.id, q0: Rd * 0.4 }));
        if (camD < Rd * 2) this.em(st, 'sizzle', { sys: SYS.steam, x: g.x, y: g.y, z: g.z, size: 2, life: 4, count: Math.round(160 * q), p0: Rd * 1.2, r: 0.82, g: 0.9, b: 0.7, power: k * 0.6 }, ctx);
        break;
      }
      case 'ice-age': case 'impact-winter': {
        const cold = d.kind === 'ice-age';
        const cu = _v.copy(ctx.camBody).normalize();
        const cg = groundAt(pv, cu, new Vector3(), false);
        if (cold) {
          ctx.decals.add(Object.assign(decal(DECAL.frost, [cg.x, cg.y, cg.z], 900), { ca: k, p0: 900, p1: 0.55, p2: 1.3, q0: 300 }));
          this.em(st, 'glints', { sys: SYS.glints, x: cg.x, y: cg.y, z: cg.z, size: 0.25, life: 6, count: Math.round(300 * q), p0: 60, p1: 25, r: 0.85, g: 0.92, b: 1, power: k }, ctx);
        }
        const c = k * (cold ? 0.6 : 0.8);
        ctx.screen.tintSky.multiply(_v.set(1 - 0.25 * c, 1 - 0.18 * c, 1 - 0.05 * c));
        ctx.screen.tintGround.multiply(_v.set(1 - 0.12 * c, 1 - 0.08 * c, 1 + 0.02 * c));
        ctx.sunTint.multiplyScalar(1 - (cold ? 0.2 : 0.5) * k);
        break;
      }
      case 'heat-wave': {
        const c = k * (1 - smooth(Rd, Rd * 3, camD));
        ctx.screen.tintSky.multiply(_v.set(1 + 0.06 * c, 1 - 0.02 * c, 1 - 0.14 * c));
        ctx.screen.tintGround.multiply(_v.set(1 + 0.05 * c, 1, 1 - 0.1 * c));
        break;
      }
      case 'drought': {
        ctx.decals.add(Object.assign(decal(DECAL.tint, [g.x, g.y, g.z], Rd * 1.2), { cr: 1, cg: 0.9, cb: 0.72, ca: k, p0: Rd * 1.1, p1: 0.8, p2: 0.3, p3: d.id, q0: Rd * 0.4 }));
        const c = decal(DECAL.cracks, [g.x, g.y, g.z], Rd * 0.5);
        c.ca = k * 0.5; c.p0 = Rd * 0.45; c.p1 = Rd * 0.45; c.p3 = d.id; c.q0 = 30;
        ctx.decals.add(c);
        break;
      }
      case 'dust-bowl': case 'stampede': {
        const wind = windAt(pv, u, _w);
        const bowl = d.kind === 'dust-bowl';
        this.em(st, 'dust', { sys: SYS.sand, x: g.x, y: g.y, z: g.z, ax: wind.x * 3, ay: wind.y * 3, az: wind.z * 3, size: bowl ? 30 : 12, life: 18, count: Math.round((bowl ? 700 : 300) * q), p0: Rd * (bowl ? 0.8 : 0.4), r: 0.55, g: 0.43, b: 0.3, power: k }, ctx);
        if (bowl) {
          const c = k * (1 - smooth(Rd, Rd * 2.5, camD));
          ctx.screen.tintSky.multiply(_v.set(1 + 0.05 * c, 1 - 0.15 * c, 1 - 0.38 * c));
          ctx.decals.add(Object.assign(decal(DECAL.tint, [g.x, g.y, g.z], Rd * 1.2), { cr: 1, cg: 0.86, cb: 0.66, ca: k, p0: Rd * 1.1, p1: 0.8, p2: 0.3, p3: d.id, q0: Rd * 0.4 }));
        }
        break;
      }
      case 'glass-storm': {
        if (ctx.now > st.next && !far) {
          st.next = ctx.now + 0.4 + Math.random() * 0.9;
          const pu = u.clone().multiplyScalar(pv.params.radius).addScaledVector(bearing(u, Math.random() * 6.28, _w), Math.sqrt(Math.random()) * Rd).normalize();
          const gp = groundAt(pv, pu, new Vector3(), false);
          ctx.bolts.strike(gp.clone().addScaledVector(pu, 260 + Math.random() * 120), gp, ctx.now, 1, 6);
          ctx.thunder(gp, 1);
          ctx.vfx.emit({ sys: SYS.glints, x: gp.x, y: gp.y, z: gp.z, size: 0.5, life: 3, count: 64, p0: 6, p1: 1, burst: true, r: 0.8, g: 0.95, b: 1 }, ctx.now);
        }
        break;
      }
      case 'overgrowth': {
        this.em(st, 'pollen', { sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.5, life: 10, count: Math.round(300 * q), p0: Rd, r: 0.9, g: 0.85, b: 0.4, power: k * 0.35 }, ctx);
        this.em(st, 'leaves', { sys: SYS.leaves, x: g.x, y: g.y, z: g.z, size: 0.5, life: 8, count: Math.round(200 * q), p0: Rd * 0.6, r: 0.18, g: 0.35, b: 0.07, power: k }, ctx);
        break;
      }
      case 'forgetting-fog': {
        this.em(st, 'fog', { sys: SYS.fog, x: g.x, y: g.y, z: g.z, size: Math.max(30, Rd * 0.18), life: 40, count: Math.round(260 * q), p0: Rd, r: 0.72, g: 0.7, b: 0.78, power: k }, ctx);
        const inside = (1 - smooth(Rd * 0.5, Rd * 1.3, camD)) * k;
        ctx.screen.fogDensity = Math.max(ctx.screen.fogDensity, 0.004 * inside);
        ctx.screen.fogCol.set(0.5, 0.49, 0.55).multiplyScalar(0.25);
        break;
      }
      case 'leviathan': {
        this.serpent(st, ctx, g, u, P.height ?? 40, P.length ?? 120, k);
        break;
      }
      case 'rogue-flyby': {
        this.rogue(st, ctx, u, P.dist ?? 80000, P.size ?? 2500, P.bearing ?? 0, k);
        break;
      }
      default: break;
    }
  }

  /** spray thrown up along the moving water front: the fastest, deepest moving water near the camera */
  private waterFront(st: DState, ctx: FxCtx, strength: number): void {
    const pv = ctx.pv;
    const W = pv.fields.get('water'), FX = pv.fields.get('flowX'), FY = pv.fields.get('flowY'), FZ = pv.fields.get('flowZ');
    if (!W || !FX || !FY || !FZ) return;
    const k = st.fade;
    // re-pick the front a few times a second
    if (ctx.now > st.next) {
      st.next = ctx.now + 0.3;
      const R = pv.params.radius;
      const reach = Math.max(st.view.radius * 3, 600);
      const cells = pv.grid.cellsWithin(st.u.x, st.u.y, st.u.z, reach / R);
      const P = pv.grid.pos;
      const cand: { c: number; s: number; d: number }[] = [];
      for (const c of cells) {
        if (W[c] < 0.5) continue;
        const s = Math.hypot(FX[c], FY[c], FZ[c]) / 60;
        if (s < 2.5) continue;
        const dx = P[c * 3] * R - ctx.camBody.x, dy = P[c * 3 + 1] * R - ctx.camBody.y, dz = P[c * 3 + 2] * R - ctx.camBody.z;
        cand.push({ c, s, d: Math.hypot(dx, dy, dz) });
      }
      cand.sort((a, b) => a.d / (1 + a.s * 0.2) - b.d / (1 + b.s * 0.2));
      st.extra.front = cand.slice(0, 18);
    }
    const front = (st.extra.front as { c: number; s: number }[] | undefined) ?? [];
    const P = pv.grid.pos;
    let i = 0;
    for (; i < front.length; i++) {
      const { c, s } = front[i];
      const u = _v.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
      const g = groundAt(pv, u, _a, true);
      const fl = _w.set(FX[c], FY[c], FZ[c]).normalize();
      this.em(st, `spray${i}`, { sys: SYS.spray, x: g.x, y: g.y, z: g.z, ax: fl.x, ay: fl.y, az: fl.z, size: 3 + strength * 3, life: 2.6, count: Math.round(90 * ctx.q), p0: 22, p1: Math.min(18, s * 0.9) * strength, r: 0.88, g: 0.91, b: 0.93, power: k * clamp01(s / 6) }, ctx);
    }
    for (let j = i; j < 18; j++) this.stopEm(st, `spray${j}`, ctx);
  }

  /** a sea serpent's back: dark arches rising and sinking along its way, spray where they break the water */
  private serpent(st: DState, ctx: FxCtx, g: Vector3, u: Vector3, h: number, len: number, k: number): void {
    if (!this.serpentMat) this.serpentMat = makePropMaterial(this.shared, { key: 'serpent', roughness: 0.35 });
    let humps = st.extra.humps as Mesh[] | undefined;
    if (!humps) {
      humps = [];
      const geo = archGeo();
      for (let i = 0; i < 5; i++) { const m = new Mesh(geo, this.serpentMat); m.matrixAutoUpdate = false; m.frustumCulled = false; m.layers.enable(1); humps.push(m); this.group.add(m); }
      st.extra.humps = humps;
      st.meshes.push({ obj: humps[0], dispose: () => { for (const m of humps!) this.group.remove(m); geo.dispose(); } });
    }
    const ax = bearing(u, fxHash(st.id, 9) * 6.283, _w);
    for (let i = 0; i < humps.length; i++) {
      const ph = ctx.now * 0.8 - i * 0.9;
      const rise = Math.sin(ph) * 0.5 + 0.2;
      const p = _a.copy(g).addScaledVector(ax, (i - 2) * len * 0.25).addScaledVector(u, (rise - 0.5) * h * 0.5);
      const s = h * 0.35 * k;
      frameAt(p, u, s, _m);
      // orient the arch along the way
      const x = _b.crossVectors(u, ax).normalize();
      _m.makeBasis(ax.clone().multiplyScalar(s), u.clone().multiplyScalar(s), x.multiplyScalar(s * 0.5)).setPosition(p);
      humps[i].matrix.copy(_m); humps[i].matrixWorldNeedsUpdate = true;
      humps[i].visible = k > 0.02;
    }
    this.em(st, 'spray', { sys: SYS.spray, x: g.x, y: g.y, z: g.z, ax: ax.x, ay: ax.y, az: ax.z, size: 4, life: 2.4, count: Math.round(200 * ctx.q), p0: len * 0.6, p1: 8, r: 0.88, g: 0.91, b: 0.93, power: k }, ctx);
  }

  /** a dark world sliding past in the sky */
  private rogue(st: DState, ctx: FxCtx, u: Vector3, dist: number, size: number, b: number, k: number): void {
    if (!this.rogueMat) this.rogueMat = makePropMaterial(this.shared, { key: 'rogue', roughness: 0.95 });
    let m = st.extra.rogue as Mesh | undefined;
    if (!m) {
      const geo = new SphereGeometry(1, 48, 32);
      const col = new Float32Array(geo.getAttribute('position').count * 3);
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { const n = 0.18 + 0.06 * Math.sin(pos.getX(i) * 9 + pos.getY(i) * 5) * Math.cos(pos.getZ(i) * 7); col[i * 3] = n * 1.05; col[i * 3 + 1] = n; col[i * 3 + 2] = n * 0.95; }
      geo.setAttribute('color', new BufferAttribute(col, 3));
      m = new Mesh(geo, this.rogueMat);
      m.matrixAutoUpdate = false; m.frustumCulled = false;
      st.extra.rogue = m;
      this.group.add(m);
      st.meshes.push({ obj: m, dispose: () => geo.dispose() });
    }
    const dir = bearing(u, b, _w).multiplyScalar(Math.cos(0.45)).addScaledVector(u, Math.sin(0.45)).normalize();
    const p = _a.copy(u).multiplyScalar(ctx.pv.params.radius).addScaledVector(dir, dist);
    const s = size * k;
    m.matrix.makeScale(s, s, s).setPosition(p);
    m.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    for (const st of this.states.values()) for (const m of st.meshes) m.dispose();
    this.states.clear();
    this.serpentMat?.dispose();
    this.rogueMat?.dispose();
  }
}

/** a matrix placing a unit object at p with +y along up, scaled s */
export function frameAt(p: Vector3, up: Vector3, s: number, out: Matrix4): Matrix4 {
  const y = _fy.copy(up).normalize();
  const x = _fx.set(0, 1, 0).cross(y);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0).cross(y);
  x.normalize();
  const z = _fz.crossVectors(x, y);
  return out.makeBasis(x.multiplyScalar(s), y.multiplyScalar(s), z.multiplyScalar(s)).setPosition(p);
}
const _fx = new Vector3(), _fy = new Vector3(), _fz = new Vector3();

/** an arch (a half torus) of unit radius standing on y = 0 along x */
function archGeo(): BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const S = 24, T = 12;
  for (let i = 0; i <= S; i++) {
    const a = (i / S) * Math.PI;
    const cx = -Math.cos(a), cy = Math.sin(a);
    const rr = 0.32 * (0.6 + 0.4 * Math.sin(a));
    for (let j = 0; j <= T; j++) {
      const b = (j / T) * Math.PI * 2;
      const nx = Math.cos(b) * -Math.cos(a), ny = Math.cos(b) * Math.sin(a), nz = Math.sin(b);
      pos.push(cx + nx * rr, cy + ny * rr, nz * rr);
      const back = ny > 0 ? 0.04 : 0.09;
      col.push(back * 0.7, back * 0.8, back * 0.75);
    }
  }
  for (let i = 0; i < S; i++) for (let j = 0; j < T; j++) {
    const a = i * (T + 1) + j, b = a + T + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export type { Decal, Dome };

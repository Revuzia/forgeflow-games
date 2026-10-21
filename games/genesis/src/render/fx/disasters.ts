// GENESIS — disasters, seen (CONTRACT.md §11.3, §15.7). Every live DisasterView of the primary world becomes FX that
// fade in when it appears and play out when it ends (emitters stop being born, meshes fade, decals dim — nothing
// pops), and the sim's events add the moments: an impact's flash, shockwave, plume and debris; a quake's dust and
// fissures; an eruption; a building's collapse; a splash.
//
//   meteor / moon-fall / comet  a bolide (head, sheath, trail), plasma streaks, a smoke trail left along its path, the
//                     glow it throws on the ground as it comes, a converging reticle where it will land; a comet is a
//                     coma and a two-part tail high in the sky until it enters
//   impact (event)    a two-frame white flash lighting the scene, a fireball of puffs cooling from white through orange
//                     to black smoke, an opaque shock ring of dust rolling out along the ground, the ejecta curtain (an
//                     inverted cone thrown up from the rim), debris on curved ballistic arcs trailing smoke, tumbling
//                     rocks, a sun-lit mushroom column, a glowing crater and scorched ground
//   meteor shower     streaks from one radiant high over the place (its impacts are meteors of their own)
//   volcano           a dark ash column lit orange from below, spreading into an umbrella downwind, lightning in the
//                     plume, lava bombs on short arcs cooling and trailing smoke, embers, the vent's glow and light,
//                     steam where the lava meets snow, pyroclastic flows at its height, an ashen sky under the plume
//   quake             the shake (events), dust bursting from the ground, fissures at the epicentre, collapses
//   tornado           a roped funnel under a rotating wall cloud, the storm cell over it (sky/clouds.ts, at once), its
//                     debris cloud and dust ring, rain and hail shafts round it, chevrons where it is heading, bolts
//   hurricane         its spiral is the cloud pass's (a storm cell added at once); spray over the sea under its eye wall
//   tsunami           the wave's front as a breaking wall of water (render/fx/tsunami.ts: crest, curling lip, white
//                     water, foam behind, the drawdown ahead, a muddy bore on land), spray blown off its crest
//   flood             spray thrown along the moving water front (from the water and flow fields)
//   wildfire / storm  smoke columns, embers, heat light and an orange sky near a firestorm (flames: the fire field)
//   plague / blight   a low green-grey haze gathered in the streets round the sick (by area, strongest at dusk), flies,
//                     funeral-pyre smoke, crows circling; spores
//   swarm / infest.   a dark flowing mass with waves through it, thousands of specks with flickering wings, its shadow
//                     moving on the ground and the fields stripped yellow where it passed
//   flare / magnetic  a white wash of the sky, the aurora surging (GodFx feeds sky/aurora.ts)
//   gravity slip      rocks and dust lifting off the ground
//   eclipse           the occluder, the corona, the land darkening
//   rift / sinkhole   glowing cracks venting steam; a pit
//   acid rain, ice age, heat wave, drought, dust bowl, impact winter, glass storm, overgrowth, leviathan, forgetting
//   fog, stampede, rogue flyby — tints, frost, cracks, blowing dust, bolts on the dunes, pollen, a serpent's back,
//   a fog bank, a dust cloud, a dark world sliding past
//   WARNINGS (LIVING §3.7, hook H5: DisasterView.params.warning — the god's disasters give the people a chance):
//   volcano           rumbling: smoke and steam standing from the summit and thickening as the eruption nears,
//                     fumaroles on the upper flanks, cracks and a dull glow deep in the vent, rockfalls and dust on
//                     its slopes at each small quake (the sim's warning quakes) — no ash, no lava, no bolts yet
//   meteor            its first light: a new bright star high over the place with a faint streak behind it, growing,
//                     and a faint ring where it will fall — no fire, no trail of smoke until it truly comes down
//   tsunami           the sea drawing back off the coasts in its reach: bare wet seabed, puddles, a line of foam far
//                     out (render/fx/drawback.ts); the bare ground is swallowed again as the wave comes

import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, SphereGeometry, Vector3, type IUniform, type MeshStandardMaterial } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { TICKS_PER_SECOND_1X, type DisasterView, type SimEvent } from '../../sim/types.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { DECAL, decal, type Decal, type DecalPass } from './decals.ts';
import { SYS, type EmitterDef, type Vfx } from './vfx.ts';
import { Bolide, Comet, Debris, Dome, Funnel } from './meshfx.ts';
import type { Lightning } from './lightning.ts';
import type { ScreenState } from './screenfx.ts';
import type { CloudStorm } from '../sky/clouds.ts';
import { clamp01, fxHash, smooth } from './fxcommon.ts';
import { makePropMaterial } from './propmat.ts';
import { TsunamiCrest } from './tsunami.ts';
import { DRAWBACK_MAX, Drawback } from './drawback.ts';

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
  /** the radius (body m, from the planet's centre) of the cloud deck's base — a funnel or a bolt reaches up to it */
  cloudBase?: number;
  /** the radius of the cloud deck's top (a bolt starts a third of the way up into the deck) */
  cloudTop?: number;
  /** a lightning strike over a unit vector, as GodFx draws it: the cloud lit from inside, a bolt when near and not too
   *  often (real time) — every storm's bolt goes through it */
  strike?: (u: Vector3, power: number) => void;
  /** storm cells to add to the cloud deck this frame (a live tornado's thunderstorm, a hurricane's spiral) */
  storms?: CloudStorm[];
  /**
   * the step for STATE easing (fades in and out, tints, levels): the larger of the FX step and the real frame time, so
   * a disaster spawned on a paused world still fades in (its particles wait for the clock) and nothing pops
   */
  ease: number;
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

/** the kinds whose warning phase is drawn (the sim warns of these: god/precursors.ts) */
const WARNED_FX = new Set(['volcano', 'supervolcano', 'meteor', 'tsunami']);
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
      case 'quake': {
        // a volcano's warning tremor (the sim's small quakes, data.warning): rockfalls and dust on its slopes
        if (!(e.data as { warning?: number } | undefined)?.warning) break;
        const n = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < n; i++) {
          const b = bearing(u, Math.random() * 6.283, new Vector3());
          const pu = u.clone().multiplyScalar(pv.params.radius).addScaledVector(b, 40 + Math.random() * 160).normalize();
          const q = groundAt(pv, pu, new Vector3(), false);
          ctx.vfx.emit({ sys: SYS.dust, x: q.x, y: q.y, z: q.z, size: 5, life: 6, count: 40, p0: 10, p1: 7, burst: true, r: 0.42, g: 0.38, b: 0.33 }, ctx.now);
          ctx.debris.burst(q, 4, 5, 0.7, ctx.now);
        }
        break;
      }
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
    ctx.vfx.emit({ sys: SYS.flash, x: p.x, y: p.y, z: p.z, size: R * (big ? 2.6 : 5), life: big ? 0.45 : 0.6, count: 1, p0: R * 0.5, p1: big ? 300 : 60, burst: true, r: 1, g: 0.9, b: 0.75 }, ctx.now);
    this.transients.push({
      t0: ctx.now, dur: big ? 14 : 3, step: (age, k, c) => {
        const flash = Math.exp(-age * 3.5);
        const glow = (1 - k) * 0.25;
        const d = decal(DECAL.light, [pc.x, pc.y, pc.z], R * 30);
        d.cr = 1; d.cg = 0.62 + 0.3 * flash; d.cb = 0.3 + 0.4 * flash;
        d.p0 = R * 30; d.p1 = (flash * 2.5e5 + glow * 2e4) * R * R / 900 * s; d.p2 = R * 0.8; d.p3 = R * 0.8;
        c.decals.add(d);
        // the view washes white for an instant (two frames), then the light is the fireball's
        const f = (age < 0.07 ? 1 : Math.exp(-(age - 0.07) * 22)) * (big ? 0.55 : 0.05) * clamp01(1 - pc.distanceTo(c.camBody) / (R * 400));
        c.screen.flash.addScalar(f);
      },
    });
    if (!big) {
      ctx.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: R * 0.5, life: 4, count: 96, p0: R * 0.5, p1: R * 0.6, burst: true, r: 0.42, g: 0.36, b: 0.29 }, ctx.now);
      ctx.debris.burst(p, 10, R * 1.5, R * 0.1, ctx.now);
      this.transients.push({ t0: ctx.now, dur: 10, step: (age, k, c) => c.decals.add(Object.assign(decal(DECAL.scorch, [pc.x, pc.y, pc.z], R * 1.6), { p0: R * 1.4, p1: 0.6 * (1 - k * k), p2: 3.3 })) });
      return;
    }
    // (no glass shell of condensation: the shock is the dust ring rolling out along the ground)
    const shellUp = up.clone();
    const q = ctx.q;
    // the fireball: puffs swelling and rising off the crater, white-hot cooling through orange to black smoke
    ctx.vfx.emit({ sys: SYS.fireball, x: p.x, y: p.y, z: p.z, size: R * 0.55, life: 9, count: Math.round(320 * q), p0: R * 1.5, p1: R * 0.14, burst: true, r: 0.11, g: 0.1, b: 0.09 }, ctx.now);
    // the shock ring: an opaque wall of dust rolling outward along the ground, slowing, billowing up behind its front
    ctx.vfx.emit({ sys: SYS.shockRing, x: p.x, y: p.y, z: p.z, size: R * 0.55, life: 11, count: Math.round(560 * q), p0: R * 15, p1: 0.45, burst: true, r: 0.44, g: 0.38, b: 0.31 }, ctx.now);
    // the ejecta curtain: an inverted cone of rock and dust thrown up from the rim, falling back outside it
    ctx.vfx.emit({ sys: SYS.ejecta, x: p.x, y: p.y, z: p.z, size: R * 0.24, life: 7, count: Math.round(460 * q), p0: R * 0.9, p1: 16 + R * 0.32, burst: true, r: 0.3, g: 0.26, b: 0.22 }, ctx.now);
    // debris on curved arcs, each glowing as it flies and trailing smoke (the two systems share the arcs' seed)
    const arcSeed = Math.random() * 97;
    ctx.vfx.emit({ sys: SYS.arcSmoke, x: p.x, y: p.y, z: p.z, size: Math.max(1, R * 0.1), life: 9, count: 26 * 12, p1: 26 + R * 0.55, p2: arcSeed, burst: true, r: 0.22, g: 0.2, b: 0.18 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.arcGlow, x: p.x, y: p.y, z: p.z, size: Math.max(0.6, R * 0.035), life: 9, count: 26, p1: 26 + R * 0.55, p2: arcSeed, burst: true }, ctx.now);
    // the mushroom column (sun-lit: warm on its lit side, blue-grey in its shade), low dust, embers, tumbling rocks
    const H = R * 9 * s;
    ctx.vfx.emit({ sys: SYS.plume, x: p.x, y: p.y, z: p.z, size: R * 1.1, life: 40, count: Math.round(900 * q), p0: H, p1: R * 4, duration: 22, r: 0.25, g: 0.21, b: 0.17 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: R * 0.8, life: 12, count: Math.round(240 * q), p0: R * 1.2, p1: R * 2.5, burst: true, r: 0.44, g: 0.38, b: 0.3 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.embers, x: p.x, y: p.y, z: p.z, size: Math.max(0.6, R * 0.025), life: 5, count: 110, p0: R, p1: 10 + R * 0.15, burst: true }, ctx.now);
    ctx.debris.burst(p, 70, 18 + R * 0.9, Math.max(1, R * 0.07), ctx.now);
    void shellUp;
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

  /** a ball of fire bursting where it lands (the fireball miracle): puffs cooling to smoke, embers, its light */
  private fireball(p: Vector3, R: number, ctx: FxCtx): void {
    const pc = p.clone();
    ctx.vfx.emit({ sys: SYS.flash, x: p.x, y: p.y, z: p.z, size: R * 2.4, life: 0.6, count: 1, p0: R * 0.6, p1: 120, burst: true, r: 1, g: 0.75, b: 0.4 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.fireball, x: p.x, y: p.y, z: p.z, size: R * 0.42, life: 6, count: Math.round(200 * ctx.q), p0: R * 0.9, p1: R * 0.12, burst: true, r: 0.1, g: 0.09, b: 0.08 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.smoke, x: p.x, y: p.y, z: p.z, size: R * 0.5, life: 18, count: 260, p0: R * 4, p1: 1, duration: 4, r: 0.12, g: 0.11, b: 0.1 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.embers, x: p.x, y: p.y, z: p.z, size: 0.8, life: 6, count: 160, p0: R * 0.5, p1: 12, burst: true }, ctx.now);
    this.transients.push({
      t0: ctx.now, dur: 4, step: (age, _k, c) => {
        const r = R * (0.35 + 0.9 * (1 - Math.exp(-age * 2.4)));
        const d = decal(DECAL.light, [pc.x, pc.y, pc.z], R * 12);
        d.cr = 1; d.cg = 0.5; d.cb = 0.15; d.p0 = R * 12; d.p1 = 6e4 * Math.max(0, 1 - age / 3) * R * R / 3600; d.p2 = r; d.p3 = r;
        c.decals.add(d);
      },
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
        // (met already under way — it was there before the camera, or the world is paused: full at once)
        const under = d.progress < 0 || d.progress > 0.04;
        st = {
          id: d.id, kind: d.kind, fade: under ? 1 : 0, seen: true, gone: false, u: new Vector3(d.pos[0], d.pos[1], d.pos[2]).normalize(), g: new Vector3(),
          emit: new Map(), meshes: [], t0: ctx.now, next: ctx.now, next2: ctx.now, alt: d.params.alt ?? 0, altTick: pv.paramsTick, altRate: 0,
          axis: new Vector3(), view: d, extra: {},
        };
        this.states.set(d.id, st);
      }
      st.seen = true;
      st.gone = false;
      st.view = d;
      // a moving front glides (snapshots are sparse) — on real time as well as the FX clock, so a front photographed
      // just after a step stands where the snapshot says; a jump (moved by the god) snaps
      _v.set(d.pos[0], d.pos[1], d.pos[2]).normalize();
      if (_v.angleTo(st.u) * R > 150) st.u.copy(_v); else st.u.lerp(_v, 1 - Math.exp(-ctx.ease * 4)).normalize();
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
      // (in within about a second; out more slowly, playing out)
      st.fade += (want - st.fade) * Math.min(1, ctx.ease * (want ? 3 : 0.7));
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
      // the view met a disaster already under way (it was there before the camera, or the world is paused): its
      // columns, curtains and swarms stand full at once instead of growing from nothing
      const under = st.view.progress < 0 || st.view.progress > 0.04;
      const prewarm = under && ctx.now - st.t0 < 0.5 ? def.life : 0;
      id = ctx.vfx.emit(prewarm ? { ...def, prewarm } : def, ctx.now);
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
    // LIVING §3.7: a warned disaster's warning phase (the rumbling, the first light, the sea drawn back) — the blow is
    // not drawn until the sim lets it fall
    if (P.warning && WARNED_FX.has(d.kind)) { this.warning(st, ctx, Rd, k, far); return; }
    if (st.extra.warned) this.afterWarning(st, ctx);
    switch (d.kind) {
      case 'moon-fall': {
        // (additive, ships/world-events lane) the falling moon is the moon itself — its planet drawn where the sim's
        // spiral puts it, its tides, its break-up and its fire in render/fx/worlds.ts — not a bolide on a slanting
        // path. Only in its last hours a faint ring on the ground marks where it will come down
        const last = clamp01((d.progress - 0.88) / 0.12);
        if (last > 0.01) {
          const ret = decal(DECAL.reticle, [g.x, g.y, g.z], Rd * 1.2);
          ret.cr = 1.2; ret.cg = 0.35; ret.cb = 0.2; ret.ca = 0.22 * last * k; ret.p0 = Rd; ret.p1 = 1 - last; ret.p2 = 1.6; ret.p3 = last;
          ret.q0 = Rd * 0.6;
          ctx.decals.add(ret);
        }
        break;
      }
      case 'meteor': case 'comet': {
        // altitude now (extrapolated), the body's place on its slanting path, its size
        const tickNow = pv.renderTick ?? pv.paramsTick;
        const alt = Math.max(0, st.alt + st.altRate * Math.max(0, tickNow - st.altTick));
        const dir = _a.set(P.dirX ?? -u.x, P.dirY ?? -u.y, P.dirZ ?? -u.z);
        if (dir.lengthSq() < 1e-6) dir.copy(u).negate();
        dir.normalize();
        const down = Math.max(0.2, -dir.dot(u));
        const sAlong = alt / down;
        const head = _b.copy(g).addScaledVector(dir, -sAlong);
        const size = P.size ?? 12;
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
          // the glowing trail of ionised air behind it, back up its entry path
          bo.u.uLen.value = Math.min(Math.max(0, (P.alt0 ?? 24000) / down - sAlong) + r * 10, 4000 + size * 120);
          bo.u.uW.value = r * 0.9;
          const trailLen = Math.min(4000, (P.alt0 ?? 24000) / down) ;
          this.em(st, 'plasma', { sys: SYS.plasma, x: head.x, y: head.y, z: head.z, ax: dir.x, ay: dir.y, az: dir.z, size: r * 0.8, life: 0.6, count: 160, p0: Math.min(sAlong, r * 40), r: 1, g: 0.7, b: 0.35, power: k }, ctx);
          // the smoke trail it leaves, along its path (p2: its speed along the path in m per second at 1× — altRate is m per
          // tick, TICKS_PER_SECOND_1X ticks a second at 1×; a puff's age is geometric, (s − p0) / p2, so it does not
          // pop on a pause or blink out at 1000×: above 1× the trail keeps its 1× look. Times the old ten, the whole
          // 4 km read a tenth of its age at 1×: hot, thin and orange to the top)
          this.em(st, 'trail', { sys: SYS.trail, x: g.x, y: g.y, z: g.z, ax: -dir.x, ay: -dir.y, az: -dir.z, size: r * 2.2, life: 25, count: Math.round(420 * q), p0: sAlong, p1: Math.max(sAlong + 1, trailLen), p2: Math.max(50, (st.altRate === 0 ? 1000 : -st.altRate) * TICKS_PER_SECOND_1X / down), r: 0.5, g: 0.47, b: 0.44, power: k }, ctx);
          // the ground lit from above as it comes, the light sweeping along under the head and swelling as it nears
          const hu = _w.copy(head).normalize();
          const gh = groundAt(pv, hu, _v, false);
          const hAlt = Math.max(30, head.length() - gh.length());
          const reach = Math.min(9000, 900 + hAlt * 1.3);
          const L = decal(DECAL.light, [gh.x, gh.y, gh.z], reach);
          L.cr = 1; L.cg = 0.72; L.cb = 0.45; L.p0 = reach; L.p2 = hAlt; L.p3 = Math.max(40, size * 4);
          L.p1 = 3.2e7 * (size / 12) * k * (0.25 + 0.75 * (1 - smooth(400, 9000, hAlt)));
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
        this.em(st, 'ash', { sys: SYS.ash, x: g.x, y: g.y, z: g.z, ax: wind.x * 0.25, ay: wind.y * 0.25, az: wind.z * 0.25, size: H * 0.045, life: 45, count: Math.round((sup ? 1800 : 1200) * q), p0: H, p1: H * (0.6 + sup * 0.6), p2: 1, r: 0.2, g: 0.19, b: 0.18, power: k * smooth(50, 400, plume) }, ctx);
        // lava bombs: short red-orange streaks on gravity arcs, cooling as they fly; a few embers drifting off
        this.em(st, 'lava', { sys: SYS.lava, x: g.x, y: g.y, z: g.z, size: 2.6 * (1 + sup), life: 4.5, count: Math.round(140 * q), p0: Rd * 0.06, p1: 30 * Math.sqrt(I) * (1 + sup * 0.6), power: k }, ctx);
        this.em(st, 'embers', { sys: SYS.embers, x: g.x, y: g.y, z: g.z, ax: wind.x, ay: wind.y, az: wind.z, size: 0.9, life: 9, count: Math.round(110 * q), p0: 30, p1: 14, power: k * 0.8 }, ctx);
        // now and then a salvo of big bombs, each glowing down its arc and leaving a thin trail of smoke
        if (ctx.now > ((st.extra.salvo as number | undefined) ?? 0) && !far) {
          st.extra.salvo = ctx.now + 2 + Math.random() * 2.5;
          const seed = Math.random() * 97;
          ctx.vfx.emit({ sys: SYS.arcGlow, x: g.x, y: g.y, z: g.z, size: 2.2 * (1 + sup), life: 7, count: 12, p1: 36 * Math.sqrt(I) * (1 + sup * 0.5), p2: seed, burst: true, power: k }, ctx.now);
          ctx.vfx.emit({ sys: SYS.arcSmoke, x: g.x, y: g.y, z: g.z, size: 3.5 * (1 + sup), life: 8, count: 12 * 12, p1: 36 * Math.sqrt(I) * (1 + sup * 0.5), p2: seed, burst: true, r: 0.2, g: 0.19, b: 0.18, power: k * 0.8 }, ctx.now);
        }
        // the vent's glow, and the fountain's light over the slopes around it
        ctx.decals.add(Object.assign(decal(DECAL.glow, [g.x, g.y, g.z], Rd * 0.35), { cr: 1, cg: 0.32, cb: 0.05, p0: Rd * 0.3, p1: 0.3, p2: 40 * k, p3: d.id, q0: Rd * 0.4 }));
        // (falling off over the upper slopes: at 1.2e6 out to 5 Rd the whole mountain read as sand in daylight at night)
        const L = decal(DECAL.light, [g.x, g.y, g.z], Rd * 3.5);
        L.cr = 1; L.cg = 0.34; L.cb = 0.07; L.p0 = Rd * 3.5; L.p1 = 2e5 * k * (0.85 + 0.15 * Math.sin(ctx.now * 7)); L.p2 = 90; L.p3 = 60;
        ctx.decals.add(L);
        // steam where the lava meets snow (a few points along the front, re-picked now and then)
        this.lavaSteam(st, ctx, Rd * 2.5);
        // lightning in the plume
        if (ctx.now > st.next && plume > 400 && !far) {
          // (a dirty thunderstorm: the charged ash flickers with bolts every second or two, most inside the column)
          st.next = ctx.now + 0.5 + Math.random() * 1.6;
          const up = _v.copy(u);
          const side = bearing(u, Math.random() * 6.28, new Vector3());
          const a = g.clone().addScaledVector(up, H * (0.45 + 0.3 * Math.random())).addScaledVector(side, H * 0.12).addScaledVector(wind, H * 0.02);
          const toGround = Math.random() < 0.25;
          const b = toGround ? g.clone().addScaledVector(side, Rd * (0.4 + Math.random())) : g.clone().addScaledVector(up, H * (0.2 + 0.2 * Math.random())).addScaledVector(side, -H * 0.15);
          if (toGround) groundAt(pv, b.clone().normalize(), b);
          ctx.bolts.strike(a, b, ctx.now, 0.8, toGround ? 5 : 2, false);
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
        // the funnel hangs from the storm's cloud base (on a small world that is a few hundred metres up, not 900)
        const base = ctx.cloudBase !== undefined ? ctx.cloudBase - g.length() + 30 : 1e9;
        const h = Math.max(100, Math.min(P.height ?? 900, base)), w = Math.max(10, P.width ?? 60);
        let fn = st.extra.funnel as Funnel | undefined;
        if (!fn) { fn = new Funnel(this.fx); st.extra.funnel = fn; fn.u.uSeed.value = d.id * 1.7; this.group.add(fn.group); st.meshes.push({ obj: fn.group, dispose: () => fn!.dispose() }); }
        // a rope, whatever the cloud base allows: thin over most of its height (a few hundredths of it), flaring into
        // the wall cloud at the top
        fn.u.uH.value = h; fn.u.uRBase.value = Math.min(w * 0.32, h * 0.05); fn.u.uRTop.value = Math.min(w * 2.4, h * 0.26); fn.u.uK.value = k;
        // the storm over it, at once (sky/clouds.ts: a convective cell — the sim's weather and climate catch up later)
        ctx.storms?.push({ pos: [u.x, u.y, u.z], radius: Math.max(900, w * 16), intensity: 0.95 * k, eye: false, style: 1 });
        // light on the funnel: the storm's dim, diffuse light under the deck (a little of the sun through its edges)
        const el = clamp01(u.dot(ctx.sunDirBody) * 2 + 0.2);
        (fn.u.uLight.value as Vector3).copy(ctx.sunE).multiplyScalar(0.035 * el).addScalar(0.02 + 0.05 * el);
        frameAt(g, u, 1, _m);
        fn.place(g, _m);
        // motion: the smoothed position's drift sets the path ahead
        const prev = st.extra.prev as Vector3 | undefined;
        if (prev) { const mv = _a.copy(g).sub(prev); if (mv.length() > 0.01) st.axis.lerp(mv.normalize(), 0.1); }
        st.extra.prev = g.clone();
        // the dust and debris whirled up round its foot: a skirt a little wider than the rope, not a cloud (its puffs
        // are lit as if in the open; under the deck they get about a fifth of that, as the funnel does)
        this.em(st, 'skirt', { sys: SYS.skirt, x: g.x, y: g.y, z: g.z, size: Math.min(w * 0.22, h * 0.05), life: 6, count: Math.round(760 * q), p0: Math.min(w * 0.9, h * 0.18), p1: h * 0.16, r: 0.085, g: 0.075, b: 0.066, power: k * 0.8 }, ctx);
        this.em(st, 'debris', { sys: SYS.swarm, x: g.x, y: g.y, z: g.z, size: Math.max(0.8, camD * 0.002), life: 30, count: Math.round(320 * q), p0: w * 1.6, p1: h * 0.1, r: 0.12, g: 0.09, b: 0.06, power: k }, ctx);
        // the dust it scours off the ground, a ring round its foot
        ctx.decals.add(Object.assign(decal(DECAL.ring, [g.x, g.y, g.z], w * 3), { cr: 0.3, cg: 0.26, cb: 0.21, ca: 0.45 * k, p0: w * 1.2, p1: w * 0.7, q0: Math.max(6, w) }));
        // rain and hail shafts round it under the cell (the heavy rain lies on its forward flank)
        {
          const base0 = ctx.cloudBase !== undefined ? Math.max(120, ctx.cloudBase - g.length()) : h;
          for (let i = 0; i < 3; i++) {
            const b = bearing(u, fxHash(d.id, 20 + i) * 6.283, _a);
            const off = Math.max(140, w * 4) * (1.2 + 1.3 * fxHash(d.id, 30 + i));
            const sp = _b.copy(g).addScaledVector(b, off);
            const su = sp.clone().normalize();
            groundAt(pv, su, sp, true);
            const wnd = windAt(pv, su, _w);
            this.em(st, `shaft${i}`, { sys: SYS.shaft, x: sp.x, y: sp.y, z: sp.z, ax: wnd.x * 0.08, ay: wnd.y * 0.08, az: wnd.z * 0.08, size: Math.max(18, off * 0.12), life: 30, count: Math.round(110 * q), p0: Math.max(50, off * 0.35), p1: base0, r: 0.3, g: 0.32, b: 0.36, power: k * 0.9 }, ctx);
          }
        }
        if (st.axis.lengthSq() > 0.5) {
          const pa = decal(DECAL.path, [g.x, g.y, g.z], w * 12);
          // (a map-reading aid: seen from high up; at the ground the funnel itself says where it goes)
          pa.ax = st.axis.x; pa.ay = st.axis.y; pa.az = st.axis.z; pa.cr = 1.5; pa.cg = 0.5; pa.cb = 0.2; pa.ca = 0.6 * k * smooth(900, 2600, camD); pa.p0 = w * 10; pa.p1 = w * 0.9; pa.q0 = w;
          ctx.decals.add(pa);
        }
        if (ctx.now > st.next && !far) {
          st.next = ctx.now + 4 + Math.random() * 6;
          const top = g.clone().addScaledVector(u, h * 0.98).addScaledVector(bearing(u, Math.random() * 6.28, _w), w * 6);
          const gu = top.clone().normalize();
          const gp = groundAt(pv, gu, new Vector3(), false);
          if (ctx.strike) ctx.strike(gu, 0.9); else ctx.bolts.strike(top, gp, ctx.now, 0.9, 5);
          ctx.thunder(gp, 0.9);
        }
        break;
      }
      case 'hurricane': {
        // its spiral, at once: a tropical cyclone in the cloud deck (sky/clouds.ts)
        ctx.storms?.push({ pos: [u.x, u.y, u.z], radius: Math.max(600, Rd), intensity: k, eye: true, style: 2 });
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
      case 'tsunami': {
        let tc = st.extra.crest as TsunamiCrest | undefined;
        if (!tc) {
          tc = new TsunamiCrest(this.fx, this.shared);
          st.extra.crest = tc;
          this.group.add(tc.mesh);
          const t2 = tc;
          st.meshes.push({ obj: t2.mesh, dispose: () => t2.dispose() });
        }
        const H = Math.max(6, (P.height ?? 16) * Math.sqrt(Math.max(0.2, I)));
        tc.update(pv, st.u, H, Math.max(d.radius * 3, 600), k, ctx.now, ctx.ease, ctx.camBody, ctx.sunE);
        this.crestSpray(st, ctx, tc.crest, H, far);
        break;
      }
      case 'flood': {
        this.waterFront(st, ctx, 0.5);
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
        this.plague(st, ctx, Rd, k * (P.miasma ?? 1), far);
        break;
      }
      case 'blight': {
        ctx.decals.add(Object.assign(decal(DECAL.tint, [g.x, g.y, g.z], Rd * 1.4), { cr: 0.82, cg: 0.66, cb: 0.38, ca: k, p0: Rd * 1.3, p1: 0.85, p2: 0.25, p3: d.id, q0: Rd * 0.4 }));
        this.em(st, 'spores', { sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.5, life: 12, count: Math.round(220 * q), p0: Rd * 0.8, r: 0.6, g: 0.55, b: 0.2, power: k * 0.25 }, ctx);
        break;
      }
      case 'swarm': case 'infestation': {
        this.swarm(st, ctx, Rd, P.height ?? 20, k * (P.density ?? 1), d.kind === 'swarm', camD);
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

  /** steam rising where a volcano's lava meets snow (a few points on that front, re-picked every couple of seconds) */
  private lavaSteam(st: DState, ctx: FxCtx, reach: number): void {
    const pv = ctx.pv;
    const lava = pv.fields.get('lava'), snow = pv.fields.get('snow');
    if (!lava || !snow) return;
    if (ctx.now > ((st.extra.steamAt as number | undefined) ?? 0)) {
      st.extra.steamAt = ctx.now + 2;
      const R = pv.params.radius, P = pv.grid.pos;
      const pts: number[] = [];
      const cells = pv.grid.cellsWithin(st.u.x, st.u.y, st.u.z, reach / R);
      const ns = pv.grid.nbrStart, nb = pv.grid.nbr;
      for (const c of cells) {
        if (lava[c] < 0.05) continue;
        let sn = snow[c];
        for (let j = ns[c]; j < ns[c + 1]; j++) sn = Math.max(sn, snow[nb[j]]);
        if (sn > 0.02) pts.push(c);
        if (pts.length >= 24) break;
      }
      // spread the picks out along the front
      const pick: number[] = [];
      for (let i = 0; i < pts.length && pick.length < 4; i += Math.max(1, Math.floor(pts.length / 4))) pick.push(pts[i]);
      st.extra.steamCells = pick;
      void P;
    }
    const pick = (st.extra.steamCells as number[] | undefined) ?? [];
    let i = 0;
    for (; i < pick.length; i++) {
      const c = pick[i];
      const u = _a.set(pv.grid.pos[c * 3], pv.grid.pos[c * 3 + 1], pv.grid.pos[c * 3 + 2]);
      const gp = groundAt(pv, u, _b, false);
      this.em(st, `steam${i}`, { sys: SYS.steam, x: gp.x, y: gp.y, z: gp.z, size: 7, life: 7, count: Math.round(70 * ctx.q), p0: 30, r: 0.86, g: 0.87, b: 0.89, power: st.fade * 0.8 }, ctx);
    }
    for (let j = i; j < 4; j++) this.stopEm(st, `steam${j}`, ctx);
  }

  /**
   * a plague, seen: a low green-grey haze gathered in the streets round the sick (or the towns in its reach), density
   * by area (particles per km²), strongest at dusk; flies; funeral-pyre smoke; crows circling
   */
  private plague(st: DState, ctx: FxCtx, Rd: number, k: number, far: boolean): void {
    const pv = ctx.pv;
    const R = pv.params.radius;
    // where it gathers: clusters of sick people (re-found every few seconds), else the settlements it reaches
    if (ctx.now > ((st.extra.findAt as number | undefined) ?? -1)) {
      st.extra.findAt = ctx.now + 3;
      const spots: { u: Vector3; n: number }[] = [];
      const A = pv.agents;
      if (A) {
        for (let i = 0; i < A.count && spots.length < 6; i++) {
          if (!(A.flags[i] & 64 /* AgentFlag.sick */)) continue;
          const au = _a.set(A.pos[i * 3], A.pos[i * 3 + 1], A.pos[i * 3 + 2]).normalize();
          if (au.angleTo(st.u) * R > Rd * 1.1) continue;
          let near: { u: Vector3; n: number } | null = null;
          for (const sp of spots) if (sp.u.angleTo(au) * R < 70) { near = sp; break; }
          if (near) near.n++; else spots.push({ u: au.clone(), n: 1 });
        }
      }
      if (!spots.length) {
        for (const s2 of pv.settlements ?? []) {
          const su = _a.set(s2.pos[0], s2.pos[1], s2.pos[2]).normalize();
          if (su.angleTo(st.u) * R < Rd) spots.push({ u: su.clone(), n: 4 });
          if (spots.length >= 3) break;
        }
      }
      if (!spots.length) spots.push({ u: st.u.clone(), n: 3 });
      spots.sort((a2, b2) => b2.n - a2.n);
      st.extra.spots = spots;
    }
    const spots = (st.extra.spots as { u: Vector3; n: number }[]) ?? [];
    // dusk: the haze lies thickest in the evening light
    const el = st.u.dot(ctx.sunDirBody);
    const dusk = 0.65 + 0.35 * (1 - smooth(0.05, 0.4, Math.abs(el - 0.03)));
    const q = ctx.q;
    let i = 0;
    for (; i < Math.min(6, spots.length); i++) {
      const sp = spots[i];
      const gp = groundAt(pv, sp.u, _b, false);
      const rr = Math.min(Rd, 45 + 8 * Math.sqrt(sp.n));
      // ~1 puff per 30 m² at full strength (a street's width of haze, not a uniform disc over the whole region)
      const count = Math.round(Math.min(700, Math.max(90, (Math.PI * rr * rr) / 30)) * q);
      this.em(st, `haze${i}`, { sys: SYS.groundHaze, x: gp.x, y: gp.y, z: gp.z, size: Math.max(6, rr * 0.16), life: 30, count, p0: rr, r: 0.36, g: 0.42, b: 0.31, power: k * dusk * 0.9 }, ctx);
      this.em(st, `wisp${i}`, { sys: SYS.miasma, x: gp.x, y: gp.y, z: gp.z, size: Math.max(3, rr * 0.08), life: 22, count: Math.round(70 * q), p0: rr * 0.8, r: 0.4, g: 0.46, b: 0.33, power: k * 0.8 }, ctx);
      this.em(st, `flies${i}`, { sys: SYS.swarm, x: gp.x, y: gp.y, z: gp.z, size: 0.18, life: 30, count: Math.round(70 * q), p0: rr * 0.25, p1: 2.5, r: 0.04, g: 0.04, b: 0.035, power: k }, ctx);
    }
    for (let j = i; j < 6; j++) { this.stopEm(st, `haze${j}`, ctx); this.stopEm(st, `wisp${j}`, ctx); this.stopEm(st, `flies${j}`, ctx); }
    if (spots.length && !far) {
      // the dead are burned at the edge of the worst-hit street; crows wheel over it
      const sp = spots[0];
      const off = bearing(sp.u, fxHash(st.id, 41) * 6.283, _w);
      const pyre = _a.copy(sp.u).multiplyScalar(R).addScaledVector(off, 70).normalize();
      const pg = groundAt(pv, pyre, new Vector3(), false);
      this.em(st, 'pyre', { sys: SYS.smoke, x: pg.x, y: pg.y, z: pg.z, size: 2.5, life: 26, count: Math.round(160 * q), p0: 70, p1: 0.6, r: 0.16, g: 0.15, b: 0.14, power: k }, ctx);
      this.em(st, 'pyreFire', { sys: SYS.embers, x: pg.x, y: pg.y, z: pg.z, size: 0.4, life: 4, count: Math.round(40 * q), p0: 2, p1: 4, power: k }, ctx);
      const L = decal(DECAL.light, [pg.x, pg.y, pg.z], 60);
      L.cr = 1; L.cg = 0.45; L.cb = 0.12; L.p0 = 60; L.p1 = 2.5e3 * k; L.p2 = 2; L.p3 = 3;
      ctx.decals.add(L);
      const cg = groundAt(pv, sp.u, _b, false);
      this.em(st, 'crows', { sys: SYS.crows, x: cg.x, y: cg.y, z: cg.z, size: 0.9, life: 60, count: 16, p0: 45, p1: 32, r: 0.03, g: 0.03, b: 0.035, power: k }, ctx);
    } else { this.stopEm(st, 'pyre', ctx); this.stopEm(st, 'pyreFire', ctx); this.stopEm(st, 'crows', ctx); }
    // the land looks sick: a faint grey-green pall, not a mustard wash
    const g = st.g;
    ctx.decals.add(Object.assign(decal(DECAL.tint, [g.x, g.y, g.z], Rd * 1.3), { cr: 0.9, cg: 0.93, cb: 0.86, ca: k, p0: Rd * 1.2, p1: 0.7, p2: 0.4, p3: st.id, q0: Rd * 0.4 }));
  }

  /**
   * a swarm, seen: a dark mass flowing with waves through it (puffs) and thousands of specks with flickering wings,
   * wandering over the land; its shadow moves under it and the fields it passed lie stripped and yellow
   */
  private swarm(st: DState, ctx: FxCtx, Rd: number, hgt: number, k: number, big: boolean, camD: number): void {
    const pv = ctx.pv;
    const R = pv.params.radius;
    const q = ctx.q;
    // the mass wanders round the disaster's place (the CPU moves it, so its shadow can follow it)
    const t = ctx.now;
    const e = bearing(st.u, Math.PI / 2, _w), n = bearing(st.u, 0, _a);
    const ox = Math.sin(t * 0.07 + st.id) * Rd * 0.35, oy = Math.cos(t * 0.05 + st.id * 2) * Rd * 0.35;
    const cu = _b.copy(st.u).multiplyScalar(R).addScaledVector(e, ox).addScaledVector(n, oy).normalize();
    const cg = groundAt(pv, cu, new Vector3(), false);
    const R0 = Rd * 0.5;
    this.em(st, 'mass', { sys: SYS.swarmMass, x: cg.x, y: cg.y, z: cg.z, size: Math.max(6, R0 * 0.18), life: 20, count: Math.round((big ? 700 : 400) * q), p0: R0, p1: hgt, r: 0.055, g: 0.045, b: 0.03, power: k }, ctx);
    this.em(st, 'swarm', { sys: SYS.swarm, x: cg.x, y: cg.y, z: cg.z, size: Math.max(0.35, camD * 0.0018), life: 30, count: Math.round((big ? 3200 : 1600) * q), p0: R0 * 1.05, p1: hgt, p2: 1, r: 0.07, g: 0.055, b: 0.035, power: k }, ctx);
    // its shadow on the ground (a soft dark blot that moves with it)
    const sh = decal(DECAL.shadow, [cg.x, cg.y, cg.z], R0 * 1.4);
    sh.p0 = R0 * 1.05; sh.p1 = R0 * 0.9; sh.p2 = 0.9; sh.ca = 0.45 * k; sh.q0 = Math.max(10, hgt * 2);
    ctx.decals.add(sh);
    // the fields it passed: stripped, yellowing (a trail of tints fading over a minute)
    const trail = (st.extra.stripped as { p: Vector3; t: number }[] | undefined) ?? (st.extra.stripped = []) as { p: Vector3; t: number }[];
    if (!trail.length || trail[trail.length - 1].p.distanceTo(cg) > R0 * 0.5) trail.push({ p: cg.clone(), t });
    while (trail.length > 14 || (trail.length && t - trail[0].t > 70)) trail.shift();
    for (const tr of trail) {
      const a = (1 - smooth(20, 70, t - tr.t)) * smooth(0, 4, t - tr.t);
      if (a <= 0.01) continue;
      ctx.decals.add(Object.assign(decal(DECAL.tint, [tr.p.x, tr.p.y, tr.p.z], R0 * 1.1), { cr: 0.86, cg: 0.76, cb: 0.52, ca: a * st.fade, p0: R0, p1: 0.75, p2: 0.12, p3: st.id + tr.t, q0: R0 * 0.4 }));
    }
  }

  /** spray blown off a tsunami's crest along its length (the crest's points, spread out), mist torn off behind it */
  // ───────────────────────────── warnings (LIVING §3.7, hook H5) ─────────────────────────────

  private warning(st: DState, ctx: FxCtx, Rd: number, k: number, far: boolean): void {
    const d = st.view, P = d.params, g = st.g, u = st.u, pv = ctx.pv;
    st.extra.warned = true;
    const age = Math.max(0, ctx.now - st.t0);
    const q = ctx.q;
    switch (d.kind) {
      case 'volcano': case 'supervolcano': {
        const sup = d.kind === 'supervolcano' ? 1 : 0;
        // smoke and steam standing from the summit, thickening as the eruption nears (the sim grows its plume) — only a
        // faint glow from below at its root (p1): a fire-lit column would read as the eruption itself
        const H = Math.max(140, Math.min(1000, (P.plume ?? 0) > 0 ? P.plume * 2.5 : 280)) * (1 + sup * 0.5);
        const wind = windAt(pv, u, _w);
        this.em(st, 'w-smoke', { sys: SYS.smoke, x: g.x, y: g.y, z: g.z, ax: wind.x * 0.4, ay: wind.y * 0.4, az: wind.z * 0.4, size: 9 + H * 0.045, life: 26, count: Math.round(320 * q), p0: H, p1: 0.12, r: 0.52, g: 0.51, b: 0.49, power: k * 0.75 }, ctx);
        if (far) break;
        // fumaroles: steam from vents on the upper flanks
        for (let i = 0; i < 4; i++) {
          const b = bearing(u, fxHash(d.id, 60 + i) * 6.283, _a);
          const pu = _b.copy(u).multiplyScalar(pv.params.radius).addScaledVector(b, Rd * (0.12 + 0.22 * fxHash(d.id, 70 + i))).normalize();
          const p = groundAt(pv, pu, new Vector3(), false);
          this.em(st, `w-vent${i}`, { sys: SYS.steam, x: p.x, y: p.y, z: p.z, ax: wind.x * 0.3, ay: wind.y * 0.3, az: wind.z * 0.3, size: 2.2 + sup * 1.5, life: 7, count: Math.round(56 * q), p0: 14 + 10 * fxHash(d.id, 80 + i), r: 0.84, g: 0.85, b: 0.86, power: k * 0.42 }, ctx);
        }
        // the summit's cracks, a dull glow deep in the vent (it shows at night) — both growing as the magma rises: the
        // sim grows the plume over the warning to 15 % of the eruption's, so its share says how near the eruption is
        // (at full strength from the first hour, a warned volcano's vent on the open ground read as a fire by day)
        const near = clamp01((P.plume ?? 0) / ((sup ? 6000 : 1800) * 0.15));
        for (let i = 0; i < 2; i++) {
          const ax = bearing(u, fxHash(d.id, 90 + i) * 6.283, _a);
          for (const type of [DECAL.cracks, DECAL.crackGlow]) {
            const c = decal(type, [g.x, g.y, g.z], Rd * 0.3);
            c.ax = ax.x; c.ay = ax.y; c.az = ax.z; c.cr = 1; c.cg = 0.3; c.cb = 0.06; c.ca = k * 0.7;
            c.p0 = Rd * (0.14 + 0.1 * fxHash(d.id, 95 + i)); c.p1 = 4; c.p2 = (0.5 + 1.1 * near) * k; c.p3 = d.id + 40 + i; c.q0 = 10;
            ctx.decals.add(c);
          }
        }
        ctx.decals.add(Object.assign(decal(DECAL.glow, [g.x, g.y, g.z], Rd * 0.12), { cr: 1, cg: 0.28, cb: 0.05, p0: Rd * (0.06 + 0.04 * near), p1: 0.4, p2: (0.4 + 2.2 * near * near) * k * (0.65 + 0.35 * Math.sin(ctx.now * 1.7)), p3: d.id, q0: Rd * 0.2 }));
        break;
      }
      case 'meteor': {
        // its first light: a new star high over the place with a faint streak behind it, growing as it comes
        const tickNow = pv.renderTick ?? pv.paramsTick;
        const alt0 = P.alt0 ?? 24000;
        const alt = Math.max(0, st.alt + st.altRate * Math.max(0, tickNow - st.altTick)) || alt0;
        const dir = _a.set(P.dirX ?? -u.x, P.dirY ?? -u.y, P.dirZ ?? -u.z);
        if (dir.lengthSq() < 1e-6) dir.copy(u).negate();
        dir.normalize();
        const down = Math.max(0.2, -dir.dot(u));
        // (high: held at least at the height it will enter from — it is still out beyond the air)
        const hAlt = Math.max(alt, alt0 * 0.85);
        const head = _b.copy(g).addScaledVector(dir, -hAlt / down);
        const dist = head.distanceTo(ctx.camBody);
        // (a Bolide's head and halo: seen from the place it will strike the streak is end-on, and only the halo shows —
        // a new star growing — while from aside its faint trail runs back up its path)
        let bo = st.extra.firstLight as Bolide | undefined;
        if (!bo) {
          bo = new Bolide(this.fx);
          const b2 = bo;
          st.extra.firstLight = bo; this.group.add(bo.group); st.meshes.push({ obj: bo.group, dispose: () => b2.dispose() });
          (bo.u.uCol.value as Vector3).set(0.72, 0.82, 1.0);
        }
        const near = 1 - clamp01((hAlt - alt0 * 0.85) / Math.max(1, alt0));
        bo.place(head, dir, Math.max((P.size ?? 12) * 0.5, dist * 0.0012), ctx.camBody);
        bo.u.uLen.value = Math.min(6000, Math.max(600, dist * 0.12));
        bo.u.uW.value = Math.max(2, dist * 0.0008);
        bo.u.uK.value = k * (0.3 + 0.25 * near) * (0.85 + 0.15 * Math.sin(ctx.now * 2.3) * Math.sin(ctx.now * 0.9));
        // a faint ring where it will fall
        const ret = decal(DECAL.reticle, [g.x, g.y, g.z], Rd * 1.4);
        ret.cr = 1.6; ret.cg = 0.3; ret.cb = 0.15; ret.ca = 0.4 * k; ret.p0 = Rd; ret.p1 = 1; ret.p2 = 0.8; ret.p3 = 0.1; ret.q0 = Rd * 0.6;
        ctx.decals.add(ret);
        break;
      }
      case 'tsunami': {
        let db = st.extra.drawback as Drawback | undefined;
        if (!db) {
          db = new Drawback(this.fx, this.shared, pv, g, Math.max(1200, Rd * 3));
          const d2 = db;
          st.extra.drawback = db; this.group.add(db.mesh); st.meshes.push({ obj: db.mesh, dispose: () => d2.dispose() });
        }
        // the sea goes out over the warning's first minutes of FX time, then stands far out
        const dw = DRAWBACK_MAX * (1 - Math.exp(-age / 7));
        st.extra.dw = dw;
        db.update(dw, k, ctx.camBody);
        break;
      }
    }
  }

  /** the warning is over: its smoke stops, the first light gives way to the falling body, the sea comes back in */
  private afterWarning(st: DState, ctx: FxCtx): void {
    for (const key of [...st.emit.keys()]) if (key.startsWith('w-')) this.stopEm(st, key, ctx);
    const fl = st.extra.firstLight as Bolide | undefined;
    if (fl) fl.u.uK.value = 0;
    const db = st.extra.drawback as Drawback | undefined;
    if (db) {
      const f = Math.max(0, ((st.extra.dbFade as number | undefined) ?? 1) - ctx.ease * 0.35);
      st.extra.dbFade = f;
      db.update((st.extra.dw as number | undefined) ?? 0, f * st.fade, ctx.camBody);
      if (f > 0) return;
    }
    st.extra.warned = false;
  }

  private crestSpray(st: DState, ctx: FxCtx, crest: { p: Vector3; out: Vector3; land: number }[], H: number, far: boolean): void {
    const n = far ? 0 : Math.min(16, crest.length);
    const step = crest.length / Math.max(1, n);
    const k = st.fade;
    let i = 0;
    for (; i < n; i++) {
      const c = crest[Math.floor(i * step)];
      const up = _a.copy(c.p).normalize();
      const fw = _b.copy(c.out).addScaledVector(up, 0.25).normalize();
      const col = c.land > 0.3 ? [0.62, 0.56, 0.48] : [0.9, 0.93, 0.95];
      this.em(st, `spray${i}`, { sys: SYS.spray, x: c.p.x, y: c.p.y, z: c.p.z, ax: fw.x, ay: fw.y, az: fw.z, size: H * 0.3, life: 3, count: Math.round(220 * ctx.q), p0: H * 2.2, p1: H * 0.9, r: col[0], g: col[1], b: col[2], power: k }, ctx);
      this.em(st, `mist${i}`, { sys: SYS.steam, x: c.p.x, y: c.p.y, z: c.p.z, ax: fw.x, ay: fw.y, az: fw.z, size: H * 0.6, life: 5, count: Math.round(50 * ctx.q), p0: H * 2.5, r: 0.86, g: 0.89, b: 0.92, power: k * 0.6 }, ctx);
      // wreckage tumbling in the bore where it runs over the land
      if (c.land > 0.3 && Math.random() < 0.02) ctx.debris.burst(c.p, 3, H * 0.6, Math.max(0.6, H * 0.06), ctx.now);
    }
    for (let j = i; j < 24; j++) { this.stopEm(st, `spray${j}`, ctx); this.stopEm(st, `mist${j}`, ctx); }
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
      // (the crest — the fastest water — first, then nearness; spread out along the front so the spray traces its
      // line instead of bunching at the one stretch nearest the camera)
      cand.sort((a, b) => a.d / (1 + a.s * 0.6) - b.d / (1 + b.s * 0.6));
      const pick: { c: number; s: number; d: number }[] = [];
      const gap = Math.max(40, Math.min(160, reach * 0.06)) / R;
      for (const a of cand) {
        if (pick.length >= 24) break;
        let near = false;
        for (const b of pick) {
          const dx = P[a.c * 3] - P[b.c * 3], dy = P[a.c * 3 + 1] - P[b.c * 3 + 1], dz = P[a.c * 3 + 2] - P[b.c * 3 + 2];
          if (dx * dx + dy * dy + dz * dz < gap * gap) { near = true; break; }
        }
        if (!near) pick.push(a);
      }
      st.extra.front = pick;
    }
    const front = (st.extra.front as { c: number; s: number }[] | undefined) ?? [];
    const P = pv.grid.pos, Sf = pv.fields.get('surface');
    let i = 0;
    for (; i < front.length; i++) {
      const { c, s } = front[i];
      const u = _v.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
      // (from the cell's own water level — the drawn surface there — not one interpolated down toward the trough
      // ahead of the crest, which would start the spray inside the wall of water)
      const g = groundAt(pv, u, _a, true);
      if (Sf) g.setLength(Math.max(g.length(), pv.params.radius + Sf[c] + W[c]));
      const fl = _w.set(FX[c], FY[c], FZ[c]).normalize();
      // the crest breaking: white water thrown up and forward over the front, and a veil of mist torn off it
      this.em(st, `spray${i}`, { sys: SYS.spray, x: g.x, y: g.y, z: g.z, ax: fl.x, ay: fl.y, az: fl.z, size: 5 + strength * 6, life: 3.2, count: Math.round(200 * ctx.q), p0: 26, p1: Math.min(26, s * 1.4) * strength, r: 0.9, g: 0.93, b: 0.95, power: k * clamp01(s / 5) }, ctx);
      this.em(st, `mist${i}`, { sys: SYS.steam, x: g.x, y: g.y, z: g.z, ax: fl.x, ay: fl.y, az: fl.z, size: 9 + strength * 6, life: 6, count: Math.round(40 * ctx.q), p0: 40, r: 0.86, g: 0.89, b: 0.92, power: k * 0.7 * clamp01(s / 6) }, ctx);
    }
    for (let j = i; j < 24; j++) { this.stopEm(st, `spray${j}`, ctx); this.stopEm(st, `mist${j}`, ctx); }
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

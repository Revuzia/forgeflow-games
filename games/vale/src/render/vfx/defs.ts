// VALE render — VfxDef → internal layer specs (CONTRACT §9.5, CHANGED(RENDER) v2 vocabulary).
//
// Layer types (v2): emitter · sprite · ribbon · beam · mesh · shockwave · decal · flash · light ·
// distort · feel · bind. The v1 types burst · trail · ring keep working: they are parsed into
// emitter · ribbon · shockwave specs with their v1 meaning (beam · flash · mesh · decal accept both
// their v1 keys and the v2 additions). Unknown keys are ignored here; the content build rejects them.
//
// Common keys on every drawable layer: type, delay (s), at (origin | caster | target | path | ground),
// phase (main | windup), socket (fighter socket name), offset [forward, up, right] (m), follow (bool:
// track the anchor every frame), fit (bool: radius-like values × the area radius; default on at
// `ground`), secondary (bool: allies spawn half), chance (0..1).

import type { VfxDefT } from '../../contracts/catalog.ts';
import { type ColorRef, colorRef, constCurve, type Curve, curve, curveMax, type Gradient, gradient } from './curves.ts';
import { texSpec, type TexSpec } from './atlas.ts';
import { shapeIndex } from './shapes.ts';

export type Anchor = 'origin' | 'caster' | 'target' | 'path' | 'ground';
export const ANCHORS: readonly Anchor[] = ['origin', 'caster', 'target', 'path', 'ground'];

/** particle blend: 0 additive light · 1 alpha · 2 ink (dark body + light rim) · 3 opaque chip */
export type PBlend = 0 | 1 | 2 | 3;

export interface LayerBase {
  type: string;
  delay: number;
  at: Anchor | null;
  windup: boolean;
  socket: string | null;
  offset: [number, number, number] | null;
  follow: boolean;
  fit: boolean | null;
  secondary: boolean;
  chance: number;
}

export const SHAPE = { point: 0, sphere: 1, ring: 2, disc: 3, cone: 4, line: 5, path: 6, aura: 7 } as const;
export const DIR = { up: 0, out: 1, in: 2, forward: 3, back: 4, down: 5, normal: 6, random: 7, none: 8 } as const;

export interface EmitterL extends LayerBase {
  type: 'emitter';
  count: number; rate: number; perMeter: number; bursts: [number, number][]; duration: number;
  shape: number; radius: number; radiusInner: number; angle: number; length: number; width: number; surface: boolean; height: number;
  dir: number; spread: number; speed: [number, number]; velocity: [number, number, number]; inherit: number;
  life: [number, number]; gravity: number; drag: number; turb: number; turbScale: number; orbit: number; radial: number; bounce: number; collide: boolean;
  size: Curve; sizeVar: [number, number]; stretch: number; rot: [number, number]; spin: [number, number];
  color: Gradient; alpha: Curve; emissive: Curve; erode: Curve;
  tex: TexSpec; frame: number; fps: number; blend: PBlend; soft: number; rim: ColorRef | null; rimAmt: number; align: number; aspect: number;
  local: boolean; hold: number; max: number;
  /** v1 burst semantics (spawn jitter + speed scale with the area) */
  legacy: boolean;
}

export interface RibbonL extends LayerBase {
  type: 'ribbon';
  width: Curve; life: number; color: Gradient; alpha: Curve; emissive: number; noise: number; scroll: number; tile: number;
  blend: PBlend; rim: ColorRef | null; rimAmt: number; minDist: number; flat: boolean;
}

export interface BeamL extends LayerBase {
  type: 'beam';
  width: number; life: number; color: Gradient; alpha: Curve; emissive: number; noise: number; freq: number; scroll: number;
  flare: number; flareTex: TexSpec; taper: [number, number]; core: number; blend: PBlend; from: Anchor; to: Anchor | null;
}

export interface MeshL extends LayerBase {
  type: 'mesh';
  shape: number; scale: Curve; stretch: [number, number, number]; life: number; color: Gradient; alpha: Curve; emissive: Curve;
  rim: ColorRef | null; rimPow: number; rimEmissive: number; noiseScale: number; scroll: [number, number]; noise: number;
  dissolve: Curve; edge: ColorRef | null; edgeWidth: number; edgeEmissive: number; mask: number; maskParam: Curve;
  blend: PBlend; spin: number; rotate: [number, number, number]; align: number; wobble: number; twist: number; angle: number; hold: number;
  /** v1 mesh: scale eases out, additive meshes take min(cap, 1.6) */
  legacy: boolean;
}

export interface ShockwaveL extends LayerBase {
  type: 'shockwave';
  vertical: boolean; radius: Curve; width: Curve; life: number; color: Gradient; alpha: Curve; emissive: Curve; sharp: number;
  noise: number; inner: number; blend: PBlend; distort: number;
}

export interface DecalL extends LayerBase {
  type: 'decal';
  shape: number; style: number; radius: Curve; life: number; color: Gradient; alpha: Curve; emissive: Curve; rim: ColorRef | null;
  tex: TexSpec; angle: number; length: number; width: number; spinRandom: boolean;
}

export interface LightL extends LayerBase {
  type: 'light';
  color: ColorRef; intensity: number; radius: number; life: number; attack: number; flicker: number;
}

export interface DistortL extends LayerBase {
  type: 'distort';
  mode: number; size: Curve; strength: Curve; life: number; ground: boolean;
}

export interface FeelL extends LayerBase {
  type: 'feel';
  shake: number; who: number; hitFlash: number; hitStop: number; squash: number;
}

export type Layer = EmitterL | RibbonL | BeamL | MeshL | ShockwaveL | DecalL | LightL | DistortL | FeelL;

export interface Def {
  id: string;
  duration: number;
  teamTint: boolean;
  layers: Layer[];
  /** time after which nothing of this def is alive (s) */
  span: number;
  /** does the def have anticipation (windup) layers? */
  hasWindup: boolean;
  /** world-event / status bindings declared by `bind` pseudo-layers */
  binds: string[];
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pair = (v: unknown, d: [number, number]): [number, number] => {
  if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return [v[0], v[1]];
  if (typeof v === 'number' && Number.isFinite(v)) return [v, v];
  return d;
};
const vec3 = (v: unknown, d: [number, number, number] | null): [number, number, number] | null => {
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) return [v[0], v[1], v[2]];
  return d;
};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const deg = (v: unknown, d: number): number => num(v, d) * Math.PI / 180;
const anchor = (v: unknown): Anchor | null => (ANCHORS.includes(v as Anchor) ? (v as Anchor) : null);
const pick = <T extends Record<string, number>>(map: T, v: unknown, d: number): number => (typeof v === 'string' && v in map ? map[v] : d);
const blendOf = (v: unknown, d: PBlend): PBlend => (v === 'add' ? 0 : v === 'alpha' ? 1 : v === 'ink' ? 2 : v === 'chip' ? 3 : d);
/** curve that eases out from a to b (v1 ring radius / mesh scale) */
const easeOutCurve = (a: number, b: number): Curve => curve([0, 0.25, 0.5, 0.75, 1].map((t) => [t, a + (b - a) * (1 - (1 - t) * (1 - t))]), a);

export const MESH_ALIGN = { dir: 0, flat: 1, velocity: 2, camera: 3, up: 4 } as const;
export const MASK = { none: 0, band: 1, top: 2, sweep: 3, ends: 4, edge: 5 } as const;
export const DECAL_SHAPES = ['circle', 'ring', 'cone', 'rect', 'line'];
export const DECAL_STYLES = { plain: 0, scorch: 1, crack: 2, ink: 3, frost: 4, light: 5 } as const;
export const DISTORT_MODES = { ring: 0, haze: 1, bulge: 2 } as const;
export const EMIT_ALIGN = { camera: 0, velocity: 1, ground: 2, axis: 3 } as const;

function base(r: Record<string, unknown>): LayerBase {
  return {
    type: String(r.type), delay: Math.max(0, num(r.delay, 0)), at: anchor(r.at), windup: r.phase === 'windup',
    socket: typeof r.socket === 'string' ? r.socket : null, offset: vec3(r.offset, null), follow: bool(r.follow, false),
    fit: typeof r.fit === 'boolean' ? r.fit : null, secondary: bool(r.secondary, false), chance: Math.max(0, Math.min(1, num(r.chance, 1))),
  };
}

function emitterFrom(r: Record<string, unknown>, b: LayerBase, legacy: boolean): EmitterL {
  const tex = texSpec(r.texture ?? (legacy ? 'spark' : 'glow'));
  const blend = blendOf(r.blend, legacy ? 0 : 0);
  const count = Math.max(0, Math.round(num(r.count, legacy ? 8 : 0)));
  const bursts: [number, number][] = Array.isArray(r.bursts)
    ? (r.bursts as unknown[]).filter((x) => Array.isArray(x) && x.length === 2).map((x) => [num((x as number[])[0], 0), Math.round(num((x as number[])[1], 0))])
    : [];
  const flipbook = tex.frames > 1 && !tex.variants;
  return {
    ...b, type: 'emitter',
    count, rate: Math.max(0, num(r.rate, 0)), perMeter: Math.max(0, num(r.perMeter, 0)), bursts, duration: num(r.duration, -1),
    shape: pick(SHAPE, r.shape, legacy && b.at === 'ground' ? SHAPE.disc : SHAPE.point),
    radius: num(r.radius, legacy && b.at === 'ground' ? 0.15 : 0.2), radiusInner: num(r.radiusInner, 0), angle: deg(r.angleDeg, 60),
    length: num(r.length, 2), width: num(r.width, 0), surface: bool(r.surface, false), height: num(r.height, 0),
    dir: pick(DIR, r.dir, DIR.up), spread: deg(r.spreadDeg, legacy ? 60 : 30), speed: pair(r.speed, legacy ? [1, 2] : [0, 0]),
    velocity: vec3(r.velocity, [0, 0, 0])!, inherit: num(r.inherit, legacy ? 0.15 : 0),
    life: pair(r.life, [0.2, 0.4]), gravity: num(r.gravity, 0), drag: num(r.drag, 0), turb: num(r.turbulence, 0), turbScale: num(r.turbulenceScale, 1.2),
    orbit: deg(r.orbitDeg, 0), radial: num(r.radial, 0), bounce: num(r.bounce, 0.25), collide: bool(r.collide, true),
    size: curve(r.size, [0.1, 0.05]), sizeVar: pair(r.sizeVar, [1, 1]),
    stretch: num(r.stretch, legacy ? (tex.stretch ? 0.035 : 0) : 0), rot: pair(r.rotDeg, [0, 360]).map((x) => x * Math.PI / 180) as [number, number],
    spin: pair(r.spinDeg, legacy ? [-170, 170] : [0, 0]).map((x) => x * Math.PI / 180) as [number, number],
    color: gradient(r.color, 'team'), alpha: curve(r.alpha, [1, 0]), emissive: curve(r.emissive, 1), erode: curve(r.erode, flipbook && blend !== 0 ? [0, 0, 0.15, 0.55] : 0),
    tex, frame: Math.round(num(r.frame, -1)), fps: num(r.fps, 0), blend, soft: num(r.soft, tex.cell < 32 ? 0.35 : 0.08),
    rim: colorRef(r.rim), rimAmt: num(r.rimAlpha, colorRef(r.rim) ? 0.6 : 0), align: pick(EMIT_ALIGN, r.align, 0), aspect: num(r.aspect, 1),
    local: r.space === 'local', hold: num(r.hold, 0), max: Math.max(0, Math.round(num(r.max, 400))), legacy,
  };
}

function parseLayer(r: Record<string, unknown>, d: VfxDefT, binds: string[]): Layer[] {
  const b = base(r);
  switch (r.type) {
    case 'bind': if (typeof r.event === 'string') binds.push(r.event); return [];
    case 'emitter': return [emitterFrom(r, b, false)];
    case 'burst': {
      // v1: one burst (or a rate while it follows a body), cone `spreadDeg` around up / against travel
      const col = Array.isArray(r.color) ? r.color : [r.color, r.color];
      const e = emitterFrom({ ...r, color: [col[0], col[1] ?? col[0]], dir: b.at === 'path' ? 'back' : 'up' }, b, true);
      e.secondary = e.blend !== 0;
      return [e];
    }
    case 'sprite': {
      const e = emitterFrom({ ...r, count: 1, speed: [0, 0], spreadDeg: 0, life: [num(r.life, d.duration), num(r.life, d.duration)], spinDeg: r.spinDeg ?? [0, 0], rotDeg: r.rotDeg ?? [0, 0] }, b, false);
      e.local = r.space !== 'world';
      e.hold = num(r.hold, 0.5);
      e.collide = false;
      e.soft = num(r.soft, 0.05);
      return [e];
    }
    case 'flash': {
      // a short glow (HDR, blooms) + a pooled light; v2 adds texture, core (T4 white core), light: false
      const radius = num(r.radius, 0.5), life = Math.max(0.03, num(r.life, 0.06)), inten = num(r.intensity, 1.5);
      const out: Layer[] = [];
      const glow = emitterFrom({ count: 1, texture: r.texture ?? 'glow', size: [radius * 2.2, radius * 2.7], alpha: [1, 0], color: r.color ?? 'team', emissive: inten, life: [life + 0.04, life + 0.04], spinDeg: [0, 0], rotDeg: [0, 360], soft: 0.25 }, { ...b, secondary: false }, false);
      glow.collide = false;
      out.push(glow);
      if (r.core !== undefined) {
        const core = emitterFrom({ count: 1, texture: 'glow', size: [radius * 0.9, radius * 1.1], alpha: [1, 0], color: r.core, emissive: Math.max(inten, 10), life: [life * 0.8 + 0.02, life * 0.8 + 0.02], rotDeg: [0, 0], soft: 0.25 }, { ...b, secondary: false }, false);
        core.collide = false;
        out.push(core);
      }
      if (r.light !== false && inten >= 1.2) {
        out.push({ ...b, type: 'light', color: colorRef(r.color) ?? { k: 1 }, intensity: inten * 4, radius: Math.max(2, radius * 6), life: life * 1.6 + 0.04, attack: 0, flicker: 0 });
      }
      return out;
    }
    case 'trail': case 'ribbon': {
      const v1 = r.type === 'trail';
      const w = num(r.width, 0.2);
      const a = num(Array.isArray(r.alpha) ? r.alpha[0] : r.alpha, 0.6);
      return [{
        ...b, type: 'ribbon', at: b.at ?? 'path',
        width: v1 ? curve([w * 0.35, w], w) : curve(r.width, w), life: Math.max(0.04, num(r.life, 0.2)),
        color: gradient(r.color, 'team'), alpha: v1 ? curve([a * 0.25, a], a) : curve(r.alpha, [0, 1]), emissive: num(r.emissive, 1),
        noise: num(r.noise, v1 ? 0.25 : 0.4), scroll: num(r.scroll, 1.5), tile: num(r.tile, 0.6), blend: blendOf(r.blend, 0),
        rim: colorRef(r.rim), rimAmt: num(r.rimAlpha, colorRef(r.rim) ? 0.6 : 0), minDist: num(r.minDist, 0.12), flat: r.face === 'ground',
      }];
    }
    case 'ring': case 'shockwave': {
      const v1 = r.type === 'ring';
      const rad = pair(r.radius, [0.3, 1]);
      const life = Math.max(0.04, num(r.life, 0.3));
      return [{
        ...b, type: 'shockwave', vertical: r.mode === 'vertical',
        radius: v1 ? easeOutCurve(rad[0], rad[1]) : curve(r.radius, [0.3, 1]), width: curve(r.width, 0.1), life,
        color: gradient(r.color, 'team'), alpha: curve(r.alpha, [1, 0]), emissive: curve(r.emissive, 1), sharp: num(r.sharp, v1 ? 0.6 : 1.5),
        noise: num(r.noise, v1 ? 0 : 0.35), inner: num(r.inner, 0), blend: blendOf(r.blend, 0), distort: num(r.distort, 0),
      }];
    }
    case 'beam': return [{
      ...b, type: 'beam', width: num(r.width, 0.2), life: Math.max(0.04, num(r.life, 0.2)), color: gradient(r.color, 'team'),
      alpha: curve(r.alpha, [1, 0]), emissive: num(r.emissive, 1.5), noise: num(r.noise, 0), freq: num(r.freq, 1.2), scroll: num(r.scroll, 2),
      flare: num(r.flare, 0), flareTex: texSpec(r.flareTexture ?? 'flare'), taper: pair(r.taper, [0.6, 1]), core: num(r.core, 1.2),
      blend: blendOf(r.blend, 0), from: anchor(r.from) ?? 'origin', to: anchor(r.to),
    }];
    case 'mesh': {
      const isCurve = Array.isArray(r.scale) && (r.scale.length > 2 || Array.isArray(r.scale[0]));
      const legacy = !isCurve && ['rim', 'rimPow', 'dissolve', 'noise', 'mask', 'emissive', 'edge', 'wobble', 'twist', 'stretch', 'align', 'rotateDeg', 'angleDeg'].every((k) => r[k] === undefined);
      const sc = pair(r.scale, [0.5, 0.5]);
      return [{
        ...b, type: 'mesh', shape: shapeIndex(r.shape), scale: isCurve ? curve(r.scale, 0.5) : easeOutCurve(sc[0], sc[1]),
        stretch: vec3(r.stretch, [1, 1, 1])!, life: Math.max(0.04, num(r.life, 0.3)), color: gradient(r.color, 'team'),
        alpha: curve(r.alpha, [1, 0]), emissive: curve(r.emissive, 1), rim: colorRef(r.rim), rimPow: num(r.rimPow, 2.5), rimEmissive: num(r.rimEmissive, 1.5),
        noiseScale: num(r.noiseScale, 1.5), scroll: pair(r.scroll, [0, 0.4]), noise: num(r.noise, legacy ? 0 : 0.5),
        dissolve: curve(r.dissolve, 0), edge: colorRef(r.edge), edgeWidth: num(r.edgeWidth, 0.08), edgeEmissive: num(r.edgeEmissive, 2),
        mask: pick(MASK, r.mask, 0), maskParam: curve(r.maskParam, 0.2), blend: blendOf(r.blend, 0), spin: deg(r.spinDeg, 0),
        rotate: (vec3(r.rotateDeg, [0, 0, 0])!).map((x) => x * Math.PI / 180) as [number, number, number],
        align: pick(MESH_ALIGN, r.align, MESH_ALIGN.dir), wobble: num(r.wobble, 0), twist: num(r.twist, 0), angle: deg(r.angleDeg, 90) / 2,
        hold: num(r.hold, 0.5), legacy,
      }];
    }
    case 'decal': {
      const legacyTex = typeof r.texture === 'string' ? r.texture : 'crack';
      const style = typeof r.style === 'string' && r.style in DECAL_STYLES ? DECAL_STYLES[r.style as keyof typeof DECAL_STYLES]
        : legacyTex === 'crack' ? DECAL_STYLES.crack : legacyTex === 'smoke' ? DECAL_STYLES.ink : legacyTex === 'glow' ? DECAL_STYLES.light : DECAL_STYLES.plain;
      return [{
        ...b, type: 'decal', shape: Math.max(0, DECAL_SHAPES.indexOf(String(r.shape ?? 'circle'))), style,
        radius: curve(r.radius, 1), life: Math.max(0.05, num(r.life, 0.8)), color: gradient(r.color, 'team'), alpha: curve(r.alpha, [0.5, 0]),
        emissive: curve(r.emissive, style === DECAL_STYLES.light ? 1.5 : 0), rim: colorRef(r.rim), tex: texSpec(legacyTex),
        angle: deg(r.angleDeg, 60) / 2, length: num(r.length, 0), width: num(r.width, 0), spinRandom: r.shape === undefined || r.shape === 'circle' || r.shape === 'ring',
      }];
    }
    case 'light': return [{
      ...b, type: 'light', color: colorRef(r.color) ?? { k: 1 }, intensity: num(r.intensity, 4), radius: num(r.radius, 4),
      life: Math.max(0.03, num(r.life, 0.3)), attack: Math.max(0, num(r.attack, 0)), flicker: Math.max(0, Math.min(1, num(r.flicker, 0))),
    }];
    case 'distort': return [{
      ...b, type: 'distort', mode: pick(DISTORT_MODES, r.mode, 0), size: curve(r.size, [0.5, 2]), strength: curve(r.strength, [0.02, 0]),
      life: Math.max(0.04, num(r.life, 0.4)), ground: r.align === 'ground',
    }];
    case 'feel': return [{
      ...b, type: 'feel', shake: Math.max(0, Math.min(1, num(r.shake, 0))), who: r.who === 'all' ? 1 : 0,
      hitFlash: Math.max(0, num(r.hitFlash, 0)), hitStop: Math.max(0, Math.min(0.12, num(r.hitStop, 0))), squash: Math.max(0, Math.min(0.3, num(r.squash, 0))),
    }];
    default: return [];
  }
}

/** how long a layer can live after its delay (s); `dur` is the def duration */
function layerSpan(l: Layer, dur: number): number {
  switch (l.type) {
    case 'emitter': {
      const emitFor = l.rate > 0 || l.perMeter > 0 ? (l.duration >= 0 ? l.duration : dur) : 0;
      const lastBurst = l.bursts.reduce((m, x) => Math.max(m, x[0]), 0);
      return Math.max(emitFor, lastBurst) + l.life[1];
    }
    case 'ribbon': return l.life;
    case 'distort': case 'beam': case 'mesh': case 'shockwave': case 'decal': case 'light': return l.life;
    default: return 0;
  }
}

export function parseDef(d: VfxDefT): Def {
  const layers: Layer[] = [];
  const binds: string[] = [];
  for (const raw of d.layers) for (const l of parseLayer(raw as Record<string, unknown>, d, binds)) layers.push(l);
  let span = d.duration;
  for (const l of layers) span = Math.max(span, l.delay + layerSpan(l, d.duration));
  return { id: d.id, duration: d.duration, teamTint: d.teamTint, layers, span, hasWindup: layers.some((l) => l.windup), binds };
}

/** the highest emissive any layer of the def asks for (gallery / audits) */
export function defPeak(d: Def): number {
  let m = 0;
  for (const l of d.layers) {
    if (l.type === 'emitter' || l.type === 'mesh' || l.type === 'shockwave' || l.type === 'decal') m = Math.max(m, curveMax(l.emissive));
    else if (l.type === 'beam' || l.type === 'ribbon') m = Math.max(m, l.emissive);
  }
  return m;
}

export { constCurve };

// PLAYGROUND place host (PLAYGROUND_BUILD.md 9 and 13: the AWAY chunk; PLACES.md 2.3, P7, P9, P13, P14). The stage imports this module lazily on
// the first trip (StageLike.loadPlace) and asks it for a place's look chunk (src/render/places/<id>.ts, one lazy chunk per place). A place
// look is DATA plus one build function: its sky (the 9 sky uniforms and fog, Table.setSky), its light (key, rim and fill as token mixes; the
// stage re-points its three lights and every jelly's light uniforms and white balance), its environment panels (EnvHub.setPanels: the old
// cube is disposed), and `build(kit, layout)` which draws the ground (its own band-limited noise, top at y = 0), the walls, 3 to 6 backdrop
// cards (renderOrder -99..-51, low poly), the things (opaque, renderOrder 0..9, before the jellies) and its weather, for the wide (0) or tall
// (1) layout from the same kit. Movers are posed from the bound PropWorldLike poses (8 floats a prop) through propThing.
// The props kit: shared geometries and materials per kind (MeshStandardMaterial with hub.apply), InstancedMesh for repeated statics, one
// instanced contact-shadow draw. Weather and reaction particles count against a per-tier cap, x0.3 in Calm, none with reduced motion.
// Token colours only (OKLCH mixes of src/ui/theme.ts's eight). Every module imports three by the bare specifier (it stays in the stage chunk).
import * as THREE from 'three';
import type { EnvHub, PanelDef } from './env.ts';
import type { SkyLook } from './table.ts';
import { linearToOklch, oklchToLinear, type Rgb } from './oklch.ts';
import { Particles, type EmitSpec } from './particles.ts';
import { fitPlace, type PlayFrame } from './placeview.ts';

/** The eight theme tokens (src/ui/theme.ts PALETTE; table.ts's numbers, `ember` = coral). */
export const TOKENS = { ink: 0x14102a, plum: 0x2a1744, dusk: 0x5b3a86, felt: 0x2a2150, amber: 0xffb347, lagoon: 0x59d6e6, coral: 0xff5a4d, cream: 0xfff1d6 } as const;
export type Token = keyof typeof TOKENS;
const lin = (h: number): Rgb => [16, 8, 0].map((sh) => { const v = ((h >> sh) & 255) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }) as Rgb;
/** An OKLCH mix of two tokens (t 0 = a, 1 = b) times a lightness factor `k` (a deeper or lighter tone of the mix), linear RGB. */
export function tok(a: Token, b: Token = a, t = 0, k = 1): Rgb {
  const A = linearToOklch(lin(TOKENS[a])), B = linearToOklch(lin(TOKENS[b]));
  let dh = B[2] - A[2]; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
  const c = oklchToLinear((A[0] + (B[0] - A[0]) * t) * k, A[1] + (B[1] - A[1]) * t, A[2] + dh * t);
  return [Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2])];
}
export const col = (c: Rgb): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);

/** A place's light (the stage's three lights and the jellies' own light terms). Directions point FROM the body TOWARD the light. */
export interface PlaceLight {
  key: Rgb; keyI: number; keyPos: readonly [number, number, number];
  /** Where the key points (default the pad); its cone half-angle in radians (default 0.95). */
  keyAim?: readonly [number, number, number]; keyAngle?: number;
  rim: Rgb; rimI: number; rimDir: readonly [number, number, number];
  fillSky: Rgb; fillGround: Rgb; fillI: number;
  /** The key's tint, for the jelly white balance (Home's amber softbox is [1, 0.74, 0.42]). */
  keyTint: Rgb;
}
export interface PlaceBuilt {
  readonly group: THREE.Group;
  /** Per thing index (PlaceDef.things order): the object a bound pose drives (null = static, or not a mover); an array = one object per part
   *  (the thing's props in PropWorldLike's order: a chime's bells, a ring's segments). */
  readonly movers: (THREE.Object3D | readonly THREE.Object3D[] | null)[];
  /** The kind of pose each mover takes: 0 = position only, 1 = position and rotation (a ball, a hinge). */
  readonly moverKind: number[];
  /** The heat point (the fire): toast browns the side facing it (StageLike.setHeatPoint). */
  readonly heat: readonly [number, number, number] | null;
  /** Draw calls the set and props use (RD-08 counts them in the browser; this is the kit's own count). */
  update(dt: number, time: number, quiet: boolean, reduced: boolean, tier: number): void;
  /** StageLike.thingFx: a thing's own effect (kind 1 a puff: the kettle's steam, the hearth's fire, the pine's snow, the drip leaf's shower;
   *  thing -1 kind 2: the finale spectacle, amount 0..1 eased by the place). False when the place has no such effect. */
  thingFx?(thing: number, kind: number, amount: number): boolean;
  dispose(): void;
}
export interface PlaceLook {
  readonly id: string;
  readonly sky: SkyLook;
  light(layout: 0 | 1): PlaceLight;
  readonly panels: readonly PanelDef[];
  /** The postcard bubble's sky band (linear). */
  readonly skyBand: Rgb;
  /** PLACES 2.3: how far a ceremony dims the place's light (0 = none; a bright place 0.3), eased over at least 1.0 s (RD-03). */
  readonly ceremonyDim?: number;
  build(kit: PropKit, layout: 0 | 1): PlaceBuilt;
}

/** The lazy place look chunks (one per shipped place; T1 names each by this module). */
const LOADERS: Record<string, () => Promise<{ default: PlaceLook }>> = {
  hearthlog: () => import('./places/hearthlog.ts'),
  ripple: () => import('./places/ripple.ts'),
  frostbell: () => import('./places/frostbell.ts'),
  rainleaf: () => import('./places/rainleaf.ts'),
};
export const PLACE_LOOKS = Object.keys(LOADERS);

const SHADOW_FRAG = 'varying vec2 vP; varying float vA; void main(){ float r = length(vP); float a = (1.0 - smoothstep(0.35, 1.0, r)) * vA; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }';
const SHADOW_VERT = 'attribute float aAmt; varying vec2 vP; varying float vA; void main(){ vP = position.xy * 2.0; vA = aAmt; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }';

/** A unit-UV card / water vertex stage (vUv, the world position vWP). */
export const UV_VERT = 'varying vec2 vUv; varying vec3 vWP; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
/** Band-limited value noise for place grounds and cards (pN in 0..1; pFbm two octaves). */
export const NOISE = 'float pH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float pN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(pH(i), pH(i + vec2(1.0, 0.0)), f.x), mix(pH(i + vec2(0.0, 1.0)), pH(i + vec2(1.0, 1.0)), f.x), f.y); } float pFbm(vec2 p){ return 0.65 * pN(p) + 0.35 * pN(p * 2.13 + 7.1); }';
/** The water surface (one translucent draw per water zone, after the jellies: depth test on, depth write off): deep toward the middle, a
 *  sky mirror at grazing angles, slow ripples (uMotion: 1, 0.3 in Calm, 0 with reduced motion), a foam band at the edge (uFoam). */
const WATER_FRAG = `varying vec2 vUv; varying vec3 vWP; uniform float uTime, uMotion, uFoam, uAlpha, uBox; uniform vec3 uDeep, uShallow, uSkyC, uFoamC; ${'NOISE'}
void main(){
  vec2 q = vUv * 2.0 - 1.0;
  float e = uBox > 0.5 ? vUv.y : 1.0 - length(q);   // a box's foam edge is its front (toward the camera, +z); a disc's its rim
  vec3 V = normalize(cameraPosition - vWP);
  float fr = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
  float t = uTime * uMotion;
  float rip = pN(vWP.xz * 3.1 + vec2(t * 0.35, t * 0.22)) * 0.6 + pN(vWP.xz * 6.3 - vec2(t * 0.27, -t * 0.31)) * 0.4;
  vec3 c = mix(uDeep, uShallow, smoothstep(0.0, 0.45, 1.0 - e));
  c = mix(c, uSkyC, 0.25 + 0.55 * fr);
  c += uFoamC * smoothstep(0.62, 0.9, rip) * 0.18;
  float foam = uFoam * (1.0 - smoothstep(0.0, 0.12 + 0.05 * rip, e));
  c = mix(c, uFoamC, foam * 0.85);
  gl_FragColor = vec4(c, clamp(uAlpha + 0.3 * fr + foam * 0.6, 0.0, 1.0) * smoothstep(0.0, 0.02, e + 0.02));
  #include <colorspace_fragment>
}`.replace("${'NOISE'}", NOISE);

/** Particle spec reused for every emit (zero allocation per frame). */
export const SP: EmitSpec = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.02, kind: 0, r: 1, g: 1, b: 1, a: 1, drag: 0, grav: 0, fade: 1 };
/** Fill SP and return it (all fields, so nothing from the last emit leaks). */
export function sp(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: Rgb, a: number, drag = 0, grav = 0, kind: 0 | 1 | 2 | 3 = 0, fade: 0 | 1 | 2 = 1): EmitSpec {
  const s = SP; s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz; s.life = life; s.size = size; s.r = c[0]; s.g = c[1]; s.b = c[2]; s.a = a; s.drag = drag; s.grav = grav; s.kind = kind; s.fade = fade; s.attract = 0; s.spin = 0;
  return s;
}

/** Static parts batched by geometry and material into one InstancedMesh each (fewer draw calls; RD-08). */
export class Batch {
  private readonly lists = new Map<string, { g: THREE.BufferGeometry; m: THREE.Material; mats: THREE.Matrix4[]; order: number }>();
  add(key: string, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, q?: THREE.Quaternion, order = 1): void {
    let l = this.lists.get(key);
    if (!l) { l = { g, m, mats: [], order }; this.lists.set(key, l); }
    l.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q ?? new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
  }
  flush(kit: PropKit, into: THREE.Group): void { for (const l of this.lists.values()) into.add(kit.instanced(l.g, l.m, l.mats, l.order)); this.lists.clear(); }
}
export const yawQ = (a: number): THREE.Quaternion => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);

/** Shared geometry, materials and statics of a place: everything it builds is disposed together. */
export class PropKit {
  readonly hub: EnvHub;
  private readonly geos = new Map<string, THREE.BufferGeometry>();
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly extra: { dispose(): void }[] = [];
  private readonly shadows: number[] = [];
  constructor(hub: EnvHub) { this.hub = hub; }

  mat(key: string, c: Rgb, rough = 0.8, env = 0.35, emissive?: Rgb, emissiveI = 1): THREE.MeshStandardMaterial {
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: col(c), roughness: rough, metalness: 0 });
      if (emissive) { m.emissive = col(emissive); m.emissiveIntensity = emissiveI; }
      this.hub.apply(m, env);
      this.mats.set(key, m);
    }
    return m;
  }
  geo<G extends THREE.BufferGeometry>(key: string, make: () => G): G {
    let g = this.geos.get(key) as G | undefined;
    if (!g) { g = make(); this.geos.set(key, g); }
    return g;
  }
  box(w: number, h: number, d: number): THREE.BoxGeometry { return this.geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)); }
  cyl(rt: number, rb: number, h: number, seg = 16): THREE.CylinderGeometry { return this.geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)); }
  sphere(r: number, ws = 20, hs = 14): THREE.SphereGeometry { return this.geo(`s${r},${ws}`, () => new THREE.SphereGeometry(r, ws, hs)); }
  capsule(r: number, total: number): THREE.CapsuleGeometry { return this.geo(`k${r},${total}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, total - 2 * r), 6, 14)); }
  /** A mesh at renderOrder `order` (0..9 for opaque props). */
  mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, order = 2): THREE.Mesh {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.renderOrder = order; return o;
  }
  /** Repeated statics as ONE draw: an InstancedMesh of `g` at each matrix. */
  instanced(g: THREE.BufferGeometry, m: THREE.Material, mats: readonly THREE.Matrix4[], order = 1): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(g, m, Math.max(1, mats.length));
    mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.count = mats.length; im.renderOrder = order; im.frustumCulled = false;
    this.extra.push(im);
    return im;
  }
  /** A soft contact shadow under a prop (x, z, radii rx, rz, strength); all of them become ONE instanced draw (shadowMesh). */
  shadow(x: number, z: number, rx: number, rz: number, a = 0.45): void { this.shadows.push(x, z, rx, rz, a); }
  shadowMesh(): THREE.InstancedMesh | null {
    const n = this.shadows.length / 5;
    if (!n) return null;
    const g = new THREE.PlaneGeometry(1, 1);
    const amt = new Float32Array(n);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: false, depthWrite: false, depthTest: true, toneMapped: false, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const im = new THREE.InstancedMesh(g, mat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      m4.compose(new THREE.Vector3(this.shadows[o], 0.003, this.shadows[o + 1]), q, new THREE.Vector3(this.shadows[o + 2] * 2.4, this.shadows[o + 3] * 2.4, 1));
      im.setMatrixAt(i, m4); amt[i] = this.shadows[o + 4];
    }
    g.setAttribute('aAmt', new THREE.InstancedBufferAttribute(amt, 1));
    im.renderOrder = -40; im.frustumCulled = false;
    this.extra.push(g, mat, im);
    return im;
  }
  /** A ground (or any surface) material: MeshStandardMaterial with the world position and `glsl` in place of the colour stage (it may read
   *  vWP, the NOISE functions and its own uniforms `u`), cached by `key`. */
  surface(key: string, c: Rgb, rough: number, glsl: string, u: Record<string, { value: unknown }> = {}, env = 0.3): THREE.MeshStandardMaterial {
    const m = this.mat(key, c, rough, env);
    const decl = Object.keys(u).map((k) => `uniform ${(u[k].value as THREE.Color).isColor ? 'vec3' : typeof u[k].value === 'number' ? 'float' : 'vec4'} ${k};`).join('');
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWP;${decl}${NOISE}`).replace('#include <color_fragment>', `#include <color_fragment>\n{${glsl}}`);
    };
    m.customProgramCacheKey = () => 'wh-pl-' + key;
    return m;
  }
  /** The place's ground: a 16 x 16 m plane, top at y = 0 (renderOrder -50). */
  ground(m: THREE.Material): THREE.Mesh { const g = this.mesh(this.geo('ground', () => new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2)), m, 0, 0, 0, -50); return g; }
  /** A backdrop card (unlit, low poly; renderOrder -99..-51) drawn by `frag` (vUv, vWP, NOISE, uTime / uMotion and its uniforms). */
  card(frag: string, u: Record<string, { value: unknown }>, w: number, h: number, x: number, y: number, z: number, ry: number, order: number, transparent = false): THREE.Mesh {
    const decl = Object.keys(u).filter((k) => k !== 'uTime' && k !== 'uMotion').map((k) => `uniform ${(u[k].value as THREE.Color).isColor ? 'vec3' : 'float'} ${k};`).join('');
    const mat = this.own(new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: `varying vec2 vUv; varying vec3 vWP; uniform float uTime, uMotion; ${decl} ${NOISE}\n${frag}`, uniforms: { uTime: { value: 0 }, uMotion: { value: 1 }, ...u },
      toneMapped: false, transparent, depthWrite: !transparent }));
    const c = this.mesh(this.geo(`card${w},${h}`, () => new THREE.PlaneGeometry(w, h)), mat, x, y, z, order); c.rotation.y = ry;
    return c;
  }
  /** A water surface at y = surfaceY over a disc (r) or a box (hx, hz): one translucent draw after the jellies (renderOrder 20). */
  water(shape: 'disc' | 'box', x: number, z: number, r: number, hx: number, hz: number, surfaceY: number, deep: Rgb, shallow: Rgb, sky: Rgb, foamC: Rgb, foam: number, alpha = 0.55): { mesh: THREE.Mesh; u: Record<string, { value: number }> } {
    const u = { uTime: { value: 0 }, uMotion: { value: 1 }, uFoam: { value: foam }, uAlpha: { value: alpha }, uBox: { value: shape === 'box' ? 1 : 0 },
      uDeep: { value: col(deep) }, uShallow: { value: col(shallow) }, uSkyC: { value: col(sky) }, uFoamC: { value: col(foamC) } };
    const mat = this.own(new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: WATER_FRAG, uniforms: u, transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }));
    const g = shape === 'disc' ? this.geo(`wd${r}`, () => new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2)) : this.geo(`wb${hx},${hz}`, () => new THREE.PlaneGeometry(2 * hx, 2 * hz).rotateX(-Math.PI / 2));
    const m = this.mesh(g, mat, x, surfaceY, z, 20);
    return { mesh: m, u: u as unknown as Record<string, { value: number }> };
  }
  /** Something else the place made (a particle system, a shader material) to dispose with the kit. */
  own<T extends { dispose(): void }>(o: T): T { this.extra.push(o); return o; }
  dispose(): void {
    for (const g of this.geos.values()) g.dispose();
    for (const m of this.mats.values()) { this.hub.release(m); m.dispose(); }
    for (const e of this.extra) e.dispose();
    this.geos.clear(); this.mats.clear(); this.extra.length = 0; this.shadows.length = 0;
  }
}

/**
 * A particle emitter for weather and reaction presets (D-80): embers (additive), snow, rain, steam wisps, drips, bubble cling (normal blend).
 * `cap` by tier [high, med, low]; Calm x0.3; none with reduced motion (PLACES P14). Zero allocation per frame.
 */
export class Emitter {
  readonly particles: Particles;
  private acc = 0;
  private seed: number;
  readonly caps: readonly [number, number, number];
  readonly ratePerS: number;
  private readonly spawn: (p: Particles, rnd: () => number) => void;
  constructor(caps: readonly [number, number, number], normal: boolean, spawn: (p: Particles, rnd: () => number) => void, ratePerS: number, order = 33) {
    this.caps = caps; this.spawn = spawn; this.ratePerS = ratePerS;
    this.particles = new Particles(caps[0], order, normal);
    this.seed = 0x2545f491;
  }
  rnd = (): number => { this.seed = (this.seed + 0x6d2b79f5) | 0; let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  /** tier: 0 high, 1 med, 2 low. `boost` multiplies the rate (a fire puff, the finale). */
  update(dt: number, time: number, quiet: boolean, reduced: boolean, tier: number, boost = 1): void {
    const cap = reduced ? 0 : Math.round(this.caps[Math.max(0, Math.min(2, tier))] * (quiet ? 0.3 : 1));
    this.acc += dt * this.ratePerS * boost * (quiet ? 0.3 : 1);
    while (this.acc >= 1) { this.acc -= 1; if (this.particles.count < cap) this.spawn(this.particles, this.rnd); }
    this.particles.update(dt, time);
  }
  dispose(): void { this.particles.dispose(); }
}

/** What the host needs of the stage to swap a place in and out (the stage's own objects; no copy). */
export interface StageCtx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly table: { setSky(p: SkyLook | null): void; setFelt(on: boolean): void };
  readonly key: THREE.SpotLight; readonly rim: THREE.DirectionalLight; readonly fill: THREE.HemisphereLight;
  views(): readonly { mats: { setLight(l: JellyLight | null): void } }[];
  readonly heat: THREE.Vector4;
  setSkyBand(r: number, g: number, b: number): void;
  /** A body's centre (xyz) and rest radius into out[0..3]; false when unknown or hidden (the reaction presets follow it). */
  body(id: number, out: Float32Array): boolean;
  /** A phone frame (a coarse pointer or a short side under 600 CSS px): LIFE 10.1's phone particle budget. */
  phone(): boolean;
}
/** The jellies' own light terms in a place (material.ts JellyMaterials.setLight). */
export interface JellyLight { keyDir: THREE.Vector3; rimDir: THREE.Vector3; keyCol: THREE.Color; rimCol: THREE.Color; keyTint: Rgb }

/**
 * The reaction-cell particle presets (D-80; PLACES 3; LIFE.md 10.1): src/data/life.ts PARTICLE ids 1 steam (a wisp rising off the skin, normal
 * blend: the weather twin), 2 embers (warm sparks rising, additive), 4 drips (drops running off and falling), 5 bubbles (a soft cling of small
 * bubbles that rise off the skin), 9 puff (a soft burst at the base: sand, snow or dust in the place's own tone). A preset follows its body
 * (the stage's body lookup) for lifeS seconds. Every particle counts against LIFE 10.1's autonomy budget (24 a second on a phone, 48 on a
 * desktop; 8 / 16 in Calm), a token bucket here; none with reduced motion. Zero allocation per frame.
 */
export class ReactFx {
  readonly soft = new Particles(96, 34, true);
  readonly glow = new Particles(32, 33, false);
  private readonly src = new Float32Array(8 * 8);   // kind, body, x, y, z, amount, left s, accumulator
  private bucket = 0;
  private seed = 0x9e3779b9 | 0;
  /** The place's puff tone (linear; sand, snow, loam). */
  puffC: Rgb = [0.8, 0.7, 0.55];
  private readonly at = new Float32Array(4);
  private rnd = (): number => { this.seed = (this.seed + 0x6d2b79f5) | 0; let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  /** Start a preset; false when it is not a preset kind or the 8 sources are busy. */
  start(kind: number, body: number, x: number, y: number, z: number, amount: number, lifeS: number): boolean {
    if (!(kind === 1 || kind === 2 || kind === 4 || kind === 5 || kind === 9)) return false;
    const S = this.src;
    for (let i = 0; i < 8; i++) {
      const o = i * 8;
      if (S[o + 6] > 0 && !(S[o] === kind && S[o + 1] === body && body >= 0)) continue;
      S[o] = kind; S[o + 1] = body; S[o + 2] = x; S[o + 3] = y; S[o + 4] = z;
      S[o + 5] = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
      S[o + 6] = kind === 9 ? 0.35 : Number.isFinite(lifeS) && lifeS > 0 ? Math.min(30, lifeS) : 2;
      S[o + 7] = kind === 9 ? 10 * S[o + 5] : 0;   // a puff is a burst
      return true;
    }
    return false;
  }
  clear(): void { this.src.fill(0); this.soft.clear(); this.glow.clear(); }
  update(dt: number, time: number, quiet: boolean, reduced: boolean, phone: boolean, ctx: StageCtx | null): void {
    const rate = (phone ? 24 : 48) * (quiet ? 1 / 3 : 1);
    this.bucket = Math.min(rate, this.bucket + rate * dt);
    const S = this.src, r = this.rnd, a = this.at;
    for (let i = 0; i < 8; i++) {
      const o = i * 8;
      if (S[o + 6] <= 0) continue;
      S[o + 6] -= dt;
      const kind = S[o], amt = S[o + 5];
      let cx = S[o + 2], cy = S[o + 3], cz = S[o + 4], R = 0.4;
      if (S[o + 1] >= 0) { if (ctx && ctx.body(S[o + 1], a)) { cx = a[0]; cy = a[1]; cz = a[2]; R = a[3]; } else { S[o + 6] = 0; continue; } }
      if (kind !== 9) S[o + 7] += dt * amt * (kind === 1 ? 9 : kind === 2 ? 7 : kind === 4 ? 7 : 6);
      while (S[o + 7] >= 1) {
        S[o + 7] -= 1;
        if (reduced || this.bucket < 1) continue;   // over the autonomy budget (or reduced motion): this particle is not drawn
        this.bucket -= 1;
        const th = r() * 6.2832, ca = Math.cos(th), sa = Math.sin(th);
        if (kind === 1) this.soft.emit(sp(cx + ca * R * 0.35 * r(), cy + R * 0.85, cz + sa * R * 0.35 * r(), ca * 0.04, 0.22 + 0.15 * r(), sa * 0.04, 1.3 + 0.6 * r(), R * (0.12 + 0.08 * r()), [0.92, 0.9, 0.86], 0.32, 0.5));
        else if (kind === 2) this.glow.emit(sp(cx + ca * R * 0.5, cy + R * 0.3, cz + sa * R * 0.5, ca * 0.08, 0.4 + 0.3 * r(), sa * 0.08, 1.0 + 0.6 * r(), 0.014 + 0.008 * r(), [1.0, 0.5 + 0.2 * r(), 0.14], 0.9, 0.4));
        else if (kind === 4) this.soft.emit(sp(cx + ca * R * 0.8, cy - R * 0.1 * r(), cz + sa * R * 0.8, ca * 0.05, -0.1, sa * 0.05, 0.55, 0.016, [0.62, 0.86, 0.95], 0.85, 0, 7, 2, 2));
        else if (kind === 5) this.soft.emit(sp(cx + ca * R * 0.95, cy + R * (r() - 0.6), cz + sa * R * 0.95, ca * 0.03, 0.12 + 0.08 * r(), sa * 0.03, 1.1 + 0.5 * r(), 0.018 + 0.016 * r(), [0.86, 0.95, 0.98], 0.55, 0.8));
        else this.soft.emit(sp(cx + ca * R * 0.9, 0.04, cz + sa * R * 0.9, ca * (0.35 + 0.3 * r()), 0.12 + 0.12 * r(), sa * (0.35 + 0.3 * r()), 0.6 + 0.3 * r(), 0.05 + 0.04 * r(), this.puffC, 0.5, 3.5));
      }
      if (kind === 9) S[o + 7] = 0;
    }
    this.soft.update(dt, time); this.glow.update(dt, time);
  }
  dispose(): void { this.soft.dispose(); this.glow.dispose(); }
}

/** The host: loads place looks, swaps one in (sky, ground, light, environment, things) and out, poses its movers, frames its bounds. */
export class PlaceHost {
  private readonly hub: EnvHub;
  private readonly looks = new Map<string, PlaceLook>();
  private cur: { id: string; layout: 0 | 1; look: PlaceLook; built: PlaceBuilt; kit: PropKit } | null = null;
  private homeL: { key: THREE.Color; keyI: number; keyPos: THREE.Vector3; keyAim: THREE.Vector3; keyAngle: number; rim: THREE.Color; rimI: number; rimPos: THREE.Vector3; sky: THREE.Color; ground: THREE.Color; fillI: number } | null = null;
  /** The jellies' light in the place (null = Home's): the stage gives it to every new body. */
  light: JellyLight | null = null;
  private readonly done = new Uint8Array(64);
  private ctx: StageCtx | null = null;
  /** The reaction presets (StageLike.reactFx): one pool for every place, kept across swaps. */
  readonly fx = new ReactFx();
  /** The ceremony dim (PLACES 2.3, RD-03): eased toward the place's dim while a ceremony plays, over at least 1.0 s each way. */
  private dimNow = 0;
  private baseI = [0, 0, 0];
  constructor(hub: EnvHub) { this.hub = hub; }
  get active(): string | null { return this.cur ? this.cur.id : null; }
  /** setPlayBounds' framing and lens (placeview.ts): the camera lives in the stage, the search here (it only runs in a place). */
  fit(cx: number, cz: number, hx: number, hz: number, w: number, h: number, top: number, right: number, bottom: number, left: number): PlayFrame | null {
    return fitPlace(cx, cz, hx, hz, w, h, top, right, bottom, left);
  }
  private applyLight(c: StageCtx, l: PlaceLight | null): void {
    const H = (this.homeL ??= { key: c.key.color.clone(), keyI: c.key.intensity, keyPos: c.key.position.clone(), keyAim: c.key.target.position.clone(), keyAngle: c.key.angle, rim: c.rim.color.clone(), rimI: c.rim.intensity,
      rimPos: c.rim.position.clone(), sky: c.fill.color.clone(), ground: c.fill.groundColor.clone(), fillI: c.fill.intensity });
    if (!l) {
      c.key.color.copy(H.key); c.key.intensity = H.keyI; c.key.position.copy(H.keyPos); c.key.angle = H.keyAngle; c.key.target.position.copy(H.keyAim);
      c.rim.color.copy(H.rim); c.rim.intensity = H.rimI; c.rim.position.copy(H.rimPos);
      c.fill.color.copy(H.sky); c.fill.groundColor.copy(H.ground); c.fill.intensity = H.fillI;
      this.light = null;
    } else {
      c.key.color.copy(col(l.key)); c.key.intensity = l.keyI; c.key.position.set(l.keyPos[0], l.keyPos[1], l.keyPos[2]); c.key.angle = l.keyAngle ?? 0.95;
      const a = l.keyAim ?? [0, 0.2, 0]; c.key.target.position.set(a[0], a[1], a[2]);
      const rd = new THREE.Vector3(l.rimDir[0], l.rimDir[1], l.rimDir[2]).normalize();
      c.rim.color.copy(col(l.rim)); c.rim.intensity = l.rimI; c.rim.position.copy(rd).multiplyScalar(6);
      c.fill.color.copy(col(l.fillSky)); c.fill.groundColor.copy(col(l.fillGround)); c.fill.intensity = l.fillI;
      this.light = { keyDir: new THREE.Vector3(l.keyPos[0], l.keyPos[1] - 0.4, l.keyPos[2]).normalize(), rimDir: rd, keyCol: col(l.key), rimCol: col(l.rim), keyTint: l.keyTint };
    }
    this.baseI = [c.key.intensity, c.rim.intensity, c.fill.intensity]; this.dimNow = 0;
    for (const v of c.views()) v.mats.setLight(this.light);
  }
  /** Swap a loaded place in for the layout (0 wide, 1 tall); id null = back to Home. False when that place is not loaded. */
  enter(c: StageCtx, id: string | null, layout: 0 | 1): boolean {
    if (id && !this.looks.has(id)) return false;
    const was = !!this.cur;
    this.ctx = c;
    if (this.cur) { this.cur.built.dispose(); this.cur.kit.dispose(); this.cur = null; }
    this.fx.clear();
    if (!id) {
      if (was) { c.table.setSky(null); c.table.setFelt(true); this.applyLight(c, null); this.hub.setPanels(c.renderer, null); c.heat.set(0, 0, 0, 0); }
      this.fx.soft.mesh.removeFromParent(); this.fx.glow.mesh.removeFromParent();
      return true;
    }
    const look = this.looks.get(id)!, kit = new PropKit(this.hub), built = look.build(kit, layout);
    this.cur = { id, layout, look, built, kit };
    c.scene.add(built.group);
    if (!this.fx.soft.mesh.parent) c.scene.add(this.fx.soft.mesh, this.fx.glow.mesh);
    c.table.setSky(look.sky); c.table.setFelt(false);
    this.applyLight(c, look.light(layout));
    this.hub.setPanels(c.renderer, look.panels);
    const hp = built.heat; if (hp) c.heat.set(hp[0], hp[1], hp[2], 1); else c.heat.set(0, 0, 0, 0);
    c.setSkyBand(look.skyBand[0], look.skyBand[1], look.skyBand[2]);
    return true;
  }
  /** StageLike.reactFx: a reaction cell's particle preset (false at Home or for a kind that is not a preset). */
  react(kind: number, body: number, x: number, y: number, z: number, amount: number, lifeS: number): boolean {
    return !!this.cur && this.fx.start(Math.floor(kind), Math.floor(body), x, y, z, amount, lifeS);
  }
  /** StageLike.thingFx: a thing's own effect in the place (the place chunk draws it). */
  thingFx(thing: number, kind: number, amount: number): boolean {
    const b = this.cur?.built;
    return !!b && !!b.thingFx && b.thingFx(Math.floor(thing), Math.floor(kind), Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1);
  }
  /** One frame: movers posed from the bound poses (each thing's props in PropWorldLike's order: part 0, 1, ...), the ceremony dim, the
   *  reaction presets, then the place's own weather and fire. */
  update(dt: number, time: number, quiet: boolean, reduced: boolean, tier: number, P: Float32Array | null, count: number, T: Int16Array | null, ceremony = false): void {
    const c = this.cur;
    if (!c) return;
    const mv = c.built.movers;
    if (P && T) {
      this.done.fill(0);
      for (let p = 0; p < count && p < T.length; p++) {
        const k = T[p];
        if (k < 0 || k >= mv.length) continue;
        const m = mv[k], part = this.done[k]++;
        const o = Array.isArray(m) ? (m as readonly THREE.Object3D[])[part] : part === 0 ? (m as THREE.Object3D | null) : null;
        if (!o) continue;
        const i = p * 8;
        if (!Number.isFinite(P[i])) continue;
        o.position.set(P[i], P[i + 1], P[i + 2]);
        if (c.built.moverKind[k]) o.quaternion.set(P[i + 3], P[i + 4], P[i + 5], P[i + 6]);
      }
    }
    // the ceremony dim: linear, 1.2 s for the whole way each way (RD-03: at least 1.0 s)
    const dimT = ceremony ? c.look.ceremonyDim ?? 0 : 0;
    if (this.dimNow !== dimT && this.ctx) {
      this.dimNow = dimT > this.dimNow ? Math.min(dimT, this.dimNow + dt / 1.2) : Math.max(dimT, this.dimNow - dt / 1.2);
      const k = 1 - this.dimNow, x = this.ctx;
      x.key.intensity = this.baseI[0] * k; x.rim.intensity = this.baseI[1] * k; x.fill.intensity = this.baseI[2] * k;
    }
    this.fx.update(dt, time, quiet, reduced, this.ctx ? this.ctx.phone() : true, this.ctx);
    c.built.update(dt, time, quiet, reduced, tier);
  }
  async load(id: string): Promise<boolean> {
    if (this.looks.has(id)) return true;
    const ld = LOADERS[id];
    if (!ld) return false;
    try { const m = await ld(); this.looks.set(id, m.default); return true; } catch { return false; }
  }
  look(id: string): PlaceLook | null { return this.looks.get(id) ?? null; }
}

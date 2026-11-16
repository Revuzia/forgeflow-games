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
import { Particles } from './particles.ts';
import { fitPlayBounds, type PlayFrame } from './placeview.ts';

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
  /** Per thing index (PlaceDef.things order): the object a bound pose drives (null = static, or not a mover). */
  readonly movers: (THREE.Object3D | null)[];
  /** The kind of pose each mover takes: 0 = position only, 1 = position and rotation (a ball, a hinge). */
  readonly moverKind: number[];
  /** The heat point (the fire): toast browns the side facing it (StageLike.setHeatPoint). */
  readonly heat: readonly [number, number, number] | null;
  /** Draw calls the set and props use (RD-08 counts them in the browser; this is the kit's own count). */
  update(dt: number, time: number, quiet: boolean, reduced: boolean, tier: number): void;
  dispose(): void;
}
export interface PlaceLook {
  readonly id: string;
  readonly sky: SkyLook;
  light(layout: 0 | 1): PlaceLight;
  readonly panels: readonly PanelDef[];
  /** The postcard bubble's sky band (linear). */
  readonly skyBand: Rgb;
  build(kit: PropKit, layout: 0 | 1): PlaceBuilt;
}

/** The lazy place look chunks (one per shipped place; T1 names each by this module). */
const LOADERS: Record<string, () => Promise<{ default: PlaceLook }>> = {
  hearthlog: () => import('./places/hearthlog.ts'),
};
export const PLACE_LOOKS = Object.keys(LOADERS);

const SHADOW_FRAG = 'varying vec2 vP; varying float vA; void main(){ float r = length(vP); float a = (1.0 - smoothstep(0.35, 1.0, r)) * vA; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }';
const SHADOW_VERT = 'attribute float aAmt; varying vec2 vP; varying float vA; void main(){ vP = position.xy * 2.0; vA = aAmt; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }';

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
  private rnd = (): number => { this.seed = (this.seed + 0x6d2b79f5) | 0; let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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
}
/** The jellies' own light terms in a place (material.ts JellyMaterials.setLight). */
export interface JellyLight { keyDir: THREE.Vector3; rimDir: THREE.Vector3; keyCol: THREE.Color; rimCol: THREE.Color; keyTint: Rgb }

/** The host: loads place looks, swaps one in (sky, ground, light, environment, things) and out, poses its movers, frames its bounds. */
export class PlaceHost {
  private readonly hub: EnvHub;
  private readonly looks = new Map<string, PlaceLook>();
  private cur: { id: string; layout: 0 | 1; look: PlaceLook; built: PlaceBuilt; kit: PropKit } | null = null;
  private homeL: { key: THREE.Color; keyI: number; keyPos: THREE.Vector3; keyAim: THREE.Vector3; keyAngle: number; rim: THREE.Color; rimI: number; rimPos: THREE.Vector3; sky: THREE.Color; ground: THREE.Color; fillI: number } | null = null;
  /** The jellies' light in the place (null = Home's): the stage gives it to every new body. */
  light: JellyLight | null = null;
  private readonly done = new Uint8Array(64);
  constructor(hub: EnvHub) { this.hub = hub; }
  get active(): string | null { return this.cur ? this.cur.id : null; }
  /** setPlayBounds' framing (placeview.ts): the camera lives in the stage, the search here (it only runs in a place). */
  fit(cx: number, cz: number, hx: number, hz: number, fov: number, w: number, h: number, top: number, right: number, bottom: number, left: number): PlayFrame | null {
    return fitPlayBounds(cx, cz, hx, hz, fov, w, h, top, right, bottom, left);
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
    for (const v of c.views()) v.mats.setLight(this.light);
  }
  /** Swap a loaded place in for the layout (0 wide, 1 tall); id null = back to Home. False when that place is not loaded. */
  enter(c: StageCtx, id: string | null, layout: 0 | 1): boolean {
    if (id && !this.looks.has(id)) return false;
    const was = !!this.cur;
    if (this.cur) { this.cur.built.dispose(); this.cur.kit.dispose(); this.cur = null; }
    if (!id) {
      if (was) { c.table.setSky(null); c.table.setFelt(true); this.applyLight(c, null); this.hub.setPanels(c.renderer, null); c.heat.set(0, 0, 0, 0); }
      return true;
    }
    const look = this.looks.get(id)!, kit = new PropKit(this.hub), built = look.build(kit, layout);
    this.cur = { id, layout, look, built, kit };
    c.scene.add(built.group);
    c.table.setSky(look.sky); c.table.setFelt(false);
    this.applyLight(c, look.light(layout));
    this.hub.setPanels(c.renderer, look.panels);
    const hp = built.heat; if (hp) c.heat.set(hp[0], hp[1], hp[2], 1); else c.heat.set(0, 0, 0, 0);
    c.setSkyBand(look.skyBand[0], look.skyBand[1], look.skyBand[2]);
    return true;
  }
  /** One frame: movers posed from the bound poses (the first prop of each thing: PropWorldLike's order), then weather and the fire. */
  update(dt: number, time: number, quiet: boolean, reduced: boolean, tier: number, P: Float32Array | null, count: number, T: Int16Array | null): void {
    const c = this.cur;
    if (!c) return;
    const mv = c.built.movers;
    if (P && T) {
      this.done.fill(0);
      for (let p = 0; p < count && p < T.length; p++) {
        const k = T[p], o = mv[k];
        if (k < 0 || k >= mv.length || !o || this.done[k]) continue;
        this.done[k] = 1;
        const i = p * 8;
        if (!Number.isFinite(P[i])) continue;
        o.position.set(P[i], P[i + 1], P[i + 2]);
        if (c.built.moverKind[k]) o.quaternion.set(P[i + 3], P[i + 4], P[i + 5], P[i + 6]);
      }
    }
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

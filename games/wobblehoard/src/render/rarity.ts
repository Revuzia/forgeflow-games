// Rarity you can see (DESIGN.md 5.3): a per-body TIER FX pass layered on top of the genome look. Tier is a property of the
// species, not of the Genome, so the stage takes it as an option (addBody opts.tier / setBodyTier). Everything here is cheap
// and additive: shader uniforms in the jelly material (aurora, thin-film, two-tone), a few billboard / instanced draws, no strobing.
//
//   Common     plain jelly, dim core, plain contact shadow, no sparkle
//   Uncommon   a little more translucency, warm core, faint tinted light pool, a few glitter flecks
//   Rare       deeper transmission, rim glow + swirl layer, visible "seed" core pulsing under 0.5 Hz, soft rim halo, moderate glitter
//   Epic       two-tone gradient body, stronger pressure blush, core bloom, 3-5 orbiting motes (they trail), caustic ring on the table, glitter drifts upward
//   Legendary  slow aurora inside the body, bright core, faint light pillar, table ring pulsing at 0.25 Hz, dense glitter + a short spark trail
//   Mythic     thin-film iridescence (hue shifts with the view angle), prism core, soft light dome, orbiting satellite spheres, a fixed constellation inside
import * as THREE from 'three';
import type { SoftBodyLike, TierName } from '../contracts.ts';
import { mulberry32 } from '../core/rng.ts';
import type { JellyPalette, Rgb } from './oklch.ts';
import type { TintFamily } from './flash.ts';
import { HaloQuad } from './halo.ts';
import type { RestMapper, SurfaceHit } from './jelly.ts';
import { Particles } from './particles.ts';

export const TIER_ORDER: readonly TierName[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const tierIndex = (t: TierName): number => Math.max(0, TIER_ORDER.indexOf(t));

const srgbToLin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const hexLin = (hex: number): Rgb => [srgbToLin(((hex >> 16) & 255) / 255), srgbToLin(((hex >> 8) & 255) / 255), srgbToLin((hex & 255) / 255)];

export interface TierStyle {
  name: TierName;
  index: number;
  /** The tier "tell" colour (linear): leaks through the capsule cracks, drifts into the merge ball, tints the burst. */
  tell: Rgb;
  tellFamily: TintFamily;
  prism: boolean;
  // material
  translucencyAdd: number;
  attenuation: number;      // x attenuation distance (< 1 = deeper transmission)
  rim: number;              // x rim glow
  blush: number;            // x pressure blush
  twoTone: number;          // 0..1 gradient body
  aurora: number;           // 0..1 slow aurora inside
  iri: number;              // 0..1 thin-film iridescence
  swirlFloor: number;       // a plain-pattern body gets a swirl layer of this strength (Rare and up)
  // core
  coreMul: number; coreSize: number; coreWarm: number; corePrism: number; corePulseHz: number; corePulseAmp: number; haloMul: number; haloSize: number;
  // floor light
  poolMul: number; poolTint: number; ring: number; ringPulseHz: number;
  // aura / dome / pillar
  rimHalo: number; dome: number; pillar: number;
  // sparkle
  sparkleBase: number; drift: boolean; sparkTrail: boolean; constellation: number;
  // orbiters
  motes: number; satellites: number;
}

const base = (name: TierName, index: number, tell: Rgb, family: TintFamily): TierStyle => ({
  name, index, tell, tellFamily: family, prism: false,
  translucencyAdd: 0, attenuation: 1, rim: 1, blush: 1, twoTone: 0, aurora: 0, iri: 0, swirlFloor: 0,
  coreMul: 1, coreSize: 1, coreWarm: 0, corePrism: 0, corePulseHz: 0, corePulseAmp: 0, haloMul: 1, haloSize: 1,
  poolMul: 1, poolTint: 0, ring: 0, ringPulseHz: 0, rimHalo: 0, dome: 0, pillar: 0,
  sparkleBase: 0, drift: false, sparkTrail: false, constellation: 0, motes: 0, satellites: 0,
});

export const TIER_STYLES: Record<TierName, TierStyle> = {
  common: { ...base('common', 0, hexLin(0xfff1d6), 'other'), rim: 0.8, coreMul: 0.7, haloMul: 0.8, poolMul: 0.62 },
  uncommon: { ...base('uncommon', 1, hexLin(0x59d6e6), 'cyan'), translucencyAdd: 0.1, rim: 1.0, coreMul: 1.05, coreWarm: 0.5, poolMul: 1.05, poolTint: 0.2, sparkleBase: 0.2 },
  rare: {
    ...base('rare', 2, hexLin(0x8a5cf0), 'other'), translucencyAdd: 0.15, attenuation: 0.8, rim: 1.35, swirlFloor: 0.8,
    coreMul: 1.15, coreSize: 1.18, corePulseHz: 0.36, corePulseAmp: 0.16, haloMul: 1.1, poolMul: 0.95, poolTint: 0.3, rimHalo: 0.5, sparkleBase: 0.45,
  },
  epic: {
    ...base('epic', 3, hexLin(0xff5a4d), 'coral'), translucencyAdd: 0.15, attenuation: 0.8, rim: 1.2, blush: 1.5, twoTone: 0.85,
    coreMul: 1.3, coreSize: 1.2, haloMul: 1.9, haloSize: 1.3, poolMul: 0.9, poolTint: 0.25, ring: 0.7, rimHalo: 0.6, sparkleBase: 0.55, drift: true, motes: 4,
  },
  legendary: {
    ...base('legendary', 4, hexLin(0xffb347), 'other'), translucencyAdd: 0.18, attenuation: 0.75, rim: 1.3, blush: 1.3, aurora: 1,
    coreMul: 1.65, coreSize: 1.25, haloMul: 2.0, haloSize: 1.35, poolMul: 1.0, poolTint: 0.2, ring: 0.8, ringPulseHz: 0.25, rimHalo: 0.58, pillar: 0.5,
    sparkleBase: 0.85, drift: true, sparkTrail: true,
  },
  mythic: {
    ...base('mythic', 5, [1, 1, 1], 'other'), prism: true, translucencyAdd: 0.2, attenuation: 0.7, rim: 1.4, blush: 1.2, iri: 1,
    coreMul: 1.6, coreSize: 1.25, corePrism: 1, corePulseHz: 0.2, corePulseAmp: 0.12, haloMul: 2.0, haloSize: 1.4, poolMul: 1.15, ring: 0.6, rimHalo: 0.6, dome: 1,
    sparkleBase: 0.3, drift: true, constellation: 12, satellites: 2,
  },
};

/** Spectral colour (linear-ish, 0..1) for the prism effects. */
export function spectrum(h: number, out: Rgb): Rgb {
  const t = h - Math.floor(h);
  out[0] = 0.5 + 0.5 * Math.cos(6.2832 * (t + 0.0));
  out[1] = 0.5 + 0.5 * Math.cos(6.2832 * (t + 0.33));
  out[2] = 0.5 + 0.5 * Math.cos(6.2832 * (t + 0.67));
  // roughly equal luminance around the wheel: the hue cycle must not breathe (green is ~5x brighter than blue otherwise)
  const y = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  const k = Math.min(1.6, Math.max(0.75, 0.5 / Math.max(0.05, y)));
  out[0] = Math.min(1, out[0] * k); out[1] = Math.min(1, out[1] * k); out[2] = Math.min(1, out[2] * k);
  return out;
}

/* ───────────────────────────── per-body rarity FX ───────────────────────────── */

const DOME_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vH = position.y;
  gl_Position = projectionMatrix * mv;
}
`;
const DOME_FRAG = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying float vH;
uniform float uStrength;
uniform float uTime;
void main() {
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  vec3 film = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + ndv * 1.2 + vH * 0.8 + uTime * 0.04));
  float a = (fres * 0.85 + 0.035) * (1.0 - smoothstep(0.55, 1.0, vH)) * uStrength;
  gl_FragColor = vec4(film * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const PILLAR_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vH = position.y;
  gl_Position = projectionMatrix * mv;
}
`;
const PILLAR_FRAG = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying float vH;
uniform vec3 uColor;
uniform float uStrength;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float a = pow(ndv, 2.4) * pow(max(0.0, 1.0 - vH), 2.1) * smoothstep(0.0, 0.08, vH) * uStrength;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A soft prism light dome standing on the table (Mythic idle, capsule prism tell). */
export class PrismDome {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.SphereGeometry(1, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly mat = new THREE.ShaderMaterial({ vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms: { uStrength: { value: 0 }, uTime: { value: 0 } }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
  constructor() { this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.renderOrder = 26; this.mesh.frustumCulled = false; this.mesh.visible = false; }
  set(cx: number, cz: number, rx: number, ry: number, strength: number, time: number): void {
    this.mesh.position.set(cx, 0, cz); this.mesh.scale.set(rx, ry, rx);
    this.mat.uniforms.uStrength.value = strength; this.mat.uniforms.uTime.value = time; this.mesh.visible = strength > 0.003;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

/** A faint volumetric light pillar rising from the table (Legendary idle, capsule tell). */
export class LightPillar {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  private readonly mat = new THREE.ShaderMaterial({ vertexShader: PILLAR_VERT, fragmentShader: PILLAR_FRAG, uniforms: { uColor: { value: new THREE.Color(1, 0.7, 0.3) }, uStrength: { value: 0 } }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  constructor() { this.geo.translate(0, 0.5, 0); this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.renderOrder = 24; this.mesh.frustumCulled = false; this.mesh.visible = false; }
  set(cx: number, cz: number, radius: number, height: number, c: Rgb, strength: number): void {
    this.mesh.position.set(cx, 0, cz); this.mesh.scale.set(radius, height, radius);
    this.mat.uniforms.uColor.value.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace); this.mat.uniforms.uStrength.value = strength; this.mesh.visible = strength > 0.003;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

export interface RarityContext {
  scale: number;           // body radius / 0.5
  seed: number;
  mapper: RestMapper;
  palette: JellyPalette;
}

export class RarityFx {
  readonly group = new THREE.Group();
  /** Draw-call relevant counters for the probe. */
  readonly live = { aura: false, dome: false, pillar: false, orbiters: 0, stars: 0 };
  calm = false;
  /** 0..1 fade-in multiplier for all effects (used by the ceremonies to bring the aura in after the reveal). */
  strength = 1;
  private style: TierStyle;
  private readonly ctx: RarityContext;
  private aura: HaloQuad | null = null;
  private dome: PrismDome | null = null;
  private pillar: LightPillar | null = null;
  private orbit: Particles | null = null;
  private stars: Particles | null = null;
  private lines: THREE.LineSegments | null = null;
  private lineGeo: THREE.BufferGeometry | null = null;
  private lineMat: THREE.LineBasicMaterial | null = null;
  private lineArr: Float32Array | null = null;
  private starTri: Uint32Array | null = null;
  private starW: Float32Array | null = null;
  private starRf: Float32Array | null = null;
  private starPairs: number[] = [];
  private nMotes = 0;
  private nSats = 0;
  private fx = 0; private fz = 0; private fy = 0; private follow = false;
  private readonly col: Rgb = [1, 1, 1];

  constructor(style: TierStyle, ctx: RarityContext) {
    this.style = style;
    this.ctx = ctx;
    this.setStyle(style);
  }

  get tierStyle(): TierStyle { return this.style; }

  /** (Re)configure for a tier: builds what the tier needs, hides the rest. Cheap to call on a tier change. */
  setStyle(style: TierStyle): void {
    this.style = style;
    const sc = this.ctx.scale;
    // aura (soft rim halo)
    if (style.rimHalo > 0 && !this.aura) {
      this.aura = new HaloQuad({ ring: 1, fadeH: 0.12 * sc, renderOrder: -18 });
      this.group.add(this.aura.mesh);
    }
    if (style.dome > 0 && !this.dome) { this.dome = new PrismDome(); this.group.add(this.dome.mesh); }
    if (style.pillar > 0 && !this.pillar) { this.pillar = new LightPillar(); this.group.add(this.pillar.mesh); }
    // orbiting motes / satellites
    const wantOrb = style.motes + style.satellites;
    if (wantOrb > 0 && !this.orbit) {
      this.orbit = new Particles(16, 31);
      for (let i = 0; i < 12; i++) this.orbit.emit({ x: 0, y: -100, z: 0, life: 1e9, size: 0.02, kind: 0, a: 0, fade: 2 });
      this.group.add(this.orbit.mesh);
    }
    this.nMotes = style.motes; this.nSats = style.satellites;
    // constellation
    if (style.constellation > 0 && !this.stars) this.buildConstellation(style.constellation);
    if (this.aura) this.aura.mesh.visible = style.rimHalo > 0;
    if (this.dome && style.dome <= 0) this.dome.mesh.visible = false;
    if (this.pillar && style.pillar <= 0) this.pillar.mesh.visible = false;
    if (this.stars) { this.stars.mesh.visible = style.constellation > 0; if (this.lines) this.lines.visible = style.constellation > 0; }
    if (this.orbit) this.orbit.mesh.visible = wantOrb > 0;
    this.follow = false;
  }

  private buildConstellation(n: number): void {
    const rng = mulberry32(this.ctx.seed ^ 0x57a45);
    const hit: SurfaceHit = { tri: 0, u: 0, v: 0, w: 0 };
    this.starTri = new Uint32Array(n); this.starW = new Float32Array(n * 3); this.starRf = new Float32Array(n);
    const dirs: number[] = [];
    for (let i = 0; i < n; i++) {
      const z = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
      const dx = rr * Math.cos(a), dz = rr * Math.sin(a);
      dirs.push(dx, z, dz);
      this.ctx.mapper.locate(dx, z, dz, hit);
      this.starTri[i] = hit.tri; this.starW[i * 3] = hit.u; this.starW[i * 3 + 1] = hit.v; this.starW[i * 3 + 2] = hit.w;
      this.starRf[i] = 0.35 + 0.4 * rng();
    }
    // each star links to its two nearest neighbours (rest directions), duplicates removed
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const d: [number, number][] = [];
      for (let j = 0; j < n; j++) if (j !== i) d.push([Math.hypot(dirs[i * 3] - dirs[j * 3], dirs[i * 3 + 1] - dirs[j * 3 + 1], dirs[i * 3 + 2] - dirs[j * 3 + 2]), j]);
      d.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < 2; k++) {
        const j = d[k][1], key = Math.min(i, j) * 64 + Math.max(i, j);
        if (!seen.has(key)) { seen.add(key); this.starPairs.push(i, j); }
      }
    }
    this.stars = new Particles(n, 30);
    for (let i = 0; i < n; i++) this.stars.emit({ x: 0, y: -100, z: 0, life: 1e9, size: 0.03 * this.ctx.scale, kind: 1, a: 0, r: 0.9 + 0.1 * rng(), g: 0.95, b: 1, fade: 2 });
    this.lineArr = new Float32Array(this.starPairs.length * 3);
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.lineArr, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(this.lineGeo, this.lineMat);
    this.lines.frustumCulled = false; this.lines.renderOrder = 29;
    this.group.add(this.stars.mesh, this.lines);
  }

  /**
   * @param ext   horizontal extents of the body (rx, rz) and its top, for placing aura, dome and pillar
   * @param floatT 0 on the table .. 1 floating
   */
  update(dt: number, time: number, body: SoftBodyLike, rx: number, rz: number, floatT: number): void {
    const st = this.style, sc = this.ctx.scale, c = body.center;
    const k = this.strength;
    const calm = this.calm;
    const R = Math.max(rx, rz, 0.3);
    // aura: soft rim halo hugging the silhouette
    if (this.aura && st.rimHalo > 0) {
      const tint = st.prism ? spectrum(time * 0.05, this.col) : st.tell;
      const g = this.ctx.palette.glow;
      this.aura.setColor(tint[0] * 0.6 + g[0] * 0.4, tint[1] * 0.6 + g[1] * 0.4, tint[2] * 0.6 + g[2] * 0.4);
      this.aura.set(c.x, c.y, c.z, R * 1.85, 0.38 * st.rimHalo * k);
    }
    // dome (Mythic): a soft light dome standing on the table
    if (this.dome && st.dome > 0) {
      const breathe = calm ? 1 : 0.82 + 0.18 * Math.sin(time * Math.PI * 2 * 0.2);
      this.dome.set(c.x, c.z, R * 1.5, R * 1.7 + (c.y - 0.4 * sc) * 0.2, 0.9 * st.dome * breathe * k, time);
    }
    // pillar (Legendary): a faint light pillar on idle
    if (this.pillar && st.pillar > 0) {
      this.pillar.set(c.x, c.z, R * 0.55, 2.6 * sc, st.tell, 0.4 * st.pillar * k * (calm ? 0.7 : 0.85 + 0.15 * Math.sin(time * Math.PI * 2 * 0.25)));
    }
    // orbiting motes (Epic, they trail when the body moves) and satellites (Mythic)
    if (this.orbit) {
      if (!this.follow) { this.fx = c.x; this.fy = c.y; this.fz = c.z; this.follow = true; }
      const kf = 1 - Math.exp(-dt * 6);
      this.fx += (c.x - this.fx) * kf; this.fy += (c.y - this.fy) * kf; this.fz += (c.z - this.fz) * kf;
      const lagVx = (c.x - this.fx) / 0.17, lagVz = (c.z - this.fz) / 0.17;   // the follower lags: motes trail when the body moves
      const tint = st.tell;
      for (let i = 0; i < this.nMotes; i++) {
        const ph = i * (Math.PI * 2 / Math.max(1, this.nMotes)) + 0.7;
        const w = 0.55 + 0.1 * i, th = time * w + ph;
        const r = (0.82 + 0.07 * Math.sin(th * 1.3 + i)) * R * 1.1;
        const y = this.fy + (0.08 + 0.2 * Math.sin(th * 0.8 + i * 2.0)) * sc;
        const x = this.fx + Math.cos(th) * r, z = this.fz + Math.sin(th) * r;
        const sp = w * r;
        this.orbit.set(i, x, y, z, -Math.sin(th) * sp * 1.6 + lagVx * 3, 0, Math.cos(th) * sp * 1.6 + lagVz * 3, 0.0);
        this.orbit.configure(i, 2, 0.026 * sc, tint[0], tint[1] * 0.9 + 0.1, tint[2] * 0.8 + 0.1, 0.75 * k);
      }
      for (let j = 0; j < this.nSats; j++) {
        const i = 6 + j;
        const th = time * (0.32 + 0.1 * j) + j * Math.PI;
        const r = (1.05 + 0.08 * j) * R * 1.1;
        const tilt = 0.5 + 0.35 * j;
        const x = this.fx + Math.cos(th) * r, z = this.fz + Math.sin(th) * r * Math.cos(tilt);
        const y = this.fy + Math.sin(th) * r * Math.sin(tilt) + 0.15 * sc;
        const s = spectrum(time * 0.07 + j * 0.4, this.col);
        this.orbit.set(i, x, y, z, 0, 0, 0, 0);
        this.orbit.configure(i, 3, 0.05 * sc, s[0], s[1], s[2], 0.95 * k);
      }
      for (let i = this.nMotes; i < 6; i++) this.orbit.set(i, 0, -100, 0, 0, 0, 0, 0);
      for (let i = 6 + this.nSats; i < 12; i++) this.orbit.set(i, 0, -100, 0, 0, 0, 0, 0);
      this.orbit.update(0, time);
      this.live.orbiters = this.nMotes + this.nSats;
    }
    // constellation (Mythic): fixed star points inside the body + faint links, riding the deformation
    if (this.stars && this.starTri && this.starW && this.starRf && this.lineArr && this.lineMat && st.constellation > 0) {
      const P = body.positions, idx = body.indices, cx = c.x, cy = c.y, cz = c.z;
      const n = this.starTri.length;
      const br = calm ? 1 : 0.85 + 0.15 * Math.sin(time * 0.9);
      for (let i = 0; i < n; i++) {
        const t = this.starTri[i] * 3, a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
        const u = this.starW[i * 3], v = this.starW[i * 3 + 1], w = this.starW[i * 3 + 2], f = this.starRf[i];
        const x = cx + (u * P[a] + v * P[b] + w * P[d] - cx) * f, y = cy + (u * P[a + 1] + v * P[b + 1] + w * P[d + 1] - cy) * f, z = cz + (u * P[a + 2] + v * P[b + 2] + w * P[d + 2] - cz) * f;
        this.stars.set(i, x, y, z, 0, 0, 0, 0.9 * br * k);
        this.sx[i] = x; this.sy[i] = y; this.sz[i] = z;
      }
      const pairs = this.starPairs;
      for (let p = 0; p < pairs.length; p += 2) {
        const i = pairs[p], j = pairs[p + 1];
        this.lineArr[p * 3] = this.sx[i]; this.lineArr[p * 3 + 1] = this.sy[i]; this.lineArr[p * 3 + 2] = this.sz[i];
        this.lineArr[p * 3 + 3] = this.sx[j]; this.lineArr[p * 3 + 4] = this.sy[j]; this.lineArr[p * 3 + 5] = this.sz[j];
      }
      (this.lineGeo?.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      this.lineMat.opacity = 0.32 * k * br;
      this.stars.update(0, time);
      this.live.stars = n;
    }
    this.live.aura = !!this.aura && st.rimHalo > 0; this.live.dome = !!this.dome && st.dome > 0; this.live.pillar = !!this.pillar && st.pillar > 0;
  }

  private readonly sx = new Float32Array(32); private readonly sy = new Float32Array(32); private readonly sz = new Float32Array(32);

  dispose(): void {
    this.aura?.dispose();
    this.dome?.dispose(); this.pillar?.dispose();
    this.orbit?.dispose(); this.stars?.dispose();
    this.lineGeo?.dispose(); this.lineMat?.dispose();
  }
}

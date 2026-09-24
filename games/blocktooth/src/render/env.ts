// BLOCKTOOTH — environment view (CONTRACT.md §6, §6.1, §6.2). render-core lane.
//
// Everything that is NOT the city grid itself:
//   * sky dome   — unlit gradient (sky → horizon → fog), follows the camera, drawn after the
//                  opaques behind everything (depth-tested, so it costs no fill where the city
//                  covers it), never fogged; faint stars + a soft moon/sun disc (glare-bar safe).
//   * ground     — out-of-city patchwork plane (biome ground colour; WHITE STACKS = snow),
//                  toon-lit, receives shadows, sits 3 cm under y = 0 with polygonOffset so the
//                  city's own road/lot planes always win.
//   * harbour    — LOCKWATER: opaque sea beyond the −Z waterline (citygen: z < originZ − roadW/2)
//   * flood      — LOCKWATER: translucent water skin over every road strip at FLOOD_Y. Both
//                  water surfaces carry cheap animated neon-streak reflections, normalised in JS
//                  to ≈5–6× the water's luminance (glare bar: never 50×, no bloom).
//   * weather    — snow flakes (WHITE STACKS) / rain streaks (LOCKWATER): ONE instanced draw,
//                  world-anchored wrap inside a box around the look target, box + particle size
//                  + fall speed all ∝ the view extent so it reads identically at Size I and V;
//                  count by quality.level.
//   * outskirts  — the street grid continues past the bounds (fading lit roads, one draw) with
//                  fogged low-poly towers on its parcels (merged, one unlit draw: facade hues,
//                  window bands, parapet caps, ink cornice + edges) — they surface only at the
//                  big ranks. Camera-side heights are capped so no silhouette can ever sit
//                  between camera and titan.
//   * clouds     — GRID-EAST: soft faceted toon clouds with ink outlines that appear BELOW the
//                  camera once the titan outgrows the cloud deck (Size IV–V); they never cover the
//                  play space: they live in the outer ~12 % frame band and part around the titan,
//                  the boss and every live hostile telegraph (screen-space keep-clear circles).
//
// Heights are exported so city-view can agree on them: GROUND_Y (−0.03) and FLOOD_Y (0.06).

import * as THREE from 'three';
import type { BiomeDef, CityLayout, World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';
import { BIOMES } from '../data/biomes.ts';
import { CAMERA, PARCEL_HALF } from '../core/config.ts';
import { mulberry32 } from '../core/rng.ts';
import { harbourWaterZ } from '../city/citygen.ts';
import { addOutline, bakeOutlineNormals, facet, INK, makeToon, OUTLINE_PX } from './materials.ts';

/** out-of-city ground height (m) — a hair under the city's y = 0 planes */
export const GROUND_Y = -0.03;
/** flooded-street / harbour water surface height (m) */
export const FLOOD_Y = 0.06;

const K = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
/** buildable half-size of a city block (m) — the outskirts reuse it for their parcels */
const PARCEL_HALF_M = PARCEL_HALF;
const YAW = (CAMERA.yawDeg * Math.PI) / 180;
/** camera forward on the ground plane (constant yaw) */
const FWD_X = -Math.sin(YAW), FWD_Z = -Math.cos(YAW);

// ─────────────────────────────── small helpers ───────────────────────────────
const _col = new THREE.Color();
function lum(c: THREE.Color): number { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
/** colour scaled so its linear luminance equals `y` (glare-bar normalisation) */
function atLuminance(hex: string, y: number): THREE.Color {
  const c = new THREE.Color(hex);
  const l = Math.max(1e-4, lum(c));
  return c.multiplyScalar(y / l);
}

/** Growable flat arrays for merged, non-indexed, vertex-coloured geometry. */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: THREE.Color): void {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) this.col.push(c.r, c.g, c.b);
  }
  /** quad a-b-c-d (counter-clockwise seen from the side it faces) */
  quad(a: number[], b: number[], c: number[], d: number[], col: THREE.Color): void {
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col);
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], col);
  }
  /** axis-aligned box without a bottom; per-face colours: top, +x, −x, +z, −z */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    top: THREE.Color, px: THREE.Color, nx: THREE.Color, pz: THREE.Color, nz: THREE.Color): void {
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], px);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], nx);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], pz);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], nz);
  }
  /** Box without a bottom whose vertex colours follow a vertical gradient (bottom → top colour
   *  over [0, yRef]) times a per-face shade: [top, +x, −x, +z, −z]. Top face uses `roof`. */
  boxGrad(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    bottom: THREE.Color, topCol: THREE.Color, roof: THREE.Color, yRef: number, shade: readonly number[]): void {
    const cAt = (y: number, s: number, out: THREE.Color) => out.copy(bottom).lerp(topCol, Math.min(1, Math.max(0, y / yRef))).multiplyScalar(s);
    const lo = new THREE.Color(), hi = new THREE.Color(), rf = new THREE.Color().copy(roof).multiplyScalar(shade[0]);
    const face = (a: number[], b: number[], c: number[], d: number[], s: number) => {
      // a,b at y0; c,d at y1 (the wall quads below are authored that way)
      cAt(a[1], s, lo); cAt(c[1], s, hi);
      this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      this.col.push(lo.r, lo.g, lo.b, lo.r, lo.g, lo.b, hi.r, hi.g, hi.b, lo.r, lo.g, lo.b, hi.r, hi.g, hi.b, hi.r, hi.g, hi.b);
    };
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], rf);
    face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade[1]);
    face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade[2]);
    face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], shade[3]);
    face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade[4]);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ─────────────────────────────── shaders ───────────────────────────────
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBelow; uniform vec3 uSunDir; uniform vec3 uSunCol;
uniform float uStars; uniform float uDisc;
varying vec3 vDir;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h >= 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.62, h), 0.85)) : mix(uHorizon, uBelow, smoothstep(0.0, -0.12, h));
  // soft disc toward the sun/moon — at most ~1.35× the sky it sits on (glare bar)
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col = mix(col, col * 0.55 + uSunCol * 0.55, uDisc * smoothstep(0.9975, 0.9990, sd));
  col += uSunCol * uDisc * 0.06 * pow(sd, 24.0);
  if (uStars > 0.0 && h > 0.05) {
    vec2 g = floor(d.xz / (h + 0.35) * 90.0);
    float s = step(0.992, h21(g)) * smoothstep(0.05, 0.4, h);
    col += vec3(0.55, 0.6, 0.75) * s * uStars;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const WATER_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uWater; uniform vec3 uGlow; uniform vec3 uNeonA; uniform vec3 uNeonB; uniform vec3 uLit;
uniform float uTime; uniform vec2 uFwd; uniform float uCell; uniform float uStreak; uniform float uOpacity;
uniform float uSheen;
varying vec3 vWorld;
float h11(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
void main() {
  vec2 p = vWorld.xz;
  vec2 side = vec2(-uFwd.y, uFwd.x);
  float a = dot(p, side);           // across the screen
  float b = dot(p, uFwd);           // into the screen
  float cA = uCell;                 // column pitch (m) ∝ view extent
  // broad slow ripple sheen
  float r1 = sin(b / cA * 1.9 + uTime * 1.1 + sin(a / cA * 0.7 + uTime * 0.37) * 1.6);
  float r2 = sin(a / cA * 1.3 - uTime * 0.6 + b / cA * 0.4);
  float rip = 0.5 + 0.25 * r1 + 0.25 * r2;
  vec3 col = mix(uWater, uGlow, uSheen * (0.35 + 0.65 * rip * rip));
  // neon reflections: a few long, soft, vertical-on-screen smears (the way a sign reflects in a
  // wet street), each living in its own window along the view. The smear is CONTINUOUS; the
  // water's ripples show as its jagged edge — many thin ripple rows, each its own width and a
  // small sideways jitter, split by hairline gaps — a wet-street reflection, not a worm and not
  // a dashed road line.
  float ca = floor(a / cA);
  float hc = h11(ca);
  float on = step(0.62, hc);                        // ~1 column in 3 carries a reflection
  float fa = fract(a / cA);
  float cen = 0.3 + 0.4 * h11(ca + 3.1);
  float wdt = mix(0.14, 0.26, h11(ca + 7.13));
  float rb = b / (cA * 0.16) + uTime * 0.9 + hc * 3.0;    // ripple row coordinate
  float band = floor(rb), bf = fract(rb);
  float n1 = h11(band * 1.7 + ca), n2 = h11(band * 2.3 + ca * 0.7);
  float wob = 0.07 * (n1 - 0.5) + 0.025 * sin(b / cA * 2.3 + uTime * 1.9 + hc * 6.28);
  float bw = wdt * (0.3 + 1.1 * n2 * n2);           // most rows narrow, a few wide
  float core = 1.0 - smoothstep(bw * 0.45, bw, abs(fa - cen + wob));
  float slab = (1.0 - 0.55 * smoothstep(0.72, 0.95, bf)) * (0.7 + 0.3 * n1);
  float win = b / (cA * 7.0) + hc * 5.0;           // streak windows along the view
  float wi = floor(win), wf = fract(win);
  float present = step(0.35, h11(wi * 3.7 + ca * 0.61));
  float lenF = 0.45 + 0.4 * h11(wi * 1.9 + ca);
  float body = smoothstep(0.0, 0.1, wf) * (1.0 - smoothstep(lenF * 0.6, lenF, wf));
  body *= 1.0 - 0.45 * smoothstep(0.0, lenF, wf);  // fades as it runs away from its source
  float shimmer = 0.78 + 0.22 * sin(uTime * 2.3 + hc * 17.0 + wi);
  // neon (magenta / cyan) carries most reflections; warm window light is the rarer accent
  vec3 neon = hc > 0.9 ? uLit : (hc > 0.76 ? uNeonB : uNeonA);
  col += neon * (core * slab * body * shimmer * present * on * uStreak);
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const WEATHER_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform vec3 uCenter; uniform vec3 uBox; uniform float uTime; uniform vec3 uVel;
uniform float uSize; uniform float uLen; uniform float uRain; uniform float uNear;
varying vec2 vUv; varying float vFade;
void main() {
  float spd = 0.7 + 0.6 * aSeed.w;
  vec3 wp = aSeed.xyz * uBox + uVel * (uTime * spd);
  if (uRain < 0.5) {
    wp.x += sin(uTime * 0.9 + aSeed.w * 6.2831) * uSize * 5.0;
    wp.z += cos(uTime * 0.7 + aSeed.w * 4.1) * uSize * 5.0;
  }
  vec3 lo = uCenter - uBox * 0.5;
  vec3 f = mod(wp - lo, uBox) / uBox;         // 0..1 inside the box, world-anchored
  wp = lo + f * uBox;
  float edge = min(min(f.x, 1.0 - f.x), min(f.z, 1.0 - f.z));
  float boxFade = smoothstep(0.0, 0.12, edge) * smoothstep(0.0, 0.06, f.y) * smoothstep(0.0, 0.12, 1.0 - f.y);
  // particles that drift close to the lens would balloon into grey blobs: they SHRINK away
  // (never a translucent smear) — and so do the ones leaving the box
  float nearK = smoothstep(uNear * 0.35, uNear, distance(wp, cameraPosition));
  float grow = nearK * mix(0.25, 1.0, boxFade);
  vFade = mix(0.55, 1.0, boxFade);
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p;
  if (uRain > 0.5) {
    vec3 axis = normalize(uVel);
    p = wp + camR * (position.x * uSize * grow) + axis * (position.y * uLen * grow);
  } else {
    float s = uSize * grow * (0.6 + 0.8 * fract(aSeed.w * 7.31));
    float ang = uTime * (0.8 + aSeed.w) + aSeed.w * 6.2831;
    float c = cos(ang), si = sin(ang);
    vec2 q = vec2(c * position.x - si * position.y, si * position.x + c * position.y);
    p = wp + (camR * q.x + camU * q.y) * s;
  }
  vUv = position.xy;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WEATHER_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor; uniform float uAlpha; uniform float uRain;
varying vec2 vUv; varying float vFade;
void main() {
  float a;
  if (uRain > 0.5) {
    a = (1.0 - abs(vUv.x) * 2.0) * smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  } else {
    // faceted six-point flake: a hexagon silhouette with a soft core
    float r = length(vUv) * 2.0;
    a = 1.0 - smoothstep(0.72, 0.95, r);
  }
  a *= uAlpha * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ─────────────────────────────── EnvView ───────────────────────────────
/** clouds keep out of the inner frame: |ndc| < BAND_INNER on both axes (outer ~12 % band) */
const BAND_INNER = 0.76;
/** keep-clear screen circles tracked per frame (titan + boss + hostile telegraphs) */
const KEEP_CLEAR_MAX = 40;

interface CloudSeed { u: number; v: number; s: number; rot: number; sx: number; sz: number; }

export class EnvView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private biome: BiomeDef | null = null;
  private city: CityLayout | null = null;
  private readonly owned: { geo: THREE.BufferGeometry[]; mat: THREE.Material[] } = { geo: [], mat: [] };

  private sky: THREE.Mesh | null = null;
  private skyMat: THREE.ShaderMaterial | null = null;
  private ground: THREE.Mesh | null = null;
  private waterMats: THREE.ShaderMaterial[] = [];
  private weather: THREE.Mesh | null = null;
  private weatherMat: THREE.ShaderMaterial | null = null;
  private weatherKind: 'none' | 'snow' | 'rain' = 'none';
  /** particles drawn per quality level (the buffer holds the level-2 count; instanceCount follows
   *  the LIVE quality.level every frame, so a settings change applies without a remount) */
  private weatherCounts: readonly number[] = [0, 0, 0];
  private skyline: THREE.Mesh | null = null;
  private clouds: THREE.InstancedMesh | null = null;
  private cloudSeeds: CloudSeed[] = [];
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _p = new THREE.Vector3();
  private readonly _s = new THREE.Vector3();
  private readonly _e = new THREE.Euler();
  private readonly _fwd = new THREE.Vector3();
  /** keep-clear circles for the cloud deck: [ndcX·aspect, ndcY, radius, margin] × KEEP_CLEAR_MAX */
  private readonly keepClear = new Float32Array(KEEP_CLEAR_MAX * 4);
  private keepN = 0;

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.root.name = 'env';
  }

  mount(world: World): void {
    this.unmount();
    const b = BIOMES[world.biomeId];
    this.biome = b;
    this.city = world.city;
    this.buildSky(b);
    this.buildGround(b, world.city);
    if (world.city.flooded || b.flooded) this.buildWater(b, world.city);
    this.buildSkyline(b, world.city);
    if (b.weather !== 'none') this.buildWeather(b);
    if (b.time === 'day') this.buildClouds(b, world.city);
    this.ctx.scene.add(this.root);
  }

  update(_world: World, f: FrameInfo): void {
    if (!this.biome) return;
    const cam = this.ctx.camera;
    const D = Math.max(0.5, f.camDist);
    const ext = D * K;
    // look target reconstructed from the camera (no rig dependency)
    cam.getWorldDirection(this._fwd);
    const tx = cam.position.x + this._fwd.x * D;
    const ty = cam.position.y + this._fwd.y * D;
    const tz = cam.position.z + this._fwd.z * D;
    const t = f.time;

    // sky dome follows the camera, radius inside the far plane
    if (this.sky) {
      this.sky.position.copy(cam.position);
      this.sky.scale.setScalar(cam.far * 0.9);   // inside the far plane (32×16 chords sag < 1 %)
    }
    // water: animate + scale the streak cells with the view
    const streak = 1 - 0.8 * smooth(30, 150, ext);     // reflections matter most down at street level
    for (const m of this.waterMats) {
      m.uniforms.uTime.value = t;
      m.uniforms.uCell.value = Math.max(0.35, ext * 0.085);
      m.uniforms.uStreak.value = streak;
    }
    // weather box around the look target
    if (this.weather && this.weatherMat) {
      const lv = this.ctx.quality.level;
      (this.weather.geometry as THREE.InstancedBufferGeometry).instanceCount = this.weatherCounts[lv >= 0 && lv <= 2 ? lv : 2];
      const u = this.weatherMat.uniforms;
      const snow = this.weatherKind === 'snow';
      const bx = ext * 2.0, by = ext * 1.15;
      (u.uBox.value as THREE.Vector3).set(bx, by, bx);
      (u.uCenter.value as THREE.Vector3).set(tx, by * 0.5, tz);
      u.uTime.value = t;
      u.uSize.value = snow ? ext * 0.0065 : ext * 0.0016;
      u.uLen.value = ext * 0.05;
      const fall = snow ? ext * 0.075 : ext * 1.05;
      const wind = snow ? ext * 0.025 : ext * 0.16;
      (u.uVel.value as THREE.Vector3).set(-wind * 0.8, -fall, wind * 0.35);
      u.uNear.value = D * 0.5;
      void ty;
    }
    if (this.clouds) this.updateClouds(_world, tx, tz, D, ext, t);
  }

  unmount(): void {
    if (this.root.parent) this.root.parent.remove(this.root);
    for (let i = this.root.children.length - 1; i >= 0; i--) this.root.remove(this.root.children[i]);
    for (const g of this.owned.geo) g.dispose();
    for (const m of this.owned.mat) m.dispose();
    this.owned.geo.length = 0; this.owned.mat.length = 0;
    this.sky = null; this.skyMat = null; this.ground = null; this.waterMats = [];
    this.weather = null; this.weatherMat = null; this.weatherKind = 'none'; this.weatherCounts = [0, 0, 0];
    this.skyline = null; this.clouds = null; this.cloudSeeds = [];
    this.biome = null; this.city = null;
  }

  // ─────────────────────────────── builders ───────────────────────────────
  private keep<G extends THREE.BufferGeometry, M extends THREE.Material>(g: G, m: M): void {
    this.owned.geo.push(g); this.owned.mat.push(m);
  }

  private buildSky(b: BiomeDef): void {
    const p = b.palette;
    const night = b.time === 'night';
    const geo = new THREE.SphereGeometry(1, 32, 16);
    const mat = new THREE.ShaderMaterial({
      name: 'skyDome',
      uniforms: {
        uTop: { value: new THREE.Color(p.sky) },
        uHorizon: { value: new THREE.Color(p.skyHorizon).lerp(new THREE.Color(p.fog), 0.35) },
        uBelow: { value: new THREE.Color(p.fog) },
        uSunDir: { value: new THREE.Vector3(b.sunDir[0], b.sunDir[1], b.sunDir[2]).normalize() },
        uSunCol: { value: new THREE.Color(p.sun) },
        uStars: { value: night ? 1 : 0 },
        uDisc: { value: night ? 0.9 : b.time === 'day' ? 0.35 : 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      // drawn LAST among the opaques with the depth test on: it only shades pixels nothing else
      // covered (in the 36–44° gameplay view that is none — the old first-drawn, depth-test-off dome
      // was a full-screen pass that the ground and city then painted over every frame)
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'env:sky';
    m.renderOrder = 1000;
    m.frustumCulled = false;
    m.castShadow = false; m.receiveShadow = false;
    m.raycast = () => { /* never picked */ };
    this.keep(geo, mat);
    this.sky = m; this.skyMat = mat;
    this.root.add(m);
  }

  private buildGround(b: BiomeDef, city: CityLayout): void {
    const p = b.palette;
    const bd = city.bounds;
    const cx = (bd.minX + bd.maxX) / 2, cz = (bd.minZ + bd.maxZ) / 2;
    const cityHalf = Math.max(bd.maxX - bd.minX, bd.maxZ - bd.minZ) / 2;
    const TILE = 64;
    const inner = Math.ceil((cityHalf + 1500) / TILE) * TILE;   // patchwork half-size
    const outer = inner + 6000;                                  // plain skirt to the horizon
    const rng = mulberry32((city.seed ^ 0x5eed9) >>> 0);
    const base = new THREE.Color(p.ground);
    const alt = b.id === 'whitestacks' ? new THREE.Color('#dfe7ef') : b.id === 'lockwater' ? new THREE.Color(p.sidewalk) : new THREE.Color(p.foliageB).lerp(base, 0.82);
    const bld = new Builder();
    const y = GROUND_Y;
    const n = Math.round((inner * 2) / TILE);
    const c = new THREE.Color();
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x0 = cx - inner + ix * TILE, z0 = cz - inner + iz * TILE;
        const r = rng();
        c.copy(base).lerp(alt, r < 0.22 ? 0.55 : r * 0.18);
        c.multiplyScalar(0.965 + rng() * 0.07);
        // two triangles per tile, split direction alternating for a faceted patchwork
        if ((ix + iz) & 1) {
          bld.tri(x0, y, z0 + TILE, x0 + TILE, y, z0 + TILE, x0 + TILE, y, z0, c);
          bld.tri(x0, y, z0 + TILE, x0 + TILE, y, z0, x0, y, z0, c);
        } else {
          bld.tri(x0, y, z0, x0, y, z0 + TILE, x0 + TILE, y, z0 + TILE, c);
          bld.tri(x0, y, z0, x0 + TILE, y, z0 + TILE, x0 + TILE, y, z0, c);
        }
      }
    }
    // skirt: four big quads around the patchwork
    const s = base;
    const X0 = cx - outer, X1 = cx + outer, Z0 = cz - outer, Z1 = cz + outer;
    const x0 = cx - inner, x1 = cx + inner, z0 = cz - inner, z1 = cz + inner;
    bld.quad([X0, y, z1], [X0, y, Z1], [X1, y, Z1], [X1, y, z1], s);                               // +Z band
    bld.quad([X0, y, Z0], [X0, y, z0], [X1, y, z0], [X1, y, Z0], s);                               // −Z band
    bld.quad([X0, y, z0], [X0, y, z1], [x0, y, z1], [x0, y, z0], s);                               // −X band
    bld.quad([x1, y, z0], [x1, y, z1], [X1, y, z1], [X1, y, z0], s);                               // +X band
    const geo = bld.geometry();
    // normals must face +y regardless of winding above
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const mat = makeToon({ vertexColors: true });
    mat.name = 'env:ground';
    mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 4;
    const m = new THREE.Mesh(geo, mat);
    m.name = 'env:ground';
    // drawn after the city's opaques (only transparents come later — no opaque ground decal relies
    // on it being underneath): early-z then rejects every pixel the city's own road/lot planes
    // already covered, instead of running the toon + PCF-shadow shader under the whole city first
    m.renderOrder = 900;
    m.receiveShadow = true; m.castShadow = false;
    m.frustumCulled = false;
    this.keep(geo, mat);
    this.ground = m;
    this.root.add(m);
  }

  private makeWaterMat(b: BiomeDef, opacity: number, transparent: boolean): THREE.ShaderMaterial {
    const p = b.palette;
    const water = new THREE.Color(p.water);
    const glow = new THREE.Color(p.waterGlow);
    const sheen = b.time === 'night' ? 0.34 : 0.22;
    // glare bar: streaks at ≈6× the luminance of the sheen-lifted water they sit on (3–8× rule)
    const baseY = lum(water) * (1 - sheen * 0.6) + lum(glow) * sheen * 0.6;
    const target = Math.max(0.02, baseY * 6);
    // warm window light desaturated toward white first, or at this luminance it reads as brown
    const litHex = '#' + new THREE.Color(p.glassLit).lerp(new THREE.Color('#ffffff'), 0.4).getHexString();
    const mat = new THREE.ShaderMaterial({
      name: transparent ? 'env:flood' : 'env:harbour',
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uWater: { value: water },
          uGlow: { value: glow },
          uNeonA: { value: atLuminance(p.sign, target) },
          uNeonB: { value: atLuminance(p.signB, target) },
          uLit: { value: atLuminance(litHex, target * 1.2) },
          uTime: { value: 0 },
          uFwd: { value: new THREE.Vector2(FWD_X, FWD_Z) },
          uCell: { value: 1 },
          uStreak: { value: 1 },
          uOpacity: { value: opacity },
          uSheen: { value: sheen },
        },
      ]),
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent,
      depthWrite: !transparent,
      fog: true,
    });
    this.waterMats.push(mat);
    return mat;
  }

  private buildWater(b: BiomeDef, city: CityLayout): void {
    const P = city.pitch, RH = city.roadW / 2;
    const W = city.blocksX * P, D = city.blocksZ * P;
    // citygen's own waterline (z below it is sea); a flooded-but-harbourless layout falls back to
    // the outer road edge so the sea can never cut into the streets
    const waterZ = harbourWaterZ(city) ?? city.originZ - RH;
    const y = FLOOD_Y;

    // ── harbour: opaque sea along the whole −Z side ──
    {
      const x0 = city.originX - 8000, x1 = city.originX + W + 8000;
      const z0 = waterZ - 8000, z1 = waterZ;
      const pos = new Float32Array([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z1, x1, y, z0, x0, y, z0]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.computeBoundingSphere();
      const mat = this.makeWaterMat(b, 1, false);
      mat.side = THREE.DoubleSide;
      const m = new THREE.Mesh(geo, mat);
      m.name = 'env:harbour';
      m.frustumCulled = false;
      this.keep(geo, mat);
      this.root.add(m);
    }

    // ── flooded streets: non-overlapping strips (Z-roads full length, X-roads between them) ──
    if (city.flooded) {
      const pos: number[] = [];
      const quad = (xa: number, za: number, xb: number, zb: number) => {
        pos.push(xa, y, zb, xb, y, zb, xb, y, za, xa, y, zb, xb, y, za, xa, y, za);
      };
      const zTop = city.originZ + D + RH;
      for (let i = 0; i <= city.blocksX; i++) {
        const x = city.originX + i * P;
        quad(x - RH, waterZ, x + RH, zTop);
      }
      for (let j = 0; j <= city.blocksZ; j++) {
        const z = city.originZ + j * P;
        const za = Math.max(waterZ, z - RH), zb = z + RH;
        for (let i = 0; i < city.blocksX; i++) {
          const xa = city.originX + i * P + RH, xb = city.originX + (i + 1) * P - RH;
          quad(xa, za, xb, zb);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeBoundingSphere();
      const mat = this.makeWaterMat(b, 0.62, true);
      mat.side = THREE.DoubleSide;
      const m = new THREE.Mesh(geo, mat);
      m.name = 'env:flood';
      m.frustumCulled = false;
      m.renderOrder = 1;
      this.keep(geo, mat);
      this.root.add(m);
    }
  }

  /**
   * The world edge: the city's street grid runs on past the bounds as OUTSKIRTS — fading roads
   * (a lit toon mesh just above the ground) and, on the parcels between them, fogged low-poly
   * towers (one unlit merged draw) in the city's own kit language: a per-tower facade hue from the
   * palette, window bands, a parapet cap, a dark ink cornice and ink corner edges, the odd rooftop
   * plant box / setback crown / mast. Aerial perspective is baked into the vertex colours on top of
   * the real fog and grows ring by ring, so the outskirts dissolve into the horizon instead of
   * ending in a flat field of blank slabs. Camera-side towers (+X / +Z) keep the sight-line cap
   * (h ≤ 0.77 × distance past the bounds): no silhouette can stand between the camera and a titan
   * hugging the edge. Far-side (−X / −Z) towers sit BEHIND the city in the fixed 45° view.
   */
  private buildSkyline(b: BiomeDef, city: CityLayout): void {
    const p = b.palette;
    const bd = city.bounds;
    const rng = mulberry32((city.seed ^ 0x51c7) >>> 0);
    const night = b.time === 'night';
    const snow = b.id === 'whitestacks';
    const fog = new THREE.Color(p.fog);
    const P = city.pitch, RH = city.roadW / 2;
    const W = city.blocksX * P, Dz = city.blocksZ * P;
    const waterZ = harbourWaterZ(city);
    const RINGS = 7;

    // ── paints ──
    const bodies = night
      ? ['#141b36', '#18203c', '#1d1b38'].map((h) => new THREE.Color(h))
      : [p.bodyA, p.bodyB, p.bodyC, p.roofB].map((h) => new THREE.Color(h));
    const airTop = night ? 0.12 : 0.2, airBase = night ? 0.36 : 0.44;    // aerial mix at ring 1
    const airRing = night ? 0.05 : 0.075;                                  // + per extra ring
    const inkBase = new THREE.Color(INK);
    const trimBase = new THREE.Color(p.trimA);
    const roofBase = new THREE.Color(p.roofA);
    const glassBase = new THREE.Color(p.glass);
    const litBase = atLuminance(p.glassLit, Math.max(0.03, lum(bodies[0]) * 6));
    const neonA = atLuminance(p.sign, Math.max(0.03, lum(bodies[0]) * 5));
    const neonB = atLuminance(p.signB, Math.max(0.03, lum(bodies[0]) * 5));
    const SHADE = [1.0, 1.0, 0.72, 0.84, 0.72] as const;       // top, +x (sun-ish), −x, +z, −z
    const bld = new Builder();
    const c0 = new THREE.Color(), c1 = new THREE.Color(), c2 = new THREE.Color(), c3 = new THREE.Color();
    const cInk = new THREE.Color(), cTrim = new THREE.Color(), cRoof = new THREE.Color(), cBand = new THREE.Color();
    const cT = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];

    // ── roads (lit toon, one mesh, drawn after the city so it only shades what the city leaves) ──
    const road = new THREE.Color(p.road), ground = new THREE.Color(p.ground), pad = new THREE.Color(p.sidewalk);
    const rpos: number[] = [], rcol: number[] = [];
    const RY = GROUND_Y + 0.015;
    const fadeAt = (x: number, z: number, base: THREE.Color, out: THREE.Color): THREE.Color => {
      const dx = Math.max(0, bd.minX - x, x - bd.maxX), dz = Math.max(0, bd.minZ - z, z - bd.maxZ);
      return out.copy(base).lerp(ground, 0.12 + 0.72 * smooth(0, RINGS * P, Math.max(dx, dz)));
    };
    const rquad = (xa: number, za: number, xb: number, zb: number, base: THREE.Color = road): void => {
      const ca = fadeAt(xa, za, base, c0), cb = fadeAt(xb, za, base, c1), cc = fadeAt(xb, zb, base, c2), cd = fadeAt(xa, zb, base, c3);
      rpos.push(xa, RY, za, xa, RY, zb, xb, RY, zb, xa, RY, za, xb, RY, zb, xb, RY, za);
      rcol.push(ca.r, ca.g, ca.b, cd.r, cd.g, cd.b, cc.r, cc.g, cc.b, ca.r, ca.g, ca.b, cc.r, cc.g, cc.b, cb.r, cb.g, cb.b);
    };
    const inCity = (x: number, z: number): boolean =>
      x > city.originX - RH - 0.01 && x < city.originX + W + RH + 0.01 && z > city.originZ - RH - 0.01 && z < city.originZ + Dz + RH + 0.01;
    const wet = (z: number): boolean => waterZ !== null && z < waterZ;
    // one segment per block span, so the vertex colours can fade out ring by ring
    for (let i = -RINGS; i <= city.blocksX + RINGS; i++) {
      const x = city.originX + i * P;
      for (let j = -RINGS; j < city.blocksZ + RINGS; j++) {
        const za = city.originZ + j * P, zb = za + P, zm = (za + zb) / 2;
        if (inCity(x, zm) || wet(zm)) continue;
        rquad(x - RH, za, x + RH, zb);
      }
    }
    for (let j = -RINGS; j <= city.blocksZ + RINGS; j++) {
      const z = city.originZ + j * P;
      if (wet(z)) continue;
      for (let i = -RINGS; i < city.blocksX + RINGS; i++) {
        const xa = city.originX + i * P + RH, xb = city.originX + (i + 1) * P - RH;
        if (inCity((xa + xb) / 2, z)) continue;
        rquad(xa, z - RH, xb, z + RH);
      }
    }
    // ── towers on the outskirt parcels ──
    const PH = PARCEL_HALF_M;
    const tower = (x0: number, z0: number, x1: number, z1: number, h: number, ring: number, crown: boolean): void => {
      const w = x1 - x0, d = z1 - z0;
      const air = Math.min(0.9, (ring - 1) * airRing);
      const bc = bodies[Math.floor(rng() * bodies.length)];
      const topCol = c0.copy(bc).lerp(fog, Math.min(0.95, airTop + air));
      const baseCol = c1.copy(bc).lerp(fog, Math.min(0.97, airBase + air));
      cRoof.copy(roofBase).lerp(fog, Math.min(0.9, (snow ? 0.08 : 0.3) + air));
      cTrim.copy(trimBase).lerp(fog, Math.min(0.9, (night ? 0.25 : 0.42) + air));
      cInk.copy(inkBase).lerp(fog, Math.min(0.9, (night ? 0.12 : 0.22) + air));
      const yRef = 150;
      bld.boxGrad(x0, 0, z0, x1, h, z1, baseCol, topCol, cRoof, yRef, SHADE);
      // parapet cap: roof colour on top, trim sides (the building's "hat")
      const e = 0.45, ph = 1.2 + Math.min(1.4, h * 0.012);
      for (let k = 0; k < 4; k++) cT[k].copy(cTrim).multiplyScalar(SHADE[k + 1]);
      bld.box(x0 - e, h, z0 - e, x1 + e, h + ph, z1 + e, cRoof, cT[0], cT[1], cT[2], cT[3]);
      // ink: cornice line under the parapet + the three camera-visible vertical edges
      const o = 0.3, lw = Math.max(0.6, Math.min(1.6, h * 0.012));
      bld.quad([x1 + o, h - lw, z1], [x1 + o, h - lw, z0], [x1 + o, h, z0], [x1 + o, h, z1], cInk);
      bld.quad([x0, h - lw, z1 + o], [x1, h - lw, z1 + o], [x1, h, z1 + o], [x0, h, z1 + o], cInk);
      bld.quad([x1 + o, 0, z1], [x1 + o, 0, z1 - lw], [x1 + o, h, z1 - lw], [x1 + o, h, z1], cInk);
      bld.quad([x1 - lw, 0, z1 + o], [x1, 0, z1 + o], [x1, h, z1 + o], [x1 - lw, h, z1 + o], cInk);
      bld.quad([x1 + o, 0, z0 + lw], [x1 + o, 0, z0], [x1 + o, h, z0], [x1 + o, h, z0 + lw], cInk);
      bld.quad([x0, 0, z1 + o], [x0 + lw, 0, z1 + o], [x0 + lw, h, z1 + o], [x0, h, z1 + o], cInk);
      // window bands on the two camera-facing faces
      const pitch = 4.2, bh = 1.7, m = 1.4, eb = 0.22;
      const rows = Math.floor((h - 3) / pitch);
      for (let r = 1; r < rows; r++) {
        const yy = r * pitch + 1.0;
        if (night) {
          if (rng() < 0.35) continue;
          const segs = 2 + Math.floor(rng() * 4);
          for (let sgi = 0; sgi < segs; sgi++) {
            if (rng() < 0.45) continue;
            const a0 = 0.1 + (sgi / segs) * 0.8, a1 = a0 + (0.8 / segs) * 0.7;
            bld.quad([x1 + eb, yy, z1 - a0 * d], [x1 + eb, yy, z1 - a1 * d], [x1 + eb, yy + bh, z1 - a1 * d], [x1 + eb, yy + bh, z1 - a0 * d], litBase);
            bld.quad([x0 + a0 * w, yy, z1 + eb], [x0 + a1 * w, yy, z1 + eb], [x0 + a1 * w, yy + bh, z1 + eb], [x0 + a0 * w, yy + bh, z1 + eb], litBase);
          }
        } else {
          const fy = Math.min(1, yy / yRef);
          cBand.copy(glassBase).lerp(fog, Math.min(0.95, 0.8 * (airBase + air - (airBase - airTop) * fy)));
          bld.quad([x1 + eb, yy, z1 - m], [x1 + eb, yy, z0 + m], [x1 + eb, yy + bh, z0 + m], [x1 + eb, yy + bh, z1 - m], cBand);
          c2.copy(cBand).multiplyScalar(SHADE[3]);
          bld.quad([x0 + m, yy, z1 + eb], [x1 - m, yy, z1 + eb], [x1 - m, yy + bh, z1 + eb], [x0 + m, yy + bh, z1 + eb], c2);
        }
      }
      if (night && h > 45 && rng() < 0.3) {
        const nc = rng() < 0.5 ? neonA : neonB;
        bld.quad([x0, h - 3.2, z1 + 0.4], [x1, h - 3.2, z1 + 0.4], [x1, h - 1.8, z1 + 0.4], [x0, h - 1.8, z1 + 0.4], nc);
        bld.quad([x1 + 0.4, h - 3.2, z1], [x1 + 0.4, h - 3.2, z0], [x1 + 0.4, h - 1.8, z0], [x1 + 0.4, h - 1.8, z1], nc);
      }
      // rooftop: a setback crown (+ mast) on tall ones, else a plant room / tank box
      const top = h + ph;
      if (crown && h > 60) {
        const f = 0.55 + rng() * 0.2, hh = h * (0.08 + rng() * 0.12);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cw = (w * f) / 2, cd = (d * f) / 2;
        bld.boxGrad(cx - cw, top, cz - cd, cx + cw, top + hh, cz + cd, topCol, topCol, cRoof, yRef, SHADE);
        if (rng() < 0.5) {
          const aw = 0.6, ah = hh * 1.3 + 6;
          bld.box(cx - aw, top + hh, cz - aw, cx + aw, top + hh + ah, cz + aw, cTrim, cT[0], cT[1], cT[2], cT[3]);
        }
      } else if (rng() < 0.7) {
        const bw = w * (0.18 + rng() * 0.18), bdp = d * (0.18 + rng() * 0.18), bhh = 2 + rng() * 3.5;
        const bx = x0 + w * (0.2 + rng() * 0.45), bz = z0 + d * (0.2 + rng() * 0.45);
        bld.box(bx, top, bz, bx + bw, top + bhh, bz + bdp, cRoof, cT[0], cT[1], cT[2], cT[3]);
      }
    };

    for (let bi = -RINGS; bi < city.blocksX + RINGS; bi++) {
      for (let bj = -RINGS; bj < city.blocksZ + RINGS; bj++) {
        if (bi >= 0 && bi < city.blocksX && bj >= 0 && bj < city.blocksZ) continue;   // the city itself
        const cxB = city.originX + (bi + 0.5) * P, czB = city.originZ + (bj + 0.5) * P;
        const ring = Math.max(bi < 0 ? -bi : bi - city.blocksX + 1, bj < 0 ? -bj : bj - city.blocksZ + 1, 1);
        // LOCKWATER: open harbour close in; only a far shore past ~520 m of water
        if (waterZ !== null && czB < waterZ && czB > waterZ - 520) continue;
        if (rng() > 0.92 - ring * 0.05) continue;                  // thinning out with distance
        // sight-line cap for the camera-side rings (distance of the parcel's near face past the bounds)
        const offX = cxB - PH - bd.maxX, offZ = czB - PH - bd.maxZ;
        const camSide = offX > 0 || offZ > 0;
        const hCap = camSide ? Math.min(95, 0.77 * Math.max(offX, offZ)) : Math.min(135, 38 + ring * 16);
        if (hCap < 9) continue;
        // a developed parcel: sidewalk-coloured lot under the buildings (empty blocks stay green)
        const LH = P / 2 - RH;
        rquad(cxB - LH, czB - LH, cxB + LH, czB + LH, pad);
        const layout = rng();
        if (layout < 0.4) {
          // one big slab / tower
          const hw = PH * (0.62 + rng() * 0.3), hd = PH * (0.62 + rng() * 0.3);
          const jx = (PH - hw) * (rng() * 2 - 1), jz = (PH - hd) * (rng() * 2 - 1);
          const h = Math.min(hCap, 18 + Math.pow(rng(), 1.6) * Math.max(0, hCap - 18));
          tower(cxB + jx - hw, czB + jz - hd, cxB + jx + hw, czB + jz + hd, h, ring, true);
        } else {
          // two to four smaller buildings on a 2×2 sub-grid
          const q = PH / 2;
          for (let k = 0; k < 4; k++) {
            if (rng() < 0.3) continue;
            const qx = cxB + (k & 1 ? q : -q), qz = czB + (k & 2 ? q : -q);
            const hw = q * (0.6 + rng() * 0.3), hd = q * (0.6 + rng() * 0.3);
            const h = 0.8 * Math.min(hCap, 9 + Math.pow(rng(), 1.6) * Math.max(0, hCap - 9));
            tower(qx - hw, qz - hd, qx + hw, qz + hd, h, ring, false);
          }
        }
      }
    }
    if (rpos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(rcol, 3));
      const nrm = new Float32Array(rpos.length);
      for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.computeBoundingSphere();
      const m = makeToon({ vertexColors: true });
      m.name = 'env:outskirtRoads';
      const mesh = new THREE.Mesh(g, m);
      mesh.name = 'env:outskirtRoads';
      mesh.receiveShadow = true; mesh.castShadow = false;
      mesh.renderOrder = 900;
      this.keep(g, m);
      this.root.add(mesh);
    }

    const geo = bld.geometry();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    mat.name = 'env:skyline';
    const m = new THREE.Mesh(geo, mat);
    m.name = 'env:skyline';
    m.castShadow = false; m.receiveShadow = false;
    this.keep(geo, mat);
    this.skyline = m;
    this.root.add(m);
  }

  private buildWeather(b: BiomeDef): void {
    const snow = b.weather === 'snow';
    this.weatherKind = snow ? 'snow' : 'rain';
    this.weatherCounts = snow ? [700, 1500, 2600] : [800, 1700, 3000];
    const count = this.weatherCounts[2];
    // base shape: snow = hexagon (6 tris), rain = a thin quad (x ∈ [−.5,.5], y ∈ [0,1])
    const base = new THREE.InstancedBufferGeometry();
    if (snow) {
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
        pts.push(0, 0, 0, Math.cos(a0) * 0.5, Math.sin(a0) * 0.5, 0, Math.cos(a1) * 0.5, Math.sin(a1) * 0.5, 0);
      }
      base.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    } else {
      base.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
      ], 3));
    }
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seeds[i] = Math.random();
    base.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    base.instanceCount = this.weatherCounts[this.ctx.quality.level] ?? count;
    const p = b.palette;
    const color = snow ? new THREE.Color('#f7fbff') : new THREE.Color(p.skyHorizon).lerp(new THREE.Color('#dfe9ff'), 0.6).lerp(new THREE.Color(p.signB), 0.12);
    const mat = new THREE.ShaderMaterial({
      name: 'env:weather',
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uCenter: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(20, 12, 20) },
          uTime: { value: 0 },
          uVel: { value: new THREE.Vector3(0, -1, 0) },
          uSize: { value: 0.05 },
          uLen: { value: 0.5 },
          uRain: { value: snow ? 0 : 1 },
          uNear: { value: 10 },
          uColor: { value: color },
          uAlpha: { value: snow ? 0.95 : 0.42 },
        },
      ]),
      vertexShader: WEATHER_VERT,
      fragmentShader: WEATHER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(base, mat);
    m.name = 'env:weather';
    m.frustumCulled = false;
    m.renderOrder = 5;
    m.castShadow = false; m.receiveShadow = false;
    this.keep(base, mat);
    this.weather = m; this.weatherMat = mat;
    this.root.add(m);
  }

  private buildClouds(b: BiomeDef, city: CityLayout): void {
    const rng = mulberry32((city.seed ^ 0xc10d) >>> 0);
    // one puffy cluster: 7 low-poly blobs, flattened underside, faceted, painted warm-top/cool-belly
    const parts: THREE.BufferGeometry[] = [];
    const blobs: [number, number, number, number][] = [
      [0, 0.28, 0, 0.62], [0.62, 0.18, 0.08, 0.46], [-0.6, 0.16, -0.05, 0.48],
      [0.25, 0.42, -0.22, 0.44], [-0.22, 0.38, 0.24, 0.42], [1.05, 0.08, -0.1, 0.3], [-1.0, 0.06, 0.12, 0.32],
    ];
    for (const [x, y, z, r] of blobs) {
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.translate(x, y, z);
      parts.push(g);
    }
    let count = 0;
    for (const g of parts) count += (g.index ? g.index.count : g.getAttribute('position').count);
    const pos = new Float32Array(count * 3);
    let o = 0;
    for (const g of parts) {
      const ng = g.index ? g.toNonIndexed() : g;
      const pa = ng.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        pos[o++] = pa.getX(i); pos[o++] = Math.max(0.02, pa.getY(i)); pos[o++] = pa.getZ(i);
      }
      g.dispose(); if (ng !== g) ng.dispose();
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo = facet(geo);
    const pa = geo.getAttribute('position') as THREE.BufferAttribute;
    const cols = new Float32Array(pa.count * 3);
    const warm = new THREE.Color('#fffaf2'), cool = new THREE.Color(b.palette.sky).lerp(new THREE.Color('#ffffff'), 0.55);
    for (let i = 0; i < pa.count; i += 3) {
      const yc = (pa.getY(i) + pa.getY(i + 1) + pa.getY(i + 2)) / 3;
      _col.copy(cool).lerp(warm, Math.min(1, Math.max(0, (yc - 0.05) / 0.45)));
      for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = _col.r; cols[(i + k) * 3 + 1] = _col.g; cols[(i + k) * 3 + 2] = _col.b; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    bakeOutlineNormals(geo);
    geo.computeBoundingSphere();
    const mat = makeToon({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.1 });
    mat.name = 'env:cloud';
    const N = 22;
    const im = new THREE.InstancedMesh(geo, mat, N);
    im.name = 'env:clouds';
    im.frustumCulled = false;
    im.castShadow = false; im.receiveShadow = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cloudSeeds = [];
    for (let i = 0; i < N; i++) {
      this.cloudSeeds.push({ u: rng(), v: rng(), s: 0.75 + rng() * 0.6, rot: rng() * Math.PI * 2, sx: 1 + rng() * 0.6, sz: 0.8 + rng() * 0.5 });
    }
    im.count = 0;
    addOutline(im, OUTLINE_PX.prop);
    this.keep(geo, mat);
    this.clouds = im;
    this.root.add(im);
  }

  /** Everything the cloud deck must never cover, as screen circles (NDC, y units: the frame is 2
   *  tall): the titan, the boss (every part, full height) and every live hostile telegraph. */
  private gatherKeepClear(w: World): number {
    this.keepN = 0;
    const T = w.titan;
    if (T) this.pushKeep(T.x, T.height * 0.5, T.z, Math.max(T.radius, T.height * 0.6), 0.34);
    const b = w.boss;
    if (b && b.alive) {
      let r = 12, top = 20;
      for (const p of b.parts) {
        r = Math.max(r, Math.hypot(p.x - b.x, p.z - b.z) + p.r);
        top = Math.max(top, p.y1);
      }
      this.pushKeep(b.x, top * 0.5, b.z, Math.max(r, top * 0.5), 0.14);
    }
    for (const tg of w.telegraphs) {
      if (!tg.alive || tg.owner === 'titan') continue;
      if (tg.fired && tg.t > tg.windup + tg.active) continue;
      const s = tg.shape;
      let x = 0, z = 0, r = 0;
      if (tg.chain && tg.chain.length >= 4) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let i = 0; i + 1 < tg.chain.length; i += 2) {
          x0 = Math.min(x0, tg.chain[i]); x1 = Math.max(x1, tg.chain[i]);
          z0 = Math.min(z0, tg.chain[i + 1]); z1 = Math.max(z1, tg.chain[i + 1]);
        }
        x = (x0 + x1) / 2; z = (z0 + z1) / 2; r = Math.hypot(x1 - x0, z1 - z0) / 2 + 4;
      } else {
        switch (s.k) {
          case 'circle': x = s.x; z = s.z; r = s.r; break;
          case 'ring': x = s.x; z = s.z; r = s.r1; break;
          case 'cone': x = s.x; z = s.z; r = s.r; break;
          case 'oval': x = s.x; z = s.z; r = Math.max(s.rx, s.rz); break;
          case 'lane': x = s.x + Math.sin(s.dir) * s.len / 2; z = s.z + Math.cos(s.dir) * s.len / 2; r = Math.hypot(s.len / 2, s.w / 2); break;
          case 'capsule': x = (s.x0 + s.x1) / 2; z = (s.z0 + s.z1) / 2; r = Math.hypot(s.x1 - s.x0, s.z1 - s.z0) / 2 + s.r; break;
        }
      }
      this.pushKeep(x, 0, z, r, 0.1);
    }
    return this.keepN;
  }

  private pushKeep(x: number, y: number, z: number, r: number, margin: number): void {
    if (this.keepN >= KEEP_CLEAR_MAX) return;
    const cam = this.ctx.camera;
    this._p.set(x, y, z);
    const dist = Math.max(1, this._p.distanceTo(cam.position));
    this._p.project(cam);
    if (this._p.z > 1) return;                                     // behind the camera
    const o = this.keepN * 4, kc = this.keepClear;
    kc[o] = this._p.x * cam.aspect; kc[o + 1] = this._p.y;         // isotropic: x scaled by aspect
    kc[o + 2] = r / (dist * Math.tan((cam.fov * Math.PI) / 360)); kc[o + 3] = margin;
    this.keepN++;
  }

  private updateClouds(w: World, tx: number, tz: number, D: number, ext: number, t: number): void {
    const im = this.clouds!;
    const cam = this.ctx.camera;
    const camY = cam.position.y;
    const alt = Math.max(150, camY * 0.5);
    if (camY < alt * 1.3) { im.count = 0; return; }
    cam.updateMatrixWorld();
    const nKeep = this.gatherKeepClear(w);
    const kc = this.keepClear;
    const aspect = cam.aspect || 16 / 9;
    const tanH = Math.tan((cam.fov * Math.PI) / 360);
    // k = how much a cloud-deck offset from the camera magnifies when projected to the ground;
    // tile + size shrink by 2/k so the deck reads the same on screen at Size IV and V
    const k = camY / Math.max(1e-3, camY - alt);
    const sc = 2 / k;
    const R = ext * 1.5 * sc;                     // wrap tile (world-anchored, around the camera's view)
    const cx = cam.position.x, cz = cam.position.z;
    // tile centred on the deck point that projects onto the look target
    const ax = cx + (tx - cx) / k, az = cz + (tz - cz) / k;
    const lox = ax - R / 2, loz = az - R / 2;
    const drift = t * ext * 0.006 * sc;
    let n = 0;
    for (let i = 0; i < this.cloudSeeds.length; i++) {
      const s = this.cloudSeeds[i];
      const wx = lox + (((s.u * R + drift - lox) % R) + R) % R;
      const wz = loz + (((s.v * R + drift * 0.35 - loz) % R) + R) % R;
      // where this cloud lands on screen: ray camera → cloud, extended to the ground
      const gx = cx + (wx - cx) * k, gz = cz + (wz - cz) * k;
      const full = ext * 0.06 * sc * s.s;          // deck-space size before parting
      // ground clearance from the look target, measured from the cloud's projected EDGE: the deck
      // opens a wide hole (0.45–0.7 ext) over the play space around the titan
      const dG = (Math.hypot(gx - tx, gz - tz) - full * s.sx * 0.9 * k) / ext;
      let vis = smooth(0.45, 0.7, dG);
      if (vis < 0.02) continue;
      const dc = Math.hypot(wx - cx, alt - camY, wz - cz);
      vis *= smooth(0.12 * D, 0.25 * D, dc);
      if (vis < 0.02) continue;
      // screen space: the cloud (full size, conservative) as an NDC circle, y units
      this._p.set(wx, alt + full * 0.3, wz).project(cam);
      if (this._p.z > 1) continue;
      const cxN = this._p.x * aspect, cyN = this._p.y;
      const rN = (1.3 * full * Math.max(s.sx, s.sz)) / (Math.max(1, dc) * tanH);
      // (1) frame band: clouds live in the outer ~12 % of the frame. Intrusion of the cloud's box
      //     into the inner rectangle (|x|,|y| < 0.76), in NDC-y units
      const inX = BAND_INNER * aspect - (Math.abs(cxN) - rN);
      const inY = BAND_INNER - (Math.abs(cyN) - rN);
      if (inX > 0 && inY > 0) vis *= 1 - smooth(0.0, 0.16, Math.min(inX, inY));
      if (vis < 0.02) continue;
      // (2) never over the titan, the boss or a live hostile telegraph
      for (let j = 0; j < nKeep && vis >= 0.02; j++) {
        const o = j * 4;
        const gap = Math.hypot(cxN - kc[o], cyN - kc[o + 1]) - rN - kc[o + 2];
        vis *= smooth(0, kc[o + 3], gap);
      }
      if (vis < 0.02) continue;
      const size = full * (0.35 + 0.65 * vis);
      this._p.set(wx, alt, wz);
      this._e.set(0, s.rot, 0);
      this._q.setFromEuler(this._e);
      this._s.set(size * s.sx, size * 0.7, size * s.sz);
      this._m.compose(this._p, this._q, this._s);
      im.setMatrixAt(n++, this._m);
    }
    im.count = n;
    if (n > 0) im.instanceMatrix.needsUpdate = true;
  }
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

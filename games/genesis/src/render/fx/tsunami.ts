// GENESIS — a tsunami's wall of water, seen (CONTRACT.md §11.3, §15.5, §15.7; the art review: "a raised slab of the
// sea surface: no wall of water, no breaking crest, no foam band, no spray, no drawdown").
//
// The sea itself is the planet's water (render/planet/ocean.ts draws the sim's water field as it moves). The sim
// integrates a game minute per tick, so its wave arrives as jumps in that field; this draws, on the render side, the
// wave's FRONT as a mesh, eased forward over real seconds between the field's updates:
//   * the front is found in the sim's own fields — the fastest, leading water round the tsunami's origin, binned by
//     bearing (48 bins) — and each bin's crest glides toward the measured front at the speed it has been advancing;
//   * across the front, a breaking wave in profile: a foam field trailing behind on the swell, the back slope rising
//     to the crest, a lip curling forward over a white-water face, and ahead of it the drawdown — the sea pulled back
//     off a band of wet seabed;
//   * where the front has run up onto land, the crest becomes a turbulent brown bore, lower, carrying debris;
//   * spray blown off the top of the crest along its whole length (render/fx/vfx.ts spray and mist).
// Lit by the planet's sun and sky (the water reflects the sky by Fresnel, a sun glint; the foam and the seabed are
// lit like the ground), drawn over the composited image and soft-tested against the scene's depth.

import { BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { FX_DEPTH_GLSL, FX_LAYER, clamp01, smooth } from './fxcommon.ts';

const BINS = 48;
/** the profile across the front, in units of the crest's height H: (x ahead of the front, y above the water) */
const PROFILE: [number, number][] = [
  [-9, 0.03], [-5, 0.05], [-2.8, 0.14], [-1.6, 0.42], [-0.8, 0.82], [-0.2, 1.0],     // foam field, back slope, crest
  [0.3, 0.98], [0.62, 0.78], [0.5, 0.58], [0.48, 0.34], [0.72, 0.06],                // lip, curl, white-water face, foot
  [1.3, -0.02], [4.2, -0.02],                                                         // the drawdown: wet seabed ahead
];
const NP = PROFILE.length;

const VERT = /* glsl */ `
${ATMO_PARS}
${SKY_LOOKUP}
uniform vec3 uSunDirBody;
uniform vec3 uCamB;
attribute float aPart;
attribute float aAlong;
attribute float aLand;
attribute float aOn;
attribute vec3 aN;
varying float vPart;
varying float vAlong;
varying float vLand;
varying float vOn;
varying float vZ;
varying vec3 vSun;
varying vec3 vSky;
varying vec3 vRefl;
varying float vFres;
varying float vGlint;
void main() {
  vPart = aPart; vAlong = aAlong; vLand = aLand; vOn = aOn;
  vec3 p = position;
  float rP = length(p);
  vec3 up = p / rP;
  vSun = uSunE * sunTransmittance(rP, dot(up, uSunDirBody)) * max(0.0, dot(aN, uSunDirBody));
  vSky = skyIrradiance(up, aN, uSunDirBody);
  vec3 v = normalize(uCamB - p);
  vec3 r = reflect(-v, aN);
  vRefl = skyRadiance(up, normalize(r + up * 0.02), uSunDirBody);
  vFres = 0.02 + 0.98 * pow(1.0 - max(0.0, dot(v, aN)), 5.0);
  vGlint = pow(max(0.0, dot(r, uSunDirBody)), 160.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
uniform float uK;
uniform vec3 uSunE2;
varying float vPart;
varying float vAlong;
varying float vLand;
varying float vOn;
varying float vZ;
varying vec3 vSun;
varying vec3 vSky;
varying vec3 vRefl;
varying float vFres;
varying float vGlint;
void main() {
  if (vOn < 0.5) discard;
  float vis = fxSoft(vZ, 3.0);
  if (vis <= 0.0) discard;
  float pt = vPart;
  // foam: churning patches (streaked along the front on the face, torn into islands on the swell behind)
  float n1 = snoise(vec3(vAlong * 0.06, pt * 2.2 - uFxTime * 0.6, 1.3));
  float n2 = snoise(vec3(vAlong * 0.21 + 7.0, pt * 6.0 + uFxTime * 1.4, 4.7));
  float foamN = 0.5 + 0.35 * n1 + 0.2 * n2;
  // the parts of the profile: 0–2 foam field, 2–5 the back slope and crest (water), 5–10 lip and white-water face,
  // 10–12 the wet seabed of the drawdown
  float behind = 1.0 - smoothstep(1.6, 2.6, pt);
  float body = smoothstep(1.6, 2.6, pt) * (1.0 - smoothstep(4.6, 5.4, pt));
  float white = smoothstep(4.6, 5.4, pt) * (1.0 - smoothstep(9.6, 10.2, pt));
  float bed = smoothstep(9.6, 10.2, pt);
  vec3 lit = vSun * 0.24 + vSky * 0.3 + vec3(0.003, 0.004, 0.006);
  // water: deep teal, the sky in it by Fresnel, a sun glint; translucent green where the crest thins against the light
  vec3 deep = vec3(0.015, 0.05, 0.055) * (vSky * 0.35 + vSun * 0.06);
  vec3 water = mix(deep, vRefl, vFres) + uSunE2 * vGlint * 0.6;
  float thin = smoothstep(3.0, 4.8, pt) * (1.0 - smoothstep(5.2, 6.4, pt));
  water += vec3(0.05, 0.22, 0.17) * (vSun * 0.08 + vSky * 0.05) * thin * 3.0;
  float foamW = smoothstep(0.35, 0.75, foamN) * (0.25 + 0.75 * smoothstep(3.6, 4.8, pt));
  vec3 foam = vec3(0.86, 0.9, 0.92) * lit * 1.3;
  vec3 c = mix(water, foam, foamW * body);
  float a = body * 0.97;
  // the lip and the face: white water all the way down, streaked
  float streak = 0.75 + 0.25 * snoise(vec3(vAlong * 0.4, pt * 1.5 - uFxTime * 2.5, 9.1));
  c = mix(c, foam * streak, white);
  a = max(a, white * 0.97);
  // behind: islands of foam on the swell
  float isl = smoothstep(0.45, 0.7, foamN) * behind * (0.35 + 0.65 * smoothstep(0.0, 1.6, pt));
  c = mix(c, foam, behind);
  a = max(a, isl * 0.85);
  // ahead: the seabed laid bare by the drawdown, wet and dark, puddled, fading out ahead
  float wet = 0.6 + 0.4 * snoise(vec3(vAlong * 0.12, pt * 3.0, 2.2));
  vec3 sea = vec3(0.17, 0.15, 0.12) * lit * (0.6 + 0.4 * wet) + vRefl * 0.12 * smoothstep(0.55, 0.8, wet);
  c = mix(c, sea, bed);
  a = mix(a, 0.9 * (1.0 - smoothstep(10.6, 12.0, pt)), bed);
  // on land: a turbulent brown bore of mud and wreckage
  vec3 mud = mix(vec3(0.32, 0.25, 0.17), vec3(0.62, 0.58, 0.52), smoothstep(0.5, 0.85, foamN)) * lit * 1.1;
  c = mix(c, mud, vLand * (1.0 - bed));
  a *= uK * vis;
  gl_FragColor = vec4(c * a, a);
}
`;

interface Bin { r: number; rMeas: number; speed: number; level: number; land: number; valid: boolean; seen: number }

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _n = new Vector3();

/** one tsunami's front: found in the sim's water and flow fields, eased forward, drawn as a breaking wave */
export class TsunamiCrest {
  readonly mesh: Mesh;
  private geo = new BufferGeometry();
  private bins: Bin[] = [];
  private e1 = new Vector3();
  private e2 = new Vector3();
  private u0 = new Vector3();
  private measAt = -1e9;
  private lastMeas = -1e9;
  /** FX time of the first update, whether the fields ever showed a front, and the played front's source (see synth) */
  private born = -1;
  private everMeasured = false;
  private synthetic = false;
  private srcSet = false;
  private hasSea = false;
  private landTh = 0;
  private origin0 = new Vector3();
  private synT = -1;
  /** where a played front starts out from its source (m) */
  private startR = 300;
  readonly u = { uK: { value: 0 }, uCamB: { value: new Vector3() }, uSunE2: { value: new Vector3() } };
  /** the crest's points this frame (body m) and the outward direction there: GodFx's spray rides them */
  readonly crest: { p: Vector3; out: Vector3; land: number }[] = [];

  constructor(fx: Record<string, IUniform>, shared: Record<string, IUniform>) {
    for (let i = 0; i < BINS; i++) this.bins.push({ r: 0, rMeas: 0, speed: 20, level: 0, land: 0, valid: false, seen: -1e9 });
    const n = BINS * NP;
    this.geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute('aN', new BufferAttribute(new Float32Array(n * 3), 3));
    const part = new Float32Array(n), along = new Float32Array(n), land = new Float32Array(n), on = new Float32Array(n);
    for (let i = 0; i < BINS; i++) for (let j = 0; j < NP; j++) part[i * NP + j] = j;
    this.geo.setAttribute('aPart', new BufferAttribute(part, 1));
    this.geo.setAttribute('aAlong', new BufferAttribute(along, 1));
    this.geo.setAttribute('aLand', new BufferAttribute(land, 1));
    this.geo.setAttribute('aOn', new BufferAttribute(on, 1));
    const idx: number[] = [];
    // (the front closes round the origin: bin BINS−1 joins bin 0)
    for (let i = 0; i < BINS; i++) {
      const i2 = (i + 1) % BINS;
      for (let j = 0; j < NP - 1; j++) {
        const a = i * NP + j, b = i2 * NP + j;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    this.geo.setIndex(idx);
    const uniforms: Record<string, IUniform> = { ...this.u };
    for (const k of Object.keys(fx)) uniforms[k] = fx[k];
    for (const k of Object.keys(shared)) if (!(k in uniforms)) uniforms[k] = shared[k];
    this.mesh = new Mesh(this.geo, new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(FX_LAYER);
    this.mesh.renderOrder = 2;
  }

  /**
   * One frame: re-find the front a few times a second, ease each bin forward, rebuild the mesh. `origin` is the
   * tsunami's place (unit), `H` its crest height (m), `reach` how far out to look (m), `k` its fade.
   */
  update(pv: PlanetView, origin: Vector3, H: number, reach: number, k: number, now: number, ease: number, camB: Vector3, sunE: Vector3): void {
    const R = pv.params.radius;
    if (this.born < 0 || now < this.born) this.born = now;
    // (the real sim carries the wave in its hydrology's edge fluxes: its flow fields can stay at rest, so a front that
    // has not shown in the fields within a second is played instead — from offshore to the coast at the disaster's
    // point and on inland, in FX time; see synth)
    if (!this.everMeasured && !this.synthetic && now - this.born > 1.0) this.synthetic = true;
    if (this.synthetic) {
      if (!this.srcSet) this.findSource(pv, origin, reach);
      if (!this.hasSea) { this.mesh.visible = false; this.crest.length = 0; return; }
      this.synth(pv, now, ease, reach);
    } else {
      this.u0.copy(origin).normalize();
      this.frame();
      if (now - this.measAt > 0.25 || now < this.measAt) { this.measAt = now; this.measure(pv, reach, now); }
    }
    // each bin's crest glides toward its measured front (and on at the pace it has been going, between measures)
    for (const b of this.bins) {
      if (!b.valid) continue;
      const ahead = b.r + b.speed * ease * 0.6;
      b.r = b.r < b.rMeas ? Math.min(b.rMeas + b.speed * 0.4, ahead + (b.rMeas - b.r) * Math.min(1, ease * 3)) : Math.max(b.r, b.rMeas - 2);
    }
    this.build(pv, R, H, k);
    this.u.uK.value = k;
    this.u.uCamB.value.copy(camB);
    this.u.uSunE2.value.copy(sunE);
  }

  /** the tangent frame at the front's centre */
  private frame(): void {
    this.e1.set(0, 1, 0).cross(this.u0);
    if (this.e1.lengthSq() < 1e-6) this.e1.set(1, 0, 0).cross(this.u0);
    this.e1.normalize();
    this.e2.crossVectors(this.u0, this.e1);
  }

  /** a point `d` metres from unit vector `c` along bearing `th` of the frame (e1, e2) at c */
  private along(c: Vector3, e1: Vector3, e2: Vector3, th: number, d: number, R: number, out: Vector3): Vector3 {
    _n.copy(e1).multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
    const ang = d / R;
    return out.copy(c).multiplyScalar(Math.cos(ang)).addScaledVector(_n, Math.sin(ang));
  }

  /**
   * where a played front starts: the open sea nearest the disaster's point (marching out along 32 bearings), a few
   * hundred metres beyond the coast there; the front's centre moves to it, and it runs back toward the point
   */
  private findSource(pv: PlanetView, origin: Vector3, reach: number): void {
    this.srcSet = true;
    const R = pv.params.radius, sea = R + pv.params.seaLevel;
    const o = this.origin0.copy(origin).normalize();
    this.u0.copy(o);
    this.frame();
    const e1 = this.e1.clone(), e2 = this.e2.clone();
    let bestD = Infinity, bestTh = 0;
    const lim = Math.max(800, reach);
    // placed out on the water: the wave starts about there and runs at the nearest land
    if (groundHeight(pv.ground, o.x, o.y, o.z) < sea - 1.5) {
      for (let i = 0; i < 32; i++) {
        const th = (i / 32) * Math.PI * 2;
        for (let d = 20; d < lim * 2; d += 25) {
          this.along(o, e1, e2, th, d, R, _a);
          if (groundHeight(pv.ground, _a.x, _a.y, _a.z) > sea) { if (d < bestD) { bestD = d; bestTh = th; } break; }
        }
      }
      this.hasSea = true;
      if (!isFinite(bestD)) { bestTh = 0; bestD = lim; }
      // the source well out (a front, not a ring: seen from the shore it spans the view, gently curved), the land
      // along bestTh from it
      this.along(o, e1, e2, bestTh + Math.PI, Math.max(700, reach * 0.6), R, _a);
      this.startR = Math.max(500, reach * 0.45);
      this.u0.copy(_a).normalize();
      this.frame();
      this.along(o, e1, e2, bestTh, bestD, R, _c);
      _b.copy(_c).normalize().addScaledVector(this.u0, -_c.normalize().dot(this.u0));
      this.landTh = Math.atan2(_b.dot(this.e2), _b.dot(this.e1));
      for (const b of this.bins) { b.valid = false; b.r = 0; b.rMeas = 0; b.speed = 22; b.land = 0; b.seen = 0; }
      return;
    }
    this.startR = Math.max(300, reach * 0.25);
    for (let i = 0; i < 32; i++) {
      const th = (i / 32) * Math.PI * 2;
      for (let d = 20; d < lim; d += 25) {
        this.along(o, e1, e2, th, d, R, _a);
        if (groundHeight(pv.ground, _a.x, _a.y, _a.z) < sea - 1.5) { if (d < bestD) { bestD = d; bestTh = th; } break; }
      }
    }
    if (!isFinite(bestD)) { this.hasSea = false; return; }
    this.hasSea = true;
    // the source: well out over the water along that bearing; the land lies back the other way
    const off = bestD + Math.max(350, reach * 0.35);
    this.along(o, e1, e2, bestTh, off, R, _a);
    this.u0.copy(_a).normalize();
    this.frame();
    // the bearing (in the new frame) from the source back toward the disaster's point
    _b.copy(o).addScaledVector(this.u0, -o.dot(this.u0));
    this.landTh = Math.atan2(_b.dot(this.e2), _b.dot(this.e1));
    for (const b of this.bins) { b.valid = false; b.r = 0; b.rMeas = 0; b.speed = 22; b.land = 0; b.seen = 0; }
    void off;
  }

  /**
   * the played front: an arc of the wave rolling from the source toward the land (±40° about it, starting a few hundred
   * metres out from it), ~22 m/s over the sea, slowing to a bore of ~8 m/s on land, spent ~300 m inland
   */
  private synth(pv: PlanetView, now: number, ease: number, reach: number): void {
    // (in FX time: frozen with the world when it is paused, moved on by a scripted capture's advance)
    let dtF = this.synT < 0 || now < this.synT ? 0 : Math.min(8, now - this.synT);
    this.synT = now;
    while (dtF > 1e-4) {
      const h = Math.min(0.1, dtF);
      dtF -= h;
      this.synthStep(pv, h, reach);
    }
    void ease;
  }

  private synthStep(pv: PlanetView, ease: number, reach: number): void {
    const R = pv.params.radius, sea = R + pv.params.seaLevel;
    for (let i = 0; i < BINS; i++) {
      const b = this.bins[i];
      const th = ((i + 0.5) / BINS) * Math.PI * 2 - Math.PI;
      let dth = th - this.landTh;
      dth -= Math.round(dth / (Math.PI * 2)) * Math.PI * 2;
      const span = Math.PI * 40 / 180;
      if (Math.abs(dth) > span || b.seen < 0) { b.valid = false; continue; }
      if (!b.valid) { b.valid = true; b.r = this.startR; b.speed = 22; b.land = 0; b.seen = 0; }
      // (a little later at the arc's ends: the front is curved, its middle leads)
      const lag = 1 - 0.25 * (Math.abs(dth) / span) ** 2;
      b.r += b.speed * Math.max(0, Math.min(0.1, ease)) * lag;
      this.along(this.u0, this.e1, this.e2, th, b.r, R, _a);
      const g = groundHeight(pv.ground, _a.x, _a.y, _a.z);
      b.land = clamp01((g - sea) / 2);
      b.level = Math.max(sea, g);
      b.speed += ((b.land > 0.5 ? 8 : 22) - b.speed) * Math.min(1, ease * 1.5);
      b.rMeas = b.r;
      // spent inland: past ~300 m of land (or far beyond its reach), this stretch of the front is gone
      if (b.land > 0.5) b.seen += b.speed * Math.min(0.1, ease);
      if (b.seen > 300 || b.r > reach * 3) { b.valid = false; b.seen = -1; }
    }
  }

  private measure(pv: PlanetView, reach: number, now: number): void {
    const R = pv.params.radius;
    const W = pv.fields.get('water'), S = pv.fields.get('surface');
    const FX = pv.fields.get('flowX'), FY = pv.fields.get('flowY'), FZ = pv.fields.get('flowZ');
    if (!W || !FX || !FY || !FZ) return;
    const P = pv.grid.pos;
    const best = new Float32Array(BINS).fill(-1);
    const lvl = new Float32Array(BINS);
    const lnd = new Float32Array(BINS);
    const sea = R + pv.params.seaLevel;
    const cells = pv.grid.cellsWithin(this.u0.x, this.u0.y, this.u0.z, reach / R);
    for (const c of cells) {
      if (W[c] < 0.3) continue;
      const s = Math.hypot(FX[c], FY[c], FZ[c]) / 60;
      if (s < 2.0) continue;
      _a.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
      const d = Math.acos(Math.max(-1, Math.min(1, _a.dot(this.u0)))) * R;
      _b.copy(_a).addScaledVector(this.u0, -_a.dot(this.u0));
      const th = Math.atan2(_b.dot(this.e2), _b.dot(this.e1));
      const bi = Math.min(BINS - 1, Math.max(0, Math.floor(((th + Math.PI) / (2 * Math.PI)) * BINS)));
      if (d > best[bi]) {
        best[bi] = d;
        const ground = S ? R + S[c] : sea;
        lvl[bi] = Math.max(sea, ground + W[c] * 0.25);
        lnd[bi] = clamp01((ground - sea) / 2);
      }
    }
    // smooth over neighbouring bins (a front is a curve, not a comb), keep bins seen recently
    for (let i = 0; i < BINS; i++) {
      const b = this.bins[i];
      if (best[i] < 0) {
        const l = best[(i + BINS - 1) % BINS], r = best[(i + 1) % BINS];
        if (l >= 0 && r >= 0) { best[i] = 0.5 * (l + r); lvl[i] = 0.5 * (lvl[(i + BINS - 1) % BINS] + lvl[(i + 1) % BINS]); lnd[i] = Math.max(lnd[(i + BINS - 1) % BINS], lnd[(i + 1) % BINS]); }
      }
      if (best[i] >= 0) {
        if (b.valid && now > this.lastMeas) {
          const v = (best[i] - b.rMeas) / Math.max(0.1, now - this.lastMeas);
          if (v > 0) b.speed += (Math.min(80, v) - b.speed) * 0.4;
        }
        if (!b.valid) b.r = best[i];
        b.rMeas = best[i]; b.level = lvl[i]; b.land = lnd[i]; b.valid = true; b.seen = now;
        this.everMeasured = true;
      } else if (now - b.seen > 1.5) b.valid = false;
    }
    this.lastMeas = now;
  }

  private build(pv: PlanetView, R: number, H: number, k: number): void {
    const pos = this.geo.getAttribute('position') as BufferAttribute;
    const nrm = this.geo.getAttribute('aN') as BufferAttribute;
    const along = this.geo.getAttribute('aAlong') as BufferAttribute;
    const land = this.geo.getAttribute('aLand') as BufferAttribute;
    const on = this.geo.getAttribute('aOn') as BufferAttribute;
    const P = pos.array as Float32Array, N = nrm.array as Float32Array;
    this.crest.length = 0;
    for (let i = 0; i < BINS; i++) {
      const b = this.bins[i];
      const th = ((i + 0.5) / BINS) * Math.PI * 2 - Math.PI;
      // the outward direction of this bin on the tangent plane at the origin, and the front point on the sphere
      _n.copy(this.e1).multiplyScalar(Math.cos(th)).addScaledVector(this.e2, Math.sin(th));
      const valid = b.valid && b.r > 5;
      const ok = valid && this.bins[(i + 1) % BINS].valid && this.bins[(i + BINS - 1) % BINS].valid ? 1 : 0;
      // on land the wall is a lower bore of mud
      const Hh = H * (1 - 0.55 * b.land);
      for (let j = 0; j < NP; j++) {
        const [px, py] = PROFILE[j];
        const d = Math.max(0, (b.r || 0) + px * Hh);
        const ang = d / R;
        // a point at distance d along the great circle from the origin toward _n
        _a.copy(this.u0).multiplyScalar(Math.cos(ang)).addScaledVector(_n, Math.sin(ang));
        let base = b.level || R + pv.params.seaLevel;
        // (the drawdown band and the foam field lie on whatever is there: never under the ground)
        if (j >= NP - 2 || j <= 1) base = Math.max(base, groundHeight(pv.ground, _a.x, _a.y, _a.z) + 0.15);
        const hgt = base + py * Hh;
        const o = (i * NP + j) * 3;
        P[o] = _a.x * hgt; P[o + 1] = _a.y * hgt; P[o + 2] = _a.z * hgt;
        along.setX(i * NP + j, th * Math.max(50, b.r));
        land.setX(i * NP + j, b.land);
        on.setX(i * NP + j, ok);
      }
      if (ok && k > 0.05) {
        const c = (i * NP + 5) * 3;
        this.crest.push({ p: new Vector3(P[c], P[c + 1], P[c + 2]), out: _n.clone(), land: b.land });
      }
    }
    // normals across the profile and along the front
    for (let i = 0; i < BINS; i++) {
      const i2 = (i + 1) % BINS, i0 = (i + BINS - 1) % BINS;
      for (let j = 0; j < NP; j++) {
        const j0 = Math.max(0, j - 1), j1 = Math.min(NP - 1, j + 1);
        const o = (i * NP + j) * 3;
        const ax = (i * NP + j1) * 3, bx = (i * NP + j0) * 3, cx = (i2 * NP + j) * 3, dx = (i0 * NP + j) * 3;
        _a.set(P[ax] - P[bx], P[ax + 1] - P[bx + 1], P[ax + 2] - P[bx + 2]);
        _b.set(P[cx] - P[dx], P[cx + 1] - P[dx + 1], P[cx + 2] - P[dx + 2]);
        _c.crossVectors(_b, _a);
        // facing up (away from the planet's centre) on the open water; the face of the wave faces forward
        const up = _n.set(P[o], P[o + 1], P[o + 2]).normalize();
        if (_c.dot(up) < 0 && j < 6) _c.negate();
        if (_c.lengthSq() < 1e-10) _c.copy(up);
        _c.normalize();
        N[o] = _c.x; N[o + 1] = _c.y; N[o + 2] = _c.z;
      }
    }
    pos.needsUpdate = true; nrm.needsUpdate = true; along.needsUpdate = true; land.needsUpdate = true; on.needsUpdate = true;
    this.mesh.visible = k > 0.01 && this.crest.length > 0;
    void smooth;
  }

  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

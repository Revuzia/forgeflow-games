// The capsule (DESIGN 6.2 / 6.3): a NEUTRAL translucent two-half toy capsule (the tier is never spoiled by the shell colour).
// It drops next to the squishy and lands with a wobble (the meter-full cue), stays tappable (screenPoint / hitTest), is squeezed
// open (setSqueeze 0..1: it rattles and stress lines appear), and on a reveal cracks open: hairline cracks spread over the
// shell, light leaks through them in the TIER colour (the tell), the two halves fly apart. All procedural: lathe geometry,
// a voronoi crack shader, a drop / rock / fly physics of a few springs. Draw calls: 2 shell halves + the inner wad + 2 decals.
import * as THREE from 'three';
import { Decals, type Footprint } from './decals.ts';
import type { EnvHub } from './env.ts';
import { NOISE_GLSL } from './shaderlib.ts';

const R = 0.24;          // capsule radius
const HALF = 0.12;       // half of the cylinder part
export const CAPSULE_HEIGHT = 2 * (HALF + R);
const REST_Y = HALF + R;
const SP_A = new THREE.Vector3();
const SP_B = new THREE.Vector3();

function halfProfile(sign: 1 | -1): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [new THREE.Vector2(R, 0), new THREE.Vector2(R, sign * HALF)];
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI / 2;
    pts.push(new THREE.Vector2(R * Math.cos(a), sign * (HALF + R * Math.sin(a))));
  }
  return sign === 1 ? pts : pts.reverse();
}

const VERT_PARS = `varying vec3 vOP;\n`;
const FRAG_PARS = /* glsl */`
varying vec3 vOP;
uniform float uCrack, uStress, uLeakAmt, uPrism, uTimeC;
uniform vec3 uLeakCol, uSeedC;
${NOISE_GLSL}
vec2 whVoronoi(vec3 x) {
  vec3 p = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 b = vec3(float(i), float(j), float(k));
    vec3 r = b - f + whHash33(p + b);
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return vec2(sqrt(f1), sqrt(f2));
}
`;
const EMISSIVE = /* glsl */`
{
  vec3 cq = vOP * 8.0 + uSeedC;
  vec2 vor = whVoronoi(cq);
  float cedge = vor.y - vor.x;
  float spread = whNoise3(vOP * 3.1 + uSeedC);
  float pres = 1.0 - smoothstep(uCrack * 1.3 - 0.15, uCrack * 1.3 + 0.05, spread);
  float cw = mix(0.012, 0.07, uCrack);
  float cline = (1.0 - smoothstep(0.0, cw, cedge)) * pres;
  float sline = (1.0 - smoothstep(0.0, 0.018, cedge)) * uStress * smoothstep(0.5, 0.78, whNoise3(vOP * 5.0 + uSeedC));
  vec3 lc = uLeakCol;
  if (uPrism > 0.5) lc = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + whNoise3(cq * 0.6) + uTimeC * 0.08));
  totalEmissiveRadiance += lc * (cline * uLeakAmt * 3.4 + uLeakAmt * 0.1) + vec3(0.9, 0.92, 1.0) * sline * 0.3;
  totalDiffuse *= 1.0 - 0.35 * cline;
}
vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
`;

export interface CapsuleUniforms {
  uCrack: { value: number }; uStress: { value: number }; uLeakAmt: { value: number }; uPrism: { value: number }; uTimeC: { value: number };
  uLeakCol: { value: THREE.Color }; uSeedC: { value: THREE.Vector3 };
}

export class Capsule {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  /** World radius of the capsule (for hit testing / framing). */
  readonly radius = R;
  landed = false;
  gone = false;
  burstT = -1;
  private readonly u: CapsuleUniforms;
  private readonly top: THREE.Mesh;
  private readonly bottom: THREE.Mesh;
  private readonly wad: THREE.Mesh;
  private readonly geoTop: THREE.LatheGeometry;
  private readonly geoBottom: THREE.LatheGeometry;
  private readonly geoWad = new THREE.SphereGeometry(1, 20, 12);
  private readonly shellMat: THREE.MeshPhysicalMaterial;
  private readonly wadMat: THREE.MeshBasicMaterial;
  private readonly hub: EnvHub;
  readonly decals: Decals;
  private lowTier = false;
  // drop / wobble state
  private y = 2.6; private vy = 0; private bounces = 0;
  private rock = 0; private rockV = 0;
  private squeeze = 0;
  private time = 0;
  private onLand: (() => void) | null = null;
  // flight of the halves
  private readonly tv = new THREE.Vector3(); private readonly bv = new THREE.Vector3();
  private readonly tw = new THREE.Vector3(); private readonly bw = new THREE.Vector3();
  private readonly tp = new THREE.Vector3(); private readonly bp = new THREE.Vector3();
  private readonly fp: Footprint = { cx: 0, cz: 0, rx: R, rz: R, lowY: 0, compression: 0, stretch: 0 };
  private leak = 0;

  constructor(hub: EnvHub, quad: THREE.BufferGeometry, lowTier: boolean) {
    this.hub = hub;
    this.lowTier = lowTier;
    this.geoTop = new THREE.LatheGeometry(halfProfile(1), 36);
    this.geoBottom = new THREE.LatheGeometry(halfProfile(-1), 36);
    this.u = {
      uCrack: { value: 0 }, uStress: { value: 0 }, uLeakAmt: { value: 0 }, uPrism: { value: 0 }, uTimeC: { value: 0 },
      uLeakCol: { value: new THREE.Color(1, 0.8, 0.5) }, uSeedC: { value: new THREE.Vector3(3.1, 7.7, 1.3) },
    };
    this.shellMat = new THREE.MeshPhysicalMaterial({
      color: 0xe8ebfa, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.45, specularIntensity: 1,
      side: THREE.DoubleSide, fog: false,
    });
    hub.apply(this.shellMat, 1.3);
    this.applyTier(lowTier);
    const u = this.u;
    this.shellMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', EMISSIVE);
    };
    this.shellMat.customProgramCacheKey = () => 'wh-capsule-v1-' + (this.lowTier ? 'low' : 'full');
    this.top = new THREE.Mesh(this.geoTop, this.shellMat);
    this.bottom = new THREE.Mesh(this.geoBottom, this.shellMat);
    for (const m of [this.top, this.bottom]) { m.frustumCulled = false; m.renderOrder = 12; }
    // the neutral "wad" inside: a pale lavender glow, never the tier colour until the leak starts
    this.wadMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.5, 0.8), toneMapped: true, fog: false });
    this.wad = new THREE.Mesh(this.geoWad, this.wadMat);
    this.wad.scale.setScalar(0.125);
    this.wad.renderOrder = -20; this.wad.frustumCulled = false;
    this.decals = new Decals(quad);
    this.decals.setColor([0.6, 0.55, 0.9]);
    this.group.add(this.top, this.bottom, this.wad, this.decals.shadow, this.decals.pool);
    this.group.frustumCulled = false;
    this.group.visible = false;
  }

  /** Tier switch: full tier uses transmission, low tier is an alpha-blended milky shell. */
  applyTier(low: boolean): void {
    const m = this.shellMat;
    this.lowTier = low;
    if (low) { m.transmission = 0; m.transparent = true; m.opacity = 0.62; m.depthWrite = false; }
    else {
      m.transmission = 0.9; m.thickness = 0.16; m.attenuationColor = new THREE.Color(0xc9cff0); m.attenuationDistance = 0.75;
      m.transparent = false; m.opacity = 1; m.depthWrite = true;
    }
    m.needsUpdate = true;
  }

  /** Drop from above at table position (x, z). `landCb` fires on the first touchdown (haptic thump / landing sound). */
  drop(x: number, z: number, landCb?: () => void): void {
    this.pos.set(x, 0, z);
    this.y = 2.6; this.vy = 0; this.bounces = 0; this.landed = false; this.rock = 0; this.rockV = 0; this.onLand = landCb ?? null;
    this.group.visible = true; this.gone = false; this.burstT = -1;
    this.top.visible = this.bottom.visible = true;
  }
  /** Appear already standing (reveal without a prior drop). */
  placeStanding(x: number, z: number): void {
    this.pos.set(x, 0, z); this.y = REST_Y; this.vy = 0; this.landed = true; this.rock = 0; this.rockV = 0;
    this.group.visible = true; this.gone = false; this.burstT = -1;
  }
  slideTo(x: number, z: number, k: number): void { this.pos.x += (x - this.pos.x) * k; this.pos.z += (z - this.pos.z) * k; }

  setSqueeze(p: number): void { this.squeeze = Math.min(1, Math.max(0, p)); }
  /** Crack spread 0..1 and the tell: leak amount 0..1.5 with the tier colour (linear), prism = rainbow cracks. */
  setCrack(crack: number, leak: number, c: [number, number, number], prism: boolean): void {
    this.u.uCrack.value = crack; this.u.uLeakAmt.value = leak; this.leak = leak;
    this.u.uLeakCol.value.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
    this.u.uPrism.value = prism ? 1 : 0;
    this.wadMat.color.setRGB(0.55 + (c[0] * 1.2 - 0.55) * Math.min(1, leak), 0.5 + (c[1] * 1.2 - 0.5) * Math.min(1, leak), 0.8 + (c[2] * 1.2 - 0.8) * Math.min(1, leak), THREE.LinearSRGBColorSpace);
    this.decals.setColor([0.6 + (c[0] - 0.6) * Math.min(1, leak), 0.55 + (c[1] - 0.55) * Math.min(1, leak), 0.9 + (c[2] - 0.9) * Math.min(1, leak)]);
  }
  /** Shake it a little: the wobble spring takes a kick. */
  wobble(kick: number): void { this.rockV += kick; }

  /** The shell halves fly apart (B2). */
  burst(): void {
    this.burstT = 0;
    this.tp.set(0, 0, 0); this.bp.set(0, 0, 0);
    this.tv.set(0.75, 2.5, -0.5); this.bv.set(-0.55, 1.4, 0.4);
    this.tw.set(2.0, 3.2, -4.5); this.bw.set(-1.5, 2.0, 3.5);
    this.u.uStress.value = 0;
  }

  /** Remove the whole object at once (skip). */
  hide(): void { this.group.visible = false; this.gone = true; }

  /** Screen position (CSS px) and radius (CSS px) of the capsule centre, or null when it is not standing on the table. */
  screenPoint(camera: THREE.PerspectiveCamera, w: number, h: number, out: { x: number; y: number; r: number }): { x: number; y: number; r: number } | null {
    if (!this.group.visible || this.gone || this.burstT >= 0) return null;
    const v = SP_A.set(this.pos.x, REST_Y, this.pos.z).project(camera);
    const top = SP_B.set(this.pos.x, REST_Y + R, this.pos.z).project(camera);
    out.x = (v.x * 0.5 + 0.5) * w; out.y = (1 - (v.y * 0.5 + 0.5)) * h;
    out.r = Math.max(20, Math.abs((top.y - v.y) * 0.5 * h) * 1.35);
    return out;
  }

  update(dt: number, time: number): void {
    if (this.gone) return;
    this.time = time;
    this.u.uTimeC.value = time;
    // drop with two soft bounces, then a rocking wobble about the base
    if (!this.landed && this.burstT < 0) {
      this.vy -= 9.8 * dt;
      this.y += this.vy * dt;
      if (this.y <= REST_Y) {
        this.y = REST_Y;
        if (this.vy < -0.5 && this.bounces < 2) {
          const hit = -this.vy;
          this.vy = hit * 0.36; this.bounces++;
          this.rockV += (this.bounces === 1 ? 5.5 : 2.5) * (this.bounces % 2 ? 1 : -1);
          if (this.bounces === 1) { this.onLand?.(); this.onLand = null; }
        } else { this.vy = 0; this.landed = true; }
      }
    }
    // rocking: damped spring about the base (stronger damping while squeezed so it feels held)
    const k = 70, c = 2.4 + 6 * this.squeeze;
    this.rockV += (-k * this.rock - c * this.rockV) * dt;
    this.rock += this.rockV * dt;
    // squeeze: squash a little and rattle
    const sq = this.squeeze;
    const rattle = sq * sq * 0.05 * Math.sin(time * 58) ;
    const sy = 1 - 0.14 * sq, sxz = 1 + 0.07 * sq;
    this.u.uStress.value = this.burstT < 0 ? Math.min(1, sq * 1.4) * (this.u.uCrack.value < 0.05 ? 1 : 0.3) : 0;
    if (this.burstT < 0) {
      this.group.position.set(this.pos.x, this.y - REST_Y * (1 - sy), this.pos.z);
      this.group.rotation.set(rattle, 0, this.rock + rattle * 0.5);
      this.group.scale.set(sxz, sy, sxz);
      this.top.position.set(0, 0, 0); this.bottom.position.set(0, 0, 0);
      this.top.rotation.set(0, 0, 0); this.bottom.rotation.set(0, 0, 0);
      this.top.scale.setScalar(1); this.bottom.scale.setScalar(1);
      this.wad.position.set(0, 0, 0);
      this.wad.scale.setScalar(0.125 * (1 + 0.15 * Math.min(1, this.leak)));
    } else {
      // halves fly with gravity and spin, shrink away after ~1 s
      this.burstT += dt;
      this.group.rotation.set(0, 0, 0); this.group.scale.set(1, 1, 1);
      this.group.position.set(this.pos.x, REST_Y, this.pos.z);
      this.tv.y -= 9.8 * dt; this.bv.y -= 9.8 * dt;
      this.tp.addScaledVector(this.tv, dt); this.bp.addScaledVector(this.bv, dt);
      this.top.position.copy(this.tp); this.bottom.position.copy(this.bp);
      this.top.rotation.x += this.tw.x * dt; this.top.rotation.y += this.tw.y * dt; this.top.rotation.z += this.tw.z * dt;
      this.bottom.rotation.x += this.bw.x * dt; this.bottom.rotation.y += this.bw.y * dt; this.bottom.rotation.z += this.bw.z * dt;
      const s = Math.max(0, 1 - Math.max(0, this.burstT - 0.7) / 0.45);
      this.top.scale.setScalar(s); this.bottom.scale.setScalar(s);
      this.wad.scale.setScalar(Math.max(0, 0.125 * (1 - this.burstT * 4)));
      if (this.burstT > 1.2) { this.gone = true; this.group.visible = false; }
    }
    // decals under it
    this.fp.cx = this.pos.x; this.fp.cz = this.pos.z; this.fp.lowY = Math.max(0, this.y - REST_Y);
    this.fp.compression = this.squeeze * 0.4;
    this.decals.update(dt, time, this.fp, 0, null, true, this.burstT < 0 ? Math.min(1, this.leak) * 1.1 : Math.max(0, 1 - this.burstT * 2));
    this.decals.pool.visible = this.decals.pool.visible && this.leak > 0.02;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geoTop.dispose(); this.geoBottom.dispose(); this.geoWad.dispose();
    this.hub.release(this.shellMat);
    this.shellMat.dispose(); this.wadMat.dispose(); this.decals.dispose();
  }
}

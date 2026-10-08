// GENESIS — the night sky (CONTRACT.md §15.3): thousands of procedural stars with blackbody colours and a
// magnitude distribution (many faint, few bright), a Milky Way band with dust lanes and a bright bulge, and faint
// emission nebulae. Drawn first, at "infinity" (camera-centred, no depth writes), in HDR so it only shows when the
// exposure opens up: in space, on the night side, at dusk.

import {
  AdditiveBlending, BackSide, BufferGeometry, Float32BufferAttribute, Group, Mesh, Points, ShaderMaterial, SphereGeometry,
  Vector3,
} from 'three';
import { Rng } from '../../sim/core/rng.ts';
import { blackbody } from '../../client/orbits.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';

const SKY_R = 1.2e7;

const STARS_VERT = /* glsl */ `
attribute float aMag;
attribute vec3 aColor;
uniform float uPixelRatio;
uniform float uTwinkle;
varying vec3 vColor;
varying float vBright;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
  float b = pow(2.512, -aMag);
  vBright = b;
  vColor = aColor;
  gl_PointSize = clamp((1.6 + sqrt(b) * 5.5) * uPixelRatio, 1.0, 9.0);
}
`;
const STARS_FRAG = /* glsl */ `
uniform float uIntensity;
varying vec3 vColor;
varying float vBright;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float core = exp(-r2 * 7.0);
  float halo = exp(-r2 * 2.0) * 0.15;
  gl_FragColor = vec4(vColor * vBright * (core + halo) * uIntensity, 1.0);
}
`;

const BAND_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
}
`;
const BAND_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform vec3 uGalN;
uniform vec3 uCore;
uniform float uIntensity;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float lat = dot(d, uGalN);
  float coreD = max(dot(d, uCore), 0.0);
  float n = fbm3(d * 3.0) * 0.5 + 0.5;
  float fine = fbm3(d * 14.0 + 3.0) * 0.5 + 0.5;
  float width = 0.13 + 0.08 * n + 0.1 * pow(coreD, 6.0);
  float band = exp(-lat * lat / (width * width));
  float bulge = pow(coreD, 10.0) * exp(-lat * lat / 0.05);
  // dust lanes: dark filaments along the plane
  float dust = smoothstep(0.45, 0.75, fbm3(d * 7.0 + vec3(5.0)) * 0.5 + 0.5) * exp(-lat * lat / 0.004);
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.82, 0.62), clamp(coreD * 1.2, 0.0, 1.0));
  float I = band * (0.25 + 0.75 * n * fine) * (1.0 - dust * 0.85) + bulge * 1.8;
  // faint emission / reflection nebulae
  float neb1 = smoothstep(0.62, 0.9, fbm3(d * 4.0 + vec3(11.0, 2.0, 7.0)) * 0.5 + 0.5);
  float neb2 = smoothstep(0.66, 0.92, fbm3(d * 5.0 + vec3(-3.0, 8.0, 1.0)) * 0.5 + 0.5);
  vec3 neb = vec3(0.9, 0.25, 0.35) * neb1 * (0.4 + band) + vec3(0.2, 0.45, 0.9) * neb2 * 0.6;
  gl_FragColor = vec4((col * I + neb * 0.25) * uIntensity, 1.0);
}
`;

export class Starfield {
  readonly group = new Group();
  private starMat: ShaderMaterial;
  private bandMat: ShaderMaterial;

  constructor(seed = 7, count = 9000) {
    const rng = new Rng(seed);
    const pos = new Float32Array(count * 3);
    const mag = new Float32Array(count);
    const col = new Float32Array(count * 3);
    const galN = new Vector3(0.18, 0.86, 0.47).normalize();
    for (let i = 0; i < count; i++) {
      // concentrate ~45 % of stars toward the galactic plane
      let x = rng.gauss(), y = rng.gauss(), z = rng.gauss();
      const v = new Vector3(x, y, z).normalize();
      if (rng.chance(0.45)) {
        const d = v.dot(galN);
        v.addScaledVector(galN, -d * 0.85).normalize();
      }
      x = v.x; y = v.y; z = v.z;
      pos[i * 3] = x * SKY_R; pos[i * 3 + 1] = y * SKY_R; pos[i * 3 + 2] = z * SKY_R;
      // magnitude: exponential number counts (many faint stars)
      const m = -1.4 + 7.4 * Math.pow(rng.float(), 0.42);
      mag[i] = m;
      // temperature distribution: mostly K/M/G, some hot blue
      const t = rng.chance(0.12) ? rng.range(9000, 25000) : rng.range(3000, 7500);
      const c = blackbody(t);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aMag', new Float32BufferAttribute(mag, 1));
    g.setAttribute('aColor', new Float32BufferAttribute(col, 3));
    this.starMat = new ShaderMaterial({
      vertexShader: STARS_VERT, fragmentShader: STARS_FRAG,
      uniforms: { uPixelRatio: { value: 1 }, uTwinkle: { value: 0 }, uIntensity: { value: 0.2 } },
      // opaque queue (drawn first by renderOrder) with additive blending: everything else draws over the sky
      depthTest: false, depthWrite: false, blending: AdditiveBlending, transparent: false,
    });
    const pts = new Points(g, this.starMat);
    pts.frustumCulled = false;
    pts.renderOrder = -999;
    this.bandMat = new ShaderMaterial({
      vertexShader: BAND_VERT, fragmentShader: BAND_FRAG,
      uniforms: { uGalN: { value: galN }, uCore: { value: new Vector3(0.9, -0.2, -0.38).normalize() }, uIntensity: { value: 0.006 } },
      side: BackSide, depthTest: false, depthWrite: false,
    });
    const band = new Mesh(new SphereGeometry(SKY_R * 1.05, 64, 32), this.bandMat);
    band.frustumCulled = false;
    band.renderOrder = -1000;
    this.group.add(band, pts);
  }

  setPixelRatio(pr: number): void {
    this.starMat.uniforms.uPixelRatio.value = pr;
  }
}

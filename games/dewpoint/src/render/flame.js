// Fire that looks like fire, for the price of one draw call.
//
// Every flame in a level - Cinder's own, a brazier's, a lantern's, a burning plank's, a fuse's, the
// kiln fire under a gap, the roar in the exit's mouth - is one instance of the same upright
// billboard, and its whole life is in the fragment shader:
//   - a teardrop silhouette that sways and whose edge breaks into tongues, both climbing, both
//     growing toward the tip, so the flame LICKS upward instead of wobbling in place;
//   - flat cel bands from the inside out - white-yellow heart, yellow, orange, and a deep red rim
//     that is the flame's own outline (fire is never inked in black);
//   - the bands thin out with height, so the heart sits low and the tips are red;
//   - the tip is sheared back by `lean` (set from the owner's velocity), so a moving flame trails.
// No textures, no extra lights, no shadows, nothing to sort (it draws after the inked scene).
// Sparks, embers and smoke are particles; heat shimmer is a ripple in the ink pass; the light a
// fire throws on the floor is the baked FX mesh or the hero's one point light.

import * as THREE from '../../vendor/three.module.min.js';

/** Palettes: rim, outer, middle, heart (linear rgb). */
export const FLAME = { fire: 0, hot: 1, gas: 2, spark: 3, pilot: 4 };
const PALETTES = [
  [[0.62, 0.05, 0.02], [1.0, 0.32, 0.04], [1.0, 0.72, 0.12], [1.0, 0.96, 0.7]],      // fire
  [[0.78, 0.09, 0.02], [1.0, 0.42, 0.05], [1.0, 0.82, 0.2], [1.0, 1.0, 0.86]],       // hot: Cinder ablaze, a roaring brazier
  [[0.1, 0.4, 0.12], [0.42, 0.85, 0.16], [0.86, 1.0, 0.36], [1.0, 1.0, 0.8]],        // gas: sour green
  [[1.0, 0.56, 0.08], [1.0, 0.82, 0.24], [1.0, 0.95, 0.6], [1.0, 1.0, 0.95]],        // spark: white gold
  [[0.06, 0.2, 0.7], [0.2, 0.55, 1.0], [0.6, 0.86, 1.0], [0.95, 1.0, 1.0]],          // pilot: a blue flame
];

const VERT = /* glsl */`
  attribute vec3 aPos;
  attribute vec4 aWH;       // width, height, seed, palette
  attribute vec4 aLean;     // lean x, lean z (metres at the tip per metre of height), size 0..1, heart 0..1
  uniform vec2 uFogNF;
  varying vec2 vQ;
  varying vec4 vP;
  varying float vFog;
  void main() {
    float k = aLean.z;
    vec2 size = aWH.xy * vec2(0.55 + 0.45 * k, k);
    vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    vec3 p = aPos + right * (position.x * size.x) + vec3(0.0, position.y * size.y, 0.0);
    p.xz += aLean.xy * (position.y * position.y) * size.y;
    vQ = vec2(position.x * 2.0, position.y);
    vP = vec4(aWH.z, aWH.w, aLean.w, k);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vFog = 1.0 - 0.85 * smoothstep(uFogNF.x, uFogNF.y, -mv.z);      // a far fire dims into the haze, but is never quite lost
    // right up against the camera a flame would be a wall of yellow across the picture: it thins to a veil instead
    vFog *= mix(0.28, 1.0, smoothstep(0.9, 3.2, -mv.z));
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform float uSolid;
  uniform float uStill;       // reduced motion: 1 slows the licking right down
  uniform vec3 uPal[20];
  varying vec2 vQ;
  varying vec4 vP;
  varying float vFog;
  void main() {
    float seed = vP.x, t = uTime * mix(1.0, 0.25, uStill);
    float x = vQ.x, y = vQ.y;
    // the body sways, more toward the tip, and the sway climbs
    x += (sin(y * 5.0 - t * 6.3 + seed) * 0.17 + sin(y * 11.0 - t * 10.1 + seed * 1.7) * 0.07) * y;
    // a teardrop: round at the foot, drawn up to a point
    float w = 0.9 * sqrt(clamp(y * 7.0, 0.0, 1.0)) * pow(max(1.0 - y, 0.0), 0.66);
    // tongues: the edge breaks into lobes that rise
    float tongues = sin(x * 6.5 + seed * 3.0 + sin(t * 1.7 + seed) * 1.2) * sin(y * 8.5 - t * 8.0 + seed) * 0.15
                  + sin(x * 13.0 - seed) * sin(y * 15.0 - t * 12.0 + seed * 2.0) * 0.05;
    float f = w - abs(x) + tongues * smoothstep(0.12, 0.6, y);
    float aa = max(fwidth(f), 0.004);
    float a = smoothstep(0.0, aa, f) * vFog;
    if (a < 0.01) discard;
    int k = int(vP.y + 0.5) * 4;
    vec3 col = uPal[k];
    col = mix(col, uPal[k + 1], smoothstep(0.06 - aa, 0.06 + aa, f));
    col = mix(col, uPal[k + 2], smoothstep(0.2 + 0.24 * y - aa, 0.2 + 0.24 * y + aa, f));
    float heart = 0.37 + 0.55 * y - 0.14 * vP.z;
    col = mix(col, uPal[k + 3], smoothstep(heart - aa, heart + aa, f));
    gl_FragColor = vec4(col * a, a * uSolid);
    #include <colorspace_fragment>
  }`;

export class Flames {
  constructor(max = 200) {
    this.max = max; this.items = [];
    this.minor = true;           // quality: draw the flames marked `minor` too
    this.pos = new Float32Array(max * 3); this.wh = new Float32Array(max * 4); this.lean = new Float32Array(max * 4);
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    g.index = q.index; g.attributes.position = q.attributes.position;
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aWH', new THREE.InstancedBufferAttribute(this.wh, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLean', new THREE.InstancedBufferAttribute(this.lean, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    this.uniforms = { uTime: { value: 0 }, uSolid: { value: 0.8 }, uStill: { value: 0 }, uFogNF: { value: new THREE.Vector2(30, 96) }, uPal: { value: PALETTES.flat().map((c) => new THREE.Vector3(c[0], c[1], c[2])) } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide, toneMapped: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 17;
    this.keep = 0;               // the first `keep` items survive clear() (the heroes' own flames)
  }

  /**
   * A flame standing at (x, y, z) - its foot - w wide and h tall at full size. Returns a handle to
   * mutate: { x, y, z, w, h, k (size 0..1; 0 hides it), lx, lz (lean), kind, heart (0..1), minor }.
   */
  add(x, y, z, w, h, kind = FLAME.fire, o = {}) {
    const f = { x, y, z, w, h, k: o.k === undefined ? 1 : o.k, lx: 0, lz: 0, kind, heart: o.heart === undefined ? 0.5 : o.heart, seed: o.seed === undefined ? this.items.length * 2.39996 : o.seed, minor: !!o.minor };
    if (this.items.length < this.max) this.items.push(f);
    return f;
  }

  /** Call when the flames added so far belong to something that outlives levels (a hero). */
  pin() { this.keep = this.items.length; }
  clear() { this.items.length = this.keep; }

  update(time, still = false) {
    let n = 0;
    const P = this.pos, W = this.wh, L = this.lean;
    for (const f of this.items) {
      if (!(f.k > 0.01) || (f.minor && !this.minor)) continue;
      P[n * 3] = f.x; P[n * 3 + 1] = f.y; P[n * 3 + 2] = f.z;
      W[n * 4] = f.w; W[n * 4 + 1] = f.h; W[n * 4 + 2] = f.seed; W[n * 4 + 3] = f.kind;
      L[n * 4] = f.lx; L[n * 4 + 1] = f.lz; L[n * 4 + 2] = Math.min(1.6, f.k); L[n * 4 + 3] = f.heart;
      n++;
    }
    this.geo.instanceCount = n;
    this.count = n;
    const a = this.geo.attributes;
    a.aPos.needsUpdate = true; a.aWH.needsUpdate = true; a.aLean.needsUpdate = true;
    this.uniforms.uTime.value = time; this.uniforms.uStill.value = still ? 1 : 0;
    this.mesh.visible = n > 0;
  }
}

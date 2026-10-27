// GENESIS — the marks the signs are drawn with (LIVING §3.4, hook H4; render/signs/signs.ts): threads of light standing
// up from a person or a holy place, glints — soft points of light with a faint four-way flare — and ripples, rings of
// light on a holy spring's water. All are rebuilt on the CPU each frame from the few signs alive (a world has at most
// six prophets and a handful of sacred places), drawn over the composited image in the FX layer with ONE-ONE light,
// soft-tested against the scene's depth so a hill or a house in front hides them. Display-referred (they read the same by day and by night, as the god's own marks should).

import {
  BufferAttribute, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  ShaderMaterial, Vector3, type IUniform,
} from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ADD_LIGHT, FX_DEPTH_GLSL, FX_LAYER } from '../fx/fxcommon.ts';

/** samples up a beam (its fade and shimmer need a few) */
const BEAM_S = 10;

const BEAM_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
attribute vec4 aCol;     // rgb, intensity
attribute float aSeed;
varying float vT;
varying float vSide;
varying float vZ;
varying vec4 vCol;
varying float vSeed;
void main() {
  vT = aT; vSide = aSide; vCol = aCol; vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
varying float vT;
varying float vSide;
varying float vZ;
varying vec4 vCol;
varying float vSeed;
void main() {
  if (vCol.a <= 0.0) discard;
  float vis = fxSoft(vZ, 2.0);
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  // a thread of light: a fine bright core in a soft glow, never a tube's edge
  float core = exp(-x * x * 40.0), glow = exp(-x * x * 5.0) * (1.0 - smoothstep(0.75, 1.0, x));
  // rising from its foot, thinning away upward; light climbing it in slow pulses
  float along = smoothstep(0.0, 0.06, vT) * pow(1.0 - vT, 1.6);
  float climb = 0.7 + 0.3 * snoise(vec3(vT * 6.0 - uFxTime * 0.9, vSeed, 0.5));
  // (kept below the tone curve's shoulder and deepened toward its heart: brighter, a prophet's warm thread burned to
  // a white wire and every sign's colour was lost)
  float k = (core * 1.05 + glow * 0.5) * along * climb;
  vec3 col = mix(vCol.rgb, vCol.rgb * vCol.rgb, 0.4 * core);
  gl_FragColor = vec4(col * k * vCol.a * vis * fxDisplay(0.85), 0.0);
}
`;

const GLINT_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 iP;       // position (body m), size (m)
attribute vec4 iC;       // rgb, intensity
varying vec2 vC;
varying vec4 vCol;
varying float vZ;
varying float vSoft;
void main() {
  vC = corner; vCol = iC;
  vec4 mv = modelViewMatrix * vec4(iP.xyz, 1.0);
  mv.xy += corner * iP.w;
  vZ = -mv.z;
  vSoft = iP.w;
  gl_Position = iC.a <= 0.0 ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * mv;
}
`;
const GLINT_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
varying vec2 vC;
varying vec4 vCol;
varying float vZ;
varying float vSoft;
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  float vis = fxSoft(vZ, vSoft);
  if (vis <= 0.0) discard;
  // a soft point with a faint four-way flare (the eye's own star), fading at the quad's edge
  float pt = exp(-r * r * 24.0) * 1.6 + exp(-r * r * 5.0) * 0.25;
  float flare = (exp(-abs(vC.x) * 26.0) * exp(-vC.y * vC.y * 3.0) + exp(-abs(vC.y) * 26.0) * exp(-vC.x * vC.x * 3.0)) * 0.35;
  float k = (pt + flare) * (1.0 - smoothstep(0.7, 1.0, r));
  gl_FragColor = vec4(vCol.rgb * k * vCol.a * vis * fxDisplay(0.85), 0.0);
}
`;

// ripples: flat rings of light lying on a water surface (a holy spring's). Ground decals draw before the water and
// are hidden under it; these draw after it, over the composited image
const RIPPLE_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 iP;       // centre (body m), radius (m)
attribute vec4 iC;       // rgb, intensity
attribute float iW;      // the ring's width (m)
varying vec2 vQ;
varying vec4 vCol;
varying float vR;
varying float vW;
varying float vZ;
void main() {
  vCol = iC; vR = iP.w; vW = iW;
  vec3 up = normalize(iP.xyz);
  vec3 e1 = normalize(cross(abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), up));
  vec3 e2 = cross(up, e1);
  float ext = iP.w + iW * 2.5;
  vQ = corner * ext;
  vec3 p = iP.xyz + (e1 * corner.x + e2 * corner.y) * ext;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = iC.a <= 0.0 ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * mv;
}
`;
const RIPPLE_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
varying vec2 vQ;
varying vec4 vCol;
varying float vR;
varying float vW;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, max(0.3, vW));
  if (vis <= 0.0) discard;
  float r = length(vQ);
  float k = exp(-pow((r - vR) / max(vW, 1e-3), 2.0));
  if (k < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * k * vCol.a * vis * fxDisplay(0.8), 0.0);
}
`;

const _a = new Vector3(), _b = new Vector3(), _d = new Vector3(), _s = new Vector3();

/** threads of light: up to `cap` beams, each from a foot point up a direction for a length */
export class Beams {
  readonly mesh: Mesh;
  private geo = new BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private seed: Float32Array;
  private n = 0;
  readonly cap: number;
  /** a multiplier on every beam added this frame (signs.ts fades the threads out from orbit, where a thread hundreds of
   *  metres long stood off the limb into space like a scratch on the view) */
  scale = 1;

  constructor(fx: Record<string, IUniform>, cap = 48) {
    this.cap = cap;
    const v = cap * BEAM_S * 2;
    this.pos = new Float32Array(v * 3);
    this.col = new Float32Array(v * 4);
    this.seed = new Float32Array(v);
    const t = new Float32Array(v), side = new Float32Array(v);
    const idx: number[] = [];
    for (let b = 0; b < cap; b++) for (let i = 0; i < BEAM_S; i++) {
      const k = (b * BEAM_S + i) * 2;
      t[k] = t[k + 1] = i / (BEAM_S - 1); side[k] = 1; side[k + 1] = -1;
      if (i < BEAM_S - 1) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(35048));
    this.geo.setAttribute('aCol', new BufferAttribute(this.col, 4).setUsage(35048));
    this.geo.setAttribute('aSeed', new BufferAttribute(this.seed, 1));
    this.geo.setAttribute('aT', new BufferAttribute(t, 1));
    this.geo.setAttribute('aSide', new BufferAttribute(side, 1));
    this.geo.setIndex(idx);
    const mat = new ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: { ...fx }, transparent: true, depthTest: false, depthWrite: false,
      side: DoubleSide, ...ADD_LIGHT,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(FX_LAYER); this.mesh.renderOrder = 20;
  }

  begin(): void { this.n = 0; }

  /**
   * a beam from `foot` (body m) along unit `dir` for `len` m, `w` m wide (half-width of its glow), colour and intensity;
   * camera-facing round its own axis
   */
  add(foot: Vector3, dir: Vector3, len: number, w: number, r: number, g: number, b: number, k: number, cam: Vector3, seed = 0): void {
    k *= this.scale;
    if (this.n >= this.cap || k <= 0.001 || len <= 0) return;
    const bi = this.n++;
    const view = _d.copy(cam).sub(foot);
    const side = _s.crossVectors(dir, view);
    const sl = side.length();
    if (sl < 1e-6) side.set(1, 0, 0).cross(dir);
    side.normalize();
    for (let i = 0; i < BEAM_S; i++) {
      const t = i / (BEAM_S - 1);
      const p = _a.copy(foot).addScaledVector(dir, len * t);
      // (a far thread keeps two or three pixels of width)
      const ww = Math.max(w, p.distanceTo(cam) * 0.0022);
      const k0 = (bi * BEAM_S + i) * 2;
      for (let s = 0; s < 2; s++) {
        const q = _b.copy(p).addScaledVector(side, s === 0 ? ww : -ww);
        this.pos[(k0 + s) * 3] = q.x; this.pos[(k0 + s) * 3 + 1] = q.y; this.pos[(k0 + s) * 3 + 2] = q.z;
        this.col[(k0 + s) * 4] = r; this.col[(k0 + s) * 4 + 1] = g; this.col[(k0 + s) * 4 + 2] = b; this.col[(k0 + s) * 4 + 3] = k;
        this.seed[k0 + s] = seed;
      }
    }
  }

  end(): void {
    // (only the beams added this frame are drawn: the draw range ends at them)
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    for (const a of ['position', 'aCol', 'aSeed']) (this.geo.getAttribute(a) as BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, this.n * (BEAM_S - 1) * 6);
  }

  get count(): number { return this.n; }

  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

/** glints: up to `cap` soft points of light */
export class Glints {
  readonly mesh: Mesh;
  private geo = new InstancedBufferGeometry();
  private p: Float32Array;
  private c: Float32Array;
  private n = 0;
  readonly cap: number;

  constructor(fx: Record<string, IUniform>, cap = 256) {
    this.cap = cap;
    this.p = new Float32Array(cap * 4);
    this.c = new Float32Array(cap * 4);
    this.geo.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo.setAttribute('iP', new InstancedBufferAttribute(this.p, 4).setUsage(35048));
    this.geo.setAttribute('iC', new InstancedBufferAttribute(this.c, 4).setUsage(35048));
    this.geo.instanceCount = 0;
    const mat = new ShaderMaterial({
      vertexShader: GLINT_VERT, fragmentShader: GLINT_FRAG, uniforms: { ...fx }, transparent: true, depthTest: false, depthWrite: false, ...ADD_LIGHT,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(FX_LAYER); this.mesh.renderOrder = 21;
  }

  begin(): void { this.n = 0; }

  /** a glint at body point (x, y, z), `size` m, colour, intensity */
  add(x: number, y: number, z: number, size: number, r: number, g: number, b: number, k: number): void {
    if (this.n >= this.cap || k <= 0.001) return;
    const i = this.n++ * 4;
    this.p[i] = x; this.p[i + 1] = y; this.p[i + 2] = z; this.p[i + 3] = size;
    this.c[i] = r; this.c[i + 1] = g; this.c[i + 2] = b; this.c[i + 3] = k;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    for (const a of ['iP', 'iC']) {
      const at = this.geo.getAttribute(a) as InstancedBufferAttribute;
      at.clearUpdateRanges(); at.addUpdateRange(0, this.n * 4); at.needsUpdate = true;
    }
  }

  get count(): number { return this.n; }

  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

/** ripples: up to `cap` flat rings of light on water */
export class Ripples {
  readonly mesh: Mesh;
  private geo = new InstancedBufferGeometry();
  private p: Float32Array;
  private c: Float32Array;
  private w: Float32Array;
  private n = 0;
  readonly cap: number;

  constructor(fx: Record<string, IUniform>, cap = 32) {
    this.cap = cap;
    this.p = new Float32Array(cap * 4);
    this.c = new Float32Array(cap * 4);
    this.w = new Float32Array(cap);
    this.geo.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo.setAttribute('iP', new InstancedBufferAttribute(this.p, 4).setUsage(35048));
    this.geo.setAttribute('iC', new InstancedBufferAttribute(this.c, 4).setUsage(35048));
    this.geo.setAttribute('iW', new InstancedBufferAttribute(this.w, 1).setUsage(35048));
    this.geo.instanceCount = 0;
    const mat = new ShaderMaterial({
      vertexShader: RIPPLE_VERT, fragmentShader: RIPPLE_FRAG, uniforms: { ...fx }, transparent: true, depthTest: false, depthWrite: false,
      side: DoubleSide, ...ADD_LIGHT,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(FX_LAYER); this.mesh.renderOrder = 19;
  }

  begin(): void { this.n = 0; }

  /** a ring of radius `r` m and width `w` m round body point (x, y, z) on the water, colour and intensity */
  add(x: number, y: number, z: number, r: number, w: number, cr: number, cg: number, cb: number, k: number): void {
    if (this.n >= this.cap || k <= 0.001 || r <= 0) return;
    const j = this.n++, i = j * 4;
    this.p[i] = x; this.p[i + 1] = y; this.p[i + 2] = z; this.p[i + 3] = r;
    this.c[i] = cr; this.c[i + 1] = cg; this.c[i + 2] = cb; this.c[i + 3] = k;
    this.w[j] = w;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    for (const [a, n] of [['iP', 4], ['iC', 4], ['iW', 1]] as [string, number][]) {
      const at = this.geo.getAttribute(a) as InstancedBufferAttribute;
      at.clearUpdateRanges(); at.addUpdateRange(0, this.n * n); at.needsUpdate = true;
    }
  }

  get count(): number { return this.n; }

  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

/** all three, in one group */
export class Marks {
  readonly group = new Group();
  readonly beams: Beams;
  readonly glints: Glints;
  readonly ripples: Ripples;
  constructor(fx: Record<string, IUniform>) {
    this.group.name = 'sign-marks';
    this.group.matrixAutoUpdate = false;
    this.beams = new Beams(fx);
    this.glints = new Glints(fx);
    this.ripples = new Ripples(fx);
    this.group.add(this.beams.mesh, this.glints.mesh, this.ripples.mesh);
  }
  begin(): void { this.beams.begin(); this.glints.begin(); this.ripples.begin(); }
  end(): void { this.beams.end(); this.glints.end(); this.ripples.end(); }
  dispose(): void { this.beams.dispose(); this.glints.dispose(); this.ripples.dispose(); }
}

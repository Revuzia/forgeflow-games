// GENESIS — a sigil, landing (LIVING §3.6 "Sigils", hook H8; render/fx/sigils.ts). When a miracle lands its glyph is
// written on the land in light where it falls: the stroke traced across the ground at the miracle's own size (its
// radius, within reach of the eye), a bright head running along it, then the whole glyph glowing and fading as the
// miracle's own effect takes over (render/fx/miracles.ts). The Touch traces the same glyph in the air as it casts
// (render/hand.ts). The glyph is the power's `sigil` (sigilOfMiracle), drawn upright for the eye that watches: its
// "up" is the camera's forward laid on the ground. Draped on the terrain (the ground's own height function) — or on
// the water, where it falls on a lake or the sea — in the FX layer over the composited image, soft-tested against the
// scene's depth with a slack that grows with distance (a house or a tree in the way hides it; the coarser far terrain
// does not cut it into dashes). A line of the Touch's light deepened at its heart, the land pressed dark round it, so
// its colour survives on sunlit ground.

import { BufferAttribute, CustomBlending, DoubleSide, Group, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector3, ZeroFactor, type IUniform } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { stripGeometry } from '../gen/handgen.ts';
import { DECAL, decal, type DecalPass } from './decals.ts';
import { FX_DEPTH_GLSL, FX_LAYER, clamp01, smooth } from './fxcommon.ts';
import { sigilOfMiracle, sigilStroke } from './sigils.ts';

const N = 128;
/** glyphs written at once (more grow on demand up to MAX_POOL: a board of every sigil for a picture) */
const POOL = 4;
const MAX_POOL = 16;
/** the life of a landed sigil (s): traced, held, faded */
const TRACE = 1.1, LIFE = 4.2;

const VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  vT = aT; vSide = aSide;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
uniform vec3 uCol;
uniform float uTrace;
uniform float uK;
uniform float uSoft;
uniform float uBias;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  // (the land under the glyph may lie a little above the terrain's own height function where the terrain is drawn
  // coarser far away: tested against the scene's depth with a bias that grows with distance — tested exactly, a glyph
  // seen from the god's height broke into dashes wherever the drawn ground stood over it — so only a thing standing
  // well in front of it, a house, a tree, a hill, hides it)
  float vis = clamp((fxSceneZ() + uBias - vZ) / max(uSoft, 1e-3), 0.0, 1.0);
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  // a line of light in a soft glow (the line some two fifths of the strip wide: the rest is its glow and the shadow
  // pressed round it)
  float core = exp(-x * x * 11.0), halo = exp(-x * x * 3.2) * (1.0 - smoothstep(0.8, 1.0, x));
  float drawn = 1.0 - smoothstep(uTrace - 0.003, uTrace + 0.003, vT);
  float head = exp(-pow((vT - uTrace) / 0.02, 2.0)) * (1.0 - step(0.999, uTrace));
  // (kept below the tone curve's shoulder: brighter, the gold burned to a white thread on sunlit ground)
  // (nearly display-referred, so it reads alike by day and in the dusk, when the view's exposure opens up)
  float k = (core * 0.62 + halo * 0.26) * drawn + head * (core * 1.9 + halo * 0.52);
  // the land under the stroke pressed dark, as if the glyph were burned into it, most under the line itself: on snow,
  // sand, a ripe field or the sea the glyph keeps its edge and its colour
  float press = clamp(core * 0.62 + halo * 0.34, 0.0, 0.8) * (1.0 - smoothstep(0.85, 1.0, x)) * max(drawn, head);
  // (its colour deepened toward the line's heart, a white-hot point only at the running head)
  vec3 col = mix(uCol, uCol * uCol, 0.35 * core) + vec3(1.0) * 0.3 * head * core;
  gl_FragColor = vec4(col * k * uK * vis * fxDisplay(0.92), press * uK * vis);
}
`;

interface Landed { mesh: Mesh; mat: ShaderMaterial; t0: number; c: Vector3; R: number; col: Vector3; live: boolean }

const _e = new Vector3(), _u = new Vector3(), _p = new Vector3(), _f = new Vector3();

export class SigilMarks {
  readonly group = new Group();
  /** captures: hold every written glyph at this age (s) — traced and glowing — instead of real time; null runs */
  hold: number | null = null;
  private pool: Landed[] = [];
  private fx: Record<string, IUniform>;

  constructor(fx: Record<string, IUniform>) {
    this.fx = fx;
    this.group.name = 'sigil-marks';
    this.group.matrixAutoUpdate = false;
    for (let i = 0; i < POOL; i++) this.grow();
  }

  private grow(): Landed {
    const geo = stripGeometry(N);
    const mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
      // light added over the land, which its alpha darkens a little first (premultiplied over; the target's alpha kept)
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
      uniforms: { ...this.fx, uCol: { value: new Vector3(1, 0.85, 0.5) }, uTrace: { value: 0 }, uK: { value: 0 }, uSoft: { value: 2 }, uBias: { value: 0.5 } },
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.layers.set(FX_LAYER); mesh.renderOrder = 12; mesh.visible = false;
    this.group.add(mesh);
    const l: Landed = { mesh, mat, t0: -1e9, c: new Vector3(), R: 10, col: new Vector3(), live: false };
    this.pool.push(l);
    return l;
  }

  /**
   * a miracle of `kind` landed at body point `c` with radius `radius` (m): write its sigil there in `light` (the Touch's
   * colour), upright for a camera looking along `camFwd`, at real time `t`
   */
  land(pv: PlanetView, kind: string, c: Vector3, radius: number, light: { r: number; g: number; b: number }, camBody: Vector3, camFwd: Vector3, t: number): void {
    const slot = this.pool.find((s) => !s.live) ?? (this.pool.length < MAX_POOL ? this.grow() : this.pool.reduce((a, b) => (a.t0 < b.t0 ? a : b)));
    slot.live = true;
    slot.t0 = t;
    slot.c.copy(c);
    // its size: the miracle's own, but within reach of the eye (a lightning sigil's 30 m reads; a calm's 500 m is cut)
    const dist = c.distanceTo(camBody);
    slot.R = Math.max(10, Math.min(Math.max(radius * 0.6, 14), 220, Math.max(18, dist * 0.22)));
    slot.col.set(light.r, light.g, light.b);
    slot.mat.uniforms.uCol.value.copy(slot.col);
    slot.mat.uniforms.uSoft.value = Math.max(1.5, slot.R * 0.05);
    // (the depth test's slack: the drawn terrain's error grows with distance — about a metre at 80 m, ten at 800 m)
    slot.mat.uniforms.uBias.value = Math.max(0.5, dist * 0.012);
    // the glyph's frame on the ground: up = the camera's forward laid flat (else north)
    const up = _u.copy(c).normalize();
    const fw = _f.copy(camFwd).addScaledVector(up, -camFwd.dot(up));
    if (fw.lengthSq() < 1e-6) fw.set(0, 1, 0).addScaledVector(up, -up.y);
    fw.normalize();
    const right = _e.crossVectors(fw, up).normalize();
    const st = sigilStroke(sigilOfMiracle(kind), N);
    const pos = slot.mesh.geometry.getAttribute('position') as BufferAttribute;
    const R = slot.R;
    // (half the strip's width: the line, its glow and its pressed shadow — the line some four or five pixels wide at any
    // distance; thinner, it read as a faint white thread on sunlit ground from the god's height)
    const w = Math.max(R * 0.06, dist * 0.0085);
    const lift = Math.max(0.6, R * 0.015);
    for (let i = 0; i < N; i++) {
      const j0 = Math.max(0, i - 1), j1 = Math.min(N - 1, i + 1);
      const sx = st[i * 2], sy = st[i * 2 + 1];
      const tx = st[j1 * 2] - st[j0 * 2], ty = st[j1 * 2 + 1] - st[j0 * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      const ox = -ty / tl, oy = tx / tl;
      for (let s = 0; s < 2; s++) {
        const sg = s === 0 ? 1 : -1;
        _p.copy(c).addScaledVector(right, (sx + ox * sg * w / R) * R).addScaledVector(fw, (sy + oy * sg * w / R) * R).normalize();
        const g = landTop(pv, _p) + lift;
        pos.setXYZ(i * 2 + s, _p.x * g, _p.y * g, _p.z * g);
      }
    }
    pos.needsUpdate = true;
  }

  update(t: number, decals: DecalPass): void {
    for (const s of this.pool) {
      if (!s.live) { s.mesh.visible = false; continue; }
      const age = this.hold ?? t - s.t0;
      if (age > LIFE || age < 0) { s.live = false; s.mesh.visible = false; continue; }
      s.mesh.visible = true;
      s.mat.uniforms.uTrace.value = smooth(0, TRACE, age);
      const k = smooth(0, 0.12, age) * (1 - smooth(TRACE + 1.2, LIFE, age));
      s.mat.uniforms.uK.value = k;
      // the glyph lights the ground round it a little
      const L = decal(DECAL.light, [s.c.x, s.c.y, s.c.z], s.R * 1.6);
      L.cr = s.col.x; L.cg = s.col.y; L.cb = s.col.z; L.p0 = s.R * 1.6; L.p1 = 0.35 * s.R * s.R * k * clamp01(age / TRACE) * (1 - smooth(TRACE, TRACE + 1.5, age) * 0.6); L.p2 = s.R * 0.25; L.p3 = s.R * 0.4;
      decals.add(L);
    }
  }

  /** for probes: how many glyphs are written on the land now */
  get live(): number { return this.pool.filter((s) => s.live).length; }

  dispose(): void { for (const s of this.pool) { s.mesh.geometry.dispose(); s.mat.dispose(); } }
}

/**
 * the top of what a glyph lies on under unit vector u (body m): the ground, or the water over it where there is water
 * (a sigil cast over a lake or the sea is written on its surface, not on the bed under it)
 */
export function landTop(pv: PlanetView, u: Vector3): number {
  const g = groundHeight(pv.ground, u.x, u.y, u.z);
  const water = pv.fields.get('water'), surf = pv.fields.get('surface');
  if (!water || !surf) return g;
  const w = pv.grid.sample(water, u.x, u.y, u.z);
  return w > 0.05 ? Math.max(g, pv.params.radius + pv.grid.sample(surf, u.x, u.y, u.z) + w) : g;
}

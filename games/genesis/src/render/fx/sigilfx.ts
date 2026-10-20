// GENESIS — a sigil, landing (LIVING §3.6 "Sigils", hook H8; render/fx/sigils.ts). When a miracle lands its glyph is
// written on the land in light where it falls: the stroke traced across the ground at the miracle's own size (its
// radius, within reach of the eye), a bright head running along it, then the whole glyph glowing and fading as the
// miracle's own effect takes over (render/fx/miracles.ts). The Touch traces the same glyph in the air as it casts
// (render/hand.ts). The glyph is the power's `sigil` (sigilOfMiracle), drawn upright for the eye that watches: its
// "up" is the camera's forward laid on the ground. Draped on the terrain (the ground's own height function), in the
// FX layer over the composited image, soft-tested against the scene's depth (a house or a tree in the way hides it).

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
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, uSoft);
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  // a bright line of light in a soft glow (the stroke is drawn a third of the strip wide: the rest is its glow and the
  // shadow pressed round it)
  float core = exp(-x * x * 22.0), halo = exp(-x * x * 4.5) * (1.0 - smoothstep(0.8, 1.0, x));
  float drawn = 1.0 - smoothstep(uTrace - 0.003, uTrace + 0.003, vT);
  float head = exp(-pow((vT - uTrace) / 0.02, 2.0)) * (1.0 - step(0.999, uTrace));
  float k = (core * 1.5 + halo * 0.4) * drawn + head * (core * 4.0 + halo);
  // (the land round the stroke shadowed, as if the glyph were pressed into it: on snow, sand, a ripe field or a
  // lightning-lit hillside the glyph keeps its edge where light alone would vanish into the bright ground)
  float press = exp(-x * x * 2.2) * (1.0 - smoothstep(0.85, 1.0, x)) * drawn * 0.5;
  // (a white-hot heart along the line, the colour in its glow)
  vec3 col = mix(uCol, vec3(1.0), 0.35 * core);
  gl_FragColor = vec4(col * k * uK * vis * fxDisplay(0.75), press * uK * vis);
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
      uniforms: { ...this.fx, uCol: { value: new Vector3(1, 0.85, 0.5) }, uTrace: { value: 0 }, uK: { value: 0 }, uSoft: { value: 2 } },
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
    // the glyph's frame on the ground: up = the camera's forward laid flat (else north)
    const up = _u.copy(c).normalize();
    const fw = _f.copy(camFwd).addScaledVector(up, -camFwd.dot(up));
    if (fw.lengthSq() < 1e-6) fw.set(0, 1, 0).addScaledVector(up, -up.y);
    fw.normalize();
    const right = _e.crossVectors(fw, up).normalize();
    const st = sigilStroke(sigilOfMiracle(kind), N);
    const pos = slot.mesh.geometry.getAttribute('position') as BufferAttribute;
    const R = slot.R;
    // (half the strip's width: the line, its glow and its pressed shadow — a few pixels at any distance)
    const w = Math.max(R * 0.045, dist * 0.0045);
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
        const g = groundHeight(pv.ground, _p.x, _p.y, _p.z) + lift;
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

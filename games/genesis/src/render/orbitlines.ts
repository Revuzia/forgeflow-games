// GENESIS — orbit lines for the system view (CONTRACT.md §15.3): thin screen-space lines (three's Line2 fat-line
// addon, smoothed by the FXAA pass) for every orbit, built once per orbit in the parent's frame and moved with the
// floating origin each frame (no per-frame geometry). They fade in as the camera pulls away from the planets.
//   * each line takes its world's tint; its far side (from the eye) is dimmer than its near side, so the ellipses read
//     in depth; a line fades out within a few world radii of the eye (it never slices across the view of a world the
//     camera hangs by — the opening's whispers, a planet filling the frame)
//   * every world has a mark: a small LIT sphere (its phase toward the star, a thin limb of air where it has some) at
//     least a few pixels across, so a world stays findable however far; it fades away as the world itself grows larger
//     on the screen than its mark

import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, Points, Quaternion, ShaderMaterial, Vector2, Vector3 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { WorldView } from '../client/worldview.ts';
import { orbitOffset, type D3 } from '../client/orbits.ts';
import type { CameraPose } from './frame.ts';

interface OrbitLine { line: Line2; key: string; parent: number; pts: Float32Array; colors: Float32Array }

/** planet marks: a lit sphere drawn in a point sprite (light direction per mark, in view space) */
const MARK_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute vec3 aLight;
attribute float aAtmo;
uniform float uPixelRatio;
varying vec3 vColor;
varying vec3 vLight;
varying float vAtmo;
varying float vSize;
void main() {
  vColor = aColor;
  vLight = aLight;
  vAtmo = aAtmo;
  vSize = aSize;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.0;
  gl_PointSize = aSize * uPixelRatio;
}
`;
const MARK_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying vec3 vLight;
varying float vAtmo;
varying float vSize;
void main() {
  // the sprite's disc: the sphere fills 80 % of it, a faint halo the rest
  vec2 d = (gl_PointCoord - 0.5) * vec2(2.0, -2.0);
  float r = length(d) / 0.8;
  float aa = 1.5 / max(vSize * 0.4, 1.0);
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  vec3 n = vec3(d / 0.8, sqrt(max(0.0, 1.0 - r * r)));
  // lit from the star (wrapped a little: the night side is not a hole in space), and a thin limb of air
  float lam = clamp(dot(n, vLight), 0.0, 1.0);
  float night = 0.035;
  vec3 c = vColor * (lam * 1.15 + night) * disc;
  float limb = vAtmo * smoothstep(0.62, 1.0, r) * (1.0 - smoothstep(1.0, 1.0 + 3.0 * aa, r)) * clamp(dot(normalize(vec3(d, 0.2)), vLight) * 0.7 + 0.4, 0.0, 1.0);
  c += vec3(0.35, 0.6, 1.2) * limb * 0.9;
  float halo = exp(-max(r - 1.0, 0.0) * 5.0) * (1.0 - disc) * 0.12;
  c += vColor * halo;
  gl_FragColor = vec4(c * uOpacity, 1.0);
}
`;
const KIND_COLORS: Record<string, [number, number, number]> = {
  terran: [0.45, 0.75, 1.2], ocean: [0.35, 0.6, 1.25], desert: [1.3, 0.7, 0.4], moon: [0.85, 0.85, 0.9], barren: [0.9, 0.78, 0.68],
  ice: [0.8, 1.0, 1.25], jungle: [0.45, 0.95, 0.55], volcanic: [1.1, 0.45, 0.3], methane: [1.1, 0.85, 0.5],
};

const SEGMENTS = 360;
const MAX_MARKS = 24;

const _q = new Quaternion();
const _v = new Vector3();

export class OrbitLines {
  readonly group = new Group();
  private lines = new Map<number, OrbitLine>();
  private resolution = new Vector2(1280, 720);
  opacity = 1;

  private marks: Points;
  private markMat: ShaderMaterial;
  private markPos = new Float32Array(3 * MAX_MARKS);
  private markCol = new Float32Array(3 * MAX_MARKS);
  private markSize = new Float32Array(MAX_MARKS);
  private markLight = new Float32Array(3 * MAX_MARKS);
  private markAtmo = new Float32Array(MAX_MARKS);

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.markPos, 3));
    g.setAttribute('aColor', new BufferAttribute(this.markCol, 3));
    g.setAttribute('aSize', new BufferAttribute(this.markSize, 1));
    g.setAttribute('aLight', new BufferAttribute(this.markLight, 3));
    g.setAttribute('aAtmo', new BufferAttribute(this.markAtmo, 1));
    this.markMat = new ShaderMaterial({
      vertexShader: MARK_VERT, fragmentShader: MARK_FRAG, uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 1 } },
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
    });
    this.marks = new Points(g, this.markMat);
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 20;
    this.group.add(this.marks);
  }

  setResolution(w: number, h: number): void {
    this.resolution.set(w, h);
    for (const l of this.lines.values()) (l.line.material as LineMaterial).resolution.set(w, h);
  }

  /** a line's material: the tint from its uniform colour, the per-vertex fade (red channel of the vertex colour) as alpha */
  private lineMaterial(moon: boolean): LineMaterial {
    const m = new LineMaterial({
      color: 0xffffff, linewidth: moon ? 1.1 : 1.5, transparent: true, opacity: 0.55, depthWrite: false, worldUnits: false, vertexColors: true,
    });
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#ifdef USE_COLOR\n  alpha *= vColor.r;\n#endif');
    };
    m.customProgramCacheKey = () => 'genesis-orbitline-fade-v1';
    m.resolution.copy(this.resolution);
    return m;
  }

  update(view: WorldView, pose: CameraPose, visibility: number): void {
    this.group.visible = visibility > 0.01;
    const seen = new Set<number>();
    const cx0 = pose.pos[0], cy0 = pose.pos[1], cz0 = pose.pos[2];
    // the size of the world the eye is nearest to (the near fade's scale)
    let nearR = 3000, nearD = Infinity;
    for (const pv of view.planets) {
      const d = Math.hypot(pv.center[0] - cx0, pv.center[1] - cy0, pv.center[2] - cz0) - pv.params.radius;
      if (d < nearD) { nearD = d; nearR = pv.params.radius; }
    }
    for (const pv of view.planets) {
      const o = pv.params.orbit;
      if (!(o.a > 0)) continue;
      seen.add(pv.id);
      const key = [o.a, o.e, o.inc, o.node, o.period, o.parent].join('|');
      let entry = this.lines.get(pv.id);
      if (!entry || entry.key !== key) {
        if (entry) { this.group.remove(entry.line); entry.line.geometry.dispose(); (entry.line.material as LineMaterial).dispose(); }
        // one full revolution sampled over the period (positions relative to the parent)
        const pos: number[] = [];
        const p: D3 = [0, 0, 0];
        for (let i = 0; i <= SEGMENTS; i++) {
          orbitOffset({ ...o, phase0: 0 }, (o.period * i) / SEGMENTS, p);
          pos.push(p[0], p[1], p[2]);
        }
        const g = new LineGeometry();
        g.setPositions(pos);
        const colors = new Float32Array(SEGMENTS * 6).fill(1);
        g.setColors(colors);
        const moon = o.parent >= 0;
        const line = new Line2(g, this.lineMaterial(moon));
        line.frustumCulled = false;
        line.renderOrder = 5;
        this.group.add(line);
        entry = { line, key, parent: o.parent, pts: new Float32Array(pos), colors };
        this.lines.set(pv.id, entry);
      }
      // the orbit is drawn around the parent's current centre
      const par = o.parent >= 0 ? view.planet(o.parent) : undefined;
      const cx = par ? par.center[0] : 0, cy = par ? par.center[1] : 0, cz = par ? par.center[2] : 0;
      entry.line.position.set(cx - cx0, cy - cy0, cz - cz0);
      const mat = entry.line.material as LineMaterial;
      // the world's own tint, HDR-bright enough to read against space after exposure, faint enough to stay a guide
      const tint = KIND_COLORS[pv.params.kind] ?? [0.95, 0.82, 0.55];
      const k = o.parent >= 0 ? 0.75 : 1.0;
      // (saturated and not too bright: the tone curve bleaches a bright tint to white, and every orbit read the same)
      mat.color.setRGB((0.08 + 0.92 * tint[0]) * 0.8 * k, (0.08 + 0.92 * tint[1]) * 0.8 * k, (0.08 + 0.92 * tint[2]) * 0.8 * k);
      mat.opacity = 0.62 * visibility * this.opacity;
      // per vertex: the far side dimmer than the near (depth), nothing within a few world radii of the eye
      const dc = Math.max(1, Math.hypot(cx - cx0, cy - cy0, cz - cz0));
      const a = Math.max(o.a, 1);
      const P = entry.pts, C = entry.colors;
      const fadeAt = (i: number): number => {
        const dx = cx + P[i * 3] - cx0, dy = cy + P[i * 3 + 1] - cy0, dz = cz + P[i * 3 + 2] - cz0;
        const d = Math.hypot(dx, dy, dz);
        const depth = Math.max(0.3, Math.min(1, 1.2 - 0.55 * (d - dc) / a));
        const nr = Math.max(nearR, 200);
        const near = d < 3 * nr ? 0 : d > 12 * nr ? 1 : ((t) => t * t * (3 - 2 * t))((d - 3 * nr) / (9 * nr));
        return depth * near;
      };
      let prev = fadeAt(0);
      for (let i = 0; i < SEGMENTS; i++) {
        const next = fadeAt(i + 1);
        C[i * 6] = prev; C[i * 6 + 3] = next;
        prev = next;
      }
      const attr = entry.line.geometry.getAttribute('instanceColorStart') as unknown as { data: { needsUpdate: boolean; array: Float32Array } };
      if (attr && attr.data.array === C) attr.data.needsUpdate = true;
      else { (entry.line.geometry as LineGeometry).setColors(C); }
    }
    // marks at every world's current position: a lit sphere, at least a few pixels across
    _q.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]).invert();
    const tanH = Math.tan(((pose.fov || 50) * Math.PI) / 360);
    const halfH = this.resolution.y / 2;
    let n = 0;
    for (const pv of view.planets) {
      if (n >= MAX_MARKS) break;
      if (pv.alive === false) continue;
      const dx = pv.center[0] - cx0, dy = pv.center[1] - cy0, dz = pv.center[2] - cz0;
      const d = Math.max(1, Math.hypot(dx, dy, dz));
      const moon = pv.params.orbit.parent >= 0;
      // (render pixels, scaled with the frame so a world reads the same at 720p and 4K)
      const minPx = (moon ? 11 : 20) * Math.max(0.75, this.resolution.y / 720);
      // the world's own size on the screen (diameter, render pixels)
      const realPx = (2 * pv.params.radius / d / tanH) * halfH;
      const size = Math.max(minPx, realPx * 1.25);
      // (once the world itself is bigger than its mark, the mark gives way to it)
      const show = 1 - Math.max(0, Math.min(1, (realPx - minPx * 0.9) / (minPx * 0.8)));
      this.markPos[n * 3] = dx; this.markPos[n * 3 + 1] = dy; this.markPos[n * 3 + 2] = dz;
      const c = KIND_COLORS[pv.params.kind] ?? [0.9, 0.9, 0.9];
      const I = 3.2 * show;
      this.markCol[n * 3] = c[0] * I; this.markCol[n * 3 + 1] = c[1] * I; this.markCol[n * 3 + 2] = c[2] * I;
      this.markSize[n] = size;
      // toward the star (at the origin), in view space
      _v.set(-pv.center[0], -pv.center[1], -pv.center[2]).normalize().applyQuaternion(_q);
      this.markLight[n * 3] = _v.x; this.markLight[n * 3 + 1] = _v.y; this.markLight[n * 3 + 2] = _v.z;
      this.markAtmo[n] = pv.params.atmosphere.pressure > 0.05 ? 1 : 0;
      n++;
    }
    const geo = this.marks.geometry;
    geo.setDrawRange(0, n);
    for (const a of ['position', 'aColor', 'aSize', 'aLight', 'aAtmo']) geo.getAttribute(a).needsUpdate = true;
    this.markMat.uniforms.uOpacity.value = visibility * this.opacity;
    for (const [id, e] of this.lines) {
      if (seen.has(id)) continue;
      this.group.remove(e.line);
      e.line.geometry.dispose();
      (e.line.material as LineMaterial).dispose();
      this.lines.delete(id);
    }
  }
}


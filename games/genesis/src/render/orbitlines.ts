// GENESIS — orbit lines for the system view (CONTRACT.md §15.3): thin screen-space lines (three's Line2 fat-line
// addon, smoothed by the FXAA pass) for every orbit, built once per orbit in the parent's frame and moved with the
// floating origin each frame (no per-frame geometry). They fade in as the camera pulls away from the planets.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Points, ShaderMaterial, Vector2 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { WorldView } from '../client/worldview.ts';
import { orbitOffset, type D3 } from '../client/orbits.ts';
import type { CameraPose } from './frame.ts';

interface OrbitLine { line: Line2; key: string; parent: number }

/** planet glints: a constant-size disc + ring per world so the system view reads at any distance */
const MARK_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.0;
  gl_PointSize = aSize * uPixelRatio;
}
`;
const MARK_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float disc = 1.0 - smoothstep(0.32, 0.4, r);
  float ring = smoothstep(0.08, 0.0, abs(r - 0.8)) * 0.6;
  float glow = exp(-r * r * 3.0) * 0.35;
  gl_FragColor = vec4(vColor * (disc + ring + glow) * uOpacity, 1.0);
}
`;
const KIND_COLORS: Record<string, [number, number, number]> = {
  terran: [0.45, 0.75, 1.2], desert: [1.3, 0.7, 0.4], moon: [0.85, 0.85, 0.9], barren: [0.9, 0.78, 0.68], ice: [0.8, 1.0, 1.25],
};

const SEGMENTS = 360;

export class OrbitLines {
  readonly group = new Group();
  private lines = new Map<number, OrbitLine>();
  private resolution = new Vector2(1280, 720);
  opacity = 1;

  private marks: Points;
  private markMat: ShaderMaterial;
  private markPos = new Float32Array(3 * 16);
  private markCol = new Float32Array(3 * 16);
  private markSize = new Float32Array(16);

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.markPos, 3));
    g.setAttribute('aColor', new BufferAttribute(this.markCol, 3));
    g.setAttribute('aSize', new BufferAttribute(this.markSize, 1));
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

  update(view: WorldView, pose: CameraPose, visibility: number): void {
    this.group.visible = visibility > 0.01;
    const seen = new Set<number>();
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
        const moon = o.parent >= 0;
        const m = new LineMaterial({
          color: new Color(moon ? 0x9fb4d8 : 0xd8c39a).getHex(), linewidth: moon ? 1.1 : 1.5, transparent: true,
          opacity: 0.55, depthWrite: false, worldUnits: false,
        });
        m.resolution.copy(this.resolution);
        const line = new Line2(g, m);
        line.frustumCulled = false;
        line.renderOrder = 5;
        this.group.add(line);
        entry = { line, key, parent: o.parent };
        this.lines.set(pv.id, entry);
      }
      // the orbit is drawn around the parent's current centre
      const par = o.parent >= 0 ? view.planet(o.parent) : undefined;
      const cx = par ? par.center[0] : 0, cy = par ? par.center[1] : 0, cz = par ? par.center[2] : 0;
      entry.line.position.set(cx - pose.pos[0], cy - pose.pos[1], cz - pose.pos[2]);
      const mat = entry.line.material as LineMaterial;
      // HDR-bright enough to read against space after exposure, faint enough to stay a guide
      const c = o.parent >= 0 ? [0.5, 0.62, 0.85] : [0.95, 0.82, 0.55];
      mat.color.setRGB(c[0] * 1.2, c[1] * 1.2, c[2] * 1.2);
      mat.opacity = 0.5 * visibility * this.opacity;
    }
    // glints at every world's current position
    let n = 0;
    for (const pv of view.planets) {
      if (n >= 16) break;
      this.markPos[n * 3] = pv.center[0] - pose.pos[0];
      this.markPos[n * 3 + 1] = pv.center[1] - pose.pos[1];
      this.markPos[n * 3 + 2] = pv.center[2] - pose.pos[2];
      const c = KIND_COLORS[pv.params.kind] ?? [0.9, 0.9, 0.9];
      this.markCol[n * 3] = c[0] * 3; this.markCol[n * 3 + 1] = c[1] * 3; this.markCol[n * 3 + 2] = c[2] * 3;
      this.markSize[n] = pv.params.orbit.parent >= 0 ? 9 : 15;
      n++;
    }
    const geo = this.marks.geometry;
    geo.setDrawRange(0, n);
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('aColor').needsUpdate = true;
    geo.getAttribute('aSize').needsUpdate = true;
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

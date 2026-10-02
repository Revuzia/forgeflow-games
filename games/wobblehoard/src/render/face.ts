// The face: two glossy ink-dark bead eyes attached to the SURFACE.
//
// Anchoring: for each eye a rest direction on the +Z front is cast against the rest mesh once (RestMapper), which yields
// the sim triangle (= the three nearest sim vertices) and barycentric weights. Every frame the eye position is the
// weighted combination of those sim vertices, refined with the same Phong smoothing the fine mesh uses (so it sits ON
// the visible surface, not on a facet), pushed out along the interpolated normal; orientation comes from that normal and
// the body frame's up axis. So the eyes ride every squash, dent and stretch and never float.
//
// Behaviour: seeded random blinks, iris and glints follow StageFrameInput.pointerNdc (idle wander when absent), widen
// when compression > ~0.3, squint into happy arcs while compressionRate < 0 (springing back), no mouth.
import * as THREE from 'three';
import type { SoftBodyLike } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { mulberry32, clamp, smoothstep } from '../core/rng.ts';
import { evalSurface, type JellyView, type SurfaceHit } from './jelly.ts';

interface StyleDef { sx: number; sy: number; sz: number; iris: number; glint: number; lid: number; droop: number }
const STYLES: Record<Genome['eyeStyle'], StyleDef> = {
  dot: { sx: 1, sy: 1, sz: 0.5, iris: 0.62, glint: 0.19, lid: 9, droop: 0 },
  oval: { sx: 0.78, sy: 1.34, sz: 0.5, iris: 0.66, glint: 0.18, lid: 9, droop: 0 },
  sleepy: { sx: 1.16, sy: 1.0, sz: 0.46, iris: 0.6, glint: 0.17, lid: 0.18, droop: 0.12 },
  wide: { sx: 1.28, sy: 1.28, sz: 0.52, iris: 0.76, glint: 0.2, lid: 9, droop: 0 },
};

const EYE_FRAG_PARS = /* glsl */`
varying vec3 vLocal;
uniform vec2 uLook;
uniform float uIris;
uniform float uGlint;
`;
const EYE_FRAG_COLOR = /* glsl */`
#include <color_fragment>
{
  vec2 lp = vLocal.xy;
  float irisD = length(lp - uLook * 0.3 - vec2(0.0, -0.04));
  float iris = 1.0 - smoothstep(uIris - 0.09, uIris, irisD);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.05, 0.24), iris * 0.85);
  float pup = 1.0 - smoothstep(uIris * 0.4, uIris * 0.52, length(lp - uLook * 0.38 - vec2(0.0, -0.04)));
  diffuseColor.rgb *= 1.0 - pup * 0.85;
  float g1 = 1.0 - smoothstep(uGlint * 0.62, uGlint, length(lp - (vec2(-0.3, 0.34) + uLook * 0.3)));
  float g2 = 1.0 - smoothstep(uGlint * 0.3, uGlint * 0.46, length(lp - (vec2(0.27, -0.3) + uLook * 0.2)));
  totalEmissiveRadiance += vec3(1.0, 0.95, 0.88) * (g1 + 0.7 * g2) * 2.4;
}
`;

class Eye {
  readonly dome: THREE.Mesh;
  readonly arc: THREE.Mesh;
  readonly uLook: { value: THREE.Vector2 };
  readonly hit: SurfaceHit = { tri: 0, u: 0, v: 0, w: 0 };
  readonly look = { x: 0, y: 0 };
  readonly nSmooth = new THREE.Vector3(0, 0, 1);
  hasN = false;
  constructor(dome: THREE.Mesh, arc: THREE.Mesh, uLook: { value: THREE.Vector2 }) { this.dome = dome; this.arc = arc; this.uLook = uLook; }
}

export class Face {
  readonly group = new THREE.Group();
  private readonly eyes: Eye[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly body: SoftBodyLike;
  private readonly view: JellyView;
  private readonly style: StyleDef;
  private readonly radius: number;
  private readonly rng: () => number;
  private blinkAt: number;
  private blinkStart = -10;
  private blinkLen = 0.15;
  private doubleBlink = false;
  private squint = 0;
  private squintHold = 0;
  private wide = 0;
  private prevComp = 0;
  private readonly seed: number;
  // scratch (no per-frame allocation)
  private readonly sp = new Float32Array(3);
  private readonly sn = new Float32Array(3);
  private readonly vA = new THREE.Vector3();
  private readonly vX = new THREE.Vector3();
  private readonly vY = new THREE.Vector3();
  private readonly vZ = new THREE.Vector3();
  private readonly mtx = new THREE.Matrix4();
  private readonly ndc = new THREE.Vector3();
  private readonly vS = new THREE.Vector3();

  constructor(body: SoftBodyLike, genome: Genome, view: JellyView, scale: number) {
    this.body = body; this.view = view;
    this.style = STYLES[genome.eyeStyle] ?? STYLES.dot;
    this.radius = body.restRadius * (0.095 + 0.07 * genome.eyeSize);
    this.seed = genome.seed;
    this.rng = mulberry32(genome.seed ^ 0xeee1e5);
    this.blinkAt = 1.4 + this.rng() * 2.4;
    void scale;

    // dome: unit hemisphere with its pole on +Z, optional flat lid cut
    const dome = new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.rotateX(Math.PI / 2);
    if (this.style.lid < 5) {
      const p = dome.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (p.getY(i) > this.style.lid) p.setY(i, this.style.lid);
      p.needsUpdate = true;
    }
    this.geos.push(dome);
    const arcGeo = new THREE.TorusGeometry(1, 0.2, 8, 24, Math.PI);
    this.geos.push(arcGeo);

    const az = (9 + 17 * genome.eyeSpacing) * Math.PI / 180;
    const el = (3 + 26 * genome.eyeHeight) * Math.PI / 180;
    for (const side of [-1, 1]) {
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x0b0818, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.2, ior: 1.5, fog: false,
        transparent: true, opacity: 1,
      });
      const uLook = { value: new THREE.Vector2() };
      const iris = this.style.iris, glint = this.style.glint;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uLook = uLook;
        shader.uniforms.uIris = { value: iris };
        shader.uniforms.uGlint = { value: glint };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + EYE_FRAG_PARS)
          .replace('#include <color_fragment>', EYE_FRAG_COLOR);
      };
      mat.customProgramCacheKey = () => 'wh-eye-v1';
      const arcMat = new THREE.MeshPhysicalMaterial({
        color: 0x0b0818, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2, fog: false,
        transparent: true, opacity: 1,
      });
      this.mats.push(mat, arcMat);
      const domeMesh = new THREE.Mesh(dome, mat);
      const arcMesh = new THREE.Mesh(arcGeo, arcMat);
      for (const m of [domeMesh, arcMesh]) {
        m.matrixAutoUpdate = false;
        m.frustumCulled = false;
        m.renderOrder = 20;
      }
      arcMesh.visible = false;
      const eye = new Eye(domeMesh, arcMesh, uLook);
      const dir = new THREE.Vector3(Math.sin(az * side) * Math.cos(el), Math.sin(el), Math.cos(az * side) * Math.cos(el));
      view.mapper.locate(dir.x, dir.y, dir.z, eye.hit);
      this.eyes.push(eye);
      this.group.add(domeMesh, arcMesh);
    }
  }

  update(dt: number, time: number, pointer: { x: number; y: number } | null, camera: THREE.PerspectiveCamera): void {
    const body = this.body, m = body.metrics, P = body.positions, N = this.view.simN, idx = body.indices;
    const r0 = this.radius, st = this.style;
    const comp = m.compression, rate = m.compressionRate;

    // --- expression state ---
    this.wide += (smoothstep(0.3, 0.8, comp) - this.wide) * (1 - Math.exp(-dt * 16));
    if (rate < -0.5 && this.prevComp > 0.07) this.squintHold = 0.5;
    this.prevComp = comp;
    this.squintHold = Math.max(0, this.squintHold - dt);
    const sqTarget = this.squintHold > 0 || (rate < -0.3 && comp > 0.05) ? 1 : 0;
    this.squint += (sqTarget - this.squint) * (1 - Math.exp(-dt * (sqTarget > this.squint ? 26 : 8)));
    // blink
    if (time >= this.blinkAt && this.squint < 0.2) {
      this.blinkStart = time;
      this.blinkLen = 0.13 + this.rng() * 0.05;
      this.blinkAt = time + 2.2 + this.rng() * 3.6;
      if (!this.doubleBlink && this.rng() < 0.18) { this.blinkAt = time + 0.34; this.doubleBlink = true; } else this.doubleBlink = false;
    }
    const bp = (time - this.blinkStart) / this.blinkLen;
    const blink = bp >= 0 && bp < 1 ? Math.sin(bp * Math.PI) : 0;
    // squash-and-stretch of the surface under the eye never fully applies; a bead eye is stiffer than the jelly
    const openY = (1 - 0.93 * Math.max(blink, smoothstep(0.0, 0.55, this.squint)));
    const arcK = smoothstep(0.3, 0.9, this.squint);
    const idleT = time * 0.5 + this.seed * 0.0001;

    for (let e = 0; e < 2; e++) {
      const eye = this.eyes[e], h = eye.hit;
      const a = idx[h.tri * 3] * 3, b = idx[h.tri * 3 + 1] * 3, c = idx[h.tri * 3 + 2] * 3;
      evalSurface(P, N, a, b, c, h.u, h.v, h.w, 0.7, this.sp, 0, this.sn, 0);
      const s = h.u * body.strain[a / 3] + h.v * body.strain[b / 3] + h.w * body.strain[c / 3];
      // smoothed normal
      this.vZ.set(this.sn[0], this.sn[1], this.sn[2]);
      if (!eye.hasN) { eye.nSmooth.copy(this.vZ); eye.hasN = true; } else eye.nSmooth.lerp(this.vZ, 1 - Math.exp(-dt * 40)).normalize();
      this.vZ.copy(eye.nSmooth);
      // up from the body frame
      const q = body.frame;
      this.vY.set(2 * (q.x * q.y - q.z * q.w), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.x * q.w));
      this.vX.crossVectors(this.vY, this.vZ);
      if (this.vX.lengthSq() < 1e-6) this.vX.set(1, 0, 0);
      this.vX.normalize();
      this.vY.crossVectors(this.vZ, this.vX);

      const k = (0.4 + 0.6 * clamp(s, 0.85, 1.22)) * (1 + 0.24 * this.wide);
      const rr = r0 * k;
      const sx = rr * st.sx, sy = rr * st.sy, sz = rr * st.sz;
      const lift = sz * 0.12;
      this.vA.set(this.sp[0] + this.vZ.x * lift, this.sp[1] + this.vZ.y * lift, this.sp[2] + this.vZ.z * lift);
      // droop: sleepy eyes sit a little lower in their socket
      if (st.droop) this.vA.addScaledVector(this.vY, -rr * st.droop);

      // --- look: pointer relative to this eye on screen, expressed in the eye's own axes ---
      let lx = 0, ly = 0;
      if (pointer) {
        this.ndc.copy(this.vA).project(camera);
        const dx = (pointer.x - this.ndc.x) * camera.aspect, dy = pointer.y - this.ndc.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-4) { const mag = Math.min(1, len * 1.8); lx = (dx / len) * mag; ly = (dy / len) * mag; }
        // express the screen-space look in the eye frame: eye axes projected into camera space (view matrix 3x3)
        const ve = camera.matrixWorldInverse.elements;
        const ex = this.vX.x * ve[0] + this.vX.y * ve[4] + this.vX.z * ve[8];
        const ey = this.vX.x * ve[1] + this.vX.y * ve[5] + this.vX.z * ve[9];
        const fx = this.vY.x * ve[0] + this.vY.y * ve[4] + this.vY.z * ve[8];
        const fy = this.vY.x * ve[1] + this.vY.y * ve[5] + this.vY.z * ve[9];
        const tx = lx * ex + ly * ey, ty = lx * fx + ly * fy;
        lx = tx; ly = ty;
      } else {
        lx = 0.32 * Math.sin(idleT * 1.7 + e * 0.4) + 0.12 * Math.sin(idleT * 4.1);
        ly = 0.18 * Math.sin(idleT * 1.3 + 1.0);
      }
      eye.look.x += (lx - eye.look.x) * (1 - Math.exp(-dt * 16));
      eye.look.y += (ly - eye.look.y) * (1 - Math.exp(-dt * 16));
      const lm = Math.hypot(eye.look.x, eye.look.y);
      const lk = lm > 1 ? 1 / lm : 1;
      eye.uLook.value.set(eye.look.x * lk, eye.look.y * lk);

      // --- dome (open eye) ---
      const dome = eye.dome;
      if (arcK < 0.98) {
        dome.visible = true;
        this.mtx.makeBasis(this.vX, this.vY, this.vZ);
        this.mtx.scale(this.vS.set(sx, sy * Math.max(0.07, openY), sz));
        this.mtx.setPosition(this.vA);
        dome.matrix.copy(this.mtx);
        dome.matrixWorldNeedsUpdate = true;
      } else dome.visible = false;
      // --- happy arc ---
      const arc = eye.arc;
      if (arcK > 0.02) {
        arc.visible = true;
        const as = arcK;
        this.mtx.makeBasis(this.vX, this.vY, this.vZ);
        this.mtx.scale(this.vS.set(rr * 0.95 * as, rr * 0.8 * as, rr * 0.7));
        this.vA.addScaledVector(this.vY, -rr * 0.18 * as).addScaledVector(this.vZ, rr * 0.05);
        this.mtx.setPosition(this.vA);
        arc.matrix.copy(this.mtx);
        arc.matrixWorldNeedsUpdate = true;
      } else arc.visible = false;
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

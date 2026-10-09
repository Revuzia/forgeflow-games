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
//
// CUT2 (8.3, task R1 part 2): the placement of the two eyes on the squishy is `wholeRef.ts` (the same formulas, computed once per squishy). A PIECE of a cut squishy is built with `PieceEyes`
// (pieceEyes.ts): it draws only the eyes it holds (a Face with no eye has no meshes, no materials and no blink), each anchored on the piece's own skin, with the WHOLE's bead size, and an eye
// that straddles a cut is clipped exactly at the live cut face (material.clippingPlanes from JellyView.caps, the dome seen from inside is flat ink-dark: the bead's cross-section).
import * as THREE from 'three';
import type { SoftBodyLike } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { mulberry32, clamp, smoothstep } from '../core/rng.ts';
import { evalSurface, type JellyView, type SurfaceHit } from './jelly.ts';
import type { EnvHub } from './env.ts';
import type { PieceEye, PieceEyes } from './pieceEyes.ts';
import { EYE_STYLES, wholeRefFor, type EyeStyleDef, type WholeRef } from './wholeRef.ts';

const STYLES = EYE_STYLES;

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
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.02, 0.09), iris * 0.85);
  float pup = 1.0 - smoothstep(uIris * 0.4, uIris * 0.52, length(lp - uLook * 0.38 - vec2(0.0, -0.04)));
  diffuseColor.rgb *= 1.0 - pup * 0.85;
  float g1 = 1.0 - smoothstep(uGlint * 0.62, uGlint, length(lp - (vec2(-0.3, 0.34) + uLook * 0.3)));
  float g2 = 1.0 - smoothstep(uGlint * 0.3, uGlint * 0.46, length(lp - (vec2(0.27, -0.3) + uLook * 0.2)));
  totalEmissiveRadiance += vec3(1.0, 0.95, 0.88) * (g1 + 0.7 * g2) * 2.4;
}
`;

/** A clip plane that clips nothing (three.js keeps the side where normal . p + constant >= 0); every eye material carries two, so wholes and pieces share ONE program (no compile at the first cut). */
const inertPlane = (): THREE.Plane => new THREE.Plane(new THREE.Vector3(0, 0, 0), 1e6);
/** What the back faces of a clipped dome show: the solid bead's cross-section, flat ink-dark (the output colour, sRGB). */
const INK_BACK = 'if (!gl_FrontFacing) gl_FragColor = vec4(0.043, 0.03, 0.094, 1.0);';

class Eye {
  readonly dome: THREE.Mesh;
  readonly arc: THREE.Mesh;
  readonly uLook: { value: THREE.Vector2 };
  readonly hit: SurfaceHit = { tri: 0, u: 0, v: 0, w: 0 };
  /** Footprint samples east / west / north / south of the eye centre (rest-space tangent offsets). */
  readonly foot: SurfaceHit[] = [0, 1, 2, 3].map(() => ({ tri: 0, u: 0, v: 0, w: 0 }));
  /** Rest-space footprint lengths (east-west, north-south) and the rest outward normal. */
  restLx = 1; restLy = 1;
  readonly restN = new THREE.Vector3(0, 0, 1);
  readonly look = { x: 0, y: 0 };
  readonly nSmooth = new THREE.Vector3(0, 0, 1);
  hasN = false;
  /** 0 = the -x eye of the squishy, 1 = the other (a piece may hold just one of them). */
  slot = 0;
  /** CUT2: the bead's rest tangents (a footprint with no usable sample falls back to them), the offset of the bead from its anchor, which footprint samples lie on this piece, the clip. */
  readonly east = new THREE.Vector3(1, 0, 0); readonly north = new THREE.Vector3(0, 1, 0);
  readonly off = new THREE.Vector3(); hasOff = false;
  footOk: readonly boolean[] | null = null;
  clipCaps: readonly number[] = [];
  clipPlanes: THREE.Plane[] = [];
  /** Remaining width of the bead 0..1 (1 = whole). */
  share = 1;
  /** A straddled eye (clipped by a cut face): the whole's rest centre in the piece's rest frame and the whole's rest frame of the bead, and the constant correction (3 position + 9 rotation
   *  numbers, in the bead's own frame) that the first frame computes so that frame is exactly the whole's bead (null until then; null `restFrame` = not calibrated). */
  readonly restCentre = new THREE.Vector3();
  restFrame: readonly THREE.Vector3[] | null = null;
  bias: Float32Array | null = null;
  constructor(dome: THREE.Mesh, arc: THREE.Mesh, uLook: { value: THREE.Vector2 }) { this.dome = dome; this.arc = arc; this.uLook = uLook; }
}

export class Face {
  readonly group = new THREE.Group();
  private readonly eyes: Eye[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  /** Iris/glint look vectors in each eye's own frame (x0, y0, x1, y1), -1..1. For the harness. */
  readonly lookOut = new Float32Array(4);
  /** World centre of each eye bead by SLOT (x0, y0, z0, x1, y1, z1), refreshed by update(): what the dev `eyeCentres` reads. */
  readonly centreOut = new Float32Array(6);
  /** Remaining width of each eye bead by slot (1 = whole, 0.12 .. 1 = clipped by a cut face; 0 = this Face holds no such eye). */
  readonly shareOut = new Float32Array(2);
  /** How many eyes this Face draws (a piece may hold 0, 1 or 2; a whole body 2). */
  get eyeCount(): number { return this.eyes.length; }
  /** The whole body's eye centres at rest, in the rest-local frame (`StageLike.eyeAnchors`); null for a piece. */
  readonly anchors: { left: { x: number; y: number; z: number }; right: { x: number; y: number; z: number } } | null;
  /** DEV ONLY (defined below behind import.meta.env.DEV): the number of eye beads drawn this frame (0 when the face is hidden). */
  declare readonly visibleEyes: number;
  /** DEV ONLY: bit e set = eye e is drawn this frame. */
  declare readonly visibleMask: number;
  private readonly body: SoftBodyLike;
  private readonly view: JellyView;
  private readonly style: EyeStyleDef;
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
  private readonly fp = new Float32Array(12);
  private readonly fn = new Float32Array(12);
  private readonly qs = new THREE.Quaternion();
  private readonly vR = new THREE.Vector3();
  private readonly vA = new THREE.Vector3();
  private readonly vX = new THREE.Vector3();
  private readonly vY = new THREE.Vector3();
  private readonly vZ = new THREE.Vector3();
  private readonly mtx = new THREE.Matrix4();
  private readonly ndc = new THREE.Vector3();
  private readonly vS = new THREE.Vector3();
  private readonly vO = new THREE.Vector3();
  private readonly vXo = new THREE.Vector3();
  private readonly vYo = new THREE.Vector3();
  private readonly vZo = new THREE.Vector3();
  private readonly wholeRef: WholeRef;

  private readonly hub: EnvHub;

  /**
   * `pieces`: given for a PIECE of a cut squishy (BodyView builds it from the piece's PieceInfo): this Face then draws just the eyes that piece holds, sized by the WHOLE, and
   * with none (a piece with no eye) it makes no material or mesh at all. Without it the Face is a whole squishy's, exactly as it has always been.
   */
  constructor(body: SoftBodyLike, genome: Genome, view: JellyView, hub: EnvHub, pieces?: PieceEyes) {
    this.hub = hub;
    this.body = body; this.view = view;
    this.style = STYLES[genome.eyeStyle] ?? STYLES.dot;
    const ref = pieces ? pieces.ref : wholeRefFor(body, body.restRadius, genome, view.mapper);
    this.wholeRef = ref;
    this.radius = ref.r;   // (= restRadius (0.095 + 0.07 eyeSize); a piece takes the WHOLE's radius, so an eye does not shrink with the piece that holds it)
    this.seed = genome.seed;
    this.rng = mulberry32(genome.seed ^ 0xeee1e5 ^ (pieces ? pieces.salt : 0));   // (a piece's blink timer is salted by its cut, so the two halves do not blink in lockstep; a whole takes salt 0 = today)
    this.blinkAt = 1.4 + this.rng() * 2.4;
    const cen = (e: number): { x: number; y: number; z: number } => ({ x: ref.eyes[e].centre.x, y: ref.eyes[e].centre.y, z: ref.eyes[e].centre.z });
    this.anchors = pieces ? null : { left: cen(0), right: cen(1) };

    // which eyes this Face draws: both for a whole, the kept ones for a piece
    const wanted: (PieceEye | null)[] = pieces ? pieces.eyes.map((p) => p) : [null, null];
    if (wanted.length === 0) return;   // a piece with no eye: no geometry, no material, nothing to blink

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

    for (let wi = 0; wi < wanted.length; wi++) {
      const pe = wanted[wi], slot = pe ? pe.slot : wi, er = ref.eyes[slot];
      const clipPlanes = [inertPlane(), inertPlane()];
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x0b0818, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, ior: 1.5, fog: false,
        transparent: true, opacity: 1,
        side: THREE.DoubleSide,   // (a clipped bead is seen from inside where its front faces are cut away: INK_BACK; unclipped, the back faces sit behind the front ones)
      });
      hub.apply(mat, 2.2);
      mat.clippingPlanes = clipPlanes;
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
          .replace('#include <color_fragment>', EYE_FRAG_COLOR)
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  ' + INK_BACK);
      };
      mat.customProgramCacheKey = () => 'wh-eye-v2';
      const arcMat = new THREE.MeshPhysicalMaterial({
        color: 0x0b0818, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, fog: false,
        transparent: true, opacity: 1,
      });
      hub.apply(arcMat, 2);
      arcMat.clippingPlanes = clipPlanes;
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
      eye.slot = slot;
      // the rest placement is the WHOLE's (wholeRef.ts); a whole body takes its hits as they are, a piece re-anchors them on its own skin
      eye.restLx = er.restLx; eye.restLy = er.restLy; eye.restN.set(er.restN.x, er.restN.y, er.restN.z);
      eye.east.set(er.east.x, er.east.y, er.east.z); eye.north.set(er.north.x, er.north.y, er.north.z);
      const src = pe ?? er;
      Object.assign(eye.hit, src.hit);
      for (let f = 0; f < 4; f++) Object.assign(eye.foot[f], src.foot[f]);
      eye.clipPlanes = clipPlanes;
      if (pe) {
        eye.share = pe.f; eye.off.set(pe.off.x, pe.off.y, pe.off.z); eye.hasOff = pe.hasOff; eye.footOk = pe.footOk.every((x) => x) ? null : pe.footOk; eye.clipCaps = pe.clip;
        if (pe.clip.length > 0) { eye.restCentre.set(pe.restCentre.x, pe.restCentre.y, pe.restCentre.z); eye.restFrame = pe.frame.map((v) => new THREE.Vector3(v.x, v.y, v.z)); }
      }
      this.shareOut[slot] = eye.share;
      this.eyes.push(eye);
      this.group.add(domeMesh, arcMesh);
    }
  }

  /** `comp` / `rate`: the renderer's squeeze (0..1) and its rate of change (1/s, negative = springing back). */
  update(dt: number, time: number, pointer: { x: number; y: number } | null, camera: THREE.PerspectiveCamera | null, comp: number, rate: number): void {
    const body = this.body, P = body.positions, N = this.view.simN, idx = body.indices;
    const r0 = this.radius, st = this.style;

    // --- expression state ---
    this.wide += (smoothstep(0.3, 0.8, comp) - this.wide) * (1 - Math.exp(-dt * 16));
    if (rate < -0.5 && this.prevComp > 0.07) this.squintHold = 0.5;
    this.prevComp = comp;
    this.squintHold = Math.max(0, this.squintHold - dt);
    const sqTarget = this.squintHold > 0 || (rate < -0.3 && comp > 0.15) ? 1 : 0;
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

    for (let ei = 0; ei < this.eyes.length; ei++) {
      const eye = this.eyes[ei], e = eye.slot, h = eye.hit;
      const a = idx[h.tri * 3] * 3, b = idx[h.tri * 3 + 1] * 3, c = idx[h.tri * 3 + 2] * 3;
      evalSurface(P, N, a, b, c, h.u, h.v, h.w, 0.7, this.sp, 0, this.sn, 0);
      // footprint samples E, W, N, S
      for (let f = 0; f < 4; f++) {
        const hf = eye.foot[f];
        evalSurface(P, N, idx[hf.tri * 3] * 3, idx[hf.tri * 3 + 1] * 3, idx[hf.tri * 3 + 2] * 3, hf.u, hf.v, hf.w, 0.7, this.fp, f * 3, this.fn, f * 3);
      }
      const fp = this.fp, q = body.frame;
      this.qs.set(q.x, q.y, q.z, q.w);
      if (eye.footOk === null) {
        this.vX.set(fp[0] - fp[3], fp[1] - fp[4], fp[2] - fp[5]);
        this.vY.set(fp[6] - fp[9], fp[7] - fp[10], fp[8] - fp[11]);
      } else {   // CUT2: a footprint sample beyond a cut face is not on this piece: the one-sided difference (twice the step from the centre), or the rest tangent when neither side is usable
        this.footAxis(this.vX, fp, 0, 3, eye.footOk[0], eye.footOk[1], eye.east, eye.restLx);
        this.footAxis(this.vY, fp, 6, 9, eye.footOk[2], eye.footOk[3], eye.north, eye.restLy);
      }
      const lenX = this.vX.length(), lenY = this.vY.length();
      if (eye.restFrame && eye.bias === null) { eye.restLx = lenX; eye.restLy = lenY; }   // (a straddled eye: its one-sided footprint is measured against ITSELF at the first frame, so its bead is the whole's size, not 4 % smaller)
      // best-fit plane normal over the footprint (outward), tempered toward the rigid normal so a deep dent cannot turn an eye into a slit
      this.vZ.crossVectors(this.vX, this.vY).normalize();
      if (this.vZ.x * this.sn[0] + this.vZ.y * this.sn[1] + this.vZ.z * this.sn[2] < 0) this.vZ.negate();
      this.vR.copy(eye.restN).applyQuaternion(this.qs);
      const dotN = this.vZ.dot(this.vR);
      if (dotN < 0.72) this.vZ.lerp(this.vR, 0.8 * clamp((0.72 - dotN) / 0.5, 0, 1)).normalize();
      if (!eye.hasN) { eye.nSmooth.copy(this.vZ); eye.hasN = true; } else eye.nSmooth.lerp(this.vZ, 1 - Math.exp(-dt * 40)).normalize();
      this.vZ.copy(eye.nSmooth);
      // orthonormal frame: x along the surface (east), y = z cross x
      this.vX.addScaledVector(this.vZ, -this.vX.dot(this.vZ));
      if (this.vX.lengthSq() < 1e-8) this.vX.set(1, 0, 0);
      this.vX.normalize();
      this.vY.crossVectors(this.vZ, this.vX);
      const kx = 1 + (clamp(lenX / eye.restLx, 0.8, 1.35) - 1) * 0.55, ky = 1 + (clamp(lenY / eye.restLy, 0.8, 1.35) - 1) * 0.55;
      const rr = r0 * (1 + 0.24 * this.wide);
      const sx = rr * st.sx * kx, sy = rr * st.sy * ky, sz = rr * st.sz;
      const lift = sz * 0.12;
      this.vA.set(this.sp[0] + this.vZ.x * lift, this.sp[1] + this.vZ.y * lift, this.sp[2] + this.vZ.z * lift);
      if (eye.hasOff) { this.vO.copy(eye.off).applyQuaternion(this.qs); this.vA.add(this.vO); }   // CUT2: a straddled eye is anchored on the rim of this piece and carried to where the whole's bead is
      // droop: sleepy eyes sit a little lower in their socket
      if (st.droop) this.vA.addScaledVector(this.vY, -rr * st.droop);
      if (eye.restFrame) this.calibrate(eye);
      this.centreOut[e * 3] = this.vA.x; this.centreOut[e * 3 + 1] = this.vA.y; this.centreOut[e * 3 + 2] = this.vA.z;
      if (eye.clipCaps.length > 0) this.updateClip(eye);

      // --- look: pointer relative to this eye on screen, expressed in the eye's own axes ---
      let lx = 0, ly = 0;
      if (pointer && camera) {
        this.ndc.copy(this.vA).project(camera);
        const dx = (pointer.x - this.ndc.x) * camera.aspect, dy = pointer.y - this.ndc.y;
        const len = Math.sqrt(dx * dx + dy * dy);
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
      const lm = Math.sqrt(eye.look.x * eye.look.x + eye.look.y * eye.look.y);
      const lk = lm > 1 ? 1 / lm : 1;
      eye.uLook.value.set(eye.look.x * lk, eye.look.y * lk);
      this.lookOut[e * 2] = eye.look.x * lk; this.lookOut[e * 2 + 1] = eye.look.y * lk;

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

  /**
   * A straddled eye (CUT2 8.3): bring this frame's skin-derived pose (this.vA, this.vX / vY / vZ) to the whole's bead. The first frame measures the difference to the whole's rest bead (carried
   * to this body's world by its frame) in the bead's own frame and keeps it; every frame applies it, so the bead is exactly the whole's at rest and follows the piece's skin from there.
   */
  private calibrate(eye: Eye): void {
    const rf = eye.restFrame as readonly THREE.Vector3[], vX = this.vX, vY = this.vY, vZ = this.vZ;
    if (eye.bias === null) {
      const c = this.body.center, t = this.vO.copy(eye.restCentre).applyQuaternion(this.qs);
      const dx = t.x + c.x - this.vA.x, dy = t.y + c.y - this.vA.y, dz = t.z + c.z - this.vA.z;
      const b = new Float32Array(12);
      b[0] = dx * vX.x + dy * vX.y + dz * vX.z; b[1] = dx * vY.x + dy * vY.y + dz * vY.z; b[2] = dx * vZ.x + dy * vZ.y + dz * vZ.z;
      for (let k = 0; k < 3; k++) {
        const a = this.vR.copy(rf[k]).applyQuaternion(this.qs);
        b[3 + 3 * k] = a.dot(vX); b[4 + 3 * k] = a.dot(vY); b[5 + 3 * k] = a.dot(vZ);
      }
      eye.bias = b;
    }
    const b = eye.bias;
    this.vA.addScaledVector(vX, b[0]).addScaledVector(vY, b[1]).addScaledVector(vZ, b[2]);
    this.vXo.copy(vX); this.vYo.copy(vY); this.vZo.copy(vZ);
    vX.set(0, 0, 0).addScaledVector(this.vXo, b[3]).addScaledVector(this.vYo, b[4]).addScaledVector(this.vZo, b[5]);
    vY.set(0, 0, 0).addScaledVector(this.vXo, b[6]).addScaledVector(this.vYo, b[7]).addScaledVector(this.vZo, b[8]);
    vZ.set(0, 0, 0).addScaledVector(this.vXo, b[9]).addScaledVector(this.vYo, b[10]).addScaledVector(this.vZo, b[11]);
  }

  /** The cut faces that clip this bead, from the LIVE faces of the piece (JellyView.caps, render space): three.js keeps the side where normal . p + constant >= 0, the piece is where n_out . p <= d. */
  private updateClip(eye: Eye): void {
    const caps = this.view.caps;
    for (let j = 0; j < 2; j++) {
      const pl = eye.clipPlanes[j], k = j < eye.clipCaps.length ? eye.clipCaps[j] : -1, cap = k >= 0 ? caps[k] : undefined;
      if (cap && cap.live) { pl.normal.set(-cap.nx, -cap.ny, -cap.nz); pl.constant = cap.d; } else { pl.normal.set(0, 0, 0); pl.constant = 1e6; }
    }
  }

  /** One axis of the footprint (east-west or north-south): both samples on the piece = their difference; one = twice its step from the centre sample; none = the rest tangent turned by the body frame. */
  private footAxis(out: THREE.Vector3, fp: Float32Array, ia: number, ib: number, okA: boolean, okB: boolean, tan: THREE.Vector3, restLen: number): void {
    const sp = this.sp;
    if (okA && okB) out.set(fp[ia] - fp[ib], fp[ia + 1] - fp[ib + 1], fp[ia + 2] - fp[ib + 2]);
    else if (okA) out.set(2 * (fp[ia] - sp[0]), 2 * (fp[ia + 1] - sp[1]), 2 * (fp[ia + 2] - sp[2]));
    else if (okB) out.set(2 * (sp[0] - fp[ib]), 2 * (sp[1] - fp[ib + 1]), 2 * (sp[2] - fp[ib + 2]));
    else out.copy(tan).multiplyScalar(restLen).applyQuaternion(this.qs);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) { this.hub.release(m); m.dispose(); }
  }
}

// DEV ONLY (CUT2 8.7; the probes' RP1 reads it): `vite build` replaces import.meta.env.DEV with false and drops this block.
if (import.meta.env.DEV) {
  const mask = (f: Face): number => {
    const eyes = (f as unknown as { eyes: { dome: THREE.Mesh; arc: THREE.Mesh; slot: number }[] }).eyes;
    if (!f.group.visible) return 0;
    let m = 0;
    for (let i = 0; i < eyes.length; i++) if (eyes[i].dome.visible || eyes[i].arc.visible) m |= 1 << eyes[i].slot;
    return m;
  };
  Object.defineProperty(Face.prototype, 'visibleMask', { get(this: Face): number { return mask(this); } });
  Object.defineProperty(Face.prototype, 'visibleEyes', { get(this: Face): number { const m = mask(this); return (m & 1) + ((m >> 1) & 1); } });
}

// HIT PARADE - the ring-wall CUTAWAY (CHANGED(wf6 fixer) D2 / D3, CONTRACT §35.26). Presentation only.
//
// The orbit rig is bound to the sim's camN (inputs are camera-relative, §35.3), so with both fighters pinned along the ring
// wall and camN pointing OUT of the ring there is no lens position on the camera side inside the ring: every shot looks in
// over the wall. Feet 0.1-0.4 m from a 1.0-1.2 m wall cannot be seen over it from any height in the clear band (the old
// rig climbed to 2.95 m and pulled in to 2.34 m: a 62-degree top-down frame of P1's back, the victim hidden). The same
// happens to a PRIME TIME shot authored outside the ring. Fighting games solve this the same way: the set geometry between
// the lens and the fighters is cut away.
//
// Every stage material gets one shader patch (onBeforeCompile, chained with any patch the stage already set; its own
// program cache key). A fragment is discarded when ALL of these hold:
//   * it lies outside the ring's inner face (planar ring measure > radius - 0.12 m: circle = radius, poly = the apothem
//     measure of the side it faces) and above the floor (y > 0.03) and below `topY` - i.e. the ring wall, its coping,
//     posts, rails, the gates and any apron / ringside set piece; the ring floor and the far stands are never touched;
//   * it is nearer the lens than a fighter's mid plane (view depth < the body centre's depth + 0.1 m);
//   * it falls inside that fighter's screen box (a rounded rectangle round the projected body, + a feathered margin that
//     is ordered-dithered so the hole has a soft edge).
// BoutView feeds the two boxes each frame (update) and switches the patch on only while the lens is outside the ring's
// inner face (inside, the wall is behind the camera or beyond the fighters: nothing to cut). Wall-splat decals face into the
// ring (single-sided), so a lens outside the wall never sees one floating where the wall was cut.

import * as THREE from 'three';
import { ringGap, type RingGeom } from './ring3d.ts';

/** the uniforms every patched material shares (one object: a single write per frame updates them all) */
export interface CutUniforms {
  uHpCutOn: { value: number };
  /** per fighter: NDC box centre x, y, half extents x, y (half extents <= 0 = no box) */
  uHpCutA: { value: THREE.Vector4 };
  uHpCutB: { value: THREE.Vector4 };
  /** x / y = the fighters' front view depths (m), z = aspect (w / h), w = feather (aspect-corrected NDC units) */
  uHpCutD: { value: THREE.Vector4 };
  /** ring centre x, z, the inner measure the cut starts at, the floor height above which it cuts */
  uHpCutRing: { value: THREE.Vector4 };
  /** sides (0 = circle), rotation (rad, yaw convention), top y, unused */
  uHpCutShape: { value: THREE.Vector4 };
}

const VERT_DECL = 'varying vec3 vHpCutW;\nvarying vec4 vHpCutC;\n';
const VERT_BODY = `
{
  vec4 hpCutP = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  hpCutP = instanceMatrix * hpCutP;
#endif
  vHpCutW = ( modelMatrix * hpCutP ).xyz;
  vHpCutC = gl_Position;
}
`;
const FRAG_DECL = `varying vec3 vHpCutW;
varying vec4 vHpCutC;
uniform float uHpCutOn;
uniform vec4 uHpCutA;
uniform vec4 uHpCutB;
uniform vec4 uHpCutD;
uniform vec4 uHpCutRing;
uniform vec4 uHpCutShape;
float hpCutBayer( vec2 fc ) {
  int ix = int( mod( fc.x, 4.0 ) ), iy = int( mod( fc.y, 4.0 ) );
  int i = ix + iy * 4;
  float m[16] = float[16]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
  return ( m[i] + 0.5 ) / 16.0;
}
float hpCutBox( vec2 ndc, float dep, vec4 box, float front ) {
  if ( box.z <= 0.0 || dep >= front ) return 0.0;
  vec2 p = ndc - box.xy;
  p.x *= uHpCutD.z;
  vec2 h = vec2( box.z * uHpCutD.z, box.w );
  float rad = min( h.x, h.y ) * 0.5;
  vec2 q = abs( p ) - h + rad;
  float sd = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - rad;
  return ( 1.0 - smoothstep( 0.0, uHpCutD.w, sd ) ) * smoothstep( 0.0, 0.25, front - dep );
}
`;
const FRAG_BODY = `
if ( uHpCutOn > 0.5 ) {
  vec2 hpQ = vHpCutW.xz - uHpCutRing.xy;
  float hpR = length( hpQ );
  if ( uHpCutShape.x > 2.5 ) {
    float hpStep = 6.2831853 / uHpCutShape.x;
    float hpK = floor( ( atan( hpQ.x, hpQ.y ) - uHpCutShape.y ) / hpStep + 0.5 );
    float hpA = uHpCutShape.y + hpK * hpStep;
    hpR = dot( hpQ, vec2( sin( hpA ), cos( hpA ) ) );
  }
  if ( hpR > uHpCutRing.z && vHpCutW.y > uHpCutRing.w && vHpCutW.y < uHpCutShape.z && vHpCutC.w > 0.0 ) {
    vec2 hpNdc = vHpCutC.xy / vHpCutC.w;
    float hpCut = max( hpCutBox( hpNdc, vHpCutC.w, uHpCutA, uHpCutD.x ), hpCutBox( hpNdc, vHpCutC.w, uHpCutB, uHpCutD.y ) );
    if ( hpCut > 0.0 && ( hpCut >= 0.999 || hpCut > hpCutBayer( gl_FragCoord.xy ) ) ) discard;
  }
}
`;

/**
 * ONE uniform set for the page: the stage GLB's materials are cached by Assets and SHARED by every bout on that stage, so a
 * material is patched once (PATCHED) and every later BoutView's Cutaway drives the same uniforms (a per-instance set
 * double-patched a reused material - "'vHpCutW' : redefinition", measured in playtest's second bout - or left it bound to
 * a dead instance's values). Only one bout view is live at a time.
 */
const SHARED_U: CutUniforms = {
  uHpCutOn: { value: 0 },
  uHpCutA: { value: new THREE.Vector4(0, 0, 0, 0) },
  uHpCutB: { value: new THREE.Vector4(0, 0, 0, 0) },
  uHpCutD: { value: new THREE.Vector4(0, 0, 16 / 9, 0.07) },
  uHpCutRing: { value: new THREE.Vector4(0, 0, 5.4, 0.03) },
  uHpCutShape: { value: new THREE.Vector4(0, 0, 3.0, 0) },
};

/**
 * the patched materials -> the onBeforeCompile wrapper they carry (by identity: Material.clone() copies userData but not
 * onBeforeCompile; a later StageView on the cached stage may set a new onBeforeCompile - a chase material - which is then
 * wrapped again instead of being skipped)
 */
const PATCHED = new WeakMap<THREE.Material, unknown>();

/** a fighter for the cut: planar root, feet / top heights (m), body radius (m) */
export interface CutBody { x: number; z: number; y0: number; top: number; r: number; visible?: boolean }

export class Cutaway {
  readonly u: CutUniforms = SHARED_U;
  /** stage materials that carry the patch (patched now or by an earlier bout on the same cached stage; read-back) */
  patched = 0;
  /** harness A/B switch: false = never cut (the pre-fix look) */
  enabled = true;
  /** last frame read-back */
  readonly last = { on: 0, boxes: [[0, 0, 0, 0], [0, 0, 0, 0]] as number[][], depth: [0, 0] };
  private readonly seen = new WeakSet<THREE.Material>();
  constructor() { SHARED_U.uHpCutOn.value = 0; }
  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  /** patch every mesh material under `root` (call before the warm-up so the patched programs link at load) */
  install(root: THREE.Object3D): number {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[]) this.patch(mat);
    });
    return this.patched;
  }

  /** patch one material (idempotent); its existing onBeforeCompile / cache key are kept and chained */
  patch(mat: THREE.Material | null | undefined): void {
    if (!mat || this.seen.has(mat)) return;
    const sm = mat as THREE.Material & { isShaderMaterial?: boolean };
    if (sm.isShaderMaterial) return;                         // hand-written shaders (none on the sets) are left alone
    this.seen.add(mat);
    if (PATCHED.get(mat) === mat.onBeforeCompile) { this.patched++; return; }   // a cached stage material already patched
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    const u = this.u;
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r);
      Object.assign(sh.uniforms, u);
      if (!sh.vertexShader.includes('#include <project_vertex>') || !sh.fragmentShader.includes('#include <clipping_planes_fragment>')) return;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${VERT_DECL}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_BODY}`);
    };
    PATCHED.set(mat, mat.onBeforeCompile);
    mat.customProgramCacheKey = () => `${prevKey.call(mat)}|hp-cut1`;
    mat.needsUpdate = true;
    this.patched++;
  }

  /** the ring the cut follows (the sim's ring once known) */
  setRing(g: RingGeom): void {
    const sides = g.shape === 'poly' ? Math.max(3, g.sides) : 0;
    this.u.uHpCutRing.value.set(g.cx, g.cz, g.r - 0.12, 0.03);
    this.u.uHpCutShape.value.set(sides, g.rot, Math.max(2.6, g.wallH + 1.6), 0);
  }

  /**
   * per frame, after the camera is placed: the patch is on while the lens is outside the ring's inner face (+ 0.05 m) and
   * each visible fighter gets a screen box (NDC) + its front depth
   */
  update(camera: THREE.PerspectiveCamera, ring: RingGeom, bodies: ReadonlyArray<CutBody>, aspect: number): void {
    const L = this.last;
    const pos = camera.position;
    const outside = this.enabled && ringGap(ring, pos.x, pos.z) < 0.05;
    this.u.uHpCutOn.value = outside ? 1 : 0;
    L.on = outside ? 1 : 0;
    if (!outside) return;
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.dir);
    this.right.set(this.dir.z, 0, -this.dir.x);                // the lens' screen-right on the ground plane (y up)
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize().multiplyScalar(-1);
    const boxes = [this.u.uHpCutA.value, this.u.uHpCutB.value];
    for (let i = 0; i < 2; i++) {
      const b = bodies[i];
      const box = boxes[i];
      if (!b || b.visible === false) { box.set(0, 0, 0, 0); L.boxes[i] = [0, 0, 0, 0]; L.depth[i] = 0; continue; }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const r = b.r + 0.12;
      for (const h of [b.y0 - 0.05, (b.y0 + b.top) / 2, b.top + 0.12]) {
        for (const s of [-1, 1]) {
          for (const t of [-1, 1]) {
            this.tmp.set(b.x + this.right.x * r * s + this.dir.x * r * t, h, b.z + this.right.z * r * s + this.dir.z * r * t).project(camera);
            if (this.tmp.z > 1) continue;
            x0 = Math.min(x0, this.tmp.x); x1 = Math.max(x1, this.tmp.x); y0 = Math.min(y0, this.tmp.y); y1 = Math.max(y1, this.tmp.y);
          }
        }
      }
      if (!(x1 > x0) || !(y1 > y0)) { box.set(0, 0, 0, 0); L.boxes[i] = [0, 0, 0, 0]; continue; }
      const m = 0.03;
      box.set((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + m, (y1 - y0) / 2 + m);
      // the cut plane sits just behind the body's centre: a wall piece between the lens and the body's mid plane hides
      // the body (measured: with the plane at the body's FRONT, the inner face of a wall 0.3 m behind P1's root still
      // crossed his waist on an oblique shot); the far wall stays (it is metres deeper)
      const depth = (b.x - pos.x) * this.dir.x + ((b.y0 + b.top) / 2 - pos.y) * this.dir.y + (b.z - pos.z) * this.dir.z + 0.1;
      L.depth[i] = Math.round(depth * 1000) / 1000;
      L.boxes[i] = [box.x, box.y, box.z, box.w].map((v) => Math.round(v * 1000) / 1000);
      if (i === 0) this.u.uHpCutD.value.x = depth; else this.u.uHpCutD.value.y = depth;
    }
    // two boxes that touch or nearly touch become ONE window (a wall pillar left standing between the fighters read as a
    // second hole), cut to the farther body's mid plane
    const A = boxes[0], B = boxes[1];
    if (A.z > 0 && B.z > 0) {
      const gapX = Math.abs(A.x - B.x) - A.z - B.z, gapY = Math.abs(A.y - B.y) - A.w - B.w;
      if (gapX < 0.25 && gapY < 0.25) {
        const x0 = Math.min(A.x - A.z, B.x - B.z), x1 = Math.max(A.x + A.z, B.x + B.z);
        const y0 = Math.min(A.y - A.w, B.y - B.w), y1 = Math.max(A.y + A.w, B.y + B.w);
        A.set((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2);
        this.u.uHpCutD.value.x = Math.max(this.u.uHpCutD.value.x, this.u.uHpCutD.value.y);
        B.set(0, 0, 0, 0);
        L.boxes = [[A.x, A.y, A.z, A.w].map((v) => Math.round(v * 1000) / 1000), [0, 0, 0, 0]];
      }
    }
    this.u.uHpCutD.value.z = Math.max(0.2, aspect);
    this.u.uHpCutD.value.w = 0.07;
  }
}

// HIT PARADE - stride scaling for the sidestep (CHANGED(fix_view) D6). Presentation only; runs after the pose each frame
// (the mixer re-poses every bone from the clip next frame, so nothing accumulates).
//
// The baked sidestep's legs travel `clip len` (0.90 m x hip ratio) while the sim moves the root the fighter's own arc
// (system 0.85 m, or fighters/<id>.json step.distM up to 1.7 m since fix_core D1). With the clip sampled by the sim's
// progress (view/stepanim.ts) a planted foot stays put only if the feet's LATERAL offsets from the root are scaled by
// s = arc / len: root(k) + s * foot(k) is then constant while the foot is planted. Solved in ROOT-LOCAL space (the
// fighter root's frame: x = the body's lateral axis, the model faces +Z) so the root's mirror (scale.x -1) and yaw drop
// out:
//   1. targets = each ankle with its x scaled by s, same height / forward offset;
//   2. a long stride the legs cannot span from the clip's hip height LOWERS THE HIPS (a lunge), at most `maxDrop` x the
//      hip height - the dip is largest mid-step, zero when the feet are together;
//   3. a target still out of reach is pulled in HORIZONTALLY (the foot stays on the floor; the rest slides);
//   4. each leg = an analytic two-bone IK (UpLeg -> Leg -> Foot), the knee kept in its plane (pole = the knee's offset
//      from the hip-ankle line), the foot keeps its root-relative rotation.

import * as THREE from 'three';

interface Leg { up: THREE.Object3D; knee: THREE.Object3D; foot: THREE.Object3D }

const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _m3 = new THREE.Matrix3();
const _s = new THREE.Vector3();
const tmp = new THREE.Vector3();
const U = new THREE.Vector3(), V = new THREE.Vector3(), K2 = new THREE.Vector3(), A1 = new THREE.Vector3(), Tr = new THREE.Vector3();
const qPar = new THREE.Quaternion(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qa = new THREE.Quaternion(), qk = new THREE.Quaternion();
const d1 = new THREE.Vector3(), d2 = new THREE.Vector3();
const P = [0, 1].map(() => ({ H: new THREE.Vector3(), K: new THREE.Vector3(), A: new THREE.Vector3(), T: new THREE.Vector3(), qUp: new THREE.Quaternion(), qKnee: new THREE.Quaternion(), qFoot: new THREE.Quaternion(), l1: 0, l2: 0 }));

/** position + rotation of `o` relative to `root` (root-local; the root's own mirror cancels) */
function rel(o: THREE.Object3D, pos: THREE.Vector3 | null, q: THREE.Quaternion | null): void {
  _m.multiplyMatrices(_inv, o.matrixWorld);
  _m.decompose(pos ?? tmp, q ?? qa, _s);
}

export class LegIK {
  private readonly legs: Leg[] = [];
  private readonly hips: THREE.Object3D | null = null;
  /** the deepest hip drop as a fraction of the hip height */
  maxDrop = 0.22;
  /** read-back: the last frame's max ankle correction (m) and hip drop (m) */
  lastShift = 0;
  lastDrop = 0;

  constructor(bone: (name: string) => THREE.Object3D | null) {
    for (const side of ['Left', 'Right']) {
      const up = bone(side + 'UpLeg'), knee = bone(side + 'Leg'), foot = bone(side + 'Foot');
      if (up && knee && foot && up.parent && knee.parent === up && foot.parent === knee) this.legs.push({ up, knee, foot });
    }
    if (this.legs.length === 2 && this.legs[0].up.parent === this.legs[1].up.parent) this.hips = this.legs[0].up.parent;
  }

  get ok(): boolean { return this.legs.length === 2; }

  /** the values the IK overwrote (restored before the next pose: a track the bake dropped would otherwise keep them) */
  private saved = false;
  private readonly hipsPos = new THREE.Vector3();
  private readonly legQ = [0, 1, 2, 3, 4, 5].map(() => new THREE.Quaternion());

  /** undo the last apply() (call BEFORE posing; the mixer then writes every animated value as usual) */
  restore(): void {
    if (!this.saved) return;
    this.saved = false;
    if (this.hips) this.hips.position.copy(this.hipsPos);
    this.legs.forEach((L, i) => { L.up.quaternion.copy(this.legQ[i * 3]); L.knee.quaternion.copy(this.legQ[i * 3 + 1]); L.foot.quaternion.copy(this.legQ[i * 3 + 2]); });
  }

  /**
   * Scale both ankles' lateral (root-local x) offsets by `s` (1 = no change). The caller has posed the model and updated
   * the root's world matrices this frame.
   */
  apply(root: THREE.Object3D, s: number): void {
    this.lastShift = 0; this.lastDrop = 0;
    if (!this.ok || !(Math.abs(s - 1) > 1e-3)) return;
    if (this.hips) this.hipsPos.copy(this.hips.position);
    this.legs.forEach((L, i) => { this.legQ[i * 3].copy(L.up.quaternion); this.legQ[i * 3 + 1].copy(L.knee.quaternion); this.legQ[i * 3 + 2].copy(L.foot.quaternion); });
    this.saved = true;
    _inv.copy(root.matrixWorld).invert();
    // 1. targets
    let need = 0, hipY = 0;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], p = P[i];
      rel(L.up, p.H, p.qUp); rel(L.knee, p.K, p.qKnee); rel(L.foot, p.A, p.qFoot);
      p.l1 = p.K.distanceTo(p.H); p.l2 = p.A.distanceTo(p.K);
      p.T.set(p.A.x * s, p.A.y, p.A.z);
      hipY = Math.max(hipY, p.H.y);
      // 2. the hip height from which this leg spans its target (98 % of full reach)
      const reach = (p.l1 + p.l2) * 0.98;
      const dxz = Math.hypot(p.T.x - p.H.x, p.T.z - p.H.z);
      const hOk = dxz < reach ? Math.sqrt(reach * reach - dxz * dxz) : 0;
      need = Math.max(need, (p.H.y - p.T.y) - hOk);
    }
    const drop = Math.max(0, Math.min(need, this.maxDrop * hipY));
    if (drop > 1e-3 && this.hips && this.hips.parent) {
      rel(this.hips.parent, null, null);                         // _m = root-local <- hips' parent space
      _m3.setFromMatrix4(_m.invert());
      this.hips.position.add(tmp.set(0, -drop, 0).applyMatrix3(_m3));
      this.hips.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) {                               // the legs came down with the hips; the targets stay
        const L = this.legs[i], p = P[i];
        rel(L.up, p.H, p.qUp); rel(L.knee, p.K, p.qKnee); rel(L.foot, p.A, p.qFoot);
      }
      this.lastDrop = drop;
    }
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], p = P[i];
      const { H, K, A, T } = p;
      const l1 = p.l1, l2 = p.l2;
      if (!(l1 > 1e-4) || !(l2 > 1e-4)) continue;
      // 3. out of reach: pull the target in horizontally (keeps the foot on the floor)
      const reach = (l1 + l2) * 0.999;
      const dy = T.y - H.y;
      if (T.distanceTo(H) > reach && Math.abs(dy) < reach) {
        const dxz = Math.hypot(T.x - H.x, T.z - H.z), mx = Math.sqrt(reach * reach - dy * dy);
        if (dxz > 1e-6) { const k = mx / dxz; T.x = H.x + (T.x - H.x) * k; T.z = H.z + (T.z - H.z) * k; }
      }
      if (T.distanceTo(A) < 5e-4) continue;
      this.lastShift = Math.max(this.lastShift, Math.abs(T.x - p.A.x));
      // 4. two-bone IK
      const dist = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, T.distanceTo(H)));
      U.subVectors(T, H).normalize();
      V.subVectors(K, H);
      V.addScaledVector(U, -V.dot(U));
      if (V.lengthSq() < 1e-8) V.set(0, 0, 1).addScaledVector(U, -U.z);
      V.normalize();
      const ca = Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
      const sa = Math.sqrt(1 - ca * ca);
      K2.copy(H).addScaledVector(U, l1 * ca).addScaledVector(V, l1 * sa);
      d1.subVectors(K, H).normalize(); d2.subVectors(K2, H).normalize();
      q1.setFromUnitVectors(d1, d2);
      A1.subVectors(A, K).applyQuaternion(q1).add(K2);
      Tr.copy(H).addScaledVector(U, dist);
      d1.subVectors(A1, K2).normalize(); d2.subVectors(Tr, K2).normalize();
      q2.setFromUnitVectors(d1, d2);
      rel(L.up.parent!, null, qPar);
      const upRel = qa.copy(q1).multiply(p.qUp);
      const kneeRel = qk.copy(q2).multiply(q1).multiply(p.qKnee);
      L.up.quaternion.copy(qPar).invert().multiply(upRel);
      L.knee.quaternion.copy(upRel).invert().multiply(kneeRel);
      L.foot.quaternion.copy(kneeRel).invert().multiply(p.qFoot);   // the foot keeps its root-relative rotation
      L.up.updateMatrixWorld(true);
    }
  }
}

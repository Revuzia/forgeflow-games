// HIT PARADE - the fighter's REAL silhouette top (CHANGED(fix_view) D13). Presentation only.
//
// The camera keeps both fighters' tops under the HUD band. A head bone + a fixed hair allowance misses raised limbs:
// THE FREAK holds its claw above its head in the guard / step / circle clips (measured mesh tops, tools/measure:
// idle 2.38 m, sidestep 2.77 m, sidewalk 2.79 m against heightM 2.4), so the claw and head sat behind the P1 health bar
// during a sidestep. Here every skinned vertex (subsampled to <= ~6000 per mesh) is binned to its dominant bone at load
// and, per bone, the vertices that are EXTREME along 26 directions (the 3x3x3 grid of axes and diagonals) are kept in the
// bone's own space - a support set: for any bone rotation the true highest vertex is within ~8 % of the bone's extent
// of the highest kept one (a bone-space AABB's corners overshot THE FREAK's claw by ~0.4 m). A posed top = the highest
// kept vertex after the bones' world matrices. `neutralTop` = the highest top over the neutral clips (idle, walks, guard,
// crouch, dashes, the §35.5 step clips) sampled at 5 times each, measured once at load: a STABLE number the camera can
// frame by (a per-frame top would bob the camera with every punch).

import * as THREE from 'three';

/** the stances a body holds for long stretches (the guard / block poses are reactions: a high block's raised arms would
 *  widen every shot of the match for a pose held a few frames - bruno block_high 2.08 m vs his walks' 1.93) */
const NEUTRAL = ['idle', 'walk_f', 'walk_b', 'crouch_idle', 'dash_f', 'dash_b', 'land',
  'sidestep_l', 'sidestep_r', 'sidewalk_l', 'sidewalk_r'];

/** the 26 support directions (unit) */
const DIRS: Array<[number, number, number]> = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (!x && !y && !z) continue;
  const l = Math.hypot(x, y, z);
  DIRS.push([x / l, y / l, z / l]);
}

export class BodyTop {
  private readonly bones: THREE.Object3D[] = [];
  /** per bone: the kept support points in bone space, packed xyz */
  private readonly pts: Float32Array[] = [];
  private readonly v = new THREE.Vector3();

  constructor(model: THREE.Object3D) {
    model.updateMatrixWorld(true);
    const idx = new Map<THREE.Object3D, number>();
    const best: number[][] = [];          // per bone: 26 best dot values
    const bestP: Float32Array[] = [];     // per bone: 26 points
    const p = this.v;
    model.traverse((o) => {
      const sk = o as THREE.SkinnedMesh;
      if (!sk.isSkinnedMesh || !sk.skeleton || o.userData.hpHull) return;
      const g = sk.geometry;
      const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
      const si = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
      const sw = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      if (!pos || !si || !sw) return;
      const bones = sk.skeleton.bones, inv = sk.skeleton.boneInverses;
      const step = Math.max(1, Math.floor(pos.count / 6000));
      for (let i = 0; i < pos.count; i += step) {
        let bi = -1, bw = 0;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } }
        if (bi < 0 || bw < 0.25 || !bones[bi] || !inv[bi]) continue;
        p.fromBufferAttribute(pos, i).applyMatrix4(sk.bindMatrix).applyMatrix4(inv[bi]);
        const b = bones[bi];
        let j = idx.get(b);
        if (j === undefined) {
          j = this.bones.length; idx.set(b, j); this.bones.push(b);
          best.push(new Array(DIRS.length).fill(-Infinity)); bestP.push(new Float32Array(DIRS.length * 3));
        }
        const bb = best[j], bp = bestP[j];
        for (let d = 0; d < DIRS.length; d++) {
          const dv = p.x * DIRS[d][0] + p.y * DIRS[d][1] + p.z * DIRS[d][2];
          if (dv > bb[d]) { bb[d] = dv; bp[d * 3] = p.x; bp[d * 3 + 1] = p.y; bp[d * 3 + 2] = p.z; }
        }
      }
    });
    for (let j = 0; j < this.bones.length; j++) {
      // de-duplicate the support points (one vertex is often extreme in several directions)
      const src = bestP[j], keep: number[] = [];
      for (let d = 0; d < DIRS.length; d++) {
        if (!Number.isFinite(best[j][d])) continue;
        const x = src[d * 3], y = src[d * 3 + 1], z = src[d * 3 + 2];
        let dup = false;
        for (let q = 0; q < keep.length; q += 3) if (keep[q] === x && keep[q + 1] === y && keep[q + 2] === z) { dup = true; break; }
        if (!dup) keep.push(x, y, z);
      }
      this.pts.push(Float32Array.from(keep));
    }
  }

  get ok(): boolean { return this.bones.length > 0; }

  /** the posed silhouette top (world y) - the caller has updated the model's world matrices */
  top(): number {
    let y = -Infinity;
    for (let j = 0; j < this.bones.length; j++) {
      const e = this.bones[j].matrixWorld.elements, q = this.pts[j];
      // world y of a bone-space point = row 1 of the matrix (column-major elements 1, 5, 9, 13)
      for (let k = 0; k < q.length; k += 3) {
        const wy = e[1] * q[k] + e[5] * q[k + 1] + e[9] * q[k + 2] + e[13];
        if (wy > y) y = wy;
      }
    }
    return y;
  }

  /**
   * The highest top over the neutral clips (metres above the root), posing each at 5 times with `poseClip`. The model
   * must stand at its root origin (constructor time).
   */
  neutralTop(model: THREE.Object3D, has: (clip: string) => boolean, dur: (clip: string) => number, poseClip: (clip: string, t: number) => void): number {
    if (!this.ok) return 0;
    let best = 0;
    for (const c of NEUTRAL) {
      if (!has(c)) continue;
      const d = dur(c);
      for (let k = 0; k < 5; k++) {
        poseClip(c, d * k / 4 * 0.999);
        model.updateMatrixWorld(true);
        best = Math.max(best, this.top());
      }
    }
    return best;
  }
}

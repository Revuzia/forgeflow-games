// VALE render — stride matching (CW1 critic:input-feel, foot slip). The run clip plays at moveSpeed / runRef (actors.ts),
// so a planted foot stays put only when runRef is the speed the clip's own planted foot travels backwards. The authored
// art.runRefSpeed was set to each fighter's moveSpeed, not measured from the clip, and the planted foot slid 3-15 % of
// the run speed (`_harness/probe_camera.ts` motion). This measures the clip itself, once per template: the run clip
// is posed at 120 samples, the foot sockets' positions are read in the model frame while a foot is within 3 cm of its
// lowest point (planted), and runRef is the value that leaves those planted feet the least median world speed.
// Presentation only.

import { type AnimationClip, AnimationMixer, type Object3D, PropertyBinding, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const STRIDE = { samples: 120, stanceBand: 0.03, minStance: 6, refRange: [1.5, 6] } as const;

/** per foot, the model-frame positions of the foot over one cycle of `run` (samples + 1 rows; root at the origin) */
export function footTracks(scene: Object3D, run: AnimationClip, feet: string[], scale = 1, clone = true): Vector3[][] | null {
  const model = clone ? cloneSkinned(scene) : scene;
  model.scale.setScalar(scale);
  const nodes = feet.map((b) => model.getObjectByName(PropertyBinding.sanitizeNodeName(b)) ?? model.getObjectByName(b));
  if (!nodes.length || nodes.some((n) => !n)) return null;
  const mixer = new AnimationMixer(model);
  const act = mixer.clipAction(run);
  act.play();
  const N = STRIDE.samples;
  const out: Vector3[][] = nodes.map(() => []);
  for (let i = 0; i <= N; i++) {
    act.time = (run.duration * i) / N;
    mixer.update(0);
    model.updateMatrixWorld(true);
    nodes.forEach((n, j) => out[j].push(n!.getWorldPosition(new Vector3())));
  }
  act.stop();
  mixer.uncacheRoot(model);
  return out;
}

/** the stance samples of the tracks: each planted foot's (vx, vz) in model m/s at clip rate 1 (+z = forward) */
export function stanceVelocities(tracks: Vector3[][], duration: number): { vx: number; vz: number }[] {
  const dt = duration / STRIDE.samples;
  const out: { vx: number; vz: number }[] = [];
  for (const p of tracks) {
    let minY = Infinity;
    for (const q of p) minY = Math.min(minY, q.y);
    for (let i = 0; i + 1 < p.length; i++) {
      if (p[i].y > minY + STRIDE.stanceBand || p[i + 1].y > minY + STRIDE.stanceBand) continue;
      out.push({ vx: (p[i + 1].x - p[i].x) / dt, vz: (p[i + 1].z - p[i].z) / dt });
    }
  }
  return out;
}

/** the run reference speed that plants the clip's feet best: the runRef whose playback rate gives the least median
 *  planted-foot world speed (the body moving at any speed s, the clip at s / runRef: the slip scales with s, so the
 *  best runRef does not depend on it), searched over STRIDE.refRange; null when unmeasurable */
export function plantedRunRef(scene: Object3D, run: AnimationClip | undefined, feet: string[], scale = 1): number | null {
  if (!run || feet.length === 0) return null;
  const tracks = footTracks(scene, run, feet, scale);
  if (!tracks) return null;
  const vs = stanceVelocities(tracks, run.duration);
  if (vs.length < STRIDE.minStance) return null;
  const buf = new Float64Array(vs.length);
  let best = -1, bestSlip = Infinity;
  for (let ref = STRIDE.refRange[0]; ref <= STRIDE.refRange[1] + 1e-9; ref += 0.01) {
    for (let i = 0; i < vs.length; i++) buf[i] = Math.hypot(vs[i].vx / ref, 1 + vs[i].vz / ref);
    buf.sort();
    const slip = buf[Math.floor(buf.length / 2)];
    if (slip < bestSlip - 1e-9) { bestSlip = slip; best = ref; }
  }
  return best > 0 ? best : null;
}

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
export function plantedRunRef(scene: Object3D, run: AnimationClip | undefined, feet: string[], scale = 1,
  range: readonly [number, number] = STRIDE.refRange): number | null {
  return measureStride(scene, run, feet, scale, range)?.ref ?? null;
}

/** orch1 W3-B: the first foot's touchdown as a share of the cycle: the start of its longest (cyclic) run of samples in the
 *  stance band. Run and walk are put on one phase by the difference of theirs (actors.ts) */
export function touchdown(track: Vector3[]): number {
  const N = STRIDE.samples;
  let minY = Infinity;
  for (const q of track) minY = Math.min(minY, q.y);
  const inb = (i: number): boolean => track[((i % N) + N) % N].y <= minY + STRIDE.stanceBand;
  let best = 0, at = 0;
  for (let i = 0; i < N; i++) {
    if (!inb(i) || inb(i - 1)) continue;
    let n = 0;
    while (n < N && inb(i + n)) n++;
    if (n > best) { best = n; at = i; }
  }
  return at / N;
}

/** plantedRunRef and the first foot's touchdown (one pass over the clip) */
export function measureStride(scene: Object3D, run: AnimationClip | undefined, feet: string[], scale = 1,
  range: readonly [number, number] = STRIDE.refRange): { ref: number; touchdown: number } | null {
  if (!run || feet.length === 0) return null;
  const tracks = footTracks(scene, run, feet, scale);
  if (!tracks) return null;
  const vs = stanceVelocities(tracks, run.duration);
  if (vs.length < STRIDE.minStance) return null;
  const buf = new Float64Array(vs.length);
  let best = -1, bestSlip = Infinity;
  for (let ref = range[0]; ref <= range[1] + 1e-9; ref += 0.01) {
    for (let i = 0; i < vs.length; i++) buf[i] = Math.hypot(vs[i].vx / ref, 1 + vs[i].vz / ref);
    buf.sort();
    const slip = buf[Math.floor(buf.length / 2)];
    if (slip < bestSlip - 1e-9) { bestSlip = slip; best = ref; }
  }
  return best > 0 ? { ref: best, touchdown: touchdown(tracks[0]) } : null;
}

// ── locomotion blend (orch1 W3-B, FU-9, ruling 68) ──────────────────────────────────────────────────────────────────────
// A slowed fighter walks: under LOCO.walkEdge × runRef the walk clip (anim.py gen_walk, authored for 0.4 × the run's
// speed) blends in, alone under LOCO.walkFull. Both clips put the left foot's contact near phase 0 and play on ONE shared
// phase, the walk offset by the difference of the two measured touchdowns (measureStride) so the feet land together; it advances at speed / (the blended cycle length), each clip's cycle length being its measured planted
// speed (walkRef / runRef, plantedRunRef) × its duration, so a planted foot stays put at any speed. Over LOCO.hasteFrom ×
// runRef the body leans into the run and pumps its arms (actors.ts LifeRig), full at LOCO.hasteFull. Presentation only.
export const LOCO = { walkFull: 0.55, walkEdge: 0.65, hasteFrom: 1.3, hasteFull: 1.7, walkRange: [0.6, 3] as const,
  /** a template whose blended pose slips more than this (% of speed, at walk weight `blendProbeW`) gets no walk and keeps
   *  the planted run at a lower timeScale, as live (W3-B fix round, ruling 70: the walk / run switch these bodies had
   *  glided in the renderer). The blend eases its weight at `wRate` per second */
  blendSlipMax: 15, blendProbeW: 0.8, wRate: 6,
  /** the shared phase's rate stays within these multiples of the blended clip's own rate (the run's old clamp) */
  minRate: 0.35, maxRate: 2.2 } as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** the walk's share of the locomotion blend at r = speed / runRef */
export const walkWeight = (r: number): number => clamp01((LOCO.walkEdge - r) / (LOCO.walkEdge - LOCO.walkFull));
/** the hasted lean's weight at r = speed / runRef */
export const hasteWeight = (r: number): number => clamp01((r - LOCO.hasteFrom) / (LOCO.hasteFull - LOCO.hasteFrom));

/** cycles per second of the shared run / walk phase for a body moving at `speed`: each clip is {ref: its planted speed,
 *  dur: its duration}; `w` the walk weight */
export function locoCycleRate(speed: number, run: { ref: number; dur: number }, walk: { ref: number; dur: number } | null, w: number): number {
  const ww = walk ? w : 0;
  const len = (1 - ww) * run.ref * run.dur + ww * (walk ? walk.ref * walk.dur : 0);
  const dur = (1 - ww) * run.dur + ww * (walk ? walk.dur : 0);
  const rate = speed / Math.max(1e-3, len);
  return Math.max(LOCO.minRate / dur, Math.min(LOCO.maxRate / dur, rate));
}

/** per foot, the model-frame positions over one shared cycle of the run / walk blend at walk weight `w` (the walk offset by
 *  `off` of a cycle, as the renderer plays it) */
export function blendFootTracks(scene: Object3D, run: AnimationClip, walk: AnimationClip, w: number, feet: string[], scale = 1,
  off = 0, clone = true): Vector3[][] | null {
  const model = clone ? cloneSkinned(scene) : scene;
  model.scale.setScalar(scale);
  const nodes = feet.map((b) => model.getObjectByName(PropertyBinding.sanitizeNodeName(b)) ?? model.getObjectByName(b));
  if (!nodes.length || nodes.some((n) => !n)) return null;
  const mixer = new AnimationMixer(model);
  const a = mixer.clipAction(run), b = mixer.clipAction(walk);
  a.play(); b.play(); a.setEffectiveWeight(1 - w); b.setEffectiveWeight(w);
  const out: Vector3[][] = nodes.map(() => []);
  for (let i = 0; i <= STRIDE.samples; i++) {
    const q = i / STRIDE.samples;
    a.time = q * run.duration; b.time = ((q + off) % 1) * walk.duration;
    mixer.update(0); model.updateMatrixWorld(true);
    nodes.forEach((n, j) => out[j].push(n!.getWorldPosition(new Vector3())));
  }
  mixer.stopAllAction(); mixer.uncacheRoot(model);
  return out;
}

/** the planted foot's median world speed (% of the body's) of the blend at walk weight w and speed ratio k = speed / runRef,
 *  the shared phase at the renderer's rate (locoCycleRate) */
export function blendSlipPct(tracks: Vector3[][], k: number, w: number, run: { ref: number; dur: number }, walk: { ref: number; dur: number }): number {
  const speed = k * run.ref, cyc = locoCycleRate(speed, run, walk, w);
  const st = stanceVelocities(tracks, 1);
  const v = st.map((q) => Math.hypot(q.vx * cyc, speed + q.vz * cyc)).sort((x, y) => x - y);
  return v.length ? (100 * v[Math.floor(v.length / 2)]) / speed : Infinity;
}

// HIT PARADE — throw victim presentation + carry, knockdown clip timing (CHANGED(fixer) D3; CONTRACT §20.2, §17 rule 3).
//
// Why: throws never moved the victim (sim x frozen for the whole lock), the shared thrown_f / thrown_b clip played at
// 1 clip-second per 60 frames whatever the attacker did (no slam sync, no match with the grab), the knockdown popped from
// the lying body to a standing kd_fall_b start / a sitting wake start, and the victim woke up inside the thrower.
//
// Victim during a lock (fighter state THROWN): the attacker's grab carries victim SEGMENTS (compile.ts CGrab.vF0/vClip/
// vT0/vT1; default = thrown_f / thrown_b with its slam mark on the grab's damage frame and its end on the release). For
// lock frame lf the victim shows shared clip vClip[k] at clip time t(lf); the sim writes that as a VIRTUAL anim frame
// round(t * 60) so the view's `animFrame / 60` (§17 rule 3, shared clips have no warp) samples exactly t. The victim's x
// follows the clips' own root travel (clips.json `root`, the forward hips travel the bake stripped out of the GLB), so the
// body lands where the clip throws it; a side-swap throw scales that path so the victim lands behind the thrower clear
// of both push boxes (F.thrDisp).
// Knockdown (state KNOCKDOWN, F.tot frames): fall clip (kd_fall_b / kd_fall_f from its drop - or its floor impact after a
// juggle - to its end, over <= fallMaxFrames; skipped when the victim is already down, F.kdFace NOFALL), lying loop, and
// the wake clip (wake_b / wake_f) timed to END on the actionable frame (<= wakeMaxRate x speed; a faster fit starts it
// later in the clip). Face-down endings (thrown_b, kd_fall_f) lie / wake face down.
// Everything here is integer math over the state + compiled tables (floats only in compile.ts): rollback-safe.

import { F, ST } from './layout.ts';
import { fb } from './state.ts';
import type { Match } from './state.ts';
import { V_END, V_OPEN, V_SLAM } from './compile.ts';
import type { CFighter, CGrab } from './compile.ts';
import { SHARED_CLIPS } from '../data.ts';

/** F.kdFace bits */
export const KDF = { DOWN: 1, NOFALL: 2, LANDED: 4 } as const;

const ID = (n: string): number => SHARED_CLIPS.indexOf(n);
export const CLIP = {
  thrown_f: ID('thrown_f'), thrown_b: ID('thrown_b'), kd_fall_b: ID('kd_fall_b'), kd_fall_f: ID('kd_fall_f'),
  kd_ground_b: ID('kd_ground_b'), kd_ground_f: ID('kd_ground_f'), wake_b: ID('wake_b'), wake_f: ID('wake_f'),
  crumple: ID('crumple'),
} as const;

/** clips whose END pose lies face down */
export function endsFaceDown(clip: number): boolean {
  return clip === CLIP.thrown_b || clip === CLIP.kd_fall_f || clip === CLIP.kd_ground_f || clip === CLIP.crumple;
}

// scratch segment table (max 8 segments)
const SF0 = new Int32Array(9);
const SCL = new Int32Array(8);
const ST0 = new Int32Array(8);
const ST1 = new Int32Array(8);

function durMs(cf: CFighter, clip: number): number {
  const c = cf.vclips[clip];
  return c ? c.durMs : 1000;
}

function rootAt(cf: CFighter, clip: number, tMs: number): number {
  const c = cf.vclips[clip];
  if (!c) return 0;
  const v = Math.trunc((tMs * 60 + 500) / 1000);
  return c.rootV[Math.max(0, Math.min(c.rootV.length - 1, v))];
}

function resolveT(cf: CFighter, clip: number, t: number): number {
  if (t === V_SLAM) {
    const c = cf.vclips[clip];
    return c && c.slamMs >= 0 ? c.slamMs : Math.trunc((durMs(cf, clip) * 55) / 100);
  }
  if (t === V_END) return durMs(cf, clip);
  return t;
}

/** Fill the scratch segments for victim d's current lock; returns the count (0 = none). */
function segments(m: Match, d: number): number {
  const s = m.s;
  const a = 1 - d;
  const ba = fb(a);
  const bd = fb(d);
  const vcf = m.cf[d];
  const tot = Math.max(1, s[bd + F.tot]);
  // the thrower's move as it was at the connect (its own F.mv clears when its lock ends, possibly on this very frame)
  const k = s[bd + F.thrMv];
  const mv = k >= 0 && k < m.cf[a].moves.length ? m.cf[a].moves[k] : null;
  const g: CGrab | null = mv ? mv.grab : null;
  let n = 0;
  if (g) {
    n = Math.min(8, g.vF0.length);
    for (let j = 0; j < n; j++) {
      SF0[j] = Math.min(tot, g.vF0[j]);
      SCL[j] = g.vClip[j];
      ST0[j] = g.vT0[j];
      ST1[j] = g.vT1[j];
    }
  } else {
    // a throw without a grab block: the victim is locked until the thrower's move ends; slam on the damage frame
    const clip = mv && mv.throwBack ? CLIP.thrown_b : CLIP.thrown_f;
    const dmgF = s[bd + F.thrSlam] > 0 ? s[bd + F.thrSlam] : Math.trunc(tot / 2);
    SF0[0] = 0; SCL[0] = clip; ST0[0] = 0; ST1[0] = V_SLAM;
    SF0[1] = Math.min(tot - 1, dmgF); SCL[1] = clip; ST0[1] = V_SLAM; ST1[1] = V_END;
    n = 2;
  }
  SF0[n] = tot;
  for (let j = 0; j < n; j++) {
    const c = SCL[j];
    const t0 = resolveT(vcf, c, ST0[j]);
    let t1 = ST1[j] === V_OPEN ? t0 + Math.trunc(((SF0[j + 1] - SF0[j]) * 1000) / 60) : resolveT(vcf, c, ST1[j]);
    t1 = Math.max(0, Math.min(durMs(vcf, c), t1));
    ST0[j] = Math.max(0, Math.min(durMs(vcf, c), t0));
    ST1[j] = t1;
  }
  return n;
}

/**
 * Victim d at its current lock frame: out[0] = shared anim id, out[1] = virtual anim frame (round(t * 60)),
 * out[2] = segment index, out[3] = carry displacement along the victim's facing (U), out[4] = final displacement
 * of the whole lock (U, unscaled clip travel), out[5] = the last segment's clip. Returns false when not in a lock.
 */
export function victimPose(m: Match, d: number, out: Int32Array): boolean {
  const s = m.s;
  const bd = fb(d);
  if (s[bd + F.st] !== ST.THROWN) return false;
  const n = segments(m, d);
  if (n <= 0) return false;
  const vcf = m.cf[d];
  const tot = Math.max(1, s[bd + F.tot]);
  const lf = Math.max(0, Math.min(tot, tot - s[bd + F.stun]));
  let cur = 0;
  while (cur + 1 < n && lf >= SF0[cur + 1]) cur++;
  const f0 = SF0[cur];
  const f1 = Math.max(f0 + 1, SF0[cur + 1]);
  const t = ST0[cur] + Math.trunc(((ST1[cur] - ST0[cur]) * Math.min(f1 - f0, lf - f0)) / (f1 - f0));
  let disp = 0;
  let total = 0;
  for (let j = 0; j < n; j++) {
    const segTravel = rootAt(vcf, SCL[j], ST1[j]) - rootAt(vcf, SCL[j], ST0[j]);
    total += segTravel;
    if (j < cur) disp += segTravel;
  }
  disp += rootAt(vcf, SCL[cur], t) - rootAt(vcf, SCL[cur], ST0[cur]);
  const want = s[bd + F.thrDisp];
  if (want !== 0) {
    // scale the clip's own path onto the target; a body without root data for these clips travels linearly
    if (total !== 0) disp = Math.trunc((disp * want) / total);
    else disp = Math.trunc((want * lf) / tot);
  }
  out[0] = SCL[cur];
  out[1] = Math.trunc((t * 60 + 500) / 1000);
  out[2] = cur;
  out[3] = disp;
  out[4] = total;
  out[5] = SCL[n - 1];
  return true;
}

/**
 * Knockdown anim for fighter i: out[0] = shared anim id, out[1] = virtual anim frame, out[2] = phase (0 fall, 1 lying,
 * 2 wake). Uses F.tot (total KD frames), F.stun (frames left), F.kdFace.
 */
export function knockdownPose(m: Match, i: number, out: Int32Array): void {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const tot = Math.max(1, s[b + F.tot]);
  const left = Math.max(0, s[b + F.stun]);
  const el = tot - left;
  const face = s[b + F.kdFace];
  const down = (face & KDF.DOWN) !== 0;
  const wf = m.sys.raw.kd.wakeupFrames;
  const fallClip = down ? CLIP.kd_fall_f : CLIP.kd_fall_b;
  const fallMax = cf.kdFallMax;
  const fallVis = (face & KDF.NOFALL) !== 0 ? 0 : Math.max(0, Math.min(fallMax, tot - wf - 2));
  const wakeClip = down ? CLIP.wake_f : CLIP.wake_b;
  const wDur = durMs(cf, wakeClip);
  const w1x = Math.max(1, Math.trunc((wDur * 60) / 1000));
  const W = Math.max(1, Math.min(w1x, tot - fallVis));
  if (el < fallVis) {
    const fd = durMs(cf, fallClip);
    const from = cf.kdFallMs[(down ? 2 : 0) + ((face & KDF.LANDED) !== 0 ? 1 : 0)];
    const t0 = Math.max(0, Math.min(fd, from));
    const t = t0 + Math.trunc(((fd - t0) * el) / fallVis);
    out[0] = fallClip;
    out[1] = Math.trunc((t * 60 + 500) / 1000);
    out[2] = 0;
    return;
  }
  if (left <= W) {
    const rate100 = cf.wakeRate100;
    // the clip span W frames can show at <= wakeMaxRate x speed; a longer clip starts later
    const span = Math.min(wDur, Math.trunc((W * 1000 * rate100) / (60 * 100)));
    const tStart = wDur - span;
    const t = tStart + Math.trunc((span * (W - left + 1)) / W);
    out[0] = wakeClip;
    out[1] = Math.trunc((Math.min(wDur, t) * 60 + 500) / 1000);
    out[2] = 2;
    return;
  }
  out[0] = down ? CLIP.kd_ground_f : CLIP.kd_ground_b;
  out[1] = el - fallVis;
  out[2] = 1;
}

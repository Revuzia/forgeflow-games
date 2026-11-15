// HIT PARADE - POSE FROM STATE (CONTRACT §7, §17 rules 2-4).
//
// Each rendered frame the fighter's pose is a pure function of the snapshot:
//   current = table[animId] sampled at animSeconds(entry, animFrame)   (move warp, or the loop rate)
//   prev    = table[prevAnimId] sampled at prevAnimFrame
//   pose    = prev * (1 - blendT) + current * blendT
// Every used clip has one AnimationAction on the fighter's own mixer; each frame this module writes `action.time`
// and the effective weight of the (at most two) live actions, zeroes every other action, and calls mixer.update(0).
// `update(0)` evaluates each action at exactly the time written (AnimationAction._updateTime returns `this.time`
// unchanged for a zero delta), so mixer time is NEVER accumulated: a rollback that rewinds the snapshot re-poses the
// fighter identically. Weights always sum to 1 (a sum below 1 would blend in the bind pose).

import * as THREE from 'three';
import { animSeconds } from './animtable.ts';
import type { AnimRef } from './types.ts';

export interface PoseInput { animId: number; animFrame: number; prevAnimId: number; prevAnimFrame: number; blendT: number }

export interface PoseReadback { clip: string; t: number; w: number; prevClip: string; prevT: number; prevW: number }

export class PoseDriver {
  readonly mixer: THREE.AnimationMixer;
  private readonly clips: Map<string, THREE.AnimationClip>;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private live: THREE.AnimationAction[] = [];
  private readonly fallback: string;
  /** what the last pose() applied (lab / harness read-back) */
  readonly last: PoseReadback = { clip: '', t: 0, w: 0, prevClip: '', prevT: 0, prevW: 0 };
  /** clip names a table referenced that the GLB lacks (reported once each) */
  readonly missing = new Set<string>();

  constructor(root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = clips;
    this.fallback = clips.has('idle') ? 'idle' : (clips.keys().next().value ?? '');
  }

  private action(name: string): THREE.AnimationAction | null {
    let a = this.actions.get(name);
    if (a) return a;
    let clip = this.clips.get(name);
    if (!clip) {
      if (name && !this.missing.has(name)) { this.missing.add(name); console.warn(`[view] clip "${name}" not in GLB; posing "${this.fallback}"`); }
      clip = this.clips.get(this.fallback);
      if (!clip) return null;
      name = this.fallback;
      a = this.actions.get(name);
      if (a) return a;
    }
    a = this.mixer.clipAction(clip);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
    a.enabled = true;
    a.setEffectiveTimeScale(1);
    a.setEffectiveWeight(0);
    a.play();
    this.actions.set(name, a);
    return a;
  }

  /** clip duration (s) or 0 */
  dur(name: string): number {
    const c = this.clips.get(name) ?? this.clips.get(this.fallback);
    return c ? c.duration : 0;
  }

  private entry(table: ReadonlyArray<AnimRef>, id: number): AnimRef | null {
    if (id >= 0 && id < table.length) return table[id];
    return table.length ? table[0] : null;
  }

  /** Pose the fighter from the snapshot fields (idempotent for identical input). */
  pose(table: ReadonlyArray<AnimRef>, s: PoseInput): void {
    const cur = this.entry(table, s.animId);
    if (!cur) return;
    let w = Number.isFinite(s.blendT) ? s.blendT : 1;
    w = w < 0 ? 0 : w > 1 ? 1 : w;
    const prev = w < 1 ? this.entry(table, s.prevAnimId) : null;
    const aCur = this.action(cur.clip);
    if (!aCur) return;
    const tCur = animSeconds(cur, s.animFrame, aCur.getClip().duration);
    let aPrev: THREE.AnimationAction | null = null, tPrev = 0;
    if (prev) {
      aPrev = this.action(prev.clip);
      if (aPrev) tPrev = animSeconds(prev, s.prevAnimFrame, aPrev.getClip().duration);
      if (aPrev === aCur) { aPrev = null; w = 1; }          // same clip both sides: one action carries it
    } else w = 1;
    for (const a of this.live) if (a !== aCur && a !== aPrev) a.setEffectiveWeight(0);
    aCur.time = tCur;
    aCur.setEffectiveWeight(w);
    this.live = aPrev ? [aCur, aPrev] : [aCur];
    if (aPrev) { aPrev.time = tPrev; aPrev.setEffectiveWeight(1 - w); }
    this.mixer.update(0);
    const L = this.last;
    L.clip = aCur.getClip().name; L.t = tCur; L.w = w;
    L.prevClip = aPrev ? aPrev.getClip().name : ''; L.prevT = tPrev; L.prevW = aPrev ? 1 - w : 0;
  }

  /**
   * P2 (PRIME TIME / outro blends): pose from an explicit weighted clip list `[{clip, t (s), w}]` (at most 4 entries).
   * Times are clip seconds already clamped / wrapped by the caller; weights are normalised to sum 1; the same clip
   * listed twice keeps the heavier entry's time (one action cannot sit at two times) with the summed weight.
   * Idempotent for identical input (never accumulates mixer time), like pose().
   */
  poseWeighted(list: ReadonlyArray<{ clip: string; t: number; w: number }>): void {
    let sum = 0;
    const acts: THREE.AnimationAction[] = [];
    const ts: number[] = [];
    const ws: number[] = [];
    for (const e of list) {
      if (!(e.w > 1e-4)) continue;
      const a = this.action(e.clip);
      if (!a) continue;
      const d = a.getClip().duration;
      const t = d > 0 ? Math.max(0, Math.min(d, e.t)) : 0;
      const k = acts.indexOf(a);
      if (k >= 0) { if (e.w > ws[k]) ts[k] = t; ws[k] += e.w; } else { acts.push(a); ts.push(t); ws.push(e.w); }
      sum += e.w;
    }
    if (!acts.length || sum <= 0) return;
    for (const a of this.live) if (acts.indexOf(a) < 0) a.setEffectiveWeight(0);
    for (let i = 0; i < acts.length; i++) { acts[i].time = ts[i]; acts[i].setEffectiveWeight(ws[i] / sum); }
    this.live = acts;
    this.mixer.update(0);
    let top = 0;
    for (let i = 1; i < acts.length; i++) if (ws[i] > ws[top]) top = i;
    const L = this.last;
    L.clip = acts[top].getClip().name; L.t = ts[top]; L.w = ws[top] / sum;
    const second = acts.length > 1 ? (top === 0 ? 1 : 0) : -1;
    L.prevClip = second >= 0 ? acts[second].getClip().name : ''; L.prevT = second >= 0 ? ts[second] : 0; L.prevW = second >= 0 ? ws[second] / sum : 0;
  }

  /** the weighted (clip, seconds) list pose() would apply for a snapshot (P2: lets FighterView mix overlays in) */
  entriesFor(table: ReadonlyArray<AnimRef>, s: PoseInput, out: Array<{ clip: string; t: number; w: number }>): void {
    out.length = 0;
    const cur = this.entry(table, s.animId);
    if (!cur) return;
    let w = Number.isFinite(s.blendT) ? s.blendT : 1;
    w = w < 0 ? 0 : w > 1 ? 1 : w;
    out.push({ clip: this.has(cur.clip) ? cur.clip : this.fallback, t: animSeconds(cur, s.animFrame, this.dur(cur.clip)), w });
    if (w < 1) {
      const prev = this.entry(table, s.prevAnimId);
      if (prev) out.push({ clip: this.has(prev.clip) ? prev.clip : this.fallback, t: animSeconds(prev, s.prevAnimFrame, this.dur(prev.clip)), w: 1 - w });
      else out[0].w = 1;
    }
  }

  has(name: string): boolean { return !!name && this.clips.has(name); }

  /** clip duration + loop-free sampling helper: seconds clamped into [0, dur] (or wrapped when `loop`) */
  clipTime(name: string, t: number, loop: boolean): number {
    const d = this.dur(name);
    if (!(d > 0)) return 0;
    if (loop) return ((t % d) + d) % d;
    return t < 0 ? 0 : t > d ? d : t;
  }

  /** Free-running pose for showcase / crowd baking (NOT sim-driven): clip at seconds t, full weight. */
  poseClip(name: string, t: number): void {
    const a = this.action(name);
    if (!a) return;
    for (const x of this.live) if (x !== a) x.setEffectiveWeight(0);
    const d = a.getClip().duration;
    a.time = d > 0 ? ((t % d) + d) % d : 0;
    a.setEffectiveWeight(1);
    this.live = [a];
    this.mixer.update(0);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const a of this.actions.values()) this.mixer.uncacheAction(a.getClip());
    this.actions.clear();
  }
}

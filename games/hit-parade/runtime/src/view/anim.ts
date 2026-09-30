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

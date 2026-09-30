// HIT PARADE - the Lv3 "PRIME TIME" director (CONTRACT §7, §17 rule 5, §20.2, §26.1 cinematic v2, §29 CHANGED(VIEW) P2).
//
// The sim plays a Lv3 as a fixed-length lock (both fighters frozen at their x, damage on `cinematic.hits` frames,
// SUPER_HIT events) and writes MatchSnap.cinematic {fighter, cueId, frame, frames}; a GRAB super (bruno) runs as a grab
// lock instead and the view drives the same block from the attacker's lock frame (§26.1). Everything the viewer SEES in
// those frames is authored here from the move's `cinematic` block and is a pure function of the cinematic frame, so both
// online peers show the same beats and a rollback re-poses it exactly.
//
// cinematic v2 (FIGHTERS §26.1, used literally when the block has `camera`):
//   * `anim` / `victim` [[f0, clip, fromS?, toS?]] - clip seconds fromS -> toS over the segment (toS omitted = 1 clip-s
//     per 60 frames from fromS), 4-frame crossfades; `pathA` [[f, dx, lift]] attacker root offset; `gapD` [[f, gap, lift]]
//     defender root = attacker view root + facing x gap (implicit first key = the actual gap), both wall-clamped;
//   * `camera` [{from, to, shot, target, fovDeg, dist, height, yawDeg, ease, roll?, lookH?, blend?}] (numbers or
//     [start, end] eased across the shot); `fx` [{f, fx, target?}] and `crowd` [{f, react, ratings?}] beats; `slate` text.
// cinematic v1 (P1 data: `anim` [[f0, clip]], `victim`, `shots` vocabulary names) - the view infers the rest:
//   strike marks warped onto the `hits` frames, reactions synced to the blows, carried victims (thrown_*), a physics victim
//   path that ends exactly at `endGapM`, the ROSTER shot vocabulary (view/cinematics.ts), per-cue FX beats (CUES).
// Both: letterbox, name slate, background dim / spotlight, crowd pops, stage-magic props (trapdoor, magician's sheet,
// Gazza's ball) from CUES, `slowmo_hold` shots / `freeze_frame` beats slow or hold the PRESENTATION (never the sim).

import * as THREE from 'three';
import { newLocalPose, sampleShot, type LocalPose, type ShotParams, type V3 } from './cinematics.ts';
import { footballMesh, sheetMesh, trapdoorMesh } from './propmesh.ts';

// ───────────────────────────────────────── data shapes ─────────────────────────────────────────

type Pair = ReadonlyArray<number | string>;
type Num2 = number | ReadonlyArray<number>;
export interface CamShot {
  from: number; to: number; shot?: string; target?: string; fovDeg?: Num2; dist?: Num2; height?: Num2; yawDeg?: Num2;
  ease?: string; roll?: Num2; lookH?: Num2; blend?: number;
}
export interface CineDef {
  frames: number;
  cue?: string;
  hits?: ReadonlyArray<ReadonlyArray<number>>;
  anim?: ReadonlyArray<Pair>;
  victim?: ReadonlyArray<Pair>;
  shots?: ReadonlyArray<Pair>;
  camera?: ReadonlyArray<CamShot>;
  pathA?: ReadonlyArray<ReadonlyArray<number>>;
  gapD?: ReadonlyArray<ReadonlyArray<number>>;
  fx?: ReadonlyArray<Pair | { f: number; fx: string; target?: string }>;
  crowd?: ReadonlyArray<{ f: number; react?: string; ratings?: string }>;
  ratings?: number | ReadonlyArray<number>;
  slate?: string;
  endPose?: string;
  endGapM?: number;
}
export interface ClipFact { dur: number; contact?: number | null; marks?: Record<string, number>; apexY?: number | null; loop?: boolean }
export interface PoseEntry { clip: string; t: number; w: number }

type BallAnchor = string;   // aFootR aFootL aHead aHand vChest vHead floorV+<m> up+<m> away hide
interface CueTweak {
  /** the v1 hit frames these frames were authored against (remapped onto the data's actual hits) */
  hitsRef: number[];
  framesRef: number;
  /** per shot-index ShotParams (v1 vocabulary shots) */
  shots?: Record<number, ShotParams>;
  /** default FX beats [[frame, name, dur?]] for v1 data (v2 data carries its own) */
  fx?: Array<[number, string, number?]>;
  vHide?: Array<[number, number]>;
  aHide?: Array<[number, number]>;
  /** additive root height ramps [f0, f1, y0, y1] (sinking into / rising out of a trapdoor) */
  vSink?: Array<[number, number, number, number]>;
  aSink?: Array<[number, number, number, number]>;
  /** victim dropped from height h at f0, lands at f1 */
  vDrop?: [number, number, number];
  /** victim pulled to gap g between f0 and f1 */
  vPull?: [number, number, number];
  /** attacker x offset ramps [f0, f1, dx0, dx1] (must end at 0) */
  aShift?: Array<[number, number, number, number]>;
  /** trapdoors: at the attacker / victim / mid x (+ dx), lid open / close / reopen frames, removed at `end` */
  trap?: Array<{ at: 'att' | 'vic' | 'mid'; dx?: number; open: number; close?: number; reopen?: number; end?: number }>;
  /** Zambini's sheet: drop at on, burst at off */
  sheet?: [number, number];
  /** Gazza's ball keys [[frame, anchor]] and its flaming window */
  ball?: Array<[number, BallAnchor]>;
  ballFire?: [number, number];
}

// ───────────────────────────────────────── per-cue authoring (v1 fallback, from _spec/ROSTER.md outlines) ─────────────────────────────────────────

export const CUES: Record<string, CueTweak> = {
  johnny_main_event: {
    hitsRef: [8, 24, 42, 62, 70, 78, 100, 128], framesRef: 170,
    shots: { 1: { dist: 0.95 }, 4: { dist: 1.05 } },
    fx: [[34, 'speedlines'], [56, 'dust_spin', 8], [100, 'speedlines'], [114, 'speedlines_att'], [128, 'slam'], [128, 'flash'], [140, 'crowd'], [142, 'confetti']],
  },
  patch_on_air: {
    hitsRef: [10, 35, 60, 85, 110, 135], framesRef: 160,
    shots: { 4: { sweep: 150 } },
    fx: [[10, 'speedlines'], [78, 'speedlines'], [102, 'dust_spin', 10], [135, 'slam'], [135, 'flash'], [146, 'crowd'], [148, 'confetti']],
  },
  bruno_final_delivery: {
    hitsRef: [30, 72, 140], framesRef: 175,
    shots: { 1: { sweep: 260, dist: 1.1 }, 2: { focus: 'att', aim: 0.8 }, 3: { dist: 1.1 } },
    fx: [[30, 'speedlines'], [40, 'dust_spin', 58], [100, 'glow', 18], [140, 'slam'], [140, 'flash'], [150, 'crowd'], [152, 'confetti']],
  },
  zambini_prestige: {
    hitsRef: [40, 80, 120], framesRef: 150,
    shots: { 1: { focus: 'mid', dist: 1.1 }, 2: { sweep: 20 }, 3: { focus: 'mid', aim: 0.4 }, 5: { dist: 1.2 } },
    fx: [[8, 'sparkle_vic'], [20, 'spotlight', 20], [40, 'doves'], [40, 'cards_vic'], [40, 'crowd'], [60, 'fire_burst_floor'], [66, 'doves'], [80, 'fire_burst_floor'],
      [100, 'smoke_att'], [112, 'smoke_high'], [122, 'slam'], [135, 'smoke_att'], [135, 'crowd'], [136, 'confetti']],
    sheet: [20, 40],
    vHide: [[40, 112]],
    vDrop: [112, 122, 4.2],
    aHide: [[112, 135]],
    aSink: [[100, 112, 0, -1.95]],
    trap: [{ at: 'att', open: 98, close: 114, end: 134 }],
  },
  krane_riot_act: {
    hitsRef: [25, 50, 75, 88, 100, 118], framesRef: 165,
    shots: { 2: { dist: 1.05 }, 3: { focus: 'mid' } },
    fx: [[0, 'metal', 108], [110, 'taser', 30], [118, 'flash'], [118, 'shockwave_vic'], [140, 'crowd']],
  },
  lotus_happy_hour: {
    hitsRef: [8, 48, 72, 98, 122], framesRef: 160,
    shots: { 1: { focus: 'att', dist: 0.9 }, 5: { focus: 'mid' } },
    fx: [[22, 'spotlight', 18], [40, 'speedlines'], [90, 'speedlines'], [115, 'flame_jet', 16], [122, 'fire_burst'], [122, 'flash'], [140, 'crowd']],
  },
  boneyard_sunday_roast: {
    hitsRef: [8, 32, 50, 70, 90, 128], framesRef: 170,
    shots: { 3: { focus: 'att', aim: 0.5 } },
    fx: [[0, 'metal', 100], [100, 'speedlines_att'], [128, 'slam'], [128, 'flash'], [145, 'crowd']],
  },
  spin_battle: {
    hitsRef: [8, 28, 34, 55, 80, 108, 134], framesRef: 165,
    shots: { 2: { dist: 0.9 }, 4: { sweep: 160 } },
    fx: [[22, 'dust_spin', 26], [48, 'dust_spin', 20], [128, 'dust_spin', 18], [128, 'speedlines'], [148, 'crowd'], [149, 'confetti']],
  },
  gazza_hat_trick: {
    hitsRef: [10, 40, 70, 128], framesRef: 165,
    shots: { 3: { focus: 'mid', aim: 0.5, dist: 0.9 }, 4: { focus: 'att' } },
    fx: [[110, 'speedlines_att'], [128, 'fire_burst'], [128, 'flash'], [148, 'crowd'], [149, 'confetti']],
    ball: [[0, 'aFootR'], [9, 'aFootR'], [11, 'vChest'], [20, 'floorV+0.7'], [27, 'away'], [28, 'hide'], [31, 'aFootR'], [38, 'aFootR'], [41, 'vChest'],
      [52, 'up+2.3'], [68, 'aHead'], [71, 'vHead'], [80, 'floorV+0.9'], [88, 'hide'], [90, 'aFootR'], [97, 'up+1.5'], [104, 'aFootR'], [113, 'up+2.9'],
      [126, 'aFootR'], [129, 'vChest'], [140, 'away'], [141, 'hide']],
    ballFire: [126, 141],
  },
  rerun_series_finale: {
    hitsRef: [30, 60, 100, 130], framesRef: 170,
    shots: { 2: { focus: 'mid', dist: 1.05 }, 3: { focus: 'mid' }, 4: { focus: 'att' } },
    fx: [[25, 'speedlines'], [80, 'dust'], [130, 'slam_trap'], [140, 'smoke_att'], [150, 'dust'], [152, 'crowd']],
    vPull: [80, 88, 0.62],
    vSink: [[88, 118, 0, -1.9], [150, 156, -1.2, 0]],
    vHide: [[118, 150]],
    aShift: [[100, 120, 0, 0.3], [150, 166, 0.3, 0]],
    aSink: [[120, 130, 0, -2.0], [140, 164, -2.0, 0]],
    aHide: [[130, 140]],
    trap: [{ at: 'att', dx: 0.45, open: 80, close: 131, reopen: 140, end: 169 }],
  },
  freak_specimen_13: {
    hitsRef: [35, 65, 95, 150], framesRef: 175,
    shots: { 1: { focus: 'mid' }, 2: { dist: 1.1 } },
    fx: [[35, 'speedlines'], [55, 'slam'], [85, 'slam'], [120, 'shockwave'], [120, 'lights_flicker', 30], [150, 'flash'], [150, 'crowd']],
  },
  ricky_prime_time: {
    hitsRef: [20, 50, 80, 140], framesRef: 170,
    shots: { 3: { dist: 1.1 } },
    fx: [[20, 'speedlines'], [30, 'metal', 60], [110, 'spotlight', 20], [110, 'glow', 20], [110, 'shockwave'], [140, 'slam'], [140, 'flash'], [150, 'crowd'], [151, 'confetti']],
  },
  ricky_season_finale: {
    hitsRef: [25, 60, 95, 150], framesRef: 180,
    shots: { 0: { dist: 1.15 }, 3: { sweep: 200 } },
    fx: [[0, 'pyro', 44], [25, 'slam'], [45, 'metal', 40], [80, 'dust_spin', 30], [120, 'glow', 20], [140, 'sparks_rain'], [150, 'slam'], [150, 'flash'],
      [160, 'pyro', 20], [160, 'confetti_big'], [160, 'crowd']],
  },
};

/** CONTRACT §26.1 v2 `fx` vocabulary -> the view's beat names (+ default duration) */
const FX_V2: Record<string, [string, number]> = {
  impact_s: ['impact_s', 0], impact_m: ['impact_m', 0], impact_l: ['impact_l', 0], splat: ['splat', 0], smear: ['smear', 8], dust: ['dust', 0],
  shock_ring: ['shockwave', 0], fire: ['fire_burst', 0], electric: ['taser', 30], sparks: ['sparks', 0], smoke: ['smoke', 0], doves: ['doves', 0],
  cards: ['cards', 0], ball_trail: ['ball_trail', 20], flash: ['flash', 0], shake_s: ['shake_s', 0], shake_m: ['shake_m', 0], shake_l: ['shake_l', 0],
  speed_lines: ['speedlines', 0], zoom_lines: ['zoomlines', 0], freeze_frame: ['freeze', 20], letterbox: ['letterbox', 0], letterbox_off: ['letterbox_off', 0],
  slate: ['slate', 0], dim: ['dim', 0], undim: ['undim', 0], spot: ['spot', 0], spot_off: ['spot_off', 0], lights_flicker: ['lights_flicker', 30],
  pyro: ['pyro', 40], confetti: ['confetti', 0],
};
const REACT: Record<string, number> = { ooh: 0.4, gasp: 0.55, cheer: 0.85, roar: 1.15, boo: 0.5, laugh: 0.45, hush: 0.0, chant: 0.7, applause: 0.75 };
const RATINGS: Record<string, number> = { up: 0.25, spike: 0.5, peak: 0.8 };

// ───────────────────────────────────────── helpers ─────────────────────────────────────────

const GROUND_HIT = /^(hit_high_s|hit_high_l|hit_body|hit_low|crumple)$/;
const FALL = /^kd_fall_/;
const LIE = /^kd_ground_/;
const CARRY = /^thrown_/;
const DESCEND = /hammer|leap|drop|slam|stomp/;
const LOOP_VICTIM = /^(dizzy|kd_ground_b|kd_ground_f)$/;

function smooth(t: number): number { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); }
function easeK(kind: string | undefined, u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  switch (kind) {
    case 'linear': return x;
    case 'in': return x * x;
    case 'out': return 1 - (1 - x) * (1 - x);
    case 'hold': return 0;
    default: return x * x * (3 - 2 * x);
  }
}
function val(v: Num2 | undefined, dflt: number, k: number): number {
  if (typeof v === 'number') return v;
  if (v && v.length >= 2) return v[0] + (v[1] - v[0]) * k;
  if (v && v.length === 1) return v[0];
  return dflt;
}
function inRanges(f: number, r: ReadonlyArray<ReadonlyArray<number>> | undefined): boolean {
  if (!r) return false;
  for (const x of r) if (f >= x[0] && f < x[1]) return true;
  return false;
}
function ramp(f: number, r: ReadonlyArray<ReadonlyArray<number>> | undefined): number {
  if (!r) return 0;
  let v = 0;
  for (const x of r) {
    const [f0, f1, a, b] = x;
    if (f >= f0 && f < f1) return a + (b - a) * smooth((f - f0) / Math.max(1, f1 - f0));
    if (f >= f1) v = b;
  }
  return v;
}
function segsOf(list: ReadonlyArray<Pair> | undefined): Array<{ f0: number; clip: string; fromS?: number; toS?: number }> {
  const out: Array<{ f0: number; clip: string; fromS?: number; toS?: number }> = [];
  for (const p of list ?? []) {
    if (typeof p[0] !== 'number' || typeof p[1] !== 'string') continue;
    out.push({ f0: p[0], clip: p[1], fromS: typeof p[2] === 'number' ? p[2] : undefined, toS: typeof p[3] === 'number' ? p[3] : undefined });
  }
  return out.sort((a, b) => a.f0 - b.f0);
}
function pwl3(keys: ReadonlyArray<ReadonlyArray<number>>, f: number, out: [number, number]): [number, number] {
  // [[f, a, b], ...] piecewise linear, holds after the last key, before the first -> the first
  if (!keys.length) { out[0] = 0; out[1] = 0; return out; }
  if (f <= keys[0][0]) { out[0] = keys[0][1]; out[1] = keys[0][2] ?? 0; return out; }
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (f <= b[0]) { const u = (f - a[0]) / Math.max(1e-6, b[0] - a[0]); out[0] = a[1] + (b[1] - a[1]) * u; out[1] = (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * u; return out; }
  }
  const l = keys[keys.length - 1];
  out[0] = l[1]; out[1] = l[2] ?? 0;
  return out;
}

interface ASeg { f0: number; f1: number; clip: string; dur: number; loop: boolean; fromS?: number; toS?: number; warp: Array<[number, number]> | null; apexY: number; contact: number | null; descend: boolean }
interface VSeg { f0: number; start: number; f1: number; clip: string; dur: number; loop: boolean; fromS?: number; toS?: number; trig: number[]; carry: 0 | 1 | 2; fling: boolean }
export interface Beat { f: number; name: string; dur: number; target: string; amount: number }

export interface PrimePlan {
  key: string;
  cue: string;
  v2: boolean;
  /** true = the sim carries the victim (grab supers): no victim pose / position override */
  simVictim: boolean;
  frames: number;
  P: Float32Array;              // presentation time (frames) at each sim frame
  rate: Float32Array;
  eff: Int16Array;              // the frame whose picture is shown (freeze_frame holds)
  att: ASeg[];
  vic: VSeg[];
  shots: Array<{ f0: number; f1: number; name: string; p?: ShotParams }>;
  cams: CamShot[];
  beats: Beat[];
  hits: Array<[number, number]>;
  AX: Float32Array; AY: Float32Array;   // v2 pathA per frame
  G: Float32Array; Y: Float32Array; carry: Uint8Array;
  wallSplatAt: number;
  wallSide: number;
  tweak: CueTweak;
  remap: (f: number) => number;
  gap0: number; endGap: number; wallDist: number;
  attPre: { clip: string; t: number } | null;
  vicPre: { clip: string; t: number } | null;
  hA: number; hV: number;
  moveName: string; fighterName: string; slate: string;
  letterbox: Uint8Array; spot: Int8Array; dimOv: Int8Array; slateAt: number; freezeAt: number[];
}

export interface PrimeSample {
  f: number;
  shot: string; shotIdx: number;
  att: PoseEntry[]; attY: number; attDx: number; attVisible: boolean;
  vic: PoseEntry[]; vicGap: number; vicY: number; vicVisible: boolean; carry: 0 | 1 | 2; carryBlend: number;
  /** world-space camera (v2) or attacker-frame camera (v1: `camLocal` true) */
  cam: LocalPose; camLocal: boolean;
  ts: number; dim: number; spot: number; spotOnVictim: boolean; letterbox: number; slate: number; crowdBoost: number; freeze: number;
}

export interface PrimeBegin {
  def: CineDef;
  moveKey: string;
  moveName: string;
  fighterName: string;
  attFacts: Record<string, ClipFact>;
  vicFacts: Record<string, ClipFact>;
  attDur: (clip: string) => number;
  vicDur: (clip: string) => number;
  gap0: number;
  ax: number;
  facing: number;
  attPre: { clip: string; t: number } | null;
  vicPre: { clip: string; t: number } | null;
  hA: number; hV: number;
  simVictim?: boolean;
}

function remapper(ref: number[], refN: number, hits: number[], n: number): (f: number) => number {
  const k = Math.min(ref.length, hits.length);
  const xs = [0], ys = [0];
  for (let i = 0; i < k; i++) if (ref[i] > xs[xs.length - 1] && hits[i] > ys[ys.length - 1]) { xs.push(ref[i]); ys.push(hits[i]); }
  if (refN > xs[xs.length - 1] && n > ys[ys.length - 1]) { xs.push(refN); ys.push(n); }
  return (f: number) => {
    if (f <= 0) return f;
    for (let i = 1; i < xs.length; i++) if (f <= xs[i]) return Math.round(ys[i - 1] + (ys[i] - ys[i - 1]) * ((f - xs[i - 1]) / (xs[i] - xs[i - 1])));
    return Math.round(f + (ys[ys.length - 1] - xs[xs.length - 1]));
  };
}

function remapTweak(t: CueTweak, R: (f: number) => number): CueTweak {
  const r2 = (a: [number, number]): [number, number] => [R(a[0]), R(a[1])];
  const r4 = (a: [number, number, number, number]): [number, number, number, number] => [R(a[0]), R(a[1]), a[2], a[3]];
  return {
    ...t,
    fx: t.fx?.map((b) => [R(b[0]), b[1], b[2]] as [number, string, number?]),
    vHide: t.vHide?.map(r2), aHide: t.aHide?.map(r2), vSink: t.vSink?.map(r4), aSink: t.aSink?.map(r4), aShift: t.aShift?.map(r4),
    vDrop: t.vDrop ? [R(t.vDrop[0]), R(t.vDrop[1]), t.vDrop[2]] : undefined,
    vPull: t.vPull ? [R(t.vPull[0]), R(t.vPull[1]), t.vPull[2]] : undefined,
    trap: t.trap?.map((x) => ({ ...x, open: R(x.open), close: x.close !== undefined ? R(x.close) : undefined, reopen: x.reopen !== undefined ? R(x.reopen) : undefined, end: x.end !== undefined ? R(x.end) : undefined })),
    sheet: t.sheet ? r2(t.sheet) : undefined,
    ball: t.ball?.map((b) => [R(b[0]), b[1]] as [number, string]),
    ballFire: t.ballFire ? r2(t.ballFire) : undefined,
  };
}

/** compile a cinematic block into a frame-indexed plan (pure) */
export function compilePlan(b: PrimeBegin): PrimePlan {
  const def = b.def;
  const N = Math.max(2, def.frames | 0);
  const cue = def.cue ?? '';
  const v2 = Array.isArray(def.camera) && def.camera.length > 0;
  const hits: Array<[number, number]> = (def.hits ?? []).filter((h) => typeof h[0] === 'number').map((h) => [h[0], h[1] ?? 0] as [number, number]).sort((a, c) => a[0] - c[0]);
  const base = CUES[cue];
  const R = base ? remapper(base.hitsRef, base.framesRef, hits.map((h) => h[0]), N) : (f: number) => f;
  const tweak: CueTweak = base ? remapTweak(base, R) : { hitsRef: [], framesRef: N };
  // shots (v1 vocabulary) and camera (v2)
  const shotsL = segsOf(def.shots);
  const shots = shotsL.map((s, i) => ({ f0: s.f0, f1: i + 1 < shotsL.length ? shotsL[i + 1].f0 : N, name: s.clip, p: v2 ? undefined : tweak.shots?.[i] }));
  if (!shots.length || shots[0].f0 > 0) shots.unshift({ f0: 0, f1: shots.length ? shots[0].f0 : N, name: 'side_close', p: undefined });
  const cams = v2 ? [...def.camera!].sort((a, c) => a.from - c.from) : [];
  // beats (fx + crowd + ratings + crowd_pop shots + per-cue defaults on v1)
  const beats: Beat[] = [];
  let hasLetterboxBeat = false, hasSlateBeat = false;
  for (const e of def.fx ?? []) {
    if (Array.isArray(e)) {
      if (typeof e[0] === 'number' && typeof e[1] === 'string') beats.push({ f: e[0], name: e[1], dur: typeof e[2] === 'number' ? e[2] : 0, target: '', amount: 1 });
    } else {
      const o = e as { f: number; fx: string; target?: string };
      const m = FX_V2[o.fx];
      if (!m) continue;
      if (m[0] === 'letterbox' || m[0] === 'letterbox_off') hasLetterboxBeat = true;
      if (m[0] === 'slate') hasSlateBeat = true;
      beats.push({ f: o.f, name: m[0], dur: m[1], target: o.target ?? '', amount: 1 });
    }
  }
  if (!v2 && !(def.fx && def.fx.length)) for (const x of tweak.fx ?? []) beats.push({ f: x[0], name: x[1], dur: x[2] ?? 0, target: '', amount: 1 });
  for (const c of def.crowd ?? []) beats.push({ f: c.f, name: 'crowd', dur: 0, target: '', amount: REACT[c.react ?? 'cheer'] ?? 0.8 + (RATINGS[c.ratings ?? ''] ?? 0) });
  const rat = def.ratings;
  for (const r of typeof rat === 'number' ? [rat] : rat ?? []) beats.push({ f: r, name: 'crowd', dur: 0, target: '', amount: 1 });
  if (!v2) for (const s of shots) if (s.name === 'crowd_pop') beats.push({ f: s.f0, name: 'crowd', dur: 0, target: '', amount: 1.2 });
  // presentation time: slowmo_hold shots crawl at x0.3; freeze_frame beats hold the picture
  const rate = new Float32Array(N);
  for (let f = 0; f < N; f++) rate[f] = 1;
  for (const s of shots) if (!v2 && s.name === 'slowmo_hold') for (let f = s.f0; f < Math.min(N, s.f1); f++) rate[f] = 0.3;
  const P = new Float32Array(N + 1);
  for (let f = 0; f < N; f++) P[f + 1] = P[f] + rate[f];
  const eff = new Int16Array(N);
  for (let f = 0; f < N; f++) eff[f] = f;
  const freezeAt: number[] = [];
  // a freeze-frame still ends at the next camera cut (the cut goes back to "live")
  const cuts = (v2 ? cams.map((c) => c.from) : shots.map((q) => q.f0)).sort((a, c) => a - c);
  for (const bt of beats) {
    if (bt.name !== 'freeze') continue;
    freezeAt.push(bt.f);
    const nextCut = cuts.find((c) => c > bt.f) ?? N;
    for (let f = bt.f; f < Math.min(N, bt.f + (bt.dur || 20), nextCut); f++) eff[f] = bt.f;
  }
  // letterbox / spot / dim / slate timelines
  const letterbox = new Uint8Array(N);
  const spot = new Int8Array(N);     // 0 off, 1 attacker, 2 defender
  const dimOv = new Int8Array(N);    // 0 shot default, 1 dim
  let lb = hasLetterboxBeat ? 0 : 1, sp = 0, dm = 0;
  const sorted = beats.slice().sort((a, c) => a.f - c.f);
  let bi = 0;
  for (let f = 0; f < N; f++) {
    while (bi < sorted.length && sorted[bi].f <= f) {
      const x = sorted[bi++];
      if (x.name === 'letterbox') lb = 1; else if (x.name === 'letterbox_off') lb = 0;
      else if (x.name === 'spot') sp = x.target === 'attacker' ? 1 : 2; else if (x.name === 'spot_off') sp = 0;
      else if (x.name === 'dim') dm = 1; else if (x.name === 'undim') dm = 0;
    }
    letterbox[f] = lb; spot[f] = sp; dimOv[f] = dm;
    if (!v2) {
      const s = shots.find((q) => f >= q.f0 && f < q.f1);
      if (s?.name === 'spotlight') spot[f] = 1;
      for (const q of beats) if (q.name === 'spotlight' && f >= q.f && f < q.f + Math.max(1, q.dur)) spot[f] = 1;
    }
  }
  const slateAt = hasSlateBeat ? beats.find((q) => q.name === 'slate')!.f : 6;
  // attacker segments
  const aL = segsOf(def.anim);
  const att: ASeg[] = aL.map((s, i) => {
    const f1 = i + 1 < aL.length ? aL[i + 1].f0 : N;
    const fact = b.attFacts[s.clip];
    const dur = b.attDur(s.clip) || fact?.dur || 1;
    let warp: Array<[number, number]> | null = null;
    if (!v2 && s.fromS === undefined) {
      // v1: warp the clip's strike marks onto the hit frames inside the segment
      const hs = hits.filter((h) => h[0] >= s.f0 && h[0] < f1).map((h) => h[0]);
      const marks = fact?.marks ? Object.keys(fact.marks).filter((k) => /^hit\d+$/.test(k)).map((k) => fact.marks![k]).sort((x, y) => x - y) : [];
      const strikes = marks.length ? marks : typeof fact?.contact === 'number' ? [fact.contact] : [];
      warp = [[0, 0]];
      for (let k = 0; k < Math.min(hs.length, strikes.length); k++) {
        const dp = P[hs[k]] - P[s.f0], ts = strikes[k];
        const [lp, lt] = warp[warp.length - 1];
        const r = (ts - lt) / Math.max(1e-3, (dp - lp) / 60);
        if (dp > lp && ts > lt && r > 0.4 && r < 2.6) warp.push([dp, ts]);
      }
    }
    return { f0: s.f0, f1, clip: s.clip, dur, loop: !!fact?.loop, fromS: s.fromS, toS: s.toS, warp,
      apexY: !v2 && fact?.apexY && fact.apexY > 0.05 ? fact.apexY : 0, contact: typeof fact?.contact === 'number' ? fact.contact : null, descend: DESCEND.test(s.clip) };
  });
  // victim segments
  const vL = segsOf(def.victim);
  const vic: VSeg[] = vL.map((s, i) => {
    const f1 = i + 1 < vL.length ? vL[i + 1].f0 : N;
    const hs = hits.filter((h) => h[0] >= s.f0 && h[0] < f1).map((h) => h[0]);
    let start = s.f0, trig = [s.f0];
    if (!v2 && s.fromS === undefined) {
      const first = hs.find((h) => h - s.f0 <= 12);
      const syncable = GROUND_HIT.test(s.clip) || s.clip === 'hit_air';
      start = syncable && first !== undefined ? Math.max(s.f0, first - 1) : s.f0;
      trig = [start, ...hs.filter((h) => h > start + 2)];
    }
    const next = i + 1 < vL.length ? vL[i + 1].clip : '';
    return { f0: s.f0, start, f1, clip: s.clip, dur: b.vicDur(s.clip) || b.vicFacts[s.clip]?.dur || 0.5, loop: LOOP_VICTIM.test(s.clip), fromS: s.fromS, toS: s.toS,
      trig, carry: 0 as 0 | 1 | 2, fling: !v2 && next === 'wall_splat' };
  });
  if (!v2) for (let i = 0; i < vic.length; i++) {
    const s = vic[i];
    if (CARRY.test(s.clip)) s.carry = 1;
    else if (s.clip === 'hit_air' && i > 0 && vic[i - 1].carry && !hits.some((h) => h[0] >= s.f0 && h[0] < s.f0 + 8)) s.carry = 2;
  }
  const wallSide = b.facing > 0 ? 1 : 0;
  const wallDist = b.facing > 0 ? 7.55 - b.ax : b.ax + 7.55;
  const endGap = Math.max(0.5, Math.min(def.endGapM ?? 2.0, wallDist));
  const G = new Float32Array(N), Y = new Float32Array(N), carry = new Uint8Array(N);
  const AX = new Float32Array(N), AY = new Float32Array(N);
  let wallSplatAt = -1;
  const tmp2: [number, number] = [0, 0];
  if (v2) {
    const pa = def.pathA ?? [];
    const gd = [[0, Math.max(0.4, b.gap0), 0], ...(def.gapD ?? []).filter((k) => k[0] >= 1)];
    for (let f = 0; f < N; f++) {
      pwl3(pa.length ? [[0, 0, 0], ...pa.filter((k) => k[0] >= 1)] : [], f, tmp2); AX[f] = tmp2[0]; AY[f] = tmp2[1];
      pwl3(gd, f, tmp2); G[f] = tmp2[0]; Y[f] = tmp2[1];
    }
  } else {
    const wallReach = wallDist <= 5.2;
    const W = new Float32Array(N);
    const segAt = (f: number): VSeg | null => { let s: VSeg | null = null; for (const x of vic) if (x.start <= f) s = x; return s; };
    let g = Math.max(0.5, Math.min(2.6, b.gap0)), y = 0, vy = 0, vx = 0, inAir = false, wasCarry = false;
    let flingFrom = -1;
    for (let f = 0; f < N; f++) {
      const s = segAt(f);
      const clip = s?.clip ?? 'hit_high_s';
      const dt = rate[f] / 60;
      if (s && s.fling) {
        const flyAt = s.start + Math.round((s.f1 - s.start) * 0.55);
        if (f < flyAt) { carry[f] = 1; g = 0.62; y = 0; vx = vy = 0; inAir = false; wasCarry = true; G[f] = g; Y[f] = y; W[f] = 0; continue; }
        if (flingFrom < 0) flingFrom = f;
        const u = (f - flingFrom + 1) / Math.max(1, s.f1 - flingFrom);
        const target = wallReach ? wallDist - 0.25 : endGap;
        g = 0.62 + (target - 0.62) * u; y = 0.55 + (0.35 - 0.55) * u + 0.5 * 4 * u * (1 - u);
        inAir = true; vy = -2; G[f] = g; Y[f] = y; W[f] = 0; wasCarry = false;
        continue;
      }
      if (clip === 'wall_splat' && wallReach) {
        if (wallSplatAt < 0) wallSplatAt = f;
        const u = (f - wallSplatAt) / 18;
        y = Math.max(0, 0.35 * (1 - smooth(u))); inAir = false; vx = 0;
        G[f] = g; Y[f] = y; W[f] = 1; continue;
      }
      if (s && s.carry) { carry[f] = s.carry; g = 0.62; y = s.carry === 2 ? 0.9 : 0; vx = vy = 0; inAir = false; wasCarry = true; G[f] = g; Y[f] = y; W[f] = 0; continue; }
      if (wasCarry) { wasCarry = false; g = 0.62; if (clip === 'hit_air' || FALL.test(clip) || clip === 'wall_splat') { y = Math.max(y, 0.6); inAir = true; vy = 0; } }
      if (s && s.start === f && (FALL.test(clip) || clip === 'wall_splat') && !inAir) vx = Math.max(vx, 1.3);
      for (const h of hits) {
        if (h[0] !== f) continue;
        if (clip === 'hit_air' || FALL.test(clip)) { vy = inAir ? 4.3 : 5.8; inAir = true; vx = Math.max(vx, 1.5); }
        else if (LIE.test(clip)) { if (inAir) vy = -9; }
        else vx = Math.max(vx, 1.9);
      }
      if (inAir) { vy -= 17 * dt; y += vy * dt; if (y <= 0) { y = 0; vy = 0; inAir = false; } }
      if (LIE.test(clip) && y > 0 && !inAir) y = Math.max(0, y - 8 * dt);
      g += vx * dt;
      vx *= Math.exp(-(LIE.test(clip) ? 12 : 5) * dt);
      g = Math.max(0.45, g);
      G[f] = g; Y[f] = y;
      W[f] = inAir ? 1 : vx > 0.25 ? 0.6 : LIE.test(clip) ? 0.03 : 0.15;
    }
    // end exactly where the sim puts the victim: spread the difference over the flight / knockback frames
    let last = N - 1;
    while (last > 0 && carry[last]) last--;
    const d = endGap - G[last];
    if (Math.abs(d) > 1e-3) {
      const cw = new Float32Array(N);
      let acc = 0;
      for (let f = 0; f < N; f++) { acc += carry[f] ? 0 : (wallSplatAt >= 0 ? (f > wallSplatAt + 6 ? 1 : 0) : W[f]); cw[f] = acc; }
      if (acc > 0) for (let f = 0; f < N; f++) if (!carry[f]) G[f] = Math.max(0.45, G[f] + d * cw[f] / acc);
    }
    if (tweak.vPull) {
      const [f0, f1, tg] = tweak.vPull;
      const until = tweak.vSink?.[1]?.[0] ?? N;
      for (let f = f0; f < N; f++) { const u = smooth((f - f0) / Math.max(1, f1 - f0)); if (f < f1) G[f] = G[f] + (tg - G[f]) * u; else if (f < until) G[f] = tg; }
    }
    if (tweak.vDrop) {
      const [f0, f1, h] = tweak.vDrop;
      for (let f = f0; f < Math.min(N, f1); f++) { const u = (f - f0) / Math.max(1, f1 - f0); Y[f] = h * (1 - u * u); }
    }
    for (let f = 0; f < N; f++) { AX[f] = ramp(f, tweak.aShift); AY[f] = ramp(f, tweak.aSink); }
    if (wallSplatAt >= 0) beats.push({ f: wallSplatAt, name: 'wall_splat', dur: 0, target: '', amount: 1 });
  }
  beats.sort((a, c) => a.f - c.f);
  // slate text: the data's line (v2), else "PRIME TIME" + move name + fighter
  let slate = def.slate ?? '';
  if (!slate) slate = `${b.fighterName}: ${b.moveName}`;
  return {
    key: `${cue}:${b.moveKey}`, cue, v2, simVictim: !!b.simVictim, frames: N, P, rate, eff, att, vic, shots, cams, beats, hits, AX, AY, G, Y, carry, wallSplatAt, wallSide,
    tweak, remap: R, gap0: b.gap0, endGap, wallDist, attPre: b.attPre, vicPre: b.vicPre, hA: b.hA, hV: b.hV, moveName: b.moveName, fighterName: b.fighterName, slate,
    letterbox, spot, dimOv, slateAt, freezeAt,
  };
}

function warpEval(w: Array<[number, number]>, dp: number): number {
  if (dp <= 0) return 0;
  for (let i = 1; i < w.length; i++) {
    if (dp <= w[i][0]) { const [p0, t0] = w[i - 1], [p1, t1] = w[i]; return t0 + (t1 - t0) * ((dp - p0) / Math.max(1e-6, p1 - p0)); }
  }
  const [pl, tl] = w[w.length - 1];
  return tl + (dp - pl) / 60;
}

function clipT(dur: number, loop: boolean, t: number): number { return loop ? ((t % dur) + dur) % dur : Math.max(0, Math.min(dur, t)); }

function segTime(p: PrimePlan, s: ASeg, f: number): number {
  const dp = p.P[f] - p.P[s.f0];
  if (s.fromS !== undefined || s.toS !== undefined) {
    const a = s.fromS ?? 0;
    if (s.toS !== undefined) return clipT(s.dur, false, a + (s.toS - a) * Math.min(1, dp / Math.max(1, s.f1 - s.f0)));
    return clipT(s.dur, s.loop, a + dp / 60);
  }
  return clipT(s.dur, s.loop, s.warp ? warpEval(s.warp, dp) : dp / 60);
}

function airLift(s: ASeg, t: number): number {
  if (!s.apexY) return 0;
  let a: number, b: number;
  if (s.contact !== null && s.descend) { a = Math.max(0, s.contact - 0.5); b = s.contact; }
  else if (s.contact !== null) { a = Math.max(0, s.contact - 0.3); b = Math.min(s.dur, s.contact + 0.3); }
  else { a = s.dur * 0.15; b = s.dur * 0.85; }
  if (t <= a || t >= b) return 0;
  const u = (t - a) / (b - a);
  return s.apexY * 4 * u * (1 - u);
}

function vicTime(p: PrimePlan, s: VSeg, f: number): number {
  if (s.fromS !== undefined || s.toS !== undefined) {
    const dp = p.P[f] - p.P[s.f0];
    const a = s.fromS ?? 0;
    if (s.toS !== undefined) return clipT(s.dur, false, a + (s.toS - a) * Math.min(1, dp / Math.max(1, s.f1 - s.f0)));
    return clipT(s.dur, s.loop, a + dp / 60);
  }
  let tr = s.start;
  for (const x of s.trig) if (x <= f) tr = x;
  const t = (p.P[f] - p.P[tr]) / 60;
  if (s.carry) return Math.min(t, 0.32);
  return clipT(s.dur, s.loop, t);
}

/**
 * Sample the plan at cinematic frame `frame` (pure). v2 camera comes out in WORLD metres (needs the attacker x / facing
 * and the victim's current view x), v1 in the attacker's frame (`camLocal`).
 */
export function samplePlan(p: PrimePlan, frame: number, short: boolean, crowd: V3 | null, ax: number, facing: number, vxWorld: number | null,
  out: PrimeSample, scratch: { prev: LocalPose; blendFrom: LocalPose }): PrimeSample {
  const N = p.frames;
  const fr = Math.max(0, Math.min(N - 1, frame | 0));
  const f = p.eff[fr];
  out.f = fr;
  out.freeze = p.eff[fr] !== fr ? 1 : 0;
  const tw = p.tweak;
  // attacker pose
  out.att.length = 0;
  let ai = -1;
  for (let i = 0; i < p.att.length; i++) if (p.att[i].f0 <= f) ai = i;
  out.attY = 0;
  if (ai >= 0) {
    const s = p.att[ai];
    const t = segTime(p, s, f);
    const w = smooth((f - s.f0 + 1) / 4);
    out.att.push({ clip: s.clip, t, w });
    out.attY = airLift(s, t);
    if (w < 1) {
      if (ai > 0) { const q = p.att[ai - 1]; out.att.push({ clip: q.clip, t: segTime(p, q, f), w: 1 - w }); }
      else if (p.attPre) out.att.push({ clip: p.attPre.clip, t: p.attPre.t, w: 1 - w });
      else out.att[0].w = 1;
    }
  }
  out.attY += p.AY[f];
  out.attDx = p.AX[f];
  out.attVisible = p.v2 || !inRanges(f, tw.aHide);
  // victim pose
  out.vic.length = 0;
  let vi = -1;
  for (let i = 0; i < p.vic.length; i++) if (p.vic[i].start <= f) vi = i;
  if (vi >= 0) {
    const s = p.vic[vi];
    let clip = s.clip;
    if (!p.v2 && clip === 'wall_splat' && p.wallSplatAt < 0) clip = 'kd_fall_b';
    const t = vicTime(p, s, f);
    const w = smooth((f - s.start + 1) / 4);
    out.vic.push({ clip, t, w });
    if (w < 1) {
      if (vi > 0) { const q = p.vic[vi - 1]; out.vic.push({ clip: q.clip, t: vicTime(p, q, f), w: 1 - w }); }
      else if (p.vicPre) out.vic.push({ clip: p.vicPre.clip, t: p.vicPre.t, w: 1 - w });
      else out.vic[0].w = 1;
    }
  } else if (p.vicPre) out.vic.push({ clip: p.vicPre.clip, t: p.vicPre.t, w: 1 });
  out.vicGap = vxWorld !== null ? Math.max(0.3, (vxWorld - ax) * facing - p.AX[f]) : p.G[f];
  out.vicY = p.Y[f] + (p.v2 ? 0 : ramp(f, tw.vSink));
  out.carry = p.carry[f] as 0 | 1 | 2;
  let lastCarry = -100;
  for (let k = f; k >= Math.max(0, f - 6); k--) if (p.carry[k]) { lastCarry = k; break; }
  out.carryBlend = out.carry ? 1 : lastCarry >= 0 ? 1 - smooth((f - lastCarry) / 6) : 0;
  out.vicVisible = p.v2 || !inRanges(f, tw.vHide);
  // camera
  if (p.v2 && p.cams.length && !short) {
    let ci = 0;
    for (let i = 0; i < p.cams.length; i++) if (p.cams[i].from <= f) ci = i;
    camV2(p, ci, f, ax, facing, out, out.cam);
    const c = p.cams[ci];
    const bl = c.blend ?? 0;
    if (bl > 0 && ci > 0 && f - c.from < bl) {
      camV2(p, ci - 1, c.from, ax, facing, out, scratch.blendFrom);
      const k = smooth((f - c.from + 1) / (bl + 1));
      out.cam.pos.lerpVectors(scratch.blendFrom.pos, out.cam.pos, k);
      out.cam.look.lerpVectors(scratch.blendFrom.look, out.cam.look, k);
      out.cam.fov = scratch.blendFrom.fov + (out.cam.fov - scratch.blendFrom.fov) * k;
      out.cam.roll = scratch.blendFrom.roll + (out.cam.roll - scratch.blendFrom.roll) * k;
    }
    out.camLocal = false;
    out.shot = c.shot ?? 'v2'; out.shotIdx = ci;
  } else {
    let si = 0;
    for (let i = 0; i < p.shots.length; i++) if (p.shots[i].f0 <= f) si = i;
    const sh = p.shots[si];
    out.shot = short ? 'short' : sh.name; out.shotIdx = si;
    const ctx = { u: 0, n: Math.max(1, sh.f1 - sh.f0), vx: out.carry ? 0.62 : out.vicGap, vy: out.carry === 2 ? 1.0 : out.vicY, ay: out.attY, hA: p.hA, hV: p.hV, crowd, p: sh.p };
    if (short) {
      const x = (out.attDx + out.vicGap) * 0.5;
      out.cam.pos.set(x, 1.55, 5.2); out.cam.look.set(x, 1.1, 0); out.cam.fov = 35; out.cam.roll = 0;
    } else {
      let prev: LocalPose | null = null;
      if (sh.name === 'slowmo_hold' && si > 0) {
        const q = p.shots[si - 1];
        prev = sampleShot(q.name, { ...ctx, u: 1, n: Math.max(1, q.f1 - q.f0), p: q.p }, scratch.prev, null);
      }
      ctx.u = (f - sh.f0) / Math.max(1, sh.f1 - sh.f0 - 1);
      sampleShot(sh.name, ctx, out.cam, prev);
    }
    out.camLocal = true;
  }
  // dressing
  out.ts = p.rate[f] * (out.freeze ? 0 : 1);
  const sp = p.spot[f];
  const shotName = p.v2 ? '' : p.shots[out.shotIdx]?.name ?? '';
  const sheetOn = !!tw.sheet && f >= tw.sheet[0] && f < tw.sheet[1];
  out.spot = sp ? 1 : 0;
  out.spotOnVictim = sp === 2 || sheetOn;
  out.dim = out.spot ? 0.86 : p.dimOv[f] ? 0.72 : shotName === 'crowd_pop' ? 0.0 : shotName === 'wide' || shotName === 'host_cam' ? 0.22 : 0.34;
  out.letterbox = p.letterbox[f] ? 0.105 * Math.min(smooth(fr / 8), smooth((N - 1 - fr) / 8)) : 0;
  const sf = fr - p.slateAt;
  out.slate = sf < 0 ? 0 : sf < 70 ? 1 : Math.max(0, 1 - (sf - 70) / 10);
  out.crowdBoost = shotName === 'crowd_pop' ? 1 : 0;
  return out;
}

/** v2 camera shot `ci` at frame f, in world metres (CONTRACT §26.1 formula) */
function camV2(p: PrimePlan, ci: number, f: number, ax: number, facing: number, s: PrimeSample, out: LocalPose): void {
  const c = p.cams[ci];
  const k = easeK(c.ease, (f - c.from) / Math.max(1, c.to - c.from - 1));
  const lookH = val(c.lookH, 1.2, k);
  const aX = ax + facing * p.AX[f];
  const vX = aX + facing * s.vicGap;
  const tx = c.target === 'attacker' ? aX : c.target === 'defender' ? vX : (aX + vX) / 2;
  const yaw = val(c.yawDeg, 0, k) * Math.PI / 180;
  const dist = val(c.dist, 3, k), height = val(c.height, 1.4, k);
  out.look.set(tx, lookH, 0);
  out.pos.set(tx + facing * Math.sin(yaw) * dist, height, Math.cos(yaw) * dist);
  out.fov = val(c.fovDeg, 35, k);
  out.roll = val(c.roll, 0, k) * Math.PI / 180;
  void s;
}

export function newSample(): PrimeSample {
  return { f: 0, shot: '', shotIdx: 0, att: [], attY: 0, attDx: 0, attVisible: true, vic: [], vicGap: 1, vicY: 0, vicVisible: true, carry: 0, carryBlend: 0,
    cam: newLocalPose(), camLocal: true, ts: 1, dim: 0, spot: 0, spotOnVictim: false, letterbox: 0, slate: 0, crowdBoost: 0, freeze: 0 };
}

// ───────────────────────────────────────── the name slate ─────────────────────────────────────────

/** paints the PRIME TIME slate: a slanted show-yellow band with the move line, a red tag and the fighter */
export function paintSlate(canvas: HTMLCanvasElement, tag: string, move: string, fighter: string): void {
  const W = 1024, H = 256;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const fam = (() => { try { return document.fonts && document.fonts.check("40px 'Bungee'") ? "'Bungee', Impact, sans-serif" : "Impact, 'Arial Black', sans-serif"; } catch { return "Impact, 'Arial Black', sans-serif"; } })();
  const sl = 34;
  g.fillStyle = 'rgba(0,0,0,0.85)';
  g.beginPath(); g.moveTo(sl + 14, 96); g.lineTo(W - 20, 96); g.lineTo(W - 20 - sl, 226); g.lineTo(14, 226); g.closePath(); g.fill();
  g.fillStyle = '#ffd21a';
  g.beginPath(); g.moveTo(sl, 84); g.lineTo(W - 34, 84); g.lineTo(W - 34 - sl, 214); g.lineTo(0, 214); g.closePath(); g.fill();
  g.font = `44px ${fam}`;
  const tw = Math.min(520, g.measureText(tag).width + 60);
  g.fillStyle = '#e8122d';
  g.beginPath(); g.moveTo(sl + 20, 14); g.lineTo(sl + 20 + tw, 14); g.lineTo(sl + tw, 80); g.lineTo(20, 80); g.closePath(); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(tag, sl + 44, 49);
  let size = 104;
  g.font = `${size}px ${fam}`;
  while (size > 36 && g.measureText(move).width > W - 170) { size -= 4; g.font = `${size}px ${fam}`; }
  g.fillStyle = '#111'; g.fillText(move, 44, 152);
  g.font = `30px ${fam}`;
  g.fillStyle = '#ffffff';
  const fw = g.measureText(fighter).width;
  g.fillText(fighter, Math.max(60, W - 90 - fw), 236);
}

/** split a v2 slate line ("PRIME TIME - JOHNNY RIOT: MAIN EVENT") into [move line, fighter] (fallbacks given) */
export function slateParts(line: string, tag: string, move: string, fighter: string): [string, string] {
  let s = line.trim();
  if (!s) return [move, fighter];
  const t = tag.trim().toUpperCase();
  if (s.toUpperCase().startsWith(t)) s = s.slice(t.length).replace(/^[\s\-:|]+/, '');
  const c = s.indexOf(':');
  if (c > 0) return [s.slice(c + 1).trim() || move, s.slice(0, c).trim() || fighter];
  return [s, fighter];
}

// ───────────────────────────────────────── stage magic props ─────────────────────────────────────────

/** the PRIME TIME props one bout can need: a trapdoor, the magician's sheet, Gazza's ball (built once, warmed) */
export class PrimeProps {
  readonly group = new THREE.Group();
  readonly trap: { group: THREE.Group; lid: THREE.Object3D; pit: THREE.Mesh };
  readonly sheet: THREE.Mesh;
  ball: THREE.Object3D;
  constructor() {
    this.group.name = 'prime-props';
    this.trap = trapdoorMesh();
    this.sheet = sheetMesh();
    this.ball = footballMesh();
    this.ball.name = 'prime-ball';
    this.group.add(this.trap.group, this.sheet, this.ball);
    this.hideAll();
  }
  hideAll(): void { this.trap.group.visible = false; this.sheet.visible = false; this.ball.visible = false; }
  /** lane ASSETS' football (props GLB, centred) replaces the view-built ball */
  setBall(o: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(o);
    const c = box.getCenter(new THREE.Vector3());
    o.position.sub(c);
    const g = new THREE.Group(); g.name = 'prime-ball'; g.add(o);
    g.traverse((x) => { if ((x as THREE.Mesh).isMesh) (x as THREE.Mesh).castShadow = true; });
    this.group.remove(this.ball);
    this.ball = g;
    g.visible = false;
    this.group.add(g);
  }
  /** warm-up: every prop visible once so its program links before the first round */
  showForWarmup(): void { this.trap.group.visible = true; this.sheet.visible = true; this.ball.visible = true; }
  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const x of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) { x.map?.dispose(); x.dispose(); }
    });
    this.group.removeFromParent();
  }
}

/** the trapdoor / sheet / ball state for cinematic frame f */
export function propsAt(p: PrimePlan, f: number, s: PrimeSample, ax: number, facing: number, props: PrimeProps,
  anchor: (name: string, out: THREE.Vector3) => boolean, tmp: THREE.Vector3, tmp2: THREE.Vector3): void {
  const tw = p.tweak;
  const vx = ax + facing * (s.attDx + s.vicGap);
  const tr = tw.trap?.[0];
  if (tr && f >= tr.open - 2 && f < (tr.end ?? p.frames)) {
    const gOpen = p.G[Math.min(p.frames - 1, Math.max(0, tr.open))];
    const gx = tr.at === 'att' ? 0 : tr.at === 'vic' ? gOpen : gOpen * 0.5;
    props.trap.group.visible = true;
    props.trap.group.position.set(ax + facing * (gx + (tr.dx ?? 0)), 0, 0.05);
    props.trap.group.rotation.y = facing > 0 ? 0 : Math.PI;
    let open = smooth((f - tr.open) / 6);
    if (tr.close !== undefined && f >= tr.close) open = 1 - smooth((f - tr.close) / 4);
    if (tr.reopen !== undefined && f >= tr.reopen) open = smooth((f - tr.reopen) / 8);
    if (tr.end !== undefined) open *= 1 - smooth((f - (tr.end - 8)) / 8);
    props.trap.lid.rotation.z = open * 1.9;
    const fade = tr.end !== undefined ? 1 - smooth((f - (tr.end - 6)) / 6) : 1;
    props.trap.group.scale.setScalar(Math.max(0.001, fade));
  } else props.trap.group.visible = false;
  if (tw.sheet && f >= tw.sheet[0] && f < tw.sheet[1]) {
    const u = smooth((f - tw.sheet[0]) / 8);
    props.sheet.visible = true;
    const h = p.hV * 1.08;
    props.sheet.scale.set(1 + 0.03 * Math.sin(f * 0.9), h, 1 + 0.03 * Math.cos(f * 0.7));
    props.sheet.position.set(vx, (1 - u) * 2.6, 0);
    props.sheet.rotation.y = f * 0.02;
  } else props.sheet.visible = false;
  const keys = tw.ball;
  if (keys && keys.length) {
    let k = -1;
    for (let i = 0; i < keys.length; i++) if (keys[i][0] <= f) k = i;
    const cur = k >= 0 ? keys[k] : null;
    if (!cur || cur[1] === 'hide') { props.ball.visible = false; return; }
    const nxt = k + 1 < keys.length ? keys[k + 1] : null;
    const at = (name: string, out: THREE.Vector3): boolean => {
      if (name === 'away') { out.set(vx + facing * 4, 3.5, -1.5); return true; }
      if (name.startsWith('floorV+')) { out.set(vx + facing * Number(name.slice(7)), 0.11, 0.2); return true; }
      if (name.startsWith('up+')) { out.set(ax + facing * (s.attDx + 0.3), Number(name.slice(3)), 0.1); return true; }
      return anchor(name, out);
    };
    if (!at(cur[1], tmp)) { props.ball.visible = false; return; }
    if (nxt && nxt[1] !== 'hide' && at(nxt[1], tmp2)) {
      const u = (f - cur[0]) / Math.max(1, nxt[0] - cur[0]);
      const dist = tmp.distanceTo(tmp2);
      const contact = /^(aFoot|aHead|vChest|vHead)/.test(nxt[1]) && nxt[0] - cur[0] <= 4;
      tmp.lerp(tmp2, u);
      if (!contact) tmp.y += 4 * u * (1 - u) * Math.min(1.2, dist * 0.35);
    }
    props.ball.visible = true;
    props.ball.position.copy(tmp);
    props.ball.rotation.set(f * 0.37 * facing, 0, -f * 0.5 * facing);
  } else props.ball.visible = false;
}

// HIT PARADE — shared helpers for the SIM probes (lane SIM). Not a probe itself (run_probes only
// discovers _harness/probe_*.ts). Builds GameData from data/system.json + the fixture kits, so the
// probes never depend on lanes FIGHTERS / ASSETS.
//
// CHANGED(SIM3D) (CONTRACT §35): the probes work in the LINE FRAME of a match - the axis from P1's spawn to P2's spawn
// (the stage's spawnAxisDeg, P1 screen-left). place(m, a, b) puts both fighters on that line at signed distances a, b
// (metres) from the ring centre, fs(m, i).x / .z = the line / lateral coordinates, lxU / plx = the same for raw state
// reads. The fixture stage's spawn axis comes from env HP_PROBE_AXIS (degrees, yaw convention; default 90 = the x axis,
// the old 2.5D layout): probe_axis.ts re-runs the SIM probes on a rotated axis so every system is exercised off x.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGameData } from '../../runtime/src/core/data.ts';
import type { GameData, FighterSnap, SimEvent } from '../../runtime/src/core/types.ts';
import { createMatch, readFighter, readMatch, step } from '../../runtime/src/core/sim/match.ts';
import type { Match, MatchCfg, Scheme } from '../../runtime/src/core/sim/match.ts';
import { eventsSince, EV_NAMES } from '../../runtime/src/core/sim/events.ts';
import { F, PH, W, fighterBase } from '../../runtime/src/core/sim/layout.ts';
import { cosQ, dirToYaw, sinQ } from '../../runtime/src/core/sim/fx3d.ts';
import { P, projBase as PROJ_BASE_OF } from '../../runtime/src/core/sim/layout.ts';
import { updateCamN, updateFacing } from '../../runtime/src/core/sim/state.ts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(ROOT + rel, 'utf8'));
}

/** CHANGED(SIM3D): the fixture stage's spawn axis (yaw degrees; env HP_PROBE_AXIS, default 90 = the x axis). */
export const PROBE_AXIS_DEG = Number.isFinite(Number(process.env.HP_PROBE_AXIS)) && process.env.HP_PROBE_AXIS !== undefined ? Number(process.env.HP_PROBE_AXIS) : 90;

let cached: GameData | null = null;
export function fixtureData(): GameData {
  if (cached) return cached;
  cached = buildGameData({
    system: readJson('data/system.json'),
    fighters: { kit_a: readJson('_harness/fixtures/kit_a.json'), kit_b: readJson('_harness/fixtures/kit_b.json') },
    clips: { kit_a: readJson('_harness/fixtures/kit_a.clips.json'), kit_b: readJson('_harness/fixtures/kit_b.clips.json') },
    // CHANGED(SIM3D): the default circle ring; the spawn axis from HP_PROBE_AXIS (camera side = axis - 90)
    stages: { version: 1, stages: ['rust_theater', 'butcher_block'].map((id) => ({ id, status: 'built', spawnAxisDeg: PROBE_AXIS_DEG })) },
  });
  return cached;
}

// ------------------------------------------------------------------ the line frame (CHANGED(SIM3D))
/** ux / uz = the unit line direction x 16384 as FLOATS (harness only: exact unit length, unlike the sim's Q14 table) */
interface Line { ux: number; uz: number; cx: number; cz: number }
const LINES = new WeakMap<Match, Line>();

/** The match's line frame: unit P1 -> P2 spawn direction (Q14) + the ring centre (U). */
export function lineOf(m: Match): Line {
  let l = LINES.get(m);
  if (l) return l;
  // not made by newMatch: the stage's spawn yaw (P1 screen-left end first)
  const y = (m.s[W.spawnYaw] * 2 * Math.PI) / 65536;
  let ux = Math.sin(y) * 16384;
  let uz = Math.cos(y) * 16384;
  if (ux * m.s[W.camNZ] - uz * m.s[W.camNX] < 0) {
    ux = -ux;
    uz = -uz;
  }
  l = { ux, uz, cx: m.s[W.ringCX], cz: m.s[W.ringCZ] };
  LINES.set(m, l);
  return l;
}

function recordLine(m: Match): void {
  const s = m.s;
  const b0 = fighterBase(0);
  const b1 = fighterBase(1);
  const dx = s[b1 + F.x] - s[b0 + F.x];
  const dz = s[b1 + F.z] - s[b0 + F.z];
  if (dx === 0 && dz === 0) return;
  const len = Math.hypot(dx, dz);
  LINES.set(m, { ux: (dx / len) * 16384, uz: (dz / len) * 16384, cx: s[W.ringCX], cz: s[W.ringCZ] });
}

/** Line coordinate (U) of a world point. */
export function toLineU(m: Match, x: number, z: number): number {
  const l = lineOf(m);
  return Math.round(((x - l.cx) * l.ux + (z - l.cz) * l.uz) / 16384);
}
/** Lateral coordinate (U) of a world point (toward the initial camera side). */
export function toLatU(m: Match, x: number, z: number): number {
  const l = lineOf(m);
  // lateral axis = the line rotated -90 deg in yaw = (-uz, ux)
  return Math.round(((x - l.cx) * -l.uz + (z - l.cz) * l.ux) / 16384);
}
/** Fighter i's line coordinate (U). */
export function lxU(m: Match, i: number): number {
  const b = fighterBase(i);
  return toLineU(m, m.s[b + F.x], m.s[b + F.z]);
}
/** Fighter i's line coordinate (metres). */
export function lx(m: Match, i: number): number {
  return lxU(m, i) / 100000;
}
/** Fighter i's planar velocity along the line (U/frame, rounded). */
export function lvU(m: Match, i: number): number {
  const l = lineOf(m);
  const b = fighterBase(i);
  return Math.round((m.s[b + F.vx] * l.ux + m.s[b + F.vz] * l.uz) / 16384);
}
/** Projectile slot k's line coordinate (U). */
export function plx(m: Match, k: number): number {
  const pb = PROJ_BASE_OF(k);
  return toLineU(m, m.s[pb + P.x], m.s[pb + P.z]);
}
/** World (x, z) U of the line coordinate a (U) + lateral l (U). */
export function fromLineU(m: Match, a: number, l = 0): [number, number] {
  const L = lineOf(m);
  return [L.cx + Math.round((a * L.ux - l * L.uz) / 16384), L.cz + Math.round((a * L.uz + l * L.ux) / 16384)];
}

export const I = {
  U: 1, D: 2, L_: 4, R_: 8, L: 16, M: 32, H: 64, S: 128, A: 256, THROW: 512, PARRY: 1024, IMPACT: 2048, TAUNT: 4096,
  STEP_IN: 8192, STEP_OUT: 16384, // CHANGED(SIM3D)
} as const;

export interface NewMatchOpts {
  p1?: string;
  p2?: string;
  s1?: Scheme;
  s2?: Scheme;
  mode?: MatchCfg['mode'];
  seed?: number;
  rounds?: number;
  timer?: number;
  cpu2?: number;
  skipIntro?: boolean;
  data?: GameData;
  /** CHANGED(SIM3D): stage id (ring / spawn axis / camera side from data.stages; default rust_theater) */
  stage?: string;
}

export function newMatch(o: NewMatchOpts = {}): Match {
  const cfg: MatchCfg = {
    mode: o.mode ?? 'versus',
    stage: o.stage ?? 'rust_theater',
    seed: o.seed ?? 1,
    p: [
      { fighter: o.p1 ?? 'kit_a', color: 0, scheme: o.s1 ?? 1, cpu: -1 },
      { fighter: o.p2 ?? 'kit_b', color: 0, scheme: o.s2 ?? 1, cpu: o.cpu2 ?? -1 },
    ],
    rounds: o.rounds,
    timer: o.timer,
  };
  const m = createMatch(cfg, o.data ?? fixtureData());
  recordLine(m); // CHANGED(SIM3D)
  if (o.skipIntro !== false) skipIntro(m);
  return m;
}

export function skipIntro(m: Match): void {
  let n = 0;
  while (m.s[W.phase] === PH.INTRO && n++ < 10000) step(m, 0, 0);
}

/** Runs `n` frames with fixed inputs. */
export function run(m: Match, n: number, in1 = 0, in2 = 0): void {
  for (let k = 0; k < n; k++) step(m, in1, in2);
}

/** Screen-relative forward / back bits for player `i` (from its current facing). */
export function fwd(m: Match, i: number): number {
  return m.s[fighterBase(i) + F.facing] > 0 ? I.R_ : I.L_;
}
export function back(m: Match, i: number): number {
  return m.s[fighterBase(i) + F.facing] > 0 ? I.L_ : I.R_;
}

/** Numpad direction -> screen bits for player `i`. */
export function dirBits(m: Match, i: number, d: number): number {
  let v = 0;
  if (d >= 7) v |= I.U;
  if (d <= 3) v |= I.D;
  const h = (d - 1) % 3; // 0 back, 1 neutral, 2 forward
  if (h === 0) v |= back(m, i);
  if (h === 2) v |= fwd(m, i);
  return v;
}

/** Feeds a numpad motion (e.g. "236") one direction per frame, then `btn` with the last direction. */
export function motion(m: Match, i: number, seq: string, btn: number, other = 0, holdEach = 1): void {
  const ds = seq.split('').map(Number);
  for (let k = 0; k < ds.length; k++) {
    const last = k === ds.length - 1;
    for (let h = 0; h < holdEach; h++) {
      const w = dirBits(m, i, ds[k]) | (last && h === holdEach - 1 ? btn : 0);
      if (i === 0) step(m, w, other);
      else step(m, other, w);
    }
  }
}

/** CHANGED(SIM3D): the fighter snapshot with x / z = its LINE / lateral coordinates (metres). */
export function fs(m: Match, i: number): FighterSnap {
  const f = readFighter(m, i);
  const b = fighterBase(i);
  return { ...f, x: toLineU(m, m.s[b + F.x], m.s[b + F.z]) / 100000, z: toLatU(m, m.s[b + F.x], m.s[b + F.z]) / 100000 };
}
export const ms = readMatch;
export function sb(i: number): number {
  return fighterBase(i);
}

/** Events emitted since frame `f` (inclusive). */
export function evs(m: Match, f: number): SimEvent[] {
  const out: SimEvent[] = [];
  eventsSince(m.events, f, out);
  return out;
}
export function evName(t: number): string {
  return EV_NAMES[t] ?? String(t);
}

/**
 * Places both fighters on the match's LINE (signed metres from the ring centre; grounded, idle) - test setup only.
 * CHANGED(SIM3D): the line = the P1 -> P2 spawn axis (the x axis on the default stage).
 */
export function place(m: Match, x0: number, x1: number): void {
  const a = fromLineU(m, Math.round(x0 * 100000));
  const b = fromLineU(m, Math.round(x1 * 100000));
  place3(m, a[0] / 100000, a[1] / 100000, b[0] / 100000, b[1] / 100000);
  // exact line placement (place3 rounds through metres)
  m.s[fighterBase(0) + F.x] = a[0];
  m.s[fighterBase(0) + F.z] = a[1];
  m.s[fighterBase(1) + F.x] = b[0];
  m.s[fighterBase(1) + F.z] = b[1];
}

/**
 * CHANGED(SIM3D): places both fighters at (x, z) metres facing each other; the camera basis turns to the perpendicular of
 * the pair on its current side (continuity) and both screen-side facing signs follow. Test setup only.
 */
export function place3(m: Match, x0: number, z0: number, x1: number, z1: number): void {
  const s = m.s;
  const b0 = fighterBase(0);
  const b1 = fighterBase(1);
  s[b0 + F.x] = Math.round(x0 * 100000);
  s[b0 + F.z] = Math.round(z0 * 100000);
  s[b1 + F.x] = Math.round(x1 * 100000);
  s[b1 + F.z] = Math.round(z1 * 100000);
  const dx = s[b1 + F.x] - s[b0 + F.x];
  const dz = s[b1 + F.z] - s[b0 + F.z];
  s[b0 + F.yaw] = dx === 0 && dz === 0 ? 16384 : dirToYaw(dx, dz);
  s[b1 + F.yaw] = (s[b0 + F.yaw] + 32768) & 65535;
  updateCamN(s, s[b0 + F.x], s[b0 + F.z], s[b1 + F.x], s[b1 + F.z], 0);
  const l = lineOf(m);
  const p1Left = dx * l.ux + dz * l.uz >= 0;
  s[b0 + F.facing] = p1Left ? 1 : -1;
  s[b1 + F.facing] = p1Left ? -1 : 1;
  updateFacing(s, b0);
  updateFacing(s, b1);
}

// ------------------------------------------------------------------ tiny test reporter
export interface Tester {
  ok(cond: boolean, label: string, detail?: string): boolean;
  eq(got: number, want: number, label: string): boolean;
  near(got: number, want: number, tol: number, label: string): boolean;
  note(s: string): void;
  done(summaryExtra?: string): never;
}

export function tester(name: string): Tester {
  let pass = 0;
  const fails: string[] = [];
  const notes: string[] = [];
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  const t: Tester = {
    ok(cond, label, detail) {
      if (cond) {
        pass++;
        if (verbose) console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
      } else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
      return cond;
    },
    eq(got, want, label) {
      return t.ok(got === want, label, `got ${got}, want ${want}`);
    },
    near(got, want, tol, label) {
      return t.ok(Math.abs(got - want) <= tol, label, `got ${got}, want ${want} +-${tol}`);
    },
    note(s) {
      notes.push(s);
    },
    done(extra) {
      for (const f of fails) console.log(`  FAIL ${f}`);
      if (verbose || fails.length > 0) for (const n of notes) console.log(`  note ${n}`);
      const total = pass + fails.length;
      const line = `${fails.length === 0 ? 'PASS' : 'FAIL'} ${name}: ${pass}/${total} checks${extra ? '; ' + extra : ''}`;
      console.log(line);
      process.exit(fails.length === 0 ? 0 : 1);
    },
  };
  return t;
}

// ------------------------------------------------------------------ plausible random input streams
import { mulberry32 } from '../../runtime/src/core/rng.ts';

const MOTIONS: number[][] = [[2, 3, 6], [6, 2, 3], [2, 1, 4], [6, 3, 2, 1, 4], [2, 3, 6, 2, 3, 6], [6, 5, 6], [4, 5, 4]];

/**
 * Deterministic "play-like" input words for BOTH players (interleaved: [p1, p2] per frame): held
 * directions for 1-20 frames, button presses (~15% of frames), chords (throw / parry), IMPACT,
 * motions with a button, assist holds. Screen-relative left/right (the sim maps them by facing).
 */
export function randomInputs(seed: number, frames: number): Int32Array {
  const out = new Int32Array(frames * 2);
  for (let p = 0; p < 2; p++) {
    const r = mulberry32((seed * 7919 + p * 104729) | 0);
    let f = 0;
    while (f < frames) {
      const roll = r();
      if (roll < 0.12) {
        const mo = MOTIONS[Math.floor(r() * MOTIONS.length)];
        const right = r() < 0.5;
        const btn = [16, 32, 64, 128][Math.floor(r() * 4)];
        for (let k = 0; k < mo.length && f < frames; k++, f++) {
          const d = mo[k];
          let w = 0;
          if (d >= 7) w |= 1;
          if (d <= 3) w |= 2;
          const h = (d - 1) % 3;
          if (h === 0) w |= right ? 4 : 8;
          if (h === 2) w |= right ? 8 : 4;
          if (k === mo.length - 1) w |= btn;
          out[f * 2 + p] = w;
        }
        continue;
      }
      const dirs = [0, 0, 0, 8, 4, 2, 6, 10, 1, 9, 5];
      const dir = dirs[Math.floor(r() * dirs.length)];
      const hold = 1 + Math.floor(r() * 20);
      const assist = r() < 0.1 ? 256 : 0;
      // CHANGED(SIM3D): ~8% of the held runs also hold STEP_IN / STEP_OUT (taps when short, circling when long)
      const sr = r();
      const stepBit = sr < 0.04 ? 8192 : sr < 0.08 ? 16384 : 0;
      for (let k = 0; k < hold && f < frames; k++, f++) {
        let w = dir | assist | stepBit;
        const b = r();
        if (b < 0.05) w |= 16;
        else if (b < 0.08) w |= 32;
        else if (b < 0.1) w |= 64;
        else if (b < 0.115) w |= 128;
        else if (b < 0.125) w |= 16 | 32; // throw chord
        else if (b < 0.132) w |= 1024; // parry
        else if (b < 0.135) w |= 2048; // impact
        else if (b < 0.137) w |= 4096; // taunt
        out[f * 2 + p] = w;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ STEP-heavy input streams (CHANGED(SIM3D))
/**
 * Deterministic words for ONE player aimed at the 3D ring (CONTRACT §35.2): sidestep taps (IN / OUT), long circling holds
 * (SIDEWALK) released into the settle or cancelled by back (block), step-attacks (a button 9-13 frames after the tap),
 * walks, dashes, jumps and plain buttons in between. `fwd` = the screen bit toward the opponent at the start.
 */
export function stepInputs(seed: number, fwd: number, frames: number): Int32Array {
  const r = mulberry32((seed * 40503 + 977) | 0);
  const out = new Int32Array(frames);
  const back = fwd === 8 ? 4 : 8;
  let f = 0;
  const put = (w: number, n = 1): void => {
    for (let k = 0; k < n && f < frames; k++) out[f++] = w;
  };
  const BTN = [16, 32, 64, 128];
  while (f < frames) {
    const q = r();
    const sb = r() < 0.5 ? 8192 : 16384;
    if (q < 0.2) {
      // tap, then maybe a step-attack
      put(sb, 1 + Math.floor(r() * 2));
      put(0, 8 + Math.floor(r() * 5));
      if (r() < 0.6) put(BTN[Math.floor(r() * 4)]);
    } else if (q < 0.42) {
      // circle-walk, then release or back-cancel
      put(sb, 20 + Math.floor(r() * 90));
      if (r() < 0.4) put(sb | back, 3 + Math.floor(r() * 10));
    } else if (q < 0.52) {
      put(sb | fwd, 10 + Math.floor(r() * 30)); // forward + STEP = keeps circling
    } else if (q < 0.62) {
      put(fwd, 5 + Math.floor(r() * 25));
    } else if (q < 0.68) {
      put(back, 5 + Math.floor(r() * 25));
    } else if (q < 0.72) {
      put(fwd);
      put(0);
      put(fwd); // 66
      put(0, 12);
    } else if (q < 0.76) {
      put(1 | (r() < 0.5 ? fwd : 0), 4); // jumps
      put(0, 30);
    } else if (q < 0.9) {
      put(BTN[Math.floor(r() * 3)] | (r() < 0.3 ? 2 : 0));
      put(0, 6 + Math.floor(r() * 12));
    } else if (q < 0.94) {
      put(16 | 32); // throw
      put(0, 20);
    } else {
      put(0, 4 + Math.floor(r() * 20));
    }
  }
  return out;
}

// ------------------------------------------------------------------ unique-heavy input streams (CHANGED(SIM) P2)
/**
 * Deterministic words for ONE player aimed at the uniques (CONTRACT §28): charge holds ([4]6 / [2]8 after 46-70 f), 360,
 * half circles (41236 / 63214), 22 taps, 214 + follow-up presses (stance / counter / keepy-uppy / vanish), supers
 * (236236 / 214214), SIMPLE S + direction, ASSIST + S, throws, parries, walks. `fwd` = the screen bit toward the opponent
 * at the start (P1 RIGHT 8, P2 LEFT 4). Pure function of (seed, fwd, frames).
 */
export function uniqueInputs(seed: number, fwd: number, frames: number): Int32Array {
  const r = mulberry32((seed * 2654435761) | 0);
  const out = new Int32Array(frames);
  const back = fwd === 8 ? 4 : 8;
  const dirW = (d: number): number => {
    let w = 0;
    if (d >= 7) w |= 1;
    if (d <= 3) w |= 2;
    const h = (d - 1) % 3;
    if (h === 0) w |= back;
    if (h === 2) w |= fwd;
    return w;
  };
  const BTN = [16, 32, 64];
  let f = 0;
  const put = (w: number, n = 1): void => {
    for (let k = 0; k < n && f < frames; k++) out[f++] = w;
  };
  const seq = (ds: number[], btn: number, each = 1): void => {
    for (let k = 0; k < ds.length; k++) put(dirW(ds[k]) | (k === ds.length - 1 ? btn : 0), each);
  };
  while (f < frames) {
    const roll = Math.floor(r() * 100);
    const btn = BTN[Math.floor(r() * 3)];
    if (roll < 12) {
      // charge: back or down-back, then forward / up + button
      const down = r() < 0.4;
      put(dirW(down ? 1 : 4), 46 + Math.floor(r() * 25));
      put(dirW(down ? 8 : 6) | btn, 2);
    } else if (roll < 18) seq([6, 3, 2, 1, 4, 7, 8], btn);
    else if (roll < 26) seq(r() < 0.5 ? [4, 1, 2, 3, 6] : [6, 3, 2, 1, 4], btn);
    else if (roll < 32) seq([2, 5, 2], btn);
    else if (roll < 48) {
      // 214 + follow-up presses (stance follow-ups, counters, keepy-uppy + re-kick, vanish)
      seq([2, 1, 4], r() < 0.2 ? 128 : btn);
      put(0, 8 + Math.floor(r() * 18));
      put(BTN[Math.floor(r() * 3)], 1);
      put(0, Math.floor(r() * 10));
      if (r() < 0.3) seq([2, 3, 6], btn);
    } else if (roll < 53) seq(r() < 0.5 ? [2, 3, 6, 2, 3, 6] : [2, 1, 4, 2, 1, 4], btn);
    else if (roll < 63) put(dirW([5, 6, 4, 2][Math.floor(r() * 4)]) | 128 | (r() < 0.2 ? 256 : 0), 1);
    else if (roll < 67) put(r() < 0.5 ? 512 : 1024, 1 + Math.floor(r() * 6));
    else if (roll < 71) seq([6, 2, 3], btn);
    else {
      const d = [5, 5, 6, 6, 4, 2, 1, 3, 9, 7][Math.floor(r() * 10)];
      const hold = 1 + Math.floor(r() * 16);
      for (let k = 0; k < hold && f < frames; k++) out[f++] = dirW(d) | (r() < 0.12 ? BTN[Math.floor(r() * 3)] : 0);
    }
  }
  return out;
}

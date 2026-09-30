// HIT PARADE — shared helpers for the SIM probes (lane SIM). Not a probe itself (run_probes only
// discovers _harness/probe_*.ts). Builds GameData from data/system.json + the fixture kits, so the
// probes never depend on lanes FIGHTERS / ASSETS.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGameData } from '../../runtime/src/core/data.ts';
import type { GameData, FighterSnap, SimEvent } from '../../runtime/src/core/types.ts';
import { createMatch, readFighter, readMatch, step } from '../../runtime/src/core/sim/match.ts';
import type { Match, MatchCfg, Scheme } from '../../runtime/src/core/sim/match.ts';
import { eventsSince, EV_NAMES } from '../../runtime/src/core/sim/events.ts';
import { F, PH, W, fighterBase } from '../../runtime/src/core/sim/layout.ts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(ROOT + rel, 'utf8'));
}

let cached: GameData | null = null;
export function fixtureData(): GameData {
  if (cached) return cached;
  cached = buildGameData({
    system: readJson('data/system.json'),
    fighters: { kit_a: readJson('_harness/fixtures/kit_a.json'), kit_b: readJson('_harness/fixtures/kit_b.json') },
    clips: { kit_a: readJson('_harness/fixtures/kit_a.clips.json'), kit_b: readJson('_harness/fixtures/kit_b.clips.json') },
  });
  return cached;
}

export const I = {
  U: 1, D: 2, L_: 4, R_: 8, L: 16, M: 32, H: 64, S: 128, A: 256, THROW: 512, PARRY: 1024, IMPACT: 2048, TAUNT: 4096,
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
}

export function newMatch(o: NewMatchOpts = {}): Match {
  const cfg: MatchCfg = {
    mode: o.mode ?? 'versus',
    stage: 'rust_theater',
    seed: o.seed ?? 1,
    p: [
      { fighter: o.p1 ?? 'kit_a', color: 0, scheme: o.s1 ?? 1, cpu: -1 },
      { fighter: o.p2 ?? 'kit_b', color: 0, scheme: o.s2 ?? 1, cpu: o.cpu2 ?? -1 },
    ],
    rounds: o.rounds,
    timer: o.timer,
  };
  const m = createMatch(cfg, o.data ?? fixtureData());
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

export function fs(m: Match, i: number): FighterSnap {
  return readFighter(m, i);
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

/** Places both fighters (metres, grounded, idle) — test setup only. */
export function place(m: Match, x0: number, x1: number): void {
  const s = m.s;
  s[fighterBase(0) + F.x] = Math.round(x0 * 100000);
  s[fighterBase(1) + F.x] = Math.round(x1 * 100000);
  s[fighterBase(0) + F.facing] = x0 <= x1 ? 1 : -1;
  s[fighterBase(1) + F.facing] = x0 <= x1 ? -1 : 1;
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
      for (let k = 0; k < hold && f < frames; k++, f++) {
        let w = dir | assist;
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

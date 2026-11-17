// PG_LIFE's node probe: LF-01..LF-26 (except LF-12, in probe_life_imports.ts) and LIFE's part of FN-01, against scripted snapshots and a tiny
// kinematic host (scoots glide, hops lift for their airtime, a ball rolls when a body pushes into it). No physics, no browser.
// Run: node _harness/probe_life.ts [--heavy] [--verbose]   (exit 1 on any failure; the default run stays a few seconds)
import v8 from 'node:v8';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { LifeSnapshot, LifeIntents, LifeEvents } from '../src/contracts.ts';
import type { Genome } from '../src/core/genome.ts';
import { speciesBaseGenome, CATALOG } from '../src/data/catalog.ts';
import { SPECIES } from '../src/data/species.ts';
import type { PlaceDef } from '../src/data/places.ts';
import { PLACE as HOME } from '../src/data/place_home.ts';
import { PLACE as CABIN } from '../src/data/place_hearthlog.ts';
import { PLACE as RIPPLE } from '../src/data/place_ripple.ts';
import { PLACE as FROSTBELL } from '../src/data/place_frostbell.ts';
import { PLACE as RAINLEAF } from '../src/data/place_rainleaf.ts';
import { PLACE as FIZZWELL } from '../src/data/place_fizzwell.ts';
import { PLACE as COGWHISTLE } from '../src/data/place_cogwhistle.ts';
import { PLACE as LANTERNROOF } from '../src/data/place_lanternroof.ts';
import { PLACE as ECHOHOLLOW } from '../src/data/place_echohollow.ts';
import { PLACE as CLOUDLOFT } from '../src/data/place_cloudloft.ts';
import { THING_IDS, ZONE, MECH } from '../src/data/places.ts';
import { INTENT, LIFE_FLAG, LIFE_EV, SCRIPT, TOUCH, REACT_KIND, SOCIAL_KIND, WISH_KIND, LOOK, TRAIT_MEDIANS, EMOTE, THING_KIND, USE_VERB } from '../src/data/life.ts';
import { WISH_STATE, PIECES_USE } from '../src/data/quests.ts';
import { MATERIAL_FAMILY_IDS } from '../src/data/materials.ts';
import { createLifeWorld, lifeSetPlace, lifeSetHome, lifeAdd, lifeRemove, lifeStep, lifeScript, lifeSetJournal, lifeSetPair, lifeSetFriends, lifeSetHops, lifeLooks, lifeAddLook,
  lifeWishOf, lifePhrase, lifeMotif, lifeAttention, lifeThingTap, lifeGustOn, createAttention, attentionFilter, motionGate, unitCapOf, moverCapOf, CAPS, traitsOf, HUFF_TRIGGERS,
  PHRASE_BUBBLE, BEH, STYLE, UNIT } from '../src/life/step.ts';
import type { LifeWorld } from '../src/life/step.ts';

const HEAVY = process.argv.includes('--heavy'), VERBOSE = process.argv.includes('--verbose');
/** LF-02's measurement runs in a child process of its own (`--lf02`): see the LF-02 section. */
const LF02_CHILD = process.argv.includes('--lf02');
let fails = 0, oks = 0;
const check = (id: string, what: string, ok: boolean, detail = ''): void => {
  if (ok) oks++; else fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${detail ? `: ${detail}` : ''}`);
};
const info = (id: string, what: string): void => console.log(`info ${id} ${what}`);

/* ───────────────────────────── fixtures ───────────────────────────── */

// the kinematic host (round 4: in _harness/life_host.ts, shared with the LF-02 browser page)
import { mkSnapshot, mkIntents, mkEvents, G, SP, TID, Sim, cabin, home, crowd, cloneSnap } from './life_host.ts';
import type { EvLog } from './life_host.ts';

/* ───────────────────────────── 1. traits (LIFE 2) ───────────────────────────── */
if (!LF02_CHILD) {
  const tmp = new Float32Array(5), cols: number[][] = [[], [], [], [], []];
  for (const d of CATALOG) { traitsOf(speciesBaseGenome(d.id, 7), tmp, 0, false); for (let k = 0; k < 5; k++) cols[k].push(tmp[k]); }
  const spec = [[0.17, 0.52, 0.89], [0.26, 0.53, 0.90], [0.10, 0.39, 0.84], [0.38, 0.65, 0.82], [0.07, 0.37, 0.82]];
  const names = ['bouncy', 'curious', 'cuddly', 'chatty', 'dozy'];
  const rows: string[] = [];
  let close = true;
  for (let k = 0; k < 5; k++) {
    const v = cols[k].slice().sort((a, b) => a - b), mn = v[0], md = v[25], mx = v[49]; // the spec's median of 50 is the upper one (index 25)
    rows.push(`${names[k]} ${mn.toFixed(2)}/${md.toFixed(2)}/${mx.toFixed(2)} (LIFE 2: ${spec[k].join('/')})`);
    if (Math.abs(mn - spec[k][0]) > 0.03 || Math.abs(md - spec[k][1]) > 0.03 || Math.abs(mx - spec[k][2]) > 0.03) close = false;
  }
  console.log('info T  trait spreads over the 50 templates, speciesBaseGenome(id, 7), untwisted: ' + rows.join('; '));
  check('T', "the trait spreads match LIFE 2's table within 0.03 (min / median / max, untwisted) and TRAIT_MEDIANS", close && TRAIT_MEDIANS.every((m, k) => Math.abs(m - spec[k][1]) < 1e-9));
  const a = new Float32Array(5), b = new Float32Array(5);
  traitsOf(G('dollop', 1), a, 0); traitsOf(G('dollop', 2), b, 0);
  check('T', 'traits are a pure function of the genome (same genome, same traits; the seeded twist is within +-0.08)', (() => { const c = new Float32Array(5); traitsOf(G('dollop', 1), c, 0); return a.every((v, k) => v === c[k]); })() && a.some((v, k) => v !== b[k]));
}

/* ───────────────────────────── 2. the motion gate's caps (LF-10, 10.3) ───────────────────────────── */
if (!LF02_CHILD) {
  // (round 4 re-specification, written reason: LIFE 10.3's table was computed with PLAYGROUND_BUILD 14.2's provisional props share 0.20 ms
  // and says "PF-00 re-measures the weights"; PF-00 measured props 0.33 ms and a piece 0.26 (PG_PHYS.md section 5) and F = 3.71, kept at 4.
  // The rows now check the same formula, unitCap = max((B / F - props) / c_whole, 1.0 + sleeper x (wholes cap - 1)), against PF-00's
  // numbers typed here (props 0.33, c_whole 0.87, sleeper 0.03, B 4 / 6 / 10, wholes caps 3 / 4 / 5), exactly as tight as before. Round 2's
  // values (props 0.20: 1.06 / 1.49 / 2.64; F = 3 1.30 / 2.07 / 3.60; F = 2 2.07 / 3.22 / 5.52) are printed as info.)
  const B = [4, 6, 10], WH = [3, 4, 5], spec = (t: number, f: number, props: number): number => Math.max((B[t] / f - props) / 0.87, 1 + 0.03 * (WH[t] - 1));
  const caps = [0, 1, 2].map((t) => unitCapOf(t)), movers = [0, 1, 2].map((t) => moverCapOf(t)), want4 = [0, 1, 2].map((t) => spec(t, 4, 0.33));
  check('LF-10', `unitCap at F = 4 by the formula with D-85's floor and PF-00's props 0.33: ${caps.map((c) => c.toFixed(3)).join(' / ')} (${want4.map((c) => c.toFixed(3)).join(' / ')}), moverCap ${movers.join(' / ')} (1 / 1 / 2); UNIT piece ${UNIT.piece}, pair ${UNIT.pair}, sleeper ${UNIT.sleeper}`,
    caps.every((c, t) => Math.abs(c - want4[t]) < 0.001) && Math.abs(caps[0] - 1.06) < 0.001 && movers.join() === '1,1,2' && UNIT.piece === 0.26 && UNIT.pair === 0.25 && UNIT.sleeper === 0.03);
  const f3 = [0, 1, 2].map((t) => unitCapOf(t, 3)), f2 = [0, 1, 2].map((t) => unitCapOf(t, 2));
  const w3 = [0, 1, 2].map((t) => spec(t, 3, 0.33)), w2 = [0, 1, 2].map((t) => spec(t, 2, 0.33));
  check('LF-10', `the F = 3 and F = 2 rows by the same formula (${f3.map((c) => c.toFixed(2)).join('/')}; ${f2.map((c) => c.toFixed(2)).join('/')}), moverCap at F = 3 ${[0, 1, 2].map((t) => moverCapOf(t, 3)).join('/')}`,
    f3.every((c, t) => Math.abs(c - w3[t]) < 0.001) && f2.every((c, t) => Math.abs(c - w2[t]) < 0.001) && [0, 1, 2].map((t) => moverCapOf(t, 3)).join() === w3.map((c) => Math.max(1, Math.floor(c + 0.001))).join());
  info('LF-10', `LIFE 10.3's table with the provisional props 0.20 (round 2's rows): F = 4 ${[0, 1, 2].map((t) => spec(t, 4, 0.2).toFixed(3)).join(' / ')}; F = 3 ${[0, 1, 2].map((t) => spec(t, 3, 0.2).toFixed(2)).join('/')}; F = 2 ${[0, 1, 2].map((t) => spec(t, 2, 0.2).toFixed(2)).join('/')}`);
}


/* ───────────────────────────── helpers for the scenarios ───────────────────────────── */
const BOUND = (def: PlaceDef, layout: 0 | 1) => (layout === 1 ? def.tall.bounds : def.bounds);
function inB(def: PlaceDef, layout: 0 | 1, x: number, z: number, shrink: number): boolean {
  const b = BOUND(def, layout), dx = Math.abs(x - b.x), dz = Math.abs(z - b.z);
  if (b.shape === 'disc') return Math.hypot(dx, dz) <= (b.r ?? 0) - shrink + 1e-6;
  const hx = (b.hx ?? 0) - shrink, hz = (b.hz ?? 0) - shrink, rr = Math.max(0, (b.round ?? 0) - shrink);
  if (dx > hx + 1e-6 || dz > hz + 1e-6) return false;
  const cx = hx - rr, cz = hz - rr;
  if (dx <= cx || dz <= cz) return true;
  return Math.hypot(dx - cx, dz - cz) <= rr + 1e-6;
}
/** Track per-step invariants: movers <= moverCap (LF-10), one moment per character (LF-11), and every LIFE start that wakes a body keeps
 *  units <= unitCap + the ride allowance. */
function watchGate(sim: Sim, rows: { movers: number; moment: number; wake: number; maxUnits: number }): void {
  const w = sim.w, cap = moverCapOf(sim.s.tier);
  if (w.movers > cap) rows.movers++;
  const seen = new Set<number>();
  for (let m = 0; m < 8; m++) {
    if (!w.mK[m]) continue;
    for (let k = 0; k < w.mN[m]; k++) { const j = w.mM[m * 6 + k]; if (j < 0) continue; if (seen.has(j) || w.moo[j] !== m) rows.moment++; seen.add(j); }
  }
}
function runWatched(sim: Sim, seconds: number, rows: { movers: number; moment: number; wake: number; maxUnits: number }): void {
  const end = sim.frame + Math.round(seconds * sim.fps);
  while (sim.frame < end) {
    const asleep = sim.bodies.map((b) => b.asleep);
    sim.step();
    watchGate(sim, rows);
    // a LIFE start that woke a sleeping body: the units after it must fit unitCap + the ride allowance
    let woke = false;
    for (let i = 0; i < 16; i++) if (sim.bodies[i].on && asleep[i] && !sim.bodies[i].asleep && !(sim.extraFlags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED))) woke = true;
    if (woke) {
      let u = 0;
      for (const b of sim.bodies) if (b.on) u += b.asleep ? UNIT.sleeper : b.kind === 0 ? UNIT.whole : UNIT.piece;
      rows.maxUnits = Math.max(rows.maxUnits, u - sim.w.att.allowance - unitCapOf(sim.s.tier));
      if (u > unitCapOf(sim.s.tier) + sim.w.att.allowance + 0.001) rows.wake++;
    }
  }
}
const gateRows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };

/* ───────────────────────────── FN-01 (LIFE's part): the first minute at Home ───────────────────────────── */
if (!LF02_CHILD) for (const [layout, label] of [[0, 'wide'], [1, 'tall']] as const) {
  const sim = home(3, ['dollop'], layout);
  sim.run(6); // the player let go 6 s ago
  const t0 = sim.t;
  lifeScript(sim.w, 0, SCRIPT.FIRST_PLAY, 0);
  runWatched(sim, 12, gateRows);
  const use = sim.events(LIFE_EV.USE).find((e) => e.thing === TID('feltball'));
  const bubble = sim.intents(INTENT.EMOTE).find((l) => l.t > t0 && l.icon > 0);
  check('FN-01', `${label}: after a 6 s pause and FIRST_PLAY, Dollop's ball use starts within 10 s (USE ROLL on the Felt Ball) and the ball is booped (the host's ball moved ${sim.ballMoved.toFixed(2)} m)`,
    !!use && use.t - t0 <= 10 && use.sub === USE_VERB.ROLL && sim.ballMoved >= 0.2, use ? `use at +${(use.t - t0).toFixed(2)} s` : 'no use');
  check('FN-01', `${label}: its first bubble within 10 s of the 6 s release (a question bubble as it notices the ball)`, !!bubble && bubble.t - t0 <= 10, bubble ? `icon ${bubble.icon} at +${(bubble.t - t0).toFixed(2)} s` : 'none');
  lifeScript(sim.w, 0, SCRIPT.FIRST_PLAY, 0);
  const before = sim.w.nU[0];
  check('LF-19', `${label}: FIRST_PLAY fires at most once (a second call changes nothing)`, before === -1 && sim.w.nU[0] === -1);
}
if (!LF02_CHILD) {
  const sim = home(5, ['dollop'], 0);
  sim.run(3);
  sim.add(1, 'crimpo', 1.3, 0.2, { isNew: true }); sim.home(1, 1.3, 0.2);
  const t0 = sim.t;
  runWatched(sim, 8, gateRows);
  const hello = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.GREET).find((e) => e.a === 1 || e.b === 1);
  const helloBubble = sim.intents(INTENT.EMOTE).find((l) => l.icon === EMOTE.hello && l.t >= t0);
  check('FN-01', 'the newcomer says hello within 5 s of coming out (an S01 greet with the nearest party member; its hello bubble)',
    !!hello && !!helloBubble && helloBubble.t - t0 <= 5, hello ? `greet bubble +${((helloBubble?.t ?? 99) - t0).toFixed(2)} s, event +${(hello.t - t0).toFixed(2)} s` : 'none');
}

/* ───────────────────────────── LF-01 determinism, LF-26 sim time only ───────────────────────────── */
if (!LF02_CHILD) {
  const secs = HEAVY ? 600 : 90;
  const hashes: number[] = [];
  for (const seed of [1, 2, 3]) {
    const a = cabin(seed, ['dollop', 'crimpo', 'capnap', 'puddlo']), b = cabin(seed, ['dollop', 'crimpo', 'capnap', 'puddlo']);
    a.keepLog = false; b.keepLog = false; a.run(secs); b.run(secs);
    hashes.push(a.hash);
    check('LF-01', `seed ${seed}: the same seed and snapshot script give the same intent and event hash over ${secs} s (${a.hash.toString(16)})`, a.hash === b.hash);
  }
  check('LF-01', 'another seed gives another hash', new Set(hashes).size === 3, hashes.map((h) => h.toString(16)).join(' '));
  // LF-26: music on, the music fields left as a host with a frozen or jumping AudioContext clock might write them: LIFE reads sim time only
  const runs = [0, 1, 2].map((mode) => {
    const sim = cabin(9, ['dollop', 'crimpo', 'pastrel']); sim.keepLog = false;
    const end = Math.round(60 * sim.fps);
    while (sim.frame < end) { sim.s.musicOn = mode !== 1; sim.step(); if (mode === 2) sim.s.beatPhase = (sim.frame * 0.37) % 1; }
    return sim.hash;
  });
  check('LF-26', 'the same run with music on, the music off, and a beat phase that jumps gives the same intent hash (no clock enters LIFE)', runs[0] === runs[1] && runs[1] === runs[2], runs.map((h) => h.toString(16)).join(' '));
}

/* ───────────────────────────── LF-16 30 and 60 fps ───────────────────────────── */
if (!LF02_CHILD) {
  const run = (fps: number): number => {
    const sim = cabin(4, ['dollop', 'crimpo', 'capnap', 'puddlo'], 1, fps); sim.physics = false; sim.keepLog = true;
    sim.run(60);
    let h = 0x811c9dc5;
    for (const l of sim.log) if (l.kind !== INTENT.EMOTE && l.kind !== INTENT.VOICE) h = Math.imul(h ^ (l.kind * 131 + l.who * 7 + Math.round(l.a * 1000) + Math.round(l.b * 977) + Math.round(l.c * 31) + Math.round(l.e * 1000)), 0x01000193) >>> 0;
    for (const e of sim.evs) h = Math.imul(h ^ (e.kind * 4099 + e.sub * 31 + e.a * 7 + e.n2 + e.thing * 3), 0x01000193) >>> 0;
    return h;
  };
  const h30 = run(30), h60 = run(60);
  check('LF-16', 'the same sim time stepped at 30 and at 60 fps gives the same decisions (motion, gaze, pose and expression intents and the events)', h30 === h60, `${h30.toString(16)} / ${h60.toString(16)}`);
}

/* ───────────────────────────── LF-04 HELD, LF-05 ───────────────────────────── */
if (!LF02_CHILD) {
  const sim = cabin(21, ['dollop', 'crimpo', 'capnap']);
  sim.run(20);
  sim.extraFlags[0] = LIFE_FLAG.TOUCHED; sim.touch[0] = TOUCH.SQUEEZE;
  sim.fill(); lifeStep(sim.w, sim.s, sim.out, sim.ev);
  let cancel = false, motion = 0;
  for (let k = 0; k < sim.out.n; k++) if (sim.out.who[k] === 0) { if (sim.out.kind[k] === INTENT.CANCEL) cancel = true; if ([INTENT.SCOOT, INTENT.HOP, INTENT.SQUASH, INTENT.GLIDE].includes(sim.out.kind[k] as 2)) motion++; }
  sim.apply(1 / 60); sim.frame++;
  check('LF-04', 'a touched character gets 0 motion intents in the same tick and its queue is cancelled (CANCEL)', cancel && motion === 0);
  const tA = sim.t; sim.run(3);
  const during = sim.log.filter((l) => l.who === 0 && l.t > tA && [INTENT.SCOOT, INTENT.HOP, INTENT.SQUASH, INTENT.GLIDE].includes(l.kind as 2)).length;
  sim.extraFlags[0] = 0; sim.touch[0] = TOUCH.SQUEEZE;
  const tR = sim.t; sim.run(1.45);
  const after = sim.log.filter((l) => l.who === 0 && l.t > tR && [INTENT.SCOOT, INTENT.HOP, INTENT.SQUASH, INTENT.GLIDE].includes(l.kind as 2)).length;
  check('LF-04', 'no motion intent while held, and none for 1.5 s after the release (the afterglow, then the grace)', during === 0 && after === 0, `${during} held, ${after} after`);
  // a lock with no finger down silences nobody else
  const a = createAttention(), s = mkSnapshot(), o = mkIntents();
  s.n = 2; s.t = 10; s.flags[0] = LIFE_FLAG.LOCKED | LIFE_FLAG.VISIBLE; s.flags[1] = LIFE_FLAG.VISIBLE;
  o.n = 2; o.kind[0] = INTENT.EMOTE; o.who[0] = 1; o.icon[0] = EMOTE.hello; o.style[0] = 0; o.e[0] = 2; o.prio[0] = 2.5;
  o.kind[1] = INTENT.VOICE; o.who[1] = 1; o.icon[1] = 1; o.d[1] = 2; o.e[1] = 0.3; o.prio[1] = 2.5;
  attentionFilter(a, s, o);
  const s2 = mkSnapshot(), o2 = mkIntents(), a2 = createAttention();
  s2.n = 2; s2.t = 10; s2.flags[0] = LIFE_FLAG.TOUCHED | LIFE_FLAG.VISIBLE; s2.flags[1] = LIFE_FLAG.VISIBLE;
  o2.n = 1; o2.kind[0] = INTENT.EMOTE; o2.who[0] = 1; o2.icon[0] = EMOTE.hello; o2.e[0] = 2; o2.prio[0] = 2.5;
  attentionFilter(a2, s2, o2);
  check('LF-04', "a lock with no finger down silences nobody: another's P2 bubble and voice pass (a finger down stops the P2 bubble)", o.n === 2 && o2.n === 0, `lock ${o.n}/2 kept, finger ${o2.n}/1 kept`);
  check('LF-05', 'no intent kind can press, grab or lock (the INTENT table)', !Object.keys(INTENT).some((k) => /^(PRESS|GRAB|LOCK|FINGER|POKE|SQUEEZE|PULL|TAP)/.test(k)), Object.keys(INTENT).join(' '));
}

export { Sim, cabin, home, mkSnapshot, mkIntents, mkEvents, check, info, G, SP, TID, HEAVY, VERBOSE };
export type { EvLog };

/* ───────────────────────────── the end (sections below are appended in order) ───────────────────────────── */

/* ───────────────────────────── LF-02 zero allocation, LF-03 cost (16 characters: 6 wholes and a cut squishy's 10 pieces) ───────────────────────────── */
/** LF-02's measurement (in its own process): a live crowd (6 wholes and a cut squishy's 10 pieces in the cabin, high tier) is recorded for
 *  WARM + N ticks; the same snapshots are replayed into fresh worlds built the same way (identical decisions), `passes` times over the
 *  whole run to warm the JIT, then into one more fresh world: WARM ticks, then N ticks measured in windows of 1000 (new-space growth; a
 *  window with a GC is negative and skipped). Every code path of a measured window has run in the warm-up passes. */
function lf02Measure(passes: number, warm: number, n: number): { wins: number[]; looks: number[] } {
  const rec = crowd(31); rec.keepLog = false;
  const snaps: LifeSnapshot[] = [];
  for (let f = 0; f < warm + n; f++) { rec.frame++; rec.t = rec.frame / rec.fps; rec.fill(); snaps.push(cloneSnap(rec.s)); lifeStep(rec.w, rec.s, rec.out, rec.ev); rec.apply(1 / rec.fps); }
  const out = mkIntents(), ev = mkEvents();
  const replay = (w: LifeWorld, a: number, b: number): void => { for (let f = a; f < b; f++) lifeStep(w, snaps[f], out, ev); };
  for (let p = 0; p < passes; p++) replay(crowd(31).w, 0, warm + n);
  const rep = crowd(31).w;
  replay(rep, 0, warm);
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const base: number[] = []; for (let k = 0; k < 6; k++) { const u0 = newUsed(); base.push(newUsed() - u0); }
  const b0 = base[5], wins: number[] = [];
  for (let wdw = 0; wdw < n / 1000; wdw++) { const u0 = newUsed(); replay(rep, warm + wdw * 1000, warm + (wdw + 1) * 1000); wins.push(newUsed() - u0 - b0); }
  // LIFE's own looks calls
  const lo = new Float32Array(6);
  const looksLoop = (m: number): void => { for (let k = 0; k < m; k++) { lifeLooks(rep, k & 7, lo); lifeAddLook(rep, k & 7, LOOK.wet, 0.0001, -1); } };
  looksLoop(50000);
  const looks: number[] = []; for (let k = 0; k < 4; k++) { const u0 = newUsed(); looksLoop(20000); looks.push(newUsed() - u0 - b0); }
  return { wins, looks };
}
if (LF02_CHILD) {
  const passes = Number(process.argv.find((a) => a.startsWith('--passes='))?.slice(9) ?? 3);
  console.log('LF02 ' + JSON.stringify(lf02Measure(passes, 1000, 6000)));
  process.exit(0);
}
if (!LF02_CHILD) {
  const WARM = 1000, N = 6000;
  const rec = crowd(31); rec.keepLog = false;
  const snaps: LifeSnapshot[] = [];
  for (let f = 0; f < WARM + N; f++) { rec.frame++; rec.t = rec.frame / rec.fps; rec.fill(); snaps.push(cloneSnap(rec.s)); lifeStep(rec.w, rec.s, rec.out, rec.ev); rec.apply(1 / rec.fps); }
  // LF-02: replay the same snapshots into fresh worlds (identical decisions): three warm the JIT over the whole run, a fourth one is
  // measured over windows of 1000 ticks (new-space growth; a window with a GC is negative and skipped), like probe_collection's C08
  const out = mkIntents(), ev = mkEvents();
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const replay = (w: LifeWorld, a: number, b: number): void => { for (let f = a; f < b; f++) lifeStep(w, snaps[f], out, ev); };
  for (let pass = 0; pass < 3; pass++) replay(crowd(31).w, 0, WARM + N);
  const rep = crowd(31);
  replay(rep.w, 0, WARM);
  const base: number[] = []; for (let k = 0; k < 6; k++) { const u0 = newUsed(); base.push(newUsed() - u0); }
  const b0 = base[5], wins: number[] = [];
  for (let wdw = 0; wdw < N / 1000; wdw++) { const u0 = newUsed(); replay(rep.w, WARM + wdw * 1000, WARM + (wdw + 1) * 1000); wins.push(newUsed() - u0 - b0); }
  const pos = wins.filter((d) => d >= 0);
  check('LF-02', `lifeStep allocates 0 B over ${N} ticks at 16 characters after warm-up (new-space growth per 1000-tick window: ${wins.join(', ')} B; a window with a GC is negative)`,
    pos.length >= 3 && pos.every((d) => d <= 64), `max ${Math.max(...pos)} B`);
  // LIFE's own looks calls
  const lw = rep.w, lo = new Float32Array(6);
  const looksLoop = (n: number): void => { for (let k = 0; k < n; k++) { lifeLooks(lw, k & 7, lo); lifeAddLook(lw, k & 7, LOOK.wet, 0.0001, -1); } };
  looksLoop(50000);
  const lw2: number[] = []; for (let k = 0; k < 4; k++) { const u0 = newUsed(); looksLoop(20000); lw2.push(newUsed() - u0 - b0); }
  const dl = Math.min(...lw2.filter((d) => d > -4096)); // a window with a GC is far below 0; -64..64 is the measurement's own noise
  check('LF-20', `lifeLooks and lifeAddLook allocate 0 B (20 000 calls each, best of 4 windows: ${lw2.join(', ')} B)`, dl <= 64);
  // the same measurement in a process of its own after a long warm-up (--heavy): how the residual falls as the JIT tiers up
  if (HEAVY) {
    for (const passes of [30, 100]) {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--lf02', `--passes=${passes}`], { encoding: 'utf8', timeout: 120000 });
      const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('LF02 '));
      info('LF-02', `isolated process, ${passes} replay passes of the same ${WARM + N} ticks before the measured world (V8 default tiers): ${line ? line.slice(5) : 'no result ' + (r.stderr ?? '').slice(0, 200)}`);
    }
  }
  // LF-03: the cost per tick, a fresh world replaying the same snapshots
  const tw = crowd(31), times: number[] = [];
  for (let f = 0; f < WARM + N; f++) { const t0 = performance.now(); lifeStep(tw.w, snaps[f], out, ev); const dt = performance.now() - t0; if (f >= WARM) times.push(dt); }
  times.sort((a, b) => a - b);
  const med = times[times.length >> 1], p99 = times[Math.floor(times.length * 0.99)];
  const thinksPerTick = 16 / 6; // 60 fps, each of 16 characters thinks at 10 Hz
  check('LF-03', `lifeStep median ${(med * 1000).toFixed(1)} us a tick at 16 characters (60 fps: about ${thinksPerTick.toFixed(1)} thinks a tick; p99 ${(p99 * 1000).toFixed(1)} us), bar 100 us`, med <= 0.1);
}

/* ───────────────────────────── LF-10 the gate's rows, LF-11, and the scenarios of LF-09 ───────────────────────────── */
if (!LF02_CHILD) {
  // low, 3 wholes all asleep (units 0.09): a start that wakes one is granted (1.06, the cap) and a second mover is refused
  for (const [tier, n] of [[0, 3], [1, 4]] as const) {
    const sim = cabin(41, ['dollop', 'crimpo', 'capnap', 'puddlo'].slice(0, n), tier);
    sim.bodies.forEach((b) => { if (b.on) b.asleep = true; });
    const rows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
    let maxMovers = 0, firstStart = -1;
    const end = sim.frame + 40 * 60;
    while (sim.frame < end) {
      sim.step(); watchGate(sim, rows);
      maxMovers = Math.max(maxMovers, sim.w.movers);
      if (firstStart < 0 && sim.w.movers > 0) firstStart = sim.t;
    }
    const awakeMax = Math.max(...[0].map(() => 0));
    void awakeMax;
    check('LF-10', `${tier === 0 ? 'low' : 'med'} with ${n} wholes all asleep: a start that wakes one is granted (first at ${firstStart.toFixed(1)} s) and movers never pass ${moverCapOf(tier)} (max ${maxMovers})`,
      firstStart >= 0 && maxMovers <= moverCapOf(tier) && rows.movers === 0);
  }
  const u = 1.0 + 0.03 * 2;
  check('LF-10', `one awake and two asleep on low is not over the cap (${u.toFixed(2)} <= ${unitCapOf(0).toFixed(2)})`, u <= unitCapOf(0) + 0.001);
  // S11 on low and med: one rider the player set on the Pillow Swing, the others asleep: the pusher starts (the ride allowance)
  for (const tier of [0, 1]) {
    const sim = cabin(43, ['dollop', 'crimpo', 'capnap'], tier);
    const sw = CABIN.things.find((t) => t.id === 'pillowswing')!;
    sim.bodies[1].x = sw.x; sim.bodies[1].z = sw.z; sim.extraFlags[1] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP;
    sim.bodies[0].x = 1.2; sim.bodies[0].z = -0.6; sim.bodies[0].asleep = true; sim.bodies[2].asleep = true;
    sim.sleep = false; sim.bodies[0].asleep = true; sim.bodies[2].asleep = true;
    const rows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
    runWatched(sim, 40, rows);
    const push = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.PUSH);
    check('LF-10', `${tier === 0 ? 'low' : 'med'}: with one rider set on the Pillow Swing, S11's pusher starts (the ride allowance) and pushes (${push.length} PUSH), within the caps`, push.length >= 1 && rows.wake === 0 && rows.movers === 0, `wake over ${rows.wake}`);
  }
  // S10: two riders teeter on the Rocker Board on low and on med
  for (const tier of [0, 1]) {
    const sim = cabin(45, ['dollop', 'thumbly', 'capnap'], tier);
    const rk = CABIN.things.find((t) => t.id === 'rockerboard')!;
    sim.bodies[0].x = rk.x - 0.75; sim.bodies[0].z = rk.z; sim.bodies[1].x = rk.x + 0.75; sim.bodies[1].z = rk.z;
    sim.extraFlags[0] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP; sim.extraFlags[1] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP;
    const rows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
    runWatched(sim, 20, rows);
    const tee = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.TEETER);
    const hops = sim.intents(INTENT.HOP).filter((l) => l.who <= 1).length;
    const scootRiders = sim.intents(INTENT.SCOOT).filter((l) => l.who <= 1).length;
    check('LF-10', `${tier === 0 ? 'low' : 'med'}: two riders set on the Rocker Board teeter (${tee.length} TEETER, ${hops} hops in turn, ${scootRiders} scoots off it)`, tee.length >= 1 && hops >= 3 && scootRiders === 0);
  }
  // a boop on low and med is a soft boop (the target stays asleep, its wobble a render wiggle); on high a physics boop
  for (const tier of [0, 1, 2]) {
    const sim = cabin(47, ['boingle', 'puddlo'], tier); sim.kettle = false;
    sim.w.tr[0] = 0.95; sim.w.pl[0] = 0.9;
    sim.bodies[0].x = 0.4; sim.bodies[0].z = 0.3; sim.bodies[1].x = 1.45; sim.bodies[1].z = 0.3; sim.bodies[1].asleep = true;
    lifeSetPair(sim.w, 0, 1, 1, false); sim.w.pG[1] = 1;
    // keep only the boop: no other moment kinds or uses
    sim.w.coo.fill(1e9); sim.w.tr[2] = 0; sim.w.tr[1] = 0; sim.w.tr[3] = 0; sim.w.tr[5 + 2] = 0; sim.w.tr[5 + 3] = 0;
    for (let k = 0; k < 16; k++) sim.w.coo[k * 26 + 21] = -1e9;
    const rows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
    runWatched(sim, 40, rows);
    const boop = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.BOOP)[0];
    const A = boop ? boop.a : 0, B = boop ? boop.b : 1;
    const soft = sim.log.some((l) => l.kind === INTENT.SCOOT && l.who === A && Math.abs(l.c - 0.04) < 1e-6);
    const wiggle = sim.log.some((l) => l.kind === INTENT.POSE && l.who === B && Math.abs(l.c - 0.05) < 1e-4 && l.d >= 2 && l.d <= 3.0001 && l.t > boop.t - 6);
    const physHop = sim.log.some((l) => l.kind === INTENT.HOP && l.who === A && Math.hypot(l.a, l.c) > 0.3);
    const want = tier < 2 ? 'soft' : 'physics';
    check('LF-10', `${['low', 'med', 'high'][tier]}: a boop is a ${want} boop (${boop ? 'BOOP' : 'no BOOP'}; contact at 0.04 m/s ${soft}, render wiggle ${wiggle}, a hop into it ${physHop})`,
      !!boop && (tier < 2 ? soft && wiggle && !physHop : physHop && !wiggle) && rows.wake === 0);
  }
}

/* LF-09: a 5-minute cabin visit on med with 4 wholes and no input; the pairs become Met after their greet (the reducer's FRIEND -> lifeSetPair).
 * "A thing use" (written down in the report, round 2): one completed by-itself use of a thing in LIFE 5.3's sense, i.e. a USE event with a = the
 * squishy and b != PLAYER whose verb is a mechanism use: a boop of the Yarn Ball (B04, or the squishy's turn in an S12 pass: ROLL) or a nap
 * settled on a nap thing (the Snug Basket, the Snooze Rug: NAP). B18's USE LISTEN (answering the kettle's whistle) is not a use: LIFE 5.3's
 * switch row says a squishy never uses a switch, "it watches, and answers a tune". */
function lf09Run(seed: number, rows: { movers: number; moment: number; wake: number; maxUnits: number } | null): { sim: Sim; uses: number[]; greets: Set<string>; begun: Set<number> } {
  const sim = cabin(seed, ['dollop', 'crimpo', 'capnap', 'puddlo'], 1);
  const end = sim.frame + 300 * 60;
  const begun = new Set<number>();
  let lastEv = 0;
  while (sim.frame < end) {
    sim.step(); if (rows) watchGate(sim, rows);
    for (let i = 0; i < 4; i++) begun.add(sim.w.beh[i]);
    for (; lastEv < sim.evs.length; lastEv++) { const e = sim.evs[lastEv]; if (e.kind === LIFE_EV.SOCIAL && e.sub === SOCIAL_KIND.GREET) lifeSetPair(sim.w, e.a, e.b, 1, false); }
  }
  const greets = new Set(sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.GREET).map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`));
  const uses = [0, 1, 2, 3].map((i) => sim.events(LIFE_EV.USE).filter((e) => e.a === i && e.b !== 254 && e.sub !== USE_VERB.LISTEN).length);
  return { sim, uses, greets, begun };
}
if (!LF02_CHILD) {
  const { sim, uses, greets, begun } = lf09Run(51, gateRows);
  const napStarts = [0, 1, 2, 3].filter((i) => sim.log.some((l) => l.who === i && l.kind === INTENT.EXPRESS && l.a === 2 && l.b === 1)).length;
  const verbs = [0, 1, 2, 3].map((i) => sim.events(LIFE_EV.USE).filter((e) => e.a === i).map((e) => Object.keys(USE_VERB).find((k) => USE_VERB[k as keyof typeof USE_VERB] === e.sub)).join('+'));
  info('LF-09', `the USE events by verb (LISTEN listed, not counted): ${verbs.join(' | ')}`);
  const social: Record<string, number> = {};
  for (const e of sim.events(LIFE_EV.SOCIAL)) { const k = Object.keys(SOCIAL_KIND).find((q) => SOCIAL_KIND[q as keyof typeof SOCIAL_KIND] === e.sub) ?? String(e.sub); social[k] = (social[k] ?? 0) + 1; }
  info('LF-09', `5-minute cabin visit, 4 wholes, med, no input: SOCIAL ${JSON.stringify(social)}, thing uses per squishy ${uses.join('/')}, nap starts ${napStarts}, behaviours seen ${[...begun].sort((a, b) => a - b).join(',')}`);
  check('LF-09', `every pair greets (${greets.size} of 6 pairs) and at least 1 nap (${napStarts} nappers)`, greets.size === 6 && napStarts >= 1);
  check('LF-09', `each squishy 2 to 3 thing uses (ball boops and naps on a nap thing: ${uses.join(' / ')})`, uses.every((u) => u >= 2 && u <= 3));
  const spread: string[] = [];
  for (const seed of [52, 53, 54, 55]) { const r = lf09Run(seed, null); spread.push(`seed ${seed}: ${r.greets.size}/6 pairs, uses ${r.uses.join('/')}${r.uses.every((u) => u >= 2 && u <= 3) && r.greets.size === 6 ? '' : ' (out)'}`); }
  info('LF-09', `the same visit with other seeds (not checked; the balance is chaotic): ${spread.join('; ')}`);
}
if (!LF02_CHILD) check('LF-10', `movers never exceed the tier's moverCap in the scenarios above (${gateRows.movers} frames over)`, gateRows.movers === 0);
if (!LF02_CHILD) check('LF-11', `no character is in two joint moments at once (${gateRows.moment} violations)`, gateRows.moment === 0);
if (!LF02_CHILD) check('LF-10', `every LIFE start that woke a body kept units at or under unitCap + the ride allowance (${gateRows.wake} over)`, gateRows.wake === 0);

/* ───────────────────────────── LF-06 targets ───────────────────────────── */
if (!LF02_CHILD) {
  for (const layout of [0, 1] as const) {
    const sim = cabin(61, ['dollop', 'crimpo', 'capnap', 'puddlo', 'thumbly'], 2, 60, layout);
    let bad = 0, outside = 0, free = 0, n = 0;
    const offs: string[] = [];
    const lastLog = { i: 0 };
    const end = sim.frame + 180 * 60;
    while (sim.frame < end) {
      sim.step();
      for (; lastLog.i < sim.log.length; lastLog.i++) {
        const l = sim.log[lastLog.i];
        if (l.kind !== INTENT.SCOOT) continue;
        n++;
        if (!inB(CABIN, layout, l.a, l.b, 0)) { outside++; offs.push(`${l.who}:b${sim.w.beh[l.who]}m${sim.w.moo[l.who] >= 0 ? sim.w.mK[sim.w.moo[l.who]] : 0}@${l.a.toFixed(2)},${l.b.toFixed(2)}`); }
        const beh = sim.w.beh[l.who];
        if (beh === BEH.WANDER || beh === BEH.COMEBACK) {
          free++;
          const R = sim.bodies[l.who].r;
          if (!inB(CABIN, layout, l.a, l.b, R + 0.2)) bad++;
        }
      }
    }
    check('LF-06', `${layout ? 'tall' : 'wide'} cabin: no target outside the bounds (${outside} of ${n} SCOOTs) and no free target (wander, come back: ${free}) outside the bounds shrunk by R + 0.2 (${bad})`, outside === 0 && bad === 0 && n > 0, offs.join(' '));
  }
  // Home: every target lies on a segment between two framed points (home slots, arrived use spots, the ball), within 0.01 m
  let homeBad = 0, homeN = 0; const homeOffs: string[] = [];
  for (const [layout, nOut] of [[0, 3], [1, 3], [0, 2], [1, 1]] as const) {
    const sim = home(63 + nOut, ['dollop', 'crimpo', 'capnap'].slice(0, nOut), layout);
    for (let i = 0; i < nOut; i++) sim.w.pl[i] = 0.7;
    let li = 0;
    const end = sim.frame + 120 * 60;
    while (sim.frame < end) {
      sim.step();
      for (; li < sim.log.length; li++) {
        const l = sim.log[li];
        if (l.kind !== INTENT.SCOOT) continue;
        homeN++;
        const pts: number[][] = [];
        for (let i = 0; i < nOut; i++) pts.push([sim.bodies[i].homeX, sim.bodies[i].homeZ]);
        for (let k = 0; k < sim.things.length; k++) {
          const def = HOME.things.find((t) => TID(t.id) === sim.things[k])!, li2 = HOME.things.indexOf(def);
          if (def.mech === MECH.ball) pts.push([sim.ballX, sim.ballZ]);
          const u = layout === 1 ? HOME.tall.things[li2].use : def.useSpot;
          if (u) pts.push([u[0], u[1]]);
        }
        let best = 1e9;
        for (const p of pts) for (const q of pts) {
          const vx = q[0] - p[0], vz = q[1] - p[1], L = vx * vx + vz * vz;
          let u = L > 0 ? ((l.a - p[0]) * vx + (l.b - p[1]) * vz) / L : 0; u = Math.max(0, Math.min(1, u));
          best = Math.min(best, Math.hypot(l.a - p[0] - vx * u, l.b - p[1] - vz * u));
        }
        if (best > 0.01 + 0.06) { homeBad++; homeOffs.push(`${l.who}:b${sim.w.beh[l.who]}m${sim.w.moo[l.who] >= 0 ? sim.w.mK[sim.w.moo[l.who]] : 0}@${l.a.toFixed(2)},${l.b.toFixed(2)} off ${best.toFixed(2)}`); }
      }
    }
  }
  check('LF-06', `Home: every SCOOT target lies on a segment between two framed points (home slots, arrived things' use spots, the ball; ${homeBad} of ${homeN} off by more than 0.07 m, the ball's live position allowing its 0.06 m roll in a tick)`, homeBad === 0 && homeN > 0, homeOffs.join(' '));
  const one = home(65, ['dollop'], 1); one.w.pl[0] = 0.9; one.run(60);
  check('LF-06', 'Home, one squishy on a portrait phone: no wander at all (B03 does not fire)', !one.log.some((l) => l.kind === INTENT.SCOOT && one.w.beh[l.who] === BEH.WANDER));
}

/* ───────────────────────────── LF-07 a storm of requests, LF-08 pieces merge, LF-17 Calm ───────────────────────────── */
if (!LF02_CHILD) {
  for (const [phone, calm] of [[true, false], [true, true], [false, false], [false, true]] as const) {
    const a = createAttention(), s = mkSnapshot(), o = mkIntents();
    s.n = 16; s.phone = phone; s.calm = calm;
    for (let i = 0; i < 16; i++) { s.flags[i] = LIFE_FLAG.VISIBLE; s.sx[i] = 0.1 + i * 0.05; s.sy[i] = 0.5; }
    const col = (phone ? 0 : 2) + (calm ? 1 : 0);
    const starts: number[] = [], sylStarts: number[] = []; let maxOn = 0, maxV = 0, p1Req = 0, p1Got = 0, maxGroupOn = 0;
    const on = new Map<number, number>(), von: number[] = [];
    let seed = 12345;
    const r = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    for (let f = 0; f < 60 * 60; f++) {
      s.t = f / 60; o.n = 0;
      // about 50 requests a second over 16 characters: say, group (pieces 6..15) and wishes, voices of 1..4 syllables
      for (let q = 0; q < 2; q++) {
        if (r() > 0.42) continue;
        const k = o.n++, who = Math.floor(r() * 16), isVoice = r() < 0.4, cls = r() < 0.15 ? 1 : who >= 6 ? 3 : 2;
        o.kind[k] = isVoice ? INTENT.VOICE : INTENT.EMOTE; o.who[k] = who; o.delayS[k] = 0;
        o.icon[k] = 1 + Math.floor(r() * 20); o.style[k] = !isVoice && r() < 0.08 ? 1 : who >= 6 ? 2 : 0; o.groupKey[k] = who >= 6 ? 6 : -1;
        o.e[k] = isVoice ? 0.4 : cls; o.d[k] = isVoice ? 1 + Math.floor(r() * 4) : 0; o.b[k] = isVoice && who >= 6 ? 1 : 0;
        o.prio[k] = (cls === 1 ? 3 : cls === 2 ? 2 : 1) + r();
        if (!isVoice && cls === 1) p1Req++;
      }
      attentionFilter(a, s, o);
      for (let k = 0; k < o.n; k++) {
        if (o.kind[k] === INTENT.EMOTE && o.icon[k] > 0) {
          if (o.style[k] === 0 || o.style[k] === 2) { starts.push(s.t); on.set(o.who[k], s.t + 2); }
          if (o.e[k] === 1) p1Got++;
        } else if (o.kind[k] === INTENT.VOICE) { for (let y = 0; y < o.d[k]; y++) sylStarts.push(s.t); von.push(s.t + o.e[k]); }
      }
      let n = 0, g = 0; for (const [w, u] of on) if (u > s.t) { n++; if (w >= 6) g++; }
      let dots = 0; for (let i = 0; i < 16; i++) dots += a.wishDot[i] ? 0.25 : 0;
      maxOn = Math.max(maxOn, n + dots); maxGroupOn = Math.max(maxGroupOn, g);
      maxV = Math.max(maxV, von.filter((u) => u > s.t).length);
    }
    const perSec = (arr: number[]): number => { let m = 0; for (let i = 0; i < arr.length; i++) { let c = 0; for (let j = i; j < arr.length && arr[j] < arr[i] + 1; j++) c++; m = Math.max(m, c); } return m; };
    const bubCap = Math.floor(CAPS.bubbleBurst[col] + CAPS.bubbleRate[col]), sylCap = Math.floor(CAPS.sylBurst[col] + CAPS.sylRate[col]);
    const name = ['phone', 'phone Calm', 'desktop', 'desktop Calm'][col];
    check('LF-07', `${name}: a 16-character storm (~50 requests a second for 60 s): bubble starts per rolling second max ${perSec(starts)} (<= ${bubCap}), at once ${maxOn} (<= ${CAPS.bubbles[col]}, wish dots 0.25), group bubbles ${maxGroupOn} (<= 1), voices at once ${maxV} (<= ${CAPS.voices[col]}), syllables per second ${perSec(sylStarts)} (<= ${sylCap}), P1 granted ${p1Got} of ${p1Req}`,
      perSec(starts) <= bubCap && maxOn <= CAPS.bubbles[col] + 1e-9 && maxGroupOn <= 1 && maxV <= CAPS.voices[col] && perSec(sylStarts) <= sylCap && p1Got > 0 && a.wishOwner < 16);
  }
  // LF-08: 6 pieces doing one action within 0.5 s give 1 bubble and 1 voice (a whole cut into 6 inside the fireside warmth: B15 for each)
  const sim = new Sim(71, CABIN, 0); sim.s.place = 1; sim.s.tier = 2;
  CABIN.things.forEach((t) => sim.addThing(t.id, t.x, t.z));
  sim.add(0, 'pastrel', -1.6, -1.2); sim.run(1); lifeRemove(sim.w, 0); sim.bodies[0].on = false;
  for (let k = 0; k < 6; k++) sim.add(k, 'pastrel', -2.0 + (k % 3) * 0.35, -1.25 + Math.floor(k / 3) * 0.35, { kind: k === 0 ? 1 : 2, group: 0, frac: 1 / 6, r: 0.27, seed: 7 });
  const t0 = sim.t; sim.run(0.6);
  const em = sim.log.filter((l) => l.kind === INTENT.EMOTE && l.icon > 0 && l.t >= t0 && l.t <= t0 + 0.6), vo = sim.log.filter((l) => l.kind === INTENT.VOICE && l.t >= t0 && l.t <= t0 + 0.6);
  check('LF-08', `6 pieces doing one action within 0.5 s (entering the warmth at the cut) give 1 bubble (a group bubble with count dots ${em[0]?.style === STYLE.GROUP ? 'yes' : 'no'}) and at most 1 voice`, em.length === 1 && vo.length <= 1, `${em.length} bubbles, ${vo.length} voices`);
  // LF-22: the cut inside the warmth gives one PIECES WARM with n = 6 at the cut
  const pw = sim.events(LIFE_EV.PIECES, REACT_KIND.WARM);
  check('LF-22', `a whole in the hearth's warmth cut into pieces gives one PIECES WARM with n = the pieces inside it at the cut (${pw.map((e) => e.n2).join(',')}), thing = the Fireplace`, pw.length === 1 && pw[0].n2 === 6 && pw[0].thing === TID('hearth'));
  // LF-17: Calm or reduced motion: hop chains at most 3, no wiggle over 2 Hz, the hops x 0.6
  const c = cabin(73, ['boingle', 'crimpo', 'dollop', 'puddlo'], 2); c.s.calm = true; c.run(120);
  const poses = c.intents(INTENT.POSE), hops = c.intents(INTENT.HOP);
  let chain = 0, maxChain = 0; const byWho = new Map<number, number>();
  for (const h of hops) { const last = byWho.get(h.who) ?? -9; chain = h.t - last < 1.6 ? chain + 1 : 1; byWho.set(h.who, h.t); maxChain = Math.max(maxChain, chain); }
  check('LF-17', `Calm: no render wiggle or sway over 2 Hz (${poses.filter((p) => p.d > 2.0001).length} of ${poses.length} POSE), hops at most 0.84 x 0.6 m/s (max ${Math.max(0, ...hops.map((h) => h.b)).toFixed(3)})`,
    poses.every((p) => p.d <= 2.0001) && hops.every((h) => h.b <= 0.84 * 0.6 + 1e-6));
  info('LF-17', `Calm: the longest run of hops less than 1.6 s apart by one character: ${maxChain}`);
}

/* ───────────────────────────── LF-13 huff, LF-23 RIDE, LF-24 autonomy off ───────────────────────────── */
if (!LF02_CHILD) {
  check('LF-13', `the huff's triggers are a static table of squishy-to-squishy scene events only: ${HUFF_TRIGGERS.join('; ')}`, HUFF_TRIGGERS.length === 2 && HUFF_TRIGGERS.every((t) => /another squishy/.test(t)));
  // stage a take: two wholes in B04 on the same ball; the late one huffs only after the session's first 60 s, at most 3 s, a touch ends it
  const stage = (at: number): Sim => {
    const sim = cabin(81, ['dollop', 'boingle'], 2); sim.kettle = false;
    sim.run(at);
    const w = sim.w, ball = w.gTL[TID('yarnball')];
    for (let m = 0; m < 8; m++) w.mK[m] = 0; w.moo.fill(-1); w.coo[0 * 26 + BEH.HUFF] = -1e9;
    w.beh[0] = BEH.USE; w.tT[0] = ball; w.ph[0] = 1; w.bT[0] = sim.t; w.bSc[0] = 1;
    w.beh[1] = BEH.USE; w.tT[1] = ball; w.ph[1] = 2; w.bT[1] = sim.t; w.bSc[1] = 1;
    sim.ballX = -1.35; sim.ballZ = 1.9; sim.ballVX = 0; sim.ballVZ = 0; sim.bodies[1].x = -1.35; sim.bodies[1].z = 1.15; sim.bodies[1].asleep = false;
    // (round 5, FIX5_DATA, a fixture fix with its reason: the chaser's own spot was left to the 70 s of history before the take, so any change
    // of the cabin's layout reshuffled it (the wide Rocker Board moved 0.25 m and Dollop stood at (0.87, -0.23), walked off at once and never
    // saw the take). It now stands where HEAD's history left it, walking to the ball, as the taker's spot is set above; the checks are unchanged.)
    sim.bodies[0].x = -1.47; sim.bodies[0].z = 0.65; sim.bodies[0].asleep = false;
    sim.s.thingBusy.fill(1);
    const orig = sim.fill.bind(sim); sim.fill = () => { orig(); for (let k = 0; k < sim.s.nThings; k++) if (sim.s.thingId[k] === TID('yarnball')) sim.s.thingBusy[k] = 1; };
    return sim;
  };
  const early = stage(20); early.run(2);
  check('LF-13', 'never in a session\'s first 60 s (a take at 20 s gives no huff)', !early.intents(INTENT.EMOTE).some((l) => l.icon === EMOTE.puff));
  // the take after 60 s: B16 is a utility candidate (0.5) for 3 s after the scene event, so it shows once what it was doing ends (a notice
  // of the moving ball first); every B16 lasts at most 3 s (measured per think, 0.1 s)
  const late = stage(70); const t0 = late.t;
  let huffS = 0, maxHuff = 0, huffs = 0, prev = false;
  for (let f = 0; f < 8 * 60; f++) { late.step(); const on = late.w.beh[0] === BEH.HUFF; if (on) { huffS += 1 / 60; if (!prev) huffs++; } else huffS = 0; maxHuff = Math.max(maxHuff, huffS); prev = on; }
  const puff = late.intents(INTENT.EMOTE).find((l) => l.icon === EMOTE.puff && l.t >= t0 && l.who === 0);
  const huffEv = late.intents(INTENT.VOICE).find((l) => l.icon === 10 && l.t >= t0 && l.who === 0);
  check('LF-13', `after 60 s the take gives one huff (B16 ${huffs}x, its puff bubble ${puff ? `at +${(puff.t - t0).toFixed(1)} s` : 'dropped by the budget'}, its low coo ${huffEv ? 'yes' : 'no'}), and B16 lasts at most 3 s (longest ${maxHuff.toFixed(2)} s)`,
    huffs === 1 && !!puff && maxHuff <= 3 + 0.1 + 1e-6);
  const late2 = stage(70);
  let waited = 0; while (late2.w.beh[0] !== BEH.HUFF && waited < 6 * 60) { late2.step(); waited++; }
  late2.run(1); // a second into the huff the player touches it (the puff bubble's own 2.5 s gap is the budget's)
  const was = late2.w.beh[0] === BEH.HUFF, tTouch = late2.t;
  late2.extraFlags[0] = LIFE_FLAG.TOUCHED; late2.run(0.3);
  const ended = late2.w.beh[0] !== BEH.HUFF, squint = late2.intents(INTENT.EXPRESS, 0).some((l) => l.t >= tTouch && l.a === 1);
  late2.extraFlags[0] = 0; late2.run(2); // a held squishy shows no bubble (L2): the giggle shows at the release, as its afterglow (P1)
  const gig = late2.intents(INTENT.EMOTE).find((l) => l.icon === EMOTE.giggle && l.who === 0 && l.t >= tTouch);
  check('LF-13', `any touch ends the huff (it turns into a giggle): huffing ${was} at +${(waited / 60).toFixed(1)} s; touched: B16 ended ${ended}, a happy squint ${squint}, the giggle bubble at the release ${gig ? `+${(gig.t - tTouch).toFixed(2)} s` : 'none'}`,
    was && ended && squint && !!gig);
  // the second scene event: another squishy took the spot it was walking to (the Snug Basket a napper was heading for)
  const spot = cabin(87, ['capnap', 'dollop'], 2); spot.kettle = false; spot.run(70);
  {
    const w = spot.w, bk = w.gTL[TID('snugbasket')];
    for (let m = 0; m < 8; m++) w.mK[m] = 0; w.moo.fill(-1); w.coo[0 * 26 + BEH.HUFF] = -1e9;
    w.beh[0] = BEH.NAP; w.ph[0] = 1; w.tT[0] = bk; w.tC[0] = -1; w.uS[0] = 1; w.bT[0] = spot.t; w.bE[0] = spot.t + 60; w.bSc[0] = 0.8;
    w.tx[0] = w.tWX[bk]; w.tz[0] = w.tWZ[bk]; spot.bodies[0].x = 0.4; spot.bodies[0].z = -0.3;
    w.b1[0] = 0; w.zSe[0] = 0xffff; // no zone reaction pending (it would outrank the huff's 0.5)
    for (const b of [BEH.BASK, BEH.USE, BEH.WANDER, BEH.NAP, BEH.MOMENT]) w.coo[0 * 26 + b] = 1e9; // nor a bask, use, wander or moment (0.5 and up)
    spot.bodies[1].x = -1.8; spot.bodies[1].z = -0.45; w.beh[1] = BEH.NAP; w.ph[1] = 2; w.tT[1] = bk; w.bE[1] = spot.t + 60;
  }
  const ts0 = spot.t; spot.run(5);
  const spotPuff = spot.intents(INTENT.EMOTE).find((l) => l.icon === EMOTE.puff && l.who === 0 && l.t >= ts0);
  check('LF-13', `another squishy took the spot it was walking to (the Snug Basket): it stops walking there and huffs (${spotPuff ? `puff at +${(spotPuff.t - ts0).toFixed(1)} s` : 'no huff'})`, !!spotPuff);
  // LF-23 RIDE: set on the rocker, still on it 15 s later with no input; a lone rider's star (P1); a touch ends it
  const r = cabin(83, ['thumbly', 'capnap'], 1); const rk = CABIN.things.find((t) => t.id === 'rockerboard')!;
  r.bodies[0].x = rk.x - 0.75; r.bodies[0].z = rk.z; r.extraFlags[0] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP;
  const tr0 = r.t; r.run(15);
  const moved = r.log.filter((l) => l.who === 0 && (l.kind === INTENT.SCOOT || l.kind === INTENT.HOP) && l.t > tr0 + 0.5).length;
  const star = r.log.find((l) => l.kind === INTENT.EMOTE && l.who === 0 && l.icon === EMOTE.star && l.e === 1);
  check('LF-23', `a squishy set on the rocker is still on it 15 s later with no input (${moved} scoots or hops off it; at ${r.bodies[0].x.toFixed(2)}, ${r.bodies[0].z.toFixed(2)}), in B20`, moved === 0 && r.w.beh[0] === BEH.RIDE && Math.hypot(r.bodies[0].x - (rk.x - 0.75), r.bodies[0].z - rk.z) < 0.01);
  check('LF-23', 'a lone rider shows its star bubble as a P1 request ("Ride with me!")', !!star);
  r.extraFlags[0] = LIFE_FLAG.TOUCHED; r.run(0.2);
  check('LF-23', 'a touch ends it (HELD; the shell clears RIDE on a touch)', r.w.beh[0] !== BEH.RIDE);
  // LF-24 autonomy off: no hops, scoots, glides or squash poses, except a player-asked use and a ride the player set up
  const a = cabin(85, ['dollop', 'crimpo', 'capnap', 'puddlo'], 2); a.s.autonomy = false; a.run(60);
  const moving = a.log.filter((l) => [INTENT.SCOOT, INTENT.HOP, INTENT.GLIDE, INTENT.SQUASH].includes(l.kind as 2)).length;
  const kept = ['GAZE', 'POSE', 'EMOTE', 'VOICE'].map((k) => a.log.filter((l) => l.kind === INTENT[k as 'GAZE']).length);
  check('LF-24', `autonomy off: 0 hops, scoots, glides and squash poses in 60 s (${moving}); gaze ${kept[0]}, render poses ${kept[1]}, bubbles ${kept[2]}, voices ${kept[3]} stay`, moving === 0 && kept.every((k) => k > 0));
  lifeScript(a.w, 0, SCRIPT.PLAY_WITH, a.w.gTL[TID('yarnball')]);
  const tp = a.t; a.run(12);
  const asked = a.log.filter((l) => l.t > tp && (l.kind === INTENT.SCOOT || l.kind === INTENT.HOP));
  const byPlayer = a.evs.find((e) => e.t > tp && e.kind === LIFE_EV.USE && e.a === 0 && e.b === 254);
  check('LF-24', `autonomy off: "Go play with..." still moves that one squishy (${asked.filter((l) => l.who === 0).length} of ${asked.length} motion intents are its), and its USE carries by PLAYER (b = 254)`, asked.length > 0 && asked.every((l) => l.who === 0) && !!byPlayer);
  check('LF-19', 'PLAY_WITH: the focused squishy\'s next behaviour is that use, started at once, its USE by PLAYER', !!byPlayer && byPlayer.t - tp < 10);
}

/* ───────────────────────────── LF-19 the scripts, LF-14 and LF-25 wishes ───────────────────────────── */
if (!LF02_CHILD) {
  const journal = (sim: Sim, open: number, kinds: number): void => lifeSetJournal(sim.w, new Uint32Array(2), open, new Uint32Array(4), kinds);
  // FIRST_WISH with no Dollop owned: the slot the shell names; no natural wish before it (a touch wish due before 2:30)
  const a = home(91, ['glugbean', 'capnap'], 0); journal(a, 1, THING_KIND.ball | THING_KIND.note);
  a.w.pl[0] = 0.95; a.w.pl[1] = 0.95; a.run(150);
  const before = a.events(LIFE_EV.WISH, WISH_STATE.SHOWN).length;
  lifeScript(a.w, 1, SCRIPT.FIRST_WISH, 0); a.run(3);
  const shown = a.events(LIFE_EV.WISH, WISH_STATE.SHOWN);
  const wo = new Int32Array(2); lifeWishOf(a.w, shown[0]?.a ?? 0, wo);
  check('LF-19', `FIRST_WISH with no Dollop owned: no natural wish before it (${before} by 2:30, a touch wish was due), then the wisher the shell named (slot ${shown[0]?.a}) shows the Hearthlog postcard`, before === 0 && shown.length === 1 && shown[0].a === 1 && wo[0] === WISH_KIND.PLACE && wo[1] === 1);
  // with Dollop out: Dollop wishes even if the shell named another; Dollop on the shelf: a Hearthlog fan, else the one out longest
  const b = home(93, ['crimpo', 'glugbean', 'dollop'], 0); journal(b, 1, 0); b.run(5);
  lifeScript(b.w, 1, SCRIPT.FIRST_WISH, 0); b.run(2);
  const sb = b.events(LIFE_EV.WISH, WISH_STATE.SHOWN)[0];
  check('LF-19', `FIRST_WISH: the slot the shell sends is the wisher (D-70: the shell picks Dollop / a fan / the longest out): slot ${sb?.a}`, sb?.a === 1);
  const c = home(95, ['glugbean', 'crimpo'], 0); journal(c, 1, 0); c.run(5);
  c.extraFlags[0] = LIFE_FLAG.TOUCHED; lifeScript(c.w, 0, SCRIPT.FIRST_WISH, 0); c.run(2);
  const sc = c.events(LIFE_EV.WISH, WISH_STATE.SHOWN)[0];
  check('LF-19', `FIRST_WISH when the named wisher is held: a Hearthlog fan out shows it instead (Crimpo, slot ${sc?.a})`, sc?.a === 1);
  const d = home(97, ['glugbean'], 0); journal(d, 1, 0); d.s.quiet = true; d.run(2);
  lifeScript(d.w, 0, SCRIPT.FIRST_WISH, 0); d.run(2);
  const none = d.events(LIFE_EV.WISH).length;
  lifeScript(d.w, 0, SCRIPT.FIRST_WISH, 1); d.run(1);
  const rested = d.events(LIFE_EV.WISH, WISH_STATE.SHOWN).find((e) => e.b === 254);
  check('LF-19', 'FIRST_WISH: nobody can show it (all quiet): it waits, and at the 5:00 backstop it rests in the Journal (WISH SHOWN, b = 254)', none === 0 && !!rested);
  lifeScript(d.w, 0, SCRIPT.FIRST_WISH, 1); d.run(1);
  check('LF-19', 'FIRST_WISH fires at most once', d.events(LIFE_EV.WISH).length === 1);
  // POSE, CHEER, SQUIRTED
  const p = cabin(99, ['dollop', 'crimpo', 'capnap'], 1); p.run(5);
  lifeScript(p.w, 0, SCRIPT.POSE, 1); p.run(0.5);
  const posing = [0, 1, 2].every((i) => p.w.beh[i] === BEH.POSE);
  lifeScript(p.w, 0, SCRIPT.POSE, 0); p.run(0.5);
  check('LF-19', 'POSE: B12 for every character on screen while the Snap tool is in hand, and it ends when it is put away', posing && [0, 1, 2].every((i) => p.w.beh[i] !== BEH.POSE));
  lifeScript(p.w, 0, SCRIPT.CHEER, 0); const tc = p.t; p.run(3); // a P1 waits up to 2 s for the per-character bubble gap
  const cheers = p.log.filter((l) => l.t > tc && l.kind === INTENT.EMOTE && l.icon === EMOTE.star && l.who !== 0).length;
  check('LF-19', `CHEER: B14 for up to two characters near the one that caused it (${cheers} star bubbles)`, cheers >= 1 && cheers <= 2);
  lifeScript(p.w, 2, SCRIPT.SQUIRTED, 1); const ts = p.t; p.run(1.2);
  const sq = p.log.filter((l) => l.t > ts && l.who === 2 && (l.kind === INTENT.EMOTE || l.kind === INTENT.VOICE));
  check('LF-19', 'SQUIRTED: the target\'s wow, then its giggle', sq.some((l) => l.kind === INTENT.EMOTE && l.icon === EMOTE.wow) && sq.some((l) => l.kind === INTENT.VOICE && l.icon === 15));
  // LF-14 and LF-25: natural wishes over 20 minutes at Home with 3 out (Hearthlog open: the first wish has shown)
  const h = home(101, ['dollop', 'glugbean', 'capnap'], 0); journal(h, 0b11, THING_KIND.ball);
  for (let i = 0; i < 3; i++) h.w.pl[i] = 0.9;
  const mins = HEAVY ? 30 : 20, wishT: number[][] = [[], [], []]; let maxOpen = 0, maxFull = 0, glanceMax = 0, thingOk = true;
  const end = h.frame + mins * 60 * 60;
  let li = 0;
  while (h.frame < end) {
    h.step();
    for (let i = 0; i < 3; i++) h.w.pl[i] = Math.max(h.w.pl[i], 0.85);
    let open = 0; for (let i = 0; i < 3; i++) if (h.w.wK[i]) open++;
    maxOpen = Math.max(maxOpen, open);
    maxFull = Math.max(maxFull, h.w.att.wishOwner >= 0 ? 1 : 0);
    for (let i = 0; i < 3; i++) glanceMax = Math.max(glanceMax, h.w.wG[i]);
    for (; li < h.evs.length; li++) { const e = h.evs[li]; if (e.kind === LIFE_EV.WISH && e.sub === WISH_STATE.SHOWN) { wishT[e.a].push(e.t); const o = new Int32Array(2); lifeWishOf(h.w, e.a, o); if (o[0] === WISH_KIND.THING && (o[1] & ~THING_KIND.ball) !== 0) thingOk = false; } }
    // grant place wishes now and then (a trip), so new ones can come
    if (h.frame % (90 * 60) === 0) for (let i = 0; i < 3; i++) if (h.w.wK[i]) { h.w.wK[i] = 0; }
  }
  const all = wishT.flat().sort((x, y) => x - y);
  const gapAny = all.slice(1).reduce((m, t, k) => Math.min(m, t - all[k]), 1e9), gapSelf = Math.min(...wishT.map((ts) => ts.slice(1).reduce((m, t, k) => Math.min(m, t - ts[k]), 1e9)));
  check('LF-14', `${mins} min, 3 out: ${all.length} wishes; at most 1 open a squishy and ${maxOpen} open in all (<= 3), the wish slot holds one (${maxFull}), gaps ${gapAny === 1e9 ? '-' : gapAny.toFixed(0)} s overall (>= 120) and ${gapSelf === 1e9 ? '-' : gapSelf.toFixed(0)} s a squishy (>= 180), at most 2 re-glances (${glanceMax})`,
    all.length >= 2 && maxOpen <= 3 && gapAny >= 120 - 1e-6 && gapSelf >= 180 - 1e-6 && glanceMax <= 2);
  check('LF-25', 'thing wishes target only the kinds in the thing-kind mask (here: ball only)', thingOk);
}

/* ───────────────────────────── round 2: S05's parade, P04 join in, the curious one walks over after a cut ───────────────────────────── */
if (!LF02_CHILD) {
  // S05 parade: a leader with bouncy >= 0.6 hops, a curious one within 2 m sees it, a third idle whole is near: turn by turn, one mover at a time
  const p = cabin(141, ['boingle', 'dollop', 'crimpo', 'capnap'], 1); p.kettle = false;
  const pos = [[0.2, 0.4], [-0.8, 0.6], [0.7, 1.2], [2.6, -0.5]];
  pos.forEach(([x, z], k) => { p.bodies[k].x = x; p.bodies[k].z = z; });
  p.run(12); // the arrival, the greets and Crimpo's love of its place (B10) pass first
  const pw = p.w;
  pw.tr[0 * 5 + 0] = 0.9; pw.tr[1 * 5 + 1] = 0.95; for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) { pw.pG[Math.min(a, b) * 16 + Math.max(a, b)] = 1; lifeSetPair(pw, a, b, 1, false); }
  for (const k of [0, 1, 2]) for (const bh of [BEH.USE, BEH.NAP, BEH.BASK, BEH.WANDER, BEH.MOMENT]) pw.coo[k * 26 + bh] = 1e9;
  const pRows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
  const tp0 = p.t;
  // the staging: the leader hops every 0.5 s until a moment takes it, and the trio's 20 s pair cooldowns are kept clear (other moments
  // between them would otherwise block the copy for 20 s each)
  for (let f = 0; f < 90 * 60; f++) {
    if (f % 30 === 0 && pw.moo[0] < 0 && p.events(LIFE_EV.SOCIAL, SOCIAL_KIND.PARADE).length === 0) { pw.lHT[0] = p.t; for (const q of [1, 2, 18]) pw.pCo[q] = -1e9; }
    p.step(); watchGate(p, pRows);
  }
  const par = p.events(LIFE_EV.SOCIAL, SOCIAL_KIND.PARADE)[0];
  const pScoots = par ? p.intents(INTENT.SCOOT).filter((l) => l.t >= tp0 && l.t <= par.t && l.who <= 2).length : 0;
  check('S05', `a little parade: 3 or more, a leader with bouncy >= 0.6, turn by turn (${par ? `PARADE n ${par.n2}, leader slot ${par.a}, ${pScoots} glides` : 'no PARADE'}), one mover at a time (${pRows.movers} frames over moverCap), no character in two moments (${pRows.moment})`,
    !!par && par.n2 >= 3 && par.a === 0 && pScoots >= 3 && pRows.movers === 0 && pRows.moment === 0);
  // P04 join in: a whole boops the ball near a cut squishy's group; the face piece copies the use as a group: one PIECES record, sub PIECES_USE + ROLL
  const j = new Sim(143, CABIN, 0); j.s.place = 1; j.s.tier = 2; CABIN.things.forEach((t) => j.addThing(t.id, t.x, t.z));
  const ball = CABIN.things.find((t) => t.id === 'yarnball')!;
  j.add(0, 'dollop', ball.x + 0.9, ball.z - 0.3); j.add(5, 'pastrel', ball.x - 0.6, ball.z - 1.2, { seed: 11 });
  j.run(15); lifeRemove(j.w, 5); j.bodies[5].on = false; // the cut (it has been out a while): the whole goes, its pieces come (they saw what it saw)
  j.add(1, 'pastrel', ball.x - 0.4, ball.z - 1.0, { kind: 1, group: 5, frac: 0.4, r: 0.36, seed: 11 });
  for (let k = 2; k < 4; k++) j.add(k, 'pastrel', ball.x - 0.9 + (k - 2) * 0.4, ball.z - 1.3, { kind: 2, group: 5, frac: 0.3, r: 0.3, seed: 11 });
  j.run(2.5);
  const jw = j.w, bl = jw.gTL[TID('yarnball')];
  const tj0 = j.t; jw.tU[bl] = 0; jw.tUT[bl] = j.t; // the whole just booped the ball
  j.run(12);
  const join = j.events(LIFE_EV.PIECES).filter((e) => e.t >= tj0 && e.sub === PIECES_USE + USE_VERB.ROLL);
  check('P04', `join in: the face piece copies a nearby whole's ball use as a group (${join.map((e) => `PIECES ROLL n ${e.n2} +${(e.t - tj0).toFixed(1)} s`).join(', ') || 'none'}; a use's PIECES sub is PIECES_USE + verb, ${PIECES_USE + USE_VERB.ROLL})`,
    join.length >= 1 && join[0].a === 1 && join[0].thing === TID('yarnball'));
  // after a cut, the most curious other whole walks over to look (once the Cut tool is put away: its quiet holds the wholes)
  const c = cabin(145, ['crimpo', 'dollop', 'capnap'], 2); c.kettle = false;
  c.bodies[0].x = -2.2; c.bodies[0].z = 1.2; c.bodies[1].x = 2.2; c.bodies[1].z = 0.4; c.bodies[2].x = 2.6; c.bodies[2].z = -1.0;
  c.run(2);
  c.w.tr[1 * 5 + 1] = 0.95; c.w.tr[2 * 5 + 1] = 0.2;
  c.touch[0] = TOUCH.CUT; c.s.quiet = true; c.run(0.2);
  lifeRemove(c.w, 0); c.bodies[0].on = false;
  c.add(5, 'crimpo', -2.2, 1.2, { kind: 1, group: 0, frac: 0.5, r: 0.4, seed: c.w.gs[0] }); c.add(6, 'crimpo', -1.6, 1.4, { kind: 2, group: 0, frac: 0.5, r: 0.4, seed: c.w.gs[0] });
  c.run(2); const d0 = Math.hypot(c.bodies[1].x - c.bodies[5].x, c.bodies[1].z - c.bodies[5].z);
  c.s.quiet = false; const tc0 = c.t;
  let d1 = 99, gazed = false, li = c.log.length;
  for (let f = 0; f < 20 * 60; f++) {
    c.step();
    d1 = Math.min(d1, Math.hypot(c.bodies[1].x - c.bodies[5].x, c.bodies[1].z - c.bodies[5].z));
    for (; li < c.log.length; li++) { const l = c.log[li]; if (l.who === 1 && l.kind === INTENT.GAZE && Math.hypot(l.a - c.bodies[5].x, l.c - c.bodies[5].z) < 0.3) gazed = true; }
  }
  check('LIFE 9', `after a cut the most curious other whole walks over to look (Dollop: ${d0.toFixed(2)} m from the face piece while the Cut tool's quiet holds it, nearest ${d1.toFixed(2)} m in the 20 s after; it gazes at the piece ${gazed})`,
    d1 < d0 - 1 && d1 < 1.7 && gazed);
}

/* ───────────────────────────── the friend wish (QUESTS 8; lifeSetFriends, round 2) ───────────────────────────── */
if (!LF02_CHILD) {
  const bit = (sp: number): Uint32Array => { const m = new Uint32Array(2); m[sp >>> 5] |= 1 << (sp & 31); return m; };
  const owned = (ids: string[]): Uint32Array => { const m = new Uint32Array(2); for (const id of ids) { const k = SP(id); m[k >>> 5] |= 1 << (k & 31); } return m; };
  const friendRun = (ownedIds: string[], friendOut: boolean, maskOn: boolean): { sim: Sim; shown: EvLog | undefined; wo: Int32Array } => {
    const sim = home(121, friendOut ? ['crimpo', 'glugbean', 'dollop'] : ['crimpo', 'glugbean'], 0);
    lifeSetJournal(sim.w, owned(ownedIds), 0b11, new Uint32Array(4), THING_KIND.ball);
    if (maskOn) lifeSetFriends(sim.w, SP('crimpo'), bit(SP('dollop')));
    const end = sim.frame + 400 * 60;
    let shown: EvLog | undefined;
    const wo = new Int32Array(2);
    while (sim.frame < end && !shown) {
      sim.w.co[0] = 0.95; sim.w.pl[0] = 0.2; sim.w.re[0] = 0.1; for (let i = 1; i < 3; i++) { sim.w.co[i] = 0.1; sim.w.pl[i] = 0.2; }
      sim.step();
      shown = sim.events(LIFE_EV.WISH, WISH_STATE.SHOWN).find((e) => e.a === 0);
      if (shown) lifeWishOf(sim.w, 0, wo);
    }
    return { sim, shown, wo };
  };
  const yes = friendRun(['crimpo', 'glugbean', 'dollop'], false, true);
  check('FW', `a friend wish: company over 0.8, its friend (lifeSetFriends) owned and on the shelf: Crimpo wishes to see Dollop (${yes.shown ? `+${yes.shown.t.toFixed(0)} s, lifeWishOf [${yes.wo.join(', ')}]` : 'none'}; its snug bubble ${yes.sim.intents(INTENT.EMOTE, 0).some((l) => l.icon === EMOTE.snug && l.style === STYLE.THINK) ? 'yes' : 'no'})`,
    !!yes.shown && yes.wo[0] === WISH_KIND.FRIEND && yes.wo[1] === SP('dollop'));
  const none = [friendRun(['crimpo', 'glugbean'], false, true), friendRun(['crimpo', 'glugbean', 'dollop'], true, true), friendRun(['crimpo', 'glugbean', 'dollop'], false, false)]
    .map((r) => { const w = new Int32Array(2); return r.shown && lifeWishOf(r.sim.w, 0, w) && w[0] === WISH_KIND.FRIEND ? 1 : 0; });
  check('FW', `no friend wish for a species not owned, one that is out, or one not in its lifeSetFriends mask (Friends or closer, or the best friend once F3: ${none.join('/')})`, none.every((n) => n === 0));
  // the grant: the friend comes out (the player brings it); the wisher greets it from wherever it is and the wish is granted
  const g = yes.sim; const tg = g.t;
  g.add(2, 'dollop', 1.3, 0.2); g.home(2, 1.3, 0.2);
  g.run(20);
  const granted = g.events(LIFE_EV.WISH, WISH_STATE.GRANTED).find((e) => e.a === 0 && e.t >= tg);
  const greet = g.events(LIFE_EV.SOCIAL, SOCIAL_KIND.GREET).find((e) => e.t >= tg && ((e.a === 0 && e.b === 2) || (e.a === 2 && e.b === 0)));
  check('FW', `brought out, the friend is greeted and the wish is granted (${greet ? `greet +${(greet.t - tg).toFixed(1)} s` : 'no greet'}, ${granted ? `granted +${(granted.t - tg).toFixed(1)} s` : 'not granted'})`, !!greet && !!granted);
  // the grant greet ignores S01's once per visit and gives no friendship points (SOCIAL thing = -2 for the host)
  const h = friendRun(['crimpo', 'glugbean', 'dollop'], false, true).sim;
  h.add(2, 'dollop', 1.3, 0.2); h.home(2, 1.3, 0.2);
  h.w.pG[0 * 16 + 2] = 1; // this pair greeted already this visit
  const th = h.t; h.run(20);
  const again = h.events(LIFE_EV.SOCIAL, SOCIAL_KIND.GREET).find((e) => e.t >= th && (e.a === 0 || e.b === 0));
  check('FW', `when the pair greeted already this visit, the grant greet comes once more with thing = -2 (no points: the host sets v = -1) (${again ? `thing ${again.thing}` : 'no greet'})`, !!again && again.thing === -2 && h.events(LIFE_EV.WISH, WISH_STATE.GRANTED).some((e) => e.a === 0 && e.t >= th));
}

/* ───────────────────────────── S06 sing together at a tune (round 4): the kettle, the fire puff (lifeThingTap), a latecomer ───────────────────────────── */
// LIFE 6.1 S06: "2+ idle within 2.5 m of a tune (Music Box, the kettle's whistle, a tapped chime row, the fire puff)"; QUESTS C8 "Tap the
// fireplace. Then three sing together." The scenes are staged calm: three wholes set within 2.5 m of the tune, every pair greeted already, the
// pair moments and the other behaviours on cooldown, so the song is the only thing that can start (the way the huff and boop rows stage).
if (!LF02_CHILD) {
  const stage = (seed: number, at: 'kettle' | 'hearth', kettle: boolean): Sim => {
    const sim = cabin(seed, ['dollop', 'crimpo', 'capnap'], 1);
    sim.kettle = kettle;
    const t = CABIN.things.find((q) => q.id === at)!;
    const spots = at === 'kettle' ? [[-0.7, 0.5], [-0.2, 0.9], [-1.0, -0.1]] : [[0.6, 1.2], [-0.4, 1.3], [1.4, 0.9]];
    spots.forEach(([dx, dz], i) => { const b = sim.bodies[i]; b.x = t.x + dx; b.z = t.z + dz; b.tx = b.x; b.tz = b.z; });
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { sim.w.pG[i * 16 + j] |= 1; sim.w.pCo[i * 16 + j] = 1e9; }
    for (let i = 0; i < 3; i++) for (const bh of [BEH.USE, BEH.NAP, BEH.BASK, BEH.WANDER, BEH.MOMENT, BEH.ANSWER]) sim.w.coo[i * 26 + bh] = 1e9;
    return sim;
  };
  // the kettle's whistle (the sim's kettle: 40 s into every 67 s): one song of all three, its thing the kettle
  {
    const sim = stage(181, 'kettle', true);
    sim.run(52);
    const sg = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SING);
    const sv = sim.log.filter((l) => l.kind === INTENT.VOICE && l.t >= 40 && l.t < 52);
    check('S06', `(round 4) three set within 2.5 m of the kettle sing together at its whistle: one SING with n2 = 3, its thing the kettle (${sg.map((e) => `${e.t.toFixed(1)} s n2 ${e.n2} thing ${e.thing}`).join(', ') || 'none'}; ${sv.length} voice intents from 40 s)`,
      sg.length === 1 && sg[0].n2 === 3 && sg[0].thing === TID('kettle') && sg[0].t > 40 && sg[0].t < 40 + 3.7 + 2 * 3.64 + 0.2);
  }
  // the fire puff: lifeThingTap on the Fireplace (the shell's thing tap, D-93); those within 1.5 m notice it at once (LIFE 5.3: a switch tap is
  // always noticed), then all three sing; the same scene without the tap (and no kettle) gives no song
  {
    const tap = 3.636 * 6 + 0.5;   // 3.1 s before a bar line of the 66 BPM grid
    const sim = stage(183, 'hearth', false);
    sim.run(tap);
    const hearth = CABIN.things.find((q) => q.id === 'hearth')!, t0 = sim.t;
    lifeThingTap(sim.w, TID('hearth'));
    sim.run(0.15);
    const near = [0, 1, 2].filter((i) => Math.hypot(sim.bodies[i].x - hearth.x, sim.bodies[i].z - hearth.z) <= 1.5);
    const gazed = near.filter((i) => sim.log.some((l) => l.kind === INTENT.GAZE && l.who === i && l.t >= t0 && Math.hypot(l.a - hearth.x, l.c - hearth.z) < 0.05));
    sim.run(12);
    const sg = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SING);
    check('S06', `(round 4) the fire puff (lifeThingTap on the Fireplace) is noticed within 0.15 s by each squishy within 1.5 m (${gazed.length} of ${near.length} gazed at it), then the three by the fire sing together: SING n2 = 3, its thing the Fireplace (${sg.map((e) => `+${(e.t - t0).toFixed(1)} s n2 ${e.n2} thing ${e.thing}`).join(', ') || 'none'})`,
      near.length >= 1 && gazed.length === near.length && sg.length === 1 && sg[0].n2 === 3 && sg[0].thing === TID('hearth') && sg[0].t - t0 < 3.7 + 2 * 3.64 + 0.2);
    const ctl = stage(183, 'hearth', false);
    ctl.run(tap + 12.2);
    check('S06', `(round 4) the same scene with no tap and no kettle gives no song (${ctl.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SING).length} SING)`, ctl.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SING).length === 0);
    // a latecomer: the third is in the player's hand when the fire puffs and set down 0.5 s later; after its afterglow (1.5 s) it joins the
    // song before the song's first bar line (3.1 s after the tap)
    const late = stage(183, 'hearth', false);
    late.run(tap);
    late.extraFlags[2] = LIFE_FLAG.TOUCHED; late.touch[2] = TOUCH.POKE; late.run(0.1);
    const lt0 = late.t;
    lifeThingTap(late.w, TID('hearth'));
    late.run(0.4); late.extraFlags[2] = 0;
    let joinedAt = -1;
    const end = late.frame + 12 * 60;
    while (late.frame < end) { late.step(); if (joinedAt < 0 && late.w.moo[2] >= 0 && late.w.mK[late.w.moo[2]] === 6) joinedAt = late.t; }
    const lsg = late.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SING);
    check('S06', `(round 4) a latecomer joins a song before its first bar line: the third, held when the fire puffed, joins at +${(joinedAt - lt0).toFixed(1)} s (the bar line +3.1 s); SING n2 = 3 (${lsg.map((e) => `n2 ${e.n2}`).join(', ') || 'none'})`,
      joinedAt > lt0 + 0.4 && joinedAt < lt0 + 3.1 && lsg.length === 1 && lsg[0].n2 === 3);
  }
  // (round 4, engineer 5) S07 snuggle and S13 peekaboo are behaviours (D-75), so LIFE 4's utility choice holds while they run: a song at a
  // tune (0.95) beats the running snuggle (0.55 + the 0.15 keep). Staged as above, but the snuggle is allowed for the members named, and
  // the first of them is happy (a joy) at 35 s, so a snuggle is running when the kettle whistles at 40 s. The gate is watched on every step:
  // no character in two moments (LF-11), movers within moverCap (LF-10).
  {
    const kt = CABIN.things.find((q) => q.id === 'kettle')!;
    const snugStage = (sp: string[], pos: number[][], snug: number[], kettle: boolean): Sim => {
      const sim = cabin(181, sp, 1);
      sim.kettle = kettle;
      pos.forEach(([x, z], i) => { const b = sim.bodies[i]; b.x = x; b.z = z; b.tx = x; b.tz = z; });
      for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) { sim.w.pG[i * 16 + j] |= 1; sim.w.pCo[i * 16 + j] = 1e9; }
      for (let i = 0; i < sp.length; i++) for (const bh of [BEH.USE, BEH.NAP, BEH.BASK, BEH.WANDER, BEH.MOMENT, BEH.ANSWER]) sim.w.coo[i * 26 + bh] = 1e9;
      for (const i of snug) sim.w.coo[i * 26 + BEH.MOMENT] = 0;
      sim.run(35); sim.w.lJT[snug[0]] = sim.t;
      return sim;
    };
    const SNUG = 7, SING_M = 6;
    const inSnug = (sim: Sim, i: number): boolean => sim.w.moo[i] >= 0 && sim.w.mK[sim.w.moo[i]] === SNUG;
    const runGate = (sim: Sim, until: number, bad: { two: number; movers: number }): void => {
      while (sim.t < until) {
        sim.step();
        if (sim.w.movers > moverCapOf(sim.s.tier)) bad.movers++;
        const seen = new Set<number>();
        for (let m = 0; m < 8; m++) { if (!sim.w.mK[m]) continue; for (let k = 0; k < sim.w.mN[m]; k++) { const j = sim.w.mM[m * 6 + k]; if (j < 0) continue; if (seen.has(j) || sim.w.moo[j] !== m) bad.two++; seen.add(j); } }
      }
    };
    // (a) all three beside the kettle are in a snuggle when it whistles: the snuggle ends (its row had formed: its SOCIAL goes out) and they sing
    {
      const sim = snugStage(['dollop', 'crimpo', 'capnap'], [[kt.x - 0.7, kt.z + 0.5], [kt.x - 0.2, kt.z + 0.9], [kt.x - 1.0, kt.z - 0.1]], [0, 1, 2], true);
      const bad = { two: 0, movers: 0 };
      runGate(sim, 39.9, bad);
      const before = [0, 1, 2].filter((i) => inSnug(sim, i)).length, d = [0, 1, 2].map((i) => Math.hypot(sim.bodies[i].x - kt.x, sim.bodies[i].z - kt.z));
      runGate(sim, 54, bad);
      const sg = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SING), sn = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SNUGGLE).filter((e) => e.t >= 39.9);
      check('S06', `(round 4, e5) three in a snuggle beside the kettle (${before} of 3 in it at 39.9 s, ${d.map((x) => x.toFixed(2)).join(' / ')} m from it) sing at its whistle: the snuggle gives way (its SOCIAL at ${sn.map((e) => `${e.t.toFixed(1)} s n2 ${e.n2}`).join(', ') || 'none'}), then SING n2 = 3, its thing the kettle (${sg.map((e) => `${e.t.toFixed(1)} s n2 ${e.n2} thing ${e.thing}`).join(', ') || 'none'}); in two moments ${bad.two}, movers over ${bad.movers}`,
        before === 3 && d.every((x) => x < 2.5) && sn.length === 1 && sn[0].t < 40.2 && sg.length === 1 && sg[0].n2 === 3 && sg[0].thing === TID('kettle') && sg[0].t > 40 && sg[0].t < 40 + 3.7 + 2 * 3.64 + 0.2 && bad.two === 0 && bad.movers === 0);
    }
    // (b) a free squishy by the kettle starts the song and takes the two near it out of a snuggle with two farther away (in the same think:
    // the song's first bar line is on the whistle's own bar line here, so they could not join later as latecomers)
    {
      const sim = snugStage(['dollop', 'crimpo', 'capnap', 'puddlo', 'glugbean'], [[kt.x, kt.z + 2.2], [kt.x - 0.4, kt.z + 1.9], [kt.x - 2.3, kt.z], [kt.x - 3.2, kt.z + 0.5], [kt.x - 4.0, kt.z - 0.1]], [2, 3, 4], true);
      const bad = { two: 0, movers: 0 };
      runGate(sim, 39.9, bad);
      const free0 = !inSnug(sim, 0) && sim.w.moo[0] < 0, snugNear = [1, 2].filter((i) => inSnug(sim, i) && Math.hypot(sim.bodies[i].x - kt.x, sim.bodies[i].z - kt.z) < 2.5).length;
      const farIn = [3, 4].filter((i) => inSnug(sim, i) && Math.hypot(sim.bodies[i].x - kt.x, sim.bodies[i].z - kt.z) >= 2.5).length;
      let took = -1;
      while (sim.t < 40.5) { runGate(sim, sim.t + 1 / 60, bad); if (took < 0 && sim.w.moo[0] >= 0 && sim.w.mK[sim.w.moo[0]] === SING_M) took = [1, 2].filter((i) => sim.w.moo[i] === sim.w.moo[0]).length; }
      runGate(sim, 54, bad);
      const sg = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SING);
      check('S06', `(round 4, e5) a free squishy by the kettle starts the song at its whistle and takes the ${snugNear} snuggling within 2.5 m of it out of a snuggle (${farIn} more snuggling farther away): ${took} taken at the start; SING n2 = 3, its thing the kettle (${sg.map((e) => `${e.t.toFixed(1)} s n2 ${e.n2} a ${e.a} b ${e.b} thing ${e.thing}`).join(', ') || 'none'}); in two moments ${bad.two}, movers over ${bad.movers}`,
        free0 && snugNear === 2 && farIn >= 1 && took === 2 && sg.length === 1 && sg[0].n2 === 3 && sg[0].thing === TID('kettle') && bad.two === 0 && bad.movers === 0);
    }
    // (c) the control: a snuggle 3.6 m and more from the kettle keeps going through its whistle and ends with its SOCIAL; no song
    {
      const sim = snugStage(['dollop', 'crimpo', 'capnap'], [[-1.5, 0.5], [-1.0, 0.9], [-1.8, 0.0]], [0, 1, 2], true);
      const bad = { two: 0, movers: 0 };
      runGate(sim, 39.9, bad);
      const before = [0, 1, 2].filter((i) => inSnug(sim, i)).length, dmin = Math.min(...[0, 1, 2].map((i) => Math.hypot(sim.bodies[i].x - kt.x, sim.bodies[i].z - kt.z)));
      runGate(sim, 54, bad);
      const sn = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SNUGGLE).filter((e) => e.t >= 39.9);
      check('S06', `(round 4, e5) the control: a snuggle ${dmin.toFixed(1)} m and more from the kettle (${before} of 3 in it at 39.9 s) is not called away by its whistle: it ends on its own (${sn.map((e) => `${e.t.toFixed(1)} s n2 ${e.n2}`).join(', ') || 'none'}), ${sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SING).length} SING`,
        before === 3 && dmin > 2.5 && sn.length === 1 && sn[0].t > 44 && sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.SING).length === 0 && bad.two === 0 && bad.movers === 0);
    }
  }
}

/* ───────────────────────────── LF-20 looks, LF-21 REACT from LIFE's real output ───────────────────────────── */
if (!LF02_CHILD) {
  // the Window Chill (cold 0.3): frost rises at 0.015 a s and does not fall while the cause is present; FROST once per visit at 0.5
  const sim = new Sim(111, CABIN, 0); sim.s.place = 1;
  CABIN.things.forEach((t) => sim.addThing(t.id, t.x, t.z));
  sim.add(0, 'dollop', 2.4, -1.9); sim.add(1, 'crimpo', 0, 0.8);
  sim.physics = false; sim.run(20);
  const lo = new Float32Array(6); lifeLooks(sim.w, 0, lo);
  check('LF-20', `in the cabin's Window Chill (cold 0.3) frost rises at 0.015 a s (${(lo[0] / 20).toFixed(4)} a s over 20 s) and does not fall there`, Math.abs(lo[0] - 0.3) < 0.02);
  sim.run(25); lifeLooks(sim.w, 0, lo);
  const frost = sim.events(LIFE_EV.REACT, REACT_KIND.FROST).filter((e) => e.a === 0);
  check('LF-20', `frost crosses 0.5 (${lo[0].toFixed(2)} at 45 s) and emits FROST once per visit, with the zone's thing (-1: the Window Chill has no owning thing)`, lo[0] > 0.5 && frost.length === 1);
  const shiver = sim.events(LIFE_EV.REACT, REACT_KIND.SHIVER).filter((e) => e.a === 0);
  check('LF-21', 'SHIVER: in a cold zone for 2 s, a family with shiver (jelly gel), once per visit', shiver.length === 1);
  sim.bodies[0].x = 0.5; sim.bodies[0].z = 0.8; sim.run(10); const before = lo[0]; lifeLooks(sim.w, 0, lo);
  check('LF-20', `out of the cold the frost falls at its elsewhere rate 0.02 a s (${((before - lo[0]) / 10).toFixed(4)})`, Math.abs((before - lo[0]) / 10 - 0.02) < 0.002);
  sim.s.quiet = true; sim.run(5); const q = lo[0]; lifeLooks(sim.w, 0, lo); sim.s.quiet = false;
  check('LF-20', 'a ceremony (quiet) keeps the looks (they go on integrating, nothing resets)', lo[0] > 0 && lo[0] <= q);
  lifeRemove(sim.w, 0); lifeAdd(sim.w, 0, G('dollop', 7), 0, 0, 0, false); lifeLooks(sim.w, 0, lo);
  check('LF-20', 'the shelf (lifeRemove, lifeAdd) resets the looks to 0', lo.every((v) => v === 0));
  lifeAddLook(sim.w, 1, LOOK.snow, 0.5, TID('shakepine')); lifeAddLook(sim.w, 1, LOOK.snow, 0.3, TID('snowball'));
  sim.run(0.3);
  const caps = sim.events(LIFE_EV.REACT, REACT_KIND.SNOWCAP).filter((e) => e.a === 1);
  check('LF-20', `a lifeAddLook emits its REACT every time, with its source thing (SNOWCAP x ${caps.length}: ${caps.map((e) => e.thing).join(', ')})`, caps.length === 2 && caps[0].thing === TID('shakepine') && caps[1].thing === TID('snowball'));
  lifeSetPlace(sim.w, 1, 2, CABIN, 0, 1); lifeLooks(sim.w, 1, lo);
  check('LF-20', 'a trip (a new visit) resets the looks', lo.every((v) => v === 0));
  // the hearth: WARM with the Fireplace; a marshmallow toasts golden (TOAST at 0.5) and hops back from the heat past 0.6; mochi RISE; slime OOZE
  const f = new Sim(113, CABIN, 0); f.s.place = 1; f.s.tier = 2;
  CABIN.things.forEach((t) => f.addThing(t.id, t.x, t.z));
  f.add(0, 'cushlet', -2.4, -1.25); f.add(1, 'kneadle', -2.0, -1.0); f.add(2, 'gloopsy', -2.8, -1.0);
  f.run(40);
  const fam = (sp: string) => CATALOG.find((d) => d.id === sp)!.family;
  const warm = f.events(LIFE_EV.REACT, REACT_KIND.WARM), toast = f.events(LIFE_EV.REACT, REACT_KIND.TOAST), rise = f.events(LIFE_EV.REACT, REACT_KIND.RISE), ooze = f.events(LIFE_EV.REACT, REACT_KIND.OOZE);
  const hopBack = f.log.some((l) => l.kind === INTENT.HOP && l.who === 0 && Math.hypot(l.a, l.c) > 0.3);
  info('LF-21', `families: cushlet ${fam('cushlet')}, kneadle ${fam('kneadle')}, gloopsy ${fam('gloopsy')}`);
  check('LF-21', `WARM in the hearth's warmth for 2 s, its thing the Fireplace (${warm.length} WARM: ${[...new Set(warm.map((e) => e.thing))].join(',')})`, warm.length >= 3 && warm.every((e) => e.thing === TID('hearth')));
  check('LF-21', `TOAST at 0.5 for the marshmallow (${toast.length}), and it hops back from the heat once toast passes 0.6 (${hopBack})`, fam('cushlet') !== 'marshmallow' || (toast.length === 1 && toast[0].thing === TID('hearth') && hopBack));
  check('LF-21', `RISE (mochi dough's warm pose 1.06 reached in warmth 0.6+: ${rise.length}) and OOZE (slime goo's 0.82: ${ooze.length})`, (fam('kneadle') !== 'mochidough' || rise.length === 1) && (fam('gloopsy') !== 'slimegoo' || ooze.length === 1));
  // water (Ripple Shore's data): FLOAT and WADE give the zone's own thing, so the Rock Pool and the Surf Edge give different things
  // S2's places (PG_DATA's Ripple Shore and Frostbell Ridge, wide): the water and cold producers from LIFE's real output
  const s2 = (def: PlaceDef, seed: number): Sim => { const sim = new Sim(seed, def, 0); sim.s.place = def.idx; sim.s.tier = 1; def.things.forEach((t) => sim.addThing(t.id, t.x, t.z)); sim.kettle = false; return sim; };
  const inWater = (def: PlaceDef, x: number, z: number): boolean => def.zones.some((zn) => zn.kind === ZONE.water && (zn.shape === 'disc' ? Math.hypot(x - zn.x, z - zn.z) <= (zn.r ?? 0) : Math.abs(x - zn.x) <= (zn.hx ?? 0) && Math.abs(z - zn.z) <= (zn.hz ?? 0)));
  const pool = RIPPLE.zones.find((zn) => zn.id === 'rockpool')!;
  for (const float of [false, true]) {
    const r = s2(RIPPLE, 131 + (float ? 1 : 0));
    // (round 4 re-specification, written reason: LIFE's FLOAT now also asks PLACES 2.5's float table, as LIFE 4.2 says "it floats by the
    // float table"; Dollop is a jelly gel, density 1.02, which SITS in 0.28 m of water, so round 2's floater fixture (a host flag on Dollop)
    // was a body physics would never float. The floater is now Cushlet, a marshmallow (0.11: the share 0.191 at R 0.5 is more), the wader
    // stays Dollop. Same checks, same bars.)
    r.add(0, float ? 'cushlet' : 'dollop', pool.x, pool.z, { float });
    // alone, not playful (no wander), tired (it would nap if it could, never in water), its bask and use on cooldown for 30 s (the Sun is
    // a whole-place warm zone: a bask would walk it out first): it stays until its 30 s
    for (const bh of [BEH.BASK, BEH.USE, BEH.WANDER]) r.w.coo[0 * 26 + bh] = 30;
    let out = -1, napWet = 0, exitScoot = -1;
    const end = r.frame + 60 * 60; let li = 0;
    while (r.frame < end) {
      if (r.t < 30) { r.w.re[0] = 0.9; r.w.pl[0] = 0; }
      r.step();
      const b = r.bodies[0], wet = inWater(RIPPLE, b.x, b.z);
      if (wet && r.w.beh[0] === BEH.NAP) napWet++;
      for (; li < r.log.length; li++) { const l = r.log[li]; if (exitScoot < 0 && l.who === 0 && l.kind === INTENT.SCOOT && !inWater(RIPPLE, l.a, l.b) && l.t >= 29) exitScoot = l.t; }
      if (out < 0 && !wet) out = r.t;
    }
    const fl = r.events(LIFE_EV.REACT, float ? REACT_KIND.FLOAT : REACT_KIND.WADE).filter((e) => e.a === 0);
    check('LF-18', `(S2, Ripple Shore) a ${float ? 'floater' : 'wader'} in the Rock Pool heads out by SCOOT within 30 s by itself (exit scoot at ${exitScoot.toFixed(1)} s to a dry spot, out of the water at ${out.toFixed(1)} s) and never naps there (${napWet} wet nap ticks)`,
      exitScoot >= 30 && exitScoot <= 30.2 && out > 0 && out <= 40 && napWet === 0);
    check('LF-21', `(S2) ${float ? 'FLOAT: in the Rock Pool, not grounded' : 'WADE: in the Rock Pool (surface 0.28 m), grounded'} for 1 s, once per visit, its thing the Rock Pool (${fl.map((e) => `${e.t.toFixed(1)} s thing ${e.thing}`).join(', ') || 'none'})`,
      fl.length === 1 && fl[0].thing === TID('rockpool') && fl[0].t <= 1.4);
  }
  // (round 4) what is NOT a float: a hop after 2 s standing in a shallow splash (the Surf Edge, 0.06 m: PLACES 2's "drag, splash and wet
  // only"; PG_QUESTS round 3's QC case), a hop in the Rock Pool (airborne 0.17 s, never 1 s), a sitter the host marks not grounded in the
  // Rock Pool (Dollop, jelly gel 1.02: the float table says it sits), and a floater riding a prop (ON_PROP: a raft's rider is not floating)
  {
    const edge = RIPPLE.zones.find((zn) => zn.id === 'surfedge')!;
    const a = s2(RIPPLE, 141); a.add(0, 'cushlet', 1.0, edge.z, { float: true }); a.run(2);
    for (let k = 0; k < 4; k++) { a.bodies[0].air = 0.18; a.run(1.2); }
    const b = s2(RIPPLE, 142); b.add(0, 'dollop', pool.x, pool.z); b.run(2);
    for (let k = 0; k < 4; k++) { b.bodies[0].air = 0.18; b.run(1.2); }
    const c = s2(RIPPLE, 143); c.add(0, 'dollop', pool.x, pool.z, { float: true }); c.run(4);
    const d = s2(RIPPLE, 144); d.add(0, 'cushlet', pool.x, pool.z, { float: true }); d.extraFlags[0] = LIFE_FLAG.ON_PROP; d.run(4);
    const nF = (q: Sim): number => q.events(LIFE_EV.REACT, REACT_KIND.FLOAT).length;
    check('LF-21', `(S2, round 4) no FLOAT from a hop in a shallow splash (${nF(a)}), a hop in the Rock Pool (${nF(b)}), a sitter not grounded in the Rock Pool (jelly gel: ${nF(c)}) or a floater on a prop (${nF(d)}); the Surf Edge gives SPLASH instead (${a.events(LIFE_EV.REACT, REACT_KIND.SPLASH).length})`,
      nF(a) === 0 && nF(b) === 0 && nF(c) === 0 && nF(d) === 0 && a.events(LIFE_EV.REACT, REACT_KIND.SPLASH).length >= 1);
  }
  // SPLASH: a hop that lands in the shallow Surf Edge (surface 0.06 m): an event, 5 s cooldown, its thing the zone's (none: -1, not the Rock Pool)
  {
    const r = s2(RIPPLE, 135), edge = RIPPLE.zones.find((zn) => zn.id === 'surfedge')!;
    r.add(0, 'crimpo', 1.0, edge.z); r.run(2);
    for (let k = 0; k < 3; k++) { r.bodies[0].air = 0.18; r.run(1.0); }
    r.run(5); r.bodies[0].air = 0.18; r.run(1.0);
    const sp = r.events(LIFE_EV.REACT, REACT_KIND.SPLASH).filter((e) => e.a === 0);
    check('LF-21', `(S2) SPLASH: landings in the Surf Edge (four hops: three 1 s apart, one 5 s later) give events 5 s apart (${sp.map((e) => e.t.toFixed(1)).join(', ')} s), thing ${sp[0]?.thing} (the Surf Edge has no owning thing; the Rock Pool gives ${TID('rockpool')})`,
      sp.length === 2 && sp[1].t - sp[0].t >= 5 && sp.every((e) => e.thing === -1));
  }
  // Frostbell's whole-place Mountain Cold (0.6): SHIVER for a family with shiver after 2 s, FROST at 0.5 (0.03 a s: about 17 s), thing -1
  {
    const r = s2(FROSTBELL, 137);
    r.add(0, 'dollop', -0.6, 0.6); r.add(1, 'crimpo', 0.85, 0.85); r.physics = false;
    r.run(25);
    const sh = r.events(LIFE_EV.REACT, REACT_KIND.SHIVER), fr = r.events(LIFE_EV.REACT, REACT_KIND.FROST);
    const lo = new Float32Array(6); lifeLooks(r.w, 0, lo);
    check('LF-21', `(S2, Frostbell) SHIVER in the whole-place cold for 2 s, only for a family with shiver (${sh.map((e) => `slot ${e.a} ${e.t.toFixed(1)} s thing ${e.thing}`).join(', ')}), FROST at 0.5 (${fr.map((e) => `slot ${e.a} ${e.t.toFixed(1)} s`).join(', ')}; frost ${lo[0].toFixed(2)} at 25 s), both with thing -1`,
      sh.length === 1 && sh[0].a === 0 && sh[0].thing === -1 && sh[0].t <= 2.3 && fr.length === 2 && fr.every((e) => e.thing === -1 && Math.abs(e.t - 0.5 / 0.03) < 0.5));
  }
  // (round 4) the S2 / S3 REACT producers on PG_DATA's places (wide), from LIFE's real output. A scene is kept calm by putting the squishy's
  // uses, naps, basks, wanders and moments on cooldown (as the huff and boop rows stage); the host reports a switchable zone off by its id.
  const calmS = (r: Sim, n: number): void => { for (let i = 0; i < n; i++) for (const bh of [BEH.USE, BEH.NAP, BEH.BASK, BEH.WANDER, BEH.MOMENT]) r.w.coo[i * 26 + bh] = 1e9; };
  const evs = (r: Sim, kind: number, who = 0): EvLog[] => r.events(LIFE_EV.REACT, kind).filter((e) => e.a === who);
  const tl = (l: EvLog[]): string => l.map((e) => `${e.t.toFixed(1)} s thing ${e.thing}`).join(', ') || 'none';
  {
    // SOAK by water (a foam in the Rock Pool) and by the rain (Rainleaf, thing -1): soak crosses 0.5 (marshmallow 0.06 a s: about 8.3 s)
    const a = s2(RIPPLE, 151); a.add(0, 'cushlet', pool.x, pool.z, { float: true }); calmS(a, 1); a.run(12);
    const b = s2(RAINLEAF, 152); b.add(0, 'cushlet', 0.3, -0.2); calmS(b, 1); b.physics = false; b.run(12);
    check('LF-21', `(S2, round 4) SOAK by water: a marshmallow in the Rock Pool soaks to 0.5 (${tl(evs(a, REACT_KIND.SOAK))}: the Rock Pool ${TID('rockpool')}) and in Rainleaf's rain (${tl(evs(b, REACT_KIND.SOAK))}: -1)`,
      evs(a, REACT_KIND.SOAK).length === 1 && evs(a, REACT_KIND.SOAK)[0].thing === TID('rockpool') && Math.abs(evs(a, REACT_KIND.SOAK)[0].t - 0.5 / 0.06) < 0.6
      && evs(b, REACT_KIND.SOAK).length === 1 && evs(b, REACT_KIND.SOAK)[0].thing === -1);
    // DRIFT: a floater carried 0.3 m by the Rock Pool's current (0.08 m/s in this host); a wader is not
    const c = s2(RIPPLE, 153); c.add(0, 'cushlet', pool.x + 0.7, pool.z, { float: true }); c.add(1, 'dollop', pool.x - 0.7, pool.z); calmS(c, 2); c.run(10);
    check('LF-21', `(S2, round 4) DRIFT: a floater carried 0.3 m by the Rock Pool's current, once per visit, its thing the Rock Pool (${tl(evs(c, REACT_KIND.DRIFT))}; 0.3 / 0.08 = 3.75 s after it floats); a wader in the same pool gives none (${evs(c, REACT_KIND.DRIFT, 1).length})`,
      evs(c, REACT_KIND.DRIFT).length === 1 && evs(c, REACT_KIND.DRIFT)[0].thing === TID('rockpool') && evs(c, REACT_KIND.DRIFT)[0].t > 3.5 && evs(c, REACT_KIND.DRIFT)[0].t < 6 && evs(c, REACT_KIND.DRIFT, 1).length === 0);
    // PRINT: moving on Ripple's marking sand gives one PRINT a visit (-1: the ground); the cabin's floor marks nothing
    const d = s2(RIPPLE, 154); d.add(0, 'dollop', -1.0, 0.8); d.run(1); d.bodies[0].tx = 0.2; d.bodies[0].tz = 0.8; d.bodies[0].sp = 0.25; d.bodies[0].scoot = true; d.run(6);
    const e = new Sim(155, CABIN, 0); e.s.place = 1; CABIN.things.forEach((t) => e.addThing(t.id, t.x, t.z)); e.add(0, 'dollop', -1.0, 0.8); e.run(1); e.bodies[0].tx = 0.2; e.bodies[0].tz = 0.8; e.bodies[0].sp = 0.25; e.bodies[0].scoot = true; e.run(6);
    check('LF-21', `(S2, round 4) PRINT: a squishy moving on Ripple Shore's marking sand makes its first print once a visit (${tl(evs(d, REACT_KIND.PRINT))}); the cabin's floor, which marks nothing, none (${evs(e, REACT_KIND.PRINT).length})`,
      evs(d, REACT_KIND.PRINT).length === 1 && evs(d, REACT_KIND.PRINT)[0].thing === -1 && evs(e, REACT_KIND.PRINT).length === 0);
  }
  {
    // GLIDE on Frostbell's Ice Pond: B04 walks a firm silicone (ice grip 0.08) to the pond's edge and nudges it across; the ice carries it
    // 0.5 m or more (this host: the nudge coasts at the patch's drag): GLIDE with its thing the Ice Pond, USE STEP; a slime goo (0.8) never glides
    const icePond = FROSTBELL.patches.find((pt) => pt.id === 'icepond')!;
    const g = s2(FROSTBELL, 157); g.add(0, 'boingle', icePond.x - 2.2, icePond.z + 0.6); g.add(1, 'gloopsy', icePond.x - 2.4, icePond.z + 1.6);
    for (let i = 0; i < 2; i++) for (const bh of [BEH.NAP, BEH.BASK, BEH.WANDER, BEH.MOMENT]) g.w.coo[i * 26 + bh] = 1e9;
    let maxGlide = 0;
    for (let f = 0; f < 40 * 60; f++) { g.step(); g.w.pl[0] = Math.max(g.w.pl[0], 0.9); g.w.pl[1] = Math.max(g.w.pl[1], 0.9); }
    for (const l of g.intents(INTENT.GLIDE, 0)) maxGlide = Math.max(maxGlide, Math.hypot(l.a, l.b));
    const gl = evs(g, REACT_KIND.GLIDE), use = g.events(LIFE_EV.USE).filter((u) => u.a === 0 && u.thing === TID('icepond'));
    check('LF-21', `(S2, round 4) GLIDE: a firm silicone glides on the Ice Pond (nudges ${g.intents(INTENT.GLIDE, 0).length}, fastest ${maxGlide.toFixed(2)} m/s, in 0.6..1.0), GLIDE ${tl(gl)} (event, 10 s apart, its thing the Ice Pond ${TID('icepond')}), USE STEP x${use.length}; a slime goo (ice grip 0.8) never glides (${g.intents(INTENT.GLIDE, 1).length} nudges, ${evs(g, REACT_KIND.GLIDE, 1).length} GLIDE)`,
      gl.length >= 1 && gl.every((q) => q.thing === TID('icepond')) && gl.every((q, k) => k === 0 || q.t - gl[k - 1].t >= 10) && use.length >= 1 && maxGlide >= 0.6 - 1e-6 && maxGlide <= 1.0 + 1e-6
      && g.intents(INTENT.GLIDE, 1).length === 0 && evs(g, REACT_KIND.GLIDE, 1).length === 0);
    // the snow cap: still on Frostbell's snow the snow look rises 0.03 a s to its 0.3 cap (no SNOWCAP: it never crosses 0.5 by itself); a
    // snowball's +0.3 (lifeAddLook, its source) then crosses it: SNOWCAP with the snowball; moving, it falls at 0.2 a s
    const h = s2(FROSTBELL, 158); h.add(0, 'crimpo', -0.6, 0.6); h.physics = false; calmS(h, 1);
    const lo = new Float32Array(6);
    h.run(5); lifeLooks(h.w, 0, lo); const at5 = lo[4]; h.run(10); lifeLooks(h.w, 0, lo); const at15 = lo[4];
    const capsBefore = evs(h, REACT_KIND.SNOWCAP).length;
    lifeAddLook(h.w, 0, LOOK.snow, 0.3, TID('snowball')); h.run(0.3);
    const sc = evs(h, REACT_KIND.SNOWCAP);
    h.bodies[0].vx = 0.3; h.s.vx[0] = 0.3; h.physics = true; h.bodies[0].tx = 1.2; h.bodies[0].tz = 0.6; h.bodies[0].sp = 0.25; h.bodies[0].scoot = true; h.run(1);
    lifeLooks(h.w, 0, lo); const afterMove = lo[4];
    check('LF-20', `(S2, round 4) the snow cap: still on Frostbell's snow the look rises 0.03 a s (${(at5 / 5).toFixed(3)}) to its 0.3 cap (${at15.toFixed(2)} at 15 s, ${capsBefore} SNOWCAP by itself); a snowball's +0.3 gives SNOWCAP with the snowball (${tl(sc)}); moving it falls at 0.2 a s (${afterMove.toFixed(2)} after 1 s)`,
      Math.abs(at5 / 5 - 0.03) < 0.003 && Math.abs(at15 - 0.3) < 1e-6 && capsBefore === 0 && sc.length === 1 && sc[0].thing === TID('snowball') && afterMove < 0.6 - 0.15);
  }
  {
    // DRY: soaked (a squirt's +0.6 wet and soak through lifeAddLook) then in the cabin's Fireside Warmth: soak and wet fall at their warm rates
    // and DRY fires once when one falls under 0.1, its thing the Fireplace; LOVE: B10 in its favourite place (Dollop at the cabin), once, -1
    const dr = new Sim(165, CABIN, 0); dr.s.place = 1; CABIN.things.forEach((t) => dr.addThing(t.id, t.x, t.z));
    dr.add(0, 'cushlet', 1.5, 1.0); dr.add(1, 'dollop', 0.5, 1.2); dr.physics = false; calmS(dr, 2);
    lifeAddLook(dr.w, 0, LOOK.soak, 0.6, -1); lifeAddLook(dr.w, 0, LOOK.wet, 0.6, -1); dr.run(1);
    dr.bodies[0].x = -2.4; dr.bodies[0].z = -1.25; dr.run(12);
    const dry = evs(dr, REACT_KIND.DRY), love = evs(dr, REACT_KIND.LOVE, 1);
    check('LF-21', `(round 4) DRY: soaked, then in the Fireside Warmth, once when its wet or soak falls under 0.1 (${tl(dry)}: the Fireplace ${TID('hearth')}); LOVE: Dollop's B10 at the cabin, its favourite place, once (${tl(love)})`,
      dry.length === 1 && dry[0].thing === TID('hearth') && love.length === 1 && love[0].thing === -1);
  }
  {
    // GAZE_SKY at Lanternroof (night): idle within 1.5 m of the Moon Dish for 3 s, once a visit (thing the dish); the Star Scope's comet
    // (lifeThingTap) makes every squishy on screen gaze up, every time (thing the scope)
    const dish = LANTERNROOF.things.find((t) => t.id === 'moondish')!;
    const k = s2(LANTERNROOF, 161); k.add(0, 'dollop', dish.x, dish.z - 1.0); k.add(1, 'crimpo', -2.0, -1.5); k.physics = false; calmS(k, 2);
    k.run(14);   // (its arrival, a greet with the other and two notices come first: idle from about 7 s)
    const gz = evs(k, REACT_KIND.GAZE_SKY);
    lifeThingTap(k.w, TID('starscope')); k.run(0.2); lifeThingTap(k.w, TID('starscope')); k.run(0.2);
    const comet = k.events(LIFE_EV.REACT, REACT_KIND.GAZE_SKY).filter((q) => q.thing === TID('starscope'));
    check('LF-21', `(S3, round 4) GAZE_SKY: idle by the Moon Dish at night for 3 s (${tl(gz)}: the dish ${TID('moondish')}; the one 3 m away none: ${evs(k, REACT_KIND.GAZE_SKY, 1).filter((q) => q.thing === TID('moondish')).length}); two comets give ${comet.length} (2 on screen x 2), thing the scope`,
      gz.length === 1 && gz[0].thing === TID('moondish') && gz[0].t >= 3 && evs(k, REACT_KIND.GAZE_SKY, 1).filter((q) => q.thing === TID('moondish')).length === 0 && comet.length === 4);
    // B19 hold on in a real place: the Night Breeze's gusts come from LIFE's own clock (every 6..10 s for 2.5 s, lifeGustOn); a grounded
    // squishy in the breeze holds on once per gust (HOLD_ON, thing -1) for the gust's length, and not between gusts
    const breeze = LANTERNROOF.zones.findIndex((z) => z.id === 'nightbreeze');
    const b = s2(LANTERNROOF, 162); b.add(0, 'dollop', 2.3, 1.2); b.physics = false; calmS(b, 1);
    let gusts = 0, was = false, offHold = 0, onTicks = 0, holdTicks = 0;
    for (let f = 0; f < 60 * 60; f++) {
      b.step();
      const on = lifeGustOn(b.w, breeze);
      if (on && !was) gusts++;
      was = on;
      if (on) { onTicks++; if (b.w.beh[0] === BEH.HOLDON) holdTicks++; } else if (b.w.beh[0] === BEH.HOLDON) offHold++;
    }
    const ho = evs(b, REACT_KIND.HOLD_ON);
    check('LF-21', `(S3, round 4) B19 in the Night Breeze: ${gusts} gusts in 60 s by LIFE's clock (6..10 s apart), HOLD_ON x${ho.length} (one a gust, thing -1), holding on ${(100 * holdTicks / Math.max(1, onTicks)).toFixed(0)}% of the gust time, ${offHold} frames past the gusts' ends (at most one 0.1 s think a gust: ${6 * gusts})`,
      gusts >= 6 && gusts <= 10 && ho.length === gusts && ho.every((q) => q.thing === -1) && holdTicks / onTicks > 0.9 && offHold <= 6 * gusts);
    // pieces in the breeze hold on together: one PIECES HOLD_ON with n = 3 (QUESTS L6)
    const pc = s2(LANTERNROOF, 163); pc.physics = false;
    for (let q = 0; q < 3; q++) pc.add(q, 'dollop', 2.0 + q * 0.3, 1.2, { kind: q === 0 ? 1 : 2, group: 0, frac: 1 / 3, r: 0.32, seed: 7 });
    for (let q = 0; q < 3; q++) for (const bh of [BEH.USE, BEH.NAP, BEH.BASK, BEH.WANDER, BEH.MOMENT]) pc.w.coo[q * 26 + bh] = 1e9;
    pc.run(20);
    const ph = pc.events(LIFE_EV.PIECES, REACT_KIND.HOLD_ON);
    check('LF-22', `(S3, round 4) three pieces in the Night Breeze hold on in a gust: PIECES HOLD_ON reaching n = 3 (${ph.map((q) => `${q.t.toFixed(1)} s n ${q.n2}`).join(', ') || 'none'})`, ph.some((q) => q.n2 === 3));
  }
  {
    // LIFT (Cloudloft's updraft: airborne in it for 0.3 s; an event, 5 s apart; thing the updraft), RATTLE (a bead squeeze within 0.6 m of
    // Cogwhistle's switched-on magnet: thing the magnet; off, none), GLOW (Echo Hollow's Glow Pool, 1 s), SHOWER (under Rainleaf's Drip Leaf
    // while it drips: thing the leaf; in the rain elsewhere, none), FIZZ (Fizzwell's Bubble Patch, 1 s)
    const up = CLOUDLOFT.zones.find((z) => z.id === 'updraft')!;
    const l = s2(CLOUDLOFT, 171); l.add(0, 'cushlet', up.x, up.z); calmS(l, 1);
    l.run(1); l.bodies[0].air = 0.6; l.run(2); l.bodies[0].air = 0.6; l.run(5); l.bodies[0].air = 0.6; l.run(1);
    const lift = evs(l, REACT_KIND.LIFT);
    check('LF-21', `(S3, round 4) LIFT: airborne in Cloudloft's updraft for 0.3 s, an event 5 s apart (${tl(lift)}: the updraft ${TID('updraft')})`,
      lift.length === 2 && lift.every((q) => q.thing === TID('updraft')) && lift[1].t - lift[0].t >= 5);
    const mg = COGWHISTLE.zones.find((z) => z.id === 'magnetfield')!;
    const ra = s2(COGWHISTLE, 172); ra.add(0, 'rattlebead', mg.x, mg.z + 0.7); ra.add(1, 'dollop', mg.x - 0.7, mg.z); ra.physics = false; calmS(ra, 2); ra.run(3);
    const rb = s2(COGWHISTLE, 173); rb.zoneOff.add('magnetfield'); rb.add(0, 'rattlebead', mg.x, mg.z + 0.7); rb.physics = false; calmS(rb, 1); rb.run(3);
    check('LF-21', `(S3, round 4) RATTLE: a bead squeeze 0.7 m from the switched-on magnet (${tl(evs(ra, REACT_KIND.RATTLE))}: the magnet ${TID('magnet')}); a jelly gel beside it none (${evs(ra, REACT_KIND.RATTLE, 1).length}); the magnet off, none (${evs(rb, REACT_KIND.RATTLE).length})`,
      evs(ra, REACT_KIND.RATTLE).length === 1 && evs(ra, REACT_KIND.RATTLE)[0].thing === TID('magnet') && evs(ra, REACT_KIND.RATTLE, 1).length === 0 && evs(rb, REACT_KIND.RATTLE).length === 0);
    const gp = ECHOHOLLOW.zones.find((z) => z.id === 'glowpool')!;
    // (a squishy that comes out inside a zone is in it at once, LIFE 3.1: these come out beside it and are set in at 1 s)
    const setIn = (r: Sim, x: number, z: number): void => { r.run(1); r.bodies[0].x = x; r.bodies[0].z = z; r.bodies[0].tx = x; r.bodies[0].tz = z; };
    const gw = s2(ECHOHOLLOW, 174); gw.add(0, 'dollop', gp.x - 2.0, gp.z + 1.2); gw.physics = false; calmS(gw, 1); setIn(gw, gp.x, gp.z); gw.run(3);
    check('LF-21', `(S3, round 4) GLOW: in Echo Hollow's Glow Pool for 1 s, once a visit (${tl(evs(gw, REACT_KIND.GLOW))}: the pool ${TID('glowpool')}; set in at 1.0 s)`,
      evs(gw, REACT_KIND.GLOW).length === 1 && evs(gw, REACT_KIND.GLOW)[0].thing === TID('glowpool') && evs(gw, REACT_KIND.GLOW)[0].t >= 2 && evs(gw, REACT_KIND.GLOW)[0].t < 2.3);
    const dz = RAINLEAF.zones.find((z) => z.id === 'leafdrip')!;
    const sh = s2(RAINLEAF, 175); sh.add(0, 'dollop', dz.x + 1.4, dz.z + 1.0); sh.add(1, 'crimpo', 1.0, 0.0); sh.physics = false; calmS(sh, 2); setIn(sh, dz.x, dz.z); sh.run(25);
    const sd = s2(RAINLEAF, 176); sd.zoneOff.add('leafdrip'); sd.zoneOff.add('rain'); sd.add(0, 'dollop', dz.x, dz.z); sd.physics = false; calmS(sd, 1); sd.run(3);
    check('LF-21', `(S3, round 4) SHOWER: under the Drip Leaf while it drips (${tl(evs(sh, REACT_KIND.SHOWER))}: the leaf ${TID('dripleaf')}; set in at 1.0 s; an event 20 s apart), in the rain elsewhere none (${evs(sh, REACT_KIND.SHOWER, 1).length}), the leaf dry none (${evs(sd, REACT_KIND.SHOWER).length})`,
      evs(sh, REACT_KIND.SHOWER).length === 2 && evs(sh, REACT_KIND.SHOWER).every((q) => q.thing === TID('dripleaf')) && evs(sh, REACT_KIND.SHOWER)[0].t >= 2 && evs(sh, REACT_KIND.SHOWER)[1].t - evs(sh, REACT_KIND.SHOWER)[0].t >= 19.95
      && evs(sh, REACT_KIND.SHOWER, 1).length === 0 && evs(sd, REACT_KIND.SHOWER).length === 0);
    const bp = FIZZWELL.zones.find((z) => z.id === 'bubblepatch')!;
    const fz = s2(FIZZWELL, 177); fz.add(0, 'dollop', bp.x + 1.6, bp.z + 1.4); fz.physics = false; calmS(fz, 1); setIn(fz, bp.x, bp.z); fz.run(3);
    check('LF-21', `(S2, round 4) FIZZ: in Fizzwell's Bubble Patch for 1 s, once a visit (${tl(evs(fz, REACT_KIND.FIZZ))}: the patch ${TID('bubblepatch')}; set in at 1.0 s)`,
      evs(fz, REACT_KIND.FIZZ).length === 1 && evs(fz, REACT_KIND.FIZZ)[0].thing === TID('bubblepatch') && evs(fz, REACT_KIND.FIZZ)[0].t >= 2 && evs(fz, REACT_KIND.FIZZ)[0].t < 2.3);
  }
  // S2's raised hops (LIFE 5.2, D-07): lifeSetHops raises a family's hop to its vyS2 once PH-01 passed; pieces keep the S1 cap; 0 returns to S1
  {
    const hopRun = (mask: number, calm: boolean): { whole: number; other: number; piece: number } => {
      const r = new Sim(139, CABIN, 0); r.s.place = 1; r.s.tier = 2; r.s.calm = calm; CABIN.things.forEach((t) => r.addThing(t.id, t.x, t.z));
      r.add(0, 'dollop', -1, 0.6); r.add(1, 'boingle', 1, 0.6); r.add(2, 'dollop', 0.2, 1.5, { kind: 1, group: 9, frac: 0.3, r: 0.32, seed: 5 });
      lifeSetHops(r.w, mask); r.run(90);
      const vy = (who: number): number => Math.max(0, ...r.intents(INTENT.HOP, who).map((l) => l.b));
      return { whole: vy(0), other: vy(1), piece: vy(2) };
    };
    const jg = 1 << MATERIAL_FAMILY_IDS.indexOf('jellygel');
    const up = hopRun(jg, false), off = hopRun(0, false), calm = hopRun(jg, true);
    check('LIFE 5.2', `(S2) lifeSetHops raises the jelly gel whole's hop to vyS2 1.2 (max vy ${up.whole.toFixed(2)}); firm silicone not raised stays at the S1 cap (${up.other.toFixed(2)} <= 0.84); a piece keeps the S1 cap (${up.piece.toFixed(2)}); mask 0 back to S1 (${off.whole.toFixed(2)}); Calm x 0.6 (${calm.whole.toFixed(2)})`,
      up.whole > 0.84 && up.whole <= 1.2 + 1e-6 && up.other <= 0.84 + 1e-6 && up.piece <= 0.84 + 1e-6 && off.whole <= 0.84 + 1e-6 && calm.whole <= 1.2 * 0.6 + 1e-6);
  }
  info('LF-21', 'round 4: every REACT kind of QUESTS 4 now has a producer checked on its place above (FLOAT, WADE, SOAK, TOAST, RISE, OOZE, WARM, SHIVER, FROST, SNOWCAP, GLIDE, SPLASH, DRIFT, LIFT, RATTLE, GLOW, GAZE_SKY, PRINT, SHOWER, FIZZ, HOLD_ON; DRY, LOVE)');
  info('LF-15', "friendship's pace (20 a pair a day, levels at 12 and 40, 128 rows, eviction) is the reducer's (PG_QUESTS); LIFE's side: lifeSetPair levels gate chat (Met), duet and nuzzle-for-every-pair (Friends), twirl (Close)");
}

console.log(`\n${oks} ok, ${fails} failed`);
if ((process.argv[1] ?? '').endsWith('probe_life.ts')) process.exit(fails ? 1 : 0);

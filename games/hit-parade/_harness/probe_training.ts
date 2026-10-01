// probe_training (lane UI, CONTRACT 27.1): the TRAINING driver (runtime/src/ui/trainer.ts) over the REAL sim and data -
// every check reads the sim's own events / snapshots after stepping it with the words the driver returns, exactly as
// game.ts's tick() would (CONTRACT 27.1 wiring):
//   GUARD none / all / after first hit / random   P1 (johnny) walks in and throws 5M, 2M (low), 6H (overhead), 2L and a
//                                                 jump-in j.H at the dummy (bruno): HIT vs BLOCK events on the dummy
//   RECORD 3 s + PLAYBACK                         P1's words drive the dummy while recording (P1 idles), the recording
//                                                 stops itself at 180 ticks, PLAYBACK repeats it (walk + 5L)
//   RESET mid / corner / cornered                 the positioned Match the driver builds for game.ts to swap in
//   METER FULL, DUMMY: CPU, hitbox read-back, input display feed
// CHANGED(UI3D) (CONTRACT §35, the 3D ring):
//   RESET CORNER / CORNERED                       = against the RING wall on the spawn axis (the walker's push circle within
//                                                 3 cm of the boundary, on the axis line +- 5 cm, the right end), on the circle
//                                                 ring (rust_theater) AND the octagon (butcher_block)
//   DUMMY: SIDESTEPS / CIRCLES                    the dummy sidesteps (IN / OUT in turn) / circle-walks round P1 at a kept
//                                                 distance; P1's STEP bits pass through the driver (sidewalk) and reach the
//                                                 input display; the hitbox volumes follow a fighter off the spawn line
// Prints one summary line; exit 0 = PASS.
import { createMatch, step, readFighter, readMatch, devSet, type Match } from '../runtime/src/core/sim/match.ts';
import { EV, eventsSince } from '../runtime/src/core/sim/events.ts';
import { loadGameData } from '../runtime/src/core/data.ts';
import { createCpu } from '../runtime/src/core/ai/cpu.ts';
import type { SimEvent } from '../runtime/src/core/types.ts';
import { readBoxes as readBoxes3 } from '../runtime/src/core/sim/match.ts';
import { TrainingDriver, readBoxes, type TrainerHud } from '../runtime/src/ui/trainer.ts';
import { TrainingState } from '../runtime/src/ui/trainopts.ts';

const V = process.argv.includes('-v');
const data = loadGameData();
const B = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, L: 16, M: 32, H: 64, STEP_IN: 1 << 13, STEP_OUT: 1 << 14 } as const;
let pass = 0;
let fail = 0;
const lines: string[] = [];
function ok(cond: boolean, what: string, detail = ''): void {
  if (cond) pass++; else fail++;
  const l = `  [${cond ? 'PASS' : 'FAIL'}] ${what}${detail ? ` - ${detail}` : ''}`;
  lines.push(l);
  if (V || !cond) console.log(l);
}

class StubHud implements TrainerHud {
  inputs = 0;
  /** CHANGED(UI3D): OR of every word the input display was fed */
  wordsOr = 0;
  boxes: number | null = null;
  rec = 'off';
  readout: { adv: number | null; block: boolean; startup: number; damage: number; combo: number } | null = null;
  setReadout(r: { adv: number | null; block: boolean; startup: number; damage: number; combo: number }): void { if (r.adv !== null) this.readout = r; }
  pushInputs(w: number): void { this.inputs++; this.wordsOr |= w; }
  setBoxes(l: ReadonlyArray<unknown> | null): void { this.boxes = l ? l.length : null; }
  setTraining(): void { /* overlays */ }
  setRecordState(s: 'off' | 'record' | 'play'): void { this.rec = s; }
}

interface Rig { m: Match; d: TrainingDriver; opts: TrainingState; hud: StubHud; ev: SimEvent[]; last: number }
function rig(o: Partial<ReturnType<TrainingState['get']>> = {}, seed = 7, stage = 'rust_theater'): Rig {
  const cfg = { mode: 'training' as const, stage, seed, p: [{ fighter: 'johnny', color: 0, scheme: 0 as const, cpu: -1 }, { fighter: 'bruno', color: 0, scheme: 0 as const, cpu: -1 }] as [
    { fighter: string; color: number; scheme: 0; cpu: number }, { fighter: string; color: number; scheme: 0; cpu: number }], rounds: 1, timer: 0 };
  const opts = new TrainingState();
  opts.set({ guard: 'none', dummy: 'stand', meter: 'normal', ...o });
  const hud = new StubHud();
  const d = new TrainingDriver({ opts, data, hud, sim: { createMatch, step, readFighter, readMatch, devSet }, cpu: createCpu });
  let m = createMatch(cfg, data);
  d.begin(cfg, m);
  // into live play the way game.ts starts a training bout (intro frames stepped with neutral words)
  for (let k = 0; k < 400 && readMatch(m).phase !== 'fight'; k++) { const [a, b] = d.tick(m, [0, 0]); step(m, a, b); }
  return { m, d, opts, hud, ev: [], last: readMatch(m).frame };
}
/** one game.ts tick: pending reset swap, the driver's words, the sim step; collects new events */
function tick(r: Rig, p1: number, p2 = 0): void {
  const nm = r.d.pending();
  if (nm) { r.m = nm; r.last = readMatch(nm).frame; }
  const [a, b] = r.d.tick(r.m, [p1, p2]);
  step(r.m, a, b);
  const buf: SimEvent[] = [];
  eventsSince(r.m.events, r.last + 1, buf);
  for (const e of buf) r.ev.push({ ...e });
  r.last = readMatch(r.m).frame;
}
const gap = (r: Rig): number => readFighter(r.m, 1).x - readFighter(r.m, 0).x;
const free = (r: Rig, i: number): boolean => ['idle', 'crouch', 'walk_f', 'walk_b'].includes(readFighter(r.m, i).stateName);

type Atk = '5M' | '2M' | '6H' | '2L' | 'j.H';
/** walk in, throw one attack, let it play out; returns the dummy's HIT / BLOCK count for it */
function attack(r: Rig, a: Atk, recover = 46): { hit: number; block: number } {
  for (let k = 0; k < 240 && !(free(r, 0) && free(r, 1)); k++) tick(r, 0);
  const want = a === 'j.H' ? 2.2 : a === '6H' ? 0.95 : 1.0;
  for (let k = 0; k < 400 && gap(r) > want; k++) tick(r, B.RIGHT);
  const n0 = r.ev.length;
  if (a === 'j.H') {
    // a forward jump from 2.2 m with H 24 frames after take-off lands on the dummy (measured: 20-30 connect)
    tick(r, B.UP | B.RIGHT); tick(r, B.UP | B.RIGHT);
    for (let k = 0; k < 24; k++) tick(r, 0);
    tick(r, B.H);
  } else if (a === '6H') { tick(r, B.RIGHT); tick(r, B.RIGHT | B.H); }
  else if (a === '2M') { tick(r, B.DOWN); tick(r, B.DOWN | B.M); }
  else if (a === '2L') { tick(r, B.DOWN); tick(r, B.DOWN | B.L); }
  else tick(r, B.M);
  for (let k = 0; k < recover; k++) tick(r, 0);
  const got = r.ev.slice(n0).filter((e) => e.a === 0 && e.b === 1);
  return { hit: got.filter((e) => e.type === EV.HIT || e.type === EV.COUNTER || e.type === EV.PUNISH).length > 0 ? 1 : 0, block: got.filter((e) => e.type === EV.BLOCK).length > 0 ? 1 : 0 };
}
const SET: Atk[] = ['5M', '2M', '6H', '2L', 'j.H'];
function runSet(r: Rig, set: Atk[], recover = 46): { hit: number; block: number; per: string[] } {
  let hit = 0, block = 0;
  const per: string[] = [];
  for (const a of set) { const x = attack(r, a, recover); hit += x.hit; block += x.block; per.push(`${a}:${x.hit ? 'H' : x.block ? 'B' : '-'}`); }
  return { hit, block, per };
}

// ── GUARD
{
  const r = rig({ guard: 'none' });
  const s = runSet(r, SET);
  ok(s.hit === 5 && s.block === 0, 'guard NONE: the dummy takes the attacks', `${s.per.join(' ')}`);
}
{
  const r = rig({ guard: 'all' });
  const s = runSet(r, SET);
  ok(s.block === 5 && s.hit === 0, 'guard ALL: mids, lows (crouch guard), the 6H overhead and the jump-in (stand guard) blocked', `${s.per.join(' ')} guardTicks=${r.d.stats.guardTicks}`);
}
{
  const r = rig({ guard: 'first' });
  const a1 = attack(r, '5M', 24);
  const a2 = attack(r, '5M', 60);
  const a3 = attack(r, '2M', 46);
  ok(a1.hit === 1 && a2.block === 1, 'guard AFTER FIRST HIT: the opener hits, the follow-up is blocked', `1st ${a1.hit ? 'HIT' : a1.block ? 'BLOCK' : '-'} 2nd ${a2.hit ? 'HIT' : a2.block ? 'BLOCK' : '-'} 3rd ${a3.hit ? 'HIT' : a3.block ? 'BLOCK' : '-'}`);
}
{
  const r = rig({ guard: 'random' }, 11);
  const s = runSet(r, ['5M', '5M', '2M', '5M', '2L', '5M', '2M', '5M', '5M', '2M', '5M', '2L']);
  const r2 = rig({ guard: 'random' }, 11);
  const s2 = runSet(r2, ['5M', '5M', '2M', '5M', '2L', '5M', '2M', '5M', '5M', '2M', '5M', '2L']);
  ok(s.hit > 0 && s.block > 0, 'guard RANDOM: some attacks blocked, some not', `${s.hit} hit / ${s.block} blocked: ${s.per.join(' ')}`);
  ok(s.per.join() === s2.per.join(), 'guard RANDOM is seeded (same seed, same rolls)', s2.per.join(' '));
}

// ── FRAME DATA per tick vs the move data (advantage = stun - (active + recovery), CONTRACT 2)
{
  const J = data.fighters.johnny.moves as Record<string, { damage: number; active: number; recovery: number; hitstun: number; blockstun: number; startup: number }>;
  const want = (id: string, block: boolean): number => (block ? J[id].blockstun : J[id].hitstun) - (J[id].active + J[id].recovery);
  const r = rig({ guard: 'none' });
  const got: string[] = [];
  let good = true;
  for (const [id, key] of [['5L', B.L], ['5M', B.M]] as const) {
    for (let k = 0; k < 240 && !(free(r, 0) && free(r, 1)); k++) tick(r, 0);
    for (let k = 0; k < 400 && gap(r) > 0.95; k++) tick(r, B.RIGHT);
    r.hud.readout = null;
    tick(r, key);
    for (let k = 0; k < 70; k++) tick(r, 0);
    const ro = r.hud.readout as { adv: number; damage: number; startup: number } | null;
    const ok1 = !!ro && ro.adv === want(id, false) && ro.damage === J[id].damage && ro.startup === J[id].startup;
    good = good && ok1;
    got.push(`${id} hit adv ${ro?.adv} (data ${want(id, false)}) dmg ${ro?.damage} (data ${J[id].damage}) startup ${ro?.startup} (data ${J[id].startup})`);
  }
  const rb = rig({ guard: 'all' });
  for (let k = 0; k < 400 && gap(rb) > 0.95; k++) tick(rb, B.RIGHT);
  tick(rb, B.M);
  for (let k = 0; k < 70; k++) tick(rb, 0);
  const rob = rb.hud.readout as { adv: number; damage: number; block: boolean } | null;
  const okb = !!rob && rob.block && rob.adv === want('5M', true) && rob.damage === 0;
  got.push(`5M block adv ${rob?.adv} (data ${want('5M', true)})`);
  ok(good && okb, 'FRAME DATA measured per tick = the move data (5L / 5M on hit, 5M on block)', got.join('; '));
}

// ── RECORD + PLAYBACK
{
  const r = rig({ guard: 'none' });
  for (let k = 0; k < 30; k++) tick(r, 0);
  r.opts.set({ record: 'record' });
  const p1x = readFighter(r.m, 0).x;
  const d0 = readFighter(r.m, 1).x;
  // P1 (the player) drives the dummy: walk it right (away) for 50 ticks, then back in and jab 3 times
  const script: number[] = [];
  for (let k = 0; k < 50; k++) script.push(B.RIGHT);
  for (let k = 0; k < 70; k++) script.push(B.LEFT);
  for (let j = 0; j < 3; j++) { script.push(B.L); for (let k = 0; k < 19; k++) script.push(0); }
  for (const w of script) tick(r, w);
  const p1Still = Math.abs(readFighter(r.m, 0).x - p1x) < 0.02;
  const jabs = r.ev.filter((e) => e.type === EV.WHIFF && e.a === 1).length + r.ev.filter((e) => (e.type === EV.HIT || e.type === EV.BLOCK) && e.a === 1).length;
  ok(p1Still, 'RECORD: the player stands still while recording', `P1 moved ${(readFighter(r.m, 0).x - p1x).toFixed(3)} m`);
  ok(r.opts.get().record === 'off' && r.opts.recorded === 180, 'RECORD stops itself after 3 s (180 ticks)', `record=${r.opts.get().record} recorded=${r.opts.recorded}`);
  const moved = r.d.stats.recTicks;
  ok(moved === 180, 'RECORD: 180 of the player\'s words drove the dummy', `recTicks=${moved} dummy moved ${(readFighter(r.m, 1).x - d0).toFixed(2)} m, jabs ${jabs}`);
  for (let k = 0; k < 40; k++) tick(r, 0);
  const x0 = readFighter(r.m, 1).x;
  const ev0 = r.ev.length;
  r.opts.set({ record: 'play' });
  let maxRight = x0;
  const names = new Set<string>();
  for (let k = 0; k < 180; k++) { tick(r, 0); const f = readFighter(r.m, 1); if (f.x > maxRight) maxRight = f.x; if (f.moveName) names.add(f.moveName); }
  const pj = r.ev.slice(ev0).filter((e) => e.a === 1 && (e.type === EV.WHIFF || e.type === EV.HIT || e.type === EV.BLOCK)).length;
  ok(maxRight - x0 > 0.3 && names.has('5L'), 'PLAYBACK: the dummy repeats the recording (walks off, comes back, jabs)', `walked +${(maxRight - x0).toFixed(2)} m, moves ${[...names].join(',')}, jab events ${pj}`);
  for (let k = 0; k < 60; k++) tick(r, 0);
  ok(r.d.stats.playTicks >= 180, 'PLAYBACK loops after a free spell', `playTicks=${r.d.stats.playTicks}`);
}

// ── RESET (CHANGED(UI3D): the corner = against the RING wall on the spawn axis, CONTRACT §35.2)
/** the boundary gap of fighter i's push circle (m): circle R - (|p - c| + r); poly min over sides of apothem - (p.n + r) */
function wallGap(m: Match, i: number): number {
  const rg = readMatch(m).ring;
  const pc = readBoxes3(m, i).push;
  const cx = rg?.centre?.[0] ?? 0, cz = rg?.centre?.[1] ?? 0, R = rg?.radius ?? 5.5;
  const px = pc.x - cx, pz = pc.z - cz;
  if (rg?.shape !== 'poly') return R - (Math.hypot(px, pz) + pc.r);
  let g = Infinity;
  for (let k = 0; k < rg.sides; k++) {
    const a = rg.rot + (k * Math.PI * 2) / rg.sides;
    g = Math.min(g, R - (px * Math.sin(a) + pz * Math.cos(a) + pc.r));
  }
  return g;
}
for (const stage of ['rust_theater', 'butcher_block']) {
  const r = rig({}, 7, stage);
  // the spawn axis = P1 -> P2 at the fight start (the sim's own rule, §35.12: P1 always screen-left)
  const a0 = readFighter(r.m, 0), b0 = readFighter(r.m, 1);
  const ax = b0.x - a0.x, az = (b0.z ?? 0) - (a0.z ?? 0), al = Math.hypot(ax, az);
  const ux = ax / al, uz = az / al;
  const shape = readMatch(r.m).ring?.shape ?? '?';
  for (let k = 0; k < 60; k++) tick(r, B.RIGHT);
  for (const where of ['corner', 'cornered', 'mid'] as const) {
    r.opts.reset(where);
    tick(r, 0);
    const a = readFighter(r.m, 0), b = readFighter(r.m, 1);
    const ms = readMatch(r.m);
    const g = Math.hypot(b.x - a.x, (b.z ?? 0) - (a.z ?? 0));
    const along = (f: typeof a): number => f.x * ux + (f.z ?? 0) * uz;
    const off = (f: typeof a): number => Math.abs(f.x * uz - (f.z ?? 0) * ux);
    const walker = where === 'corner' ? 1 : 0;
    const wf = walker === 1 ? b : a;
    const wg = wallGap(r.m, walker);
    const good = where === 'mid'
      ? Math.abs(along(a) + along(b)) < 0.05 && g > 2 && g < 3
      : wg < 0.03 && off(wf) < 0.05 && off(walker === 1 ? a : b) < 0.05 && (walker === 1 ? along(b) > 3 : along(a) < -3) && g > 1.6 && g < 2.6;
    ok(good && ms.phase === 'fight' && free(r, 0) && free(r, 1), `RESET ${where.toUpperCase()} (${stage}, ${shape} ring): a fresh positioned match in live play${where === 'mid' ? '' : ', against the ring wall on the spawn axis'}`,
      `P1 (${a.x.toFixed(2)}, ${(a.z ?? 0).toFixed(2)}) P2 (${b.x.toFixed(2)}, ${(b.z ?? 0).toFixed(2)}) gap ${g.toFixed(2)}${where === 'mid' ? '' : ` wall gap ${wg.toFixed(3)} m off-axis ${off(wf).toFixed(3)} m`} phase ${ms.phase} ${a.stateName}/${b.stateName}`);
  }
}

// ── CHANGED(UI3D): DUMMY: SIDESTEPS / CIRCLES, P1's STEP through the driver (CONTRACT §35.2)
{
  const r = rig({ dummy: 'sidesteps' });
  const dirs: string[] = [];
  let inStep = false, maxOff = 0, dMin = Infinity, dMax = 0;
  const a0 = readFighter(r.m, 0), b0 = readFighter(r.m, 1);
  const ax = b0.x - a0.x, az = (b0.z ?? 0) - (a0.z ?? 0), al = Math.hypot(ax, az);
  for (let k = 0; k < 330; k++) {
    tick(r, 0);
    const a = readFighter(r.m, 0), b = readFighter(r.m, 1);
    const st = b.stateName === 'sidestep';
    if (st && !inStep) dirs.push(b.step?.dir ?? '?');
    inStep = st;
    maxOff = Math.max(maxOff, Math.abs((b.x - a0.x) * az - ((b.z ?? 0) - (a0.z ?? 0)) * ax) / al);
    const d = Math.hypot(b.x - a.x, (b.z ?? 0) - (a.z ?? 0));
    if (st) { dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); }
  }
  const alt = dirs.length >= 3 && dirs.every((d, i) => i === 0 || d !== dirs[i - 1]);
  ok(alt && maxOff > 0.4 && dMax - dMin < 0.05, 'DUMMY: SIDESTEPS - the dummy sidesteps again and again, IN / OUT in turn, off the spawn line at a kept distance',
    `sidesteps ${dirs.length} [${dirs.join(' ')}], max off-line ${maxOff.toFixed(2)} m, distance to P1 during steps ${dMin.toFixed(3)}..${dMax.toFixed(3)} m`);
}
{
  const r = rig({ dummy: 'circles' });
  let walkF = 0, dMin = Infinity, dMax = 0;
  const a = readFighter(r.m, 0);
  const b0 = readFighter(r.m, 1);
  const ang0 = Math.atan2(b0.x - a.x, (b0.z ?? 0) - (a.z ?? 0));
  let sweep = 0, last = ang0;
  const dirs = new Set<string>();
  for (let k = 0; k < 420; k++) {
    tick(r, 0);
    const p1 = readFighter(r.m, 0), b = readFighter(r.m, 1);
    if (b.stateName === 'sidewalk') {
      walkF++;
      dirs.add(b.step?.dir ?? '?');
      const d = Math.hypot(b.x - p1.x, (b.z ?? 0) - (p1.z ?? 0));
      if (walkF > 10) { dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); }
    }
    const ang = Math.atan2(b.x - p1.x, (b.z ?? 0) - (p1.z ?? 0));
    let da = ang - last;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    sweep = Math.max(sweep, Math.abs(sweep + da) > Math.abs(sweep) ? Math.abs(sweep + da) : Math.abs(sweep));
    last = ang;
  }
  const deg = (sweep * 180) / Math.PI;
  ok(walkF > 250 && deg > 60 && dMax - dMin < 0.05 && dirs.has('in') && dirs.has('out'), 'DUMMY: CIRCLES - the dummy circle-walks round P1 (both ways) at a kept distance',
    `sidewalk frames ${walkF}/420, swept ${deg.toFixed(0)} deg round P1, distance ${dMin.toFixed(3)}..${dMax.toFixed(3)} m, ways ${[...dirs].join('/')}`);
}
{
  const r = rig({ guard: 'none' });
  let walkF = 0;
  for (let k = 0; k < 80; k++) { tick(r, B.STEP_IN); if (readFighter(r.m, 0).stateName === 'sidewalk') walkF++; }
  const a = readFighter(r.m, 0);
  const z1 = a.z ?? 0;
  ok(walkF > 40 && Math.abs(z1) > 0.5 && (r.hud.wordsOr & B.STEP_IN) !== 0, 'P1 STEP passes through the driver: held STEP IN = SIDEWALK, the input display sees the STEP bit',
    `P1 sidewalk frames ${walkF}/80, P1 now (${a.x.toFixed(2)}, ${z1.toFixed(2)}), input words OR 0x${r.hud.wordsOr.toString(16)}`);
  // the HITBOX volumes follow P1 off the spawn line (3D, match.ts readBoxes)
  const bx = readBoxes(r.m);
  const hurtP1 = bx.filter((q) => q.kind === 'hurt').map((q) => {
    let sx = 0, sz = 0;
    for (const [x, , z] of q.pts) { sx += x; sz += z; }
    return [sx / q.pts.length, sz / q.pts.length] as const;
  });
  const near = hurtP1.some(([x, z]) => Math.hypot(x - a.x, z - z1) < 0.3);
  r.opts.set({ hitboxes: true });
  r.d.frame((x, y, z) => [400 + x * 100 + z * 30, 500 - y * 100 - z * 10]);
  ok(near && r.hud.boxes !== null && r.hud.boxes >= 4, 'HITBOX overlay in 3D: P1\'s hurt cylinder follows it off the spawn line, projected through (x, y, z)',
    `hurt centres ${hurtP1.map(([x, z]) => `(${x.toFixed(2)}, ${z.toFixed(2)})`).join(' ')}, boxes ${r.hud.boxes}`);
}

// ── METER FULL / CPU / boxes / input display
{
  const r = rig({ meter: 'full' });
  devSet(r.m, 0, 'showtime', 0);
  devSet(r.m, 1, 'nerve', 0);
  for (let k = 0; k < 3; k++) tick(r, 0);
  const a = readFighter(r.m, 0), b = readFighter(r.m, 1);
  ok(a.showtime === 30000 && b.nerve === 60000, 'METER FULL refills SHOWTIME and NERVE (sim devSet)', `P1 showtime ${a.showtime} P2 nerve ${b.nerve}`);
  const n = rig({ meter: 'normal' });
  devSet(n.m, 0, 'showtime', 0);
  for (let k = 0; k < 3; k++) tick(n, 0);
  ok(readFighter(n.m, 0).showtime === 0, 'METER NORMAL leaves the gauges alone', `P1 showtime ${readFighter(n.m, 0).showtime}`);
}
{
  const r = rig({ dummy: 'cpu', cpuLevel: 5 });
  let words = 0;
  const x0 = readFighter(r.m, 1).x;
  let attacks = 0;
  for (let k = 0; k < 600; k++) { tick(r, 0); if (r.d.stats.lastWord) words++; if (readFighter(r.m, 1).stateName === 'attack') attacks++; }
  ok(words > 20 && (Math.abs(readFighter(r.m, 1).x - x0) > 0.2 || attacks > 0), 'DUMMY: CPU (level 5) plays the dummy', `non-zero words ${words}/600, attack frames ${attacks}, moved ${(readFighter(r.m, 1).x - x0).toFixed(2)} m`);
}
{
  const r = rig();
  for (let k = 0; k < 400 && gap(r) > 1.0; k++) tick(r, B.RIGHT);
  tick(r, B.M);
  let maxHit = 0;
  for (let k = 0; k < 12; k++) { tick(r, 0); maxHit = Math.max(maxHit, readBoxes(r.m).filter((b) => b.kind === 'hit').length); }
  const bx = readBoxes(r.m);
  ok(bx.filter((b) => b.kind === 'hurt').length >= 2 && bx.filter((b) => b.kind === 'push').length === 2 && maxHit >= 1, 'HITBOX read-back: hurt + push boxes for both, a hit box on 5M\'s active frames', `hurt ${bx.filter((b) => b.kind === 'hurt').length} push ${bx.filter((b) => b.kind === 'push').length} hit(max) ${maxHit}`);
  r.opts.set({ hitboxes: true });
  r.d.frame((x, y) => [x * 100, 500 - y * 100]);
  ok(r.hud.boxes !== null && r.hud.boxes >= 4, 'HITBOX overlay: projected boxes handed to the Hud', `boxes ${r.hud.boxes}`);
  r.opts.set({ hitboxes: false });
  r.d.frame((x, y) => [x, y]);
  ok(r.hud.boxes === null, 'HITBOX overlay off clears the Hud canvas', `boxes ${r.hud.boxes}`);
  ok(r.hud.inputs >= r.d.stats.ticks - 1 && r.hud.inputs > 100, 'the input display gets P1\'s word every tick', `pushes ${r.hud.inputs} ticks ${r.d.stats.ticks}`);
}

const verdict = fail === 0 ? 'PASS' : 'FAIL';
if (V) for (const l of lines) void l;
console.log(`${verdict} probe_training: ${pass}/${pass + fail} checks (guard none/all/first/random, record+playback, reset x3 on a circle + an octagon ring, meter, cpu, sidesteps, circles, P1 step, boxes 3D, inputs)`);
process.exit(fail === 0 ? 0 : 1);

// orch1 controls r4 VERIFIER (fresh, independent of probe_sim_attack_at and of the r3 verifier fuzz): Shift + left-click
// attackAt. Targeted scenarios for the round-3 changes (fighters-only shot / swing pass Wicks), fog / invisible / ally pass,
// windup + cooldown timing to the tick, statuses, held re-send rate, facing, a fresh-seed fuzz (seeds 5001+) with the sim's own
// stateDigest compared over two runs, and stat invariance.
//   node _harness/_tmp_vfy_ctl_r4_attackat.ts [--n 300]
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, section } from './fixtures/sim_fixture.ts';
import { applyStatus } from '../src/sim/status.ts';
import { computeStats } from '../src/sim/stats.ts';
import { stateDigest } from '../src/sim/core.ts';
import { CC_HARD, ORDER_ATTACK_AT, type Entity } from '../src/sim/entity.ts';
import type { Command, SimEvent } from '../src/contracts/sim.ts';
import type { World } from '../src/sim/world.ts';

const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf('--n') + 1] ?? 300) || 300;
const cat = buildCatalog({
  fighters: [
    fighter('r4_archer', { base: { ad: 40, attackSpeed: 1.0, moveSpeed: 3.3 }, attack: { range: 6.0, windup: 0.25, projectileSpeed: 15 } }),
    fighter('r4_blade', { base: { ad: 40, attackSpeed: 1.25, moveSpeed: 3.3 }, attack: { range: 1.8, windup: 0.3 } }),
    fighter('r4_target', { base: { ad: 0, attackSpeed: 0.1, moveSpeed: 0, hp: 50000 }, attack: { range: 1.5, windup: 0.3 } }),
  ],
});
function mulberry(a: number): () => number { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const dmgTo = (evs: SimEvent[], id: number, src: number): number => evs.filter((e) => e.e === 'damage' && e.dst === id && e.src === src).length;
function run(w: World, ticks: number): SimEvent[] { const out: SimEvent[] = []; for (let k = 0; k < ticks; k++) for (const ev of w.step()) out.push(ev); return out; }
/** hero (player 0, team 0) at (hx, hy); enemy fighter (player 1, team 1) at (fx, fy) */
function world(who: string, hx: number, hy: number, fx: number, fy: number, seed = 77): { w: World; h: Entity; f: Entity } {
  const w = makeWorld(cat, [{ fighter: who, team: 0, x: hx, y: hy }, { fighter: 'r4_target', team: 1, x: fx, y: fy }], { seed });
  const h = fighterEnt(w, 0), f = fighterEnt(w, 1);
  computeStats(w, h); computeStats(w, f);
  w.vision.update(w.entities, w.tick);
  return { w, h, f };
}

section('Z ground shot: a Wick on the line is passed, the fighter behind it is hit; without Z the Wick takes it', () => {
  for (const fighters of [true, false]) {
    const { w, h, f } = world('r4_archer', 10, 20, 15, 20);
    const wick = addUnit(w, 'fx_dummy', 1, 12.5, 20);
    w.command(0, { type: 'attackAt', x: 20, y: 20, ...(fighters ? { fighters: true } : {}) });
    const evs = run(w, 60);
    const onWick = dmgTo(evs, wick.id, h.id), onF = dmgTo(evs, f.id, h.id);
    const aimed = evs.filter((e) => e.e === 'attack' && e.src === h.id);
    if (fighters) check(`Z shot passes the Wick and hits the fighter behind (wick ${onWick}, fighter ${onF}, attacks ${aimed.length})`, onWick === 0 && onF === 1, { onWick, onF });
    else check(`plain shot: targeted pick goes to the nearer meant enemy, one hit total (wick ${onWick}, fighter ${onF})`, onWick + onF === 1, { onWick, onF });
  }
});

section('Z shot with an explicit Wick target id: never hits the Wick', () => {
  const { w, h, f } = world('r4_archer', 10, 20, 30, 50);
  const wick = addUnit(w, 'fx_dummy', 1, 13, 20);
  w.command(0, { type: 'attackAt', x: 13, y: 20, target: wick.id, fighters: true });
  const evs = run(w, 60);
  check('no damage on the Wick under Z even when its id is passed', dmgTo(evs, wick.id, h.id) === 0, dmgTo(evs, wick.id, h.id));
  check('the press still threw one attack at the ground', evs.filter((e) => e.e === 'attack' && e.src === h.id && e.dst === -1).length === 1);
  void f;
});

section('Z melee swing: a nearer Wick in the arc is passed, the fighter in the arc is hit; without Z the nearer Wick', () => {
  for (const fighters of [true, false]) {
    const { w, h, f } = world('r4_blade', 10, 20, 12.6, 20.4);
    const wick = addUnit(w, 'fx_dummy', 1, 11.4, 19.7);
    // aim off both so neither is "meant" by the click point (swing at the ground), but both inside the 50 deg arc
    w.command(0, { type: 'attackAt', x: 10 + 8, y: 20 - 6.0 * 0 + 0.1, ...(fighters ? { fighters: true } : {}) });
    const evs = run(w, 60);
    const onWick = dmgTo(evs, wick.id, h.id), onF = dmgTo(evs, f.id, h.id);
    if (fighters) check(`Z swing hits the fighter, not the Wick (wick ${onWick}, fighter ${onF})`, onWick === 0 && onF === 1, { onWick, onF });
    else check(`plain swing: exactly one hit (wick ${onWick}, fighter ${onF})`, onWick + onF === 1, { onWick, onF });
  }
});

section('Z mid-windup re-aim: a plain targeted windup on a Wick, then a Z press elsewhere does not land on the Wick', () => {
  const { w, h, f } = world('r4_blade', 10, 20, 10, 23.5);
  const wick = addUnit(w, 'fx_dummy', 1, 11.8, 20);
  w.command(0, { type: 'attackAt', x: 11.8, y: 20, target: wick.id });
  w.step(); w.step();
  const started = h.atkWindup >= 0;
  w.command(0, { type: 'attackAt', x: 10, y: 23.5, target: f.id, fighters: true });
  const evs = run(w, 60);
  check(`after a Z re-press the Wick windup does not land (started ${started}, wick hits ${dmgTo(evs, wick.id, h.id)}, fighter hits ${dmgTo(evs, f.id, h.id)})`, dmgTo(evs, wick.id, h.id) === 0, { wick: dmgTo(evs, wick.id, h.id) });
});

section('fog / invisible / ally: the ground shot passes an ally, an invisible enemy fighter and an enemy outside vision', () => {
  for (const mode of ['ally', 'invisible', 'fog'] as const) {
    const { w, h, f } = world('r4_archer', 10, 20, 13, 20);
    let back: Entity;
    if (mode === 'ally') { const a = addUnit(w, 'fx_dummy', 0, 12, 20); back = addUnit(w, 'fx_dummy', 1, 14.5, 20); f.x = 40; f.y = 50; void a; }
    else if (mode === 'invisible') { applyStatus(w, null, f, 'invisible', 99); back = addUnit(w, 'fx_dummy', 1, 14.5, 20); }
    else { back = addUnit(w, 'fx_dummy', 1, 14.5, 20); }
    w.hashDirty = true; w.vision.update(w.entities, w.tick);
    if (mode === 'fog') f.visibleMask = 0;   // the fighter stands unseen by team 0 in front of the Wick
    w.command(0, { type: 'attackAt', x: 20, y: 20 });
    const evs: SimEvent[] = [];
    for (let k = 0; k < 60; k++) { if (mode === 'fog') f.visibleMask = 0; for (const e of w.step()) evs.push(e); }
    const hitF = dmgTo(evs, f.id, h.id), hitBack = dmgTo(evs, back.id, h.id);
    const allyHit = evs.some((e) => e.e === 'damage' && e.src === h.id && w.entity(e.dst)?.team === 0);
    check(`${mode}: no ally hit, no unseen hit, the visible Wick behind takes it (fighter ${hitF}, behind ${hitBack})`, !allyHit && (mode === 'ally' || hitF === 0) && hitBack === 1, { hitF, hitBack, allyHit });
  }
});

section('timing: the aimed shot starts at once when ready, its windup is windup x period, cooldown is one period', () => {
  for (const who of ['r4_archer', 'r4_blade'] as const) {
    const { w, h } = world(who, 10, 20, 40, 50);
    const period = 1 / h.stats.attackSpeed, wu = (who === 'r4_archer' ? 0.25 : 0.3) * period;
    w.command(0, { type: 'attackAt', x: 16, y: 20 });
    const evs = run(w, 5);
    const a = evs.find((e) => e.e === 'attack' && e.src === h.id) as Extract<SimEvent, { e: 'attack' }> | undefined;
    check(`${who}: attack on the first tick with windup ${wu.toFixed(3)}`, !!a && a.t <= 1 / 30 + 1e-9 && Math.abs(a.windup - wu) < 1e-6, a);
    // held re-send every tick for 5 s
    const ts: number[] = a ? [a.t] : [];
    for (let k = 0; k < 150; k++) { w.command(0, { type: 'attackAt', x: 16, y: 20 + (k % 3) * 0.1, held: true }); for (const e of w.step()) if (e.e === 'attack' && e.src === h.id) ts.push(e.t); }
    let g = Infinity; for (let i = 1; i < ts.length; i++) g = Math.min(g, ts[i] - ts[i - 1]);
    const want = Math.floor(5.1 / period) + 1;
    check(`${who}: held re-send attacks ${ts.length} times in 5.1 s (want ${want} +-1), min gap ${g.toFixed(3)} >= ${period.toFixed(3)} - 1 tick`, Math.abs(ts.length - want) <= 1 && g >= period - 1 / 30 - 1e-6, { n: ts.length, g });
  }
});

section('melee hit lands windup ticks after the attack event (targeted, in place)', () => {
  const { w, h, f } = world('r4_blade', 10, 20, 11.6, 20);
  w.command(0, { type: 'attackAt', x: 11.6, y: 20, target: f.id });
  let ta = -1, td = -1;
  for (let k = 0; k < 60; k++) for (const e of w.step()) { if (e.e === 'attack' && e.src === h.id && ta < 0) ta = e.t; if (e.e === 'damage' && e.src === h.id && td < 0) td = e.t; }
  const wu = 0.3 / h.stats.attackSpeed;
  check(`hit ${((td - ta) * 30).toFixed(1)} ticks after start, windup ${(wu * 30).toFixed(1)} ticks`, ta >= 0 && td >= 0 && Math.abs(td - ta - wu) <= 1 / 30 + 1e-6, { ta, td, wu });
});

section('statuses: stun / sleep / disarm block; silence / root / slow do not; the order lapses while blocked', () => {
  for (const kd of ['stun', 'sleep', 'disarm', 'silence', 'root', 'slow'] as const) {
    const { w, h } = world('r4_archer', 10, 20, 40, 50);
    const x0 = h.x, y0 = h.y;
    applyStatus(w, null, h, kd, 1.0, kd === 'slow' ? ({ amount: 0.4 } as never) : {});
    w.step();
    w.command(0, { type: 'attackAt', x: 16, y: 20 });
    const evs = run(w, 20);
    const n = evs.filter((e) => e.e === 'attack' && e.src === h.id).length;
    const block = kd === 'stun' || kd === 'sleep' || kd === 'disarm';
    check(`${kd}: ${n} attacks in 0.67 s (${block ? 'blocked' : 'allowed'}), never walked`, (block ? n === 0 : n === 1) && Math.hypot(h.x - x0, h.y - y0) < 1e-9, { n, moved: Math.hypot(h.x - x0, h.y - y0) });
    if (block) { const later = run(w, 60); const m = later.filter((e) => e.e === 'attack' && e.src === h.id).length;
      check(`${kd}: the one press lapsed (no attack queued past the grace), order now ${h.order}`, m === 0 && h.order !== ORDER_ATTACK_AT, { m, order: h.order }); }
  }
});

section('facing: a press while the cooldown runs still turns the hero to the new point, and the next shot flies that way', () => {
  const { w, h } = world('r4_archer', 10, 20, 40, 50);
  w.command(0, { type: 'attackAt', x: 16, y: 20 }); run(w, 15);   // past the windup, cooldown running
  w.command(0, { type: 'attackAt', x: 10, y: 26 });
  w.step();
  const want = Math.atan2(6, 0);
  let df = Math.abs(h.facing - want); df = Math.min(df, Math.PI * 2 - df);
  check(`faces the new point within 0.01 rad (off ${df.toFixed(4)})`, df < 0.01, df);
  let proj: Entity | undefined;
  for (let k = 0; k < 40 && !proj; k++) { w.step(); proj = w.entities.find((p) => p.kind === 'projectile' && !p.removed && p.proj?.src === h && p.y > 20.5); }
  check('the second shot flies toward the new point (+y)', !!proj, null);
});

// ── fresh-seed fuzz with a digest twice ────────────────────────────────────────────────────────────────────────────────
interface R { dig: string; viol: string[]; atk: number; hits: number }
function fuzz(seed: number): R {
  const rnd = mulberry(seed * 31 + 5);
  const who = seed % 2 ? 'r4_archer' : 'r4_blade';
  const { w, h, f } = world(who, 8 + rnd() * 14, 15 + rnd() * 25, 0, 0, seed);
  f.x = h.x + (rnd() - 0.5) * 8; f.y = h.y + (rnd() - 0.5) * 8; w.hashDirty = true;
  const s0 = JSON.stringify(h.stats);
  const wicks: Entity[] = [];
  for (let i = 0; i < 1 + Math.floor(rnd() * 6); i++) wicks.push(addUnit(w, 'fx_dummy', rnd() < 0.7 ? 1 : 0, h.x + (rnd() - 0.5) * 10, h.y + (rnd() - 0.5) * 10));
  w.vision.update(w.entities, w.tick);
  const viol: string[] = []; let atk = 0, hits = 0, lastT = -9;
  const period = 1 / h.stats.attackSpeed;
  let zOn = false;
  for (let k = 0; k < 240; k++) {
    if (k < 90 && rnd() < 0.015) applyStatus(w, null, h, (['stun', 'disarm', 'root', 'slow', 'silence'] as const)[Math.floor(rnd() * 5)], 0.3 + rnd() * 0.6, {} as never);
    const r = rnd(); let c: Command | null = null;
    if (r < 0.08) { zOn = rnd() < 0.5; const a = rnd() * 6.283, d = rnd() * 9; const tg = rnd() < 0.3 ? [f.id, ...wicks.map((u) => u.id)][Math.floor(rnd() * (wicks.length + 1))] : undefined;
      c = { type: 'attackAt', x: h.x + Math.cos(a) * d, y: h.y + Math.sin(a) * d, ...(tg !== undefined ? { target: tg } : {}), ...(zOn ? { fighters: true } : {}), ...(rnd() < 0.3 ? { held: true } : {}) }; }
    else if (r < 0.09) c = { type: 'attackAt', x: h.x, y: h.y, end: true };
    else if (r < 0.1) c = { type: 'move', x: h.x + (rnd() - 0.5) * 6, y: h.y + (rnd() - 0.5) * 6 };
    if (c) w.command(0, c);
    const pre = h.order, px = h.x, py = h.y;
    const out = w.step();
    if (pre === ORDER_ATTACK_AT && h.order === ORDER_ATTACK_AT && (!c || c.type === 'attackAt')) {
      const touching = w.entities.some((o) => o !== h && o.alive && o.kind !== 'projectile' && Math.hypot(o.x - h.x, o.y - h.y) < h.radius + o.radius + 0.05);
      if (!touching && Math.hypot(h.x - px, h.y - py) > 1e-9) viol.push(`walked k${k}`);
    }
    for (const ev of out) {
      if (ev.e === 'attack' && ev.src === h.id) { atk++; if (ev.t - lastT < period - 1 / 30 - 1e-6) viol.push(`cooldown k${k}`); lastT = ev.t; if ((h.ccMask & CC_HARD) !== 0) viol.push(`hardcc k${k}`); }
      if (ev.e === 'damage' && ev.src === h.id) { hits++; const t = w.entity(ev.dst); if (!t || t.team !== 1) viol.push(`non-enemy hit k${k}`); }
    }
  }
  run(w, 60); computeStats(w, h);
  if (JSON.stringify(h.stats) !== s0) viol.push('stats changed');
  return { dig: stateDigest(w), viol, atk, hits };
}
section(`fuzz (fresh seeds 5001..${5000 + N}): invariants + stateDigest identical over two runs`, () => {
  let bad = 0, att = 0, hit = 0; const vs: string[] = []; const first: number[] = [];
  for (let s = 5001; s <= 5000 + N; s++) { const a = fuzz(s), b = fuzz(s); att += a.atk; hit += a.hits; if (a.dig !== b.dig) { bad++; if (first.length < 5) first.push(s); } for (const v of a.viol) if (vs.length < 12) vs.push(`s${s} ${v}`); }
  console.log(`  ${N} streams, ${att} attacks, ${hit} hits`);
  check('0 invariant violations', vs.length === 0, vs);
  check('digest identical twice on every stream', bad === 0, { bad, first });
  check('fuzz exercised attacks and hits', att > N && hit > N / 4, { att, hit });
});

finish('_tmp_vfy_ctl_r4_attackat');

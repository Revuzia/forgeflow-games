// probe (lane W2-D, ruling 54): the cast buffer. A human seat's cast refused only because the fighter is busy (a dash,
// a windup, a channel) is held for 0.4 s and fired on the first free tick:
//   a key pressed 150 ms before a dash ends fires within 2 ticks of the dash end (and one pressed during a windup fires
//   on the release tick); it lapses at 0.4 s; a move to a new point, a stop, an attack order, CC and death clear it (a
//   held move re-sending its own point does not); a newer press replaces it; PlayerView.pendingCast names the slot while
//   it waits; bot seats never buffer; the same command stream twice gives equal state digests.
import { ability, buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { check, fighterEnt, finish, makeSetup, section } from './fixtures/sim_fixture.ts';
import { TICK_HZ, type Command, type SimEvent } from '../src/contracts/sim.ts';
import { CAST_BUFFER_S, levelUpAbility, setLevel } from '../src/sim/abilities.ts';
import { killEntity } from '../src/sim/combat.ts';
import { createWorld, stateDigest } from '../src/sim/core.ts';
import { applyStatus } from '../src/sim/status.ts';
import type { World } from '../src/sim/world.ts';

const ctr = (id: string) => ({ op: 'counter', counter: id, add: 1 });
const cat = buildCatalog({
  fighters: [
    fighter('fx_buf', {
      a1: ability('fx_tap', [ctr('fx_tap')], { cooldown: 1 }),
      // a 0.8 s dash (8 m at 10 m/s)
      a2: ability('fx_run', [{ op: 'dash', mode: 'direction', distance: 8, speed: 10 }], { cooldown: 1, targeting: { kind: 'direction', range: 8 } }),
      a3: ability('fx_slow', [ctr('fx_slow')], { cooldown: 1, castTime: 0.5 }),
      ult: ability('fx_point', [ctr('fx_pt')], { cooldown: 1, targeting: { kind: 'point', range: 30 } }),
    }),
    fighter('fx_dummy', {}),
  ],
});

const TICK_MS = 1000 / TICK_HZ;
function world(human = true): World {
  const setup = makeSetup([{ fighter: 'fx_buf', team: 0 }, { fighter: 'fx_dummy', team: 1 }]);
  if (human) (setup.seats[0] as { controller: string }).controller = 'human';
  const w = createWorld(cat, setup);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  a.x = 20; a.y = 20; b.x = 60; b.y = 60;
  a.autoAttack = false; b.autoAttack = false;
  setLevel(w, a, 7);
  for (const s of ['a1', 'a2', 'a3', 'ult'] as const) levelUpAbility(w, a, s);
  w.hashDirty = true;
  return w;
}
/** a scripted run: `at` maps a tick to the commands queued before it; returns the tick of every cast event per slot,
 *  the ticks the dash / windup ended, and pendingCast per tick */
interface Run { casts: Record<string, number[]>; dashEnd: number; windupEnd: number; pending: (string | null)[]; digest: string; w: World }
function run(at: Record<number, Command[]>, ticks: number, opts: { human?: boolean; hooks?: Record<number, (w: World) => void> } = {}): Run {
  const w = world(opts.human !== false);
  const a = fighterEnt(w, 0);
  const casts: Record<string, number[]> = {};
  const pending: (string | null)[] = [];
  let dashEnd = -1, windupEnd = -1, wasDash = false, wasWind = false;
  for (let t = 0; t < ticks; t++) {
    for (const c of at[t] ?? []) w.command(0, c);
    opts.hooks?.[t]?.(w);
    const evs: SimEvent[] = w.step();
    for (const ev of evs) if (ev.e === 'cast' && ev.src === a.id) (casts[ev.slot] ??= []).push(t);
    if (wasDash && !a.dash && dashEnd < 0) dashEnd = t;
    wasDash = !!a.dash;
    const wind = !!a.cast && a.cast.phase === 'windup';
    if (wasWind && !wind && windupEnd < 0) windupEnd = t;
    wasWind = wind;
    pending.push(w.players[0].pendingCast ?? null);
  }
  return { casts, dashEnd, windupEnd, pending, digest: stateDigest(w), w };
}
const DASH: Command = { type: 'cast', slot: 'a2', x: 40, y: 20 };
const TAP: Command = { type: 'cast', slot: 'a1' };

// the dash's end tick from a run with no second press
const ref = run({ 1: [DASH] }, 60);
const T = ref.dashEnd;
section('reference: the dash runs about 0.8 s', () => {
  check('the dash started at tick 1 and ended', (ref.casts.a2 ?? [])[0] === 1 && T > 1, { a2: ref.casts.a2, dashEnd: T });
  console.log(`  dash ends at tick ${T} (${((T - 1) * TICK_MS).toFixed(0)} ms after it started)`);
});

section('a key pressed 150 ms before the dash ends fires within 2 ticks of the dash end', () => {
  const before = Math.round(150 / TICK_MS);           // 5 ticks = 167 ms (4 = 133 ms is checked too)
  for (const k of [before - 1, before]) {
    const r = run({ 1: [DASH], [T - k]: [TAP] }, 60);
    const fired = (r.casts.a1 ?? [])[0];
    check(`pressed ${(k * TICK_MS).toFixed(0)} ms before the end: fired ${fired === undefined ? 'never' : `${fired - T} tick(s) after the dash end`}`, fired !== undefined && fired >= T && fired - T <= 2, { fired, T });
    check(`…pendingCast named a1 while it waited`, r.pending[T - k] === 'a1' && r.pending[T - 1] === 'a1', r.pending.slice(T - k - 1, T + 2));
    check(`…and cleared once it fired`, fired !== undefined && r.pending[fired] === null);
  }
});

section('a press during a windup fires on the release tick', () => {
  const r0 = run({ 1: [{ type: 'cast', slot: 'a3' }] }, 40);
  const R = r0.windupEnd;
  const r = run({ 1: [{ type: 'cast', slot: 'a3' }], [R - 6]: [TAP] }, 40);
  const fired = (r.casts.a1 ?? [])[0];
  check(`windup released at tick ${R}; the buffered a1 fired at tick ${fired}`, fired !== undefined && fired - R >= 0 && fired - R <= 1, { R, fired });
});

section(`it lapses at ${CAST_BUFFER_S} s`, () => {
  const inside = Math.floor((CAST_BUFFER_S * 1000) / TICK_MS) - 1;   // 11 ticks = 367 ms
  const outside = Math.ceil((CAST_BUFFER_S * 1000) / TICK_MS) + 1;  // 13 ticks = 433 ms
  const ri = run({ 1: [DASH], [T - inside]: [TAP] }, 60);
  const ro = run({ 1: [DASH], [T - outside]: [TAP] }, 60);
  check(`pressed ${(inside * TICK_MS).toFixed(0)} ms before the end: fires`, (ri.casts.a1 ?? []).length === 1);
  check(`pressed ${(outside * TICK_MS).toFixed(0)} ms before the end: lapsed, never fires`, (ro.casts.a1 ?? []).length === 0, ro.casts.a1);
  const lapse = ro.pending.findIndex((p, i) => i > T - outside && p === null);
  check(`…and pendingCast went null ${((lapse - (T - outside)) * TICK_MS).toFixed(0)} ms after the press (≈ ${CAST_BUFFER_S * 1000} ms)`, lapse > 0 && Math.abs((lapse - (T - outside)) * TICK_MS - CAST_BUFFER_S * 1000) <= TICK_MS * 1.01, lapse);
});

section('a move to a new point, a stop and an attack clear it; the held move re-sending its own point does not', () => {
  const p = T - 5;
  const mv = run({ 1: [DASH], [p]: [TAP], [p + 1]: [{ type: 'move', x: 10, y: 30 }] }, 60);
  check('move to a new point: never fires', (mv.casts.a1 ?? []).length === 0, mv.casts.a1);
  const st = run({ 1: [DASH], [p]: [TAP], [p + 1]: [{ type: 'stop' }] }, 60);
  check('stop: never fires', (st.casts.a1 ?? []).length === 0, st.casts.a1);
  const w0 = world();
  const dummy = fighterEnt(w0, 1).id;
  const ak = run({ 1: [DASH], [p]: [TAP], [p + 1]: [{ type: 'attack', target: dummy }] }, 60);
  check('attack order: never fires', (ak.casts.a1 ?? []).length === 0, ak.casts.a1);
  // a held right button: the walk to (30, 30) then the same point re-sent while dashing
  const held = run({ 0: [{ type: 'move', x: 30, y: 30 }], 1: [DASH], [p]: [TAP], [p + 1]: [{ type: 'move', x: 30, y: 30 }] }, 60);
  check('held move re-sending its own point: still fires', (held.casts.a1 ?? []).length === 1, held.casts.a1);
  const nw = run({ 1: [DASH], [p]: [TAP], [p + 1]: [{ type: 'cast', slot: 'ult', x: 25, y: 25 }] }, 60);
  check('a newer press replaces it (ult fires, a1 does not)', (nw.casts.ult ?? []).length === 1 && (nw.casts.a1 ?? []).length === 0, nw.casts);
});

section('CC and death clear it', () => {
  const r0 = run({ 1: [{ type: 'cast', slot: 'a3' }] }, 40);
  const R = r0.windupEnd;
  // a 0.1 s stun mid-windup: the windup is cancelled, the held cast is dropped (it never fires after the stun)
  const cc = run({ 1: [{ type: 'cast', slot: 'a3' }], [R - 8]: [TAP] }, 40, { hooks: { [R - 6]: (w) => { applyStatus(w, fighterEnt(w, 1), fighterEnt(w, 0), 'stun', 0.1); } } });
  check('stun: the held cast never fires', (cc.casts.a1 ?? []).length === 0 && cc.pending[R - 6] === null, { a1: cc.casts.a1, p: cc.pending.slice(R - 8, R - 4) });
  const p = T - 5;
  const dd = run({ 1: [DASH], [p]: [TAP] }, 60, { hooks: { [p + 1]: (w) => { killEntity(w, fighterEnt(w, 0), null); } } });
  check('death: cleared, never fires', (dd.casts.a1 ?? []).length === 0 && dd.pending[p + 1] === null, { a1: dd.casts.a1 });
});

section('bot seats never buffer (their commands are unchanged)', () => {
  const b = run({ 1: [DASH], [T - 4]: [TAP] }, 60, { human: false });
  check('a bot seat pressing mid-dash: dropped as before', (b.casts.a1 ?? []).length === 0 && b.pending.every((x) => x === null), b.casts.a1);
});

section('determinism: the same command stream twice gives equal digests', () => {
  const stream = { 1: [DASH], [T - 4]: [TAP], [T + 6]: [{ type: 'cast', slot: 'a3' } as Command], [T + 10]: [{ type: 'cast', slot: 'ult', x: 30, y: 22 } as Command], [T + 30]: [DASH], [T + 40]: [TAP] };
  const r1 = run(stream, 120), r2 = run(stream, 120);
  check(`digests equal (${r1.digest} / ${r2.digest})`, r1.digest === r2.digest);
  check('…and the buffered casts landed on the same ticks', JSON.stringify(r1.casts) === JSON.stringify(r2.casts), [r1.casts, r2.casts]);
});

finish('probe_sim_cast_buffer');

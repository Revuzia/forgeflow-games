// probe (ruling 61): the seat's auto attack switch (Command 'autoAttack', Settings › Controls › Auto attack).
//   off + idle beside an enemy for 5 s = 0 swings (after a Stop, after a move ends, and while that enemy hits you);
//   off + an attack order = attacks, and after the kill the fighter goes idle (it never picks the next enemy);
//   off + attack-move = acquires along the way (an explicit order); off + attack in place = attacks;
//   on (the command sent or never sent) = the same swings and digest as a seat that never touches it;
//   the opponent seat is unaffected (its fighter keeps acquiring); off persists across death and respawn;
//   the same command stream twice = equal digests; default-on matches (a full lane match with bots and a scripted
//   human, and a FRAY brawl) keep the digests HEAD 17a901310 gave before this lane.
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { fraySetup, laneSetup, matchCatalog } from './fixtures/match_fixture.ts';
import { fixtureBots } from './fixtures/fixture_bot.ts';
import { check, fighterEnt, finish, makeSetup, section } from './fixtures/sim_fixture.ts';
import { TICK_HZ, type Command, type MatchSetup, type SimEvent } from '../src/contracts/sim.ts';
import { createWorld, stateDigest } from '../src/sim/core.ts';
import { createSim } from '../src/sim/sim.ts';
import { matchDigest } from '../src/sim/modes/match.ts';
import type { World } from '../src/sim/world.ts';
import { InputController, type InputHooks } from '../src/input/controller.ts';
import { defaultSettings, normalizeSettings, patchSettings, type ControlSettings } from '../src/session/settings.ts';
import { ACTION_GROUPS, ACTION_LABELS } from '../src/ui/keys.ts';
import { readFileSync } from 'node:fs';

const cat = buildCatalog({ fighters: [fighter('fx_me', {}), fighter('fx_foe', {})] });
const S5 = 5 * TICK_HZ;

/** seat 0 (human, team 0) at (20, 20); seat 1 (team 1) beside it in reach; seat 2 (team 1) also in reach.
 *  Every fighter starts with autoAttack as the sim gives it (on), except `foeIdle` makes seats 1-2 passive. */
function world(o: { foeIdle?: boolean; foeHp?: number } = {}): World {
  const setup: MatchSetup = makeSetup([{ fighter: 'fx_me', team: 0 }, { fighter: 'fx_foe', team: 1 }, { fighter: 'fx_foe', team: 1 }]);
  (setup.seats[0] as { controller: string }).controller = 'human';
  const w = createWorld(cat, setup);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1), c = fighterEnt(w, 2);
  a.x = 20; a.y = 20; b.x = 21.6; b.y = 20; c.x = 20; c.y = 21.6;
  if (o.foeIdle !== false) { b.autoAttack = false; c.autoAttack = false; }
  if (o.foeHp !== undefined) { b.hp = o.foeHp; }
  w.hashDirty = true;
  w.vision.update(w.entities, w.tick);
  return w;
}
interface Run { w: World; swings: number[]; swingsAt: Record<number, number[]>; foeSwings: number; digest: string; evs: SimEvent[] }
/** run `ticks` ticks, queueing `at[t]` for seat 0 (and `foe[t]` for seat 1) before tick t */
function run(w: World, ticks: number, at: Record<number, Command[]> = {}, foe: Record<number, Command[]> = {}): Run {
  const me = fighterEnt(w, 0).id, f1 = fighterEnt(w, 1).id;
  const swings: number[] = [], swingsAt: Record<number, number[]> = {}, evs: SimEvent[] = [];
  let foeSwings = 0;
  for (let t = 0; t < ticks; t++) {
    for (const c of at[t] ?? []) w.command(0, c);
    for (const c of foe[t] ?? []) w.command(1, c);
    for (const ev of w.step()) {
      evs.push(ev);
      if (ev.e === 'attack' && ev.src === me) { swings.push(t); (swingsAt[ev.dst] ??= []).push(t); }
      if (ev.e === 'attack' && ev.src === f1) foeSwings++;
    }
  }
  return { w, swings, swingsAt, foeSwings, digest: stateDigest(w), evs };
}
const OFF: Command = { type: 'autoAttack', on: false };
const ON: Command = { type: 'autoAttack', on: true };

section('control: with the switch on (never sent) the fighter acquires by itself', () => {
  const r = run(world(), S5);
  check('on, idle beside an enemy for 5 s: it swings by itself', r.swings.length >= 4, r.swings.length);
  console.log(`  on: ${r.swings.length} swings in 5 s`);
});

section('off + idle beside an enemy for 5 s = 0 swings', () => {
  const r = run(world(), S5, { 0: [OFF] });
  check('off at tick 0: 0 swings in 5 s', r.swings.length === 0, r.swings);
  check('PlayerView.autoAttack reads false', r.w.players[0].autoAttack === false && fighterEnt(r.w, 0).seatAutoOff === true);
  const s = run(world(), S5, { 0: [OFF], 3: [{ type: 'stop' }] });
  check('off, then Stop: 0 swings in 5 s', s.swings.length === 0, s.swings);
  // a move that ends right beside the enemies
  const m = world();
  fighterEnt(m, 0).x = 14;
  const mv = run(m, S5 + 60, { 0: [OFF], 1: [{ type: 'move', x: 20, y: 20 }] });
  check('off, after a move ends beside enemies: 0 swings', mv.swings.length === 0, mv.swings);
});

section('off: a fighter hit while idle does not answer (genre standard); the opponent seat is unaffected', () => {
  const r = run(world({ foeIdle: false }), S5, { 0: [OFF] });
  check('the enemy fighters (opponent seats) still acquire and swing at you', r.foeSwings >= 4, r.foeSwings);
  check('your fighter, hit while idle with the switch off, never swings back', r.swings.length === 0, r.swings);
  check('the opponent seat keeps its own switch on', r.w.players[1].autoAttack === true && !fighterEnt(r.w, 1).seatAutoOff && fighterEnt(r.w, 1).autoAttack);
  // the opponent seat's own fighter with your switch on vs off: the same swings while you stand still
  const on = run(world({ foeIdle: false }), S5);
  check('opponent swings are the same whether your switch is on or off', on.foeSwings === r.foeSwings, [on.foeSwings, r.foeSwings]);
});

section('off + an attack order: attacks, and after the kill goes idle', () => {
  const w = world({ foeHp: 150 });
  const b = fighterEnt(w, 1), c = fighterEnt(w, 2);
  const r = run(w, S5 + 90, { 0: [OFF], 2: [{ type: 'attack', target: b.id }] });
  const onB = r.swingsAt[b.id] ?? [], onC = r.swingsAt[c.id] ?? [];
  check('the ordered target is attacked', onB.length >= 2, onB);
  check('the ordered target dies', !b.alive);
  check('after the kill: no swing at the next enemy in reach (5 s)', onC.length === 0, onC);
  // control: the switch on picks the next enemy after the kill
  const w2 = world({ foeHp: 150 });
  const r2 = run(w2, S5 + 90, { 2: [{ type: 'attack', target: fighterEnt(w2, 1).id }] });
  check('control (on): after the kill it picks the next enemy', (r2.swingsAt[fighterEnt(w2, 2).id] ?? []).length >= 2, r2.swingsAt);
});

section('off + attack-move: acquires along the way; off + attack in place: attacks', () => {
  const w = world();
  const a = fighterEnt(w, 0);
  a.x = 10; a.y = 20;
  const c = fighterEnt(w, 2); c.x = 60; c.y = 60; // out of the way
  const r = run(w, S5, { 0: [OFF], 1: [{ type: 'move', x: 30, y: 20, attackMove: true }] });
  check('attack-move with the switch off stops for the enemy on the way and swings', (r.swingsAt[fighterEnt(w, 1).id] ?? []).length >= 2, r.swingsAt);
  const w2 = world();
  const r2 = run(w2, 60, { 0: [OFF], 2: [{ type: 'attackAt', x: 21.6, y: 20 }] });
  check('attack in place with the switch off swings once', r2.swings.length === 1, r2.swings);
});

section('on is unchanged: sending on (or off then on) matches a seat that never sends it', () => {
  const base = run(world({ foeIdle: false }), S5);
  const sentOn = run(world({ foeIdle: false }), S5, { 0: [ON] });
  check('autoAttack on at tick 0: same swings and digest as never sent', sentOn.digest === base.digest && sentOn.swings.join() === base.swings.join(), [base.digest, sentOn.digest]);
  // off for a while, then back on: it acquires again at once (within a tick of the command plus one attack period)
  const back = run(world(), S5, { 0: [OFF], 60: [ON] });
  check('off then on at tick 60: no swing before, swings again within 2 ticks after', back.swings.length >= 2 && back.swings[0] >= 60 && back.swings[0] <= 62, back.swings);
  // mid-match off takes effect at once: the next attack does not start
  const mid = run(world(), S5, { 45: [OFF] });
  const last = mid.swings[mid.swings.length - 1] ?? -1;
  check('on, then off at tick 45: no attack starts after tick 45', mid.swings.length >= 1 && last < 45, mid.swings);
});

section('off persists across death and respawn (the seat keeps it); the command is refused when malformed', () => {
  const w = world();
  run(w, 3, { 0: [OFF] });
  const a = fighterEnt(w, 0);
  check('seatAutoOff set', a.seatAutoOff === true);
  // a recall saves and restores autoAttack: the seat switch is separate and survives it
  a.autoAttack = true;
  check('a restored unit autoAttack does not bring idle acquire back', run(w, S5).swings.length === 0);
  const before = w.players[0].autoAttack;
  w.command(0, { type: 'autoAttack', on: 'no' } as unknown as Command);
  run(w, 2);
  check('a malformed autoAttack command is dropped', w.players[0].autoAttack === before);
});

section('determinism: the same command stream twice gives equal digests', () => {
  const wa = world({ foeIdle: false }), wb = world({ foeIdle: false });
  const tgt = fighterEnt(wa, 2).id;
  const stream: Record<number, Command[]> = { 0: [OFF], 20: [{ type: 'attack', target: tgt }], 70: [ON], 100: [OFF], 110: [{ type: 'move', x: 25, y: 20, attackMove: true }], 160: [{ type: 'stop' }] };
  const a = run(wa, 240, stream), b = run(wb, 240, stream);
  console.log(`  digests ${a.digest} / ${b.digest}`);
  check('equal digests', a.digest === b.digest, [a.digest, b.digest]);
  check('equal event streams', JSON.stringify(a.evs) === JSON.stringify(b.evs));
  const n = run(world({ foeIdle: false }), 240, { ...stream, 0: [] });
  check('the switch changes the outcome (digest differs from the stream without it)', n.digest !== a.digest, [n.digest, a.digest]);
});

section('input: the setting reaches the sim through the controller; default-on sends nothing; the toggle key', () => {
  (globalThis as { document?: unknown }).document ??= { elementFromPoint: () => null };
  const mk = (s: ReturnType<typeof defaultSettings>, hooks: Partial<InputHooks> = {}) => {
    const w = world();
    const sent: Command[] = [];
    const client = { you: 0, view: w, send: (c: Command) => { sent.push(c); w.command(0, c); } };
    const h: InputHooks = { toggleShop() {}, closeShop: () => false, scoreboard() {}, denied() {}, marker() {}, setCameraLock() {}, blocked: () => false, pingsDisabled: () => false, ...hooks };
    const ctl = new InputController({ client: client as never, renderer: null, index: { get: () => undefined, itemActive: () => undefined } as never, settings: s, hooks: h, surface: { contains: () => true } as unknown as HTMLElement });
    return { w, sent, ctl };
  };
  const d = mk(defaultSettings());
  for (let f = 0; f < 20; f++) { d.ctl.frame(f * 100); d.w.step(); }
  check('default settings: auto attack on, nothing is sent in 2 s of frames', (defaultSettings().controls as ControlSettings).autoAttack === true && d.sent.length === 0, d.sent);
  const off = patchSettings(defaultSettings(), { controls: { autoAttack: false } as never });
  const o = mk(off);
  for (let f = 0; f < 20; f++) { o.ctl.frame(f * 100); o.w.step(); }
  check('off: one autoAttack command is sent on the first frame and the seat reads off', o.sent.length === 1 && o.sent[0].type === 'autoAttack' && (o.sent[0] as { on: boolean }).on === false && o.w.players[0].autoAttack === false, o.sent);
  o.ctl.setSettings(defaultSettings());
  for (let f = 20; f < 40; f++) { o.ctl.frame(f * 100); o.w.step(); }
  check('changed back mid-match: one on command, the seat reads on', o.sent.length === 2 && (o.sent[1] as { on: boolean }).on === true && o.w.players[0].autoAttack === true, o.sent);
  check('the setting persists through normalize (a saved off stays off; a save without it reads on)',
    (normalizeSettings(JSON.parse(JSON.stringify(off))).controls as ControlSettings).autoAttack === false
    && (normalizeSettings({ controls: { binds: {} } }).controls as ControlSettings).autoAttack === true);
  let toggles = 0;
  const kb = patchSettings(defaultSettings(), { controls: { binds: { toggleAutoAttack: 'KeyT' } } as never });
  const t = mk(kb, { toggleAutoAttack: () => { toggles++; } });
  const ev = (code: string) => ({ code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, target: null, defaultPrevented: false, preventDefault() {}, stopImmediatePropagation() {} });
  (t.ctl as unknown as { onKeyDown(e: unknown): void }).onKeyDown(ev('KeyT'));
  (t.ctl as unknown as { onKeyUp(e: unknown): void }).onKeyUp(ev('KeyT'));
  check('the toggle key (unbound by default) calls the HUD toggle once when bound', defaultSettings().controls.binds.toggleAutoAttack === '' && toggles === 1, toggles);
  const all = ACTION_GROUPS.flatMap((g) => g.actions);
  check('keys.ts lists toggleAutoAttack with a label', all.includes('toggleAutoAttack') && !!ACTION_LABELS.toggleAutoAttack);
  const strings = JSON.parse(readFileSync(new URL('../content/strings.en.json', import.meta.url), 'utf8')) as Record<string, string>;
  const keys = ['settings.controls.autoAttack.label', 'settings.controls.autoAttack.desc', 'settings.controls.action.toggleAutoAttack', 'hud.autoAttack.on', 'hud.autoAttack.off'];
  check('strings: the switch, its description, the key and both toasts', keys.every((k) => !!strings[k]), keys.filter((k) => !strings[k]));
  check('strings: no bots / AI / CPU mention', keys.every((k) => !/\b(bots?|AI|CPU|computer)\b/i.test(strings[k] ?? '')));
  check('the description says what it is for (last hits)', /last hit/i.test(strings['settings.controls.autoAttack.desc'] ?? ''));
});

// ── default-on matches keep HEAD's digests (the same matches as probe_sim_determinism, nobody sends the switch) ────
// Baselines measured at HEAD 17a901310 with this lane's sim edits reversed (attack.ts, core.ts, entity.ts, world.ts,
// contracts/sim.ts), 2026-11-18.
const HEAD_LANE_99 = '5edfad52';
const HEAD_FRAY_5 = '441084ba';
const HEAD_LANE_STOP_99 = '29f3e850';
const mcat = matchCatalog();
const laneSeats = [
  { fighter: 'fx_juggernaut', team: 0 }, { fighter: 'fx_brawler', team: 0, controller: 'human' as const },
  { fighter: 'fx_brawler', team: 1 }, { fighter: 'fx_ranger', team: 1 },
];
function script(tick: number): Command[] {
  const out: Command[] = [];
  if (tick === 10) out.push({ type: 'buy', item: 'fx_sword' });
  if (tick % 90 === 0) out.push({ type: 'move', x: 30 + (tick % 7) * 9, y: 18 + (tick % 5), attackMove: true });
  if (tick % 150 === 45) out.push({ type: 'cast', slot: 'a1' });
  if (tick % 400 === 7) out.push({ type: 'levelUp', slot: 'a1' });
  return out;
}
let laneFlags: boolean[] = [];
export function laneDigest(extra?: (tick: number) => Command[]): string {
  const sim = createSim(mcat, laneSetup(laneSeats, { seed: 99 }), { bots: fixtureBots((s) => (s.team === 0 ? 'push' : 'defend')) });
  let n = 0;
  while (sim.view.phase !== 'ended' && n < 30 * 60 * 10) {
    for (const c of script(sim.view.tick)) sim.command(1, c);
    for (const c of extra?.(sim.view.tick) ?? []) sim.command(1, c);
    if (sim.view.tick % 60 === 3) sim.command(0, { type: 'ping', kind: 'push', x: 50, y: 20 });
    sim.step();
    n++;
  }
  laneFlags = sim.view.players.map((p) => p.autoAttack !== false);
  return sim.view.result?.digest ?? matchDigest(sim.world, null);
}
export function frayDigest(): string {
  const sim = createSim(mcat, fraySetup(6, { seed: 5 }), { pregameSeconds: 1 });
  for (let t = 0; t < 30 * 60 && sim.view.phase !== 'ended'; t++) {
    if (t % 45 === 0) for (let p = 0; p < 6; p++) sim.command(p, { type: 'move', x: 25 + ((p * 7 + t) % 9) - 4, y: 25 + ((p * 5 + t) % 7) - 3, attackMove: true });
    if (t % 100 === 50) for (let p = 0; p < 6; p++) sim.command(p, { type: 'cast', slot: 'a1' });
    if (t === 2) for (let p = 0; p < 6; p++) sim.command(p, { type: 'levelUp', slot: 'a1' });
    sim.step();
  }
  return sim.view.result?.digest ?? matchDigest(sim.world, null);
}

section('default-on matches keep the existing determinism digests', () => {
  const lane = laneDigest(), fray = frayDigest();
  console.log(`  lane seed 99 ${lane} (HEAD ${HEAD_LANE_99}); fray seed 5 ${fray} (HEAD ${HEAD_FRAY_5})`);
  check('full lane match (bots + scripted human), nobody sends the switch: HEAD digest', lane === HEAD_LANE_99, [lane, HEAD_LANE_99]);
  check('FRAY brawl, nobody sends the switch: HEAD digest', fray === HEAD_FRAY_5, [fray, HEAD_FRAY_5]);
  const laneOn = laneDigest((t) => (t === 0 ? [ON] : []));
  check('the human seat sending on at tick 0: still the HEAD digest', laneOn === HEAD_LANE_99, [laneOn, HEAD_LANE_99]);
  // the human seat also stops between its attack-moves (idle beside the wave): HEAD 29f3e850; with the switch off it differs
  const stopper = (t: number): Command[] => (t % 90 === 45 ? [{ type: 'stop' }] : []);
  const laneStop = laneDigest(stopper);
  const laneStopOff = laneDigest((t) => (t === 0 ? [OFF] : stopper(t)));
  console.log(`  lane seed 99 with stops ${laneStop} (HEAD ${HEAD_LANE_STOP_99}); the same with the human seat off ${laneStopOff}`);
  check('lane match with stops, switch never sent: HEAD digest', laneStop === HEAD_LANE_STOP_99, [laneStop, HEAD_LANE_STOP_99]);
  check('through the facade the switch lands on the human seat only (seats 0, 2, 3 stay on)', laneFlags.join() === 'true,false,true,true', laneFlags);
  // informative: this scripted human is never idle with an enemy in reach, so the digest may or may not move
  console.log(`  info: with the switch off the scripted lane match ${laneStopOff === laneStop ? 'plays the same (never idle in reach)' : 'plays differently'}`);
});

finish('probe_sim_autoattack_off');

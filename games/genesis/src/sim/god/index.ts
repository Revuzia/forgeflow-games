// GENESIS — the god layer's door (CONTRACT.md §11): every god command registered in one place, the god step (what
// runs each tick, hourly and daily), the god parts of a snapshot, and the time controls that act on the Sim itself
// (speed, step, rewind, edit-past).
//
// Cadences (ticks; CONTRACT §6.3): projectiles, disasters and creatures every tick (each cheap when there are none);
// hourly per world (staggered): disaster upkeep (dust settles, radiation fades), disciples' preaching, invented rains;
// rival gods hourly; daily per world: natural disasters, settlements raising creatures, conversions and faith,
// forestry. Rival gods and creatures act through the same registry the player uses.

import type { CommandRegistry } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Command, CommandResult, CreatureView, HandView, MoverBlock, PlanetSnap } from '../types.ts';
import { AnimState } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { registerHandCommands, handView } from './hand.ts';
import { registerMiracleCommands } from './miracles.ts';
import { registerCreatureCommands, creaturesStep, creatureViews, raiseCreatures } from './creature.ts';
import { registerActCommands } from './acts.ts';
import { registerWorldCommands } from './worlds.ts';
import { registerRivalCommands, rivalsStep, faithDaily } from './rivals.ts';
import { registerDiscipleCommands, disciplesHourly } from './disciples.ts';
import { registerPossessionCommands } from './possess.ts';
import { registerInventionCommands, rainsHourly } from './inventions.ts';
import { registerCivicCommands } from './civic.ts';
import { registerShapingCommands, windStep } from './shaping.ts';
import { registerSpaceCommands } from '../space/index.ts';
import { disastersStep, disastersHourly, disasterViews, naturalDisasters } from './disasters.ts';
import { projectilesStep, projectileViews } from './projectiles.ts';
import { installPowerHooks, powersQuery, gesturePowers } from './powers.ts';
import { worshipOf } from './belief.ts';
import { registerGodParams } from './godparams.ts';
import { rebuildContent } from './runtime.ts';
import { GodState } from './state.ts';
import { distM } from '../people/world.ts';
import { r3 } from './util.ts';

/** every god-layer command (called by buildRegistry after the phase-1 and peoples commands) */
export function registerGodCommands(r: CommandRegistry): void {
  registerGodParams();
  registerHandCommands(r);
  registerMiracleCommands(r);
  registerCreatureCommands(r);
  registerActCommands(r);
  registerWorldCommands(r);
  registerRivalCommands(r);
  registerDiscipleCommands(r);
  registerPossessionCommands(r);
  registerInventionCommands(r);
  registerCivicCommands(r);
  registerShapingCommands(r);
  registerSpaceCommands(r); // worlds and space (phase 4): ship.launch / cancel / destroy, star.flare (space/index.ts)
  installPowerHooks(r);
}

/** the god layer's share of a tick (after the worlds have run) */
export function godTick(u: Universe, reg: CommandRegistry, t: number): void {
  const g = u.god;
  if (g.projectiles.length) projectilesStep(u);
  if (g.disasters.length) disastersStep(u);
  if (g.creatures.length) creaturesStep(u);
  if (g.shields.length && t % 10 === 0) g.shields = g.shields.filter((s) => s.until > t);
  if (g.winds.length || Object.keys(g.windsOn).length) windStep(u);
  for (const p of u.planets) {
    if (!p.alive) continue;
    const ts = t + p.id * 17;
    if (ts % 60 === 23) { disastersHourly(u, p); disciplesHourly(u, p); rainsHourly(u, p); }
    const day = Math.max(60, Math.round(p.st.dayHours * 60));
    if (ts % day === 911 % day) { naturalDisasters(u, p); raiseCreatures(u, p); faithDaily(u, p); forestryDaily(u, p); }
  }
  if (t % 60 === 37 && g.gods.length > 1) rivalsStep(u, reg);
}

/** daily: settlements that know forestry tend and replant the woods of their land */
function forestryDaily(u: Universe, p: Planet): void {
  const ps = p.people;
  if (!ps || !ps.settlements.length) return;
  const x = makeCtx(u, p);
  const k = x.rt.byId.get('forestry');
  if (k === undefined) return;
  let any = false;
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band || !st.library.includes(k)) continue;
    for (const c of p.cellsNear(st.pos, st.territory + 150)) {
      if (p.f.water[c] > 0.1 || st.fields.includes(c) || ps.bByCell.get(c).length) continue;
      if (p.f.tree[c] < 0.5 && p.f.treeSpecies[c] >= 0) { p.f.tree[c] = Math.min(0.5, p.f.tree[c] + 0.01); any = true; }
    }
  }
  if (any) { p.bump('tree'); p.vegDirty = true; }
}

// ───────────────────────────── snapshots ─────────────────────────────

/** disasters of a world, and people in the hand or in the air drawn where they are */
export function godSnapPlanet(u: Universe, p: Planet, snap: PlanetSnap): void {
  snap.disasters = disasterViews(u, p);
  const fl = projectileViews(u, p);
  if (fl.length) snap.projectiles = fl;
  if (snap.agents) overlayMovers(u, p, snap.agents);
}

export function godSnapGlobal(u: Universe): { creatures: CreatureView[]; hand: HandView | null } {
  return { creatures: creatureViews(u), hand: handView(u) };
}

function overlayMovers(u: Universe, p: Planet, b: MoverBlock): void {
  const g = u.god;
  const moved: { id: number; pos: ArrayLike<number>; alt: number; anim: number; vel: [number, number, number] }[] = [];
  for (const h of g.hands) if (h.planet === p.id && h.held?.kind === 'agent') moved.push({ id: h.held.id, pos: h.pos, alt: Math.max(0, h.alt - 1.6), anim: AnimState.held, vel: [0, 0, 0] });
  for (const pr of g.projectiles) {
    if (pr.planet !== p.id || pr.payload.kind !== 'agent') continue;
    const c = p.cellAt(pr.pos);
    const k = 60 / p.st.radius;
    moved.push({ id: pr.payload.id, pos: pr.pos, alt: Math.max(0, pr.alt - p.f.surface[c]), anim: AnimState.thrown, vel: [pr.vel[0] * k, pr.vel[1] * k, pr.vel[2] * k] });
  }
  if (!moved.length) return;
  for (let i = 0; i < b.count; i++) {
    const m = moved.find((q) => q.id === b.id[i]);
    if (!m) continue;
    b.pos[i * 3] = m.pos[0]; b.pos[i * 3 + 1] = m.pos[1]; b.pos[i * 3 + 2] = m.pos[2];
    b.vel[i * 3] = m.vel[0]; b.vel[i * 3 + 1] = m.vel[1]; b.vel[i * 3 + 2] = m.vel[2];
    b.alt[i] = m.alt;
    b.anim[i] = m.anim;
  }
}

// ───────────────────────────── queries (inspector, palette, radial, gestures) ─────────────────────────────

export const GOD_QUERIES = ['powers', 'gestures', 'gods', 'creatures', 'creature', 'disasters', 'disaster', 'disaster-kinds', 'hand', 'worship', 'laws', 'inventions', 'shields'];

export function godQuery(u: Universe, q: string, args: Record<string, unknown>): unknown {
  const g = u.god;
  switch (q) {
    case 'powers': return powersQuery(u);
    case 'gestures': return gesturePowers(u.content);
    case 'gods': return g.gods.map((x) => ({ ...x, worship: worshipOf(u, x.id), disciples: g.disciples.filter((d) => d.god === x.id).length }));
    case 'creatures': return g.creatures.filter((c) => c.alive);
    case 'creature': return g.creature(Number(args.id)) ?? null;
    case 'disasters': return g.disasters.map((d) => ({ ...d, name: u.content.disasters.find(d.kind)?.name ?? d.kind }));
    case 'disaster': { const d = g.disaster(Number(args.id)); return d ? { ...d, name: u.content.disasters.find(d.kind)?.name ?? d.kind, def: u.content.disasters.find(d.kind) } : null; }
    case 'disaster-kinds': return u.content.disasters.list;
    case 'hand': return { ...handView(u), state: g.hand(Number(args.god ?? 0)) ?? null };
    case 'worship': return g.gods.map((x) => ({ god: x.id, name: x.name, worship: worshipOf(u, x.id) }));
    case 'laws': return { laws: g.laws, settlements: g.settlementLaws, restraint: u.settings.restraint };
    case 'inventions': return g.runtime;
    case 'shields': return g.shields;
    default: return null;
  }
}

// ───────────────────────────── save / load ─────────────────────────────

/** restore the god state from a save / keyframe header (and the content its inventions made) */
export function godRestore(u: Universe, header: Record<string, unknown>): void {
  u.god = GodState.fromJson(header.god as Parameters<typeof GodState.fromJson>[0]);
  rebuildContent(u);
}

// ───────────────────────────── time controls (they act on the Sim) ─────────────────────────────

/** the Sim surface the time controls need (sim.ts) */
export interface SimLike {
  u: Universe;
  readonly registry: CommandRegistry;
  speed: number;
  readonly tick: number;
  step(ticks: number): void;
  rewind(tick: number): boolean;
  rewindRange(): [number, number];
  applyNow(cmd: Command): CommandResult;
}

type Control = { kind: 'step'; ticks: number } | { kind: 'rewind'; tick: number } | { kind: 'edit'; tick: number; cmd: Command } | { kind: 'speed'; speed: number };

/** the time acts asked for since the last boundary, in order (a sentence may ask for a step and then a pace) */
const pending = new WeakMap<object, Control[]>();
function request(sim: object, c: Control): void {
  const l = pending.get(sim);
  if (l) l.push(c);
  else pending.set(sim, [c]);
}
/** set while a control runs (its own replays must not request more) */
const running = new WeakSet<object>();

/** a command asked for a control (sim.ts: such a command is a time act, not a world act — it is not logged) */
export function controlRequested(sim: object): boolean {
  return pending.has(sim);
}

/** the tick a time command names: tick, or ticksAgo / hoursAgo / daysAgo before now */
function targetTick(u: Universe, p: Planet, a: Record<string, unknown>): number {
  if (typeof a.tick === 'number') return Math.floor(a.tick);
  const day = Math.max(60, Math.round(p.st.dayHours * 60));
  const ago = (Number(a.ticksAgo ?? 0)) + Number(a.hoursAgo ?? 0) * 60 + Number(a.daysAgo ?? 0) * day;
  return Math.max(0, u.tick - Math.round(ago));
}

export function installSimControls(sim: SimLike): void {
  const r = sim.registry;
  r.register('time.speed', ({ u }, a) => {
    const s = Math.max(0, Number(a.speed));
    sim.speed = s;
    u.god.speedRequest = s;
    if (!running.has(sim)) request(sim, { kind: 'speed', speed: s });
    return { ok: true, msg: s === 0 ? 'Time stands still.' : `Time runs at ${s}×.`, control: { speed: s } };
  }, { desc: 'Set the speed of time', category: 'Time', params: { speed: { type: 'number', min: 0, max: 100000, required: true } } });
  r.register('time.step', ({ p }, a) => {
    const day = Math.max(60, Math.round(p.st.dayHours * 60));
    const ticks = Math.round(Number(a.ticks ?? 0) + Number(a.hours ?? 0) * 60 + Number(a.days ?? 0) * day) || 1;
    if (!running.has(sim)) request(sim, { kind: 'step', ticks: Math.min(ticks, 1e6) });
    return { ok: true, msg: `Time moves on ${ticks >= day ? `${r3(ticks / day)} days` : ticks >= 60 ? `${r3(ticks / 60)} hours` : `${ticks} minutes`}.`, control: { step: ticks } };
  }, { desc: 'Step time forward', category: 'Time', params: { ticks: { type: 'int', min: 0, max: 1e6 }, hours: { type: 'number', min: 0, max: 1e5 }, days: { type: 'number', min: 0, max: 1e4 } } });
  const when = { tick: { type: 'int' as const, min: 0 }, ticksAgo: { type: 'number' as const, min: 0 }, hoursAgo: { type: 'number' as const, min: 0 }, daysAgo: { type: 'number' as const, min: 0 } };
  r.register('time.rewind', ({ u, p }, a) => {
    const t = targetTick(u, p, a);
    const [lo] = sim.rewindRange();
    if (t >= u.tick) return { ok: false, msg: 'That moment has not passed yet.' };
    if (t < lo) return { ok: false, msg: `The past before tick ${lo} is gone (the oldest moment kept).` };
    if (!running.has(sim)) request(sim, { kind: 'rewind', tick: t });
    return { ok: true, msg: `Time runs back to tick ${t}.`, control: { rewind: t } };
  }, { desc: 'Rewind time', category: 'Time', params: when });
  r.register('time.edit-past', ({ u, p }, a) => {
    const t = targetTick(u, p, a);
    const inner = a.cmd as Command | undefined;
    if (!inner || typeof inner !== 'object' || typeof inner.k !== 'string') return { ok: false, msg: 'Edit the past with what? Give a command (cmd: { k, ... }).' };
    if (inner.k.startsWith('time.')) return { ok: false, msg: 'Time cannot be edited inside the past.' };
    if (!r.has(inner.k)) return { ok: false, msg: `I do not know how to '${inner.k}'.` };
    const [lo] = sim.rewindRange();
    if (t < lo) return { ok: false, msg: `The past before tick ${lo} is gone (the oldest moment kept).` };
    if (t > u.tick) return { ok: false, msg: 'That moment has not come yet.' };
    if (!running.has(sim)) request(sim, { kind: 'edit', tick: t, cmd: JSON.parse(JSON.stringify(inner)) as Command });
    return { ok: true, msg: `The past is rewritten at tick ${t}: ${inner.k}.`, control: { edit: t } };
  }, { desc: 'Change the past: insert an act at an earlier moment and live the world forward again', category: 'Time', params: { ...when, cmd: { type: 'any', required: true } } });
}

/** run what a control command asked for (after its dispatch, outside the tick); returns a note for the result */
export function runControl(sim: SimLike): string {
  const list = pending.get(sim);
  if (!list) return '';
  pending.delete(sim);
  running.add(sim);
  let note = '';
  try {
    for (const c of list) {
      switch (c.kind) {
        case 'speed': break;
        case 'step': sim.step(c.ticks); break;
        case 'rewind': if (!sim.rewind(c.tick)) note += ' (but the rewind failed)'; break;
        case 'edit': note += editPast(sim, c.tick, c.cmd); break;
      }
    }
  } finally {
    running.delete(sim);
  }
  return note;
}

/**
 * Edit the past: restore the keyframe before `tick`, replay the log to it, apply the new act there, then live the
 * world forward again to the present — the player's later acts re-applied at their own ticks (an act that no longer
 * makes sense in the new history is refused, as it would be live).
 */
function editPast(sim: SimLike, tick: number, cmd: Command): string {
  const now = sim.tick;
  const future = sim.u.log.filter((e) => e.tick >= tick).map((e) => ({ tick: e.tick, cmd: e.cmd }));
  if (!sim.rewind(tick)) return ' (but that moment could not be reached)';
  let i = 0;
  let refused = 0;
  // what the player did at that very tick happened first; the new act comes after it
  while (i < future.length && future[i].tick === sim.tick) { if (!sim.applyNow(future[i].cmd).ok) refused++; i++; }
  const r = sim.applyNow(cmd);
  while (sim.tick < now) {
    while (i < future.length && future[i].tick === sim.tick) { if (!sim.applyNow(future[i].cmd).ok) refused++; i++; }
    sim.step(1);
  }
  while (i < future.length && future[i].tick <= sim.tick) { if (!sim.applyNow(future[i].cmd).ok) refused++; i++; }
  sim.u.chronicleAdd(null, 'god', `The god reached back into the past and changed it (${cmd.k}).`, 2);
  return ` ${r.ok ? r.msg ?? '' : `(the act itself was refused: ${r.msg})`}${refused ? ` ${refused} later act${refused === 1 ? '' : 's'} no longer fit the new history.` : ''}`;
}

export { distM };

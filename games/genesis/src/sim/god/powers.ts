// GENESIS — powers (CONTRACT.md §11.1, §16): powers.json is the player-facing catalogue — every power with its
// category, icon, radial ring, gesture, command + default parameters, a parameter schema for the UI, synonyms for the
// parser, and its restraint cost / cooldown and what witnesses make of it. The palette, the radial menu, gesture
// casting and the freeform parser are generated from it (query 'powers'); a power is data plus, if new, one handler.
//
// This module validates the catalogue against the command registry (every power has a handler, every parameter it
// shows exists on that command), resolves a command back to its power (restraint costs, automatic witnessing), and
// installs the registry hooks that make EVERY god act witnessed and, in restraint mode, paid for.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Command, CommandResult } from '../types.ts';
import type { Content, PowerDef } from '../content.ts';
import type { CommandRegistry, Args } from './commands.ts';
import { witnessCounter } from '../people/culture.ts';
import { godAct, restraintCheck } from './belief.ts';
import { actor } from './util.ts';

/** parameters every command understands without declaring them (places, the world, the actor) */
const UNIVERSAL = new Set(['pos', 'lat', 'lon', 'cell', 'planet', 'god']);

/** problems with the power catalogue against a registry (empty = every power maps to a working handler) */
export function validatePowers(reg: CommandRegistry, c: Content): string[] {
  const out: string[] = [];
  for (const pw of c.powers.list) {
    const sc = reg.schema(pw.command);
    if (!sc) { out.push(`power '${pw.id}': command '${pw.command}' has no handler`); continue; }
    for (const k of [...Object.keys(pw.params ?? {}), ...Object.keys(pw.schema ?? {})]) {
      if (!UNIVERSAL.has(k) && !(k in sc.params)) out.push(`power '${pw.id}': parameter '${k}' is not a parameter of '${pw.command}'`);
    }
  }
  return out;
}

/** the power a command was cast as (the one whose defaults it matches best) */
export function powerOf(c: Content, cmd: Command): PowerDef | undefined {
  let best: PowerDef | undefined, bs = -1;
  for (const pw of c.powers.list) {
    if (pw.command !== cmd.k) continue;
    let s = 0;
    for (const [k, v] of Object.entries(pw.params ?? {})) {
      if (cmd[k] === undefined) continue;
      if (cmd[k] === v) s += 2; else s -= 3;
    }
    if (s > bs) { bs = s; best = pw; }
  }
  return best;
}

/** the command a power issues, with its defaults and the caller's parameters on top */
export function powerCommand(pw: PowerDef, params: Record<string, unknown> = {}): Command {
  return { k: pw.command, ...(pw.params ?? {}), ...params };
}

/** powers by gesture name (gesture casting) */
export function gesturePowers(c: Content): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const pw of c.powers.list) if (pw.gesture) (out[pw.gesture] ??= []).push(pw.id);
  return out;
}

/** the catalogue for the UI (palette / radial / gesture recogniser), with live enum values resolved */
export function powersQuery(u: Universe): Record<string, unknown>[] {
  return u.content.powers.list.map((pw) => ({
    ...pw,
    schema: Object.fromEntries(Object.entries(pw.schema ?? {}).map(([k, s]) => [k, { ...s, values: typeof s.values === 'string' ? registryIds(u, s.values) : s.values }])),
  }));
}

function registryIds(u: Universe, name: string): string[] {
  const reg = (u.content as unknown as Record<string, { ids?: () => string[] }>)[name];
  return reg && typeof reg.ids === 'function' ? reg.ids() : [];
}

/** commands that are camera / client / system plumbing, not god acts (never charged, never witnessed) */
// ('time.scale' is the worker's logged speed level — perf/lapse.ts: a speed preset change is not a god act; SIM perf
// push 3)
const PLUMBING = new Set(['focus', 'hand.move', 'hand.pose', 'freeform', 'set', 'meta.restraint', 'meta.save', 'meta.load', 'time.speed', 'time.step', 'time.rewind', 'time.edit-past', 'time.scale']);

/** install the registry hooks: restraint before, witnessing after (idempotent per registry) */
export function installPowerHooks(reg: CommandRegistry): void {
  const marks: number[] = [];
  reg.before.push((u: Universe, cmd: Command, p: Planet): CommandResult | null => {
    marks.push(witnessCounter.n);
    if (PLUMBING.has(cmd.k)) return null;
    const why = restraintCheck(u, powerOf(u.content, cmd), actor(cmd), p);
    if (why) { marks.pop(); return { ok: false, msg: why }; }
    return null;
  });
  reg.after.push((u: Universe, cmd: Command, p: Planet, res: CommandResult, a: Args) => {
    const mark = marks.pop() ?? witnessCounter.n;
    if (!res.ok || PLUMBING.has(cmd.k)) return;
    u.god.stat('acts');
    // the handler let people see it already: nothing more to do
    if (witnessCounter.n !== mark) return;
    const pw = powerOf(u.content, cmd);
    const w = pw?.witness;
    if (!w) return;
    // an act with a place is seen around it; a world-wide act (air, the star, the laws) by everyone on the world
    const pos = a.pos as number[] | null | undefined;
    const R = pos ? w.radius ?? 500 : Math.PI * p.st.radius * 1.01;
    godAct(u, p, pos ?? [0, 0, 1], R, { help: w.help, harm: w.harm, wonder: w.wonder }, actor(cmd));
  });
}

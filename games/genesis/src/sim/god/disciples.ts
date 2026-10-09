// GENESIS — disciples (CONTRACT.md §11.1, pillar 4): people made the god's own carry its will before their own wants
// (only hunger, thirst, cold and exhaustion come first). A standing order per disciple:
//
//   worship     pray at the temple (worship flows to their god all day)
//   farm        work the fields (the farmer's role, held)
//   build       raise the village's buildings (the builder's role, held)
//   teach       teach what they know (the teacher's role, held)
//   preach      preach at the temple: those who hear grow in faith toward the disciple's god — and away from others
//   missionary  walk to another settlement and preach there until it turns
//
// Rival gods make disciples the same way (they act through the same commands). Conversions are chronicled when a
// settlement's god changes (rivals.ts).

import type { CommandRegistry } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { PCtx } from '../people/ctx.ts';
import type { Settlement } from '../people/state.ts';
import type { TaskSpec } from '../people/tasks.ts';
import type { DiscipleOrder } from './state.ts';
import { AgentFlag } from '../types.ts';
import { GODS, MEMK, ROLE, TASK } from '../people/defs.ts';
import { makeCtx } from '../people/ctx.ts';
import { godHooks } from '../people/hooks.ts';
import { interrupt } from '../people/people.ts';
import { tell } from '../people/story.ts';
import { agentName, agentRef, settlementRef, vars } from '../people/util.ts';
import { distM, spotInCell } from '../people/world.ts';
import { actor, fail, ok } from './util.ts';
import { godAct } from './belief.ts';

export const DISCIPLE_MODES = ['worship', 'farm', 'build', 'teach', 'preach', 'missionary'] as const;

const ROLE_OF: Record<string, number> = { farm: ROLE.farmer, build: ROLE.builder, teach: ROLE.teacher, worship: ROLE.priest, preach: ROLE.priest, missionary: ROLE.priest };

function orderOf(u: Universe, p: Planet, agent: number): DiscipleOrder | undefined {
  return u.god.disciples.find((d) => d.agent === agent && d.planet === p.id);
}

function templeOf(x: PCtx, st: Settlement) {
  return x.ps.of(st.id).find((b) => b.progress >= 1 && b.damage < 0.9 && x.c.buildings.list[b.type].function === 'temple');
}

/** decide.ts hook: a disciple's task by its order (null: the order is served by its role this turn) */
function discipleTask(x: PCtx, s: number, st: Settlement | undefined, night: boolean): TaskSpec | null {
  const o = orderOf(x.u, x.p, x.A.id[s]);
  if (!o || night) return null;
  const A = x.A;
  // the order holds the role (the settlement's hourly roles would otherwise take it back)
  const role = ROLE_OF[o.mode];
  if (role !== undefined) A.role[s] = role;
  // every other turn they live their own life a little (eat, talk, sleep): the god's will is most of the day, not all
  if ((x.tick + A.id[s]) % 3 === 0) return null;
  switch (o.mode) {
    case 'worship':
    case 'preach': {
      if (!st) return null;
      const t = templeOf(x, st);
      const kind = o.mode === 'preach' ? TASK.preach : t ? TASK.worship : TASK.pray;
      if (t) return { kind, goal: spotInCell(x.p, t.cell, A.id[s], 0xd15, [0, 0, 0]), goalCell: t.cell, work: 90, target: t.id };
      return { kind, goal: spotInCell(x.p, st.cell, A.id[s], 0xd16, [0, 0, 0]), goalCell: st.cell, work: 90 };
    }
    case 'missionary': {
      const target = x.ps.settlement(o.target);
      if (!target || target.fallen >= 0) return null;
      return { kind: TASK.preach, goal: spotInCell(x.p, target.cell, A.id[s], 0xd17, [0, 0, 0]), goalCell: target.cell, work: 150, target: target.id };
    }
    default:
      return null; // farm / build / teach: their held role does it through the ordinary work planner
  }
}

godHooks.disciple = discipleTask;

/**
 * Hourly: preaching converts. Everyone within earshot of a disciple at work preaching (or a missionary at its target)
 * grows in love for the disciple's god and cools toward the others; a missionary whose target now believes goes home.
 */
export function disciplesHourly(u: Universe, p: Planet): void {
  const list = u.god.disciples.filter((d) => d.planet === p.id);
  if (!list.length || !p.people) return;
  const x = makeCtx(u, p);
  const A = x.A;
  const pt = [0, 0, 0], q = [0, 0, 0];
  for (const d of list) {
    const s = A.slotOf(d.agent);
    if (s < 0) { u.god.disciples = u.god.disciples.filter((o) => o !== d); continue; }
    if (!(A.flags[s] & AgentFlag.disciple)) A.flags[s] |= AgentFlag.disciple;
    if (A.task[s] !== TASK.preach && A.task[s] !== TASK.worship && A.task[s] !== TASK.pray) continue;
    A.posAt(s, u.tick, pt);
    const g = Math.max(0, Math.min(GODS - 1, d.god));
    let heard = 0;
    for (let o = 0; o < A.hi; o++) {
      if (!A.alive[o] || o === s) continue;
      A.posAt(o, u.tick, q);
      if (distM(p, pt, q) > 70) continue;
      const i = o * GODS;
      A.love[i + g] = Math.min(1, Math.round((A.love[i + g] + (A.task[s] === TASK.preach ? 0.03 : 0.01)) * 1e4) / 1e4);
      for (let k = 0; k < GODS; k++) if (k !== g) A.love[i + k] = Math.round(A.love[i + k] * 0.985 * 1e4) / 1e4;
      if (A.love[i + g] > 0.5 && hashed(A.id[o], u.tick) < 0.02) A.remember(o, MEMK.converted, u.tick, g);
      heard++;
    }
    d.converted += heard;
    if (d.mode === 'missionary') {
      const t = x.ps.settlement(d.target);
      if (t && t.god === g) {
        tell(u, p, 'disciple.converted', vars(x, t, s, { god: u.god.god(g)?.name ?? 'the god', text: `${agentName(x, s)} preached in ${t.name} until it turned to ${u.god.god(g)?.name ?? 'the god'}.` }), t, [agentRef(x, s), settlementRef(x, t)], 2);
        d.mode = 'preach';
        d.target = -1;
      }
    }
  }
}

function hashed(a: number, b: number): number {
  return (((a * 2654435761) ^ (b * 40503)) >>> 0) / 4294967296;
}

export function registerDiscipleCommands(r: CommandRegistry): void {
  // agent.make-disciple (people/commands.ts) for the player; this version takes any god and a standing order
  r.register('agent.make-disciple', ({ u, p, cmd }, a) => {
    const g = actor(cmd);
    const x = makeCtx(u, p);
    const s = x.A.slotOf(a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const A = x.A;
    A.flags[s] |= AgentFlag.disciple | AgentFlag.sees_god;
    A.love[s * GODS + g] = 1;
    for (let k = 0; k < GODS; k++) if (k !== g) A.love[s * GODS + k] = Math.round(A.love[s * GODS + k] * 0.3 * 1e4) / 1e4;
    A.remember(s, MEMK.disciple, u.tick, 0);
    const mode = String(a.mode ?? 'preach');
    const st = x.ps.settlement(A.settlement[s]);
    let target = -1;
    if (mode === 'missionary') {
      const tgt = typeof a.target === 'number' ? x.ps.settlement(a.target) : x.ps.settlements.filter((o) => o.fallen < 0 && !o.band && o.id !== st?.id && o.god !== g).sort((q, w) => distM(p, q.pos, st?.pos ?? q.pos) - distM(p, w.pos, st?.pos ?? w.pos) || q.id - w.id)[0];
      target = tgt?.id ?? -1;
    }
    u.god.disciples = u.god.disciples.filter((d) => d.agent !== (a.id as number));
    u.god.disciples.push({ agent: a.id as number, planet: p.id, god: g, mode, target, since: u.tick, converted: 0 });
    if (st) tell(u, p, 'disciple', vars(x, st, s), st, [agentRef(x, s)]);
    interrupt(x, s);
    const pt = [0, 0, 0];
    A.posAt(s, u.tick, pt);
    godAct(u, p, pt, 150, { wonder: 0.3 }, g);
    const gname = g === 0 ? 'your' : `${u.god.god(g)?.name ?? 'a rival'}'s`;
    return ok(`${agentName(x, s)} becomes ${gname} disciple (${mode}${target >= 0 ? ` to ${x.ps.settlement(target)?.name}` : ''}).`);
  }, {
    desc: 'Make a disciple (with a standing order)', category: 'Peoples',
    params: { id: { type: 'int', required: true, min: 1 }, mode: { type: 'enum', values: [...DISCIPLE_MODES], default: 'preach' }, target: { type: 'int', min: 0, desc: 'missionary: a settlement id' } },
  });
  r.register('disciple.order', ({ u, p, cmd }, a) => {
    const g = actor(cmd);
    const x = makeCtx(u, p);
    const list = typeof a.id === 'number' ? u.god.disciples.filter((d) => d.agent === a.id) : u.god.disciples.filter((d) => d.god === g && d.planet === p.id);
    if (!list.length) return fail('There is no such disciple. Make one first (agent.make-disciple).');
    for (const d of list) {
      d.mode = String(a.mode);
      if (d.mode === 'missionary') d.target = typeof a.target === 'number' ? a.target : d.target;
      const s = x.A.slotOf(d.agent);
      if (s >= 0) interrupt(x, s);
    }
    return ok(`${list.length} disciple${list.length === 1 ? '' : 's'}: ${a.mode}.`);
  }, { desc: 'Give disciples a standing order', category: 'Peoples', params: { id: { type: 'int', min: 1 }, mode: { type: 'enum', values: [...DISCIPLE_MODES], required: true }, target: { type: 'int', min: 0 } } });
}

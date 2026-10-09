// GENESIS — possession (CONTRACT.md §11.1 agents: possess): the player drives a person. agent.possess marks them; the
// god then ORDERS them — possess.move (walk there) and possess.act (gather, chop wood, fish, hunt, build, pray, preach,
// teach, eat, drink, sleep, dance, fight, rest). Orders queue and are carried out one after another by the person's
// own body (their walk speed, their skills, their needs still felt); with no orders left they stand and wait. The
// people around see the god in them (wonder). Released, they are their own again.

import type { CommandRegistry, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { PCtx } from '../people/ctx.ts';
import type { TaskSpec } from '../people/tasks.ts';
import type { PossessionState, V3 } from './state.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { TASK } from '../people/defs.ts';
import { makeCtx } from '../people/ctx.ts';
import { godHooks } from '../people/hooks.ts';
import { interrupt } from '../people/people.ts';
import { agentName } from '../people/util.ts';
import { distM, spotInCell } from '../people/world.ts';
import { planGather, planFish, planDrinkNear } from '../people/decide.ts';
import { herdPos } from '../life/herds.ts';
import { godAct } from './belief.ts';
import { actor, fail, norm, ok } from './util.ts';

export const ACTS = ['gather', 'wood', 'fish', 'hunt', 'build', 'pray', 'preach', 'teach', 'eat', 'drink', 'sleep', 'dance', 'fight', 'rest', 'explore'] as const;

function stateOf(u: Universe, agent: number): PossessionState | undefined {
  return u.god.possession.find((q) => q.agent === agent);
}

/** the next task of a possessed agent (decide.ts hook) */
function nextOrder(x: PCtx, s: number): TaskSpec | null {
  const u = x.u;
  const ps = stateOf(u, x.A.id[s]);
  if (!ps || !ps.orders.length) return null;
  const o = ps.orders.shift()!;
  const A = x.A;
  const st = x.ps.settlement(A.settlement[s]);
  const here = A.cell[s];
  const at = (c: number, salt: number) => spotInCell(x.p, c, A.id[s], salt, [0, 0, 0]);
  if (o.kind === 'move' && o.pos) {
    const c = x.p.cellAt(o.pos);
    return { kind: TASK.possessed, goal: [o.pos[0], o.pos[1], o.pos[2]], goalCell: c, work: 10 };
  }
  switch (o.act) {
    case 'gather': return planGather(x, s, st, true) ?? { kind: TASK.forage, goal: null, goalCell: here, work: 60 };
    case 'wood': {
      for (const c of [here, ...x.p.cellsNear(x.p.grid.pos.subarray(here * 3, here * 3 + 3), 300)]) if (x.p.f.tree[c] > 0.15) return { kind: TASK.chop, goal: at(c, 3), goalCell: c, work: 90, data: x.c.items.idx('wood') };
      return null;
    }
    case 'fish': return planFish(x, s, st);
    case 'hunt': {
      const pt = [0, 0, 0];
      let best = -1, bd = 1500, bp: number[] | null = null;
      A.posAt(s, x.tick, pt);
      for (const h of x.ps.herds) { const hp = [0, 0, 0]; herdPos(h, x.tick, hp); const d = distM(x.p, hp, pt); if (d < bd && h.owner < 0) { bd = d; best = h.id; bp = hp; } }
      if (best < 0 || !bp) return null;
      return { kind: TASK.hunt, goal: bp, goalCell: x.p.cellAt(bp), work: 90, target: best };
    }
    case 'build': {
      if (!st) return null;
      const b = st.sites.map((id) => x.ps.building(id)).find((q) => q && !(q.flags & BuildingFlag.ruined));
      if (!b) return null;
      return { kind: TASK.build, goal: [b.pos[0], b.pos[1], b.pos[2]], goalCell: b.cell, work: 120, target: b.id, data2: 0 };
    }
    case 'pray': return { kind: TASK.pray, goal: null, goalCell: here, work: 40 };
    case 'preach': return { kind: TASK.preach, goal: null, goalCell: here, work: 90 };
    case 'teach': {
      const members = st ? x.ps.members.get(st.id) ?? [] : [];
      const l = members.find((m) => m !== s && !(A.flags[m] & AgentFlag.child));
      if (l === undefined) return null;
      // the most valuable idea the pupil lacks
      let k = -1;
      for (let q = 0; q < x.rt.n; q++) if (A.knows(s, q) && !A.knows(l, q)) { k = q; break; }
      if (k < 0) return null;
      const lp = [0, 0, 0];
      A.posAt(l, x.tick, lp);
      return { kind: TASK.teach, goal: lp, goalCell: x.p.cellAt(lp), work: 90, target: A.id[l], data: k };
    }
    case 'eat': return { kind: TASK.eat, goal: null, goalCell: here, work: 20 };
    case 'drink': return planDrinkNear(x, s, -1);
    case 'sleep': return { kind: TASK.sleep, goal: null, goalCell: here, work: 240 };
    case 'dance': return { kind: TASK.socialize, goal: null, goalCell: here, work: 40 };
    case 'fight': return { kind: TASK.fight, goal: null, goalCell: here, work: 30 };
    case 'explore': {
      const c = x.p.grid.nbr[x.p.grid.nbrStart[here] + (x.tick % Math.max(1, x.p.grid.nbrStart[here + 1] - x.p.grid.nbrStart[here]))];
      return { kind: TASK.explore, goal: at(c, 9), goalCell: c, work: 30 };
    }
    default: return { kind: TASK.idle, goal: null, goalCell: here, work: 30 };
  }
}

function heldOrFlying(x: PCtx, s: number): boolean {
  return x.u.god.isHeld('agent', x.A.id[s]);
}

godHooks.possessed = nextOrder;
godHooks.held = heldOrFlying;

/** the agent a possession command means: the id given, else the one the actor possesses */
function who(u: Universe, a: Record<string, unknown>, god: number): number {
  if (typeof a.id === 'number') return a.id;
  const ps = u.god.possession.find((q) => q.god === god);
  return ps ? ps.agent : -1;
}

const pPos: ParamSchema = { type: 'pos', desc: 'where (unit vector or lat/lon)' };

export function registerPossessionCommands(r: CommandRegistry): void {
  // agent.possess (people/commands.ts) sets the flag; this wraps it to keep the order queue
  const base = r.handlerOf('agent.possess');
  const schema = r.schema('agent.possess');
  if (base && schema) {
    r.register('agent.possess', (ctx, a) => {
      const res = base(ctx, a);
      if (!res.ok) return res;
      const { u, p, cmd } = ctx;
      const g = actor(cmd);
      const id = a.id as number;
      u.god.possession = u.god.possession.filter((q) => q.agent !== id && (a.on === false || q.god !== g));
      if (a.on !== false) {
        u.god.possession.push({ agent: id, planet: p.id, god: g, orders: [] });
        const x = makeCtx(u, p);
        const s = x.A.slotOf(id);
        if (s >= 0) { const pt = [0, 0, 0]; x.A.posAt(s, u.tick, pt); godAct(u, p, pt, 150, { wonder: 0.3 }, g); }
      }
      return res;
    }, schema);
  }
  r.register('possess.move', ({ u, p, cmd }, a) => {
    const g = actor(cmd);
    const id = who(u, a, g);
    const ps = stateOf(u, id);
    const x = makeCtx(u, p);
    const s = x.A.slotOf(id);
    if (!ps || s < 0 || !(x.A.flags[s] & AgentFlag.possessed)) return fail('Possess someone first (agent.possess).');
    const to = norm(a.pos as V3);
    if (a.queue !== true) ps.orders = [];
    ps.orders.push({ kind: 'move', pos: to, act: '', target: -1 });
    if (a.queue !== true) interrupt(x, s);
    const pt = [0, 0, 0];
    x.A.posAt(s, u.tick, pt);
    return ok(`${agentName(x, s)} walks where you will (${Math.round(distM(p, pt, to))} m).`);
  }, { desc: 'Walk the possessed person somewhere', category: 'Peoples', params: { id: { type: 'int', min: 1 }, pos: { ...pPos, required: true }, queue: { type: 'boolean', default: false } } });
  r.register('possess.act', ({ u, p, cmd }, a) => {
    const g = actor(cmd);
    const id = who(u, a, g);
    const ps = stateOf(u, id);
    const x = makeCtx(u, p);
    const s = x.A.slotOf(id);
    if (!ps || s < 0 || !(x.A.flags[s] & AgentFlag.possessed)) return fail('Possess someone first (agent.possess).');
    if (a.queue !== true) ps.orders = [];
    // walk somewhere first only when a place was named (an unnamed place resolves to the camera focus)
    const named = cmd.pos !== undefined || (cmd.lat !== undefined && cmd.lon !== undefined) || cmd.cell !== undefined;
    if (a.pos && named) ps.orders.push({ kind: 'move', pos: norm(a.pos as V3), act: '', target: -1 });
    ps.orders.push({ kind: 'act', pos: null, act: String(a.act), target: typeof a.target === 'number' ? a.target : -1 });
    if (a.queue !== true) interrupt(x, s);
    return ok(`${agentName(x, s)} will ${a.act}${a.pos && named ? ' there' : ''}.`);
  }, {
    desc: 'Make the possessed person do something', category: 'Peoples',
    params: { id: { type: 'int', min: 1 }, act: { type: 'enum', values: [...ACTS], required: true }, pos: pPos, target: { type: 'int' }, queue: { type: 'boolean', default: false } },
  });
}

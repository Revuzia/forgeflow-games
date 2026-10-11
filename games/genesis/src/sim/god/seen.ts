// GENESIS — the god walks among them (CONTRACT.md §15.8 walk mode). `god.seen` { planet, pos, radius } is sent by the
// App every couple of seconds while the player's luminous body walks near people (render/camera/walk.ts onSeen, the
// render lane's walk camera). Everyone within sight sees the god — a little wonder, love and fear by each one's faith
// (people/culture.ts witness) — and reacts by what they feel:
//
//   believers   (love well above fear) kneel and pray where they stand (the prayer adds worship like any other)
//   the fearful (fear above love) run from the body, some tens of metres away
//   the rest    stop what they are doing and stare a while
//
// Those asleep under a roof, at sea, on a mission (a caravan, a crew), possessed, held by a hand, fighting or already
// fleeing / praying are left alone. Deterministic: only the command's arguments and the agents' own state decide; the
// small variations come from hashFloat of the agent id and the tick. Plumbing for the registry's power hooks (it
// neither counts as an act nor moves the god's alignment: being seen is not a miracle).

import type { CommandRegistry } from './commands.ts';
import type { UnitVec } from '../types.ts';
import { AgentFlag } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { witness } from '../people/culture.ts';
import { interrupt } from '../people/people.ts';
import { startTask } from '../people/tasks.ts';
import { GODS, TASK } from '../people/defs.ts';
import { hashFloat } from '../core/rng.ts';
import { actor, fail, norm, ok } from './util.ts';

/** the wonder of one sighting (small: it comes every couple of seconds while the god walks there) */
const SEEN_WONDER = 0.05;

/** tasks a sighting does not break off */
const KEEP = new Set<number>([TASK.flee, TASK.pray, TASK.worship, TASK.fight, TASK.sleep, TASK.sail, TASK.launch, TASK.board, TASK.possessed, TASK.migrate, TASK.found]);

export interface SeenTally { seen: number; pray: number; flee: number; stare: number }

/** the people within `radius` metres of `pos` see the god and react; returns who did what */
export function godSeen(u: Parameters<typeof makeCtx>[0], p: Parameters<typeof makeCtx>[1], pos: ArrayLike<number>, radius: number, god: number): SeenTally {
  const out: SeenTally = { seen: 0, pray: 0, flee: 0, stare: 0 };
  const ps = p.people;
  if (!ps || ps.agents.count === 0) return out;
  out.seen = witness(p, pos, radius, 'wonder', SEEN_WONDER, god);
  const x = makeCtx(u, p);
  const A = x.A;
  const g = Math.max(0, Math.min(GODS - 1, god | 0));
  const R = p.st.radius;
  const pt = [0, 0, 0];
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    if (A.inside[s] >= 0 || A.boat[s] >= 0 || A.mission[s]) continue;
    if (A.flags[s] & AgentFlag.possessed || u.god.isHeld('agent', A.id[s])) continue;
    if (KEEP.has(A.task[s])) continue;
    A.posAt(s, x.tick, pt);
    const d0 = pt[0] * pos[0] + pt[1] * pos[1] + pt[2] * pos[2];
    const d = Math.acos(d0 > 1 ? 1 : d0 < -1 ? -1 : d0) * R;
    if (d > radius) continue;
    const love = A.love[s * GODS + g], fear = A.fear[s * GODS + g];
    const h = hashFloat(A.id[s], x.tick, 0x5ee);
    if (fear > love + 0.1 && fear > 0.2) {
      // away from the body: along the ground, 25–45 m
      let ax = pt[0] - pos[0], ay = pt[1] - pos[1], az = pt[2] - pos[2];
      const dot = ax * pt[0] + ay * pt[1] + az * pt[2];
      ax -= pt[0] * dot; ay -= pt[1] * dot; az -= pt[2] * dot;
      let l = Math.hypot(ax, ay, az);
      if (l < 1e-9) { ax = 1 - Math.abs(pt[0]) > 0.1 ? 1 : 0; ay = ax ? 0 : 1; az = 0; l = 1; }
      const step = (25 + 20 * h) / R;
      const goal = norm([pt[0] + (ax / l) * step, pt[1] + (ay / l) * step, pt[2] + (az / l) * step]);
      const cell = x.p.cellAt(goal);
      if (!x.p.s.ocean[cell]) {
        interrupt(x, s);
        startTask(x, s, { kind: TASK.flee, goal: [goal[0], goal[1], goal[2]], goalCell: cell, work: 12 + Math.round(10 * h) });
        out.flee++;
        continue;
      }
    }
    if (love > 0.25 && love > fear + 0.05) {
      interrupt(x, s);
      startTask(x, s, { kind: TASK.pray, goal: null, goalCell: A.cell[s], work: 24 + Math.round(20 * h) });
      out.pray++;
      continue;
    }
    // the rest stop and stare (a short rest where they stand: they look on, then go back to what they were doing)
    if (A.task[s] !== TASK.idle) {
      interrupt(x, s);
      startTask(x, s, { kind: TASK.idle, goal: null, goalCell: A.cell[s], work: 8 + Math.round(8 * h) });
      out.stare++;
    }
  }
  return out;
}

export function registerSeenCommands(r: CommandRegistry): void {
  r.register('god.seen', ({ u, p, cmd }, a) => {
    const at = a.pos as UnitVec | null | undefined;
    if (!at) return fail('Where were you seen?');
    const radius = Math.max(5, Math.min(250, Number(a.radius ?? 40)));
    const t = godSeen(u, p, at, radius, actor(cmd));
    if (!t.seen) return ok('No one is near enough to see you.');
    const parts: string[] = [];
    if (t.pray) parts.push(`${t.pray} kneel${t.pray === 1 ? 's' : ''} and pray${t.pray === 1 ? 's' : ''}`);
    if (t.flee) parts.push(`${t.flee} run${t.flee === 1 ? 's' : ''} from you`);
    if (t.stare) parts.push(`${t.stare} stop${t.stare === 1 ? 's' : ''} and stare${t.stare === 1 ? 's' : ''}`);
    return ok(`${t.seen} see${t.seen === 1 ? 's' : ''} you walk among them${parts.length ? `: ${parts.join(', ')}` : ''}.`);
  }, { desc: 'Walk among them (be seen by the people near the body)', category: 'Meta', params: { pos: { type: 'pos', required: true, desc: 'where the body stands' }, radius: { type: 'number', min: 5, max: 250, default: 40 } } });
}

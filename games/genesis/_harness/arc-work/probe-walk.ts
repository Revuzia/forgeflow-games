// stint 6: trace tower builders' walks (babel seed): per builder task, ticks walking, ticks at work, how it ended
import { Sim } from '../../src/sim/sim.ts';
import { distM } from '../../src/sim/people/world.ts';
import { TASK, TASK_NAMES } from '../../src/sim/people/defs.ts';
const [seedS = '1', yearsS = '0.5'] = process.argv.slice(2);
const sim = new Sim({ seed: Number(seedS), scenario: 'babel', overrides: { n: 20 } });
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
const end = sim.u.tick + Math.round(Number(yearsS) * year);
const P = [0, 0, 0];
const cur = new Map<number, { t0: number; walk: number; work: number; d0: number }>();
let n = 0; const ends: Record<string, number> = {}; let walkSum = 0, workSum = 0, d0Sum = 0; const spd: number[] = [];
const prevPos = new Map<number, number[]>();
while (sim.u.tick < end) {
  sim.step(5);
  const tw = sim.u.god.rel?.towers?.find((t) => t.status === 'rising');
  if (!tw) continue;
  for (const sid of tw.league) for (const s of ps.members.get(sid) ?? []) {
    const id = A.id[s];
    const c = cur.get(id);
    const onTw = A.task[s] === TASK.build && A.tTarget[s] === tw.building;
    A.posAt(s, sim.u.tick, P);
    if (onTw) {
      const d = distM(p, P, tw.pos);
      if (!c) cur.set(id, { t0: sim.u.tick, walk: 0, work: 0, d0: d });
      else if (A.phase[s] === 0) { c.walk += 5; const q = prevPos.get(id); if (q) spd.push(distM(p, P, q) / 5); } else c.work += 5;
      prevPos.set(id, [...P]);
    } else if (c) {
      cur.delete(id); n++; walkSum += c.walk; workSum += c.work; d0Sum += c.d0;
      const k = TASK_NAMES[A.task[s]] ?? '?'; ends[k] = (ends[k] ?? 0) + 1;
    }
  }
}
spd.sort((a, b) => a - b);
console.log('SUM', JSON.stringify({ day, tasks: n, meanWalk: Math.round(walkSum / n), meanWork: Math.round(workSum / n), meanD0: Math.round(d0Sum / n), medSpeedMperTick: spd[spd.length >> 1]?.toFixed(2), endedInto: ends }));

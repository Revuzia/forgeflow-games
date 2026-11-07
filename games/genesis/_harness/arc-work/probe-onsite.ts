// T4 on-site diagnosis (stint 6): babel <seed> [years]; at daylight samples at the tower, what are the host's chosen
// builders doing? one D line per sample, a summary at the end.
import { Sim } from '../../src/sim/sim.ts';
import { distM } from '../../src/sim/people/world.ts';
import { TASK, TASK_NAMES } from '../../src/sim/people/defs.ts';
import { AgentFlag } from '../../src/sim/types.ts';
import { sunElevation } from '../../src/sim/people/world.ts';
import { hashFloat } from '../../src/sim/core/rng.ts';
import { TOWER } from '../../src/sim/god/tower.ts';
const [seedS = '1', yearsS = '0.6'] = process.argv.slice(2);
if (process.env.SHIFT) TOWER.shift = Number(process.env.SHIFT);
const sim = new Sim({ seed: Number(seedS), scenario: 'babel', overrides: { n: 20 } });
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
const end = sim.u.tick + Math.round(Number(yearsS) * year);
let samples = 0, on = 0;
const why: Record<string, number> = {};
const P = [0, 0, 0];
while (sim.u.tick < end) {
  sim.step(Math.round(day / 24));
  const tw = sim.u.god.rel?.towers?.find((t) => t.status === 'rising');
  if (!tw || sunElevation(sim.u, p, sim.u.tick, tw.pos) <= 0.35) continue;
  samples++;
  const mem = (ps.members.get(tw.host) ?? []).filter((s) => !(A.flags[s] & AgentFlag.child));
  const period = process.env.PERIOD !== 'd' ? Math.floor(sim.u.tick / (day / 4)) : Math.floor(sim.u.tick / day);
  let sel = 0, onS = 0, buildAny = 0; const tk: Record<string, number> = {};
  for (const sid of tw.league) for (const s of ps.members.get(sid) ?? []) {
    if (A.task[s] !== TASK.build) continue; buildAny++;
    A.posAt(s, sim.u.tick, P); if (distM(p, P, tw.pos) < 150) onS++;
  }
  for (const s of mem) {
    if (hashFloat(A.id[s], period, 0x70eb) >= TOWER.visible / Math.max(1, mem.length)) continue;
    sel++; let n = TASK_NAMES[A.task[s]] ?? String(A.task[s]);
    if (A.task[s] === TASK.build) { A.posAt(s, sim.u.tick, P); n += (A.tTarget[s] === tw.building ? ':tw' : ':other') + ':ph' + A.phase[s] + ':' + (distM(p, P, tw.pos) < 150 ? 'near' : Math.round(distM(p, P, tw.pos) / 100) * 100 + 'm'); }
    tk[n] = (tk[n] ?? 0) + 1;
  }
  if (onS) on++; else for (const [k, v] of Object.entries(tk)) why[k] = (why[k] ?? 0) + v;
  if (samples % 12 === 0) console.log('D', JSON.stringify({ y: +(sim.u.tick / year).toFixed(2), hostAdults: mem.length, sel, onS, buildAny, tk }));
}
console.log('SUM', JSON.stringify({ samples, onPct: Math.round(100 * on / samples), selTasksWhenEmpty: why }));

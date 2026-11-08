// B-sim debug probe: hurl under a painted storm (node _harness/arc-work/B-sim-dbg.ts)
import { town, must } from '../../tests/helpers/god.ts';
import { srel } from '../../src/sim/god/regard.ts';
import { defyRoll } from '../../src/sim/god/defiance.ts';
import { NT, TRAIT } from '../../src/sim/people/defs.ts';
const { sim, st } = town();
const p = sim.u.planets[0];
must(sim, { k: 'defiance.set', settlement: st.id, value: 0.8 } as never);
const res = must(sim, { k: 'weather.paint', kind: 'thunderstorm', pos: [st.pos[0], st.pos[1], st.pos[2]], radius: 900, duration: 6 * 1440, pinned: true } as never);
console.log('created', JSON.stringify(res.created), 'dayH', p.st.dayHours);
const r = srel(sim.u, p.id, st.id);
console.log('since', JSON.stringify(r.since));
const A = p.people.agents;
const bold = (p.people.members.get(st.id) ?? []).filter((s) => A.traits[s * NT + TRAIT.boldness] >= 0.6).length;
console.log('bold', bold, 'members', p.people.members.get(st.id)?.length);
const day = Math.max(60, Math.round(p.st.dayHours * 60));
for (let d = 0; d < 4; d++) console.log('roll', d, defyRoll(sim.u.seed, st.id, Math.floor(sim.u.tick / day) + d, 'hurl'));
// --- hurl then what closes the window
must(sim, { k: 'pride.set', settlement: st.id, value: 0.7 } as never);
sim.drainEvents();
for (let i = 0; i < 6 * 24 * 5; i++) {
  sim.step(10);
  const ev = sim.drainEvents() as { t: string; data?: Record<string, unknown> }[];
  for (const e of ev) if (e.t === 'defy' || e.t === 'defy.answered') console.log(sim.u.tick, e.t, JSON.stringify(e.data), JSON.stringify(r.acts.slice(-2)));
  if (ev.some((e) => e.t === 'defy.answered')) break;
}

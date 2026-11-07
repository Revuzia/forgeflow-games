// ARC §10.3 probe (forced-flood form): on 8 seeds, a bronze-age town of 30; three natural floods each (spawned at the
// town, god -1, cause nature), once with the river's warning as built and once with the warning cut at spawn (Wn = 0,
// orders withdrawn: the pre-change baseline). Reports per seed: evacuated share at the water (members beyond the danger
// radius or on the evacuate task), flood deaths warned vs unwarned.
// Run: setsid nohup _harness/slot.sh node _harness/arc-work/probe-flood.ts > _harness/scratch/arc/flood.log 2>&1 &
import { Sim } from '../../src/sim/sim.ts';
import { spawnDisaster } from '../../src/sim/god/disasters.ts';
import { dangerRadius } from '../../src/sim/god/precursors.ts';
import { srel } from '../../src/sim/god/regard.ts';
import { distM } from '../../src/sim/people/world.ts';
import { TASK } from '../../src/sim/people/defs.ts';
import { makeCtx } from '../../src/sim/people/ctx.ts';

function must(sim: Sim, cmd: Record<string, unknown>) {
  const r = sim.applyNow(cmd as never);
  if (!r.ok) throw new Error(`${cmd.k}: ${r.msg}`);
  return r;
}

function base(seed: number): { bytes: Uint8Array; sid: number } {
  const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true, wildGame: false });
  const sid = r.created!.find((e) => e.kind === 'settlement')!.id;
  sim.step(60);
  return { bytes: sim.save(), sid };
}

function one(bytes: Uint8Array, sid: number, k: number, warned: boolean): { out: number; n: number; dead: number; Wn: number } {
  const sim = Sim.load(bytes);
  const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
  sim.step(k * 997);
  const st = ps.settlement(sid)!;
  const ids = (ps.members.get(st.id) ?? []).map((s) => A.id[s]);
  const d = spawnDisaster(sim.u, p, 'flood', { pos: st.pos, god: -1, cause: 'nature' });
  if (typeof d === 'string') throw new Error(d);
  let Wn = d.st.Wn ?? 0;
  if (!warned) {
    d.st.Wn = 0; Wn = 0;
    for (const t of ps.settlements) { const r = srel(sim.u, p.id, t.id); r.evacuate = null; }
  }
  if (Wn > 1) sim.step(Wn - 1);
  const R = dangerRadius(sim.u.content.disasters.find('flood')!, d);
  const pt: [number, number, number] = [0, 0, 0];
  let out = 0, n = 0;
  for (const id of ids) {
    const s = A.slotOf(id);
    if (s < 0) continue;
    n++;
    A.posAt(s, sim.u.tick, pt);
    if (distM(p, pt, d.pos) > R || A.task[s] === TASK.evacuate) out++;
  }
  sim.step(2 * makeCtx(sim.u, p).day);
  const dead = ids.filter((id) => A.slotOf(id) < 0).length;
  return { out, n, dead, Wn };
}

const rows: string[] = [];
let floods = 0, evac = 0, deadW = 0, deadU = 0;
for (let seed = 1; seed <= 8; seed++) {
  const { bytes, sid } = base(seed);
  for (let k = 0; k < 3; k++) {
    const w = one(bytes, sid, k, true), b = one(bytes, sid, k, false);
    floods++;
    if (w.n && w.out / w.n >= 0.5) evac++;
    deadW += w.dead; deadU += b.dead;
    rows.push(`seed ${seed} flood ${k}: Wn ${w.Wn} evacuated ${w.out}/${w.n}; dead warned ${w.dead} unwarned ${b.dead} (unwarned out ${b.out}/${b.n})`);
    console.log(rows[rows.length - 1]);
  }
}
console.log(`SUMMARY floods ${floods}; evacuated (>= half out at the water) ${evac} = ${Math.round((100 * evac) / floods)} %; deaths warned ${deadW} vs unwarned ${deadU}`);

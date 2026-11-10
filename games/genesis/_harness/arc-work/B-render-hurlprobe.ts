// B-render: why no hurl live in babel? node _harness/arc-work/B-render-hurlprobe.ts
import { Sim } from '../../src/sim/sim.ts';
import { srel } from '../../src/sim/god/regard.ts';
import { stormNear } from '../../src/sim/god/defiance.ts';
import { makeCtx } from '../../src/sim/people/ctx.ts';
import { NT, TRAIT } from '../../src/sim/people/defs.ts';
const sim = new Sim({ seed: 1, scenario: 'babel' });
const p = sim.u.planets[0];
const ps = p.people!;
let st = ps.settlements[0]; const PICK = Number(process.argv[2] ?? 0);
if (PICK) st = ps.settlement(PICK)!; else for (const s of ps.settlements) if ((ps.members.get(s.id)?.length ?? 0) > (ps.members.get(st.id)?.length ?? 0)) st = s;
const A = ps.agents;
const mem = ps.members.get(st.id) ?? [];
console.log('town', st.id, st.name, 'members', mem.length, 'bold', mem.filter((s) => A.traits[s * NT + TRAIT.boldness] >= 0.6).length, 'pos', st.pos.map((v) => Math.round(v)));
const ap = (c: unknown) => { const r = sim.applyNow(c as never) as { ok: boolean; msg?: string }; console.log(JSON.stringify(c).slice(0, 80), r.ok, r.msg); return r; };
ap({ k: 'set', path: 'disasters.natural', value: 0 });
ap({ k: 'defiance.set', settlement: st.id, value: Number(process.argv[3] ?? 0.8) });
const R = p.st.radius ?? 3000;
const L = Math.hypot(...st.pos);
ap({ k: 'weather.paint', kind: 'thunderstorm', pos: st.pos.map((v) => v / L), radius: 900, duration: 3 * 1440, pinned: true });
const r = srel(sim.u, p.id, st.id);
const x = makeCtx(sim.u, p);
console.log('stormNear(unit pos)', stormNear(x, st, r), 'means', r.means?.map((v) => +v.toFixed(2)), 'def', r.defiance, 'since', JSON.stringify(r.since));
ap({ k: 'weather.paint', kind: 'thunderstorm', pos: [...st.pos], radius: 900, duration: 3 * 1440, pinned: true });
console.log('stormNear(raw pos)', stormNear(makeCtx(sim.u, p), st, r), 'L', L, 'R', R);
let hurl = 0;
for (let h = 0; h < 24 * 6 && !hurl; h++) { sim.step(60); for (const e of sim.drainEvents() as { t: string; data?: { kind?: string } }[]) if (e.t === 'defy') { console.log('h', h, 'defy', e.data?.kind); if (e.data?.kind === 'hurl') hurl = 1; } }
console.log('hurl', hurl, 'def', r.defiance, 'fear', r.means?.[1], 'defied', JSON.stringify(r.defied));

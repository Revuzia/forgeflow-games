// GENESIS — PUNCH P32: the shrine-and-pilgrimage chain end to end, with nothing poked into the state. The god calls a
// prophet in a fresh bronze-age town, speaks rain through them and sends it; the prophet's word comes true until their
// credibility passes 0.5, they found a shrine at the town's natural holy place (a spring, the oldest grove or the
// highest peak, sacred.ts addSacredPlace), the town's builders raise it, and at the next feast of the year the
// pilgrims walk to it and pray. What the renderer reads is checked too: the `sacred` query (render/signs), the
// building in the view (sacred flag, finished) and the pilgrims' flag on the movers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must } from './helpers/god.ts';
import { AgentFlag, AgentFlag2, BuildingFlag } from '../src/sim/types.ts';
import { MEMK, TASK } from '../src/sim/people/defs.ts';
import { distM, isLand } from '../src/sim/people/world.ts';
import { cellPos3 } from '../src/sim/god/util.ts';
import type { Sim } from '../src/sim/sim.ts';
import type { Building, Settlement } from '../src/sim/people/state.ts';
import type { SacredPlace } from '../src/sim/god/state.ts';

/** the god's session: call a prophet, keep their word (rain foretold, rain sent; a shield when the ruler silences them)
 * until they found a shrine, then let the year run until it is built and pilgrims have prayed; asserts the whole chain */
function chain(sim: Sim, st: Settlement): { shrine: Building; place: SacredPlace } {
  const p = sim.u.planets[0];
  const ps = p.people;
  const A = ps.agents;
  const DAY = 1440;
  const yr = p.st.orbit.period;
  const who = (ps.members.get(st.id) ?? []).filter((s) => !(A.flags[s] & AgentFlag.child) && A.id[s] !== st.leader && (sim.u.tick - A.birth[s]) / yr >= 20).map((s) => A.id[s])[0];
  must(sim, { k: 'prophet.call', agent: who });
  const R = sim.u.god.rel!;
  const ph = () => R.prophets.find((q) => q.agent === who);
  let shrineDay = -1, builtDay = -1, prayedDay = -1, flagged = 0;
  const yd = Math.round(yr / DAY);
  for (let day = 0; day < 12 + 2 * yd; day++) {
    // the god keeps its prophet's word: rain foretold, rain sent the next day (until the shrine is founded)
    if ((ph()?.shrine ?? 0) < 0 && day < 12) {
      // (a ruler who silences the prophet: the god defends them, a shield where they stand, as a player would)
      if ((ph()?.silenced ?? 0) > sim.u.tick) { const at = [0, 0, 0]; A.posAt(A.slotOf(who), sim.u.tick, at); must(sim, { k: 'miracle.shield', pos: at, radius: 60 }); }
      else if (day % 2 === 0) must(sim, { k: 'prophet.foretell', agent: who, what: 'rain', days: 2 });
      else must(sim, { k: 'miracle.water', pos: [st.pos[0], st.pos[1], st.pos[2]] });
    }
    for (let h = 0; h < 24; h++) {
      sim.step(60);
      let on = false;
      for (let s = 0; s < A.hi && !on; s++) if (A.alive[s] && A.task[s] === TASK.pilgrimage) on = true;
      // a pilgrim on the road: the movers the renderer gets carry the pilgrim flag (inspector: 'on pilgrimage')
      if (on && !flagged) { const ag = sim.snapshot({ full: true }).planets[0].agents!; for (let k = 0; k < ag.count; k++) if ((ag.flags2?.[k] ?? 0) & AgentFlag2.pilgrim) flagged++; }
    }
    const sh = ps.buildings.find((b) => b.flags & BuildingFlag.sacred);
    if (sh && shrineDay < 0) shrineDay = day;
    if (sh && sh.progress >= 1 && builtDay < 0) builtDay = day;
    if ((R.stats.pilgrims ?? 0) > 0 && prayedDay < 0) prayedDay = day;
    if (builtDay >= 0 && prayedDay >= 0) break;
  }
  const info = JSON.stringify({ cred: ph()?.credibility, shrineDay, builtDay, prayedDay, places: R.places.map((q) => [q.kind, Math.round(distM(p, q.pos, st.pos))]), stats: R.stats });
  assert.ok(shrineDay >= 0, `the prophet founded a shrine: ${info}`);
  const sh = ps.buildings.find((b) => b.flags & BuildingFlag.sacred)!;
  assert.equal(sim.u.content.buildings.list[sh.type].id, 'shrine');
  assert.ok(builtDay >= 0 && sh.progress >= 1, `the town built the shrine (progress ${sh.progress}): ${info}`);
  const place = R.places.find((q) => distM(p, q.pos, sh.pos) < 300);
  assert.ok(place && place.settlement === st.id, `the shrine stands at the town's sacred place: ${info}`);
  assert.ok(prayedDay >= 0, `pilgrims prayed at the sacred place: ${info}`);
  const went = (ps.members.get(st.id) ?? []).filter((s) => { for (let m = 0; m < 8; m++) if (A.memKind[s * 8 + m] === MEMK.pilgrimage && A.memA[s * 8 + m] === place!.id) return true; return false; });
  assert.ok(went.length >= 2, `at least two of the town remember the pilgrimage: ${went.length} ${info}`);
  // what the renderer reads: the sacred query (render/signs/signs.ts) and the building as the view gives it
  const q = sim.query('sacred') as { places: { id: number; kind: string }[] };
  assert.ok(q.places.some((x) => x.id === place!.id), 'the sacred query lists the place');
  const bb = sim.snapshot({ full: true }).planets[0].buildings!;
  const k = Array.from(bb.id).indexOf(sh.id);
  assert.ok(k >= 0 && bb.flags[k] & BuildingFlag.sacred && bb.progress[k] >= 1, `the snapshot carries the finished sacred shrine (index ${k})`);
  assert.ok(flagged >= 1, 'pilgrims on the road carry the pilgrim flag in the snapshot');
  return { shrine: sh, place: place! };
}

test('sacred chain (P32): a prophet whose word comes true founds a shrine, the town builds it, pilgrims pray there at the feast', () => {
  const { sim, st } = town();
  chain(sim, st);
});

test('sacred chain (P32): a shrine founded at a holy water stands on dry ground beside it, is built and visited', () => {
  // the god hallows the water nearest the town (a spring's cell is water: a site there was given up the hour it was
  // laid out, buildings.ts reviseSite — seed 1's year-50 prophet founded one at a spring that vanished at once)
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const wet = p.cellsNear(st.pos, 600).filter((c) => p.f.water[c] > 0.6).map((c) => [c, distM(p, cellPos3(p, c), st.pos)] as const).sort((a, b) => a[1] - b[1])[0];
  assert.ok(wet, 'water within 600 m of the town');
  must(sim, { k: 'place.sacred', pos: cellPos3(p, wet[0]), kind: 'spring' });
  const { shrine, place } = chain(sim, st);
  assert.equal(place.kind, 'spring');
  assert.ok(p.f.water[shrine.cell] <= 0.1 && isLand(p, shrine.cell), 'the shrine stands on dry land');
  assert.ok(distM(p, shrine.pos, place.pos) < 300, `beside the holy water: ${Math.round(distM(p, shrine.pos, place.pos))} m`);
});

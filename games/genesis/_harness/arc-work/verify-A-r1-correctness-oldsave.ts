// verifier (correctness) A r1: load each old fixture save, run 20 days, check ARC lazy fill, pride, save/reload determinism
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Sim } from '../../src/sim/sim.ts';
import { makeCtx } from '../../src/sim/people/ctx.ts';
const DIR = new URL('../../tests/fixtures/', import.meta.url);
for (const f of ['save-1.4-aru.gnss.gz', 'save-1.5a-kin.gnss.gz']) {
  const bytes = new Uint8Array(gunzipSync(readFileSync(new URL(f, DIR))));
  const a = Sim.load(bytes), b = Sim.load(bytes);
  const p = a.u.planets.find((q) => q.people?.settlements.length)!;
  const x = makeCtx(a.u, p);
  const t0 = a.u.tick;
  let t = Date.now();
  a.step(x.day * 20);
  const ms = Date.now() - t;
  b.step(x.day * 10);
  const c = Sim.load(b.save());
  c.step(x.day * 10); b.step(x.day * 10);
  const out: unknown[] = [];
  for (const st of p.people!.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    const r = a.u.god.rel.st[`${p.id}:${st.id}`];
    out.push({ id: st.id, pop: (p.people!.members.get(st.id) ?? []).length, arc0: r?.since.arc0 === undefined ? null : r.since.arc0 - t0, pride: r?.pride, why: r?.prideWhy, kind: r?.hearts?.kind, dusk: r?.dusk, lastHarm: r?.lastHarm });
  }
  console.log(f, 'ms20d', ms, 'hash a==b', a.hash() === b.hash(), 'reload b==c', b.hash() === c.hash(), 'towers', a.u.god.rel.towers?.length);
  console.log(JSON.stringify(out));
}

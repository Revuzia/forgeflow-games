import { harness, runFlow, sessionCatalog } from './fixtures/session_fixture.ts';
for (const q of ['fx_s_bridge', 'fx_s_standard', 'fx_s_fray']) for (const seed of [1, 2, 3]) {
  const t0 = performance.now();
  const h = harness({ catalog: sessionCatalog({ timeLimit: false }), seed });
  const r = runFlow(h, { queue: q }, { maxGameSeconds: 900 });
  console.log(q, seed, r.ok, r.why ?? '', r.result?.reason, r.result?.duration.toFixed(0), ((performance.now() - t0) / 1000).toFixed(2) + 's');
}

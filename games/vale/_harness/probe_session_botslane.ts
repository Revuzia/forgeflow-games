// probe (lane SESSION): integration with the BOTS lane (src/sim/bots/) through bots_link.ts — no
// fixture bots: the BOTS lane drafts every seat (createDraftBrain), picks bot loadouts
// (pickLoadout) and plays every seat including yours (createBots, autopilot) to a real end — a
// core / score / last standing, or the queue time limit of LONG game seconds: Bridge (3v3 lanes)
// and Fray (FFA).
// SKIP (77) when the BOTS lane is not linked.
import { existsSync } from 'node:fs';
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { harness, runFlow, sessionCatalog } from './fixtures/session_fixture.ts';
import { BOTS_LINK } from '../src/session/bots_link.ts';
import { sanitizeLoadout } from '../src/session/setup.ts';

if (!existsSync(new URL('../src/sim/bots/index.ts', import.meta.url)) || !BOTS_LINK.bots || !BOTS_LINK.draftBrain) {
  console.log('SKIP probe_session_botslane: the BOTS lane is not linked (src/session/bots_link.ts)');
  process.exit(77);
}
const LONG = 900;
const cat = sessionCatalog({ timeLimit: LONG });

section('BOTS lane: draft brain + loadouts + in-match bots play Bridge and Fray to a real end', () => {
  for (const [queue, budget] of [['fx_s_bridge', LONG + 30], ['fx_s_fray', LONG + 30]] as const) {
    const t0 = performance.now();
    const h = harness({ catalog: cat, bots: undefined, seed: 11 });
    const r = runFlow(h, { queue }, { maxGameSeconds: budget });
    const wall = (performance.now() - t0) / 1000;
    console.log(`  info: ${queue}: ${r.ok ? `${r.result!.reason} at ${r.result!.duration.toFixed(0)} s, ${r.result!.players.reduce((a, p) => a + p.kills, 0)} kills` : r.why} — ${wall.toFixed(2)} s wall`);
    check(`${queue}: ends by a real condition within ${budget} game seconds`, r.ok && ['core', 'score', 'last_standing', 'time'].includes(r.result!.reason), r.why);
    const bots = r.setup?.seats.filter((s) => s.controller === 'bot') ?? [];
    check(`${queue}: bot loadouts from the BOTS lane are valid under the rules`, bots.length > 0 && bots.every((s) => {
      const rules = cat.modes.find((m) => m.id === r.setup!.mode)!.rules;
      return JSON.stringify(sanitizeLoadout(cat, rules, s.loadout)) === JSON.stringify(s.loadout);
    }));
    check(`${queue}: grants + history recorded`, !!r.postgame && h.session.profile().history.length === 1);
  }
  if (cat.queues.some((q) => q.id === 'fx_s_bridge')) {
    const h = harness({ catalog: cat, bots: undefined, seed: 11 });
    const r = runFlow(h, { queue: 'fx_s_bridge' }, { maxGameSeconds: LONG + 30 });
    const h2 = harness({ catalog: cat, bots: undefined, seed: 11 });
    const r2 = runFlow(h2, { queue: 'fx_s_bridge' }, { maxGameSeconds: LONG + 30 });
    check('same seed → same draft, same match digest with the BOTS lane', r.ok && r2.ok && JSON.stringify(r.setup) === JSON.stringify(r2.setup)
      && !!r.result?.digest && r.result.digest === r2.result?.digest);
  }
});

finish('probe_session_botslane');

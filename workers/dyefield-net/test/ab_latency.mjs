// A/B latency check for T9 on a shared, loaded box: the real relay (8790) and a trivial baseline relay (8791,
// test/baseline) carry the same 8-human load at the same time from one probe process. Spike episodes that line up in
// time on both are the environment (CPU starvation of workerd / the probe), not dyefield-net's code.
//   node test/ab_latency.mjs [seconds]
import path from 'node:path';
import * as L from './lib.mjs';
import { loadRun } from './relay_probe.mjs';

const seconds = Number(process.argv[2] || 60);
const relay = await L.startDev({}, { label: 'ab-relay', port: 8790 });
const base = await L.startDev({}, { label: 'ab-base', port: 8791, cwd: path.join(L.HERE, 'baseline') });
try {
  const [a, b] = await Promise.all([
    loadRun({ relay: relay.ws, origin: L.ORIGIN_OK, clients: 8, seconds }),
    loadRun({ relay: base.ws, origin: L.ORIGIN_OK, clients: 8, seconds }),
  ]);
  const abs = (r) => r.spikeEpisodes.map((e) => ({ ...e, absStart: r.t0 + e.start, absEnd: r.t0 + e.end }));
  const ea = abs(a);
  const eb = abs(b);
  const overlaps = (e, list) => list.some((x) => x.absEnd >= e.absStart - 300 && x.absStart <= e.absEnd + 300);
  const out = {
    seconds,
    relay: { latencyMs: a.latencyMs, complete: a.snapComplete && a.intComplete, episodes: ea.map((e) => ({ s: e.absStart - a.t0, n: e.n, maxMs: e.maxMs, alsoInBaseline: overlaps(e, eb), probeStalled: e.probeStalled })) },
    baseline: { latencyMs: b.latencyMs, complete: b.snapComplete && b.intComplete, episodes: eb.map((e) => ({ s: e.absStart - a.t0, n: e.n, maxMs: e.maxMs, alsoInRelay: overlaps(e, ea), probeStalled: e.probeStalled })) },
    probeStalls: a.probeStalls,
  };
  console.log(JSON.stringify(out, null, 1));
} finally {
  await relay.stop();
  await base.stop();
}

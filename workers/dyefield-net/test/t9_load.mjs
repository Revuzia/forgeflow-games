// T9: load — 8 humans (host + 7 clients) at full rates for 60 s on wrangler dev: completeness and order, frames/s,
// relay-added latency, units counted vs expected, storage writes for the match.
//
// Latency is measured A/B: the same 8-human load runs at the same time through dyefield-net (8790) and through a
// no-op baseline relay (test/baseline, 8791) from one probe process. The box is shared and often at 70–100 % CPU;
// both relays then show the same spike episodes at the same instants. "Relay-added latency" = dyefield-net's
// percentile minus the baseline's (the contract's gate: p99 < 5 ms). The absolute numbers are reported as measured.
import path from 'node:path';
import * as L from './lib.mjs';
import { loadRun } from './relay_probe.mjs';

export async function run(dev, C) {
  const seconds = Number(process.env.T9_SECONDS || 60);
  const base = await L.startDev({}, { label: 'baseline', port: 8791, cwd: path.join(L.HERE, 'baseline') });
  let res;
  let bres;
  const m0 = await L.devMeter(dev);
  try {
    [res, bres] = await Promise.all([
      loadRun({ relay: dev.ws, origin: L.ORIGIN_OK, clients: 8, seconds, snapBytes: 1000 }),
      loadRun({ relay: base.ws, origin: L.ORIGIN_OK, clients: 8, seconds, snapBytes: 1000 }),
    ]);
  } finally {
    await base.stop();
  }
  const m1 = await L.devMeter(dev);
  const lat = res.latencyMs;
  const blat = bres.latencyMs;
  const abs = (r) => r.spikeEpisodes.map((e) => ({ ...e, a0: r.t0 + e.start, a1: r.t0 + e.end }));
  const ea = abs(res);
  const eb = abs(bres);
  const relayOnly = ea.filter((e) => e.maxMs >= 20 && !e.probeStalled && !eb.some((x) => x.a1 >= e.a0 - 300 && x.a0 <= e.a1 + 300));
  C.extra = { relay: res, baseline: { latencyMs: blat, spikeEpisodes: bres.spikeEpisodes }, relayOnlyEpisodes: relayOnly };
  console.log(`  relay    latency ms: SNAP p50 ${lat.snap.p50} p90 ${lat.snap.p90} p99 ${lat.snap.p99} max ${lat.snap.max} | INTENTS p50 ${lat.intents.p50} p90 ${lat.intents.p90} p99 ${lat.intents.p99} max ${lat.intents.max}`);
  console.log(`  baseline latency ms: SNAP p50 ${blat.snap.p50} p90 ${blat.snap.p90} p99 ${blat.snap.p99} max ${blat.snap.max} | INTENTS p50 ${blat.intents.p50} p90 ${blat.intents.p90} p99 ${blat.intents.p99} max ${blat.intents.max}`);
  console.log(`  spike episodes: relay ${ea.length}, baseline ${eb.length}, relay-only (no baseline spike, no probe stall) ${relayOnly.length}; probe stalls ${res.probeStalls.length}`);

  C.ok(res.snapComplete, `every client received all ${res.sent.snaps} SNAPs in order`, res.received.snapsPerClient);
  C.ok(res.intComplete, `the host received all INTENTS of every client in order (${res.sent.intents} total)`, res.received.intentsPerSender);
  C.ok(res.sent.perSecond >= 150, `incoming rate ${res.sent.perSecond} frames/s (8 humans × 20 Hz = 160)`);
  const add50 = Math.max(lat.snap.p50 - blat.snap.p50, lat.intents.p50 - blat.intents.p50);
  const add99 = Math.max(lat.snap.p99 - blat.snap.p99, lat.intents.p99 - blat.intents.p99);
  C.ok(add99 < 5, `relay-added latency p99 ${add99.toFixed(2)} ms over the no-op baseline (< 5 ms); absolute relay p99 SNAP ${lat.snap.p99} / INTENTS ${lat.intents.p99} ms`);
  C.ok(add50 < 1, `relay-added latency p50 ${add50.toFixed(2)} ms over the no-op baseline (< 1 ms); absolute relay p50 SNAP ${lat.snap.p50} / INTENTS ${lat.intents.p50} ms`);
  C.ok(relayOnly.length === 0, 'no latency spike episode that only the relay shows (every spike coincides with the baseline or a probe stall)', relayOnly);
  const dRaw = m1.raw - m0.raw;
  const dUnits = m1.units - m0.units;
  const frames = res.sent.snaps + res.sent.intents;
  C.ok(dRaw >= frames && dRaw <= frames * 1.05 + 60, `meter raw +${dRaw} for ${frames} data frames (+ control, connections, RPCs, ping estimate)`);
  C.ok(Math.abs(dUnits - (dRaw - 30) / 20 - 25) < 25, `meter units +${dUnits} ≈ raw/20 + connections/RPCs`);
  const d = await L.devRoom(dev, res.code);
  C.ok(d.putsByMatch?.['1'] <= 20, `storage row writes for the 8-human match: ${d.putsByMatch?.['1']} (≤ 20)`, d.putsByMatch);
  C.ok(d.stats.abuse === 0, 'no drops at full rates', d.stats);
}

// HIT PARADE - netcode lane: aggregate every rtt_probe_*.json into the markdown tables used in
// _research/NETCODE.md section 0 (so every number in the report traces to a probe file).
// Usage: node tools/research/net_probe_summary.mjs
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'C:/Users/TestRun/Claude Claw/forgeflow-games/games/hit-parade/_research/netcode';
const files = readdirSync(DIR).filter((f) => /^rtt_probe_.*\.json$/.test(f)).sort();

const rows = [];
const pooled = { burst_rtt: [], burst_ab: [], burst_ba: [], low_rtt: [] };
let ooo = 0, oooN = 0, lost = 0, sent = 0;
const hb = [];
console.log('| run | phase | rate | sent | lost | RTT med / p90 / p99 / max (ms) | one-way A>B med / p99 | one-way B>A med / p99 | jitter (mean abs delta) | out-of-order (at B / at A) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const f of files) {
  const j = JSON.parse(readFileSync(DIR + '/' + f, 'utf8'));
  const run = f.replace(/^rtt_probe_|\.json$/g, '');
  hb.push(`${run}: A ${j.heartbeat_rtt_ms.A.median} (p90 ${j.heartbeat_rtt_ms.A.p90}), B ${j.heartbeat_rtt_ms.B.median} (p90 ${j.heartbeat_rtt_ms.B.p90}); subscribe A ${j.connect.a_subscribed_ms} / B ${j.connect.b_subscribed_ms} ms; presence both-visible A ${j.connect.presence.a_sees_both_ms_after_track} / B ${j.connect.presence.b_sees_both_ms_after_track} ms; throttle signals ${j.throttle_signals.length}`);
  for (const p of j.phases) {
    const r = p.rtt_ms, ab = p.one_way_a_to_b_ms, ba = p.one_way_b_to_a_ms;
    console.log(`| ${run}${j.quick ? ' (quick)' : ''} | ${p.phase} | ${p.achieved_send_hz} Hz | ${p.sent} | ${p.lost_a_to_b + p.lost_b_to_a} | ${r.median} / ${r.p90} / ${r.p99} / ${r.max} | ${ab.median} / ${ab.p99} | ${ba.median} / ${ba.p99} | ${r.jitter_mean_abs_delta} | ${p.out_of_order_at_b} / ${p.out_of_order_at_a} |`);
    if (j.quick) continue;
    sent += p.sent; lost += p.lost_a_to_b + p.lost_b_to_a;
    if (/^burst/.test(p.phase)) { ooo += p.out_of_order_at_b + p.out_of_order_at_a; oooN += 2 * p.sent; }
    if (p.raw) {
      for (const x of p.raw) {
        if (x[4] == null || x[2] == null) continue;
        const rtt = x[4] - x[1];
        if (/^burst/.test(p.phase)) { pooled.burst_rtt.push(rtt); pooled.burst_ab.push(x[2] - x[1]); pooled.burst_ba.push(x[4] - x[3]); }
        else pooled.low_rtt.push(rtt);
      }
    }
  }
}
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10) / 10 : null; };
console.log('\nheartbeat (socket <-> Realtime server RTT, ms, median):');
for (const h of hb) console.log('- ' + h);
console.log(`\nfull runs: sent ${sent} pings, lost ${lost}; burst out-of-order deliveries ${ooo} of ${oooN} (${Math.round((ooo / Math.max(1, oooN)) * 10000) / 100}%)`);
for (const k of Object.keys(pooled)) if (pooled[k].length) console.log(`pooled raw ${k}: n=${pooled[k].length} median ${pct(pooled[k], 50)} p90 ${pct(pooled[k], 90)} p99 ${pct(pooled[k], 99)} max ${pct(pooled[k], 100)}`);

// HIT PARADE - netcode lane: live latency probe for the shared FFG Supabase Realtime relay.
//
// Opens TWO independent Realtime sockets (client A = "pinger", client B = "echo") in ONE Node
// process, joins a throwaway channel  ffg:hit-parade-nettest:<random>, and measures:
//   - connect -> SUBSCRIBED time, presence "both peers visible" time
//   - socket heartbeat RTT (client <-> Realtime server, no relay hop) every 5 s
//   - RTT, one-way A->B and B->A (same process = same clock, so one-way is exact),
//     jitter, loss, out-of-order, duplicates, for:
//       phase "baseline"   : 2 Hz ping-pong for 60 s   (also warms the tenant rate counter)
//       phase "burst_json" : 200 pings at 60 Hz, JSON payload shaped like an input packet
//       phase "gap"        : 1 Hz ping-pong for 65 s   (keeps each 60 s window to ONE burst)
//       phase "burst_bin"  : 200 pings at 60 Hz, 16-byte ArrayBuffer payload (vsn 2.0.0 binary)
//   - wire bytes per ping frame (a counting WebSocket subclass wraps the transport)
//   - any CHANNEL_ERROR / CLOSED / "Too many messages per second" during the run
//
// SAFETY / QUOTA: the free-plan limit is 100 events/s per PROJECT (tenant), a 60 s rolling
// average (realtime lib/realtime/tenants.ex events_per_second_rate: tick 5 s x 12 buckets), and
// every broadcast counts 1 (send) + 1 per receiving subscriber. Exceeding it closes channels of
// EVERY game on the project. This probe never pushes the rolling average near that: worst 60 s
// window = one burst (200 pings + 200 pongs = 400 sends = 800 events) + 1 Hz tail (~4 events/s)
// = ~17 events/s. Total ~2.7k events = ~0.14% of the 2M/month free quota. No money is spent.
//
// Client A declares realtime params { eventsPerSecond: 1 } on purpose: if anything (client or
// server) honoured that value, the 60 Hz bursts would lose ~98% of pings.
//
// Usage:  node tools/research/net_rtt_probe.mjs [--quick]
//   --quick : baseline 10 s, gap 10 s (smoke test of the script only; windows then hold both
//             bursts = ~27 events/s worst case, still far under 100).
// Output: _research/netcode/rtt_probe_<stamp>.json + a printed summary.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const ROOT = 'C:/Users/TestRun/Claude Claw/forgeflow-games';
const GAME = ROOT + '/games/hit-parade';
const OUT_DIR = GAME + '/_research/netcode';
const require = createRequire(import.meta.url);
const RT = require(ROOT + '/node_modules/@supabase/realtime-js');
const RT_VERSION = require(ROOT + '/node_modules/@supabase/realtime-js/package.json').version;
const { RealtimeClient } = RT;

// The public anon key every FFG multiplayer game embeds (read from a shipped game, not copied).
const KEY_SRC = ROOT + '/games/checkers/runtime/net/ffg_online.js';
const src = readFileSync(KEY_SRC, 'utf8');
const SUPABASE_URL = /SUPABASE_URL\s*=\s*"([^"]+)"/.exec(src)[1];
const ANON = /SUPABASE_ANON_KEY\s*=\s*\n?\s*"([^"]+)"/.exec(src)[1];

const QUICK = process.argv.includes('--quick');
const PLAN = {
  baselineHz: 2, baselineSec: QUICK ? 10 : 60,
  burstHz: 60, burstN: 200,
  gapHz: 1, gapSec: QUICK ? 10 : 65,
  graceMs: 3000,
};

const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10);
const log = (...a) => console.log('[' + (now() / 1000).toFixed(2) + 's]', ...a);

// ---------- wire-byte counting transport ----------
function countingTransport(stats) {
  const Base = globalThis.WebSocket;
  return class CountingWS extends Base {
    constructor(url, protocols) {
      super(url, protocols);
      stats.url = String(url).replace(/apikey=[^&]+/, 'apikey=<anon>');
      this.addEventListener('message', (e) => {
        const d = e.data;
        const n = typeof d === 'string' ? Buffer.byteLength(d) : (d.byteLength ?? d.size ?? 0);
        stats.rx.push([now(), n, typeof d === 'string' ? 't' : 'b']);
      });
    }
    send(data) {
      const n = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
      stats.tx.push([now(), n, typeof data === 'string' ? 't' : 'b']);
      return super.send(data);
    }
  };
}

function mkClient(name, params) {
  const stats = { name, tx: [], rx: [], hb: [], status: [], url: null };
  const client = new RealtimeClient(SUPABASE_URL.replace(/^http/, 'ws') + '/realtime/v1', {
    params: Object.assign({ apikey: ANON }, params || {}),
    heartbeatIntervalMs: 5000,
    transport: countingTransport(stats),
    heartbeatCallback: (status, latency) => {
      if (status === 'ok' && latency != null) stats.hb.push(latency);
      if (status !== 'ok' && status !== 'sent') stats.status.push([now(), 'heartbeat:' + status]);
    },
  });
  return { name, client, stats, channel: null };
}

// ---------- stats helpers ----------
function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
function summarize(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  if (!a.length) return { n: 0 };
  const s = a.slice().sort((x, y) => x - y);
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) * (y - mean), 0) / a.length);
  let jit = 0;
  for (let i = 1; i < a.length; i++) jit += Math.abs(a[i] - a[i - 1]);
  const r = (x) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    n: a.length, min: r(s[0]), median: r(pct(s, 50)), p90: r(pct(s, 90)), p99: r(pct(s, 99)),
    max: r(s[s.length - 1]), mean: r(mean), stddev: r(sd),
    jitter_mean_abs_delta: r(a.length > 1 ? jit / (a.length - 1) : 0),
  };
}

// ---------- the test ----------
const TOPIC = 'ffg:hit-parade-nettest:' + rid().toUpperCase();
const A = mkClient('A', { eventsPerSecond: 1 });
const B = mkClient('B', {});
const phases = {}; // name -> { sends: Map seq->rec, ... }
let phaseName = null;

function newPhase(name, kind) {
  phases[name] = { name, kind, pings: new Map(), bRecvOrder: [], aRecvOrder: [], sendTimes: [], dupB: 0, dupA: 0 };
  phaseName = name;
  return phases[name];
}

function subscribe(peer) {
  return new Promise((resolve) => {
    const t0 = now();
    const ch = peer.client.channel(TOPIC, {
      config: { broadcast: { self: false, ack: false }, presence: { key: peer.name + '_' + rid() } },
    });
    peer.channel = ch;
    peer.presenceBoth = null;
    ch.on('presence', { event: 'sync' }, () => {
      const n = Object.keys(ch.presenceState()).length;
      if (n >= 2 && peer.presenceBoth == null) peer.presenceBoth = now();
    });
    let done = false;
    ch.subscribe(async (status, err) => {
      peer.stats.status.push([now(), status + (err ? ': ' + (err.message || String(err)) : '')]);
      if (status !== 'SUBSCRIBED') log(peer.name, 'status', status, err ? (err.message || String(err)) : '');
      if (status === 'SUBSCRIBED' && !done) {
        done = true;
        peer.subscribedMs = now() - t0;
        peer.trackStart = now();
        await ch.track({ at: Date.now() });
        resolve();
      } else if (!done && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
        done = true; resolve();
      }
    });
    ch.on('system', {}, (m) => peer.stats.status.push([now(), 'system: ' + JSON.stringify(m).slice(0, 200)]));
  });
}

// B echoes; A collects.
function wireHandlers() {
  B.channel.on('broadcast', { event: 'p' }, ({ payload }) => {
    const tb = now();
    const ph = phases[payload.ph];
    if (ph) {
      if (ph.bRecvOrder.includes(payload.s)) ph.dupB++;
      ph.bRecvOrder.push(payload.s);
      const rec = ph.pings.get(payload.s);
      if (rec) rec.tbRecv = tb;
    }
    const tbSend = now();
    if (ph && ph.pings.get(payload.s)) ph.pings.get(payload.s).tbSend = tbSend;
    B.channel.send({ type: 'broadcast', event: 'q', payload: { ph: payload.ph, s: payload.s } });
  });
  A.channel.on('broadcast', { event: 'q' }, ({ payload }) => {
    const ta = now();
    const ph = phases[payload.ph];
    if (!ph) return;
    if (ph.aRecvOrder.includes(payload.s)) ph.dupA++;
    ph.aRecvOrder.push(payload.s);
    const rec = ph.pings.get(payload.s);
    if (rec && rec.taRecv == null) rec.taRecv = ta;
  });
  // binary path: event 'pb' / 'qb'. Payload = ArrayBuffer [u8 phaseIdx][u8 pad][u16 seq][12 bytes input history]
  B.channel.on('broadcast', { event: 'pb' }, (msg) => {
    const tb = now();
    const buf = msg.payload;
    if (!(buf instanceof ArrayBuffer)) { B.binaryNonBuffer = (B.binaryNonBuffer || 0) + 1; return; }
    const dv = new DataView(buf);
    const s = dv.getUint16(2, true);
    const ph = phases.burst_bin;
    if (ph.bRecvOrder.includes(s)) ph.dupB++;
    ph.bRecvOrder.push(s);
    const rec = ph.pings.get(s);
    if (rec) { rec.tbRecv = tb; rec.tbSend = now(); }
    const out = new ArrayBuffer(4);
    new DataView(out).setUint16(2, s, true);
    B.channel.send({ type: 'broadcast', event: 'qb', payload: out });
  });
  A.channel.on('broadcast', { event: 'qb' }, (msg) => {
    const ta = now();
    const buf = msg.payload;
    if (!(buf instanceof ArrayBuffer)) { A.binaryNonBuffer = (A.binaryNonBuffer || 0) + 1; return; }
    const s = new DataView(buf).getUint16(2, true);
    const ph = phases.burst_bin;
    if (ph.aRecvOrder.includes(s)) ph.dupA++;
    ph.aRecvOrder.push(s);
    const rec = ph.pings.get(s);
    if (rec && rec.taRecv == null) rec.taRecv = ta;
  });
}

function sendPing(ph, s, binary) {
  const t = now();
  ph.pings.set(s, { s, taSend: t, tbRecv: null, tbSend: null, taRecv: null });
  ph.sendTimes.push(t);
  if (binary) {
    const buf = new ArrayBuffer(16);
    const dv = new DataView(buf);
    dv.setUint8(0, 3); dv.setUint16(2, s, true);
    for (let i = 4; i < 16; i++) dv.setUint8(i, (s * 7 + i) & 255); // stand-in for 12 bytes of input history
    A.channel.send({ type: 'broadcast', event: 'pb', payload: buf });
  } else {
    // shaped like a real input packet: frame, ack, 8 redundant input words
    const f = 1000 + s;
    A.channel.send({ type: 'broadcast', event: 'p', payload: { ph: ph.name, s, f, a: f - 3, i: [s & 1023, 17, 17, 16, 16, 0, 0, 512] } });
  }
}

// absolute-time pacer: fires ping k at t0 + k/hz, catches up if the timer is late
async function pace(ph, hz, count, binary) {
  const t0 = now();
  const step = 1000 / hz;
  let k = 0;
  while (k < count) {
    const due = t0 + k * step;
    const t = now();
    if (t >= due) { sendPing(ph, k, binary); k++; continue; }
    const wait = due - t;
    if (wait > 2) await sleep(wait - 1); else await new Promise((r) => setImmediate(r));
  }
}

function analyze(ph, hz) {
  const recs = [...ph.pings.values()];
  const rtt = [], ab = [], ba = [];
  let lostAB = 0, lostBA = 0;
  for (const r of recs) {
    if (r.tbRecv == null) { lostAB++; continue; }
    ab.push(r.tbRecv - r.taSend);
    if (r.taRecv == null) { lostBA++; continue; }
    rtt.push(r.taRecv - r.taSend);
    ba.push(r.taRecv - r.tbSend);
  }
  const ooo = (order) => { let n = 0, mx = -1; for (const s of order) { if (s < mx) n++; else mx = s; } return n; };
  const oooDetail = (order) => { const d = []; let mx = -1; for (const s of order) { if (s < mx) d.push([s, mx]); else mx = s; } return d.slice(0, 20); };
  const iv = [];
  for (let i = 1; i < ph.sendTimes.length; i++) iv.push(ph.sendTimes[i] - ph.sendTimes[i - 1]);
  const span = ph.sendTimes.length > 1 ? (ph.sendTimes[ph.sendTimes.length - 1] - ph.sendTimes[0]) / 1000 : 0;
  return {
    phase: ph.name, kind: ph.kind, target_hz: hz, sent: recs.length,
    achieved_send_hz: span ? Math.round(((ph.sendTimes.length - 1) / span) * 100) / 100 : null,
    send_interval_ms: summarize(iv),
    rtt_ms: summarize(rtt), one_way_a_to_b_ms: summarize(ab), one_way_b_to_a_ms: summarize(ba),
    lost_a_to_b: lostAB, lost_b_to_a: lostBA,
    loss_pct: Math.round(((lostAB + lostBA) / Math.max(1, recs.length)) * 10000) / 100,
    out_of_order_at_b: ooo(ph.bRecvOrder), out_of_order_at_a: ooo(ph.aRecvOrder),
    duplicates_at_b: ph.dupB, duplicates_at_a: ph.dupA,
    out_of_order_detail_b: oooDetail(ph.bRecvOrder), out_of_order_detail_a: oooDetail(ph.aRecvOrder),
    window: [Math.round(ph.sendTimes[0] || 0), Math.round(ph.sendTimes[ph.sendTimes.length - 1] || 0)],
    // raw per-ping trace for trace-driven rollback analysis (tools/research/net_rollback_sim.mjs):
    // [seq, taSend, tbRecv, tbSend, taRecv] in ms since process start, null = lost
    raw: recs.map((r) => [r.s, rnd(r.taSend), rnd(r.tbRecv), rnd(r.tbSend), rnd(r.taRecv)]),
  };
}
function rnd(x) { return x == null ? null : Math.round(x * 100) / 100; }

function frameSizes(stats, t0, t1, dir, kind) {
  const src = dir === 'tx' ? stats.tx : stats.rx;
  const sizes = src.filter(([t, , k]) => t >= t0 && t <= t1 && (!kind || k === kind)).map(([, n]) => n);
  return summarize(sizes);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const startedIso = new Date().toISOString();
  log('realtime-js', RT_VERSION, 'topic', TOPIC, QUICK ? '(QUICK)' : '');
  await Promise.all([subscribe(A), subscribe(B)]);
  wireHandlers();
  log('A subscribed in', A.subscribedMs?.toFixed(1), 'ms; B in', B.subscribedMs?.toFixed(1), 'ms');
  // wait for both presences
  const pw0 = now();
  while ((A.presenceBoth == null || B.presenceBoth == null) && now() - pw0 < 10000) await sleep(20);
  const presence = {
    a_sees_both_ms_after_track: A.presenceBoth ? Math.round(A.presenceBoth - A.trackStart) : null,
    b_sees_both_ms_after_track: B.presenceBoth ? Math.round(B.presenceBoth - B.trackStart) : null,
  };
  log('presence', JSON.stringify(presence));
  await sleep(500);

  const results = [];
  let ph = newPhase('baseline', 'json');
  log('baseline', PLAN.baselineHz, 'Hz for', PLAN.baselineSec, 's');
  await pace(ph, PLAN.baselineHz, PLAN.baselineHz * PLAN.baselineSec, false);
  await sleep(PLAN.graceMs);
  results.push(analyze(ph, PLAN.baselineHz));

  ph = newPhase('burst_json', 'json');
  log('burst_json', PLAN.burstN, 'pings at', PLAN.burstHz, 'Hz');
  const bj0 = now();
  await pace(ph, PLAN.burstHz, PLAN.burstN, false);
  const bj1 = now();
  await sleep(PLAN.graceMs);
  const rj = analyze(ph, PLAN.burstHz);
  rj.wire = {
    a_tx_frame_bytes: frameSizes(A.stats, bj0, bj1, 'tx'),
    b_rx_frame_bytes: frameSizes(B.stats, bj0, bj1 + 1000, 'rx'),
  };
  results.push(rj);

  ph = newPhase('gap', 'json');
  log('gap', PLAN.gapHz, 'Hz for', PLAN.gapSec, 's');
  await pace(ph, PLAN.gapHz, PLAN.gapHz * PLAN.gapSec, false);
  await sleep(PLAN.graceMs);
  results.push(analyze(ph, PLAN.gapHz));

  ph = newPhase('burst_bin', 'binary');
  log('burst_bin', PLAN.burstN, 'pings at', PLAN.burstHz, 'Hz (ArrayBuffer payload)');
  const bb0 = now();
  await pace(ph, PLAN.burstHz, PLAN.burstN, true);
  const bb1 = now();
  await sleep(PLAN.graceMs);
  const rb = analyze(ph, PLAN.burstHz);
  rb.wire = {
    a_tx_frame_bytes: frameSizes(A.stats, bb0, bb1, 'tx'),
    b_rx_frame_bytes: frameSizes(B.stats, bb0, bb1 + 1000, 'rx'),
    b_rx_binary_frames: B.stats.rx.filter(([t, , k]) => t >= bb0 && t <= bb1 + 1000 && k === 'b').length,
    non_arraybuffer_payloads_at_b: B.binaryNonBuffer || 0,
    non_arraybuffer_payloads_at_a: A.binaryNonBuffer || 0,
  };
  results.push(rb);

  // cleanup (statuses after this point are our own teardown, not throttling)
  const cleanupAt = now();
  try { await A.channel.untrack(); } catch (e) {}
  try { await B.channel.untrack(); } catch (e) {}
  try { await A.client.removeChannel(A.channel); } catch (e) {}
  try { await B.client.removeChannel(B.channel); } catch (e) {}
  try { A.client.disconnect(); } catch (e) {}
  try { B.client.disconnect(); } catch (e) {}

  // event budget actually spent (sends + 1 delivery per send; heartbeats are not channel events)
  const sends = results.reduce((n, r) => n + r.sent + (r.sent - r.lost_a_to_b), 0);
  const out = {
    tool: 'hit-parade/tools/research/net_rtt_probe.mjs', started: startedIso, finished: new Date().toISOString(),
    quick: QUICK, realtime_js: RT_VERSION, node: process.version, topic: TOPIC,
    endpoint: A.stats.url, plan: PLAN,
    declared_params: { A: { eventsPerSecond: 1 }, B: {} },
    connect: { a_subscribed_ms: Math.round(A.subscribedMs || -1), b_subscribed_ms: Math.round(B.subscribedMs || -1), presence },
    heartbeat_rtt_ms: { A: summarize(A.stats.hb), B: summarize(B.stats.hb) },
    phases: results,
    status_events: { A: A.stats.status, B: B.stats.status },
    cleanup_started_ms: Math.round(cleanupAt),
    throttle_signals: [...A.stats.status, ...B.stats.status].filter(([t, s]) => t < cleanupAt && /too many|CHANNEL_ERROR|CLOSED|TIMED_OUT|rate|heartbeat:/i.test(s)),
    tenant_events_spent_est: sends * 2,
  };
  const stamp = startedIso.replace(/[:.]/g, '-');
  const path = OUT_DIR + '/rtt_probe_' + stamp + (QUICK ? '_quick' : '') + '.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  log('wrote', path);
  for (const r of results) {
    console.log(`${r.phase.padEnd(11)} sent=${r.sent} hz=${r.achieved_send_hz} rtt med/p90/p99/max=${r.rtt_ms.median}/${r.rtt_ms.p90}/${r.rtt_ms.p99}/${r.rtt_ms.max} ` +
      `A>B med/p99=${r.one_way_a_to_b_ms.median}/${r.one_way_a_to_b_ms.p99} jitter=${r.rtt_ms.jitter_mean_abs_delta} loss=${r.loss_pct}% ooo=${r.out_of_order_at_b}/${r.out_of_order_at_a}`);
  }
  console.log('heartbeat A', JSON.stringify(out.heartbeat_rtt_ms.A));
  console.log('throttle signals', JSON.stringify(out.throttle_signals));
  setTimeout(() => process.exit(0), 300);
}

main().catch((e) => { console.error('PROBE FAILED', e && e.stack || e); process.exit(1); });

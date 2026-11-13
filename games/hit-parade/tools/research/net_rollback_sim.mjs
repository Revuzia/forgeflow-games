// HIT PARADE - netcode lane: trace-driven rollback model over MEASURED relay latencies.
//
// Input: the raw per-ping traces written by net_rtt_probe.mjs (_research/netcode/rtt_probe_*.json,
// phases burst_json + burst_bin, 200 pings each at 60 Hz, one-way delay per message, same clock).
// For each direction (A->B uses tbRecv - taSend, B->A uses taRecv - tbSend) it replays a 60 Hz
// 1v1 match against that delay sequence (looping the 200-sample trace to 3600 frames = 60 s)
// and reports, for input delay D and max rollback window W:
//   - prediction depth per frame, per side = localFrame - lastConfirmedRemoteFrame (= worst-case
//     rollback depth if the prediction turns out wrong): p50/p90/p99/max
//   - stall %: ticks where a side could not advance (depth would exceed W, or time-sync sleep)
//   - game speed %: frames simulated per wall-clock tick (100% = no stalls)
// Transport variants:
//   relay60 : one packet per frame (what the probe actually sent)
//   relayB<k>: batch every k frames (60/k Hz), each packet carries all un-acked inputs; the
//            batch leaves at the send time of its last frame and takes that ping's delay.
// Every packet carries redundant history, so an input is known at the EARLIEST arrival of any
// packet that contains it (this is what makes reordering harmless).
// Usage: node tools/research/net_rollback_sim.mjs [probe.json ...]   (default: every probe json with raw traces)

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const DIR = 'C:/Users/TestRun/Claude Claw/forgeflow-games/games/hit-parade/_research/netcode';
const FRAME = 1000 / 60;
const FRAMES = 3600;

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(DIR).filter((f) => /^rtt_probe_.*\.json$/.test(f) && !/quick/.test(f)).map((f) => DIR + '/' + f);

function pct(s, p) { return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; }

// TWO-SIDED coupled model. Both peers tick every FRAME ms of wall time from t=0.
// At a tick, side X may simulate its next frame fX only if its prediction depth
// (fX - lastConfirmedSimFrameFromY) <= W; otherwise it stalls that tick (GGPO behaviour: the
// sim cannot run more than W frames past the last confirmed remote input). When X simulates
// frame j it samples the local input for sim frame j + D and (if (j+1) % batch == 0) sends a
// packet carrying every input generated so far (redundant history), which arrives after the
// measured one-way delay of trace index j. Time sync: every 240 ticks (GGPO
// RECOMMENDATION_INTERVAL), if one side's mean depth exceeds the other's by >= 2 frames it
// skips floor(diff / 2) ticks (cap 9 = GGPO MAX_FRAME_ADVANTAGE), which moves both toward
// balanced prediction (simplified stand-in for GGPO timesync.cpp).
function simulate(dAB, dBA, D, W, batch) {
  const nA = dAB.length, nB = dBA.length;
  const side = (dOut, n) => ({ f: 0, dOut, n, arriveAtOther: new Float64Array(FRAMES + 64).fill(Infinity), conf: -1, depths: [], stalls: 0, sleep: 0, winDepth: 0, winN: 0 });
  const A = side(dAB, nA), B = side(dBA, nB);
  const tickSide = (X, Y, t) => {
    // advance what X has confirmed from Y (contiguous generated indices)
    while (X.conf + 1 < FRAMES && Y.arriveAtOther[X.conf + 1] <= t) X.conf++;
    if (X.sleep > 0) { X.sleep--; X.stalls++; return; }
    const depth = Math.max(0, X.f - (X.conf + D));
    if (depth > W) { X.stalls++; return; }
    X.depths.push(depth); X.winDepth += depth; X.winN++;
    const j = X.f;
    if ((j + 1) % batch === 0) {
      const arr = t + X.dOut[j % X.n];
      for (let g = Math.max(0, j - 29); g <= j; g++) if (arr < X.arriveAtOther[g]) X.arriveAtOther[g] = arr;
    }
    X.f++;
  };
  let tick = 0;
  while (A.f < FRAMES - 40 && B.f < FRAMES - 40 && tick < FRAMES * 3) {
    const t = tick * FRAME;
    tickSide(A, B, t); tickSide(B, A, t);
    tick++;
    if (tick % 240 === 0 && A.winN && B.winN) {
      const da = A.winDepth / A.winN, db = B.winDepth / B.winN;
      if (da - db >= 2) A.sleep += Math.min(9, Math.floor((da - db) / 2));
      else if (db - da >= 2) B.sleep += Math.min(9, Math.floor((db - da) / 2));
      A.winDepth = A.winN = B.winDepth = B.winN = 0;
    }
  }
  const rep = (X) => {
    const d = X.depths.slice().sort((a, b) => a - b);
    return { depth_p50: pct(d, 50), depth_p90: pct(d, 90), depth_p99: pct(d, 99), depth_max: d[d.length - 1],
      stall_pct: Math.round((X.stalls / (X.stalls + d.length)) * 10000) / 100 };
  };
  return { D, W, batch_frames: batch, send_hz: Math.round(60 / batch), game_speed_pct: Math.round((Math.min(A.f, B.f) / tick) * 10000) / 100, A: rep(A), B: rep(B) };
}

const traces = [];
for (const file of files) {
  let j;
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { continue; }
  for (const ph of j.phases || []) {
    if (!ph.raw || !/^burst/.test(ph.phase)) continue;
    const raw = ph.raw.slice().sort((a, b) => a[0] - b[0]);
    const ab = raw.map((r) => (r[2] == null ? 1e9 : r[2] - r[1]));
    const ba = raw.map((r) => (r[4] == null || r[3] == null ? 1e9 : r[4] - r[3]));
    const tag = file.split('/').pop().replace(/^rtt_probe_|\.json$/g, '') + ':' + ph.phase;
    traces.push({ tag, ab, ba });
  }
}
if (!traces.length) { console.log('no probe files with raw traces found in', DIR); process.exit(1); }

const results = [];
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return Math.round(pct(s, 50) * 10) / 10; };
const p99 = (a) => { const s = a.slice().sort((x, y) => x - y); return Math.round(pct(s, 99) * 10) / 10; };
for (const tr of traces) {
  const base = { trace: tr.tag, ab_median_ms: med(tr.ab), ab_p99_ms: p99(tr.ab), ba_median_ms: med(tr.ba), ba_p99_ms: p99(tr.ba) };
  for (const batch of [1, 3, 4, 6]) {
    for (const D of [0, 1, 2, 3, 4]) {
      for (const W of [8, 12]) results.push(Object.assign({}, base, simulate(tr.ab, tr.ba, D, W, batch)));
    }
  }
}
const path = DIR + '/rollback_sim_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
writeFileSync(path, JSON.stringify({ tool: 'hit-parade/tools/research/net_rollback_sim.mjs', files, frames: FRAMES, results }, null, 2));
// compact print: D=2 and D=3 rows
for (const r of results.filter((r) => (r.D === 2 || r.D === 3) && (r.W === 8 || r.batch_frames > 1))) {
  console.log(`${r.trace.padEnd(36)} ${String(r.send_hz).padStart(2)}Hz D=${r.D} W=${r.W} speed=${r.game_speed_pct}% ` +
    `A depth p50/p90/p99=${r.A.depth_p50}/${r.A.depth_p90}/${r.A.depth_p99} stall=${r.A.stall_pct}% | B ${r.B.depth_p50}/${r.B.depth_p90}/${r.B.depth_p99} stall=${r.B.stall_pct}% ` +
    `(A>B ${r.ab_median_ms}/${r.ab_p99_ms}, B>A ${r.ba_median_ms}/${r.ba_p99_ms})`);
}
console.log('wrote', path);

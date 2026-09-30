// HIT PARADE - _harness/probe_netsim.ts (lane NET; CONTRACT §10, §13 G10; NETCODE 0.7 / 6 N4).
// Two RollbackSessions over a simulated network that replays the MEASURED one-way delay traces in
// _research/netcode/rtt_probe_*.json (`raw` rows: [seq, aSend, bRecv, bSend, aRecv] ms, same clock).
// Every trace runs on both tiers:
//   p2p   : 60 Hz packets, D = inputDelayFor(trace RTT median), W = 8
//   relay : 10 Hz batched packets (sendEvery 6 + <=10/s coalescing), D = 4, W = 12
// plus stress scenarios on one trace: 5% loss + 3% duplicates, clock drift (B ticks at 59.7 Hz), and a
// forced desync (B's sim perturbed EVERY time it simulates frame 1500, like a platform bug that survives
// re-simulation) that must be recovered by the host snapshot.
// Gates: game speed >= 96% on every trace x tier; 0 desyncs / 0 violations / 0 rejected packets outside
// the desync scenario; final confirmed checksums identical on both peers; the relay sends <= 10 packets/s
// per side; rollbacks actually happened (non-vacuous); packet codec round-trips and rejects malformed input.
//
// P2 (NET): every trace also runs on the relay with rAF-like TICK JITTER (frames 16.7 ms +- noise, 2% long frames with
// catch-up ticks, exactly the GameLoop accumulator), and the relay pacing is modelled as shipped (token bucket 10/s,
// burst 2, net/transport_relay.ts). `--pacing interval` models P1's pacing (one packet per 100 ms since the last flush):
// with jitter it holds packets 0..100 ms - the cause of P1's 91% live relay speed (progress_p2_net.md).
//
// Usage: node _harness/probe_netsim.ts [--toy] [--frames 3600] [--verbose] [--hide N] [--pacing bucket|interval] [--sweep]
//   --hide N  tuning only: P2P D = clamp(ceil(RTT/2/16.67) - N, 1, 4) instead of sync.ts DELAY_HIDE
//   --sweep   tuning only: DELAY_HIDE 1..4 x every trace x 4 start phases (p2p, jitter on): speed / delay / rollback table
// Exit 0 = PASS, 1 = FAIL; one summary line; details -> _harness/_reports/probe_netsim.json

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RollbackSession, type SimPort, type NetEvent } from '../runtime/src/core/net/rollback.ts';
import { SimLink, traceDelay } from '../runtime/src/core/net/loopback.ts';
import { ToySim } from '../runtime/src/core/net/toysim.ts';
import { IN, InputGen } from '../runtime/src/core/net/testinputs.ts';
import { RELAY_DELAY, RELAY_SEND_EVERY, RELAY_WINDOW, P2P_WINDOW, inputDelayFor } from '../runtime/src/core/net/sync.ts';
import {
  FLAG, PKT, decodeFrameMsg, decodeInput, decodeSnapshot, decodeSync, encodeFrameMsg, encodeInput, encodeSnapshot,
  encodeSync, newInputPacket,
} from '../runtime/src/core/net/packet.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRACE_DIR = resolve(ROOT, '_research/netcode');
const args = process.argv.slice(2);
const flag = (n: string): boolean => args.includes(n);
const opt = (n: string, d: number): number => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const VERBOSE = flag('--verbose');
const FRAMES = opt('--frames', 3600);
const SPEED_GATE = 0.96;
const HIDE = args.includes('--hide') ? opt('--hide', 3) : -1;
const PACING: 'bucket' | 'interval' = args.includes('--pacing') && args[args.indexOf('--pacing') + 1] === 'interval' ? 'interval' : 'bucket';
const FRAME_MS = 1000 / 60;

// ---- traces -------------------------------------------------------------------------------------------
interface Trace { tag: string; ab: number[]; ba: number[]; rttMedian: number; abMed: number; baMed: number; abP99: number; baP99: number }

function pct(sorted: number[], p: number): number { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]; }

function loadTraces(): Trace[] {
  const out: Trace[] = [];
  for (const f of readdirSync(TRACE_DIR).filter((x) => /^rtt_probe_.*\.json$/.test(x)).sort()) {
    let j: { phases?: { phase: string; raw?: number[][] }[] };
    try { j = JSON.parse(readFileSync(resolve(TRACE_DIR, f), 'utf8')); } catch { continue; }
    for (const ph of j.phases ?? []) {
      if (!ph.raw || ph.raw.length < 20) continue;
      const raw = ph.raw.slice().sort((a, b) => a[0] - b[0]);
      const ab = raw.map((r) => (r[2] == null ? 1e9 : r[2] - r[1]));
      const ba = raw.map((r) => (r[4] == null || r[3] == null ? 1e9 : r[4] - r[3]));
      const rtt = raw.filter((r) => r[4] != null).map((r) => r[4] - r[1]).sort((a, b) => a - b);
      const sab = ab.slice().sort((a, b) => a - b), sba = ba.slice().sort((a, b) => a - b);
      out.push({ tag: f.replace(/^rtt_probe_|\.json$/g, '') + ':' + ph.phase, ab, ba, rttMedian: pct(rtt, 50),
        abMed: pct(sab, 50), baMed: pct(sba, 50), abP99: pct(sab, 99), baP99: pct(sba, 99) });
    }
  }
  return out;
}

// ---- sims ---------------------------------------------------------------------------------------------
type Make = (seed: number) => SimPort;
async function simFactory(): Promise<{ kind: 'real' | 'toy'; make: Make; note: string; error?: string }> {
  const toy = { kind: 'toy' as const, make: (seed: number) => new ToySim(seed), note: 'toy sim (core/sim/match.ts absent)' };
  if (flag('--toy')) return { ...toy, note: 'toy sim (--toy)' };
  const matchPath = resolve(ROOT, 'runtime/src/core/sim/match.ts');
  const dataPath = resolve(ROOT, 'runtime/src/core/data.ts');
  if (!existsSync(matchPath) || !existsSync(dataPath)) return toy;
  try {
    const Dm = await import(pathToFileURL(dataPath).href);
    const Pm = await import(pathToFileURL(resolve(ROOT, 'runtime/src/core/net/match_port.ts')).href);
    const Mm = await import(pathToFileURL(matchPath).href);
    let data;
    let src = 'data/';
    try { data = Dm.loadGameData(); }
    catch (e) {
      const why = (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0].slice(0, 120);
      const Fx = await import(pathToFileURL(resolve(ROOT, '_harness/fixtures/simkit.ts')).href);
      data = Fx.fixtureData();
      src = `_harness/fixtures (data/ failed to load: ${why})`;
    }
    const ids = Object.keys(data.fighters).sort();
    const p1 = ids.includes('johnny') ? 'johnny' : ids[0];
    const p2 = ids.includes('bruno') ? 'bruno' : ids[ids.length - 1];
    const st = data.stages;
    const stage = Array.isArray(st) ? (st[0]?.id ?? st[0]) : st && Array.isArray(st.stages) ? st.stages[0].id : Object.keys(st ?? {})[0] ?? 'rust_theater';
    return { kind: 'real', note: `real sim ${p1} vs ${p2} @ ${stage}, data=${src}`, make: (seed: number) => Pm.matchPort(Mm.createMatch({ mode: 'online', stage, seed,
      p: [{ fighter: p1, color: 0, scheme: 0, cpu: -1 }, { fighter: p2, color: 1, scheme: 1, cpu: -1 }] }, data)) };
  } catch (e) {
    return { ...toy, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- one scenario -------------------------------------------------------------------------------------
interface Scn {
  name: string; trace: Trace; tier: 'p2p' | 'relay'; loss?: number; dup?: number; driftB?: number; corruptAt?: number; seed: number;
  /** rAF-like tick jitter on both sides (P2) */
  jitter?: boolean;
  /** start the trace this many samples in (sweep phases) */
  phase?: number;
  /** override DELAY_HIDE for this run (sweep) */
  hide?: number;
}

/**
 * The browser loop's tick times: rAF frames of 16.67 ms + noise (+-~2 ms), 2% long frames (+8..40 ms); every tick due
 * by a frame's time runs AT that frame (the GameLoop accumulator, <= 5 per frame). Without jitter: exact period.
 */
function tickClock(seed: number, start: number, period: number, jitter: boolean): { peek(): number; advance(): void } {
  let r = seed | 0;
  const rand = (): number => {
    const a = (r = (r + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let nominal = start;
  let frameT = start;
  let due = 0;
  return {
    peek(): number {
      if (!jitter) return nominal;
      while (frameT < nominal - 1e-9) {
        let d = FRAME_MS + (rand() + rand() - 1) * 2;
        if (rand() < 0.02) d += 8 + rand() * 32;
        frameT += d;
        due = 0;
      }
      return frameT;
    },
    advance(): void { nominal += period; due++; if (due >= 5 && jitter) { nominal = Math.max(nominal, frameT + 1e-6); due = 0; } },
  };
}
interface Row {
  name: string; trace: string; tier: string; D: number; W: number; speedA: number; speedB: number; speed: number;
  stallTicksA: number; stallTicksB: number; skipTicksA: number; skipTicksB: number;
  depthP50: number; depthP90: number; depthP99: number; rollbacks: number; maxRollback: number; rollbackFramesAvg: number;
  desyncs: number; violations: number; rejected: number; checksumsCompared: number; finalFramesCompared: number; finalEqual: boolean;
  sentPerSecA: number; sentPerSecB: number; rttEstMs: number; framesA: number; framesB: number; events: string[]; pass: boolean; why: string[];
  jitter: boolean; heldPct: number; holdMsAvg: number; wallSpeed: number;
}

function histPct(h: Int32Array, p: number): number {
  let n = 0;
  for (let i = 0; i < h.length; i++) n += h[i];
  if (!n) return 0;
  const target = Math.ceil((p / 100) * n);
  let c = 0;
  for (let i = 0; i < h.length; i++) { c += h[i]; if (c >= target) return i; }
  return h.length - 1;
}

/**
 * Models a real platform-dependent sim bug on peer B: EVERY time B simulates frame `at` (first pass and
 * every re-simulation) its state is perturbed the same way, so rollbacks cannot erase it. The frame is
 * tracked through save/load by remembering which frame each ring slot holds.
 */
function divergent(inner: SimPort, at: number): SimPort {
  let frame = 0;
  const slotFrame = new WeakMap<Int32Array, number>();
  const tmp = new Int32Array(inner.stateInts);
  return {
    stateInts: inner.stateInts,
    step(a: number, b: number): void {
      inner.step(a, b);
      frame++;
      if (frame === at) {
        inner.save(tmp);
        tmp[Math.floor(tmp.length / 2) + 3] ^= 0x155;
        tmp[tmp.length > 40 ? 24 : 1] += 777;
        inner.load(tmp);
      }
    },
    save(slot: Int32Array): void { inner.save(slot); slotFrame.set(slot, frame); },
    load(slot: Int32Array): void { inner.load(slot); frame = slotFrame.get(slot) ?? -1e9; },
    checksum: () => inner.checksum(),
  };
}

function run(s: Scn, make: Make): Row {
  let t = 0;
  const relay = s.tier === 'relay';
  const hide = s.hide ?? HIDE;
  const D = relay ? RELAY_DELAY : hide >= 0 ? Math.max(1, Math.min(4, Math.ceil(s.trace.rttMedian / 2 / FRAME_MS) - hide)) : inputDelayFor(s.trace.rttMedian);
  const W = relay ? RELAY_WINDOW : P2P_WINDOW;
  const sendEvery = relay ? RELAY_SEND_EVERY : 1;
  const off = (s.phase ?? 0) * FRAME_MS;
  const ab = traceDelay(s.trace.ab), ba = traceDelay(s.trace.ba);
  const link = new SimLink({ now: () => t, delayAB: (x) => ab(x + off), delayBA: (x) => ba(x + off), lossPct: s.loss ?? 0,
    dupPct: s.dup ?? 0, seed: s.seed * 31 + 7, minIntervalMs: relay ? 100 : 0, pacing: relay ? PACING : 'interval', rate: 10, burst: 2,
    kind: relay ? 'relay' : 'loop' });
  const matchSeed = 1000 + s.seed;
  const simA = make(matchSeed), simB = s.corruptAt ? divergent(make(matchSeed), s.corruptAt) : make(matchSeed);
  const events: string[] = [];
  const onEv = (side: string) => (e: NetEvent) => { if (events.length < 40) events.push(side + ':' + JSON.stringify(e)); };
  const A = new RollbackSession(simA, 0, link.a, { now: () => t, delay: D, window: W, sendEvery, startAt: 0, onEvent: onEv('A') });
  const B = new RollbackSession(simB, 1, link.b, { now: () => t, delay: D, window: W, sendEvery, startAt: 12, onEvent: onEv('B') });
  const gA = new InputGen(s.seed * 7 + 1, IN.R), gB = new InputGen(s.seed * 13 + 2, IN.L);
  const periodA = FRAME_MS, periodB = FRAME_MS * (s.driftB ? 60 / s.driftB : 1);
  const cA = tickClock(s.seed * 97 + 3, 0, periodA, !!s.jitter), cB = tickClock(s.seed * 89 + 5, 12, periodB, !!s.jitter);
  const tail = 90;
  let guard = 0;
  while (guard++ < (FRAMES + tail) * 6) {
    const fa = A.currentFrame(), fb = B.currentFrame();
    if (fa >= FRAMES + tail && fb >= FRAMES + tail && A.confirmedFrame() >= FRAMES + 45 && B.confirmedFrame() >= FRAMES + 45) break;
    const ta = cA.peek(), tb = cB.peek();
    if (ta <= tb) { t = ta; A.tick(fa < FRAMES ? gA.next() : 0); cA.advance(); }
    else { t = tb; B.tick(fb < FRAMES ? gB.next() : 0); cB.advance(); }
  }
  const sa = A.stats(), sb = B.stats();
  // final: every checksum frame both logs still hold must agree
  let compared = 0, equal = true;
  const last = Math.min(A.confirmedFrame(), B.confirmedFrame());
  for (let f = last - (last % 15); f >= 0 && f > last - 15 * 60; f -= 15) {
    const ca = A.checksumAt(f), cb = B.checksumAt(f);
    if (ca === null || cb === null) continue;
    compared++;
    if (ca !== cb) equal = false;
  }
  const hist = new Int32Array(33);
  for (let i = 0; i < 33; i++) hist[i] = A.depthHist[i] + B.depthHist[i];
  const secs = t / 1000;
  const row: Row = {
    name: s.name, trace: s.trace.tag, tier: s.tier, D, W,
    speedA: round4(sa.gameSpeed), speedB: round4(sb.gameSpeed), speed: round4(Math.min(sa.gameSpeed, sb.gameSpeed)),
    stallTicksA: sa.stallTicks, stallTicksB: sb.stallTicks, skipTicksA: sa.skipTicks, skipTicksB: sb.skipTicks,
    depthP50: histPct(hist, 50), depthP90: histPct(hist, 90), depthP99: histPct(hist, 99),
    rollbacks: sa.rollbacks + sb.rollbacks, maxRollback: Math.max(sa.maxRollback, sb.maxRollback),
    rollbackFramesAvg: sa.rollbacks + sb.rollbacks ? Math.round(((sa.rollbackFrames + sb.rollbackFrames) / (sa.rollbacks + sb.rollbacks)) * 100) / 100 : 0,
    desyncs: Math.max(sa.desyncs, sb.desyncs), violations: sa.violations + sb.violations, rejected: sa.rejected + sb.rejected,
    checksumsCompared: sa.checksumsCompared + sb.checksumsCompared, finalFramesCompared: compared, finalEqual: equal && compared > 0,
    sentPerSecA: Math.round((link.a.sentInput / secs) * 100) / 100, sentPerSecB: Math.round((link.b.sentInput / secs) * 100) / 100,
    rttEstMs: Math.round(sa.rttMedianMs), framesA: sa.frame, framesB: sb.frame, events, pass: true, why: [],
    jitter: !!s.jitter,
    heldPct: link.a.sentInput + link.b.sentInput ? Math.round(((link.a.held + link.b.held) / (link.a.sentInput + link.b.sentInput)) * 1000) / 10 : 0,
    holdMsAvg: link.a.held + link.b.held ? Math.round(((link.a.holdMsSum + link.b.holdMsSum) / (link.a.sentInput + link.b.sentInput)) * 10) / 10 : 0,
    wallSpeed: round4(Math.min(sa.wallSpeed, sb.wallSpeed)),
  };
  const why = row.why;
  if (row.speed < SPEED_GATE) why.push(`speed ${(row.speed * 100).toFixed(2)}% < 96%`);
  if (!row.finalEqual) why.push(`final checksums ${compared ? 'DIFFER' : 'not comparable'}`);
  if (s.corruptAt) {
    if (row.desyncs < 1) why.push('corruption not detected');
    if (row.desyncs > 2) why.push(`desyncs ${row.desyncs} > 2 (no contest)`);
    if (!events.some((e) => e.includes('"recovered"'))) why.push('no recovery event');
  } else if (row.desyncs) why.push(`desyncs ${row.desyncs}`);
  if (row.violations) why.push(`violations ${row.violations}`);
  if (row.rejected) why.push(`rejected ${row.rejected}`);
  if (relay && (row.sentPerSecA > 10.5 || row.sentPerSecB > 10.5)) why.push(`relay rate ${row.sentPerSecA}/${row.sentPerSecB} pkt/s > 10`);
  if (sa.status === 'nocontest' || sb.status === 'nocontest') why.push('no contest');
  row.pass = why.length === 0;
  return row;
}

function round4(x: number): number { return Math.round(x * 10000) / 10000; }

// ---- packet codec checks (NETCODE 6 N1, folded in) ----------------------------------------------------
function codecChecks(): string[] {
  const errs: string[] = [];
  const r = new InputGen(99, IN.R);
  const ring = new Int32Array(256);
  const out = newInputPacket();
  for (let it = 0; it < 2000; it++) {
    for (let i = 0; i < 256; i++) ring[i] = r.next() & 0xffff;
    const n = 1 + (it % 32), first = it * 7 % 256, cs = it % 3 === 0;
    const p = { flags: (cs ? FLAG.CHECKSUM : 0) | (it & 1 ? FLAG.RELAY : 0), seq: it * 13 & 0xffff, startFrame: it * 5, ackFrame: it % 5 === 0 ? -1 : it * 5 - 3,
      advantage: (it % 255) - 127, tsLow: it * 17, echoTs: it * 3, echoHold: it % 11 === 0 ? 0xffff : it % 400, csFrame: cs ? it * 15 : -1, checksum: cs ? (it * 2654435761) | 0 : 0 };
    const b = encodeInput(p, ring, first, n, 255);
    if (!decodeInput(b, out)) { errs.push('round-trip decode failed at ' + it); break; }
    if (out.count !== n || out.startFrame !== p.startFrame || out.ackFrame !== p.ackFrame || out.seq !== p.seq || out.advantage !== p.advantage ||
        out.tsLow !== (p.tsLow & 0xffff) || out.echoHold !== p.echoHold || out.csFrame !== p.csFrame || out.checksum !== p.checksum) { errs.push('field mismatch at ' + it); break; }
    for (let k = 0; k < n; k++) if (out.inputs[k] !== ring[(first + k) & 255]) { errs.push('word mismatch at ' + it); break; }
    // malformed variants must be rejected
    const bad1 = b.slice(0, b.length - 1);
    const bad2 = b.slice(); bad2[13] = 0;
    const bad3 = b.slice(); bad3[13] = 33;
    const bad4 = b.slice(); bad4[0] = 0x02;
    const bad5 = b.slice(); bad5[1] ^= FLAG.CHECKSUM;
    for (const [nm, x] of [['short', bad1], ['n=0', bad2], ['n=33', bad3], ['type', bad4], ['cs-flag', bad5]] as [string, Uint8Array][]) {
      if (decodeInput(x, out)) { errs.push(`malformed ${nm} accepted at ${it}`); return errs; }
    }
  }
  const st = new Int32Array(300); for (let i = 0; i < 300; i++) st[i] = (i * 2654435761) | 0;
  const snap = decodeSnapshot(encodeSnapshot(1234, 77, st), 300);
  if (!snap || snap.frame !== 1234 || snap.checksum !== 77 || snap.state.some((v, i) => v !== st[i])) errs.push('snapshot round-trip');
  if (decodeSnapshot(encodeSnapshot(1, 1, st), 299)) errs.push('snapshot size mismatch accepted');
  const fm = decodeFrameMsg(encodeFrameMsg(PKT.DELAY, 4242, 3));
  if (!fm || fm.frame !== 4242 || fm.arg !== 3 || fm.type !== PKT.DELAY) errs.push('frame msg round-trip');
  const sy = decodeSync(encodeSync(PKT.SYNC_PING, 9, 123.5));
  if (!sy || sy.seq !== 9 || sy.t !== 123.5) errs.push('sync round-trip');
  return errs;
}

// ---- main ---------------------------------------------------------------------------------------------
async function main(): Promise<number> {
  const traces = loadTraces();
  const sim = await simFactory();
  const report: Record<string, unknown> = { tool: '_harness/probe_netsim.ts', started: new Date().toISOString(), frames: FRAMES, sim: sim.kind, note: sim.note };
  if (sim.error) {
    report.error = sim.error;
    write(report);
    console.log(`FAIL probe_netsim: core/sim/match.ts exists but failed to load: ${sim.error.split('\n')[0]} (use --toy)`);
    return 1;
  }
  const codec = codecChecks();
  if (!traces.length) { console.log('FAIL probe_netsim: no raw traces in _research/netcode'); return 1; }
  const rows: Row[] = [];
  let seed = 1;
  if (flag('--sweep')) { sweep(traces, sim.make); return 0; }
  for (const tr of traces) {
    rows.push(run({ name: 'p2p', trace: tr, tier: 'p2p', seed: seed++ }, sim.make));
    rows.push(run({ name: 'relay', trace: tr, tier: 'relay', seed: seed++ }, sim.make));
    rows.push(run({ name: 'relay+jitter', trace: tr, tier: 'relay', jitter: true, seed: seed++ }, sim.make));
  }
  const worst = traces.slice().sort((a, b) => (b.abP99 + b.baP99) - (a.abP99 + a.baP99))[0];
  rows.push(run({ name: 'loss5+dup3', trace: worst, tier: 'p2p', loss: 5, dup: 3, seed: seed++ }, sim.make));
  rows.push(run({ name: 'relay loss5', trace: worst, tier: 'relay', loss: 5, seed: seed++ }, sim.make));
  rows.push(run({ name: 'drift B 59.7Hz', trace: worst, tier: 'p2p', driftB: 59.7, seed: seed++ }, sim.make));
  rows.push(run({ name: 'p2p+jitter', trace: worst, tier: 'p2p', jitter: true, seed: seed++ }, sim.make));
  rows.push(run({ name: 'desync@1500', trace: worst, tier: 'p2p', corruptAt: 1500, seed: seed++ }, sim.make));
  rows.push(run({ name: 'relay desync@1500', trace: worst, tier: 'relay', corruptAt: 1500, seed: seed++ }, sim.make));
  const rollbacksTotal = rows.reduce((a, r) => a + r.rollbacks, 0);
  const failed = rows.filter((r) => !r.pass);
  const pass = failed.length === 0 && codec.length === 0 && rollbacksTotal > 0;
  Object.assign(report, { traces: traces.map((t) => ({ tag: t.tag, rttMedian: t.rttMedian, abMed: t.abMed, abP99: t.abP99, baMed: t.baMed, baP99: t.baP99 })), codec, rows });
  write(report);
  if (VERBOSE || !pass) {
    for (const r of rows) {
      console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name.padEnd(18)} ${r.trace.padEnd(40)} D=${r.D} W=${r.W} speed=${(r.speed * 100).toFixed(2)}% wall=${(r.wallSpeed * 100).toFixed(2)}% held=${r.heldPct}% hold~${r.holdMsAvg}ms ` +
        `depth p50/p90/p99=${r.depthP50}/${r.depthP90}/${r.depthP99} rb=${r.rollbacks} max=${r.maxRollback} desync=${r.desyncs} cs=${r.checksumsCompared} ` +
        `stall=${r.stallTicksA}/${r.stallTicksB} skip=${r.skipTicksA}/${r.skipTicksB} final=${r.finalEqual ? 'eq' : 'NE'}(${r.finalFramesCompared}) pkt/s=${r.sentPerSecA}/${r.sentPerSecB} rtt~${r.rttEstMs}${r.why.length ? ' <- ' + r.why.join('; ') : ''}`);
    }
    if (codec.length) console.log('codec: ' + codec.join('; '));
  }
  const tierRows = rows.filter((r) => r.name === 'p2p' || r.name === 'relay');
  const minP2P = Math.min(...tierRows.filter((r) => r.tier === 'p2p').map((r) => r.speed));
  const minRelay = Math.min(...tierRows.filter((r) => r.tier === 'relay').map((r) => r.speed));
  const jitRows = rows.filter((r) => r.name === 'relay+jitter');
  const minRelayJ = Math.min(...jitRows.map((r) => r.speed));
  const heldJ = jitRows.length ? Math.max(...jitRows.map((r) => r.heldPct)) : 0;
  console.log(`${pass ? 'PASS' : 'FAIL'} probe_netsim sim=${sim.kind} [${sim.note}] traces=${traces.length} scenarios=${rows.length} ` +
    `min speed p2p=${(minP2P * 100).toFixed(2)}% relay=${(minRelay * 100).toFixed(2)}% relay+jitter=${(minRelayJ * 100).toFixed(2)}% (gate 96%; pacing=${PACING}, held<=${heldJ}%) rollbacks=${rollbacksTotal} ` +
    `desync-recovery=${rows.filter((r) => r.name.includes('desync')).every((r) => r.pass) ? 'ok' : 'FAIL'} codec=${codec.length ? 'FAIL' : 'ok'}` +
    (failed.length ? ` failed=[${failed.map((r) => r.name + '@' + r.trace + ': ' + r.why.join(', ')).join(' | ')}]` : ''));
  return pass ? 0 : 1;
}

/** DELAY_HIDE tuning (NETCODE 3.3 "-3"): hide 1..4 x every trace x 4 start phases, p2p with tick jitter. */
function sweep(traces: Trace[], make: Make): void {
  const res: Record<string, unknown>[] = [];
  for (const hide of [1, 2, 3, 4]) {
    const speeds: number[] = [], Ds: number[] = [], rbps: number[] = [], rbAvg: number[] = [], depth90: number[] = [];
    let seed = 500;
    for (const tr of traces) {
      for (const phase of [0, 50, 100, 150]) {
        const r = run({ name: 'sweep', trace: tr, tier: 'p2p', jitter: true, phase, hide, seed: seed++ }, make);
        speeds.push(r.speed); Ds.push(r.D); rbps.push(r.rollbacks / (2 * FRAMES / 60)); rbAvg.push(r.rollbackFramesAvg); depth90.push(r.depthP90);
      }
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const row = { hide, runs: speeds.length, minSpeed: round4(Math.min(...speeds)), meanSpeed: round4(mean(speeds)), below96: speeds.filter((x) => x < 0.96).length,
      meanD: Math.round(mean(Ds) * 100) / 100, rollbacksPerSidePerSec: Math.round(mean(rbps) * 100) / 100, meanRollbackLen: Math.round(mean(rbAvg) * 100) / 100,
      meanDepthP90: Math.round(mean(depth90) * 100) / 100 };
    res.push(row);
    console.log(`hide=${hide} runs=${row.runs} min speed ${(row.minSpeed * 100).toFixed(2)}% mean ${(row.meanSpeed * 100).toFixed(2)}% below96=${row.below96} ` +
      `mean D=${row.meanD} rollbacks/side/s=${row.rollbacksPerSidePerSec} mean rollback len=${row.meanRollbackLen} mean depth p90=${row.meanDepthP90}`);
  }
  try {
    const dir = resolve(ROOT, '_harness/_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'probe_netsim_sweep.json'), JSON.stringify({ started: new Date().toISOString(), frames: FRAMES, rows: res }, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
}

function write(report: Record<string, unknown>): void {
  try {
    const dir = resolve(ROOT, '_harness/_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'probe_netsim.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
}

main().then((c) => process.exit(c), (e) => { console.log('FAIL probe_netsim crashed: ' + (e instanceof Error ? (e.stack ?? e.message) : String(e))); process.exit(1); });

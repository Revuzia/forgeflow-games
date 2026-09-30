// HIT PARADE - lab/net.ts (lane NET, dev only; never linked from index.html).
// Two tabs / two browsers join one room over Supabase (NetPlay), open the WebRTC DataChannels (or the
// relay with ?relay=1), measure RTT, run the blind-select commit-reveal, then a rollback session on the
// toy sim for `secs` seconds of human-like random inputs, and agree on the final confirmed checksum.
// URL: /lab/net.html?room=CODE&auto=1&secs=20&tag=a   (or ?quick=1&auto=1). window.__NETLAB__ = results;
// with a dev server the result is also POSTed to /__report/net_lab_<tag>.

import { OnlineFlow } from '../net/online_flow.ts';
import { NetPlay } from '../net/netplay.ts';
import { ToySim, TOY_STATE_INTS } from '../core/net/toysim.ts';
import { IN, InputGen } from '../core/net/testinputs.ts';
import { hashString } from '../core/net/sync.ts';
import type { RollbackSession, Transport } from '../core/net/rollback.ts';

const q = new URLSearchParams(location.search);

const SECS = Math.max(3, Math.min(120, Number(q.get('secs') ?? 20) || 20));
const FRAMES = Math.round(SECS * 60);
/** ?lag=ms: extra one-way latency added on RECEIVE on each side (so RTT += 2 x lag) to exercise rollback. */
const LAG = Math.max(0, Math.min(400, Number(q.get('lag') ?? 0) || 0));
/** ?killrtc=S: this side closes its DataChannels S seconds into the match (mid-match relay fallback test). */
const KILL_AT = Math.round((Number(q.get('killrtc') ?? 0) || 0) * 60);
let killed = false;
/** ?rematch=N: after an agreed result, both accept N rematches (new blind select, new seed, match epoch + 1). */
const REMATCHES = Math.max(0, Math.min(5, Number(q.get('rematch') ?? 0) || 0));
/** ?again=1: after the first session ends and both LEAVE, the same OnlineFlow object starts a second session
 *  (room code + 'B', or quick match again): game.ts keeps one Online for the whole visit. */
const AGAIN = q.get('again') === '1';
let sessionNo = 0;
const TAG = (q.get('tag') ?? 'x').replace(/[^a-z0-9_-]/gi, '').slice(0, 16) || 'x';
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

interface LabResult {
  tag: string; done: boolean; ok: boolean; phase: string; room: string; local: number; transport: string;
  syncRttMs: number; syncRtts: number[]; sessionRttMedianMs: number; delay: number; pair: unknown;
  frames: number; target: number; confirmed: number; gameSpeed: number; rollbacks: number; maxRollback: number; rollbackFrames: number;
  stallTicks: number; skipTicks: number; sent: number; recv: number; lossPct: number; reordered: number; desyncs: number;
  checksumsCompared: number; finalCsFrame: number; finalCs: number | null; agreed: boolean | null; reason: string;
  supabase: { msgs: number; binary: number; dropped: number }; errors: string[]; startedAt: string; ms: number;
  matches: { index: number; seed: number; stage: string; frames: number; finalCs: number | null; agreed: boolean; reason: string; stale: number; desyncs: number }[];
  sessions: { room: string; ok: boolean; finalCs: number | null; matches: number; errors: string[] }[];
}

const result: LabResult = {
  tag: TAG, done: false, ok: false, phase: 'idle', room: '', local: -1, transport: 'none', syncRttMs: -1, syncRtts: [], sessionRttMedianMs: -1,
  delay: -1, pair: null, frames: 0, target: FRAMES, confirmed: 0, gameSpeed: 0, rollbacks: 0, maxRollback: 0, rollbackFrames: 0,
  stallTicks: 0, skipTicks: 0, sent: 0, recv: 0, lossPct: 0, reordered: 0, desyncs: 0, checksumsCompared: 0, finalCsFrame: -1, finalCs: null,
  agreed: null, reason: '', supabase: { msgs: 0, binary: 0, dropped: 0 }, errors: [], startedAt: new Date().toISOString(), ms: 0, matches: [], sessions: [],
};
let curSeed = 0;
let curStage = '';
(window as unknown as { __NETLAB__: LabResult }).__NETLAB__ = result;

const t0 = performance.now();
const logLines: string[] = [];
function log(m: string, d?: unknown): void {
  const line = `${((performance.now() - t0) / 1000).toFixed(2)}s ${m}${d === undefined ? '' : ' ' + safeJson(d)}`;
  logLines.push(line);
  if (logLines.length > 300) logLines.shift();
  $('logtext').textContent = logLines.slice().reverse().join('\n');
}
function safeJson(d: unknown): string { try { return JSON.stringify(d); } catch { return String(d); } }

function lagged(t: Transport): Transport {
  if (!LAG) return t;
  const held: { b: Uint8Array; ctl: boolean; at: number }[] = [];
  return {
    kind: t.kind,
    sendInput: (b) => t.sendInput(b),
    sendCtl: (b) => t.sendCtl(b),
    drain(cb): void {
      t.drain((b, ctl, at) => { held.push({ b, ctl, at: (at ?? performance.now()) + LAG }); });
      const now = performance.now();
      while (held.length && held[0].at <= now) { const it = held.shift() as { b: Uint8Array; ctl: boolean; at: number }; cb(it.b, it.ctl, it.at); }
    },
  };
}

const flow = new OnlineFlow({
  version: 'netlab-1', dataHash: hashString('toysim-v1'), stateVersion: TOY_STATE_INTS, fighters: ['toy'], stages: ['lab'],
  name: 'lab-' + TAG, forceRelay: q.get('relay') === '1', ratings: false, log: (m, d) => log(m, d), wrapTransport: lagged,
});

let session: RollbackSession | null = null;
let gen: InputGen | null = null;
let finishedSent = false;

flow.on('status', ((s: { code: string }) => { $('phase').textContent = `phase: ${flow.phase}  ${s.code}`; }) as never);
flow.on('error', ((e: { code: string }) => { result.errors.push(e.code); log('ERROR ' + e.code); }) as never);
flow.on('select', (() => { flow.pick({ fighter: 'toy', color: 0, scheme: 0 }); }) as never);
flow.on('matchStart', ((cfg: { seed: number; stage: string }, local: 0 | 1) => {
  log('matchStart', { cfg, local });
  finishedSent = false;
  curSeed = cfg.seed;
  curStage = cfg.stage;
  gen = new InputGen((cfg.seed ^ (local ? 0x5bd1e995 : 0x1234567)) | 0, local === 0 ? IN.R : IN.L);
  session = flow.attachPort(new ToySim(cfg.seed | 0));
  result.local = local;
}) as never);
flow.on('matchEnd', ((r: { agreed: boolean; reason: string }) => {
  log('matchEnd', r);
  result.agreed = r.agreed;
  result.reason = r.reason;
  const st = session ? session.stats() : null;
  const csf = Math.floor(FRAMES / 15) * 15;
  result.matches.push({ index: result.matches.length, seed: curSeed, stage: curStage, frames: st ? st.frame : 0, finalCs: session ? session.checksumAt(csf) : null,
    agreed: r.agreed, reason: r.reason, stale: st ? st.stale : 0, desyncs: st ? st.desyncs : 0 });
  if (r.agreed && result.matches.length <= REMATCHES) { log('accepting rematch ' + result.matches.length); flow.rematch(true); return; }
  complete();
}) as never);
flow.on('end', ((e: { reason: string }) => { log('end ' + e.reason); if (!result.done) { result.reason = result.reason || e.reason; complete(); } }) as never);

// 60 Hz fixed-step pump (setInterval so it also runs where rAF is throttled)
let next = performance.now();
setInterval(() => {
  const s = session;
  const now = performance.now();
  if (!s) { next = now; return; }
  if (now - next > 250) next = now;               // tab was frozen: do not spiral
  while (now >= next) {
    const f = s.currentFrame();
    if (KILL_AT > 0 && !killed && f >= KILL_AT) { killed = true; flow.devKillDirect(); log('killed direct path at frame ' + f); }
    s.tick(f < FRAMES && gen ? gen.next() : 0);
    next += 1000 / 60;
    if (!finishedSent && f >= FRAMES + 30) {
      finishedSent = true;
      flow.finish({ winner: -1, frame: FRAMES });
      log('finish requested at frame ' + FRAMES);
    }
  }
}, 4);

setInterval(render, 250);

function snapshot(): void {
  const st = flow.stats();
  const ss = st.session;
  result.phase = st.phase; result.room = st.room; result.transport = st.transport; result.syncRttMs = Math.round(st.rttMs * 10) / 10;
  result.delay = ss ? ss.delay : st.delay; result.pair = st.pair; result.supabase = st.supabase;
  if (ss) {
    result.frames = ss.frame; result.confirmed = ss.confirmed; result.gameSpeed = Math.round(ss.gameSpeed * 10000) / 10000; result.rollbacks = ss.rollbacks;
    result.maxRollback = ss.maxRollback; result.rollbackFrames = ss.rollbackFrames; result.stallTicks = ss.stallTicks; result.skipTicks = ss.skipTicks;
    result.sent = ss.sent; result.recv = ss.recv; result.lossPct = Math.round(ss.lossPct * 100) / 100; result.reordered = ss.reordered;
    result.desyncs = ss.desyncs; result.checksumsCompared = ss.checksumsCompared; result.sessionRttMedianMs = ss.rttMedianMs;
  }
  const syncLine = flow.log.find((l) => l.m === 'sync');
  if (syncLine && syncLine.d && typeof syncLine.d === 'object') result.syncRtts = ((syncLine.d as { rtts?: number[] }).rtts ?? []).slice();
  if (session) {
    result.finalCsFrame = Math.floor(FRAMES / 15) * 15;
    result.finalCs = session.checksumAt(result.finalCsFrame);
  }
  result.ms = Math.round(performance.now() - t0);
}

function render(): void {
  snapshot();
  const r = result;
  $('stats').textContent = [
    `room ${r.room || '-'}  local slot ${r.local}  transport ${r.transport}`,
    `sync RTT ${r.syncRttMs} ms (pings ${r.syncRtts.join(', ')})`,
    `session RTT median ${r.sessionRttMedianMs} ms  D=${r.delay}`,
    `pair ${safeJson(r.pair)}`,
    `frame ${r.frames}/${r.target}  confirmed ${r.confirmed}  speed ${(r.gameSpeed * 100).toFixed(2)}%`,
    `rollbacks ${r.rollbacks} (max ${r.maxRollback}, frames ${r.rollbackFrames})  stalls ${r.stallTicks}  skips ${r.skipTicks}`,
    `packets sent ${r.sent} recv ${r.recv} loss ${r.lossPct}% reordered ${r.reordered}`,
    `desyncs ${r.desyncs}  checksums compared ${r.checksumsCompared}`,
    `final cs @${r.finalCsFrame} = ${r.finalCs}  agreed ${r.agreed}`,
    `supabase msgs ${r.supabase.msgs} binary ${r.supabase.binary} dropped ${r.supabase.dropped}`,
    `errors ${r.errors.join(', ') || '-'}  done ${r.done} ok ${r.ok}`,
  ].join('\n');
}

let completed = false;
function complete(): void {
  if (completed) return;
  completed = true;
  snapshot();
  result.ok = result.agreed === true && result.desyncs === 0 && result.errors.length === 0 && result.frames >= FRAMES &&
    result.matches.length === REMATCHES + 1 && result.matches.every((m) => m.agreed);
  render();
  log(result.ok ? 'LAB OK' : 'LAB NOT OK', { agreed: result.agreed, desyncs: result.desyncs, errors: result.errors });
  result.done = !(AGAIN && sessionNo === 0);
  if (AGAIN && sessionNo === 0) {
    result.sessions.push({ room: result.room, ok: result.ok, finalCs: result.finalCs, matches: result.matches.length, errors: result.errors.slice() });
    sessionNo = 1;
    setTimeout(() => flow.leave(), 1500);
    setTimeout(() => {
      // second session on the SAME flow object
      completed = false; finishedSent = false; session = null; gen = null; killed = false;
      Object.assign(result, { done: false, ok: false, agreed: null, reason: '', errors: [], matches: [], frames: 0, confirmed: 0, finalCs: null });
      const r0 = q.get('room');
      log('--- second session on the same OnlineFlow');
      if (r0) void flow.join(NetPlay.cleanCode(r0) + 'B'); else void flow.quick(60000);
    }, 4000);
    return;
  }
  if (AGAIN) result.sessions.push({ room: result.room, ok: result.ok, finalCs: result.finalCs, matches: result.matches.length, errors: result.errors.slice() });
  if (AGAIN) result.ok = result.ok && result.sessions.length === 2 && result.sessions.every((x) => x.ok);
  void fetch('/__report/net_lab_' + TAG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...result, log: logLines }) }).catch(() => { /* no dev server */ });
  setTimeout(() => flow.leave(), 1500);
}

// ---- buttons / auto-start ---------------------------------------------------------------------------------
function showLink(code: string): void {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('room', code);
  u.searchParams.set('auto', '1');
  $('link').textContent = 'join link: ' + u.toString();
}
$('create').addEventListener('click', () => { void flow.create().then((code) => { showLink(code); log('room ' + code); }); });
$('join').addEventListener('click', () => { const c = ($('code') as HTMLInputElement).value; if (c) void flow.join(NetPlay.cleanCode(c)); });
$('quick').addEventListener('click', () => { void flow.quick(); });
$('leave').addEventListener('click', () => flow.leave());

const room = q.get('room');
if (room) { showLink(NetPlay.cleanCode(room)); void flow.join(NetPlay.cleanCode(room)); }
else if (q.get('quick') === '1') void flow.quick(60000);
log(`lab ready: secs=${SECS} tag=${TAG} relay=${q.get('relay') === '1'} lag=${LAG}`);

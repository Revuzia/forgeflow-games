// BLOCKTOOTH - _harness/net/probe_net4.ts (lane B-NET; ONLINE_PLAN.md 6.3 gate H2, netcode.md 8 H2).
//
// 4 lockstep peers (src/net/lockstep.ts) in ONE Node process, each with its own World driven by the real
// createWorld / stepWorld through src/net/simport.ts soloWorldPort (the current 1-titan World: the titan's pilot
// rotates between the 4 seats every 10 s, so every seat's stream reaches the sim), over _harness/net/simnet.ts
// (per-pair delay, loss, duplicates, blackouts; reliable + unreliable channels). Virtual time, 1 ms resolution; each
// peer pumps from an emulated 30 Hz Worker timer with jitter and rare 60-150 ms stalls.
//
// Gates (H2 a-h, as far as the 1-titan World allows):
//   (a) hashes equal: every checkpoint (world hash + frame-log hash, every 30 ticks) identical on every peer that
//       should agree (a deliberately perturbed peer is excluded after its perturbation; a killed host's checkpoints
//       before its death must agree too)
//   (b) game speed >= 96 % under jitter: endTick / (finish time / 33.3 ms) on every live peer
//   (c) late input repeated, never a stall: a guest with uplink blackouts + spikes -> lateRepeats > 0 on the
//       authority, lateSeen > 0 on that guest, and the authority's production lag never exceeds its own timer stalls
//   (d) forced desync (1-ulp perturbation of one peer's titan.x) caught at the next checkpoint (<= 30 ticks); the
//       desynced peer drops out, the other 3 continue with equal hashes and its seat becomes a bot
//   (e) host killed at a seeded random tick -> the lowest surviving id becomes the authority, hashes still equal,
//       the match reaches its end
//   (f) AFK guest (inputs muted 8 s) -> botMask on its seat within AFK_MS + latency, identical on every peer
//       (canonical frames), cleared when inputs resume
//   (g) replay join at 2:00 into a bot seat: the joiner's replayed + live checkpoints match the live peers and the
//       seat flips to human at the switch tick; a join request after 3:00 is refused ('late')
//   (h) final standings agree on every peer (standings hash + every received RESULT)
// Robustness (a peer's own main-thread stall must never look like a dead authority; queued packets are delivered AFTER
// the stalled peer's first pump, the adversarial order):
//   stall     a guest freezes 2.5 s -> no election, no migration, hashes equal, speed >= 96 %
//   hoststall the host freezes 2.5 s (its last 300 ms of frames lost) -> the guests elect p1; the old host steps down,
//             finds its last frames overwritten, rebuilds its world from tick 0 out of its own log, takes its seat back
//             (rejoin, no download) and stays in sync to the end
//   joinkill  a replay-joiner holding the LOWEST id joins at 0:30, then the host is killed -> the joiner is elected
// plus codec unit checks (round trip + malformed input rejected).
//
// Usage: node _harness/net/probe_net4.ts                 # every scenario, 5 child processes in parallel
//        node _harness/net/probe_net4.ts --scenario jitter [--minutes 4] [--seed 1337] [--verbose]
//        node _harness/net/probe_net4.ts --par 6 --minutes 4
// Exit 0 = PASS, 1 = FAIL, 2 = the sim could not be loaded. Report -> _harness/_reports/probe_net4.json

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { World } from '../../src/core/types.ts';
import {
  AFK_MS, HASH_EVERY, JOIN_CUTOFF_TICK, NET_PROTO, SEATS, TICK_MS, type Frame, type StartInfo,
  decodeCtl, decodeFramePkt, decodeHashPkt, decodeInput, decodeInputPkt, decodeLogPkt, encodeCtl, encodeFramePkt,
  encodeHashPkt, encodeInput, encodeInputPkt, encodeLogPkt,
} from '../../src/net/proto.ts';
import { LockstepPeer, type NetEvent } from '../../src/net/lockstep.ts';
import { type SimPort, soloWorldPort } from '../../src/net/simport.ts';
import { SimNet, jitterDelay, traceDelay, type LinkModel } from './simnet.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (n: string, d: string): string => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const flag = (n: string): boolean => args.includes(n);
const MINUTES = Number(opt('--minutes', '4'));
const SEED = Number(opt('--seed', '1337'));
const VERBOSE = flag('--verbose');
const SPEED_GATE = 0.96;

type ScenarioId = 'clean' | 'jitter' | 'late' | 'desync' | 'hostkill' | 'afk' | 'join' | 'bots' | 'stall' | 'hoststall' | 'joinkill';
const ALL: ScenarioId[] = ['jitter', 'late', 'desync', 'hostkill', 'afk', 'join', 'bots', 'clean', 'stall', 'hoststall', 'joinkill'];

interface Check { id: string; ok: boolean; detail: string }
interface ScenarioResult { scenario: ScenarioId; ok: boolean; checks: Check[]; info: Record<string, unknown>; error?: string; wallS: number }

// ─────────────────────────────── traces (measured, HIT PARADE netcode lane) ───────────────────────────────
function loadTraces(): number[][] {
  const dir = resolve(ROOT, '..', 'hit-parade', '_research', 'netcode');
  const out: number[][] = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => /^rtt_probe_.*\.json$/.test(x)).sort()) {
    try {
      const j = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as { phases?: { raw?: number[][] }[] };
      for (const ph of j.phases ?? []) {
        const raw = (ph.raw ?? []).filter((r) => r[2] != null && r[4] != null).sort((a, b) => a[0] - b[0]);
        if (raw.length < 50) continue;
        out.push(raw.map((r) => r[2] - r[1]));
        out.push(raw.map((r) => r[4] - r[3]));
      }
    } catch { /* skip */ }
  }
  return out;
}

// ─────────────────────────────── human input generator (harness only) ───────────────────────────────
function hash32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}
const IN_BUF = new Uint8Array(4);
function humanInput(seat: number, localTick: number, w: World): Uint8Array {
  // a wandering player: heads for the city centre-ish target that changes every 2 s, presses the hook now and then
  const seg = Math.floor(localTick / 60);
  const h = hash32(seat * 7919 + SEED, seg);
  const ang = (h % 3600) / 3600 * Math.PI * 2;
  const T = w.titan;
  // pull toward the spawn area so a wandering pilot does not leash into the edge
  const cx = w.city.spawn.x - T.x, cz = w.city.spawn.z - T.z;
  const d = Math.hypot(cx, cz) || 1;
  const pull = Math.min(1, d / 120);
  let mx = Math.cos(ang) * (1 - pull) + (cx / d) * pull, mz = Math.sin(ang) * (1 - pull) + (cz / d) * pull;
  const m = Math.hypot(mx, mz) || 1; mx /= m; mz /= m;
  const h2 = hash32(seat + 31, localTick);
  encodeInput({ mx, mz, ability: h2 % 97 === 0, abilityHeld: false, dash: h2 % 211 === 0, ultimate: h2 % 1009 === 0 }, IN_BUF);
  return IN_BUF;
}

// ─────────────────────────────── codec unit checks ───────────────────────────────
function codecChecks(): Check[] {
  const out: Check[] = [];
  const b = new Uint8Array(4);
  encodeInput({ mx: 0.5, mz: -1, ability: true, abilityHeld: false, dash: true, ultimate: true }, b, 0, 3);
  const d = decodeInput(b);
  out.push({ id: 'codec.input', ok: Math.abs(d.mx - 64 / 127) < 1e-12 && d.mz === -1 && d.ability && d.dash && !!d.ultimate && !d.abilityHeld && b[3] === 3, detail: `[${[...b]}]` });
  const fr: Frame = { tick: 77, lateMask: 2, botMask: 12, inputs: Uint8Array.from({ length: 16 }, (_, i) => i * 7) };
  const fp = decodeFramePkt(encodeFramePkt({ epoch: 3, echo: 1234, hold: 5, authTick: 80, slack: [1, -2, 3, 0], frames: [fr, { ...fr, tick: 78 }] }));
  out.push({ id: 'codec.frame', ok: !!fp && fp.frames.length === 2 && fp.frames[1].tick === 78 && fp.frames[0].inputs[15] === 105 && fp.slack[1] === -2 && fp.epoch === 3 && fp.echo === 1234, detail: fp ? 'ok' : 'null' });
  const ip = decodeInputPkt(encodeInputPkt({ epoch: 1, seat: 2, lead: 5, ping: 999, ack: 4000, first: 4005, inputs: new Uint8Array(12).fill(9) }));
  out.push({ id: 'codec.inputpkt', ok: !!ip && ip.first === 4005 && ip.inputs.length === 12 && ip.ack === 4000 && ip.seat === 2, detail: ip ? 'ok' : 'null' });
  const hp = decodeHashPkt(encodeHashPkt({ seat: 1, tick: 90, world: 0xdeadbeef, log: 7 }));
  out.push({ id: 'codec.hash', ok: !!hp && hp.world === 0xdeadbeef && hp.tick === 90, detail: hp ? 'ok' : 'null' });
  const lp = decodeLogPkt(encodeLogPkt(2, [fr]));
  out.push({ id: 'codec.log', ok: !!lp && lp.frames[0].tick === 77 && lp.frames[0].botMask === 12, detail: lp ? 'ok' : 'null' });
  const c = decodeCtl(encodeCtl({ t: 'join', seat: 3 }));
  out.push({ id: 'codec.ctl', ok: !!c && c.t === 'join' && c.seat === 3, detail: JSON.stringify(c) });
  // malformed: truncated / wrong kind / bad seat / bad json
  const bad = [
    decodeFramePkt(encodeFramePkt({ epoch: 0, echo: 0, hold: 0, authTick: 0, slack: [0, 0, 0, 0], frames: [fr] }).slice(0, 30)),
    decodeInputPkt(new Uint8Array([1, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    decodeHashPkt(new Uint8Array(13)),
    decodeLogPkt(new Uint8Array([4, 0, 1, 0, 0, 0, 5, 0])),
    decodeCtl(new Uint8Array([5, 123, 34])),
    decodeFramePkt(new Uint8Array([9, 9, 9])),
  ];
  out.push({ id: 'codec.malformed', ok: bad.every((x) => x === null), detail: bad.map((x) => (x === null ? 'null' : 'ACCEPTED')).join(',') });
  return out;
}

// ─────────────────────────────── one scenario ───────────────────────────────

interface PeerRt {
  id: string;
  stallFrom: number; stallTo: number; held: [string, Uint8Array][];
  peer: LockstepPeer<World> | null;
  createAt: number;
  nextWake: number;
  finishedAt: number;
  events: NetEvent[];
  killedAt: number;
  joiner?: { seat: number };
}

async function runScenario(sc: ScenarioId): Promise<ScenarioResult> {
  const wall0 = performance.now();
  const checks: Check[] = [];
  const info: Record<string, unknown> = {};
  const add = (id: string, ok: boolean, detail: string): void => { checks.push({ id, ok, detail }); };

  const bm = await import('../bot.ts');
  const sim: SimPort<World> = soloWorldPort({ bot: { input: bm.botInput, pick: bm.botPickUpgrade } });

  const endTick = Math.round(MINUTES * 60 * 30);
  let now = 0;
  const traces = loadTraces();
  info.traces = traces.length;
  const net = new SimNet({ seed: SEED ^ 0x5bd1e995, now: () => now, model: { delay: () => 12 } });

  // seats: who is human
  const humanSeats = sc === 'bots' ? [0, 1] : sc === 'join' ? [0, 1] : sc === 'joinkill' ? [0, 1, 2] : [0, 1, 2, 3];
  const ids = ['p0', 'p1', 'p2', 'p3', 'p4'];
  // joinkill: seats 0..2 are p1..p3 so the replay-joiner p0 holds the lowest id
  const idOf = (seat: number): string => (sc === 'joinkill' ? ids[seat + 1] : ids[seat]);
  const HOST = idOf(0);
  const start: StartInfo = {
    proto: NET_PROTO, build: 'probe', matchId: `probe-${sc}-${SEED}`, seed: SEED, biome: 'grideast', mode: 'coop1',
    seats: Array.from({ length: SEATS }, (_, s) => ({ slot: s, kind: humanSeats.includes(s) ? 'human' as const : 'bot' as const,
      peer: humanSeats.includes(s) ? idOf(s) : null, name: humanSeats.includes(s) ? idOf(s) : `BOT ${s}`, titan: 'molo' })),
    endTick, lead: 4,
  };

  // link models per scenario
  const lan: LinkModel = { delay: jitterDelay(net, 8, 10) };
  const jit: LinkModel = { delay: jitterDelay(net, 35, 50, 2, 220), lossPct: 3, dupPct: 2 };
  let ti = 0;
  const traceModel = (): LinkModel => {
    if (!traces.length) return jit;
    const tr = traces[ti++ % traces.length];
    return { delay: traceDelay(tr, Math.floor(net.rand() * tr.length)), lossPct: 3, dupPct: 2 };
  };
  for (const a of ids) for (const b of ids) if (a !== b) {
    const m = sc === 'clean' ? lan : sc === 'jitter' || sc === 'bots' ? traceModel() : jit;
    net.setLink(a, b, m);
  }
  const lateGuest = 'p2';
  if (sc === 'late') {
    // the late guest's uplink: 8 % spikes of up to 450 ms + two blackouts (1.5 s and 2.5 s)
    net.setLink(lateGuest, HOST, { delay: jitterDelay(net, 45, 60, 8, 450), lossPct: 6, dupPct: 2, blackouts: [[60000, 61500], [120000, 122500]] });
    info.lateGuest = lateGuest;
  }

  const rts: PeerRt[] = [];
  const mk = (id: string, at: number, joiner?: { seat: number }): PeerRt => {
    const r: PeerRt = { id, peer: null, createAt: at, nextWake: at, finishedAt: -1, events: [], killedAt: -1, joiner, stallFrom: -1, stallTo: -1, held: [] };
    rts.push(r);
    return r;
  };
  for (const s of humanSeats) mk(idOf(s), s === 0 ? 0 : Math.floor(20 + net.rand() * 150));
  const stallMs = 2500, stallAt = 60000;
  if (sc === 'stall' || sc === 'hoststall') {
    const r = rts.find((x) => x.id === (sc === 'stall' ? 'p2' : HOST)) as PeerRt;
    r.stallFrom = stallAt; r.stallTo = stallAt + stallMs;
    info.stall = { peer: r.id, fromMs: stallAt, ms: stallMs };
    if (sc === 'hoststall') {
      // the host's last 300 ms of frames reach nobody: the new authority resumes without them, so the old host holds
      // frames that get overwritten -> it must rebuild its world (non-vacuous rewind path)
      for (const b of ids) if (b !== HOST) { const m = net.link(HOST, b); net.setLink(HOST, b, { ...m, blackouts: [[stallAt - 300, stallAt]] }); }
    }
  }

  // scenario parameters
  const perturbPeer = 'p2';
  let perturbTick = -1;
  if (sc === 'desync') perturbTick = 2400 + 17;             // between checkpoints on purpose
  let killTick = -1;
  if (sc === 'hostkill') { killTick = 1500 + Math.floor(net.rand() * 2500); info.killTick = killTick; }
  if (sc === 'joinkill') { killTick = 2000; info.killTick = killTick; }
  const afkPeer = 'p3', afkFrom = 50000, afkTo = 58000;
  if (sc === 'afk') info.afkWindowMs = [afkFrom, afkTo];
  const joinTick = 3600, lateJoinTick = JOIN_CUTOFF_TICK + 30;
  let joinerCreated = false, lateJoinerCreated = false;

  const authorityRt = (): LockstepPeer<World> | null => {
    for (const r of rts) if (r.peer && r.killedAt < 0 && r.peer.isAuthority && r.peer.state !== 'desynced' && r.peer.state !== 'left') return r.peer;
    return null;
  };

  let maxAuthLag = 0, maxHostStall = 0;
  const afkFrames: number[] = [];
  let lastBotMask3 = 0;
  const tEnd = endTick * TICK_MS + 30000;
  let err: string | undefined;
  try {
    for (now = 0; now <= tEnd; now++) {
      // create peers due now
      for (const r of rts) if (!r.peer && now >= r.createAt) {
        const joiner = r.joiner ? { seat: r.joiner.seat, authority: (authorityRt() as LockstepPeer<World>).self, epoch: (authorityRt() as LockstepPeer<World>).epoch } : undefined;
        r.peer = new LockstepPeer<World>({ self: r.id, start, sim, mesh: net.mesh(r.id), now, joiner, maxStepsPerPump: Infinity,
          onEvent: (e) => { r.events.push(e); if (VERBOSE && e.type !== 'roster') console.log(`  [${(now / 1000).toFixed(2)}s] ${r.id} ${JSON.stringify(e).slice(0, 200)}`); },
          log: VERBOSE ? (m) => console.log(`  [${(now / 1000).toFixed(2)}s] ${m}`) : undefined });
      }
      net.deliver(now, (to, from, b) => {
        const r = rts.find((x) => x.id === to);
        if (r && now >= r.stallFrom && now < r.stallTo) { r.held.push([from, b]); return; }   // frozen: queued
        if (r && r.peer && r.killedAt < 0) r.peer.receive(from, b, now);
      });
      for (const r of rts) {
        const p = r.peer;
        if (!p || r.killedAt >= 0 || (now >= r.stallFrom && now < r.stallTo) || now < r.nextWake) continue;
        const seat = p.mySeat();
        if (seat >= 0) p.setLocalInput(humanInput(seat, Math.floor(now / TICK_MS), p.world));
        p.pump(now);
        // back from a freeze: the clock fired first, the queued packets land after it
        if (r.held.length && now >= r.stallTo) for (const [f, b] of r.held.splice(0)) p.receive(f, b, now);
        // emulated Worker timer: 33.3 ms +-, rare stalls (GC / busy main thread)
        let next = TICK_MS + (net.rand() * 6 - 2);
        if (net.rand() < 0.005) { const st = 60 + net.rand() * 90; next += st; }
        r.nextWake = now + Math.max(1, Math.round(next));
        if (p.isAuthority && p.state === 'play' && r.id === HOST) {
          maxHostStall = Math.max(maxHostStall, next);
        }
        if (p.finished && r.finishedAt < 0) r.finishedAt = now;
      }
      const auth = authorityRt();
      if (auth && auth.self === HOST && auth.state === 'play') {
        const lag = Math.floor(now / TICK_MS) - auth.confirmed;
        if (lag > maxAuthLag && auth.confirmed > 30) maxAuthLag = lag;
      }
      // scenario triggers
      if (perturbTick > 0) {
        const r = rts.find((x) => x.id === perturbPeer);
        // first observation at/after the target (a catch-up pump can step past the exact tick); measured from the actual tick
        if (r && r.peer && r.peer.simTick >= perturbTick && !info.perturbed) { (sim.perturb as (w: World) => void)(r.peer.world); info.perturbed = r.peer.simTick; }
      }
      if (killTick > 0 && auth && auth.self === HOST && auth.confirmed >= killTick) {
        const r = rts.find((x) => x.id === HOST) as PeerRt;
        if (r.killedAt < 0) { r.killedAt = now; net.kill(HOST); info.killedAtMs = now; info.killedAtTick = auth.confirmed; }
      }
      if (sc === 'joinkill' && auth && !joinerCreated && auth.confirmed >= 900) { joinerCreated = true; mk('p0', now + 1, { seat: 3 }); info.joinRequestedAtTick = auth.confirmed; }
      if (sc === 'afk') {
        if (now === afkFrom) net.muteInputs.add(afkPeer);
        if (now === afkTo) net.muteInputs.delete(afkPeer);
      }
      if (sc === 'join' && auth) {
        if (!joinerCreated && auth.confirmed >= joinTick) { joinerCreated = true; mk('p3', now + 1, { seat: 3 }); info.joinRequestedAtTick = auth.confirmed; }
        if (!lateJoinerCreated && auth.confirmed >= lateJoinTick) { lateJoinerCreated = true; mk('p4', now + 1, { seat: 2 }); info.lateJoinAtTick = auth.confirmed; }
      }
      // frame watch (from p1's canonical log: botMask of the AFK seat)
      if (sc === 'afk') {
        const r = rts.find((x) => x.id === 'p1');
        const fs = r?.peer?.frames;
        if (fs && fs.length) {
          const f = fs[fs.length - 1];
          const bit = (f.botMask >> 3) & 1;
          if (bit !== lastBotMask3) { afkFrames.push(f.tick * (bit ? 1 : -1)); lastBotMask3 = bit; }
        }
      }
      // done when every live peer finished (or dropped out)
      const live = rts.filter((r) => r.peer && r.killedAt < 0 && r.peer.state !== 'desynced' && r.peer.state !== 'left');
      if (live.length && live.every((r) => r.peer?.finished && r.peer.results.size >= live.length - 1) && rts.every((r) => r.peer || r.createAt > now + 1e9)) break;
    }
  } catch (e) {
    err = (e as Error)?.stack ?? String(e);
  }
  info.endedAtMs = now;
  const live = rts.filter((r) => r.peer && r.killedAt < 0 && r.peer.state !== 'desynced' && r.peer.state !== 'left');
  const peers = rts.filter((r) => r.peer) as (PeerRt & { peer: LockstepPeer<World> })[];

  // ── (a) hashes equal at every checkpoint ──
  const ticks = new Set<number>();
  for (const r of peers) for (const k of r.peer.hashLog.keys()) ticks.add(k);
  let compared = 0, bad = 0, firstBad = '';
  for (const k of [...ticks].sort((a, b) => a - b)) {
    const vals = new Map<string, string[]>();
    for (const r of peers) {
      if (sc === 'desync' && r.id === perturbPeer && typeof info.perturbed === 'number' && k > info.perturbed) continue;
      const h = r.peer.hashLog.get(k);
      if (!h) continue;
      const v = `${h[0]}:${h[1]}`;
      const g = vals.get(v) ?? []; g.push(r.id); vals.set(v, g);
    }
    let n = 0; for (const g of vals.values()) n += g.length;
    if (n < 2) continue;
    compared++;
    if (vals.size > 1) { bad++; if (!firstBad) firstBad = `tick ${k}: ${JSON.stringify([...vals.entries()])}`; }
  }
  const finalTicks = live.map((r) => r.peer?.simTick ?? -1);
  add('a.hashes_equal', compared > 0 && bad === 0 && !err, `${compared} checkpoints compared, ${bad} mismatched${firstBad ? ' first ' + firstBad : ''}; final sim ticks ${finalTicks.join('/')}`);

  // ── (h) final standings agree ──
  const st = live.map((r) => r.peer?.standings?.hash ?? -1);
  const agreeAll = live.every((r) => r.peer?.resultsAgree());
  const resCounts = live.map((r) => r.peer?.results.size ?? 0);
  add('h.standings_agree', live.length > 0 && st.every((h) => h === st[0] && h !== -1) && agreeAll,
    `standings hash ${st.map((h) => (h >>> 0).toString(16)).join('/')}; RESULTs received ${resCounts.join('/')}; agree=${agreeAll}`);
  const first = live[0]?.peer?.standings;
  if (first) info.standings = { endTick: first.endTick, result: first.result, seats: first.seats.map((s) => s.kind).join(','), ...first.summary };

  // ── (b) speed ──
  // game speed = sim ticks reached / real time elapsed since the authority's clock started (t = 0): tick T is due at
  // T x 33.3 ms on every peer, a late starter or a joiner included
  const speeds = live.map((r) => ({ id: r.id, speed: r.finishedAt > 0 ? (r.peer?.simTick ?? 0) / (r.finishedAt / TICK_MS) : 0 }));
  info.speeds = speeds.map((s) => `${s.id}:${(s.speed * 100).toFixed(2)}%`).join(' ');
  const endedEarly = first ? first.endTick < endTick : true;
  info.endedEarly = endedEarly;
  if (sc !== 'hostkill' && sc !== 'desync' && sc !== 'hoststall' && sc !== 'joinkill') {
    add('b.speed>=96%', speeds.length > 0 && speeds.every((s) => s.speed >= SPEED_GATE), String(info.speeds));
  }

  // stats
  const statLine = (r: PeerRt & { peer: LockstepPeer<World> }): Record<string, unknown> => {
    const s = r.peer.stats;
    const durS = Math.max(1, ((r.finishedAt > 0 ? r.finishedAt : now) - r.createAt) / 1000);
    return { id: r.id, auth: r.peer.isAuthority, state: r.peer.state, lead: r.peer.lead, rttMs: Math.round(s.rttMs), lateRepeats: s.lateRepeats,
      lateSeen: s.lateSeen, afkOn: s.afkOn, resends: s.resends, migrations: s.migrations, checkpoints: s.checkpoints, mismatches: s.mismatches,
      maxAdvanceGapMs: Math.round(s.maxAdvanceGapMs), upKBs: +(s.bytesOut / durS / 1024).toFixed(2), downKBs: +(s.bytesIn / durS / 1024).toFixed(2),
      stepMsAvg: s.steps ? +(s.stepMsTotal / s.steps).toFixed(3) : 0 };
  };
  info.peers = peers.map(statLine);
  info.net = { sent: net.sent, dropped: net.dropped, duplicated: net.duplicated, delivered: net.delivered };

  // ── scenario gates ──
  const get = (id: string): (PeerRt & { peer: LockstepPeer<World> }) | undefined => peers.find((r) => r.id === id);
  if (sc === 'late') {
    const a = get('p0'), g = get(lateGuest);
    add('c.late_repeated', !!a && !!g && a.peer.stats.lateRepeats > 0 && g.peer.stats.lateSeen > 0,
      `authority lateRepeats=${a?.peer.stats.lateRepeats}, ${lateGuest} lateSeen=${g?.peer.stats.lateSeen}`);
    add('c.never_stalls', maxAuthLag <= Math.ceil(maxHostStall / TICK_MS) + 2 && maxAuthLag <= 15,
      `authority production lag max ${maxAuthLag} ticks (own timer stall max ${maxHostStall.toFixed(0)} ms = ${Math.ceil(maxHostStall / TICK_MS)} ticks)`);
  }
  if (sc === 'desync') {
    const p = get(perturbPeer);
    const selfEv = p?.events.find((e) => e.type === 'desync' && e.self) as Extract<NetEvent, { type: 'desync' }> | undefined;
    const others = peers.filter((r) => r.id !== perturbPeer);
    // every other peer learns it either from its own hash verdict (desync event naming p2) or from p2's
    // leave{why:'desync'} when that arrived before the verdict (then p2 is no longer expected at the checkpoint)
    const seen = others.map((r) => {
      const d = r.events.find((e) => e.type === 'desync' && !e.self && e.peers.includes(perturbPeer));
      if (d) return `${r.id}:verdict@${(d as Extract<NetEvent, { type: 'desync' }>).tick}`;
      const l = r.events.find((e) => e.type === 'left' && e.peer === perturbPeer && e.why === 'desync');
      return l ? `${r.id}:leave(desync)` : '';
    });
    const pt = typeof info.perturbed === 'number' ? info.perturbed : -1;
    const lag = selfEv && pt > 0 ? selfEv.tick - pt : -1;
    add('d.desync_caught<=30', !!selfEv && pt > 0 && lag >= 0 && lag <= HASH_EVERY && seen.every((x) => x !== ''),
      `perturbed ${perturbPeer} after tick ${pt}; it flagged itself at checkpoint ${selfEv?.tick} (+${lag} ticks); others: ${seen.map((x) => x || 'NOT INFORMED').join(' ')}`);
    const lastF = get('p0')?.peer.frames.at(-1);
    const majority = others.every((r) => r.peer.finished && r.peer.state === 'done');
    add('d.majority_continues', majority && !!lastF && ((lastF.botMask >> 2) & 1) === 1,
      `others finished=${others.map((r) => r.peer.finished).join('/')}, ${perturbPeer} state=${p?.peer.state}, seat 2 botMask at end=${lastF ? (lastF.botMask >> 2) & 1 : '?'}`);
  }
  if (sc === 'hostkill') {
    const surv = peers.filter((r) => r.id !== 'p0');
    const auths = surv.map((r) => r.peer.authority);
    const mig = (get('p1')?.events.find((e) => e.type === 'migrated')) as Extract<NetEvent, { type: 'migrated' }> | undefined;
    info.migration = mig ? { epoch: mig.epoch, tick: mig.tick, pauseMs: Math.round(mig.pauseMs), merged: mig.merged } : null;
    add('e.host_migration', auths.every((a) => a === 'p1') && !!mig && surv.every((r) => r.peer.finished && !endedEarlyBy(r.peer, info)),
      `host p0 killed at tick ${info.killedAtTick}; survivors' authority ${auths.join('/')}; migration ${JSON.stringify(info.migration)}; survivors finished ${surv.map((r) => r.peer.simTick).join('/')}`);
  }
  if (sc === 'afk') {
    const a = get('p0');
    const ev = a?.events.filter((e) => e.type === 'afk') as Extract<NetEvent, { type: 'afk' }>[] | undefined;
    const on = afkFrames.find((t) => t > 0), off = afkFrames.find((t) => t < 0);
    const muteTick = afkFrom / TICK_MS, unmuteTick = afkTo / TICK_MS;
    const onOk = on !== undefined && on >= muteTick && on <= muteTick + (AFK_MS + 1000) / TICK_MS;
    const offOk = off !== undefined && -off >= unmuteTick && -off <= unmuteTick + 60;
    add('f.afk_bot_takes_seat', !!ev && ev.length >= 2 && onOk && offOk,
      `inputs muted ticks ${muteTick.toFixed(0)}..${unmuteTick.toFixed(0)}; canonical botMask seat3 on at ${on}, off at ${off !== undefined ? -off : 'never'}; authority events ${ev?.map((e) => (e.on ? 'on' : 'off') + '@' + e.tick).join(',')}`);
  }
  if (sc === 'join') {
    const j = get('p3'), lj = get('p4');
    const joined = j?.events.find((e) => e.type === 'joined') as Extract<NetEvent, { type: 'joined' }> | undefined;
    const others = peers.filter((r) => r.id === 'p0' || r.id === 'p1');
    let jCompared = 0, jBad = 0;
    if (j) for (const [k, h] of j.peer.hashLog) {
      for (const o of others) { const oh = o.peer.hashLog.get(k); if (!oh) continue; jCompared++; if (oh[0] !== h[0] || oh[1] !== h[1]) jBad++; }
    }
    const fs = get('p0')?.peer.frames ?? [];
    const sw = joined?.switchTick ?? -1;
    const before = sw > 1 ? (fs[sw - 2].botMask >> 3) & 1 : -1, after = sw > 0 && fs[sw - 1] ? (fs[sw - 1].botMask >> 3) & 1 : -1;
    info.join = joined ? { switchTick: joined.switchTick, replayedFrames: joined.replayed, replayMs: Math.round(joined.replayMs) } : null;
    add('g.replay_join', !!joined && jCompared > 100 && jBad === 0 && before === 1 && after === 0 && !!j?.peer.finished,
      `join requested at tick ${info.joinRequestedAtTick}; ${JSON.stringify(info.join)}; joiner checkpoints vs live peers: ${jCompared} compared, ${jBad} mismatched; seat3 botMask before/after switch ${before}/${after}`);
    const rej = lj?.events.find((e) => e.type === 'joinRejected') as Extract<NetEvent, { type: 'joinRejected' }> | undefined;
    add('g.join_after_3min_refused', !!rej && rej.why === 'late', `join at tick ${info.lateJoinAtTick} -> ${rej ? 'refused: ' + rej.why : 'NOT refused'}`);
  }
  if (sc === 'stall') {
    const bad2 = peers.filter((r) => r.peer.epoch !== 0 || r.peer.authority !== HOST || r.peer.stats.migrations > 0 || r.events.some((e) => e.type === 'authority' || e.type === 'left'));
    add('stall.no_false_election', bad2.length === 0,
      `p2 frozen ${stallMs} ms at ${stallAt / 1000}s (queued packets after its first pump); peers with an election / epoch change / left event: ${bad2.map((r) => r.id).join(',') || 'none'}; p2 maxAdvanceGap ${Math.round(get('p2')?.peer.stats.maxAdvanceGapMs ?? -1)} ms`);
  }
  if (sc === 'hoststall') {
    const surv = peers.filter((r) => r.id !== HOST);
    const old = get(HOST);
    const auths = peers.map((r) => `${r.id}:${r.peer.authority}@${r.peer.epoch}`);
    const rejoined = !!old && old.peer.mySeat() === 0 && old.peer.finished && old.peer.state === 'done';
    const rb = old?.events.find((e) => e.type === 'rebuilt') as Extract<NetEvent, { type: 'rebuilt' }> | undefined;
    add('e2.rewind_exercised', !!rb, `old host rebuilt its world from tick 0 after frames from ${rb ? rb.fromTick : '-'} were overwritten`);
    add('e2.host_stall', surv.every((r) => r.peer.authority === 'p1' && r.peer.epoch >= 1 && r.peer.finished) && rejoined && old?.peer.authority === 'p1',
      `host ${HOST} frozen ${stallMs} ms at ${stallAt / 1000}s (its frames of the last 300 ms before lost); authority per peer ${auths.join(' ')}; old host state ${old?.peer.state}, seat ${old?.peer.mySeat()}, finished ${old?.peer.finished}; events ${old?.events.filter((e) => e.type !== 'roster' && e.type !== 'late').map((e) => e.type).join(',')}`);
  }
  if (sc === 'joinkill') {
    const surv = peers.filter((r) => r.id !== HOST);
    const j = get('p0');
    add('e3.joiner_elected', !!j && !!j.events.find((e) => e.type === 'joined') && surv.every((r) => r.peer.authority === 'p0' && r.peer.finished),
      `joiner p0 (lowest id) joined at tick ${info.joinRequestedAtTick}; host ${HOST} killed at tick ${info.killedAtTick}; authority per survivor ${surv.map((r) => r.id + ':' + r.peer.authority + '@' + r.peer.epoch).join(' ')}; finished ${surv.map((r) => r.peer.simTick).join('/')}`);
  }
  if (sc === 'bots') {
    const lastF = get('p0')?.peer.frames.at(-1);
    add('bots.fill', !!lastF && (lastF.botMask & 0b1100) === 0b1100 && (lastF.botMask & 0b11) === 0, `final botMask ${lastF?.botMask.toString(2).padStart(4, '0')}`);
  }
  // the shared 1-titan World can die under wandering human pilots; that only matters when it ends before the
  // scenario's last event (then the scenario is vacuous). Speed and hash gates use whatever length was played.
  const lastEvent: Partial<Record<ScenarioId, number>> = { afk: afkTo / TICK_MS + 150, desync: perturbTick + 150, hostkill: killTick + 600,
    join: lateJoinTick + 60, late: 122500 / TICK_MS + 150, stall: (stallAt + stallMs) / TICK_MS + 300, hoststall: (stallAt + stallMs) / TICK_MS + 600,
    joinkill: killTick + 600, jitter: endTick / 2, clean: endTick / 2, bots: endTick / 2 };
  const need = Math.round(lastEvent[sc] ?? endTick);
  info.needTick = need;
  if (first && first.endTick < need) add('match_length', false, `the World ended at tick ${first.endTick} (${first.result}) before tick ${need}, the last scenario event + margin: vacuous`);
  else if (endedEarly && first) info.note = `World ended at tick ${first.endTick} (${first.result}) after the scenario's last event (tick ${need})`;
  if (err) add('no_throw', false, err.split('\n').slice(0, 4).join(' | '));
  return { scenario: sc, ok: checks.every((c) => c.ok), checks, info, error: err, wallS: +((performance.now() - wall0) / 1000).toFixed(1) };
}

function endedEarlyBy(p: LockstepPeer<World>, info: Record<string, unknown>): boolean { void info; return !p.standings; }

// ─────────────────────────────── main ───────────────────────────────

function printResult(r: ScenarioResult): void {
  console.log(`\n== ${r.scenario}: ${r.ok ? 'PASS' : 'FAIL'}  (${r.wallS}s wall)`);
  for (const c of r.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.id}: ${c.detail}`);
  const i = r.info as { speeds?: string; standings?: unknown; peers?: Record<string, unknown>[]; migration?: unknown; join?: unknown };
  if (i.speeds) console.log(`  speeds ${i.speeds}`);
  if (i.standings) console.log(`  standings ${JSON.stringify(i.standings)}`);
  for (const p of i.peers ?? []) console.log(`  peer ${JSON.stringify(p)}`);
}

async function main(): Promise<void> {
  const one = opt('--scenario', '');
  if (flag('--child')) {
    const r = await runScenario(one as ScenarioId);
    process.stdout.write('@@RESULT ' + JSON.stringify(r) + '\n');
    return;
  }
  try { await import('../../src/core/world.ts'); await import('../bot.ts'); }
  catch (e) { console.log(`probe_net4: could not load the sim: ${(e as Error)?.message}`); process.exit(2); }

  const codec = codecChecks();
  console.log(`codec: ${codec.every((c) => c.ok) ? 'PASS' : 'FAIL'}  ${codec.map((c) => c.id + (c.ok ? '' : ' FAIL ' + c.detail)).join(', ')}`);
  const list: ScenarioId[] = one ? (one.split(',') as ScenarioId[]) : ALL;
  const par = Math.max(1, Math.min(6, Number(opt('--par', '5'))));
  const results: ScenarioResult[] = [];
  if (list.length === 1 && !flag('--fork')) {
    const r = await runScenario(list[0]);
    results.push(r); printResult(r);
  } else {
    const queue = list.slice();
    const self = fileURLToPath(import.meta.url);
    const passthru = ['--minutes', String(MINUTES), '--seed', String(SEED)];
    await new Promise<void>((done) => {
      let running = 0;
      const launch = (): void => {
        while (running < par && queue.length) {
          const sc = queue.shift() as ScenarioId;
          running++;
          const ch = spawn(process.execPath, [self, '--child', '--scenario', sc, ...passthru], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '', errS = '';
          ch.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          ch.stderr.on('data', (d: Buffer) => { errS += d.toString(); });
          ch.on('close', (code) => {
            running--;
            const line = out.split('\n').find((l) => l.startsWith('@@RESULT '));
            let r: ScenarioResult;
            if (line) r = JSON.parse(line.slice(9)) as ScenarioResult;
            else r = { scenario: sc, ok: false, checks: [{ id: 'child', ok: false, detail: `exit ${code}: ${(errS || out).split('\n').slice(-6).join(' | ')}` }], info: {}, wallS: 0 };
            results.push(r); printResult(r);
            if (queue.length) launch(); else if (running === 0) done();
          });
        }
      };
      launch();
    });
  }
  const ok = codec.every((c) => c.ok) && results.every((r) => r.ok) && results.length === list.length;
  const rep = { probe: 'probe_net4', ts: new Date().toISOString(), minutes: MINUTES, seed: SEED, ok, codec, scenarios: results.sort((a, b) => ALL.indexOf(a.scenario) - ALL.indexOf(b.scenario)) };
  const out = resolve(ROOT, '_harness', '_reports', 'probe_net4.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rep, null, 2) + '\n');
  const failed = [...codec.filter((c) => !c.ok).map((c) => c.id), ...results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `${r.scenario}:${c.id}`))];
  console.log(`\nprobe_net4: ${ok ? 'PASS' : 'FAIL'} - ${results.length} scenarios x ${MINUTES} min${failed.length ? '; failing: ' + failed.join(', ') : ''}  (report ${out})`);
  process.exit(ok ? 0 : 1);
}

void main();

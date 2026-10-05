// DYEFIELD — ONLINE sync probe (CONTRACT_ONLINE §O12.2 / §O13.2): host + clients over the in-memory loopback relay
// (runtime/src/net/loopback.ts), real maps, Rapier in plain Node, no GPU, no network. Every human is driven by an AUTOPILOT:
// a BotDirector on that device's own world with only the local runner's brain active, so the intents are real intents —
// quantized, sent, predicted and reconciled like a player's.
//
//   node _harness/probe_net.ts                       # the gate suite (see SUITE below)
//   node _harness/probe_net.ts --quick               # 2 humans, TEAMS TURF pier18, 60 s, lag 0 (smoke)
//   node _harness/probe_net.ts --only A0,A80         # chosen scenarios
//   node _harness/probe_net.ts --seconds 90          # shorter matches for every scenario
//
// Scenarios:
//   A<lag>[:kit]   2 humans (host + 1 client), TEAMS TURF pier18, full 3:00 (or --seconds), one-way lag 0 / 80 ms:
//                  host + client agree on the result (winner, shares to 1e-9) and the final painter hash; the client's
//                  painter hash matched at every HASH_EVERY check; 0 desyncs; prediction error p95 < 0.05 m (lag 0) /
//                  < 0.35 m (lag 80); no rubber-band > 2 m; the host world hash equals an offline replay of the same
//                  intents (the record wrappers change nothing).
//   M<mode>:<rule>[:map]  8 humans (host + 7 clients), the given mode × rule — the same agreement checks.
//   P<kit>:<pattern> prediction stress (lag 80): drum (SHEET-DRUM rolling across enemy turf), slick (MIST-RASP firing 0.5 s
//                  ahead then slicking into the fresh dye), toggle (FIRE toggled every 0.4 s while running): p95 < 0.35 m.
//   G / H[:mode:rule]  migration mid-match, graceful (HANDOFF) / abrupt (the host socket closes): the match completes with
//                  a result, survivors agree, the restore never resets the painter, no constructor event reaches the view,
//                  the seat totals continue from the HANDOFF / last scoreboard.
//   L              a late join at 30 s and a reconnect at 60 s: equal final painter hash; the late joiner's and the
//                  reconnecting client's seat totals equal the runner's counter increase over the human-driven ticks.
//   J<ms>[:<lag>]  arrival jitter on every link (adaptive host jitter buffer): p95 < 0.05 m (lag 0) / 0.35 m, 0 desyncs, equal hashes.
//   R              the client's own movement responds on the very tick of the input (a scripted stop / go at lag 80).
//   T              bot takeover after 3 s of silence, and back.
//   U              units per match within ±10 % of §O9.2 (2 humans, 3:00).
//
//   node _harness/probe_net.ts --relay ws://127.0.0.1:8797 [--humans 3] [--netdur 40] [--only E|Q|H]
//                  END TO END through net/api.ts (CREATE ROOM / JOIN ROOM / start, and a QUICK MATCH) over a real relay
//                  (the NET-SERVER lane's Worker under `wrangler dev`, DEV vars: ?netdur honoured, local origins allowed).
// Exit: 0 all pass · 1 a check failed · 2 setup failure.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRapier, PhysicsWorld, type Rapier } from '../runtime/src/core/physics.ts';
import { loadMapGeometry, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas, type PaintAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { mapById, type MapDef } from '../runtime/src/core/data.ts';
import { TICK } from '../runtime/src/core/config.ts';
import { emptyIntent, type PlayerIntent } from '../runtime/src/core/types.ts';
import { MatchWorld, type MatchResult } from '../runtime/src/core/match/world.ts';
import type { RosterEntry } from '../runtime/src/core/match/roster.ts';
import { BotDirector } from '../runtime/src/core/bots/director.ts';
import { buildNav, type NavGraph } from '../runtime/src/core/bots/nav.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';
import { OnlineSession, type EndInfo, type SessionArena, type SessionSpec } from '../runtime/src/net/session.ts';
import { LoopRelay, type LoopPeer } from '../runtime/src/net/loopback.ts';
import { buildOnlineRoster } from '../runtime/src/net/roster.ts';
import { parseText, type WireMember } from '../runtime/src/net/proto.ts';
import { NetApi, type OnlineDriver, type OnlineGameHandle, type OnlineProfile } from '../runtime/src/net/api.ts';
import { WsTransport } from '../runtime/src/net/transport.ts';
import type { GameNet } from '../runtime/src/net/session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const QUICK = argv.includes('--quick');
const VERBOSE = argv.includes('--verbose');
const SECONDS = Number(arg('--seconds', QUICK ? '60' : '180'));
const SUITE = QUICK ? ['A0', 'R'] : ['A0', 'A80', 'A80:sheet-drum', 'R', 'Mteams:turf', 'Mteams:washout', 'Mffa:turf', 'Mffa:washout',
  'Mteams:turf:lockwell', 'Mteams:turf:cinder', 'Pdrum', 'Pslick', 'Ptoggle', 'J40', 'J60:80', 'G', 'H', 'G:ffa:washout', 'H:ffa:turf', 'L', 'T', 'U'];
const ONLY = arg('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const RUN = ONLY.length ? ONLY : SUITE;
const TICK_MS = TICK * 1000;

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : String(v));

// ───────────────────────────── shared map data ─────────────────────────────
interface MapData { def: MapDef; geo: MapGeometry; atlas: PaintAtlas; nav: NavGraph }
const maps = new Map<string, MapData>();
let R: Rapier;

async function mapData(id: string): Promise<MapData> {
  const hit = maps.get(id);
  if (hit) return hit;
  const def = mapById(id);
  const geo = await loadMapGeometry(def);
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const atlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
  const nav = buildNav(geo, new PhysicsWorld(R, geo), def);
  const md = { def, geo, atlas, nav };
  maps.set(id, md);
  return md;
}

/** one device's arena: its own physics + its own painter over a private copy of atlas.team */
function arenaOf(md: MapData): SessionArena {
  const atlas: PaintAtlas = { ...md.atlas, team: new Uint8Array(md.atlas.team.length) };
  return { def: md.def, geo: md.geo, physics: new PhysicsWorld(R, md.geo), painter: new Painter(atlas), nav: md.nav };
}

function worldOf(a: SessionArena, spec: SessionSpec): MatchWorld {
  return new MatchWorld({
    def: a.def, geo: a.geo, physics: a.physics, painter: a.painter, roster: spec.roster, seed: spec.seed,
    durationS: spec.durationS, countdownS: spec.countdownS, mode: spec.mode, ...(spec.rule === 'washout' ? { rule: 'washout' as const } : {}),
  });
}

// ───────────────────────────── devices ─────────────────────────────
type Driver = (ep: Device, tick: number) => PlayerIntent;

interface Device {
  slot: number;
  name: string;
  arena: SessionArena;
  session: OnlineSession;
  peer: LoopPeer;
  auto: BotDirector | null;
  scratch: PlayerIntent[];
  intents: PlayerIntent[];
  ended: EndInfo | null;
  events: SimEvent[];
  evCount: Record<string, number>;
  /** ticks the device skipped (silence tests) */
  muteUntil: number;
  /** the local runner moved on the very tick its input started (count / starts) */
  resp: { starts: number; same: number };
  prevSpeed: number;
  ctorEventsSeen: number;
  driver: Driver | null;
  online: boolean;
  /** probe hook: after each tick, the local intent used and the local runner's displacement that tick (m) */
  onTick?: (d: Device, local: PlayerIntent, moved: number) => void;
}

function autopilot(world: MatchWorld, nav: NavGraph, local: number, seed: number): BotDirector {
  const d = new BotDirector(world, nav, seed, 'swell');
  for (let i = 0; i < world.runners.length; i++) if (i !== local) d.setHuman(i, true);
  return d;
}

interface Match {
  relay: LoopRelay;
  devs: Device[];
  spec: SessionSpec;
  md: MapData;
  replay: MatchWorld | null;
  replayArena: SessionArena | null;
  now: number;
  hostWorldAtStart: MatchWorld;
}

interface MatchOpts {
  map: string; mode: 'teams' | 'ffa'; rule: 'turf' | 'washout'; humans: number; lag: number; seconds: number; seed: number;
  kits?: string[]; replay?: boolean; drivers?: Array<Driver | null>; lateJoin?: number[];
}

async function makeMatch(o: MatchOpts): Promise<Match> {
  const md = await mapData(o.map);
  const relay = new LoopRelay();
  const members: WireMember[] = [];
  const nHumans = o.humans + (o.lateJoin?.length ?? 0);
  for (let s = 0; s < nHumans; s++) {
    members.push({ slot: s, name: `P${s}`, kit: o.kits?.[s] ?? 'mist-rasp', crew: s % 2 === 0 ? 1 : 2, color: (s % 8) + 1, device: 'kbm', conn: true, owner: s === 0, host: false, rttMs: 40 + s });
  }
  const startMembers = members.filter((m) => !(o.lateJoin ?? []).includes(m.slot));
  const { roster, seats } = buildOnlineRoster(startMembers, o.mode, o.seed, 'swell');
  // peers: slot 0 is the best host (lowest rtt, kbm)
  const devs: Device[] = [];
  const spec0: SessionSpec = {
    matchNo: 1, seed: o.seed, mode: o.mode, rule: o.rule, skill: 'swell', map: o.map, preset: 'noon', durationS: o.seconds, countdownS: 3,
    roster, seats, mySlot: 0, hostSlot: 0, members: startMembers, migrations: 0, fromStart: true,
  };
  for (const m of startMembers) relay.add(mkPeer(m.slot, o.lag, devs));
  relay.start();
  const hostSlot = relay.hostSlot;
  const m: Match = { relay, devs, spec: spec0, md, replay: null, replayArena: null, now: 0, hostWorldAtStart: null as unknown as MatchWorld };
  for (const mem of startMembers) devs.push(makeDevice(m, mem.slot, hostSlot, roster, seats, startMembers, true, o.drivers?.[mem.slot] ?? null));
  const host = devs.find((d) => d.slot === hostSlot)!;
  m.hostWorldAtStart = host.session.world;
  if (o.replay) {
    // the offline replay: a fresh world of the same match stepped with the exact intents the host world consumes
    const ra = arenaOf(md);
    const rw = worldOf(ra, spec0);
    m.replay = rw; m.replayArena = ra;
    const hw = host.session.world;
    const orig = hw.step.bind(hw);
    hw.step = (it: readonly PlayerIntent[]): void => { rw.step(it.map((x) => ({ ...x }))); orig(it); };
  }
  for (const d of devs) d.session.sendLoaded();
  return m;
}

/** --jitter <ms>: extra random one-way delay per frame (FIFO kept) on every link */
let JITTER = Number(arg('--jitter', '0'));

function mkPeer(slot: number, lag: number, devs: Device[]): LoopPeer {
  return {
    slot, name: `P${slot}`, device: 'kbm', simMs: 1 + slot * 0.1, rttMs: 40 + slot, lagMs: lag, jitterMs: JITTER, conn: true, owner: slot === 0,
    onData: (d, now) => {
      const dev = devs.find((x) => x.slot === slot);
      if (!dev || !dev.online) return;
      if (typeof d === 'string') { const msg = parseText(d); if (msg) dev.session.onText(msg, now); }
      else dev.session.onBinary(d, now);
    },
  };
}

function makeDevice(m: Match, slot: number, hostSlot: number, roster: RosterEntry[], seats: SessionSpec['seats'], members: WireMember[], fromStart: boolean, driver: Driver | null): Device {
  const arena = arenaOf(m.md);
  const spec: SessionSpec = { ...m.spec, roster, seats, mySlot: slot, hostSlot, members, fromStart };
  const world = worldOf(arena, spec);
  const dev: Device = {
    slot, name: `P${slot}`, arena, session: null as unknown as OnlineSession, peer: m.relay.peer(slot)!, auto: null,
    scratch: roster.map(() => emptyIntent()), intents: roster.map(() => emptyIntent()), ended: null, events: [], evCount: {},
    muteUntil: -1, resp: { starts: 0, same: 0 }, prevSpeed: 0, ctorEventsSeen: 0, driver, online: true,
  };
  dev.session = new OnlineSession(spec, arena, world, (d) => { if (dev.online) m.relay.send(slot, d); }, {
    adoptWorld: (w) => { dev.auto = autopilot(w, m.md.nav, dev.session.localPid, 77 + slot); },
    ended: (e) => { dev.ended = e; },
  }, m.now);
  dev.auto = autopilot(dev.session.world, m.md.nav, dev.session.localPid, 77 + slot);
  return dev;
}

/** one 60 Hz step of the whole system */
function stepAll(m: Match): void {
  m.relay.pump(m.now);
  const tickNo = Math.round(m.now / TICK_MS);
  for (const d of m.devs) {
    if (!d.online) continue;
    const s = d.session;
    const pid = s.localPid;
    if (pid < 0) continue;
    const w = s.world;
    if (d.muteUntil > m.now) continue;                     // a silent device: no ticks, no frames
    let local: PlayerIntent;
    if (d.driver) local = d.driver(d, tickNo);
    else { d.auto!.think(d.scratch); local = d.scratch[pid]; }
    const r = w.runners[pid];
    const before = { x: r.x, z: r.z };
    const standing = r.alive && w.phase === 'live' && r.grounded && Math.hypot(r.vx, r.vz) < 0.05;
    s.tick(d.intents, local, m.now);
    d.onTick?.(d, local, Math.hypot(r.x - before.x, r.z - before.z));
    if (s.role === 'client' && standing && Math.hypot(local.moveX, local.moveZ) > 0.5 && s.client?.pred.active) {
      d.resp.starts++;
      if (Math.hypot(r.x - before.x, r.z - before.z) > 1e-4) d.resp.same++;
    }
    s.frame(TICK, m.now);
    d.events.length = 0;
    s.drain(d.events);
    for (const e of d.events) d.evCount[e.t] = (d.evCount[e.t] ?? 0) + 1;
  }
  m.now += TICK_MS;
}

/** one turn of the event loop: the KEYFRAME deflate / inflate (CompressionStream) resolve asynchronously, as in a page */
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

async function run(m: Match, seconds: number, until?: (m: Match) => boolean): Promise<void> {
  const n = Math.round(seconds / TICK);
  for (let i = 0; i < n; i++) {
    stepAll(m);
    await yieldLoop();
    if (until && until(m)) break;
  }
}

/** run until every online device saw the end (+ 2 s of tail), at most `maxS` */
async function runToEnd(m: Match, maxS: number): Promise<void> {
  const n = Math.round(maxS / TICK);
  let tail = -1;
  for (let i = 0; i < n; i++) {
    stepAll(m);
    await yieldLoop();
    const done = m.devs.filter((d) => d.online).every((d) => d.ended);
    if (done && tail < 0) tail = i;
    if (tail >= 0 && i - tail > 2.5 / TICK) break;
  }
}

function hostDev(m: Match): Device { return m.devs.find((d) => d.online && d.session.role === 'host')!; }

function pct(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}

function resultsAgree(a: MatchResult | null, b: MatchResult | null): { ok: boolean; why: string } {
  if (!a || !b) return { ok: false, why: `missing result (${!!a}/${!!b})` };
  if (a.winner !== b.winner) return { ok: false, why: `winner ${a.winner} vs ${b.winner}` };
  const sa = a.shares ?? [], sb = b.shares ?? [];
  let md = 0;
  for (let k = 0; k < Math.max(sa.length, sb.length); k++) md = Math.max(md, Math.abs((sa[k] ?? 0) - (sb[k] ?? 0)));
  if (md > 1e-9) return { ok: false, why: `shares differ by ${md}` };
  return { ok: true, why: `winner ${a.winner}, shares max diff ${md}` };
}

/** the shared agreement checks of a finished match */
function agreement(tag: string, m: Match, opts: { p95?: number; lag: number; replay?: boolean }): void {
  const h = hostDev(m);
  const hw = h.session.world;
  const hh = h.arena.painter.hash();
  const clients = m.devs.filter((d) => d.online && d !== h);
  const ends = m.devs.filter((d) => d.online);
  check(`${tag}: every device saw the end`, ends.every((d) => !!d.ended && d.ended.status === 'complete'),
    ends.map((d) => `P${d.slot}:${d.ended?.status ?? 'none'}`).join(' '));
  for (const c of clients) {
    const ra = resultsAgree(hw.result, c.ended?.result ?? null);
    check(`${tag}: P${c.slot} result = host's`, ra.ok, ra.why);
  }
  const hashes = clients.map((c) => c.arena.painter.hash());
  check(`${tag}: final painter hash equal on every device`, hashes.every((x) => x === hh), `host ${hh} · ${clients.map((c, i) => `P${c.slot} ${hashes[i]}`).join(' ')}`);
  let desync = 0, flipBad = 0, hashOk = 0, hashChecks = 0, gaps = 0;
  const errs: number[] = [];
  let corr = 0, maxErr = 0;
  for (const c of clients) {
    const cl = c.session.client;
    if (!cl) continue;
    desync += cl.stats.desyncs; flipBad += cl.stats.flipMismatch; hashOk += cl.stats.hashOk; hashChecks += cl.stats.hashChecks; gaps += cl.stats.gaps;
    errs.push(...cl.pred.stats.errs);
    corr += cl.pred.stats.corrections;
    if (VERBOSE) for (const b of cl.pred.stats.big) console.log(`   big P${c.slot}: ${JSON.stringify(b)}`);
  }
  for (const e of errs) maxErr = Math.max(maxErr, e);
  check(`${tag}: 0 desyncs (hash checks ${hashOk}/${hashChecks} matched, flip mismatches ${flipBad}, gaps ${gaps})`, desync === 0 && flipBad === 0 && hashOk === hashChecks && hashChecks > 0,
    `desyncs ${desync}`);
  if (opts.p95 !== undefined) {
    const p50 = pct(errs, 0.5), p95 = pct(errs, 0.95);
    check(`${tag}: prediction error p95 < ${opts.p95} m (lag ${opts.lag} ms)`, errs.length > 50 && p95 < opts.p95,
      `p50 ${f3(p50)} p95 ${f3(p95)} max ${f3(maxErr)} over ${errs.length} SNAPs, ${corr} corrections`);
    check(`${tag}: no rubber-band > 2 m`, maxErr <= 2 || pct(errs, 0.999) <= 2, `max ${f3(maxErr)} m (p99.9 ${f3(pct(errs, 0.999))})`);
  }
  if (opts.replay && m.replay) {
    const a = hw.hash(), b = m.replay.hash();
    check(`${tag}: host world hash = offline replay of the same intents`, a === b, `${a} vs ${b}`);
  }
  const rs = clients.reduce((acc, c) => ({ starts: acc.starts + c.resp.starts, same: acc.same + c.resp.same }), { starts: 0, same: 0 });
  // info: bot-driven starts include presses into a wall (no displacement anywhere); scenario R gates the response itself
  console.log(`   info ${tag}: ${rs.same}/${rs.starts} bot-driven input starts from standing moved the runner on that tick`);
}

// ───────────────────────────── scenarios ─────────────────────────────
async function scenarioA(lag: number, kit: string, seconds: number): Promise<void> {
  const tag = `A lag ${lag}${kit !== 'mist-rasp' ? ` ${kit}` : ''}`;
  const t0 = performance.now();
  const m = await makeMatch({ map: 'pier18', mode: 'teams', rule: 'turf', humans: 2, lag, seconds, seed: 4242 + lag, kits: ['mist-rasp', kit], replay: true });
  await runToEnd(m, seconds + 12);
  const h = hostDev(m);
  console.log(`   ${tag}: ${((performance.now() - t0) / 1000).toFixed(1)} s wall · host snaps ${h.session.host?.stats.snaps} (${((h.session.host?.stats.snapBytes ?? 0) / Math.max(1, h.session.host?.stats.snaps ?? 1)).toFixed(0)} B avg) · relay frames in ${m.relay.counts.framesIn}`);
  agreement(tag, m, { p95: lag === 0 ? 0.05 : 0.35, lag, replay: true });
}

/** J<jitter>[:<lag>]: arrival jitter on every link (FIFO kept) — the host's adaptive jitter buffer keeps the prediction error down:
 *  the fixed 2 / 6 buffer measured p95 0.142 m at 40 ms of jitter (limit 0.05 m at lag 0); adaptive: 0.000 */
async function scenarioJ(jitter: number, lag: number, seconds: number): Promise<void> {
  const keep = JITTER;
  JITTER = jitter;
  try {
    const tag = `J jitter ${jitter} ms, lag ${lag}`;
    const t0 = performance.now();
    const m = await makeMatch({ map: 'pier18', mode: 'teams', rule: 'turf', humans: 2, lag, seconds, seed: 777 + jitter, kits: ['mist-rasp', 'sheet-drum'], replay: true });
    await runToEnd(m, seconds + 12);
    const h = hostDev(m);
    console.log(`   ${tag}: ${((performance.now() - t0) / 1000).toFixed(1)} s wall · host underflows ${h.session.host?.stats.underflows} drops ${h.session.host?.stats.queueDrops} · seat targets ${JSON.stringify(h.session.host?.intentRates().map((r) => r.target))}`);
    agreement(tag, m, { p95: lag === 0 ? 0.05 : 0.35, lag, replay: true });
  } finally { JITTER = keep; }
}

async function scenarioM(mode: 'teams' | 'ffa', rule: 'turf' | 'washout', map: string, seconds: number): Promise<void> {
  const tag = `M 8 humans ${mode} ${rule} ${map}`;
  const t0 = performance.now();
  const kits = ['mist-rasp', 'sheet-drum', 'needle-glint', 'pop-well', 'mist-rasp', 'sheet-drum', 'needle-glint', 'pop-well'];
  const m = await makeMatch({ map, mode, rule, humans: 8, lag: 40, seconds, seed: 9001, kits, replay: true });
  await runToEnd(m, seconds + 12);
  const h = hostDev(m);
  const rates = h.session.host?.intentRates() ?? [];
  console.log(`   ${tag}: ${((performance.now() - t0) / 1000).toFixed(1)} s wall · intent Hz ${rates.map((r) => r.hz.toFixed(1)).join(' ')}`);
  check(`${tag}: every remote human's INTENTS ≥ 15 Hz (median)`, rates.length === 7 && rates.every((r) => r.hz >= 15), rates.map((r) => `${r.runner}:${r.hz.toFixed(1)}`).join(' '));
  agreement(tag, m, { p95: 0.35, lag: 40, replay: true });
}

/** scripted local drivers for the prediction stress patterns (lag 80) */
function patternDriver(kind: 'drum' | 'slick' | 'toggle'): Driver {
  return (d: Device, tick: number): PlayerIntent => {
    const s = d.session;
    const w = s.world;
    const r = w.runners[s.localPid];
    const it = emptyIntent();
    // head for the enemy half of the court (z sign of the enemy spawn), turning slowly
    const enemyZ = r.team === 1 ? 1 : -1;
    const phase = tick % 600;
    const goalZ = enemyZ * (phase < 300 ? 18 : -6);
    const goalX = Math.sin(tick / 180) * 8;
    const yaw = Math.atan2(goalX - r.x, goalZ - r.z);
    it.yaw = yaw; it.pitch = -0.25; it.moveZ = 1;
    if (kind === 'drum') { it.fire = true; }
    else if (kind === 'slick') {
      // 0.5 s firing ahead, then slick (SHIFT) into the fresh dye for 1 s
      const c = tick % 90;
      it.fire = c < 30; it.slick = c >= 30;
      it.pitch = -0.45;
    } else {
      it.fire = Math.floor(tick / 24) % 2 === 0;      // FIRE toggled every 0.4 s while running
    }
    if (r.tank < 12) { it.fire = false; it.slick = true; }
    return it;
  };
}

async function scenarioP(pattern: 'drum' | 'slick' | 'toggle', seconds: number): Promise<void> {
  const kit = pattern === 'drum' ? 'sheet-drum' : 'mist-rasp';
  const tag = `P ${pattern} (${kit}, lag 80)`;
  const m = await makeMatch({ map: 'pier18', mode: 'teams', rule: 'turf', humans: 2, lag: 80, seconds: Math.min(seconds, 90), seed: 31337, kits: ['mist-rasp', kit], drivers: [null, patternDriver(pattern)] });
  await runToEnd(m, Math.min(seconds, 90) + 12);
  const c = m.devs.find((d) => d.session.role === 'client')!;
  const errs = c.session.client!.pred.stats.errs;
  check(`${tag}: prediction error p95 < 0.35 m`, errs.length > 50 && pct(errs, 0.95) < 0.35,
    `p50 ${f3(pct(errs, 0.5))} p95 ${f3(pct(errs, 0.95))} max ${f3(Math.max(0, ...errs))} over ${errs.length} SNAPs, ${c.session.client!.pred.stats.corrections} corrections, ${c.session.client!.pred.pp.added} predicted paint shapes`);
  const h = hostDev(m);
  check(`${tag}: final painter hash equal`, h.arena.painter.hash() === c.arena.painter.hash(), `${h.arena.painter.hash()} vs ${c.arena.painter.hash()}`);
}

async function scenarioMigrate(graceful: boolean, seconds: number, mode: 'teams' | 'ffa' = 'teams', rule: 'turf' | 'washout' = 'turf'): Promise<void> {
  const tag = `${graceful ? 'G graceful' : 'H abrupt'} migration ${mode} ${rule}`;
  const S = Math.min(seconds, 90);
  const m = await makeMatch({ map: 'pier18', mode, rule, humans: 3, lag: 30, seconds: S, seed: 555 });
  const oldHost = hostDev(m);
  await run(m, 3 + S * 0.4);
  const flipsBefore = m.devs.map((d) => d.arena.painter.flips);
  const tBefore = oldHost.session.world.tick;
  if (graceful) {
    oldHost.session.handoff();                              // the page went hidden: SNAP + HANDOFF + handoff
    // the old host stays connected (a hidden tab) and stops ticking for 2 s, then returns as a client
    oldHost.muteUntil = m.now + 2000;
  } else {
    oldHost.online = false;                                 // the tab closed
    m.relay.drop(oldHost.slot, true);
  }
  await run(m, 3);
  const newHost = hostDev(m);
  check(`${tag}: a new host took over within ${graceful ? 1 : 3} s`, newHost !== oldHost && newHost.session.world.tick > tBefore,
    `new host P${newHost.slot}, tick ${tBefore} → ${newHost.session.world.tick}, relay log: ${m.relay.log.join(' | ')}`);
  check(`${tag}: the restore never reset the painter`, (newHost.session.stats.painterResetsDuringRestore === 0) && newHost.arena.painter.flips >= flipsBefore[m.devs.indexOf(newHost)],
    `resets ${newHost.session.stats.painterResetsDuringRestore}, flips ${flipsBefore[m.devs.indexOf(newHost)]} → ${newHost.arena.painter.flips}, restore hash mismatch ${newHost.session.stats.restoreHashMismatch}`);
  const ctorLeak = m.devs.filter((d) => d.online).reduce((a, d) => a + (d.session.stats.discardedCtorEvents > 0 ? 0 : 0), 0);
  check(`${tag}: the constructor events were discarded (none reached the view)`, newHost.session.stats.discardedCtorEvents >= 2 && ctorLeak === 0,
    `discarded ${newHost.session.stats.discardedCtorEvents}`);
  await runToEnd(m, S + 20);
  const alive = m.devs.filter((d) => d.online);
  check(`${tag}: the match completed with a result on every survivor`, alive.every((d) => d.ended?.status === 'complete' && !!d.ended.result),
    alive.map((d) => `P${d.slot}:${d.ended?.status}`).join(' '));
  const h = hostDev(m);
  for (const d of alive) {
    if (d === h) continue;
    const ra = resultsAgree(h.session.world.result, d.ended?.result ?? null);
    check(`${tag}: P${d.slot} result = new host's`, ra.ok, ra.why);
  }
  const hh = h.arena.painter.hash();
  check(`${tag}: survivors' final painter hash equal`, alive.every((d) => d.arena.painter.hash() === hh), alive.map((d) => `P${d.slot} ${d.arena.painter.hash()}`).join(' '));
  check(`${tag}: migrations = 1 in end`, alive.every((d) => (d.ended?.migrations ?? -1) === 1), alive.map((d) => `P${d.slot}:${d.ended?.migrations}`).join(' '));
  // seat totals continue across the migration: a seat human-driven the whole match has totals = its runner's counters
  const e = h.ended!;
  const rows: string[] = [];
  let ok = true;
  for (const d of alive) {
    const runner = h.session.host?.seatOfSlot(d.slot)?.runner ?? -1;
    const er = e.runners.find((x) => x.id === runner);
    const st = er?.seat ?? null;
    const good = !!er && !!st && st.human && Math.abs(st.painted - er.painted) <= 1e-3 * Math.max(1, er.painted) + 0.01
      && st.washes === er.washes && st.washedCount === er.washedCount && st.liveTicks >= Math.round(S / TICK) - 120;
    if (!good) ok = false;
    rows.push(`P${d.slot}/r${runner}: seat ${st ? `${st.painted.toFixed(1)}/${st.washes}/${st.washedCount}/${st.liveTicks}t` : 'null'} runner ${er ? `${er.painted.toFixed(1)}/${er.washes}/${er.washedCount}` : '-'}`);
  }
  check(`${tag}: seat totals continue across the migration (always-human seats = their runners' counters)`, ok, rows.join(' · '));
}

async function scenarioL(seconds: number): Promise<void> {
  const tag = 'L late join + reconnect';
  const S = Math.max(100, Math.min(seconds, 120));
  (globalThis as { __DF_NET_SEATLOG__?: boolean }).__DF_NET_SEATLOG__ = true;
  const m = await makeMatch({ map: 'lockwell', mode: 'teams', rule: 'turf', humans: 2, lag: 25, seconds: S, seed: 777, lateJoin: [2] });
  (globalThis as { __DF_NET_SEATLOG__?: boolean }).__DF_NET_SEATLOG__ = false;
  await run(m, 3 + 30);
  // the late joiner: its socket joins; the host reserves a runner and re-sends the roster; it loads, says `loaded`
  const peer = mkPeer(2, 25, m.devs);
  m.relay.join(peer, false);
  await run(m, 0.5);
  const h0 = hostDev(m);
  const seat = h0.session.host!.seatOfSlot(2);
  check(`${tag}: the host reserved a runner for the late joiner`, !!seat, seat ? `runner ${seat.runner}` : 'none');
  if (!seat) return;
  const roster = m.spec.roster;
  const seats = [...h0.session.seats].map(([slot, runner]) => ({ slot, runner }));
  const members = m.relay.members();
  const late = makeDevice(m, 2, m.relay.hostSlot, roster, seats, members, false, null);
  m.devs.push(late);
  late.session.sendLoaded();
  await run(m, 25);
  // reconnect: P1 drops (not left) for 2 s, comes back, says loaded again
  const p1 = m.devs.find((d) => d.slot === 1)!;
  m.relay.drop(1, false);
  p1.online = false;
  await run(m, 2);
  p1.online = true;
  m.relay.join(m.relay.peer(1) ?? mkPeer(1, 25, m.devs), true);
  p1.session.client?.onHostChange();
  p1.session.sendLoaded();
  await runToEnd(m, S + 20);
  const h = hostDev(m);
  const hh = h.arena.painter.hash();
  check(`${tag}: late joiner's final painter hash = host's`, late.arena.painter.hash() === hh, `${late.arena.painter.hash()} vs ${hh} (keyframes ${late.session.client?.stats.keyframes}, re-applied ${late.session.client?.stats.reapplied})`);
  check(`${tag}: reconnected client's final painter hash = host's`, p1.arena.painter.hash() === hh, `${p1.arena.painter.hash()} vs ${hh} (keyframes ${p1.session.client?.stats.keyframes})`);
  // seat totals vs the host's per-tick log over the human-driven ticks
  const log = h.session.host!.seatLog ?? [];
  for (const d of [late, p1]) {
    const runner = h.session.host!.seatOfSlot(d.slot)?.runner ?? -1;
    const rows = log.filter((x) => x.runner === runner);
    let painted = 0, washes = 0, washed = 0, prev: typeof rows[number] | null = null, live = 0;
    for (const row of rows) {
      if (prev && row.driven) { painted += row.painted - prev.painted; washes += row.washes - prev.washes; washed += row.washedCount - prev.washedCount; live++; }
      prev = row;
    }
    const st = d.ended?.runners.find((x) => x.id === runner)?.seat ?? null;
    const ok = !!st && Math.abs(st.painted - painted) < 1e-3 * Math.max(1, painted) + 0.01 && st.washes === washes && st.washedCount === washed && Math.abs(st.liveTicks - live) <= 1;
    check(`${tag}: P${d.slot} seat totals = the human-driven increase only`, ok,
      `end seat ${st ? `painted ${st.painted.toFixed(2)} washes ${st.washes} washed ${st.washedCount} live ${st.liveTicks}` : 'null'} · log painted ${painted.toFixed(2)} washes ${washes} washed ${washed} live ${live}`);
  }
}

async function scenarioT(seconds: number): Promise<void> {
  const tag = 'T bot takeover';
  const S = Math.min(seconds, 60);
  const m = await makeMatch({ map: 'pier18', mode: 'teams', rule: 'turf', humans: 2, lag: 20, seconds: S, seed: 2468 });
  await run(m, 3 + 15);
  const c = m.devs.find((d) => d.session.role === 'client')!;
  const h = hostDev(m);
  const seat = h.session.host!.seatOfSlot(c.slot)!;
  c.muteUntil = m.now + 4000;                             // 4 s of silence
  await run(m, 3.5);
  const took = !seat.driven && h.session.director!.isHuman(seat.runner) === false;
  await run(m, 2);
  const back = seat.driven && h.session.director!.isHuman(seat.runner);
  check(`${tag}: the bot took the runner after 3 s of silence and gave it back`, took && back, `after 3.5 s: driven ${!took} · after resume: driven ${back} · takeovers ${h.session.host!.stats.takeovers}`);
  await runToEnd(m, S + 10);
  check(`${tag}: final painter hash equal`, h.arena.painter.hash() === c.arena.painter.hash(), `${h.arena.painter.hash()} vs ${c.arena.painter.hash()}`);
}

/** R: the client's own movement responds on the very tick of the input (prediction), while the host sees it ≥ 1 RTT later */
async function scenarioR(): Promise<void> {
  const tag = 'R own-movement response (lag 80)';
  let live0 = -1;
  const script: Driver = (d: Device, tick: number): PlayerIntent => {
    const s = d.session;
    const r = s.world.runners[s.localPid];
    const it = emptyIntent();
    it.yaw = r.spawnPoint().yaw; it.pitch = -0.2;
    if (s.world.phase !== 'live') return it;
    if (live0 < 0) live0 = tick;
    const c = (tick - live0) % 150;
    if (c >= 60 && c < 90) it.moveZ = 1;                    // forward toward mid-court for 0.5 s
    else if (c >= 120) it.moveZ = -1;                         // and back
    return it;
  };
  const m = await makeMatch({ map: 'pier18', mode: 'teams', rule: 'turf', humans: 2, lag: 80, seconds: 30, seed: 8080, drivers: [null, script] });
  const c = m.devs.find((d) => d.session.role === 'client')!;
  const h = hostDev(m);
  const starts: Array<{ tick: number; moved: number; hostLag: number }> = [];
  let prevMove = 0, open: { tick: number; moved: number; hostLag: number } | null = null, hostPrev: { x: number; z: number } | null = null;
  let tickNo = 0;
  c.onTick = (d, local, moved) => {
    tickNo++;
    const mv = Math.abs(local.moveZ) > 0.5 ? 1 : 0;
    if (mv && !prevMove && d.session.client?.pred.active) { open = { tick: tickNo, moved, hostLag: -1 }; starts.push(open); }
    prevMove = mv;
    // the host's view of the same runner: the first tick it moves after the input started
    const hr = h.session.world.runners[d.session.localPid];
    if (open && open.hostLag < 0 && hostPrev && Math.hypot(hr.x - hostPrev.x, hr.z - hostPrev.z) > 1e-4) open.hostLag = tickNo - open.tick;
    hostPrev = { x: hr.x, z: hr.z };
  };
  await runToEnd(m, 42);
  const ok = starts.length >= 4 && starts.every((x) => x.moved > 1e-3);
  check(`${tag}: every input start moved the predicted runner on its own tick`, ok,
    `${starts.filter((x) => x.moved > 1e-3).length}/${starts.length} starts moved that tick (${starts.map((x) => x.moved.toFixed(3)).join(' ')} m); the host saw them ${starts.map((x) => x.hostLag).join(' ')} ticks later`);
}

async function scenarioU(seconds: number): Promise<void> {
  const tag = 'U units per match';
  const S = Math.min(seconds, 180);
  const m = await makeMatch({ map: 'pier18', mode: 'teams', rule: 'turf', humans: 2, lag: 20, seconds: S, seed: 1357 });
  const before = m.relay.counts.framesIn;
  await runToEnd(m, S + 10);
  const frames = m.relay.counts.framesIn - before;
  // §O9.2 2-human row: (20 + 20) × 186 s incoming frames for 3:00 + countdown; scaled to this match's length
  const expect = 40 * (S + 6);
  const units = Math.ceil(frames / 20) + 2;
  const expUnits = Math.ceil(expect / 20) + 2;
  check(`${tag}: incoming frames within ±10 % of §O9.2 (2 humans, ${S} s)`, Math.abs(frames - expect) <= 0.1 * expect,
    `${frames} frames (${units} units) vs ${expect} expected (${expUnits} units)`);
}

// ───────────────────────────── --relay <url>: end to end through net/api.ts over a real relay (wrangler dev) ─────────────
// The real OnlineApi (net/api.ts + net/transport.ts: CREATE ROOM / JOIN ROOM / QUICK MATCH, hello / welcome / assign /
// roster / loaded, the session) against the NET-SERVER lane's Worker. Each device is a NetApi whose driver builds the match
// world in Node; a 60 Hz accumulator loop on the real clock ticks every device; the local intents come from ?autopilot
// (a bot brain on the device's own world). The Origin header is the dev origin (DEV_ORIGINS).

interface E2EDev {
  name: string; api: NetApi; net: GameNet | null; world: MatchWorld | null; arena: SessionArena | null;
  intents: PlayerIntent[]; local: PlayerIntent; ended: EndInfo | null; events: number; localPid: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function e2eDevice(i: number, url: string, netdur: number): E2EDev {
  const dev: E2EDev = { name: `N${i}`, api: null as unknown as NetApi, net: null, world: null, arena: null, intents: [], local: emptyIntent(), ended: null, events: 0, localPid: -1 };
  const driver: OnlineDriver = {
    load: async (spec) => {
      const md = await mapData(spec.map);
      const arena = arenaOf(md);
      const world = new MatchWorld({ def: arena.def, geo: arena.geo, physics: arena.physics, painter: arena.painter, roster: spec.roster, seed: spec.seed,
        durationS: spec.durationS, countdownS: spec.countdownS, mode: spec.mode, ...(spec.rule === 'washout' ? { rule: 'washout' as const } : {}) });
      dev.arena = arena; dev.world = world; dev.localPid = spec.localPid;
      dev.intents = spec.roster.map(() => emptyIntent());
      const h: OnlineGameHandle = {
        world, arena, attach: (n) => { dev.net = n; }, adopt: (w) => { dev.world = w; }, courtReload: () => undefined, renamed: () => undefined,
      };
      return h;
    },
    ended: (e) => { dev.ended = e; },
    toLobby: () => undefined,
    playOffline: () => undefined,
    simMs: () => 1 + i * 0.25,
    device: () => 'kbm',
  };
  const tok = new Map<string, string>();      // a browser tab's sessionStorage: one per device (the reconnect token of a room)
  dev.api = new NetApi({ relay: url, build: 'dyefield-1.4.0:p1:probe', driver, dev: { netdur, autopilot: 900 + i }, tokens: { get: (k) => tok.get(k) ?? null, set: (k, v) => { tok.set(k, v); }, del: (k) => { tok.delete(k); } } });
  return dev;
}

async function e2eLoop(devs: E2EDev[], maxS: number, stop: () => boolean): Promise<void> {
  const t0 = performance.now();
  let last = t0, acc = 0;
  while (performance.now() - t0 < maxS * 1000) {
    await sleep(3);
    const now = performance.now();
    const dt = now - last;
    acc += dt; last = now;
    let steps = 0;
    while (acc >= TICK_MS && steps < 5) {
      for (const d of devs) if (d.net) d.net.tick(d.intents, d.local, now);
      acc -= TICK_MS; steps++;
    }
    if (acc >= TICK_MS) acc %= TICK_MS;
    const ev: SimEvent[] = [];
    for (const d of devs) if (d.net) { d.net.frame(dt / 1000, now); ev.length = 0; d.net.drain(ev); d.events += ev.length; }
    if (stop()) break;
  }
}

async function waitFor(devs: E2EDev[], cond: () => boolean, maxS: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < maxS * 1000) {
    if (cond()) return true;
    await e2eLoop(devs, 0.05, () => false);
  }
  return cond();
}

async function e2eCodeRoom(url: string, n: number, netdur: number): Promise<void> {
  const tag = `E code room ${n} humans over ${url} (${netdur} s)`;
  const devs = Array.from({ length: n }, (_, i) => e2eDevice(i, url, netdur));
  const prof = (i: number): OnlineProfile => ({ name: `Net${i}`, kit: ['mist-rasp', 'sheet-drum', 'pop-well', 'needle-glint'][i % 4], crew: (i % 2 === 0 ? 1 : 2) as 1 | 2, ffaColor: i + 1 });
  devs[0].api.createRoom('teams', 'turf', prof(0));
  const okRoom = await waitFor(devs, () => devs[0].api.status().kind === 'room', 15);
  const st = devs[0].api.status();
  check(`${tag}: CREATE ROOM gave a code`, okRoom && st.kind === 'room', JSON.stringify(st).slice(0, 200));
  if (st.kind !== 'room') { for (const d of devs) d.api.leave(false); return; }
  const code = st.room.code;
  for (let i = 1; i < n; i++) devs[i].api.joinRoom(code, prof(i));
  const okJoin = await waitFor(devs, () => { const s = devs[0].api.status(); return s.kind === 'room' && s.room.members.filter((m) => m.conn).length === n; }, 20);
  check(`${tag}: ${n - 1} JOIN ROOM ${code} seated`, okJoin, JSON.stringify(devs.map((d) => d.api.status().kind)));
  devs[0].api.configure({ map: 'pier18', preset: 'noon', skill: 'swell' });
  await waitFor(devs, () => false, 0.5);
  devs[0].api.start();
  const okStart = await waitFor(devs, () => devs.every((d) => !!d.net), 40);
  check(`${tag}: every device loaded its session`, okStart, devs.map((d) => `${d.name}:${d.net ? (d.net as OnlineSession).role : 'none'}`).join(' ') + ` · ${devs[0].api.log.slice(-4).join(' | ')}`);
  await e2eLoop(devs, netdur + 25, () => devs.every((d) => !!d.ended));
  await e2eLoop(devs, 2.5, () => false);
  const host = devs.find((d) => (d.net as OnlineSession | null)?.role === 'host');
  check(`${tag}: every device saw the end`, devs.every((d) => d.ended?.status === 'complete'), devs.map((d) => `${d.name}:${d.ended?.status ?? 'none'}`).join(' '));
  if (host) {
    const hh = host.arena!.painter.hash();
    check(`${tag}: final painter hash equal on every device`, devs.every((d) => d.arena?.painter.hash() === hh), devs.map((d) => `${d.name} ${d.arena?.painter.hash()}`).join(' '));
    for (const d of devs) {
      if (d === host) continue;
      const ra = resultsAgree((host.net as OnlineSession).world.result, d.ended?.result ?? null);
      check(`${tag}: ${d.name} result = host's`, ra.ok, ra.why);
      const c = (d.net as OnlineSession).client;
      if (c) {
        const pe = c.predErr();
        check(`${tag}: ${d.name} 0 desyncs, hash checks matched, prediction p95 < 0.1 m`, c.stats.desyncs === 0 && c.stats.hashChecks > 0 && c.stats.hashOk === c.stats.hashChecks && pe.p95 < 0.1,
          `desyncs ${c.stats.desyncs}, hash ${c.stats.hashOk}/${c.stats.hashChecks}, gaps ${c.stats.gaps}, keyframes ${c.stats.keyframes}, pred p50 ${f3(pe.p50)} p95 ${f3(pe.p95)} (${pe.n}), snaps ${c.stats.snaps}`);
      }
    }
    const rates = (host.net as OnlineSession).host?.intentRates() ?? [];
    check(`${tag}: the host received every client's INTENTS at ≥ 15 Hz`, rates.length === n - 1 && rates.every((r) => r.hz >= 15), rates.map((r) => `${r.slot}:${r.hz.toFixed(1)}Hz`).join(' '));
  }
  for (const d of devs) d.api.leave(false);
  await sleep(300);
}

/** the HOST's socket drops mid-match (a network blip): the Room promotes another human at once and the `host` message goes to
 *  nobody — the old host learns it was replaced from the reconnect's `welcome` (room.hostSlot) and comes back as a CLIENT
 *  through a KEYFRAME; the match completes with equal results and painter hashes everywhere (§O6.2 / §O7.2). */
async function e2eHostDrop(url: string, n: number, netdur: number): Promise<void> {
  const tag = `H host socket drops + returns, ${n} humans over ${url} (${netdur} s)`;
  const devs = Array.from({ length: n }, (_, i) => e2eDevice(20 + i, url, netdur));
  const prof = (i: number): OnlineProfile => ({ name: `Hd${i}`, kit: ['mist-rasp', 'sheet-drum', 'pop-well'][i % 3], crew: (i % 2 === 0 ? 1 : 2) as 1 | 2, ffaColor: i + 1 });
  devs[0].api.createRoom('teams', 'turf', prof(0));
  await waitFor(devs, () => devs[0].api.status().kind === 'room', 15);
  const st = devs[0].api.status();
  if (st.kind !== 'room') { check(`${tag}: CREATE ROOM gave a code`, false, JSON.stringify(st).slice(0, 160)); return; }
  for (let i = 1; i < n; i++) devs[i].api.joinRoom(st.room.code, prof(i));
  await waitFor(devs, () => { const s = devs[0].api.status(); return s.kind === 'room' && s.room.members.filter((m) => m.conn).length === n; }, 20);
  devs[0].api.configure({ map: 'pier18', preset: 'noon', skill: 'swell' });
  await waitFor(devs, () => false, 0.5);
  devs[0].api.start();
  const okStart = await waitFor(devs, () => devs.every((d) => !!d.net), 40);
  check(`${tag}: every device loaded its session`, okStart, devs.map((d) => `${d.name}:${d.net ? (d.net as OnlineSession).role : 'none'}`).join(' '));
  if (!okStart) { for (const d of devs) d.api.leave(false); return; }
  await e2eLoop(devs, 10, () => false);
  const old = devs.find((d) => (d.net as OnlineSession).role === 'host')!;
  old.api.dropSocket();
  const promoted = await waitFor(devs, () => devs.some((d) => d !== old && (d.net as OnlineSession).role === 'host'), 8);
  check(`${tag}: another device is promoted`, promoted, devs.map((d) => `${d.name}:${(d.net as OnlineSession | null)?.role}`).join(' '));
  const back = await waitFor(devs, () => (old.net as OnlineSession).role === 'client' && ((old.net as OnlineSession).client?.stats.keyframes ?? 0) > 0, 15);
  check(`${tag}: the old host came back as a client through a KEYFRAME`, back, `role ${(old.net as OnlineSession).role}, keyframes ${(old.net as OnlineSession).client?.stats.keyframes}, log ${old.api.log.slice(-4).join(' | ')}`);
  if (!back) {
    const nh = devs.find((d) => d !== old && (d.net as OnlineSession).role === 'host');
    const hs = (nh?.net as OnlineSession | undefined)?.host;
    console.log('   debug new host seats:', JSON.stringify(hs?.seats.map((x) => x ? { runner: x.runner, slot: x.slot, local: x.local, conn: x.conn, driven: x.driven, loaded: x.loaded, kfWanted: x.keyframeWanted, kfJoin: x.keyframeJoin, kfAt: x.keyframeAt } : null)), 'keyframes sent', hs?.stats.keyframes);
    try { const r = await fetch(url.replace(/^ws/, 'http') + '/__dev/room/' + st.room.code); const j = await r.json() as { st?: { hostSlot?: number; phase?: string; hostLosses?: number; members?: Array<{ slot: number; conn: boolean; helloed?: boolean; leftAt?: number }> } }; console.log('   debug relay room:', JSON.stringify(j).slice(0, 700)); } catch (e) { console.log('   debug relay room failed', String(e)); }
    const c = (old.net as OnlineSession).client;
    console.log('   debug old host client:', JSON.stringify({ synced: c?.synced, stats: c?.stats, lastTick: c?.lastTick }), 'api log', JSON.stringify(old.api.log.slice(-8)));
  }
  await e2eLoop(devs, netdur + 25, () => devs.every((d) => !!d.ended));
  await e2eLoop(devs, 2.5, () => false);
  check(`${tag}: every device saw the end`, devs.every((d) => d.ended?.status === 'complete'), devs.map((d) => `${d.name}:${d.ended?.status ?? 'none'}`).join(' '));
  const host = devs.find((d) => (d.net as OnlineSession | null)?.role === 'host');
  if (host) {
    const hh = host.arena!.painter.hash();
    check(`${tag}: final painter hash equal on every device`, devs.every((d) => d.arena?.painter.hash() === hh), devs.map((d) => `${d.name} ${d.arena?.painter.hash()}`).join(' '));
    for (const d of devs) {
      if (d === host) continue;
      const ra = resultsAgree((host.net as OnlineSession).world.result, d.ended?.result ?? null);
      check(`${tag}: ${d.name} result = host's`, ra.ok, ra.why);
    }
  }
  for (const d of devs) d.api.leave(false);
  await sleep(300);
}

async function e2eQuick(url: string, n: number, liveS: number): Promise<void> {
  const tag = `Q quick match ${n} humans over ${url}`;
  const devs = Array.from({ length: n }, (_, i) => e2eDevice(10 + i, url, 0));
  for (let i = 0; i < n; i++) devs[i].api.quickMatch('ffa', 'washout', { name: `Quick${i}`, kit: 'mist-rasp', crew: 0, ffaColor: i + 3 });
  const okStart = await waitFor(devs, () => devs.every((d) => !!d.net), 60);
  check(`${tag}: matched, room auto-started, every device loaded`, okStart, devs.map((d) => `${d.name}:${d.api.status().kind}:${d.net ? (d.net as OnlineSession).role : 'none'}`).join(' '));
  if (!okStart) { for (const d of devs) d.api.leave(false); return; }
  await e2eLoop(devs, liveS, () => false);
  for (const d of devs) {
    const c = (d.net as OnlineSession).client;
    if (!c) continue;
    check(`${tag}: ${d.name} 0 desyncs over ${liveS} s live (hash checks matched)`, c.stats.desyncs === 0 && c.stats.hashChecks > 0 && c.stats.hashOk === c.stats.hashChecks,
      `desyncs ${c.stats.desyncs}, hash ${c.stats.hashOk}/${c.stats.hashChecks}, snaps ${c.stats.snaps}, pred p50 ${f3(c.predErr().p50)} p95 ${f3(c.predErr().p95)}, corrections ${c.pred.stats.corrections}`);
  }
  const hq = devs.find((d) => (d.net as OnlineSession).host)?.net as OnlineSession | undefined;
  if (hq?.host) console.log(`   info ${tag}: host underflows ${hq.host.stats.underflows}, queue drops ${hq.host.stats.queueDrops}, neutral ticks ${hq.host.stats.neutralTicks}, intent frames ${hq.host.stats.intentFrames}`);
  for (const d of devs) d.api.leave(false);
  await sleep(300);
}

// ───────────────────────────── main ─────────────────────────────
async function main(): Promise<number> {
  try {
    R = await loadRapier();
  } catch (e) { console.log('SETUP FAILED:', e); return 2; }
  const t0 = performance.now();
  const relay = arg('--relay', '');
  if (relay && (argv.includes('--clients') || argv.includes('--synthetic'))) {
    // §O12.2 relay-only modes (no sim): the NET-SERVER lane's relay probe implements them (load: host + n−1 clients at the
    // real rates, order / completeness, relay RTT p50 / p99, the /health delta; synthetic: exactly N incoming frames; both
    // refuse a closed day or a run that does not fit the remaining cap). One implementation, reached from here too.
    const { spawnSync } = await import('node:child_process');
    const script = resolve(HERE, '..', '..', '..', 'workers', 'dyefield-net', 'test', 'relay_probe.mjs');
    const r = spawnSync(process.execPath, [script, ...argv], { stdio: 'inherit' });
    return r.status ?? 2;
  }
  if (relay) {
    const origin = arg('--origin', 'http://127.0.0.1:5222');
    WsTransport.factory = (u: string): WebSocket => new (globalThis as unknown as { WebSocket: new (u: string, o: unknown) => WebSocket }).WebSocket(u, { headers: { Origin: origin } });
    const nd = Number(arg('--netdur', '40'));
    try {
      if (!ONLY.length || ONLY.includes('E')) await e2eCodeRoom(relay, Number(arg('--humans', '3')), nd);
      if (!ONLY.length || ONLY.includes('Q')) await e2eQuick(relay, 2, 20);
      if (!ONLY.length || ONLY.includes('H')) await e2eHostDrop(relay, 3, nd);
    } catch (e) { check('relay e2e: ran without an exception', false, (e as Error).stack ?? String(e)); }
    const fails = checks.filter((c) => !c.pass);
    console.log('-'.repeat(100));
    console.log(`probe_net --relay: ${fails.length ? 'FAIL' : 'PASS'} (${checks.length - fails.length}/${checks.length} checks, ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    return fails.length ? 1 : 0;
  }
  for (const sc of RUN) {
    console.log(`── ${sc}`);
    try {
      if (sc.startsWith('A')) { const [lag, kit] = sc.slice(1).split(':'); await scenarioA(Number(lag) || 0, kit || 'mist-rasp', SECONDS); }
      else if (sc.startsWith('M')) { const [mode, rule, map] = sc.slice(1).split(':'); await scenarioM(mode === 'ffa' ? 'ffa' : 'teams', rule === 'washout' ? 'washout' : 'turf', map || 'pier18', Math.min(SECONDS, 90)); }
      else if (sc.startsWith('J')) { const [jt, lg] = sc.slice(1).split(':'); await scenarioJ(Number(jt) || 40, Number(lg) || 0, Math.min(SECONDS, 90)); }
      else if (sc.startsWith('P')) await scenarioP(sc.slice(1) as 'drum' | 'slick' | 'toggle', SECONDS);
      else if (sc.startsWith('G') || sc.startsWith('H')) {
        const [, mode, rule] = sc.split(':');
        await scenarioMigrate(sc.startsWith('G'), SECONDS, mode === 'ffa' ? 'ffa' : 'teams', rule === 'washout' ? 'washout' : 'turf');
      }
      else if (sc === 'L') await scenarioL(SECONDS);
      else if (sc === 'T') await scenarioT(SECONDS);
      else if (sc === 'U') await scenarioU(SECONDS);
      else if (sc === 'R') await scenarioR();
      else console.log(`unknown scenario ${sc}`);
    } catch (e) {
      check(`${sc}: ran without an exception`, false, (e as Error).stack ?? String(e));
    }
  }
  const fails = checks.filter((c) => !c.pass);
  console.log('-'.repeat(100));
  console.log(`probe_net: ${fails.length ? 'FAIL' : 'PASS'} (${checks.length - fails.length}/${checks.length} checks, ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  try {
    const dir = resolve(HERE, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, QUICK ? 'probe_net_quick.json' : 'probe_net.json'), JSON.stringify({ at: new Date().toISOString(), scenarios: RUN, seconds: SECONDS, checks }, null, 2));
  } catch { /* report only */ }
  if (VERBOSE) console.log(JSON.stringify(checks, null, 2));
  return fails.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.log('SETUP FAILED:', e); process.exit(2); });

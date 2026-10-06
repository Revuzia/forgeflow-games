// BLOCKTOOTH - _harness/net/online4_entry.ts (lane O-REPORT; gate H4 / H6 page). ONE human of an ONLINE VS match per page, on the REAL stack:
// real Supabase Realtime (project wugox, a UNIQUE build string per run so no real player's room / lobby ever matches), a real WebRTC mesh
// between the pages (each page is a separate browser process driven by _harness/net/online4.py), the real vsWorldPort, and the real
// PortalClient + VsIdentityBook reporting the result through a portal stand-in frame (bridge_host.html) when there is one.
//
//   online4.html?run=<id>&name=p0&mode=quick|host|join&code=ABCD&wait=8000&short=1&seed=1337&biome=grideast&startNow=0
//
//   mode=quick  session.quickMatch(wait)         (2 humans + 2 bots when only 2 pages seek)
//   mode=host   session.hostCode(code)           (starts at 4 humans, or when startNow=<ms> elapsed: the D8 "Start now with bots" button)
//   mode=join   session.joinCode(code)
//   short=1     a SHORT match: VS.phase = 40 / 80 / 125 / 150 s (the same override on every page, so the sims stay identical). This is a
//               PACING override only (the net behaviour under test does not depend on the phase lengths); short=0 plays the real 10:45.
//
// window.__H4__ (read by online4.py): phase, id, seat, host, matchId, events[], snap() (small: polled), hashes() (the checkpoint log),
// standings, agreed, report (what the portal client filed), error. The page drives its own seat like rtc4_entry's humans: it eats
// the nearest standing building and picks CARD RAIL cards (card byte) ~1.5 s after the rail opens.
import type { World } from '../../src/core/types.ts';
import { VS } from '../../src/core/config.ts';
import { NET_PROTO, SEATS, type StartInfo } from '../../src/net/proto.ts';
import { OnlineSession, type SessionEvent } from '../../src/net/session.ts';
import { vsWorldPort, vsStartInfo } from '../../src/net/simport.ts';
import type { SimPort } from '../../src/net/simport.ts';
import { PortalClient, VsIdentityBook, resultsMajority } from '../../src/net/portal.ts';
import { VsEventTally } from '../../src/data/vsgoals.ts';
import { emptyProfile } from '../../src/meta/profile.ts';

const qs = new URLSearchParams(location.search);
const RUN = qs.get('run') ?? 'x';
const BUILD = 'h4-' + RUN;
const NAME = qs.get('name') ?? 'p';
const MODE = qs.get('mode') ?? 'quick';
const CODE = qs.get('code') ?? '';
const WAIT = Number(qs.get('wait') ?? 8000);
const SHORT = qs.get('short') !== '0';
const SEED = Number(qs.get('seed') ?? 1337) >>> 0;
const BIOME = qs.get('biome') ?? 'grideast';
const START_NOW_MS = Number(qs.get('startNow') ?? 0);
const LINEUP = ['molo', 'voltkite', 'hearthback', 'briarwick'];

const H: Record<string, unknown> = { phase: 'init', events: [] as string[], error: null, build: BUILD, name: NAME, short: SHORT, engine: navigator.userAgent };
(window as unknown as { __H4__: unknown }).__H4__ = H;
const ev = (m: string): void => { (H.events as string[]).push(`${(performance.now() / 1000).toFixed(1)} ${m}`); if ((H.events as string[]).length > 400) (H.events as string[]).shift(); };

async function main(): Promise<void> {
  if (SHORT) {
    const V = VS as unknown as { phase: { openEndS: number; takeoverEndS: number; finalEndS: number; hardEndS: number }; takeoverUntilS: number };
    V.phase.openEndS = 40; V.phase.takeoverEndS = 80; V.phase.finalEndS = 125; V.phase.hardEndS = 150;
    V.takeoverUntilS = 25;
  }
  const portal = new PortalClient({ cloudProfile: false, getProfile: () => emptyProfile(), getBests: () => ({}), adopt: () => { /* none */ } });
  portal.start();
  const book = new VsIdentityBook(portal);
  const tally = new VsEventTally(-1);
  let tallySlot = -1;
  // wrap the port so every sim event reaches the tally (and a world REBUILD restarts it)
  const base = vsWorldPort({ viewSeat: () => Math.max(0, session.start ? session.start.seats.findIndex((x) => x.peer === session.room.id) : 0) });
  const sim: SimPort<World> = {
    ...base,
    create: (start) => { const w = base.create(start); tally.crown = -1; tally.crownKos = 0; tally.kos = 0; tally.deaths = 0; tally.rivalsKo.clear(); return w; },
    step: (w, f) => { base.step(w, f); if (tallySlot >= 0) for (const e of w.events) tally.feed(e); },
  };
  let n = 0;
  const makeStart = (humans: string[]): StartInfo => vsStartInfo({
    proto: NET_PROTO, build: BUILD, matchId: `blocktooth:${BUILD}:${CODE || 'Q'}:${++n}`, seed: SEED, biome: BIOME, lead: 3,
    seats: Array.from({ length: SEATS }, (_, s) => ({ kind: s < humans.length ? 'human' as const : 'bot' as const,
      peer: s < humans.length ? humans[s] : null, name: s < humans.length ? `H${s}` : `BOT ${s}`, titan: LINEUP[s], botLevel: 1 })),
  });
  const session: OnlineSession<World> = new OnlineSession<World>({
    build: BUILD, name: NAME, makeStart, sim, connectMs: 10000,
    onEvent: (e: SessionEvent) => {
      if (e.type === 'status') { H.status = e.status.phase; return; }
      if (e.type === 'net') { if (e.ev.type !== 'roster' && e.ev.type !== 'late') ev(`net ${e.ev.type} ${JSON.stringify(e.ev).slice(0, 120)}`); return; }
      ev(`${e.type} ${JSON.stringify(e).slice(0, 200)}`);
      if (e.type === 'started') {
        H.phase = 'started'; H.seat = e.seat; H.host = e.host; H.matchId = e.start.matchId; H.joined = e.joined;
        H.unreachable = e.unreachable; H.startedAtMs = performance.now();
        H.humans = e.start.seats.filter((s) => s.kind === 'human').length;
        tallySlot = e.seat; tally.local = e.seat;
        book.attach(session.room, e.start.matchId);
        driveInputs();
      } else if (e.type === 'result') {
        H.standings = e.standings; H.agreed = e.agreed;
        void finish();
      } else if (e.type === 'error') { H.error = e.why; }
    },
  });
  H.id = session.room.id;
  (window as unknown as { __SESSION__: unknown }).__SESSION__ = session;

  const picked = new Map<string, number>();
  let inputTimer = 0;
  function driveInputs(): void {
    window.clearInterval(inputTimer);
    inputTimer = window.setInterval(() => {
      const w = session.world;
      const p = session.peer;
      if (!w || !p) return;
      const seat = p.mySeat();
      const P = seat >= 0 ? w.players[seat] : null;
      if (!P) return;
      let best = Infinity, bx = P.titan.x, bz = P.titan.z;
      for (const b of w.city.buildings) if (b.alive > 0) { const d = (b.x - P.titan.x) ** 2 + (b.z - P.titan.z) ** 2; if (d < best) { best = d; bx = b.x; bz = b.z; } }
      const dx = bx - P.titan.x, dz = bz - P.titan.z, m = Math.hypot(dx, dz) || 1;
      let card = 0;
      if (P.rail.open && P.upgrades.offer && w.t - P.rail.openedT > 1.5 && picked.get(session.room.id) !== P.rail.seq) { picked.set(session.room.id, P.rail.seq); card = 1; }
      session.setInput({ mx: dx / m, mz: dz / m, ability: Math.floor(performance.now() / 700) % 5 === 0, abilityHeld: false, dash: false }, card);
    }, 50);
  }

  async function finish(): Promise<void> {
    window.clearInterval(inputTimer);
    // the report: the PortalClient files MY seat's result (the winner is named by account id, learnt over the room channel)
    try {
      book.announce();
      const w = session.world, p = session.peer, start = session.start;
      if (w && p && start) {
        const seat = p.mySeat();
        const humans = start.seats.filter((s) => s.kind === 'human').length;
        const mine = p.standings ? p.standings.hash : 0;
        const others = [...p.results.values()].map((r) => r.hash);
        H.majority = { mine, others, ok: resultsMajority(mine, others) };
        const out = portal.vsMatchEnded({
          w, slot: seat, matchId: start.matchId, humans, skip: !resultsMajority(mine, others),
          uidBySlot: book.uidsBySlot(p.roster().map((r) => ({ slot: r.slot, peer: r.peer }))), tally,
        });
        H.report = out ? { goals: out.goals, payload: out.payload, facts: out.facts, filing: await out.filing } : null;
        H.portalState = portal.state;
        H.ledger = portal.vsLedger;
      }
    } catch (e) { H.reportError = String((e as Error)?.stack ?? e); }
    H.phase = 'done';
    H.doneAtMs = performance.now();
  }

  H.snap = (): Record<string, unknown> => {
    const p = session.peer;
    return {
      phase: H.phase, status: H.status ?? null, seat: H.seat ?? null, host: H.host ?? null, error: H.error, matchId: H.matchId ?? null,
      simTick: p ? p.simTick : -1, confirmed: p ? p.confirmed : -1, finished: p ? !!p.finished : false, state: p ? p.state : null,
      authority: p ? p.authority : null, isAuthority: p ? p.isAuthority : false, epoch: p ? p.epoch : -1,
      rttMs: p ? Math.round(p.stats.rttMs) : -1, lateSeen: p ? p.stats.lateSeen : 0, mismatches: p ? p.stats.mismatches : 0, migrations: p ? p.stats.migrations : 0,
      afkOn: p ? p.stats.afkOn : 0, checkpoints: p ? p.stats.checkpoints : 0, portal: portal.state, id: H.id,
    };
  };
  H.hashes = (): [number, number, number][] => {
    const p = session.peer;
    const out: [number, number, number][] = [];
    if (p) for (const [k, v] of p.hashLog) out.push([k, v[0], v[1]]);
    out.sort((a, b) => a[0] - b[0]);
    return out;
  };
  H.roster = (): unknown => session.peer ? session.peer.roster() : null;
  H.mesh = (): unknown => session.mesh ? { open: session.mesh.openPeers(), sent: session.mesh.sent, recv: session.mesh.recv, forwarded: session.mesh.forwarded } : null;

  H.phase = 'matching';
  ev(`mode ${MODE} build ${BUILD} short ${SHORT} id ${session.room.id}`);
  let ok = false;
  if (MODE === 'host') {
    const p = session.hostCode(CODE);
    if (START_NOW_MS > 0) setTimeout(() => session.startNow(), START_NOW_MS);
    ok = await p;
  } else if (MODE === 'join') ok = await session.joinCode(CODE);
  else ok = await session.quickMatch(WAIT);
  ev(`match resolved ${ok}`);
  if (!ok && H.phase !== 'started') { H.phase = 'nomatch'; }
}

main().catch((e) => { H.error = String((e as Error)?.stack ?? e); H.phase = 'error'; });

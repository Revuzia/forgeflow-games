// BLOCKTOOTH - _harness/net/rtc4_entry.ts (lane B-NET). Browser end-to-end of the online stack in ONE page:
// 4 OnlineSessions (src/net/session.ts) quick-match through the in-memory Realtime fake (fake_realtime.ts stands in for
// Supabase), open a REAL WebRTC mesh (RTCPeerConnection + DataChannels, host candidates, no STUN), and play a lockstep
// match on the real sim (soloWorldPort + the harness bot) paced by the REAL Worker clock. At 25 s the host is killed
// abruptly (clock stopped + every link closed, no goodbye): the survivors must elect p1, keep equal hashes, finish and
// agree on the standings. Results -> window.__RTC4__ and POST /__report/rtc4. Driven by _harness/net/rtc4.py.

import type { World } from '../../src/core/types.ts';
import { NET_PROTO, SEATS, TICK_MS, type StartInfo } from '../../src/net/proto.ts';
import { OnlineSession, type SessionEvent } from '../../src/net/session.ts';
import { soloWorldPort } from '../../src/net/simport.ts';
import { botInput, botPickUpgrade } from '../bot.ts';
import { FakeHub } from './fake_realtime.ts';

const qs = new URLSearchParams(location.search);
const SECONDS = Number(qs.get('s') ?? '45');
const KILL_AT_S = Number(qs.get('kill') ?? '25');
/** join=1: only 3 sessions quick-match (bot fills seat 3); the 4th joins the RUNNING match by room code at JOIN_AT_S
 *  (replay join through the session layer: presence -> running START offer -> mesh hello -> lockstep join) */
const JOIN = qs.get('join') === '1';
const JOIN_AT_S = Number(qs.get('joinAt') ?? '10');
/** nolink=1: the host (lowest id) and the highest-id guest never connect directly (signalling dropped both ways):
 *  that guest must reach the authority through a relay peer (rtcmesh FWD + LINKS gossip, D11 $0 NAT fallback) */
const NOLINK = qs.get('nolink') === '1';
const blocked = { a: '', b: '' };
const out: Record<string, unknown> = { done: false, log: [] as string[] };
(window as unknown as { __RTC4__: unknown }).__RTC4__ = out;
const log = (m: string): void => { (out.log as string[]).push(`${(performance.now() / 1000).toFixed(2)} ${m}`); console.log(m); };

async function main(): Promise<void> {
  const hub = new FakeHub({ seed: 7, presenceDelay: [80, 600] });
  const sim = soloWorldPort({ bot: { input: botInput, pick: botPickUpgrade } });
  const endTick = Math.round(SECONDS * 30);
  let n = 0;
  const makeStart = (humans: string[]): StartInfo => ({
    proto: NET_PROTO, build: 'rtc4', matchId: `rtc4-${++n}`, seed: 1337, biome: 'grideast', mode: 'coop1', endTick, lead: 3,
    seats: Array.from({ length: SEATS }, (_, s) => ({ slot: s, kind: s < humans.length ? 'human' as const : 'bot' as const,
      peer: s < humans.length ? humans[s] : null, name: humans[s] ?? `BOT ${s}`, titan: 'molo' })),
  });
  const sessions: OnlineSession<World>[] = [];
  const events: Record<string, string[]> = {};
  const results: Record<string, { hash: number; agreed: boolean; endTick: number }> = {};
  const startedAt: Record<string, number> = {}, finishedAt: Record<string, number> = {};
  for (let i = 0; i < 4; i++) {
    const tag = `s${i}`;
    events[tag] = [];
    const s: OnlineSession<World> = new OnlineSession<World>({
      build: 'rtc4', name: tag, sim, makeStart, client: hub.client(), iceServers: [], connectMs: 8000,
      signalFilter: NOLINK ? (to: string) => !((s.room.id === blocked.a && to === blocked.b) || (s.room.id === blocked.b && to === blocked.a)) : undefined,
      onEvent: (e: SessionEvent) => {
        if (e.type === 'status') return;
        const line = e.type === 'net' ? `net ${e.ev.type} ${JSON.stringify(e.ev).slice(0, 140)}` : `${e.type} ${JSON.stringify(e).slice(0, 160)}`;
        if (!(e.type === 'net' && (e.ev.type === 'roster' || e.ev.type === 'late'))) events[tag].push(line);
        if (e.type === 'result') results[s.room.id] = { hash: e.standings.hash, agreed: e.agreed, endTick: e.standings.endTick };
        if (e.type === 'started') startedAt[s.room.id] = performance.now();
        if (e.type === 'net' && e.ev.type === 'result') finishedAt[s.room.id] = performance.now();
      },
    });
    sessions.push(s);
  }
  if (NOLINK) { const ids = sessions.map((x) => x.room.id).sort(); blocked.a = ids[0]; blocked.b = ids[ids.length - 1]; log(`blocking the direct link ${blocked.a} <-> ${blocked.b}`); }
  // the lowest id hosts
  const t0 = performance.now();
  const first = JOIN ? sessions.slice(0, 3) : sessions;
  const oks = await Promise.all(first.map((s, i) => new Promise<boolean>((r) => setTimeout(() => { void s.quickMatch(3000).then(r); }, i * 120))));
  let joinOk: Promise<boolean> | null = null;
  if (JOIN) {
    const code = first[0].room.room as string;
    setTimeout(() => { log(`s3 joins room ${code} by code`); joinOk = sessions[3].joinCode(code); void joinOk.then((ok) => log(`s3 joinCode -> ${ok}`)); }, JOIN_AT_S * 1000);
  }
  log(`quick match resolved ${oks.join(',')} in ${((performance.now() - t0) / 1000).toFixed(1)} s; ids ${sessions.map((s) => s.room.id).join(' ')}`);
  out.ids = sessions.map((s) => s.room.id);
  out.matchIds = first.map((s) => s.start?.matchId ?? null);
  // inputs: each human wanders (harness only); the sim sees the quantised word through setInput
  const inputTimer = setInterval(() => {
    for (const s of sessions) {
      const w = s.world;
      if (!w) continue;
      const k = Math.floor(performance.now() / 2000) + s.room.id.length;
      const a = (k * 2.399) % (Math.PI * 2);
      s.setInput({ mx: Math.cos(a), mz: Math.sin(a), ability: false, abilityHeld: false, dash: false });
    }
  }, 50);
  // the host (lowest id) dies at KILL_AT_S
  const hostIdx = first.findIndex((s) => s.peer?.isAuthority);
  out.hostIdx = hostIdx;
  let killedAtTick = -1;
  const killer = setInterval(() => {
    const h = sessions[hostIdx];
    if (killedAtTick < 0 && h.peer && h.peer.confirmed >= KILL_AT_S * 30) {
      killedAtTick = h.peer.confirmed;
      h.clock.stop();
      h.mesh?.close();
      log(`host ${h.room.id} killed at tick ${killedAtTick}`);
    }
  }, 20);
  const deadline = performance.now() + (SECONDS + 25) * 1000;
  await new Promise<void>((done) => {
    const iv = setInterval(() => {
      const live = sessions.filter((_, i) => i !== hostIdx);
      if (live.every((s) => s.peer?.finished) && Object.keys(results).length >= live.length) { clearInterval(iv); done(); }
      if (performance.now() > deadline) { clearInterval(iv); log('deadline'); done(); }
    }, 200);
  });
  clearInterval(inputTimer); clearInterval(killer);
  // hash comparison across every peer (the killed host's pre-death checkpoints included)
  const ticks = new Set<number>();
  for (const s of sessions) for (const k of s.peer?.hashLog.keys() ?? []) ticks.add(k);
  let compared = 0, bad = 0;
  for (const k of ticks) {
    const vals = new Set<string>();
    let c = 0;
    for (const s of sessions) { const h = s.peer?.hashLog.get(k); if (h) { vals.add(h.join(':')); c++; } }
    if (c >= 2) { compared++; if (vals.size > 1) bad++; }
  }
  const peers = sessions.map((s) => {
    const p = s.peer;
    return p ? { id: s.room.id, auth: p.isAuthority, authority: p.authority, epoch: p.epoch, state: p.state, simTick: p.simTick, confirmed: p.confirmed, lead: p.lead,
      clock: s.clock.kind, clockTicks: s.clock.ticks, rttMs: Math.round(p.stats.rttMs), lateSeen: p.stats.lateSeen, lateRepeats: p.stats.lateRepeats,
      migrations: p.stats.migrations, mismatches: p.stats.mismatches, checkpoints: p.stats.checkpoints, maxAdvanceGapMs: Math.round(p.stats.maxAdvanceGapMs),
      meshOpen: s.mesh?.openPeers().length, meshSent: s.mesh?.sent, forwarded: s.mesh?.forwarded, meshRecv: s.mesh?.recv, signals: s.mesh?.signals, stepMsAvg: p.stats.steps ? +(p.stats.stepMsTotal / p.stats.steps).toFixed(3) : 0 } : { id: s.room.id, peer: null };
  });
  const st = sessions[1].mesh ? await sessions[1].mesh.stats() : {};
  const survivors = sessions.filter((_, i) => i !== hostIdx);
  const survivorIds = survivors.map((s) => s.room.id);
  const resHashes = survivorIds.map((id) => results[id]?.hash);
  Object.assign(out, {
    seconds: SECONDS, endTick, killedAtTick, compared, bad, peers, events, results, candStats: st,
    hubBilled: hub.billed, hubPeak60: hub.peakRolling60(),
    pass: {
      allMatched: oks.every(Boolean) && new Set(out.matchIds as string[]).size === 1,
      hashesEqual: compared > 20 && bad === 0,
      migrated: survivors.every((s) => s.peer?.authority === survivorIds.slice().sort()[0]) && killedAtTick > 0,
      finished: survivors.every((s) => s.peer?.finished && s.peer.simTick === endTick),
      ...(NOLINK ? { relayed: sessions.some((x) => (x.mesh?.forwarded ?? 0) > 50) && !sessions.find((x) => x.room.id === blocked.b)?.mesh?.isOpen(blocked.a) } : {}),
      ...(JOIN ? { joined: !!sessions[3].peer && events.s3.some((l) => l.startsWith('net joined')) && sessions[3].peer.mySeat() === 3 } : {}),
      standingsAgree: resHashes.every((h) => h !== undefined && h === resHashes[0]) && survivorIds.every((id) => results[id]?.agreed),
      workerClock: sessions.every((s) => s.clock.kind !== 'interval'),
      // game speed incl. the migration pause: endTick x 33.3 ms / (finish - match start), per survivor
      speeds: survivorIds.map((id) => +((endTick * TICK_MS) / Math.max(1, (finishedAt[id] ?? 0) - Math.min(...Object.values(startedAt)))).toFixed(4)),
    },
    done: true,
  });
  try { await fetch('/__report/rtc4', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) }); } catch { /* report only */ }
}

main().catch((e) => { out.error = String((e as Error)?.stack ?? e); out.done = true; });

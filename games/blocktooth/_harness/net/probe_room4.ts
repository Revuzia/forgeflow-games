// BLOCKTOOTH - _harness/net/probe_room4.ts (lane B-NET). Headless check of src/net/room.ts against the in-memory
// Realtime fake (fake_realtime.ts: per-subscriber DELAYED presence views 100-1,500 ms, broadcast 30-150 ms, free-plan
// billing). Real timers; ~15-25 s.
//
//   Q) QUICK MATCH: 6 same-version seekers arrive over 0.8 s + 1 seeker on another build. Expect exactly 2 STARTs:
//      one with 4 humans (full, starts at once) and one with 2 humans + 2 bots (after the wait); every compatible
//      seeker in exactly one roster; each START's host = the lowest id of its roster; every roster member resolved
//      with the same matchId; the other-build seeker in no roster.
//   C) ROOM CODE: a host + 2 friends by code, host presses "start now" -> all 3 hold the same START (1 bot seat);
//      a 4th player joining the code after START never triggers a 2nd START (no double host).
//   V) VERSION: a friend on another build joining the code is told `version` and gets no START.
//   B) BUDGET: total billed events; the worst 60-s rolling average must stay under the 100/s project cap (busiest second reported).
//   U) ?room=CODE parsing.
// Exit 0 = PASS, 1 = FAIL.

import { Room, type StartResult } from '../../src/net/room.ts';
import { NET_PROTO, SEATS, type StartInfo } from '../../src/net/proto.ts';
import { FakeHub } from './fake_realtime.ts';

const hub = new FakeHub({ seed: 4242 });
const checks: { id: string; ok: boolean; detail: string }[] = [];
const add = (id: string, ok: boolean, detail: string): void => { checks.push({ id, ok, detail }); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${id}: ${detail}`); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let matchN = 0;

function makeStart(build: string) {
  return (humans: string[]): StartInfo => ({
    proto: NET_PROTO, build, matchId: `m${++matchN}-${humans[0]}`, seed: 1337 + matchN, biome: 'grideast', mode: 'vs', endTick: 19350, lead: 4,
    seats: Array.from({ length: SEATS }, (_, s) => ({ slot: s, kind: s < humans.length ? 'human' as const : 'bot' as const,
      peer: s < humans.length ? humans[s] : null, name: s < humans.length ? humans[s] : `BOT ${s}`, titan: 'molo' })),
  });
}

async function quick(): Promise<void> {
  console.log('Q) quick match: 6 seekers on build A + 1 on build B, wait 4 s');
  const ids = ['a01', 'a02', 'a03', 'a04', 'a05', 'a06'];
  const rooms = ids.map((id) => new Room({ build: 'A', id, client: hub.client() }));
  const odd = new Room({ build: 'B', id: 'a00', client: hub.client() });
  const res = new Map<string, StartResult | null>();
  const order = [3, 0, 5, 1, 4, 2];
  const ps: Promise<void>[] = [];
  order.forEach((i, k) => ps.push(sleep(k * 160).then(() => rooms[i].quickMatch({ makeStart: makeStart('A'), waitMs: 4000, timeoutMs: 15000 })).then((r) => { res.set(ids[i], r); })));
  ps.push(sleep(300).then(() => odd.quickMatch({ makeStart: makeStart('B'), waitMs: 4000, timeoutMs: 9000 })).then((r) => { res.set('a00', r); }));
  await Promise.all(ps);
  const starts = new Map<string, { start: StartInfo; members: string[]; hosts: string[] }>();
  for (const id of ids) {
    const r = res.get(id);
    if (!r) continue;
    const e = starts.get(r.start.matchId) ?? { start: r.start, members: [], hosts: [] };
    e.members.push(id); if (r.host) e.hosts.push(id);
    starts.set(r.start.matchId, e);
  }
  const list = [...starts.values()];
  const humanCounts = list.map((e) => e.start.seats.filter((s) => s.kind === 'human').length).sort();
  add('Q.two_starts_4_and_2', list.length === 2 && humanCounts.join(',') === '2,4', `${list.length} STARTs, humans per START ${humanCounts.join('/')}: ${list.map((e) => e.start.matchId + '[' + e.start.seats.map((s) => s.peer ?? 'bot').join(',') + ']').join(' ')}`);
  const inRoster = ids.map((id) => list.filter((e) => e.start.seats.some((s) => s.peer === id)).length);
  add('Q.every_seeker_once', inRoster.every((n) => n === 1) && ids.every((id) => !!res.get(id)), `roster count per seeker ${inRoster.join('/')}; resolved ${ids.map((id) => (res.get(id) ? 1 : 0)).join('')}`);
  add('Q.lowest_id_hosts', list.every((e) => e.hosts.length === 1 && e.hosts[0] === e.start.seats[0].peer && e.start.seats.filter((s) => s.peer).every((s) => (s.peer as string) >= e.hosts[0])),
    list.map((e) => `${e.start.matchId}: host ${e.hosts.join('+')}`).join('; '));
  add('Q.members_agree', list.every((e) => e.members.length === e.start.seats.filter((s) => s.kind === 'human').length), list.map((e) => `${e.start.matchId}: ${e.members.length} resolved`).join('; '));
  const oddR = res.get('a00');
  add('Q.version_gated', !list.some((e) => e.start.seats.some((s) => s.peer === 'a00')) && (!oddR || oddR.start.seats.every((s) => s.peer === 'a00' || s.kind === 'bot')),
    `build-B seeker: ${oddR ? 'started alone with bots (' + oddR.start.matchId + ')' : 'no match'}; in a build-A roster: no`);
  for (const r of [...rooms, odd]) r.leave();
}

async function code(): Promise<void> {
  console.log('C) room code: host + 2 friends, start now; a late 4th joiner; V) a friend on another build');
  const code = 'BTQA';
  const host = new Room({ build: 'A', id: 'c01', client: hub.client() });
  const f1 = new Room({ build: 'A', id: 'c02', client: hub.client() });
  const f2 = new Room({ build: 'A', id: 'c03', client: hub.client() });
  const vx = new Room({ build: 'B', id: 'c04', client: hub.client() });
  const ph = host.hostCode(code, { makeStart: makeStart('A') });
  await sleep(200);
  const p1 = f1.joinCode(code), p2 = f2.joinCode(code);
  let vRes: StartResult | null | 'pending' = 'pending';
  const statuses: string[] = [];
  void vx.joinCode(code, { onStatus: (s) => statuses.push(s.phase) }).then((r) => { vRes = r; });
  await sleep(2500);
  add('C.no_start_before_button', !host.started, `host started before "start now": ${!!host.started}; host sees humans ${host.humans().join(',')} strangers ${host.strangers().join(',')}`);
  host.startNow();
  const [rh, r1, r2] = await Promise.all([ph, p1, p2]);
  const ok = !!rh && !!r1 && !!r2 && rh.start.matchId === r1.start.matchId && r1.start.matchId === r2.start.matchId && rh.host && !r1.host && !r2.host;
  add('C.code_start_shared', ok && rh?.start.seats.filter((s) => s.kind === 'bot').length === 1, `matchIds ${rh?.start.matchId}/${r1?.start.matchId}/${r2?.start.matchId}; seats ${rh?.start.seats.map((s) => s.peer ?? 'bot').join(',')}`);
  await sleep(500);
  add('V.version_told', vRes === null && statuses.includes('version'), `other-build friend: result ${vRes === 'pending' ? 'pending' : vRes ? 'STARTED' : 'null'}, statuses ${[...new Set(statuses)].join(',')}`);
  // a late joiner (lowest id would make it 'host' if it ignored the running match)
  const late = new Room({ build: 'A', id: 'c00', client: hub.client() });
  let lateRes: StartResult | null | 'pending' = 'pending';
  void late.joinRoom(code).then(() => late.waitForStart({ makeStart: makeStart('A'), waitMs: 1000 })).then((r) => { lateRes = r; });
  await sleep(3500);
  add('C.late_joiner_never_hosts', lateRes === 'pending' && !late.started && late.matchRunningHere(), `late joiner (lowest id c00) after START: ${lateRes === 'pending' ? 'still waiting for a replay-join offer' : 'resolved ' + JSON.stringify(lateRes)}; sees running match: ${late.matchRunningHere()}`);
  for (const r of [host, f1, f2, vx, late]) r.leave();
}

async function main(): Promise<void> {
  const t0 = Date.now();
  await quick();
  await code();
  add('U.room_param', Room.codeFromUrl('?foo=1&room=bt-qa') === 'BTQA' && Room.codeFromUrl('?room=ab') === null && Room.cleanCode(' xy z9 ') === 'XYZ9',
    `codeFromUrl('?foo=1&room=bt-qa')=${Room.codeFromUrl('?foo=1&room=bt-qa')}, '?room=ab'->${Room.codeFromUrl('?room=ab')}`);
  add('B.budget', hub.peakRolling60() < 100, `billed events (presence syncs + broadcasts, every room of this probe at once): total ${hub.billed} (${hub.sends} broadcasts); worst 60-s rolling average ${hub.peakRolling60().toFixed(1)}/s vs the free plan's 100/s project cap; busiest single second ${hub.peakPerSecond()}`);
  const ok = checks.every((c) => c.ok);
  console.log(`\nprobe_room4: ${ok ? 'PASS' : 'FAIL'} - ${checks.length} checks, ${((Date.now() - t0) / 1000).toFixed(1)} s${ok ? '' : '; failing: ' + checks.filter((c) => !c.ok).map((c) => c.id).join(', ')}`);
  process.exit(ok ? 0 : 1);
}

void main();

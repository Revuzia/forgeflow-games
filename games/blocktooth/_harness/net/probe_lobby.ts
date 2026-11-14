// BLOCKTOOTH ONLINE VS — lobby / controller pure-logic probe (lane O-LOBBY). Node, no browser, no network.
//
//   node _harness/net/probe_lobby.ts
//
// Covers the parts of src/online.ts that are plain functions: room-code derivation for REMATCH rooms, name cleaning, the invite
// link, the START -> VsMatchInfo description (seat names, bot call-signs, seat colours, who is local), the VS HUD safe rectangle
// (CRIT: nameplates / arrows clamp to it) and the takeover damage ramp (CRIT). The browser flows (menu, lobby, notices, rematch)
// are driven by _harness/scratch/partb/O-LOBBY/ond.py against a real Chrome + real Supabase.

import { VS } from '../../src/core/config.ts';
import { SEATS, NET_PROTO } from '../../src/net/proto.ts';
import { vsStartInfo } from '../../src/net/simport.ts';
import { phaseMul, TAKEOVER_RAMP_S } from '../../src/vs/clock.ts';
import { safeRect } from '../../src/ui/vstypes.ts';
import { OnlineMatch, asTitan, buildInfo, cleanName, rematchCode, type LobbyState, type OnlineHooks, type OnlineMode } from '../../src/online.ts';
import type { RoomStatus } from '../../src/net/room.ts';
import { vsGoalLines } from '../../src/ui/vstypes.ts';
import { VS as STR_VS, RIVAL_HANDLES, rivalHandles, vsFmt } from '../../src/data/strings_vs.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, detail = ''): void {
  if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// ── rematch codes ──
ok(rematchCode('ABCD') === 'ABCDR1', 'rematch code of a 4-letter room', rematchCode('ABCD'));
ok(rematchCode('ABCDR1') === 'ABCDR2', 'rematch of a rematch increments', rematchCode('ABCDR1'));
ok(rematchCode(rematchCode(rematchCode('WXYZ'))) === 'WXYZR3', 'three rematches', rematchCode(rematchCode(rematchCode('WXYZ'))));
ok(rematchCode('QJ1Y9QUOI') === 'QJ1Y9QUOIR1' && rematchCode('QJ1Y9QUOI').length <= 12, 'a quick-match room code stays within 12 characters');
ok(rematchCode('QJ1Y9QUOIR9').length <= 12 && rematchCode('QJ1Y9QUOIR9').endsWith('R10'), 'R9 -> R10 still fits', rematchCode('QJ1Y9QUOIR9'));
ok(/^[A-Z0-9]{4,12}$/.test(rematchCode('KXQF')), 'a rematch code is a valid room code');
// every peer derives the same code from the same old code
ok(rematchCode('KXQF') === rematchCode('KXQF'), 'deterministic');

// ── names / titans ──
ok(cleanName('  alice  ') === 'ALICE', 'cleanName trims + upper-cases');
ok(cleanName('Bob<script>') === 'BOBSCRIPT', 'cleanName strips markup characters', cleanName('Bob<script>'));
ok(cleanName('A'.repeat(40)).length === 14, 'cleanName caps at 14');
ok(cleanName(null) === '' && cleanName(undefined) === '', 'cleanName of nothing');
ok(asTitan('molo') === 'molo' && asTitan('voltkite') === 'voltkite' && asTitan('godzilla') === null && asTitan(7) === null, 'asTitan validates');

// ── START -> match info ──
const start = vsStartInfo({
  proto: NET_PROTO, build: 'probe', matchId: 'probe-1', seed: 1337, biome: 'grideast',
  seats: [
    { kind: 'human', peer: 'p0', name: 'ALICE', titan: 'molo' },
    { kind: 'human', peer: 'p1', name: 'GUEST-4F9K', titan: 'voltkite' },
    { kind: 'bot', peer: null, name: '', titan: 'hearthback', botLevel: 1 },
    { kind: 'bot', peer: null, name: '', titan: 'briarwick', botLevel: 2 },
  ],
});
const infoA = buildInfo(start, 0), infoB = buildInfo(start, 1);
ok(infoA.seats.length === SEATS && infoA.local === 0 && infoB.local === 1, 'info: 4 seats, local seat');
ok(infoA.seats[0].name === 'YOU' && infoA.seats[1].name === 'GUEST-4F9K' && infoB.seats[0].name === 'ALICE' && infoB.seats[1].name === 'YOU', 'info: the local seat reads YOU, rivals their own names');
ok(!infoA.seats[0].bot && !infoA.seats[1].bot && infoA.seats[2].bot && infoA.seats[3].bot, 'info: bot flags');
ok(infoA.seats[2].level === 'regular' && infoA.seats[3].level === 'veteran' && infoA.seats[0].level === null, 'info: bot levels from SeatInfo.botLevel');
// (replaced 'bots get a UNIT n + call-sign' / 'the same bot call-signs on every peer': a driven seat now reads as a player)
ok(RIVAL_HANDLES.includes(infoA.seats[2].name) && RIVAL_HANDLES.includes(infoA.seats[3].name) && infoA.seats[2].sign === '' && !/UNIT/.test(infoA.seats[2].name), 'info: driven seats get an ordinary player handle, no UNIT n / call-sign', infoA.seats[2].name + ' / ' + infoA.seats[3].name);
ok(infoA.seats[2].name === infoB.seats[2].name && infoA.seats[3].name === infoB.seats[3].name, 'info: the same seat names on every peer');
ok(new Set(infoA.seats.map((s) => s.name === 'YOU' ? 'ALICE' : s.name)).size === 4 && new Set(infoB.seats.map((s) => s.name === 'YOU' ? 'GUEST-4F9K' : s.name)).size === 4, 'info: seat names are unique within a match');
// the handle pool: >= 60, ASCII upper-case, <= 14 characters (cleanName-stable), no 'BOT' anywhere, deterministic, unique per match, never a human's name
{
  ok(RIVAL_HANDLES.length >= 60 && new Set(RIVAL_HANDLES).size === RIVAL_HANDLES.length, 'handles: >= 60 distinct names', String(RIVAL_HANDLES.length));
  ok(RIVAL_HANDLES.every((h) => /^[A-Z0-9_]{3,14}$/.test(h) && !/BOT/.test(h)), 'handles: A-Z 0-9 _ only, 3..14 chars, never the word BOT');
  let uniq = true, det = true, avoidOk = true;
  for (let seed = 0; seed < 4000; seed++) {
    const a = rivalHandles(seed, [1, 2, 3]), b = rivalHandles(seed, [1, 2, 3]);
    if (new Set([a[1], a[2], a[3]]).size !== 3) uniq = false;
    if (a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3]) det = false;
    const c = rivalHandles(seed, [2, 3], [a[2], 'GUEST-4F9K']);
    if (c[2] === a[2] || c[3] === a[2] || c[2] === c[3]) avoidOk = false;
  }
  ok(uniq && det, 'handles: 4000 seeds -> three distinct names, same names on every call');
  ok(avoidOk, 'handles: a human seat name is never handed to a driven seat');
  const seen = new Set<string>();
  for (let seed = 0; seed < 4000; seed++) { const a = rivalHandles(seed, [1, 2, 3]); seen.add(a[1]); seen.add(a[2]); seen.add(a[3]); }
  ok(seen.size >= 50, 'handles: the pool is well spread over seeds', String(seen.size));
}
ok(new Set(infoA.seats.map((s) => s.color)).size === 4 && infoA.seats[0].color === VS.seatColors[0], 'info: 4 distinct seat colours');
ok(infoA.biome === 'grideast' && infoA.seed === 1337, 'info: city + seed come from START');
ok(start.endTick >= Math.round((VS.countdownS + VS.phase.hardEndS) * 30), 'START endTick covers the whole match', String(start.endTick));
ok(start.mode === 'vs' && start.seats.length === 4, 'START is a 4-seat VS match');

// ── the HUD safe rectangle ──
{
  const u = 12.8, W = 1280, H = 720;
  const R = safeRect(W, H, u);
  ok(R.l >= 24.5 * u - 1e-9 && R.r <= W - 26 * u + 1e-9 && R.t >= 12 * u - 1e-9 && R.b <= H - 16 * u + 1e-9, 'safe rect clears the seat column / feed + minimap / phase strip / bottom panels');
  ok(R.r - R.l > 30 * u && R.b - R.t > 15 * u, 'safe rect is large enough to be useful at 1280x720', JSON.stringify(R));
  const small = safeRect(640, 360, 8);
  ok(small.r > small.l && small.b > small.t, 'safe rect never inverts on a tiny window');
}

// ── the takeover damage ramp ──
{
  const P = VS.phase;
  ok(phaseMul('takeover', P.openEndS) === 0, 'takeover ramp starts at 0');
  ok(Math.abs(phaseMul('takeover', P.openEndS + TAKEOVER_RAMP_S / 2) - 0.5) < 1e-12, 'takeover ramp is linear');
  ok(phaseMul('takeover', P.openEndS + TAKEOVER_RAMP_S) === 1 && phaseMul('takeover', P.openEndS + 100) === 1, 'takeover ramp reaches 1 and stays');
  ok(phaseMul('open', 100) === 0 && phaseMul('last', 620) === 1, 'the other phases are untouched');
}


// ── the lobby view-model (O-POLISH): who is "host", what a JOIN that has not found a host shows, leavers, the quick-match deadline ──
// OnlineMatch.pushLobby() is driven here with a FAKE room (presence + humans) and hand-written RoomStatus values: no network, no timers.
interface Fake { id: string; room: string; humans(): string[]; presence(): Record<string, Record<string, unknown>>; strangers(): string[] }
interface Priv { session: { room: Fake; publish(x: Record<string, unknown>): void }; lastStatus: RoomStatus | null; tLook: number; pushLobby(): void; publishDeadline(s: RoomStatus): void }
function lobbyRig(mode: OnlineMode, me: string): { m: OnlineMatch; p: Priv; last: () => LobbyState; pub: Record<string, unknown>[]; set: (humans: string[], meta: Record<string, Record<string, unknown>>, host: boolean, waitLeftMs?: number) => void } {
  const states: LobbyState[] = [];
  const hooks = { lobby: (s: LobbyState) => states.push(s), notice() {}, connection() {}, infoChanged() {}, rebuilt() {}, ended() {}, failed() {}, started() {}, tick() {}, load: async () => {} } as unknown as OnlineHooks;
  const m = new OnlineMatch({ mode, code: mode === 'quick' ? null : 'ABCD', titan: 'molo', biome: 'grideast', name: 'ME', build: 'probe' }, hooks);
  const pub: Record<string, unknown>[] = [];
  const room: Fake = { id: me, room: 'ABCD', humans: () => [], presence: () => ({}), strangers: () => [] };
  const p = m as unknown as Priv;
  p.session = { room, publish: (x) => { pub.push(x); } };
  const set = (humans: string[], meta: Record<string, Record<string, unknown>>, host: boolean, waitLeftMs = 0): void => {
    room.humans = () => humans.slice();
    room.presence = () => { const o: Record<string, Record<string, unknown>> = {}; for (const h of humans) o[h] = { id: h, ...(meta[h] ?? {}) }; return o; };
    p.lastStatus = { phase: 'waiting', room: 'ABCD', host, humans: humans.slice(), waitLeftMs };
    p.pushLobby();
  };
  return { m, p, last: () => states[states.length - 1], pub, set };
}
const META: Record<string, Record<string, unknown>> = { a: { name: 'ALICE', titan: 'voltkite', biome: 'whitestacks' }, b: { name: 'ME', titan: 'molo', biome: 'grideast' } };
{
  // L1: JOIN WITH CODE, nothing in the room: the channel's lowest id is the joiner itself ("host" to the room layer) - NO host UI
  const R = lobbyRig('join', 'b');
  R.set(['b'], META, true);
  let s = R.last();
  ok(s.phase === 'looking', 'L1: a joiner alone first LOOKS for the room', s.phase);
  ok(!s.host && !s.canStartNow && !s.seats[0].host, 'L1: no host UI (no HOST chip, no START) while no host has been seen', JSON.stringify([s.host, s.canStartNow, s.seats[0].host]));
  ok(s.city === null, 'L1: no city until a host is seen');
  R.p.tLook = performance.now() - 9000;
  R.set(['b'], META, true);
  s = R.last();
  ok(s.phase === 'noroom' && !s.host && !s.canStartNow, 'L1: after ~8 s: ROOM NOT FOUND (still no host UI)', s.phase);
  // the host arrives later: the lobby becomes the normal guest lobby (it kept listening)
  R.set(['a', 'b'], META, false);
  s = R.last();
  ok(s.phase === 'waiting' && !s.host && s.seats[0].host && s.seats[0].id === 'a', 'L1: when the host shows up the guest lobby opens at once', s.phase);
  ok(s.city === 'whitestacks', 'F4: the host\'s city is read from its presence', String(s.city));

  // L2: the host leaves: the promoted guest keeps the host phase + START, never "room not found", and its old seat says "ALICE LEFT"
  R.p.tLook = performance.now() - 60000;               // (an old look timer must not matter once a host was seen)
  R.set(['b'], META, true);
  s = R.last();
  ok(s.phase === 'waiting' && s.host && s.canStartNow, 'L2: the promoted host stays in the host phase with START NOW', JSON.stringify([s.phase, s.host, s.canStartNow]));
  ok(s.hostLeft, 'L2: the lobby knows the host left (it says so)');
  ok(s.seats[0].host && s.seats[0].me && s.seats[1].open && s.seats[1].left === 'ALICE', 'L2: the departed host\'s seat is an OPEN seat that remembers who left', JSON.stringify(s.seats[1]));
  R.set(['b'], META, true);
  ok(R.last().phase === 'waiting', 'L2: ...and it never flips to noroom later');
  // a newcomer fills the seat: the label goes away
  R.set(['b', 'c'], { ...META, c: { name: 'CARA', titan: 'hearthback' } }, true);
  s = R.last();
  ok(!s.seats[1].open && s.seats[1].left === null, 'L2: a newcomer takes the open seat');
}
{
  // CREATE: the creator is the host from the start (no looking phase), a guest leaving leaves an "X LEFT" seat
  const R = lobbyRig('create', 'a');
  R.set(['a'], META, true);
  let s = R.last();
  ok(s.phase === 'waiting' && s.host && s.canStartNow && !s.hostLeft, 'create: the host lobby is the normal host phase');
  R.set(['a', 'b'], META, true);
  R.set(['a'], META, true);
  s = R.last();
  ok(s.seats[1].left === 'ME' && s.phase === 'waiting' && !s.hostLeft, 'create: a leaving guest leaves "X LEFT" and nothing else changes');
}
{
  // F1: the guest's countdown reads the HOST's published deadline, never its own clock
  const G = lobbyRig('quick', 'b');
  G.set(['a', 'b'], { a: { name: 'ALICE', titan: 'voltkite', startAt: Date.now() + 7400 }, b: META.b }, false, 20000);
  ok(G.last().waitLeftS === 8, 'F1: the guest shows the host\'s deadline (ceil(7.4) = 8), not its own 20 s clock', String(G.last().waitLeftS));
  G.set(['a', 'b'], { a: { name: 'ALICE', titan: 'voltkite' }, b: META.b }, false, 20000);
  ok(G.last().waitLeftS === null, 'F1: no published deadline -> the guest dial hides');
  G.set(['a', 'b'], { a: { name: 'ALICE', startAt: Date.now() - 5000 }, b: META.b }, false, 20000);
  ok(G.last().waitLeftS === 0, 'F1: a deadline already past clamps to 0');
  G.set(['a', 'b'], { a: { name: 'ALICE', startAt: Date.now() + 999000 }, b: META.b }, false, 20000);
  ok((G.last().waitLeftS ?? 99) <= 20, 'F1: a wild clock skew never shows more than the whole wait');
  const H = lobbyRig('quick', 'a');
  H.set(['a', 'b'], META, true, 12300);
  ok(H.last().waitLeftS === 13, 'F1: the host reads its own clock', String(H.last().waitLeftS));
  // the host publishes its deadline once per room (and again only when it moves by > 1.5 s)
  const st = (waitLeftMs: number): RoomStatus => ({ phase: 'waiting', room: 'QX1', host: true, humans: ['a'], waitLeftMs });
  const t0 = Date.now();
  H.p.publishDeadline(st(12000));
  H.p.publishDeadline(st(11700));
  ok(H.pub.length === 1 && typeof H.pub[0].startAt === 'number' && Math.abs((H.pub[0].startAt as number) - (t0 + 12000)) < 400, 'F1: the host publishes startAt = now + waitLeft, once', JSON.stringify(H.pub));
  H.p.publishDeadline(st(6000));
  ok(H.pub.length === 2, 'F1: ...and again when its clock jumps (a new room / host)');
  H.p.publishDeadline({ ...st(5000), host: false });
  ok(H.pub.length === 2, 'F1: a guest publishes nothing');
}

// ── F2: every notice string lives in strings_vs.ts ──
{
  const N = STR_VS.notice;
  ok(vsFmt(N.dropped, { name: 'ALICE' }) === 'ALICE LEFT THE MATCH', 'F2: the leave notice is a strings_vs line (replaced the old DROPPED OUT ... A BOT IS DRIVING text)');
  ok(vsFmt(N.unreach, { n: 2, who: N.players }).includes('2 PLAYERS') && vsFmt(N.hostLeft, { name: 'BOB' }).startsWith('HOST LEFT'), 'F2: the migration / reachability notices fill from strings_vs');
}

// ── V1: the VS goals the report returns become GOALS MET lines for the end card ──
{
  const L = vsGoalLines(['g_vs_syndicated', 'g_vs_certified_headline', 'g_nope']);
  ok(L.length === 2 && L[0].name === 'SYNDICATED' && L[1].desc.length > 0 && L.every((x) => x.id.startsWith('g_vs_')), 'V1: vsGoalLines resolves the earned ids (an unknown id is dropped)', JSON.stringify(L));
  ok(vsGoalLines([]).length === 0, 'V1: no goals -> no strip');
}

console.log(`probe_lobby: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

// T5: host loss — socket close and 1.5 s stall → `host` promotion by score; `handoff` path; a phone never picked over
// a kbm member; host.lastTick = the tick of the last relayed SNAP; the 4th host loss → the Room's own
// end {voided:true}; a token reconnect during `post` receives the cached `end`.
import * as L from './lib.mjs';

const isBin = (k) => (m) => m.kind === 'bin' && m.b[0] === k && !L.isPulse(m);

/** Sends `n` SNAPs at 20 Hz with ticks start, start+3, ...; returns the last tick. */
async function snaps(c, start, n) {
  let t = start;
  for (let i = 0; i < n; i++) {
    t = start + 3 * i;
    c.sendBin(L.snapFrame(t, 64));
    await L.sleep(50);
  }
  return t;
}

/** Clients keep sending INTENTS at 20 Hz (the stall check runs on their messages). */
function clientPulse(list) {
  let seq = 1;
  const id = setInterval(() => {
    seq++;
    for (const m of list) if (m.c.isOpen) m.c.sendBin(L.intentsFrame(m.welcome.slot, seq));
  }, 50);
  return () => clearInterval(id);
}

export async function run(dev, C) {
  // scores (§O4.4): s0 phone −110 · s1 890 · s2 860 · s3 920
  const profiles = [
    { device: 'touch', simMs: 6, rttMs: 50 },
    { device: 'kbm', simMs: 3, rttMs: 80 },
    { device: 'kbm', simMs: 2, rttMs: 120 },
    { device: 'kbm', simMs: 2, rttMs: 60 },
  ];
  const room = await L.roomWith(dev, 4, { profiles });
  const by = (s) => room.all.find((m) => m.welcome.slot === s);
  const as = await L.startAndAssign(room);
  C.eq(as[0].hostSlot, 3, 'start: host = best score (slot 3); the phone owner (slot 0) is not picked');

  // ---- abrupt: the host socket closes ----
  const s3 = by(3);
  let last = await snaps(s3.c, 3, 20); // live, ticks 3..60
  const k1 = room.all.map((m) => m.c.mark());
  s3.c.close(1000, 'gone'); // not 4000 → disconnected (reconnectable), and the host is lost
  const h1 = await by(1).c.t('host', { from: k1[1] });
  C.eq([h1.j.hostSlot, h1.j.reason, h1.j.lastTick, h1.j.migrations], [1, 'left', last, 1], 'host socket closed → host {slot 1 (next best), left, lastTick = last SNAP tick}');
  const h1b = await by(0).c.t('host', { from: k1[0] });
  C.eq(h1b.j.hostSlot, 1, 'every member got the same host message');

  // ---- stall: the new host sends for 0.5 s then goes silent; clients keep sending ----
  const stopCli = clientPulse([by(0), by(2)]);
  last = await snaps(by(1).c, last + 3, 10);
  const silentAt = performance.now();
  const k2 = room.all.map((m) => m.c.mark());
  const h2 = await by(2).c.t('host', { from: k2[2], timeout: 6000 });
  const det = (h2.at - silentAt) / 1000;
  C.eq([h2.j.hostSlot, h2.j.reason, h2.j.lastTick, h2.j.migrations], [2, 'stalled', last, 2], 'host silent → host {slot 2, stalled, lastTick}');
  C.ok(det >= 1.4 && det <= 2.2, `stall detected ${det.toFixed(2)} s after the host's last frame (HOST_STALL_MS 1.5 s)`);
  // the stalled old host's late SNAP is no longer relayed
  const k2b = by(0).c.mark();
  by(1).c.sendBin(L.snapFrame(99_999, 8));
  await L.sleep(300);
  C.ok(!by(0).c.msgs.slice(k2b).some((m) => isBin(2)(m) && L.tickOf(m.b) === 99_999), 'old (stalled) host SNAP dropped after migration');

  // ---- graceful handoff: SNAP(k) → HANDOFF(k) → {t:handoff} ----
  last = await snaps(by(2).c, last + 3, 6);
  const k3 = room.all.map((m) => m.c.mark());
  by(2).c.sendBin(L.handoffFrame(last, 300));
  by(2).c.send({ t: 'handoff' });
  const hf = await by(0).c.next(isBin(4), { from: k3[0] });
  const h3 = await by(0).c.t('host', { from: k3[0] });
  C.ok(L.tickOf(hf.b) === last && hf.b.length === 306 && hf.at <= h3.at, 'HANDOFF relayed to the others before the host message');
  // candidates: slot 0 (phone, active) and slot 1 (stalled former host, silent) → the active phone, not the stalled one
  C.eq([h3.j.hostSlot, h3.j.reason, h3.j.lastTick, h3.j.migrations], [0, 'handoff', last, 3], 'handoff → host {slot 0, handoff}; a stalled former host is not re-picked');
  stopCli();

  // ---- 4th host loss → the Room voids the match itself ----
  const stopCli2 = clientPulse([by(1), by(2)]);
  last = await snaps(by(0).c, last + 3, 4);
  const k4 = room.all.map((m) => m.c.mark());
  by(0).c.close(1000, 'gone');
  const v = await by(2).c.t('end', { from: k4[2] });
  C.eq([v.j.voided, v.j.matchNo, v.j.from], [true, as[0].matchNo, -1], '4th host loss → Room-originated end {voided:true}');
  stopCli2();
  const dbg = await L.devRoom(dev, room.code);
  C.eq([dbg.st.phase, dbg.st.hostLosses], ['post', 4], 'room in post after the void (4 host losses)');

  // ---- reconnect with a token during post → the cached end right after welcome ----
  const tok2 = by(2).welcome.token;
  by(2).c.close(1000, 'drop');
  await by(2).c.closed;
  const re = await L.joinRoom(dev, room.code, { i: 2, token: tok2, doHello: false });
  const rk = re.c.mark();
  const w = await L.hello(re.c, L.profile(2));
  const cached = await re.c.t('end', { from: rk, timeout: 3000 }).catch(() => null);
  C.ok(w.slot === 2 && cached?.j?.voided === true && cached.at >= re.c.msgs.find((m) => m.j?.t === 'welcome').at, 'token reconnect during post: same slot, cached end after welcome');
  C.ok(!re.c.texts('assign').length, 'no assign sent during post');

  L.closeAll([...room.all, re]);
  await L.sleep(300);

  // ---- a host-sent end is cached and replayed to a reconnecting player (also after a hibernation-style wake) ----
  const r2 = await L.roomWith(dev, 2);
  const a2 = await L.startAndAssign(r2);
  const H = r2.all.find((m) => m.welcome.slot === a2[0].hostSlot);
  const Cl = r2.all.find((m) => m !== H);
  H.c.sendBin(L.snapFrame(3));
  const end = { t: 'end', matchNo: a2[0].matchNo, result: { winner: 1, shares: [0.4, 0.6] }, runners: [{ id: 0, seat: { slot: 0, human: true, liveTicks: 100, painted: 1.5, washes: 2, washedCount: 1 } }], migrations: 0, voided: false };
  const ek = Cl.c.mark();
  H.c.send(end);
  const e1 = await Cl.c.t('end', { from: ek });
  C.ok(e1.j.result.winner === 1 && e1.j.from === H.welcome.slot, 'host end relayed (from = host)');
  Cl.c.close(1000, 'drop at the horn');
  await Cl.c.closed;
  await L.sleep(200);
  const back = await L.joinRoom(dev, r2.code, { i: 1, token: Cl.welcome.token, doHello: false });
  const bk = back.c.mark();
  await L.hello(back.c, L.profile(1));
  const e2 = await back.c.t('end', { from: bk, timeout: 3000 }).catch(() => null);
  C.ok(e2?.raw === e1.raw, 'reconnect during post receives the identical cached end text');
  const d2 = await L.devRoom(dev, r2.code);
  C.ok(d2.endCached > 0 && d2.st.phase === 'post', 'end cached in the Room (and stored with the post write)');
  L.closeAll([...r2.all, back]);
  await L.sleep(300);
}

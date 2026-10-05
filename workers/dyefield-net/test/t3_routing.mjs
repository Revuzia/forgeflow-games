// T3: routing — client→host only, host→all, host→one, spoofed slot byte dropped, non-host SNAP dropped, order kept,
// relayed text gets `from`, non-host host-text dropped.
import * as L from './lib.mjs';

const quiet = (c, from, pred, ms = 350) => L.sleep(ms).then(() => !c.msgs.slice(from).some((m) => !L.isPulse(m) && pred(m)));
const isBin = (k) => (m) => m.kind === 'bin' && m.b[0] === k && !L.isPulse(m);

export async function run(dev, C) {
  const room = await L.roomWith(dev, 3);
  const as = await L.startAndAssign(room);
  const hostSlot = as[0].hostSlot;
  const H = room.all.find((m) => m.welcome.slot === hostSlot);
  const [A, B] = room.all.filter((m) => m !== H);
  const sA = A.welcome.slot;
  const sB = B.welcome.slot;
  const stopPulse = L.pulse(H.c);
  C.ok(as.every((a) => a.hostSlot === hostSlot && a.seed === as[0].seed), 'every member got the same assign');

  // host → all (SNAP), not echoed to the host
  let k = [H.c.mark(), A.c.mark(), B.c.mark()];
  H.c.sendBin(L.snapFrame(3, 100));
  const [sa, sb] = await Promise.all([A.c.next(isBin(2), { from: k[1] }), B.c.next(isBin(2), { from: k[2] })]);
  C.ok(L.tickOf(sa.b) === 3 && L.tickOf(sb.b) === 3 && sa.b.length === 106, 'SNAP host→all: both clients received it intact');
  C.ok(await quiet(H.c, k[0], isBin(2)), 'SNAP not echoed to the host');

  // client → host only
  k = [H.c.mark(), A.c.mark(), B.c.mark()];
  A.c.sendBin(L.intentsFrame(sA, 1));
  const ih = await H.c.next(isBin(1), { from: k[0] });
  C.eq([ih.b[0], ih.b[1]], [1, sA], 'INTENTS client→host: host received it with the sender slot');
  C.ok(await quiet(B.c, k[2], isBin(1)), 'INTENTS not delivered to the other client');

  // spoofed slot byte
  k = [H.c.mark()];
  A.c.sendBin(L.intentsFrame(sB, 2));
  C.ok(await quiet(H.c, k[0], isBin(1)), 'INTENTS with a spoofed slot byte dropped');

  // non-host SNAP / KEYFRAME / HANDOFF dropped
  k = [H.c.mark(), A.c.mark(), B.c.mark()];
  A.c.sendBin(L.snapFrame(999));
  A.c.sendBin(L.keyframeFrame(sB, 999));
  A.c.sendBin(L.handoffFrame(999));
  C.ok(
    (await quiet(H.c, k[0], (m) => m.kind === 'bin')) && (await quiet(B.c, k[2], (m) => m.kind === 'bin', 50)),
    'SNAP / KEYFRAME / HANDOFF from a non-host dropped',
  );

  // host → one (KEYFRAME)
  k = [H.c.mark(), A.c.mark(), B.c.mark()];
  H.c.sendBin(L.keyframeFrame(sA, 6, 5000));
  const kf = await A.c.next(isBin(3), { from: k[1] });
  C.ok(kf.b.length === 5010 && L.tickOf(kf.b) === 6, 'KEYFRAME host→one: target received it');
  C.ok(await quiet(B.c, k[2], isBin(3)), 'KEYFRAME not delivered to anyone else');

  // INTENTS from the host, unknown kinds → dropped
  k = [A.c.mark(), B.c.mark()];
  H.c.sendBin(L.intentsFrame(hostSlot, 1));
  H.c.sendBin(new Uint8Array([9, 0xff, 1, 2, 3]));
  C.ok(await quiet(A.c, k[0], (m) => m.kind === 'bin'), 'INTENTS from the host and unknown kinds dropped');

  // order kept: 120 SNAPs at ~100/s (under the host cap) arrive complete and in order at both clients
  k = [H.c.mark(), A.c.mark(), B.c.mark()];
  for (let t = 1000; t < 1120; t++) {
    H.c.sendBin(L.snapFrame(t, 200, t));
    if (t % 10 === 9) await L.sleep(100);
  }
  await L.sleep(800);
  const ticksA = A.c.msgs.slice(k[1]).filter(isBin(2)).map((m) => L.tickOf(m.b));
  const ticksB = B.c.msgs.slice(k[2]).filter(isBin(2)).map((m) => L.tickOf(m.b));
  const want = Array.from({ length: 120 }, (_, i) => 1000 + i);
  C.eq(ticksA, want, 'order kept: client A got all 120 SNAPs in order');
  C.eq(ticksB, want, 'order kept: client B got all 120 SNAPs in order');
  // and client→host order under a mixed load: 60 INTENTS from A at ~50/s
  for (let s = 1; s <= 60; s++) {
    A.c.sendBin(L.intentsFrame(sA, s));
    if (s % 5 === 0) await L.sleep(100);
  }
  await L.sleep(600);
  const seqs = H.c.msgs
    .slice(k[0])
    .filter(isBin(1))
    .map((m) => new DataView(m.b.buffer, m.b.byteOffset).getUint16(2, true));
  C.eq(seqs, Array.from({ length: 60 }, (_, i) => i + 1), 'order kept: host got all 60 INTENTS of client A in seq order');

  // text relays: host → all with `from`; client → host only with `from`; a client's host-text dropped
  k = [H.c.mark(), A.c.mark(), B.c.mark()];
  H.c.send({ t: 'roster', matchNo: as[0].matchNo, seats: [], roster: [{ id: 0 }], durationS: 180, countdownS: 3 });
  const [ra, rb] = await Promise.all([A.c.t('roster', { from: k[1] }), B.c.t('roster', { from: k[2] })]);
  C.ok(ra.j.from === hostSlot && rb.j.roster?.[0]?.id === 0, 'roster host→all relayed with from = host slot');
  A.c.send({ t: 'loaded', matchNo: as[0].matchNo, atlasSig: 12345 });
  const ld = await H.c.t('loaded', { from: k[0] });
  C.ok(ld.j.from === sA && ld.j.atlasSig === 12345, 'loaded client→host relayed with from = sender slot');
  C.ok(await quiet(B.c, k[2], (m) => m.kind === 'text' && m.j?.t === 'loaded'), 'loaded not delivered to the other client');
  const k2 = [A.c.mark(), B.c.mark()];
  A.c.send({ t: 'seat', runner: 3, slot: sB, name: 'x', human: true });
  A.c.send({ t: 'end', matchNo: as[0].matchNo, result: {} });
  C.ok(await quiet(B.c, k2[1], (m) => m.kind === 'text' && (m.j?.t === 'seat' || m.j?.t === 'end')), 'seat / end from a non-host dropped');
  const dbg = await L.devRoom(dev, room.code);
  C.eq(dbg.st.phase, 'live', 'room still live (a forged end did not end it)');
  C.ok(dbg.stats.abuse >= 6, 'drops were counted', dbg.stats);

  stopPulse();
  L.closeAll(room.all);
  await L.sleep(300);
}

// T7: owner kick → 4008, host idle kick → 4008 (suite A); pre-match idle close + 15-min room idle close (suite B:
// PREMATCH_PING_IDLE_S 3, ROOM_IDLE_CLOSE_MIN 0.15 = 9 s).
import * as L from './lib.mjs';

export async function run(dev, C) {
  const room = await L.roomWith(dev, 3);
  const [O, P1, P2] = room.all;
  // a non-owner's kick is ignored
  P1.c.send({ t: 'kick', slot: 2, why: 'owner' });
  await L.sleep(300);
  C.ok(P2.c.isOpen, 'kick from a non-owner ignored');
  // owner kick
  const k = O.c.mark();
  O.c.send({ t: 'kick', slot: 2, why: 'owner' });
  const kc = await P2.c.closed;
  const km = P2.c.texts('kicked')[0];
  C.ok(kc.code === 4008 && km?.why === 'owner', 'owner KICK → kicked {owner} + close 4008', kc);
  const mem = await O.c.next((m) => m.kind === 'text' && m.j?.t === 'members' && !m.j.members.some((x) => x.slot === 2), { from: k });
  C.ok(!!mem, 'kicked member removed from members');

  // host idle kick during live; a client cannot idle-kick
  const P3 = await L.joinRoom(dev, room.code, { i: 3 });
  const all = [O, P1, P3];
  const as = await L.startAndAssign({ owner: O, all });
  const H = all.find((m) => m.welcome.slot === as[0].hostSlot);
  const stop = L.pulse(H.c);
  const [X, Y] = all.filter((m) => m !== H);
  X.c.send({ t: 'kick', slot: Y.welcome.slot, why: 'idle' });
  await L.sleep(300);
  C.ok(Y.c.isOpen, 'idle kick from a non-host ignored');
  const hk = H.c.mark();
  H.c.send({ t: 'kick', slot: Y.welcome.slot, why: 'idle' });
  const yc = await Y.c.closed;
  C.ok(yc.code === 4008 && Y.c.texts('kicked')[0]?.why === 'idle', 'host idle kick → kicked {idle} + close 4008');
  const pk = await H.c.next((m) => m.kind === 'text' && m.j?.t === 'peer' && m.j.slot === Y.welcome.slot, { from: hk });
  C.eq([pk.j.conn, pk.j.left], [false, true], 'host gets peer {conn:false, left:true} → bot takeover');
  stop();
  L.closeAll(all);
  await L.sleep(300);
}

export async function runIdle(dev, C) {
  // pre-match: the joiner sends nothing after hello (no pings, no messages); the owner pings ("p" auto-response)
  const own = await L.createRoom(dev, { i: 0 });
  const j = await L.joinRoom(dev, own.code, { i: 1 });
  const pinger = setInterval(() => own.c.isOpen && own.c.send('p'), 700);
  await L.sleep(4000);
  const pongs = own.c.msgs.filter((m) => m.kind === 'text' && m.raw === 'P').length;
  C.ok(pongs >= 4, `auto-response "p" → "P" answered (${pongs} pongs)`);
  own.c.send({ t: 'set', rttMs: 33 }); // the next event runs the idle check
  const jc = await Promise.race([j.c.closed, L.sleep(3000).then(() => null)]);
  C.ok(jc?.code === 4008 && j.c.texts('kicked')[0]?.why === 'idle', 'pre-match: a socket with no ping for PREMATCH_PING_IDLE_S is closed 4008 on the next event', jc);
  C.ok(own.c.isOpen, 'the pinging owner stays');

  // room idle: no START for ROOM_IDLE_CLOSE_MIN (9 s) → closed 4031 on the next event
  await L.sleep(5500);
  own.c.send({ t: 'set', rttMs: 34 });
  const oc = await Promise.race([own.c.closed, L.sleep(3000).then(() => null)]);
  clearInterval(pinger);
  C.ok(oc?.code === 4031, 'code room with no start for ROOM_IDLE_CLOSE_MIN → close 4031', oc);
  const d = await L.devRoom(dev, own.code);
  C.eq(d.st?.phase, 'closed', 'room phase closed');
  const late = await L.joinRoom(dev, own.code, { i: 2, doHello: false });
  const e = await late.c.t('err', { failOnClose: false }).catch(() => null);
  C.eq(e?.j?.code, 'not_found', 'joining an idle-closed room → not_found');
}

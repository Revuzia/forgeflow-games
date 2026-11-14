// T10: hibernation — idle Room / Lobby state is rebuilt from storage + socket attachments after the runtime evicts the
// object. Local workerd hibernates a Durable Object whose hibernatable sockets have been silent for ~10 s (measured in
// the build session: evicted after a 10 s gap, not after 5 s gaps). ctx.abort() is NOT a usable stand-in: it also
// drops the hibernatable sockets (measured: 1006). So these checks leave the objects idle for IDLE_S and prove a new
// instance (fresh constructor) rebuilt the state. Auto-responded pings ("p") during the idle period must not wake it.
import * as L from './lib.mjs';

const IDLE_S = Number(process.env.T10_IDLE_S || 14);

async function idle(clients, s) {
  const id = setInterval(() => clients.forEach((c) => c.isOpen && c.send('p')), 4000);
  await L.sleep(s * 1000);
  clearInterval(id);
}

export async function run(dev, C) {
  C.extra = { idleS: IDLE_S };
  // ---- Room, phase `room`: cfg and a pre-match drop exist only in memory + the attachments ----
  const room = await L.roomWith(dev, 3);
  const [O, P1, P2] = room.all;
  let k = O.c.mark();
  O.c.send({ t: 'cfg', map: 'lockwell', skill: 'storm', preset: 'golden' });
  await O.c.next((m) => m.kind === 'text' && m.j?.t === 'members' && m.j.room?.map === 'lockwell', { from: k });
  P2.c.close(1000, 'network'); // a disconnected member keeps its seat for RECONNECT_GRACE_S (60 s)
  await P2.c.closed;
  await L.sleep(200);
  const before = await L.devRoom(dev, room.code);
  await idle([O.c, P1.c], IDLE_S);
  const pongs = O.c.msgs.filter((m) => m.raw === 'P').length;
  C.ok(O.c.isOpen && P1.c.isOpen && pongs >= 2, `sockets stay open through the idle period; auto-response pongs: ${pongs}`);
  k = O.c.mark();
  P1.c.send({ t: 'set', rttMs: 77 }); // the first event after the idle period
  const mem = await O.c.next((m) => m.kind === 'text' && m.j?.t === 'members', { from: k, timeout: 5000 }).catch(() => null);
  const after = await L.devRoom(dev, room.code);
  C.ok(after.instanceId !== before.instanceId, `evicted while idle: new instance (${before.instanceId} → ${after.instanceId})`);
  C.eq(after.loadedFrom, 'attachments', 'state rebuilt from the socket attachments (newer than the storage row)');
  C.eq([after.st.map, after.st.skill, after.st.preset, after.st.ownerSlot], ['lockwell', 'storm', 'golden', 0], 'cfg and owner survived (never written to storage)');
  const m2 = after.st.members.find((x) => x.slot === 2);
  C.ok(!!m2 && m2.conn === false && after.st.members.filter((x) => x.conn).length === 2, 'members rebuilt: 2 connected, slot 2 disconnected but seated');
  C.ok(mem?.j?.members?.find((x) => x.slot === 1)?.rttMs === 77, 'the rebuilt object handled the message and rebroadcast members');
  const back = await L.joinRoom(dev, room.code, { i: 2, token: P2.welcome.token });
  C.eq(back.welcome?.slot, 2, 'token reconnect after the rebuild: same seat');
  const all = [O, P1, back];
  const as = await L.startAndAssign({ owner: O, all });
  C.eq(as[0].map, 'lockwell', 'START on the rebuilt object uses the rebuilt cfg (map lockwell)');
  const H = all.find((m) => m.welcome.slot === as[0].hostSlot);
  const X = all.find((m) => m !== H);
  const kx = X.c.mark();
  H.c.sendBin(L.snapFrame(9, 8));
  const s = await X.c.next((m) => m.kind === 'bin', { from: kx, timeout: 3000 }).catch(() => null);
  C.ok(!!s && L.tickOf(s.b) === 9, 'relay works after the rebuild');

  // ---- Room, phase `post`: the cached end survives a hibernation (it is stored with the post write) ----
  H.c.send({ t: 'end', matchNo: as[0].matchNo, result: { winner: 0 }, runners: [], migrations: 0, voided: false });
  const e1 = await X.c.t('end', { from: kx });
  X.c.close(1000, 'drop at the horn');
  await X.c.closed;
  const p0 = await L.devRoom(dev, room.code);
  await idle(all.filter((m) => m !== X).map((m) => m.c), IDLE_S);
  const ret = await L.joinRoom(dev, room.code, { i: 9, token: X.welcome.token, doHello: false });
  const rk = ret.c.mark();
  await L.hello(ret.c, L.profile(9));
  const e2 = await ret.c.t('end', { from: rk, timeout: 3000 }).catch(() => null);
  const p1 = await L.devRoom(dev, room.code);
  C.ok(p1.instanceId !== p0.instanceId, `post-phase room evicted while idle (${p0.instanceId} → ${p1.instanceId})`);
  C.ok(e2?.raw === e1.raw, 'reconnect after the post-phase hibernation still receives the cached end');
  L.closeAll([...all, ret]);
  await L.sleep(300);

  // ---- Lobby: a long-waiting player's queue entry survives a hibernation ----
  const q1 = new L.Client(`${dev.ws}/qm?mode=ffa&rule=washout&build=${L.enc(L.BUILD)}`, { label: 'hq1' });
  await q1.opened;
  q1.send({ t: 'qm', proto: L.PROTO, build: L.BUILD, ...L.profile(1) });
  await q1.t('solo', { timeout: 8000 }); // after solo no deadline is left: no timer, the Lobby may hibernate
  const lb = await L.devLobby(dev, 'ffa', 'washout');
  await idle([q1], IDLE_S);
  const q2 = new L.Client(`${dev.ws}/qm?mode=ffa&rule=washout&build=${L.enc(L.BUILD)}`, { label: 'hq2' });
  await q2.opened;
  q2.send({ t: 'qm', proto: L.PROTO, build: L.BUILD, ...L.profile(2) });
  const [a, b] = await Promise.all([q1.t('matched', { timeout: 6000, failOnClose: false }).catch(() => null), q2.t('matched', { timeout: 6000, failOnClose: false }).catch(() => null)]);
  const la = await L.devLobby(dev, 'ffa', 'washout');
  C.ok(la.instanceId !== lb.instanceId, `lobby evicted while idle (${lb.instanceId} → ${la.instanceId})`);
  C.ok(!!a && !!b && a.j.code === b.j.code && b.at - a.at < 1000, 'the player queued before the hibernation was matched at once with a newcomer (queue rebuilt; anchor past MAX wait)');
  q1.close();
  q2.close();
  await L.sleep(300);
}

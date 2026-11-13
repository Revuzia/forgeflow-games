// T6: reconnect with a token gets the same slot; a wrong token is a new member; duplicate sockets; leave = gone.
import * as L from './lib.mjs';

export async function run(dev, C) {
  const room = await L.roomWith(dev, 3);
  const [O, P1, P2] = room.all;

  // pre-match drop → members shows conn:false → token reconnect → same slot, same jid, conn:true
  let k = O.c.mark();
  P1.c.close(1000, 'network');
  const off = await O.c.next((m) => m.kind === 'text' && m.j?.t === 'members' && m.j.members.find((x) => x.slot === 1)?.conn === false, { from: k });
  C.ok(!!off, 'pre-match drop: members shows slot 1 disconnected (seat kept)');
  k = O.c.mark();
  const r1 = await L.joinRoom(dev, room.code, { i: 1, token: P1.welcome.token });
  C.eq([r1.welcome?.slot, r1.welcome?.jid, r1.welcome?.token], [1, P1.welcome.jid, P1.welcome.token], 'token reconnect: same slot, same jid, same token');
  const on = await O.c.next((m) => m.kind === 'text' && m.j?.t === 'members' && m.j.members.find((x) => x.slot === 1)?.conn === true, { from: k });
  C.ok(!!on, 'members shows slot 1 connected again');

  // live: drop → host gets peer {conn:false, left:false}; reconnect → welcome + assign, host gets peer {conn:true, rejoin:true}
  const all = [O, r1, P2];
  const as = await L.startAndAssign({ owner: O, all });
  const H = all.find((m) => m.welcome.slot === as[0].hostSlot);
  const stop = L.pulse(H.c);
  await L.sleep(250); // first SNAP relayed → phase live
  const V = all.find((m) => m !== H && m !== O) ?? all.find((m) => m !== H);
  k = H.c.mark();
  V.c.close(1000, 'network');
  const pOff = await H.c.next((m) => m.kind === 'text' && m.j?.t === 'peer' && m.j.slot === V.welcome.slot, { from: k });
  C.eq([pOff.j.conn, pOff.j.left, pOff.j.jid], [false, false, V.welcome.jid], 'live drop: host gets peer {conn:false, left:false, jid}');
  k = H.c.mark();
  const back = await L.joinRoom(dev, room.code, { i: 9, token: V.welcome.token, doHello: false });
  const bk = back.c.mark();
  const bw = await L.hello(back.c, L.profile(9));
  const bas = await back.c.t('assign', { from: bk, timeout: 3000 }).catch(() => null);
  C.ok(bw.slot === V.welcome.slot && bw.room.phase === 'live' && bas?.j?.seed === as[0].seed && bas.j.hostSlot === as[0].hostSlot, 'live reconnect: same slot, welcome phase live + the running assign (seed, host)', { bw, bas: bas?.j, as0: as[0], V: V.welcome.slot });
  const pOn = await H.c.next((m) => m.kind === 'text' && m.j?.t === 'peer' && m.j.slot === V.welcome.slot && m.j.conn === true, { from: k });
  C.eq([pOn.j.rejoin, pOn.j.jid], [true, V.welcome.jid], 'host gets peer {conn:true, rejoin:true, same jid}');
  // the reconnected client's SNAP stream resumes
  const sk = back.c.mark();
  H.c.sendBin(L.snapFrame(777, 16));
  const s = await back.c.next((m) => m.kind === 'bin' && !L.isPulse(m), { from: sk });
  C.eq(L.tickOf(s.b), 777, 'reconnected client receives SNAPs again');

  // wrong token → a new member (new slot, new jid, new token): a late joiner
  const wrong = await L.joinRoom(dev, room.code, { i: 10, token: '0123456789abcdef0123456789abcdef' });
  C.ok(wrong.welcome?.slot === 3 && wrong.welcome.jid > 3 && wrong.welcome.token !== V.welcome.token, 'wrong token → new member (slot 3, new jid, new token)', wrong.welcome);

  // duplicate: a second socket with the same token replaces the first (closed 4000 'replaced')
  const dup = await L.joinRoom(dev, room.code, { i: 9, token: V.welcome.token });
  const dcl = await back.c.closed;
  C.ok(dup.welcome?.slot === V.welcome.slot && dcl.code === 4000 && dcl.reason === 'replaced', 'same token twice: the newer socket takes the seat, the older closes 4000 replaced', dcl);
  const k3 = H.c.mark();
  dup.c.sendBin(L.intentsFrame(V.welcome.slot, 5));
  const it = await H.c.next((m) => m.kind === 'bin' && m.b[0] === 1, { from: k3, timeout: 3000 }).catch(() => null);
  C.ok(!!it, 'the replacing socket relays INTENTS');

  // leave → host gets peer {left:true}; the old token no longer works (becomes a new member)
  const k4 = H.c.mark();
  dup.c.send({ t: 'leave' });
  const lc = await dup.c.closed;
  const pl = await H.c.next((m) => m.kind === 'text' && m.j?.t === 'peer' && m.j.slot === V.welcome.slot && m.j.left === true, { from: k4 });
  C.ok(lc.code === 4000 && !!pl, 'leave: close 4000, host gets peer {conn:false, left:true}');
  const after = await L.joinRoom(dev, room.code, { i: 11, token: V.welcome.token });
  C.ok(after.welcome?.jid !== V.welcome.jid, 'token of a member who left is void (joins as a new member)', after.welcome);

  // relay restart: every socket drops at once → room closed; a token reconnect within the grace revives it
  stop();
  const r2 = await L.roomWith(dev, 2);
  const a2 = await L.startAndAssign(r2);
  const H2 = r2.all.find((m) => m.welcome.slot === a2[0].hostSlot);
  H2.c.sendBin(L.snapFrame(3));
  await L.sleep(200);
  for (const m of r2.all) m.c.close(1000, 'relay restart');
  await Promise.all(r2.all.map((m) => m.c.closed));
  await L.sleep(300);
  const d1 = await L.devRoom(dev, r2.code);
  C.eq([d1.st.phase, d1.st.prevPhase], ['closed', 'live'], 'all sockets gone → phase closed (revivable)');
  const rv = await L.joinRoom(dev, r2.code, { i: 0, token: r2.all[0].welcome.token });
  C.ok(rv.welcome?.slot === r2.all[0].welcome.slot && rv.welcome.room.phase === 'live', 'token reconnect within RECONNECT_GRACE_S revives the room (phase live)', rv.welcome?.room);
  const stranger = await L.joinRoom(dev, 'ZZZY', { i: 5, doHello: false });
  await stranger.c.closed;

  L.closeAll([...all, back, wrong, dup, after, rv]);
  await L.sleep(300);
}

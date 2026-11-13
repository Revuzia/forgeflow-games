// T11: DUEL (owner 2026-10-19) — one runner a side. Quick match: two duel players pair at once (a full group of 2 needs no
// fill wait) and never meet a TEAMS queue; a DUEL room holds 2 (the 3rd join is refused room_full); a room of 3 cannot
// switch to DUEL, a room of 2 can; a duel room's assign names mode 'duel'.
// Suite vars: QM_FAST (QM_FILL_WAIT_S 2 …).
import * as L from './lib.mjs';

function qm(dev, mode, rule, i) {
  const c = new L.Client(`${dev.ws}/qm?mode=${mode}&rule=${rule}&build=${L.enc(L.BUILD)}`, { label: `d${mode[0]}${i}` });
  c.qmAt = 0;
  c.go = async () => {
    await c.opened;
    c.qmAt = performance.now();
    c.send({ t: 'qm', proto: L.PROTO, build: L.BUILD, ...L.profile(i) });
  };
  return c;
}

export async function run(dev, C) {
  // --- quick match: a TEAMS player waiting does not join the duel queue; two duelists pair with no fill wait ---
  const T1 = qm(dev, 'teams', 'turf', 1);
  await T1.go();
  const D1 = qm(dev, 'duel', 'turf', 2);
  const D2 = qm(dev, 'duel', 'turf', 3);
  await D1.go();
  await L.sleep(300);
  await D2.go();
  const [m1, m2] = await Promise.all([D1.t('matched', { timeout: 6000 }), D2.t('matched', { timeout: 6000 })]);
  const wait = (m2.at - D2.qmAt) / 1000;
  C.ok(m1.j.code === m2.j.code && m1.j.ticket !== m2.j.ticket, 'two duel players matched into one room, one ticket each', [m1.j, m2.j]);
  C.ok(wait < 1.5, `duel pair launched at once: ${wait.toFixed(2)} s after the 2nd player (a full group of 2; no FILL 2 s wait)`);
  C.ok(T1.isOpen && !T1.texts('matched').length, 'the waiting TEAMS player was not matched with the duelists (separate queue)');
  T1.close?.();

  // --- quick duel room: both tickets get in; its room is a duel ---
  const r1 = await L.joinRoom(dev, m1.j.code, { i: 2, ticket: m1.j.ticket });
  C.eq([r1.welcome?.t, r1.welcome?.room?.mode], ['welcome', 'duel'], 'quick duel room welcome: mode duel');

  // --- a DUEL code room holds 2: the 3rd join is refused room_full ---
  const own = await L.createRoom(dev, { mode: 'duel', i: 10 });
  C.eq(own.welcome.room.mode, 'duel', 'CREATE ROOM with mode=duel: the room is a duel');
  const j1 = await L.joinRoom(dev, own.code, { i: 11 });
  C.eq(j1.welcome?.t, 'welcome', 'the 2nd duelist joins');
  const j2 = await L.joinRoom(dev, own.code, { i: 12 });
  const e3 = j2.welcome?.t === 'welcome' ? null : await j2.c.t('err', { failOnClose: false, timeout: 3000 }).catch(() => null);
  const c3 = await j2.c.closed;
  C.ok(j2.welcome?.t !== 'welcome' && (e3?.j?.code === 'room_full' || c3.code === 4009), 'a 3rd player is refused (room_full / 4009)', { welcome: j2.welcome?.t, err: e3?.j, close: c3.code });

  // --- duel room START: the assign names mode 'duel' ---
  const assigns = await L.startAndAssign({ owner: own, all: [own, j1] });
  C.eq(assigns.map((a) => a.mode), ['duel', 'duel'], 'START in a duel room: both members get assign mode duel');

  // --- a TEAMS room of 3 cannot switch to DUEL; of 2 it can ---
  const big = await L.roomWith(dev, 3, {});
  big.owner.c.send({ t: 'cfg', mode: 'duel' });
  await L.sleep(400);
  const dbg = await L.devRoom(dev, big.code);
  C.eq(dbg.st.mode, 'teams', 'a room of 3 cannot switch to DUEL (it holds 2)');
  const small = await L.roomWith(dev, 2, {});
  const mk = small.owner.c.mark();
  small.owner.c.send({ t: 'cfg', mode: 'duel' });
  const got = await small.owner.c.next((m) => m.kind === 'text' && m.j?.t === 'members' && m.j.room?.mode === 'duel', { from: mk, what: 'members after cfg duel', timeout: 4000 }).catch(() => null);
  C.ok(!!got, 'a room of 2 switches to DUEL and the change is rebroadcast');
}

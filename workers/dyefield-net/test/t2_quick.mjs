// T2: quick match per mode × rule (separate queues), fill-wait / max-wait timing, `solo`, ticket enforcement,
// same-continent grouping, 8-human instant launch, quick-room autostart and rematch.
// Suite vars: QM_FILL_WAIT_S 2, QM_MAX_WAIT_S 4, QM_SOLO_WAIT_S 5, QM_AUTOSTART_S 2, REMATCH_WINDOW_S 3.
import * as L from './lib.mjs';

function qm(dev, mode, rule, i, { build = L.BUILD, cont = '', label } = {}) {
  let url = `${dev.ws}/qm?mode=${mode}&rule=${rule}&build=${L.enc(build)}`;
  if (cont) url += '&devcont=' + cont;
  const c = new L.Client(url, { label: label ?? `q${mode[0]}${rule[0]}${i}` });
  c.qmAt = 0;
  c.go = async (p = {}) => {
    await c.opened;
    c.qmAt = performance.now();
    c.send({ t: 'qm', proto: L.PROTO, build, ...L.profile(i), ...p });
  };
  return c;
}

const matched = (c, timeout = 9000) => c.t('matched', { timeout, failOnClose: false });

export async function run(dev, C) {
  // --- separate queues + fill wait: two teams·turf players meet after FILL (2 s) from the 2nd one's join ---
  const A1 = qm(dev, 'teams', 'turf', 1);
  const B1 = qm(dev, 'ffa', 'turf', 2);
  const C1 = qm(dev, 'teams', 'washout', 3);
  await Promise.all([A1.go(), B1.go(), C1.go()]);
  await L.sleep(500);
  const A2 = qm(dev, 'teams', 'turf', 4);
  await A2.go();
  const q = await A2.t('queue', { timeout: 3000 }).catch(() => null);
  C.ok(q?.j?.waiting === 2, 'queue message: waiting 2 in teams·turf', q?.j);
  const [mA1, mA2] = await Promise.all([matched(A1), matched(A2)]);
  const waitA = (mA2.at - A2.qmAt) / 1000;
  C.ok(mA1.j.code === mA2.j.code && mA1.j.ticket !== mA2.j.ticket, 'teams·turf pair matched into one room, one ticket each', [mA1.j, mA2.j]);
  C.ok(waitA >= 1.8 && waitA <= 3.2, `fill wait: matched ${waitA.toFixed(2)} s after the 2nd player (FILL 2 s)`);
  const clA = await A1.closed;
  C.eq(clA.code, 4000, 'lobby socket closed (4000) after matched');
  C.ok(B1.isOpen && C1.isOpen && !B1.texts('matched').length && !C1.texts('matched').length, 'ffa·turf and teams·washout players were not matched (separate queues)');

  // --- solo after QM_SOLO_WAIT_S (5 s) alone; the socket stays (KEEP WAITING) ---
  const so = await B1.t('solo', { timeout: 6000 }).catch(() => null);
  const soloAt = so ? (so.at - B1.qmAt) / 1000 : -1;
  C.ok(!!so && soloAt >= 4.8 && soloAt <= 6.2, `solo sent after ${soloAt.toFixed(2)} s alone (QM_SOLO_WAIT_S 5)`);
  C.ok(B1.isOpen, 'solo player stays queued (socket open)');

  // --- quick room: ticket enforcement + autostart when every matched member said hello ---
  const code = mA1.j.code;
  const noTicket = await L.joinRoom(dev, code, { i: 40, doHello: false });
  const e1 = await noTicket.c.t('err', { failOnClose: false }).catch(() => null);
  const c1 = await noTicket.c.closed;
  C.eq([e1?.j?.code, c1.code], ['bad', 4004], 'quick room without a ticket: refused (err bad, 4004)');
  const fake = await L.joinRoom(dev, code, { i: 41, ticket: 'f'.repeat(32), doHello: false });
  const e2 = await fake.c.t('err', { failOnClose: false }).catch(() => null);
  C.eq(e2?.j?.code, 'bad', 'quick room with a forged ticket: refused');
  const r1 = await L.joinRoom(dev, code, { i: 1, ticket: mA1.j.ticket, doHello: false });
  const r2 = await L.joinRoom(dev, code, { i: 4, ticket: mA2.j.ticket, doHello: false });
  const k1 = r1.c.mark();
  const k2 = r2.c.mark();
  const w1 = await L.hello(r1.c, L.profile(1));
  C.eq([w1.t, w1.room?.quick, w1.room?.mode, w1.room?.rule, w1.room?.skill, w1.room?.preset], ['welcome', true, 'teams', 'turf', 'swell', 'noon'], 'quick room welcome: quick, teams·turf, SWELL, noon');
  const helloAt = performance.now();
  await L.hello(r2.c, L.profile(4));
  const [as1, as2] = await Promise.all([r1.c.t('assign', { from: k1, timeout: 6000 }), r2.c.t('assign', { from: k2, timeout: 6000 })]);
  C.ok(as1.j.seed === as2.j.seed && ['pier18', 'lockwell', 'cinder'].includes(as1.j.map) && (as1.at - helloAt) < 1500, 'quick room auto-started once both matched members said hello (map resolved, same seed)', as1.j);
  // a ticket re-entry (sessionStorage lost) gets the same seat back
  r2.c.close(1000, 'drop');
  await r2.c.closed;
  const r2b = await L.joinRoom(dev, code, { i: 4, ticket: mA2.j.ticket });
  C.eq(r2b.welcome?.slot, w1.slot === 0 ? 1 : 0, 'ticket re-entry: same seat back');

  // --- quick rematch: both press REMATCH within the window → the same room starts again ---
  const host = as1.j.hostSlot === w1.slot ? r1 : r2b;
  const mk = [r1.c.mark(), r2b.c.mark()];
  host.c.sendBin(L.snapFrame(3));
  host.c.send({ t: 'end', matchNo: as1.j.matchNo, result: { winner: 0 }, runners: [] });
  await Promise.all([r1, r2b].filter((x) => x !== host).map((x) => x.c.t('end', { from: x === r1 ? mk[0] : mk[1] })));
  const mk2 = [r1.c.mark(), r2b.c.mark()];
  r1.c.send({ t: 'rematch' });
  r2b.c.send({ t: 'rematch' });
  const re = await Promise.all([r1.c.t('assign', { from: mk2[0], timeout: 6000 }), r2b.c.t('assign', { from: mk2[1], timeout: 6000 })]).catch(() => null);
  C.ok(!!re && re[0].j.matchNo === as1.j.matchNo + 1, 'quick REMATCH by both → same room, matchNo + 1', re?.[0]?.j);
  // rematch with only one presser → requeue after the window (3 s)
  const host2 = re && re[0].j.hostSlot === w1.slot ? r1 : r2b;
  const mk3 = [r1.c.mark(), r2b.c.mark()];
  host2.c.sendBin(L.snapFrame(3));
  host2.c.send({ t: 'end', matchNo: re?.[0]?.j?.matchNo ?? 2, result: { winner: 1 }, runners: [] });
  await L.sleep(300);
  r1.c.send({ t: 'rematch' });
  const rq = await r1.c.t('requeue', { from: mk3[0], timeout: 6000, failOnClose: false }).catch(() => null);
  const rqc = await r1.c.closed;
  C.ok(!!rq && rqc.code === 4000, 'lone REMATCH presser gets requeue + close 4000 after the window');

  // --- max wait: D1 then D2 3.5 s later → launch at D1 + MAX (4 s), not D2 + FILL (5.5 s) ---
  const D1 = qm(dev, 'ffa', 'washout', 5);
  await D1.go();
  await L.sleep(3500);
  const D2 = qm(dev, 'ffa', 'washout', 6);
  await D2.go();
  const mD1 = await matched(D1);
  const waitD = (mD1.at - D1.qmAt) / 1000;
  C.ok(waitD >= 3.8 && waitD <= 4.9, `max wait: matched ${waitD.toFixed(2)} s after the 1st player (MAX 4 s)`);

  // --- 8 humans launch at once (a fresh queue: C1 has waited past MAX, so it would launch with the first arrival) ---
  C1.close(4000, 'done');
  await C1.closed;
  const many = [];
  for (let i = 0; i < 8; i++) many.push(qm(dev, 'teams', 'washout', 10 + i));
  await Promise.all(many.map((c) => c.opened));
  const t8 = performance.now();
  await Promise.all(many.map((c) => c.go()));
  const ms = await Promise.all(many.map((c) => matched(c, 4000).catch(() => null)));
  const codes = new Set(ms.map((m) => m?.j?.code));
  const lat = Math.max(...ms.map((m) => (m ? m.at - t8 : 1e9))) / 1000;
  C.ok(codes.size === 1 && !codes.has(undefined) && lat < 1.5, `8 humans → one room immediately (${lat.toFixed(2)} s)`, [...codes]);

  // --- same continent first. Widening happens at anchor + FILL, never later than a 2–7 group's launch, so the rule is
  // observable at the 8-cap: an EU player waiting, then 8 NA players → the 8 NA launch together, the EU one waits. ---
  B1.close(4000, 'done');
  await B1.closed;
  await L.sleep(200);
  const E1 = qm(dev, 'ffa', 'turf', 23, { cont: 'EU' });
  await E1.go();
  await L.sleep(300);
  const NA = [];
  for (let i = 0; i < 8; i++) NA.push(qm(dev, 'ffa', 'turf', 50 + i, { cont: 'NA' }));
  await Promise.all(NA.map((c) => c.go()));
  const mNA = await Promise.all(NA.map((c) => matched(c, 1800).catch(() => null)));
  const naCodes = new Set(mNA.map((m) => m?.j?.code));
  await L.sleep(200);
  const eMatched = E1.texts('matched')[0];
  C.ok(
    naCodes.size === 1 && !naCodes.has(undefined) && !eMatched && E1.isOpen,
    'same-continent grouping: 8 NA players launched together, the earlier EU player not pulled in',
    { na: [...naCodes], e: eMatched ?? null },
  );

  // --- build mismatch in the lobby ---
  const X = qm(dev, 'teams', 'turf', 30);
  await X.opened;
  X.send({ t: 'qm', proto: L.PROTO, build: 'dyefield-0.0.1+p1+zzz', ...L.profile(30) });
  const ex = await X.t('err', { failOnClose: false }).catch(() => null);
  const xc = await X.closed;
  C.eq([ex?.j?.code, xc.code], ['build', 4026], 'lobby: qm with another build → err build, 4026');

  // --- late fill (SHOULD): a live quick room with open seats takes a new quick-match player straight in ---
  const F1 = qm(dev, 'ffa', 'washout', 60);
  const F2 = qm(dev, 'ffa', 'washout', 61);
  await Promise.all([F1.go(), F2.go()]);
  const [mF1, mF2] = await Promise.all([matched(F1), matched(F2)]);
  const g1 = await L.joinRoom(dev, mF1.j.code, { i: 60, ticket: mF1.j.ticket, doHello: false });
  const g2 = await L.joinRoom(dev, mF2.j.code, { i: 61, ticket: mF2.j.ticket, doHello: false });
  const gk = [g1.c.mark(), g2.c.mark()];
  const gw1 = await L.hello(g1.c, L.profile(60));
  await L.hello(g2.c, L.profile(61));
  const gas = await g1.c.t('assign', { from: gk[0], timeout: 6000 });
  const gHost = gas.j.hostSlot === gw1.slot ? g1 : g2;
  gHost.c.sendBin(L.snapFrame(3)); // → live, the Room reports its open seats to the Lobby
  await L.sleep(400);
  const F3 = qm(dev, 'ffa', 'washout', 62);
  await F3.go();
  const mF3 = await matched(F3, 3000).catch(() => null);
  C.ok(mF3?.j?.code === mF1.j.code && mF3.at - F3.qmAt < 1500, 'late fill: a new quick-match player is routed straight into the live room', mF3?.j);
  if (mF3) {
    const g3 = await L.joinRoom(dev, mF3.j.code, { i: 62, ticket: mF3.j.ticket, doHello: false });
    const g3k = g3.c.mark();
    const w3 = await L.hello(g3.c, L.profile(62));
    const as3 = await g3.c.t('assign', { from: g3k, timeout: 3000 }).catch(() => null);
    C.ok(w3.room?.phase === 'live' && as3?.j?.matchNo === gas.j.matchNo, 'late filler: welcome phase live + the running match assign');
    g3.c.close(4000, 'done');
  }
  for (const x of [g1, g2]) x.c.close(4000, 'done');

  for (const c of [A1, A2, B1, C1, D1, D2, E1, F1, F2, F3, ...NA, ...many]) c.close(4000, 'done');
  for (const x of [r1, r2b, noTicket, fake]) x.c.close(4000, 'done');
  await L.sleep(300);
}

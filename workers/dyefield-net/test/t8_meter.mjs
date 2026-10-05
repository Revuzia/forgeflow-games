// T8: meter — counted units match the frames sent (± connections/RPCs); both counts (raw, units); admission refuses a
// start whose estimate does not fit; a burst of simultaneous starts never ends the day above the cap; running rooms are
// unaffected; closed day → err quota for new rooms and lobby groups; strict vs billing20 pick the right cap;
// ≤ 20 storage row writes per Room per match.
// Suite C: COUNT_MODE strict, RAW_CAP 3000, DAILY_UNIT_CAP 1e6. Suite D (runBilling20): billing20, RAW_CAP 1, DAILY_UNIT_CAP 120.
import * as L from './lib.mjs';

const DUR = 10; // dev match length (cfg.durationS) → est for 2 humans: raw 710, units 45
const EST2 = { raw: 710, units: 45 };

async function meter(dev) {
  return L.devMeter(dev); // counts as 1 status RPC (included in the returned figures)
}
async function setMeter(dev, q) {
  return (await L.getJson(`${dev.base}/__dev/meter/set?${new URLSearchParams(q)}`)).body;
}

/** A 2-human code room configured for a DUR-second dev match; returns {room, as} after START, or the refusal. */
async function twoRoom(dev) {
  const room = await L.roomWith(dev, 2);
  room.owner.c.send({ t: 'cfg', durationS: DUR });
  await L.sleep(100);
  return room;
}

async function pressStart(room) {
  const marks = room.all.map((m) => m.c.mark());
  room.owner.c.send({ t: 'start' });
  const res = await Promise.all(
    room.all.map((m, k) =>
      m.c.next((x) => x.kind === 'text' && (x.j?.t === 'assign' || (x.j?.t === 'err' && x.j.code === 'quota')), { from: marks[k], timeout: 8000, failOnClose: false }),
    ),
  );
  return res.map((r) => r.j);
}

export async function run(dev, C) {
  // ---------- exact counting ----------
  const m0 = await meter(dev);
  const room = await twoRoom(dev);
  const st = await pressStart(room);
  C.ok(st.every((x) => x.t === 'assign' && x.durationS === DUR), 'room admitted (2 humans, durationS 10)');
  const H = room.all.find((m) => m.welcome.slot === st[0].hostSlot);
  const Cl = room.all.find((m) => m !== H);
  const N = 100;
  for (let i = 0; i < N; i++) {
    H.c.sendBin(L.snapFrame(3 * (i + 1), 200));
    Cl.c.sendBin(L.intentsFrame(Cl.welcome.slot, i + 1));
    await L.sleep(50);
  }
  const mid = await meter(dev);
  C.ok(mid.reservedRaw === EST2.raw && mid.reservedUnits === EST2.units, `admission reserved the 2-human estimate (raw ${mid.reservedRaw}, units ${mid.reservedUnits})`, mid);
  H.c.send({ t: 'end', matchNo: st[0].matchNo, result: { winner: 0 }, runners: [] });
  await Cl.c.t('end');
  const dbgPost = await L.devRoom(dev, room.code);
  room.all.forEach((m) => m.c.send({ t: 'leave' }));
  await Promise.all(room.all.map((m) => m.c.closed));
  await L.sleep(400);
  const m1 = await meter(dev);
  const frames = 2 /*hello*/ + 1 /*cfg*/ + 1 /*start*/ + N + N + 1 /*end*/ + 2; /*leave*/
  const roomReq = 3; // claim RPC + 2 connection fetches
  const meterRpc = 1 /*room/new status*/ + 1 /*admit*/ + 1 /*settle at post*/ + 1 /*settle at close*/ + 1 /*mid read*/ + 1; /*this read*/
  const liveS = N * 0.05;
  const pings = 0.5 * 2 * liveS; // the Room's estimate of the auto-responded pings while live
  const dRaw = m1.raw - m0.raw;
  const dUnits = m1.units - m0.units;
  const wantRaw = frames + roomReq + meterRpc + pings;
  const wantUnits = (frames + pings) / 20 + roomReq + meterRpc;
  C.ok(Math.abs(dRaw - wantRaw) <= 4, `raw counted ${dRaw} vs frames + connections + RPCs + ping estimate ${wantRaw.toFixed(1)}`, { m0, m1 });
  C.ok(Math.abs(dUnits - wantUnits) <= 2, `units counted ${dUnits} vs ceil(frames/20) + connections + RPCs ${wantUnits.toFixed(1)}`);
  C.ok(m1.reservedRaw === 0 && m1.reservedUnits === 0, 'reservation fully released at post / close');
  C.ok(dbgPost.putsByMatch['1'] <= 20 && dbgPost.putCount <= 20, `storage row writes: ${dbgPost.putCount} total, ${dbgPost.putsByMatch['1']} for match 1 (≤ 20)`, dbgPost.putsByMatch);

  // ---------- admission: the second start does not fit ----------
  await setMeter(dev, { raw: 2000, units: 0 });
  const A = await twoRoom(dev);
  const sa = await pressStart(A);
  C.ok(sa.every((x) => x.t === 'assign'), 'room A admitted (2000 + 710 ≤ 3000)');
  const HA = A.all.find((m) => m.welcome.slot === sa[0].hostSlot);
  const stopA = L.pulse(HA.c);
  const Bq = await twoRoom(dev);
  const sb = await pressStart(Bq);
  const closesB = await Promise.all(Bq.all.map((m) => m.c.closed));
  C.ok(sb.every((x) => x.t === 'err' && x.code === 'quota') && closesB.every((c) => c.code === 4030), 'room B refused (2000 + 710 + 710 > 3000): err quota + close 4030 for every member');
  const ka = A.all.find((m) => m !== HA).c.mark();
  HA.c.sendBin(L.snapFrame(42, 8));
  const still = await A.all.find((m) => m !== HA).c.next((m) => m.kind === 'bin' && !L.isPulse(m), { from: ka, timeout: 3000 }).catch(() => null);
  C.ok(!!still, 'running room A unaffected (still relaying)');
  const hb = await L.getJson(`${dev.base}/health`);
  C.ok(hb.body.mode === 'strict' && hb.body.cap === 3000 && hb.body.reservedRaw === EST2.raw && hb.body.open === true, '/health: strict mode, cap = RAW_CAP, reservation visible', hb.body);
  stopA();
  HA.c.send({ t: 'end', matchNo: sa[0].matchNo, result: {}, runners: [] });
  await L.sleep(300);
  A.all.forEach((m) => m.c.send({ t: 'leave' }));
  await Promise.all(A.all.map((m) => m.c.closed));

  // ---------- burst: 4 simultaneous starts with room for 2 ----------
  const rooms = [];
  for (let i = 0; i < 4; i++) rooms.push(await twoRoom(dev));
  await setMeter(dev, { raw: 1500, units: 0 });
  const res = await Promise.all(rooms.map((r) => pressStart(r)));
  const admitted = res.filter((r) => r[0].t === 'assign').length;
  const refused = res.filter((r) => r[0].t === 'err').length;
  const mb = await meter(dev);
  C.ok(admitted === 2 && refused === 2, `burst of 4 starts with room for 2: ${admitted} admitted, ${refused} refused`);
  C.ok(mb.raw + mb.reservedRaw <= 3000, `used + reserved ${mb.raw} + ${mb.reservedRaw} ≤ cap 3000`);
  // play the admitted ones to the end; the day must not end above the cap
  const live = rooms.filter((r, i) => res[i][0].t === 'assign');
  for (const [i, r] of live.entries()) {
    const a = res[rooms.indexOf(r)][0];
    const h = r.all.find((m) => m.welcome.slot === a.hostSlot);
    const c = r.all.find((m) => m !== h);
    for (let t = 0; t < 40; t++) {
      h.c.sendBin(L.snapFrame(t * 3 + 3, 300));
      c.c.sendBin(L.intentsFrame(c.welcome.slot, t));
      await L.sleep(25);
    }
    h.c.send({ t: 'end', matchNo: a.matchNo, result: { i }, runners: [] });
  }
  await L.sleep(300);
  for (const r of rooms) for (const m of r.all) if (m.c.isOpen) m.c.send({ t: 'leave' });
  await L.sleep(600);
  const me = await meter(dev);
  C.ok(me.raw <= 3000 && me.reservedRaw === 0, `after the burst's matches: raw ${me.raw} ≤ 3000, reservations released`);

  // ---------- closed day: new rooms and lobby groups refused ----------
  const pre = await twoRoom(dev); // created while open
  await setMeter(dev, { raw: 3000, units: 0 });
  const nr = new L.Client(`${dev.ws}/room/new?mode=teams&rule=turf&build=${L.enc(L.BUILD)}`, { label: 'closedNew' });
  const ne = await nr.t('err', { failOnClose: false }).catch(() => null);
  const nc = await nr.closed;
  C.eq([ne?.j?.code, nc.code], ['quota', 4030], 'closed day: /room/new → err quota + close 4030');
  const q1 = new L.Client(`${dev.ws}/qm?mode=ffa&rule=washout&build=${L.enc(L.BUILD)}`, { label: 'cq1' });
  const q2 = new L.Client(`${dev.ws}/qm?mode=ffa&rule=washout&build=${L.enc(L.BUILD)}`, { label: 'cq2' });
  await Promise.all([q1.opened, q2.opened]);
  q1.send({ t: 'qm', proto: L.PROTO, build: L.BUILD, ...L.profile(1) });
  q2.send({ t: 'qm', proto: L.PROTO, build: L.BUILD, ...L.profile(2) });
  const qe = await Promise.all([q1, q2].map((q) => q.t('err', { timeout: 5000, failOnClose: false }).catch(() => null)));
  const qc = await Promise.all([q1.closed, q2.closed]);
  C.ok(qe.every((e) => e?.j?.code === 'quota') && qc.every((c) => c.code === 4030), 'closed day: a lobby group → err quota + close 4030');
  const ps = await pressStart(pre);
  C.ok(ps.every((x) => x.t === 'err' && x.code === 'quota'), 'closed day: START in an existing room → err quota');
  await L.sleep(300);
}

export async function runBilling20(dev, C) {
  const h0 = (await L.getJson(`${dev.base}/health`)).body;
  C.ok(h0.mode === 'billing20' && h0.cap === 120 && h0.capRaw === 1, '/health: billing20 mode, cap = DAILY_UNIT_CAP', h0);
  const out = [];
  for (let i = 0; i < 3; i++) {
    const r = await twoRoom(dev);
    out.push(await pressStart(r));
  }
  const ok = out.map((r) => r[0].t);
  C.eq(ok, ['assign', 'assign', 'err'], 'billing20 admits on units (45 each vs cap 120: 2 fit, the 3rd does not); RAW_CAP 1 is not applied');
  const m = await L.devMeter(dev);
  C.ok(m.raw > 1 && m.units > 0, `both counts recorded in billing20 (raw ${m.raw}, units ${m.units})`);
}

// T4: size and rate caps, 4029 close, origin 403, bad query 400 (+ 426 / 404). runPerIp: per-IP caps (suite B).
import * as L from './lib.mjs';

const isBin = (k) => (m) => m.kind === 'bin' && m.b[0] === k && !L.isPulse(m);
const quiet = (c, from, pred, ms = 400) => L.sleep(ms).then(() => !c.msgs.slice(from).some((m) => !L.isPulse(m) && pred(m)));

export async function run(dev, C) {
  // ---- origin + query checks (no DO touched) ----
  const B = L.enc(L.BUILD);
  const up = (path, origin) => L.rawUpgrade(`${dev.ws}${path}`, origin === null ? {} : { Origin: origin });
  C.eq(await up(`/qm?mode=teams&rule=turf&build=${B}`, 'https://evil.example'), 403, 'origin not in the allowlist → 403');
  C.eq(await up(`/qm?mode=teams&rule=turf&build=${B}`, null), 403, 'no Origin header → 403');
  C.eq(await up(`/room/new?mode=teams&rule=turf&build=${B}`, 'http://localhost.evil.com:8080'), 403, 'dev prefix does not match localhost.evil.com → 403');
  C.eq(await up(`/qm?mode=teams&rule=turf&build=${B}`, 'http://localhost:5173'), 101, 'DEV origin http://localhost:<any port> → 101');
  C.eq(await up(`/qm?mode=teams&rule=turf&build=${B}`, 'https://forgeflowgames.com'), 101, 'production origin forgeflowgames.com → 101');
  C.eq(await up(`/qm?mode=teams&rule=turf&build=${B}`, 'https://forgeflow-games-cdn.isimcha85.workers.dev'), 101, 'production origin (CDN) → 101');
  C.eq(await up(`/qm?mode=solo&rule=turf&build=${B}`, L.ORIGIN_OK), 400, 'bad mode → 400');
  C.eq(await up(`/qm?mode=teams&rule=paint&build=${B}`, L.ORIGIN_OK), 400, 'bad rule → 400');
  C.eq(await up(`/room/new?mode=teams&rule=turf&build=bad%20build!`, L.ORIGIN_OK), 400, 'bad build → 400');
  C.eq(await up(`/room/new?mode=teams&rule=turf`, L.ORIGIN_OK), 400, 'missing build → 400');
  C.eq(await up(`/room/new?mode=teams&rule=turf&build=${'x'.repeat(41)}`, L.ORIGIN_OK), 400, 'build longer than 40 → 400');
  const r426 = await fetch(`${dev.base}/qm?mode=teams&rule=turf&build=${B}`);
  C.eq(r426.status, 426, 'plain GET on a WebSocket route → 426');
  const r404 = await fetch(`${dev.base}/nope`);
  C.eq(r404.status, 404, 'unknown path → 404');
  const h = await L.getJson(`${dev.base}/health`);
  C.ok(h.status === 200 && h.body.ok === true && h.headers.get('access-control-allow-origin') === '*', '/health ok with CORS *', h.body);
  // un-encoded '+' in the build (decoded to ' ') is mapped back: the same lobby as the encoded one
  C.eq(await up(`/qm?mode=teams&rule=turf&build=${L.BUILD}`, L.ORIGIN_OK), 101, "un-encoded '+' in build accepted");

  // ---- size caps ----
  const room = await L.roomWith(dev, 3);
  const as = await L.startAndAssign(room);
  const H = room.all.find((m) => m.welcome.slot === as[0].hostSlot);
  const [A, Bc] = room.all.filter((m) => m !== H);
  const stopPulse = L.pulse(H.c);
  let k = [H.c.mark(), A.c.mark(), Bc.c.mark()];
  const big = new Uint8Array(600);
  big[0] = 1;
  big[1] = A.welcome.slot;
  A.c.sendBin(big);
  C.ok(await quiet(H.c, k[0], isBin(1)), 'INTENTS > 512 B dropped');
  const ok512 = new Uint8Array(512);
  ok512[0] = 1;
  ok512[1] = A.welcome.slot;
  A.c.sendBin(ok512);
  const got512 = await H.c.next(isBin(1), { from: k[0], timeout: 3000 }).catch(() => null);
  C.ok(got512?.b.length === 512, 'INTENTS of exactly 512 B relayed');
  k = [H.c.mark(), A.c.mark(), Bc.c.mark()];
  H.c.sendBin(L.snapFrame(1, 64 * 1024));
  C.ok(await quiet(A.c, k[1], isBin(2)), 'SNAP > 64 KB dropped');
  H.c.sendBin(L.snapFrame(2, 64 * 1024 - 6));
  const s64 = await A.c.next(isBin(2), { from: k[1], timeout: 3000 }).catch(() => null);
  C.ok(s64?.b.length === 64 * 1024, 'SNAP of exactly 64 KB relayed');
  H.c.sendBin(L.keyframeFrame(A.welcome.slot, 3, 1_500_000));
  const kf = await A.c.next(isBin(3), { from: k[1], timeout: 5000 }).catch(() => null);
  C.ok(kf?.b.length === 1_500_010, 'KEYFRAME of 1.5 MB relayed');
  await L.sleep(1100);
  k = [H.c.mark(), A.c.mark()];
  H.c.sendBin(L.keyframeFrame(A.welcome.slot, 4, 2 * 1024 * 1024));
  C.ok(await quiet(A.c, k[1], isBin(3), 800), 'KEYFRAME > 2 MB dropped');
  k = [H.c.mark(), A.c.mark(), Bc.c.mark()];
  A.c.send(JSON.stringify({ t: 'set', rttMs: 50, pad: 'x'.repeat(2100) }));
  A.c.send({ t: 'loaded', matchNo: 1, atlasSig: 1, pad: 'y'.repeat(2100) });
  C.ok(await quiet(H.c, k[0], (m) => m.kind === 'text' && m.j?.t === 'loaded'), 'client text > 2 KB dropped');
  H.c.send({ t: 'roster', matchNo: 1, seats: [], roster: [], pad: 'z'.repeat(10_000) });
  const rr = await A.c.t('roster', { from: k[1], timeout: 3000 }).catch(() => null);
  C.ok(rr?.j?.pad?.length === 10_000, 'host text of 10 KB (≤ 64 KB) relayed');

  // ---- rate cap: a client bursting 300 INTENTS → ≈ 60 relayed, the rest dropped, > 200 drops in 10 s → 4029 ----
  k = [H.c.mark(), A.c.mark(), Bc.c.mark()];
  for (let s = 0; s < 300; s++) Bc.c.sendBin(L.intentsFrame(Bc.welcome.slot, s));
  const cl = await Promise.race([Bc.c.closed, L.sleep(5000).then(() => null)]);
  await L.sleep(300);
  const relayed = H.c.msgs.slice(k[0]).filter(isBin(1)).length;
  C.ok(relayed >= 55 && relayed <= 70, `rate cap: ${relayed} of 300 burst INTENTS relayed (bucket 60/s, burst 60)`);
  const errRate = Bc.c.texts('err').find((e) => e.code === 'rate');
  C.ok(cl?.code === 4029 && !!errRate, 'more than 200 drops in 10 s → err rate + close 4029', cl);
  const peerGone = await H.c.next((m) => m.kind === 'text' && m.j?.t === 'peer' && m.j.slot === Bc.welcome.slot && m.j.conn === false, { from: k[0], timeout: 3000 }).catch(() => null);
  C.ok(!!peerGone && peerGone.j.left === false, 'the 4029-closed member shows as disconnected (reconnectable), not left');

  // ---- host rate: 150/s burst 150 ----
  k = [A.c.mark()];
  for (let t = 0; t < 200; t++) H.c.sendBin(L.snapFrame(10_000 + t, 16));
  await L.sleep(800);
  const hs = A.c.msgs.slice(k[0]).filter(isBin(2)).length;
  C.ok(hs >= 145 && hs <= 165, `host rate cap: ${hs} of a 200-SNAP burst relayed (bucket 150/s, burst 150)`);

  stopPulse();
  L.closeAll(room.all);
  await L.sleep(300);
}

/** Suite B (PER_IP_ROOM 2, PER_IP_LOBBY 1): per-address socket caps (DEV `devip` stands in for CF-Connecting-IP). */
export async function runPerIp(dev, C) {
  const B = L.enc(L.BUILD);
  const own = new L.Client(`${dev.ws}/room/new?mode=teams&rule=turf&build=${B}&devip=10.0.0.1`, { label: 'ipA0' });
  await own.opened;
  const w = await L.hello(own, L.profile(0));
  const code = w.room.code;
  const j1 = new L.Client(`${dev.ws}/room/${code}?build=${B}&devip=10.0.0.1`, { label: 'ipA1' });
  await j1.opened;
  const w1 = await L.hello(j1, L.profile(1));
  C.eq(w1.t, 'welcome', 'room: 2nd socket from one address accepted (PER_IP_ROOM 2)');
  const j2 = new L.Client(`${dev.ws}/room/${code}?build=${B}&devip=10.0.0.1`, { label: 'ipA2' });
  await j2.opened;
  const e2 = await j2.t('err', { failOnClose: false }).catch(() => null);
  const c2 = await j2.closed;
  C.eq([e2?.j?.code, c2.code], ['rate', 4029], 'room: 3rd socket from one address refused (err rate, 4029)');
  const j3 = new L.Client(`${dev.ws}/room/${code}?build=${B}&devip=10.0.0.2`, { label: 'ipB' });
  await j3.opened;
  const w3 = await L.hello(j3, L.profile(3));
  C.eq(w3.t, 'welcome', 'room: another address still accepted');

  const q1 = new L.Client(`${dev.ws}/qm?mode=ffa&rule=turf&build=${B}&devip=10.0.0.9`, { label: 'lq1' });
  await q1.opened;
  q1.send({ t: 'qm', proto: L.PROTO, build: L.BUILD, ...L.profile(9) });
  await L.sleep(200);
  const q2 = new L.Client(`${dev.ws}/qm?mode=ffa&rule=turf&build=${B}&devip=10.0.0.9`, { label: 'lq2' });
  await q2.opened;
  const eq2 = await q2.t('err', { failOnClose: false }).catch(() => null);
  const cq2 = await q2.closed;
  C.eq([eq2?.j?.code, cq2.code], ['rate', 4029], 'lobby: 2nd socket from one address refused (PER_IP_LOBBY 1)');
  for (const c of [own, j1, j3, q1]) c.close(4000, 'done');
  await L.sleep(300);
}

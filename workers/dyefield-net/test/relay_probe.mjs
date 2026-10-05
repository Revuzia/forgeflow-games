// Relay-only probe (no sim): drives a real dyefield-net relay — local `wrangler dev` or production — with synthetic
// host/client traffic at the protocol's real rates. Used by T9 (load) and runnable by hand for the deploy stage
// (CONTRACT_ONLINE.md §O12.1 Deploy steps 4–5, §O9.3a step 2):
//
//   node test/relay_probe.mjs --relay ws://127.0.0.1:8790 --clients 8 --seconds 60
//   node test/relay_probe.mjs --relay wss://dyefield-net.isimcha85.workers.dev --origin https://forgeflowgames.com --clients 8 --seconds 60
//   node test/relay_probe.mjs --relay wss://dyefield-net.isimcha85.workers.dev --origin https://forgeflowgames.com --synthetic 20000
//
// Load mode: one CODE room with `clients` humans (host + clients−1). The host sends a SNAP-shaped frame at 20 Hz
// (--snap-bytes, default 1000 B); every client sends an INTENTS frame (45 B) at 20 Hz. Every frame carries its send
// time (performance.now(), one process = one clock), so the one-way relay latency is measured exactly.
// Synthetic mode: 2 sockets and EXACTLY --synthetic incoming frames in total (control frames included).
// Against production it reads /health first and refuses to run when the relay is closed for the day or when the
// run's estimate does not fit the remaining cap (the Room's own admission would refuse it anyway).
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROTO = 1;

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

class Sock {
  constructor(url, origin, label) {
    this.label = label;
    this.msgs = 0;
    this.texts = [];
    this.waiters = [];
    this.onBin = null;
    this.closeInfo = null;
    this.ws = new WebSocket(url, { headers: { Origin: origin } });
    this.ws.binaryType = 'arraybuffer';
    this.opened = new Promise((res) => {
      this.ws.addEventListener('open', () => res(true));
      this.ws.addEventListener('error', () => res(false));
    });
    this.closed = new Promise((res) =>
      this.ws.addEventListener('close', (e) => {
        this.closeInfo = { code: e.code, reason: e.reason };
        res(this.closeInfo);
      }),
    );
    this.ws.addEventListener('message', (e) => {
      const now = performance.now();
      this.msgs++;
      if (typeof e.data === 'string') {
        let j = null;
        try {
          j = JSON.parse(e.data);
        } catch {
          j = null;
        }
        this.texts.push(j);
        for (const w of [...this.waiters])
          if (j && w.pred(j)) {
            this.waiters.splice(this.waiters.indexOf(w), 1);
            clearTimeout(w.timer);
            w.res(j);
          }
      } else if (this.onBin) this.onBin(new Uint8Array(e.data), now);
    });
  }
  wait(pred, timeout = 15000, what = '') {
    const hit = this.texts.find((j) => j && pred(j));
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const w = { pred, res };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        rej(new Error(`${this.label}: timeout waiting for ${what} (close ${JSON.stringify(this.closeInfo)})`));
      }, timeout);
      this.waiters.push(w);
    });
  }
  send(o) {
    if (this.ws.readyState === 1) this.ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  }
  sendBin(b) {
    if (this.ws.readyState === 1) this.ws.send(b);
  }
}

async function health(httpBase) {
  try {
    const r = await fetch(httpBase + '/health');
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Raw-frame estimate for one probe room (both counts), mirroring the Room's admission estimate for a 3:00 match. */
function admissionEstimate(humans) {
  const n = humans;
  const frames = 20 * n * 186;
  const pings = 0.5 * n * 230;
  const other = Math.ceil(5 + 2.5 * n);
  return { raw: Math.ceil(frames + pings + other), units: Math.ceil((frames + pings) / 20) + other };
}

async function openRoom(wsBase, origin, build, n, profileFn) {
  const owner = new Sock(`${wsBase}/room/new?mode=teams&rule=turf&build=${encodeURIComponent(build)}`, origin, 'owner');
  if (!(await owner.opened)) throw new Error('owner socket did not open (origin / URL?)');
  owner.send({ t: 'hello', proto: PROTO, build, ...profileFn(0) });
  const w0 = await owner.wait((j) => j.t === 'welcome' || j.t === 'err', 15000, 'welcome');
  if (w0.t !== 'welcome') throw new Error('create refused: ' + JSON.stringify(w0));
  const code = w0.room.code;
  const socks = [{ s: owner, slot: w0.slot, token: w0.token }];
  for (let i = 1; i < n; i++) {
    const s = new Sock(`${wsBase}/room/${code}?build=${encodeURIComponent(build)}`, origin, 'p' + i);
    if (!(await s.opened)) throw new Error('joiner socket did not open');
    s.send({ t: 'hello', proto: PROTO, build, ...profileFn(i) });
    const w = await s.wait((j) => j.t === 'welcome' || j.t === 'err', 15000, 'welcome');
    if (w.t !== 'welcome') throw new Error('join refused: ' + JSON.stringify(w));
    socks.push({ s, slot: w.slot, token: w.token });
  }
  return { code, socks, owner };
}

async function startRoom(room) {
  room.owner.send({ t: 'start' });
  const as = await Promise.all(room.socks.map((x) => x.s.wait((j) => j.t === 'assign' || (j.t === 'err' && j.code === 'quota'), 15000, 'assign')));
  if (as[0].t !== 'assign') throw new Error('start refused: ' + JSON.stringify(as[0]));
  return as[0];
}

/** Load mode. Returns a stats object; `pass` flags completeness/order. */
export async function loadRun({ relay, origin, clients = 8, seconds = 60, snapBytes = 1000, build = 'dyefield-probe+p1+relay' }) {
  const wsBase = relay.replace(/\/$/, '');
  const httpBase = wsBase.replace(/^ws/, 'http');
  const h0 = await health(httpBase);
  const n = Math.max(2, Math.min(8, clients));
  const profileFn = (i) => ({ name: 'PROBE' + i, kit: 'mist-rasp', crew: i % 2, color: i, device: 'kbm', simMs: 2 + i * 0.01, rttMs: 30 + i });
  const room = await openRoom(wsBase, origin, build, n, profileFn);
  const assign = await startRoom(room);
  const host = room.socks.find((x) => x.slot === assign.hostSlot);
  const cls = room.socks.filter((x) => x !== host);

  // receivers
  const snapLat = [];
  const intLat = [];
  const perClient = new Map(cls.map((c) => [c.slot, { ticks: [], bad: 0 }]));
  const perSender = new Map(cls.map((c) => [c.slot, { seqs: [] }]));
  for (const c of cls) {
    c.s.onBin = (b, now) => {
      if (b[0] !== 2 || b.length < 16) return;
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      perClient.get(c.slot).ticks.push(dv.getUint32(2, true));
      const sent = dv.getFloat64(8, true);
      snapLat.push(now - sent);
      sentAt.snap.push(sent - t0);
      if (now - sent > 20 && spikes.length < 400) spikes.push({ at: Math.round(sent - t0), ms: Math.round(now - sent), k: 'snap' });
    };
  }
  host.s.onBin = (b, now) => {
    if (b[0] !== 1 || b.length < 14) return;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const ps = perSender.get(b[1]);
    if (ps) ps.seqs.push(dv.getUint16(2, true));
    const sent = dv.getFloat64(6, true);
    intLat.push(now - sent);
    sentAt.int.push(sent - t0);
    if (now - sent > 20 && spikes.length < 400) spikes.push({ at: Math.round(sent - t0), ms: Math.round(now - sent), k: 'int' });
  };

  // senders: a catch-up scheduler at 20 Hz (the box may be loaded; frames due are sent, never skipped)
  // The probe's own event-loop delay is measured too: on a loaded box a latency spike that coincides with a stall of
  // this Node process is the test harness, not the relay.
  const eld = monitorEventLoopDelay({ resolution: 5 });
  eld.enable();
  const spikes = [];
  const t0 = performance.now();
  // probe-side stall timeline: a 10 ms ticker; a gap > 60 ms (Windows timers quantize to ~15.6 ms) = this process
  // did not run. Latency samples sent inside a stall window (± 250 ms) are attributable to the harness.
  const stalls = [];
  let lastTick = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    if (now - lastTick > 60) stalls.push({ from: Math.round(lastTick - t0), to: Math.round(now - t0) });
    lastTick = now;
  }, 10);
  const sentAt = { snap: [], int: [] };
  const total = Math.round(seconds * 20);
  let sentSnaps = 0;
  let sentInts = 0;
  let k = 0;
  while (k < total) {
    const due = Math.min(total, Math.floor((performance.now() - t0) / 50) + 1);
    for (; k < due; k++) {
      const snap = new Uint8Array(Math.max(16, snapBytes));
      snap[0] = 2;
      snap[1] = 0xff;
      const dv = new DataView(snap.buffer);
      dv.setUint32(2, 3 * (k + 1), true);
      dv.setFloat64(8, performance.now(), true);
      host.s.sendBin(snap);
      sentSnaps++;
      for (const c of cls) {
        const it = new Uint8Array(45);
        it[0] = 1;
        it[1] = c.slot;
        const di = new DataView(it.buffer);
        di.setUint16(2, (k + 1) & 0xffff, true);
        it[4] = 3;
        di.setFloat64(6, performance.now(), true);
        c.s.sendBin(it);
        sentInts++;
      }
    }
    await sleep(Math.max(1, 50 - ((performance.now() - t0) % 50)));
  }
  const elapsed = (performance.now() - t0) / 1000;
  await sleep(1500);
  eld.disable();
  clearInterval(ticker);
  const inStall = (t) => stalls.some((w) => t >= w.from - 250 && t <= w.to + 250);
  const snapClean = snapLat.filter((_, i) => !inStall(sentAt.snap[i]));
  const intClean = intLat.filter((_, i) => !inStall(sentAt.int[i]));
  // group spikes into episodes (frames within 500 ms of each other)
  spikes.sort((a, b) => a.at - b.at);
  const episodes = [];
  for (const sp of spikes) {
    const e = episodes[episodes.length - 1];
    if (e && sp.at - e.end <= 500) {
      e.end = sp.at;
      e.n++;
      e.maxMs = Math.max(e.maxMs, sp.ms);
    } else episodes.push({ start: sp.at, end: sp.at, n: 1, maxMs: sp.ms });
  }
  for (const e of episodes) e.probeStalled = stalls.some((w) => w.to >= e.start - 500 && w.from <= e.end + 500);

  // end + leave
  host.s.send({ t: 'end', matchNo: assign.matchNo, result: { probe: true }, runners: [], migrations: 0, voided: false });
  await Promise.all(cls.map((c) => c.s.wait((j) => j.t === 'end', 10000, 'end').catch(() => null)));
  for (const x of room.socks) x.s.send({ t: 'leave' });
  await Promise.race([Promise.all(room.socks.map((x) => x.s.closed)), sleep(5000)]);
  await sleep(1500);
  const h1 = await health(httpBase);

  const want = Array.from({ length: total }, (_, i) => 3 * (i + 1));
  const snapComplete = [...perClient.values()].every((p) => p.ticks.length === total && p.ticks.every((t, i) => t === want[i]));
  const intComplete = [...perSender.values()].every(
    (p) => p.seqs.length === total && p.seqs.every((s, i) => s === ((i + 1) & 0xffff)),
  );
  const incoming = sentSnaps + sentInts;
  return {
    relay: wsBase,
    code: room.code,
    t0: Math.round(t0),
    humans: n,
    hostSlot: assign.hostSlot,
    seconds: r2(elapsed),
    sent: { snaps: sentSnaps, intents: sentInts, perSecond: r2(incoming / elapsed) },
    received: {
      snapsPerClient: [...perClient.values()].map((p) => p.ticks.length),
      intentsPerSender: [...perSender.values()].map((p) => p.seqs.length),
    },
    snapComplete,
    intComplete,
    latencyMs: {
      snap: { p50: r2(pct(snapLat, 50)), p90: r2(pct(snapLat, 90)), p99: r2(pct(snapLat, 99)), max: r2(pct(snapLat, 100)), n: snapLat.length },
      intents: { p50: r2(pct(intLat, 50)), p90: r2(pct(intLat, 90)), p99: r2(pct(intLat, 99)), max: r2(pct(intLat, 100)), n: intLat.length },
    },
    probeEventLoopDelayMs: { p50: r2(eld.percentile(50) / 1e6), p99: r2(eld.percentile(99) / 1e6), max: r2(eld.max / 1e6) },
    spikeEpisodes: episodes.slice(0, 20),
    probeStalls: stalls.slice(0, 40),
    latencyExcludingProbeStallsMs: {
      snap: { p50: r2(pct(snapClean, 50)), p99: r2(pct(snapClean, 99)), max: r2(pct(snapClean, 100)), n: snapClean.length },
      intents: { p50: r2(pct(intClean, 50)), p99: r2(pct(intClean, 99)), max: r2(pct(intClean, 100)), n: intClean.length },
    },
    health: {
      before: h0,
      after: h1,
      dRaw: h1?.raw != null && h0?.raw != null && h1.day === h0.day ? h1.raw - h0.raw : null,
      dUnits: h1?.units != null && h0?.units != null && h1.day === h0.day ? h1.units - h0.units : null,
    },
    expected: {
      dataFrames: incoming,
      rawApprox: incoming + 2 * n + 10 + Math.round(0.5 * n * elapsed),
      unitsApprox: Math.round((incoming + 0.5 * n * elapsed) / 20) + n + 8,
    },
  };
}

/** §O9.3a counting check: 2 sockets, EXACTLY `frames` incoming frames in total (control frames included). */
export async function syntheticRun({ relay, origin, frames, build = 'dyefield-probe+p1+relay' }) {
  const wsBase = relay.replace(/\/$/, '');
  const httpBase = wsBase.replace(/^ws/, 'http');
  const h0 = await health(httpBase);
  const control = 6; // hello ×2, start, end, leave ×2
  const data = Math.max(0, frames - control);
  const hostN = Math.round(data * 0.75);
  const cliN = data - hostN;
  const profileFn = (i) => ({ name: 'SYN' + i, kit: 'mist-rasp', crew: i, color: i, device: 'kbm', simMs: 2, rttMs: 30 });
  const room = await openRoom(wsBase, origin, build, 2, profileFn);
  const assign = await startRoom(room);
  const host = room.socks.find((x) => x.slot === assign.hostSlot);
  const cli = room.socks.find((x) => x !== host);
  // host 120/s, client 40/s (under the 150 / 60 caps), in 25 ms steps
  const steps = Math.ceil(Math.max(hostN / 3, cliN / 1));
  let hs = 0;
  let cs = 0;
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < 3 && hs < hostN; j++, hs++) {
      const b = new Uint8Array(16);
      b[0] = 2;
      b[1] = 0xff;
      new DataView(b.buffer).setUint32(2, hs + 1, true);
      host.s.sendBin(b);
    }
    if (cs < cliN) {
      const b = new Uint8Array(45);
      b[0] = 1;
      b[1] = cli.slot;
      b[4] = 3;
      cli.s.sendBin(b);
      cs++;
    }
    const target = t0 + (i + 1) * 25;
    const now = performance.now();
    if (target > now) await sleep(target - now);
  }
  host.s.send({ t: 'end', matchNo: assign.matchNo, result: { probe: true }, runners: [] });
  await cli.s.wait((j) => j.t === 'end', 10000, 'end').catch(() => null);
  for (const x of room.socks) x.s.send({ t: 'leave' });
  await Promise.race([Promise.all(room.socks.map((x) => x.s.closed)), sleep(5000)]);
  await sleep(1500);
  const h1 = await health(httpBase);
  return {
    relay: wsBase,
    code: room.code,
    framesSent: hs + cs + control,
    seconds: r2((performance.now() - t0) / 1000),
    health: { before: h0, after: h1, dRaw: h1?.raw - h0?.raw, dUnits: h1?.units - h0?.units },
    note: 'dRaw/dUnits include this run\'s connections (2), the claim RPC, the Meter RPCs (≈ 5) and the Room\'s ping estimate',
  };
}

// ---------------- CLI ----------------
function args() {
  const a = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true';
      o[k] = v;
    }
  }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = args();
  if (!o.relay) {
    console.log('usage: node test/relay_probe.mjs --relay <ws(s)://host> [--origin <origin>] (--clients N --seconds S | --synthetic FRAMES)');
    process.exit(2);
  }
  const relay = o.relay;
  const prod = relay.startsWith('wss://');
  const origin = o.origin ?? (prod ? 'https://forgeflowgames.com' : 'http://127.0.0.1:5173');
  const httpBase = relay.replace(/^ws/, 'http');
  const h = await health(httpBase);
  console.log('health before:', JSON.stringify(h));
  if (prod) {
    if (!h.ok || h.open === false) {
      console.log('REFUSED: the relay is closed for today (open:false) or unhealthy');
      process.exit(3);
    }
    const n = Number(o.clients ?? 2);
    const need = o.synthetic
      ? { raw: Number(o.synthetic) + 20, units: Math.ceil(Number(o.synthetic) / 20) + 20 }
      : admissionEstimate(n);
    const left = h.cap - h.used - h.reserved;
    const needActive = h.mode === 'strict' ? need.raw : need.units;
    if (needActive > left) {
      console.log(`REFUSED: this run needs ~${needActive} (${h.mode}) but only ${left} remain today`);
      process.exit(3);
    }
  }
  try {
    const res = o.synthetic
      ? await syntheticRun({ relay, origin, frames: Number(o.synthetic) })
      : await loadRun({ relay, origin, clients: Number(o.clients ?? 8), seconds: Number(o.seconds ?? 60), snapBytes: Number(o['snap-bytes'] ?? 1000) });
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  } catch (e) {
    console.log('PROBE FAILED: ' + (e?.stack || e));
    process.exit(1);
  }
}

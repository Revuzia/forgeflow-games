// Test helpers for dyefield-net: start `wrangler dev --local` on 127.0.0.1:8790 with per-suite vars and a fresh
// persistence dir, and drive it with Node 22's global WebSocket (undici; the `headers` option sets Origin).
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const PORT = Number(process.env.DFNET_PORT || 8790);
export const ORIGIN_OK = 'http://127.0.0.1:5173';
export const BUILD = 'dyefield-1.4.0+p1+T3st_b1d';
export const PROTO = 1;

const WRANGLER_JS = [
  process.env.WRANGLER_JS,
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
].find((p) => p && existsSync(p));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts wrangler dev; resolves once /health answers. vars: {KEY: value} → --var KEY:value (overrides .dev.vars). */
export async function startDev(vars = {}, { port = PORT, label = 'dev', cwd = ROOT } = {}) {
  if (!WRANGLER_JS) throw new Error('wrangler.js not found (set WRANGLER_JS)');
  const persist = mkdtempSync(path.join(tmpdir(), 'dfnet-' + label + '-'));
  const args = [
    WRANGLER_JS,
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--persist-to',
    persist,
    '--show-interactive-dev-session=false',
    '--log-level',
    'warn',
  ];
  for (const [k, v] of Object.entries(vars)) args.push('--var', k + ':' + String(v));
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', WRANGLER_SEND_METRICS: 'false' };
  delete env.CLOUDFLARE_API_TOKEN;
  const proc = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  proc.stdout.on('data', (d) => (log += d.toString()));
  proc.stderr.on('data', (d) => (log += d.toString()));
  const base = 'http://127.0.0.1:' + port;
  const t0 = Date.now();
  for (;;) {
    if (proc.exitCode !== null) throw new Error('wrangler dev exited early:\n' + log.slice(-3000));
    try {
      const r = await fetch(base + '/health');
      if (r.status === 200) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > 120_000) {
      killTree(proc.pid);
      throw new Error('wrangler dev did not come up in 120 s:\n' + log.slice(-3000));
    }
    await sleep(400);
  }
  return {
    base,
    ws: 'ws://127.0.0.1:' + port,
    proc,
    log: () => log,
    startMs: Date.now() - t0,
    async stop() {
      killTree(proc.pid);
      await sleep(500);
      try {
        rmSync(persist, { recursive: true, force: true });
      } catch {
        /* workerd may hold files briefly */
      }
    },
  };
}

export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

/** Sends a raw WebSocket upgrade request; resolves with the HTTP status (101 on success). */
export function rawUpgrade(url, headers = {}) {
  return new Promise((resolve) => {
    const u = new URL(url.replace(/^ws/, 'http'));
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
        ...headers,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', (e) => resolve('error:' + e.message));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve('timeout');
    });
    req.end();
  });
}

export async function getJson(url) {
  const r = await fetch(url);
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text), headers: r.headers };
  } catch {
    return { status: r.status, body: text, headers: r.headers };
  }
}

/** A WebSocket test client: queues every message; `next(pred)` waits for the first match. */
export class Client {
  constructor(url, { origin = ORIGIN_OK, label = '' } = {}) {
    this.url = url;
    this.label = label;
    this.msgs = [];
    this.waiters = [];
    this.closeInfo = null;
    this.openErr = null;
    const headers = origin ? { Origin: origin } : {};
    this.ws = new WebSocket(url, { headers });
    this.ws.binaryType = 'arraybuffer';
    this.opened = new Promise((res) => {
      this.ws.addEventListener('open', () => res(true));
      this.ws.addEventListener('error', (e) => {
        this.openErr = e?.message || 'error';
        res(false);
      });
    });
    this.closed = new Promise((res) => {
      this.ws.addEventListener('close', (e) => {
        this.closeInfo = { code: e.code, reason: e.reason, at: Date.now() };
        res(this.closeInfo);
        this._pump();
      });
    });
    this.ws.addEventListener('message', (e) => {
      const at = performance.now();
      let m;
      if (typeof e.data === 'string') {
        try {
          m = { kind: 'text', at, j: JSON.parse(e.data), raw: e.data };
        } catch {
          m = { kind: 'text', at, j: null, raw: e.data };
        }
      } else m = { kind: 'bin', at, b: new Uint8Array(e.data) };
      this.msgs.push(m);
      this._pump();
    });
  }
  _pump() {
    for (const w of [...this.waiters]) {
      const i = this.msgs.findIndex((m, k) => k >= w.from && w.pred(m));
      if (i >= 0) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.res(this.msgs[i]);
      } else if (this.closeInfo && w.failOnClose) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.rej(new Error(`${this.label}: closed ${this.closeInfo.code} ${this.closeInfo.reason} while waiting for ${w.what}`));
      }
    }
  }
  /** Waits for a message matching pred among messages received at index ≥ from (default: all so far). */
  next(pred, { timeout = 8000, from = 0, what = 'message', failOnClose = true } = {}) {
    return new Promise((res, rej) => {
      const w = { pred, from, res, rej, what, failOnClose };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        rej(new Error(`${this.label}: timeout ${timeout} ms waiting for ${what}`));
      }, timeout);
      this.waiters.push(w);
      this._pump();
    });
  }
  /** Waits for a text message {t}. */
  t(t, opts = {}) {
    return this.next((m) => m.kind === 'text' && m.j?.t === t, { what: 't=' + t, ...opts });
  }
  mark() {
    return this.msgs.length;
  }
  texts(t) {
    return this.msgs.filter((m) => m.kind === 'text' && (!t || m.j?.t === t)).map((m) => m.j);
  }
  bins() {
    return this.msgs.filter((m) => m.kind === 'bin');
  }
  send(o) {
    this.ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  }
  sendBin(u8) {
    this.ws.send(u8);
  }
  close(code = 4000, reason = 'test') {
    try {
      this.ws.close(code, reason);
    } catch {
      /* ignore */
    }
  }
  get isOpen() {
    return this.ws.readyState === 1;
  }
}

export function profile(i, extra = {}) {
  return { name: 'P' + i, kit: 'mist-rasp', crew: i % 2, color: i, device: 'kbm', simMs: 2 + i * 0.1, rttMs: 40 + i, ...extra };
}

export async function hello(c, p, extra = {}) {
  const from = c.mark();
  c.send({ t: 'hello', proto: PROTO, build: BUILD, ...p, ...extra });
  return (await c.next((m) => m.kind === 'text' && (m.j?.t === 'welcome' || m.j?.t === 'err'), { from, what: 'welcome' })).j;
}

export function enc(v) {
  return encodeURIComponent(v);
}

/** CREATE ROOM: returns {c, welcome, code}. */
export async function createRoom(dev, { mode = 'teams', rule = 'turf', i = 0, p = {}, build = BUILD } = {}) {
  const c = new Client(`${dev.ws}/room/new?mode=${mode}&rule=${rule}&build=${enc(build)}`, { label: 'owner' + i });
  if (!(await c.opened)) throw new Error('createRoom: socket did not open: ' + c.openErr);
  const w = await hello(c, profile(i, p));
  if (w.t !== 'welcome') throw new Error('createRoom: ' + JSON.stringify(w));
  return { c, welcome: w, code: w.room.code, token: w.token };
}

/** JOIN ROOM by code (optionally reconnect with token / quick ticket). */
export async function joinRoom(dev, code, { i = 1, p = {}, token, ticket, build = BUILD, doHello = true } = {}) {
  let q = `build=${enc(build)}`;
  if (token) q += '&token=' + token;
  if (ticket) q += '&ticket=' + ticket;
  const c = new Client(`${dev.ws}/room/${code}?${q}`, { label: 'p' + i });
  const ok = await c.opened;
  if (!ok) return { c, welcome: null, opened: false };
  if (!doHello) return { c, welcome: null, opened: true };
  const w = await hello(c, profile(i, p)).catch((e) => ({ t: 'error', e: String(e) }));
  return { c, welcome: w, opened: true, token: w?.token };
}

/** Binary frames (§O3.2). */
export function snapFrame(tick, bodyLen = 32, fill = 0) {
  const b = new Uint8Array(6 + bodyLen);
  b[0] = 2;
  b[1] = 0xff;
  new DataView(b.buffer).setUint32(2, tick >>> 0, true);
  for (let i = 6; i < b.length; i++) b[i] = (fill + i) & 0xff;
  return b;
}
export function intentsFrame(slot, seq, n = 3) {
  const b = new Uint8Array(6 + 13 * n);
  b[0] = 1;
  b[1] = slot;
  new DataView(b.buffer).setUint16(2, seq & 0xffff, true);
  b[4] = n;
  return b;
}
export function keyframeFrame(target, tick, bodyLen = 64) {
  const b = new Uint8Array(10 + bodyLen);
  b[0] = 3;
  b[1] = target;
  new DataView(b.buffer).setUint32(2, tick >>> 0, true);
  return b;
}
export function handoffFrame(tick, bodyLen = 128) {
  const b = new Uint8Array(6 + bodyLen);
  b[0] = 4;
  b[1] = 0xff;
  new DataView(b.buffer).setUint32(2, tick >>> 0, true);
  return b;
}
export function tickOf(u8) {
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(2, true);
}

/**
 * A live host sends a SNAP at 20 Hz; without it the Room's stall rule (1.5 s) migrates the host. Tests that drive a
 * host by hand run this heartbeat; its ticks start at PULSE_TICK so checks can ignore them.
 */
export const PULSE_TICK = 5_000_000;
export function pulse(hostClient, everyMs = 50) {
  let t = PULSE_TICK;
  const id = setInterval(() => {
    if (hostClient.isOpen) hostClient.sendBin(snapFrame(t++, 8));
  }, everyMs);
  return () => clearInterval(id);
}
export const isPulse = (m) => m.kind === 'bin' && m.b[0] === 2 && tickOf(m.b) >= PULSE_TICK;

export async function devRoom(dev, code) {
  return (await getJson(`${dev.base}/__dev/room/${code}`)).body;
}
export async function devMeter(dev) {
  return (await getJson(`${dev.base}/__dev/meter`)).body;
}
export async function devLobby(dev, mode, rule, build = BUILD) {
  return (await getJson(`${dev.base}/__dev/lobby?mode=${mode}&rule=${rule}&build=${enc(build)}`)).body;
}

/** Minimal assertion recorder. */
export class Checks {
  constructor(name) {
    this.name = name;
    this.items = [];
  }
  ok(cond, what, detail) {
    this.items.push({ ok: !!cond, what, detail: detail === undefined ? undefined : detail });
    const tag = cond ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${this.name}: ${what}${detail !== undefined && !cond ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`);
    return !!cond;
  }
  eq(a, b, what) {
    return this.ok(JSON.stringify(a) === JSON.stringify(b), what, { got: a, want: b });
  }
  async step(what, fn) {
    try {
      return await fn();
    } catch (e) {
      this.ok(false, what + ' (threw)', String(e?.stack || e).slice(0, 600));
      return undefined;
    }
  }
  get passed() {
    return this.items.every((x) => x.ok);
  }
  summary() {
    return { name: this.name, passed: this.passed, n: this.items.length, failed: this.items.filter((x) => !x.ok) };
  }
}

/** Starts a code room with n humans (owner + n−1 joiners), all helloed. */
export async function roomWith(dev, n, opts = {}) {
  const owner = await createRoom(dev, { i: 0, ...opts, p: { ...(opts.profiles?.[0] ?? {}) } });
  const all = [owner];
  for (let i = 1; i < n; i++) {
    const j = await joinRoom(dev, owner.code, { i, p: { ...(opts.profiles?.[i] ?? {}) } });
    if (j.welcome?.t !== 'welcome') throw new Error('join ' + i + ' failed: ' + JSON.stringify(j.welcome));
    all.push(j);
  }
  return { code: owner.code, all, owner };
}

/** Owner presses START; resolves with every member's `assign`. */
export async function startAndAssign(room) {
  const marks = room.all.map((m) => m.c.mark());
  room.owner.c.send({ t: 'start' });
  const assigns = await Promise.all(room.all.map((m, k) => m.c.t('assign', { from: marks[k], timeout: 10000 })));
  return assigns.map((a) => a.j);
}

export function closeAll(list) {
  for (const x of list) x?.c?.close?.(4000, 'done');
}

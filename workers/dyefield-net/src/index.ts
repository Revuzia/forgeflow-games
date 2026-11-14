// dyefield-net — the stateless Worker in front of the DYEFIELD relay (CONTRACT_ONLINE.md §O2.2).
//   GET  /health                          → Meter.status() (CORS *)
//   WS   /qm?mode=&rule=&build=           → Lobby "qm:<mode>:<rule>:<build>"
//   WS   /room/new?mode=&rule=&build=     → claim a fresh code (≤ 3 tries), then the Room as its owner
//   WS   /room/<CODE>?build=&token=&ticket= → Room <CODE> (join, reconnect, quick-match entry)
// Every upgrade is origin-checked FIRST (403, no DO touched); bad query values → 400. The Worker only parses the URL
// and forwards: its CPU stays far below the Free plan's 10 ms per request.
import { isDev, num, timing, type Env } from './env';
import { BUILD_RE, CLOSE_QUOTA, CLOSE_TRY_LATER, DEFAULTS, PROTO, WORKER_VERSION, isMode, isRule, normCode } from './proto';
import { locationHintFor, originAllowed, randomCode, refuseSocket } from './util';
import type { MeterStatus } from './meter';

export { Lobby } from './lobby';
export { Room } from './room';
export { Meter } from './meter';

// per-isolate meter status cache (blunts a /health flood; /room/new uses the longer STATUS_CACHE_MS)
let statusCache: { at: number; s: MeterStatus } | null = null;

async function meterStatus(env: Env, maxAgeMs: number): Promise<MeterStatus> {
  const now = Date.now();
  if (statusCache && now - statusCache.at < maxAgeMs) return statusCache.s;
  const s = await env.METER.get(env.METER.idFromName('meter')).status();
  statusCache = { at: now, s };
  return s;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

function bad(msg: string): Response {
  return new Response(msg, { status: 400 });
}

function cfOf(req: Request): { continent?: unknown; longitude?: unknown } | undefined {
  return (req as Request & { cf?: { continent?: unknown; longitude?: unknown } }).cf;
}

/** The headers the DOs read; always set here (a client cannot inject them: DOs are reachable only via this Worker). */
function forwardHeaders(req: Request, hint: string, env: Env): Headers {
  const h = new Headers(req.headers);
  h.set('x-df-ip', req.headers.get('CF-Connecting-IP') ?? '');
  const cont = cfOf(req)?.continent;
  h.set('x-df-continent', typeof cont === 'string' ? cont : '');
  h.set('x-df-hint', hint);
  if (isDev(env)) {
    // local tests only: every client is 127.0.0.1 with one mocked request.cf
    const u = new URL(req.url);
    const ip = u.searchParams.get('devip');
    const dc = u.searchParams.get('devcont');
    if (ip) h.set('x-df-ip', ip.slice(0, 64));
    if (dc) h.set('x-df-continent', dc.slice(0, 2));
  }
  return h;
}

/** Codes for /room/new: random, or (DEV only) the `devcode` list, to exercise collision retries. */
function codeSource(u: URL, env: Env): () => string {
  const list = isDev(env)
    ? (u.searchParams.get('devcode') ?? '')
        .split(',')
        .map((s) => normCode(s.trim()))
        .filter((s): s is string => !!s)
    : [];
  let i = 0;
  return () => (i < list.length ? list[i++] : randomCode());
}

function buildParam(u: URL): string | null {
  // '+' arrives as ' ' when the client did not encodeURIComponent the build; builds never contain spaces.
  const b = (u.searchParams.get('build') ?? '').replace(/ /g, '+');
  return BUILD_RE.test(b) ? b : null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url);
    const path = u.pathname;

    if (path === '/health') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      try {
        const s = await meterStatus(env, timing(env, 'HEALTH_CACHE_MS'));
        return json({ ok: true, proto: num(env, 'PROTO', PROTO), version: WORKER_VERSION, ...s }, 200, CORS);
      } catch (e) {
        return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, 503, CORS);
      }
    }

    if (path.startsWith('/__dev/')) {
      if (!isDev(env)) return new Response('not found', { status: 404 });
      return devRoute(req, env, u);
    }

    const isWs = req.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    const roomMatch = /^\/room\/([^/]+)$/.exec(path);
    if (path !== '/qm' && !roomMatch) return new Response('not found', { status: 404 });
    if (!isWs) return new Response('expected a WebSocket upgrade', { status: 426 });
    if (!originAllowed(env, req.headers.get('Origin'))) return new Response('origin not allowed', { status: 403 });

    const hint = locationHintFor(cfOf(req));

    if (path === '/qm') {
      const mode = u.searchParams.get('mode');
      const rule = u.searchParams.get('rule');
      const build = buildParam(u);
      if (!isMode(mode) || !isRule(rule) || !build) return bad('bad mode, rule or build');
      const name = 'qm:' + mode + ':' + rule + ':' + build;
      const stub = env.LOBBY.get(env.LOBBY.idFromName(name), { locationHint: hint });
      const q = new URLSearchParams({ mode, rule, build, lobby: name });
      return stub.fetch(new Request('https://lobby/ws?' + q.toString(), { headers: forwardHeaders(req, hint, env) }));
    }

    const seg = roomMatch![1];
    if (seg === 'new') {
      const mode = u.searchParams.get('mode');
      const rule = u.searchParams.get('rule');
      const build = buildParam(u);
      if (!isMode(mode) || !isRule(rule) || !build) return bad('bad mode, rule or build');
      try {
        const s = await meterStatus(env, timing(env, 'STATUS_CACHE_MS'));
        if (!s.open) return refuseSocket(CLOSE_QUOTA, 'quota', 'Online is full for today — play vs bots');
      } catch {
        /* the Room's admission at start is the binding check */
      }
      const nextCode = codeSource(u, env);
      for (let i = 0; i < 3; i++) {
        const code = nextCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code), { locationHint: hint });
        let r: { ok: boolean; ownerKey?: string } | null = null;
        try {
          r = await stub.claim({ code, quick: false, mode, rule, build });
        } catch {
          r = null;
        }
        if (r?.ok && r.ownerKey) {
          const q = new URLSearchParams({ code, build, ownerKey: r.ownerKey });
          return stub.fetch(new Request('https://room/ws?' + q.toString(), { headers: forwardHeaders(req, hint, env) }));
        }
      }
      return refuseSocket(CLOSE_TRY_LATER, 'busy', 'Could not open a room — try again');
    }

    const code = normCode(seg);
    const build = buildParam(u);
    if (!code || !build) return bad('bad room code or build');
    const q = new URLSearchParams({ code, build });
    const token = u.searchParams.get('token');
    const ticket = u.searchParams.get('ticket');
    if (token) q.set('token', token);
    if (ticket) q.set('ticket', ticket);
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    return stub.fetch(new Request('https://room/ws?' + q.toString(), { headers: forwardHeaders(req, hint, env) }));
  },
} satisfies ExportedHandler<Env>;

/** DEV-only read-backs and controls for the T1–T10 tests (404 unless DEV = "1", i.e. local wrangler dev). */
async function devRoute(req: Request, env: Env, u: URL): Promise<Response> {
  const p = u.pathname.split('/').filter(Boolean); // ['__dev', ...]
  try {
    if (p[1] === 'env') {
      const keys = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];
      return json({
        timing: Object.fromEntries(keys.map((k) => [k, timing(env, k)])),
        COUNT_MODE: env.COUNT_MODE,
        RAW_CAP: env.RAW_CAP,
        DAILY_UNIT_CAP: env.DAILY_UNIT_CAP,
        PER_IP_ROOM: env.PER_IP_ROOM,
        PER_IP_LOBBY: env.PER_IP_LOBBY,
        DEV_QUICK_DURATION_S: env.DEV_QUICK_DURATION_S ?? null,
        ip: req.headers.get('CF-Connecting-IP'),
        cf: cfOf(req) ? { continent: cfOf(req)?.continent ?? null, longitude: cfOf(req)?.longitude ?? null } : null,
      });
    }
    if (p[1] === 'meter') {
      const m = env.METER.get(env.METER.idFromName('meter'));
      if (p[2] === 'set') {
        const g = (k: string) => (u.searchParams.has(k) ? Number(u.searchParams.get(k)) : undefined);
        return json(await m.devSet({ units: g('units'), raw: g('raw'), reservedUnits: g('reservedUnits'), reservedRaw: g('reservedRaw') }));
      }
      statusCache = null;
      return json(await m.status());
    }
    if (p[1] === 'room' && p[2]) {
      const code = normCode(p[2]);
      if (!code) return bad('code');
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      return json(await stub.debug());
    }
    if (p[1] === 'lobby') {
      const mode = u.searchParams.get('mode') ?? 'teams';
      const rule = u.searchParams.get('rule') ?? 'turf';
      const build = buildParam(u) ?? '';
      const stub = env.LOBBY.get(env.LOBBY.idFromName('qm:' + mode + ':' + rule + ':' + build));
      return json(await stub.debug());
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
  return new Response('not found', { status: 404 });
}

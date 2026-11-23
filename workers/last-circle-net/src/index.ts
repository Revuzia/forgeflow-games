// last-circle-net — the stateless Worker in front of the Last Circle friends-room relay.
//   GET /health                 -> today's meter (CORS *)
//   WS  /room/new?id=<peer>     -> claim a fresh 4-character code (<= 4 tries), open the creator's socket as owner
//   WS  /room/<CODE>?id=<peer>  -> join (or rejoin) that room
// Every upgrade is origin-checked first (403, no Durable Object touched). New rooms are refused (close 4029) once
// the daily meter is full; rooms already open keep running.
import { CLOSE_QUOTA, CLOSE_TRY_LATER, PEER_RE, isDev, normCode, originAllowed, randomCode, type Env } from './env';
import type { MeterStatus } from './meter';

export { Room } from './room';
export { Meter } from './meter';

let statusCache: { at: number; s: MeterStatus } | null = null;
async function meterStatus(env: Env, maxAgeMs: number): Promise<MeterStatus> {
  const now = Date.now();
  if (statusCache && now - statusCache.at < maxAgeMs) return statusCache.s;
  const s = await env.METER.get(env.METER.idFromName('meter')).status();
  statusCache = { at: now, s };
  return s;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' };

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

/** Refuse an upgrade with a close code the client can read (a plain 4xx is opaque to a browser WebSocket). */
function refuseSocket(code: number, why: string): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify({ k: 'err', code, why }));
  pair[1].close(code, why);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url);
    const path = u.pathname;

    if (path === '/health') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      try {
        return json({ ok: true, ...(await meterStatus(env, isDev(env) ? 0 : 2000)) }, 200, CORS);
      } catch (e) {
        return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, 503, CORS);
      }
    }

    if (path.startsWith('/__dev/')) {
      if (!isDev(env)) return new Response('not found', { status: 404 });
      const p = path.split('/').filter(Boolean);
      if (p[1] === 'meter') {
        const m = env.METER.get(env.METER.idFromName('meter'));
        statusCache = null;
        if (p[2] === 'set') return json(await m.devSet(Number(u.searchParams.get('msgs') ?? 0), Number(u.searchParams.get('conns') ?? 0)));
        return json(await m.status());
      }
      if (p[1] === 'room' && p[2]) {
        const code = normCode(p[2]);
        if (!code) return new Response('code', { status: 400 });
        return json(await env.ROOM.get(env.ROOM.idFromName(code)).debug());
      }
      return new Response('not found', { status: 404 });
    }

    const m = /^\/room\/([^/]+)$/.exec(path);
    if (!m) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a WebSocket upgrade', { status: 426 });
    if (!originAllowed(env, req.headers.get('Origin'))) return new Response('origin not allowed', { status: 403 });
    const id = u.searchParams.get('id') ?? '';
    if (!PEER_RE.test(id)) return new Response('bad id', { status: 400 });

    if (m[1] === 'new') {
      try {
        const s = await meterStatus(env, isDev(env) ? 0 : 30e3);
        if (!s.open) return refuseSocket(CLOSE_QUOTA, 'full today');
      } catch {
        /* meter unreachable: let the room open */
      }
      for (let i = 0; i < 4; i++) {
        const code = randomCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        let ok = false;
        try {
          ok = await stub.claim(code);
        } catch {
          ok = false;
        }
        if (ok) {
          const q = new URLSearchParams({ id, code, owner: '1' });
          return stub.fetch(new Request('https://room/ws?' + q.toString(), { headers: req.headers }));
        }
      }
      return refuseSocket(CLOSE_TRY_LATER, 'busy');
    }

    const code = normCode(decodeURIComponent(m[1]));
    if (!code) return refuseSocket(4004, 'no such room');
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const q = new URLSearchParams({ id, code });
    return stub.fetch(new Request('https://room/ws?' + q.toString(), { headers: req.headers }));
  },
} satisfies ExportedHandler<Env>;

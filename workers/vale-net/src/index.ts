// vale-net — the stateless Worker in front of the VALE game server (games/vale/src/contracts/net.ts).
//   GET /health   → the hub's counts and today's usage (CORS *)
//   WS  /ws       → the one ValeHub Durable Object (matchmaking, friend rooms, matches)
// Every upgrade is origin-checked FIRST (403, no DO touched). The client's ?server= / VALE_CONFIG.server points at
// wss://vale-net.<subdomain>.workers.dev/ws.
import type { Env } from './env.ts';

export { ValeHub } from './hub_do.ts';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' };

function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  const exact = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (exact.includes(origin)) return true;
  if (env.DEV !== '1') return false;
  // local runs: scheme+host on any port (http://localhost:5190 matches http://localhost; http://localhost.evil.com does not)
  const loose = (env.DEV_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return loose.some((o) => origin === o || origin.startsWith(`${o}:`));
}

function hub(env: Env): DurableObjectStub {
  return env.HUB.get(env.HUB.idFromName('hub'));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (u.pathname === '/health') {
      const r = await hub(env).fetch('https://hub/health');
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } });
    }
    if (u.pathname === '/ws') {
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
      // Node's WebSocket (the harness) sends no Origin: allowed only in DEV
      const origin = req.headers.get('Origin');
      if (!(origin === null && env.DEV === '1') && !originAllowed(origin, env)) return new Response('origin not allowed', { status: 403 });
      const h = new Headers(req.headers);
      h.set('x-vale-ip', req.headers.get('CF-Connecting-IP') ?? '');
      return hub(env).fetch(new Request('https://hub/ws', { headers: h }));
    }
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

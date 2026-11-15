// A/B baseline for T9 (local only, never deployed): the thinnest possible hibernating relay — no validation, no
// rate buckets, no meter, no state — that speaks just enough of the room protocol for relay_probe.mjs's load mode.
// If its latency spikes line up in time with dyefield-net's on the same box, the spikes are the environment.
import { DurableObject } from 'cloudflare:workers';

export class Base extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.next = 0;
  }
  async fetch() {
    const pair = new WebSocketPair();
    const slot = this.next++;
    this.ctx.acceptWebSocket(pair[1], ['s' + slot]);
    pair[1].serializeAttachment({ slot });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws, msg) {
    const me = ws.deserializeAttachment().slot;
    if (typeof msg === 'string') {
      const o = JSON.parse(msg);
      if (o.t === 'hello') ws.send(JSON.stringify({ t: 'welcome', slot: me, token: 'x', room: { code: 'BASE' } }));
      else if (o.t === 'start') for (const w of this.ctx.getWebSockets()) w.send(JSON.stringify({ t: 'assign', matchNo: 1, hostSlot: 0 }));
      else if (o.t === 'end') for (const w of this.ctx.getWebSockets()) if (w !== ws) w.send(msg);
      else if (o.t === 'leave') ws.close(4000, 'leave');
      return;
    }
    const kind = new Uint8Array(msg, 0, 1)[0];
    if (kind === 1) for (const w of this.ctx.getWebSockets('s0')) w.send(msg);
    else if (kind === 2) for (const w of this.ctx.getWebSockets()) if (w !== ws) w.send(msg);
  }
  async webSocketClose(ws) {
    try {
      ws.close(1000, 'bye');
    } catch {
      /* closed */
    }
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/health') return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    return env.BASE.get(env.BASE.idFromName('BASE')).fetch(req);
  },
};

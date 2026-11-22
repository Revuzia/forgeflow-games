// VALE server — the hub on Node: a `ws` WebSocket server in front of HubCore (server/hub_core.ts), which holds the
// matchmaker, the friend rooms and the match rooms (CONTRACT §7.2). workers/vale-net runs the same HubCore on Cloudflare.

import { WebSocketServer } from 'ws';
import { HubCore, type HubOptions } from './hub_core.ts';

export type { HubOptions } from './hub_core.ts';

export class Hub extends HubCore {
  readonly wss: WebSocketServer;
  constructor(o: HubOptions & { port: number; host?: string }) {
    super(o);
    this.wss = new WebSocketServer({ port: o.port, host: o.host });
    this.wss.on('connection', (ws) => {
      const conn = this.connect({ send: (t) => ws.send(t), close: () => ws.close(), get open() { return ws.readyState === ws.OPEN; } });
      let done = false;
      const closed = (): void => { if (!done) { done = true; conn.closed(); } };
      ws.on('message', (data) => conn.message(String(data)));
      ws.on('close', closed);
      ws.on('error', closed);
    });
  }

  get port(): number { const a = this.wss.address(); return typeof a === 'object' && a ? a.port : 0; }

  override close(): Promise<void> {
    super.close();
    return new Promise((r) => this.wss.close(() => r()));
  }
}

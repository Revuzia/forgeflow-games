// ValeHub — the one Durable Object behind vale-net. It runs the VALE game server's own logic (HubCore,
// games/vale/server/hub_core.ts: matchmaking, friend rooms, server-side drafts, lockstep matches with the authoritative
// sim) over Cloudflare WebSockets, exactly as server/hub.ts runs it over Node's `ws`.
//
// CATALOG PER VERSION. A player's first message is `hello` with the catalog version their game loaded. The hub loads
// that catalog (R2 in production: <CATALOG_PREFIX><version>/catalog.json in the game CDN's bucket; CATALOG_URL over
// HTTP in local runs) and keeps one HubCore per version, so players on the same release meet and a content release
// needs no redeploy here. During a rollout, old and new versions simply match among themselves.
//
// BUDGET (Workers Free, shared with dyefield-net). Incoming socket messages are counted per UTC day; past DAILY_MSG_CAP
// new players are refused at hello (their game then plays every queue offline, as with no server). Open sockets are
// capped per IP. The hub's clocks stop when nobody is connected, so an idle hub sleeps.
import { DurableObject } from 'cloudflare:workers';
import { Catalog, type CatalogT } from '../../../games/vale/src/contracts/catalog.ts';
import { HubCore, type HubConnection } from '../../../games/vale/server/hub_core.ts';
import { num, type Env } from './env.ts';

const VERSION_RE = /^\d{4}\.\d{1,3}\.\d{1,4}$/;
/** how often the day's message count is written to storage (it is also written when the day turns) */
const PERSIST_MS = 30_000;

interface Usage { day: string; msgs: number; refused: number }
const today = (): string => new Date().toISOString().slice(0, 10);

export class ValeHub extends DurableObject<Env> {
  private readonly cores = new Map<string, Promise<HubCore>>();
  private readonly perIp = new Map<string, number>();
  private usage: Usage = { day: today(), msgs: 0, refused: 0 };
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const u = await ctx.storage.get<Usage>('usage');
      if (u && u.day === today()) this.usage = u;
    });
  }

  private log(m: string): void { console.log(`[vale-net] ${m}`); }

  // ── usage ─────────────────────────────────────────────────────────────────────────────────────────
  private count(): void {
    const d = today();
    if (this.usage.day !== d) { this.usage = { day: d, msgs: 0, refused: 0 }; void this.persist(); }
    this.usage.msgs++;
    if (!this.persistTimer) this.persistTimer = setTimeout(() => { this.persistTimer = null; void this.persist(); }, PERSIST_MS);
  }
  private async persist(): Promise<void> { try { await this.ctx.storage.put('usage', this.usage); } catch { /* next time */ } }
  private overCap(): boolean { return this.usage.day === today() && this.usage.msgs >= num(this.env.DAILY_MSG_CAP, 1_200_000); }

  // ── catalogs ──────────────────────────────────────────────────────────────────────────────────────
  private async loadCatalog(version: string): Promise<CatalogT> {
    let text: string | null = null;
    if (this.env.CATALOG_URL) {
      const r = await fetch(`${this.env.CATALOG_URL}${version}/catalog.json`);
      if (r.ok) text = await r.text();
    } else if (this.env.GAMES) {
      const o = await this.env.GAMES.get(`${this.env.CATALOG_PREFIX ?? 'vale/catalog/schema-1/'}${version}/catalog.json`);
      if (o) text = await o.text();
    }
    if (text === null) throw new Error(`no catalog ${version}`);
    return Catalog.parse(JSON.parse(text));
  }

  private core(version: string): Promise<HubCore> {
    let p = this.cores.get(version);
    if (!p) {
      p = this.loadCatalog(version).then((catalog) => {
        this.log(`catalog ${version} loaded`);
        // local test runs only (DEV=1): a faster clock (`--var SPEED:16`), as the Node harness uses
        const dev = this.env.DEV === '1';
        return new HubCore({
          catalog, waitSeconds: dev && this.env.WAIT_S ? num(this.env.WAIT_S, 8) : undefined, speed: dev ? num(this.env.SPEED, 1) : 1,
          friendTicketSeconds: dev ? num(this.env.FRIEND_TICKET_S, 6) : 6, log: (m) => this.log(`${version} ${m}`),
        });
      });
      p.catch((err) => { this.log(`catalog ${version}: ${String(err)}`); this.cores.delete(version); });
      this.cores.set(version, p);
    }
    return p;
  }

  // ── requests ──────────────────────────────────────────────────────────────────────────────────────
  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname === '/health') {
      const versions: Record<string, unknown> = {};
      for (const [v, p] of this.cores) {
        const core = await Promise.race([p, Promise.resolve(null)]).catch(() => null);
        versions[v] = core ? core.load : 'loading';
      }
      return Response.json({ ok: true, version: 'vale-net/1.0.0', day: this.usage.day, msgs: this.usage.msgs, refused: this.usage.refused, cap: num(this.env.DAILY_MSG_CAP, 1_200_000), open: !this.overCap(), versions });
    }
    if (u.pathname !== '/ws') return new Response('not found', { status: 404 });

    const ip = req.headers.get('x-vale-ip') ?? '';
    if ((this.perIp.get(ip) ?? 0) >= num(this.env.PER_IP, 6)) return new Response('too many connections', { status: 429 });
    const pair = new WebSocketPair();
    const [client, ws] = [pair[0], pair[1]];
    ws.accept();
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);

    const sock = { send: (t: string) => ws.send(t), close: () => { try { ws.close(1000, 'bye'); } catch { /* closed */ } }, get open() { return ws.readyState === WebSocket.READY_STATE_OPEN; } };
    let conn: HubConnection | null = null;
    let waiting: string[] | null = null;   // messages that arrive while the catalog loads
    let gone = false;
    const refuse = (m: string): void => { try { ws.send(JSON.stringify({ t: 'error', m })); } catch { /* closed */ } sock.close(); };

    ws.addEventListener('message', (ev) => {
      if (gone) return;
      this.count();
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
      if (conn) { conn.message(text); return; }
      if (waiting) { if (waiting.length < 32) waiting.push(text); return; }
      // the first message picks the catalog: it must be hello
      let hello: { t?: unknown; catalog?: unknown };
      try { hello = JSON.parse(text) as typeof hello; } catch { refuse('bad message'); return; }
      if (hello.t !== 'hello' || typeof hello.catalog !== 'string' || !VERSION_RE.test(hello.catalog)) { refuse('say hello first'); return; }
      if (this.overCap()) { this.usage.refused++; refuse('Online play is full for today. Your games play offline until tomorrow.'); return; }
      waiting = [text];
      this.core(hello.catalog).then((core) => {
        if (gone) return;
        conn = core.connect(sock);
        const q = waiting ?? [];
        waiting = null;
        for (const t of q) conn.message(t);
      }, () => {
        if (!gone) refuse(`content ${String(hello.catalog)} is not on the server: reload the game`);
      });
    });
    const closed = (): void => {
      if (gone) return;
      gone = true;
      // answer the player's close: unlike Node's ws, a Cloudflare socket does not, and the player's game would wait
      // on a half-closed socket instead of reconnecting (and resuming its seat)
      try { ws.close(1000, 'bye'); } catch { /* already closed */ }
      const n = (this.perIp.get(ip) ?? 1) - 1;
      if (n > 0) this.perIp.set(ip, n); else this.perIp.delete(ip);
      conn?.closed();
    };
    ws.addEventListener('close', closed);
    ws.addEventListener('error', closed);
    return new Response(null, { status: 101, webSocket: client });
  }
}

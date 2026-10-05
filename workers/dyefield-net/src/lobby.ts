// Lobby DO (§O2.4): one instance per quick-match queue, idFromName("qm:" + mode + ":" + rule + ":" + build).
// Players connect, send `qm`, and wait. Groups launch at 8 humans, or with ≥ 2 humans once QM_FILL_WAIT_S passed since
// the group's 2nd human joined or QM_MAX_WAIT_S since its 1st. Same-continent players are grouped first; a player who
// waited QM_FILL_WAIT_S is grouped with anyone. A lone player gets `solo` after QM_SOLO_WAIT_S (and keeps waiting).
// Launch = one quick Room claimed with one ticket per member, then `matched {code, ticket}` to each.
// Late fill (SHOULD): a live quick room reports its open seats here (roomOpen RPC); a newcomer is routed straight into
// it (Room.reserve) when ≥ LATE_JOIN_MIN_LEFT_S remain.
// The queue lives in memory and in socket attachments (rebuilt after a wake). setTimeout runs only while someone waits,
// so an empty Lobby hibernates.
import { DurableObject } from 'cloudflare:workers';
import { num, timing, type Env } from './env';
import {
  ABUSE_DROPS,
  ABUSE_WINDOW_MS,
  CAP_TEXT_CLIENT,
  CLOSE_BUILD,
  CLOSE_LEAVE,
  CLOSE_QUOTA,
  CLOSE_RATE,
  CLOSE_TRY_LATER,
  KIT_RE,
  MAX_HUMANS,
  PROTO,
  RATE_LOBBY,
  clampNum,
  isMode,
  isRule,
  sanitizeName,
  type Mode,
  type Rule,
  type Usage,
} from './proto';
import { DropWindow, TokenBucket, randomCode, randomToken, refuseSocket, safeClose, safeSend } from './util';
import type { MeterStatus } from './meter';

interface QAtt {
  qid: string;
  lobby: string;
  mode: Mode;
  rule: Rule;
  build: string;
  ip: string;
  cont: string;
  hint: string;
  connectedAt: number;
  ready: boolean;
  joinedAt: number; // when `qm` arrived
  soloBase: number; // solo timer base (reset by a repeated `qm` = KEEP WAITING)
  soloSent: boolean;
  profile: Record<string, unknown>;
}

interface Q {
  ws: WebSocket;
  a: QAtt;
  launching: boolean;
  bucket: TokenBucket;
  drops: DropWindow;
}

interface OpenRoom {
  open: number;
  endsAt: number;
  at: number;
}

export class Lobby extends DurableObject<Env> {
  private q = new Map<string, Q>();
  private rooms = new Map<string, OpenRoom>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private evalRunning = false;
  private evalAgain = false;
  private lastWaitingSent = -1;
  private status: { at: number; s: MeterStatus } | null = null;
  private accRaw = 0;
  private accUnits = 0;
  private instanceId = randomToken().slice(0, 8);
  private stats = { launched: 0, matched: 0, lateFilled: 0, solo: 0, quotaRefused: 0, claimBusy: 0 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('p', 'P'));
    const now = Date.now();
    for (const ws of ctx.getWebSockets()) {
      let a: QAtt | null = null;
      try {
        a = ws.deserializeAttachment() as QAtt | null;
      } catch {
        a = null;
      }
      if (!a || typeof a.qid !== 'string') {
        safeClose(ws, CLOSE_LEAVE, 'gone');
        continue;
      }
      this.q.set(a.qid, { ws, a, launching: false, bucket: new TokenBucket(RATE_LOBBY, RATE_LOBBY, now), drops: new DropWindow() });
    }
    if (this.q.size) this.schedule(now);
  }

  // ---------------- RPC ----------------

  /** A live quick room's open seats (Room → Lobby on every change; 0 seats or endsAt 0 = remove). */
  roomOpen(code: string, open: number, endsAt: number): void {
    this.accRaw += 1;
    this.accUnits += 1;
    if (open > 0 && endsAt > Date.now()) this.rooms.set(code, { open, endsAt, at: Date.now() });
    else this.rooms.delete(code);
    if (open > 0) void this.evaluate();
  }

  debug(): unknown {
    if (this.env.DEV !== '1') throw new Error('dev only');
    return {
      instanceId: this.instanceId,
      queued: [...this.q.values()].map((x) => ({
        qid: x.a.qid,
        ready: x.a.ready,
        cont: x.a.cont,
        joinedAt: x.a.joinedAt,
        launching: x.launching,
        soloSent: x.a.soloSent,
        name: x.a.profile.name,
      })),
      rooms: Object.fromEntries(this.rooms),
      stats: this.stats,
      acc: { raw: this.accRaw, units: this.accUnits },
      timerAt: this.timerAt,
    };
  }

  // ---------------- sockets ----------------

  async fetch(req: Request): Promise<Response> {
    this.accRaw += 1;
    this.accUnits += 1;
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    const u = new URL(req.url);
    const mode = u.searchParams.get('mode');
    const rule = u.searchParams.get('rule');
    const build = u.searchParams.get('build') ?? '';
    const lobby = u.searchParams.get('lobby') ?? '';
    if (!isMode(mode) || !isRule(rule) || !lobby) return new Response('bad', { status: 400 });
    const ip = req.headers.get('x-df-ip') ?? '';
    const perIp = num(this.env, 'PER_IP_LOBBY', 4);
    if (perIp > 0 && ip && [...this.q.values()].filter((x) => x.a.ip === ip).length >= perIp)
      return refuseSocket(CLOSE_RATE, 'rate', 'Too many connections from your network');
    const now = Date.now();
    const pair = new WebSocketPair();
    const server = pair[1];
    const a: QAtt = {
      qid: randomToken().slice(0, 12),
      lobby,
      mode,
      rule,
      build,
      ip,
      cont: req.headers.get('x-df-continent') ?? '',
      hint: req.headers.get('x-df-hint') ?? 'enam',
      connectedAt: now,
      ready: false,
      joinedAt: 0,
      soloBase: 0,
      soloSent: false,
      profile: {},
    };
    this.ctx.acceptWebSocket(server, ['q']);
    server.serializeAttachment(a);
    this.q.set(a.qid, { ws: server, a, launching: false, bucket: new TokenBucket(RATE_LOBBY, RATE_LOBBY, now), drops: new DropWindow() });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    this.accRaw += 1;
    this.accUnits += 1 / 20;
    const now = Date.now();
    const e = this.entry(ws);
    if (!e) {
      safeClose(ws, CLOSE_LEAVE, 'gone');
      return;
    }
    if (!e.bucket.take(now)) return this.abuse(e, now);
    if (typeof msg !== 'string' || msg.length > CAP_TEXT_CLIENT) return this.abuse(e, now);
    let o: Record<string, unknown> | null = null;
    try {
      const v = JSON.parse(msg);
      o = v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      o = null;
    }
    if (!o || typeof o.t !== 'string') return this.abuse(e, now);
    if (o.t === 'leave') {
      this.drop(e);
      safeClose(ws, CLOSE_LEAVE, 'leave');
      void this.evaluate();
      return;
    }
    if (o.t === 'dbg' && this.env.DEV === '1') {
      safeSend(ws, JSON.stringify({ t: 'dbg', ...(this.debug() as object) }));
      return;
    }
    if (o.t !== 'qm') return this.abuse(e, now);
    if (o.proto !== num(this.env, 'PROTO', PROTO)) {
      safeSend(ws, JSON.stringify({ t: 'err', code: 'proto', msg: 'Update DYEFIELD: reload the page (protocol differs)' }));
      this.drop(e);
      safeClose(ws, CLOSE_BUILD, 'proto');
      return;
    }
    if (o.build !== e.a.build) {
      safeSend(ws, JSON.stringify({ t: 'err', code: 'build', msg: 'Update DYEFIELD: reload the page (version differs)' }));
      this.drop(e);
      safeClose(ws, CLOSE_BUILD, 'build');
      return;
    }
    e.a.profile = {
      name: sanitizeName(o.name),
      kit: typeof o.kit === 'string' && KIT_RE.test(o.kit) ? o.kit : 'mist-rasp',
      crew: Math.round(clampNum(o.crew, 0, 2, 0)),
      color: Math.round(clampNum(o.color, 0, 15, 0)),
      device: o.device === 'touch' ? 'touch' : 'kbm',
      simMs: clampNum(o.simMs, 0, 100, 5),
      rttMs: o.rttMs === null || o.rttMs === undefined ? null : clampNum(o.rttMs, 0, 10_000, 100),
    };
    if (!e.a.ready) {
      e.a.ready = true;
      e.a.joinedAt = now;
    }
    e.a.soloBase = now;
    e.a.soloSent = false;
    this.save(e);
    void this.evaluate();
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _clean: boolean): Promise<void> {
    const e = this.entry(ws);
    if (e) this.drop(e);
    safeClose(ws, 1000, 'bye');
    void this.evaluate();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const e = this.entry(ws);
    if (e) this.drop(e);
    void this.evaluate();
  }

  // ---------------- matching ----------------

  private entry(ws: WebSocket): Q | undefined {
    let a: QAtt | null = null;
    try {
      a = ws.deserializeAttachment() as QAtt | null;
    } catch {
      a = null;
    }
    if (!a) return undefined;
    let e = this.q.get(a.qid);
    if (!e) {
      e = { ws, a, launching: false, bucket: new TokenBucket(RATE_LOBBY, RATE_LOBBY, Date.now()), drops: new DropWindow() };
      this.q.set(a.qid, e);
    }
    e.ws = ws;
    return e;
  }

  private save(e: Q): void {
    try {
      e.ws.serializeAttachment(e.a);
    } catch {
      /* ignore */
    }
  }

  private drop(e: Q): void {
    this.q.delete(e.a.qid);
    if (!this.q.size) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.timerAt = 0;
      void this.flushUsage();
    }
  }

  private abuse(e: Q, now: number): void {
    const n = e.drops.hit(now, ABUSE_WINDOW_MS);
    if (n > Math.min(ABUSE_DROPS, 50)) {
      safeSend(e.ws, JSON.stringify({ t: 'err', code: 'rate', msg: 'Too many messages' }));
      this.drop(e);
      safeClose(e.ws, CLOSE_RATE, 'rate');
    }
  }

  private waiting(): Q[] {
    return [...this.q.values()].filter((x) => x.a.ready && !x.launching).sort((a, b) => a.a.joinedAt - b.a.joinedAt);
  }

  /** Re-runs grouping until stable; serialized (launches await RPCs). */
  private async evaluate(): Promise<void> {
    if (this.evalRunning) {
      this.evalAgain = true;
      return;
    }
    this.evalRunning = true;
    try {
      do {
        this.evalAgain = false;
        await this.evaluateOnce(Date.now());
      } while (this.evalAgain);
    } finally {
      this.evalRunning = false;
    }
    this.sendQueueCounts(Date.now());
    this.schedule(Date.now());
  }

  private async evaluateOnce(now: number): Promise<void> {
    const fill = timing(this.env, 'QM_FILL_WAIT_S') * 1000;
    const max = timing(this.env, 'QM_MAX_WAIT_S') * 1000;
    const solo = timing(this.env, 'QM_SOLO_WAIT_S') * 1000;
    const lateMin = timing(this.env, 'LATE_JOIN_MIN_LEFT_S') * 1000;

    // 1) late fill into live quick rooms with open seats (oldest waiting first)
    for (const e of this.waiting()) {
      const target = [...this.rooms.entries()].find(([, r]) => r.open > 0 && r.endsAt - now >= lateMin);
      if (!target) break;
      const [code, r] = target;
      e.launching = true;
      const ticket = randomToken();
      let ok = false;
      try {
        const res = await this.env.ROOM.get(this.env.ROOM.idFromName(code)).reserve(ticket);
        ok = !!res?.ok;
      } catch {
        ok = false;
      }
      if (ok) {
        r.open--;
        if (r.open <= 0) this.rooms.delete(code);
        this.stats.lateFilled++;
        this.sendMatched(e, code, ticket);
      } else {
        this.rooms.delete(code);
        e.launching = false;
      }
    }

    // 2) grouping
    const handled = new Set<string>();
    for (;;) {
      const W = this.waiting().filter((x) => !handled.has(x.a.qid));
      if (!W.length) return;
      const anchor = W[0];
      const widened = now - anchor.a.joinedAt >= fill;
      const pool = W.filter((x) => x === anchor || (widened ? true : x.a.cont === anchor.a.cont));
      const group = pool.slice(0, MAX_HUMANS);
      let launch = false;
      if (group.length >= MAX_HUMANS) launch = true;
      else if (group.length >= 2) {
        const second = group[1];
        launch = now - second.a.joinedAt >= fill || now - anchor.a.joinedAt >= max;
      }
      if (launch) {
        await this.launch(group, anchor.a.hint);
        continue;
      }
      // not launching this anchor's group: its members wait; a lone player past the solo time is told once
      if (group.length === 1 && !anchor.a.soloSent && now - anchor.a.soloBase >= solo) {
        anchor.a.soloSent = true;
        this.save(anchor);
        this.stats.solo++;
        safeSend(anchor.ws, JSON.stringify({ t: 'solo' }));
      }
      for (const x of group) handled.add(x.a.qid);
    }
  }

  private async launch(group: Q[], hint: string): Promise<void> {
    for (const e of group) e.launching = true;
    const st = await this.meterStatus();
    if (st && !st.open) {
      this.stats.quotaRefused++;
      for (const e of group) {
        safeSend(e.ws, JSON.stringify({ t: 'err', code: 'quota', msg: 'Online is full for today — play vs bots' }));
        this.drop(e);
        safeClose(e.ws, CLOSE_QUOTA, 'quota');
      }
      return;
    }
    const first = group[0].a;
    const tickets = group.map(() => randomToken());
    for (let i = 0; i < 6; i++) {
      const code = randomCode();
      let ok = false;
      try {
        const stub =this.env.ROOM.get(this.env.ROOM.idFromName(code), {
          locationHint: hint as DurableObjectLocationHint,
        });
        const r = await stub.claim({
          code,
          quick: true,
          mode: first.mode,
          rule: first.rule,
          build: first.build,
          tickets,
          lobby: first.lobby,
        });
        ok = !!r?.ok;
      } catch {
        ok = false;
      }
      if (ok) {
        this.stats.launched++;
        group.forEach((e, k) => this.sendMatched(e, code, tickets[k]));
        return;
      }
      this.stats.claimBusy++;
    }
    for (const e of group) {
      safeSend(e.ws, JSON.stringify({ t: 'err', code: 'busy', msg: 'Could not open a room — try again' }));
      this.drop(e);
      safeClose(e.ws, CLOSE_TRY_LATER, 'busy');
    }
  }

  private sendMatched(e: Q, code: string, ticket: string): void {
    this.stats.matched++;
    safeSend(e.ws, JSON.stringify({ t: 'matched', code, ticket }));
    this.drop(e);
    safeClose(e.ws, CLOSE_LEAVE, 'matched');
  }

  private sendQueueCounts(now: number): void {
    const W = this.waiting();
    if (W.length === this.lastWaitingSent) return;
    this.lastWaitingSent = W.length;
    for (const e of W) {
      safeSend(e.ws, JSON.stringify({ t: 'queue', waiting: W.length, waitedS: Math.floor((now - e.a.joinedAt) / 1000) }));
    }
  }

  /** One timer at the next deadline (fill / max / solo) while anyone waits. */
  private schedule(now: number): void {
    const W = this.waiting();
    if (!W.length) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.timerAt = 0;
      return;
    }
    const fill = timing(this.env, 'QM_FILL_WAIT_S') * 1000;
    const max = timing(this.env, 'QM_MAX_WAIT_S') * 1000;
    const solo = timing(this.env, 'QM_SOLO_WAIT_S') * 1000;
    let next = Infinity;
    for (const e of W) {
      for (const t of [e.a.joinedAt + fill, e.a.joinedAt + max, e.a.soloSent ? Infinity : e.a.soloBase + solo]) {
        if (t > now && t < next) next = t;
      }
    }
    if (!Number.isFinite(next)) {
      // every deadline has passed (solo already sent): nothing changes until a join or leave, which re-evaluates.
      // No timer, so a Lobby holding only long-waiting players can hibernate (their state is in the attachments).
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.timerAt = 0;
      return;
    }
    if (this.timer && this.timerAt <= next && this.timerAt > now) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = next;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.timerAt = 0;
        void this.evaluate();
      },
      Math.max(20, next - now + 5),
    );
  }

  // ---------------- meter ----------------

  private takeUsage(): Usage {
    const raw = Math.floor(this.accRaw);
    const units = Math.floor(this.accUnits);
    this.accRaw -= raw;
    this.accUnits -= units;
    return { raw, units };
  }

  /** Cached ≤ STATUS_CACHE_MS; a refresh doubles as the Lobby's usage flush (Meter.add returns the status). */
  private async meterStatus(): Promise<MeterStatus | null> {
    const now = Date.now();
    if (this.status && now - this.status.at < timing(this.env, 'STATUS_CACHE_MS')) return this.status.s;
    const add = this.takeUsage();
    try {
      const s = await this.env.METER.get(this.env.METER.idFromName('meter')).add(add, null);
      this.status = { at: now, s };
      return s;
    } catch {
      this.accRaw += add.raw;
      this.accUnits += add.units;
      return this.status?.s ?? null;
    }
  }

  private async flushUsage(): Promise<void> {
    if (this.accRaw < 1 && this.accUnits < 1) return;
    const add = this.takeUsage();
    try {
      const s = await this.env.METER.get(this.env.METER.idFromName('meter')).add(add, null);
      this.status = { at: Date.now(), s };
    } catch {
      this.accRaw += add.raw;
      this.accUnits += add.units;
    }
  }
}

import { CODE_ALPHABET, CODE_LEN } from './proto';
import type { Env } from './env';

export function randomCode(): string {
  const b = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[b[i] & 31]; // alphabet length is exactly 32
  return s;
}

/** 128-bit random, 32 lowercase hex characters (§O7.2 reconnect token; also quick-match tickets and owner keys). */
export function randomToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function randomU32(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] >>> 0;
}

export function randomInt(n: number): number {
  return randomU32() % n;
}

/** §O2.2 location hint from request.cf. */
export function locationHintFor(cf: { continent?: unknown; longitude?: unknown } | undefined): DurableObjectLocationHint {
  const cont = typeof cf?.continent === 'string' ? cf.continent : '';
  const lon = Number(cf?.longitude);
  switch (cont) {
    case 'NA':
      return Number.isFinite(lon) && lon < -100 ? 'wnam' : 'enam';
    case 'SA':
      return 'sam';
    case 'EU':
      return 'weur';
    case 'AS':
      return 'apac';
    case 'OC':
      return 'oc';
    case 'AF':
      return 'afr';
    default:
      return 'enam';
  }
}

function splitList(v: unknown): string[] {
  return typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/**
 * §O2.2 origin check. ALLOWED_ORIGINS are exact origins. DEV_ORIGINS (local .dev.vars only) are scheme + host
 * entries that match any port ("http://localhost" accepts "http://localhost:5173" but not "http://localhost.evil.com").
 */
export function originAllowed(env: Env, origin: string | null): boolean {
  if (!origin) return false;
  if (splitList(env.ALLOWED_ORIGINS).includes(origin)) return true;
  const dev = splitList(env.DEV_ORIGINS);
  if (!dev.length) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const base = u.protocol + '//' + u.hostname;
  return dev.some((d) => d === base || d === origin);
}

export function safeSend(ws: WebSocket, data: string | ArrayBuffer | ArrayBufferView): boolean {
  try {
    if (ws.readyState !== 1) return false;
    ws.send(data);
    return true;
  } catch {
    return false;
  }
}

export function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason.slice(0, 120));
  } catch {
    /* already closed */
  }
}

/** Accepts a socket only to tell it why it is refused (no hibernation, no DO state), then closes it. */
export function refuseSocket(code: number, err: string, msg: string): Response {
  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  server.send(JSON.stringify({ t: 'err', code: err, msg }));
  server.close(code, err);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

export class TokenBucket {
  tokens: number;
  last: number;
  constructor(
    public rate: number,
    public burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }
  take(now: number): boolean {
    const dt = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/** Drops in a sliding-ish 10 s window (§O8: more than 200 → close 4029). */
export class DropWindow {
  start = 0;
  count = 0;
  total = 0;
  hit(now: number, windowMs: number): number {
    if (now - this.start > windowMs) {
      this.start = now;
      this.count = 0;
    }
    this.count++;
    this.total++;
    return this.count;
  }
}

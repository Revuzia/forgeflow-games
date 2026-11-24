import type { Room } from './room';
import type { Meter } from './meter';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  METER: DurableObjectNamespace<Meter>;
  ALLOWED_ORIGINS?: string;
  DEV_ORIGINS?: string;
  COUNT_MODE?: string;
  RAW_CAP?: string;
  UNIT_CAP?: string;
  MAX_SOCKETS?: string;
  DEV?: string;
  [k: string]: unknown;
}

export function num(env: Env, key: string, dflt: number): number {
  const v = env[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return dflt;
}

export const isDev = (env: Env): boolean => env.DEV === '1';

// 4 characters, no 0/O/1/I/L lookalikes. Same alphabet as the game's old randCode() (31 letters).
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 4;
export const PEER_RE = /^[A-Za-z0-9_-]{4,40}$/;

export function normCode(s: string | null | undefined): string | null {
  const c = String(s ?? '').trim().toUpperCase();
  if (c.length !== CODE_LEN) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

export function randomCode(): string {
  const b = new Uint32Array(CODE_LEN);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}

export const utcDay = (t = Date.now()): string => new Date(t).toISOString().slice(0, 10);

function splitList(v: unknown): string[] {
  return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** ALLOWED_ORIGINS are exact origins. DEV_ORIGINS (local .dev.vars only) match any port of that scheme + host. */
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

// Close codes the client understands (runtime/net/ffg_cfroom.js).
export const CLOSE_NO_ROOM = 4004; // no such code (typo, or the room expired)
export const CLOSE_FULL = 4009; // room has MAX_SOCKETS players already
export const CLOSE_QUOTA = 4029; // online play is full for today (new rooms only)
export const CLOSE_BAD = 4400; // malformed request
export const CLOSE_TRY_LATER = 1013;

import type { Lobby } from './lobby';
import type { Room } from './room';
import type { Meter } from './meter';
import { DEFAULTS, type TimingKey } from './proto';

export interface Env {
  LOBBY: DurableObjectNamespace<Lobby>;
  ROOM: DurableObjectNamespace<Room>;
  METER: DurableObjectNamespace<Meter>;
  ALLOWED_ORIGINS?: string;
  DEV_ORIGINS?: string;
  DAILY_UNIT_CAP?: string;
  COUNT_MODE?: string;
  RAW_CAP?: string;
  PER_IP_ROOM?: string;
  PER_IP_LOBBY?: string;
  PROTO?: string;
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

/** A timing constant from §O16, overridable by a Worker var of the same name (tests use short ones). */
export function timing(env: Env, key: TimingKey): number {
  return num(env, key, DEFAULTS[key]);
}

export function isDev(env: Env): boolean {
  return env.DEV === '1';
}

export type CountMode = 'strict' | 'billing20';
export function countMode(env: Env): CountMode {
  return env.COUNT_MODE === 'billing20' ? 'billing20' : 'strict';
}

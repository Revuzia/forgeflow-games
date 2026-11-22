import type { ValeHub } from './hub_do.ts';

export interface Env {
  HUB: DurableObjectNamespace<ValeHub>;
  /** the game CDN's bucket (absent in local runs, which use CATALOG_URL) */
  GAMES?: R2Bucket;
  ALLOWED_ORIGINS?: string;
  DEV_ORIGINS?: string;
  DEV?: string;
  /** R2 key prefix of the catalogs: <prefix><version>/catalog.json */
  CATALOG_PREFIX?: string;
  /** local runs: HTTP base of the catalogs (<url><version>/catalog.json) */
  CATALOG_URL?: string;
  DAILY_MSG_CAP?: string;
  PER_IP?: string;
  /** DEV only (tests): clock speed, matchmaking wait, friend-ticket wait */
  SPEED?: string;
  WAIT_S?: string;
  FRIEND_TICKET_S?: string;
}

export function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) ? n : dflt;
}

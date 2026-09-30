// HIT PARADE - net/ratings.ts (lane NET). Minimal port of pipeline/engine/runtime/net/ffg_ratings.js:
// the logged-in ForgeFlow player (same-origin Supabase Auth session from the portal) and the idempotent
// SECURITY DEFINER RPC `report_match_result` (Elo + W/L, idempotent by match_id). Online bouts are RATED
// only when BOTH players are signed in and both peers agreed on the sim-derived result (NETCODE 3.6/3.9);
// otherwise unrated. vs-CPU and local versus never report.

import { SUPABASE_ANON_KEY, SUPABASE_JS, SUPABASE_URL } from './netplay.ts';

export const GAME_SLUG = 'hit-parade';

interface AuthClient {
  auth: { getUser(): Promise<{ data: { user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null } }> };
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

let client: AuthClient | null = null;
async function sb(): Promise<AuthClient> {
  if (client) return client;
  const url = SUPABASE_JS;
  const mod = (await import(/* @vite-ignore */ url)) as { createClient?: (u: string, k: string) => unknown; default?: { createClient?: (u: string, k: string) => unknown } };
  const createClient = mod.createClient ?? mod.default?.createClient;
  if (!createClient) throw new Error('supabase-js: createClient missing');
  // default auth options = the portal's localStorage session on the same origin
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY) as AuthClient;
  return client;
}

/** The signed-in player, or null (anonymous players still play online, unrated). */
export async function currentPlayer(): Promise<{ id: string; username: string } | null> {
  try {
    const c = await sb();
    const { data } = await c.auth.getUser();
    const u = data.user;
    if (!u) return null;
    const meta = u.user_metadata ?? {};
    const username = String(meta.username ?? meta.name ?? (u.email ? u.email.split('@')[0] : 'player_' + u.id.slice(0, 8)));
    return { id: u.id, username };
  } catch {
    return null;
  }
}

/**
 * CHANGED(NET) P2: the RPC is defined in supabase/migrations/0004_game_ratings.sql, but a probe of the live project on
 * 2026-09-30 answered HTTP 404 PGRST202 "Could not find the function public.report_match_result(...)" (the migration
 * has not been applied). A missing function is remembered for the page session (one failed call, then no more), and
 * callers treat a null answer as UNRATED. Applying 0004 on the project turns ratings on with no client change.
 */
let rpcMissing = false;
export function ratingsRpcMissing(): boolean { return rpcMissing; }

/** Report an agreed online result. slot 0 = 'white', slot 1 = 'black'. Returns the RPC data or null (not rated). */
export async function reportResult(slot0Id: string, slot1Id: string, winner: -1 | 0 | 1, matchId: string): Promise<unknown> {
  if (!slot0Id || !slot1Id || slot0Id === slot1Id || rpcMissing) return null;
  try {
    const c = await sb();
    const result = winner === 0 ? 'white' : winner === 1 ? 'black' : 'draw';
    const { data, error } = await c.rpc('report_match_result', { p_game: GAME_SLUG, p_white: slot0Id, p_black: slot1Id, p_result: result, p_match_id: matchId });
    if (error) {
      const e = error as { message: string; code?: string };
      if (e.code === 'PGRST202' || /could not find the function/i.test(e.message)) rpcMissing = true;
      console.warn('[ratings] report failed:', e.message);
      return null;
    }
    return data ?? {};
  } catch {
    return null;
  }
}

/**
 * Cosmic Coils — runtime/net/leaderboard.js
 * Global leaderboard over the registry Supabase project (Postgres + PostgREST).
 * Read = public SELECT; submit = the `cc_submit_score` SECURITY DEFINER RPC
 * (anonymous play, so validation is server-side). Everything degrades to null
 * on any error (table not migrated yet, offline, etc.) — the caller then shows
 * device-local records instead. No supabase-js needed; plain fetch.
 */
const SUPA_URL = "https://qkidwgyapmitrdxnavmi.supabase.co";
const SUPA_KEY = "sb_publishable_OY39hagVV9OObItwE2VYoA_YuAu0FPZ";

const HEADERS = { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY };

let _available = null; // null=unknown, true/false once probed

/** fetch the global top `n` runs. Returns [{name,length,biome,mode}] or null. */
export async function fetchTop(n = 20) {
  try {
    const url = `${SUPA_URL}/rest/v1/cc_leaderboard?select=name,length,biome,mode,created_at&order=length.desc&limit=${n}`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) { _available = false; return null; }
    _available = true;
    return await r.json();
  } catch (e) {
    _available = false;
    return null;
  }
}

/** submit a run. Returns {stored, rank} or null on failure. Fire-and-forget safe. */
export async function submit(entry) {
  try {
    const url = `${SUPA_URL}/rest/v1/rpc/cc_submit_score`;
    const r = await fetch(url, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_name: String(entry.name || "Serpent").slice(0, 14),
        p_len: Math.round(entry.len || 0),
        p_biome: entry.biome || "verdant",
        p_mode: entry.mode || "practice",
      }),
    });
    if (!r.ok) { _available = false; return null; }
    _available = true;
    return await r.json();
  } catch (e) {
    _available = false;
    return null;
  }
}

export function isAvailable() { return _available; }

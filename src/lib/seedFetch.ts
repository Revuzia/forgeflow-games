// SERVER-ONLY (build time): reads the published registry for prerender seeds.
// Imported only from +onBeforePrerenderStart hooks, never from components.
import type { Game } from "./supabase";
import { LIST_SEED_FIELDS } from "./seed";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qkidwgyapmitrdxnavmi.supabase.co";
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_OY39hagVV9OObItwE2VYoA_YuAu0FPZ";

let cache: Promise<Game[]> | null = null;

/** Full published rows, fetched once per build and shared by every hook. */
export function fetchPublishedGames(): Promise<Game[]> {
  if (!cache) {
    cache = (async () => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/games?status=eq.published&select=*&order=play_count.desc`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (!r.ok) throw new Error(`registry HTTP ${r.status}`);
      return (await r.json()) as Game[];
    })().catch((e) => {
      console.warn(`[prerender] registry fetch failed (${e?.message || e}); pages will prerender without seeds`);
      return [] as Game[];
    });
  }
  return cache;
}

/** Listing-sized rows (no long description) — keeps each list page's HTML small. */
export function slimGames(rows: Game[]): Game[] {
  return rows.map((g) => {
    const o: Record<string, unknown> = {};
    for (const k of LIST_SEED_FIELDS) o[k] = (g as unknown as Record<string, unknown>)[k] ?? null;
    return { description: null, screenshot_urls: null, controls_keyboard: null, controls_gamepad: null, build_version: null, ...o } as unknown as Game;
  });
}

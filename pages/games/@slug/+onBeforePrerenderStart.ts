// 2026-05-11 — Enumerate all published game slugs from Supabase at build
// time so Vike can pre-render `/games/<slug>/index.html` for each one.
// Without this, direct visits to game URLs fell through Cloudflare Pages's
// SPA catch-all to the pre-rendered HOMEPAGE index.html.
//
// Returns an array of URL paths that Vike will then walk through prerender,
// rendering each as its own static HTML file in dist/client.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qkidwgyapmitrdxnavmi.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_OY39hagVV9OObItwE2VYoA_YuAu0FPZ";

export default async function onBeforePrerenderStart(): Promise<string[]> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/games?status=eq.published&select=slug`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!r.ok) {
      console.warn(`[prerender] Supabase fetch failed (${r.status}); pre-rendering zero game slugs`);
      return [];
    }
    const rows = (await r.json()) as Array<{ slug: string }>;
    const urls = rows.map((row) => `/games/${row.slug}`);
    console.log(`[prerender] Pre-rendering ${urls.length} game slugs`);
    return urls;
  } catch (e) {
    console.warn(`[prerender] error enumerating slugs:`, e);
    return [];
  }
}

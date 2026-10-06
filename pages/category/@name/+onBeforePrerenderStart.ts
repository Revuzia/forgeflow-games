// 2026-07-07 — Enumerate category URLs so Vike prerenders
// `/category/<name>/index.html` for each one. Imports the same CATEGORIES
// array the page component renders from, so a newly added category is
// picked up on the next build with no extra step.
// 2026-10-06 — each URL also carries the registry rows (gamesSeed) so the static
// HTML lists the category's games; see src/lib/seed.ts.
import { CATEGORIES } from "../../../src/lib/supabase";
import { fetchPublishedGames, slimGames } from "../../../src/lib/seedFetch";

export default async function onBeforePrerenderStart() {
  const gamesSeed = slimGames(await fetchPublishedGames());
  return CATEGORIES.map((c) => ({ url: `/category/${c.slug}`, pageContext: { gamesSeed } }));
}

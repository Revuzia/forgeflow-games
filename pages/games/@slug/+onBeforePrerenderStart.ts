// 2026-05-11 — Enumerate all published game slugs at build time so Vike can
// prerender `/games/<slug>/index.html` for each one (without it a hard load of a
// game URL fell through to the homepage).
//
// 2026-10-06 — Each URL now also carries its registry row (gameSeed) and its
// related games (relatedSeed) as pageContext, so the static HTML is the real
// game page — title, description, controls, tags, related games — instead of a
// loading skeleton. Both are listed in passToClient (pages/+config.ts) so the
// browser hydrates from the same data; see src/lib/seed.ts for why this is not a
// +data hook.
import { fetchPublishedGames, slimGames } from "../../../src/lib/seedFetch";
import { relatedFor } from "../../../src/lib/seed";

export default async function onBeforePrerenderStart() {
  const all = await fetchPublishedGames();
  console.log(`[prerender] Pre-rendering ${all.length} game pages with seeds`);
  return all.map((g) => ({
    url: `/games/${g.slug}`,
    pageContext: { gameSeed: g, relatedSeed: slimGames(relatedFor(all, g)) },
  }));
}

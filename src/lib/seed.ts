// Prerender-time seed helpers. PURE — safe to bundle into the client.
//
// WHY: the portal pages fetch their games client-side with react-query, so the
// prerendered static HTML was just a loading skeleton — crawlers (and AdSense's
// reviewer) saw ~850 characters of nav and footer on every game page. At build
// time each page's +onBeforePrerenderStart hands it the registry rows
// (pageContext.gameSeed / gamesSeed); the hooks use them as react-query
// `initialData`, so the static HTML contains the real content. They are marked
// stale (initialDataUpdatedAt: 0) so the browser still refetches on mount and a
// player never sees stale play counts.
//
// Deliberately NOT done with a Vike `+data` hook: that makes client-side
// navigation depend on a per-page pageContext.json that only exists for pages
// present at build time. A game published after the last build has none, and
// the resulting failed navigation falls back to a full reload — which the
// homepage SPA-fallback would then re-navigate: a reload loop. (Since
// 2026-10-08 the 404.html hand-off's loop guard stops that after one bounce, see
// src/lib/spaFallback.ts, but the unbuilt game would still never open.)

import type { Game } from "./supabase";

/** Everything a listing card needs; `description` (the big field) is left out. */
export const LIST_SEED_FIELDS = [
  "id", "title", "slug", "short_description", "genre", "sub_genre", "thumbnail_url",
  "hero_image_url", "game_url", "difficulty", "play_count", "rating_sum", "rating_count",
  "mobile_support", "has_mobile_support", "tags", "status", "created_at", "updated_at",
] as const;

export type GameQuery = {
  genre?: string;
  sort?: "popular" | "new" | "top_rated" | "random";
  limit?: number;
};

/** In-memory equivalent of the useGames() query, for seeding from one registry fetch. */
export function applyGameQuery(all: Game[] | undefined, q: GameQuery): Game[] | undefined {
  if (!all || !all.length) return undefined;
  if (q.sort === "random") return undefined; // shuffled client-side; a seed would only cause a hydration mismatch
  let rows = all.filter((g) => g.status === "published");
  if (q.genre) rows = rows.filter((g) => g.genre === q.genre);
  const by = (f: (g: Game) => number) => (a: Game, b: Game) => f(b) - f(a);
  switch (q.sort || "popular") {
    case "new":
      rows = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
      break;
    case "top_rated":
      rows = [...rows].sort(by((g) => g.rating_sum));
      break;
    default:
      rows = [...rows].sort(by((g) => g.play_count));
  }
  return rows.slice(0, q.limit ?? 50);
}

/** Same ordering as useRelatedGames(): same genre, not this game, most played first. */
export function relatedFor(all: Game[], game: Game, limit = 12): Game[] {
  return all
    .filter((g) => g.genre === game.genre && g.id !== game.id && g.status === "published")
    .sort((a, b) => b.play_count - a.play_count)
    .slice(0, limit);
}

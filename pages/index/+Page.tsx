import { useEffect } from "react";
import { navigate } from "vike/client/router";
import { useGames } from "../../src/hooks/useGames";
import GameCarousel from "../../src/components/game/GameCarousel";
import GameGrid from "../../src/components/game/GameGrid";
import HeroSpotlight from "../../src/components/home/HeroSpotlight";
import GenreTiles from "../../src/components/home/GenreTiles";
import { playsOnTouch } from "../../src/lib/mobile";
import type { Game } from "../../src/lib/supabase";
import { usePageContext } from "vike-react/usePageContext";
import AdSlot from "../../src/components/ads/AdSlot";
import { readSpaFallback, clearSpaFallbackMarker } from "../../src/lib/spaFallback";

export default function HomePage() {
  // Prerender-time registry rows (src/lib/seed.ts): the static HTML lists real games.
  const { gamesSeed } = usePageContext() as { gamesSeed?: import("../../src/lib/supabase").Game[] };
  // SPA-fallback recovery for a game or category page with no static HTML yet
  // (published after the last portal build). Cloudflare Pages answers such a URL
  // with the top-level 404.html (HTTP 404), whose inline script sends the visitor
  // here as /?spa=<path> (scripts/postbuild-404.mjs). Vike hydrates the
  // pageContext embedded in the served HTML (this homepage), so client-route to
  // the real page, replacing the /?spa= history entry. Only /games/<slug> and
  // /category/<name> are ever handed off; a bogus slug ends on the game page's
  // "Game Not Found" state, and the sessionStorage marker (src/lib/spaFallback.ts)
  // stops a hand-off loop if client routing ever falls back to a hard reload.
  // (2026-10-08: this used to be reached through `/games/* / 200` rewrites in
  // public/_redirects; Pages follows a matching rule even when a static file
  // exists, so those rewrites served the homepage for every prerendered page.)
  useEffect(() => {
    const fb = readSpaFallback(window.location);
    if (fb.kind === "strip") {
      window.history.replaceState(window.history.state, "", fb.cleanUrl);
    } else if (fb.kind === "navigate") {
      const targetPath = new URL(fb.target, window.location.origin).pathname;
      navigate(fb.target, { overwriteLastHistoryEntry: true })
        .then(() => {
          // Landed (a hard-reload fallback would still be on "/" here): the next
          // reload of this URL may hand off again.
          if (window.location.pathname === targetPath) clearSpaFallbackMarker();
        })
        .catch(() => {});
    }
  }, []);

  const popular = useGames({ sort: "popular", limit: 12 }, gamesSeed);
  const all = useGames({ sort: "popular", limit: 100 }, gamesSeed);
  const newest = useGames({ sort: "new", limit: 12 }, gamesSeed);
  const platformers = useGames({ genre: "platformer", limit: 12 }, gamesSeed);
  const adventure = useGames({ genre: "adventure", limit: 12 }, gamesSeed);
  const rpg = useGames({ genre: "rpg", limit: 12 }, gamesSeed);
  const arpg = useGames({ genre: "arpg", limit: 12 }, gamesSeed);
  const board = useGames({ genre: "board_game", limit: 12 }, gamesSeed);

  // Hero spotlights = the newest games that have cover art. Taken from the seeded
  // "new" list (not a client-only query) so the static HTML and the hydrated page
  // agree and nothing jumps when the live data arrives.
  const spotlights = (newest.data || []).filter((g) => g.hero_image_url).slice(0, 5);
  const allGames = all.data || [];
  const heroStats = { games: allGames.length, touch: allGames.filter(playsOnTouch).length };

  // Genre rows. A row with only one to three games looked like a broken page (a
  // lone card and a screen of empty space), so those games are folded into one
  // "More to explore" grid instead, de-duplicated against everything already shown.
  const MIN_ROW = 4;
  const genreRows = [
    { title: "Platformers", color: "#4488ff", href: "/category/platformer", q: platformers },
    { title: "Adventure", color: "#00ff88", href: "/category/adventure", q: adventure },
    { title: "RPG", color: "#a855f7", href: "/category/rpg", q: rpg },
    { title: "Action RPG", color: "#ff3366", href: "/category/arpg", q: arpg },
    { title: "Board Games", color: "#88cc44", href: "/category/board_game", q: board },
  ];
  const bigRows = genreRows.filter((r) => (r.q.data?.length || 0) >= MIN_ROW);
  const shown = new Set<number>(
    [...(popular.data || []), ...(newest.data || []), ...bigRows.flatMap((r) => r.q.data || [])].map((g) => g.id),
  );
  const moreGames: Game[] = [];
  for (const r of genreRows) {
    if ((r.q.data?.length || 0) >= MIN_ROW) continue;
    for (const g of r.q.data || []) {
      if (!shown.has(g.id) && !moreGames.some((m) => m.id === g.id)) moreGames.push(g);
    }
  }

  return (
    <div>
      <HeroSpotlight games={spotlights} stats={heroStats} />

      {/* Game Sections */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-12 py-12">
        {popular.data && popular.data.length > 0 && (
          <GameCarousel title="Trending Now" games={popular.data} accentColor="#ff3366" viewAllHref="/games?sort=popular" />
        )}

        <GenreTiles games={allGames} />

        {newest.data && newest.data.length > 0 && (
          <GameCarousel title="New Releases" games={newest.data} accentColor="#00ff88" viewAllHref="/games?sort=new" />
        )}

        {/* Between the two discovery rows and the genre rows: a natural content break. Renders nothing until ads are enabled. */}
        <AdSlot slot="homeMid" />

        {/* Per-genre rows (only genres with enough games to fill a row) */}
        {bigRows.map((r) => (
          <GameCarousel key={r.title} title={r.title} games={r.q.data || []} accentColor={r.color} viewAllHref={r.href} />
        ))}

        {moreGames.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-7 rounded-full bg-brand-purple" />
                <h2 className="section-title">More to Explore</h2>
              </div>
              <a href="/games" className="text-sm font-medium text-gray-300 hover:text-brand-orange transition-colors inline-flex items-center gap-1">
                All games <span aria-hidden="true">&rarr;</span>
              </a>
            </div>
            <GameGrid games={moreGames} columns={5} />
          </section>
        )}

        {/* Empty state when no games yet */}
        {!popular.isLoading && (!popular.data || popular.data.length === 0) && (
          <div className="text-center py-20">
            <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-brand-blue/20 to-brand-green/20 flex items-center justify-center">
              <svg className="w-12 h-12 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="font-display font-bold text-2xl text-gray-200 mb-3">Games are loading</h2>
            <p className="text-gray-400 max-w-md mx-auto">
              If this doesn't clear in a moment, refresh the page or browse all games.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

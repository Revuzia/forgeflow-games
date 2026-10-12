import { useEffect } from "react";
import { navigate } from "vike/client/router";
import { useGames } from "../../src/hooks/useGames";
import GameCarousel from "../../src/components/game/GameCarousel";
import GameGrid from "../../src/components/game/GameGrid";
import { CATEGORIES } from "../../src/lib/supabase";
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
  const newest = useGames({ sort: "new", limit: 12 }, gamesSeed);
  const platformers = useGames({ genre: "platformer", limit: 12 }, gamesSeed);
  const adventure = useGames({ genre: "adventure", limit: 12 }, gamesSeed);
  const rpg = useGames({ genre: "rpg", limit: 12 }, gamesSeed);
  const arpg = useGames({ genre: "arpg", limit: 12 }, gamesSeed);
  const board = useGames({ genre: "board_game", limit: 12 }, gamesSeed);

  // Hero spotlight = the newest game that has cover art. Taken from the seeded
  // "new" list (not the client-only featured query) so the static HTML and the
  // hydrated page agree and nothing jumps when the live data arrives.
  const spotlight = (newest.data || []).find((g) => g.hero_image_url) || (newest.data || [])[0];

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
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-surface-800 to-surface-900">
        <div className="absolute inset-0 opacity-[0.06]">
          <div className="absolute inset-0" style={{
            backgroundImage: "linear-gradient(rgba(255,136,0,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.15) 1px, transparent 1px)",
            backgroundSize: "60px 60px"
          }} />
        </div>
        <div className="pointer-events-none absolute -top-32 -left-24 w-[520px] h-[520px] rounded-full bg-brand-orange/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-0 w-[520px] h-[520px] rounded-full bg-brand-blue/10 blur-3xl" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14 lg:py-16 relative">
          <div className={`grid gap-10 items-center ${spotlight ? "lg:grid-cols-[1.05fr_1fr]" : ""}`}>
            <div className={spotlight ? "" : "text-center max-w-3xl mx-auto"}>
              <h1 className="font-display font-bold text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight mb-5">
                <span className="text-brand-orange" style={{ textShadow: "0 0 30px rgba(255,136,0,0.4)" }}>Premium</span>{" "}
                <span className="text-white">Browser Games</span>
              </h1>
              <p className="text-lg sm:text-xl text-gray-300 mb-7 leading-relaxed max-w-xl">
                Free original games you can play instantly in your browser. No downloads, no sign-up. Pick one and play.
              </p>
              <div className={`flex flex-wrap items-center gap-3 ${spotlight ? "" : "justify-center"}`}>
                <a href="/games" className="btn-primary text-lg px-8 py-4">Browse All Games</a>
                {spotlight && (
                  <a href={`/games/${spotlight.slug}`} className="btn-secondary text-lg px-8 py-4">Play {spotlight.title}</a>
                )}
              </div>

              {/* Browse by genre */}
              <div className={`mt-8 flex flex-wrap gap-2 ${spotlight ? "" : "justify-center"}`}>
                {CATEGORIES.map((cat) => (
                  <a key={cat.slug} href={`/category/${cat.slug}`} className="category-pill inline-flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                    {cat.label}
                  </a>
                ))}
              </div>
            </div>

            {spotlight && (
              <a
                href={`/games/${spotlight.slug}`}
                className="group relative block rounded-3xl overflow-hidden border border-surface-600/60 shadow-2xl shadow-black/60 aspect-video"
              >
                <img
                  src={spotlight.hero_image_url || spotlight.thumbnail_url || ""}
                  alt={`${spotlight.title} cover art`}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  loading="eager"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                  <span className="inline-block px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-brand-orange text-white">
                    New release
                  </span>
                  <h2 className="font-display font-bold text-2xl sm:text-3xl text-white mt-2.5 drop-shadow">{spotlight.title}</h2>
                  {spotlight.short_description && (
                    <p className="text-sm sm:text-[15px] text-gray-200 mt-1.5 line-clamp-2 max-w-lg">{spotlight.short_description}</p>
                  )}
                  <span className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/95 px-5 py-2.5 text-sm font-bold text-surface-900 group-hover:bg-brand-orange group-hover:text-white transition-colors">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                    Play now
                  </span>
                </div>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Game Sections */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-12 py-12">
        {popular.data && popular.data.length > 0 && (
          <GameCarousel title="Trending Now" games={popular.data} accentColor="#ff3366" viewAllHref="/games?sort=popular" />
        )}

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

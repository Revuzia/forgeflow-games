import { useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { useGames } from "../../src/hooks/useGames";
import GameGrid from "../../src/components/game/GameGrid";
import AdSlot from "../../src/components/ads/AdSlot";
import { CATEGORIES } from "../../src/lib/supabase";
import { playsOnTouch } from "../../src/lib/mobile";
import useIsTouchDevice from "../../src/hooks/useIsTouchDevice";

type SortOption = "popular" | "new" | "top_rated" | "random";

export default function GamesPage() {
  const [activeGenre, setActiveGenre] = useState<string | undefined>();
  const [sort, setSort] = useState<SortOption>("popular");
  // 2026-09-15 — opt-in filter for touch playability (games.mobile_support).
  const [mobileOnly, setMobileOnly] = useState(false);
  const isTouch = useIsTouchDevice();
  const { gamesSeed } = usePageContext() as { gamesSeed?: import("../../src/lib/supabase").Game[] };

  const { data: games, isLoading } = useGames({
    genre: activeGenre,
    sort,
    limit: 100,
  }, gamesSeed);

  const visibleGames = mobileOnly ? (games || []).filter(playsOnTouch) : games || [];
  const mobileCount = (games || []).filter(playsOnTouch).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-gray-100 mb-2">All Games</h1>
        <p className="text-surface-500">Browse our collection of premium browser games</p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        {/* Genre pills */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveGenre(undefined)}
            className={`category-pill ${!activeGenre ? "active" : ""}`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.slug}
              onClick={() => setActiveGenre(cat.slug)}
              className={`category-pill ${activeGenre === cat.slug ? "active" : ""}`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Touch-playability filter — same pill language as the genre pills */}
          <button
            type="button"
            onClick={() => setMobileOnly((v) => !v)}
            className={`category-pill flex items-center gap-1.5 ${mobileOnly ? "active" : ""}`}
            title={
              isTouch
                ? "Show only games with touch controls"
                : "Show only games that also work on phones and tablets"
            }
            aria-pressed={mobileOnly}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            {isTouch ? "Playable on my device" : "Mobile-friendly"}
            <span className="text-surface-500">({mobileCount})</span>
          </button>

          {/* Sort dropdown */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm text-gray-200
                       focus:outline-none focus:border-brand-blue/50 cursor-pointer"
          >
            <option value="popular">Most Popular</option>
            <option value="new">Newest First</option>
            <option value="top_rated">Top Rated</option>
            <option value="random">Random</option>
          </select>
        </div>
      </div>

      {/* Games grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-surface-800 animate-pulse">
              <div className="aspect-video bg-surface-700 rounded-t-xl" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-surface-700 rounded w-3/4" />
                <div className="h-3 bg-surface-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <GameGrid games={visibleGames} columns={5} />
      )}

      {/* After the whole grid: never between a player and a game. Renders nothing until ads are enabled. */}
      <AdSlot slot="gamesBottom" className="mt-10" />
    </div>
  );
}

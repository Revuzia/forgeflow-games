import { useState } from "react";
import { useGames } from "../../src/hooks/useGames";
import GameGrid from "../../src/components/game/GameGrid";
import { CATEGORIES } from "../../src/lib/supabase";

type SortOption = "popular" | "new" | "top_rated" | "random";

export default function GamesPage() {
  const [activeGenre, setActiveGenre] = useState<string | undefined>();
  const [sort, setSort] = useState<SortOption>("popular");

  const { data: games, isLoading } = useGames({
    genre: activeGenre,
    sort,
    limit: 100,
  });

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
        <GameGrid games={games || []} columns={5} />
      )}
    </div>
  );
}

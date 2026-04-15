import { useState, useEffect } from "react";
import { useGames } from "../../src/hooks/useGames";
import GameGrid from "../../src/components/game/GameGrid";

export default function SearchPage() {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") || "");
  }, []);

  const { data: games, isLoading } = useGames({
    search: query || undefined,
    limit: 50,
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-gray-100 mb-2">
          {query ? `Results for "${query}"` : "Search Games"}
        </h1>
        {games && (
          <p className="text-surface-500">{games.length} game{games.length !== 1 ? "s" : ""} found</p>
        )}
      </div>

      {/* Search input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.target as HTMLFormElement).querySelector("input");
          if (input?.value) {
            window.location.href = `/search?q=${encodeURIComponent(input.value)}`;
          }
        }}
        className="mb-8"
      >
        <input
          type="text"
          defaultValue={query}
          placeholder="Search for a game..."
          className="w-full max-w-lg px-4 py-3 rounded-lg bg-surface-800 border border-surface-600/50
                     text-gray-200 placeholder-surface-500 focus:outline-none focus:border-brand-blue/50
                     focus:ring-1 focus:ring-brand-blue/30"
        />
      </form>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-surface-800 animate-pulse">
              <div className="aspect-video bg-surface-700 rounded-t-xl" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-surface-700 rounded w-3/4" />
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

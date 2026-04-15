import { usePageContext } from "vike-react/usePageContext";
import { useGames } from "../../../src/hooks/useGames";
import GameGrid from "../../../src/components/game/GameGrid";
import { CATEGORIES } from "../../../src/lib/supabase";

export default function CategoryPage() {
  const { routeParams } = usePageContext();
  const genreSlug = routeParams?.name || "";
  const category = CATEGORIES.find((c) => c.slug === genreSlug);
  const { data: games, isLoading } = useGames({ genre: genreSlug, limit: 100 });

  const title = category?.label || genreSlug.replace("_", " ");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <nav className="text-sm text-surface-500 mb-4 flex items-center gap-2">
          <a href="/" className="hover:text-brand-blue transition-colors">Home</a>
          <span>/</span>
          <a href="/games" className="hover:text-brand-blue transition-colors">Games</a>
          <span>/</span>
          <span className="text-gray-300 capitalize">{title}</span>
        </nav>
        <h1 className="font-display font-bold text-3xl text-gray-100 mb-2 capitalize">{title}</h1>
        <p className="text-surface-500">
          Browse all {title.toLowerCase()} games in our collection
        </p>
      </div>

      {/* Other categories */}
      <div className="flex flex-wrap gap-2 mb-8">
        <a href="/games" className="category-pill">All Games</a>
        {CATEGORIES.map((cat) => (
          <a
            key={cat.slug}
            href={`/category/${cat.slug}`}
            className={`category-pill ${cat.slug === genreSlug ? "active" : ""}`}
          >
            {cat.label}
          </a>
        ))}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 15 }).map((_, i) => (
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

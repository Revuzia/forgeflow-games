import { MIN_INDEXABLE_CATEGORY_GAMES } from "../../../src/config/site";
import { CATEGORY_INTROS } from "../../../src/content/categoryIntros";
import { guideBySlug } from "../../../src/content/guides";
import { usePageContext } from "vike-react/usePageContext";
import { useConfig } from "vike-react/useConfig";
import { Head } from "vike-react/Head";
import useNoindex from "../../../src/hooks/useNoindex";
import { genreLabel } from "../../../src/lib/categories";
import { clip } from "../../../src/config/site";
import { useGames } from "../../../src/hooks/useGames";
import GameGrid from "../../../src/components/game/GameGrid";
import AdSlot from "../../../src/components/ads/AdSlot";
import { CATEGORIES } from "../../../src/lib/supabase";

export default function CategoryPage() {
  const { routeParams, gamesSeed } = usePageContext() as {
    routeParams?: Record<string, string>;
    gamesSeed?: import("../../../src/lib/supabase").Game[];
  };
  const genreSlug = routeParams?.name || "";
  const category = CATEGORIES.find((c) => c.slug === genreSlug);
  const { data: games, isLoading } = useGames({ genre: genreSlug, limit: 100 }, gamesSeed);

  const title = category?.label || genreSlug.replace("_", " ");
  const intro = CATEGORY_INTROS[genreSlug];

  // Head: a category page used to have no title/description of its own.
  const config = useConfig();
  const label = genreLabel(genreSlug);
  useNoindex(!category);   // a slug that is not a real category (reached via the stale-prerender fallback)
  const count = games?.length;
  config({
    title: `${label} Games — Play Free Online | ForgeFlow Games`,
    description: clip(
      `Play free ${label.toLowerCase()} games online at ForgeFlow Games${count ? ` — ${count} browser game${count === 1 ? "" : "s"} to choose from` : ""}. ` +
        `No download or sign-up needed: click a game and play instantly.`,
    ),
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* A category with no games is a thin page (Puzzle has none today): keep it
          out of the index until it has something on it. */}
      {games && games.length < MIN_INDEXABLE_CATEGORY_GAMES && <Head><meta name="robots" content="noindex, follow" /></Head>}
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
        {intro ? (
          <div className="max-w-3xl space-y-3">
            {intro.text.map((para, i) => (
              <p key={i} className="text-gray-300 leading-relaxed">{para}</p>
            ))}
            {intro.guides && intro.guides.length > 0 && (
              <p className="text-sm text-gray-400">
                Guides:{" "}
                {intro.guides.map((slug, i) => (
                  <span key={slug}>
                    {i > 0 && " · "}
                    <a href={`/guides/${slug}`} className="text-brand-orange hover:underline">{guideBySlug(slug)?.title || slug}</a>
                  </span>
                ))}
              </p>
            )}
          </div>
        ) : (
          <p className="text-gray-300">Browse all {title.toLowerCase()} games in our collection</p>
        )}
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

      <AdSlot slot="categoryBottom" className="mt-10" />
    </div>
  );
}

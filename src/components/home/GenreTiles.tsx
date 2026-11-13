import type { Game } from "../../lib/supabase";
import { CATEGORIES } from "../../lib/supabase";

type Props = {
  /** every published game, most popular first */
  games: Game[];
};

/**
 * "Browse by genre": one big tile per category that actually has games, painted
 * with the art of that genre's most popular game and tinted in the genre colour.
 * Empty categories are left out (their pages are noindexed and would only
 * disappoint).
 */
export default function GenreTiles({ games }: Props) {
  const tiles = CATEGORIES.map((cat) => {
    const inGenre = games.filter((g) => g.genre === cat.slug);
    const lead = inGenre.find((g) => g.hero_image_url || g.thumbnail_url);
    return { cat, count: inGenre.length, art: lead ? lead.hero_image_url || lead.thumbnail_url : null };
  }).filter((t) => t.count > 0);

  if (tiles.length < 2) return null;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-7 rounded-full bg-brand-blue" />
        <h2 className="section-title">Browse by Genre</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {tiles.map(({ cat, count, art }) => (
          <a
            key={cat.slug}
            href={`/category/${cat.slug}`}
            className="group relative block h-32 sm:h-36 overflow-hidden rounded-2xl border border-white/10 transition-all duration-300 hover:-translate-y-1 hover:border-white/30"
            style={{ boxShadow: `0 0 0 0 ${cat.color}00` }}
          >
            {art && (
              <img
                src={art}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
              />
            )}
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(135deg, ${cat.color}d9 0%, ${cat.color}66 38%, rgba(10,14,26,0.82) 100%)` }}
            />
            <div className="absolute inset-0 flex flex-col justify-end p-4">
              <span className="font-display font-bold text-xl sm:text-2xl text-white drop-shadow leading-tight">{cat.label}</span>
              <span className="text-xs font-medium text-white/85 mt-0.5">
                {count} {count === 1 ? "game" : "games"}
              </span>
            </div>
            <span
              aria-hidden="true"
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/35 backdrop-blur-sm flex items-center justify-center text-white opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
            >
              &rarr;
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

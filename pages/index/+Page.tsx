import { useGames, useFeaturedGames } from "../../src/hooks/useGames";
import GameCarousel from "../../src/components/game/GameCarousel";
import GameGrid from "../../src/components/game/GameGrid";
import { CATEGORIES } from "../../src/lib/supabase";

export default function HomePage() {
  const featured = useFeaturedGames();
  const popular = useGames({ sort: "popular", limit: 12 });
  const newest = useGames({ sort: "new", limit: 12 });
  const platformers = useGames({ genre: "platformer", limit: 12 });
  const adventure = useGames({ genre: "adventure", limit: 12 });
  const rpg = useGames({ genre: "rpg", limit: 12 });
  const arpg = useGames({ genre: "arpg", limit: 12 });
  const board = useGames({ genre: "board_game", limit: 12 });

  const heroGame = featured.data?.[0];

  return (
    <div>
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-surface-800 to-surface-900">
        {/* Animated background grid */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: "linear-gradient(rgba(255,136,0,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.15) 1px, transparent 1px)",
            backgroundSize: "60px 60px"
          }} />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24 relative">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="font-display font-bold text-4xl sm:text-5xl lg:text-6xl mb-6">
              <span className="text-brand-orange" style={{ textShadow: "0 0 30px rgba(255,136,0,0.4)" }}>Premium</span>{" "}
              <span className="text-white">Browser Games</span>
            </h1>
            <p className="text-lg sm:text-xl text-gray-400 mb-8 leading-relaxed">
              55+ original games. No downloads. No signups. Just hit play.
              Platformers, RPGs, adventure, strategy, and more.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a href="/games" className="btn-primary text-lg px-8 py-4">
                Browse All Games
              </a>
              {heroGame && (
                <a href={`/games/${heroGame.slug}`} className="btn-secondary text-lg px-8 py-4">
                  Play Featured
                </a>
              )}
            </div>
          </div>

          {/* Category pills */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-12">
            {CATEGORIES.map((cat) => (
              <a
                key={cat.slug}
                href={`/category/${cat.slug}`}
                className="px-5 py-2.5 rounded-full font-display font-semibold text-sm border transition-all duration-300 hover:scale-105"
                style={{
                  color: cat.color,
                  borderColor: cat.color + "40",
                  backgroundColor: cat.color + "10",
                }}
              >
                {cat.label}
              </a>
            ))}
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-surface-900 to-transparent" />
      </section>

      {/* Game Sections */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-12 py-12">
        {/* Featured / Popular */}
        {popular.data && popular.data.length > 0 && (
          <GameCarousel
            title="Trending Now"
            games={popular.data}
            accentColor="#ff3366"
            viewAllHref="/games?sort=popular"
          />
        )}

        {newest.data && newest.data.length > 0 && (
          <GameCarousel
            title="New Releases"
            games={newest.data}
            accentColor="#00ff88"
            viewAllHref="/games?sort=new"
          />
        )}

        {/* Per-genre rows */}
        {platformers.data && platformers.data.length > 0 && (
          <GameCarousel
            title="Platformers"
            games={platformers.data}
            accentColor="#00d4ff"
            viewAllHref="/category/platformer"
          />
        )}

        {adventure.data && adventure.data.length > 0 && (
          <GameCarousel
            title="Adventure"
            games={adventure.data}
            accentColor="#00ff88"
            viewAllHref="/category/adventure"
          />
        )}

        {rpg.data && rpg.data.length > 0 && (
          <GameCarousel
            title="RPG"
            games={rpg.data}
            accentColor="#a855f7"
            viewAllHref="/category/rpg"
          />
        )}

        {arpg.data && arpg.data.length > 0 && (
          <GameCarousel
            title="Action RPG"
            games={arpg.data}
            accentColor="#ff3366"
            viewAllHref="/category/arpg"
          />
        )}

        {board.data && board.data.length > 0 && (
          <GameCarousel
            title="Board Games"
            games={board.data}
            accentColor="#ff8800"
            viewAllHref="/category/board_game"
          />
        )}

        {/* Empty state when no games yet */}
        {!popular.isLoading && (!popular.data || popular.data.length === 0) && (
          <div className="text-center py-20">
            <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-brand-blue/20 to-brand-green/20 flex items-center justify-center">
              <svg className="w-12 h-12 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="font-display font-bold text-2xl text-gray-200 mb-3">
              Games are being built!
            </h2>
            <p className="text-surface-500 max-w-md mx-auto">
              Our team is crafting 55+ premium browser games. The first titles will appear here soon.
              Check back daily for new releases!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

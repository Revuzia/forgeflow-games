import { usePageContext } from "vike-react/usePageContext";
import { useGame, useRelatedGames } from "../../../src/hooks/useGames";
import GamePlayer from "../../../src/components/game/GamePlayer";
import GameCarousel from "../../../src/components/game/GameCarousel";

const DIFFICULTY_LABELS: Record<string, { label: string; color: string }> = {
  easy: { label: "Easy", color: "#00ff88" },
  medium: { label: "Medium", color: "#ff8800" },
  hard: { label: "Hard", color: "#ff3366" },
  extreme: { label: "Extreme", color: "#a855f7" },
};

export default function GamePage() {
  const { routeParams } = usePageContext();
  const slug = routeParams?.slug || "";
  const { data: game, isLoading, error } = useGame(slug);
  const { data: related } = useRelatedGames(game || null);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="animate-pulse">
          <div className="aspect-video bg-surface-800 rounded-xl mb-6" />
          <div className="h-8 bg-surface-800 rounded w-1/3 mb-4" />
          <div className="h-4 bg-surface-800 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 text-center">
        <h1 className="font-display font-bold text-3xl text-gray-200 mb-3">Game Not Found</h1>
        <p className="text-surface-500 mb-6">This game doesn't exist or hasn't been published yet.</p>
        <a href="/games" className="btn-primary">Browse All Games</a>
      </div>
    );
  }

  const diff = DIFFICULTY_LABELS[game.difficulty] || DIFFICULTY_LABELS.medium;
  const rating = game.rating_count > 0 ? (game.rating_sum / game.rating_count).toFixed(1) : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-surface-500 mb-4 flex items-center gap-2">
        <a href="/" className="hover:text-brand-blue transition-colors">Home</a>
        <span>/</span>
        <a href="/games" className="hover:text-brand-blue transition-colors">Games</a>
        <span>/</span>
        <a href={`/category/${game.genre}`} className="hover:text-brand-blue transition-colors capitalize">
          {game.genre.replace("_", " ")}
        </a>
        <span>/</span>
        <span className="text-gray-300">{game.title}</span>
      </nav>

      {/* Main layout: Game + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Game player */}
        <div>
          <GamePlayer game={game} />

          {/* Game info below player */}
          <div className="mt-4">
            <h1 className="font-display font-bold text-2xl sm:text-3xl text-gray-100 mb-2">
              {game.title}
            </h1>

            {/* Stats row */}
            <div className="flex flex-wrap items-center gap-4 text-sm mb-4">
              <span className="flex items-center gap-1 text-surface-500">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5z"/></svg>
                {game.play_count.toLocaleString()} plays
              </span>
              {rating && (
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  <span className="text-gray-300 font-medium">{rating}</span>
                  <span className="text-surface-500">({game.rating_count})</span>
                </span>
              )}
              <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ color: diff.color, backgroundColor: diff.color + "15" }}>
                {diff.label}
              </span>
              {game.has_mobile_support && (
                <span className="text-surface-500 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  Mobile
                </span>
              )}
            </div>

            {game.description && (
              <p className="text-gray-300 leading-relaxed mb-6">{game.description}</p>
            )}

            {/* Controls */}
            {(game.controls_keyboard || game.controls_gamepad) && (
              <div className="bg-surface-800 rounded-lg p-4 border border-surface-600/30 mb-6">
                <h3 className="font-display font-semibold text-sm text-gray-200 mb-2">Controls</h3>
                {game.controls_keyboard && (
                  <p className="text-sm text-surface-500 mb-1">
                    <span className="text-gray-400">Keyboard:</span> {game.controls_keyboard}
                  </p>
                )}
                {game.controls_gamepad && (
                  <p className="text-sm text-surface-500">
                    <span className="text-gray-400">Gamepad:</span> {game.controls_gamepad}
                  </p>
                )}
              </div>
            )}

            {/* Tags */}
            {game.tags && game.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {game.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full text-xs bg-surface-800 text-surface-500 border border-surface-600/30">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Ad banner below game info */}
          <div className="mt-6 bg-surface-800 rounded-lg border border-surface-600/30 h-24 flex items-center justify-center">
            <p className="text-xs text-surface-500">Advertisement</p>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          {/* Sidebar ad */}
          <div className="bg-surface-800 rounded-lg border border-surface-600/30 aspect-[300/250] flex items-center justify-center">
            <p className="text-xs text-surface-500">Advertisement</p>
          </div>

          {/* Screenshots */}
          {game.screenshot_urls && game.screenshot_urls.length > 0 && (
            <div>
              <h3 className="font-display font-semibold text-sm text-gray-200 mb-3">Screenshots</h3>
              <div className="grid grid-cols-2 gap-2">
                {game.screenshot_urls.slice(0, 4).map((url, i) => (
                  <img key={i} src={url} alt={`${game.title} screenshot ${i + 1}`} className="rounded-lg w-full aspect-video object-cover" loading="lazy" />
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Related games */}
      {related && related.length > 0 && (
        <div className="mt-12">
          <GameCarousel
            title="You Might Also Like"
            games={related}
            viewAllHref={`/category/${game.genre}`}
          />
        </div>
      )}
    </div>
  );
}

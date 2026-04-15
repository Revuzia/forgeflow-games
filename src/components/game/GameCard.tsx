import type { Game } from "../../lib/supabase";

type Props = {
  game: Game;
  size?: "sm" | "md" | "lg";
};

const PLACEHOLDER_THUMB = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 225'%3E%3Crect fill='%23111827' width='400' height='225'/%3E%3Ctext x='200' y='112' fill='%23475569' text-anchor='middle' dominant-baseline='middle' font-family='system-ui' font-size='14'%3EGame Preview%3C/text%3E%3C/svg%3E";

const GENRE_COLORS: Record<string, string> = {
  platformer: "#00d4ff",
  adventure: "#00ff88",
  rpg: "#a855f7",
  arpg: "#ff3366",
  board_game: "#ff8800",
};

function formatPlayCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function getRating(game: Game): string {
  if (!game.rating_count || game.rating_count === 0) return "New";
  const avg = game.rating_sum / game.rating_count;
  return avg.toFixed(1);
}

export default function GameCard({ game, size = "md" }: Props) {
  const accentColor = GENRE_COLORS[game.genre] || "#00d4ff";
  const imgHeight = size === "lg" ? "h-56" : size === "sm" ? "h-32" : "h-40";

  return (
    <a href={`/games/${game.slug}`} className="game-card block">
      {/* Thumbnail */}
      <div className={`relative ${imgHeight} overflow-hidden`}>
        <img
          src={game.thumbnail_url || PLACEHOLDER_THUMB}
          alt={game.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          loading="lazy"
        />
        {/* Play overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100">
            <svg className="w-6 h-6 text-surface-900 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {/* Genre badge */}
        <div
          className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: accentColor + "20", color: accentColor, border: `1px solid ${accentColor}40` }}
        >
          {game.genre.replace("_", " ")}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-display font-semibold text-sm text-gray-100 truncate group-hover:text-brand-blue transition-colors">
          {game.title}
        </h3>
        {game.short_description && size !== "sm" && (
          <p className="text-xs text-surface-500 mt-1 line-clamp-2">{game.short_description}</p>
        )}
        <div className="flex items-center justify-end mt-2">
          <span
            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
            style={{ color: accentColor, backgroundColor: accentColor + "15" }}
          >
            {game.difficulty}
          </span>
        </div>
      </div>
    </a>
  );
}

import type { Game } from "../../lib/supabase";
import { getMobileSupport, MOBILE_BADGE } from "../../lib/mobile";
import useIsTouchDevice from "../../hooks/useIsTouchDevice";

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

function PhoneIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

export default function GameCard({ game, size = "md" }: Props) {
  const accentColor = GENRE_COLORS[game.genre] || "#00d4ff";
  const imgHeight = size === "lg" ? "h-56" : size === "sm" ? "h-32" : "h-40";

  // 2026-09-15: honest mobile labelling. Touch-playable games get a chip in the
  // same visual language as the genre chip; on a touch device the games that
  // WON'T work are de-emphasised and labelled rather than hidden, so a phone
  // visitor can still browse the whole catalog without being misled.
  const mobile = getMobileSupport(game);
  const badge = mobile === "none" ? null : MOBILE_BADGE[mobile];
  const isTouch = useIsTouchDevice();
  const deEmphasised = isTouch && mobile === "none";

  // 2026-04-17: enforce uniform card heights regardless of description length.
  // Info block is a fixed-height flex column so all cards in a grid align.
  const infoMinH = size === "lg" ? "min-h-[112px]" : size === "sm" ? "min-h-[64px]" : "min-h-[96px]";

  return (
    <a
      href={`/games/${game.slug}`}
      className={`game-card block flex flex-col h-full ${deEmphasised ? "opacity-60" : ""}`}
    >
      {/* Thumbnail */}
      <div className={`relative ${imgHeight} overflow-hidden flex-shrink-0`}>
        <img
          src={game.thumbnail_url || PLACEHOLDER_THUMB}
          alt={game.title}
          className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 ${
            deEmphasised ? "grayscale-[0.5]" : ""
          }`}
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
        {/* Mobile-support chip (same chip language as the genre chip) */}
        {badge ? (
          <div
            className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider
                       flex items-center gap-1 backdrop-blur-sm"
            style={{ backgroundColor: badge.color + "20", color: badge.color, border: `1px solid ${badge.color}40` }}
            title={badge.long}
            aria-label={badge.long}
          >
            <PhoneIcon />
            {badge.short}
          </div>
        ) : deEmphasised ? (
          <div
            className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider
                       bg-surface-900/80 text-surface-500 border border-surface-600/50 backdrop-blur-sm"
            title="Desktop only — needs a keyboard and mouse"
            aria-label="Desktop only"
          >
            Desktop only
          </div>
        ) : null}
      </div>

      {/* Info — uniform height regardless of description presence */}
      <div className={`p-3 flex flex-col flex-1 ${infoMinH}`}>
        <h3 className="font-display font-semibold text-sm text-gray-100 truncate group-hover:text-brand-blue transition-colors">
          {game.title}
        </h3>
        {size !== "sm" && (
          <p className="text-xs text-surface-500 mt-1 line-clamp-2 flex-1">
            {game.short_description || "\u00A0"}
          </p>
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

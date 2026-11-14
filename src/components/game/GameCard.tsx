import type { Game } from "../../lib/supabase";
import { CATEGORIES } from "../../lib/supabase";
import { getMobileSupport, MOBILE_BADGE } from "../../lib/mobile";
import useIsTouchDevice from "../../hooks/useIsTouchDevice";

type Props = {
  game: Game;
  size?: "sm" | "md" | "lg";
};

const PLACEHOLDER_THUMB = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'%3E%3Crect fill='%23111827' width='400' height='300'/%3E%3Ctext x='200' y='150' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle' font-family='system-ui' font-size='14'%3EGame Preview%3C/text%3E%3C/svg%3E";

// Genre colour = the category colour used everywhere else on the site (header,
// footer, category pages, genre tiles).
const GENRE_COLORS: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.color]));

const DIFFICULTY_LABEL: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard", extreme: "Extreme" };

function PhoneIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

/**
 * Poster-style card: the art is the card. Title, genre and difficulty sit on the
 * image; the description slides up on hover (it stays in the page for crawlers
 * and screen readers, it is only visually tucked away).
 */
export default function GameCard({ game, size = "md" }: Props) {
  const accentColor = GENRE_COLORS[game.genre] || "#00d4ff";
  const ratio = size === "sm" ? "aspect-video" : size === "lg" ? "aspect-[16/10]" : "aspect-[4/3]";

  // 2026-09-15: honest mobile labelling. Touch-playable games get a chip; on a
  // touch device the games that WON'T work are de-emphasised and labelled rather
  // than hidden, so a phone visitor can still browse the whole catalog.
  const mobile = getMobileSupport(game);
  const badge = mobile === "none" ? null : MOBILE_BADGE[mobile];
  const isTouch = useIsTouchDevice();
  const deEmphasised = isTouch && mobile === "none";

  // Chips sit on top of cover art, which can be any colour: dark glass keeps the
  // label readable on every thumbnail.
  const chip = "absolute top-2.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider leading-none backdrop-blur-md bg-black/60";

  return (
    <a
      href={`/games/${game.slug}`}
      className={`game-card group block w-full ${deEmphasised ? "opacity-60" : ""}`}
      style={{ ["--accent" as string]: accentColor }}
    >
      <div className={`relative ${ratio} overflow-hidden`}>
        <img
          src={game.thumbnail_url || PLACEHOLDER_THUMB}
          alt={game.title}
          className={`absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110 ${
            deEmphasised ? "grayscale-[0.5]" : ""
          }`}
          loading="lazy"
        />
        {/* Readability gradient: darker at the bottom where the title sits */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/25 to-transparent transition-opacity" />
        {/* Genre-coloured edge light on hover */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ backgroundColor: accentColor }}
        />

        {/* Chips */}
        <div className={`${chip} left-2.5 flex items-center gap-1.5 text-gray-100`}>
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
          {game.genre.replace("_", " ")}
        </div>
        {badge ? (
          <div
            className={`${chip} right-2.5 flex items-center gap-1`}
            style={{ color: badge.color, border: `1px solid ${badge.color}55` }}
            title={badge.long}
            aria-label={badge.long}
          >
            <PhoneIcon />
            {badge.short}
          </div>
        ) : deEmphasised ? (
          <div
            className={`${chip} right-2.5 text-gray-300 border border-surface-600/60`}
            title="Desktop only — needs a keyboard and mouse"
            aria-label="Desktop only"
          >
            Desktop only
          </div>
        ) : null}

        {/* Play button */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-brand-orange flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 shadow-xl shadow-black/50">
            <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>

        {/* Title block */}
        <div className="absolute inset-x-0 bottom-0 p-3.5">
          <h3 className="font-display font-bold text-[17px] leading-tight text-white drop-shadow truncate">{game.title}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-300">
            <span className="font-medium" style={{ color: accentColor }}>
              {DIFFICULTY_LABEL[game.difficulty] || game.difficulty}
            </span>
          </div>
          {size !== "sm" && game.short_description && (
            <p className="text-xs text-gray-200 leading-relaxed line-clamp-2 mt-0 max-h-0 opacity-0 overflow-hidden group-hover:mt-2 group-hover:max-h-10 group-hover:opacity-100 group-focus-visible:mt-2 group-focus-visible:max-h-10 group-focus-visible:opacity-100 transition-all duration-300">
              {game.short_description}
            </p>
          )}
        </div>
      </div>
    </a>
  );
}

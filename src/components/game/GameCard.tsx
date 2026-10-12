import type { Game } from "../../lib/supabase";
import { CATEGORIES } from "../../lib/supabase";
import { getMobileSupport, MOBILE_BADGE } from "../../lib/mobile";
import useIsTouchDevice from "../../hooks/useIsTouchDevice";

type Props = {
  game: Game;
  size?: "sm" | "md" | "lg";
};

const PLACEHOLDER_THUMB = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 225'%3E%3Crect fill='%23111827' width='400' height='225'/%3E%3Ctext x='200' y='112' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle' font-family='system-ui' font-size='14'%3EGame Preview%3C/text%3E%3C/svg%3E";

// Genre colour = the category colour used everywhere else on the site (header,
// footer, category pages). The old local map covered five genres and painted
// every other one (action, arcade, puzzle...) the same blue.
const GENRE_COLORS: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.color]));

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
  const infoMinH = size === "lg" ? "min-h-[112px]" : size === "sm" ? "min-h-[64px]" : "min-h-[100px]";

  // Chips sit on top of cover art, which can be any colour: a dark glass
  // background keeps the label readable on every thumbnail.
  const chip = "absolute px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider leading-none backdrop-blur-md bg-black/60";

  return (
    <a
      href={`/games/${game.slug}`}
      className={`game-card group block flex flex-col h-full ${deEmphasised ? "opacity-60" : ""}`}
    >
      {/* Thumbnail */}
      <div className={`relative ${imgHeight} overflow-hidden flex-shrink-0`}>
        <img
          src={game.thumbnail_url || PLACEHOLDER_THUMB}
          alt={game.title}
          className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${
            deEmphasised ? "grayscale-[0.5]" : ""
          }`}
          loading="lazy"
        />
        {/* Bottom fade so the chips and title area read cleanly */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-surface-800 via-surface-800/20 to-transparent" />
        {/* Play overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-all duration-300 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-brand-orange flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100 shadow-lg shadow-black/40">
            <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {/* Genre badge */}
        <div className={`${chip} top-2 left-2 flex items-center gap-1.5 text-gray-100`}>
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
          {game.genre.replace("_", " ")}
        </div>
        {/* Mobile-support chip (same chip language as the genre chip) */}
        {badge ? (
          <div
            className={`${chip} bottom-2 right-2 flex items-center gap-1`}
            style={{ color: badge.color, border: `1px solid ${badge.color}55` }}
            title={badge.long}
            aria-label={badge.long}
          >
            <PhoneIcon />
            {badge.short}
          </div>
        ) : deEmphasised ? (
          <div
            className={`${chip} bottom-2 right-2 text-gray-300 border border-surface-600/60`}
            title="Desktop only — needs a keyboard and mouse"
            aria-label="Desktop only"
          >
            Desktop only
          </div>
        ) : null}
      </div>

      {/* Info — uniform height regardless of description presence */}
      <div className={`px-3.5 pb-3.5 pt-1 flex flex-col flex-1 ${infoMinH}`}>
        <h3 className="font-display font-semibold text-[15px] text-white truncate group-hover:text-brand-orange transition-colors">
          {game.title}
        </h3>
        {size !== "sm" && (
          <p className="text-xs text-gray-400 mt-1 line-clamp-2 flex-1 leading-relaxed">
            {game.short_description || " "}
          </p>
        )}
        <div className="flex items-center justify-end mt-2">
          <span
            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
            style={{ color: accentColor, backgroundColor: accentColor + "1f" }}
          >
            {game.difficulty}
          </span>
        </div>
      </div>
    </a>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "../../lib/supabase";
import GameCard from "./GameCard";

type Props = {
  title: string;
  games: Game[];
  accentColor?: string;
  viewAllHref?: string;
};

export default function GameCarousel({ title, games, accentColor = "#ff8800", viewAllHref }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  // The list is re-sorted when the live data replaces the prerendered seed.
  // Without this the row could come up scrolled to the END (first card cut off):
  // always start at the first card when the set of games changes.
  const idKey = games.map((g) => g.id).join(",");
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = 0;
    measure();
  }, [idKey, measure]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = scrollRef.current.clientWidth * 0.8;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  if (!games.length) return null;

  const arrow =
    "p-2 rounded-lg bg-surface-800 border border-surface-600/60 text-gray-300 hover:text-white hover:border-brand-orange/60 transition-all disabled:opacity-30 disabled:pointer-events-none";

  return (
    <section className="relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-7 rounded-full" style={{ backgroundColor: accentColor }} />
          <h2 className="section-title">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {viewAllHref && (
            <a
              href={viewAllHref}
              className="text-sm font-medium text-gray-300 hover:text-brand-orange transition-colors mr-2 inline-flex items-center gap-1"
            >
              View all <span aria-hidden="true">&rarr;</span>
            </a>
          )}
          {(canLeft || canRight) && (
            <>
              <button type="button" aria-label={`Scroll ${title} left`} onClick={() => scroll("left")} disabled={!canLeft} className={arrow}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button type="button" aria-label={`Scroll ${title} right`} onClick={() => scroll("right")} disabled={!canRight} className={arrow}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scroll container */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={measure}
          className="flex items-stretch gap-4 overflow-x-auto scrollbar-hide pb-3 snap-x snap-proximity"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none", overflowAnchor: "none" }}
        >
          {games.map((game) => (
            <div key={game.id} className="w-[220px] sm:w-[240px] flex-shrink-0 snap-start flex">
              <GameCard game={game} size="md" />
            </div>
          ))}
        </div>
        {/* Edge fade hints that the row continues */}
        {canRight && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-3 w-16 bg-gradient-to-l from-surface-900 to-transparent" />
        )}
        {canLeft && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-3 w-10 bg-gradient-to-r from-surface-900 to-transparent" />
        )}
      </div>
    </section>
  );
}

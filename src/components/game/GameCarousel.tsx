import { useRef } from "react";
import type { Game } from "../../lib/supabase";
import GameCard from "./GameCard";

type Props = {
  title: string;
  games: Game[];
  accentColor?: string;
  viewAllHref?: string;
};

export default function GameCarousel({ title, games, accentColor = "#00d4ff", viewAllHref }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = scrollRef.current.clientWidth * 0.8;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  if (!games.length) return null;

  return (
    <section className="relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full" style={{ backgroundColor: accentColor }} />
          <h2 className="font-display font-bold text-xl text-gray-100">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {viewAllHref && (
            <a href={viewAllHref} className="text-sm text-surface-500 hover:text-brand-blue transition-colors mr-2">
              View All
            </a>
          )}
          <button
            onClick={() => scroll("left")}
            className="p-1.5 rounded-lg bg-surface-800 border border-surface-600/50 text-gray-400 hover:text-gray-200 hover:border-brand-blue/50 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => scroll("right")}
            className="p-1.5 rounded-lg bg-surface-800 border border-surface-600/50 text-gray-400 hover:text-gray-200 hover:border-brand-blue/50 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scroll container */}
      <div
        ref={scrollRef}
        className="flex items-stretch gap-4 overflow-x-auto scrollbar-hide pb-2 snap-x snap-mandatory"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {games.map((game) => (
          <div key={game.id} className="min-w-[200px] max-w-[240px] flex-shrink-0 snap-start flex">
            <GameCard game={game} size="md" />
          </div>
        ))}
      </div>
    </section>
  );
}

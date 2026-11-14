import type { Game } from "../../lib/supabase";
import GameCard from "./GameCard";

type Props = {
  games: Game[];
  size?: "sm" | "md" | "lg";
  columns?: 2 | 3 | 4 | 5 | 6;
};

export default function GameGrid({ games, size = "md", columns = 4 }: Props) {
  const gridCols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
    6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
  };

  if (!games.length) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-surface-500 font-medium">No games found</p>
        <p className="text-sm text-surface-500/70 mt-1">Check back soon for new releases!</p>
      </div>
    );
  }

  return (
    <div className={`grid ${gridCols[columns]} gap-4`}>
      {games.map((game) => (
        <GameCard key={game.id} game={game} size={size} />
      ))}
    </div>
  );
}

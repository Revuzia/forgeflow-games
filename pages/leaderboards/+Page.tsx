import { useState, useEffect } from "react";
import { supabase } from "../../src/lib/supabase";
import { getCurrentSeasonWeek } from "../../src/lib/auth";

type LBRow = {
  game_id: number;
  game_title: string;
  game_slug: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  level: number;
  score: number;
  rank: number;
  season_week: string;
};

type GameInfo = { id: number; title: string; slug: string };

const RANK_COLORS = ["#ffd700", "#c0c0c0", "#cd7f32"];

export default function LeaderboardsPage() {
  const [rows, setRows] = useState<LBRow[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [selectedGame, setSelectedGame] = useState<string>("all");
  const [playedGames, setPlayedGames] = useState<GameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const season = getCurrentSeasonWeek();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setSignedIn(!!user);
      if (user) loadAll();
      else setLoading(false);
    });
  }, []);

  async function loadAll() {
    setLoading(true);
    // played_leaderboards RPC returns rows ONLY for games the calling user
    // has played, so we don't need a separate "what did I play" query.
    const { data, error } = await supabase.rpc("played_leaderboards", {
      p_season_week: season,
    });
    if (error) {
      console.error("played_leaderboards error:", error);
      setRows([]);
      setPlayedGames([]);
      setLoading(false);
      return;
    }
    const all = (data || []) as LBRow[];
    setRows(all);
    // Build the per-game filter list from the rows themselves
    const seen = new Map<number, GameInfo>();
    for (const r of all) {
      if (!seen.has(r.game_id)) {
        seen.set(r.game_id, { id: r.game_id, title: r.game_title, slug: r.game_slug });
      }
    }
    setPlayedGames([...seen.values()]);
    setLoading(false);
  }

  // ── NOT SIGNED IN ──
  if (signedIn === false) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="font-display font-bold text-3xl text-white mb-2">Leaderboards</h1>
        <p className="text-sm text-gray-400 mb-6">Season: {season}</p>
        <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-12 text-center">
          <p className="text-lg text-gray-300 mb-2">Sign in to see your leaderboards.</p>
          <p className="text-sm text-gray-500">We only show rankings for the games you've actually played — sign in and play to start climbing.</p>
        </div>
      </div>
    );
  }

  // Group rows by game
  const filteredRows = selectedGame === "all" ? rows : rows.filter(r => String(r.game_id) === selectedGame);
  const grouped = new Map<number, LBRow[]>();
  for (const r of filteredRows) {
    if (!grouped.has(r.game_id)) grouped.set(r.game_id, []);
    grouped.get(r.game_id)!.push(r);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-3xl text-white">Leaderboards</h1>
          <p className="text-sm text-gray-400 mt-1">Season: {season} · Resets every Monday · Only games you've played</p>
        </div>
        {playedGames.length > 0 && (
          <select
            value={selectedGame}
            onChange={(e) => setSelectedGame(e.target.value)}
            className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm text-gray-200
                       focus:outline-none focus:border-brand-orange/50 cursor-pointer"
          >
            <option value="all">All my games</option>
            {playedGames.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        )}
      </div>

      {loading && (
        <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-12 text-center">
          <p className="text-gray-400">Loading leaderboards...</p>
        </div>
      )}

      {!loading && filteredRows.length === 0 && (
        <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-12 text-center">
          <p className="text-lg text-gray-300 mb-2">No leaderboard rows yet.</p>
          <p className="text-sm text-gray-500">Play a game and submit a score to see your rank here.</p>
          <a href="/games" className="inline-block mt-4 px-4 py-2 rounded-lg bg-brand-orange text-white text-sm font-semibold hover:opacity-90">
            Browse games
          </a>
        </div>
      )}

      {!loading && [...grouped.entries()].map(([gameId, gameRows]) => {
        const top = gameRows.slice(0, 50);
        const game = gameRows[0];
        return (
          <div key={gameId} className="bg-surface-800 rounded-xl border border-surface-600/30 overflow-hidden mb-6">
            <div className="px-5 py-3 bg-surface-900/30 border-b border-surface-600/30 flex items-center justify-between">
              <a href={`/games/${game.game_slug}`} className="font-display font-semibold text-white hover:text-brand-orange transition-colors">
                {game.game_title}
              </a>
              <span className="text-xs text-gray-500">{gameRows.length} player{gameRows.length === 1 ? "" : "s"}</span>
            </div>
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-surface-600/30">
                  <th className="px-4 py-2 text-left w-16">Rank</th>
                  <th className="px-4 py-2 text-left">Player</th>
                  <th className="px-4 py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {top.map((entry) => (
                  <tr key={`${entry.game_id}-${entry.user_id}`} className="border-b border-surface-600/10 hover:bg-surface-700/30 transition-colors">
                    <td className="px-4 py-2">
                      <span
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{
                          backgroundColor: entry.rank <= 3 ? RANK_COLORS[entry.rank - 1] + "20" : "transparent",
                          color: entry.rank <= 3 ? RANK_COLORS[entry.rank - 1] : "#888",
                        }}
                      >
                        {entry.rank}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {entry.avatar_url ? (
                          <img src={entry.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                        ) : (
                          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-[10px] font-bold text-white">
                            {entry.level}
                          </span>
                        )}
                        <span className="text-sm font-medium text-gray-200">{entry.username}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-sm font-bold text-white">{entry.score.toLocaleString()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Trophy info — always visible */}
      <div className="mt-6 bg-surface-800 rounded-xl border border-surface-600/30 p-5">
        <h2 className="font-display font-semibold text-white mb-3">Weekly Trophies</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <span className="text-3xl">🏆</span>
            <p className="text-xs text-gray-400 mt-1">Top 1%</p>
            <p className="text-xs text-yellow-400 font-semibold">Gold Trophy</p>
          </div>
          <div>
            <span className="text-3xl">🥈</span>
            <p className="text-xs text-gray-400 mt-1">Top 5%</p>
            <p className="text-xs text-gray-300 font-semibold">Silver Trophy</p>
          </div>
          <div>
            <span className="text-3xl">🥉</span>
            <p className="text-xs text-gray-400 mt-1">Top 10%</p>
            <p className="text-xs text-amber-600 font-semibold">Bronze Trophy</p>
          </div>
        </div>
      </div>
    </div>
  );
}

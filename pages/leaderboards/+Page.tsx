import { useState, useEffect } from "react";
import { supabase } from "../../src/lib/supabase";
import { getCurrentSeasonWeek } from "../../src/lib/auth";

type LeaderboardEntry = {
  user_id: string;
  score: number;
  username: string;
  level: number;
};

export default function LeaderboardsPage() {
  const [scores, setScores] = useState<LeaderboardEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<string>("all");
  const [games, setGames] = useState<any[]>([]);
  const season = getCurrentSeasonWeek();

  useEffect(() => {
    loadGames();
    loadLeaderboard();
  }, [selectedGame]);

  async function loadGames() {
    const { data } = await supabase.from("games").select("id, title, slug").eq("status", "published");
    setGames(data || []);
  }

  async function loadLeaderboard() {
    let query = supabase
      .from("leaderboard_scores")
      .select("user_id, score")
      .eq("season_week", season)
      .order("score", { ascending: false })
      .limit(50);

    if (selectedGame !== "all") {
      query = query.eq("game_id", parseInt(selectedGame));
    }

    const { data } = await query;

    // Fetch usernames for the scores
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(d => d.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, level")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

      setScores(data.map(d => ({
        ...d,
        username: profileMap.get(d.user_id)?.username || "Anonymous",
        level: profileMap.get(d.user_id)?.level || 1,
      })));
    } else {
      setScores([]);
    }
  }

  const RANK_COLORS = ["#ffd700", "#c0c0c0", "#cd7f32"]; // gold, silver, bronze

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-white">Leaderboards</h1>
          <p className="text-sm text-gray-400 mt-1">Season: {season} | Resets every Monday</p>
        </div>

        <select
          value={selectedGame}
          onChange={(e) => setSelectedGame(e.target.value)}
          className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm text-gray-200
                     focus:outline-none focus:border-brand-orange/50 cursor-pointer"
        >
          <option value="all">All Games</option>
          {games.map(g => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
      </div>

      {/* Leaderboard table */}
      <div className="bg-surface-800 rounded-xl border border-surface-600/30 overflow-hidden">
        {scores.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-lg text-gray-400">No scores this week yet.</p>
            <p className="text-sm text-gray-500 mt-2">Play games to climb the leaderboard!</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-surface-600/30">
                <th className="px-4 py-3 text-left w-16">Rank</th>
                <th className="px-4 py-3 text-left">Player</th>
                <th className="px-4 py-3 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((entry, i) => (
                <tr key={i} className="border-b border-surface-600/10 hover:bg-surface-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{
                        backgroundColor: i < 3 ? RANK_COLORS[i] + "20" : "transparent",
                        color: i < 3 ? RANK_COLORS[i] : "#888",
                      }}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-[10px] font-bold text-white">
                        {entry.level}
                      </span>
                      <span className="text-sm font-medium text-gray-200">{entry.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-bold text-white">{entry.score.toLocaleString()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Trophy info */}
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

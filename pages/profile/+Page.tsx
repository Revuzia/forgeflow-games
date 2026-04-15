import { useState, useEffect } from "react";
import { supabase } from "../../src/lib/supabase";
import { getProfile, getXPProgress, type UserProfile } from "../../src/lib/auth";
import type { User } from "@supabase/supabase-js";

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [trophies, setTrophies] = useState<any[]>([]);
  const [recentGames, setRecentGames] = useState<any[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = "/"; return; }
      setUser(user);
      loadData(user.id);
    });
  }, []);

  async function loadData(userId: string) {
    const p = await getProfile(userId);
    setProfile(p);

    const { data: ach } = await supabase
      .from("user_achievements")
      .select("*, achievements(*)")
      .eq("user_id", userId)
      .order("unlocked_at", { ascending: false })
      .limit(20);
    setAchievements(ach || []);

    const { data: troph } = await supabase
      .from("leaderboard_trophies")
      .select("*")
      .eq("user_id", userId)
      .order("awarded_at", { ascending: false })
      .limit(10);
    setTrophies(troph || []);

    const { data: recent } = await supabase
      .from("user_game_activity")
      .select("*, games(*)")
      .eq("user_id", userId)
      .order("last_played_at", { ascending: false })
      .limit(10);
    setRecentGames(recent || []);
  }

  if (!profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-gray-400">Loading profile...</p>
      </div>
    );
  }

  const xp = getXPProgress(profile.xp);
  const playHours = Math.floor(profile.total_play_time_seconds / 3600);
  const playMins = Math.floor((profile.total_play_time_seconds % 3600) / 60);

  const TIER_COLORS: Record<string, string> = {
    bronze: "#cd7f32", silver: "#c0c0c0", gold: "#ffd700", diamond: "#b9f2ff",
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Profile Header */}
      <div className="bg-surface-800 rounded-2xl border border-surface-600/30 p-6 mb-6">
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-3xl font-bold text-white shrink-0">
            {xp.level}
          </div>
          <div className="flex-1">
            <h1 className="font-display font-bold text-2xl text-white">{profile.username || "Player"}</h1>
            <p className="text-sm text-gray-400 mt-1">Level {xp.level} | {profile.games_played} games played | {playHours}h {playMins}m total play time</p>
            <div className="mt-3 w-full max-w-md">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Level {xp.level}</span>
                <span>{xp.current}/{xp.needed} XP</span>
                <span>Level {xp.level + 1}</span>
              </div>
              <div className="w-full h-3 bg-surface-900 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-orange to-[#ff5500] transition-all" style={{ width: `${xp.percent}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Achievements */}
        <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-5">
          <h2 className="font-display font-bold text-lg text-white mb-4">Achievements ({achievements.length})</h2>
          {achievements.length === 0 ? (
            <p className="text-sm text-gray-500">Play games to earn achievements!</p>
          ) : (
            <div className="space-y-3">
              {achievements.map((ua) => (
                <div key={ua.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-900/50">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ backgroundColor: (TIER_COLORS[ua.achievements?.tier] || "#cd7f32") + "30", color: TIER_COLORS[ua.achievements?.tier] || "#cd7f32" }}>
                    {ua.achievements?.points || 5}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-200">{ua.achievements?.name}</p>
                    <p className="text-xs text-gray-500">{ua.achievements?.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trophies */}
        <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-5">
          <h2 className="font-display font-bold text-lg text-white mb-4">Trophies ({trophies.length})</h2>
          {trophies.length === 0 ? (
            <p className="text-sm text-gray-500">Compete in weekly leaderboards to earn trophies!</p>
          ) : (
            <div className="space-y-3">
              {trophies.map((t) => (
                <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-900/50">
                  <span className="text-2xl">{t.trophy_type === "gold" ? "🏆" : t.trophy_type === "silver" ? "🥈" : "🥉"}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-200">#{t.rank_position} — {t.season_week}</p>
                    <p className="text-xs text-gray-500">Top {t.percentile_tier}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Games */}
        <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-5 md:col-span-2">
          <h2 className="font-display font-bold text-lg text-white mb-4">Recently Played</h2>
          {recentGames.length === 0 ? (
            <p className="text-sm text-gray-500">No games played yet. Go play some!</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {recentGames.map((rg) => (
                <a key={rg.id} href={`/games/${rg.games?.slug}`} className="p-3 rounded-lg bg-surface-900/50 hover:bg-surface-700 transition-colors">
                  <p className="text-sm font-medium text-gray-200 truncate">{rg.games?.title}</p>
                  <p className="text-xs text-gray-500 mt-1">{rg.play_count} plays</p>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

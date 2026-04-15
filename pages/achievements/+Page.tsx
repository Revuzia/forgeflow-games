import { useState, useEffect } from "react";
import { supabase } from "../../src/lib/supabase";

export default function AchievementsPage() {
  const [achievements, setAchievements] = useState<any[]>([]);
  const [unlockedIds, setUnlockedIds] = useState<Set<number>>(new Set());
  const [dailyBadge, setDailyBadge] = useState<any>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    loadAchievements();
    loadDailyBadge();
    loadUnlocked();
  }, []);

  async function loadAchievements() {
    const { data } = await supabase
      .from("achievements")
      .select("*, games(title, slug)")
      .order("tier", { ascending: true });
    setAchievements(data || []);
  }

  async function loadDailyBadge() {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("daily_badge")
      .select("*, achievements(*)")
      .eq("active_date", today)
      .single();
    setDailyBadge(data);
  }

  async function loadUnlocked() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("user_achievements")
      .select("achievement_id")
      .eq("user_id", user.id);
    setUnlockedIds(new Set(data?.map(d => d.achievement_id) || []));
  }

  const TIER_CONFIG: Record<string, { label: string; color: string; points: number }> = {
    bronze: { label: "Bronze", color: "#cd7f32", points: 5 },
    silver: { label: "Silver", color: "#c0c0c0", points: 15 },
    gold: { label: "Gold", color: "#ffd700", points: 30 },
    diamond: { label: "Diamond", color: "#b9f2ff", points: 60 },
  };

  const filtered = filter === "all" ? achievements : achievements.filter(a => a.tier === filter);
  const totalPoints = achievements.filter(a => unlockedIds.has(a.id)).reduce((sum, a) => sum + a.points, 0);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-white">Achievements</h1>
          <p className="text-sm text-gray-400 mt-1">
            {unlockedIds.size}/{achievements.length} unlocked | {totalPoints} total points
          </p>
        </div>
        <div className="flex gap-2">
          {["all", "bronze", "silver", "gold", "diamond"].map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filter === t ? "bg-surface-600 text-white" : "bg-surface-800 text-gray-400 hover:text-gray-200"}`}
              style={t !== "all" ? { color: filter === t ? TIER_CONFIG[t]?.color : undefined } : {}}
            >
              {t === "all" ? "All" : TIER_CONFIG[t]?.label}
            </button>
          ))}
        </div>
      </div>

      {/* Badge of the Day */}
      {dailyBadge && (
        <div className="bg-gradient-to-r from-brand-orange/10 to-[#ff5500]/10 border border-brand-orange/30 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl">⭐</span>
            <div>
              <p className="text-xs text-brand-orange font-bold uppercase tracking-wider">Badge of the Day — 2x Points!</p>
              <p className="text-lg font-bold text-white mt-1">{dailyBadge.achievements?.name}</p>
              <p className="text-sm text-gray-400">{dailyBadge.achievements?.description}</p>
            </div>
          </div>
        </div>
      )}

      {/* Achievements grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400">No achievements yet. Games will add achievements as they're built!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((ach) => {
            const unlocked = unlockedIds.has(ach.id);
            const tier = TIER_CONFIG[ach.tier] || TIER_CONFIG.bronze;
            return (
              <div
                key={ach.id}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${unlocked ? "bg-surface-800 border-surface-600/50" : "bg-surface-800/50 border-surface-600/20 opacity-60"}`}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
                  style={{ backgroundColor: tier.color + "20", color: tier.color }}
                >
                  {unlocked ? "✓" : ach.points}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-200 truncate">{ach.secret && !unlocked ? "???" : ach.name}</p>
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ color: tier.color, backgroundColor: tier.color + "15" }}>
                      {tier.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{ach.secret && !unlocked ? "Secret achievement" : ach.description}</p>
                  {ach.games && (
                    <a href={`/games/${ach.games.slug}`} className="text-[10px] text-brand-orange hover:underline">{ach.games.title}</a>
                  )}
                </div>
                <span className="text-xs text-gray-500 font-semibold shrink-0">{ach.points} XP</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

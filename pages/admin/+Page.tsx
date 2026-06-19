import { useState, useEffect } from "react";
import { supabase } from "../../src/lib/supabase";

// Admins who can see the ForgeFlow Games dashboard. (Profiles are public-read, so
// this gate is access-UX; no sensitive data — usernames/levels/play-time are public.)
const ADMIN_EMAILS = ["forgeflowlabs1@gmail.com", "forgeflowgames1@gmail.com", "isimcha85@gmail.com"];

type Profile = {
  id: string;
  username: string | null;
  level: number;
  xp: number;
  total_play_time_seconds: number;
  games_played: number;
  is_online: boolean;
  last_seen_at: string;
  created_at: string;
  avatar_url: string | null;
};

function fmtDur(sec: number): string {
  sec = sec || 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m`;
  return `${Math.floor(sec)}s`;
}
function timeAgo(iso: string): string {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}
function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</div>;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-display font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function AdminPage() {
  const [authState, setAuthState] = useState<"checking" | "denied" | "ok">("checking");
  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const email = (user?.email || "").toLowerCase();
      if (user && ADMIN_EMAILS.includes(email)) {
        setAuthState("ok");
        load();
      } else {
        setAuthState("denied");
      }
    });
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id,username,level,xp,total_play_time_seconds,games_played,is_online,last_seen_at,created_at,avatar_url")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) console.error("admin profiles load error:", error);
    setRows((data || []) as Profile[]);
    setLoading(false);
  }

  if (authState === "checking") {
    return <Wrap><p className="text-gray-400">Checking access…</p></Wrap>;
  }
  if (authState === "denied") {
    return (
      <Wrap>
        <h1 className="font-display font-bold text-3xl text-white mb-2">Admin Dashboard</h1>
        <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-12 text-center mt-4">
          <p className="text-lg text-gray-300 mb-2">Restricted area.</p>
          <p className="text-sm text-gray-500">Sign in with a ForgeFlow Games admin account to view player analytics.</p>
        </div>
      </Wrap>
    );
  }

  const now = Date.now();
  const dayAgo = now - 86400000, weekAgo = now - 7 * 86400000;
  const total = rows.length;
  const online = rows.filter(r => r.is_online).length;
  const totalPlay = rows.reduce((s, r) => s + (r.total_play_time_seconds || 0), 0);
  const totalGames = rows.reduce((s, r) => s + (r.games_played || 0), 0);
  const newToday = rows.filter(r => new Date(r.created_at).getTime() > dayAgo).length;
  const newWeek = rows.filter(r => new Date(r.created_at).getTime() > weekAgo).length;
  const active7 = rows.filter(r => new Date(r.last_seen_at).getTime() > weekAgo).length;
  const recent = rows.slice(0, 12);
  const topPlay = [...rows].sort((a, b) => (b.total_play_time_seconds || 0) - (a.total_play_time_seconds || 0)).slice(0, 12);

  return (
    <Wrap>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-3xl text-white">Admin Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">ForgeFlow Games · player analytics</p>
        </div>
        <button onClick={load} className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm text-gray-200 hover:border-brand-orange/50">
          ↻ Refresh
        </button>
      </div>

      {loading && <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-12 text-center"><p className="text-gray-400">Loading…</p></div>}

      {!loading && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Stat label="Total players" value={total.toLocaleString()} sub={`${newToday} new today · ${newWeek} this week`} />
            <Stat label="Online now" value={online.toLocaleString()} sub={`${active7} active this week`} />
            <Stat label="Total play time" value={fmtDur(totalPlay)} sub={total ? `avg ${fmtDur(totalPlay / total)}/player` : ""} />
            <Stat label="Games played" value={totalGames.toLocaleString()} sub="sessions across all games" />
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* Recent signups */}
            <div className="bg-surface-800 rounded-xl border border-surface-600/30 overflow-hidden">
              <div className="px-5 py-3 bg-surface-900/30 border-b border-surface-600/30">
                <h2 className="font-display font-semibold text-white">Recent signups</h2>
              </div>
              <table className="w-full">
                <tbody>
                  {recent.map(r => (
                    <tr key={r.id} className="border-b border-surface-600/10">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-[10px] font-bold text-white">{r.level}</span>
                          <span className="text-sm text-gray-200">{r.username || "player"}</span>
                          {r.is_online && <span className="w-2 h-2 rounded-full bg-green-400" title="online" />}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-400">{fmtDate(r.created_at)}</td>
                    </tr>
                  ))}
                  {recent.length === 0 && <tr><td className="px-4 py-6 text-center text-sm text-gray-500">No players yet.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Most active */}
            <div className="bg-surface-800 rounded-xl border border-surface-600/30 overflow-hidden">
              <div className="px-5 py-3 bg-surface-900/30 border-b border-surface-600/30">
                <h2 className="font-display font-semibold text-white">Most active (play time)</h2>
              </div>
              <table className="w-full">
                <tbody>
                  {topPlay.map(r => (
                    <tr key={r.id} className="border-b border-surface-600/10">
                      <td className="px-4 py-2 text-sm text-gray-200">{r.username || "player"}</td>
                      <td className="px-4 py-2 text-right text-sm font-semibold text-white">{fmtDur(r.total_play_time_seconds)}</td>
                      <td className="px-4 py-2 text-right text-xs text-gray-400">{r.games_played} games</td>
                    </tr>
                  ))}
                  {topPlay.length === 0 && <tr><td className="px-4 py-6 text-center text-sm text-gray-500">No play time yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Full player list */}
          <div className="bg-surface-800 rounded-xl border border-surface-600/30 overflow-hidden">
            <div className="px-5 py-3 bg-surface-900/30 border-b border-surface-600/30 flex items-center justify-between">
              <h2 className="font-display font-semibold text-white">All players</h2>
              <span className="text-xs text-gray-500">{total} total</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase border-b border-surface-600/30">
                    <th className="px-4 py-2 text-left">Player</th>
                    <th className="px-4 py-2 text-right">Level</th>
                    <th className="px-4 py-2 text-right">XP</th>
                    <th className="px-4 py-2 text-right">Play time</th>
                    <th className="px-4 py-2 text-right">Games</th>
                    <th className="px-4 py-2 text-right">Last seen</th>
                    <th className="px-4 py-2 text-right">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-surface-600/10 hover:bg-surface-700/30">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-200">{r.username || "player"}</span>
                          {r.is_online && <span className="w-2 h-2 rounded-full bg-green-400" title="online" />}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-300">{r.level}</td>
                      <td className="px-4 py-2 text-right text-sm text-gray-300">{(r.xp || 0).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-sm text-gray-300">{fmtDur(r.total_play_time_seconds)}</td>
                      <td className="px-4 py-2 text-right text-sm text-gray-300">{r.games_played}</td>
                      <td className="px-4 py-2 text-right text-xs text-gray-400">{timeAgo(r.last_seen_at)}</td>
                      <td className="px-4 py-2 text-right text-xs text-gray-400">{fmtDate(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-600 mt-4">Live from the player database. (Emails + exact sign-in history aren't shown here — they need a secure server function; say the word and I'll add it.)</p>
        </>
      )}
    </Wrap>
  );
}

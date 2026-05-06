import { useState, useEffect } from "react";
import { supabase } from "../../src/lib/supabase";

export default function FriendsPage() {
  const [friends, setFriends] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = "/"; return; }
      setUserId(user.id);
      loadFriends(user.id);
    });
  }, []);

  async function loadFriends(uid: string) {
    // Accepted friends
    const { data: accepted } = await supabase
      .from("friendships")
      .select("friend_id")
      .eq("user_id", uid)
      .eq("status", "accepted");

    if (accepted && accepted.length > 0) {
      const friendIds = accepted.map(f => f.friend_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("*")
        .in("id", friendIds);
      setFriends(profiles || []);
    }

    // Pending requests received
    const { data: pendingReqs } = await supabase
      .from("friendships")
      .select("user_id")
      .eq("friend_id", uid)
      .eq("status", "pending");

    if (pendingReqs && pendingReqs.length > 0) {
      const reqIds = pendingReqs.map(p => p.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("*")
        .in("id", reqIds);
      setPending(profiles || []);
    }
  }

  async function searchUsers() {
    const q = searchQuery.trim();
    if (!q) return;
    // find_users RPC: matches exact email OR partial username. Email match
    // requires a SECURITY DEFINER function because auth.users isn't anon-readable.
    const { data, error } = await supabase.rpc("find_users", { query: q });
    if (error) {
      console.error("find_users error:", error);
      setSearchResults([]);
      return;
    }
    setSearchResults((data || []).filter((u: any) => u.id !== userId));
  }

  async function sendRequest(friendId: string) {
    if (!userId) return;
    await supabase.from("friendships").insert({
      user_id: userId,
      friend_id: friendId,
      status: "pending",
    });
    setSearchResults(prev => prev.filter(p => p.id !== friendId));
  }

  async function acceptRequest(fromUserId: string) {
    if (!userId) return;
    // Update their request
    await supabase.from("friendships")
      .update({ status: "accepted" })
      .eq("user_id", fromUserId)
      .eq("friend_id", userId);
    // Create reciprocal friendship
    await supabase.from("friendships").upsert({
      user_id: userId,
      friend_id: fromUserId,
      status: "accepted",
    });
    loadFriends(userId);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-display font-bold text-3xl text-white mb-6">Friends</h1>

      {/* Search users */}
      <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-5 mb-6">
        <h2 className="font-display font-semibold text-white mb-3">Find Players</h2>
        <form onSubmit={(e) => { e.preventDefault(); searchUsers(); }} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by username or email..."
            className="flex-1 px-4 py-2 rounded-lg bg-surface-900 border border-surface-600/50 text-sm text-gray-100
                       placeholder-gray-500 focus:outline-none focus:border-brand-orange/50"
          />
          <button type="submit" className="px-4 py-2 rounded-lg bg-brand-orange text-white text-sm font-semibold hover:opacity-90">
            Search
          </button>
        </form>
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-2">
            {searchResults.map(u => (
              <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-900/50">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-xs font-bold text-white">
                    {u.level}
                  </span>
                  <span className="text-sm text-gray-200">{u.username}</span>
                </div>
                <button onClick={() => sendRequest(u.id)} className="px-3 py-1 rounded text-xs font-semibold bg-brand-orange/20 text-brand-orange hover:bg-brand-orange/30">
                  Add Friend
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending requests */}
      {pending.length > 0 && (
        <div className="bg-surface-800 rounded-xl border border-brand-orange/30 p-5 mb-6">
          <h2 className="font-display font-semibold text-brand-orange mb-3">Friend Requests ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map(u => (
              <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-900/50">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-xs font-bold text-white">
                    {u.level}
                  </span>
                  <span className="text-sm text-gray-200">{u.username}</span>
                </div>
                <button onClick={() => acceptRequest(u.id)} className="px-3 py-1 rounded text-xs font-semibold bg-green-600/20 text-green-400 hover:bg-green-600/30">
                  Accept
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friends list */}
      <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-5">
        <h2 className="font-display font-semibold text-white mb-3">Your Friends ({friends.length})</h2>
        {friends.length === 0 ? (
          <p className="text-sm text-gray-500">No friends yet. Search for players above!</p>
        ) : (
          <div className="space-y-2">
            {friends.map(f => (
              <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-900/50">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <span className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-sm font-bold text-white">
                      {f.level}
                    </span>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-800 ${f.is_online ? "bg-green-400" : "bg-gray-600"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-200">{f.username}</p>
                    <p className="text-xs text-gray-500">
                      {f.is_online ? (
                        f.current_game_slug ? (
                          <span className="text-green-400">Playing <a href={`/games/${f.current_game_slug}`} className="underline">{f.current_game_slug}</a></span>
                        ) : (
                          <span className="text-green-400">Online</span>
                        )
                      ) : "Offline"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

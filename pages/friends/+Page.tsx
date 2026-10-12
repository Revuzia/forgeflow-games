import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../src/lib/supabase";

type Person = { id: string; username?: string; level?: number; is_online?: boolean; current_game_slug?: string | null };
type Notice = { kind: "ok" | "error"; text: string } | null;

function Avatar({ person, size = 40 }: { person: Person; size?: number }) {
  const initial = (person.username || "?").trim().charAt(0).toUpperCase();
  return (
    <span
      className="relative shrink-0 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center font-display font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
      {typeof person.is_online === "boolean" && (
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-800 ${person.is_online ? "bg-green-400" : "bg-gray-500"}`} />
      )}
    </span>
  );
}

function PersonRow({ person, children }: { person: Person; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-900/60 border border-surface-600/30">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar person={person} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{person.username || "Player"}</p>
          <p className="text-xs text-gray-400">
            Level {person.level ?? 1}
            {person.is_online ? (
              person.current_game_slug ? (
                <>
                  {" · "}
                  <span className="text-green-400">
                    Playing <a href={`/games/${person.current_game_slug}`} className="underline">{person.current_game_slug}</a>
                  </span>
                </>
              ) : (
                <span className="text-green-400">{" · Online"}</span>
              )
            ) : null}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

export default function FriendsPage() {
  const [friends, setFriends] = useState<Person[]>([]);
  const [incoming, setIncoming] = useState<Person[]>([]);
  const [outgoing, setOutgoing] = useState<Person[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Person[] | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // Everything is derived from the friendships rows that involve me, in either
  // direction. (Accepting used to depend on a second "mirror" row being created,
  // and the lists only updated when they were NON-empty, so the last request
  // never left the screen and a half-finished accept looked like a dead button.)
  const loadFriends = useCallback(async (uid: string) => {
    const { data: rows, error } = await supabase
      .from("friendships")
      .select("user_id, friend_id, status")
      .or(`user_id.eq.${uid},friend_id.eq.${uid}`);
    if (error) {
      setNotice({ kind: "error", text: "Couldn't load your friends. Please refresh the page." });
      return;
    }
    const other = (r: { user_id: string; friend_id: string }) => (r.user_id === uid ? r.friend_id : r.user_id);
    const accepted = new Set<string>();
    for (const r of rows || []) if (r.status === "accepted") accepted.add(other(r));
    const inc = new Set<string>();
    const out = new Set<string>();
    for (const r of rows || []) {
      if (r.status !== "pending" || accepted.has(other(r))) continue;
      (r.friend_id === uid ? inc : out).add(other(r));
    }
    const ids = Array.from(new Set([...accepted, ...inc, ...out]));
    let profiles: Person[] = [];
    if (ids.length) {
      const { data } = await supabase.from("profiles").select("*").in("id", ids);
      profiles = (data || []) as Person[];
    }
    const pick = (set: Set<string>) => profiles.filter((p) => set.has(p.id));
    setFriends(pick(accepted));
    setIncoming(pick(inc));
    setOutgoing(pick(out));
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = "/"; return; }
      setUserId(user.id);
      loadFriends(user.id);
    });
  }, [loadFriends]);

  async function searchUsers() {
    const q = searchQuery.trim();
    if (!q) return;
    setNotice(null);
    // find_users RPC: matches exact email OR partial username. Email match
    // requires a SECURITY DEFINER function because auth.users isn't anon-readable.
    const { data, error } = await supabase.rpc("find_users", { query: q });
    if (error) {
      console.error("find_users error:", error);
      setSearchResults([]);
      setNotice({ kind: "error", text: "Search failed. Please try again." });
      return;
    }
    const known = new Set([...friends, ...incoming, ...outgoing].map((p) => p.id));
    setSearchResults((data || []).filter((u: Person) => u.id !== userId && !known.has(u.id)));
  }

  async function run(key: string, fn: () => Promise<Notice>) {
    if (!userId || busy) return;
    setBusy(key);
    try {
      setNotice(await fn());
    } catch (e) {
      console.error(e);
      setNotice({ kind: "error", text: "Something went wrong. Please try again." });
    }
    await loadFriends(userId);
    setBusy(null);
  }

  const sendRequest = (p: Person) => run(`send-${p.id}`, async () => {
    const { error } = await supabase.from("friendships").insert({ user_id: userId, friend_id: p.id, status: "pending" });
    setSearchResults((prev) => (prev || []).filter((x) => x.id !== p.id));
    if (error && error.code !== "23505") return { kind: "error", text: "Couldn't send the request. Please try again." };
    return { kind: "ok", text: `Friend request sent to ${p.username || "that player"}.` };
  });

  const acceptRequest = (p: Person) => run(`accept-${p.id}`, async () => {
    const { data, error } = await supabase
      .from("friendships")
      .update({ status: "accepted" })
      .eq("user_id", p.id)
      .eq("friend_id", userId)
      .select("id");
    if (error || !data || data.length === 0) {
      return { kind: "error", text: "Couldn't accept that request. It may have been withdrawn, so please refresh." };
    }
    // Mirror row so both sides list each other. Non-fatal: the lists above read
    // both directions, so the friendship is already complete without it.
    const mirror = await supabase
      .from("friendships")
      .upsert({ user_id: userId, friend_id: p.id, status: "accepted" }, { onConflict: "user_id,friend_id" });
    if (mirror.error) console.warn("friendship mirror row:", mirror.error.message);
    return { kind: "ok", text: `You and ${p.username || "that player"} are now friends.` };
  });

  const removeRow = (p: Person, mine: boolean, okText: string) => run(`rm-${p.id}`, async () => {
    const q = supabase.from("friendships").delete();
    const { error } = await (mine
      ? q.eq("user_id", userId).eq("friend_id", p.id)
      : q.eq("user_id", p.id).eq("friend_id", userId));
    if (error) return { kind: "error", text: "That didn't work. Please try again." };
    return { kind: "ok", text: okText };
  });

  const btn = "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-display font-bold text-3xl sm:text-4xl text-white tracking-tight mb-1">Friends</h1>
      <p className="text-gray-400 mb-6">See who's online and what they're playing.</p>

      {notice && (
        <div
          role="status"
          className={`mb-6 rounded-xl px-4 py-3 text-sm border ${
            notice.kind === "ok"
              ? "bg-green-500/10 border-green-500/30 text-green-300"
              : "bg-red-500/10 border-red-500/30 text-red-300"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Incoming requests first: it's the thing a player came to act on */}
      {incoming.length > 0 && (
        <div className="surface-panel border-brand-orange/40 p-5 mb-6">
          <h2 className="font-display font-semibold text-lg text-brand-orange mb-3">Friend requests ({incoming.length})</h2>
          <div className="space-y-2">
            {incoming.map((p) => (
              <PersonRow key={p.id} person={p}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => acceptRequest(p)}
                  className={`${btn} bg-green-500 text-white hover:bg-green-400`}
                >
                  {busy === `accept-${p.id}` ? "Accepting…" : "Accept"}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => removeRow(p, false, "Request declined.")}
                  className={`${btn} bg-surface-700 text-gray-200 hover:bg-surface-600`}
                >
                  Decline
                </button>
              </PersonRow>
            ))}
          </div>
        </div>
      )}

      {/* Find players */}
      <div className="surface-panel p-5 mb-6">
        <h2 className="font-display font-semibold text-lg text-white mb-3">Find players</h2>
        <form onSubmit={(e) => { e.preventDefault(); searchUsers(); }} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by username or email…"
            className="flex-1 px-4 py-2.5 rounded-xl bg-surface-900 border border-surface-600/50 text-sm text-gray-100
                       placeholder-gray-500 focus:outline-none focus:border-brand-orange/60"
          />
          <button type="submit" className="px-5 py-2.5 rounded-xl bg-brand-orange text-white text-sm font-semibold hover:brightness-110">
            Search
          </button>
        </form>
        {searchResults && (
          <div className="mt-3 space-y-2">
            {searchResults.length === 0 ? (
              <p className="text-sm text-gray-400">No new players found for that search.</p>
            ) : (
              searchResults.map((u) => (
                <PersonRow key={u.id} person={u}>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => sendRequest(u)}
                    className={`${btn} bg-brand-orange/20 text-brand-orange hover:bg-brand-orange/30`}
                  >
                    Add friend
                  </button>
                </PersonRow>
              ))
            )}
          </div>
        )}
      </div>

      {/* Sent requests */}
      {outgoing.length > 0 && (
        <div className="surface-panel p-5 mb-6">
          <h2 className="font-display font-semibold text-lg text-white mb-3">Sent requests ({outgoing.length})</h2>
          <div className="space-y-2">
            {outgoing.map((p) => (
              <PersonRow key={p.id} person={p}>
                <span className="text-xs text-gray-400">Waiting for a reply</span>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => removeRow(p, true, "Request cancelled.")}
                  className={`${btn} bg-surface-700 text-gray-200 hover:bg-surface-600`}
                >
                  Cancel
                </button>
              </PersonRow>
            ))}
          </div>
        </div>
      )}

      {/* Friends list */}
      <div className="surface-panel p-5">
        <h2 className="font-display font-semibold text-lg text-white mb-3">Your friends ({friends.length})</h2>
        {friends.length === 0 ? (
          <p className="text-sm text-gray-400">No friends yet. Search for players above.</p>
        ) : (
          <div className="space-y-2">
            {friends.map((f) => (
              <PersonRow key={f.id} person={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

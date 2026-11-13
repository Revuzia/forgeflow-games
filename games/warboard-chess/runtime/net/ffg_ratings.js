/**
 * FFG runtime — net/ffg_ratings.js
 * Win/loss + Elo ranking client. Reads the logged-in ForgeFlow profile (same-origin
 * Supabase Auth session that the portal created), fetches a player's per-game rating,
 * and reports an ONLINE match result via the SECURITY DEFINER RPC `report_match_result`
 * (server computes Elo + W/L, idempotent by match_id — see migration 0004).
 *
 * Ratings ONLY change from online games vs another logged-in player. Anonymous players
 * (not signed in) can still play online — they're just unrated. vs-AI never reports.
 */

// Same project the portal + multiplayer use. ANON/publishable key is public by design.
export const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

let _sb = null;
async function sb() {
  if (_sb) return _sb;
  const mod = await import("https://esm.sh/@supabase/supabase-js@2");
  const createClient = mod.createClient || (mod.default && mod.default.createClient);
  // Default options → same localStorage session key the portal uses (same origin),
  // so getUser() resolves the player who logged in on forgeflowgames.com.
  _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _sb;
}

/** The logged-in player {id, username}, or null if not signed in. */
export async function currentPlayer() {
  try {
    const c = await sb();
    const { data: { user } } = await c.auth.getUser();
    if (!user) return null;
    let username = (user.user_metadata && (user.user_metadata.username || user.user_metadata.name)) ||
      (user.email ? user.email.split("@")[0] : null);
    try {
      const { data } = await c.from("profiles").select("username").eq("id", user.id).single();
      if (data && data.username) username = data.username;
    } catch (e) {}
    return { id: user.id, username: username || ("player_" + user.id.slice(0, 8)) };
  } catch (e) { return null; }
}

const DEFAULT_RATING = { rating: 1200, peak_rating: 1200, wins: 0, losses: 0, draws: 0, games_played: 0 };

/** A player's per-game rating row (defaults if none / table missing). */
export async function getRating(userId, gameSlug) {
  if (!userId) return { ...DEFAULT_RATING };
  try {
    const c = await sb();
    const { data } = await c.from("game_ratings")
      .select("rating,peak_rating,wins,losses,draws,games_played")
      .eq("user_id", userId).eq("game_slug", gameSlug).single();
    return data || { ...DEFAULT_RATING };
  } catch (e) { return { ...DEFAULT_RATING }; }
}

/** Report a finished ONLINE match. result = 'white'|'black'|'draw'. Returns deltas or null. */
export async function reportResult(gameSlug, whiteId, blackId, result, matchId) {
  if (!whiteId || !blackId || whiteId === blackId) return null;
  try {
    const c = await sb();
    const { data, error } = await c.rpc("report_match_result", {
      p_game: gameSlug, p_white: whiteId, p_black: blackId, p_result: result, p_match_id: matchId,
    });
    if (error) { try { console.warn("[ratings] report failed:", error.message); } catch (e) {} return null; }
    return data;
  } catch (e) { return null; }
}

/** Rating → rank tier {name,color,min} (Novice … Grandmaster). */
export function rankTier(rating) {
  const T = [
    [2200, "Grandmaster", "#e9d5ff"], [2000, "Master", "#fca5a5"], [1800, "Expert", "#fdba74"],
    [1600, "Advanced", "#fde047"], [1400, "Skilled", "#86efac"], [1200, "Intermediate", "#67e8f9"],
    [1000, "Apprentice", "#93c5fd"], [0, "Novice", "#cbd5e1"],
  ];
  for (const [min, name, color] of T) if ((rating || 1200) >= min) return { name, color, min };
  return { name: "Novice", color: "#cbd5e1", min: 0 };
}

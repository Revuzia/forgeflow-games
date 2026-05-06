/**
 * Game-to-Portal PostMessage Bridge
 *
 * Games in iframes send messages to the portal. The portal handles:
 * - Score submission to leaderboards
 * - Achievement unlocking
 * - Play time tracking for XP
 * - Cloud save sync
 * - Online status ("currently playing X")
 *
 * Games send: window.parent.postMessage({ type: "forgeflow:...", ... }, "*")
 * Portal listens and routes to the appropriate Supabase table.
 */

import { supabase } from "./supabase";
import { addXP, setOnlineStatus, submitScore, addRecentlyPlayed, getCurrentSeasonWeek } from "./auth";
// addXP is still imported because unlockAchievement() inside this file
// still calls it — that's the ONE remaining XP source by design.

let currentUserId: string | null = null;
let currentGameId: number | null = null;
let currentGameSlug: string | null = null;
let playStartTime: number | null = null;
let playTimeInterval: ReturnType<typeof setInterval> | null = null;

export function initGameBridge(gameSlug: string, gameId: number) {
  currentGameSlug = gameSlug;
  currentGameId = gameId;
  playStartTime = Date.now();

  // Track recently played (works for guests too)
  addRecentlyPlayed(gameSlug);

  // Get user for authenticated features
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (user) {
      currentUserId = user.id;
      setOnlineStatus(user.id, true, gameSlug);

      // 2026-05-06 — log the recently-played row IMMEDIATELY on game start.
      // Previously we only upserted every 5 minutes, so a quick play left
      // no trace and the profile's "Recently Played" list stayed empty.
      // Subsequent ticks update last_played_at + total_play_seconds; this
      // first call is the one that establishes the row.
      supabase.from("user_game_activity").upsert({
        user_id: currentUserId,
        game_id: currentGameId,
        last_played_at: new Date().toISOString(),
        total_play_seconds: 0,
        play_count: 1,
      }, { onConflict: "user_id,game_id" });

      // 2026-05-06 — XP comes ONLY from earned achievements now. Previously
      // we credited 1 XP per 5 minutes of play time, which made the user
      // level up while their achievements page still showed 0/71 earned.
      // The two now stay in lockstep: total XP === sum of achievement
      // points the user has unlocked. Activity row is still refreshed
      // for "Recently Played" tracking — just no XP side-effect.
      playTimeInterval = setInterval(() => {
        if (currentUserId) {
          supabase.from("user_game_activity").upsert({
            user_id: currentUserId,
            game_id: currentGameId,
            last_played_at: new Date().toISOString(),
            total_play_seconds: Math.floor((Date.now() - (playStartTime || Date.now())) / 1000),
            play_count: 1,
          }, { onConflict: "user_id,game_id" });
        }
      }, 300_000);
    }
  });

  // Listen for messages from game iframe
  window.addEventListener("message", handleGameMessage);
}

export function destroyGameBridge() {
  window.removeEventListener("message", handleGameMessage);
  if (playTimeInterval) clearInterval(playTimeInterval);

  // Set offline
  if (currentUserId) {
    setOnlineStatus(currentUserId, true, null); // Still online, just not in a game
  }

  currentGameSlug = null;
  currentGameId = null;
  playStartTime = null;
}

function handleGameMessage(event: MessageEvent) {
  if (!event.data || typeof event.data !== "object" || !event.data.type) return;
  if (!event.data.type.startsWith("forgeflow:")) return;

  const { type, ...payload } = event.data;

  switch (type) {
    case "forgeflow:score":
      // Game reports a score for the leaderboard
      if (currentUserId && currentGameId && payload.score) {
        submitScore(currentUserId, currentGameId, payload.score);
      }
      break;

    case "forgeflow:achievement":
      // Game reports an achievement unlock — by numeric id OR by slug.
      // The SDK prefers slug because games don't know DB ids at build time.
      if (currentUserId && payload.achievementId) {
        unlockAchievement(currentUserId, payload.achievementId);
      } else if (currentUserId && payload.achievementSlug && currentGameId) {
        unlockAchievementBySlug(currentUserId, currentGameId, payload.achievementSlug);
      }
      break;

    case "forgeflow:level_complete":
      // Level completed — submit score to leaderboards. Good time for an
      // interstitial ad. NO direct XP grant: XP only flows from earned
      // achievements (by design). Games that want XP for "completed level N"
      // should declare it as an achievement (`level_5`, `world_1` etc.) and
      // grant it via ForgeFlow.unlockAchievement().
      if (currentUserId && payload.score) {
        submitScore(currentUserId, currentGameId!, payload.score);
      }
      break;

    case "forgeflow:game_over":
      // Game over — submit final score
      if (currentUserId && payload.score) {
        submitScore(currentUserId, currentGameId!, payload.score);
      }
      break;

    case "forgeflow:save":
      // Cloud save
      if (currentUserId && currentGameId && payload.data) {
        saveGameData(currentUserId, currentGameId, payload.data, payload.slot || 1);
      }
      break;

    case "forgeflow:load":
      // Load cloud save — respond back to game. Echo _reqId so the SDK can
      // correlate concurrent loads to their Promise resolvers.
      if (currentUserId && currentGameId) {
        const reqId = payload._reqId;
        loadGameData(currentUserId, currentGameId, payload.slot || 1).then(data => {
          const iframe = document.querySelector("iframe");
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage({
              type: "forgeflow:save_loaded",
              data,
              _reqId: reqId,
            }, "*");
          }
        });
      }
      break;
  }
}

async function unlockAchievementBySlug(userId: string, gameId: number, slug: string) {
  const { data } = await supabase
    .from("achievements")
    .select("id")
    .eq("game_id", gameId)
    .eq("slug", slug)
    .single();
  if (data?.id) await unlockAchievement(userId, data.id);
}

async function unlockAchievement(userId: string, achievementId: number) {
  // Check if already unlocked
  const { data: existing } = await supabase
    .from("user_achievements")
    .select("id")
    .eq("user_id", userId)
    .eq("achievement_id", achievementId)
    .single();

  if (existing) return; // Already unlocked

  // Get achievement details for XP
  const { data: ach } = await supabase
    .from("achievements")
    .select("points, tier")
    .eq("id", achievementId)
    .single();

  if (!ach) return;

  // Check if this is Badge of the Day (2x points)
  const today = new Date().toISOString().split("T")[0];
  const { data: daily } = await supabase
    .from("daily_badge")
    .select("bonus_multiplier")
    .eq("achievement_id", achievementId)
    .eq("active_date", today)
    .single();

  const multiplier = daily?.bonus_multiplier || 1;
  const xpGain = ach.points * multiplier;

  // Unlock
  await supabase.from("user_achievements").insert({
    user_id: userId,
    achievement_id: achievementId,
  });

  // Award XP
  await addXP(userId, xpGain, `achievement_${achievementId}`);
}

async function saveGameData(userId: string, gameId: number, data: any, slot: number) {
  await supabase.from("game_saves").upsert({
    user_id: userId,
    game_id: gameId,
    save_data: data,
    slot,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,game_id,slot" });
}

async function loadGameData(userId: string, gameId: number, slot: number): Promise<any> {
  const { data } = await supabase
    .from("game_saves")
    .select("save_data")
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .eq("slot", slot)
    .single();
  return data?.save_data || null;
}

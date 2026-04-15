import { supabase } from "./supabase";
import type { User } from "@supabase/supabase-js";

export type UserProfile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  level: number;
  xp: number;
  total_play_time_seconds: number;
  games_played: number;
  is_online: boolean;
  current_game_slug: string | null;
  created_at: string;
};

// ── Auth Functions ──

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string, username: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) throw error;

  // Create profile
  if (data.user) {
    await supabase.from("profiles").upsert({
      id: data.user.id,
      username,
      level: 1,
      xp: 0,
    });
  }
  return data;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  // Set offline before signing out
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from("profiles").update({
      is_online: false,
      current_game_slug: null,
    }).eq("id", user.id);
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) return null;
  return data;
}

// ── XP & Leveling System ──
// Based on Kongregate/Newgrounds research:
// XP from: achievements (5-60 pts), daily badge (2x), play time (1 XP per 5 min)
// Slow curve — months to reach 50, not weeks.

const XP_PER_LEVEL = [
  0,     // Level 1 (start)
  100,   // Level 2
  250,   // Level 3
  450,   // Level 4
  700,   // Level 5
  1000,  // Level 6
  1400,  // Level 7
  1900,  // Level 8
  2500,  // Level 9
  3200,  // Level 10
  // Levels 11-50 follow formula: 3200 + (level-10) * 500 + (level-10)^2 * 50
];

// Fill levels 11-50
for (let i = 11; i <= 50; i++) {
  XP_PER_LEVEL.push(3200 + (i - 10) * 500 + Math.pow(i - 10, 2) * 50);
}

export function getLevelFromXP(xp: number): number {
  for (let i = XP_PER_LEVEL.length - 1; i >= 0; i--) {
    if (xp >= XP_PER_LEVEL[i]) return i + 1;
  }
  return 1;
}

export function getXPForNextLevel(currentLevel: number): number {
  if (currentLevel >= 50) return XP_PER_LEVEL[49];
  return XP_PER_LEVEL[currentLevel]; // XP needed for next level
}

export function getXPProgress(xp: number): { level: number; current: number; needed: number; percent: number } {
  const level = getLevelFromXP(xp);
  const currentLevelXP = XP_PER_LEVEL[level - 1] || 0;
  const nextLevelXP = XP_PER_LEVEL[level] || XP_PER_LEVEL[XP_PER_LEVEL.length - 1];
  const current = xp - currentLevelXP;
  const needed = nextLevelXP - currentLevelXP;
  return {
    level,
    current,
    needed,
    percent: Math.min(100, Math.round((current / needed) * 100)),
  };
}

export async function addXP(userId: string, amount: number, reason: string) {
  const profile = await getProfile(userId);
  if (!profile) return;

  const newXP = profile.xp + amount;
  const oldLevel = getLevelFromXP(profile.xp);
  const newLevel = getLevelFromXP(newXP);

  await supabase.from("profiles").update({
    xp: newXP,
    level: newLevel,
  }).eq("id", userId);

  return { newXP, newLevel, leveledUp: newLevel > oldLevel };
}

// ── Online Status ──

export async function setOnlineStatus(userId: string, online: boolean, gameSlug?: string) {
  await supabase.from("profiles").update({
    is_online: online,
    last_seen_at: new Date().toISOString(),
    current_game_slug: gameSlug || null,
  }).eq("id", userId);
}

// ── Leaderboard Season ──
// Based on CrazyGames: weekly seasons reset Monday 7AM UTC

export function getCurrentSeasonWeek(): string {
  const now = new Date();
  // Get Monday of current week
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return `${monday.getFullYear()}-W${String(Math.ceil((monday.getDate() + new Date(monday.getFullYear(), 0, 1).getDay()) / 7)).padStart(2, "0")}`;
}

export async function submitScore(userId: string, gameId: number, score: number) {
  const season = getCurrentSeasonWeek();
  const { error } = await supabase.from("leaderboard_scores").upsert({
    user_id: userId,
    game_id: gameId,
    score,
    season_week: season,
  }, {
    onConflict: "user_id,game_id",
  });
  if (error) console.error("Score submit error:", error);
}

// ── Recently Played (works without account via localStorage) ──

const RECENTLY_PLAYED_KEY = "forgeflow_recently_played";
const MAX_RECENT = 20;

export function getRecentlyPlayed(): string[] {
  try {
    const stored = localStorage.getItem(RECENTLY_PLAYED_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function addRecentlyPlayed(gameSlug: string) {
  const recent = getRecentlyPlayed().filter(s => s !== gameSlug);
  recent.unshift(gameSlug);
  if (recent.length > MAX_RECENT) recent.pop();
  try {
    localStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(recent));
  } catch {}
}

// ── Favorites (localStorage for guests, Supabase for logged-in) ──

const FAVORITES_KEY = "forgeflow_favorites";

export function getFavorites(): string[] {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(gameSlug: string): boolean {
  const favs = getFavorites();
  const idx = favs.indexOf(gameSlug);
  if (idx >= 0) {
    favs.splice(idx, 1);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
    return false; // removed
  } else {
    favs.push(gameSlug);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
    return true; // added
  }
}

export function isFavorite(gameSlug: string): boolean {
  return getFavorites().includes(gameSlug);
}

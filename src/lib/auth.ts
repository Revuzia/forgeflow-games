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
//
// MUST stay identical to public.ff_season_week() (0011): the server stamps every score with that string and the
// Leaderboards page filters by this one. It is the ISO-8601 week of (now UTC - 7h), formatted 'YYYY-Www', e.g.
// "2026-W41". (The old version derived the week from the day-of-month, so the same string came back every month.)
export function getCurrentSeasonWeek(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 7 * 3_600_000); // the week turns over Monday 07:00 UTC
  const d = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  const dow = d.getUTCDay() || 7; // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dow); // the Thursday of this ISO week decides the ISO year
  const isoYear = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export type SubmitScoreResult = { ok: boolean; improved?: boolean; score?: number; season_week?: string; error?: string };

/**
 * File a leaderboard score. Server-side only (public.submit_score, 0011): the server takes the player from the
 * session, stamps the season, and keeps the HIGHEST score per player + game + season, so a lower score or an
 * out-of-order arrival can never clobber a best. Resolves to the server's answer; never throws.
 */
export async function submitScore(gameId: number, score: number): Promise<SubmitScoreResult | null> {
  if (!Number.isFinite(score)) return null;
  const p_score = Math.min(2147483647, Math.max(0, Math.round(score)));
  try {
    const { data, error } = await supabase.rpc("submit_score", { p_game_id: gameId, p_score });
    if (error) {
      console.warn("[leaderboard] submit_score failed:", error.message);
      return null;
    }
    const res = data as SubmitScoreResult | null;
    if (res && res.ok === false) console.warn("[leaderboard] submit_score refused:", res.error);
    return res;
  } catch (e) {
    console.warn("[leaderboard] submit_score threw:", e);
    return null;
  }
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

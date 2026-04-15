import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseKey);

export type Game = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  short_description: string | null;
  genre: string;
  sub_genre: string | null;
  thumbnail_url: string | null;
  hero_image_url: string | null;
  screenshot_urls: string[] | null;
  game_url: string;
  controls_keyboard: string | null;
  controls_gamepad: string | null;
  has_mobile_support: boolean;
  difficulty: string;
  play_count: number;
  rating_sum: number;
  rating_count: number;
  tags: string[] | null;
  status: string;
  build_version: string | null;
  created_at: string;
  updated_at: string;
};

export type GameCategory = {
  label: string;
  slug: string;
  icon: string;
  color: string;
};

// Ordered by global browser game popularity (most played first)
export const CATEGORIES: GameCategory[] = [
  { label: "Action", slug: "action", icon: "zap", color: "#ff3366" },
  { label: "Arcade", slug: "arcade", icon: "joystick", color: "#ffcc00" },
  { label: "Puzzle", slug: "puzzle", icon: "puzzle", color: "#00d4ff" },
  { label: "Adventure", slug: "adventure", icon: "compass", color: "#00ff88" },
  { label: "Platformers", slug: "platformer", icon: "gamepad-2", color: "#4488ff" },
  { label: "RPG", slug: "rpg", icon: "sword", color: "#a855f7" },
  { label: "Strategy", slug: "strategy", icon: "crown", color: "#ff8800" },
  { label: "Racing", slug: "racing", icon: "trophy", color: "#44ddff" },
  { label: "Board Games", slug: "board_game", icon: "dice-5", color: "#88cc44" },
];

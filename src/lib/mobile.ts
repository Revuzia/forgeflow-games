import type { Game } from "./supabase";

/**
 * Per-game touch/mobile playability, read from public.games.mobile_support
 * (migration 0007_games_mobile_support.sql).
 *
 *   full    — real touch controls, playable start to finish on a phone
 *   partial — runs on touch but something is degraded (a mode, precision, UI)
 *   none    — desktop only (keyboard/mouse)
 *
 * Fail closed: an unclassified row (NULL) is reported as "none" so the site
 * never promises touch support it cannot back up. The legacy has_mobile_support
 * boolean is honoured as "full" only when mobile_support is unset, so the
 * column add cannot regress anything that already relied on the boolean.
 */
export type MobileSupport = "full" | "partial" | "none";

export function getMobileSupport(game: Pick<Game, "mobile_support" | "has_mobile_support">): MobileSupport {
  const v = game.mobile_support;
  if (v === "full" || v === "partial" || v === "none") return v;
  return game.has_mobile_support ? "full" : "none";
}

export function playsOnTouch(game: Pick<Game, "mobile_support" | "has_mobile_support">): boolean {
  return getMobileSupport(game) !== "none";
}

/** Badge colours reuse the existing brand palette (tailwind.config.ts). */
export const MOBILE_BADGE: Record<
  Exclude<MobileSupport, "none">,
  { short: string; long: string; color: string }
> = {
  full: { short: "Mobile", long: "Plays on mobile", color: "#00ff88" },
  partial: { short: "Mobile*", long: "Partly playable on mobile", color: "#ff8800" },
};

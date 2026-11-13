/**
 * BLOCKTOOTH stats reads (leaderboards + player card) — public RPCs on qkid.
 *
 * Writes never happen here: runs are filed by the game through the bridge
 * (gameBridge.ts forgeflow:run_result -> bt_submit_run). These two reads are
 * granted to anon too, so guests see the boards.
 *
 * Schema + RPCs: supabase/migrations/0008_blocktooth_stats.sql
 * (design: games/blocktooth/_spec/online/platform.md §8, boards §10.3).
 */
import { supabase } from "./supabase";

export const BT_TITANS = [
  { id: "molo", name: "MOLO" },
  { id: "voltkite", name: "VOLT-KITE" },
  { id: "hearthback", name: "HEARTHBACK" },
  { id: "briarwick", name: "BRIARWICK" },
] as const;

export const BT_BIOMES = [
  { id: "grideast", name: "GRID-EAST" },
  { id: "whitestacks", name: "WHITE STACKS" },
  { id: "lockwater", name: "LOCKWATER" },
] as const;

export type BtTitanId = (typeof BT_TITANS)[number]["id"];
export type BtBiomeId = (typeof BT_BIOMES)[number]["id"];
export type BtPeriod = "week" | "all";

export type BtBoard = {
  key: string;            // p_board passed to bt_leaderboard
  label: string;
  blurb: string;
  perCity: boolean;       // city tabs apply
  titanFilter: boolean;   // titan filter applies
  format: (v: number) => string;
};

const fmtInt = (v: number) => Math.round(v).toLocaleString();

/** "18:21.4" style clock for clear times (seconds, tenths). */
export function fmtClock(s: number | null | undefined): string {
  if (s == null || !isFinite(Number(s))) return "—";
  const t = Number(s);
  const m = Math.floor(t / 60);
  const rest = t - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

export function fmtTons(v: number | null | undefined): string {
  if (v == null || !isFinite(Number(v))) return "—";
  return `${Math.round(Number(v)).toLocaleString()} t`;
}

export function fmtDuration(s: number | null | undefined): string {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const SIZE_NAMES = ["SIZE I", "SIZE II", "SIZE III", "SIZE IV", "SIZE V"];

/** Solo boards (Phase A). VS boards are added in Phase B once matches exist. */
export const BT_BOARDS: BtBoard[] = [
  { key: "clear", label: "Fastest Clear", blurb: "Quickest city clear", perCity: true, titanFilter: true, format: fmtClock },
  { key: "tonnage", label: "Biggest Appetite", blurb: "Most tonnage in one run", perCity: true, titanFilter: true, format: fmtTons },
  { key: "endless", label: "Extended Coverage", blurb: "Best endless score after a clear", perCity: true, titanFilter: true, format: fmtInt },
  { key: "lifetime_kills", label: "Lifetime Kills", blurb: "Total kills across every run", perCity: false, titanFilter: false, format: fmtInt },
  { key: "lifetime_tonnage", label: "Lifetime Tonnage", blurb: "Total tonnage across every run", perCity: false, titanFilter: false, format: fmtTons },
];

export type BtLeaderRow = {
  rank: number;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  value: number;
  titan: string | null;
  biome: string | null;
  achieved_at: string | null;
};

export type BtResult<T> = { data: T; unavailable: boolean; error: string | null };

/** PostgREST "function not found" (PGRST202) or a missing relation => the
 *  stats migration is not applied yet: the UI shows a quiet placeholder. */
function isUnavailable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "PGRST202" || err.code === "42883" || err.code === "42P01" || /could not find the function/i.test(err.message || "");
}

export async function fetchBtLeaderboard(
  board: string,
  opts: { titan?: string | null; biome?: string | null; period?: BtPeriod } = {},
): Promise<BtResult<BtLeaderRow[]>> {
  const { data, error } = await supabase.rpc("bt_leaderboard", {
    p_board: board,
    p_titan: opts.titan || null,
    p_biome: opts.biome || null,
    p_period: opts.period || "all",
  });
  if (error) return { data: [], unavailable: isUnavailable(error), error: error.message || "error" };
  const rows = (Array.isArray(data) ? data : []).map((r: any) => ({
    rank: Number(r.rank) || 0,
    user_id: String(r.user_id ?? ""),
    username: r.username ?? null,
    avatar_url: r.avatar_url ?? null,
    value: Number(r.value) || 0,
    titan: r.titan ?? null,
    biome: r.biome ?? null,
    achieved_at: r.achieved_at ?? null,
  }));
  return { data: rows, unavailable: false, error: null };
}

export type BtLifetime = {
  runs: number; clears: number; deaths: number; play_s: number; kills: number; tonnage: number;
  blocks: number; bosses: number; best_level: number; best_peak_rank: number;
  vs_matches: number; vs_wins: number; vs_top2: number; vs_titans_eaten: number;
};
export type BtTitanRow = {
  titan: string; runs: number; clears: number; play_s: number; kills: number;
  best_level: number; best_tonnage: number; vs_wins: number;
};
export type BtBestRow = {
  titan: string; biome: string; clears: number; clear_s: number | null; tonnage: number; blocks: number;
  kills: number; level: number; peak_rank: number; survived_s: number; endless_s: number; endless_score: number;
};
export type BtPlayerCard = { lifetime: BtLifetime | null; titans: BtTitanRow[]; bests: BtBestRow[] };

const n = (v: unknown) => (v == null || !isFinite(Number(v)) ? 0 : Number(v));

/** Tolerant of field order/missing keys: the card renders whatever the RPC returns. */
export function normalizePlayerCard(raw: any): BtPlayerCard {
  const src = raw && typeof raw === "object" ? raw : {};
  const lt = src.lifetime && typeof src.lifetime === "object" ? src.lifetime : null;
  const lifetime: BtLifetime | null = lt
    ? {
        runs: n(lt.runs), clears: n(lt.clears), deaths: n(lt.deaths), play_s: n(lt.play_s), kills: n(lt.kills),
        tonnage: n(lt.tonnage), blocks: n(lt.blocks), bosses: n(lt.bosses), best_level: n(lt.best_level),
        best_peak_rank: n(lt.best_peak_rank), vs_matches: n(lt.vs_matches), vs_wins: n(lt.vs_wins),
        vs_top2: n(lt.vs_top2), vs_titans_eaten: n(lt.vs_titans_eaten),
      }
    : null;
  const titans: BtTitanRow[] = (Array.isArray(src.titans) ? src.titans : []).map((t: any) => ({
    titan: String(t?.titan ?? ""), runs: n(t?.runs), clears: n(t?.clears), play_s: n(t?.play_s), kills: n(t?.kills),
    best_level: n(t?.best_level), best_tonnage: n(t?.best_tonnage), vs_wins: n(t?.vs_wins),
  }));
  const bests: BtBestRow[] = (Array.isArray(src.bests) ? src.bests : []).map((b: any) => ({
    titan: String(b?.titan ?? ""), biome: String(b?.biome ?? ""), clears: n(b?.clears),
    clear_s: b?.clear_s == null ? null : Number(b.clear_s), tonnage: n(b?.tonnage), blocks: n(b?.blocks),
    kills: n(b?.kills), level: n(b?.level), peak_rank: n(b?.peak_rank), survived_s: n(b?.survived_s),
    endless_s: n(b?.endless_s), endless_score: n(b?.endless_score),
  }));
  return { lifetime, titans, bests };
}

export async function fetchBtPlayerCard(userId: string): Promise<BtResult<BtPlayerCard>> {
  const { data, error } = await supabase.rpc("bt_player_card", { p_user: userId });
  if (error) return { data: { lifetime: null, titans: [], bests: [] }, unavailable: isUnavailable(error), error: error.message || "error" };
  return { data: normalizePlayerCard(data), unavailable: false, error: null };
}

export function titanName(id: string | null | undefined): string {
  return BT_TITANS.find((t) => t.id === id)?.name || (id ? id.toUpperCase() : "—");
}
export function biomeName(id: string | null | undefined): string {
  return BT_BIOMES.find((b) => b.id === id)?.name || (id ? id.toUpperCase() : "—");
}

/** Best per city across titans (clear time = lowest, others = highest). */
export function bestsByCity(bests: BtBestRow[]) {
  return BT_BIOMES.map((b) => {
    const rows = bests.filter((r) => r.biome === b.id);
    const cleared = rows.filter((r) => r.clear_s != null && r.clear_s > 0);
    const fastest = cleared.length ? cleared.reduce((a, r) => (r.clear_s! < a.clear_s! ? r : a)) : null;
    const topTon = rows.length ? rows.reduce((a, r) => (r.tonnage > a.tonnage ? r : a)) : null;
    return {
      biome: b.id,
      name: b.name,
      clears: rows.reduce((s, r) => s + r.clears, 0),
      fastest: fastest ? { s: fastest.clear_s as number, titan: fastest.titan } : null,
      tonnage: topTon && topTon.tonnage > 0 ? { v: topTon.tonnage, titan: topTon.titan } : null,
      endless: rows.reduce((m, r) => Math.max(m, r.endless_score), 0),
      peakRank: rows.reduce((m, r) => Math.max(m, r.peak_rank), 0),
    };
  });
}

export function favouriteTitan(titans: BtTitanRow[]): BtTitanRow | null {
  const played = titans.filter((t) => t.runs > 0);
  if (!played.length) return null;
  return played.reduce((a, t) => (t.play_s > a.play_s || (t.play_s === a.play_s && t.runs > a.runs) ? t : a));
}

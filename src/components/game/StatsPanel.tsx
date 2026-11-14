/**
 * Per-game "RECORDS & LEADERBOARDS" panels for the game detail page, plus the
 * matching profile-page cards.
 *
 * Only games listed in GAME_STATS_PANELS / GAME_PROFILE_CARDS render anything,
 * so every other game page is unchanged. BLOCKTOOTH is the first entry
 * (games/blocktooth/_spec/online/platform.md §10.3-10.4).
 *
 * Everything here is client-side reads of public RPCs; during the SSG
 * prerender React Query does not fetch, so the static HTML carries only the
 * panel shell.
 */
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, type Game } from "../../lib/supabase";
import {
  BT_BIOMES, BT_BOARDS, BT_TITANS, SIZE_NAMES, bestsByCity, biomeName, favouriteTitan, fetchBtLeaderboard,
  fetchBtPlayerCard, fmtClock, fmtDuration, fmtTons, titanName, type BtPeriod, type BtPlayerCard,
} from "../../lib/btStats";

const RANK_COLORS = ["#ffd700", "#c0c0c0", "#cd7f32"];

/** Signed-in user id, kept live across sign-in/out on the same page. */
function useSessionUserId(): string | null | undefined {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data: { user } }) => { if (alive) setUid(user?.id ?? null); }).catch(() => alive && setUid(null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (alive) setUid(session?.user?.id ?? null);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);
  return uid;
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "px-3 py-1 rounded-full text-xs font-semibold transition-colors border " +
        (active
          ? "bg-brand-orange/15 text-brand-orange border-brand-orange/40"
          : "bg-surface-900/50 text-gray-400 border-surface-600/30 hover:text-gray-200")
      }
    >
      {children}
    </button>
  );
}

// ── BLOCKTOOTH: detail-page panel ─────────────────────────────────────────

function BlocktoothStatsPanel(_props: { game: Game }) {
  const uid = useSessionUserId();
  const [boardKey, setBoardKey] = useState(BT_BOARDS[0].key);
  const [biome, setBiome] = useState<string>(BT_BIOMES[0].id);
  const [titan, setTitan] = useState<string>("all");
  const [period, setPeriod] = useState<BtPeriod>("all");
  const board = BT_BOARDS.find((b) => b.key === boardKey) || BT_BOARDS[0];

  const lb = useQuery({
    queryKey: ["bt_leaderboard", board.key, board.perCity ? biome : null, board.titanFilter ? titan : null, period],
    queryFn: () =>
      fetchBtLeaderboard(board.key, {
        biome: board.perCity ? biome : null,
        titan: board.titanFilter && titan !== "all" ? titan : null,
        period,
      }),
    staleTime: 60_000,
  });

  const card = useQuery({
    queryKey: ["bt_player_card", uid],
    queryFn: () => fetchBtPlayerCard(uid as string),
    enabled: !!uid,
    staleTime: 60_000,
  });

  const rows = lb.data?.data || [];
  const unavailable = !!lb.data?.unavailable;
  const myRow = uid ? rows.find((r) => r.user_id === uid) : undefined;

  return (
    <section className="bg-surface-800 rounded-xl border border-surface-600/30 overflow-hidden mb-6" aria-labelledby="bt-records-h">
      <div className="px-5 py-3 bg-surface-900/30 border-b border-surface-600/30 flex items-center justify-between flex-wrap gap-2">
        <h2 id="bt-records-h" className="font-display font-bold text-white tracking-wide">RECORDS &amp; LEADERBOARDS</h2>
        <div className="flex gap-2">
          <Pill active={period === "week"} onClick={() => setPeriod("week")}>This week</Pill>
          <Pill active={period === "all"} onClick={() => setPeriod("all")}>All time</Pill>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Board tabs */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Board">
          {BT_BOARDS.map((b) => (
            <Pill key={b.key} active={b.key === board.key} onClick={() => setBoardKey(b.key)}>{b.label}</Pill>
          ))}
        </div>

        {/* City tabs + titan filter */}
        {(board.perCity || board.titanFilter) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {board.perCity ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="City">
                {BT_BIOMES.map((b) => (
                  <Pill key={b.id} active={b.id === biome} onClick={() => setBiome(b.id)}>{b.name}</Pill>
                ))}
              </div>
            ) : <span />}
            {board.titanFilter && (
              <select
                value={titan}
                onChange={(e) => setTitan(e.target.value)}
                aria-label="Titan"
                className="px-3 py-1.5 rounded-lg bg-surface-900/50 border border-surface-600/50 text-xs text-gray-200
                           focus:outline-none focus:border-brand-orange/50 cursor-pointer"
              >
                <option value="all">All titans</option>
                {BT_TITANS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
        )}

        <p className="text-xs text-surface-500">
          {board.blurb}{board.perCity ? ` · ${biomeName(biome)}` : ""}{board.titanFilter && titan !== "all" ? ` · ${titanName(titan)}` : ""}
          {period === "week" ? " · since Monday (UTC)" : ""}
        </p>
      </div>

      {/* Board table */}
      {lb.isLoading ? (
        <div className="px-5 pb-6 text-sm text-gray-400">Loading board…</div>
      ) : unavailable ? (
        <div className="px-5 pb-6 text-sm text-gray-500">Leaderboards open soon.</div>
      ) : lb.data?.error ? (
        <div className="px-5 pb-6 text-sm text-gray-500">Couldn't load this board right now.</div>
      ) : rows.length === 0 ? (
        <div className="px-5 pb-6 text-sm text-gray-500">No runs on this board yet. Be the first.</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-xs text-gray-500 uppercase border-y border-surface-600/30">
              <th className="px-4 py-2 text-left w-16">Rank</th>
              <th className="px-4 py-2 text-left">Player</th>
              {board.titanFilter && <th className="px-4 py-2 text-left hidden sm:table-cell">Titan</th>}
              <th className="px-4 py-2 text-right">{board.label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((r) => {
              const mine = !!uid && r.user_id === uid;
              return (
                <tr key={`${r.rank}-${r.user_id}`} className={"border-b border-surface-600/10 transition-colors " + (mine ? "bg-brand-orange/10" : "hover:bg-surface-700/30")}>
                  <td className="px-4 py-2">
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{
                        backgroundColor: r.rank <= 3 ? RANK_COLORS[r.rank - 1] + "20" : "transparent",
                        color: r.rank <= 3 ? RANK_COLORS[r.rank - 1] : "#888",
                      }}
                    >
                      {r.rank}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                      ) : (
                        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-[10px] font-bold text-white">
                          {(r.username || "?").slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-200">{r.username || "Player"}{mine ? " (you)" : ""}</span>
                    </div>
                  </td>
                  {board.titanFilter && (
                    <td className="px-4 py-2 text-xs text-gray-400 hidden sm:table-cell">{titanName(r.titan)}</td>
                  )}
                  <td className="px-4 py-2 text-right">
                    <span className="text-sm font-bold text-white">{board.format(r.value)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Your records */}
      <div className="p-4 border-t border-surface-600/30">
        <h3 className="font-display font-semibold text-sm text-gray-200 mb-3">Your records</h3>
        {uid === undefined ? null : !uid ? (
          <p className="text-sm text-surface-500">Sign in to save your runs, records and achievements to your account.</p>
        ) : card.isLoading ? (
          <p className="text-sm text-gray-400">Loading your records…</p>
        ) : card.data?.unavailable ? (
          <p className="text-sm text-surface-500">Records open soon.</p>
        ) : !card.data?.data.lifetime || card.data.data.lifetime.runs === 0 ? (
          <p className="text-sm text-surface-500">No runs filed yet — finish a run while signed in and it lands here.</p>
        ) : (
          <BlocktoothRecords card={card.data.data} myRank={myRow ? myRow.rank : null} boardLabel={board.label} />
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg bg-surface-900/50">
      <p className="text-[11px] uppercase text-gray-500">{label}</p>
      <p className="text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function BlocktoothRecords({ card, myRank, boardLabel }: {
  card: BtPlayerCard;
  myRank: number | null;
  boardLabel: string;
}) {
  const lt = card.lifetime!;
  const cities = bestsByCity(card.bests);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Runs" value={lt.runs.toLocaleString()} />
        <Stat label="Clears" value={lt.clears.toLocaleString()} />
        <Stat label="Kills" value={lt.kills.toLocaleString()} />
        <Stat label="Tonnage" value={fmtTons(lt.tonnage)} />
      </div>
      {myRank != null && (
        <p className="text-xs text-brand-orange">You're #{myRank} on this {boardLabel} board.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase border-b border-surface-600/30">
              <th className="py-2 pr-3 text-left">City</th>
              <th className="py-2 px-3 text-right">Fastest clear</th>
              <th className="py-2 px-3 text-right">Biggest appetite</th>
              <th className="py-2 pl-3 text-right">Peak size</th>
            </tr>
          </thead>
          <tbody>
            {cities.map((c) => (
              <tr key={c.biome} className="border-b border-surface-600/10">
                <td className="py-2 pr-3 text-gray-200 font-medium">{c.name}</td>
                <td className="py-2 px-3 text-right text-gray-200">
                  {c.fastest ? <>{fmtClock(c.fastest.s)} <span className="text-xs text-gray-500">{titanName(c.fastest.titan)}</span></> : <span className="text-gray-500">—</span>}
                </td>
                <td className="py-2 px-3 text-right text-gray-200">
                  {c.tonnage ? <>{fmtTons(c.tonnage.v)} <span className="text-xs text-gray-500">{titanName(c.tonnage.titan)}</span></> : <span className="text-gray-500">—</span>}
                </td>
                <td className="py-2 pl-3 text-right text-gray-400">{c.clears > 0 || c.tonnage ? SIZE_NAMES[c.peakRank] || "—" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card.titans.some((t) => t.runs > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {BT_TITANS.map((t) => {
            const row = card.titans.find((r) => r.titan === t.id);
            return (
              <div key={t.id} className="p-2 rounded-lg bg-surface-900/50">
                <p className="text-xs font-bold text-gray-200">{t.name}</p>
                <p className="text-[11px] text-gray-500">
                  {row && row.runs > 0 ? `${row.runs} runs · ${row.clears} clears · best LV ${row.best_level}` : "not played"}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── BLOCKTOOTH: profile-page card ─────────────────────────────────────────

function BlocktoothProfileCard({ userId }: { userId: string }) {
  const card = useQuery({
    queryKey: ["bt_player_card", userId],
    queryFn: () => fetchBtPlayerCard(userId),
    staleTime: 60_000,
  });
  const c = card.data?.data;
  // Nothing to show until the stats backend exists and this player has filed a run.
  if (!c || card.data?.unavailable || card.data?.error || !c.lifetime || c.lifetime.runs === 0) return null;
  const lt = c.lifetime;
  const fav = favouriteTitan(c.titans);
  const cities = bestsByCity(c.bests);
  return (
    <div className="bg-surface-800 rounded-xl border border-surface-600/30 p-5 md:col-span-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg text-white">BLOCKTOOTH</h2>
        <a href="/games/blocktooth" className="text-xs text-gray-400 hover:text-brand-orange transition-colors">Leaderboards →</a>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="Runs / clears" value={`${lt.runs.toLocaleString()} / ${lt.clears.toLocaleString()}`} />
        <Stat label="Kills" value={lt.kills.toLocaleString()} />
        <Stat label="Tonnage" value={fmtTons(lt.tonnage)} />
        <Stat label="Time on air" value={fmtDuration(lt.play_s)} />
        <Stat label="Favourite titan" value={fav ? titanName(fav.titan) : "—"} />
        <Stat label="Best level" value={lt.best_level ? `LV ${lt.best_level}` : "—"} />
        <Stat label="Peak size" value={SIZE_NAMES[lt.best_peak_rank] || "—"} />
        <Stat label="VS wins / top 2" value={lt.vs_matches > 0 ? `${lt.vs_wins} / ${lt.vs_top2}` : "—"} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {cities.map((ct) => (
          <div key={ct.biome} className="p-3 rounded-lg bg-surface-900/50">
            <p className="text-xs font-bold text-gray-200 mb-1">{ct.name}</p>
            <p className="text-[11px] text-gray-500">Fastest clear: <span className="text-gray-300">{ct.fastest ? fmtClock(ct.fastest.s) : "—"}</span></p>
            <p className="text-[11px] text-gray-500">Biggest appetite: <span className="text-gray-300">{ct.tonnage ? fmtTons(ct.tonnage.v) : "—"}</span></p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Registries ────────────────────────────────────────────────────────────

/** slug -> detail-page stats panel. Pages render nothing for unlisted slugs. */
export const GAME_STATS_PANELS: Record<string, ComponentType<{ game: Game }>> = {
  blocktooth: BlocktoothStatsPanel,
};

/** Profile-page cards for games with a stats backend (each renders null until the player has data). */
export const GAME_PROFILE_CARDS: Array<{ slug: string; Card: ComponentType<{ userId: string }> }> = [
  { slug: "blocktooth", Card: BlocktoothProfileCard },
];

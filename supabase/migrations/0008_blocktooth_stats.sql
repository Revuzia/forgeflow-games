-- ForgeFlow Games -- BLOCKTOOTH stats, records, leaderboards, VS results (2026-10-01)
-- Project: qkidwgyapmitrdxnavmi (accounts / registry / achievements live here; NOT wugox).
-- Spec: games/blocktooth/_spec/online/ONLINE_PLAN.md A.1.1 + platform.md section 8. Owner approved D1 2026-10-01.
--
-- HOW TO APPLY (one transaction; the file carries its own BEGIN/COMMIT):
--   Management API: POST https://api.supabase.com/v1/projects/qkidwgyapmitrdxnavmi/database/query
--   body {"query": <this whole file>}, Authorization: Bearer <PAT from state/.secrets/supabase_pat.txt>,
--   User-Agent: a browser UA (api.supabase.com CF-1010-blocks Python's default UA).
--   Helper: games/blocktooth/_harness/portal/apply_migration_0008.py  (--dry-run swaps COMMIT for ROLLBACK).
--   Or paste into Dashboard -> SQL Editor (how 0002/0004 were applied).
--   The file is NOT re-runnable: a second apply fails at CREATE TABLE and rolls back whole (no partial state).
--
-- WHAT IT ADDS (tables + functions only; no existing table or policy is altered):
--   bt_runs          every finished run (solo, endless continuation, VS) -- append-only audit + weekly boards
--   bt_player_stats  lifetime per player            bt_titan_stats  per player x titan
--   bt_bests         per player x titan x city: a 1:1 mirror of the game's local record book
--                    (src/core/save.ts bestKey; broadcast.runFigures + game.ts recordBests)
--   bt_vs_matches / bt_vs_results   Phase B VS (created now, empty until VS ships)
--   RPCs: bt_submit_run(p jsonb), bt_report_vs(p jsonb)  -- authenticated only, SECURITY DEFINER, keyed on auth.uid()
--         bt_leaderboard(...), bt_player_card(uuid)       -- anon + authenticated (public read)
--   internal: bt__validate_run(jsonb), bt__file_run(uuid, jsonb) -- NOT executable by anon/authenticated
--
-- SECURITY MODEL: public SELECT (RLS using(true)) so guests see boards; ALL write privileges revoked from anon and
-- authenticated (a direct INSERT answers 42501); every write goes through the definer RPCs. Honest limit: results are
-- client-authoritative (the sim runs in the player's browser). The bounds below stop junk, not a crafted cheat.
--
-- SANITY BOUNDS -- from the game's real limits (games/blocktooth, HEAD 861779e3), checked this session:
--   duration_s 5..43200      on-air seconds (ui/broadcast.ts onAirSeconds, floored). The game has NO run-time cap:
--                            EXTENDED COVERAGE (meta/endless.ts) runs until death, so 12 h is a sanity ceiling
--                            (platform.md's 14400 could reject a genuine marathon). Runs < 5 s are not sent (A-GAME).
--   clear_s 300..duration+1  the 20-minute run clears at 1117-1277 s (gate bot, goals.ts p20 note; PACING_20 §3);
--                            the level governor (config.ts RANK_SCHEDULE_S/AHEAD_GRACE_S) puts LV 35 near 995 s;
--                            300 s leaves wide headroom. clearS keeps tenths, duration is floored -> +1.
--   level 1..min(250, 40 + duration_s/30)
--                            no level cap exists (titansim.ts levels while xp >= xpToNext); clears end at LV 35-38;
--                            cumXpAt(99) = 431k XP, reachable in a ~2 h endless run, so platform.md's 99 is too low.
--   peak_rank 0..4           SIZE I..V (types.ts RankIndex)
--   kills 0..500 + 30*duration_s   CITY.maxEnemies = 320 alive (config.ts); bot fields ~2.2-3.1k foes in 20 min
--                            (~2.5/s); 30/s sustained is ~12x that.
--   crushed 0..kills         tally.crushed counts kills with the crushed flag (meta/tally.ts:134)
--   tonnage 0..12,000,000 + 20,000*duration_s
--                            standing city at generation = 4.9M-8.8M t (buildings floors x TIERS.tonsPerFloor + props,
--                            6 seeds x 3 cities, _harness/scratch/onlineA/A-SQL/city_tonnage.ts); repair crews
--                            (citysim.ts REBUILD_*) let a long run re-eat rebuilt floors, hence the per-second term.
--   blocks 0..grid           run.blocksLeveled is sticky and capped by the grid: grideast 15x16=240,
--                            whitestacks 14x13=182, lockwater 13x16=208 (data/biomes.ts)
--   endless_s 0..duration_s, only after a clear (KEEP GOING follows a clear; an endless death keeps result 'clear')
--   rematches 0..endless_s/150 + 1   a rematch every >= 75 s (ENDLESS_V3.rematchGapS), alternating gatekeeper/city boss;
--                            `rematches` counts city-boss rematches only (endless.ts:29)
--   bosses 0..2 + endless_s/75 ; gate_kills 0..4 + endless_s/75 (3 home gates + rematches)
--   endless_score <= 10*endless_s + 2*kills + 5000*rematches + tonnage/500 + 1500*(endless_s/75 + 2) + 100
--                            (endless.ts endlessScore: 10/s + 2/kill + 5000/rematch + tons/500 + 1500/gate rematch)
--   titans_eaten 0 solo, 0..3 VS
--
-- IDEMPOTENCY: (user_id, run_nonce) unique; a repeat returns {ok:true, already:true}. ONE exception, asked for by the
-- game lane (A-GAME, scratch/onlineA/NOTES.md): an EXTENDED COVERAGE follow-up re-sends the SAME run_nonce with
-- phase:'endless' and the grown figures; it updates that row ONCE (endless_filed) and adds only the deltas to the
-- lifetime stats. VS: (match_id, user_id) unique; a player can only write their own result row.
--
-- SELF-TEST: the DO block at the end acts as fake signed-in users inside a subtransaction (submit, resubmit -> already,
-- impossible runs -> rejected, direct insert/update/helper call -> denied, endless follow-up, boards, VS agreement),
-- deletes its rows, then rolls the subtransaction back. Any failed check raises BT_SELFTEST_FAIL and aborts the WHOLE
-- migration. On success it writes "self-test PASS" into COMMENT ON TABLE public.bt_runs (read it back to verify).

BEGIN;

-- ───────────────────────────── 1. tables ─────────────────────────────

-- Every finished run. One row per (user, run_nonce).
CREATE TABLE public.bt_runs (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  run_nonce     text NOT NULL CHECK (char_length(run_nonce) BETWEEN 8 AND 64),
  mode          text NOT NULL CHECK (mode IN ('solo','vs')),
  titan         text NOT NULL CHECK (titan IN ('molo','voltkite','hearthback','briarwick')),
  biome         text NOT NULL CHECK (biome IN ('grideast','whitestacks','lockwater')),
  result        text NOT NULL CHECK (result IN ('clear','dead','vs_win','vs_place')),
  placement     smallint CHECK (placement BETWEEN 1 AND 4),                 -- VS only
  duration_s    integer  NOT NULL CHECK (duration_s BETWEEN 5 AND 43200),
  clear_s       numeric(7,1) CHECK (clear_s > 0),                          -- solo clears only; lower is better
  level         smallint NOT NULL CHECK (level BETWEEN 1 AND 250),
  peak_rank     smallint NOT NULL CHECK (peak_rank BETWEEN 0 AND 4),       -- SIZE I..V
  kills         integer  NOT NULL CHECK (kills >= 0),
  crushed       integer  NOT NULL DEFAULT 0 CHECK (crushed >= 0),
  tonnage       bigint   NOT NULL CHECK (tonnage >= 0),
  blocks        integer  NOT NULL DEFAULT 0 CHECK (blocks BETWEEN 0 AND 240),
  bosses        smallint NOT NULL DEFAULT 0 CHECK (bosses >= 0),           -- city bosses defeated (tally.bossesDefeated)
  gate_kills    smallint NOT NULL DEFAULT 0 CHECK (gate_kills BETWEEN 0 AND 999),
  endless_s     integer  NOT NULL DEFAULT 0 CHECK (endless_s >= 0),
  endless_score integer  NOT NULL DEFAULT 0 CHECK (endless_score >= 0),
  rematches     smallint NOT NULL DEFAULT 0 CHECK (rematches >= 0),        -- endless city-boss rematches won
  titans_eaten  smallint NOT NULL DEFAULT 0 CHECK (titans_eaten BETWEEN 0 AND 3),  -- VS: rivals defeated
  endless_filed boolean  NOT NULL DEFAULT false,                           -- the one phase:'endless' update landed
  vs_match_id   text,
  build_version text CHECK (build_version IS NULL OR char_length(build_version) <= 64),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, run_nonce),
  CHECK (result <> 'clear' OR clear_s IS NOT NULL),
  CHECK (mode = 'vs' OR placement IS NULL)
);
CREATE INDEX bt_runs_board_clear ON public.bt_runs (biome, clear_s) WHERE result = 'clear';
CREATE INDEX bt_runs_board_ton   ON public.bt_runs (biome, tonnage DESC);
CREATE INDEX bt_runs_user        ON public.bt_runs (user_id, created_at DESC);
CREATE INDEX bt_runs_week        ON public.bt_runs (created_at DESC);

-- Lifetime per player (profile card).
CREATE TABLE public.bt_player_stats (
  user_id         uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  runs            integer  NOT NULL DEFAULT 0,
  clears          integer  NOT NULL DEFAULT 0,
  deaths          integer  NOT NULL DEFAULT 0,
  play_s          bigint   NOT NULL DEFAULT 0,
  kills           bigint   NOT NULL DEFAULT 0,
  tonnage         bigint   NOT NULL DEFAULT 0,
  blocks          bigint   NOT NULL DEFAULT 0,
  bosses          integer  NOT NULL DEFAULT 0,
  best_level      smallint NOT NULL DEFAULT 0,
  best_peak_rank  smallint NOT NULL DEFAULT 0,
  vs_matches      integer  NOT NULL DEFAULT 0,
  vs_wins         integer  NOT NULL DEFAULT 0,   -- CONFIRMED wins only (>= 2 humans, unanimous reports) -> VS WINS board
  vs_solo_wins    integer  NOT NULL DEFAULT 0,   -- wins in 1-human (bots-only) matches: personal stat only (owner D9)
  vs_top2         integer  NOT NULL DEFAULT 0,
  vs_titans_eaten integer  NOT NULL DEFAULT 0,
  vs_rating       integer  NOT NULL DEFAULT 1200, -- Phase 2 (D12); unused in v1
  vs_peak_rating  integer  NOT NULL DEFAULT 1200,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bt_player_vs ON public.bt_player_stats (vs_wins DESC);

-- Per player x titan (titan mastery).
CREATE TABLE public.bt_titan_stats (
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titan        text NOT NULL CHECK (titan IN ('molo','voltkite','hearthback','briarwick')),
  runs         integer  NOT NULL DEFAULT 0,
  clears       integer  NOT NULL DEFAULT 0,
  play_s       bigint   NOT NULL DEFAULT 0,
  kills        bigint   NOT NULL DEFAULT 0,
  best_level   smallint NOT NULL DEFAULT 0,
  best_tonnage bigint   NOT NULL DEFAULT 0,
  vs_wins      integer  NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, titan)
);

-- Records per (titan, city): the cloud mirror of the local record book (BEST_STATS tonnage, blocks, kills, level,
-- peakRank, survivedS, clearS + endless endlessS / endlessScore / rematches). Solo runs only.
CREATE TABLE public.bt_bests (
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titan         text NOT NULL CHECK (titan IN ('molo','voltkite','hearthback','briarwick')),
  biome         text NOT NULL CHECK (biome IN ('grideast','whitestacks','lockwater')),
  clears        integer  NOT NULL DEFAULT 0,
  clear_s       numeric(7,1),                       -- lower is better (null = never cleared)
  tonnage       bigint   NOT NULL DEFAULT 0,
  blocks        integer  NOT NULL DEFAULT 0,
  kills         integer  NOT NULL DEFAULT 0,
  level         smallint NOT NULL DEFAULT 0,
  peak_rank     smallint NOT NULL DEFAULT 0,
  survived_s    integer  NOT NULL DEFAULT 0,
  endless_s     integer  NOT NULL DEFAULT 0,
  endless_score integer  NOT NULL DEFAULT 0,
  rematches     smallint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, titan, biome)
);
CREATE INDEX bt_bests_biome_clear ON public.bt_bests (biome, clear_s) WHERE clear_s IS NOT NULL;

-- VS (Phase B): 4 seats, humans + bot fill. One result row per HUMAN reporter; the match row aggregates.
CREATE TABLE public.bt_vs_matches (
  match_id   text PRIMARY KEY CHECK (char_length(match_id) BETWEEN 8 AND 80),   -- e.g. blocktooth:<room>:<startNonce>
  biome      text NOT NULL CHECK (biome IN ('grideast','whitestacks','lockwater')),
  humans     smallint NOT NULL CHECK (humans BETWEEN 1 AND 4),
  bots       smallint NOT NULL CHECK (bots BETWEEN 0 AND 3),
  winner_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,   -- set only when >= 2 human reports agree
  reports    smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (humans + bots = 4)
);
CREATE TABLE public.bt_vs_results (
  match_id       text NOT NULL REFERENCES public.bt_vs_matches(match_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titan          text NOT NULL CHECK (titan IN ('molo','voltkite','hearthback','briarwick')),
  placement      smallint NOT NULL CHECK (placement BETWEEN 1 AND 4),
  claimed_winner uuid,                           -- who this reporter saw win (a human id; null = a bot won)
  titans_eaten   smallint NOT NULL DEFAULT 0 CHECK (titans_eaten BETWEEN 0 AND 3),
  peak_level     smallint NOT NULL DEFAULT 0,
  survived_s     integer  NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX bt_vs_results_user ON public.bt_vs_results (user_id, created_at DESC);
CREATE INDEX bt_vs_matches_week ON public.bt_vs_matches (created_at DESC) WHERE winner_id IS NOT NULL;

-- ───────────────────────────── 2. RLS: public read, no client writes ─────────────────────────────
-- Supabase's default privileges GRANT ALL on new public tables to anon/authenticated: revoke all, re-grant SELECT.
ALTER TABLE public.bt_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bt_player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bt_titan_stats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bt_bests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bt_vs_matches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bt_vs_results   ENABLE ROW LEVEL SECURITY;

CREATE POLICY bt_runs_read         ON public.bt_runs         FOR SELECT USING (true);
CREATE POLICY bt_player_stats_read ON public.bt_player_stats FOR SELECT USING (true);
CREATE POLICY bt_titan_stats_read  ON public.bt_titan_stats  FOR SELECT USING (true);
CREATE POLICY bt_bests_read        ON public.bt_bests        FOR SELECT USING (true);
CREATE POLICY bt_vs_matches_read   ON public.bt_vs_matches   FOR SELECT USING (true);
CREATE POLICY bt_vs_results_read   ON public.bt_vs_results   FOR SELECT USING (true);

REVOKE ALL ON TABLE public.bt_runs, public.bt_player_stats, public.bt_titan_stats, public.bt_bests,
                    public.bt_vs_matches, public.bt_vs_results FROM anon, authenticated;
GRANT SELECT ON TABLE public.bt_runs, public.bt_player_stats, public.bt_titan_stats, public.bt_bests,
                      public.bt_vs_matches, public.bt_vs_results TO anon, authenticated;
REVOKE ALL ON SEQUENCE public.bt_runs_id_seq FROM anon, authenticated;

-- ───────────────────────────── 3. internal: validation ─────────────────────────────
-- Returns NULL when the run payload is plausible, else a short reason code. Pure; never writes.
CREATE FUNCTION public.bt__validate_run(p jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_mode   text := coalesce(p->>'mode', 'solo');
  v_nonce  text := p->>'run_nonce';
  v_titan  text := p->>'titan';
  v_biome  text := p->>'biome';
  v_result text := p->>'result';
  v_phase  text := coalesce(p->>'phase', 'run');
  dur bigint; lvl bigint; rk bigint; kl bigint; cr bigint; tn bigint; bl bigint;
  bo bigint; gk bigint; es bigint; esc bigint; rm bigint; te bigint; clr numeric;
  max_blocks bigint;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN 'bad_payload'; END IF;
  BEGIN
    dur := round((p->>'duration_s')::numeric);
    lvl := round((p->>'level')::numeric);
    rk  := round((p->>'peak_rank')::numeric);
    kl  := round((p->>'kills')::numeric);
    tn  := round((p->>'tonnage')::numeric);
    cr  := round(coalesce((p->>'crushed')::numeric, 0));
    bl  := round(coalesce((p->>'blocks')::numeric, 0));
    bo  := round(coalesce((p->>'bosses')::numeric, 0));
    gk  := round(coalesce((p->>'gate_kills')::numeric, 0));
    es  := round(coalesce((p->>'endless_s')::numeric, 0));
    esc := round(coalesce((p->>'endless_score')::numeric, 0));
    rm  := round(coalesce((p->>'rematches')::numeric, 0));
    te  := round(coalesce((p->>'titans_eaten')::numeric, 0));
    clr := (p->>'clear_s')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'bad_number';
  END;

  IF v_nonce IS NULL OR char_length(v_nonce) NOT BETWEEN 8 AND 64 OR v_nonce !~ '^[A-Za-z0-9_.:-]+$' THEN
    RETURN 'bad_run_nonce';
  END IF;
  IF v_mode NOT IN ('solo','vs') THEN RETURN 'bad_mode'; END IF;
  IF v_titan IS NULL OR v_titan NOT IN ('molo','voltkite','hearthback','briarwick') THEN RETURN 'bad_titan'; END IF;
  IF v_biome IS NULL OR v_biome NOT IN ('grideast','whitestacks','lockwater') THEN RETURN 'bad_biome'; END IF;
  IF v_mode = 'solo' AND (v_result IS NULL OR v_result NOT IN ('clear','dead')) THEN RETURN 'bad_result'; END IF;
  IF v_mode = 'vs'   AND (v_result IS NULL OR v_result NOT IN ('vs_win','vs_place')) THEN RETURN 'bad_result'; END IF;
  IF v_phase NOT IN ('run','endless') THEN RETURN 'bad_phase'; END IF;
  IF char_length(coalesce(p->>'build_version', '')) > 64 THEN RETURN 'bad_build_version'; END IF;

  IF dur IS NULL OR dur NOT BETWEEN 5 AND 43200 THEN RETURN 'duration_out_of_range'; END IF;
  IF v_result = 'clear' THEN
    IF clr IS NULL OR clr < 300 OR clr > dur + 1 THEN RETURN 'clear_s_out_of_range'; END IF;
  ELSIF clr IS NOT NULL THEN
    RETURN 'clear_s_without_clear';
  END IF;
  IF lvl IS NULL OR lvl < 1 OR lvl > least(250, 40 + dur / 30) THEN RETURN 'level_out_of_range'; END IF;
  IF rk  IS NULL OR rk NOT BETWEEN 0 AND 4 THEN RETURN 'peak_rank_out_of_range'; END IF;
  IF kl  IS NULL OR kl < 0 OR kl > 500 + 30 * dur THEN RETURN 'kills_out_of_range'; END IF;
  IF cr < 0 OR cr > kl THEN RETURN 'crushed_out_of_range'; END IF;
  IF tn  IS NULL OR tn < 0 OR tn > 12000000 + 20000 * dur THEN RETURN 'tonnage_out_of_range'; END IF;
  max_blocks := CASE v_biome WHEN 'grideast' THEN 240 WHEN 'whitestacks' THEN 182 ELSE 208 END;
  IF bl < 0 OR bl > max_blocks THEN RETURN 'blocks_out_of_range'; END IF;
  IF es < 0 OR es > dur THEN RETURN 'endless_s_out_of_range'; END IF;
  IF es > 0 AND v_result <> 'clear' THEN RETURN 'endless_without_clear'; END IF;
  IF rm < 0 OR rm > es / 150 + 1 THEN RETURN 'rematches_out_of_range'; END IF;
  IF bo < 0 OR bo > 2 + es / 75 THEN RETURN 'bosses_out_of_range'; END IF;
  IF gk < 0 OR gk > 4 + es / 75 THEN RETURN 'gate_kills_out_of_range'; END IF;
  IF esc < 0 OR esc > 10 * es + 2 * kl + 5000 * rm + tn / 500 + 1500 * (es / 75 + 2) + 100 THEN
    RETURN 'endless_score_out_of_range';
  END IF;
  IF v_mode = 'solo' AND te <> 0 THEN RETURN 'titans_eaten_in_solo'; END IF;
  IF te < 0 OR te > 3 THEN RETURN 'titans_eaten_out_of_range'; END IF;
  RETURN NULL;
END;
$$;

-- ───────────────────────────── 4. internal: file one run ─────────────────────────────
-- Inserts the run (or applies the one endless follow-up), rolls it into lifetime / titan / bests and the profile,
-- returns {ok, already, run_id, endless_update, new_bests, board_rank}. Caller passes the VERIFIED auth.uid().
-- Never executable by clients (takes a user id as a parameter).
CREATE FUNCTION public.bt__file_run(p_uid uuid, p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_phase  text := coalesce(p->>'phase', 'run');
  r  public.bt_runs%ROWTYPE;      -- incoming run, normalised
  ex public.bt_runs%ROWTYPE;      -- stored row on a repeat
  ob public.bt_bests%ROWTYPE;     -- the record book BEFORE this run
  v_had_bests boolean := false;
  v_id bigint;
  v_new boolean := true;
  d_dur bigint := 0; d_kills bigint := 0; d_tons bigint := 0; d_blocks bigint := 0; d_bosses bigint := 0;
  v_new_bests text[] := ARRAY[]::text[];
  v_my numeric;
  v_rank_clear bigint; v_rank_ton bigint; v_rank_endless bigint;
BEGIN
  v_reason := public.bt__validate_run(p);
  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', v_reason);
  END IF;

  r.user_id       := p_uid;
  r.run_nonce     := p->>'run_nonce';
  r.mode          := coalesce(p->>'mode', 'solo');
  r.titan         := p->>'titan';
  r.biome         := p->>'biome';
  r.result        := p->>'result';
  r.placement     := CASE WHEN r.mode = 'vs' THEN round((p->>'placement')::numeric) END;
  r.duration_s    := round((p->>'duration_s')::numeric);
  r.clear_s       := CASE WHEN r.result = 'clear' THEN floor((p->>'clear_s')::numeric * 10) / 10 END;
  r.level         := round((p->>'level')::numeric);
  r.peak_rank     := round((p->>'peak_rank')::numeric);
  r.kills         := round((p->>'kills')::numeric);
  r.crushed       := round(coalesce((p->>'crushed')::numeric, 0));
  r.tonnage       := round((p->>'tonnage')::numeric);
  r.blocks        := round(coalesce((p->>'blocks')::numeric, 0));
  r.bosses        := round(coalesce((p->>'bosses')::numeric, 0));
  r.gate_kills    := round(coalesce((p->>'gate_kills')::numeric, 0));
  r.endless_s     := round(coalesce((p->>'endless_s')::numeric, 0));
  r.endless_score := round(coalesce((p->>'endless_score')::numeric, 0));
  r.rematches     := round(coalesce((p->>'rematches')::numeric, 0));
  r.titans_eaten  := round(coalesce((p->>'titans_eaten')::numeric, 0));
  r.vs_match_id   := CASE WHEN r.mode = 'vs' THEN p->>'vs_match_id' END;
  r.build_version := nullif(p->>'build_version', '');

  INSERT INTO public.bt_runs (user_id, run_nonce, mode, titan, biome, result, placement, duration_s, clear_s, level,
                              peak_rank, kills, crushed, tonnage, blocks, bosses, gate_kills, endless_s, endless_score,
                              rematches, titans_eaten, endless_filed, vs_match_id, build_version)
  VALUES (r.user_id, r.run_nonce, r.mode, r.titan, r.biome, r.result, r.placement, r.duration_s, r.clear_s, r.level,
          r.peak_rank, r.kills, r.crushed, r.tonnage, r.blocks, r.bosses, r.gate_kills, r.endless_s, r.endless_score,
          r.rematches, r.titans_eaten, (v_phase = 'endless'), r.vs_match_id, r.build_version)
  ON CONFLICT (user_id, run_nonce) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    d_dur := r.duration_s; d_kills := r.kills; d_tons := r.tonnage; d_blocks := r.blocks; d_bosses := r.bosses;
  ELSE
    SELECT * INTO ex FROM public.bt_runs WHERE user_id = p_uid AND run_nonce = r.run_nonce FOR UPDATE;
    -- The one allowed update: EXTENDED COVERAGE follow-up of a solo clear, same titan + city, figures only grow.
    IF v_phase = 'endless' AND NOT ex.endless_filed AND ex.mode = 'solo' AND r.mode = 'solo'
       AND ex.result = 'clear' AND r.result = 'clear' AND ex.titan = r.titan AND ex.biome = r.biome THEN
      IF r.duration_s < ex.duration_s OR r.kills < ex.kills OR r.tonnage < ex.tonnage OR r.level < ex.level
         OR r.endless_s < ex.endless_s THEN
        RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'endless_regressed');
      END IF;
      v_new    := false;
      v_id     := ex.id;
      r.clear_s := ex.clear_s;                         -- the clear time is the original one
      r.blocks  := greatest(ex.blocks, r.blocks);
      r.bosses  := greatest(ex.bosses, r.bosses);
      d_dur    := r.duration_s - ex.duration_s;
      d_kills  := r.kills - ex.kills;
      d_tons   := r.tonnage - ex.tonnage;
      d_blocks := r.blocks - ex.blocks;
      d_bosses := r.bosses - ex.bosses;
      UPDATE public.bt_runs SET
        duration_s = r.duration_s, level = r.level, peak_rank = greatest(ex.peak_rank, r.peak_rank),
        kills = r.kills, crushed = greatest(ex.crushed, r.crushed), tonnage = r.tonnage, blocks = r.blocks,
        bosses = r.bosses, gate_kills = greatest(ex.gate_kills, r.gate_kills), endless_s = r.endless_s,
        endless_score = r.endless_score, rematches = r.rematches, endless_filed = true, updated_at = now()
      WHERE id = ex.id;
    ELSE
      RETURN jsonb_build_object('ok', true, 'already', true, 'run_id', ex.id);
    END IF;
  END IF;

  -- lifetime
  INSERT INTO public.bt_player_stats AS s (user_id, runs, clears, deaths, play_s, kills, tonnage, blocks, bosses,
                                           best_level, best_peak_rank, updated_at)
  VALUES (p_uid,
          CASE WHEN v_new THEN 1 ELSE 0 END,
          CASE WHEN v_new AND r.result = 'clear' THEN 1 ELSE 0 END,
          CASE WHEN v_new AND r.result = 'dead'  THEN 1 ELSE 0 END,
          d_dur, d_kills, d_tons, d_blocks, d_bosses, r.level, r.peak_rank, now())
  ON CONFLICT (user_id) DO UPDATE SET
    runs = s.runs + excluded.runs, clears = s.clears + excluded.clears, deaths = s.deaths + excluded.deaths,
    play_s = s.play_s + excluded.play_s, kills = s.kills + excluded.kills, tonnage = s.tonnage + excluded.tonnage,
    blocks = s.blocks + excluded.blocks, bosses = s.bosses + excluded.bosses,
    best_level = greatest(s.best_level, excluded.best_level),
    best_peak_rank = greatest(s.best_peak_rank, excluded.best_peak_rank), updated_at = now();

  -- per titan
  INSERT INTO public.bt_titan_stats AS t (user_id, titan, runs, clears, play_s, kills, best_level, best_tonnage, updated_at)
  VALUES (p_uid, r.titan, CASE WHEN v_new THEN 1 ELSE 0 END, CASE WHEN v_new AND r.result = 'clear' THEN 1 ELSE 0 END,
          d_dur, d_kills, r.level, r.tonnage, now())
  ON CONFLICT (user_id, titan) DO UPDATE SET
    runs = t.runs + excluded.runs, clears = t.clears + excluded.clears, play_s = t.play_s + excluded.play_s,
    kills = t.kills + excluded.kills, best_level = greatest(t.best_level, excluded.best_level),
    best_tonnage = greatest(t.best_tonnage, excluded.best_tonnage), updated_at = now();

  -- record book (solo only) + which records fell
  IF r.mode = 'solo' THEN
    SELECT * INTO ob FROM public.bt_bests WHERE user_id = p_uid AND titan = r.titan AND biome = r.biome FOR UPDATE;
    v_had_bests := FOUND;
    IF r.clear_s IS NOT NULL AND (NOT v_had_bests OR ob.clear_s IS NULL OR r.clear_s < ob.clear_s) THEN
      v_new_bests := array_append(v_new_bests, 'clear_s'); END IF;
    IF r.tonnage       > coalesce(ob.tonnage, 0)       THEN v_new_bests := array_append(v_new_bests, 'tonnage');       END IF;
    IF r.blocks        > coalesce(ob.blocks, 0)        THEN v_new_bests := array_append(v_new_bests, 'blocks');        END IF;
    IF r.kills         > coalesce(ob.kills, 0)         THEN v_new_bests := array_append(v_new_bests, 'kills');         END IF;
    IF r.level         > coalesce(ob.level, 0)         THEN v_new_bests := array_append(v_new_bests, 'level');         END IF;
    IF r.peak_rank     > coalesce(ob.peak_rank, 0)     THEN v_new_bests := array_append(v_new_bests, 'peak_rank');     END IF;
    IF r.duration_s    > coalesce(ob.survived_s, 0)    THEN v_new_bests := array_append(v_new_bests, 'survived_s');    END IF;
    IF r.endless_s     > coalesce(ob.endless_s, 0)     THEN v_new_bests := array_append(v_new_bests, 'endless_s');     END IF;
    IF r.endless_score > coalesce(ob.endless_score, 0) THEN v_new_bests := array_append(v_new_bests, 'endless_score'); END IF;
    IF r.rematches     > coalesce(ob.rematches, 0)     THEN v_new_bests := array_append(v_new_bests, 'rematches');     END IF;

    INSERT INTO public.bt_bests AS b (user_id, titan, biome, clears, clear_s, tonnage, blocks, kills, level, peak_rank,
                                      survived_s, endless_s, endless_score, rematches, updated_at)
    VALUES (p_uid, r.titan, r.biome, CASE WHEN v_new AND r.result = 'clear' THEN 1 ELSE 0 END, r.clear_s, r.tonnage,
            r.blocks, r.kills, r.level, r.peak_rank, r.duration_s, r.endless_s, r.endless_score, r.rematches, now())
    ON CONFLICT (user_id, titan, biome) DO UPDATE SET
      clears = b.clears + excluded.clears,
      clear_s = least(b.clear_s, excluded.clear_s),          -- least() skips NULLs
      tonnage = greatest(b.tonnage, excluded.tonnage), blocks = greatest(b.blocks, excluded.blocks),
      kills = greatest(b.kills, excluded.kills), level = greatest(b.level, excluded.level),
      peak_rank = greatest(b.peak_rank, excluded.peak_rank), survived_s = greatest(b.survived_s, excluded.survived_s),
      endless_s = greatest(b.endless_s, excluded.endless_s),
      endless_score = greatest(b.endless_score, excluded.endless_score),
      rematches = greatest(b.rematches, excluded.rematches), updated_at = now();

    -- board ranks (all titans, this city, all time) -- same ordering as bt_leaderboard; ties share a rank
    SELECT min(clear_s) INTO v_my FROM public.bt_bests WHERE user_id = p_uid AND biome = r.biome;
    IF v_my IS NOT NULL THEN
      SELECT 1 + count(*) INTO v_rank_clear FROM (
        SELECT user_id, min(clear_s) AS v FROM public.bt_bests WHERE biome = r.biome AND clear_s IS NOT NULL GROUP BY user_id
      ) x WHERE x.v < v_my;
    END IF;
    SELECT max(tonnage) INTO v_my FROM public.bt_bests WHERE user_id = p_uid AND biome = r.biome;
    IF coalesce(v_my, 0) > 0 THEN
      SELECT 1 + count(*) INTO v_rank_ton FROM (
        SELECT user_id, max(tonnage) AS v FROM public.bt_bests WHERE biome = r.biome GROUP BY user_id
      ) x WHERE x.v > v_my;
    END IF;
    SELECT max(endless_score) INTO v_my FROM public.bt_bests WHERE user_id = p_uid AND biome = r.biome;
    IF coalesce(v_my, 0) > 0 THEN
      SELECT 1 + count(*) INTO v_rank_endless FROM (
        SELECT user_id, max(endless_score) AS v FROM public.bt_bests WHERE biome = r.biome GROUP BY user_id
      ) x WHERE x.v > v_my;
    END IF;
  END IF;

  -- profile header (pages/profile reads games_played + total_play_time_seconds; nothing else writes play time)
  UPDATE public.profiles SET
    games_played = games_played + CASE WHEN v_new THEN 1 ELSE 0 END,
    total_play_time_seconds = total_play_time_seconds + d_dur
  WHERE id = p_uid;

  RETURN jsonb_build_object(
    'ok', true, 'already', false, 'run_id', v_id, 'endless_update', NOT v_new,
    'new_bests', to_jsonb(v_new_bests),
    'board_rank', jsonb_build_object('clear', v_rank_clear, 'tonnage', v_rank_ton, 'endless', v_rank_endless));
END;
$$;

-- ───────────────────────────── 5. RPC: bt_submit_run (solo) ─────────────────────────────
-- Bridge: forgeflow:run_result {payload} -> supabase.rpc('bt_submit_run', {p: payload}).
-- Not signed in -> raises 42501 'not_signed_in' (PostgREST 401/403). Bad figures -> {ok:false, error:'rejected', reason}.
CREATE FUNCTION public.bt_submit_run(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501'; END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'bad_payload');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_profile');
  END IF;
  IF coalesce(p->>'mode', 'solo') <> 'solo' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'bad_mode');
  END IF;
  RETURN public.bt__file_run(v_uid, p || jsonb_build_object('mode', 'solo'));
END;
$$;

-- ───────────────────────────── 6. RPC: bt_report_vs (Phase B) ─────────────────────────────
-- Each human reports only their own result. The winner is CONFIRMED (winner_id set, vs_wins credited) only when
-- >= 2 human reports exist, every report names the same non-null winner, and that winner reported placement 1
-- (ONLINE_PLAN section 2). 1-human matches never confirm a board win: the reporter's win goes to vs_solo_wins (D9).
-- Also files a bt_runs row (mode 'vs', run_nonce 'vs-' || md5(match_id)) through the solo path's roll-up.
CREATE FUNCTION public.bt_report_vs(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_match  text;
  v_biome  text;
  v_titan  text;
  v_place  int; v_humans int; v_bots int; v_te int; v_peak int; v_surv int;
  v_claim  uuid;
  v_run    jsonb;
  v_reason text;
  v_runres jsonb;
  m        public.bt_vs_matches%ROWTYPE;
  v_old    uuid;
  v_winner uuid;
  v_wtitan text;
  v_n int; v_nclaims int; v_ndistinct int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501'; END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'bad_payload');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_profile');
  END IF;
  v_match := p->>'match_id'; v_biome := p->>'biome'; v_titan := p->>'titan';
  BEGIN
    v_place  := round((p->>'placement')::numeric);
    v_humans := round((p->>'humans')::numeric);
    v_bots   := round((p->>'bots')::numeric);
    v_te     := round(coalesce((p->>'titans_eaten')::numeric, 0));
    v_peak   := round(coalesce((p->>'peak_level')::numeric, (p->>'level')::numeric, 0));
    v_surv   := round(coalesce((p->>'survived_s')::numeric, (p->>'duration_s')::numeric, 0));
    v_claim  := nullif(p->>'claimed_winner', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'bad_number');
  END;
  IF v_match IS NULL OR char_length(v_match) NOT BETWEEN 8 AND 80 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'bad_match_id'); END IF;
  IF v_place IS NULL OR v_place NOT BETWEEN 1 AND 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'bad_placement'); END IF;
  IF v_humans IS NULL OR v_bots IS NULL OR v_humans NOT BETWEEN 1 AND 4 OR v_bots NOT BETWEEN 0 AND 3
     OR v_humans + v_bots <> 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'bad_seats'); END IF;
  IF v_peak NOT BETWEEN 0 AND 250 OR v_surv NOT BETWEEN 0 AND 43200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'bad_figures'); END IF;
  -- the claim must match the reporter's own placement
  IF (v_place = 1 AND v_claim IS DISTINCT FROM v_uid) OR (v_claim = v_uid AND v_place <> 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'claim_mismatch'); END IF;
  IF v_humans = 1 AND v_claim IS NOT NULL AND v_claim <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'claim_mismatch'); END IF;

  v_run := p || jsonb_build_object(
    'mode', 'vs', 'result', CASE WHEN v_place = 1 THEN 'vs_win' ELSE 'vs_place' END,
    'run_nonce', 'vs-' || md5(v_match), 'vs_match_id', v_match, 'phase', 'run',
    'clear_s', NULL, 'endless_s', 0, 'endless_score', 0, 'rematches', 0, 'titans_eaten', v_te);
  v_reason := public.bt__validate_run(v_run);
  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', v_reason);
  END IF;

  INSERT INTO public.bt_vs_matches (match_id, biome, humans, bots) VALUES (v_match, v_biome, v_humans, v_bots)
  ON CONFLICT (match_id) DO NOTHING;
  SELECT * INTO m FROM public.bt_vs_matches WHERE match_id = v_match FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.bt_vs_results WHERE match_id = v_match AND user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'winner_confirmed', m.winner_id IS NOT NULL,
                              'winner_id', m.winner_id, 'reports', m.reports);
  END IF;
  IF m.reports >= m.humans THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'match_full'); END IF;
  IF EXISTS (SELECT 1 FROM public.bt_vs_results WHERE match_id = v_match AND placement = v_place) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rejected', 'reason', 'placement_taken'); END IF;

  INSERT INTO public.bt_vs_results (match_id, user_id, titan, placement, claimed_winner, titans_eaten, peak_level, survived_s)
  VALUES (v_match, v_uid, v_titan, v_place, v_claim, v_te, v_peak, v_surv);
  UPDATE public.bt_vs_matches SET reports = reports + 1 WHERE match_id = v_match;

  v_runres := public.bt__file_run(v_uid, v_run);
  IF NOT coalesce((v_runres->>'ok')::boolean, false) OR coalesce((v_runres->>'already')::boolean, false) THEN
    RAISE EXCEPTION 'bt_report_vs: run roll-up failed: %', v_runres;   -- aborts the whole report (no half write)
  END IF;

  UPDATE public.bt_player_stats SET
    vs_matches      = vs_matches + 1,
    vs_top2         = vs_top2 + CASE WHEN v_place <= 2 THEN 1 ELSE 0 END,
    vs_titans_eaten = vs_titans_eaten + v_te,
    vs_solo_wins    = vs_solo_wins + CASE WHEN m.humans = 1 AND v_place = 1 THEN 1 ELSE 0 END,
    updated_at      = now()
  WHERE user_id = v_uid;

  -- confirmation (recomputed on every report; a later disagreeing report withdraws a confirmed win)
  SELECT count(*), count(claimed_winner), count(DISTINCT claimed_winner)
    INTO v_n, v_nclaims, v_ndistinct
    FROM public.bt_vs_results WHERE match_id = v_match;
  v_winner := NULL;
  IF v_n >= 2 AND v_nclaims = v_n AND v_ndistinct = 1 THEN
    SELECT claimed_winner INTO v_winner FROM public.bt_vs_results WHERE match_id = v_match LIMIT 1;
    IF NOT EXISTS (SELECT 1 FROM public.bt_vs_results WHERE match_id = v_match AND user_id = v_winner AND placement = 1) THEN
      v_winner := NULL;
    END IF;
  END IF;
  v_old := m.winner_id;
  IF v_winner IS DISTINCT FROM v_old THEN
    IF v_old IS NOT NULL THEN
      SELECT titan INTO v_wtitan FROM public.bt_vs_results WHERE match_id = v_match AND user_id = v_old;
      UPDATE public.bt_player_stats SET vs_wins = greatest(0, vs_wins - 1), updated_at = now() WHERE user_id = v_old;
      UPDATE public.bt_titan_stats  SET vs_wins = greatest(0, vs_wins - 1), updated_at = now()
        WHERE user_id = v_old AND titan = v_wtitan;
    END IF;
    IF v_winner IS NOT NULL THEN
      SELECT titan INTO v_wtitan FROM public.bt_vs_results WHERE match_id = v_match AND user_id = v_winner;
      INSERT INTO public.bt_player_stats AS s (user_id, vs_wins) VALUES (v_winner, 1)
        ON CONFLICT (user_id) DO UPDATE SET vs_wins = s.vs_wins + 1, updated_at = now();
      INSERT INTO public.bt_titan_stats AS t (user_id, titan, vs_wins) VALUES (v_winner, v_wtitan, 1)
        ON CONFLICT (user_id, titan) DO UPDATE SET vs_wins = t.vs_wins + 1, updated_at = now();
    END IF;
    UPDATE public.bt_vs_matches SET winner_id = v_winner WHERE match_id = v_match;
  END IF;

  RETURN jsonb_build_object('ok', true, 'already', false, 'winner_confirmed', v_winner IS NOT NULL,
                            'winner_id', v_winner, 'reports', m.reports + 1, 'run', v_runres);
END;
$$;

-- ───────────────────────────── 7. RPC: bt_leaderboard (public) ─────────────────────────────
-- p_board: 'clear' (FASTEST CLEAR, clear_s asc) | 'tonnage' (BIGGEST APPETITE) | 'endless' (EXTENDED COVERAGE score)
--          -- solo runs, one row per player = their best run, filtered by titan / city
--        | 'lifetime_kills' | 'lifetime_tonnage'   -- sums of bt_runs (solo + VS), filtered by titan / city / period
--        | 'vs_wins' (confirmed wins) | 'titans_eaten'  -- Phase B
-- p_titan / p_biome: NULL = all. p_period: 'all' | 'week' (UTC Monday 00:00, computed server-side). Top p_limit (<= 100).
CREATE FUNCTION public.bt_leaderboard(p_board text, p_titan text DEFAULT NULL, p_biome text DEFAULT NULL,
                                      p_period text DEFAULT 'all', p_limit integer DEFAULT 100)
RETURNS TABLE (rank bigint, user_id uuid, username text, avatar_url text, value numeric, titan text, biome text,
               achieved_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_period text := coalesce(p_period, 'all');
  v_since  timestamptz;
  v_lim    integer := least(greatest(coalesce(p_limit, 100), 1), 100);
BEGIN
  IF v_period NOT IN ('all','week') THEN RAISE EXCEPTION 'bad period %', p_period USING ERRCODE = '22023'; END IF;
  IF p_titan IS NOT NULL AND p_titan NOT IN ('molo','voltkite','hearthback','briarwick') THEN
    RAISE EXCEPTION 'bad titan %', p_titan USING ERRCODE = '22023'; END IF;
  IF p_biome IS NOT NULL AND p_biome NOT IN ('grideast','whitestacks','lockwater') THEN
    RAISE EXCEPTION 'bad biome %', p_biome USING ERRCODE = '22023'; END IF;
  v_since := CASE WHEN v_period = 'week' THEN date_trunc('week', now(), 'UTC') ELSE '-infinity'::timestamptz END;

  IF p_board = 'clear' THEN
    RETURN QUERY
    WITH best AS (
      SELECT DISTINCT ON (r.user_id) r.user_id AS uid, r.titan AS ti, r.biome AS bi, r.created_at AS ts,
             r.clear_s::numeric AS v
      FROM public.bt_runs r
      WHERE r.mode = 'solo' AND r.result = 'clear' AND r.clear_s IS NOT NULL AND r.created_at >= v_since
        AND (p_titan IS NULL OR r.titan = p_titan) AND (p_biome IS NULL OR r.biome = p_biome)
      ORDER BY r.user_id, r.clear_s ASC, r.created_at ASC
    )
    SELECT rank() OVER (ORDER BY b.v ASC), b.uid, pr.username, pr.avatar_url, b.v, b.ti, b.bi, b.ts
    FROM best b JOIN public.profiles pr ON pr.id = b.uid
    ORDER BY b.v ASC, b.ts ASC LIMIT v_lim;

  ELSIF p_board IN ('tonnage','endless') THEN
    RETURN QUERY
    WITH runs AS (
      SELECT r.user_id AS uid, r.titan AS ti, r.biome AS bi, r.created_at AS ts,
             (CASE WHEN p_board = 'tonnage' THEN r.tonnage::numeric ELSE r.endless_score::numeric END) AS v
      FROM public.bt_runs r
      WHERE r.mode = 'solo' AND r.created_at >= v_since
        AND (p_titan IS NULL OR r.titan = p_titan) AND (p_biome IS NULL OR r.biome = p_biome)
    ), best AS (
      SELECT DISTINCT ON (x.uid) x.uid, x.ti, x.bi, x.ts, x.v FROM runs x WHERE x.v > 0
      ORDER BY x.uid, x.v DESC, x.ts ASC
    )
    SELECT rank() OVER (ORDER BY b.v DESC), b.uid, pr.username, pr.avatar_url, b.v, b.ti, b.bi, b.ts
    FROM best b JOIN public.profiles pr ON pr.id = b.uid
    ORDER BY b.v DESC, b.ts ASC LIMIT v_lim;

  ELSIF p_board IN ('lifetime_kills','lifetime_tonnage') THEN
    RETURN QUERY
    WITH sums AS (
      SELECT r.user_id AS uid, max(r.updated_at) AS ts,
             sum(CASE WHEN p_board = 'lifetime_kills' THEN r.kills::numeric ELSE r.tonnage::numeric END) AS v
      FROM public.bt_runs r
      WHERE r.created_at >= v_since
        AND (p_titan IS NULL OR r.titan = p_titan) AND (p_biome IS NULL OR r.biome = p_biome)
      GROUP BY r.user_id
    )
    SELECT rank() OVER (ORDER BY s.v DESC), s.uid, pr.username, pr.avatar_url, s.v, p_titan, p_biome, s.ts
    FROM sums s JOIN public.profiles pr ON pr.id = s.uid
    WHERE s.v > 0
    ORDER BY s.v DESC, s.ts ASC LIMIT v_lim;

  ELSIF p_board = 'vs_wins' THEN
    RETURN QUERY
    WITH w AS (
      SELECT m.winner_id AS uid, count(*)::numeric AS v, max(m.created_at) AS ts
      FROM public.bt_vs_matches m
      JOIN public.bt_vs_results res ON res.match_id = m.match_id AND res.user_id = m.winner_id
      WHERE m.winner_id IS NOT NULL AND m.created_at >= v_since
        AND (p_titan IS NULL OR res.titan = p_titan) AND (p_biome IS NULL OR m.biome = p_biome)
      GROUP BY m.winner_id
    )
    SELECT rank() OVER (ORDER BY w.v DESC), w.uid, pr.username, pr.avatar_url, w.v, p_titan, p_biome, w.ts
    FROM w JOIN public.profiles pr ON pr.id = w.uid
    ORDER BY w.v DESC, w.ts ASC LIMIT v_lim;

  ELSIF p_board = 'titans_eaten' THEN
    RETURN QUERY
    WITH e AS (
      SELECT res.user_id AS uid, sum(res.titans_eaten)::numeric AS v, max(res.created_at) AS ts
      FROM public.bt_vs_results res JOIN public.bt_vs_matches m ON m.match_id = res.match_id
      WHERE res.created_at >= v_since
        AND (p_titan IS NULL OR res.titan = p_titan) AND (p_biome IS NULL OR m.biome = p_biome)
      GROUP BY res.user_id
    )
    SELECT rank() OVER (ORDER BY e.v DESC), e.uid, pr.username, pr.avatar_url, e.v, p_titan, p_biome, e.ts
    FROM e JOIN public.profiles pr ON pr.id = e.uid
    WHERE e.v > 0
    ORDER BY e.v DESC, e.ts ASC LIMIT v_lim;

  ELSE
    RAISE EXCEPTION 'unknown board %', p_board USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ───────────────────────────── 8. RPC: bt_player_card (public) ─────────────────────────────
-- One round trip for the profile card and the detail page's "your records".
-- {user, lifetime: bt_player_stats row | null, titans: [bt_titan_stats], bests: [bt_bests], recent: [last 10 runs]}
CREATE FUNCTION public.bt_player_card(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user', (SELECT jsonb_build_object('id', pr.id, 'username', pr.username, 'avatar_url', pr.avatar_url,
                                       'level', pr.level)
             FROM public.profiles pr WHERE pr.id = p_user),
    'lifetime', (SELECT to_jsonb(s) FROM public.bt_player_stats s WHERE s.user_id = p_user),
    'titans', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.titan)
                        FROM public.bt_titan_stats t WHERE t.user_id = p_user), '[]'::jsonb),
    'bests', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.biome, b.titan)
                       FROM public.bt_bests b WHERE b.user_id = p_user), '[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
                          SELECT r.id, r.mode, r.titan, r.biome, r.result, r.placement, r.duration_s, r.clear_s,
                                 r.level, r.peak_rank, r.kills, r.tonnage, r.endless_score, r.created_at
                          FROM public.bt_runs r WHERE r.user_id = p_user ORDER BY r.created_at DESC LIMIT 10) x),
                       '[]'::jsonb));
$$;

-- ───────────────────────────── 9. function privileges ─────────────────────────────
-- Supabase's default privileges grant EXECUTE on new functions to anon + authenticated (and Postgres to PUBLIC).
REVOKE ALL ON FUNCTION public.bt__validate_run(jsonb)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bt__file_run(uuid, jsonb)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bt_submit_run(jsonb)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bt_report_vs(jsonb)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bt_leaderboard(text, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bt_player_card(uuid)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bt_submit_run(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bt_report_vs(jsonb)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bt_leaderboard(text, text, text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bt_player_card(uuid) TO anon, authenticated, service_role;

-- ───────────────────────────── 10. self-test (inside this transaction) ─────────────────────────────
DO $selftest$
DECLARE
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  base jsonb;
  r jsonb;
  n bigint;
  x numeric;
  checks int := 0;
  msg text;
  v_comment text;
BEGIN
  BEGIN   -- subtransaction: everything below is rolled back at the end (on top of the explicit deletes)
    -- two fake users (postgres may write auth.users; the only trigger there is on_auth_user_created -> profiles)
    INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
      (u1, 'authenticated', 'authenticated', 'bt-selftest-' || u1 || '@invalid.test',
       jsonb_build_object('username', 'bt_selftest_' || left(u1::text, 8)), now(), now()),
      (u2, 'authenticated', 'authenticated', 'bt-selftest-' || u2 || '@invalid.test',
       jsonb_build_object('username', 'bt_selftest_' || left(u2::text, 8)), now(), now());
    INSERT INTO public.profiles (id, username) VALUES
      (u1, 'bt_selftest_' || left(u1::text, 8)), (u2, 'bt_selftest_' || left(u2::text, 8))
    ON CONFLICT (id) DO NOTHING;

    -- ── act as u1, signed in ──
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    base := jsonb_build_object(
      'run_nonce', 'bt-selftest-0001', 'mode', 'solo', 'phase', 'run', 'titan', 'molo', 'biome', 'grideast',
      'result', 'clear', 'duration_s', 1200, 'clear_s', 1180.57, 'level', 36, 'peak_rank', 4, 'kills', 2100,
      'crushed', 300, 'tonnage', 4500000, 'blocks', 120, 'bosses', 1, 'gate_kills', 3, 'endless_s', 0,
      'endless_score', 0, 'rematches', 0, 'titans_eaten', 0, 'vs_match_id', NULL, 'build_version', 'selftest');

    -- 1. first submit files the run
    r := public.bt_submit_run(base);
    IF NOT coalesce((r->>'ok')::boolean, false) OR coalesce((r->>'already')::boolean, true) THEN
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 1 first submit: %', r; END IF;
    IF (r->'board_rank'->>'clear')::int IS DISTINCT FROM 1 OR (r->'board_rank'->>'tonnage')::int IS DISTINCT FROM 1
       OR NOT (r->'new_bests') ? 'clear_s' THEN
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 1 rank/new_bests: %', r; END IF;
    checks := checks + 1;

    -- 2. resubmit (same nonce) -> already, no double count
    r := public.bt_submit_run(base);
    IF NOT coalesce((r->>'already')::boolean, false) THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 2 resubmit: %', r; END IF;
    SELECT count(*) INTO n FROM public.bt_runs WHERE user_id = u1;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 2 bt_runs rows = %', n; END IF;
    checks := checks + 1;

    -- 3. roll-ups: lifetime, titan, bests (clear_s floored to tenths), profile header
    SELECT count(*) INTO n FROM public.bt_player_stats
      WHERE user_id = u1 AND runs = 1 AND clears = 1 AND deaths = 0 AND kills = 2100 AND tonnage = 4500000
        AND play_s = 1200 AND best_level = 36 AND best_peak_rank = 4;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 3 bt_player_stats'; END IF;
    SELECT count(*) INTO n FROM public.bt_titan_stats WHERE user_id = u1 AND titan = 'molo' AND runs = 1 AND clears = 1;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 3 bt_titan_stats'; END IF;
    SELECT clear_s INTO x FROM public.bt_bests WHERE user_id = u1 AND titan = 'molo' AND biome = 'grideast';
    IF x IS DISTINCT FROM 1180.5 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 3 bt_bests.clear_s = %', x; END IF;
    SELECT count(*) INTO n FROM public.profiles WHERE id = u1 AND games_played = 1 AND total_play_time_seconds = 1200;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 3 profiles header'; END IF;
    checks := checks + 1;

    -- 4. impossible runs -> rejected, nothing written
    r := public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-bad1', 'kills', 10000000));
    IF coalesce((r->>'ok')::boolean, true) OR r->>'error' <> 'rejected' OR r->>'reason' <> 'kills_out_of_range' THEN
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 4 kills: %', r; END IF;
    r := public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-bad2', 'tonnage', 999999999999));
    IF r->>'reason' IS DISTINCT FROM 'tonnage_out_of_range' THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 4 tonnage: %', r; END IF;
    r := public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-bad3', 'level', 999));
    IF r->>'reason' IS DISTINCT FROM 'level_out_of_range' THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 4 level: %', r; END IF;
    r := public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-bad4', 'clear_s', 12.0));
    IF r->>'reason' IS DISTINCT FROM 'clear_s_out_of_range' THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 4 clear_s: %', r; END IF;
    r := public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-bad5', 'titan', 'godzilla'));
    IF r->>'reason' IS DISTINCT FROM 'bad_titan' THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 4 titan: %', r; END IF;
    r := public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-bad6', 'blocks', 500));
    IF r->>'reason' IS DISTINCT FROM 'blocks_out_of_range' THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 4 blocks: %', r; END IF;
    r := public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-bad7', 'kills', 'lots'));
    IF r->>'reason' IS DISTINCT FROM 'bad_number' THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 4 non-number: %', r; END IF;
    r := public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-bad8', 'mode', 'vs'));
    IF r->>'reason' IS DISTINCT FROM 'bad_mode' THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 4 mode: %', r; END IF;
    SELECT count(*) INTO n FROM public.bt_runs WHERE user_id = u1;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 4 rejected runs were written (% rows)', n; END IF;
    checks := checks + 1;

    -- 5. direct client writes are denied (no INSERT/UPDATE/DELETE grant; helper not executable)
    BEGIN
      INSERT INTO public.bt_runs (user_id, run_nonce, mode, titan, biome, result, duration_s, level, peak_rank, kills, tonnage)
      VALUES (u1, 'bt-selftest-direct', 'solo', 'molo', 'grideast', 'dead', 60, 1, 0, 0, 0);
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 5 direct INSERT into bt_runs was allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE public.bt_player_stats SET kills = 999999 WHERE user_id = u1;
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 5 direct UPDATE of bt_player_stats was allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      DELETE FROM public.bt_bests WHERE user_id = u1;
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 5 direct DELETE from bt_bests was allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.bt__file_run(u2, base || jsonb_build_object('run_nonce', 'bt-selftest-helper'));
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 5 internal bt__file_run was callable by authenticated';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    checks := checks + 1;

    -- 6. EXTENDED COVERAGE follow-up (same nonce, phase endless): applied once, deltas only
    r := public.bt_submit_run(base || jsonb_build_object('phase', 'endless', 'duration_s', 1500, 'kills', 2600,
           'tonnage', 5200000, 'level', 38, 'endless_s', 300, 'endless_score', 11000, 'rematches', 1, 'bosses', 2));
    IF NOT coalesce((r->>'ok')::boolean, false) OR NOT coalesce((r->>'endless_update')::boolean, false) THEN
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 6 endless update: %', r; END IF;
    r := public.bt_submit_run(base || jsonb_build_object('phase', 'endless', 'duration_s', 1500, 'kills', 2600,
           'tonnage', 5200000, 'level', 38, 'endless_s', 300, 'endless_score', 11000, 'rematches', 1, 'bosses', 2));
    IF NOT coalesce((r->>'already')::boolean, false) THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 6 endless repeat: %', r; END IF;
    SELECT count(*) INTO n FROM public.bt_player_stats
      WHERE user_id = u1 AND runs = 1 AND clears = 1 AND kills = 2600 AND tonnage = 5200000 AND play_s = 1500 AND bosses = 2;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 6 endless deltas in bt_player_stats'; END IF;
    SELECT count(*) INTO n FROM public.bt_bests
      WHERE user_id = u1 AND clear_s = 1180.5 AND endless_score = 11000 AND survived_s = 1500 AND clears = 1;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 6 endless bests'; END IF;
    SELECT count(*) INTO n FROM public.profiles WHERE id = u1 AND games_played = 1 AND total_play_time_seconds = 1500;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 6 endless profile header'; END IF;
    checks := checks + 1;

    -- 7. boards + card
    SELECT count(*) INTO n FROM public.bt_leaderboard('clear', NULL, 'grideast', 'all') lb
      WHERE lb.user_id = u1 AND lb.rank = 1 AND lb.value = 1180.5 AND lb.titan = 'molo';
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 7 clear board'; END IF;
    SELECT count(*) INTO n FROM public.bt_leaderboard('tonnage', 'molo', 'grideast', 'week') lb
      WHERE lb.user_id = u1 AND lb.value = 5200000;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 7 tonnage board (week)'; END IF;
    SELECT count(*) INTO n FROM public.bt_leaderboard('endless', NULL, NULL, 'all') lb
      WHERE lb.user_id = u1 AND lb.value = 11000;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 7 endless board'; END IF;
    SELECT count(*) INTO n FROM public.bt_leaderboard('lifetime_kills', NULL, NULL, 'all') lb
      WHERE lb.user_id = u1 AND lb.value = 2600;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 7 lifetime board'; END IF;
    SELECT count(*) INTO n FROM public.bt_leaderboard('clear', NULL, 'lockwater', 'all');
    IF n <> 0 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 7 biome filter'; END IF;
    r := public.bt_player_card(u1);
    IF (r->'lifetime'->>'runs')::int IS DISTINCT FROM 1 OR jsonb_array_length(r->'bests') <> 1
       OR jsonb_array_length(r->'titans') <> 1 OR jsonb_array_length(r->'recent') <> 1 THEN
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 7 player card: %', r; END IF;
    checks := checks + 1;

    -- 8. VS: 2 humans agree -> confirmed win; resubmit -> already; 1-human match -> personal stat only
    r := public.bt_report_vs(jsonb_build_object('match_id', 'bt-selftest:ROOM:0001', 'biome', 'whitestacks',
           'humans', 2, 'bots', 2, 'titan', 'voltkite', 'placement', 1, 'claimed_winner', u1, 'titans_eaten', 2,
           'duration_s', 600, 'level', 30, 'peak_rank', 4, 'kills', 900, 'tonnage', 2000000));
    IF NOT coalesce((r->>'ok')::boolean, false) OR coalesce((r->>'winner_confirmed')::boolean, true) THEN
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 8 first VS report: %', r; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u2::text, true);
    r := public.bt_report_vs(jsonb_build_object('match_id', 'bt-selftest:ROOM:0001', 'biome', 'whitestacks',
           'humans', 2, 'bots', 2, 'titan', 'briarwick', 'placement', 3, 'claimed_winner', u1, 'titans_eaten', 0,
           'duration_s', 600, 'level', 27, 'peak_rank', 3, 'kills', 700, 'tonnage', 1500000));
    IF NOT coalesce((r->>'winner_confirmed')::boolean, false) OR (r->>'winner_id')::uuid IS DISTINCT FROM u1 THEN
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 8 second VS report: %', r; END IF;
    r := public.bt_report_vs(jsonb_build_object('match_id', 'bt-selftest:ROOM:0001', 'biome', 'whitestacks',
           'humans', 2, 'bots', 2, 'titan', 'briarwick', 'placement', 3, 'claimed_winner', u1,
           'duration_s', 600, 'level', 27, 'peak_rank', 3, 'kills', 700, 'tonnage', 1500000));
    IF NOT coalesce((r->>'already')::boolean, false) THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 8 VS resubmit: %', r; END IF;
    SELECT count(*) INTO n FROM public.bt_player_stats WHERE user_id = u1 AND vs_wins = 1 AND vs_matches = 1
      AND vs_titans_eaten = 2 AND vs_top2 = 1;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 8 winner stats'; END IF;
    SELECT count(*) INTO n FROM public.bt_titan_stats WHERE user_id = u1 AND titan = 'voltkite' AND vs_wins = 1;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 8 winner titan stats'; END IF;
    SELECT count(*) INTO n FROM public.bt_leaderboard('vs_wins', NULL, NULL, 'week') lb WHERE lb.user_id = u1 AND lb.value = 1;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 8 vs_wins board'; END IF;
    r := public.bt_report_vs(jsonb_build_object('match_id', 'bt-selftest:SOLO:0002', 'biome', 'lockwater',
           'humans', 1, 'bots', 3, 'titan', 'hearthback', 'placement', 1, 'claimed_winner', u2,
           'duration_s', 640, 'level', 31, 'peak_rank', 4, 'kills', 950, 'tonnage', 2100000));
    IF NOT coalesce((r->>'ok')::boolean, false) OR coalesce((r->>'winner_confirmed')::boolean, true) THEN
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 8 bots-only match: %', r; END IF;
    SELECT count(*) INTO n FROM public.bt_player_stats WHERE user_id = u2 AND vs_wins = 0 AND vs_solo_wins = 1 AND vs_matches = 2;
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 8 bots-only win must be personal only'; END IF;
    r := public.bt_report_vs(jsonb_build_object('match_id', 'bt-selftest:ROOM:0001', 'biome', 'whitestacks',
           'humans', 2, 'bots', 2, 'titan', 'molo', 'placement', 1, 'claimed_winner', u2,
           'duration_s', 600, 'level', 27, 'peak_rank', 3, 'kills', 700, 'tonnage', 1500000));
    IF NOT coalesce((r->>'already')::boolean, false) THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 8 second report by same user: %', r; END IF;
    checks := checks + 1;

    -- 9. not signed in: authenticated without sub -> not_signed_in; anon role -> no EXECUTE on the write RPCs
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    BEGIN
      PERFORM public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-nosub'));
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 9 submit without a signed-in user was accepted';
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      IF msg <> 'not_signed_in' THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 9 unexpected message %', msg; END IF;
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.bt_submit_run(base || jsonb_build_object('run_nonce', 'bt-selftest-anon'));
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 9 anon could execute bt_submit_run';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.bt_report_vs(jsonb_build_object('match_id', 'bt-selftest:ANON:0003'));
      RAISE EXCEPTION 'BT_SELFTEST_FAIL 9 anon could execute bt_report_vs';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- guests can read (public SELECT + public board RPC)
    SELECT count(*) INTO n FROM public.bt_runs WHERE user_id = u1;   -- 1 solo + 1 VS run
    IF n <> 2 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 9 anon cannot read bt_runs (% rows)', n; END IF;
    SELECT count(*) INTO n FROM public.bt_leaderboard('clear', NULL, 'grideast', 'all');
    IF n <> 1 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 9 anon cannot read the board'; END IF;
    checks := checks + 1;

    -- 10. clean up: delete the test users (cascades profiles -> every bt_* row) and the test matches
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    DELETE FROM public.bt_vs_matches WHERE match_id LIKE 'bt-selftest:%';
    DELETE FROM auth.users WHERE id IN (u1, u2);
    SELECT (SELECT count(*) FROM public.bt_runs WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.bt_player_stats WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.bt_titan_stats WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.bt_bests WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.bt_vs_results WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.bt_vs_matches WHERE match_id LIKE 'bt-selftest:%')
         + (SELECT count(*) FROM public.profiles WHERE id IN (u1, u2))
      INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'BT_SELFTEST_FAIL 10 % test rows left after cleanup', n; END IF;
    checks := checks + 1;

    -- success: unwind the subtransaction (belt and braces: nothing the test touched survives)
    RAISE EXCEPTION USING ERRCODE = 'BT000', MESSAGE = format('BT_SELFTEST_PASS %s checks', checks);
  EXCEPTION WHEN SQLSTATE 'BT000' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;

  IF msg IS NULL OR msg NOT LIKE 'BT_SELFTEST_PASS%' OR checks <> 10 THEN
    RAISE EXCEPTION 'BT_SELFTEST_FAIL did not complete (msg=%, checks=%)', msg, checks;
  END IF;
  IF (SELECT count(*) FROM public.bt_runs) <> 0 OR (SELECT count(*) FROM auth.users WHERE id IN (u1, u2)) <> 0 THEN
    RAISE EXCEPTION 'BT_SELFTEST_FAIL rows survived the rollback';
  END IF;
  v_comment := format('BLOCKTOOTH finished runs (0008_blocktooth_stats.sql). Migration self-test PASS: %s/10 checks at %s UTC.',
                      checks, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'));
  EXECUTE format('COMMENT ON TABLE public.bt_runs IS %L', v_comment);
  RAISE NOTICE '%', v_comment;
END;
$selftest$;

NOTIFY pgrst, 'reload schema';

COMMIT;

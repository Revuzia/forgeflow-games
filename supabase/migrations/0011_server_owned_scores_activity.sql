-- ForgeFlow Games -- server-owned leaderboard scores + play activity, PART A (2026-10-05)
-- Project: qkidwgyapmitrdxnavmi (accounts / registry / achievements).
-- Owner rule: "Players shouldn't write anything. They just play and the leaderboard keeps track of everything if they are
-- signed in." Part 1 (0009 + 0010) made XP / achievements server-side; this is Part 2: LEADERBOARD SCORES and PLAY ACTIVITY.
--
-- ADDITIVE ONLY: four new functions + grants. No table, policy, trigger or existing function is touched, so the OLD portal
-- client keeps working exactly as before (its leaderboard upsert has never saved anything: onConflict "user_id,game_id" has no
-- matching unique index -> 42P10; its activity upserts are never awaited and never send). Safe to apply BEFORE the client ships.
-- Part B (0012_lock_scores_activity.sql) is applied only AFTER the new client is live and one real score + one real
-- play tick have been seen to land.
--
-- WHAT IT ADDS
--   public.ff_season_week(p_at timestamptz DEFAULT now()) -> text, IMMUTABLE. Season label = ISO-8601 week of
--       ((p_at AT TIME ZONE 'UTC') - interval '7 hours'), printed 'IYYY-"W"IW' (e.g. 2026-W41). The weekly reset is therefore
--       Monday 07:00:00 UTC. Written with extract(isoyear)/extract(week) (immutable) instead of to_char() (STABLE in PG17), so the
--       IMMUTABLE label is honest; the self-test proves it equals the to_char() form over 2019-2031. The portal JS must
--       return the same strings (see season_parity.mjs) - or simply call this function.
--   public.submit_score(p_game_id bigint, p_score integer) -> jsonb. SECURITY DEFINER. uid = auth.uid() (42501 not_signed_in if
--       NULL). Soft refusals {ok:false,error:bad_args|unknown_game}: NULL game/score, score < 0, game not in public.games.
--       ONE statement: INSERT .. ON CONFLICT (user_id, game_id, season_week) DO UPDATE SET score = EXCLUDED.score WHERE
--       EXCLUDED.score > leaderboard_scores.score  (keep-highest per user+game+season; there is no read-then-write window, so a
--       concurrent twin cannot raise unique_violation or overwrite a higher score). Returns
--       {ok:true, improved:boolean, score:<current best>, season_week}.
--       .fixed (lane D, A1): after an accepted score the wrapper also makes sure the caller has a user_game_activity row for the
--       game (play_count 0 when it creates it), because played_leaderboards() lists only games the viewer has an activity row for.
--   public.ff__submit_score(p_uid, p_game_id, p_score, p_at) -> jsonb. The logic behind submit_score with an explicit user and
--       clock so the self-test can exercise other seasons. NOT executable by PUBLIC / anon / authenticated (only service_role
--       and the owner), NOT security definer: the public wrapper (definer) is the only door for players.
--   public.record_play(p_game_id bigint, p_event text) -> jsonb. SECURITY DEFINER. p_event 'start' = upsert the
--       (user, game) row: play_count + 1 on an existing row (1 on insert), last_played_at = now(). 'tick' = SERVER-computed
--       seconds: delta = floor(LEAST(GREATEST(epoch(now() - last_played_at), 0), 600)) is added to
--       user_game_activity.total_play_seconds AND profiles.total_play_time_seconds, last_played_at = now(). A tick with no row
--       yet behaves exactly like 'start'. The client never reports seconds; rapid ticks add ~0, so play time cannot exceed
--       wall-clock time. Soft refusals {ok:false,error:bad_args|unknown_game}. profiles.games_played is NOT touched.
--       Returns {ok:true, event:'start'|'tick', seconds_added, play_count, total_play_seconds}.
--
-- CLIENT CONTRACT (PostgREST named arguments):  supabase.rpc('submit_score', {p_game_id, p_score})  with p_score a finite
--   integer 0..2147483647 (Math.floor it: a fractional JSON number is a 22P02 error, not a soft refusal);
--   supabase.rpc('record_play', {p_game_id, p_event: 'start' | 'tick'}). Tick cadence must be <= 600 s: any gap longer than
--   600 s between two calls credits only 600 s. Seconds played after the LAST tick (e.g. the final 4 minutes of a 5-minute
--   ticker) are not credited - tick more often than every 5 minutes if that matters.
--
-- HOW TO APPLY (one transaction; the file carries its own BEGIN and ends with the transaction-end line, so the 0008 helper's
-- dry-run swap of that final line for the rollback form works unchanged):
--   Management API POST https://api.supabase.com/v1/projects/qkidwgyapmitrdxnavmi/database/query  {"query": <whole file>}
--   (same helper pattern as games/blocktooth/_harness/portal/apply_migration_0008.py, runs as role postgres).
--   After a real apply send a SECOND "NOTIFY pgrst, 'reload schema';" OUTSIDE the transaction and wait ~8 s
--   (0008 found the in-transaction NOTIFY reaches PostgREST late: apply_migration_0008.py:158-162).
--   Re-runnable: every statement is CREATE OR REPLACE / idempotent (the self-test simply runs again).
--
-- ROLLBACK: DROP FUNCTION public.submit_score(bigint, integer); DROP FUNCTION public.record_play(bigint, text);
--           DROP FUNCTION public.ff__submit_score(uuid, bigint, integer, timestamptz);
--           DROP FUNCTION public.ff_season_week(timestamptz);
--
-- WHAT THE SELF-TEST PROVES (in-transaction, as fake signed-in users, then rolled back by a subtransaction; any failed check
-- raises XP_SELFTEST_FAIL and aborts the WHOLE migration; success writes "self-test PASS" into the function comments):
--   season boundaries (Mon 06:59:59 vs 07:00:00 UTC, ISO week 53 / 01 across 2019/2020/2021/2026/2027) | label == to_char()
--   oracle on 5 instants x every day 2019-2031 | independent of the session TimeZone | grants (anon none) + definer + pinned
--   search_path | first save | lower / equal score never overwrites | higher overwrites | other season / game / user = separate
--   row | negative / NULL / unknown game refused softly and write nothing | not signed in = 42501 | repeated twin is idempotent |
--   play start creates (1), repeated start increments | tick adds server seconds | cap 600 and no negative / future credit |
--   tick with no row = start | profile total moves with ticks, games_played never | bad args refused | per-user isolation, missing
--   profile tolerated | nothing left behind (no row of the fake users / fixture games survives the rollback).
-- NOT provable inside one transaction: true cross-session concurrency (needs two connections; the single-statement upsert is the
-- design answer, the self-test only proves the repeated-call outcome).

BEGIN;

SET LOCAL lock_timeout = '10s';

DO $pre$
BEGIN
  IF to_regclass('public.leaderboard_scores') IS NULL OR to_regclass('public.user_game_activity') IS NULL
     OR to_regclass('public.games') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'XP_PRECHECK_FAIL: leaderboard_scores / user_game_activity / games / profiles missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'total_play_time_seconds') THEN
    RAISE EXCEPTION 'XP_PRECHECK_FAIL: profiles.total_play_time_seconds missing';
  END IF;
END
$pre$;

-- ------------------------------ 1. season label ------------------------------
-- Monday 07:00:00 UTC reset: shift back 7 hours, then take the ISO week. isoyear/week are IMMUTABLE on timestamp.
CREATE OR REPLACE FUNCTION public.ff_season_week(p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT lpad(extract(isoyear FROM t.s)::integer::text, 4, '0') || '-W' || lpad(extract(week FROM t.s)::integer::text, 2, '0')
    FROM (SELECT (p_at AT TIME ZONE 'UTC') - interval '7 hours' AS s) AS t;
$fn$;

-- ------------------------------ 2. scores ------------------------------
-- Internal: explicit user + clock. Plain (not definer) on purpose: if anyone ever grants it to a player role by mistake it
-- still runs with THEIR table privileges (none after Part B), not the owner's.
CREATE OR REPLACE FUNCTION public.ff__submit_score(p_uid uuid, p_game_id bigint, p_score integer, p_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season text := public.ff_season_week(p_at);
  v_best   integer;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF p_game_id IS NULL OR p_score IS NULL OR p_score < 0 OR v_season IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.id = p_game_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_game');
  END IF;

  -- keep-highest in ONE statement. A conflicting row with an equal or higher score is left alone and RETURNING yields nothing.
  -- created_at is moved to now() on an improvement: it reads "when the current best was set" (earlier achiever wins a tie).
  INSERT INTO public.leaderboard_scores AS ls (user_id, game_id, score, season_week)
  VALUES (p_uid, p_game_id, p_score, v_season)
  ON CONFLICT (user_id, game_id, season_week) DO UPDATE
     SET score = EXCLUDED.score, created_at = now()
   WHERE EXCLUDED.score > ls.score
  RETURNING ls.score INTO v_best;

  IF v_best IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'improved', true, 'score', v_best, 'season_week', v_season);
  END IF;

  SELECT ls.score INTO v_best
    FROM public.leaderboard_scores ls
   WHERE ls.user_id = p_uid AND ls.game_id = p_game_id AND ls.season_week = v_season;
  RETURN jsonb_build_object('ok', true, 'improved', false, 'score', v_best, 'season_week', v_season);
END;
$fn$;

-- The ONLY way for a player to put a score on the board once Part B is in. now() is the transaction start = the call time
-- (each PostgREST rpc is its own transaction), so the season cannot change between the label and the write.
CREATE OR REPLACE FUNCTION public.submit_score(p_game_id bigint, p_score integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  v_res := public.ff__submit_score(v_uid, p_game_id, p_score, now());
  IF coalesce((v_res->>'ok')::boolean, false) THEN
    -- A saved score must always be listable: played_leaderboards() only shows games the caller has an activity row for, and the
    -- row normally comes from record_play('start'). If that call never landed (outage / reordered requests), create the row here.
    -- play_count 0 on purpose: a later 'start' then counts the first Play as 1 (not 2). NOT EXISTS first so a repeat call burns
    -- no id from the activity sequence; ON CONFLICT covers the race. The helper (ff__submit_score) is untouched.
    INSERT INTO public.user_game_activity (user_id, game_id, last_played_at, total_play_seconds, play_count)
    SELECT v_uid, p_game_id, now(), 0, 0
     WHERE NOT EXISTS (SELECT 1 FROM public.user_game_activity a WHERE a.user_id = v_uid AND a.game_id = p_game_id)
    ON CONFLICT (user_id, game_id) DO NOTHING;
  END IF;
  RETURN v_res;
END;
$fn$;

-- ------------------------------ 3. play activity ------------------------------
CREATE OR REPLACE FUNCTION public.record_play(p_game_id bigint, p_event text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_event text;
  v_last  timestamptz;
  v_delta integer := 0;
  v_count integer;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF p_game_id IS NULL OR p_event IS NULL OR p_event NOT IN ('start', 'tick') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.id = p_game_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_game');
  END IF;

  v_event := p_event;
  IF v_event = 'tick' THEN
    -- row lock: two overlapping ticks serialise, and the second one re-reads the first one's last_played_at (READ COMMITTED)
    SELECT a.last_played_at INTO v_last
      FROM public.user_game_activity a
     WHERE a.user_id = v_uid AND a.game_id = p_game_id
       FOR UPDATE;
    IF FOUND THEN
      -- floor, never round: rapid ticks cannot credit more than the real elapsed time. Cap 600 s: one missed 5-minute tick is
      -- still credited, a tab left open for hours is not. A future-dated last_played_at credits 0.
      v_delta := floor(LEAST(GREATEST(extract(epoch FROM (now() - COALESCE(v_last, now()))), 0), 600))::integer;
      UPDATE public.user_game_activity a
         SET total_play_seconds = COALESCE(a.total_play_seconds, 0) + v_delta,
             last_played_at     = now()
       WHERE a.user_id = v_uid AND a.game_id = p_game_id
      RETURNING a.play_count, a.total_play_seconds INTO v_count, v_total;
      IF v_delta > 0 THEN
        -- no profile row (signup trigger swallowed an error) -> 0 rows, silently; the activity row above is still right
        UPDATE public.profiles p
           SET total_play_time_seconds = COALESCE(p.total_play_time_seconds, 0) + v_delta
         WHERE p.id = v_uid;
      END IF;
      RETURN jsonb_build_object('ok', true, 'event', 'tick', 'seconds_added', v_delta,
                                'play_count', v_count, 'total_play_seconds', v_total);
    END IF;
    v_event := 'start';                  -- tick with no row yet: exactly a start
  END IF;

  INSERT INTO public.user_game_activity AS a (user_id, game_id, last_played_at, total_play_seconds, play_count)
  VALUES (v_uid, p_game_id, now(), 0, 1)
  ON CONFLICT (user_id, game_id) DO UPDATE
     SET play_count     = COALESCE(a.play_count, 0) + 1,
         last_played_at = now()
  RETURNING a.play_count, a.total_play_seconds INTO v_count, v_total;
  RETURN jsonb_build_object('ok', true, 'event', 'start', 'seconds_added', 0,
                            'play_count', v_count, 'total_play_seconds', v_total);
END;
$fn$;

-- Supabase default privileges grant EXECUTE to PUBLIC and anon on new functions: close that (same pattern as 0008 / 0009).
REVOKE ALL ON FUNCTION public.ff__submit_score(uuid, bigint, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ff__submit_score(uuid, bigint, integer, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.submit_score(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_score(bigint, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_play(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_play(bigint, text) TO authenticated, service_role;
-- ff_season_week is a pure label (no data): everyone, signed in or not, may ask what the current season is.
GRANT EXECUTE ON FUNCTION public.ff_season_week(timestamptz) TO anon, authenticated, service_role;

-- ------------------------------ self-test (inside this transaction) ------------------------------
DO $selftest$
DECLARE
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  v_sfx    text := left(gen_random_uuid()::text, 8);
  g1 bigint;
  g2 bigint;
  rec      record;
  r        jsonb;
  x        integer;
  y        integer;
  n        bigint;
  mism     bigint;
  s1       text;
  s2       text;
  ok       boolean;
  checks   integer := 0;
  c_expected constant integer := 17;
  msg      text;
  v_comment text;
  v_tz     text := current_setting('TimeZone');
  n_games  bigint;
  t_now    timestamptz := now();
BEGIN
  SELECT count(*) INTO n_games FROM public.games;     -- only to decide whether fixture games are needed

  BEGIN   -- subtransaction: everything below is rolled back at the end (on top of the explicit deletes)

    -- 1. season label: explicit boundary vectors. Expected strings were derived independently (Python isocalendar + a hand-rolled
    --    JS version, see season_parity.py / season_parity.mjs), NOT with the SQL formula.
    FOR rec IN SELECT * FROM (VALUES
        ('2026-10-05 06:59:59+00', '2026-W40'),   -- Monday 06:59:59 UTC is still LAST week
        ('2026-10-05 07:00:00+00', '2026-W41'),   -- Monday 07:00:00 UTC is the reset
        ('2026-10-05 08:00:00+01', '2026-W41'),   -- same instant as 07:00:00 UTC written with an offset
        ('2026-10-05 02:00:00-05', '2026-W41'),   -- and again
        ('2026-10-04 23:59:59+00', '2026-W40'),
        ('2026-10-12 06:59:59+00', '2026-W41'),
        ('2026-10-12 07:00:00+00', '2026-W42'),
        ('2026-01-01 00:00:00+00', '2026-W01'),   -- Thu 1 Jan 2026 belongs to ISO week 1 of 2026
        ('2025-12-31 23:59:59+00', '2026-W01'),
        ('2025-12-29 06:59:59+00', '2025-W52'),
        ('2025-12-29 07:00:00+00', '2026-W01'),
        ('2020-12-31 12:00:00+00', '2020-W53'),   -- 2020 has 53 ISO weeks
        ('2021-01-03 23:59:59+00', '2020-W53'),
        ('2021-01-04 06:59:59+00', '2020-W53'),
        ('2021-01-04 07:00:00+00', '2021-W01'),
        ('2027-01-03 12:00:00+00', '2026-W53'),   -- 2026 has 53 ISO weeks
        ('2027-01-04 06:59:59+00', '2026-W53'),
        ('2027-01-04 07:00:00+00', '2027-W01'),
        ('2019-12-30 06:59:59+00', '2019-W52'),
        ('2019-12-30 07:00:00+00', '2020-W01'),
        ('2024-12-30 06:59:59+00', '2024-W52'),
        ('2024-12-30 07:00:00+00', '2025-W01'),
        ('2026-05-06 18:06:15+00', '2026-W19')    -- the one legacy score row's instant (its stored label 2026-W02 is the old day-of-month string)
      ) AS t(ts, want)
    LOOP
      IF public.ff_season_week(rec.ts::timestamptz) IS DISTINCT FROM rec.want THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 1 ff_season_week(%) = %, expected %',
          rec.ts, public.ff_season_week(rec.ts::timestamptz), rec.want;
      END IF;
    END LOOP;
    IF public.ff_season_week(NULL) IS NOT NULL OR public.ff_season_week() IS DISTINCT FROM public.ff_season_week(now()) THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 1 NULL input or the now() default misbehaves';
    END IF;
    checks := checks + 1;

    -- 2. label == the to_char() oracle on 5 instants per day for every day 2019-01-01 .. 2031-12-31 (covers every Monday
    --    06:59:59 / 07:00:00 and every ISO-year change), and independent of the session TimeZone
    SELECT count(*),
           count(*) FILTER (WHERE public.ff_season_week(s.t) IS DISTINCT FROM
                                  to_char((s.t AT TIME ZONE 'UTC') - interval '7 hours', 'IYYY-"W"IW'))
      INTO n, mism
      FROM (SELECT (d.day + o.off) AT TIME ZONE 'UTC' AS t
              FROM generate_series('2019-01-01 00:00:00'::timestamp, '2031-12-31 00:00:00'::timestamp, interval '1 day') AS d(day)
             CROSS JOIN (VALUES (interval '0 seconds'), (interval '06:59:59'), (interval '07:00:00'),
                                (interval '12:00:00'), (interval '23:59:59')) AS o(off)) AS s;
    IF n < 23000 OR mism IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 sweep: % instants, % mismatches against to_char() (expected >= 23000 / 0)', n, mism;
    END IF;
    FOREACH s1 IN ARRAY ARRAY['Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata'] LOOP
      PERFORM set_config('TimeZone', s1, true);
      IF current_setting('TimeZone') IS DISTINCT FROM s1
         OR public.ff_season_week('2026-10-05 06:59:59+00') IS DISTINCT FROM '2026-W40'
         OR public.ff_season_week('2026-10-05 07:00:00+00') IS DISTINCT FROM '2026-W41'
         OR public.ff_season_week('2021-01-04 06:59:59+00') IS DISTINCT FROM '2020-W53'
         OR public.ff_season_week('2027-01-04 07:00:00+00') IS DISTINCT FROM '2027-W01' THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 label depends on the session TimeZone (%)', s1;
      END IF;
    END LOOP;
    PERFORM set_config('TimeZone', v_tz, true);
    checks := checks + 1;

    -- 3. grants / hardening: anon (and therefore PUBLIC) cannot execute the writers; the helper is closed to every player role;
    --    definer + pinned search_path where promised; the label is immutable
    FOR rec IN SELECT * FROM (VALUES
        ('public.submit_score(bigint,integer)',                       false, true,  true),
        ('public.record_play(bigint,text)',                           false, true,  true),
        ('public.ff__submit_score(uuid,bigint,integer,timestamptz)',  false, false, true),
        ('public.ff_season_week(timestamptz)',                        true,  true,  true)
      ) AS t(sig, want_anon, want_auth, want_svc)
    LOOP
      IF has_function_privilege('anon', rec.sig, 'EXECUTE')          IS DISTINCT FROM rec.want_anon
         OR has_function_privilege('authenticated', rec.sig, 'EXECUTE') IS DISTINCT FROM rec.want_auth
         OR has_function_privilege('service_role', rec.sig, 'EXECUTE')  IS DISTINCT FROM rec.want_svc THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 3 execute grants wrong for % (anon=% authenticated=% service_role=%)', rec.sig,
          has_function_privilege('anon', rec.sig, 'EXECUTE'), has_function_privilege('authenticated', rec.sig, 'EXECUTE'),
          has_function_privilege('service_role', rec.sig, 'EXECUTE');
      END IF;
    END LOOP;
    FOR rec IN SELECT * FROM (VALUES
        ('public.submit_score(bigint,integer)',                       true),
        ('public.record_play(bigint,text)',                           true),
        ('public.ff__submit_score(uuid,bigint,integer,timestamptz)',  false),
        ('public.ff_season_week(timestamptz)',                        false)
      ) AS t(sig, want_definer)
    LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure(rec.sig)
                        AND p.prosecdef = rec.want_definer
                        AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg(setting)
                                     WHERE cfg.setting LIKE 'search_path=%')) THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 3 % is not (security definer = %) with a pinned search_path', rec.sig, rec.want_definer;
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.ff_season_week(timestamptz)'::regprocedure AND p.provolatile = 'i') THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 3 ff_season_week is not IMMUTABLE';
    END IF;
    checks := checks + 1;

    -- fixtures (as postgres): two existing games (a fixture pair only if the catalogue is nearly empty), two fake users.
    IF n_games < 2 THEN
      INSERT INTO public.games (slug, title, genre) VALUES
        ('ff-selftest-a-' || v_sfx, 'FF selftest A', 'test'), ('ff-selftest-b-' || v_sfx, 'FF selftest B', 'test');
    END IF;
    SELECT g.id INTO g1 FROM public.games g ORDER BY g.id LIMIT 1;
    SELECT g.id INTO g2 FROM public.games g ORDER BY g.id LIMIT 1 OFFSET 1;
    IF g1 IS NULL OR g2 IS NULL OR g1 = g2 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: need two distinct games'; END IF;

    INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
      (u1, 'authenticated', 'authenticated', 'ff-selftest-' || u1 || '@invalid.test',
       jsonb_build_object('username', 'ff_selftest_' || left(u1::text, 8)), now(), now()),
      (u2, 'authenticated', 'authenticated', 'ff-selftest-' || u2 || '@invalid.test',
       jsonb_build_object('username', 'ff_selftest_' || left(u2::text, 8)), now(), now());
    INSERT INTO public.profiles (id, username) VALUES
      (u1, 'ff_selftest_' || left(u1::text, 8)), (u2, 'ff_selftest_' || left(u2::text, 8))
    ON CONFLICT (id) DO NOTHING;
    SELECT count(*) INTO n FROM public.profiles p
     WHERE p.id IN (u1, u2) AND p.xp = 0 AND p.level = 1 AND p.games_played = 0 AND p.total_play_time_seconds = 0;
    IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: expected 2 fresh profiles, got %', n; END IF;

    -- -- act as u1, signed in --
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- 4. first save: one row, this week's label, the score
    r := public.submit_score(g1, 100);
    SELECT count(*), min(l.score), min(l.season_week) INTO n, x, s1
      FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.game_id = g1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR NOT coalesce((r->>'improved')::boolean, false)
       OR (r->>'score')::integer IS DISTINCT FROM 100 OR r->>'season_week' IS DISTINCT FROM public.ff_season_week(t_now)
       OR n IS DISTINCT FROM 1 OR x IS DISTINCT FROM 100 OR s1 IS DISTINCT FROM public.ff_season_week(t_now) THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 4 first save: % rows=% score=% season=%', r, n, x, s1;
    END IF;
    -- .fixed (A1): the accepted score also created the (u1, g1) activity row, with play_count 0 and 0 seconds
    SELECT count(*), min(a.play_count), min(a.total_play_seconds) INTO n, x, y
      FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    IF n IS DISTINCT FROM 1 OR x IS DISTINCT FROM 0 OR y IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 4 activity row after the first accepted score: rows=% play_count=% seconds=% (want 1 / 0 / 0)', n, x, y;
    END IF;
    checks := checks + 1;

    -- 5. a lower score and an equal score never overwrite; the answer still reports the standing best
    r := public.submit_score(g1, 50);
    SELECT l.score INTO x FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.game_id = g1 AND l.season_week = s1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR coalesce((r->>'improved')::boolean, true)
       OR (r->>'score')::integer IS DISTINCT FROM 100 OR x IS DISTINCT FROM 100 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 5a lower score: % stored=%', r, x;
    END IF;
    r := public.submit_score(g1, 100);
    SELECT l.score, (SELECT count(*) FROM public.leaderboard_scores l2 WHERE l2.user_id = u1 AND l2.game_id = g1)
      INTO x, n FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.game_id = g1 AND l.season_week = s1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR coalesce((r->>'improved')::boolean, true)
       OR (r->>'score')::integer IS DISTINCT FROM 100 OR x IS DISTINCT FROM 100 OR n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 5b equal score: % stored=% rows=%', r, x, n;
    END IF;
    checks := checks + 1;

    -- 6. a higher score overwrites (still one row for the season)
    r := public.submit_score(g1, 150);
    SELECT l.score, (SELECT count(*) FROM public.leaderboard_scores l2 WHERE l2.user_id = u1 AND l2.game_id = g1)
      INTO x, n FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.game_id = g1 AND l.season_week = s1;
    IF NOT coalesce((r->>'improved')::boolean, false) OR (r->>'score')::integer IS DISTINCT FROM 150 OR x IS DISTINCT FROM 150 OR n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 6 higher score: % stored=% rows=%', r, x, n;
    END IF;
    checks := checks + 1;

    -- 7. other seasons / games / users are SEPARATE rows (the helper takes the clock; run as the owner, then drop back)
    EXECUTE 'RESET ROLE';
    r := public.ff__submit_score(u1, g1, 70, t_now - interval '7 days');            -- last week
    s2 := r->>'season_week';
    IF NOT coalesce((r->>'improved')::boolean, false) OR s2 IS DISTINCT FROM public.ff_season_week(t_now - interval '7 days')
       OR s2 = s1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 7a last-week row: % (this week is %)', r, s1;
    END IF;
    r := public.ff__submit_score(u1, g1, 60, t_now - interval '7 days');            -- lower in last week: untouched
    IF coalesce((r->>'improved')::boolean, true) OR (r->>'score')::integer IS DISTINCT FROM 70 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 7b lower score in last week overwrote or mis-reported: %', r;
    END IF;
    r := public.ff__submit_score(u1, g1, 999, t_now + interval '7 days');          -- next week
    IF NOT coalesce((r->>'improved')::boolean, false) THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 7c next-week row: %', r; END IF;
    r := public.ff__submit_score(u1, g2, 5, t_now);                                 -- other game, this week
    IF NOT coalesce((r->>'improved')::boolean, false) THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 7d other game: %', r; END IF;
    r := public.ff__submit_score(u2, g1, 10, t_now);                                -- other user, same game + week
    IF NOT coalesce((r->>'improved')::boolean, false) OR (r->>'score')::integer IS DISTINCT FROM 10 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 7e other user: %', r;
    END IF;
    SELECT count(*) INTO n FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.game_id = g1;
    SELECT l.score INTO x FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.game_id = g1 AND l.season_week = s1;
    SELECT l.score INTO y FROM public.leaderboard_scores l WHERE l.user_id = u2 AND l.game_id = g1 AND l.season_week = s1;
    IF n IS DISTINCT FROM 3 OR x IS DISTINCT FROM 150 OR y IS DISTINCT FROM 10 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 7 separation: u1/g1 rows=% (want 3), u1 this week=% (want 150), u2 this week=% (want 10)', n, x, y;
    END IF;
    checks := checks + 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- 8. bad arguments: soft refusal, nothing written. A zero score is a legal first save.
    SELECT count(*) INTO n FROM public.leaderboard_scores l WHERE l.user_id = u1;
    IF coalesce((public.submit_score(g1, -1)->>'ok')::boolean, true)
       OR coalesce((public.submit_score(g1, NULL)->>'ok')::boolean, true)
       OR coalesce((public.submit_score(NULL, 5)->>'ok')::boolean, true)
       OR public.submit_score(g1, -1)->>'error' IS DISTINCT FROM 'bad_args' THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 8 bad score args were not refused softly';
    END IF;
    SELECT count(*) INTO y FROM public.leaderboard_scores l WHERE l.user_id = u1;
    SELECT l.score INTO x FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.game_id = g1 AND l.season_week = s1;
    IF y IS DISTINCT FROM n OR x IS DISTINCT FROM 150 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 8 a refused call wrote: rows % -> %, score %', n, y, x; END IF;
    -- a zero score is a legal first save: u2 has no g2 row yet, so (u2, g2, 0) must be stored and reported as improved
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u2::text, true);
    r := public.submit_score(g2, 0);
    SELECT l.score INTO x FROM public.leaderboard_scores l WHERE l.user_id = u2 AND l.game_id = g2 AND l.season_week = s1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR NOT coalesce((r->>'improved')::boolean, false) OR x IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 8 zero score first save: % stored=%', r, x;
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    checks := checks + 1;

    -- 9. unknown game (incl. an id beyond int4, which must be a refusal and not a numeric-overflow error): refused, nothing written
    SELECT count(*) INTO n FROM public.leaderboard_scores l WHERE l.user_id = u1;
    SELECT count(*) INTO x FROM public.user_game_activity a WHERE a.user_id = u1;       -- .fixed (A1): a refusal creates no activity row either
    r := public.submit_score(-1, 10);
    IF coalesce((r->>'ok')::boolean, true) OR r->>'error' IS DISTINCT FROM 'unknown_game'
       OR public.submit_score(9999999999, 10)->>'error' IS DISTINCT FROM 'unknown_game' THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 9 unknown game was not refused: %', r;
    END IF;
    SELECT count(*) INTO y FROM public.leaderboard_scores l WHERE l.user_id = u1;
    IF y IS DISTINCT FROM n THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 9 unknown game wrote a row (% -> %)', n, y; END IF;
    SELECT count(*) INTO y FROM public.user_game_activity a WHERE a.user_id = u1;
    IF y IS DISTINCT FROM x THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 9 unknown game created an activity row (% -> %)', x, y; END IF;
    checks := checks + 1;

    -- 10. not signed in: authenticated role without a sub = 42501 not_signed_in for both writers; the helper cannot be called
    --     by a player role; anon cannot execute either writer (permission denied, also 42501)
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    ok := false;
    BEGIN
      r := public.submit_score(g1, 5);
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      ok := (msg = 'not_signed_in');
    END;
    IF NOT ok THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 10a unsigned submit_score was not refused with not_signed_in: %', r; END IF;
    ok := false;
    BEGIN
      r := public.record_play(g1, 'start');
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      ok := (msg = 'not_signed_in');
    END;
    IF NOT ok THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 10b unsigned record_play was not refused with not_signed_in: %', r; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    ok := false;
    BEGIN
      r := public.ff__submit_score(u2, g1, 999999, now());      -- impersonation attempt through the helper
    EXCEPTION WHEN insufficient_privilege THEN
      ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 10c a player role could call the internal helper: %', r; END IF;
    EXECUTE 'RESET ROLE';
    EXECUTE 'SET LOCAL ROLE anon';
    ok := false;
    BEGIN
      r := public.submit_score(g1, 5);
    EXCEPTION WHEN insufficient_privilege THEN
      ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 10d anon could execute submit_score: %', r; END IF;
    ok := false;
    BEGIN
      r := public.record_play(g1, 'start');
    EXCEPTION WHEN insufficient_privilege THEN
      ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 10e anon could execute record_play: %', r; END IF;
    EXECUTE 'RESET ROLE';
    EXECUTE 'SET LOCAL ROLE authenticated';
    checks := checks + 1;

    -- 11. a repeated identical call (what a retried / twin request looks like once the unique index has resolved it) is
    --     idempotent: no error, no second row, the standing best is reported
    r := public.submit_score(g1, 150);
    SELECT count(*) INTO n FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.game_id = g1 AND l.season_week = s1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR coalesce((r->>'improved')::boolean, true)
       OR (r->>'score')::integer IS DISTINCT FROM 150 OR n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 11 repeated call: % rows=%', r, n;
    END IF;
    checks := checks + 1;

    -- 12. record_play 'start': the first Play is counted as 1 whether the row is new or was created at 0 by the score in check 4
    --     (.fixed A1); a repeated start increments; neither touches the profile counters
    r := public.record_play(g1, 'start');
    SELECT a.play_count, a.total_play_seconds INTO x, y FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR r->>'event' IS DISTINCT FROM 'start'
       OR (r->>'play_count')::integer IS DISTINCT FROM 1 OR x IS DISTINCT FROM 1 OR y IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 12a first start: % play_count=% seconds=%', r, x, y;
    END IF;
    r := public.record_play(g1, 'start');
    SELECT a.play_count, a.total_play_seconds INTO x, y FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    SELECT count(*) INTO n FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    IF (r->>'play_count')::integer IS DISTINCT FROM 2 OR x IS DISTINCT FROM 2 OR y IS DISTINCT FROM 0 OR n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 12b repeated start: % play_count=% seconds=% rows=%', r, x, y, n;
    END IF;
    SELECT p.total_play_time_seconds, p.games_played INTO x, y FROM public.profiles p WHERE p.id = u1;
    IF x IS DISTINCT FROM 0 OR y IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 12c start touched the profile counters (time=% games=%)', x, y; END IF;
    checks := checks + 1;

    -- 13. tick: server-computed seconds. Back-date last_played_at as the owner (now() is constant inside this transaction, so the
    --     delta is exactly the back-dating), then tick as the player.
    EXECUTE 'RESET ROLE';
    UPDATE public.user_game_activity a SET last_played_at = now() - interval '120 seconds' WHERE a.user_id = u1 AND a.game_id = g1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.record_play(g1, 'tick');
    SELECT a.total_play_seconds, a.play_count, (a.last_played_at = now()) INTO x, y, ok
      FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    SELECT p.total_play_time_seconds INTO n FROM public.profiles p WHERE p.id = u1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR r->>'event' IS DISTINCT FROM 'tick'
       OR (r->>'seconds_added')::integer IS DISTINCT FROM 120 OR (r->>'total_play_seconds')::integer IS DISTINCT FROM 120
       OR x IS DISTINCT FROM 120 OR y IS DISTINCT FROM 2 OR NOT coalesce(ok, false) OR n IS DISTINCT FROM 120 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 13a tick: % activity_seconds=% play_count=% last_played_now=% profile_total=%', r, x, y, ok, n;
    END IF;
    r := public.record_play(g1, 'tick');       -- immediately again: nothing elapsed, nothing credited (cannot be inflated)
    SELECT a.total_play_seconds INTO x FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    SELECT p.total_play_time_seconds INTO n FROM public.profiles p WHERE p.id = u1;
    IF (r->>'seconds_added')::integer IS DISTINCT FROM 0 OR x IS DISTINCT FROM 120 OR n IS DISTINCT FROM 120 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 13b rapid second tick credited time: % activity=% profile=%', r, x, n;
    END IF;
    checks := checks + 1;

    -- 14. cap 600 per tick; a start after a long gap credits nothing; a future-dated last_played_at credits nothing
    EXECUTE 'RESET ROLE';
    UPDATE public.user_game_activity a SET last_played_at = now() - interval '5000 seconds' WHERE a.user_id = u1 AND a.game_id = g1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.record_play(g1, 'tick');
    SELECT a.total_play_seconds INTO x FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    SELECT p.total_play_time_seconds INTO n FROM public.profiles p WHERE p.id = u1;
    IF (r->>'seconds_added')::integer IS DISTINCT FROM 600 OR x IS DISTINCT FROM 720 OR n IS DISTINCT FROM 720 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 14a cap: % activity=% profile=% (expected 600 / 720 / 720)', r, x, n;
    END IF;
    EXECUTE 'RESET ROLE';
    UPDATE public.user_game_activity a SET last_played_at = now() + interval '1 hour' WHERE a.user_id = u1 AND a.game_id = g1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.record_play(g1, 'tick');
    SELECT a.total_play_seconds INTO x FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    SELECT p.total_play_time_seconds INTO n FROM public.profiles p WHERE p.id = u1;
    IF (r->>'seconds_added')::integer IS DISTINCT FROM 0 OR x IS DISTINCT FROM 720 OR n IS DISTINCT FROM 720 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 14b future-dated last_played_at credited time: % activity=% profile=%', r, x, n;
    END IF;
    EXECUTE 'RESET ROLE';
    UPDATE public.user_game_activity a SET last_played_at = now() - interval '5000 seconds' WHERE a.user_id = u1 AND a.game_id = g1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.record_play(g1, 'start');
    SELECT a.total_play_seconds, a.play_count INTO x, y FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    SELECT p.total_play_time_seconds INTO n FROM public.profiles p WHERE p.id = u1;
    IF (r->>'seconds_added')::integer IS DISTINCT FROM 0 OR x IS DISTINCT FROM 720 OR n IS DISTINCT FROM 720 OR y IS DISTINCT FROM 3 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 14c start after a long gap: % activity=% play_count=% profile=%', r, x, y, n;
    END IF;
    checks := checks + 1;

    -- 15. tick with no row yet behaves exactly like start (g2 has no activity row for u1); the profile total does not move
    SELECT count(*) INTO n FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g2;
    IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: u1 already has a g2 activity row'; END IF;
    r := public.record_play(g2, 'tick');
    SELECT a.play_count, a.total_play_seconds INTO x, y FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g2;
    SELECT p.total_play_time_seconds INTO n FROM public.profiles p WHERE p.id = u1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR r->>'event' IS DISTINCT FROM 'start'
       OR (r->>'seconds_added')::integer IS DISTINCT FROM 0 OR x IS DISTINCT FROM 1 OR y IS DISTINCT FROM 0 OR n IS DISTINCT FROM 720 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 15 tick without a row: % play_count=% seconds=% profile=%', r, x, y, n;
    END IF;
    checks := checks + 1;

    -- 16. bad arguments / unknown game / unknown event: soft refusal and no row
    SELECT count(*) INTO n FROM public.user_game_activity a WHERE a.user_id = u1;
    IF coalesce((public.record_play(g1, 'stop')->>'ok')::boolean, true)
       OR coalesce((public.record_play(g1, NULL)->>'ok')::boolean, true)
       OR coalesce((public.record_play(NULL, 'start')->>'ok')::boolean, true)
       OR public.record_play(g1, 'TICK')->>'error' IS DISTINCT FROM 'bad_args'
       OR public.record_play(-1, 'start')->>'error' IS DISTINCT FROM 'unknown_game'
       OR public.record_play(9999999999, 'tick')->>'error' IS DISTINCT FROM 'unknown_game' THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 16 bad record_play args were not refused softly';
    END IF;
    SELECT count(*) INTO y FROM public.user_game_activity a WHERE a.user_id = u1;
    IF y IS DISTINCT FROM n THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 16 a refused record_play wrote a row (% -> %)', n, y; END IF;
    checks := checks + 1;

    -- 17. per-user isolation, a missing profile row is tolerated, and games_played is never touched
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u2::text, true);
    r := public.record_play(g1, 'start');
    IF (r->>'play_count')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 17a u2 first start: %', r; END IF;
    SELECT a.play_count INTO x FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    IF x IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 17b u2 changed u1 activity (play_count %)', x; END IF;
    EXECUTE 'RESET ROLE';
    DELETE FROM public.profiles p WHERE p.id = u2;                                   -- u2: signed in, NO profile row
    UPDATE public.user_game_activity a SET last_played_at = now() - interval '60 seconds' WHERE a.user_id = u2 AND a.game_id = g1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u2::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.record_play(g1, 'tick');
    SELECT a.total_play_seconds INTO x FROM public.user_game_activity a WHERE a.user_id = u2 AND a.game_id = g1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR (r->>'seconds_added')::integer IS DISTINCT FROM 60 OR x IS DISTINCT FROM 60 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 17c tick without a profile row: % activity=%', r, x;
    END IF;
    SELECT p.games_played INTO x FROM public.profiles p WHERE p.id = u1;
    IF x IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 17d games_played moved to % (record_play must not touch it)', x; END IF;
    checks := checks + 1;

    -- cleanup: delete the fake users (cascades profiles, scores, activity), then any fixture games (FKs from the three tables
    -- to games have no cascade, so the users go first), then count that nothing is left
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    DELETE FROM auth.users WHERE id IN (u1, u2);
    DELETE FROM public.games WHERE slug IN ('ff-selftest-a-' || v_sfx, 'ff-selftest-b-' || v_sfx);
    SELECT (SELECT count(*) FROM auth.users WHERE id IN (u1, u2))
         + (SELECT count(*) FROM public.profiles WHERE id IN (u1, u2))
         + (SELECT count(*) FROM public.leaderboard_scores WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.user_game_activity WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.games WHERE slug LIKE 'ff-selftest-%-' || v_sfx)
      INTO n;
    IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL cleanup: % test rows left', n; END IF;

    -- success: unwind the subtransaction (belt and braces: nothing the test touched survives)
    RAISE EXCEPTION USING ERRCODE = 'XP000', MESSAGE = format('XP_SELFTEST_PASS %s checks', checks);
  EXCEPTION WHEN SQLSTATE 'XP000' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF msg IS NULL OR msg NOT LIKE 'XP_SELFTEST_PASS%' OR checks IS DISTINCT FROM c_expected THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL did not complete (msg=%, checks=%, expected %)', msg, checks, c_expected;
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (u1, u2)) IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.leaderboard_scores WHERE user_id IN (u1, u2)) IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.user_game_activity WHERE user_id IN (u1, u2)) IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.games WHERE slug LIKE 'ff-selftest-%-' || v_sfx) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL rows survived the rollback';
  END IF;

  v_comment := format('Server-owned leaderboard score + play activity (0011_server_owned_scores_activity.sql). Migration self-test PASS: %s/%s checks at %s UTC.',
                      checks, c_expected, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'));
  EXECUTE format('COMMENT ON FUNCTION public.submit_score(bigint, integer) IS %L', v_comment);
  EXECUTE format('COMMENT ON FUNCTION public.record_play(bigint, text) IS %L', v_comment);
  EXECUTE format('COMMENT ON FUNCTION public.ff__submit_score(uuid, bigint, integer, timestamptz) IS %L',
                 'Internal helper behind submit_score (explicit user + clock). Not executable by player roles. ' || v_comment);
  EXECUTE format('COMMENT ON FUNCTION public.ff_season_week(timestamptz) IS %L',
                 'Season label: ISO-8601 week of (UTC - 7h), weekly reset Monday 07:00 UTC. ' || v_comment);
  RAISE NOTICE '%', v_comment;
END;
$selftest$;

NOTIFY pgrst, 'reload schema';

COMMIT;

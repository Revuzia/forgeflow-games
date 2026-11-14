-- ForgeFlow Games -- BlockTooth play time was going to be counted twice in the profile total (2026-10-06)
-- Project: qkidwgyapmitrdxnavmi.
--
-- WHY: profiles.total_play_time_seconds had TWO writers for BlockTooth:
--   * bt__file_run (0008) adds each filed run's on-air seconds (d_dur): BlockTooth's documented contract
--     (games/blocktooth/_spec/online/platform.md:364; its migration self-test asserts 1200 / 1500 s);
--   * record_play (0011) adds server-clock wall-clock seconds on every 'tick' for EVERY game, BlockTooth included.
-- A BlockTooth player would therefore have the same minutes added twice (run time + wall clock).
--
-- FIX (smallest, leaves BlockTooth's own contract and function untouched): record_play still keeps the per-game row in
-- user_game_activity for BlockTooth (play_count / total_play_seconds / last_played_at, which the leaderboards page needs), but it no
-- longer ALSO adds those seconds to profiles.total_play_time_seconds when the game is 'blocktooth'. For BlockTooth the profile total
-- therefore stays "on-air seconds of filed runs" (bt__file_run); for every other game it is the server-clock total (record_play).
--
-- Only record_play is replaced (CREATE OR REPLACE keeps its owner and grants; they are re-asserted below). The one new condition is the
-- NOT EXISTS (... slug = 'blocktooth') guard around the profile UPDATE. Everything else is the 0011 function unchanged.
--
-- APPLY: Management API / dry-run helper exactly like 0009-0012 (the file ends with COMMIT;). NOTIFY not needed (same signature).
-- ROLLBACK: re-run the record_play definition from 0011_server_owned_scores_activity.sql.
--
-- SELF-TEST (in-transaction, fake signed-in user, rolled back by a subtransaction; failure raises XP_SELFTEST_FAIL and aborts
-- the WHOLE migration; success writes "self-test PASS" into the function comment):
--   grants + definer + pinned search_path unchanged | BlockTooth tick: activity seconds credited, profile total NOT |
--   another game's tick: activity AND profile credited | a second BlockTooth tick still leaves the profile alone | nothing left behind.

BEGIN;

SET LOCAL lock_timeout = '10s';

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
      -- BlockTooth already adds its filed runs' on-air seconds to the profile total (bt__file_run, 0008): skip it here (0013).
      IF v_delta > 0
         AND NOT EXISTS (SELECT 1 FROM public.games g WHERE g.id = p_game_id AND g.slug = 'blocktooth') THEN
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

-- CREATE OR REPLACE keeps the grants; re-assert them anyway (same lines as 0011).
REVOKE ALL ON FUNCTION public.record_play(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_play(bigint, text) TO authenticated, service_role;

-- ------------------------------ self-test (inside this transaction) ------------------------------
DO $selftest$
DECLARE
  u1 uuid := gen_random_uuid();
  g_bt    bigint;
  g_other bigint;
  r       jsonb;
  x       integer;
  y       integer;
  n       bigint;
  checks  integer := 0;
  msg     text;
  v_comment text;
BEGIN
  BEGIN   -- subtransaction: everything below is rolled back at the end (on top of the explicit deletes)

    -- 1. grants / hardening unchanged: anon cannot execute; signed-in + service can; definer with a pinned search_path
    IF has_function_privilege('anon', 'public.record_play(bigint,text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.record_play(bigint,text)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.record_play(bigint,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 1 execute grants wrong';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = 'public.record_play(bigint,text)'::regprocedure AND p.prosecdef
                      AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg(setting) WHERE cfg.setting LIKE 'search_path=%')) THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 1 record_play is not SECURITY DEFINER with a pinned search_path';
    END IF;
    checks := checks + 1;

    -- fixtures: the real BlockTooth game row, any other game, one fake user (the signup trigger makes its profile)
    SELECT g.id INTO g_bt FROM public.games g WHERE g.slug = 'blocktooth';
    SELECT g.id INTO g_other FROM public.games g WHERE g.slug <> 'blocktooth' ORDER BY g.id LIMIT 1;
    IF g_bt IS NULL OR g_other IS NULL THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: need the blocktooth game row and one other game (bt=% other=%)', g_bt, g_other; END IF;
    INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    VALUES (u1, 'authenticated', 'authenticated', 'xp-selftest-' || u1 || '@invalid.test',
            jsonb_build_object('username', 'xp_selftest_' || left(u1::text, 8)), now(), now());
    INSERT INTO public.profiles (id, username) VALUES (u1, 'xp_selftest_' || left(u1::text, 8)) ON CONFLICT (id) DO NOTHING;
    SELECT count(*) INTO n FROM public.profiles p WHERE p.id = u1 AND p.total_play_time_seconds = 0 AND p.games_played = 0;
    IF n <> 1 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: expected one fresh profile, got %', n; END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- 2. BlockTooth: 'start', then pretend 120 s passed, then 'tick' -> the per-game activity row is credited, the profile total is NOT
    r := public.record_play(g_bt, 'start');
    IF NOT coalesce((r->>'ok')::boolean, false) THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 2a blocktooth start: %', r; END IF;
    EXECUTE 'RESET ROLE';
    UPDATE public.user_game_activity a SET last_played_at = now() - interval '120 seconds' WHERE a.user_id = u1 AND a.game_id = g_bt;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.record_play(g_bt, 'tick');
    SELECT a.total_play_seconds INTO x FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g_bt;
    SELECT p.total_play_time_seconds INTO y FROM public.profiles p WHERE p.id = u1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR (r->>'seconds_added')::integer NOT BETWEEN 119 AND 121 OR x NOT BETWEEN 119 AND 121 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 2b blocktooth tick did not credit the activity row: % activity_seconds=%', r, x;
    END IF;
    IF y IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 2c blocktooth tick ALSO credited the profile total (% s): that is the double count', y;
    END IF;
    checks := checks + 1;

    -- 3. any other game: the same pattern credits BOTH the activity row and the profile total
    r := public.record_play(g_other, 'start');
    EXECUTE 'RESET ROLE';
    UPDATE public.user_game_activity a SET last_played_at = now() - interval '120 seconds' WHERE a.user_id = u1 AND a.game_id = g_other;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.record_play(g_other, 'tick');
    SELECT a.total_play_seconds INTO x FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g_other;
    SELECT p.total_play_time_seconds INTO y FROM public.profiles p WHERE p.id = u1;
    IF (r->>'seconds_added')::integer NOT BETWEEN 119 AND 121 OR x NOT BETWEEN 119 AND 121 OR y NOT BETWEEN 119 AND 121 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 3 other-game tick: % activity_seconds=% profile_total=% (want about 120 / 120 / 120)', r, x, y;
    END IF;
    checks := checks + 1;

    -- 4. a BlockTooth tick after that still leaves the profile total at the other game's seconds only
    EXECUTE 'RESET ROLE';
    UPDATE public.user_game_activity a SET last_played_at = now() - interval '60 seconds' WHERE a.user_id = u1 AND a.game_id = g_bt;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.record_play(g_bt, 'tick');
    SELECT p.total_play_time_seconds INTO n FROM public.profiles p WHERE p.id = u1;
    IF n IS DISTINCT FROM y THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 4 a second blocktooth tick moved the profile total (% -> %)', y, n; END IF;
    checks := checks + 1;

    -- 5. clean up: the fake user (cascades profile + activity rows)
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    DELETE FROM auth.users WHERE id = u1;
    SELECT (SELECT count(*) FROM auth.users WHERE id = u1) + (SELECT count(*) FROM public.profiles WHERE id = u1)
         + (SELECT count(*) FROM public.user_game_activity WHERE user_id = u1) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 5 % test rows left after cleanup', n; END IF;
    checks := checks + 1;

    RAISE EXCEPTION USING ERRCODE = 'XP000', MESSAGE = format('XP_SELFTEST_PASS %s checks', checks);
  EXCEPTION WHEN SQLSTATE 'XP000' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF msg IS NULL OR msg NOT LIKE 'XP_SELFTEST_PASS%' OR checks <> 5 THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL did not complete (msg=%, checks=%, expected 5)', msg, checks;
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id = u1) <> 0 THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL the fake user survived the rollback';
  END IF;

  v_comment := format('Server-owned play activity (0011 + 0013: BlockTooth ticks do not add to the profile total, bt__file_run does). Migration self-test PASS: %s/5 checks at %s UTC.',
                      checks, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'));
  EXECUTE format('COMMENT ON FUNCTION public.record_play(bigint, text) IS %L', v_comment);
  RAISE NOTICE '%', v_comment;
END;
$selftest$;

COMMIT;

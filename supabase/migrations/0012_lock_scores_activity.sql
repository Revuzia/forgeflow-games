-- ForgeFlow Games -- lock leaderboard scores, play activity and the profile play counters to the server, PART B (2026-10-05)
-- Project: qkidwgyapmitrdxnavmi. Companion of 0011_server_owned_scores_activity.sql (Part A). Builds on 0010_lock_profile_xp.sql.
--
-- APPLY ONLY AFTER (1) 0011 is live AND (2) the new portal client (gameBridge / auth.ts calling supabase.rpc('submit_score', ...)
-- and supabase.rpc('record_play', ...)) is deployed AND one real score and one real play tick have been seen to land.
-- If this goes first, the OLD client's direct writes to these tables are denied (42501; its errors are ignored) and its direct
-- write of profiles.games_played / total_play_time_seconds is silently pinned: nothing is saved until the tab reloads
-- (stale open tabs behave the same way after this migration).
--
-- WHAT IT DOES
--   * public.profiles_protect_xp() (the BEFORE INSERT OR UPDATE trigger function from 0010; the trigger itself is untouched,
--     CREATE OR REPLACE swaps the body in place) now pins FOUR columns for API roles (anon / authenticated): xp, level (exactly
--     the 0010 lines, unchanged) plus games_played and total_play_time_seconds (INSERT -> 0, UPDATE -> OLD value), silently,
--     no error. SECURITY DEFINER functions run as their owner (postgres) and service_role / the SQL editor / the Management API
--     run as themselves, so submit_score / record_play / unlock_achievement / handle_new_user / bt_submit_run -> bt__file_run
--     (the only live writer of games_played, verified: bt_submit_run and bt_report_vs are SECURITY DEFINER owned by postgres),
--     the portal admin "edit"/"reset" and any repair pass keep working. The function is deliberately NOT security definer:
--     current_user inside it must be the invoking role.
--   * leaderboard_scores, leaderboard_trophies, user_game_activity: INSERT / UPDATE / DELETE / TRUNCATE are revoked from anon
--     and authenticated; SELECT stays (leaderboards, profile and recently-played pages read them; played_leaderboards() is
--     SECURITY DEFINER). Writes go through submit_score() / record_play() only. leaderboard_trophies had no writer anywhere
--     (0 rows): a future trophy job must run as service_role or a SECURITY DEFINER function.
--   * ADDITION beyond the bare design (one clearly delimited block, section 3; delete it if you do not want it): the four
--     player-write policies are dropped ("Users own scores", "Users own activity", activity_owner_update, activity_owner_write).
--     After the REVOKE they are inert; leaving them means a later GRANT (dashboard click, a copied default-privileges script)
--     silently re-opens the tables. The public-read SELECT policies stay. Same idea as 0010 dropping user_achievements_owner_insert.
--     If you delete section 3, also delete the two policy assertions in self-test check 2 (they would then fail on purpose).
--   * Not touched on purpose (player-writable for now, NOT part of this task): presence columns (is_online, last_seen_at,
--     current_game_slug), username / avatar_url, friendships, game_ratings, game_saves.
--
-- UPSERT SEMANTICS (proved by the self-test, same mechanism as 0010): a client profile upsert runs the BEFORE INSERT trigger first
-- (EXCLUDED then carries 0 / 1 / 0 / 0), then on conflict the BEFORE UPDATE trigger fires on the DO UPDATE path and pins the four
-- columns back to the row's OLD values, so UserMenu's / signUp's upsert cannot reset an existing player's counters.
--
-- HOW TO APPLY: same as 0009 / 0011 (Management API / dry-run helper; the file ends with its transaction-end line). No NOTIFY needed
-- (no function signature or table shape changes).
--
-- ROLLBACK (also valid inside the same session if something unexpected shows up):
--   CREATE OR REPLACE FUNCTION public.profiles_protect_xp() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
--   BEGIN IF current_user IN ('anon', 'authenticated') THEN IF TG_OP = 'INSERT' THEN NEW.xp := 0; NEW.level := 1;
--   ELSE NEW.xp := OLD.xp; NEW.level := OLD.level; END IF; END IF; RETURN NEW; END; $fn$;
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.leaderboard_scores, public.leaderboard_trophies, public.user_game_activity
--     TO anon, authenticated;
--   CREATE POLICY "Users own scores"   ON public.leaderboard_scores  FOR ALL    USING (auth.uid() = user_id);
--   CREATE POLICY "Users own activity" ON public.user_game_activity   FOR ALL    USING (auth.uid() = user_id);
--   CREATE POLICY activity_owner_update ON public.user_game_activity  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
--   CREATE POLICY activity_owner_write  ON public.user_game_activity  FOR INSERT WITH CHECK (auth.uid() = user_id);
--   (these are the live definitions read from pg_policies on 2026-10-05; all four are roles = {public})
--
-- SELF-TEST (in-transaction, fake signed-in users, rolled back by a subtransaction; a failed check raises XP_SELFTEST_FAIL and
-- aborts the WHOLE migration; success writes "self-test PASS" into the comment on profiles_protect_xp()):
--   trigger shape + not definer | table privileges (SELECT kept, service_role keeps write) + dropped policies, read policies kept |
--   13 direct writes on the three tables denied with 42501 (INSERT, upsert, UPDATE, DELETE, TRUNCATE) and the rows are untouched |
--   reads still work for authenticated AND anon | direct UPDATE of games_played / total_play_time_seconds / xp / level silently
--   pinned while a same-statement avatar change goes through | PostgREST-style upserts (UserMenu payload and a hostile payload)
--   cannot move the counters | a fresh INSERT cannot start above 0 / 1 / 0 / 0 | presence updates still work | the definer
--   functions still write THROUGH the revoked tables and the trigger (submit_score, record_play start + tick moving the
--   profile total, unlock_achievement adding xp) | service_role write passes (skipped, and reported as skipped, if the session
--   user cannot SET ROLE service_role) | postgres write passes | nothing left behind.

BEGIN;

SET LOCAL lock_timeout = '10s';     -- fail fast (and roll back) instead of queueing behind a long transaction on these tables

DO $pre$
BEGIN
  IF to_regprocedure('public.submit_score(bigint,integer)') IS NULL
     OR to_regprocedure('public.record_play(bigint,text)') IS NULL
     OR to_regprocedure('public.ff_season_week(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'XP_LOCK_PRECHECK_FAIL: apply 0011_server_owned_scores_activity.sql first (submit_score / record_play / ff_season_week missing)';
  END IF;
  IF to_regprocedure('public.unlock_achievement(bigint,text)') IS NULL
     OR to_regprocedure('public.profiles_protect_xp()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'profiles_protect_xp' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'XP_LOCK_PRECHECK_FAIL: apply 0009 and 0010 first (unlock_achievement / profiles_protect_xp trigger missing)';
  END IF;
END
$pre$;

-- ------------------------------ 1. profiles: API roles cannot set xp / level / games_played / total_play_time_seconds ------------------------------
-- The two xp / level lines are byte-for-byte the 0010 ones. LANGUAGE, SET search_path and "not SECURITY DEFINER" are unchanged.
CREATE OR REPLACE FUNCTION public.profiles_protect_xp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.xp := 0;  NEW.level := 1;
      NEW.games_played := 0;  NEW.total_play_time_seconds := 0;
    ELSE
      NEW.xp := OLD.xp;  NEW.level := OLD.level;
      NEW.games_played := OLD.games_played;  NEW.total_play_time_seconds := OLD.total_play_time_seconds;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- ------------------------------ 2. scores / trophies / activity: writes only through submit_score() / record_play() ------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.leaderboard_scores, public.leaderboard_trophies, public.user_game_activity
  FROM anon, authenticated;

-- ------------------------------ 3. (addition) drop the now-inert player-write policies ------------------------------
DROP POLICY IF EXISTS "Users own scores"       ON public.leaderboard_scores;
DROP POLICY IF EXISTS "Users own activity"     ON public.user_game_activity;
DROP POLICY IF EXISTS "activity_owner_update"  ON public.user_game_activity;
DROP POLICY IF EXISTS "activity_owner_write"   ON public.user_game_activity;

-- ------------------------------ 4. self-test (inside this transaction) ------------------------------
DO $selftest$
DECLARE
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  v_sfx    text := left(gen_random_uuid()::text, 8);
  v_un1    text;
  v_un2    text;
  v_season text := 'zz-selftest-' || left(gen_random_uuid()::text, 8);
  g1 bigint;
  n_games  bigint;
  sa       text;
  rec      record;
  r        jsonb;
  x        integer;
  y        integer;
  z        integer;
  w        integer;
  n        bigint;
  stmt     text;
  stmts    text[];
  v_en     text;
  v_type   integer;
  v_online boolean;
  v_slug   text;
  v_avatar text;
  ok       boolean;
  can_sr   boolean;
  checks   integer := 0;
  skipped  integer := 0;
  c_expected constant integer := 12;
  msg      text;
  v_comment text;
BEGIN
  v_un1 := 'ff_selftest_' || left(u1::text, 8);
  v_un2 := 'ff_selftest_' || left(u2::text, 8);
  sa    := 'zz_fft_a_' || v_sfx;
  SELECT count(*) INTO n_games FROM public.games;

  BEGIN   -- subtransaction: everything below is rolled back at the end (on top of the explicit deletes)

    -- 1. trigger shape (enabled, row-level, BEFORE, INSERT + UPDATE, not DELETE) and the function is NOT security definer with a pinned search_path
    SELECT t.tgenabled::text, t.tgtype::integer INTO v_en, v_type
      FROM pg_trigger t
     WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'profiles_protect_xp' AND NOT t.tgisinternal;
    IF v_en IS DISTINCT FROM 'O' OR (v_type & 1) IS DISTINCT FROM 1 OR (v_type & 2) IS DISTINCT FROM 2 OR (v_type & 4) IS DISTINCT FROM 4
       OR (v_type & 16) IS DISTINCT FROM 16 OR (v_type & 8) IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 1 trigger shape wrong (enabled=% tgtype=%)', v_en, v_type;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = 'public.profiles_protect_xp()'::regprocedure
                      AND NOT p.prosecdef
                      AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg(setting) WHERE cfg.setting LIKE 'search_path=%')) THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 1 profiles_protect_xp() is security definer or has no pinned search_path (the pin would silently stop working)';
    END IF;
    checks := checks + 1;

    -- 2. table privileges: no write for anon / authenticated on the three tables, SELECT kept, service_role keeps writing
    FOR rec IN SELECT ro.rolname, tb.tname, pr.priv
                 FROM (VALUES ('anon'), ('authenticated')) AS ro(rolname),
                      (VALUES ('public.leaderboard_scores'), ('public.leaderboard_trophies'), ('public.user_game_activity')) AS tb(tname),
                      (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS pr(priv)
    LOOP
      IF has_table_privilege(rec.rolname, rec.tname, rec.priv) THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 % still has % on %', rec.rolname, rec.priv, rec.tname;
      END IF;
    END LOOP;
    FOR rec IN SELECT ro.rolname, tb.tname
                 FROM (VALUES ('anon'), ('authenticated')) AS ro(rolname),
                      (VALUES ('public.leaderboard_scores'), ('public.leaderboard_trophies'), ('public.user_game_activity')) AS tb(tname)
    LOOP
      IF NOT has_table_privilege(rec.rolname, rec.tname, 'SELECT') THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 % lost SELECT on %', rec.rolname, rec.tname;
      END IF;
    END LOOP;
    FOR rec IN SELECT tb.tname, pr.priv
                 FROM (VALUES ('public.leaderboard_scores'), ('public.leaderboard_trophies'), ('public.user_game_activity')) AS tb(tname),
                      (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS pr(priv)
    LOOP
      IF NOT has_table_privilege('service_role', rec.tname, rec.priv) THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 service_role lost % on %', rec.priv, rec.tname;
      END IF;
    END LOOP;
    -- policies: the four write policies are gone, every table still has a SELECT policy
    IF EXISTS (SELECT 1 FROM pg_policies pp
                WHERE pp.schemaname = 'public'
                  AND ((pp.tablename = 'leaderboard_scores'  AND pp.policyname = 'Users own scores')
                    OR (pp.tablename = 'user_game_activity' AND pp.policyname IN ('Users own activity', 'activity_owner_update', 'activity_owner_write')))) THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 a player-write policy still exists';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies pp
                WHERE pp.schemaname = 'public' AND pp.tablename IN ('leaderboard_scores', 'leaderboard_trophies', 'user_game_activity')
                  AND pp.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')) THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 a write-capable policy is left on one of the three tables';
    END IF;
    FOR rec IN SELECT tb.tname FROM (VALUES ('leaderboard_scores'), ('leaderboard_trophies'), ('user_game_activity')) AS tb(tname)
    LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = rec.tname AND pp.cmd = 'SELECT') THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 no SELECT policy left on %', rec.tname;
      END IF;
    END LOOP;
    checks := checks + 1;

    -- fixtures (as postgres): one existing game, one achievement of our own (5 points), two fake users
    IF n_games < 1 THEN
      INSERT INTO public.games (slug, title, genre) VALUES ('ff-selftest-a-' || v_sfx, 'FF selftest A', 'test');
    END IF;
    SELECT g.id INTO g1 FROM public.games g ORDER BY g.id LIMIT 1;
    INSERT INTO public.achievements (game_id, slug, name, description, tier, points)
    VALUES (g1, sa, 'fft a', 'selftest fixture', 'bronze', 5);

    INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
      (u1, 'authenticated', 'authenticated', 'ff-selftest-' || u1 || '@invalid.test', jsonb_build_object('username', v_un1), now(), now()),
      (u2, 'authenticated', 'authenticated', 'ff-selftest-' || u2 || '@invalid.test', jsonb_build_object('username', v_un2), now(), now());
    INSERT INTO public.profiles (id, username) VALUES (u1, v_un1), (u2, v_un2) ON CONFLICT (id) DO NOTHING;
    SELECT count(*) INTO n FROM public.profiles p
     WHERE p.id IN (u1, u2) AND p.xp = 0 AND p.level = 1 AND p.games_played = 0 AND p.total_play_time_seconds = 0;
    IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: expected 2 fresh profiles (handle_new_user through the trigger), got %', n; END IF;
    DELETE FROM public.profiles p WHERE p.id = u2;                    -- u2 plays "a user whose profile row does not exist yet"

    -- postgres seeds u1: xp 310 / level 3 / games_played 7 / play time 4000 (a write by the owner role must pass the trigger),
    -- plus one row in each locked table
    UPDATE public.profiles p SET xp = 310, level = 3, games_played = 7, total_play_time_seconds = 4000 WHERE p.id = u1;
    SELECT p.xp, p.level, p.games_played, p.total_play_time_seconds INTO x, y, z, w FROM public.profiles p WHERE p.id = u1;
    IF x IS DISTINCT FROM 310 OR y IS DISTINCT FROM 3 OR z IS DISTINCT FROM 7 OR w IS DISTINCT FROM 4000 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: the trigger blocked a write by the owner role (xp=% level=% games=% time=%)', x, y, z, w;
    END IF;
    INSERT INTO public.leaderboard_scores (user_id, game_id, score, season_week) VALUES (u1, g1, 100, v_season);
    INSERT INTO public.user_game_activity (user_id, game_id, last_played_at, total_play_seconds, play_count) VALUES (u1, g1, now(), 500, 3);
    INSERT INTO public.leaderboard_trophies (user_id, game_id, season_week, rank_position, percentile_tier, trophy_type)
    VALUES (u1, g1, v_season, 1, 'top1', 'gold');

    -- -- act as u1, signed in --
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- 3. every direct write path on the three tables is denied with 42501 (insufficient_privilege). A statement that does NOT raise
    --    42501 (it ran, or failed for another reason) fails the migration. TRUNCATEs go last. (An INSERT blocked by RLS is also 42501, so
    --    the PRIVILEGE side is asserted separately in check 2; an UPDATE / DELETE that the privilege no longer stops would run and fail here.)
    stmts := ARRAY[
      format('INSERT INTO public.leaderboard_scores (user_id, game_id, score, season_week) VALUES (%L, %s, 999999, %L)', u1, g1, 'zz-denied'),
      format('UPDATE public.leaderboard_scores SET score = 999999 WHERE user_id = %L', u1),
      format('DELETE FROM public.leaderboard_scores WHERE user_id = %L', u1),
      format('INSERT INTO public.user_game_activity (user_id, game_id, play_count) VALUES (%L, %s, 1) ON CONFLICT (user_id, game_id) DO UPDATE SET play_count = 9999', u1, g1),
      format('INSERT INTO public.user_game_activity (user_id, game_id, play_count) VALUES (%L, %s, 1)', u2, g1),
      format('UPDATE public.user_game_activity SET total_play_seconds = 999999 WHERE user_id = %L', u1),
      format('DELETE FROM public.user_game_activity WHERE user_id = %L', u1),
      format('INSERT INTO public.leaderboard_trophies (user_id, game_id, season_week, trophy_type) VALUES (%L, %s, %L, %L)', u1, g1, 'zz-denied', 'gold'),
      format('UPDATE public.leaderboard_trophies SET rank_position = 99 WHERE user_id = %L', u1),
      format('DELETE FROM public.leaderboard_trophies WHERE user_id = %L', u1),
      'TRUNCATE public.leaderboard_scores',
      'TRUNCATE public.user_game_activity',
      'TRUNCATE public.leaderboard_trophies'
    ];
    n := 0;
    FOREACH stmt IN ARRAY stmts LOOP
      ok := false;
      BEGIN
        EXECUTE stmt;
      EXCEPTION WHEN insufficient_privilege THEN
        ok := true;
      END;
      IF NOT ok THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 3 write was NOT denied with 42501: %', stmt;
      END IF;
      n := n + 1;
    END LOOP;
    SELECT (SELECT l.score FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.season_week = v_season),
           (SELECT a.play_count FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1),
           (SELECT a.total_play_seconds FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1),
           (SELECT count(*)::integer FROM public.leaderboard_trophies t WHERE t.user_id = u1)
      INTO x, y, z, w;
    IF n IS DISTINCT FROM 13 OR x IS DISTINCT FROM 100 OR y IS DISTINCT FROM 3 OR z IS DISTINCT FROM 500 OR w IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 3 denied=% (want 13); rows now: score=% play_count=% play_seconds=% trophies=% (want 100 / 3 / 500 / 1)', n, x, y, z, w;
    END IF;
    checks := checks + 1;

    -- 4. reads still work for a signed-in player AND for anon (public-read policies): the three fixture rows are visible
    SELECT (SELECT count(*) FROM public.leaderboard_scores   l WHERE l.user_id = u1 AND l.season_week = v_season)
         + (SELECT count(*) FROM public.user_game_activity   a WHERE a.user_id = u1)
         + (SELECT count(*) FROM public.leaderboard_trophies t WHERE t.user_id = u1)
      INTO n;
    IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 4 authenticated can no longer read the three tables (visible fixture rows %, want 3)', n; END IF;
    EXECUTE 'RESET ROLE';
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT (SELECT count(*) FROM public.leaderboard_scores   l WHERE l.user_id = u1 AND l.season_week = v_season)
         + (SELECT count(*) FROM public.user_game_activity   a WHERE a.user_id = u1)
         + (SELECT count(*) FROM public.leaderboard_trophies t WHERE t.user_id = u1)
      INTO n;
    IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 4 anon can no longer read the three tables (visible fixture rows %, want 3)', n; END IF;
    EXECUTE 'RESET ROLE';
    EXECUTE 'SET LOCAL ROLE authenticated';
    checks := checks + 1;

    -- 5. direct profile UPDATE: xp / level / games_played / total_play_time_seconds are pinned silently (row IS visible: ROW_COUNT 1,
    --    so the pin and not RLS held), while the avatar change in the SAME statement goes through
    UPDATE public.profiles p
       SET xp = 999999, level = 50, games_played = 999, total_play_time_seconds = 999999, avatar_url = 'https://example.invalid/a.png'
     WHERE p.id = u1;
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT p.xp, p.level, p.games_played, p.total_play_time_seconds, p.avatar_url INTO x, y, z, w, v_avatar FROM public.profiles p WHERE p.id = u1;
    IF n IS DISTINCT FROM 1 OR x IS DISTINCT FROM 310 OR y IS DISTINCT FROM 3 OR z IS DISTINCT FROM 7 OR w IS DISTINCT FROM 4000 OR v_avatar IS DISTINCT FROM 'https://example.invalid/a.png' THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 5 direct write: rows=% xp=% level=% games=% time=% avatar=% (want 1 / 310 / 3 / 7 / 4000 / a.png)', n, x, y, z, w, v_avatar;
    END IF;
    checks := checks + 1;

    -- 6. PostgREST-style upsert on an EXISTING profile (supabase-js .upsert -> ON CONFLICT (id) DO UPDATE SET <every sent column> =
    --    EXCLUDED.<column>): UserMenu's payload (level 1, xp 0, no counters) must not move anything, and a hostile payload that
    --    also names the counters must not raise or reset them; the avatar change still applies
    INSERT INTO public.profiles (id, username, avatar_url, level, xp)
    VALUES (u1, v_un1, 'https://example.invalid/b.png', 1, 0)
    ON CONFLICT (id) DO UPDATE SET avatar_url = EXCLUDED.avatar_url, id = EXCLUDED.id, level = EXCLUDED.level,
                                   username = EXCLUDED.username, xp = EXCLUDED.xp;
    SELECT p.xp, p.level, p.games_played, p.total_play_time_seconds, p.avatar_url INTO x, y, z, w, v_avatar FROM public.profiles p WHERE p.id = u1;
    IF x IS DISTINCT FROM 310 OR y IS DISTINCT FROM 3 OR z IS DISTINCT FROM 7 OR w IS DISTINCT FROM 4000 OR v_avatar IS DISTINCT FROM 'https://example.invalid/b.png' THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 6a upsert (level 1, xp 0): xp=% level=% games=% time=% avatar=% (want 310 / 3 / 7 / 4000 / b.png)', x, y, z, w, v_avatar;
    END IF;
    INSERT INTO public.profiles (id, username, level, xp, games_played, total_play_time_seconds)
    VALUES (u1, v_un1, 50, 999999, 999, 999999)
    ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id, level = EXCLUDED.level, username = EXCLUDED.username, xp = EXCLUDED.xp,
                                   games_played = EXCLUDED.games_played, total_play_time_seconds = EXCLUDED.total_play_time_seconds;
    SELECT p.xp, p.level, p.games_played, p.total_play_time_seconds INTO x, y, z, w FROM public.profiles p WHERE p.id = u1;
    IF x IS DISTINCT FROM 310 OR y IS DISTINCT FROM 3 OR z IS DISTINCT FROM 7 OR w IS DISTINCT FROM 4000 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 6b hostile upsert: xp=% level=% games=% time=% (want 310 / 3 / 7 / 4000)', x, y, z, w;
    END IF;
    checks := checks + 1;

    -- 7. a fresh profile (u2: signed in, no row yet, the self-heal upsert path) cannot start above 0 / 1 / 0 / 0
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u2::text, true);
    INSERT INTO public.profiles (id, username, level, xp, games_played, total_play_time_seconds)
    VALUES (u2, v_un2, 50, 999999, 999, 999999);
    SELECT p.xp, p.level, p.games_played, p.total_play_time_seconds INTO x, y, z, w FROM public.profiles p WHERE p.id = u2;
    IF x IS DISTINCT FROM 0 OR y IS DISTINCT FROM 1 OR z IS DISTINCT FROM 0 OR w IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 7 fresh insert: xp=% level=% games=% time=% (want 0 / 1 / 0 / 0)', x, y, z, w;
    END IF;
    checks := checks + 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);

    -- 8. presence / profile updates still work for the client (setOnlineStatus, signOut): only the four stat columns are pinned
    UPDATE public.profiles p SET is_online = true, last_seen_at = now(), current_game_slug = 'ff-selftest' WHERE p.id = u1;
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT p.is_online, p.current_game_slug INTO v_online, v_slug FROM public.profiles p WHERE p.id = u1;
    IF n IS DISTINCT FROM 1 OR NOT coalesce(v_online, false) OR v_slug IS DISTINCT FROM 'ff-selftest' THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 8 presence update: rows=% is_online=% slug=%', n, v_online, v_slug;
    END IF;
    checks := checks + 1;

    -- 9. the SECURITY DEFINER functions still write THROUGH the revoked tables and the trigger (current_user inside them is the
    --    owner, not authenticated): submit_score, record_play start + tick (moves the profile total, never games_played),
    --    unlock_achievement (adds xp)
    r := public.submit_score(g1, 777);
    SELECT l.score INTO x FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.game_id = g1 AND l.season_week = public.ff_season_week();
    IF NOT coalesce((r->>'ok')::boolean, false) OR NOT coalesce((r->>'improved')::boolean, false) OR x IS DISTINCT FROM 777 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 9a submit_score through the revoked table: % stored=%', r, x;
    END IF;
    r := public.record_play(g1, 'start');                                    -- the seeded row had play_count 3
    SELECT a.play_count INTO x FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR x IS DISTINCT FROM 4 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 9b record_play start through the revoked table: % play_count=% (want 4)', r, x;
    END IF;
    EXECUTE 'RESET ROLE';
    UPDATE public.user_game_activity a SET last_played_at = now() - interval '90 seconds' WHERE a.user_id = u1 AND a.game_id = g1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.record_play(g1, 'tick');
    SELECT a.total_play_seconds INTO x FROM public.user_game_activity a WHERE a.user_id = u1 AND a.game_id = g1;
    SELECT p.total_play_time_seconds, p.games_played INTO y, z FROM public.profiles p WHERE p.id = u1;
    IF (r->>'seconds_added')::integer IS DISTINCT FROM 90 OR x IS DISTINCT FROM 590 OR y IS DISTINCT FROM 4090 OR z IS DISTINCT FROM 7 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 9c record_play tick through the trigger: % activity_seconds=% profile_time=% games_played=% (want 90 / 590 / 4090 / 7)', r, x, y, z;
    END IF;
    r := public.unlock_achievement(g1, sa);
    SELECT p.xp, p.level INTO x, y FROM public.profiles p WHERE p.id = u1;
    IF NOT coalesce((r->>'unlocked')::boolean, false) OR (r->>'xp_gained')::integer IS DISTINCT FROM 5 OR x IS DISTINCT FROM 315 OR y IS DISTINCT FROM 3 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 9d unlock_achievement through the trigger: % xp=% level=% (want 5 / 315 / 3)', r, x, y;
    END IF;
    checks := checks + 1;

    -- 10. service_role (admin tooling, repairs) still writes the counters and the three tables. The role switch is probed on its own
    --     so a session that may not SET ROLE service_role is reported as SKIPPED instead of failing for the wrong reason.
    EXECUTE 'RESET ROLE';
    can_sr := true;
    BEGIN
      EXECUTE 'SET LOCAL ROLE service_role';
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN insufficient_privilege THEN
      can_sr := false;
    END;
    IF can_sr THEN
      EXECUTE 'SET LOCAL ROLE service_role';
      UPDATE public.profiles p SET games_played = 11, total_play_time_seconds = 5000, xp = 777, level = 5 WHERE p.id = u1;
      GET DIAGNOSTICS n = ROW_COUNT;
      INSERT INTO public.leaderboard_scores (user_id, game_id, score, season_week) VALUES (u1, g1, 1, v_season || '-sr');
      UPDATE public.leaderboard_scores l SET score = 2 WHERE l.user_id = u1 AND l.season_week = v_season || '-sr';
      DELETE FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.season_week = v_season || '-sr';
      UPDATE public.user_game_activity a SET play_count = 5 WHERE a.user_id = u1 AND a.game_id = g1;
      UPDATE public.leaderboard_trophies t SET rank_position = 2 WHERE t.user_id = u1;
      EXECUTE 'RESET ROLE';
      SELECT p.games_played, p.total_play_time_seconds, p.xp, p.level INTO x, y, z, w FROM public.profiles p WHERE p.id = u1;
      SELECT count(*) INTO n FROM public.leaderboard_scores l WHERE l.user_id = u1 AND l.season_week = v_season || '-sr';
      IF x IS DISTINCT FROM 11 OR y IS DISTINCT FROM 5000 OR z IS DISTINCT FROM 777 OR w IS DISTINCT FROM 5 OR n IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 10 service_role write blocked: games=% time=% xp=% level=% leftover_sr_rows=%', x, y, z, w, n;
      END IF;
      checks := checks + 1;
    ELSE
      skipped := skipped + 1;
      RAISE NOTICE 'XP_SELFTEST check 10 (service_role writes) SKIPPED: the session user cannot SET ROLE service_role';
    END IF;

    -- 11. postgres / SQL editor (repair path) still writes the counters
    UPDATE public.profiles p SET games_played = 12, total_play_time_seconds = 6000 WHERE p.id = u1;
    SELECT p.games_played, p.total_play_time_seconds INTO x, y FROM public.profiles p WHERE p.id = u1;
    IF x IS DISTINCT FROM 12 OR y IS DISTINCT FROM 6000 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 11 owner-role write blocked: games=% time=%', x, y;
    END IF;
    checks := checks + 1;

    -- 12. clean up: delete the fake users (cascades profiles, scores, activity, trophies, unlock rows), the fixture achievement
    --     and any fixture game; then count that nothing is left
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    DELETE FROM auth.users WHERE id IN (u1, u2);
    DELETE FROM public.achievements WHERE game_id = g1 AND slug = sa;
    DELETE FROM public.games WHERE slug = 'ff-selftest-a-' || v_sfx;
    SELECT (SELECT count(*) FROM auth.users WHERE id IN (u1, u2))
         + (SELECT count(*) FROM public.profiles WHERE id IN (u1, u2))
         + (SELECT count(*) FROM public.leaderboard_scores WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.user_game_activity WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.leaderboard_trophies WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.user_achievements WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.achievements WHERE game_id = g1 AND slug = sa)
         + (SELECT count(*) FROM public.games WHERE slug = 'ff-selftest-a-' || v_sfx)
      INTO n;
    IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 12 % test rows left after cleanup', n; END IF;
    checks := checks + 1;

    -- success: unwind the subtransaction (belt and braces: nothing the test touched survives)
    RAISE EXCEPTION USING ERRCODE = 'XP000', MESSAGE = format('XP_SELFTEST_PASS %s checks', checks);
  EXCEPTION WHEN SQLSTATE 'XP000' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF msg IS NULL OR msg NOT LIKE 'XP_SELFTEST_PASS%' OR checks + skipped IS DISTINCT FROM c_expected THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL did not complete (msg=%, checks=%, skipped=%, expected %)', msg, checks, skipped, c_expected;
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (u1, u2)) IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.leaderboard_scores WHERE user_id IN (u1, u2)) IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.user_game_activity WHERE user_id IN (u1, u2)) IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.achievements WHERE slug LIKE 'zz\_fft\_%\_' || v_sfx) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL rows survived the rollback';
  END IF;

  v_comment := format('Pins xp/level/games_played/total_play_time_seconds for API roles (0010_lock_profile_xp.sql + 0012_lock_scores_activity.sql). Migration self-test PASS: %s/%s checks (%s skipped) at %s UTC.',
                      checks, c_expected, skipped, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'));
  EXECUTE format('COMMENT ON FUNCTION public.profiles_protect_xp() IS %L', v_comment);
  RAISE NOTICE '%', v_comment;
END;
$selftest$;

COMMIT;

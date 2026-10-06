-- ForgeFlow Games -- server-authoritative achievement unlock + XP, PART A (2026-10-05)
-- Project: qkidwgyapmitrdxnavmi (accounts / registry / achievements). Spec: forgeflow-games/docs/portal_xp_fix_proposal.md Part A.
--
-- ADDITIVE ONLY: two new functions + grants. No table, policy, trigger or existing function is touched, so the OLD portal
-- client keeps working exactly as before. Safe to apply at any time and BEFORE the client change ships (rollout step 1).
-- Part B (0010_lock_profile_xp.sql) is applied only AFTER the new client is live.
--
-- HOW TO APPLY (one transaction; the file carries its own BEGIN/COMMIT and ends with COMMIT; so the 0008 helper's
-- dry-run swap of the final COMMIT; for ROLLBACK; works unchanged):
--   Management API POST https://api.supabase.com/v1/projects/qkidwgyapmitrdxnavmi/database/query  {"query": <whole file>}
--   (same helper pattern as games/blocktooth/_harness/portal/apply_migration_0008.py, runs as role postgres).
--   After a real apply send a SECOND "NOTIFY pgrst, 'reload schema';" OUTSIDE the transaction and wait ~8 s
--   (0008 found the in-transaction NOTIFY reaches PostgREST late: apply_migration_0008.py:158-162).
--   Re-runnable: every statement is CREATE OR REPLACE / idempotent (the self-test simply runs again).
--
-- ROLLBACK: DROP FUNCTION public.unlock_achievement(bigint, text); DROP FUNCTION public.ff_level_from_xp(integer);
--
-- WHAT THE SELF-TEST PROVES (in-transaction, as fake signed-in users, then rolled back by a subtransaction; any failed
-- check raises XP_SELFTEST_FAIL and aborts the WHOLE migration; success writes "self-test PASS" into the function comment):
--   level curve boundaries == auth.ts XP_PER_LEVEL | EXECUTE grants (anon none) | first unlock adds exactly its points |
--   repeat is a no-op | distinct unlocks accumulate | wrong game refused | bad args refused | Badge-of-the-Day multiplier |
--   level + leveled_up | no-profile raises AND leaves no unlock row | not-signed-in refused | nothing left behind.
-- It uses FIXTURE achievements it inserts itself (rolled back), so it does not depend on live seed data or on today's badge.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- Level curve: mirrors XP_PER_LEVEL / getLevelFromXP in src/lib/auth.ts (levels 1-10 table, 11-50 by formula, cap 50).
-- Level l (11..50) starts at 3200 + (l-10)*500 + (l-10)^2*50 (3750, 4400, ... 103200). Negative/NULL xp -> level 1.
CREATE OR REPLACE FUNCTION public.ff_level_from_xp(p_xp integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(max(g.l), 1)
    FROM generate_series(1, 50) AS g(l)
   WHERE (CASE g.l
            WHEN 1 THEN 0    WHEN 2 THEN 100  WHEN 3 THEN 250  WHEN 4 THEN 450  WHEN 5 THEN 700
            WHEN 6 THEN 1000 WHEN 7 THEN 1400 WHEN 8 THEN 1900 WHEN 9 THEN 2500 WHEN 10 THEN 3200
            ELSE 3200 + (g.l - 10) * 500 + (g.l - 10) * (g.l - 10) * 50
          END) <= p_xp;
$fn$;

-- The ONLY way to unlock an achievement and earn its XP once Part B is in.
-- One call = one transaction: the unlock row and the XP add commit or roll back together.
CREATE OR REPLACE FUNCTION public.unlock_achievement(p_game_id bigint, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_ach_id bigint;
  v_points integer;
  v_mult   integer;
  v_gain   integer;
  v_row    bigint;
  v_xp     integer;
  v_level  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  -- 200, not 64: the bridge ignores {ok:false}, so an over-tight cap would silently drop a long legacy slug.
  IF p_game_id IS NULL OR p_slug IS NULL OR length(p_slug) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;

  -- scoped to the game the caller names; points come from the table, never from the client
  SELECT a.id, a.points INTO v_ach_id, v_points
    FROM public.achievements a
   WHERE a.game_id = p_game_id AND a.slug = p_slug;
  IF v_ach_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_achievement');
  END IF;

  INSERT INTO public.user_achievements (user_id, achievement_id)
  VALUES (v_uid, v_ach_id)
  ON CONFLICT (user_id, achievement_id) DO NOTHING
  RETURNING id INTO v_row;               -- conflict -> no row returned -> v_row stays NULL (INTO without STRICT)

  IF v_row IS NULL THEN                  -- already unlocked, or a concurrent twin committed first: no XP, not an error
    RETURN jsonb_build_object('ok', true, 'unlocked', false);
  END IF;

  -- Badge of the Day multiplier (UTC date, same as the old client's toISOString().split("T")[0]).
  -- now() is the transaction start time, so the date cannot change between this read and the caller's view of it.
  SELECT COALESCE(max(d.bonus_multiplier), 1) INTO v_mult
    FROM public.daily_badge d
   WHERE d.achievement_id = v_ach_id
     AND d.active_date = (now() AT TIME ZONE 'UTC')::date;
  v_gain := v_points * v_mult;

  -- Atomic add: one UPDATE, row-locked; under READ COMMITTED a concurrent unlock re-reads the committed xp, so they add up.
  -- Right-hand sides see the OLD row; RETURNING gives the NEW values.
  UPDATE public.profiles p
     SET xp    = p.xp + v_gain,
         level = public.ff_level_from_xp(p.xp + v_gain)
   WHERE p.id = v_uid
  RETURNING p.xp, p.level INTO v_xp, v_level;

  IF v_xp IS NULL THEN                   -- no profile row: abort so the unlock row above rolls back too (retryable)
    RAISE EXCEPTION 'no_profile';
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'unlocked', true, 'xp_gained', v_gain, 'xp', v_xp, 'level', v_level,
    'leveled_up', v_level > public.ff_level_from_xp(v_xp - v_gain));
END;
$fn$;

-- Supabase default privileges grant EXECUTE to PUBLIC and anon on new functions: close that (same pattern as 0008).
REVOKE ALL ON FUNCTION public.unlock_achievement(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_achievement(bigint, text) TO authenticated, service_role;

-- ------------------------------ self-test (inside this transaction) ------------------------------
DO $selftest$
DECLARE
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  v_sfx    text := left(gen_random_uuid()::text, 8);
  v_game   bigint;
  sa text; sb text; sc text; sd text; se text;
  c_id bigint;
  rec      record;
  r        jsonb;
  x        integer;
  lv       integer;
  n        bigint;
  n_badge  bigint;
  ok       boolean;
  checks   integer := 0;
  msg      text;
  v_comment text;
  v_today  date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT count(*) INTO n_badge FROM public.daily_badge;

  BEGIN   -- subtransaction: everything below is rolled back at the end (on top of the explicit deletes)

    -- 1. level curve == auth.ts XP_PER_LEVEL (expected values re-derived by hand from the TS table + formula)
    FOR rec IN SELECT * FROM (VALUES
        (NULL::integer, 1), (-5, 1), (0, 1), (99, 1), (100, 2), (249, 2), (250, 3), (449, 3), (450, 4),
        (3199, 9), (3200, 10), (3699, 10), (3749, 10), (3750, 11), (3799, 11), (4399, 11), (4400, 12),
        (98749, 48), (98750, 49), (103199, 49), (103200, 50), (2147483647, 50)
      ) AS t(xp_in, lvl_exp)
    LOOP
      IF public.ff_level_from_xp(rec.xp_in) IS DISTINCT FROM rec.lvl_exp THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 1 ff_level_from_xp(%) = %, expected %',
          rec.xp_in, public.ff_level_from_xp(rec.xp_in), rec.lvl_exp;
      END IF;
    END LOOP;
    checks := checks + 1;

    -- 2. grants / hardening: anon (and therefore PUBLIC) cannot execute; signed-in + service can; definer with pinned search_path
    IF has_function_privilege('anon', 'public.unlock_achievement(bigint,text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.unlock_achievement(bigint,text)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.unlock_achievement(bigint,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 execute grants wrong (anon=% authenticated=% service_role=%)',
        has_function_privilege('anon', 'public.unlock_achievement(bigint,text)', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.unlock_achievement(bigint,text)', 'EXECUTE'),
        has_function_privilege('service_role', 'public.unlock_achievement(bigint,text)', 'EXECUTE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = 'public.unlock_achievement(bigint,text)'::regprocedure
                      AND p.prosecdef
                      AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg(setting) WHERE cfg.setting LIKE 'search_path=%')) THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 unlock_achievement is not SECURITY DEFINER with a pinned search_path';
    END IF;
    checks := checks + 1;

    -- fixtures (as postgres): any existing game, five achievements of our own (5/15/30/5/5 points), two fake users.
    SELECT g.id INTO v_game FROM public.games g ORDER BY g.id LIMIT 1;
    IF v_game IS NULL THEN
      INSERT INTO public.games (slug, title) VALUES ('xp-selftest-' || v_sfx, 'XP selftest') RETURNING id INTO v_game;
    END IF;
    sa := 'zz_xpt_a_' || v_sfx;  sb := 'zz_xpt_b_' || v_sfx;  sc := 'zz_xpt_c_' || v_sfx;
    sd := 'zz_xpt_d_' || v_sfx;  se := 'zz_xpt_e_' || v_sfx;
    INSERT INTO public.achievements (game_id, slug, name, description, tier, points) VALUES
      (v_game, sa, 'xpt a', 'selftest fixture', 'bronze', 5),
      (v_game, sb, 'xpt b', 'selftest fixture', 'silver', 15),
      (v_game, sc, 'xpt c', 'selftest fixture', 'gold',   30),
      (v_game, sd, 'xpt d', 'selftest fixture', 'bronze', 5),
      (v_game, se, 'xpt e', 'selftest fixture', 'bronze', 5);
    SELECT a.id INTO c_id FROM public.achievements a WHERE a.game_id = v_game AND a.slug = sc;

    -- two fake users (postgres may write auth.users; the only trigger there is on_auth_user_created -> handle_new_user ->
    -- profiles, so the explicit profile insert below is normally a no-op; kept in case that trigger swallowed an error)
    INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
      (u1, 'authenticated', 'authenticated', 'xp-selftest-' || u1 || '@invalid.test',
       jsonb_build_object('username', 'xp_selftest_' || left(u1::text, 8)), now(), now()),
      (u2, 'authenticated', 'authenticated', 'xp-selftest-' || u2 || '@invalid.test',
       jsonb_build_object('username', 'xp_selftest_' || left(u2::text, 8)), now(), now());
    INSERT INTO public.profiles (id, username) VALUES
      (u1, 'xp_selftest_' || left(u1::text, 8)), (u2, 'xp_selftest_' || left(u2::text, 8))
    ON CONFLICT (id) DO NOTHING;
    SELECT count(*) INTO n FROM public.profiles p WHERE p.id IN (u1, u2) AND p.xp = 0 AND p.level = 1;
    IF n <> 2 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: expected 2 fresh profiles, got %', n; END IF;

    -- -- act as u1, signed in --
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- 3. first unlock adds exactly its points
    r := public.unlock_achievement(v_game, sa);
    SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR NOT coalesce((r->>'unlocked')::boolean, false)
       OR (r->>'xp_gained')::integer IS DISTINCT FROM 5 OR (r->>'xp')::integer IS DISTINCT FROM 5
       OR x <> 5 OR lv <> 1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 3 first unlock: % profile xp=% level=%', r, x, lv;
    END IF;
    checks := checks + 1;

    -- 4. repeat is a no-op (what a concurrent twin looks like once the unique index has resolved it)
    r := public.unlock_achievement(v_game, sa);
    SELECT p.xp INTO x FROM public.profiles p WHERE p.id = u1;
    SELECT count(*) INTO n FROM public.user_achievements ua WHERE ua.user_id = u1;
    IF NOT coalesce((r->>'ok')::boolean, false) OR coalesce((r->>'unlocked')::boolean, true) OR x <> 5 OR n <> 1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 4 repeat unlock: % xp=% unlock_rows=%', r, x, n;
    END IF;
    checks := checks + 1;

    -- 5. a different unlock accumulates
    r := public.unlock_achievement(v_game, sb);
    SELECT p.xp INTO x FROM public.profiles p WHERE p.id = u1;
    IF NOT coalesce((r->>'unlocked')::boolean, false) OR x <> 20 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 5 second unlock: % xp=% (expected 20)', r, x;
    END IF;
    checks := checks + 1;

    -- 6. a real slug under the WRONG game is refused and writes nothing (old numeric-id path was unscoped)
    r := public.unlock_achievement(-1, sa);
    SELECT count(*) INTO n FROM public.user_achievements ua WHERE ua.user_id = u1;
    SELECT p.xp INTO x FROM public.profiles p WHERE p.id = u1;
    IF coalesce((r->>'ok')::boolean, true) OR r->>'error' IS DISTINCT FROM 'unknown_achievement' OR n <> 2 OR x <> 20 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 6 wrong game: % unlock_rows=% xp=%', r, n, x;
    END IF;
    checks := checks + 1;

    -- 7. bad arguments: soft refusal, no write
    IF coalesce((public.unlock_achievement(NULL, sa)->>'ok')::boolean, true)
       OR coalesce((public.unlock_achievement(v_game, NULL)->>'ok')::boolean, true)
       OR coalesce((public.unlock_achievement(v_game, repeat('x', 201))->>'ok')::boolean, true) THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 7 bad args were not refused';
    END IF;
    checks := checks + 1;

    -- 8. Badge of the Day: today's badge on achievement c (x2) -> 30 * 2 = 60 (fixture badge replaces any real row for today;
    --    the subtransaction rollback restores the real one, and n_badge is re-checked after it)
    EXECUTE 'RESET ROLE';
    DELETE FROM public.daily_badge WHERE active_date = v_today;
    INSERT INTO public.daily_badge (active_date, achievement_id, bonus_multiplier) VALUES (v_today, c_id, 2);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.unlock_achievement(v_game, sc);
    SELECT p.xp INTO x FROM public.profiles p WHERE p.id = u1;
    IF NOT coalesce((r->>'unlocked')::boolean, false) OR (r->>'xp_gained')::integer IS DISTINCT FROM 60 OR x <> 80 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 8 badge multiplier: % xp=% (expected gain 60, xp 80)', r, x;
    END IF;
    checks := checks + 1;

    -- 9. level + leveled_up: park u1 at 95 xp, +5 crosses level 2 at 100; the next +5 does not level up
    EXECUTE 'RESET ROLE';
    UPDATE public.profiles p SET xp = 95, level = 1 WHERE p.id = u1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.unlock_achievement(v_game, sd);
    IF (r->>'xp_gained')::integer IS DISTINCT FROM 5 OR (r->>'xp')::integer IS DISTINCT FROM 100
       OR (r->>'level')::integer IS DISTINCT FROM 2 OR NOT coalesce((r->>'leveled_up')::boolean, false) THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 9a level up: %', r;
    END IF;
    r := public.unlock_achievement(v_game, se);
    SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u1;
    IF (r->>'xp')::integer IS DISTINCT FROM 105 OR (r->>'level')::integer IS DISTINCT FROM 2
       OR coalesce((r->>'leveled_up')::boolean, true) OR x <> 105 OR lv <> 2 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 9b no level up: % profile xp=% level=%', r, x, lv;
    END IF;
    checks := checks + 1;

    -- 10. no profile row (the signup trigger swallowed an error): the function RAISES and its unlock row does not survive
    EXECUTE 'RESET ROLE';
    DELETE FROM public.profiles p WHERE p.id = u2;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u2::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    ok := false;
    BEGIN
      r := public.unlock_achievement(v_game, sa);
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      ok := (msg = 'no_profile');
    END;
    SELECT count(*) INTO n FROM public.user_achievements ua WHERE ua.user_id = u2;
    IF NOT ok OR n <> 0 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 10 no-profile: raised no_profile=% leftover_unlock_rows=%', ok, n;
    END IF;
    checks := checks + 1;

    -- 11. not signed in (no sub claim): refused with 42501 (insufficient_privilege) and nothing written
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    ok := false;
    BEGIN
      r := public.unlock_achievement(v_game, sa);
    EXCEPTION WHEN insufficient_privilege THEN
      ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 11 unsigned call was not refused: %', r; END IF;
    checks := checks + 1;

    -- 12. clean up: delete the fake users (cascades profiles + unlock rows), fixtures, any fixture game
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    DELETE FROM auth.users WHERE id IN (u1, u2);
    DELETE FROM public.daily_badge WHERE achievement_id = c_id;     -- fixture badge references fixture achievement c (FK)
    DELETE FROM public.achievements WHERE game_id = v_game AND slug IN (sa, sb, sc, sd, se);
    DELETE FROM public.games WHERE slug = 'xp-selftest-' || v_sfx;
    SELECT (SELECT count(*) FROM auth.users WHERE id IN (u1, u2))
         + (SELECT count(*) FROM public.profiles WHERE id IN (u1, u2))
         + (SELECT count(*) FROM public.user_achievements WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.achievements WHERE game_id = v_game AND slug IN (sa, sb, sc, sd, se))
         + (SELECT count(*) FROM public.games WHERE slug = 'xp-selftest-' || v_sfx)
      INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 12 % test rows left after cleanup', n; END IF;
    checks := checks + 1;

    -- success: unwind the subtransaction (also restores any real daily_badge row the badge test replaced)
    RAISE EXCEPTION USING ERRCODE = 'XP000', MESSAGE = format('XP_SELFTEST_PASS %s checks', checks);
  EXCEPTION WHEN SQLSTATE 'XP000' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF msg IS NULL OR msg NOT LIKE 'XP_SELFTEST_PASS%' OR checks <> 12 THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL did not complete (msg=%, checks=%)', msg, checks;
  END IF;
  SELECT count(*) INTO n FROM public.daily_badge;
  IF n <> n_badge OR (SELECT count(*) FROM auth.users WHERE id IN (u1, u2)) <> 0
     OR (SELECT count(*) FROM public.achievements WHERE slug LIKE 'zz\_xpt\_%\_' || v_sfx) <> 0 THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL rows survived the rollback (daily_badge % -> %)', n_badge, n;
  END IF;

  v_comment := format('Server-authoritative achievement unlock + XP (0009_unlock_achievement_rpc.sql). Migration self-test PASS: %s/12 checks at %s UTC.',
                      checks, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'));
  EXECUTE format('COMMENT ON FUNCTION public.unlock_achievement(bigint, text) IS %L', v_comment);
  RAISE NOTICE '%', v_comment;
END;
$selftest$;

NOTIFY pgrst, 'reload schema';

COMMIT;
